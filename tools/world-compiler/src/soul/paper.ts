/**
 * The paper layer and the ground residue of the soul lane, emitted as tile geometry with COLOR_0 (one primitive per
 * material and tile; .docs/street/kadikoy-soul.md items 11, 35, 37, 3 / 10):
 *
 * - stickers (5–15 cm) layered on poles, bollards, bins and cabinets from 0.9 to 2.2 m, densest at 1.4–1.7 m: band,
 *   venue and fan designs in invented colour schemes (no logos, no text beyond generic words), half-peeled white
 *   backing and grey scraped residue, older layers bleached;
 * - A3 / A2 poster grids on flat faces (cabinets, container sides) with torn and bleached older layers and scraped
 *   rectangles; "KAYIP KEDİ" notices with tear-off tabs;
 * - İBB-style street-name signs (crimson, white capitals, mahalle band, district stripe) on junction corners;
 * - cigarette butts at the pier exits and the bus stop, sunflower-seed husks at benches, gum spots, fish-end run-off
 *   films draining downhill and fish scraps.
 *
 * Offsets from the surface stay within 5–12 mm (layers at least 1 mm apart), so nothing z-fights (S1 checklist 7).
 */
import { Batch, Frame } from '../facade/frame';
import type { RGBA, TileMesh, Vec3 } from '../mesh';
import { emitText, hasGlyphs, textWidth } from '../shopfront/font';
import { wrapPatch } from './geom';

/** Linear RGBA of an sRGB hex colour. */
export function lin(hex: number, a = 1): RGBA {
  const ch = (s: number): number => {
    const c = ((hex >> s) & 255) / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return [ch(16), ch(8), ch(0), a];
}

const mixc = (a: RGBA, b: RGBA, t: number): RGBA => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3]];

