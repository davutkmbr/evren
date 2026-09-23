import { createRng } from '../../../core/math/noise';
import { TexLayer } from '../species';

/** Leaf shape ids understood by leaf.glsl.ts. */
const Shape = { Lanceolate: 0, Oak: 1, Palmate: 2, Needle: 3, Scale: 4, Leaflet: 5, Twig: 6 } as const;

export interface LeafInstance {
  x: number;
  y: number;
  angle: number;
  length: number;
  halfWidth: number;
  shape: number;
  roll: number;
  pitch: number;
  colorMix: number;
  bright: number;
  fold: number;
}

export interface LeafLayerSpec {
  layer: number;
  /** Linear albedo range of the blades and the twig colour. */
  colorA: [number, number, number];
  colorB: [number, number, number];
  twig: [number, number, number];
  translucency: number;
  /** Instances in draw order (first = bottom). */
  instances: LeafInstance[];
}

type Rng = () => number;
const TAU = Math.PI * 2;

function gauss(rng: Rng): number {
  return (rng() + rng() + rng() + rng() - 2) * 1.7320508;
}

function inside(x: number, y: number, m = 0.02): boolean {
  return x > m && x < 1 - m && y > m && y < 1 - m;
}

class Layout {
  readonly twigs: LeafInstance[] = [];
  readonly leaves: LeafInstance[] = [];
  constructor(readonly rng: Rng) {}

  twig(x0: number, y0: number, x1: number, y1: number, halfWidth: number): void {
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len < 1e-4) {
      return;
    }
    this.twigs.push({ x: x0, y: y0, angle: Math.atan2(y1 - y0, x1 - x0), length: len * 1.02, halfWidth, shape: Shape.Twig, roll: 0, pitch: 0, colorMix: 0, bright: 0.85 + 0.3 * this.rng(), fold: 0 });
  }

  leaf(x: number, y: number, angle: number, length: number, halfWidth: number, shape: number, fold: number, colorSpread = 1): boolean {
    const tx = x + Math.cos(angle) * length;
    const ty = y + Math.sin(angle) * length;
    const reach = Math.max(halfWidth, shape === Shape.Palmate ? length * 0.76 : halfWidth);
    const mx = (x + tx) * 0.5;
    const my = (y + ty) * 0.5;
    const r = length * 0.5 + reach;
    if (!inside(x, y, 0.01) || !inside(tx, ty, 0.012) || mx - r < 0.005 || mx + r > 0.995 || my - r < 0.005 || my + r > 0.995) {
      if (shape === Shape.Needle || shape === Shape.Scale) {
        if (!inside(tx, ty, 0.008)) {
          return false;
        }
      } else {
        return false;
      }
    }
    const rng = this.rng;
    this.leaves.push({
      x,
      y,
      angle,
      length,
      halfWidth,
      shape,
      roll: gauss(rng) * 0.45,
      pitch: gauss(rng) * 0.3,
      colorMix: Math.min(1, Math.max(0, 0.5 + gauss(rng) * 0.3 * colorSpread)),
      bright: 0.82 + 0.3 * rng(),
      fold,
    });
    return true;
  }

  shuffleLeaves(): void {
    const a = this.leaves;
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
  }

  result(): LeafInstance[] {
    return [...this.twigs, ...this.leaves];
  }
}

/** Polyline twig; returns the sample points. */
function curvedTwig(L: Layout, x: number, y: number, angle: number, length: number, bendTo: number, bend: number, w0: number, w1: number, segs: number): [number, number, number][] {
  const pts: [number, number, number][] = [[x, y, angle]];
  let a = angle;
  let px = x;
  let py = y;
  const step = length / segs;
  for (let i = 0; i < segs; i++) {
    a += (bendTo - a) * (bend / segs) + gauss(L.rng) * 0.05;
    const nx = px + Math.cos(a) * step;
    const ny = py + Math.sin(a) * step;
    L.twig(px, py, nx, ny, w0 + (w1 - w0) * (i / segs));
    px = nx;
    py = ny;
    pts.push([px, py, a]);
  }
  return pts;
}

