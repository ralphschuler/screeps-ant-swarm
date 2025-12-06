/**
 * Console Commands
 *
 * All console commands available in the game using @Command decorators.
 * Commands are automatically registered and exposed to global scope.
 *
 * Categories:
 * - Logging: Commands for controlling log output
 * - Visualization: Commands for toggling visual overlays
 * - Statistics: Commands for viewing bot statistics
 * - Kernel: Commands for managing kernel processes
 * - Configuration: Commands for viewing/modifying bot configuration
 */

/* eslint-disable max-classes-per-file */

import { Command, commandRegistry, registerDecoratedCommands } from "./commandRegistry";
import { kernel } from "./kernel";
import { LogLevel, configureLogger, getLoggerConfig } from "./logger";
import { memorySegmentStats } from "./memorySegmentStats";
import { profiler } from "./profiler";
import { getConfig, updateConfig } from "../config";
import { roomVisualizer } from "../visuals/roomVisualizer";

/**
 * Logging commands
 */
class LoggingCommands {
  @Command({
    name: "setLogLevel",
    description: "Set the log level for the bot",
    usage: "setLogLevel(level)",
    examples: [
      "setLogLevel('debug')",
      "setLogLevel('info')",
      "setLogLevel('warn')",
      "setLogLevel('error')",
      "setLogLevel('none')"
    ],
    category: "Logging"
  })
  public setLogLevel(level: string): string {
    const levelMap: Record<string, LogLevel> = {
      debug: LogLevel.DEBUG,
      info: LogLevel.INFO,
      warn: LogLevel.WARN,
      error: LogLevel.ERROR,
      none: LogLevel.NONE
    };

    const logLevel = levelMap[level.toLowerCase()];
    if (logLevel === undefined) {
      return `Invalid log level: ${level}. Valid levels: debug, info, warn, error, none`;
    }

    configureLogger({ level: logLevel });
    return `Log level set to: ${level.toUpperCase()}`;
  }

  @Command({
    name: "toggleDebug",
    description: "Toggle debug mode on/off (affects log level and debug features)",
    usage: "toggleDebug()",
    examples: ["toggleDebug()"],
    category: "Logging"
  })
  public toggleDebug(): string {
    const config = getConfig();
    const newValue = !config.debug;
    updateConfig({ debug: newValue });
    configureLogger({ level: newValue ? LogLevel.DEBUG : LogLevel.INFO });
    return `Debug mode: ${newValue ? "ENABLED" : "DISABLED"} (Log level: ${newValue ? "DEBUG" : "INFO"})`;
  }
}

/**
 * Visualization commands
 */
class VisualizationCommands {
  @Command({
    name: "toggleVisualizations",
    description: "Toggle all visualizations on/off",
    usage: "toggleVisualizations()",
    examples: ["toggleVisualizations()"],
    category: "Visualization"
  })
  public toggleVisualizations(): string {
    const config = getConfig();
    const newValue = !config.visualizations;
    updateConfig({ visualizations: newValue });
    return `Visualizations: ${newValue ? "ENABLED" : "DISABLED"}`;
  }

  @Command({
    name: "toggleVisualization",
    description: "Toggle a specific visualization feature",
    usage: "toggleVisualization(key)",
    examples: [
      "toggleVisualization('showPheromones')",
      "toggleVisualization('showPaths')",
      "toggleVisualization('showRoles')"
    ],
    category: "Visualization"
  })
  public toggleVisualization(key: string): string {
    const config = roomVisualizer.getConfig();
    const validKeys = Object.keys(config).filter(
      k => k.startsWith("show") && typeof config[k as keyof typeof config] === "boolean"
    );

    if (!validKeys.includes(key)) {
      return `Invalid key: ${key}. Valid keys: ${validKeys.join(", ")}`;
    }

    const validKey = key as keyof typeof config;
    roomVisualizer.toggle(validKey);
    const newConfig = roomVisualizer.getConfig();
    const value = newConfig[validKey];
    return `Visualization '${key}': ${value ? "ENABLED" : "DISABLED"}`;
  }
}

