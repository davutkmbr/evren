/**
 * Deterministic tree placement for one streaming tile (runs in the placement worker).
 * Every candidate is derived from global lattice indices, so a tree always lands in exactly one tile and tiles can be
 * generated in any order. Land use decides the planting class (forest, park, cemetery, garden, street, mosque yard...),
 * low-frequency noise fields form species stands, glades and age classes.
 */
import { LandUse } from '../../../core/contracts';
import { hash2i } from '../../../core/math/noise';
import { latLonToLocal } from '../../../core/geo-coords';
import { INSTANCE_STRIDE, Species } from '../species';
import type { GridWindow, MosqueRingSite, PlacementInitMessage, RoadLine, TileRequestMessage, TileResultMessage } from './protocol';

interface Tree {
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
  code: number;
  rank: number;
  width: number;
}

/* ------------------------------------------------------------------ */
/* Noise                                                               */
/* ------------------------------------------------------------------ */

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Value noise in [0, 1] with unit lattice spacing. */
function vnoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = smooth(x - ix);
  const fz = smooth(z - iz);
  const a = hash2i(ix, iz, seed);
  const b = hash2i(ix + 1, iz, seed);
  const c = hash2i(ix, iz + 1, seed);
  const d = hash2i(ix + 1, iz + 1, seed);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

/** Two octave value noise with `period` metres between lattice nodes, in [0, 1]. */
function field(x: number, z: number, period: number, seed: number): number {
  return (vnoise(x / period, z / period, seed) * 2 + vnoise((x * 2.13) / period + 7.1, (z * 2.13) / period - 3.7, seed + 1)) / 3;
}

/* ------------------------------------------------------------------ */
/* Geo windows                                                         */
/* ------------------------------------------------------------------ */

class GeoWindows {
  constructor(private readonly req: TileRequestMessage) {}

  landUse(x: number, z: number): number {
    const g = this.req.landUse;
    const c = clampI(Math.round((x - g.x0) / g.cell), 0, g.w - 1);
    const r = clampI(Math.round((z - g.z0) / g.cell), 0, g.h - 1);
    return g.data[r * g.w + c];
  }

  height(x: number, z: number): number {
    return bilinear(this.req.height, x, z);
  }

  coast(x: number, z: number): number {
    return bilinear(this.req.coast, x, z);
  }

  density(x: number, z: number): number {
    return bilinear(this.req.density, x, z);
  }

  /** Terrain slope (rise over run) from central differences. */
  slope(x: number, z: number): number {
    const e = 6;
    const dx = this.height(x + e, z) - this.height(x - e, z);
    const dz = this.height(x, z + e) - this.height(x, z - e);
    return Math.hypot(dx, dz) / (2 * e);
  }
}

function clampI(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function bilinear(g: GridWindow<Float32Array>, x: number, z: number): number {
  let fx = (x - g.x0) / g.cell;
  let fz = (z - g.z0) / g.cell;
  fx = fx < 0 ? 0 : fx > g.w - 1.0001 ? g.w - 1.0001 : fx;
  fz = fz < 0 ? 0 : fz > g.h - 1.0001 ? g.h - 1.0001 : fz;
  const ix = fx | 0;
  const iz = fz | 0;
  const tx = fx - ix;
  const tz = fz - iz;
  const i = iz * g.w + ix;
  const d = g.data;
  const top = d[i] + (d[i + 1] - d[i]) * tx;
  const bottom = d[i + g.w] + (d[i + g.w + 1] - d[i + g.w]) * tx;
  return top + (bottom - top) * tz;
}

/* ------------------------------------------------------------------ */
/* Regions                                                             */
/* ------------------------------------------------------------------ */

function box(lat0: number, lon0: number, lat1: number, lon1: number): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const a = latLonToLocal(lat0, lon0);
  const b = latLonToLocal(lat1, lon1);
  return { minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z) };
}

/** Soft membership (0..1) of a point in a box with a feather band (m). */
function inBox(b: { minX: number; maxX: number; minZ: number; maxZ: number }, x: number, z: number, feather: number): number {
  const dx = Math.max(b.minX - x, x - b.maxX, 0);
  const dz = Math.max(b.minZ - z, z - b.maxZ, 0);
  return 1 - Math.min(Math.hypot(dx, dz) / feather, 1);
}

