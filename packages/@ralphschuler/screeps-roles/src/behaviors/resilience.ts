/**
 * Behavior Resilience Module
 *
 * Provides automatic recovery mechanisms for creep behaviors to ensure
 * reliability and resilience as specified in ROADMAP.md Sections 2 & 19.
 *
 * Key Features:
 * - Automatic fallback behaviors when primary actions fail
 * - Health monitoring and adaptive behavior degradation
 * - Emergency response behaviors for critical situations
 * - Behavior validation and sanitization
 *
 * Architecture:
 * This module wraps behavior functions to add resilience layers:
 * 1. Pre-execution validation
 * 2. Error handling with fallbacks
 * 3. Post-execution health checks
 * 4. Recovery action generation
 */

import type { CreepAction, CreepContext, BehaviorFunction } from "./types";
import { createLogger } from "@ralphschuler/screeps-core";

const logger = createLogger("BehaviorResilience");

/**
 * Behavior execution result with metadata for monitoring
 */
export interface BehaviorResult {
  action: CreepAction;
  success: boolean;
  failureReason?: string;
  recoveryAttempted?: boolean;
}

/**
 * Fallback strategy for when primary behavior fails
 */
type FallbackStrategy = "idle" | "returnHome" | "moveToSafety" | "harvest";

/**
 * Configuration for resilient behavior execution
 */
interface ResilienceConfig {
  /** Maximum number of recovery attempts before giving up */
  maxRecoveryAttempts?: number;
  /** Fallback strategy when all recovery attempts fail */
  fallbackStrategy?: FallbackStrategy;
  /** Whether to log failures for debugging */
  logFailures?: boolean;
}

const DEFAULT_CONFIG: Required<ResilienceConfig> = {
  maxRecoveryAttempts: 3,
  fallbackStrategy: "idle",
  logFailures: true
};

/**
 * Wrap a behavior function with resilience handling.
 * 
 * This adds automatic error recovery, fallback behaviors, and health monitoring
 * to ensure creeps can always generate valid actions even in edge cases.
 *
 * @param behaviorFn The behavior function to wrap
 * @param config Optional resilience configuration
 * @returns Wrapped behavior function with resilience
 */
export function withResilience(
  behaviorFn: BehaviorFunction,
  config: ResilienceConfig = {}
): BehaviorFunction {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  
  return (ctx: CreepContext): CreepAction => {
    try {
      // Pre-execution validation
      const validationIssue = validateContext(ctx);
      if (validationIssue) {
        if (cfg.logFailures) {
          logger.warn(`Context validation failed for ${ctx.creep.name}: ${validationIssue}`);
        }
        return generateFallbackAction(ctx, cfg.fallbackStrategy);
      }

      // Execute primary behavior
      const action = behaviorFn(ctx);
      
      // Validate action
      if (!isValidAction(action)) {
        if (cfg.logFailures) {
          logger.warn(`Invalid action generated for ${ctx.creep.name}: ${JSON.stringify(action)}`);
        }
        return generateFallbackAction(ctx, cfg.fallbackStrategy);
      }

      return action;
      
    } catch (error) {
      // Catch any errors and generate safe fallback
      if (cfg.logFailures) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error(`Behavior error for ${ctx.creep.name}: ${errorMsg}`, {
          meta: {
            role: ctx.memory.role,
            room: ctx.room.name,
            stack: error instanceof Error ? error.stack : undefined
          }
        });
      }
      
      return generateFallbackAction(ctx, cfg.fallbackStrategy);
    }
  };
}

/**
 * Validate that a context is in a valid state for behavior execution.
 * Returns error message if invalid, undefined if valid.
 */
function validateContext(ctx: CreepContext): string | undefined {
  if (!ctx.creep) return "Missing creep reference";
  if (!ctx.room) return "Missing room reference";
  if (!ctx.memory) return "Missing memory reference";
  
  // Check for corrupted memory state
  if (ctx.memory.state) {
    const state = ctx.memory.state;
    if (state.startTick < 0) return "Invalid state startTick";
    if (state.timeout < 0) return "Invalid state timeout";
  }
  
  return undefined;
}

/**
 * Validate that an action is well-formed and executable.
 */
function isValidAction(action: CreepAction | null | undefined): action is CreepAction {
  if (!action) return false;
  if (!action.type) return false;
  
  // Validate action-specific fields
  switch (action.type) {
    case "harvest":
    case "harvestMineral":
    case "harvestDeposit":
    case "pickup":
    case "build":
    case "repair":
    case "upgrade":
    case "dismantle":
    case "attack":
    case "rangedAttack":
    case "heal":
    case "rangedHeal":
    case "claim":
    case "reserve":
    case "attackController":
    case "moveTo":
      return "target" in action && action.target !== null && action.target !== undefined;
      
    case "withdraw":
    case "transfer":
      return "target" in action && 
             "resourceType" in action && 
             action.target !== null && 
             action.resourceType !== undefined;
      
    case "drop":
      return "resourceType" in action && action.resourceType !== undefined;
      
    case "moveToRoom":
      return "roomName" in action && typeof action.roomName === "string";
      
    case "flee":
      return "from" in action && Array.isArray(action.from);
      
    case "wait":
      return "position" in action && action.position !== null;
      
    case "requestMove":
      return "target" in action && action.target !== null;
      
    case "idle":
      return true;
      
    default:
      return false;
  }
}

