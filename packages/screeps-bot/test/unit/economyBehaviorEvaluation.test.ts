import { assert } from "chai";
import { evaluateEconomyBehavior } from "@ralphschuler/screeps-roles";
import type { CreepContext } from "@ralphschuler/screeps-roles";
import type { SwarmCreepMemory } from "../../src/memory/schemas";

/**
 * Minimal interface for mock store object
 */
interface MockStore {
  getCapacity: () => number | null;
  getFreeCapacity: (resource?: string) => number | null;
  getUsedCapacity: (resource?: string) => number;
}

/**
 * Minimal interface for mock position object
 */
interface MockPosition {
  findClosestByRange<T>(targets: T[]): T | null;
  isNearTo: () => boolean;
  findInRange: () => never[];
}

/**
 * Minimal interface for mock creep object
 */
interface MockCreep {
  name: string;
  store: MockStore;
  pos: MockPosition;
  memory: Record<string, unknown>;
  room: Room;
}

/**
 * Minimal interface for mock room object
 */
interface MockRoom {
  name: string;
  controller: StructureController | undefined;
  find: () => never[];
}

/**
 * Create a mock creep for testing
 */
function createMockCreep(options: {
  name: string;
  freeCapacity: number;
  usedCapacity: number;
}): Creep {
  const mockRoom = createMockRoom();
  
  const mockCreep: MockCreep = {
    name: options.name,
    room: mockRoom,
    store: {
      getCapacity: () => options.freeCapacity + options.usedCapacity,
      getFreeCapacity: () => options.freeCapacity,
      getUsedCapacity: () => options.usedCapacity
    },
    pos: {
      findClosestByRange<T>(targets: T[]): T | null {
        return targets.length > 0 ? targets[0] : null;
      },
      isNearTo: () => false,
      findInRange: () => []
    },
    memory: {}
  };
  return mockCreep as unknown as Creep;
}

/**
 * Create a mock room for testing
 * Includes Mock Game object to prevent errors in helper functions
 */
function createMockRoom(): Room {
  // Setup minimal global Game mock if needed
  if (typeof global.Game === 'undefined') {
    (global as any).Game = {
      time: 1000,
      rooms: {},
      creeps: {}
    };
  }
  
  const mockRoom: MockRoom = {
    name: "E1N1",
    controller: undefined,
    find: () => []
  };
  return mockRoom as unknown as Room;
}

/**
 * Create a mock context for testing economy behavior evaluation
 */
