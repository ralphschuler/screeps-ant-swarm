/**
 * Shard Manager - Multi-Shard Coordination
 *
 * Manages shard-specific strategies:
 * - Shard role assignment (core, frontier, resource, backup, war)
 * - CPU limit distribution via Game.cpu.setShardLimits
 * - Shard health monitoring
 * - Inter-shard communication strategy
 *
 * Addresses Issue: #7
 */

import type {
  InterShardMemorySchema,
  InterShardTask,
  PortalInfo,
  ShardHealthMetrics,
  ShardRole,
  ShardState
} from "./schema";
import {
  INTERSHARD_MEMORY_LIMIT,
  createDefaultInterShardMemory,
  createDefaultShardState,
  deserializeInterShardMemory,
  serializeInterShardMemory
} from "./schema";
import { logger } from "../core/logger";
import { LowFrequencyProcess, ProcessClass } from "../core/processDecorators";
import { ProcessPriority } from "../core/kernel";

/**
 * Shard Manager Configuration
 */
export interface ShardManagerConfig {
  /** Update interval in ticks */
  updateInterval: number;
  /** Minimum bucket to run shard logic */
  minBucket: number;
  /** Maximum CPU budget per tick */
  maxCpuBudget: number;
  /** Default CPU limit per shard */
  defaultCpuLimit: number;
}

const DEFAULT_CONFIG: ShardManagerConfig = {
  updateInterval: 100,
  minBucket: 5000,
  maxCpuBudget: 0.02,
  defaultCpuLimit: 20
};

/**
 * CPU distribution based on shard role
 */
const ROLE_CPU_WEIGHTS: Record<ShardRole, number> = {
  core: 1.5, // Core shards get more CPU
  frontier: 0.8, // Frontier shards get less
  resource: 1.0, // Resource shards get standard
  backup: 0.5, // Backup shards get minimal
  war: 1.2 // War shards get above average
};

/**
 * Shard Manager Class
 */
@ProcessClass()
export class ShardManager {
  private config: ShardManagerConfig;
  private lastRun = 0;
  private interShardMemory: InterShardMemorySchema;

  public constructor(config: Partial<ShardManagerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.interShardMemory = createDefaultInterShardMemory();
  }

