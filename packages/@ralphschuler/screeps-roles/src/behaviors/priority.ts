/**
 * Behavior Priority System
 *
 * Provides dynamic prioritization of behaviors based on pheromones, room state,
 * and situational context as specified in ROADMAP.md Sections 5 & 8.
 *
 * Features:
 * - Pheromone-based task prioritization
 * - Emergency override priorities
 * - Dynamic behavior switching
 * - Context-aware priority scoring
 *
 * Usage:
 * ```typescript
 * const priorities = calculateBehaviorPriorities(ctx);
 * const task = selectHighestPriorityTask(priorities);
 * ```
 */

import type { CreepContext } from "./types";
import type { PheromoneState } from "../memory/schemas";
import { getPheromones } from "./pheromoneHelper";
import { createLogger } from "@ralphschuler/screeps-core";

const logger = createLogger("BehaviorPriority");

/**
 * Available task types for priority assignment
 */
export type TaskType =
  | "refillSpawns"
  | "refillTowers"
  | "build"
  | "upgrade"
  | "repair"
  | "harvest"
  | "haul"
  | "defend"
  | "attack"
  | "heal"
  | "claim"
  | "scout"
  | "flee"
  | "idle";

/**
 * Priority score (0-100, higher = more important)
 */
export type PriorityScore = number;

/**
 * Task priorities for a creep
 */
export type TaskPriorities = Map<TaskType, PriorityScore>;

/**
 * Calculate behavior priorities based on context and pheromones.
 * 
 * Returns a map of task types to priority scores (0-100).
 * Higher scores indicate higher priority.
 */
export function calculateBehaviorPriorities(ctx: CreepContext): TaskPriorities {
  const priorities = new Map<TaskType, PriorityScore>();
  const pheromones = getPheromones(ctx.creep);
  
  // Base priorities (modified by pheromones and context)
  priorities.set("refillSpawns", calculateRefillSpawnsPriority(ctx, pheromones));
  priorities.set("refillTowers", calculateRefillTowersPriority(ctx, pheromones));
  priorities.set("build", calculateBuildPriority(ctx, pheromones));
  priorities.set("upgrade", calculateUpgradePriority(ctx, pheromones));
  priorities.set("repair", calculateRepairPriority(ctx, pheromones));
  priorities.set("harvest", calculateHarvestPriority(ctx, pheromones));
  priorities.set("haul", calculateHaulPriority(ctx, pheromones));
  priorities.set("defend", calculateDefendPriority(ctx, pheromones));
  priorities.set("attack", calculateAttackPriority(ctx, pheromones));
  priorities.set("heal", calculateHealPriority(ctx, pheromones));
  priorities.set("claim", calculateClaimPriority(ctx, pheromones));
  priorities.set("scout", calculateScoutPriority(ctx, pheromones));
  priorities.set("flee", calculateFleePriority(ctx, pheromones));
  priorities.set("idle", 0); // Idle is always lowest priority
  
  return priorities;
}

/**
 * Select the highest priority task that the creep can actually perform.
 */
export function selectHighestPriorityTask(
  priorities: TaskPriorities,
  ctx: CreepContext
): TaskType {
  let highestPriority: TaskType = "idle";
  let highestScore = -1;
  
  for (const [task, score] of priorities.entries()) {
    if (score > highestScore && canPerformTask(task, ctx)) {
      highestScore = score;
      highestPriority = task;
    }
  }
  
  if (highestScore > 0) {
    logger.debug(`${ctx.creep.name} selected task ${highestPriority} with priority ${highestScore}`);
  }
  
  return highestPriority;
}

/**
 * Check if a creep can perform a given task based on its capabilities and context.
 */
