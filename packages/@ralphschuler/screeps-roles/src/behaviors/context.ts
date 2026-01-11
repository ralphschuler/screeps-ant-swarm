/**
 * Creep Context Factory
 *
 * Creates the context object that behaviors use for decision making.
 * All room queries are cached here to avoid redundant lookups.
 *
 * PERFORMANCE OPTIMIZATION:
 * - Room data is cached per-tick so that multiple creeps in the same room
 *   share the same cached find() results.
 * - Lazy evaluation: expensive fields are only computed when first accessed.
 * - Efficient hostile threat checks use direct distance calculation instead of
 *   pre-computing all positions (faster for small hostile counts).
 */

import type { SquadMemory, SwarmCreepMemory, SwarmState } from "../memory/schemas";
import { safeFind } from "@ralphschuler/screeps-utils";
import type { CreepContext } from "./types";
import { createLogger } from "@ralphschuler/screeps-core";

const logger = createLogger("CreepContext");

/**
 * Priority order for construction sites.
 * Higher values = higher priority.
 * 
 * Defense structures (walls, ramparts) have high priority to ensure
 * room security is established early, especially at RCL 2-3.
 */
const CONSTRUCTION_PRIORITY: Record<string, number> = {
  [STRUCTURE_SPAWN]: 100,
  [STRUCTURE_EXTENSION]: 90,
  [STRUCTURE_TOWER]: 80,
  [STRUCTURE_RAMPART]: 75,
  [STRUCTURE_WALL]: 70,
  [STRUCTURE_STORAGE]: 70,
  [STRUCTURE_CONTAINER]: 60,
  [STRUCTURE_ROAD]: 30
};

/** Threat detection range for hostiles */
const HOSTILE_THREAT_RANGE = 10;

// =============================================================================
// Per-Tick Room Cache with Lazy Evaluation
// =============================================================================

/**
 * Cached room data that is shared across all creeps in the same room per tick.
 * This dramatically reduces CPU by avoiding repeated room.find() calls.
 *
 * Uses lazy evaluation for expensive operations - fields are only computed
 * when first accessed.
 */
interface RoomCache {
  tick: number;
  room: Room;

  // Core cached data (always computed)
  hostiles: Creep[];
  myStructures: OwnedStructure[];
  // OPTIMIZATION: allStructures is expensive and not always needed
  // We load it lazily to reduce initial cache cost
  allStructures: Structure[];
  _allStructuresLoaded?: boolean;

  // Lazy-evaluated fields (computed on first access)
  _droppedResources?: Resource[];
  _containers?: StructureContainer[];
  _depositContainers?: StructureContainer[];
  _spawnStructures?: (StructureSpawn | StructureExtension)[];
  _towers?: StructureTower[];
  _prioritizedSites?: ConstructionSite[];
  _repairTargets?: Structure[];
  _damagedAllies?: Creep[];
  _labs?: StructureLab[];
  _factory?: StructureFactory | undefined;
  _factoryChecked?: boolean;
  _minerals?: Mineral[];
  _activeSources?: Source[];
  _tombstones?: Tombstone[];
  _mineralContainers?: StructureContainer[];
}

/** Per-room cache storage - cleared at the start of each tick via clearRoomCaches() */
const roomCacheMap = new Map<string, RoomCache>();

/**
 * Check if a position is within hostile threat range.
 * Uses Chebyshev distance (max of dx, dy) which is O(hostiles) instead of
 * O(hostiles * range²) for pre-computing all positions.
 * This is more efficient when there are few hostiles (typical case).
 */
function isInHostileThreatRange(pos: RoomPosition, hostiles: Creep[]): boolean {
  for (const hostile of hostiles) {
    // Chebyshev distance is the same as getRangeTo for Screeps
    const dx = Math.abs(pos.x - hostile.pos.x);
    const dy = Math.abs(pos.y - hostile.pos.y);
    if (Math.max(dx, dy) <= HOSTILE_THREAT_RANGE) {
      return true;
    }
  }
  return false;
}

/**
 * Get or create cached room data.
 * Only runs find() calls once per room per tick.
 * Uses lazy evaluation for expensive derived fields.
 *
 * OPTIMIZATION: Minimize initial cache cost by only loading essential data.
 * allStructures is expensive (~0.1 CPU) and often not needed by many creeps.
 * We load it lazily when first accessed instead of upfront.
 */
