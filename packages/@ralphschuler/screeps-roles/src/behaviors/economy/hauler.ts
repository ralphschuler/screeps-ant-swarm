/**
 * Hauler Behavior
 * 
 * Transport resources from various sources to appropriate destinations.
 * - Energy: harvesters → spawns/extensions/towers/storage
 * - Minerals: tombstones/dropped → terminal/storage
 * - Comprehensively empties tombstones to recover all resources
 * Uses cached target finding to reduce CPU usage.
 */

import type { CreepAction, CreepContext } from "../types";
import { findDistributedTarget } from "@ralphschuler/screeps-utils";
import { findCachedClosest } from "../../cache";
import { updateWorkingState, switchToCollectionMode } from "./common/stateManagement";
import { createLogger } from "@ralphschuler/screeps-core";

const logger = createLogger("HaulerBehavior");

/**
 * Hauler - Transport all resources to appropriate destinations.
 * - Energy to spawns/extensions/towers/storage
 * - Minerals to terminal/storage
 * - Empties tombstones completely to recover all resources
 * Uses cached target finding to reduce CPU usage.
 */
export function hauler(ctx: CreepContext): CreepAction {
  const isWorking = updateWorkingState(ctx);
  logger.debug(`${ctx.creep.name} hauler state: working=${isWorking}, energy=${ctx.creep.store.getUsedCapacity(RESOURCE_ENERGY)}/${ctx.creep.store.getCapacity()}`);

  if (isWorking) {
    // Check what resource we're carrying
    const carriedResources = Object.keys(ctx.creep.store) as ResourceConstant[];
    const resourceType = carriedResources[0];
    const energyCarried = ctx.creep.store.getUsedCapacity(RESOURCE_ENERGY);
    
    // If carrying minerals (not energy), deliver to terminal or storage
    if (energyCarried === 0 && resourceType && resourceType !== RESOURCE_ENERGY) {
      const target = ctx.terminal ?? ctx.storage;
      if (target) return { type: "transfer", target, resourceType };
    }
    
    // Deliver energy with priority: spawn > extensions > towers > storage > containers
    // OPTIMIZATION: Increased cache times to reduce pathfinding overhead
    // BUGFIX: Filter by capacity HERE for fresh state, not in room cache

    // 1. Spawns first (highest priority, cache 10 ticks - increased from 5)
    const spawns = ctx.spawnStructures.filter(
      (s): s is StructureSpawn => 
        s.structureType === STRUCTURE_SPAWN &&
        s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
    );
    if (spawns.length > 0) {
      const closest = findCachedClosest(ctx.creep, spawns, "hauler_spawn", 10);
      if (closest) {
        logger.debug(`${ctx.creep.name} hauler delivering to spawn ${closest.id}`);
        return { type: "transfer", target: closest, resourceType: RESOURCE_ENERGY };
      }
    }

    // 2. Extensions second (cache 10 ticks - increased from 5)
    const extensions = ctx.spawnStructures.filter(
      (s): s is StructureExtension => 
        s.structureType === STRUCTURE_EXTENSION &&
        s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
    );
    if (extensions.length > 0) {
      const closest = findCachedClosest(ctx.creep, extensions, "hauler_ext", 10);
      if (closest) return { type: "transfer", target: closest, resourceType: RESOURCE_ENERGY };
    }

    // 3. Towers third (cache 15 ticks - increased from 10)
    // FIX: Lower threshold from 200 to 100 to keep towers better stocked for defense
    // Towers need to be kept full for rapid response to threats (ROADMAP.md Section 12)
    const towersWithCapacity = ctx.towers.filter(
      t => t.store.getFreeCapacity(RESOURCE_ENERGY) >= 100
    );
    if (towersWithCapacity.length > 0) {
      const closest = findCachedClosest(ctx.creep, towersWithCapacity, "hauler_tower", 15);
      if (closest) return { type: "transfer", target: closest, resourceType: RESOURCE_ENERGY };
    }

    // 4. Storage fourth
    if (ctx.storage && ctx.storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
      return { type: "transfer", target: ctx.storage, resourceType: RESOURCE_ENERGY };
    }

    // 5. Containers last (cache 15 ticks - increased from 10)
    // BUGFIX: Filter by capacity HERE for fresh state, not in room cache
    const depositContainersWithCapacity = ctx.depositContainers.filter(
      c => c.store.getFreeCapacity(RESOURCE_ENERGY) > 0
    );
    if (depositContainersWithCapacity.length > 0) {
      const closest = findCachedClosest(ctx.creep, depositContainersWithCapacity, "hauler_cont", 15);
      if (closest) return { type: "transfer", target: closest, resourceType: RESOURCE_ENERGY };
    }

    // FIX: No valid delivery targets found, but creep still has energy
    // Switch to collection mode to top off capacity instead of idling
    // This prevents the deadlock where haulers with partial energy get stuck
    // in working=true state with no valid targets
    if (!ctx.isEmpty) {
      logger.debug(`${ctx.creep.name} hauler has energy but no targets, switching to collection mode`);
      switchToCollectionMode(ctx);
      // Fall through to collection logic below
    } else {
      logger.warn(`${ctx.creep.name} hauler idle (empty, working=true, no targets)`);
      return { type: "idle" };
    }
  }

  // Collect resources - priority order
  // BUGFIX: Use distributed targets for containers to prevent clustering with larvaWorkers
  // 1. Dropped resources (use cached - transient and rarely contested)
  // Collects all resource types, not just energy
  if (ctx.droppedResources.length > 0) {
    const closest = findCachedClosest(ctx.creep, ctx.droppedResources, "hauler_drop", 5);
    if (closest) return { type: "pickup", target: closest };
  }

  // 2. Tombstones (use cached - transient targets)
  // OPTIMIZATION: Use cached tombstones from room context to avoid expensive room.find()
  // BUGFIX: Filter by capacity HERE for fresh state, not in room cache
  // Collect ALL resources from tombstones, not just energy, to fully empty them
  const tombstonesWithResources = ctx.tombstones.filter(
    t => t.store.getUsedCapacity() > 0
  );
  if (tombstonesWithResources.length > 0) {
    const tombstone = findCachedClosest(ctx.creep, tombstonesWithResources, "hauler_tomb", 10);
    if (tombstone) {
      // Prioritize energy first, then other resources
      if (tombstone.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
        return { type: "withdraw", target: tombstone, resourceType: RESOURCE_ENERGY };
      }
      // If no energy, pick up any other resource type
      const resourceTypes = Object.keys(tombstone.store) as ResourceConstant[];
      const otherResource = resourceTypes.find(r => r !== RESOURCE_ENERGY && tombstone.store.getUsedCapacity(r) > 0);
      if (otherResource) {
        return { type: "withdraw", target: tombstone, resourceType: otherResource };
      }
    }
  }

  // 3. Containers with energy (use distributed - most contested!)
  // BUGFIX: Filter by capacity HERE for fresh state, not in room cache
  // BUGFIX: Use findDistributedTarget to prevent multiple haulers/larvaWorkers from same container
  const containersWithEnergy = ctx.containers.filter(
    c => c.store.getUsedCapacity(RESOURCE_ENERGY) > 100
  );
  if (containersWithEnergy.length > 0) {
    const distributed = findDistributedTarget(ctx.creep, containersWithEnergy, "energy_container");
    if (distributed) {
      logger.debug(`${ctx.creep.name} hauler withdrawing from container ${distributed.id} with ${distributed.store.getUsedCapacity(RESOURCE_ENERGY)} energy`);
      return { type: "withdraw", target: distributed, resourceType: RESOURCE_ENERGY };
    } else {
      // BUGFIX: If distribution returns null (shouldn't happen but defensive), fall back to closest container
      logger.warn(`${ctx.creep.name} hauler found ${containersWithEnergy.length} containers but distribution returned null, falling back to closest`);
      const fallback = ctx.creep.pos.findClosestByRange(containersWithEnergy);
      if (fallback) {
        logger.debug(`${ctx.creep.name} hauler using fallback container ${fallback.id}`);
        return { type: "withdraw", target: fallback, resourceType: RESOURCE_ENERGY };
      }
    }
  }

  // 4. Containers with minerals (use distributed for mineral transport)
  // OPTIMIZATION: Use cached mineral containers from room context to avoid expensive room.find()
  if (ctx.mineralContainers.length > 0) {
    const distributed = findDistributedTarget(ctx.creep, ctx.mineralContainers, "mineral_container");
    if (distributed) {
      // Find first mineral type in container using Object.keys for better performance
      const mineralType = Object.keys(distributed.store).find(
        r => r !== RESOURCE_ENERGY && distributed.store.getUsedCapacity(r as ResourceConstant) > 0
      ) as ResourceConstant | undefined;
      
      if (mineralType) {
        return { type: "withdraw", target: distributed, resourceType: mineralType };
      }
    } else {
      // BUGFIX: If distribution returns null (shouldn't happen but defensive), fall back to closest container
      logger.warn(`${ctx.creep.name} hauler found ${ctx.mineralContainers.length} mineral containers but distribution returned null, falling back to closest`);
      const fallback = ctx.creep.pos.findClosestByRange(ctx.mineralContainers);
      if (fallback) {
        const mineralType = Object.keys(fallback.store).find(
          r => r !== RESOURCE_ENERGY && fallback.store.getUsedCapacity(r as ResourceConstant) > 0
        ) as ResourceConstant | undefined;
        
        if (mineralType) {
          logger.debug(`${ctx.creep.name} hauler using fallback mineral container ${fallback.id}`);
          return { type: "withdraw", target: fallback, resourceType: mineralType };
        }
      }
    }
  }

  // 5. Storage (single target, no distribution needed)
  if (ctx.storage && ctx.storage.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
    logger.debug(`${ctx.creep.name} hauler withdrawing from storage`);
    return { type: "withdraw", target: ctx.storage, resourceType: RESOURCE_ENERGY };
  }

  logger.warn(`${ctx.creep.name} hauler idle (no energy sources found)`);
  return { type: "idle" };
}
