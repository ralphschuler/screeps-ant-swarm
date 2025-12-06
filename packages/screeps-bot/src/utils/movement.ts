/**
 * Movement Utilities
 *
 * Custom minimal traffic management and movement module for the ant swarm.
 * Provides:
 * - Coordinated movement to prevent creep collisions
 * - Path caching for CPU efficiency
 * - Stuck detection and recovery
 * - Priority-based movement resolution
 * - Move request integration for proactive blocking resolution
 *
 * Design Principles (from ROADMAP.md):
 * - Pathfinding is one of the most expensive CPU operations
 * - Use reusePath, moveByPath, cached paths, and CostMatrices
 * - Stuck detection with repath or side-step recovery
 * - Yield rules for priority-based movement
 */

import {
  findSideStepPosition,
  requestMoveToPosition,
  shouldYieldTo
} from "./trafficManager";

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Type guard to check if an entity is a Creep (not a PowerCreep).
 * Creeps have a memory property while PowerCreeps do not have standard memory.
 * Additionally, Creeps have spawning and ticksToLive properties with specific types.
 */
function isCreep(entity: Creep | PowerCreep): entity is Creep {
  // Creeps have a memory property that is directly writable
  // PowerCreeps have memory too, but we can distinguish by other properties
  // Creeps always have 'body' property which is an array of body parts
  return "body" in entity && Array.isArray(entity.body);
}

// =============================================================================
// Types & Interfaces
// =============================================================================

/**
 * Movement target specification
 */
export interface MoveTarget {
  pos: RoomPosition;
  range: number;
}

/**
 * Movement options for the moveTo function
 */
export interface MoveOpts {
  /** Number of ticks to reuse a cached path before repathing. Default 20. */
  reusePath?: number;
  /** Number of ticks stuck before repathing. Default 3. */
  repathIfStuck?: number;
  /** Visualize the path with provided styles */
  visualizePathStyle?: PolyStyle;
  /** Movement priority (higher values win conflicts). Default 1. */
  priority?: number;
  /** Enable flee mode - move away from targets instead of toward them */
  flee?: boolean;
  /** Cost for walking on roads. Default 1. */
  roadCost?: number;
  /** Cost for walking on plains. Default 2. */
  plainCost?: number;
  /** Cost for walking on swamps. Default 10. */
  swampCost?: number;
  /** Avoid creeps when pathing. Default true. */
  avoidCreeps?: boolean;
  /** Maximum pathfinding operations. Default 2000. */
  maxOps?: number;
  /** Range to stay away from targets when fleeing. Default 10. */
  fleeRange?: number;
}

/**
 * Serialized position data
 */
interface SerializedPos {
  x: number;
  y: number;
  r: string; // roomName
}

/**
 * Cached path data stored in creep memory
 */
interface CachedPath {
  /** Serialized path as JSON array of positions */
  path: SerializedPos[];
  /** Game tick when path was created */
  tick: number;
  /** Target position key for cache invalidation */
  targetKey: string;
}

/**
 * Movement intent for a creep
 */
interface MoveIntent {
  creep: Creep | PowerCreep;
  priority: number;
  targetPos: RoomPosition;
}

// =============================================================================
// Module State
// =============================================================================

/** Current tick's movement intents, keyed by room name */
let moveIntents: Map<string, MoveIntent[]> = new Map();

/** Last tick when preTick was called */
let lastPreTickTime = -1;

// =============================================================================
// Memory Keys (using underscores to minimize memory footprint)
// =============================================================================

const MEMORY_PATH_KEY = "_tp";
const MEMORY_STUCK_KEY = "_ts";
const MEMORY_LAST_POS_KEY = "_tl";

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Create a position key for caching
 */
function posKey(pos: RoomPosition): string {
  return `${pos.roomName}:${pos.x},${pos.y}`;
}

/**
 * Serialize a path to JSON array (handles cross-room paths)
 */
function serializePath(path: RoomPosition[]): SerializedPos[] {
  return path.map(pos => ({ x: pos.x, y: pos.y, r: pos.roomName }));
}

/**
 * Deserialize a path from JSON array to RoomPositions
 */
function deserializePath(serialized: SerializedPos[]): RoomPosition[] {
  return serialized.map(pos => new RoomPosition(pos.x, pos.y, pos.r));
}

/**
 * Check if a position is on a room exit (edge of the room).
 * Room exits are positions at x=0, x=49, y=0, or y=49.
 */
function isOnRoomExit(pos: RoomPosition): boolean {
  return pos.x === 0 || pos.x === 49 || pos.y === 0 || pos.y === 49;
}

/**
 * Find a walkable position adjacent to the creep that is NOT on a room exit.
 * Returns null if no valid position is found.
 */
