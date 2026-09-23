/**
 * Greybox buildings: one extruded block per rendered footprint (outlines without building:part children, and every
 * part, following Simple 3D Buildings), flat roofs, and door recesses cut into the facade at entrance=* nodes and,
 * where no entrance is tagged nearby, at storefront POIs on the street side (flagged inferred).
 */
import * as THREE from 'three';
import type { OsmBuilding } from '../../../src/world/osm/data';
import { BoxGrid, bounds, pointInRing, ringArea } from '../../../src/world/osm/shared/geometry';
import { type StreetSurface, Zone } from '../../../src/world/osm/shared/street-surface';
import type { FootprintIndex } from '../../../src/world/osm/shared/footprints';
import type { BuildingRec, DoorRec, XYZ } from './format';
import type { GroundHeights } from './ground';
import type { TileMesh, Vec3 } from './mesh';
import type { OsmStreetPoint } from './osm-street';
import { entranceSize, INFERRED_DOOR, isEntrance, isStorefront } from './pois';

/** Storey height (m) for building:levels without a height tag. */
export const LEVEL_HEIGHT = 3.1;
/** Walls start this far (m) below the lowest ground under the footprint (slopes). */
const SINK = 0.3;
const RECESS = 0.35;
/** Clear space (m) kept between a door and a facade corner or the next door. */
const CORNER_GAP = 0.2;
const DOOR_GAP = 0.3;
const SMALL_KINDS = new Set(['garage', 'garages', 'shed', 'kiosk', 'carport', 'hut', 'toilets', 'service', 'cabin', 'shelter', 'container', 'transformer_tower', 'booth', 'guardhouse']);
const HOUSE_KINDS = new Set(['house', 'detached', 'semidetached_house', 'bungalow', 'transportation']);
const WORSHIP_KINDS = new Set(['mosque', 'church', 'chapel', 'synagogue', 'temple', 'cathedral', 'religious']);
/** Kadıköy's untagged buildings are mostly 1950s-70s apartment blocks. */
const DEFAULT_LEVELS = 5;

interface DoorPlan {
  edge: number;
  t: number;
  width: number;
  height: number;
  inferred: boolean;
  entrance: string;
  /** Filled by finalize(). */
  bottom: number;
  rec: DoorRec | null;
  pois: string[];
}

export interface Solid {
  rec: BuildingRec;
  ring: number[];
  holes: number[][];
  cx: number;
  cz: number;
  /** Hosts doors (starts at the ground). */
  grounded: boolean;
  doors: DoorPlan[];
}

function defaultLevels(b: OsmBuilding, area: number): number {
  if (SMALL_KINDS.has(b.kind) || area < 25) {
    return 1;
  }
  if (HOUSE_KINDS.has(b.kind)) {
    return 2;
  }
  if (WORSHIP_KINDS.has(b.kind) || b.amenity === 'place_of_worship') {
    return 3;
  }
  return DEFAULT_LEVELS;
}

