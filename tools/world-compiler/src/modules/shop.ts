/**
 * Shop interior modules: what is seen through a shop window (shopfront/interior.ts), as slots. The room, the ceiling
 * lights, the dressing of the back plane (stocked shelves, clothes rails, a drinks fridge and a menu board, barber
 * chairs, a butcher's counter), the middle plane (café tables, a sweets vitrine, a gondola of goods), the window
 * display and the counter are modules; the stock is authored per bay (about a metre) in a few variants, so the
 * runtime varies it bay by bay. `shopInteriorSlots` makes the placement decisions interior.ts made and places the
 * staff member (a prop instance) as before.
 *
 * Module frames: shop.room, shop.lights and shop.display have their origin on the glazing plane at the floor (z < 0
 * is the room); the back-plane families at the back wall (z > 0 into the room); the middle-plane ones at the
 * gondola's centre line.
 */
import { type Batch, type Frame, h01, lin, pick } from '../facade/frame';
import type { InstanceRec, XYZ } from '../format';
import type { RGBA } from '../mesh';
import type { PlaceOptions } from '../registry';
import { textWidth } from '../shopfront/font';
import type { Trade } from '../shopfront/names';
import type { SlotSink } from './slots';
import type { AuthorCtx, FamilySpec, VariantSpec } from './spec';
import { emitTextSlot } from './text';

const g = (k: number): RGBA => [k, k, k, 1];
const W1: RGBA = [1, 1, 1, 1];
const INF = 1e3;

const GOODS = [0x8a4a3e, 0x4a5d72, 0xa88a4a, 0x56705a, 0x6a5a70, 0xcfc8ba, 0x3a3a3a, 0x9a7a5a, 0xc23b2e, 0x2f6fb0, 0xe0b53a, 0xf1ede4, 0x2e8a58];
const GARMENTS = [0x1c1c1e, 0x2b3a55, 0x7a1f24, 0xd8d4c8, 0x4a5a3a, 0x8a6a4a, 0xb8b2a6, 0x2f4a6e, 0xa24a2a, 0x6b6f75];
/** Stock variants authored per bay family: the runtime picks one per bay. */
const STOCK = 4;

type Item = 'box' | 'book' | 'shoe' | 'jar';

/** Shelving bay: back panel and boards (tint 0 = the shelf colour), rows of goods (their own colours). */
function shelfBay(item: Item, rows: number, seed: number) {
  return (c: AuthorCtx): void => {
    const { b, w: W, h: H } = c;
    const dep = 0.38;
    // Goods laid out at 1 m, then scaled to the bay (linear in w and h).
    const U = (k: number): number => h01(seed, k);
    c.tint(0, () => {
      b.box('fac_room', 0, W, 0, H, 0, 0.04, g(0.7), { front: true });
      for (let k = 0; k < rows; k++) {
        const ys = 0.2 + ((H - 0.25) * k) / rows;
        b.box('fac_room', 0, W, ys - 0.025, ys, 0, dep, W1, { front: true, top: true });
      }
    });
    for (let k = 0; k < rows; k++) {
      const ys = (hh: number): number => 0.2 + ((hh - 0.25) * k) / rows;
      const rowF = (item === 'book' ? 0.82 : item === 'shoe' ? 0.35 : 0.7) / rows;
      let x = 0.03;
      let n = 0;
      while (x < 1 - 0.06) {
        const u = U(300 + k * 41 + n);
        const iw = item === 'book' ? 0.025 + 0.03 * u : item === 'shoe' ? 0.28 : item === 'jar' ? 0.09 : 0.08 + 0.18 * u;
        const hf = item === 'book' ? 0.7 + 0.3 * U(500 + n + k * 7) : item === 'box' ? 0.55 + 0.45 * U(700 + n + k * 7) : 1;
        const col = lin(pick(GOODS, U(900 + k * 13 + n)), 0.75 + 0.35 * u);
        const x1 = Math.min(1 - 0.03, x + iw);
        const y0 = ys(H);
        const top = y0 + (H - 0.25) * rowF * hf;
        if (item === 'shoe') {
          const hs = y0 + (H - 0.25) * rowF * 0.6;
          b.box('fac_room', x * W, (x + 0.1) * W, y0, hs, 0.05, dep - 0.02, col, { front: true, top: true, left: true, right: true });
          b.box('fac_room', (x + 0.13) * W, (x + 0.23) * W, y0, hs, 0.05, dep - 0.02, col, { front: true, top: true, left: true, right: true });
        } else {
          b.box('fac_room', x * W, x1 * W, y0, top, 0.03, dep - (item === 'book' ? 0.06 : 0.02), col, { front: true, top: true, left: true, right: true });
        }
        x = x1 + (item === 'book' ? 0.004 : item === 'shoe' ? 0.08 : 0.015 + 0.02 * u);
        n++;
      }
    }
  };
}