  /**
   * Initialize shard manager - load from InterShardMemory
   */
  public initialize(): void {
    try {
      const rawData = InterShardMemory.getLocal();
      if (rawData) {
        const parsed = deserializeInterShardMemory(rawData);
        if (parsed) {
          this.interShardMemory = parsed;
          logger.debug("Loaded InterShardMemory", { subsystem: "Shard" });
        }
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error(`Failed to load InterShardMemory: ${errorMessage}`, { subsystem: "Shard" });
    }

    // Ensure current shard is tracked
    const currentShard = Game.shard?.name ?? "shard0";
    if (!this.interShardMemory.shards[currentShard]) {
      this.interShardMemory.shards[currentShard] = createDefaultShardState(currentShard);
    }
  }

  /**
   * Main shard tick - runs periodically
   * Registered as kernel process via decorator
   */
  @LowFrequencyProcess("empire:shard", "Shard Manager", {
    priority: ProcessPriority.LOW,
    interval: 100,
    minBucket: 5000,
    cpuBudget: 0.02
  })
  public run(): void {
    this.lastRun = Game.time;

    // Update current shard health
    this.updateCurrentShardHealth();

    // Check and process inter-shard tasks
    this.processInterShardTasks();

    // Scan for portals
    this.scanForPortals();

    // Auto-assign shard role if needed
    this.autoAssignShardRole();

    // Distribute CPU limits if on multi-shard
    if (Object.keys(this.interShardMemory.shards).length > 1) {
      this.distributeCpuLimits();
    }

    // Sync with other shards
    this.syncInterShardMemory();

    // Log status periodically
    if (Game.time % 500 === 0) {
      this.logShardStatus();
    }
  }

  /**
   * Update current shard's health metrics
   */
  private updateCurrentShardHealth(): void {
    const currentShard = Game.shard?.name ?? "shard0";
    const shardState = this.interShardMemory.shards[currentShard];
    if (!shardState) return;

    const ownedRooms = Object.values(Game.rooms).filter(r => r.controller?.my);

    // Calculate health metrics
    const cpuUsage = Game.cpu.getUsed() / Game.cpu.limit;
    const cpuCategory: ShardHealthMetrics["cpuCategory"] =
      cpuUsage < 0.5 ? "low" : cpuUsage < 0.75 ? "medium" : cpuUsage < 0.9 ? "high" : "critical";

    const avgRCL =
      ownedRooms.length > 0
        ? ownedRooms.reduce((sum, r) => sum + (r.controller?.level ?? 0), 0) / ownedRooms.length
        : 0;

    // Calculate economy index (0-100)
    let economyIndex = 0;
    for (const room of ownedRooms) {
      const storage = room.storage;
      if (storage) {
        const energy = storage.store.getUsedCapacity(RESOURCE_ENERGY);
        economyIndex += Math.min(100, energy / 5000);
      }
    }
    economyIndex = ownedRooms.length > 0 ? economyIndex / ownedRooms.length : 0;

    // Calculate war index based on danger levels
    let warIndex = 0;
    for (const room of ownedRooms) {
      const hostiles = room.find(FIND_HOSTILE_CREEPS).length;
      warIndex += Math.min(100, hostiles * 10);
    }
    warIndex = ownedRooms.length > 0 ? warIndex / ownedRooms.length : 0;

    // Update health metrics
    shardState.health = {
      cpuCategory,
      economyIndex: Math.round(economyIndex),
      warIndex: Math.round(warIndex),
      commodityIndex: 0, // TODO: Calculate based on factory production
      roomCount: ownedRooms.length,
      avgRCL: Math.round(avgRCL * 10) / 10,
      creepCount: Object.keys(Game.creeps).length,
      lastUpdate: Game.time
    };
  }

  /**
   * Process inter-shard tasks
   */
  private processInterShardTasks(): void {
    const currentShard = Game.shard?.name ?? "shard0";
    const tasks = this.interShardMemory.tasks.filter(
      t => t.targetShard === currentShard && t.status === "pending"
    );

    for (const task of tasks) {
      switch (task.type) {
        case "colonize":
          this.handleColonizeTask(task);
          break;
        case "reinforce":
          this.handleReinforceTask(task);
          break;
        case "transfer":
          this.handleTransferTask(task);
          break;
        case "evacuate":
          this.handleEvacuateTask(task);
          break;
      }
    }

    // Clean up completed/failed tasks older than 5000 ticks
    this.interShardMemory.tasks = this.interShardMemory.tasks.filter(
      t => t.status === "pending" || t.status === "active" || Game.time - t.createdAt < 5000
    );
  }

  /**
   * Handle colonize task
   */
  private handleColonizeTask(task: InterShardTask): void {
    // Mark task as active
    task.status = "active";
    const targetRoom = task.targetRoom ?? 'unknown';
    logger.info(`Processing colonize task: ${targetRoom} from ${task.sourceShard}`, {
      subsystem: "Shard"
    });
  }

  /**
   * Handle reinforce task
   */
  private handleReinforceTask(task: InterShardTask): void {
    task.status = "active";
    const targetRoom = task.targetRoom ?? 'unknown';
    logger.info(`Processing reinforce task: ${targetRoom} from ${task.sourceShard}`, {
      subsystem: "Shard"
    });
  }

  /**
   * Handle transfer task
   */
  private handleTransferTask(task: InterShardTask): void {
    task.status = "active";
    logger.info(`Processing transfer task from ${task.sourceShard}`, { subsystem: "Shard" });
  }

  /**
   * Handle evacuate task
   */
  private handleEvacuateTask(task: InterShardTask): void {
    task.status = "active";
    const targetRoom = task.targetRoom ?? 'unknown';
    logger.info(`Processing evacuate task: ${targetRoom} to ${task.targetShard}`, {
      subsystem: "Shard"
    });
  }

  /**
   * Scan for portals in visible rooms
   */
  private scanForPortals(): void {
    const currentShard = Game.shard?.name ?? "shard0";
    const shardState = this.interShardMemory.shards[currentShard];
    if (!shardState) return;

    for (const roomName in Game.rooms) {
      const room = Game.rooms[roomName];
      const foundPortals = room.find(FIND_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_PORTAL
      });
      const portals = foundPortals as StructurePortal[];

      for (const portal of portals) {
        // Check if portal leads to another shard
        const destination = portal.destination;
        if (!destination) continue;

        // Check if it's an inter-shard portal (destination is RoomPosition on different shard)
        if ("shard" in destination) {
          const targetShard = (destination as { shard: string }).shard;
          const targetRoom = (destination as { room: string }).room;

          // Check if already tracked
          const existing = shardState.portals.find(
            p => p.sourceRoom === roomName && p.targetShard === targetShard
          );

          if (!existing) {
            const portalInfo: PortalInfo = {
              sourceRoom: roomName,
              sourcePos: { x: portal.pos.x, y: portal.pos.y },
              targetShard,
              targetRoom,
              threatRating: 0,
              lastScouted: Game.time
            };

            // Check for decay tick on unstable portals
            if (portal.ticksToDecay !== undefined) {
              portalInfo.decayTick = Game.time + portal.ticksToDecay;
            }

            shardState.portals.push(portalInfo);
            logger.info(`Discovered portal in ${roomName} to ${targetShard}/${targetRoom}`, {
              subsystem: "Shard"
            });
          }
        }
      }
    }

    // Clean up expired portals
    shardState.portals = shardState.portals.filter(
      p => !p.decayTick || p.decayTick > Game.time
    );
  }