/** Princes' Islands (Pinus brutia + stone pine forests). */
const ISLANDS = box(40.845, 29.035, 40.925, 29.14);
/** Kadıköy – Moda – Fenerbahçe seafront (Canary palms). */
const PALM_COAST = box(40.962, 29.017, 41.0, 29.048);
/** Bosphorus corridor (groves on both shores). */
const BOSPHORUS = box(41.035, 29.0, 41.2, 29.12);

interface SpeciesWeights {
  stonePine: number;
  pine: number;
  cypress: number;
  plane: number;
  broadleaf: number;
  palm: number;
}

const tmpWeights: SpeciesWeights = { stonePine: 0, pine: 0, cypress: 0, plane: 0, broadleaf: 0, palm: 0 };

function setWeights(w: SpeciesWeights, sp: number, pi: number, cy: number, pl: number, br: number, pa: number): SpeciesWeights {
  w.stonePine = sp;
  w.pine = pi;
  w.cypress = cy;
  w.plane = pl;
  w.broadleaf = br;
  w.palm = pa;
  return w;
}

/** Picks species (+ variant) from weights, modulated by per-species stand fields so neighbours cluster. */
function pickSpecies(w: SpeciesWeights, x: number, z: number, u: number, redPine: number): number {
  const standScale = 240;
  const sp = w.stonePine * (0.35 + 1.3 * field(x, z, standScale, 101));
  const pi = w.pine * (0.35 + 1.3 * field(x, z, standScale, 103));
  const cy = w.cypress * (0.35 + 1.3 * field(x, z, standScale * 0.6, 107));
  const pl = w.plane * (0.35 + 1.3 * field(x, z, standScale, 109));
  const br = w.broadleaf * (0.35 + 1.3 * field(x, z, standScale, 113));
  const pa = w.palm;
  const total = sp + pi + cy + pl + br + pa;
  if (total <= 0) {
    return -1;
  }
  let t = u * total;
  if ((t -= sp) < 0) {
    return Species.StonePine;
  }
  if ((t -= pi) < 0) {
    return Species.Pine + 8 * (field(x, z, 400, 131) < redPine ? 1 : 0);
  }
  if ((t -= cy) < 0) {
    return Species.Cypress;
  }
  if ((t -= pl) < 0) {
    return Species.Plane;
  }
  if ((t -= br) < 0) {
    return Species.Broadleaf + 8 * (field(x, z, 180, 137) < 0.34 ? 1 : 0);
  }
  return Species.Palm;
}

/* ------------------------------------------------------------------ */
/* Planting classes                                                    */
/* ------------------------------------------------------------------ */

const Planting = {
  None: 0,
  Forest: 1,
  Park: 2,
  Cemetery: 3,
  Garden: 4,
  Yard: 5,
  Field: 6,
} as const;
type Planting = (typeof Planting)[keyof typeof Planting];

/** Lattice spacing (m) of each planting class (index = Planting). */
const SPACING = [0, 7.2, 8.5, 5.2, 12.5, 18, 27];
const SEED = [0, 11, 23, 37, 41, 53, 67];

function plantingOf(use: number, density: number): Planting {
  switch (use) {
    case LandUse.Forest:
      return Planting.Forest;
    case LandUse.Park:
      return Planting.Park;
    case LandUse.Cemetery:
      return Planting.Cemetery;
    case LandUse.Suburban:
      return Planting.Garden;
    case LandUse.Urban:
      return density < 0.42 ? Planting.Yard : Planting.None;
    case LandUse.Farmland:
      return Planting.Field;
    default:
      return Planting.None;
  }
}

/** Per species acceptance: broad crowns are planted further apart than the class lattice. */
const SPECIES_ACCEPT = [0.5, 0.95, 1, 0.42, 1, 1];
/** Per species (forest) scale range. */
const SCALE_RANGE: [number, number][] = [
  [0.72, 1.12],
  [0.78, 1.2],
  [0.78, 1.15],
  [0.7, 1.15],
  [0.8, 1.22],
  [0.85, 1.12],
];

export class PlacementContext {
  private readonly mosques: MosqueRingSite[];
  private readonly roads: RoadLine[];
  /** Cumulative polyline lengths per road. */
  private readonly roadArc: Float32Array[];
  private readonly height: number[];
  private readonly roadCells = new Map<number, number[]>();
  private static readonly ROAD_CELL = 512;

