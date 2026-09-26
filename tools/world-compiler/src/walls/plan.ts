/**
 * Wall placement plan (.docs/planning/22-city-walls.md, "Placement design" steps 2-7): turns data/osm/walls.json into
 * kit pieces (curtains, towers, gates, sea foundations) in world coordinates. Every decision is a generic rule over
 * the OSM / supplement tags, the mapped towers and gates, the flight world's ground, coast and water names; nothing
 * refers to a coordinate or a way id.
 */
import { Opening, type WallArea, type WallData, type WallLine, type WallMeta, type WallTower } from '../../../../src/world/landmarks/walls/data/types';
import { hash } from '../../../../src/world/landmarks/walls/kit/detail';
import { noise1, type CurtainParams, type EndStyle, type GateParams, type SeaFoundationParams, type TowerParams, type TowerPlan, type WallStyle } from '../../../../src/world/landmarks/walls/kit/kit';
import type { Footprint, Footprints } from './buildings';
import { bandHits, CLEAR, fitRun, outlineBlocked, thicknessOver, thicknessSteps, towerOutline, wallOverlaps, type Displace, type Fit, type OverlapReport } from './fit';
import { at, chaikin, dedupe, flat, inRing, lengths, project, resample, ringDist, simplify, slice, tangent, type V2 } from './poly';
import { WALL_CORRIDOR_GROW } from '../../../../src/world/landmarks/walls/data/bodies';

/** World queries the plan needs (the flight world's geo, see cli.ts). */
export interface Site {
  /** Ground height (m): the OSM ground over the geo terrain (osmGroundHeight). */
  ground(x: number, z: number): number;
  /** Signed coast distance (m, positive on land). */
  coast(x: number, z: number): number;
  waterName(x: number, z: number): string | null;
  /** Building density 0..1. */
  density(x: number, z: number): number;
  /** Towers another system draws (heritage fortresses): x, z, radius; no kit tower is placed on them. */
  reservedTowers?: readonly { x: number; z: number; r: number }[];
}

export type WallClass = 'land' | 'land-outer' | 'marmara' | 'golden-horn' | 'castle';

/** Opening kinds of the plan: the data's kinds plus fragment gaps of ruined supplement stretches. */
const FRAGMENT = 5;

export interface CurtainPiece {
  kind: 'curtain';
  src: number;
  pts: V2[];
  p: CurtainParams;
}
export interface TowerPiece {
  kind: 'tower';
  src: number;
  at: V2;
  dir: V2;
  p: TowerParams;
  mapped: boolean;
}
export interface GatePiece {
  kind: 'gate';
  src: number;
  a: V2;
  b: V2;
  p: GateParams;
}
export interface SeaPiece {
  kind: 'sea';
  src: number;
  pts: V2[];
  p: SeaFoundationParams;
}
export type Piece = CurtainPiece | TowerPiece | GatePiece | SeaPiece;

export interface Plan {
  pieces: Piece[];
  /** OSM ids of buildings the placed pieces stand for. */
  owned: number[];
  /** Land-use reservation corridors: [half width, x0, z0, x1, z1, ...]. */
  corridors: number[][];
  stats: Record<string, number>;
  /** Wall-vs-building check of the finished pieces (fit.ts wallOverlaps), when footprints were given. */
  overlap: OverlapReport | null;
}

interface ClassSpec {
  height: number;
  thickness: number;
  batter: number;
  merlonsKept: number;
  ruin: number;
  /** Generated tower spacing (m, 0 = mapped towers only). */
  spacing: number;
  tower: { width: number; projection: number; above: number };
}

/** Defaults from .docs/research/sea-walls-reference.md and the placement design (step 4). */
const CLASS: Record<WallClass, ClassSpec> = {
  land: { height: 12, thickness: 4.8, batter: 0.6, merlonsKept: 0.5, ruin: 0.15, spacing: 55, tower: { width: 10, projection: 6, above: 6 } },
  'land-outer': { height: 8.5, thickness: 2.4, batter: 0.4, merlonsKept: 0.4, ruin: 0.3, spacing: 55, tower: { width: 6.5, projection: 3.5, above: 3.5 } },
  marmara: { height: 12, thickness: 4.2, batter: 0.6, merlonsKept: 0.35, ruin: 0.15, spacing: 45, tower: { width: 9, projection: 4.5, above: 4 } },
  'golden-horn': { height: 10, thickness: 4, batter: 0.5, merlonsKept: 0.3, ruin: 0.3, spacing: 50, tower: { width: 8.5, projection: 4, above: 4 } },
  castle: { height: 7, thickness: 3.2, batter: 0.4, merlonsKept: 0.6, ruin: 0.1, spacing: 0, tower: { width: 8, projection: 3.5, above: 5 } },
};

/** Supplement stretches (walls OSM does not map, mostly demolished): ruin and the fraction lost to gaps. */
const SUPPLEMENT_STATE: Partial<Record<WallClass, { ruin: number; gaps: number }>> = {
  marmara: { ruin: 0.4, gaps: 0.25 },
  'golden-horn': { ruin: 0.6, gaps: 0.5 },
  land: { ruin: 0.4, gaps: 0.25 },
};

/** A mapped tower within this distance (m) of a wall stands on it. */
const TOWER_REACH = 25;
/** A mapped gate within this distance (m) of a road opening narrower than GATE_MAX_GAP turns it into a gate. */
const GATE_REACH = 20;
const GATE_MAX_GAP = 10;
/** Paths narrower than this (m) pass through a gate passage. */
const PATH_GATE_MAX = 6;
/** Generated towers keep this far (m) from openings. */
const TOWER_CLEAR = 9;
/** Water: signed coast distance (m) below which no wall is drawn. */
const WATER = 1;
/** Sea foundation where the outer foot is this close (m) to the water and this low (m). */
const SEA_REACH = 8;
const SEA_LOW = 2.2;
/**
 * Land-use corridor growth (m) beyond the wall faces / tower outlines: the procedural city samples a lot's corners
 * on the ~11.7 m land-use grid, so the reservation reaches about one cell past the faces. Shared with the runtime
 * body test (walls/data/bodies.ts), which subtracts it again.
 */
