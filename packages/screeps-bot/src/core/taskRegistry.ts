/**
 * Task Registry
 *
 * Centralizes registration of all scheduled tasks with the scheduler.
 * Ensures all managers and subsystems are properly integrated.
 *
 * Addresses Issue: #30
 */

import { createLowFrequencyTask, createMediumFrequencyTask, scheduler } from "./scheduler";
import type { SwarmState } from "../memory/schemas";
import { empireManager } from "../empire/empireManager";
import { clusterManager } from "../clusters/clusterManager";
import { marketManager } from "../empire/marketManager";
import { nukeManager } from "../empire/nukeManager";
import { powerBankHarvestingManager } from "../empire/powerBankHarvesting";
import { pheromoneManager } from "../logic/pheromone";
import { memoryManager } from "../memory/manager";
import { shardManager } from "../intershard/shardManager";
import { evacuationManager } from "../defense/evacuationManager";
import { labConfigManager } from "../labs/labConfig";
import { memorySegmentStats } from "./memorySegmentStats";
import { globalPathCache } from "../utils/globalPathCache";
import { logger } from "./logger";

/**
 * Register all scheduled tasks
 */
export function registerAllTasks(): void {
  logger.info("Registering scheduled tasks...", { subsystem: "TaskRegistry" });

  // Empire Manager - Global strategic coordination (every 30 ticks)
  scheduler.registerTask({
    ...createLowFrequencyTask("empireManager", () => empireManager.run(), 80),
    interval: 30,
    minBucket: 5000,
    cpuBudget: 0.05
  });

  // Cluster Manager - Multi-room coordination (every 10 ticks)
  scheduler.registerTask({
    ...createMediumFrequencyTask("clusterManager", () => clusterManager.run(), 70),
    interval: 10,
    minBucket: 3000,
    cpuBudget: 0.03
  });

  // Market Manager - Trading automation (every 100 ticks)
  scheduler.registerTask({
    ...createLowFrequencyTask("marketManager", () => marketManager.run(), 40),
    interval: 100,
    minBucket: 7000,
    cpuBudget: 0.02
  });

  // Nuke Manager - Nuclear warfare (every 500 ticks)
  scheduler.registerTask({
    ...createLowFrequencyTask("nukeManager", () => nukeManager.run(), 30),
    interval: 500,
    minBucket: 8000,
    cpuBudget: 0.01
  });

  // Pheromone Diffusion - Inter-room communication (every 10 ticks)
  scheduler.registerTask({
    ...createMediumFrequencyTask(
      "pheromoneDiffusion",
      () => {
        const ownedRooms = Object.values(Game.rooms).filter(r => r.controller?.my);
        const swarmStates = new Map<string, SwarmState>();
        for (const room of ownedRooms) {
          const state = memoryManager.getSwarmState(room.name);
          if (state) {
            swarmStates.set(room.name, state);
          }
        }
        pheromoneManager.applyDiffusion(swarmStates);
      },
      60
    ),
    interval: 10,
    minBucket: 2000,
    cpuBudget: 0.02
  });

  // Memory Cleanup - Remove dead creeps (every 50 ticks)
  scheduler.registerTask({
    ...createLowFrequencyTask(
      "memoryCleanup",
      () => {
        for (const name in Memory.creeps) {
          if (!Game.creeps[name]) {
            delete Memory.creeps[name];
          }
        }
      },
      20
    ),
    interval: 50,
    minBucket: 1000,
    cpuBudget: 0.01
  });

  // Memory Size Check - Monitor usage (every 100 ticks)
  scheduler.registerTask({
    ...createLowFrequencyTask(
      "memorySizeCheck",
      () => {
        const used = RawMemory.get().length;
        const limit = 2 * 1024 * 1024; // 2MB
        const percentage = (used / limit) * 100;

        if (percentage > 90) {
          logger.error(`Memory usage critical: ${percentage.toFixed(1)}% (${used}/${limit} bytes)`, {
            subsystem: "Memory"
          });
        } else if (percentage > 75) {
          logger.warn(`Memory usage high: ${percentage.toFixed(1)}% (${used}/${limit} bytes)`, {
            subsystem: "Memory"
          });
        }
      },
      10
    ),
    interval: 100,
    minBucket: 1000,
    cpuBudget: 0.005
  });

  // Shard Manager - Multi-shard coordination (every 100 ticks)
  scheduler.registerTask({
    ...createLowFrequencyTask("shardManager", () => shardManager.run(), 35),
    interval: 100,
    minBucket: 5000,
    cpuBudget: 0.02
  });

  // Evacuation Manager - Room evacuation (every 5 ticks)
  scheduler.registerTask({
    ...createMediumFrequencyTask("evacuationManager", () => evacuationManager.run(), 75),
    interval: 5,
    minBucket: 2000,
    cpuBudget: 0.02
  });

  // Power Bank Harvesting Manager (every 50 ticks)
  scheduler.registerTask({
    ...createLowFrequencyTask("powerBankHarvesting", () => powerBankHarvestingManager.run(), 25),
    interval: 50,
    minBucket: 7000,
    cpuBudget: 0.02
  });

  // Lab Config Manager - Initialize lab configurations (every 200 ticks)
  scheduler.registerTask({
    ...createLowFrequencyTask(
      "labConfigInit",
      () => {
        const ownedRooms = Object.values(Game.rooms).filter(r => r.controller?.my);
        for (const room of ownedRooms) {
          labConfigManager.initialize(room.name);
        }
      },
      15
    ),
    interval: 200,
    minBucket: 3000,
    cpuBudget: 0.01
  });

  // Memory Segment Stats - Update stats (every 10 ticks)
  scheduler.registerTask({
    ...createMediumFrequencyTask("memorySegmentStats", () => memorySegmentStats.run(), 5),
    interval: 10,
    minBucket: 2000,
    cpuBudget: 0.01
  });

  // Path Cache Precaching - Pre-cache room paths (every 1000 ticks)
  scheduler.registerTask({
    ...createLowFrequencyTask(
      "pathCachePrecache",
      () => {
        const ownedRooms = Object.values(Game.rooms).filter(r => r.controller?.my);
        for (const room of ownedRooms) {
          globalPathCache.precacheRoomPaths(room.name);
        }
      },
      5
    ),
    interval: 1000,
    minBucket: 8000,
    cpuBudget: 0.03
  });

  logger.info(`Registered ${scheduler.getTasks().length} scheduled tasks`, { subsystem: "TaskRegistry" });
}

/**
 * Unregister all tasks (for testing/reset)
 */
export function unregisterAllTasks(): void {
  const tasks = scheduler.getTasks();
  for (const task of tasks) {
    scheduler.unregisterTask(task.name);
  }
  logger.info("Unregistered all scheduled tasks", { subsystem: "TaskRegistry" });
}