function getRoomCache(room: Room): RoomCache {
  const existing = roomCacheMap.get(room.name);
  if (existing && existing.tick === Game.time) {
    return existing;
  }

  // Build minimal core cache - only load what's always needed
  // Use safeFind for hostile creeps to handle engine errors with corrupted owner data
  const cache: RoomCache = {
    tick: Game.time,
    room,
    hostiles: safeFind(room, FIND_HOSTILE_CREEPS),
    // OPTIMIZATION: Load myStructures instead of allStructures initially.
    // Most creeps only need myStructures. allStructures will be loaded lazily if needed.
    myStructures: room.find(FIND_MY_STRUCTURES),
    // Set empty array for now - will be populated lazily when accessed
    allStructures: []
  };

  roomCacheMap.set(room.name, cache);
  return cache;
}

/**
 * Get dropped resources from cache (lazy evaluation)
 * Includes all resource types with significant amounts (>50 for energy, >0 for others)
 */
function getDroppedResources(cache: RoomCache): Resource[] {
  if (cache._droppedResources === undefined) {
    cache._droppedResources = cache.room.find(FIND_DROPPED_RESOURCES, {
      filter: r => (r.resourceType === RESOURCE_ENERGY && r.amount > 50) || 
                   (r.resourceType !== RESOURCE_ENERGY && r.amount > 0)
    });
  }
  return cache._droppedResources;
}

/**
 * Ensure allStructures is loaded in cache (lazy load optimization).
 * Only called when a function actually needs allStructures.
 */
function ensureAllStructuresLoaded(cache: RoomCache): void {
  if (!cache._allStructuresLoaded) {
    cache.allStructures = cache.room.find(FIND_STRUCTURES);
    cache._allStructuresLoaded = true;
  }
}

/**
 * Get containers with energy from cache (lazy evaluation)
 * 
 * Note: Room cache stale capacity issue was fixed - we now return ALL containers
 * without filtering by capacity. Behaviors check capacity directly for fresh state.
 */
function getContainers(cache: RoomCache): StructureContainer[] {
  if (cache._containers === undefined) {
    ensureAllStructuresLoaded(cache);
    // BUGFIX: Removed capacity check - return ALL containers
    // Capacity will be checked by behavior functions for fresh state
    cache._containers = cache.allStructures.filter(
      (s): s is StructureContainer =>
        s.structureType === STRUCTURE_CONTAINER
    );
  }
  return cache._containers;
}

/**
 * Get containers with free capacity from cache (lazy evaluation)
 * 
 * Note: Room cache stale capacity issue was fixed - we now return ALL containers
 * without filtering by capacity. Behaviors check for free vs used capacity as needed.
 */
function getDepositContainers(cache: RoomCache): StructureContainer[] {
  if (cache._depositContainers === undefined) {
    ensureAllStructuresLoaded(cache);
    // BUGFIX: Removed capacity check - return ALL containers  
    // Capacity will be checked by behavior functions for fresh state
    // Note: This is now the same as getContainers(), but kept separate
    // for code clarity and potential future differentiation
    cache._depositContainers = cache.allStructures.filter(
      (s): s is StructureContainer =>
        s.structureType === STRUCTURE_CONTAINER
    );
  }
  return cache._depositContainers;
}

/**
 * Get spawn structures needing energy from cache (lazy evaluation)
 * 
 * Note: Room cache stale capacity issue was fixed. The problem was that cache was
 * populated once per tick at first access, but structure capacity changes during 
 * the tick as creeps transfer energy. This caused infinite loops where multiple
 * creeps targeted already-full structures.
 * 
 * Solution: Don't filter by capacity in cache. Return ALL spawn structures and 
 * let behavior functions filter by capacity for fresh checks each time.
 */
function getSpawnStructures(cache: RoomCache): (StructureSpawn | StructureExtension)[] {
  if (cache._spawnStructures === undefined) {
    // BUGFIX: Removed capacity check from cache - return ALL spawn structures
    // Capacity will be checked by behavior functions for fresh state
    cache._spawnStructures = cache.myStructures.filter(
      (s): s is StructureSpawn | StructureExtension =>
        s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_EXTENSION
    );
  }
  return cache._spawnStructures;
}

/**
 * Get towers needing energy from cache (lazy evaluation)
 * 
 * Note: Room cache stale capacity issue was fixed (see getSpawnStructures).
 * We return ALL towers without filtering by capacity.
 */
function getTowers(cache: RoomCache): StructureTower[] {
  if (cache._towers === undefined) {
    // BUGFIX: Removed capacity check from cache - return ALL towers
    // Capacity will be checked by behavior functions for fresh state
    cache._towers = cache.myStructures.filter(
      (s): s is StructureTower =>
        s.structureType === STRUCTURE_TOWER
    );
  }
  return cache._towers;
}

/**
 * Get prioritized construction sites from cache (lazy evaluation)
 */
