/**
 * Procedural mesh accumulator used by every structure builder (runs inside the worker).
 * All geometry is emitted in world space. Triangles are auto-oriented so that their winding agrees with the
 * vertex normals (builders only have to get normals right). UVs are in meters (see types.ts GeometryData).
 */
import * as THREE from 'three';
import type { GeometryData } from '../types';
import type { Rgb } from './surfaces';

class FloatBuffer {
  data: Float32Array;
  length = 0;
  constructor(capacity: number) {
    this.data = new Float32Array(capacity);
  }
  reserve(extra: number): void {
    if (this.length + extra <= this.data.length) {
      return;
    }
    let cap = this.data.length * 2;
    while (cap < this.length + extra) {
      cap *= 2;
    }
    const next = new Float32Array(cap);
    next.set(this.data.subarray(0, this.length));
    this.data = next;
  }
  trimmed(): Float32Array {
    return this.data.slice(0, this.length);
  }
}

class IndexBuffer {
  data: Uint32Array;
  length = 0;
  constructor(capacity: number) {
    this.data = new Uint32Array(capacity);
  }
  push3(a: number, b: number, c: number): void {
    if (this.length + 3 > this.data.length) {
      const next = new Uint32Array(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    this.data[this.length++] = a;
    this.data[this.length++] = b;
    this.data[this.length++] = c;
  }
  trimmed(): Uint32Array {
    return this.data.slice(0, this.length);
  }
}

export interface SurfaceState {
  color: Rgb;
  surf: number;
  rough: number;
  metal: number;
  param: number;
  emit: number;
  ea: number;
  eb: number;
  ec: number;
}

export interface ProfilePoint {
  r: number;
  y: number;
  /** Duplicate the ring here so the normals break (cornices, ledges). */
  crease?: boolean;
}

export interface LoftOptions {
  /** Rings are closed loops (tubes, prisms). Default true. */
  closed?: boolean;
  /** Smooth normals around each ring (curved surfaces). Default false: one normal per face. */
  smooth?: boolean;
  /** Corner angle (deg) above which a smooth ring still gets a hard edge. */
  hardAngleDeg?: number;
  capStart?: boolean;
  capEnd?: boolean;
  /** v coordinate: 'y' = height above builder vBase (walls), 'length' = distance along the loft. */
  vMode?: 'y' | 'length';
  /** u offset added to the ring arc length. */
  u0?: number;
  /** Orient face normals away from the loft axis (default: true for closed rings). */
  outward?: boolean;
}

export interface SweepFrame {
  p: THREE.Vector3;
  /** Unit right (profile x) and up (profile y) axes. */
  right: THREE.Vector3;
  up: THREE.Vector3;
  /** Distance along the path (v coordinate). */
  s: number;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _n = new THREE.Vector3();
const _m3 = new THREE.Matrix3();
const UP = new THREE.Vector3(0, 1, 0);

export class MeshBuilder {
  private pos = new FloatBuffer(3 * 4096);
  private nrm = new FloatBuffer(3 * 4096);
  private uvs = new FloatBuffer(2 * 4096);
  private col = new FloatBuffer(3 * 4096);
  private srf = new FloatBuffer(4 * 4096);
  private emt = new FloatBuffer(4 * 4096);
  private idx = new IndexBuffer(3 * 8192);
  private state: SurfaceState = {
    color: [0.5, 0.5, 0.5],
    surf: 6,
    rough: 0.7,
    metal: 0,
    param: 0,
    emit: 0,
    ea: 0,
    eb: 0,
    ec: 0,
  };
  private matrix: THREE.Matrix4 | null = null;
  private normalMatrix = new THREE.Matrix3();
  private stack: Array<THREE.Matrix4 | null> = [];
  /** World height subtracted from y for wall v coordinates. */
  vBase = 0;

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  get triangleCount(): number {
    return this.idx.length / 3;
  }

  /** Merges fields into the current surface state (applies to subsequent vertices). */
  surface(s: Partial<SurfaceState>): this {
    Object.assign(this.state, s);
    return this;
  }

  getSurface(): SurfaceState {
    return { ...this.state };
  }

  pushTransform(m: THREE.Matrix4): this {
    this.stack.push(this.matrix);
    this.matrix = this.matrix ? this.matrix.clone().multiply(m) : m.clone();
    this.normalMatrix.getNormalMatrix(this.matrix);
    return this;
  }

  popTransform(): this {
    this.matrix = this.stack.pop() ?? null;
    if (this.matrix) {
      this.normalMatrix.getNormalMatrix(this.matrix);
    }
    return this;
  }

  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number): number {
    const i = this.vertexCount;
    if (this.matrix) {
      _a.set(x, y, z).applyMatrix4(this.matrix);
      _n.set(nx, ny, nz).applyMatrix3(this.normalMatrix).normalize();
      x = _a.x;
      y = _a.y;
      z = _a.z;
      nx = _n.x;
      ny = _n.y;
      nz = _n.z;
    }
    this.pos.reserve(3);
    this.nrm.reserve(3);
    this.uvs.reserve(2);
    this.col.reserve(3);
    this.srf.reserve(4);
    this.emt.reserve(4);
    const s = this.state;
    let o = this.pos.length;
    this.pos.data[o] = x;
    this.pos.data[o + 1] = y;
    this.pos.data[o + 2] = z;
    this.pos.length += 3;
    o = this.nrm.length;
    this.nrm.data[o] = nx;
    this.nrm.data[o + 1] = ny;
    this.nrm.data[o + 2] = nz;
    this.nrm.length += 3;
    o = this.uvs.length;
    this.uvs.data[o] = u;
    this.uvs.data[o + 1] = v;
    this.uvs.length += 2;
    o = this.col.length;
    this.col.data[o] = s.color[0];
    this.col.data[o + 1] = s.color[1];
    this.col.data[o + 2] = s.color[2];
    this.col.length += 3;
    o = this.srf.length;
    this.srf.data[o] = s.surf;
    this.srf.data[o + 1] = s.rough;
    this.srf.data[o + 2] = s.metal;
    this.srf.data[o + 3] = s.param;
    this.srf.length += 4;
    o = this.emt.length;
    this.emt.data[o] = s.emit;
    this.emt.data[o + 1] = s.ea;
    this.emt.data[o + 2] = s.eb;
    this.emt.data[o + 3] = s.ec;
    this.emt.length += 4;
    return i;
  }

  /** Vertex from vectors. */
  vtx(p: THREE.Vector3, n: THREE.Vector3, u: number, v: number): number {
    return this.vertex(p.x, p.y, p.z, n.x, n.y, n.z, u, v);
  }

  /** Triangle, winding chosen to agree with the vertex normals. Degenerate triangles are dropped. */
  tri(a: number, b: number, c: number): void {
    const P = this.pos.data;
    const N = this.nrm.data;
    const ax = P[a * 3];
    const ay = P[a * 3 + 1];
    const az = P[a * 3 + 2];
    const e1x = P[b * 3] - ax;
    const e1y = P[b * 3 + 1] - ay;
    const e1z = P[b * 3 + 2] - az;
    const e2x = P[c * 3] - ax;
    const e2y = P[c * 3 + 1] - ay;
    const e2z = P[c * 3 + 2] - az;
    const gx = e1y * e2z - e1z * e2y;
    const gy = e1z * e2x - e1x * e2z;
    const gz = e1x * e2y - e1y * e2x;
    const area2 = gx * gx + gy * gy + gz * gz;
    if (area2 < 1e-12) {
      return;
    }
    const nx = N[a * 3] + N[b * 3] + N[c * 3];
    const ny = N[a * 3 + 1] + N[b * 3 + 1] + N[c * 3 + 1];
    const nz = N[a * 3 + 2] + N[b * 3 + 2] + N[c * 3 + 2];
    if (gx * nx + gy * ny + gz * nz >= 0) {
      this.idx.push3(a, b, c);
    } else {
      this.idx.push3(a, c, b);
    }
  }

  /** Quad a-b-c-d (in order around the perimeter). */
  quad(a: number, b: number, c: number, d: number): void {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }

  /** Planar polygon whose normal is oriented away from `inside` (closed solids: roofs, pyramids, prisms). */
  polygonOutward(points: readonly THREE.Vector3[], inside: THREE.Vector3): void {
    const nrm = newellNormal(points, new THREE.Vector3());
    const c = new THREE.Vector3();
    for (const p of points) {
      c.add(p);
    }
    c.multiplyScalar(1 / points.length).sub(inside);
    if (nrm.dot(c) < 0) {
      nrm.negate();
    }
    this.polygon(points, nrm);
  }

  /**
   * Flat planar polygon (convex or concave, no holes) with one normal. `uvFn` maps a point to uv; default projects
   * onto the face's own axes (u along the first edge) in meters.
   */
  polygon(points: readonly THREE.Vector3[], normal?: THREE.Vector3, uvFn?: (p: THREE.Vector3) => [number, number]): void {
    const n = points.length;
    if (n < 3) {
      return;
    }
    const nrm = normal ? _n.copy(normal) : newellNormal(points, _n);
    const ax = _b.subVectors(points[1], points[0]).normalize();
    if (Math.abs(ax.dot(nrm)) > 0.99) {
      ax.set(1, 0, 0);
    }
    const ay = _c.crossVectors(nrm, ax).normalize();
    ax.crossVectors(ay, nrm).normalize();
    const flat = points.map((p) => new THREE.Vector2(p.dot(ax), p.dot(ay)));
    const horizontal = Math.abs(nrm.y) > 0.95;
    const base = this.vertexCount;
    const nx = nrm.x;
    const ny = nrm.y;
    const nz = nrm.z;
    for (let i = 0; i < n; i++) {
      const p = points[i];
      let u: number;
      let v: number;
      if (uvFn) {
        [u, v] = uvFn(p);
      } else if (horizontal) {
        u = p.x;
        v = p.z;
      } else {
        u = flat[i].x - flat[0].x;
        v = p.y - this.vBase;
      }
      this.vertex(p.x, p.y, p.z, nx, ny, nz, u, v);
    }
    if (n === 3) {
      this.tri(base, base + 1, base + 2);
      return;
    }
    if (n === 4 && isConvex2(flat)) {
      this.quad(base, base + 1, base + 2, base + 3);
      return;
    }
    const tris = THREE.ShapeUtils.triangulateShape(flat, []);
    for (const t of tris) {
      this.tri(base + t[0], base + t[1], base + t[2]);
    }
  }

  /**
   * Axis-aligned box rotated by `yaw` around +Y (same convention as Object3D.rotation.y), centred at (cx, cy, cz).
   * Side uv: u runs continuously around the perimeter, v = y - vBase. Top/bottom uv = world xz.
   */
  box(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, yaw = 0, skipBottom = true, skipTop = false): void {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    // local (x, z) -> world: x' = x c + z s, z' = -x s + z c (rotation.y convention)
    const corner = (lx: number, lz: number): [number, number] => [cx + lx * c + lz * s, cz - lx * s + lz * c];
    const ring: Array<[number, number]> = [corner(hx, -hz), corner(hx, hz), corner(-hx, hz), corner(-hx, -hz)];
    const y0 = cy - hy;
    const y1 = cy + hy;
    this.prismRing(ring, y0, y1, 0, !skipBottom, !skipTop);
  }

  /**
   * Vertical prism from a ring of (x, z) points (any orientation), flat faces. Caps optional.
   */
  prismRing(ring: ReadonlyArray<readonly [number, number]>, y0: number, y1: number, u0 = 0, capBottom = false, capTop = true): void {
    const pts = orientRing(ring);
    const n = pts.length;
    let u = u0;
    for (let i = 0; i < n; i++) {
      const [x0, z0] = pts[i];
      const [x1, z1] = pts[(i + 1) % n];
      const len = Math.hypot(x1 - x0, z1 - z0);
      if (len < 1e-6) {
        continue;
      }
      // outward normal = up x tangent
      const nx = (z1 - z0) / len;
      const nz = -(x1 - x0) / len;
      const onx = -nx;
      const onz = -nz;
      const a = this.vertex(x0, y0, z0, onx, 0, onz, u, y0 - this.vBase);
      const b = this.vertex(x1, y0, z1, onx, 0, onz, u + len, y0 - this.vBase);
      const c = this.vertex(x1, y1, z1, onx, 0, onz, u + len, y1 - this.vBase);
      const d = this.vertex(x0, y1, z0, onx, 0, onz, u, y1 - this.vBase);
      this.quad(a, b, c, d);
      u += len;
    }
    if (capTop) {
      this.polygon(
        pts.map(([x, z]) => new THREE.Vector3(x, y1, z)),
        UP,
      );
    }
    if (capBottom) {
      this.polygon(
        pts.map(([x, z]) => new THREE.Vector3(x, y0, z)),
        new THREE.Vector3(0, -1, 0),
      );
    }
  }

  /**
   * Loft through rings of equal length. Rings should wind with increasing angle around their axis
   * (p = (cos t, sin t) in x/z for vertical lofts); normals are derived geometrically either way.
   */
  loft(rings: readonly (readonly THREE.Vector3[])[], opts: LoftOptions = {}): void {
    const closed = opts.closed ?? true;
    const smooth = opts.smooth ?? false;
    const vMode = opts.vMode ?? 'y';
    const outward = opts.outward ?? closed;
    const nr = rings.length;
    const np = rings[0].length;
    if (nr < 2 || np < 2) {
      return;
    }
    const segs = closed ? np : np - 1;
    const cosHard = Math.cos(((opts.hardAngleDeg ?? 50) * Math.PI) / 180);
    const along: number[] = [0];
    for (let r = 1; r < nr; r++) {
      along.push(along[r - 1] + ringDistance(rings[r - 1], rings[r]));
    }
    const vOf = (r: number, p: THREE.Vector3): number => (vMode === 'y' ? p.y - this.vBase : along[r]);
    const centroid = rings.map((ring) => ringCentroid(ring));
    const fn: THREE.Vector3[][] = [];
    for (let r = 0; r < nr - 1; r++) {
      const A = rings[r];
      const B = rings[r + 1];
      const row: THREE.Vector3[] = [];
      for (let j = 0; j < segs; j++) {
        const j1 = (j + 1) % np;
        _a.subVectors(A[j1], A[j]).add(_c.subVectors(B[j1], B[j]));
        _b.subVectors(B[j], A[j]).add(_c.subVectors(B[j1], A[j1]));
        const out = new THREE.Vector3().crossVectors(_b, _a);
        if (out.lengthSq() < 1e-14) {
          out.subVectors(A[j], centroid[r]);
        }
        if (outward) {
          _c.addVectors(A[j], A[j1]).add(B[j]).add(B[j1]).multiplyScalar(0.25);
          _b.addVectors(centroid[r], centroid[r + 1]).multiplyScalar(0.5);
          if (out.dot(_c.sub(_b)) < 0) {
            out.negate();
          }
        }
        row.push(out.normalize());
      }
      fn.push(row);
    }
    const corner = new THREE.Vector3();
    const cornerNormal = (fr: number, fc: number, r: number, j: number): THREE.Vector3 => {
      const own = fn[fr][fc];
      corner.copy(own);
      if (!smooth) {
        return corner;
      }
      let oc = j === fc ? fc - 1 : fc + 1;
      if (closed) {
        oc = (oc + segs) % segs;
      }
      const colOk = oc >= 0 && oc < segs && own.dot(fn[fr][oc]) > cosHard;
      if (colOk) {
        corner.add(fn[fr][oc]);
      }
      const or = r === fr ? fr - 1 : fr + 1;
      if (or >= 0 && or < nr - 1 && own.dot(fn[or][fc]) > cosHard) {
        corner.add(fn[or][fc]);
        if (colOk && own.dot(fn[or][oc]) > cosHard) {
          corner.add(fn[or][oc]);
        }
      }
      return corner.normalize();
    };
    const uArc = (ring: readonly THREE.Vector3[]): number[] => {
      const out = [opts.u0 ?? 0];
      for (let j = 1; j <= segs; j++) {
        out.push(out[j - 1] + ring[j % np].distanceTo(ring[j - 1]));
      }
      return out;
    };
    for (let r = 0; r < nr - 1; r++) {
      const A = rings[r];
      const B = rings[r + 1];
      const uA = uArc(A);
      const uB = uArc(B);
      for (let j = 0; j < segs; j++) {
        const j1 = (j + 1) % np;
        const a = this.vtx(A[j], cornerNormal(r, j, r, j), uA[j], vOf(r, A[j]));
        const b = this.vtx(A[j1], cornerNormal(r, j, r, j + 1), uA[j + 1], vOf(r, A[j1]));
        const c = this.vtx(B[j1], cornerNormal(r, j, r + 1, j + 1), uB[j + 1], vOf(r + 1, B[j1]));
        const d = this.vtx(B[j], cornerNormal(r, j, r + 1, j), uB[j], vOf(r + 1, B[j]));
        this.quad(a, b, c, d);
      }
    }
    if (opts.capStart) {
      this.polygon(rings[0], newellNormal(rings[0], new THREE.Vector3()).multiplyScalar(dirSign(rings[0], rings[1])));
    }
    if (opts.capEnd) {
      this.polygon(rings[nr - 1], newellNormal(rings[nr - 1], new THREE.Vector3()).multiplyScalar(dirSign(rings[nr - 1], rings[nr - 2])));
    }
  }

  /**
   * Surface of revolution around the vertical axis through (cx, cz). Smooth around the axis; profile points flagged
   * `crease` break the normals. sx/sz scale the ring into an ellipse. u = arc length at the ring, v = y - vBase.
   */
  lathe(
    profile: readonly ProfilePoint[],
    segments: number,
    opts: { cx?: number; cz?: number; sx?: number; sz?: number; phase?: number; capTop?: boolean; capBottom?: boolean; arc?: number } = {},
  ): void {
    const cx = opts.cx ?? 0;
    const cz = opts.cz ?? 0;
    const sx = opts.sx ?? 1;
    const sz = opts.sz ?? 1;
    const phase = opts.phase ?? 0;
    const arc = opts.arc ?? Math.PI * 2;
    const full = arc >= Math.PI * 2 - 1e-6;
    const cols = full ? segments + 1 : segments + 1;
    // Split the profile into smooth runs at creases.
    const runs: ProfilePoint[][] = [];
    let cur: ProfilePoint[] = [];
    for (let i = 0; i < profile.length; i++) {
      cur.push(profile[i]);
      if (profile[i].crease && i > 0 && i < profile.length - 1) {
        runs.push(cur);
        cur = [profile[i]];
      }
    }
    runs.push(cur);
    const cosT: number[] = [];
    const sinT: number[] = [];
    for (let k = 0; k < cols; k++) {
      const t = phase + (k / segments) * arc;
      cosT.push(Math.cos(t));
      sinT.push(Math.sin(t));
    }
    for (const run of runs) {
      if (run.length < 2) {
        continue;
      }
      const base = this.vertexCount;
      for (let i = 0; i < run.length; i++) {
        const p = run[i];
        // profile tangent (dr, dy) -> 2D normal (dy, -dr)
        const prev = run[Math.max(i - 1, 0)];
        const next = run[Math.min(i + 1, run.length - 1)];
        let dr = next.r - prev.r;
        let dy = next.y - prev.y;
        const l = Math.hypot(dr, dy) || 1;
        dr /= l;
        dy /= l;
        const nr = dy;
        const ny = -dr;
        for (let k = 0; k < cols; k++) {
          const x = cx + p.r * cosT[k] * sx;
          const z = cz + p.r * sinT[k] * sz;
          // ellipse normal: scale the radial part by the inverse axis scales
          let nx = (nr * cosT[k]) / sx;
          let nz = (nr * sinT[k]) / sz;
          const nl = Math.hypot(nx, ny, nz) || 1;
          nx /= nl;
          nz /= nl;
          const u = p.r * Math.sqrt(sx * sz) * (k / segments) * arc;
          this.vertex(x, p.y, z, nx, ny / nl, nz, u, p.y - this.vBase);
        }
      }
      for (let i = 0; i < run.length - 1; i++) {
        for (let k = 0; k < segments; k++) {
          const a = base + i * cols + k;
          const b = a + 1;
          const c = b + cols;
          const d = a + cols;
          this.quad(a, b, c, d);
        }
      }
    }
    if (opts.capTop) {
      const p = profile[profile.length - 1];
      if (p.r > 1e-3) {
        this.disc(cx, p.y, cz, p.r * sx, p.r * sz, segments, 1, phase);
      }
    }
    if (opts.capBottom) {
      const p = profile[0];
      if (p.r > 1e-3) {
        this.disc(cx, p.y, cz, p.r * sx, p.r * sz, segments, -1, phase);
      }
    }
  }

  /** Horizontal elliptic disc facing up (dir = 1) or down (dir = -1). */
  disc(cx: number, y: number, cz: number, rx: number, rz: number, segments: number, dir: 1 | -1, phase = 0): void {
    const center = this.vertex(cx, y, cz, 0, dir, 0, cx, cz);
    const first = this.vertexCount;
    for (let k = 0; k <= segments; k++) {
      const t = phase + (k / segments) * Math.PI * 2;
      const x = cx + Math.cos(t) * rx;
      const z = cz + Math.sin(t) * rz;
      this.vertex(x, y, z, 0, dir, 0, x, z);
    }
    for (let k = 0; k < segments; k++) {
      this.tri(center, first + k, first + k + 1);
    }
  }

  /** Vertical (optionally tapered) cylinder / frustum standing on (x, y, z). */
  cylinder(x: number, y: number, z: number, r0: number, r1: number, h: number, segments: number, capTop = true, capBottom = false): void {
    this.lathe(
      [
        { r: r0, y },
        { r: r1, y: y + h },
      ],
      segments,
      { cx: x, cz: z, capTop, capBottom },
    );
  }

  /** Tube (circular cross-section) along a polyline. */
  tube(path: readonly THREE.Vector3[], radius: number, sides: number, radiusEnd = radius): void {
    const rings: THREE.Vector3[][] = [];
    const n = path.length;
    const t = new THREE.Vector3();
    const side = new THREE.Vector3();
    const up = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      t.subVectors(path[Math.min(i + 1, n - 1)], path[Math.max(i - 1, 0)]).normalize();
      const ref = Math.abs(t.y) > 0.9 ? _a.set(1, 0, 0) : _a.set(0, 1, 0);
      side.crossVectors(t, ref).normalize();
      up.crossVectors(side, t).normalize();
      const r = radius + ((radiusEnd - radius) * i) / Math.max(n - 1, 1);
      const ring: THREE.Vector3[] = [];
      for (let k = 0; k < sides; k++) {
        const a = (k / sides) * Math.PI * 2;
        ring.push(path[i].clone().addScaledVector(side, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r));
      }
      rings.push(ring);
    }
    this.loft(rings, { closed: true, smooth: true, vMode: 'length', hardAngleDeg: 80 });
  }

  /**
   * Sweeps an open or closed 2D profile (x = right, y = up) along frames. Each profile edge becomes a flat strip;
   * u = arc length along the profile, v = frame.s.
   */
  sweep(profile: ReadonlyArray<readonly [number, number]>, frames: readonly SweepFrame[], closed = false, uStart = 0): void {
    const np = profile.length;
    const edges = closed ? np : np - 1;
    let u = uStart;
    const p0 = new THREE.Vector3();
    const p1 = new THREE.Vector3();
    const p2 = new THREE.Vector3();
    const p3 = new THREE.Vector3();
    const n = new THREE.Vector3();
    for (let e = 0; e < edges; e++) {
      const [ax, ay] = profile[e];
      const [bx, by] = profile[(e + 1) % np];
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 1e-6) {
        continue;
      }
      // 2D edge normal: rotate the edge direction by -90° (profile wound so that outside is on the right when closed)
      const enx = (by - ay) / len;
      const eny = -(bx - ax) / len;
      for (let f = 0; f < frames.length - 1; f++) {
        const F0 = frames[f];
        const F1 = frames[f + 1];
        p0.copy(F0.p).addScaledVector(F0.right, ax).addScaledVector(F0.up, ay);
        p1.copy(F0.p).addScaledVector(F0.right, bx).addScaledVector(F0.up, by);
        p2.copy(F1.p).addScaledVector(F1.right, bx).addScaledVector(F1.up, by);
        p3.copy(F1.p).addScaledVector(F1.right, ax).addScaledVector(F1.up, ay);
        n.copy(F0.right).multiplyScalar(enx).addScaledVector(F0.up, eny).normalize();
        const a = this.vtx(p0, n, u, F0.s);
        const b = this.vtx(p1, n, u + len, F0.s);
        const c = this.vtx(p2, n, u + len, F1.s);
        const d = this.vtx(p3, n, u, F1.s);
        this.quad(a, b, c, d);
      }
      u += len;
    }
  }

