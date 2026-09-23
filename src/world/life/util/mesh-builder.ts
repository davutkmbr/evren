import * as THREE from 'three';

/** Emissive classes (aSurf.w) understood by the life material. */
export const Emit = {
  None: 0,
  /** Passenger cabin window: warm, almost always lit at night. */
  Cabin: 1,
  /** Crew accommodation / wheelhouse window: sparsely lit, cooler. */
  Crew: 2,
  /** Deck floodlight / lamp fixture: bright, bloom. */
  Lamp: 3,
  /** Illuminated sign (pier name board). */
  Sign: 4,
} as const;

/** Surface detail patterns (aDetail) evaluated in the fragment shader. */
export const Detail = {
  Paint: 0,
  /** Steel hull plating: plate seams, rust streaks, waterline grime. */
  Hull: 1,
  /** Corrugated container walls. */
  Container: 2,
  /** Steel/wood deck: plank or plate lines, grime. */
  Deck: 3,
  /** Painted superstructure: soft streaks under windows. */
  Super: 4,
  /** Wooden planked hull (small fishing boats). */
  Wood: 5,
  /** Glass: mullions, slight tint variation. */
  Glass: 6,
  /** Rope/net/fabric. */
  Fabric: 7,
} as const;

export interface SurfaceSpec {
  /** Linear albedo. */
  color: THREE.Color;
  /** 0 = baked color, 1 = per-instance hull paint (BatchedMesh color). */
  paint?: number;
  roughness?: number;
  metalness?: number;
  emit?: number;
  detail?: number;
}

const tmpV = new THREE.Vector3();
const tmpN = new THREE.Vector3();
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpC = new THREE.Vector3();

/** sRGB hex -> linear Color. */
export function srgb(hex: number): THREE.Color {
  return new THREE.Color().setHex(hex);
}

export function surf(hex: number | THREE.Color, opts: Omit<SurfaceSpec, 'color'> = {}): SurfaceSpec {
  return { color: typeof hex === 'number' ? srgb(hex) : hex, ...opts };
}

/**
 * Accumulates indexed triangles with the attribute layout shared by every life mesh
 * (position, normal, color, aSurf = [paint, roughness, metalness, emissive class], aDetail).
 * Primitives are emitted through an optional transform stack.
 */
export class MeshBuilder {
  private pos: number[] = [];
  private nrm: number[] = [];
  private col: number[] = [];
  private srf: number[] = [];
  private det: number[] = [];
  private idx: number[] = [];
  private stack: THREE.Matrix4[] = [new THREE.Matrix4()];
  private normalStack: THREE.Matrix3[] = [new THREE.Matrix3()];
  private identity = true;

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  get matrix(): THREE.Matrix4 {
    return this.stack[this.stack.length - 1];
  }

  push(m: THREE.Matrix4): this {
    const next = this.matrix.clone().multiply(m);
    this.stack.push(next);
    this.normalStack.push(new THREE.Matrix3().getNormalMatrix(next));
    this.identity = false;
    return this;
  }

