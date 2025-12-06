/**
 * Memory Segment Stats Manager
 *
 * Manages statistics persistence using Memory Segments:
 * - Aggregated stats storage
 * - Performance metrics
 * - Historical data tracking
 * - External monitoring integration
 *
 * Addresses Issue: #35
 */

import { logger } from "../core/logger";
import { memoryManager } from "../memory/manager";
import { EvolutionStage, PheromoneState, RoomPosture } from "../memory/schemas";

/**
 * Stats segment configuration
 */
export interface StatsConfig {
  /** Primary segment ID for stats */
  primarySegment: number;
  /** Backup segment ID */
  backupSegment: number;
  /** Stats retention period in ticks */
  retentionPeriod: number;
  /** Update interval in ticks */
  updateInterval: number;
  /** Maximum data points per metric */
  maxDataPoints: number;
}

const DEFAULT_CONFIG: StatsConfig = {
  primarySegment: 90,
  backupSegment: 91,
  retentionPeriod: 10000,
  updateInterval: 10,
  maxDataPoints: 1000
};

const POSTURE_CODES: Record<RoomPosture, number> = {
  eco: 0,
  expand: 1,
  defensive: 2,
  war: 3,
  siege: 4,
  evacuate: 5,
  nukePrep: 6
};

const COLONY_LEVEL_CODES: Record<EvolutionStage, number> = {
  seedNest: 1,
  foragingExpansion: 2,
  matureColony: 3,
  fortifiedHive: 4,
  empireDominance: 5
};

/**
 * Single metric data point
 */
export interface MetricPoint {
  /** Game tick */
  tick: number;
  /** Value */
  value: number;
}

/**
 * Metric series
 */
export interface MetricSeries {
  /** Metric name */
  name: string;
  /** Data points */
  data: MetricPoint[];
  /** Last update tick */
  lastUpdate: number;
  /** Minimum value */
  min: number;
  /** Maximum value */
  max: number;
  /** Average value */
  avg: number;
}

/**
 * Room-level stats
 */
export interface RoomStats {
  /** Room name */
  roomName: string;
  /** RCL */
  rcl: number;
  /** Energy available */
  energyAvailable: number;
  /** Energy capacity */
  energyCapacity: number;
  /** Storage energy */
  storageEnergy: number;
  /** Terminal energy */
  terminalEnergy: number;
  /** Creep count */
  creepCount: number;
  /** Controller progress */
  controllerProgress: number;
  /** Controller progress total */
  controllerProgressTotal: number;
}

/**
 * Global stats
 */
export interface GlobalStats {
  /** Tick */
  tick: number;
  /** CPU used */
  cpuUsed: number;
  /** CPU limit */
  cpuLimit: number;
  /** CPU bucket */
  cpuBucket: number;
  /** GCL level */
  gclLevel: number;
  /** GCL progress */
  gclProgress: number;
  /** GPL level */
  gplLevel: number;
  /** Total creeps */
  totalCreeps: number;
  /** Total rooms */
  totalRooms: number;
  /** Room stats */
  rooms: RoomStats[];
  /** Custom metrics */
  metrics: Record<string, number>;
}

/**
 * Stats data structure
 */
export interface StatsData {
  /** Version */
  version: number;
  /** Last update tick */
  lastUpdate: number;
  /** Global stats history */
  history: GlobalStats[];
  /** Metric series */
  series: Record<string, MetricSeries>;
}

/**
 * Memory Segment Stats Manager
 */
export class MemorySegmentStats {
  private config: StatsConfig;
  private statsData: StatsData | null = null;
  private segmentRequested = false;
  private lastUpdate = 0;