  /**
   * Flat ribbon between two lateral offsets along frames (road surfaces): u = lateral offset (m, signed, right +),
   * v = frame.s. `lift` raises it along the frame up axis. `cuts`: extra lateral vertex columns (those strictly
   * between xLeft and xRight are used), e.g. where a deck end twists into an uneven ground.
   */
  ribbon(frames: readonly SweepFrame[], xLeft: number, xRight: number, lift = 0, cuts: readonly number[] = []): void {
    const lo = Math.min(xLeft, xRight);
    const hi = Math.max(xLeft, xRight);
    const inner = cuts.filter((x) => x > lo + 1e-3 && x < hi - 1e-3).sort((a, b) => a - b);
    const xs = xLeft <= xRight ? [xLeft, ...inner, xRight] : [xLeft, ...inner.reverse(), xRight];
    const p = new THREE.Vector3();
    let prev: number[] = [];
    for (let f = 0; f < frames.length; f++) {
      const F = frames[f];
      const row = xs.map((x) => {
        p.copy(F.p).addScaledVector(F.right, x).addScaledVector(F.up, lift);
        return this.vtx(p, F.up, x, F.s);
      });
      if (f > 0) {
        for (let k = 0; k < xs.length - 1; k++) {
          this.quad(prev[k], prev[k + 1], row[k + 1], row[k]);
        }
      }
      prev = row;
    }
  }

