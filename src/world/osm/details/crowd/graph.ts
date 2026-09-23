/**
 * Pedestrian walk network (worker side). Lanes follow where people really walk in the slice:
 * - both sidewalks of asphalt streets (unless OSM maps them as separate footways),
 * - the whole width of cobbled lanes (Galata / Cihangir have no sidewalks) and of granite pedestrian streets
 *   (İstiklal is split into parallel lanes across its 15 m),
 * - footways, paths, steps and crossing ways; the Galata Bridge walkways follow the structures module's deck frame
 *   (their heights are resolved on the main thread, see waterfront/bridge.ts),
 * - synthetic zebra crossings at highway=crossing nodes, and wander graphs across squares (Eminönü).
 * Lane ends are linked to the nearest vertex of another lane when the link does not cross a carriageway or a
 * building. Every edge carries the desired density (people per metre) of its lane, from its class and the density of
 * shops, cafés and sights around it.
 */
import type { OsmData, OsmRoad } from '../../data';
import { BoxGrid, hash, pointInRing, segDist } from '../../shared/geometry';
import { Surf, classifyStreets } from '../../shared/street-field';
import type { StreetSurface } from '../../shared/street-surface';
import { Zone } from '../../shared/street-surface';
import { LotStyle, type CoverBuild } from '../cover/cover';
import { VERT_STRIDE, type DeckFrame, type WalkGraph } from '../protocol';

/** Lane classes (density and linking rules). */
const Lane = { Sidewalk: 0, Street: 1, Plaza: 2, Footway: 3, Steps: 4, Bridge: 5, Crossing: 6, Square: 7 } as const;
type LaneKind = (typeof Lane)[keyof typeof Lane];

interface LaneDef {
  kind: LaneKind;
  pts: number[];
  /** Offset of the lane from `pts` (m, along the left normal). */
  offset: number;
  hw: number;
  density: number;
  /** Named İstiklal lanes get the crowd of a Saturday afternoon. */
  busy?: boolean;
}

/** Walkability tests shared by the lane builders. */
export interface WalkContext {
  surface: StreetSurface;
  /** Ground cover build: building distance, lots (plaza lots get wander graphs). */
  cover: CoverBuild;
  area: { minX: number; maxX: number; minZ: number; maxZ: number };
  pads: readonly number[];
  /** Shop / café / sight density in [0, 1.5] (poiDensity()). */
  poi: (x: number, z: number) => number;
  /** Galata Bridge deck (OSM ways on it are replaced by lanes along the modelled walkways). */
  deck: DeckFrame | null;
  /** Tree trunks (x, z pairs): links across squares and plaza lots keep clear of them. */
  trunks: Float32Array;
}

/** Offsets (m off the deck axis) and half width of the walker lanes on the Galata Bridge walkways (11.4-21 m). */
const DECK_LANE = 15.4;
const DECK_LANE_HW = 2.6;

/** The point lies on the modelled deck (with a 3 m margin). */
function onDeck(deck: DeckFrame | null, x: number, z: number): boolean {
  if (!deck) {
    return false;
  }
  const dx = x - deck.ox;
  const dz = z - deck.oz;
  const s = dx * deck.ax + dz * deck.az;
  return s > deck.s0 - 3 && s < deck.s1 + 3 && Math.abs(-dx * deck.az + dz * deck.ax) < 24;
}

const MAX_SEG = 9;
const AREA_MARGIN = 26;

function wallClear(ctx: WalkContext, x: number, z: number, clearance: number): boolean {
  const k = ctx.cover.grid.index(x, z);
  return k >= 0 && ctx.cover.buildingDist[k] / 10 >= clearance;
}

function inArea(ctx: WalkContext, x: number, z: number): boolean {
  const a = ctx.area;
  return x > a.minX + AREA_MARGIN && x < a.maxX - AREA_MARGIN && z > a.minZ + AREA_MARGIN && z < a.maxZ - AREA_MARGIN;
}

function onPad(ctx: WalkContext, x: number, z: number): boolean {
  const p = ctx.pads;
  for (let k = 0; k < p.length; k += 3) {
    const r = p[k + 2] * 0.72;
    if ((x - p[k]) ** 2 + (z - p[k + 1]) ** 2 < r * r) {
      return true;
    }
  }
  return false;
}

