/**
 * Sign lettering as geometry: a monoline sans-serif stroke font drawn for this compiler (original glyphs, part of
 * this repository under its MIT licence; no external font file is read). Capitals A–Z with the Turkish letters
 * Ç Ğ İ Ö Ş Ü, digits and a few marks: enough for Turkish shop signs, which are set in capitals.
 *
 * Glyphs are centre-line polylines in units of the cap height (y 0 = baseline, 1 = cap line; accents go above 1 and
 * cedillas below 0). Each segment becomes a flat bar of the stroke weight with square caps, optionally with side
 * faces (box letters, "kutu harf").
 */
import type { RGBA } from '../mesh';
import type { Batch } from '../facade/frame';
import type { MaterialName } from '../materials';

type Pt = [number, number];
type Glyph = { w: number; strokes: Pt[][] };

/** Stroke weight (cap heights) and the inset of centre lines from the glyph box. */
export const STROKE = 0.16;
const m = STROKE / 2;
const b = m;
const t = 1 - m;
const MID = 0.52;
/** Letter spacing (cap heights). */
export const TRACK = 0.13;

function arc(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number): Pt[] {
  const n = Math.max(3, Math.ceil(Math.abs(a1 - a0) / 24));
  const out: Pt[] = [];
  for (let k = 0; k <= n; k++) {
    const a = ((a0 + ((a1 - a0) * k) / n) * Math.PI) / 180;
    out.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return out;
}

const dot = (x: number, y: number): Pt[] => [
  [x, y - 0.045],
  [x, y + 0.045],
];
const dots = (w: number): Pt[][] => [dot(w / 2 - 0.13, 1.17), dot(w / 2 + 0.13, 1.17)];
const cedilla = (x: number): Pt[] => [
  [x, 0.02],
  [x + 0.02, -0.1],
  [x - 0.07, -0.2],
];
const breve = (w: number): Pt[] => arc(w / 2, 1.24, 0.15, 0.11, 200, 340);

function G(w: number, ...strokes: Pt[][]): Glyph {
  return { w, strokes };
}

function build(): Record<string, Glyph> {
  const W = 0.64;
  const R = W - m;
  const cx = W / 2;
  const rx = W / 2 - m;
  const g: Record<string, Glyph> = {};
  const legX = (y: number): number => m + (cx - m) * ((y - b) / (t - b));
  g.A = G(W + 0.04, [[m, b], [cx + 0.02, t], [W + 0.04 - m, b]], [[legX(0.33) + 0.01, 0.33], [W + 0.04 - legX(0.33) - 0.01, 0.33]]);
  g.B = G(W, [[m, b], [m, t], [R - 0.2, t], ...arc(R - 0.2, (t + MID) / 2, 0.19, (t - MID) / 2, 90, -90), [m, MID]], [[m, MID], [R - 0.22, MID], ...arc(R - 0.22, (MID + b) / 2, 0.22, (MID - b) / 2, 90, -90), [m, b]]);
  g.C = G(W, arc(cx, 0.5, rx, 0.5 - m, 40, 320));
  g.Ç = G(W, arc(cx, 0.5, rx, 0.5 - m, 40, 320), cedilla(cx));
  g.D = G(W, [[m, b], [m, t], [R - 0.26, t], ...arc(R - 0.26, t - 0.26, 0.26, 0.26, 90, 0), [R, b + 0.26], ...arc(R - 0.26, b + 0.26, 0.26, 0.26, 0, -90), [m, b]]);
  g.E = G(W - 0.04, [[R - 0.04, t], [m, t], [m, b], [R - 0.04, b]], [[m, MID], [R - 0.1, MID]]);
  g.F = G(W - 0.06, [[R - 0.06, t], [m, t], [m, b]], [[m, MID], [R - 0.12, MID]]);
  g.G = G(W + 0.02, [...arc(cx + 0.01, 0.5, rx + 0.01, 0.5 - m, 42, 360), [cx + 0.03, 0.5]]);
  g.Ğ = G(W + 0.02, [...arc(cx + 0.01, 0.5, rx + 0.01, 0.5 - m, 42, 360), [cx + 0.03, 0.5]], breve(W));
  g.H = G(W, [[m, b], [m, t]], [[R, b], [R, t]], [[m, MID], [R, MID]]);
  g.I = G(STROKE, [[m, b], [m, t]]);
  g.İ = G(STROKE, [[m, b], [m, t]], dot(m, 1.17));
  g.J = G(W - 0.06, [[R - 0.06, t], [R - 0.06, 0.32], ...arc((W - 0.06) / 2, 0.32, (W - 0.06) / 2 - m, 0.32 - m, 0, -180)]);
  g.K = G(W, [[m, b], [m, t]], [[R, t], [m + 0.02, 0.4]], [[m + 0.17, 0.53], [R, b]]);
  g.L = G(W - 0.08, [[m, t], [m, b], [R - 0.08, b]]);
  g.M = G(0.82, [[m, b], [m, t], [0.41, 0.3], [0.82 - m, t], [0.82 - m, b]]);
  g.N = G(W, [[m, b], [m, t], [R, b], [R, t]]);
  g.O = G(W + 0.06, arc(cx + 0.03, 0.5, rx + 0.03, 0.5 - m, 0, 360));
  g.Ö = G(W + 0.06, arc(cx + 0.03, 0.5, rx + 0.03, 0.5 - m, 0, 360), ...dots(W + 0.06));
  g.P = G(W, [[m, b], [m, t], [R - 0.22, t], ...arc(R - 0.22, (t + 0.44) / 2, 0.22, (t - 0.44) / 2, 90, -90), [m, 0.44]]);
  g.Q = G(W + 0.06, arc(cx + 0.03, 0.5, rx + 0.03, 0.5 - m, 0, 360), [[cx + 0.1, 0.24], [W + 0.06 - m + 0.02, b - 0.03]]);
  g.R = G(W, [[m, b], [m, t], [R - 0.22, t], ...arc(R - 0.22, (t + 0.46) / 2, 0.22, (t - 0.46) / 2, 90, -90), [m, 0.46]], [[cx - 0.02, 0.46], [R, b]]);
  const sTop = arc(cx, 0.73, rx, t - 0.73, 25, 270);
  const sBot = arc(cx, 0.28, rx, 0.28 - b, 90, -155);
  g.S = G(W, [...sTop, ...sBot]);
  g.Ş = G(W, [...sTop, ...sBot], cedilla(cx));
  g.T = G(W, [[m, t], [R, t]], [[cx, t], [cx, b]]);
  g.U = G(W, [[m, t], [m, 0.34], ...arc(cx, 0.34, rx, 0.34 - m, 180, 360), [R, t]]);
  g.Ü = G(W, [[m, t], [m, 0.34], ...arc(cx, 0.34, rx, 0.34 - m, 180, 360), [R, t]], ...dots(W));
  g.V = G(W + 0.04, [[m, t], [cx + 0.02, b], [W + 0.04 - m, t]]);
  g.W = G(0.92, [[m, t], [0.24, b], [0.46, 0.62], [0.68, b], [0.92 - m, t]]);
  g.X = G(W, [[m, t], [R, b]], [[R, t], [m, b]]);
  g.Y = G(W, [[m, t], [cx, 0.48], [R, t]], [[cx, 0.48], [cx, b]]);
  g.Z = G(W, [[m, t], [R, t], [m, b], [R, b]]);
  const D = 0.56;
  const dc = D / 2;
  const drx = D / 2 - m;
  g['0'] = G(D, arc(dc, 0.5, drx, 0.5 - m, 0, 360));
  g['1'] = G(0.42, [[0.08, t - 0.14], [0.3, t], [0.3, b]]);
  g['2'] = G(D, [...arc(dc, 0.71, drx, t - 0.71, 160, -35), [m, b], [D - m, b]]);
  g['3'] = G(D, [...arc(dc, 0.73, drx * 0.95, t - 0.73, 150, -90), ...arc(dc, 0.28, drx, 0.28 - b, 90, -150)]);
  g['4'] = G(D + 0.04, [[D - 0.1, b], [D - 0.1, t], [m, 0.32], [D + 0.04 - m, 0.32]]);
  g['5'] = G(D, [[D - m, t], [m + 0.02, t], [m, 0.56], [dc, 0.575], ...arc(dc, 0.3, drx, 0.3 - b, 80, -150)]);
  g['6'] = G(D, [...arc(dc, 0.5, drx, 0.5 - m, 70, 180), ...arc(dc, 0.3, drx, 0.3 - b, 180, 540)]);
  g['7'] = G(D, [[m, t], [D - m, t], [dc - 0.04, b]]);
  g['8'] = G(D, arc(dc, 0.74, drx * 0.9, t - 0.74, -90, 270), arc(dc, 0.29, drx, 0.29 - b, 90, 450));
  g['9'] = G(D, [...arc(dc, 0.7, drx, t - 0.7, 0, 360), ...arc(dc, 0.5, drx, 0.5 - m, 0, -110)]);
  g['.'] = G(STROKE, [[m, b - 0.02], [m, b + 0.07]]);
  g['-'] = G(0.42, [[m, 0.46], [0.42 - m, 0.46]]);
  g["'"] = G(STROKE, [[m, t], [m, t - 0.2]]);
  g[' '] = G(0.34);
  return g;
}

const GLYPHS = build();

/** Width of a text in cap heights (with tracking). */
export function textWidth(text: string): number {
  let w = 0;
  for (const ch of text) {
    w += (GLYPHS[ch] ?? GLYPHS[' ']).w + TRACK;
  }
  return Math.max(0, w - TRACK);
}

/** True when every character has a glyph. */
export const hasGlyphs = (text: string): boolean => [...text].every((c) => c in GLYPHS);

/** Every character with a glyph (the module library authors one glyph module per character). */
export const glyphChars = (): string[] => Object.keys(GLYPHS);

export interface TextOptions {
  material: MaterialName;
  color: RGBA;
  /** Frame r of the text's centre, y of the baseline, d of the letter faces. */
  r: number;
  y: number;
  d: number;
  capH: number;
  /** Box letters: depth of the side faces behind the face (0 = flat). */
  depth: number;
  /** Mirror for texts read from the other side of a projecting sign (the batch frame faces away). */
  mirror?: boolean;
}

/**
 * Emits a text centred on (r, y) in the batch's frame, facing +N at depth d. Returns the triangles emitted.
 */
export function emitText(batch: Batch, text: string, o: TextOptions): number {
  const before = batch.tris;
  const s = o.capH;
  const hw = (STROKE / 2) * s;
  let x = -(textWidth(text) * s) / 2;
  const dir = o.mirror ? -1 : 1;
  for (const ch of text) {
    const gl = GLYPHS[ch] ?? GLYPHS[' '];
    for (const line of gl.strokes) {
      for (let k = 0; k + 1 < line.length; k++) {
        const p = line[k];
        const q = line[k + 1];
        const pr = o.r + dir * (x + p[0] * s);
        const py = o.y + p[1] * s;
        const qr = o.r + dir * (x + q[0] * s);
        const qy = o.y + q[1] * s;
        const len = Math.hypot(qr - pr, qy - py);
        if (len < 1e-5) {
          continue;
        }
        const ur = (qr - pr) / len;
        const uy = (qy - py) / len;
        // Square caps: extend by half the stroke; the normal in the (r, y) plane.
        const ar = pr - ur * hw;
        const ay = py - uy * hw;
        const br = qr + ur * hw;
        const by = qy + uy * hw;
        const nr = -uy * hw;
        const ny = ur * hw;
        const c: [number, number][] = [
          [ar + nr, ay + ny],
          [br + nr, by + ny],
          [br - nr, by - ny],
          [ar - nr, ay - ny],
        ];
        batch.quadF(
          o.material,
          'N',
          c.map(([r, y]) => [r, y, o.d] as [number, number, number]),
          o.color,
        );
        if (o.depth > 0) {
          const d0 = o.d - o.depth;
          for (let e = 0; e < 4; e++) {
            const [r0, y0] = c[e];
            const [r1, y1] = c[(e + 1) % 4];
            const f = batch.f;
            // Outward normal of this side in the (r, y) plane.
            const er = r1 - r0;
            const ey = y1 - y0;
            const el = Math.hypot(er, ey) || 1;
            let sr = ey / el;
            let sy = -er / el;
            const mr = (r0 + r1) / 2 - (c[0][0] + c[2][0]) / 2;
            const my = (y0 + y1) / 2 - (c[0][1] + c[2][1]) / 2;
            if (sr * mr + sy * my < 0) {
              sr = -sr;
              sy = -sy;
            }
            // Side normals snap to 22.5° steps so a sign's sides stay a few lightmap charts.
            const ang = Math.round(Math.atan2(sy, sr) / (Math.PI / 8)) * (Math.PI / 8);
            sr = Math.cos(ang);
            sy = Math.sin(ang);
            batch.poly(o.material, f.vec(sr, sy, 0), [f.p(r0, y0, o.d), f.p(r1, y1, o.d), f.p(r1, y1, d0), f.p(r0, y0, d0)], o.color);
          }
        }
      }
    }
    x += (gl.w + TRACK) * s;
  }
  return batch.tris - before;
}
