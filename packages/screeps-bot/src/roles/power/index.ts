/**
 * Power Roles
 *
 * Power creep roles:
 * - PowerQueen (economy-focused Operator)
 * - PowerWarrior (combat-support)
 * - PowerHarvester (regular creep for power banks)
 * - PowerCarrier (regular creep for carrying power)
 */

import {
  createContext,
  createPowerCreepContext,
  evaluatePowerBehavior,
  evaluatePowerCreepBehavior,
  executeAction,
  executePowerCreepAction
} from "@ralphschuler/screeps-roles";
import { evaluateWithStateMachine } from "@ralphschuler/screeps-roles";

/**
 * Run power-related creep role (PowerHarvester, PowerCarrier) with state machine.
 * Creeps commit to actions until completion, preventing sudden direction changes.
 */
export function runPowerCreepRole(creep: Creep): void {
  const ctx = createContext(creep);
  const action = evaluateWithStateMachine(ctx, evaluatePowerBehavior);
  executeAction(creep, action, ctx);
}

/**
 * Run Power Creep role (PowerQueen, PowerWarrior).
 */
export function runPowerRole(powerCreep: PowerCreep): void {
  const ctx = createPowerCreepContext(powerCreep);
  if (!ctx) return;

  const action = evaluatePowerCreepBehavior(ctx);
  executePowerCreepAction(powerCreep, action);
}

/**
 * Run PowerHarvester behavior.
 */
export function runPowerHarvester(creep: Creep): void {
  runPowerCreepRole(creep);
}

/**
 * Run PowerCarrier behavior.
 */
export function runPowerCarrier(creep: Creep): void {
  runPowerCreepRole(creep);
}
