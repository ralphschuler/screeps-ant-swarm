/**
 * Kernel - Central Process Management
 *
 * The kernel is the central coordinator for all processes in the bot:
 * - Process registration and lifecycle management
 * - CPU budget allocation and enforcement per process
 * - Priority-based process scheduling
 * - Process statistics tracking
 * - Centralized event system for inter-process communication
 *
 * Design Principles (from ROADMAP.md):
 * - Striktes Tick-Budget: Eco rooms ≤ 0.1 CPU, War rooms ≤ 0.25 CPU, Global overmind ≤ 1 CPU
 * - CPU-Bucket-gesteuertes Verhalten: High bucket enables expensive operations, low bucket restricts to core logic
 * - Frequenzebenen: High frequency (every tick), Medium (5-20 ticks), Low (≥100 ticks)
 * - Ereignisgetriebene Logik: Critical events trigger immediate updates
 */

import {
  EventBus,
  EventHandler,
  EventName,
  EventPayload,
  eventBus
} from "./events";
import type { CPUConfig } from "../config";
import { getConfig } from "../config";
import { logger } from "./logger";

/**
 * Process priority levels
 */
export enum ProcessPriority {
  CRITICAL = 100,  // Must run every tick (movement, spawns)
  HIGH = 75,       // High priority tasks (rooms, creeps)
  MEDIUM = 50,     // Standard tasks (pheromones, clusters)
  LOW = 25,        // Background tasks (empire, market)
  IDLE = 10        // Very low priority (visualizations, stats)
}

/**
 * Process frequency types
 */
export type ProcessFrequency = "high" | "medium" | "low";

/**
 * Process state
 */
export type ProcessState = "idle" | "running" | "suspended" | "error";

/**
 * Process statistics
 */
export interface ProcessStats {
  /** Total CPU used across all runs */
  totalCpu: number;
  /** Number of times process has run */
  runCount: number;
  /** Average CPU per run */
  avgCpu: number;
  /** Maximum CPU used in a single run */
  maxCpu: number;
  /** Last run tick */
  lastRunTick: number;
  /** Number of times process was skipped due to CPU */
  skippedCount: number;
  /** Number of errors */
  errorCount: number;
}

/**
 * Process definition
 */
export interface Process {
  /** Unique process ID */
  id: string;
  /** Display name */
  name: string;
  /** Process priority */
  priority: ProcessPriority;
  /** Process frequency */
  frequency: ProcessFrequency;
  /** Minimum CPU bucket to run */
  minBucket: number;
  /** CPU budget (fraction of limit, 0-1) */
  cpuBudget: number;
  /** Run interval in ticks (for medium/low frequency) */
  interval: number;
  /** Process execution function */
  execute: () => void;
  /** Current state */
  state: ProcessState;
  /** Statistics */
  stats: ProcessStats;
}

/**
 * Kernel configuration
 */
export interface KernelConfig {
  /** Low bucket threshold - enter conservation mode */
  lowBucketThreshold: number;
  /** High bucket threshold - allow expensive operations */
  highBucketThreshold: number;
  /** Critical bucket threshold - minimal processing only */
  criticalBucketThreshold: number;
  /** Target CPU usage (fraction of limit) */
  targetCpuUsage: number;
  /** Reserved CPU for finalization */
  reservedCpu: number;
  /** Enable process statistics */
  enableStats: boolean;
  /** Log interval for stats (ticks) */
  statsLogInterval: number;
  /** Default intervals for process frequencies */
  frequencyIntervals: Record<ProcessFrequency, number>;
  /** Default min bucket per frequency */
  frequencyMinBucket: Record<ProcessFrequency, number>;
  /** Default CPU budgets per frequency */
  frequencyCpuBudgets: Record<ProcessFrequency, number>;
  /**
   * Whether pixel generation is enabled.
   * When true, bucket thresholds account for the bucket being emptied
   * when pixels are generated (bucket goes from 10000 to 0).
   */
  pixelGenerationEnabled: boolean;
  /**
   * Number of ticks after pixel generation during which low bucket is expected.
   * Based on typical CPU limit and usage, bucket refills at ~(limit - usage) per tick.
   * Default assumes it takes ~100 ticks to reach a stable bucket level.
   */
  pixelRecoveryTicks: number;
}

/**
 * Bucket mode
 */
export type BucketMode = "critical" | "low" | "normal" | "high";