/** Rendered solids of the data with heights and ground references. */
export function makeSolids(buildings: readonly OsmBuilding[], heights: GroundHeights): Solid[] {
  const seen = new Map<number, number>();
  const out: Solid[] = [];
  for (const b of buildings) {
    if (!b.part && b.hasParts) {
      continue;
    }
    let ring = b.ring;
    if (ringArea(ring) < 0) {
      ring = reverseRing(ring);
    }
    const holes = (b.holes ?? []).map((h) => (ringArea(h) > 0 ? reverseRing(h) : h));
    const area = ringArea(ring);
    const n = ring.length / 2;
    let groundY = Infinity;
    let cx = 0;
    let cz = 0;
    for (let i = 0; i < n; i++) {
      const ax = ring[i * 2];
      const az = ring[i * 2 + 1];
      const bx = ring[((i + 1) % n) * 2];
      const bz = ring[((i + 1) % n) * 2 + 1];
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 4));
      for (let s = 0; s < steps; s++) {
        groundY = Math.min(groundY, heights.at(ax + ((bx - ax) * s) / steps, az + ((bz - az) * s) / steps));
      }
      cx += ax;
      cz += az;
    }
    cx /= n;
    cz /= n;
    let heightSource: BuildingRec['heightSource'] = 'default';
    let h: number;
    if (b.height) {
      h = b.height;
      heightSource = 'height';
    } else if (b.levels) {
      h = (b.levels + (b.roofLevels ?? 0)) * LEVEL_HEIGHT;
      heightSource = 'levels';
    } else {
      h = b.kind === 'roof' ? 4 : defaultLevels(b, area) * LEVEL_HEIGHT;
    }
    let minH = b.minHeight ?? (b.minLevel ? b.minLevel * LEVEL_HEIGHT : 0);
    if (b.kind === 'roof' && !minH) {
      minH = Math.max(0, h - 0.4);
    }
    h = Math.max(h, minH + 0.3);
    const k = seen.get(b.id) ?? 0;
    seen.set(b.id, k + 1);
    const id = `${b.id < 0 ? 'r' : 'w'}${Math.abs(b.id)}${k ? `-${k}` : ''}`;
    const round2 = (v: number): number => Math.round(v * 100) / 100;
    const rec: BuildingRec = {
      id,
      osmId: b.id,
      kind: b.kind,
      footprint: ring.map(round2),
      groundY: round2(groundY),
      bottomY: round2(minH > 0 ? groundY + minH : groundY - SINK),
      topY: round2(groundY + h),
      height: round2(h),
      heightSource,
      doors: [],
    };
    if (b.part) {
      rec.part = true;
    }
    if (b.name) {
      rec.name = b.name;
    }
    if (holes.length) {
      rec.holes = holes.map((r) => r.map(round2));
    }
    if (b.levels) {
      rec.levels = b.levels;
    }
    out.push({ rec, ring, holes, cx, cz, grounded: minH === 0, doors: [] });
  }
  return out;
}

function reverseRing(r: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = r.length / 2 - 1; i >= 0; i--) {
    out.push(r[i * 2], r[i * 2 + 1]);
  }
  return out;
}

interface EdgeHit {
  edge: number;
  t: number;
  len: number;
  dist: number;
}

function edgeOf(ring: readonly number[], i: number): { ax: number; az: number; ux: number; uz: number; len: number; nx: number; nz: number } {
  const n = ring.length / 2;
  const ax = ring[i * 2];
  const az = ring[i * 2 + 1];
  const bx = ring[((i + 1) % n) * 2];
  const bz = ring[((i + 1) % n) * 2 + 1];
  const len = Math.hypot(bx - ax, bz - az) || 1e-9;
  const ux = (bx - ax) / len;
  const uz = (bz - az) / len;
  // Positive-area ring: the outward normal is the right-hand side (dz, -dx).
  return { ax, az, ux, uz, len, nx: uz, nz: -ux };
}

function nearestEdge(ring: readonly number[], x: number, z: number): EdgeHit {
  let best: EdgeHit = { edge: 0, t: 0, len: 0, dist: Infinity };
  for (let i = 0; i < ring.length / 2; i++) {
    const e = edgeOf(ring, i);
    const t = Math.max(0, Math.min(e.len, (x - e.ax) * e.ux + (z - e.az) * e.uz));
    const d = Math.hypot(e.ax + e.ux * t - x, e.az + e.uz * t - z);
    if (d < best.dist) {
      best = { edge: i, t, len: e.len, dist: d };
    }
  }
  return best;
}

export interface DoorStats {
  entrances: number;
  entrancesPlaced: number;
  entrancesUnplaced: number;
  storefronts: number;
  inferredDoors: number;
  storefrontsServedByTagged: number;
  /** No grounded building contains the POI or has a facade within 8 m. */
  storefrontsWithoutBuilding: number;
  /** The host building has no facade edge long enough for a door that faces a street, sidewalk or pedestrian area. */
  storefrontsWithoutStreetSide: number;
  droppedOverlaps: number;
  droppedLowWalls: number;
}

/** Detour (m) charged to a facade that faces an open forecourt near a street rather than the walkway itself. */
const FORECOURT_PENALTY = 3;

/**
 * Street-side test for the point just outside a facade: 0 on a carriageway, sidewalk or pedestrian area;
 * FORECOURT_PENALTY on open land within ~8 m of a carriageway or ~4 m of a footway (unmapped forecourts, wide
 * quayside pavements); -1 inside another building, on the water or away from any street.
 */
