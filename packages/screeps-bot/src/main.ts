import { loop as swarmLoop } from "./SwarmBot";
import { registerAllConsoleCommands } from "./core/consoleCommands";
import { ErrorMapper } from "utils/ErrorMapper";

declare global {
  /*
    Example types, expand on these or remove them and add your own.
    Note: Values, properties defined here do no fully *exist* by this type definiton alone.
          You must also give them an implemention if you would like to use them. (ex. actually setting a `role` property in a Creeps memory)

    Types added in this `global` block are in an ambient, global context. This is needed because `main.ts` is a module file (uses import or export).
    Interfaces matching on name from @types/screeps will be merged. This is how you can extend the 'built-in' interfaces from @types/screeps.
  */
  // Memory extension samples
  interface Memory {
    uuid: number;
    log: any;
  }

  interface CreepMemory {
    role: string;
    room: string;
    working: boolean;
  }

}

// =============================================================================
// Console Commands Registration
// =============================================================================
// All console commands are now registered using the @Command decorator in
// src/core/consoleCommands.ts. This provides:
// - Automatic help() command with all registered commands
// - Consistent command metadata (description, usage, examples)
// - Centralized command management via CommandRegistry
//
// To add new commands, create a class with @Command decorated methods
// and register it in registerAllConsoleCommands()
// =============================================================================

// Register all console commands (must be done before game loop starts)
registerAllConsoleCommands();

// When compiling TS to JS and bundling with rollup, the line numbers and file names in error messages change
// This utility uses source maps to get the line numbers and file names of the original, TS source code
export const loop = ErrorMapper.wrapLoop(() => {
  // Run the SwarmBot main loop
  swarmLoop();
});
