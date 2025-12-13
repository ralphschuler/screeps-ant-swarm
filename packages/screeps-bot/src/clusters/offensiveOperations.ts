/**
 * Offensive Operations Coordinator
 *
 * High-level coordinator for offensive military operations.
 * Manages the complete offensive workflow:
 * 1. Target selection
 * 2. Doctrine determination
 * 3. Squad creation
 * 4. Squad formation
 * 5. Operation execution
 * 6. Multi-room coordination
 *
 * Implements ROADMAP Section 12: Offensive Combat
 */

import type { ClusterMemory, SquadDefinition } from "../memory/schemas";
import { logger } from "../core/logger";
import { memoryManager } from "../memory/manager";
import { findAttackTargets, markRoomAttacked, validateTarget } from "./attackTargetSelector";
import { type OffensiveDoctrine, canLaunchDoctrine, selectDoctrine } from "./offensiveDoctrine";
import { createOffensiveSquad, shouldDissolveSquad, validateSquadState } from "./squadCoordinator";
import { isSquadForming, startSquadFormation, updateSquadFormations } from "./squadFormationManager";

/**
 * Offensive operation tracking
 */
export interface OffensiveOperation {
  /** Operation ID */
  id: string;
  /** Cluster executing the operation */
  clusterId: string;
  /** Target room */
  targetRoom: string;
  /** Operation doctrine */
  doctrine: OffensiveDoctrine;
  /** Squads involved */
  squadIds: string[];
  /** Operation state */
  state: "planning" | "forming" | "executing" | "complete" | "failed";
  /** Creation tick */
  createdAt: number;
  /** Last update tick */
  lastUpdate: number;
  /** Whether this operation is assisting an ally */
  isAllyAssist?: boolean;
  /** Name of the ally being assisted (if isAllyAssist is true) */
  allyName?: string;
}

/**
 * Active operations (stored in global)
 */
const activeOperations = new Map<string, OffensiveOperation>();

/**
 * Plan and launch offensive operations for a cluster
 */
export function planOffensiveOperations(cluster: ClusterMemory): void {
  // Check if cluster is in war mode
  if (cluster.role !== "war" && cluster.role !== "mixed") {
    return;
  }
  
  // Check if we have capacity for more operations
  const activeOps = Array.from(activeOperations.values()).filter(
    op => op.clusterId === cluster.id && op.state !== "complete" && op.state !== "failed"
  );
  
  const MAX_CONCURRENT_OPS = 2;
  if (activeOps.length >= MAX_CONCURRENT_OPS) {
    logger.debug(`Cluster ${cluster.id} at max operations (${activeOps.length})`, {
      subsystem: "Offensive"
    });
    return;
  }
  
  // Find potential targets
  const targets = findAttackTargets(cluster, 10, 3);
  
  if (targets.length === 0) {
    logger.debug(`No attack targets found for cluster ${cluster.id}`, {
      subsystem: "Offensive"
    });
    return;
  }
  
  // Select best target
  const target = targets[0]!;
  
  // Check if we can launch the doctrine
  if (!canLaunchDoctrine(cluster, target.doctrine)) {
    logger.info(
      `Cluster ${cluster.id} cannot launch ${target.doctrine} doctrine (insufficient resources)`,
      { subsystem: "Offensive" }
    );
    return;
  }
  
  // Launch operation
  launchOffensiveOperation(cluster, target.roomName, target.doctrine);
}

/**
 * Launch an offensive operation
 */
export function launchOffensiveOperation(
  cluster: ClusterMemory,
  targetRoom: string,
  doctrine?: OffensiveDoctrine
): OffensiveOperation | null {
  // Validate target
  if (!validateTarget(targetRoom)) {
    logger.warn(`Invalid target ${targetRoom}`, { subsystem: "Offensive" });
    return null;
  }
  
  // Determine doctrine if not specified
  const overmind = memoryManager.getOvermind();
  const intel = overmind.roomIntel[targetRoom];
  const finalDoctrine = doctrine ?? selectDoctrine(targetRoom, {
    towerCount: intel?.towerCount,
    spawnCount: intel?.spawnCount,
    rcl: intel?.controllerLevel,
    owner: intel?.owner
  });
  
  // Check if we can launch
  if (!canLaunchDoctrine(cluster, finalDoctrine)) {
    logger.warn(
      `Cannot launch ${finalDoctrine} operation on ${targetRoom} - insufficient resources`,
      { subsystem: "Offensive" }
    );
    return null;
  }
  
  // Create operation
  const opId = `op_${cluster.id}_${targetRoom}_${Game.time}`;
  const operation: OffensiveOperation = {
    id: opId,
    clusterId: cluster.id,
    targetRoom,
    doctrine: finalDoctrine,
    squadIds: [],
    state: "planning",
    createdAt: Game.time,
    lastUpdate: Game.time
  };
  
  activeOperations.set(opId, operation);
  
  // Create squad (map doctrine type to squad type)
  const squadType = finalDoctrine === "harassment" ? "harass" : finalDoctrine;
  const squad = createOffensiveSquad(cluster, targetRoom, squadType, {
    towerCount: intel?.towerCount,
    spawnCount: intel?.spawnCount
  });
  
  // Add squad to cluster memory
  cluster.squads.push(squad);
  operation.squadIds.push(squad.id);
  
  // Start forming squad
  startSquadFormation(cluster, squad);
  operation.state = "forming";
  
  // Mark room as being attacked
  markRoomAttacked(targetRoom);
  
  logger.info(
    `Launched ${finalDoctrine} operation ${opId} on ${targetRoom} with squad ${squad.id}`,
    { subsystem: "Offensive" }
  );
  
  return operation;
}

