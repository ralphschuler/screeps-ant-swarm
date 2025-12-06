/**
 * Room Node - Per-room main loop
 *
 * Handles all per-room operations:
 * - Initialize/read RoomMemory.swarm
 * - Update metrics and pheromones
 * - Determine evolution stage and posture
 * - Run spawn logic
 * - Run creep role logic
 * - Run towers & structure control
 * - Run base construction
 */

import type { SwarmState } from "../memory/schemas";
import { memoryManager } from "../memory/manager";
import { pheromoneManager } from "../logic/pheromone";
import { calculateDangerLevel, evolutionManager, postureManager } from "../logic/evolution";
import { profiler } from "./profiler";
import { destroyMisplacedStructures, getBlueprint, placeConstructionSites } from "../layouts/blueprints";
import { placeRoadConstructionSites } from "../layouts/roadNetworkPlanner";
import { safeFind } from "../utils/safeFind";
import { safeModeManager } from "../defense/safeModeManager";
import { placePerimeterDefense } from "../defense/perimeterDefense";
import { chemistryPlanner } from "../labs/chemistryPlanner";
import { boostManager } from "../labs/boostManager";
import { kernel } from "./kernel";

/**
 * Room node configuration
 */
export interface RoomNodeConfig {
  /** Enable pheromone updates */
  enablePheromones: boolean;
  /** Enable evolution updates */
  enableEvolution: boolean;
  /** Enable spawn logic */
  enableSpawning: boolean;
  /** Enable construction */
  enableConstruction: boolean;
  /** Enable tower control */
  enableTowers: boolean;
  /** Enable resource processing */
  enableProcessing: boolean;
}

const DEFAULT_CONFIG: RoomNodeConfig = {
  enablePheromones: true,
  enableEvolution: true,
  enableSpawning: true,
  enableConstruction: true,
  enableTowers: true,
  enableProcessing: true
};

/**
 * Room Node class - manages a single room
 */
export class RoomNode {
  public readonly roomName: string;
  private config: RoomNodeConfig;

