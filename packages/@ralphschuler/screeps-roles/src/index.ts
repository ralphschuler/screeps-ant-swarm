/**
 * @ralphschuler/screeps-roles
 * 
 * Reusable role behaviors and framework for Screeps bots.
 * 
 * This package provides:
 * - Behavior framework (context, types, execution)
 * - Composable behaviors for common tasks
 * - Complete role implementations
 * 
 * @packageDocumentation
 */

// =============================================================================
// Behavior Framework (from behaviors directory - the canonical implementation)
// =============================================================================

// Context management
export { 
  createContext, 
  clearRoomCaches
} from "./behaviors/context";

/**
 * Register a callback to clear military behavior caches.
 * This is used by the military behavior module to hook into the cache clearing system.
 * @see clearRoomCaches for the function that triggers all cache clearing
 */
export { registerMilitaryCacheClear } from "./behaviors/context";

// Types
export type { 
  CreepContext,
  CreepAction,
  BehaviorFunction
} from "./behaviors/types";

// Executor
export { executeAction } from "./behaviors/executor";

// State machine
export { evaluateWithStateMachine } from "./behaviors/stateMachine";

// =============================================================================
// Economy Behaviors
// =============================================================================

export {
  harvestBehavior,
  haulBehavior,
  buildBehavior,
  upgradeBehavior,
  evaluateEconomyBehavior
} from "./behaviors/economy";

// Export individual economy behavior functions
export { larvaWorker } from "./behaviors/economy/larvaWorker";
export { harvester } from "./behaviors/economy/harvester";
export { hauler } from "./behaviors/economy/hauler";
export { upgrader } from "./behaviors/economy/upgrader";
export { remoteHauler } from "./behaviors/economy/remote";

// =============================================================================
// Pheromone System
// =============================================================================

export {
  getPheromones,
  getRoomPheromones,
  isPheromoneElevated,
  getDominantPheromone,
  needsDefense,
  needsBuilding,
  needsHarvesting,
  needsUpgrading,
  needsLogistics,
  getPriorityMultiplier,
  getOptimalRoleFocus,
  shouldPrioritizeDefense,
  shouldActivateEmergencyMode,
  getActionPriorities
} from "./behaviors/pheromoneHelper";

// =============================================================================
// Military Behaviors
// =============================================================================

export {
  guard,
  remoteGuard,
  healer,
  soldier,
  siege,
  harasser,
  ranger,
  evaluateMilitaryBehavior
} from "./behaviors/military";

// =============================================================================
// Power Behaviors
// =============================================================================

export {
  createPowerCreepContext,
  evaluatePowerBehavior,
  evaluatePowerCreepBehavior,
  executePowerCreepAction
} from "./behaviors/power";

// =============================================================================
// Utility Behaviors
// =============================================================================

export {
  scout,
  claimer,
  engineer,
  remoteWorker,
  linkManager,
  terminalManager,
  evaluateUtilityBehavior
} from "./behaviors/utility";

// =============================================================================
// Role Implementations
// =============================================================================

export { runEconomyRole } from "./roles/economy";
export { runMilitaryRole } from "./roles/military";
export { runUtilityRole } from "./roles/utility";
export { runPowerRole } from "./roles/power";
