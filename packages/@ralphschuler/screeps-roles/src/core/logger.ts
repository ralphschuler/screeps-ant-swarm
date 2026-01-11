/**
 * Logger re-exports for roles package
 * Re-exports logger functionality from the main core package
 */

export {
  logger,
  createLogger
} from "@ralphschuler/screeps-core";

/**
 * Logger interface for type annotations
 */
export interface Logger {
  debug(message: string, context?: any): void;
  info(message: string, context?: any): void;
  warn(message: string, context?: any): void;
  error(message: string, context?: any): void;
}
