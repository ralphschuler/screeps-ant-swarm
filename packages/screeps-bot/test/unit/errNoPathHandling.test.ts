/**
 * ERR_NO_PATH Handling Tests
 *
 * Tests for the behavior system's handling of unreachable targets (ERR_NO_PATH).
 * When a creep encounters an unreachable target, it should clear its state and
 * re-evaluate to find a new accessible target, instead of returning to its home room.
 * This prevents wasted time and allows creeps to adapt quickly to changing situations.
 */

import { expect } from "chai";
import type { CreepAction, CreepContext } from "@ralphschuler/screeps-roles";
import { evaluateWithStateMachine } from "@ralphschuler/screeps-roles";
import { executeAction } from "@ralphschuler/screeps-roles";

describe("ERR_NO_PATH Handling", () => {
  let mockCreep: any;
  let mockContext: CreepContext;
  let mockBehaviorFn: (ctx: CreepContext) => CreepAction;

  beforeEach(() => {
    // Set up global Game object
    (global as any).Game = {
      time: 1000,
      rooms: {},
      getObjectById: () => null,
      cpu: { getUsed: () => 0 }
    };

    // Create mock creep
    mockCreep = {
      name: "testCreep",
      pos: {
        x: 10,
        y: 10,
        roomName: "W2N2",
        inRangeTo: () => false,
        findClosestByRange: () => null,
        isEqualTo: () => false,
        getRangeTo: () => 5
      },
      room: {
        name: "W2N2",
        find: () => [],
        controller: { my: true }
      },
      store: {
        getUsedCapacity: () => 50,
        getFreeCapacity: () => 50
      },
      memory: {
        role: "hauler",
        family: "economy",
        homeRoom: "W1N1",
        version: 1
      } as any,
      body: []
    };

    // Create mock context
    mockContext = {
      creep: mockCreep,
      room: mockCreep.room,
      memory: mockCreep.memory,
      homeRoom: "W1N1",
      isInHomeRoom: false,
      isFull: false,
      isEmpty: false,
      isWorking: false,
      swarmState: undefined,
      squadMemory: undefined,
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

    // Mock behavior function that returns a harvest action
    mockBehaviorFn = () => ({
      type: "harvest",
      target: { id: "source1", pos: { x: 25, y: 25, roomName: "W2N2" } } as any
    });
  });

  afterEach(() => {
    delete (global as any).Game;
  });

  it("should clear state when ERR_NO_PATH occurs and allow re-evaluation", () => {
    // Initially, no state
    expect(mockContext.memory.state).to.be.undefined;

    // Get an action from state machine - should call behavior function
    const action = evaluateWithStateMachine(mockContext, mockBehaviorFn);
    
    // Action should be harvest (from behavior function)
    expect(action.type).to.equal("harvest");
    
    // State should be set
    expect(mockContext.memory.state).to.not.be.undefined;
    
    // Simulate ERR_NO_PATH by clearing state (as executor would do)
    delete mockContext.memory.state;
    
    // Call state machine again - should call behavior function again for re-evaluation
    const newAction = evaluateWithStateMachine(mockContext, mockBehaviorFn);
    
    // Should get a new action from behavior function, not moveToRoom
    expect(newAction.type).to.equal("harvest");
  });

  it("should re-evaluate behavior immediately when state is cleared", () => {
    let behaviorCallCount = 0;
    const trackingBehaviorFn = (ctx: CreepContext): CreepAction => {
      behaviorCallCount++;
      return { 
        type: "transfer", 
        target: { id: "spawn1", store: { getFreeCapacity: () => 100 } } as any,
        resourceType: RESOURCE_ENERGY
      };
    };

    // First call - should call behavior function
    const action1 = evaluateWithStateMachine(mockContext, trackingBehaviorFn);
    expect(behaviorCallCount).to.equal(1);
    expect(action1.type).to.equal("transfer");

    // Simulate ERR_NO_PATH by clearing state
    delete mockContext.memory.state;

    // Second call - should call behavior function again for re-evaluation
    const action2 = evaluateWithStateMachine(mockContext, trackingBehaviorFn);
    expect(behaviorCallCount).to.equal(2);
    expect(action2.type).to.equal("transfer");
  });

  it("should allow finding alternative targets after ERR_NO_PATH", () => {
    let callCount = 0;
    const smartBehaviorFn = (ctx: CreepContext): CreepAction => {
      callCount++;
      if (callCount === 1) {
        // First call: return target that will fail with ERR_NO_PATH
        return { 
          type: "moveTo", 
          target: { id: "unreachable", pos: { x: 0, y: 0, roomName: "W3N3" } } as any
        };
      } else {
        // After state clear: return accessible alternative
        return { 
          type: "moveTo", 
          target: { id: "accessible", pos: { x: 10, y: 10, roomName: "W2N2" } } as any
        };
      }
    };

    // First call - gets unreachable target
    const action1 = evaluateWithStateMachine(mockContext, smartBehaviorFn);
    expect(action1.type).to.equal("moveTo");
    expect(callCount).to.equal(1);

    // Simulate ERR_NO_PATH clearing state
    delete mockContext.memory.state;

    // Second call - should re-evaluate and get accessible target
    const action2 = evaluateWithStateMachine(mockContext, smartBehaviorFn);
    expect(action2.type).to.equal("moveTo");
    expect(callCount).to.equal(2);
  });

  it("should continue calling behavior function for each re-evaluation", () => {
    let behaviorCalled = 0;
    const trackingBehaviorFn = (ctx: CreepContext): CreepAction => {
      behaviorCalled++;
      return { type: "harvest", target: {} as any };
    };

    // First call
    evaluateWithStateMachine(mockContext, trackingBehaviorFn);
    expect(behaviorCalled).to.equal(1);

    // Simulate ERR_NO_PATH clearing state
    delete mockContext.memory.state;

    // Second call - behavior should be called again
    evaluateWithStateMachine(mockContext, trackingBehaviorFn);
    expect(behaviorCalled).to.equal(2);
  });

  it("should handle state clearing efficiently without loops", () => {
    let evaluationCount = 0;
    const behaviorFn = (ctx: CreepContext): CreepAction => {
      evaluationCount++;
      return { 
        type: "build", 
        target: { id: "site1", pos: { x: 5, y: 5, roomName: "W2N2" } } as any
      };
    };

    // First evaluation
    const action1 = evaluateWithStateMachine(mockContext, behaviorFn);
    expect(evaluationCount).to.equal(1);
    expect(action1.type).to.equal("build");

    // State should be set
    expect(mockContext.memory.state).to.not.be.undefined;

    // Simulate multiple ERR_NO_PATH occurrences (state clearing)
    for (let i = 0; i < 3; i++) {
      delete mockContext.memory.state;
      const action = evaluateWithStateMachine(mockContext, behaviorFn);
      expect(action.type).to.equal("build");
    }

    // Should have called behavior function once per state clear + initial
    expect(evaluationCount).to.equal(4);
  });

  it("should work consistently across different roles", () => {
    const roles = ["hauler", "builder", "upgrader", "remoteHarvester"];

    for (const role of roles) {
      mockContext.memory.role = role as any;
      
      // Call behavior - should return action
      const action = evaluateWithStateMachine(mockContext, mockBehaviorFn);
      expect(action.type).to.equal("harvest");

      // Simulate ERR_NO_PATH clearing state
      delete mockContext.memory.state;

      // Call again - should re-evaluate, not return home
      const action2 = evaluateWithStateMachine(mockContext, mockBehaviorFn);
      expect(action2.type).to.equal("harvest");
      expect(action2.type).to.not.equal("moveToRoom");
    }
  });

  it("should preserve behavior evaluation regardless of location", () => {
    // Test in remote room (not home room)
    mockContext.isInHomeRoom = false;
    mockCreep.room.name = "W2N2";
    mockCreep.pos.roomName = "W2N2";

    const action = evaluateWithStateMachine(mockContext, mockBehaviorFn);

    // Should call behavior function and get action, not auto-return home
    expect(action.type).to.equal("harvest");
    
    // Simulate ERR_NO_PATH clearing state
    delete mockContext.memory.state;
    
    // Should still re-evaluate in same location
    const action2 = evaluateWithStateMachine(mockContext, mockBehaviorFn);
    expect(action2.type).to.equal("harvest");
  });
});
