/**
 * Energy Collection Utilities
 * 
 * Common energy collection functions for economy behaviors.
 */

import type { CreepAction, CreepContext } from "../../types";
import { findDistributedTarget } from "@ralphschuler/screeps-utils";
import { findCachedClosest } from "../../../cache";
import { cachedFindSources } from "../../../cache";
import { createLogger } from "../../../core/logger";

const logger = createLogger("EnergyCollection");

/**
 * Find energy to collect (common pattern for many roles).
 * Uses distributed target finding to prevent creeps from clustering on same container.
 *
 * BUGFIX: Changed from findCachedClosest to findDistributedTarget for containers
 * to prevent multiple creeps (larvaWorker, hauler) from selecting the same container
 * and blocking each other. This solves the deadlock where spawning a hauler causes
 * the larvaWorker to stop working.
 *
 * OPTIMIZATION: Still prioritize dropped resources and containers over room.find() calls.
 * Most rooms have containers set up, so we rarely need to fall back to harvesting.
 */
export function findEnergy(ctx: CreepContext): CreepAction {
  // 1. Dropped resources (use cached - they're transient and rarely contested)
  if (ctx.droppedResources.length > 0) {
    const closest = findCachedClosest(ctx.creep, ctx.droppedResources, "energy_drop", 5);
    if (closest) {
      logger.debug(`${ctx.creep.name} (${ctx.memory.role}) selecting dropped resource at ${closest.pos}`);
      return { type: "pickup", target: closest };
    }
  }

  // 2. Containers (use distributed - most contested resource!)
  // BUGFIX: Filter by capacity HERE for fresh state, not in room cache
  // BUGFIX: Use findDistributedTarget to prevent multiple creeps from selecting same container
  const containersWithEnergy = ctx.containers.filter(
    c => c.store.getUsedCapacity(RESOURCE_ENERGY) > 100
  );
  if (containersWithEnergy.length > 0) {
    const distributed = findDistributedTarget(ctx.creep, containersWithEnergy, "energy_container");
    if (distributed) {
      logger.debug(`${ctx.creep.name} (${ctx.memory.role}) selecting container ${distributed.id} at ${distributed.pos} with ${distributed.store.getUsedCapacity(RESOURCE_ENERGY)} energy`);
      return { type: "withdraw", target: distributed, resourceType: RESOURCE_ENERGY };
    } else {
      // BUGFIX: If distribution returns null (shouldn't happen but defensive), fall back to closest container
      logger.warn(`${ctx.creep.name} (${ctx.memory.role}) found ${containersWithEnergy.length} containers but distribution returned null, falling back to closest`);
      const fallback = ctx.creep.pos.findClosestByRange(containersWithEnergy);
      if (fallback) {
        logger.debug(`${ctx.creep.name} (${ctx.memory.role}) using fallback container ${fallback.id} at ${fallback.pos}`);
        return { type: "withdraw", target: fallback, resourceType: RESOURCE_ENERGY };
      }
    }
  }

  // 3. Storage (single target, no distribution needed)
  if (ctx.storage && ctx.storage.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
    logger.debug(`${ctx.creep.name} (${ctx.memory.role}) selecting storage at ${ctx.storage.pos}`);
    return { type: "withdraw", target: ctx.storage, resourceType: RESOURCE_ENERGY };
  }

  // 4. Harvest directly (use distributed to prevent clustering on sources)
  // NOTE: Using cachedFindSources + energy filter instead of FIND_SOURCES_ACTIVE cache
  const sources = cachedFindSources(ctx.room).filter(source => source.energy > 0);
  if (sources.length > 0) {
    const source = findDistributedTarget(ctx.creep, sources, "energy_source");
    if (source) {
      logger.debug(`${ctx.creep.name} (${ctx.memory.role}) selecting source ${source.id} at ${source.pos}`);
      return { type: "harvest", target: source };
    } else {
      // BUGFIX: If distribution returns null (shouldn't happen but defensive), fall back to closest source
      logger.warn(`${ctx.creep.name} (${ctx.memory.role}) found ${sources.length} sources but distribution returned null, falling back to closest`);
      const fallback = ctx.creep.pos.findClosestByRange(sources);
      if (fallback) {
        logger.debug(`${ctx.creep.name} (${ctx.memory.role}) using fallback source ${fallback.id} at ${fallback.pos}`);
        return { type: "harvest", target: fallback };
      }
    }
  }

  logger.warn(`${ctx.creep.name} (${ctx.memory.role}) findEnergy returning idle - no energy sources available`);
  return { type: "idle" };
}

/**
 * Deliver energy following the standard priority order.
 * Priority: Spawns → Extensions → Towers → Storage → Containers → Anything Else
 * Uses cached target finding to reduce CPU usage.
 * 
 * BUGFIX: Filter by capacity here, not in room cache, to get fresh capacity state.
 * Multiple creeps can fill structures in the same tick, making cached capacity stale.
 */
export function deliverEnergy(ctx: CreepContext): CreepAction | null {
  // 1. Spawns first (highest priority, cache for 5 ticks - they fill quickly)
  // BUGFIX: Filter by free capacity HERE for fresh state, not in room cache
  const spawns = ctx.spawnStructures.filter(
    (s): s is StructureSpawn => 
      s.structureType === STRUCTURE_SPAWN &&
      s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
  );
  if (spawns.length > 0) {
    const closest = findCachedClosest(ctx.creep, spawns, "deliver_spawn", 5);
    if (closest) return { type: "transfer", target: closest, resourceType: RESOURCE_ENERGY };
  }

  // 2. Extensions second (cache for 5 ticks - they fill quickly)
  const extensions = ctx.spawnStructures.filter(
    (s): s is StructureExtension => 
      s.structureType === STRUCTURE_EXTENSION &&
      s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
  );
  if (extensions.length > 0) {
    const closest = findCachedClosest(ctx.creep, extensions, "deliver_ext", 5);
    if (closest) return { type: "transfer", target: closest, resourceType: RESOURCE_ENERGY };
  }

  // 3. Towers third (cache for 10 ticks - they drain slower)
  // BUGFIX: Filter by free capacity HERE for fresh state, not in room cache
  // FIX: Lower threshold from 200 to 100 to keep towers better stocked for defense
  // Towers need to be kept full for rapid response to threats (ROADMAP.md Section 12)
  const towersWithCapacity = ctx.towers.filter(
    t => t.store.getFreeCapacity(RESOURCE_ENERGY) >= 100
  );
  if (towersWithCapacity.length > 0) {
    const closest = findCachedClosest(ctx.creep, towersWithCapacity, "deliver_tower", 10);
    if (closest) return { type: "transfer", target: closest, resourceType: RESOURCE_ENERGY };
  }

  // 4. Storage fourth
  if (ctx.storage && ctx.storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
    return { type: "transfer", target: ctx.storage, resourceType: RESOURCE_ENERGY };
  }

  // 5. Containers fifth (cache for 10 ticks)
  // BUGFIX: Filter by capacity HERE for fresh state, not in room cache
  const depositContainersWithCapacity = ctx.depositContainers.filter(
    c => c.store.getFreeCapacity(RESOURCE_ENERGY) > 0
  );
  if (depositContainersWithCapacity.length > 0) {
    const closest = findCachedClosest(ctx.creep, depositContainersWithCapacity, "deliver_cont", 10);
    if (closest) return { type: "transfer", target: closest, resourceType: RESOURCE_ENERGY };
  }

  return null;
}
