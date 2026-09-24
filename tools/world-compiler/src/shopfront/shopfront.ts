/**
 * Shopfronts: the ground floor of every street-facing façade in the full-detail strip is open (spec section 3,
 * "Shopfront anatomy"). A frontage is split into units of 4–7 m (one per POI where mapped, filler trades elsewhere)
 * with piers between them; each unit gets a kepenk (galvanised roller shutter: open, half-open or closed), aluminium
 * glazing with an entrance door (at the manifest's door record when one lies in the unit), a lit interior, a sign
 * band with a fictional Turkish name (stroke font geometry, font.ts), optionally an awning, a projecting sign and,
 * for fish / produce / deli trades, a stall display in front. A tagged or inferred apartment entrance becomes a
 * recessed door with a fanlight and a canopy.
 *
 * Frame coordinates (facade/frame.ts): r to the right along the wall, y world height, d in front of the wall.
 */
import type { LightSink } from '../lights';
import type { RGBA, Weather } from '../mesh';
import type { PlaceOptions } from '../registry';
import type { InstanceRec, XYZ } from '../format';
import { Batch, Frame, h01, lin, mix, pick, pickWeighted, scale } from '../facade/frame';
import { SIGN_GLOW, type SignGlow } from '../facade/materials';
import type { FacadePlan } from '../facade/plan';
import { emitText, textWidth } from './font';
import { emitShopInterior } from './interior';
import { fillerTrade, type ShopName, shopName, type Trade, tradeOf } from './names';

export type Kepenk = 'open' | 'half' | 'closed';
export type AwningKind = 'none' | 'low' | 'high' | 'market';

export interface ShopUnit {
  r0: number;
  r1: number;
  kind: 'shop' | 'entrance';
  trade: Trade | null;
  poi: string | null;
  name: ShopName | null;
  kepenk: Kepenk;
  awning: AwningKind;
  awningDepth: number;
  awningColors: [RGBA, RGBA];
  signLit: boolean;
  glow: SignGlow;
  projecting: boolean;
  doorR: number;
  doorW: number;
  /** Threshold (floor) height and the top of the opening. */
  yFloor: number;
  yOpen: number;
  stall: 'none' | 'fish' | 'produce' | 'deli';
  seed: number;
  /** Door height (clear) above the floor. */
  doorH: number;
  /** A compiled interior (hero lane) opens behind this unit's door: no leaf, no fake interior box, kepenk open. */
  interior: InteriorLink | null;
}

/** What the interiors step (hero lane, `area.shared.get('interiors')`) says about a door that opens into a room. */
export interface InteriorLink {
  name?: string;
  doorWidth: number;
}

export interface EdgeShopInput {
  f: Frame;
  len: number;
  /** Ground height in front of the wall at r. */
  gAt: (r: number) => number;
  convexL: boolean;
  convexR: boolean;
  /** POIs of the building projected on this edge. */
  pois: { id: string; kind: string; r: number }[];
  /** Door records on this edge. */
  doors: { id: string; r: number; width: number; height: number; inferred: boolean; entrance: string }[];
  /** The compiled interior behind a door record or POI, if any (read at emission time). */
  interior: (doorId: string | null, poiId: string | null) => InteriorLink | null;
  /** This is the building's main street edge (hosts a synthetic apartment entrance). */
  main: boolean;
  /** In the fish / produce market end of the strip. */
  market: boolean;
  /** Free depth in front of the wall (m) before another building (awnings stay out of it). */
  clearAt: (r: number) => number;
}

const MARKET_TRADES = new Set<Trade>(['fish', 'produce', 'deli', 'nuts', 'butcher']);
const ALWAYS_OPEN = new Set<Trade>(['cafe', 'restaurant', 'fastfood', 'sweets', 'bakery', 'fish', 'produce', 'deli']);
const PIER = 0.4;
/** Buildings whose shop is shuttered (spec section 2: the 1930 lottery kiosk at the Yasa Cd entrance, c11). */
const SHUTTERED = new Set([709156144]);

