/**
 * SwarmBot - Main Bot Entry Point
 *
 * Coordinates all swarm bot subsystems:
 * - Memory initialization
 * - Room management
 * - Creep role execution
 * - Spawning
 * - Strategic decisions
 *
 * ARCHITECTURE:
 * The bot uses a central Kernel for process management:
 * - Process registration with priority and CPU budget
 * - CPU bucket-based scheduling
 * - Lifecycle management (init, run, cleanup)
 *
 * PERFORMANCE OPTIMIZATIONS:
 * - CPU bucket management with early exit when bucket is low
 * - Priority-based creep execution (critical roles first)
 * - CPU budget checks between creeps
 * - Skips non-essential creeps when CPU is limited
 */

import type { RoleFamily, SwarmCreepMemory } from "./memory/schemas";
import { profiler } from "./core/profiler";
import { roomManager } from "./core/roomNode";
import { runSpawnManager } from "./logic/spawn";
import { memoryManager } from "./memory/manager";
import { runEconomyRole } from "./roles/economy";
import { runMilitaryRole } from "./roles/military";
import { runPowerCreepRole, runPowerRole } from "./roles/power";
import { runUtilityRole } from "./roles/utility";
import { clearRoomCaches } from "./roles/behaviors/context";
import { finalizeMovement, initMovement } from "./utils/movement";
import { clearMoveRequests, processMoveRequests } from "./utils/trafficManager";
import { kernel } from "./core/kernel";
import { registerAllProcesses } from "./core/processRegistry";
import { roomVisualizer } from "./visuals/roomVisualizer";
import { memorySegmentStats } from "./core/memorySegmentStats";
import { getConfig } from "./config";
import { LogLevel, configureLogger, logger } from "./core/logger";
import { canSkipBehaviorEvaluation, executeIdleAction } from "./utils/idleDetection";

// =============================================================================
// Role Priority Configuration
// =============================================================================

/** Role priorities - higher values = run first */
const ROLE_PRIORITY: Record<string, number> = {
  // Critical economy roles
  harvester: 100,
  queenCarrier: 95,
  hauler: 90,

  // Military (always important)
  defender: 85,
  rangedDefender: 84,
  healer: 83,

  // Standard economy
  larvaWorker: 70,
  builder: 60,
  upgrader: 50,

  // Utility
  scout: 40,
  claimer: 35,
  remoteHarvester: 30,
  remoteHauler: 25,

  // Low priority
  mineralHarvester: 20,
  depositHarvester: 15,
  labTech: 10,
  factoryWorker: 5
};

const DEFAULT_PRIORITY = 50;
const LOW_PRIORITY_THRESHOLD = 50;

const PRIORITY_ORDER = Array.from(
  new Set([...Object.values(ROLE_PRIORITY), DEFAULT_PRIORITY])
).sort((a, b) => b - a);

const PRIORITY_INDEX: Record<number, number> = PRIORITY_ORDER.reduce(
  (acc, priority, index) => {
    acc[priority] = index;
    return acc;
  },
  {} as Record<number, number>
);

// =============================================================================
// Creep Helpers
// =============================================================================

/**
 * Get role family from creep memory
 */
function getCreepFamily(creep: Creep): RoleFamily {
  const memory = creep.memory as unknown as SwarmCreepMemory;
  return memory.family ?? "economy";
}

/**
 * Get role priority for a creep (higher = runs first)
 */
function getCreepPriority(creep: Creep): number {
  const memory = creep.memory as unknown as SwarmCreepMemory;
  return ROLE_PRIORITY[memory.role] ?? DEFAULT_PRIORITY;
}

/**
 * Run creep based on its role family.
 * Uses idle detection to skip expensive behavior evaluation for stationary workers.
 */
function runCreep(creep: Creep): void {
  // OPTIMIZATION: Skip behavior evaluation for idle creeps
  // Idle creeps are stationary workers (harvesters, upgraders) that are actively
  // working at their station and don't need to make new decisions.
  // This saves ~0.1-0.2 CPU per skipped creep.
  if (canSkipBehaviorEvaluation(creep)) {
    executeIdleAction(creep);
    return;
  }

  const family = getCreepFamily(creep);

  switch (family) {
    case "economy":
      runEconomyRole(creep);
      break;
    case "military":
      runMilitaryRole(creep);
      break;
    case "utility":
      runUtilityRole(creep);
      break;
    case "power":
      runPowerCreepRole(creep);
      break;
    default:
      runEconomyRole(creep);
  }
}

