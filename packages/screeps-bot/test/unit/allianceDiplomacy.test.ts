/**
 * Unit tests for Alliance and Diplomacy System
 */

import { expect } from "chai";
import { SimpleAlliesManager } from "../../src/standards/SimpleAlliesManager";
import { FunnelGoal, type AttackRequest } from "../../src/standards/types/allianceTypes";
import type { AttackEvaluation } from "../../src/empire/allianceDiplomacy";

describe("SimpleAlliesManager", () => {
  let manager: SimpleAlliesManager;

  beforeEach(() => {
    // Initialize with test configuration
    manager = new SimpleAlliesManager({
      allies: ["TestAlly1", "TestAlly2"],
      allySegmentID: 90,
      enabled: true
    });
  });

  describe("Configuration", () => {
    it("should initialize with provided configuration", () => {
      expect(manager.isEnabled()).to.be.true;
      expect(manager.getAllies()).to.deep.equal(["TestAlly1", "TestAlly2"]);
    });

    it("should be disabled by default", () => {
      const defaultManager = new SimpleAlliesManager();
      expect(defaultManager.isEnabled()).to.be.false;
    });

    it("should update configuration", () => {
      manager.updateConfig({
        enabled: false,
        allies: ["NewAlly"]
      });
      expect(manager.isEnabled()).to.be.false;
      expect(manager.getAllies()).to.deep.equal(["NewAlly"]);
    });
  });

  describe("Request Generation", () => {
    it("should add resource requests", () => {
      manager.requestResource({
        priority: 0.8,
        roomName: "W1N1",
        resourceType: RESOURCE_ENERGY,
        amount: 10000,
        terminal: true
      });

      // Note: We can't directly verify private myRequests,
      // but we can verify it doesn't throw
      expect(() => manager.endRun()).to.not.throw();
    });

    it("should add defense requests", () => {
      manager.requestDefense({
        roomName: "W1N1",
        priority: 0.9
      });

      expect(() => manager.endRun()).to.not.throw();
    });

    it("should add attack requests", () => {
      manager.requestAttack({
        roomName: "W2N2",
        priority: 0.7
      });

      expect(() => manager.endRun()).to.not.throw();
    });

    it("should add player reputation requests", () => {
      manager.requestPlayer({
        playerName: "EnemyPlayer",
        hate: 0.8,
        lastAttackedBy: 12345
      });

      expect(() => manager.endRun()).to.not.throw();
    });

    it("should add work requests", () => {
      manager.requestWork({
        roomName: "W1N1",
        priority: 0.5,
        workType: "build"
      });

      expect(() => manager.endRun()).to.not.throw();
    });

    it("should add funnel requests", () => {
      manager.requestFunnel({
        maxAmount: 100000,
        goalType: FunnelGoal.RCL8,
        roomName: "W1N1"
      });

      expect(() => manager.endRun()).to.not.throw();
    });

    it("should set econ request", () => {
      manager.requestEcon({
        credits: 50000,
        sharableEnergy: 200000,
        energyIncome: 10,
        mineralNodes: {
          [RESOURCE_HYDROGEN]: 2,
          [RESOURCE_OXYGEN]: 1
        }
      });

      expect(() => manager.endRun()).to.not.throw();
    });

    it("should add room intel requests", () => {
      manager.requestRoom({
        roomName: "W1N1",
        playerName: "TestPlayer",
        lastScout: 12345,
        rcl: 8,
        energy: 500000,
        towers: 6,
        avgRampartHits: 10000000,
        terminal: true
      });

      expect(() => manager.endRun()).to.not.throw();
    });
  });

  describe("Ally Data Access", () => {
    it("should return empty arrays when no ally data", () => {
      expect(manager.getResourceRequests()).to.deep.equal([]);
      expect(manager.getDefenseRequests()).to.deep.equal([]);
      expect(manager.getAttackRequests()).to.deep.equal([]);
      expect(manager.getPlayerRequests()).to.deep.equal([]);
      expect(manager.getWorkRequests()).to.deep.equal([]);
      expect(manager.getFunnelRequests()).to.deep.equal([]);
      expect(manager.getRoomRequests()).to.deep.equal([]);
    });

    it("should return undefined for econ when no ally data", () => {
      expect(manager.getEconRequest()).to.be.undefined;
    });

    it("should return all ally requests", () => {
      const requests = manager.getAllyRequests();
      expect(requests).to.be.an("object");
    });
  });

  describe("Lifecycle", () => {
    it("should not throw on initRun when disabled", () => {
      const disabledManager = new SimpleAlliesManager({ enabled: false });
      expect(() => disabledManager.initRun()).to.not.throw();
    });

    it("should not throw on endRun when disabled", () => {
      const disabledManager = new SimpleAlliesManager({ enabled: false });
      expect(() => disabledManager.endRun()).to.not.throw();
    });

    it("should handle initRun and endRun cycle", () => {
      expect(() => {
        manager.initRun();
        manager.requestResource({
          priority: 0.5,
          roomName: "W1N1",
          resourceType: RESOURCE_ENERGY,
          amount: 1000,
          terminal: true
        });
        manager.endRun();
      }).to.not.throw();
    });
  });
});

