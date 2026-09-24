/**
 * Façade kit (format 1, full-detail tiles): real geometry for one building from its FacadePlan.
 *
 * Per footprint edge (facade/frame.ts Frame): party walls stay blank; street and open edges get a wall with openings
 * (grid-decomposed around windows, shopfronts and the çıkma, no T-junctions), window assemblies (reveals, frames,
 * glass, sills, roller boxes or surrounds, shutters, curtains, a room box behind, some lit at night), balconies
 * (slab, soffit, solid / steel / pipe / glazed / glass parapets), the çıkma (front wall with windows, sides, soffit,
 * slab edge), cornices, eaves, string courses, parapets with copings, the roof (flat with tanks, aerials and dishes
 * as instances, or hipped tiles with eaves), AC units as instances and wear (damaged-plaster patches, peeling
 * parapets, streak and plinth decals, contact darkening in COLOR_0). Ground floors on street edges are shopfronts
 * (shopfront/shopfront.ts). LOD1 is the block with the plan's colours: shop band, dark window bands, roof.
 *
 * Realism pass (format 1.1): walls are welded sheets (frame.ts Batch.sheet) whose vertices carry `_WEATHER`, the
 * mottled / sun-faded paint and a wavy shading normal (facade/weather.ts); each wall segment picks a clean,
 * `@weathered` or `@damaged` material variant; convex corners are chamfered; slabs, sills, copings and cornices have
 * chamfered arrises and weather on their faces; railings rust; repairs and peeling paint are thin overlays. What
 * residents and utilities hang on the façade (gas risers, junction boxes, laundry, cat nets, pots, flags, banners,
 * dishes, cracks) is facade/services.ts.
 */
import * as THREE from 'three';
import { pointInRing } from '../../../../src/world/osm/shared/geometry';
import type { FootprintIndex } from '../../../../src/world/osm/shared/footprints';
import { type StreetSurface, Zone } from '../../../../src/world/osm/shared/street-surface';
import type { Solid } from '../buildings';
import type { DoorRec, InstanceRec, PoiRec, XYZ } from '../format';
import type { GroundHeights } from '../ground';
import type { LightSink } from '../lights';
import { LOD0, LOD1, type RGBA, type TileMesh, type Vec2, type Vec3, type Weather } from '../mesh';
import type { PlaceOptions } from '../registry';
import { emitText, textWidth } from '../shopfront/font';
import { emitShopUnit, planShops, type ShopUnit } from '../shopfront/shopfront';
import { Batch, Frame, h01, lin, mix, pick, scale, type SheetAttr } from './frame';
import type { FacadePlan } from './plan';
import { crack, facadeLife, flag } from './services';
import { fbm, paintAt, type WallInfo, wallWeather, wavyTilt } from './weather';

export type EdgeKind = 'street' | 'open' | 'party' | 'short';

export interface Edge {
  i: number;
  f: Frame;
  len: number;
  kind: EdgeKind;
  convexL: boolean;
  convexR: boolean;
  gMean: number;
  gAt: (r: number) => number;
}

export interface Rect {
  r0: number;
  r1: number;
  y0: number;
  y1: number;
}

export interface Win extends Rect {
  /** Roller box / lintel height above y1. */
  box: number;
  kind: 'window' | 'door' | 'ribbon' | 'shopribbon' | 'small';
  floor: number;
  /** Floor line of its storey. */
  fy: number;
  seed: number;
}

export interface FacadeCtx {
  mesh: TileMesh;
  heights: GroundHeights;
  footprints: FootprintIndex;
  surface: StreetSurface;
  land: (x: number, z: number) => number;
  place: (asset: string, position: XYZ, yaw: number, opts?: PlaceOptions) => InstanceRec;
  lights: LightSink;
  tile: string;
  avoid: ReadonlySet<string>;
  pois: readonly PoiRec[];
  doors: readonly DoorRec[];
  market: boolean;
  /** The interiors step's shared record (`area.shared.get('interiors')`), read when the tile is emitted. */
  interiors: () => { doors: ReadonlyMap<string, { poi: string; name?: string; doorWidth: number }>; pois: ReadonlySet<string> } | undefined;
}

export interface FacadeRecord {
  id: string;
  typ: string;
  storeys: number;
  source: string;
  roof: string;
  base: number;
  roofY: number;
  topY: number;
  cikma: string;
  balcony: string;
  railing: string;
  edges: { street: number; open: number; party: number };
  shops: { r0: number; r1: number; kind: string; trade: string | null; name: string | null; poi: string | null; kepenk: string; awning: string; lit: boolean; projecting: boolean; interior?: true }[];
  lod0Triangles: number;
}

const r2 = (v: number): number => Math.round(v * 100) / 100;

/* ------------------------------------------------------------------------------------------------------------- */
/* Edges                                                                                                           */
/* ------------------------------------------------------------------------------------------------------------- */

/** Classifies the outer ring's edges: party (another building behind), street, open (courtyard / back) or short. */
export function classifyEdges(s: Solid, heights: GroundHeights, footprints: FootprintIndex, surface: StreetSurface, land: (x: number, z: number) => number): Edge[] {
  const ring = s.ring;
  const n = ring.length / 2;
  const out: Edge[] = [];
  const inOther = (x: number, z: number): boolean => footprints.inside(x, z) && !pointInRing(ring, x, z);
  const turn = (i: number): number => {
    const ax = ring[i * 2];
    const az = ring[i * 2 + 1];
    const bx = ring[((i + 1) % n) * 2];
    const bz = ring[((i + 1) % n) * 2 + 1];
    const cx = ring[((i + 2) % n) * 2];
    const cz = ring[((i + 2) % n) * 2 + 1];
    return (bx - ax) * (cz - bz) - (bz - az) * (cx - bx);
  };
  for (let i = 0; i < n; i++) {
    const ax = ring[i * 2];
    const az = ring[i * 2 + 1];
    const bx = ring[((i + 1) % n) * 2];
    const bz = ring[((i + 1) % n) * 2 + 1];
    const f = Frame.ofEdge(ax, az, bx, bz);
    const len = f.len;
    const gAt = (r: number): number => {
      const [x, z] = f.xz(Math.max(0, Math.min(len, r)), 0.6);
      return heights.at(x, z);
    };
    let kind: EdgeKind;
    if (len < 1.2) {
      kind = 'short';
    } else {
      let party = 0;
      for (const t of [0.2, 0.5, 0.8]) {
        const [x, z] = f.xz(len * t, 1.0);
        if (inOther(x, z)) {
          party++;
        }
      }
      if (party >= 2) {
        kind = 'party';
      } else {
        let street = 0;
        for (const t of [0.25, 0.5, 0.75]) {
          const [x, z] = f.xz(len * t, 1.6);
          if (land(x, z) <= 0) {
            continue;
          }
          const zone = surface.zone(x, z);
          if (zone === Zone.Carriageway || zone === Zone.Sidewalk || zone === Zone.Pedestrian || surface.distance(x, z) < 6 || surface.pathDistance(x, z) < 3) {
            street++;
          }
        }
        kind = street >= 2 ? 'street' : 'open';
      }
    }
    // Vertex B (left end, r = 0) joins this edge and the next; vertex A (right end) joins the previous one.
    const convexL = turn(i) > 0;
    const convexR = turn((i - 1 + n) % n) > 0;
    out.push({ i, f, len, kind, convexL, convexR, gMean: (gAt(len * 0.25) + gAt(len * 0.5) + gAt(len * 0.75)) / 3, gAt });
  }
  return out;
}

/** Street level for the floor grid: ground in front of the longest street edge (else the lowest ground). */
export function streetBase(s: Solid, edges: readonly Edge[]): number {
  const st = edges.filter((e) => e.kind === 'street').sort((a, b) => b.len - a.len);
  return st.length ? Math.max(s.rec.groundY, Math.min(st[0].gMean, s.rec.groundY + 1.2)) : s.rec.groundY;
}

/* ------------------------------------------------------------------------------------------------------------- */
/* Building                                                                                                        */
/* ------------------------------------------------------------------------------------------------------------- */

export interface Ctx2 {
  s: Solid;
  p: FacadePlan;
  c: FacadeCtx;
  wallTop: number;
  bottom: number;
  floorY: (k: number) => number;
  G1: number;
  /** Rotating hash for this building. */
  H: (k: number) => number;
  clad: { material: string; color: RGBA };
  balconyP: number;
  eave: number;
  bands: boolean;
  units: ShopUnit[];
  mainEdge: number;
  /** The wall of e stops CHAMFER short of its left (r = 0) / right (r = len) end for a chamfered convex corner. */
  chamferL: (e: Edge) => boolean;
  chamferR: (e: Edge) => boolean;
}

/** Arris chamfer (m) of building corners: real render is never razor-edged (1-3 cm). */
export const CHAMFER = 0.022;

export function buildFacade(s: Solid, p: FacadePlan, edges: readonly Edge[], c: FacadeCtx): FacadeRecord {
  const before = c.mesh.triangles(LOD0);
  const H = (k: number): number => h01(p.seed, 100 + k);
  const wallTop = p.roof === 'hipped' ? p.roofY : p.roofY + p.parapet;
  const floorY = (k: number): number => (k <= 0 ? p.base : k >= p.storeys ? p.roofY : p.base + p.G + (k - 1) * p.F);
  const cladPick = H(1);
  const clad =
    p.typ === 'T2'
      ? { material: 'fac_stone', color: scale(lin(0xd9d3c6), 1 - p.wear * 0.2) }
      : cladPick < 0.35
        ? { material: 'fac_panel', color: lin(pick([0x3d4044, 0x55595e, 0x2a2c2e, 0x7a7f84], H(2))) }
        : cladPick < 0.5
          ? { material: 'fac_tiles', color: lin(0xe2dfd8) }
          : cladPick < 0.65
            ? { material: 'fac_marble', color: lin(pick([0x8c8a86, 0xcfcac2, 0x5e5c59], H(3))) }
            : { material: 'fac_render', color: scale(p.wall, 0.86) };
  const mainEdge = edges.filter((e) => e.kind === 'street').sort((a, b) => b.len - a.len)[0]?.i ?? -1;
  const x: Ctx2 = {
    s,
    p,
    c,
    wallTop,
    bottom: s.rec.bottomY,
    floorY,
    G1: floorY(1),
    H,
    clad,
    balconyP: p.typ === 'T2' ? 0.65 + 0.2 * H(4) : 0.9 + 0.3 * H(4),
    eave: p.typ === 'T1' && p.roof === 'flat' && H(5) < 0.4 ? 0.35 + 0.2 * H(6) : 0,
    bands: p.typ === 'T2' || (p.typ === 'T1' && H(7) < 0.3),
    units: [],
    mainEdge,
    chamferL: (e) => cornerChamfer(edges, e.i, 'L'),
    chamferR: (e) => cornerChamfer(edges, e.i, 'R'),
  };
  const shops: FacadeRecord['shops'] = [];
  c.mesh.withLod(LOD0, () => {
    for (const e of edges) {
      const units = emitEdge(x, e);
      for (const u of units) {
        shops.push({ r0: r2(u.r0), r1: r2(u.r1), kind: u.kind, trade: u.trade, name: u.name?.name ?? null, poi: u.poi, kepenk: u.kepenk, awning: u.awning, lit: u.signLit, projecting: u.projecting, ...(u.interior ? { interior: true as const } : {}) });
      }
    }
    for (const hole of s.holes) {
      plainRing(x, hole);
    }
    corners(x, edges);
    emitRoof(x, edges);
  });
  c.mesh.withLod(LOD1, () => lod1(x, edges));
  return {
    id: s.rec.id,
    typ: p.typ,
    storeys: p.storeys,
    source: p.source,
    roof: p.roof,
    base: r2(p.base),
    roofY: r2(p.roofY),
    topY: s.rec.topY,
    cikma: p.cikma,
    balcony: p.balcony,
    railing: p.railing,
    edges: { street: edges.filter((e) => e.kind === 'street').length, open: edges.filter((e) => e.kind === 'open').length, party: edges.filter((e) => e.kind === 'party' || e.kind === 'short').length },
    shops,
    lod0Triangles: c.mesh.triangles(LOD0) - before,
  };
}

/** Edge i's left end (r = 0, joined to edge i + 1) or right end (r = len, joined to edge i - 1) is a chamfered corner. */
function cornerChamfer(edges: readonly Edge[], i: number, side: 'L' | 'R'): boolean {
  const n = edges.length;
  const e = edges[i];
  const o = edges[side === 'L' ? (i + 1) % n : (i - 1 + n) % n];
  const exposed = (k: Edge): boolean => k.kind === 'street' || k.kind === 'open';
  return (side === 'L' ? e.convexL : e.convexR) && exposed(e) && exposed(o) && e.len > 0.5 && o.len > 0.5;
}

/**
 * The chamfer strips of the building's convex corners (between two exposed walls): a narrow face at 45° joining the
 * shortened walls, with the wall's paint and full edge wear, so the corner catches a thin highlight and chips.
 */
function corners(x: Ctx2, edges: readonly Edge[]): void {
  const { p, c } = x;
  const n = edges.length;
  for (let i = 0; i < n; i++) {
    const e = edges[i];
    if (!cornerChamfer(edges, i, 'L')) {
      continue;
    }
    const o = edges[(i + 1) % n];
    const nx = e.f.nx + o.f.nx;
    const nz = e.f.nz + o.f.nz;
    const l = Math.hypot(nx, nz) || 1;
    const nrm: Vec3 = [nx / l, 0, nz / l];
    const wi = wallInfo(x, e, null);
    const g = e.gAt(0);
    const ys = [x.bottom, g + 0.2, g + 0.75, g + 1.3, x.G1, ...Array.from({ length: Math.max(0, p.storeys - 1) }, (_, k) => x.floorY(k + 1) - 0.02), x.wallTop - 0.25, x.wallTop]
      .filter((y, k, a) => y >= x.bottom && y <= x.wallTop && (k === 0 || y > a[k - 1] + 0.01))
      .sort((a, b2) => a - b2);
    const variant = wallVariant(x, e);
    const street = e.kind === 'street';
    const b = new Batch(c.mesh, e.f);
    for (let k = 0; k + 1 < ys.length; k++) {
      const y0 = ys[k];
      const y1 = ys[k + 1];
      const clad = street && y1 <= x.G1 + 1e-3;
      const m = clad ? (x.clad.material === 'fac_render' ? variant : x.clad.material) : variant;
      const colAt = (y: number): RGBA => (clad ? shade(x, x.clad.color, y, g) : paintAt(wi, p.wall, CHAMFER, y));
      const wxAt = (y: number): Weather => {
        const w = wallWeather(wi, CHAMFER, y);
        return [w[0], w[1], Math.max(w[2], 0.95), w[3]];
      };
      const pts = [e.f.p(CHAMFER, y0, 0), o.f.p(o.len - CHAMFER, y0, 0), o.f.p(o.len - CHAMFER, y1, 0), e.f.p(CHAMFER, y1, 0)];
      b.poly(m, nrm, pts, [colAt(y0), colAt(y0), colAt(y1), colAt(y1)], undefined, [wxAt(y0), wxAt(y0), wxAt(y1), wxAt(y1)]);
    }
    b.flush();
  }
}

