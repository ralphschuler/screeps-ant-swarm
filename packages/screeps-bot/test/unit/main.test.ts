import {assert} from "chai";
import {loop} from "../../src/main";
import {Game, Memory} from "./mock";
import {memoryManager} from "../../src/SwarmBot";

describe("main", () => {
  before(() => {
    // runs before all test in this block
  });

  beforeEach(() => {
    // runs before each test in this block
    // @ts-ignore : allow adding Game to global
    global.Game = _.clone(Game);
    // @ts-ignore : allow adding Memory to global
    global.Memory = _.clone(Memory);
    // Reset the memory manager's per-tick state
    // @ts-ignore: Accessing private properties for testing
    memoryManager["lastInitializeTick"] = null;
    // @ts-ignore: Accessing private properties for testing
    memoryManager["lastCleanupTick"] = 0;
  });

  it("should export a loop function", () => {
    assert.isTrue(typeof loop === "function");
  });

  it("should return void when called with no context", () => {
    assert.isUndefined(loop());
  });

  it("Automatically delete memory of missing creeps", () => {
    // @ts-ignore: Allow setting test values
    global.Memory.creeps.persistValue = { role: "test", room: "W1N1", working: false };
    // @ts-ignore: Allow setting test values
    global.Memory.creeps.notPersistValue = { role: "test", room: "W1N1", working: false };

    // @ts-ignore: Allow setting test values
    global.Game.creeps.persistValue = { memory: {}, spawning: false };
    
    // Advance game time to trigger cleanup (cleanup runs every 10 ticks)
    // @ts-ignore: Allow setting test values
    global.Game.time = 10;

    loop();

    // @ts-ignore: Allow checking test values
    assert.isDefined(global.Memory.creeps.persistValue);
    // @ts-ignore: Allow checking test values
    assert.isUndefined(global.Memory.creeps.notPersistValue);
  });
});
