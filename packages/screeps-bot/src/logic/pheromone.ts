/**
 * Pheromone System - Phase 2
 *
 * Implements the pheromone-based coordination system:
 * - Metrics collection (rolling averages)
 * - Periodic pheromone updates
 * - Event-driven updates
 * - Pheromone diffusion
 */

import type { PheromoneState, SwarmState } from "../memory/schemas";
import { logger } from "../core/logger";
import { safeFind } from "../utils/safeFind";

/**
 * Pheromone configuration
 */
export interface PheromoneConfig {
  /** Update interval in ticks */
  updateInterval: number;
  /** Decay factors per pheromone type (0.9-0.99) */
  decayFactors: Record<keyof PheromoneState, number>;
  /** Diffusion rates (fraction leaked to neighbors) */
  diffusionRates: Record<keyof PheromoneState, number>;
  /** Max pheromone value */
  maxValue: number;
  /** Min pheromone value */
  minValue: number;
}

/**
 * Default pheromone configuration
 */
export const DEFAULT_PHEROMONE_CONFIG: PheromoneConfig = {
  updateInterval: 5,
  decayFactors: {
    expand: 0.95,
    harvest: 0.9,
    build: 0.92,
    upgrade: 0.93,
    defense: 0.97,
    war: 0.98,
    siege: 0.99,
    logistics: 0.91,
    nukeTarget: 0.99
  },
  diffusionRates: {
    expand: 0.3,
    harvest: 0.1,
    build: 0.15,
    upgrade: 0.1,
    defense: 0.4,
    war: 0.5,
    siege: 0.6,
    logistics: 0.2,
    nukeTarget: 0.1
  },
  maxValue: 100,
  minValue: 0
};

/**
 * Rolling average tracker for metrics
 */
export class RollingAverage {
  private values: number[] = [];
  private sum = 0;

  public constructor(private maxSamples: number = 10) {}

  /**
   * Add a value
   */
  public add(value: number): number {
    this.values.push(value);
    this.sum += value;

    if (this.values.length > this.maxSamples) {
      const removed = this.values.shift();
      this.sum -= removed ?? 0;
    }

    return this.get();
  }

  /**
   * Get current average
   */
  public get(): number {
    return this.values.length > 0 ? this.sum / this.values.length : 0;
  }

  /**
   * Reset
   */
  public reset(): void {
    this.values = [];
    this.sum = 0;
  }
}

/**
 * Room metrics tracker
 */
export interface RoomMetricsTracker {
  energyHarvested: RollingAverage;
  energySpawning: RollingAverage;
  energyConstruction: RollingAverage;
  energyRepair: RollingAverage;
  energyTower: RollingAverage;
  controllerProgress: RollingAverage;
  hostileCount: RollingAverage;
  damageReceived: RollingAverage;
  idleWorkers: RollingAverage;
  lastControllerProgress: number;
}

/**
 * Create a new metrics tracker
 */
export function createMetricsTracker(): RoomMetricsTracker {
  return {
    energyHarvested: new RollingAverage(10),
    energySpawning: new RollingAverage(10),
    energyConstruction: new RollingAverage(10),
    energyRepair: new RollingAverage(10),
    energyTower: new RollingAverage(10),
    controllerProgress: new RollingAverage(10),
    hostileCount: new RollingAverage(5),
    damageReceived: new RollingAverage(5),
    idleWorkers: new RollingAverage(10),
    lastControllerProgress: 0
  };
}

/**
 * Pheromone Manager
 */
export class PheromoneManager {
  private config: PheromoneConfig;
  private trackers: Map<string, RoomMetricsTracker> = new Map();

  public constructor(config: Partial<PheromoneConfig> = {}) {
    this.config = { ...DEFAULT_PHEROMONE_CONFIG, ...config };
  }

  /**
   * Get or create metrics tracker for a room
   */
  public getTracker(roomName: string): RoomMetricsTracker {
    let tracker = this.trackers.get(roomName);
    if (!tracker) {
      tracker = createMetricsTracker();
      this.trackers.set(roomName, tracker);
    }
    return tracker;
  }

  /**
   * Update metrics from a room.
   * Uses optimized iteration patterns for better CPU efficiency.
   */
  public updateMetrics(room: Room, swarm: SwarmState): void {
    const tracker = this.getTracker(room.name);

    // Energy harvested (approximation from source depletion)
    // Use a single loop instead of two reduce calls for efficiency
    const sources = room.find(FIND_SOURCES);
    let totalSourceCapacity = 0;
    let totalSourceEnergy = 0;
    for (const source of sources) {
      totalSourceCapacity += source.energyCapacity;
      totalSourceEnergy += source.energy;
    }
    const harvested = totalSourceCapacity - totalSourceEnergy;
    tracker.energyHarvested.add(harvested);

    // Controller progress
    if (room.controller?.my) {
      const progressDelta = room.controller.progress - tracker.lastControllerProgress;
      if (progressDelta > 0 && progressDelta < 100000) {
        tracker.controllerProgress.add(progressDelta);
      }
      tracker.lastControllerProgress = room.controller.progress;
    }

    // Hostile count and damage - use safeFind to handle engine errors with corrupted owner data
    // Calculate damage in a single loop instead of multiple filter calls
    const hostiles = safeFind(room, FIND_HOSTILE_CREEPS);
    tracker.hostileCount.add(hostiles.length);

    let potentialDamage = 0;
    for (const hostile of hostiles) {
      // Iterate body parts once, counting both attack types in the same loop
      for (const part of hostile.body) {
        if (part.hits > 0) {
          if (part.type === ATTACK) {
            potentialDamage += 30;
          } else if (part.type === RANGED_ATTACK) {
            potentialDamage += 10;
          }
        }
      }
    }
    tracker.damageReceived.add(potentialDamage);

    // Update swarm metrics
    swarm.metrics.energyHarvested = tracker.energyHarvested.get();
    swarm.metrics.controllerProgress = tracker.controllerProgress.get();
    swarm.metrics.hostileCount = Math.round(tracker.hostileCount.get());
    swarm.metrics.damageReceived = tracker.damageReceived.get();
  }