  /**
   * Auto-assign shard role based on metrics
   */
  private autoAssignShardRole(): void {
    const currentShard = Game.shard?.name ?? "shard0";
    const shardState = this.interShardMemory.shards[currentShard];
    if (!shardState) return;

    // Only auto-assign if role is default "core"
    if (shardState.role !== "core") return;

    const health = shardState.health;

    // Determine role based on metrics
    let newRole: ShardRole = "core";

    if (health.warIndex > 50) {
      newRole = "war";
    } else if (health.roomCount < 3 && health.avgRCL < 4) {
      newRole = "frontier";
    } else if (health.economyIndex > 70 && health.roomCount >= 3) {
      newRole = "resource";
    } else if (Object.keys(this.interShardMemory.shards).length > 1 && health.roomCount < 2) {
      newRole = "backup";
    }

    if (newRole !== shardState.role) {
      shardState.role = newRole;
      logger.info(`Auto-assigned shard role: ${newRole}`, { subsystem: "Shard" });
    }
  }

  /**
   * Distribute CPU limits across shards based on roles
   */
  private distributeCpuLimits(): void {
    try {
      const shards = this.interShardMemory.shards;
      const shardNames = Object.keys(shards);
      const totalCpu = Game.cpu.shardLimits
        ? Object.values(Game.cpu.shardLimits).reduce((sum, cpu) => sum + cpu, 0)
        : this.config.defaultCpuLimit * shardNames.length;

      // Calculate weighted distribution
      let totalWeight = 0;
      for (const name of shardNames) {
        const shard = shards[name];
        if (shard) {
          totalWeight += ROLE_CPU_WEIGHTS[shard.role];
        }
      }

      // Build new limits
      const newLimits: { [shard: string]: number } = {};
      for (const name of shardNames) {
        const shard = shards[name];
        if (shard) {
          const weight = ROLE_CPU_WEIGHTS[shard.role];
          newLimits[name] = Math.max(5, Math.round((weight / totalWeight) * totalCpu));
        }
      }

      // Only update if different from current
      if (Game.cpu.shardLimits) {
        const currentLimits = Game.cpu.shardLimits;
        const needsUpdate = shardNames.some(
          name => (currentLimits[name] ?? 0) !== (newLimits[name] ?? 0)
        );

        if (needsUpdate) {
          const result = Game.cpu.setShardLimits(newLimits);
          if (result === OK) {
            logger.info(`Updated shard CPU limits: ${JSON.stringify(newLimits)}`, {
              subsystem: "Shard"
            });
          }
        }
      }
    } catch (err) {
      // setShardLimits may not be available in private servers
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.debug(`Could not set shard limits: ${errorMessage}`, { subsystem: "Shard" });
    }
  }