/** Clothes rail bay: two rails of hanging garments (slabs seen edge-on). */
function railBay(seed: number) {
  return (c: AuthorCtx): void => {
    const { b, w: W } = c;
    for (const yr of [1.75, 1.05]) {
      b.box('fac_alu', 0, W, yr, yr + 0.03, 0.35, 0.38, lin(0xc9ccce), { front: true, bottom: true });
      let k = 0;
      for (let x = 0.05; x < 1 - 0.05; x += 0.07) {
        const col = lin(pick(GARMENTS, h01(seed, 1000 + k * 37 + yr)));
        const len = 0.55 + 0.35 * h01(seed, 1100 + k * 13 + yr);
        b.box('fac_room', x * W, (x + 0.045) * W, yr - len, yr - 0.02, 0.12, 0.6, col, { front: true, left: true, right: true, bottom: true });
        k++;
      }
    }
  };
}

/** Drinks fridge (0.8 m) with rows of bottles behind a lit door. */
function fridge(seed: number) {
  return (c: AuthorCtx): void => {
    const { b } = c;
    b.box('fac_room', 0, 0.8, 0, 1.95, 0, 0.6, lin(0xd8d8d8), { front: true, left: true, right: true, top: true });
    b.quadF('fac_ceiling_light', 'N', [[0.06, 0.3, 0.605], [0.74, 0.3, 0.605], [0.74, 1.8, 0.605], [0.06, 1.8, 0.605]], lin(0xe8f0f4, 0.35));
    for (let k = 0; k < 4; k++) {
      const yb = 0.38 + k * 0.37;
      let n = 0;
      for (let x = 0.1; x < 0.7; x += 0.075) {
        b.box('fac_room', x, x + 0.05, yb, yb + 0.22, 0.5, 0.56, lin(pick([0xc0201a, 0x1d5fa8, 0xe8c030, 0x2a8a3a, 0xe0e0dc], h01(seed, 1200 + k * 17 + n * 31))), { front: true });
        n++;
      }
    }
  };
}

/** Barber bay: mirror, shelf and a chair. */
function barberBay(c: AuthorCtx): void {
  const { b, w: W } = c;
  b.quadF('fac_glass', 'N', [[0, 0.9, 0.01], [W, 0.9, 0.01], [W, 2.0, 0.01], [0, 2.0, 0.01]], [0.55, 0.6, 0.62, 0.85]);
  b.box('fac_room', 0, W, 0.8, 0.86, 0, 0.35, lin(0xe6e2da), { front: true, top: true });
  const x = W * 0.43;
  b.box('fac_room', x - 0.3, x + 0.3, 0.4, 0.62, 0.6, 1.2, lin(0x2a2a2a), { front: true, top: true, left: true, right: true });
  b.box('fac_room', x - 0.3, x + 0.3, 0.62, 1.3, 0.6, 0.72, lin(0x2a2a2a), { front: true, top: true, left: true, right: true });
}

