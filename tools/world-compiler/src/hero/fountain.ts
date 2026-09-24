/**
 * Sürmeli Ali Paşa Çeşmesi (1693/94, restored 2007) on the Aya Efimia precinct wall, rebuilt from the photos c09-day
 * and context/fountain-night-close (S1 round 2, critique c09: "white plaster with a cog-like rosette, not küfeki stone
 * with a pointed niche and a marble basin"):
 * - a grey küfeki ashlar front 2.5 m wide and 3.85 m high, 0.28 m proud of the wall, framed by stepped pilaster
 *   mouldings and crowned by a three-step cornice;
 * - in the upper field two carved rosettes (three layers of rounded petals round a boss) flanking a black inscription
 *   panel with gilt calligraphy strokes;
 * - below, a raised panel with a pointed niche (1.2 m wide) under ablaq voussoirs (alternating light and dark stones)
 *   with a boss at the apex, a moulding across the niche at the spring, a carved spout plaque with a brass tap and a
 *   marble trough with a hollow basin;
 * - weathering: dark grime and black crusts under the cornice and in the recesses, worn arrises, damp at the foot,
 *   a wet stain under the tap and run-off streaks.
 * Same signature and placement as the street kit's stand-in (street/precinct-kit.ts buildFountain): the precinct
 * step calls it with the fountain's plan point on the wall face and the wall's outward heading.
 * Frames: u = outward (the fountain faces its heading), v right of it; faces use the kit's (s, y, d).
 */
import type { TileMesh } from '../mesh';
import { archCurve, Batch, faceBar, faceBox, faceBoxC, type Face, Frame, grow, hpoly, type Opening, outline, shape, span, type V2, wall } from './kit';
import { HeroWeather, rng, streakAt, type WxProfile } from './weather';

const K = 'hero_kufeki';
const KD = 'hero_kufeki_dark';
const MARBLE = 'hero_fountain_marble';

const FOUNTAIN_WX: Record<string, WxProfile> = {
  hero_kufeki: { dirt: 0.16, vary: 0.22, splash: 0.4, splashH: 0.8, damp: 0.6, dampH: 0.5, side: 0.25, up: 0.4, down: 0.4, edge: 0.5, streak: 0.45, bandH: 1.1, tint: 0.1 },
  hero_kufeki_dark: { dirt: 0.25, vary: 0.2, side: 0.2, up: 0.3, edge: 0.4, streak: 0.4, tint: 0.08 },
  hero_fountain_marble: { dirt: 0.3, vary: 0.3, up: 0.35, side: 0.2, edge: 0.55, damp: 0.5, dampH: 0.4, tint: 0.06 },
};

const HALF = 1.25;
const D = 0.28;
const TOP = 3.85;