export function rng(seed: number): () => number {
  let s = Math.floor(Math.abs(seed) * 7919 + 13) >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const pick = <T>(list: readonly T[], u: number): T => list[Math.min(list.length - 1, Math.floor(u * list.length))];

/** Dusty sticker and poster inks (sRGB). */
const INKS = [0x1d1d1f, 0xe6e1d6, 0xa8392e, 0xd5ae3c, 0x1f2c4c, 0x3a8aa2, 0xc97b95, 0x4f8446, 0xcc742e, 0x5b3d78, 0xa6a7a4, 0x2e2e33];
const PAPER = [0xe8e3d7, 0xe9dc9b, 0xd9e2e0, 0xe6c9c9, 0xd6d6cf, 0x2a2a2e];
const BLEACH = lin(0xd9d4c7);
const RESIDUE = lin(0xb8b2a4);
const BACKING = lin(0xe9e6dd);

export interface PaperStats {
  stickers: number;
  posters: number;
  notices: number;
  scraped: number;
  signs: number;
  butts: number;
  husks: number;
  gum: number;
  runoff: number;
  scraps: number;
}

export const newPaperStats = (): PaperStats => ({ stickers: 0, posters: 0, notices: 0, scraped: 0, signs: 0, butts: 0, husks: 0, gum: 0, runoff: 0, scraps: 0 });

/* ------------------------------------------------------------------------------------------------------------- */
/* Stickers on round poles                                                                                         */
/* ------------------------------------------------------------------------------------------------------------- */

export interface PoleSpec {
  x: number;
  z: number;
  /** Pole radius at sticker height (m). */
  r: number;
  y0: number;
  y1: number;
  /** Most likely sticker height (m). */
  peak: number;
}

/**
 * `count` stickers wrapped round a vertical pole (ground height gy). Returns the number emitted. Designs: two-colour
 * split, framed, fan halves (yellow / navy, no crest), text bars, lost-cat notice, peeled backing, scraped residue.
 */
export function stickersOnPole(mesh: TileMesh, p: PoleSpec, gy: number, count: number, seed: number, stats: PaperStats): void {
  const rnd = rng(seed);
  for (let k = 0; k < count; k++) {
    const yy = Math.max(p.y0, Math.min(p.y1, p.peak + (rnd() + rnd() + rnd() - 1.5) * 0.55));
    const ang = rnd() * Math.PI * 2;
    const small = p.r < 0.05;
    const w = small ? 0.035 + rnd() * 0.03 : 0.05 + rnd() * 0.08;
    const h = w * (0.55 + rnd() * 0.9);
    const rot = (rnd() - 0.5) * 0.5;
    // Twelve layers 0.6 mm apart (5-11.6 mm off the pole): overlapping stickers rarely share one.
    const r = p.r + 0.005 + (k % 12) * 0.0006;
    const old = rnd() < 0.35;
    const col = (hex: number): RGBA => (old ? mixc(lin(hex), BLEACH, 0.35 + rnd() * 0.35) : lin(hex));
    const kind = rnd();
    const y = gy + yy;
    const cols = w / p.r > 0.8 ? 4 : 3;
    if (kind < 0.12) {
      // Half-peeled white backing, torn at the top.
      wrapPatch(mesh, 'soul_sticker', p.x, p.z, r, ang, y, w, h, rot, BACKING, cols, 0.5, seed + k);
    } else if (kind < 0.2) {
      // Grey residue where one was scraped off.
      wrapPatch(mesh, 'soul_sticker', p.x, p.z, p.r + 0.004, ang, y, w * 1.2, h * 1.1, rot, mixc(RESIDUE, lin(0x8a867c), rnd() * 0.5), cols, 0.35, seed + k);
      stats.scraped++;
    } else if (kind < 0.3 && !small) {
      // Fan sticker: yellow and navy halves.
      const du = (w / 4) * Math.cos(rot);
      const dv = (w / 4) * Math.sin(rot);
      wrapPatch(mesh, 'soul_sticker', p.x, p.z, r, ang - du / r, y - dv, w / 2, h, rot, col(0xd8b433), cols - 1);
      wrapPatch(mesh, 'soul_sticker', p.x, p.z, r, ang + du / r, y + dv, w / 2, h, rot, col(0x1f2c4c), cols - 1);
    } else if (kind < 0.36 && !small) {
      // A lost-cat notice (A6) with a photo block and text bars.
      const nw = 0.1;
      const nh = 0.14;
      wrapPatch(mesh, 'soul_sticker', p.x, p.z, r, ang, y, nw, nh, 0, col(0xeceae3), 4);
      wrapPatch(mesh, 'soul_sticker', p.x, p.z, r + 0.0003, ang, y + nh * 0.34, nw * 0.8, 0.02, 0, lin(0x1c1c1c), 4);
      wrapPatch(mesh, 'soul_sticker', p.x, p.z, r + 0.0003, ang, y + 0.005, nw * 0.6, nh * 0.36, 0, lin(pick([0x8a6a4a, 0x2a2826, 0xb07a3c, 0x7a7a74], rnd())), 3);
      for (let q = 0; q < 2; q++) {
        wrapPatch(mesh, 'soul_sticker', p.x, p.z, r + 0.0003, ang, y - nh * 0.22 - q * 0.018, nw * 0.75, 0.006, 0, lin(0x3a3a3a), 3);
      }
      stats.notices++;
    } else {
      const a = pick(INKS, rnd());
      let b = pick(INKS, rnd());
      if (b === a) {
        b = INKS[(INKS.indexOf(a) + 3) % INKS.length];
      }
      wrapPatch(mesh, 'soul_sticker', p.x, p.z, r, ang, y, w, h, rot, col(a), cols);
      const d = rnd();
      if (d < 0.4) {
        // Framed: an inner block in the second ink.
        wrapPatch(mesh, 'soul_sticker', p.x, p.z, r + 0.0003, ang, y, w * 0.72, h * 0.62, rot, col(b), cols);
      } else if (d < 0.75) {
        // Two text bars.
        for (const f of [-0.18, 0.14]) {
          wrapPatch(mesh, 'soul_sticker', p.x, p.z, r + 0.0003, ang - (Math.sin(rot) * h * f) / r, y + Math.cos(rot) * h * f, w * 0.7, h * 0.12, rot, col(b), cols);
        }
      }
    }
    stats.stickers++;
  }
}

/* ------------------------------------------------------------------------------------------------------------- */
/* Flat faces: stickers, poster grids, notices                                                                     */
/* ------------------------------------------------------------------------------------------------------------- */

/** A flat vertical face: origin at its bottom-left seen from the front, unit right vector, unit outward normal. */
export interface Face {
  o: Vec3;
  rx: number;
  rz: number;
  nx: number;
  nz: number;
  w: number;
  h: number;
}

const fp = (f: Face, u: number, v: number, d: number): Vec3 => [f.o[0] + f.rx * u + f.nx * d, f.o[1] + v, f.o[2] + f.rz * u + f.nz * d];

/** Quad (optionally rotated about its centre, optionally with a torn edge) on a face. */
function faceQuad(mesh: TileMesh, m: string, f: Face, cu: number, cv: number, w: number, h: number, d: number, color: RGBA, rot = 0, torn = 0, seed = 0): void {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const loc: [number, number][] = [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ];
  if (torn > 0) {
    // Replace the top edge by a ragged line (torn off in strips).
    const rnd = rng(seed);
    const n = 5;
    const top: [number, number][] = [];
    for (let k = n; k >= 0; k--) {
      top.push([-w / 2 + (w * k) / n, h / 2 - rnd() * torn * h]);
    }
    loc.splice(2, 2, ...top);
  }
  const pts = loc.map(([a, b]): Vec3 => fp(f, cu + a * c - b * s, cv + a * s + b * c, d));
  // A torn polygon may be concave: fan from the bottom-left corner stays valid for a ragged top edge.
  mesh.flatPolygon(m, pts, [f.nx, 0, f.nz], { color });
}

export function stickersOnFace(mesh: TileMesh, f: Face, count: number, v0: number, v1: number, seed: number, stats: PaperStats): void {
  const rnd = rng(seed);
  for (let k = 0; k < count; k++) {
    const w = 0.05 + rnd() * 0.09;
    const h = w * (0.5 + rnd() * 0.9);
    const cu = w / 2 + rnd() * Math.max(0.01, f.w - w);
    const cv = Math.max(v0, Math.min(v1, v0 + (v1 - v0) * (rnd() + rnd()) / 2));
    const d = 0.005 + (k % 10) * 0.0006;
    const old = rnd() < 0.35;
    const a = pick(INKS, rnd());
    const col = old ? mixc(lin(a), BLEACH, 0.4) : lin(a);
    const rot = (rnd() - 0.5) * 0.5;
    if (rnd() < 0.15) {
      faceQuad(mesh, 'soul_sticker', f, cu, cv, w, h, 0.004, BACKING, rot, 0.5, seed + k);
    } else {
      faceQuad(mesh, 'soul_sticker', f, cu, cv, w, h, d, col, rot);
      if (rnd() < 0.6) {
        faceQuad(mesh, 'soul_sticker', f, cu, cv, w * 0.7, h * 0.5, d + 0.0003, lin(pick(INKS, rnd())), rot);
      }
    }
    stats.stickers++;
  }
}

/** One printed poster: paper, headline band, picture block and text bars (a concert, a play, a course...). */
function poster(mesh: TileMesh, f: Face, cu: number, cv: number, w: number, h: number, d: number, bleach: number, rot: number, torn: number, seed: number): void {
  const rnd = rng(seed);
  const tone = (hex: number): RGBA => mixc(lin(hex), BLEACH, bleach);
  const paper = pick(PAPER, rnd());
  const dark = paper === 0x2a2a2e;
  faceQuad(mesh, 'soul_paper', f, cu, cv, w, h, d, tone(paper), rot, torn, seed);
  if (torn > 0.45) {
    return;
  }
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const at = (lu: number, lv: number): [number, number] => [cu + lu * c - lv * s, cv + lu * s + lv * c];
  const ink = pick(INKS, rnd());
  const [hu, hv] = at(0, h * 0.3);
  faceQuad(mesh, 'soul_paper', f, hu, hv, w * 0.84, h * 0.16, d + 0.001, tone(dark ? pick([0xd5ae3c, 0xe6e1d6, 0xc97b95], rnd()) : ink), rot);
  const [pu, pv] = at((rnd() - 0.5) * w * 0.2, -h * 0.02);
  faceQuad(mesh, 'soul_paper', f, pu, pv, w * (0.4 + rnd() * 0.4), h * 0.3, d + 0.001, tone(pick(INKS, rnd())), rot);
  for (let q = 0; q < 3; q++) {
    const [tu, tv] = at(0, -h * (0.24 + q * 0.07));
    faceQuad(mesh, 'soul_paper', f, tu, tv, w * (0.7 - q * 0.12), h * 0.025, d + 0.001, tone(dark ? 0xd6d2c8 : 0x3a3a3c), rot);
  }
}

/**
 * A poster grid on a face region [u0, u1] × [v0, v1]: an older bleached, torn layer with scraped patches under a
 * current layer of A3 / A2 sheets in a loose grid.
 */
export function posterGrid(mesh: TileMesh, f: Face, u0: number, u1: number, v0: number, v1: number, seed: number, stats: PaperStats): void {
  const rnd = rng(seed);
  // Scraped rectangles (paper fibres left by the municipality's scrapers).
  for (let k = 0; k < 2; k++) {
    const w = 0.2 + rnd() * 0.3;
    const h = 0.15 + rnd() * 0.3;
    faceQuad(mesh, 'soul_paper', f, u0 + w / 2 + rnd() * Math.max(0.01, u1 - u0 - w), v0 + h / 2 + rnd() * Math.max(0.01, v1 - v0 - h), w, h, 0.004, mixc(RESIDUE, lin(0x9c968a), rnd() * 0.6), 0, 0.3, seed + k);
    stats.scraped++;
  }
  // Older layer: bleached and torn.
  const a3w = 0.297;
  const a3h = 0.42;
  for (let k = 0; k < 3; k++) {
    const cu = u0 + a3w / 2 + rnd() * Math.max(0.01, u1 - u0 - a3w);
    const cv = v0 + a3h / 2 + rnd() * Math.max(0.01, v1 - v0 - a3h);
    poster(mesh, f, cu, cv, a3w, a3h, 0.0055, 0.45 + rnd() * 0.3, (rnd() - 0.5) * 0.06, 0.3 + rnd() * 0.5, seed * 3 + k);
    stats.posters++;
  }
  // Current layer: a loose grid.
  const big = rnd() < 0.35;
  const pw = big ? 0.42 : a3w;
  const ph = big ? 0.594 : a3h;
  const cols = Math.max(1, Math.floor((u1 - u0) / (pw * 0.95)));
  const rows = Math.max(1, Math.floor((v1 - v0) / (ph * 0.95)));
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      if (rnd() < 0.2) {
        continue;
      }
      const cu = u0 + pw / 2 + i * pw * 0.97 + (rnd() - 0.5) * 0.03;
      const cv = v0 + ph / 2 + j * ph * 0.97 + (rnd() - 0.5) * 0.03;
      poster(mesh, f, cu, cv, pw, ph, 0.0075 + ((i + j) % 2) * 0.0012, rnd() * 0.25, (rnd() - 0.5) * 0.05, rnd() < 0.25 ? 0.15 + rnd() * 0.3 : 0, seed * 7 + i * 13 + j);
      stats.posters++;
    }
  }
}

