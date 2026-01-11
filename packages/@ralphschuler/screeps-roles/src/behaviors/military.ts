/**
 * Military Behaviors
 *
 * Simple, human-readable behavior functions for military roles.
 * Includes defense, offense, and squad-based combat.
 */

import type { SquadMemory, SwarmCreepMemory } from "../memory/schemas";
import { safeFindClosestByRange } from "@ralphschuler/screeps-utils";
import { checkAndExecuteRetreat } from "@ralphschuler/screeps-defense";
import { findCachedClosest } from "../cache";
import { registerMilitaryCacheClear } from "./context";
import type { CreepAction, CreepContext } from "./types";
import { createLogger } from "@ralphschuler/screeps-core";
import { globalCache } from "../cache";
import { getCollectionPoint } from "../utils/common";

const logger = createLogger("MilitaryBehaviors");

// =============================================================================
// Patrol System
// =============================================================================

/** Cache namespace for patrol waypoints */
const PATROL_CACHE_NAMESPACE = "patrol";

/** TTL for patrol waypoints (1000 ticks - waypoints rarely change) */
const PATROL_WAYPOINT_TTL = 1000;

/**
 * Patrol waypoint cache metadata
 */
interface PatrolWaypointMetadata {
  spawnCount: number;
}

/**
 * Cached patrol waypoint data
 * 
 * Note: Waypoints are stored as plain objects instead of RoomPosition to avoid
 * serialization issues and ensure efficient caching. RoomPosition objects are
 * reconstructed on retrieval from the x, y, roomName properties.
 */
interface CachedPatrolWaypoints {
  waypoints: { x: number; y: number; roomName: string }[];
  metadata: PatrolWaypointMetadata;
}

/**
 * Get patrol waypoints for a room covering exits and spawn areas.
 * OPTIMIZATION: Cache waypoints per room and only regenerate if spawns change.
 * This saves CPU by avoiding repeated room.find() and terrain checks.
 * 
 * ENHANCEMENT: Expanded patrol coverage to ensure guards encounter threats faster.
 * Added corner waypoints and mid-room positions for better threat detection.
 */
function getPatrolWaypoints(room: Room): RoomPosition[] {
  const spawns = room.find(FIND_MY_SPAWNS);
  const spawnCount = spawns.length;
  
  // Try to get cached waypoints with metadata
  const cacheKey = room.name;
  const cached = globalCache.get<CachedPatrolWaypoints>(
    cacheKey, 
    { namespace: PATROL_CACHE_NAMESPACE }
  );
  
  // Check if cached data is valid (same spawn count)
  if (cached && cached.metadata.spawnCount === spawnCount) {
    return cached.waypoints.map(w => new RoomPosition(w.x, w.y, w.roomName));
  }

  const roomName = room.name;

  // Generate patrol points covering key defensive positions
  const waypoints: RoomPosition[] = [];

  // Add spawn area positions (offset from spawns)
  for (const spawn of spawns) {
    waypoints.push(new RoomPosition(spawn.pos.x + 3, spawn.pos.y + 3, roomName));
    waypoints.push(new RoomPosition(spawn.pos.x - 3, spawn.pos.y - 3, roomName));
  }

  // Add exit patrol positions (center and corners of each exit side)
  // Top exit (center and corners)
  waypoints.push(new RoomPosition(10, 5, roomName));
  waypoints.push(new RoomPosition(25, 5, roomName));
  waypoints.push(new RoomPosition(39, 5, roomName));
  // Bottom exit (center and corners)
  waypoints.push(new RoomPosition(10, 44, roomName));
  waypoints.push(new RoomPosition(25, 44, roomName));
  waypoints.push(new RoomPosition(39, 44, roomName));
  // Left exit (center and mid-points)
  waypoints.push(new RoomPosition(5, 10, roomName));
  waypoints.push(new RoomPosition(5, 25, roomName));
  waypoints.push(new RoomPosition(5, 39, roomName));
  // Right exit (center and mid-points)
  waypoints.push(new RoomPosition(44, 10, roomName));
  waypoints.push(new RoomPosition(44, 25, roomName));
  waypoints.push(new RoomPosition(44, 39, roomName));

  // Add room corners for complete coverage
  waypoints.push(new RoomPosition(10, 10, roomName));
  waypoints.push(new RoomPosition(39, 10, roomName));
  waypoints.push(new RoomPosition(10, 39, roomName));
  waypoints.push(new RoomPosition(39, 39, roomName));

  // Add central waypoint for room center coverage
  waypoints.push(new RoomPosition(25, 25, roomName));

  // Clamp positions to valid room bounds and filter out walls
  const filtered = waypoints
    .map(pos => {
      const x = Math.max(2, Math.min(47, pos.x));
      const y = Math.max(2, Math.min(47, pos.y));
      return { x, y, roomName };
    })
    .filter(pos => {
      const terrain = room.getTerrain().get(pos.x, pos.y);
      return terrain !== TERRAIN_MASK_WALL;
    })
    .map(pos => new RoomPosition(pos.x, pos.y, pos.roomName));

  // Cache with spawn count in metadata for invalidation
  const cacheData: CachedPatrolWaypoints = {
    waypoints: filtered.map(p => ({ x: p.x, y: p.y, roomName: p.roomName })),
    metadata: { spawnCount }
  };
  
  globalCache.set(cacheKey, cacheData, {
    namespace: PATROL_CACHE_NAMESPACE,
    ttl: PATROL_WAYPOINT_TTL
  });
  
  return filtered;
}