function cypressSpray(rng: Rng): LeafInstance[] {
  const L = new Layout(rng);
  const axis = (x: number, y: number, a: number, len: number, depth: number): void => {
    const segs = Math.max(2, Math.round(len / 0.035));
    const step = len / segs;
    let px = x;
    let py = y;
    let ang = a;
    for (let i = 0; i < segs; i++) {
      ang += gauss(rng) * 0.06;
      const nx = px + Math.cos(ang) * step;
      const ny = py + Math.sin(ang) * step;
      if (depth === 0) {
        const scales = Math.max(2, Math.round(step / 0.011));
        for (let s = 0; s < scales; s++) {
          const f = s / scales;
          L.leaf(px + (nx - px) * f, py + (ny - py) * f, ang + gauss(rng) * 0.25, 0.02 + rng() * 0.008, 0.0065 + rng() * 0.002, Shape.Scale, 0.2, 1.4);
        }
      } else {
        L.twig(px, py, nx, ny, 0.0028 * depth);
        if (i > 0 && i < segs) {
          const side = i % 2 === 0 ? 1 : -1;
          axis(nx, ny, ang + side * (0.62 + rng() * 0.25), len * (0.42 + rng() * 0.1) * (1 - (i / segs) * 0.5), depth - 1);
        }
      }
      px = nx;
      py = ny;
    }
    if (depth > 0) {
      axis(px, py, ang, len * 0.3, depth - 1);
    }
  };
  const sprays = 6;
  for (let i = 0; i < sprays; i++) {
    const x = 0.5 + (i - (sprays - 1) / 2) * 0.1 + gauss(rng) * 0.02;
    const a = Math.PI / 2 + (x - 0.5) * 1.6 + gauss(rng) * 0.1;
    axis(x, 0.03, a, 0.55 + rng() * 0.3, 2);
  }
  // Scattered extra scale sprays fill the card (cypress foliage is very dense).
  for (let i = 0; i < 10; i++) {
    axis(0.15 + rng() * 0.7, 0.15 + rng() * 0.6, Math.PI / 2 + gauss(rng) * 0.5, 0.18 + rng() * 0.12, 1);
  }
  return L.result();
}

function palmFrond(rng: Rng): LeafInstance[] {
  const L = new Layout(rng);
  L.twig(0.5, 0.0, 0.5, 1.0, 0.018);
  for (let side = -1; side <= 1; side += 2) {
    for (let v = 0.04; v < 0.985; v += 0.0105) {
      const t = (v - 0.1) / 0.9;
      const along = v + (rng() - 0.5) * 0.004;
      const base = 0.5 + side * 0.012;
      if (v < 0.12) {
        L.leaf(base, along, Math.PI / 2 - side * 1.2, 0.035 + rng() * 0.02, 0.004, Shape.Leaflet, 0.1, 0.4);
        continue;
      }
      const ang = Math.PI / 2 - side * (0.95 - 0.35 * t + gauss(rng) * 0.05);
      const len = Math.min(0.47 / Math.max(Math.abs(Math.cos(ang)), 0.2), 0.62) * Math.pow(Math.sin(Math.PI * Math.min(t * 0.85 + 0.12, 1)), 0.6);
      L.leaf(base, along, ang, len, 0.0075 + 0.004 * Math.sin(Math.PI * t), Shape.Leaflet, 0.55, 0.8);
    }
  }
  return L.result();
}

