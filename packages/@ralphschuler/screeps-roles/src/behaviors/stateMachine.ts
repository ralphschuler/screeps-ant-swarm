/**
 * Creep State Machine
 *
 * Provides persistent state management for creeps to prevent sudden direction changes.
 * Creeps commit to an action and continue it until completion or failure.
 *
 * Architecture:
 * 1. Check if current state is valid and incomplete
 * 2. If valid, continue executing current state action
 * 3. If invalid/complete/expired, evaluate new action and commit to it
 * 4. Store state in creep memory for next tick
 *
 * State Completion Detection:
 * States are considered complete based on creep inventory state:
 * - Transfer/Build/Repair/Upgrade: complete when creep is empty
 * - Withdraw/Pickup/Harvest: complete when creep is full
 * - Target destroyed: always triggers completion
 *
 * Invalid Target Handling:
 * The executor (executeAction) detects when actions fail due to invalid targets
 * and immediately clears the state, allowing the creep to re-evaluate and find a new target:
 * - ERR_FULL: Target is full (e.g., spawn filled by another creep)
 * - ERR_NOT_ENOUGH_RESOURCES: Source is empty (e.g., container depleted)
 * - ERR_INVALID_TARGET: Target doesn't exist or wrong type
 * - ERR_NO_PATH: Target is unreachable (blocked or no valid path exists)
 *
 * This two-layer approach prevents:
 * 1. Creeps getting stuck trying invalid actions (executor catches errors)
 * 2. Premature state transitions after partial transfers (state machine only checks inventory)
 * 3. Wasted time returning home when other valid targets may be available nearby
 * 
 * Example: Creep with 200 energy transferring to extensions (50 capacity each):
 * - Tick 1: Transfer 50 to extension A (fills it), creep has 150 left, state continues
 * - Tick 2: Try transfer to extension A → ERR_FULL → executor clears state
 * - Tick 2: Behavior evaluates, finds extension B, transfers 50, state continues
 * - This allows smooth multi-target operations without appearing "idle"
 * 
 * Example: Creep trying to reach unreachable target:
 * - Tick 1: Try to move to blocked target → ERR_NO_PATH → executor clears state
 * - Tick 1: Behavior re-evaluates, finds accessible alternative target
 * - Tick 2: Move to new target → OK
 * - No wasted time traveling back to home room
 */

import type { CreepAction, CreepContext } from "./types";
import type { CreepState } from "../memory/schemas";
import { createLogger } from "@ralphschuler/screeps-core";

const logger = createLogger("StateMachine");

/**
 * Default timeout for states (in ticks)
 * After this many ticks, state is considered expired and will be re-evaluated
 */
const DEFAULT_STATE_TIMEOUT = 25;

/**
 * Cooldown threshold for deposit harvesting (in ticks)
 * If a deposit's cooldown exceeds this value, the harvest action is considered complete
 */
const DEPOSIT_COOLDOWN_THRESHOLD = 100;

/**
 * Type guard to check if an object has hits (is a Structure).
 */
function hasHits(obj: unknown): obj is { hits: number; hitsMax: number } {
  return typeof obj === "object" && obj !== null && "hits" in obj && "hitsMax" in obj;
}

interface StateValidityResult {
  valid: boolean;
  reason?: string;
  meta?: Record<string, unknown>;
}

/**
 * Check if a state is still valid (target exists, not expired, etc.)
 * Note: Stuck detection is handled by Cartographer's traffic management
 */
function getStateValidity(state: CreepState | undefined, ctx: CreepContext): StateValidityResult {
  if (!state) return { valid: false, reason: "noState" };

  // Check timeout
  const age = Game.time - state.startTick;
  if (age > state.timeout) {
    return {
      valid: false,
      reason: "expired",
      meta: { age, timeout: state.timeout }
    };
  }

  // Validate target if present
  if (state.targetId) {
    const target = Game.getObjectById(state.targetId);
    if (!target) {
      return {
        valid: false,
        reason: "missingTarget",
        meta: { targetId: state.targetId }
      };
    }
  }

  return { valid: true };
}

/**
 * Check if the current state represents a completed action.
 * 
 * OPTIMIZATION: Fast-path checks to avoid expensive Game.getObjectById calls.
 * We check capacity/position conditions first before validating targets.
 */