/** Shop / amenity / sight density around each point: counts within ~70 m, normalised to [0, 1.5]. */
export function poiDensity(points: OsmData['points'], area: WalkContext['area']): (x: number, z: number) => number {
  const cell = 35;
  const w = Math.ceil((area.maxX - area.minX) / cell) + 1;
  const h = Math.ceil((area.maxZ - area.minZ) / cell) + 1;
  const counts = new Float32Array(w * h);
  for (const p of points) {
    if (!/^(shop|amenity=(restaurant|cafe|fast_food|bar|pub|ice_cream|bank|pharmacy)|tourism)/.test(p.kind)) {
      continue;
    }
    const i = Math.floor((p.x - area.minX) / cell);
    const j = Math.floor((p.z - area.minZ) / cell);
    if (i >= 0 && j >= 0 && i < w && j < h) {
      counts[j * w + i]++;
    }
  }
  const blur = new Float32Array(w * h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      let s = 0;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const ii = i + di;
          const jj = j + dj;
          if (ii >= 0 && jj >= 0 && ii < w && jj < h) {
            s += counts[jj * w + ii] * (di === 0 && dj === 0 ? 1 : 0.6);
          }
        }
      }
      blur[j * w + i] = Math.min(1.5, s / 30);
    }
  }
  return (x, z) => {
    const i = Math.min(w - 1, Math.max(0, Math.floor((x - area.minX) / cell)));
    const j = Math.min(h - 1, Math.max(0, Math.floor((z - area.minZ) / cell)));
    return blur[j * w + i];
  };
}

/** Lanes of the street network (sidewalks, cobbled lanes, pedestrian streets) and of footways / steps / bridges. */
function laneDefs(data: Pick<OsmData, 'roads'>, ctx: WalkContext): LaneDef[] {
  const out: LaneDef[] = [];
  for (const s of classifyStreets(data.roads)) {
    const road = data.roads[s.road];
    const mid = s.pts.length >> 2 << 1;
    const poi = ctx.poi(s.pts[mid], s.pts[mid + 1]);
    const istiklal = !!s.name && /stiklal/i.test(s.name);
    if (s.surf === Surf.Asphalt) {
      if (road.sidewalk === 'no' || road.sidewalk === 'separate' || s.sidewalk <= 0) {
        continue;
      }
      const density = s.rank >= 3 ? 0.018 + 0.05 * poi : 0.01 + 0.04 * poi;
      const hw = Math.max(0.3, s.sidewalk / 2 - 0.45);
      const off = s.hw + s.sidewalk / 2;
      if (road.sidewalk !== 'right') {
        out.push({ kind: Lane.Sidewalk, pts: s.pts, offset: off, hw, density });
      }
      if (road.sidewalk !== 'left') {
        out.push({ kind: Lane.Sidewalk, pts: s.pts, offset: -off, hw, density });
      }
    } else if (s.surf === Surf.Granite) {
      const n = Math.min(6, Math.max(1, Math.round((s.hw * 2) / 3)));
      const lw = (s.hw * 2) / n;
      const density = istiklal ? 0.3 : 0.025 + 0.07 * poi;
      for (let k = 0; k < n; k++) {
        out.push({ kind: Lane.Plaza, pts: s.pts, offset: -s.hw + lw * (k + 0.5), hw: Math.max(0.3, lw / 2 - 0.15), density, busy: istiklal });
      }
    } else {
      out.push({ kind: Lane.Street, pts: s.pts, offset: 0, hw: Math.max(0.4, s.hw - 0.45), density: 0.006 + 0.05 * poi });
    }
  }
  for (const r of data.roads) {
    const lane = footLane(r, ctx);
    if (lane) {
      out.push(lane);
    }
  }
  return out;
}

