/**
 * Shared state of the street lane (format 1): the classified streets with a nearest-street index, marked crossings
 * with their dropped kerbs, the S1 spine and arrival square (tools/world-compiler/s1/cameras.json), the street kit
 * tiles and the ground height the street steps build on (the compiled ground minus the dropped kerbs).
 *
 * Built once per compile (streetContext) and kept in AreaContext.shared under 'street'.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BoxGrid, hash, pointInRing } from '../../../../src/world/osm/shared/geometry';
import { classifyStreets, Surf, type Street } from '../../../../src/world/osm/shared/street-field';
import { ROOT } from '../../lib/areas.mjs';
import type { XYZ } from '../format';
import type { OsmStreetRoad } from '../osm-street';
import type { AreaContext, TileContext } from '../registry';

export { hash };

/** Kerb stone: bevel width and height, top width (m). */
export const KERB_BEVEL = 0.02;
export const KERB_WIDTH = 0.15;
/** Gutter band in front of the kerb (m). */
export const GUTTER_WIDTH = 0.3;
/** Coping stones along the quay edge (m). */
export const COPING_WIDTH = 0.5;
/** Dropped kerb: height left above the carriageway (m). */
export const DROPPED_KERB = 0.02;

export interface NearStreet {
  street: Street;
  index: number;
  /** Closest point on the centre line, unit tangent of that segment, distance. */
  px: number;
  pz: number;
  tx: number;
  tz: number;
  dist: number;
}

export interface Crossing {
  /** Carriageway interval of the crossing line: kerb point a, kerb point b. */
  ax: number;
  az: number;
  bx: number;
  bz: number;
  /** Unit tangent of the road at the crossing (traffic direction). */
  tx: number;
  tz: number;
  /** Width of the zebra along the road (m). */
  width: number;
  kind: string;
  street: number;
}

export interface DroppedKerb {
  x: number;
  z: number;
  /** Unit tangent along the kerb and outward normal (away from the carriageway, into the pavement). */
  tx: number;
  tz: number;
  nx: number;
  nz: number;
  half: number;
}

export interface StreetContext {
  streets: Street[];
  /** Per-street axis angle (rad) and origin for paving frames. */
  axis: { angle: number; ox: number; oz: number }[];
  near(x: number, z: number, max: number, accept?: (s: Street) => boolean): NearStreet | null;
  crossings: Crossing[];
  dropped: DroppedKerb[];
  /** Height (m) the dropped kerbs take off the pavement at (x, z). */
  drop(x: number, z: number): number;
  /** Visible ground height with dropped kerbs (no kerb bevel). */
  groundY(x: number, z: number): number;
  /** S1 spine polyline [x, z, ...] and arrival square ring, or empty. */
  spine: number[];
  square: number[];
  /** Tiles that get the full street kit even when greybox (off-spine cameras, e.g. c05). */
  kitTiles: Set<string>;
  /** Distance from (x, z) to the spine polyline. */
  spineDist(x: number, z: number): number;
  inSquare(x: number, z: number): boolean;
}

const MARKED = new Set(['marked', 'zebra', 'traffic_signals', 'uncontrolled', 'yes', 'pelican', 'toucan']);

/** True when the tile gets the street kit (full detail, or a kit tile). */
export function streetTile(t: TileContext): boolean {
  return t.detail === 'full' || streetContext(t.area).kitTiles.has(t.id);
}

function segProject(x: number, z: number, ax: number, az: number, bx: number, bz: number): { t: number; d: number; px: number; pz: number } {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz || 1e-9;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
  const px = ax + dx * t;
  const pz = az + dz * t;
  return { t, d: Math.hypot(x - px, z - pz), px, pz };
}

function readCameras(): { spine: number[]; square: number[]; kit: string[] } {
  const file = resolve(ROOT, 'tools/world-compiler/s1/cameras.json');
  if (!existsSync(file)) {
    return { spine: [], square: [], kit: [] };
  }
  const c = JSON.parse(readFileSync(file, 'utf8')) as {
    strip?: { polyline?: { position: number[] }[]; arrivalSquare?: { polygon?: number[][] } };
    cameras?: { position: number[]; offSpine?: boolean }[];
  };
  const spine = (c.strip?.polyline ?? []).flatMap((p) => [p.position[0], p.position[2]]);
  const square = (c.strip?.arrivalSquare?.polygon ?? []).flatMap((p) => [p[0], p[p.length - 1]]);
  const kit = (c.cameras ?? []).filter((k) => k.offSpine).map((k) => `${Math.floor(k.position[0] / 100)}_${Math.floor(k.position[2] / 100)}`);
  return { spine, square, kit };
}