/** Newer rectangles of render (1-3 per façade by wear): a patched-over crack or a repaired corner, repainted. */
function pickRepairs(x: Ctx2, e: Edge, taken: readonly Rect[]): Rect[] {
  const { p } = x;
  const out: Rect[] = [];
  if (e.len < 2.5 || p.typ === 'T3' || p.storeys < 2) {
    return out;
  }
  const n = Math.floor(h01(p.seed + e.i, 340) * (1 + 2.4 * p.wear) + 0.35);
  for (let k = 0; k < n * 3 && out.length < n; k++) {
    const U = (q: number): number => h01(p.seed + e.i * 7 + k * 13, 350 + q);
    const w = 0.6 + 1.6 * U(1);
    const h = 0.5 + 1.3 * U(2);
    const r0 = 0.15 + (e.len - 0.3 - w) * U(3);
    const y0 = x.G1 + 0.15 + (x.wallTop - x.G1 - 0.4 - h) * U(4);
    const q: Rect = { r0, r1: r0 + w, y0, y1: y0 + h };
    if (q.r1 < e.len - 0.1 && q.y1 < x.wallTop - 0.3 && !taken.some((t) => q.r0 < t.r1 + 0.05 && q.r1 > t.r0 - 0.05 && q.y0 < t.y1 + 0.05 && q.y1 > t.y0 - 0.05) && !out.some((t) => q.r0 < t.r1 && q.r1 > t.r0 && q.y0 < t.y1 && q.y1 > t.y0)) {
      out.push(q);
    }
  }
  return out;
}

/** Fresh paint of a repair: the same colour family, lighter and a touch off in hue (never quite matched). */
function repairPaint(wall: RGBA, u: number): RGBA {
  const k = 1.03 + 0.06 * u;
  const shift: RGBA = u < 0.5 ? [1.03, 1, 0.95, 1] : [0.97, 1, 1.03, 1];
  return [Math.min(1, wall[0] * k * shift[0]), Math.min(1, wall[1] * k * shift[1]), Math.min(1, wall[2] * k * shift[2]), wall[3]];
}