function canPerformTask(task: TaskType, ctx: CreepContext): boolean {
  switch (task) {
    case "refillSpawns":
      // Need energy and spawns that need filling
      return !ctx.isEmpty && ctx.spawnStructures.some(s => 
        s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
      );
      
    case "refillTowers":
      // Need energy and towers that need filling
      // FIX: Match threshold with deliverEnergy/hauler (100 instead of 200)
      return !ctx.isEmpty && ctx.towers.some(t => 
        t.store.getFreeCapacity(RESOURCE_ENERGY) > 100
      );
      
    case "build":
      // Need energy and construction sites
      return !ctx.isEmpty && ctx.constructionSiteCount > 0;
      
    case "upgrade":
      // Need energy and controller
      return !ctx.isEmpty && ctx.room.controller !== undefined;
      
    case "repair":
      // Need energy and damaged structures
      return !ctx.isEmpty && ctx.damagedStructureCount > 0;
      
    case "harvest":
      // Need free capacity and available sources
      return !ctx.isFull && ctx.room.find(FIND_SOURCES_ACTIVE).length > 0;
      
    case "haul":
      // Can haul if not full (to collect) or not empty (to deliver)
      return !ctx.isFull || !ctx.isEmpty;
      
    case "defend":
      // Have attack/ranged attack parts and hostiles present
      return (ctx.creep.getActiveBodyparts(ATTACK) > 0 || 
              ctx.creep.getActiveBodyparts(RANGED_ATTACK) > 0) &&
             ctx.hostiles.length > 0;
      
    case "attack":
      // Have attack parts and can attack
      return ctx.creep.getActiveBodyparts(ATTACK) > 0 || 
             ctx.creep.getActiveBodyparts(RANGED_ATTACK) > 0;
      
    case "heal":
      // Have heal parts and damaged allies
      return ctx.creep.getActiveBodyparts(HEAL) > 0 && ctx.damagedAllies.length > 0;
      
    case "claim":
      // Have claim parts
      return ctx.creep.getActiveBodyparts(CLAIM) > 0;
      
    case "scout":
      // Any creep can scout
      return true;
      
    case "flee":
      // Only flee if actually in danger
      return ctx.hostiles.length > 0;
      
    case "idle":
      // Can always idle
      return true;
      
    default:
      return false;
  }
}

// =============================================================================
// Priority Calculation Functions
// =============================================================================

function calculateRefillSpawnsPriority(
  ctx: CreepContext,
  pheromones: PheromoneState | null
): PriorityScore {
  // Critical priority - spawns must be filled for creep production
  let priority = 90;
  
  // Reduce if spawns are mostly full
  const avgFill = ctx.spawnStructures.reduce((sum, s) => 
    sum + s.store.getUsedCapacity(RESOURCE_ENERGY) / s.store.getCapacity(RESOURCE_ENERGY), 0
  ) / Math.max(1, ctx.spawnStructures.length);
  
  priority *= (1 - avgFill); // Lower priority if spawns are fuller
  
  // Boost based on logistics pheromone
  if (pheromones?.logistics) {
    priority += pheromones.logistics * 0.1;
  }
  
  return Math.min(100, priority);
}

function calculateRefillTowersPriority(
  ctx: CreepContext,
  pheromones: PheromoneState | null
): PriorityScore {
  let priority = 60;
  
  // Boost significantly if under attack
  if (ctx.swarmState?.danger && ctx.swarmState.danger >= 2) {
    priority += 30;
  }
  
  // Boost based on defense pheromone
  if (pheromones?.defense) {
    priority += pheromones.defense * 0.5;
  }
  
  return Math.min(100, priority);
}

function calculateBuildPriority(
  ctx: CreepContext,
  pheromones: PheromoneState | null
): PriorityScore {
  let priority = 40;
  
  // Boost based on build pheromone
  if (pheromones?.build) {
    priority += pheromones.build * 0.8;
  }
  
  // Reduce if no construction sites
  if (ctx.constructionSiteCount === 0) {
    priority = 0;
  }
  
  return Math.min(100, priority);
}

function calculateUpgradePriority(
  ctx: CreepContext,
  pheromones: PheromoneState | null
): PriorityScore {
  let priority = 30;
  
  // Boost based on upgrade pheromone
  if (pheromones?.upgrade) {
    priority += pheromones.upgrade * 0.8;
  }
  
  // Reduce if controller is close to downgrade
  if (ctx.room.controller?.ticksToDowngrade && ctx.room.controller.ticksToDowngrade < 5000) {
    priority += 20;
  }
  
  return Math.min(100, priority);
}