const BASE_CONFIG: Omit<KernelConfig, "lowBucketThreshold" | "highBucketThreshold" | "criticalBucketThreshold" | "frequencyIntervals" |
  "frequencyMinBucket" | "frequencyCpuBudgets"> = {
  targetCpuUsage: 0.85,
  reservedCpu: 5,
  enableStats: true,
  statsLogInterval: 100,
  pixelGenerationEnabled: true,
  pixelRecoveryTicks: 100
};

const DEFAULT_CRITICAL_DIVISOR = 2;

function deriveCriticalThreshold(lowBucketThreshold: number): number {
  return Math.max(0, Math.floor(lowBucketThreshold / DEFAULT_CRITICAL_DIVISOR));
}

function deriveFrequencyIntervals(taskFrequencies: CPUConfig["taskFrequencies"]): Record<ProcessFrequency, number> {
  return {
    high: 1,
    medium: Math.max(1, Math.min(taskFrequencies.clusterLogic, taskFrequencies.pheromoneUpdate)),
    low: Math.max(taskFrequencies.marketScan, taskFrequencies.nukeEvaluation, taskFrequencies.memoryCleanup)
  };
}

function deriveFrequencyMinBucket(bucketThresholds: CPUConfig["bucketThresholds"], highBucketThreshold: number): Record<ProcessFrequency, number> {
  return {
    high: Math.max(0, Math.floor(bucketThresholds.lowMode * 0.25)),
    medium: bucketThresholds.lowMode,
    low: Math.max(bucketThresholds.lowMode, Math.floor((bucketThresholds.lowMode + highBucketThreshold) / 2))
  };
}

function deriveFrequencyBudgets(budgets: CPUConfig["budgets"]): Record<ProcessFrequency, number> {
  return {
    high: budgets.rooms,
    medium: budgets.strategic,
    low: Math.max(budgets.market, budgets.visualization)
  };
}

export function buildKernelConfigFromCpu(cpuConfig: CPUConfig): KernelConfig {
  const highBucketThreshold = cpuConfig.bucketThresholds.highMode;
  const lowBucketThreshold = cpuConfig.bucketThresholds.lowMode;
  const criticalBucketThreshold = deriveCriticalThreshold(lowBucketThreshold);

  const frequencyIntervals = deriveFrequencyIntervals(cpuConfig.taskFrequencies);
  const frequencyMinBucket = deriveFrequencyMinBucket(cpuConfig.bucketThresholds, highBucketThreshold);
  const frequencyCpuBudgets = deriveFrequencyBudgets(cpuConfig.budgets);

  return {
    ...BASE_CONFIG,
    lowBucketThreshold,
    highBucketThreshold,
    criticalBucketThreshold,
    frequencyIntervals,
    frequencyMinBucket,
    frequencyCpuBudgets
  };
}

interface FrequencyDefaults { interval: number; minBucket: number; cpuBudget: number }

/**
 * Kernel - Central Process Manager
 */
export class Kernel {
  private config: KernelConfig;
  private processes: Map<string, Process> = new Map();
  private bucketMode: BucketMode = "normal";
  private tickCpuUsed = 0;
  private initialized = false;
  /** Tick when a pixel was last generated (0 if none tracked) */
  private lastPixelGenerationTick = 0;
  private frequencyDefaults: Record<ProcessFrequency, FrequencyDefaults>;

  public constructor(config: KernelConfig) {
    this.config = { ...config };
    this.validateConfig();
    this.frequencyDefaults = this.buildFrequencyDefaults();
  }

  /**
   * Register a process with the kernel
   */
  public registerProcess(options: {
    id: string;
    name: string;
    priority?: ProcessPriority;
    frequency?: ProcessFrequency;
    minBucket?: number;
    cpuBudget?: number;
    interval?: number;
    execute: () => void;
  }): void {
    const frequency = options.frequency ?? "medium";
    const defaults = this.frequencyDefaults[frequency];

    const process: Process = {
      id: options.id,
      name: options.name,
      priority: options.priority ?? ProcessPriority.MEDIUM,
      frequency,
      minBucket: options.minBucket ?? defaults.minBucket,
      cpuBudget: options.cpuBudget ?? defaults.cpuBudget,
      interval: options.interval ?? defaults.interval,
      execute: options.execute,
      state: "idle",
      stats: {
        totalCpu: 0,
        runCount: 0,
        avgCpu: 0,
        maxCpu: 0,
        lastRunTick: 0,
        skippedCount: 0,
        errorCount: 0
      }
    };

    this.processes.set(options.id, process);
    logger.debug(`Kernel: Registered process "${process.name}" (${process.id})`, { subsystem: "Kernel" });
  }

