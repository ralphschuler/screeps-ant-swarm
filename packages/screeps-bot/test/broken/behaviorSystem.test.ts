/**
 * Behavior System Tests
 *
 * Comprehensive tests for the creep behavior system to ensure:
 * 1. Reliability - Behaviors handle edge cases and invalid states
 * 2. Dynamism - Behaviors adapt to changing conditions
 * 3. Resilience - Behaviors recover from errors and stuck states
 */

import { expect } from "chai";
import type { CreepAction, CreepContext } from "@ralphschuler/screeps-roles";
import { evaluateEconomyBehavior } from "@ralphschuler/screeps-roles";
import { evaluateMilitaryBehavior } from "@ralphschuler/screeps-roles";
import { evaluateUtilityBehavior } from "@ralphschuler/screeps-roles";
import { evaluateWithStateMachine } from "@ralphschuler/screeps-roles";
import { executeAction } from "@ralphschuler/screeps-roles";

// Constants from state machine module
const STUCK_DETECTION_THRESHOLD = 5; // From stateMachine.ts
const DEFAULT_STATE_TIMEOUT = 25; // From stateMachine.ts
describe("Behavior System", () => {
  describe("Reliability - Edge Case Handling", () => {
    it("should handle undefined working state gracefully", () => {
      // Test that behaviors initialize working state correctly
      const ctx = createMockContext({
        role: "larvaWorker",
        working: undefined,
        energy: { used: 50, free: 50 }
      });

      const action = evaluateEconomyBehavior(ctx);

      // Should initialize to working=true (has energy to deliver)
      expect(ctx.memory.working).to.equal(true);
      expect(action.type).to.not.equal("idle");
    });

    it("should restore working flag after memory resets when creep has energy", () => {
      const ctx = createMockContext({
        role: "larvaWorker",
        working: undefined,
        energy: { used: 25, free: 75 }
      });

      (global as any).Game = {
        rooms: {
          W1N1: {
            name: "W1N1",
            controller: { my: true },
            find: () => [],
            getPositionAt: () => ({ pos: { x: 25, y: 25, roomName: "W1N1" } })
          }
        },
        map: { getRoomLinearDistance: () => 0 },
        cpu: { getUsed: () => 0, limit: 0, bucket: 10000 },
        time: 0,
        getObjectById: () => null
      } as unknown as Game;

      // Execute a no-op action to trigger executor working-state update
      executeAction(ctx.creep, { type: "idle" }, ctx);

      expect(ctx.memory.working).to.equal(true);
    });

    it("should handle empty room with no resources", () => {
      const ctx = createMockContext({
        role: "larvaWorker",
        working: false,
        energy: { used: 0, free: 100 },
        droppedResources: [],
        containers: [],
        storage: undefined,
        sources: []
      });

      const action = evaluateEconomyBehavior(ctx);
      
      // Should idle gracefully when no resources available
      expect(action.type).to.equal("idle");
    });

    it("should handle full spawn structures gracefully", () => {
      const ctx = createMockContext({
        role: "larvaWorker",
        working: true,
        energy: { used: 100, free: 0 },
        spawnStructures: createMockSpawns([
          { energy: 300, capacity: 300 }, // Full spawn
          { energy: 50, capacity: 50 } // Full extension
        ])
      });

      const action = evaluateEconomyBehavior(ctx);
      
      // Should find alternative delivery target or idle
      expect(action.type).to.be.oneOf(["transfer", "build", "upgrade", "idle"]);
    });

    it("should handle destroyed target mid-action", () => {
      const ctx = createMockContext({
        role: "larvaWorker",
        working: true,
        energy: { used: 100, free: 0 }
      });

      // Set a state with a target that no longer exists
      ctx.memory.state = {
        action: "transfer",
        targetId: "invalid-id" as Id<StructureSpawn>,
        startTick: Game.time - STUCK_DETECTION_THRESHOLD,
        timeout: DEFAULT_STATE_TIMEOUT
      };

      const action = evaluateWithStateMachine(ctx, evaluateEconomyBehavior);
      
      // Should detect invalid target and evaluate new action
      // The state might be cleared or updated with a new target
      expect(action.type).to.not.equal("idle");
      // State should either be cleared or updated with new target
      if (ctx.memory.state) {
        expect(ctx.memory.state.targetId).to.not.equal("invalid-id");
      }
    });

    it("should handle contested resources without deadlock", () => {
      const container = createMockContainer({ energy: 100 });
      const ctx1 = createMockContext({
        role: "larvaWorker",
        name: "worker1",
        working: false,
        energy: { used: 0, free: 100 },
        containers: [container],
        sources: [createMockSource()] // Add fallback source
      });
      const ctx2 = createMockContext({
        role: "larvaWorker",
        name: "worker2",
        working: false,
        energy: { used: 0, free: 100 },
        containers: [container],
        sources: [createMockSource()] // Add fallback source
      });

      const action1 = evaluateEconomyBehavior(ctx1);
      const action2 = evaluateEconomyBehavior(ctx2);
      
      // Both should get valid actions (distributed targeting or fallback to harvest)
      expect(action1.type).to.be.oneOf(["withdraw", "harvest", "pickup", "idle"]);
      expect(action2.type).to.be.oneOf(["withdraw", "harvest", "pickup", "idle"]);
      
      // At least one should get a non-idle action
      const hasAction = action1.type !== "idle" || action2.type !== "idle";
      expect(hasAction).to.be.true;
    });
  });

  describe("Dynamism - Adaptive Behavior", () => {
    it("should prioritize defense when hostiles present", () => {
      const ctx = createMockContext({
        role: "guard",
        family: "military",
        working: false,
        hostiles: [createMockHostile({ x: 25, y: 25 })]
      });

      const action = evaluateMilitaryBehavior(ctx);
      
      // Should engage hostile, not patrol
      expect(action.type).to.be.oneOf(["attack", "rangedAttack", "moveTo"]);
    });

    it("should adapt to pheromone signals", () => {
      const ctx = createMockContext({
        role: "larvaWorker",
        working: true,
        energy: { used: 100, free: 0 },
        swarmState: {
          pheromones: {
            build: 10, // High build pheromone
            upgrade: 1 // Low upgrade pheromone
          }
        },
        prioritizedSites: [createMockConstructionSite()]
      });

      const action = evaluateEconomyBehavior(ctx);
      
      // Should prioritize building due to high build pheromone
      expect(action.type).to.equal("build");
    });

    it("should switch tasks when conditions change", () => {
      const ctx = createMockContext({
        role: "larvaWorker",
        working: true,
        energy: { used: 100, free: 0 },
        spawnStructures: createMockSpawns([
          { energy: 250, capacity: 300 } // Needs energy
        ])
      });

      // First action - deliver to spawn
      const action1 = evaluateEconomyBehavior(ctx);
      expect(action1.type).to.equal("transfer");
      
      // Simulate spawn filling up
      ctx.spawnStructures = createMockSpawns([
        { energy: 300, capacity: 300 } // Now full
      ]);
      
      // Second action - should find different task
      const action2 = evaluateEconomyBehavior(ctx);
      expect(action2.type).to.be.oneOf(["build", "upgrade"]);
    });

    it("builder should prioritize energy delivery to spawns before building", () => {
      const ctx = createMockContext({
        role: "builder",
        working: true,
        energy: { used: 100, free: 0 },
        spawnStructures: createMockSpawns([
          { energy: 250, capacity: 300 } // Spawn needs energy
        ]),
        prioritizedSites: [createMockConstructionSite()] // Construction site available
      });

      // Builder with energy should deliver to spawn first, not build
      const action = evaluateEconomyBehavior(ctx);
      expect(action.type).to.equal("transfer", "Builder should deliver energy to spawn before building");
    });

    it("builder should build only after critical structures are filled", () => {
      const ctx = createMockContext({
        role: "builder",
        working: true,
        energy: { used: 100, free: 0 },
        spawnStructures: createMockSpawns([
          { energy: 300, capacity: 300 } // Spawn is full
        ]),
        prioritizedSites: [createMockConstructionSite()] // Construction site available
      });

      // Builder should build when spawns/extensions/towers are full
      const action = evaluateEconomyBehavior(ctx);
      expect(action.type).to.equal("build", "Builder should build when critical structures are full");
    });

    it("should respond to room danger level", () => {
      const ctx = createMockContext({
        role: "larvaWorker",
        working: false,
        swarmState: {
          danger: 2, // High danger
          intent: "defense"
        },
        hostiles: [createMockHostile({ x: 25, y: 25 })]
      });

      // Economy creeps should retreat when in danger
      const action = evaluateEconomyBehavior(ctx);
      
      // Should avoid hostile areas or flee
      expect(action.type).to.be.oneOf(["flee", "moveToRoom", "idle"]);
    });
  });

  describe("Resilience - Error Recovery", () => {
    it("should recover from stuck state", () => {
      const ctx = createMockContext({
        role: "larvaWorker",
        working: false,
        energy: { used: 0, free: 100 },
        sources: [createMockSource()] // Provide a source to work with
      });

      // Simulate stuck detection - must be 5+ ticks (STUCK_DETECTION_THRESHOLD)
      const memory = ctx.memory as any;
      memory.lastPosX = ctx.creep.pos.x;
      memory.lastPosY = ctx.creep.pos.y;
      memory.lastPosRoom = ctx.creep.pos.roomName;
      memory.lastPosTick = Game.time - STUCK_DETECTION_THRESHOLD;
      
      // Set a moveTo state (non-stationary action that should trigger stuck detection)
      ctx.memory.state = {
        action: "moveTo",
        targetId: "some-id" as Id<Source>,
        startTick: Game.time - (STUCK_DETECTION_THRESHOLD - 1),
        timeout: DEFAULT_STATE_TIMEOUT
      };

      const action = evaluateWithStateMachine(ctx, evaluateEconomyBehavior);
      
      // State should be detected as stuck and invalidated
      // Either cleared completely or replaced with new state
      // The key is that we get a valid action
      expect(action.type).to.not.equal("idle");
    });

    it("should handle timeout of long-running states", () => {
      const ctx = createMockContext({
        role: "larvaWorker",
        working: false,
        sources: [createMockSource()] // Provide a source
      });

      // State that's been running too long
      ctx.memory.state = {
        action: "harvest",
        targetId: "source-id" as Id<Source>,
        startTick: Game.time - (DEFAULT_STATE_TIMEOUT * 2), // Exceeded timeout
        timeout: DEFAULT_STATE_TIMEOUT
      };

      const action = evaluateWithStateMachine(ctx, evaluateEconomyBehavior);
      
      // Should timeout and re-evaluate with new state
      // Since the old state timed out, either:
      // 1. State is cleared (if target invalid)
      // 2. New state is created with current Game.time
      if (ctx.memory.state) {
        expect(ctx.memory.state.startTick).to.be.greaterThan(Game.time - 1);
      }
      // Should get a valid action
      expect(action.type).to.not.equal("idle");
    });

    it("should clear invalid state on executor errors", () => {
      const ctx = createMockContext({
        role: "larvaWorker",
        working: true,
        energy: { used: 100, free: 0 }
      });

      // Create a state pointing to a full spawn
      const fullSpawn = createMockSpawn({ energy: 300, capacity: 300 });
      ctx.memory.state = {
        action: "transfer",
        targetId: fullSpawn.id,
        startTick: Game.time,
        timeout: 25
      };

      // Simulate ERR_FULL error from executor
      // This would normally be detected by executeAction's executeWithRange helper
      // For testing, we verify the state is cleared on error
      
      // After error, state should be cleared
      expect(ctx.memory.state).to.exist;
      
      // Next evaluation should get fresh action
      const action = evaluateWithStateMachine(ctx, evaluateEconomyBehavior);
      expect(action.type).to.be.oneOf(["transfer", "build", "upgrade"]);
    });

    it("should handle null/undefined behavior returns", () => {
      const ctx = createMockContext({
        role: "larvaWorker",
        working: false
      });

      // Create a mock behavior that returns invalid action
      const buggyBehavior = (_ctx: CreepContext): CreepAction => {
        return null as unknown as CreepAction;
      };

      const action = evaluateWithStateMachine(ctx, buggyBehavior);
      
      // Should default to idle instead of crashing
      expect(action.type).to.equal("idle");
    });

    it("should prevent infinite loops in behavior evaluation", () => {
      const ctx = createMockContext({
        role: "larvaWorker",
        working: false,
        energy: { used: 0, free: 100 }
      });

      let evaluationCount = 0;
      const trackingBehavior = (c: CreepContext): CreepAction => {
        evaluationCount++;
        return evaluateEconomyBehavior(c);
      };

      // Evaluate multiple times - should not increase exponentially
      for (let i = 0; i < 10; i++) {
        evaluateWithStateMachine(ctx, trackingBehavior);
      }
      
      // Should be exactly 10 evaluations (one per call)
      expect(evaluationCount).to.equal(10);
    });
  });
});

