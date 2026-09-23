/**
 * Street-layer pass over the runtime walk graph (src/world/osm/details/crowd/graph.ts). The runtime graph is built for
 * crowds seen from the air and is split into hundreds of fragments; a walkable street needs one network. This pass
 * runs in the compiler only (the flight slice keeps the runtime graph as it is):
 *
 * 1. Coincident vertices (shared OSM nodes of two lanes) become one vertex.
 * 2. Footways, sidewalks, steps and crossing ways are re-walked at the runtime sampling. Samples the runtime dropped
 *    (mapped sidewalks inside the carriageway raster, which is wider than the real road) are pushed onto the raised
 *    pavement and added back; samples at a shared OSM node map to one vertex, so mapped crossings join their sidewalks.
 * 3. Streets the runtime gives no lanes (asphalt pedestrian / living streets and service roads, e.g. Bahariye south of
 *    Nail Bey Sk) get full-width lanes.
 * 4. Lane ends are linked to the nearest vertex of another lane within LINK_RADIUS (off carriageways).
 * 5. Crossings: highway=crossing nodes without a crossing way, and every arm of a junction on streets with pavement on
 *    both sides, get a kerb-to-kerb crossing.
 * 6. Remaining fragments are joined by the shortest clear links (Kruskal over vertex pairs within 12 m, then 25 m),
 *    links that stay off carriageways first. Links never pass through buildings or water.
 */
import type { CoverBuild } from '../../../src/world/osm/details/cover/cover';
import { VERT_STRIDE, type WalkGraph } from '../../../src/world/osm/details/protocol';
import type { OsmData, OsmRoad } from '../../../src/world/osm/data';
import { segDist } from '../../../src/world/osm/shared/geometry';
import { classifyStreets, type Street, Surf } from '../../../src/world/osm/shared/street-field';
import { type StreetSurface, Zone } from '../../../src/world/osm/shared/street-surface';

/** Vertex classes (crowd/graph.ts Lane, plus Unknown for runtime vertices of street lanes and squares). */
const Kind = { Unknown: -1, Sidewalk: 0, Street: 1, Plaza: 2, Footway: 3, Steps: 4, Crossing: 6 } as const;

const MAX_SEG = 9;
const MERGE_RADIUS = 0.05;
const LINK_RADIUS = 8;
const CROSSING_LINK_RADIUS = 5;
/** Stitch rounds (m): short links first, then a wider round for fragments the first could not reach. */
const STITCH_RADII = [12, 25];
const LINK_DENSITY = 0.02;
const CELL = 4;

export interface NetworkStats {
  merged: number;
  healed: number;
  addedLanes: number;
  endLinks: number;
  /**
   * mapped: footway=crossing ways; footways: sidewalk / footway ways that cross a kerbed street (kept on the road);
   * nodes / junctions: synthesised at highway=crossing nodes without a foot way and across junction arms; nodesServed:
   * highway=crossing nodes in the rect with a crossing vertex within 3 m, of nodesInRect; nodesOnLane: the others that
   * sit on a lane (streets walked at full width, where no kerb-to-kerb crossing is needed).
   */
  crossings: { mapped: number; footways: number; nodes: number; junctions: number; nodesServed: number; nodesOnLane: number; nodesInRect: number };
  stitched: { offRoad: number; acrossRoad: number };
  components: number;
  largest: number;
  largestShare: number;
  isolated: number;
}

export interface WalkNetwork {
  x: number[];
  z: number[];
  hw: number[];
  /** Walking direction (unit x, z) per vertex. */
  dx: number[];
  dz: number[];
  /** Undirected edges [a, b, ...] (a < b) and their density. */
  edges: number[];
  density: number[];
  stats: NetworkStats;
}

export interface NetworkContext {
  surface: StreetSurface;
  cover: CoverBuild;
  /** Tile-aligned build rect: vertices stay strictly inside it (like the runtime builder's area). */
  rect: { minX: number; maxX: number; minZ: number; maxZ: number };
  poi: (x: number, z: number) => number;
}

class Net {
  readonly x: number[] = [];
  readonly z: number[] = [];
  readonly hw: number[] = [];
  readonly dx: number[] = [];
  readonly dz: number[] = [];
  readonly kind: number[] = [];
  readonly adj: Map<number, number>[] = [];
  private readonly cells = new Map<number, number[]>();

