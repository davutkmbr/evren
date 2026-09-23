import { LandUse } from '../../../core/contracts';
import { hash2i } from '../../../core/math/noise';
import type { BuildInput, MosqueSite } from '../types';
import { DENSITY_GRID, DISTRICT_GRID, HEIGHT_GRID, LANDUSE_GRID, NO_DISTRICT, sampleBilinear } from './grid';
import type { NoiseFrame } from './noise-tile';
import { fillRingsValue } from './raster';

/** Weighted-Voronoi district index (512²). Land cells only pick districts on their own shore. */
export function buildDistrictGrid(input: BuildInput): Uint8Array {
  const g = DISTRICT_GRID;
  const n = g.size;
  const side = new Uint8Array(n * n).fill(255);
  input.landRings.forEach((ring, i) => fillRingsValue([ring], g, side, input.landRingSides[i]));
  const out = new Uint8Array(n * n);
  const ds = input.districts;
  const invReach2 = ds.map((d) => 1 / (d.reach * d.reach * 1e6));
  for (let r = 0; r < n; r++) {
    const z = g.origin + r * g.cell;
    for (let c = 0; c < n; c++) {
      const x = g.origin + c * g.cell;
      const s = side[r * n + c];
      let best = NO_DISTRICT;
      let bestScore = Infinity;
      for (let i = 0; i < ds.length; i++) {
        const d = ds[i];
        if (s !== 255 && d.side !== s) {
          continue;
        }
        const dx = x - d.x;
        const dz = z - d.z;
        const score = (dx * dx + dz * dz) * invReach2[i];
        if (score < bestScore) {
          bestScore = score;
          best = i;
        }
      }
      out[r * n + c] = best;
    }
  }
  return out;
}

const USE_WEIGHT = new Float32Array(16);
USE_WEIGHT[LandUse.Urban] = 1;
USE_WEIGHT[LandUse.HistoricUrban] = 1;
USE_WEIGHT[LandUse.Highrise] = 1;
USE_WEIGHT[LandUse.Industrial] = 0.75;
USE_WEIGHT[LandUse.Suburban] = 0.5;
USE_WEIGHT[LandUse.Farmland] = 0.05;

/** Building density 0..255 (1024²): land-use mix of each 4×4 block × district density × gentle noise. */
export function buildDensityGrid(input: BuildInput, landUse: Uint8Array, district: Uint8Array, noise: NoiseFrame): Uint8Array {
  const g = DENSITY_GRID;
  const n = g.size;
  const nL = LANDUSE_GRID.size;
  const nD = DISTRICT_GRID.size;
  const out = new Uint8Array(n * n);
  const f = nL / n;
  const fd = n / nD;
  for (let r = 0; r < n; r++) {
    const z = g.origin + r * g.cell;
    for (let c = 0; c < n; c++) {
      let sum = 0;
      for (let a = 0; a < f; a++) {
        const row = (r * f + a) * nL + c * f;
        for (let b = 0; b < f; b++) {
          sum += USE_WEIGHT[landUse[row + b]];
        }
      }
      if (sum === 0) {
        continue;
      }
      const di = district[Math.floor(r / fd) * nD + Math.floor(c / fd)];
      const dd = di === NO_DISTRICT ? 0.5 : input.districts[di].density;
      const x = g.origin + c * g.cell;
      const v = (sum / (f * f)) * dd * (0.9 + 0.22 * noise.at(x, z));
      out[r * n + c] = Math.max(0, Math.min(255, Math.round(v * 255)));
    }
  }
  return out;
}

/** Great-circle initial bearing (deg) from a point toward the Kaaba. */
export function qiblaBearing(latDeg: number, lonDeg: number): number {
  const d2r = Math.PI / 180;
  const la1 = latDeg * d2r;
  const la2 = 21.4225 * d2r;
  const dl = (39.8262 - lonDeg) * d2r;
  const y = Math.sin(dl) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dl);
  return ((Math.atan2(y, x) / d2r) + 360) % 360;
}

const SITE_USES = new Set<number>([LandUse.Urban, LandUse.HistoricUrban, LandUse.Suburban, LandUse.Highrise]);
const PAD_OK = new Set<number>([LandUse.Urban, LandUse.HistoricUrban, LandUse.Suburban, LandUse.Highrise, LandUse.Industrial]);

function useAt(landUse: Uint8Array, x: number, z: number): number {
  const g = LANDUSE_GRID;
  const c = Math.round((x - g.origin) / g.cell);
  const r = Math.round((z - g.origin) / g.cell);
  if (c < 0 || r < 0 || c >= g.size || r >= g.size) {
    return LandUse.Water;
  }
  return landUse[r * g.size + c];
}

/**
 * Deterministic neighborhood mosque sites: jittered candidates on buildable urban land, scored by local
 * prominence (hilltops) and density, then greedily thinned with a density-dependent minimum spacing.
 */