const CORRIDOR_GROW = WALL_CORRIDOR_GROW;

interface Anchor {
  /** Opening end points (lines) or centre + half width (areas). */
  a: V2;
  b?: V2;
  hw?: number;
  kind: number;
}

interface Run {
  id: number;
  area: boolean;
  closed: boolean;
  pts: V2[];
  cum: number[];
  meta: WallMeta;
  anchors: Anchor[];
  thick?: number;
  cls: WallClass;
  /** Mapped towers standing on this run. */
  towers: { t: WallTower; s: number; ring: V2[] }[];
}

const metaKey = (m: WallMeta): string => JSON.stringify([m.h ?? 0, m.thick ?? 0, m.ruined ?? 0, m.mat ?? '', m.era ?? '', m.castle ?? 0, m.src ?? '']);

/* ------------------------------------------------------------------ line preparation (step 2) */

/**
 * OSM wall lines often trace the outline of the towers they pass (out along one side, across the front, back along
 * the other). The tower piece draws that stretch, so the vertices on a tower outline are replaced by the straight
 * line from the first to the last of them.
 */
function cutTowerBumps(pts: V2[], rings: readonly V2[][], closed: boolean): V2[] {
  const on = pts.map(([x, z]) => rings.some((r) => ringDist(x, z, r) < 1 || inRing(x, z, r)));
  const out: V2[] = [];
  for (let i = 0; i < pts.length; i++) {
    const prev = closed ? on[(i - 1 + pts.length) % pts.length] : i > 0 && on[i - 1];
    const next = closed ? on[(i + 1) % pts.length] : i < pts.length - 1 && on[i + 1];
    if (on[i] && prev && next) {
      continue;
    }
    out.push(pts[i]);
  }
  return out.length >= 2 ? out : pts;
}

/**
 * Centre line and mean width of a thin outline polygon (a thick wall mapped as an area): the ring is split at a tip
 * and the point half a perimeter away into its two long sides, paired by arc length; the tip is the split whose
 * pairs lie closest together.
 */
function centreline(ring: V2[]): { pts: V2[]; width: number } | null {
  const P = resample([...ring, ring[0]], 1);
  P.pop();
  const N = P.length;
  if (N < 8) {
    return null;
  }
  const half = Math.floor(N / 2);
  const stride = Math.max(1, Math.floor(N / 500));
  let best = -1;
  let bestMean = Infinity;
  for (let c = 0; c < N; c += stride) {
    let sum = 0;
    let n = 0;
    for (let k = 0; k <= half; k += 2) {
      const a = P[(c + k) % N];
      const b = P[(c - k + N) % N];
      sum += Math.hypot(a[0] - b[0], a[1] - b[1]);
      n++;
    }
    if (sum / n < bestMean) {
      bestMean = sum / n;
      best = c;
    }
  }
  const mids: V2[] = [];
  const widths: number[] = [];
  for (let k = 0; k <= half; k++) {
    const a = P[(best + k) % N];
    const b = P[(best - k + N) % N];
    mids.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
    widths.push(Math.hypot(a[0] - b[0], a[1] - b[1]));
  }
  const mid = widths.slice(Math.floor(widths.length * 0.1), Math.ceil(widths.length * 0.9)).sort((x, y) => x - y);
  const width = mid[Math.floor(mid.length / 2)] ?? bestMean;
  // Smooth the wobble of tower bumps and the pairing (moving average over ~9 m), keep the tips.
  const sm: V2[] = mids.map((p, i) => {
    if (i === 0 || i === mids.length - 1) {
      return p;
    }
    let sx = 0;
    let sz = 0;
    let n = 0;
    for (let k = Math.max(0, i - 4); k <= Math.min(mids.length - 1, i + 4); k++) {
      sx += mids[k][0];
      sz += mids[k][1];
      n++;
    }
    return [sx / n, sz / n];
  });
  // The tips of the pairing are the outline's end faces: pull the ends in by half the width.
  const cum = lengths(sm);
  const total = cum[cum.length - 1];
  if (total < width * 1.5) {
    return null;
  }
  return { pts: simplify(slice(sm, cum, width / 2, total - width / 2), 0.3), width };
}

/** Coarse supplement traces: points in the water (or on the shoreline) are moved inland along the coast gradient. */
function snapInland(pts: V2[], site: Site): V2[] {
  const MIN = 4;
  return pts.map(([x, z]) => {
    let px = x;
    let pz = z;
    for (let it = 0; it < 15 && site.coast(px, pz) < MIN; it++) {
      const e = 4;
      const gx = site.coast(px + e, pz) - site.coast(px - e, pz);
      const gz = site.coast(px, pz + e) - site.coast(px, pz - e);
      const l = Math.hypot(gx, gz);
      if (l < 1e-6) {
        break;
      }
      px += (gx / l) * 2;
      pz += (gz / l) * 2;
    }
    return site.coast(px, pz) >= MIN && Math.hypot(px - x, pz - z) <= 30 ? ([px, pz] as V2) : ([x, z] as V2);
  });
}

function lineRun(l: WallLine, rings: readonly V2[][], site: Site): Run | null {
  const raw = flat(l.pts);
  const closed = !!l.closed;
  const cum0 = lengths(raw);
  const anchors: Anchor[] = [];
  const open = l.open ?? [];
  for (let k = 0; k + 2 < open.length; k += 3) {
    anchors.push({ a: at(raw, cum0, open[k]).p, b: at(raw, cum0, open[k + 1]).p, kind: open[k + 2] });
  }
  let pts = cutTowerBumps(raw, rings, closed);
  if (l.src) {
    // One vertex per ~125 m: smooth, snap to the land, smooth again.
    pts = chaikin(snapInland(resample(chaikin(pts, 2), 10), site), 1);
  }
  pts = dedupe(simplify(pts, 0.3));
  if (closed) {
    pts.push(pts[0]);
  }
  if (pts.length < 2) {
    return null;
  }
  const { id, pts: _p, open: _o, closed: _c, ...meta } = l;
  return { id, area: false, closed, pts, cum: lengths(pts), meta, anchors, cls: 'land', towers: [] };
}