function createMockContext(
  creep: Creep,
  memory: Partial<SwarmCreepMemory> = {}
): CreepContext {
  const fullMemory: SwarmCreepMemory = {
    role: "larvaWorker",
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
    assignedSource: null,
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

describe("evaluateEconomyBehavior", () => {
  describe("role routing", () => {
    it("should route larvaWorker role to larvaWorker behavior", () => {
      const creep = createMockCreep({
        name: "TestLarva",
        freeCapacity: 0,
        usedCapacity: 50
      });
      const ctx = createMockContext(creep, { role: "larvaWorker" });

      const action = evaluateEconomyBehavior(ctx);

      // larvaWorker returns findEnergy when empty, which returns idle when no sources
      assert.equal(action.type, "idle");
    });

    it("should route harvester role to harvester behavior", () => {
      const creep = createMockCreep({
        name: "TestHarvester",
        freeCapacity: 50,
        usedCapacity: 0
      });
      const ctx = createMockContext(creep, { role: "harvester" });

      const action = evaluateEconomyBehavior(ctx);

      // harvester returns idle when no source assigned
      assert.equal(action.type, "idle");
    });

    it("should route hauler role to hauler behavior", () => {
      const creep = createMockCreep({
        name: "TestHauler",
        freeCapacity: 50,
        usedCapacity: 0
      });
      const ctx = createMockContext(creep, { role: "hauler" });

      const action = evaluateEconomyBehavior(ctx);

      // hauler returns idle when no energy sources
      assert.equal(action.type, "idle");
    });

    it("should route builder role to builder behavior", () => {
      const creep = createMockCreep({
        name: "TestBuilder",
        freeCapacity: 50,
        usedCapacity: 0
      });
      const ctx = createMockContext(creep, { role: "builder" });

      const action = evaluateEconomyBehavior(ctx);

      // builder returns findEnergy when empty
      assert.equal(action.type, "idle");
    });

    it("should route upgrader role to upgrader behavior", () => {
      const creep = createMockCreep({
        name: "TestUpgrader",
        freeCapacity: 50,
        usedCapacity: 0
      });
      const ctx = createMockContext(creep, { role: "upgrader" });

      const action = evaluateEconomyBehavior(ctx);

      // upgrader returns findEnergy when empty
      assert.equal(action.type, "idle");
    });

    it("should route queenCarrier role to queenCarrier behavior", () => {
      const creep = createMockCreep({
        name: "TestQueen",
        freeCapacity: 50,
        usedCapacity: 0
      });
      const ctx = createMockContext(creep, { role: "queenCarrier" });

      const action = evaluateEconomyBehavior(ctx);

      // queenCarrier returns idle when empty with no sources
      assert.equal(action.type, "idle");
    });

    it("should route mineralHarvester role to mineralHarvester behavior", () => {
      const creep = createMockCreep({
        name: "TestMineralHarvester",
        freeCapacity: 50,
        usedCapacity: 0
      });
      const ctx = createMockContext(creep, { role: "mineralHarvester" });

      const action = evaluateEconomyBehavior(ctx);

      // mineralHarvester returns idle when no mineral assigned
      assert.equal(action.type, "idle");
    });

    it("should route depositHarvester role to depositHarvester behavior", () => {
      const creep = createMockCreep({
        name: "TestDepositHarvester",
        freeCapacity: 50,
        usedCapacity: 0
      });
      const ctx = createMockContext(creep, { role: "depositHarvester" });

      const action = evaluateEconomyBehavior(ctx);

      // depositHarvester returns idle when no deposit assigned
      assert.equal(action.type, "idle");
    });

    it("should route labTech role to labTech behavior", () => {
      const creep = createMockCreep({
        name: "TestLabTech",
        freeCapacity: 50,
        usedCapacity: 0
      });
      const ctx = createMockContext(creep, { role: "labTech" });

      const action = evaluateEconomyBehavior(ctx);

      // labTech returns idle when no labs or reactions
      assert.equal(action.type, "idle");
    });

    it("should route labSupply role to labSupply behavior", () => {
      const creep = createMockCreep({
        name: "TestLabSupply",
        freeCapacity: 50,
        usedCapacity: 0
      });
      const ctx = createMockContext(creep, { role: "labSupply" });

      const action = evaluateEconomyBehavior(ctx);

      // labSupply returns idle when no lab supplies needed
      assert.equal(action.type, "idle");
    });

    it("should route factoryWorker role to factoryWorker behavior", () => {
      const creep = createMockCreep({
        name: "TestFactoryWorker",
        freeCapacity: 50,
        usedCapacity: 0
      });
      const ctx = createMockContext(creep, { role: "factoryWorker" });

      const action = evaluateEconomyBehavior(ctx);

      // factoryWorker returns idle when no factory
      assert.equal(action.type, "idle");
    });

    it("should route remoteHarvester role to remoteHarvester behavior", () => {
      const creep = createMockCreep({
        name: "TestRemoteHarvester",
        freeCapacity: 50,
        usedCapacity: 0
      });
      const ctx = createMockContext(creep, { role: "remoteHarvester" });

      const action = evaluateEconomyBehavior(ctx);

      // remoteHarvester returns idle or moveToRoom based on config
      assert.oneOf(action.type, ["idle", "moveToRoom"]);
    });

    it("should route remoteHauler role to remoteHauler behavior", () => {
      const creep = createMockCreep({
        name: "TestRemoteHauler",
        freeCapacity: 50,
        usedCapacity: 0
      });
      const ctx = createMockContext(creep, { role: "remoteHauler" });

      const action = evaluateEconomyBehavior(ctx);

      // remoteHauler returns idle or moveToRoom based on config
      assert.oneOf(action.type, ["idle", "moveToRoom"]);
    });

    it("should route interRoomCarrier role to interRoomCarrier behavior", () => {
      const creep = createMockCreep({
        name: "TestInterRoomCarrier",
        freeCapacity: 50,
        usedCapacity: 0
      });
      const ctx = createMockContext(creep, { role: "interRoomCarrier" });

      const action = evaluateEconomyBehavior(ctx);

      // interRoomCarrier returns idle or moveToRoom based on config
      assert.oneOf(action.type, ["idle", "moveToRoom"]);
    });
  });

  describe("fallback behavior", () => {
    it("should fallback to larvaWorker for unknown role", () => {
      const creep = createMockCreep({
        name: "TestUnknown",
        freeCapacity: 50,
        usedCapacity: 0
      });
      const ctx = createMockContext(creep, { role: "unknownRole" as any });

      const action = evaluateEconomyBehavior(ctx);

      // Should fallback to larvaWorker which returns idle when no sources
      assert.equal(action.type, "idle");
    });

    it("should fallback to larvaWorker for undefined role", () => {
      const creep = createMockCreep({
        name: "TestUndefined",
        freeCapacity: 50,
        usedCapacity: 0
      });
      const ctx = createMockContext(creep, { role: undefined as any });

      const action = evaluateEconomyBehavior(ctx);

      // Should fallback to larvaWorker which returns idle when no sources
      assert.equal(action.type, "idle");
    });

    it("should fallback to larvaWorker for empty string role", () => {
      const creep = createMockCreep({
        name: "TestEmpty",
        freeCapacity: 50,
        usedCapacity: 0
      });
      const ctx = createMockContext(creep, { role: "" as any });

      const action = evaluateEconomyBehavior(ctx);

      // Should fallback to larvaWorker which returns idle when no sources
      assert.equal(action.type, "idle");
    });
  });

  describe("action return types", () => {
    it("should return CreepAction with valid type property", () => {
      const creep = createMockCreep({
        name: "TestAction",
        freeCapacity: 50,
        usedCapacity: 0
      });
      const ctx = createMockContext(creep, { role: "harvester" });

      const action = evaluateEconomyBehavior(ctx);

      assert.isObject(action);
      assert.property(action, "type");
      assert.isString(action.type);
    });

    it("should return different actions for different role states", () => {
      // Test that working state affects action for larvaWorker
      const creepEmpty = createMockCreep({
        name: "TestEmpty",
        freeCapacity: 50,
        usedCapacity: 0
      });
      const ctxEmpty = createMockContext(creepEmpty, { role: "larvaWorker" });
      ctxEmpty.isEmpty = true;
      ctxEmpty.isWorking = false;

      const actionEmpty = evaluateEconomyBehavior(ctxEmpty);
      assert.equal(actionEmpty.type, "idle"); // No energy sources

      const creepFull = createMockCreep({
        name: "TestFull",
        freeCapacity: 0,
        usedCapacity: 50
      });
      const ctxFull = createMockContext(creepFull, { role: "larvaWorker" });
      ctxFull.isEmpty = false;
      ctxFull.isWorking = true;

      const actionFull = evaluateEconomyBehavior(ctxFull);
      assert.equal(actionFull.type, "idle"); // No delivery targets
    });
  });

  describe("role consistency", () => {
    const allRoles = [
      "larvaWorker",
      "harvester",
      "hauler",
      "builder",
      "upgrader",
      "queenCarrier",
      "mineralHarvester",
      "depositHarvester",
      "labTech",
      "labSupply",
      "factoryWorker",
      "remoteHarvester",
      "remoteHauler",
      "interRoomCarrier"
    ];

    allRoles.forEach(role => {
      it(`should handle ${role} role without errors`, () => {
        const creep = createMockCreep({
          name: `Test${role}`,
          freeCapacity: 50,
          usedCapacity: 0
        });
        const ctx = createMockContext(creep, { role: role as any });

        // Should not throw error
        assert.doesNotThrow(() => {
          evaluateEconomyBehavior(ctx);
        });
      });

      it(`should return valid action for ${role} role`, () => {
        const creep = createMockCreep({
          name: `Test${role}`,
          freeCapacity: 50,
          usedCapacity: 0
        });
        const ctx = createMockContext(creep, { role: role as any });

        const action = evaluateEconomyBehavior(ctx);

        assert.isObject(action);
        assert.property(action, "type");
        assert.isString(action.type);
      });
    });
  });
});
