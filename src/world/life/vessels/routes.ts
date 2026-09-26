import type { GeoQuery } from '../../../core/contracts';
import { latLonToLocal } from '../../../core/geo-coords';
import { ANCHORAGES, PIERS, STRAIT_CENTRELINE, type PierDef } from '../data/places';
import { offsetPolyline, Path2, relax, smoothPolyline, type P2 } from '../util/path';
import { centreInChannel, clearance, clearanceGradient, pushToWater } from '../util/water-nav';
import { KeepOut } from './nav/keep-out';

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
/** Shoreline point and seaward frame near (x, z): normal from the clearance gradient at coarse scales. */
export function shoreFrame(geo: GeoQuery, x: number, z: number, scales: readonly number[] = [40, 80, 140]): { shore: P2; n: P2; t: P2 } {
  const g = { x: 0, z: 0 };
  let nx = 0;
  let nz = 0;
  for (const h of scales) {
    clearanceGradient(geo, x, z, g, h);
    nx += g.x;
    nz += g.z;
  }
  const l = Math.hypot(nx, nz) || 1;
  nx /= l;
  nz /= l;
  // March to the shoreline (clearance 0) along the normal.
  let sx = x;
  let sz = z;
  const dir = clearance(geo, sx, sz) > 0 ? -1 : 1;
  for (let i = 0; i < 400; i++) {
    const c = clearance(geo, sx, sz);
    if ((dir < 0 && c <= 0) || (dir > 0 && c >= 0)) break;
    sx += nx * dir * 2;
    sz += nz * dir * 2;
  }
  return { shore: { x: sx, z: sz }, n: { x: nx, z: nz }, t: { x: -nz, z: nx } };
}

