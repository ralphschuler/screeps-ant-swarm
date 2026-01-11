import { assert } from "chai";
import { evaluateWithStateMachine } from "@ralphschuler/screeps-roles";
import type { CreepContext, CreepAction } from "@ralphschuler/screeps-roles";
import type { SwarmCreepMemory, CreepState } from "../../src/memory/schemas";

/**
 * Mock objects for testing
 */
interface MockStore {
  getCapacity: () => number | null;
  getFreeCapacity: () => number | null;
  getUsedCapacity: () => number;
}

interface MockPosition {
  x: number;
  y: number;
  roomName: string;
  inRangeTo: (target: { pos: RoomPosition } | RoomPosition, range: number) => boolean;
  isNearTo: (target: unknown) => boolean;
}

interface MockCreep {
  name: string;
  store: MockStore;
  pos: MockPosition;
}

interface MockRoom {
  name: string;
  find: () => never[];
}

/**
 * Create a mock creep for testing
 */
function createMockCreep(options: {
  name?: string;
  capacity: number | null;
  usedCapacity: number;
  inRange?: boolean;
  x?: number;
  y?: number;
  roomName?: string;
}): Creep {
  const freeCapacity = options.capacity === null ? null : options.capacity - options.usedCapacity;
  const mockCreep: MockCreep = {
    name: options.name ?? "TestCreep",
    store: {
      getCapacity: () => options.capacity,
      getFreeCapacity: () => freeCapacity,
      getUsedCapacity: () => options.usedCapacity
    },
    pos: {
      x: options.x ?? 25,
      y: options.y ?? 25,
      roomName: options.roomName ?? "E1N1",
      inRangeTo: () => options.inRange ?? false,
      isNearTo: () => options.inRange ?? false
    }
  };
  return mockCreep as unknown as Creep;
}

/**
 * Create a mock room for testing
 */
function createMockRoom(name: string = "E1N1"): Room {
  const mockRoom: MockRoom = {
    name,
    find: () => []
  };
  return mockRoom as unknown as Room;
}

/**
 * Create a mock source for testing
 */
function createMockSource(id: string = "source1"): Source {
  return {
    id: id as Id<Source>,
    energy: 3000,
    pos: { x: 25, y: 25, roomName: "E1N1" } as RoomPosition,
    room: createMockRoom()
  } as unknown as Source;
}

/**
 * Setup Game.getObjectById mock
 */
function setupGameMock(objects: Record<string, unknown>): void {
  (global as any).Game = {
    time: 1000,
    getObjectById: (id: Id<any>) => objects[id] ?? null
  };
}

/**
 * Create a mock context for testing
 */
function createMockContext(
  creep: Creep,
  memory: Partial<SwarmCreepMemory> = {},
  options: Partial<CreepContext> = {}
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
    mineralContainers: [],
    ...options
  };
}

