/**
 * Pheromone Helper
 *
 * Provides utility functions for creeps to read and respond to pheromones.
 * This enables stigmergic (indirect) communication as specified in ROADMAP section 5.
 *
 * Usage:
 * ```typescript
 * const pheromones = getPheromones(creep);
 * if (pheromones.defense > 20) {
 *   // Prioritize defensive actions
 * }
 * ```
 */

import type { PheromoneState } from "../memory/schemas";
import { memoryManager } from "../memory/manager";

/**
 * Get pheromone levels for a creep's current room
 */
export function getPheromones(creep: Creep): PheromoneState | null {
  const swarm = memoryManager.getSwarmState(creep.room.name);
  return swarm?.pheromones ?? null;
}

/**
 * Get pheromone levels for a specific room
 */
export function getRoomPheromones(roomName: string): PheromoneState | null {
  const swarm = memoryManager.getSwarmState(roomName);
  return swarm?.pheromones ?? null;
}

/**
 * Check if a specific pheromone is elevated (above threshold)
 */
export function isPheromoneElevated(
  pheromones: PheromoneState,
  type: keyof PheromoneState,
  threshold = 20
): boolean {
  return pheromones[type] >= threshold;
}

/**
 * Get the dominant pheromone (highest value) for decision-making
 */
export function getDominantPheromone(pheromones: PheromoneState): keyof PheromoneState | null {
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

/**
 * Check if room needs defensive attention based on pheromones
 */
export function needsDefense(pheromones: PheromoneState): boolean {
  return pheromones.defense > 20 || pheromones.war > 25 || pheromones.siege > 30;
}

/**
 * Check if room needs building based on pheromones
 */
export function needsBuilding(pheromones: PheromoneState): boolean {
  return pheromones.build > 15;
}

/**
 * Check if room needs harvesting based on pheromones
 */
export function needsHarvesting(pheromones: PheromoneState): boolean {
  return pheromones.harvest > 15;
}

/**
 * Check if room needs upgrading based on pheromones
 */
export function needsUpgrading(pheromones: PheromoneState): boolean {
  return pheromones.upgrade > 15;
}

/**
 * Check if room needs logistics (energy distribution) based on pheromones
 */
export function needsLogistics(pheromones: PheromoneState): boolean {
  return pheromones.logistics > 15;
}

/**
 * Pheromone priority scaling constants
 */
const PRIORITY_MIN = 0.5; // Minimum priority multiplier
const PRIORITY_MAX = 2.0; // Maximum priority multiplier
const PHEROMONE_MAX_VALUE = 100; // Maximum pheromone value for scaling

/**
 * Get priority multiplier for a task based on pheromone levels
 * Returns a value between PRIORITY_MIN (low priority) and PRIORITY_MAX (high priority)
 */
export function getPriorityMultiplier(
  pheromones: PheromoneState,
  taskType: keyof PheromoneState
): number {
  const value = pheromones[taskType];
  const range = PRIORITY_MAX - PRIORITY_MIN;
  // Scale: 0-100 pheromone maps to 0.5-2.0 multiplier
  return PRIORITY_MIN + (value / PHEROMONE_MAX_VALUE) * range;
}

/**
 * Determine optimal role focus based on pheromone levels
 * Returns the role type that should be prioritized for spawning
 * 
 * Addresses Issue #33: Pheromone integration with behaviors
 */
export function getOptimalRoleFocus(pheromones: PheromoneState): {
  economy: number;
  military: number;
  utility: number;
  power: number;
} {
  // Base weights
  const weights = {
    economy: 0.4,
    military: 0.2,
    utility: 0.3,
    power: 0.1
  };

  // Adjust based on pheromones
  // Defense/war/siege increase military priority
  const combatPheromonesTotal = pheromones.defense + pheromones.war + pheromones.siege;
  if (combatPheromonesTotal > 50) {
    weights.military += 0.3;
    weights.economy -= 0.15;
    weights.utility -= 0.15;
  }

  // High harvest/build/upgrade pheromones increase economy priority
  const economyPheromonesTotal = pheromones.harvest + pheromones.build + pheromones.upgrade;
  if (economyPheromonesTotal > 60) {
    weights.economy += 0.2;
    weights.military -= 0.1;
    weights.utility -= 0.1;
  }

  // Expand pheromone increases utility (claimers, scouts)
  if (pheromones.expand > 30) {
    weights.utility += 0.2;
    weights.economy -= 0.1;
    weights.military -= 0.1;
  }

  // Normalize to sum to 1.0
  const total = Object.values(weights).reduce((sum, w) => sum + w, 0);
  return {
    economy: weights.economy / total,
    military: weights.military / total,
    utility: weights.utility / total,
    power: weights.power / total
  };
}

/**
 * Check if creep should prioritize defensive actions based on pheromones
 */
export function shouldPrioritizeDefense(creep: Creep): boolean {
  const pheromones = getPheromones(creep);
  if (!pheromones) return false;

  return needsDefense(pheromones);
}

/**
 * Check if creep should shift from normal duties to emergency response
 */
export function shouldActivateEmergencyMode(creep: Creep): boolean {
  const pheromones = getPheromones(creep);
  if (!pheromones) return false;

  // Emergency mode when defense is critical or siege is active
  return pheromones.defense > 50 || pheromones.siege > 40;
}

/**
 * Get recommended action priority for multi-role creeps
 * Returns sorted list of actions by pheromone priority
 */
export function getActionPriorities(pheromones: PheromoneState): {
  action: keyof PheromoneState;
  priority: number;
}[] {
  const actions: { action: keyof PheromoneState; priority: number }[] = [];

  for (const key of Object.keys(pheromones) as (keyof PheromoneState)[]) {
    actions.push({
      action: key,
      priority: pheromones[key]
    });
  }

  // Sort by priority descending
  actions.sort((a, b) => b.priority - a.priority);

  return actions;
}
