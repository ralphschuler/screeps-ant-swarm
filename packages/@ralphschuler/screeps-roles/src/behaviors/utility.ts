/**
 * Utility Behaviors
 *
 * Behavior functions for utility and support roles.
 * Includes scouting, claiming, engineering, and logistics.
 */

import type { RoomIntel, EmpireMemory } from "../memory/schemas";
import { safeFind } from "@ralphschuler/screeps-utils";
import { findCachedClosest } from "../cache";
import { isExit } from "screeps-cartographer";
import type { CreepAction, CreepContext } from "./types";
import { createLogger } from "@ralphschuler/screeps-core";
import { memoryManager } from "../memory/manager";

const logger = createLogger("UtilityBehaviors");

// =============================================================================
// Empire / Intel Helpers
// =============================================================================

/**
 * Record intelligence about a room.
 * OPTIMIZATION: Only do full scan if room hasn't been scouted recently (500 ticks).
 * This reduces expensive terrain scanning and room.find() calls.
 */
function recordRoomIntel(room: Room, empire: EmpireMemory): void {
  const knownRooms = empire.knownRooms;

  const existingIntel = knownRooms[room.name];
  const lastSeen = existingIntel?.lastSeen ?? 0;
  const ticksSinceLastScan = Game.time - lastSeen;

  // If room was recently scanned (within 2000 ticks), only update dynamic data
  // OPTIMIZATION: Increased from 1000 to 2000 ticks to reduce CPU on frequent rescans
  // Scouts were causing high CPU usage due to too-frequent terrain analysis
  if (existingIntel && ticksSinceLastScan < 2000) {
    existingIntel.lastSeen = Game.time;
    
    // Only update threat level (dynamic data)
    // Use safeFind to handle engine errors with corrupted owner data
    const hostiles = safeFind(room, FIND_HOSTILE_CREEPS);
    existingIntel.threatLevel = hostiles.length > 5 ? 3 : hostiles.length > 2 ? 2 : hostiles.length > 0 ? 1 : 0;
    
    // Update controller level if it changed
    if (room.controller) {
      existingIntel.controllerLevel = room.controller.level ?? 0;
      if (room.controller.owner?.username) existingIntel.owner = room.controller.owner.username;
      if (room.controller.reservation?.username) existingIntel.reserver = room.controller.reservation.username;
    }
    
    return;
  }

  // Full scan for new rooms or rooms not scanned in 2000+ ticks
  const sources = room.find(FIND_SOURCES);
  const mineral = room.find(FIND_MINERALS)[0];
  const controller = room.controller;
  // Use safeFind to handle engine errors with corrupted owner data
  const hostiles = safeFind(room, FIND_HOSTILE_CREEPS);

  // Classify terrain (expensive operation, only do once per 2000 ticks)
  // OPTIMIZATION: Sample fewer tiles (every 10 instead of every 5) to reduce CPU cost
  const terrain = room.getTerrain();
  let swampCount = 0;
  let plainCount = 0;
  for (let x = 5; x < 50; x += 10) {
    for (let y = 5; y < 50; y += 10) {
      const t = terrain.get(x, y);
      if (t === TERRAIN_MASK_SWAMP) swampCount++;
      else if (t === 0) plainCount++;
    }
  }
  const terrainType = swampCount > plainCount * 2 ? "swamp" : plainCount > swampCount * 2 ? "plains" : "mixed";

  // Check for highway/source keeper rooms
  const coordMatch = room.name.match(/^[WE](\d+)[NS](\d+)$/);
  const isHighway = coordMatch
    ? parseInt(coordMatch[1]!, 10) % 10 === 0 || parseInt(coordMatch[2]!, 10) % 10 === 0
    : false;
  const isSK = room.find(FIND_STRUCTURES, { filter: s => s.structureType === STRUCTURE_KEEPER_LAIR }).length > 0;

  const intel: RoomIntel = {
    name: room.name,
    lastSeen: Game.time,
    sources: sources.length,
    controllerLevel: controller?.level ?? 0,
    threatLevel: hostiles.length > 5 ? 3 : hostiles.length > 2 ? 2 : hostiles.length > 0 ? 1 : 0,
    scouted: true,
    terrain: terrainType,
    isHighway,
    isSK
  };

  if (controller?.owner?.username) intel.owner = controller.owner.username;
  if (controller?.reservation?.username) intel.reserver = controller.reservation.username;
  if (mineral?.mineralType) intel.mineralType = mineral.mineralType;

  knownRooms[room.name] = intel;
}

/**
 * Find the next unexplored adjacent room.
 * Avoids the previous room to prevent cycling between two rooms.
 */