  public constructor(config: Partial<StatsConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize stats manager
   */
  public initialize(): void {
    // Request the segment
    RawMemory.setActiveSegments([this.config.primarySegment]);
    this.segmentRequested = true;
  }

  /**
   * Main tick - update stats
   */
  public run(): void {
    // Check if segment is available
    if (this.segmentRequested && RawMemory.segments[this.config.primarySegment] !== undefined) {
      this.loadFromSegment();
      this.segmentRequested = false;
    }

    // Update stats periodically
    if (Game.time - this.lastUpdate >= this.config.updateInterval) {
      this.updateStats();
      this.lastUpdate = Game.time;
    }
  }

  /**
   * Load stats from segment
   */
  private loadFromSegment(): void {
    const raw = RawMemory.segments[this.config.primarySegment];
    if (!raw || raw.length === 0) {
      this.statsData = this.createDefaultStatsData();
      return;
    }

    try {
      this.statsData = JSON.parse(raw) as StatsData;
      logger.debug("Loaded stats from segment", { subsystem: "Stats" });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error(`Failed to parse stats segment: ${errorMessage}`, { subsystem: "Stats" });
      this.statsData = this.createDefaultStatsData();
    }
  }

  /**
   * Create default stats data
   */
  private createDefaultStatsData(): StatsData {
    return {
      version: 1,
      lastUpdate: Game.time,
      history: [],
      series: {}
    };
  }

  /**
   * Update stats
   */
  private updateStats(): void {
    if (!this.statsData) {
      this.statsData = this.createDefaultStatsData();
    }

    // Collect global stats
    const globalStats = this.collectGlobalStats();

    // Add to history
    this.statsData.history.push(globalStats);

    // Trim old history
    while (this.statsData.history.length > this.config.maxDataPoints) {
      this.statsData.history.shift();
    }

    // Remove expired entries
    const cutoff = Game.time - this.config.retentionPeriod;
    this.statsData.history = this.statsData.history.filter(h => h.tick >= cutoff);

    // Update metric series
    this.updateMetricSeries("cpu", globalStats.cpuUsed);
    this.updateMetricSeries("bucket", globalStats.cpuBucket);
    this.updateMetricSeries("creeps", globalStats.totalCreeps);
    this.updateMetricSeries("rooms", globalStats.totalRooms);

    // Publish stats to Memory.stats for the Influx exporter
    this.publishStatsToMemory(globalStats);

    // Save to segment
    this.saveToSegment();
  }

  /**
   * Publish stats to Memory.stats for the Influx exporter.
   * Uses a flat key structure with dot-separated names for easy ingestion.
   */
  private publishStatsToMemory(stats: GlobalStats): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mem = Memory as unknown as Record<string, Record<string, number>>;
    if (!mem.stats || typeof mem.stats !== "object") {
      mem.stats = {} as Record<string, number>;
    }
    const statsRoot = mem.stats;

    // Remove deprecated keys to keep naming consistent
    delete (statsRoot as Record<string, number | undefined>).tick;
    delete (statsRoot as Record<string, number | undefined>).timestamp;

    // Global CPU metrics
    statsRoot["cpu.used"] = stats.cpuUsed;
    statsRoot["cpu.limit"] = stats.cpuLimit;
    statsRoot["cpu.bucket"] = stats.cpuBucket;
    statsRoot["cpu.percent"] = (stats.cpuUsed / stats.cpuLimit) * 100;

    // GCL/GPL metrics
    statsRoot["gcl.level"] = stats.gclLevel;
    statsRoot["gcl.progress"] = stats.gclProgress;
    statsRoot["gpl.level"] = stats.gplLevel;

    // Empire metrics
    statsRoot["empire.creeps"] = stats.totalCreeps;
    statsRoot["empire.rooms"] = stats.totalRooms;

    // Per-room metrics
    let totalStorageEnergy = 0;
    let totalTerminalEnergy = 0;
    let totalEnergyAvailable = 0;
    let totalEnergyCapacity = 0;

    for (const room of stats.rooms) {
      const roomPrefix = `room.${room.roomName}`;

      delete (statsRoot as Record<string, number | undefined>)[`${roomPrefix}.controller.progressPercent`];
      delete (statsRoot as Record<string, number | undefined>)[`${roomPrefix}.controller.progressTotal`];

      statsRoot[`${roomPrefix}.rcl`] = room.rcl;
      statsRoot[`${roomPrefix}.energy.available`] = room.energyAvailable;
      statsRoot[`${roomPrefix}.energy.capacity`] = room.energyCapacity;
      statsRoot[`${roomPrefix}.storage.energy`] = room.storageEnergy;
      statsRoot[`${roomPrefix}.terminal.energy`] = room.terminalEnergy;
      statsRoot[`${roomPrefix}.creeps`] = room.creepCount;
      statsRoot[`${roomPrefix}.controller.progress`] = room.controllerProgress;
      statsRoot[`${roomPrefix}.controller.progress_total`] = room.controllerProgressTotal;
      statsRoot[`${roomPrefix}.controller.progress_percent`] =
        room.controllerProgressTotal > 0
          ? (room.controllerProgress / room.controllerProgressTotal) * 100
          : 0;

      const swarm = memoryManager.getSwarmState(room.roomName);
      if (swarm) {
        statsRoot[`${roomPrefix}.brain.danger`] = swarm.danger;
        statsRoot[`${roomPrefix}.brain.posture_code`] = POSTURE_CODES[swarm.posture];
        statsRoot[`${roomPrefix}.brain.colony_level_code`] = COLONY_LEVEL_CODES[swarm.colonyLevel];

        for (const [pheromone, value] of Object.entries(swarm.pheromones )) {
          statsRoot[`${roomPrefix}.pheromone.${pheromone}`] = value;
        }

        const metrics = swarm.metrics;
        statsRoot[`${roomPrefix}.metrics.energy.harvested`] = metrics.energyHarvested;
        statsRoot[`${roomPrefix}.metrics.energy.spawning`] = metrics.energySpawning;
        statsRoot[`${roomPrefix}.metrics.energy.construction`] = metrics.energyConstruction;
        statsRoot[`${roomPrefix}.metrics.energy.repair`] = metrics.energyRepair;
        statsRoot[`${roomPrefix}.metrics.energy.tower`] = metrics.energyTower;
        statsRoot[`${roomPrefix}.metrics.controller_progress`] = metrics.controllerProgress;
        statsRoot[`${roomPrefix}.metrics.hostile_count`] = metrics.hostileCount;
        statsRoot[`${roomPrefix}.metrics.damage_received`] = metrics.damageReceived;
        statsRoot[`${roomPrefix}.metrics.construction_sites`] = metrics.constructionSites;
      }

      totalStorageEnergy += room.storageEnergy;
      totalTerminalEnergy += room.terminalEnergy;
      totalEnergyAvailable += room.energyAvailable;
      totalEnergyCapacity += room.energyCapacity;
    }

    // Aggregated empire energy metrics
    statsRoot["empire.energy.storage"] = totalStorageEnergy;
    statsRoot["empire.energy.terminal"] = totalTerminalEnergy;
    statsRoot["empire.energy.available"] = totalEnergyAvailable;
    statsRoot["empire.energy.capacity"] = totalEnergyCapacity;

    // Tick info
    statsRoot["system.tick"] = stats.tick;
    statsRoot["system.timestamp"] = Date.now();
  }

