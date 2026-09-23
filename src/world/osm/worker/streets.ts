/**
 * Street surfaces of the OSM prototype, built in the worker:
 * - StreetField: a signed-distance raster of all carriageways (junctions merge naturally, no overlapping ribbons),
 *   plus the surface class and sidewalk width of the winning street per texel. The ground shader reads it.
 * - GroundGrid: one terrain-draped ground mesh covering the area (streets, sidewalks, kerbs and back lots).
 * - Decals (lane dashes, zebra crossings, tram rails), street lamps with their night light pools, OSM trees.
 */
import { LandUse } from '../../../core/contracts';
import type { OsmData, OsmRoad } from '../area';
import { INSTANCE_STRIDE, MASK_RANGE, SIDEWALK_MAX } from '../protocol';
import { BoxGrid, FloatBuf, type GeoSampler, hash, MeshBuf, pointInRing, segDist } from './support';

export const Surf = { Asphalt: 0, Cobble: 1, Granite: 2 } as const;

export interface Street {
  pts: number[];
  hw: number;
  surf: number;
  sidewalk: number;
  rank: number;
  kind: string;
  oneway: boolean;
  lanes: number;
}

const COBBLE_SURFACES = new Set(['sett', 'cobblestone', 'unhewn_cobblestone', 'cobblestone:flattened']);
const ASPHALT_SURFACES = new Set(['asphalt', 'concrete', 'concrete:plates', 'paved']);
const MINOR = new Set(['residential', 'living_street', 'pedestrian', 'unclassified']);
const RANK: Record<string, number> = { trunk: 3, primary: 3, primary_link: 2.5, secondary: 2.5, secondary_link: 2, tertiary: 2, tertiary_link: 1.5 };

function surfaceOf(r: OsmRoad): number {
  if ((r.name && /stiklal/i.test(r.name)) || (r.kind === 'pedestrian' && r.width >= 8)) {
    return Surf.Granite;
  }
  if (r.surface && COBBLE_SURFACES.has(r.surface)) {
    return Surf.Cobble;
  }
  if (r.surface === 'paving_stones') {
    return r.kind === 'pedestrian' ? Surf.Granite : Surf.Cobble;
  }
  if (r.surface && ASPHALT_SURFACES.has(r.surface)) {
    return Surf.Asphalt;
  }
  return MINOR.has(r.kind) && r.width <= 6 ? Surf.Cobble : Surf.Asphalt;
}

export function classifyStreets(roads: readonly OsmRoad[]): Street[] {
  const out: Street[] = [];
  for (const r of roads) {
    if (r.bridge || r.pts.length < 4) {
      continue;
    }
    const surf = surfaceOf(r);
    const major = RANK[r.kind] ?? 0;
    const sidewalk = surf !== Surf.Asphalt ? 0 : major >= 2.5 ? 3.2 : major >= 1.5 ? 2.6 : 2.0;
    const rank = surf === Surf.Granite ? 2.5 : major + (surf === Surf.Asphalt ? 1 : 0.5);
    out.push({ pts: r.pts, hw: r.width / 2, surf, sidewalk, rank, kind: r.kind, oneway: !!r.oneway, lanes: r.lanes ?? 0 });
  }
  return out;
}

export class StreetField {
  readonly size = 2048;
  readonly px: number;
  readonly d: Float32Array;
  private readonly key: Float32Array;
  readonly surf: Uint8Array;
  readonly sw: Float32Array;

  constructor(
    readonly minX: number,
    readonly minZ: number,
    readonly extent: number,
  ) {
    const n = this.size * this.size;
    this.px = extent / this.size;
    this.d = new Float32Array(n).fill(MASK_RANGE);
    this.key = new Float32Array(n).fill(1e9);
    this.surf = new Uint8Array(n);
    this.sw = new Float32Array(n);
  }

  private range(lo: number, hi: number, min: number): [number, number] {
    return [Math.max(0, Math.floor((lo - min) / this.px)), Math.min(this.size - 1, Math.ceil((hi - min) / this.px))];
  }

