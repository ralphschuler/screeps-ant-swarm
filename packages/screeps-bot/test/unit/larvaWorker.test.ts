import { assert } from "chai";
import { larvaWorker } from "@ralphschuler/screeps-roles";
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
    name: "TestLarvaWorker",
    store: {
      getCapacity: () => options.freeCapacity + options.usedCapacity,
      getFreeCapacity: () => options.freeCapacity,
      getUsedCapacity: () => options.usedCapacity
    },
    pos: {
      findClosestByRange<T>(targets: T[]): T | null {
        return targets.length > 0 ? targets[0] : null;
      }
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
 * Create a mock storage for testing
 */
function createMockStorage(freeCapacity: number, usedCapacity: number = 10000): StructureStorage {
  return {
    id: "mockStorageId" as Id<StructureStorage>,
    structureType: STRUCTURE_STORAGE,
    store: {
      getFreeCapacity: () => freeCapacity,
      getUsedCapacity: () => usedCapacity
    }
  } as unknown as StructureStorage;
}

/**
 * Create a mock container for testing
 */
function createMockContainer(freeCapacity: number, usedCapacity: number = 0): StructureContainer {
  return {
    id: "mockContainerId" as Id<StructureContainer>,
    structureType: STRUCTURE_CONTAINER,
    store: {
      getFreeCapacity: () => freeCapacity,
      getUsedCapacity: () => usedCapacity
    }
  } as unknown as StructureContainer;
}

/**
 * Create a mock controller for testing
 */
function createMockController(): StructureController {
  return {
    id: "mockControllerId" as Id<StructureController>,
    structureType: STRUCTURE_CONTROLLER
  } as unknown as StructureController;
}

/**
 * Create a mock construction site for testing
 */
function createMockConstructionSite(): ConstructionSite {
  return {
    id: "mockSiteId" as Id<ConstructionSite>,
    structureType: STRUCTURE_EXTENSION
  } as unknown as ConstructionSite;
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
 * Create a mock context for testing larvaWorker behavior
 */
function createMockContext(
  creep: Creep,
  options: {
    isWorking?: boolean;
    spawnStructures?: (StructureSpawn | StructureExtension)[];
    towers?: StructureTower[];
    storage?: StructureStorage;
    depositContainers?: StructureContainer[];
    controller?: StructureController;
    prioritizedSites?: ConstructionSite[];
  } = {}
): CreepContext {
  const room = createMockRoom(options.controller);
  (creep as any).room = room;
  if (!(creep.pos as any).getRangeTo) {
    (creep.pos as any).getRangeTo = () => 1;
  }

  const fullMemory: SwarmCreepMemory = {
    role: "larvaWorker",
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
    constructionSiteCount: options.prioritizedSites?.length ?? 0,
    damagedStructureCount: 0,
    droppedResources: [],
    containers: [],
    depositContainers: options.depositContainers ?? [],
    spawnStructures: options.spawnStructures ?? [],
    towers: options.towers ?? [],
    storage: options.storage,
    terminal: undefined,
    hostiles: [],
    damagedAllies: [],
    prioritizedSites: options.prioritizedSites ?? [],
    repairTargets: [],
    labs: [],
    factory: undefined,
    tombstones: [],
    mineralContainers: []
  };
}

describe("larvaWorker behavior - working state initialization", () => {
  describe("when working state is undefined", () => {
    it("should initialize working=true when creep has partial energy", () => {
      const creep = createMockCreep({ freeCapacity: 50, usedCapacity: 50 }); // Partial energy
      const spawn = createMockSpawn(100);
      
      // Create context without isWorking set (simulating undefined state)
      const ctx = createMockContext(creep, {
        isWorking: undefined,
        spawnStructures: [spawn]
      });
      
      // Memory working should be undefined initially
      ctx.memory.working = undefined;

      const action = larvaWorker(ctx);

      // Creep should recognize it has energy and start working (delivering)
      assert.equal(action.type, "transfer", "Creep with partial energy should deliver, not collect");
      if (action.type === "transfer") {
        assert.equal(action.target, spawn, "Should deliver to spawn");
      }
      // Working state should now be true
      assert.equal(ctx.memory.working, true, "Working state should be initialized to true for creep with energy");
    });

    it("should initialize working=false when creep is empty", () => {
      const creep = createMockCreep({ freeCapacity: 100, usedCapacity: 0 }); // Empty
      
      const ctx = createMockContext(creep, {
        isWorking: undefined
      });
      
      // Memory working should be undefined initially
      ctx.memory.working = undefined;

      const action = larvaWorker(ctx);

      // Creep should recognize it's empty and start collecting
      assert.notEqual(action.type, "transfer", "Empty creep should not try to deliver");
      // Working state should now be false
      assert.equal(ctx.memory.working, false, "Working state should be initialized to false for empty creep");
    });
  });
});

describe("larvaWorker behavior - delivery priority", () => {
  describe("when larvaWorker has energy to deliver", () => {
    it("should deliver to spawn first when spawn needs energy", () => {
      const creep = createMockCreep({ freeCapacity: 0, usedCapacity: 50 });
      const spawn = createMockSpawn(100);
      const extension = createMockExtension(50);
      const tower = createMockTower(200);
      const storage = createMockStorage(10000);

      const ctx = createMockContext(creep, {
        isWorking: true,
        spawnStructures: [spawn, extension],
        towers: [tower],
        storage: storage
      });

      const action = larvaWorker(ctx);

      assert.equal(action.type, "transfer");
      if (action.type === "transfer") {
        assert.equal(action.target, spawn, "Should deliver to spawn first");
      }
    });

    it("should deliver to extension when spawn is full", () => {
      const creep = createMockCreep({ freeCapacity: 0, usedCapacity: 50 });
      const extension = createMockExtension(50);
      const tower = createMockTower(200);
      const storage = createMockStorage(10000);

      const ctx = createMockContext(creep, {
        isWorking: true,
        spawnStructures: [extension],
        towers: [tower],
        storage: storage
      });

      const action = larvaWorker(ctx);

      assert.equal(action.type, "transfer");
      if (action.type === "transfer") {
        assert.equal(action.target, extension, "Should deliver to extension when spawn is full");
      }
    });

    it("should deliver to tower when spawn and extensions are full", () => {
      const creep = createMockCreep({ freeCapacity: 0, usedCapacity: 50 });
      const tower = createMockTower(200);
      const storage = createMockStorage(10000);

      const ctx = createMockContext(creep, {
        isWorking: true,
        spawnStructures: [],
        towers: [tower],
        storage: storage
      });

      const action = larvaWorker(ctx);

      assert.equal(action.type, "transfer");
      if (action.type === "transfer") {
        assert.equal(action.target, tower, "Should deliver to tower when spawn/extensions are full");
      }
    });

    it("should haul to storage when spawn, extensions, and towers are full", () => {
      const creep = createMockCreep({ freeCapacity: 0, usedCapacity: 50 });
      const storage = createMockStorage(10000);
      const controller = createMockController();
      const site = createMockConstructionSite();

      const ctx = createMockContext(creep, {
        isWorking: true,
        spawnStructures: [],
        towers: [],
        storage: storage,
        controller: controller,
        prioritizedSites: [site]
      });

      const action = larvaWorker(ctx);

      assert.equal(action.type, "transfer");
      if (action.type === "transfer") {
        assert.equal(action.target, storage, "Should haul to storage when spawn/extensions/towers are full");
        assert.equal(action.resourceType, RESOURCE_ENERGY);
      }
    });

    it("should deliver to containers when spawn/extensions/towers/storage are full", () => {
      const creep = createMockCreep({ freeCapacity: 0, usedCapacity: 50 });
      const storage = createMockStorage(0); // Full storage
      const container = createMockContainer(1000); // Container with space
      const controller = createMockController();
      const site = createMockConstructionSite();

      const ctx = createMockContext(creep, {
        isWorking: true,
        spawnStructures: [],
        towers: [],
        storage: storage,
        depositContainers: [container],
        controller: controller,
        prioritizedSites: [site]
      });

      const action = larvaWorker(ctx);

      assert.equal(action.type, "transfer");
      if (action.type === "transfer") {
        assert.equal(action.target, container, "Should deliver to container when spawn/extensions/towers/storage are full");
        assert.equal(action.resourceType, RESOURCE_ENERGY);
      }
    });

    it("should build when spawn/extensions/towers are full and storage is full", () => {
      const creep = createMockCreep({ freeCapacity: 0, usedCapacity: 50 });
      const storage = createMockStorage(0); // Full storage
      const site = createMockConstructionSite();
      const controller = createMockController();

      const ctx = createMockContext(creep, {
        isWorking: true,
        spawnStructures: [],
        towers: [],
        storage: storage,
        prioritizedSites: [site],
        controller: controller
      });

      const action = larvaWorker(ctx);

      assert.equal(action.type, "build");
      if (action.type === "build") {
        assert.equal(action.target, site, "Should build when storage is full");
      }
    });

    it("should upgrade when spawn/extensions/towers/storage are full and no construction sites", () => {
      const creep = createMockCreep({ freeCapacity: 0, usedCapacity: 50 });
      const storage = createMockStorage(0); // Full storage
      const controller = createMockController();

      const ctx = createMockContext(creep, {
        isWorking: true,
        spawnStructures: [],
        towers: [],
        storage: storage,
        prioritizedSites: [],
        controller: controller
      });

      const action = larvaWorker(ctx);

      assert.equal(action.type, "upgrade");
      if (action.type === "upgrade") {
        assert.equal(action.target, controller, "Should upgrade when storage is full and no construction sites");
      }
    });

    it("should build when no storage exists (early game)", () => {
      const creep = createMockCreep({ freeCapacity: 0, usedCapacity: 50 });
      const site = createMockConstructionSite();
      const controller = createMockController();

      const ctx = createMockContext(creep, {
        isWorking: true,
        spawnStructures: [],
        towers: [],
        storage: undefined, // No storage (early game)
        prioritizedSites: [site],
        controller: controller
      });

      const action = larvaWorker(ctx);

      assert.equal(action.type, "build");
      if (action.type === "build") {
        assert.equal(action.target, site, "Should build when no storage exists");
      }
    });

    it("should upgrade when no storage exists and no construction sites", () => {
      const creep = createMockCreep({ freeCapacity: 0, usedCapacity: 50 });
      const controller = createMockController();

      const ctx = createMockContext(creep, {
        isWorking: true,
        spawnStructures: [],
        towers: [],
        storage: undefined, // No storage (early game)
        prioritizedSites: [],
        controller: controller
      });

      const action = larvaWorker(ctx);

      assert.equal(action.type, "upgrade");
      if (action.type === "upgrade") {
        assert.equal(action.target, controller, "Should upgrade when no storage exists and no construction sites");
      }
    });

    it("should switch to collection mode when has energy but no targets and no controller", () => {
      const creep = createMockCreep({ freeCapacity: 50, usedCapacity: 50 }); // Has partial energy
      const mockRoom = createMockRoom(undefined); // No controller
      
      const ctx = createMockContext(creep, {
        isWorking: true,
        spawnStructures: [],
        towers: [],
        storage: undefined,
        prioritizedSites: [],
        controller: undefined // No controller
      });
      
      // Mock room.find to return empty sources for findEnergy fallback
      (mockRoom as any).find = () => [];
      (creep as any).room = mockRoom;

      const action = larvaWorker(ctx);

      // Should switch to collection mode and call findEnergy
      // Since there are no energy sources, it will return idle
      // But the important part is that working state was switched to false
      assert.equal(ctx.memory.working, false, "Should switch working state to false");
    });
  });
});