function areaRun(a: WallArea, rings: readonly V2[][]): Run | null {
  let ring = flat(a.ring);
  ring = cutTowerBumps(ring, rings, true);
  const c = centreline(ring);
  const { id, ring: _r, open: _o, ...meta } = a;
  const anchors: Anchor[] = [];
  const open = a.open ?? [];
  for (let k = 0; k + 3 < open.length; k += 4) {
    anchors.push({ a: [open[k], open[k + 1]], hw: open[k + 2], kind: open[k + 3] });
  }
  if (!c || c.width > 15) {
    // Not a thin outline after all: walk it as an enclosure.
    const pts = [...ring, ring[0]];
    return { id, area: true, closed: true, pts, cum: lengths(pts), meta, anchors, cls: 'land', towers: [] };
  }
  return { id, area: true, closed: false, pts: c.pts, cum: lengths(c.pts), meta, anchors, thick: Math.min(8, Math.max(1.5, c.width)), cls: 'land', towers: [] };
}

/**
 * Supplement traces (one vertex per ~125 m) cut across the coastal avenues built on fill in front of the sea walls.
 * Every point within SNAP_REACH m of a major road running along the trace moves to the road's land side (inland of
 * its kerb by the wall's half band plus the clearance); divided roads are cleared carriageway by carriageway. The
 * building fit runs afterwards, and where there is no room the wall breaks there instead of standing in the road.
 */
const SNAP_REACH = 40;
function snapRoadside(pts: V2[], fp: Footprints, site: Site, halfBand: number): { pts: V2[]; moved: number } {
  const P = resample(pts, 4);
  const cum = lengths(P);
  let moved = 0;
  const out = P.map((p, k): V2 => {
    const t = tangent(P, cum, cum[k], 6);
    let q: V2 = p;
    for (let it = 0; it < 4; it++) {
      let best: { ni: V2; move: number } | null = null;
      for (const f of fp.near(q[0], q[1], SNAP_REACH + 5)) {
        const r = f.road;
        if (!r || !r.major || r.rail) {
          continue;
        }
        const dx = r.b[0] - r.a[0];
        const dz = r.b[1] - r.a[1];
        const l = Math.hypot(dx, dz);
        const d: V2 = [dx / l, dz / l];
        if (Math.abs(d[0] * t[0] + d[1] * t[1]) < 0.7) {
          continue;
        }
        const u = Math.min(l, Math.max(0, (q[0] - r.a[0]) * d[0] + (q[1] - r.a[1]) * d[1]));
        const c: V2 = [r.a[0] + d[0] * u, r.a[1] + d[1] * u];
        if (Math.hypot(q[0] - c[0], q[1] - c[1]) > SNAP_REACH) {
          continue;
        }
        const nr: V2 = [-d[1], d[0]];
        const sign = site.coast(c[0] + nr[0] * 25, c[1] + nr[1] * 25) >= site.coast(c[0] - nr[0] * 25, c[1] - nr[1] * 25) ? 1 : -1;
        const ni: V2 = [nr[0] * sign, nr[1] * sign];
        const off = (q[0] - c[0]) * ni[0] + (q[1] - c[1]) * ni[1];
        const need = r.hw + CLEAR + halfBand + 0.5;
        if (off < need && (!best || need - off > best.move)) {
          best = { ni, move: need - off };
        }
      }
      if (!best || best.move < 0.05) {
        break;
      }
      q = [q[0] + best.ni[0] * best.move, q[1] + best.ni[1] * best.move];
    }
    const m = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (m > 60) {
      return p;
    }
    if (m > 0.05 && k > 0) {
      moved += cum[k] - cum[k - 1];
    }
    return q;
  });
  return { pts: dedupe(simplify(out, 0.3)), moved };
}

/** Joins open runs with the same tags that share an end point (continuous walls get mitred corners). */
function mergeRuns(runs: Run[]): Run[] {
  const EPS = 0.6;
  const near = (p: V2, q: V2): boolean => Math.hypot(p[0] - q[0], p[1] - q[1]) < EPS;
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < runs.length && !merged; i++) {
      const A = runs[i];
      if (A.closed) {
        continue;
      }
      for (let j = 0; j < runs.length && !merged; j++) {
        const B = runs[j];
        if (i === j || B.closed || metaKey(A.meta) !== metaKey(B.meta) || !!A.thick !== !!B.thick) {
          continue;
        }
        const a0 = A.pts[0];
        const a1 = A.pts[A.pts.length - 1];
        const b0 = B.pts[0];
        const b1 = B.pts[B.pts.length - 1];
        let pts: V2[] | null = null;
        if (near(a1, b0)) {
          pts = [...A.pts, ...B.pts.slice(1)];
        } else if (near(a1, b1)) {
          pts = [...A.pts, ...B.pts.slice(0, -1).reverse()];
        } else if (near(a0, b1)) {
          pts = [...B.pts, ...A.pts.slice(1)];
        } else if (near(a0, b0)) {
          pts = [...B.pts.slice().reverse(), ...A.pts.slice(1)];
        }
        if (!pts) {
          continue;
        }
        const keep = A.cum[A.cum.length - 1] >= B.cum[B.cum.length - 1] ? A : B;
        const first = pts[0];
        const last = pts[pts.length - 1];
        const closed = near(first, last) && pts.length > 3;
        if (closed) {
          pts[pts.length - 1] = first;
        }
        const run: Run = { ...keep, pts, cum: lengths(pts), closed, anchors: [...A.anchors, ...B.anchors], thick: A.thick && B.thick ? (A.thick + B.thick) / 2 : undefined };
        runs = runs.filter((_, k) => k !== i && k !== j);
        runs.push(run);
        merged = true;
      }
    }
  }
  return runs;
}

const reverseRun = (r: Run): void => {
  r.pts.reverse();
  r.cum = lengths(r.pts);
};

/* ------------------------------------------------------------------ outer side and class (steps 3, 4) */

