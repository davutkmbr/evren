/**
 * Extrudes OSM footprints (worker side) into facade meshes per material, terracotta roofs, cornices, bay windows
 * (cumba), balconies, chimneys and rooftop clutter instances, plus one oriented box collider per building.
 *
 * Facade vertex layout: position, normal, uv (m along wall, m above footprint base), color (tint),
 * aFac (wall length, local ground above base, wall height, seed), aSty (floor height, code).
 * code = kind + 4 * style + 16 * streetFacing + 32 * pitchedRoof; kind 0 wall, 1 plain, 3 railing;
 * style 0 plain apartment, 1 19th-century historic, 2 modern.
 */
import * as THREE from 'three';
import type { OsmBuilding } from '../area';
import { FloatBuf, type GeoSampler, hash, MeshBuf, pointInRing, ringArea, segDist, BoxGrid } from './support';
import type { StreetField } from './streets';

const PARAPET = 1.0;
const EAVE_OVERHANG = 0.4;
const ROOF_PITCH = Math.tan((28 * Math.PI) / 180);

export const FACADE_SETS = ['plaster', 'painted', 'stone', 'concrete', 'brick'] as const;
export type FacadeSet = (typeof FACADE_SETS)[number];

const Kind = { Wall: 0, Plain: 1, Railing: 3 } as const;
const Style = { Plain: 0, Historic: 1, Modern: 2 } as const;

type Palette = [number, number][];
const PLAIN: Palette = [
  [0xefe4c8, 5],
  [0xf1dc9e, 3],
  [0xe8ab8c, 3],
  [0xd2cfc9, 3],
  [0xf3efe6, 2],
  [0xe7c4b6, 2],
  [0xd9a548, 1],
  [0xbfc8cc, 1],
];
const HISTORIC: Palette = [
  [0xe9dfc9, 4],
  [0xdcd0b6, 3],
  [0xefe7d8, 2],
  [0xe4cc9c, 2],
  [0xe3c7b8, 2],
  [0xcfd0c8, 1],
];
const MODERN: Palette = [
  [0xe6e4df, 3],
  [0xcfcac2, 3],
  [0xb9b5ad, 2],
  [0xd8cdbb, 2],
];
const TANK_COLORS: [number, number, number][] = [
  [0.8, 0.8, 0.77],
  [0.3, 0.45, 0.62],
  [0.66, 0.58, 0.42],
  [0.5, 0.5, 0.5],
];

const RESIDENTIAL = new Set(['yes', 'apartments', 'house', 'residential', 'detached', 'terrace', 'semidetached_house']);
const MODERN_KINDS = new Set(['office', 'hotel', 'hospital', 'university', 'school', 'commercial', 'retail', 'industrial', 'warehouse', 'government']);
const SMALL_KINDS: Record<string, [number, number]> = {
  house: [2, 3],
  kiosk: [1, 1],
  garage: [1, 1],
  garages: [1, 1],
  shed: [1, 1],
  service: [1, 1],
  hut: [1, 1],
  mosque: [2, 2],
  church: [3, 4],
  synagogue: [3, 3],
  industrial: [2, 3],
  warehouse: [2, 3],
  school: [4, 5],
  university: [4, 6],
  hospital: [5, 7],
  hotel: [5, 8],
  office: [5, 8],
};
const SKIP_KINDS = new Set(['roof', 'ruins', 'collapsed', 'bridge']);

const FACADE_LAYOUT = { position: 3, normal: 3, uv: 2, color: 3, aFac: 4, aSty: 2 };
const ROOF_LAYOUT = { position: 3, normal: 3, uv: 2, color: 3 };

type V3 = [number, number, number];

interface Obb {
  cx: number;
  cz: number;
  dx: number;
  dz: number;
  hl: number;
  hw: number;
  area: number;
}

function hullArea(r: number[]): number {
  const pts: [number, number][] = [];
  for (let i = 0; i < r.length; i += 2) {
    pts.push([r[i], r[i + 1]]);
  }
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list: [number, number][]) => {
    const out: [number, number][] = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) {
        out.pop();
      }
      out.push(p);
    }
    return out;
  };
  const lower = half(pts);
  const upper = half([...pts].reverse());
  return Math.abs(ringArea(lower.slice(0, -1).concat(upper.slice(0, -1)).flat()));
}