  /**
   * Periodic pheromone update
   */
  public updatePheromones(swarm: SwarmState, room: Room): void {
    if (Game.time < swarm.nextUpdateTick) return;

    const pheromones = swarm.pheromones;

    // Apply decay
    for (const key of Object.keys(pheromones) as (keyof PheromoneState)[]) {
      const decayFactor = this.config.decayFactors[key];
      pheromones[key] = this.clamp(pheromones[key] * decayFactor);
    }

    // Calculate contributions
    this.calculateContributions(swarm, room);

    // Set next update tick
    swarm.nextUpdateTick = Game.time + this.config.updateInterval;
    swarm.lastUpdate = Game.time;
  }

  /**
   * Calculate pheromone contributions from current state
   */
  private calculateContributions(swarm: SwarmState, room: Room): void {
    const pheromones = swarm.pheromones;
    const tracker = this.getTracker(room.name);

    // Harvest contribution based on available sources
    const sources = room.find(FIND_SOURCES);
    if (sources.length > 0) {
      const avgEnergy = sources.reduce((sum, s) => sum + s.energy, 0) / sources.length;
      pheromones.harvest = this.clamp(pheromones.harvest + (avgEnergy / 3000) * 10);
    }

    // Build contribution based on construction sites
    const sites = room.find(FIND_MY_CONSTRUCTION_SITES);
    if (sites.length > 0) {
      pheromones.build = this.clamp(pheromones.build + Math.min(sites.length * 2, 20));
    }

    // Upgrade contribution based on controller progress
    if (room.controller?.my) {
      const progressPercent = room.controller.progress / room.controller.progressTotal;
      if (progressPercent < 0.5) {
        pheromones.upgrade = this.clamp(pheromones.upgrade + (1 - progressPercent) * 15);
      }
    }

    // Defense contribution based on hostiles
    const hostileAvg = tracker.hostileCount.get();
    if (hostileAvg > 0) {
      pheromones.defense = this.clamp(pheromones.defense + hostileAvg * 10);
    }

    // War contribution if threat is sustained
    if (swarm.danger >= 2) {
      pheromones.war = this.clamp(pheromones.war + swarm.danger * 10);
    }

    // Siege if critical threat
    if (swarm.danger >= 3) {
      pheromones.siege = this.clamp(pheromones.siege + 20);
    }

    // Logistics contribution based on energy distribution needs
    if (room.storage) {
      const spawns = room.find(FIND_MY_SPAWNS);
      const spawnEnergy = spawns.reduce((sum, s) => sum + s.store.getUsedCapacity(RESOURCE_ENERGY), 0);
      const maxSpawnEnergy = spawns.length * 300;
      if (spawnEnergy < maxSpawnEnergy * 0.5) {
        pheromones.logistics = this.clamp(pheromones.logistics + 10);
      }
    }

    // Expand contribution if economy is stable
    const energyBalance = tracker.energyHarvested.get() - swarm.metrics.energySpawning;
    if (energyBalance > 0 && swarm.danger === 0) {
      pheromones.expand = this.clamp(pheromones.expand + Math.min(energyBalance / 100, 10));
    }
  }

  /**
   * Clamp pheromone value to valid range
   */
  private clamp(value: number): number {
    return Math.max(this.config.minValue, Math.min(this.config.maxValue, value));
  }

  // ============================================================================
  // Event-Driven Updates
  // ============================================================================

  /**
   * Handle hostile detection
   */
  public onHostileDetected(swarm: SwarmState, hostileCount: number, danger: 0 | 1 | 2 | 3): void {
    swarm.danger = danger;
    swarm.pheromones.defense = this.clamp(swarm.pheromones.defense + hostileCount * 5);

    if (danger >= 2) {
      swarm.pheromones.war = this.clamp(swarm.pheromones.war + danger * 10);
    }

    if (danger >= 3) {
      swarm.pheromones.siege = this.clamp(swarm.pheromones.siege + 20);
    }

    logger.info(`Hostile detected: ${hostileCount} hostiles, danger=${danger}`, {
      room: swarm.role,
      subsystem: "Pheromone"
    });
  }

