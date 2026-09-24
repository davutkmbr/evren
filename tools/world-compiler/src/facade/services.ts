/**
 * Façade life (format 1, full-detail tiles): the things residents and utilities hang on a Kadıköy façade
 * (.docs/street/kadikoy-soul.md §18, §32, §33, §36–38), emitted into the façade's batch after the wall:
 *
 * - services: a yellow gas riser per building with its meter box, branches along each floor into the kitchens;
 *   a telecom junction box with a coil of spare cable and a TV cable dropping to a balcony; hairline cracks
 *   radiating from window corners on old render;
 * - balconies: laundry on pulley lines outside the railing (30–50 %), cat-safety nets (5–10 %), herbs in olive-oil
 *   tins, yogurt buckets and clay pots (on balconies and sills), plain yellow-and-navy flags (no crest);
 * - KİRALIK / SATILIK vinyl banners zip-tied to railings or taped inside windows, with numbers that cannot be dialled
 *   (area code 000).
 *
 * All deterministic (hash of the building seed and the edge), all geometry in the façade frame (facade/frame.ts).
 */
import type { Weather } from '../mesh';
import { emitText, textWidth } from '../shopfront/font';
import type { ShopUnit } from '../shopfront/shopfront';
import type { Balcony, Cikma, Ctx2, Edge, Rect, Win } from './build';
import { type Batch, h01, lin, pick, scale } from './frame';

export interface LifeInput {
  wins: readonly Win[];
  units: readonly ShopUnit[];
  balconies: readonly Balcony[];
  ck: Cikma | null;
  /** The wall rectangle of the edge (after corner chamfers). */
  R: Rect;
}

export function facadeLife(x: Ctx2, e: Edge, b: Batch, inp: LifeInput): void {
  const H = (k: number): number => h01(x.p.seed + e.i * 29.3, 2000 + k);
  if (x.p.typ !== 'T5' && x.p.storeys >= 2) {
    if (e.i === x.mainEdge || (x.mainEdge < 0 && e.kind === 'open' && H(1) < 0.5)) {
      gasRiser(x, e, b, inp, H);
    }
    if (e.kind === 'street' && H(2) < 0.7) {
      junctionBox(x, e, b, inp, H);
    }
  }
  inp.balconies.forEach((bal, k) => balconyLife(x, e, b, bal, k, H));
  dishes(x, e, inp, H);
  sillPlants(x, e, b, inp.wins, H);
  if (x.p.typ !== 'T3') {
    windowCracks(x, e, b, inp.wins, H);
  }
  if (e.kind === 'street') {
    banners(x, e, b, inp, H);
  }
}

/* ------------------------------------------------------------------------------------------------------------- */

const clear = (inp: LifeInput, r: number, pad: number, y0 = -Infinity, y1 = Infinity): boolean =>
  !inp.wins.some((w) => r > w.r0 - pad && r < w.r1 + pad && w.y1 + w.box > y0 && w.y0 < y1) && !(inp.ck && r > inp.ck.c0 - pad && r < inp.ck.c1 + pad && y1 > inp.ck.y0);