function orientedBox(r: number[]): Obb {
  const n = r.length / 2;
  let best: Obb = { area: Infinity, cx: 0, cz: 0, dx: 1, dz: 0, hl: 0, hw: 0 };
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    let dx = r[j * 2] - r[i * 2];
    let dz = r[j * 2 + 1] - r[i * 2 + 1];
    const len = Math.hypot(dx, dz);
    if (len < 0.5) {
      continue;
    }
    dx /= len;
    dz /= len;
    let s0 = Infinity;
    let s1 = -Infinity;
    let t0 = Infinity;
    let t1 = -Infinity;
    for (let k = 0; k < n; k++) {
      const s = r[k * 2] * dx + r[k * 2 + 1] * dz;
      const t = -r[k * 2] * dz + r[k * 2 + 1] * dx;
      s0 = Math.min(s0, s);
      s1 = Math.max(s1, s);
      t0 = Math.min(t0, t);
      t1 = Math.max(t1, t);
    }
    const area = (s1 - s0) * (t1 - t0);
    if (area < best.area) {
      const sc = (s0 + s1) / 2;
      const tc = (t0 + t1) / 2;
      const cx = sc * dx - tc * dz;
      const cz = sc * dz + tc * dx;
      const along = (s1 - s0) / 2;
      const across = (t1 - t0) / 2;
      best = along >= across ? { area, cx, cz, dx, dz, hl: along, hw: across } : { area, cx, cz, dx: -dz, dz: dx, hl: across, hw: along };
    }
  }
  return best;
}

/** World point of OBB coordinates (s along the long axis, t across). */
function obbPoint(b: Obb, s: number, t: number): [number, number] {
  return [b.cx + b.dx * s - b.dz * t, b.cz + b.dz * s + b.dx * t];
}

function pick(p: Palette, h: number, out: THREE.Color): THREE.Color {
  const total = p.reduce((s, e) => s + e[1], 0);
  let t = h * total;
  for (const [hex, w] of p) {
    t -= w;
    if (t <= 0) {
      return out.setHex(hex);
    }
  }
  return out.setHex(p[0][0]);
}

/** Outward offset ring (mitred), as flat x, z. */
function offsetRing(r: number[], dist: number): number[] {
  const n = r.length / 2;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = (i + n - 1) % n;
    const q = (i + 1) % n;
    const e1x = r[i * 2] - r[p * 2];
    const e1z = r[i * 2 + 1] - r[p * 2 + 1];
    const e2x = r[q * 2] - r[i * 2];
    const e2z = r[q * 2 + 1] - r[i * 2 + 1];
    const l1 = Math.hypot(e1x, e1z) || 1;
    const l2 = Math.hypot(e2x, e2z) || 1;
    let mx = e1z / l1 + e2z / l2;
    let mz = -e1x / l1 - e2x / l2;
    const ml = Math.hypot(mx, mz) || 1;
    mx /= ml;
    mz /= ml;
    const cosHalf = Math.max(0.5, mx * (e2z / l2) + mz * (-e2x / l2));
    out.push(r[i * 2] + (mx * dist) / cosHalf, r[i * 2 + 1] + (mz * dist) / cosHalf);
  }
  return out;
}

export interface BuildingOutput {
  facades: Record<FacadeSet, MeshBuf>;
  roof: MeshBuf;
  colliders: Float32Array;
  instances: Record<'chimney' | 'tank' | 'solar' | 'dish', Float32Array>;
  index: { grid: BoxGrid; rings: number[][] };
  stats: Record<string, number>;
}

