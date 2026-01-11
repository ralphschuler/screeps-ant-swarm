/**
 * Action Executor
 *
 * Executes creep actions returned by behavior functions.
 * Handles all action types and movement when targets are out of range.
 * 
 * Invalid Target Detection:
 * When an action fails due to an invalid target (ERR_FULL, ERR_NOT_ENOUGH_RESOURCES,
 * ERR_INVALID_TARGET, ERR_NO_PATH), the executor immediately clears the creep's state.
 * This allows the behavior function to re-evaluate and find a new valid target on the
 * same tick, preventing creeps from appearing "idle" between actions.
 * 
 * Example: Hauler with 200 energy transferring to extensions (50 capacity each):
 * - Transfer 50 to extension A → OK, state persists
 * - Try transfer to extension A again → ERR_FULL, state cleared
 * - Behavior re-evaluates → finds extension B
 * - Transfer 50 to extension B → OK
 * This happens seamlessly without the creep appearing idle.
 * 
 * ERR_NO_PATH Handling:
 * When a target becomes unreachable (ERR_NO_PATH), the creep's state is cleared and it
 * immediately re-evaluates to find a new accessible target. This prevents wasted time
 * traveling back to the home room when other valid targets may be available nearby.
 */

import type { CreepAction, CreepContext } from "./types";
import { 
  moveTo,
  clearCachedPath,
  isExit
} from "screeps-cartographer";
import { memoryManager } from "../memory/manager";
import { clearClosestCache as clearAllCachedTargets } from "../cache";
import { createLogger } from "@ralphschuler/screeps-core";
import * as metrics from "@ralphschuler/screeps-stats";
import { applyOpportunisticActions } from "../economy/opportunisticActions";
import { getCollectionPoint } from "../utils/common";

const logger = createLogger("ActionExecutor");

/**
 * Path visualization colors for different action types.
 */
const PATH_COLORS = {
  harvest: "#ffaa00",
  mineral: "#00ff00",
  deposit: "#00ffff",
  transfer: "#ffffff",
  build: "#ffffff",
  repair: "#ffff00",
  attack: "#ff0000",
  heal: "#00ff00",
  move: "#0000ff"
};

/**
 * Execute a creep action.
 * Handles all action types including automatic movement when out of range.
 * 
 * OPTIMIZATION: Applies opportunistic actions to improve efficiency
 * Creeps can pick up dropped resources, repair structures, or transfer energy
 * to nearby structures while executing their primary action.
 * 
 * REFACTORED: Added defensive checks for invalid actions
 */
