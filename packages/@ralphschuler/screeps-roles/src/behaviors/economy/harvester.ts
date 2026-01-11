/**
 * Harvester Behavior
 * 
 * Stationary miner at a source.
 * Sits at source, harvests, and transfers to nearby container/link.
 */

import type { SwarmCreepMemory } from "../../memory/schemas";
import type { CreepAction, CreepContext } from "../types";
import { cachedFindSources } from "../../cache";
import { createLogger } from "@ralphschuler/screeps-core";
import { getAssignedSource } from "../../economy/targetAssignmentManager";

const logger = createLogger("HarvesterBehavior");

/**
 * Cache duration for stationary harvester structures (containers, links).
 * Harvesters are stationary workers, so their nearby structures rarely change.
 * 50 ticks provides good balance between CPU savings and responsiveness to changes.
 */
const HARVESTER_CACHE_DURATION = 50;

/**
 * Harvester - Stationary miner at a source.
 * Sits at source, harvests, and transfers to nearby container/link.
 * 
 * OPTIMIZATION: Harvesters are stationary workers - cache their nearby structures
 * to avoid repeated findInRange calls which are expensive.
 * 
 * OPTIMIZATION: Use centralized target assignment manager for O(1) source lookup
 * instead of O(n) search per creep. See targetAssignmentManager.ts for details.
 */
export function harvester(ctx: CreepContext): CreepAction {
  // OPTIMIZATION: Use centralized assignment manager (O(1) lookup)
  // instead of per-creep source search (O(n) complexity)
  let source = getAssignedSource(ctx.creep);
  
  // Fallback to context-assigned source if manager hasn't assigned yet
  if (!source) {
    source = ctx.assignedSource;
  }

  // Final fallback to manual assignment (for backward compatibility)
  if (!source) {
    source = assignSource(ctx);
    logger.debug(`${ctx.creep.name} harvester assigned to source ${source?.id}`);
  }

  if (!source) {
    logger.warn(`${ctx.creep.name} harvester has no source to harvest`);
    return { type: "idle" };
  }

  // Move to source if not nearby
  if (!ctx.creep.pos.isNearTo(source)) {
    return { type: "moveTo", target: source };
  }

  // At source - harvest or transfer
  // Check if creep can harvest: either has no carry capacity (drop miner) or has free space
  // Note: store.getCapacity() returns null for creeps without CARRY parts
  const carryCapacity = ctx.creep.store.getCapacity();
  const hasFreeCapacity = ctx.creep.store.getFreeCapacity() > 0;

  if (carryCapacity === null || carryCapacity === 0 || hasFreeCapacity) {
    return { type: "harvest", target: source };
  }

  // OPTIMIZATION: Full - find nearby container or link using cached lookup
  // Since harvesters are stationary, we cache the nearby structures for 50 ticks
  // to avoid expensive findInRange calls every tick
  const container = findNearbyContainerCached(ctx.creep);
  if (container) {
    logger.debug(`${ctx.creep.name} harvester transferring to container ${container.id}`);
    return { type: "transfer", target: container, resourceType: RESOURCE_ENERGY };
  }

  const link = findNearbyLinkCached(ctx.creep);
  if (link) {
    logger.debug(`${ctx.creep.name} harvester transferring to link ${link.id}`);
    return { type: "transfer", target: link, resourceType: RESOURCE_ENERGY };
  }

  // Drop on ground for haulers
  logger.debug(`${ctx.creep.name} harvester dropping energy on ground`);
  return { type: "drop", resourceType: RESOURCE_ENERGY };
}

/**
 * Assign a source to a harvester, trying to balance load.
 * 
 * Iterates through all creeps globally to count harvesters assigned to each source.
 * This ensures spawning/traveling harvesters are counted, preventing duplicate assignments.
 * 
 * The source counts are cached per room per tick to avoid recalculating for multiple
 * harvesters spawning in the same tick.
 */
function assignSource(ctx: CreepContext): Source | null {
  const sources = cachedFindSources(ctx.room);
  if (sources.length === 0) return null;

  // Cache source counts per room per tick
  const cacheKey = `sourceCounts_${ctx.room.name}`;
  const cacheTickKey = `sourceCounts_tick_${ctx.room.name}`;
  const globalCache = global as unknown as Record<string, Map<string, number> | number | undefined>;
  const cachedCounts = globalCache[cacheKey] as Map<string, number> | undefined;
  const cachedTick = globalCache[cacheTickKey] as number | undefined;

  let sourceCounts: Map<string, number>;
  if (cachedCounts && cachedTick === Game.time) {
    sourceCounts = cachedCounts;
  } else {
    // Count creeps assigned to each source
    sourceCounts = new Map<string, number>();
    for (const s of sources) {
      sourceCounts.set(s.id, 0);
    }

    // BUGFIX: Count ALL harvesters assigned to sources in this room, not just those present
    // Previously used ctx.room.find(FIND_MY_CREEPS), which missed spawning/traveling creeps
    // This caused multiple harvesters to be assigned to the same source when only one was in the room
    // 
    // TRADEOFF: This iterates all creeps globally (O(all_creeps)) instead of room creeps (O(room_creeps))
    // We trade some performance for correctness. The filter is very efficient (just role + sourceId check)
    // and the issue only manifests during spawning/early game when correctness is most critical.
    // Alternative considered: tracking spawning creeps separately, but adds complexity.
    for (const name in Game.creeps) {
      const c = Game.creeps[name];
      const m = c.memory as unknown as SwarmCreepMemory;
      // Only count harvesters that have a sourceId AND are assigned to sources in THIS room
      // This includes spawning creeps, creeps traveling to the room, and creeps temporarily in other rooms
      if (m.role === "harvester" && m.sourceId && sourceCounts.has(m.sourceId)) {
        sourceCounts.set(m.sourceId, (sourceCounts.get(m.sourceId) ?? 0) + 1);
      }
    }

    globalCache[cacheKey] = sourceCounts;
    globalCache[cacheTickKey] = Game.time;
  }

  // Find least assigned source
  let bestSource: Source | null = null;
  let minCount = Infinity;
  for (const s of sources) {
    const count = sourceCounts.get(s.id) ?? 0;
    if (count < minCount) {
      minCount = count;
      bestSource = s;
    }
  }

  if (bestSource) {
    ctx.memory.sourceId = bestSource.id;
  }

  return bestSource;
}

