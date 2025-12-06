/**
 * Global Path Cache Manager
 *
 * Provides cached pathfinding for common routes:
 * - Storage to sources
 * - Storage to controller
 * - Storage to remote entrances
 * - CostMatrix caching
 *
 * Addresses Issue: #32
 */

import { logger } from "../core/logger";

/**
 * Cached path entry
 */
export interface CachedPath {
  /** Path as serialized string */
  serialized: string;
  /** Path as array of positions */
  path: RoomPosition[];
  /** Path length */
  length: number;
  /** Creation tick */
  createdAt: number;
  /** Last used tick */
  lastUsed: number;
  /** Use count */
  useCount: number;
  /** Time-to-live in ticks */
  ttl: number;
}

/**
 * Path cache configuration
 */
export interface PathCacheConfig {
  /** Default TTL for cached paths */
  defaultTtl: number;
  /** Maximum cached paths per room */
  maxPathsPerRoom: number;
  /** Maximum total cached paths */
  maxTotalPaths: number;
  /** Cleanup interval in ticks */
  cleanupInterval: number;
}

const DEFAULT_CONFIG: PathCacheConfig = {
  defaultTtl: 1000,
  maxPathsPerRoom: 20,
  maxTotalPaths: 200,
  cleanupInterval: 100
};

/**
 * Global Path Cache Manager
 */
export class GlobalPathCache {
  private config: PathCacheConfig;
  private pathCache: Map<string, CachedPath> = new Map();
  private costMatrixCache: Map<string, { matrix: CostMatrix; tick: number }> = new Map();
  private lastCleanup = 0;

  public constructor(config: Partial<PathCacheConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Generate cache key for a path
   */
  private generateKey(from: RoomPosition, to: RoomPosition, opts?: { ignoreCreeps?: boolean }): string {
    const ignoreCreeps = opts?.ignoreCreeps ?? true;
    return `${from.roomName}:${from.x},${from.y}:${to.roomName}:${to.x},${to.y}:${String(ignoreCreeps)}`;
  }

  /**
   * Get cached path or compute and cache
   */
  public getPath(
    from: RoomPosition,
    to: RoomPosition,
    opts?: PathFinderOpts & { ttl?: number }
  ): RoomPosition[] | null {
    const key = this.generateKey(from, to, { ignoreCreeps: opts?.roomCallback === undefined });
    const cached = this.pathCache.get(key);

    // Return cached path if valid
    if (cached && Game.time - cached.createdAt < cached.ttl) {
      cached.lastUsed = Game.time;
      cached.useCount++;
      return cached.path;
    }

    // Compute new path
    const self = this;
    const result = PathFinder.search(from, { pos: to, range: 1 }, {
      plainCost: 2,
      swampCost: 10,
      roomCallback: opts?.roomCallback ?? ((roomName) => self.getCostMatrix(roomName)),
      maxRooms: opts?.maxRooms,
      maxOps: opts?.maxOps,
      heuristicWeight: opts?.heuristicWeight
    });

    if (result.incomplete) {
      return null;
    }

    // Cache the path
    this.cachePath(key, result.path, opts?.ttl ?? this.config.defaultTtl);

    // Run cleanup periodically
    if (Game.time - this.lastCleanup > this.config.cleanupInterval) {
      this.cleanup();
      this.lastCleanup = Game.time;
    }

    return result.path;
  }

  /**
   * Cache a path
   */
  private cachePath(key: string, path: RoomPosition[], ttl: number): void {
    // Check if we need to evict entries
    if (this.pathCache.size >= this.config.maxTotalPaths) {
      this.evictLeastUsed();
    }

    const serialized = this.serializePath(path);

    this.pathCache.set(key, {
      serialized,
      path,
      length: path.length,
      createdAt: Game.time,
      lastUsed: Game.time,
      useCount: 1,
      ttl
    });
  }

  /**
   * Serialize a path for compact storage
   */
  private serializePath(path: RoomPosition[]): string {
    if (path.length === 0) return "";

    const parts: string[] = [];
    let currentRoom = path[0]!.roomName;
    let positions: string[] = [];

    for (const pos of path) {
      if (pos.roomName !== currentRoom) {
        parts.push(`${currentRoom}:${positions.join(",")}`);
        currentRoom = pos.roomName;
        positions = [];
      }
      positions.push(`${pos.x}.${pos.y}`);
    }

    parts.push(`${currentRoom}:${positions.join(",")}`);
    return parts.join("|");
  }

  /**
   * Deserialize a path
   */
  private deserializePath(serialized: string): RoomPosition[] {
    if (!serialized) return [];

    const path: RoomPosition[] = [];
    const parts = serialized.split("|");

    for (const part of parts) {
      const [roomName, positionsStr] = part.split(":");
      if (!roomName || !positionsStr) continue;

      const positions = positionsStr.split(",");
      for (const posStr of positions) {
        const [x, y] = posStr.split(".");
        if (x && y) {
          path.push(new RoomPosition(parseInt(x, 10), parseInt(y, 10), roomName));
        }
      }
    }

    return path;
  }

  /**
   * Get or compute cost matrix for a room
   */
  public getCostMatrix(roomName: string): CostMatrix | false {
    const cached = this.costMatrixCache.get(roomName);

    // Return cached matrix if recent (valid for 50 ticks)
    if (cached && Game.time - cached.tick < 50) {
      return cached.matrix;
    }

    const room = Game.rooms[roomName];
    if (!room) {
      return false; // Use default costs
    }

    const matrix = new PathFinder.CostMatrix();

    // Add structures
    const structures = room.find(FIND_STRUCTURES);
    for (const struct of structures) {
      if (struct.structureType === STRUCTURE_ROAD) {
        matrix.set(struct.pos.x, struct.pos.y, 1);
      } else if (
        struct.structureType !== STRUCTURE_CONTAINER &&
        (struct.structureType !== STRUCTURE_RAMPART || !(struct as OwnedStructure).my)
      ) {
        matrix.set(struct.pos.x, struct.pos.y, 255);
      }
    }

    // Add construction sites
    const sites = room.find(FIND_CONSTRUCTION_SITES);
    for (const site of sites) {
      if (site.structureType !== STRUCTURE_ROAD && site.structureType !== STRUCTURE_CONTAINER) {
        matrix.set(site.pos.x, site.pos.y, 255);
      }
    }

    // Cache the matrix
    this.costMatrixCache.set(roomName, { matrix, tick: Game.time });

    return matrix;
  }

  /**
   * Invalidate cost matrix for a room
   */
  public invalidateCostMatrix(roomName: string): void {
    this.costMatrixCache.delete(roomName);
  }

  /**
   * Invalidate paths involving a room
   */
  public invalidateRoomPaths(roomName: string): void {
    for (const [key] of this.pathCache) {
      if (key.includes(roomName)) {
        this.pathCache.delete(key);
      }
    }
  }

  /**
   * Evict least recently used paths
   */
  private evictLeastUsed(): void {
    // Sort by last used (oldest first)
    const entries = Array.from(this.pathCache.entries())
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed);

    // Remove oldest 10%
    const toRemove = Math.max(1, Math.floor(entries.length * 0.1));
    for (let i = 0; i < toRemove; i++) {
      const entry = entries[i];
      if (entry) {
        this.pathCache.delete(entry[0]);
      }
    }
  }

