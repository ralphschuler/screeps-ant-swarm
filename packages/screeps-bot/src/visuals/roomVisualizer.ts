/**
 * Room Visualizer
 *
 * Provides in-game visualization using RoomVisual:
 * - Pheromone heatmaps
 * - Path and traffic visualization
 * - Blueprint overlay
 * - Combat information
 * - Spawn queue visualization
 * - Resource flow visualization
 *
 * Addresses Issue: #34
 */

import type { PheromoneState, SwarmState } from "../memory/schemas";
import { memoryManager } from "../memory/manager";

/**
 * Visualization configuration
 */
export interface VisualizerConfig {
  /** Enable pheromone visualization */
  showPheromones: boolean;
  /** Enable path visualization */
  showPaths: boolean;
  /** Enable combat info */
  showCombat: boolean;
  /** Enable resource flow */
  showResourceFlow: boolean;
  /** Enable spawn queue */
  showSpawnQueue: boolean;
  /** Enable room stats */
  showRoomStats: boolean;
  /** Opacity for overlays */
  opacity: number;
}

const DEFAULT_CONFIG: VisualizerConfig = {
  showPheromones: true,
  showPaths: false,
  showCombat: true,
  showResourceFlow: false,
  showSpawnQueue: true,
  showRoomStats: true,
  opacity: 0.5
};

/**
 * Color schemes for pheromones
 */
const PHEROMONE_COLORS: Record<keyof PheromoneState, string> = {
  expand: "#00ff00", // Green
  harvest: "#ffff00", // Yellow
  build: "#ff8800", // Orange
  upgrade: "#0088ff", // Blue
  defense: "#ff0000", // Red
  war: "#ff00ff", // Magenta
  siege: "#880000", // Dark red
  logistics: "#00ffff", // Cyan
  nukeTarget: "#ff0088" // Pink
};

/**
 * Room Visualizer Class
 */
export class RoomVisualizer {
  private config: VisualizerConfig;

