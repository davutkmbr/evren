/**
 * Balcony modules (facade/build.ts emitBalconies): the slab with its chamfered edge and soffit, the parapets and
 * railings, the glazed enclosures and the T2 brackets. A balcony slot's origin is the left end of the run on the
 * wall face at the slab top (r0, y1, d = 0); w is the run, d the projection P, h the railing height (the enclosure:
 * up to its ceiling).
 *
 * Steel railings repeat one bar bay along the front (pitch = the bar spacing) between end caps with the posts and
 * the bars along the balcony's depth; their variants differ by the number of those depth bars, so each one stays
 * linear in P over its fit range.
 */
import { lin } from '../facade/frame';
import type { RGBA } from '../mesh';
import type { AuthorCtx, FamilySpec, VariantSpec } from './spec';

const g = (k: number): RGBA => [k, k, k, 1];
const W1: RGBA = [1, 1, 1, 1];
const M = 'fac_metal';
const SIX = { front: true, back: true, top: true, bottom: true, left: true, right: true };
const RUN = { front: true, back: true, top: true, bottom: true };

type Steel = 'flatbar' | 'square' | 'iron' | 'pipe';
const STEP: Record<Exclude<Steel, 'pipe'>, number> = { flatbar: 0.14, square: 0.12, iron: 0.11 };

/** One front bay of a steel railing (w = bay width): rail segments and the bar at the bay's right end. */
function steelBay(type: Steel) {
  return (c: AuthorCtx): void => {
    const { b, w: W, h: Hh, d: P } = c;
    const top = Hh;
    c.tint(0, () => {
      b.box(M, 0, W, top - 0.045, top, P - 0.05, P, W1, RUN);
      if (type === 'pipe') {
        for (const yy of [0.35, 0.68]) {
          b.box(M, 0, W, yy - 0.02, yy + 0.02, P - 0.04, P - 0.01, W1, RUN);
        }
        b.box(M, W - 0.02, W + 0.02, 0, top, P - 0.045, P - 0.005, W1, { front: true, left: true, right: true });
        return;
      }
      b.box(M, 0, W, 0.08, 0.12, P - 0.045, P - 0.005, W1, RUN);
      if (type === 'iron') {
        b.box(M, 0, W, 0.3, 0.33, P - 0.04, P - 0.01, W1, RUN);
      }
      const [bw, bd] = type === 'flatbar' ? [0.012, 0.045] : [0.02, 0.02];
      b.box(M, W - bw / 2, W + bw / 2, 0.12, top - 0.045, P - 0.025 - bd / 2, P - 0.025 + bd / 2, W1, { front: true, left: bw > 0.015, right: true });
    });
  };
}

/** An end of a steel railing (x = 0 or w): the return rails, the corner post and the bars along the depth. */
function steelCap(type: Steel, side: 0 | 1, nd: number) {
  return (c: AuthorCtx): void => {
    const { b, w: W, h: Hh, d: P } = c;
    const top = Hh;
    const x0 = side === 0 ? 0 : W - 0.045;
    c.tint(0, () => {
      b.box(M, x0, x0 + 0.045, top - 0.045, top, 0, P - 0.05, W1, SIX);
      b.box(M, x0, x0 + 0.045, 0, top, P - 0.05, P, W1, { front: true, left: true, right: true });
      if (type === 'pipe') {
        const xr = side === 0 ? 0 : W - 0.04;
        for (const yy of [0.35, 0.68]) {
          b.box(M, xr, xr + 0.04, yy - 0.02, yy + 0.02, 0, P - 0.05, W1, SIX);
        }
        return;
      }
      const [bw, bd] = type === 'flatbar' ? [0.012, 0.045] : [0.02, 0.02];
      const xc = side === 0 ? 0.0225 : W - 0.0225;
      for (let k = 1; k < nd; k++) {
        const v = ((P - 0.05) * k) / nd;
        b.box(M, xc - bd / 2, xc + bd / 2, 0.12, top - 0.045, v - bw / 2, v + bw / 2, W1, side === 0 ? { left: true, front: true } : { right: true, front: true });
      }
    });
  };
}