/** Splits a street edge's ground floor into shop units and entrances. */
export function planShops(e: EdgeShopInput, p: FacadePlan, avoid: ReadonlySet<string>): ShopUnit[] {
  const seed = p.seed * 1.37 + e.f.ox * 0.013 + e.f.oz * 0.007;
  const H = (k: number): number => h01(seed, k);
  const ml = e.convexL ? 0.45 : 0.3;
  const mr = e.convexR ? 0.45 : 0.3;
  const a = ml;
  const b = e.len - mr;
  if (b - a < 1.6) {
    return [];
  }
  const G1 = p.base + p.G;
  const openTop = (r0: number, r1: number, floor: number): number => {
    const top = Math.min(floor + 2.75 + 0.2 * h01(seed, r0 * 3.1), G1 - 1.0);
    return Math.max(top, floor + 2.25);
  };
  const floorOf = (r0: number, r1: number): number => Math.max(e.gAt(r0 + 0.1), e.gAt(r1 - 0.1)) + 0.06;
  const units: ShopUnit[] = [];
  // Apartment entrance: a tagged non-shop door on this edge, else a synthetic one on the main edge.
  const reserved: [number, number][] = [];
  for (const d of e.doors) {
    if (!d.inferred && d.entrance !== 'shop' && d.r > a + 0.6 && d.r < b - 0.6) {
      const w = Math.min(1.6, Math.max(1.1, d.width));
      reserved.push([d.r - w / 2, d.r + w / 2]);
    }
  }
  if (!reserved.length && e.main && p.typ !== 'T5' && p.storeys >= 2 && b - a >= 6 && H(1) < 0.75) {
    const w = 1.25;
    reserved.push(H(2) < 0.5 ? [a + 0.1, a + 0.1 + w] : [b - 0.1 - w, b - 0.1]);
  }
  reserved.sort((x, y) => x[0] - y[0]);
  const spans: [number, number][] = [];
  let cur = a;
  for (const [r0, r1] of reserved) {
    if (r0 - PIER - cur >= 1.4) {
      spans.push([cur, r0 - PIER]);
    }
    const yF = floorOf(r0, r1);
    units.push({ r0, r1, kind: 'entrance', trade: null, poi: null, name: null, kepenk: 'open', awning: 'none', awningDepth: 0, awningColors: [lin(0xffffff), lin(0xffffff)], signLit: false, glow: 'white', projecting: false, doorR: (r0 + r1) / 2, doorW: r1 - r0 - 0.2, yFloor: yF, yOpen: Math.min(yF + 2.75, G1 - 0.6), stall: 'none', seed: seed + r0, doorH: 2.3, interior: null });
    cur = r1 + PIER;
  }
  if (b - cur >= 1.4) {
    spans.push([cur, b]);
  }
  for (const [s0, s1] of spans) {
    const w = s1 - s0;
    const target = 4.4 + 2 * H(3 + s0);
    let n = Math.max(1, Math.round(w / target));
    if (w / n > 7) {
      n++;
    }
    const uw = (w - (n - 1) * PIER) / n;
    for (let k = 0; k < n; k++) {
      const r0 = s0 + k * (uw + PIER);
      const r1 = r0 + uw;
      const us = seed + r0 * 7.7;
      const U = (q: number): number => h01(us, q);
      const poi = e.pois.find((q) => q.r >= r0 - 0.6 && q.r <= r1 + 0.6) ?? null;
      const trade = poi ? tradeOf(poi.kind, U(1)) : fillerTrade(U(1), e.market);
      const market = MARKET_TRADES.has(trade);
      const yFloor = floorOf(r0, r1);
      const yOpen = openTop(r0, r1, yFloor);
      const kepenk: Kepenk = SHUTTERED.has(p.osmId) ? 'closed' : ALWAYS_OPEN.has(trade) ? 'open' : pickWeighted<Kepenk>([['open', 0.7], ['half', 0.18], ['closed', 0.12]], U(2));
      let awning: AwningKind = market ? 'market' : e.market || U(3) < 0.68 ? (U(4) < 0.55 ? 'low' : 'high') : 'none';
      let depth = market ? (e.market ? 2.5 + 0.9 * U(5) : 1.7 + 0.5 * U(5)) : 1.1 + 0.5 * U(5);
      const clear = Math.min(e.clearAt(r0 + 0.3), e.clearAt((r0 + r1) / 2), e.clearAt(r1 - 0.3));
      depth = Math.min(depth, clear - 0.4);
      if (depth < 0.8) {
        awning = 'none';
      }
      const linked = e.doors.find((d) => d.r >= r0 && d.r <= r1 && e.interior(d.id, null));
      const door = linked ?? e.doors.find((d) => d.r > r0 + 0.5 && d.r < r1 - 0.5);
      const interior = e.interior(door?.id ?? null, poi?.id ?? null);
      const doorW = interior ? interior.doorWidth : Math.min(1.1, Math.max(0.85, uw * 0.3));
      let doorR = door ? door.r : uw < 2.4 ? (r0 + r1) / 2 : U(6) < 0.4 ? r0 + 0.2 + doorW / 2 : U(6) < 0.75 ? r1 - 0.2 - doorW / 2 : (r0 + r1) / 2;
      doorR = Math.max(r0 + doorW / 2 + 0.07, Math.min(r1 - doorW / 2 - 0.07, doorR));
      const awningColors = pickWeighted<[number, number]>(
        [
          [[0xb8262b, 0xf1ede4], 0.3],
          [[0x1f6b45, 0x1f6b45], 0.18],
          [[0x1d4f8c, 0x1d4f8c], 0.14],
          [[0x7a1f24, 0x7a1f24], 0.14],
          [[0x2d7a52, 0xece8dc], 0.1],
          [[0xd4702a, 0xf0ebe0], 0.06],
          [[0x9a2b2b, 0xd8c9a8], 0.08],
        ],
        U(7),
      );
      units.push({
        r0,
        r1,
        kind: 'shop',
        trade,
        poi: poi?.id ?? null,
        name: interior?.name ? { name: interior.name.toLocaleUpperCase('tr'), short: shopName(trade, us, avoid).short } : shopName(trade, us, avoid),
        kepenk: interior ? 'open' : kepenk,
        awning,
        awningDepth: depth,
        awningColors: [fade(lin(awningColors[0], 0.95), 0.12 + 0.4 * U(11)), fade(lin(awningColors[1], 0.92), 0.1 + 0.3 * U(11))],
        signLit: U(8) < 0.5,
        glow: pickWeighted<SignGlow>([['white', 0.5], ['red', 0.15], ['green', 0.15], ['yellow', 0.1], ['blue', 0.1]], U(9)),
        projecting: false,
        doorR,
        doorW,
        yFloor,
        yOpen,
        stall: interior ? 'none' : trade === 'fish' ? 'fish' : trade === 'produce' ? 'produce' : trade === 'deli' || trade === 'nuts' ? 'deli' : 'none',
        seed: us,
        doorH: door ? door.height : 2.3,
        interior,
      });
    }
  }
  units.sort((x, y) => x.r0 - y.r0);
  // A projecting sign about every 8-10 m of frontage, on the pier right of a unit, clear of tall awnings.
  let lastSign = -Infinity;
  const tall = (u: ShopUnit | undefined): boolean => !!u && (u.awning === 'high' || u.awning === 'market');
  units.forEach((u, k) => {
    if (u.kind === 'shop' && u.r1 - lastSign > 7.5 && u.r1 - u.r0 > 2 && !tall(u) && !tall(units[k + 1])) {
      u.projecting = true;
      lastSign = u.r1;
    }
  });
  return units;
}