/**
 * Get the next patrol waypoint for a creep.
 * Cycles through waypoints in order.
 */
function getNextPatrolWaypoint(creep: Creep, waypoints: RoomPosition[]): RoomPosition | null {
  if (waypoints.length === 0) return null;

  const mem = creep.memory as unknown as SwarmCreepMemory;

  // Initialize patrol index if not set
  if (mem.patrolIndex === undefined) {
    mem.patrolIndex = 0;
  }

  const currentWaypoint = waypoints[mem.patrolIndex % waypoints.length];

  // Check if we've reached the current waypoint (within 2 tiles using Chebyshev distance)
  if (currentWaypoint && creep.pos.getRangeTo(currentWaypoint) <= 2) {
    // Move to next waypoint
    mem.patrolIndex = (mem.patrolIndex + 1) % waypoints.length;
  }

  return waypoints[mem.patrolIndex % waypoints.length] ?? null;
}

// =============================================================================
// Combat Helpers
// =============================================================================

/**
 * Find the highest priority hostile target.
 * Priority: Healers > Ranged > Melee > Claimers > Workers
 *
 * Note: We intentionally do NOT use caching here because:
 * 1. Priority scoring is complex and position-independent
 * 2. Cache would only store the closest target, not the highest priority
 * 3. Combat is dynamic - priorities change frequently as creeps take damage
 * 4. This function is only called when hostiles are present (not every tick)
 *
 * OPTIMIZATION: Use getActiveBodyparts() instead of iterating all body parts.
 * This is much faster as it's a native engine call and only counts active parts.
 */
