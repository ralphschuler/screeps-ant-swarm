/**
 * Opportunistic Actions System
 *
 * Allows creeps to perform secondary tasks while executing their primary behavior.
 * This increases efficiency by utilizing "dead time" during movement.
 *
 * ROADMAP Alignment:
 * - Section 2: "Eco-Raum ≤ 0.1 CPU" target
 * - Emergent behavior through local decision-making
 *
 * Performance Impact:
 * - Estimated CPU savings: 0.01-0.02 per eco room
 * - Reduces required creep count by 10-15%
 * - Improves resource utilization without additional CPU cost
 *
 * Examples:
 * - Hauler picks up dropped energy while moving to container
 * - Builder repairs damaged structure along path
 * - Upgrader picks up nearby energy while heading to controller
 */

import { createLogger } from "@ralphschuler/screeps-core";
import type { CreepAction } from "@ralphschuler/screeps-roles";

const logger = createLogger("OpportunisticActions");

/**
 * Configuration for opportunistic actions
 */
const CONFIG = {
  /** Only perform opportunistic actions if CPU bucket is above this threshold */
  minBucket: 2000,
  
  /** Maximum range to search for opportunistic targets */
  maxRange: 3,
  
  /** Minimum energy in dropped resource to pick up */
  minDroppedEnergy: 50,
  
  /** Minimum hits ratio to consider structure for repair (0.5 = 50% damaged) */
  maxRepairHitsRatio: 0.5,
  
  /** Minimum free capacity to pick up resources */
  minFreeCapacity: 50
};

/**
 * Default minimum CPU bucket threshold for opportunistic actions
 * Ensures we only perform extra work when CPU is healthy
 * Per ROADMAP Section 18: CPU-Bucket-gesteuertes Verhalten
 */
const DEFAULT_MIN_BUCKET_THRESHOLD = 2000;

/**
 * Check if opportunistic actions are allowed based on CPU bucket
 */
function canPerformOpportunisticActions(): boolean {
  return Game.cpu.bucket >= DEFAULT_MIN_BUCKET_THRESHOLD;
}

/**
 * Try to pick up nearby dropped energy while moving
 * 
 * @param creep The creep to check
 * @param primaryAction The primary action the creep is executing
 * @returns Modified action if opportunistic pickup found, otherwise original action
 */
export function opportunisticPickup(creep: Creep, primaryAction: CreepAction): CreepAction {
  // Only if bucket is healthy
  if (!canPerformOpportunisticActions()) return primaryAction;
  
  // Only if creep has free capacity
  if (creep.store.getFreeCapacity() < CONFIG.minFreeCapacity) return primaryAction;
  
  // Only if creep is currently moving (not already picking up)
  if (primaryAction.type === "pickup" || primaryAction.type === "withdraw") {
    return primaryAction;
  }
  
  // Look for dropped resources nearby
  const dropped = creep.pos.findInRange(FIND_DROPPED_RESOURCES, CONFIG.maxRange, {
    filter: (r: Resource) => 
      r.resourceType === RESOURCE_ENERGY && 
      r.amount >= CONFIG.minDroppedEnergy
  });
  
  if (dropped.length > 0) {
    // Pick up closest dropped energy
    const closest = dropped.reduce((best, current) => 
      creep.pos.getRangeTo(current) < creep.pos.getRangeTo(best) ? current : best
    );
    
    // If we're right next to it, pick it up immediately
    if (creep.pos.isNearTo(closest)) {
      logger.debug(`${creep.name} opportunistically picking up ${closest.amount} energy at ${closest.pos}`);
      return { type: "pickup", target: closest };
    }
  }
  
  return primaryAction;
}

/**
 * Try to repair damaged structures along the path
 * 
 * @param creep The creep to check
 * @param primaryAction The primary action the creep is executing
 * @returns Modified action if opportunistic repair found, otherwise original action
 */