  public constructor(config: Partial<VisualizerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Draw all visualizations for a room
   */
  public draw(room: Room): void {
    const visual = new RoomVisual(room.name);
    const swarm = memoryManager.getSwarmState(room.name);

    if (this.config.showRoomStats) {
      this.drawRoomStats(visual, room, swarm);
    }

    if (this.config.showPheromones && swarm) {
      this.drawPheromoneBars(visual, swarm);
    }

    if (this.config.showCombat) {
      this.drawCombatInfo(visual, room);
    }

    if (this.config.showSpawnQueue) {
      this.drawSpawnQueue(visual, room);
    }

    if (this.config.showResourceFlow) {
      this.drawResourceFlow(visual, room);
    }

    if (this.config.showPaths) {
      this.drawTrafficPaths(visual, room);
    }
  }

  /**
   * Draw room statistics panel
   */
  private drawRoomStats(visual: RoomVisual, room: Room, swarm?: SwarmState): void {
    const x = 0.5;
    let y = 0.5;
    const lineHeight = 0.6;

    // Background
    visual.rect(0, 0, 8, 6.5, {
      fill: "#000000",
      opacity: 0.7,
      stroke: "#ffffff",
      strokeWidth: 0.05
    });

    // Room name and RCL
    const rcl = room.controller?.level ?? 0;
    const progress = room.controller
      ? `${Math.round((room.controller.progress / room.controller.progressTotal) * 100)}%`
      : "N/A";
    visual.text(`${room.name} | RCL ${rcl} (${progress})`, x, y, {
      align: "left",
      font: "0.5 monospace",
      color: "#ffffff"
    });
    y += lineHeight;

    // Energy
    const energy = room.energyAvailable;
    const energyMax = room.energyCapacityAvailable;
    const energyPercent = energyMax > 0 ? Math.round((energy / energyMax) * 100) : 0;
    visual.text(`Energy: ${energy}/${energyMax} (${energyPercent}%)`, x, y, {
      align: "left",
      font: "0.4 monospace",
      color: "#ffff00"
    });
    y += lineHeight;

    // Storage
    if (room.storage) {
      const storageEnergy = room.storage.store.getUsedCapacity(RESOURCE_ENERGY);
      visual.text(`Storage: ${Math.round(storageEnergy / 1000)}k energy`, x, y, {
        align: "left",
        font: "0.4 monospace",
        color: "#00ff00"
      });
      y += lineHeight;
    }

    // Swarm state
    if (swarm) {
      visual.text(`Stage: ${swarm.colonyLevel}`, x, y, {
        align: "left",
        font: "0.4 monospace",
        color: "#00ffff"
      });
      y += lineHeight;

      const dangerColors = ["#00ff00", "#ffff00", "#ff8800", "#ff0000"];
      visual.text(`Posture: ${swarm.posture} | Danger: ${swarm.danger}`, x, y, {
        align: "left",
        font: "0.4 monospace",
        color: dangerColors[swarm.danger] ?? "#ffffff"
      });
      y += lineHeight;
    }

    // Creep count
    const creeps = room.find(FIND_MY_CREEPS).length;
    const hostiles = room.find(FIND_HOSTILE_CREEPS).length;
    visual.text(`Creeps: ${creeps} | Hostiles: ${hostiles}`, x, y, {
      align: "left",
      font: "0.4 monospace",
      color: hostiles > 0 ? "#ff0000" : "#ffffff"
    });
    y += lineHeight;

    // CPU
    const cpu = Game.cpu.getUsed().toFixed(1);
    const bucket = Game.cpu.bucket;
    visual.text(`CPU: ${cpu} | Bucket: ${bucket}`, x, y, {
      align: "left",
      font: "0.4 monospace",
      color: bucket < 3000 ? "#ff8800" : "#ffffff"
    });
  }

  /**
   * Draw pheromone bars
   */
  private drawPheromoneBars(visual: RoomVisual, swarm: SwarmState): void {
    const x = 42;
    let y = 0.5;
    const barWidth = 6;
    const barHeight = 0.4;

    // Background
    visual.rect(41.5, 0, 8, 5.5, {
      fill: "#000000",
      opacity: 0.7,
      stroke: "#ffffff",
      strokeWidth: 0.05
    });

    visual.text("Pheromones", x + 3, y, {
      align: "center",
      font: "0.5 monospace",
      color: "#ffffff"
    });
    y += 0.6;

    const maxValue = 100;

    for (const [key, value] of Object.entries(swarm.pheromones) as [keyof PheromoneState, number][]) {
      const color = PHEROMONE_COLORS[key];
      const fillWidth = Math.min(1, value / maxValue) * barWidth;

      // Background bar
      visual.rect(x, y, barWidth, barHeight, {
        fill: "#333333",
        opacity: 0.8
      });

      // Fill bar
      if (fillWidth > 0) {
        visual.rect(x, y, fillWidth, barHeight, {
          fill: color,
          opacity: this.config.opacity
        });
      }

      // Label
      visual.text(`${key}: ${Math.round(value)}`, x - 0.2, y + 0.35, {
        align: "right",
        font: "0.35 monospace",
        color
      });

      y += 0.5;
    }
  }

  /**
   * Draw combat information
   */
  private drawCombatInfo(visual: RoomVisual, room: Room): void {
    const hostiles = room.find(FIND_HOSTILE_CREEPS);

    // Draw circles around hostiles with threat level
    for (const hostile of hostiles) {
      const threat = this.calculateCreepThreat(hostile);
      const color = threat > 30 ? "#ff0000" : threat > 10 ? "#ff8800" : "#ffff00";

      visual.circle(hostile.pos, {
        radius: 0.6,
        fill: color,
        opacity: 0.3,
        stroke: color,
        strokeWidth: 0.1
      });

      visual.text(`T:${threat}`, hostile.pos.x, hostile.pos.y - 0.8, {
        font: "0.4 monospace",
        color
      });
    }

    // Draw tower ranges if under attack
    if (hostiles.length > 0) {
      const towers = room.find(FIND_MY_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_TOWER
      }) ;

      for (const tower of towers) {
        // Optimal range (full damage)
        visual.circle(tower.pos, {
          radius: 5,
          fill: "#00ff00",
          opacity: 0.1,
          stroke: "#00ff00",
          strokeWidth: 0.05
        });

        // Medium range
        visual.circle(tower.pos, {
          radius: 10,
          fill: "#ffff00",
          opacity: 0.05,
          stroke: "#ffff00",
          strokeWidth: 0.05
        });
      }
    }
  }

  /**
   * Calculate threat level of a creep
   */
  private calculateCreepThreat(creep: Creep): number {
    let threat = 0;
    for (const part of creep.body) {
      if (!part.hits) continue;
      switch (part.type) {
        case ATTACK:
          threat += 5 * (part.boost ? 4 : 1);
          break;
        case RANGED_ATTACK:
          threat += 4 * (part.boost ? 4 : 1);
          break;
        case HEAL:
          threat += 6 * (part.boost ? 4 : 1);
          break;
        case TOUGH:
          threat += 1 * (part.boost ? 4 : 1);
          break;
        case WORK:
          threat += 2 * (part.boost ? 4 : 1);
          break;
      }
    }
    return threat;
  }