// =============================================================================
// CPU Management (Delegated to Kernel)
// =============================================================================

/**
 * Check if we should skip non-essential work due to low bucket
 * Uses kernel's bucket mode for consistency
 */
function isLowBucket(): boolean {
  const mode = kernel.getBucketMode();
  return mode === "low" || mode === "critical";
}

/**
 * Get creeps sorted by priority without per-tick sorting cost.
 * Uses fixed priority buckets (counting sort) so scaling to thousands
 * of creeps is linear instead of O(n log n).
 * 
 * OPTIMIZATION: Pre-allocate bucket arrays to avoid repeated allocations.
 */
function getPrioritizedCreeps(skipLowPriority: boolean): {
  creeps: Creep[];
  skippedLow: number;
} {
  const buckets = PRIORITY_ORDER.map(() => [] as Creep[]);
  let skippedLow = 0;

  // Use for-in loop instead of Object.values() to avoid creating temporary array
  // More memory efficient with large creep counts (1000+)
  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    if (creep.spawning) continue;

    const priority = getCreepPriority(creep);
    if (skipLowPriority && priority < LOW_PRIORITY_THRESHOLD) {
      skippedLow++;
      continue;
    }

    const bucketIndex = PRIORITY_INDEX[priority] ?? PRIORITY_INDEX[DEFAULT_PRIORITY];
    buckets[bucketIndex].push(creep);
  }

  // Flatten buckets into single array (avoid spread operator for large arrays)
  const ordered: Creep[] = [];
  for (const bucket of buckets) {
    if (bucket.length > 0) {
      for (const creep of bucket) {
        ordered.push(creep);
      }
    }
  }

  return { creeps: ordered, skippedLow };
}

// =============================================================================
// Subsystem Runners
// =============================================================================

/**
 * Run all power creeps
 */
function runPowerCreeps(): void {
  for (const powerCreep of Object.values(Game.powerCreeps)) {
    if (powerCreep.ticksToLive !== undefined) {
      runPowerRole(powerCreep);
    }
  }
}

/**
 * Run spawn logic for all owned rooms
 */
function runSpawns(): void {
  for (const room of Object.values(Game.rooms)) {
    if (room.controller?.my) {
      const swarm = memoryManager.getSwarmState(room.name);
      if (swarm) {
        runSpawnManager(room, swarm);
      }
    }
  }
}

/**
 * Run creeps with CPU budget management.
 * Creeps are sorted by priority so critical roles run first.
 * Uses kernel for CPU budget checking with micro-batching.
 * 
 * OPTIMIZATION: CPU checks are expensive (~0.01 CPU each).
 * With 1000+ creeps, checking every creep adds 10+ CPU overhead.
 * We use micro-batching to check every N creeps instead of every creep.
 * 
 * OPTIMIZATION: Idle detection skips expensive behavior evaluation for
 * stationary workers that are actively working (harvesters at source, etc.).
 */
function runCreepsWithBudget(): void {
  const lowBucket = isLowBucket();
  const { creeps, skippedLow } = getPrioritizedCreeps(lowBucket);
  let creepsRun = 0;
  let creepsSkipped = skippedLow;

  // Micro-batch size: check CPU every N creeps
  // Smaller batches when bucket is low for tighter control
  const batchSize = lowBucket ? 5 : 10;

  for (let i = 0; i < creeps.length; i++) {
    // Check CPU budget at the start of each batch
    if (i % batchSize === 0 && !kernel.hasCpuBudget()) {
      creepsSkipped += creeps.length - creepsRun;
      break;
    }

    runCreep(creeps[i]);
    creepsRun++;
  }

  // Log statistics periodically
  const logInterval = lowBucket ? 100 : 50;
  if (Game.time % logInterval === 0 && creepsSkipped > 0) {
    logger.warn(`Skipped ${creepsSkipped} creeps due to CPU (bucket: ${Game.cpu.bucket})`, {
      subsystem: "SwarmBot"
    });
  }
}

// =============================================================================
// Main Loop
// =============================================================================

// Initialize kernel and processes on first tick
let kernelInitialized = false;
let systemsInitialized = false;

/**
 * Initialize systems that need first-tick setup
 */
