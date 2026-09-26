/**
 * Far OSM layer (phase 24): the city workers' geometry for the baked OSM buildings (city/osm/format.ts). Same vertex
 * format, material and shading as the procedural buildings (emit.ts), so the far city keeps its look while its
 * buildings stand where they really are:
 * - walls: the real outline extruded with shared vertices (like emit.ts compactBox; the facade u comes from world
 *   position, Face.WorldU), from below the ground to the baked wall height;
 * - roof: hipped / gabled / pyramidal roofs on the footprint's oriented box when the footprint is nearly rectangular
 *   (level 0 and 1), else a flat top whose colour the shader takes from the style bits (RoofTop), as on the
 *   procedural compact boxes; domes on mosques; a minaret beside every mosque the flight layer gives one;
 * - ground: the flight-scale layer's (osm/shared/ground-height.ts osmGroundHeight on the geo terrain), so a building
 *   stands at the same height before and after its region loads.
 */
import { ShapeUtils, Vector2 } from 'three';
import { type DecodedBuildings, FLAG, RoofClass, Usage as BakeUsage, unpack565 } from '../osm/format';
import { osmGroundHeight } from '../../osm/shared/ground-height';
import { Arch } from '../../osm/buildings/archetypes';
import { Face, Kind, RoofTop, Usage, WinType } from '../protocol';
import type { MeshWriter, PartState } from './mesh-writer';
import type { GeoSampler } from './geo-sampler';


/** Rectangularity (area / oriented box area) above which a pitched roof goes on the oriented box. */
const RECT_MIN = 0.86;
/** Minaret radius (m) and cone height. */
const MINARET_R = 1.3;
const MINARET_CAP = 4;

const part: PartState = { rgb: 0, kind: 0, seed: 0, floorH: 3, gfH: 3.3, style: 0, sx: 3, flags: 0 };

interface Obb {
  cx: number;
  cz: number;
  dx: number;
  dz: number;
  hl: number;
  hw: number;
  area: number;
}

/** Minimum-area rectangle over the ring's edge directions (osm/buildings/footprint.ts orientedBox, flat arrays). */
function orientedBox(xy: Float32Array, v0: number, n: number): Obb {
  let best: Obb = { cx: 0, cz: 0, dx: 1, dz: 0, hl: 0, hw: 0, area: Infinity };
  for (let e = 0; e < n; e++) {
    const a = (v0 + e) * 2;
    const b = (v0 + ((e + 1) % n)) * 2;
    let dx = xy[b] - xy[a];
    let dz = xy[b + 1] - xy[a + 1];
    const len = Math.hypot(dx, dz);
    if (len < 0.3) {
      continue;
    }
    dx /= len;
    dz /= len;
    let u0 = Infinity;
    let u1 = -Infinity;
    let w0 = Infinity;
    let w1 = -Infinity;
    for (let q = 0; q < n; q++) {
      const x = xy[(v0 + q) * 2];
      const z = xy[(v0 + q) * 2 + 1];
      const u = x * dx + z * dz;
      const w = -x * dz + z * dx;
      u0 = Math.min(u0, u);
      u1 = Math.max(u1, u);
      w0 = Math.min(w0, w);
      w1 = Math.max(w1, w);
    }
    const area = (u1 - u0) * (w1 - w0);
    if (area < best.area) {
      const um = (u0 + u1) * 0.5;
      const wm = (w0 + w1) * 0.5;
      const hl = (u1 - u0) * 0.5;
      const hw = (w1 - w0) * 0.5;
      // Long axis first.
      best = hl >= hw ? { cx: um * dx - wm * dz, cz: um * dz + wm * dx, dx, dz, hl, hw, area } : { cx: um * dx - wm * dz, cz: um * dz + wm * dx, dx: -dz, dz: dx, hl: hw, hw: hl, area };
    }
  }
  return best;
}

function ringArea(xy: Float32Array, v0: number, n: number): number {
  let a = 0;
  for (let q = 0; q < n; q++) {
    const i = (v0 + q) * 2;
    const j = (v0 + ((q + 1) % n)) * 2;
    a += xy[i] * xy[j + 1] - xy[j] * xy[i + 1];
  }
  return a / 2;
}