function findPositionOffExit(creep: Creep | PowerCreep): RoomPosition | null {
  const pos = creep.pos;
  const room = Game.rooms[pos.roomName];
  if (!room) return null;

  const terrain = room.getTerrain();

  // Get all 8 adjacent positions, prioritizing positions further from the edge
  const adjacentOffsets = [
    { dx: 0, dy: -1 }, // TOP
    { dx: 1, dy: -1 }, // TOP_RIGHT
    { dx: 1, dy: 0 }, // RIGHT
    { dx: 1, dy: 1 }, // BOTTOM_RIGHT
    { dx: 0, dy: 1 }, // BOTTOM
    { dx: -1, dy: 1 }, // BOTTOM_LEFT
    { dx: -1, dy: 0 }, // LEFT
    { dx: -1, dy: -1 } // TOP_LEFT
  ];

  // Sort to prefer positions that are more "inward" (further from all edges)
  const candidates: { pos: RoomPosition; edgeDistance: number }[] = [];

  for (const offset of adjacentOffsets) {
    const newX = pos.x + offset.dx;
    const newY = pos.y + offset.dy;

    // Skip positions outside the room
    if (newX < 0 || newX > 49 || newY < 0 || newY > 49) continue;

    // Skip positions that are still on an exit
    if (newX === 0 || newX === 49 || newY === 0 || newY === 49) continue;

    // Skip walls
    if (terrain.get(newX, newY) === TERRAIN_MASK_WALL) continue;

    // Calculate distance from nearest edge (higher is better, more "inside" the room)
    const edgeDistance = Math.min(newX, 49 - newX, newY, 49 - newY);

    candidates.push({
      pos: new RoomPosition(newX, newY, pos.roomName),
      edgeDistance
    });
  }

  // Sort by edge distance descending (prefer positions further from edges)
  candidates.sort((a, b) => b.edgeDistance - a.edgeDistance);

  // Return the best candidate, or null if none found
  return candidates.length > 0 ? candidates[0].pos : null;
}

/**
 * Get direction from one position to an adjacent position
 */
function getDirection(from: RoomPosition, to: RoomPosition): DirectionConstant {
  const dx = to.x - from.x;
  const dy = to.y - from.y;

  if (dx === 0 && dy === -1) return TOP;
  if (dx === 1 && dy === -1) return TOP_RIGHT;
  if (dx === 1 && dy === 0) return RIGHT;
  if (dx === 1 && dy === 1) return BOTTOM_RIGHT;
  if (dx === 0 && dy === 1) return BOTTOM;
  if (dx === -1 && dy === 1) return BOTTOM_LEFT;
  if (dx === -1 && dy === 0) return LEFT;
  if (dx === -1 && dy === -1) return TOP_LEFT;

  // Default to RIGHT if positions aren't adjacent
  return RIGHT;
}

/**
 * Generate a cost matrix for a room
 */
function generateCostMatrix(roomName: string, avoidCreeps: boolean, roadCost = 1): CostMatrix {
  const costs = new PathFinder.CostMatrix();
  const room = Game.rooms[roomName];

  if (!room) return costs;

  // Add structure costs
  const structures = room.find(FIND_STRUCTURES);
  for (const structure of structures) {
    if (structure.structureType === STRUCTURE_ROAD) {
      costs.set(structure.pos.x, structure.pos.y, roadCost);
    } else if (
      structure.structureType !== STRUCTURE_CONTAINER &&
      !(structure.structureType === STRUCTURE_RAMPART && "my" in structure && structure.my)
    ) {
      costs.set(structure.pos.x, structure.pos.y, 255);
    }
  }

  // Add construction site costs
  const sites = room.find(FIND_MY_CONSTRUCTION_SITES);
  for (const site of sites) {
    if (site.structureType !== STRUCTURE_ROAD && site.structureType !== STRUCTURE_CONTAINER) {
      costs.set(site.pos.x, site.pos.y, 255);
    }
  }

  // Add creep costs if avoiding creeps
  if (avoidCreeps) {
    const creeps = room.find(FIND_CREEPS);
    for (const creep of creeps) {
      costs.set(creep.pos.x, creep.pos.y, 255);
    }
    const powerCreeps = room.find(FIND_POWER_CREEPS);
    for (const pc of powerCreeps) {
      costs.set(pc.pos.x, pc.pos.y, 255);
    }
  }

  return costs;
}

// =============================================================================
// Path Finding
// =============================================================================

/**
 * Find a path to the target using PathFinder
 */
function findPath(origin: RoomPosition, target: RoomPosition | MoveTarget, opts: MoveOpts): PathFinderPath {
  const targetPos = "pos" in target ? target.pos : target;
  const range = "range" in target ? target.range : 1;
  const roadCost = opts.roadCost ?? 1;

  const goals = [{ pos: targetPos, range }];

  const result = PathFinder.search(origin, goals, {
    plainCost: opts.plainCost ?? 2,
    swampCost: opts.swampCost ?? 10,
    maxOps: opts.maxOps ?? 2000,
    flee: opts.flee ?? false,
    roomCallback: (roomName: string) => {
      return generateCostMatrix(roomName, opts.avoidCreeps ?? true, roadCost);
    }
  });

  return result;
}