  /**
   * Cleanup expired paths
   */
  private cleanup(): void {
    for (const [key, cached] of this.pathCache) {
      if (Game.time - cached.createdAt > cached.ttl) {
        this.pathCache.delete(key);
      }
    }

    // Also clean up old cost matrices
    for (const [roomName, cached] of this.costMatrixCache) {
      if (Game.time - cached.tick > 500) {
        this.costMatrixCache.delete(roomName);
      }
    }
  }

  /**
   * Pre-cache common paths for a room
   */
  public precacheRoomPaths(roomName: string): void {
    const room = Game.rooms[roomName];
    if (!room || !room.controller?.my) return;

    const storage = room.storage;
    const spawn = room.find(FIND_MY_SPAWNS)[0];
    const anchor = storage?.pos ?? spawn?.pos;

    if (!anchor) return;

    // Cache paths to sources
    const sources = room.find(FIND_SOURCES);
    for (const source of sources) {
      this.getPath(anchor, source.pos, { ttl: 5000 });
    }

    // Cache path to controller
    if (room.controller) {
      this.getPath(anchor, room.controller.pos, { ttl: 5000 });
    }

    // Cache paths to exits for remote mining
    const exits = room.find(FIND_EXIT);
    const uniqueExits = new Map<string, RoomPosition>();
    for (const exit of exits) {
      const key = `${Math.floor(exit.x / 10)},${Math.floor(exit.y / 10)}`;
      if (!uniqueExits.has(key)) {
        uniqueExits.set(key, exit);
      }
    }

    for (const exit of uniqueExits.values()) {
      this.getPath(anchor, exit, { ttl: 5000 });
    }

    logger.debug(`Pre-cached ${sources.length + 1 + uniqueExits.size} paths for ${roomName}`, {
      subsystem: "PathCache"
    });
  }

  /**
   * Get cache statistics
   */
  public getStats(): {
    pathCount: number;
    matrixCount: number;
    avgUseCount: number;
    hitRate: number;
  } {
    let totalUses = 0;
    for (const cached of this.pathCache.values()) {
      totalUses += cached.useCount;
    }

    return {
      pathCount: this.pathCache.size,
      matrixCount: this.costMatrixCache.size,
      avgUseCount: this.pathCache.size > 0 ? totalUses / this.pathCache.size : 0,
      hitRate: 0 // Would need to track hits/misses
    };
  }

  /**
   * Clear all caches
   */
  public clear(): void {
    this.pathCache.clear();
    this.costMatrixCache.clear();
  }
}

/**
 * Global path cache instance
 */
export const globalPathCache = new GlobalPathCache();
