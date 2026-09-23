/**
 * Per-tile triangle soup merged per material (one glTF primitive each). Positions are world metres on input and
 * stored relative to the tile origin (the glTF node translation). Smooth vertices are welded per material on a 1 mm
 * grid and get area-weighted normals; flat vertices keep the normal they are given.
 */
import { MATERIAL_ORDER, type MaterialName } from './materials';

export type Vec3 = [number, number, number];

class Part {
  pos: number[] = [];
  nrm: number[] = [];
  idx: number[] = [];
  readonly weld = new Map<string, number>();
}

export interface PartArrays {
  material: MaterialName;
  position: Float32Array<ArrayBuffer>;
  normal: Float32Array<ArrayBuffer>;
  index: Uint32Array<ArrayBuffer>;
}

export class TileMesh {
  private readonly parts = new Map<MaterialName, Part>();

  constructor(readonly ox: number, readonly oz: number) {}

  private part(m: MaterialName): Part {
    let p = this.parts.get(m);
    if (!p) {
      p = new Part();
      this.parts.set(m, p);
    }
    return p;
  }

  /** Welded vertex (normal accumulated from the faces that use it). */
  private smoothVertex(p: Part, v: Vec3): number {
    const x = v[0] - this.ox;
    const z = v[2] - this.oz;
    const key = `${Math.round(x * 1000)},${Math.round(v[1] * 1000)},${Math.round(z * 1000)}`;
    let i = p.weld.get(key);
    if (i === undefined) {
      i = p.pos.length / 3;
      p.pos.push(x, v[1], z);
      p.nrm.push(0, 0, 0);
      p.weld.set(key, i);
    }
    return i;
  }

  private flatVertex(p: Part, v: Vec3, n: Vec3): number {
    const i = p.pos.length / 3;
    p.pos.push(v[0] - this.ox, v[1], v[2] - this.oz);
    p.nrm.push(n[0], n[1], n[2]);
    return i;
  }

  /** Convex polygon facing up (+Y), welded and smooth-shaded (ground). */
  groundPolygon(m: MaterialName, pts: readonly Vec3[]): void {
    if (pts.length < 3) {
      return;
    }
    const p = this.part(m);
    const ids = pts.map((v) => this.smoothVertex(p, v));
    for (let k = 1; k + 1 < pts.length; k++) {
      this.smoothTri(p, ids[0], ids[k], ids[k + 1], true);
    }
  }

  private smoothTri(p: Part, a: number, b: number, c: number, up: boolean): void {
    if (a === b || b === c || a === c) {
      return;
    }
    const P = p.pos;
    const ux = P[b * 3] - P[a * 3];
    const uy = P[b * 3 + 1] - P[a * 3 + 1];
    const uz = P[b * 3 + 2] - P[a * 3 + 2];
    const vx = P[c * 3] - P[a * 3];
    const vy = P[c * 3 + 1] - P[a * 3 + 1];
    const vz = P[c * 3 + 2] - P[a * 3 + 2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    if (Math.hypot(nx, ny, nz) < 1e-9) {
      return;
    }
    if (up && ny < 0) {
      [b, c] = [c, b];
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    for (const i of [a, b, c]) {
      p.nrm[i * 3] += nx;
      p.nrm[i * 3 + 1] += ny;
      p.nrm[i * 3 + 2] += nz;
    }
    p.idx.push(a, b, c);
  }

  /** Planar convex polygon with a flat normal; the winding is fixed so the front face matches `n`. */
  flatPolygon(m: MaterialName, pts: readonly Vec3[], n: Vec3): void {
    if (pts.length < 3) {
      return;
    }
    const p = this.part(m);
    const ids = pts.map((v) => this.flatVertex(p, v, n));
    for (let k = 1; k + 1 < pts.length; k++) {
      this.flatTri(p, ids[0], ids[k], ids[k + 1], n);
    }
  }

  /** Triangles of a triangulated planar shape (index triples into `pts`) with a flat normal. */
  flatTriangles(m: MaterialName, pts: readonly Vec3[], tris: readonly number[], n: Vec3): void {
    const p = this.part(m);
    const ids = pts.map((v) => this.flatVertex(p, v, n));
    for (let k = 0; k < tris.length; k += 3) {
      this.flatTri(p, ids[tris[k]], ids[tris[k + 1]], ids[tris[k + 2]], n);
    }
  }

  private flatTri(p: Part, a: number, b: number, c: number, n: Vec3): void {
    const P = p.pos;
    const ux = P[b * 3] - P[a * 3];
    const uy = P[b * 3 + 1] - P[a * 3 + 1];
    const uz = P[b * 3 + 2] - P[a * 3 + 2];
    const vx = P[c * 3] - P[a * 3];
    const vy = P[c * 3 + 1] - P[a * 3 + 1];
    const vz = P[c * 3 + 2] - P[a * 3 + 2];
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    const d = cx * n[0] + cy * n[1] + cz * n[2];
    if (Math.abs(d) < 1e-10) {
      return;
    }
    if (d < 0) {
      p.idx.push(a, c, b);
    } else {
      p.idx.push(a, b, c);
    }
  }

  /** Vertical quad between a bottom edge (a, b) and heights (top at a, b); normal horizontal `n`. */
  wall(m: MaterialName, ax: number, az: number, bx: number, bz: number, ya0: number, ya1: number, yb0: number, yb1: number, n: Vec3): void {
    if (ya1 - ya0 < 0.005 && yb1 - yb0 < 0.005) {
      return;
    }
    this.flatPolygon(
      m,
      [
        [ax, ya0, az],
        [bx, yb0, bz],
        [bx, yb1, bz],
        [ax, ya1, az],
      ],
      n,
    );
  }

  triangles(): number {
    let t = 0;
    for (const p of this.parts.values()) {
      t += p.idx.length / 3;
    }
    return t;
  }

  /** Finished primitives in MATERIAL_ORDER (normals normalised). */
  take(): PartArrays[] {
    const out: PartArrays[] = [];
    for (const m of MATERIAL_ORDER) {
      const p = this.parts.get(m);
      if (!p || !p.idx.length) {
        continue;
      }
      const normal = new Float32Array(p.nrm);
      for (let i = 0; i < normal.length; i += 3) {
        const l = Math.hypot(normal[i], normal[i + 1], normal[i + 2]);
        if (l > 1e-12) {
          normal[i] /= l;
          normal[i + 1] /= l;
          normal[i + 2] /= l;
        } else {
          normal[i + 1] = 1;
        }
      }
      out.push({ material: m, position: new Float32Array(p.pos), normal, index: new Uint32Array(p.idx) });
    }
    return out;
  }
}
