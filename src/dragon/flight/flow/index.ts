/**
 * Flow ("Akış", phase 20 stage D). A move participates by emitting the usual `maneuver` start event (and, when it knows
 * when it ends, the `ended` event with its `clean` verdict), or by calling `sim.flow.beginMotion` / `endMotion`; a move
 * that does neither still counts as an unnamed motion once it rotates, loads or dives enough. See
 * .docs/planning/20-movement.md, "Stage D as built".
 */
export { FlowSystem, FLOW_MOMENT_LABELS, type FlowMoment, type FlowTransition } from './flow';
export { BURST, type LinkSource } from './burst';
export { FLOW } from './params';
export { referenceGlideRate } from './segmenter';
export type { HarmonyTerms, MotionDescriptor, MotionSnapshot } from './types';
