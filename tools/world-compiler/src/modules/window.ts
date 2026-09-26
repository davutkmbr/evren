/**
 * Window modules (stage 1 of the façade module library): the assemblies facade/build.ts emitWindow used to bake
 * into every tile, authored once in the module frame and placed per window through slots.
 *
 * A window slot's origin is the bottom-left corner of the opening on the wall face (r0, y0, d = 0 of the wall or the
 * çıkma front); w and h are the opening, d the reveal depth (the frame sits d behind the face). Families:
 * - window.frame / window.frame.t2 / window.frame.ribbon / window.door / window.door.t2: frame bars, mullions,
 *   transoms, the kick panel of balcony doors and the glass (tint 0: frame colour, tint 1: glass colour and alpha,
 *   both from the slot); styles pvc / timber / alu rename the frame material.
 * - window.room: the room box behind the glass (styles home: dark or lit, shop: the lit shop interior), colour from
 *   the palette.
 * - window.curtain: net, drapes, roller blinds, venetian slats, dark lining, a flag, taped paper, or nothing.
 * - window.pane: a cracked pane (tape and cracks) or cardboard behind it; origin at the pane's corner.
 * - window.roller: a roller shutter let down h from the head (origin at the head, y = y1), never quite level.
 * - window.rollerbox: the roller box above the opening (origin at the head, h = box height).
 * - window.sill: marble (T1/T3) or rendered moulding (T2), tint 0 from the slot.
 * - window.surround: the T2 architrave and cornice cap (h = opening + box), tint 0 = trim.
 * - window.shutter: wooden shutters folded back, half open, closed, or none.
 * - wall.flue: a boiler flue terminal with its soot fan and drips (origin at the terminal).
 */
import { lin } from '../facade/frame';
import type { RGBA } from '../mesh';
import type { AuthorCtx, FamilySpec, VariantSpec } from './spec';

const g = (k: number): RGBA => [k, k, k, 1];
const W1: RGBA = [1, 1, 1, 1];
const hex = (v: number): string => `#${v.toString(16).padStart(6, '0')}`;

const FRAME_STYLES = { pvc: {}, timber: { remap: { fac_pvc: 'fac_timber' } }, alu: { remap: { fac_pvc: 'fac_alu' } } };

interface FrameOpts {
  fw: number;
  mull: (w: number) => number[];
  transom: (w: number, h: number) => number;
  kick?: (w: number) => [number, number];
}

/** Frame bars, mullions, transom, kick panel (tint 0) and the glass (tint 1). */
function frame(c: AuthorCtx, o: FrameOpts): void {
  const { b, w: W, h: H, d: D } = c;
  const fw = o.fw;
  const f0 = -D;
  const f1 = -D + 0.07;
  const gd = -D + 0.035;
  const M = 'fac_pvc';
  c.tint(1, () => b.quadF('fac_glass', 'N', [[fw, fw, gd], [W - fw, fw, gd], [W - fw, H - fw, gd], [fw, H - fw, gd]], W1));
  c.tint(0, () => {
    b.box(M, 0, fw, 0, H, f0, f1, W1, { front: true, right: true });
    b.box(M, W - fw, W, 0, H, f0, f1, W1, { front: true, left: true });
    b.box(M, fw, W - fw, 0, fw, f0, f1, g(0.93), { front: true });
    b.box(M, fw, W - fw, H - fw, H, f0, f1, W1, { front: true, bottom: true });
    for (const mx of o.mull(W)) {
      b.box(M, mx - fw / 2, mx + fw / 2, fw, H - fw, f0, f1, W1, { front: true, left: true, right: true });
    }
    const t = o.transom(W, H);
    if (t > 0.8) {
      b.box(M, fw, W - fw, t - fw / 2, t + fw / 2, f0, f1, W1, { front: true, top: true, bottom: true });
    }
    if (o.kick) {
      const [k0, k1] = o.kick(W);
      b.quadF(M, 'N', [[k0, fw, f1 - 0.01], [k1, fw, f1 - 0.01], [k1, 0.87, f1 - 0.01], [k0, 0.87, f1 - 0.01]], g(0.97));
    }
  });
}

const INF = 1e3;
const REF_D = { T1: 0.16, T2: 0.24, T3: 0.12 };