  /**
   * Unregister a process
   */
  public unregisterProcess(id: string): boolean {
    const deleted = this.processes.delete(id);
    if (deleted) {
      logger.debug(`Kernel: Unregistered process ${id}`, { subsystem: "Kernel" });
    }
    return deleted;
  }

  /**
   * Get a registered process
   */
  public getProcess(id: string): Process | undefined {
    return this.processes.get(id);
  }

  /**
   * Get all registered processes
   */
  public getProcesses(): Process[] {
    return Array.from(this.processes.values());
  }

  /**
   * Initialize the kernel (call once at start of first tick)
   */
  public initialize(): void {
    if (this.initialized) return;
    
    logger.info(`Kernel initialized with ${this.processes.size} processes`, { subsystem: "Kernel" });
    this.initialized = true;
  }

  /**
   * Determine current bucket mode.
   * When pixel generation is enabled, accounts for the recovery period
   * after a pixel is generated (bucket drops from 10000 to 0).
   */
  private updateBucketMode(): void {
    const bucket = Game.cpu.bucket;
    let newMode: BucketMode;

    // Check if we're in the pixel recovery period
    const inPixelRecovery = this.isInPixelRecoveryPeriod();

    if (bucket < this.config.criticalBucketThreshold && !inPixelRecovery) {
      // Only enter critical mode if we're NOT recovering from pixel generation
      newMode = "critical";
    } else if (bucket < this.config.lowBucketThreshold && !inPixelRecovery) {
      // Only enter low mode if we're NOT recovering from pixel generation
      newMode = "low";
    } else if (bucket > this.config.highBucketThreshold) {
      newMode = "high";
    } else {
      newMode = "normal";
    }

    if (newMode !== this.bucketMode) {
      logger.info(`Kernel: Bucket mode changed from ${this.bucketMode} to ${newMode} (bucket: ${bucket}${inPixelRecovery ? ", recovering from pixel" : ""})`, {
        subsystem: "Kernel"
      });
      this.bucketMode = newMode;
    }
  }

  private validateConfig(): void {
    if (this.config.criticalBucketThreshold >= this.config.lowBucketThreshold) {
      logger.warn(
        `Kernel: Adjusting critical bucket threshold ${this.config.criticalBucketThreshold} to stay below low threshold ${this.config.lowBucketThreshold}`,
        { subsystem: "Kernel" }
      );
      this.config.criticalBucketThreshold = Math.max(0, this.config.lowBucketThreshold - 1);
    }

    if (this.config.lowBucketThreshold >= this.config.highBucketThreshold) {
      logger.warn(
        `Kernel: Adjusting high bucket threshold ${this.config.highBucketThreshold} to stay above low threshold ${this.config.lowBucketThreshold}`,
        { subsystem: "Kernel" }
      );
      this.config.highBucketThreshold = this.config.lowBucketThreshold + 1;
    }
  }

  private buildFrequencyDefaults(): Record<ProcessFrequency, FrequencyDefaults> {
    return {
      high: {
        interval: this.config.frequencyIntervals.high,
        minBucket: this.config.frequencyMinBucket.high,
        cpuBudget: this.config.frequencyCpuBudgets.high
      },
      medium: {
        interval: this.config.frequencyIntervals.medium,
        minBucket: this.config.frequencyMinBucket.medium,
        cpuBudget: this.config.frequencyCpuBudgets.medium
      },
      low: {
        interval: this.config.frequencyIntervals.low,
        minBucket: this.config.frequencyMinBucket.low,
        cpuBudget: this.config.frequencyCpuBudgets.low
      }
    };
  }

  /**
   * Check if we're in the recovery period after pixel generation.
   * During this period, low bucket is expected and shouldn't trigger
   * conservation modes.
   */
  private isInPixelRecoveryPeriod(): boolean {
    if (!this.config.pixelGenerationEnabled) {
      return false;
    }
    
    // If no pixel generation has been tracked yet (lastPixelGenerationTick === 0),
    // we don't assume recovery mode. This is conservative: the bot may enter
    // low/critical mode briefly until the first pixel is generated and tracked.
    // This is safer than assuming all low bucket states are due to pixel generation.
    if (this.lastPixelGenerationTick === 0) {
      return false;
    }
    
    const ticksSincePixel = Game.time - this.lastPixelGenerationTick;
    return ticksSincePixel < this.config.pixelRecoveryTicks;
  }

