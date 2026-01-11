/**
 * Economy Roles
 *
 * All economy-focused creep roles:
 * - LarvaWorker (unified starter)
 * - Harvester (stationary miner)
 * - Hauler (transport)
 * - Builder
 * - Upgrader
 * - QueenCarrier (distributor)
 * - MineralHarvester
 * - DepositHarvester
 * - LabTech
 * - FactoryWorker
 */

import { createContext, evaluateEconomyBehavior, executeAction } from "@ralphschuler/screeps-roles";
import { evaluateWithStateMachine } from "@ralphschuler/screeps-roles";

/**
 * Run economy role behavior with state machine.
 * Creeps commit to actions until completion, preventing sudden direction changes.
 */
export function runEconomyRole(creep: Creep): void {
  const ctx = createContext(creep);
  const action = evaluateWithStateMachine(ctx, evaluateEconomyBehavior);
  executeAction(creep, action, ctx);
}