function findNextExploreTarget(
  currentRoom: string,
  empire: EmpireMemory,
  previousRoom?: string
): string | undefined {
  const knownRooms = empire.knownRooms;
  const exits = Game.map.describeExits(currentRoom);
  if (!exits) return undefined;

  const candidates: { room: string; lastSeen: number }[] = [];

  for (const [, roomName] of Object.entries(exits)) {
    // Skip the previous room to prevent cycling
    if (previousRoom && roomName === previousRoom) continue;

    const lastSeen = knownRooms[roomName]?.lastSeen ?? 0;
    if (Game.time - lastSeen > 1000) {
      candidates.push({ room: roomName, lastSeen });
    }
  }

  candidates.sort((a, b) => a.lastSeen - b.lastSeen);
  return candidates[0]?.room;
}

/**
 * Room center coordinates for scout navigation
 */
const ROOM_CENTER_X = 25;
const ROOM_CENTER_Y = 25;

/**
 * Create a moveTo action targeting the center of a room.
 * Used to move scouts off room exits.
 */
function moveToRoomCenter(roomName: string): CreepAction {
  return {
    type: "moveTo",
    target: new RoomPosition(ROOM_CENTER_X, ROOM_CENTER_Y, roomName)
  };
}

/**
 * Find a position to explore in a room.
 */
function findExplorePosition(room: Room): RoomPosition | null {
  const positions = [
    new RoomPosition(5, 5, room.name),
    new RoomPosition(44, 5, room.name),
    new RoomPosition(5, 44, room.name),
    new RoomPosition(44, 44, room.name),
    new RoomPosition(ROOM_CENTER_X, ROOM_CENTER_Y, room.name)
  ];

  const terrain = room.getTerrain();
  for (const pos of positions) {
    if (terrain.get(pos.x, pos.y) !== TERRAIN_MASK_WALL) {
      return pos;
    }
  }

  return null;
}

// =============================================================================
// Role Behaviors
// =============================================================================

/**
 * Scout - Explore and map rooms.
 *
 * REFACTORED: Simplified movement strategy to prevent exit cycling:
 * 1. Always prioritize moving off exits when on one
 * 2. When at target room and off exit, explore
 * 3. When done exploring, pick next target avoiding last explored room
 * 
 * OPTIMIZATION: Only record intel once when reaching explore position
 */
export function scout(ctx: CreepContext): CreepAction {
  const empire = memoryManager.getEmpire();
  const onExit = isExit(ctx.creep.pos);

  // PRIORITY 1: Always move off exits immediately
  // This prevents all cycling issues by ensuring we're never stuck on exit tiles
  if (onExit) {
    return moveToRoomCenter(ctx.room.name);
  }

  // Track the last room we fully explored (not just passed through)
  const lastExploredRoom = ctx.memory.lastExploredRoom;

  // Find or assign target room
  let targetRoom = ctx.memory.targetRoom;

  // If no target, find next room to explore
  if (!targetRoom) {
    targetRoom = findNextExploreTarget(ctx.room.name, empire, lastExploredRoom);
    if (targetRoom) {
      ctx.memory.targetRoom = targetRoom;
    } else {
      // No valid target found - clear both to expand search
      delete ctx.memory.targetRoom;
      delete ctx.memory.lastExploredRoom;
      // Stay idle in current room
      return { type: "idle" };
    }
  }

  // If traveling to a different room, move there
  if (targetRoom && ctx.room.name !== targetRoom) {
    return { type: "moveToRoom", roomName: targetRoom };
  }

  // We're at target room - explore it
  if (targetRoom && ctx.room.name === targetRoom) {
    const explorePos = findExplorePosition(ctx.room);
    if (explorePos) {
      const INTEL_GATHER_RANGE = 3;
      if (ctx.creep.pos.getRangeTo(explorePos) <= INTEL_GATHER_RANGE) {
        // At explore position - record intel
        recordRoomIntel(ctx.room, empire);
        ctx.memory.lastExploredRoom = ctx.room.name;
        delete ctx.memory.targetRoom; // Done exploring
        return { type: "idle" };
      } else {
        // Move to explore position
        return { type: "moveTo", target: explorePos };
      }
    } else {
      // No valid explore position - record intel and move on
      recordRoomIntel(ctx.room, empire);
      ctx.memory.lastExploredRoom = ctx.room.name;
      delete ctx.memory.targetRoom;
      return { type: "idle" };
    }
  }

  return { type: "idle" };
}

/**
 * Claimer - Claim or reserve room controllers.
 * Task can be: "claim", "reserve", or "attack"
 */