  constructor(init: PlacementInitMessage) {
    this.mosques = init.mosques;
    this.roads = init.roads;
    this.height = init.height;
    this.roadArc = init.roads.map((r) => {
      const n = r.pts.length / 2;
      const arc = new Float32Array(n);
      for (let i = 1; i < n; i++) {
        arc[i] = arc[i - 1] + Math.hypot(r.pts[i * 2] - r.pts[i * 2 - 2], r.pts[i * 2 + 1] - r.pts[i * 2 - 1]);
      }
      return arc;
    });
    const C = PlacementContext.ROAD_CELL;
    this.roads.forEach((r, ri) => {
      for (let i = 0; i + 1 < r.pts.length / 2; i++) {
        const ax = r.pts[i * 2];
        const az = r.pts[i * 2 + 1];
        const bx = r.pts[i * 2 + 2];
        const bz = r.pts[i * 2 + 3];
        const c0 = Math.floor((Math.min(ax, bx) - 20) / C);
        const c1 = Math.floor((Math.max(ax, bx) + 20) / C);
        const r0 = Math.floor((Math.min(az, bz) - 20) / C);
        const r1 = Math.floor((Math.max(az, bz) + 20) / C);
        for (let cz = r0; cz <= r1; cz++) {
          for (let cx = c0; cx <= c1; cx++) {
            const key = (cz + 1000) * 2000 + (cx + 1000);
            let list = this.roadCells.get(key);
            if (!list) {
              list = [];
              this.roadCells.set(key, list);
            }
            list.push(ri * 65536 + i);
          }
        }
      }
    });
  }