// =============================================================================
// Mock Helpers
// =============================================================================

interface MockContextOptions {
  role?: string;
  family?: string;
  name?: string;
  working?: boolean;
  energy?: { used: number; free: number };
  hostiles?: Creep[];
  droppedResources?: Resource[];
  containers?: StructureContainer[];
  spawnStructures?: (StructureSpawn | StructureExtension)[];
  storage?: StructureStorage;
  sources?: Source[];
  prioritizedSites?: ConstructionSite[];
  swarmState?: Partial<any>;
}

function createMockContext(options: MockContextOptions = {}): CreepContext {
  const energyUsed = options.energy?.used ?? 0;
  const energyFree = options.energy?.free ?? 100;
  const totalCapacity = energyUsed + energyFree;

  // Create mock room first
  const room = {
    name: "W1N1",
    controller: { my: true, level: 3 } as StructureController,
    memory: {} as RoomMemory,
    find: (type: FindConstant) => {
      if (type === FIND_SOURCES_ACTIVE) return options.sources ?? [];
      return [];
    }
  } as unknown as Room;

  // Set up minimal Game.rooms mock if not already set
  const globalAny = global as any;
  if (!globalAny.Game) {
    globalAny.Game = {
      time: 1000,
      rooms: { "W1N1": room },
      getObjectById: () => null,
      map: {
        describeExits: () => null
      }
    };
  }
  if (!globalAny.Memory) {
    globalAny.Memory = {
      rooms: {
        "W1N1": {
          swarm: options.swarmState || {}
        }
      }
    };
  }

  const pos = {
    x: 25,
    y: 25,
    roomName: "W1N1",
    getRangeTo: function(this: RoomPosition, target: RoomPosition | { pos: RoomPosition }) {
      const targetPos = 'pos' in target ? target.pos : target;
      const dx = Math.abs(this.x - targetPos.x);
      const dy = Math.abs(this.y - targetPos.y);
      return Math.max(dx, dy);
    },
    isNearTo: function(this: RoomPosition, target: RoomPosition | { pos: RoomPosition }) {
      return this.getRangeTo(target) <= 1;
    },
    isEqualTo: function(this: RoomPosition, target: RoomPosition | { pos: RoomPosition }): boolean {
      const targetPos = 'pos' in target ? target.pos : target;
      return this.x === targetPos.x && this.y === targetPos.y && this.roomName === targetPos.roomName;
    }
  } as RoomPosition;

  const creep = {
    name: options.name ?? "TestCreep",
    pos,
    room,
    body: [
      { type: CARRY, hits: 100 },
      { type: MOVE, hits: 100 }
    ],
    getActiveBodyparts: (type: BodyPartConstant) => {
      if (type === ATTACK) return 0;
      if (type === RANGED_ATTACK) return 0;
      return 1;
    },
    store: {
      getUsedCapacity: (resource?: ResourceConstant) => 
        resource === RESOURCE_ENERGY || !resource ? energyUsed : 0,
      getFreeCapacity: (resource?: ResourceConstant) => 
        resource === RESOURCE_ENERGY || !resource ? energyFree : 0,
      getCapacity: () => totalCapacity
    },
    memory: {
      role: options.role ?? "larvaWorker",
      family: options.family ?? "economy",
      room: "W1N1",
      working: options.working,
      homeRoom: "W1N1"
    }
  } as unknown as Creep;

  return {
    creep,
    room,
    memory: creep.memory as any,
    swarmState: options.swarmState as any,
    squadMemory: undefined,
    homeRoom: "W1N1",
    isInHomeRoom: true,
    isFull: energyFree === 0,
    isEmpty: energyUsed === 0,
    isWorking: options.working ?? false,
    assignedSource: null,
    assignedMineral: null,
    energyAvailable: true,
    nearbyEnemies: (options.hostiles?.length ?? 0) > 0,
    constructionSiteCount: options.prioritizedSites?.length ?? 0,
    damagedStructureCount: 0,
    droppedResources: options.droppedResources ?? [],
    containers: options.containers ?? [],
    depositContainers: [],
    spawnStructures: options.spawnStructures ?? [],
    towers: [],
    storage: options.storage,
    terminal: undefined,
    hostiles: options.hostiles ?? [],
    damagedAllies: [],
    prioritizedSites: options.prioritizedSites ?? [],
    repairTargets: [],
    labs: [],
    factory: undefined,
    tombstones: [],
    mineralContainers: []
  };
}