  stampStreet(s: Street): void {
    const reach = s.hw + MASK_RANGE;
    for (let k = 2; k < s.pts.length; k += 2) {
      const ax = s.pts[k - 2];
      const az = s.pts[k - 1];
      const bx = s.pts[k];
      const bz = s.pts[k + 1];
      const [i0, i1] = this.range(Math.min(ax, bx) - reach, Math.max(ax, bx) + reach, this.minX);
      const [j0, j1] = this.range(Math.min(az, bz) - reach, Math.max(az, bz) + reach, this.minZ);
      for (let j = j0; j <= j1; j++) {
        const z = this.minZ + (j + 0.5) * this.px;
        for (let i = i0; i <= i1; i++) {
          const x = this.minX + (i + 0.5) * this.px;
          const dd = segDist(x, z, ax, az, bx, bz) - s.hw;
          if (dd >= MASK_RANGE) {
            continue;
          }
          const idx = j * this.size + i;
          if (dd < this.d[idx]) {
            this.d[idx] = dd;
          }
          const key = dd < 0 ? dd - s.rank * 100 : dd;
          if (key < this.key[idx]) {
            this.key[idx] = key;
            this.surf[idx] = s.surf;
            this.sw[idx] = s.sidewalk;
          }
        }
      }
    }
  }

  fillPlaza(ring: number[]): void {
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (let k = 0; k < ring.length; k += 2) {
      x0 = Math.min(x0, ring[k]);
      x1 = Math.max(x1, ring[k]);
      z0 = Math.min(z0, ring[k + 1]);
      z1 = Math.max(z1, ring[k + 1]);
    }
    const [i0, i1] = this.range(x0, x1, this.minX);
    const [j0, j1] = this.range(z0, z1, this.minZ);
    for (let j = j0; j <= j1; j++) {
      const z = this.minZ + (j + 0.5) * this.px;
      for (let i = i0; i <= i1; i++) {
        const x = this.minX + (i + 0.5) * this.px;
        if (!pointInRing(ring, x, z)) {
          continue;
        }
        const idx = j * this.size + i;
        this.d[idx] = Math.min(this.d[idx], -1.5);
        const key = -1.5 - 250;
        if (key < this.key[idx]) {
          this.key[idx] = key;
          this.surf[idx] = Surf.Granite;
          this.sw[idx] = 0;
        }
      }
    }
  }

  /** Bilinear signed distance to the nearest carriageway edge (m, capped at MASK_RANGE). */
  distance(x: number, z: number): number {
    let fx = (x - this.minX) / this.px - 0.5;
    let fz = (z - this.minZ) / this.px - 0.5;
    fx = Math.min(this.size - 1.001, Math.max(0, fx));
    fz = Math.min(this.size - 1.001, Math.max(0, fz));
    const i = fx | 0;
    const j = fz | 0;
    const tx = fx - i;
    const tz = fz - j;
    const n = this.size;
    const d = this.d;
    const a = d[j * n + i] + (d[j * n + i + 1] - d[j * n + i]) * tx;
    const b = d[(j + 1) * n + i] + (d[(j + 1) * n + i + 1] - d[(j + 1) * n + i]) * tx;
    return a + (b - a) * tz;
  }

  surfaceAt(x: number, z: number): number {
    const i = Math.min(this.size - 1, Math.max(0, Math.floor((x - this.minX) / this.px)));
    const j = Math.min(this.size - 1, Math.max(0, Math.floor((z - this.minZ) / this.px)));
    return this.surf[j * this.size + i];
  }

  rgba(): Uint8Array {
    const n = this.size * this.size;
    const out = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      out[i * 4] = Math.round(Math.min(1, Math.max(0, (this.d[i] + MASK_RANGE) / (2 * MASK_RANGE))) * 255);
      out[i * 4 + 1] = this.surf[i] === Surf.Cobble ? 255 : 0;
      out[i * 4 + 2] = this.surf[i] === Surf.Granite ? 255 : 0;
      out[i * 4 + 3] = Math.round(Math.min(1, this.sw[i] / SIDEWALK_MAX) * 255);
    }
    return out;
  }
}

