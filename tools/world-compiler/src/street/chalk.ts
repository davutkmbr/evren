/**
 * Chalk menus for the approved A-frame board (standing_chalkboard_01): fictional Turkish text written as thin chalk
 * strokes on both board faces, as a separate prop placed with the board's transform (same foot and yaw). A small
 * single-stroke font (capitals incl. Ç Ğ İ Ö Ş Ü, digits, ₺) on a 4 x 6 grid, with a slight hand-written wobble.
 *
 * Board faces of the model (prop space): x -0.37..0.40, y 0.32..1.44, leaning 12° inwards (z = 0.298 - 0.211 (y -
 * 0.319) on the +Z face, mirrored on the -Z face).
 */
import type { PropDef } from '../props';
import type { TileMesh, Vec3 } from '../mesh';

type Stroke = [number, number][];

const C: Stroke = [[4, 5], [3, 6], [1, 6], [0, 5], [0, 1], [1, 0], [3, 0], [4, 1]];
const O: Stroke = [[1, 0], [0, 1], [0, 5], [1, 6], [3, 6], [4, 5], [4, 1], [3, 0], [1, 0]];
const S: Stroke = [[4, 5], [3, 6], [1, 6], [0, 5], [0, 4], [1, 3], [3, 3], [4, 2], [4, 1], [3, 0], [1, 0], [0, 1]];
const U: Stroke = [[0, 6], [0, 1], [1, 0], [3, 0], [4, 1], [4, 6]];
const G: Stroke = [...C.slice(0, 7), [4, 1], [4, 3], [2, 3]];
const P: Stroke = [[0, 0], [0, 6], [3, 6], [4, 5], [4, 4], [3, 3], [0, 3]];
const CEDILLA: Stroke = [[2, 0], [2, -0.8], [1.2, -1.4]];
const DOTS: Stroke[] = [[[1, 7], [1, 7.5]], [[3, 7], [3, 7.5]]];

const GLYPHS: Record<string, { w: number; s: Stroke[] }> = {
  A: { w: 4, s: [[[0, 0], [2, 6], [4, 0]], [[1, 3], [3, 3]]] },
  B: { w: 4, s: [[[0, 0], [0, 6], [3, 6], [4, 5], [4, 4], [3, 3], [0, 3]], [[3, 3], [4, 2], [4, 1], [3, 0], [0, 0]]] },
  C: { w: 4, s: [C] },
  Ç: { w: 4, s: [C, CEDILLA] },
  D: { w: 4, s: [[[0, 0], [0, 6], [2, 6], [4, 4], [4, 2], [2, 0], [0, 0]]] },
  E: { w: 4, s: [[[4, 6], [0, 6], [0, 0], [4, 0]], [[0, 3], [3, 3]]] },
  G: { w: 4, s: [G] },
  Ğ: { w: 4, s: [G, [[1, 7.6], [2, 7], [3, 7.6]]] },
  H: { w: 4, s: [[[0, 0], [0, 6]], [[4, 0], [4, 6]], [[0, 3], [4, 3]]] },
  I: { w: 1, s: [[[0.5, 0], [0.5, 6]]] },
  İ: { w: 1, s: [[[0.5, 0], [0.5, 6]], [[0.5, 7], [0.5, 7.5]]] },
  K: { w: 4, s: [[[0, 0], [0, 6]], [[4, 6], [0, 2]], [[1.3, 3.2], [4, 0]]] },
  L: { w: 4, s: [[[0, 6], [0, 0], [4, 0]]] },
  M: { w: 5, s: [[[0, 0], [0, 6], [2.5, 3], [5, 6], [5, 0]]] },
  N: { w: 4, s: [[[0, 0], [0, 6], [4, 0], [4, 6]]] },
  O: { w: 4, s: [O] },
  Ö: { w: 4, s: [O, ...DOTS] },
  P: { w: 4, s: [P] },
  R: { w: 4, s: [P, [[2, 3], [4, 0]]] },
  S: { w: 4, s: [S] },
  Ş: { w: 4, s: [S, CEDILLA] },
  T: { w: 4, s: [[[0, 6], [4, 6]], [[2, 6], [2, 0]]] },
  U: { w: 4, s: [U] },
  Ü: { w: 4, s: [U, ...DOTS] },
  V: { w: 4, s: [[[0, 6], [2, 0], [4, 6]]] },
  Y: { w: 4, s: [[[0, 6], [2, 3], [4, 6]], [[2, 3], [2, 0]]] },
  0: { w: 4, s: [O] },
  1: { w: 3, s: [[[0.5, 5], [1.5, 6], [1.5, 0]], [[0.5, 0], [2.5, 0]]] },
  2: { w: 4, s: [[[0, 5], [1, 6], [3, 6], [4, 5], [4, 4], [0, 0], [4, 0]]] },
  5: { w: 4, s: [[[4, 6], [0, 6], [0, 3.5], [3, 3.5], [4, 2.5], [4, 1], [3, 0], [0, 0]]] },
  6: { w: 4, s: [[[4, 5], [3, 6], [1, 6], [0, 5], [0, 1], [1, 0], [3, 0], [4, 1], [4, 2], [3, 3], [0, 3]]] },
  8: { w: 4, s: [[[1, 3], [0, 4], [0, 5], [1, 6], [3, 6], [4, 5], [4, 4], [3, 3], [1, 3], [0, 2], [0, 1], [1, 0], [3, 0], [4, 1], [4, 2], [3, 3]]] },
  9: { w: 4, s: [[[4, 3], [1, 3], [0, 4], [0, 5], [1, 6], [3, 6], [4, 5], [4, 1], [3, 0], [1, 0]]] },
  '₺': { w: 4, s: [[[1.5, 6], [1.5, 0], [3, 0.5], [4, 2]], [[0.5, 3.4], [3, 4.4]], [[0.5, 2], [3, 3]]] },
  '-': { w: 3, s: [[[0.5, 3], [2.5, 3]]] },
  ' ': { w: 2, s: [] },
};