function steelVariants(type: Steel): VariantSpec[] {
  if (type === 'pipe') {
    return [{ id: 'pipe', ref: [1.2, 1.0, 0.9], repeat: { pitch: 1.2, caps: [steelCap('pipe', 0, 0), steelCap('pipe', 1, 0)] }, author: steelBay('pipe') }];
  }
  const step = STEP[type];
  const out: VariantSpec[] = [];
  // Depth bars: n = round((P - 0.05) / step) spaces; one variant per n.
  for (let nd = 1; nd <= 16; nd++) {
    const lo = nd === 1 ? 0.1 : (nd - 0.5) * step + 0.05;
    const hi = (nd + 0.5) * step + 0.05;
    out.push({
      id: `${type}-d${nd}`,
      ref: [step, 1.0, Math.min(Math.max(nd * step + 0.05, lo + 0.01), hi - 0.01)],
      fit: { d: [lo, nd === 16 ? 1e3 : hi] },
      repeat: { pitch: step, caps: [steelCap(type, 0, nd), steelCap(type, 1, nd)] },
      author: steelBay(type),
    });
  }
  return out;
}

/** Solid parapet (tint 0 = accent colour) with its coping (tint 1 = trim); h is its height. */
function parapet(mat: string) {
  return (c: AuthorCtx): void => {
    const { b, w: W, h: ph, d: P } = c;
    const t = 0.1;
    c.tint(0, () => {
      b.box(mat, 0, W, 0, ph, P - t, P, W1, { front: true, back: true, top: true });
      b.box(mat, 0, t, 0, ph, 0, P - t, W1, { left: true, right: true, top: true });
      b.box(mat, W - t, W, 0, ph, 0, P - t, W1, { left: true, right: true, top: true });
    });
    c.tint(1, () => b.box('fac_render', -0.01, W + 0.01, ph - 0.06, ph + 0.01, P - t - 0.01, P + 0.02, W1, { front: true, top: true }));
  };
}

/** Glazed enclosure bay above a 0.9 m parapet: post, glass, head rail, ceiling and fascia (tint 0 = trim); h to the ceiling. */
function enclosureBay(c: AuthorCtx): void {
  const { b, w: W, h: Hh, d: P } = c;
  const y0 = 0.9;
  const gTop = Hh;
  const fc = lin(0xf0f0ec);
  b.box('fac_pvc', 0, 0.06, y0, gTop, P - 0.07, P - 0.01, fc, { front: true, left: true, right: true });
  b.box('fac_pvc', 0, W, gTop - 0.06, gTop, P - 0.07, P - 0.01, fc, { front: true, bottom: true });
  b.quadF('fac_glass', 'N', [[0, y0, P - 0.04], [W, y0, P - 0.04], [W, gTop, P - 0.04], [0, gTop, P - 0.04]], [0.22, 0.27, 0.3, 0.4]);
  c.tint(0, () => {
    b.quadF('fac_render', '-Y', [[0, gTop + 0.01, 0], [W, gTop + 0.01, 0], [W, gTop + 0.01, P], [0, gTop + 0.01, P]], g(0.7));
    b.box('fac_render', 0, W, gTop, gTop + 0.16, 0, P, W1, { front: true, top: true });
  });
}

function enclosureCap(side: 0 | 1) {
  return (c: AuthorCtx): void => {
    const { b, w: W, h: Hh, d: P } = c;
    const y0 = 0.9;
    const gTop = Hh;
    const glass: RGBA = [0.22, 0.27, 0.3, 0.4];
    if (side === 0) {
      b.quadF('fac_glass', '-R', [[0.01, y0, 0], [0.01, y0, P - 0.05], [0.01, gTop, P - 0.05], [0.01, gTop, 0]], glass);
      c.tint(0, () => b.quadF('fac_render', '-R', [[0, gTop, 0], [0, gTop, P], [0, gTop + 0.16, P], [0, gTop + 0.16, 0]], W1));
    } else {
      b.box('fac_pvc', W - 0.03, W, y0, gTop, P - 0.07, P - 0.01, lin(0xf0f0ec), { front: true, left: true, right: true });
      b.quadF('fac_glass', 'R', [[W - 0.01, y0, 0], [W - 0.01, y0, P - 0.05], [W - 0.01, gTop, P - 0.05], [W - 0.01, gTop, 0]], glass);
      c.tint(0, () => b.quadF('fac_render', 'R', [[W, gTop, 0], [W, gTop, P], [W, gTop + 0.16, P], [W, gTop + 0.16, 0]], W1));
    }
  };
}