/**
 * Statistics commands
 */
class StatisticsCommands {
  @Command({
    name: "showStats",
    description: "Show current bot statistics from memory segment",
    usage: "showStats()",
    examples: ["showStats()"],
    category: "Statistics"
  })
  public showStats(): string {
    const stats = memorySegmentStats.getLatestStats();
    if (!stats) {
      return "No stats available yet. Wait for a few ticks.";
    }

    return `=== SwarmBot Stats (Tick ${stats.tick}) ===
CPU: ${stats.cpuUsed.toFixed(2)}/${stats.cpuLimit} (Bucket: ${stats.cpuBucket})
GCL: ${stats.gclLevel} (${(stats.gclProgress * 100).toFixed(1)}%)
GPL: ${stats.gplLevel}
Creeps: ${stats.totalCreeps}
Rooms: ${stats.totalRooms}
${stats.rooms.map(r => `  ${r.roomName}: RCL${r.rcl} | ${r.creepCount} creeps | ${r.storageEnergy}E`).join("\n")}`;
  }

  @Command({
    name: "toggleProfiling",
    description: "Toggle CPU profiling on/off",
    usage: "toggleProfiling()",
    examples: ["toggleProfiling()"],
    category: "Statistics"
  })
  public toggleProfiling(): string {
    const config = getConfig();
    const newValue = !config.profiling;
    updateConfig({ profiling: newValue });
    profiler.setEnabled(newValue);
    configureLogger({ cpuLogging: newValue });
    return `Profiling: ${newValue ? "ENABLED" : "DISABLED"}`;
  }
}

/**
 * Configuration commands
 */
class ConfigurationCommands {
  @Command({
    name: "showConfig",
    description: "Show current bot configuration",
    usage: "showConfig()",
    examples: ["showConfig()"],
    category: "Configuration"
  })
  public showConfig(): string {
    const config = getConfig();
    const loggerConfig = getLoggerConfig();
    return `=== SwarmBot Config ===
Debug: ${String(config.debug)}
Profiling: ${String(config.profiling)}
Visualizations: ${String(config.visualizations)}
Logger Level: ${LogLevel[loggerConfig.level]}
CPU Logging: ${String(loggerConfig.cpuLogging)}`;
  }
}

/**
 * Kernel commands
 */
class KernelCommands {
  @Command({
    name: "showKernelStats",
    description: "Show kernel statistics including CPU usage and process info",
    usage: "showKernelStats()",
    examples: ["showKernelStats()"],
    category: "Kernel"
  })
  public showKernelStats(): string {
    const stats = kernel.getStatsSummary();
    const config = kernel.getConfig();
    const bucketMode = kernel.getBucketMode();

    let output = `=== Kernel Stats ===
Bucket Mode: ${bucketMode.toUpperCase()}
CPU Bucket: ${Game.cpu.bucket}
CPU Limit: ${kernel.getCpuLimit().toFixed(2)} (${(config.targetCpuUsage * 100).toFixed(0)}% of ${Game.cpu.limit})
Remaining CPU: ${kernel.getRemainingCpu().toFixed(2)}

Processes: ${stats.totalProcesses} total (${stats.activeProcesses} active, ${stats.suspendedProcesses} suspended)
Total CPU Used: ${stats.totalCpuUsed.toFixed(3)}
Avg CPU/Process: ${stats.avgCpuPerProcess.toFixed(4)}

Top CPU Consumers:`;

    for (const proc of stats.topCpuProcesses) {
      output += `\n  ${proc.name}: ${proc.avgCpu.toFixed(4)} avg CPU`;
    }

    return output;
  }

