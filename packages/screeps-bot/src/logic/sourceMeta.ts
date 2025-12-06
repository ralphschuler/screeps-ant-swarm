/**
 * Source Meta Tracking
 *
 * Analyzes sources in owned rooms to determine:
 * - Walkable slots around each source
 * - Distance to storage/spawn
 * - Associated container/link IDs
 * - Optimal harvester count
 *
 * Addresses Issue: #9
 */

import type { SwarmState } from "../memory/schemas";
import { logger } from "../core/logger";

/**
 * Source metadata
 */
export interface SourceMeta {
  /** Source ID */
  id: Id<Source>;
  /** Number of walkable tiles around source */
  slots: number;
  /** Distance to storage (or spawn if no storage) */
  distanceToStorage: number;
  /** Container ID near this source */
  containerId?: Id<StructureContainer>;
  /** Link ID near this source */
  linkId?: Id<StructureLink>;
  /** Optimal number of harvesters for this source */
  optimalHarvesters: number;
  /** Path length to storage */
  pathLength: number;
}

/**
 * Analyze sources in a room and update swarm state
 */
export function analyzeRoomSources(room: Room, _swarm: SwarmState): void {
  const sources = room.find(FIND_SOURCES);
  const sourceMetas: Record<string, SourceMeta> = {};

  // Find anchor point (storage or spawn)
  const anchor = room.storage ?? room.find(FIND_MY_SPAWNS)[0];
  if (!anchor) {
    // No anchor yet, skip analysis
    return;
  }

  for (const source of sources) {
    const meta = analyzeSource(source, anchor);
    sourceMetas[source.id] = meta;
  }

  // Store in swarm state (extend schema if needed)
  // For now, log the results
  for (const sourceId in sourceMetas) {
    const meta = sourceMetas[sourceId];
    logger.debug(
      `Source ${sourceId}: ${meta.slots} slots, ${meta.distanceToStorage} distance, ${meta.optimalHarvesters} harvesters`,
      { subsystem: "SourceMeta" }
    );
  }
}

/**
 * Analyze a single source
 */
function analyzeSource(source: Source, anchor: Structure | StructureSpawn): SourceMeta {
  const room = source.room;
  const terrain = room.getTerrain();

  // Count walkable slots around source
  let slots = 0;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (dx === 0 && dy === 0) continue; // Skip source itself

      const x = source.pos.x + dx;
      const y = source.pos.y + dy;

      // Check bounds
      if (x < 1 || x > 48 || y < 1 || y > 48) continue;

      // Check terrain
      if (terrain.get(x, y) !== TERRAIN_MASK_WALL) {
        slots++;
      }
    }
  }

  // Find container near source
  const containers = source.pos.findInRange(FIND_STRUCTURES, 2, {
    filter: s => s.structureType === STRUCTURE_CONTAINER
  }) ;

  const containerId = containers.length > 0 ? containers[0].id : undefined;

  // Find link near source
  const links = source.pos.findInRange(FIND_MY_STRUCTURES, 2, {
    filter: s => s.structureType === STRUCTURE_LINK
  }) ;

  const linkId = links.length > 0 ? links[0].id : undefined;

  // Calculate distance to storage
  const distanceToStorage = source.pos.getRangeTo(anchor);

  // Calculate path length (more accurate than linear distance)
  const path = source.pos.findPathTo(anchor, { ignoreCreeps: true });
  const pathLength = path.length;

  // Determine optimal harvesters
  // Each harvester with 5 WORK parts can harvest 10 energy/tick
  // Source regenerates 3000 energy every 300 ticks = 10 energy/tick
  // So 1 harvester with 5+ WORK parts is optimal per source
  // But if we have limited slots, we might need multiple smaller harvesters
  const optimalHarvesters = Math.min(slots, 2); // Max 2 harvesters per source

  return {
    id: source.id,
    slots,
    distanceToStorage,
    containerId,
    linkId,
    optimalHarvesters,
    pathLength
  };
}

/**
 * Get source meta for a source ID
 */
export function getSourceMeta(sourceId: Id<Source>, room: Room): SourceMeta | null {
  const source = Game.getObjectById(sourceId);
  if (!source) return null;

  const anchor = room.storage ?? room.find(FIND_MY_SPAWNS)[0];
  if (!anchor) return null;

  return analyzeSource(source, anchor);
}
