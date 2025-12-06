/**
 * Power Behaviors
 *
 * Behavior functions for power-related creeps and Power Creeps.
 * Includes power harvesting (regular creeps) and Power Creep abilities.
 */

import type { SwarmCreepMemory } from "../../memory/schemas";
import { moveCreep, moveToRoom } from "../../utils/movement";
import { safeFind } from "../../utils/safeFind";
import type { CreepAction, CreepContext } from "./types";

// =============================================================================
// Regular Creep Power Roles
// =============================================================================

/**
 * PowerHarvester - Attack power banks in highway rooms.
 */
export function powerHarvester(ctx: CreepContext): CreepAction {
  const targetRoom = ctx.memory.targetRoom;

  if (!targetRoom) return { type: "idle" };

  // Move to target room
  if (ctx.room.name !== targetRoom) {
    return { type: "moveToRoom", roomName: targetRoom };
  }

  // Find power bank
  const powerBank = ctx.room.find(FIND_STRUCTURES, {
    filter: s => s.structureType === STRUCTURE_POWER_BANK
  })[0] as StructurePowerBank | undefined;

  if (!powerBank) {
    // Power bank destroyed - return home
    delete ctx.memory.targetRoom;
    return { type: "moveToRoom", roomName: ctx.homeRoom };
  }

  // Attack power bank
  const result = ctx.creep.attack(powerBank);
  if (result === ERR_NOT_IN_RANGE) {
    return { type: "moveTo", target: powerBank };
  }

  return { type: "idle" };
}

/**
 * PowerCarrier - Collect power from destroyed banks.
 */
export function powerCarrier(ctx: CreepContext): CreepAction {
  const targetRoom = ctx.memory.targetRoom;
  const carryingPower = ctx.creep.store.getUsedCapacity(RESOURCE_POWER) > 0;

  if (carryingPower) {
    // Return home and deposit
    if (ctx.room.name !== ctx.homeRoom) {
      return { type: "moveToRoom", roomName: ctx.homeRoom };
    }

    const homeRoom = Game.rooms[ctx.homeRoom];
    if (homeRoom) {
      const powerSpawn = homeRoom.find(FIND_MY_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_POWER_SPAWN
      })[0] as StructurePowerSpawn | undefined;

      if (powerSpawn && powerSpawn.store.getFreeCapacity(RESOURCE_POWER) > 0) {
        return { type: "transfer", target: powerSpawn, resourceType: RESOURCE_POWER };
      }

      if (ctx.storage) {
        return { type: "transfer", target: ctx.storage, resourceType: RESOURCE_POWER };
      }
    }

    return { type: "idle" };
  }

  if (!targetRoom) return { type: "idle" };

  // Move to target room
  if (ctx.room.name !== targetRoom) {
    return { type: "moveToRoom", roomName: targetRoom };
  }

  // Collect dropped power
  const droppedPower = ctx.room.find(FIND_DROPPED_RESOURCES, {
    filter: r => r.resourceType === RESOURCE_POWER
  })[0];

  if (droppedPower) return { type: "pickup", target: droppedPower };

  // Collect from ruins
  const ruin = ctx.room.find(FIND_RUINS, {
    filter: r => r.store.getUsedCapacity(RESOURCE_POWER) > 0
  })[0];

  if (ruin) return { type: "withdraw", target: ruin, resourceType: RESOURCE_POWER };

  // Wait near power bank if it still exists
  const powerBank = ctx.room.find(FIND_STRUCTURES, {
    filter: s => s.structureType === STRUCTURE_POWER_BANK
  })[0] as StructurePowerBank | undefined;

  if (powerBank) {
    if (ctx.creep.pos.getRangeTo(powerBank) > 3) {
      return { type: "moveTo", target: powerBank };
    }
    return { type: "idle" };
  }

  // No power bank and no power - return home
  delete ctx.memory.targetRoom;
  return { type: "moveToRoom", roomName: ctx.homeRoom };
}

// =============================================================================
// Power Creep Types and Context
// =============================================================================

/**
 * Context for Power Creep decision making.
 */
export interface PowerCreepContext {
  powerCreep: PowerCreep;
  room: Room;
  homeRoom: string;
  isInHomeRoom: boolean;
  storage: StructureStorage | undefined;
  terminal: StructureTerminal | undefined;
  factory: StructureFactory | undefined;
  labs: StructureLab[];
  spawns: StructureSpawn[];
  extensions: StructureExtension[];
  powerSpawn: StructurePowerSpawn | undefined;
  availablePowers: PowerConstant[];
  ops: number;
}

/**
 * Actions a Power Creep can perform.
 */
export type PowerCreepAction =
  | { type: "usePower"; power: PowerConstant; target?: RoomObject }
  | { type: "moveTo"; target: RoomPosition | RoomObject }
  | { type: "moveToRoom"; roomName: string }
  | { type: "renewSelf"; spawn: StructurePowerSpawn }
  | { type: "enableRoom" }
  | { type: "idle" };