/** "KAYIP KEDİ" notice (A4) with a photo block, text bars and tear-off phone tabs (no real number). */
export function lostCatNotice(mesh: TileMesh, f: Face, cu: number, cv: number, d: number, coat: number, stats: PaperStats): void {
  const w = 0.21;
  const h = 0.297;
  faceQuad(mesh, 'soul_paper', f, cu, cv, w, h, d, lin(0xeeece6), (coat % 7) * 0.008 - 0.02);
  faceQuad(mesh, 'soul_paper', f, cu, cv + 0.02, w * 0.62, h * 0.34, d + 0.001, lin(pick([0x8a6a4a, 0x2a2826, 0xb07a3c, 0x7c7b76, 0xd8d2c6], (coat % 5) / 5)), 0);
  for (let q = 0; q < 3; q++) {
    faceQuad(mesh, 'soul_paper', f, cu, cv - 0.07 - q * 0.016, w * (0.75 - q * 0.1), 0.006, d + 0.001, lin(0x2c2c2c), 0);
  }
  // Tear-off tabs along the bottom, two already taken.
  for (let q = 0; q < 7; q++) {
    if (q === 2 || q === 5) {
      continue;
    }
    faceQuad(mesh, 'soul_paper', f, cu - w / 2 + 0.015 + q * 0.03, cv - h / 2 - 0.028, 0.022, 0.056, d, lin(0xeeece6), 0);
  }
  const frame = new Frame(f.o[0], f.o[2], f.rx, f.rz, f.nx, f.nz, f.w);
  const batch = new Batch(mesh, frame);
  emitText(batch, 'KAYIP KEDİ', { material: 'soul_paper', color: lin(0x1c1c1c), r: cu, y: f.o[1] + cv + 0.1, d: d + 0.0015, capH: 0.03, depth: 0 });
  batch.flush();
  stats.notices++;
}