  /**
   * Collect global stats
   */
  private collectGlobalStats(): GlobalStats {
    const ownedRooms = Object.values(Game.rooms).filter(r => r.controller?.my);

    const roomStats: RoomStats[] = ownedRooms.map(room => ({
      roomName: room.name,
      rcl: room.controller?.level ?? 0,
      energyAvailable: room.energyAvailable,
      energyCapacity: room.energyCapacityAvailable,
      storageEnergy: room.storage?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0,
      terminalEnergy: room.terminal?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0,
      creepCount: room.find(FIND_MY_CREEPS).length,
      controllerProgress: room.controller?.progress ?? 0,
      controllerProgressTotal: room.controller?.progressTotal ?? 1
    }));

    return {
      tick: Game.time,
      cpuUsed: Game.cpu.getUsed(),
      cpuLimit: Game.cpu.limit,
      cpuBucket: Game.cpu.bucket,
      gclLevel: Game.gcl.level,
      gclProgress: Game.gcl.progress / Game.gcl.progressTotal,
      gplLevel: Game.gpl?.level ?? 0,
      totalCreeps: Object.keys(Game.creeps).length,
      totalRooms: ownedRooms.length,
      rooms: roomStats,
      metrics: {}
    };
  }

  /**
   * Update a metric series
   */
  private updateMetricSeries(name: string, value: number): void {
    if (!this.statsData) return;

    let series = this.statsData.series[name];
    if (!series) {
      series = {
        name,
        data: [],
        lastUpdate: Game.time,
        min: value,
        max: value,
        avg: value
      };
      this.statsData.series[name] = series;
    }

    // Add data point
    series.data.push({ tick: Game.time, value });
    series.lastUpdate = Game.time;

    // Trim old data
    const cutoff = Game.time - this.config.retentionPeriod;
    series.data = series.data.filter(d => d.tick >= cutoff);

    while (series.data.length > this.config.maxDataPoints) {
      series.data.shift();
    }

    // Update stats
    if (series.data.length > 0) {
      series.min = Math.min(...series.data.map(d => d.value));
      series.max = Math.max(...series.data.map(d => d.value));
      series.avg = series.data.reduce((sum, d) => sum + d.value, 0) / series.data.length;
    }
  }