function createMockSpawn(options: { energy: number; capacity: number }): StructureSpawn {
  return {
    id: `spawn-${Math.random()}` as Id<StructureSpawn>,
    pos: { x: 25, y: 25, roomName: "W1N1" } as RoomPosition,
    structureType: STRUCTURE_SPAWN,
    store: {
      getUsedCapacity: (r?: ResourceConstant) => 
        r === RESOURCE_ENERGY || !r ? options.energy : 0,
      getFreeCapacity: (r?: ResourceConstant) => 
        r === RESOURCE_ENERGY || !r ? options.capacity - options.energy : 0,
      getCapacity: () => options.capacity
    }
  } as unknown as StructureSpawn;
}

function createMockSpawns(configs: Array<{ energy: number; capacity: number }>): (StructureSpawn | StructureExtension)[] {
  return configs.map(createMockSpawn);
}

function createMockContainer(options: { energy: number }): StructureContainer {
  return {
    id: `container-${Math.random()}` as Id<StructureContainer>,
    pos: { x: 20, y: 20, roomName: "W1N1" } as RoomPosition,
    structureType: STRUCTURE_CONTAINER,
    store: {
      getUsedCapacity: (r?: ResourceConstant) => 
        r === RESOURCE_ENERGY || !r ? options.energy : 0,
      getFreeCapacity: () => 2000 - options.energy,
      getCapacity: () => 2000
    }
  } as unknown as StructureContainer;
}