function streetSide(surface: StreetSurface, footprints: FootprintIndex, land: (x: number, z: number) => number, x: number, z: number): number {
  if (footprints.inside(x, z) || land(x, z) <= 0) {
    return -1;
  }
  const zone = surface.zone(x, z);
  if (zone === Zone.Carriageway || zone === Zone.Sidewalk || zone === Zone.Pedestrian) {
    return 0;
  }
  return surface.distance(x, z) < 7.9 || surface.pathDistance(x, z) < 3.9 ? FORECOURT_PENALTY : -1;
}

/**
 * Places doors on grounded solids: entrance=* nodes on the nearest facade edge (preferring the outline the node is a
 * vertex of, within 3 m), then storefront POIs on the nearest street-facing edge of the building they stand in (or
 * within 8 m of; streetSide()), unless a tagged door of that building is within 4 m (the POI is linked to it instead).
 * Returns POI index -> [solid, door plan] links for the manifest.
 */
export function placeDoors(
  solids: Solid[],
  points: readonly OsmStreetPoint[],
  surface: StreetSurface,
  footprints: FootprintIndex,
  land: (x: number, z: number) => number,
  accept: (p: OsmStreetPoint) => boolean = () => true,
): { stats: DoorStats; poiDoor: Map<number, { solid: Solid; door: DoorPlan | null }> } {
  const grid = new BoxGrid(20);
  const grounded = solids.filter((s) => s.grounded);
  grounded.forEach((s, k) => {
    const b = bounds(s.ring);
    grid.add(k, b.minX - 8, b.minZ - 8, b.maxX + 8, b.maxZ + 8);
  });
  const stats: DoorStats = { entrances: 0, entrancesPlaced: 0, entrancesUnplaced: 0, storefronts: 0, inferredDoors: 0, storefrontsServedByTagged: 0, storefrontsWithoutBuilding: 0, storefrontsWithoutStreetSide: 0, droppedOverlaps: 0, droppedLowWalls: 0 };
  for (const p of points) {
    if (!isEntrance(p) || !accept(p)) {
      continue;
    }
    stats.entrances++;
    let best: { s: Solid; hit: EdgeHit; score: number } | null = null;
    for (const k of grid.at(p.x, p.z)) {
      const s = grounded[k];
      const hit = nearestEdge(s.ring, p.x, p.z);
      const score = hit.dist - (p.building !== undefined && s.rec.osmId === p.building ? 1 : 0);
      if (hit.dist <= 3 && (!best || score < best.score)) {
        best = { s, hit, score };
      }
    }
    if (!best) {
      stats.entrancesUnplaced++;
      continue;
    }
    const [width, height] = entranceSize(p);
    best.s.doors.push({ edge: best.hit.edge, t: best.hit.t, width, height, inferred: false, entrance: p.kind.slice('entrance='.length), bottom: 0, rec: null, pois: [] });
    stats.entrancesPlaced++;
  }
  const poiDoor = new Map<number, { solid: Solid; door: DoorPlan | null }>();
  points.forEach((p, pi) => {
    if (!isStorefront(p) || !accept(p)) {
      return;
    }
    stats.storefronts++;
    let host: Solid | null = null;
    let hostDist = Infinity;
    for (const k of grid.at(p.x, p.z)) {
      const s = grounded[k];
      if (pointInRing(s.ring, p.x, p.z) && !s.holes.some((h) => pointInRing(h, p.x, p.z))) {
        host = s;
        hostDist = 0;
        break;
      }
      const d = nearestEdge(s.ring, p.x, p.z).dist;
      if (d <= 8 && d < hostDist) {
        host = s;
        hostDist = d;
      }
    }
    if (!host) {
      stats.storefrontsWithoutBuilding++;
      return;
    }
    const [w, h] = INFERRED_DOOR;
    let best: { edge: number; t: number; d: number } | null = null;
    for (let i = 0; i < host.ring.length / 2; i++) {
      const e = edgeOf(host.ring, i);
      if (e.len < w + 2 * CORNER_GAP) {
        continue;
      }
      const t = Math.max(w / 2 + CORNER_GAP, Math.min(e.len - w / 2 - CORNER_GAP, (p.x - e.ax) * e.ux + (p.z - e.az) * e.uz));
      const qx = e.ax + e.ux * t;
      const qz = e.az + e.uz * t;
      const penalty = streetSide(surface, footprints, land, qx + e.nx * 1.5, qz + e.nz * 1.5);
      if (penalty < 0) {
        continue;
      }
      const d = Math.hypot(qx - p.x, qz - p.z) + penalty;
      if (!best || d < best.d) {
        best = { edge: i, t, d };
      }
    }
    if (!best) {
      stats.storefrontsWithoutStreetSide++;
      poiDoor.set(pi, { solid: host, door: null });
      return;
    }
    const e = edgeOf(host.ring, best.edge);
    const qx = e.ax + e.ux * best.t;
    const qz = e.az + e.uz * best.t;
    const near = (d: DoorPlan, r: number): boolean => {
      const de = edgeOf(host.ring, d.edge);
      return Math.hypot(de.ax + de.ux * d.t - qx, de.az + de.uz * d.t - qz) < r;
    };
    const tagged = host.doors.find((d) => !d.inferred && near(d, 4));
    if (tagged) {
      stats.storefrontsServedByTagged++;
      poiDoor.set(pi, { solid: host, door: tagged });
      return;
    }
    const shared = host.doors.find((d) => d.inferred && near(d, 2.5));
    if (shared) {
      poiDoor.set(pi, { solid: host, door: shared });
      return;
    }
    const door: DoorPlan = { edge: best.edge, t: best.t, width: w, height: h, inferred: true, entrance: 'shop', bottom: 0, rec: null, pois: [] };
    host.doors.push(door);
    stats.inferredDoors++;
    poiDoor.set(pi, { solid: host, door });
  });
  return { stats, poiDoor };
}