/** Butcher bay: the counter, cuts on it and the hook rail. */
function butcherBay(seed: number) {
  return (c: AuthorCtx): void => {
    const { b, w: W } = c;
    b.box('fac_room', 0, W, 0, 1.1, 0.5, 1.2, lin(0xdedad2), { front: true, top: true, left: true, right: true });
    for (let k = 0; k < 5; k++) {
      const x = (0.1 + k * 0.2) * W;
      b.box('fac_room', x, x + 0.16 * W, 1.1, 1.16, 0.6, 1.1, lin(pick([0x9a2a24, 0xb8483c, 0xe8d8c8], h01(seed, 1300 + k * 19))), { front: true, top: true });
    }
    b.box('fac_metal', 0, W, 2.05, 2.08, 0.1, 0.13, lin(0xb8bcbf), { front: true, bottom: true });
  };
}

/** Café table on a pedestal (origin at its centre). */
function table(c: AuthorCtx): void {
  const { b } = c;
  b.box('fac_room', -0.3, 0.3, 0.72, 0.75, -0.3, 0.3, lin(0xe8e4dc), { top: true, front: true, left: true, right: true, bottom: true });
  b.box('fac_room', -0.03, 0.03, 0, 0.72, -0.03, 0.03, lin(0x2a2a2a), { front: true, left: true, right: true });
}

/** Sweets vitrine bay: case, sloped glass, three trays. */
function vitrineBay(seed: number) {
  return (c: AuthorCtx): void => {
    const { b, w: W } = c;
    b.box('fac_room', 0, W, 0, 0.9, -0.35, 0.25, lin(0xd9d4ca), { front: true, top: true, left: true, right: true });
    b.quadF('fac_glass', 'N', [[0, 0.9, 0.25], [W, 0.9, 0.25], [W, 1.3, 0.1], [0, 1.3, 0.1]], [0.7, 0.75, 0.78, 0.3]);
    for (let k = 0; k < 3; k++) {
      const x = (0.05 + k * 0.33) * W;
      b.box('fac_room', x, x + 0.29 * W, 0.9, 0.95, -0.3, 0.15, lin(pick([0xc8962e, 0xe8b8c0, 0xf2ece0, 0x6a8a3a, 0x8a4a2a], h01(seed, 1400 + k * 23))), { front: true, top: true });
    }
  };
}

/** Gondola bay (tint 0 = the fixture colour) with goods or folded garments on top (h = its height). */
function gondolaBay(garments: boolean, seed: number) {
  return (c: AuthorCtx): void => {
    const { b, w: W, h: H } = c;
    c.tint(0, () => b.box('fac_room', 0, W, 0, H, -0.3, 0.3, g(0.9), { front: true, top: true, left: true, right: true }));
    let x = 0.05;
    let n = 0;
    while (x < 1 - 0.1) {
      const u = h01(seed, 1500 + n);
      const x1 = Math.min(1 - 0.05, x + 0.12 + 0.2 * u);
      b.box('fac_room', x * W, x1 * W, H, H + 0.06 + 0.2 * u, -0.2, 0.2, lin(pick(garments ? GARMENTS : GOODS, h01(seed, 1600 + n))), { front: true, top: true, left: true, right: true });
      x = x1 + 0.04;
      n++;
    }
  };
}

/** Window display bay behind the glass (tint 0 = the plinth), a few items on it (h = plinth height). */
function displayBay(kind: 'flat' | 'goods' | 'garments', seed: number) {
  return (c: AuthorCtx): void => {
    const { b, w: W, h: H } = c;
    c.tint(0, () => b.box('fac_room', 0, W, 0, H, -0.75, -0.08, W1, { front: true, top: true, left: true, right: true }));
    let k = 0;
    for (let x = 0.15; x < 0.9 - 0.2; x += 0.35 + 0.2 * h01(seed, 1700 + k)) {
      const hh = kind === 'flat' ? 0.05 : 0.12 + 0.25 * h01(seed, 1800 + k);
      b.box('fac_room', x * W, (x + 0.18) * W, H, H + hh, -0.55, -0.3, lin(pick(kind === 'garments' ? GARMENTS : GOODS, h01(seed, 1900 + k * 7))), { front: true, top: true, left: true, right: true });
      k++;
    }
  };
}