function initializeSystems(): void {
  // Configure logger based on config
  const config = getConfig();
  configureLogger({
    level: config.debug ? LogLevel.DEBUG : LogLevel.INFO,
    cpuLogging: config.profiling
  });

  // Initialize memory segment stats
  memorySegmentStats.initialize();

  systemsInitialized = true;
}

/**
 * Run visualizations for all owned rooms
 */
function runVisualizations(): void {
  const config = getConfig();
  if (!config.visualizations) return;

  const ownedRooms = Object.values(Game.rooms).filter(r => r.controller?.my);
  for (const room of ownedRooms) {
    try {
      roomVisualizer.draw(room);
    } catch (err) {
      // Visualization errors shouldn't crash the main loop
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error(`Visualization error in ${room.name}: ${errorMessage}`, {
        subsystem: "visualizations",
        room: room.name
      });
    }
  }
}

/**
 * Main loop for SwarmBot
 */
export function loop(): void {
  // Initialize systems on first tick
  if (!systemsInitialized) {
    initializeSystems();
  }

  // Sync kernel CPU configuration with runtime config
  kernel.updateFromCpuConfig(getConfig().cpu);

  // Initialize kernel and register processes on first tick
  if (!kernelInitialized) {
    registerAllProcesses();
    kernel.initialize();
    kernelInitialized = true;
  }

  // Critical bucket check - use kernel's bucket mode
  const bucketMode = kernel.getBucketMode();
  if (bucketMode === "critical") {
    logger.warn(`CRITICAL: CPU bucket at ${Game.cpu.bucket}, minimal processing`, {
      subsystem: "SwarmBot"
    });
    // Only run movement finalization to prevent stuck creeps
    initMovement();
    clearMoveRequests();
    finalizeMovement();
    clearRoomCaches();
    profiler.finalizeTick();
    return;
  }

  // Clear per-tick caches at the start of each tick
  clearRoomCaches();

  // Initialize movement system (traffic management preTick)
  initMovement();

  // Clear move requests from previous tick
  clearMoveRequests();

  // Initialize memory structures
  memoryManager.initialize();

  // Run all owned rooms with error recovery
  profiler.measureSubsystem("rooms", () => {
    try {
      roomManager.run();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error(`ERROR in room processing: ${errorMessage}`, { subsystem: "SwarmBot" });
      if (err instanceof Error && err.stack) {
        logger.error(err.stack, { subsystem: "SwarmBot" });
      }
    }
  });

  // Run kernel processes (empire, cluster, market, nuke, pheromone managers)
  if (kernel.hasCpuBudget()) {
    profiler.measureSubsystem("kernel", () => {
      kernel.run();
    });
  }

  // Run spawns (high priority - always runs)
  profiler.measureSubsystem("spawns", () => {
    runSpawns();
  });

  // Run all creeps with CPU budget management
  profiler.measureSubsystem("creeps", () => {
    runCreepsWithBudget();
  });

  // Process move requests - ask blocking creeps to move out of the way
  // This runs after creeps have registered their movement intentions
  profiler.measureSubsystem("moveRequests", () => {
    processMoveRequests();
  });

  // Run power creeps (if we have budget)
  if (kernel.hasCpuBudget()) {
    profiler.measureSubsystem("powerCreeps", () => {
      runPowerCreeps();
    });
  }

  // Run visualizations (if enabled and budget allows)
  if (kernel.hasCpuBudget()) {
    profiler.measureSubsystem("visualizations", () => {
      runVisualizations();
    });
  }

  // Finalize movement system (traffic reconciliation)
  finalizeMovement();

  // Finalize profiler tick
  profiler.finalizeTick();
}

// Re-export key modules
export { memoryManager } from "./memory/manager";
export { roomManager } from "./core/roomNode";
export { profiler } from "./core/profiler";
export { logger } from "./core/logger";
export { kernel } from "./core/kernel";
export { scheduler } from "./core/scheduler";
export { coreProcessManager } from "./core/coreProcessManager";
export { pheromoneManager } from "./logic/pheromone";
export { evolutionManager, postureManager } from "./logic/evolution";
export { roomVisualizer } from "./visuals/roomVisualizer";
export { memorySegmentStats } from "./core/memorySegmentStats";
export { eventBus } from "./core/events";
export * from "./memory/schemas";
export * from "./config";
export * from "./core/processDecorators";
export * from "./core/commandRegistry";

// Testing hooks
export const __testing = {
  getPrioritizedCreeps,
  getCreepPriority
};
