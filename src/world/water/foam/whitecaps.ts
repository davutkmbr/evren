/**
 * Whitecaps from the wind-wave spectrum (phase 21 stage 7c): which crests of the Gerstner surface the water shader
 * draws break, and how many.
 *
 * Where: on the most compressed crests. The horizontal Jacobian J of the Gerstner displacement (1 on flat water, lower
 * on crests, -> 0 where the surface would fold) comes from the very slot table the shaders and the CPU evaluator read.
 * 1 - J is to first order the sum of the slots' q sin(phase) (q = Q k A x group weight), spread
 * sigma = sqrt(sum q^2 / 2); its upper tail is that of a sum of N = (sum q^2)^2 / sum q^4 sinusoids with random
 * phases, much thinner than a normal tail (it ends at sqrt(2N) sigma). A point is a crest candidate while
 * J < 1 - z_N sigma, with z_N the quantile of that sum for WHITECAPS.crestShare (5 %): exact per N (tabulated by
 * convolving arcsine densities, `crestTable`), so the steepest 5 % of the local surface qualifies everywhere, with a
 * handful of slots (Golden Horn chop) or a dozen (the open sea).
 *
 * How many: a crest breaks with probability P = activeShare x W(U10) x dev / crestShare, decided per breaking cell (a
 * few metres along a crest, riding downwind with the local phase speed, re-rolled every WHITECAPS.cellTime), so whole
 * crest segments break together and keep breaking as they travel, like real whitecaps.
 * - W = 3.84e-6 U10^3.41 is the whitecap coverage of Monahan & O'Muircheartaigh (1980); the foam the breaking leaves
 *   behind (decaying over FOAM_SIM.capLife) makes up the rest of it (`activeShare` calibrated with
 *   tools/headless/foam-check.ts against the simulated field).
 * - dev = (w_open / w_local)^1.09 is the wave-development factor of the breaking Reynolds number of Zhao & Toba
 *   (2001), W ~ (u*^2 / (nu w_p))^1.09: at the same wind a young, short-fetch sea (higher frequency) breaks less; w is
 *   the energy-weighted mean frequency of the slots, locally and at the open sea (every group at full weight). So the
 *   Bosphorus gets a fraction of the open sea's caps, the Golden Horn fewer still, and all of them follow the wind.
 *
 * Two sets come out: `sim` for the advected foam field (active breaking only; slots shorter than the field's texels
 * faded out as the sim shader fades them) and `shader` for the "low" tier, where the water shader shows caps on the
 * breaking crests alone (no field, no persistence: the whole coverage W sits there).
 */
import { GRAVITY, MAX_WAVES } from '../config';
import type { SeaStateUniforms } from '../sea-state';
import { FOAM_SIM, WHITECAPS } from './config';

/** Monahan & O'Muircheartaigh (1980) whitecap coverage (fraction of the surface) at a 10 m wind speed. */
export function monahanCoverage(u10: number): number {
  if (!(u10 >= WHITECAPS.minU10)) {
    return 0;
  }
  return Math.min(0.5, WHITECAPS.monahanCoef * u10 ** WHITECAPS.monahanExp);
}

/** Slot weight in the sim's Jacobian for a wavelength on a grid of `texel` metres (the sim shader's slot fade). */
export function slotFade(lambda: number, texel: number): number {
  if (!(texel > 0)) {
    return 1;
  }
  const e0 = FOAM_SIM.minTexels * texel;
  const e1 = FOAM_SIM.fullTexels * texel;
  let t = (lambda - e0) / (e1 - e0);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}

/** Rows of the crest table: N = 1 .. CREST_N effective slots. */
export const CREST_N = 16;

/**
 * z_N: the upper `share` quantile of sum_{i<N} sin(phi_i) / sqrt(N / 2) with independent uniform phases, for
 * N = 1..CREST_N (index N - 1). Exact up to the grid: the density of one sinusoid (arcsine law) integrated per bin and
 * convolved N times.
 */
