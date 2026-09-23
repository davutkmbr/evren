import type { GeoQuery } from '../../../core/contracts';
import { latLonToLocal } from '../../../core/geo-coords';
import { ANCHORAGES, FERRY_LINES, PIERS, STRAIT_CENTRELINE, type FerryLineDef, type PierDef } from '../data/places';
import { offsetPolyline, Path2, relax, smoothPolyline, type P2 } from '../util/path';
import { centreInChannel, clearance, clearanceGradient, pushToWater } from '../util/water-nav';
import { routeOverWater } from '../util/water-route';

export interface Berth {
  pier: PierDef;
  index: number;
  /** Shoreline point behind the berth. */
  shore: P2;
  /** Seaward unit normal. */
  n: P2;
  /** Along-shore unit tangent. */
  t: P2;
  /** Mooring face (outer edge of the pier platform). */
  face: P2;
}

/** Snaps every pier berth (OSM terminal node) onto the geo coastline and derives its seaward direction. */
export function placeBerths(geo: GeoQuery): Map<string, Berth[]> {
  const out = new Map<string, Berth[]>();
  const g = { x: 0, z: 0 };
  for (const pier of PIERS) {
    const list: Berth[] = [];
    pier.berths.forEach(([lat, lon], index) => {
      const p = latLonToLocal(lat, lon);
      // Seaward direction from the clearance gradient at a coarse scale (ignores tiny coastline wiggles).
      let nx = 0;
      let nz = 0;
      for (const h of [40, 80, 140]) {
        clearanceGradient(geo, p.x, p.z, g, h);
        nx += g.x;
        nz += g.z;
      }
      const l = Math.hypot(nx, nz) || 1;
      nx /= l;
      nz /= l;
      // March to the shoreline (clearance 0) along the normal.
      let sx = p.x;
      let sz = p.z;
      const c0 = clearance(geo, sx, sz);
      const dir = c0 > 0 ? -1 : 1;
      for (let i = 0; i < 400; i++) {
        const c = clearance(geo, sx, sz);
        if ((dir < 0 && c <= 0) || (dir > 0 && c >= 0)) break;
        sx += nx * dir * 2;
        sz += nz * dir * 2;
      }
      const shore = { x: sx, z: sz };
      list.push({
        pier,
        index,
        shore,
        n: { x: nx, z: nz },
        t: { x: -nz, z: nx },
        face: { x: sx + nx * pier.reach, z: sz + nz * pier.reach },
      });
    });
    out.set(pier.id, list);
  }
  return out;
}

export interface FerryLoop {
  line: FerryLineDef;
  path: Path2;
  stops: number[];
}

/**
 * Closed loop for a ferry line: A -> ... -> last -> ... -> A, docking parallel to each berth face.
 * Legs between berths are routed with grid A* over open water, return legs keep to starboard.
 */