  @Command({
    name: "listProcesses",
    description: "List all registered kernel processes",
    usage: "listProcesses()",
    examples: ["listProcesses()"],
    category: "Kernel"
  })
  public listProcesses(): string {
    const processes = kernel.getProcesses();

    if (processes.length === 0) {
      return "No processes registered with kernel.";
    }

    let output = "=== Registered Processes ===\n";
    output += "ID | Name | Priority | Frequency | State | Runs | Avg CPU | Skipped | Errors\n";
    output += "-".repeat(90) + "\n";

    const sorted = [...processes].sort((a, b) => b.priority - a.priority);

    for (const p of sorted) {
      const avgCpu = p.stats.avgCpu.toFixed(4);
      output += `${p.id} | ${p.name} | ${p.priority} | ${p.frequency} | ${p.state} | ${p.stats.runCount} | ${avgCpu} | ${p.stats.skippedCount} | ${p.stats.errorCount}\n`;
    }

    return output;
  }

  @Command({
    name: "suspendProcess",
    description: "Suspend a kernel process by ID",
    usage: "suspendProcess(processId)",
    examples: ["suspendProcess('empire:manager')", "suspendProcess('cluster:manager')"],
    category: "Kernel"
  })
  public suspendProcess(processId: string): string {
    const success = kernel.suspendProcess(processId);
    if (success) {
      return `Process "${processId}" suspended.`;
    }
    return `Process "${processId}" not found.`;
  }

  @Command({
    name: "resumeProcess",
    description: "Resume a suspended kernel process",
    usage: "resumeProcess(processId)",
    examples: ["resumeProcess('empire:manager')"],
    category: "Kernel"
  })
  public resumeProcess(processId: string): string {
    const success = kernel.resumeProcess(processId);
    if (success) {
      return `Process "${processId}" resumed.`;
    }
    return `Process "${processId}" not found or not suspended.`;
  }

  @Command({
    name: "resetKernelStats",
    description: "Reset all kernel process statistics",
    usage: "resetKernelStats()",
    examples: ["resetKernelStats()"],
    category: "Kernel"
  })
  public resetKernelStats(): string {
    kernel.resetStats();
    return "Kernel statistics reset.";
  }
}

/**
 * System commands
 */
class SystemCommands {
  @Command({
    name: "listCommands",
    description: "List all available commands (alias for help)",
    usage: "listCommands()",
    examples: ["listCommands()"],
    category: "System"
  })
  public listCommands(): string {
    return commandRegistry.generateHelp();
  }

  @Command({
    name: "commandHelp",
    description: "Get detailed help for a specific command",
    usage: "commandHelp(commandName)",
    examples: ["commandHelp('setLogLevel')", "commandHelp('suspendProcess')"],
    category: "System"
  })
  public commandHelp(commandName: string): string {
    return commandRegistry.generateCommandHelp(commandName);
  }
}

// =============================================================================
// Command instances (singletons)
// =============================================================================

const loggingCommands = new LoggingCommands();
const visualizationCommands = new VisualizationCommands();
const statisticsCommands = new StatisticsCommands();
const configurationCommands = new ConfigurationCommands();
const kernelCommands = new KernelCommands();
const systemCommands = new SystemCommands();

/**
 * Register all console commands with the command registry
 */
export function registerAllConsoleCommands(): void {
  // Initialize command registry first
  commandRegistry.initialize();

  // Register decorated commands from all command class instances
  registerDecoratedCommands(loggingCommands);
  registerDecoratedCommands(visualizationCommands);
  registerDecoratedCommands(statisticsCommands);
  registerDecoratedCommands(configurationCommands);
  registerDecoratedCommands(kernelCommands);
  registerDecoratedCommands(systemCommands);

  // Expose all commands to global scope
  commandRegistry.exposeToGlobal();
}

// Export command classes for potential extension
export {
  loggingCommands,
  visualizationCommands,
  statisticsCommands,
  configurationCommands,
  kernelCommands,
  systemCommands
};
