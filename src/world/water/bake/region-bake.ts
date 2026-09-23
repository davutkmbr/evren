/**
 * Water regions + surface current field (CPU, runs in the water worker).
 *
 * Regions (weights, smooth): Black Sea / Bosphorus / Marmara / Golden Horn from hand-placed geographic limits,
 * lakes = water not connected to the open sea (flood fill from the world border).
 *
 * Current: depth-integrated potential flow through the strait, div(h grad(phi)) = 0 with phi = 1 in the Black Sea
 * and phi = 0 in the Marmara 9+ km beyond the exit, no flux through the shores. The depth-averaged velocity
 * u = -K grad(phi) automatically speeds up in narrow/shallow sections (Rumelihisari, Akintiburnu) and fans out into
 * the Marmara; the Golden Horn (a dead end) and lakes stay still. K is calibrated so the Bosphorus 90th percentile
 * surface speed is ~1.9 m/s (observed 1-2 m/s, up to ~3 m/s at the narrows).
 */
import { latLonToLocal, localToLatLon, WORLD_HALF_SIZE } from '../../../core/geo-coords';
import { CURRENT_MAX, CURRENT_P90 } from '../config';
import { bakeFetchExposure } from './fetch';
import { toHalf } from './half';

export interface RegionBakeInput {
  size: number;
  /** Terrain height at cell centres (m, negative = sea floor). */
  height: Float32Array;
  /** Signed coast distance at cell centres (m, negative over water). */
  coast: Float32Array;
}

export interface RegionBakeResult {
  size: number;
  /** RGBA half floats: current x, current z (m/s), fetch exposure 0..1 in a poyraz, in a lodos (see fetch.ts). */
  flow: Uint16Array;
  /** RGBA8 region weights: Black Sea, Bosphorus, Marmara, Golden Horn; all zero on lakes (lake = 1 - sum). */
  region: Uint8Array;
  stats: { unknowns: number; iterations: number; residual: number; p90: number; maxSpeed: number; fetchMs: number; ms: number };
}

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

/** Golden Horn mouth line: Sarayburnu tip -> Tophane/Karaköy (GH lies to the west, the Bosphorus to the east). */
const HORN_A = latLonToLocal(41.0165, 28.985);
const HORN_B = latLonToLocal(41.0245, 28.9795);
const HORN_INSIDE = latLonToLocal(41.035, 28.952);
const BOSPHORUS_EXIT = latLonToLocal(41.006, 29.0);
const BLACK_SEA_LAT = 41.222;
const MARMARA_SINK_RADIUS = 9000;

function hornSide(x: number, z: number): number {
  const ex = HORN_B.x - HORN_A.x;
  const ez = HORN_B.z - HORN_A.z;
  const len = Math.hypot(ex, ez);
  return (ex * (z - HORN_A.z) - ez * (x - HORN_A.x)) / len;
}
const HORN_SIGN = Math.sign(hornSide(HORN_INSIDE.x, HORN_INSIDE.z)) || 1;