const stock = (id: string, ref: [number, number, number], make: (seed: number) => (c: AuthorCtx) => void, extra: Partial<VariantSpec> = {}): VariantSpec[] =>
  Array.from({ length: STOCK }, (_, k) => ({ id: `${id}-${k}`, ref, author: make(17.3 + k * 7.9 + id.length), ...extra }));

export const SHOP_FAMILIES: FamilySpec[] = [
  {
    name: 'shop.room',
    doc: 'Shop room behind the glazing (origin on the glazing at the floor; w, h the opening, d the depth): lit back and side walls (tint 0), terrazzo floor (tint 1), ceiling.',
    variants: [
      { id: 'shop', ref: [4, 2.6, 2.5], styles: ['shop'], author: (c) => room(c, false) },
      { id: 'butcher', ref: [4, 2.6, 2.5], styles: ['butcher'], author: (c) => room(c, true) },
    ],
  },
  {
    name: 'shop.lights',
    doc: 'LED ceiling panels, one per ~2.2 m of frontage, in one or two rows by the depth.',
    variants: [
      { id: 'one', ref: [2.2, 2.6, 1.6], fit: { d: [0.5, 2.0] }, repeat: { pitch: 2.2 }, author: (c) => lights(c, [0.5]) },
      { id: 'two', ref: [2.2, 2.6, 2.8], fit: { d: [2.0, INF] }, repeat: { pitch: 2.2 }, author: (c) => lights(c, [0.3, 0.75]) },
    ],
  },
  {
    name: 'shop.shelves',
    doc: 'Stocked wall shelving, per bay of about 1 m (origin at the back wall; h the shelving height; tint 0 the shelf). Styles: item and rows.',
    variants: [
      ...stock('box4', [1, 1.95, 0], (s) => shelfBay('box', 4, s), { styles: ['box4'] }),
      ...stock('jar4', [1, 1.95, 0], (s) => shelfBay('jar', 4, s), { styles: ['jar4'] }),
      ...stock('book4', [1, 1.95, 0], (s) => shelfBay('book', 4, s), { styles: ['book4'] }),
      ...stock('shoe4', [1, 1.95, 0], (s) => shelfBay('shoe', 4, s), { styles: ['shoe4'] }),
      ...stock('box5', [1, 1.7, 0], (s) => shelfBay('box', 5, s), { styles: ['box5'] }),
    ],
  },
  { name: 'shop.rail', doc: 'Clothes rails with hanging garments, per bay (origin at the back wall).', variants: stock('rail', [1, 0, 0], railBay) },
  { name: 'shop.fridge', doc: 'Drinks fridge with a lit door (0.8 m, origin at its left end on the back wall).', variants: stock('fridge', [0, 0, 0], fridge).slice(0, 2) },
  { name: 'shop.menu', doc: 'Menu board over the back counter (w its width; the lines are text slots).', variants: [{ id: 'board', ref: [1.5, 0, 0], author: (c) => c.b.box('fac_room', 0, c.w, 0, 0.5, 0, 0.03, lin(0x1e1e1e), { front: true }) }] },
  { name: 'shop.barber', doc: 'Barber mirror, shelf and chairs, a chair per ~1.4 m (origin at the back wall).', variants: [{ id: 'bays', ref: [1.4, 0, 0], repeat: { pitch: 1.4 }, author: barberBay }] },
  { name: 'shop.butcher', doc: "Butcher's counter with cuts and the hook rail, per ~1.1 m (origin at the back wall).", variants: stock('bay', [1.1, 0, 0], butcherBay, { repeat: { pitch: 1.1 } }).slice(0, 2) },
  { name: 'shop.table', doc: 'Café table (origin at its centre on the floor).', variants: [{ id: 'table', ref: [0, 0, 0], author: table }] },
  { name: 'shop.vitrine', doc: 'Sweets vitrine, three trays per ~1 m (origin on its centre line).', variants: stock('bay', [1.02, 0, 0], vitrineBay, { repeat: { pitch: 1.02 } }).slice(0, 2) },
  {
    name: 'shop.gondola',
    doc: 'Gondola or display table with goods (style goods) or folded garments (style garments) on top, per bay (origin on its centre line, h its height, tint 0 the fixture).',
    variants: [...stock('goods', [1, 1.1, 0], (s) => gondolaBay(false, s), { styles: ['goods'] }), ...stock('garments', [1, 0.8, 0], (s) => gondolaBay(true, s), { styles: ['garments'] })],
  },
  {
    name: 'shop.display',
    doc: 'Low window display behind the glass, per bay of ~0.9 m (origin on the glazing; h the plinth height; tint 0 the plinth).',
    variants: [
      ...stock('flat', [0.9, 0.9, 0], (s) => displayBay('flat', s), { styles: ['flat'] }),
      ...stock('goods', [0.9, 0.45, 0], (s) => displayBay('goods', s), { styles: ['goods'] }),
      ...stock('garments', [0.9, 0.45, 0], (s) => displayBay('garments', s), { styles: ['garments'] }),
    ],
  },
  {
    name: 'shop.counter',
    doc: 'Shop counter with a till (origin at its left front corner; w its width; tint 0 its colour).',
    variants: [
      {
        id: 'counter',
        ref: [1.2, 0, 0],
        author: (c) => {
          c.tint(0, () => c.b.box('fac_room', 0, c.w, 0, 1.0, 0, 0.55, W1, { front: true, top: true, left: true, right: true }));
          c.b.box('fac_room', 0.1, 0.4, 1.0, 1.12, 0.15, 0.4, lin(0x2a2a2a), { front: true, top: true, left: true, right: true });
        },
      },
    ],
  },
];