  /** Raises every vertex from index `from` on by dy(x, y, z) (normals kept: meant for small surface offsets). */
  displaceY(dy: (x: number, y: number, z: number) => number, from = 0): void {
    const P = this.pos.data;
    for (let i = from * 3; i < this.pos.length; i += 3) {
      P[i + 1] += dy(P[i], P[i + 1], P[i + 2]);
    }
  }

  /**
   * Moves every vertex from index `from` on horizontally: `move(x, y, z)` returns the distance along the unit
   * horizontal direction (dirX, dirZ) (normals kept: meant for small lateral warps).
   */
  displaceAlong(dirX: number, dirZ: number, move: (x: number, y: number, z: number) => number, from = 0): void {
    const P = this.pos.data;
    for (let i = from * 3; i < this.pos.length; i += 3) {
      const d = move(P[i], P[i + 1], P[i + 2]);
      P[i] += dirX * d;
      P[i + 2] += dirZ * d;
    }
  }

  isEmpty(): boolean {
    return this.idx.length === 0;
  }

  build(): GeometryData {
    const n = this.nrm.length;
    const normal = new Int16Array(n);
    const N = this.nrm.data;
    for (let i = 0; i < n; i++) {
      normal[i] = Math.round(Math.max(-1, Math.min(1, N[i])) * 32767);
    }
    const c = this.col.length;
    const color = new Uint8Array(c);
    const C = this.col.data;
    for (let i = 0; i < c; i++) {
      color[i] = Math.round(Math.max(0, Math.min(1, C[i])) * 255);
    }
    return {
      position: this.pos.trimmed(),
      normal,
      uv: this.uvs.trimmed(),
      color,
      surf: this.srf.trimmed(),
      emit: this.emt.trimmed(),
      index: this.idx.trimmed(),
    };
  }

