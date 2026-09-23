import type { GridSpec } from './grid';

interface Taps {
  idx: Int32Array;
  w: Float32Array;
}

function catmullRomTaps(coarse: GridSpec, fine: GridSpec): Taps {
  const n = fine.size;
  const m = coarse.size;
  const idx = new Int32Array(n * 4);
  const w = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const p = fine.origin + i * fine.cell;
    const f = (p - coarse.origin) / coarse.cell;
    const i1 = Math.floor(f);
    const t = f - i1;
    const t2 = t * t;
    const t3 = t2 * t;
    w[i * 4] = 0.5 * (-t3 + 2 * t2 - t);
    w[i * 4 + 1] = 0.5 * (3 * t3 - 5 * t2 + 2);
    w[i * 4 + 2] = 0.5 * (-3 * t3 + 4 * t2 + t);
    w[i * 4 + 3] = 0.5 * (t3 - t2);
    for (let k = 0; k < 4; k++) {
      idx[i * 4 + k] = Math.max(0, Math.min(m - 1, i1 - 1 + k));
    }
  }
  return { idx, w };
}

/**
 * Separable Catmull-Rom upsampling of a coarse field onto a fine grid, one fine row at a time
 * (C1-smooth, so no bilinear creases show up in terrain normals).
 */
export class CoarseUpsampler {
  private readonly rows: Float32Array;
  private readonly taps: Taps;
  private readonly n: number;

  constructor(coarse: Float32Array, coarseGrid: GridSpec, fineGrid: GridSpec) {
    const n = fineGrid.size;
    const m = coarseGrid.size;
    this.n = n;
    this.taps = catmullRomTaps(coarseGrid, fineGrid);
    const { idx, w } = this.taps;
    this.rows = new Float32Array(m * n);
    for (let r = 0; r < m; r++) {
      const src = r * m;
      const dst = r * n;
      for (let j = 0; j < n; j++) {
        const q = j * 4;
        this.rows[dst + j] =
          w[q] * coarse[src + idx[q]] + w[q + 1] * coarse[src + idx[q + 1]] + w[q + 2] * coarse[src + idx[q + 2]] + w[q + 3] * coarse[src + idx[q + 3]];
      }
    }
  }

  /** Writes fine row `i` into `out` (length = fine size). */
  row(i: number, out: Float32Array): void {
    const { idx, w } = this.taps;
    const n = this.n;
    const q = i * 4;
    const r0 = idx[q] * n;
    const r1 = idx[q + 1] * n;
    const r2 = idx[q + 2] * n;
    const r3 = idx[q + 3] * n;
    const w0 = w[q];
    const w1 = w[q + 1];
    const w2 = w[q + 2];
    const w3 = w[q + 3];
    const R = this.rows;
    for (let j = 0; j < n; j++) {
      out[j] = w0 * R[r0 + j] + w1 * R[r1 + j] + w2 * R[r2 + j] + w3 * R[r3 + j];
    }
  }
}

/** Catmull-Rom resampling of a whole field onto a finer grid. */
export function resampleGrid(coarse: Float32Array, coarseGrid: GridSpec, fineGrid: GridSpec): Float32Array {
  const up = new CoarseUpsampler(coarse, coarseGrid, fineGrid);
  const n = fineGrid.size;
  const out = new Float32Array(n * n);
  for (let r = 0; r < n; r++) {
    up.row(r, out.subarray(r * n, (r + 1) * n));
  }
  return out;
}
