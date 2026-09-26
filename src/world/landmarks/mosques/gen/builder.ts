import { Light, Mat, type GeomData, type LightId, type LocalCollider, type MatId, type RGB, type V3 } from './types';

/** Surface state captured into every emitted vertex. */
export interface SurfaceState {
  mat: MatId;
  /** sRGB albedo tint 0..1 (glass: r = window seed, g = glazing kind). */
  color: RGB;
  ao: number;
  light: LightId;
  /** Building-space y the uplight originates from. */
  lightBase: number;
  /** Building-space y of the downlight above (minaret balconies). */
  lightTop: number;
  extra: number;
}

const TAU = Math.PI * 2;

/**
 * Accumulates indexed geometry with an affine transform stack (rotation + uniform scale + translation).
 * All primitives take coordinates in the current local frame; uv are meters unless noted.
 */
export class MeshBuilder {
  private pos: Float32Array;
  private nrm: Float32Array;
  private uvs: Float32Array;
  private tint: Uint8Array;
  private dat: Uint16Array;
  private idx: Uint32Array;
  vCount = 0;
  iCount = 0;

  s: SurfaceState = { mat: Mat.Stone, color: [0.8, 0.75, 0.66], ao: 1, light: Light.Facade, lightBase: 0, lightTop: 0, extra: 0 };
  private stateStack: SurfaceState[] = [];
  /** Row-major 3x4 affine. */
  private m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
  private mStack: number[][] = [];

  constructor(initialVertices = 4096) {
    this.pos = new Float32Array(initialVertices * 3);
    this.nrm = new Float32Array(initialVertices * 3);
    this.uvs = new Float32Array(initialVertices * 2);
    this.tint = new Uint8Array(initialVertices * 4);
    this.dat = new Uint16Array(initialVertices * 4);
    this.idx = new Uint32Array(initialVertices * 3);
  }

  /* ------------------------------ state ------------------------------ */

  with(patch: Partial<SurfaceState>, fn: () => void): void {
    this.stateStack.push(this.s);
    this.s = { ...this.s, ...patch };
    fn();
    this.s = this.stateStack.pop()!;
  }

  set(patch: Partial<SurfaceState>): void {
    this.s = { ...this.s, ...patch };
  }

  push(): void {
    this.mStack.push(this.m.slice());
  }

  pop(): void {
    this.m = this.mStack.pop()!;
  }

  /** Runs fn inside a pushed transform. */
  at(x: number, y: number, z: number, yaw: number, fn: () => void): void {
    this.push();
    this.translate(x, y, z);
    if (yaw !== 0) {
      this.rotateY(yaw);
    }
    fn();
    this.pop();
  }

  translate(x: number, y: number, z: number): void {
    const m = this.m;
    m[3] += m[0] * x + m[1] * y + m[2] * z;
    m[7] += m[4] * x + m[5] * y + m[6] * z;
    m[11] += m[8] * x + m[9] * y + m[10] * z;
  }

  private mulRot(r00: number, r01: number, r02: number, r10: number, r11: number, r12: number, r20: number, r21: number, r22: number): void {
    const m = this.m;
    for (let row = 0; row < 3; row++) {
      const o = row * 4;
      const a = m[o];
      const b = m[o + 1];
      const c = m[o + 2];
      m[o] = a * r00 + b * r10 + c * r20;
      m[o + 1] = a * r01 + b * r11 + c * r21;
      m[o + 2] = a * r02 + b * r12 + c * r22;
    }
  }

  rotateY(a: number): void {
    const c = Math.cos(a);
    const s = Math.sin(a);
    this.mulRot(c, 0, s, 0, 1, 0, -s, 0, c);
  }

  rotateX(a: number): void {
    const c = Math.cos(a);
    const s = Math.sin(a);
    this.mulRot(1, 0, 0, 0, c, -s, 0, s, c);
  }

  rotateZ(a: number): void {
    const c = Math.cos(a);
    const s = Math.sin(a);
    this.mulRot(c, -s, 0, s, c, 0, 0, 0, 1);
  }

  scale(k: number): void {
    this.mulRot(k, 0, 0, 0, k, 0, 0, 0, k);
  }

  /* ------------------------------ colliders ------------------------------ */

  /**
   * Colliders registered by the parts that emit geometry (domes, drums, arcades, walls), in building space. Parts
   * register the same colliders at every LOD, so the set does not depend on which level was built first.
   */
  readonly colliders: LocalCollider[] = [];