/** Sun-bleached fabric: towards a light, greyish tone of the same brightness family (red goes pink-brown). */
function fade(c: RGBA, t: number): RGBA {
  const lum = c[0] * 0.3 + c[1] * 0.55 + c[2] * 0.15;
  const bleached: RGBA = [lum * 1.25 + 0.06, lum * 1.18 + 0.05, lum * 1.1 + 0.05, c[3]];
  return mix(c, bleached, t);
}

export interface ShopEmitContext {
  lights: LightSink;
  place: (asset: string, position: XYZ, yaw: number, opts?: PlaceOptions) => InstanceRec;
  tile: string;
  /** Ground-floor cladding of the building's piers (the reveals follow it). */
  clad: { material: string; color: RGBA };
  /** Top of the ground floor band (first floor line). */
  G1: number;
  /** Interior depth available behind the glazing (m). */
  depthAt: (r: number) => number;
}

const RV = 0.3;
const KEPENK_BOX = 0.32;

/** Emits one unit (LOD0) into the batch of its façade; the wall hole [r0, r1] x [yFloor, yOpen] is the caller's. */
export function emitShopUnit(batch: Batch, u: ShopUnit, p: FacadePlan, c: ShopEmitContext): { lights: number; instances: number } {
  const f = batch.f;
  const U = (q: number): number => h01(u.seed, 40 + q);
  let lights = 0;
  let instances = 0;
  const { r0, r1, yFloor, yOpen } = u;
  // Reveals (cladding) and the soffit, darker towards the back.
  const cl = c.clad.color;
  const clIn = scale(cl, 0.72);
  batch.quadF(c.clad.material, 'R', [[r0, yFloor - 0.1, 0], [r0, yFloor - 0.1, -RV], [r0, yOpen, -RV], [r0, yOpen, 0]], [cl, clIn, clIn, cl]);
  batch.quadF(c.clad.material, '-R', [[r1, yFloor - 0.1, 0], [r1, yFloor - 0.1, -RV], [r1, yOpen, -RV], [r1, yOpen, 0]], [cl, clIn, clIn, cl]);
  batch.quadF(c.clad.material, '-Y', [[r0, yOpen, 0], [r1, yOpen, 0], [r1, yOpen, -RV], [r0, yOpen, -RV]], [cl, cl, clIn, clIn]);
  // Threshold step (terrazzo / marble).
  batch.box(u.kind === 'entrance' ? 'fac_marble' : 'fac_terrazzo', r0, r1, yFloor - 0.35, yFloor, -RV - 0.02, 0.03, lin(0x9c9890), { front: true, top: true });
  if (u.kind === 'entrance') {
    emitEntrance(batch, u, p);
    return { lights, instances };
  }
  const yBox = yOpen - KEPENK_BOX;
  const galv = u.kepenk === 'closed' && U(1) < 0.35 ? 'fac_kepenk_worn' : 'fac_kepenk';
  const kepenkTint = U(2) < 0.78 ? lin(0xe4e6e8) : lin(pick([0x6f8a7a, 0x7d8ea6, 0xa0724f, 0xc9b98f], U(3)));
  // Guide rails and the coil box at the top of the opening.
  batch.box('fac_kepenk', r0, r0 + 0.07, yFloor, yBox, -0.14, -0.05, kepenkTint, { front: true, right: true });
  batch.box('fac_kepenk', r1 - 0.07, r1, yFloor, yBox, -0.14, -0.05, kepenkTint, { front: true, left: true });
  batch.box(galv, r0, r1, yBox, yOpen, -RV, -0.03, kepenkTint, { front: true, bottom: true });
  const yK = u.kepenk === 'closed' ? yFloor : u.kepenk === 'half' ? yFloor + 1.15 + 0.7 * U(4) : yBox;
  if (yK < yBox - 0.01) {
    const wxK = (_r: number, y: number): Weather => [y < yFloor + 0.35 ? 0.7 : 0.2 + 0.2 * U(12), y > yBox - 0.5 ? 0.6 : 0.15, 0, y < yFloor + 0.2 ? 0.5 : 0];
    // Split at 0.35 m so the grime and splash at the foot have their own row of vertices.
    if (yK < yFloor + 0.34) {
      batch.quadF(galv, 'N', [[r0 + 0.035, yK, -0.09], [r1 - 0.035, yK, -0.09], [r1 - 0.035, yFloor + 0.35, -0.09], [r0 + 0.035, yFloor + 0.35, -0.09]], kepenkTint, undefined, wxK);
    }
    batch.quadF(galv, 'N', [[r0 + 0.035, Math.max(yK, yFloor + 0.35), -0.09], [r1 - 0.035, Math.max(yK, yFloor + 0.35), -0.09], [r1 - 0.035, yBox, -0.09], [r0 + 0.035, yBox, -0.09]], kepenkTint, undefined, wxK);
    batch.box('fac_kepenk', r0 + 0.035, r1 - 0.035, yK, yK + 0.06, -0.12, -0.08, scale(kepenkTint, 0.7), { front: true, bottom: true, top: true });
  }
  if (u.kepenk !== 'closed') {
    emitGlazing(batch, u, yBox, c, U);
  }
  if (u.kepenk !== 'closed' && !u.interior) {
    // Interior light (s1-strip.md §3: shop light spills 3-5 m onto the lane): about 2,200 lm per metre of frontage
    // (11,000 lm for a 5 m unit, 300-500 lx inside), a fill in the room and a spot behind the glass aimed out and
    // down through it; a half-open kepenk lets out half.
    const w = r1 - r0;
    const open = u.kepenk === 'half' ? 0.5 : 1;
    const food = u.trade === 'cafe' || u.trade === 'restaurant' || u.trade === 'fastfood' || u.trade === 'bakery' || u.trade === 'sweets';
    const kelvin = food ? pick([3000, 3500, 4000], U(5)) : pick([4000, 4500, 5000, 6000], U(5));
    const ref = `${c.tile}/shop:${u.poi ?? u.name?.name ?? ''}`;
    const depth = Math.max(1.2, Math.min(3.4, c.depthAt((r0 + r1) / 2) - 0.4));
    const [lx, lz] = f.xz((r0 + r1) / 2, -RV - depth * 0.55);
    c.lights.add({ type: 'point', position: [lx, yBox - 0.35, lz], kelvin, lumens: 950 * w * open, night: true, source: 'interior', ref });
    const [sx, sz] = f.xz((r0 + r1) / 2, -RV - 0.35);
    const dl = Math.hypot(1, 0.8);
    c.lights.add({ type: 'spot', position: [sx, yBox - 0.25, sz], direction: [f.nx / dl, -0.8 / dl, f.nz / dl], kelvin, lumens: 1250 * w * open, cone: { inner: 35, outer: 72 }, night: true, source: 'interior', ref });
    lights += 2;
  }
  // Sign band and awning.
  const awningLow = u.awning === 'low';
  const ySign0 = yOpen + (awningLow ? 0.32 : 0.1);
  const signTop = Math.min(c.G1 - 0.18, ySign0 + 0.95);
  const hS = signTop - ySign0;
  if (hS >= 0.24 && u.name) {
    emitSign(batch, u, ySign0, signTop, c, U);
    if (u.signLit) {
      const [sx, sz] = f.xz((r0 + r1) / 2, 0.8);
      c.lights.add({ type: 'point', position: [sx, (ySign0 + signTop) / 2, sz], kelvin: u.glow === 'white' ? 5000 : u.glow === 'red' ? 1900 : u.glow === 'yellow' ? 2600 : 6500, lumens: 350 + 250 * U(7), night: true, source: 'sign', ref: `${c.tile}/sign:${u.name.name}` });
      lights++;
    }
  }
  if (u.awning !== 'none') {
    let yMount = awningLow ? yOpen + 0.04 : u.awning === 'market' ? Math.min(c.G1 - 0.3, signTop + 0.1) : signTop + 0.08;
    if (yMount > c.G1 - 0.25) {
      yMount = yOpen + 0.04;
    }
    emitAwning(batch, u, yMount, Math.max(yFloor + 2.35, yMount - u.awningDepth * 0.42));
    if (u.awning === 'market') {
      lights += emitBulbs(batch, u, yMount, c, U);
    }
  }
  if (u.projecting && u.name) {
    emitProjectingSign(batch, u, Math.min(yOpen + 0.32, c.G1 - 0.75), U);
  }
  if (u.stall !== 'none') {
    const w = r1 - r0;
    const nStall = w > 4.2 ? 2 : 1;
    for (let k = 0; k < nStall; k++) {
      const rc = r0 + ((k + 0.5) * w) / nStall;
      if (Math.abs(rc - u.doorR) < 0.9 && nStall > 1) {
        continue;
      }
      const [x, z] = f.xz(rc, 0.15);
      const yaw = Math.atan2(f.nx, f.nz);
      c.place(u.stall === 'fish' ? 'fac_stall_fish' : 'fac_stall_produce', [x, yFloor - 0.06, z], yaw, { variant: u.stall === 'fish' ? (U(10 + k) < 0.5 ? 'ice' : 'ice_boxes') : u.stall === 'deli' ? 'deli' : 'produce', seed: Math.floor(U(20 + k) * 1000), ref: `${c.tile}/stall:${u.name?.name ?? ''}`, lights: false });
      instances++;
    }
  }
  return { lights, instances };
}