  get count(): number {
    return this.x.length;
  }

  private key(x: number, z: number): number {
    return (Math.floor(x / CELL) + 32768) * 65536 + (Math.floor(z / CELL) + 32768);
  }

  add(x: number, z: number, hw: number, dx: number, dz: number, kind: number): number {
    const id = this.x.length;
    this.x.push(x);
    this.z.push(z);
    this.hw.push(hw);
    const l = Math.hypot(dx, dz) || 1;
    this.dx.push(dx / l);
    this.dz.push(dz / l);
    this.kind.push(kind);
    this.adj.push(new Map());
    const k = this.key(x, z);
    const list = this.cells.get(k);
    if (list) {
      list.push(id);
    } else {
      this.cells.set(k, [id]);
    }
    return id;
  }

  /** Vertices within `r` of (x, z), nearest first. */
  near(x: number, z: number, r: number): number[] {
    const out: { id: number; d: number }[] = [];
    const c = Math.ceil(r / CELL);
    const ci = Math.floor(x / CELL);
    const cj = Math.floor(z / CELL);
    for (let dj = -c; dj <= c; dj++) {
      for (let di = -c; di <= c; di++) {
        for (const id of this.cells.get((ci + di + 32768) * 65536 + (cj + dj + 32768)) ?? []) {
          const d = Math.hypot(this.x[id] - x, this.z[id] - z);
          if (d <= r) {
            out.push({ id, d });
          }
        }
      }
    }
    return out.sort((a, b) => a.d - b.d || a.id - b.id).map((o) => o.id);
  }

  find(x: number, z: number, r: number): number {
    return this.near(x, z, r)[0] ?? -1;
  }

  link(a: number, b: number, density: number): boolean {
    if (a === b || this.adj[a].has(b)) {
      return false;
    }
    this.adj[a].set(b, density);
    this.adj[b].set(a, density);
    return true;
  }

  dist(a: number, b: number): number {
    return Math.hypot(this.x[a] - this.x[b], this.z[a] - this.z[b]);
  }

  /** Vertices within `hops` edges of `a`. */
  local(a: number, hops: number): Set<number> {
    const seen = new Set([a]);
    let front = [a];
    for (let h = 0; h < hops; h++) {
      const next: number[] = [];
      for (const v of front) {
        for (const u of this.adj[v].keys()) {
          if (!seen.has(u)) {
            seen.add(u);
            next.push(u);
          }
        }
      }
      front = next;
    }
    return seen;
  }

  /** Connected-component id per vertex. */
  components(): Int32Array {
    const comp = new Int32Array(this.count).fill(-1);
    let c = 0;
    for (let s = 0; s < this.count; s++) {
      if (comp[s] >= 0) {
        continue;
      }
      const stack = [s];
      comp[s] = c;
      while (stack.length) {
        const v = stack.pop()!;
        for (const u of this.adj[v].keys()) {
          if (comp[u] < 0) {
            comp[u] = c;
            stack.push(u);
          }
        }
      }
      c++;
    }
    return comp;
  }
}

