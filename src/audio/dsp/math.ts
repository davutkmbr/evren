/** NaN-safe: NaN clamps to `lo`, so a bad input can never reach an AudioParam (which throws on non-finite values). */
export function clamp(v: number, lo: number, hi: number): number {
  return v >= lo ? (v <= hi ? v : hi) : lo;
}

export function clamp01(v: number): number {
  return v >= 0 ? (v <= 1 ? v : 1) : 0;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

export function finiteOr(v: number, fallback: number): number {
  return Number.isFinite(v) ? v : fallback;
}

export function isFiniteVec(v: { readonly x: number; readonly y: number; readonly z: number }): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}