/**
 * Fits the doors of a solid onto their edges (corner gaps, no overlaps: inferred doors yield to tagged ones), sets
 * threshold heights from the ground in front of each door and writes the door records.
 */
export function finalizeDoors(s: Solid, heights: GroundHeights, stats: DoorStats, relink: (from: DoorPlan, to: DoorPlan) => void): void {
  const byEdge = new Map<number, DoorPlan[]>();
  for (const d of s.doors) {
    byEdge.set(d.edge, [...(byEdge.get(d.edge) ?? []), d]);
  }
  const kept: DoorPlan[] = [];
  for (const [edge, list] of byEdge) {
    const e = edgeOf(s.ring, edge);
    list.sort((a, b) => a.t - b.t);
    const edgeKept: DoorPlan[] = [];
    for (const d of list) {
      if (e.len < d.width + 2 * CORNER_GAP) {
        d.width = e.len - 2 * CORNER_GAP;
      }
      if (d.width < 0.7) {
        stats.droppedOverlaps++;
        continue;
      }
      d.t = Math.max(d.width / 2 + CORNER_GAP, Math.min(e.len - d.width / 2 - CORNER_GAP, d.t));
      const prev = edgeKept.at(-1);
      if (prev && d.t - d.width / 2 < prev.t + prev.width / 2 + DOOR_GAP) {
        // Slide right if there is room, otherwise keep the tagged door of the two.
        const slid = prev.t + prev.width / 2 + DOOR_GAP + d.width / 2;
        if (slid <= e.len - d.width / 2 - CORNER_GAP && Math.abs(slid - d.t) < 1.5) {
          d.t = slid;
        } else if (prev.inferred && !d.inferred) {
          edgeKept.pop();
          relink(prev, d);
          stats.droppedOverlaps++;
        } else {
          relink(d, prev);
          stats.droppedOverlaps++;
          continue;
        }
      }
      edgeKept.push(d);
    }
    kept.push(...edgeKept);
  }
  s.doors = [];
  const round2 = (v: number): number => Math.round(v * 100) / 100;
  for (const d of kept) {
    const e = edgeOf(s.ring, d.edge);
    const qx = e.ax + e.ux * d.t;
    const qz = e.az + e.uz * d.t;
    const bottom = Math.max(s.rec.bottomY + 0.02, heights.at(qx + e.nx * 0.6, qz + e.nz * 0.6));
    const room = s.rec.topY - bottom - 0.3;
    if (room < 1.9) {
      stats.droppedLowWalls++;
      continue;
    }
    d.height = Math.min(d.height, room);
    d.bottom = bottom;
    const id = `${s.rec.id}/d${s.doors.length}`;
    const pos: XYZ = [round2(qx), round2(bottom), round2(qz)];
    d.rec = { id, building: s.rec.id, position: pos, normal: [Math.round(e.nx * 1000) / 1000, 0, Math.round(e.nz * 1000) / 1000], width: round2(d.width), height: round2(d.height), depth: RECESS, inferred: d.inferred, entrance: d.entrance, pois: d.pois };
    s.rec.doors.push(id);
    s.doors.push(d);
  }
}