/**
 * Find a path to flee from multiple targets
 */
function findFleePath(origin: RoomPosition, threats: RoomPosition[], range: number, opts: MoveOpts): PathFinderPath {
  const goals = threats.map(pos => ({ pos, range }));
  const roadCost = opts.roadCost ?? 1;

  return PathFinder.search(origin, goals, {
    plainCost: opts.plainCost ?? 2,
    swampCost: opts.swampCost ?? 10,
    maxOps: opts.maxOps ?? 2000,
    flee: true,
    roomCallback: (roomName: string) => {
      return generateCostMatrix(roomName, opts.avoidCreeps ?? true, roadCost);
    }
  });
}

// =============================================================================
// Internal Core API
// =============================================================================

/**
 * Internal preTick - Initialize movement system at the start of each tick.
 */
function preTick(): void {
  moveIntents = new Map();
  lastPreTickTime = Game.time;
}

/**
 * Internal reconcileTraffic - Resolve traffic at the end of each tick.
 * Now integrates with the move request system to ask blocking creeps to move.
 */
function reconcileTraffic(): void {
  for (const [roomName, intents] of moveIntents) {
    if (intents.length === 0) continue;

    // Sort by priority (highest first)
    intents.sort((a, b) => b.priority - a.priority);

    // Track occupied positions
    const occupied = new Set<string>();

    // Build a Set of creep names that have movement intents for O(1) lookup
    const creepsWithIntents = new Set(intents.map(i => i.creep.name));

    // First pass: mark all current creep positions not in our intents list
    const room = Game.rooms[roomName];
    if (room) {
      const creeps = room.find(FIND_CREEPS);
      for (const creep of creeps) {
        if (!creepsWithIntents.has(creep.name)) {
          occupied.add(posKey(creep.pos));
        }
      }
    }

    // Second pass: resolve movements in priority order with blocking resolution
    for (const intent of intents) {
      const targetKey = posKey(intent.targetPos);

      // Check if target is occupied
      if (occupied.has(targetKey)) {
        // Try to resolve the blockage by asking the blocking creep to move
        if (room) {
          const blockingCreeps = room.lookForAt(LOOK_CREEPS, intent.targetPos.x, intent.targetPos.y);
          const blockingCreep = blockingCreeps.find(
            c => c.my && c.name !== intent.creep.name
          );

          if (blockingCreep) {
            // Only ask to move if the blocking creep should yield (based on priority)
            // Use type guard to ensure intent.creep is a Creep (not PowerCreep)
            if (isCreep(intent.creep)) {
              if (shouldYieldTo(blockingCreep, intent.creep)) {
                // Try to find a side-step position for the blocking creep
                const sideStep = findSideStepPosition(blockingCreep);
                if (sideStep) {
                  const moveResult = blockingCreep.move(blockingCreep.pos.getDirectionTo(sideStep));
                  if (moveResult === OK) {
                    // Blocking creep will move, so we can now occupy this position
                    occupied.delete(targetKey);
                    // Also mark the side-step position as occupied
                    occupied.add(posKey(sideStep));
                  }
                }
              }
            }
          }
        }

        // Re-check if still occupied after attempting to resolve
        if (occupied.has(targetKey)) {
          // Register a move request for next tick so the blocking creep knows
          // Only do this for Creeps, not PowerCreeps - use type guard
          if (isCreep(intent.creep)) {
            requestMoveToPosition(intent.creep, intent.targetPos);
          }
          continue;
        }
      }

      // Execute the move
      const direction = getDirection(intent.creep.pos, intent.targetPos);
      const result = intent.creep.move(direction);

      if (result === OK) {
        occupied.add(targetKey);
      }
    }
  }
}

/**
 * Internal moveTo - Move a creep toward a target position.
 */