/** The street lane's shared state (built on first use). */
export function streetContext(a: AreaContext): StreetContext {
  const known = a.shared.get('street') as StreetContext | undefined;
  if (known) {
    return known;
  }
  const s = a.foundation.surface;
  const streets = classifyStreets(a.data.roads);
  const grid = new BoxGrid(20);
  const segs: [number, number, number, number, number][] = [];
  const axis = streets.map((st) => {
    // Length-weighted mean direction (doubled angles, so opposite segments agree).
    let cx = 0;
    let cz = 0;
    for (let k = 2; k < st.pts.length; k += 2) {
      const dx = st.pts[k] - st.pts[k - 2];
      const dz = st.pts[k + 1] - st.pts[k - 1];
      const l = Math.hypot(dx, dz);
      if (l > 1e-6) {
        const ang = Math.atan2(dz, dx) * 2;
        cx += Math.cos(ang) * l;
        cz += Math.sin(ang) * l;
      }
    }
    return { angle: Math.atan2(cz, cx) / 2, ox: st.pts[0], oz: st.pts[1] };
  });
  streets.forEach((st, si) => {
    for (let k = 2; k < st.pts.length; k += 2) {
      const id = segs.push([st.pts[k - 2], st.pts[k - 1], st.pts[k], st.pts[k + 1], si]) - 1;
      const r = st.hw + 12;
      grid.add(id, Math.min(st.pts[k - 2], st.pts[k]) - r, Math.min(st.pts[k - 1], st.pts[k + 1]) - r, Math.max(st.pts[k - 2], st.pts[k]) + r, Math.max(st.pts[k - 1], st.pts[k + 1]) + r);
    }
  });
  const near = (x: number, z: number, max: number, accept?: (st: Street) => boolean): NearStreet | null => {
    let best: NearStreet | null = null;
    for (const id of grid.at(x, z)) {
      const [ax, az, bx, bz, si] = segs[id];
      const st = streets[si];
      if (accept && !accept(st)) {
        continue;
      }
      const p = segProject(x, z, ax, az, bx, bz);
      if (p.d < max && (!best || p.d < best.dist)) {
        const l = Math.hypot(bx - ax, bz - az) || 1;
        best = { street: st, index: si, px: p.px, pz: p.pz, tx: (bx - ax) / l, tz: (bz - az) / l, dist: p.d };
      }
    }
    return best;
  };

  /* Marked crossings: footway=crossing ways and crossing nodes (both with a marked crossing=* value). */
  const crossings: Crossing[] = [];
  const vehicular = (st: Street): boolean => !st.pedestrian && st.surf !== Surf.Cobble && st.surf !== Surf.Granite && st.kind !== 'service';
  const addInterval = (ax: number, az: number, bx: number, bz: number, kind: string): void => {
    const mx = (ax + bx) / 2;
    const mz = (az + bz) / 2;
    const n = near(mx, mz, 14, vehicular);
    const len = Math.hypot(bx - ax, bz - az);
    if (!n || len < 2.5 || len > 24) {
      return;
    }
    const width = n.street.kind.startsWith('primary') || n.street.kind.startsWith('trunk') || n.street.kind.startsWith('secondary') ? 4 : 3;
    crossings.push({ ax, az, bx, bz, tx: n.tx, tz: n.tz, width, kind, street: n.index });
  };
  /** Walks a polyline and adds every stretch that lies on a (vehicular) carriageway. */
  const onCarriageway = (pts: readonly number[], kind: string): void => {
    let px = pts[0];
    let pz = pts[1];
    let pd = s.distance(px, pz);
    // A crossing way often starts on the carriageway raster (wider than the mapped kerb): open at the first point.
    let inside = pd < 0;
    let sx = px;
    let sz = pz;
    for (let k = 2; k < pts.length; k += 2) {
      const len = Math.hypot(pts[k] - pts[k - 2], pts[k + 1] - pts[k - 1]);
      const m = Math.max(1, Math.ceil(len / 0.1));
      for (let i = 1; i <= m; i++) {
        const x = pts[k - 2] + ((pts[k] - pts[k - 2]) * i) / m;
        const z = pts[k - 1] + ((pts[k + 1] - pts[k - 1]) * i) / m;
        const d = s.distance(x, z);
        if (!inside && d < 0 && pd >= 0) {
          const f = pd / (pd - d);
          sx = px + (x - px) * f;
          sz = pz + (z - pz) * f;
          inside = true;
        } else if (inside && d >= 0 && pd < 0) {
          const f = pd / (pd - d);
          addInterval(sx, sz, px + (x - px) * f, pz + (z - pz) * f, kind);
          inside = false;
        }
        px = x;
        pz = z;
        pd = d;
      }
    }
    if (inside) {
      addInterval(sx, sz, px, pz, kind);
    }
  };
  const ways = (a.data.roads as OsmStreetRoad[]).filter((r) => r.kind === 'footway' && r.footway === 'crossing' && MARKED.has(r.crossing ?? 'marked'));
  for (const r of ways) {
    onCarriageway(r.pts, r.crossing ?? 'marked');
  }
  const coveredByWay = (x: number, z: number): boolean => crossings.some((c) => segProject(x, z, c.ax, c.az, c.bx, c.bz).d < 4);
  // The S1 spine crosses Rıhtım Cd on the signalised crossings (P2-P3, P6-P7): mark them where OSM maps none.
  const cam = readCameras();
  const firstSpine = crossings.length;
  onCarriageway(cam.spine, 'traffic_signals');
  for (const c of crossings.splice(firstSpine)) {
    if (!coveredByWay((c.ax + c.bx) / 2, (c.az + c.bz) / 2)) {
      crossings.push(c);
    }
  }
  for (const p of a.data.points) {
    if (p.kind !== 'highway=crossing' || !MARKED.has(p.crossing ?? '') || p.markings === 'no' || coveredByWay(p.x, p.z)) {
      continue;
    }
    const n = near(p.x, p.z, 8, vehicular);
    if (!n || s.distance(p.x, p.z) > 0) {
      continue;
    }
    const cx = -n.tz;
    const cz = n.tx;
    const reach = n.street.hw + 2;
    onCarriageway([p.x - cx * reach, p.z - cz * reach, p.x + cx * reach, p.z + cz * reach], p.crossing ?? 'marked');
  }
  /* Dropped kerbs at both ends of every crossing that meets a kerb. */
  const dropped: DroppedKerb[] = [];
  for (const c of crossings) {
    for (const [x, z, ox, oz] of [
      [c.ax, c.az, c.bx, c.bz],
      [c.bx, c.bz, c.ax, c.az],
    ]) {
      let nx = x - ox;
      let nz = z - oz;
      const l = Math.hypot(nx, nz) || 1;
      nx /= l;
      nz /= l;
      const px = x + nx * 0.5;
      const pz = z + nz * 0.5;
      if (!s.kerbed(px, pz) || s.liftAt(px, pz) < 0.08) {
        continue;
      }
      dropped.push({ x, z, tx: -nz, tz: nx, nx, nz, half: c.width / 2 + 0.3 });
    }
  }
  const dropGrid = new BoxGrid(10);
  dropped.forEach((d, k) => dropGrid.add(k, d.x - 5, d.z - 5, d.x + 5, d.z + 5));
  const drop = (x: number, z: number): number => {
    let w = 0;
    for (const k of dropGrid.at(x, z)) {
      const d = dropped[k];
      const dx = x - d.x;
      const dz = z - d.z;
      const along = Math.abs(dx * d.tx + dz * d.tz);
      const across = dx * d.nx + dz * d.nz;
      if (across < -0.5 || across > 1.6 || along > d.half + 1) {
        continue;
      }
      const wa = along <= d.half ? 1 : 1 - (along - d.half);
      const wc = across <= KERB_WIDTH + 0.05 ? 1 : Math.max(0, 1 - (across - KERB_WIDTH - 0.05) / 1.2);
      w = Math.max(w, wa * wc);
    }
    if (w <= 0) {
      return 0;
    }
    return Math.max(0, s.liftAt(x, z) - DROPPED_KERB) * w;
  };
  const groundY = (x: number, z: number): number => (s.distance(x, z) < 0 ? a.heights.carriage(x, z) : a.heights.off(x, z) - drop(x, z));

  const spineDist = (x: number, z: number): number => {
    let d = Infinity;
    for (let k = 2; k < cam.spine.length; k += 2) {
      d = Math.min(d, segProject(x, z, cam.spine[k - 2], cam.spine[k - 1], cam.spine[k], cam.spine[k + 1]).d);
    }
    return d;
  };
  const ctx: StreetContext = {
    streets,
    axis,
    near,
    crossings,
    dropped,
    drop,
    groundY,
    spine: cam.spine,
    square: cam.square,
    kitTiles: new Set(cam.kit),
    spineDist,
    inSquare: (x, z) => cam.square.length >= 6 && pointInRing(cam.square, x, z),
  };
  a.shared.set('street', ctx);
  return ctx;
}

/** Smooth value noise in [0, 1] (bilinear over a hashed lattice of `cell` metres). */
export function valueNoise(x: number, z: number, cell: number, seed = 0): number {
  const fx = x / cell;
  const fz = z / cell;
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  const u = fx - i;
  const v = fz - j;
  const su = u * u * (3 - 2 * u);
  const sv = v * v * (3 - 2 * v);
  const h = (a: number, b: number): number => hash(a * 157.31 + b * 311.7 + seed * 17.13);
  const a0 = h(i, j) + (h(i + 1, j) - h(i, j)) * su;
  const a1 = h(i, j + 1) + (h(i + 1, j + 1) - h(i, j + 1)) * su;
  return a0 + (a1 - a0) * sv;
}

/** Deterministic pseudo-random stream. */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export const inTile = (t: TileContext, x: number, z: number): boolean => x >= t.bounds.minX && x < t.bounds.maxX && z >= t.bounds.minZ && z < t.bounds.maxZ;

export const xyz = (x: number, y: number, z: number): XYZ => [x, y, z];
