import { LandUse } from '../../../core/contracts';
import { hash2i } from '../../../core/math/noise';
import type { BuildInput } from '../types';
import { HEIGHT_GRID, LANDUSE_GRID } from './grid';
import type { NoiseFrame } from './noise-tile';
import { fillRingsValue, scanFill, stampDisc, stampPolyline } from './raster';

const RURAL = 255;
const SHORE_BELT = 254;

/** Land uses that may receive procedural buildings. */
export const BUILDABLE_USES: readonly LandUse[] = [LandUse.Urban, LandUse.HistoricUrban, LandUse.Highrise, LandUse.Industrial, LandUse.Suburban];

const LARGE_USES = new Set<number>([LandUse.Urban, LandUse.Forest]);

/**
 * Smooth random displacement field: bilinear value noise on a lattice with `spacing` meters between nodes.
 * Gradients stay well below 1 m/m so the domain warp bends zone edges without folding them into speckles.
 */
class WarpLattice {
  private readonly n: number;
  private readonly vx: Float32Array;
  private readonly vz: Float32Array;

  constructor(
    private readonly spacing: number,
    amplitude: number,
    seed: number,
  ) {
    this.n = Math.ceil(48000 / spacing) + 2;
    const count = this.n * this.n;
    this.vx = new Float32Array(count);
    this.vz = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const r = (i / this.n) | 0;
      const c = i % this.n;
      this.vx[i] = (hash2i(c, r, seed) * 2 - 1) * amplitude;
      this.vz[i] = (hash2i(c, r, seed + 1) * 2 - 1) * amplitude;
    }
  }

  /** Writes the displacement at world (x, z) into out[0], out[1]. */
  sample(x: number, z: number, out: Float32Array): void {
    const fx = (x + 24000) / this.spacing;
    const fz = (z + 24000) / this.spacing;
    const ix = Math.max(0, Math.min(this.n - 2, Math.floor(fx)));
    const iz = Math.max(0, Math.min(this.n - 2, Math.floor(fz)));
    let tx = fx - ix;
    let tz = fz - iz;
    tx = tx * tx * (3 - 2 * tx);
    tz = tz * tz * (3 - 2 * tz);
    const i = iz * this.n + ix;
    const n = this.n;
    const vx = this.vx;
    const vz = this.vz;
    const ax = vx[i] + (vx[i + 1] - vx[i]) * tx;
    const bx = vx[i + n] + (vx[i + n + 1] - vx[i + n]) * tx;
    const az = vz[i] + (vz[i + 1] - vz[i]) * tx;
    const bz = vz[i + n] + (vz[i + n + 1] - vz[i + n]) * tx;
    out[0] = ax + (bx - ax) * tz;
    out[1] = az + (bz - az) * tz;
  }
}

/**
 * Land-use grid (4096²). Water comes from the signed coast distance (so this stage can run in parallel with
 * the height composition); zones are domain-warped for organic edges, then roads and landmark pads are stamped.
 */
