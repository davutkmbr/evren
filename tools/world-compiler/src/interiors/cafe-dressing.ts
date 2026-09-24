/**
 * Dressing of the café shell (cafe.ts), from the S1 critique of the cafe / cafe-in renders ("a sterile showroom"):
 * - back-wall shelves (three oak boards on brackets) with tulip tea glasses, cups on saucers, glass jars of coffee
 *   beans, sugar and tea, coffee bags and tins;
 * - on the counter: a stainless çay kazanı (tea boiler) with a çaydanlık on top, a cash register with its screen
 *   and a baklava vitrine (glass case with trays of baklava);
 * - on every table: two tea glasses on saucers, a sugar bowl and a napkin holder;
 * - on the walls: framed old Kadıköy photographs (sepia: sky, skyline, a ferry), a clock and a wall TV;
 * - the chalk menu board lettered in Turkish (stroke font, shopfront/font.ts): prices of a Kadıköy çay ocağı.
 * Local frame: cafe.ts (u along the façade, v into the room, y from the floor).
 */
import { Batch as FaceBatch, Frame as FaceFrame, lin } from '../facade/frame';
import { box, type Builder, type Batch, faceBox, faceBoxC, type Frame, lathe, span } from '../hero/kit';
import { LEAK, LEAK_BAND, rng } from '../hero/weather';
import { emitText, textWidth } from '../shopfront/font';
import type { TileMesh } from '../mesh';

/** Tulip tea glass (ince belli) standing at (u, v) on a surface at y. */
function teaGlass(b: Builder, f: Frame, u: number, v: number, y: number): void {
  lathe(b, f, u, v, [
    [0.001, y],
    [0.018, y],
    [0.024, y + 0.012],
    [0.017, y + 0.045],
    [0.026, y + 0.09],
    [0.027, y + 0.1],
    [0.001, y + 0.1],
  ], 8);
}

function saucer(b: Builder, f: Frame, u: number, v: number, y: number): void {
  lathe(b, f, u, v, [
    [0.001, y],
    [0.045, y],
    [0.06, y + 0.012],
    [0.055, y + 0.014],
    [0.001, y + 0.006],
  ], 12);
}

/** Back-wall shelves between u0 and u1 (wall at v = D) with their goods. */
function shelves(batch: Batch, f: Frame, u0: number, u1: number, D: number): void {
  const wood = batch.of('int_wood_dark');
  const glass = batch.of('int_glass');
  const cer = batch.of('int_ceramic');
  const levels = [1.3, 1.66, 2.02];
  for (const y of levels) {
    box(wood, f, u0, u1, y - 0.03, y, D - 0.3, D - 0.01, { bottom: true, top: true });
    for (const u of [u0 + 0.15, u1 - 0.15]) {
      box(batch.of('int_steel'), f, u - 0.015, u + 0.015, y - 0.2, y - 0.03, D - 0.25, D - 0.01);
    }
  }
  // Level 1: rows of tea glasses; level 2: cups on saucers and jars; level 3: coffee bags and tins.
  for (let u = u0 + 0.08; u < u1 - 0.08; u += 0.07) {
    teaGlass(glass, f, u, D - 0.22, levels[0]);
    teaGlass(glass, f, u + 0.035, D - 0.12, levels[0]);
  }
  let u = u0 + 0.1;
  let k = 0;
  while (u < u1 - 0.12) {
    if (k % 3 === 2) {
      const content = ['int_coffee', 'int_ceramic', 'int_tea'][Math.floor(k / 3) % 3];
      lathe(batch.of(content), f, u + 0.05, D - 0.16, [
        [0.055, levels[1]],
        [0.055, levels[1] + 0.16],
        [0.001, levels[1] + 0.16],
      ], 10);
      lathe(glass, f, u + 0.05, D - 0.16, [
        [0.06, levels[1] + 0.16],
        [0.06, levels[1] + 0.22],
        [0.04, levels[1] + 0.24],
      ], 10);
      lathe(batch.of('int_brass'), f, u + 0.05, D - 0.16, [
        [0.042, levels[1] + 0.24],
        [0.042, levels[1] + 0.27],
        [0.001, levels[1] + 0.27],
      ], 10);
      u += 0.14;
    } else {
      for (let s = 0; s < 3; s++) {
        saucer(cer, f, u + 0.05, D - 0.16, levels[1] + s * 0.018);
      }
      lathe(cer, f, u + 0.05, D - 0.16, [
        [0.03, levels[1] + 0.054],
        [0.042, levels[1] + 0.11],
        [0.001, levels[1] + 0.11],
      ], 10);
      u += 0.13;
    }
    k++;
  }
  u = u0 + 0.1;
  k = 0;
  while (u < u1 - 0.2) {
    const tall = 0.22 + 0.06 * ((k * 7) % 3);
    const m = ['int_bag_red', 'int_bag_brown', 'int_bag_gold', 'int_bag_brown'][k % 4];
    box(batch.of(m), f, u, u + 0.14, levels[2], levels[2] + tall, D - 0.2, D - 0.1);
    u += 0.17;
    if (k % 3 === 1) {
      lathe(batch.of('int_steel'), f, u + 0.05, D - 0.15, [
        [0.05, levels[2]],
        [0.05, levels[2] + 0.14],
        [0.001, levels[2] + 0.14],
      ], 10);
      u += 0.13;
    }
    k++;
  }
}

