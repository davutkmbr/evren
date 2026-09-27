/**
 * The knight statue's three animations as one timeline over the moment's lines (pure, checked headless):
 *  - 'moments/knight-raise-spear' (0.2–1.6 s, "Dur orada, ejderha!"): the spear arm swings up, the spear points at the
 *    dragon and trembles a little while the knight speaks;
 *  - 'moments/knight-lower-spear' (8.8–10.4 s, "…mızrağım biraz paslandı"): it comes down in two rusty jerks and stays
 *    drooping;
 *  - 'moments/knight-shrug' (11.0–12.6 s, "Bugünlük berabere diyelim mi?"): shoulders up, the shield arm opens, the
 *    head tilts, and back.
 * Each starts with an armour creak (CREAKS).
 */

export interface KnightPose {
  /** Spear arm swing (rad, 0 = arm down, spear upright). */
  spear: number;
  /** Shield arm opening outward (rad). */
  shieldOut: number;
  /** Shoulder lift (figure units). */
  shrug: number;
  /** Head tilt (rad). */
  headTilt: number;
}

export const SPEAR_RAISED = 1.2;
export const SPEAR_DROOP = 0.14;
export const RAISE: readonly [number, number] = [0.2, 1.6];
export const LOWER: readonly [number, number] = [8.8, 10.4];
export const SHRUG: readonly [number, number] = [11.0, 12.6];
/** Moment times (s) of the armour creaks: the start of each animation, plus the second jerk of the lowering. */
export const CREAKS: readonly number[] = [RAISE[0], LOWER[0], LOWER[0] + 0.9, SHRUG[0]];

const smooth = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const span = (t: number, [a, b]: readonly [number, number]): number => smooth((t - a) / (b - a));
/** 0 → 1 → 0 over the span (a smooth bump). */
const bump = (t: number, [a, b]: readonly [number, number]): number => {
  const k = (t - a) / (b - a);
  return k <= 0 || k >= 1 ? 0 : Math.sin(Math.PI * k) ** 2;
};

export const REST_POSE: Readonly<KnightPose> = { spear: 0, shieldOut: 0, shrug: 0, headTilt: 0 };

/** The pose `t` seconds into the moment (before 0 and long after, the rest pose; a lowered spear keeps its droop). */
export function knightPose(t: number, out: KnightPose = { ...REST_POSE }): KnightPose {
  const up = span(t, RAISE);
  // Lowering in two jerks: most of the way, a stall, then the rest.
  const k = (t - LOWER[0]) / (LOWER[1] - LOWER[0]);
  const down = k <= 0 ? 0 : k >= 1 ? 1 : k < 0.45 ? 0.7 * smooth(k / 0.45) : k < 0.56 ? 0.7 : 0.7 + 0.3 * smooth((k - 0.56) / 0.44);
  const raised = up * SPEAR_RAISED;
  const tremble = up * (1 - down) * 0.025 * Math.sin(t * 7.3) * Math.sin(t * 2.1);
  out.spear = raised + (SPEAR_DROOP - raised) * down + tremble;
  const s = bump(t, SHRUG);
  out.shrug = 0.05 * s;
  out.shieldOut = 0.35 * s;
  out.headTilt = 0.16 * s;
  return out;
}

/** Seconds the whole performance lasts. */
export const PERFORMANCE_SEC = SHRUG[1];