/** A yellow steel gas riser: meter box by the entrance, the pipe up the façade and a branch into each floor. */
function gasRiser(x: Ctx2, e: Edge, b: Batch, inp: LifeInput, H: (k: number) => number): void {
  const { p } = x;
  const entrance = inp.units.find((u) => u.kind === 'entrance');
  const cands: number[] = [inp.R.r0 + 0.22, inp.R.r1 - 0.22];
  const sorted = [...inp.wins].filter((w) => w.floor >= 1).sort((a, c) => a.r0 - c.r0);
  for (let k = 0; k + 1 < sorted.length; k++) {
    if (sorted[k + 1].r0 - sorted[k].r1 > 0.5) {
      cands.push((sorted[k].r1 + sorted[k + 1].r0) / 2);
    }
  }
  const target = entrance ? (entrance.r0 + entrance.r1) / 2 : e.len * H(3);
  const ok = cands.filter((r) => r > 0.15 && r < e.len - 0.15 && clear(inp, r, 0.12, x.G1, x.wallTop) && !inp.units.some((u) => u.kind === 'shop' && r > u.r0 - 0.05 && r < u.r1 + 0.05));
  if (!ok.length) {
    return;
  }
  const rp = ok.sort((a, c) => Math.abs(a - target) - Math.abs(c - target))[0];
  const yellow = scale(lin(pick([0xc9a33a, 0xd1ad45, 0xb8963a], H(4))), 0.92);
  const g = e.gAt(rp);
  const d0 = 0.035;
  const hw = 0.019;
  const wx: Weather = [0.35 + 0.3 * p.wear, 0.2, 0.3, 0];
  const top = x.floorY(p.storeys - 1) + 2.7;
  const pipe = (ra: number, rb: number, ya: number, yb: number): void => b.box('fac_metal', ra, rb, ya, yb, d0, d0 + 2 * hw, yellow, { front: true, left: true, right: true }, wx);
  // Meter box (grey steel, 0.4 x 0.5 m) at 1.0-1.5 m, beside the riser.
  const mr = rp + (rp < e.len / 2 ? 0.08 : -0.48);
  if (clear(inp, mr + 0.2, 0.25, g + 0.9, g + 1.6) && !inp.units.some((u) => u.kind === 'shop' && mr + 0.4 > u.r0 && mr < u.r1)) {
    const mc = lin(pick([0x9a9c98, 0xb4b3ad, 0x8a8f8c], H(5)));
    b.box('fac_metal', mr, mr + 0.4, g + 1.0, g + 1.5, 0, 0.22, mc, { front: true, left: true, right: true, top: true, bottom: true }, [0.5, 0.3, 0.2, 0]);
    b.box('fac_metal', mr + 0.03, mr + 0.37, g + 1.03, g + 1.47, 0.22, 0.225, scale(mc, 0.85), { front: true }, [0.4, 0.2, 0, 0]);
    pipe(rp - hw, rp + hw, g + 0.2, g + 1.0);
  }
  pipe(rp - hw, rp + hw, g + 1.5, top);
  // Brackets every 3 m.
  for (let y = g + 2.2; y < top - 0.2; y += 3) {
    b.box('fac_metal', rp - hw - 0.012, rp + hw + 0.012, y, y + 0.03, 0, d0 + 2 * hw + 0.008, scale(yellow, 0.7), { front: true, left: true, right: true }, [0.7, 0.3, 0, 0]);
  }
  // One branch per upper floor, just under the next slab, towards the nearest window side (the kitchen).
  for (let k = 1; k < p.storeys; k++) {
    const fy = x.floorY(k);
    const yb = Math.min(x.floorY(k + 1) - 0.28, fy + 2.72);
    const dir = H(10 + k) < 0.5 ? -1 : 1;
    const run = 0.5 + 1.4 * H(20 + k);
    const ra = dir < 0 ? Math.max(inp.R.r0 + 0.1, rp - run) : rp;
    const rb = dir < 0 ? rp : Math.min(inp.R.r1 - 0.1, rp + run);
    if (rb - ra > 0.2 && clear(inp, (ra + rb) / 2, 0, yb - 0.05, yb + 0.05) && !inp.wins.some((w) => ra < w.r1 && rb > w.r0 && w.y1 + w.box > yb - 0.03 && w.y0 < yb + 0.05)) {
      b.box('fac_metal', ra, rb, yb - hw, yb + hw, d0, d0 + 2 * hw, yellow, { front: true, top: true, bottom: true }, wx);
    }
  }
}