export function claimer(ctx: CreepContext): CreepAction {
  const targetRoom = ctx.memory.targetRoom;

  if (!targetRoom) {
    const spawns = ctx.spawnStructures.filter(s => s.structureType === STRUCTURE_SPAWN);
    if (spawns.length > 0) {
      const spawn = findCachedClosest(ctx.creep, spawns, "claimer_spawn", 20);
      if (spawn) return { type: "moveTo", target: spawn };
    }
    return { type: "idle" };
  }

  // PRIORITY: Always move off exits immediately to prevent cycling between rooms
  const onExit = isExit(ctx.creep.pos);
  if (onExit) {
    return moveToRoomCenter(ctx.room.name);
  }

  // Move to target room
  if (ctx.room.name !== targetRoom) {
    return { type: "moveToRoom", roomName: targetRoom };
  }

  // Act on controller
  const controller = ctx.room.controller;
  if (!controller) return { type: "idle" };

  const task = ctx.memory.task;
  if (task === "claim") return { type: "claim", target: controller };
  if (task === "attack") return { type: "attackController", target: controller };
  return { type: "reserve", target: controller }; // default
}

/**
 * Engineer - Repairs and fortification specialist.
 * Priority: critical structures → infrastructure → ramparts → walls → construction
 */
export function engineer(ctx: CreepContext): CreepAction {
  // Update working state
  if (ctx.isEmpty) ctx.memory.working = false;
  if (ctx.isFull) ctx.memory.working = true;

  if (ctx.memory.working) {
    // Critical structures (low HP spawns, towers, storage)
    // OPTIMIZATION: Use cached repair targets from context if available, otherwise filter from allStructures
    // Note: repairTargets in context are already filtered, but we need specific types here
    const criticalStructures = ctx.repairTargets.filter(
      s =>
        (s.structureType === STRUCTURE_SPAWN ||
          s.structureType === STRUCTURE_TOWER ||
          s.structureType === STRUCTURE_STORAGE) &&
        s.hits < s.hitsMax * 0.5
    );
    if (criticalStructures.length > 0) {
      const critical = findCachedClosest(ctx.creep, criticalStructures, "engineer_critical", 5);
      if (critical) return { type: "repair", target: critical };
    }

    // Roads and containers
    const infrastructure = ctx.repairTargets.filter(
      s =>
        (s.structureType === STRUCTURE_ROAD || s.structureType === STRUCTURE_CONTAINER) &&
        s.hits < s.hitsMax * 0.75
    );
    if (infrastructure.length > 0) {
      const infra = findCachedClosest(ctx.creep, infrastructure, "engineer_infra", 5);
      if (infra) return { type: "repair", target: infra };
    }

    // Ramparts and walls - target based on danger level
    // danger 0: 100k, danger 1: 300k, danger 2: 5M, danger 3: 50M
    const danger = ctx.swarmState?.danger ?? 0;
    const repairTarget = danger === 0 ? 100000 : danger === 1 ? 300000 : danger === 2 ? 5000000 : 50000000;

    const ramparts = ctx.repairTargets.filter(
      s => s.structureType === STRUCTURE_RAMPART && s.hits < repairTarget
    );
    if (ramparts.length > 0) {
      const rampart = findCachedClosest(ctx.creep, ramparts, "engineer_rampart", 5);
      if (rampart) return { type: "repair", target: rampart };
    }

    // Walls
    const walls = ctx.repairTargets.filter(
      s => s.structureType === STRUCTURE_WALL && s.hits < repairTarget
    );
    if (walls.length > 0) {
      const wall = findCachedClosest(ctx.creep, walls, "engineer_wall", 5);
      if (wall) return { type: "repair", target: wall };
    }

    // Construction sites
    if (ctx.prioritizedSites.length > 0) {
      return { type: "build", target: ctx.prioritizedSites[0]! };
    }

    return { type: "idle" };
  }

  // Get energy
  if (ctx.storage && ctx.storage.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
    return { type: "withdraw", target: ctx.storage, resourceType: RESOURCE_ENERGY };
  }

  // OPTIMIZATION: Use cached closest for containers (cache 15 ticks - stable targets)
  // BUGFIX: Filter by capacity HERE for fresh state, not in room cache
  const containersWithEnergy = ctx.containers.filter(
    c => c.store.getUsedCapacity(RESOURCE_ENERGY) > 100
  );
  if (containersWithEnergy.length > 0) {
    const closest = findCachedClosest(ctx.creep, containersWithEnergy, "engineer_cont", 15);
    if (closest) return { type: "withdraw", target: closest, resourceType: RESOURCE_ENERGY };
  }

  return { type: "idle" };
}

/**
 * RemoteWorker - Harvest in remote rooms.
 */