/**
 * Update active offensive operations
 */
export function updateOffensiveOperations(): void {
  // Update squad formations
  updateSquadFormations();
  
  for (const [opId, operation] of activeOperations.entries()) {
    updateOperation(operation);
  }
  
  // Clean up old operations
  cleanupOperations();
}

/**
 * Update a single operation
 */
function updateOperation(operation: OffensiveOperation): void {
  operation.lastUpdate = Game.time;
  
  const cluster = memoryManager.getCluster(operation.clusterId);
  if (!cluster) {
    operation.state = "failed";
    logger.error(`Cluster ${operation.clusterId} not found for operation ${operation.id}`, {
      subsystem: "Offensive"
    });
    return;
  }
  
  switch (operation.state) {
    case "forming":
      updateFormingOperation(operation, cluster);
      break;
    case "executing":
      updateExecutingOperation(operation, cluster);
      break;
  }
}

/**
 * Update an operation in forming state
 */
function updateFormingOperation(operation: OffensiveOperation, cluster: ClusterMemory): void {
  // Check if all squads have finished forming
  const allFormed = operation.squadIds.every(squadId => !isSquadForming(squadId));
  
  if (allFormed) {
    operation.state = "executing";
    logger.info(`Operation ${operation.id} entering execution phase`, {
      subsystem: "Offensive"
    });
  }
  
  // Check for formation timeout
  const age = Game.time - operation.createdAt;
  if (age > 1000) {
    operation.state = "failed";
    logger.warn(`Operation ${operation.id} formation timed out`, {
      subsystem: "Offensive"
    });
  }
}

/**
 * Update an operation in executing state
 */
function updateExecutingOperation(operation: OffensiveOperation, cluster: ClusterMemory): void {
  // Update squad states
  for (const squadId of operation.squadIds) {
    const squad = cluster.squads.find(s => s.id === squadId);
    if (!squad) continue;
    
    validateSquadState(squad);
    
    // Check if squad should be dissolved
    if (shouldDissolveSquad(squad)) {
      logger.info(`Squad ${squadId} dissolving, operation ${operation.id} may complete`, {
        subsystem: "Offensive"
      });
      // Remove from cluster
      const index = cluster.squads.findIndex(s => s.id === squadId);
      if (index >= 0) cluster.squads.splice(index, 1);
    }
  }
  
  // Check if all squads are dissolved
  const activeSquads = operation.squadIds.filter(squadId =>
    cluster.squads.some(s => s.id === squadId)
  );
  
  if (activeSquads.length === 0) {
    operation.state = "complete";
    logger.info(`Operation ${operation.id} complete`, { subsystem: "Offensive" });
  }
}

/**
 * Clean up completed/failed operations
 */
function cleanupOperations(): void {
  const MAX_AGE = 5000; // Keep for 5000 ticks for debugging
  
  for (const [opId, operation] of activeOperations.entries()) {
    const age = Game.time - operation.createdAt;
    
    if ((operation.state === "complete" || operation.state === "failed") && age > MAX_AGE) {
      activeOperations.delete(opId);
      logger.debug(`Cleaned up operation ${opId}`, { subsystem: "Offensive" });
    }
  }
}

/**
 * Get operation status
 */
export function getOperationStatus(operationId: string): OffensiveOperation | null {
  return activeOperations.get(operationId) ?? null;
}

/**
 * Get all active operations for a cluster
 */
export function getClusterOperations(clusterId: string): OffensiveOperation[] {
  return Array.from(activeOperations.values()).filter(
    op => op.clusterId === clusterId && op.state !== "complete" && op.state !== "failed"
  );
}

/**
 * Cancel an operation
 */
export function cancelOperation(operationId: string): void {
  const operation = activeOperations.get(operationId);
  if (!operation) return;
  
  operation.state = "failed";
  
  logger.info(`Cancelled operation ${operationId}`, { subsystem: "Offensive" });
}

/**
 * Get all active operations (for debugging/stats)
 */
export function getAllOperations(): OffensiveOperation[] {
  return Array.from(activeOperations.values());
}