  /** Building-space point of a local point. */
  worldPoint(x: number, y: number, z: number): V3 {
    const m = this.m;
    return [m[0] * x + m[1] * y + m[2] * z + m[3], m[4] * x + m[5] * y + m[6] * z + m[7], m[8] * x + m[9] * y + m[10] * z + m[11]];
  }

  /** Uniform scale of the current transform. */
  private worldScale(): number {
    const m = this.m;
    return Math.hypot(m[0], m[4], m[8]);
  }

  /** Local axis-aligned box [x0..x1] x [y0..y1] x [z0..z1] as a building-space collider (the frame only yaws). */
  colBox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, open = false): void {
    const k = this.worldScale();
    const [cx, cy, cz] = this.worldPoint((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    const m = this.m;
    // rotateY(a) maps local +X to (cos a, -sin a) in x/z, the Object3D.rotation.y convention of box colliders
    const yaw = Math.atan2(-m[8], m[0]);
    const c: LocalCollider = { kind: 'box', cx, cy, cz, hx: (Math.abs(x1 - x0) / 2) * k, hy: (Math.abs(y1 - y0) / 2) * k, hz: (Math.abs(z1 - z0) / 2) * k, yaw };
    if (open) {
      c.open = true;
    }
    this.colliders.push(c);
  }

  /** Vertical cylinder standing at local (x, y, z). */
  colCylinder(x: number, y: number, z: number, r: number, h: number): void {
    const k = this.worldScale();
    const [wx, wy, wz] = this.worldPoint(x, y, z);
    this.colliders.push({ kind: 'cylinder', x: wx, y: wy, z: wz, r: r * k, h: h * k });
  }

  colSphere(x: number, y: number, z: number, r: number): void {
    const k = this.worldScale();
    const [wx, wy, wz] = this.worldPoint(x, y, z);
    this.colliders.push({ kind: 'sphere', x: wx, y: wy, z: wz, r: r * k });
  }

  /** Building-space y of a local point (for light bases). */
  worldY(x: number, y: number, z: number): number {
    const m = this.m;
    return m[4] * x + m[5] * y + m[6] * z + m[7];
  }

  /* ------------------------------ storage ------------------------------ */

  private growV(extra: number): void {
    const need = this.vCount + extra;
    let cap = this.pos.length / 3;
    if (need <= cap) {
      return;
    }
    while (cap < need) {
      cap *= 2;
    }
    const grow = <T extends Float32Array | Uint8Array | Uint16Array>(a: T, n: number): T => {
      const b = new (a.constructor as new (len: number) => T)(cap * n);
      b.set(a);
      return b;
    };
    this.pos = grow(this.pos, 3);
    this.nrm = grow(this.nrm, 3);
    this.uvs = grow(this.uvs, 2);
    this.tint = grow(this.tint, 4);
    this.dat = grow(this.dat, 4);
  }

  private growI(extra: number): void {
    const need = this.iCount + extra;
    let cap = this.idx.length;
    if (need <= cap) {
      return;
    }
    while (cap < need) {
      cap *= 2;
    }
    const b = new Uint32Array(cap);
    b.set(this.idx);
    this.idx = b;
  }

  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number): number {
    this.growV(1);
    const m = this.m;
    const i = this.vCount++;
    const wx = m[0] * x + m[1] * y + m[2] * z + m[3];
    const wy = m[4] * x + m[5] * y + m[6] * z + m[7];
    const wz = m[8] * x + m[9] * y + m[10] * z + m[11];
    let tx = m[0] * nx + m[1] * ny + m[2] * nz;
    let ty = m[4] * nx + m[5] * ny + m[6] * nz;
    let tz = m[8] * nx + m[9] * ny + m[10] * nz;
    const nl = Math.hypot(tx, ty, tz) || 1;
    tx /= nl;
    ty /= nl;
    tz /= nl;
    const p = i * 3;
    this.pos[p] = wx;
    this.pos[p + 1] = wy;
    this.pos[p + 2] = wz;
    this.nrm[p] = tx;
    this.nrm[p + 1] = ty;
    this.nrm[p + 2] = tz;
    this.uvs[i * 2] = u;
    this.uvs[i * 2 + 1] = v;
    const s = this.s;
    const t = i * 4;
    this.tint[t] = clamp255(s.color[0] * 255);
    this.tint[t + 1] = clamp255(s.color[1] * 255);
    this.tint[t + 2] = clamp255(s.color[2] * 255);
    this.tint[t + 3] = clamp255(s.ao * 255);
    const hAbove = Math.min(Math.max(wy - s.lightBase, 0), 6553);
    const dBelow = Math.min(Math.max(s.lightTop - wy, 0), 409.5);
    this.dat[t] = s.mat;
    this.dat[t + 1] = Math.round(hAbove * 10);
    this.dat[t + 2] = s.light * 4096 + Math.round(dBelow * 10);
    this.dat[t + 3] = s.extra & 0xffff;
    return i;
  }

  tri(a: number, b: number, c: number): void {
    this.growI(3);
    const i = this.iCount;
    this.idx[i] = a;
    this.idx[i + 1] = b;
    this.idx[i + 2] = c;
    this.iCount += 3;
  }

  quadIdx(a: number, b: number, c: number, d: number): void {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }

  /* ------------------------------ primitives ------------------------------ */

  /** Planar quad p0..p3 counter-clockwise seen from the front. Explicit uv or automatic (see autoUV). */
  quad(p0: V3, p1: V3, p2: V3, p3: V3, uv?: readonly number[]): void {
    const n = faceNormal(p0, p1, p3);
    const pts = [p0, p1, p2, p3];
    const base = this.vCount;
    for (let k = 0; k < 4; k++) {
      const p = pts[k];
      let u: number;
      let v: number;
      if (uv) {
        u = uv[k * 2];
        v = uv[k * 2 + 1];
      } else {
        [u, v] = autoUV(p, n);
      }
      this.vertex(p[0], p[1], p[2], n[0], n[1], n[2], u, v);
    }
    this.quadIdx(base, base + 1, base + 2, base + 3);
  }

  /** Convex planar polygon (fan). Points counter-clockwise seen from the front. */
  poly(pts: V3[], uvFn?: (p: V3) => [number, number]): void {
    if (pts.length < 3) {
      return;
    }
    const n = faceNormal(pts[0], pts[1], pts[pts.length - 1]);
    const base = this.vCount;
    for (const p of pts) {
      const [u, v] = uvFn ? uvFn(p) : autoUV(p, n);
      this.vertex(p[0], p[1], p[2], n[0], n[1], n[2], u, v);
    }
    for (let k = 1; k < pts.length - 1; k++) {
      this.tri(base, base + k, base + k + 1);
    }
  }

  /** Axis-aligned box. `skip` letters omit faces: t(op) b(ottom) n(-z) s(+z) e(+x) w(-x). */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, skip = 'b'): void {
    if (!skip.includes('s')) {
      this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [x0, y0, x1, y0, x1, y1, x0, y1]);
    }
    if (!skip.includes('n')) {
      this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [-x1, y0, -x0, y0, -x0, y1, -x1, y1]);
    }
    if (!skip.includes('e')) {
      this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [-z1, y0, -z0, y0, -z0, y1, -z1, y1]);
    }
    if (!skip.includes('w')) {
      this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [z0, y0, z1, y0, z1, y1, z0, y1]);
    }
    if (!skip.includes('t')) {
      this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [x0, z1, x1, z1, x1, z0, x0, z0]);
    }
    if (!skip.includes('b')) {
      this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]);
    }
  }

  /**
   * Surface of revolution around local +Y. `profile` = [r0, y0, r1, y1, ...] walked so the visible side is on the
   * right (bottom -> top along an outer surface). Point = (r sin a, y, r cos a).
   */
  lathe(profile: readonly number[], opt: LatheOptions): void {
    const seg = Math.max(3, opt.seg | 0);
    const a0 = (opt.a0 ?? 0) + (opt.phase ?? 0);
    const a1 = (opt.a1 ?? TAU) + (opt.phase ?? 0);
    const P = profile.length / 2;
    if (P < 2) {
      return;
    }
    const creaseCos = Math.cos(((opt.crease ?? 38) * Math.PI) / 180);
    // segment normals in (r, y)
    const snr: number[] = [];
    const sny: number[] = [];
    const len: number[] = [];
    for (let k = 0; k < P - 1; k++) {
      const dr = profile[(k + 1) * 2] - profile[k * 2];
      const dy = profile[(k + 1) * 2 + 1] - profile[k * 2 + 1];
      const l = Math.hypot(dr, dy);
      len.push(l);
      snr.push(l > 1e-9 ? dy / l : 0);
      sny.push(l > 1e-9 ? -dr / l : 1);
    }
    const vAt: number[] = [opt.vOffset ?? 0];
    for (let k = 0; k < P - 1; k++) {
      vAt.push(vAt[k] + len[k]);
    }
    const sheets = opt.sheets ?? 24;
    const uOf = (a: number, r: number): number => (opt.uvMode === 'sheets' ? ((a - a0) / TAU) * sheets : a * Math.max(r, 0.05));

    if (opt.facets) {
      for (let k = 0; k < P - 1; k++) {
        if (len[k] < 1e-6) {
          continue;
        }
        const r0 = profile[k * 2];
        const y0 = profile[k * 2 + 1];
        const r1 = profile[(k + 1) * 2];
        const y1 = profile[(k + 1) * 2 + 1];
        for (let j = 0; j < seg; j++) {
          const t0 = a0 + ((a1 - a0) * j) / seg;
          const t1 = a0 + ((a1 - a0) * (j + 1)) / seg;
          const pa: V3 = [r0 * Math.sin(t0), y0, r0 * Math.cos(t0)];
          const pb: V3 = [r0 * Math.sin(t1), y0, r0 * Math.cos(t1)];
          const pc: V3 = [r1 * Math.sin(t1), y1, r1 * Math.cos(t1)];
          const pd: V3 = [r1 * Math.sin(t0), y1, r1 * Math.cos(t0)];
          const tm = (t0 + t1) * 0.5;
          const n: V3 = [snr[k] * Math.sin(tm), sny[k], snr[k] * Math.cos(tm)];
          const side0 = Math.max(r0, r1) * Math.abs(t1 - t0);
          const uBase = j * side0;
          const b = this.vCount;
          this.vertex(pa[0], pa[1], pa[2], n[0], n[1], n[2], opt.uvMode === 'sheets' ? uOf(t0, r0) : uBase, vAt[k]);
          this.vertex(pb[0], pb[1], pb[2], n[0], n[1], n[2], opt.uvMode === 'sheets' ? uOf(t1, r0) : uBase + side0, vAt[k]);
          this.vertex(pc[0], pc[1], pc[2], n[0], n[1], n[2], opt.uvMode === 'sheets' ? uOf(t1, r1) : uBase + side0, vAt[k + 1]);
          this.vertex(pd[0], pd[1], pd[2], n[0], n[1], n[2], opt.uvMode === 'sheets' ? uOf(t0, r1) : uBase, vAt[k + 1]);
          this.quadIdx(b, b + 1, b + 2, b + 3);
        }
      }
      return;
    }

    // Smooth: share rings at soft profile vertices, split at creases.
    const ringOf = (i: number, nr: number, ny: number): number => {
      const r = profile[i * 2];
      const y = profile[i * 2 + 1];
      const base = this.vCount;
      for (let j = 0; j <= seg; j++) {
        const a = a0 + ((a1 - a0) * j) / seg;
        const sa = Math.sin(a);
        const ca = Math.cos(a);
        this.vertex(r * sa, y, r * ca, nr * sa, ny, nr * ca, uOf(a, r), vAt[i]);
      }
      return base;
    };
    const bottomRing: number[] = [];
    const topRing: number[] = [];
    for (let i = 0; i < P; i++) {
      const prev = i > 0 && len[i - 1] > 1e-9 ? i - 1 : -1;
      const next = i < P - 1 && len[i] > 1e-9 ? i : -1;
      if (prev >= 0 && next >= 0) {
        const dot = snr[prev] * snr[next] + sny[prev] * sny[next];
        if (dot >= creaseCos) {
          const nr = snr[prev] + snr[next];
          const ny = sny[prev] + sny[next];
          const l = Math.hypot(nr, ny) || 1;
          const r = ringOf(i, nr / l, ny / l);
          topRing[prev] = r;
          bottomRing[next] = r;
        } else {
          topRing[prev] = ringOf(i, snr[prev], sny[prev]);
          bottomRing[next] = ringOf(i, snr[next], sny[next]);
        }
      } else if (prev >= 0) {
        topRing[prev] = ringOf(i, snr[prev], sny[prev]);
      } else if (next >= 0) {
        bottomRing[next] = ringOf(i, snr[next], sny[next]);
      }
    }
    for (let k = 0; k < P - 1; k++) {
      if (len[k] <= 1e-9) {
        continue;
      }
      const A = bottomRing[k];
      const B = topRing[k];
      for (let j = 0; j < seg; j++) {
        this.quadIdx(A + j, A + j + 1, B + j + 1, B + j);
      }
    }
  }

  /** Horizontal disc (facing up if `up`, else down) at height y. */
  disc(r: number, y: number, seg: number, up = true, a0 = 0, a1 = TAU): void {
    const ny = up ? 1 : -1;
    const c = this.vertex(0, y, 0, 0, ny, 0, 0, 0);
    const base = this.vCount;
    for (let j = 0; j <= seg; j++) {
      const a = a0 + ((a1 - a0) * j) / seg;
      const x = r * Math.sin(a);
      const z = r * Math.cos(a);
      this.vertex(x, y, z, 0, ny, 0, x, z);
    }
    for (let j = 0; j < seg; j++) {
      if (up) {
        this.tri(c, base + j, base + j + 1);
      } else {
        this.tri(c, base + j + 1, base + j);
      }
    }
  }

  /**
   * Sweeps a profile [out, y, ...] (out = outward offset from the path) around a closed XZ polygon.
   * The path is normalised to counter-clockwise seen from above; walk the profile bottom -> top on the outer side.
   */
  sweep(path: readonly (readonly [number, number])[], profile: readonly number[]): void {
    const pts = orientCCW(path);
    const n = pts.length;
    const P = profile.length / 2;
    const en: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const l = Math.hypot(dx, dz) || 1;
      en.push([-dz / l, dx / l]);
    }
    const miter: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const n1 = en[(i + n - 1) % n];
      const n2 = en[i];
      let mx = n1[0] + n2[0];
      let mz = n1[1] + n2[1];
      const ml = Math.hypot(mx, mz) || 1;
      mx /= ml;
      mz /= ml;
      const k = 1 / Math.max(0.25, mx * n2[0] + mz * n2[1]);
      miter.push([mx * k, mz * k]);
    }
    let uAcc = 0;
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      const ma = miter[i];
      const mb = miter[(i + 1) % n];
      const edgeLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
      let vAcc = 0;
      for (let k = 0; k < P - 1; k++) {
        const o0 = profile[k * 2];
        const y0 = profile[k * 2 + 1];
        const o1 = profile[(k + 1) * 2];
        const y1 = profile[(k + 1) * 2 + 1];
        const sl = Math.hypot(o1 - o0, y1 - y0);
        if (sl < 1e-6) {
          continue;
        }
        const p0: V3 = [a[0] + ma[0] * o0, y0, a[1] + ma[1] * o0];
        const p1: V3 = [b[0] + mb[0] * o0, y0, b[1] + mb[1] * o0];
        const p2: V3 = [b[0] + mb[0] * o1, y1, b[1] + mb[1] * o1];
        const p3: V3 = [a[0] + ma[0] * o1, y1, a[1] + ma[1] * o1];
        this.quad(p0, p1, p2, p3, [uAcc, vAcc, uAcc + edgeLen, vAcc, uAcc + edgeLen, vAcc + sl, uAcc, vAcc + sl]);
        vAcc += sl;
      }
      uAcc += edgeLen;
    }
  }

  /* ------------------------------ output ------------------------------ */

  build(): Omit<GeomData, 'bounds'> {
    const v = this.vCount;
    const normal = new Int8Array(v * 4);
    for (let i = 0; i < v; i++) {
      normal[i * 4] = Math.round(this.nrm[i * 3] * 127);
      normal[i * 4 + 1] = Math.round(this.nrm[i * 3 + 1] * 127);
      normal[i * 4 + 2] = Math.round(this.nrm[i * 3 + 2] * 127);
    }
    return {
      position: this.pos.slice(0, v * 3),
      normal,
      uv: this.uvs.slice(0, v * 2),
      tint: this.tint.slice(0, v * 4),
      data: this.dat.slice(0, v * 4),
      index: this.idx.slice(0, this.iCount),
    };
  }
}

