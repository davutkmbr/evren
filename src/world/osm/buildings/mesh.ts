/**
 * Mesh writers of the buildings worker. Facade and roof vertices carry many per-wall constants (layout, style,
 * seed), so the writer keeps a current "state" for those and every vertex call only passes position, normal and uv.
 */
import type { AttributeArrays, MeshArrays } from '../shared/protocol';

class Grow {
  a: Float32Array;
  n = 0;
  constructor(cap: number) {
    this.a = new Float32Array(cap);
  }
  reserve(k: number): void {
    if (this.n + k > this.a.length) {
      const next = new Float32Array(Math.max(this.a.length * 2, this.n + k));
      next.set(this.a.subarray(0, this.n));
      this.a = next;
    }
  }
}

export interface StateAttr {
  name: string;
  size: number;
  /** Quantise to normalised Uint8 on take(). */
  u8?: boolean;
}

/**
 * Indexed triangle mesh: position, normal, uv per vertex, plus state attributes copied from set() to every vertex.
 */
export class StateMesh {
  private readonly pos = new Grow(1 << 16);
  private readonly nrm = new Grow(1 << 16);
  private readonly uv = new Grow(1 << 15);
  private readonly state: { attr: StateAttr; buf: Grow; cur: Float32Array }[];
  private idx = new Uint32Array(1 << 16);
  private cls = new Uint8Array(1 << 14);
  private ni = 0;
  count = 0;
  /**
   * Class of the triangles written from now on (shared/mesh-tiles.ts TriLod): Both, Near (detail the far version
   * leaves out) or Far (stand-ins that only the far version has).
   */
  lod = 0;

  constructor(attrs: StateAttr[]) {
    this.state = attrs.map((attr) => ({ attr, buf: new Grow(attr.size << 14), cur: new Float32Array(attr.size) }));
  }

  /** Sets state attribute `i` (index in the constructor list). */
  set(i: number, ...v: number[]): void {
    const c = this.state[i].cur;
    for (let k = 0; k < c.length; k++) {
      c[k] = v[k] ?? 0;
    }
  }

  get(i: number): Float32Array {
    return this.state[i].cur;
  }

  v(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, w: number): number {
    const p = this.pos;
    p.reserve(3);
    p.a[p.n++] = x;
    p.a[p.n++] = y;
    p.a[p.n++] = z;
    const n = this.nrm;
    n.reserve(3);
    n.a[n.n++] = nx;
    n.a[n.n++] = ny;
    n.a[n.n++] = nz;
    const t = this.uv;
    t.reserve(2);
    t.a[t.n++] = u;
    t.a[t.n++] = w;
    for (const s of this.state) {
      s.buf.reserve(s.cur.length);
      s.buf.a.set(s.cur, s.buf.n);
      s.buf.n += s.cur.length;
    }
    return this.count++;
  }

  private pushIdx(a: number, b: number, c: number): void {
    if (this.ni + 3 > this.idx.length) {
      const next = new Uint32Array(this.idx.length * 2);
      next.set(this.idx);
      this.idx = next;
    }
    const t = this.ni / 3;
    if (t >= this.cls.length) {
      const next = new Uint8Array(this.cls.length * 2);
      next.set(this.cls);
      this.cls = next;
    }
    this.cls[t] = this.lod;
    this.idx[this.ni++] = a;
    this.idx[this.ni++] = b;
    this.idx[this.ni++] = c;
  }

  tri(a: number, b: number, c: number): void {
    this.pushIdx(a, b, c);
  }

  quad(a: number, b: number, c: number, d: number): void {
    this.pushIdx(a, b, c);
    this.pushIdx(a, c, d);
  }

  get triangles(): number {
    return this.ni / 3;
  }

  /**
   * Planar polygon (fan) facing `n`: winding is chosen from the normal, uv from `uv(x, y, z)`.
   */
  poly(pts: readonly (readonly [number, number, number])[], nx: number, ny: number, nz: number, uv: (x: number, y: number, z: number) => [number, number]): void {
    const [a, b, c] = pts;
    const cx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
    const cy = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    const cz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const flip = cx * nx + cy * ny + cz * nz < 0;
    const base = this.count;
    for (const p of pts) {
      const [u, w] = uv(p[0], p[1], p[2]);
      this.v(p[0], p[1], p[2], nx, ny, nz, u, w);
    }
    for (let i = 1; i < pts.length - 1; i++) {
      if (flip) {
        this.pushIdx(base, base + i + 1, base + i);
      } else {
        this.pushIdx(base, base + i, base + i + 1);
      }
    }
  }