  /** Bounding sphere of the emitted vertices. */
  bounds(): { center: [number, number, number]; radius: number } {
    const P = this.pos.data;
    const n = this.vertexCount;
    if (n === 0) {
      return { center: [0, 0, 0], radius: 0 };
    }
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = P[i * 3];
      const y = P[i * 3 + 1];
      const z = P[i * 3 + 2];
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      maxZ = Math.max(maxZ, z);
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const cz = (minZ + maxZ) / 2;
    let r2 = 0;
    for (let i = 0; i < n; i++) {
      const dx = P[i * 3] - cx;
      const dy = P[i * 3 + 1] - cy;
      const dz = P[i * 3 + 2] - cz;
      r2 = Math.max(r2, dx * dx + dy * dy + dz * dz);
    }
    return { center: [cx, cy, cz], radius: Math.sqrt(r2) };
  }
}

function newellNormal(points: readonly THREE.Vector3[], out: THREE.Vector3): THREE.Vector3 {
  out.set(0, 0, 0);
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    out.x += (a.y - b.y) * (a.z + b.z);
    out.y += (a.z - b.z) * (a.x + b.x);
    out.z += (a.x - b.x) * (a.y + b.y);
  }
  return out.normalize();
}

function isConvex2(p: THREE.Vector2[]): boolean {
  let sign = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = p[(i + 1) % p.length];
    const c = p[(i + 2) % p.length];
    const cr = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cr) < 1e-9) {
      continue;
    }
    const s = Math.sign(cr);
    if (sign === 0) {
      sign = s;
    } else if (s !== sign) {
      return false;
    }
  }
  return true;
}

