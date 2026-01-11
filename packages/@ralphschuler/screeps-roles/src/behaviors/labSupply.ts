/**
 * Lab Supply Behavior
 *
 * Handles lab resource management:
 * - Load input labs with reactants
 * - Empty output labs of products
 * - Supply boost labs with compounds
 * - Return resources to terminal
 *
 * Design aligned with ROADMAP.md Section 16
 */

import type { CreepAction, CreepContext } from "./types";
import { labManager } from "../labs/labManager";
import { clearCacheOnStateChange } from "../cache";

/**
 * Update working state for lab supply.
 * Working = carrying resources to deliver.
 */
function updateWorkingState(ctx: CreepContext): boolean {
  const wasWorking = ctx.memory.working ?? false;
  if (ctx.isEmpty) ctx.memory.working = false;
  if (ctx.isFull) ctx.memory.working = true;
  const isWorking = ctx.memory.working ?? false;

  if (wasWorking !== isWorking) {
    clearCacheOnStateChange(ctx.creep);
    // Clear target when state changes
    delete ctx.memory.targetId;
  }

  return isWorking;
}

/**
 * Lab supply behavior - manages lab resources
 */
export function labSupply(ctx: CreepContext): CreepAction {
  const isWorking = updateWorkingState(ctx);

  if (isWorking) {
    // Delivering resources to labs
    return deliverToLabs(ctx);
  } else {
    // Collecting resources for labs
    return collectForLabs(ctx);
  }
}

/**
 * Deliver resources to labs that need them
 */
function deliverToLabs(ctx: CreepContext): CreepAction {
  // Check if we have a target lab
  if (ctx.memory.targetId) {
    const obj = Game.getObjectById(ctx.memory.targetId as Id<StructureLab>);
    // Type guard to verify it's actually a lab
    if (obj && obj.structureType === STRUCTURE_LAB) {
      const lab = obj ;
      // Find what we're carrying
      const carrying = Object.keys(ctx.creep.store).find(
        r => ctx.creep.store[r as ResourceConstant] > 0
      ) as ResourceConstant | undefined;

      if (carrying) {
        return { type: "transfer", target: lab, resourceType: carrying };
      }
    }
    // Target invalid, clear it
    delete ctx.memory.targetId;
  }

  // Find lab that needs resources
  const needs = labManager.getLabResourceNeeds(ctx.room.name);
  if (needs.length === 0) {
    // No labs need resources, return to idle
    return { type: "idle" };
  }

  // Sort by priority
  needs.sort((a, b) => b.priority - a.priority);
  const need = needs[0];
  if (!need) return { type: "idle" };

  // Check if we're carrying the right resource
  const carrying = Object.keys(ctx.creep.store).find(
    r => ctx.creep.store[r as ResourceConstant] > 0
  ) as ResourceConstant | undefined;

  if (carrying && carrying !== need.resourceType) {
    // Wrong resource, need to return to terminal first
    if (ctx.terminal) {
      return { type: "transfer", target: ctx.terminal, resourceType: carrying };
    }
  }

  // Set target and deliver
  const lab = Game.getObjectById(need.labId);
  if (!lab) return { type: "idle" };

  ctx.memory.targetId = need.labId;
  return { type: "transfer", target: lab, resourceType: need.resourceType };
}

/**
 * Collect resources from terminal or labs
 */
function collectForLabs(ctx: CreepContext): CreepAction {
  // First priority: empty labs with overflow
  const overflow = labManager.getLabOverflow(ctx.room.name);
  if (overflow.length > 0) {
    // Sort by priority
    overflow.sort((a, b) => b.priority - a.priority);
    const overflowLab = overflow[0];
    if (overflowLab) {
      const lab = Game.getObjectById(overflowLab.labId);
      if (lab) {
        return { type: "withdraw", target: lab, resourceType: overflowLab.resourceType };
      }
    }
  }

  // Second priority: collect resources from terminal for labs
  const needs = labManager.getLabResourceNeeds(ctx.room.name);
  if (needs.length > 0 && ctx.terminal) {
    // Sort by priority
    needs.sort((a, b) => b.priority - a.priority);
    const need = needs[0];
    if (need) {
      const available = ctx.terminal.store[need.resourceType] ?? 0;
      if (available > 0) {
        ctx.memory.targetId = need.labId; // Remember which lab this is for
        return { type: "withdraw", target: ctx.terminal, resourceType: need.resourceType };
      }
    }
  }

  // Nothing to do
  return { type: "idle" };
}
