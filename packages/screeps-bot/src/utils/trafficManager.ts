/**
 * Traffic Management - Yield/Priority Rules
 *
 * Implements yield and priority rules for creep movement:
 * - Priority-based movement
 * - Stuck detection and resolution
 * - Yield rules based on role importance
 * - Side-step behaviors
 * - Move request system for proactive creep communication
 *
 * Addresses Issue: #33 and creep blocking issue
 */

import type { SwarmCreepMemory } from "../memory/schemas";

// =============================================================================
// Move Request System
// =============================================================================

/**
 * A move request from one creep asking another to move.
 * This allows creeps to proactively communicate their intent to occupy a position.
 */
interface MoveRequest {
  /** The creep requesting the position */
  requester: Creep;
  /** The position being requested */
  targetPos: RoomPosition;
  /** Priority of the requesting creep (higher = more urgent) */
  priority: number;
  /** Game tick when request was made */
  tick: number;
}

/**
 * Per-tick storage of move requests, keyed by position string "roomName:x,y"
 */
const moveRequests = new Map<string, MoveRequest[]>();

/**
 * Last tick when move requests were processed
 */
let lastMoveRequestTick = -1;

/**
 * Create a position key for the move request map
 */
function positionKey(pos: RoomPosition | { x: number; y: number; roomName: string }): string {
  return `${pos.roomName}:${pos.x},${pos.y}`;
}

/**
 * Clear move requests at the start of each tick.
 * Should be called at the beginning of the main loop.
 */
export function clearMoveRequests(): void {
  moveRequests.clear();
  lastMoveRequestTick = Game.time;
}

/**
 * Register a move request for a position.
 * This tells the system that a creep intends to move to this position
 * and any blocking creep should be asked to move out of the way.
 *
 * @param creep - The creep that wants the position
 * @param targetPos - The position the creep wants to move to
 * @returns true if the request was registered
 */
export function requestMoveToPosition(creep: Creep, targetPos: RoomPosition): boolean {
  // Ensure we're on the right tick
  if (lastMoveRequestTick !== Game.time) {
    clearMoveRequests();
  }

  const key = positionKey(targetPos);
  const priority = getCreepPriority(creep);

  const request: MoveRequest = {
    requester: creep,
    targetPos,
    priority,
    tick: Game.time
  };

  const existingRequests = moveRequests.get(key);
  if (existingRequests) {
    existingRequests.push(request);
  } else {
    moveRequests.set(key, [request]);
  }

  return true;
}

/**
 * Process all move requests and ask blocking creeps to move.
 * Should be called after all creeps have registered their intents
 * but before movement reconciliation.
 *
 * @returns Number of creeps that were asked to move
 */
export function processMoveRequests(): number {
  let movedCount = 0;

  for (const [_posKey, requests] of moveRequests) {
    if (requests.length === 0) continue;

    // Sort requests by priority (highest first)
    requests.sort((a, b) => b.priority - a.priority);

    // Get the highest priority request
    const topRequest = requests[0];
    if (!topRequest) continue;

    // Find if there's a creep blocking this position
    const room = Game.rooms[topRequest.targetPos.roomName];
    if (!room) continue;

    const blockingCreeps = room.lookForAt(LOOK_CREEPS, topRequest.targetPos.x, topRequest.targetPos.y);
    const blockingCreep = blockingCreeps.find(c => c.my && c.name !== topRequest.requester.name);

    if (!blockingCreep) continue;

    // Check if the blocking creep should yield
    if (shouldYieldTo(blockingCreep, topRequest.requester)) {
      // Try to make the blocking creep move
      const sideStep = findSideStepPosition(blockingCreep);
      if (sideStep) {
        const result = blockingCreep.move(blockingCreep.pos.getDirectionTo(sideStep));
        if (result === OK) {
          movedCount++;
        }
      }
    }
  }

  return movedCount;
}

/**
 * Check if a position has any pending move requests from higher priority creeps.
 *
 * @param pos - Position to check
 * @param creep - Optional creep to compare priority against
 * @returns true if there's a higher priority request for this position
 */
export function hasHigherPriorityRequest(pos: RoomPosition, creep?: Creep): boolean {
  const key = positionKey(pos);
  const requests = moveRequests.get(key);

  if (!requests || requests.length === 0) return false;

  if (!creep) {
    // Any request counts
    return true;
  }

  const myPriority = getCreepPriority(creep);
  return requests.some(req => req.priority > myPriority && req.requester.name !== creep.name);
}

/**
 * Get all move requests for a position.
 *
 * @param pos - Position to check
 * @returns Array of move requests, or empty array if none
 */
export function getMoveRequests(pos: RoomPosition): MoveRequest[] {
  const key = positionKey(pos);
  return moveRequests.get(key) ?? [];
}

/**
 * Role priority weights (higher = more important)
 */
