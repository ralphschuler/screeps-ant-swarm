/**
 * Chemistry Planner - Reaction Chain Planning
 *
 * Plans and executes lab reactions:
 * - Target compound configuration
 * - Reaction chain calculation
 * - Intermediate product tracking
 * - Boost stockpile management
 *
 * Addresses Issue: #28
 */

import type { SwarmState } from "../memory/schemas";
import { logger } from "../core/logger";

/**
 * Reaction definition
 */
interface Reaction {
  /** Product */
  product: ResourceConstant;
  /** Input 1 */
  input1: ResourceConstant;
  /** Input 2 */
  input2: ResourceConstant;
  /** Priority (higher = more important) */
  priority: number;
}

/**
 * Reaction chains for all compounds
 */
const REACTIONS: Record<string, Reaction> = {
  // Tier 1 compounds
  [RESOURCE_HYDROXIDE]: {
    product: RESOURCE_HYDROXIDE,
    input1: RESOURCE_HYDROGEN,
    input2: RESOURCE_OXYGEN,
    priority: 10
  },
  [RESOURCE_ZYNTHIUM_KEANITE]: {
    product: RESOURCE_ZYNTHIUM_KEANITE,
    input1: RESOURCE_ZYNTHIUM,
    input2: RESOURCE_KEANIUM,
    priority: 10
  },
  [RESOURCE_UTRIUM_LEMERGITE]: {
    product: RESOURCE_UTRIUM_LEMERGITE,
    input1: RESOURCE_UTRIUM,
    input2: RESOURCE_LEMERGIUM,
    priority: 10
  },
  [RESOURCE_GHODIUM]: {
    product: RESOURCE_GHODIUM,
    input1: RESOURCE_ZYNTHIUM_KEANITE,
    input2: RESOURCE_UTRIUM_LEMERGITE,
    priority: 15
  },

  // Tier 2 compounds (boosts)
  [RESOURCE_UTRIUM_HYDRIDE]: {
    product: RESOURCE_UTRIUM_HYDRIDE,
    input1: RESOURCE_UTRIUM,
    input2: RESOURCE_HYDROGEN,
    priority: 20
  },
  [RESOURCE_UTRIUM_OXIDE]: {
    product: RESOURCE_UTRIUM_OXIDE,
    input1: RESOURCE_UTRIUM,
    input2: RESOURCE_OXYGEN,
    priority: 20
  },
  [RESOURCE_KEANIUM_HYDRIDE]: {
    product: RESOURCE_KEANIUM_HYDRIDE,
    input1: RESOURCE_KEANIUM,
    input2: RESOURCE_HYDROGEN,
    priority: 20
  },
  [RESOURCE_KEANIUM_OXIDE]: {
    product: RESOURCE_KEANIUM_OXIDE,
    input1: RESOURCE_KEANIUM,
    input2: RESOURCE_OXYGEN,
    priority: 20
  },
  [RESOURCE_LEMERGIUM_HYDRIDE]: {
    product: RESOURCE_LEMERGIUM_HYDRIDE,
    input1: RESOURCE_LEMERGIUM,
    input2: RESOURCE_HYDROGEN,
    priority: 20
  },
  [RESOURCE_LEMERGIUM_OXIDE]: {
    product: RESOURCE_LEMERGIUM_OXIDE,
    input1: RESOURCE_LEMERGIUM,
    input2: RESOURCE_OXYGEN,
    priority: 20
  },
  [RESOURCE_ZYNTHIUM_HYDRIDE]: {
    product: RESOURCE_ZYNTHIUM_HYDRIDE,
    input1: RESOURCE_ZYNTHIUM,
    input2: RESOURCE_HYDROGEN,
    priority: 20
  },
  [RESOURCE_ZYNTHIUM_OXIDE]: {
    product: RESOURCE_ZYNTHIUM_OXIDE,
    input1: RESOURCE_ZYNTHIUM,
    input2: RESOURCE_OXYGEN,
    priority: 20
  },
  [RESOURCE_GHODIUM_HYDRIDE]: {
    product: RESOURCE_GHODIUM_HYDRIDE,
    input1: RESOURCE_GHODIUM,
    input2: RESOURCE_HYDROGEN,
    priority: 20
  },
  [RESOURCE_GHODIUM_OXIDE]: {
    product: RESOURCE_GHODIUM_OXIDE,
    input1: RESOURCE_GHODIUM,
    input2: RESOURCE_OXYGEN,
    priority: 20
  },

  // Tier 3 compounds (advanced boosts)
  [RESOURCE_UTRIUM_ACID]: {
    product: RESOURCE_UTRIUM_ACID,
    input1: RESOURCE_UTRIUM_HYDRIDE,
    input2: RESOURCE_HYDROXIDE,
    priority: 30
  },
  [RESOURCE_UTRIUM_ALKALIDE]: {
    product: RESOURCE_UTRIUM_ALKALIDE,
    input1: RESOURCE_UTRIUM_OXIDE,
    input2: RESOURCE_HYDROXIDE,
    priority: 30
  },
  [RESOURCE_KEANIUM_ACID]: {
    product: RESOURCE_KEANIUM_ACID,
    input1: RESOURCE_KEANIUM_HYDRIDE,
    input2: RESOURCE_HYDROXIDE,
    priority: 30
  },
  [RESOURCE_KEANIUM_ALKALIDE]: {
    product: RESOURCE_KEANIUM_ALKALIDE,
    input1: RESOURCE_KEANIUM_OXIDE,
    input2: RESOURCE_HYDROXIDE,
    priority: 30
  },
  [RESOURCE_LEMERGIUM_ACID]: {
    product: RESOURCE_LEMERGIUM_ACID,
    input1: RESOURCE_LEMERGIUM_HYDRIDE,
    input2: RESOURCE_HYDROXIDE,
    priority: 30
  },
  [RESOURCE_LEMERGIUM_ALKALIDE]: {
    product: RESOURCE_LEMERGIUM_ALKALIDE,
    input1: RESOURCE_LEMERGIUM_OXIDE,
    input2: RESOURCE_HYDROXIDE,
    priority: 30
  },
  [RESOURCE_ZYNTHIUM_ACID]: {
    product: RESOURCE_ZYNTHIUM_ACID,
    input1: RESOURCE_ZYNTHIUM_HYDRIDE,
    input2: RESOURCE_HYDROXIDE,
    priority: 30
  },
  [RESOURCE_ZYNTHIUM_ALKALIDE]: {
    product: RESOURCE_ZYNTHIUM_ALKALIDE,
    input1: RESOURCE_ZYNTHIUM_OXIDE,
    input2: RESOURCE_HYDROXIDE,
    priority: 30
  },
  [RESOURCE_GHODIUM_ACID]: {
    product: RESOURCE_GHODIUM_ACID,
    input1: RESOURCE_GHODIUM_HYDRIDE,
    input2: RESOURCE_HYDROXIDE,
    priority: 30
  },
  [RESOURCE_GHODIUM_ALKALIDE]: {
    product: RESOURCE_GHODIUM_ALKALIDE,
    input1: RESOURCE_GHODIUM_OXIDE,
    input2: RESOURCE_HYDROXIDE,
    priority: 30
  },

  // Tier 4 compounds (catalyzed boosts)
  [RESOURCE_CATALYZED_UTRIUM_ACID]: {
    product: RESOURCE_CATALYZED_UTRIUM_ACID,
    input1: RESOURCE_UTRIUM_ACID,
    input2: RESOURCE_CATALYST,
    priority: 40
  },
  [RESOURCE_CATALYZED_UTRIUM_ALKALIDE]: {
    product: RESOURCE_CATALYZED_UTRIUM_ALKALIDE,
    input1: RESOURCE_UTRIUM_ALKALIDE,
    input2: RESOURCE_CATALYST,
    priority: 40
  },
  [RESOURCE_CATALYZED_KEANIUM_ACID]: {
    product: RESOURCE_CATALYZED_KEANIUM_ACID,
    input1: RESOURCE_KEANIUM_ACID,
    input2: RESOURCE_CATALYST,
    priority: 40
  },
  [RESOURCE_CATALYZED_KEANIUM_ALKALIDE]: {
    product: RESOURCE_CATALYZED_KEANIUM_ALKALIDE,
    input1: RESOURCE_KEANIUM_ALKALIDE,
    input2: RESOURCE_CATALYST,
    priority: 40
  },
  [RESOURCE_CATALYZED_LEMERGIUM_ACID]: {
    product: RESOURCE_CATALYZED_LEMERGIUM_ACID,
    input1: RESOURCE_LEMERGIUM_ACID,
    input2: RESOURCE_CATALYST,
    priority: 40
  },
  [RESOURCE_CATALYZED_LEMERGIUM_ALKALIDE]: {
    product: RESOURCE_CATALYZED_LEMERGIUM_ALKALIDE,
    input1: RESOURCE_LEMERGIUM_ALKALIDE,
    input2: RESOURCE_CATALYST,
    priority: 40
  },
  [RESOURCE_CATALYZED_ZYNTHIUM_ACID]: {
    product: RESOURCE_CATALYZED_ZYNTHIUM_ACID,
    input1: RESOURCE_ZYNTHIUM_ACID,
    input2: RESOURCE_CATALYST,
    priority: 40
  },
  [RESOURCE_CATALYZED_ZYNTHIUM_ALKALIDE]: {
    product: RESOURCE_CATALYZED_ZYNTHIUM_ALKALIDE,
    input1: RESOURCE_ZYNTHIUM_ALKALIDE,
    input2: RESOURCE_CATALYST,
    priority: 40
  },
  [RESOURCE_CATALYZED_GHODIUM_ACID]: {
    product: RESOURCE_CATALYZED_GHODIUM_ACID,
    input1: RESOURCE_GHODIUM_ACID,
    input2: RESOURCE_CATALYST,
    priority: 40
  },
  [RESOURCE_CATALYZED_GHODIUM_ALKALIDE]: {
    product: RESOURCE_CATALYZED_GHODIUM_ALKALIDE,
    input1: RESOURCE_GHODIUM_ALKALIDE,
    input2: RESOURCE_CATALYST,
    priority: 40
  }
};

