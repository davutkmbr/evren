/**
 * Shopfront modules (shopfront/shopfront.ts emitShopUnit): the threshold step, the kepenk (guide rails and coil box,
 * the curtain let down to its height), the aluminium glazing (runs of panes with posts every 1.6 m or less, the
 * entrance door with its transom), the sign board, the projecting (blade) sign and the awning. Texts on them are
 * text slots (text.ts). Slot origins are on the wall face at the unit's left end (r0) unless a family says otherwise.
 */
import { lin } from '../facade/frame';
import { SIGN_GLOW, type SignGlow } from '../facade/materials';
import type { RGBA } from '../mesh';
import type { AuthorCtx, FamilySpec, VariantSpec } from './spec';

const g = (k: number): RGBA => [k, k, k, 1];
const W1: RGBA = [1, 1, 1, 1];
const INF = 1e3;
/** Reveal depth of a shop opening and the glazing plane (shopfront.ts RV). */
const RV = 0.3;
const FW = 0.06;

/** Glazing bay (w; h = head height over the floor): post at the bay's left, kick panel, pane, head rail (tint 0 = aluminium). */
function glassBay(c: AuthorCtx): void {
  const { b, w: W, h: H } = c;
  const d = -RV;
  const kick = 0.3;
  c.tint(0, () => {
    b.box('fac_alu', 0, FW, kick, H - FW, d, d + 0.07, W1, { front: true, left: true, right: true });
    b.box('fac_alu', 0, W, 0, kick, d, d + 0.06, W1, { front: true, top: true });
    b.box('fac_alu', 0, W, H - FW, H, d, d + 0.06, W1, { front: true, bottom: true });
  });
  b.quadF('fac_glass', 'N', [[FW, kick, d + 0.03], [W, kick, d + 0.03], [W, H - FW, d + 0.03], [FW, H - FW, d + 0.03]], [0.26, 0.31, 0.34, 0.42]);
}

/** The right-hand end post of a unit's glazing. */
function glassEnd(c: AuthorCtx): void {
  const { b, w: W, h: H } = c;
  c.tint(0, () => b.box('fac_alu', W - FW, W, 0.3, H - FW, -RV, -RV + 0.07, W1, { front: true, left: true, right: true }));
}

/**
 * The entrance door of a unit (w = post + leaf; h = head height): the leaf's left post from the floor, the transom
 * (2.2 m, or 0.3 m under the head when that is lower), glass over it and in the leaf, the push bar, the kick rail.
 */
function glassDoor(high: boolean) {
  return (c: AuthorCtx): void => {
    const { b, w: W, h: H } = c;
    const d = -RV;
    const tr = high ? 2.2 : H - 0.3;
    c.tint(0, () => {
      b.box('fac_alu', 0, FW, 0, H - FW, d, d + 0.07, W1, { front: true, left: true, right: true });
      b.box('fac_alu', FW, W, tr, tr + FW, d, d + 0.07, W1, { front: true, top: true, bottom: true });
      b.box('fac_alu', 0, W, 0, 0.3, d, d + 0.06, W1, { front: true, top: true });
      b.box('fac_alu', 0, W, H - FW, H, d, d + 0.06, W1, { front: true, bottom: true });
    });
    const glass: RGBA = [0.26, 0.31, 0.34, 0.42];
    b.quadF('fac_glass', 'N', [[FW, tr + FW, d + 0.03], [W, tr + FW, d + 0.03], [W, H - FW, d + 0.03], [FW, H - FW, d + 0.03]], glass);
    b.quadF('fac_glass', 'N', [[FW, 0, d + 0.03], [W, 0, d + 0.03], [W, tr, d + 0.03], [FW, tr, d + 0.03]], glass);
    b.box('fac_alu', FW + 0.08, W - 0.08, 1.0, 1.04, d + 0.07, d + 0.12, lin(0xd0d2d4), { front: true, top: true, bottom: true, left: true, right: true });
  };
}

/** Kepenk guide rails and coil box (h = rail height; the box is the 0.32 m above it; tint 0 = paint). */
function kepenkFrame(c: AuthorCtx): void {
  const { b, w: W, h: H } = c;
  c.tint(0, () => {
    b.box('fac_kepenk', 0, 0.07, 0, H, -0.14, -0.05, W1, { front: true, right: true });
    b.box('fac_kepenk', W - 0.07, W, 0, H, -0.14, -0.05, W1, { front: true, left: true });
    b.box('fac_kepenk', 0, W, H, H + 0.32, -RV, -0.03, W1, { front: true, bottom: true });
  });
}

/** Kepenk curtain let down h from the coil box (origin at its bottom edge) with its bottom bar. */
function kepenkCurtain(c: AuthorCtx): void {
  const { b, w: W, h: H } = c;
  c.tint(0, () => {
    b.quadF('fac_kepenk', 'N', [[0.035, 0, -0.09], [W - 0.035, 0, -0.09], [W - 0.035, H, -0.09], [0.035, H, -0.09]], W1);
    b.box('fac_kepenk', 0.035, W - 0.035, 0, 0.06, -0.12, -0.08, g(0.7), { front: true, bottom: true, top: true });
  });
}