export function buildLandUse(input: BuildInput, coast: Float32Array, noise: { fine: NoiseFrame; medium: NoiseFrame }): Uint8Array {
  const g = LANDUSE_GRID;
  const n = g.size;
  const large = new Uint8Array(n * n).fill(RURAL);
  const small = new Uint8Array(n * n).fill(RURAL);
  for (const z of input.zones) {
    const isLarge = z.shoreStrip || LARGE_USES.has(z.use);
    fillRingsValue([z.ring], g, isLarge ? large : small, z.shoreStrip ? SHORE_BELT : z.use);
  }
  for (const c of input.circles) {
    stampDisc(c.x, c.z, c.radius * 1.45, g, (k, d) => {
      const x = g.origin + (k % n) * g.cell;
      const z = g.origin + Math.floor(k / n) * g.cell;
      // Two octaves of edge noise: lobes at the village scale plus a finer ragged fringe.
      const edge = c.radius * (0.8 + 0.42 * noise.medium.at(x * 0.9 + 713, z * 0.9 - 291) + 0.34 * noise.fine.at(x * 2.3 - 57, z * 2.3 + 881));
      if (d < edge) {
        small[k] = c.use;
      }
    });
  }
  const beachWidth = new Uint8Array(n * n);
  for (const b of input.beaches) {
    stampDisc(b.x, b.z, b.radius, g, (k) => {
      beachWidth[k] = Math.max(beachWidth[k], Math.min(255, b.width));
    });
  }

  // Per 8×8-cell block (94 m): zone-edge warps and a noise value for strips/farmland.
  const B = 8;
  const nb = n / B;
  const warpLarge = new Float32Array((nb + 1) * (nb + 1) * 2);
  const warpSmall = new Int16Array(nb * nb * 2);
  const blockNoise = new Float32Array((nb + 1) * (nb + 1));
  const broad = new WarpLattice(1800, 430, 41);
  const mid = new WarpLattice(620, 130, 43);
  const fineW = new WarpLattice(140, 26, 47);
  const tmp = new Float32Array(2);
  const nc = nb + 1;
  for (let bi = 0; bi <= nb; bi++) {
    const z = g.origin + (bi * B - 0.5) * g.cell;
    for (let bj = 0; bj <= nb; bj++) {
      const x = g.origin + (bj * B - 0.5) * g.cell;
      broad.sample(x, z, tmp);
      let wx = tmp[0];
      let wz = tmp[1];
      mid.sample(x, z, tmp);
      wx += tmp[0];
      wz += tmp[1];
      const q = (bi * nc + bj) * 2;
      warpLarge[q] = wx / g.cell;
      warpLarge[q + 1] = wz / g.cell;
    }
  }
  for (let bi = 0; bi < nb; bi++) {
    const z = g.origin + (bi * B + B / 2) * g.cell;
    for (let bj = 0; bj < nb; bj++) {
      const x = g.origin + (bj * B + B / 2) * g.cell;
      const q = (bi * nb + bj) * 2;
      fineW.sample(x, z, tmp);
      warpSmall[q] = Math.round(tmp[0] / g.cell);
      warpSmall[q + 1] = Math.round(tmp[1] / g.cell);
    }
  }
  for (let bi = 0; bi <= nb; bi++) {
    const z = g.origin + (bi * B - 0.5) * g.cell;
    for (let bj = 0; bj <= nb; bj++) {
      const x = g.origin + (bj * B - 0.5) * g.cell;
      blockNoise[bi * (nb + 1) + bj] = noise.medium.at(x * 0.32 + 3100, z * 0.32 - 1700);
    }
  }

  const out = new Uint8Array(n * n);
  const water = LandUse.Water;
  const forest = LandUse.Forest;
  const farmland = LandUse.Farmland;
  const suburban = LandUse.Suburban;
  const beachUse = LandUse.Beach;
  const industrial = LandUse.Industrial;
  const airport = LandUse.Airport;
  const nH = HEIGHT_GRID.size;
  const blend = new Float32Array(nH);
  const cRow = new Float32Array(n);
  const warpRow = new Float32Array(nc * 2);
  const noiseRow = new Float32Array(nc);
  for (let i = 0; i < n; i++) {
    // Large-zone warp: bilinear between block corners so warped edges stay smooth (no 94 m stair steps).
    const wb = (i / B) | 0;
    const wt = (i - wb * B) / B;
    for (let q = 0; q < nc * 2; q++) {
      const top = warpLarge[wb * nc * 2 + q];
      warpRow[q] = top + (warpLarge[(wb + 1) * nc * 2 + q] - top) * wt;
    }
    for (let q = 0; q < nc; q++) {
      const top = blockNoise[wb * nc + q];
      noiseRow[q] = top + (blockNoise[(wb + 1) * nc + q] - top) * wt;
    }
    // The coast grid has exactly twice the cell size: fixed 0.25/0.75 bilinear weights.
    const fz = i / 2 - 0.25;
    const ha = fz < 0 ? 0 : Math.floor(fz);
    const hb = ha + 1 < nH ? ha + 1 : nH - 1;
    const tz = fz < 0 ? 0 : fz - ha;
    const ra = ha * nH;
    const rb = hb * nH;
    for (let j = 0; j < nH; j++) {
      blend[j] = coast[ra + j] + (coast[rb + j] - coast[ra + j]) * tz;
    }
    for (let j = 0; j < n; j++) {
      const fx = j / 2 - 0.25;
      const ca = fx < 0 ? 0 : Math.floor(fx);
      const cb = ca + 1 < nH ? ca + 1 : nH - 1;
      cRow[j] = blend[ca] + (blend[cb] - blend[ca]) * (fx < 0 ? 0 : fx - ca);
    }
    const row = i * n;
    const bRow = ((i / B) | 0) * nb;
    const z = g.origin + i * g.cell;
    for (let j = 0; j < n; j++) {
      const k = row + j;
      const cd = cRow[j];
      if (cd < 0) {
        out[k] = water;
        continue;
      }
      const bk = bRow + ((j / B) | 0);
      const q = bk * 2;
      let r = i + warpSmall[q + 1];
      let c = j + warpSmall[q];
      r = r < 0 ? 0 : r >= n ? n - 1 : r;
      c = c < 0 ? 0 : c >= n ? n - 1 : c;
      let use = small[r * n + c];
      if (use === RURAL) {
        const bj = (j / B) | 0;
        const wtx = (j - bj * B) / B;
        const w0 = bj * 2;
        r = i + Math.round(warpRow[w0 + 1] + (warpRow[w0 + 3] - warpRow[w0 + 1]) * wtx);
        c = j + Math.round(warpRow[w0] + (warpRow[w0 + 2] - warpRow[w0]) * wtx);
        r = r < 0 ? 0 : r >= n ? n - 1 : r;
        c = c < 0 ? 0 : c >= n ? n - 1 : c;
        use = large[r * n + c];
        if (use === RURAL || use === SHORE_BELT) {
          const nz = noiseRow[bj] + (noiseRow[bj + 1] - noiseRow[bj]) * wtx;
          if (use === RURAL) {
            const x = g.origin + j * g.cell;
            // Farm clearings belong to the north-western plateau; their odds fade out eastward and southward
            // instead of stopping at a straight line.
            const fadeX = x < -6000 ? 0 : x > -2500 ? 1 : (x + 6000) / 3500;
            const fadeZ = z < -2000 ? 0 : z > 1500 ? 1 : (z + 2000) / 3500;
            use = nz > 0.12 + 0.6 * Math.max(fadeX, fadeZ) ? farmland : forest;
          } else {
            use = cd < 90 + 140 * (nz + 0.8) ? suburban : forest;
          }
        }
      }
      const bw = beachWidth[k];
      if (bw > 0 && use !== industrial && use !== airport && cd < bw) {
        use = beachUse;
      }
      out[k] = use;
    }
  }

  for (const b of input.breakwaters) {
    stampPolyline(b.pts, b.halfWidth, g, (k) => {
      if (out[k] !== water) {
        out[k] = LandUse.Road;
      }
    });
  }
  for (const road of input.roads) {
    if (road.overWater) {
      continue;
    }
    stampPolyline(road.pts, road.halfWidth, g, (k) => {
      if (out[k] !== water) {
        out[k] = LandUse.Road;
      }
    });
  }
  markVerges(input, out);
  markReserved(input, out);
  return out;
}

