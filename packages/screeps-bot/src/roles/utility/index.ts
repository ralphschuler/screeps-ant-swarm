/**
 * Utility Roles
 *
 * Utility and support roles:
 * - ScoutAnt (exploration)
 * - ClaimAnt (claiming/reserving)
 * - Engineer (repairs, ramparts)
 * - RemoteWorker (remote mining)
 * - LinkManager
 * - TerminalManager
 */

import { createContext, evaluateUtilityBehavior, executeAction } from "@ralphschuler/screeps-roles";
import { evaluateWithStateMachine } from "@ralphschuler/screeps-roles";

/**
 * Run utility role behavior with state machine.
 * Creeps commit to actions until completion, preventing sudden direction changes.
 */
export function runUtilityRole(creep: Creep): void {
  const ctx = createContext(creep);
  const action = evaluateWithStateMachine(ctx, evaluateUtilityBehavior);
  executeAction(creep, action, ctx);
}
