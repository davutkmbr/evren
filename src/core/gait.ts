/**
 * Quadruped footfall timing shared by the rig (feet) and the audio (footsteps), so a step sounds when a foot plants.
 * A foot touches down when walkPhase / 2π + offset crosses a whole number.
 */

/** Footfall phase offsets (fraction of a cycle) of LH, RH, LF, RF for a walk, a trot and a gallop. */
export const FOOTFALL_WALK = [0, 0.5, 0.25, 0.75] as const;
export const FOOTFALL_TROT = [0, 0.5, 0.5, 1.0] as const;
export const FOOTFALL_GALLOP = [0, 0.12, 0.55, 0.67] as const;

/** Footfall offsets for a gait blend (0 walk, 1 trot, 2 gallop), written into `out` (LH, RH, LF, RF). */
export function footfallOffsets(gait: number, out: number[]): number[] {
  const g = Math.min(2, Math.max(0, gait));
  for (let i = 0; i < 4; i++) {
    out[i] = g <= 1 ? FOOTFALL_WALK[i] + (FOOTFALL_TROT[i] - FOOTFALL_WALK[i]) * g : FOOTFALL_TROT[i] + (FOOTFALL_GALLOP[i] - FOOTFALL_TROT[i]) * (g - 1);
  }
  return out;
}
