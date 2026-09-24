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
 */
import * as THREE from 'three';
import { pointInRing } from '../../../../src/world/osm/shared/geometry';
import type { FootprintIndex } from '../../../../src/world/osm/shared/footprints';
import { type StreetSurface, Zone } from '../../../../src/world/osm/shared/street-surface';
import type { Solid } from '../buildings';
import type { DoorRec, InstanceRec, PoiRec, XYZ } from '../format';
import type { GroundHeights } from '../ground';
import type { LightSink } from '../lights';
import { LOD0, LOD1, type RGBA, type TileMesh, type Vec2, type Vec3 } from '../mesh';
import type { PlaceOptions } from '../registry';
import { emitShopUnit, planShops, type ShopUnit } from '../shopfront/shopfront';
import { Batch, Frame, h01, lin, mix, pick, scale } from './frame';
import type { FacadePlan } from './plan';

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

interface Rect {
  r0: number;
  r1: number;
  y0: number;
  y1: number;
}

interface Win extends Rect {
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

interface Ctx2 {
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
}

export function buildFacade(s: Solid, p: FacadePlan, edges: readonly Edge[], c: FacadeCtx): FacadeRecord {
  const before = c.mesh.triangles(LOD0);
  const H = (k: number): number => h01(p.seed, 100 + k);
  const wallTop = p.roof === 'hipped' ? p.roofY : p.roofY + p.parapet;
  const floorY = (k: number): number => (k <= 0 ? p.base : k >= p.storeys ? p.roofY : p.base + p.G + (k - 1) * p.F);
  const cladPick = H(1);
  const clad =
    p.typ === 'T2'
      ? { material: 'fac_stone', color: scale(lin(0xe8e2d6), 1 - p.wear * 0.2) }
      : cladPick < 0.35
        ? { material: 'fac_panel', color: lin(pick([0x3d4044, 0x55595e, 0x2a2c2e, 0x7a7f84], H(2))) }
        : cladPick < 0.5
          ? { material: 'fac_tiles', color: lin(0xf0eee8) }
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

/* ------------------------------------------------------------------------------------------------------------- */
/* Wall grid                                                                                                       */
/* ------------------------------------------------------------------------------------------------------------- */

/**
 * A wall rectangle on the plane d, minus holes, as grid cells that share every edge (no T-junctions). `cell` picks
 * the material of a cell; `color` the COLOR_0 of each vertex.
 */
function wallGrid(b: Batch, d: number, R: Rect, holes: readonly Rect[], extraR: readonly number[], extraY: readonly number[], cell: (r: number, y: number) => string, color: (r: number, y: number, m: string) => RGBA, axis: 'N' | '-N' = 'N'): void {
  const brk = (vals: number[], lo: number, hi: number): number[] => {
    const s = [...new Set(vals.filter((v) => v > lo + 1e-3 && v < hi - 1e-3).map((v) => Math.round(v * 1000) / 1000))].sort((a, c) => a - c);
    return [lo, ...s, hi];
  };
  const rs = brk([...holes.flatMap((h) => [h.r0, h.r1]), ...extraR], R.r0, R.r1);
  const ys = brk([...holes.flatMap((h) => [h.y0, h.y1]), ...extraY], R.y0, R.y1);
  for (let j = 0; j + 1 < ys.length; j++) {
    for (let i = 0; i + 1 < rs.length; i++) {
      const rc = (rs[i] + rs[i + 1]) / 2;
      const yc = (ys[j] + ys[j + 1]) / 2;
      if (holes.some((h) => rc > h.r0 && rc < h.r1 && yc > h.y0 && yc < h.y1)) {
        continue;
      }
      const m = cell(rc, yc);
      const q: [number, number, number][] = [
        [rs[i], ys[j], d],
        [rs[i + 1], ys[j], d],
        [rs[i + 1], ys[j + 1], d],
        [rs[i], ys[j + 1], d],
      ];
      b.quadF(
        m,
        axis,
        q,
        q.map(([r, y]) => color(r, y, m)),
      );
    }
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

/* ------------------------------------------------------------------------------------------------------------- */
/* Edges                                                                                                           */
/* ------------------------------------------------------------------------------------------------------------- */

function emitEdge(x: Ctx2, e: Edge): ShopUnit[] {
  const { p, c } = x;
  const b = new Batch(c.mesh, e.f);
  const g = e.gMean;
  const partyColor = mix(p.wall, lin(0xb9b6b0), 0.55);
  if (e.kind === 'party' || e.kind === 'short') {
    wallGrid(
      b,
      0,
      { r0: 0, r1: e.len, y0: x.bottom, y1: x.wallTop },
      [],
      [],
      [g + 0.4, g + 1.3, x.wallTop - 0.8],
      () => 'fac_render',
      (_r, y) => shade(x, partyColor, y, g),
    );
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
  const patches = pickPatches(x, e, wins, holes);
  const peelParapet = p.wear > 0.55 && p.roof === 'flat';
  const cell = (r: number, y: number): string => {
    if (patches.some((q) => r > q.r0 && r < q.r1 && y > q.y0 && y < q.y1)) {
      return 'fac_damaged';
    }
    if (y > p.roofY && peelParapet) {
      return 'fac_peeling';
    }
    if (e.kind === 'street' && y < x.G1 - 0.02) {
      return x.clad.material;
    }
    return 'fac_render';
  };
  const color = (r: number, y: number, mat: string): RGBA => {
    if (mat === 'fac_damaged') {
      return shade(x, lin(0xe6e2da), y, g);
    }
    if (mat === x.clad.material && mat !== 'fac_render' && y < x.G1) {
      return shade(x, x.clad.color, y, g);
    }
    let col = shade(x, p.wall, y, g);
    if (ck && r > ck.c0 - 0.3 && r < ck.c1 + 0.3 && y < ck.y0 && y > ck.y0 - 0.5) {
      col = scale(col, 0.72 + 0.28 * ((ck.y0 - y) / 0.5));
    }
    return col;
  };
  const extraY = [g + 0.4, g + 1.3, x.G1, x.wallTop - 0.8, p.roofY, ...(ck ? [ck.y0 - 0.5] : [])];
  wallGrid(b, 0, { r0: 0, r1: e.len, y0: x.bottom, y1: x.wallTop }, holes, patches.flatMap((q) => [q.r0, q.r1]), [...extraY, ...patches.flatMap((q) => [q.y0, q.y1])], cell, color);
  b.flush();
  for (const w of wins) {
    emitWindow(x, e, b, w, 0, p.wall);
    b.flush();
  }
  emitBalconies(x, e, b, wins, ck);
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
  return units;
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
  // Reveals: jambs, head and the bottom reveal, darker towards the frame.
  b.quadF('fac_render', 'R', [[r0, y0, dp], [r0, y0, df], [r0, top, df], [r0, top, dp]], [outer, inner, inner, outer]);
  b.quadF('fac_render', '-R', [[r1, y0, dp], [r1, y0, df], [r1, top, df], [r1, top, dp]], [outer, inner, inner, outer]);
  b.quadF('fac_render', '-Y', [[r0, top, dp], [r1, top, dp], [r1, top, df], [r0, top, df]], [outer, outer, inner, inner]);
  b.quadF('fac_render', 'Y', [[r0, y0, dp], [r1, y0, dp], [r1, y0, df], [r0, y0, df]], [outer, outer, inner, inner]);
  const shop = w.kind === 'shopribbon';
  const frameMat = p.typ === 'T3' || shop ? 'fac_alu' : p.frame === 'timber' ? 'fac_timber' : 'fac_pvc';
  const frameCol = p.typ === 'T3' || shop ? lin(0x3b3e41) : p.frameColor;
  const fw = p.typ === 'T2' ? 0.075 : 0.065;
  const fd = 0.07;
  // Roller box (T1) at the top of the opening.
  if (w.box > 0) {
    b.box('fac_pvc', r0, r1, y1, top, df, dp - 0.012, lin(pick([0xf2f2ee, 0xe9e2d0, 0xd9d9d6], U(1))), { front: true, bottom: true });
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
  // Curtains: net curtains (tül) across, side curtains, or none.
  const cu = U(4);
  const dc = df - 0.08;
  if (!shop && w.kind !== 'small') {
    if (cu < 0.5) {
      b.quadF('fac_curtain', 'N', [[r0, y0, dc], [r1, y0, dc], [r1, y1, dc], [r0, y1, dc]], lin(pick([0xefe9dc, 0xe8e4da, 0xf2ede0], U(5)), 0.85));
    } else if (cu < 0.75) {
      const cc = lin(pick([0xb89c78, 0x8a3a34, 0x44546e, 0xd9cbb0, 0x6e7a5a], U(5)), 0.85);
      const cwid = (r1 - r0) * (0.22 + 0.15 * U(6));
      b.quadF('fac_curtain', 'N', [[r0, y0 + 0.05, dc], [r0 + cwid, y0 + 0.05, dc], [r0 + cwid, y1, dc], [r0, y1, dc]], cc);
      b.quadF('fac_curtain', 'N', [[r1 - cwid, y0 + 0.05, dc], [r1, y0 + 0.05, dc], [r1, y1, dc], [r1 - cwid, y1, dc]], cc);
    }
  }
  // Glass.
  const glass: RGBA = [0.2 + 0.05 * U(7), 0.25 + 0.05 * U(7), 0.28, shop ? 0.2 : 0.38];
  b.quadF('fac_glass', 'N', [[r0 + fw, y0 + fw, df + 0.035], [r1 - fw, y0 + fw, df + 0.035], [r1 - fw, y1 - fw, df + 0.035], [r0 + fw, y1 - fw, df + 0.035]], glass);
  // Frame: outer bars with their inner faces, mullions and transoms.
  const f0 = df;
  const f1 = df + fd;
  b.box(frameMat, r0, r0 + fw, y0, y1, f0, f1, frameCol, { front: true, right: true });
  b.box(frameMat, r1 - fw, r1, y0, y1, f0, f1, frameCol, { front: true, left: true });
  b.box(frameMat, r0 + fw, r1 - fw, y0, y0 + fw, f0, f1, frameCol, { front: true });
  b.box(frameMat, r0 + fw, r1 - fw, y1 - fw, y1, f0, f1, frameCol, { front: true, bottom: true });
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
    b.box(frameMat, mx - fw / 2, mx + fw / 2, y0 + fw, y1 - fw, f0, f1, frameCol, { front: true, left: true, right: true });
  }
  const transom = p.typ === 'T2' ? y1 - 0.55 : w.kind === 'window' && wid > 2.0 ? y1 - 0.5 : 0;
  if (transom > y0 + 0.8) {
    b.box(frameMat, r0 + fw, r1 - fw, transom - fw / 2, transom + fw / 2, f0, f1, frameCol, { front: true, top: true, bottom: true });
  }
  if (w.kind === 'door') {
    // Kick panel under the fixed part of a balcony door.
    const dx = mull[0];
    const [k0, k1] = dx - r0 < r1 - dx ? [dx, r1 - fw] : [r0 + fw, dx];
    b.quadF(frameMat, 'N', [[k0, y0 + fw, f1 - 0.01], [k1, y0 + fw, f1 - 0.01], [k1, w.fy + 0.9, f1 - 0.01], [k0, w.fy + 0.9, f1 - 0.01]], scale(frameCol, 0.97));
  }
  // Roller shutter (partly down) in front of the frame.
  if (w.box > 0 && p.shutters === 'roller' && !shop) {
    const s = U(9);
    const yb = s < 0.55 ? y1 : s < 0.85 ? y1 - (y1 - y0) * (0.2 + 0.5 * U(10)) : y0 + 0.02;
    if (yb < y1 - 0.02) {
      const rc = lin(pick([0xf0efe9, 0xe3dac6, 0xc9cbcc, 0xd8c9a4], U(11)));
      b.quadF('fac_roller', 'N', [[r0 + 0.01, yb, f1 + 0.012], [r1 - 0.01, yb, f1 + 0.012], [r1 - 0.01, y1, f1 + 0.012], [r0 + 0.01, y1, f1 + 0.012]], rc);
      b.box('fac_pvc', r0 + 0.01, r1 - 0.01, yb - 0.04, yb, f1, f1 + 0.03, scale(rc, 0.9), { front: true, bottom: true });
    }
  }
  // Sill.
  if (w.kind !== 'door' && w.kind !== 'shopribbon') {
    if (p.typ === 'T2') {
      b.box('fac_render', r0 - 0.08, r1 + 0.08, y0 - 0.08, y0, df, dp + 0.07, x.p.trim, { front: true, top: true, bottom: true, left: true, right: true });
    } else {
      b.box('fac_marble', r0 - 0.04, r1 + 0.04, y0 - 0.035, y0, df, dp + 0.05, scale(lin(0xe6e3dc), 1 - p.wear * 0.18), { front: true, top: true, bottom: true, left: true, right: true });
    }
  }
  // T2 surround: architrave and a cornice cap over the head.
  if (p.typ === 'T2' && w.kind !== 'small') {
    const t = x.p.trim;
    b.box('fac_render', r0 - 0.12, r0, y0, top, dp, dp + 0.03, t, { front: true, left: true });
    b.box('fac_render', r1, r1 + 0.12, y0, top, dp, dp + 0.03, t, { front: true, right: true });
    b.box('fac_render', r0 - 0.12, r1 + 0.12, top, top + 0.12, dp, dp + 0.03, t, { front: true });
    b.box('fac_render', r0 - 0.2, r1 + 0.2, top + 0.12, top + 0.26, dp, dp + 0.12, scale(t, 0.97), { front: true, top: true, bottom: true, left: true, right: true });
  }
  // Wooden shutters (T2): open against the wall, or closed in the reveal.
  if (p.shutters === 'wood' && w.kind === 'window') {
    const s = U(12);
    const tint: RGBA = U(13) < 0.6 ? [1, 1, 1, 1] : [0.95, 0.72, 0.55, 1];
    if (s < 0.6) {
      const lw = (r1 - r0) / 2;
      b.box('fac_shutter_wood', r0 - 0.14 - lw, r0 - 0.14, y0, y1, dp + 0.03, dp + 0.07, tint, { front: true, left: true, right: true, top: true });
      b.box('fac_shutter_wood', r1 + 0.14, r1 + 0.14 + lw, y0, y1, dp + 0.03, dp + 0.07, tint, { front: true, left: true, right: true, top: true });
    } else if (s < 0.85) {
      b.quadF('fac_shutter_wood', 'N', [[r0, y0, dp - 0.06], [r1, y0, dp - 0.06], [r1, y1, dp - 0.06], [r0, y1, dp - 0.06]], tint);
    }
  }
  // AC unit on brackets under the window, or on the balcony beside the door.
  if ((p.typ === 'T1' || p.typ === 'T3') && w.kind !== 'shopribbon' && w.kind !== 'small' && U(14) < (w.kind === 'ribbon' ? 0.35 : 0.22)) {
    const yaw = Math.atan2(e.f.nx, e.f.nz);
    const rc = w.kind === 'ribbon' ? r0 + (r1 - r0) * (0.2 + 0.6 * U(15)) : w.kind === 'door' ? (mull[0] - r0 < r1 - mull[0] ? r1 - 0.5 : r0 + 0.5) : (r0 + r1) / 2;
    const yb = w.kind === 'door' ? w.fy + 0.03 : y0 - 0.74;
    const dd = w.kind === 'door' ? dp + 0.05 : dp;
    const [px, pz] = e.f.xz(rc, dd);
    c.place('fac_ac', [px, yb, pz], yaw, { variant: 'unit', seed: Math.floor(U(16) * 1000), ref: `${c.tile}/ac` });
  }
}

/* ------------------------------------------------------------------------------------------------------------- */
/* Balconies                                                                                                       */
/* ------------------------------------------------------------------------------------------------------------- */

function emitBalconies(x: Ctx2, e: Edge, b: Batch, wins: readonly Win[], ck: Cikma | null): void {
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
    b.box('fac_concrete', r0, r1, y1 - 0.001, y1, 0, P, lin(0xbdb7ad), { top: true });
    b.box('fac_render', r0, r1, y0, y1, 0, P, edgeCol, { front: true, left: true, right: true });
    b.quadF('fac_render', '-Y', [[r0, y0, 0], [r1, y0, 0], [r1, y0, P], [r0, y0, P]], [scale(edgeCol, 0.55), scale(edgeCol, 0.55), scale(edgeCol, 0.82), scale(edgeCol, 0.82)]);
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
  }
}

/** Steel railings: flat-bar, square-bar, wrought iron or galvanised pipe, on the front and both ends. */
function railing(x: Ctx2, b: Batch, r0: number, r1: number, y1: number, top: number, P: number, U: (q: number) => number): void {
  const { p } = x;
  const col = p.railColor;
  const m = 'fac_metal';
  const allF = { front: true, left: true, right: true };
  const rail = (ra: number, rb: number, ya: number, yb: number, da: number, db: number): void => b.box(m, ra, rb, ya, yb, da, db, col, { front: true, back: true, top: true, bottom: true, left: true, right: true });
  // Top rails on the front and the ends, posts at the corners.
  rail(r0, r1, top - 0.045, top, P - 0.05, P);
  rail(r0, r0 + 0.045, top - 0.045, top, 0, P - 0.05);
  rail(r1 - 0.045, r1, top - 0.045, top, 0, P - 0.05);
  b.box(m, r0, r0 + 0.045, y1, top, P - 0.05, P, col, allF);
  b.box(m, r1 - 0.045, r1, y1, top, P - 0.05, P, col, allF);
  if (p.railing === 'pipe') {
    for (const yy of [y1 + 0.35, y1 + 0.68]) {
      rail(r0, r1, yy - 0.02, yy + 0.02, P - 0.04, P - 0.01);
      rail(r0, r0 + 0.04, yy - 0.02, yy + 0.02, 0, P - 0.05);
      rail(r1 - 0.04, r1, yy - 0.02, yy + 0.02, 0, P - 0.05);
    }
    const n = Math.max(1, Math.round((r1 - r0) / 1.2));
    for (let k = 1; k < n; k++) {
      const rr = r0 + ((r1 - r0) * k) / n;
      b.box(m, rr - 0.02, rr + 0.02, y1, top, P - 0.045, P - 0.005, col, allF);
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
        b.box(m, v - bw / 2, v + bw / 2, y1 + 0.12, top - 0.045, P - 0.025 - bd / 2, P - 0.025 + bd / 2, col, { front: true, left: bw > 0.015, right: true });
      } else {
        b.box(m, r0 + 0.0225 - bd / 2, r0 + 0.0225 + bd / 2, y1 + 0.12, top - 0.045, v - bw / 2, v + bw / 2, col, { left: true, front: true });
        b.box(m, r1 - 0.0225 - bd / 2, r1 - 0.0225 + bd / 2, y1 + 0.12, top - 0.045, v - bw / 2, v + bw / 2, col, { right: true, front: true });
      }
    }
  };
  bars(r0, r1, 'r');
  bars(0, P - 0.05, 'd');
  void U;
}

/* ------------------------------------------------------------------------------------------------------------- */
/* Çıkma                                                                                                           */
/* ------------------------------------------------------------------------------------------------------------- */

interface Cikma {
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
  wallGrid(
    b,
    D,
    { r0: c0, r1: c1, y0, y1: top },
    holes,
    [],
    [top - 0.8, p.roofY],
    (_r, y) => (y > p.roofY && p.wear > 0.55 && p.roof === 'flat' ? 'fac_peeling' : mat),
    (_r, y) => shade(x, col, y, y0 - 10),
  );
  // Sides and the soffit (darker towards the wall).
  b.quadF(mat, '-R', [[c0, y0, 0], [c0, y0, D], [c0, top, D], [c0, top, 0]], [scale(col, 0.85), col, col, scale(col, 0.85)]);
  b.quadF(mat, 'R', [[c1, y0, 0], [c1, y0, D], [c1, top, D], [c1, top, 0]], [scale(col, 0.85), col, col, scale(col, 0.85)]);
  const so = p.trim;
  b.quadF('fac_render', '-Y', [[c0, y0, 0], [c1, y0, 0], [c1, y0, D], [c0, y0, D]], [scale(so, 0.5), scale(so, 0.5), scale(so, 0.85), scale(so, 0.85)]);
  // Slab edge band at the base of the çıkma.
  b.box('fac_render', c0 - 0.02, c1 + 0.02, y0, y0 + 0.2, D, D + 0.03, p.trim, { front: true, top: true, bottom: true, left: true, right: true });
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
        b.box('fac_render', a, c, fy + 0.02 - h, fy + 0.02, 0, pr, t, { front: true, top: true, bottom: true });
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
        b.box('fac_render', a, c, y - 0.06, y + 0.04, d0, d0 + 0.38, scale(t, 0.95), { front: true, bottom: true, top: true, left: true, right: true });
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
      b.box('fac_render', a - 0.02, c + 0.02, y - 0.18, y + 0.02, 0, x.eave, t, { front: true, top: true, bottom: true, left: true, right: true });
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
    b.box('fac_concrete', a, c, y1, y1 + 0.05, d - 0.23, d + 0.04, cope, { front: true, back: true, top: true });
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

/** Hole rings (light wells, courtyards): plain walls. */
function plainRing(x: Ctx2, ring: readonly number[]): void {
  const n = ring.length / 2;
  for (let i = 0; i < n; i++) {
    const f = Frame.ofEdge(ring[i * 2], ring[i * 2 + 1], ring[((i + 1) % n) * 2], ring[((i + 1) % n) * 2 + 1]);
    const b = new Batch(x.c.mesh, f);
    b.quadF('fac_render', 'N', [[0, x.bottom, 0], [f.len, x.bottom, 0], [f.len, x.wallTop, 0], [0, x.wallTop, 0]], scale(x.p.wall, 0.8));
    b.flush();
  }
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