/** Casement windows: no mullion up to 0.8 m, one to 2 m, two beyond (plus a transom 0.5 m under the head). */
function casements(t2: boolean): VariantSpec[] {
  const fw = t2 ? 0.075 : 0.065;
  const d = t2 ? REF_D.T2 : REF_D.T1;
  // T2: a transom 0.55 m under the head of every opening taller than 1.35 m; others: only wide windows, 0.5 m.
  const tr = t2 ? (_w: number, h: number): number => h - 0.55 : (w: number, h: number): number => (w > 2 ? h - 0.5 : 0);
  const hSplit = t2 ? 1.35 : 1.3;
  const out: VariantSpec[] = [];
  const rows: [string, [number, number], (w: number) => number[], number][] = [
    ['m0', [0.4, 0.8], () => [], 0.7],
    ['m1', [0.8, 2.0], (w) => [w / 2], 1.3],
    ['m2', [2.0, INF], (w) => [w / 3, (2 * w) / 3], 2.4],
  ];
  for (const [id, fitW, mull, refW] of rows) {
    const withT = t2 || id === 'm2';
    if (withT) {
      out.push({ id: `${id}-low`, ref: [refW, 1.0, d], fit: { w: fitW, h: [0.4, hSplit] }, author: (c) => frame(c, { fw, mull, transom: () => 0 }) });
      out.push({ id: `${id}-t`, ref: [refW, 1.6, d], fit: { w: fitW, h: [hSplit, INF] }, author: (c) => frame(c, { fw, mull, transom: tr }) });
    } else {
      out.push({ id, ref: [refW, 1.4, d], fit: { w: fitW, h: [0.4, INF] }, author: (c) => frame(c, { fw, mull, transom: () => 0 }) });
    }
  }
  return out;
}

/**
 * Balcony doors: the leaf 0.88 m wide on the left or the right (picked per door), a second mullion in openings wider
 * than 2 m, the kick panel under the fixed part.
 */
function doors(t2: boolean): VariantSpec[] {
  const fw = t2 ? 0.075 : 0.065;
  const d = t2 ? REF_D.T2 : REF_D.T1;
  const tr = t2 ? (_w: number, h: number): number => h - 0.55 : (): number => 0;
  const out: VariantSpec[] = [];
  for (const side of ['left', 'right'] as const) {
    const m0 = (w: number): number => (side === 'left' ? 0.88 : w - 0.88);
    // The kick panel fills the wider part beside the leaf mullion.
    const kick = (w: number, wide: boolean): [number, number] => {
      const dx = m0(w);
      return wide === (side === 'left') ? [dx, w - fw] : [fw, dx];
    };
    const second = (w: number): number => (side === 'left' ? (0.88 + w) / 2 : (w - 0.88) / 2);
    out.push({ id: `${side}-narrow`, ref: [1.5, 2.3, d], fit: { w: [1.0, 1.76] }, weight: 0.5, author: (c) => frame(c, { fw, mull: (w) => [m0(w)], transom: tr, kick: (w) => kick(w, false) }) });
    out.push({ id: `${side}-wide`, ref: [1.9, 2.3, d], fit: { w: [1.76, 2.0] }, weight: 0.5, author: (c) => frame(c, { fw, mull: (w) => [m0(w)], transom: tr, kick: (w) => kick(w, true) }) });
    out.push({ id: `${side}-double`, ref: [2.2, 2.3, d], fit: { w: [2.0, INF] }, weight: 0.5, author: (c) => frame(c, { fw, mull: (w) => [m0(w), second(w)], transom: tr, kick: (w) => kick(w, true) }) });
  }
  return out;
}

/**
 * Ribbon windows (T3, shop ribbons): n = round(w / 1.3) panes, drawn as n repeated bays (glass, rails and the
 * mullion at the bay's right end; the last one is the right-hand bar) and a cap with the left-hand bar.
 */
