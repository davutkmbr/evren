/** Growable writer for the city chunk vertex format (see protocol.ts) with quad/box/polygon helpers. */
import type { ChunkArrays } from '../protocol';

export interface PartState {
  rgb: number;
  kind: number;
  seed: number;
  floorH: number;
  gfH: number;
  style: number;
  /** Column spacing (m), 0 = blank facade. */
  sx: number;
  /** Face flags (aFacade.w). */
  flags: number;
}

export class MeshWriter {
  pos: Float32Array;
  nrm: Int8Array;
  fac: Int16Array;
  col: Uint8Array;
  par: Uint8Array;
  idx: Uint32Array;
  vcount = 0;
  icount = 0;
  /** Secondary index list for fine details (drawn last so shadow/reflection passes can skip them). */
  private idx2: Uint32Array;
  private icount2 = 0;
  /** When true, triangles go to the detail list. */
  detail = false;
  minX = Infinity;
  minY = Infinity;
  minZ = Infinity;
  maxX = -Infinity;
  maxY = -Infinity;
  maxZ = -Infinity;

  private r = 0;
  private g = 0;
  private b = 0;
  private kind = 0;
  private seed = 0;
  private floorDm = 30;
  private gfDm = 32;
  private style = 0;
  private sxCm = 0;
  private flags = 0;
  /** Fade class (see FadeClass) packed into the upper bits of the kind byte. */
  fadeClass = 0;

  constructor(
    readonly ox: number,
    readonly oz: number,
    capacity = 4096,
  ) {
    this.pos = new Float32Array(capacity * 3);
    this.nrm = new Int8Array(capacity * 4);
    this.fac = new Int16Array(capacity * 4);
    this.col = new Uint8Array(capacity * 4);
    this.par = new Uint8Array(capacity * 4);
    this.idx = new Uint32Array(capacity * 2);
    this.idx2 = new Uint32Array(capacity);
  }

  part(p: PartState): void {
    this.r = (p.rgb >> 16) & 255;
    this.g = (p.rgb >> 8) & 255;
    this.b = p.rgb & 255;
    this.kind = p.kind;
    this.seed = p.seed & 255;
    this.floorDm = Math.max(1, Math.min(255, Math.round(p.floorH * 10)));
    this.gfDm = Math.max(1, Math.min(255, Math.round(p.gfH * 10)));
    this.style = p.style & 255;
    this.sxCm = Math.max(0, Math.min(32767, Math.round(p.sx * 100)));
    this.flags = p.flags;
  }

  /** Override kind/colour/flags of the current part (keeps building constants). */
  setKind(kind: number, rgb?: number): void {
    this.kind = kind;
    if (rgb !== undefined) {
      this.r = (rgb >> 16) & 255;
      this.g = (rgb >> 8) & 255;
      this.b = rgb & 255;
    }
  }

  setFace(sx: number, flags: number): void {
    this.sxCm = Math.max(0, Math.min(32767, Math.round(sx * 100)));
    this.flags = flags;
  }