/** A grey telecom junction box under the eaves with a coil of spare cable, and one TV cable down to a balcony. */
function junctionBox(x: Ctx2, e: Edge, b: Batch, inp: LifeInput, H: (k: number) => number): void {
  const yj = x.p.roofY - 0.9 - 0.8 * H(30);
  let rj = inp.R.r0 + 0.3 + (inp.R.r1 - inp.R.r0 - 0.6) * H(31);
  for (let k = 0; k < 6 && !clear(inp, rj, 0.3, yj - 0.9, yj + 0.4); k++) {
    rj = inp.R.r0 + 0.3 + (inp.R.r1 - inp.R.r0 - 0.6) * H(32 + k);
  }
  if (!clear(inp, rj, 0.3, yj - 0.9, yj + 0.4)) {
    return;
  }
  const grey = lin(pick([0xb9b8b2, 0x8e918f, 0xd0cec6], H(40)));
  b.box('fac_metal', rj - 0.13, rj + 0.13, yj - 0.18, yj + 0.18, 0, 0.1, grey, { front: true, left: true, right: true, top: true, bottom: true }, [0.6, 0.5, 0.2, 0]);
  // The coil: a loop of black cable hanging under the box (eight segments), and the cable up to the bundle.
  const black = lin(0x151515);
  const cy = yj - 0.45;
  const rad = 0.16 + 0.05 * H(41);
  const seg = 8;
  for (let k = 0; k < seg; k++) {
    const a0 = (k / seg) * Math.PI * 2;
    const a1 = ((k + 1) / seg) * Math.PI * 2;
    const p0: [number, number] = [rj + Math.cos(a0) * rad, cy + Math.sin(a0) * rad * 1.25];
    const p1: [number, number] = [rj + Math.cos(a1) * rad, cy + Math.sin(a1) * rad * 1.25];
    line(b, p0[0], p0[1], p1[0], p1[1], 0.06, 0.009, black);
  }
  line(b, rj, yj - 0.18, rj, cy + rad * 1.25, 0.06, 0.009, black);
  b.box('fac_metal', rj - 0.006, rj + 0.006, yj + 0.18, x.p.roofY - 0.28, 0.03, 0.045, black, { front: true, left: true, right: true });
  // TV cable: from the box diagonally down to a balcony or window of this façade.
  const bal = inp.balconies.length ? inp.balconies[Math.floor(H(42) * inp.balconies.length)] : undefined;
  const win = inp.wins.find((w) => w.floor >= 1);
  const to = bal ? { r: bal.r0 + 0.2, y: bal.top - 0.05 } : win ? { r: win.r0 - 0.05, y: win.y1 } : null;
  if (to) {
    const tr = to.r;
    const ty = to.y;
    if (ty < yj - 0.3) {
      line(b, rj - 0.1, yj - 0.1, tr, ty, 0.04, 0.007, lin(0x1c1c1c));
    }
  }
}

/** A straight cable / thin bar in the wall plane from (ra, ya) to (rb, yb), `w` wide, at depth d (front face only). */
function line(b: Batch, ra: number, ya: number, rb: number, yb: number, d: number, w: number, col: ReturnType<typeof lin>): void {
  const l = Math.hypot(rb - ra, yb - ya) || 1;
  const nr = (-(yb - ya) / l) * (w / 2);
  const ny = ((rb - ra) / l) * (w / 2);
  b.quadF('fac_metal', 'N', [[ra - nr, ya - ny, d], [rb - nr, yb - ny, d], [rb + nr, yb + ny, d], [ra + nr, ya + ny, d]], col);
}

/* ------------------------------------------------------------------------------------------------------------- */
/* Balconies                                                                                                       */
/* ------------------------------------------------------------------------------------------------------------- */

const CLOTH = [0xf0ede4, 0xe8e4da, 0xf2f0ea, 0x3b5a8a, 0x2a3f66, 0xc23a3a, 0xe0b84a, 0x6fa0c8, 0xd98fa0, 0x5f7a4a, 0x2a2a2a, 0xe8d6b8, 0xa0a4a8, 0xf0e0d0];

