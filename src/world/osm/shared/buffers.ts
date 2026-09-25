/** Growable buffers for building meshes and instance / collider records in workers. */
import type { AttributeArrays, MeshArrays } from './protocol';

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
  private readonly cls: number[] = [];
  count = 0;
  /** Class of the triangles written from now on (shared/mesh-tiles.ts TriLod); only recorded once set. */
  lod = 0;
  private tracked = false;

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
    this.mark(1);
  }

  /** Triangles (a, b, c) and (a, c, d). */
  quad(a: number, b: number, c: number, d: number): void {
    this.idx.push(a, b, c, a, c, d);
    this.mark(2);
  }

  private mark(n: number): void {
    if (this.lod !== 0 && !this.tracked) {
      this.tracked = true;
      this.cls.length = this.idx.length / 3 - n;
      this.cls.fill(0);
    }
    if (this.tracked) {
      for (let k = 0; k < n; k++) {
        this.cls.push(this.lod);
      }
    }
  }

  /** Per-triangle TriLod classes (all Both when `lod` was never set). */
  takeTriLod(): Uint8Array {
    const out = new Uint8Array(this.idx.length / 3);
    if (this.tracked) {
      out.set(this.cls);
    }
    return out;
  }

  get triangles(): number {
    return this.idx.length / 3;
  }

  /** Transferable arrays; `colorAttr` is quantised to normalised Uint8. */
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