function ribbons(): VariantSpec[] {
  const fw = 0.065;
  return [
    {
      id: 'bays',
      ref: [1.3, 1.6, REF_D.T3],
      fit: { w: [0.4, INF] },
      repeat: {
        pitch: 1.3,
        caps: [(c) => c.tint(0, () => c.b.box('fac_pvc', 0, fw, 0, c.h, -c.d, -c.d + 0.071, W1, { front: true, right: true })), null],
      },
      author: (c) => {
        const { b, w: W, h: H, d: D } = c;
        const f0 = -D;
        const f1 = -D + 0.07;
        c.tint(1, () => b.quadF('fac_glass', 'N', [[0, fw, -D + 0.035], [W, fw, -D + 0.035], [W, H - fw, -D + 0.035], [0, H - fw, -D + 0.035]], W1));
        c.tint(0, () => {
          b.box('fac_pvc', 0, W - fw, 0, fw, f0, f1, g(0.93), { front: true });
          b.box('fac_pvc', 0, W - fw, H - fw, H, f0, f1, W1, { front: true, bottom: true });
          b.box('fac_pvc', W - fw, W, 0, H, f0, f1, W1, { front: true, left: true });
        });
      },
    },
  ];
}

/** The room box behind the glass, seen through it (lit at night on 35 % of windows). */
function room(material: string, base: number, depth: number): (c: AuthorCtx) => void {
  return (c) => {
    const { b, w: W, h: H, d: D } = c;
    const df = -D;
    const rb = df - depth;
    const ra = -0.45;
    const rz = W + 0.45;
    const ya = -0.35;
    const yz = H + 0.3;
    c.tint(0, () => {
      b.quadF(material, 'N', [[ra, ya, rb], [rz, ya, rb], [rz, yz, rb], [ra, yz, rb]], g(base));
      b.quadF(material, 'R', [[ra, ya, df], [ra, ya, rb], [ra, yz, rb], [ra, yz, df]], g(base * 0.8));
      b.quadF(material, '-R', [[rz, ya, df], [rz, ya, rb], [rz, yz, rb], [rz, yz, df]], g(base * 0.8));
      b.quadF(material, 'Y', [[ra, ya, df], [rz, ya, df], [rz, ya, rb], [ra, ya, rb]], g(base * 0.6));
      b.quadF(material, '-Y', [[ra, yz, df], [rz, yz, df], [rz, yz, rb], [ra, yz, rb]], g(base * 0.9));
    });
  };
}

const ROOMS = [0x5b5147, 0x4a4540, 0x6a5a4a, 0x505862].map(hex);
const NET = [0xefe9dc, 0xe8e4da, 0xf2ede0, 0xe6dccb].map(hex);
const DRAPE = [0xb89c78, 0x8a3a34, 0x44546e, 0xd9cbb0, 0x6e7a5a, 0x7a5c48, 0x9aa2a8].map(hex);
const BLIND = [0xe8e2d2, 0xd8c8a8, 0xb8b8b0, 0x8c7a66, 0xf0ece4].map(hex);
const VENETIAN = [0xe9e7e0, 0xc9c6bd, 0x9a8a70].map(hex);
const PAPER = [0xd8d2c0, 0xc8c8c4].map(hex);
const ROLLER = [0xe3e1d9, 0xd8cfb8, 0xc0c2c2, 0xcdbf9c, 0xb9b3a6].map(hex);
const ROLLER_BOX = [0xe6e4dc, 0xdcd4c0, 0xcfcfca].map(hex);
const FLUE = [0xe8e6e0, 0xd0d0cc, 0xb8bab8].map(hex);