  public constructor(roomName: string, config: Partial<RoomNodeConfig> = {}) {
    this.roomName = roomName;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Main room tick
   */
  public run(totalOwnedRooms: number): void {
    const cpuStart = profiler.startRoom(this.roomName);

    const room = Game.rooms[this.roomName];
    if (!room || !room.controller?.my) {
      profiler.endRoom(this.roomName, cpuStart);
      return;
    }

    // Get or initialize swarm state
    const swarm = memoryManager.getOrInitSwarmState(this.roomName);

    // Update metrics
    if (this.config.enablePheromones) {
      pheromoneManager.updateMetrics(room, swarm);
    }

    // Update threat assessment
    this.updateThreatAssessment(room, swarm);

    // Check safe mode trigger
    safeModeManager.checkSafeMode(room, swarm);

    // Update evolution stage
    if (this.config.enableEvolution) {
      evolutionManager.updateEvolutionStage(swarm, room, totalOwnedRooms);
      evolutionManager.updateMissingStructures(swarm, room);
    }

    // Update posture
    postureManager.updatePosture(swarm);

    // Update pheromones
    if (this.config.enablePheromones) {
      pheromoneManager.updatePheromones(swarm, room);
    }

    // Run tower control
    if (this.config.enableTowers) {
      this.runTowerControl(room, swarm);
    }

    // Run construction (every 10 ticks)
    if (this.config.enableConstruction && Game.time % 10 === 0 && postureManager.allowsBuilding(swarm.posture)) {
      this.runConstruction(room, swarm);
    }

    // Run resource processing (every 5 ticks)
    if (this.config.enableProcessing && Game.time % 5 === 0) {
      this.runResourceProcessing(room, swarm);
    }

    profiler.endRoom(this.roomName, cpuStart);
  }

  /**
   * Update threat assessment.
   * Uses optimized iteration for better CPU efficiency.
   * Emits events through the kernel event system for centralized handling.
   */
  private updateThreatAssessment(room: Room, swarm: SwarmState): void {
    // Use safeFind to handle engine errors with corrupted owner data
    const hostiles = safeFind(room, FIND_HOSTILE_CREEPS);
    const enemyStructures = safeFind(room, FIND_HOSTILE_STRUCTURES, {
      filter: s => s.structureType !== STRUCTURE_CONTROLLER
    });

    // Calculate potential damage with efficient single-loop iteration
    let potentialDamage = 0;
    for (const hostile of hostiles) {
      for (const part of hostile.body) {
        if (part.hits > 0) {
          if (part.type === ATTACK) {
            potentialDamage += 30;
          } else if (part.type === RANGED_ATTACK) {
            potentialDamage += 10;
          }
        }
      }
    }

    const newDanger = calculateDangerLevel(hostiles.length, potentialDamage, enemyStructures.length > 0);

    // Update danger and emit events if increased
    if (newDanger > swarm.danger) {
      pheromoneManager.onHostileDetected(swarm, hostiles.length, newDanger);
      memoryManager.addRoomEvent(this.roomName, "hostileDetected", `${hostiles.length} hostiles, danger=${newDanger}`);

      // Emit hostile detected events for each hostile through the kernel event system
      for (const hostile of hostiles) {
        kernel.emit("hostile.detected", {
          roomName: this.roomName,
          hostileId: hostile.id,
          hostileOwner: hostile.owner.username,
          bodyParts: hostile.body.length,
          threatLevel: newDanger,
          source: this.roomName
        });
      }
    } else if (hostiles.length === 0 && swarm.danger > 0) {
      // Emit hostile cleared event when danger level drops to 0
      kernel.emit("hostile.cleared", {
        roomName: this.roomName,
        source: this.roomName
      });
    }

    swarm.danger = newDanger;

    // Check for nukes (only trigger once per nuke event)
    const nukes = room.find(FIND_NUKES);
    if (nukes.length > 0) {
      if (!swarm.nukeDetected) {
        pheromoneManager.onNukeDetected(swarm);
        const launchSource = nukes[0]?.launchRoomName ?? 'unidentified source';
        memoryManager.addRoomEvent(this.roomName, "nukeDetected", `${nukes.length} nuke(s) incoming from ${launchSource}`);
        swarm.nukeDetected = true;

        // Emit nuke detected events through kernel event system
        for (const nuke of nukes) {
          kernel.emit("nuke.detected", {
            roomName: this.roomName,
            nukeId: nuke.id,
            landingTick: Game.time + nuke.timeToLand,
            launchRoomName: nuke.launchRoomName,
            source: this.roomName
          });
        }
      }
    } else {
      // Reset flag when nukes are gone
      swarm.nukeDetected = false;
    }
  }

  /**
   * Run tower control
   */
  private runTowerControl(room: Room, swarm: SwarmState): void {
    const towers = room.find(FIND_MY_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_TOWER
    }) as StructureTower[];

    if (towers.length === 0) return;

    // Find targets - use safeFind to handle engine errors with corrupted owner data
    const hostiles = safeFind(room, FIND_HOSTILE_CREEPS);

    for (const tower of towers) {
      if (tower.store.getUsedCapacity(RESOURCE_ENERGY) < 10) continue;

      // Priority 1: Attack hostiles
      if (hostiles.length > 0) {
        // Target priority: healers > ranged > melee > others
        const target = this.selectTowerTarget(hostiles);
        if (target) {
          tower.attack(target);
          continue;
        }
      }

      // Priority 2: Heal damaged creeps (only in non-siege)
      if (swarm.posture !== "siege") {
        const damaged = tower.pos.findClosestByRange(FIND_MY_CREEPS, {
          filter: c => c.hits < c.hitsMax
        });
        if (damaged) {
          tower.heal(damaged);
          continue;
        }
      }

      // Priority 3: Repair structures (only in non-war postures)
      if (!postureManager.isCombatPosture(swarm.posture)) {
        const damaged = tower.pos.findClosestByRange(FIND_STRUCTURES, {
          filter: s =>
            s.hits < s.hitsMax * 0.8 && s.structureType !== STRUCTURE_WALL && s.structureType !== STRUCTURE_RAMPART
        });
        if (damaged) {
          tower.repair(damaged);
        }
      }
    }
  }

  /**
   * Select tower attack target
   */
  private selectTowerTarget(hostiles: Creep[]): Creep | null {
    // Sort by priority: healers > boosted > ranged > melee > others
    const sorted = hostiles.sort((a, b) => {
      const scoreA = this.getHostilePriority(a);
      const scoreB = this.getHostilePriority(b);
      return scoreB - scoreA;
    });

    return sorted[0] ?? null;
  }