describe("State Machine", () => {
  beforeEach(() => {
    // Setup Game mock
    setupGameMock({});
  });

  describe("evaluateWithStateMachine", () => {
    it("should evaluate new action when no state exists", () => {
      const creep = createMockCreep({ capacity: 50, usedCapacity: 0 });
      const ctx = createMockContext(creep);

      const behaviorFn = (ctx: CreepContext): CreepAction => {
        return { type: "idle" };
      };

      const action = evaluateWithStateMachine(ctx, behaviorFn);

      assert.equal(action.type, "idle");
      assert.isUndefined(ctx.memory.state, "Idle actions should not create state");
    });

    it("should store state for non-idle actions", () => {
      const source = createMockSource();
      setupGameMock({ source1: source });

      const creep = createMockCreep({ capacity: 50, usedCapacity: 0 });
      const ctx = createMockContext(creep);

      const behaviorFn = (): CreepAction => {
        return { type: "harvest", target: source };
      };

      const action = evaluateWithStateMachine(ctx, behaviorFn);

      assert.equal(action.type, "harvest");
      assert.isDefined(ctx.memory.state);
      assert.equal(ctx.memory.state?.action, "harvest");
      assert.equal(ctx.memory.state?.targetId, source.id);
    });

    it("should continue existing state when valid and incomplete", () => {
      const source = createMockSource();
      setupGameMock({ source1: source });

      const creep = createMockCreep({ capacity: 50, usedCapacity: 25 });
      const existingState: CreepState = {
        action: "harvest",
        targetId: source.id,
        startTick: 995,
        timeout: 50
      };

      const ctx = createMockContext(creep, { state: existingState });

      let behaviorCalled = false;
      const behaviorFn = (): CreepAction => {
        behaviorCalled = true;
        return { type: "idle" };
      };

      const action = evaluateWithStateMachine(ctx, behaviorFn);

      assert.equal(action.type, "harvest");
      assert.isFalse(behaviorCalled, "Behavior should not be called when continuing existing state");
      assert.isDefined(ctx.memory.state, "State should still exist");
    });

    it("should re-evaluate when state is complete (creep is full)", () => {
      const source = createMockSource();
      setupGameMock({ source1: source });

      const creep = createMockCreep({ capacity: 50, usedCapacity: 50 });
      const existingState: CreepState = {
        action: "harvest",
        targetId: source.id,
        startTick: 995,
        timeout: 50
      };

      const ctx = createMockContext(creep, { state: existingState });
      ctx.isFull = true;

      let behaviorCalled = false;
      const behaviorFn = (): CreepAction => {
        behaviorCalled = true;
        return { type: "idle" };
      };

      const action = evaluateWithStateMachine(ctx, behaviorFn);

      assert.equal(action.type, "idle");
      assert.isTrue(behaviorCalled, "Behavior should be called when state is complete");
      assert.isUndefined(ctx.memory.state, "State should be cleared after completion");
    });

    it("should re-evaluate when state target no longer exists", () => {
      const creep = createMockCreep({ capacity: 50, usedCapacity: 25 });
      const existingState: CreepState = {
        action: "harvest",
        targetId: "nonexistent" as Id<Source>,
        startTick: 995,
        timeout: 50
      };

      setupGameMock({}); // No objects exist

      const ctx = createMockContext(creep, { state: existingState });

      let behaviorCalled = false;
      const behaviorFn = (): CreepAction => {
        behaviorCalled = true;
        return { type: "idle" };
      };

      const action = evaluateWithStateMachine(ctx, behaviorFn);

      assert.equal(action.type, "idle");
      assert.isTrue(behaviorCalled, "Behavior should be called when target doesn't exist");
      assert.isUndefined(ctx.memory.state, "Invalid state should be cleared");
    });

    it("should re-evaluate when state has expired (timeout)", () => {
      const source = createMockSource();
      setupGameMock({ source1: source });

      const creep = createMockCreep({ capacity: 50, usedCapacity: 25 });
      const existingState: CreepState = {
        action: "harvest",
        targetId: source.id,
        startTick: 900, // 100 ticks ago
        timeout: 50 // Should have expired 50 ticks ago
      };

      const ctx = createMockContext(creep, { state: existingState });

      let behaviorCalled = false;
      const behaviorFn = (): CreepAction => {
        behaviorCalled = true;
        return { type: "idle" };
      };

      const action = evaluateWithStateMachine(ctx, behaviorFn);

      assert.equal(action.type, "idle");
      assert.isTrue(behaviorCalled, "Behavior should be called when state has expired");
      assert.isUndefined(ctx.memory.state, "Expired state should be cleared");
    });

    it("should complete transfer action when creep is empty", () => {
      const storage = {
        id: "storage1" as Id<StructureStorage>,
        pos: { x: 25, y: 25, roomName: "E1N1" } as RoomPosition,
        room: createMockRoom()
      } as unknown as StructureStorage;

      setupGameMock({ storage1: storage });

      const creep = createMockCreep({ capacity: 50, usedCapacity: 0 });
      const existingState: CreepState = {
        action: "transfer",
        targetId: storage.id,
        startTick: 995,
        timeout: 50,
        data: { resourceType: RESOURCE_ENERGY }
      };

      const ctx = createMockContext(creep, { state: existingState });
      ctx.isEmpty = true;

      const behaviorFn = (): CreepAction => {
        return { type: "idle" };
      };

      const action = evaluateWithStateMachine(ctx, behaviorFn);

      assert.equal(action.type, "idle");
      assert.isUndefined(ctx.memory.state, "Transfer state should complete when empty");
    });

    it("should complete moveToRoom action when in target room", () => {
      const creep = createMockCreep({ capacity: 50, usedCapacity: 0 });
      const existingState: CreepState = {
        action: "moveToRoom",
        targetRoom: "E2N2",
        startTick: 995,
        timeout: 100
      };

      const ctx = createMockContext(creep, { state: existingState });
      ctx.room = createMockRoom("E2N2");

      const behaviorFn = (): CreepAction => {
        return { type: "idle" };
      };

      const action = evaluateWithStateMachine(ctx, behaviorFn);

      assert.equal(action.type, "idle");
      assert.isUndefined(ctx.memory.state, "MoveToRoom state should complete when in target room");
    });

    it("should store resource type data for withdraw actions", () => {
      const storage = {
        id: "storage1" as Id<StructureStorage>,
        pos: { x: 25, y: 25, roomName: "E1N1" } as RoomPosition,
        room: createMockRoom()
      } as unknown as StructureStorage;

      setupGameMock({ storage1: storage });

      const creep = createMockCreep({ capacity: 50, usedCapacity: 0 });
      const ctx = createMockContext(creep);

      const behaviorFn = (): CreepAction => {
        return { type: "withdraw", target: storage, resourceType: RESOURCE_ENERGY };
      };

      const action = evaluateWithStateMachine(ctx, behaviorFn);

      assert.equal(action.type, "withdraw");
      assert.isDefined(ctx.memory.state);
      assert.equal(ctx.memory.state?.data?.resourceType, RESOURCE_ENERGY);
    });

    it("should evaluate behavior normally when creep is in home room", () => {
      const creep = createMockCreep({ capacity: 50, usedCapacity: 0, roomName: "E1N1" });
      const ctx = createMockContext(creep, {
        role: "scout",
        targetRoom: "E2N2",
        lastExploredRoom: "E1N2"
      });
      ctx.homeRoom = "E1N1";
      ctx.isInHomeRoom = true;

      const behaviorFn = (): CreepAction => {
        return { type: "idle" };
      };

      const action = evaluateWithStateMachine(ctx, behaviorFn);

      assert.equal(action.type, "idle");
      // Memory should be preserved - no automatic clearing
      assert.equal(ctx.memory.targetRoom, "E2N2", "Scout targetRoom should be preserved");
      assert.equal(ctx.memory.lastExploredRoom, "E1N2", "Scout lastExploredRoom should be preserved");
    });

    it("should evaluate behavior normally regardless of role", () => {
      const creep = createMockCreep({ capacity: 50, usedCapacity: 0, roomName: "E1N1" });
      const ctx = createMockContext(creep, {
        role: "harvester",
        targetRoom: "E2N2"
      });
      ctx.homeRoom = "E1N1";
      ctx.isInHomeRoom = true;

      const behaviorFn = (): CreepAction => {
        return { type: "idle" };
      };

      const action = evaluateWithStateMachine(ctx, behaviorFn);

      assert.equal(action.type, "idle");
      assert.equal(ctx.memory.targetRoom, "E2N2", "targetRoom should be preserved");
    });

    it("should call behavior function when creep is in remote room", () => {
      const creep = createMockCreep({ capacity: 50, usedCapacity: 0, roomName: "E2N2" });
      const ctx = createMockContext(creep, {
        role: "scout",
        targetRoom: "E2N2"
      });
      ctx.homeRoom = "E1N1";
      ctx.isInHomeRoom = false;
      ctx.room = createMockRoom("E2N2");

      let behaviorCalled = false;
      const behaviorFn = (): CreepAction => {
        behaviorCalled = true;
        return { type: "idle" };
      };

      const action = evaluateWithStateMachine(ctx, behaviorFn);

      // Should call behavior function, not automatically return home
      assert.isTrue(behaviorCalled, "Behavior function should be called");
      assert.equal(action.type, "idle");
      assert.equal(ctx.memory.targetRoom, "E2N2", "targetRoom should be preserved");
    });
  });
});
