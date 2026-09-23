import type { GridSpec } from './grid';
import { HEIGHT_GRID, sampleBilinear } from './grid';

/** Gaussian splat width (m) for spot-height residuals: ~0.55 × the lattice spacing of the data. */
const SIGMA = 260;
const SUPPORT = SIGMA * 2.6;
/** Shore ramp constants mirrored from composeBaseHeights (ground at the waterline, ramp length). */
const SHORE_H = 1.3;
const RAMP_LENGTH = 135;
const MIN_RAMP = 0.7;

/**
 * Pins the coarse land relief to dense spot heights. Each target is inverted through the shore ramp that
 * composeBaseHeights applies later, the residuals against the current field are splatted with normalized
 * Gaussian weights (Shepard), and a second pass removes most of what the smoothing left. Mutates `land`
 * and returns per-cell coverage 0..1 (1 inside the sampled area), used to calm the synthetic dissection.
 */
export function applySpotHeights(land: Float32Array, grid: GridSpec, spots: Float64Array, coast: Float32Array): Float32Array {
  const count = spots.length / 3;
  const target = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const cd = sampleBilinear(coast, HEIGHT_GRID, spots[i * 3], spots[i * 3 + 1]);
    const ramp = Math.max(MIN_RAMP, 1 - Math.exp(-Math.max(0, cd) / RAMP_LENGTH));
    target[i] = SHORE_H + (spots[i * 3 + 2] - SHORE_H) / ramp;
  }
  const cells = grid.size * grid.size;
  const num = new Float32Array(cells);
  const den = new Float32Array(cells);
  const coverage = new Float32Array(cells);
  const residual = new Float32Array(count);
  for (let pass = 0; pass < 2; pass++) {
    num.fill(0);
    den.fill(0);
    for (let i = 0; i < count; i++) {
      residual[i] = target[i] - sampleBilinear(land, grid, spots[i * 3], spots[i * 3 + 1]);
    }
    splat(grid, spots, residual, num, den);
    for (let k = 0; k < cells; k++) {
      const d = den[k];
      if (d > 0) {
        land[k] += num[k] / (d > 1 ? d : 1);
        if (pass === 0) {
          coverage[k] = d > 1 ? 1 : d;
        }
      }
    }
  }
  return coverage;
}

function splat(grid: GridSpec, spots: Float64Array, values: Float32Array, num: Float32Array, den: Float32Array): void {
  const n = grid.size;
  const inv2s2 = 1 / (2 * SIGMA * SIGMA);
  const reach = Math.ceil(SUPPORT / grid.cell);
  for (let i = 0; i < values.length; i++) {
    const x = spots[i * 3];
    const z = spots[i * 3 + 1];
    const v = values[i];
    const cc = Math.round((x - grid.origin) / grid.cell);
    const cr = Math.round((z - grid.origin) / grid.cell);
    for (let r = Math.max(0, cr - reach); r <= Math.min(n - 1, cr + reach); r++) {
      const dz = grid.origin + r * grid.cell - z;
      for (let c = Math.max(0, cc - reach); c <= Math.min(n - 1, cc + reach); c++) {
        const dx = grid.origin + c * grid.cell - x;
        const d2 = dx * dx + dz * dz;
        if (d2 > SUPPORT * SUPPORT) {
          continue;
        }
        const w = Math.exp(-d2 * inv2s2);
        num[r * n + c] += w * v;
        den[r * n + c] += w;
      }
    }
  }
}
