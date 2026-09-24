/**
 * What is seen through a shop window (the glazed units of shopfront.ts without a compiled interior): a shallow room
 * with three depth planes dressed by trade, so a lit window reads as a shop and not a light panel (S1 critique: the
 * windows were flat white boxes, luminance spread 1.3/255):
 * - back plane: wall shelving with rows of goods (boxes, jars, book spines, shoe pairs), clothes rails with hanging
 *   garments, menu boards and a drinks fridge for food trades, mirrors for barbers, white tiles for butchers;
 * - middle plane: a gondola or display table of goods, café tables, a glass vitrine for sweets and bakeries;
 * - front plane: a low window display behind the glass (clothes, shoes, optician, jewellery, phones);
 * - a counter with a staff member (placeholder person, st_person) behind it, ceiling light panels (emissive, always
 *   on: shops are lit by day too) and, at night, the interior fill and a spill spot aimed out through the glass
 *   (shopfront.ts).
 * Colours are COLOR_0 on the façade materials (fac_room, fac_shop_lit, fac_ceiling_light, fac_glass).
 * Frame coordinates: r along the wall, y world height, d in front of the wall (the room lies at d < `d`).
 */
import type { RGBA } from '../mesh';
import { type Batch, h01, lin, pick, scale } from '../facade/frame';
import type { InstanceRec, XYZ } from '../format';
import type { PlaceOptions } from '../registry';
import { emitText, textWidth } from './font';
import type { Trade } from './names';

export interface InteriorInput {
  r0: number;
  r1: number;
  yFloor: number;
  yTop: number;
  /** Glazing plane (d) and the back wall (db < d). */
  d: number;
  db: number;
  trade: Trade | null;
  seed: number;
  /** Door centre and width (kept clear of dressing). */
  doorR: number;
  doorW: number;
}

const GOODS = [0x8a4a3e, 0x4a5d72, 0xa88a4a, 0x56705a, 0x6a5a70, 0xcfc8ba, 0x3a3a3a, 0x9a7a5a, 0xc23b2e, 0x2f6fb0, 0xe0b53a, 0xf1ede4, 0x2e8a58];
const GARMENTS = [0x1c1c1e, 0x2b3a55, 0x7a1f24, 0xd8d4c8, 0x4a5a3a, 0x8a6a4a, 0xb8b2a6, 0x2f4a6e, 0xa24a2a, 0x6b6f75];

type Kind = 'shelves' | 'books' | 'shoes' | 'clothes' | 'display' | 'food' | 'sweets' | 'barber' | 'butcher';

function kindOf(t: Trade | null): Kind {
  switch (t) {
    case 'books':
      return 'books';
    case 'shoes':
      return 'shoes';
    case 'clothes':
    case 'textiles':
      return 'clothes';
    case 'optician':
    case 'jewellery':
    case 'phone':
      return 'display';
    case 'cafe':
    case 'restaurant':
    case 'fastfood':
      return 'food';
    case 'sweets':
    case 'bakery':
      return 'sweets';
    case 'barber':
      return 'barber';
    case 'butcher':
    case 'fish':
      return 'butcher';
    default:
      return 'shelves';
  }
}