/* ------------------------------------------------------------------------------------------------------------- */
/* Street-name signs                                                                                               */
/* ------------------------------------------------------------------------------------------------------------- */

const SIGN_CAP = 0.058;

/** Width (m) of the street-name sign for a street name and a door-number range. */
export function signWidth(street: string, numbers: string): number {
  return Math.max(0.62, textWidth(street.toLocaleUpperCase('tr-TR')) * SIGN_CAP + textWidth(numbers) * 0.03 + 0.14);
}

/** İBB-style street-name sign flat on a wall: crimson plate, white street name, mahalle line, district stripe. */
export function streetSign(mesh: TileMesh, f: Face, cu: number, cv: number, street: string, numbers: string, mahalle: string, stats: PaperStats): void {
  const name = street.toLocaleUpperCase('tr-TR');
  if (!hasGlyphs(name) || !hasGlyphs(mahalle)) {
    return;
  }
  const capH = SIGN_CAP;
  const w = signWidth(street, numbers);
  const h = 0.3;
  const frame = new Frame(f.o[0], f.o[2], f.rx, f.rz, f.nx, f.nz, f.w);
  const b = new Batch(mesh, frame);
  const y0 = f.o[1] + cv - h / 2;
  const crimson = lin(0x7e1d2a);
  b.box('soul_sign', cu - w / 2, cu + w / 2, y0, y0 + h, 0.004, 0.018, crimson);
  const white = lin(0xe9e6de);
  // White rule under the name, the district stripe at the bottom.
  b.quadF('soul_sign', 'N', [[cu - w / 2 + 0.03, y0 + 0.125, 0.0192], [cu + w / 2 - 0.03, y0 + 0.125, 0.0192], [cu + w / 2 - 0.03, y0 + 0.132, 0.0192], [cu - w / 2 + 0.03, y0 + 0.132, 0.0192]], white);
  b.quadF('soul_sign', 'N', [[cu - w / 2, y0 + 0.004, 0.0192], [cu + w / 2, y0 + 0.004, 0.0192], [cu + w / 2, y0 + 0.05, 0.0192], [cu - w / 2, y0 + 0.05, 0.0192]], lin(0x5e1420));
  const nameW = textWidth(name) * capH;
  const numW = textWidth(numbers) * 0.03;
  const left = cu - (nameW + 0.04 + numW) / 2;
  emitText(b, name, { material: 'soul_sign', color: white, r: left + nameW / 2, y: y0 + 0.18, d: 0.0205, capH, depth: 0 });
  emitText(b, numbers, { material: 'soul_sign', color: white, r: left + nameW + 0.04 + numW / 2, y: y0 + 0.18, d: 0.0205, capH: 0.03, depth: 0 });
  emitText(b, mahalle, { material: 'soul_sign', color: white, r: cu, y: y0 + 0.07, d: 0.0205, capH: 0.032, depth: 0 });
  emitText(b, 'KADIKÖY', { material: 'soul_sign', color: white, r: cu, y: y0 + 0.017, d: 0.0205, capH: 0.022, depth: 0 });
  b.flush();
  stats.signs++;
}

