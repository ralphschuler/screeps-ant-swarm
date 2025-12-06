import { expect } from "chai";
import { getConfig, resetConfig, updateConfig } from "../../src/config";
import { Kernel, buildKernelConfigFromCpu } from "../../src/core/kernel";

describe("Kernel CPU configuration", () => {
  beforeEach(() => {
    resetConfig();
    // @ts-ignore: Allow setting test values
    global.Game = {
      ...global.Game,
      time: 0,
      cpu: {
        ...global.Game.cpu,
        bucket: 10000,
        limit: 50
      }
    };
  });

  it("respects CPU bucket thresholds from configuration", () => {
    updateConfig({
      cpu: {
        ...getConfig().cpu,
        bucketThresholds: { lowMode: 4000, highMode: 8000 }
      }
    });

    const kernel = new Kernel(buildKernelConfigFromCpu(getConfig().cpu));

    Game.cpu.bucket = 1500;
    expect(kernel.getBucketMode()).to.equal("critical");

    Game.time += 1;
    Game.cpu.bucket = 3000;
    expect(kernel.getBucketMode()).to.equal("low");

    Game.time += 1;
    Game.cpu.bucket = 8500;
    expect(kernel.getBucketMode()).to.equal("high");
  });

  it("applies CPU budgets and task frequencies to process defaults", () => {
    updateConfig({
      cpu: {
        ...getConfig().cpu,
        bucketThresholds: { lowMode: 4000, highMode: 8000 },
        budgets: { rooms: 0.55, creeps: 0.25, strategic: 0.15, market: 0.05, visualization: 0.05 },
        taskFrequencies: {
          pheromoneUpdate: 4,
          clusterLogic: 6,
          strategicDecisions: 12,
          marketScan: 80,
          nukeEvaluation: 160,
          memoryCleanup: 40
        }
      }
    });

    const kernel = new Kernel(buildKernelConfigFromCpu(getConfig().cpu));

    kernel.registerProcess({ id: "freq-high", name: "High", frequency: "high", execute: () => {} });
    kernel.registerProcess({ id: "freq-low", name: "Low", frequency: "low", execute: () => {} });

    const highProcess = kernel.getProcess("freq-high");
    const lowProcess = kernel.getProcess("freq-low");

    expect(highProcess).to.not.be.undefined;
    expect(lowProcess).to.not.be.undefined;

    expect(highProcess?.cpuBudget).to.equal(0.55);
    expect(lowProcess?.interval).to.equal(160);
  });
});