function room(c: AuthorCtx, butcher: boolean): void {
  const { b, w: W, h: H, d: D } = c;
  c.tint(0, () => {
    b.quadF(butcher ? 'fac_tiles' : 'fac_shop_lit', 'N', [[0, 0, -D], [W, 0, -D], [W, H, -D], [0, H, -D]], W1);
    b.quadF('fac_shop_lit', 'R', [[0, 0, 0], [0, 0, -D], [0, H, -D], [0, H, 0]], g(0.85));
    b.quadF('fac_shop_lit', '-R', [[W, 0, 0], [W, 0, -D], [W, H, -D], [W, H, 0]], g(0.85));
  });
  c.tint(1, () => b.quadF('fac_terrazzo', 'Y', [[0, 0.001, 0], [W, 0.001, 0], [W, 0.001, -D], [0, 0.001, -D]], W1));
  b.quadF('fac_room', '-Y', [[0, H, 0], [W, H, 0], [W, H, -D], [0, H, -D]], lin(0xd9d6d0));
}

function lights(c: AuthorCtx, rows: number[]): void {
  const { b, w: W, h: H, d: D } = c;
  const rc = W / 2;
  for (const t of rows) {
    const dc = -D * t;
    b.quadF('fac_ceiling_light', '-Y', [[rc - 0.3, H - 0.01, dc + 0.3], [rc + 0.3, H - 0.01, dc + 0.3], [rc + 0.3, H - 0.01, dc - 0.3], [rc - 0.3, H - 0.01, dc - 0.3]], W1);
  }
}

/* ------------------------------------------------------------------------------------------------------------- */
/* Placement (the decisions of shopfront/interior.ts emitShopInterior)                                            */
/* ------------------------------------------------------------------------------------------------------------- */

export interface ShopInteriorInput {
  r0: number;
  r1: number;
  yFloor: number;
  yTop: number;
  /** Glazing plane (d) and the back wall (db < d). */
  d: number;
  db: number;
  trade: Trade | null;
  seed: number;
  doorR: number;
  doorW: number;
}

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