function footLane(r: OsmRoad, ctx: WalkContext): LaneDef | null {
  if (r.tunnel || r.pts.length < 4) {
    return null;
  }
  const foot = r.kind === 'footway' || r.kind === 'path' || r.kind === 'steps' || (r.kind === 'pedestrian' && r.bridge);
  if (!foot) {
    return null;
  }
  const mid = r.pts.length >> 2 << 1;
  const poi = ctx.poi(r.pts[mid], r.pts[mid + 1]);
  const hw = Math.max(0.3, Math.min(2.5, r.width / 2 - 0.3));
  if (r.bridge && onDeck(ctx.deck, r.pts[mid], r.pts[mid + 1])) {
    return null;
  }
  if (r.bridge) {
    return { kind: Lane.Bridge, pts: r.pts, offset: 0, hw, density: /Galata/i.test(r.name ?? '') || r.width >= 3 ? 0.07 : 0.03 };
  }
  if (r.kind === 'steps') {
    return { kind: Lane.Steps, pts: r.pts, offset: 0, hw, density: 0.004 + 0.02 * poi };
  }
  if (r.footway === 'crossing') {
    return { kind: Lane.Crossing, pts: r.pts, offset: 0, hw: Math.max(hw, 0.8), density: 0.02 };
  }
  const sidewalk = r.footway === 'sidewalk';
  return { kind: sidewalk ? Lane.Sidewalk : Lane.Footway, pts: r.pts, offset: 0, hw, density: sidewalk ? 0.015 + 0.05 * poi : 0.006 + 0.035 * poi };
}

/** Growable graph under construction. */
class GraphBuilder {
  readonly v: number[] = [];
  readonly edges: number[] = [];
  readonly ew: number[] = [];
  readonly kind: number[] = [];
  readonly grid = new BoxGrid(6);

  vertex(x: number, y: number, z: number, nx: number, nz: number, hw: number, kind: LaneKind): number {
    const id = this.v.length / VERT_STRIDE;
    this.v.push(x, y, z, nx, nz, hw);
    this.kind.push(kind);
    this.grid.add(id, x, z, x, z);
    return id;
  }

  edge(a: number, b: number, w: number): void {
    this.edges.push(a, b);
    this.ew.push(w);
  }

  x(id: number): number {
    return this.v[id * VERT_STRIDE];
  }

  z(id: number): number {
    return this.v[id * VERT_STRIDE + 2];
  }

  /** Nearest vertex to (x, z) within `r` passing `ok`. */
  nearest(x: number, z: number, r: number, ok: (id: number) => boolean): number {
    let best = -1;
    let bd = r * r;
    const cells = Math.ceil(r / 6);
    for (let dj = -cells; dj <= cells; dj++) {
      for (let di = -cells; di <= cells; di++) {
        for (const id of this.grid.at(x + di * 6, z + dj * 6)) {
          const d = (this.x(id) - x) ** 2 + (this.z(id) - z) ** 2;
          if (d < bd && ok(id)) {
            bd = d;
            best = id;
          }
        }
      }
    }
    return best;
  }

  build(): WalkGraph {
    const n = this.v.length / VERT_STRIDE;
    const deg = new Uint32Array(n + 1);
    for (let e = 0; e < this.edges.length; e += 2) {
      deg[this.edges[e]]++;
      deg[this.edges[e + 1]]++;
    }
    const start = new Uint32Array(n + 1);
    for (let i = 0; i < n; i++) {
      start[i + 1] = start[i] + deg[i];
    }
    const fill = start.slice(0, n);
    const nbr = new Uint32Array(start[n]);
    const weight = new Float32Array(start[n]);
    for (let e = 0; e < this.edges.length; e += 2) {
      const a = this.edges[e];
      const b = this.edges[e + 1];
      const w = this.ew[e >> 1];
      nbr[fill[a]] = b;
      weight[fill[a]++] = w;
      nbr[fill[b]] = a;
      weight[fill[b]++] = w;
    }
    return { verts: Float32Array.from(this.v), start, nbr, weight };
  }
}

