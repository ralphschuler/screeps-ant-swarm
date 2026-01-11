/**
 * Pheromone Integration Tests
 *
 * Tests for pheromone-driven behavior integration.
 */

import { expect } from "chai";
import { describe, it } from "mocha";
import {
  getPriorityMultiplier,
  getOptimalRoleFocus,
  shouldPrioritizeDefense,
  shouldActivateEmergencyMode,
  getActionPriorities,
  needsDefense,
  needsBuilding,
  needsHarvesting,
  needsUpgrading
} from "@ralphschuler/screeps-roles";
import type { PheromoneState } from "../../src/memory/schemas";

describe("Pheromone Integration", () => {
  describe("getPriorityMultiplier", () => {
    it("should return minimum multiplier for zero pheromone", () => {
      const pheromones: PheromoneState = {
        expand: 0,
        harvest: 0,
        build: 0,
        upgrade: 0,
        defense: 0,
        war: 0,
        siege: 0,
        logistics: 0,
        nukeTarget: 0
      };

      const multiplier = getPriorityMultiplier(pheromones, "harvest");
      expect(multiplier).to.equal(0.5);
    });

    it("should return maximum multiplier for max pheromone", () => {
      const pheromones: PheromoneState = {
        expand: 0,
        harvest: 100,
        build: 0,
        upgrade: 0,
        defense: 0,
        war: 0,
        siege: 0,
        logistics: 0,
        nukeTarget: 0
      };

      const multiplier = getPriorityMultiplier(pheromones, "harvest");
      expect(multiplier).to.equal(2.0);
    });

    it("should scale linearly between min and max", () => {
      const pheromones: PheromoneState = {
        expand: 0,
        harvest: 50,
        build: 0,
        upgrade: 0,
        defense: 0,
        war: 0,
        siege: 0,
        logistics: 0,
        nukeTarget: 0
      };

      const multiplier = getPriorityMultiplier(pheromones, "harvest");
      expect(multiplier).to.be.closeTo(1.25, 0.01); // Middle value
    });
  });

  describe("getOptimalRoleFocus", () => {
    it("should prioritize economy in peaceful conditions", () => {
      const pheromones: PheromoneState = {
        expand: 10,
        harvest: 30,
        build: 25,
        upgrade: 20,
        defense: 5,
        war: 0,
        siege: 0,
        logistics: 15,
        nukeTarget: 0
      };

      const focus = getOptimalRoleFocus(pheromones);

      expect(focus.economy).to.be.greaterThan(focus.military);
      expect(focus.economy).to.be.greaterThan(focus.utility);
      expect(focus.economy).to.be.greaterThan(focus.power);
    });

    it("should prioritize military during combat", () => {
      const pheromones: PheromoneState = {
        expand: 5,
        harvest: 10,
        build: 10,
        upgrade: 10,
        defense: 40,
        war: 30,
        siege: 20,
        logistics: 10,
        nukeTarget: 0
      };

      const focus = getOptimalRoleFocus(pheromones);

      expect(focus.military).to.be.greaterThan(focus.economy);
      expect(focus.military).to.be.greaterThan(focus.utility);
    });

    it("should prioritize utility during expansion", () => {
      const pheromones: PheromoneState = {
        expand: 50,
        harvest: 10,
        build: 10,
        upgrade: 10,
        defense: 5,
        war: 0,
        siege: 0,
        logistics: 10,
        nukeTarget: 0
      };

      const focus = getOptimalRoleFocus(pheromones);

      expect(focus.utility).to.be.greaterThan(focus.power);
    });

    it("should maintain normalized weights summing to 1.0", () => {
      const pheromones: PheromoneState = {
        expand: 20,
        harvest: 30,
        build: 25,
        upgrade: 20,
        defense: 15,
        war: 10,
        siege: 5,
        logistics: 15,
        nukeTarget: 0
      };

      const focus = getOptimalRoleFocus(pheromones);
      const sum = focus.economy + focus.military + focus.utility + focus.power;

      expect(sum).to.be.closeTo(1.0, 0.01);
    });
  });

  describe("needsDefense", () => {
    it("should return true when defense pheromone is elevated", () => {
      const pheromones: PheromoneState = {
        expand: 10,
        harvest: 10,
        build: 10,
        upgrade: 10,
        defense: 25,
        war: 0,
        siege: 0,
        logistics: 10,
        nukeTarget: 0
      };

      expect(needsDefense(pheromones)).to.be.true;
    });

    it("should return true when war pheromone is elevated", () => {
      const pheromones: PheromoneState = {
        expand: 10,
        harvest: 10,
        build: 10,
        upgrade: 10,
        defense: 10,
        war: 30,
        siege: 0,
        logistics: 10,
        nukeTarget: 0
      };

      expect(needsDefense(pheromones)).to.be.true;
    });

    it("should return true when siege pheromone is elevated", () => {
      const pheromones: PheromoneState = {
        expand: 10,
        harvest: 10,
        build: 10,
        upgrade: 10,
        defense: 10,
        war: 10,
        siege: 35,
        logistics: 10,
        nukeTarget: 0
      };

      expect(needsDefense(pheromones)).to.be.true;
    });

    it("should return false in peaceful conditions", () => {
      const pheromones: PheromoneState = {
        expand: 10,
        harvest: 10,
        build: 10,
        upgrade: 10,
        defense: 5,
        war: 0,
        siege: 0,
        logistics: 10,
        nukeTarget: 0
      };

      expect(needsDefense(pheromones)).to.be.false;
    });
  });

  describe("needsBuilding", () => {
    it("should return true when build pheromone is elevated", () => {
      const pheromones: PheromoneState = {
        expand: 10,
        harvest: 10,
        build: 20,
        upgrade: 10,
        defense: 5,
        war: 0,
        siege: 0,
        logistics: 10,
        nukeTarget: 0
      };

      expect(needsBuilding(pheromones)).to.be.true;
    });

    it("should return false when build pheromone is low", () => {
      const pheromones: PheromoneState = {
        expand: 10,
        harvest: 10,
        build: 10,
        upgrade: 10,
        defense: 5,
        war: 0,
        siege: 0,
        logistics: 10,
        nukeTarget: 0
      };

      expect(needsBuilding(pheromones)).to.be.false;
    });
  });

  describe("needsHarvesting", () => {
    it("should return true when harvest pheromone is elevated", () => {
      const pheromones: PheromoneState = {
        expand: 10,
        harvest: 20,
        build: 10,
        upgrade: 10,
        defense: 5,
        war: 0,
        siege: 0,
        logistics: 10,
        nukeTarget: 0
      };

      expect(needsHarvesting(pheromones)).to.be.true;
    });

    it("should return false when harvest pheromone is low", () => {
      const pheromones: PheromoneState = {
        expand: 10,
        harvest: 10,
        build: 10,
        upgrade: 10,
        defense: 5,
        war: 0,
        siege: 0,
        logistics: 10,
        nukeTarget: 0
      };

      expect(needsHarvesting(pheromones)).to.be.false;
    });
  });

  describe("needsUpgrading", () => {
    it("should return true when upgrade pheromone is elevated", () => {
      const pheromones: PheromoneState = {
        expand: 10,
        harvest: 10,
        build: 10,
        upgrade: 20,
        defense: 5,
        war: 0,
        siege: 0,
        logistics: 10,
        nukeTarget: 0
      };

      expect(needsUpgrading(pheromones)).to.be.true;
    });

    it("should return false when upgrade pheromone is low", () => {
      const pheromones: PheromoneState = {
        expand: 10,
        harvest: 10,
        build: 10,
        upgrade: 10,
        defense: 5,
        war: 0,
        siege: 0,
        logistics: 10,
        nukeTarget: 0
      };

      expect(needsUpgrading(pheromones)).to.be.false;
    });
  });

  describe("getActionPriorities", () => {
    it("should return sorted list of actions by priority", () => {
      const pheromones: PheromoneState = {
        expand: 10,
        harvest: 40,
        build: 30,
        upgrade: 20,
        defense: 50,
        war: 15,
        siege: 5,
        logistics: 25,
        nukeTarget: 0
      };

      const priorities = getActionPriorities(pheromones);

      expect(priorities).to.have.lengthOf(9);
      expect(priorities[0].action).to.equal("defense"); // Highest
      expect(priorities[0].priority).to.equal(50);
      expect(priorities[priorities.length - 1].action).to.equal("nukeTarget"); // Lowest
      expect(priorities[priorities.length - 1].priority).to.equal(0);
    });

    it("should maintain descending order", () => {
      const pheromones: PheromoneState = {
        expand: 25,
        harvest: 35,
        build: 45,
        upgrade: 15,
        defense: 55,
        war: 65,
        siege: 5,
        logistics: 30,
        nukeTarget: 10
      };

      const priorities = getActionPriorities(pheromones);

      for (let i = 0; i < priorities.length - 1; i++) {
        expect(priorities[i].priority).to.be.at.least(priorities[i + 1].priority);
      }
    });
  });
});
