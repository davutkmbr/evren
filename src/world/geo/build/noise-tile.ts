import { hash2i } from '../../../core/math/noise';

/**
 * Tileable fBm gradient-noise tile. Sampling it at a few rotated/scaled frames is ~20x cheaper than
 * evaluating simplex octaves per cell of a 2048² grid, and the incommensurate frames hide the period.
 */
export class NoiseTile {
  readonly size: number;
  readonly data: Float32Array;
  private readonly mask: number;

  constructor(size: number, octaves: number, basePeriod: number, seed: number) {
    this.size = size;
    this.mask = size - 1;
    this.data = new Float32Array(size * size);
    let amp = 1;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      const period = basePeriod << o;
      const gx = new Float32Array(period * period);
      const gz = new Float32Array(period * period);
      for (let j = 0; j < period; j++) {
        for (let i = 0; i < period; i++) {
          const a = hash2i(i, j, seed + o * 7919) * Math.PI * 2;
          gx[j * period + i] = Math.cos(a);
          gz[j * period + i] = Math.sin(a);
        }
      }
      const scale = period / size;
      for (let ty = 0; ty < size; ty++) {
        const v = ty * scale;
        const j0 = Math.floor(v);
        const fz = v - j0;
        const j1 = (j0 + 1) % period;
        const sz = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
        for (let tx = 0; tx < size; tx++) {
          const u = tx * scale;
          const i0 = Math.floor(u);
          const fx = u - i0;
          const i1 = (i0 + 1) % period;
          const sx = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
          const g00 = j0 * period + i0;
          const g10 = j0 * period + i1;
          const g01 = j1 * period + i0;
          const g11 = j1 * period + i1;
          const n00 = gx[g00] * fx + gz[g00] * fz;
          const n10 = gx[g10] * (fx - 1) + gz[g10] * fz;
          const n01 = gx[g01] * fx + gz[g01] * (fz - 1);
          const n11 = gx[g11] * (fx - 1) + gz[g11] * (fz - 1);
          const nx0 = n00 + (n10 - n00) * sx;
          const nx1 = n01 + (n11 - n01) * sx;
          this.data[ty * size + tx] += amp * (nx0 + (nx1 - nx0) * sz);
        }
      }
      norm += amp;
      amp *= 0.5;
    }
    // Gradient noise peaks near ±0.7; normalize to roughly [-1, 1].
    const k = 1.35 / norm;
    for (let i = 0; i < this.data.length; i++) {
      this.data[i] *= k;
    }
  }

  /** Bilinear, wrapping sample at texel coordinates. */
  sample(u: number, v: number): number {
    const iu = Math.floor(u);
    const iv = Math.floor(v);
    const fu = u - iu;
    const fv = v - iv;
    const m = this.mask;
    const s = this.size;
    const x0 = iu & m;
    const x1 = (iu + 1) & m;
    const y0 = (iv & m) * s;
    const y1 = ((iv + 1) & m) * s;
    const d = this.data;
    const a = d[y0 + x0];
    const b = d[y0 + x1];
    const c = d[y1 + x0];
    const e = d[y1 + x1];
    return (a + (b - a) * fu) * (1 - fv) + (c + (e - c) * fu) * fv;
  }
}

/** A rotated, scaled, offset sampling frame of a tile, in world meters. */
export class NoiseFrame {
  private readonly c: number;
  private readonly s: number;

  constructor(
    private readonly tile: NoiseTile,
    metersPerTexel: number,
    angleRad: number,
    private readonly offU: number,
    private readonly offV: number,
  ) {
    this.c = Math.cos(angleRad) / metersPerTexel;
    this.s = Math.sin(angleRad) / metersPerTexel;
  }

  at(x: number, z: number): number {
    return this.tile.sample(x * this.c - z * this.s + this.offU, x * this.s + z * this.c + this.offV);
  }
}