/* ------------------------------------------------------------------------------------------------------------- */
/* Ground residue                                                                                                  */
/* ------------------------------------------------------------------------------------------------------------- */

type Ground = (x: number, z: number) => number;
type Free = (x: number, z: number) => boolean;

function groundQuad(mesh: TileMesh, m: string, gy: Ground, x: number, z: number, w: number, l: number, ang: number, color: RGBA, lift = 0.004): void {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const y = gy(x, z) + lift;
  const pts: Vec3[] = [
    [x - c * l / 2 - s * w / 2, y, z - s * l / 2 + c * w / 2],
    [x + c * l / 2 - s * w / 2, y, z + s * l / 2 + c * w / 2],
    [x + c * l / 2 + s * w / 2, y, z + s * l / 2 - c * w / 2],
    [x - c * l / 2 + s * w / 2, y, z - s * l / 2 - c * w / 2],
  ];
  mesh.flatPolygon(m, pts, [0, 1, 0], { color });
}

/** Cigarette butts scattered round (cx, cz): denser at the centre. */
export function butts(mesh: TileMesh, gy: Ground, free: Free, cx: number, cz: number, radius: number, count: number, seed: number, stats: PaperStats): void {
  const rnd = rng(seed);
  const cols = [lin(0xd9d5cc), lin(0xc49b62), lin(0xaea38f), lin(0xe4e0d6), lin(0x8f8574)];
  for (let k = 0; k < count; k++) {
    const a = rnd() * Math.PI * 2;
    const d = radius * Math.sqrt(rnd()) * (0.4 + 0.6 * rnd());
    const x = cx + Math.cos(a) * d;
    const z = cz + Math.sin(a) * d;
    if (!free(x, z)) {
      continue;
    }
    const ang = rnd() * Math.PI;
    groundQuad(mesh, 'soul_litter', gy, x, z, 0.008, 0.028 + rnd() * 0.01, ang, pick(cols, rnd()));
    if (rnd() < 0.6) {
      // The orange filter end.
      groundQuad(mesh, 'soul_litter', gy, x + Math.cos(ang) * 0.012, z + Math.sin(ang) * 0.012, 0.0085, 0.01, ang, lin(0xc27a3a), 0.0045);
    }
    stats.butts++;
  }
}