/**
 * Target stockpile amounts
 */
const STOCKPILE_TARGETS: Record<string, number> = {
  // War mode boosts
  [RESOURCE_CATALYZED_UTRIUM_ACID]: 3000,
  [RESOURCE_CATALYZED_KEANIUM_ALKALIDE]: 3000,
  [RESOURCE_CATALYZED_LEMERGIUM_ALKALIDE]: 3000,
  [RESOURCE_CATALYZED_GHODIUM_ACID]: 3000,

  // Eco mode boosts
  [RESOURCE_CATALYZED_GHODIUM_ALKALIDE]: 2000,
  [RESOURCE_CATALYZED_ZYNTHIUM_ALKALIDE]: 2000,

  // Intermediates
  [RESOURCE_GHODIUM]: 5000,
  [RESOURCE_HYDROXIDE]: 5000
};

/**
 * Chemistry Planner Class
 */
export class ChemistryPlanner {
  /**
   * Plan reactions for a room
   */
  public planReactions(room: Room, swarm: SwarmState): Reaction | null {
    // Get available labs
    const labs = room.find(FIND_MY_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_LAB
    }) ;

    if (labs.length < 3) {
      return null; // Need at least 3 labs for reactions
    }

    // Get terminal resources
    const terminal = room.terminal;
    if (!terminal) {
      return null; // Need terminal for resource management
    }