  /**
   * Handle structure destroyed
   */
  public onStructureDestroyed(swarm: SwarmState, structureType: StructureConstant): void {
    swarm.pheromones.defense = this.clamp(swarm.pheromones.defense + 5);
    swarm.pheromones.build = this.clamp(swarm.pheromones.build + 10);

    // Critical structures increase danger
    if (structureType === STRUCTURE_SPAWN || structureType === STRUCTURE_STORAGE || structureType === STRUCTURE_TOWER) {
      swarm.danger = Math.min(3, swarm.danger + 1) as 0 | 1 | 2 | 3;
      swarm.pheromones.siege = this.clamp(swarm.pheromones.siege + 15);
    }
  }

  /**
   * Handle nuke detection
   */
  public onNukeDetected(swarm: SwarmState): void {
    swarm.danger = 3;
    swarm.pheromones.siege = this.clamp(swarm.pheromones.siege + 50);
    swarm.pheromones.defense = this.clamp(swarm.pheromones.defense + 30);
  }

  /**
   * Handle remote source lost
   */
  public onRemoteSourceLost(swarm: SwarmState): void {
    swarm.pheromones.expand = this.clamp(swarm.pheromones.expand - 10);
    swarm.pheromones.defense = this.clamp(swarm.pheromones.defense + 5);
  }

  // ============================================================================
  // Pheromone Diffusion
  // ============================================================================

  /**
   * Apply diffusion to neighboring rooms
   */
  public applyDiffusion(rooms: Map<string, SwarmState>): void {
    const diffusionQueue: {
      source: string;
      target: string;
      type: keyof PheromoneState;
      amount: number;
      sourceIntensity: number;
    }[] = [];

    for (const [roomName, swarm] of rooms) {
      const neighbors = this.getNeighborRoomNames(roomName);

      for (const neighborName of neighbors) {
        const neighborSwarm = rooms.get(neighborName);
        if (!neighborSwarm) continue;

        // Diffuse defense, war, expand, and siege
        const diffusibleTypes: (keyof PheromoneState)[] = ["defense", "war", "expand", "siege"];

        for (const type of diffusibleTypes) {
          const intensity = swarm.pheromones[type];
          if (intensity > 1) {
            const rate = this.config.diffusionRates[type];
            diffusionQueue.push({
              source: roomName,
              target: neighborName,
              type,
              amount: intensity * rate * 0.5,
              sourceIntensity: intensity
            });
          }
        }
      }
    }

    // Apply diffusion
    for (const diff of diffusionQueue) {
      const targetSwarm = rooms.get(diff.target);
      if (targetSwarm) {
        const newValue = targetSwarm.pheromones[diff.type] + diff.amount;
        // Cap the target pheromone level to not exceed the source room's level
        // This prevents rooms from pushing each other higher than their own level
        targetSwarm.pheromones[diff.type] = this.clamp(Math.min(newValue, diff.sourceIntensity));
      }
    }
  }

  /**
   * Get neighboring room names
   */
  private getNeighborRoomNames(roomName: string): string[] {
    const match = roomName.match(/^([WE])(\d+)([NS])(\d+)$/);
    if (!match) return [];

    const [, wx, xStr, wy, yStr] = match;
    if (!wx || !xStr || !wy || !yStr) return [];

    const x = parseInt(xStr, 10);
    const y = parseInt(yStr, 10);

    const neighbors: string[] = [];

    // Cardinal directions
    if (wy === "N") {
      neighbors.push(`${wx}${x}N${y + 1}`);
    } else {
      if (y > 0) {
        neighbors.push(`${wx}${x}S${y - 1}`);
      } else {
        neighbors.push(`${wx}${x}N0`);
      }
    }

    if (wy === "S") {
      neighbors.push(`${wx}${x}S${y + 1}`);
    } else {
      if (y > 0) {
        neighbors.push(`${wx}${x}N${y - 1}`);
      } else {
        neighbors.push(`${wx}${x}S0`);
      }
    }

    if (wx === "E") {
      neighbors.push(`E${x + 1}${wy}${y}`);
    } else {
      if (x > 0) {
        neighbors.push(`W${x - 1}${wy}${y}`);
      } else {
        neighbors.push(`E0${wy}${y}`);
      }
    }

    if (wx === "W") {
      neighbors.push(`W${x + 1}${wy}${y}`);
    } else {
      if (x > 0) {
        neighbors.push(`E${x - 1}${wy}${y}`);
      } else {
        neighbors.push(`W0${wy}${y}`);
      }
    }

    return neighbors;
  }

  /**
   * Get dominant pheromone for a room
   */
  public getDominantPheromone(pheromones: PheromoneState): keyof PheromoneState | null {
    let maxKey: keyof PheromoneState | null = null;
    let maxValue = 1; // Minimum threshold

    for (const key of Object.keys(pheromones) as (keyof PheromoneState)[]) {
      if (pheromones[key] > maxValue) {
        maxValue = pheromones[key];
        maxKey = key;
      }
    }

    return maxKey;
  }
}

/**
 * Global pheromone manager instance
 */
export const pheromoneManager = new PheromoneManager();