  pushTRS(x: number, y: number, z: number, rotY = 0, rotX = 0, rotZ = 0, scale = 1): this {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rotX, rotY, rotZ, 'YXZ')),
      new THREE.Vector3(scale, scale, scale),
    );
    return this.push(m);
  }

  pop(): this {
    if (this.stack.length > 1) {
      this.stack.pop();
      this.normalStack.pop();
    }
    this.identity = this.stack.length === 1;
    return this;
  }

  /** Adds a vertex (local coords, transformed by the current matrix). Returns its index. */
  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, s: SurfaceSpec): number {
    if (this.identity) {
      tmpV.set(x, y, z);
      tmpN.set(nx, ny, nz).normalize();
    } else {
      tmpV.set(x, y, z).applyMatrix4(this.matrix);
      tmpN.set(nx, ny, nz).applyMatrix3(this.normalStack[this.normalStack.length - 1]).normalize();
    }
    this.pos.push(tmpV.x, tmpV.y, tmpV.z);
    this.nrm.push(tmpN.x, tmpN.y, tmpN.z);
    this.col.push(s.color.r, s.color.g, s.color.b);
    this.srf.push(s.paint ?? 0, s.roughness ?? 0.6, s.metalness ?? 0, s.emit ?? 0);
    this.det.push(s.detail ?? 0);
    return this.pos.length / 3 - 1;
  }

  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }

  /** Quad from 4 local points (counter-clockwise seen from the front); flat normal. */
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, s: SurfaceSpec): void {
    tmpA.subVectors(b, a);
    tmpB.subVectors(d, a);
    tmpC.crossVectors(tmpA, tmpB).normalize();
    const nx = tmpC.x;
    const ny = tmpC.y;
    const nz = tmpC.z;
    const i0 = this.vertex(a.x, a.y, a.z, nx, ny, nz, s);
    const i1 = this.vertex(b.x, b.y, b.z, nx, ny, nz, s);
    const i2 = this.vertex(c.x, c.y, c.z, nx, ny, nz, s);
    const i3 = this.vertex(d.x, d.y, d.z, nx, ny, nz, s);
    this.idx.push(i0, i1, i2, i0, i2, i3);
  }

  quadXYZ(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, dx: number, dy: number, dz: number, s: SurfaceSpec): void {
    const e1x = bx - ax;
    const e1y = by - ay;
    const e1z = bz - az;
    const e2x = dx - ax;
    const e2y = dy - ay;
    const e2z = dz - az;
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    const i0 = this.vertex(ax, ay, az, nx, ny, nz, s);
    const i1 = this.vertex(bx, by, bz, nx, ny, nz, s);
    const i2 = this.vertex(cx, cy, cz, nx, ny, nz, s);
    const i3 = this.vertex(dx, dy, dz, nx, ny, nz, s);
    this.idx.push(i0, i1, i2, i0, i2, i3);
  }

  /**
   * Axis-aligned box centred at (cx, cy, cz). `faces` bitmask: 1 +X, 2 -X, 4 +Y, 8 -Y, 16 +Z, 32 -Z.
   * `sides` optionally overrides the surface of individual faces (same bit order).
   */
  box(cx: number, cy: number, cz: number, w: number, h: number, d: number, s: SurfaceSpec, faces = 63, sides?: Partial<Record<number, SurfaceSpec>>): void {
    const x0 = cx - w / 2;
    const x1 = cx + w / 2;
    const y0 = cy - h / 2;
    const y1 = cy + h / 2;
    const z0 = cz - d / 2;
    const z1 = cz + d / 2;
    const f = (bit: number): SurfaceSpec => sides?.[bit] ?? s;
    if (faces & 1) this.quadXYZ(x1, y0, z1, x1, y0, z0, x1, y1, z0, x1, y1, z1, f(1));
    if (faces & 2) this.quadXYZ(x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0, f(2));
    if (faces & 4) this.quadXYZ(x0, y1, z1, x1, y1, z1, x1, y1, z0, x0, y1, z0, f(4));
    if (faces & 8) this.quadXYZ(x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1, f(8));
    if (faces & 16) this.quadXYZ(x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1, f(16));
    if (faces & 32) this.quadXYZ(x1, y0, z0, x0, y0, z0, x0, y1, z0, x1, y1, z0, f(32));
  }

  /** Box resting on y = y0 (bottom face omitted by default). */
  block(cx: number, y0: number, cz: number, w: number, h: number, d: number, s: SurfaceSpec, faces = 63 & ~8, sides?: Partial<Record<number, SurfaceSpec>>): void {
    this.box(cx, y0 + h / 2, cz, w, h, d, s, faces, sides);
  }

  /** Vertical cylinder (or frustum) standing on y0 with `seg` sides; optional caps. */
  cylinder(cx: number, y0: number, cz: number, r0: number, r1: number, h: number, seg: number, s: SurfaceSpec, capTop = true, capBottom = false, sx = 1, sz = 1): void {
    const base = this.vertexCount;
    const slope = (r0 - r1) / h;
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const c = Math.cos(a);
      const si = Math.sin(a);
      const nl = Math.hypot(1, slope);
      this.vertex(cx + c * r0 * sx, y0, cz + si * r0 * sz, (c / sx) / nl, slope / nl, (si / sz) / nl, s);
      this.vertex(cx + c * r1 * sx, y0 + h, cz + si * r1 * sz, (c / sx) / nl, slope / nl, (si / sz) / nl, s);
    }
    for (let i = 0; i < seg; i++) {
      const a = base + i * 2;
      this.idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
    if (capTop && r1 > 0) {
      const center = this.vertex(cx, y0 + h, cz, 0, 1, 0, s);
      const ring = this.vertexCount;
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        this.vertex(cx + Math.cos(a) * r1 * sx, y0 + h, cz + Math.sin(a) * r1 * sz, 0, 1, 0, s);
      }
      for (let i = 0; i < seg; i++) {
        this.idx.push(center, ring + i + 1, ring + i);
      }
    }
    if (capBottom && r0 > 0) {
      const center = this.vertex(cx, y0, cz, 0, -1, 0, s);
      const ring = this.vertexCount;
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        this.vertex(cx + Math.cos(a) * r0 * sx, y0, cz + Math.sin(a) * r0 * sz, 0, -1, 0, s);
      }
      for (let i = 0; i < seg; i++) {
        this.idx.push(center, ring + i, ring + i + 1);
      }
    }
  }

  /** Cylinder between two arbitrary points (pipes, booms, masts). */
  tube(a: THREE.Vector3, b: THREE.Vector3, r: number, seg: number, s: SurfaceSpec, caps = false): void {
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    if (len < 1e-6) return;
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    const m = new THREE.Matrix4().compose(a, q, new THREE.Vector3(1, 1, 1));
    this.push(m);
    this.cylinder(0, 0, 0, r, r, len, seg, s, caps, caps);
    this.pop();
  }

  /** Sphere-ish (low poly) centred ellipsoid. */
  ellipsoid(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, seg: number, rings: number, s: SurfaceSpec): void {
    const base = this.vertexCount;
    for (let j = 0; j <= rings; j++) {
      const v = j / rings;
      const phi = v * Math.PI;
      for (let i = 0; i <= seg; i++) {
        const u = i / seg;
        const th = u * Math.PI * 2;
        const nx = Math.sin(phi) * Math.cos(th);
        const ny = Math.cos(phi);
        const nz = Math.sin(phi) * Math.sin(th);
        this.vertex(cx + nx * rx, cy + ny * ry, cz + nz * rz, nx / rx, ny / ry, nz / rz, s);
      }
    }
    for (let j = 0; j < rings; j++) {
      for (let i = 0; i < seg; i++) {
        const a = base + j * (seg + 1) + i;
        const b = a + seg + 1;
        this.idx.push(a, a + 1, b + 1, a, b + 1, b);
      }
    }
  }

  /** Extruded 2D profile (in the XY plane, counter-clockwise) along Z from z0 to z1, with caps. */
  extrudeXY(profile: ReadonlyArray<readonly [number, number]>, z0: number, z1: number, s: SurfaceSpec, caps = true, capSurf?: SurfaceSpec): void {
    const n = profile.length;
    for (let i = 0; i < n; i++) {
      const [ax, ay] = profile[i];
      const [bx, by] = profile[(i + 1) % n];
      this.quadXYZ(ax, ay, z1, bx, by, z1, bx, by, z0, ax, ay, z0, s);
    }
    if (caps) {
      const cs = capSurf ?? s;
      const shape = profile.map(([x, y]) => new THREE.Vector2(x, y));
      const tris = THREE.ShapeUtils.triangulateShape(shape, []);
      const front = this.vertexCount;
      for (const [x, y] of profile) this.vertex(x, y, z1, 0, 0, 1, cs);
      const back = this.vertexCount;
      for (const [x, y] of profile) this.vertex(x, y, z0, 0, 0, -1, cs);
      for (const [a, b, c] of tris) {
        this.idx.push(front + a, front + b, front + c);
        this.idx.push(back + a, back + c, back + b);
      }
    }
  }

  /**
   * Torus around the local X axis (ring in the YZ plane) centred at (cx, cy, cz): ring radius R, tube radius r.
   * Used for life rings and tyre fenders hung on a side (rotate with push for other orientations).
   */
  torus(cx: number, cy: number, cz: number, R: number, r: number, segU: number, segV: number, s: SurfaceSpec): void {
    const base = this.vertexCount;
    for (let i = 0; i <= segU; i++) {
      const u = (i / segU) * Math.PI * 2;
      const cu = Math.cos(u);
      const su = Math.sin(u);
      for (let j = 0; j <= segV; j++) {
        const v = (j / segV) * Math.PI * 2;
        const cv = Math.cos(v);
        const sv = Math.sin(v);
        this.vertex(cx + r * sv, cy + (R + r * cv) * cu, cz + (R + r * cv) * su, sv, cv * cu, cv * su, s);
      }
    }
    const w = segV + 1;
    for (let i = 0; i < segU; i++) {
      for (let j = 0; j < segV; j++) {
        const a = base + i * w + j;
        const b = a + w;
        this.idx.push(a, b, b + 1, a, b + 1, a + 1);
      }
    }
  }

  /** Quad whose winding is chosen so its face normal agrees with `facing`. */
  quadFacing(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, facing: THREE.Vector3, s: SurfaceSpec): void {
    tmpA.subVectors(b, a);
    tmpB.subVectors(d, a);
    tmpC.crossVectors(tmpA, tmpB);
    if (tmpC.dot(facing) >= 0) this.quad(a, b, c, d, s);
    else this.quad(d, c, b, a, s);
  }

  /** Extruded 2D profile in the ZY plane (side view: [z, y] pairs) from x0 to x1, with caps. */
  extrudeZY(profile: ReadonlyArray<readonly [number, number]>, x0: number, x1: number, s: SurfaceSpec, caps = true, capSurf?: SurfaceSpec): void {
    const n = profile.length;
    let area = 0;
    for (let i = 0; i < n; i++) {
      const [za, ya] = profile[i];
      const [zb, yb] = profile[(i + 1) % n];
      area += za * yb - zb * ya;
    }
    const sign = area >= 0 ? 1 : -1;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const d = new THREE.Vector3();
    const out = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const [za, ya] = profile[i];
      const [zb, yb] = profile[(i + 1) % n];
      out.set(0, -(zb - za) * sign, (yb - ya) * sign);
      a.set(x0, ya, za);
      b.set(x0, yb, zb);
      c.set(x1, yb, zb);
      d.set(x1, ya, za);
      this.quadFacing(a, b, c, d, out, s);
    }
    if (caps) {
      const cs = capSurf ?? s;
      const shape = profile.map(([z, y]) => new THREE.Vector2(z, y));
      const tris = THREE.ShapeUtils.triangulateShape(shape, []);
      for (const [side, x] of [[1, x1], [-1, x0]] as const) {
        const base = this.vertexCount;
        for (const [z, y] of profile) this.vertex(x, y, z, side, 0, 0, cs);
        for (const [i0, i1, i2] of tris) {
          const [z0, y0] = profile[i0];
          const [z1, y1] = profile[i1];
          const [z2, y2] = profile[i2];
          // Face normal x-component of (p1 - p0) x (p2 - p0) with p = (x, y, z).
          const nx = (y1 - y0) * (z2 - z0) - (z1 - z0) * (y2 - y0);
          if (nx * side >= 0) this.idx.push(base + i0, base + i1, base + i2);
          else this.idx.push(base + i0, base + i2, base + i1);
        }
      }
    }
  }

  /** Grid of window quads on a plane: origin at lower-left, u axis and v axis in local coords, facing normal n. */
  windowRow(origin: THREE.Vector3, uDir: THREE.Vector3, n: THREE.Vector3, count: number, pitch: number, w: number, h: number, s: SurfaceSpec, inset = 0.03): void {
    const up = new THREE.Vector3().crossVectors(n, uDir).normalize();
    // Ensure `up` points +Y-ish for vertical walls.
    if (up.y < 0) up.negate();
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const d = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      a.copy(origin).addScaledVector(uDir, i * pitch).addScaledVector(n, inset);
      b.copy(a).addScaledVector(uDir, w);
      c.copy(b).addScaledVector(up, h);
      d.copy(a).addScaledVector(up, h);
      // Orient CCW as seen from the normal side.
      tmpA.subVectors(b, a);
      tmpB.subVectors(d, a);
      tmpC.crossVectors(tmpA, tmpB);
      if (tmpC.dot(n) >= 0) this.quad(a, b, c, d, s);
      else this.quad(b, a, d, c, s);
    }
  }

  /** Appends raw arrays (already in final coordinates). */
  appendGeometry(g: THREE.BufferGeometry, s: SurfaceSpec): void {
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    const base = this.vertexCount;
    for (let i = 0; i < p.count; i++) {
      this.vertex(p.getX(i), p.getY(i), p.getZ(i), n.getX(i), n.getY(i), n.getZ(i), s);
    }
    const index = g.getIndex();
    if (index) {
      for (let i = 0; i < index.count; i++) this.idx.push(base + index.getX(i));
    } else {
      for (let i = 0; i < p.count; i++) this.idx.push(base + i);
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aSurf', new THREE.Float32BufferAttribute(this.srf, 4));
    g.setAttribute('aDetail', new THREE.Float32BufferAttribute(this.det, 1));
    const count = this.pos.length / 3;
    g.setIndex(count > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}