export function executeAction(creep: Creep, action: CreepAction, ctx: CreepContext): void {
  // REFACTORED: Safety check - if action is invalid, clear state and return
  if (!action || !action.type) {
    logger.warn(`${creep.name} received invalid action, clearing state`);
    delete ctx.memory.state;
    return;
  }
  
  // OPTIMIZATION: Apply opportunistic actions (Phase 4)
  // This allows creeps to pick up dropped energy, repair structures, or transfer
  // to nearby critical structures while moving, improving overall efficiency
  const optimizedAction = applyOpportunisticActions(creep, action);
  
  // If action was modified, log it for monitoring
  if (action.type !== optimizedAction.type) {
    logger.debug(`${creep.name} opportunistic action: ${action.type} → ${optimizedAction.type}`);
  }

  // Log the action being executed for debugging
  if (optimizedAction.type === "idle") {
    logger.warn(`${creep.name} (${ctx.memory.role}) executing IDLE action`);
  } else {
    logger.debug(`${creep.name} (${ctx.memory.role}) executing ${optimizedAction.type}`);
  }

  let shouldClearState = false;
  
  switch (optimizedAction.type) {
    // Resource gathering
    case "harvest":
      shouldClearState = executeWithRange(
        creep,
        () => creep.harvest(optimizedAction.target),
        optimizedAction.target,
        PATH_COLORS.harvest,
        optimizedAction.type
      );
      break;

    case "harvestMineral":
      shouldClearState = executeWithRange(
        creep,
        () => creep.harvest(optimizedAction.target),
        optimizedAction.target,
        PATH_COLORS.mineral,
        optimizedAction.type
      );
      break;

    case "harvestDeposit":
      shouldClearState = executeWithRange(
        creep,
        () => creep.harvest(optimizedAction.target),
        optimizedAction.target,
        PATH_COLORS.deposit,
        optimizedAction.type
      );
      break;

    case "pickup":
      shouldClearState = executeWithRange(
        creep,
        () => creep.pickup(optimizedAction.target),
        optimizedAction.target,
        PATH_COLORS.harvest,
        optimizedAction.type
      );
      break;

    case "withdraw":
      shouldClearState = executeWithRange(
        creep,
        () => creep.withdraw(optimizedAction.target, optimizedAction.resourceType),
        optimizedAction.target,
        PATH_COLORS.harvest,
        optimizedAction.type
      );
      break;

    // Resource delivery
    case "transfer":
      shouldClearState = executeWithRange(
        creep,
        () => creep.transfer(optimizedAction.target, optimizedAction.resourceType),
        optimizedAction.target,
        PATH_COLORS.transfer,
        optimizedAction.type,
        { resourceType: optimizedAction.resourceType }
      );
      break;

    case "drop":
      creep.drop(optimizedAction.resourceType);
      break;

    // Construction and maintenance
    case "build":
      shouldClearState = executeWithRange(
        creep,
        () => creep.build(optimizedAction.target),
        optimizedAction.target,
        PATH_COLORS.build,
        optimizedAction.type
      );
      break;

    case "repair":
      shouldClearState = executeWithRange(
        creep,
        () => creep.repair(optimizedAction.target),
        optimizedAction.target,
        PATH_COLORS.repair,
        optimizedAction.type
      );
      break;

    case "upgrade":
      shouldClearState = executeWithRange(
        creep,
        () => creep.upgradeController(optimizedAction.target),
        optimizedAction.target,
        PATH_COLORS.transfer,
        optimizedAction.type
      );
      break;

    case "dismantle":
      shouldClearState = executeWithRange(
        creep,
        () => creep.dismantle(optimizedAction.target),
        optimizedAction.target,
        PATH_COLORS.attack,
        optimizedAction.type
      );
      break;

    // Combat
    case "attack":
      executeWithRange(creep, () => creep.attack(optimizedAction.target), optimizedAction.target, PATH_COLORS.attack, optimizedAction.type);
      break;

    case "rangedAttack":
      executeWithRange(
        creep,
        () => creep.rangedAttack(optimizedAction.target),
        optimizedAction.target,
        PATH_COLORS.attack,
        optimizedAction.type
      );
      break;

    case "heal":
      executeWithRange(creep, () => creep.heal(optimizedAction.target), optimizedAction.target, PATH_COLORS.heal, optimizedAction.type);
      break;

    case "rangedHeal": {
      // Ranged heal always involves movement toward the target
      creep.rangedHeal(optimizedAction.target);
      const healMoveResult = moveTo(creep, optimizedAction.target, { visualizePathStyle: { stroke: PATH_COLORS.heal } });
      // Clear state if pathfinding fails
      if (healMoveResult === ERR_NO_PATH) {
        shouldClearState = true;
      }
      break;
    }

    // Controller actions
    case "claim":
      executeWithRange(
        creep,
        () => creep.claimController(optimizedAction.target),
        optimizedAction.target,
        PATH_COLORS.heal,
        optimizedAction.type
      );
      break;

    case "reserve":
      executeWithRange(
        creep,
        () => creep.reserveController(optimizedAction.target),
        optimizedAction.target,
        PATH_COLORS.heal,
        optimizedAction.type
      );
      break;

    case "attackController":
      executeWithRange(
        creep,
        () => creep.attackController(optimizedAction.target),
        optimizedAction.target,
        PATH_COLORS.attack,
        optimizedAction.type
      );
      break;

    // Movement
    case "moveTo": {
      const moveResult = moveTo(creep, optimizedAction.target, { visualizePathStyle: { stroke: PATH_COLORS.move } });
      // Clear state if pathfinding fails so the behavior can re-evaluate
      if (moveResult === ERR_NO_PATH) {
        shouldClearState = true;
      }
      break;
    }

    case "moveToRoom": {
      // Move to room center with range 20
      const targetPos = new RoomPosition(25, 25, optimizedAction.roomName);
      const moveResult = moveTo(creep, { pos: targetPos, range: 20 }, { 
        visualizePathStyle: { stroke: PATH_COLORS.move },
        maxRooms: 16
      });
      // Clear state if pathfinding fails so the behavior can re-evaluate
      if (moveResult === ERR_NO_PATH) {
        shouldClearState = true;
      }
      break;
    }

    case "flee": {
      // Convert positions to MoveTargets with range
      const fleeTargets = optimizedAction.from.map(pos => ({ pos, range: 10 }));
      const fleeResult = moveTo(creep, fleeTargets, { flee: true });
      // Clear state if pathfinding fails so the behavior can re-evaluate
      if (fleeResult === ERR_NO_PATH) {
        shouldClearState = true;
      }
      break;
    }

    case "wait":
      // If on a room exit, move off first before waiting
      if (isExit(creep.pos)) {
        // Move toward room center
        const roomCenter = new RoomPosition(25, 25, creep.pos.roomName);
        moveTo(creep, roomCenter, { priority: 2 });
        break;
      }
      if (!creep.pos.isEqualTo(optimizedAction.position)) {
        const waitMoveResult = moveTo(creep, optimizedAction.position);
        // Clear state if pathfinding fails
        if (waitMoveResult === ERR_NO_PATH) {
          shouldClearState = true;
        }
      }
      break;

    case "requestMove": {
      // Move toward the target position with higher priority
      // Cartographer's traffic management will handle asking blocking creeps to move
      const requestMoveResult = moveTo(creep, optimizedAction.target, { 
        visualizePathStyle: { stroke: PATH_COLORS.move },
        priority: 5 // Higher priority to help unblock
      });
      // Clear state if pathfinding fails
      if (requestMoveResult === ERR_NO_PATH) {
        shouldClearState = true;
      }
      break;
    }

    case "idle": {
      // When idle, first move off room exit tiles to prevent endless cycling between rooms
      if (isExit(creep.pos)) {
        const roomCenter = new RoomPosition(25, 25, creep.pos.roomName);
        moveTo(creep, roomCenter, { priority: 2 });
        break;
      }
      // Try to move to collection point if available
      const room = Game.rooms[creep.pos.roomName];
      if (room && room.controller?.my) {
        const swarmState = memoryManager.getOrInitSwarmState(room.name);
        const collectionPoint = getCollectionPoint(room.name);
        if (collectionPoint) {
          // Move to collection point if not already there
          if (!creep.pos.isEqualTo(collectionPoint)) {
            const idleMoveResult = moveTo(creep, collectionPoint, { 
              visualizePathStyle: { stroke: "#888888" },
              priority: 2
            });
            // Clear state if pathfinding fails
            if (idleMoveResult === ERR_NO_PATH) {
              shouldClearState = true;
            }
            break;
          }
        }
      }
      // Fallback: move away from spawns to prevent blocking new creeps
      const spawns = Game.rooms[creep.pos.roomName]?.find(FIND_MY_SPAWNS) || [];
      const nearbySpawn = spawns.find(spawn => creep.pos.inRangeTo(spawn.pos, 1));
      if (nearbySpawn) {
        // Flee from spawn
        moveTo(creep, { pos: nearbySpawn.pos, range: 3 }, { flee: true, priority: 2 });
      }
      break;
    }
  }

  // Clear state if action failed due to invalid target
  // This allows the creep to immediately re-evaluate and find a new target
  if (shouldClearState) {
    delete ctx.memory.state;
    // BUGFIX: Also clear movement cache to prevent wandering from stale paths
    // When state is invalidated, the cached path to the old target is no longer valid
    // This prevents creeps from making partial movements on stale paths before re-pathing
    clearCachedPath(creep);
    // BUGFIX: Clear all cached closest targets to prevent re-selecting the same invalid target
    // When multiple creeps target the same structure, one may fill it and clear state.
    // Without clearing the cache, the other creep will immediately re-select the same
    // now-full target, creating an infinite loop where both creeps get stuck.
    clearAllCachedTargets(creep);
  }

  // Update working state based on carry capacity
  updateWorkingState(ctx);
}