export function buildCrestTable(share: number): Float32Array {
  const h = 1 / 64;
  const M = 128;
  const single = new Float64Array(M);
  for (let i = 0; i < M; i++) {
    const x = -1 + (i + 0.5) * h;
    single[i] = (Math.asin(Math.min(1, x + h / 2)) - Math.asin(Math.max(-1, x - h / 2))) / Math.PI;
  }
  const table = new Float32Array(CREST_N);
  let dist = Float64Array.from(single);
  for (let n = 1; n <= CREST_N; n++) {
    if (n > 1) {
      const next = new Float64Array(dist.length + M - 1);
      for (let i = 0; i < dist.length; i++) {
        const d = dist[i];
        if (d === 0) continue;
        for (let j = 0; j < M; j++) next[i + j] += d * single[j];
      }
      dist = next;
    }
    const x0 = n * (-1 + 0.5 * h);
    let cum = 0;
    let v = n;
    for (let i = dist.length - 1; i >= 0; i--) {
      const c = dist[i];
      if (cum + c >= share) {
        v = x0 + (i + 0.5 - (share - cum) / c) * h;
        break;
      }
      cum += c;
    }
    table[n - 1] = v / Math.sqrt(n / 2);
  }
  return table;
}

let crestTableCache: Float32Array | null = null;

/** The crest table for WHITECAPS.crestShare (built once). */
export function crestTable(): Float32Array {
  if (!crestTableCache) crestTableCache = buildCrestTable(WHITECAPS.crestShare);
  return crestTableCache;
}

/** z_N for a fractional effective slot count (linear between rows); the GLSL twin is foamCrestZ. */
export function crestZ(nEff: number): number {
  const t = crestTable();
  const n = Math.min(Math.max(nEff, 1), CREST_N) - 1;
  const n0 = Math.floor(n);
  const n1 = Math.min(n0 + 1, CREST_N - 1);
  return t[n0] + (t[n1] - t[n0]) * (n - n0);
}

/** J below which a point is a crest candidate, from the local spread and effective slot count (the GLSL foamCrestJ). */
export function crestThreshold(sigma: number, nEff: number): number {
  return 1 - crestZ(nEff) * sigma;
}

/** Soft edge of the crest threshold (J units): at most a share of the local spread (the GLSL foamCrestEdge). */
export function crestEdge(sigma: number): number {
  return Math.max(Math.min(WHITECAPS.edge, WHITECAPS.edgeSigma * sigma), 1e-5);
}

/** Breaking probability of a crest at a point: the open-sea probability x the local wave development, capped at 1. */
export function localBreakProbability(probOpen: number, omegaOpen: number, omegaLocal: number): number {
  if (!(probOpen > 0) || !(omegaLocal > 0)) {
    return 0;
  }
  const lnDev = Math.max(Math.log(WHITECAPS.devMin), Math.min(0, WHITECAPS.devExp * Math.log(omegaOpen / omegaLocal)));
  return Math.min(1, probOpen * Math.exp(lnDev));
}

/* Breaking cells (the GLSL twins: foamHash, foamBreakCell). Integer hash, identical in JS (Math.imul) and GLSL (uint). */
export function foamHash(a: number, b: number): number {
  let x = (Math.imul(a >>> 0, 0x27d4eb2d) ^ (((b >>> 0) + 0x9e3779b9 + ((a << 6) >>> 0) + (a >>> 2)) >>> 0)) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  x = Math.imul(x, 0x2c1b3c6d) >>> 0;
  x = (x ^ (x >>> 12)) >>> 0;
  x = Math.imul(x, 0x297a2d39) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  return x;
}

/**
 * Does the breaking cell at world (x, z) break at time t (s)? Cells are WHITECAPS.cellAlong x cellAcross metres,
 * aligned with the downwind direction (dx, dz) and riding downwind at the phase speed c (m/s); each holds its decision
 * for WHITECAPS.cellTime with a per-cell phase, and breaks with probability `prob`.
 */