  /**
   * Draw spawn queue visualization
   */
  private drawSpawnQueue(visual: RoomVisual, room: Room): void {
    const spawns = room.find(FIND_MY_SPAWNS);

    for (const spawn of spawns) {
      if (spawn.spawning) {
        const creep = Game.creeps[spawn.spawning.name];
        const progress = 1 - spawn.spawning.remainingTime / spawn.spawning.needTime;

        // Progress bar above spawn
        const barWidth = 2;
        const barHeight = 0.3;
        const barX = spawn.pos.x - 1;
        const barY = spawn.pos.y - 1.5;

        visual.rect(barX, barY, barWidth, barHeight, {
          fill: "#333333",
          opacity: 0.8
        });

        visual.rect(barX, barY, barWidth * progress, barHeight, {
          fill: "#00ff00",
          opacity: 0.8
        });

        // Spawning creep name/role
        const memory = creep?.memory as unknown as { role?: string };
        const role = memory?.role ?? spawn.spawning.name;
        visual.text(role, spawn.pos.x, spawn.pos.y - 1.9, {
          font: "0.35 monospace",
          color: "#ffffff"
        });
      }
    }
  }

  /**
   * Draw resource flow arrows
   */
  private drawResourceFlow(visual: RoomVisual, room: Room): void {
    const storage = room.storage;
    if (!storage) return;

    // Draw arrows from sources to storage
    const sources = room.find(FIND_SOURCES);
    for (const source of sources) {
      this.drawArrow(visual, source.pos, storage.pos, "#ffff00", 0.2);
    }

    // Draw arrows from storage to spawns
    const spawns = room.find(FIND_MY_SPAWNS);
    for (const spawn of spawns) {
      if (spawn.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
        this.drawArrow(visual, storage.pos, spawn.pos, "#00ff00", 0.2);
      }
    }

    // Draw arrows from storage to controller
    const controller = room.controller;
    if (controller) {
      this.drawArrow(visual, storage.pos, controller.pos, "#00ffff", 0.2);
    }
  }

  /**
   * Draw an arrow between two positions
   */
  private drawArrow(
    visual: RoomVisual,
    from: RoomPosition,
    to: RoomPosition,
    color: string,
    opacity: number
  ): void {
    visual.line(from, to, {
      color,
      opacity,
      width: 0.1,
      lineStyle: "dashed"
    });
  }

  /**
   * Draw traffic paths
   */
  private drawTrafficPaths(visual: RoomVisual, room: Room): void {
    // Draw roads with usage intensity
    const roads = room.find(FIND_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_ROAD
    }) ;

    for (const road of roads) {
      // Color based on hits (more traffic = more damage)
      const hitsPercent = road.hits / road.hitsMax;
      const intensity = 1 - hitsPercent;
      const color = `hsl(${120 - intensity * 120}, 100%, 50%)`;

      visual.circle(road.pos, {
        radius: 0.2,
        fill: color,
        opacity: 0.5
      });
    }
  }

  /**
   * Draw blueprint overlay for planned structures
   */
  public drawBlueprint(visual: RoomVisual, blueprint: { type: StructureConstant; pos: { x: number; y: number } }[]): void {
    const structureColors: Record<string, string> = {
      spawn: "#ff8800",
      extension: "#ffff00",
      tower: "#ff0000",
      storage: "#00ff00",
      terminal: "#00ffff",
      lab: "#ff00ff",
      factory: "#8800ff",
      link: "#0088ff",
      observer: "#888888",
      nuker: "#ff0088",
      powerSpawn: "#ff4400",
      container: "#884400",
      road: "#444444",
      rampart: "#008800",
      constructedWall: "#666666",
      extractor: "#ff8888"
    };

    for (const item of blueprint) {
      const color = structureColors[item.type] ?? "#ffffff";

      visual.rect(item.pos.x - 0.4, item.pos.y - 0.4, 0.8, 0.8, {
        fill: color,
        opacity: 0.3,
        stroke: color,
        strokeWidth: 0.05
      });

      visual.text(item.type.charAt(0).toUpperCase(), item.pos.x, item.pos.y + 0.15, {
        font: "0.5 monospace",
        color
      });
    }
  }

  /**
   * Update configuration
   */
  public setConfig(config: Partial<VisualizerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  public getConfig(): VisualizerConfig {
    return { ...this.config };
  }

  /**
   * Toggle a specific visualization
   */
  public toggle(key: keyof VisualizerConfig): void {
    if (typeof this.config[key] === "boolean") {
      (this.config[key] as boolean) = !this.config[key];
    }
  }
}

/**
 * Global room visualizer instance
 */
export const roomVisualizer = new RoomVisualizer();
