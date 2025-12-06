import { expect } from "chai";
import sinon from "sinon";
import { Game as MockGame, Memory as MockMemory } from "./mock";

function reloadSwarmBot() {
  delete require.cache[require.resolve("../../src/core/kernel")];
  delete require.cache[require.resolve("../../src/core/logger")];
  delete require.cache[require.resolve("../../src/core/processRegistry")];
  delete require.cache[require.resolve("../../src/SwarmBot")];

  return require("../../src/SwarmBot") as typeof import("../../src/SwarmBot");
}

describe("SwarmBot logging", () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    // Reset globals to a clean baseline
    // @ts-ignore: globals provided by test setup
    global.Game = _.clone(MockGame);
    // @ts-ignore: globals provided by test setup
    global.Memory = _.clone(MockMemory);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("logs skipped creeps through the logger", () => {
    const bot = reloadSwarmBot();

    const loggerModule = require("../../src/core/logger");
    const warnSpy = sandbox.spy(loggerModule, "warn");

    const processRegistry = require("../../src/core/processRegistry");
    sandbox.stub(processRegistry, "registerAllProcesses");

    sandbox.stub(bot.kernel, "initialize");
    sandbox.stub(bot.kernel, "getBucketMode").returns("low");
    sandbox.stub(bot.kernel, "hasCpuBudget").returns(false);
    sandbox.stub(bot.roomManager, "run");
    sandbox.stub(bot.profiler, "measureSubsystem").callsFake((_, fn: () => void) => fn());

    // @ts-ignore: test setup for Game globals
    global.Game.creeps = {
      alpha: { memory: { role: "builder", room: "W1N1", working: false } as any, spawning: false } as any,
      beta: { memory: { role: "hauler", room: "W1N1", working: false } as any, spawning: false } as any
    };
    // @ts-ignore: test setup for Game globals
    global.Game.time = 12350; // divisible by 50 to satisfy logging interval

    bot.loop();

    expect(warnSpy).to.have.been.calledWithMatch(
      sinon.match(/Skipped .* creeps due to CPU/),
      sinon.match({ subsystem: "SwarmBot" })
    );
  });

  it("logs visualization errors through the logger", () => {
    const bot = reloadSwarmBot();

    const loggerModule = require("../../src/core/logger");
    const errorSpy = sandbox.spy(loggerModule, "error");

    const processRegistry = require("../../src/core/processRegistry");
    sandbox.stub(processRegistry, "registerAllProcesses");

    sandbox.stub(bot.kernel, "initialize");
    sandbox.stub(bot.kernel, "getBucketMode").returns("normal");
    sandbox.stub(bot.kernel, "hasCpuBudget").returns(true);
    sandbox.stub(bot.roomManager, "run");
    sandbox.stub(bot.profiler, "measureSubsystem").callsFake((_, fn: () => void) => fn());

    sandbox.stub(bot.roomVisualizer, "draw").throws(new Error("boom"));

    // @ts-ignore: test setup for Game globals
    global.Game.rooms = {
      W1N1: { name: "W1N1", controller: { my: true } as any } as any
    };

    bot.loop();

    expect(errorSpy).to.have.been.calledWithMatch(
      sinon.match(/Visualization error in W1N1/),
      sinon.match({ subsystem: "visualizations", room: "W1N1" })
    );
  });
});