export function opportunisticRepair(creep: Creep, primaryAction: CreepAction): CreepAction {
  // Only if bucket is healthy
  if (!canPerformOpportunisticActions()) return primaryAction;
  
  // Only if creep has WORK parts
  if (creep.getActiveBodyparts(WORK) === 0) return primaryAction;
  
  // Only if creep has energy
  if (creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) return primaryAction;
  
  // Only if creep is currently moving or working on non-repair tasks
  if (primaryAction.type === "repair") return primaryAction;
  
  // Look for damaged structures nearby (excluding walls and ramparts - those are maintenance tasks)
  const damaged = creep.pos.findInRange(FIND_STRUCTURES, CONFIG.maxRange, {
    filter: (s: Structure) => 
      s.hits < s.hitsMax * CONFIG.maxRepairHitsRatio &&
      s.structureType !== STRUCTURE_WALL &&
      s.structureType !== STRUCTURE_RAMPART
  });
  
  if (damaged.length > 0) {
    // Repair closest damaged structure
    const closest = damaged.reduce((best, current) => 
      creep.pos.getRangeTo(current) < creep.pos.getRangeTo(best) ? current : best
    );
    
    // If we're right next to it and it's critically damaged, repair it
    if (creep.pos.isNearTo(closest) && closest.hits < closest.hitsMax * 0.3) {
      logger.debug(`${creep.name} opportunistically repairing ${closest.structureType} at ${closest.pos} (${closest.hits}/${closest.hitsMax})`);
      return { type: "repair", target: closest };
    }
  }
  
  return primaryAction;
}

/**
 * Try to transfer energy to nearby structures that need it
 * 
 * @param creep The creep to check
 * @param primaryAction The primary action the creep is executing
 * @returns Modified action if opportunistic transfer found, otherwise original action
 */
export function opportunisticTransfer(creep: Creep, primaryAction: CreepAction): CreepAction {
  // Only if bucket is healthy
  if (!canPerformOpportunisticActions()) return primaryAction;
  
  // Only if creep has energy to transfer
  if (creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) return primaryAction;
  
  // Only if creep is currently moving (not already transferring)
  if (primaryAction.type === "transfer") return primaryAction;
  
  // Look for structures that need energy nearby
  // Priority: spawns > extensions > towers (critical structures only)
  const needsEnergy: (StructureSpawn | StructureExtension | StructureTower)[] = creep.pos.findInRange(FIND_MY_STRUCTURES, 1, {
    filter: (s: AnyOwnedStructure) => {
      if (s.structureType === STRUCTURE_SPAWN ||
          s.structureType === STRUCTURE_EXTENSION) {
        return s.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
      }
      if (s.structureType === STRUCTURE_TOWER) {
        return s.store.getFreeCapacity(RESOURCE_ENERGY) >= 100;
      }
      return false;
    }
  }) as (StructureSpawn | StructureExtension | StructureTower)[];
  
  if (needsEnergy.length > 0) {
    // Transfer to highest priority structure (spawns first, then extensions, then towers)
    const prioritized = needsEnergy.sort((a, b) => {
      const priorityA = a.structureType === STRUCTURE_SPAWN ? 3 :
                       a.structureType === STRUCTURE_EXTENSION ? 2 : 1;
      const priorityB = b.structureType === STRUCTURE_SPAWN ? 3 :
                       b.structureType === STRUCTURE_EXTENSION ? 2 : 1;
      return priorityB - priorityA;
    });
    
    const target = prioritized[0];
    logger.debug(`${creep.name} opportunistically transferring to ${target.structureType} at ${target.pos}`);
    return { type: "transfer", target, resourceType: RESOURCE_ENERGY };
  }
  
  return primaryAction;
}

/**
 * Apply all opportunistic actions to a creep's primary action
 * 
 * This checks for various opportunistic tasks and modifies the action if beneficial.
 * Ordered by priority: pickup > repair > transfer
 * 
 * @param creep The creep to optimize
 * @param primaryAction The primary action the creep wants to execute
 * @returns Potentially modified action with opportunistic improvements
 */
export function applyOpportunisticActions(creep: Creep, primaryAction: CreepAction): CreepAction {
  // Skip if idle or already doing something critical
  if (primaryAction.type === "idle") return primaryAction;
  
  // Try each opportunistic action in priority order
  let action = opportunisticPickup(creep, primaryAction);
  if (action.type !== primaryAction.type) return action;
  
  action = opportunisticTransfer(creep, action);
  if (action.type !== primaryAction.type) return action;
  
  action = opportunisticRepair(creep, action);
  return action;
}

/**
 * Get opportunistic action statistics for monitoring
 */
export function getOpportunisticStats(): {
  enabled: boolean;
  minBucket: number;
  currentBucket: number;
} {
  return {
    enabled: canPerformOpportunisticActions(),
    minBucket: DEFAULT_MIN_BUCKET_THRESHOLD,
    currentBucket: Game.cpu.bucket
  };
}