/** Green verge (m) beyond a highway's corridor, and the reach (m) within which two highways enclose a junction pocket. */
const VERGE = 28;
const POCKET = 140;
/** Built-up uses a verge or a junction pocket replaces (industrial, historic, forest ... stay as they are). */
const VERGE_REPLACES = new Set<number>([LandUse.Urban, LandUse.Suburban]);

/**
 * Motorway verges and junction pockets: built-up land within VERGE m of a highway corridor, and every built-up cell
 * within POCKET m of two different highways (the land between the carriageways and ramps of an interchange), become
 * park land: grass with scattered trees (vegetation plants park stands there, the procedural city builds nothing).
 */
function markVerges(input: BuildInput, out: Uint8Array): void {
  const g = LANDUSE_GRID;
  const highways = input.roads.filter((r) => r.highway && !r.overWater);
  if (highways.length === 0) {
    return;
  }
  // Per cell: the first highway whose pocket reach covers it, and whether a second, different one does too (sections of
  // one highway share its name, so their joints are no pockets).
  const names = [...new Set(highways.map((r) => r.highway))];
  const first = new Int16Array(g.size * g.size).fill(-1);
  const pocket = new Uint8Array(g.size * g.size);
  highways.forEach((r) => {
    const id = names.indexOf(r.highway);
    stampPolyline(r.pts, r.halfWidth + POCKET, g, (k) => {
      if (first[k] < 0) {
        first[k] = id;
      } else if (first[k] !== id) {
        pocket[k] = 1;
      }
    });
  });
  const green = (k: number): void => {
    if (VERGE_REPLACES.has(out[k])) {
      out[k] = LandUse.Park;
    }
  };
  for (const r of highways) {
    stampPolyline(r.pts, r.halfWidth + VERGE, g, green);
  }
  for (let k = 0; k < pocket.length; k++) {
    if (pocket[k]) {
      green(k);
    }
  }
}

function markReserved(input: BuildInput, out: Uint8Array): void {
  const g = LANDUSE_GRID;
  const setLandmark = (k: number): void => {
    if (out[k] !== LandUse.Water) {
      out[k] = LandUse.Landmark;
    }
  };
  // One polygon at a time: scanFill is even-odd over its rings, and reserved polygons overlap (the bridges' deck
  // pieces with their verges), so a joint fill would cut holes where two overlap.
  for (const ring of input.reservedPolygons) {
    scanFill([ring], g, (row, c0, c1) => {
      for (let k = row * g.size + c0; k <= row * g.size + c1; k++) {
        setLandmark(k);
      }
    });
  }
  for (const line of input.reservedLines) {
    stampPolyline(line.pts, line.halfWidth, g, setLandmark);
  }
  for (const d of input.reservedDiscs) {
    stampDisc(d.x, d.z, d.radius, g, setLandmark);
  }
}

/** Reserves mosque pads in the land-use grid. */
export function reserveDiscs(out: Uint8Array, discs: { x: number; z: number; radius: number }[]): void {
  for (const d of discs) {
    stampDisc(d.x, d.z, d.radius, LANDUSE_GRID, (k) => {
      if (out[k] !== LandUse.Water) {
        out[k] = LandUse.Landmark;
      }
    });
  }
}
