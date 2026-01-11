/**
 * Power Behaviors
 *
 * Behavior functions for power-related creeps and Power Creeps.
 * Includes power harvesting (regular creeps) and Power Creep abilities.
 */

import type { SwarmCreepMemory } from "../memory/schemas";
import { safeFind } from "@ralphschuler/screeps-utils";
import { moveTo } from "screeps-cartographer";
import type { CreepAction, CreepContext } from "./types";
import {
  cachedRoomFind,
  cachedFindMyStructures,
  cachedFindDroppedResources
} from "../cache";

// =============================================================================
// Regular Creep Power Roles
// =============================================================================

/**
 * Power bank damage reflection constant
 * Power banks reflect this percentage of damage back to attackers
 */
const POWER_BANK_DAMAGE_REFLECTION = 0.5;

/**
 * Health threshold for power harvester retreat
 * Retreat to healer when HP falls below this percentage
 */
const POWER_HARVESTER_RETREAT_THRESHOLD = 0.5;

/**
 * Check if a structure has a specific power effect active
 */
function hasActiveEffect(structure: RoomObject, effectType: PowerConstant): boolean {
  const effects = (structure as { effects?: RoomObjectEffect[] }).effects;
  return effects !== undefined && Array.isArray(effects) &&
    effects.some(e => e.effect === effectType);
}

/**
 * PowerHarvester - Attack power banks in highway rooms.
 * Power banks reflect 50% damage, so these creeps need healer support.
 */
