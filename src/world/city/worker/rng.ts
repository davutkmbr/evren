/** Deterministic integer hashing and a small seeded PRNG (identical results on every thread). */

export function hashInts(a: number, b: number, c = 0, d = 0): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= Math.imul(c | 0, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 13), 0x27d4eb2f);
  h ^= Math.imul(d | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h ^= h >>> 13;
  return h >>> 0;
}

export function hash01(a: number, b: number, c = 0, d = 0): number {
  return hashInts(a, b, c, d) / 4294967296;
}

export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0 || 0x9e3779b9;
  }

  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }

  int(a: number, b: number): number {
    return a + Math.floor(this.next() * (b - a + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Approximately normal (sum of three uniforms), mean 0, sd ~1. */
  gauss(): number {
    return (this.next() + this.next() + this.next() - 1.5) * 2;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length) % items.length];
  }

  /** Picks from [value, weight] pairs. */
  weighted<T>(items: readonly (readonly [T, number])[]): T {
    let total = 0;
    for (const it of items) {
      total += it[1];
    }
    let r = this.next() * total;
    for (const it of items) {
      r -= it[1];
      if (r <= 0) {
        return it[0];
      }
    }
    return items[items.length - 1][0];
  }
}

/** Smooth 2D value noise in [0, 1] (deterministic lattice hash). */
export function valueNoise(x: number, z: number, salt: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash01(ix, iz, salt);
  const b = hash01(ix + 1, iz, salt);
  const c = hash01(ix, iz + 1, salt);
  const d = hash01(ix + 1, iz + 1, salt);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}