/** Frameless glass railing with an aluminium top rail. */
function glassRail(c: AuthorCtx): void {
  const { b, w: W, h: Hh, d: P } = c;
  const top = Hh;
  const gc: RGBA = [0.55, 0.66, 0.66, 0.28];
  b.quadF('fac_glass', 'N', [[0.03, 0.05, P - 0.04], [W - 0.03, 0.05, P - 0.04], [W - 0.03, top - 0.05, P - 0.04], [0.03, top - 0.05, P - 0.04]], gc);
  b.quadF('fac_glass', '-R', [[0.03, 0.05, 0], [0.03, 0.05, P - 0.05], [0.03, top - 0.05, P - 0.05], [0.03, top - 0.05, 0]], gc);
  b.quadF('fac_glass', 'R', [[W - 0.03, 0.05, 0], [W - 0.03, 0.05, P - 0.05], [W - 0.03, top - 0.05, P - 0.05], [W - 0.03, top - 0.05, 0]], gc);
  const al = lin(0xc8cacc);
  b.box('fac_alu', 0, W, top - 0.05, top, P - 0.06, P - 0.01, al, { front: true, top: true, bottom: true, back: true });
  b.box('fac_alu', 0, 0.05, top - 0.05, top, 0, P - 0.06, al, { left: true, right: true, top: true, bottom: true });
  b.box('fac_alu', W - 0.05, W, top - 0.05, top, 0, P - 0.06, al, { left: true, right: true, top: true, bottom: true });
}

/** The slab: concrete top, chamfered edge (tint 0 = edge colour), soffit darker towards the wall. */
function slab(c: AuthorCtx): void {
  const { b, w: W, d: P } = c;
  const y0 = -0.18;
  b.box('fac_concrete', 0, W, -0.001, 0, 0, P, lin(0xbdb7ad), { top: true });
  c.tint(0, () => {
    b.slab('fac_render', 0, W, y0, 0, 0, P, W1, 0.02, { front: true, left: true, right: true });
    b.quadF('fac_render', '-Y', [[0, y0, 0], [W, y0, 0], [W, y0, P - 0.02], [0, y0, P - 0.02]], [g(0.55), g(0.55), g(0.82), g(0.82)]);
  });
}

/** T2 console brackets under the slab: at both ends and in the middle (tint 0 = trim). */
function brackets(c: AuthorCtx): void {
  const { b, w: W, d: P } = c;
  const y0 = -0.18;
  c.tint(0, () => {
    for (const rr of [0.15, W / 2, W - 0.15]) {
      b.box('fac_render', rr - 0.07, rr + 0.07, y0 - 0.32, y0, 0, P - 0.12, W1, { front: true, left: true, right: true, bottom: true });
    }
  });
}

export const BALCONY_FAMILIES: FamilySpec[] = [
  { name: 'balcony.slab', doc: 'Balcony slab: concrete top, chamfered edge and soffit (origin at the slab top on the wall; d the projection; tint 0 the edge).', variants: [{ id: 'slab', ref: [2.5, 0, 1.0], author: slab }] },
  { name: 'balcony.brackets', doc: 'T2 console brackets under a balcony slab (tint 0 = trim).', variants: [{ id: 'three', ref: [2.5, 0, 0.75], author: brackets }] },
  {
    name: 'balcony.parapet',
    doc: 'Solid parapet (h its height; tint 0 accent, tint 1 coping), rough or smooth render.',
    variants: [
      { id: 'rough', ref: [2.5, 1.0, 1.0], weight: 0.6, author: parapet('fac_render_rough') },
      { id: 'smooth', ref: [2.5, 1.0, 1.0], weight: 0.4, author: parapet('fac_render') },
    ],
  },
  {
    name: 'balcony.enclosure',
    doc: 'Glazed enclosure over a 0.9 m parapet up to the ceiling at h: a post and pane per ~0.9 m (tint 0 = trim).',
    variants: [{ id: 'bays', ref: [0.9, 2.6, 1.0], repeat: { pitch: 0.9, caps: [enclosureCap(0), enclosureCap(1)] }, author: enclosureBay }],
  },
  { name: 'balcony.glass', doc: 'Frameless glass railing with an aluminium top rail.', variants: [{ id: 'glass', ref: [2.5, 1.0, 1.0], author: glassRail }] },
  ...(['flatbar', 'square', 'iron', 'pipe'] as const).map((t): FamilySpec => ({ name: `balcony.rail.${t}`, doc: `Steel railing (${t}), tint 0 = paint.`, variants: steelVariants(t) })),
];

