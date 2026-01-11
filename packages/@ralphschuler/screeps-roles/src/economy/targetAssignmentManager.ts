/**
 * Target Assignment Manager - Stub for roles package
 * 
 * This is a simplified stub that provides the interface needed by behaviors.
 * The full implementation should come from @ralphschuler/screeps-economy package.
 * 
 * For now, provides simple fallback implementations.
 */

/**
 * Get assigned source for a harvester
 * Falls back to finding closest available source
 */
export function getAssignedSource(creep: Creep): Source | null {
  if (!creep.room) return null;
  
  // Check if creep has assigned source in memory
  const memory = creep.memory as { sourceId?: Id<Source> };
  if (memory.sourceId) {
    const source = Game.getObjectById(memory.sourceId);
    if (source) return source;
  }
  
  // Find closest source as fallback
  const sources = creep.room.find(FIND_SOURCES);
  if (sources.length === 0) return null;
  
  const closest = creep.pos.findClosestByRange(sources);
  if (closest) {
    memory.sourceId = closest.id;
  }
  return closest;
}

/**
 * Get assigned build target for a builder
 * Falls back to finding closest construction site
 */
export function getAssignedBuildTarget(creep: Creep): ConstructionSite | null {
  if (!creep.room) return null;
  
  const memory = creep.memory as { targetId?: Id<ConstructionSite> };
  if (memory.targetId) {
    const site = Game.getObjectById(memory.targetId);
    if (site) return site;
  }
  
  const sites = creep.room.find(FIND_MY_CONSTRUCTION_SITES);
  if (sites.length === 0) return null;
  
  const closest = creep.pos.findClosestByRange(sites);
  if (closest) {
    memory.targetId = closest.id;
  }
  return closest;
}

/**
 * Get assigned repair target for a repairer
 * Falls back to finding closest damaged structure
 */
export function getAssignedRepairTarget(creep: Creep): Structure | null {
  if (!creep.room) return null;
  
  const memory = creep.memory as { targetId?: Id<Structure> };
  if (memory.targetId) {
    const structure = Game.getObjectById(memory.targetId);
    if (structure && structure.hits < structure.hitsMax) {
      return structure;
    }
  }
  
  const structures = creep.room.find(FIND_STRUCTURES, {
    filter: s => s.hits < s.hitsMax
  });
  if (structures.length === 0) return null;
  
  const closest = creep.pos.findClosestByRange(structures);
  if (closest) {
    memory.targetId = closest.id;
  }
  return closest;
}