/**
 * Create context for a Power Creep.
 */
export function createPowerCreepContext(powerCreep: PowerCreep): PowerCreepContext | null {
  if (!powerCreep.room) return null;

  const room = powerCreep.room;
  const memory = powerCreep.memory as unknown as { homeRoom?: string };
  const homeRoom = memory.homeRoom ?? room.name;

  const labs = room.find(FIND_MY_STRUCTURES, {
    filter: s => s.structureType === STRUCTURE_LAB
  }) as StructureLab[];

  const spawns = room.find(FIND_MY_SPAWNS);

  const extensions = room.find(FIND_MY_STRUCTURES, {
    filter: s => s.structureType === STRUCTURE_EXTENSION
  }) as StructureExtension[];

  const factory = room.find(FIND_MY_STRUCTURES, {
    filter: s => s.structureType === STRUCTURE_FACTORY
  })[0] as StructureFactory | undefined;

  const powerSpawn = room.find(FIND_MY_STRUCTURES, {
    filter: s => s.structureType === STRUCTURE_POWER_SPAWN
  })[0] as StructurePowerSpawn | undefined;

  // Get available (off-cooldown) powers
  const availablePowers: PowerConstant[] = [];
  for (const power of Object.keys(powerCreep.powers) as unknown as PowerConstant[]) {
    const powerData = powerCreep.powers[power];
    if (powerData && powerData.cooldown === 0) {
      availablePowers.push(power);
    }
  }

  return {
    powerCreep,
    room,
    homeRoom,
    isInHomeRoom: room.name === homeRoom,
    storage: room.storage,
    terminal: room.terminal,
    factory,
    labs,
    spawns,
    extensions,
    powerSpawn,
    availablePowers,
    ops: powerCreep.store.getUsedCapacity(RESOURCE_OPS)
  };
}

// =============================================================================
// Power Creep Behaviors
// =============================================================================

/**
 * PowerQueen - Economy-focused Operator.
 * Uses powers to boost spawning, extensions, labs, and factory.
 */
export function powerQueen(ctx: PowerCreepContext): PowerCreepAction {
  // Check for renewal
  if (ctx.powerCreep.ticksToLive !== undefined && ctx.powerCreep.ticksToLive < 1000) {
    if (ctx.powerSpawn) return { type: "renewSelf", spawn: ctx.powerSpawn };
  }

  const powers = ctx.availablePowers;

  // Boost spawning
  if (powers.includes(PWR_OPERATE_SPAWN) && ctx.ops >= 100) {
    const busySpawn = ctx.spawns.find(s => s.spawning !== null);
    if (busySpawn) return { type: "usePower", power: PWR_OPERATE_SPAWN, target: busySpawn };
  }

  // Fill extensions
  if (powers.includes(PWR_OPERATE_EXTENSION) && ctx.ops >= 2) {
    const freeCapacity = ctx.extensions.reduce((sum, ext) => sum + ext.store.getFreeCapacity(RESOURCE_ENERGY), 0);
    if (freeCapacity > 0 && ctx.storage && ctx.storage.store.getUsedCapacity(RESOURCE_ENERGY) > 10000) {
      return { type: "usePower", power: PWR_OPERATE_EXTENSION, target: ctx.storage };
    }
  }

  // Boost storage capacity
  if (powers.includes(PWR_OPERATE_STORAGE) && ctx.ops >= 100 && ctx.storage) {
    if (ctx.storage.store.getUsedCapacity() > ctx.storage.store.getCapacity() * 0.9) {
      return { type: "usePower", power: PWR_OPERATE_STORAGE, target: ctx.storage };
    }
  }

  // Boost lab reactions
  if (powers.includes(PWR_OPERATE_LAB) && ctx.ops >= 10) {
    const activeLab = ctx.labs.find(l => l.cooldown === 0 && l.mineralType);
    if (activeLab) return { type: "usePower", power: PWR_OPERATE_LAB, target: activeLab };
  }

  // Boost factory
  if (powers.includes(PWR_OPERATE_FACTORY) && ctx.ops >= 100 && ctx.factory) {
    if (ctx.factory.cooldown === 0) {
      return { type: "usePower", power: PWR_OPERATE_FACTORY, target: ctx.factory };
    }
  }

  // Generate ops when low
  if (powers.includes(PWR_GENERATE_OPS) && ctx.ops < 50) {
    return { type: "usePower", power: PWR_GENERATE_OPS };
  }

  // Move to home room
  if (!ctx.isInHomeRoom) {
    return { type: "moveToRoom", roomName: ctx.homeRoom };
  }

  // Stay near storage
  if (ctx.storage && ctx.powerCreep.pos.getRangeTo(ctx.storage) > 3) {
    return { type: "moveTo", target: ctx.storage };
  }

  return { type: "idle" };
}

