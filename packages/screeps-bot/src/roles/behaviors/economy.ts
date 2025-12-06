/**
 * Economy Behaviors
 *
 * Simple, human-readable behavior functions for economy roles.
 * Each function evaluates the situation and returns an action.
 */

import type { SwarmCreepMemory } from "../../memory/schemas";
import { clearCacheOnStateChange, findCachedClosest } from "../../utils/cachedClosest";
import type { CreepAction, CreepContext } from "./types";

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Type guard to check if an object is a Deposit.
 * Deposits have depositType and cooldown properties, but no structureType.
 */
function isDeposit(obj: unknown): obj is Deposit {
  return (
    obj !== null &&
    typeof obj === "object" &&
    "depositType" in obj &&
    "cooldown" in obj &&
    !("structureType" in obj)
  );
}

// =============================================================================
// Common Patterns
// =============================================================================

/**
 * Update working state based on energy levels.
 * Returns true if creep should be working (has energy to spend).
 * Clears cached targets when state changes to ensure fresh target selection.
 */
function updateWorkingState(ctx: CreepContext): boolean {
  const wasWorking = ctx.memory.working ?? false;
  if (ctx.isEmpty) ctx.memory.working = false;
  if (ctx.isFull) ctx.memory.working = true;
  const isWorking = ctx.memory.working ?? false;
  
  // Clear cached targets when working state changes
  if (wasWorking !== isWorking) {
    clearCacheOnStateChange(ctx.creep);
  }
  
  return isWorking;
}

/**
 * Find energy to collect (common pattern for many roles).
 * Uses cached target finding to reduce CPU usage.
 * 
 * OPTIMIZATION: Prioritize dropped resources and containers over room.find() calls.
 * Most rooms have containers set up, so we rarely need to fall back to harvesting.
 */
function findEnergy(ctx: CreepContext): CreepAction {
  // 1. Dropped resources (cache 5 ticks - they appear/disappear quickly)
  if (ctx.droppedResources.length > 0) {
    const closest = findCachedClosest(ctx.creep, ctx.droppedResources, "energy_drop", 5);
    if (closest) return { type: "pickup", target: closest };
  }

  // 2. Containers (cache 10 ticks - stable targets)
  if (ctx.containers.length > 0) {
    const closest = findCachedClosest(ctx.creep, ctx.containers, "energy_container", 10);
    if (closest) return { type: "withdraw", target: closest, resourceType: RESOURCE_ENERGY };
  }

  // 3. Storage (single target, no caching needed)
  if (ctx.storage && ctx.storage.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
    return { type: "withdraw", target: ctx.storage, resourceType: RESOURCE_ENERGY };
  }

  // 4. Harvest directly (sources don't change, cache 20 ticks)
  // This is the most expensive option due to room.find(), but rarely used
  const sources = ctx.room.find(FIND_SOURCES_ACTIVE);
  if (sources.length > 0) {
    const source = findCachedClosest(ctx.creep, sources, "energy_source", 20);
    if (source) return { type: "harvest", target: source };
  }

  return { type: "idle" };
}

/**
 * Deliver energy to spawn structures and towers.
 * Uses cached target finding to reduce CPU usage.
 */
function deliverEnergy(ctx: CreepContext): CreepAction | null {
  // Spawns and extensions first (cache for 5 ticks - they fill quickly)
  if (ctx.spawnStructures.length > 0) {
    const closest = findCachedClosest(ctx.creep, ctx.spawnStructures, "deliver_spawn", 5);
    if (closest) return { type: "transfer", target: closest, resourceType: RESOURCE_ENERGY };
  }

  // Then towers (cache for 10 ticks - they drain slower)
  if (ctx.towers.length > 0) {
    const closest = findCachedClosest(ctx.creep, ctx.towers, "deliver_tower", 10);
    if (closest) return { type: "transfer", target: closest, resourceType: RESOURCE_ENERGY };
  }

  return null;
}

// =============================================================================
// Role Behaviors
// =============================================================================