/** Curtains 8 cm behind the glass, in the proportions of the old per-window pick. */
function curtains(): VariantSpec[] {
  const dc = (c: AuthorCtx): number => -c.d - 0.08;
  const ref: [number, number, number] = [1.3, 1.5, REF_D.T1];
  const v: VariantSpec[] = [];
  v.push({ id: 'net', ref, weight: 0.21, palettes: [NET], author: (c) => c.tint(0, () => c.b.quadF('fac_curtain', 'N', [[0, 0.02, dc(c)], [c.w, 0.02, dc(c)], [c.w, c.h, dc(c)], [0, c.h, dc(c)]], g(0.85))) });
  v.push({
    id: 'net-pulled',
    ref,
    weight: 0.09,
    palettes: [NET],
    author: (c) => c.tint(0, () => c.b.quadF('fac_curtain', 'N', [[0, 0.02, dc(c)], [c.w * 0.65, 0.02, dc(c)], [c.w, c.h, dc(c)], [0, c.h, dc(c)]], g(0.85))),
  });
  for (const u6 of [0.25, 0.75]) {
    for (const net of [true, false]) {
      v.push({
        id: `drapes-${u6 < 0.5 ? 'narrow' : 'wide'}${net ? '-net' : ''}`,
        ref,
        weight: 0.045,
        palettes: [DRAPE, NET],
        author: (c) => {
          const d = dc(c);
          const cw = c.w * (0.18 + 0.17 * u6);
          const cr = cw * (u6 < 0.5 ? 1.1 : 0.85);
          c.tint(0, () => {
            c.b.quadF('fac_curtain', 'N', [[0, 0.05, d], [cw, 0.05, d], [cw, c.h, d], [0, c.h, d]], g(0.85));
            c.b.quadF('fac_curtain', 'N', [[c.w - cr, 0.05, d], [c.w, 0.05, d], [c.w, c.h, d], [c.w - cr, c.h, d]], g(0.85));
          });
          if (net) {
            c.tint(1, () => c.b.quadF('fac_curtain', 'N', [[cw, 0.02, d + 0.01], [c.w - cw, 0.02, d + 0.01], [c.w - cw, c.h, d + 0.01], [cw, c.h, d + 0.01]], g(0.85)));
          }
        },
      });
    }
  }
  // Roller blinds (stor perde) at three heights, a little skewed.
  for (const [u28, sk] of [[0.15, 0.015], [0.5, -0.01], [0.85, 0.02]] as const) {
    v.push({
      id: `blind-${Math.round(u28 * 100)}`,
      ref,
      weight: 0.16 / 3,
      palettes: [BLIND],
      author: (c) => {
        const d = dc(c);
        const yb = c.h - c.h * (0.15 + 0.8 * u28);
        c.tint(0, () => {
          c.b.poly('fac_curtain', c.b.f.dir('N'), [c.b.f.p(0.04, yb + sk, d + 0.02), c.b.f.p(c.w - 0.04, yb - sk, d + 0.02), c.b.f.p(c.w - 0.04, c.h, d + 0.02), c.b.f.p(0.04, c.h, d + 0.02)], g(0.85));
          c.b.box('fac_curtain', 0.03, c.w - 0.03, yb - Math.abs(sk) - 0.03, yb + Math.abs(sk), d + 0.02, d + 0.035, g(0.85 * 0.8), { front: true });
        });
      },
    });
  }
  // Venetian blinds: slats over the top part of the window.
  for (const [cover, n] of [[0.43, 4], [0.755, 6]] as const) {
    v.push({
      id: `venetian-${n}`,
      ref,
      weight: 0.05,
      palettes: [VENETIAN],
      author: (c) => {
        const d = dc(c);
        c.tint(0, () => {
          for (let k = 0; k < n; k++) {
            const y = c.h - 0.05 - (k * cover * c.h) / n;
            c.b.quadF('fac_curtain', 'N', [[0.04, y - 0.035, d + 0.015], [c.w - 0.04, y - 0.035, d + 0.015], [c.w - 0.04, y, d + 0.025], [0.04, y, d + 0.025]], g(0.85));
          }
        });
      },
    });
  }
  v.push({ id: 'dark', ref, weight: 0.06, palettes: [DRAPE], author: (c) => c.tint(0, () => c.b.quadF('fac_curtain', 'N', [[0, 0.02, dc(c)], [c.w, 0.02, dc(c)], [c.w, c.h, dc(c)], [0, c.h, dc(c)]], g(0.85 * 0.55))) });
  // A plain two-colour flag hung inside (the district's colours, no crest).
  for (const vertical of [true, false]) {
    v.push({
      id: `flag-${vertical ? 'v' : 'h'}`,
      ref,
      weight: 0.0075,
      palettes: [['$flag.0'], ['$flag.1']],
      author: (c) => {
        const d = dc(c) + 0.03;
        const fw = c.w * 0.6;
        const fh = c.h * 0.6;
        const r = 0.08;
        const yTop = c.h - 0.05;
        for (let k = 0; k < 4; k++) {
          const wave = (t: number): number => 0.02 * Math.sin(t * Math.PI * 2);
          c.tint(k % 2, () => {
            if (vertical) {
              const a = r + (fw * k) / 4;
              const e = r + (fw * (k + 1)) / 4;
              c.b.quadF('fac_cloth', 'N', [[a, yTop - fh, d + wave(k / 4)], [e, yTop - fh, d + wave((k + 1) / 4)], [e, yTop, d], [a, yTop, d]], W1);
            } else {
              const y1 = yTop - (fh * k) / 4;
              const y0 = yTop - (fh * (k + 1)) / 4;
              c.b.quadF('fac_cloth', 'N', [[r, y0, d + 0.01], [r + fw, y0, d + wave(0.3) + 0.01], [r + fw, y1, d + 0.01], [r, y1, d]], W1);
            }
          });
        }
      },
    });
  }
  v.push({ id: 'paper', ref, weight: 0.065, palettes: [PAPER], author: (c) => c.tint(0, () => c.b.quadF('fac_paper', 'N', [[0.05, 0.05, dc(c) + 0.06], [c.w - 0.05, 0.05, dc(c) + 0.06], [c.w - 0.05, c.h - 0.05, dc(c) + 0.06], [0.05, c.h - 0.05, dc(c) + 0.06]], g(0.9))) });
  v.push({ id: 'none', ref, weight: 0.12 });
  return v;
}