/** Offsets a polyline by `offset` along its left normal (miter joins) and resamples it to <= MAX_SEG m. */
function offsetLane(pts: readonly number[], offset: number): { xs: number[]; nx: number[] } {
  const n = pts.length / 2;
  const xs: number[] = [];
  const nx: number[] = [];
  const nrm = (k: number): [number, number] => {
    const a = Math.max(0, k - 1);
    const b = Math.min(n - 1, k + 1);
    let tx = 0;
    let tz = 0;
    if (k > 0) {
      const l = Math.hypot(pts[k * 2] - pts[a * 2], pts[k * 2 + 1] - pts[a * 2 + 1]) || 1;
      tx += (pts[k * 2] - pts[a * 2]) / l;
      tz += (pts[k * 2 + 1] - pts[a * 2 + 1]) / l;
    }
    if (k < n - 1) {
      const l = Math.hypot(pts[b * 2] - pts[k * 2], pts[b * 2 + 1] - pts[k * 2 + 1]) || 1;
      tx += (pts[b * 2] - pts[k * 2]) / l;
      tz += (pts[b * 2 + 1] - pts[k * 2 + 1]) / l;
    }
    const l = Math.hypot(tx, tz) || 1;
    return [tz / l, -tx / l];
  };
  const miter = (k: number): number => {
    if (k === 0 || k === n - 1) {
      return 1;
    }
    const ax = pts[k * 2] - pts[k * 2 - 2];
    const az = pts[k * 2 + 1] - pts[k * 2 - 1];
    const bx = pts[k * 2 + 2] - pts[k * 2];
    const bz = pts[k * 2 + 3] - pts[k * 2 + 1];
    const c = (ax * bx + az * bz) / ((Math.hypot(ax, az) || 1) * (Math.hypot(bx, bz) || 1));
    return Math.min(2, 1 / Math.max(0.5, Math.sqrt((1 + c) / 2)));
  };
  for (let k = 0; k < n; k++) {
    const [ux, uz] = nrm(k);
    const m = miter(k) * offset;
    const px = pts[k * 2] + ux * m;
    const pz = pts[k * 2 + 1] + uz * m;
    if (k > 0) {
      const qx = xs[xs.length - 2];
      const qz = xs[xs.length - 1];
      const len = Math.hypot(px - qx, pz - qz);
      const steps = Math.ceil(len / MAX_SEG);
      const [vx, vz] = [nx[nx.length - 2], nx[nx.length - 1]];
      for (let s = 1; s < steps; s++) {
        const f = s / steps;
        xs.push(qx + (px - qx) * f, qz + (pz - qz) * f);
        const ix = vx + (ux - vx) * f;
        const iz = vz + (uz - vz) * f;
        const il = Math.hypot(ix, iz) || 1;
        nx.push(ix / il, iz / il);
      }
    }
    xs.push(px, pz);
    nx.push(ux, uz);
  }
  return { xs, nx };
}

/**
 * Checks that a straight link a -> b stays off carriageways (unless `crossing`), out of buildings and water, and
 * (with `trunks`) at least 0.9 m from tree trunks.
 */
function linkClear(ctx: WalkContext, ax: number, az: number, bx: number, bz: number, crossing: boolean, trunks?: TrunkIndex): boolean {
  const len = Math.hypot(bx - ax, bz - az);
  const steps = Math.max(2, Math.ceil(len / 1.5));
  if (trunks && trunks.near(ax, az, bx, bz, 0.9)) {
    return false;
  }
  for (let s = 1; s < steps; s++) {
    const x = ax + ((bx - ax) * s) / steps;
    const z = az + ((bz - az) * s) / steps;
    if (!wallClear(ctx, x, z, 0.2) || ctx.surface.geo.coast(x, z) < 0.5) {
      return false;
    }
    if (!crossing && ctx.surface.zone(x, z) === Zone.Carriageway) {
      return false;
    }
  }
  return true;
}

/** Tree trunks in a coarse grid, for segment clearance tests. */
class TrunkIndex {
  private readonly grid = new BoxGrid(8);

  constructor(private readonly pts: Float32Array) {
    for (let k = 0; k < pts.length; k += 2) {
      this.grid.add(k >> 1, pts[k], pts[k + 1], pts[k], pts[k + 1]);
    }
  }

  /** Some trunk lies within `r` of the segment a -> b. */
  near(ax: number, az: number, bx: number, bz: number, r: number): boolean {
    const x0 = Math.min(ax, bx) - r;
    const x1 = Math.max(ax, bx) + r;
    const z0 = Math.min(az, bz) - r;
    const z1 = Math.max(az, bz) + r;
    for (let z = Math.floor(z0 / 8) * 8; z <= z1 + 8; z += 8) {
      for (let x = Math.floor(x0 / 8) * 8; x <= x1 + 8; x += 8) {
        for (const id of this.grid.at(x, z)) {
          const px = this.pts[id * 2];
          const pz = this.pts[id * 2 + 1];
          if (px >= x0 && px <= x1 && pz >= z0 && pz <= z1 && segDist(px, pz, ax, az, bx, bz) < r) {
            return true;
          }
        }
      }
    }
    return false;
  }
}

