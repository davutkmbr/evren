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
