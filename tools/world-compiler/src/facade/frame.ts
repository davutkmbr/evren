/**
 * Façade frame and batched emission for the façade kit.
 *
 * A Frame is the local system of one footprint edge seen from outside: `r` runs to the right along the wall (0 at
 * the left end), `y` is world height and `d` the distance in front of the wall plane (negative = into the wall).
 * Footprint rings are positive-area (outward normal = right-hand side of the edge), so the left end seen from
 * outside is the edge's end point B and "right" is -u.
 *
 * A Batch collects quads and triangles per (material, face direction) and emits each group as ONE planar chart
 * (TileMesh.flatTriangles): a window, a balcony or a shop unit becomes a handful of lightmap charts instead of one
 * per face. Callers flush a batch per element, so a chart never covers parts that overlap in projection.
 */
import type { MaterialName } from '../materials';
import type { RGBA, TileMesh, Vec2, Vec3 } from '../mesh';

export class Frame {
  constructor(
    /** World position of r = 0, d = 0 (x, z). */
    readonly ox: number,
    readonly oz: number,
    /** Unit vector of +r (x, z). */
    readonly rx: number,
    readonly rz: number,
    /** Unit outward normal (x, z). */
    readonly nx: number,
    readonly nz: number,
    readonly len: number,
  ) {}

  /** Frame of the edge a -> b of a positive-area ring. */
  static ofEdge(ax: number, az: number, bx: number, bz: number): Frame {
    const len = Math.hypot(bx - ax, bz - az) || 1e-9;
    const ux = (bx - ax) / len;
    const uz = (bz - az) / len;
    return new Frame(bx, bz, -ux, -uz, uz, -ux, len);
  }

  p(r: number, y: number, d: number): Vec3 {
    return [this.ox + this.rx * r + this.nx * d, y, this.oz + this.rz * r + this.nz * d];
  }

  /** World (x, z) of a frame point. */
  xz(r: number, d: number): [number, number] {
    return [this.ox + this.rx * r + this.nx * d, this.oz + this.rz * r + this.nz * d];
  }

  /** World direction of a frame axis. */
  dir(a: Axis): Vec3 {
    switch (a) {
      case 'R':
        return [this.rx, 0, this.rz];
      case '-R':
        return [-this.rx, 0, -this.rz];
      case 'N':
        return [this.nx, 0, this.nz];
      case '-N':
        return [-this.nx, 0, -this.nz];
      case 'Y':
        return [0, 1, 0];
      case '-Y':
        return [0, -1, 0];
    }
  }

  /** A world vector from frame components. */
  vec(r: number, y: number, d: number): Vec3 {
    const x = this.rx * r + this.nx * d;
    const z = this.rz * r + this.nz * d;
    const l = Math.hypot(x, y, z) || 1;
    return [x / l, y / l, z / l];
  }
}

export type Axis = 'R' | '-R' | 'N' | '-N' | 'Y' | '-Y';

interface Group {
  m: MaterialName;
  n: Vec3;
  pts: Vec3[];
  tris: number[];
  col: RGBA[];
  uv: Vec2[] | null;
}

/** Faces of a box to emit (default: all but the back). */
export interface BoxFaces {
  front?: boolean;
  back?: boolean;
  left?: boolean;
  right?: boolean;
  top?: boolean;
  bottom?: boolean;
}

const ALL_BUT_BACK: BoxFaces = { front: true, left: true, right: true, top: true, bottom: true };

export class Batch {
  private groups = new Map<string, Group>();
  tris = 0;

  constructor(
    readonly mesh: TileMesh,
    readonly f: Frame,
  ) {}

  private group(m: MaterialName, n: Vec3, uv: boolean): Group {
    const key = `${m}|${n[0].toFixed(3)},${n[1].toFixed(3)},${n[2].toFixed(3)}|${uv ? 1 : 0}`;
    let g = this.groups.get(key);
    if (!g) {
      g = { m, n, pts: [], tris: [], col: [], uv: uv ? [] : null };
      this.groups.set(key, g);
    }
    return g;
  }

