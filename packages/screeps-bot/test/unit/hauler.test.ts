import { assert } from "chai";
import { hauler } from "@ralphschuler/screeps-roles";
import { remoteHauler } from "@ralphschuler/screeps-roles";
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
}

/**
 * Create a mock creep for testing
 */
function createMockCreep(options: {
  freeCapacity: number;
  usedCapacity: number;
}): Creep {
  const mockCreep: MockCreep = {
    name: "TestHauler",
    store: {
      getCapacity: () => options.freeCapacity + options.usedCapacity,
      getFreeCapacity: () => options.freeCapacity,
      getUsedCapacity: () => options.usedCapacity
    },
    pos: {
      findClosestByRange<T>(targets: T[]): T | null {
        return targets.length > 0 ? targets[0] : null;
      }
    }
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
function createMockContainer(freeCapacity: number): StructureContainer {
  return {
    id: "mockContainerId" as Id<StructureContainer>,
    structureType: STRUCTURE_CONTAINER,
    store: {
      getFreeCapacity: () => freeCapacity,
      getUsedCapacity: () => 500
    }
  } as unknown as StructureContainer;
}

/**
 * Minimal interface for mock room object
 */
interface MockRoom {
  find: () => never[];
  name: string;
}

/**
 * Create a mock room for testing
 */
function createMockRoom(): Room {
  const mockRoom: MockRoom = {
    find: () => [],
    name: "E1N1"
  };
  return mockRoom as unknown as Room;
}

/**
 * Create a mock context for testing hauler behavior
 */
function createMockContext(
  creep: Creep,
  options: {
    isWorking?: boolean;
    spawnStructures?: (StructureSpawn | StructureExtension)[];
    towers?: StructureTower[];
    storage?: StructureStorage;
    depositContainers?: StructureContainer[];
    containers?: StructureContainer[];
    droppedResources?: Resource[];
  } = {}
): CreepContext {
  const room = createMockRoom();
  // Attach minimal room and range helpers to creep for distributed target logic
  (creep as any).room = room;
  if (!(creep.pos as any).getRangeTo) {
    (creep.pos as any).getRangeTo = () => 1;
  }

  const fullMemory: SwarmCreepMemory = {
    role: "hauler",
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
    droppedResources: options.droppedResources ?? [],
    containers: options.containers ?? [],
    depositContainers: options.depositContainers ?? [],
    spawnStructures: options.spawnStructures ?? [],
    towers: options.towers ?? [],
    storage: options.storage,
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

describe("hauler behavior - delivery priority", () => {
  describe("when hauler has energy to deliver", () => {
    it("should deliver to spawn first when spawn needs energy", () => {
      const creep = createMockCreep({ freeCapacity: 0, usedCapacity: 50 });
      const spawn = createMockSpawn(100);
      const extension = createMockExtension(50);
      const tower = createMockTower(200);
      const storage = createMockStorage(10000);
      const container = createMockContainer(500);

      const ctx = createMockContext(creep, {
        isWorking: true,
        spawnStructures: [spawn, extension],
        towers: [tower],
        storage: storage,
        depositContainers: [container]
      });

      const action = hauler(ctx);

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
      const container = createMockContainer(500);

      const ctx = createMockContext(creep, {
        isWorking: true,
        spawnStructures: [extension], // No spawn with free capacity
        towers: [tower],
        storage: storage,
        depositContainers: [container]
      });

      const action = hauler(ctx);

      assert.equal(action.type, "transfer");
      if (action.type === "transfer") {
        assert.equal(action.target, extension, "Should deliver to extension when spawn is full");
      }
    });

    it("should deliver to tower when spawn and extensions are full", () => {
      const creep = createMockCreep({ freeCapacity: 0, usedCapacity: 50 });
      const tower = createMockTower(200);
      const storage = createMockStorage(10000);
      const container = createMockContainer(500);

      const ctx = createMockContext(creep, {
        isWorking: true,
        spawnStructures: [], // No spawns or extensions with free capacity
        towers: [tower],
        storage: storage,
        depositContainers: [container]
      });

      const action = hauler(ctx);

      assert.equal(action.type, "transfer");
      if (action.type === "transfer") {
        assert.equal(action.target, tower, "Should deliver to tower when spawn/extensions are full");
      }
    });

    it("should deliver to storage when spawn, extensions, and towers are full", () => {
      const creep = createMockCreep({ freeCapacity: 0, usedCapacity: 50 });
      const storage = createMockStorage(10000);
      const container = createMockContainer(500);

      const ctx = createMockContext(creep, {
        isWorking: true,
        spawnStructures: [],
        towers: [],
        storage: storage,
        depositContainers: [container]
      });

      const action = hauler(ctx);

      assert.equal(action.type, "transfer");
      if (action.type === "transfer") {
        assert.equal(action.target, storage, "Should deliver to storage when higher priority targets are full");
      }
    });

    it("should deliver to container when all other options are full/unavailable", () => {
      const creep = createMockCreep({ freeCapacity: 0, usedCapacity: 50 });
      const container = createMockContainer(500);

      const ctx = createMockContext(creep, {
        isWorking: true,
        spawnStructures: [],
        towers: [],
        storage: undefined,
        depositContainers: [container]
      });

      const action = hauler(ctx);

      assert.equal(action.type, "transfer");
      if (action.type === "transfer") {
        assert.equal(action.target, container, "Should deliver to container as last resort");
      }
    });

    it("should return idle when no delivery targets are available", () => {
      const creep = createMockCreep({ freeCapacity: 0, usedCapacity: 50 });

      const ctx = createMockContext(creep, {
        isWorking: true,
        spawnStructures: [],
        towers: [],
        storage: undefined,
        depositContainers: []
      });

      const action = hauler(ctx);

      assert.equal(action.type, "idle");
    });
  });

  describe("when hauler is collecting energy", () => {
    it("should collect from dropped resources first", () => {
      const creep = createMockCreep({ freeCapacity: 50, usedCapacity: 0 });
      const droppedResource = { resourceType: RESOURCE_ENERGY, amount: 100 } as Resource;
      const container = createMockContainer(100);

      const ctx = createMockContext(creep, {
        isWorking: false,
        droppedResources: [droppedResource],
        containers: [container]
      });

      const action = hauler(ctx);

      assert.equal(action.type, "pickup");
    });

    it("should collect from containers when no dropped resources", () => {
      const creep = createMockCreep({ freeCapacity: 50, usedCapacity: 0 });
      const container = createMockContainer(100);

      const ctx = createMockContext(creep, {
        isWorking: false,
        droppedResources: [],
        containers: [container]
      });

      const action = hauler(ctx);

      assert.equal(action.type, "withdraw");
    });

    it("should collect from storage when no dropped resources or containers", () => {
      const creep = createMockCreep({ freeCapacity: 50, usedCapacity: 0 });
      const storage = createMockStorage(5000);

      const ctx = createMockContext(creep, {
        isWorking: false,
        droppedResources: [],
        containers: [],
        storage: storage
      });

      const action = hauler(ctx);

      assert.equal(action.type, "withdraw");
      if (action.type === "withdraw") {
        assert.equal(action.target, storage, "Should collect from storage when containers are empty");
      }
    });
  });
});

describe("remoteHauler behavior - delivery priority", () => {
  describe("when in home room with energy to deliver", () => {
    it("should deliver to spawn first when spawn needs energy", () => {
      const creep = createMockCreep({ freeCapacity: 0, usedCapacity: 50 });
      const spawn = createMockSpawn(100);
      const extension = createMockExtension(50);
      const tower = createMockTower(200);
      const storage = createMockStorage(10000);

      const fullMemory: SwarmCreepMemory = {
        role: "remoteHauler",
        family: "economy",
        homeRoom: "E1N1",
        targetRoom: "E2N1", // Remote room assignment
        version: 1,
        working: true
      };

      const mockRoom = createMockRoom();
      const ctx: CreepContext = {
        creep,
        room: mockRoom,
        memory: fullMemory,
        swarmState: undefined,
        squadMemory: undefined,
        homeRoom: "E1N1",
        isInHomeRoom: true,
        isFull: true,
        isEmpty: false,
        isWorking: true,
        assignedSource: null,
        assignedMineral: null,
        energyAvailable: true,
        nearbyEnemies: false,
        constructionSiteCount: 0,
        damagedStructureCount: 0,
        droppedResources: [],
        containers: [],
        depositContainers: [],
        spawnStructures: [spawn, extension],
        towers: [tower],
        storage: storage,
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

      const action = remoteHauler(ctx);

      assert.equal(action.type, "transfer");
      if (action.type === "transfer") {
        assert.equal(action.target, spawn, "Remote hauler should deliver to spawn first");
      }
    });

    it("should deliver to storage when spawn/extensions/towers are full", () => {
      const creep = createMockCreep({ freeCapacity: 0, usedCapacity: 50 });
      const storage = createMockStorage(10000);

      const fullMemory: SwarmCreepMemory = {
        role: "remoteHauler",
        family: "economy",
        homeRoom: "E1N1",
        targetRoom: "E2N1", // Remote room assignment
        version: 1,
        working: true
      };

      const mockRoom = createMockRoom();
      const ctx: CreepContext = {
        creep,
        room: mockRoom,
        memory: fullMemory,
        swarmState: undefined,
        squadMemory: undefined,
        homeRoom: "E1N1",
        isInHomeRoom: true,
        isFull: true,
        isEmpty: false,
        isWorking: true,
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
        storage: storage,
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

      const action = remoteHauler(ctx);

      assert.equal(action.type, "transfer");
      if (action.type === "transfer") {
        assert.equal(action.target, storage, "Remote hauler should deliver to storage when higher priority targets full");
      }
    });
  });

  describe("when remote hauler has no valid targetRoom", () => {
    it("should idle when targetRoom is undefined", () => {
      const creep = createMockCreep({ freeCapacity: 50, usedCapacity: 0 });

      const fullMemory: SwarmCreepMemory = {
        role: "remoteHauler",
        family: "economy",
        homeRoom: "E1N1",
        version: 1,
        working: false
        // Note: targetRoom is intentionally undefined
      };

      const mockRoom = createMockRoom();
      const ctx: CreepContext = {
        creep,
        room: mockRoom,
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

      const action = remoteHauler(ctx);

      assert.equal(action.type, "idle", "Remote hauler without targetRoom should idle");
    });

    it("should idle when targetRoom equals homeRoom", () => {
      const creep = createMockCreep({ freeCapacity: 50, usedCapacity: 0 });

      const fullMemory: SwarmCreepMemory = {
        role: "remoteHauler",
        family: "economy",
        homeRoom: "E1N1",
        targetRoom: "E1N1", // Same as homeRoom - invalid assignment
        version: 1,
        working: false
      };

      const mockRoom = createMockRoom();
      const ctx: CreepContext = {
        creep,
        room: mockRoom,
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

      const action = remoteHauler(ctx);

      assert.equal(action.type, "idle", "Remote hauler with targetRoom same as homeRoom should idle");
    });

    it("should idle when full but has no valid targetRoom", () => {
      const creep = createMockCreep({ freeCapacity: 0, usedCapacity: 50 });

      const fullMemory: SwarmCreepMemory = {
        role: "remoteHauler",
        family: "economy",
        homeRoom: "E1N1",
        version: 1,
        working: true
        // Note: targetRoom is intentionally undefined
      };

      const mockRoom = createMockRoom();
      const ctx: CreepContext = {
        creep,
        room: mockRoom,
        memory: fullMemory,
        swarmState: undefined,
        squadMemory: undefined,
        homeRoom: "E1N1",
        isInHomeRoom: true,
        isFull: true,
        isEmpty: false,
        isWorking: true,
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

      const action = remoteHauler(ctx);

      assert.equal(action.type, "idle", "Remote hauler with energy but no targetRoom should idle instead of delivering locally");
    });
  });
});