function internalMoveTo(
  creep: Creep | PowerCreep,
  targets: RoomPosition | _HasRoomPosition | MoveTarget | RoomPosition[] | MoveTarget[],
  opts?: MoveOpts
): CreepMoveReturnCode | -2 | -5 | -7 | -10 {
  // Handle spawning creeps
  if ("spawning" in creep && creep.spawning) {
    return ERR_BUSY;
  }

  // Handle fatigue (only applies to Creeps, not PowerCreeps)
  if ("fatigue" in creep && creep.fatigue > 0) {
    return ERR_TIRED;
  }

  // Normalize target to RoomPosition
  let targetPos: RoomPosition;
  let range = 1;

  if (Array.isArray(targets)) {
    const firstTarget = targets[0];
    if (!firstTarget) {
      return ERR_INVALID_TARGET;
    }
    // Check type at runtime
    if (firstTarget instanceof RoomPosition) {
      targetPos = firstTarget;
    } else if (
      typeof firstTarget === "object" &&
      firstTarget !== null &&
      "pos" in firstTarget &&
      firstTarget.pos instanceof RoomPosition
    ) {
      targetPos = firstTarget.pos;
      if ("range" in firstTarget && typeof firstTarget.range === "number") {
        range = firstTarget.range;
      }
    } else {
      return ERR_INVALID_TARGET;
    }
  } else if (targets instanceof RoomPosition) {
    targetPos = targets;
  } else if (
    typeof targets === "object" &&
    targets !== null &&
    "pos" in targets &&
    targets.pos instanceof RoomPosition
  ) {
    targetPos = targets.pos;
    if ("range" in targets && typeof targets.range === "number") {
      range = targets.range;
    }
  } else {
    return ERR_INVALID_TARGET;
  }

  const options = opts ?? {};
  const priority = options.priority ?? 1;

  // Check if already at target
  if (creep.pos.inRangeTo(targetPos, range)) {
    return OK;
  }

  // CRITICAL: Handle creeps on room exits that need to move to a different room.
  // When a creep is on an exit tile and their target is in a DIFFERENT room,
  // they must FIRST move off the exit tile toward the room center before continuing.
  // This prevents cycling behavior where PathFinder would route them back through the exit.
  const onRoomExit = isOnRoomExit(creep.pos);
  const targetInDifferentRoom = targetPos.roomName !== creep.pos.roomName;

  if (onRoomExit && targetInDifferentRoom) {
    // Find a walkable position off the exit that's more toward the room center
    // Note: findPositionOffExit only returns adjacent positions (within 1 tile),
    // so getDirection will always receive a valid adjacent position.
    const exitOffPosition = findPositionOffExit(creep);
    if (exitOffPosition) {
      // Move to the off-exit position first, then next tick will continue pathing
      const direction = getDirection(creep.pos, exitOffPosition);
      const currentRoomName = creep.pos.roomName;

      // Register movement intent for traffic management
      if (lastPreTickTime === Game.time) {
        if (!moveIntents.has(currentRoomName)) {
          moveIntents.set(currentRoomName, []);
        }
        const intents = moveIntents.get(currentRoomName);
        if (intents) {
          intents.push({
            creep,
            priority: priority + 1, // Slightly higher priority to clear exit
            targetPos: exitOffPosition
          });
        }
        return OK;
      } else {
        return creep.move(direction);
      }
    }
    // If no off-exit position found, continue with normal pathing
  }

  // Get cached path or generate new one
  const memory = creep.memory as { [key: string]: unknown };
  const cachedPath = memory[MEMORY_PATH_KEY] as CachedPath | undefined;
  const stuckCount = (memory[MEMORY_STUCK_KEY] as number) ?? 0;
  const lastPos = memory[MEMORY_LAST_POS_KEY] as string | undefined;
  const currentPosKey = posKey(creep.pos);
  const targetKey = posKey(targetPos);

  // Check if stuck
  const isStuck = lastPos === currentPosKey;
  const newStuckCount = isStuck ? stuckCount + 1 : 0;
  memory[MEMORY_STUCK_KEY] = newStuckCount;
  memory[MEMORY_LAST_POS_KEY] = currentPosKey;

  // Check if creep needs to repath for cross-room movement
  // Note: The critical exit-handling is done above; this additional check ensures
  // stale paths from different rooms are invalidated

  // Check if cached path is from a different room (creep changed rooms)
  const cachedPathFirstPos = cachedPath?.path[0];
  const cachedPathInDifferentRoom =
    cachedPath && cachedPath.path.length > 0 && cachedPathFirstPos && cachedPathFirstPos.r !== creep.pos.roomName;

  // Determine if we need to repath
  const repathIfStuck = options.repathIfStuck ?? 3;
  const reusePath = options.reusePath ?? 20;
  const needRepath =
    !cachedPath ||
    cachedPath.targetKey !== targetKey ||
    Game.time - cachedPath.tick > reusePath ||
    newStuckCount >= repathIfStuck ||
    cachedPathInDifferentRoom; // Force repath when path is from a different room

  let path: RoomPosition[];

  /**
   * Helper to generate a new path and cache it.
   * Returns the path or null if no path found.
   */
  function generateAndCachePath(): RoomPosition[] | null {
    const pathResult = findPath(creep.pos, { pos: targetPos, range }, options);

    if (pathResult.incomplete || pathResult.path.length === 0) {
      delete memory[MEMORY_PATH_KEY];
      return null;
    }

    // Cache the path (store actual positions for cross-room compatibility)
    memory[MEMORY_PATH_KEY] = {
      path: serializePath(pathResult.path),
      tick: Game.time,
      targetKey
    } as CachedPath;

    memory[MEMORY_STUCK_KEY] = 0;
    return pathResult.path;
  }

  if (needRepath) {
    const newPath = generateAndCachePath();
    if (!newPath) {
      return ERR_NO_PATH;
    }
    path = newPath;
  } else {
    path = deserializePath(cachedPath.path);
  }

  // Find next position on path
  let currentIdx = path.findIndex(
    p => p.x === creep.pos.x && p.y === creep.pos.y && p.roomName === creep.pos.roomName
  );

  // If current position not found in path and we're on a room exit,
  // this could mean the path is stale or doesn't include the creep's current position.
  // Force a repath to get a valid path from current position.
  if (currentIdx === -1 && onRoomExit) {
    const newPath = generateAndCachePath();
    if (!newPath) {
      return ERR_NO_PATH;
    }
    path = newPath;
    currentIdx = -1; // Will use index 0 below
  }

  const nextIdx = currentIdx === -1 ? 0 : currentIdx + 1;

  if (nextIdx >= path.length) {
    delete memory[MEMORY_PATH_KEY];
    return OK;
  }

  const nextPos = path[nextIdx];

  // Get room name from creep position (works for both Creep and PowerCreep)
  const roomName = creep.pos.roomName;

  // Register movement intent for traffic management
  if (lastPreTickTime === Game.time) {
    if (!moveIntents.has(roomName)) {
      moveIntents.set(roomName, []);
    }
    const intents = moveIntents.get(roomName);
    if (intents) {
      intents.push({
        creep,
        priority,
        targetPos: nextPos
      });
    }

    // Visualize path if requested
    if (options.visualizePathStyle) {
      const visual = new RoomVisual(roomName);
      const visualPath = path.slice(nextIdx);
      if (visualPath.length > 0) {
        visual.poly(
          visualPath.map(p => [p.x, p.y] as [number, number]),
          { ...options.visualizePathStyle, opacity: 0.5 }
        );
      }
    }

    return OK;
  } else {
    // Traffic management not active, move directly
    const direction = getDirection(creep.pos, nextPos);

    // Visualize path if requested
    if (options.visualizePathStyle) {
      const visual = new RoomVisual(roomName);
      const visualPath = path.slice(nextIdx);
      if (visualPath.length > 0) {
        visual.poly(
          visualPath.map(p => [p.x, p.y] as [number, number]),
          { ...options.visualizePathStyle, opacity: 0.5 }
        );
      }
    }

    return creep.move(direction);
  }
}