/** Snaps every pier berth (OSM terminal node) onto the geo coastline and derives its seaward direction. */
export function placeBerths(geo: GeoQuery): Map<string, Berth[]> {
  const out = new Map<string, Berth[]>();
  for (const pier of PIERS) {
    const list: Berth[] = [];
    pier.berths.forEach(([lat, lon], index) => {
      const p = latLonToLocal(lat, lon);
      const f = shoreFrame(geo, p.x, p.z);
      list.push({
        pier,
        index,
        shore: f.shore,
        n: f.n,
        t: f.t,
        face: { x: f.shore.x + f.n.x * pier.reach, z: f.shore.z + f.n.z * pier.reach },
      });
    });
    out.set(pier.id, list);
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

/**
 * Makes a navigation polyline safe: drops points where the line doubles back on itself (a medial-axis point that jumped
 * into a bay), pushes every point to at least `minClear` metres of water and smooths again, a few rounds.
 */
export function sanitizePath(geo: GeoQuery, points: readonly P2[], minClear: number, rounds = 4): P2[] {
  let pts = points.map((p) => ({ ...p }));
  for (let r = 0; r < rounds; r++) {
    let removed = true;
    while (removed && pts.length > 3) {
      removed = false;
      for (let i = 1; i < pts.length - 1; i++) {
        const ax = pts[i].x - pts[i - 1].x;
        const az = pts[i].z - pts[i - 1].z;
        const bx = pts[i + 1].x - pts[i].x;
        const bz = pts[i + 1].z - pts[i].z;
        const la = Math.hypot(ax, az);
        const lb = Math.hypot(bx, bz);
        if (la < 1e-3 || lb < 1e-3 || (ax * bx + az * bz) / (la * lb) < 0.5) {
          pts.splice(i, 1);
          removed = true;
          break;
        }
      }
    }
    let moved = false;
    pts = pts.map((p) => {
      if (clearance(geo, p.x, p.z) >= minClear) return p;
      moved = true;
      return pushToWater(geo, p, minClear * 1.1);
    });
    pts = relax(pts, 3);
    if (!moved && r > 0) break;
  }
  return pts;
}

/** Traffic separation lanes through the strait, centred on the geo channel. */
export function buildStraitLanes(geo: GeoQuery): StraitLanes {
  const ctrl = STRAIT_CENTRELINE.map(([lat, lon]) => latLonToLocal(lat, lon));
  let centre = smoothPolyline(ctrl, 80);
  centre = centreInChannel(geo, centre, 2400, 20);
  centre = relax(centre, 12);
  centre = centreInChannel(geo, centre, 2400, 20);
  centre = relax(centre, 8);
  centre = sanitizePath(geo, centre, 260);
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
    return sanitizePath(geo, relax(offsetPolyline(pts, (i) => smoothOffs[i]), 4), 150);
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
  loop = loop.map((p) => pushToWater(geo, p, 55));
  // Dense closed spline: the heading follows the curve instead of kinking at sparse vertices (no crabbing).
  return new Path2(smoothPolyline(loop, 12, true).map((p) => (clearance(geo, p.x, p.z) < 45 ? pushToWater(geo, p, 50, 12) : p)), true);
}

/** Anchorage berths: well-spaced deep-water points inside each anchorage area. */
export function anchorageSpots(geo: GeoQuery, count: number, rng: () => number, keepOut: KeepOut | null = null): P2[] {
  const out: P2[] = [];
  for (const a of ANCHORAGES) {
    const c = latLonToLocal(a.lat, a.lon);
    const want = Math.round(count * a.share);
    let placed = 0;
    for (let tries = 0; tries < 600 && placed < want; tries++) {
      const ang = rng() * Math.PI * 2;
      const r = Math.sqrt(rng()) * a.radius;
      const p = { x: c.x + Math.cos(ang) * r, z: c.z + Math.sin(ang) * r };
      if (clearance(geo, p.x, p.z) < 450 || geo.heightAt(p.x, p.z) > -14 || keepOut?.blocked(p.x, p.z)) continue;
      if (out.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 420)) continue;
      out.push(p);
      placed++;
    }
  }
  return out;
}

/** Clearance (m) between a moored hull and the edge of a bridge deck. */
const BRIDGE_CLEARANCE = 6;
/** Deck half width (m) assumed for a bridge landmark without a geo road (e.g. the Haliç metro bridge). */
const BRIDGE_LANDMARK_HALF = 12;

/**
 * Bridge decks as keep-out corridors (geo bridge roads with their width, and the deck ends of every bridge landmark):
 * boats are never moored under or into a bridge, whichever way a mooring line runs along the quay.
 */
export function bridgeKeepOut(geo: GeoQuery): KeepOut {
  const k = new KeepOut();
  for (const r of geo.roads) {
    if (r.kind === 'bridge' && r.points.length >= 2) {
      k.add(r.points, r.width / 2 + BRIDGE_CLEARANCE, 4);
    }
  }
  for (const l of geo.landmarks) {
    if (l.kind === 'bridge' && l.anchors && l.anchors.length >= 4) {
      k.add([l.anchors[2], l.anchors[3]], BRIDGE_LANDMARK_HALF + BRIDGE_CLEARANCE, 4);
    }
  }
  return k;
}

export interface MooringSpot {
  x: number;
  z: number;
  yaw: number;
  /** Swinging on a buoy rather than made fast alongside. */
  buoy: boolean;
}

/**
 * Berths for moored boats along a waterfront: `raft` stacks hulls side by side outwards from the quay, `line` puts them
 * bow to stern along it, `buoys` scatters them on moorings off the shore. Spots too close to a ferry pier, or whose
 * hull would lie under or in a bridge (`bridges`, see bridgeKeepOut), are dropped.
 */
export function mooringSpots(
  geo: GeoQuery,
  lat: number,
  lon: number,
  layout: 'raft' | 'line' | 'buoys',
  count: number,
  length: number,
  beam: number,
  draft: number,
  berths: Map<string, Berth[]>,
  bridges: KeepOut,
  rng: () => number,
): MooringSpot[] {
  const p = latLonToLocal(lat, lon);
  const f = shoreFrame(geo, p.x, p.z, [30, 60]);
  const out: MooringSpot[] = [];
  const dir = rng() < 0.5 ? 1 : -1;
  const yawAlong = Math.atan2(-f.t.x * dir, -f.t.z * dir);
  const nearPier = (x: number, z: number): boolean => {
    for (const list of berths.values()) {
      for (const b of list) if (Math.hypot(x - b.face.x, z - b.face.z) < b.pier.frontage * 0.5 + length * 0.6 + 10) return true;
    }
    return false;
  };
  for (let k = 0; k < count; k++) {
    let x: number;
    let z: number;
    let yaw = yawAlong;
    let buoy = false;
    if (layout === 'raft') {
      const off = 1.6 + beam / 2 + k * (beam + 0.45);
      const slip = (rng() - 0.5) * length * 0.15;
      x = f.shore.x + f.n.x * off + f.t.x * slip;
      z = f.shore.z + f.n.z * off + f.t.z * slip;
      yaw += (rng() - 0.5) * 0.03;
    } else if (layout === 'line') {
      const along = (k - (count - 1) / 2) * (length + 3.5);
      x = f.shore.x + f.n.x * (1.6 + beam / 2) + f.t.x * along;
      z = f.shore.z + f.n.z * (1.6 + beam / 2) + f.t.z * along;
      // Follow the quay: re-snap each hull to its own stretch of shore.
      const g = shoreFrame(geo, x, z, [30, 60]);
      x = g.shore.x + g.n.x * (1.6 + beam / 2);
      z = g.shore.z + g.n.z * (1.6 + beam / 2);
      yaw = Math.atan2(-g.t.x * dir, -g.t.z * dir);
    } else {
      const off = 45 + k * (length + 18) * 0.8 + rng() * 20;
      const along = (rng() - 0.5) * 140;
      x = f.shore.x + f.n.x * off + f.t.x * along;
      z = f.shore.z + f.n.z * off + f.t.z * along;
      yaw = Math.atan2(f.n.x, f.n.z) + (rng() - 0.5) * 0.8;
      buoy = true;
    }
    // Float the hull: move out from the shore until the water under the whole footprint is deep enough.
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const FOOTPRINT = [
      [0, 0],
      [0.45, -0.5],
      [-0.45, -0.5],
      [0.45, 0.5],
      [-0.45, 0.5],
    ];
    const afloat = (px: number, pz: number): boolean => {
      for (const [a, c] of FOOTPRINT) {
        const qx = px + fx * a * length - fz * c * beam;
        const qz = pz + fz * a * length + fx * c * beam;
        if (geo.heightAt(qx, qz) > -(draft + 0.35)) return false;
      }
      return true;
    };
    const underBridge = (px: number, pz: number): boolean => FOOTPRINT.some(([a, c]) => bridges.blocked(px + fx * a * length - fz * c * beam, pz + fz * a * length + fx * c * beam));
    let pushed = 0;
    while (!afloat(x, z) && pushed < 40) {
      x += f.n.x;
      z += f.n.z;
      pushed++;
    }
    if (layout === 'raft' && pushed > 0 && k === 0) {
      // Keep the raft together: every later hull starts from the shifted quay line.
      f.shore.x += f.n.x * pushed;
      f.shore.z += f.n.z * pushed;
    }
    if (pushed >= 40 || clearance(geo, x, z) < beam * 0.5 || nearPier(x, z) || underBridge(x, z)) continue;
    out.push({ x, z, yaw, buoy });
  }
  return out;
}