/** Counter-top dressing: tea boiler, register, baklava vitrine. Counter from u0 to u1, front at v0, back at v1. */
function counterTop(batch: Batch, f: Frame, u0: number, u1: number, v0: number, v1: number): void {
  const top = 1.04;
  const st = batch.of('int_steel');
  // Çay kazanı at the left end with a çaydanlık on top and a tap.
  const ku = u0 + 0.32;
  const kv = (v0 + v1) / 2 + 0.05;
  lathe(st, f, ku, kv, [
    [0.001, top],
    [0.2, top],
    [0.2, top + 0.5],
    [0.17, top + 0.55],
    [0.001, top + 0.56],
  ], 16);
  lathe(batch.of('int_brass'), f, ku, kv, [
    [0.001, top + 0.56],
    [0.11, top + 0.56],
    [0.13, top + 0.64],
    [0.1, top + 0.72],
    [0.05, top + 0.74],
    [0.06, top + 0.76],
    [0.001, top + 0.8],
  ], 12);
  box(st, f, ku - 0.02, ku + 0.02, top + 0.12, top + 0.15, kv - 0.28, kv - 0.2);
  // Cash register (dark body, screen facing the room) near the right end.
  const ru = u1 - 1.05;
  if (ru > u0 + 1.3) {
    box(batch.of('int_black'), f, ru - 0.2, ru + 0.2, top, top + 0.1, v0 + 0.25, v0 + 0.55);
    box(batch.of('int_black'), f, ru - 0.03, ru + 0.03, top + 0.1, top + 0.25, v0 + 0.45, v0 + 0.5);
    box(batch.of('int_screen'), f, ru - 0.14, ru + 0.14, top + 0.2, top + 0.38, v0 + 0.42, v0 + 0.45, { bottom: true, top: true });
  }
  // Baklava vitrine in the middle of the counter when it is long enough.
  const len = u1 - u0;
  if (len > 3.2) {
    const a = u0 + len * 0.52 - 0.45;
    const b = a + 0.9;
    box(batch.of('int_steel'), f, a, b, top, top + 0.05, v0 + 0.05, v0 + 0.5, { bottom: true, top: true });
    // Glass panes (BLEND, COLOR_0 alpha): front, top, ends.
    const g = batch.of('int_glass_case');
    const gc: [number, number, number, number] = [0.85, 0.9, 0.9, 0.22];
    const y0 = top + 0.05;
    const y1 = top + 0.38;
    g.flatQuad([f.p(a, y0, v0 + 0.05), f.p(b, y0, v0 + 0.05), f.p(b, y1, v0 + 0.05), f.p(a, y1, v0 + 0.05)], f.d(0, 0, -1), undefined, gc);
    g.flatQuad([f.p(a, y1, v0 + 0.05), f.p(b, y1, v0 + 0.05), f.p(b, y1, v0 + 0.5), f.p(a, y1, v0 + 0.5)], [0, 1, 0], undefined, gc);
    g.flatQuad([f.p(a, y0, v0 + 0.05), f.p(a, y0, v0 + 0.5), f.p(a, y1, v0 + 0.5), f.p(a, y1, v0 + 0.05)], f.d(-1, 0, 0), undefined, gc);
    g.flatQuad([f.p(b, y0, v0 + 0.05), f.p(b, y0, v0 + 0.5), f.p(b, y1, v0 + 0.5), f.p(b, y1, v0 + 0.05)], f.d(1, 0, 0), undefined, gc);
    for (const [tu, tv] of [
      [a + 0.05, v0 + 0.1],
      [a + 0.47, v0 + 0.1],
    ]) {
      box(batch.of('int_steel'), f, tu, tu + 0.38, top + 0.05, top + 0.07, tv, tv + 0.35, { bottom: false, top: true });
      for (let i = 0; i < 6; i++) {
        for (let j = 0; j < 5; j++) {
          const pu = tu + 0.02 + i * 0.058;
          const pv = tv + 0.02 + j * 0.062;
          box(batch.of(j % 2 ? 'int_baklava' : 'int_baklava_dark'), f, pu, pu + 0.052, top + 0.07, top + 0.1, pv, pv + 0.056);
        }
      }
    }
  }
}