/**
 * Internal flee - Move a creep away from specified positions.
 */
function internalFlee(
  creep: Creep | PowerCreep,
  threats: RoomPosition[],
  range = 10,
  opts?: MoveOpts
): CreepMoveReturnCode | -2 | -5 | -10 {
  if (threats.length === 0) {
    return OK;
  }

  // Handle spawning creeps
  if ("spawning" in creep && creep.spawning) {
    return ERR_BUSY;
  }

  // Handle fatigue (only applies to Creeps, not PowerCreeps)
  if ("fatigue" in creep && creep.fatigue > 0) {
    return ERR_TIRED;
  }

  const options = { ...opts, flee: true };
  const priority = options.priority ?? 1;

  const pathResult = findFleePath(creep.pos, threats, range, options);

  if (pathResult.incomplete || pathResult.path.length === 0) {
    return ERR_NO_PATH;
  }

  const nextPos = pathResult.path[0];

  // Get room name from creep position (works for both Creep and PowerCreep)
  const roomName = creep.pos.roomName;

  // Register movement intent
  if (lastPreTickTime === Game.time) {
    if (!moveIntents.has(roomName)) {
      moveIntents.set(roomName, []);
    }
    const intents = moveIntents.get(roomName);
    if (intents) {
      intents.push({
        creep,
        priority,
        targetPos: nextPos
      });
    }

    return OK;
  } else {
    const direction = getDirection(creep.pos, nextPos);
    return creep.move(direction);
  }
}

// =============================================================================
// Public API (Exported Functions)
// =============================================================================

/**
 * Initialize movement system at the start of each tick.
 * Must be called at the beginning of the main loop.
 */
export function initMovement(): void {
  preTick();
}

/**
 * Reconcile traffic at the end of each tick.
 * Must be called at the end of the main loop after all creep movement.
 */
export function finalizeMovement(): void {
  reconcileTraffic();
}

/**
 * Move a creep or power creep to a target position or object.
 *
 * @param creep - The creep or power creep to move
 * @param target - Target position or object with pos property
 * @param opts - Optional movement options including visualizePathStyle
 * @returns The result of the movement action
 */
export function moveCreep(
  creep: Creep | PowerCreep,
  target: RoomPosition | RoomObject,
  opts?: MoveOpts
): CreepMoveReturnCode | -2 | -5 | -7 | -10 {
  const targetPos = target instanceof RoomPosition ? target : target.pos;
  return internalMoveTo(creep, targetPos, opts);
}

/**
 * Move a creep to a specific room by finding and moving to an exit.
 * Uses the room center (25, 25) with a range of 20 to navigate to any accessible
 * position within the target room - this is the standard approach for cross-room navigation.
 *
 * @param creep - The creep or power creep to move
 * @param roomName - The name of the destination room
 * @param opts - Optional movement options
 * @returns The result of the movement action
 */
export function moveToRoom(
  creep: Creep | PowerCreep,
  roomName: string,
  opts?: MoveOpts
): CreepMoveReturnCode | -2 | -5 | -7 | -10 {
  const targetPos = new RoomPosition(25, 25, roomName);
  return internalMoveTo(creep, { pos: targetPos, range: 20 }, opts);
}