/** Link check for the deck ends: only buildings block (the abutments are over the quay edge and kerbs). */
function wallLinkClear(ctx: WalkContext, ax: number, az: number, bx: number, bz: number): boolean {
  const steps = Math.max(2, Math.ceil(Math.hypot(bx - ax, bz - az) / 1.5));
  for (let s = 1; s < steps; s++) {
    if (!wallClear(ctx, ax + ((bx - ax) * s) / steps, az + ((bz - az) * s) / steps, 0.2)) {
      return false;
    }
  }
  return true;
}

export interface WalkBuild {
  graph: WalkGraph;
  lanes: number;
  vertices: number;
  crossings: number;
  squares: number;
}

export function buildWalkGraph(data: Pick<OsmData, 'roads' | 'points' | 'areas'>, ctx: WalkContext): WalkBuild {
  const g = new GraphBuilder();
  const surface = ctx.surface;
  const ends: number[] = [];
  const laneOf: number[] = [];
  let laneCount = 0;
  let run = 0;
  const defs = laneDefs(data, ctx);
  const deck = ctx.deck;
  if (deck) {
    for (const side of [1, -1]) {
      const pts: number[] = [];
      for (const s of [deck.s0 + 1.5, deck.s1 - 1.5]) {
        pts.push(deck.ox + deck.ax * s - deck.az * DECK_LANE * side, deck.oz + deck.az * s + deck.ax * DECK_LANE * side);
      }
      defs.push({ kind: Lane.Bridge, pts, offset: 0, hw: DECK_LANE_HW, density: 0.16 });
    }
  }
  for (const def of defs) {
    const { xs, nx } = offsetLane(def.pts, def.offset);
    const bridge = def.kind === Lane.Bridge;
    let prev = -1;
    let runStart = -1;
    let runLen = 0;
    const closeRun = (): void => {
      if (prev >= 0 && runStart >= 0 && runLen >= 6) {
        ends.push(runStart, prev);
        laneCount++;
      }
      prev = -1;
      runStart = -1;
      runLen = 0;
    };
    for (let k = 0; k < xs.length; k += 2) {
      const x = xs[k];
      const z = xs[k + 1];
      let ok = inArea(ctx, x, z) && !onPad(ctx, x, z);
      if (ok && !bridge) {
        ok = surface.geo.coast(x, z) > 0.8 && wallClear(ctx, x, z, def.kind === Lane.Sidewalk ? 0.35 : 0.2);
        if (ok && def.kind === Lane.Sidewalk) {
          ok = surface.distance(x, z) > 0.2;
        }
      }
      if (!ok) {
        closeRun();
        continue;
      }
      const y = bridge ? NaN : surface.heightAt(x, z);
      if (prev < 0) {
        run++;
      }
      const id = g.vertex(x, y, z, nx[k], nx[k + 1], def.hw, def.kind);
      laneOf[id] = run;
      if (prev >= 0) {
        const len = Math.hypot(x - g.x(prev), z - g.z(prev));
        g.edge(prev, id, def.density);
        runLen += len;
      } else {
        runStart = id;
      }
      prev = id;
    }
    closeRun();
  }
  // Link lane ends to the nearest vertex of another lane.
  for (let e = 0; e < ends.length; e++) {
    const a = ends[e];
    const ax = g.x(a);
    const az = g.z(a);
    const crossing = g.kind[a] === Lane.Crossing;
    const deckEnd = g.kind[a] === Lane.Bridge && onDeck(deck, ax, az);
    const b = deckEnd
      ? g.nearest(ax, az, 24, (id) => laneOf[id] !== laneOf[a] && !onDeck(deck, g.x(id), g.z(id)) && wallLinkClear(ctx, ax, az, g.x(id), g.z(id)))
      : g.nearest(ax, az, crossing ? 5 : 6.5, (id) => laneOf[id] !== laneOf[a] && linkClear(ctx, ax, az, g.x(id), g.z(id), crossing || g.kind[id] === Lane.Crossing));
    if (b >= 0) {
      g.edge(a, b, 0.02);
    }
  }
  const crossings = syntheticCrossings(data, ctx, g, laneOf);
  const squares = squareGraphs(data, ctx, g, laneOf, new TrunkIndex(ctx.trunks));
  const graph = g.build();
  return { graph, lanes: laneCount, vertices: graph.verts.length / VERT_STRIDE, crossings, squares };
}