/** A cracked pane: tape in an X with cracks from the impact, or cardboard behind the glass. */
function panes(): VariantSpec[] {
  const ref: [number, number, number] = [0.6, 1.3, REF_D.T1];
  const tape = (seed: number) => (c: AuthorCtx): void => {
    const d = -c.d + 0.039;
    const t = 0.024;
    const seg = (ra: number, ya: number, rb: number, yb: number, th: number, m: string, col: RGBA, dd: number): void =>
      c.b.quadF(m, 'N', [[ra, ya - th, dd], [rb, yb - th, dd], [rb, yb + th, dd], [ra, ya + th, dd]], col);
    seg(0.04, 0.05, c.w - 0.04, c.h - 0.05, t, 'fac_paper', lin(0xc9b98a, 0.95), d);
    seg(0.04, c.h - 0.05, c.w - 0.04, 0.05, t, 'fac_paper', lin(0xc9b98a, 0.95), d);
    const U = (k: number): number => {
      const s = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453;
      return s - Math.floor(s);
    };
    const cx = c.w * (0.3 + 0.4 * U(1));
    const cy = c.h * (0.3 + 0.4 * U(2));
    for (let k = 0; k < 5; k++) {
      const ang = (k / 5) * Math.PI * 2 + U(3 + k);
      const f = 0.12 + 0.15 * U(9 + k);
      seg(cx, cy, cx + Math.cos(ang) * f * c.w, cy + Math.sin(ang) * f * c.h, 0.003, 'fac_crack', lin(0xe8eef0), d - 0.001);
    }
  };
  return [
    { id: 'tape-a', ref, weight: 0.3, author: tape(1) },
    { id: 'tape-b', ref, weight: 0.3, author: tape(2) },
    { id: 'cardboard', ref, weight: 0.4, author: (c) => c.b.quadF('fac_paper', 'N', [[0.02, 0.02, -c.d + 0.009], [c.w - 0.02, 0.02, -c.d + 0.009], [c.w - 0.02, c.h - 0.02, -c.d + 0.009], [0.02, c.h - 0.02, -c.d + 0.009]], lin(0x9a7b55)) },
  ];
}

/** Roller shutter let down h from the head (origin at the head), one side hanging lower. */
function rollers(): VariantSpec[] {
  return [-0.03, -0.012, 0.012, 0.03].map((tilt) => ({
    id: `tilt${tilt < 0 ? 'm' : 'p'}${Math.round(Math.abs(tilt) * 1000)}`,
    ref: [1.3, 0.8, REF_D.T1],
    palettes: [ROLLER],
    author: (c: AuthorCtx) => {
      const f1 = -c.d + 0.07;
      c.tint(0, () => {
        c.b.quadF('fac_roller', 'N', [[0.01, -c.h + tilt, f1 + 0.012], [c.w - 0.01, -c.h - tilt, f1 + 0.012], [c.w - 0.01, 0, f1 + 0.012], [0.01, 0, f1 + 0.012]], W1);
        const p = (r: number, y: number): [number, number, number] => c.b.f.p(r, y, f1 + 0.03);
        c.b.poly('fac_pvc', c.b.f.dir('N'), [p(0.01, -c.h + tilt - 0.04), p(c.w - 0.01, -c.h - tilt - 0.04), p(c.w - 0.01, -c.h - tilt), p(0.01, -c.h + tilt)], g(0.88));
      });
    },
  }));
}

