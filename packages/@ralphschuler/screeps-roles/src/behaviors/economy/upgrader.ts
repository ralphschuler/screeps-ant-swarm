/**
 * Upgrader Behavior
 * 
 * Upgrade the room controller.
 * Priority: deliver energy to spawns/extensions/towers first, then upgrade controller
 */

import type { CreepAction, CreepContext } from "../types";
import { findCachedClosest } from "../../cache";
import { updateWorkingState } from "./common/stateManagement";
import { cachedFindSources } from "../../cache";

/**
 * Upgrader - Upgrade the room controller.
 * Priority: deliver energy to spawns/extensions/towers first, then upgrade controller
 * OPTIMIZATION: Upgraders are stationary workers that benefit from long cache times
 * and stable behavior to maximize idle detection efficiency.
 */
export function upgrader(ctx: CreepContext): CreepAction {
  const isWorking = updateWorkingState(ctx);

  if (isWorking) {
    // Before upgrading, check if critical structures need energy
    // Priority: Spawns → Extensions → Towers → Upgrade
    // This ensures the room economy stays healthy while upgrading
    
    // 1. Check spawns first (highest priority)
    const spawns = ctx.spawnStructures.filter(
      (s): s is StructureSpawn => 
        s.structureType === STRUCTURE_SPAWN &&
        s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
    );
    if (spawns.length > 0) {
      const closest = findCachedClosest(ctx.creep, spawns, "upgrader_spawn", 5);
      if (closest) return { type: "transfer", target: closest, resourceType: RESOURCE_ENERGY };
    }

    // 2. Check extensions second
    const extensions = ctx.spawnStructures.filter(
      (s): s is StructureExtension => 
        s.structureType === STRUCTURE_EXTENSION &&
        s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
    );
    if (extensions.length > 0) {
      const closest = findCachedClosest(ctx.creep, extensions, "upgrader_ext", 5);
      if (closest) return { type: "transfer", target: closest, resourceType: RESOURCE_ENERGY };
    }

    // 3. Check towers third
    const towersWithCapacity = ctx.towers.filter(
      t => t.store.getFreeCapacity(RESOURCE_ENERGY) >= 100
    );
    if (towersWithCapacity.length > 0) {
      const closest = findCachedClosest(ctx.creep, towersWithCapacity, "upgrader_tower", 10);
      if (closest) return { type: "transfer", target: closest, resourceType: RESOURCE_ENERGY };
    }

    // 4. All critical structures filled - now upgrade controller
    if (ctx.room.controller) {
      return { type: "upgrade", target: ctx.room.controller };
    }
    return { type: "idle" };
  }

  // OPTIMIZATION: Find closest energy source ONCE and cache for long time (30 ticks)
  // Upgraders are stationary, so their energy source rarely changes
  // Priority: links near controller > containers near controller > storage > any container
  
  // Check for links near controller first (most efficient energy source)
  // Links are filled automatically by LinkManager from source links
  const controller = ctx.room.controller;
  if (controller) {
    const nearbyLinks = controller.pos.findInRange(FIND_MY_STRUCTURES, 2, {
      filter: s => 
        s.structureType === STRUCTURE_LINK &&
        (s as StructureLink).store.getUsedCapacity(RESOURCE_ENERGY) > 50
    }) as StructureLink[];
    
    if (nearbyLinks.length > 0) {
      // Prefer link with most energy
      const bestLink = nearbyLinks.reduce((a, b) => 
        a.store.getUsedCapacity(RESOURCE_ENERGY) > b.store.getUsedCapacity(RESOURCE_ENERGY) ? a : b
      );
      return { type: "withdraw", target: bestLink, resourceType: RESOURCE_ENERGY };
    }
  }
  
  // OPTIMIZATION: Cache nearby container search per creep
  // Upgraders are stationary so this rarely changes (30 tick cache)
  const nearbyContainersCacheKey = "upgrader_nearby_containers";
  const memory = ctx.creep.memory as unknown as { [key: string]: unknown };
  const cachedNearby = memory[nearbyContainersCacheKey] as { ids: Id<StructureContainer>[]; tick: number } | undefined;
  
  let nearbyContainers: StructureContainer[] = [];
  if (cachedNearby && Game.time - cachedNearby.tick < 30) {
    // Use cached IDs
    nearbyContainers = cachedNearby.ids
      .map(id => Game.getObjectById(id))
      .filter((c): c is StructureContainer => c !== null);
  } else {
    // Find nearby containers (within range 3 of upgrader position)
    // This allows upgraders to position near a container and controller for maximum efficiency
    nearbyContainers = ctx.creep.pos.findInRange(FIND_STRUCTURES, 3, {
      filter: s => s.structureType === STRUCTURE_CONTAINER &&
                   (s as StructureContainer).store.getUsedCapacity(RESOURCE_ENERGY) > 50
    }) as StructureContainer[];
    
    // Cache the IDs
    memory[nearbyContainersCacheKey] = {
      ids: nearbyContainers.map(c => c.id),
      tick: Game.time
    };
  }
  
  if (nearbyContainers.length > 0) {
    // Use the closest nearby container - this should be stable for idle detection
    const closest = findCachedClosest(ctx.creep, nearbyContainers, "upgrader_nearby", 30);
    if (closest) return { type: "withdraw", target: closest, resourceType: RESOURCE_ENERGY };
  }

  // Fallback to storage if available and has enough energy
  if (ctx.storage && ctx.storage.store.getUsedCapacity(RESOURCE_ENERGY) > 1000) {
    return { type: "withdraw", target: ctx.storage, resourceType: RESOURCE_ENERGY };
  }

  // Fallback to any container with energy
  // BUGFIX: Filter by capacity HERE for fresh state, not in room cache
  const containersWithEnergy = ctx.containers.filter(
    c => c.store.getUsedCapacity(RESOURCE_ENERGY) > 100
  );
  if (containersWithEnergy.length > 0) {
    const closest = findCachedClosest(ctx.creep, containersWithEnergy, "upgrader_cont", 30);
    if (closest) return { type: "withdraw", target: closest, resourceType: RESOURCE_ENERGY };
  }

  // Last resort: harvest from source (cache for 30 ticks)
  // NOTE: Using cachedFindSources + energy filter instead of FIND_SOURCES_ACTIVE cache
  const sources = cachedFindSources(ctx.room).filter(source => source.energy > 0);
  if (sources.length > 0) {
    const source = findCachedClosest(ctx.creep, sources, "upgrader_source", 30);
    if (source) return { type: "harvest", target: source };
  }

  return { type: "idle" };
}