/** Resamples a polyline offset by `offset` along its left normal (miter joins) to segments of at most MAX_SEG m. */
function offsetLane(pts: readonly number[], offset: number): number[] {
  const n = pts.length / 2;
  const out: number[] = [];
  let qx = 0;
  let qz = 0;
  for (let k = 0; k < n; k++) {
    let tx = 0;
    let tz = 0;
    if (k > 0) {
      const l = Math.hypot(pts[k * 2] - pts[k * 2 - 2], pts[k * 2 + 1] - pts[k * 2 - 1]) || 1;
      tx += (pts[k * 2] - pts[k * 2 - 2]) / l;
      tz += (pts[k * 2 + 1] - pts[k * 2 - 1]) / l;
    }
    if (k < n - 1) {
      const l = Math.hypot(pts[k * 2 + 2] - pts[k * 2], pts[k * 2 + 3] - pts[k * 2 + 1]) || 1;
      tx += (pts[k * 2 + 2] - pts[k * 2]) / l;
      tz += (pts[k * 2 + 3] - pts[k * 2 + 1]) / l;
    }
    const tl = Math.hypot(tx, tz) || 1;
    let miter = 1;
    if (offset !== 0 && k > 0 && k < n - 1) {
      const ax = pts[k * 2] - pts[k * 2 - 2];
      const az = pts[k * 2 + 1] - pts[k * 2 - 1];
      const bx = pts[k * 2 + 2] - pts[k * 2];
      const bz = pts[k * 2 + 3] - pts[k * 2 + 1];
      const c = (ax * bx + az * bz) / ((Math.hypot(ax, az) || 1) * (Math.hypot(bx, bz) || 1));
      miter = Math.min(2, 1 / Math.max(0.5, Math.sqrt((1 + c) / 2)));
    }
    const px = pts[k * 2] + (tz / tl) * offset * miter;
    const pz = pts[k * 2 + 1] + (-tx / tl) * offset * miter;
    if (k > 0) {
      const steps = Math.ceil(Math.hypot(px - qx, pz - qz) / MAX_SEG);
      for (let s = 1; s < steps; s++) {
        out.push(qx + ((px - qx) * s) / steps, qz + ((pz - qz) * s) / steps);
      }
    }
    out.push(px, pz);
    qx = px;
    qz = pz;
  }
  return out;
}

/** Lane class of a foot way (crowd/graph.ts footLane), or -1 when the runtime builds no lane for it or keeps it whole. */
function footKind(r: OsmRoad): number {
  if (r.tunnel || r.bridge || r.pts.length < 4) {
    return -1;
  }
  if (r.kind === 'steps') {
    return Kind.Steps;
  }
  if (r.kind !== 'footway' && r.kind !== 'path') {
    return -1;
  }
  if (r.footway === 'crossing') {
    return Kind.Crossing;
  }
  return r.footway === 'sidewalk' ? Kind.Sidewalk : Kind.Footway;
}