const ROLE_PRIORITIES: Record<string, number> = {
  // Military - highest priority
  defender: 100,
  rangedDefender: 95,
  healer: 90,
  soldier: 85,
  siegeUnit: 80,

  // Critical economy
  harvester: 75,
  queenCarrier: 70,
  hauler: 65,
  remoteHarvester: 60,
  remoteHauler: 55,

  // Standard economy
  upgrader: 50,
  builder: 45,
  larvaWorker: 40,

  // Utility
  scout: 35,
  claimer: 30,
  engineer: 25,

  // Low priority
  mineralHarvester: 20,
  depositHarvester: 15,
  labTech: 10,
  factoryWorker: 5
};

/**
 * Stuck detection memory
 */
interface StuckMemory {
  /** Last position */
  lastPos?: { x: number; y: number; roomName: string };
  /** Ticks stuck at same position */
  stuckCount: number;
}

/**
 * Get creep priority
 */
export function getCreepPriority(creep: Creep): number {
  const memory = creep.memory as unknown as SwarmCreepMemory;
  return ROLE_PRIORITIES[memory.role] ?? 50;
}

/**
 * Check if creep should yield to another
 */
export function shouldYieldTo(creep: Creep, other: Creep): boolean {
  const myPriority = getCreepPriority(creep);
  const otherPriority = getCreepPriority(other);

  // Higher priority always wins
  if (otherPriority > myPriority) return true;
  if (otherPriority < myPriority) return false;

  // Equal priority - yield to creep carrying resources (if hauler)
  const memory = creep.memory as unknown as SwarmCreepMemory;
  const otherMemory = other.memory as unknown as SwarmCreepMemory;

  if (memory.role === "hauler" && otherMemory.role === "hauler") {
    const myLoad = creep.store.getUsedCapacity();
    const otherLoad = other.store.getUsedCapacity();
    if (otherLoad > myLoad) return true;
  }

  // Equal priority - yield to older creep
  if (other.ticksToLive && creep.ticksToLive) {
    return other.ticksToLive < creep.ticksToLive;
  }

  return false;
}

/**
 * Check if creep is stuck
 */
export function isStuck(creep: Creep): boolean {
  const memory = creep.memory as unknown as StuckMemory;

  if (!memory.lastPos) {
    memory.lastPos = { x: creep.pos.x, y: creep.pos.y, roomName: creep.pos.roomName };
    memory.stuckCount = 0;
    return false;
  }

  const samePos =
    memory.lastPos.x === creep.pos.x &&
    memory.lastPos.y === creep.pos.y &&
    memory.lastPos.roomName === creep.pos.roomName;

  if (samePos) {
    memory.stuckCount++;
  } else {
    memory.lastPos = { x: creep.pos.x, y: creep.pos.y, roomName: creep.pos.roomName };
    memory.stuckCount = 0;
  }

  // Consider stuck after 3 ticks at same position
  return memory.stuckCount >= 3;
}

/**
 * Get stuck count for a creep
 */
export function getStuckCount(creep: Creep): number {
  const memory = creep.memory as unknown as StuckMemory;
  return memory.stuckCount ?? 0;
}

/**
 * Find a valid side-step position
 */
export function findSideStepPosition(creep: Creep): RoomPosition | null {
  const terrain = creep.room.getTerrain();
  const positions: RoomPosition[] = [];

  // Check all adjacent positions
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (dx === 0 && dy === 0) continue;

      const x = creep.pos.x + dx;
      const y = creep.pos.y + dy;

      // Check bounds
      if (x < 1 || x > 48 || y < 1 || y > 48) continue;

      // Check terrain
      if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;

      // Check for structures
      const structures = creep.room.lookForAt(LOOK_STRUCTURES, x, y);
      const blocked = structures.some(
        s =>
          s.structureType !== STRUCTURE_ROAD &&
          s.structureType !== STRUCTURE_CONTAINER &&
          (s.structureType !== STRUCTURE_RAMPART || !(s as OwnedStructure).my)
      );
      if (blocked) continue;

      // Check for other creeps
      const creeps = creep.room.lookForAt(LOOK_CREEPS, x, y);
      if (creeps.length > 0) continue;

      positions.push(new RoomPosition(x, y, creep.room.name));
    }
  }

  if (positions.length === 0) return null;

  // Prefer road positions
  const roadPosition = positions.find(pos => {
    const structures = creep.room.lookForAt(LOOK_STRUCTURES, pos);
    return structures.some(s => s.structureType === STRUCTURE_ROAD);
  });

  return roadPosition ?? positions[0] ?? null;
}

/**
 * Try to resolve stuck creep
 */