export function breakCell(x: number, z: number, t: number, dx: number, dz: number, c: number, prob: number): boolean {
  if (!(prob > 0)) return false;
  const W = WHITECAPS;
  const u = (x * dx + z * dz - c * t) / W.cellAlong;
  const v = (-x * dz + z * dx) / W.cellAcross;
  const ix = Math.floor(u) | 0;
  const iz = Math.floor(v) | 0;
  const cell = foamHash(ix, iz);
  const bucket = Math.floor(t / W.cellTime + cell / 4294967296) | 0;
  const roll = foamHash(cell, bucket) / 4294967296;
  return roll < prob;
}

/** The phase speed the breaking cells ride with at a mean frequency w (deep water c = g / w). */
export function cellSpeed(omega: number): number {
  return omega > 1e-3 ? GRAVITY / omega : 0;
}

/** Sea state the model reads: the wave uniforms, the smoothed U10 and the regime blend. */
export interface WhitecapSea {
  readonly uniforms: Pick<SeaStateUniforms, 'uWaveDir' | 'uWaveAmp'>;
  readonly u10: number;
  readonly lodos: number;
}

/** One set (sim or shader): see the file comment. */
export interface WhitecapSet {
  /** Breaking probability of a crest at the open sea (0: nothing breaks; may exceed 1 before the local cap). */
  prob: number;
  /** Open sea: spread of 1 - J, effective number of slots and the crest threshold (J). */
  sigma: number;
  nEff: number;
  threshold: number;
}

const newSet = (): WhitecapSet => ({ prob: 0, sigma: 0, nEff: 1, threshold: 1 });

/**
 * The open sea's whitecap statistics of the moment (cheap: one pass over the slot table per update). The local values
 * are evaluated per texel / pixel by the sim and water shaders (and by the functions above on the CPU).
 */
export class WhitecapModel {
  /** Sets of the advected field (active breaking) and of the shader-only caps ("low"). */
  readonly sim: WhitecapSet = newSet();
  readonly shader: WhitecapSet = newSet();
  /** Target coverage W(U10) and the actively breaking share. */
  coverage = 0;
  activeFraction = 0;
  /** Energy-weighted mean frequency of the open sea's slots (rad/s). */
  omegaOpen = 1;
  /** Grid texel the sim set was computed for (m). */
  texel = 1;
  /** z_N table for the shaders. */
  readonly zTable = crestTable();

  /** Recomputes the open-sea sets. `texel` is the field's grid (m), 0 when the field is off. */
  update(sea: WhitecapSea, texel: number): void {
    const u10 = Number.isFinite(sea.u10) ? sea.u10 : 0;
    this.texel = texel;
    this.coverage = monahanCoverage(u10);
    this.activeFraction = this.coverage * WHITECAPS.activeShare;
    const dirs = sea.uniforms.uWaveDir.value;
    const amps = sea.uniforms.uWaveAmp.value;
    let s2sim = 0;
    let s2full = 0;
    let s4sim = 0;
    let s4full = 0;
    let e = 0;
    let eo = 0;
    for (let i = 0; i < MAX_WAVES; i++) {
      const a = amps[i];
      const d = dirs[i];
      if (!a || !d || !(a.x > 0)) {
        continue;
      }
      e += a.x * a.x;
      eo += a.x * a.x * Math.sqrt(GRAVITY * d.z);
      if (!(a.y > 0)) {
        continue;
      }
      const q = a.y * (texel > 0 ? slotFade(d.w, texel) : 1);
      s2sim += q * q;
      s4sim += q * q * q * q;
      s2full += a.y * a.y;
      s4full += a.y ** 4;
    }
    this.omegaOpen = e > 0 ? eo / e : 1;
    this.fill(this.sim, s2sim, s4sim, texel > 0 ? this.activeFraction : 0);
    this.fill(this.shader, s2full, s4full, this.coverage);
  }

  private fill(t: WhitecapSet, s2: number, s4: number, share: number): void {
    t.sigma = Math.sqrt(0.5 * s2);
    t.nEff = s4 > 0 ? (s2 * s2) / s4 : 1;
    t.threshold = crestThreshold(t.sigma, t.nEff);
    t.prob = t.sigma > 1e-5 ? share / WHITECAPS.crestShare : 0;
  }
}
