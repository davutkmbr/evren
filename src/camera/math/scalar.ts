const TAU = Math.PI * 2;

export const DEG = Math.PI / 180;

/** Wraps an angle into (-π, π]. */
export function wrapAngle(a: number): number {
  a = (a + Math.PI) % TAU;
  if (a < 0) {
    a += TAU;
  }
  return a - Math.PI;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function smootherstep(t: number): number {
  t = clamp(t, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Soft clamp: linear near zero, asymptotically approaches ±limit. */
export function softClamp(v: number, limit: number): number {
  return limit * Math.tanh(v / limit);
}

/** Yaw (rotation about +Y) that turns object-forward (-Z) toward the horizontal part of (dx, dz). */
export function yawOfDirection(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}