interface Ellipse {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

/** Random point inside an ellipse, biased toward its rim (foliage sits on the outside of a clump). */
function pointInEllipse(rng: Rng, e: Ellipse, rimBias: number): [number, number] {
  const a = rng() * TAU;
  const r = Math.pow(rng(), rimBias);
  // Irregular outline: a few lobes.
  return [e.cx + Math.cos(a) * r * e.rx, e.cy + Math.sin(a) * r * e.ry];
}

type TwigPoint = [number, number, number];

/** Branchlet skeleton filling an ellipse: a stem from the bottom centre and side twigs fanning toward the rim. */
function clumpSkeleton(L: Layout, e: Ellipse, sideTwigs: number, twigWidth: number): TwigPoint[] {
  const rng = L.rng;
  const pts: TwigPoint[] = [];
  const baseX = 0.5 + (rng() - 0.5) * 0.06;
  const stemTop = e.cy + e.ry * 0.55;
  const stem = curvedTwig(L, baseX, 0.015, Math.PI / 2 + (rng() - 0.5) * 0.25, stemTop - 0.015, Math.PI / 2, 0.3, twigWidth, twigWidth * 0.45, 7);
  pts.push(...stem);
  for (let i = 0; i < sideTwigs; i++) {
    const t = 0.3 + 0.65 * ((i + rng() * 0.6) / sideTwigs);
    const k = Math.min(stem.length - 1, Math.max(1, Math.round(t * (stem.length - 1))));
    const [bx, by] = stem[k];
    const side = i % 2 === 0 ? 1 : -1;
    // Aim at a rim point on this side.
    const aim = Math.PI / 2 - side * (0.35 + 1.05 * rng()) * (1 - 0.35 * t);
    const tx = e.cx + Math.cos(aim) * e.rx * 0.92;
    const ty = e.cy + Math.sin(aim) * e.ry * 0.92;
    const ang = Math.atan2(ty - by, tx - bx);
    const len = Math.hypot(tx - bx, ty - by) * (0.75 + 0.2 * rng());
    const tw = curvedTwig(L, bx, by, ang, len, ang + side * 0.25, 0.4, twigWidth * 0.6, twigWidth * 0.22, 5);
    pts.push(...tw.slice(1));
    // Second order twiglets.
    for (let q = 2; q < tw.length - 1; q += 2) {
      const [qx, qy, qa] = tw[q];
      const s2 = rng() < 0.5 ? 1 : -1;
      const tl = curvedTwig(L, qx, qy, qa + s2 * (0.6 + 0.4 * rng()), len * (0.25 + 0.2 * rng()), qa, 0.3, twigWidth * 0.3, twigWidth * 0.14, 3);
      pts.push(...tl.slice(1));
    }
  }
  return pts;
}

function nearestTwig(pts: TwigPoint[], x: number, y: number): TwigPoint {
  let best = pts[0];
  let bd = Infinity;
  for (const p of pts) {
    const d = (p[0] - x) * (p[0] - x) + (p[1] - y) * (p[1] - y);
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return best;
}

/**
 * Dense broadleaf clump: a branchlet whose leaves fill an ellipse (a foliage card seen from 5-50 m). Every leaf hangs
 * from its nearest twig point; far leaves get a short twiglet.
 */
function broadleafClump(
  rng: Rng,
  o: { shape: number; leafLen: [number, number]; widthRatio: number; leaves: number; sideTwigs: number; fold: number; twigWidth: number; ellipse: Ellipse },
): LeafInstance[] {
  const L = new Layout(rng);
  const e = o.ellipse;
  const pts = clumpSkeleton(L, e, o.sideTwigs, o.twigWidth);
  // Leaves gather in a few sub-clusters (leaf sprays of the side twigs): a lobed outline with gaps, not a disc.
  const lobes: [number, number, number][] = [];
  const lobeCount = 6 + Math.floor(rng() * 3);
  for (let i = 0; i < lobeCount; i++) {
    const a = (i / lobeCount) * TAU + (rng() - 0.5) * 0.7;
    const r = i === 0 ? 0.1 : 0.45 + 0.4 * rng();
    lobes.push([e.cx + Math.cos(a) * r * e.rx, e.cy + Math.sin(a) * r * e.ry, (0.2 + 0.12 * rng()) * Math.min(e.rx, e.ry)]);
  }
  let tries = 0;
  while (L.leaves.length < o.leaves && tries++ < o.leaves * 8) {
    const lobe = lobes[Math.floor(rng() * lobes.length)];
    const qx = lobe[0] + gauss(rng) * lobe[2];
    const qy = lobe[1] + gauss(rng) * lobe[2];
    if (((qx - e.cx) / e.rx) ** 2 + ((qy - e.cy) / e.ry) ** 2 > 1) {
      continue;
    }
    const [px, py] = nearestTwig(pts, qx, qy);
    const len = o.leafLen[0] + (o.leafLen[1] - o.leafLen[0]) * rng();
    let bx = px;
    let by = py;
    const dx = qx - px;
    const dy = qy - py;
    const dist = Math.hypot(dx, dy);
    if (dist > len * 1.1) {
      // Twiglet toward the leaf position.
      const reach = dist - len * 0.7;
      bx = px + (dx / dist) * reach;
      by = py + (dy / dist) * reach;
      L.twig(px, py, bx, by, o.twigWidth * 0.12);
    }
    const ang = Math.atan2(qy - by, qx - bx) + gauss(rng) * 0.35;
    L.leaf(bx, by, ang, len, len * o.widthRatio, o.shape, o.fold * (0.5 + rng()));
  }
  L.shuffleLeaves();
  return L.result();
}

/**
 * Pine needle clump: shoots radiate from a stem and end in brush-like fascicle tufts; needles of a tuft fan out in 3D,
 * so their projected lengths vary.
 */
function needleClump(
  rng: Rng,
  o: { tufts: number; needles: number; needleLen: [number, number]; spread: number; halfWidth: number; stemWidth: number; ellipse: Ellipse; upward: number },
): LeafInstance[] {
  const L = new Layout(rng);
  const e = o.ellipse;
  const pts = clumpSkeleton(L, e, Math.max(3, Math.round(o.tufts * 0.45)), o.stemWidth);
  const tufts: [number, number, number][] = [];
  let guard = 0;
  while (tufts.length < o.tufts && guard++ < o.tufts * 20) {
    const [qx, qy] = pointInEllipse(rng, { cx: e.cx, cy: e.cy, rx: e.rx * 0.78, ry: e.ry * 0.78 }, 0.55);
    if (tufts.some(([x, y]) => Math.hypot(x - qx, y - qy) < o.needleLen[0] * 0.75)) {
      continue;
    }
    const [px, py] = nearestTwig(pts, qx, qy);
    if (Math.hypot(qx - px, qy - py) > 0.02) {
      L.twig(px, py, qx, qy, o.stemWidth * 0.35);
    }
    const a = Math.atan2(qy - py, qx - px);
    tufts.push([qx, qy, Math.atan2(Math.sin(a) + o.upward, Math.cos(a))]);
  }
  for (const [tx, ty, ta] of tufts) {
    for (let k = 0; k < o.needles; k++) {
      // Needle direction on a cone around the shoot; the projection shortens needles pointing at the viewer.
      const theta = rng() * TAU;
      const phi = o.spread * Math.sqrt(rng());
      const lateral = Math.sin(phi) * Math.cos(theta);
      const depth = Math.sin(phi) * Math.sin(theta);
      const along = Math.cos(phi);
      const proj = Math.hypot(along, lateral);
      const a = ta + Math.atan2(lateral, along);
      const back = rng() * 0.05;
      const sx = tx - Math.cos(ta) * back;
      const sy = ty - Math.sin(ta) * back;
      const nl = (o.needleLen[0] + (o.needleLen[1] - o.needleLen[0]) * rng()) * Math.max(proj, 0.25);
      L.leaf(sx, sy, a, nl, o.halfWidth * (0.85 + 0.3 * rng()), Shape.Needle, 0);
      void depth;
    }
  }
  L.shuffleLeaves();
  return L.result();
}

/** Twig spray layouts and colours of every foliage layer (deterministic). */
export function buildLeafLayers(): LeafLayerSpec[] {
  const rng = createRng(90211);
  return [
    {
      layer: TexLayer.LeafStonePine,
      colorA: [0.055, 0.085, 0.042],
      colorB: [0.1, 0.135, 0.06],
      twig: [0.14, 0.085, 0.05],
      translucency: 0.7,
      instances: needleClump(rng, { tufts: 23, needles: 84, needleLen: [0.1, 0.16], spread: 1.25, halfWidth: 0.0034, stemWidth: 0.012, ellipse: { cx: 0.5, cy: 0.54, rx: 0.44, ry: 0.42 }, upward: 0.5 }),
    },
    {
      layer: TexLayer.LeafBlackPine,
      colorA: [0.022, 0.048, 0.024],
      colorB: [0.045, 0.078, 0.036],
      twig: [0.1, 0.07, 0.05],
      translucency: 0.55,
      instances: needleClump(rng, { tufts: 21, needles: 76, needleLen: [0.075, 0.12], spread: 1.15, halfWidth: 0.0036, stemWidth: 0.011, ellipse: { cx: 0.5, cy: 0.54, rx: 0.43, ry: 0.42 }, upward: 0.35 }),
    },
    {
      layer: TexLayer.LeafRedPine,
      colorA: [0.05, 0.085, 0.03],
      colorB: [0.085, 0.12, 0.045],
      twig: [0.18, 0.09, 0.05],
      translucency: 0.7,
      instances: needleClump(rng, { tufts: 19, needles: 70, needleLen: [0.1, 0.17], spread: 1.2, halfWidth: 0.003, stemWidth: 0.011, ellipse: { cx: 0.5, cy: 0.54, rx: 0.44, ry: 0.42 }, upward: 0.55 }),
    },
    {
      layer: TexLayer.LeafCypress,
      colorA: [0.02, 0.04, 0.02],
      colorB: [0.045, 0.07, 0.032],
      twig: [0.09, 0.07, 0.05],
      translucency: 0.4,
      instances: cypressSpray(rng),
    },
    {
      layer: TexLayer.LeafPlane,
      colorA: [0.06, 0.12, 0.03],
      colorB: [0.11, 0.17, 0.045],
      twig: [0.16, 0.13, 0.07],
      translucency: 0.95,
      instances: broadleafClump(rng, { shape: Shape.Palmate, leafLen: [0.07, 0.1], widthRatio: 0.76, leaves: 300, sideTwigs: 7, fold: 0.25, twigWidth: 0.009, ellipse: { cx: 0.5, cy: 0.54, rx: 0.4, ry: 0.4 } }),
    },
    {
      layer: TexLayer.LeafOak,
      colorA: [0.04, 0.08, 0.025],
      colorB: [0.075, 0.12, 0.035],
      twig: [0.13, 0.1, 0.07],
      translucency: 0.8,
      instances: broadleafClump(rng, { shape: Shape.Oak, leafLen: [0.075, 0.105], widthRatio: 0.34, leaves: 420, sideTwigs: 8, fold: 0.2, twigWidth: 0.007, ellipse: { cx: 0.5, cy: 0.54, rx: 0.42, ry: 0.42 } }),
    },
    {
      layer: TexLayer.LeafChestnut,
      colorA: [0.055, 0.105, 0.03],
      colorB: [0.09, 0.145, 0.04],
      twig: [0.15, 0.1, 0.06],
      translucency: 0.85,
      instances: broadleafClump(rng, { shape: Shape.Lanceolate, leafLen: [0.11, 0.16], widthRatio: 0.21, leaves: 330, sideTwigs: 7, fold: 0.3, twigWidth: 0.007, ellipse: { cx: 0.5, cy: 0.54, rx: 0.42, ry: 0.42 } }),
    },
    {
      layer: TexLayer.LeafPalm,
      colorA: [0.07, 0.1, 0.035],
      colorB: [0.11, 0.13, 0.05],
      twig: [0.2, 0.17, 0.08],
      translucency: 0.75,
      instances: palmFrond(rng),
    },
  ];
}

export const LEAF_MEAN_COLOR: [number, number, number] = [0.05, 0.085, 0.03];