/** Wooden shutters of a T2 window: folded back, swung half open at an angle, closed in the reveal, or none. */
function shutters(): VariantSpec[] {
  const ref: [number, number, number] = [1.05, 2.0, REF_D.T2];
  const out: VariantSpec[] = [];
  const pal = [['#ffffff', '#ffffff', '#ffffff', '#f9ddc4', '#f9ddc4']];
  out.push({
    id: 'folded',
    ref,
    weight: 0.42,
    palettes: pal,
    author: (c) =>
      c.tint(0, () => {
        const lw = c.w / 2;
        c.b.box('fac_shutter_wood', -0.14 - lw, -0.14, 0, c.h, 0.03, 0.07, W1, { front: true, left: true, right: true, top: true });
        c.b.box('fac_shutter_wood', c.w + 0.14, c.w + 0.14 + lw, 0, c.h, 0.03, 0.07, W1, { front: true, left: true, right: true, top: true });
      }),
  });
  for (const [a0, a1] of [[48, 66], [40, 76], [70, 45]] as const) {
    out.push({
      id: `half-${a0}-${a1}`,
      ref,
      weight: 0.1,
      palettes: pal,
      author: (c) =>
        c.tint(0, () => {
          const lw = c.w / 2;
          for (const side of [-1, 1]) {
            const hr = side < 0 ? -0.02 : c.w + 0.02;
            const ang = ((side < 0 ? a0 : a1) * Math.PI) / 180;
            const tipR = hr + side * Math.cos(ang) * lw;
            const tipD = 0.02 + Math.sin(ang) * lw;
            const sag = side < 0 ? 0.012 : 0.004;
            const n = c.b.f.vec(side * Math.sin(ang), 0, -Math.cos(ang));
            const pts = [c.b.f.p(hr, 0, 0.02), c.b.f.p(tipR, -sag, tipD), c.b.f.p(tipR, c.h - sag, tipD), c.b.f.p(hr, c.h, 0.02)];
            c.b.poly('fac_shutter_wood', n, pts, W1);
            c.b.poly('fac_shutter_wood', [-n[0], -n[1], -n[2]], pts, g(0.85));
          }
        }),
    });
  }
  out.push({ id: 'closed', ref, weight: 0.18, palettes: pal, author: (c) => c.tint(0, () => c.b.quadF('fac_shutter_wood', 'N', [[0, 0, -0.06], [c.w, 0, -0.06], [c.w, c.h, -0.06], [0, c.h, -0.06]], W1)) });
  out.push({ id: 'none', ref, weight: 0.1 });
  return out;
}

/** Boiler flue terminal (Ø 9 cm, 25-40 cm out), soot fanning up, drips below. */
function flues(): VariantSpec[] {
  return [
    [0.3, 0.9, 0.42, 0.3, 0.5],
    [0.36, 1.2, 0.5, 0.45, 0.2],
    [0.27, 0.75, 0.36, 0.25, 0.8],
  ].map(([out, h, wS, u0, u75], k) => ({
    id: `f${k}`,
    ref: [0, 0, 0] as [number, number, number],
    palettes: [FLUE],
    author: (c: AuthorCtx) => {
      const hw = 0.045;
      c.tint(0, () => c.b.box('fac_metal', -hw, hw, -hw, hw, 0, out, W1, { front: true, left: true, right: true, bottom: true }));
      c.b.quadF('fac_leak', 'N', [[-wS / 2, -0.02, 0.013], [wS / 2, -0.02, 0.013], [wS / 2, h, 0.013], [-wS / 2, h, 0.013]], [0.05, 0.045, 0.04, 0.9], [
        [u0, 0],
        [u0 + 0.22, 0],
        [u0 + 0.22, 1],
        [u0, 1],
      ]);
      const yd = -0.55 - 0.4 * u75;
      c.b.quadF('fac_leak', 'N', [[-0.12, yd, 0.012], [0.12, yd, 0.012], [0.12, -hw, 0.012], [-0.12, -hw, 0.012]], [0.45, 0.4, 0.36, 0.6], [
        [0.3, 1],
        [0.4, 1],
        [0.4, 0],
        [0.3, 0],
      ]);
    },
  }));
}

