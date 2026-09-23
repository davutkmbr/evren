/** Smooth 1D gradient noise in ~[-1, 1] (quintic fade), cheap enough to evaluate dozens of times per frame. */
function gradient(i: number, seed: number): number {
  let h = Math.imul(i | 0, 0x27d4eb2d) ^ Math.imul(seed | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return ((h >>> 0) / 4294967295) * 2 - 1;
}

export function noise1(x: number, seed: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * f * (f * (f * 6 - 15) + 10);
  const a = gradient(i, seed) * f;
  const b = gradient(i + 1, seed) * (f - 1);
  return (a + (b - a) * u) * 2;
}

/** Two octaves of noise1, normalized to ~[-1, 1]. */
export function fbm1(x: number, seed: number): number {
  return (noise1(x, seed) + 0.5 * noise1(x * 2.13 + 17.7, seed + 101)) / 1.5;
}