/** Sürmeli Ali Paşa fountain at (x, z) facing `heading` (its back on the wall face), ground gy. */
export function buildFountain(target: TileMesh, x: number, z: number, heading: number, gy: number): void {
  const wx = new HeroWeather({ seed: 1693, ground: () => gy, profiles: FOUNTAIN_WX, shelters: [gy + TOP - 0.3, gy + 1.76, gy + 2.72] });
  const mesh = wx.wrap(target);
  const f = new Frame(x, z, gy, heading);
  const batch = new Batch(mesh);
  const sp = span(f, [D, HALF], [D, -HALF]);
  const face = sp.face;
  const s = (c: number): number => c + HALF;
  const niche: Opening = { s: s(0), w: 1.15, y0: 0.62, ys: 1.72, kind: 'pointed', rise: 0.64 };

  // Front with the niche cut, the returns back to the wall.
  wall(mesh, K, face, 0, 2 * HALF, -0.2, TOP - 0.3, [niche]);
  for (const side of [-1, 1]) {
    const e = side < 0 ? span(f, [0, -HALF], [D, -HALF]) : span(f, [D, HALF], [0, HALF]);
    wall(mesh, K, e.face, 0, e.len, -0.2, TOP - 0.3);
  }
  // Niche: reveal 0.26 deep, back wall, a moulding at the spring, the spout plaque and a brass tap.
  const b = batch.of(K);
  const loop = outline(niche, 16);
  for (let k = 0; k < loop.length; k++) {
    const p = loop[k];
    const q = loop[(k + 1) % loop.length];
    const ds = q[0] - p[0];
    const dy = q[1] - p[1];
    const l = Math.hypot(ds, dy) || 1;
    b.flatQuad([face.p(p[0], p[1], 0), face.p(q[0], q[1], 0), face.p(q[0], q[1], -0.26), face.p(p[0], p[1], -0.26)], face.dir(-dy / l, ds / l, 0));
  }
  shape(mesh, K, face, loop, [], -0.26);
  faceBoxC(b, face, niche.s - niche.w / 2, niche.s + niche.w / 2, niche.ys - 0.05, niche.ys + 0.04, -0.27, -0.2, 0.01);
  const plaque: V2[] = [];
  const pl0 = s(-0.2);
  const pl1 = s(0.2);
  plaque.push([pl0, 0.95], [pl1, 0.95], [pl1, 1.3]);
  for (let k = 1; k < 8; k++) {
    const t = k / 8;
    plaque.push([pl1 + (pl0 - pl1) * t, 1.3 + 0.06 * Math.abs(Math.sin(t * Math.PI * 2))]);
  }
  plaque.push([pl0, 1.3]);
  shape(mesh, K, face, plaque, [], -0.24);
  faceBoxC(b, face, pl0 - 0.02, pl1 + 0.02, 0.92, 0.95, -0.26, -0.22, 0.008);
  const tap = batch.of('hero_gilt');
  faceBox(tap, face, s(-0.018), s(0.018), 1.1, 1.14, -0.24, -0.1);
  faceBox(tap, face, s(-0.014), s(0.014), 1.05, 1.1, -0.13, -0.1);
  // Ablaq voussoirs round the arch (7 stones, dark ones in between), a boss at the apex.
  const vous = 7;
  const inner = archCurve(niche, vous * 4);
  const outer = archCurve(grow(niche, 0.22), vous * 4);
  const vd = 0.03;
  for (let k = 0; k < vous; k++) {
    const a0 = k * 4;
    const a1 = (k + 1) * 4;
    const poly: V2[] = [...inner.slice(a0, a1 + 1), ...outer.slice(a0, a1 + 1).reverse()];
    shape(mesh, k % 2 ? KD : MARBLE, face, poly, [], vd);
  }
  // The voussoir band stands proud: its outer edge and the joints' arrises.
  const vb = batch.of(K);
  for (let k = 0; k + 1 < outer.length; k++) {
    const p = outer[k];
    const q = outer[k + 1];
    const ds = q[0] - p[0];
    const dy = q[1] - p[1];
    const l = Math.hypot(ds, dy) || 1;
    vb.flatQuad([face.p(p[0], p[1], 0), face.p(q[0], q[1], 0), face.p(q[0], q[1], vd), face.p(p[0], p[1], vd)], face.dir(dy / l, -ds / l, 0));
  }
  const apexY = niche.ys + (niche.rise ?? 0) + 0.22 + 0.09;
  rosetteDisc(mesh, face, s(0), apexY, 0.06, 0.03, 10);
  // Raised panel round the arch and the niche jambs.
  const pan0 = s(-0.9);
  const pan1 = s(0.9);
  faceBoxC(b, face, pan0, pan1, 2.72, 2.8, -0.01, 0.03, 0.01);
  faceBoxC(b, face, pan0 - 0.05, pan0, 0.35, 2.8, -0.01, 0.03, 0.01, false);
  faceBoxC(b, face, pan1, pan1 + 0.05, 0.35, 2.8, -0.01, 0.03, 0.01, false);
  // Stepped pilaster mouldings and the three-step cornice.
  for (const [a, c] of [
    [0.02, 0.2],
    [2 * HALF - 0.2, 2 * HALF - 0.02],
  ]) {
    faceBoxC(b, face, a, c, -0.1, TOP - 0.3, -0.01, 0.05, 0.015, false);
    faceBoxC(b, face, a + 0.05, c - 0.05, -0.1, TOP - 0.3, 0.05, 0.08, 0.01, false);
  }
  faceBoxC(b, face, 0.02, 2 * HALF - 0.02, 3.35, 3.43, -0.01, 0.06, 0.01);
  faceBoxC(b, face, -0.06, 2 * HALF + 0.06, TOP - 0.3, TOP - 0.17, -0.3, 0.1, 0.02);
  faceBoxC(b, face, -0.12, 2 * HALF + 0.12, TOP - 0.17, TOP - 0.06, -0.3, 0.16, 0.02);
  faceBoxC(b, face, -0.18, 2 * HALF + 0.18, TOP - 0.06, TOP + 0.08, -0.3, 0.22, 0.025);
  // Upper field: two carved rosettes flanking the inscription.
  for (const side of [-1, 1]) {
    rosette(mesh, face, s(side * 0.8), 3.0, 0.27);
  }
  inscription(batch, face, s(-0.5), s(0.5), 2.84, 3.28);
  // Marble trough in front of the niche: four walls and a floor round a hollow basin with a wet bottom, a recessed
  // front panel.
  const m = batch.of(MARBLE);
  const t0 = s(-0.62);
  const t1 = s(0.62);
  const ty = 0.56;
  const wt = 0.08;
  faceBoxC(m, face, t0, t1, -0.1, ty, 0.6 - wt, 0.6, 0.02);
  faceBoxC(m, face, t0, t1, -0.1, ty, 0, wt, 0.015);
  faceBoxC(m, face, t0, t0 + wt, -0.1, ty, wt, 0.6 - wt, 0.015);
  faceBoxC(m, face, t1 - wt, t1, -0.1, ty, wt, 0.6 - wt, 0.015);
  faceBox(m, face, t0 + wt, t1 - wt, -0.1, ty - 0.22, wt, 0.6 - wt, false, false);
  const uv = (ss: number, d: number): V2 => [D + d, HALF - ss];
  hpoly(mesh, 'hero_quay_wet', f, [uv(t0 + wt, wt), uv(t1 - wt, wt), uv(t1 - wt, 0.6 - wt), uv(t0 + wt, 0.6 - wt)], ty - 0.2);
  faceBoxC(m, face, t0 + 0.12, t1 - 0.12, 0.02, ty - 0.14, 0.6, 0.62, 0.01);
  batch.flush();
  // Wet stain under the tap, black run-off under the cornice and the inscription.
  streakAt(target, face.offset(-0.26), s(0), 1.02, 0.34, 0.5, [0.16, 0.14, 0.12, 0.75], 5, 0.004);
  for (const [c, w, l, sd] of [
    [-0.95, 0.4, 1.4, 1],
    [-0.35, 0.3, 0.8, 2],
    [0.55, 0.35, 1.1, 3],
    [1.0, 0.25, 1.6, 4],
  ]) {
    streakAt(target, face, s(c), TOP - 0.31, w, l, [0.16, 0.15, 0.14, 0.7], sd, 0.006);
  }
}