function emitGlazing(batch: Batch, u: ShopUnit, yTop: number, c: ShopEmitContext, U: (q: number) => number): void {
  const { r0, r1, yFloor } = u;
  const d = -RV;
  const alu = U(11) < 0.6 ? lin(0xb9bcbe) : lin(0x3b3e41);
  const fw = 0.06;
  const kick = yFloor + 0.3;
  const dl = u.doorR - u.doorW / 2;
  const dr = u.doorR + u.doorW / 2;
  const open = !!u.interior;
  const transom = Math.min(yTop - 0.3, open ? yFloor + u.doorH : yFloor + 2.2);
  // Frame: sill rail with kick panel (not across an open door), head rail, jamb posts, mullions every <= 1.6 m.
  for (const [a, b] of open ? [[r0, dl - fw], [dr + fw, r1]] : [[r0, r1]]) {
    if (b - a > 0.02) {
      batch.box('fac_alu', a, b, yFloor, kick, d, d + 0.06, alu, { front: true, top: true, left: open, right: open });
    }
  }
  batch.box('fac_alu', r0, r1, yTop - fw, yTop, d, d + 0.06, alu, { front: true, bottom: true });
  const posts = [r0, r1 - fw, dl - fw, dr];
  const addSegs = (a: number, b: number): void => {
    const n = Math.max(1, Math.ceil((b - a) / 1.6));
    for (let k = 1; k < n; k++) {
      posts.push(a + ((b - a) * k) / n - fw / 2);
    }
  };
  if (dl - fw - r0 > 0.3) {
    addSegs(r0 + fw, dl - fw);
  }
  if (r1 - fw - dr > 0.3) {
    addSegs(dr + fw, r1 - fw);
  }
  for (const x of posts) {
    if (x >= r0 - 1e-3 && x + fw <= r1 + 1e-3) {
      const y0 = x === dl - fw || x === dr ? yFloor : kick;
      batch.box('fac_alu', x, x + fw, y0, yTop - fw, d, d + 0.07, alu, { front: true, left: true, right: true });
    }
  }
  batch.box('fac_alu', dl, dr, transom, transom + fw, d, d + 0.07, alu, { front: true, top: true, bottom: true });
  const glass: RGBA = [0.26, 0.31, 0.34, 0.42];
  const pane = (a: number, b: number, y0: number, y1: number): void => {
    if (b - a > 0.02 && y1 - y0 > 0.02) {
      batch.quadF('fac_glass', 'N', [[a, y0, d + 0.03], [b, y0, d + 0.03], [b, y1, d + 0.03], [a, y1, d + 0.03]], glass);
    }
  };
  pane(r0, dl - fw, kick, yTop - fw);
  pane(dr + fw, r1, kick, yTop - fw);
  pane(dl, dr, transom + fw, yTop - fw);
  if (open) {
    // The interiors step emits the open leaf and the room behind; nothing more here.
    return;
  }
  // Door leaf: glass with a push bar.
  pane(dl, dr, yFloor, transom);
  batch.box('fac_alu', dl + 0.08, dr - 0.08, yFloor + 1.0, yFloor + 1.04, d + 0.07, d + 0.12, lin(0xd0d2d4), { front: true, top: true, bottom: true, left: true, right: true });
  // The room behind the glass, dressed by trade (interior.ts).
  const depth = Math.max(1.2, Math.min(3.4, c.depthAt((r0 + r1) / 2) - 0.4));
  emitShopInterior(batch, { r0, r1, yFloor, yTop, d, db: d - depth, trade: u.trade, seed: u.seed, doorR: u.doorR, doorW: u.doorW }, c.place, `${c.tile}/${u.name?.name ?? u.poi ?? ''}`);
}