/** Distance (m) to the first water along the ray from p in direction n, or Infinity within `reach`. */
function waterAlong(site: Site, p: V2, n: V2, reach: number): { d: number; name: string | null } {
  for (let d = 10; d <= reach; d += 10) {
    const x = p[0] + n[0] * d;
    const z = p[1] + n[1] * d;
    if (site.coast(x, z) < 0) {
      return { d, name: site.waterName(x, z) };
    }
  }
  return { d: Infinity, name: null };
}

/** Arc-length fraction of `r` that runs parallel to `o` at 8-40 m (the two lines of a double wall). */
function parallelShare(r: Run, o: Run): { share: number; same: number } {
  const total = r.cum[r.cum.length - 1];
  let n = 0;
  let hit = 0;
  let same = 0;
  for (let s = 5; s < total; s += 10) {
    const { p } = at(r.pts, r.cum, s);
    const t = tangent(r.pts, r.cum, s);
    n++;
    const pr = project(o.pts, o.cum, p[0], p[1]);
    if (pr.d < 8 || pr.d > 40) {
      continue;
    }
    const ot = tangent(o.pts, o.cum, pr.s);
    const dot = ot[0] * t[0] + ot[1] * t[1];
    if (Math.abs(dot) > 0.85) {
      hit++;
      same += Math.sign(dot);
    }
  }
  return { share: n ? hit / n : 0, same };
}

function orient(r: Run, site: Site, decided: readonly Run[]): void {
  const total = r.cum[r.cum.length - 1];
  if (r.closed) {
    // Enclosure: the outer side is outside the ring.
    let best = 1;
    let bl = 0;
    for (let i = 1; i < r.pts.length; i++) {
      const l = r.cum[i] - r.cum[i - 1];
      if (l > bl) {
        bl = l;
        best = i;
      }
    }
    const s = (r.cum[best - 1] + r.cum[best]) / 2;
    const { p, t } = at(r.pts, r.cum, s);
    if (inRing(p[0] - t[1] * 1.5, p[1] + t[0] * 1.5, r.pts)) {
      reverseRun(r);
    }
    return;
  }
  // 1. Its mapped towers project outward (the outline's far side decides for towers straddling the line).
  let vote = 0;
  for (const m of r.towers) {
    const far = m.ring.reduce((acc, q) => {
      const v = project(r.pts, r.cum, q[0], q[1]).side;
      return Math.abs(v) > Math.abs(acc) ? v : acc;
    }, 0);
    if (Math.abs(far) > 0.8) {
      vote += Math.sign(far);
    }
  }
  if (vote !== 0) {
    if (vote < 0) {
      reverseRun(r);
    }
    return;
  }
  // 2. The other line of a double wall (oriented by its towers): the same outer side.
  for (const o of decided) {
    const ps = parallelShare(r, o);
    if (ps.share >= 0.35) {
      if (ps.same < 0) {
        reverseRun(r);
      }
      return;
    }
  }
  // 3. The sea side.
  let seaVote = 0;
  let dens = 0;
  for (let s = Math.min(10, total / 2); s < total; s += 25) {
    const { p, t } = at(r.pts, r.cum, s);
    const n: V2 = [-t[1], t[0]];
    const right = waterAlong(site, p, n, 250).d;
    const left = waterAlong(site, p, [-n[0], -n[1]], 250).d;
    if (right !== left) {
      seaVote += right < left ? 1 : -1;
    }
    dens += site.density(p[0] + n[0] * 40, p[1] + n[1] * 40) - site.density(p[0] - n[0] * 40, p[1] - n[1] * 40);
  }
  if (seaVote !== 0) {
    if (seaVote < 0) {
      reverseRun(r);
    }
    return;
  }
  // 4. The less built-up side.
  if (dens > 0) {
    reverseRun(r);
  }
}

function classify(r: Run, site: Site): WallClass {
  if (r.meta.castle) {
    return 'castle';
  }
  const total = r.cum[r.cum.length - 1];
  let n = 0;
  let sea = 0;
  const names = new Map<string, number>();
  for (let s = Math.min(5, total / 2); s < total; s += 20) {
    const { p, t } = at(r.pts, r.cum, s);
    const w = waterAlong(site, p, [-t[1], t[0]], 220);
    n++;
    if (w.d < Infinity) {
      sea++;
      if (w.name) {
        names.set(w.name, (names.get(w.name) ?? 0) + 1);
      }
    }
  }
  if (n && sea / n >= 0.4) {
    const top = [...names.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    return top === 'Haliç' ? 'golden-horn' : 'marmara';
  }
  return 'land';
}

/** Double land walls: a land wall with a parallel land wall 8-40 m away on its inner side is the lower outer wall. */
function outerLandWalls(runs: readonly Run[]): void {
  const land = runs.filter((r) => r.cls === 'land');
  const flags = land.map((r) => {
    const total = r.cum[r.cum.length - 1];
    let n = 0;
    let hit = 0;
    for (let s = 5; s < total; s += 10) {
      const { p } = at(r.pts, r.cum, s);
      const t = tangent(r.pts, r.cum, s);
      n++;
      for (const o of land) {
        if (o === r) {
          continue;
        }
        const pr = project(o.pts, o.cum, p[0], p[1]);
        if (pr.d < 8 || pr.d > 40) {
          continue;
        }
        const q = at(o.pts, o.cum, pr.s).p;
        const inner = (q[0] - p[0]) * -t[1] + (q[1] - p[1]) * t[0] < 0;
        const ot = tangent(o.pts, o.cum, pr.s);
        if (inner && Math.abs(ot[0] * t[0] + ot[1] * t[1]) > 0.85) {
          hit++;
          break;
        }
      }
    }
    return n > 0 && hit / n >= 0.35;
  });
  land.forEach((r, k) => {
    if (flags[k]) {
      r.cls = 'land-outer';
    }
  });
}

/* ------------------------------------------------------------------ pieces (steps 5-7) */

interface Interval {
  s0: number;
  s1: number;
  kind: number;
}

/** Stronger kinds win when intervals merge. */
const KIND_RANK: Record<number, number> = { [Opening.Water]: 5, [Opening.Road]: 4, [Opening.Rail]: 3, [Opening.Building]: 2, [Opening.Path]: 1, [FRAGMENT]: 0 };

function mergeIntervals(list: Interval[], join: number): Interval[] {
  const sorted = list.filter((i) => i.s1 > i.s0).sort((a, b) => a.s0 - b.s0);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.s0 <= last.s1 + join) {
      last.s1 = Math.max(last.s1, i.s1);
      if (KIND_RANK[i.kind] > KIND_RANK[last.kind]) {
        last.kind = i.kind;
      }
    } else {
      out.push({ ...i });
    }
  }
  return out;
}