const GROUND_STEP = 5;
const GROUND_LIFT = 0.12;
const NO_GROUND_USE = new Set<number>([LandUse.Park, LandUse.Forest, LandUse.Cemetery]);

/** Regular grid of terrain heights; the ground mesh and every decal use the same triangle interpolation. */
export class GroundGrid {
  readonly nx: number;
  readonly nz: number;
  private readonly y: Float32Array;

  constructor(
    private readonly x0: number,
    private readonly z0: number,
    x1: number,
    z1: number,
    private readonly geo: GeoSampler,
  ) {
    this.nx = Math.ceil((x1 - x0) / GROUND_STEP) + 1;
    this.nz = Math.ceil((z1 - z0) / GROUND_STEP) + 1;
    this.y = new Float32Array(this.nx * this.nz);
    for (let j = 0; j < this.nz; j++) {
      for (let i = 0; i < this.nx; i++) {
        this.y[j * this.nx + i] = geo.height(x0 + i * GROUND_STEP, z0 + j * GROUND_STEP) + GROUND_LIFT;
      }
    }
  }

  /** Height of the ground mesh surface at (x, z) (triangles split along the (i+1, j)-(i, j+1) diagonal). */
  yAt(x: number, z: number): number {
    let fx = (x - this.x0) / GROUND_STEP;
    let fz = (z - this.z0) / GROUND_STEP;
    fx = Math.min(this.nx - 1.001, Math.max(0, fx));
    fz = Math.min(this.nz - 1.001, Math.max(0, fz));
    const i = fx | 0;
    const j = fz | 0;
    const u = fx - i;
    const v = fz - j;
    const n = this.nx;
    const ya = this.y[j * n + i];
    const yb = this.y[j * n + i + 1];
    const yc = this.y[(j + 1) * n + i];
    const yd = this.y[(j + 1) * n + i + 1];
    return u + v <= 1 ? ya + (yb - ya) * u + (yc - ya) * v : yd + (yc - yd) * (1 - u) + (yb - yd) * (1 - v);
  }

  build(field: StreetField, reserved: readonly number[]): MeshBuf {
    const mesh = new MeshBuf({ position: 3, normal: 3 });
    const n = this.nx;
    const ids = new Int32Array(this.nx * this.nz).fill(-1);
    const vid = (i: number, j: number): number => {
      const k = j * n + i;
      if (ids[k] < 0) {
        const x = this.x0 + i * GROUND_STEP;
        const z = this.z0 + j * GROUND_STEP;
        const i0 = Math.max(0, i - 1);
        const i1 = Math.min(n - 1, i + 1);
        const j0 = Math.max(0, j - 1);
        const j1 = Math.min(this.nz - 1, j + 1);
        const gx = (this.y[j * n + i1] - this.y[j * n + i0]) / ((i1 - i0) * GROUND_STEP);
        const gz = (this.y[j1 * n + i] - this.y[j0 * n + i]) / ((j1 - j0) * GROUND_STEP);
        const l = Math.hypot(gx, 1, gz);
        ids[k] = mesh.vertex(x, this.y[k], z, -gx / l, 1 / l, -gz / l);
      }
      return ids[k];
    };
    for (let j = 0; j < this.nz - 1; j++) {
      for (let i = 0; i < n - 1; i++) {
        const cx = this.x0 + (i + 0.5) * GROUND_STEP;
        const cz = this.z0 + (j + 0.5) * GROUND_STEP;
        if (this.geo.coast(cx, cz) < 1.5) {
          continue;
        }
        const street = field.distance(cx, cz) < 4;
        if (!street && NO_GROUND_USE.has(this.geo.landUse(cx, cz))) {
          continue;
        }
        let pad = false;
        for (let k = 0; k < reserved.length && !street; k += 3) {
          if ((cx - reserved[k]) ** 2 + (cz - reserved[k + 1]) ** 2 < reserved[k + 2] ** 2) {
            pad = true;
            break;
          }
        }
        if (pad) {
          continue;
        }
        const a = vid(i, j);
        const b = vid(i + 1, j);
        const c = vid(i, j + 1);
        const d = vid(i + 1, j + 1);
        mesh.tri(a, c, b);
        mesh.tri(b, c, d);
      }
    }
    return mesh;
  }
}