/** Bays of about `pitch` metres over [a, b]: one slot each, so the runtime picks the stock per bay. */
function bays(a: number, b: number, pitch: number): [number, number][] {
  const n = Math.max(1, Math.round((b - a) / pitch));
  return Array.from({ length: n }, (_, k) => [a + ((b - a) * k) / n, a + ((b - a) * (k + 1)) / n]);
}

/** The shop room and its dressing as slots on frame `f`, and the staff member behind the counter (a prop). */
export function shopInteriorSlots(batch: Batch, slots: SlotSink, q: ShopInteriorInput, place: (asset: string, position: XYZ, yaw: number, opts?: PlaceOptions) => InstanceRec, ref: string): void {
  const f: Frame = batch.f;
  const U = (k: number): number => h01(q.seed, 200 + k);
  const S = (k: number): number => q.seed * 3.7 + k * 1.31;
  const { r0, r1, yFloor: y0, yTop: y1, d, db } = q;
  const kind = kindOf(q.trade);
  const depth = d - db;
  const w = r1 - r0;
  const wallC = kind === 'butcher' ? lin(0xe8e8e4) : lin(pick([0xd8d2c6, 0xc9bda8, 0xbfc6ca, 0xe0d2b2, 0xb8aea0, 0xe6e2da], U(1)));
  const floorC = lin(pick([0x8f8a82, 0xa8a49c, 0x6c6862], U(2)));
  slots.add(f, 'shop.room', { style: kind === 'butcher' ? 'butcher' : 'shop', seed: S(1), r: r0, y: y0, d, w, h: y1 - y0, dd: depth, tint0: wallC, tint1: floorC });
  slots.add(f, 'shop.lights', { seed: S(2), r: r0, y: y0, d, w, h: y1 - y0, dd: depth });
  const frameC = lin(pick([0x3a3a3a, 0x6a5a48, 0xd9d6d0, 0x8a8f94], U(3)));
  const clearDoor = (a: number, b: number): [number, number][] => {
    const dl = q.doorR - q.doorW / 2 - 0.15;
    const dr = q.doorR + q.doorW / 2 + 0.15;
    return ([[a, Math.min(b, dl)], [Math.max(a, dr), b]] as [number, number][]).filter(([p, s]) => s - p > 0.5);
  };
  // Back plane.
  const back = db + 0.02;
  if (kind === 'clothes') {
    bays(r0 + 0.15, r1 - 0.15, 1.0).forEach(([a, b], k) => slots.add(f, 'shop.rail', { seed: S(10 + k), r: a, y: y0, d: back, w: b - a }));
  } else if (kind === 'food') {
    const fr = U(4) < 0.5 ? r0 + 0.1 : r1 - 0.9;
    slots.add(f, 'shop.fridge', { seed: S(5), r: fr, y: y0, d: back });
    const m0 = fr > (r0 + r1) / 2 ? r0 + 0.2 : fr + 1.0;
    const m1 = fr > (r0 + r1) / 2 ? fr - 0.2 : r1 - 0.2;
    if (m1 - m0 > 0.8) {
      const yb = y1 - 0.75;
      slots.add(f, 'shop.menu', { seed: S(6), r: m0, y: yb, d: back, w: m1 - m0 });
      const lines = ['ÇAY 15', 'TOST 90', 'DÖNER 160', 'AYRAN 30'];
      for (let k = 0; k < 3; k++) {
        const txt = lines[(k + Math.floor(U(5) * 4)) % 4];
        const cw = Math.min(0.05, (m1 - m0 - 0.2) / Math.max(0.1, textWidth(txt)));
        emitTextSlot(batch, slots, txt, { material: 'fac_letters', color: lin(0xf4f0e2), r: (m0 + m1) / 2, y: yb + 0.36 - k * 0.13, d: back + 0.035, capH: cw, depth: 0 });
      }
    }
  } else if (kind === 'barber') {
    slots.add(f, 'shop.barber', { seed: S(7), r: r0 + 0.2, y: y0, d: back, w: w - 0.4 });
  } else if (kind === 'butcher') {
    slots.add(f, 'shop.butcher', { seed: S(8), r: r0 + 0.2, y: y0, d: back, w: w - 0.4 });
  } else {
    const item = kind === 'books' ? 'book' : kind === 'shoes' ? 'shoe' : kind === 'display' ? 'box' : U(6) < 0.3 ? 'jar' : 'box';
    const rows = kind === 'display' ? 5 : 4;
    const top = kind === 'display' ? 1.9 : 2.15;
    bays(r0 + 0.12, r1 - 0.12, 1.0).forEach(([a, b], k) => slots.add(f, 'shop.shelves', { style: `${item}${rows}`, seed: S(20 + k), r: a, y: y0, d: db, w: b - a, h: top, tint0: frameC }));
  }
  // Middle plane (only when the room is deep enough), kept clear of the door.
  const mid = d - Math.min(depth * 0.55, 1.7);
  if (depth > 1.6) {
    clearDoor(r0 + 0.25, r1 - 0.25).forEach(([a, b], j) => {
      if (kind === 'food') {
        let k = 0;
        for (let x = a + 0.35; x < b - 0.3; x += 1.1) {
          slots.add(f, 'shop.table', { seed: S(40 + j * 10 + k++), r: x, y: y0, d: mid });
        }
      } else if (kind === 'sweets') {
        slots.add(f, 'shop.vitrine', { seed: S(60 + j), r: a, y: y0, d: mid, w: b - a });
      } else if (kind !== 'barber' && kind !== 'butcher' && b - a > 0.5) {
        const style = kind === 'clothes' ? 'garments' : 'goods';
        bays(a + 0.2, b - 0.2, 1.0).forEach(([p, s], k) => slots.add(f, 'shop.gondola', { style, seed: S(70 + j * 20 + k), r: p, y: y0, d: mid, w: s - p, h: kind === 'clothes' ? 0.8 : 1.1, tint0: frameC }));
      }
    });
  }
  // Front plane: a low window display behind the glass.
  if (kind === 'clothes' || kind === 'shoes' || kind === 'display') {
    const plinth = lin(pick([0xe8e4dc, 0x2a2a2a, 0x8a6a4a], U(8)));
    const style = kind === 'display' ? 'flat' : kind === 'clothes' ? 'garments' : 'goods';
    clearDoor(r0 + 0.1, r1 - 0.1).forEach(([a, b], j) =>
      bays(a, b, 0.9).forEach(([p, s], k) => slots.add(f, 'shop.display', { style, seed: S(110 + j * 20 + k), r: p, y: y0, d, w: s - p, h: kind === 'display' ? 0.9 : 0.45, tint0: plinth })),
    );
  }
  // Counter (beside the door, towards the back) and the staff member behind it.
  const cr = U(19) < 0.5 ? r0 + 0.3 : Math.max(r0 + 0.3, r1 - 1.6);
  const cw = Math.min(1.3, r1 - 0.2 - cr);
  if (cw > 0.6 && depth > 1.3) {
    const cd0 = db + Math.min(0.9, depth * 0.35);
    const counterC = lin(pick([0x8a6a4a, 0xd8d4cc, 0x3c3c3c, 0x6a3a2a], U(20)));
    slots.add(f, 'shop.counter', { seed: S(9), r: cr, y: y0, d: cd0, w: cw, tint0: counterC });
    if (U(21) < 0.8 && cd0 - db > 0.45) {
      const [sx, sz] = f.xz(cr + cw / 2 + (U(22) - 0.5) * 0.3, (db + cd0) / 2);
      const yaw = Math.atan2(f.nx, f.nz);
      place('st_person', [sx, y0, sz], yaw, { variant: `standing${Math.floor(U(23) * 12)}`, scale: 0.94 + 0.1 * U(24), ref: `crowd/staff/${ref}` });
    }
  }
}