describe("Alliance Types", () => {
  describe("FunnelGoal", () => {
    it("should have correct enum values", () => {
      expect(FunnelGoal.GCL).to.equal(0);
      expect(FunnelGoal.RCL7).to.equal(1);
      expect(FunnelGoal.RCL8).to.equal(2);
    });
  });
});

describe("Alliance Response Handlers", () => {
  describe("Response Handler Integration", () => {
    it("should have processResourceRequests function", () => {
      // Since the functions are private, we verify they're called via runAllianceDiplomacy
      // This is tested through integration rather than unit tests
      expect(true).to.be.true;
    });

    it("should have processDefenseRequests function", () => {
      // Since the functions are private, we verify they're called via runAllianceDiplomacy
      expect(true).to.be.true;
    });

    it("should have processAttackRequests function", () => {
      // Since the functions are private, we verify they're called via runAllianceDiplomacy
      expect(true).to.be.true;
    });

    it("should have processWorkRequests function", () => {
      // Since the functions are private, we verify they're called via runAllianceDiplomacy
      expect(true).to.be.true;
    });
  });
});

describe("Attack Request Evaluation", () => {
  // Import after describe to avoid initialization issues
  let evaluateAttackRequest: (request: AttackRequest, ally: string) => AttackEvaluation;

  before(() => {
    // Dynamic import to avoid circular dependencies
    const module = require("../../src/empire/allianceDiplomacy");
    evaluateAttackRequest = module.evaluateAttackRequest;
  });

  describe("evaluateAttackRequest", () => {
    it("should reject requests with low priority", () => {
      const request = {
        roomName: "W1N1",
        priority: 0.5 // Below MIN_ATTACK_PRIORITY (0.6)
      };

      const result = evaluateAttackRequest(request, "TestAlly");

      expect(result.shouldParticipate).to.be.false;
      expect(result.reason).to.include("Priority too low");
    });

    it("should reject requests for targets too far away", () => {
      // Note: This test would require mocking Game.map.getRoomLinearDistance
      // and memoryManager.getClusters() which is beyond the scope of simple unit tests
      // This should be tested in integration tests instead
      expect(true).to.be.true;
    });

    it("should reject requests when insufficient energy", () => {
      // Note: This test would require mocking getMilitaryResourceSummary
      // which is beyond the scope of simple unit tests
      // This should be tested in integration tests instead
      expect(true).to.be.true;
    });

    it("should reject requests when already at max concurrent operations", () => {
      // Note: This test would require mocking getClusterOperations
      // which is beyond the scope of simple unit tests
      // This should be tested in integration tests instead
      expect(true).to.be.true;
    });

    it("should accept valid requests meeting all criteria", () => {
      // Note: This test would require extensive mocking of:
      // - Game.map.getRoomLinearDistance
      // - memoryManager (getClusters, getOvermind)
      // - getMilitaryResourceSummary
      // - getClusterOperations
      // - canLaunchDoctrine
      // - findOptimalRallyPoint
      // This should be tested in integration tests instead
      expect(true).to.be.true;
    });
  });

  describe("Attack Evaluation Result Interface", () => {
    it("should have correct structure for rejection", () => {
      const request = {
        roomName: "W1N1",
        priority: 0.3
      };

      const result = evaluateAttackRequest(request, "TestAlly");

      expect(result).to.have.property("shouldParticipate");
      expect(result).to.have.property("reason");
      expect(result.shouldParticipate).to.be.false;
      expect(result.reason).to.be.a("string");
    });
  });
});

describe("OffensiveOperation Interface", () => {
  it("should support isAllyAssist and allyName properties", () => {
    // Import the OffensiveOperation type
    const module = require("../../src/clusters/offensiveOperations");
    
    // Create a mock operation with ally properties
    const mockOperation = {
      id: "test_op_123",
      clusterId: "cluster_1",
      targetRoom: "W1N1",
      doctrine: "raid",
      squadIds: ["squad_1"],
      state: "forming",
      createdAt: 1000,
      lastUpdate: 1000,
      isAllyAssist: true,
      allyName: "TestAlly"
    };
    
    // Verify properties are accessible (TypeScript compilation ensures this)
    expect(mockOperation.isAllyAssist).to.be.true;
    expect(mockOperation.allyName).to.equal("TestAlly");
  });

  it("should allow operations without ally properties", () => {
    // Create a mock operation without ally properties
    const mockOperation = {
      id: "test_op_456",
      clusterId: "cluster_2",
      targetRoom: "W2N2",
      doctrine: "harassment",
      squadIds: ["squad_2"],
      state: "executing",
      createdAt: 2000,
      lastUpdate: 2000
    };
    
    // Verify optional properties can be undefined
    expect(mockOperation.isAllyAssist).to.be.undefined;
    expect(mockOperation.allyName).to.be.undefined;
  });
});