  /**
   * Notify the kernel that a pixel was generated.
   * This helps the kernel understand that low bucket is expected
   * and shouldn't trigger conservation modes.
   */
  public notifyPixelGenerated(): void {
    this.lastPixelGenerationTick = Game.time;
    logger.debug(`Kernel: Pixel generated at tick ${Game.time}, recovery period started`, { subsystem: "Kernel" });
  }

  /**
   * Get current bucket mode.
   * Ensures the bucket mode is up-to-date before returning.
   */
  public getBucketMode(): BucketMode {
    this.updateBucketMode();
    return this.bucketMode;
  }

  /**
   * Get CPU limit for current tick
   */
  public getCpuLimit(): number {
    const baseLimit = Game.cpu.limit;

    switch (this.bucketMode) {
      case "critical":
        return baseLimit * 0.3;
      case "low":
        return baseLimit * 0.5;
      case "high":
        return baseLimit * this.config.targetCpuUsage;
      default:
        return baseLimit * this.config.targetCpuUsage;
    }
  }

  /**
   * Check if CPU budget is available
   */
  public hasCpuBudget(): boolean {
    const used = Game.cpu.getUsed();
    const limit = this.getCpuLimit();
    return (limit - used) > this.config.reservedCpu;
  }

  /**
   * Get remaining CPU budget
   */
  public getRemainingCpu(): number {
    return Math.max(0, this.getCpuLimit() - Game.cpu.getUsed() - this.config.reservedCpu);
  }

  /**
   * Check if process should run this tick
   */
  private shouldRunProcess(process: Process): boolean {
    // Check bucket requirement
    if (Game.cpu.bucket < process.minBucket) {
      return false;
    }

    // Check interval
    const ticksSinceRun = Game.time - process.stats.lastRunTick;
    if (ticksSinceRun < process.interval) {
      return false;
    }

    // In critical bucket mode, only run CRITICAL priority processes
    if (this.bucketMode === "critical") {
      return process.priority >= ProcessPriority.CRITICAL;
    }

    // In low bucket mode, only run HIGH priority or higher processes
    // (This includes CRITICAL and HIGH, regardless of frequency)
    if (this.bucketMode === "low") {
      return process.priority >= ProcessPriority.HIGH;
    }

    // Check if suspended
    if (process.state === "suspended") {
      return false;
    }

    return true;
  }

  /**
   * Execute a single process with CPU tracking
   */
  private executeProcess(process: Process): void {
    const cpuBefore = Game.cpu.getUsed();
    process.state = "running";

    try {
      process.execute();
      process.state = "idle";
    } catch (err) {
      process.state = "error";
      process.stats.errorCount++;
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error(`Kernel: Process "${process.name}" error: ${errorMessage}`, { subsystem: "Kernel" });
      if (err instanceof Error && err.stack) {
        logger.error(err.stack, { subsystem: "Kernel" });
      }
    }

    const cpuUsed = Game.cpu.getUsed() - cpuBefore;

    // Update statistics
    if (this.config.enableStats) {
      process.stats.totalCpu += cpuUsed;
      process.stats.runCount++;
      process.stats.avgCpu = process.stats.totalCpu / process.stats.runCount;
      process.stats.maxCpu = Math.max(process.stats.maxCpu, cpuUsed);
      process.stats.lastRunTick = Game.time;
    }

    this.tickCpuUsed += cpuUsed;

    // Check CPU budget violation
    const budgetLimit = this.getCpuLimit() * process.cpuBudget;
    if (cpuUsed > budgetLimit && Game.time % 50 === 0) {
      logger.warn(
        `Kernel: Process "${process.name}" exceeded CPU budget: ${cpuUsed.toFixed(3)} > ${budgetLimit.toFixed(3)}`,
        { subsystem: "Kernel" }
      );
    }
  }

  /**
   * Run all scheduled processes for this tick
   */
  public run(): void {
    this.updateBucketMode();
    this.tickCpuUsed = 0;

    // Process queued events from previous ticks
    eventBus.processQueue();

    // Sort processes by priority (highest first)
    const sortedProcesses = Array.from(this.processes.values())
      .sort((a, b) => b.priority - a.priority);

    let processesRun = 0;
    let processesSkipped = 0;

    for (const process of sortedProcesses) {
      // Check if we should run this process
      if (!this.shouldRunProcess(process)) {
        continue;
      }

      // Check overall CPU budget
      if (!this.hasCpuBudget()) {
        processesSkipped++;
        process.stats.skippedCount++;
        continue;
      }

      // Execute the process
      this.executeProcess(process);
      processesRun++;
    }

    // Log stats periodically
    if (this.config.enableStats && Game.time % this.config.statsLogInterval === 0) {
      this.logStats(processesRun, processesSkipped);
      eventBus.logStats();
    }
  }