  /**
   * Sync InterShardMemory with other shards
   */
  private syncInterShardMemory(): void {
    try {
      this.interShardMemory.lastSync = Game.time;

      const serialized = serializeInterShardMemory(this.interShardMemory);

      // Check size limit
      if (serialized.length > INTERSHARD_MEMORY_LIMIT) {
        logger.warn(
          `InterShardMemory size exceeds limit: ${serialized.length}/${INTERSHARD_MEMORY_LIMIT}`,
          { subsystem: "Shard" }
        );
        // Trim old data if needed
        this.trimInterShardMemory();
        return;
      }

      InterShardMemory.setLocal(serialized);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error(`Failed to sync InterShardMemory: ${errorMessage}`, { subsystem: "Shard" });
    }
  }

  /**
   * Trim old data from InterShardMemory to stay under size limit
   */
  private trimInterShardMemory(): void {
    // Remove completed/failed tasks older than 1000 ticks
    this.interShardMemory.tasks = this.interShardMemory.tasks.filter(
      t => t.status === "pending" || t.status === "active" || Game.time - t.createdAt < 1000
    );

    // Remove old portal entries that haven't been scouted recently
    for (const shardName in this.interShardMemory.shards) {
      const shard = this.interShardMemory.shards[shardName];
      if (shard) {
        shard.portals = shard.portals.filter(p => Game.time - p.lastScouted < 10000);
      }
    }
  }

  /**
   * Log shard status
   */
  private logShardStatus(): void {
    const currentShard = Game.shard?.name ?? "shard0";
    const shardState = this.interShardMemory.shards[currentShard];
    if (!shardState) return;

    const health = shardState.health;
    logger.info(
      `Shard ${currentShard} (${shardState.role}): ` +
        `${health.roomCount} rooms, RCL ${health.avgRCL}, ` +
        `CPU: ${health.cpuCategory}, Eco: ${health.economyIndex}%, War: ${health.warIndex}%`,
      { subsystem: "Shard" }
    );
  }

  /**
   * Create a new inter-shard task
   */
  public createTask(
    type: InterShardTask["type"],
    targetShard: string,
    targetRoom?: string,
    priority = 50
  ): void {
    const currentShard = Game.shard?.name ?? "shard0";

    const task: InterShardTask = {
      id: `${Game.time}-${Math.random().toString(36).substring(2, 11)}`,
      type,
      sourceShard: currentShard,
      targetShard,
      priority,
      status: "pending",
      createdAt: Game.time
    };

    if (targetRoom) {
      task.targetRoom = targetRoom;
    }

    this.interShardMemory.tasks.push(task);
    logger.info(`Created inter-shard task: ${type} to ${targetShard}`, { subsystem: "Shard" });
  }

  /**
   * Get current shard state
   */
  public getCurrentShardState(): ShardState | undefined {
    const currentShard = Game.shard?.name ?? "shard0";
    return this.interShardMemory.shards[currentShard];
  }

  /**
   * Get all known shards
   */
  public getAllShards(): ShardState[] {
    return Object.values(this.interShardMemory.shards);
  }

  /**
   * Get portals to a specific shard
   */
  public getPortalsToShard(targetShard: string): PortalInfo[] {
    const currentShard = Game.shard?.name ?? "shard0";
    const shardState = this.interShardMemory.shards[currentShard];
    if (!shardState) return [];

    return shardState.portals.filter(p => p.targetShard === targetShard);
  }

  /**
   * Set shard role manually
   */
  public setShardRole(role: ShardRole): void {
    const currentShard = Game.shard?.name ?? "shard0";
    const shardState = this.interShardMemory.shards[currentShard];
    if (shardState) {
      shardState.role = role;
      logger.info(`Set shard role to: ${role}`, { subsystem: "Shard" });
    }
  }
}

/**
 * Global shard manager instance
 */
export const shardManager = new ShardManager();