function getPrioritizedSites(cache: RoomCache): ConstructionSite[] {
  if (cache._prioritizedSites === undefined) {
    cache._prioritizedSites = cache.room.find(FIND_MY_CONSTRUCTION_SITES).sort((a, b) => {
      const priorityA = CONSTRUCTION_PRIORITY[a.structureType] ?? 50;
      const priorityB = CONSTRUCTION_PRIORITY[b.structureType] ?? 50;
      return priorityB - priorityA;
    });
  }
  return cache._prioritizedSites;
}

/**
 * Get repair targets from cache (lazy evaluation)
 */
function getRepairTargets(cache: RoomCache): Structure[] {
  if (cache._repairTargets === undefined) {
    ensureAllStructuresLoaded(cache);
    cache._repairTargets = cache.allStructures.filter(
      s => s.hits < s.hitsMax * 0.75 && s.structureType !== STRUCTURE_WALL
    );
  }
  return cache._repairTargets;
}

/**
 * Get damaged allies from cache (lazy evaluation)
 */
function getDamagedAllies(cache: RoomCache): Creep[] {
  if (cache._damagedAllies === undefined) {
    cache._damagedAllies = cache.room.find(FIND_MY_CREEPS, { filter: c => c.hits < c.hitsMax });
  }
  return cache._damagedAllies;
}

/**
 * Get labs from cache (lazy evaluation)
 */
function getLabs(cache: RoomCache): StructureLab[] {
  if (cache._labs === undefined) {
    cache._labs = cache.myStructures.filter((s): s is StructureLab => s.structureType === STRUCTURE_LAB);
  }
  return cache._labs;
}

/**
 * Get factory from cache (lazy evaluation)
 */
function getFactory(cache: RoomCache): StructureFactory | undefined {
  if (!cache._factoryChecked) {
    cache._factory = cache.myStructures.find((s): s is StructureFactory => s.structureType === STRUCTURE_FACTORY);
    cache._factoryChecked = true;
  }
  return cache._factory;
}

/**
 * Get minerals from cache (lazy evaluation)
 */
function getMinerals(cache: RoomCache): Mineral[] {
  if (cache._minerals === undefined) {
    cache._minerals = cache.room.find(FIND_MINERALS);
  }
  return cache._minerals;
}

/**
 * Get active sources from cache (lazy evaluation)
 */
function getActiveSources(cache: RoomCache): Source[] {
  if (cache._activeSources === undefined) {
    cache._activeSources = cache.room.find(FIND_SOURCES_ACTIVE);
  }
  return cache._activeSources;
}

/**
 * Get tombstones with energy from cache (lazy evaluation)
 * OPTIMIZATION: Tombstones with energy are common pickup targets for haulers.
 * This caching avoids expensive uncached room.find(FIND_TOMBSTONES) calls that
 * were performed every tick in the hauler behavior evaluation.
 * 
 * Note: Room cache stale capacity issue was fixed for consistency.
 * We return ALL tombstones without filtering by capacity.
 */
function getTombstones(cache: RoomCache): Tombstone[] {
  if (cache._tombstones === undefined) {
    // BUGFIX: Removed capacity check - return ALL tombstones
    // Capacity will be checked by behavior functions for fresh state
    cache._tombstones = cache.room.find(FIND_TOMBSTONES);
  }
  return cache._tombstones;
}

/**
 * Get containers with minerals from cache (lazy evaluation)
 * OPTIMIZATION: Mineral containers are checked by haulers for mineral transport.
 * This caching avoids expensive uncached room.find(FIND_STRUCTURES) with complex
 * filtering that was performed every tick in the hauler behavior evaluation.
 */
function getMineralContainers(cache: RoomCache): StructureContainer[] {
  if (cache._mineralContainers === undefined) {
    cache._mineralContainers = cache.room.find(FIND_STRUCTURES, {
      filter: s => {
        if (s.structureType !== STRUCTURE_CONTAINER) return false;
        const container = s ;
        // Check for any non-energy resources
        const resources = Object.keys(container.store) as ResourceConstant[];
        return resources.some(r => r !== RESOURCE_ENERGY && container.store.getUsedCapacity(r) > 0);
      }
    }) ;
  }
  return cache._mineralContainers;
}

/**
 * Clear all room caches. Must be called at the start of each tick
 * to prevent memory leaks from stale room data.
 * Also clears military behavior caches.
 */
export function clearRoomCaches(): void {
  roomCacheMap.clear();
  // Clear military patrol waypoint cache
  clearMilitaryBehaviorCaches();
}

/**
 * Callback for clearing military behavior caches.
 * Set by military.ts module.
 */
