/**
 * Remote Operations Behaviors
 * 
 * Remote harvesting and hauling in external rooms.
 */

import type { SwarmCreepMemory } from "../../memory/schemas";
import type { CreepAction, CreepContext } from "../types";
import { findCachedClosest } from "../../cache";
import { updateWorkingState, switchToCollectionMode } from "./common/stateManagement";
import { cachedRoomFind, cachedFindSources, cachedFindDroppedResources } from "../../cache";

/**
 * Cache duration for stationary harvester structures (containers, links).
 * Harvesters are stationary workers, so their nearby structures rarely change.
 * 50 ticks provides good balance between CPU savings and responsiveness to changes.
 */
const HARVESTER_CACHE_DURATION = 50;

/**
 * Energy collection threshold for remote haulers.
 * Only collect from containers when they have this percentage of hauler capacity.
 * This ensures travel costs are justified by energy gained.
 */
const REMOTE_HAULER_ENERGY_THRESHOLD = 0.3; // 30%

/**
 * RemoteHarvester - Stationary miner in remote room.
 * Travels to remote room, sits at source, harvests to container.
 * 
 * ENHANCEMENT: Added hostile detection and flee behavior for safety.
 * Remote harvesters will flee from hostiles and return home if threatened.
 */
export function remoteHarvester(ctx: CreepContext): CreepAction {
  // Get target room from memory
  const targetRoom = ctx.memory.targetRoom;
  
  // SAFETY: If no valid target room, idle (executor will move away from spawn)
  // This should not happen with proper spawn logic, but provides a failsafe
  if (!targetRoom || targetRoom === ctx.memory.homeRoom) {
    // Idle action triggers move-away-from-spawn logic in executor
    return { type: "idle" };
  }

  // SAFETY: Check for nearby hostiles and flee if threatened
  if (ctx.nearbyEnemies && ctx.hostiles.length > 0) {
    const dangerousHostiles = ctx.hostiles.filter(h => 
      ctx.creep.pos.getRangeTo(h) <= 5 &&
      (h.getActiveBodyparts(ATTACK) > 0 || h.getActiveBodyparts(RANGED_ATTACK) > 0)
    );
    
    if (dangerousHostiles.length > 0) {
      // If in remote room with hostiles, return home for safety
      if (ctx.room.name === targetRoom) {
        return { type: "moveToRoom", roomName: ctx.memory.homeRoom };
      }
      // If in transit, flee from hostiles
      return { type: "flee", from: dangerousHostiles.map(h => h.pos) };
    }
  }

  // If not in target room, move there
  if (ctx.room.name !== targetRoom) {
    return { type: "moveToRoom", roomName: targetRoom };
  }

  // In target room - find or assign source
  let source = ctx.assignedSource;

  if (!source) {
    source = assignRemoteSource(ctx);
  }

  if (!source) return { type: "idle" };

  // Move to source if not nearby
  if (!ctx.creep.pos.isNearTo(source)) {
    return { type: "moveTo", target: source };
  }

  // At source - harvest or transfer to container
  const carryCapacity = ctx.creep.store.getCapacity();
  const hasFreeCapacity = ctx.creep.store.getFreeCapacity() > 0;

  if (carryCapacity === null || carryCapacity === 0 || hasFreeCapacity) {
    return { type: "harvest", target: source };
  }

  // OPTIMIZATION: Full - find nearby container using cached lookup
  // Remote harvesters are also stationary at their sources, so cache for 50 ticks
  const container = findRemoteContainerCached(ctx.creep, source);
  if (container) {
    return { type: "transfer", target: container, resourceType: RESOURCE_ENERGY };
  }

  // No container - drop energy for haulers
  return { type: "drop", resourceType: RESOURCE_ENERGY };
}

/**
 * Assign a source to a remote harvester in the target room.
 * Similar to regular harvester source assignment but works in remote rooms.
 */
function assignRemoteSource(ctx: CreepContext): Source | null {
  const sources = cachedFindSources(ctx.room);
  if (sources.length === 0) return null;

  // For remote harvesters, just assign the first available source
  // More sophisticated load balancing can be added later
  const source = sources[0];
  if (source) {
    ctx.memory.sourceId = source.id;
  }

  return source;
}