function balconyLife(x: Ctx2, e: Edge, b: Batch, bal: Balcony, k: number, Hb: (k: number) => number): void {
  const H = (q: number): number => Hb(100 + k * 37 + q);
  const w = bal.r1 - bal.r0;
  if (!bal.open || w < 0.9) {
    // A glazed-in balcony: at most a flag or a plant behind the glass.
    return;
  }
  const net = H(1) < 0.08;
  const laundry = !net && H(2) < 0.42;
  if (net) {
    // Cat-safety net from the railing to the slab above, across the front and both ends (a dark translucent mesh).
    const y0 = bal.top - 0.02;
    const y1 = Math.min(bal.ceiling, bal.top + 1.9);
    const c: [number, number, number, number] = [0.04, 0.045, 0.045, 0.42];
    const d = bal.P - 0.01;
    b.quadF('fac_net', 'N', [[bal.r0, y0, d], [bal.r1, y0, d], [bal.r1, y1, d], [bal.r0, y1, d]], c);
    b.quadF('fac_net', '-R', [[bal.r0 + 0.01, y0, 0], [bal.r0 + 0.01, y0, d], [bal.r0 + 0.01, y1, d], [bal.r0 + 0.01, y1, 0]], c);
    b.quadF('fac_net', 'R', [[bal.r1 - 0.01, y0, 0], [bal.r1 - 0.01, y0, d], [bal.r1 - 0.01, y1, d], [bal.r1 - 0.01, y1, 0]], c);
  }
  if (laundry) {
    // A pulley rack clipped outside the railing: 3-4 lines 0.12 m apart, clothes pegged along them.
    const lines = 3 + (H(3) < 0.5 ? 1 : 0);
    const ra = bal.r0 + 0.15;
    const rb = Math.min(bal.r1 - 0.15, ra + 1.2 + 1.2 * H(4));
    const yl = bal.top + 0.04;
    const steel = lin(0xb9bcbd);
    for (const r of [ra, rb]) {
      b.box('fac_metal', r - 0.012, r + 0.012, yl - 0.015, yl + 0.01, bal.P - 0.02, bal.P + 0.1 + lines * 0.12, steel, { front: true, left: true, right: true, top: true, bottom: true });
    }
    for (let q = 0; q < lines; q++) {
      const d = bal.P + 0.08 + q * 0.12;
      b.box('fac_metal', ra, rb, yl - 0.004, yl, d - 0.002, d + 0.002, lin(0xd8d8d0), { bottom: true, front: true });
      // Clothes on this line (front lines fuller).
      let r = ra + 0.05 + 0.2 * H(10 + q);
      let n = 0;
      while (r < rb - 0.2 && n < 6) {
        const cw = 0.22 + 0.5 * H(20 + q * 7 + n);
        const ch = 0.28 + 0.6 * H(30 + q * 7 + n);
        const r1 = Math.min(rb - 0.03, r + cw);
        const col = scale(lin(pick(CLOTH, H(40 + q * 7 + n))), 0.85 + 0.12 * H(50 + n));
        const sway = (H(60 + q * 7 + n) - 0.5) * 0.06;
        const sag = 0.015 + 0.03 * H(70 + n);
        // Pegged at two corners, the bottom swinging a little out and aside; the middle of the top edge droops.
        b.poly('fac_cloth', e.f.dir('N'), [e.f.p(r, yl - ch, d + sway), e.f.p(r1, yl - ch + 0.02 * H(80 + n), d + sway), e.f.p(r1, yl, d), e.f.p((r + r1) / 2, yl - sag, d), e.f.p(r, yl, d)], col);
        r = r1 + 0.04 + 0.25 * H(90 + q * 7 + n);
        n++;
      }
    }
  }
  // Herbs and flowers in tins, buckets and clay pots on the balcony floor, and sometimes on the railing ledge.
  if (H(5) < 0.34) {
    const n = 1 + Math.floor(H(6) * 3.5);
    for (let q = 0; q < n; q++) {
      const r = bal.r0 + 0.2 + (w - 0.4) * H(7 + q);
      pot(b, r, bal.y1, Math.min(bal.P - 0.12, 0.25 + 0.4 * H(12 + q)), H(20 + q), H(24 + q));
    }
  }
  // A plain yellow-and-navy flag hung over the railing (1-3 per block face).
  if (H(8) < 0.07) {
    const fr = bal.r0 + 0.25 + (w - 1.2) * H(9);
    if (fr + 0.9 < bal.r1) {
      flag(b, fr, bal.top + 0.02, bal.P + 0.025, 0.9, 1.25, H(11) < 0.5);
    }
  }
  void x;
}