function emitSign(batch: Batch, u: ShopUnit, y0: number, y1: number, c: ShopEmitContext, U: (q: number) => number): void {
  const f = batch.f;
  const s0 = u.r0 - 0.08;
  const s1 = u.r1 + 0.08;
  const dS = 0.14;
  const panels = [0xf2efe6, 0xe9dfc2, 0x1f4d3a, 0x1d3b66, 0x9e1f23, 0xd9a520, 0x1e1e1e, 0x4a4f55];
  const panelHex = pick(panels, U(21));
  const dark = [0x1f4d3a, 0x1d3b66, 0x9e1f23, 0x1e1e1e, 0x4a4f55].includes(panelHex);
  const panel = lin(panelHex);
  const wxS = (_r: number, y: number): Weather => [y < y0 + 0.05 ? 0.5 : 0.25, y < (y0 + y1) / 2 ? 0.45 : 0.1, 0.4, 0];
  batch.box('fac_sign', s0, s1, y0, y1, 0, dS, scale(panel, 0.9), { top: true, bottom: true, left: true, right: true }, wxS);
  if (u.signLit) {
    batch.quadF(`fac_glow_${u.glow}`, 'N', [[s0, y0, dS], [s1, y0, dS], [s1, y1, dS], [s0, y1, dS]], mix(lin(0xffffff), lin(SIGN_GLOW[u.glow]), 0.25));
  } else {
    batch.quadF('fac_sign', 'N', [[s0, y0, dS], [s1, y0, dS], [s1, y1, dS], [s0, y1, dS]], panel, undefined, wxS);
  }
  const name = u.name!;
  const w = s1 - s0 - 0.3;
  const hS = y1 - y0;
  let text = name.name;
  let capH = Math.min(0.42, hS * 0.56, w / Math.max(0.1, textWidth(text)));
  if (capH < 0.16) {
    text = name.short;
    capH = Math.min(0.42, hS * 0.56, w / Math.max(0.1, textWidth(text)));
  }
  if (capH < 0.1) {
    return;
  }
  const neon = !u.signLit && U(22) < 0.25;
  const letterColor = u.signLit ? lin(pick([0x9e1f23, 0x1d3b66, 0x1e1e1e, 0x1f4d3a], U(23))) : dark ? lin(pick([0xf6f2e8, 0xf2c94c], U(23))) : lin(pick([0x9e1f23, 0x1d3b66, 0x1e1e1e, 0x1f6b45], U(23)));
  const box = !u.signLit && capH >= 0.2;
  emitText(batch, text, {
    material: neon ? `fac_glow_${U(24) < 0.5 ? 'red' : 'green'}` : 'fac_letters',
    color: neon ? lin(0xffffff) : letterColor,
    r: (s0 + s1) / 2,
    y: (y0 + y1) / 2 - capH / 2,
    d: dS + (box ? 0.03 : 0.006),
    capH,
    depth: 0,
  });
  if (neon) {
    const [sx, sz] = f.xz((s0 + s1) / 2, 0.7);
    c.lights.add({ type: 'point', position: [sx, (y0 + y1) / 2, sz], kelvin: 2200, lumens: 250, night: true, source: 'sign', ref: `${c.tile}/neon:${text}` });
  }
}