function isStateComplete(state: CreepState | undefined, ctx: CreepContext): boolean {
  if (!state) return true;

  switch (state.action) {
    case "harvest":
      // Harvest complete when full (executor handles depleted sources via ERR_NOT_ENOUGH_RESOURCES)
      if (ctx.isFull) return true;
      
      // Only check if target was destroyed
      if (state.targetId) {
        const target = Game.getObjectById(state.targetId);
        if (!target) return true; // Source destroyed
      }
      return false;

    case "harvestMineral":
      // Mineral harvest complete when full (executor handles depleted minerals)
      if (ctx.isFull) return true;
      
      // Only check if target was destroyed
      if (state.targetId) {
        const target = Game.getObjectById(state.targetId);
        if (!target) return true; // Mineral destroyed
      }
      return false;

    case "harvestDeposit":
      // Deposit harvest complete when full or deposit invalid
      if (ctx.isFull) return true;
      
      // Check if deposit still valid
      if (state.targetId) {
        const target = Game.getObjectById(state.targetId);
        if (!target) return true; // Deposit gone
        
        // Type guard for Deposit - check cooldown
        if (typeof target === "object" && "cooldown" in target) {
          const deposit = target as Deposit;
          // If deposit has high cooldown, consider it complete
          if (deposit.cooldown > DEPOSIT_COOLDOWN_THRESHOLD) return true;
        }
      }
      return false;

    case "pickup":
      // Pickup complete when full OR resource no longer exists
      if (ctx.isFull) return true;
      
      // Check if dropped resource still exists
      if (state.targetId) {
        const target = Game.getObjectById(state.targetId);
        if (!target) return true; // Resource picked up or decayed
      }
      return false;

    case "withdraw":
      // Withdraw complete when full (executor handles empty sources via ERR_NOT_ENOUGH_RESOURCES)
      if (ctx.isFull) return true;
      
      // Only check if target was destroyed
      if (state.targetId) {
        const target = Game.getObjectById(state.targetId);
        if (!target) return true; // Target destroyed
      }
      return false;

    case "transfer":
      // Transfer complete when empty (executor handles invalid targets via ERR_FULL)
      // Don't check if target is full here - that causes state to clear after each
      // partial transfer, making creeps appear to "idle" between targets
      if (ctx.isEmpty) return true;
      
      // Only check if target was destroyed
      if (state.targetId) {
        const target = Game.getObjectById(state.targetId);
        if (!target) return true; // Target destroyed
      }
      return false;

    case "build":
      // Build complete when empty OR construction site finished/destroyed
      if (ctx.isEmpty) return true;
      
      // Check if construction site still exists
      if (state.targetId) {
        const target = Game.getObjectById(state.targetId);
        if (!target) return true; // Site completed or destroyed
      }
      return false;

    case "repair":
      // Repair complete when empty OR structure fully repaired/destroyed
      if (ctx.isEmpty) return true;
      
      // Check if structure still needs repair
      if (state.targetId) {
        const target = Game.getObjectById(state.targetId);
        if (!target) return true; // Structure destroyed
        
        // Check if structure is fully repaired
        if (hasHits(target)) {
          // Consider repair complete if structure is at full health
          if (target.hits >= target.hitsMax) return true;
        }
      }
      return false;

    case "upgrade":
      // Upgrade complete when empty (controller can always be upgraded)
      return ctx.isEmpty;

    case "moveToRoom":
      // Movement complete when in target room
      // Uses state.targetRoom which is the temporary movement destination.
      // For remote creeps, memory.targetRoom is the permanent assignment (e.g., remote room)
      // while state.targetRoom might be different (e.g., home room when delivering resources).
      return state.targetRoom !== undefined && ctx.room.name === state.targetRoom;

    case "moveTo":
      // Movement complete when adjacent to or at target
      // OPTIMIZATION: Only validate target if we have a targetId
      // This avoids unnecessary Game.getObjectById calls
      if (state.targetId) {
        const target = Game.getObjectById(state.targetId);
        if (target && typeof target === "object" && "pos" in target) {
          const targetWithPos = target as { pos: RoomPosition };
          return ctx.creep.pos.inRangeTo(targetWithPos.pos, 1);
        }
      }

      if (state.targetPos) {
        const targetPos = new RoomPosition(
          state.targetPos.x,
          state.targetPos.y,
          state.targetPos.roomName
        );
        return ctx.creep.pos.inRangeTo(targetPos, 1);
      }

      return false;

    case "idle":
      // Idle is always complete (single tick action)
      return true;

    default:
      // Unknown action types are considered incomplete
      return false;
  }
}

/**
 * Convert an action to a state
 */
function actionToState(action: CreepAction, _ctx: CreepContext): CreepState {
  const state: CreepState = {
    action: action.type,
    startTick: Game.time,
    timeout: DEFAULT_STATE_TIMEOUT
  };

  // Extract target ID if present
  if ("target" in action && action.target && "id" in action.target) {
    state.targetId = action.target.id;
  }

  // Extract room name for room movement
  if (action.type === "moveToRoom") {
    state.targetRoom = action.roomName;
  }

  // Store serialized target position for moveTo actions without stable IDs (e.g., RoomPosition)
  if (action.type === "moveTo") {
    const pos = "pos" in action.target ? action.target.pos : action.target;
    state.targetPos = { x: pos.x, y: pos.y, roomName: pos.roomName };
  }

  // Store additional data based on action type
  if (action.type === "withdraw" || action.type === "transfer") {
    state.data = { resourceType: action.resourceType };
  }

  return state;
}

/**
 * Reconstruct an action from a stored state
 */