export const WINDOW_FAMILIES: FamilySpec[] = [
  { name: 'window.frame', doc: 'Casement window frame and glass (T1, T3 and ground-floor windows).', styles: FRAME_STYLES, variants: casements(false) },
  { name: 'window.frame.t2', doc: 'Casement window frame and glass of T2 façades (wider bars, transom).', styles: FRAME_STYLES, variants: casements(true) },
  { name: 'window.door', doc: 'Balcony door frame, glass and kick panel.', styles: FRAME_STYLES, variants: doors(false) },
  { name: 'window.door.t2', doc: 'Balcony door frame of T2 façades.', styles: FRAME_STYLES, variants: doors(true) },
  { name: 'window.frame.ribbon', doc: 'Ribbon window frame and glass (T3 floors, glazed shop floors).', styles: FRAME_STYLES, variants: ribbons() },
  {
    name: 'window.room',
    doc: 'Room box behind the glass: home (dark or lit at night) or shop (lit interior).',
    variants: [
      { id: 'dark', ref: [1.3, 1.5, REF_D.T1], styles: ['home'], weight: 0.65, palettes: [ROOMS], author: room('fac_room', 0.8, 0.45) },
      { id: 'lit', ref: [1.3, 1.5, REF_D.T1], styles: ['home'], weight: 0.35, palettes: [ROOMS], author: room('fac_room_lit', 0.8, 0.45) },
      { id: 'shop', ref: [3, 2.5, REF_D.T3], styles: ['shop'], palettes: [['#eeeae2']], author: room('fac_shop_lit', 1, 2.5) },
    ],
  },
  { name: 'window.curtain', doc: 'What hangs behind the glass (or nothing).', variants: curtains() },
  { name: 'window.pane', doc: 'A cracked or boarded pane (origin at the pane corner, w and h the pane).', variants: panes() },
  { name: 'window.roller', doc: 'Roller shutter let down h from the head (origin at the head).', variants: rollers() },
  { name: 'window.rollerbox', doc: 'Roller box over the opening (origin at the head, h its height).', variants: [{ id: 'box', ref: [1.3, 0.22, REF_D.T1], palettes: [ROLLER_BOX], author: (c) => c.tint(0, () => c.b.box('fac_pvc', 0, c.w, 0, c.h, -c.d, -0.012, W1, { front: true, bottom: true })) }] },
  {
    name: 'window.sill',
    doc: 'Window sill: marble slab (T1, T3) or rendered moulding (T2).',
    variants: [
      { id: 'marble', ref: [1.3, 0, REF_D.T1], styles: ['marble'], author: (c) => c.tint(0, () => c.b.box('fac_marble', -0.04, c.w + 0.04, -0.035, 0, -c.d, 0.05, W1, { front: true, top: true, bottom: true, left: true, right: true })) },
      { id: 't2', ref: [1.05, 0, REF_D.T2], styles: ['t2'], author: (c) => c.tint(0, () => c.b.slab('fac_render', -0.08, c.w + 0.08, -0.08, 0, -c.d, 0.07, W1, 0.018, { front: true, top: true, bottom: true, left: true, right: true })) },
    ],
  },
  {
    name: 'window.surround',
    doc: 'T2 architrave and cornice cap round the opening (h = opening + roller box).',
    variants: [
      {
        id: 'cap',
        ref: [1.05, 2.1, 0],
        author: (c) =>
          c.tint(0, () => {
            c.b.box('fac_render', -0.12, 0, 0, c.h, 0, 0.03, W1, { front: true, left: true });
            c.b.box('fac_render', c.w, c.w + 0.12, 0, c.h, 0, 0.03, W1, { front: true, right: true });
            c.b.box('fac_render', -0.12, c.w + 0.12, c.h, c.h + 0.12, 0, 0.03, W1, { front: true });
            c.b.slab('fac_render', -0.2, c.w + 0.2, c.h + 0.12, c.h + 0.26, 0, 0.12, g(0.97), 0.015, { front: true, top: true, bottom: true, left: true, right: true });
          }),
      },
    ],
  },
  { name: 'window.shutter', doc: 'Wooden shutters of a T2 window (or none).', variants: shutters() },
  { name: 'wall.flue', doc: 'Boiler flue terminal with soot and drips (origin at the terminal).', variants: flues() },
];