let clearMilitaryBehaviorCaches: () => void = () => {
  // Default no-op, overridden by military.ts
};

/**
 * Register a callback to clear military behavior caches.
 * Called by military.ts to register its cache clearing function.
 */
export function registerMilitaryCacheClear(fn: () => void): void {
  clearMilitaryBehaviorCaches = fn;
}

// =============================================================================
// Memory Helpers
// =============================================================================

/**
 * Get swarm state from room memory.
 */
function getSwarmState(roomName: string): SwarmState | undefined {
  const roomMem = (Memory as unknown as Record<string, Record<string, { swarm?: SwarmState }>>).rooms?.[roomName];
  return roomMem?.swarm;
}

/**
 * Get squad memory if creep is in a squad.
 */
function getSquadMemory(squadId: string | undefined): SquadMemory | undefined {
  if (!squadId) return undefined;
  const squads = (Memory as unknown as Record<string, Record<string, SquadMemory>>).squads;
  return squads?.[squadId];
}

/**
 * Get the assigned source for a harvester.
 */
function getAssignedSource(memory: SwarmCreepMemory): Source | null {
  if (!memory.sourceId) return null;
  return Game.getObjectById(memory.sourceId);
}

// =============================================================================
// Context Factory
// =============================================================================

/**
 * Create a context object for a creep.
 * Uses per-tick room caching with lazy evaluation to minimize CPU usage.
 *
 * Lazy evaluation ensures that expensive operations (like finding construction sites,
 * repair targets, etc.) are only performed when the creep's behavior actually needs them.
 * This can save significant CPU when many creeps don't need certain data.
 */
export function createContext(creep: Creep): CreepContext {
  const room = creep.room;
  const memory = creep.memory as unknown as SwarmCreepMemory;

  // Get cached room data - only runs find() once per room per tick
  const roomCache = getRoomCache(room);

  // BUGFIX: Ensure working state is initialized based on current carry
  // Creeps can spawn with working undefined, which causes behaviors to treat
  // them as always collecting. When a creep already has energy (e.g., spawned
  // with carry from renewals or from persisted state), initialize working
  // according to the actual store contents to prevent idle deadlocks.
  if (memory.working === undefined) {
    memory.working = creep.store.getUsedCapacity() > 0;
    logger.debug(`${creep.name} initialized working=${memory.working} from carry state`, {
      creep: creep.name
    });
  }

  const homeRoom = memory.homeRoom ?? room.name;

  return {
    // Core references
    creep,
    room,
    memory,

    // Room state
    get swarmState() {
      return getSwarmState(room.name);
    },
    get squadMemory() {
      return getSquadMemory(memory.squadId);
    },

    // Location info
    homeRoom,
    isInHomeRoom: room.name === homeRoom,

    // Creep state
    isFull: creep.store.getFreeCapacity() === 0,
    isEmpty: creep.store.getUsedCapacity() === 0,
    isWorking: memory.working ?? false,

    // Assigned targets
    get assignedSource() {
      return getAssignedSource(memory);
    },
    get assignedMineral() {
      const minerals = getMinerals(roomCache);
      return minerals[0] ?? null;
    },

    // Room analysis - uses efficient Chebyshev distance check for hostiles
    get energyAvailable() {
      return getActiveSources(roomCache).length > 0;
    },
    get nearbyEnemies() {
      return roomCache.hostiles.length > 0 && isInHostileThreatRange(creep.pos, roomCache.hostiles);
    },
    get constructionSiteCount() {
      return getPrioritizedSites(roomCache).length;
    },
    get damagedStructureCount() {
      return getRepairTargets(roomCache).length;
    },

    // Cached room objects (all from cache with lazy evaluation)
    get droppedResources() {
      return getDroppedResources(roomCache);
    },
    get containers() {
      return getContainers(roomCache);
    },
    get depositContainers() {
      return getDepositContainers(roomCache);
    },
    get spawnStructures() {
      return getSpawnStructures(roomCache);
    },
    get towers() {
      return getTowers(roomCache);
    },
    storage: room.storage,
    terminal: room.terminal,
    hostiles: roomCache.hostiles,
    get damagedAllies() {
      return getDamagedAllies(roomCache);
    },
    get prioritizedSites() {
      return getPrioritizedSites(roomCache);
    },
    get repairTargets() {
      return getRepairTargets(roomCache);
    },
    get labs() {
      return getLabs(roomCache);
    },
    get factory() {
      return getFactory(roomCache);
    },
    get tombstones() {
      return getTombstones(roomCache);
    },
    get mineralContainers() {
      return getMineralContainers(roomCache);
    }
  };
}