/** A pot (olive-oil tin, yogurt bucket or clay pot) with a clump of green on top, standing at (r, y, d). */
function pot(b: Batch, r: number, y: number, d: number, u: number, v: number): void {
  const kind = u < 0.4 ? 'tin' : u < 0.65 ? 'bucket' : 'clay';
  const hw = kind === 'tin' ? 0.1 + 0.03 * v : kind === 'bucket' ? 0.09 : 0.08 + 0.06 * v;
  const h = kind === 'tin' ? 0.22 : kind === 'bucket' ? 0.16 : 0.14 + 0.08 * v;
  const col = kind === 'tin' ? lin(pick([0xc8c9c4, 0x3a6a3a, 0xc9a23a, 0x2a4a8a], v)) : kind === 'bucket' ? lin(0xe6e6e0) : lin(pick([0xa65a3a, 0x8f4a2e], v));
  const m = kind === 'clay' ? 'fac_render' : 'fac_metal';
  b.box(m, r - hw, r + hw, y, y + h, d - hw, d + hw, col, { front: true, right: true }, [0.3, 0.2, 0.3, 0.3]);
  // The plant: two crossed cards of leaves.
  const green = lin(pick([0x4f7a32, 0x3f6a2c, 0x5f8a3a, 0x6a7a2c], u), 0.9);
  const ph = 0.15 + 0.25 * v;
  const pw = hw + 0.06 + 0.08 * u;
  b.quadF('fac_plant', 'N', [[r - pw, y + h - 0.03, d], [r + pw, y + h - 0.03, d], [r + pw * 0.8, y + h + ph, d], [r - pw * 0.7, y + h + ph * 0.9, d]], green);
  b.quadF('fac_plant', 'R', [[r, y + h - 0.03, d - pw], [r, y + h - 0.03, d + pw], [r, y + h + ph * 0.85, d + pw * 0.8], [r, y + h + ph, d - pw * 0.7]], scale(green, 0.85));
}

/** Plain yellow-and-navy stripes (no crest, no name), hanging from its top edge in the wall plane at depth d. */
export function flag(b: Batch, r: number, yTop: number, d: number, w: number, h: number, vertical: boolean): void {
  const yellow = lin(0xe0b830);
  const navy = lin(0x1b2a5a);
  const n = 4;
  for (let k = 0; k < n; k++) {
    const col = k % 2 ? navy : yellow;
    const wave = (t: number): number => 0.02 * Math.sin(t * Math.PI * 2);
    if (vertical) {
      const a = r + (w * k) / n;
      const c = r + (w * (k + 1)) / n;
      b.quadF('fac_cloth', 'N', [[a, yTop - h, d + wave(k / n)], [c, yTop - h, d + wave((k + 1) / n)], [c, yTop, d], [a, yTop, d]], col);
    } else {
      const y1 = yTop - (h * k) / n;
      const y0 = yTop - (h * (k + 1)) / n;
      b.quadF('fac_cloth', 'N', [[r, y0, d + 0.01], [r + w, y0, d + wave(0.3) + 0.01], [r + w, y1, d + 0.01], [r, y1, d]], col);
    }
  }
}