/**
 * Execute an action that requires being in range.
 * Automatically moves toward target if out of range.
 * Clears creep state if action fails due to invalid target (full, empty, etc.).
 * Tracks metrics for successful actions.
 * 
 * @returns true if action should clear state (due to failure)
 */
function executeWithRange(
  creep: Creep,
  action: () => ScreepsReturnCode,
  target: RoomObject,
  pathColor: string,
  actionLabel?: string,
  actionData?: { resourceType?: ResourceConstant }
): boolean {
  const result = action();

  if (result === ERR_NOT_IN_RANGE) {
    const moveResult = moveTo(creep, target, { visualizePathStyle: { stroke: pathColor } });
    if (moveResult !== OK) {
      logger.info("Movement attempt returned non-OK result", {
        room: creep.pos.roomName,
        creep: creep.name,
        meta: {
          action: actionLabel ?? "rangeAction",
          moveResult,
          target: target.pos.toString()
        }
      });
    }
    // If movement fails with ERR_NO_PATH, indicate state should be cleared
    if (moveResult === ERR_NO_PATH) {
      return true;
    }
    return false;
  }

  // Track successful actions in metrics
  if (result === OK && actionLabel) {
    trackActionMetrics(creep, actionLabel, target, actionData);
  }

  // Check for errors that indicate the target is invalid and state should be cleared
  // This allows the creep to immediately find a new target instead of being stuck
  if (result === ERR_FULL || result === ERR_NOT_ENOUGH_RESOURCES || result === ERR_INVALID_TARGET) {
    logger.info("Clearing state after action error", {
      room: creep.pos.roomName,
      creep: creep.name,
      meta: {
        action: actionLabel ?? "rangeAction",
        result,
        target: target.pos.toString()
      }
    });
    return true;
  }

  return false;
}

