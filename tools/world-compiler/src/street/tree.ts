/**
 * Street trees (prop st_tree): a procedural oriental plane (Platanus orientalis, variant 'plane', 15 m before the
 * instance scale; the Aya Efimia precinct tree of c07–c09) and a smaller street tree ('street', 7.5 m), built as a
 * real branch skeleton with geometric leaf clusters — never opaque crown blobs:
 * - trunk and limbs are lathed tubes whose quads take one of three bark materials by a low-frequency noise, giving
 *   the plane's mottled, exfoliating bark (grey, cream and olive patches); the trunk flares at the root collar;
 * - the skeleton has four levels (trunk, 3–5 limbs, secondary branches, twigs) grown towards a broad dome crown;
 * - every twig carries leaf clusters: 5–6 palmate leaves (pentagons, 0.2–0.3 m, double-sided) around its tip and
 *   along it, in three greens; about 3,000 clusters (≈ 55k triangles) on the plane, 1,100 on the street tree, so the
 *   crown is dense from outside with sky and branches showing through, and casts a dappled shadow.
 * S1 round 2 (critique: "brick-textured trunk", "white radial branch sticks", "cartoon"): every leaf is an alpha card
 * cut from the LeafSet010 atlas (four palmate leaves, CC0; one leaf per card, tip away from the twig, COLOR_0 tone
 * per card with a few yellowing ones), the bark is Poly Haven's bark_platanus under the grey / olive / cream patch
 * tints, and the twigs are the darker, finer bark of the young wood.
 */
import type { MaterialName } from '../materials';
import type { RGBA, TileMesh, Vec3 } from '../mesh';
import { Builder } from '../hero/kit';

class Geo {
  private readonly b = new Map<MaterialName, Builder>();
  constructor(readonly mesh: TileMesh) {}
  of(m: MaterialName): Builder {
    let x = this.b.get(m);
    if (!x) {
      x = new Builder();
      this.b.set(m, x);
    }
    return x;
  }
  flush(): void {
    for (const [m, x] of this.b) {
      x.flush(this.mesh, m);
    }
    this.b.clear();
  }
}

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const add = (a: Vec3, b: Vec3, k = 1): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
const norm = (a: Vec3): Vec3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Smooth 3D value noise in [0, 1]. */
function noise3(x: number, y: number, z: number): number {
  const h = (i: number, j: number, k: number): number => {
    const s = Math.sin(i * 127.1 + j * 311.7 + k * 74.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fy = y - yi;
  const fz = z - zi;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const sz = fz * fz * (3 - 2 * fz);
  const l = (a: number, b: number, t: number): number => a + (b - a) * t;
  return l(
    l(l(h(xi, yi, zi), h(xi + 1, yi, zi), sx), l(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), sx), sy),
    l(l(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), sx), l(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), sx), sy),
    sz,
  );
}

/** Bark material of a surface point: mottled patches of the exfoliating plane bark. */
function barkAt(p: Vec3, plane: boolean): MaterialName {
  if (!plane) {
    return noise3(p[0] * 3, p[1] * 1.2, p[2] * 3) < 0.55 ? 'st_bark' : 'st_bark_olive';
  }
  const n = noise3(p[0] * 2.6, p[1] * 1.1, p[2] * 2.6) * 0.7 + noise3(p[0] * 7, p[1] * 3, p[2] * 7) * 0.3;
  return n < 0.42 ? 'st_bark' : n < 0.62 ? 'st_bark_olive' : 'st_bark_cream';
}