/** Fictional menus (Turkish), three lines each. */
export const MENUS: string[][] = [
  ['ÇAY 20₺', 'TOST 90₺', 'SİMİT 25₺'],
  ['GÜNÜN', 'ÇORBASI', 'MERCİMEK'],
  ['KAHVE 60₺', 'SICAK', 'ÇAY'],
  ['KÜNEFE', '120₺', 'HOŞ GELDİNİZ'],
  ['BALIK', 'EKMEK', '95₺'],
  ['MENEMEN', 'PİDE', 'AÇIK'],
];

const hash = (n: number): number => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/** Board plane point of the +Z face at (x, y), lifted 4 mm along its normal. */
const FRONT = (x: number, y: number): Vec3 => [x, y, 0.298 - 0.211 * (y - 0.319) + 0.005];
const NORMAL: Vec3 = [0, 0.208, 0.978];

function writeMenu(mesh: TileMesh, lines: string[], seed: number): void {
  const pos: number[] = [];
  const nrm: number[] = [];
  const idx: number[] = [];
  const unitH = 0.016;
  const gap = 1.3;
  const width = 0.6;
  const lineY = [1.24, 1.03, 0.82];
  lines.forEach((line, li) => {
    const chars = [...line];
    const units = chars.reduce((w, ch) => w + (GLYPHS[ch]?.w ?? 3) + gap, -gap);
    const scale = Math.min(unitH, width / units);
    let cx = -((units * scale) / 2) + 0.015;
    const baseY = lineY[li] - (6 * scale) / 2;
    chars.forEach((ch, ci) => {
      const g = GLYPHS[ch] ?? GLYPHS[' '];
      for (const [si, stroke] of g.s.entries()) {
        const pts = stroke.map(([u, v], k): [number, number] => {
          const j = (hash(seed * 13.1 + li * 7.3 + ci * 3.7 + si * 1.9 + k) - 0.5) * 0.25;
          const jv = (hash(seed * 5.3 + li * 2.1 + ci * 9.7 + si * 4.1 + k) - 0.5) * 0.25;
          return [cx + (u + j) * scale, baseY + (v + jv) * scale + (hash(li * 3 + ci) - 0.5) * 0.004];
        });
        for (let k = 1; k < pts.length; k++) {
          const [x0, y0] = pts[k - 1];
          const [x1, y1] = pts[k];
          const l = Math.hypot(x1 - x0, y1 - y0) || 1e-6;
          const hw = 0.0055;
          const ox = (-(y1 - y0) / l) * hw;
          const oy = ((x1 - x0) / l) * hw;
          // Extend each stroke by its half width at both ends so joints close.
          const ex = ((x1 - x0) / l) * hw;
          const ey = ((y1 - y0) / l) * hw;
          const quad: Vec3[] = [FRONT(x0 - ex + ox, y0 - ey + oy), FRONT(x0 - ex - ox, y0 - ey - oy), FRONT(x1 + ex - ox, y1 + ey - oy), FRONT(x1 + ex + ox, y1 + ey + oy)];
          for (const face of [1, -1]) {
            const base = pos.length / 3;
            for (const p of quad) {
              // The -Z face mirrors the board: x -> -x reads correctly from behind.
              pos.push(face * p[0], p[1], face * p[2]);
              nrm.push(0, NORMAL[1], face * NORMAL[2]);
            }
            idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
          }
        }
      }
      cx += (g.w + gap) * scale;
    });
  });
  // Wind every triangle to face its normal.
  for (let q = 0; q < idx.length; q += 3) {
    const [i, j, k] = [idx[q], idx[q + 1], idx[q + 2]];
    const ux = pos[j * 3] - pos[i * 3];
    const uy = pos[j * 3 + 1] - pos[i * 3 + 1];
    const uz = pos[j * 3 + 2] - pos[i * 3 + 2];
    const vx = pos[k * 3] - pos[i * 3];
    const vy = pos[k * 3 + 1] - pos[i * 3 + 1];
    const vz = pos[k * 3 + 2] - pos[i * 3 + 2];
    const f = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    if (f[0] * nrm[i * 3] + f[1] * nrm[i * 3 + 1] + f[2] * nrm[i * 3 + 2] < 0) {
      idx[q + 1] = k;
      idx[q + 2] = j;
    }
  }
  mesh.addMesh('st_chalk', { positions: pos, indices: idx, normals: nrm });
}

export const CHALK_PROPS: PropDef[] = [
  {
    id: 'st_chalk_menu',
    drawDistance: 30,
    castShadow: false,
    build: (b) => MENUS.forEach((lines, k) => b.variant(`menu${k}`, (m) => writeMenu(m, lines, k + 1))),
  },
];