/** Plants on 20-40 % of window sills (a pot or two on the marble). */
function sillPlants(x: Ctx2, e: Edge, b: Batch, wins: readonly Win[], H: (k: number) => number): void {
  if (x.p.typ === 'T3') {
    return;
  }
  wins.forEach((w, k) => {
    if (w.kind !== 'window' || w.floor < 1 || h01(w.seed, 300) > 0.13) {
      return;
    }
    const n = 1 + (h01(w.seed, 301) < 0.25 ? 1 : 0);
    for (let q = 0; q < n; q++) {
      const r = w.r0 + 0.15 + (w.r1 - w.r0 - 0.3) * h01(w.seed, 302 + q);
      pot(b, r, w.y0, -0.06, h01(w.seed, 304 + q), h01(w.seed, 306 + q) * 0.4);
    }
    void H;
    void k;
    void e;
  });
}

/** Hairline cracks radiating from window corners and running down from sills on old render (T1/T2 by wear). */
function windowCracks(x: Ctx2, e: Edge, b: Batch, wins: readonly Win[], H: (k: number) => number): void {
  const { p } = x;
  wins.forEach((w, k) => {
    if (w.floor < 1 || p.wear < 0.45 || h01(w.seed, 320) > 0.2 * p.wear * p.wear) {
      return;
    }
    const corner = Math.floor(h01(w.seed, 321) * 4);
    const left = corner % 2 === 0;
    const low = corner < 2;
    const r = left ? w.r0 - 0.03 : w.r1 + 0.03;
    const y = low ? w.y0 - 0.06 : w.y1 + w.box + 0.03;
    crack(b, r, y, left ? -1 : 1, low ? -1 : 1, 0.4 + 0.9 * h01(w.seed, 322), w.seed + k);
  });
  void e;
  void H;
}

/** A zig-zag hairline crack from (r, y) running diagonally (sr, sy) for about `len` metres. */
export function crack(b: Batch, r: number, y: number, sr: number, sy: number, len: number, seed: number): void {
  const n = 4;
  let pr = r;
  let py = y;
  const col = lin(0x3a342e);
  for (let k = 0; k < n; k++) {
    const t = len / n;
    const jitter = (h01(seed, 330 + k) - 0.5) * 0.9;
    const nr = pr + sr * t * (0.7 + 0.3 * Math.cos(jitter));
    const ny = py + sy * t * (0.7 + 0.5 * Math.sin(jitter + 0.8));
    const wdt = 0.006 * (1 - k / (n + 1)) + 0.002;
    const l = Math.hypot(nr - pr, ny - py) || 1;
    const or = (-(ny - py) / l) * wdt;
    const oy = ((nr - pr) / l) * wdt;
    b.quadF('fac_crack', 'N', [[pr - or, py - oy, 0.006], [nr - or, ny - oy, 0.006], [nr + or, ny + oy, 0.006], [pr + or, py + oy, 0.006]], col);
    pr = nr;
    py = ny;
  }
}

/**
 * Satellite dishes bolted to balcony railings or beside windows (1-2 per building on walls that can see the Türksat
 * arc to the south; instances of the façade kit's wall-arm dish, so they cost no tile triangles).
 */
function dishes(x: Ctx2, e: Edge, inp: LifeInput, H: (k: number) => number): void {
  if (x.p.typ === 'T5' || x.p.storeys < 3 || e.f.nz < -0.25 || H(400) > 0.55) {
    return;
  }
  const yaw = Math.atan2(e.f.nx, e.f.nz);
  const n = 1 + (H(401) < 0.35 ? 1 : 0);
  for (let k = 0; k < n; k++) {
    const bal = inp.balconies.filter((q) => q.open)[Math.floor(H(410 + k) * inp.balconies.length)];
    let pos: [number, number, number] | null = null;
    if (bal && H(420 + k) < 0.7) {
      const [px, pz] = e.f.xz(H(430 + k) < 0.5 ? bal.r0 + 0.25 : bal.r1 - 0.25, bal.P - 0.02);
      pos = [px, bal.top - 0.12, pz];
    } else {
      const w = inp.wins.filter((q) => q.floor >= 1 && q.kind === 'window')[Math.floor(H(440 + k) * inp.wins.length)];
      if (w && w.r1 + 0.5 < e.len && clear(inp, w.r1 + 0.35, 0.05, w.y1 - 0.6, w.y1)) {
        const [px, pz] = e.f.xz(w.r1 + 0.35, 0);
        pos = [px, w.y1 - 0.55, pz];
      }
    }
    if (pos) {
      x.c.place('fac_dish', pos, yaw + (H(450 + k) - 0.5) * 0.5, { variant: 'dish', seed: Math.floor(H(460 + k) * 1000), ref: `${x.c.tile}/dish` });
    }
  }
}