function emitAwning(batch: Batch, u: ShopUnit, yMount: number, yFront: number): void {
  const f = batch.f;
  const a0 = u.r0 - 0.1;
  const a1 = u.r1 + 0.1;
  const D = u.awningDepth;
  const drop = yMount - yFront;
  // The canvas bellies between the roller and the front bar (old, stretched fabric), most in the middle of the width;
  // fixed market awnings sag more. The front bar itself droops a little at the unsupported middle.
  const sag = (u.awning === 'market' ? 0.07 : 0.035) + 0.05 * h01(u.seed, 78);
  const barDroop = 0.012 + 0.03 * h01(u.seed, 79);
  const tm = 0.55;
  const len = Math.hypot(D, drop);
  const nrm = f.vec(0, D / len, drop / len);
  const yMid = yMount + 0.02 + (yFront - yMount - 0.02) * tm;
  const nBack = f.vec(0, D * tm, drop * tm + sag * 0.7);
  const nFront = f.vec(0, D * (1 - tm), drop * (1 - tm) - sag * 0.7);
  // Roller box on the wall.
  batch.box('fac_alu', a0, a1, yMount, yMount + 0.16, 0, 0.18, lin(0xcfcfca), { front: true, top: true, bottom: true, left: true, right: true }, [0.4, 0.3, 0, 0]);
  const [ca, cb] = u.awningColors;
  const stripes = Math.abs(ca[0] - cb[0]) + Math.abs(ca[1] - cb[1]) + Math.abs(ca[2] - cb[2]) > 0.05;
  const sw = 0.26;
  const n = Math.max(1, Math.round((a1 - a0) / sw));
  const val = 0.22;
  // Weathering: dirt and soot build up towards the front edge and at the ends (rain runs off the front).
  const grime = 0.62 + 0.18 * h01(u.seed, 77);
  const wBack: Weather = [0.2, 0.25, 0, 0];
  const wMid: Weather = [0.35, 0.45, 0, 0];
  const wFront: Weather = [0.7, 0.3, 0, 0];
  const across = (xx: number): number => Math.sin(Math.PI * Math.min(1, Math.max(0, (xx - a0) / (a1 - a0))));
  for (let k = 0; k < n; k++) {
    const x0 = a0 + ((a1 - a0) * k) / n;
    const x1 = a0 + ((a1 - a0) * (k + 1)) / n;
    const col = stripes && k % 2 ? u.awningColors[1] : u.awningColors[0];
    const endDirt = (xx: number): number => 1 - 0.12 * Math.max(0, 1 - Math.min(xx - a0, a1 - xx) / 0.6);
    const back0 = scale(col, 0.97 * endDirt(x0));
    const back1 = scale(col, 0.97 * endDirt(x1));
    const mid0 = scale(col, (0.97 + grime) / 2 * endDirt(x0));
    const mid1 = scale(col, (0.97 + grime) / 2 * endDirt(x1));
    const front0 = scale(col, grime * endDirt(x0));
    const front1 = scale(col, grime * endDirt(x1));
    const s0 = sag * (0.45 + 0.55 * across(x0));
    const s1 = sag * (0.45 + 0.55 * across(x1));
    const f0 = yFront - barDroop * across(x0);
    const f1 = yFront - barDroop * across(x1);
    batch.poly('fac_awning', nBack, [f.p(x0, yMount + 0.02, 0.12), f.p(x1, yMount + 0.02, 0.12), f.p(x1, yMid - s1, D * tm), f.p(x0, yMid - s0, D * tm)], [back0, back1, mid1, mid0], undefined, [wBack, wBack, wMid, wMid]);
    batch.poly('fac_awning', nFront, [f.p(x0, yMid - s0, D * tm), f.p(x1, yMid - s1, D * tm), f.p(x1, f1, D), f.p(x0, f0, D)], [mid0, mid1, front1, front0], undefined, [wMid, wMid, wFront, wFront]);
    // Scalloped valance: the lower edge of each stripe is a shallow half-circle.
    const pts: [number, number, number][] = [[x0, f0, D]];
    for (let j = 0; j <= 6; j++) {
      const tt = j / 6;
      const yy = f0 + (f1 - f0) * tt;
      pts.push([x0 + (x1 - x0) * tt, yy - val + 0.06 - 0.06 * Math.sin(Math.PI * tt), D]);
    }
    pts.push([x1, f1, D]);
    const vc = scale(col, grime * 0.95);
    const wv: Weather = [0.75, 0.2, 0, 0];
    const fm = (f0 + f1) / 2;
    batch.quadF('fac_awning', 'N', [pts[0], pts[1], pts[4], [x0 + (x1 - x0) * 0.5, fm, D]], vc, undefined, wv);
    batch.quadF('fac_awning', 'N', [[x0 + (x1 - x0) * 0.5, fm, D], pts[4], pts[7], pts[8]], vc, undefined, wv);
    batch.quadF('fac_awning', 'N', [pts[1], pts[2], pts[3], pts[4]], vc, undefined, wv);
    batch.quadF('fac_awning', 'N', [pts[4], pts[5], pts[6], pts[7]], vc, undefined, wv);
  }
  void nrm;
  // Front bar and the folding arms.
  batch.box('fac_alu', a0, a1, yFront - 0.05, yFront, D - 0.05, D, lin(0xbfbfba), { bottom: true });
  for (const x of [a0 + 0.3, a1 - 0.35]) {
    batch.poly('fac_alu', f.vec(0, -drop / len, D / len), [f.p(x, yMount - 0.35, 0.05), f.p(x + 0.05, yMount - 0.35, 0.05), f.p(x + 0.05, yFront - 0.03, D - 0.1), f.p(x, yFront - 0.03, D - 0.1)], lin(0xb4b4ae));
  }
}