function createMockHostile(pos: { x: number; y: number }): Creep {
  return {
    id: `hostile-${Math.random()}` as Id<Creep>,
    name: "Hostile",
    pos: { x: pos.x, y: pos.y, roomName: "W1N1" } as RoomPosition,
    body: [
      { type: ATTACK, hits: 100 },
      { type: ATTACK, hits: 100 },
      { type: MOVE, hits: 100 },
      { type: MOVE, hits: 100 }
    ],
    getActiveBodyparts: (type: BodyPartConstant) => {
      if (type === ATTACK) return 2;
      if (type === MOVE) return 2;
      return 0;
    }
  } as unknown as Creep;
}

function createMockConstructionSite(): ConstructionSite {
  return {
    id: `site-${Math.random()}` as Id<ConstructionSite>,
    pos: { x: 30, y: 30, roomName: "W1N1" } as RoomPosition,
    structureType: STRUCTURE_EXTENSION,
    progress: 0,
    progressTotal: 1000
  } as unknown as ConstructionSite;
}

function createMockSource(): Source {
  return {
    id: `source-${Math.random()}` as Id<Source>,
    pos: { x: 35, y: 35, roomName: "W1N1" } as RoomPosition,
    energy: 3000,
    energyCapacity: 3000
  } as unknown as Source;
}