function endFor(kind: number): EndStyle {
  return kind === Opening.Building || kind === Opening.Path ? 'flush' : 'crumbled';
}

const PLANS: TowerPlan[] = ['pentagon', 'hexagon', 'octagon'];

function towerPlanOf(ring: readonly V2[]): TowerPlan {
  const s = simplify([...ring, ring[0]], 0.8);
  const n = s.length - 1;
  return n <= 4 ? 'square' : n === 5 ? 'pentagon' : n <= 7 ? 'hexagon' : 'octagon';
}

function styleOf(m: WallMeta, cls: WallClass): WallStyle {
  if (m.era === 'genoese' || cls === 'castle') {
    return 'rubble';
  }
  return m.era === 'ottoman' && m.mat !== 'brick' ? 'ashlar' : 'byzantine';
}

export function planWalls(data: WallData, site: Site, fp: Footprints | null = null): Plan {
  const stats: Record<string, number> = {};
  const add = (k: string, v: number): void => {
    stats[k] = (stats[k] ?? 0) + v;
  };
  const rings = data.towers.map((t) => (t.ring ? flat(t.ring) : []));
  const towerRings = rings.filter((r) => r.length >= 3);

  /* Runs: lines, thick-wall outlines (centre lines), merged. */
  let runs: Run[] = [];
  for (const l of data.lines) {
    const r = lineRun(l, towerRings, site);
    if (r) {
      runs.push(r);
    }
  }
  for (const a of data.areas) {
    const r = areaRun(a, towerRings);
    if (r) {
      runs.push(r);
    }
  }
  runs = mergeRuns(runs);

  /* Mapped towers: each on its nearest run. */
  const placedTowers = new Set<number>();
  data.towers.forEach((t, k) => {
    const ring = rings[k];
    if (ring.length < 3) {
      return;
    }
    let best: Run | null = null;
    let bs = 0;
    let bd = TOWER_REACH;
    for (const r of runs) {
      const pr = project(r.pts, r.cum, t.x, t.z);
      if (pr.d < bd) {
        bd = pr.d;
        best = r;
        bs = pr.s;
      }
    }
    if (best) {
      best.towers.push({ t, s: bs, ring });
    }
  });

  /* Outer side (runs with mapped towers first: the other line of a double wall follows them), class. */
  const decided: Run[] = [];
  for (const r of [...runs].sort((a, b) => b.towers.length - a.towers.length)) {
    orient(r, site, decided);
    if (r.towers.length) {
      decided.push(r);
    }
    r.cls = classify(r, site);
    for (const m of r.towers) {
      m.s = project(r.pts, r.cum, m.t.x, m.t.z).s;
    }
  }
  outerLandWalls(runs);

  const pieces: Piece[] = [];
  const corridors: number[][] = [];
  const owned = new Set(data.owned);
  const drawnIds = new Set<number>();
  /** Buildings that step aside for the walls (ids join `owned`), by reason. */
  const displaced = new Map<number, Displace>();
  const skip = (f: Footprint): boolean => (!f.part && owned.has(f.id)) || displaced.has(f.id);
  const corridor = (hw: number, pts: readonly V2[], into: number[][]): void => {
    const s = simplify(pts, 1);
    into.push([Math.round(hw * 2) / 2, ...s.flatMap(([x, z]) => [Math.round(x * 2) / 2, Math.round(z * 2) / 2])]);
  };
  const stretchOf = new Map<number, string>();

  for (const r of runs) {
    const spec = CLASS[r.cls];
    const seed = Math.floor(hash(r.id % 100000, 7) * 1e6);
    const supp = r.meta.src ? SUPPLEMENT_STATE[r.cls] : undefined;
    const height = r.meta.h ? Math.max(3, r.meta.h - 1.2) : spec.height;
    const thickness = r.meta.thick ?? r.thick ?? spec.thickness;
    stretchOf.set(r.id, `${r.cls}${r.meta.src ? '(ohm)' : ''}:${r.meta.name ?? r.id}`);
    for (const m of r.towers) {
      stretchOf.set(m.t.id, stretchOf.get(r.id)!);
    }

    /* Buildings: shift / thin the wall around them, open it where one stands on the line (fit.ts). */
    let fit: Fit | null = null;
    if (fp && r.meta.src && !r.closed) {
      const sn = snapRoadside(r.pts, fp, site, thickness / 2 + spec.batter);
      r.pts = sn.pts;
      r.cum = lengths(r.pts);
      add('roads.snappedMetres', sn.moved);
    }
    if (fp) {
      fit = fitRun(r.pts, thickness, spec.batter, fp, skip, (f, why) => {
        if (!displaced.has(f.id)) {
          displaced.set(f.id, why);
          add(`buildings.displaced.${why}`, 1);
          add(`buildings.displacedArea.${why}`, f.area);
        }
      });
      r.pts = fit.pts;
      r.cum = lengths(r.pts);
      for (const m of r.towers) {
        m.s = project(r.pts, r.cum, m.t.x, m.t.z).s;
      }
      add('buildings.shiftedMetres', fit.shifted);
      add('buildings.thinnedMetres', fit.thinned);
    }
    const total = r.cum[r.cum.length - 1];
    const tAt = (a: number, b = a): number => (fit ? thicknessOver(fit, a, b) : thickness);
    let ruin = r.meta.ruined ? Math.max(0.6, spec.ruin) : spec.ruin;
    if (supp) {
      ruin = Math.max(ruin, supp.ruin);
    }
    const style = styleOf(r.meta, r.cls);
    const base: CurtainParams = {
      height,
      thickness,
      batter: spec.batter,
      merlonsKept: spec.merlonsKept,
      style,
      weather: 0.75,
      merlons: r.cls === 'castle' || style === 'ashlar' ? { w: 1.1, gap: 0.8, h: 1.3, depth: 0.7, cap: 0.45 } : undefined,
    };
    add(`km.${r.cls}`, total / 1000);

    /* Build the run; pieces that would still stand in a building (bandHits) open the wall there and it is rebuilt. */
    const extra: [number, number, boolean][] = [];
    for (let pass = 0; ; pass++) {
      const local: Record<string, number> = {};
      const addL = (k: string, v: number): void => {
        local[k] = (local[k] ?? 0) + v;
      };
      const out: Piece[] = [];
      const outCorr: number[][] = [];
      const outTowers = new Set<number>();
      const corr = (hw: number, pts: readonly V2[]): void => {
        corridor(hw, pts, outCorr);
      };
      /* Openings: mapped crossings, buildings on the line, water, fragment gaps. */
      const iv: Interval[] = [];
      for (const an of r.anchors) {
        if (an.b) {
          const p0 = project(r.pts, r.cum, an.a[0], an.a[1]);
          const p1 = project(r.pts, r.cum, an.b[0], an.b[1]);
          if (p0.d < 15 && p1.d < 15) {
            iv.push({ s0: Math.min(p0.s, p1.s), s1: Math.max(p0.s, p1.s), kind: an.kind });
          }
        } else {
          const pr = project(r.pts, r.cum, an.a[0], an.a[1]);
          if (pr.d < thickness + 5) {
            iv.push({ s0: pr.s - an.hw!, s1: pr.s + an.hw!, kind: an.kind });
          }
        }
      }
      for (const [s0, s1, road] of [...(fit?.blocked ?? []), ...extra]) {
        iv.push({ s0, s1, kind: road ? Opening.Road : Opening.Building });
        addL('buildings.breaks', 1);
        addL('buildings.breakMetres', s1 - s0);
      }
      let w0 = -1;
      for (let s = 0; s <= total + 0.5; s += 1) {
        const q = Math.min(s, total);
        const { p } = at(r.pts, r.cum, q);
        const wet = site.coast(p[0], p[1]) < WATER;
        if (wet && w0 < 0) {
          w0 = q;
        }
        if ((!wet || q >= total) && w0 >= 0) {
          iv.push({ s0: w0 - 0.5, s1: wet ? total : q, kind: Opening.Water });
          w0 = -1;
        }
      }
      if (supp) {
        let g0 = -1;
        for (let s = 0; s <= total; s += 1) {
          const gap = noise1(s / 45, seed + 3) < supp.gaps;
          if (gap && g0 < 0) {
            g0 = s;
          }
          if ((!gap || s + 1 > total) && g0 >= 0) {
            if (s - g0 >= 6) {
              iv.push({ s0: g0, s1: s, kind: FRAGMENT });
            }
            g0 = -1;
          }
        }
      }
      // Building openings keep their exact extent (the wall ends flush at the house); others merge across short piers.
      const openings = mergeIntervals(iv, 1).map((o) => ({ ...o, s0: Math.max(0, o.s0), s1: Math.min(total, o.s1) }));
      for (const o of openings) {
        addL(`openings.${o.kind}`, 1);
        addL(`openingMetres.${o.kind}`, o.s1 - o.s0);
      }

      /* Spans between openings, with their end styles. */
      const endAt = (s: number): boolean => {
        // A free run end meets another run or a tower: flush; otherwise the wall breaks off.
        const { p } = at(r.pts, r.cum, s);
        return runs.some((o) => o !== r && project(o.pts, o.cum, p[0], p[1]).d < 3) || r.towers.some((t) => Math.abs(t.s - s) < 6);
      };
      const freeEnd = (s: number): EndStyle => (r.closed || endAt(s) || ruin < 0.3 ? 'flush' : 'crumbled');
      type Span = { a: number; b: number; endA: EndStyle; endB: EndStyle };
      const spans: Span[] = [];
      let cur = 0;
      let curEnd: EndStyle = freeEnd(0);
      for (const o of openings) {
        if (o.s0 - cur > 0.01) {
          spans.push({ a: cur, b: o.s0, endA: curEnd, endB: endFor(o.kind) });
        }
        cur = o.s1;
        curEnd = endFor(o.kind);
      }
      if (total - cur > 0.01) {
        spans.push({ a: cur, b: total, endA: curEnd, endB: freeEnd(total) });
      }

      /* Gates: path openings, and road / rail openings at a mapped gate. */
      const gates: { a: number; b: number; p: GateParams }[] = [];
      for (let k = 0; k + 1 < spans.length; k++) {
        const A = spans[k];
        const B = spans[k + 1];
        const gap = B.a - A.b;
        const o = openings.find((q) => Math.abs(q.s0 - A.b) < 0.01);
        if (!o) {
          continue;
        }
        const c = (A.b + B.a) / 2;
        const cp = at(r.pts, r.cum, c).p;
        const mappedGate = data.gates.some((g) => Math.hypot(g.x - cp[0], g.z - cp[1]) < GATE_REACH) || r.towers.some((t) => t.t.gate && Math.hypot(t.t.x - cp[0], t.t.z - cp[1]) < GATE_REACH + 10);
        const pylons = r.towers.some((t) => t.t.gate && Math.hypot(t.t.x - cp[0], t.t.z - cp[1]) < 25);
        let width = 0;
        let towers = false;
        if (o.kind === Opening.Path && gap <= PATH_GATE_MAX) {
          width = Math.max(2.4, gap + 0.4);
        } else if ((o.kind === Opening.Road || o.kind === Opening.Rail) && gap < GATE_MAX_GAP && mappedGate) {
          width = Math.min(9, Math.max(3.5, gap + 0.8));
          towers = !pylons && r.cls !== 'castle';
        } else {
          continue;
        }
        const halfLen = width / 2 + 1.6 + 3;
        if (c - halfLen < A.a + 3 || c + halfLen > B.b - 3) {
          continue;
        }
        const tw = spec.tower;
        const gt = tAt(c - halfLen, c + halfLen);
        const gateTowers: TowerParams | null = towers ? { plan: 'square', width: tw.width * 0.85, projection: tw.projection * 0.8, height: height + tw.above * 0.8, wallThickness: gt, style, weather: 0.8 } : null;
        if (gateTowers && fp) {
          // Flanking towers (kit.ts gate): never in a building.
          const a = at(r.pts, r.cum, c - halfLen).p;
          const b = at(r.pts, r.cum, c + halfLen).p;
          const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
          const d: V2 = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
          const u0 = L / 2 - width / 2 - 1.6 - gateTowers.width / 2 + 0.5;
          const u1 = L / 2 + width / 2 + 1.6 + gateTowers.width / 2 - 0.5;
          const blockedT = [u0, u1].some((u) => outlineBlocked(towerOutline([a[0] + d[0] * u, a[1] + d[1] * u], d, gateTowers, CLEAR), fp, skip));
          if (blockedT) {
            towers = false;
            addL('towers.skippedInBuildings', 2);
          }
        }
        A.b = c - halfLen;
        A.endB = 'flush';
        B.a = c + halfLen;
        B.endA = 'flush';
        gates.push({
          a: c - halfLen,
          b: c + halfLen,
          p: {
            width,
            spring: Math.max(2.2, width * 0.85),
            wall: { ...base, thickness: gt, seed: seed + 900 + gates.length },
            towers: towers && gateTowers ? { plan: gateTowers.plan, width: gateTowers.width, projection: gateTowers.projection, height: gateTowers.height, style, weather: 0.8 } : null,
            doors: false,
          },
        });
      }

      /* Towers: mapped ones, then generated ones every `spacing` m away from openings, gates and mapped towers. */
      const inRoad = (s: number): boolean => openings.some((o) => o.kind !== Opening.Path && s > o.s0 && s < o.s1);
      type TowerAt = { s: number; piece: TowerPiece };
      const towersAt: TowerAt[] = [];
      /** Places a tower unless it would stand in a building: shrunk once, else skipped. */
      const placeTower = (s: number, piece: TowerPiece): boolean => {
        const reach = piece.p.width / 2 + piece.p.projection;
        if ((site.reservedTowers ?? []).some((t) => Math.hypot(t.x - piece.at[0], t.z - piece.at[1]) < t.r + reach)) {
          addL('towers.heritage', 1);
          return false;
        }
        if (fp && outlineBlocked(towerOutline(piece.at, piece.dir, piece.p, CLEAR), fp, skip)) {
          const small: TowerParams = { ...piece.p, width: piece.p.width * 0.75, projection: Math.max(1.2, piece.p.projection * 0.6), plan: 'square' };
          if (outlineBlocked(towerOutline(piece.at, piece.dir, small, CLEAR), fp, skip)) {
            addL('towers.skippedInBuildings', 1);
            return false;
          }
          piece.p = small;
          addL('towers.shrunkForBuildings', 1);
        }
        towersAt.push({ s, piece });
        return true;
      };
      for (const m of r.towers) {
        if (inRoad(m.s)) {
          continue;
        }
        const t = tangent(r.pts, r.cum, m.s);
        const n: V2 = [-t[1], t[0]];
        const axis = at(r.pts, r.cum, m.s).p;
        let u0 = Infinity;
        let u1 = -Infinity;
        let v1 = -Infinity;
        for (const q of m.ring) {
          const dx = q[0] - axis[0];
          const dz = q[1] - axis[1];
          const u = dx * t[0] + dz * t[1];
          const v = dx * n[0] + dz * n[1];
          u0 = Math.min(u0, u);
          u1 = Math.max(u1, u);
          v1 = Math.max(v1, v);
        }
        const width = Math.min(30, Math.max(4, u1 - u0));
        const uc = (u0 + u1) / 2;
        const s = Math.min(total, Math.max(0, m.s + uc));
        const p = at(r.pts, r.cum, s).p;
        const tr = m.t.ruined ? Math.max(0.45, ruin) : ruin * 0.8;
        const wt = tAt(s);
        const placed = placeTower(s, {
          kind: 'tower',
          src: m.t.id,
          at: p,
          dir: t,
          mapped: true,
          p: {
            plan: towerPlanOf(m.ring),
            width,
            projection: Math.min(20, Math.max(1.5, v1 - wt / 2)),
            height: m.t.h ?? height + spec.tower.above * Math.min(1.3, Math.max(0.7, width / spec.tower.width)),
            wallThickness: wt,
            ruin: Math.min(0.9, tr),
            style,
            weather: 0.8,
            seed: seed + 3000 + towersAt.length,
          },
        });
        if (placed) {
          outTowers.add(m.t.id);
        }
      }
      if (spec.spacing > 0) {
        const sp = spec.spacing;
        for (const span of spans) {
          const off = hash(seed, Math.round(span.a)) * sp * 0.5;
          for (let s = span.a + TOWER_CLEAR + off; s <= span.b - TOWER_CLEAR; s += sp * (0.85 + 0.3 * hash(seed + 5, Math.round(s)))) {
            const p = at(r.pts, r.cum, s).p;
            const crowded = runs.some((o) => o.towers.some((m) => Math.hypot(m.t.x - p[0], m.t.z - p[1]) < sp * 0.6)) || gates.some((g) => s > g.a - 12 && s < g.b + 12) || towersAt.some((q) => Math.abs(q.s - s) < sp * 0.6);
            if (crowded) {
              continue;
            }
            const hv = hash(seed + 11, Math.round(s));
            const plan: TowerPlan = r.cls === 'land-outer' || hv < 0.8 ? 'square' : PLANS[Math.floor(hash(seed + 13, Math.round(s)) * 3)];
            const tw = spec.tower;
            const k = 0.9 + 0.2 * hash(seed + 17, Math.round(s));
            placeTower(s, {
              kind: 'tower',
              src: r.id,
              at: p,
              dir: tangent(r.pts, r.cum, s),
              mapped: false,
              p: {
                plan,
                width: tw.width * k,
                projection: tw.projection * (plan === 'square' ? 1 : 0.8),
                height: height + tw.above * k,
                wallThickness: tAt(s),
                ruin: Math.min(0.9, ruin * (0.6 + 0.8 * hash(seed + 19, Math.round(s)))),
                style,
                weather: 0.8,
                seed: seed + 5000 + Math.round(s),
              },
            });
          }
        }
      }
      towersAt.sort((a, b) => a.s - b.s);
      for (const t of towersAt) {
        out.push(t.piece);
        addL(t.piece.mapped ? 'towers.mapped' : 'towers.generated', 1);
        const n: V2 = [-t.piece.dir[1], t.piece.dir[0]];
        const back = t.piece.p.wallThickness / 2;
        const front = back + t.piece.p.projection;
        corr(t.piece.p.width / 2 + CORRIDOR_GROW, [
          [t.piece.at[0] - n[0] * back, t.piece.at[1] - n[1] * back],
          [t.piece.at[0] + n[0] * front, t.piece.at[1] + n[1] * front],
        ]);
      }

      /* Gates. */
      for (const g of gates) {
        const a = at(r.pts, r.cum, g.a).p;
        const b = at(r.pts, r.cum, g.b).p;
        out.push({ kind: 'gate', src: r.id, a, b, p: g.p });
        addL('gates', 1);
        addL(g.p.towers ? 'gates.towered' : 'gates.passage', 1);
      }

      /* Curtains: every span cut at its towers and where the fitted thickness changes; sea foundations at the water. */
      const steps = fit ? thicknessSteps(fit) : [];
      let pieceNo = 0;
      for (const span of spans) {
        const inner = [...towersAt.map((t) => t.s), ...steps].filter((s) => s > span.a + 0.5 && s < span.b - 0.5).sort((a, b) => a - b);
        const cuts = [span.a, ...inner, span.b];
        const atTower = (s: number): boolean => towersAt.some((t) => Math.abs(t.s - s) < 1e-6);
        for (let k = 0; k + 1 < cuts.length; k++) {
          const a = cuts[k];
          const b = cuts[k + 1];
          if (b - a < (k === 0 && k + 1 === cuts.length - 1 ? 3 : 1)) {
            continue;
          }
          const pts = slice(r.pts, r.cum, a, b);
          const pr = hash(seed + 23, pieceNo);
          out.push({
            kind: 'curtain',
            src: r.id,
            pts,
            p: {
              ...base,
              thickness: tAt(a, b),
              ruin: Math.min(0.95, ruin * (0.7 + 0.6 * pr)),
              endA: k === 0 ? span.endA : 'flush',
              endB: k + 1 === cuts.length - 1 ? span.endB : 'flush',
              // Thickness steps are repairs, not breaks: keep the wall-walk level across them.
              seed: seed + 100 + (atTower(a) || k === 0 ? pieceNo : pieceNo - 1),
            },
          });
          pieceNo++;
          addL('km.placed', (b - a) / 1000);
          addL(`kmPlaced.${r.cls}`, (b - a) / 1000);
        }
        corr(tAt(span.a, span.b) / 2 + spec.batter + CORRIDOR_GROW, slice(r.pts, r.cum, span.a, span.b));
        // Sea foundation where the outer foot stands at the water (never into a building).
        let f0 = -1;
        for (let s = span.a; s <= span.b + 0.01; s += 2) {
          const q = Math.min(s, span.b);
          const { p } = at(r.pts, r.cum, q);
          const t = tangent(r.pts, r.cum, q);
          const off = tAt(q) / 2 + spec.batter + 1.5;
          const fx = p[0] - t[1] * off;
          const fz = p[1] + t[0] * off;
          const fx2 = p[0] - t[1] * (off + 6);
          const fz2 = p[1] + t[0] * (off + 6);
          const free = !fp || !outlineBlocked([[fx, fz], [fx2, fz2], [fx2 + t[0] * 2, fz2 + t[1] * 2], [fx + t[0] * 2, fz + t[1] * 2]], fp, skip);
          const wet = free && site.coast(fx, fz) < SEA_REACH && site.ground(fx, fz) < SEA_LOW;
          if (wet && f0 < 0) {
            f0 = q;
          }
          if ((!wet || q >= span.b) && f0 >= 0) {
            const f1 = q;
            if (f1 - f0 >= 6) {
              out.push({ kind: 'sea', src: r.id, pts: slice(r.pts, r.cum, f0, f1), p: { offset: tAt(f0, f1) / 2 + spec.batter * 0.5, steps: 3, seed: seed + 7000 + Math.round(f0) } });
              addL('seaFoundationMetres', f1 - f0);
            }
            f0 = -1;
          }
        }
      }
      for (const g of gates) {
        corr(g.p.wall.thickness / 2 + CORRIDOR_GROW, [at(r.pts, r.cum, g.a).p, at(r.pts, r.cum, g.b).p]);
      }

      const hits = fp && pass < 6 ? bandHits(out, fp, skip) : [];
      if (hits.length) {
        for (const h of hits) {
          const s = project(r.pts, r.cum, h[0], h[1]).s;
          extra.push([s - 0.6, s + 0.6, false]);
        }
        continue;
      }
      pieces.push(...out);
      corridors.push(...outCorr);
      for (const [k, v] of Object.entries(local)) {
        add(k, v);
      }
      add('buildings.verifyPasses', pass);
      for (const id of outTowers) {
        placedTowers.add(id);
      }
      if (pieceNo > 0 || gates.length) {
        drawnIds.add(r.id);
      }
      break;
    }
  }

  for (const id of placedTowers) {
    drawnIds.add(id);
  }
  stats.runs = runs.length;
  let overlap: OverlapReport | null = null;
  if (fp) {
    overlap = wallOverlaps(pieces, fp, skip, (src) => stretchOf.get(src) ?? String(src));
    stats['check.overlapMetres'] = overlap.metres;
    stats['check.overlapCount'] = overlap.count;
    stats['check.roadMetres'] = overlap.roadMetres;
  }
  for (const k of Object.keys(stats)) {
    stats[k] = Math.round(stats[k] * 100) / 100;
  }
  const ownedOut = [...owned].filter((id) => drawnIds.has(id));
  return { pieces, owned: [...new Set([...ownedOut, ...displaced.keys()])].sort((a, b) => a - b), corridors, stats, overlap };
}