function emitBulbs(batch: Batch, u: ShopUnit, yMount: number, c: ShopEmitContext, U: (q: number) => number): number {
  const f = batch.f;
  const n = Math.max(1, Math.round((u.r1 - u.r0) / 1.8));
  let lights = 0;
  for (let k = 0; k < n; k++) {
    const r = u.r0 + ((k + 0.5) * (u.r1 - u.r0)) / n;
    const dd = Math.min(u.awningDepth * 0.55, 1.6);
    const yB = Math.max(u.yFloor + 2.2, yMount - dd * 0.42 - 0.35);
    batch.box('fac_metal', r - 0.004, r + 0.004, yB + 0.08, yMount - dd * 0.42 + 0.05, dd - 0.004, dd + 0.004, lin(0x202020), { front: true, left: true, right: true });
    batch.box('fac_bulb', r - 0.035, r + 0.035, yB, yB + 0.09, dd - 0.035, dd + 0.035, lin(0xffffff), { front: true, back: true, left: true, right: true, bottom: true });
    if (k % 2 === 0) {
      const [x, z] = f.xz(r, dd);
      c.lights.add({ type: 'point', position: [x, yB, z], kelvin: 2500, lumens: 500 + 200 * U(30 + k), night: true, source: 'other', ref: `${c.tile}/stall-bulb` });
      lights++;
    }
  }
  return lights;
}

function emitProjectingSign(batch: Batch, u: ShopUnit, y0: number, U: (q: number) => number): void {
  const f = batch.f;
  const rS = u.r1 + 0.2;
  const t = 0.05;
  const dIn = 0.2;
  const dOut = 0.85;
  const y1 = y0 + 0.5;
  const lit = U(40) < 0.6;
  const glow: SignGlow = pick<SignGlow>(['white', 'red', 'green', 'yellow', 'blue'], U(41));
  const panel = lin(pick([0xf2efe6, 0x1d3b66, 0x9e1f23, 0x1f4d3a], U(42)));
  // Bracket and the box.
  batch.box('fac_metal', rS - 0.015, rS + 0.015, y1, y1 + 0.03, 0, dOut, lin(0x2a2a2a), { top: true, bottom: true, left: true, right: true, front: true });
  batch.box('fac_sign', rS - t, rS + t, y0, y1, dIn, dOut, panel, { top: true, bottom: true, front: true });
  const faceMat = lit ? `fac_glow_${glow}` : 'fac_sign';
  const faceCol = lit ? lin(0xffffff) : panel;
  // Faces toward +r and -r, each with the short trade word in the face's own frame.
  for (const side of [1, -1]) {
    const rFace = rS + side * t;
    const axis = side > 0 ? 'R' : '-R';
    batch.quadF(faceMat, axis, [[rFace, y0, dIn], [rFace, y0, dOut], [rFace, y1, dOut], [rFace, y1, dIn]], faceCol);
    // Face frame: normal = side * R; "right" when facing it is -side * N.
    const [ox, oz] = f.xz(rFace, side > 0 ? dOut : dIn);
    const sub = new Frame(ox, oz, -side * f.nx, -side * f.nz, side * f.rx, side * f.rz, dOut - dIn);
    const word = u.name!.short;
    const capH = Math.min(0.2, (dOut - dIn - 0.12) / Math.max(0.1, textWidth(word)));
    if (capH >= 0.06) {
      const sb = new Batch(batch.mesh, sub);
      emitText(sb, word, { material: 'fac_letters', color: lit ? lin(0x1e1e1e) : lin(0xf6f2e8), r: (dOut - dIn) / 2, y: (y0 + y1) / 2 - capH / 2, d: 0.004, capH, depth: 0 });
      sb.flush();
    }
  }
}

