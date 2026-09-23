/** Worker-side helpers: geo sampling over the transferred grid windows, growable mesh buffers, hashing, polygons. */
import type { AttributeArrays, GridWin, MeshArrays, OsmBuildRequest } from '../protocol';

function bilinear(g: GridWin<Float32Array>, x: number, z: number): number {
  let fx = (x - g.x0) / g.cell;
  let fz = (z - g.z0) / g.cell;
  fx = fx < 0 ? 0 : fx > g.w - 1.0001 ? g.w - 1.0001 : fx;
  fz = fz < 0 ? 0 : fz > g.h - 1.0001 ? g.h - 1.0001 : fz;
  const ix = fx | 0;
  const iz = fz | 0;
  const tx = fx - ix;
  const tz = fz - iz;
  const i = iz * g.w + ix;
  const d = g.data;
  const top = d[i] + (d[i + 1] - d[i]) * tx;
  const bottom = d[i + g.w] + (d[i + g.w + 1] - d[i + g.w]) * tx;
  return top + (bottom - top) * tz;
}

/** Same bilinear lookups as GeoQuery.heightAt / coastDistance / landUseAt over the request windows. */
export class GeoSampler {
  constructor(private readonly req: OsmBuildRequest) {}

  height(x: number, z: number): number {
    return bilinear(this.req.height, x, z);
  }

  coast(x: number, z: number): number {
    return bilinear(this.req.coast, x, z);
  }

  isWater(x: number, z: number): boolean {
    return this.coast(x, z) < 0;
  }

  landUse(x: number, z: number): number {
    const g = this.req.landUse;
    const c = Math.min(g.w - 1, Math.max(0, Math.round((x - g.x0) / g.cell)));
    const r = Math.min(g.h - 1, Math.max(0, Math.round((z - g.z0) / g.cell)));
    return g.data[r * g.w + c];
  }
}

/** Growable float buffer. */
export class FloatBuf {
  array: Float32Array;
  length = 0;

  constructor(capacity = 1024) {
    this.array = new Float32Array(capacity);
  }

  push(...v: number[]): void {
    if (this.length + v.length > this.array.length) {
      const next = new Float32Array(Math.max(this.array.length * 2, this.length + v.length));
      next.set(this.array);
      this.array = next;
    }
    for (let i = 0; i < v.length; i++) {
      this.array[this.length++] = v[i];
    }
  }

  take(): Float32Array {
    return this.array.slice(0, this.length);
  }
}

/** Indexed triangle mesh with named float attributes of fixed sizes. */
export class MeshBuf {
  readonly attrs: Record<string, { buf: FloatBuf; size: number }> = {};
  private readonly idx: number[] = [];
  count = 0;

  constructor(layout: Record<string, number>) {
    for (const [name, size] of Object.entries(layout)) {
      this.attrs[name] = { buf: new FloatBuf(4096 * size), size };
    }
  }

  /** Appends one vertex; `v` lists every attribute's components in layout order. */
  vertex(...v: number[]): number {
    let k = 0;
    for (const name in this.attrs) {
      const a = this.attrs[name];
      const buf = a.buf;
      if (buf.length + a.size > buf.array.length) {
        buf.push(...v.slice(k, k + a.size));
      } else {
        for (let i = 0; i < a.size; i++) {
          buf.array[buf.length++] = v[k + i];
        }
      }
      k += a.size;
    }
    return this.count++;
  }

  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }

  /** Triangles (a, b, c) and (a, c, d). */
  quad(a: number, b: number, c: number, d: number): void {
    this.idx.push(a, b, c, a, c, d);
  }

  get triangles(): number {
    return this.idx.length / 3;
  }

  take(colorAttr?: string): MeshArrays {
    const attributes: Record<string, AttributeArrays> = {};
    for (const [name, a] of Object.entries(this.attrs)) {
      const f = a.buf.take();
      if (name === colorAttr) {
        const u8 = new Uint8Array(f.length);
        for (let i = 0; i < f.length; i++) {
          u8[i] = Math.round(Math.min(1, Math.max(0, f[i])) * 255);
        }
        attributes[name] = { array: u8, size: a.size, normalized: true };
      } else {
        attributes[name] = { array: f, size: a.size };
      }
    }
    return { attributes, index: Uint32Array.from(this.idx) };
  }
}

export function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export function ringArea(r: ArrayLike<number>): number {
  let a = 0;
  const n = r.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += r[i * 2] * r[j * 2 + 1] - r[j * 2] * r[i * 2 + 1];
  }
  return a / 2;
}

export function pointInRing(r: ArrayLike<number>, x: number, z: number): boolean {
  let inside = false;
  const n = r.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = r[i * 2];
    const zi = r[i * 2 + 1];
    const xj = r[j * 2];
    const zj = r[j * 2 + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  const t = l2 > 1e-9 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0;
  return Math.hypot(px - ax - t * dx, pz - az - t * dz);
}

/** Uniform grid of item bounding boxes for point queries. */
export class BoxGrid {
  private readonly cells = new Map<number, number[]>();

  constructor(private readonly cell: number) {}

  private key(i: number, j: number): number {
    return (i + 32768) * 65536 + (j + 32768);
  }

  add(id: number, x0: number, z0: number, x1: number, z1: number): void {
    for (let j = Math.floor(z0 / this.cell); j <= Math.floor(z1 / this.cell); j++) {
      for (let i = Math.floor(x0 / this.cell); i <= Math.floor(x1 / this.cell); i++) {
        const k = this.key(i, j);
        let list = this.cells.get(k);
        if (!list) {
          list = [];
          this.cells.set(k, list);
        }
        list.push(id);
      }
    }
  }

  at(x: number, z: number): readonly number[] {
    return this.cells.get(this.key(Math.floor(x / this.cell), Math.floor(z / this.cell))) ?? [];
  }
}