type Decal = MeshBuf;

export function decalMesh(): Decal {
  return new MeshBuf({ position: 3, normal: 3, color: 3 });
}

/** Ribbon draped on the ground along a polyline, offset sideways by `offset`; optional dash pattern [on, off]. */
function ribbon(out: Decal, ground: GroundGrid, pts: number[], offset: number, halfWidth: number, lift: number, col: [number, number, number], dash?: [number, number]): void {
  const step = 1;
  let dist = 0;
  let prevL = -1;
  let prevR = -1;
  for (let k = 2; k < pts.length; k += 2) {
    const ax = pts[k - 2];
    const az = pts[k - 1];
    const bx = pts[k];
    const bz = pts[k + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-3) {
      continue;
    }
    const tx = (bx - ax) / len;
    const tz = (bz - az) / len;
    const nx = tz;
    const nz = -tx;
    const m = Math.max(1, Math.ceil(len / step));
    for (let s = k === 2 ? 0 : 1; s <= m; s++) {
      const f = (s / m) * len;
      const x = ax + tx * f + nx * offset;
      const z = az + tz * f + nz * offset;
      const on = !dash || (dist + f) % (dash[0] + dash[1]) < dash[0];
      const lx = x + nx * halfWidth;
      const lz = z + nz * halfWidth;
      const rx = x - nx * halfWidth;
      const rz = z - nz * halfWidth;
      const l = out.vertex(lx, ground.yAt(lx, lz) + lift, lz, 0, 1, 0, ...col);
      const r = out.vertex(rx, ground.yAt(rx, rz) + lift, rz, 0, 1, 0, ...col);
      if (prevL >= 0 && on) {
        out.tri(prevL, prevR, l);
        out.tri(prevR, r, l);
      }
      prevL = l;
      prevR = r;
    }
    dist += len;
  }
}

/** Flat rectangle on the ground: centre, unit direction of the long side, half length / half width. */
function patch(out: Decal, ground: GroundGrid, cx: number, cz: number, tx: number, tz: number, hl: number, hw: number, lift: number, col: [number, number, number]): void {
  ribbon(out, ground, [cx - tx * hl, cz - tz * hl, cx + tx * hl, cz + tz * hl], 0, hw, lift, col);
}

const PAINT: [number, number, number] = [0.72, 0.72, 0.68];
const RAIL: [number, number, number] = [1, 1, 1];