/**
 * Move a creep away from a set of positions (flee behavior).
 * This function always enables flee mode in the movement options.
 *
 * @param creep - The creep to move
 * @param threats - Array of positions to flee from
 * @param range - How far to stay away from threats (default 10)
 * @param opts - Optional movement options (flee is always set to true)
 * @returns The result of the movement action
 */
export function fleeFrom(
  creep: Creep | PowerCreep,
  threats: RoomPosition[],
  range = 10,
  opts?: Omit<MoveOpts, "flee">
): CreepMoveReturnCode | -2 | -5 | -7 | -10 {
  return internalFlee(creep, threats, range, opts);
}

/**
 * Check if a creep is on a room exit tile (edge of the room).
 *
 * @param creep - The creep or power creep to check
 * @returns true if the creep is on a room exit tile
 */
export function isCreepOnRoomExit(creep: Creep | PowerCreep): boolean {
  return isOnRoomExit(creep.pos);
}

/**
 * Move a creep off a room exit tile to prevent endless cycling between rooms.
 * This should be called when a creep is about to idle or has no immediate task,
 * to ensure they don't get stuck on exit tiles causing oscillation between rooms.
 *
 * @param creep - The creep or power creep to move
 * @param opts - Optional movement options
 * @returns true if the creep was on an exit and a move was issued, false otherwise
 */
export function moveOffRoomExit(creep: Creep | PowerCreep, opts?: MoveOpts): boolean {
  // Check if creep is on a room exit
  if (!isOnRoomExit(creep.pos)) {
    return false;
  }

  // Handle spawning creeps
  if ("spawning" in creep && creep.spawning) {
    return false;
  }

  // Handle fatigue (only applies to Creeps, not PowerCreeps)
  if ("fatigue" in creep && creep.fatigue > 0) {
    return false;
  }

  // Find a position off the exit
  const targetPos = findPositionOffExit(creep);
  if (!targetPos) {
    return false;
  }

  // Move to the target position
  const priority = opts?.priority ?? 2; // Higher priority than normal movement
  const roomName = creep.pos.roomName;

  // Register movement intent for traffic management
  if (lastPreTickTime === Game.time) {
    if (!moveIntents.has(roomName)) {
      moveIntents.set(roomName, []);
    }
    const intents = moveIntents.get(roomName);
    if (intents) {
      intents.push({
        creep,
        priority,
        targetPos
      });
    }
    return true;
  } else {
    // Traffic management not active, move directly
    const direction = getDirection(creep.pos, targetPos);
    creep.move(direction);
    return true;
  }
}

/**
 * Find a walkable position away from spawns.
 * Returns null if no valid position is found or creep is not near a spawn.
 */
function findPositionAwayFromSpawn(creep: Creep | PowerCreep, range: number): RoomPosition | null {
  const room = Game.rooms[creep.pos.roomName];
  if (!room) return null;

  // Find nearby spawns
  const spawns = room.find(FIND_MY_SPAWNS);
  if (spawns.length === 0) return null;

  // Check if creep is within range of any spawn
  let nearbySpawn: StructureSpawn | null = null;
  for (const spawn of spawns) {
    if (creep.pos.inRangeTo(spawn.pos, range)) {
      nearbySpawn = spawn;
      break;
    }
  }

  if (!nearbySpawn) return null;

  const terrain = room.getTerrain();

  // Get all 8 adjacent positions
  const adjacentOffsets = [
    { dx: 0, dy: -1 }, // TOP
    { dx: 1, dy: -1 }, // TOP_RIGHT
    { dx: 1, dy: 0 }, // RIGHT
    { dx: 1, dy: 1 }, // BOTTOM_RIGHT
    { dx: 0, dy: 1 }, // BOTTOM
    { dx: -1, dy: 1 }, // BOTTOM_LEFT
    { dx: -1, dy: 0 }, // LEFT
    { dx: -1, dy: -1 } // TOP_LEFT
  ];

  // Sort to prefer positions further from spawn
  const candidates: { pos: RoomPosition; spawnDistance: number }[] = [];

  for (const offset of adjacentOffsets) {
    const newX = creep.pos.x + offset.dx;
    const newY = creep.pos.y + offset.dy;

    // Skip positions outside the room or on exits
    if (newX <= 0 || newX >= 49 || newY <= 0 || newY >= 49) continue;

    // Skip walls
    if (terrain.get(newX, newY) === TERRAIN_MASK_WALL) continue;

    const newPos = new RoomPosition(newX, newY, creep.pos.roomName);

    // Check for blocking structures
    const structures = room.lookForAt(LOOK_STRUCTURES, newX, newY);
    const blocked = structures.some(
      s =>
        s.structureType !== STRUCTURE_ROAD &&
        s.structureType !== STRUCTURE_CONTAINER &&
        !(s.structureType === STRUCTURE_RAMPART && (s as StructureRampart).my)
    );
    if (blocked) continue;

    // Check for other creeps
    const creeps = room.lookForAt(LOOK_CREEPS, newX, newY);
    if (creeps.length > 0) continue;

    // Calculate distance from spawn (higher is better, further from spawn)
    const spawnDistance = newPos.getRangeTo(nearbySpawn.pos);

    candidates.push({
      pos: newPos,
      spawnDistance
    });
  }

  // Sort by spawn distance descending (prefer positions further from spawn)
  candidates.sort((a, b) => b.spawnDistance - a.spawnDistance);

  // Return the best candidate, or null if none found
  return candidates.length > 0 ? candidates[0].pos : null;
}

