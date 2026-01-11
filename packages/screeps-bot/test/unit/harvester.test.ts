import { assert } from "chai";
import { harvester } from "@ralphschuler/screeps-roles";
import type { CreepContext } from "@ralphschuler/screeps-roles";
import type { SwarmCreepMemory } from "../../src/memory/schemas";

/**
 * Minimal interface for mock position object
 */
interface MockPosition {
  isNearTo: () => boolean;
  findInRange: () => never[];
}

/**
 * Minimal interface for mock store object
 */
interface MockStore {
  getCapacity: () => number | null;
  getFreeCapacity: () => number | null;
  getUsedCapacity: () => number;
}

/**
 * Minimal interface for mock creep object
 */
interface MockCreep {
  name: string;
  store: MockStore;
  pos: MockPosition;
}

/**
 * Create a mock creep for testing.
 * freeCapacity is automatically calculated from capacity - usedCapacity.
 * When capacity is null (no CARRY parts), freeCapacity is also null.
 */
function createMockCreep(options: {
  capacity: number | null;
  usedCapacity: number;
  isNearToSource: boolean;
}): Creep {
  const freeCapacity = options.capacity === null ? null : options.capacity - options.usedCapacity;
  const mockCreep: MockCreep = {
    name: "TestHarvester",
    store: {
      getCapacity: () => options.capacity,
      getFreeCapacity: () => freeCapacity,
      getUsedCapacity: () => options.usedCapacity
    },
    pos: {
      isNearTo: () => options.isNearToSource,
      findInRange: () => []
    }
  };
  return mockCreep as unknown as Creep;
}

/**
 * Create a mock source for testing
 */
function createMockSource(): Source {
  return {
    id: "mockSourceId" as Id<Source>,
    energy: 3000
  } as unknown as Source;
}

/**
 * Minimal interface for mock room object
 */
interface MockRoom {
  find: () => never[];
}

/**
 * Create a mock room for testing
 */
function createMockRoom(): Room {
  const mockRoom: MockRoom = {
    find: () => []
  };
  return mockRoom as unknown as Room;
}

/**
 * Create a mock context for testing harvester behavior
 */
function createMockContext(
  creep: Creep,
  source: Source | null,
  memory: Partial<SwarmCreepMemory> = {}
): CreepContext {
  const fullMemory: SwarmCreepMemory = {
    role: "harvester",
    family: "economy",
    homeRoom: "E1N1",
    version: 1,
    ...memory
  };

  return {
    creep,
    room: createMockRoom(),
    memory: fullMemory,
    swarmState: undefined,
    squadMemory: undefined,
    homeRoom: "E1N1",
    isInHomeRoom: true,
    isFull: false,
    isEmpty: true,
    isWorking: false,
    assignedSource: source,
    assignedMineral: null,
    energyAvailable: true,
    nearbyEnemies: false,
    constructionSiteCount: 0,
    damagedStructureCount: 0,
    droppedResources: [],
    containers: [],
    depositContainers: [],
    spawnStructures: [],
    towers: [],
    storage: undefined,
    terminal: undefined,
    hostiles: [],
    damagedAllies: [],
    prioritizedSites: [],
    repairTargets: [],
    labs: [],
    factory: undefined,
    tombstones: [],
    mineralContainers: []
  };
}

describe("harvester behavior", () => {
  describe("when creep has no carry capacity (drop miner)", () => {
    it("should return harvest action when near source with null capacity", () => {
      const source = createMockSource();
      const creep = createMockCreep({
        capacity: null,
        usedCapacity: 0,
        isNearToSource: true
      });
      const ctx = createMockContext(creep, source);

      const action = harvester(ctx);

      assert.equal(action.type, "harvest");
      if (action.type === "harvest") {
        assert.equal(action.target, source);
      }
    });

    it("should return harvest action when near source with zero capacity", () => {
      const source = createMockSource();
      const creep = createMockCreep({
        capacity: 0,
        usedCapacity: 0,
        isNearToSource: true
      });
      const ctx = createMockContext(creep, source);

      const action = harvester(ctx);

      assert.equal(action.type, "harvest");
      if (action.type === "harvest") {
        assert.equal(action.target, source);
      }
    });
  });

  describe("when creep has carry capacity", () => {
    it("should return harvest action when near source and has free capacity", () => {
      const source = createMockSource();
      const creep = createMockCreep({
        capacity: 50,
        usedCapacity: 0,
        isNearToSource: true
      });
      const ctx = createMockContext(creep, source);

      const action = harvester(ctx);

      assert.equal(action.type, "harvest");
      if (action.type === "harvest") {
        assert.equal(action.target, source);
      }
    });

    it("should return drop action when full and no container/link nearby", () => {
      const source = createMockSource();
      const creep = createMockCreep({
        capacity: 50,
        usedCapacity: 50,
        isNearToSource: true
      });
      const ctx = createMockContext(creep, source);

      const action = harvester(ctx);

      assert.equal(action.type, "drop");
    });
  });

  describe("when not near source", () => {
    it("should return moveTo action", () => {
      const source = createMockSource();
      const creep = createMockCreep({
        capacity: null,
        usedCapacity: 0,
        isNearToSource: false
      });
      const ctx = createMockContext(creep, source);

      const action = harvester(ctx);

      assert.equal(action.type, "moveTo");
      if (action.type === "moveTo") {
        assert.equal(action.target, source);
      }
    });
  });

  describe("when no source assigned", () => {
    it("should return idle when no sources available", () => {
      const creep = createMockCreep({
        capacity: null,
        usedCapacity: 0,
        isNearToSource: false
      });
      const ctx = createMockContext(creep, null);

      const action = harvester(ctx);

      assert.equal(action.type, "idle");
    });
  });
});