function stateToAction(state: CreepState): CreepAction | null {
  // Get target if present
  let target: RoomObject | null = null;
  if (state.targetId) {
    const obj = Game.getObjectById(state.targetId);
    if (!obj) {
      // Target no longer exists
      return null;
    }
    // Ensure the object is a RoomObject (has pos and room properties)
    if (typeof obj === "object" && "pos" in obj && "room" in obj) {
      target = obj as unknown as RoomObject;
    } else {
      return null;
    }
  }

  // Reconstruct action based on type
  switch (state.action) {
    case "harvest":
      return target ? { type: "harvest", target: target as Source } : null;

    case "harvestMineral":
      return target ? { type: "harvestMineral", target: target as Mineral } : null;

    case "harvestDeposit":
      return target ? { type: "harvestDeposit", target: target as Deposit } : null;

    case "pickup":
      return target ? { type: "pickup", target: target as Resource } : null;

    case "withdraw":
      if (target && state.data?.resourceType) {
        return {
          type: "withdraw",
          target: target as AnyStoreStructure,
          resourceType: state.data.resourceType as ResourceConstant
        };
      }
      return null;

    case "transfer":
      if (target && state.data?.resourceType) {
        return {
          type: "transfer",
          target: target as AnyStoreStructure,
          resourceType: state.data.resourceType as ResourceConstant
        };
      }
      return null;

    case "build":
      return target ? { type: "build", target: target as ConstructionSite } : null;

    case "repair":
      return target ? { type: "repair", target: target as Structure } : null;

    case "upgrade":
      return target ? { type: "upgrade", target: target as StructureController } : null;

    case "moveTo":
      if (target) {
        return { type: "moveTo", target };
      }

      if (state.targetPos) {
        const targetPos = new RoomPosition(
          state.targetPos.x,
          state.targetPos.y,
          state.targetPos.roomName
        );
        return { type: "moveTo", target: targetPos };
      }

      return null;

    case "moveToRoom":
      return state.targetRoom ? { type: "moveToRoom", roomName: state.targetRoom } : null;

    case "idle":
      return { type: "idle" };

    default:
      // Unknown action type
      return null;
  }
}

/**
 * Evaluate behavior with state machine logic.
 * 
 * If creep has a valid ongoing state, continue that action.
 * Otherwise, evaluate new behavior and commit to it.
 * 
 * REFACTORED: Added safety checks to prevent infinite loops
 * 
 * @param ctx Creep context
 * @param behaviorFn Behavior function to call when evaluating new action
 * @returns Action to execute
 */
export function evaluateWithStateMachine(
  ctx: CreepContext,
  behaviorFn: (ctx: CreepContext) => CreepAction
): CreepAction {

  const currentState = ctx.memory.state;

  // Check if we have a valid ongoing state
  const validity = getStateValidity(currentState, ctx);

  if (currentState && validity.valid) {
    // Check if state is complete
    if (isStateComplete(currentState, ctx)) {
      // State complete - clear it and evaluate new action
      logger.info("State completed, evaluating new action", {
        room: ctx.creep.pos.roomName,
        creep: ctx.creep.name,
        meta: { action: currentState.action, role: ctx.memory.role }
      });
      delete ctx.memory.state;
    } else {
      // State still ongoing - try to reconstruct and continue action
      const action = stateToAction(currentState);
      if (action) {
        return action;
      }
      // Failed to reconstruct - clear state and evaluate new
      logger.info("State reconstruction failed, re-evaluating behavior", {
        room: ctx.creep.pos.roomName,
        creep: ctx.creep.name,
        meta: { action: currentState.action, role: ctx.memory.role }
      });
      delete ctx.memory.state;
    }
  } else {
    // State invalid or expired - clear it
    if (currentState) {
      logger.info("State invalid, re-evaluating behavior", {
        room: ctx.creep.pos.roomName,
        creep: ctx.creep.name,
        meta: {
          action: currentState.action,
          role: ctx.memory.role,
          invalidReason: validity.reason,
          ...validity.meta
        }
      });
      delete ctx.memory.state;
    }
  }

  // No valid state - evaluate new action
  const newAction = behaviorFn(ctx);

  // REFACTORED: Safety check - if behavior returns null/undefined, default to idle
  // This prevents crashes if behavior functions have bugs
  if (!newAction || !newAction.type) {
    logger.warn("Behavior returned invalid action, defaulting to idle", {
      room: ctx.creep.pos.roomName,
      creep: ctx.creep.name,
      meta: { role: ctx.memory.role }
    });
    return { type: "idle" };
  }

  // Don't store state for idle actions (they complete immediately)
  if (newAction.type !== "idle") {
    // Commit to this new action
    ctx.memory.state = actionToState(newAction, ctx);
    logger.info("Committed new state action", {
      room: ctx.creep.pos.roomName,
      creep: ctx.creep.name,
      meta: {
        action: newAction.type,
        role: ctx.memory.role,
        targetId: ctx.memory.state?.targetId
      }
    });
  } else {
    logger.info("Behavior returned idle action", {
      room: ctx.creep.pos.roomName,
      creep: ctx.creep.name,
      meta: { role: ctx.memory.role }
    });
  }

  return newAction;
}
