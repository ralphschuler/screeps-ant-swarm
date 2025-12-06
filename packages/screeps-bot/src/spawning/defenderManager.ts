/**
 * Dynamic Defender Spawning
 *
 * Automatically spawns defenders based on threat assessment:
 * - Analyzes hostile creeps in room
 * - Calculates required defender count
 * - Prioritizes defender spawning during attacks
 * - Scales defender strength based on enemy composition
 *
 * Addresses Issue: #22
 */

import type { SwarmState } from "../memory/schemas";
import { logger } from "../core/logger";

/**
 * Defender requirement analysis
 */
export interface DefenderRequirement {
  /** Number of guards needed */
  guards: number;
  /** Number of rangers needed */
  rangers: number;
  /** Number of healers needed */
  healers: number;
  /** Priority multiplier for spawning */
  urgency: number;
  /** Reasons for the requirement */
  reasons: string[];
}

/**
 * Analyze room threats and determine defender requirements
 */
export function analyzeDefenderNeeds(room: Room, _swarm: SwarmState): DefenderRequirement {
  const result: DefenderRequirement = {
    guards: 0,
    rangers: 0,
    healers: 0,
    urgency: 1.0,
    reasons: []
  };

  // Find all hostile creeps
  const hostiles = room.find(FIND_HOSTILE_CREEPS);
  if (hostiles.length === 0) {
    return result; // No threats
  }

  // Analyze hostile composition
  let meleeCount = 0;
  let rangedCount = 0;
  let healerCount = 0;
  let dismantlerCount = 0;
  let boostedCount = 0;

  for (const hostile of hostiles) {
    const body = hostile.body;
    
    // Check for boosted parts
    const isBoosted = body.some(part => part.boost !== undefined);
    if (isBoosted) boostedCount++;

    // Count part types
    for (const part of body) {
      if (part.type === ATTACK) meleeCount++;
      if (part.type === RANGED_ATTACK) rangedCount++;
      if (part.type === HEAL) healerCount++;
      if (part.type === WORK) dismantlerCount++;
    }
  }

  // Calculate defender requirements

  // Guards for melee attackers (1:1 ratio, min 1 if any melee)
  if (meleeCount > 0) {
    result.guards = Math.max(1, Math.ceil(meleeCount / 4));
    result.reasons.push(`${meleeCount} melee parts detected`);
  }

  // Rangers for ranged attackers (1:1.5 ratio)
  if (rangedCount > 0) {
    result.rangers = Math.max(1, Math.ceil(rangedCount / 6));
    result.reasons.push(`${rangedCount} ranged parts detected`);
  }

  // Healers if enemies have healers (1:2 ratio)
  if (healerCount > 0) {
    result.healers = Math.max(1, Math.ceil(healerCount / 8));
    result.reasons.push(`${healerCount} heal parts detected`);
  }

  // Extra defenders for dismantlers (they're dangerous)
  if (dismantlerCount > 0) {
    result.guards += Math.ceil(dismantlerCount / 5);
    result.reasons.push(`${dismantlerCount} work parts (dismantlers)`);
  }

  // Boosted enemies require more defenders
  if (boostedCount > 0) {
    result.guards = Math.ceil(result.guards * 1.5);
    result.rangers = Math.ceil(result.rangers * 1.5);
    result.healers = Math.ceil(result.healers * 1.5);
    result.urgency = 2.0;
    result.reasons.push(`${boostedCount} boosted enemies (high threat)`);
  }

  // Minimum composition for any attack
  if (hostiles.length > 0) {
    result.guards = Math.max(result.guards, 1);
    result.rangers = Math.max(result.rangers, 1);
  }

  // Large attacks require healers
  if (hostiles.length >= 3) {
    result.healers = Math.max(result.healers, 1);
  }

  // Urgency based on hostile count
  if (hostiles.length >= 5) {
    result.urgency = Math.max(result.urgency, 1.5);
    result.reasons.push(`${hostiles.length} hostiles (large attack)`);
  }

  // Check for critical structures under attack
  const damagedCritical = room.find(FIND_MY_STRUCTURES, {
    filter: s =>
      (s.structureType === STRUCTURE_SPAWN ||
        s.structureType === STRUCTURE_STORAGE ||
        s.structureType === STRUCTURE_TERMINAL) &&
      s.hits < s.hitsMax * 0.8
  });

  if (damagedCritical.length > 0) {
    result.urgency = 3.0;
    result.reasons.push(`Critical structures under attack!`);
  }

  logger.info(
    `Defender analysis for ${room.name}: ${result.guards} guards, ${result.rangers} rangers, ${result.healers} healers (urgency: ${result.urgency}x) - ${result.reasons.join(", ")}`,
    { subsystem: "Defense" }
  );

  return result;
}

/**
 * Get current defender count in room
 */
export function getCurrentDefenders(room: Room): { guards: number; rangers: number; healers: number } {
  const creeps = room.find(FIND_MY_CREEPS);

  return {
    guards: creeps.filter(c => c.memory.role === "guard").length,
    rangers: creeps.filter(c => c.memory.role === "ranger").length,
    healers: creeps.filter(c => c.memory.role === "healer").length
  };
}

/**
 * Calculate defender spawn priority boost
 */
export function getDefenderPriorityBoost(room: Room, swarm: SwarmState, role: string): number {
  const needs = analyzeDefenderNeeds(room, swarm);
  const current = getCurrentDefenders(room);

  // No boost if no threats
  if (needs.guards === 0 && needs.rangers === 0 && needs.healers === 0) {
    return 0;
  }

  let boost = 0;

  // Boost priority for needed defenders
  if (role === "guard" && current.guards < needs.guards) {
    boost = 100 * needs.urgency;
  } else if (role === "ranger" && current.rangers < needs.rangers) {
    boost = 100 * needs.urgency;
  } else if (role === "healer" && current.healers < needs.healers) {
    boost = 100 * needs.urgency;
  }

  return boost;
}

/**
 * Check if emergency defender spawning is needed
 */
export function needsEmergencyDefenders(room: Room, swarm: SwarmState): boolean {
  const needs = analyzeDefenderNeeds(room, swarm);
  const current = getCurrentDefenders(room);

  // Emergency if we need defenders but have none
  const needsGuards = needs.guards > 0 && current.guards === 0;
  const needsRangers = needs.rangers > 0 && current.rangers === 0;

  // Emergency if urgency is critical
  const criticalUrgency = needs.urgency >= 2.0;

  return (needsGuards || needsRangers) && criticalUrgency;
}