/** Tea glasses on saucers, a sugar bowl and a napkin holder on a table whose top centre is (u, v) at y. */
export function tableTop(batch: Batch, f: Frame, u: number, v: number, y: number, seed: number): void {
  const cer = batch.of('int_ceramic');
  const glass = batch.of('int_glass');
  const tea = batch.of('int_tea');
  for (const [du, dv] of [
    [-0.14, 0.12],
    [0.12, -0.14],
  ]) {
    const gu = u + du;
    const gv = v + dv;
    saucer(cer, f, gu, gv, y);
    // A full glass of tea reads as its amber body with a clear rim.
    teaGlass(tea, f, gu, gv, y + 0.012);
    lathe(glass, f, gu, gv, [
      [0.0265, y + 0.1],
      [0.028, y + 0.112],
      [0.001, y + 0.112],
    ], 8);
  }
  lathe(cer, f, u + 0.12, v + 0.12, [
    [0.001, y],
    [0.035, y],
    [0.05, y + 0.05],
    [0.001, y + 0.05],
  ], 10);
  const nh = batch.of('int_steel');
  const nu = u - 0.12 + (seed % 2) * 0.05;
  const nv = v - 0.12;
  box(nh, f, nu - 0.06, nu + 0.06, y, y + 0.1, nv - 0.03, nv + 0.03);
  box(batch.of('int_ceramic'), f, nu - 0.055, nu + 0.055, y + 0.02, y + 0.12, nv - 0.02, nv + 0.02);
}

