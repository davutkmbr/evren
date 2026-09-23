/**
 * Superblocks: a jittered lattice of seeds whose Voronoi cells become neighbourhood street systems.
 * Each superblock has its own orientation (aligned to the nearest major road, to the terrain contours on
 * slopes, or free), block sizes and street widths from its district style. Voronoi edges read as the
 * irregular collector streets between neighbourhoods.
 */
import { Style, type StyleId } from '../protocol';
import { hash01 } from './rng';
import { distToSegment, type Segment, type WorldData } from './world-data';

export const SB_SPACING = 300;
const SB_JITTER = 0.72;
/** Half extent (m) covered by the block line tables in the superblock frame. */
const SB_REACH = 560;

export interface StyleProfile {
  blockX: [number, number];
  blockZ: [number, number];
  street: [number, number];
  /** Extra half-width kept clear along the Voronoi edges (collector streets). */
  mainHalf: number;
  warpAmp: number;
  warpScale: number;
  /** Probability that an interior street line is dropped (blocks merge into irregular larger ones). */
  mergeChance: number;
  /** Per-block rotation jitter (rad). */
  blockJitter: number;
}

export const STYLE_PROFILES: Record<StyleId, StyleProfile> = {
  [Style.Historic]: { blockX: [42, 78], blockZ: [30, 56], street: [4.5, 7], mainHalf: 5, warpAmp: 14, warpScale: 190, mergeChance: 0.18, blockJitter: 0.09 },
  [Style.Dense]: { blockX: [60, 108], blockZ: [38, 64], street: [8, 12], mainHalf: 6.5, warpAmp: 7, warpScale: 260, mergeChance: 0.08, blockJitter: 0.03 },
  [Style.Modern]: { blockX: [80, 135], blockZ: [55, 90], street: [11, 16], mainHalf: 8, warpAmp: 5, warpScale: 320, mergeChance: 0.05, blockJitter: 0.02 },
  [Style.Highrise]: { blockX: [120, 190], blockZ: [85, 140], street: [16, 22], mainHalf: 10, warpAmp: 3, warpScale: 400, mergeChance: 0.05, blockJitter: 0.01 },
  [Style.Villa]: { blockX: [70, 130], blockZ: [48, 85], street: [7, 9], mainHalf: 5, warpAmp: 16, warpScale: 200, mergeChance: 0.12, blockJitter: 0.08 },
  [Style.Yali]: { blockX: [55, 100], blockZ: [40, 70], street: [6, 8.5], mainHalf: 5, warpAmp: 13, warpScale: 200, mergeChance: 0.12, blockJitter: 0.07 },
  [Style.Industrial]: { blockX: [120, 210], blockZ: [85, 150], street: [14, 18], mainHalf: 9, warpAmp: 3, warpScale: 400, mergeChance: 0.05, blockJitter: 0.01 },
  [Style.Suburban]: { blockX: [70, 120], blockZ: [48, 80], street: [8, 10], mainHalf: 6, warpAmp: 10, warpScale: 230, mergeChance: 0.1, blockJitter: 0.05 },
};

export interface Superblock {
  id: number;
  i: number;
  j: number;
  sx: number;
  sz: number;
  style: StyleId;
  district: number;
  angle: number;
  cos: number;
  sin: number;
  xs: number[];
  zs: number[];
  profile: StyleProfile;
  streetHalf: number;
  /** 0 sodium (older), 1 warm LED, 2 neutral LED. */
  lampType: number;
  /** Street-side offset of the warp noise (per superblock). */
  warpSalt: number;
}

const cache = new Map<number, Superblock>();
const segScratch: Segment[] = [];

function sbKey(i: number, j: number): number {
  return (i + 512) * 2048 + (j + 512);
}

export function seedOf(i: number, j: number): [number, number] {
  return [(i + 0.5 + (hash01(i, j, 11) - 0.5) * SB_JITTER) * SB_SPACING, (j + 0.5 + (hash01(i, j, 12) - 0.5) * SB_JITTER) * SB_SPACING];
}

function blockLines(profileRange: [number, number], i: number, j: number, salt: number, merge: number): number[] {
  const [lo, hi] = profileRange;
  const lines: number[] = [];
  let x = -(hash01(i, j, salt) * (lo + hi) * 0.5);
  let k = 0;
  const neg: number[] = [];
  let xn = x;
  while (xn > -SB_REACH) {
    const len = lo + (hi - lo) * hash01(i, j, salt + 1, 1000 - k);
    xn -= len;
    neg.push(xn);
    k++;
  }
  neg.reverse();
  lines.push(...neg, x);
  k = 0;
  while (x < SB_REACH) {
    x += lo + (hi - lo) * hash01(i, j, salt + 2, k);
    lines.push(x);
    k++;
  }
  // Randomly drop interior lines (never two in a row) so blocks merge into larger irregular ones.
  const out: number[] = [lines[0]];
  let prevDropped = false;
  for (let n = 1; n < lines.length - 1; n++) {
    if (!prevDropped && hash01(i, j, salt + 3, n) < merge) {
      prevDropped = true;
      continue;
    }
    prevDropped = false;
    out.push(lines[n]);
  }
  out.push(lines[lines.length - 1]);
  return out;
}