  /**
   * Log kernel statistics
   */
  private logStats(processesRun: number, processesSkipped: number): void {
    logger.debug(
      `Kernel stats: ${processesRun} ran, ${processesSkipped} skipped, ${this.tickCpuUsed.toFixed(2)} CPU, mode: ${this.bucketMode}`,
      { subsystem: "Kernel" }
    );
  }

  /**
   * Get tick CPU used by kernel
   */
  public getTickCpuUsed(): number {
    return this.tickCpuUsed;
  }

  /**
   * Suspend a process
   */
  public suspendProcess(id: string): boolean {
    const process = this.processes.get(id);
    if (process) {
      process.state = "suspended";
      logger.info(`Kernel: Suspended process "${process.name}"`, { subsystem: "Kernel" });
      return true;
    }
    return false;
  }

  /**
   * Resume a suspended process
   */
  public resumeProcess(id: string): boolean {
    const process = this.processes.get(id);
    if (process && process.state === "suspended") {
      process.state = "idle";
      logger.info(`Kernel: Resumed process "${process.name}"`, { subsystem: "Kernel" });
      return true;
    }
    return false;
  }

  /**
   * Get process statistics summary
   */
  public getStatsSummary(): {
    totalProcesses: number;
    activeProcesses: number;
    suspendedProcesses: number;
    totalCpuUsed: number;
    avgCpuPerProcess: number;
    topCpuProcesses: { name: string; avgCpu: number }[];
  } {
    const processes = Array.from(this.processes.values());
    const active = processes.filter(p => p.state !== "suspended");
    const suspended = processes.filter(p => p.state === "suspended");
    
    const totalCpu = processes.reduce((sum, p) => sum + p.stats.totalCpu, 0);
    const avgCpu = processes.length > 0 ? totalCpu / processes.length : 0;
    
    const topCpu = [...processes]
      .sort((a, b) => b.stats.avgCpu - a.stats.avgCpu)
      .slice(0, 5)
      .map(p => ({ name: p.name, avgCpu: p.stats.avgCpu }));

    return {
      totalProcesses: processes.length,
      activeProcesses: active.length,
      suspendedProcesses: suspended.length,
      totalCpuUsed: totalCpu,
      avgCpuPerProcess: avgCpu,
      topCpuProcesses: topCpu
    };
  }

  /**
   * Reset all process statistics
   */
  public resetStats(): void {
    for (const process of this.processes.values()) {
      process.stats = {
        totalCpu: 0,
        runCount: 0,
        avgCpu: 0,
        maxCpu: 0,
        lastRunTick: 0,
        skippedCount: 0,
        errorCount: 0
      };
    }
    logger.info("Kernel: Reset all process statistics", { subsystem: "Kernel" });
  }

  /**
   * Get kernel configuration
   */
  public getConfig(): KernelConfig {
    return { ...this.config };
  }

  /**
   * Get frequency defaults for a process frequency
   */
  public getFrequencyDefaults(frequency: ProcessFrequency): FrequencyDefaults {
    return { ...this.frequencyDefaults[frequency] };
  }

  /**
   * Update kernel configuration
   */
  public updateConfig(config: Partial<KernelConfig>): void {
    this.config = { ...this.config, ...config };
    this.validateConfig();
    this.frequencyDefaults = this.buildFrequencyDefaults();
  }

  /**
   * Update kernel configuration from CPU config
   */
  public updateFromCpuConfig(cpuConfig: CPUConfig): void {
    this.updateConfig(buildKernelConfigFromCpu(cpuConfig));
  }

  // ===========================================================================
  // Event System Methods
  // ===========================================================================

  /**
   * Subscribe to an event
   *
   * Provides type-safe event subscription through the kernel.
   * Events are processed according to bucket status and priority.
   *
   * @param eventName - Name of the event to subscribe to
   * @param handler - Handler function called when event is emitted
   * @param options - Subscription options
   * @returns Unsubscribe function
   *
   * @example
   * ```typescript
   * kernel.on('hostile.detected', (event) => {
   *   console.log(`Hostile in ${event.roomName}!`);
   * });
   * ```
   */
  public on<T extends EventName>(
    eventName: T,
    handler: EventHandler<T>,
    options: {
      priority?: number;
      minBucket?: number;
      once?: boolean;
    } = {}
  ): () => void {
    return eventBus.on(eventName, handler, options);
  }

