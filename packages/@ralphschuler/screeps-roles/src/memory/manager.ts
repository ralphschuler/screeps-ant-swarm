/**
 * Memory Manager - Stub for roles package
 * 
 * Provides basic memory management interface needed by behaviors.
 * The full implementation should be provided by the consuming application.
 */

import type { RoomIntel, EmpireMemory, SwarmState } from "./schemas";

/**
 * Simple memory manager stub
 */
class MemoryManager {
  /**
   * Get room intel from memory
   */
  getRoomIntel(roomName: string): RoomIntel | undefined {
    const empire = Memory as unknown as { empire?: EmpireMemory };
    if (!empire.empire?.knownRooms) return undefined;
    return empire.empire.knownRooms[roomName];
  }
  
  /**
   * Set room intel in memory
   */
  setRoomIntel(roomName: string, intel: RoomIntel): void {
    const empire = Memory as unknown as { empire?: EmpireMemory };
    if (!empire.empire) {
      // Create minimal empire memory structure
      empire.empire = {
        knownRooms: {},
        clusters: [],
        warTargets: [],
        ownedRooms: {},
        claimQueue: [],
        nukeCandidates: [],
        powerBanks: [],
        objectives: {
          targetPowerLevel: 0,
          targetRoomCount: 1,
          warMode: false,
          expansionPaused: false
        },
        lastUpdate: Game.time
      };
    }
    if (!empire.empire.knownRooms) {
      empire.empire.knownRooms = {};
    }
    empire.empire.knownRooms[roomName] = intel;
  }
  
  /**
   * Get swarm state for a room
   */
  getSwarmState(roomName: string): SwarmState | undefined {
    const roomMemory = Memory.rooms[roomName] as unknown as { swarm?: SwarmState };
    return roomMemory?.swarm;
  }
  
  /**
   * Get or initialize swarm state for a room
   */
  getOrInitSwarmState(roomName: string): SwarmState {
    const roomMemory = Memory.rooms[roomName] as unknown as { swarm?: SwarmState };
    if (!roomMemory.swarm) {
      roomMemory.swarm = {
        colonyLevel: 1 as any, // EvolutionStage 
        posture: 'peaceful' as any, // RoomPosture
        danger: 0,
        pheromones: {
          expand: 0,
          harvest: 0,
          build: 0,
          upgrade: 0,
          defense: 0,
          war: 0,
          siege: 0,
          logistics: 0,
          nukeTarget: 0
        },
        nextUpdateTick: Game.time + 100,
        eventLog: [],
        missingStructures: {
          spawn: true,
          storage: true,
          terminal: true,
          labs: true,
          nuker: true,
          factory: true,
          extractor: true,
          powerSpawn: true,
          observer: true
        },
        role: 'capital' as any, // RoomRole
        remoteAssignments: [],
        metrics: {
          energyHarvested: 0,
          energySpawning: 0,
          energyConstruction: 0,
          energyRepair: 0,
          energyTower: 0,
          controllerProgress: 0,
          hostileCount: 0,
          damageReceived: 0,
          constructionSites: 0,
          energyAvailable: 0,
          energyCapacity: 0,
          energyNeed: 0 as 0 | 1 | 2 | 3
        },
        lastUpdate: Game.time
      };
    }
    return roomMemory.swarm!; // Non-null assertion since we just created it
  }
  
  /**
   * Get empire memory
   */
  getEmpire(): EmpireMemory {
    const empire = Memory as unknown as { empire?: EmpireMemory };
    if (!empire.empire) {
      empire.empire = {
        knownRooms: {},
        clusters: [],
        warTargets: [],
        ownedRooms: {},
        claimQueue: [],
        nukeCandidates: [],
        powerBanks: [],
        objectives: {
          targetPowerLevel: 0,
          targetRoomCount: 1,
          warMode: false,
          expansionPaused: false
        },
        lastUpdate: Game.time
      };
    }
    return empire.empire;
  }
}

export const memoryManager = new MemoryManager();
