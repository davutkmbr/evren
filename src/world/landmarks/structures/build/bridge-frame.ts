/**
 * Straight bridge coordinate frame: s along the axis (m, 0 at `origin`), x to the right of the axis (m), y absolute
 * height. Box yaw `yaw` maps a box's local +X onto the axis and local +Z onto the right vector.
 */
import * as THREE from 'three';
import type { SweepFrame } from './mesh-builder';

export class BridgeFrame {
  readonly ax: number;
  readonly az: number;
  readonly rx: number;
  readonly rz: number;
  readonly yaw: number;
  readonly axis: THREE.Vector3;
  readonly right: THREE.Vector3;

  constructor(
    readonly ox: number,
    readonly oz: number,
    towardX: number,
    towardZ: number,
  ) {
    const len = Math.hypot(towardX - ox, towardZ - oz) || 1;
    this.ax = (towardX - ox) / len;
    this.az = (towardZ - oz) / len;
    this.rx = -this.az;
    this.rz = this.ax;
    this.yaw = Math.atan2(-this.az, this.ax);
    this.axis = new THREE.Vector3(this.ax, 0, this.az);
    this.right = new THREE.Vector3(this.rx, 0, this.rz);
  }

  static fromPoints(a: { x: number; z: number }, b: { x: number; z: number }): BridgeFrame {
    return new BridgeFrame((a.x + b.x) / 2, (a.z + b.z) / 2, b.x, b.z);
  }

  point(s: number, x: number, y: number, out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(this.ox + this.ax * s + this.rx * x, y, this.oz + this.az * s + this.rz * x);
  }

  /** Axis coordinate of a world point. */
  sOf(p: { x: number; z: number }): number {
    return (p.x - this.ox) * this.ax + (p.z - this.oz) * this.az;
  }

  /** Lateral coordinate of a world point. */
  xOf(p: { x: number; z: number }): number {
    return (p.x - this.ox) * this.rx + (p.z - this.oz) * this.rz;
  }

  /**
   * Sweep frames along the axis at the given stations; `height(s)` is the frame origin height and `grade(s)` its
   * slope dy/ds. Frames tilt with the grade (up is perpendicular to the tangent).
   */
  frames(stations: readonly number[], height: (s: number) => number, grade: (s: number) => number, lateral = 0): SweepFrame[] {
    return stations.map((s) => {
      const g = grade(s);
      const t = new THREE.Vector3(this.ax, g, this.az).normalize();
      const up = new THREE.Vector3().crossVectors(this.right, t).normalize();
      return { p: this.point(s, lateral, height(s)), right: this.right.clone(), up, s };
    });
  }
}

/** Stations from a to b with at most `step` spacing, always including both ends and any `breaks` in between. */
export function stations(a: number, b: number, step: number, breaks: readonly number[] = []): number[] {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const pts = new Set<number>([lo, hi]);
  const n = Math.max(1, Math.ceil((hi - lo) / step));
  for (let i = 1; i < n; i++) {
    pts.add(lo + ((hi - lo) * i) / n);
  }
  for (const s of breaks) {
    if (s > lo && s < hi) {
      pts.add(s);
    }
  }
  const sorted = [...pts].sort((p, q) => p - q);
  const keys = new Set<number>([lo, hi, ...breaks]);
  const out: number[] = [];
  for (const s of sorted) {
    const prev = out[out.length - 1];
    if (prev !== undefined && s - prev < step * 0.05) {
      if (keys.has(s) && !keys.has(prev)) {
        out[out.length - 1] = s;
      }
      continue;
    }
    out.push(s);
  }
  return out;
}