/**
 * OPTIMIZATION: Cached version of findNearbyContainer for stationary harvesters.
 * Caches the container ID for HARVESTER_CACHE_DURATION ticks to avoid repeated findInRange calls.
 * Harvesters are stationary, so their nearby structures don't change often.
 * 
 * Optimization strategy: We cache the expensive findInRange operation but always check capacity
 * since it's cheap (just property access) and changes frequently. This provides maximum CPU savings.
 */
function findNearbyContainerCached(creep: Creep): StructureContainer | undefined {
  const memory = (creep.memory as unknown as SwarmCreepMemory) ?? ({} as SwarmCreepMemory);
  
  // Check if we have a cached container ID
  if (memory.nearbyContainerId && memory.nearbyContainerTick && (Game.time - memory.nearbyContainerTick) < HARVESTER_CACHE_DURATION) {
    const container = Game.getObjectById(memory.nearbyContainerId);
    // Verify container still exists
    if (container) {
      // Always check capacity (cheap check, changes frequently)
      if (container.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
        return container;
      }
      // Container full but still exists - keep cache, return undefined
      return undefined;
    }
    // Container destroyed - clear cache
    delete memory.nearbyContainerId;
    delete memory.nearbyContainerTick;
  }
  
  // Cache miss or container destroyed - find a new container
  // Note: We find ANY container nearby, not just ones with capacity
  // This allows us to cache it even when full
  const containers = creep.pos.findInRange(FIND_STRUCTURES, 1, {
    filter: s => s.structureType === STRUCTURE_CONTAINER
  }) as StructureContainer[];
  
  const container = containers[0];
  
  // Cache the result if found
  if (container) {
    memory.nearbyContainerId = container.id;
    memory.nearbyContainerTick = Game.time;
    // Check capacity before returning
    if (container.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
      return container;
    }
    return undefined;
  } else {
    // No container found - clear cache
    delete memory.nearbyContainerId;
    delete memory.nearbyContainerTick;
    return undefined;
  }
}

/**
 * OPTIMIZATION: Cached version of findNearbyLink for stationary harvesters.
 * Caches the link ID for HARVESTER_CACHE_DURATION ticks to avoid repeated findInRange calls.
 * Harvesters are stationary, so their nearby structures don't change often.
 * 
 * Optimization strategy: We cache the expensive findInRange operation but always check capacity
 * since it's cheap (just property access) and changes frequently. This provides maximum CPU savings.
 */
function findNearbyLinkCached(creep: Creep): StructureLink | undefined {
  const memory = (creep.memory as unknown as SwarmCreepMemory) ?? ({} as SwarmCreepMemory);
  
  // Check if we have a cached link ID
  if (memory.nearbyLinkId && memory.nearbyLinkTick && (Game.time - memory.nearbyLinkTick) < HARVESTER_CACHE_DURATION) {
    const link = Game.getObjectById(memory.nearbyLinkId);
    // Verify link still exists
    if (link) {
      // Always check capacity (cheap check, changes frequently)
      if (link.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
        return link;
      }
      // Link full but still exists - keep cache, return undefined
      return undefined;
    }
    // Link destroyed - clear cache
    delete memory.nearbyLinkId;
    delete memory.nearbyLinkTick;
  }
  
  // Cache miss or link destroyed - find a new link
  // Note: We find ANY link nearby, not just ones with capacity
  // This allows us to cache it even when full
  const links = creep.pos.findInRange(FIND_MY_STRUCTURES, 1, {
    filter: s => s.structureType === STRUCTURE_LINK
  }) as StructureLink[];
  
  const link = links[0];
  
  // Cache the result if found
  if (link) {
    memory.nearbyLinkId = link.id;
    memory.nearbyLinkTick = Game.time;
    // Check capacity before returning
    if (link.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
      return link;
    }
    return undefined;
  } else {
    // No link found - clear cache
    delete memory.nearbyLinkId;
    delete memory.nearbyLinkTick;
    return undefined;
  }
}