/**
 * Track metrics for a successful action.
 */
function trackActionMetrics(
  creep: Creep, 
  actionType: string, 
  target: RoomObject,
  actionData?: { resourceType?: ResourceConstant }
): void {
  // Initialize metrics if needed (cast to allow structural compatibility)
  metrics.initializeMetrics(creep.memory as any);

  // Determine what to track based on action type and target
  switch (actionType) {
    case "harvest":
    case "harvestMineral":
    case "harvestDeposit": {
      // For harvest, we track the amount harvested
      // Estimate based on WORK parts (2 energy per WORK part per tick)
      const workParts = creep.body.filter(p => p.type === WORK && p.hits > 0).length;
      const harvestAmount = workParts * 2;
      metrics.recordHarvest(creep.memory as any, harvestAmount);
      break;
    }

    case "transfer": {
      // For transfer, track the actual amount transferred
      // Use the specific resource type from the action
      const resourceType = actionData?.resourceType ?? RESOURCE_ENERGY;
      const transferAmount = Math.min(
        creep.store.getUsedCapacity(resourceType),
        (target as AnyStoreStructure).store?.getFreeCapacity(resourceType) ?? 0
      );
      if (transferAmount > 0) {
        metrics.recordTransfer(creep.memory as any, transferAmount);
      }
      break;
    }

    case "build": {
      // For build, track build progress
      // WORK parts contribute 5 build power per tick
      const workParts = creep.body.filter(p => p.type === WORK && p.hits > 0).length;
      const buildPower = workParts * 5;
      metrics.recordBuild(creep.memory as any, buildPower);
      
      // Note: Task completion is tracked separately when construction finishes
      // to avoid false positives from partial progress
      break;
    }

    case "repair": {
      // For repair, track repair progress
      const workParts = creep.body.filter(p => p.type === WORK && p.hits > 0).length;
      const repairPower = workParts * 100;
      metrics.recordRepair(creep.memory as any, repairPower);
      break;
    }

    case "attack": {
      // For attack, track damage dealt
      const attackParts = creep.body.filter(p => p.type === ATTACK && p.hits > 0).length;
      const damage = attackParts * 30;
      metrics.recordDamage(creep.memory as any, damage);
      break;
    }

    case "rangedAttack": {
      // For ranged attack, track damage dealt (damage depends on range)
      const rangedParts = creep.body.filter(p => p.type === RANGED_ATTACK && p.hits > 0).length;
      const range = creep.pos.getRangeTo(target);
      let damage = 0;
      if (range <= 1) damage = rangedParts * 10;
      else if (range <= 2) damage = rangedParts * 4;
      else if (range <= 3) damage = rangedParts * 1;
      metrics.recordDamage(creep.memory as any, damage);
      break;
    }

    case "heal":
    case "rangedHeal": {
      // For heal, track healing done
      const healParts = creep.body.filter(p => p.type === HEAL && p.hits > 0).length;
      const healing = actionType === "heal" ? healParts * 12 : healParts * 4;
      metrics.recordHealing(creep.memory as any, healing);
      break;
    }

    case "upgrade": {
      // For upgrade, track controller progress
      // WORK parts contribute 1 energy per tick to controller
      const workParts = creep.body.filter(p => p.type === WORK && p.hits > 0).length;
      metrics.recordUpgrade(creep.memory as any, workParts);
      break;
    }
  }
}

/**
 * Update the working state based on creep's store capacity.
 * Working = true when full (should deliver), false when empty (should collect).
 * 
 * Note: We use creep.store directly instead of ctx.isFull/isEmpty because context
 * values are calculated once at tick start, before actions execute. This ensures
 * we always have fresh capacity state after transfer/withdraw actions.
 */
function updateWorkingState(ctx: CreepContext): void {
  // BUGFIX: Use creep.store directly for fresh capacity state
  const isEmpty = ctx.creep.store.getUsedCapacity() === 0;
  const isFull = ctx.creep.store.getFreeCapacity() === 0;

  // BUGFIX: Re-initialize undefined working state based on actual energy
  // Global resets or memory wipes can clear creep memory while they still
  // have energy. If working remains undefined, downstream behaviors assume
  // the creep is in collection mode and never deliver, leading to the
  // reported "working: false" deadlock even though the kernel executes
  // their processes. Initialize to true when carrying energy so they resume
  // their work cycle immediately.
  if (ctx.memory.working === undefined) {
    ctx.memory.working = !isEmpty;
  }

  if (isEmpty) {
    ctx.memory.working = false;
  }
  if (isFull) {
    ctx.memory.working = true;
  }
}