export function tryResolveStuck(creep: Creep): boolean {
  const stuckCount = getStuckCount(creep);

  // First try: find side-step position
  if (stuckCount >= 3 && stuckCount < 6) {
    const sideStep = findSideStepPosition(creep);
    if (sideStep) {
      creep.move(creep.pos.getDirectionTo(sideStep));
      return true;
    }
  }

  // Second try: push blocking creep
  if (stuckCount >= 6) {
    const blockers = creep.pos.findInRange(FIND_MY_CREEPS, 1);
    for (const blocker of blockers) {
      if (shouldYieldTo(blocker, creep)) {
        // Make blocker move away
        const blockerSideStep = findSideStepPosition(blocker);
        if (blockerSideStep) {
          blocker.move(blocker.pos.getDirectionTo(blockerSideStep));
          return true;
        }
      }
    }
  }

  // Third try: random direction
  if (stuckCount >= 9) {
    const directions: DirectionConstant[] = [TOP, TOP_RIGHT, RIGHT, BOTTOM_RIGHT, BOTTOM, BOTTOM_LEFT, LEFT, TOP_LEFT];
    if (directions.length > 0) {
      const randomIndex = Math.floor(Math.random() * directions.length);
      const randomDir = directions[randomIndex];
      if (randomDir !== undefined) {
        creep.move(randomDir);
        return true;
      }
    }
  }

  return false;
}

/**
 * Request creep to yield position
 */
export function requestYield(creep: Creep, direction: DirectionConstant): boolean {
  // Find creep in the direction
  const targetPos = getPositionInDirection(creep.pos, direction);
  if (!targetPos) return false;

  const blockers = creep.room.lookForAt(LOOK_CREEPS, targetPos.x, targetPos.y);
  const blocker = blockers.find(c => c.my);

  if (!blocker) return false;

  // Check if blocker should yield
  if (shouldYieldTo(blocker, creep)) {
    const sideStep = findSideStepPosition(blocker);
    if (sideStep) {
      blocker.move(blocker.pos.getDirectionTo(sideStep));
      return true;
    }
  }

  return false;
}

/**
 * Get position in a direction
 */
function getPositionInDirection(pos: RoomPosition, direction: DirectionConstant): { x: number; y: number } | null {
  const offsets: Record<DirectionConstant, { dx: number; dy: number }> = {
    [TOP]: { dx: 0, dy: -1 },
    [TOP_RIGHT]: { dx: 1, dy: -1 },
    [RIGHT]: { dx: 1, dy: 0 },
    [BOTTOM_RIGHT]: { dx: 1, dy: 1 },
    [BOTTOM]: { dx: 0, dy: 1 },
    [BOTTOM_LEFT]: { dx: -1, dy: 1 },
    [LEFT]: { dx: -1, dy: 0 },
    [TOP_LEFT]: { dx: -1, dy: -1 }
  };

  const offset = offsets[direction];
  if (!offset) return null;

  const x = pos.x + offset.dx;
  const y = pos.y + offset.dy;

  if (x < 0 || x > 49 || y < 0 || y > 49) return null;

  return { x, y };
}

/**
 * Enhanced moveTo with yield/priority support
 */
export function moveWithPriority(
  creep: Creep,
  target: RoomPosition | { pos: RoomPosition },
  opts?: MoveToOpts
): CreepMoveReturnCode | ERR_NO_PATH | ERR_INVALID_TARGET | ERR_NOT_FOUND {
  const targetPos = "pos" in target ? target.pos : target;

  // Check if stuck
  if (isStuck(creep)) {
    tryResolveStuck(creep);
  }

  // Try to move normally
  const result = creep.moveTo(targetPos, {
    reusePath: opts?.reusePath ?? 20,
    maxRooms: opts?.maxRooms ?? 16,
    ...opts
  });

  // If blocked, try to request yield
  if (result === ERR_NO_PATH || result === ERR_TIRED) {
    const direction = creep.pos.getDirectionTo(targetPos);
    requestYield(creep, direction);
  }

  return result;
}

/**
 * Check if a position is walkable
 */
export function isWalkable(pos: RoomPosition): boolean {
  const room = Game.rooms[pos.roomName];
  if (!room) return false;

  // Check terrain
  const terrain = room.getTerrain();
  if (terrain.get(pos.x, pos.y) === TERRAIN_MASK_WALL) return false;

  // Check structures
  const structures = room.lookForAt(LOOK_STRUCTURES, pos);
  for (const struct of structures) {
    if (
      struct.structureType !== STRUCTURE_ROAD &&
      struct.structureType !== STRUCTURE_CONTAINER &&
      (struct.structureType !== STRUCTURE_RAMPART || !(struct as OwnedStructure).my)
    ) {
      return false;
    }
  }

  return true;
}

/**
 * Find open position near target
 */
export function findOpenPosition(pos: RoomPosition, range = 1): RoomPosition | null {
  const room = Game.rooms[pos.roomName];
  if (!room) return null;

  for (let r = 1; r <= range; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.abs(dx) < r && Math.abs(dy) < r) continue;

        const x = pos.x + dx;
        const y = pos.y + dy;

        if (x < 1 || x > 48 || y < 1 || y > 48) continue;

        const testPos = new RoomPosition(x, y, pos.roomName);
        if (isWalkable(testPos)) {
          const creeps = room.lookForAt(LOOK_CREEPS, testPos);
          if (creeps.length === 0) {
            return testPos;
          }
        }
      }
    }
  }

  return null;
}
