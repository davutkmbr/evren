import * as THREE from 'three';
import { MeshBuilder, SkinAccumulator } from './buffers';
import { Loft } from './loft';
import { PathSampler, createFrame } from './path';

/** Section keys along a tube: t (0..1), half-width (x), front (+y of section), back (-y). */
export type TubeKey = [t: number, hw: number, front: number, back: number];

export interface TubeSpec {
  points: THREE.Vector3[];
  /** Section "up" reference (section y axis), e.g. forward for vertical tubes. */
  up: THREE.Vector3;
  keys: TubeKey[];
  segments?: number;
  spacing?: number;
  material: (t: number, theta: number) => number;
  skin: (t: number, acc: SkinAccumulator) => void;
  /** Hidden in first person (whole tube, or per ring parameter t). */
  hide?: boolean | ((t: number) => boolean);
  capStart?: boolean;
  capEnd?: boolean;
  /** How far the end caps bulge out along the path (m, default 0.004; 0 = flat). */
  capDepth?: number;
  /** Optional radial offset (m) as a function of (t, theta) for folds/detail. */
  bump?: (t: number, theta: number) => number;
  /** Per-vertex wear/edge parameter written to aData.y (0..1). */
  wear?: (t: number, theta: number) => number;
  color?: THREE.Color;
}

function interpKeys(keys: TubeKey[], t: number): [number, number, number] {
  if (t <= keys[0][0]) {
    return [keys[0][1], keys[0][2], keys[0][3]];
  }
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (t <= b[0]) {
      const u = (t - a[0]) / Math.max(b[0] - a[0], 1e-6);
      const s = u * u * (3 - 2 * u);
      return [a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s, a[3] + (b[3] - a[3]) * s];
    }
  }
  const l = keys[keys.length - 1];
  return [l[1], l[2], l[3]];
}

/** Point on the surface of a tube (same frame and keys as buildTube), lifted `lift` m off it. */
export function tubeSurfacePoint(spec: TubeSpec, t: number, theta: number, lift: number, out: THREE.Vector3): THREE.Vector3 {
  const path = new PathSampler(spec.points, { type: 'centripetal', up: spec.up, samples: 400 });
  const f = path.frameAt(THREE.MathUtils.clamp(t, 0.001, 0.999) * path.length, createFrame());
  const [hw, front, back] = interpKeys(spec.keys, t);
  const c = Math.cos(theta);
  const b = spec.bump ? spec.bump(t, theta) : 0;
  const x = Math.sin(theta) * (hw + b + lift);
  const y = c >= 0 ? c * (front + b + lift) : c * (back + b + lift);
  return out.copy(f.point).addScaledVector(f.right, x).addScaledVector(f.up, y);
}

/** Swept tube along a spline with keyed elliptical sections (rider body parts, straps, rings). */
export function buildTube(builder: MeshBuilder, spec: TubeSpec): void {
  const path = new PathSampler(spec.points, { type: 'centripetal', up: spec.up, samples: 400 });
  const L = path.length;
  const spacing = spec.spacing ?? 0.02;
  const rings: number[] = [];
  const n = Math.max(3, Math.ceil(L / spacing));
  for (let i = 0; i <= n; i++) {
    rings.push(0.001 + (i / n) * (L - 0.002));
  }
  const color = spec.color ?? new THREE.Color(1, 1, 1);
  new Loft({
    path,
    rings,
    segments: spec.segments ?? 14,
    section: (s, theta, out) => {
      const t = s / L;
      const [hw, front, back] = interpKeys(spec.keys, t);
      const c = Math.cos(theta);
      const r = 1 + (spec.bump ? spec.bump(t, theta) / Math.max(hw, 0.01) : 0);
      out.set(Math.sin(theta) * hw * r, (c >= 0 ? c * front : c * back) * r);
    },
    skin: (s, theta, pos, acc) => spec.skin(s / L, acc),
    data: (s, theta, pos, out) => {
      const hidden = typeof spec.hide === 'function' ? spec.hide(s / L) : !!spec.hide;
      out.set(spec.material(s / L, theta), spec.wear ? spec.wear(s / L, theta) : 0, hidden ? 1 : 0, 0);
    },
    color: (s, theta, pos, out) => out.copy(color),
    minCircumference: 0.05,
    vScale: 1,
    capStart: spec.capStart ? (spec.capDepth ?? 0.004) : undefined,
    capEnd: spec.capEnd ? (spec.capDepth ?? 0.004) : undefined,
  }).build(builder);
}

export interface SheetSpec {
  rows: number;
  cols: number;
  /** Surface point for u (across, cols) and v (along, rows), both 0..1. */
  point: (u: number, v: number, out: THREE.Vector3) => void;
  material: (u: number, v: number) => number;
  skin: (u: number, v: number, acc: SkinAccumulator) => void;
  hide?: boolean;
  /** aData.y (wear/edge parameter). */
  wear?: (u: number, v: number) => number;
  /** Closed in u (last column wraps to the first) for rows where this returns true. */
  wrapU?: (v: number) => boolean;
  /** Reverse the facing (normals and winding). */
  flip?: boolean;
}

/** Grid sheet with smooth normals that agree with the triangle winding (double-sided rider material). */
export function buildSheet(builder: MeshBuilder, spec: SheetSpec): void {
  const { rows, cols } = spec;
  const W = cols + 1;
  const grid: THREE.Vector3[] = [];
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      const p = new THREE.Vector3();
      spec.point(c / cols, r / rows, p);
      grid.push(p);
    }
  }
  const base = builder.vertexCount;
  const du = new THREE.Vector3();
  const dv = new THREE.Vector3();
  const n = new THREE.Vector3();
  const skin = new SkinAccumulator();
  const data = new THREE.Vector4();
  const uv = new THREE.Vector2();
  const sign = spec.flip ? -1 : 1;
  for (let r = 0; r <= rows; r++) {
    const v = r / rows;
    const wrap = spec.wrapU ? spec.wrapU(v) : false;
    for (let c = 0; c <= cols; c++) {
      const u = c / cols;
      let cl = c - 1;
      let cr = c + 1;
      if (wrap) {
        cl = c === 0 ? cols - 1 : cl;
        cr = c === cols ? 1 : cr;
      } else {
        cl = Math.max(cl, 0);
        cr = Math.min(cr, cols);
      }
      du.subVectors(grid[r * W + cr], grid[r * W + cl]);
      dv.subVectors(grid[Math.min(r + 1, rows) * W + c], grid[Math.max(r - 1, 0) * W + c]);
      n.crossVectors(du, dv);
      if (n.lengthSq() < 1e-14) {
        n.set(0, 1, 0);
      }
      n.normalize().multiplyScalar(sign);
      skin.clear();
      spec.skin(u, v, skin);
      data.set(spec.material(u, v), spec.wear ? spec.wear(u, v) : 0, spec.hide ? 1 : 0, 0);
      uv.set(u, v);
      builder.addVertex({ position: grid[r * W + c], normal: n, uv, skin, data });
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i0 = base + r * W + c;
      const i1 = i0 + 1;
      const i2 = i0 + W;
      const i3 = i2 + 1;
      if (sign > 0) {
        builder.addTriangle(i0, i1, i2);
        builder.addTriangle(i1, i3, i2);
      } else {
        builder.addTriangle(i0, i2, i1);
        builder.addTriangle(i1, i2, i3);
      }
    }
  }
}

/** Smooth two-bone blend helper. */
export function blendSkin(acc: SkinAccumulator, a: number, b: number, t: number): void {
  acc.add(a, 1 - t).add(b, t);
}