/**
 * PowerWarrior - Combat-support Power Creep.
 * Uses powers for defense and offense.
 */
export function powerWarrior(ctx: PowerCreepContext): PowerCreepAction {
  // Check for renewal
  if (ctx.powerCreep.ticksToLive !== undefined && ctx.powerCreep.ticksToLive < 1000) {
    if (ctx.powerSpawn) return { type: "renewSelf", spawn: ctx.powerSpawn };
  }

  const powers = ctx.availablePowers;

  // Generate ops when low
  if (powers.includes(PWR_GENERATE_OPS) && ctx.ops < 50) {
    return { type: "usePower", power: PWR_GENERATE_OPS };
  }

  // Boost towers for defense - use safeFind for hostile creeps
  if (powers.includes(PWR_OPERATE_TOWER) && ctx.ops >= 10) {
    const hostiles = safeFind(ctx.room, FIND_HOSTILE_CREEPS);
    if (hostiles.length > 0) {
      const tower = ctx.room.find(FIND_MY_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_TOWER
      })[0] as StructureTower | undefined;
      if (tower) return { type: "usePower", power: PWR_OPERATE_TOWER, target: tower };
    }
  }

  // Fortify ramparts
  if (powers.includes(PWR_FORTIFY) && ctx.ops >= 5) {
    const lowRampart = ctx.room.find(FIND_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_RAMPART && s.hits < 1000000
    })[0] as StructureRampart | undefined;
    if (lowRampart) return { type: "usePower", power: PWR_FORTIFY, target: lowRampart };
  }

  // Disrupt enemy spawns - use safeFind for hostile spawns
  if (powers.includes(PWR_DISRUPT_SPAWN) && ctx.ops >= 10) {
    const enemySpawn = safeFind(ctx.room, FIND_HOSTILE_SPAWNS)[0];
    if (enemySpawn) return { type: "usePower", power: PWR_DISRUPT_SPAWN, target: enemySpawn };
  }

  // Disrupt enemy towers - use safeFind for hostile structures
  if (powers.includes(PWR_DISRUPT_TOWER) && ctx.ops >= 10) {
    const enemyTowers = safeFind(ctx.room, FIND_HOSTILE_STRUCTURES, {
      filter: (s): s is StructureTower => s.structureType === STRUCTURE_TOWER
    });
    const enemyTower = enemyTowers[0];
    if (enemyTower) return { type: "usePower", power: PWR_DISRUPT_TOWER, target: enemyTower };
  }

  // Move to home room
  if (!ctx.isInHomeRoom) {
    return { type: "moveToRoom", roomName: ctx.homeRoom };
  }

  return { type: "idle" };
}

/**
 * Execute a Power Creep action.
 */
export function executePowerCreepAction(powerCreep: PowerCreep, action: PowerCreepAction): void {
  switch (action.type) {
    case "usePower": {
      const result = action.target
        ? powerCreep.usePower(action.power, action.target)
        : powerCreep.usePower(action.power);
      if (result === ERR_NOT_IN_RANGE && action.target) {
        moveCreep(powerCreep, action.target);
      }
      break;
    }

    case "moveTo":
      moveCreep(powerCreep, action.target);
      break;

    case "moveToRoom":
      moveToRoom(powerCreep, action.roomName);
      break;

    case "renewSelf": {
      const result = powerCreep.renew(action.spawn);
      if (result === ERR_NOT_IN_RANGE) {
        moveCreep(powerCreep, action.spawn);
      }
      break;
    }

    case "enableRoom":
      if (powerCreep.room?.controller) {
        const result = powerCreep.enableRoom(powerCreep.room.controller);
        if (result === ERR_NOT_IN_RANGE) {
          moveCreep(powerCreep, powerCreep.room.controller);
        }
      }
      break;

    case "idle":
      // No action
      break;
  }
}

// =============================================================================
// Dispatcher
// =============================================================================

const powerBehaviors: Record<string, (ctx: CreepContext) => CreepAction> = {
  powerHarvester,
  powerCarrier
};

/**
 * Evaluate and return an action for a power-related creep.
 */
export function evaluatePowerBehavior(ctx: CreepContext): CreepAction {
  const behavior = powerBehaviors[ctx.memory.role] ?? powerHarvester;
  return behavior(ctx);
}

/**
 * Evaluate and return an action for a Power Creep.
 */
export function evaluatePowerCreepBehavior(ctx: PowerCreepContext): PowerCreepAction {
  const memory = ctx.powerCreep.memory as unknown as SwarmCreepMemory;
  if (memory.role === "powerWarrior") return powerWarrior(ctx);
  return powerQueen(ctx);
}
