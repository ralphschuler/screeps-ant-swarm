import { assert } from "chai";
import { upgrader } from "@ralphschuler/screeps-roles";
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
  findInRange: (type: number, range: number, opts?: any) => any[];
}

/**
 * Minimal interface for mock creep object
 */
interface MockCreep {
  name: string;
  store: MockStore;
  pos: MockPosition;
  memory: Record<string, unknown>;
}

/**
 * Create a mock creep for testing
 */
function createMockCreep(options: {
  freeCapacity: number;
  usedCapacity: number;
}): Creep {
  const mockCreep: MockCreep = {
    name: "TestUpgrader",
    store: {
      getCapacity: () => options.freeCapacity + options.usedCapacity,
      getFreeCapacity: () => options.freeCapacity,
      getUsedCapacity: () => options.usedCapacity
    },
    pos: {
      findClosestByRange<T>(targets: T[]): T | null {
        return targets.length > 0 ? targets[0] : null;
      },
      findInRange: () => []
    },
    memory: {}
  };
  return mockCreep as unknown as Creep;
}

/**
 * Create a mock spawn for testing
 */
function createMockSpawn(freeCapacity: number): StructureSpawn {
  return {
    id: "mockSpawnId" as Id<StructureSpawn>,
    structureType: STRUCTURE_SPAWN,
    store: {
      getFreeCapacity: () => freeCapacity
    }
  } as unknown as StructureSpawn;
}

/**
 * Create a mock extension for testing
 */
function createMockExtension(freeCapacity: number): StructureExtension {
  return {
    id: "mockExtensionId" as Id<StructureExtension>,
    structureType: STRUCTURE_EXTENSION,
    store: {
      getFreeCapacity: () => freeCapacity
    }
  } as unknown as StructureExtension;
}

/**
 * Create a mock tower for testing
 */
function createMockTower(freeCapacity: number): StructureTower {
  return {
    id: "mockTowerId" as Id<StructureTower>,
    structureType: STRUCTURE_TOWER,
    store: {
      getFreeCapacity: () => freeCapacity
    }
  } as unknown as StructureTower;
}

/**
 * Create a mock controller for testing
 */
function createMockController(): StructureController {
  return {
    id: "mockControllerId" as Id<StructureController>,
    structureType: STRUCTURE_CONTROLLER,
    pos: {
      findInRange: () => []
    }
  } as unknown as StructureController;
}

/**
 * Minimal interface for mock room object
 */
interface MockRoom {
  find: () => never[];
  name: string;
  controller?: StructureController;
}

/**
 * Create a mock room for testing
 */
function createMockRoom(controller?: StructureController): Room {
  const mockRoom: MockRoom = {
    find: () => [],
    name: "E1N1",
    controller
  };
  return mockRoom as unknown as Room;
}

/**
 * Create a mock context for testing upgrader behavior
 */