function calculateRepairPriority(
  ctx: CreepContext,
  pheromones: PheromoneState | null
): PriorityScore {
  let priority = 35;
  
  // Boost if under attack
  if (ctx.swarmState?.danger && ctx.swarmState.danger >= 1) {
    priority += 25;
  }
  
  // Reduce if no damaged structures
  if (ctx.damagedStructureCount === 0) {
    priority = 0;
  }
  
  return Math.min(100, priority);
}

function calculateHarvestPriority(
  ctx: CreepContext,
  pheromones: PheromoneState | null
): PriorityScore {
  let priority = 70;
  
  // Boost based on harvest pheromone
  if (pheromones?.harvest) {
    priority += pheromones.harvest * 0.5;
  }
  
  // Reduce if already full
  if (ctx.isFull) {
    priority = 0;
  }
  
  return Math.min(100, priority);
}

function calculateHaulPriority(
  ctx: CreepContext,
  pheromones: PheromoneState | null
): PriorityScore {
  let priority = 65;
  
  // Boost based on logistics pheromone
  if (pheromones?.logistics) {
    priority += pheromones.logistics * 0.6;
  }
  
  return Math.min(100, priority);
}

function calculateDefendPriority(
  ctx: CreepContext,
  pheromones: PheromoneState | null
): PriorityScore {
  let priority = 50;
  
  // Critical if hostiles present
  if (ctx.hostiles.length > 0) {
    priority = 95;
  }
  
  // Boost based on defense pheromone
  if (pheromones?.defense) {
    priority += pheromones.defense * 0.3;
  }
  
  // Boost based on danger level
  if (ctx.swarmState?.danger) {
    priority += ctx.swarmState.danger * 10;
  }
  
  return Math.min(100, priority);
}

function calculateAttackPriority(
  ctx: CreepContext,
  pheromones: PheromoneState | null
): PriorityScore {
  let priority = 40;
  
  // Boost based on war pheromone
  if (pheromones?.war) {
    priority += pheromones.war * 0.8;
  }
  
  // Boost if in war/siege posture
  if (ctx.swarmState?.posture === "war" || ctx.swarmState?.posture === "siege") {
    priority += 30;
  }
  
  return Math.min(100, priority);
}

function calculateHealPriority(
  ctx: CreepContext,
  pheromones: PheromoneState | null
): PriorityScore {
  let priority = 45;
  
  // Critical if damaged allies present
  if (ctx.damagedAllies.length > 0) {
    priority = 85;
  }
  
  // Boost based on defense pheromone
  if (pheromones?.defense) {
    priority += pheromones.defense * 0.4;
  }
  
  return Math.min(100, priority);
}

function calculateClaimPriority(
  ctx: CreepContext,
  pheromones: PheromoneState | null
): PriorityScore {
  let priority = 30;
  
  // Boost based on expand pheromone
  if (pheromones?.expand) {
    priority += pheromones.expand * 0.9;
  }
  
  // Boost if in expand posture
  if (ctx.swarmState?.posture === "expand") {
    priority += 40;
  }
  
  return Math.min(100, priority);
}

function calculateScoutPriority(
  _ctx: CreepContext,
  pheromones: PheromoneState | null
): PriorityScore {
  let priority = 20;
  
  // Boost based on expand pheromone (scouting supports expansion)
  if (pheromones?.expand) {
    priority += pheromones.expand * 0.3;
  }
  
  return Math.min(100, priority);
}

function calculateFleePriority(
  ctx: CreepContext,
  _pheromones: PheromoneState | null
): PriorityScore {
  // Critical if in danger and not a military unit
  if (ctx.hostiles.length > 0 && ctx.creep.getActiveBodyparts(ATTACK) === 0) {
    // Economy creeps should flee from hostiles
    const creepHealth = ctx.creep.hits / ctx.creep.hitsMax;
    if (creepHealth < 0.5) {
      return 100; // Critical - flee immediately
    }
    return 70; // High priority to flee
  }
  
  return 0;
}