function orientation(sx: number, sz: number, style: StyleId, i: number, j: number, world: WorldData): number {
  const roads = world.roads.query(sx - 420, sz - 420, sx + 420, sz + 420, segScratch);
  let best = Infinity;
  let angle = NaN;
  for (const s of roads) {
    if (s.kind === 3) {
      continue;
    }
    const { d } = distToSegment(sx, sz, s);
    const w = s.kind === 0 ? 0.8 : s.kind === 2 ? 1.25 : 1;
    const score = d * w;
    if (score < best && d < 420) {
      best = score;
      angle = Math.atan2(s.bz - s.az, s.bx - s.ax);
    }
  }
  const e = 60;
  const gx = (world.coarseHeight(sx + e, sz) - world.coarseHeight(sx - e, sz)) / (2 * e);
  const gz = (world.coarseHeight(sx, sz + e) - world.coarseHeight(sx, sz - e)) / (2 * e);
  const slope = Math.hypot(gx, gz);
  if (slope > 0.07 && (Number.isNaN(angle) || best > 180 || slope > 0.14)) {
    angle = Math.atan2(gx, -gz);
  }
  if (Number.isNaN(angle)) {
    angle = hash01(i, j, 21) * Math.PI;
  }
  if (style === Style.Historic || style === Style.Villa || style === Style.Yali) {
    angle += (hash01(i, j, 22) - 0.5) * 0.45;
  }
  return angle;
}

export function getSuperblock(i: number, j: number, world: WorldData): Superblock {
  const key = sbKey(i, j);
  const hit = cache.get(key);
  if (hit) {
    return hit;
  }
  const [sx, sz] = seedOf(i, j);
  const district = world.districtNear(sx, sz);
  const style: StyleId = district >= 0 ? world.districts[district].style : Style.Suburban;
  const profile = STYLE_PROFILES[style];
  const angle = orientation(sx, sz, style, i, j, world);
  const sb: Superblock = {
    id: key,
    i,
    j,
    sx,
    sz,
    style,
    district,
    angle,
    cos: Math.cos(angle),
    sin: Math.sin(angle),
    xs: blockLines(profile.blockX, i, j, 31, profile.mergeChance),
    zs: blockLines(profile.blockZ, i, j, 41, profile.mergeChance),
    profile,
    streetHalf: 0.5 * (profile.street[0] + (profile.street[1] - profile.street[0]) * hash01(i, j, 51)),
    lampType: style === Style.Historic || hash01(i, j, 61) < 0.45 ? 0 : hash01(i, j, 62) < 0.6 ? 1 : 2,
    warpSalt: (i * 7919 + j * 104729) | 0,
  };
  if (cache.size > 6000) {
    cache.clear();
  }
  cache.set(key, sb);
  return sb;
}

export interface Ownership {
  owner: number;
  /** Distance (m) from the point to the Voronoi edge toward the closest competing seed. */
  edge: number;
}

const ownScratch: Ownership = { owner: 0, edge: 0 };

/** Voronoi owner of a point among the superblock seeds, plus the distance to the owner's cell edge. */
export function ownerAt(x: number, z: number): Ownership {
  const ci = Math.floor(x / SB_SPACING);
  const cj = Math.floor(z / SB_SPACING);
  let bestD = Infinity;
  let bi = 0;
  let bj = 0;
  let bx = 0;
  let bz = 0;
  for (let dj = -2; dj <= 2; dj++) {
    for (let di = -2; di <= 2; di++) {
      const [sx, sz] = seedOf(ci + di, cj + dj);
      const d = (sx - x) * (sx - x) + (sz - z) * (sz - z);
      if (d < bestD) {
        bestD = d;
        bi = ci + di;
        bj = cj + dj;
        bx = sx;
        bz = sz;
      }
    }
  }
  let edge = Infinity;
  for (let dj = -2; dj <= 2; dj++) {
    for (let di = -2; di <= 2; di++) {
      const i = ci + di;
      const j = cj + dj;
      if (i === bi && j === bj) {
        continue;
      }
      const [sx, sz] = seedOf(i, j);
      const dOther = (sx - x) * (sx - x) + (sz - z) * (sz - z);
      const sep = Math.hypot(sx - bx, sz - bz);
      const e = (dOther - bestD) / (2 * sep);
      if (e < edge) {
        edge = e;
      }
    }
  }
  ownScratch.owner = sbKey(bi, bj);
  ownScratch.edge = edge;
  return ownScratch;
}

export { sbKey };
