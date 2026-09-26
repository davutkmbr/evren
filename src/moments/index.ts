/**
 * Moments ("Anlar", phase 19): record format, pure trigger evaluator, content records and the pure runtime logic.
 * The game system (DOM, services) lives in ./system.ts and is registered in src/main.ts.
 */
export type * from './types';
export * from './triggers';
export * from './prefs';
export { ALL_MOMENTS } from './data';
export * from './runtime';