/** Peeling paint on ground-floor walls (piers between shops, open edges): 0-2 patches by wear. */
function pickPeels(x: Ctx2, e: Edge, units: readonly ShopUnit[], taken: readonly Rect[]): Rect[] {
  const { p } = x;
  const out: Rect[] = [];
  if (p.wear < 0.35 || p.typ === 'T3') {
    return out;
  }
  // Only rendered ground floors peel (clad piers are tiles, marble or panels).
  if (e.kind === 'street' && x.clad.material !== 'fac_render' && x.clad.material !== 'fac_stone') {
    return out;
  }
  const n = Math.floor(h01(p.seed + e.i, 360) * 2.6 * p.wear);
  for (let k = 0; k < n * 4 && out.length < n; k++) {
    const U = (q: number): number => h01(p.seed + e.i * 11 + k * 17, 370 + q);
    const w = 0.4 + 1.0 * U(1);
    const r0 = 0.1 + (e.len - 0.2 - w) * U(2);
    const g = e.gAt(r0);
    const y0 = g + 0.35 + 0.9 * U(3);
    const q: Rect = { r0, r1: r0 + w, y0, y1: Math.min(y0 + 0.4 + 1.1 * U(4), x.G1 - 0.15) };
    if (q.y1 - q.y0 > 0.3 && q.r1 < e.len - 0.1 && !units.some((u) => q.r0 < u.r1 + 0.02 && q.r1 > u.r0 - 0.02) && !taken.some((t) => q.r0 < t.r1 && q.r1 > t.r0 && q.y0 < t.y1 && q.y1 > t.y0)) {
      out.push(q);
    }
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------------------- */
/* Wall grid                                                                                                       */
/* ------------------------------------------------------------------------------------------------------------- */

/**
 * A wall rectangle on the plane d, minus holes, as grid cells that share every edge (no T-junctions), emitted as
 * welded sheets (one per material and patch group, frame.ts Batch.sheet) so colour, `_WEATHER` and the wavy shading
 * normal vary smoothly across the wall. `cell` picks the material of a cell, `group` separates cells that must not
 * share vertices with their neighbours (repair patches with crisp edges); `attr` gives each vertex its attributes.
 */
function wallGrid(
  b: Batch,
  d: number,
  R: Rect,
  holes: readonly Rect[],
  extraR: readonly number[],
  extraY: readonly number[],
  cell: (r: number, y: number) => string,
  attr: (r: number, y: number, m: string, group: number) => SheetAttr,
  axis: 'N' | '-N' = 'N',
  group: (r: number, y: number) => number = () => 0,
  maxGap: [number, number] = [Infinity, Infinity],
): void {
  const brk = (vals: number[], lo: number, hi: number, gap: number): number[] => {
    const s = [...new Set(vals.filter((v) => v > lo + 1e-3 && v < hi - 1e-3).map((v) => Math.round(v * 1000) / 1000))].sort((a, c) => a - c);
    const all = [lo, ...s, hi];
    if (!Number.isFinite(gap)) {
      return all;
    }
    // Fill gaps wider than `gap` with evenly spaced lines (vertices for gradients and waviness, no more).
    const out: number[] = [all[0]];
    for (let k = 1; k < all.length; k++) {
      const span = all[k] - all[k - 1];
      const n = Math.ceil(span / gap - 1e-6);
      for (let q = 1; q < n; q++) {
        out.push(Math.round((all[k - 1] + (span * q) / n) * 1000) / 1000);
      }
      out.push(all[k]);
    }
    return out;
  };
  const rs = brk([...holes.flatMap((h) => [h.r0, h.r1]), ...extraR], R.r0, R.r1, maxGap[0]);
  const ys = brk([...holes.flatMap((h) => [h.y0, h.y1]), ...extraY], R.y0, R.y1, maxGap[1]);
  const sheets = new Map<string, { m: string; g: number; quads: [number, number, number, number][] }>();
  for (let j = 0; j + 1 < ys.length; j++) {
    for (let i = 0; i + 1 < rs.length; i++) {
      const rc = (rs[i] + rs[i + 1]) / 2;
      const yc = (ys[j] + ys[j + 1]) / 2;
      if (holes.some((h) => rc > h.r0 && rc < h.r1 && yc > h.y0 && yc < h.y1)) {
        continue;
      }
      const m = cell(rc, yc);
      const g = group(rc, yc);
      const key = `${m}|${g}`;
      let sh = sheets.get(key);
      if (!sh) {
        sh = { m, g, quads: [] };
        sheets.set(key, sh);
      }
      sh.quads.push([rs[i], rs[i + 1], ys[j], ys[j + 1]]);
    }
  }
  for (const sh of sheets.values()) {
    b.sheet(sh.m, axis, d, sh.quads, (r, y) => attr(r, y, sh.m, sh.g));
  }
}

/** Vertical wear gradient of a wall colour: contact darkening at the ground, grime under the roof edge. */
function shade(x: Ctx2, base: RGBA, y: number, g: number): RGBA {
  const w = x.p.wear;
  let k = 1;
  if (y < g + 0.4) {
    k *= 0.62 + 0.38 * Math.max(0, (y - g) / 0.4);
  }
  if (y < g + 1.3) {
    k *= 1 - 0.12 * w * (1 - Math.max(0, (y - g) / 1.3));
  }
  if (y > x.wallTop - 0.8) {
    k *= 1 - 0.14 * w * Math.min(1, (y - (x.wallTop - 0.8)) / 0.8);
  }
  return scale(base, k);
}

/** Rendered (plastered, painted) wall materials: they get the wavy normal and the painted-wall colour drift. */
const RENDERED = /^fac_(render|render_rough|peeling|damaged)(@|$)/;

/** The wall description weather.ts reads, for the plane of edge e (or of its çıkma front at depth `dPlane`). */
function wallInfo(x: Ctx2, e: Edge, ck: Cikma | null, dPlane = 0): WallInfo {
  const { p } = x;
  const floors: number[] = [];
  for (let k = 1; k < p.storeys; k++) {
    floors.push(x.floorY(k));
  }
  return {
    seed: p.seed + e.i * 3.7 + dPlane * 1.3,
    wear: p.wear,
    len: e.len,
    convexL: e.convexL,
    convexR: e.convexR,
    gAt: dPlane > 0 ? () => (ck ? ck.y0 - 12 : e.gMean) : e.gAt,
    wallTop: x.wallTop,
    roofY: p.roofY,
    G1: x.G1,
    floors,
    cikma: ck && dPlane === 0 ? { c0: ck.c0, c1: ck.c1, y0: ck.y0 } : null,
    nx: e.f.nx,
    nz: e.f.nz,
    ox: e.f.ox + e.f.nx * dPlane,
    oz: e.f.oz + e.f.nz * dPlane,
    rx: e.f.rx,
    rz: e.f.rz,
    cornice: p.typ === 'T2' || p.roof === 'hipped' || x.eave > 0,
    party: e.kind === 'party' || e.kind === 'short',
  };
}

/**
 * The wall variant of a façade segment: the clean base, `@weathered` or `@damaged` (peeling paint), by the plan's
 * wear and a per-edge hash, so neighbouring walls of one block do not age identically.
 */
function wallVariant(x: Ctx2, e: Edge, base = 'fac_render'): string {
  const u = h01(x.p.seed + e.i * 5.1, 310);
  const w = x.p.wear;
  if (e.kind === 'party' || e.kind === 'short') {
    return `${base}@weathered`;
  }
  if (base === 'fac_render' && w > 0.55 && u < 0.35 + 0.4 * (w - 0.55)) {
    return 'fac_render@damaged';
  }
  return w > 0.3 || u < 0.25 ? `${base}@weathered` : base;
}

/** Largest cell of a welded wall sheet (m, along and up): enough vertices for 2-4 m waves and slab-to-slab gradients. */
const WALL_GAPS: [number, number] = [2.9, 2.3];

/* ------------------------------------------------------------------------------------------------------------- */
/* Edges                                                                                                           */
/* ------------------------------------------------------------------------------------------------------------- */

function emitEdge(x: Ctx2, e: Edge): ShopUnit[] {
  const { p, c } = x;
  const b = new Batch(c.mesh, e.f);
  const g = e.gMean;
  const partyColor = mix(p.wall, lin(0xb9b6b0), 0.55);
  if (e.kind === 'party' || e.kind === 'short') {
    const R: Rect = { r0: 0, r1: e.len, y0: x.bottom, y1: x.wallTop };
    const wi = wallInfo(x, e, null);
    const mat = wallVariant(x, e);
    const lines = { r: [] as number[], y: [g + 0.4, g + 1.3, x.wallTop - 0.8] };
    wallGrid(b, 0, R, [], lines.r, lines.y, () => mat, (r, y) => ({ color: paintAt(wi, partyColor, r, y), weather: wallWeather(wi, r, y), tilt: wavyTilt(wi, r, y) }), 'N', () => 0, [3.2, 2.6]);
    b.flush();
    parapetPieces(x, e, b, null);
    b.flush();
    return [];
  }
  const ck = cikmaSpan(x, e);
  // Ground floor: shop units on street edges.
  const units =
    e.kind === 'street'
      ? planShops(
          {
            f: e.f,
            len: e.len,
            gAt: e.gAt,
            convexL: e.convexL,
            convexR: e.convexR,
            pois: poisOn(x, e),
            doors: doorsOn(x, e),
            main: e.i === x.mainEdge,
            market: c.market,
            clearAt: (r) => clearAhead(x, e, r),
            interior: (doorId, poiId) => interiorLink(x, doorId, poiId),
          },
          p,
          c.avoid,
        )
      : [];
  const holes: Rect[] = units.map((u) => ({ r0: u.r0, r1: u.r1, y0: u.yFloor, y1: u.yOpen }));
  // Upper windows on the wall plane (outside the çıkma), and small ground-floor windows on open edges.
  const m = 0.35;
  const spans: [number, number][] = ck ? [[m, ck.c0 - 0.25], [ck.c1 + 0.25, e.len - m]].filter(([a0, a1]) => a1 - a0 > 1.0) as [number, number][] : [[m, e.len - m]];
  const wins: Win[] = [];
  for (const [a0, a1] of spans) {
    wins.push(...layoutWindows(x, e, a0, a1, 0, true));
  }
  if (e.kind === 'open' && x.p.typ !== 'T5') {
    wins.push(...groundWindows(x, e));
  }
  for (const w of wins) {
    holes.push({ r0: w.r0, r1: w.r1, y0: w.y0, y1: w.y1 + w.box });
  }
  if (ck) {
    holes.push({ r0: ck.c0, r1: ck.c1, y0: ck.y0, y1: x.wallTop + 1 });
  }
  const R: Rect = { r0: x.chamferL(e) ? CHAMFER : 0, r1: e.len - (x.chamferR(e) ? CHAMFER : 0), y0: x.bottom, y1: x.wallTop };
  const patches = pickPatches(x, e, wins, holes);
  const repairs = pickRepairs(x, e, [...holes, ...patches]);
  const peels = pickPeels(x, e, units, [...holes, ...patches, ...repairs]);
  const peelParapet = p.wear > 0.55 && p.roof === 'flat';
  const variant = wallVariant(x, e);
  const cladMat = x.clad.material === 'fac_render' ? variant : x.clad.material;
  const inRect = (q: Rect, r: number, y: number): boolean => r > q.r0 && r < q.r1 && y > q.y0 && y < q.y1;
  const cell = (r: number, y: number): string => {
    if (patches.some((q) => inRect(q, r, y))) {
      return 'fac_damaged';
    }
    if (y > p.roofY && peelParapet) {
      return 'fac_peeling';
    }
    if (e.kind === 'street' && y < x.G1 - 0.02) {
      return cladMat;
    }
    return variant;
  };
  const wi = wallInfo(x, e, ck);
  const attr = (r: number, y: number, mat: string): SheetAttr => {
    const rendered = RENDERED.test(mat);
    const wx = wallWeather(wi, r, y);
    let base = p.wall;
    if (mat === 'fac_damaged') {
      base = lin(0xe0dbd2);
    } else if (y < x.G1 && e.kind === 'street' && mat === cladMat) {
      base = x.clad.color;
    }
    let col = rendered ? paintAt(wi, base, r, y) : shade(x, scale(base, 1 + 0.08 * (fbm(r + e.i * 13, y, 1.8, p.seed) - 0.5)), y, e.gAt(r));
    if (ck && r > ck.c0 - 0.3 && r < ck.c1 + 0.3 && y < ck.y0 && y > ck.y0 - 0.5) {
      col = scale(col, 0.78 + 0.22 * ((ck.y0 - y) / 0.5));
    }
    return { color: col, weather: wx, ...(rendered ? { tilt: wavyTilt(wi, r, y) } : {}) };
  };
  const extraY = [g + 0.4, g + 1.3, x.G1, x.wallTop - 0.8, p.roofY, ...(ck ? [ck.y0 - 0.5] : [])];
  wallGrid(b, 0, R, holes, patches.flatMap((q) => [q.r0, q.r1]), [...extraY, ...patches.flatMap((q) => [q.y0, q.y1])], cell, attr, 'N', () => 0, WALL_GAPS);
  // Repairs (fresher paint, little grime, no chips yet) and peeling ground-floor paint: thin overlays 3-4 mm proud
  // of the wall, so they need no grid lines of their own.
  const fresh = repairPaint(p.wall, x.H(330 + e.i));
  const fwi = { ...wi, wear: wi.wear * 0.3 };
  for (const q of repairs) {
    const c4: [number, number, number][] = [[q.r0, q.y0, 0.004], [q.r1, q.y0, 0.004], [q.r1, q.y1, 0.004], [q.r0, q.y1, 0.004]];
    b.quadF(variant, 'N', c4, c4.map(([r, y]) => paintAt(fwi, fresh, r, y)), undefined, c4.map(([r, y]): Weather => {
      const w = wallWeather(wi, r, y);
      return [w[0] * 0.3, w[1] * 0.25, 0, w[3] * 0.8];
    }));
  }
  for (const q of peels) {
    const c4: [number, number, number][] = [[q.r0, q.y0, 0.003], [q.r1, q.y0, 0.003], [q.r1, q.y1, 0.003], [q.r0, q.y1, 0.003]];
    b.quadF('fac_peeling', 'N', c4, c4.map(([r, y]) => paintAt(wi, scale(p.wall, 0.97), r, y)), undefined, c4.map(([r, y]) => wallWeather(wi, r, y)));
  }
  b.flush();
  for (const w of wins) {
    emitWindow(x, e, b, w, 0, p.wall);
    b.flush();
  }
  if (e.kind === 'street' && (p.typ === 'T1' || p.typ === 'T3') && x.H(900 + e.i) < 0.3) {
    upperTrade(x, e, b, wins);
    b.flush();
  }
  const balconies = emitBalconies(x, e, b, wins, ck);
  if (ck) {
    emitCikma(x, e, b, ck);
  }
  trims(x, e, b, ck);
  parapetPieces(x, e, b, ck);
  b.flush();
  for (const u of units) {
    emitShopUnit(b, u, p, { lights: c.lights, place: c.place, tile: c.tile, clad: x.clad, G1: x.G1, depthAt: (r) => depthBehind(x, e, r) });
    b.flush();
  }
  decals(x, e, b, wins, units);
  b.flush();
  if (e.kind === 'street') {
    streetWear(x, e, b, wins, units);
    b.flush();
  }
  if (e.kind === 'street' || e.kind === 'open') {
    facadeLife(x, e, b, { wins, units, balconies, ck, R });
    b.flush();
  }
  return units;
}

/**
 * The lived-in layer of a street façade (spec T1 wear; S1 critique "everything is too clean"): soot under the slab
 * edges, a downpipe per plot, cable bundles under the eaves with drops, posters, stickers and spray tags up to 2.5 m
 * on the piers and on shut kepenks.
 */
function streetWear(x: Ctx2, e: Edge, b: Batch, wins: readonly Win[], units: readonly ShopUnit[]): void {
  const { p } = x;
  const H = (k: number): number => h01(p.seed + e.i * 17.3, 1000 + k);
  const d = 0.013;
  // Soot and run-off under the slab edges of the upper floors (0.3-1.0 m), broken by the windows.
  if (p.typ !== 'T2' || p.wear > 0.4) {
    for (let k = 1; k < p.storeys; k++) {
      const yTop = x.floorY(k) - 0.02;
      if (yTop < x.G1 + 0.5) {
        continue;
      }
      for (let r = 0.2; r < e.len - 0.4; r += 0.9 + 1.1 * H(k * 31 + r)) {
        const w = 0.5 + 0.9 * H(k * 37 + r);
        const r1 = Math.min(e.len - 0.1, r + w);
        const hit = wins.find((q) => r1 > q.r0 && r < q.r1 && q.y1 + q.box > yTop - 1.0 && q.y0 < yTop);
        const len = hit ? Math.max(0, yTop - (hit.y1 + hit.box) - 0.03) : 0.3 + 0.7 * H(k * 41 + r);
        if (len < 0.15 || H(k * 43 + r) > 0.35 + 0.5 * p.wear) {
          continue;
        }
        const u0 = H(k * 47 + r) * 0.6;
        b.quadF('fac_leak', 'N', [[r, yTop - len, d], [r1, yTop - len, d], [r1, yTop, d], [r, yTop, d]], [0.55, 0.45, 0.62, 0.3 + 0.35 * p.wear], [
          [u0, 1],
          [u0 + Math.min(0.4, w / 3), 1],
          [u0 + Math.min(0.4, w / 3), 0],
          [u0, 0],
        ]);
      }
    }
  }
  // A downpipe per plot, at the end of the main street edge, with a hopper, brackets and a shoe.
  if (e.i === x.mainEdge && e.len > 3) {
    const rp = H(1) < 0.5 ? 0.18 : e.len - 0.3;
    const pipe = H(2) < 0.6 ? lin(0x8f9396) : lin(0x6a6e70);
    const top = p.roofY - 0.12;
    b.box('fac_metal', rp, rp + 0.1, e.gAt(rp) - 0.02, top, 0.03, 0.13, pipe, { front: true, left: true, right: true });
    b.box('fac_metal', rp - 0.06, rp + 0.16, top - 0.02, top + 0.2, 0.0, 0.2, scale(pipe, 0.9), { front: true, left: true, right: true, bottom: true, top: true });
    for (let y = x.G1 + 0.6; y < top - 0.5; y += 2.0) {
      b.box('fac_metal', rp - 0.03, rp + 0.13, y, y + 0.04, 0.0, 0.14, scale(pipe, 0.7), { front: true, top: true, bottom: true });
    }
    // Cracked render beside the pipe (leaking joints wet the wall), and the stain down the wall.
    for (let k = 0; k < 2; k++) {
      if (H(7 + k) < 0.45 + 0.5 * p.wear) {
        const yc = x.G1 + 0.6 + (top - x.G1 - 1.5) * H(9 + k);
        crack(b, rp + (rp < e.len / 2 ? 0.16 : -0.06), yc, rp < e.len / 2 ? 1 : -1, -1, 0.5 + 0.8 * H(11 + k), p.seed + k * 31);
      }
    }
    b.quadF('fac_leak_band', 'N', [[rp - 0.25, x.G1, d], [rp + 0.35, x.G1, d], [rp + 0.35, top, d], [rp - 0.25, top, d]], [0.6, 0.5, 0.62, 0.35], [
      [0.1, 1],
      [0.35, 1],
      [0.35, 0],
      [0.1, 0],
    ]);
  }
  // Cable bundle under the eaves: three cables clipped every 1.2 m, sagging 2-5 cm between the clips (front and
  // underside faces of each half-span), with drops to the shop band.
  const cableCol = lin(0x141414);
  const yc = (p.roof === 'flat' ? p.roofY - 0.3 : p.roofY - 0.45) - 0.2 * H(3);
  const nSeg = Math.max(1, Math.round(e.len / 1.2));
  for (let q = 0; q < 3; q++) {
    const yq = yc - q * 0.035 - 0.012;
    const d0 = 0.03 + q * 0.012;
    const d1 = d0 + 0.015;
    const th = 0.018 + 0.008 * (q % 2);
    for (let k = 0; k < nSeg; k++) {
      const a = (e.len * k) / nSeg;
      const c2 = (e.len * (k + 1)) / nSeg;
      const m = (a + c2) / 2;
      const sag = 0.02 + 0.03 * H(500 + q * 31 + k);
      for (const [ra, rb, ya, yb] of [
        [a, m, yq, yq - sag],
        [m, c2, yq - sag, yq],
      ] as const) {
        b.quadF('fac_metal', 'N', [[ra, ya - th, d1], [rb, yb - th, d1], [rb, yb, d1], [ra, ya, d1]], cableCol);
        b.poly('fac_metal', e.f.dir('-Y'), [e.f.p(ra, ya - th, d0), e.f.p(rb, yb - th, d0), e.f.p(rb, yb - th, d1), e.f.p(ra, ya - th, d1)], cableCol);
      }
    }
  }
  const drops = 1 + Math.floor(H(4) * 2);
  for (let k = 0; k < drops; k++) {
    const rd = Math.min(e.len - 0.2, Math.max(0.2, e.len * (0.15 + 0.7 * H(5 + k))));
    if (wins.some((w) => rd > w.r0 - 0.05 && rd < w.r1 + 0.05)) {
      continue;
    }
    b.box('fac_metal', rd, rd + 0.018, x.G1 - 0.2, yc, 0.03, 0.048, cableCol, { front: true, left: true, right: true });
  }
  // Posters, stickers and tags on the piers between the units and on shut kepenks.
  const surfaces: { r0: number; r1: number; y0: number; y1: number; d: number }[] = [];
  const sorted = [...units].sort((a, c) => a.r0 - c.r0);
  let cur = 0;
  for (const u of sorted) {
    if (u.r0 - cur > 0.35) {
      surfaces.push({ r0: cur + 0.05, r1: u.r0 - 0.05, y0: e.gAt(cur) + 0.9, y1: Math.min(e.gAt(cur) + 2.5, x.G1 - 0.3), d: 0.015 });
    }
    if (u.kind === 'shop' && u.kepenk === 'closed') {
      const yK = u.yFloor + 0.3;
      surfaces.push({ r0: u.r0 + 0.2, r1: u.r1 - 0.2, y0: yK, y1: Math.min(u.yOpen - 0.45, u.yFloor + 2.4), d: -0.085 });
    }
    cur = u.r1;
  }
  const posterCols = [0xe8e4d8, 0xd9c63a, 0xc8412f, 0x2f62a0, 0x1e1e1e, 0xe0a0ac, 0x5aa04a, 0xe8e4d8];
  // Bleach and dirt of paper outdoors: posters fade towards grey-white within weeks.
  const aged = (hex: number, u: number): RGBA => mix(lin(hex), lin(0xc9c4b8), 0.15 + 0.45 * u);
  surfaces.forEach((sf, k) => {
    if (sf.y1 - sf.y0 < 0.3 || sf.r1 - sf.r0 < 0.25) {
      return;
    }
    const kepenk = sf.d < 0;
    const n = Math.min(4, Math.floor(((sf.r1 - sf.r0) * (sf.y1 - sf.y0)) / 0.35) + (H(60 + k) < 0.5 ? 1 : 0));
    for (let q = 0; q < n; q++) {
      const pw = Math.min(sf.r1 - sf.r0, 0.3 + 0.25 * H(70 + k * 7 + q));
      const ph = pw * (1.2 + 0.3 * H(80 + k * 7 + q));
      const r0 = sf.r0 + (sf.r1 - sf.r0 - pw) * H(90 + k * 7 + q);
      const y0 = sf.y0 + Math.max(0, sf.y1 - sf.y0 - ph) * H(100 + k * 7 + q);
      if (y0 + ph > sf.y1 + 0.05 || H(110 + k * 7 + q) > 0.75) {
        continue;
      }
      const u = H(115 + k * 7 + q);
      const col = scale(aged(pick(posterCols, H(120 + k * 7 + q)), u), 0.85 + 0.15 * H(130 + k));
      const dd = sf.d + 0.002 + q * 0.001;
      const torn = H(135 + k * 7 + q) < 0.35;
      if (torn) {
        // Torn off: only strips of the old sheet remain, and the scraped paste shows grey around them.
        b.quadF('fac_paper', 'N', [[r0 - 0.03, y0 - 0.03, dd - 0.0005], [r0 + pw + 0.03, y0 - 0.03, dd - 0.0005], [r0 + pw + 0.03, y0 + ph + 0.03, dd - 0.0005], [r0 - 0.03, y0 + ph + 0.03, dd - 0.0005]], lin(0x8e8a80, 1, 1));
        for (let s2 = 0; s2 < 3; s2++) {
          const sr = r0 + pw * H(140 + s2 + q);
          const sw2 = pw * (0.08 + 0.18 * H(145 + s2 + q));
          const sh = ph * (0.3 + 0.6 * H(150 + s2 + q));
          b.quadF('fac_paper', 'N', [[sr, y0 + ph - sh, dd], [Math.min(r0 + pw, sr + sw2), y0 + ph - sh * 0.8, dd], [Math.min(r0 + pw, sr + sw2), y0 + ph, dd], [sr, y0 + ph, dd]], col);
        }
        continue;
      }
      b.quadF('fac_paper', 'N', [[r0, y0, dd], [r0 + pw, y0, dd], [r0 + pw, y0 + ph, dd], [r0, y0 + ph, dd]], col);
      // A headline band and a picture block on the poster.
      const dark = pick(posterCols, H(140 + k * 7 + q));
      b.quadF('fac_paper', 'N', [[r0 + pw * 0.1, y0 + ph * 0.72, dd + 0.001], [r0 + pw * 0.9, y0 + ph * 0.72, dd + 0.001], [r0 + pw * 0.9, y0 + ph * 0.88, dd + 0.001], [r0 + pw * 0.1, y0 + ph * 0.88, dd + 0.001]], aged(dark === pick(posterCols, H(120 + k * 7 + q)) ? 0x1e1e1e : dark, u));
      b.quadF('fac_paper', 'N', [[r0 + pw * 0.15, y0 + ph * 0.2, dd + 0.001], [r0 + pw * 0.85, y0 + ph * 0.2, dd + 0.001], [r0 + pw * 0.85, y0 + ph * 0.62, dd + 0.001], [r0 + pw * 0.15, y0 + ph * 0.62, dd + 0.001]], scale(col, 0.55));
    }
    // Stickers: a scatter of small labels.
    for (let q = 0; q < 5; q++) {
      if (H(150 + k * 11 + q) > 0.55) {
        continue;
      }
      const sw = 0.06 + 0.06 * H(160 + k * 11 + q);
      const r0 = sf.r0 + (sf.r1 - sf.r0 - sw) * H(170 + k * 11 + q);
      const y0 = sf.y0 + (sf.y1 - sf.y0 - sw) * H(180 + k * 11 + q);
      b.quadF('fac_paper', 'N', [[r0, y0, sf.d + 0.004], [r0 + sw, y0, sf.d + 0.004], [r0 + sw, y0 + sw * 0.7, sf.d + 0.004], [r0, y0 + sw * 0.7, sf.d + 0.004]], lin(pick(posterCols, H(190 + k * 11 + q))));
    }
    // Spray paint: on 85 % of shut kepenks (soul catalogue §15) and some piers, 1.0-2.2 m up: a tag, and on wide
    // shutters a bigger two-colour throw-up. Invented words only, no crews or brands.
    if (H(200 + k) < (kepenk ? 0.85 : 0.2 * (0.5 + p.wear))) {
      const tag = pick(TAGS, H(210 + k));
      const cap = Math.min(0.32, (sf.r1 - sf.r0 - 0.1) / Math.max(0.1, textWidth(tag)));
      if (cap > 0.1) {
        const tc = lin(pick([0x1e1e1e, 0xb02a2a, 0x2a50b0, 0xd8d8d8, 0x2a8a3a, 0x1e1e1e], H(220 + k)));
        spray(b, tag, sf.r0 + (sf.r1 - sf.r0) * (0.3 + 0.4 * H(225 + k)), Math.min(sf.y1 - cap - 0.05, sf.y0 + 0.3 + 0.5 * H(230 + k)), sf.d + 0.006, cap, tc, null, p.seed + k * 7.3);
      }
      if (kepenk && sf.r1 - sf.r0 > 2.2 && H(240 + k) < 0.5) {
        const word = pick(THROWUPS, H(245 + k));
        const big = Math.min(0.36, (sf.r1 - sf.r0 - 0.5) / Math.max(0.1, textWidth(word)));
        const yb = sf.y0 + 0.1 + 0.25 * H(250 + k);
        const rc = (sf.r0 + sf.r1) / 2 + (H(255 + k) - 0.5) * 0.4;
        // A throw-up: a chrome or bright fill over a black outline, letters bouncing, paint running.
        spray(b, word, rc, yb, sf.d + 0.008, big, scale(lin(pick([0xb8b8b4, 0xc8b040, 0xc05a8a, 0x40a0b0, 0xd07030, 0xb8b8b4], H(260 + k))), 0.8), lin(0x121212), p.seed + k * 11.1);
      }
    }
  });
}

/**
 * Sprayed lettering: each letter bounces (height and size jitter) and leans on its neighbours, an optional outline
 * sits behind the fill, and paint runs from some letters. `r` is the centre of the word, `y` its baseline.
 */
function spray(b: Batch, word: string, r: number, y: number, d: number, cap: number, fill: RGBA, outline: RGBA | null, seed: number): void {
  const chars = [...word];
  const adv = (ch: string, c: number): number => (textWidth(ch) + 0.06) * c;
  const caps = chars.map((_, k) => cap * (0.88 + 0.26 * h01(seed, 600 + k)));
  const total = chars.reduce((q, ch, k) => q + adv(ch, caps[k]), 0);
  let cur = r - total / 2;
  chars.forEach((ch, k) => {
    const c = caps[k];
    const w = adv(ch, c);
    const rc = cur + w / 2;
    const yc = y + (h01(seed, 620 + k) - 0.5) * cap * 0.28;
    if (outline) {
      emitText(b, ch, { material: 'fac_spray', color: outline, r: rc + c * 0.05, y: yc - c * 0.06, d, capH: c * 1.12, depth: 0 });
    }
    emitText(b, ch, { material: 'fac_spray', color: fill, r: rc, y: yc, d: d + 0.0015, capH: c, depth: 0 });
    // A run of paint below some letters.
    if (h01(seed, 640 + k) < 0.3) {
      const dr = rc + (h01(seed, 660 + k) - 0.5) * c * 0.4;
      const len = c * (0.2 + 0.7 * h01(seed, 680 + k));
      b.quadF('fac_spray', 'N', [[dr - 0.004, yc - len, d + 0.001], [dr + 0.004, yc - len, d + 0.001], [dr + 0.006, yc + 0.01, d + 0.001], [dr - 0.006, yc + 0.01, d + 0.001]], fill);
    }
    cur += w;
  });
}

/** Spray tags and throw-up words: ordinary Turkish words and nonsense, no real crews, brands or slogans. */
const TAGS = ['ZORT', 'KEDİ', 'LODOS', 'POYRAZ', 'BORA', 'NAR', 'SİS', 'KOZA', 'MARTI', 'ÇAKIL', 'TOZ', 'VIZ', 'HOP', 'ZEN'];
const THROWUPS = ['MARTI', 'POYRAZ', 'LODOS', 'KOZA', 'ZORT', 'VIZ'];

/** Upper-floor businesses of the photos (c06, c11): lettering on first-floor windows and a vinyl banner below them. */
const UPPER_TRADES = ['DİŞ HEKİMİ', 'AVUKAT', 'DERSHANE', 'DÖVME', 'KUAFÖR', 'MUAYENEHANE', 'EMLAK', 'TERZİ', 'MALİ MÜŞAVİR', 'FİZYOTERAPİ', 'ETÜT MERKEZİ', 'PİLATES'];

function upperTrade(x: Ctx2, e: Edge, b: Batch, wins: readonly Win[]): void {
  const floor = x.H(910 + e.i) < 0.7 ? 1 : 2;
  const row = wins.filter((w) => w.floor === floor && (w.kind === 'window' || w.kind === 'ribbon')).sort((a, c) => a.r0 - c.r0);
  if (!row.length) {
    return;
  }
  const word = pick(UPPER_TRADES, x.H(920 + e.i));
  const letter = lin(pick([0xf4f2ea, 0xf2c94c, 0xd62f2f, 0xf4f2ea], x.H(930 + e.i)));
  const rev = x.p.typ === 'T3' ? 0.12 : 0.16;
  for (const w of row) {
    const glassW = w.r1 - w.r0 - 0.2;
    const cap = Math.min(0.17, glassW / Math.max(0.1, textWidth(word)));
    if (cap < 0.06) {
      continue;
    }
    emitText(b, word, { material: 'fac_letters', color: letter, r: (w.r0 + w.r1) / 2, y: w.y0 + (w.y1 - w.y0) * 0.55, d: -rev + 0.045, capH: cap, depth: 0 });
  }
  // A banner across the spandrel under the row (above the shop sign band).
  const first = row[0];
  const last = row[row.length - 1];
  const y1 = first.y0 - 0.12;
  const y0 = Math.max(x.G1 + 0.08, y1 - 0.75);
  if (y1 - y0 > 0.4 && x.H(940 + e.i) < 0.75) {
    const r0 = Math.max(0.2, first.r0 - 0.15);
    const r1 = Math.min(e.len - 0.2, last.r1 + 0.15);
    const [bgHex, darkBg] = pick<[number, boolean]>([
      [0xc8242b, true],
      [0xf2c94c, false],
      [0x1d4f9e, true],
      [0xf2f0ea, false],
      [0x1f6b45, true],
    ], x.H(950 + e.i));
    const bg = lin(bgHex);
    const dark = darkBg;
    b.box('fac_vinyl', r0, r1, y0, y1, 0, 0.025, bg, { front: true, top: true, bottom: true, left: true, right: true }, [0.3, 0.4, 0, 0]);
    const text = word;
    const cap = Math.min((y1 - y0) * 0.5, (r1 - r0 - 0.3) / Math.max(0.1, textWidth(text)));
    if (cap > 0.08) {
      emitText(b, text, { material: 'fac_letters', color: dark ? lin(0xf6f2e8) : lin(0x1e1e1e), r: (r0 + r1) / 2, y: (y0 + y1) / 2 - cap / 2, d: 0.028, capH: cap, depth: 0 });
    }
  }
}

/** The compiled interior behind a door record (or POI) of this building, if the interiors step lists one. */
function interiorLink(x: Ctx2, doorId: string | null, poiId: string | null): { name?: string; doorWidth: number } | null {
  const sh = x.c.interiors();
  if (!sh) {
    return null;
  }
  const byDoor = doorId ? sh.doors.get(doorId) : undefined;
  if (byDoor) {
    return { name: byDoor.name, doorWidth: byDoor.doorWidth };
  }
  if (poiId && sh.pois.has(poiId)) {
    for (const v of sh.doors.values()) {
      if (v.poi === poiId) {
        return { name: v.name, doorWidth: v.doorWidth };
      }
    }
  }
  return null;
}

/** POIs of the building projected on this edge (those whose nearest street edge it is). */
function poisOn(x: Ctx2, e: Edge): { id: string; kind: string; r: number }[] {
  const out: { id: string; kind: string; r: number }[] = [];
  for (const q of x.c.pois) {
    const px = q.position[0];
    const pz = q.position[2];
    const r = (px - e.f.ox) * e.f.rx + (pz - e.f.oz) * e.f.rz;
    const d = (px - e.f.ox) * e.f.nx + (pz - e.f.oz) * e.f.nz;
    if (r > -1 && r < e.len + 1 && Math.abs(d) < 6) {
      out.push({ id: q.id, kind: q.kind, r: Math.max(0, Math.min(e.len, r)) });
    }
  }
  return out;
}

function doorsOn(x: Ctx2, e: Edge): { id: string; r: number; width: number; height: number; inferred: boolean; entrance: string }[] {
  const out: { id: string; r: number; width: number; height: number; inferred: boolean; entrance: string }[] = [];
  for (const d of x.c.doors) {
    const r = (d.position[0] - e.f.ox) * e.f.rx + (d.position[2] - e.f.oz) * e.f.rz;
    const dd = (d.position[0] - e.f.ox) * e.f.nx + (d.position[2] - e.f.oz) * e.f.nz;
    if (Math.abs(dd) < 0.3 && r > 0 && r < e.len) {
      out.push({ id: d.id, r, width: d.width, height: d.height, inferred: d.inferred, entrance: d.entrance });
    }
  }
  return out;
}

/** Free depth in front of the wall at r before another building (max 4.5 m). */
function clearAhead(x: Ctx2, e: Edge, r: number): number {
  for (let d = 0.5; d <= 4.5; d += 0.25) {
    const [px, pz] = e.f.xz(r, d);
    if (x.c.footprints.inside(px, pz) && !pointInRing(x.s.ring, px, pz)) {
      return d;
    }
  }
  return 4.5;
}

/** Depth inside the own footprint behind the wall at r (max 4 m). */
function depthBehind(x: Ctx2, e: Edge, r: number): number {
  for (let d = 0.5; d <= 4; d += 0.25) {
    const [px, pz] = e.f.xz(r, -d);
    if (!pointInRing(x.s.ring, px, pz)) {
      return d;
    }
  }
  return 4;
}

/* ------------------------------------------------------------------------------------------------------------- */
/* Windows                                                                                                         */
/* ------------------------------------------------------------------------------------------------------------- */

function balconyAt(mode: FacadePlan['balcony'], bay: number, nb: number): boolean {
  switch (mode) {
    case 'all':
      return true;
    case 'alternate':
      return bay % 2 === (nb % 2 === 1 ? 1 : 0) || nb <= 2;
    case 'centre':
      return nb >= 3 ? bay === Math.floor(nb / 2) : nb === 1;
    case 'ends':
      return nb >= 3 && (bay === 0 || bay === nb - 1);
    default:
      return false;
  }
}

/** Windows of the upper floors on the span [a, b] of a plane (d = 0 wall or the çıkma front). */
function layoutWindows(x: Ctx2, e: Edge, a: number, b: number, dPlane: number, allowBalcony: boolean): Win[] {
  const { p } = x;
  const out: Win[] = [];
  const w = b - a;
  if (w < 1.0 || p.storeys < 2) {
    return out;
  }
  const seedE = p.seed * 3.1 + e.i * 1.7 + dPlane * 5.3 + a * 0.37;
  if (p.typ === 'T3') {
    for (let k = 1; k < p.storeys; k++) {
      const fy = x.floorY(k);
      const shop = p.glazedBase === 2 && k === 1 && e.kind === 'street' && dPlane === 0;
      out.push({ r0: a + 0.3, r1: b - 0.3, y0: fy + (shop ? 0.12 : 0.9), y1: shop ? x.floorY(k + 1) - 0.35 : fy + 2.55, box: 0, kind: shop ? 'shopribbon' : 'ribbon', floor: k, fy, seed: seedE + k });
    }
    return out;
  }
  const bayW = p.typ === 'T2' ? 2.75 : 3.1;
  const nb = Math.max(1, Math.floor(w / bayW + 0.3));
  const bw = w / nb;
  for (let j = 0; j < nb; j++) {
    const rc = a + (j + 0.5) * bw;
    const hb = h01(seedE, j);
    let ww: number;
    if (p.typ === 'T2') {
      ww = Math.min(1.05, bw - 0.6);
    } else if (bw >= 2.9 && hb < p.triple) {
      ww = Math.min(2.6, bw - 0.5);
    } else {
      ww = Math.min(1.35, bw - 0.45);
    }
    if (ww < 0.55) {
      continue;
    }
    const balc = allowBalcony && e.kind === 'street' && balconyAt(p.balcony, j, nb);
    for (let k = 1; k < p.storeys; k++) {
      const fy = x.floorY(k);
      const next = x.floorY(k + 1);
      const door = balc && k >= 1;
      let y0: number;
      let y1: number;
      let box = 0;
      if (p.typ === 'T2') {
        y0 = door ? fy + 0.03 : fy + 0.75;
        y1 = Math.min(fy + 2.85, next - 0.55);
        box = 0;
      } else if (p.typ === 'T5') {
        continue;
      } else {
        y0 = door ? fy + 0.03 : fy + 0.9;
        y1 = Math.min(fy + 2.4, next - 0.5);
        box = p.shutters === 'roller' || h01(seedE, 7 + j) < 0.5 ? 0.22 : 0;
      }
      if (y1 - y0 < 0.8) {
        continue;
      }
      const dw = door ? Math.max(ww, Math.min(2.2, bw - 0.4)) : ww;
      out.push({ r0: rc - dw / 2, r1: rc + dw / 2, y0, y1, box, kind: door ? 'door' : 'window', floor: k, fy, seed: seedE + j * 13 + k });
    }
  }
  return out;
}

/** Small windows on the ground floor of open (courtyard / back) edges. */
function groundWindows(x: Ctx2, e: Edge): Win[] {
  const out: Win[] = [];
  const n = Math.floor((e.len - 0.8) / 3.2);
  for (let j = 0; j < n; j++) {
    const rc = 0.4 + (j + 0.5) * ((e.len - 0.8) / n);
    const g = e.gAt(rc);
    const y0 = Math.max(g + 1.2, x.p.base + 1.2);
    const y1 = Math.min(y0 + 1.1, x.G1 - 0.4);
    if (y1 - y0 > 0.6) {
      out.push({ r0: rc - 0.5, r1: rc + 0.5, y0, y1, box: 0, kind: 'small', floor: 0, fy: x.p.base, seed: x.p.seed + e.i * 5 + j });
    }
  }
  return out;
}

/** One window assembly (LOD0) on the plane d = dp. */
function emitWindow(x: Ctx2, e: Edge, b: Batch, w: Win, dp: number, wallCol: RGBA): void {
  const { p, c } = x;
  const U = (q: number): number => h01(w.seed, q);
  const rev = p.typ === 'T2' ? 0.24 : p.typ === 'T3' ? 0.12 : 0.16;
  const df = dp - rev;
  const top = w.y1 + w.box;
  const { r0, r1, y0, y1 } = w;
  const outer = scale(wallCol, 0.95);
  const inner = scale(wallCol, 0.7);
  const rm = dp === 0 ? wallVariant(x, e) : 'fac_render';
  // Reveal weather: grime towards the frame and in the head (AO-like), chipped paint on the outer arris.
  const wxRev = (_r: number, y: number, d: number): Weather => {
    const deep = Math.min(1, (dp - d) / rev);
    return [0.15 + 0.4 * deep * x.p.wear + (y > top - 0.02 ? 0.25 : 0), y > top - 0.02 ? 0.15 : 0, d > dp - 1e-3 ? 0.6 : 0, 0];
  };
  b.quadF(rm, 'R', [[r0, y0, dp], [r0, y0, df], [r0, top, df], [r0, top, dp]], [outer, inner, inner, outer], undefined, wxRev);
  b.quadF(rm, '-R', [[r1, y0, dp], [r1, y0, df], [r1, top, df], [r1, top, dp]], [outer, inner, inner, outer], undefined, wxRev);
  b.quadF(rm, '-Y', [[r0, top, dp], [r1, top, dp], [r1, top, df], [r0, top, df]], [outer, outer, inner, inner], undefined, wxRev);
  b.quadF(rm, 'Y', [[r0, y0, dp], [r1, y0, dp], [r1, y0, df], [r0, y0, df]], [outer, outer, inner, inner], undefined, wxRev);
  const shop = w.kind === 'shopribbon';
  const frameMat = p.typ === 'T3' || shop ? 'fac_alu' : p.frame === 'timber' ? 'fac_timber' : 'fac_pvc';
  // White PVC yellows and greys with age, a little differently per window (replaced one at a time).
  const frameCol = p.typ === 'T3' || shop ? lin(0x3b3e41) : p.frame === 'pvc' ? scale(mix(p.frameColor, lin(0xd9d2bd), 0.25 * U(40) + 0.2 * p.wear), 0.97 + 0.05 * U(41)) : p.frameColor;
  const fw = p.typ === 'T2' ? 0.075 : 0.065;
  const fd = 0.07;
  // Roller box (T1) at the top of the opening.
  if (w.box > 0) {
    b.box('fac_pvc', r0, r1, y1, top, df, dp - 0.012, lin(pick([0xe6e4dc, 0xdcd4c0, 0xcfcfca], U(1))), { front: true, bottom: true });
  }
  // Room box behind the glass (lit at night for some windows).
  const lit = shop || U(2) < 0.35;
  const room = shop ? 'fac_shop_lit' : lit ? 'fac_room_lit' : 'fac_room';
  const roomCol = shop ? lin(0xeeeae2) : lin(pick([0x5b5147, 0x4a4540, 0x6a5a4a, 0x505862], U(3)), 0.8);
  const rb = df - (shop ? 2.5 : 0.45);
  const ra = r0 - 0.45;
  const rz = r1 + 0.45;
  const ya = y0 - 0.35;
  const yz = y1 + 0.3;
  b.quadF(room, 'N', [[ra, ya, rb], [rz, ya, rb], [rz, yz, rb], [ra, yz, rb]], roomCol);
  b.quadF(room, 'R', [[ra, ya, df], [ra, ya, rb], [ra, yz, rb], [ra, yz, df]], scale(roomCol, 0.8));
  b.quadF(room, '-R', [[rz, ya, df], [rz, ya, rb], [rz, yz, rb], [rz, yz, df]], scale(roomCol, 0.8));
  b.quadF(room, 'Y', [[ra, ya, df], [rz, ya, df], [rz, ya, rb], [ra, ya, rb]], scale(roomCol, 0.6));
  b.quadF(room, '-Y', [[ra, yz, df], [rz, yz, df], [rz, yz, rb], [ra, yz, rb]], scale(roomCol, 0.9));
  if (!shop && w.kind !== 'small') {
    curtains(b, w, df - 0.08, U);
  }
  // Glass (a few panes cracked and taped, or boarded with cardboard on neglected buildings).
  const glass: RGBA = [0.2 + 0.05 * U(7), 0.25 + 0.05 * U(7), 0.28, shop ? 0.2 : 0.38];
  const gd = df + 0.035;
  b.quadF('fac_glass', 'N', [[r0 + fw, y0 + fw, gd], [r1 - fw, y0 + fw, gd], [r1 - fw, y1 - fw, gd], [r0 + fw, y1 - fw, gd]], glass);
  if (!shop && w.kind !== 'door' && U(42) < 0.012 + 0.05 * p.wear * p.wear) {
    brokenPane(b, r0 + fw, (r0 + r1) / 2, y0 + fw, y1 - fw, gd + 0.004, U);
  }
  // Frame: outer bars with their inner faces, mullions and transoms (grime collects on the bottom rail).
  const f0 = df;
  const f1 = df + fd;
  const frameWx = (_r: number, y: number): Weather => [y < y0 + fw + 0.01 ? 0.55 : 0.12, 0, 0.3, 0];
  b.box(frameMat, r0, r0 + fw, y0, y1, f0, f1, frameCol, { front: true, right: true }, frameWx);
  b.box(frameMat, r1 - fw, r1, y0, y1, f0, f1, frameCol, { front: true, left: true }, frameWx);
  b.box(frameMat, r0 + fw, r1 - fw, y0, y0 + fw, f0, f1, scale(frameCol, 0.93), { front: true }, frameWx);
  b.box(frameMat, r0 + fw, r1 - fw, y1 - fw, y1, f0, f1, frameCol, { front: true, bottom: true }, frameWx);
  const wid = r1 - r0;
  const mull: number[] = [];
  if (w.kind === 'ribbon' || w.kind === 'shopribbon') {
    const n = Math.max(1, Math.round(wid / 1.3));
    for (let k = 1; k < n; k++) {
      mull.push(r0 + (wid * k) / n);
    }
  } else if (w.kind === 'door') {
    mull.push(U(8) < 0.5 ? r0 + 0.88 : r1 - 0.88);
    if (wid > 2.0) {
      mull.push(U(8) < 0.5 ? (r0 + 0.88 + r1) / 2 : (r0 + r1 - 0.88) / 2);
    }
  } else if (wid > 2.0) {
    mull.push(r0 + wid / 3, r0 + (2 * wid) / 3);
  } else if (wid > 0.8) {
    mull.push((r0 + r1) / 2);
  }
  for (const mx of mull) {
    b.box(frameMat, mx - fw / 2, mx + fw / 2, y0 + fw, y1 - fw, f0, f1, frameCol, { front: true, left: true, right: true }, frameWx);
  }
  const transom = p.typ === 'T2' ? y1 - 0.55 : w.kind === 'window' && wid > 2.0 ? y1 - 0.5 : 0;
  if (transom > y0 + 0.8) {
    b.box(frameMat, r0 + fw, r1 - fw, transom - fw / 2, transom + fw / 2, f0, f1, frameCol, { front: true, top: true, bottom: true }, frameWx);
  }
  if (w.kind === 'door') {
    // Kick panel under the fixed part of a balcony door.
    const dx = mull[0];
    const [k0, k1] = dx - r0 < r1 - dx ? [dx, r1 - fw] : [r0 + fw, dx];
    b.quadF(frameMat, 'N', [[k0, y0 + fw, f1 - 0.01], [k1, y0 + fw, f1 - 0.01], [k1, w.fy + 0.9, f1 - 0.01], [k0, w.fy + 0.9, f1 - 0.01]], scale(frameCol, 0.97));
  }
  // Roller shutter in front of the frame: at every height, and never quite level (one side hangs lower).
  if (w.box > 0 && p.shutters === 'roller' && !shop) {
    const s = U(9);
    const yb = s < 0.45 ? y1 : s < 0.82 ? y1 - (y1 - y0) * (0.12 + 0.72 * U(10)) : y0 + 0.02;
    if (yb < y1 - 0.02) {
      const tilt = (U(43) - 0.5) * 0.09;
      const ybl = Math.max(y0 + 0.02, Math.min(y1 - 0.03, yb + tilt));
      const ybr = Math.max(y0 + 0.02, Math.min(y1 - 0.03, yb - tilt));
      const rc = lin(pick([0xe3e1d9, 0xd8cfb8, 0xc0c2c2, 0xcdbf9c, 0xb9b3a6], U(11)));
      const wxS = (_r: number, y: number): Weather => [0.25 + 0.3 * p.wear, y > y1 - 0.4 ? 0.4 : 0.1, 0, 0];
      b.quadF('fac_roller', 'N', [[r0 + 0.01, ybl, f1 + 0.012], [r1 - 0.01, ybr, f1 + 0.012], [r1 - 0.01, y1, f1 + 0.012], [r0 + 0.01, y1, f1 + 0.012]], rc, undefined, wxS);
      b.poly('fac_pvc', e.f.dir('N'), [e.f.p(r0 + 0.01, ybl - 0.04, f1 + 0.03), e.f.p(r1 - 0.01, ybr - 0.04, f1 + 0.03), e.f.p(r1 - 0.01, ybr, f1 + 0.03), e.f.p(r0 + 0.01, ybl, f1 + 0.03)], scale(rc, 0.88));
    }
  }
  // Sill: marble (T1/T3) or a rendered moulding (T2), both with chamfered arrises and grime on top.
  if (w.kind !== 'door' && w.kind !== 'shopribbon') {
    const wxSill = (_r: number, y: number, d: number): Weather => [y > y0 - 0.005 ? 0.45 + 0.3 * p.wear : 0.15, 0.2, d > dp ? 0.8 : 0.2, 0];
    if (p.typ === 'T2') {
      b.slab('fac_render', r0 - 0.08, r1 + 0.08, y0 - 0.08, y0, df, dp + 0.07, x.p.trim, 0.018, { front: true, top: true, bottom: true, left: true, right: true }, wxSill);
    } else {
      b.box('fac_marble', r0 - 0.04, r1 + 0.04, y0 - 0.035, y0, df, dp + 0.05, scale(lin(0xdcd8cf), 1 - p.wear * 0.2), { front: true, top: true, bottom: true, left: true, right: true }, wxSill);
    }
  }
  // T2 surround: architrave and a cornice cap over the head.
  if (p.typ === 'T2' && w.kind !== 'small') {
    const t = x.p.trim;
    const wxT = (_r: number, y: number, d: number): Weather => [0.2, y > top + 0.2 ? 0.3 : 0.1, d > dp + 0.02 ? 0.6 : 0.1, 0];
    b.box('fac_render', r0 - 0.12, r0, y0, top, dp, dp + 0.03, t, { front: true, left: true }, wxT);
    b.box('fac_render', r1, r1 + 0.12, y0, top, dp, dp + 0.03, t, { front: true, right: true }, wxT);
    b.box('fac_render', r0 - 0.12, r1 + 0.12, top, top + 0.12, dp, dp + 0.03, t, { front: true }, wxT);
    b.slab('fac_render', r0 - 0.2, r1 + 0.2, top + 0.12, top + 0.26, dp, dp + 0.12, scale(t, 0.97), 0.015, { front: true, top: true, bottom: true, left: true, right: true }, wxT);
  }
  // Wooden shutters (T2): folded back against the wall, half open at an angle, or closed in the reveal.
  if (p.shutters === 'wood' && w.kind === 'window') {
    woodShutters(x, e, b, w, dp, U);
  }
  // AC unit on brackets under the window, or on the balcony beside the door; a condensate hose and its streak.
  if ((p.typ === 'T1' || p.typ === 'T3') && w.kind !== 'shopribbon' && w.kind !== 'small' && U(14) < (w.kind === 'ribbon' ? 0.45 : 0.34)) {
    const yaw = Math.atan2(e.f.nx, e.f.nz);
    const rc = w.kind === 'ribbon' ? r0 + (r1 - r0) * (0.2 + 0.6 * U(15)) : w.kind === 'door' ? (mull[0] - r0 < r1 - mull[0] ? r1 - 0.5 : r0 + 0.5) : (r0 + r1) / 2;
    const yb = w.kind === 'door' ? w.fy + 0.03 : y0 - 0.74;
    const dd = w.kind === 'door' ? dp + 0.05 : dp;
    const [px, pz] = e.f.xz(rc, dd);
    c.place('fac_ac', [px, yb, pz], yaw, { variant: 'unit', seed: Math.floor(U(16) * 1000), ref: `${c.tile}/ac` });
    if (w.kind !== 'door') {
      // Hose from the unit down the wall (to the next sill or into the air), dripping: a streak below its end.
      const hr = rc + 0.33;
      const hy = Math.max(w.fy - 0.4 - 1.4 * U(17), x.G1 + 0.3);
      b.quadF('fac_metal', 'N', [[hr - 0.009, hy, dp + 0.02], [hr + 0.009, hy, dp + 0.02], [hr + 0.009, yb + 0.1, dp + 0.02], [hr - 0.009, yb + 0.1, dp + 0.02]], lin(pick([0x2a2a2a, 0xd8d8d2, 0x3a4a5a], U(44))));
      const len = 0.6 + 1.1 * U(18);
      const u0 = U(19) * 0.6;
      b.quadF('fac_leak', 'N', [[hr - 0.16, hy - len, dp + 0.012], [hr + 0.16, hy - len, dp + 0.012], [hr + 0.16, hy + 0.02, dp + 0.012], [hr - 0.16, hy + 0.02, dp + 0.012]], [0.46, 0.4, 0.38, 0.75], [
        [u0, 1],
        [u0 + 0.1, 1],
        [u0 + 0.1, 0],
        [u0, 0],
      ]);
    }
  }
  // Combi-boiler flue beside the kitchen window (one per flat): a short terminal, soot fanning up, drips below.
  if ((p.typ === 'T1' || p.typ === 'T2') && w.kind === 'window' && U(21) < 0.2 && w.floor >= 1) {
    const left = U(22) < 0.5;
    const fr = left ? r0 - 0.32 : r1 + 0.32;
    const fy = y1 - 0.25 - 0.3 * U(23);
    if (fr > 0.2 && fr < e.len - 0.2) {
      flue(b, fr, fy, dp, U);
    }
  }
}

/** Curtains and blinds of many kinds (net, side drapes, roller blind at any height, venetian slats, dark lined). */
function curtains(b: Batch, w: Win, dc: number, U: (q: number) => number): void {
  const { r0, r1, y0, y1 } = w;
  const cu = U(4);
  const net = lin(pick([0xefe9dc, 0xe8e4da, 0xf2ede0, 0xe6dccb], U(5)), 0.85);
  const drape = lin(pick([0xb89c78, 0x8a3a34, 0x44546e, 0xd9cbb0, 0x6e7a5a, 0x7a5c48, 0x9aa2a8], U(5)), 0.85);
  if (cu < 0.3) {
    // Net curtain across, sometimes pulled to one side at the bottom.
    const pull = U(24) < 0.3 ? (r1 - r0) * (0.2 + 0.3 * U(25)) : 0;
    b.quadF('fac_curtain', 'N', [[r0, y0 + 0.02, dc], [r1 - pull, y0 + 0.02, dc], [r1, y1, dc], [r0, y1, dc]], net);
  } else if (cu < 0.48) {
    const cwid = (r1 - r0) * (0.18 + 0.17 * U(6));
    b.quadF('fac_curtain', 'N', [[r0, y0 + 0.05, dc], [r0 + cwid, y0 + 0.05, dc], [r0 + cwid, y1, dc], [r0, y1, dc]], drape);
    b.quadF('fac_curtain', 'N', [[r1 - cwid * (0.7 + 0.6 * U(26)), y0 + 0.05, dc], [r1, y0 + 0.05, dc], [r1, y1, dc], [r1 - cwid * (0.7 + 0.6 * U(26)), y1, dc]], drape);
    if (U(27) < 0.5) {
      b.quadF('fac_curtain', 'N', [[r0 + cwid, y0 + 0.02, dc + 0.01], [r1 - cwid, y0 + 0.02, dc + 0.01], [r1 - cwid, y1, dc + 0.01], [r0 + cwid, y1, dc + 0.01]], net);
    }
  } else if (cu < 0.64) {
    // Roller blind (stor perde) at any height, a little skewed.
    const yb = y1 - (y1 - y0) * (0.15 + 0.8 * U(28));
    const sk = (U(29) - 0.5) * 0.05;
    const bc = lin(pick([0xe8e2d2, 0xd8c8a8, 0xb8b8b0, 0x8c7a66, 0xf0ece4], U(30)), 0.85);
    b.poly('fac_curtain', b.f.dir('N'), [b.f.p(r0 + 0.04, yb + sk, dc + 0.02), b.f.p(r1 - 0.04, yb - sk, dc + 0.02), b.f.p(r1 - 0.04, y1, dc + 0.02), b.f.p(r0 + 0.04, y1, dc + 0.02)], bc);
    b.box('fac_curtain', r0 + 0.03, r1 - 0.03, Math.min(yb + sk, yb - sk) - 0.03, Math.max(yb + sk, yb - sk), dc + 0.02, dc + 0.035, scale(bc, 0.8), { front: true });
  } else if (cu < 0.74) {
    // Venetian blind: slats down to a random height.
    const yb = y1 - (y1 - y0) * (0.3 + 0.65 * U(31));
    const sc = lin(pick([0xe9e7e0, 0xc9c6bd, 0x9a8a70], U(32)), 0.85);
    for (let y = y1 - 0.05; y > yb; y -= 0.2) {
      b.quadF('fac_curtain', 'N', [[r0 + 0.04, y - 0.035, dc + 0.015], [r1 - 0.04, y - 0.035, dc + 0.015], [r1 - 0.04, y, dc + 0.025], [r0 + 0.04, y, dc + 0.025]], sc);
    }
  } else if (cu < 0.8) {
    // Dark lined curtain drawn (bedroom by day).
    b.quadF('fac_curtain', 'N', [[r0, y0 + 0.02, dc], [r1, y0 + 0.02, dc], [r1, y1, dc], [r0, y1, dc]], scale(drape, 0.55));
  } else if (cu < 0.815) {
    // A plain yellow-and-navy flag hung inside the window (no crest).
    flag(b, r0 + 0.08, y1 - 0.05, dc + 0.03, Math.min(0.9, r1 - r0 - 0.16), Math.min(1.1, y1 - y0 - 0.2), U(34) < 0.5);
  } else if (cu < 0.88) {
    // Newspaper or foil taped inside (an empty flat).
    b.quadF('fac_paper', 'N', [[r0 + 0.05, y0 + 0.05, dc + 0.06], [r1 - 0.05, y0 + 0.05, dc + 0.06], [r1 - 0.05, y1 - 0.05, dc + 0.06], [r0 + 0.05, y1 - 0.05, dc + 0.06]], lin(pick([0xd8d2c0, 0xc8c8c4], U(33)), 0.9));
  }
}

/** A cracked pane: tape strips in an X, or a cardboard patch behind the glass. */
function brokenPane(b: Batch, a: number, c2: number, y0: number, y1: number, d: number, U: (q: number) => number): void {
  if (U(45) < 0.6) {
    const tape = lin(0xc9b98a, 0.95);
    const t = 0.024;
    const seg = (ra: number, ya: number, rb: number, yb: number): void => {
      const l = Math.hypot(rb - ra, yb - ya) || 1;
      const nr = (-(yb - ya) / l) * t;
      const ny = ((rb - ra) / l) * t;
      b.quadF('fac_paper', 'N', [[ra - nr, ya - ny, d], [rb - nr, yb - ny, d], [rb + nr, yb + ny, d], [ra + nr, ya + ny, d]], tape);
    };
    seg(a + 0.04, y0 + 0.05, c2 - 0.04, y1 - 0.05);
    seg(a + 0.04, y1 - 0.05, c2 - 0.04, y0 + 0.05);
    // Crack lines radiating from the impact.
    const cx = a + (c2 - a) * (0.3 + 0.4 * U(46));
    const cy = y0 + (y1 - y0) * (0.3 + 0.4 * U(47));
    for (let k = 0; k < 5; k++) {
      const ang = (k / 5) * Math.PI * 2 + U(48 + k);
      const len = 0.12 + 0.25 * U(53 + k);
      const ex = Math.max(a, Math.min(c2, cx + Math.cos(ang) * len));
      const ey = Math.max(y0, Math.min(y1, cy + Math.sin(ang) * len));
      const l = Math.hypot(ex - cx, ey - cy) || 1;
      const nr = (-(ey - cy) / l) * 0.003;
      const ny = ((ex - cx) / l) * 0.003;
      b.quadF('fac_crack', 'N', [[cx - nr, cy - ny, d - 0.001], [ex - nr, ey - ny, d - 0.001], [ex + nr, ey + ny, d - 0.001], [cx + nr, cy + ny, d - 0.001]], lin(0xe8eef0));
    }
  } else {
    b.quadF('fac_paper', 'N', [[a + 0.02, y0 + 0.02, d - 0.03], [c2 - 0.02, y0 + 0.02, d - 0.03], [c2 - 0.02, y1 - 0.02, d - 0.03], [a + 0.02, y1 - 0.02, d - 0.03]], lin(0x9a7b55));
  }
}

/** Wooden shutters of a T2 window: folded back against the wall, swung half open at an angle, or closed. */
function woodShutters(x: Ctx2, e: Edge, b: Batch, w: Win, dp: number, U: (q: number) => number): void {
  const { r0, r1, y0, y1 } = w;
  const s = U(12);
  const tint: RGBA = U(13) < 0.6 ? [1, 1, 1, 1] : [0.95, 0.72, 0.55, 1];
  const wx: Weather = [0.3 * x.p.wear, 0.3, 0.6, 0];
  const lw = (r1 - r0) / 2;
  if (s < 0.42) {
    b.box('fac_shutter_wood', r0 - 0.14 - lw, r0 - 0.14, y0, y1, dp + 0.03, dp + 0.07, tint, { front: true, left: true, right: true, top: true }, wx);
    b.box('fac_shutter_wood', r1 + 0.14, r1 + 0.14 + lw, y0, y1, dp + 0.03, dp + 0.07, tint, { front: true, left: true, right: true, top: true }, wx);
  } else if (s < 0.72) {
    // Half open: each leaf hinged at the reveal edge, swung out by 35-80 degrees (one sagging a little).
    for (const side of [-1, 1]) {
      const hr = side < 0 ? r0 - 0.02 : r1 + 0.02;
      const ang = ((35 + 45 * U(60 + side)) * Math.PI) / 180;
      const tipR = hr + side * Math.cos(ang) * lw;
      const tipD = dp + 0.02 + Math.sin(ang) * lw;
      const sag = 0.02 * U(62 + side);
      const n = e.f.vec(side * Math.sin(ang), 0, -Math.cos(ang));
      const pts = [e.f.p(hr, y0, dp + 0.02), e.f.p(tipR, y0 - sag, tipD), e.f.p(tipR, y1 - sag, tipD), e.f.p(hr, y1, dp + 0.02)];
      b.poly('fac_shutter_wood', n, pts, tint, undefined, wx);
      b.poly('fac_shutter_wood', [-n[0], -n[1], -n[2]], pts, scale(tint, 0.85), undefined, wx);
    }
  } else if (s < 0.9) {
    b.quadF('fac_shutter_wood', 'N', [[r0, y0, dp - 0.06], [r1, y0, dp - 0.06], [r1, y1, dp - 0.06], [r0, y1, dp - 0.06]], tint, undefined, wx);
  }
}

/** A boiler flue terminal (Ø 8-10 cm, 25-40 cm out) with a soot fan above it and a drip stain below. */
function flue(b: Batch, r: number, y: number, dp: number, U: (q: number) => number): void {
  const out = 0.25 + 0.15 * U(70);
  const hw = 0.045;
  const col = lin(pick([0xe8e6e0, 0xd0d0cc, 0xb8bab8], U(71)));
  b.box('fac_metal', r - hw, r + hw, y - hw, y + hw, dp, dp + out, col, { front: true, left: true, right: true, bottom: true });
  // Soot: the streak image upside down (dense at the flue, fading upward) in near-black.
  const h = 0.7 + 0.6 * U(72);
  const wS = 0.35 + 0.2 * U(73);
  const u0 = 0.2 + 0.4 * U(74);
  b.quadF('fac_leak', 'N', [[r - wS / 2, y - 0.02, dp + 0.013], [r + wS / 2, y - 0.02, dp + 0.013], [r + wS / 2, y + h, dp + 0.013], [r - wS / 2, y + h, dp + 0.013]], [0.05, 0.045, 0.04, 0.9], [
    [u0, 0],
    [u0 + 0.22, 0],
    [u0 + 0.22, 1],
    [u0, 1],
  ]);
  // Drips below.
  b.quadF('fac_leak', 'N', [[r - 0.12, y - 0.55 - 0.4 * U(75), dp + 0.012], [r + 0.12, y - 0.55 - 0.4 * U(75), dp + 0.012], [r + 0.12, y - hw, dp + 0.012], [r - 0.12, y - hw, dp + 0.012]], [0.45, 0.4, 0.36, 0.6], [
    [0.3, 1],
    [0.4, 1],
    [0.4, 0],
    [0.3, 0],
  ]);
}

/* ------------------------------------------------------------------------------------------------------------- */
/* Balconies                                                                                                       */
/* ------------------------------------------------------------------------------------------------------------- */

function emitBalconies(x: Ctx2, e: Edge, b: Batch, wins: readonly Win[], ck: Cikma | null): Balcony[] {
  const out: Balcony[] = [];
  const { p } = x;
  const P = x.balconyP;
  // Continuous balconies (T3 'all'): one per floor across the span of that floor's ribbon.
  const runs: { r0: number; r1: number; fy: number; k: number }[] = [];
  if (p.typ === 'T3') {
    for (const w of wins) {
      if (w.kind === 'ribbon' && e.kind === 'street' && (p.balcony === 'all' || w.floor % 2 === 0)) {
        runs.push({ r0: w.r0 - 0.1, r1: w.r1 + 0.1, fy: w.fy, k: w.floor });
      }
    }
  } else {
    const doors = wins.filter((w) => w.kind === 'door').sort((a, c) => a.floor - c.floor || a.r0 - c.r0);
    for (const w of doors) {
      const last = runs.at(-1);
      const r0 = w.r0 - 0.45;
      const r1 = w.r1 + 0.45;
      if (last && last.k === w.floor && r0 - last.r1 < 0.8 && p.typ === 'T1') {
        last.r1 = r1;
      } else {
        runs.push({ r0, r1, fy: w.fy, k: w.floor });
      }
    }
  }
  for (const run of runs) {
    let r0 = Math.max(0.12, run.r0);
    let r1 = Math.min(e.len - 0.12, run.r1);
    if (ck && r1 > ck.c0 - 0.05 && r0 < ck.c1 + 0.05) {
      if ((r0 + r1) / 2 < (ck.c0 + ck.c1) / 2) {
        r1 = Math.min(r1, ck.c0 - 0.05);
      } else {
        r0 = Math.max(r0, ck.c1 + 0.05);
      }
    }
    if (r1 - r0 < 0.8) {
      continue;
    }
    const y0 = run.fy - 0.14;
    const y1 = run.fy + 0.04;
    const U = (q: number): number => h01(p.seed + run.k * 7.1 + r0, q);
    const edgeCol = p.typ === 'T3' ? lin(0xe8e8e4) : p.trim;
    const wxTop = (_r: number, _y: number, d: number): Weather => [0.35 + 0.3 * p.wear, 0, 0, d < 0.2 ? 0.5 : 0.15];
    b.box('fac_concrete', r0, r1, y1 - 0.001, y1, 0, P, lin(0xbdb7ad), { top: true }, wxTop);
    // Slab edge: chamfered arrises, chipped, streaked below the drip line.
    b.slab('fac_render', r0, r1, y0, y1, 0, P, edgeCol, 0.02, { front: true, left: true, right: true }, (_r, y, d) => [0.25, y < y0 + 0.03 ? 0.5 : 0.1, d > P - 0.03 ? 0.9 : 0.3, 0]);
    // Soffit: grime towards the wall (AO), run-off stains along the front.
    b.quadF('fac_render', '-Y', [[r0, y0, 0], [r1, y0, 0], [r1, y0, P - 0.02], [r0, y0, P - 0.02]], [scale(edgeCol, 0.55), scale(edgeCol, 0.55), scale(edgeCol, 0.82), scale(edgeCol, 0.82)], undefined, (_r, _y, d) => [d < 0.1 ? 0.75 : 0.35, d > P - 0.2 ? 0.5 : 0, 0, 0]);
    const h = 1.0;
    const top = y1 + h;
    switch (p.railing) {
      case 'solid':
      case 'glazed': {
        const acc = p.accent;
        const t = 0.1;
        const mat = U(1) < 0.6 ? 'fac_render_rough' : 'fac_render';
        const ph = p.railing === 'glazed' ? 0.9 : h;
        b.box(mat, r0, r1, y1, y1 + ph, P - t, P, acc, { front: true, back: true, top: true });
        b.box(mat, r0, r0 + t, y1, y1 + ph, 0, P - t, acc, { left: true, right: true, top: true });
        b.box(mat, r1 - t, r1, y1, y1 + ph, 0, P - t, acc, { left: true, right: true, top: true });
        b.box('fac_render', r0 - 0.01, r1 + 0.01, y1 + ph - 0.06, y1 + ph + 0.01, P - t - 0.01, P + 0.02, x.p.trim, { front: true, top: true });
        if (p.railing === 'glazed') {
          const gTop = x.floorY(run.k + 1) - 0.16;
          const fc = lin(0xf0f0ec);
          const n = Math.max(1, Math.round((r1 - r0) / 0.9));
          for (let k = 0; k <= n; k++) {
            const rr = r0 + ((r1 - r0) * k) / n;
            b.box('fac_pvc', Math.max(r0, rr - 0.03), Math.min(r1, rr + 0.03), y1 + ph, gTop, P - 0.07, P - 0.01, fc, { front: true, left: true, right: true });
          }
          b.box('fac_pvc', r0, r1, gTop - 0.06, gTop, P - 0.07, P - 0.01, fc, { front: true, bottom: true });
          b.quadF('fac_glass', 'N', [[r0, y1 + ph, P - 0.04], [r1, y1 + ph, P - 0.04], [r1, gTop, P - 0.04], [r0, gTop, P - 0.04]], [0.22, 0.27, 0.3, 0.4]);
          b.quadF('fac_glass', '-R', [[r0 + 0.01, y1 + ph, 0], [r0 + 0.01, y1 + ph, P - 0.05], [r0 + 0.01, gTop, P - 0.05], [r0 + 0.01, gTop, 0]], [0.22, 0.27, 0.3, 0.4]);
          b.quadF('fac_glass', 'R', [[r1 - 0.01, y1 + ph, 0], [r1 - 0.01, y1 + ph, P - 0.05], [r1 - 0.01, gTop, P - 0.05], [r1 - 0.01, gTop, 0]], [0.22, 0.27, 0.3, 0.4]);
          // The ceiling of the enclosure (the next slab's soffit covers it on upper floors; the top floor needs one).
          b.quadF('fac_render', '-Y', [[r0, gTop + 0.01, 0], [r1, gTop + 0.01, 0], [r1, gTop + 0.01, P], [r0, gTop + 0.01, P]], scale(x.p.trim, 0.7));
          b.box('fac_render', r0, r1, gTop, gTop + 0.16, 0, P, x.p.trim, { front: true, top: true, left: true, right: true });
        }
        break;
      }
      case 'glass': {
        const gc: RGBA = [0.55, 0.66, 0.66, 0.28];
        b.quadF('fac_glass', 'N', [[r0 + 0.03, y1 + 0.05, P - 0.04], [r1 - 0.03, y1 + 0.05, P - 0.04], [r1 - 0.03, top - 0.05, P - 0.04], [r0 + 0.03, top - 0.05, P - 0.04]], gc);
        b.quadF('fac_glass', '-R', [[r0 + 0.03, y1 + 0.05, 0], [r0 + 0.03, y1 + 0.05, P - 0.05], [r0 + 0.03, top - 0.05, P - 0.05], [r0 + 0.03, top - 0.05, 0]], gc);
        b.quadF('fac_glass', 'R', [[r1 - 0.03, y1 + 0.05, 0], [r1 - 0.03, y1 + 0.05, P - 0.05], [r1 - 0.03, top - 0.05, P - 0.05], [r1 - 0.03, top - 0.05, 0]], gc);
        const al = lin(0xc8cacc);
        b.box('fac_alu', r0, r1, top - 0.05, top, P - 0.06, P - 0.01, al, { front: true, top: true, bottom: true, back: true });
        b.box('fac_alu', r0, r0 + 0.05, top - 0.05, top, 0, P - 0.06, al, { left: true, right: true, top: true, bottom: true });
        b.box('fac_alu', r1 - 0.05, r1, top - 0.05, top, 0, P - 0.06, al, { left: true, right: true, top: true, bottom: true });
        break;
      }
      default:
        railing(x, b, r0, r1, y1, top, P, U);
    }
    if (p.typ === 'T2') {
      for (const rr of [r0 + 0.15, (r0 + r1) / 2, r1 - 0.15]) {
        b.box('fac_render', rr - 0.07, rr + 0.07, y0 - 0.32, y0, 0, P - 0.12, x.p.trim, { front: true, left: true, right: true, bottom: true });
      }
    }
    b.flush();
    out.push({ r0, r1, y1, top: p.railing === 'glazed' ? y1 + 0.9 : top, P, k: run.k, open: p.railing !== 'glazed', ceiling: x.floorY(run.k + 1) - 0.16 });
  }
  return out;
}

/** A balcony as emitted: slab top y1, parapet / railing top, depth P, floor k; open = not glazed in. */
export interface Balcony {
  r0: number;
  r1: number;
  y1: number;
  top: number;
  P: number;
  k: number;
  open: boolean;
  /** Underside of the slab above (or the top-floor enclosure). */
  ceiling: number;
}

/** Steel railings: flat-bar, square-bar, wrought iron or galvanised pipe, on the front and both ends. */
function railing(x: Ctx2, b: Batch, r0: number, r1: number, y1: number, top: number, P: number, U: (q: number) => number): void {
  const { p } = x;
  const col = p.railColor;
  const m = 'fac_metal';
  const allF = { front: true, left: true, right: true };
  // Rust (the dirt channel of fac_metal's flat rust layer): worst at the foot of the bars and on the bottom rail,
  // patchy along the run; galvanised pipe barely rusts.
  const rustK = p.railing === 'pipe' ? 0.12 : Math.min(1, Math.max(0.08, p.wear * 1.25 - 0.15 + 0.3 * (U(3) - 0.5)));
  const rust = (r: number, y: number): Weather => [rustK * (0.3 + 0.7 * Math.max(0, 1 - (y - y1) / 0.55)) * (0.35 + 1.1 * fbm(r, y, 0.6, p.seed + 91)), 0, 0, 0];
  const rail = (ra: number, rb: number, ya: number, yb: number, da: number, db: number): void => b.box(m, ra, rb, ya, yb, da, db, col, { front: true, back: true, top: true, bottom: true, left: true, right: true }, rust);
  // Top rails on the front and the ends, posts at the corners.
  rail(r0, r1, top - 0.045, top, P - 0.05, P);
  rail(r0, r0 + 0.045, top - 0.045, top, 0, P - 0.05);
  rail(r1 - 0.045, r1, top - 0.045, top, 0, P - 0.05);
  b.box(m, r0, r0 + 0.045, y1, top, P - 0.05, P, col, allF, rust);
  b.box(m, r1 - 0.045, r1, y1, top, P - 0.05, P, col, allF, rust);
  if (p.railing === 'pipe') {
    for (const yy of [y1 + 0.35, y1 + 0.68]) {
      rail(r0, r1, yy - 0.02, yy + 0.02, P - 0.04, P - 0.01);
      rail(r0, r0 + 0.04, yy - 0.02, yy + 0.02, 0, P - 0.05);
      rail(r1 - 0.04, r1, yy - 0.02, yy + 0.02, 0, P - 0.05);
    }
    const n = Math.max(1, Math.round((r1 - r0) / 1.2));
    for (let k = 1; k < n; k++) {
      const rr = r0 + ((r1 - r0) * k) / n;
      b.box(m, rr - 0.02, rr + 0.02, y1, top, P - 0.045, P - 0.005, col, allF, rust);
    }
    return;
  }
  rail(r0, r1, y1 + 0.08, y1 + 0.12, P - 0.045, P - 0.005);
  if (p.railing === 'iron') {
    rail(r0, r1, y1 + 0.3, y1 + 0.33, P - 0.04, P - 0.01);
  }
  const step = p.railing === 'iron' ? 0.11 : p.railing === 'flatbar' ? 0.14 : 0.12;
  const [bw, bd] = p.railing === 'flatbar' ? [0.012, 0.045] : [0.02, 0.02];
  const bars = (a: number, bb: number, along: 'r' | 'd'): void => {
    const n = Math.max(1, Math.round((bb - a) / step));
    for (let k = 1; k < n; k++) {
      const v = a + ((bb - a) * k) / n;
      if (along === 'r') {
        b.box(m, v - bw / 2, v + bw / 2, y1 + 0.12, top - 0.045, P - 0.025 - bd / 2, P - 0.025 + bd / 2, col, { front: true, left: bw > 0.015, right: true }, rust);
      } else {
        b.box(m, r0 + 0.0225 - bd / 2, r0 + 0.0225 + bd / 2, y1 + 0.12, top - 0.045, v - bw / 2, v + bw / 2, col, { left: true, front: true }, rust);
        b.box(m, r1 - 0.0225 - bd / 2, r1 - 0.0225 + bd / 2, y1 + 0.12, top - 0.045, v - bw / 2, v + bw / 2, col, { right: true, front: true }, rust);
      }
    }
  };
  bars(r0, r1, 'r');
  bars(0, P - 0.05, 'd');
}

/* ------------------------------------------------------------------------------------------------------------- */
/* Çıkma                                                                                                           */
/* ------------------------------------------------------------------------------------------------------------- */

export interface Cikma {
  c0: number;
  c1: number;
  D: number;
  y0: number;
}

function cikmaSpan(x: Ctx2, e: Edge): Cikma | null {
  const { p } = x;
  if (p.cikma === 'none' || e.kind !== 'street' || e.len < (p.cikma === 'bay' ? 3.2 : 4.5) || p.storeys < 3) {
    return null;
  }
  const D = p.cikmaDepth;
  const ml = e.convexL ? 0.35 : D + 0.4;
  const mr = e.convexR ? 0.35 : D + 0.4;
  let c0: number;
  let c1: number;
  if (p.cikma === 'full') {
    c0 = ml;
    c1 = e.len - mr;
  } else if (p.cikma === 'middle') {
    const w = Math.max(2.6, e.len * 0.65);
    c0 = Math.max(ml, (e.len - w) / 2);
    c1 = Math.min(e.len - mr, (e.len + w) / 2);
  } else {
    c0 = Math.max(ml, e.len / 2 - 1.2);
    c1 = Math.min(e.len - mr, e.len / 2 + 1.2);
  }
  if (c1 - c0 < 2.2) {
    return null;
  }
  // Keep clear of the building across the lane.
  for (const r of [c0 + 0.2, (c0 + c1) / 2, c1 - 0.2]) {
    if (clearAhead(x, e, r) < D + 1.8) {
      return null;
    }
  }
  return { c0, c1, D, y0: x.floorY(1) - 0.12 };
}

function emitCikma(x: Ctx2, e: Edge, b: Batch, ck: Cikma): void {
  const { p } = x;
  const { c0, c1, D, y0 } = ck;
  const top = x.wallTop;
  const rough = p.typ === 'T1' && h01(p.seed, 51) < 0.55;
  const mat = rough ? 'fac_render_rough' : p.typ === 'T3' ? 'fac_panel' : 'fac_render';
  const col = p.typ === 'T3' ? p.wall : p.accent;
  const wins = layoutWindows(x, e, c0 + 0.1, c1 - 0.1, D, false);
  const holes: Rect[] = wins.map((w) => ({ r0: w.r0, r1: w.r1, y0: w.y0, y1: w.y1 + w.box }));
  const wi: WallInfo = { ...wallInfo(x, e, ck, D), convexL: true, convexR: true, len: c1 };
  const variant = mat === 'fac_panel' ? mat : `${mat}@weathered`;
  wallGrid(
    b,
    D,
    { r0: c0, r1: c1, y0, y1: top },
    holes,
    [],
    [top - 0.8, p.roofY, top - 0.25],
    (_r, y) => (y > p.roofY && p.wear > 0.55 && p.roof === 'flat' ? 'fac_peeling' : wallVariant(x, e, mat) === mat ? mat : variant),
    (r, y, m) => {
      const w = wallWeather(wi, r, y);
      // The çıkma's own corners are convex arrises: edge wear there (the runtime's curvature term keeps it on the arris).
      const ends = Math.min(r - c0, c1 - r) < 0.01 ? 0.9 : 0;
      return { color: RENDERED.test(m) ? paintAt(wi, col, r, y) : shade(x, col, y, y0 - 10), weather: [w[0], w[1], Math.max(w[2], ends), 0], ...(RENDERED.test(m) ? { tilt: wavyTilt(wi, r, y) } : {}) };
    },
    'N',
    () => 0,
    WALL_GAPS,
  );
  // Sides and the soffit (darker towards the wall).
  b.quadF(mat, '-R', [[c0, y0, 0], [c0, y0, D], [c0, top, D], [c0, top, 0]], [scale(col, 0.85), col, col, scale(col, 0.85)]);
  b.quadF(mat, 'R', [[c1, y0, 0], [c1, y0, D], [c1, top, D], [c1, top, 0]], [scale(col, 0.85), col, col, scale(col, 0.85)]);
  const so = p.trim;
  b.quadF('fac_render', '-Y', [[c0, y0, 0], [c1, y0, 0], [c1, y0, D], [c0, y0, D]], [scale(so, 0.5), scale(so, 0.5), scale(so, 0.85), scale(so, 0.85)], undefined, (_r, _y, d) => [d < 0.15 ? 0.85 : 0.4, 0, 0, 0]);
  // Slab edge band at the base of the çıkma (chamfered, chipped).
  b.slab('fac_render', c0 - 0.02, c1 + 0.02, y0, y0 + 0.2, D, D + 0.03, p.trim, 0.012, { front: true, top: true, bottom: true, left: true, right: true }, (_r, y) => [0.3, y < y0 + 0.05 ? 0.6 : 0.2, 0.8, 0]);
  if (p.cikma === 'bay') {
    for (const rr of [c0 + 0.25, c1 - 0.25]) {
      b.box('fac_render', rr - 0.1, rr + 0.1, y0 - 0.45, y0, 0, D - 0.1, p.trim, { front: true, left: true, right: true, bottom: true });
    }
  }
  b.flush();
  for (const w of wins) {
    emitWindow(x, e, b, w, D, col);
    b.flush();
  }
}

/* ------------------------------------------------------------------------------------------------------------- */
/* Trims, parapets, roof                                                                                           */
/* ------------------------------------------------------------------------------------------------------------- */

/** Wall spans at d = 0 outside the çıkma (for trims running along the wall). */
function outside(e: Edge, ck: Cikma | null): [number, number][] {
  return ck ? [[0, ck.c0], [ck.c1, e.len]].filter(([a, c]) => c - a > 0.05) as [number, number][] : [[0, e.len]];
}

function trims(x: Ctx2, e: Edge, b: Batch, ck: Cikma | null): void {
  const { p } = x;
  const t = p.trim;
  // String courses / slab bands at the floor lines.
  if (x.bands) {
    for (let k = 1; k < p.storeys; k++) {
      const fy = x.floorY(k);
      const [h, pr] = p.typ === 'T2' ? [0.16, 0.05] : [0.16, 0.025];
      for (const [a, c] of outside(e, ck && k >= 1 ? ck : null)) {
        b.slab('fac_render', a, c, fy + 0.02 - h, fy + 0.02, 0, pr, t, 0.01, { front: true, top: true, bottom: true }, (_r, y) => [y > fy ? 0.5 : 0.2, 0.3, 0.8, 0]);
      }
    }
  }
  if (p.typ === 'T2' || p.roof === 'hipped') {
    // Cornice with brackets under the roof line.
    const y = p.roofY;
    const spans = outside(e, ck);
    const cornice = (d0: number): void => {
      for (const [a, c] of spans) {
        b.box('fac_render', a, c, y - 0.55, y - 0.25, d0, d0 + 0.05, t, { front: true, bottom: true });
        b.box('fac_render', a, c, y - 0.25, y - 0.06, d0, d0 + 0.3, t, { front: true, bottom: true, left: true, right: true });
        b.slab('fac_render', a, c, y - 0.06, y + 0.04, d0, d0 + 0.38, scale(t, 0.95), 0.02, { front: true, bottom: true, top: true, left: true, right: true }, (_r, yy, d) => [yy > y ? 0.7 : 0.35, 0.5, d > d0 + 0.3 ? 0.8 : 0.2, 0]);
        for (let r = a + 0.35; r < c - 0.2; r += 0.75) {
          b.box('fac_render', r - 0.05, r + 0.05, y - 0.5, y - 0.25, d0, d0 + 0.26, scale(t, 0.93), { front: true, left: true, right: true, bottom: true });
        }
      }
    };
    if (e.kind !== 'party' && e.kind !== 'short') {
      cornice(0);
    }
  } else if (x.eave > 0 && e.kind !== 'party' && e.kind !== 'short') {
    const y = p.roofY;
    for (const [a, c] of outside(e, ck)) {
      b.slab('fac_render', a - 0.02, c + 0.02, y - 0.18, y + 0.02, 0, x.eave, t, 0.02, { front: true, top: true, bottom: true, left: true, right: true }, (_r, yy, d) => [yy > y - 0.01 ? 0.8 : d < 0.1 ? 0.7 : 0.3, 0.4, d > x.eave - 0.03 ? 0.85 : 0.1, 0]);
    }
    if (ck) {
      b.box('fac_render', ck.c0 - 0.02, ck.c1 + 0.02, y - 0.18, y + 0.02, ck.D, ck.D + x.eave, t, { front: true, top: true, bottom: true, left: true, right: true });
    }
  }
}

/** Parapet inner faces and copings of flat roofs, on the wall and on the çıkma front. */
function parapetPieces(x: Ctx2, e: Edge, b: Batch, ck: Cikma | null): void {
  const { p } = x;
  if (p.roof !== 'flat' || p.parapet < 0.1) {
    return;
  }
  const y0 = p.roofY;
  const y1 = x.wallTop;
  const inner = scale(p.wall, 0.78);
  const cope = lin(0xc9c5bd, 1 - p.wear * 0.2);
  const piece = (a: number, c: number, d: number): void => {
    b.quadF('fac_render', '-N', [[a, y0, d - 0.2], [c, y0, d - 0.2], [c, y1, d - 0.2], [a, y1, d - 0.2]], inner);
    b.slab('fac_concrete', a, c, y1, y1 + 0.05, d - 0.23, d + 0.04, cope, 0.012, { front: true, back: true, top: true }, (_r, yy, dd) => [yy > y1 + 0.04 ? 0.6 : 0.3, 0.3, dd > d ? 0.8 : 0.2, 0]);
  };
  for (const [a, c] of outside(e, ck)) {
    piece(a, c, 0);
  }
  if (ck) {
    piece(ck.c0, ck.c1, ck.D);
    b.box('fac_concrete', ck.c0 - 0.02, ck.c0 + 0.2, y1, y1 + 0.05, 0, ck.D, cope, { left: true, right: true, top: true });
    b.box('fac_concrete', ck.c1 - 0.2, ck.c1 + 0.02, y1, y1 + 0.05, 0, ck.D, cope, { left: true, right: true, top: true });
    b.quadF('fac_roof_flat', 'Y', [[ck.c0, y0, 0], [ck.c1, y0, 0], [ck.c1, y0, ck.D], [ck.c0, y0, ck.D]], lin(0x57524d));
  }
}

function pairs(r: readonly number[]): THREE.Vector2[] {
  const out: THREE.Vector2[] = [];
  for (let k = 0; k < r.length; k += 2) {
    out.push(new THREE.Vector2(r[k], r[k + 1]));
  }
  return out;
}

function emitRoof(x: Ctx2, edges: readonly Edge[]): void {
  const { s, p, c } = x;
  if (p.roof === 'hipped' && hippedRoof(x, edges)) {
    return;
  }
  const contour = pairs(s.ring);
  const holes = s.holes.map(pairs);
  const tris = THREE.ShapeUtils.triangulateShape(contour, holes).flat();
  const flat = [...contour, ...holes.flat()];
  c.mesh.flatTriangles(
    'fac_roof_flat',
    flat.map((v) => [v.x, p.roofY, v.y] as Vec3),
    tris,
    [0, 1, 0],
    { color: lin(0x57524d, 0.9 + 0.2 * x.H(20)) },
  );
  rooftop(x);
}

/** Water tanks, aerials and satellite dishes on a flat roof (instances). */
function rooftop(x: Ctx2): void {
  const { s, p, c } = x;
  const ring = s.ring;
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (let k = 0; k < ring.length; k += 2) {
    minX = Math.min(minX, ring[k]);
    maxX = Math.max(maxX, ring[k]);
    minZ = Math.min(minZ, ring[k + 1]);
    maxZ = Math.max(maxZ, ring[k + 1]);
  }
  const edgeDist = (px: number, pz: number): number => {
    let d = Infinity;
    const n = ring.length / 2;
    for (let i = 0; i < n; i++) {
      const ax = ring[i * 2];
      const az = ring[i * 2 + 1];
      const bx = ring[((i + 1) % n) * 2];
      const bz = ring[((i + 1) % n) * 2 + 1];
      const l2 = (bx - ax) ** 2 + (bz - az) ** 2 || 1e-9;
      const t = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (pz - az) * (bz - az)) / l2));
      d = Math.min(d, Math.hypot(ax + (bx - ax) * t - px, az + (bz - az) * t - pz));
    }
    return d;
  };
  const cand: [number, number, number][] = [];
  for (let px = minX + 0.6; px < maxX; px += 1.3) {
    for (let pz = minZ + 0.6; pz < maxZ; pz += 1.3) {
      if (pointInRing(ring, px, pz) && !s.holes.some((h) => pointInRing(h, px, pz))) {
        cand.push([px, pz, edgeDist(px, pz)]);
      }
    }
  }
  if (!cand.length) {
    return;
  }
  const inner = cand.filter((q) => q[2] > 1.1);
  const rim = cand.filter((q) => q[2] > 0.35 && q[2] < 1.0);
  const used: [number, number][] = [];
  const take = (list: [number, number, number][], salt: number, gap: number): [number, number] | null => {
    for (let k = 0; k < 6; k++) {
      const q = list[Math.floor(x.H(salt + k) * list.length)];
      if (q && used.every(([ux, uz]) => Math.hypot(ux - q[0], uz - q[1]) > gap)) {
        used.push([q[0], q[1]]);
        return [q[0], q[1]];
      }
    }
    return null;
  };
  const area = cand.length * 1.69;
  const nTank = area < 30 ? 1 : area < 120 ? 1 + Math.floor(x.H(30) * 2) : 2 + Math.floor(x.H(30) * 2);
  for (let k = 0; k < nTank; k++) {
    const q = take(inner.length ? inner : cand, 40 + k * 7, 1.6);
    if (q) {
      c.place('fac_tank', [q[0], p.roofY, q[1]], x.H(60 + k) * Math.PI * 2, { variant: pick(['steel', 'white', 'blue', 'yellow', 'white', 'steel'], x.H(70 + k)), ref: `${c.tile}/roof:${s.rec.id}` });
    }
  }
  if (x.H(80) < 0.6) {
    const q = take(inner.length ? inner : cand, 81, 1.2);
    if (q) {
      c.place('fac_aerial', [q[0], p.roofY, q[1]], x.H(82) * Math.PI * 2, { variant: 'aerial', ref: `${c.tile}/roof:${s.rec.id}` });
    }
  }
  // Dishes face the Türksat arc (azimuth ~163°).
  const yaw = Math.atan2(Math.sin((163 * Math.PI) / 180), -Math.cos((163 * Math.PI) / 180));
  const nDish = Math.floor(x.H(90) * 2.4);
  for (let k = 0; k < nDish; k++) {
    const q = take(rim.length ? rim : cand, 91 + k * 5, 0.9);
    if (q) {
      c.place('fac_dish', [q[0], p.roofY, q[1]], yaw + (x.H(95 + k) - 0.5) * 0.3, { variant: 'dish', ref: `${c.tile}/roof:${s.rec.id}` });
    }
  }
}