/* ------------------------------------------------------------------------------------------------------------- */
/* KİRALIK / SATILIK                                                                                               */
/* ------------------------------------------------------------------------------------------------------------- */

/** A fictional phone number that cannot be dialled (Turkey has no 000 area code). */
function phone(u: number): string {
  const d = (k: number): string => String(Math.floor(h01(u * 97.1, k) * 10));
  return `0 000 ${d(1)}${d(2)}${d(3)} ${d(4)}${d(5)} ${d(6)}${d(7)}`;
}

/** 1-3 banners per block face on T1/T2 upper floors: on a balcony railing, or taped inside a window. */
function banners(x: Ctx2, e: Edge, b: Batch, inp: LifeInput, H: (k: number) => number): void {
  if (x.p.typ === 'T5' || x.p.storeys < 3 || H(200) > 0.3) {
    return;
  }
  const word = H(201) < 0.72 ? 'KİRALIK' : 'SATILIK';
  const yellow = H(202) < 0.6;
  const bg = yellow ? lin(0xe8c630) : lin(0xc8262a);
  const ink = yellow ? lin(0x151515) : lin(0xf4f0e6);
  const bal = inp.balconies.find((q) => q.open && q.r1 - q.r0 > 1.1);
  let r0: number;
  let r1: number;
  let y0: number;
  let y1: number;
  let d: number;
  if (bal && H(203) < 0.7) {
    const w = Math.min(1.1, bal.r1 - bal.r0 - 0.2);
    r0 = bal.r0 + 0.1 + (bal.r1 - bal.r0 - 0.2 - w) * H(204);
    r1 = r0 + w;
    y1 = bal.top - 0.06;
    y0 = y1 - Math.min(0.75, bal.top - bal.y1 - 0.12);
    d = bal.P + 0.015;
  } else {
    const w = inp.wins.find((q) => q.floor >= 1 && q.kind === 'window');
    if (!w) {
      return;
    }
    const rev = x.p.typ === 'T2' ? 0.24 : 0.16;
    r0 = w.r0 + 0.12;
    r1 = Math.min(w.r1 - 0.12, r0 + 0.9);
    y0 = w.y0 + 0.15;
    y1 = Math.min(w.y1 - 0.12, y0 + 0.65);
    d = -rev + 0.01;
  }
  if (r1 - r0 < 0.5 || y1 - y0 < 0.35) {
    return;
  }
  // The vinyl sheet (a slight belly between the ties) with eyelets, then the words.
  const mid = (r0 + r1) / 2;
  b.quadF('fac_vinyl', 'N', [[r0, y0, d], [mid, y0 - 0.01, d + 0.015], [mid, y1, d + 0.01], [r0, y1, d]], bg);
  b.quadF('fac_vinyl', 'N', [[mid, y0 - 0.01, d + 0.015], [r1, y0, d], [r1, y1, d], [mid, y1, d + 0.01]], bg);
  const wCap = Math.min((y1 - y0) * 0.3, (r1 - r0 - 0.08) / textWidth(word));
  emitText(b, word, { material: 'fac_letters', color: ink, r: mid, y: y1 - 0.06 - wCap, d: d + 0.02, capH: wCap, depth: 0 });
  const num = phone(x.p.seed + e.i);
  const nCap = Math.min((y1 - y0) * 0.16, (r1 - r0 - 0.06) / textWidth(num));
  if (nCap > 0.025) {
    emitText(b, num, { material: 'fac_letters', color: ink, r: mid, y: y0 + 0.06, d: d + 0.02, capH: nCap, depth: 0 });
  }
}