/** A framed sepia photograph on a wall face (span), centred at s, from y0 to y1; `kind` picks the motif. */
function photo(batch: Batch, face: ReturnType<typeof span>['face'], s: number, y0: number, w: number, h: number, kind: number): void {
  const fr = batch.of('int_wood_dark');
  faceBox(fr, face, s - w / 2 - 0.05, s + w / 2 + 0.05, y0 - 0.05, y0 + h + 0.05, -0.005, 0.025);
  const mat = batch.of('int_photo_mat');
  faceBox(mat, face, s - w / 2, s + w / 2, y0, y0 + h, -0.005, 0.028, false, false);
  const sky = batch.of('int_photo_light');
  const dark = batch.of('int_photo_dark');
  const mid = batch.of('int_photo');
  const x0 = s - w / 2 + 0.04;
  const x1 = s + w / 2 - 0.04;
  const ya = y0 + 0.04;
  const yb = y0 + h - 0.04;
  const hz = ya + (yb - ya) * 0.42;
  faceBox(sky, face, x0, x1, hz, yb, -0.005, 0.03, false, false);
  faceBox(mid, face, x0, x1, ya, hz, -0.005, 0.03, false, false);
  // Skyline (blocks, a dome and minaret) or a ferry on the water.
  if (kind % 2 === 0) {
    let x = x0;
    let k = 0;
    while (x < x1 - 0.02) {
      const bw = 0.03 + 0.03 * ((k * 5) % 3);
      const bh = (yb - hz) * (0.15 + 0.2 * ((k * 7) % 4) / 3);
      faceBox(dark, face, x, Math.min(x1, x + bw), hz, hz + bh, -0.005, 0.032, false, false);
      x += bw;
      k++;
    }
    const cx = x0 + (x1 - x0) * 0.62;
    faceBox(dark, face, cx - 0.004, cx + 0.004, hz, hz + (yb - hz) * 0.8, -0.005, 0.033, false, false);
  } else {
    const cx = (x0 + x1) / 2;
    faceBox(dark, face, cx - (x1 - x0) * 0.3, cx + (x1 - x0) * 0.3, hz - 0.02, hz + 0.03, -0.005, 0.032, false, false);
    faceBox(dark, face, cx - (x1 - x0) * 0.18, cx + (x1 - x0) * 0.12, hz + 0.03, hz + 0.06, -0.005, 0.032, false, false);
    faceBox(dark, face, cx - 0.012, cx + 0.012, hz + 0.06, hz + 0.12, -0.005, 0.033, false, false);
  }
}

function clock(batch: Batch, face: ReturnType<typeof span>['face'], s: number, y: number): void {
  const r = 0.17;
  const rim = batch.of('int_black');
  const white = batch.of('int_ceramic');
  const pts: [number, number][] = [];
  for (let k = 0; k < 20; k++) {
    const a = (k / 20) * Math.PI * 2;
    pts.push([s + Math.cos(a) * r, y + Math.sin(a) * r]);
  }
  for (let k = 0; k < 20; k++) {
    const [a0, b0] = pts[k];
    const [a1, b1] = pts[(k + 1) % 20];
    faceBox(rim, face, Math.min(a0, a1) - 0.012, Math.max(a0, a1) + 0.012, Math.min(b0, b1) - 0.012, Math.max(b0, b1) + 0.012, 0, 0.045, false, false);
  }
  faceBox(white, face, s - r * 0.72, s + r * 0.72, y - r * 0.72, y + r * 0.72, 0, 0.035, false, false);
  const hand = batch.of('int_black');
  faceBox(hand, face, s - 0.006, s + 0.006, y, y + r * 0.62, 0.035, 0.045, false, false);
  faceBox(hand, face, s, s + r * 0.45, y - 0.006, y + 0.006, 0.035, 0.045, false, false);
}

/** Dressing of the whole café (called by buildCafe inside its LOD0 block). */
export function dressCafe(mesh: TileMesh, batch: Batch, f: Frame, room: { uL: number; uR: number; v0: number; D: number; C: number; counterR: number; vc0: number; vc1: number }, tables: { u: number; v: number }[]): void {
  const { uL, uR, v0, D, C, counterR, vc0, vc1 } = room;
  shelves(batch, f, uL + 0.2, Math.min(counterR - 0.2, uL + 2.6), D);
  counterTop(batch, f, uL, counterR, vc0, vc1);
  tables.forEach((t, k) => tableTop(batch, f, t.u - 0.08, t.v + 0.07, 0.727, k));
  // Walls: photos and the clock on the plaster wall (right, facing -u), photos on the brick wall, a TV.
  const right = span(f, [uR, v0], [uR, D]);
  const left = span(f, [uL, D], [uL, v0]);
  const nR = Math.max(1, Math.floor((right.len - 3) / 1.6));
  for (let k = 0; k < nR; k++) {
    const s = 1.2 + k * 1.6;
    photo(batch, right.face, s, 1.55 + (k % 2) * 0.08, 0.55 + 0.15 * (k % 2), 0.42, k);
  }
  clock(batch, right.face, right.len - 1.4, 2.45);
  const nL = Math.max(1, Math.floor((left.len - 4) / 2.2));
  for (let k = 0; k < nL; k++) {
    photo(batch, left.face, 3.2 + k * 2.2, 1.6, 0.7, 0.5, k + 1);
  }
  const tvS = right.len - 2.6;
  faceBox(batch.of('int_black'), right.face, tvS - 0.55, tvS + 0.55, C - 1.05, C - 0.42, 0, 0.06);
  faceBox(batch.of('int_screen'), right.face, tvS - 0.52, tvS + 0.52, C - 1.02, C - 0.45, 0, 0.062, false, false);
  void mesh;
}