  /** Planar polygon (convex, world points) with normal `n`. */
  poly(m: MaterialName, n: Vec3, pts: readonly Vec3[], color: RGBA | readonly RGBA[], uv?: readonly Vec2[]): void {
    if (pts.length < 3) {
      return;
    }
    const g = this.group(m, n, !!uv);
    const base = g.pts.length;
    pts.forEach((p, k) => {
      g.pts.push(p);
      g.col.push(typeof color[0] === 'number' ? (color as RGBA) : (color as readonly RGBA[])[k]);
      if (uv && g.uv) {
        g.uv.push(uv[k]);
      }
    });
    for (let k = 1; k + 1 < pts.length; k++) {
      g.tris.push(base, base + k, base + k + 1);
    }
    this.tris += pts.length - 2;
  }

  /** Quad in frame coordinates facing axis `a`: four (r, y, d) corners in order around the quad. */
  quadF(m: MaterialName, a: Axis, c: readonly [number, number, number][], color: RGBA | readonly RGBA[], uv?: readonly Vec2[]): void {
    this.poly(
      m,
      this.f.dir(a),
      c.map(([r, y, d]) => this.f.p(r, y, d)),
      color,
      uv,
    );
  }

  /** Axis-aligned box in frame coordinates. */
  box(m: MaterialName, r0: number, r1: number, y0: number, y1: number, d0: number, d1: number, color: RGBA, faces: BoxFaces = ALL_BUT_BACK): void {
    if (r1 - r0 < 1e-4 || y1 - y0 < 1e-4 || d1 - d0 < 1e-4) {
      return;
    }
    if (faces.front) {
      this.quadF(m, 'N', [[r0, y0, d1], [r1, y0, d1], [r1, y1, d1], [r0, y1, d1]], color);
    }
    if (faces.back) {
      this.quadF(m, '-N', [[r0, y0, d0], [r1, y0, d0], [r1, y1, d0], [r0, y1, d0]], color);
    }
    if (faces.left) {
      this.quadF(m, '-R', [[r0, y0, d0], [r0, y0, d1], [r0, y1, d1], [r0, y1, d0]], color);
    }
    if (faces.right) {
      this.quadF(m, 'R', [[r1, y0, d0], [r1, y0, d1], [r1, y1, d1], [r1, y1, d0]], color);
    }
    if (faces.top) {
      this.quadF(m, 'Y', [[r0, y1, d0], [r1, y1, d0], [r1, y1, d1], [r0, y1, d1]], color);
    }
    if (faces.bottom) {
      this.quadF(m, '-Y', [[r0, y0, d0], [r1, y0, d0], [r1, y0, d1], [r0, y0, d1]], color);
    }
  }

  /** Emits every group as one planar chart each and clears the batch. */
  flush(): void {
    for (const g of this.groups.values()) {
      if (g.tris.length) {
        this.mesh.flatTriangles(g.m, g.pts, g.tris, g.n, { color: g.col, ...(g.uv ? { uv: g.uv } : {}) });
      }
    }
    this.groups = new Map();
  }
}

/* Colours. */

export function srgbLin(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Linear RGBA of an sRGB hex colour, times `k`, with alpha `a`. */
export function lin(hex: number, k = 1, a = 1): RGBA {
  const ch = (s: number): number => Math.min(1, srgbLin(((hex >> s) & 255) / 255) * k);
  return [ch(16), ch(8), ch(0), a];
}

export function scale(c: RGBA, k: number, a = c[3]): RGBA {
  return [Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k), a];
}

export function mix(a: RGBA, b: RGBA, t: number): RGBA {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
}

/** Deterministic hash in [0, 1) of a seed and a salt. */
export function h01(seed: number, salt: number): number {
  const s = Math.sin(seed * 12.9898 + salt * 78.233 + 0.5) * 43758.5453;
  return s - Math.floor(s);
}

export function pick<T>(list: readonly T[], u: number): T {
  return list[Math.min(list.length - 1, Math.floor(u * list.length))];
}

export function pickWeighted<T>(list: readonly (readonly [T, number])[], u: number): T {
  const total = list.reduce((s, [, w]) => s + w, 0);
  let acc = 0;
  for (const [v, w] of list) {
    acc += w / total;
    if (u < acc) {
      return v;
    }
  }
  return list[list.length - 1][0];
}