/**
 * OPTIMIZATION: Cached version of finding nearby container for remote harvesters.
 * Remote harvesters are stationary like regular harvesters, so we cache the container
 * near their assigned source for HARVESTER_CACHE_DURATION ticks to avoid repeated findInRange calls.
 * 
 * Note: Remote containers don't check for free capacity since they're typically used as
 * drop-off points and remote haulers will collect from them. The harvester just needs
 * to know the container exists.
 */
function findRemoteContainerCached(creep: Creep, source: Source): StructureContainer | undefined {
  const memory = creep.memory as unknown as SwarmCreepMemory;
  
  // Check if we have a cached container ID and if it's still valid
  if (memory.remoteContainerId && memory.remoteContainerTick && (Game.time - memory.remoteContainerTick) < HARVESTER_CACHE_DURATION) {
    const container = Game.getObjectById(memory.remoteContainerId);
    if (container) {
      return container;
    }
    // Container no longer exists - clear cache
    delete memory.remoteContainerId;
    delete memory.remoteContainerTick;
  }
  
  // Cache miss or invalid - find a new container near the source
  const containers = source.pos.findInRange(FIND_STRUCTURES, 2, {
    filter: s => s.structureType === STRUCTURE_CONTAINER
  }) as StructureContainer[];
  
  const container = containers[0];
  
  // Cache the result if found, otherwise clear cache
  if (container) {
    memory.remoteContainerId = container.id;
    memory.remoteContainerTick = Game.time;
  } else {
    delete memory.remoteContainerId;
    delete memory.remoteContainerTick;
  }
  
  return container;
}

/**
 * RemoteHauler - Transports energy from remote room to home room.
 * Picks up from remote containers/ground, delivers to home storage.
 * 
 * ENHANCEMENT: Added hostile detection and flee behavior for safety.
 * Remote haulers will flee from hostiles and prioritize returning home with cargo.
 */
