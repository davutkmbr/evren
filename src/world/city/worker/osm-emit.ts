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
  for (let v = d.start[k]; v < d.start[k + 1]; v++) {
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
  const n = d.nv[k];
  const v0 = d.start[k];
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

  // Walls: the ring reversed to the winding emit.ts compactBox uses (negative shoelace area), bottom and top loops.
  w.reserve(n * 2, n * 6 + (n - 2) * 3);
  const base = w.vcount;
  let cx = 0;
  let cz = 0;
  for (let q = 0; q < n; q++) {
    cx += d.xy[(v0 + q) * 2];
    cz += d.xy[(v0 + q) * 2 + 1];
  }
  cx /= n;
  cz /= n;
  for (let level2 = 0; level2 < 2; level2++) {
    const y = level2 === 0 ? pl.bottom : pl.top;
    for (let q = 0; q < n; q++) {
      const v = v0 + (n - 1 - q);
      const x = d.xy[v * 2];
      const z = d.xy[v * 2 + 1];
      const ox = x - cx;
      const oz = z - cz;
      const ol = Math.hypot(ox, oz) || 1;
      w.vertex(x, y, z, (ox / ol) * (level2 ? 0.57 : 1), level2 ? 0.6 : 0, (oz / ol) * (level2 ? 0.57 : 1), 0, y - pl.gRef);
    }
  }
  for (let c = 0; c < n; c++) {
    const nx = (c + 1) % n;
    w.tri(base + c, base + nx, base + n + nx);
    w.tri(base + c, base + n + nx, base + n + c);
  }

  // Roof.
  const pitchedGeometry = level <= 1 && pitched && rect >= RECT_MIN && d.rise[k] > 3;
  if (!pitchedGeometry) {
    cap(w, d, v0, n, base + n);
  } else {
    w.setKind(Kind.RoofTile, rgbOf(d.roofTint[k]));
    cap(w, d, v0, n, base + n);
    pitchedRoof(w, obb, pl.top, d.rise[k] / 10, roof);
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

/** Flat top over the (reversed) top loop starting at vertex `top0`. */
function cap(w: MeshWriter, d: DecodedBuildings, v0: number, n: number, top0: number): void {
  if (n === 3 || n === 4) {
    for (let i = 1; i < n - 1; i++) {
      w.tri(top0, top0 + i, top0 + i + 1);
    }
    return;
  }
  const pts: Vector2[] = [];
  for (let q = 0; q < n; q++) {
    const v = v0 + (n - 1 - q);
    pts.push(new Vector2(d.xy[v * 2], d.xy[v * 2 + 1]));
  }
  for (const [a, b, c] of ShapeUtils.triangulateShape(pts, [])) {
    // Up-facing triangles have a negative shoelace area in x / z (mesh-writer.ts flat).
    const area = (pts[b].x - pts[a].x) * (pts[c].y - pts[a].y) - (pts[c].x - pts[a].x) * (pts[b].y - pts[a].y);
    if (area < 0) {
      w.tri(top0 + a, top0 + b, top0 + c);
    } else {
      w.tri(top0 + a, top0 + c, top0 + b);
    }
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
  const n = d.nv[k];
  if (n < 3) {
    return;
  }
  const pl = placeOsm(d, k, geo);
  const o = orientedBox(d.xy, d.start[k], n);
  const top = pl.top + (d.roof[k] === RoofClass.Flat ? 0 : (d.rise[k] / 10) * 0.6);
  out.push(o.cx, (pl.bottom + top) * 0.5, o.cz, o.hl, (top - pl.bottom) * 0.5, o.hw, -Math.atan2(o.dz, o.dx));
}