/** Sign board (w, h; 0.14 deep): body in fac_sign (tint 0 = panel) and the face (tint 1), lit faces renamed by style. */
function signBoard(c: AuthorCtx): void {
  const { b, w: W, h: H } = c;
  const dS = 0.14;
  c.tint(0, () => b.box('fac_sign', 0, W, 0, H, 0, dS, g(0.9), { top: true, bottom: true, left: true, right: true }));
  c.tint(1, () => b.quadF('fac_glow_white', 'N', [[0, 0, dS], [W, 0, dS], [W, H, dS], [0, H, dS]], W1));
}

/** Projecting sign (origin at its axis on the wall at the bottom): bracket, box, two faces (tint 0 panel, tint 1 face). */
function bladeSign(c: AuthorCtx): void {
  const { b } = c;
  const t = 0.05;
  const dIn = 0.2;
  const dOut = 0.85;
  const y1 = 0.5;
  b.box('fac_metal', -0.015, 0.015, y1, y1 + 0.03, 0, dOut, lin(0x2a2a2a), { top: true, bottom: true, left: true, right: true, front: true });
  c.tint(0, () => b.box('fac_sign', -t, t, 0, y1, dIn, dOut, W1, { top: true, bottom: true, front: true }));
  c.tint(1, () => {
    b.quadF('fac_glow_white', 'R', [[t, 0, dIn], [t, 0, dOut], [t, y1, dOut], [t, y1, dIn]], W1);
    b.quadF('fac_glow_white', '-R', [[-t, 0, dIn], [-t, 0, dOut], [-t, y1, dOut], [-t, y1, dIn]], W1);
  });
}

/** Threshold step under a unit (terrazzo or marble). */
function step(c: AuthorCtx): void {
  c.b.box('fac_terrazzo', 0, c.w, -0.35, 0, -RV - 0.02, 0.03, lin(0x9c9890), { front: true, top: true });
}

/**
 * Awning of n stripes (tint 0 and 1 alternate; one colour: both the same): roller box on the wall at the origin
 * (y = mount height), the canvas bellying between the roller and the front bar h lower and d out, the scalloped
 * valance, the bar and the folding arms. The belly and the bar's droop follow the stripe's place across the width,
 * so each stripe count is its own variant.
 */
function awning(n: number, market: boolean) {
  return (c: AuthorCtx): void => {
    const { b, w: Wd, h: drop, d: D } = c;
    const f = b.f;
    // The slot spans the unit; the awning overhangs it by 0.1 m on both sides.
    const a0 = -0.1;
    const a1 = Wd + 0.1;
    const sag = market ? 0.095 : 0.06;
    const barDroop = 0.027;
    const tm = 0.55;
    const yMount = 0;
    const yFront = -drop;
    const yMid = yMount + 0.02 + (yFront - yMount - 0.02) * tm;
    const nBack = f.vec(0, D * tm, drop * tm + sag * 0.7);
    const nFront = f.vec(0, D * (1 - tm), drop * (1 - tm) - sag * 0.7);
    b.box('fac_alu', a0, a1, yMount, yMount + 0.16, 0, 0.18, lin(0xcfcfca), { front: true, top: true, bottom: true, left: true, right: true });
    const grime = 0.71;
    const val = 0.22;
    const across = (t: number): number => Math.sin(Math.PI * t);
    for (let k = 0; k < n; k++) {
      const t0 = k / n;
      const t1 = (k + 1) / n;
      const x0 = a0 + (a1 - a0) * t0;
      const x1 = a0 + (a1 - a0) * t1;
      const s0 = sag * (0.45 + 0.55 * across(t0));
      const s1 = sag * (0.45 + 0.55 * across(t1));
      const f0 = yFront - barDroop * across(t0);
      const f1 = yFront - barDroop * across(t1);
      c.tint(k % 2, () => {
        b.poly('fac_awning', nBack, [f.p(x0, yMount + 0.02, 0.12), f.p(x1, yMount + 0.02, 0.12), f.p(x1, yMid - s1, D * tm), f.p(x0, yMid - s0, D * tm)], [g(0.97), g(0.97), g((0.97 + grime) / 2), g((0.97 + grime) / 2)]);
        b.poly('fac_awning', nFront, [f.p(x0, yMid - s0, D * tm), f.p(x1, yMid - s1, D * tm), f.p(x1, f1, D), f.p(x0, f0, D)], [g((0.97 + grime) / 2), g((0.97 + grime) / 2), g(grime), g(grime)]);
        const pts: [number, number, number][] = [[x0, f0, D]];
        for (let j = 0; j <= 6; j++) {
          const tt = j / 6;
          pts.push([x0 + (x1 - x0) * tt, f0 + (f1 - f0) * tt - val + 0.06 - 0.06 * Math.sin(Math.PI * tt), D]);
        }
        pts.push([x1, f1, D]);
        const vc = g(grime * 0.95);
        const fm = (f0 + f1) / 2;
        b.quadF('fac_awning', 'N', [pts[0], pts[1], pts[4], [x0 + (x1 - x0) * 0.5, fm, D]], vc);
        b.quadF('fac_awning', 'N', [[x0 + (x1 - x0) * 0.5, fm, D], pts[4], pts[7], pts[8]], vc);
        b.quadF('fac_awning', 'N', [pts[1], pts[2], pts[3], pts[4]], vc);
        b.quadF('fac_awning', 'N', [pts[4], pts[5], pts[6], pts[7]], vc);
      });
    }
    b.box('fac_alu', a0, a1, yFront - 0.05, yFront, D - 0.05, D, lin(0xbfbfba), { bottom: true });
    const len = Math.hypot(D, drop);
    for (const x of [a0 + 0.3, a1 - 0.35]) {
      b.poly('fac_alu', f.vec(0, -drop / len, D / len), [f.p(x, yMount - 0.35, 0.05), f.p(x + 0.05, yMount - 0.35, 0.05), f.p(x + 0.05, yFront - 0.03, D - 0.1), f.p(x, yFront - 0.03, D - 0.1)], lin(0xb4b4ae));
    }
  };
}