  placeTile(req: TileRequestMessage): TileResultMessage {
    const t0 = performance.now();
    const geo = new GeoWindows(req);
    const out: Tree[] = [];
    const x1 = req.x0 + req.size;
    const z1 = req.z0 + req.size;
    const ds = Math.max(0.05, req.densityScale);
    const scaleBoost = Math.min(Math.pow(1 / ds, 0.2), 1.25);

    for (let c = Planting.Forest as number; c <= Planting.Field; c++) {
      const cls = c as Planting;
      const S = SPACING[cls];
      const seed = SEED[cls];
      const i0 = Math.floor(req.x0 / S);
      const i1 = Math.floor(x1 / S);
      const j0 = Math.floor(req.z0 / S);
      const j1 = Math.floor(z1 / S);
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const jx = hash2i(i, j, seed);
          const jz = hash2i(i, j, seed + 1);
          const x = (i + 0.5 + (jx - 0.5) * 0.86) * S;
          const z = (j + 0.5 + (jz - 0.5) * 0.86) * S;
          if (x < req.x0 || x >= x1 || z < req.z0 || z >= z1) {
            continue;
          }
          const use = geo.landUse(x, z);
          if (plantingOf(use, use === LandUse.Urban ? geo.density(x, z) : 0) !== cls) {
            continue;
          }
          const u = hash2i(i, j, seed + 2);
          const p = this.plantProbability(cls, x, z, geo) * (cls === Planting.Forest ? Math.min(1, ds * 1.15) : ds);
          if (u >= p) {
            continue;
          }
          const code = pickSpecies(this.weightsFor(cls, x, z, geo), x, z, hash2i(i, j, seed + 3), this.redPineShare(x, z));
          if (code < 0) {
            continue;
          }
          const sp = code % 8;
          if (hash2i(i, j, seed + 4) >= SPECIES_ACCEPT[sp] * (cls === Planting.Cemetery && sp !== Species.Cypress ? 0.5 : 1)) {
            continue;
          }
          const tree = this.makeTree(x, z, code, cls, geo, hash2i(i, j, seed + 5), hash2i(i, j, seed + 6), hash2i(i, j, seed + 7));
          if (tree) {
            tree.scale *= scaleBoost;
            out.push(tree);
          }
        }
      }
    }
    this.streetTrees(req, geo, out);
    this.mosqueTrees(req, geo, out);
    this.coastalPalms(req, geo, out);

    out.sort((a, b) => a.rank - b.rank);
    const instances = new Float32Array(out.length * INSTANCE_STRIDE);
    let minY = Infinity;
    let maxY = -Infinity;
    for (let k = 0; k < out.length; k++) {
      const t = out[k];
      const o = k * INSTANCE_STRIDE;
      instances[o] = t.x;
      instances[o + 1] = t.y;
      instances[o + 2] = t.z;
      instances[o + 3] = t.yaw;
      instances[o + 4] = t.scale;
      instances[o + 5] = t.code;
      instances[o + 6] = t.rank;
      instances[o + 7] = t.width;
      minY = Math.min(minY, t.y);
      maxY = Math.max(maxY, t.y + this.height[t.code % 8] * t.scale);
    }
    return { type: 'tile', id: req.id, instances, count: out.length, minY: out.length ? minY : 0, maxY: out.length ? maxY : 0, ms: performance.now() - t0 };
  }

  private redPineShare(x: number, z: number): number {
    // Pinus brutia dominates the islands and the Anatolian side; Pinus nigra plantations in the north.
    const islands = inBox(ISLANDS, x, z, 2500);
    const asia = x > 2500 && z > -6000 ? 0.7 : 0.25;
    return Math.max(islands, asia);
  }

  private plantProbability(cls: Planting, x: number, z: number, geo: GeoWindows): number {
    if (geo.coast(x, z) < 5 || geo.height(x, z) < 0.8 || geo.slope(x, z) > 1.05) {
      return 0;
    }
    switch (cls) {
      case Planting.Forest: {
        // Closed canopy with natural glades; thinner toward non-forest edges.
        const glade = field(x, z, 90, 211);
        let p = glade < 0.24 ? 0.25 : 0.72 + 0.28 * smooth(Math.min((glade - 0.24) / 0.3, 1));
        let edge = 0;
        edge += geo.landUse(x + 13, z) === LandUse.Forest ? 1 : 0;
        edge += geo.landUse(x - 13, z) === LandUse.Forest ? 1 : 0;
        edge += geo.landUse(x, z + 13) === LandUse.Forest ? 1 : 0;
        edge += geo.landUse(x, z - 13) === LandUse.Forest ? 1 : 0;
        p *= 0.45 + 0.55 * (edge / 4);
        return p;
      }
      case Planting.Park: {
        // Groves and lawns.
        const g = field(x, z, 60, 223);
        return g < 0.3 ? 0.06 : 0.45 + 0.5 * smooth(Math.min((g - 0.3) / 0.22, 1));
      }
      case Planting.Cemetery:
        return 0.22 + 0.5 * field(x, z, 40, 227);
      case Planting.Garden:
        return 0.16 + 0.36 * field(x, z, 70, 229);
      case Planting.Yard:
        return 0.06 * field(x, z, 90, 233) * 2;
      case Planting.Field: {
        // Solitary trees and hedgerows along noise ridges.
        const r = Math.abs(field(x, z, 160, 239) - 0.5);
        return r < 0.035 ? 0.5 : 0.03;
      }
      default:
        return 0;
    }
  }

  private weightsFor(cls: Planting, x: number, z: number, geo: GeoWindows): SpeciesWeights {
    const w = tmpWeights;
    const palms = inBox(PALM_COAST, x, z, 400);
    switch (cls) {
      case Planting.Forest: {
        const islands = inBox(ISLANDS, x, z, 2500);
        if (islands > 0.5) {
          return setWeights(w, 0.34, 0.6, 0.04, 0.02, 0.0, 0);
        }
        const bosphorus = inBox(BOSPHORUS, x, z, 1500) * (1 - Math.min(Math.max((geo.coast(x, z) - 900) / 1200, 0), 1));
        const north = Math.min(Math.max((-z - 9000) / 4000, 0), 1);
        // North: oak / chestnut / hornbeam with black pine plantations; Bosphorus groves: stone pine, oak, planes, cypress.
        const sp = 0.12 * (1 - north) + 0.26 * bosphorus;
        const pi = 0.2 + 0.05 * (1 - north);
        const cy = 0.02 + 0.06 * bosphorus;
        const pl = 0.03 + 0.09 * bosphorus;
        const br = 0.62 * (1 - 0.4 * bosphorus) + 0.12 * north;
        return setWeights(w, sp, pi, cy, pl, br, 0);
      }
      case Planting.Park:
        return setWeights(w, 0.26, 0.08, 0.1, 0.3, 0.3, 0.12 * palms);
      case Planting.Cemetery:
        return setWeights(w, 0.08, 0.02, 0.8, 0.06, 0.04, 0);
      case Planting.Garden:
        return setWeights(w, 0.22, 0.1, 0.18, 0.12, 0.38, 0.15 * palms);
      case Planting.Yard:
        return setWeights(w, 0.1, 0.02, 0.2, 0.25, 0.43, 0.2 * palms);
      case Planting.Field:
        return setWeights(w, 0.05, 0.15, 0.02, 0.03, 0.75, 0);
      default:
        return setWeights(w, 0, 0, 0, 0, 0, 0);
    }
  }

  private makeTree(x: number, z: number, code: number, cls: Planting, geo: GeoWindows, h0: number, h1: number, h2: number): Tree | null {
    const sp = code % 8;
    const [lo, hi] = SCALE_RANGE[sp];
    // Stand age: neighbours share a size class, with individual spread.
    const age = field(x, z, 150, 241);
    let scale = lo + (hi - lo) * (0.55 * age + 0.45 * h0);
    if (cls === Planting.Yard || cls === Planting.Garden) {
      scale *= 0.72;
    } else if (cls === Planting.Park && sp === Species.Plane) {
      scale *= 1.1;
    }
    const y = geo.height(x, z) - 0.3;
    if (y < 0.3) {
      return null;
    }
    return { x, y, z, yaw: h1 * Math.PI * 2, scale, code, rank: h2 * 0.9999, width: 0.86 + 0.28 * hash2i(Math.floor(x * 7), Math.floor(z * 7), 97) };
  }

  /** Rows of small planes / limes along avenues and streets where the urban fabric is loose. */
  private streetTrees(req: TileRequestMessage, geo: GeoWindows, out: Tree[]): void {
    const C = PlacementContext.ROAD_CELL;
    const seen = new Set<number>();
    const x1 = req.x0 + req.size;
    const z1 = req.z0 + req.size;
    for (let cz = Math.floor(req.z0 / C); cz <= Math.floor((z1 - 1e-3) / C); cz++) {
      for (let cx = Math.floor(req.x0 / C); cx <= Math.floor((x1 - 1e-3) / C); cx++) {
        const list = this.roadCells.get((cz + 1000) * 2000 + (cx + 1000));
        if (!list) {
          continue;
        }
        for (const key of list) {
          if (seen.has(key)) {
            continue;
          }
          seen.add(key);
          const ri = Math.floor(key / 65536);
          const si = key % 65536;
          const road = this.roads[ri];
          if (road.kind !== 1 && road.kind !== 2 && road.kind !== 4) {
            continue;
          }
          const arc = this.roadArc[ri];
          const ax = road.pts[si * 2];
          const az = road.pts[si * 2 + 1];
          const bx = road.pts[si * 2 + 2];
          const bz = road.pts[si * 2 + 3];
          const len = arc[si + 1] - arc[si];
          if (len < 1) {
            continue;
          }
          const tx = (bx - ax) / len;
          const tz = (bz - az) / len;
          const spacing = 11.5;
          const k0 = Math.ceil(arc[si] / spacing);
          const k1 = Math.floor(arc[si + 1] / spacing);
          for (let k = k0; k <= k1; k++) {
            const s = k * spacing - arc[si];
            if (s < 0 || s > len) {
              continue;
            }
            for (let side = -1; side <= 1; side += 2) {
              const off = side * (road.width * 0.5 + 2.4);
              const x = ax + tx * s - tz * off;
              const z = az + tz * s + tx * off;
              if (x < req.x0 || x >= x1 || z < req.z0 || z >= z1) {
                continue;
              }
              const h = hash2i(ri * 131 + k, side + 7, 307);
              if (h < 0.28) {
                continue;
              }
              const use = geo.landUse(x, z);
              if (use !== LandUse.Road && use !== LandUse.Urban && use !== LandUse.Suburban && use !== LandUse.Park) {
                continue;
              }
              if (geo.density(x, z) > 0.5 || geo.coast(x, z) < 4 || geo.height(x, z) < 0.8 || geo.slope(x, z) > 0.5) {
                continue;
              }
              if (this.nearMosque(x, z, 1.05)) {
                continue;
              }
              // One species per street stretch.
              const stretch = hash2i(ri, Math.floor(k / 14), 311);
              const code = stretch < 0.6 ? Species.Plane : Species.Broadleaf + 8 * (stretch < 0.8 ? 0 : 1);
              const scale = (code === Species.Plane ? 0.46 : 0.58) + 0.14 * hash2i(ri * 7 + k, side, 313);
              out.push({ x, y: geo.height(x, z) - 0.3, z, yaw: hash2i(k, ri, 317) * 6.2832, scale, code, rank: hash2i(ri * 977 + k, side + 3, 331) * 0.9999, width: 0.7 });
            }
          }
        }
      }
    }
  }

  private nearMosque(x: number, z: number, factor: number): boolean {
    for (const m of this.mosques) {
      const r = m.radius * factor;
      if (Math.abs(x - m.x) < r && Math.abs(z - m.z) < r && Math.hypot(x - m.x, z - m.z) < r) {
        return true;
      }
    }
    return false;
  }

  /** Cypresses and planes lining mosque yards and their graveyards. */
  private mosqueTrees(req: TileRequestMessage, geo: GeoWindows, out: Tree[]): void {
    const x1 = req.x0 + req.size;
    const z1 = req.z0 + req.size;
    this.mosques.forEach((m, mi) => {
      const R = m.radius;
      if (m.x + R * 1.1 < req.x0 || m.x - R * 1.1 > x1 || m.z + R * 1.1 < req.z0 || m.z - R * 1.1 > z1) {
        return;
      }
      const ringLo = m.size > 0.5 ? 0.88 : 0.72;
      const ringHi = m.size > 0.5 ? 0.99 : 0.95;
      const count = Math.max(3, Math.round((2 * Math.PI * R) / 9));
      for (let k = 0; k < count; k++) {
        if (hash2i(mi, k, 401) < (m.size > 0.5 ? 0.35 : 0.5)) {
          continue;
        }
        const a = ((k + (hash2i(mi, k, 403) - 0.5) * 0.6) / count) * Math.PI * 2;
        const r = R * (ringLo + (ringHi - ringLo) * hash2i(mi, k, 405));
        const x = m.x + Math.cos(a) * r;
        const z = m.z + Math.sin(a) * r;
        if (x < req.x0 || x >= x1 || z < req.z0 || z >= z1) {
          continue;
        }
        const use = geo.landUse(x, z);
        if (use !== LandUse.Landmark && use !== LandUse.Park && use !== LandUse.Cemetery) {
          continue;
        }
        if (geo.coast(x, z) < 5 || geo.height(x, z) < 0.8) {
          continue;
        }
        const cypress = hash2i(mi, k, 407) < 0.6;
        const code = cypress ? Species.Cypress : Species.Plane;
        const scale = cypress ? 0.8 + 0.3 * hash2i(mi, k, 409) : 0.6 + 0.35 * hash2i(mi, k, 409) * m.size + 0.1;
        out.push({ x, y: geo.height(x, z) - 0.3, z, yaw: hash2i(mi, k, 411) * 6.2832, scale, code, rank: hash2i(mi, k, 413) * 0.9999, width: cypress ? 0.95 : 0.85 });
      }
    });
  }

  /** Canary palms along the Kadıköy – Moda – Fenerbahçe promenades. */
  private coastalPalms(req: TileRequestMessage, geo: GeoWindows, out: Tree[]): void {
    const b = PALM_COAST;
    if (req.x0 > b.maxX || req.x0 + req.size < b.minX || req.z0 > b.maxZ || req.z0 + req.size < b.minZ) {
      return;
    }
    const S = 13;
    const x1 = req.x0 + req.size;
    const z1 = req.z0 + req.size;
    for (let j = Math.floor(req.z0 / S); j <= Math.floor(z1 / S); j++) {
      for (let i = Math.floor(req.x0 / S); i <= Math.floor(x1 / S); i++) {
        const x = (i + 0.5 + (hash2i(i, j, 501) - 0.5) * 0.5) * S;
        const z = (j + 0.5 + (hash2i(i, j, 502) - 0.5) * 0.5) * S;
        if (x < req.x0 || x >= x1 || z < req.z0 || z >= z1 || inBox(b, x, z, 1) <= 0) {
          continue;
        }
        const c = geo.coast(x, z);
        if (c < 6.5 || c > 13 || geo.height(x, z) < 0.8 || hash2i(i, j, 503) > 0.55) {
          continue;
        }
        const use = geo.landUse(x, z);
        if (use === LandUse.Water || use === LandUse.Landmark || use === LandUse.Industrial) {
          continue;
        }
        out.push({ x, y: geo.height(x, z) - 0.3, z, yaw: hash2i(i, j, 504) * 6.2832, scale: 0.85 + 0.3 * hash2i(i, j, 505), code: Species.Palm, rank: hash2i(i, j, 506) * 0.9999, width: 1 });
      }
    }
  }
}