  /**
   * Subscribe to an event (one-time)
   *
   * Handler is automatically unsubscribed after first invocation.
   *
   * @param eventName - Name of the event to subscribe to
   * @param handler - Handler function called once when event is emitted
   * @param options - Subscription options
   * @returns Unsubscribe function
   */
  public once<T extends EventName>(
    eventName: T,
    handler: EventHandler<T>,
    options: { priority?: number; minBucket?: number } = {}
  ): () => void {
    return eventBus.once(eventName, handler, options);
  }

  /**
   * Emit an event
   *
   * Emits a type-safe event that will be processed by all registered handlers.
   * Events are bucket-aware:
   * - Critical events are always processed immediately
   * - High-priority events are queued in low bucket
   * - Low-priority events may be dropped in critical bucket
   *
   * @param eventName - Name of the event to emit
   * @param payload - Event payload (tick is added automatically)
   * @param options - Emission options
   *
   * @example
   * ```typescript
   * kernel.emit('hostile.detected', {
   *   roomName: 'W1N1',
   *   hostileId: creep.id,
   *   hostileOwner: creep.owner.username,
   *   bodyParts: creep.body.length,
   *   threatLevel: 2
   * });
   * ```
   */
  public emit<T extends EventName>(
    eventName: T,
    payload: Omit<EventPayload<T>, "tick">,
    options: {
      immediate?: boolean;
      priority?: number;
    } = {}
  ): void {
    eventBus.emit(eventName, payload, options);
  }

  /**
   * Remove all handlers for an event
   *
   * @param eventName - Name of the event to clear handlers for
   */
  public offAll(eventName: EventName): void {
    eventBus.offAll(eventName);
  }

  /**
   * Process queued events
   *
   * Should be called each tick to process events that were deferred
   * due to low bucket status. This is automatically called by run().
   */
  public processEvents(): void {
    eventBus.processQueue();
  }

  /**
   * Get event bus statistics
   */
  public getEventStats(): ReturnType<EventBus["getStats"]> {
    return eventBus.getStats();
  }

  /**
   * Check if there are handlers for an event
   *
   * @param eventName - Name of the event to check
   */
  public hasEventHandlers(eventName: EventName): boolean {
    return eventBus.hasHandlers(eventName);
  }

  /**
   * Get the event bus instance for advanced usage
   *
   * Prefer using kernel.on() and kernel.emit() for standard usage.
   */
  public getEventBus(): EventBus {
    return eventBus;
  }
}

/**
 * Global kernel instance
 */
export const kernel = new Kernel(buildKernelConfigFromCpu(getConfig().cpu));

// =============================================================================
// Helper functions for process registration
// =============================================================================

/**
 * Create a high-frequency process (runs every tick)
 */
export function createHighFrequencyProcess(
  id: string,
  name: string,
  execute: () => void,
  priority = ProcessPriority.HIGH
): Parameters<Kernel["registerProcess"]>[0] {
  const defaults = kernel.getFrequencyDefaults("high");
  return {
    id,
    name,
    execute,
    priority,
    frequency: "high",
    minBucket: defaults.minBucket,
    cpuBudget: defaults.cpuBudget,
    interval: defaults.interval
  };
}

/**
 * Create a medium-frequency process (runs every 5-10 ticks)
 */
export function createMediumFrequencyProcess(
  id: string,
  name: string,
  execute: () => void,
  priority = ProcessPriority.MEDIUM
): Parameters<Kernel["registerProcess"]>[0] {
  const defaults = kernel.getFrequencyDefaults("medium");
  return {
    id,
    name,
    execute,
    priority,
    frequency: "medium",
    minBucket: defaults.minBucket,
    cpuBudget: defaults.cpuBudget,
    interval: defaults.interval
  };
}

/**
 * Create a low-frequency process (runs every 20+ ticks)
 */
export function createLowFrequencyProcess(
  id: string,
  name: string,
  execute: () => void,
  priority = ProcessPriority.LOW
): Parameters<Kernel["registerProcess"]>[0] {
  const defaults = kernel.getFrequencyDefaults("low");
  return {
    id,
    name,
    execute,
    priority,
    frequency: "low",
    minBucket: defaults.minBucket,
    cpuBudget: defaults.cpuBudget,
    interval: defaults.interval
  };
}