export function remoteHauler(ctx: CreepContext): CreepAction {
  const isWorking = updateWorkingState(ctx);
  const targetRoom = ctx.memory.targetRoom;
  const homeRoom = ctx.memory.homeRoom;

  // SAFETY: If no valid target room, idle (executor will move away from spawn)
  // This should not happen with proper spawn logic, but provides a failsafe
  if (!targetRoom || targetRoom === homeRoom) {
    // Idle action triggers move-away-from-spawn logic in executor
    return { type: "idle" };
  }

  // SAFETY: Check for nearby hostiles and flee if threatened
  if (ctx.nearbyEnemies && ctx.hostiles.length > 0) {
    const dangerousHostiles = ctx.hostiles.filter(h => 
      ctx.creep.pos.getRangeTo(h) <= 5 &&
      (h.getActiveBodyparts(ATTACK) > 0 || h.getActiveBodyparts(RANGED_ATTACK) > 0)
    );
    
    if (dangerousHostiles.length > 0) {
      // If carrying energy, prioritize getting home
      if (isWorking && ctx.room.name !== homeRoom) {
        return { type: "moveToRoom", roomName: homeRoom };
      }
      // Otherwise flee from hostiles
      return { type: "flee", from: dangerousHostiles.map(h => h.pos) };
    }
  }

  if (isWorking) {
    // Has energy - return to home room and deliver
    if (ctx.room.name !== homeRoom) {
      return { type: "moveToRoom", roomName: homeRoom };
    }

    // In home room - deliver with priority: spawn > extensions > towers > storage > containers
    // BUGFIX: Filter by capacity HERE for fresh state, not in room cache

    // 1. Spawns first (highest priority, cache 5 ticks)
    const spawns = ctx.spawnStructures.filter(
      (s): s is StructureSpawn => 
        s.structureType === STRUCTURE_SPAWN &&
        s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
    );
    if (spawns.length > 0) {
      const closest = findCachedClosest(ctx.creep, spawns, "remoteHauler_spawn", 5);
      if (closest) return { type: "transfer", target: closest, resourceType: RESOURCE_ENERGY };
    }

    // 2. Extensions second (cache 5 ticks)
    const extensions = ctx.spawnStructures.filter(
      (s): s is StructureExtension => 
        s.structureType === STRUCTURE_EXTENSION &&
        s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
    );
    if (extensions.length > 0) {
      const closest = findCachedClosest(ctx.creep, extensions, "remoteHauler_ext", 5);
      if (closest) return { type: "transfer", target: closest, resourceType: RESOURCE_ENERGY };
    }

    // 3. Towers third (cache 10 ticks)
    // FIX: Lower threshold from 200 to 100 to keep towers better stocked for defense
    // Towers need to be kept full for rapid response to threats (ROADMAP.md Section 12)
    const towersWithCapacity = ctx.towers.filter(
      t => t.store.getFreeCapacity(RESOURCE_ENERGY) >= 100
    );
    if (towersWithCapacity.length > 0) {
      const closest = findCachedClosest(ctx.creep, towersWithCapacity, "remoteHauler_tower", 10);
      if (closest) return { type: "transfer", target: closest, resourceType: RESOURCE_ENERGY };
    }

    // 4. Storage fourth
    if (ctx.storage && ctx.storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
      return { type: "transfer", target: ctx.storage, resourceType: RESOURCE_ENERGY };
    }

    // 5. Containers last (for early game or when storage is full/unavailable, cache 10 ticks)
    // BUGFIX: Filter by capacity HERE for fresh state, not in room cache
    const depositContainersWithCapacity = ctx.depositContainers.filter(
      c => c.store.getFreeCapacity(RESOURCE_ENERGY) > 0
    );
    if (depositContainersWithCapacity.length > 0) {
      const closest = findCachedClosest(ctx.creep, depositContainersWithCapacity, "remoteHauler_cont", 10);
      if (closest) return { type: "transfer", target: closest, resourceType: RESOURCE_ENERGY };
    }

    // FIX: No valid delivery targets found, but creep still has energy
    // If in home room with energy but no targets, switch to collection mode
    // to go back to remote room and top off capacity
    // This prevents deadlock where remote haulers get stuck idle in home room
    if (!ctx.isEmpty && ctx.room.name === homeRoom) {
      switchToCollectionMode(ctx);
      // Switch to collection mode and return to remote room
      return { type: "moveToRoom", roomName: targetRoom };
    }

    return { type: "idle" };
  } else {
    // Empty - go to remote room and collect
    if (ctx.room.name !== targetRoom) {
      return { type: "moveToRoom", roomName: targetRoom };
    }

    // ENERGY EFFICIENCY: Only collect if there's sufficient energy to justify the trip
    // Remote hauling has travel costs, so we want to maximize energy per trip
    const minEnergyThreshold = ctx.creep.store.getCapacity(RESOURCE_ENERGY) * REMOTE_HAULER_ENERGY_THRESHOLD;

    // In remote room - collect from containers or ground
    const containers = cachedRoomFind(ctx.room, FIND_STRUCTURES, {
      filter: (s: Structure) => 
        s.structureType === STRUCTURE_CONTAINER && 
        (s as StructureContainer).store.getUsedCapacity(RESOURCE_ENERGY) >= minEnergyThreshold,
      filterKey: 'remoteContainers'
    }) as StructureContainer[];

    if (containers.length > 0) {
      const closest = findCachedClosest(ctx.creep, containers, "remoteHauler_remoteCont", 10);
      if (closest) return { type: "withdraw", target: closest, resourceType: RESOURCE_ENERGY };
    }

    // Check for dropped energy (cache 3 ticks - they disappear quickly)
    // For dropped resources, collect even smaller amounts to prevent decay
    const dropped = cachedFindDroppedResources(ctx.room, RESOURCE_ENERGY).filter(r => r.amount > 50);

    if (dropped.length > 0) {
      const closest = findCachedClosest(ctx.creep, dropped, "remoteHauler_remoteDrop", 3);
      if (closest) return { type: "pickup", target: closest };
    }

    // If no energy meets threshold, wait near a container for it to fill
    if (containers.length === 0) {
      const anyContainer = cachedRoomFind(ctx.room, FIND_STRUCTURES, {
        filter: (s: Structure) => s.structureType === STRUCTURE_CONTAINER,
        filterKey: 'containers'
      }) as StructureContainer[];
      
      if (anyContainer.length > 0) {
        const closest = findCachedClosest(ctx.creep, anyContainer, "remoteHauler_waitCont", 20);
        if (closest && ctx.creep.pos.getRangeTo(closest) > 2) {
          return { type: "moveTo", target: closest };
        }
      }
    }

    return { type: "idle" };
  }
}
