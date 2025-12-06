/**
 * Process Decorators
 *
 * TypeScript decorators for registering kernel processes declaratively.
 * Allows classes to define processes using method decorators instead of
 * manual registration calls.
 *
 * Usage:
 * ```typescript
 * class MyManager {
 *   @Process({
 *     id: "my:process",
 *     name: "My Process",
 *     priority: ProcessPriority.MEDIUM,
 *     frequency: "medium",
 *     interval: 10
 *   })
 *   run(): void {
 *     // Process logic
 *   }
 * }
 * ```
 */

import { type ProcessFrequency, ProcessPriority, kernel } from "./kernel";
import { logger } from "./logger";

/**
 * Process decorator options
 */
export interface ProcessOptions {
  /** Unique process ID */
  id: string;
  /** Display name */
  name: string;
  /** Process priority (default: MEDIUM) */
  priority?: ProcessPriority;
  /** Process frequency (default: "medium") */
  frequency?: ProcessFrequency;
  /** Minimum CPU bucket to run (default: based on frequency) */
  minBucket?: number;
  /** CPU budget as fraction of limit (default: 0.1) */
  cpuBudget?: number;
  /** Run interval in ticks (default: based on frequency) */
  interval?: number;
}

/**
 * Metadata storage for decorated processes
 */
interface ProcessMetadata {
  options: ProcessOptions;
  methodName: string;
  target: object;
}

/**
 * Storage for process metadata before registration
 */
const processMetadataStore: ProcessMetadata[] = [];

/**
 * Registered process classes for automatic discovery
 */
const registeredClasses: Set<new () => unknown> = new Set();

/**
 * Process decorator - marks a method as a kernel process
 *
 * @param options - Process configuration options
 * @returns Method decorator
 *
 * @example
 * ```typescript
 * class EmpireController {
 *   @Process({
 *     id: "empire:scan",
 *     name: "Empire Scanner",
 *     priority: ProcessPriority.LOW,
 *     frequency: "low",
 *     interval: 50
 *   })
 *   scanEmpire(): void {
 *     // Scan logic
 *   }
 * }
 * ```
 */
export function Process(options: ProcessOptions) {
  return function<T>(
    target: object,
    propertyKey: string | symbol,
    _descriptor: TypedPropertyDescriptor<T>
  ): void {
    processMetadataStore.push({
      options,
      methodName: String(propertyKey),
      target
    });
  };
}

/**
 * High frequency process decorator (runs every tick)
 * Shorthand for @Process with frequency: "high"
 */
export function HighFrequencyProcess(
  id: string,
  name: string,
  options?: Partial<Omit<ProcessOptions, "id" | "name" | "frequency">>
) {
  return Process({
    id,
    name,
    priority: ProcessPriority.HIGH,
    frequency: "high",
    minBucket: 500,
    cpuBudget: 0.3,
    interval: 1,
    ...options
  });
}

/**
 * Medium frequency process decorator (runs every 5-10 ticks)
 * Shorthand for @Process with frequency: "medium"
 */
export function MediumFrequencyProcess(
  id: string,
  name: string,
  options?: Partial<Omit<ProcessOptions, "id" | "name" | "frequency">>
) {
  return Process({
    id,
    name,
    priority: ProcessPriority.MEDIUM,
    frequency: "medium",
    minBucket: 2000,
    cpuBudget: 0.15,
    interval: 5,
    ...options
  });
}

/**
 * Low frequency process decorator (runs every 20+ ticks)
 * Shorthand for @Process with frequency: "low"
 */
export function LowFrequencyProcess(
  id: string,
  name: string,
  options?: Partial<Omit<ProcessOptions, "id" | "name" | "frequency">>
) {
  return Process({
    id,
    name,
    priority: ProcessPriority.LOW,
    frequency: "low",
    minBucket: 5000,
    cpuBudget: 0.1,
    interval: 20,
    ...options
  });
}

/**
 * Critical process decorator (must run every tick)
 * Shorthand for @Process with priority: CRITICAL
 */
export function CriticalProcess(
  id: string,
  name: string,
  options?: Partial<Omit<ProcessOptions, "id" | "name" | "priority">>
) {
  return Process({
    id,
    name,
    priority: ProcessPriority.CRITICAL,
    frequency: "high",
    minBucket: 100,
    cpuBudget: 0.3,
    interval: 1,
    ...options
  });
}

/**
 * Idle process decorator (very low priority background tasks)
 * Shorthand for @Process with priority: IDLE
 */
export function IdleProcess(
  id: string,
  name: string,
  options?: Partial<Omit<ProcessOptions, "id" | "name" | "priority">>
) {
  return Process({
    id,
    name,
    priority: ProcessPriority.IDLE,
    frequency: "low",
    minBucket: 8000,
    cpuBudget: 0.05,
    interval: 100,
    ...options
  });
}

/**
 * Class decorator to mark a class as containing process methods
 * This enables automatic discovery and registration of decorated methods
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function ProcessClass(): <T extends new (...args: any[]) => any>(constructor: T) => T {
  return function<T extends new (...args: any[]) => any>(constructor: T): T {
    registeredClasses.add(constructor as unknown as new () => unknown);
    return constructor;
  };
}

/**
 * Register all decorated processes from an instance
 * Call this after creating an instance of a class with @Process decorated methods
 *
 * @param instance - Instance of a class with decorated process methods
 *
 * @example
 * ```typescript
 * const manager = new EmpireController();
 * registerDecoratedProcesses(manager);
 * ```
 */
export function registerDecoratedProcesses(instance: object): void {
  const instancePrototype = Object.getPrototypeOf(instance) as object | null;

  for (const metadata of processMetadataStore) {
    // Check if this metadata belongs to the instance's prototype chain
    if (metadata.target === instancePrototype || 
        Object.getPrototypeOf(metadata.target) === instancePrototype ||
        metadata.target === Object.getPrototypeOf(instancePrototype)) {
      
      const method = (instance as Record<string, unknown>)[metadata.methodName];
      
      if (typeof method === "function") {
        const boundMethod = (method as (...args: unknown[]) => unknown).bind(instance);
        
        kernel.registerProcess({
          id: metadata.options.id,
          name: metadata.options.name,
          priority: metadata.options.priority ?? ProcessPriority.MEDIUM,
          frequency: metadata.options.frequency ?? "medium",
          minBucket: metadata.options.minBucket,
          cpuBudget: metadata.options.cpuBudget,
          interval: metadata.options.interval,
          execute: boundMethod as () => void
        });

        logger.debug(
          `Registered decorated process "${metadata.options.name}" (${metadata.options.id})`,
          { subsystem: "ProcessDecorators" }
        );
      }
    }
  }
}

/**
 * Register processes from multiple instances
 *
 * @param instances - Array of instances with decorated process methods
 */
export function registerAllDecoratedProcesses(...instances: object[]): void {
  for (const instance of instances) {
    registerDecoratedProcesses(instance);
  }
  
  logger.info(
    `Registered decorated processes from ${instances.length} instance(s)`,
    { subsystem: "ProcessDecorators" }
  );
}

/**
 * Get all stored process metadata (for debugging)
 */
export function getProcessMetadata(): ProcessMetadata[] {
  return [...processMetadataStore];
}

/**
 * Clear all stored process metadata (for testing)
 */
export function clearProcessMetadata(): void {
  processMetadataStore.length = 0;
}

/**
 * Get all registered process classes
 */
export function getRegisteredClasses(): Set<new () => unknown> {
  return new Set(registeredClasses);
}
