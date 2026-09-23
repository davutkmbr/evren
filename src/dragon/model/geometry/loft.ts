import * as THREE from 'three';
import { MeshBuilder, SkinAccumulator } from './buffers';
import { createFrame, PathSampler } from './path';

export type SectionFn = (s: number, theta: number, out: THREE.Vector2) => void;
export type SkinFn = (s: number, theta: number, position: THREE.Vector3, acc: SkinAccumulator) => void;
export type DataFn = (s: number, theta: number, position: THREE.Vector3, out: THREE.Vector4) => void;
export type ColorFn = (s: number, theta: number, position: THREE.Vector3, out: THREE.Color) => void;

export interface LoftSpec {
  path: PathSampler;
  /** Arc lengths of the rings (ascending). */
  rings: number[];
  /** Vertices around each ring. */
  segments: number;
  /** Section outline in the frame plane: x = right, y = up. theta: 0 = up, +PI/2 = right. */
  section: SectionFn;
  skin: SkinFn;
  data?: DataFn;
  color?: ColorFn;
  /** Texture mapping: u = theta / 2PI; v = integral ds / max(circumference, minCircumference) * vScale + vOffset. */
  minCircumference?: number;
  vScale?: number;
  vOffset?: number;
  /** Closes the ends with a fan to a point pushed out along the tangent by this distance (m). */
  capStart?: number;
  capEnd?: number;
}

const frame = createFrame();
const tmp2 = new THREE.Vector2();

/** Swept generalized cylinder with non-circular sections. Can be queried for surface points after building. */
export class Loft {
  constructor(readonly spec: LoftSpec) {}

  /** Surface point at (s, theta). */
  pointAt(s: number, theta: number, out: THREE.Vector3): THREE.Vector3 {
    const f = this.spec.path.frameAt(s, frame);
    this.spec.section(s, theta, tmp2);
    return out.copy(f.point).addScaledVector(f.right, tmp2.x).addScaledVector(f.up, tmp2.y);
  }

  /** Outward surface normal at (s, theta) by finite differences. */
  normalAt(s: number, theta: number, out: THREE.Vector3): THREE.Vector3 {
    const hs = 0.01;
    const ht = 0.01;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const d = new THREE.Vector3();
    this.pointAt(Math.max(s - hs, 0), theta, a);
    this.pointAt(Math.min(s + hs, this.spec.path.length), theta, b);
    this.pointAt(s, theta - ht, c);
    this.pointAt(s, theta + ht, d);
    b.sub(a);
    d.sub(c);
    return out.crossVectors(b, d).normalize();
  }

  /** Frame (center, tangent, up, right) at arc length s. */
  frameAt(s: number): { point: THREE.Vector3; tangent: THREE.Vector3; up: THREE.Vector3; right: THREE.Vector3 } {
    const f = this.spec.path.frameAt(s, createFrame());
    return f;
  }