/** The chalk menu board's lettering (Turkish), on the back wall centred at u = uc, board from y0 to y1. */
export function menuLettering(mesh: TileMesh, f: Frame, uc: number, D: number, y0: number, y1: number, uR: number): void {
  // Facade-style frame on the back wall seen from the room: r = uR - u (towards -u), normal -v.
  const o = f.p(uR, 0, D);
  const r = f.d(-1, 0, 0);
  const n = f.d(0, 0, -1);
  const fr = new FaceFrame(o[0], o[2], r[0], r[2], n[0], n[2], uR);
  const b = new FaceBatch(mesh, fr);
  const d = 0.049;
  const rc = uR - uc;
  const chalk = lin(0xece8dc);
  const y = (h: number): number => f.y0 + h;
  emitText(b, 'MENÜ', { material: 'int_chalk_text', color: chalk, r: rc, y: y(y1 - 0.24), d, capH: 0.1, depth: 0 });
  const items: [string, string][] = [
    ['ÇAY', '15'],
    ['TÜRK KAHVESİ', '60'],
    ['FİLTRE KAHVE', '70'],
    ['SAHLEP', '65'],
    ['TOST', '90'],
    ['SU', '10'],
  ];
  const cap = 0.052;
  const left = rc - 0.82;
  items.forEach(([name, price], k) => {
    const yy = y(y1 - 0.36 - k * 0.075);
    const wn = textWidth(name) * cap;
    emitText(b, name, { material: 'int_chalk_text', color: chalk, r: left + wn / 2, y: yy, d, capH: cap, depth: 0 });
    const wp = textWidth(price) * cap;
    emitText(b, price, { material: 'int_chalk_text', color: chalk, r: rc + 0.82 - wp / 2, y: yy, d, capH: cap, depth: 0 });
  });
  void y0;
  b.flush();
}

/**
 * Lived-in wear and clutter (S1 round 2, "a sterile showroom" → a çay ocağı in use): steam and grease stains rising
 * from the tea boiler on the brick wall and behind the espresso machine, drips under the shelves, grimy scuffs on the
 * floor at the threshold and in front of the counter, and the clutter of a working café — crates of bottles by the
 * back door, cardboard boxes behind the counter, a water carboy on its stand, a bin, a newspaper on a table, a
 * calendar and taped notices, white cable trunking to the TV.
 */