export function buildDecals(streets: readonly Street[], data: OsmData, ground: GroundGrid, field: StreetField): { paint: Decal; rails: Decal; crossings: number } {
  const paint = decalMesh();
  const rails = decalMesh();
  // Lane markings on primary / secondary carriageways only.
  for (const s of streets) {
    if (s.surf !== Surf.Asphalt || s.hw < 3.5 || !(s.kind.startsWith('primary') || s.kind.startsWith('secondary') || s.kind === 'trunk')) {
      continue;
    }
    if (!s.oneway) {
      ribbon(paint, ground, s.pts, 0, 0.07, 0.03, PAINT, [3, 5]);
    } else if (s.lanes >= 2) {
      const lw = (s.hw * 2) / s.lanes;
      for (let l = 1; l < s.lanes; l++) {
        ribbon(paint, ground, s.pts, -s.hw + l * lw, 0.06, 0.03, PAINT, [3, 6]);
      }
    }
  }
  // Zebra crossings at OSM crossing nodes on asphalt streets.
  const segs = new BoxGrid(30);
  const segList: [number, number, number, number, number][] = [];
  streets.forEach((s, si) => {
    if (s.surf !== Surf.Asphalt) {
      return;
    }
    for (let k = 2; k < s.pts.length; k += 2) {
      const id = segList.push([s.pts[k - 2], s.pts[k - 1], s.pts[k], s.pts[k + 1], si]) - 1;
      segs.add(id, Math.min(s.pts[k - 2], s.pts[k]), Math.min(s.pts[k - 1], s.pts[k + 1]), Math.max(s.pts[k - 2], s.pts[k]), Math.max(s.pts[k - 1], s.pts[k + 1]));
    }
  });
  let crossings = 0;
  for (let c = 0; c < data.crossings.length; c += 2) {
    const px = data.crossings[c];
    const pz = data.crossings[c + 1];
    let best = -1;
    let bestD = 3;
    for (const id of segs.at(px, pz)) {
      const [ax, az, bx, bz] = segList[id];
      const d = segDist(px, pz, ax, az, bx, bz);
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    if (best < 0 || field.surfaceAt(px, pz) !== Surf.Asphalt) {
      continue;
    }
    const [ax, az, bx, bz, si] = segList[best];
    const l = Math.hypot(bx - ax, bz - az) || 1;
    const tx = (bx - ax) / l;
    const tz = (bz - az) / l;
    const hw = streets[si].hw;
    const t = ((px - ax) * tx + (pz - az) * tz) / l;
    const cx = ax + (bx - ax) * Math.max(0, Math.min(1, t));
    const cz = az + (bz - az) * Math.max(0, Math.min(1, t));
    for (let o = -hw + 0.55; o <= hw - 0.45; o += 1.0) {
      patch(paint, ground, cx + tz * o, cz - tx * o, tx, tz, 1.5, 0.25, 0.035, PAINT);
    }
    crossings++;
  }
  // Tram rails (Taksim–Tünel nostalgic tram, T1 through Karaköy).
  for (const t of data.trams) {
    const g = t.gauge / 2 + 0.035;
    ribbon(rails, ground, t.pts, g, 0.035, 0.04, RAIL);
    ribbon(rails, ground, t.pts, -g, 0.035, 0.04, RAIL);
  }
  return { paint, rails, crossings };
}

export interface BuildingIndex {
  grid: BoxGrid;
  rings: number[][];
}

function insideBuilding(index: BuildingIndex, x: number, z: number): boolean {
  for (const id of index.grid.at(x, z)) {
    if (pointInRing(index.rings[id], x, z)) {
      return true;
    }
  }
  return false;
}

export interface LampResult {
  arm: Float32Array;
  lantern: Float32Array;
  pool: Uint8Array;
  poolSize: number;
}

/** Lamp posts every ~27 m on alternating sides; rasterises their night light pools. */
export function buildLamps(streets: readonly Street[], ground: GroundGrid, geo: GeoSampler, buildings: BuildingIndex, field: StreetField): LampResult {
  const arm = new FloatBuf();
  const lantern = new FloatBuf();
  const placed = new BoxGrid(12);
  const spots: number[] = [];
  const poolSize = 1024;
  const pool = new Float32Array(poolSize * poolSize);
  const ppx = field.extent / poolSize;
  const splat = (x: number, z: number, radius: number, gain: number): void => {
    const i0 = Math.max(0, Math.floor((x - radius - field.minX) / ppx));
    const i1 = Math.min(poolSize - 1, Math.ceil((x + radius - field.minX) / ppx));
    const j0 = Math.max(0, Math.floor((z - radius - field.minZ) / ppx));
    const j1 = Math.min(poolSize - 1, Math.ceil((z + radius - field.minZ) / ppx));
    for (let j = j0; j <= j1; j++) {
      const pz = field.minZ + (j + 0.5) * ppx;
      for (let i = i0; i <= i1; i++) {
        const px = field.minX + (i + 0.5) * ppx;
        const q = 1 - ((px - x) ** 2 + (pz - z) ** 2) / (radius * radius);
        if (q > 0) {
          pool[j * poolSize + i] += gain * q * q;
        }
      }
    }
  };
  streets.forEach((s, si) => {
    let carry = 8 + hash(si * 3.1) * 12;
    let side = hash(si * 7.7) < 0.5 ? 1 : -1;
    for (let k = 2; k < s.pts.length; k += 2) {
      const ax = s.pts[k - 2];
      const az = s.pts[k - 1];
      const bx = s.pts[k];
      const bz = s.pts[k + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 1e-3) {
        continue;
      }
      const tx = (bx - ax) / len;
      const tz = (bz - az) / len;
      let f = carry;
      while (f < len) {
        const off = s.sidewalk > 0 ? s.hw + 0.55 : Math.max(0.5, s.hw - 0.45);
        const nx = tz * side;
        const nz = -tx * side;
        const x = ax + tx * f + nx * off;
        const z = az + tz * f + nz * off;
        f += 27;
        side = -side;
        if (geo.isWater(x, z) || insideBuilding(buildings, x, z) || (s.sidewalk > 0 && field.distance(x, z) < -0.1)) {
          continue;
        }
        let near = false;
        for (const id of placed.at(x, z)) {
          if ((spots[id * 2] - x) ** 2 + (spots[id * 2 + 1] - z) ** 2 < 14 * 14) {
            near = true;
            break;
          }
        }
        if (near) {
          continue;
        }
        const id = spots.push(x, z) / 2 - 1;
        placed.add(id, x - 14, z - 14, x + 14, z + 14);
        const y = ground.yAt(x, z) - 0.05;
        // Lamp models point their arm / face along local +X; aim it at the street.
        const yaw = Math.atan2(nz, -nx);
        const h = hash(id * 1.37);
        if (s.surf === Surf.Asphalt) {
          arm.push(x, y, z, yaw, 1, 0.95 + 0.1 * h, 1, 1, 1);
          splat(x - nx * 1.7, z - nz * 1.7, 10, 0.9);
        } else {
          lantern.push(x, y, z, yaw, 1, 0.95 + 0.1 * h, 1, 1, 1);
          splat(x, z, 7, 0.8);
        }
      }
      carry = f - len;
    }
  });
  const bytes = new Uint8Array(poolSize * poolSize);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Math.round(Math.min(1, pool[i]) * 255);
  }
  return { arm: arm.take(), lantern: lantern.take(), pool: bytes, poolSize };
}

