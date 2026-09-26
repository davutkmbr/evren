/**
 * CaptureMesh: the part of TileMesh a façade Batch writes to (flatTriangles, flatPolygon, addMesh), recording the
 * triangles of one module in the module frame instead of a tile. Emissions are grouped into primitives by material,
 * tint slot and UV kind (world-projected, or the caller's own UVs: decals), which is how the module glb stores them.
 * Winding follows TileMesh.flatTri exactly (degenerate triangles are dropped, back-facing ones flipped).
 */
import type { MaterialName } from '../materials';
import type { EmitOptions, MeshInput, RGBA, TileMesh, Vec2, Vec3 } from '../mesh';
import { tilingOf } from '../textures';

export interface CapturedPrim {
  material: MaterialName;
  tint: number | null;
  moduleUv: boolean;
  pos: number[];
  nrm: number[];
  col: number[];
  uv: number[];
  idx: number[];
}

export class CaptureMesh {
  readonly ox = 0;
  readonly oz = 0;
  lodMask = 1;
  /** Tint slot of new emissions (null: none); flush the Batch before changing it. */
  tint: number | null = null;
  private readonly prims = new Map<string, CapturedPrim>();

  withLod<T>(_mask: number, fn: () => T): T {
    return fn();
  }

  triangles(): number {
    let n = 0;
    for (const p of this.prims.values()) {
      n += p.idx.length / 3;
    }
    return n;
  }

  private prim(m: MaterialName, moduleUv: boolean): CapturedPrim {
    const key = `${m}|${this.tint ?? '-'}|${moduleUv ? 1 : 0}`;
    let p = this.prims.get(key);
    if (!p) {
      p = { material: m, tint: this.tint, moduleUv, pos: [], nrm: [], col: [], uv: [], idx: [] };
      this.prims.set(key, p);
    }
    return p;
  }

  flatPolygon(m: MaterialName, pts: readonly Vec3[], n: Vec3, opts?: EmitOptions): void {
    if (pts.length < 3) {
      return;
    }
    const tris: number[] = [];
    for (let k = 1; k + 1 < pts.length; k++) {
      tris.push(0, k, k + 1);
    }
    this.flatTriangles(m, pts, tris, n, opts);
  }

  flatTriangles(m: MaterialName, pts: readonly Vec3[], tris: readonly number[], n: Vec3, opts?: EmitOptions): void {
    const own = !!opts?.uv || !!opts?.uvm;
    const p = this.prim(m, own);
    const base = p.pos.length / 3;
    const [tw, th] = tilingOf(m);
    pts.forEach((v, k) => {
      p.pos.push(v[0], v[1], v[2]);
      const sn = opts?.normals?.[k] ?? n;
      p.nrm.push(sn[0], sn[1], sn[2]);
      const c = colorAt(opts?.color, k) ?? [1, 1, 1, 1];
      p.col.push(c[0], c[1], c[2], c[3]);
      if (opts?.uv) {
        p.uv.push(opts.uv[k][0], opts.uv[k][1]);
      } else if (opts?.uvm) {
        p.uv.push(opts.uvm[k][0] / tw, opts.uvm[k][1] / th);
      }
    });
    for (let k = 0; k < tris.length; k += 3) {
      this.tri(p, base + tris[k], base + tris[k + 1], base + tris[k + 2], n);
    }
  }

  addMesh(m: MaterialName, input: MeshInput): void {
    const own = !!input.uv || !!input.uvm;
    const p = this.prim(m, own);
    const base = p.pos.length / 3;
    const nv = input.positions.length / 3;
    const [tw, th] = tilingOf(m);
    for (let k = 0; k < nv; k++) {
      p.pos.push(input.positions[k * 3], input.positions[k * 3 + 1], input.positions[k * 3 + 2]);
      p.nrm.push(input.normals?.[k * 3] ?? 0, input.normals?.[k * 3 + 1] ?? 1, input.normals?.[k * 3 + 2] ?? 0);
      const c = colorAt(input.color, k) ?? [1, 1, 1, 1];
      p.col.push(c[0], c[1], c[2], c[3]);
      if (input.uv) {
        p.uv.push(input.uv[k * 2], input.uv[k * 2 + 1]);
      } else if (input.uvm) {
        p.uv.push(input.uvm[k * 2] / tw, input.uvm[k * 2 + 1] / th);
      }
    }
    for (let k = 0; k + 2 < input.indices.length; k += 3) {
      p.idx.push(base + input.indices[k], base + input.indices[k + 1], base + input.indices[k + 2]);
    }
  }

  private tri(p: CapturedPrim, a: number, b: number, c: number, n: Vec3): void {
    const P = p.pos;
    const ux = P[b * 3] - P[a * 3];
    const uy = P[b * 3 + 1] - P[a * 3 + 1];
    const uz = P[b * 3 + 2] - P[a * 3 + 2];
    const vx = P[c * 3] - P[a * 3];
    const vy = P[c * 3 + 1] - P[a * 3 + 1];
    const vz = P[c * 3 + 2] - P[a * 3 + 2];
    const d = (uy * vz - uz * vy) * n[0] + (uz * vx - ux * vz) * n[1] + (ux * vy - uy * vx) * n[2];
    if (Math.abs(d) < 1e-10) {
      return;
    }
    if (d < 0) {
      p.idx.push(a, c, b);
    } else {
      p.idx.push(a, b, c);
    }
  }

  /** The recorded primitives in emission order of their first use. */
  take(): CapturedPrim[] {
    return [...this.prims.values()].filter((p) => p.idx.length);
  }

  /** This capture as the TileMesh a Batch expects (it only calls the methods above). */
  asTileMesh(): TileMesh {
    return this as unknown as TileMesh;
  }
}

function colorAt(c: RGBA | readonly RGBA[] | undefined, k: number): RGBA | undefined {
  if (!c) {
    return undefined;
  }
  return typeof c[0] === 'number' ? (c as RGBA) : (c as readonly RGBA[])[k];
}

export type { Vec2 };
