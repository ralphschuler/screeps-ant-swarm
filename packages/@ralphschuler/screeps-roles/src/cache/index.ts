/**
 * Cache re-exports for roles package
 * Re-exports all cache functionality from the main cache package
 */

export {
  globalCache,
  findCachedClosest,
  cachedRoomFind,
  cachedFindSources,
  cachedFindHostileCreeps,
  cachedFindStructures,
  cachedFindMyStructures,
  cachedFindConstructionSites,
  cachedFindDroppedResources,
  getAssignedSource,
  getSourceContainer,
  getControllerEnergySource,
  clearClosestCache,
  clearCacheOnStateChange
} from "@ralphschuler/screeps-cache";