/** Sunflower-seed husks in a loose pile in front of a bench (centre, facing direction). */
export function husks(mesh: TileMesh, gy: Ground, free: Free, cx: number, cz: number, fx: number, fz: number, count: number, seed: number, stats: PaperStats): void {
  const rnd = rng(seed);
  const cols = [lin(0x1b1b1b), lin(0x2a2a28), lin(0x6c6b66), lin(0xcfcac0)];
  for (let k = 0; k < count; k++) {
    const u = (rnd() - 0.5) * 1.6;
    const v = 0.25 + rnd() * rnd() * 0.9;
    const x = cx + fz * u * -1 + fx * v;
    const z = cz + fx * u + fz * v;
    if (!free(x, z)) {
      continue;
    }
    groundQuad(mesh, 'soul_litter', gy, x, z, 0.005, 0.012, rnd() * Math.PI, pick(cols, rnd() * rnd()));
    stats.husks++;
  }
}

/** Flattened gum spots (dark grey discs). */
export function gum(mesh: TileMesh, gy: Ground, free: Free, cx: number, cz: number, radius: number, count: number, seed: number, stats: PaperStats): void {
  const rnd = rng(seed);
  for (let k = 0; k < count; k++) {
    const a = rnd() * Math.PI * 2;
    const d = radius * Math.sqrt(rnd());
    const x = cx + Math.cos(a) * d;
    const z = cz + Math.sin(a) * d;
    if (!free(x, z)) {
      continue;
    }
    const r = 0.007 + rnd() * 0.01;
    const y = gy(x, z) + 0.003;
    const pts: Vec3[] = [...Array(6)].map((_, q): Vec3 => [x + Math.cos((q / 6) * Math.PI * 2) * r * (0.8 + rnd() * 0.4), y, z + Math.sin((q / 6) * Math.PI * 2) * r * (0.8 + rnd() * 0.4)]);
    mesh.flatPolygon('soul_litter', pts, [0, 1, 0], { color: mixc(lin(0x4a4844), lin(0x2a2826), rnd()) });
    stats.gum++;
  }
}