  private grow(nv: number, ni: number): void {
    if (this.vcount + nv > this.pos.length / 3) {
      const cap = Math.max((this.pos.length / 3) * 2, this.vcount + nv);
      this.pos = resize(this.pos, cap * 3);
      this.nrm = resize(this.nrm, cap * 4);
      this.fac = resize(this.fac, cap * 4);
      this.col = resize(this.col, cap * 4);
      this.par = resize(this.par, cap * 4);
    }
    if (this.icount + ni > this.idx.length) {
      this.idx = resize(this.idx, Math.max(this.idx.length * 2, this.icount + ni));
    }
    if (this.icount2 + ni > this.idx2.length) {
      this.idx2 = resize(this.idx2, Math.max(this.idx2.length * 2, this.icount2 + ni));
    }
  }

  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number): number {
    const i = this.vcount++;
    const lx = x - this.ox;
    const lz = z - this.oz;
    const p = i * 3;
    this.pos[p] = lx;
    this.pos[p + 1] = y;
    this.pos[p + 2] = lz;
    if (lx < this.minX) this.minX = lx;
    if (lx > this.maxX) this.maxX = lx;
    if (y < this.minY) this.minY = y;
    if (y > this.maxY) this.maxY = y;
    if (lz < this.minZ) this.minZ = lz;
    if (lz > this.maxZ) this.maxZ = lz;
    const q = i * 4;
    this.nrm[q] = Math.round(nx * 127);
    this.nrm[q + 1] = Math.round(ny * 127);
    this.nrm[q + 2] = Math.round(nz * 127);
    this.nrm[q + 3] = 0;
    this.fac[q] = clamp16(Math.round(u * 16));
    this.fac[q + 1] = clamp16(Math.round(v * 16));
    this.fac[q + 2] = this.sxCm;
    this.fac[q + 3] = this.flags;
    this.col[q] = this.r;
    this.col[q + 1] = this.g;
    this.col[q + 2] = this.b;
    this.col[q + 3] = this.kind | (this.fadeClass << 5);
    this.par[q] = this.seed;
    this.par[q + 1] = this.floorDm;
    this.par[q + 2] = this.gfDm;
    this.par[q + 3] = this.style;
    return i;
  }

  tri(a: number, b: number, c: number): void {
    if (this.detail) {
      this.idx2[this.icount2++] = a;
      this.idx2[this.icount2++] = b;
      this.idx2[this.icount2++] = c;
      return;
    }
    this.idx[this.icount++] = a;
    this.idx[this.icount++] = b;
    this.idx[this.icount++] = c;
  }

  reserve(nv: number, ni: number): void {
    this.grow(nv, ni);
  }

  /**
   * Planar quad p0..p3 (counter-clockwise seen from the side the normal points to). The normal is computed and
   * the winding is fixed automatically so callers may pass corners in either order.
   * uv per corner in facade metres (u along, v up).
   */
  quad(
    x0: number, y0: number, z0: number,
    x1: number, y1: number, z1: number,
    x2: number, y2: number, z2: number,
    x3: number, y3: number, z3: number,
    u0: number, v0: number, u1: number, v1: number, u2: number, v2: number, u3: number, v3: number,
    wantNx: number, wantNy: number, wantNz: number,
  ): void {
    this.grow(4, 6);
    const ax = x1 - x0;
    const ay = y1 - y0;
    const az = z1 - z0;
    const bx = x2 - x0;
    const by = y2 - y0;
    const bz = z2 - z0;
    let nx = ay * bz - az * by;
    let ny = az * bx - ax * bz;
    let nz = ax * by - ay * bx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    const flip = nx * wantNx + ny * wantNy + nz * wantNz < 0;
    if (flip) {
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    const a = this.vertex(x0, y0, z0, nx, ny, nz, u0, v0);
    const b = this.vertex(x1, y1, z1, nx, ny, nz, u1, v1);
    const c = this.vertex(x2, y2, z2, nx, ny, nz, u2, v2);
    const d = this.vertex(x3, y3, z3, nx, ny, nz, u3, v3);
    if (flip) {
      this.tri(a, c, b);
      this.tri(a, d, c);
    } else {
      this.tri(a, b, c);
      this.tri(a, c, d);
    }
  }

  triangle(
    x0: number, y0: number, z0: number,
    x1: number, y1: number, z1: number,
    x2: number, y2: number, z2: number,
    u0: number, v0: number, u1: number, v1: number, u2: number, v2: number,
    wantNx: number, wantNy: number, wantNz: number,
  ): void {
    this.grow(3, 3);
    let nx = (y1 - y0) * (z2 - z0) - (z1 - z0) * (y2 - y0);
    let ny = (z1 - z0) * (x2 - x0) - (x1 - x0) * (z2 - z0);
    let nz = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0);
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    const flip = nx * wantNx + ny * wantNy + nz * wantNz < 0;
    if (flip) {
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    const a = this.vertex(x0, y0, z0, nx, ny, nz, u0, v0);
    const b = this.vertex(x1, y1, z1, nx, ny, nz, u1, v1);
    const c = this.vertex(x2, y2, z2, nx, ny, nz, u2, v2);
    if (flip) {
      this.tri(a, c, b);
    } else {
      this.tri(a, b, c);
    }
  }

  /**
   * Vertical wall from (x0,z0) to (x1,z1) seen from outside left -> right (outward normal = (-dz, 0, dx)).
   * v is measured from `vBase` (floor-0 level), u starts at `u0`.
   */
  wall(x0: number, z0: number, x1: number, z1: number, yb: number, yt: number, vBase: number, u0: number): void {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    if (len < 1e-3 || yt - yb < 1e-3) {
      return;
    }
    this.quad(x0, yb, z0, x1, yb, z1, x1, yt, z1, x0, yt, z0, u0, yb - vBase, u0 + len, yb - vBase, u0 + len, yt - vBase, u0, yt - vBase, -dz, 0, dx);
  }

  /** Horizontal polygon (convex, up to 8 corners, flat arrays) facing up (dir = 1) or down (-1). */
  flat(xs: readonly number[], zs: readonly number[], y: number, dir: 1 | -1): void {
    const n = xs.length;
    this.grow(n, (n - 2) * 3);
    const ny = dir;
    const base = this.vcount;
    for (let i = 0; i < n; i++) {
      this.vertex(xs[i], y, zs[i], 0, ny, 0, 0, 0);
    }
    // Determine winding: signed area in x-z (positive = upward normal with loop order used by walls).
    let area = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      area += xs[i] * zs[j] - xs[j] * zs[i];
    }
    // For a loop whose triangles (0,i,i+1) produce +y normals, area (x*z' - x'*z) is negative.
    const up = area < 0;
    for (let i = 1; i < n - 1; i++) {
      if (up === (dir === 1)) {
        this.tri(base, base + i, base + i + 1);
      } else {
        this.tri(base, base + i + 1, base + i);
      }
    }
  }

  finish(): ChunkArrays | null {
    if (this.vcount === 0) {
      return null;
    }
    const n = this.vcount;
    const total = this.icount + this.icount2;
    const index = n <= 65535 ? new Uint16Array(total) : new Uint32Array(total);
    index.set(this.idx.subarray(0, this.icount));
    index.set(this.idx2.subarray(0, this.icount2), this.icount);
    return {
      position: this.pos.slice(0, n * 3),
      normal: this.nrm.slice(0, n * 4),
      facade: this.fac.slice(0, n * 4),
      color: this.col.slice(0, n * 4),
      params: this.par.slice(0, n * 4),
      index,
    };
  }
}

function clamp16(v: number): number {
  return v < -32767 ? -32767 : v > 32767 ? 32767 : v;
}

function resize<T extends Float32Array | Int8Array | Int16Array | Uint8Array | Uint32Array>(a: T, n: number): T {
  const out = new (a.constructor as new (n: number) => T)(n);
  out.set(a);
  return out;
}