export function cafeWear(mesh: TileMesh, batch: Batch, f: Frame, room: { uL: number; uR: number; v0: number; D: number; C: number; counterR: number; vc0: number; vc1: number; ud: number }, tables: { u: number; v: number }[]): void {
  const { uL, uR, v0, D, C, counterR, vc0, vc1, ud } = room;
  const r = rng(1453);
  const left = span(f, [uL, D], [uL, v0]);
  const back = span(f, [uR, D], [uL, D]);
  const right = span(f, [uR, v0], [uR, D]);
  const top = 1.04;
  // Steam grease rising from the çay kazanı (counter's left end) on the brick wall, and a smaller patch behind it.
  const kv = (vc0 + vc1) / 2 + 0.05;
  mesh.decal(LEAK_BAND, left.face.p(D - kv, top + 0.8, 0), left.face.n, { size: [1.1, 1.6], offset: 0.01, rect: [0.1, 0.05, 0.5, 1], color: [0.12, 0.09, 0.05, 0.95] });
  mesh.decal(LEAK_BAND, left.face.p(D - kv + 0.35, top + 1.25, 0), left.face.n, { size: [0.7, 1.0], offset: 0.011, rect: [0.55, 0.3, 0.9, 1], color: [0.1, 0.08, 0.05, 0.8] });
  // Yellowed, sooty ceiling over the boiler.
  const ku = uL + 0.32;
  mesh.decal(LEAK_BAND, f.p(ku + 0.35, C - 0.004, kv), [0, -1, 0], { size: [1.3, 1.1], offset: 0.003, rotation: 0.6, rect: [0.2, 0.35, 0.7, 1], color: [0.35, 0.27, 0.15, 0.7] });
  // Splashes behind the espresso machine and drips under the shelf boards on the back wall.
  const em = uL + 0.95;
  mesh.decal(LEAK_BAND, back.face.p(uR - em, top + 0.45, 0), back.face.n, { size: [1.1, 0.9], offset: 0.01, rect: [0.3, 0.2, 0.75, 1], color: [0.32, 0.24, 0.16, 0.7] });
  for (const y of [1.27, 1.63, 1.99]) {
    for (let k = 0; k < 2; k++) {
      const s = uR - (uL + 0.5 + r() * 1.8);
      mesh.decal(LEAK, back.face.p(s, y - 0.25, 0), back.face.n, { size: [0.3 + r() * 0.3, 0.45], offset: 0.008, rect: [r() * 0.5, 0, r() * 0.5 + 0.5, 0.9], color: [0.35, 0.28, 0.2, 0.5] });
    }
  }
  // Kick marks along the foot of the counter front, paint worn through along its top arris.
  const front = span(f, [counterR, vc0], [uL, vc0]);
  for (let s = 0.1; s < front.len - 0.3; s += 0.9 + r() * 0.5) {
    mesh.decal(LEAK_BAND, front.face.p(s + 0.4, 0.32, 0.03), front.face.n, { size: [0.8 + r() * 0.4, 0.5], offset: 0.004, rect: [r() * 0.5, 0.3, r() * 0.5 + 0.45, 1], color: [0.2, 0.18, 0.15, 0.75] });
  }
  const worn = batch.of('wood_peeling_paint_weathered');
  for (let s = 0.15; s < front.len - 0.2; s += 0.5 + r() * 0.9) {
    const w = 0.2 + r() * 0.5;
    faceBox(worn, front.face, s, Math.min(front.len - 0.05, s + w), 0.97, 0.995, 0.02, 0.028, false, false);
  }
  // Floor scuffs: the threshold and the strip in front of the counter (Leaking008 smears, low alpha).
  const up: [number, number, number] = [0, 1, 0];
  const floorAt = (u: number, v: number): [number, number, number] => f.p(u, 0.006, v);
  mesh.decal(LEAK_BAND, floorAt(ud, v0 + 0.6), up, { size: [1.4, 1.2], offset: 0.004, rotation: 0.3, rect: [0.2, 0.3, 0.7, 1], color: [0.25, 0.21, 0.17, 0.6] });
  for (let k = 0; k < 3; k++) {
    mesh.decal(LEAK_BAND, floorAt(uL + 0.8 + k * ((counterR - uL - 1) / 3), vc0 - 0.35), up, { size: [1.2, 0.7], offset: 0.004, rotation: 1.4 + r() * 0.4, rect: [r() * 0.5, 0.4, r() * 0.5 + 0.4, 1], color: [0.33, 0.28, 0.23, 0.4] });
  }
  // Crates of bottles by the back door.
  const cu = uR - 1.45;
  const cv = D - 0.3;
  const crate = (u: number, y: number, v: number, m: string, bottles: boolean): void => {
    const b = batch.of(m);
    box(b, f, u - 0.2, u + 0.2, y, y + 0.28, v - 0.15, v + 0.15, { bottom: true, top: false });
    box(b, f, u - 0.18, u + 0.18, y + 0.02, y + 0.03, v - 0.13, v + 0.13, { bottom: false, top: true });
    if (bottles) {
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 3; j++) {
          lathe(batch.of('int_tea'), f, u - 0.14 + i * 0.093, v - 0.09 + j * 0.09, [
            [0.03, y + 0.03],
            [0.03, y + 0.2],
            [0.012, y + 0.27],
            [0.012, y + 0.31],
            [0.001, y + 0.31],
          ], 6);
        }
      }
    }
  };
  crate(cu, 0, cv, 'int_crate_red', false);
  crate(cu, 0.28, cv, 'int_crate_blue', false);
  crate(cu + 0.02, 0.56, cv - 0.01, 'int_crate_red', true);
  crate(cu - 0.45, 0, cv, 'int_crate_blue', true);
  // Cardboard boxes behind the counter, under the shelves.
  const cb = batch.of('int_cardboard');
  box(cb, f, uL + 2.1, uL + 2.55, 0, 0.35, D - 0.45, D - 0.08);
  box(cb, f, uL + 2.15, uL + 2.5, 0.35, 0.58, D - 0.42, D - 0.12);
  box(cb, f, uL + 0.15, uL + 0.5, 0, 0.3, vc1 + 0.1, vc1 + 0.45);
  // Water carboy on its stand at the counter's end.
  const wu = counterR + 0.35;
  const wv = vc1 - 0.2;
  box(batch.of('int_black'), f, wu - 0.17, wu + 0.17, 0, 0.62, wv - 0.17, wv + 0.17);
  lathe(batch.of('int_carboy'), f, wu, wv, [
    [0.04, 0.62],
    [0.13, 0.66],
    [0.14, 0.72],
    [0.14, 1.0],
    [0.12, 1.07],
    [0.04, 1.12],
    [0.035, 1.17],
    [0.001, 1.17],
  ], 12);
  // A bin by the counter's end.
  lathe(batch.of('int_black'), f, counterR + 0.35, vc0 - 0.25, [
    [0.001, 0],
    [0.15, 0],
    [0.17, 0.46],
    [0.001, 0.46],
  ], 12);
  lathe(batch.of('int_paper'), f, counterR + 0.35, vc0 - 0.25, [
    [0.172, 0.44],
    [0.182, 0.48],
    [0.13, 0.49],
  ], 12);
  // A newspaper left on the first table.
  if (tables.length) {
    const t = tables[0];
    const y = 0.732;
    const p = batch.of('int_paper');
    const c = Math.cos(0.35);
    const sn = Math.sin(0.35);
    const q = (du: number, dv: number): [number, number, number] => f.p(t.u + 0.05 + du * c + dv * sn, y, t.v - 0.05 - du * sn + dv * c);
    p.flatQuad([q(-0.14, -0.2), q(0.14, -0.2), q(0.14, 0.2), q(-0.14, 0.2)], [0, 1, 0]);
    const pr = batch.of('int_paper_print');
    const q2 = (du: number, dv: number): [number, number, number] => [q(du, dv)[0], y + 0.001, q(du, dv)[2]];
    pr.flatQuad([q2(-0.11, 0.05), q2(0.11, 0.05), q2(0.11, 0.16), q2(-0.11, 0.16)], [0, 1, 0]);
  }
  // A calendar and taped notices on the right wall by the door, white trunking from the ceiling down to the TV.
  const paper = batch.of('int_paper');
  faceBox(paper, right.face, 0.55, 0.9, 1.45, 1.95, 0, 0.004, false, false);
  faceBox(batch.of('int_paper_print'), right.face, 0.58, 0.87, 1.72, 1.92, 0, 0.005, false, false);
  faceBox(paper, right.face, 0.95, 1.16, 1.3, 1.6, 0, 0.003, false, false);
  const tvS = right.len - 2.6;
  const trunk = batch.of('int_ceramic');
  faceBoxC(trunk, right.face, 0.2, right.len - 0.2, C - 0.16, C - 0.11, 0, 0.025, 0.004);
  faceBoxC(trunk, right.face, tvS + 0.4, tvS + 0.44, C - 0.42, C - 0.16, 0, 0.022, 0.004, false);
  faceBox(batch.of('int_cable'), right.face, tvS + 0.3, tvS + 0.31, C - 1.2, C - 1.02, 0.02, 0.03, false, false);
}