/**
 * Move a creep away from spawn if it's blocking or near a spawn.
 * This should be called when a creep is idle to prevent spawn blockades.
 *
 * @param creep - The creep or power creep to move
 * @param range - Range from spawn to consider as "blocking" (default 1)
 * @param opts - Optional movement options (only priority is used)
 * @returns true if the creep was near a spawn and a move was issued, false otherwise
 */
export function moveAwayFromSpawn(creep: Creep | PowerCreep, range = 1, opts?: MoveOpts): boolean {
  // Handle spawning creeps
  if ("spawning" in creep && creep.spawning) {
    return false;
  }

  // Handle fatigue (only applies to Creeps, not PowerCreeps)
  if ("fatigue" in creep && creep.fatigue > 0) {
    return false;
  }

  // Find a position away from spawn
  const targetPos = findPositionAwayFromSpawn(creep, range);
  if (!targetPos) {
    return false;
  }

  // Move to the target position
  // Use priority 2 to match moveOffRoomExit - clearing blockades is important
  const priority = opts?.priority ?? 2;
  const roomName = creep.pos.roomName;

  // Register movement intent for traffic management
  if (lastPreTickTime === Game.time) {
    if (!moveIntents.has(roomName)) {
      moveIntents.set(roomName, []);
    }
    const intents = moveIntents.get(roomName);
    if (intents) {
      intents.push({
        creep,
        priority,
        targetPos
      });
    }
    return true;
  } else {
    // Traffic management not active, move directly
    const direction = getDirection(creep.pos, targetPos);
    creep.move(direction);
    return true;
  }
}

/**
 * Find a walkable position away from a source position.
 * Returns null if no valid position is found.
 */
function findPositionAwayFromSource(
  creep: Creep | PowerCreep,
  sourcePos: RoomPosition
): RoomPosition | null {
  const room = Game.rooms[creep.pos.roomName];
  if (!room) return null;

  const terrain = room.getTerrain();

  // Get all 8 adjacent positions
  const adjacentOffsets = [
    { dx: 0, dy: -1 }, // TOP
    { dx: 1, dy: -1 }, // TOP_RIGHT
    { dx: 1, dy: 0 }, // RIGHT
    { dx: 1, dy: 1 }, // BOTTOM_RIGHT
    { dx: 0, dy: 1 }, // BOTTOM
    { dx: -1, dy: 1 }, // BOTTOM_LEFT
    { dx: -1, dy: 0 }, // LEFT
    { dx: -1, dy: -1 } // TOP_LEFT
  ];

  // Sort to prefer positions further from source
  const candidates: { pos: RoomPosition; sourceDistance: number }[] = [];

  for (const offset of adjacentOffsets) {
    const newX = creep.pos.x + offset.dx;
    const newY = creep.pos.y + offset.dy;

    // Skip positions outside the room or on exits
    if (newX <= 0 || newX >= 49 || newY <= 0 || newY >= 49) continue;

    // Skip walls
    if (terrain.get(newX, newY) === TERRAIN_MASK_WALL) continue;

    const newPos = new RoomPosition(newX, newY, creep.pos.roomName);

    // Check for blocking structures
    const structures = room.lookForAt(LOOK_STRUCTURES, newX, newY);
    const blocked = structures.some(
      s =>
        s.structureType !== STRUCTURE_ROAD &&
        s.structureType !== STRUCTURE_CONTAINER &&
        !(s.structureType === STRUCTURE_RAMPART && (s as StructureRampart).my)
    );
    if (blocked) continue;

    // Check for other creeps
    const creeps = room.lookForAt(LOOK_CREEPS, newX, newY);
    if (creeps.length > 0) continue;

    // Calculate distance from source using Chebyshev distance (higher is better, further from source)
    // This is equivalent to getRangeTo() but faster since we avoid the function call overhead
    const sourceDistance = Math.max(Math.abs(newX - sourcePos.x), Math.abs(newY - sourcePos.y));

    candidates.push({
      pos: newPos,
      sourceDistance
    });
  }

  // Sort by source distance descending (prefer positions further from source)
  candidates.sort((a, b) => b.sourceDistance - a.sourceDistance);

  // Return the best candidate, or null if none found
  return candidates.length > 0 ? candidates[0].pos : null;
}