/**
 * LarvaWorker - General purpose starter creep.
 * Priority: deliver energy → build → upgrade
 */
export function larvaWorker(ctx: CreepContext): CreepAction {
  const isWorking = updateWorkingState(ctx);

  if (isWorking) {
    // Try to deliver energy
    const deliverAction = deliverEnergy(ctx);
    if (deliverAction) return deliverAction;

    // Build construction sites
    if (ctx.prioritizedSites.length > 0) {
      return { type: "build", target: ctx.prioritizedSites[0]! };
    }

    // Upgrade controller
    if (ctx.room.controller) {
      return { type: "upgrade", target: ctx.room.controller };
    }

    return { type: "idle" };
  }

  return findEnergy(ctx);
}

/**
 * Harvester - Stationary miner at a source.
 * Sits at source, harvests, and transfers to nearby container/link.
 */
export function harvester(ctx: CreepContext): CreepAction {
  let source = ctx.assignedSource;

  // Assign a source if not already assigned
  if (!source) {
    source = assignSource(ctx);
  }

  if (!source) return { type: "idle" };

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

  // Full - find nearby container or link
  const container = findNearbyContainer(ctx.creep);
  if (container) return { type: "transfer", target: container, resourceType: RESOURCE_ENERGY };

  const link = findNearbyLink(ctx.creep);
  if (link) return { type: "transfer", target: link, resourceType: RESOURCE_ENERGY };

  // Drop on ground for haulers
  return { type: "drop", resourceType: RESOURCE_ENERGY };
}

/**
 * Assign a source to a harvester, trying to balance load.
 */