export function remoteWorker(ctx: CreepContext): CreepAction {
  const targetRoom = ctx.memory.targetRoom ?? ctx.homeRoom;

  // Update working state
  if (ctx.isEmpty) ctx.memory.working = false;
  if (ctx.isFull) ctx.memory.working = true;

  if (ctx.memory.working) {
    // Return home to deliver
    if (ctx.room.name !== ctx.homeRoom) {
      return { type: "moveToRoom", roomName: ctx.homeRoom };
    }

    // Deliver to storage (preferred) or spawn
    if (ctx.storage) {
      return { type: "transfer", target: ctx.storage, resourceType: RESOURCE_ENERGY };
    }

    const spawns = ctx.spawnStructures.filter(s => s.structureType === STRUCTURE_SPAWN);
    if (spawns.length > 0) {
      const spawn = findCachedClosest(ctx.creep, spawns, "remoteWorker_spawn", 5);
      if (spawn) {
        return { type: "transfer", target: spawn, resourceType: RESOURCE_ENERGY };
      }
    }

    return { type: "idle" };
  }

  // Go to remote room and harvest
  if (ctx.room.name !== targetRoom) {
    return { type: "moveToRoom", roomName: targetRoom };
  }

  const source = ctx.creep.pos.findClosestByRange(FIND_SOURCES_ACTIVE);
  if (source) return { type: "harvest", target: source };

  return { type: "idle" };
}

/**
 * LinkManager - Transfer energy between links and storage.
 */
export function linkManager(ctx: CreepContext): CreepAction {
  const links = ctx.room.find(FIND_MY_STRUCTURES, {
    filter: s => s.structureType === STRUCTURE_LINK
  }) as StructureLink[];

  if (links.length < 2 || !ctx.storage) return { type: "idle" };

  const storageLink = links.find(l => l.pos.getRangeTo(ctx.storage!) <= 2);
  if (!storageLink) return { type: "idle" };

  // Empty storage link when it has energy
  if (storageLink.store.getUsedCapacity(RESOURCE_ENERGY) > 400) {
    if (ctx.creep.store.getFreeCapacity() > 0) {
      return { type: "withdraw", target: storageLink, resourceType: RESOURCE_ENERGY };
    }
    return { type: "transfer", target: ctx.storage, resourceType: RESOURCE_ENERGY };
  }

  // Wait near storage
  if (ctx.creep.pos.getRangeTo(ctx.storage) > 2) {
    return { type: "moveTo", target: ctx.storage };
  }

  return { type: "idle" };
}

/**
 * TerminalManager - Balance resources between storage and terminal.
 */
export function terminalManager(ctx: CreepContext): CreepAction {
  if (!ctx.terminal || !ctx.storage) return { type: "idle" };

  const terminalEnergy = ctx.terminal.store.getUsedCapacity(RESOURCE_ENERGY);
  const storageEnergy = ctx.storage.store.getUsedCapacity(RESOURCE_ENERGY);
  const targetTerminalEnergy = 50000;

  // Deliver carried resources
  if (ctx.creep.store.getUsedCapacity() > 0) {
    const resourceType = Object.keys(ctx.creep.store)[0] as ResourceConstant;

    if (resourceType === RESOURCE_ENERGY) {
      if (terminalEnergy < targetTerminalEnergy) {
        return { type: "transfer", target: ctx.terminal, resourceType: RESOURCE_ENERGY };
      }
      return { type: "transfer", target: ctx.storage, resourceType: RESOURCE_ENERGY };
    }

    // Non-energy goes to terminal for trading
    return { type: "transfer", target: ctx.terminal, resourceType };
  }

  // Balance energy between storage and terminal
  if (terminalEnergy < targetTerminalEnergy - 10000 && storageEnergy > 20000) {
    return { type: "withdraw", target: ctx.storage, resourceType: RESOURCE_ENERGY };
  }
  if (terminalEnergy > targetTerminalEnergy + 10000) {
    return { type: "withdraw", target: ctx.terminal, resourceType: RESOURCE_ENERGY };
  }

  // Move excess minerals from storage to terminal
  for (const resourceType of Object.keys(ctx.storage.store) as ResourceConstant[]) {
    if (resourceType !== RESOURCE_ENERGY && ctx.storage.store.getUsedCapacity(resourceType) > 5000) {
      return { type: "withdraw", target: ctx.storage, resourceType };
    }
  }

  // Wait near storage
  if (ctx.creep.pos.getRangeTo(ctx.storage) > 2) {
    return { type: "moveTo", target: ctx.storage };
  }

  return { type: "idle" };
}

// =============================================================================
// Role Dispatcher
// =============================================================================

const utilityBehaviors: Record<string, (ctx: CreepContext) => CreepAction> = {
  scout,
  claimer,
  engineer,
  remoteWorker,
  linkManager,
  terminalManager
};

/**
 * Evaluate and return an action for a utility role creep.
 */
export function evaluateUtilityBehavior(ctx: CreepContext): CreepAction {
  const behavior = utilityBehaviors[ctx.memory.role] ?? scout;
  return behavior(ctx);
}