  /**
   * Save stats to segment
   */
  private saveToSegment(): void {
    if (!this.statsData) return;

    const SEGMENT_SIZE_LIMIT = 100 * 1024; // 100 KB
    const MIN_ENTRIES = 10; // Minimum entries to keep during normal trimming
    const MINIMAL_ENTRIES = 5; // Minimal entries to keep as last resort

    try {
      this.statsData.lastUpdate = Game.time;
      let json = JSON.stringify(this.statsData);

      // Check size limit (100KB per segment)
      if (json.length > SEGMENT_SIZE_LIMIT) {
        logger.warn(`Stats data exceeds segment limit: ${json.length} bytes, trimming...`, {
          subsystem: "Stats"
        });

        // Trim history first (keep at least MIN_ENTRIES)
        while (json.length > SEGMENT_SIZE_LIMIT && this.statsData.history.length > MIN_ENTRIES) {
          this.statsData.history.shift();
          json = JSON.stringify(this.statsData);
        }

        // If still too large, trim metric series data
        if (json.length > SEGMENT_SIZE_LIMIT) {
          for (const seriesName of Object.keys(this.statsData.series)) {
            const series = this.statsData.series[seriesName];
            while (series.data.length > MIN_ENTRIES && json.length > SEGMENT_SIZE_LIMIT) {
              series.data.shift();
              json = JSON.stringify(this.statsData);
            }
          }
        }

        // If still too large, reduce to minimal data
        if (json.length > SEGMENT_SIZE_LIMIT) {
          logger.warn(`Stats data still exceeds limit after trimming, clearing history`, {
            subsystem: "Stats"
          });
          this.statsData.history = this.statsData.history.slice(-MINIMAL_ENTRIES);
          for (const seriesName of Object.keys(this.statsData.series)) {
            this.statsData.series[seriesName].data = this.statsData.series[seriesName].data.slice(-MINIMAL_ENTRIES);
          }
          json = JSON.stringify(this.statsData);
        }
      }

      RawMemory.segments[this.config.primarySegment] = json;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error(`Failed to save stats segment: ${errorMessage}`, { subsystem: "Stats" });
    }
  }

  /**
   * Record a custom metric
   */
  public recordMetric(name: string, value: number): void {
    this.updateMetricSeries(name, value);
  }

  /**
   * Get latest global stats
   */
  public getLatestStats(): GlobalStats | null {
    if (!this.statsData || this.statsData.history.length === 0) {
      return null;
    }
    return this.statsData.history[this.statsData.history.length - 1] ?? null;
  }

  /**
   * Get metric series
   */
  public getMetricSeries(name: string): MetricSeries | null {
    return this.statsData?.series[name] ?? null;
  }

  /**
   * Get all metric series names
   */
  public getMetricNames(): string[] {
    return Object.keys(this.statsData?.series ?? {});
  }

  /**
   * Get stats history
   */
  public getHistory(limit?: number): GlobalStats[] {
    if (!this.statsData) return [];
    const history = this.statsData.history;
    return limit ? history.slice(-limit) : history;
  }

  /**
   * Get room-specific history
   */
  public getRoomHistory(roomName: string, limit?: number): RoomStats[] {
    if (!this.statsData) return [];

    const roomHistory = this.statsData.history
      .map(h => h.rooms.find(r => r.roomName === roomName))
      .filter((r): r is RoomStats => r !== undefined);

    return limit ? roomHistory.slice(-limit) : roomHistory;
  }

  /**
   * Export stats for external monitoring
   */
  public exportForGraphana(): string {
    const stats = this.getLatestStats();
    if (!stats) return "{}";

    // Format for Grafana/Prometheus
    const output: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      tick: stats.tick,
      cpu: {
        used: stats.cpuUsed,
        limit: stats.cpuLimit,
        bucket: stats.cpuBucket,
        percentUsed: (stats.cpuUsed / stats.cpuLimit) * 100
      },
      gcl: {
        level: stats.gclLevel,
        progress: stats.gclProgress
      },
      gpl: {
        level: stats.gplLevel
      },
      empire: {
        totalCreeps: stats.totalCreeps,
        totalRooms: stats.totalRooms
      },
      rooms: {} as Record<string, unknown>
    };

    for (const room of stats.rooms) {
      (output.rooms as Record<string, unknown>)[room.roomName] = {
        rcl: room.rcl,
        energyAvailable: room.energyAvailable,
        energyCapacity: room.energyCapacity,
        storageEnergy: room.storageEnergy,
        terminalEnergy: room.terminalEnergy,
        creepCount: room.creepCount,
        controllerProgress: room.controllerProgress / room.controllerProgressTotal
      };
    }

    return JSON.stringify(output, null, 2);
  }

  /**
   * Clear all stats data
   */
  public clear(): void {
    this.statsData = this.createDefaultStatsData();
    this.saveToSegment();
  }
}

/**
 * Global memory segment stats instance
 */
export const memorySegmentStats = new MemorySegmentStats();