function emitEntrance(batch: Batch, u: ShopUnit, p: FacadePlan): void {
  const U = (q: number): number => h01(u.seed, 60 + q);
  const { r0, r1, yFloor, yOpen } = u;
  const d = -RV;
  const doorTop = Math.min(yOpen - 0.45, yFloor + 2.3);
  const leaf = U(1) < 0.55 ? lin(pick([0x4b3526, 0x5e4330, 0x2f4a3a, 0x33373b], U(2))) : lin(0x3a3d40);
  const timber = U(1) < 0.55;
  // Door leaf with a glazed upper panel, the fanlight above and a frame.
  batch.quadF(timber ? 'fac_timber' : 'fac_alu', 'N', [[r0, yFloor, d], [r1, yFloor, d], [r1, doorTop, d], [r0, doorTop, d]], leaf);
  batch.quadF('fac_glass', 'N', [[r0 + 0.18, yFloor + 1.1, d + 0.02], [r1 - 0.18, yFloor + 1.1, d + 0.02], [r1 - 0.18, doorTop - 0.18, d + 0.02], [r0 + 0.18, doorTop - 0.18, d + 0.02]], [0.1, 0.12, 0.13, 0.7]);
  batch.box(timber ? 'fac_timber' : 'fac_alu', r0, r1, doorTop, doorTop + 0.07, d, d + 0.06, leaf, { front: true, bottom: true, top: true });
  batch.quadF('fac_glass', 'N', [[r0, doorTop + 0.07, d + 0.01], [r1, doorTop + 0.07, d + 0.01], [r1, yOpen, d + 0.01], [r0, yOpen, d + 0.01]], [0.08, 0.09, 0.1, 0.8]);
  batch.box('fac_metal', (r0 + r1) / 2 - 0.25, (r0 + r1) / 2 + 0.25, yFloor + 1.0, yFloor + 1.03, d, d + 0.06, lin(0xc9a44a), { front: true, top: true, bottom: true });
  // Intercom panel beside the door (a column of buttons with taped name labels) and a canopy slab above it.
  const ir = r1 + 0.08;
  batch.box('fac_alu', ir, ir + 0.22, yFloor + 1.2, yFloor + 1.55, 0, 0.03, lin(0x9a9c9e), { front: true, left: true, right: true, top: true, bottom: true }, [0.5, 0.2, 0.3, 0]);
  for (let k = 0; k < 5; k++) {
    const yb = yFloor + 1.24 + k * 0.058;
    batch.quadF('fac_paper', 'N', [[ir + 0.03, yb, 0.032], [ir + 0.15, yb, 0.032], [ir + 0.15, yb + 0.035, 0.032], [ir + 0.03, yb + 0.035, 0.032]], lin(pick([0xece6d6, 0xf2f0e8, 0xe0d4b0], U(10 + k))));
  }
  if (p.typ !== 'T2') {
    batch.slab('fac_concrete', r0 - 0.25, r1 + 0.25, yOpen + 0.12, yOpen + 0.24, 0, 0.75, lin(0xc6c2b9), 0.015, { front: true, top: true, bottom: true, left: true, right: true }, (_r, y) => [y > yOpen + 0.23 ? 0.8 : 0.4, 0.4, 0.7, 0]);
  }
  // Door number plate (İBB crimson with white digits) on the wall beside the door, at about 2.1 m.
  const num = String(1 + Math.floor(U(20) * 120));
  const pw = 0.12 + 0.05 * num.length;
  const pr = r0 - 0.12 - pw;
  const py = Math.min(yFloor + 2.05, yOpen - 0.2);
  if (pr > r0 - 1.2) {
    batch.box('fac_sign', pr, pr + pw, py, py + 0.15, 0, 0.012, lin(0x8e1b22), { front: true, left: true, right: true, top: true, bottom: true }, [0.3, 0.3, 0.4, 0]);
    emitText(batch, num, { material: 'fac_letters', color: lin(0xf4f0e6), r: pr + pw / 2, y: py + 0.035, d: 0.014, capH: 0.08, depth: 0 });
  }
  // The block's name ("… APARTMANI") in brass letters on a marble plaque over the door.
  const name = `${pick(APT_NAMES, U(21))} APT.`;
  const cap = Math.min(0.075, (r1 - r0 + 0.3) / Math.max(0.1, textWidth(name)));
  const plY = p.typ !== 'T2' ? yOpen + 0.3 : yOpen + 0.08;
  if (cap > 0.035 && plY + 0.2 < p.base + p.G - 0.1) {
    const pw2 = textWidth(name) * cap + 0.12;
    const pc = (r0 + r1) / 2;
    batch.box('fac_marble', pc - pw2 / 2, pc + pw2 / 2, plY, plY + cap + 0.08, 0, 0.02, lin(0xd8d4c8), { front: true, left: true, right: true, top: true, bottom: true }, [0.45, 0.4, 0.3, 0]);
    emitText(batch, name, { material: 'fac_letters', color: lin(0xa88a3a), r: pc, y: plY + 0.04, d: 0.022, capH: cap, depth: 0 });
  }
  // A taped note on about one door in three: a printed headline and hand-written lines.
  if (U(22) < 0.36) {
    const nr = r0 + 0.2 + (r1 - r0 - 0.5) * U(23);
    const ny = yFloor + 1.25 + 0.3 * U(24);
    const paper = lin(pick([0xf2f0ea, 0xece6c8, 0xf0e8e0], U(25)));
    batch.quadF('fac_paper', 'N', [[nr, ny, d + 0.025], [nr + 0.21, ny + 0.004, d + 0.025], [nr + 0.21, ny + 0.3, d + 0.025], [nr, ny + 0.296, d + 0.025]], paper);
    batch.quadF('fac_letters', 'N', [[nr + 0.03, ny + 0.225, d + 0.027], [nr + 0.18, ny + 0.225, d + 0.027], [nr + 0.18, ny + 0.245, d + 0.027], [nr + 0.03, ny + 0.245, d + 0.027]], lin(0x1c1c1c));
    for (let k = 0; k < 4; k++) {
      const ly = ny + 0.18 - k * 0.035;
      batch.quadF('fac_letters', 'N', [[nr + 0.025, ly, d + 0.027], [nr + 0.08 + 0.1 * U(27 + k), ly + 0.002, d + 0.027], [nr + 0.08 + 0.1 * U(27 + k), ly + 0.006, d + 0.027], [nr + 0.025, ly + 0.004, d + 0.027]], lin(0x2a3a7a));
    }
    // Tape strips at the top corners.
    for (const tr of [nr - 0.01, nr + 0.16]) {
      batch.quadF('fac_paper', 'N', [[tr, ny + 0.27, d + 0.028], [tr + 0.06, ny + 0.275, d + 0.028], [tr + 0.06, ny + 0.305, d + 0.028], [tr, ny + 0.3, d + 0.028]], lin(0xd8cfa8, 1, 1));
    }
  }
}

/** Fictional apartment block names (common Turkish words and given names; no real buildings on the strip). */
const APT_NAMES = ['YILDIZ', 'GÜNEŞ', 'ÇINAR', 'LALE', 'DENİZ', 'SEVİM', 'HUZUR', 'ÖZEN', 'NUR', 'ERGUN', 'KARDEŞLER', 'SÜMBÜL', 'AKASYA', 'MİNE', 'FEYZA', 'ESER'];