function awnings(): VariantSpec[] {
  const out: VariantSpec[] = [];
  for (const market of [false, true]) {
    for (let n = 1; n <= 44; n++) {
      // n = round((w + 0.2) / 0.26)
      const lo = n === 1 ? 0.3 : (n - 0.5) * 0.26 - 0.2;
      const hi = (n + 0.5) * 0.26 - 0.2;
      out.push({ id: `${market ? 'market' : 'shop'}-n${n}`, ref: [Math.max(lo + 0.01, n * 0.26 - 0.2), 0.8, 1.6], fit: { w: [lo, n === 44 ? INF : hi] }, styles: [market ? 'market' : 'shop'], author: awning(n, market) });
    }
  }
  return out;
}

/** Style renames of the sign face: plain painted sheet, or a lit acrylic face of one glow colour. */
const FACE_STYLES: Record<string, { remap: Record<string, string> }> = {
  plain: { remap: { fac_glow_white: 'fac_sign' } },
  ...Object.fromEntries((Object.keys(SIGN_GLOW) as SignGlow[]).map((k) => [k, { remap: { fac_glow_white: `fac_glow_${k}` } }])),
};

export const SHOPFRONT_FAMILIES: FamilySpec[] = [
  { name: 'shop.step', doc: 'Threshold step of a unit (origin at the floor on the wall face; style marble for entrances).', styles: { terrazzo: {}, marble: { remap: { fac_terrazzo: 'fac_marble' } } }, variants: [{ id: 'step', ref: [4, 0, 0], author: step }] },
  {
    name: 'shop.kepenk.frame',
    doc: 'Kepenk guide rails and coil box (h = rail height from the floor; tint 0 = paint; style worn for the rusty box).',
    styles: { plain: {}, worn: { remap: { fac_kepenk: 'fac_kepenk_worn' } } },
    variants: [{ id: 'frame', ref: [4.5, 2.4, 0], author: kepenkFrame }],
  },
  { name: 'shop.kepenk.curtain', doc: 'Kepenk curtain h high from its bottom bar (origin at the bottom; tint 0 = paint; style worn).', styles: { plain: {}, worn: { remap: { fac_kepenk: 'fac_kepenk_worn' } } }, variants: [{ id: 'curtain', ref: [4.5, 1.2, 0], author: kepenkCurtain }] },
  {
    name: 'shop.glazing',
    doc: 'Aluminium shop glazing: a run of panes with a post at each bay start (at most 1.6 m per pane; style end adds the right end post). h = head height; tint 0 = aluminium.',
    variants: [
      { id: 'run', ref: [1.6, 2.4, 0], styles: ['run'], repeat: { pitch: 1.6, up: true }, author: glassBay },
      { id: 'run-end', ref: [1.6, 2.4, 0], styles: ['end'], repeat: { pitch: 1.6, up: true, caps: [null, glassEnd] }, author: glassBay },
    ],
  },
  {
    name: 'shop.door',
    doc: 'Shop entrance door: its left post, leaf, transom and push bar (w = post + leaf; h = head height; tint 0 = aluminium).',
    variants: [
      { id: 'low', ref: [1.06, 2.2, 0], fit: { h: [1.7, 2.5] }, author: glassDoor(false) },
      { id: 'high', ref: [1.06, 2.7, 0], fit: { h: [2.5, INF] }, author: glassDoor(true) },
    ],
  },
  { name: 'shop.sign', doc: 'Sign board over a unit (w, h; tint 0 panel, tint 1 face; style plain or a glow colour).', styles: FACE_STYLES, variants: [{ id: 'board', ref: [4, 0.8, 0], author: signBoard }] },
  { name: 'shop.blade', doc: 'Projecting sign (origin on the wall at its axis and bottom; tint 0 panel, tint 1 face; style plain or a glow colour).', styles: FACE_STYLES, variants: [{ id: 'blade', ref: [0, 0, 0], author: bladeSign }] },
  { name: 'shop.awning', doc: 'Striped awning (origin at the roller on the wall at the unit start; w the unit, h the drop, d the projection; tints the stripes; style shop or market).', variants: awnings() },
];