const WALL_KIND: Record<number, number> = { [Arch.Plain]: Kind.Wall, [Arch.Levantine]: Kind.Stone, [Arch.Wood]: Kind.Wood, [Arch.Han]: Kind.Stone, [Arch.Modern]: Kind.Wall, [Arch.Civic]: Kind.Stone, [Arch.Mosque]: Kind.Stone };
const WIN_TYPE: Record<number, number> = { [Arch.Plain]: WinType.Apartment, [Arch.Levantine]: WinType.Historic, [Arch.Wood]: WinType.Historic, [Arch.Han]: WinType.Historic, [Arch.Modern]: WinType.Ribbon, [Arch.Civic]: WinType.Historic, [Arch.Mosque]: WinType.Historic };
const COLUMN: Record<number, number> = { [Arch.Plain]: 3, [Arch.Levantine]: 3.4, [Arch.Wood]: 2.6, [Arch.Han]: 3.4, [Arch.Modern]: 3.6, [Arch.Civic]: 3.8, [Arch.Mosque]: 4 };
const OLD = new Set<number>([Arch.Levantine, Arch.Wood, Arch.Han, Arch.Civic, Arch.Mosque]);

const rgbOf = (c565: number): number => {
  const [r, g, b] = unpack565(c565);
  return (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
};

/** Placement of record k: reference ground, wall bottom and top (absolute heights, m). */
export interface OsmPlacement {
  gMin: number;
  gRef: number;
  bottom: number;
  top: number;
}

/** Ground and heights of record k (buildings/build.ts buildBuildings: gRef mid-way between the lowest and highest vertex). */
export function placeOsm(d: DecodedBuildings, k: number, geo: GeoSampler): OsmPlacement {
  let gMin = Infinity;
  let gMax = -Infinity;
  const r0 = d.ringStart[k];
  for (let v = d.start[r0]; v < d.start[r0 + 1]; v++) {
    const x = d.xy[v * 2];
    const z = d.xy[v * 2 + 1];
    const g = osmGroundHeight(geo.height(x, z), geo.coast(x, z));
    gMin = Math.min(gMin, g);
    gMax = Math.max(gMax, g);
  }
  const gRef = gMin + 0.5 * (gMax - gMin);
  const minH = d.minH[k] / 10;
  return { gMin, gRef, bottom: minH > 0.5 ? gRef + minH : gMin - 1.5, top: gRef + d.wallH[k] / 10 };
}

/** City fade class of record k (the bake's classes use the city's thresholds, protocol.ts FadeClass). */
export function osmFadeClass(d: DecodedBuildings, k: number): number {
  return (d.flags[k] >> FLAG.fadeShift) & 3;
}

/**
 * Emits record k. `level`: 0 near, 1 mid (roofs as geometry), 2 far (walls and a flat top; minarets stay, they make
 * the skyline).
 */
export function emitOsm(d: DecodedBuildings, k: number, w: MeshWriter, level: number, geo: GeoSampler): void {
  const r0 = d.ringStart[k];
  const n = d.nv[r0];
  const v0 = d.start[r0];
  if (n < 3) {
    return;
  }
  const pl = placeOsm(d, k, geo);
  const arch = d.arch[k];
  const flags = d.flags[k];
  const usage = (flags >> FLAG.usageShift) & 3;
  const roof = d.roof[k];
  const tower = (flags & FLAG.tower) !== 0;
  const obb = orientedBox(d.xy, v0, n);
  const area = Math.abs(ringArea(d.xy, v0, n));
  const rect = obb.area > 0 && Number.isFinite(obb.area) ? area / obb.area : 0;
  const pitched = roof === RoofClass.Hipped || roof === RoofClass.Gabled || roof === RoofClass.Pyramidal;
  const roofTop = pitched ? RoofTop.Tile : usage === BakeUsage.Industrial || roof === RoofClass.Dome || roof === RoofClass.Domes ? RoofTop.Metal : RoofTop.Flat;
  const winType = tower && arch === Arch.Modern ? WinType.Curtain : usage === BakeUsage.Industrial ? WinType.Industrial : (WIN_TYPE[arch] ?? WinType.Apartment);
  const cityUsage = usage === BakeUsage.Office ? Usage.Office : usage === BakeUsage.Industrial ? Usage.Industrial : Usage.Residential;
  const floorH = d.floorH[k] / 50 || 3;
  part.rgb = rgbOf(d.tint[k]);
  part.kind = tower && arch === Arch.Modern ? Kind.Curtain : (WALL_KIND[arch] ?? Kind.Wall);
  part.seed = d.id[k] % 251;
  part.floorH = floorH;
  part.gfH = floorH * 1.12;
  part.style = (winType & 15) | ((cityUsage & 3) << 4) | ((roofTop & 3) << 6);
  part.sx = usage === BakeUsage.Industrial ? 6 : (COLUMN[arch] ?? 3);
  part.flags = (Math.min(127, d.floors[k]) << Face.FloorsShift) | Face.WorldU | Face.RoleSide | (OLD.has(arch) ? Face.Old : 0);
  w.part(part);

  // Walls of every ring: the outline facing out, courtyards facing into the courtyard (topLoop: first top vertex of
  // each ring's loop, written in reverse vertex order).
  const topLoop: number[] = [];
  for (let r = r0; r < d.ringStart[k + 1]; r++) {
    topLoop.push(ringWalls(w, d.xy, d.start[r], d.nv[r], pl.bottom, pl.top, pl.gRef));
  }
  // Roof.
  const pitchedGeometry = level <= 1 && pitched && rect >= RECT_MIN && d.rise[k] > 3;
  if (!pitchedGeometry) {
    cap(w, d, k, topLoop);
  } else {
    w.setKind(Kind.RoofTile, rgbOf(d.roofTint[k]));
    cap(w, d, k, topLoop);
    pitchedRoof(w, obb, pl.top, d.rise[k] / 10, roof);
  }
  if (level === 0) {
    nearDetail(w, d, k, pl, obb, area, pitchedGeometry);
  }
  if (level <= 1 && (roof === RoofClass.Dome || roof === RoofClass.Domes)) {
    w.setKind(Kind.RoofMetal, rgbOf(d.roofTint[k]));
    dome(w, obb.cx, obb.cz, pl.top, Math.max(2, Math.min(obb.hl, obb.hw) * 0.8));
  }
  if (flags & FLAG.minaret) {
    w.setKind(Kind.Stone, rgbOf(d.tint[k]));
    // The corner of the oriented box furthest from the qibla (south-east): the entrance side (osm/buildings/roofs.ts).
    const corners = [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ].map(([a, b]) => [obb.cx + obb.dx * a * (obb.hl + MINARET_R * 1.5) - obb.dz * b * (obb.hw + MINARET_R * 1.5), obb.cz + obb.dz * a * (obb.hl + MINARET_R * 1.5) + obb.dx * b * (obb.hw + MINARET_R * 1.5)]);
    corners.sort((p, q) => p[0] + p[1] - (q[0] + q[1]));
    const [mx, mz] = corners[0];
    const shaft = Math.min(55, Math.max(18, (pl.top - pl.gMin) * 1.9));
    minaret(w, mx, mz, pl.gMin - 1, pl.gMin + shaft, level);
  }
}

/**
 * Walls of one ring (emit.ts compactBox winding: the ring is written in reverse order, so an outline (counter-
 * clockwise) faces out and a courtyard (clockwise) faces into the courtyard). Returns the first top-loop vertex.
 */
function ringWalls(w: MeshWriter, xy: Float32Array, v0: number, n: number, bottom: number, top: number, gRef: number): number {
  w.reserve(n * 2, n * 6);
  const base = w.vcount;
  let cx = 0;
  let cz = 0;
  for (let q = 0; q < n; q++) {
    cx += xy[(v0 + q) * 2];
    cz += xy[(v0 + q) * 2 + 1];
  }
  cx /= n;
  cz /= n;
  const sign = ringArea(xy, v0, n) >= 0 ? 1 : -1;
  for (let level = 0; level < 2; level++) {
    const y = level === 0 ? bottom : top;
    for (let q = 0; q < n; q++) {
      const v = v0 + (n - 1 - q);
      const x = xy[v * 2];
      const z = xy[v * 2 + 1];
      const ox = (x - cx) * sign;
      const oz = (z - cz) * sign;
      const ol = Math.hypot(ox, oz) || 1;
      w.vertex(x, y, z, (ox / ol) * (level ? 0.57 : 1), level ? 0.6 : 0, (oz / ol) * (level ? 0.57 : 1), 0, y - gRef);
    }
  }
  for (let c = 0; c < n; c++) {
    const nx = (c + 1) % n;
    w.tri(base + c, base + nx, base + n + nx);
    w.tri(base + c, base + n + nx, base + n + c);
  }
  return base + n;
}

/** Flat top of record k over its rings' top loops, courtyards left open. */
function cap(w: MeshWriter, d: DecodedBuildings, k: number, topLoop: readonly number[]): void {
  const r0 = d.ringStart[k];
  const rings = d.ringStart[k + 1] - r0;
  const n0 = d.nv[r0];
  if (rings === 1 && (n0 === 3 || n0 === 4)) {
    for (let i = 1; i < n0 - 1; i++) {
      w.tri(topLoop[0], topLoop[0] + i, topLoop[0] + i + 1);
    }
    return;
  }
  // triangulateShape wants the contour counter-clockwise and the holes clockwise (x, z as x, y): the stored order,
  // so its indices are stored vertex indices. Loop vertex of stored index q is topLoop + (n - 1 - q).
  const map: number[] = [];
  const ringPts: Vector2[][] = [];
  for (let r = 0; r < rings; r++) {
    const v0 = d.start[r0 + r];
    const n = d.nv[r0 + r];
    const pts: Vector2[] = [];
    for (let q = 0; q < n; q++) {
      pts.push(new Vector2(d.xy[(v0 + q) * 2], d.xy[(v0 + q) * 2 + 1]));
      map.push(topLoop[r] + (n - 1 - q));
    }
    ringPts.push(pts);
  }
  for (const [a, b, c] of ShapeUtils.triangulateShape(ringPts[0], ringPts.slice(1))) {
    upTri(w, map[a], map[b], map[c]);
  }
}

/** Hip (or pyramid, or gable with the ridge along the long axis) roof over the oriented box, from wall top `y`. */
function pitchedRoof(w: MeshWriter, o: Obb, y: number, rise: number, roof: number): void {
  const H = y + rise;
  const P = (a: number, b: number): [number, number] => [o.cx + o.dx * a - o.dz * b, o.cz + o.dz * a + o.dx * b];
  const e = [P(o.hl, -o.hw), P(-o.hl, -o.hw), P(-o.hl, o.hw), P(o.hl, o.hw)];
  const ridge = roof === RoofClass.Pyramidal ? 0 : roof === RoofClass.Gabled ? o.hl : Math.max(0, o.hl - o.hw);
  const ra = P(-ridge, 0);
  const rb = P(ridge, 0);
  w.reserve(6, 18);
  const base = w.vcount;
  for (const [x, z] of e) {
    w.vertex(x, y, z, 0, 1, 0, 0, 0);
  }
  w.vertex(ra[0], H, ra[1], 0, 1, 0, 0, 0);
  w.vertex(rb[0], H, rb[1], 0, 1, 0, 0, 0);
  // Corners e0 (+l,-w), e1 (-l,-w), e2 (-l,+w), e3 (+l,+w); ridge a (-), b (+).
  const quad = (p: number, q: number, r: number, s: number): void => {
    upTri(w, base + p, base + q, base + r);
    upTri(w, base + p, base + r, base + s);
  };
  quad(0, 1, 4, 5);
  quad(2, 3, 5, 4);
  upTri(w, base + 1, base + 2, base + 4);
  upTri(w, base + 3, base + 0, base + 5);
}

/** Triangle wound to face up (checked on the written positions). */
function upTri(w: MeshWriter, a: number, b: number, c: number): void {
  const p = w.pos;
  const area = (p[b * 3] - p[a * 3]) * (p[c * 3 + 2] - p[a * 3 + 2]) - (p[c * 3] - p[a * 3]) * (p[b * 3 + 2] - p[a * 3 + 2]);
  if (area <= 0) {
    w.tri(a, b, c);
  } else {
    w.tri(a, c, b);
  }
}

/** Low-poly hemisphere (8 sides, 3 rings) at (x, z) on height y. */
function dome(w: MeshWriter, x: number, z: number, y: number, r: number): void {
  const S = 8;
  const R = 3;
  w.reserve(S * R + 1, S * (R - 1) * 6 + S * 3);
  const base = w.vcount;
  for (let i = 0; i < R; i++) {
    const phi = (i / R) * Math.PI * 0.5;
    for (let s = 0; s < S; s++) {
      const a = (s / S) * Math.PI * 2;
      const nx = Math.cos(a) * Math.cos(phi);
      const nz = Math.sin(a) * Math.cos(phi);
      w.vertex(x + nx * r, y + Math.sin(phi) * r, z + nz * r, nx, Math.sin(phi), nz, 0, 0);
    }
  }
  const apex = w.vertex(x, y + r, z, 0, 1, 0, 0, 0);
  for (let i = 0; i < R - 1; i++) {
    for (let s = 0; s < S; s++) {
      const a = base + i * S + s;
      const b = base + i * S + ((s + 1) % S);
      outTri(w, a, b, b + S, x, z);
      outTri(w, a, b + S, a + S, x, z);
    }
  }
  for (let s = 0; s < S; s++) {
    outTri(w, base + (R - 1) * S + s, base + (R - 1) * S + ((s + 1) % S), apex, x, z);
  }
}

/** Triangle wound to face away from the vertical axis through (x, z) (or up at the apex). */
function outTri(w: MeshWriter, a: number, b: number, c: number, x: number, z: number): void {
  const p = w.pos;
  const ax = p[a * 3];
  const ay = p[a * 3 + 1];
  const az = p[a * 3 + 2];
  const ux = p[b * 3] - ax;
  const uy = p[b * 3 + 1] - ay;
  const uz = p[b * 3 + 2] - az;
  const vx = p[c * 3] - ax;
  const vy = p[c * 3 + 1] - ay;
  const vz = p[c * 3 + 2] - az;
  // Face normal (u x v) against the outward direction from the axis (positions are tile-local: compare offsets).
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const mx = (ax + p[b * 3] + p[c * 3]) / 3 - (x - w.ox);
  const mz = (az + p[b * 3 + 2] + p[c * 3 + 2]) / 3 - (z - w.oz);
  if (nx * mx + nz * mz + ny * 0.001 >= 0) {
    w.tri(a, b, c);
  } else {
    w.tri(a, c, b);
  }
}

/** Octagonal minaret shaft with a cone cap from y0 to y1 (level 2: square shaft, no cap). */
function minaret(w: MeshWriter, x: number, z: number, y0: number, y1: number, level: number): void {
  const S = level >= 2 ? 4 : 8;
  w.reserve(S * 2 + 1, S * 9);
  const base = w.vcount;
  for (let ring = 0; ring < 2; ring++) {
    for (let s = 0; s < S; s++) {
      const a = (s / S) * Math.PI * 2;
      w.vertex(x + Math.cos(a) * MINARET_R, ring ? y1 : y0, z + Math.sin(a) * MINARET_R, Math.cos(a), 0, Math.sin(a), 0, 0);
    }
  }
  for (let s = 0; s < S; s++) {
    const t = (s + 1) % S;
    outTri(w, base + s, base + t, base + S + t, x, z);
    outTri(w, base + s, base + S + t, base + S + s, x, z);
  }
  const apex = w.vertex(x, y1 + (level >= 2 ? 0.5 : MINARET_CAP), z, 0, 1, 0, 0, 0);
  for (let s = 0; s < S; s++) {
    outTri(w, base + S + s, base + S + ((s + 1) % S), apex, x, z);
  }
}

/** Collider box of record k: its oriented box from the bottom to the wall top (+ the roof rise). */
export function osmCollider(d: DecodedBuildings, k: number, geo: GeoSampler, out: number[]): void {
  const r0 = d.ringStart[k];
  const n = d.nv[r0];
  if (n < 3) {
    return;
  }
  const pl = placeOsm(d, k, geo);
  const o = orientedBox(d.xy, d.start[r0], n);
  const top = pl.top + (d.roof[k] === RoofClass.Flat ? 0 : (d.rise[k] / 10) * 0.6);
  out.push(o.cx, (pl.bottom + top) * 0.5, o.cz, o.hl, (top - pl.bottom) * 0.5, o.hw, -Math.atan2(o.dz, o.dx));
}

/* ------------------------------------------------------------------ */
/* Near detail (level 0, outside the regions)                          */
/* ------------------------------------------------------------------ */

type P3 = readonly [number, number, number];

/** Quad p0..p3 wound to face along (nx, ny, nz); u / v as the city's facade expects (v = height above gRef). */
function face(w: MeshWriter, p: readonly P3[], nx: number, ny: number, nz: number, gRef: number): void {
  w.reserve(4, 6);
  const b = w.vcount;
  for (const q of p) {
    w.vertex(q[0], q[1], q[2], nx, ny, nz, 0, q[1] - gRef);
  }
  const ux = p[1][0] - p[0][0];
  const uy = p[1][1] - p[0][1];
  const uz = p[1][2] - p[0][2];
  const vx = p[2][0] - p[0][0];
  const vy = p[2][1] - p[0][1];
  const vz = p[2][2] - p[0][2];
  const d = (uy * vz - uz * vy) * nx + (uz * vx - ux * vz) * ny + (ux * vy - uy * vx) * nz;
  if (d >= 0) {
    w.tri(b, b + 1, b + 2);
    w.tri(b, b + 2, b + 3);
  } else {
    w.tri(b, b + 2, b + 1);
    w.tri(b, b + 3, b + 2);
  }
}

/** Box on (cx, cz) with long axis (dx, dz), half extents hl x hw, from y0 to y1 (no bottom). */
function box(w: MeshWriter, cx: number, cz: number, dx: number, dz: number, hl: number, hw: number, y0: number, y1: number, gRef: number): void {
  const P = (a: number, b: number, y: number): P3 => [cx + dx * a - dz * b, y, cz + dz * a + dx * b];
  const c = [
    [hl, hw],
    [-hl, hw],
    [-hl, -hw],
    [hl, -hw],
  ];
  for (let i = 0; i < 4; i++) {
    const [a0, b0] = c[i];
    const [a1, b1] = c[(i + 1) % 4];
    const mx = (a0 + a1) / 2;
    const mz = (b0 + b1) / 2;
    const nl = Math.hypot(mx, mz) || 1;
    const nx = (dx * mx - dz * mz) / nl;
    const nz = (dz * mx + dx * mz) / nl;
    face(w, [P(a0, b0, y0), P(a1, b1, y0), P(a1, b1, y1), P(a0, b0, y1)], nx, 0, nz, gRef);
  }
  face(w, c.map(([a, b]) => P(a, b, y1)), 0, 1, 0, gRef);
}

/** The outline's vertices moved `dist` m outwards (negative: inwards), mitred, as flat x, z pairs. */
function offsetRing(xy: Float32Array, v0: number, n: number, dist: number): number[] {
  const out: number[] = [];
  const sign = ringArea(xy, v0, n) >= 0 ? 1 : -1;
  for (let q = 0; q < n; q++) {
    const p = (v0 + ((q + n - 1) % n)) * 2;
    const c = (v0 + q) * 2;
    const nx0 = (v0 + ((q + 1) % n)) * 2;
    let ax = xy[c] - xy[p];
    let az = xy[c + 1] - xy[p + 1];
    let bx = xy[nx0] - xy[c];
    let bz = xy[nx0 + 1] - xy[c + 1];
    const la = Math.hypot(ax, az) || 1;
    const lb = Math.hypot(bx, bz) || 1;
    ax /= la;
    az /= la;
    bx /= lb;
    bz /= lb;
    // Outward normals (dz, -dx) of a counter-clockwise ring, averaged into a mitre.
    let mx = (az + bz) * sign;
    let mz = (-ax - bx) * sign;
    const ml = Math.hypot(mx, mz);
    if (ml < 1e-6) {
      mx = az * sign;
      mz = -ax * sign;
    } else {
      mx /= ml;
      mz /= ml;
    }
    const cos = Math.max(0.5, mx * az * sign - mz * ax * sign);
    out.push(xy[c] + (mx * dist) / cos, xy[c + 1] + (mz * dist) / cos);
  }
  return out;
}

/** A band around the outline between `inner` and `outer` (flat x, z rings, same vertex order) from y0 to y1. */
function band(w: MeshWriter, outer: number[], inner: number[] | null, y0: number, y1: number, gRef: number, top: boolean, under: boolean): void {
  const n = outer.length / 2;
  for (let q = 0; q < n; q++) {
    const j = (q + 1) % n;
    const ax = outer[q * 2];
    const az = outer[q * 2 + 1];
    const bx = outer[j * 2];
    const bz = outer[j * 2 + 1];
    const ex = bx - ax;
    const ez = bz - az;
    const el = Math.hypot(ex, ez);
    if (el < 0.05) {
      continue;
    }
    // Outward: away from the inner ring (or from the outline's inside, found from the inner ring's matching edge).
    let nx = ez / el;
    let nz = -ex / el;
    const ref = inner ?? outer;
    const mx = (ref[q * 2] + ref[j * 2]) / 2;
    const mz = (ref[q * 2 + 1] + ref[j * 2 + 1]) / 2;
    const cx = outer.reduce((s, v, i) => (i % 2 ? s : s + v), 0) / n;
    const cz = outer.reduce((s, v, i) => (i % 2 ? s + v : s), 0) / n;
    if (nx * (mx - cx) + nz * (mz - cz) < 0) {
      nx = -nx;
      nz = -nz;
    }
    face(w, [[ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az]], nx, 0, nz, gRef);
    if (inner) {
      const ix = inner[q * 2];
      const iz = inner[q * 2 + 1];
      const jx = inner[j * 2];
      const jz = inner[j * 2 + 1];
      face(w, [[ix, y0, iz], [jx, y0, jz], [jx, y1, jz], [ix, y1, iz]], -nx, 0, -nz, gRef);
      if (top) {
        face(w, [[ax, y1, az], [bx, y1, bz], [jx, y1, jz], [ix, y1, iz]], 0, 1, 0, gRef);
      }
      if (under) {
        face(w, [[ax, y0, az], [bx, y0, bz], [jx, y0, jz], [ix, y0, iz]], 0, -1, 0, gRef);
      }
    }
  }
}

/** Stable per-building random in [0, 1). */
function rnd(id: number, salt: number): number {
  const x = Math.sin((id % 1e6) * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** True when (x, z) lies inside the outline of record k and outside its courtyards. */
function insideRecord(d: DecodedBuildings, k: number, x: number, z: number): boolean {
  let inside = false;
  for (let r = d.ringStart[k]; r < d.ringStart[k + 1]; r++) {
    const v0 = d.start[r];
    const n = d.nv[r];
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = d.xy[(v0 + i) * 2];
      const zi = d.xy[(v0 + i) * 2 + 1];
      const xj = d.xy[(v0 + j) * 2];
      const zj = d.xy[(v0 + j) * 2 + 1];
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) {
        inside = !inside;
      }
    }
  }
  return inside;
}

/**
 * Close-range dressing of record k (the procedural city's near level has the same kinds, emit.ts emitNear): a parapet
 * on flat roofs, a cornice on historic facades, rooftop tanks, solar heaters and antennas, chimneys on pitched roofs,
 * balconies on the longest walls of apartment blocks. Fine parts go to the detail index list (shadows skip them).
 */
function nearDetail(w: MeshWriter, d: DecodedBuildings, k: number, pl: OsmPlacement, o: Obb, area: number, pitched: boolean): void {
  const r0 = d.ringStart[k];
  const v0 = d.start[r0];
  const n = d.nv[r0];
  const arch = d.arch[k];
  const id = Math.abs(d.id[k]);
  const floors = d.floors[k];
  const floorH = d.floorH[k] / 50 || 3;
  const flat = !pitched && d.roof[k] === RoofClass.Flat;
  const faceFlags = (Math.min(127, floors) << Face.FloorsShift) | Face.WorldU | Face.RoleParty;
  const tint = rgbOf(d.tint[k]);
  if (n > 64 || area < 12) {
    return;
  }
  // Blank facade (column spacing 0) for trims.
  w.setFace(0, faceFlags);
  if (OLD.has(arch) && floors >= 2) {
    w.setKind(Kind.Stone, tint);
    band(w, offsetRing(d.xy, v0, n, 0.28), offsetRing(d.xy, v0, n, 0), pl.top - 0.45, pl.top - 0.12, pl.gRef, false, true);
  }
  if (flat) {
    w.setKind(WALL_KIND[arch] ?? Kind.Wall, tint);
    band(w, offsetRing(d.xy, v0, n, 0), offsetRing(d.xy, v0, n, -0.22), pl.top, pl.top + 0.9, pl.gRef, true, false);
  }
  w.detail = true;
  if (flat && area > 50) {
    const count = 1 + Math.floor(rnd(id, 1) * Math.min(5, area / 60));
    for (let i = 0; i < count; i++) {
      const a = (rnd(id, 10 + i) - 0.5) * 2 * Math.max(0, o.hl - 1.5);
      const b = (rnd(id, 20 + i) - 0.5) * 2 * Math.max(0, o.hw - 1.5);
      const x = o.cx + o.dx * a - o.dz * b;
      const z = o.cz + o.dz * a + o.dx * b;
      if (!insideRecord(d, k, x, z)) {
        continue;
      }
      const kind = rnd(id, 30 + i);
      if (kind < 0.45) {
        // Water tank on legs.
        w.setKind(Kind.Metal, 0xc9c6c0);
        box(w, x, z, o.dx, o.dz, 0.6, 0.6, pl.top + 0.35, pl.top + 1.55, pl.gRef);
      } else if (kind < 0.75) {
        // Solar water heater: tilted panel and tank.
        w.setKind(Kind.Solar, 0x1d2a3a);
        box(w, x, z, o.dx, o.dz, 1.0, 0.55, pl.top + 0.2, pl.top + 0.75, pl.gRef);
        w.setKind(Kind.Metal, 0xd8d8d4);
        box(w, x + o.dz * 0.7, z - o.dx * 0.7, o.dx, o.dz, 0.9, 0.22, pl.top + 0.75, pl.top + 1.2, pl.gRef);
      } else {
        // Antenna mast.
        w.setKind(Kind.Metal, 0x8a8d90);
        box(w, x, z, o.dx, o.dz, 0.05, 0.05, pl.top, pl.top + 2.8, pl.gRef);
      }
    }
  }
  if (pitched && floors <= 6) {
    w.setKind(Kind.Chimney, tint);
    const count = 1 + Math.floor(rnd(id, 2) * 2);
    for (let i = 0; i < count; i++) {
      const a = (rnd(id, 40 + i) - 0.5) * 1.2 * o.hl;
      const b = (rnd(id, 50 + i) - 0.5) * 0.8 * o.hw;
      const rise = d.rise[k] / 10;
      box(w, o.cx + o.dx * a - o.dz * b, o.cz + o.dz * a + o.dx * b, o.dx, o.dz, 0.3, 0.3, pl.top, pl.top + rise * 0.75 + 0.7, pl.gRef);
    }
  }
  if ((arch === Arch.Plain || arch === Arch.Modern) && floors >= 3 && rnd(id, 3) < 0.7) {
    // Balconies on the two longest walls (party walls hide theirs inside the neighbour).
    const edges: { i: number; len: number }[] = [];
    for (let q = 0; q < n; q++) {
      const a = (v0 + q) * 2;
      const b = (v0 + ((q + 1) % n)) * 2;
      edges.push({ i: q, len: Math.hypot(d.xy[b] - d.xy[a], d.xy[b + 1] - d.xy[a + 1]) });
    }
    edges.sort((p, q) => q.len - p.len);
    const sign = ringArea(d.xy, v0, n) >= 0 ? 1 : -1;
    for (const e of edges.slice(0, 2)) {
      if (e.len < 6) {
        continue;
      }
      const a = (v0 + e.i) * 2;
      const b = (v0 + ((e.i + 1) % n)) * 2;
      const tx = (d.xy[b] - d.xy[a]) / e.len;
      const tz = (d.xy[b + 1] - d.xy[a + 1]) / e.len;
      // Outward normal of a counter-clockwise outline edge.
      const nx = tz * sign;
      const nz = -tx * sign;
      const half = Math.min(e.len * 0.5 - 0.8, 2.4);
      const mx = (d.xy[a] + d.xy[b]) * 0.5 + nx * 0.55;
      const mz = (d.xy[a + 1] + d.xy[b + 1]) * 0.5 + nz * 0.55;
      for (let f = 1; f < floors; f++) {
        const y = pl.gRef + f * floorH;
        w.setKind(Kind.Slab, 0xb8b4ac);
        box(w, mx, mz, tx, tz, half, 0.55, y - 0.15, y, pl.gRef);
        w.setKind(Kind.Railing, 0x3a3a3a);
        box(w, mx + nx * 0.52, mz + nz * 0.52, tx, tz, half, 0.03, y, y + 1.0, pl.gRef);
      }
    }
  }
  w.detail = false;
}