/**
 * Hipped roof over a convex-ish footprint: every edge's plane rises inward at the plan's pitch from the eave line;
 * the roof is their lower envelope (each face = the footprint grown by the overhang, clipped where its plane is the
 * lowest). Returns false (flat roof instead) for footprints that are not convex enough.
 */
function hippedRoof(x: Ctx2, edges: readonly Edge[]): boolean {
  const { s, p, c } = x;
  const ring = s.ring;
  const n = ring.length / 2;
  const pts = pairs(ring);
  const hull = THREE.ShapeUtils.area(convexHull(pts));
  const area = THREE.ShapeUtils.area(pts);
  if (Math.abs(area) / Math.abs(hull) < 0.9 || n > 14) {
    return false;
  }
  const OV = 0.45;
  const eave = p.roofY;
  const planes = edges.map((e) => ({ ax: ring[e.i * 2], az: ring[e.i * 2 + 1], nx: e.f.nx, nz: e.f.nz }));
  // Distance inward from edge k's line.
  const din = (k: number, px: number, pz: number): number => -((px - planes[k].ax) * planes[k].nx + (pz - planes[k].az) * planes[k].nz);
  // Footprint grown by the overhang: offset lines intersected (convex polygon).
  const grown: Vec2[] = [];
  for (let k = 0; k < n; k++) {
    const a = planes[(k - 1 + n) % n];
    const bb = planes[k];
    const p1: Vec2 = [a.ax + a.nx * OV, a.az + a.nz * OV];
    const d1: Vec2 = [-a.nz, a.nx];
    const p2: Vec2 = [bb.ax + bb.nx * OV, bb.az + bb.nz * OV];
    const d2: Vec2 = [-bb.nz, bb.nx];
    const den = d1[0] * d2[1] - d1[1] * d2[0];
    if (Math.abs(den) < 1e-6) {
      grown.push(p2);
      continue;
    }
    const t = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / den;
    grown.push([p1[0] + d1[0] * t, p1[1] + d1[1] * t]);
  }
  const roofCol = scale(lin(0xffffff), 0.85 + 0.15 * x.H(21));
  let ridge = 0;
  for (let k = 0; k < n; k++) {
    let poly: Vec2[] = grown.slice();
    for (let j = 0; j < n && poly.length >= 3; j++) {
      if (j !== k) {
        poly = clipHalf(poly, (px, pz) => din(k, px, pz) - din(j, px, pz));
      }
    }
    if (poly.length < 3) {
      continue;
    }
    const pl = planes[k];
    const nrm: Vec3 = (() => {
      const v: Vec3 = [pl.nx * p.pitch, 1, pl.nz * p.pitch];
      const l = Math.hypot(v[0], v[1], v[2]);
      return [v[0] / l, v[1] / l, v[2] / l];
    })();
    const P3 = poly.map(([px, pz]) => {
      const y = eave + p.pitch * din(k, px, pz);
      ridge = Math.max(ridge, y - eave);
      return [px, y, pz] as Vec3;
    });
    c.mesh.flatPolygon('fac_roof_tiles', P3, nrm, { color: roofCol });
    // Eave soffit and fascia along this edge.
    const e = edges[k];
    const yo = eave - p.pitch * OV;
    const b = new Batch(c.mesh, e.f);
    b.quadF('fac_render', '-Y', [[0, eave, 0], [e.len, eave, 0], [e.len, yo, OV], [0, yo, OV]], [scale(p.trim, 0.55), scale(p.trim, 0.55), scale(p.trim, 0.85), scale(p.trim, 0.85)]);
    b.quadF('fac_timber', 'N', [[-OV, yo - 0.16, OV], [e.len + OV, yo - 0.16, OV], [e.len + OV, yo, OV], [-OV, yo, OV]], lin(0x5b4636));
    b.flush();
  }
  void ridge;
  return true;
}