/** A carved rosette: three layers of rounded petals stepping out of the field round a boss. */
function rosette(mesh: TileMesh, face: Face, cs: number, cy: number, R: number): void {
  const layers: [number, number, number][] = [
    [R, 12, 0.02],
    [R * 0.72, 10, 0.038],
    [R * 0.45, 8, 0.054],
  ];
  for (const [r, n, d] of layers) {
    const pts: V2[] = [];
    const N = n * 6;
    for (let k = 0; k < N; k++) {
      const a = (k / N) * Math.PI * 2;
      const lobe = Math.pow(Math.abs(Math.sin((a * n) / 2)), 0.6);
      const rr = r * (0.84 + 0.16 * lobe);
      pts.push([cs + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
    shape(mesh, K, face, pts, [], d);
    // Rim: the step from the layer below.
    const b = new Batch(mesh).of(K);
    for (let k = 0; k < N; k++) {
      const p = pts[k];
      const q = pts[(k + 1) % N];
      const ds = q[0] - p[0];
      const dy = q[1] - p[1];
      const l = Math.hypot(ds, dy) || 1;
      b.flatQuad([face.p(p[0], p[1], d - 0.018), face.p(q[0], q[1], d - 0.018), face.p(q[0], q[1], d), face.p(p[0], p[1], d)], face.dir(dy / l, -ds / l, 0));
    }
    b.flush(mesh, K);
  }
  rosetteDisc(mesh, face, cs, cy, R * 0.16, 0.07, 10);
}

/** A small round boss (disc with a rim) at (cs, cy), its face at depth d. */
function rosetteDisc(mesh: TileMesh, face: Face, cs: number, cy: number, r: number, d: number, n: number): void {
  const pts: V2[] = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    pts.push([cs + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  shape(mesh, K, face, pts, [], d);
  const b = new Batch(mesh).of(K);
  for (let k = 0; k < n; k++) {
    const p = pts[k];
    const q = pts[(k + 1) % n];
    const ds = q[0] - p[0];
    const dy = q[1] - p[1];
    const l = Math.hypot(ds, dy) || 1;
    b.flatQuad([face.p(p[0], p[1], d - 0.03), face.p(q[0], q[1], d - 0.03), face.p(q[0], q[1], d), face.p(p[0], p[1], d)], face.dir(dy / l, -ds / l, 0));
  }
  b.flush(mesh, K);
}

/** Black inscription panel with a gilt border and two lines of gilt calligraphy strokes (not lit). */
function inscription(batch: Batch, face: Face, p0: number, p1: number, y0: number, y1: number): void {
  faceBoxC(batch.of('hero_inscription'), face, p0, p1, y0, y1, -0.01, 0.03, 0.008);
  const gilt = batch.of('hero_gilt');
  const stroke = (pts: V2[], w = 0.009): void => {
    for (let k = 0; k + 1 < pts.length; k++) {
      faceBar(gilt, face, pts[k], pts[k + 1], w * 2, 0.03);
    }
  };
  // Two lines of pseudo-thuluth read right to left: tall shafts (elif, lam), long baseline sweeps with upturned ends,
  // bowls dipping under the line, diagonal vowel strokes and dots above, all deterministic.
  const r = rng(1694);
  for (let row = 0; row < 2; row++) {
    const yb = y0 + 0.09 + row * 0.19;
    let sx = p1 - 0.07;
    while (sx > p0 + 0.1) {
      const k = r();
      if (k < 0.3) {
        const hh = 0.08 + 0.07 * r();
        stroke([
          [sx, yb - 0.005],
          [sx - 0.012, yb + hh],
        ]);
        sx -= 0.035 + 0.02 * r();
      } else if (k < 0.55) {
        const w = 0.1 + 0.12 * r();
        stroke([
          [sx, yb + 0.03],
          [sx - 0.01, yb],
          [sx - w * 0.5, yb - 0.008],
          [sx - w, yb + 0.004],
          [sx - w - 0.015, yb + 0.035],
        ]);
        sx -= w + 0.02;
      } else if (k < 0.75) {
        const w = 0.06 + 0.04 * r();
        const bowl: V2[] = [];
        for (let i = 0; i <= 6; i++) {
          const a = (i / 6) * Math.PI;
          bowl.push([sx - w / 2 + (Math.cos(a) * w) / 2, yb - Math.sin(a) * 0.045]);
        }
        stroke(bowl);
        sx -= w + 0.015;
      } else {
        const w = 0.05 + 0.03 * r();
        stroke([
          [sx, yb],
          [sx - w, yb],
          [sx - w - 0.01, yb + 0.05],
        ]);
        sx -= w + 0.02;
      }
      if (r() < 0.45) {
        stroke(
          [
            [sx + 0.02, yb + 0.1],
            [sx + 0.05, yb + 0.12],
          ],
          0.006,
        );
      }
      if (r() < 0.35) {
        faceBox(gilt, face, sx + 0.01, sx + 0.024, yb + 0.07, yb + 0.084, 0.03, 0.036);
      }
    }
  }
}