/** Emits walls (with door recesses), the flat roof and, for raised parts, the underside. */
export function emitSolid(s: Solid, mesh: TileMesh): void {
  const { bottomY, topY } = s.rec;
  const rings = [s.ring, ...s.holes];
  rings.forEach((ring, ri) => {
    const n = ring.length / 2;
    for (let i = 0; i < n; i++) {
      const e = edgeOf(ring, i);
      const nrm: Vec3 = [e.nx, 0, e.nz];
      const doors = ri === 0 ? s.doors.filter((d) => d.edge === i).sort((a, b) => a.t - b.t) : [];
      const at = (t: number): [number, number] => [e.ax + e.ux * t, e.az + e.uz * t];
      let t0 = 0;
      for (const d of doors) {
        const l = d.t - d.width / 2;
        const r = d.t + d.width / 2;
        const [lx, lz] = at(l);
        const [rx, rz] = at(r);
        const [sx, sz] = at(t0);
        mesh.wall('wall', sx, sz, lx, lz, bottomY, topY, bottomY, topY, nrm);
        const yb = d.bottom;
        const yt = d.bottom + d.height;
        mesh.wall('wall', lx, lz, rx, rz, bottomY, yb, bottomY, yb, nrm);
        mesh.wall('wall', lx, lz, rx, rz, yt, topY, yt, topY, nrm);
        const ix = -e.nx * RECESS;
        const iz = -e.nz * RECESS;
        const L0: Vec3 = [lx, yb, lz];
        const L1: Vec3 = [lx, yt, lz];
        const R0: Vec3 = [rx, yb, rz];
        const R1: Vec3 = [rx, yt, rz];
        const l0: Vec3 = [lx + ix, yb, lz + iz];
        const l1: Vec3 = [lx + ix, yt, lz + iz];
        const r0: Vec3 = [rx + ix, yb, rz + iz];
        const r1: Vec3 = [rx + ix, yt, rz + iz];
        mesh.flatPolygon('wall', [L0, l0, l1, L1], [e.ux, 0, e.uz]);
        mesh.flatPolygon('wall', [R0, r0, r1, R1], [-e.ux, 0, -e.uz]);
        mesh.flatPolygon('wall', [L1, R1, r1, l1], [0, -1, 0]);
        mesh.flatPolygon(
          'wall',
          [
            [lx, yb + 0.01, lz],
            [rx, yb + 0.01, rz],
            [r0[0], yb + 0.01, r0[2]],
            [l0[0], yb + 0.01, l0[2]],
          ],
          [0, 1, 0],
        );
        mesh.flatPolygon(d.inferred ? 'doorInferred' : 'door', [l0, r0, r1, l1], nrm);
        t0 = r;
      }
      const [sx, sz] = at(t0);
      const [ex, ez] = at(e.len);
      mesh.wall('wall', sx, sz, ex, ez, bottomY, topY, bottomY, topY, nrm);
    }
  });
  const contour = pairs(s.ring);
  const holes = s.holes.map(pairs);
  const tris = THREE.ShapeUtils.triangulateShape(contour, holes);
  const flat = [...contour, ...holes.flat()];
  const idx = tris.flat();
  mesh.flatTriangles(
    'roof',
    flat.map((v) => [v.x, topY, v.y] as Vec3),
    idx,
    [0, 1, 0],
  );
  if (!s.grounded) {
    mesh.flatTriangles(
      'wall',
      flat.map((v) => [v.x, bottomY, v.y] as Vec3),
      idx,
      [0, -1, 0],
    );
  }
}

function pairs(r: readonly number[]): THREE.Vector2[] {
  const out: THREE.Vector2[] = [];
  for (let k = 0; k < r.length; k += 2) {
    out.push(new THREE.Vector2(r[k], r[k + 1]));
  }
  return out;
}