function convexHull(pts: readonly THREE.Vector2[]): THREE.Vector2[] {
  const s = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: THREE.Vector2, a: THREE.Vector2, b: THREE.Vector2): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: THREE.Vector2[] = [];
  for (const q of s) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) {
      lower.pop();
    }
    lower.push(q);
  }
  const upper: THREE.Vector2[] = [];
  for (const q of [...s].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) {
      upper.pop();
    }
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Sutherland–Hodgman clip of a polygon by f(x, z) <= 0. */
function clipHalf(poly: Vec2[], fn: (x: number, z: number) => number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const fa = fn(a[0], a[1]);
    const fb = fn(b[0], b[1]);
    if (fa <= 0) {
      out.push(a);
    }
    if ((fa < 0 && fb > 0) || (fa > 0 && fb < 0)) {
      const t = fa / (fa - fb);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

/** Hole rings (light wells, courtyards): plain walls and a roof sheet over the well. */
function plainRing(x: Ctx2, ring: readonly number[]): void {
  const n = ring.length / 2;
  for (let i = 0; i < n; i++) {
    const f = Frame.ofEdge(ring[i * 2], ring[i * 2 + 1], ring[((i + 1) % n) * 2], ring[((i + 1) % n) * 2 + 1]);
    const b = new Batch(x.c.mesh, f);
    b.quadF('fac_render', 'N', [[0, x.bottom, 0], [f.len, x.bottom, 0], [f.len, x.wallTop, 0], [0, x.wallTop, 0]], scale(x.p.wall, 0.8));
    b.flush();
  }
  // Light wells are roofed over at the roof line (a corrugated translucent sheet on a curb), so they never read as
  // open black shafts from above (c07).
  const pts = pairs(ring);
  const tris = THREE.ShapeUtils.triangulateShape(pts, []).flat();
  const y = x.p.roofY + 0.3;
  x.c.mesh.flatTriangles('fac_panel', pts.map((v) => [v.x, y, v.y] as Vec3), tris, [0, 1, 0], { color: lin(0xaab5b2) });
  x.c.mesh.flatTriangles('fac_panel', pts.map((v) => [v.x, y - 0.02, v.y] as Vec3), tris, [0, -1, 0], { color: lin(0x8f9896) });
}

/* ------------------------------------------------------------------------------------------------------------- */
/* Wear                                                                                                            */
/* ------------------------------------------------------------------------------------------------------------- */

/** Damaged-plaster patches (spandrels under windows, piers), 0–3 per façade by wear. */
function pickPatches(x: Ctx2, e: Edge, wins: readonly Win[], holes: readonly Rect[]): Rect[] {
  const out: Rect[] = [];
  const max = Math.round(x.p.wear * 3.2);
  const hit = (q: Rect): boolean => holes.some((h) => q.r0 < h.r1 && q.r1 > h.r0 && q.y0 < h.y1 && q.y1 > h.y0) || out.some((h) => q.r0 < h.r1 && q.r1 > h.r0 && q.y0 < h.y1 && q.y1 > h.y0);
  for (const w of wins) {
    if (out.length >= max) {
      break;
    }
    if (w.kind !== 'window' || h01(w.seed, 70) > x.p.wear * 0.45) {
      continue;
    }
    const q: Rect = { r0: w.r0 - 0.1 - 0.3 * h01(w.seed, 71), r1: w.r1 + 0.1 + 0.3 * h01(w.seed, 72), y0: Math.max(w.fy + 0.05, w.y0 - 0.85), y1: w.y0 - 0.06 };
    if (q.y1 - q.y0 > 0.3 && q.r0 > 0.05 && q.r1 < e.len - 0.05 && !hit(q)) {
      out.push(q);
    }
  }
  return out;
}

/** Leak streaks under sills and cornices and plinth bands (BLEND decals 1.2 cm in front of the wall). */
function decals(x: Ctx2, e: Edge, b: Batch, wins: readonly Win[], units: readonly ShopUnit[]): void {
  const { p } = x;
  const d = 0.012;
  const streak = (r0: number, r1: number, yTop: number, len: number, alpha: number, seed: number): void => {
    if (len < 0.2) {
      return;
    }
    const u0 = h01(seed, 1) * 0.6;
    const u1 = u0 + Math.min(0.4, (r1 - r0) / 3);
    const col: RGBA = [0.62, 0.47, 0.66, alpha];
    b.quadF('fac_leak', 'N', [[r0, yTop - len, d], [r1, yTop - len, d], [r1, yTop, d], [r0, yTop, d]], col, [
      [u0, 1],
      [u1, 1],
      [u1, 0],
      [u0, 0],
    ]);
  };
  for (const w of wins) {
    if (w.kind === 'door' || w.kind === 'shopribbon' || h01(w.seed, 80) > 0.3 + 0.55 * p.wear) {
      continue;
    }
    const yTop = w.y0 - 0.04;
    const len = Math.min(0.5 + 0.7 * h01(w.seed, 81), yTop - w.fy - 0.12);
    streak(w.r0 - 0.02, w.r1 + 0.02, yTop, len, 0.45 + 0.4 * p.wear, w.seed);
  }
  // Under the roof edge on street / open walls.
  if (p.wear > 0.3) {
    const top = p.roof === 'flat' ? p.roofY - 0.25 : p.roofY - 0.55;
    for (let r = 0.3; r < e.len - 1; r += 1.6 + 1.2 * h01(x.p.seed + r, 3)) {
      if (h01(p.seed + r * 1.3, 4) < p.wear * 0.7) {
        const w = 0.6 + 0.8 * h01(p.seed + r, 5);
        const hole = wins.find((q) => r + w > q.r0 && r < q.r1 && q.y1 + q.box > top - 1.1);
        streak(r, Math.min(e.len - 0.1, r + w), top, hole ? Math.max(0, top - (hole.y1 + hole.box) - 0.1) : 0.6 + 0.6 * h01(p.seed + r, 6), 0.35 + 0.35 * p.wear, p.seed + r);
      }
    }
  }
  // Plinth bands on the piers between shopfronts and on walls without units.
  if (e.kind === 'street' || e.kind === 'open') {
    const gaps: [number, number][] = [];
    let cur = 0;
    for (const u of [...units].sort((a, c) => a.r0 - c.r0)) {
      if (u.r0 - cur > 0.15) {
        gaps.push([cur, u.r0]);
      }
      cur = u.r1;
    }
    if (e.len - cur > 0.15) {
      gaps.push([cur, e.len]);
    }
    for (const [a, c] of gaps) {
      const g = Math.min(e.gAt(a), e.gAt(c));
      const hgt = 0.35 + 0.35 * p.wear;
      const u0 = h01(p.seed + a, 7) * 0.5;
      b.quadF('fac_leak_band', 'N', [[a, g - 0.1, d], [c, g - 0.1, d], [c, g + hgt, d], [a, g + hgt, d]], [0.6, 0.46, 0.64, 0.45 + 0.35 * p.wear], [
        [u0, 1],
        [u0 + Math.min(0.5, (c - a) / 6), 1],
        [u0 + Math.min(0.5, (c - a) / 6), 0],
        [u0, 0],
      ]);
    }
  }
}

/* ------------------------------------------------------------------------------------------------------------- */
/* LOD1                                                                                                            */
/* ------------------------------------------------------------------------------------------------------------- */

/** LOD1: the block with the plan's colours; shop band and window bands on street / open walls. */
function lod1(x: Ctx2, edges: readonly Edge[]): void {
  const { p, c, s } = x;
  for (const e of edges) {
    const b = new Batch(c.mesh, e.f);
    const bands: [number, number, RGBA][] = [];
    if (e.kind === 'street' || e.kind === 'open') {
      bands.push([x.bottom, x.G1, e.kind === 'street' ? lin(0x3c3833) : scale(p.wall, 0.85)]);
      for (let k = 1; k < p.storeys; k++) {
        const fy = x.floorY(k);
        const sill = p.typ === 'T2' ? 0.75 : 0.9;
        const head = p.typ === 'T2' ? 2.85 : p.typ === 'T3' ? 2.55 : 2.4;
        const win = scale(mix(p.wall, lin(0x4a5058), 0.45), e.kind === 'street' ? 0.8 : 0.9);
        bands.push([fy, fy + sill, p.wall], [fy + sill, Math.min(fy + head, x.floorY(k + 1) - 0.3), win], [Math.min(fy + head, x.floorY(k + 1) - 0.3), x.floorY(k + 1), p.wall]);
      }
      if (x.wallTop > p.roofY) {
        bands.push([p.roofY, x.wallTop, p.wall]);
      }
    } else {
      bands.push([x.bottom, x.wallTop, mix(p.wall, lin(0xb9b6b0), 0.55)]);
    }
    for (const [y0, y1, col] of bands) {
      if (y1 - y0 > 0.01) {
        b.quadF('fac_render', 'N', [[0, y0, 0], [e.len, y0, 0], [e.len, y1, 0], [0, y1, 0]], col);
      }
    }
    b.flush();
  }
  for (const hole of s.holes) {
    plainRing(x, hole);
  }
  if (p.roof === 'hipped' && hippedRoof(x, edges)) {
    return;
  }
  const contour = pairs(s.ring);
  const holes = s.holes.map(pairs);
  const tris = THREE.ShapeUtils.triangulateShape(contour, holes).flat();
  const flat = [...contour, ...holes.flat()];
  c.mesh.flatTriangles(
    'fac_roof_flat',
    flat.map((v) => [v.x, x.wallTop, v.y] as Vec3),
    tris,
    [0, 1, 0],
    { color: lin(0x57524d) },
  );
}