function assignSource(ctx: CreepContext): Source | null {
  const sources = ctx.room.find(FIND_SOURCES);
  if (sources.length === 0) return null;

  // Count creeps assigned to each source
  const sourceCounts = new Map<string, number>();
  for (const s of sources) {
    sourceCounts.set(s.id, 0);
  }

  for (const c of Object.values(Game.creeps)) {
    const m = c.memory as unknown as SwarmCreepMemory;
    if (m.role === "harvester" && m.sourceId) {
      sourceCounts.set(m.sourceId, (sourceCounts.get(m.sourceId) ?? 0) + 1);
    }
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

function findNearbyContainer(creep: Creep): StructureContainer | undefined {
  return creep.pos.findInRange(FIND_STRUCTURES, 1, {
    filter: s =>
      s.structureType === STRUCTURE_CONTAINER &&
      s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
  })[0] as StructureContainer | undefined;
}

function findNearbyLink(creep: Creep): StructureLink | undefined {
  return creep.pos.findInRange(FIND_MY_STRUCTURES, 1, {
    filter: s =>
      s.structureType === STRUCTURE_LINK &&
      s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
  })[0] as StructureLink | undefined;
}

/**
 * Hauler - Transport energy from harvesters to structures.
 * Uses cached target finding to reduce CPU usage.
 */
export function hauler(ctx: CreepContext): CreepAction {
  const isWorking = updateWorkingState(ctx);

  if (isWorking) {
    // Deliver energy with priority: spawn > extensions > towers > storage > containers

    // 1. Spawns first (highest priority, cache 5 ticks)
    const spawns = ctx.spawnStructures.filter(
      (s): s is StructureSpawn => s.structureType === STRUCTURE_SPAWN
    );
    if (spawns.length > 0) {
      const closest = findCachedClosest(ctx.creep, spawns, "hauler_spawn", 5);
      if (closest) return { type: "transfer", target: closest, resourceType: RESOURCE_ENERGY };
    }

    // 2. Extensions second (cache 5 ticks)
    const extensions = ctx.spawnStructures.filter(
      (s): s is StructureExtension => s.structureType === STRUCTURE_EXTENSION
    );
    if (extensions.length > 0) {
      const closest = findCachedClosest(ctx.creep, extensions, "hauler_ext", 5);
      if (closest) return { type: "transfer", target: closest, resourceType: RESOURCE_ENERGY };
    }

    // 3. Towers third (cache 10 ticks)
    if (ctx.towers.length > 0) {
      const closest = findCachedClosest(ctx.creep, ctx.towers, "hauler_tower", 10);
      if (closest) return { type: "transfer", target: closest, resourceType: RESOURCE_ENERGY };
    }

    // 4. Storage fourth
    if (ctx.storage && ctx.storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
      return { type: "transfer", target: ctx.storage, resourceType: RESOURCE_ENERGY };
    }

    // 5. Containers last (cache 10 ticks)
    if (ctx.depositContainers.length > 0) {
      const closest = findCachedClosest(ctx.creep, ctx.depositContainers, "hauler_cont", 10);
      if (closest) return { type: "transfer", target: closest, resourceType: RESOURCE_ENERGY };
    }

    return { type: "idle" };
  }

  // Collect energy - priority order
  // 1. Dropped resources (cache 3 ticks - they disappear quickly)
  if (ctx.droppedResources.length > 0) {
    const closest = findCachedClosest(ctx.creep, ctx.droppedResources, "hauler_drop", 3);
    if (closest) return { type: "pickup", target: closest };
  }

  // 2. Tombstones (cache 5 ticks)
  const tombstones = ctx.room.find(FIND_TOMBSTONES, {
    filter: t => t.store.getUsedCapacity(RESOURCE_ENERGY) > 0
  });
  if (tombstones.length > 0) {
    const tombstone = findCachedClosest(ctx.creep, tombstones, "hauler_tomb", 5);
    if (tombstone) return { type: "withdraw", target: tombstone, resourceType: RESOURCE_ENERGY };
  }

  // 3. Containers (cache 10 ticks)
  if (ctx.containers.length > 0) {
    const closest = findCachedClosest(ctx.creep, ctx.containers, "hauler_source", 10);
    if (closest) return { type: "withdraw", target: closest, resourceType: RESOURCE_ENERGY };
  }

  return { type: "idle" };
}

/**
 * Builder - Construct and repair structures.
 */
export function builder(ctx: CreepContext): CreepAction {
  const isWorking = updateWorkingState(ctx);

  if (isWorking) {
    // Build construction sites
    if (ctx.prioritizedSites.length > 0) {
      return { type: "build", target: ctx.prioritizedSites[0]! };
    }

    // No sites - help upgrade
    if (ctx.room.controller) {
      return { type: "upgrade", target: ctx.room.controller };
    }

    return { type: "idle" };
  }

  return findEnergy(ctx);
}

/**
 * Upgrader - Upgrade the room controller.
 * Uses cached target finding to reduce CPU usage.
 */
export function upgrader(ctx: CreepContext): CreepAction {
  const isWorking = updateWorkingState(ctx);

  if (isWorking) {
    if (ctx.room.controller) {
      return { type: "upgrade", target: ctx.room.controller };
    }
    return { type: "idle" };
  }

  // Prefer storage/container over harvesting
  if (ctx.storage && ctx.storage.store.getUsedCapacity(RESOURCE_ENERGY) > 1000) {
    return { type: "withdraw", target: ctx.storage, resourceType: RESOURCE_ENERGY };
  }

  // Cache container lookups for 15 ticks - upgraders are stationary
  if (ctx.containers.length > 0) {
    const closest = findCachedClosest(ctx.creep, ctx.containers, "upgrader_cont", 15);
    if (closest) return { type: "withdraw", target: closest, resourceType: RESOURCE_ENERGY };
  }

  // Cache source lookups for 20 ticks - sources don't move
  const sources = ctx.room.find(FIND_SOURCES_ACTIVE);
  if (sources.length > 0) {
    const source = findCachedClosest(ctx.creep, sources, "upgrader_source", 20);
    if (source) return { type: "harvest", target: source };
  }

  return { type: "idle" };
}

/**
 * QueenCarrier - Energy distributor for spawn structures.
 */
export function queenCarrier(ctx: CreepContext): CreepAction {
  const isWorking = updateWorkingState(ctx);

  if (isWorking) {
    // Fill spawns and extensions
    const deliverAction = deliverEnergy(ctx);
    if (deliverAction) return deliverAction;

    // Wait near storage
    if (ctx.storage) return { type: "moveTo", target: ctx.storage };

    return { type: "idle" };
  }

  // Get energy from storage or terminal
  if (ctx.storage && ctx.storage.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
    return { type: "withdraw", target: ctx.storage, resourceType: RESOURCE_ENERGY };
  }

  if (ctx.terminal && ctx.terminal.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
    return { type: "withdraw", target: ctx.terminal, resourceType: RESOURCE_ENERGY };
  }

  return { type: "idle" };
}

/**
 * MineralHarvester - Harvest minerals from extractors.
 */
export function mineralHarvester(ctx: CreepContext): CreepAction {
  const mineral = ctx.room.find(FIND_MINERALS)[0];
  if (!mineral) return { type: "idle" };

  const extractor = mineral.pos.lookFor(LOOK_STRUCTURES).find(s => s.structureType === STRUCTURE_EXTRACTOR);
  if (!extractor) return { type: "idle" };

  if (mineral.mineralAmount === 0) {
    // Mineral depleted - wait near storage
    if (ctx.storage) return { type: "moveTo", target: ctx.storage };
    return { type: "idle" };
  }

  if (ctx.isFull) {
    const target = ctx.terminal ?? ctx.storage;
    if (target) {
      const mineralType = Object.keys(ctx.creep.store)[0] as ResourceConstant;
      return { type: "transfer", target, resourceType: mineralType };
    }
  }

  return { type: "harvestMineral", target: mineral };
}

/**
 * DepositHarvester - Harvest from highway deposits.
 */
export function depositHarvester(ctx: CreepContext): CreepAction {
  // Find or assign target deposit
  if (!ctx.memory.targetId) {
    const deposits = ctx.room.find(FIND_DEPOSITS);
    if (deposits.length > 0) {
      const best = deposits.reduce((a, b) => (a.cooldown < b.cooldown ? a : b));
      // Store the deposit ID. This is safe because Screeps object IDs are always strings,
      // and Deposit IDs are compatible with Id<_HasId>. We only use targetId for deposits in this role.
      ctx.memory.targetId = best.id ;
    }
  }

  if (!ctx.memory.targetId) return { type: "idle" };

  // Attempt to get the deposit - may return null if ID is invalid or object no longer exists
  // We use a type guard to verify this is actually a Deposit
  const depositObj = Game.getObjectById(ctx.memory.targetId);
  if (!depositObj || !isDeposit(depositObj)) {
    // Invalid or missing deposit - clear target and idle
    delete ctx.memory.targetId;
    return { type: "idle" };
  }
  const deposit = depositObj;

  // Check if deposit is on cooldown
  if (deposit.cooldown > 100) {
    delete ctx.memory.targetId;
    return { type: "idle" };
  }

  if (ctx.isFull) {
    // Return home
    const homeRoom = Game.rooms[ctx.homeRoom];
    if (homeRoom) {
      const target = homeRoom.terminal ?? homeRoom.storage;
      if (target) {
        const resourceType = Object.keys(ctx.creep.store)[0] as ResourceConstant;
        return { type: "transfer", target, resourceType };
      }
    }
    return { type: "moveToRoom", roomName: ctx.homeRoom };
  }

  return { type: "harvestDeposit", target: deposit };
}

/**
 * LabTech - Manage lab reactions and compounds.
 */
export function labTech(ctx: CreepContext): CreepAction {
  if (ctx.labs.length === 0) return { type: "idle" };

  const inputLabs = ctx.labs.slice(0, 2);
  const outputLabs = ctx.labs.slice(2);

  // If carrying resources, deliver them
  if (ctx.creep.store.getUsedCapacity() > 0) {
    const resourceType = Object.keys(ctx.creep.store)[0] as ResourceConstant;

    // Base minerals go to input labs, compounds go to storage/terminal
    const baseMinerals: ResourceConstant[] = [
      RESOURCE_HYDROGEN, RESOURCE_OXYGEN, RESOURCE_UTRIUM,
      RESOURCE_LEMERGIUM, RESOURCE_KEANIUM, RESOURCE_ZYNTHIUM, RESOURCE_CATALYST
    ];

    if (resourceType !== RESOURCE_ENERGY && !baseMinerals.includes(resourceType)) {
      const target = ctx.terminal ?? ctx.storage;
      if (target) return { type: "transfer", target, resourceType };
    }

    // Put base minerals in input labs
    for (const lab of inputLabs) {
      const capacity = lab.store.getFreeCapacity(resourceType);
      if (capacity !== null && capacity > 0) {
        return { type: "transfer", target: lab, resourceType };
      }
    }
  }

  // Collect products from output labs
  for (const lab of outputLabs) {
    const mineralType = lab.mineralType;
    if (mineralType && lab.store.getUsedCapacity(mineralType) > 100) {
      return { type: "withdraw", target: lab, resourceType: mineralType };
    }
  }

  // Fill input labs from terminal/storage
  const source = ctx.terminal ?? ctx.storage;
  if (source) {
    const minerals: MineralConstant[] = [
      RESOURCE_HYDROGEN, RESOURCE_OXYGEN, RESOURCE_UTRIUM,
      RESOURCE_LEMERGIUM, RESOURCE_KEANIUM, RESOURCE_ZYNTHIUM, RESOURCE_CATALYST
    ];

    for (const lab of inputLabs) {
      for (const mineral of minerals) {
        if (source.store.getUsedCapacity(mineral) > 0 && lab.store.getFreeCapacity(mineral) > 0) {
          return { type: "withdraw", target: source, resourceType: mineral };
        }
      }
    }
  }

  return { type: "idle" };
}

/**
 * FactoryWorker - Supply factory with materials.
 */
export function factoryWorker(ctx: CreepContext): CreepAction {
  if (!ctx.factory) return { type: "idle" };

  const isWorking = updateWorkingState(ctx);

  if (isWorking) {
    const resourceType = Object.keys(ctx.creep.store)[0] as ResourceConstant;
    return { type: "transfer", target: ctx.factory, resourceType };
  }

  const source = ctx.terminal ?? ctx.storage;
  if (!source) return { type: "idle" };

  // Supply energy first
  if (
    ctx.factory.store.getUsedCapacity(RESOURCE_ENERGY) < 5000 &&
    source.store.getUsedCapacity(RESOURCE_ENERGY) > 10000
  ) {
    return { type: "withdraw", target: source, resourceType: RESOURCE_ENERGY };
  }

  // Supply bars/materials
  const bars: ResourceConstant[] = [
    RESOURCE_UTRIUM_BAR, RESOURCE_LEMERGIUM_BAR, RESOURCE_KEANIUM_BAR,
    RESOURCE_ZYNTHIUM_BAR, RESOURCE_OXIDANT, RESOURCE_REDUCTANT
  ];

  for (const bar of bars) {
    if (ctx.factory.store.getUsedCapacity(bar) < 500 && source.store.getUsedCapacity(bar) > 0) {
      return { type: "withdraw", target: source, resourceType: bar };
    }
  }

  return { type: "idle" };
}

// =============================================================================
// Role Dispatcher
// =============================================================================

/**
 * RemoteHarvester - Stationary miner in remote room.
 * Travels to remote room, sits at source, harvests to container.
 */
export function remoteHarvester(ctx: CreepContext): CreepAction {
  // Get target room from memory
  const targetRoom = ctx.memory.targetRoom ?? ctx.memory.homeRoom;

  // If not in target room, move there
  if (ctx.room.name !== targetRoom) {
    return { type: "moveToRoom", roomName: targetRoom };
  }

  // In target room - find or assign source
  let source = ctx.assignedSource;

  if (!source) {
    source = assignSource(ctx);
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

  // Full - find nearby container
  const containers = source.pos.findInRange(FIND_STRUCTURES, 2, {
    filter: s => s.structureType === STRUCTURE_CONTAINER
  }) as StructureContainer[];

  if (containers.length > 0) {
    return { type: "transfer", target: containers[0], resourceType: RESOURCE_ENERGY };
  }

  // No container - drop energy for haulers
  return { type: "drop", resourceType: RESOURCE_ENERGY };
}

/**
 * RemoteHauler - Transports energy from remote room to home room.
 * Picks up from remote containers/ground, delivers to home storage.
 */
export function remoteHauler(ctx: CreepContext): CreepAction {
  const isWorking = updateWorkingState(ctx);
  const targetRoom = ctx.memory.targetRoom ?? ctx.memory.homeRoom;
  const homeRoom = ctx.memory.homeRoom;

  if (isWorking) {
    // Has energy - return to home room and deliver
    if (ctx.room.name !== homeRoom) {
      return { type: "moveToRoom", roomName: homeRoom };
    }

    // In home room - deliver with priority: spawn > extensions > towers > storage > containers

    // 1. Spawns first (highest priority)
    const spawns = ctx.spawnStructures.filter(
      (s): s is StructureSpawn => s.structureType === STRUCTURE_SPAWN
    );
    if (spawns.length > 0) {
      const closest = ctx.creep.pos.findClosestByRange(spawns);
      if (closest) return { type: "transfer", target: closest, resourceType: RESOURCE_ENERGY };
    }

    // 2. Extensions second
    const extensions = ctx.spawnStructures.filter(
      (s): s is StructureExtension => s.structureType === STRUCTURE_EXTENSION
    );
    if (extensions.length > 0) {
      const closest = ctx.creep.pos.findClosestByRange(extensions);
      if (closest) return { type: "transfer", target: closest, resourceType: RESOURCE_ENERGY };
    }

    // 3. Towers third
    if (ctx.towers.length > 0) {
      const closest = ctx.creep.pos.findClosestByRange(ctx.towers);
      if (closest) return { type: "transfer", target: closest, resourceType: RESOURCE_ENERGY };
    }

    // 4. Storage fourth
    if (ctx.storage && ctx.storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
      return { type: "transfer", target: ctx.storage, resourceType: RESOURCE_ENERGY };
    }

    // 5. Containers last (for early game or when storage is full/unavailable)
    if (ctx.depositContainers.length > 0) {
      const closest = ctx.creep.pos.findClosestByRange(ctx.depositContainers);
      if (closest) return { type: "transfer", target: closest, resourceType: RESOURCE_ENERGY };
    }

    return { type: "idle" };
  } else {
    // Empty - go to remote room and collect
    if (ctx.room.name !== targetRoom) {
      return { type: "moveToRoom", roomName: targetRoom };
    }

    // In remote room - collect from containers or ground
    const containers = ctx.room.find(FIND_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_CONTAINER && s.store.getUsedCapacity(RESOURCE_ENERGY) > 0
    }) as StructureContainer[];

    if (containers.length > 0) {
      const closest = ctx.creep.pos.findClosestByRange(containers);
      if (closest) return { type: "withdraw", target: closest, resourceType: RESOURCE_ENERGY };
    }

    // Check for dropped energy
    const dropped = ctx.room.find(FIND_DROPPED_RESOURCES, {
      filter: r => r.resourceType === RESOURCE_ENERGY && r.amount > 50
    });

    if (dropped.length > 0) {
      const closest = ctx.creep.pos.findClosestByRange(dropped);
      if (closest) return { type: "pickup", target: closest };
    }

    return { type: "idle" };
  }
}

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
  factoryWorker,
  remoteHarvester,
  remoteHauler
};

/**
 * Evaluate and return an action for an economy role creep.
 */
export function evaluateEconomyBehavior(ctx: CreepContext): CreepAction {
  const behavior = economyBehaviors[ctx.memory.role] ?? larvaWorker;
  return behavior(ctx);
}
