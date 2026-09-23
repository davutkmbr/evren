export type Rng = () => number;

/** Small, fast, seedable PRNG returning [0, 1). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randRange(rng: Rng, min: number, max: number): number {
  return min + (max - min) * rng();
}

/** Exponentially distributed interval with the given mean (Poisson process). */
export function randExp(rng: Rng, mean: number): number {
  return -Math.log(1 - rng() * 0.999999) * mean;
}