export function bakeRegions(input: RegionBakeInput): RegionBakeResult {
  const t0 = performance.now();
  const n = input.size;
  const cell = (WORLD_HALF_SIZE * 2) / n;
  const total = n * n;
  const { height, coast } = input;

  const water = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    water[i] = height[i] < -0.3 || coast[i] < -cell * 0.35 ? 1 : 0;
  }

  // Sea = water connected to the world border.
  const sea = new Uint8Array(total);
  const queue = new Int32Array(total);
  let qh = 0;
  let qt = 0;
  const pushIf = (i: number): void => {
    if (water[i] && !sea[i]) {
      sea[i] = 1;
      queue[qt++] = i;
    }
  };
  for (let k = 0; k < n; k++) {
    pushIf(k);
    pushIf((n - 1) * n + k);
    pushIf(k * n);
    pushIf(k * n + n - 1);
  }
  while (qh < qt) {
    const i = queue[qh++];
    const x = i % n;
    const y = (i / n) | 0;
    if (x > 0) pushIf(i - 1);
    if (x < n - 1) pushIf(i + 1);
    if (y > 0) pushIf(i - n);
    if (y < n - 1) pushIf(i + n);
  }

  const region = new Uint8Array(total * 4);
  const lat = new Float32Array(total);
  const bosW = new Float32Array(total);
  const px = new Float32Array(n);
  const pz = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    px[k] = -WORLD_HALF_SIZE + (k + 0.5) * cell;
    pz[k] = px[k];
  }
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const ll = localToLatLon(px[x], pz[y]);
      lat[i] = ll.lat;
      const gh = smooth(-140, 140, hornSide(px[x], pz[y]) * HORN_SIGN) * smooth(41.0135, 41.0175, ll.lat) * (1 - smooth(41.075, 41.085, ll.lat));
      const bs = smooth(41.19, 41.228, ll.lat);
      const mar = smooth(41.0125, 40.9985, ll.lat) * (1 - gh);
      const bos = Math.max(0, 1 - bs - mar - gh);
      const sum = bs + mar + gh + bos;
      bosW[i] = bos / sum;
      const o = i * 4;
      region[o] = Math.round((bs / sum) * 255);
      region[o + 1] = Math.round((bos / sum) * 255);
      region[o + 2] = Math.round((mar / sum) * 255);
      region[o + 3] = Math.round((gh / sum) * 255);
    }
  }

  // ---- potential flow ----
  const phi = new Float64Array(total);
  const fixed = new Uint8Array(total);
  const cond = new Float64Array(total);
  const unknowns: number[] = [];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      if (!sea[i]) {
        continue;
      }
      cond[i] = Math.min(Math.max(-height[i], 2), 25);
      const la = lat[i];
      if (la > BLACK_SEA_LAT) {
        fixed[i] = 1;
        phi[i] = 1;
      } else if (la < 41.004 && Math.hypot(px[x] - BOSPHORUS_EXIT.x, pz[y] - BOSPHORUS_EXIT.z) > MARMARA_SINK_RADIUS) {
        fixed[i] = 1;
        phi[i] = 0;
      } else {
        phi[i] = smooth(40.995, BLACK_SEA_LAT, la);
        unknowns.push(i);
      }
    }
  }
  // Face conductances (harmonic mean of depths) per unknown: E, W, S, N.
  const m = unknowns.length;
  const nb = new Int32Array(m * 4);
  const cw = new Float64Array(m * 4);
  const csum = new Float64Array(m);
  for (let u = 0; u < m; u++) {
    const i = unknowns[u];
    const x = i % n;
    const y = (i / n) | 0;
    const cand = [x < n - 1 ? i + 1 : -1, x > 0 ? i - 1 : -1, y < n - 1 ? i + n : -1, y > 0 ? i - n : -1];
    let s = 0;
    for (let d = 0; d < 4; d++) {
      const j = cand[d];
      if (j >= 0 && sea[j]) {
        const c = (2 * cond[i] * cond[j]) / (cond[i] + cond[j]);
        nb[u * 4 + d] = j;
        cw[u * 4 + d] = c;
        s += c;
      } else {
        nb[u * 4 + d] = -1;
      }
    }
    csum[u] = s;
  }
  const omega = 1.93;
  let iterations = 0;
  let residual = 0;
  for (; iterations < 6000; iterations++) {
    residual = 0;
    for (let u = 0; u < m; u++) {
      const s = csum[u];
      if (s <= 0) {
        continue;
      }
      let acc = 0;
      const o = u * 4;
      for (let d = 0; d < 4; d++) {
        const j = nb[o + d];
        if (j >= 0) {
          acc += cw[o + d] * phi[j];
        }
      }
      const i = unknowns[u];
      const next = acc / s;
      const delta = next - phi[i];
      phi[i] += omega * delta;
      const ad = Math.abs(delta);
      if (ad > residual) {
        residual = ad;
      }
    }
    if (residual < 2e-8) {
      break;
    }
  }

  // Velocity = -grad(phi) (per metre), one-sided at the shores.
  const vx = new Float32Array(total);
  const vz = new Float32Array(total);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      if (!sea[i]) {
        continue;
      }
      const e = x < n - 1 && sea[i + 1] ? i + 1 : i;
      const w = x > 0 && sea[i - 1] ? i - 1 : i;
      const s = y < n - 1 && sea[i + n] ? i + n : i;
      const nn = y > 0 && sea[i - n] ? i - n : i;
      const dxCells = (e !== i ? 1 : 0) + (w !== i ? 1 : 0);
      const dzCells = (s !== i ? 1 : 0) + (nn !== i ? 1 : 0);
      vx[i] = dxCells > 0 ? -(phi[e] - phi[w]) / (dxCells * cell) : 0;
      vz[i] = dzCells > 0 ? -(phi[s] - phi[nn]) / (dzCells * cell) : 0;
    }
  }
  // Two passes of a water-only 3x3 blur.
  const tmpX = new Float32Array(total);
  const tmpZ = new Float32Array(total);
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const i = y * n + x;
        if (!sea[i]) {
          tmpX[i] = 0;
          tmpZ[i] = 0;
          continue;
        }
        let sx = 0;
        let sz = 0;
        let wsum = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= n) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= n) continue;
            const j = yy * n + xx;
            if (!sea[j]) continue;
            const wgt = dx === 0 && dy === 0 ? 2 : 1;
            sx += vx[j] * wgt;
            sz += vz[j] * wgt;
            wsum += wgt;
          }
        }
        tmpX[i] = sx / wsum;
        tmpZ[i] = sz / wsum;
      }
    }
    vx.set(tmpX);
    vz.set(tmpZ);
  }

  const speeds: number[] = [];
  for (let i = 0; i < total; i++) {
    if (sea[i] && bosW[i] > 0.6 && lat[i] > 41.02 && lat[i] < 41.2) {
      speeds.push(Math.hypot(vx[i], vz[i]));
    }
  }
  speeds.sort((a, b) => a - b);
  const p90 = speeds.length ? speeds[Math.floor(speeds.length * 0.9)] : 1;
  const k = p90 > 0 ? CURRENT_P90 / p90 : 0;

  const tFetch = performance.now();
  const [fetchPoyraz, fetchLodos] = bakeFetchExposure(sea, n, WORLD_HALF_SIZE * 2);
  const fetchMs = Math.round(performance.now() - tFetch);
  const flow = new Uint16Array(total * 4);
  let maxSpeed = 0;
  for (let i = 0; i < total; i++) {
    // The outflow jet dies out before the Dirichlet ring of the Marmara sink.
    const cx = i % n;
    const cy = (i / n) | 0;
    const exitDist = Math.hypot(px[cx] - BOSPHORUS_EXIT.x, pz[cy] - BOSPHORUS_EXIT.z);
    const jetFade = lat[i] < 41.004 ? 1 - smooth(MARMARA_SINK_RADIUS * 0.45, MARMARA_SINK_RADIUS * 0.95, exitDist) : 1;
    let ux = vx[i] * k * jetFade;
    let uz = vz[i] * k * jetFade;
    const sp = Math.hypot(ux, uz);
    if (sp > CURRENT_MAX) {
      ux *= CURRENT_MAX / sp;
      uz *= CURRENT_MAX / sp;
    }
    maxSpeed = Math.max(maxSpeed, Math.min(sp, CURRENT_MAX));
    const o = i * 4;
    flow[o] = toHalf(ux);
    flow[o + 1] = toHalf(uz);
    flow[o + 2] = toHalf(fetchPoyraz[i]);
    flow[o + 3] = toHalf(fetchLodos[i]);
  }
  // Lakes (and one cell of their banks, so bilinear sampling stays lake-coloured at the shore) have no sea region.
  const isLake = (i: number): boolean => water[i] === 1 && sea[i] === 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const lakeHere = isLake(i);
      const bank =
        !water[i] && ((x > 0 && isLake(i - 1)) || (x < n - 1 && isLake(i + 1)) || (y > 0 && isLake(i - n)) || (y < n - 1 && isLake(i + n)));
      if (lakeHere || bank) {
        region.fill(0, i * 4, i * 4 + 4);
      }
    }
  }

  return {
    size: n,
    flow,
    region,
    stats: { unknowns: m, iterations, residual, p90: CURRENT_P90, maxSpeed, fetchMs, ms: Math.round(performance.now() - t0) },
  };
}