  build(builder: MeshBuilder): void {
    const { rings, segments: M, path } = this.spec;
    const R = rings.length;
    const pos = new Float32Array(R * M * 3);
    const centers = new Float32Array(R * 3);
    const tangents = new Float32Array(R * 3);
    const p = new THREE.Vector3();
    for (let i = 0; i < R; i++) {
      const f = path.frameAt(rings[i], frame);
      centers[i * 3] = f.point.x;
      centers[i * 3 + 1] = f.point.y;
      centers[i * 3 + 2] = f.point.z;
      tangents[i * 3] = f.tangent.x;
      tangents[i * 3 + 1] = f.tangent.y;
      tangents[i * 3 + 2] = f.tangent.z;
      for (let j = 0; j < M; j++) {
        const theta = (j / M) * Math.PI * 2;
        this.spec.section(rings[i], theta, tmp2);
        p.copy(f.point).addScaledVector(f.right, tmp2.x).addScaledVector(f.up, tmp2.y);
        const o = (i * M + j) * 3;
        pos[o] = p.x;
        pos[o + 1] = p.y;
        pos[o + 2] = p.z;
      }
    }

    // Circumference-conformal v coordinate.
    const minC = this.spec.minCircumference ?? 0.5;
    const vScale = this.spec.vScale ?? 1;
    const vs = new Float32Array(R);
    const circ = new Float32Array(R);
    for (let i = 0; i < R; i++) {
      let c = 0;
      for (let j = 0; j < M; j++) {
        const a = (i * M + j) * 3;
        const b = (i * M + ((j + 1) % M)) * 3;
        c += Math.hypot(pos[a] - pos[b], pos[a + 1] - pos[b + 1], pos[a + 2] - pos[b + 2]);
      }
      circ[i] = Math.max(c, minC);
    }
    vs[0] = this.spec.vOffset ?? 0;
    for (let i = 1; i < R; i++) {
      const ds = rings[i] - rings[i - 1];
      vs[i] = vs[i - 1] + (ds / (0.5 * (circ[i] + circ[i - 1]))) * vScale;
    }

    const base = builder.vertexCount;
    const skin = new SkinAccumulator();
    const n = new THREE.Vector3();
    const dS = new THREE.Vector3();
    const dT = new THREE.Vector3();
    const tangent = new THREE.Vector4();
    const tvec = new THREE.Vector3();
    const uv = new THREE.Vector2();
    const color = new THREE.Color();
    const data = new THREE.Vector4();
    const tan = new THREE.Vector3();
    const get = (i: number, j: number, out: THREE.Vector3): THREE.Vector3 => {
      const jj = ((j % M) + M) % M;
      const o = (i * M + jj) * 3;
      return out.set(pos[o], pos[o + 1], pos[o + 2]);
    };
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();

    for (let i = 0; i < R; i++) {
      tan.set(tangents[i * 3], tangents[i * 3 + 1], tangents[i * 3 + 2]);
      for (let j = 0; j <= M; j++) {
        const theta = (j / M) * Math.PI * 2;
        get(i, j, p);
        const i0 = Math.max(i - 1, 0);
        const i1 = Math.min(i + 1, R - 1);
        get(i1, j, a);
        get(i0, j, b);
        dS.subVectors(a, b);
        get(i, j + 1, a);
        get(i, j - 1, b);
        dT.subVectors(a, b);
        n.crossVectors(dS, dT);
        if (n.lengthSq() < 1e-14) {
          n.copy(tan).multiplyScalar(i === 0 ? -1 : 1);
        }
        n.normalize();
        if (dT.lengthSq() < 1e-14) {
          dT.set(1, 0, 0);
        }
        tvec.copy(dT).addScaledVector(n, -dT.dot(n)).normalize();
        const w = a.crossVectors(n, tvec).dot(dS) < 0 ? -1 : 1;
        tangent.set(tvec.x, tvec.y, tvec.z, w);
        uv.set(j / M, vs[i]);
        skin.clear();
        this.spec.skin(rings[i], theta, p, skin);
        if (this.spec.color) {
          this.spec.color(rings[i], theta, p, color);
        } else {
          color.setRGB(1, 1, 1);
        }
        if (this.spec.data) {
          this.spec.data(rings[i], theta, p, data);
        } else {
          data.set(0, 0, 0, 0);
        }
        builder.addVertex({ position: p, normal: n, uv, tangent, color, skin, data });
      }
    }
    const W = M + 1;
    for (let i = 0; i < R - 1; i++) {
      for (let j = 0; j < M; j++) {
        const va = base + i * W + j;
        const vb = base + (i + 1) * W + j;
        const vc = base + i * W + j + 1;
        const vd = base + (i + 1) * W + j + 1;
        builder.addTriangle(va, vb, vc);
        builder.addTriangle(vb, vd, vc);
      }
    }

    const cap = (ringIndex: number, dir: number, ext: number): void => {
      const s = rings[ringIndex];
      const f = path.frameAt(s, frame);
      p.copy(f.point).addScaledVector(f.tangent, dir * ext);
      n.copy(f.tangent).multiplyScalar(dir);
      skin.clear();
      this.spec.skin(s, 0, p, skin);
      if (this.spec.color) {
        this.spec.color(s, 0, p, color);
      } else {
        color.setRGB(1, 1, 1);
      }
      if (this.spec.data) {
        this.spec.data(s, 0, p, data);
      } else {
        data.set(0, 0, 0, 0);
      }
      tangent.set(f.right.x, f.right.y, f.right.z, 1);
      uv.set(0.5, vs[ringIndex] + dir * 0.02);
      const c = builder.addVertex({ position: p, normal: n, uv, tangent, color, skin, data });
      for (let j = 0; j < M; j++) {
        const v0 = base + ringIndex * W + j;
        const v1 = base + ringIndex * W + j + 1;
        if (dir < 0) {
          builder.addTriangle(c, v0, v1);
        } else {
          builder.addTriangle(c, v1, v0);
        }
      }
    };
    if (this.spec.capStart !== undefined) {
      cap(0, -1, this.spec.capStart);
    }
    if (this.spec.capEnd !== undefined) {
      cap(R - 1, 1, this.spec.capEnd);
    }
  }
}

/** Superellipse outline helper: returns the point on an asymmetric superellipse (top/bottom extents differ). */
export function superellipse(theta: number, halfWidth: number, top: number, bottom: number, nTop: number, nBottom: number, out: THREE.Vector2): THREE.Vector2 {
  const sx = Math.sin(theta);
  const cy = Math.cos(theta);
  const n = cy >= 0 ? nTop : nBottom;
  const e = 2 / n;
  const x = Math.sign(sx) * Math.pow(Math.abs(sx), e) * halfWidth;
  const y = cy >= 0 ? Math.pow(cy, e) * top : -Math.pow(-cy, e) * bottom;
  return out.set(x, y);
}