/**
 * A wet run-off film from (x, z) following the ground downhill (`len` m), `width` wide, as a strip of quads 4 mm
 * above the paving (soul_wet, alpha from COLOR_0). Stops at `stop` (e.g. a façade or a drain).
 */
export function runoff(mesh: TileMesh, gy: Ground, stop: Free, x: number, z: number, len: number, width: number, seed: number, stats: PaperStats): void {
  const rnd = rng(seed);
  const path: [number, number][] = [[x, z]];
  let px = x;
  let pz = z;
  let wob = 0;
  for (let s = 0; s < len; s += 0.25) {
    const e = 0.2;
    const gx = gy(px + e, pz) - gy(px - e, pz);
    const gz = gy(px, pz + e) - gy(px, pz - e);
    const gl = Math.hypot(gx, gz) || 1;
    wob += (rnd() - 0.5) * 0.5;
    wob *= 0.8;
    const dx = -gx / gl;
    const dz = -gz / gl;
    const nx = px + (dx * Math.cos(wob) - dz * Math.sin(wob)) * 0.25;
    const nz = pz + (dx * Math.sin(wob) + dz * Math.cos(wob)) * 0.25;
    if (!stop(nx, nz)) {
      break;
    }
    px = nx;
    pz = nz;
    path.push([px, pz]);
  }
  if (path.length < 3) {
    return;
  }
  const pos: number[] = [];
  const idx: number[] = [];
  const col: RGBA[] = [];
  for (let i = 0; i < path.length; i++) {
    const [ax, az] = path[Math.max(0, i - 1)];
    const [bx, bz] = path[Math.min(path.length - 1, i + 1)];
    const tl = Math.hypot(bx - ax, bz - az) || 1;
    const sx = -(bz - az) / tl;
    const sz = (bx - ax) / tl;
    const f = i / (path.length - 1);
    const w = width * (1 - f * 0.6) * (0.75 + rnd() * 0.5);
    for (const side of [-1, 1]) {
      const vx = path[i][0] + sx * side * w / 2;
      const vz = path[i][1] + sz * side * w / 2;
      pos.push(vx, gy(vx, vz) + 0.004, vz);
      col.push([1, 1, 1, 0.8 * (1 - f * 0.7)]);
    }
  }
  for (let i = 0; i + 1 < path.length; i++) {
    const a = i * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const nrm = new Array<number>(pos.length).fill(0);
  for (let k = 0; k < nrm.length; k += 3) {
    nrm[k + 1] = 1;
  }
  // Wind every triangle upwards.
  for (let q = 0; q < idx.length; q += 3) {
    const [i, j, k] = [idx[q], idx[q + 1], idx[q + 2]];
    const ux = pos[j * 3] - pos[i * 3];
    const uz = pos[j * 3 + 2] - pos[i * 3 + 2];
    const vx = pos[k * 3] - pos[i * 3];
    const vz = pos[k * 3 + 2] - pos[i * 3 + 2];
    if (uz * vx - ux * vz < 0) {
      idx[q + 1] = k;
      idx[q + 2] = j;
    }
  }
  mesh.addMesh('soul_wet', { positions: pos, indices: idx, normals: nrm, color: col });
  stats.runoff++;
}

/** Fish scraps (heads, guts, scales) on the wet paving round a stall front. */
export function scraps(mesh: TileMesh, gy: Ground, free: Free, cx: number, cz: number, radius: number, count: number, seed: number, stats: PaperStats): void {
  const rnd = rng(seed);
  const cols = [lin(0xa9afb2), lin(0x8a5a5a), lin(0x5a2424), lin(0xc9cfd2), lin(0x6d6a60)];
  for (let k = 0; k < count; k++) {
    const a = rnd() * Math.PI * 2;
    const d = radius * Math.sqrt(rnd());
    const x = cx + Math.cos(a) * d;
    const z = cz + Math.sin(a) * d;
    if (!free(x, z)) {
      continue;
    }
    groundQuad(mesh, 'soul_litter', gy, x, z, 0.015 + rnd() * 0.02, 0.025 + rnd() * 0.04, rnd() * Math.PI, pick(cols, rnd()), 0.005);
    stats.scraps++;
  }
}