function findPriorityTarget(ctx: CreepContext): Creep | null {
  if (ctx.hostiles.length === 0) return null;

  const scored = ctx.hostiles.map(hostile => {
    let score = 0;
    
    // Use getActiveBodyparts() for faster body part counting
    // OPTIMIZATION: This is O(1) per body part type vs O(n) for iterating all parts
    const healParts = hostile.getActiveBodyparts(HEAL);
    const rangedParts = hostile.getActiveBodyparts(RANGED_ATTACK);
    const attackParts = hostile.getActiveBodyparts(ATTACK);
    const claimParts = hostile.getActiveBodyparts(CLAIM);
    const workParts = hostile.getActiveBodyparts(WORK);
    
    // Calculate score based on body composition
    score += healParts * 100;
    score += rangedParts * 50;
    score += attackParts * 40;
    score += claimParts * 60;
    score += workParts * 30;
    
    // Check for any boosted parts (rare, so only check if score is high)
    if (score > 0) {
      for (const part of hostile.body) {
        if (part.boost) {
          score += 20;
          break; // Only add boost bonus once
        }
      }
    }
    
    return { hostile, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.hostile ?? null;
}

/**
 * Check if creep has a specific body part.
 */
function hasBodyPart(creep: Creep, part: BodyPartConstant): boolean {
  return creep.getActiveBodyparts(part) > 0;
}

/**
 * Move to collection point if available and not already there.
 * Collection points are designated positions away from spawns where idle military units wait.
 * Returns true if the creep should move to collection point, false otherwise.
 * 
 * @param ctx - Creep context
 * @param debugLabel - Label for debug logging (e.g., "siegeUnit", "harasser")
 * @returns CreepAction to move to collection point, or null if at collection point or unavailable
 */
function moveToCollectionPoint(ctx: CreepContext, debugLabel: string): CreepAction | null {
  if (!ctx.swarmState) return null;
  
  const collectionPoint = getCollectionPoint(ctx.room.name);
  if (!collectionPoint) return null;
  
  // Only move if not already near collection point
  if (ctx.creep.pos.getRangeTo(collectionPoint) > 2) {
    logger.debug(`${ctx.creep.name} ${debugLabel} moving to collection point at ${collectionPoint.x},${collectionPoint.y}`);
    return { type: "moveTo", target: collectionPoint };
  }
  
  return null;
}

/**
 * Get squad memory by ID.
 */
function getSquadMemory(squadId: string): SquadMemory | undefined {
  const mem = Memory as unknown as Record<string, Record<string, SquadMemory>>;
  return mem.squads?.[squadId];
}

// =============================================================================
// Role Behaviors
// =============================================================================

/**
 * Guard - Home defense creep.
 * Attacks nearby hostiles, patrols the room when idle.
 * Can assist neighboring rooms when requested by defense coordinator.
 */
export function guard(ctx: CreepContext): CreepAction {
  const mem = ctx.creep.memory as unknown as SwarmCreepMemory;

  // Check if should retreat based on threat assessment
  if (checkAndExecuteRetreat(ctx.creep)) {
    return { type: "idle" }; // Retreat logic handles movement
  }

  // Check if assigned to assist another room
  if (mem.assistTarget) {
    // Move to assist room if not there yet
    if (ctx.creep.room.name !== mem.assistTarget) {
      return { type: "moveToRoom", roomName: mem.assistTarget };
    }

    // In assist room - check if threat is resolved using pre-computed hostiles from context
    if (ctx.hostiles.length === 0) {
      // Threat resolved, clear assignment and return home
      delete mem.assistTarget;
      if (ctx.creep.room.name !== ctx.homeRoom) {
        return { type: "moveToRoom", roomName: ctx.homeRoom };
      }
    } else {
      // Engage hostiles using same logic as home defense
      const assistTarget = findPriorityTarget(ctx);
      if (assistTarget) {
        const range = ctx.creep.pos.getRangeTo(assistTarget);
        const hasRanged = hasBodyPart(ctx.creep, RANGED_ATTACK);
        const hasMelee = hasBodyPart(ctx.creep, ATTACK);

        if (hasRanged && range <= 3) return { type: "rangedAttack", target: assistTarget };
        if (hasMelee && range <= 1) return { type: "attack", target: assistTarget };
        return { type: "moveTo", target: assistTarget };
      }
    }
  }

  // Return to home room if not there (and not on assist mission)
  if (ctx.creep.room.name !== ctx.homeRoom) {
    return { type: "moveToRoom", roomName: ctx.homeRoom };
  }

  // Normal home defense behavior - engage hostiles in home room
  const target = findPriorityTarget(ctx);

  if (target) {
    const range = ctx.creep.pos.getRangeTo(target);
    const hasRanged = hasBodyPart(ctx.creep, RANGED_ATTACK);
    const hasMelee = hasBodyPart(ctx.creep, ATTACK);

    if (hasRanged && range <= 3) return { type: "rangedAttack", target };
    if (hasMelee && range <= 1) return { type: "attack", target };
    return { type: "moveTo", target };
  }

  // No hostiles - patrol the room
  const waypoints = getPatrolWaypoints(ctx.room);
  const nextWaypoint = getNextPatrolWaypoint(ctx.creep, waypoints);

  if (nextWaypoint) {
    return { type: "moveTo", target: nextWaypoint };
  }

  // Fallback: move near spawn if no waypoints available
  const spawn = ctx.creep.pos.findClosestByRange(FIND_MY_SPAWNS);
  if (spawn && ctx.creep.pos.getRangeTo(spawn) > 5) {
    return { type: "moveTo", target: spawn };
  }

  return { type: "idle" };
}

/**
 * Remote Guard - Defends remote mining operations.
 * Patrols assigned remote room and engages hostile threats.
 * Returns to home room when remote is secure.
 */
export function remoteGuard(ctx: CreepContext): CreepAction {
  const mem = ctx.creep.memory as unknown as SwarmCreepMemory & { targetRoom?: string };

  // Must have target room assigned
  if (!mem.targetRoom) {
    // No target room - return to home
    if (ctx.creep.room.name !== ctx.homeRoom) {
      return { type: "moveToRoom", roomName: ctx.homeRoom };
    }
    // In home room with no assignment - patrol for home defense
    const waypoints = getPatrolWaypoints(ctx.room);
    const nextWaypoint = getNextPatrolWaypoint(ctx.creep, waypoints);
    if (nextWaypoint) {
      return { type: "moveTo", target: nextWaypoint };
    }
    return { type: "idle" };
  }

  // Move to target room if not there
  if (ctx.creep.room.name !== mem.targetRoom) {
    return { type: "moveToRoom", roomName: mem.targetRoom };
  }

  // In target room - check for hostiles
  const hostiles = ctx.room.find(FIND_HOSTILE_CREEPS);
  
  // Filter to dangerous hostiles (with combat parts)
  const dangerousHostiles = hostiles.filter(h =>
    h.body.some(p => p.type === ATTACK || p.type === RANGED_ATTACK || p.type === WORK)
  );

  if (dangerousHostiles.length === 0) {
    // Remote is secure - return to home room
    if (ctx.creep.room.name !== ctx.homeRoom) {
      return { type: "moveToRoom", roomName: ctx.homeRoom };
    }
    // In home room - patrol for home defense
    const waypoints = getPatrolWaypoints(ctx.room);
    const nextWaypoint = getNextPatrolWaypoint(ctx.creep, waypoints);
    if (nextWaypoint) {
      return { type: "moveTo", target: nextWaypoint };
    }
    return { type: "idle" };
  }

  // Find priority target among dangerous hostiles
  const target = findPriorityTargetFromList(ctx, dangerousHostiles);

  if (target) {
    const range = ctx.creep.pos.getRangeTo(target);
    const hasRanged = hasBodyPart(ctx.creep, RANGED_ATTACK);
    const hasMelee = hasBodyPart(ctx.creep, ATTACK);

    if (hasRanged && range <= 3) return { type: "rangedAttack", target };
    if (hasMelee && range <= 1) return { type: "attack", target };
    return { type: "moveTo", target };
  }

  // Patrol remote room if no immediate threats
  const sources = ctx.room.find(FIND_SOURCES);
  if (sources.length > 0) {
    // Move between sources
    const closestSource = ctx.creep.pos.findClosestByRange(sources);
    if (closestSource && ctx.creep.pos.getRangeTo(closestSource) > 3) {
      return { type: "moveTo", target: closestSource };
    }
  }

  return { type: "idle" };
}

/**
 * Find priority target from a specific list of hostiles
 */
function findPriorityTargetFromList(ctx: CreepContext, hostiles: Creep[]): Creep | null {
  if (hostiles.length === 0) return null;

  // Priority: Boosted > Healers > Ranged > Melee > Others
  const priorities = [
    hostiles.filter(h => h.body.some(p => p.boost)),
    hostiles.filter(h => hasBodyPart(h, HEAL)),
    hostiles.filter(h => hasBodyPart(h, RANGED_ATTACK)),
    hostiles.filter(h => hasBodyPart(h, ATTACK)),
    hostiles
  ];

  for (const group of priorities) {
    if (group.length > 0) {
      // Return closest from this priority group
      return ctx.creep.pos.findClosestByRange(group);
    }
  }

  return null;
}

/**
 * Healer - Support creep that heals allies.
 * Priority: self-heal if critical → heal nearby allies → follow military creeps
 * Can assist neighboring rooms when requested.
 */
export function healer(ctx: CreepContext): CreepAction {
  const mem = ctx.creep.memory as unknown as SwarmCreepMemory;

  // Always heal self if critically damaged
  if (ctx.creep.hits < ctx.creep.hitsMax * 0.5) {
    return { type: "heal", target: ctx.creep };
  }

  // Check if assigned to power bank operation
  if (mem.targetRoom) {
    // Move to target room (power bank location)
    if (ctx.room.name !== mem.targetRoom) {
      return { type: "moveToRoom", roomName: mem.targetRoom };
    }

    // In target room - heal power harvesters
    const powerHarvesters = ctx.room.find(FIND_MY_CREEPS, {
      filter: c => {
        const m = c.memory as unknown as SwarmCreepMemory;
        return m.role === "powerHarvester" && m.targetRoom === mem.targetRoom;
      }
    });

    // Find most damaged power harvester
    if (powerHarvesters.length > 0) {
      powerHarvesters.sort((a, b) => {
        const ratioA = a.hitsMax > 0 ? a.hits / a.hitsMax : 1;
        const ratioB = b.hitsMax > 0 ? b.hits / b.hitsMax : 1;
        return ratioA - ratioB;
      });
      const target = powerHarvesters[0]!;
      const range = ctx.creep.pos.getRangeTo(target);

      // Follow and heal the most damaged harvester
      if (range > 3) {
        return { type: "moveTo", target };
      } else if (range <= 1) {
        return { type: "heal", target };
      } else {
        return { type: "rangedHeal", target };
      }
    }

    // Check if power bank is destroyed
    const powerBank = ctx.room.find(FIND_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_POWER_BANK
    })[0];

    if (!powerBank && powerHarvesters.length === 0) {
      // Power bank destroyed and no harvesters - return home
      delete mem.targetRoom;
      return { type: "moveToRoom", roomName: ctx.homeRoom };
    }

    // Stay near power bank if it exists
    if (powerBank) {
      if (ctx.creep.pos.getRangeTo(powerBank) > 3) {
        return { type: "moveTo", target: powerBank };
      }
    }
  }

  // Check if assigned to assist another room
  if (mem.assistTarget) {
    const assistRoom = Game.rooms[mem.assistTarget];
    if (assistRoom) {
      const hostiles = assistRoom.find(FIND_HOSTILE_CREEPS);
      if (hostiles.length === 0) {
        // Threat resolved, clear assignment
        delete mem.assistTarget;
        return { type: "idle" };
      }

      // Move to assist room if not there yet
      if (ctx.creep.room.name !== mem.assistTarget) {
        return { type: "moveToRoom", roomName: mem.assistTarget };
      }
    } else {
      // Can't see assist room - move towards it
      return { type: "moveToRoom", roomName: mem.assistTarget };
    }
  }

  // Heal nearby damaged allies
  const damagedNearby = ctx.creep.pos.findInRange(FIND_MY_CREEPS, 3, {
    filter: c => c.hits < c.hitsMax
  });

  if (damagedNearby.length > 0) {
    damagedNearby.sort((a, b) => {
      const ratioA = a.hitsMax > 0 ? a.hits / a.hitsMax : 1;
      const ratioB = b.hitsMax > 0 ? b.hits / b.hitsMax : 1;
      return ratioA - ratioB;
    });
    const target = damagedNearby[0]!;
    const range = ctx.creep.pos.getRangeTo(target);

    if (range <= 1) return { type: "heal", target };
    return { type: "rangedHeal", target };
  }

  // Follow military creeps (cache for 5 ticks)
  const militaryCreeps = ctx.room.find(FIND_MY_CREEPS, {
    filter: c => {
      const m = c.memory as unknown as SwarmCreepMemory;
      return m.family === "military" && m.role !== "healer";
    }
  });

  if (militaryCreeps.length > 0) {
    const military = findCachedClosest(ctx.creep, militaryCreeps, "healer_follow", 5);
    if (military) return { type: "moveTo", target: military };
  }

  // No military to follow - patrol the room
  const waypoints = getPatrolWaypoints(ctx.room);
  const nextWaypoint = getNextPatrolWaypoint(ctx.creep, waypoints);

  if (nextWaypoint) {
    return { type: "moveTo", target: nextWaypoint };
  }

  return { type: "idle" };
}

/**
 * Soldier - Offensive combat creep.
 * Attacks hostiles and hostile structures.
 * 
 * ENHANCEMENT: Added threat assessment and retreat logic.
 * Soldiers will retreat if critically damaged to preserve expensive units.
 */
export function soldier(ctx: CreepContext): CreepAction {
  // Check for squad assignment
  if (ctx.memory.squadId) {
    const squad = getSquadMemory(ctx.memory.squadId);
    if (squad) return squadBehavior(ctx, squad);
  }

  // TACTICAL RETREAT: If critically damaged (below 30% HP), retreat to home room
  // This is especially important for boosted creeps which are expensive to replace
  const hpPercent = ctx.creep.hits / ctx.creep.hitsMax;
  if (hpPercent < 0.3) {
    if (ctx.room.name !== ctx.homeRoom) {
      return { type: "moveToRoom", roomName: ctx.homeRoom };
    }
    // In home room, move near spawn for healing
    const spawns = ctx.spawnStructures.filter(s => s.structureType === STRUCTURE_SPAWN);
    if (spawns.length > 0 && ctx.creep.pos.getRangeTo(spawns[0]) > 3) {
      return { type: "moveTo", target: spawns[0] };
    }
    return { type: "idle" };
  }

  // Solo behavior
  const targetRoom = ctx.memory.targetRoom ?? ctx.homeRoom;

  // Move to target room
  if (ctx.room.name !== targetRoom) {
    return { type: "moveToRoom", roomName: targetRoom };
  }

  // Find and attack hostile creeps
  const target = findPriorityTarget(ctx);
  if (target) {
    const range = ctx.creep.pos.getRangeTo(target);
    const hasRanged = hasBodyPart(ctx.creep, RANGED_ATTACK);
    const hasMelee = hasBodyPart(ctx.creep, ATTACK);

    if (hasRanged && range <= 3) return { type: "rangedAttack", target };
    if (hasMelee && range <= 1) return { type: "attack", target };
    return { type: "moveTo", target };
  }

  // Attack hostile structures - use safeFindClosestByRange to handle engine errors
  const hostileStructure = safeFindClosestByRange(ctx.creep.pos, FIND_HOSTILE_STRUCTURES, {
    filter: s => s.structureType !== STRUCTURE_CONTROLLER
  });
  if (hostileStructure) return { type: "attack", target: hostileStructure };

  // No targets - patrol the room
  const waypoints = getPatrolWaypoints(ctx.room);
  const nextWaypoint = getNextPatrolWaypoint(ctx.creep, waypoints);

  if (nextWaypoint) {
    return { type: "moveTo", target: nextWaypoint };
  }

  // Fallback: move near spawn if no waypoints available (cache 20 ticks - spawns don't move)
  const spawns = ctx.spawnStructures.filter(s => s.structureType === STRUCTURE_SPAWN);
  if (spawns.length > 0) {
    const spawn = findCachedClosest(ctx.creep, spawns, "soldier_spawn", 20);
    if (spawn && ctx.creep.pos.getRangeTo(spawn) > 5) {
      return { type: "moveTo", target: spawn };
    }
  }

  return { type: "idle" };
}

/**
 * Siege - Dismantler creep for breaking defenses.
 * Priority: spawns → towers → walls/ramparts → other structures
 * 
 * ENHANCEMENT: Added threat assessment and retreat logic.
 * Siege units will retreat if critically damaged to preserve expensive boosted units.
 */
export function siege(ctx: CreepContext): CreepAction {
  // Check for squad assignment
  if (ctx.memory.squadId) {
    const squad = getSquadMemory(ctx.memory.squadId);
    if (squad) return squadBehavior(ctx, squad);
  }

  // TACTICAL RETREAT: If critically damaged (below 30% HP), retreat to home room
  // Siege units are expensive, especially when boosted with WORK boosts
  const hpPercent = ctx.creep.hits / ctx.creep.hitsMax;
  if (hpPercent < 0.3) {
    if (ctx.room.name !== ctx.homeRoom) {
      return { type: "moveToRoom", roomName: ctx.homeRoom };
    }
    // In home room, move near spawn for healing
    const spawns = ctx.spawnStructures.filter(s => s.structureType === STRUCTURE_SPAWN);
    if (spawns.length > 0 && ctx.creep.pos.getRangeTo(spawns[0]) > 3) {
      return { type: "moveTo", target: spawns[0] };
    }
    return { type: "idle" };
  }

  const targetRoom = ctx.memory.targetRoom ?? ctx.homeRoom;

  // Move to target room
  if (ctx.room.name !== targetRoom) {
    return { type: "moveToRoom", roomName: targetRoom };
  }

  // Priority targets for dismantling - use safeFindClosestByRange to handle engine errors
  const spawn = safeFindClosestByRange(ctx.creep.pos, FIND_HOSTILE_SPAWNS);
  if (spawn) return { type: "dismantle", target: spawn };

  const tower = safeFindClosestByRange(ctx.creep.pos, FIND_HOSTILE_STRUCTURES, {
    filter: s => s.structureType === STRUCTURE_TOWER
  });
  if (tower) return { type: "dismantle", target: tower };

  // OPTIMIZATION: Use room.find() once and filter, then cache the result
  // Walls/ramparts don't change often, cache for 10 ticks
  // IMPORTANT: Only target enemy walls/ramparts, not our own
  // Walls are neutral structures, ramparts have ownership
  const walls = ctx.room.find(FIND_STRUCTURES, {
    filter: s => {
      if (s.structureType === STRUCTURE_WALL) {
        // Walls are neutral, only dismantle if in hostile room
        return s.hits < 100000 && !ctx.room.controller?.my;
      }
      if (s.structureType === STRUCTURE_RAMPART) {
        // Ramparts have ownership - only dismantle enemy ramparts
        return s.hits < 100000 && !(s ).my;
      }
      return false;
    }
  });
  if (walls.length > 0) {
    const wall = findCachedClosest(ctx.creep, walls, "siege_wall", 10);
    if (wall) return { type: "dismantle", target: wall };
  }

  const structure = safeFindClosestByRange(ctx.creep.pos, FIND_HOSTILE_STRUCTURES, {
    filter: s => s.structureType !== STRUCTURE_CONTROLLER
  });
  if (structure) return { type: "dismantle", target: structure };

  // No targets - move to collection point to avoid blocking spawns
  const collectionAction = moveToCollectionPoint(ctx, "siegeUnit");
  if (collectionAction) return collectionAction;

  // Fallback: patrol the room if at collection point or no collection point available
  const waypoints = getPatrolWaypoints(ctx.room);
  const nextWaypoint = getNextPatrolWaypoint(ctx.creep, waypoints);

  if (nextWaypoint) {
    return { type: "moveTo", target: nextWaypoint };
  }

  return { type: "idle" };
}

/**
 * Harasser - Hit-and-run attacker targeting workers.
 * Flees from dangerous combat creeps.
 * 
 * ENHANCEMENT: Improved threat assessment with HP-based retreat logic.
 * Harassers are fast, cheap units designed for hit-and-run tactics.
 */
export function harasser(ctx: CreepContext): CreepAction {
  const targetRoom = ctx.memory.targetRoom;

  // TACTICAL RETREAT: If critically damaged (below 40% HP), return home
  // Harassers should retreat earlier than heavy units since they're meant for hit-and-run
  const hpPercent = ctx.creep.hits / ctx.creep.hitsMax;
  if (hpPercent < 0.4) {
    if (ctx.room.name !== ctx.homeRoom) {
      return { type: "moveToRoom", roomName: ctx.homeRoom };
    }
    // In home room, move near spawn
    const spawns = ctx.spawnStructures.filter(s => s.structureType === STRUCTURE_SPAWN);
    if (spawns.length > 0 && ctx.creep.pos.getRangeTo(spawns[0]) > 3) {
      return { type: "moveTo", target: spawns[0] };
    }
    return { type: "idle" };
  }

  if (!targetRoom) {
    // No target room assigned - move to collection point to avoid blocking spawns
    const collectionAction = moveToCollectionPoint(ctx, "harasser (no target)");
    if (collectionAction) return collectionAction;
    return { type: "idle" };
  }

  // Move to target room
  if (ctx.room.name !== targetRoom) {
    return { type: "moveToRoom", roomName: targetRoom };
  }

  // Check for dangerous hostiles nearby - flee if present
  const dangerous = ctx.hostiles.filter(h =>
    ctx.creep.pos.getRangeTo(h) < 5 &&
    h.body.some(p => p.type === ATTACK || p.type === RANGED_ATTACK)
  );

  if (dangerous.length > 0) {
    return { type: "flee", from: dangerous.map(d => d.pos) };
  }

  // Target workers
  const workers = ctx.hostiles.filter(h =>
    h.body.some(p => p.type === WORK || p.type === CARRY)
  );

  if (workers.length > 0) {
    const target = workers.reduce((a, b) =>
      ctx.creep.pos.getRangeTo(a) < ctx.creep.pos.getRangeTo(b) ? a : b
    );
    const range = ctx.creep.pos.getRangeTo(target);

    if (range <= 1) return { type: "attack", target };
    if (range <= 3) return { type: "rangedAttack", target };
    return { type: "moveTo", target };
  }

  // No targets found in assigned target room
  // Return to home room to avoid wasting CPU searching an empty room
  // Harasser will wait at collection point until new target is assigned
  if (ctx.room.name !== ctx.homeRoom) {
    return { type: "moveToRoom", roomName: ctx.homeRoom };
  }

  // In home room with no work - move to collection point or patrol
  const collectionAction = moveToCollectionPoint(ctx, "harasser (no targets)");
  if (collectionAction) return collectionAction;

  // If at collection point or no collection point available, patrol the room
  const waypoints = getPatrolWaypoints(ctx.room);
  const nextWaypoint = getNextPatrolWaypoint(ctx.creep, waypoints);

  if (nextWaypoint) {
    return { type: "moveTo", target: nextWaypoint };
  }

  return { type: "idle" };
}

/**
 * Ranger - Ranged kiting creep.
 * Maintains distance of 3 tiles while attacking.
 * 
 * ENHANCEMENT: Added threat assessment and retreat logic.
 * Rangers will retreat if critically damaged to preserve expensive units.
 */
export function ranger(ctx: CreepContext): CreepAction {
  const mem = ctx.creep.memory as unknown as SwarmCreepMemory;

  // Check if should retreat based on threat assessment
  if (checkAndExecuteRetreat(ctx.creep)) {
    return { type: "idle" }; // Retreat logic handles movement
  }

  // TACTICAL RETREAT: If critically damaged (below 30% HP), retreat to home room
  // Rangers are valuable ranged attackers, often boosted for maximum effectiveness
  const hpPercent = ctx.creep.hits / ctx.creep.hitsMax;
  if (hpPercent < 0.3) {
    // Clear assist target when retreating
    if (mem.assistTarget) {
      delete mem.assistTarget;
    }
    if (ctx.room.name !== ctx.homeRoom) {
      return { type: "moveToRoom", roomName: ctx.homeRoom };
    }
    // In home room, move near spawn for healing
    const spawns = ctx.spawnStructures.filter(s => s.structureType === STRUCTURE_SPAWN);
    if (spawns.length > 0 && ctx.creep.pos.getRangeTo(spawns[0]) > 3) {
      return { type: "moveTo", target: spawns[0] };
    }
    return { type: "idle" };
  }

  // Check if assigned to assist another room
  if (mem.assistTarget) {
    const assistRoom = Game.rooms[mem.assistTarget];
    if (assistRoom) {
      const hostiles = assistRoom.find(FIND_HOSTILE_CREEPS);
      if (hostiles.length === 0) {
        // Threat resolved, clear assignment
        delete mem.assistTarget;
        return { type: "idle" };
      }

      // Move to assist room if not there yet
      if (ctx.creep.room.name !== mem.assistTarget) {
        return { type: "moveToRoom", roomName: mem.assistTarget };
      }

      // In assist room - engage hostiles
      const assistTarget = findPriorityTarget(ctx);
      if (assistTarget) {
        const range = ctx.creep.pos.getRangeTo(assistTarget);
        if (range < 3) return { type: "flee", from: [assistTarget.pos] };
        if (range <= 3) return { type: "rangedAttack", target: assistTarget };
        return { type: "moveTo", target: assistTarget };
      }
    } else {
      // Can't see assist room - move towards it
      return { type: "moveToRoom", roomName: mem.assistTarget };
    }
  }

  // Check for squad assignment
  if (ctx.memory.squadId) {
    const squad = getSquadMemory(ctx.memory.squadId);
    if (squad) return squadBehavior(ctx, squad);
  }

  const target = findPriorityTarget(ctx);

  if (target) {
    const range = ctx.creep.pos.getRangeTo(target);

    // Kite at range 3
    if (range < 3) return { type: "flee", from: [target.pos] };
    if (range <= 3) return { type: "rangedAttack", target };
    return { type: "moveTo", target };
  }

  // No targets - patrol the room
  const waypoints = getPatrolWaypoints(ctx.room);
  const nextWaypoint = getNextPatrolWaypoint(ctx.creep, waypoints);

  if (nextWaypoint) {
    return { type: "moveTo", target: nextWaypoint };
  }

  // Fallback: return home if no waypoints available (cache 20 ticks - spawns don't move)
  const spawns = ctx.spawnStructures.filter(s => s.structureType === STRUCTURE_SPAWN);
  if (spawns.length > 0) {
    const spawn = findCachedClosest(ctx.creep, spawns, "harasser_home_spawn", 20);
    if (spawn && ctx.creep.pos.getRangeTo(spawn) > 10) {
      return { type: "moveTo", target: spawn };
    }
  }

  return { type: "idle" };
}

// =============================================================================
// Squad Behavior
// =============================================================================

/**
 * Execute squad-coordinated behavior.
 * 
 * ENHANCEMENT: Improved squad coordination with formation awareness.
 * Squad members stay together and coordinate movements.
 */
function squadBehavior(ctx: CreepContext, squad: SquadMemory): CreepAction {
  // SQUAD COORDINATION: Check if we should wait for other squad members
  const shouldWaitForSquad = (state: string): boolean => {
    if (state !== "gathering" && state !== "moving") return false;
    
    // Count squad members in current room
    const membersInRoom = squad.members.filter(name => {
      const creep = Game.creeps[name];
      return creep && creep.room.name === ctx.room.name;
    }).length;
    
    // Wait if less than 50% of squad is present (minimum 2 members)
    const totalMembers = squad.members.length;
    return membersInRoom < Math.max(2, totalMembers * 0.5);
  };

  switch (squad.state) {
    case "gathering":
      // Move to rally point
      if (ctx.room.name !== squad.rallyRoom) {
        return { type: "moveToRoom", roomName: squad.rallyRoom };
      }
      
      // Wait at rally point for other squad members
      const rallyPos = new RoomPosition(25, 25, squad.rallyRoom);
      if (ctx.creep.pos.getRangeTo(rallyPos) > 3) {
        return { type: "moveTo", target: rallyPos };
      }
      
      return { type: "idle" };

    case "moving": {
      const targetRoom = squad.targetRooms[0];
      if (!targetRoom) return { type: "idle" };
      
      if (ctx.room.name !== targetRoom) {
        // COORDINATION: Wait for squad if we're ahead
        if (shouldWaitForSquad("moving")) {
          return { type: "idle" };
        }
        return { type: "moveToRoom", roomName: targetRoom };
      }
      return { type: "idle" };
    }

    case "attacking":
      // RETREAT CHECK: Squad members should retreat if HP is too low
      // Default to 30% if retreatThreshold is not set
      const hpPercent = ctx.creep.hits / ctx.creep.hitsMax;
      const retreatThreshold = squad.retreatThreshold ?? 0.3;
      if (hpPercent < retreatThreshold) {
        // Individual retreat to rally room
        if (ctx.room.name !== squad.rallyRoom) {
          return { type: "moveToRoom", roomName: squad.rallyRoom };
        }
      }
      
      // Execute role-specific attack behavior
      switch (ctx.memory.role) {
        case "soldier":
        case "guard":
          return soldier(ctx);
        case "healer":
          return healer(ctx);
        case "siegeUnit":
          return siege(ctx);
        case "ranger":
          return ranger(ctx);
        default:
          return soldier(ctx);
      }

    case "retreating":
      if (ctx.room.name !== squad.rallyRoom) {
        return { type: "moveToRoom", roomName: squad.rallyRoom };
      }
      return { type: "moveTo", target: new RoomPosition(25, 25, squad.rallyRoom) };

    case "dissolving":
      if (ctx.room.name !== ctx.homeRoom) {
        return { type: "moveToRoom", roomName: ctx.homeRoom };
      }
      delete ctx.memory.squadId;
      return { type: "idle" };

    default:
      return { type: "idle" };
  }
}

// =============================================================================
// Role Dispatcher
// =============================================================================

const militaryBehaviors: Record<string, (ctx: CreepContext) => CreepAction> = {
  guard,
  remoteGuard,
  healer,
  soldier,
  siegeUnit: siege,
  harasser,
  ranger
};

/**
 * Evaluate and return an action for a military role creep.
 */
export function evaluateMilitaryBehavior(ctx: CreepContext): CreepAction {
  const behavior = militaryBehaviors[ctx.memory.role] ?? guard;
  return behavior(ctx);
}

// =============================================================================
// Cache Management
// =============================================================================

/**
 * Clear military behavior caches.
 * Called by context.ts at the start of each tick.
 * 
 * OPTIMIZATION: We no longer clear patrol waypoint cache every tick.
 * It's cached long-term and invalidated based on spawn count changes.
 * 
 * Note: This function is kept as a no-op placeholder for future military
 * caches that may need per-tick clearing. The registration is maintained
 * for consistency with the context system architecture.
 */
function clearMilitaryCaches(): void {
  // Patrol waypoint cache is now persistent across ticks
  // Future per-tick caches can be cleared here if needed
}

// Register with context system for architectural consistency
registerMilitaryCacheClear(clearMilitaryCaches);
