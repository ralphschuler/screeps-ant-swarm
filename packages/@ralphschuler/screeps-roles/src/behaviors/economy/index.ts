/**
 * Economy Behaviors
 *
 * Simple, human-readable behavior functions for economy roles.
 * Each function evaluates the situation and returns an action.
 * 
 * TODO(P2): ARCH - Implement priority-based task assignment for economy roles
 * Critical tasks (spawn refill) should override normal tasks
 * TODO(P3): FEATURE - Add behavior efficiency tracking per role
 * Measure resource throughput and optimize behaviors
 * TODO(P3): PERF - Consider implementing opportunistic multi-tasking
 * Creeps could do secondary tasks while moving (e.g., pick up energy)
 * TODO(P2): ARCH - Add adaptive behavior based on room state
 * Behavior priority should adjust based on room needs
 * TODO(P2): PERF - Implement path reuse between similar behaviors
 * Harvesters and haulers use similar paths, could share
 * TODO(P3): ARCH - Add behavior composability for complex roles
 * Combine simple behaviors into more sophisticated strategies
 * 
 * Test Coverage: 53% (economy behaviors) - Tests exist for:
 * - harvester.test.ts - Harvester behavior decision logic
 * - hauler.test.ts - Hauler behavior and energy management
 * - larvaWorker.test.ts - Bootstrap worker behavior
 * - upgrader.test.ts - Controller upgrade logic
 * TODO(P3): TEST - Add tests for builder, mineralHarvester, and depositHarvester behaviors
 */

import type { CreepAction, CreepContext } from "../types";
import { larvaWorker } from "./larvaWorker";
import { harvester } from "./harvester";
import { hauler } from "./hauler";
import { upgrader } from "./upgrader";
import { builder } from "./builder";
import { mineralHarvester, depositHarvester } from "./mining";
import { remoteHarvester, remoteHauler } from "./remote";
import { queenCarrier, labTech, factoryWorker } from "./specialized";
import { interRoomCarrier } from "./interRoom";
import { labSupply } from "../labSupply";

const economyBehaviors: Record<string, (ctx: CreepContext) => CreepAction> = {
  larvaWorker,
  harvester,
  hauler,
  builder,
  upgrader,
  queenCarrier,
  mineralHarvester,
  depositHarvester,
  labTech,
  labSupply,
  factoryWorker,
  remoteHarvester,
  remoteHauler,
  interRoomCarrier
};

/**
 * Evaluate and return an action for an economy role creep.
 */
export function evaluateEconomyBehavior(ctx: CreepContext): CreepAction {
  const behavior = economyBehaviors[ctx.memory.role] ?? larvaWorker;
  return behavior(ctx);
}

// Export individual behaviors with backward-compatible names
export { harvester as harvestBehavior };
export { hauler as haulBehavior };
export { builder as buildBehavior };
export { upgrader as upgradeBehavior };
