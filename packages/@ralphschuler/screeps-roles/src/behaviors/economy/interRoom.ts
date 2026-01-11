/**
 * Inter-Room Operations
 * 
 * Cross-room resource transfer behaviors.
 */

import type { CreepAction, CreepContext } from "../types";
import { findCachedClosest } from "../../cache";
import { cachedRoomFind, cachedFindMyStructures } from "../../cache";

/**
 * InterRoomCarrier - Transfer resources between rooms in a cluster.
 * Used for pre-terminal resource sharing to help stabilize room economies.
 */
export function interRoomCarrier(ctx: CreepContext): CreepAction {
  const mem = ctx.memory;

  // If no transfer request, go idle (should be assigned by spawn logic)
  if (!mem.transferRequest) {
    return { type: "idle" };
  }

  const { fromRoom, toRoom, resourceType } = mem.transferRequest;
  const isCarrying = ctx.creep.store.getUsedCapacity(resourceType) > 0;

  if (isCarrying) {
    // Carrying resources - deliver to target room
    if (ctx.room.name !== toRoom) {
      return { type: "moveToRoom", roomName: toRoom };
    }

    // In target room - find delivery target
    const room = Game.rooms[toRoom];
    if (!room) return { type: "moveToRoom", roomName: toRoom };

    // Try storage first, then containers
    if (room.storage) {
      return { type: "transfer", target: room.storage, resourceType };
    }

    // Find containers with space
    const containers = cachedRoomFind(room, FIND_STRUCTURES, {
      filter: (s: Structure) =>
        s.structureType === STRUCTURE_CONTAINER && (s as StructureContainer).store.getFreeCapacity(resourceType) > 0,
      filterKey: `container_${resourceType}`
    }) as StructureContainer[];

    if (containers.length > 0) {
      const closest = findCachedClosest(ctx.creep, containers, "interRoomCarrier_targetCont", 10);
      if (closest) return { type: "transfer", target: closest, resourceType };
    }

    // If nowhere to deliver, drop it near spawn
    const spawns = cachedFindMyStructures<StructureSpawn>(room, STRUCTURE_SPAWN);
    if (spawns.length > 0) {
      if (ctx.creep.pos.isNearTo(spawns[0])) {
        return { type: "drop", resourceType };
      }
      return { type: "moveTo", target: spawns[0].pos };
    }

    return { type: "idle" };
  } else {
    // Empty - collect from source room
    if (ctx.room.name !== fromRoom) {
      return { type: "moveToRoom", roomName: fromRoom };
    }

    // In source room - find resource to collect
    const room = Game.rooms[fromRoom];
    if (!room) return { type: "moveToRoom", roomName: fromRoom };

    // Try storage first
    if (room.storage && room.storage.store.getUsedCapacity(resourceType) > 0) {
      return { type: "withdraw", target: room.storage, resourceType };
    }

    // Try containers
    const containers = cachedRoomFind(room, FIND_STRUCTURES, {
      filter: (s: Structure) => s.structureType === STRUCTURE_CONTAINER && (s as StructureContainer).store.getUsedCapacity(resourceType) > 0,
      filterKey: `container_${resourceType}`
    }) as StructureContainer[];

    if (containers.length > 0) {
      const closest = findCachedClosest(ctx.creep, containers, "interRoomCarrier_sourceCont", 10);
      if (closest) return { type: "withdraw", target: closest, resourceType };
    }

    return { type: "idle" };
  }
}