export function selectMosqueSites(input: BuildInput, height: Float32Array, landUse: Uint8Array, density: Uint8Array, qibla: number): MosqueSite[] {
  const step = 200;
  const half = 24000;
  const cands: { x: number; z: number; score: number; dens: number; size: number; historic: boolean }[] = [];
  let gi = 0;
  for (let gz = -half + step / 2; gz < half; gz += step) {
    let gj = 0;
    for (let gx = -half + step / 2; gx < half; gx += step) {
      gj++;
      const x = gx + (hash2i(gi, gj, 11) - 0.5) * step * 0.7;
      const z = gz + (hash2i(gi, gj, 12) - 0.5) * step * 0.7;
      const use = useAt(landUse, x, z);
      if (!SITE_USES.has(use)) {
        continue;
      }
      const dens = sampleBilinear8(density, x, z);
      if (dens < 0.18) {
        continue;
      }
      const h = sampleBilinear(height, HEIGHT_GRID, x, z);
      if (h < 2) {
        continue;
      }
      let ring = 0;
      for (let a = 0; a < 6; a++) {
        const ang = (a / 6) * Math.PI * 2;
        ring += sampleBilinear(height, HEIGHT_GRID, x + Math.cos(ang) * 280, z + Math.sin(ang) * 280);
      }
      const prominence = h - ring / 6;
      const promScore = Math.max(-0.5, Math.min(0.9, prominence / 22));
      const size = Math.min(1, Math.pow(hash2i(gi, gj, 13), 2.4) + Math.max(0, promScore) * 0.35);
      const radius = 12 + 23 * size;
      let ok = true;
      for (let a = 0; a < 8 && ok; a++) {
        const ang = (a / 8) * Math.PI * 2;
        const u = useAt(landUse, x + Math.cos(ang) * (radius + 8), z + Math.sin(ang) * (radius + 8));
        ok = PAD_OK.has(u);
      }
      if (!ok) {
        continue;
      }
      let nearLandmark = false;
      for (const m of input.landmarkMosques) {
        const clear = m.radius + 260;
        if ((m.x - x) ** 2 + (m.z - z) ** 2 < clear * clear) {
          nearLandmark = true;
          break;
        }
      }
      for (let i = 0; i < input.reservedDiscs.length && !nearLandmark; i++) {
        const d = input.reservedDiscs[i];
        const clear = d.radius + radius + 40;
        nearLandmark = (d.x - x) ** 2 + (d.z - z) ** 2 < clear * clear;
      }
      if (nearLandmark) {
        continue;
      }
      const historic = use === LandUse.HistoricUrban;
      const score = dens + promScore + (historic ? 0.35 : 0) + hash2i(gi, gj, 14) * 0.7;
      cands.push({ x, z, score, dens, size, historic });
    }
    gi++;
  }
  cands.sort((a, b) => b.score - a.score);

  const cell = 700;
  const nb = Math.ceil((half * 2) / cell);
  const buckets = new Map<number, { x: number; z: number }[]>();
  const out: MosqueSite[] = [];
  for (const c of cands) {
    if (out.length >= input.mosqueTarget) {
      break;
    }
    // Historic quarters are packed with mahalle mosques (one every few hundred metres); modern sprawl far less so.
    const minDist = c.historic ? 380 + 250 * (1 - Math.min(1, c.dens)) : 1450 - 800 * Math.min(1, c.dens);
    const bx = Math.floor((c.x + half) / cell);
    const bz = Math.floor((c.z + half) / cell);
    const reach = Math.ceil(minDist / cell);
    let clear = true;
    for (let oz = -reach; oz <= reach && clear; oz++) {
      for (let ox = -reach; ox <= reach && clear; ox++) {
        const list = buckets.get((bz + oz) * nb + bx + ox);
        if (!list) {
          continue;
        }
        for (const p of list) {
          if ((p.x - c.x) ** 2 + (p.z - c.z) ** 2 < minDist * minDist) {
            clear = false;
            break;
          }
        }
      }
    }
    if (!clear) {
      continue;
    }
    const key = bz * nb + bx;
    const list = buckets.get(key) ?? [];
    list.push({ x: c.x, z: c.z });
    buckets.set(key, list);
    const jitter = (hash2i(Math.round(c.x), Math.round(c.z), 15) - 0.5) * 14;
    out.push({ x: c.x, z: c.z, y: 0, radius: 12 + 23 * c.size, size: c.size, headingDeg: (qibla + jitter + 360) % 360 });
  }
  return out;
}

function sampleBilinear8(data: Uint8Array, x: number, z: number): number {
  const g = DENSITY_GRID;
  const c = Math.round((x - g.origin) / g.cell);
  const r = Math.round((z - g.origin) / g.cell);
  if (c < 0 || r < 0 || c >= g.size || r >= g.size) {
    return 0;
  }
  return data[r * g.size + c] / 255;
}