  /**
   * Get priority score for hostile targeting
   */
  private getHostilePriority(hostile: Creep): number {
    let score = 0;

    for (const part of hostile.body) {
      if (!part.hits) continue;

      switch (part.type) {
        case HEAL:
          score += 100;
          break;
        case RANGED_ATTACK:
          score += 50;
          break;
        case ATTACK:
          score += 40;
          break;
        case CLAIM:
          score += 60;
          break;
        case WORK:
          score += 30;
          break;
      }

      // Boosted parts are higher priority
      if (part.boost) {
        score += 20;
      }
    }

    return score;
  }

  /**
   * Run construction logic using blueprints
   */
  private runConstruction(room: Room, swarm: SwarmState): void {
    // Check global construction site limit
    const existingSites = room.find(FIND_MY_CONSTRUCTION_SITES);
    if (existingSites.length >= 10) return;

    // Get blueprint for current RCL
    const rcl = room.controller?.level ?? 1;
    const blueprint = getBlueprint(rcl);
    if (!blueprint) return;

    // Find spawn to use as anchor
    const spawn = room.find(FIND_MY_SPAWNS)[0];
    if (!spawn) {
      // No spawn, place one if we're a new colony
      if (rcl === 1 && existingSites.length === 0) {
        // Find a suitable position for first spawn
        const controller = room.controller;
        if (controller) {
          const sources = room.find(FIND_SOURCES);
          // Find position between controller and sources
          const avgX = Math.round(
            (controller.pos.x + sources.reduce((sum, s) => sum + s.pos.x, 0)) / (sources.length + 1)
          );
          const avgY = Math.round(
            (controller.pos.y + sources.reduce((sum, s) => sum + s.pos.y, 0)) / (sources.length + 1)
          );

          // Check if position is buildable
          const terrain = room.getTerrain();
          if (terrain.get(avgX, avgY) !== TERRAIN_MASK_WALL) {
            room.createConstructionSite(avgX, avgY, STRUCTURE_SPAWN);
          }
        }
      }
      return;
    }

    // Destroy misplaced structures that don't match the blueprint
    // Runs every construction tick (10 ticks) in non-combat postures for faster cleanup
    // Pass remote room assignments to preserve roads leading to remote mining rooms
    if (!postureManager.isCombatPosture(swarm.posture)) {
      const destroyed = destroyMisplacedStructures(room, spawn.pos, blueprint, 1, swarm.remoteAssignments);
      if (destroyed > 0) {
        const structureWord = destroyed === 1 ? "structure" : "structures";
        memoryManager.addRoomEvent(this.roomName, "structureDestroyed", `${destroyed} misplaced ${structureWord} destroyed for blueprint compliance`);
      }
    }

    // Priority 1: Place perimeter defense (RCL 2+)
    // Early defense is critical for room security
    let perimeterPlaced = 0;
    if (rcl >= 2 && existingSites.length < 8) {
      // Prioritize choke points at RCL 2, full perimeter at RCL 3+
      perimeterPlaced = placePerimeterDefense(room, rcl, 2, true);
    }

    // Priority 2: Place construction sites using blueprint
    const placed = placeConstructionSites(room, spawn.pos, blueprint);

    // Priority 3: Place road construction sites for infrastructure routes (sources, controller, mineral)
    // Only place 1-2 road sites per tick to avoid overwhelming builders
    const roadSitesPlaced = placeRoadConstructionSites(room, spawn.pos, 2);

    // Update metrics
    swarm.metrics.constructionSites = existingSites.length + placed + roadSitesPlaced + perimeterPlaced;
  }

  /**
   * Run resource processing (labs, factory, power spawn)
   */
  private runResourceProcessing(room: Room, _swarm: SwarmState): void {
    const rcl = room.controller?.level ?? 0;

    // Run labs (RCL 6+)
    if (rcl >= 6) {
      this.runLabs(room);
    }

    // Run factory (RCL 7+)
    if (rcl >= 7) {
      this.runFactory(room);
    }

    // Run power spawn (RCL 8)
    if (rcl >= 8) {
      this.runPowerSpawn(room);
    }

    // Run links
    this.runLinks(room);
  }

