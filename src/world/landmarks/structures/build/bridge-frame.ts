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

  /**
   * Frame of a bridge from its anchors [main pier A, main pier B, deck end A, deck end B]: the axis runs along the
   * longer of the two baselines (usually the deck ends, several hundred metres apart) and the origin is the midpoint of
   * the main piers on that line. The pier pair alone is only 70-80 m long on the Golden Horn bridges: anchors rounded
   * to 1e-5 deg turned its axis by ~0.4 deg, which put the deck ends 1.5 m beside the streets they join.
   */
  static fromAnchors(anchors: ReadonlyArray<{ x: number; z: number }>): BridgeFrame {
    const [a, b, c, d] = anchors;
    if (!c || !d || Math.hypot(d.x - c.x, d.z - c.z) <= Math.hypot(b.x - a.x, b.z - a.z)) {
      return BridgeFrame.fromPoints(a, b);
    }
    // Ends ordered like the piers (A to B).
    const flip = (d.x - c.x) * (b.x - a.x) + (d.z - c.z) * (b.z - a.z) < 0;
    const [p, q] = flip ? [d, c] : [c, d];
    const len = Math.hypot(q.x - p.x, q.z - p.z);
    const ux = (q.x - p.x) / len;
    const uz = (q.z - p.z) / len;
    const mx = (a.x + b.x) / 2;
    const mz = (a.z + b.z) / 2;
    const t = (mx - p.x) * ux + (mz - p.z) * uz;
    const ox = p.x + ux * t;
    const oz = p.z + uz * t;
    return new BridgeFrame(ox, oz, ox + ux, oz + uz);
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