export function buildFerryLoop(geo: GeoQuery, berths: Map<string, Berth[]>, line: FerryLineDef, length: number, beam: number): FerryLoop | null {
  const stops: Berth[] = [];
  for (const [pid, bi] of line.stops) {
    const list = berths.get(pid);
    const b = list?.[Math.min(bi, (list?.length ?? 1) - 1)];
    if (!b) return null;
    stops.push(b);
  }
  if (stops.length < 2) return null;
  const order: number[] = [];
  for (let i = 0; i < stops.length; i++) order.push(i);
  for (let i = stops.length - 2; i >= 1; i--) order.push(i);

  const dockOf = (b: Berth): P2 => ({ x: b.face.x + b.n.x * (beam / 2 + 0.8), z: b.face.z + b.n.z * (beam / 2 + 0.8) });
  const ctrl: P2[] = [];
  const stopCtrl: number[] = [];
  const clearMin = Math.max(45, beam * 3);
  let prevExit: P2 | null = null;
  const visits: { dock: P2; t: P2; n: P2 }[] = [];
  for (let k = 0; k < order.length; k++) {
    const b = stops[order[k]];
    const prev = stops[order[(k - 1 + order.length) % order.length]];
    const next = stops[order[(k + 1) % order.length]];
    const dock = dockOf(b);
    let t = { ...b.t };
    const flow = { x: next.face.x - prev.face.x, z: next.face.z - prev.face.z };
    if (Math.abs(flow.x) + Math.abs(flow.z) < 1) {
      flow.x = next.face.x - b.face.x;
      flow.z = next.face.z - b.face.z;
    }
    if (t.x * flow.x + t.z * flow.z < 0) t = { x: -t.x, z: -t.z };
    visits.push({ dock, t, n: b.n });
  }
  for (let k = 0; k < visits.length; k++) {
    const v = visits[k];
    const a1 = length * 1.7;
    const a2 = length * 1.1;
    const approach = { x: v.dock.x - v.t.x * a1 + v.n.x * a2, z: v.dock.z - v.t.z * a1 + v.n.z * a2 };
    const exit = { x: v.dock.x + v.t.x * a1 + v.n.x * a2, z: v.dock.z + v.t.z * a1 + v.n.z * a2 };
    if (prevExit) {
      const route = routeOverWater(geo, pushToWater(geo, prevExit, clearMin), pushToWater(geo, approach, clearMin), clearMin);
      for (let i = 1; i < route.length - 1; i++) ctrl.push(route[i]);
    }
    ctrl.push(pushToWater(geo, approach, clearMin * 0.6));
    const near0 = { x: v.dock.x - v.t.x * length * 0.75, z: v.dock.z - v.t.z * length * 0.75 };
    const near1 = { x: v.dock.x + v.t.x * length * 0.75, z: v.dock.z + v.t.z * length * 0.75 };
    ctrl.push(near0);
    stopCtrl.push(ctrl.length);
    ctrl.push(v.dock);
    ctrl.push(near1);
    ctrl.push(pushToWater(geo, exit, clearMin * 0.6));
    prevExit = exit;
  }
  // Closing leg back to the first approach.
  {
    const v = visits[0];
    const approach = { x: v.dock.x - v.t.x * length * 1.7 + v.n.x * length * 1.1, z: v.dock.z - v.t.z * length * 1.7 + v.n.z * length * 1.1 };
    const route = routeOverWater(geo, pushToWater(geo, prevExit!, clearMin), pushToWater(geo, approach, clearMin), clearMin);
    for (let i = 1; i < route.length - 1; i++) ctrl.push(route[i]);
  }
  const step = 12;
  const dense = smoothPolyline(ctrl, step, true);
  // Track which dense samples are near docks (no pushing / relaxing there).
  const docks = stopCtrl.map((i) => ctrl[i]);
  const nearDock = (p: P2): boolean => docks.some((d) => Math.hypot(p.x - d.x, p.z - d.z) < length * 1.2);
  let pts = dense.map((p) => (nearDock(p) ? p : pushToWater(geo, p, clearMin * 0.5)));
  pts = relax(pts, 3, true, (i) => nearDock(pts[i]));
  const path = new Path2(pts, true);
  // Stop arc positions: closest dense sample to each dock.
  const stopsS: number[] = [];
  for (const d of docks) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < path.count - 1; i++) {
      const dd = Math.hypot(path.xs[i] - d.x, path.zs[i] - d.z);
      if (dd < bestD) {
        bestD = dd;
        best = path.cum[i];
      }
    }
    stopsS.push(best);
  }
  stopsS.sort((a, b) => a - b);
  return { line, path, stops: stopsS };
}

export function buildFerryLoops(geo: GeoQuery, berths: Map<string, Berth[]>, dims: Record<string, { length: number; beam: number }>): FerryLoop[] {
  const out: FerryLoop[] = [];
  for (const line of FERRY_LINES) {
    const d = dims[line.kind];
    const loop = buildFerryLoop(geo, berths, line, d.length, d.beam);
    if (loop) out.push(loop);
  }
  return out;
}

export interface StraitLanes {
  /** Southbound (Black Sea -> Marmara), keeps to the European side. */
  south: Path2;
  /** Northbound (Marmara -> Black Sea), keeps to the Asian side. */
  north: Path2;
  /** Centreline (north -> south). */
  centre: P2[];
}