function createMockContext(
  creep: Creep,
  options: {
    isWorking?: boolean;
    spawnStructures?: (StructureSpawn | StructureExtension)[];
    towers?: StructureTower[];
    controller?: StructureController;
  } = {}
): CreepContext {
  const room = createMockRoom(options.controller);
  (creep as any).room = room;
  if (!(creep.pos as any).getRangeTo) {
    (creep.pos as any).getRangeTo = () => 1;
  }

  const fullMemory: SwarmCreepMemory = {
    role: "upgrader",
    family: "economy",
    homeRoom: "E1N1",
    version: 1,
    working: options.isWorking ?? false
  };

  return {
    creep,
    room,
    memory: fullMemory,
    swarmState: undefined,
    squadMemory: undefined,
    homeRoom: "E1N1",
    isInHomeRoom: true,
    isFull: creep.store.getFreeCapacity() === 0,
    isEmpty: creep.store.getUsedCapacity() === 0,
    isWorking: options.isWorking ?? false,
    assignedSource: null,
    assignedMineral: null,
    energyAvailable: true,
    nearbyEnemies: false,
    constructionSiteCount: 0,
    damagedStructureCount: 0,
    droppedResources: [],
    containers: [],
    depositContainers: [],
    spawnStructures: options.spawnStructures ?? [],
    towers: options.towers ?? [],
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

describe("upgrader behavior - delivery priority before upgrading", () => {
  describe("when upgrader has energy", () => {
    it("should deliver to spawn first when spawn needs energy (before upgrading)", () => {
      const creep = createMockCreep({ freeCapacity: 0, usedCapacity: 50 });
      const spawn = createMockSpawn(100);
      const extension = createMockExtension(50);
      const tower = createMockTower(200);
      const controller = createMockController();

      const ctx = createMockContext(creep, {
        isWorking: true,
        spawnStructures: [spawn, extension],
        towers: [tower],
        controller: controller
      });

      const action = upgrader(ctx);

      assert.equal(action.type, "transfer", "Should transfer to spawn, not upgrade");
      if (action.type === "transfer") {
        assert.equal(action.target, spawn, "Should deliver to spawn first");
        assert.equal(action.resourceType, RESOURCE_ENERGY);
      }
    });

    it("should deliver to extension when spawn is full (before upgrading)", () => {
      const creep = createMockCreep({ freeCapacity: 0, usedCapacity: 50 });
      const extension = createMockExtension(50);
      const tower = createMockTower(200);
      const controller = createMockController();

      const ctx = createMockContext(creep, {
        isWorking: true,
        spawnStructures: [extension],
        towers: [tower],
        controller: controller
      });

      const action = upgrader(ctx);

      assert.equal(action.type, "transfer", "Should transfer to extension, not upgrade");
      if (action.type === "transfer") {
        assert.equal(action.target, extension, "Should deliver to extension when spawn is full");
        assert.equal(action.resourceType, RESOURCE_ENERGY);
      }
    });

    it("should deliver to tower when spawn and extensions are full (before upgrading)", () => {
      const creep = createMockCreep({ freeCapacity: 0, usedCapacity: 50 });
      const tower = createMockTower(200);
      const controller = createMockController();

      const ctx = createMockContext(creep, {
        isWorking: true,
        spawnStructures: [],
        towers: [tower],
        controller: controller
      });

      const action = upgrader(ctx);

      assert.equal(action.type, "transfer", "Should transfer to tower, not upgrade");
      if (action.type === "transfer") {
        assert.equal(action.target, tower, "Should deliver to tower when spawn/extensions are full");
        assert.equal(action.resourceType, RESOURCE_ENERGY);
      }
    });

    it("should upgrade only when spawn, extensions, and towers are all full", () => {
      const creep = createMockCreep({ freeCapacity: 0, usedCapacity: 50 });
      const controller = createMockController();

      const ctx = createMockContext(creep, {
        isWorking: true,
        spawnStructures: [],
        towers: [],
        controller: controller
      });

      const action = upgrader(ctx);

      assert.equal(action.type, "upgrade", "Should upgrade when all critical structures are full");
      if (action.type === "upgrade") {
        assert.equal(action.target, controller, "Should upgrade controller");
      }
    });

    it("should not deliver to towers with less than 100 energy free capacity", () => {
      const creep = createMockCreep({ freeCapacity: 0, usedCapacity: 50 });
      const tower = createMockTower(50); // Only 50 energy free capacity (below threshold)
      const controller = createMockController();

      const ctx = createMockContext(creep, {
        isWorking: true,
        spawnStructures: [],
        towers: [tower],
        controller: controller
      });

      const action = upgrader(ctx);

      // Should skip the tower and go straight to upgrading since tower is above threshold
      assert.equal(action.type, "upgrade", "Should skip tower with < 100 free capacity and upgrade instead");
      if (action.type === "upgrade") {
        assert.equal(action.target, controller, "Should upgrade controller");
      }
    });

    it("should idle when has energy but no controller and no delivery targets", () => {
      const creep = createMockCreep({ freeCapacity: 0, usedCapacity: 50 });

      const ctx = createMockContext(creep, {
        isWorking: true,
        spawnStructures: [],
        towers: [],
        controller: undefined // No controller
      });

      const action = upgrader(ctx);

      assert.equal(action.type, "idle", "Should idle when has energy but no controller and no delivery targets");
    });
  });
});