export function buildBuildings(buildings: readonly OsmBuilding[], geo: GeoSampler, field: StreetField, reserved: readonly number[], rect: { minX: number; maxX: number; minZ: number; maxZ: number }): BuildingOutput {
  const facades = Object.fromEntries(FACADE_SETS.map((k) => [k, new MeshBuf(FACADE_LAYOUT)])) as Record<FacadeSet, MeshBuf>;
  const roof = new MeshBuf(ROOF_LAYOUT);
  const colliders = new FloatBuf();
  const inst = { chimney: new FloatBuf(), tank: new FloatBuf(), solar: new FloatBuf(), dish: new FloatBuf() };
  const grid = new BoxGrid(20);
  const rings: number[][] = [];
  const stats = { built: 0, skippedReserved: 0, pitched: 0, gabled: 0, historic: 0, modern: 0, cumba: 0, balconies: 0, cornices: 0 };
  const tint = new THREE.Color();
  const light = new THREE.Color();
  const grey = new THREE.Color();
  const roofTint = new THREE.Color();

  /** Adds a planar polygon (fan) with the winding that matches `n`. */
  const face = (buf: MeshBuf, pts: V3[], n: V3, uv: (p: V3) => [number, number], col: THREE.Color, fac: number[], sty: number[] | null): void => {
    const ax = pts[1][0] - pts[0][0];
    const ay = pts[1][1] - pts[0][1];
    const az = pts[1][2] - pts[0][2];
    const bx = pts[2][0] - pts[0][0];
    const by = pts[2][1] - pts[0][1];
    const bz = pts[2][2] - pts[0][2];
    const cx = ay * bz - az * by;
    const cy = az * bx - ax * bz;
    const cz = ax * by - ay * bx;
    const flip = cx * n[0] + cy * n[1] + cz * n[2] < 0;
    const ids = pts.map((p) => {
      const [u, v] = uv(p);
      return sty ? buf.vertex(p[0], p[1], p[2], n[0], n[1], n[2], u, v, col.r, col.g, col.b, fac[0], fac[1], fac[2], fac[3], sty[0], sty[1]) : buf.vertex(p[0], p[1], p[2], n[0], n[1], n[2], u, v, col.r, col.g, col.b);
    });
    for (let i = 1; i < ids.length - 1; i++) {
      if (flip) {
        buf.tri(ids[0], ids[i + 1], ids[i]);
      } else {
        buf.tri(ids[0], ids[i], ids[i + 1]);
      }
    }
  };

  buildings.forEach((b, bi) => {
    const r = b.ring;
    const count = r.length / 2;
    if (count < 3 || SKIP_KINDS.has(b.kind)) {
      return;
    }
    const area = ringArea(r);
    let cx = 0;
    let cz = 0;
    for (let i = 0; i < count; i++) {
      cx += r[i * 2];
      cz += r[i * 2 + 1];
    }
    cx /= count;
    cz /= count;
    if (cx < rect.minX || cx > rect.maxX || cz < rect.minZ || cz > rect.maxZ || geo.isWater(cx, cz)) {
      return;
    }
    for (let k = 0; k < reserved.length; k += 3) {
      if ((cx - reserved[k]) ** 2 + (cz - reserved[k + 1]) ** 2 < reserved[k + 2] ** 2) {
        stats.skippedReserved++;
        return;
      }
    }

    const seed = hash(bi * 1.618 + cx * 0.013 + cz * 0.007);
    const h1 = hash(seed * 91.7);
    const h2 = hash(seed * 53.3);
    const h3 = hash(seed * 29.1);
    const h4 = hash(seed * 13.9);
    const residential = RESIDENTIAL.has(b.kind);

    let floors = b.levels ?? (b.height ? Math.max(1, Math.round(b.height / 3.2)) : 0);
    if (!floors) {
      const range = SMALL_KINDS[b.kind];
      floors = range ? range[0] + Math.floor(h1 * (range[1] - range[0] + 1)) : area < 35 ? 2 + Math.floor(h1 * 2) : area < 90 ? 3 + Math.floor(h1 * 3) : 4 + Math.floor(h1 * 4);
    }
    const modern = floors >= 8 || area > 1100 || (MODERN_KINDS.has(b.kind) && h3 < 0.75);
    const historic = !modern && residential && floors >= 3 && floors <= 7 && h3 < 0.4;
    const style = modern ? Style.Modern : historic ? Style.Historic : Style.Plain;
    const floorH = modern ? 3.3 : historic ? 3.9 : 3.0;

    let set: FacadeSet;
    if (modern) {
      set = h4 < 0.7 ? 'concrete' : 'painted';
      pick(MODERN, h2, tint).multiplyScalar(0.8 + 0.12 * h1);
      stats.modern++;
    } else if (historic) {
      set = h4 < 0.45 ? 'stone' : h4 < 0.7 ? 'painted' : 'plaster';
      pick(HISTORIC, h2, tint);
      if (set === 'stone') {
        tint.lerp(light.setRGB(1, 1, 1), 0.55);
      }
      tint.multiplyScalar(0.8 + 0.12 * h1);
      stats.historic++;
    } else if (floors <= 6 && h4 < 0.1) {
      set = 'brick';
      tint.setRGB(0.92 + 0.12 * h1, 0.9 + 0.1 * h2, 0.88 + 0.1 * h1, THREE.SRGBColorSpace);
    } else {
      set = h4 < 0.55 ? 'plaster' : 'painted';
      pick(PLAIN, h2, tint).multiplyScalar(0.78 + 0.12 * h1);
    }
    const walls = facades[set];
    light.copy(tint).multiplyScalar(1.1);

    const ground: number[] = [];
    let gMin = Infinity;
    let gMax = -Infinity;
    for (let i = 0; i < count; i++) {
      const g = geo.height(r[i * 2], r[i * 2 + 1]);
      ground.push(g);
      gMin = Math.min(gMin, g);
      gMax = Math.max(gMax, g);
    }
    const gRef = gMin + 0.5 * (gMax - gMin);
    const convex = area / Math.max(1e-3, hullArea(r));
    const box = orientedBox(r);
    const rectangular = count === 4 && area / Math.max(1e-3, box.area) > 0.9;
    const pitched = !modern && (b.roof ? b.roof !== 'flat' : residential && floors <= 6 && area < 650 && convex > 0.9 && count <= 10 && h2 < 0.7);
    const gabled = pitched && rectangular && (b.roof === 'gabled' || (!b.roof && hash(seed * 3.3) < 0.35));
    const height = b.height ?? floors * floorH + (pitched ? 0.4 : PARAPET);
    const top = gRef + height;
    const base = gMin - 1.5;
    const wallH = top - gMin;
    const lowRise = wallH < 24;
    const codeBase = 4 * style + (pitched ? 32 : 0);

    // Outer walls; remember street-facing edges for shops, bay windows and balconies.
    let bestEdge = -1;
    let bestLen = 0;
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % count;
      const ax = r[i * 2];
      const az = r[i * 2 + 1];
      const bx = r[j * 2];
      const bz = r[j * 2 + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.05) {
        continue;
      }
      const nx = (bz - az) / len;
      const nz = -(bx - ax) / len;
      const street = field.distance((ax + bx) / 2 + nx * 3, (az + bz) / 2 + nz * 3) < 1.5;
      if (street && len > bestLen) {
        bestLen = len;
        bestEdge = i;
      }
      const code = codeBase + (street ? 16 : 0);
      const ga = ground[i] - gMin;
      const gb = ground[j] - gMin;
      const a0 = walls.vertex(ax, base, az, nx, 0, nz, 0, base - gMin, tint.r, tint.g, tint.b, len, ga, wallH, seed, floorH, code);
      const a1 = walls.vertex(ax, top, az, nx, 0, nz, 0, wallH, tint.r, tint.g, tint.b, len, ga, wallH, seed, floorH, code);
      const b1 = walls.vertex(bx, top, bz, nx, 0, nz, len, wallH, tint.r, tint.g, tint.b, len, gb, wallH, seed, floorH, code);
      const b0 = walls.vertex(bx, base, bz, nx, 0, nz, len, base - gMin, tint.r, tint.g, tint.b, len, gb, wallH, seed, floorH, code);
      walls.quad(a0, a1, b1, b0);
    }

    const plainSty = [floorH, codeBase + Kind.Plain];
    const plainFac = [1, 0, wallH, seed];

    // Cornice: a projecting moulding under the parapet / eave (all historic, some plain buildings).
    if (historic || (!modern && h1 < 0.45)) {
      const proj = historic ? 0.45 : 0.28;
      const yb = pitched ? top - 0.5 : top - PARAPET - (historic ? 0.55 : 0.35);
      const yt = pitched ? top - 0.02 : top - PARAPET + 0.08;
      const o = offsetRing(r, proj);
      for (let i = 0; i < count; i++) {
        const j = (i + 1) % count;
        const w0: V3 = [r[i * 2], yb, r[i * 2 + 1]];
        const w1: V3 = [r[j * 2], yb, r[j * 2 + 1]];
        const p0: V3 = [o[i * 2], yb, o[i * 2 + 1]];
        const p1: V3 = [o[j * 2], yb, o[j * 2 + 1]];
        const len = Math.hypot(p1[0] - p0[0], p1[2] - p0[2]) || 1;
        const nx = (p1[2] - p0[2]) / len;
        const nz = -(p1[0] - p0[0]) / len;
        const uvW = (p: V3): [number, number] => [(p[0] - p0[0]) * -nz + (p[2] - p0[2]) * nx, p[1] - gMin];
        face(walls, [w0, w1, p1, p0], [0, -1, 0], (p) => [p[0], p[2]], light, plainFac, plainSty);
        face(walls, [p0, p1, [p1[0], yt, p1[2]], [p0[0], yt, p0[2]]], [nx, 0, nz], uvW, light, plainFac, plainSty);
        face(walls, [[p0[0], yt, p0[2]], [p1[0], yt, p1[2]], [w1[0], yt, w1[2]], [w0[0], yt, w0[2]]], [0, 1, 0], (p) => [p[0], p[2]], light, plainFac, plainSty);
      }
      stats.cornices++;
    }

    // Bay window (cumba) or balconies on the longest street-facing wall.
    if (bestEdge >= 0 && bestLen >= 6.5 && !modern && lowRise && floors >= 3 && (historic ? h2 < 0.6 : residential && h2 < 0.25)) {
      const i = bestEdge;
      const j = (i + 1) % count;
      const ax = r[i * 2];
      const az = r[i * 2 + 1];
      const dx = (r[j * 2] - ax) / bestLen;
      const dz = (r[j * 2 + 1] - az) / bestLen;
      const nx = dz;
      const nz = -dx;
      const bayW = historic ? 2.6 : 2.8;
      const nb = Math.max(1, Math.floor(bestLen / bayW + 0.3));
      const bw = bestLen / nb;
      const c = Math.floor(nb / 2);
      const u0 = c * bw;
      const u1 = u0 + bw;
      const mx = ax + dx * (u0 + bw / 2);
      const mz = az + dz * (u0 + bw / 2);
      const gl = geo.height(mx, mz) - gMin;
      const r0 = Math.floor((gl + 0.9) / floorH) + 1;
      const y0 = gMin + r0 * floorH - 0.05;
      const y1 = pitched ? top - 0.55 : top - PARAPET - 0.7;
      if (y1 - y0 > floorH * 1.4) {
        const D = 0.85;
        const A: [number, number] = [ax + dx * u0, az + dz * u0];
        const B: [number, number] = [ax + dx * u1, az + dz * u1];
        const A2: [number, number] = [A[0] + nx * D, A[1] + nz * D];
        const B2: [number, number] = [B[0] + nx * D, B[1] + nz * D];
        const cFac = [bw, gl, y1 - gMin + 0.7, seed];
        const cSty = [floorH, codeBase + 16];
        const along = (p: V3): [number, number] => [(p[0] - A2[0]) * dx + (p[2] - A2[1]) * dz, p[1] - gMin];
        face(walls, [[A2[0], y0, A2[1]], [B2[0], y0, B2[1]], [B2[0], y1, B2[1]], [A2[0], y1, A2[1]]], [nx, 0, nz], along, tint, cFac, cSty);
        const sideFac = [D, gl, y1 - gMin + 0.7, seed];
        const across = (p: V3): [number, number] => [Math.abs((p[0] - A[0]) * nx + (p[2] - A[1]) * nz), p[1] - gMin];
        face(walls, [[A[0], y0, A[1]], [A2[0], y0, A2[1]], [A2[0], y1, A2[1]], [A[0], y1, A[1]]], [-dx, 0, -dz], across, tint, sideFac, cSty);
        face(walls, [[B2[0], y0, B2[1]], [B[0], y0, B[1]], [B[0], y1, B[1]], [B2[0], y1, B2[1]]], [dx, 0, dz], across, tint, sideFac, cSty);
        face(walls, [[A[0], y0, A[1]], [B[0], y0, B[1]], [B2[0], y0, B2[1]], [A2[0], y0, A2[1]]], [0, -1, 0], (p) => [p[0], p[2]], light, plainFac, plainSty);
        face(walls, [[A[0], y1, A[1]], [B[0], y1, B[1]], [B2[0], y1, B2[1]], [A2[0], y1, A2[1]]], [0, 1, 0], (p) => [p[0], p[2]], light, plainFac, plainSty);
        stats.cumba++;
      }
    } else if (bestEdge >= 0 && bestLen >= 6 && residential && !historic && lowRise && floors >= 3 && h2 > 0.62) {
      const i = bestEdge;
      const j = (i + 1) % count;
      const dx = (r[j * 2] - r[i * 2]) / bestLen;
      const dz = (r[j * 2 + 1] - r[i * 2 + 1]) / bestLen;
      const nx = dz;
      const nz = -dx;
      const bayW = modern ? 3.2 : 2.8;
      const nb = Math.max(1, Math.floor(bestLen / bayW + 0.3));
      const bw = bestLen / nb;
      const b0 = nb >= 3 ? 1 : 0;
      const b1 = nb >= 3 ? nb - 1 : nb;
      const ax = r[i * 2] + dx * b0 * bw;
      const az = r[i * 2 + 1] + dz * b0 * bw;
      const W = (b1 - b0) * bw;
      const gl = geo.height(ax + dx * W * 0.5, az + dz * W * 0.5) - gMin;
      const rStart = Math.floor((gl + 0.9) / floorH) + 1;
      grey.setRGB(0.42, 0.41, 0.39);
      const railSty = [floorH, codeBase + Kind.Railing];
      for (let row = rStart; (row + 1) * floorH <= wallH - 0.7 - (pitched ? 0 : PARAPET); row++) {
        const y = gMin + row * floorH;
        const D = 1.05;
        const P0: [number, number] = [ax, az];
        const P1: [number, number] = [ax + dx * W, az + dz * W];
        const Q0: [number, number] = [P0[0] + nx * D, P0[1] + nz * D];
        const Q1: [number, number] = [P1[0] + nx * D, P1[1] + nz * D];
        const xz = (p: V3): [number, number] => [p[0], p[2]];
        face(walls, [[P0[0], y, P0[1]], [P1[0], y, P1[1]], [Q1[0], y, Q1[1]], [Q0[0], y, Q0[1]]], [0, 1, 0], xz, grey, plainFac, plainSty);
        face(walls, [[P0[0], y - 0.16, P0[1]], [P1[0], y - 0.16, P1[1]], [Q1[0], y - 0.16, Q1[1]], [Q0[0], y - 0.16, Q0[1]]], [0, -1, 0], xz, grey, plainFac, plainSty);
        face(walls, [[Q0[0], y - 0.16, Q0[1]], [Q1[0], y - 0.16, Q1[1]], [Q1[0], y, Q1[1]], [Q0[0], y, Q0[1]]], [nx, 0, nz], (p) => [(p[0] - Q0[0]) * dx + (p[2] - Q0[1]) * dz, p[1] - gMin], grey, plainFac, plainSty);
        const rail = (p: V3): [number, number] => [(p[0] - Q0[0]) * dx + (p[2] - Q0[1]) * dz, p[1] - y];
        const R0: V3 = [Q0[0] - nx * 0.03, y, Q0[1] - nz * 0.03];
        const R1: V3 = [Q1[0] - nx * 0.03, y, Q1[1] - nz * 0.03];
        face(walls, [R0, R1, [R1[0], y + 1.0, R1[2]], [R0[0], y + 1.0, R0[2]]], [nx, 0, nz], rail, grey, plainFac, railSty);
        face(walls, [R0, R1, [R1[0], y + 1.0, R1[2]], [R0[0], y + 1.0, R0[2]]], [-nx, 0, -nz], rail, grey, plainFac, railSty);
      }
      stats.balconies++;
    }

    if (pitched) {
      stats.pitched++;
      roofTint.setRGB(0.85 + 0.25 * h1, 0.85 + 0.2 * h2, 0.85 + 0.2 * h2, THREE.SRGBColorSpace);
      if (h2 < 0.12) {
        roofTint.multiplyScalar(0.7);
      }
      const rise = Math.min(4.5, box.hw * ROOF_PITCH);
      const eaveY = top - EAVE_OVERHANG * ROOF_PITCH;
      const roofFace = (pts: V3[], eaveA: V3, eaveB: V3): void => {
        const ex = eaveB[0] - eaveA[0];
        const ez = eaveB[2] - eaveA[2];
        const el = Math.hypot(ex, ez) || 1;
        const ux = pts[1][0] - pts[0][0];
        const uy = pts[1][1] - pts[0][1];
        const uz = pts[1][2] - pts[0][2];
        const vx = pts[2][0] - pts[0][0];
        const vy = pts[2][1] - pts[0][1];
        const vz = pts[2][2] - pts[0][2];
        let nx = uy * vz - uz * vy;
        let ny = uz * vx - ux * vz;
        let nz = ux * vy - uy * vx;
        const nl = Math.hypot(nx, ny, nz) || 1;
        nx /= nl;
        ny /= nl;
        nz /= nl;
        if (ny < 0) {
          nx = -nx;
          ny = -ny;
          nz = -nz;
        }
        face(
          roof,
          pts,
          [nx, ny, nz],
          (p) => {
            const px = p[0] - eaveA[0];
            const pz = p[2] - eaveA[2];
            return [(px * ex + pz * ez) / el, Math.hypot(Math.abs(px * ez - pz * ex) / el, p[1] - eaveA[1])];
          },
          roofTint,
          [],
          null,
        );
      };
      if (gabled) {
        stats.gabled++;
        const L = box.hl + 0.3;
        const Wd = box.hw + EAVE_OVERHANG;
        const P = (s: number, t: number, y: number): V3 => {
          const [x, z] = obbPoint(box, s, t);
          return [x, y, z];
        };
        const ridgeY = top + rise;
        for (const side of [1, -1]) {
          const e0 = P(-L, side * Wd, eaveY);
          const e1 = P(L, side * Wd, eaveY);
          roofFace([e0, e1, P(L, 0, ridgeY), P(-L, 0, ridgeY)], e0, e1);
          // Gable end wall (triangle above the eave, facade material).
          const g0 = P(side * box.hl, -box.hw, top);
          const g1 = P(side * box.hl, box.hw, top);
          const g2 = P(side * box.hl, 0, ridgeY);
          const gnx = box.dx * side;
          const gnz = box.dz * side;
          face(walls, [g0, g1, g2], [gnx, 0, gnz], (p) => [(p[0] - g0[0]) * -gnz + (p[2] - g0[2]) * gnx, p[1] - gMin], tint, [box.hw * 2, 0, wallH, seed], [floorH, codeBase]);
        }
      } else {
        const ridgeHalf = Math.max(0, box.hl - box.hw);
        const ridge: V3[] = [
          [box.cx + box.dx * ridgeHalf, top + rise, box.cz + box.dz * ridgeHalf],
          [box.cx - box.dx * ridgeHalf, top + rise, box.cz - box.dz * ridgeHalf],
        ];
        const eave = offsetRing(r, EAVE_OVERHANG);
        const side: number[] = [];
        for (let i = 0; i < count; i++) {
          side.push((r[i * 2] - box.cx) * box.dx + (r[i * 2 + 1] - box.cz) * box.dz >= 0 ? 0 : 1);
        }
        for (let i = 0; i < count; i++) {
          const j = (i + 1) % count;
          const a: V3 = [eave[i * 2], eaveY, eave[i * 2 + 1]];
          const bb: V3 = [eave[j * 2], eaveY, eave[j * 2 + 1]];
          roofFace(side[i] === side[j] ? [a, bb, ridge[side[i]]] : [a, bb, ridge[side[j]], ridge[side[i]]], a, bb);
        }
      }
      // Chimneys.
      const nCh = h4 < 0.4 ? 1 + (h1 < 0.3 ? 1 : 0) : 0;
      for (let k = 0; k < nCh; k++) {
        const s = (hash(seed * 7 + k) - 0.5) * 1.2 * box.hl;
        const t = (hash(seed * 11 + k) < 0.5 ? -1 : 1) * box.hw * 0.3;
        const roofY = top + Math.min(box.hw - Math.abs(t), gabled ? Infinity : box.hl - Math.abs(s)) * ROOF_PITCH;
        const [x, z] = obbPoint(box, s, t);
        const brickCh = hash(seed * 5 + k) < 0.5;
        inst.chimney.push(x, roofY - 0.5, z, -Math.atan2(box.dz, box.dx), 0.55 + 0.2 * h2, 1.4 + 0.6 * h1, brickCh ? 0.42 : tint.r, brickCh ? 0.16 : tint.g, brickCh ? 0.1 : tint.b);
      }
    } else {
      // Flat roof slab (concrete) below the parapet, inner parapet faces, rooftop clutter.
      const roofY = top - PARAPET;
      const rk = hash(seed * 61.7);
      if (rk < 0.45) {
        grey.setRGB(0.6 + 0.12 * h1, 0.59 + 0.12 * h1, 0.57 + 0.1 * h2, THREE.SRGBColorSpace);
      } else if (rk < 0.65) {
        grey.setRGB(0.8, 0.79, 0.76, THREE.SRGBColorSpace);
      } else if (rk < 0.8) {
        grey.setRGB(0.3, 0.3, 0.31, THREE.SRGBColorSpace);
      } else {
        grey.setRGB(0.66, 0.46, 0.38, THREE.SRGBColorSpace);
      }
      const contour: THREE.Vector2[] = [];
      for (let i = 0; i < count; i++) {
        contour.push(new THREE.Vector2(r[i * 2], r[i * 2 + 1]));
      }
      const slab = facades.concrete;
      const roofSty = [floorH, Kind.Plain];
      const start = slab.count;
      for (let i = 0; i < count; i++) {
        slab.vertex(r[i * 2], roofY, r[i * 2 + 1], 0, 1, 0, r[i * 2], r[i * 2 + 1], grey.r, grey.g, grey.b, 0, 0, 0, seed, roofSty[0], roofSty[1]);
      }
      for (const t of THREE.ShapeUtils.triangulateShape(contour, [])) {
        const [p, q, s] = t.map((k) => contour[k]);
        const up = (q.x - p.x) * (s.y - p.y) - (q.y - p.y) * (s.x - p.x);
        if (up <= 0) {
          slab.tri(start + t[0], start + t[1], start + t[2]);
        } else {
          slab.tri(start + t[0], start + t[2], start + t[1]);
        }
      }
      for (let i = 0; i < count; i++) {
        const j = (i + 1) % count;
        const ax = r[i * 2];
        const az = r[i * 2 + 1];
        const bx = r[j * 2];
        const bz = r[j * 2 + 1];
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 0.05) {
          continue;
        }
        const nx = -(bz - az) / len;
        const nz = (bx - ax) / len;
        const a0 = walls.vertex(ax, roofY, az, nx, 0, nz, 0, roofY - gMin, tint.r, tint.g, tint.b, len, 0, wallH, seed, floorH, codeBase + Kind.Plain);
        const a1 = walls.vertex(ax, top, az, nx, 0, nz, 0, wallH, tint.r, tint.g, tint.b, len, 0, wallH, seed, floorH, codeBase + Kind.Plain);
        const b1 = walls.vertex(bx, top, bz, nx, 0, nz, len, wallH, tint.r, tint.g, tint.b, len, 0, wallH, seed, floorH, codeBase + Kind.Plain);
        const b0 = walls.vertex(bx, roofY, bz, nx, 0, nz, len, roofY - gMin, tint.r, tint.g, tint.b, len, 0, wallH, seed, floorH, codeBase + Kind.Plain);
        walls.quad(b0, b1, a1, a0);
      }
      if (area >= 40) {
        const place = (tries: number, margin: number): [number, number] | null => {
          for (let k = 0; k < tries; k++) {
            const s = (hash(seed * 17.3 + k * 1.7 + inst.tank.length) - 0.5) * 2 * Math.max(0, box.hl - margin);
            const t = (hash(seed * 23.9 + k * 2.3 + inst.solar.length) - 0.5) * 2 * Math.max(0, box.hw - margin);
            const [x, z] = obbPoint(box, s, t);
            if (!pointInRing(r, x, z)) {
              continue;
            }
            let edge = Infinity;
            for (let e = 0; e < count; e++) {
              const f = (e + 1) % count;
              edge = Math.min(edge, segDist(x, z, r[e * 2], r[e * 2 + 1], r[f * 2], r[f * 2 + 1]));
            }
            if (edge >= margin) {
              return [x, z];
            }
          }
          return null;
        };
        const budget = Math.min(8, Math.floor(area / 20));
        const tanks = h1 < 0.8 ? Math.min(budget, 1 + Math.floor(h3 * 4)) : 0;
        const solars = h2 < 0.55 ? Math.min(budget, 1 + Math.floor(h4 * 3)) : 0;
        if (area > 90 && hash(seed * 43.1) < 0.55) {
          const p = place(12, 2.2);
          if (p) {
            inst.chimney.push(p[0], roofY, p[1], -Math.atan2(box.dz, box.dx), 2.4 + 0.8 * h2, 2.3 + 0.4 * h3, tint.r, tint.g, tint.b);
          }
        }
        for (let k = 0; k < tanks; k++) {
          const p = place(10, 1.0);
          if (p) {
            const c = TANK_COLORS[Math.floor(hash(seed * 31 + k) * TANK_COLORS.length)];
            inst.tank.push(p[0], roofY, p[1], hash(seed + k) * 6.28, 0.85 + 0.35 * hash(seed * 2 + k), 0.85 + 0.4 * hash(seed * 3 + k), ...c);
          }
        }
        for (let k = 0; k < solars; k++) {
          const p = place(10, 1.4);
          if (p) {
            inst.solar.push(p[0], roofY, p[1], -Math.PI / 2 + (hash(seed * 5 + k) - 0.5) * 0.4, 1, 1, 1, 1, 1);
          }
        }
        if (h3 < 0.35) {
          const p = place(8, 0.6);
          if (p) {
            inst.dish.push(p[0], roofY, p[1], Math.atan2(-0.906, 0.42), 0.8 + 0.4 * h4, 1, 0.75, 0.75, 0.73);
          }
        }
      }
    }

    const hy = (top - base) / 2;
    colliders.push(box.cx, base + hy, box.cz, box.hl, hy, box.hw, -Math.atan2(box.dz, box.dx));
    const id = rings.push(r) - 1;
    grid.add(id, box.cx - box.hl - box.hw, box.cz - box.hl - box.hw, box.cx + box.hl + box.hw, box.cz + box.hl + box.hw);
    stats.built++;
  });

  return {
    facades,
    roof,
    colliders: colliders.take(),
    instances: { chimney: inst.chimney.take(), tank: inst.tank.take(), solar: inst.solar.take(), dish: inst.dish.take() },
    index: { grid, rings },
    stats,
  };
}