export interface LatheOptions {
  seg: number;
  a0?: number;
  a1?: number;
  phase?: number;
  /** Flat-shaded polygon (minaret shafts, turrets). */
  facets?: boolean;
  /** 'arc' = meters around (default); 'sheets' = u counts lead sheets around the full circle. */
  uvMode?: 'arc' | 'sheets';
  sheets?: number;
  /** Profile crease angle in degrees (default 38). */
  crease?: number;
  vOffset?: number;
}

function clamp255(x: number): number {
  return x < 0 ? 0 : x > 255 ? 255 : Math.round(x);
}

export function faceNormal(a: V3, b: V3, c: V3): V3 {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}

/** Vertical faces: u along the face, v = height. Flat faces: planar xz. */
export function autoUV(p: V3, n: V3): [number, number] {
  if (Math.abs(n[1]) < 0.7) {
    const tx = n[2];
    const tz = -n[0];
    const l = Math.hypot(tx, tz) || 1;
    return [(p[0] * tx + p[2] * tz) / l, p[1]];
  }
  return [p[0], p[2]];
}

function orientCCW(path: readonly (readonly [number, number])[]): (readonly [number, number])[] {
  let area = 0;
  for (let i = 0; i < path.length; i++) {
    const a = path[i];
    const b = path[(i + 1) % path.length];
    area += a[0] * -b[1] - b[0] * -a[1];
  }
  return area >= 0 ? path.slice() : path.slice().reverse();
}