/** A tapered tube along a polyline with radii per point; quads pick their bark material by position (or `fixed`). */
function tube(g: Geo, pts: readonly Vec3[], radii: readonly number[], sides: number, plane: boolean, fixed?: MaterialName): void {
  const rings: { p: Vec3; n: Vec3 }[][] = [];
  let prevS1: Vec3 | null = null;
  for (let k = 0; k < pts.length; k++) {
    const t = norm(sub(pts[Math.min(pts.length - 1, k + 1)], pts[Math.max(0, k - 1)]));
    let s1: Vec3;
    if (prevS1) {
      // Parallel transport of the section frame.
      const d = prevS1[0] * t[0] + prevS1[1] * t[1] + prevS1[2] * t[2];
      s1 = norm(sub(prevS1, [t[0] * d, t[1] * d, t[2] * d]));
    } else {
      s1 = norm(cross(t, Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
    }
    prevS1 = s1;
    const s2 = cross(t, s1);
    const ring: { p: Vec3; n: Vec3 }[] = [];
    for (let q = 0; q < sides; q++) {
      const a = (q / sides) * Math.PI * 2;
      const n = add(add([0, 0, 0], s1, Math.cos(a)), s2, Math.sin(a));
      ring.push({ p: add(pts[k], n, radii[k]), n });
    }
    rings.push(ring);
  }
  for (let k = 0; k + 1 < rings.length; k++) {
    for (let q = 0; q < sides; q++) {
      const a = rings[k][q];
      const b = rings[k][(q + 1) % sides];
      const c = rings[k + 1][(q + 1) % sides];
      const d = rings[k + 1][q];
      const mid: Vec3 = [(a.p[0] + c.p[0]) / 2, (a.p[1] + c.p[1]) / 2, (a.p[2] + c.p[2]) / 2];
      const B = g.of(fixed ?? barkAt(mid, plane));
      B.quad(B.v(a.p, a.n), B.v(b.p, b.n), B.v(c.p, c.n), B.v(d.p, d.n));
    }
  }
  // Cap the thin end.
  const last = rings[rings.length - 1];
  const B = g.of(fixed ?? 'st_bark');
  const tip = B.v(pts[pts.length - 1], norm(sub(pts[pts.length - 1], pts[pts.length - 2])));
  for (let q = 0; q < sides; q++) {
    B.tri(tip, B.v(last[q].p, last[q].n), B.v(last[(q + 1) % sides].p, last[(q + 1) % sides].n));
  }
}

/** A curved branch from `a` along `dir` of length `l`, bending by `bend` (vector added along its length). */
function branchPts(a: Vec3, dir: Vec3, l: number, bend: Vec3, n: number): Vec3[] {
  const out: Vec3[] = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    out.push(add(add(a, dir, l * t), bend, t * t));
  }
  return out;
}

/** The four leaves of the LeafSet010 atlas: image rectangles [u0, v0 (tip), u1, v1 (stalk)]. */
const LEAF_RECTS: [number, number, number, number][] = [
  [0.06, 0.04, 0.47, 0.47],
  [0.56, 0.04, 0.91, 0.47],
  [0.07, 0.49, 0.45, 0.99],
  [0.59, 0.49, 0.91, 0.99],
];

/** Leaf card: one atlas leaf on a quad whose stalk end sits at `c`, facing n, tip towards `along`, tinted by `tone`. */
function leaf(g: Geo, c: Vec3, n: Vec3, along: Vec3, size: number, pick: number, tone: RGBA): void {
  const b = g.of('st_leaf_card');
  const u = norm(sub(along, add([0, 0, 0], n, along[0] * n[0] + along[1] * n[1] + along[2] * n[2])));
  const v = cross(n, u);
  const [u0, v0, u1, v1] = LEAF_RECTS[pick % LEAF_RECTS.length];
  const w = size * ((u1 - u0) / (v1 - v0));
  const P = (x: number, y: number): Vec3 => add(add(c, u, y * size), v, x * w);
  const ids = [
    b.v(P(-0.5, 0), n, [u0, v1], tone),
    b.v(P(0.5, 0), n, [u1, v1], tone),
    b.v(P(0.5, 1), n, [u1, v0], tone),
    b.v(P(-0.5, 1), n, [u0, v0], tone),
  ];
  b.quad(ids[0], ids[1], ids[2], ids[3]);
}

interface Spec {
  height: number;
  trunkR: number;
  bole: number;
  limbs: number;
  crown: { cy: number; rx: number; ry: number };
  clusters: number;
  leafSize: number;
}

const PLANE: Spec = { height: 15, trunkR: 0.42, bole: 3.6, limbs: 5, crown: { cy: 9.6, rx: 6.4, ry: 4.9 }, clusters: 3000, leafSize: 0.27 };
const STREET: Spec = { height: 7.5, trunkR: 0.15, bole: 2.3, limbs: 4, crown: { cy: 5.0, rx: 2.6, ry: 2.4 }, clusters: 1100, leafSize: 0.14 };

/** Builds a tree variant (plane: the big precinct plane tree; street: a smaller lane tree). */
export function buildTree(mesh: TileMesh, plane: boolean): void {
  const S = plane ? PLANE : STREET;
  const g = new Geo(mesh);
  const r = rng(plane ? 1931 : 77);
  // Trunk with a root flare and a slight lean.
  const lean: Vec3 = [0.35 * (plane ? 1 : 0.3), 0, 0.15];
  const trunkPts: Vec3[] = [];
  const trunkR: number[] = [];
  for (let k = 0; k <= 8; k++) {
    const t = k / 8;
    const y = S.bole * 1.15 * t;
    trunkPts.push([lean[0] * t * t, y, lean[2] * t * t]);
    trunkR.push(S.trunkR * (1 + 0.45 * Math.pow(1 - Math.min(1, t * 4), 2)) * (1 - 0.18 * t));
  }
  tube(g, trunkPts, trunkR, plane ? 14 : 9, plane);
  // Root buttresses at the collar.
  if (plane) {
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + 0.3;
      const out: Vec3 = [Math.cos(a), 0, Math.sin(a)];
      tube(g, [add([0, 0.55, 0], out, S.trunkR * 0.6), add([0, 0.02, 0], out, S.trunkR * 1.9)], [0.16, 0.05], 6, plane);
    }
  }
  const top = trunkPts[trunkPts.length - 1];
  const centre: Vec3 = [lean[0], S.crown.cy, lean[2]];
  const { rx, ry } = S.crown;
  /** Skeleton points leaf twigs may start from, with the branch radius there. */
  const anchors: { p: Vec3; r: number }[] = [];
  // Limbs rise from the bole top towards points at about 55 % of the crown radius, a little above its centre.
  for (let li = 0; li < S.limbs; li++) {
    const az = (li / S.limbs) * Math.PI * 2 + (r() - 0.5) * 0.7;
    const target: Vec3 = [centre[0] + Math.cos(az) * rx * (0.5 + 0.15 * r()), centre[1] + ry * (0.05 + 0.25 * r()), centre[2] + Math.sin(az) * rx * (0.5 + 0.15 * r())];
    const start = add(top, [0, -0.5 * r(), 0]);
    const d = sub(target, start);
    const l1 = len(d);
    const p1 = branchPts(start, norm(d), l1, [0, -0.6 * r(), 0], 6);
    const r1 = S.trunkR * (0.5 + 0.1 * r());
    tube(g, p1, p1.map((_, k) => r1 * (1 - 0.6 * (k / (p1.length - 1)))), plane ? 9 : 6, plane);
    // Secondary branches from the upper two thirds, spreading to the shell.
    const n2 = plane ? 4 : 3;
    for (let bi = 0; bi < n2; bi++) {
      const t = 0.35 + (0.65 * (bi + 0.3 + 0.5 * r())) / n2;
      const a2 = p1[Math.min(p1.length - 1, Math.round(t * (p1.length - 1)))];
      const az2 = az + (r() - 0.5) * 1.8;
      const el = (r() - 0.25) * 0.9;
      const tgt: Vec3 = [centre[0] + Math.cos(az2) * rx * 0.85 * Math.cos(el), centre[1] + ry * 0.85 * Math.sin(el), centre[2] + Math.sin(az2) * rx * 0.85 * Math.cos(el)];
      const d2 = sub(tgt, a2);
      const l2 = len(d2) * (0.75 + 0.15 * r());
      const p2 = branchPts(a2, norm(d2), l2, [0, -0.3 * r(), 0], 4);
      const rr2 = r1 * 0.42;
      tube(g, p2, p2.map((_, k) => rr2 * (1 - 0.65 * (k / (p2.length - 1)))), plane ? 6 : 5, plane);
      p2.forEach((p, k) => anchors.push({ p, r: rr2 * (1 - 0.65 * (k / (p2.length - 1))) }));
    }
    p1.slice(3).forEach((p, k) => anchors.push({ p, r: r1 * (1 - 0.6 * ((k + 3) / (p1.length - 1))) }));
  }
  // Leaf groups on the crown shell (normalised radius 0.72-1.0, not under the crown's lower third), each on a twig
  // from the nearest skeleton point, with clusters of leaves round the group centre.
  const groups = Math.round(S.clusters / 8);
  let clusters = 0;
  const cluster = (p: Vec3, out: Vec3): void => {
    const nLeaves = 5 + Math.floor(r() * 2);
    for (let k = 0; k < nLeaves; k++) {
      const off: Vec3 = [(r() - 0.5) * 0.5, (r() - 0.5) * 0.35, (r() - 0.5) * 0.5];
      const c = add(add(p, off, S.leafSize * 2.2), out, S.leafSize * 0.6 * r());
      // Leaves face mostly up and outwards, with a random twist.
      const n = norm([out[0] * 0.6 + (r() - 0.5) * 1.2, 1.0 + r() * 0.4, out[2] * 0.6 + (r() - 0.5) * 1.2]);
      const along = norm([out[0] + (r() - 0.5), -0.3 + (r() - 0.5) * 0.6, out[2] + (r() - 0.5)]);
      const shade = noise3(c[0] * 0.5, c[1] * 0.5, c[2] * 0.5);
      // Inner and lower leaves darker, sunlit patches lighter, 6 % turning yellow (late September).
      const low = c[1] < centre[1] - ry * 0.3 ? 0.78 : 1;
      const t = low * (0.72 + 0.4 * shade + 0.12 * r());
      const k = Math.min(1, t);
      const tone: RGBA = r() < 0.06 ? [1, 0.9, 0.5, 1] : [k * 0.92, k, k * 0.86, 1];
      leaf(g, c, n, along, S.leafSize * (1.05 + 0.5 * r()), Math.floor(r() * 4), tone);
    }
    clusters++;
  };
  for (let gi = 0; gi < groups; gi++) {
    // Uniform direction on the sphere, squashed to the crown; skip the underside.
    const zc = r() * 2 - 1;
    const az = r() * Math.PI * 2;
    const rr = Math.sqrt(1 - zc * zc);
    const dirU: Vec3 = [rr * Math.cos(az), zc, rr * Math.sin(az)];
    if (dirU[1] < -0.55) {
      continue;
    }
    const k = 0.72 + 0.28 * Math.sqrt(r());
    const gc: Vec3 = [centre[0] + dirU[0] * rx * k, centre[1] + dirU[1] * ry * k, centre[2] + dirU[2] * rx * k];
    const out = norm([dirU[0] / rx, dirU[1] / ry + 0.15, dirU[2] / rx]);
    let best = anchors[0];
    let bd = Infinity;
    for (const a2 of anchors) {
      const dd = len(sub(a2.p, gc));
      if (dd < bd) {
        bd = dd;
        best = a2;
      }
    }
    const twigEnd = add(gc, out, -S.leafSize);
    const mid = add(add(best.p, sub(twigEnd, best.p), 0.5), [0, 0.15 * bd * (r() - 0.3), 0]);
    tube(g, [best.p, mid, twigEnd], [Math.min(best.r, 0.05) * 0.8, 0.02, 0.008], 3, plane, 'st_bark_twig');
    const nc = 6 + Math.floor(r() * 5);
    for (let q = 0; q < nc; q++) {
      const o: Vec3 = [(r() - 0.5) * 1.3, (r() - 0.5) * 0.8, (r() - 0.5) * 1.3];
      cluster(add(add(gc, o, plane ? 1 : 0.55), out, 0.2 * r()), out);
    }
  }
  void clusters;
  g.flush();
}