/** Zebra crossings at highway=crossing nodes of carriageways that have no mapped crossing way. */
function syntheticCrossings(data: Pick<OsmData, 'roads' | 'points'>, ctx: WalkContext, g: GraphBuilder, laneOf: number[]): number {
  const streets = new Map<number, ReturnType<typeof classifyStreets>[number]>();
  for (const s of classifyStreets(data.roads)) {
    streets.set(s.road, s);
  }
  let count = 0;
  for (const p of data.points) {
    if (p.kind !== 'highway=crossing' || !p.roads || !inArea(ctx, p.x, p.z)) {
      continue;
    }
    if (p.roads.some((r) => data.roads[r].footway === 'crossing' || data.roads[r].kind === 'footway')) {
      continue;
    }
    const s = p.roads.map((r) => streets.get(r)).find((st) => st && st.surf === Surf.Asphalt);
    if (!s) {
      continue;
    }
    let tx = 1;
    let tz = 0;
    let best = Infinity;
    for (let k = 2; k < s.pts.length; k += 2) {
      const d = segDist(p.x, p.z, s.pts[k - 2], s.pts[k - 1], s.pts[k], s.pts[k + 1]);
      if (d < best) {
        best = d;
        tx = s.pts[k] - s.pts[k - 2];
        tz = s.pts[k + 1] - s.pts[k - 1];
      }
    }
    const tl = Math.hypot(tx, tz) || 1;
    const nx = tz / tl;
    const nz = -tx / tl;
    const reach = s.hw + Math.max(1, s.sidewalk * 0.5);
    const ax = p.x + nx * reach;
    const az = p.z + nz * reach;
    const bx = p.x - nx * reach;
    const bz = p.z - nz * reach;
    const side = (x: number, z: number): number => g.nearest(x, z, 4, (id) => g.kind[id] === Lane.Sidewalk || g.kind[id] === Lane.Footway);
    const va = side(ax, az);
    const vb = side(bx, bz);
    if (va < 0 || vb < 0 || laneOf[va] === laneOf[vb]) {
      continue;
    }
    const lane = -1000 - count;
    const tpx = tx / tl;
    const tpz = tz / tl;
    const ids = [ax, az, p.x, p.z, bx, bz].reduce<number[]>((acc, _, k, arr) => {
      if (k % 2 === 0) {
        const id = g.vertex(arr[k], ctx.surface.heightAt(arr[k], arr[k + 1]), arr[k + 1], tpx, tpz, 1.1, Lane.Crossing);
        laneOf[id] = lane;
        acc.push(id);
      }
      return acc;
    }, []);
    g.edge(va, ids[0], 0.02);
    g.edge(ids[0], ids[1], 0.02);
    g.edge(ids[1], ids[2], 0.02);
    g.edge(ids[2], vb, 0.02);
    count++;
  }
  return count;
}

/**
 * Wander graphs over open paved space: mapped squares, pedestrian areas, ferry terminals and piers, and the unmapped
 * plaza lots of the cover pass (cover/cover.ts LotStyle.Plaza). Jittered sample points are linked to their visible
 * neighbours and to the nearest lane. A 7 m lattice with up to four links per point carries ~0.7 m of edge per m², so
 * an edge density d gives about 0.7 d people per m².
 */