/** Traffic separation lanes through the strait, centred on the geo channel. */
export function buildStraitLanes(geo: GeoQuery): StraitLanes {
  const ctrl = STRAIT_CENTRELINE.map(([lat, lon]) => latLonToLocal(lat, lon));
  let centre = smoothPolyline(ctrl, 80);
  centre = centreInChannel(geo, centre, 2400, 20);
  centre = relax(centre, 12);
  centre = centreInChannel(geo, centre, 2400, 20);
  centre = relax(centre, 8);
  // Smoothed channel half-width drives the lane offset; lanes stay on their own side of the centreline and only
  // shrink their offset (never cross) where the shore is close.
  const rawHalf = centre.map((p) => Math.max(clearance(geo, p.x, p.z), 0));
  const half = rawHalf.map((_, i) => {
    let s = 0;
    let n = 0;
    for (let k = -6; k <= 6; k++) {
      const j = i + k;
      if (j < 0 || j >= rawHalf.length) continue;
      s += rawHalf[j];
      n++;
    }
    return Math.min(s / n, rawHalf[i]);
  });
  const lane = (pts: P2[], halfW: number[]): P2[] => {
    const offs = halfW.map((h) => Math.min(Math.max(h * 0.3, 90), 650));
    for (let iter = 0; iter < 6; iter++) {
      const o = offsetPolyline(pts, (i) => offs[i]);
      let changed = false;
      for (let i = 0; i < o.length; i++) {
        if (clearance(geo, o[i].x, o[i].z) < 110 && offs[i] > 25) {
          offs[i] *= 0.75;
          changed = true;
        }
      }
      if (!changed) break;
    }
    // Smooth the offsets so the lane does not wiggle.
    const smoothOffs = offs.map((_, i) => {
      let m = Infinity;
      for (let k = -5; k <= 5; k++) {
        const j = i + k;
        if (j >= 0 && j < offs.length) m = Math.min(m, offs[j]);
      }
      return m;
    });
    return relax(offsetPolyline(pts, (i) => smoothOffs[i]), 4);
  };
  const south = lane(centre, half);
  const rev = [...centre].reverse();
  const north = lane(rev, [...half].reverse());
  return { south: new Path2(south), north: new Path2(north), centre };
}

/** Closed sightseeing loop through the lower Bosphorus, out of the separation lanes. */
export function buildTourLoop(geo: GeoQuery, centre: P2[], fromLat: number, toLat: number): Path2 {
  const zA = latLonToLocal(fromLat, 29).z;
  const zB = latLonToLocal(toLat, 29).z;
  const seg = centre.filter((p) => p.z <= Math.max(zA, zB) && p.z >= Math.min(zA, zB));
  const half = (p: P2): number => Math.max(clearance(geo, p.x, p.z), 0);
  const segR = [...seg].reverse();
  const north = offsetPolyline(segR, (i) => Math.min(half(segR[i]) * 0.62, 900));
  const south = offsetPolyline(seg, (i) => Math.min(half(seg[i]) * 0.62, 900));
  let loop = [...north, ...south].map((p) => pushToWater(geo, p, 70));
  loop = relax(loop, 6, true);
  return new Path2(loop.map((p) => pushToWater(geo, p, 55)), true);
}

/** Anchorage berths: well-spaced deep-water points inside each anchorage area. */
export function anchorageSpots(geo: GeoQuery, count: number, rng: () => number): P2[] {
  const out: P2[] = [];
  for (const a of ANCHORAGES) {
    const c = latLonToLocal(a.lat, a.lon);
    const want = Math.round(count * a.share);
    let placed = 0;
    for (let tries = 0; tries < 600 && placed < want; tries++) {
      const ang = rng() * Math.PI * 2;
      const r = Math.sqrt(rng()) * a.radius;
      const p = { x: c.x + Math.cos(ang) * r, z: c.z + Math.sin(ang) * r };
      if (clearance(geo, p.x, p.z) < 450 || geo.heightAt(p.x, p.z) > -14) continue;
      if (out.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 420)) continue;
      out.push(p);
      placed++;
    }
  }
  return out;
}