export function walkNetwork(data: Pick<OsmData, 'roads' | 'points'>, base: WalkGraph, ctx: NetworkContext): WalkNetwork {
  const { surface, cover, rect, poi } = ctx;
  const net = new Net();
  const stats: NetworkStats = { merged: 0, healed: 0, addedLanes: 0, endLinks: 0, crossings: { mapped: 0, footways: 0, nodes: 0, junctions: 0, nodesServed: 0, nodesOnLane: 0, nodesInRect: 0 }, stitched: { offRoad: 0, acrossRoad: 0 }, components: 0, largest: 0, largestShare: 0, isolated: 0 };

  const inRect = (x: number, z: number): boolean => x > rect.minX && x < rect.maxX && z > rect.minZ && z < rect.maxZ;
  const wallClear = (x: number, z: number, c: number): boolean => {
    const k = cover.grid.index(x, z);
    return k >= 0 && cover.buildingDist[k] / 10 >= c;
  };
  const dry = (x: number, z: number, m: number): boolean => surface.geo.coast(x, z) > m;
  const onKerbedRoad = (x: number, z: number): boolean => surface.kerbed(x, z) && surface.distance(x, z) < 0.3;
  const walkable = (x: number, z: number): boolean => inRect(x, z) && dry(x, z, 0.8) && wallClear(x, z, 0.2);
  /** 0: blocked by a building or water; 1: clear; 2: clear but over a carriageway. */
  const linkState = (ax: number, az: number, bx: number, bz: number): number => {
    const steps = Math.max(2, Math.ceil(Math.hypot(bx - ax, bz - az)));
    let road = false;
    for (let s = 1; s < steps; s++) {
      const x = ax + ((bx - ax) * s) / steps;
      const z = az + ((bz - az) * s) / steps;
      if (!wallClear(x, z, 0.2) || !dry(x, z, 0.5)) {
        return 0;
      }
      road ||= surface.zone(x, z) === Zone.Carriageway;
    }
    return road ? 2 : 1;
  };
  /** Moves a point on a kerbed carriageway onto the pavement beside it (at most 4 m), or null. */
  const offRoad = (x: number, z: number): [number, number] | null => {
    let px = x;
    let pz = z;
    for (let it = 0; it < 4 && onKerbedRoad(px, pz); it++) {
      const d = surface.distance(px, pz);
      const gx = surface.distance(px + 0.5, pz) - surface.distance(px - 0.5, pz);
      const gz = surface.distance(px, pz + 0.5) - surface.distance(px, pz - 0.5);
      const gl = Math.hypot(gx, gz);
      if (gl < 1e-3) {
        return null;
      }
      px += (gx / gl) * (0.7 - d);
      pz += (gz / gl) * (0.7 - d);
    }
    return onKerbedRoad(px, pz) || Math.hypot(px - x, pz - z) > 4 ? null : [px, pz];
  };

  /* 1. Runtime graph, coincident vertices merged. */
  const n0 = base.verts.length / VERT_STRIDE;
  const map = new Int32Array(n0);
  for (let v = 0; v < n0; v++) {
    const o = v * VERT_STRIDE;
    const x = base.verts[o];
    const z = base.verts[o + 2];
    const same = net.find(x, z, MERGE_RADIUS);
    if (same >= 0) {
      map[v] = same;
      net.hw[same] = Math.max(net.hw[same], base.verts[o + 5]);
      stats.merged++;
    } else {
      map[v] = net.add(x, z, base.verts[o + 5], -base.verts[o + 4], base.verts[o + 3], Kind.Unknown);
    }
  }
  for (let v = 0; v < n0; v++) {
    for (let k = base.start[v]; k < base.start[v + 1]; k++) {
      net.link(map[v], map[base.nbr[k]], base.weight[k]);
    }
  }

  /* 2. Foot ways re-walked: dropped samples back on the pavement, shared OSM nodes as one vertex. */
  const byNode = new Map<string, number>();
  const nodeKey = (x: number, z: number): string => `${x.toFixed(1)},${z.toFixed(1)}`;
  const crossingNodes = new Set(data.points.filter((p) => p.kind === 'highway=crossing').map((p) => nodeKey(p.x, p.z)));
  for (const r of data.roads) {
    const kind = footKind(r);
    if (kind < 0) {
      continue;
    }
    const mid = r.pts.length >> 2 << 1;
    const p = poi(r.pts[mid], r.pts[mid + 1]);
    const hw0 = Math.max(0.3, Math.min(2.5, r.width / 2 - 0.3));
    const hw = kind === Kind.Crossing ? Math.max(hw0, 0.8) : hw0;
    const density = kind === Kind.Crossing ? 0.02 : kind === Kind.Steps ? 0.004 + 0.02 * p : kind === Kind.Sidewalk ? 0.015 + 0.05 * p : 0.006 + 0.035 * p;
    const pts = offsetLane(r.pts, 0);
    const ids: number[] = [];
    let prev = -1;
    let across = false;
    for (let k = 0; k < pts.length; k += 2) {
      const x = pts[k];
      const z = pts[k + 1];
      const kx = k + 2 < pts.length ? pts[k + 2] - x : x - pts[k - 2];
      const kz = k + 2 < pts.length ? pts[k + 3] - z : z - pts[k - 1];
      let id = -1;
      let sampleKind: number = crossingNodes.has(nodeKey(x, z)) ? Kind.Crossing : kind;
      if (inRect(x, z)) {
        id = byNode.get(nodeKey(x, z)) ?? net.find(x, z, 0.1);
        if (id < 0) {
          let q: [number, number] | null = [x, z];
          if (sampleKind !== Kind.Crossing && onKerbedRoad(x, z)) {
            const a = surface.directionAt(x, z);
            if (Math.abs(kx * Math.cos(a) + kz * Math.sin(a)) < 0.7 * (Math.hypot(kx, kz) || 1)) {
              sampleKind = Kind.Crossing;
              across = true;
            } else {
              q = offRoad(x, z);
            }
          }
          if (q && walkable(q[0], q[1])) {
            id = net.add(q[0], q[1], sampleKind === Kind.Crossing ? Math.max(hw, 0.8) : hw, kx, kz, sampleKind);
            stats.healed++;
          }
        }
      }
      if (id >= 0) {
        byNode.set(nodeKey(x, z), id);
        if (net.kind[id] === Kind.Unknown || sampleKind === Kind.Crossing) {
          net.kind[id] = sampleKind;
        }
        if (prev >= 0) {
          net.link(prev, id, density);
        }
        ids.push(id);
      }
      prev = id;
    }
    if (kind === Kind.Crossing && ids.length >= 2) {
      stats.crossings.mapped++;
    }
    if (across) {
      stats.crossings.footways++;
    }
  }

  /* 3. Streets without runtime lanes: non-kerbed asphalt (pedestrian / living streets, service roads). */
  const streets = classifyStreets(data.roads as OsmRoad[]);
  for (const s of streets) {
    const road = data.roads[s.road];
    if (s.surf !== Surf.Asphalt || s.kerbed || s.sidewalk > 0 || road.sidewalk === 'separate' || road.sidewalk === 'no') {
      continue;
    }
    const mid = s.pts.length >> 2 << 1;
    const p = poi(s.pts[mid], s.pts[mid + 1]);
    const walkingStreet = s.kind === 'pedestrian' || s.kind === 'living_street';
    const lanes = walkingStreet ? Math.min(6, Math.max(1, Math.round((s.hw * 2) / 3))) : 1;
    const lw = (s.hw * 2) / lanes;
    for (let l = 0; l < lanes; l++) {
      const offset = walkingStreet ? -s.hw + lw * (l + 0.5) : 0;
      const hw = walkingStreet ? Math.max(0.3, lw / 2 - 0.15) : Math.max(0.4, s.hw - 0.45);
      const density = walkingStreet ? 0.025 + 0.07 * p : 0.006 + 0.05 * p;
      const pts = offsetLane(s.pts, offset);
      let prev = -1;
      let added = 0;
      for (let k = 0; k < pts.length; k += 2) {
        const x = pts[k];
        const z = pts[k + 1];
        let id = -1;
        if (walkable(x, z)) {
          id = net.find(x, z, 0.1);
          if (id < 0) {
            const kx = k + 2 < pts.length ? pts[k + 2] - x : x - pts[k - 2];
            const kz = k + 2 < pts.length ? pts[k + 3] - z : z - pts[k - 1];
            id = net.add(x, z, hw, kx, kz, walkingStreet ? Kind.Plaza : Kind.Street);
            added++;
          }
          if (prev >= 0) {
            net.link(prev, id, density);
          }
        }
        prev = id;
      }
      if (added > 1) {
        stats.addedLanes++;
      }
    }
  }

  /* 4. Lane ends linked to the nearest vertex of another lane. */
  const ends: number[] = [];
  for (let v = 0; v < net.count; v++) {
    if (net.adj[v].size <= 1) {
      ends.push(v);
    }
  }
  for (const a of ends) {
    const crossing = net.kind[a] === Kind.Crossing;
    const own = net.local(a, 4);
    for (const b of net.near(net.x[a], net.z[a], crossing ? CROSSING_LINK_RADIUS : LINK_RADIUS)) {
      if (own.has(b)) {
        continue;
      }
      const st = linkState(net.x[a], net.z[a], net.x[b], net.z[b]);
      if (st === 1 || (st === 2 && (crossing || net.kind[b] === Kind.Crossing))) {
        if (net.link(a, b, LINK_DENSITY)) {
          stats.endLinks++;
        }
        break;
      }
    }
  }

  /* 5. Crossings at highway=crossing nodes without a crossing way, and across junction arms. */
  const crossingNear = (x: number, z: number, r: number): boolean => net.near(x, z, r).some((id) => net.kind[id] === Kind.Crossing);
  const sideVertex = (px: number, pz: number, nx: number, nz: number, sign: number, s: Street, reach: number): number => {
    const tx = px + nx * reach * sign;
    const tz = pz + nz * reach * sign;
    for (const id of net.near(tx, tz, 4.5)) {
      const off = ((net.x[id] - px) * nx + (net.z[id] - pz) * nz) * sign;
      if (off > s.hw * 0.6 && off < reach + 4.5 && !onKerbedRoad(net.x[id], net.z[id]) && net.kind[id] !== Kind.Crossing) {
        return id;
      }
    }
    return -1;
  };
  /** Adds a kerb-to-kerb crossing of street `s` at (px, pz) with unit tangent (tx, tz). */
  const addCrossing = (s: Street, px: number, pz: number, tx: number, tz: number): boolean => {
    const nx = tz;
    const nz = -tx;
    const reach = s.hw + Math.max(1, s.sidewalk * 0.5);
    const va = sideVertex(px, pz, nx, nz, 1, s, reach);
    const vb = sideVertex(px, pz, nx, nz, -1, s, reach);
    if (va < 0 || vb < 0 || va === vb) {
      return false;
    }
    const kerb = s.hw + 0.4;
    const chain = [net.x[va], net.z[va], px + nx * kerb, pz + nz * kerb, px, pz, px - nx * kerb, pz - nz * kerb, net.x[vb], net.z[vb]];
    for (let k = 2; k < chain.length; k += 2) {
      if (!inRect(chain[k], chain[k + 1]) || linkState(chain[k - 2], chain[k - 1], chain[k], chain[k + 1]) === 0) {
        return false;
      }
    }
    const ids = [va];
    for (let k = 2; k < 8; k += 2) {
      ids.push(net.add(chain[k], chain[k + 1], 1.1, nx, nz, Kind.Crossing));
    }
    ids.push(vb);
    for (let k = 1; k < ids.length; k++) {
      net.link(ids[k - 1], ids[k], 0.02);
    }
    return true;
  };
  const tangentAt = (pts: readonly number[], x: number, z: number): [number, number] => {
    let tx = 1;
    let tz = 0;
    let best = Infinity;
    for (let k = 2; k < pts.length; k += 2) {
      const d = segDist(x, z, pts[k - 2], pts[k - 1], pts[k], pts[k + 1]);
      if (d < best) {
        best = d;
        tx = pts[k] - pts[k - 2];
        tz = pts[k + 1] - pts[k - 1];
      }
    }
    const l = Math.hypot(tx, tz) || 1;
    return [tx / l, tz / l];
  };
  const byRoad = new Map<number, Street>();
  for (const s of streets) {
    byRoad.set(s.road, s);
  }
  const bothSides = (s: Street): boolean => (s.kerbed && s.walkL > 0 && s.walkR > 0) || data.roads[s.road].sidewalk === 'separate';
  for (const p of data.points) {
    if (p.kind !== 'highway=crossing' || !p.roads || !inRect(p.x, p.z) || crossingNear(p.x, p.z, 6)) {
      continue;
    }
    if (p.roads.some((r) => footKind(data.roads[r]) >= 0)) {
      continue;
    }
    const s = p.roads.map((r) => byRoad.get(r)).find((st) => st && (st.kerbed || data.roads[st.road].sidewalk === 'separate'));
    if (s) {
      const [tx, tz] = tangentAt(s.pts, p.x, p.z);
      if (addCrossing(s, p.x, p.z, tx, tz)) {
        stats.crossings.nodes++;
      }
    }
  }
  const atRef = new Map<number, { s: Street; vi: number }[]>();
  for (const s of streets) {
    const refs = data.roads[s.road].refs ?? [];
    for (let k = 0; k < refs.length; k += 2) {
      const list = atRef.get(refs[k + 1]) ?? [];
      list.push({ s, vi: refs[k] });
      atRef.set(refs[k + 1], list);
    }
  }
  const refIds = [...atRef.keys()].sort((a, b) => a - b);
  for (const ref of refIds) {
    const inc = atRef.get(ref)!;
    const arms: { s: Street; vi: number; step: number }[] = [];
    for (const { s, vi } of inc) {
      const n = s.pts.length / 2;
      if (vi > 0) {
        arms.push({ s, vi, step: -1 });
      }
      if (vi < n - 1) {
        arms.push({ s, vi, step: 1 });
      }
    }
    if (arms.length < 3) {
      continue;
    }
    for (const arm of arms) {
      if (!bothSides(arm.s)) {
        continue;
      }
      let clear = 0;
      for (const other of arms) {
        if (other.s !== arm.s) {
          clear = Math.max(clear, other.s.hw + other.s.sidewalk);
        }
      }
      const back = Math.min(18, Math.max(3, clear + 1.5));
      const pts = arm.s.pts;
      const n = pts.length / 2;
      let walked = 0;
      let at: [number, number, number, number] | null = null;
      for (let i = arm.vi; i + arm.step >= 0 && i + arm.step < n; i += arm.step) {
        const j = i + arm.step;
        const len = Math.hypot(pts[j * 2] - pts[i * 2], pts[j * 2 + 1] - pts[i * 2 + 1]);
        if (walked + len >= back) {
          const f = (back - walked) / len;
          const tx = (pts[j * 2] - pts[i * 2]) / len;
          const tz = (pts[j * 2 + 1] - pts[i * 2 + 1]) / len;
          at = [pts[i * 2] + (pts[j * 2] - pts[i * 2]) * f, pts[i * 2 + 1] + (pts[j * 2 + 1] - pts[i * 2 + 1]) * f, tx, tz];
          break;
        }
        walked += len;
      }
      if (!at || !inRect(at[0], at[1]) || crossingNear(at[0], at[1], 7)) {
        continue;
      }
      if (addCrossing(arm.s, at[0], at[1], at[2], at[3])) {
        stats.crossings.junctions++;
      }
    }
  }

  /* 6. Fragments joined by the shortest clear links, off-carriageway links first; a wider second round. */
  for (const radius of STITCH_RADII) {
    const comp = net.components();
    const parent = Int32Array.from({ length: comp.reduce((m, c) => Math.max(m, c), -1) + 1 }, (_, i) => i);
    const root = (a: number): number => {
      while (parent[a] !== a) {
        parent[a] = parent[parent[a]];
        a = parent[a];
      }
      return a;
    };
    const pairs: { a: number; b: number; d: number }[] = [];
    for (let a = 0; a < net.count; a++) {
      for (const b of net.near(net.x[a], net.z[a], radius)) {
        if (b > a && comp[a] !== comp[b]) {
          pairs.push({ a, b, d: net.dist(a, b) });
        }
      }
    }
    pairs.sort((p, q) => p.d - q.d || p.a - q.a || p.b - q.b);
    const deferred: typeof pairs = [];
    for (const pr of pairs) {
      if (root(comp[pr.a]) === root(comp[pr.b])) {
        continue;
      }
      const st = linkState(net.x[pr.a], net.z[pr.a], net.x[pr.b], net.z[pr.b]);
      if (st === 1) {
        parent[root(comp[pr.a])] = root(comp[pr.b]);
        net.link(pr.a, pr.b, LINK_DENSITY);
        stats.stitched.offRoad++;
      } else if (st === 2) {
        deferred.push(pr);
      }
    }
    for (const pr of deferred) {
      if (root(comp[pr.a]) !== root(comp[pr.b])) {
        parent[root(comp[pr.a])] = root(comp[pr.b]);
        net.link(pr.a, pr.b, LINK_DENSITY);
        stats.stitched.acrossRoad++;
      }
    }
  }

  for (const p of data.points) {
    if (p.kind === 'highway=crossing' && inRect(p.x, p.z)) {
      stats.crossings.nodesInRect++;
      if (crossingNear(p.x, p.z, 3)) {
        stats.crossings.nodesServed++;
      } else if (net.find(p.x, p.z, 1.5) >= 0) {
        stats.crossings.nodesOnLane++;
      }
    }
  }

  /* Output and connectivity. */
  const out: WalkNetwork = { x: net.x, z: net.z, hw: net.hw, dx: net.dx, dz: net.dz, edges: [], density: [], stats };
  for (let a = 0; a < net.count; a++) {
    for (const [b, w] of [...net.adj[a]].sort((p, q) => p[0] - q[0])) {
      if (b > a) {
        out.edges.push(a, b);
        out.density.push(w);
      }
    }
  }
  const final = net.components();
  const size = new Map<number, number>();
  for (let v = 0; v < net.count; v++) {
    size.set(final[v], (size.get(final[v]) ?? 0) + 1);
  }
  const sizes = [...size.values()];
  stats.components = sizes.length;
  stats.largest = Math.max(0, ...sizes);
  stats.largestShare = net.count ? Math.round((stats.largest / net.count) * 1000) / 1000 : 0;
  stats.isolated = sizes.filter((c) => c === 1).length;
  return out;
}