    // Determine target compounds based on posture
    const targets = this.getTargetCompounds(swarm);

    // Find reactions we need to run
    for (const target of targets) {
      const reaction = REACTIONS[target];
      if (!reaction) continue;

      // Check if we have enough of this compound
      const current = terminal.store[target] ?? 0;
      const targetAmount = STOCKPILE_TARGETS[target] ?? 1000;

      if (current < targetAmount) {
        // Check if we have inputs
        if (this.hasInputs(terminal, reaction)) {
          return reaction;
        } else {
          // Need to produce intermediates first
          const intermediate = this.findIntermediateReaction(terminal, reaction);
          if (intermediate) {
            return intermediate;
          }
        }
      }
    }

    return null;
  }

  /**
   * Get target compounds based on swarm state
   */
  private getTargetCompounds(swarm: SwarmState): ResourceConstant[] {
    const targets: ResourceConstant[] = [];

    // Always produce ghodium and hydroxide
    targets.push(RESOURCE_GHODIUM, RESOURCE_HYDROXIDE);

    // War mode: prioritize combat boosts
    if (swarm.posture === "war" || swarm.posture === "siege" || swarm.danger >= 2) {
      targets.push(
        RESOURCE_CATALYZED_UTRIUM_ACID, // Attack
        RESOURCE_CATALYZED_KEANIUM_ALKALIDE, // Ranged attack
        RESOURCE_CATALYZED_LEMERGIUM_ALKALIDE, // Heal
        RESOURCE_CATALYZED_GHODIUM_ACID // Dismantle
      );
    } else {
      // Eco mode: prioritize economy boosts
      targets.push(
        RESOURCE_CATALYZED_GHODIUM_ALKALIDE, // Upgrade controller
        RESOURCE_CATALYZED_ZYNTHIUM_ALKALIDE, // Move
        RESOURCE_CATALYZED_LEMERGIUM_ALKALIDE // Heal (always useful)
      );
    }

    return targets;
  }

  /**
   * Check if terminal has inputs for reaction
   */
  private hasInputs(terminal: StructureTerminal, reaction: Reaction): boolean {
    const input1Amount = terminal.store[reaction.input1] ?? 0;
    const input2Amount = terminal.store[reaction.input2] ?? 0;
    return input1Amount >= 1000 && input2Amount >= 1000;
  }

  /**
   * Find intermediate reaction needed to produce target
   */
  private findIntermediateReaction(terminal: StructureTerminal, target: Reaction): Reaction | null {
    // Check if we need to produce input1
    if ((terminal.store[target.input1] ?? 0) < 1000) {
      const intermediate = REACTIONS[target.input1];
      if (intermediate && this.hasInputs(terminal, intermediate)) {
        return intermediate;
      }
    }

    // Check if we need to produce input2
    if ((terminal.store[target.input2] ?? 0) < 1000) {
      const intermediate = REACTIONS[target.input2];
      if (intermediate && this.hasInputs(terminal, intermediate)) {
        return intermediate;
      }
    }

    return null;
  }

  /**
   * Execute reaction in labs
   */
  public executeReaction(room: Room, reaction: Reaction): void {
    const labs = room.find(FIND_MY_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_LAB
    }) as StructureLab[];

    if (labs.length < 3) return;

    // Use first 2 labs as input labs, rest as output labs
    const inputLab1 = labs[0];
    const inputLab2 = labs[1];
    const outputLabs = labs.slice(2);

    // Ensure input labs have correct resources
    if (inputLab1.mineralType !== reaction.input1 || inputLab1.store[reaction.input1] < 500) {
      // Need to load input1
      logger.debug(`Lab ${inputLab1.id} needs ${reaction.input1}`, { subsystem: "Chemistry" });
    }

    if (inputLab2.mineralType !== reaction.input2 || inputLab2.store[reaction.input2] < 500) {
      // Need to load input2
      logger.debug(`Lab ${inputLab2.id} needs ${reaction.input2}`, { subsystem: "Chemistry" });
    }

    // Run reactions in output labs
    for (const outputLab of outputLabs) {
      if (outputLab.cooldown > 0) continue;

      // Check if lab is full
      const freeCapacity = outputLab.store.getFreeCapacity();
      if (freeCapacity !== null && freeCapacity < 100) {
        logger.debug(`Lab ${outputLab.id} is full, needs unloading`, { subsystem: "Chemistry" });
        continue;
      }

      const result = outputLab.runReaction(inputLab1, inputLab2);
      if (result === OK) {
        logger.debug(`Produced ${reaction.product} in lab ${outputLab.id}`, { subsystem: "Chemistry" });
      }
    }
  }
}

/**
 * Global chemistry planner instance
 */
export const chemistryPlanner = new ChemistryPlanner();