/**
 * Push a creep away from a source position.
 * This function forces the target creep to move to an adjacent position
 * that is further away from the source position.
 *
 * @param creep - The creep to push
 * @param sourcePos - The position to push away from
 * @param opts - Optional movement options (only priority is used)
 * @returns true if the creep was pushed, false if push failed
 */
export function pushCreep(creep: Creep | PowerCreep, sourcePos: RoomPosition, opts?: MoveOpts): boolean {
  // Handle spawning creeps
  if ("spawning" in creep && creep.spawning) {
    return false;
  }

  // Handle fatigue (only applies to Creeps, not PowerCreeps)
  if ("fatigue" in creep && creep.fatigue > 0) {
    return false;
  }

  // Find a position away from source
  const targetPos = findPositionAwayFromSource(creep, sourcePos);
  if (!targetPos) {
    return false;
  }

  // Move to the target position
  // Use priority 3 for push operations - higher than normal movement
  const priority = opts?.priority ?? 3;
  const roomName = creep.pos.roomName;

  // Register movement intent for traffic management
  if (lastPreTickTime === Game.time) {
    if (!moveIntents.has(roomName)) {
      moveIntents.set(roomName, []);
    }
    const intents = moveIntents.get(roomName);
    if (intents) {
      intents.push({
        creep,
        priority,
        targetPos
      });
    }
    return true;
  } else {
    // Traffic management not active, move directly
    const direction = getDirection(creep.pos, targetPos);
    creep.move(direction);
    return true;
  }
}

/**
 * Push all creeps away from a position within a specified range.
 * This is useful for clearing an area around a source, spawn, or other important location.
 *
 * @param sourcePos - The center position to push creeps away from
 * @param range - The range within which to push creeps (default 1)
 * @param opts - Optional movement options
 * @returns The number of creeps that were successfully pushed
 */
export function pushCreepsAway(sourcePos: RoomPosition, range = 1, opts?: MoveOpts): number {
  const room = Game.rooms[sourcePos.roomName];
  if (!room) return 0;

  // Find all creeps within range
  const creepsInRange = room.find(FIND_MY_CREEPS).filter(c => c.pos.inRangeTo(sourcePos, range));

  let pushedCount = 0;

  for (const creep of creepsInRange) {
    // Skip creeps that are exactly at the source position
    // (they might be intentionally there, like a harvester at a source)
    if (creep.pos.isEqualTo(sourcePos)) {
      continue;
    }

    if (pushCreep(creep, sourcePos, opts)) {
      pushedCount++;
    }
  }

  return pushedCount;
}

/**
 * Push a creep in a specific direction.
 * This function forces the target creep to move in the specified direction.
 *
 * @param creep - The creep to push
 * @param direction - The direction to push the creep
 * @param opts - Optional movement options (only priority is used)
 * @returns true if the creep was pushed, false if push failed
 */
export function pushCreepInDirection(
  creep: Creep | PowerCreep,
  direction: DirectionConstant,
  opts?: MoveOpts
): boolean {
  // Handle spawning creeps
  if ("spawning" in creep && creep.spawning) {
    return false;
  }

  // Handle fatigue (only applies to Creeps, not PowerCreeps)
  if ("fatigue" in creep && creep.fatigue > 0) {
    return false;
  }

  // Calculate the target position based on direction
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
  if (!offset) return false;

  const newX = creep.pos.x + offset.dx;
  const newY = creep.pos.y + offset.dy;

  // Check bounds
  if (newX < 0 || newX > 49 || newY < 0 || newY > 49) return false;

  const room = Game.rooms[creep.pos.roomName];
  if (!room) return false;

  // Check terrain
  const terrain = room.getTerrain();
  if (terrain.get(newX, newY) === TERRAIN_MASK_WALL) return false;

  // Check for blocking structures
  const structures = room.lookForAt(LOOK_STRUCTURES, newX, newY);
  const blocked = structures.some(
    s =>
      s.structureType !== STRUCTURE_ROAD &&
      s.structureType !== STRUCTURE_CONTAINER &&
      !(s.structureType === STRUCTURE_RAMPART && (s as StructureRampart).my)
  );
  if (blocked) return false;

  // Check for other creeps
  const creeps = room.lookForAt(LOOK_CREEPS, newX, newY);
  if (creeps.length > 0) return false;

  const targetPos = new RoomPosition(newX, newY, creep.pos.roomName);

  // Move to the target position
  // Use priority 3 for push operations - higher than normal movement
  const priority = opts?.priority ?? 3;
  const roomName = creep.pos.roomName;

  // Register movement intent for traffic management
  if (lastPreTickTime === Game.time) {
    if (!moveIntents.has(roomName)) {
      moveIntents.set(roomName, []);
    }
    const intents = moveIntents.get(roomName);
    if (intents) {
      intents.push({
        creep,
        priority,
        targetPos
      });
    }
    return true;
  } else {
    // Traffic management not active, move directly
    creep.move(direction);
    return true;
  }
}