/**
 * Generate a safe fallback action based on strategy.
 */
function generateFallbackAction(ctx: CreepContext, strategy: FallbackStrategy): CreepAction {
  switch (strategy) {
    case "returnHome":
      // Return to home room if not there
      if (!ctx.isInHomeRoom && ctx.homeRoom) {
        return { type: "moveToRoom", roomName: ctx.homeRoom };
      }
      return { type: "idle" };
      
    case "moveToSafety":
      // Move away from hostiles
      if (ctx.hostiles.length > 0) {
        return { type: "flee", from: ctx.hostiles.map(h => h.pos) };
      }
      return { type: "idle" };
      
    case "harvest":
      // Try to find energy
      const sources = ctx.room.find(FIND_SOURCES_ACTIVE);
      if (sources.length > 0 && sources[0]) {
        return { type: "harvest", target: sources[0] };
      }
      return { type: "idle" };
      
    case "idle":
    default:
      return { type: "idle" };
  }
}

/**
 * Create an emergency response behavior for critical situations.
 * 
 * This behavior prioritizes survival and basic functionality over normal operations.
 * Used when room is under attack, creep is damaged, or other critical conditions.
 */
export function createEmergencyBehavior(ctx: CreepContext): BehaviorFunction {
  return (_ctx: CreepContext): CreepAction => {
    // Priority 1: Flee from hostiles if damaged
    if (ctx.hostiles.length > 0 && ctx.creep.hits < ctx.creep.hitsMax * 0.5) {
      return { type: "flee", from: ctx.hostiles.map(h => h.pos) };
    }
    
    // Priority 2: Return to home room if displaced
    if (!ctx.isInHomeRoom && ctx.homeRoom) {
      return { type: "moveToRoom", roomName: ctx.homeRoom };
    }
    
    // Priority 3: Deliver emergency energy to spawns
    if (!ctx.isEmpty && ctx.spawnStructures.length > 0) {
      const needsEnergy = ctx.spawnStructures.filter(
        s => s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
      );
      const target = needsEnergy[0];
      if (target) {
        return { type: "transfer", target, resourceType: RESOURCE_ENERGY };
      }
    }
    
    // Priority 4: Collect energy from nearby sources
    if (ctx.isEmpty) {
      const droppedEnergy = ctx.droppedResources.filter(
        r => r.resourceType === RESOURCE_ENERGY && r.amount > 50
      );
      const droppedTarget = droppedEnergy[0];
      if (droppedTarget) {
        return { type: "pickup", target: droppedTarget };
      }
      
      const sources = ctx.room.find(FIND_SOURCES_ACTIVE);
      const source = sources[0];
      if (source) {
        return { type: "harvest", target: source };
      }
    }
    
    // Priority 5: Move to safe position (not on exit)
    const pos = ctx.creep.pos;
    if (pos.x === 0 || pos.x === 49 || pos.y === 0 || pos.y === 49) {
      // On room exit - move toward center
      const centerPos = new RoomPosition(25, 25, ctx.room.name);
      return { type: "moveTo", target: centerPos };
    }
    
    // Default: Idle safely
    return { type: "idle" };
  };
}

/**
 * Monitor behavior health and detect degraded states.
 * Returns health score from 0 (critical) to 100 (healthy).
 */
export function assessBehaviorHealth(ctx: CreepContext): number {
  let health = 100;
  
  // Deduct points for concerning conditions
  
  // Stuck at same position
  const memory = ctx.memory as any;
  if (memory.lastPosTick && Game.time - memory.lastPosTick > 10) {
    health -= 30;
  }
  
  // State running too long
  if (ctx.memory.state) {
    const age = Game.time - ctx.memory.state.startTick;
    if (age > ctx.memory.state.timeout) {
      health -= 20;
    } else if (age > ctx.memory.state.timeout * 0.8) {
      health -= 10;
    }
  }
  
  // Creep is damaged
  if (ctx.creep.hits < ctx.creep.hitsMax) {
    const damagePercent = (1 - ctx.creep.hits / ctx.creep.hitsMax) * 100;
    health -= damagePercent * 0.3; // Damage impacts health moderately
  }
  
  // Hostiles nearby
  if (ctx.nearbyEnemies) {
    health -= 15;
  }
  
  // Creep is on room exit (potential cycling issue)
  const pos = ctx.creep.pos;
  if (pos.x === 0 || pos.x === 49 || pos.y === 0 || pos.y === 49) {
    health -= 10;
  }
  
  // Clamp to 0-100 range
  return Math.max(0, Math.min(100, health));
}

/**
 * Determine if a behavior should switch to emergency mode.
 * Based on behavior health assessment and room conditions.
 */
export function shouldUseEmergencyMode(ctx: CreepContext): boolean {
  const health = assessBehaviorHealth(ctx);
  
  // Switch to emergency if health is critical
  if (health < 30) return true;
  
  // Switch if room is under heavy attack
  if (ctx.swarmState) {
    if (ctx.swarmState.danger >= 3) return true; // Siege/Nuke
    if (ctx.swarmState.danger >= 2 && health < 50) return true; // Active attack
  }
  
  // Switch if creep is very damaged and enemies nearby
  if (ctx.creep.hits < ctx.creep.hitsMax * 0.3 && ctx.hostiles.length > 0) {
    return true;
  }
  
  return false;
}