function squareGraphs(data: Pick<OsmData, 'areas' | 'points'>, ctx: WalkContext, g: GraphBuilder, laneOf: number[], trunks: TrunkIndex): number {
  let squares = 0;
  const step = 7;
  for (const a of data.areas) {
    const square = a.kind === 'place=square' || a.kind === 'highway=pedestrian' || a.kind === 'amenity=ferry_terminal' || (a.kind === 'man_made=pier' && (a.layer ?? 0) === 0);
    if (!square || (a.layer ?? 0) < 0) {
      continue;
    }
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (let k = 0; k < a.ring.length; k += 2) {
      x0 = Math.min(x0, a.ring[k]);
      x1 = Math.max(x1, a.ring[k]);
      z0 = Math.min(z0, a.ring[k + 1]);
      z1 = Math.max(z1, a.ring[k + 1]);
    }
    const busy = /Eminönü/i.test(a.name ?? '');
    const density = busy ? 0.1 : 0.018 + 0.04 * ctx.poi((x0 + x1) / 2, (z0 + z1) / 2);
    const cand: number[] = [];
    for (let z = z0 + step / 2; z < z1; z += step) {
      for (let x = x0 + step / 2; x < x1; x += step) {
        const px = x + (hash(x * 1.7 + z) - 0.5) * step * 0.8;
        const pz = z + (hash(z * 1.3 - x) - 0.5) * step * 0.8;
        if (pointInRing(a.ring, px, pz)) {
          cand.push(px, pz);
        }
      }
    }
    if (wander(ctx, g, laneOf, cand, density, -100000 - squares, trunks)) {
      squares++;
    }
  }
  const { grid, lots, lotOf } = ctx.cover;
  lots.forEach((lot, id) => {
    if (lot.style !== LotStyle.Plaza) {
      return;
    }
    const water = ctx.surface.geo.coast(lot.cx, lot.cz) < 60 ? 0.015 : 0;
    const density = 0.01 + 0.03 * ctx.poi(lot.cx, lot.cz) + water;
    const cand: number[] = [];
    for (const k of lot.cells) {
      const i = k % grid.w;
      const j = (k - i) / grid.w;
      if (i % step !== 0 || j % step !== 0) {
        continue;
      }
      const px = grid.cx(i) + (hash(i * 1.7 + j) - 0.5) * step * 0.8;
      const pz = grid.cz(j) + (hash(j * 1.3 - i) - 0.5) * step * 0.8;
      if (lotOf[grid.index(px, pz)] === id) {
        cand.push(px, pz);
      }
    }
    if (wander(ctx, g, laneOf, cand, density, -100000 - squares, trunks)) {
      squares++;
    }
  });
  return squares;
}

/** One wander graph from candidate points (x, z pairs); returns false when too few points are walkable. */
function wander(ctx: WalkContext, g: GraphBuilder, laneOf: number[], cand: readonly number[], density: number, lane: number, trunks: TrunkIndex): boolean {
  const pts: number[] = [];
  for (let k = 0; k < cand.length; k += 2) {
    const px = cand[k];
    const pz = cand[k + 1];
    if (!inArea(ctx, px, pz) || onPad(ctx, px, pz) || !wallClear(ctx, px, pz, 1) || ctx.surface.geo.coast(px, pz) < 1 || ctx.surface.zone(px, pz) === Zone.Carriageway || trunks.near(px, pz, px, pz, 1.2)) {
      continue;
    }
    const id = g.vertex(px, ctx.surface.heightAt(px, pz), pz, 1, 0, 1.4, Lane.Square);
    laneOf[id] = lane;
    pts.push(id);
  }
  if (pts.length < 3) {
    return false;
  }
  for (const id of pts) {
    const x = g.x(id);
    const z = g.z(id);
    const cands = pts
      .filter((o) => o !== id)
      .map((o) => ({ o, d: (g.x(o) - x) ** 2 + (g.z(o) - z) ** 2 }))
      .filter((c) => c.d < 24 * 24)
      .sort((p, q) => p.d - q.d)
      .slice(0, 8);
    let links = 0;
    for (const c of cands) {
      if (c.o < id || links >= 4) {
        continue;
      }
      if (linkClear(ctx, x, z, g.x(c.o), g.z(c.o), false, trunks)) {
        g.edge(id, c.o, density);
        links++;
      }
    }
    const near = g.nearest(x, z, 6, (o) => laneOf[o] !== lane && linkClear(ctx, x, z, g.x(o), g.z(o), false, trunks));
    if (near >= 0) {
      g.edge(id, near, Math.min(density, 0.05));
    }
  }
  return true;
}