/** Emits the room and its dressing, and places the staff member behind the counter. */
export function emitShopInterior(batch: Batch, q: InteriorInput, place: (asset: string, position: XYZ, yaw: number, opts?: PlaceOptions) => InstanceRec, ref: string): void {
  const U = (k: number): number => h01(q.seed, 200 + k);
  const { r0, r1, yFloor: y0, yTop: y1, d, db } = q;
  const f = batch.f;
  const kind = kindOf(q.trade);
  const depth = d - db;
  const wallC = kind === 'butcher' ? lin(0xe8e8e4) : lin(pick([0xd8d2c6, 0xc9bda8, 0xbfc6ca, 0xe0d2b2, 0xb8aea0, 0xe6e2da], U(1)));
  // Room: back wall (lit), floor, ceiling, side walls.
  batch.quadF(kind === 'butcher' ? 'fac_tiles' : 'fac_shop_lit', 'N', [[r0, y0, db], [r1, y0, db], [r1, y1, db], [r0, y1, db]], wallC);
  batch.quadF('fac_terrazzo', 'Y', [[r0, y0 + 0.001, d], [r1, y0 + 0.001, d], [r1, y0 + 0.001, db], [r0, y0 + 0.001, db]], lin(pick([0x8f8a82, 0xa8a49c, 0x6c6862], U(2))));
  batch.quadF('fac_room', '-Y', [[r0, y1, d], [r1, y1, d], [r1, y1, db], [r0, y1, db]], lin(0xd9d6d0));
  batch.quadF('fac_shop_lit', 'R', [[r0, y0, d], [r0, y0, db], [r0, y1, db], [r0, y1, d]], scale(wallC, 0.85));
  batch.quadF('fac_shop_lit', '-R', [[r1, y0, d], [r1, y0, db], [r1, y1, db], [r1, y1, d]], scale(wallC, 0.85));
  // Ceiling light panels (LED, always on).
  const w = r1 - r0;
  const nPanels = Math.max(1, Math.round(w / 2.2));
  for (let k = 0; k < nPanels; k++) {
    const rc = r0 + ((k + 0.5) * w) / nPanels;
    for (const dc of depth > 2 ? [d - depth * 0.3, d - depth * 0.75] : [d - depth * 0.5]) {
      batch.quadF('fac_ceiling_light', '-Y', [[rc - 0.3, y1 - 0.01, dc + 0.3], [rc + 0.3, y1 - 0.01, dc + 0.3], [rc + 0.3, y1 - 0.01, dc - 0.3], [rc - 0.3, y1 - 0.01, dc - 0.3]], lin(0xffffff));
    }
  }
  const shelf = (a: number, b: number, dd: number, dep: number, top: number, rows: number, item: 'box' | 'book' | 'shoe' | 'jar', frameC: RGBA): void => {
    batch.box('fac_room', a, b, y0, top, dd, dd + 0.04, scale(frameC, 0.7), { front: true });
    for (let k = 0; k < rows; k++) {
      const ys = y0 + 0.2 + ((top - y0 - 0.25) * k) / rows;
      batch.box('fac_room', a, b, ys - 0.025, ys, dd, dd + dep, frameC, { front: true, top: true });
      const hRow = ((top - y0 - 0.25) / rows) * (item === 'book' ? 0.82 : item === 'shoe' ? 0.35 : 0.7);
      let x = a + 0.03;
      let n = 0;
      while (x < b - 0.06) {
        const u = h01(q.seed, 300 + k * 41 + n);
        const iw = item === 'book' ? 0.025 + 0.03 * u : item === 'shoe' ? 0.28 : item === 'jar' ? 0.09 : 0.08 + 0.18 * u;
        const ih = item === 'book' ? hRow * (0.7 + 0.3 * h01(q.seed, 500 + n)) : hRow * (item === 'box' ? 0.55 + 0.45 * h01(q.seed, 700 + n) : 1);
        const col = lin(pick(GOODS, h01(q.seed, 900 + k * 13 + n)), 0.75 + 0.35 * u);
        const x1 = Math.min(b - 0.03, x + iw);
        if (item === 'shoe') {
          // A pair: two low wedges.
          batch.box('fac_room', x, x + 0.1, ys, ys + ih * 0.6, dd + 0.05, dd + dep - 0.02, col, { front: true, top: true, left: true, right: true });
          batch.box('fac_room', x + 0.13, x + 0.23, ys, ys + ih * 0.6, dd + 0.05, dd + dep - 0.02, col, { front: true, top: true, left: true, right: true });
        } else {
          batch.box('fac_room', x, x1, ys, ys + ih, dd + 0.03, dd + dep - (item === 'book' ? 0.06 : 0.02), col, { front: true, top: true, left: true, right: true });
        }
        x = x1 + (item === 'book' ? 0.004 : item === 'shoe' ? 0.08 : 0.015 + 0.02 * u);
        n++;
      }
    }
  };
  const frameC = lin(pick([0x3a3a3a, 0x6a5a48, 0xd9d6d0, 0x8a8f94], U(3)));
  const clearDoor = (a: number, b: number): [number, number][] => {
    const dl = q.doorR - q.doorW / 2 - 0.15;
    const dr = q.doorR + q.doorW / 2 + 0.15;
    return ([[a, Math.min(b, dl)], [Math.max(a, dr), b]] as [number, number][]).filter(([p, s]) => s - p > 0.5);
  };
  // Back plane.
  const back = db + 0.02;
  if (kind === 'clothes') {
    // Rails of hanging garments along the back wall, garments facing the window (thin slabs seen edge-on in rows).
    for (const yr of [y0 + 1.75, y0 + 1.05]) {
      batch.box('fac_alu', r0 + 0.15, r1 - 0.15, yr, yr + 0.03, back + 0.35, back + 0.38, lin(0xc9ccce), { front: true, bottom: true });
      for (let x = r0 + 0.2; x < r1 - 0.2; x += 0.07) {
        const col = lin(pick(GARMENTS, h01(q.seed, 1000 + x * 37 + yr)));
        const len = 0.55 + 0.35 * h01(q.seed, 1100 + x * 13);
        batch.box('fac_room', x, x + 0.045, yr - len, yr - 0.02, back + 0.12, back + 0.6, col, { front: true, left: true, right: true, bottom: true });
      }
    }
  } else if (kind === 'food') {
    // Drinks fridge on one side, menu boards over the back counter.
    const fr = U(4) < 0.5 ? r0 + 0.1 : r1 - 0.9;
    batch.box('fac_room', fr, fr + 0.8, y0, y0 + 1.95, back, back + 0.6, lin(0xd8d8d8), { front: true, left: true, right: true, top: true });
    batch.quadF('fac_ceiling_light', 'N', [[fr + 0.06, y0 + 0.3, back + 0.605], [fr + 0.74, y0 + 0.3, back + 0.605], [fr + 0.74, y0 + 1.8, back + 0.605], [fr + 0.06, y0 + 1.8, back + 0.605]], lin(0xe8f0f4, 0.35));
    for (let k = 0; k < 4; k++) {
      const yb = y0 + 0.38 + k * 0.37;
      for (let x = fr + 0.1; x < fr + 0.7; x += 0.075) {
        batch.box('fac_room', x, x + 0.05, yb, yb + 0.22, back + 0.5, back + 0.56, lin(pick([0xc0201a, 0x1d5fa8, 0xe8c030, 0x2a8a3a, 0xe0e0dc], h01(q.seed, 1200 + k * 17 + x * 31))), { front: true });
      }
    }
    const m0 = fr > (r0 + r1) / 2 ? r0 + 0.2 : fr + 1.0;
    const m1 = fr > (r0 + r1) / 2 ? fr - 0.2 : r1 - 0.2;
    if (m1 - m0 > 0.8) {
      const yb = y1 - 0.75;
      batch.box('fac_room', m0, m1, yb, yb + 0.5, back, back + 0.03, lin(0x1e1e1e), { front: true });
      const lines = ['ÇAY 15', 'TOST 90', 'DÖNER 160', 'AYRAN 30'];
      const cap = 0.05;
      for (let k = 0; k < 3; k++) {
        const txt = lines[(k + Math.floor(U(5) * 4)) % 4];
        const cw = Math.min(cap, (m1 - m0 - 0.2) / Math.max(0.1, textWidth(txt)));
        emitText(batch, txt, { material: 'fac_letters', color: lin(0xf4f0e2), r: (m0 + m1) / 2, y: yb + 0.36 - k * 0.13, d: back + 0.035, capH: cw, depth: 0 });
      }
    }
  } else if (kind === 'barber') {
    batch.quadF('fac_glass', 'N', [[r0 + 0.2, y0 + 0.9, back + 0.01], [r1 - 0.2, y0 + 0.9, back + 0.01], [r1 - 0.2, y0 + 2.0, back + 0.01], [r0 + 0.2, y0 + 2.0, back + 0.01]], [0.55, 0.6, 0.62, 0.85]);
    batch.box('fac_room', r0 + 0.2, r1 - 0.2, y0 + 0.8, y0 + 0.86, back, back + 0.35, lin(0xe6e2da), { front: true, top: true });
    for (let x = r0 + 0.8; x < r1 - 0.6; x += 1.4) {
      batch.box('fac_room', x - 0.3, x + 0.3, y0 + 0.4, y0 + 0.62, back + 0.6, back + 1.2, lin(0x2a2a2a), { front: true, top: true, left: true, right: true });
      batch.box('fac_room', x - 0.3, x + 0.3, y0 + 0.62, y0 + 1.3, back + 0.6, back + 0.72, lin(0x2a2a2a), { front: true, top: true, left: true, right: true });
    }
  } else if (kind === 'butcher') {
    batch.box('fac_room', r0 + 0.2, r1 - 0.2, y0, y0 + 1.1, back + 0.5, back + 1.2, lin(0xdedad2), { front: true, top: true, left: true, right: true });
    for (let x = r0 + 0.3; x < r1 - 0.35; x += 0.22) {
      batch.box('fac_room', x, x + 0.16, y0 + 1.1, y0 + 1.16, back + 0.6, back + 1.1, lin(pick([0x9a2a24, 0xb8483c, 0xe8d8c8], h01(q.seed, 1300 + x * 19))), { front: true, top: true });
    }
    batch.box('fac_metal', r0 + 0.2, r1 - 0.2, y0 + 2.05, y0 + 2.08, back + 0.1, back + 0.13, lin(0xb8bcbf), { front: true, bottom: true });
  } else {
    const item = kind === 'books' ? 'book' : kind === 'shoes' ? 'shoe' : kind === 'display' ? 'box' : U(6) < 0.3 ? 'jar' : 'box';
    shelf(r0 + 0.12, r1 - 0.12, db, 0.38, y0 + (kind === 'display' ? 1.9 : 2.15), kind === 'display' ? 5 : 4, item, frameC);
  }
  // Middle plane (only when the room is deep enough), kept clear of the door.
  const mid = d - Math.min(depth * 0.55, 1.7);
  if (depth > 1.6) {
    for (const [a, b] of clearDoor(r0 + 0.25, r1 - 0.25)) {
      if (kind === 'food') {
        for (let x = a + 0.35; x < b - 0.3; x += 1.1) {
          batch.box('fac_room', x - 0.3, x + 0.3, y0 + 0.72, y0 + 0.75, mid - 0.3, mid + 0.3, lin(0xe8e4dc), { top: true, front: true, left: true, right: true, bottom: true });
          batch.box('fac_room', x - 0.03, x + 0.03, y0, y0 + 0.72, mid - 0.03, mid + 0.03, lin(0x2a2a2a), { front: true, left: true, right: true });
        }
      } else if (kind === 'sweets') {
        batch.box('fac_room', a, b, y0, y0 + 0.9, mid - 0.35, mid + 0.25, lin(0xd9d4ca), { front: true, top: true, left: true, right: true });
        batch.quadF('fac_glass', 'N', [[a, y0 + 0.9, mid + 0.25], [b, y0 + 0.9, mid + 0.25], [b, y0 + 1.3, mid + 0.1], [a, y0 + 1.3, mid + 0.1]], [0.7, 0.75, 0.78, 0.3]);
        for (let x = a + 0.05; x < b - 0.3; x += 0.34) {
          batch.box('fac_room', x, x + 0.3, y0 + 0.9, y0 + 0.95, mid - 0.3, mid + 0.15, lin(pick([0xc8962e, 0xe8b8c0, 0xf2ece0, 0x6a8a3a, 0x8a4a2a], h01(q.seed, 1400 + x * 23))), { front: true, top: true });
        }
      } else if (kind !== 'barber' && kind !== 'butcher') {
        // Gondola / display table with goods on top.
        const top = kind === 'clothes' ? y0 + 0.8 : y0 + 1.1;
        batch.box('fac_room', a + 0.2, b - 0.2, y0, top, mid - 0.3, mid + 0.3, scale(frameC, 0.9), { front: true, top: true, left: true, right: true });
        let x = a + 0.25;
        let n = 0;
        while (x < b - 0.3) {
          const u = h01(q.seed, 1500 + n);
          const x1 = Math.min(b - 0.25, x + 0.12 + 0.2 * u);
          batch.box('fac_room', x, x1, top, top + 0.06 + 0.2 * u, mid - 0.2, mid + 0.2, lin(pick(kind === 'clothes' ? GARMENTS : GOODS, h01(q.seed, 1600 + n))), { front: true, top: true, left: true, right: true });
          x = x1 + 0.04;
          n++;
        }
      }
    }
  }
  // Front plane: a low window display behind the glass.
  if (kind === 'clothes' || kind === 'shoes' || kind === 'display') {
    for (const [a, b] of clearDoor(r0 + 0.1, r1 - 0.1)) {
      const top = y0 + (kind === 'display' ? 0.9 : 0.45);
      batch.box('fac_room', a, b, y0, top, d - 0.75, d - 0.08, lin(pick([0xe8e4dc, 0x2a2a2a, 0x8a6a4a], U(8))), { front: true, top: true, left: true, right: true });
      for (let x = a + 0.15; x < b - 0.2; x += 0.35 + 0.2 * h01(q.seed, 1700 + x)) {
        const hh = kind === 'display' ? 0.05 : 0.12 + 0.25 * h01(q.seed, 1800 + x);
        batch.box('fac_room', x, x + 0.18, top, top + hh, d - 0.55, d - 0.3, lin(pick(kind === 'clothes' ? GARMENTS : GOODS, h01(q.seed, 1900 + x * 7))), { front: true, top: true, left: true, right: true });
      }
    }
  }
  // Counter (beside the door, towards the back) and the staff member behind it.
  const cr = U(19) < 0.5 ? r0 + 0.3 : Math.max(r0 + 0.3, r1 - 1.6);
  const cw = Math.min(1.3, r1 - 0.2 - cr);
  if (cw > 0.6 && depth > 1.3) {
    const cd0 = db + Math.min(0.9, depth * 0.35);
    const cd1 = cd0 + 0.55;
    const counterC = lin(pick([0x8a6a4a, 0xd8d4cc, 0x3c3c3c, 0x6a3a2a], U(20)));
    batch.box('fac_room', cr, cr + cw, y0, y0 + 1.0, cd0, cd1, counterC, { front: true, top: true, left: true, right: true });
    batch.box('fac_room', cr + 0.1, cr + 0.4, y0 + 1.0, y0 + 1.12, cd0 + 0.15, cd0 + 0.4, lin(0x2a2a2a), { front: true, top: true, left: true, right: true });
    if (U(21) < 0.8 && cd0 - db > 0.45) {
      const [sx, sz] = f.xz(cr + cw / 2 + (U(22) - 0.5) * 0.3, (db + cd0) / 2);
      const yaw = Math.atan2(f.nx, f.nz);
      place('st_person', [sx, y0, sz], yaw, { variant: `standing${Math.floor(U(23) * 12)}`, scale: 0.94 + 0.1 * U(24), ref: `crowd/staff/${ref}` });
    }
  }
}