export function buildTrees(data: OsmData, geo: GeoSampler, buildings: BuildingIndex): Float32Array {
  const out = new FloatBuf();
  const add = (x: number, z: number, i: number): void => {
    if (geo.isWater(x, z) || insideBuilding(buildings, x, z)) {
      return;
    }
    const h = hash(x * 0.37 + z * 0.11 + i);
    const g = 0.75 + 0.3 * h;
    out.push(x, geo.height(x, z) - 0.1, z, h * 6.283, 0.8 + 0.5 * h, 0.85 + 0.45 * hash(h * 91), 0.55 * g, 0.75 * g, 0.42 * g);
  };
  for (let k = 0; k < data.trees.length; k += 2) {
    add(data.trees[k], data.trees[k + 1], k);
  }
  for (const row of data.treeRows) {
    for (let k = 2; k < row.pts.length; k += 2) {
      const ax = row.pts[k - 2];
      const az = row.pts[k - 1];
      const len = Math.hypot(row.pts[k] - ax, row.pts[k + 1] - az);
      for (let f = 0; f < len; f += 8) {
        add(ax + ((row.pts[k] - ax) * f) / len, az + ((row.pts[k + 1] - az) * f) / len, f);
      }
    }
  }
  return out.take();
}

export { INSTANCE_STRIDE };