  /**
   * Run lab reactions
   */
  private runLabs(room: Room): void {
    const swarm = memoryManager.getSwarmState(room.name);
    if (!swarm) return;

    // Prepare labs for boosting when danger is high
    boostManager.prepareLabs(room, swarm);

    // Plan reactions using chemistry planner
    const reaction = chemistryPlanner.planReactions(room, swarm);
    if (reaction) {
      chemistryPlanner.executeReaction(room, reaction);
    }
  }

  /**
   * Run factory production
   */
  private runFactory(room: Room): void {
    const factory = room.find(FIND_MY_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_FACTORY
    })[0] as StructureFactory | undefined;

    if (!factory || factory.cooldown > 0) return;

    // Simple commodity production - compress minerals
    const minerals: MineralConstant[] = [
      RESOURCE_UTRIUM,
      RESOURCE_LEMERGIUM,
      RESOURCE_KEANIUM,
      RESOURCE_ZYNTHIUM,
      RESOURCE_HYDROGEN,
      RESOURCE_OXYGEN
    ];

    for (const mineral of minerals) {
      if (factory.store.getUsedCapacity(mineral) >= 500 && factory.store.getUsedCapacity(RESOURCE_ENERGY) >= 200) {
        // Try to produce compressed bar
        const result = factory.produce(RESOURCE_UTRIUM_BAR); // Note: This is simplified
        if (result === OK) break;
      }
    }
  }

  /**
   * Run power spawn
   */
  private runPowerSpawn(room: Room): void {
    const powerSpawn = room.find(FIND_MY_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_POWER_SPAWN
    })[0] as StructurePowerSpawn | undefined;

    if (!powerSpawn) return;

    // Process power if we have resources
    if (
      powerSpawn.store.getUsedCapacity(RESOURCE_POWER) >= 1 &&
      powerSpawn.store.getUsedCapacity(RESOURCE_ENERGY) >= 50
    ) {
      powerSpawn.processPower();
    }
  }

  /**
   * Run link transfers
   */
  private runLinks(room: Room): void {
    const allLinks = room.find(FIND_MY_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_LINK
    });
    const links = allLinks as StructureLink[];

    if (links.length < 2) return;

    const storage = room.storage;
    if (!storage) return;

    // Find storage link (within 2 of storage)
    const storageLink = links.find(l => l.pos.getRangeTo(storage) <= 2);
    if (!storageLink) return;

    // Find source links (links near sources)
    const sources = room.find(FIND_SOURCES);
    const sourceLinks = links.filter(l => sources.some(s => l.pos.getRangeTo(s) <= 2));

    // Transfer from source links to storage link
    for (const sourceLink of sourceLinks) {
      if (sourceLink.store.getUsedCapacity(RESOURCE_ENERGY) >= 400 && sourceLink.cooldown === 0) {
        if (storageLink.store.getFreeCapacity(RESOURCE_ENERGY) >= 400) {
          sourceLink.transferEnergy(storageLink);
          break;
        }
      }
    }
  }
}

/**
 * Room manager - orchestrates all room nodes
 */
export class RoomManager {
  private nodes: Map<string, RoomNode> = new Map();

  /**
   * Run all owned rooms
   */
  public run(): void {
    const ownedRooms = Object.values(Game.rooms).filter(r => r.controller?.my);
    const totalOwned = ownedRooms.length;

    // Ensure nodes exist for all owned rooms
    for (const room of ownedRooms) {
      if (!this.nodes.has(room.name)) {
        this.nodes.set(room.name, new RoomNode(room.name));
      }
    }

    // Clean up nodes for rooms we no longer own
    for (const [name] of this.nodes) {
      const room = Game.rooms[name];
      if (!room || !room.controller?.my) {
        this.nodes.delete(name);
      }
    }

    // Run each node with error recovery
    for (const node of this.nodes.values()) {
      try {
        node.run(totalOwned);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.log(`[RoomManager] ERROR in room ${node.roomName}: ${errorMessage}`);
        if (err instanceof Error && err.stack) {
          console.log(err.stack);
        }
        // Continue processing other rooms
      }
    }
  }

  /**
   * Get node for a room
   */
  public getNode(roomName: string): RoomNode | undefined {
    return this.nodes.get(roomName);
  }

  /**
   * Get all nodes
   */
  public getAllNodes(): RoomNode[] {
    return Array.from(this.nodes.values());
  }
}

/**
 * Global room manager instance
 */
export const roomManager = new RoomManager();
