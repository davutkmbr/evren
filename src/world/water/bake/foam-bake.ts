/**
 * Tileable foam/detail texture (RGBA8, 256^2):
 *   R: bubbly foam web (Worley F2 - F1 cell walls at two scales, holes inside)
 *   G: fine bubbles / spray dots
 *   B: streaks stretched along +u (wind rows / current slicks, rotated in the shader)
 *   A: smooth tileable value noise (breakup masks)
 */
import { createRng } from '../../../core/math/noise';

export interface FoamBakeResult {
  data: Uint8Array;
  size: number;
}

function worleyTable(cells: number, rng: () => number): Float32Array {
  const pts = new Float32Array(cells * cells * 2);
  for (let i = 0; i < cells * cells; i++) {
    pts[i * 2] = 0.1 + 0.8 * rng();
    pts[i * 2 + 1] = 0.1 + 0.8 * rng();
  }
  return pts;
}

/** Returns F1 and F2 (in cell units) for a tileable Worley field. */
function worley(u: number, v: number, cells: number, pts: Float32Array, out: Float32Array): void {
  const x = u * cells;
  const y = v * cells;
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  let f1 = 9;
  let f2 = 9;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const gx = cx + dx;
      const gy = cy + dy;
      const wx = ((gx % cells) + cells) % cells;
      const wy = ((gy % cells) + cells) % cells;
      const k = (wy * cells + wx) * 2;
      const px = gx + pts[k];
      const py = gy + pts[k + 1];
      const d = Math.hypot(px - x, py - y);
      if (d < f1) {
        f2 = f1;
        f1 = d;
      } else if (d < f2) {
        f2 = d;
      }
    }
  }
  out[0] = f1;
  out[1] = f2;
}

function valueNoiseTable(cells: number, rng: () => number): Float32Array {
  const t = new Float32Array(cells * cells);
  for (let i = 0; i < t.length; i++) {
    t[i] = rng();
  }
  return t;
}

function valueNoise(u: number, v: number, cellsX: number, cellsY: number, table: Float32Array): number {
  const x = u * cellsX;
  const y = v * cellsY;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const at = (gx: number, gy: number): number => {
    const wx = ((gx % cellsX) + cellsX) % cellsX;
    const wy = ((gy % cellsY) + cellsY) % cellsY;
    return table[(wy * cellsX + wx) % table.length];
  };
  const a = at(ix, iy);
  const b = at(ix + 1, iy);
  const c = at(ix, iy + 1);
  const d = at(ix + 1, iy + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

export function bakeFoam(seed = 7331): FoamBakeResult {
  const size = 256;
  const rng = createRng(seed);
  const coarse = worleyTable(9, rng);
  const mid = worleyTable(21, rng);
  const fine = worleyTable(53, rng);
  const noiseA = valueNoiseTable(16 * 16, rng);
  const noiseB = valueNoiseTable(64 * 64, rng);
  const streakT = valueNoiseTable(4 * 96, rng);
  const data = new Uint8Array(size * size * 4);
  const f = new Float32Array(2);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;
      const warpU = u + (valueNoise(u, v, 16, 16, noiseA) - 0.5) * 0.035;
      const warpV = v + (valueNoise(u + 0.37, v + 0.61, 16, 16, noiseA) - 0.5) * 0.035;

      worley(warpU, warpV, 9, coarse, f);
      const webCoarse = 1 - smooth(0.0, 0.16, f[1] - f[0]);
      const holesCoarse = smooth(0.05, 0.55, f[0]);
      worley(warpU, warpV, 21, mid, f);
      const webMid = 1 - smooth(0.0, 0.2, f[1] - f[0]);
      const blobMid = 1 - smooth(0.15, 0.5, f[0]);
      const web = Math.min(1, webCoarse * 0.75 + webMid * 0.55 + blobMid * 0.25 * holesCoarse);
      const breakup = valueNoise(u, v, 64, 64, noiseB);
      const r = Math.min(1, web * (0.55 + 0.6 * breakup));

      worley(u, v, 53, fine, f);
      const g = (1 - smooth(0.05, 0.32, f[0])) * (0.4 + 0.6 * valueNoise(u + 0.13, v, 64, 64, noiseB));

      const streakBase = valueNoise(u, v, 4, 96, streakT);
      const streakDetail = valueNoise(u * 3 + 0.2, v, 12, 64, noiseB);
      const b = Math.pow(smooth(0.35, 0.95, streakBase * 0.75 + streakDetail * 0.25), 1.5);

      const a = valueNoise(u, v, 16, 16, noiseA) * 0.65 + valueNoise(u, v, 64, 64, noiseB) * 0.35;

      const o = (y * size + x) * 4;
      data[o] = Math.round(r * 255);
      data[o + 1] = Math.round(g * 255);
      data[o + 2] = Math.round(b * 255);
      data[o + 3] = Math.round(a * 255);
    }
  }
  return { data, size };
}
