/**
 * Common utilities for roles package
 */

/**
 * Get a collection point for creeps to gather at
 * Simple implementation - returns spawn position as fallback
 */
export function getCollectionPoint(roomName: string): RoomPosition | null {
  const room = Game.rooms[roomName];
  if (!room) return null;
  
  const spawns = room.find(FIND_MY_SPAWNS);
  if (spawns.length > 0) {
    return spawns[0].pos;
  }
  
  // Fallback to room center
  return new RoomPosition(25, 25, roomName);
}