export function powerHarvester(ctx: CreepContext): CreepAction {
  const targetRoom = ctx.memory.targetRoom;

  if (!targetRoom) return { type: "idle" };

  // Move to target room
  if (ctx.room.name !== targetRoom) {
    return { type: "moveToRoom", roomName: targetRoom };
  }

  // Find power bank
  const powerBank = cachedRoomFind(ctx.room, FIND_STRUCTURES, {
    filter: (s: Structure) => s.structureType === STRUCTURE_POWER_BANK,
    filterKey: 'powerBank'
  })[0] as StructurePowerBank | undefined;

  if (!powerBank) {
    // Power bank destroyed - return home
    delete ctx.memory.targetRoom;
    return { type: "moveToRoom", roomName: ctx.homeRoom };
  }

  // Check if heavily damaged - retreat to healer
  if (ctx.creep.hits < ctx.creep.hitsMax * POWER_HARVESTER_RETREAT_THRESHOLD) {
    // Find nearby healer
    const healers = cachedRoomFind(ctx.room, FIND_MY_CREEPS, {
      filter: (c: Creep) => (c.memory as any).role === "healer" && (c.memory as any).targetRoom === targetRoom,
      filterKey: `healer_${targetRoom}`
    }) as Creep[];

    if (healers.length > 0) {
      const nearestHealer = ctx.creep.pos.findClosestByRange(healers);
      if (nearestHealer && ctx.creep.pos.getRangeTo(nearestHealer) > 1) {
        return { type: "moveTo", target: nearestHealer };
      }
    }
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
      // Locate power spawn
      const powerSpawn = cachedFindMyStructures<StructurePowerSpawn>(homeRoom, STRUCTURE_POWER_SPAWN)[0];

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
  const droppedPower = cachedFindDroppedResources(ctx.room, RESOURCE_POWER)[0];

  if (droppedPower) return { type: "pickup", target: droppedPower };

  // Collect from ruins
  const ruins = cachedRoomFind(ctx.room, FIND_RUINS, {
    filter: (r: Ruin) => r.store.getUsedCapacity(RESOURCE_POWER) > 0,
    filterKey: 'powerRuin'
  }) as Ruin[];
  const ruin = ruins[0];

  if (ruin) return { type: "withdraw", target: ruin, resourceType: RESOURCE_POWER };

  // Wait near power bank if it still exists
  const powerBank = cachedRoomFind(ctx.room, FIND_STRUCTURES, {
    filter: (s: Structure) => s.structureType === STRUCTURE_POWER_BANK,
    filterKey: 'powerBank'
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

  const labs = cachedFindMyStructures<StructureLab>(room, STRUCTURE_LAB);

  const spawns = cachedFindMyStructures<StructureSpawn>(room, STRUCTURE_SPAWN);

  const extensions = cachedFindMyStructures<StructureExtension>(room, STRUCTURE_EXTENSION);

  const factory = cachedFindMyStructures<StructureFactory>(room, STRUCTURE_FACTORY)[0];

  const powerSpawn = cachedFindMyStructures<StructurePowerSpawn>(room, STRUCTURE_POWER_SPAWN)[0];

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
 * Enhanced with power usage optimization and task scheduling.
 */
export function powerQueen(ctx: PowerCreepContext): PowerCreepAction {
  // Check for renewal
  if (ctx.powerCreep.ticksToLive !== undefined && ctx.powerCreep.ticksToLive < 1000) {
    if (ctx.powerSpawn) return { type: "renewSelf", spawn: ctx.powerSpawn };
  }

  const powers = ctx.availablePowers;

  // Enable room power if not yet enabled
  if (ctx.room.controller && !ctx.room.controller.isPowerEnabled) {
    return { type: "enableRoom" };
  }

  // Priority 1: Generate ops when critically low
  if (powers.includes(PWR_GENERATE_OPS) && ctx.ops < 20) {
    return { type: "usePower", power: PWR_GENERATE_OPS };
  }

  // Priority 2: Boost spawning (high impact, 100 ops = 3x spawn speed for 1000 ticks)
  if (powers.includes(PWR_OPERATE_SPAWN) && ctx.ops >= 100) {
    // Find spawns that are actively spawning and don't have the effect
    const busySpawn = ctx.spawns.find(s => {
      const spawn = s ;
      return spawn.spawning !== null && !hasActiveEffect(spawn, PWR_OPERATE_SPAWN);
    });
    if (busySpawn) return { type: "usePower", power: PWR_OPERATE_SPAWN, target: busySpawn };
  }

  // Priority 3: Fill extensions (cost-effective, 2 ops for instant fill)
  if (powers.includes(PWR_OPERATE_EXTENSION) && ctx.ops >= 2) {
    const freeCapacity = ctx.extensions.reduce((sum, ext) => sum + ext.store.getFreeCapacity(RESOURCE_ENERGY), 0);
    // Only use if significant capacity needs filling and we have energy
    if (freeCapacity > 1000 && ctx.storage && ctx.storage.store.getUsedCapacity(RESOURCE_ENERGY) > 10000) {
      // Check if effect is not already active
      if (!hasActiveEffect(ctx.storage, PWR_OPERATE_EXTENSION)) {
        return { type: "usePower", power: PWR_OPERATE_EXTENSION, target: ctx.storage };
      }
    }
  }

  // Priority 4: Boost towers (high impact for defense, 10 ops = 2x effectiveness)
  if (powers.includes(PWR_OPERATE_TOWER) && ctx.ops >= 10) {
    const hostiles = cachedRoomFind(ctx.room, FIND_HOSTILE_CREEPS);
    if (hostiles.length > 0) {
      const towers = cachedRoomFind(ctx.room, FIND_MY_STRUCTURES, {
        filter: (s: Structure) => s.structureType === STRUCTURE_TOWER && !hasActiveEffect(s, PWR_OPERATE_TOWER),
        filterKey: 'towerNoEffect'
      }) as StructureTower[];
      if (towers.length > 0) {
        return { type: "usePower", power: PWR_OPERATE_TOWER, target: towers[0] };
      }
    }
  }

  // Priority 5: Boost lab reactions (10 ops = 2x reaction speed)
  if (powers.includes(PWR_OPERATE_LAB) && ctx.ops >= 10) {
    // Find labs that are actively reacting and don't have the effect
    const activeLab = ctx.labs.find(l => 
      l.cooldown === 0 && 
      l.mineralType && 
      !hasActiveEffect(l, PWR_OPERATE_LAB)
    );
    if (activeLab) return { type: "usePower", power: PWR_OPERATE_LAB, target: activeLab };
  }

  // Priority 6: Boost factory (100 ops = instant production)
  if (powers.includes(PWR_OPERATE_FACTORY) && ctx.ops >= 100 && ctx.factory) {
    // Only use if factory has work to do and effect not active
    if (ctx.factory.cooldown === 0 && !hasActiveEffect(ctx.factory, PWR_OPERATE_FACTORY)) {
      return { type: "usePower", power: PWR_OPERATE_FACTORY, target: ctx.factory };
    }
  }

  // Priority 7: Boost storage capacity when near full (100 ops = 2x capacity)
  if (powers.includes(PWR_OPERATE_STORAGE) && ctx.ops >= 100 && ctx.storage) {
    if (ctx.storage.store.getUsedCapacity() > ctx.storage.store.getCapacity() * 0.85 &&
        !hasActiveEffect(ctx.storage, PWR_OPERATE_STORAGE)) {
      return { type: "usePower", power: PWR_OPERATE_STORAGE, target: ctx.storage };
    }
  }

  // Priority 8: Regen source when depleted (100 ops = instant regen)
  if (powers.includes(PWR_REGEN_SOURCE) && ctx.ops >= 100) {
    const depletedSources = cachedRoomFind(ctx.room, FIND_SOURCES, {
      filter: (s: Source) => s.energy === 0 && s.ticksToRegeneration > 100,
      filterKey: 'depletedSource'
    }) as Source[];
    const depletedSource = depletedSources[0];
    if (depletedSource) {
      return { type: "usePower", power: PWR_REGEN_SOURCE, target: depletedSource };
    }
  }

  // Priority 9: Generate ops when below optimal level
  if (powers.includes(PWR_GENERATE_OPS) && ctx.ops < 100) {
    return { type: "usePower", power: PWR_GENERATE_OPS };
  }

  // Move to home room
  if (!ctx.isInHomeRoom) {
    return { type: "moveToRoom", roomName: ctx.homeRoom };
  }

  // Stay near storage for efficiency
  if (ctx.storage && ctx.powerCreep.pos.getRangeTo(ctx.storage) > 3) {
    return { type: "moveTo", target: ctx.storage };
  }

  return { type: "idle" };
}

/**
 * PowerWarrior - Combat-support Power Creep.
 * Uses powers for defense and offense.
 * Enhanced with priority-based power usage for combat situations.
 */
export function powerWarrior(ctx: PowerCreepContext): PowerCreepAction {
  // Check for renewal
  if (ctx.powerCreep.ticksToLive !== undefined && ctx.powerCreep.ticksToLive < 1000) {
    if (ctx.powerSpawn) return { type: "renewSelf", spawn: ctx.powerSpawn };
  }

  const powers = ctx.availablePowers;
  const hostiles = safeFind(ctx.room, FIND_HOSTILE_CREEPS);
  const hostileStructures = safeFind(ctx.room, FIND_HOSTILE_STRUCTURES);

  // Enable room power if not yet enabled
  if (ctx.room.controller && !ctx.room.controller.isPowerEnabled) {
    return { type: "enableRoom" };
  }

  // Priority 1: Generate ops when critically low
  if (powers.includes(PWR_GENERATE_OPS) && ctx.ops < 20) {
    return { type: "usePower", power: PWR_GENERATE_OPS };
  }

  // Priority 2: Shield allies in combat (10 ops = 5k HP shield)
  if (powers.includes(PWR_SHIELD) && ctx.ops >= 10 && hostiles.length > 0) {
    const damagedAlly = cachedRoomFind(ctx.room, FIND_MY_CREEPS, {
      filter: (c: Creep) => {
        const mem = c.memory as { family?: string };
        return mem.family === "military" && c.hits < c.hitsMax * 0.7;
      },
      filterKey: 'damagedMilitary'
    })[0] as Creep | undefined;
    if (damagedAlly) {
      return { type: "usePower", power: PWR_SHIELD, target: damagedAlly };
    }
  }

  // Priority 3: Disrupt enemy spawns (high impact, 10 ops = spawn pause)
  if (powers.includes(PWR_DISRUPT_SPAWN) && ctx.ops >= 10) {
    const enemySpawns = safeFind(ctx.room, FIND_HOSTILE_SPAWNS, {
      filter: s => !hasActiveEffect(s, PWR_DISRUPT_SPAWN)
    });
    const enemySpawn = enemySpawns[0];
    if (enemySpawn) return { type: "usePower", power: PWR_DISRUPT_SPAWN, target: enemySpawn };
  }

  // Priority 4: Disrupt enemy towers (10 ops = disable tower)
  if (powers.includes(PWR_DISRUPT_TOWER) && ctx.ops >= 10) {
    const enemyTowers = safeFind(ctx.room, FIND_HOSTILE_STRUCTURES, {
      filter: (s): s is StructureTower => 
        s.structureType === STRUCTURE_TOWER &&
        !hasActiveEffect(s, PWR_DISRUPT_TOWER)
    });
    const enemyTower = enemyTowers[0];
    if (enemyTower) return { type: "usePower", power: PWR_DISRUPT_TOWER, target: enemyTower };
  }

  // Priority 5: Boost friendly towers for defense (10 ops = 2x effectiveness)
  if (powers.includes(PWR_OPERATE_TOWER) && ctx.ops >= 10 && hostiles.length > 0) {
    const towers = cachedRoomFind(ctx.room, FIND_MY_STRUCTURES, {
      filter: (s: Structure) => 
        s.structureType === STRUCTURE_TOWER &&
        !hasActiveEffect(s, PWR_OPERATE_TOWER),
      filterKey: 'towerNoEffect'
    }) as StructureTower[];
    const tower = towers[0];
    if (tower) return { type: "usePower", power: PWR_OPERATE_TOWER, target: tower };
  }

  // Priority 6: Fortify critical ramparts (5 ops = instant boost)
  if (powers.includes(PWR_FORTIFY) && ctx.ops >= 5 && hostiles.length > 0) {
    // Find critical ramparts (protecting spawns, storage, terminal)
    const criticalStructures = [
      ...ctx.spawns,
      ctx.storage,
      ctx.terminal
    ].filter(s => s !== undefined);

    for (const structure of criticalStructures) {
      if (!structure) continue;
      const rampart = ctx.room.lookForAt(LOOK_STRUCTURES, structure.pos).find(
        s => s.structureType === STRUCTURE_RAMPART
      ) as StructureRampart | undefined;
      
      if (rampart && rampart.hits < rampart.hitsMax * 0.5) {
        return { type: "usePower", power: PWR_FORTIFY, target: rampart };
      }
    }

    // Fortify any low rampart
    const lowRampart = cachedRoomFind(ctx.room, FIND_STRUCTURES, {
      filter: (s: Structure) => s.structureType === STRUCTURE_RAMPART && s.hits < 500000,
      filterKey: 'lowRampart'
    })[0] as StructureRampart | undefined;
    if (lowRampart) return { type: "usePower", power: PWR_FORTIFY, target: lowRampart };
  }

  // Priority 7: Disrupt enemy terminals (50 ops = disable terminal)
  if (powers.includes(PWR_DISRUPT_TERMINAL) && ctx.ops >= 50) {
    const enemyTerminal = hostileStructures.find(
      s => s.structureType === STRUCTURE_TERMINAL &&
        !hasActiveEffect(s, PWR_DISRUPT_TERMINAL)
    ) as StructureTerminal | undefined;
    if (enemyTerminal) {
      return { type: "usePower", power: PWR_DISRUPT_TERMINAL, target: enemyTerminal };
    }
  }

  // Priority 8: Generate ops when below optimal level
  if (powers.includes(PWR_GENERATE_OPS) && ctx.ops < 100) {
    return { type: "usePower", power: PWR_GENERATE_OPS };
  }

  // Move to home room or combat zone
  if (!ctx.isInHomeRoom) {
    return { type: "moveToRoom", roomName: ctx.homeRoom };
  }

  // Position near threats for quick response
  if (hostiles.length > 0) {
    const nearest = ctx.powerCreep.pos.findClosestByRange(hostiles);
    if (nearest && ctx.powerCreep.pos.getRangeTo(nearest) > 5) {
      return { type: "moveTo", target: nearest };
    }
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
        moveTo(powerCreep, action.target);
      }
      break;
    }

    case "moveTo":
      moveTo(powerCreep, action.target);
      break;

    case "moveToRoom": {
      const targetPos = new RoomPosition(25, 25, action.roomName);
      moveTo(powerCreep, { pos: targetPos, range: 20 }, { maxRooms: 16 });
      break;
    }

    case "renewSelf": {
      const result = powerCreep.renew(action.spawn);
      if (result === ERR_NOT_IN_RANGE) {
        moveTo(powerCreep, action.spawn);
      }
      break;
    }

    case "enableRoom":
      if (powerCreep.room?.controller) {
        const result = powerCreep.enableRoom(powerCreep.room.controller);
        if (result === ERR_NOT_IN_RANGE) {
          moveTo(powerCreep, powerCreep.room.controller);
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