  /** Per-triangle TriLod classes (see `lod`). */
  takeTriLod(): Uint8Array {
    return this.cls.slice(0, this.ni / 3);
  }

  /** Runs `fn` with `lod` set to `cls` (nested calls keep the outer class unless they set their own). */
  with(cls: number, fn: () => void): void {
    const prev = this.lod;
    this.lod = cls;
    try {
      fn();
    } finally {
      this.lod = prev;
    }
  }

  take(): MeshArrays {
    const attributes: Record<string, AttributeArrays> = {
      position: { array: this.pos.a.slice(0, this.pos.n), size: 3 },
      normal: { array: this.nrm.a.slice(0, this.nrm.n), size: 3 },
      uv: { array: this.uv.a.slice(0, this.uv.n), size: 2 },
    };
    for (const s of this.state) {
      const f = s.buf.a.subarray(0, s.buf.n);
      if (s.attr.u8) {
        const u8 = new Uint8Array(f.length);
        for (let i = 0; i < f.length; i++) {
          u8[i] = Math.round(Math.min(1, Math.max(0, f[i])) * 255);
        }
        attributes[s.attr.name] = { array: u8, size: s.attr.size, normalized: true };
      } else {
        attributes[s.attr.name] = { array: f.slice(), size: s.attr.size };
      }
    }
    return { attributes, index: this.idx.slice(0, this.ni) };
  }
}

/** Facade state attributes (see archetypes.ts and facade-glsl.ts). */
export const FACADE_STATE: StateAttr[] = [
  { name: 'color', size: 3, u8: true },
  { name: 'aFac', size: 4 },
  { name: 'aGnd', size: 2 },
  { name: 'aSty', size: 4 },
  { name: 'aWin', size: 4 },
];
export const F = { Color: 0, Fac: 1, Gnd: 2, Sty: 3, Win: 4 } as const;

/** Roof state attributes: tint, aRoof = (cover, seed, wear, eave height). */
export const ROOF_STATE: StateAttr[] = [
  { name: 'color', size: 3, u8: true },
  { name: 'aRoof', size: 4 },
];
export const R = { Color: 0, Roof: 1 } as const;

/** Growable record list (instances, colliders) with a tile index per record. */
export class RecordList {
  private buf = new Grow(1 << 12);
  private tiles: number[] = [];

  constructor(readonly stride: number) {}

  push(tile: number, ...v: number[]): void {
    this.buf.reserve(this.stride);
    for (let i = 0; i < this.stride; i++) {
      this.buf.a[this.buf.n++] = v[i] ?? 0;
    }
    this.tiles.push(tile);
  }

  get length(): number {
    return this.tiles.length;
  }

  /** Records sorted by tile (counting sort) plus per-tile [start, count] pairs over `tileCount` tiles. */
  sorted(tileCount: number): { records: Float32Array; ranges: Int32Array } {
    const n = this.tiles.length;
    const counts = new Int32Array(tileCount);
    for (const t of this.tiles) {
      counts[t]++;
    }
    const ranges = new Int32Array(tileCount * 2);
    let acc = 0;
    for (let t = 0; t < tileCount; t++) {
      ranges[t * 2] = acc;
      ranges[t * 2 + 1] = counts[t];
      acc += counts[t];
    }
    const fill = new Int32Array(tileCount);
    const out = new Float32Array(n * this.stride);
    for (let i = 0; i < n; i++) {
      const t = this.tiles[i];
      const dst = (ranges[t * 2] + fill[t]++) * this.stride;
      out.set(this.buf.a.subarray(i * this.stride, (i + 1) * this.stride), dst);
    }
    return { records: out, ranges };
  }

  /** Records in push order. */
  take(): Float32Array {
    return this.buf.a.slice(0, this.buf.n);
  }
}