/** Returns the ring wound with increasing angle in the x/z plane (positive signed area of x*z'). */
export function orientRing(ring: ReadonlyArray<readonly [number, number]>): Array<readonly [number, number]> {
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, z0] = ring[i];
    const [x1, z1] = ring[(i + 1) % ring.length];
    area += x0 * z1 - x1 * z0;
  }
  return area >= 0 ? [...ring] : [...ring].reverse();
}

function ringCentroid(ring: readonly THREE.Vector3[]): THREE.Vector3 {
  const c = new THREE.Vector3();
  for (const p of ring) {
    c.add(p);
  }
  return c.multiplyScalar(1 / ring.length);
}

function ringDistance(a: readonly THREE.Vector3[], b: readonly THREE.Vector3[]): number {
  return ringCentroid(a).distanceTo(ringCentroid(b));
}

/** +1 if ring `b` lies on the side the Newell normal of `a` points to... used to orient loft caps outward. */
function dirSign(a: readonly THREE.Vector3[], b: readonly THREE.Vector3[]): number {
  const n = newellNormal(a, new THREE.Vector3());
  const d = ringCentroid(a).sub(ringCentroid(b));
  return n.dot(d) >= 0 ? 1 : -1;
}

export { UP };
export const _tmpMatrix3 = _m3;
