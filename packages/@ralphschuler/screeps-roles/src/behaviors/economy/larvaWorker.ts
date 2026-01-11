/**
 * Larva Worker Behavior
 * 
 * General purpose starter creep.
 * Priority: deliver energy (spawns→extensions→towers→storage→containers) → build → upgrade
 */

import type { CreepAction, CreepContext } from "../types";
import { updateWorkingState, switchToCollectionMode } from "./common/stateManagement";
import { deliverEnergy, findEnergy } from "./common/energyManagement";
import { getPheromones, needsBuilding, needsUpgrading } from "../pheromoneHelper";
import { createLogger } from "@ralphschuler/screeps-core";

const logger = createLogger("LarvaWorkerBehavior");

/**
 * LarvaWorker - General purpose starter creep.
 * Priority: deliver energy (spawns→extensions→towers→storage→containers) → build → upgrade
 */
export function larvaWorker(ctx: CreepContext): CreepAction {
  const isWorking = updateWorkingState(ctx);

  if (isWorking) {
    logger.debug(`${ctx.creep.name} larvaWorker working with ${ctx.creep.store.getUsedCapacity(RESOURCE_ENERGY)} energy`);
    // Try to deliver energy following standard priority: spawns→extensions→towers→storage→containers
    const deliverAction = deliverEnergy(ctx);
    if (deliverAction) {
      logger.debug(`${ctx.creep.name} larvaWorker delivering via ${deliverAction.type}`);
      return deliverAction;
    }

    // Use pheromones to decide between building and upgrading
    // This allows room-wide coordination through stigmergic communication
    const pheromones = getPheromones(ctx.creep);
    if (pheromones) {
      // Prioritize building if build pheromone is high
      if (needsBuilding(pheromones) && ctx.prioritizedSites.length > 0) {
        return { type: "build", target: ctx.prioritizedSites[0]! };
      }

      // Prioritize upgrading if upgrade pheromone is high
      if (needsUpgrading(pheromones) && ctx.room.controller) {
        return { type: "upgrade", target: ctx.room.controller };
      }
    }

    // Default priority: build then upgrade
    if (ctx.prioritizedSites.length > 0) {
      logger.debug(`${ctx.creep.name} larvaWorker building site`);
      return { type: "build", target: ctx.prioritizedSites[0]! };
    }

    if (ctx.room.controller) {
      return { type: "upgrade", target: ctx.room.controller };
    }

    // FIX: No valid work targets found, but creep still has energy
    // Switch to collection mode to top off capacity instead of idling
    // This prevents deadlock where larvaWorkers with partial energy get stuck
    // in working=true state with no valid targets
    if (!ctx.isEmpty) {
      logger.debug(`${ctx.creep.name} larvaWorker has energy but no targets, switching to collection mode`);
      switchToCollectionMode(ctx);
      // After switching to collection mode, exit working block and call findEnergy() below
    } else {
      // This should never happen (working=true but isEmpty=true), but log it as a warning
      logger.warn(`${ctx.creep.name} larvaWorker idle (empty, working=true, no targets) - this indicates a bug`);
      return { type: "idle" };
    }
  }

  return findEnergy(ctx);
}
