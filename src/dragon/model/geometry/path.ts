import * as THREE from 'three';

export interface PathFrame {
  point: THREE.Vector3;
  /** Unit tangent along increasing arc length. */
  tangent: THREE.Vector3;
  /** Section "up" axis (y of the section plane). */
  up: THREE.Vector3;
  /** Section "right" axis (x of the section plane) = up x tangent. */
  right: THREE.Vector3;
}

/**
 * Arc-length parametrized Catmull-Rom path with a stable frame: the section up axis is the
 * reference up vector (default world +Y) made orthogonal to the tangent.
 */
export class PathSampler {
  readonly length: number;
  private readonly curve: THREE.CatmullRomCurve3;
  private readonly lut: Float32Array;
  private readonly samples: number;
  private readonly refUp: THREE.Vector3;
  /** Arc length of every control point (knot). */
  readonly knotLengths: number[];

  constructor(points: THREE.Vector3[], opts: { tension?: number; type?: 'centripetal' | 'chordal' | 'catmullrom'; up?: THREE.Vector3; samples?: number } = {}) {
    this.curve = new THREE.CatmullRomCurve3(points, false, opts.type ?? 'centripetal', opts.tension ?? 0.5);
    this.samples = opts.samples ?? Math.max(400, points.length * 120);
    this.refUp = (opts.up ?? new THREE.Vector3(0, 1, 0)).clone().normalize();
    this.lut = new Float32Array(this.samples + 1);
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    this.curve.getPoint(0, a);
    let acc = 0;
    for (let i = 1; i <= this.samples; i++) {
      this.curve.getPoint(i / this.samples, b);
      acc += a.distanceTo(b);
      this.lut[i] = acc;
      a.copy(b);
    }
    this.length = acc;
    // Knot i sits at curve parameter i / (n - 1) for CatmullRomCurve3.
    this.knotLengths = points.map((_, i) => this.lengthAtParam(i / (points.length - 1)));
  }

  private lengthAtParam(t: number): number {
    const f = THREE.MathUtils.clamp(t, 0, 1) * this.samples;
    const i = Math.min(Math.floor(f), this.samples - 1);
    const k = f - i;
    return this.lut[i] + (this.lut[i + 1] - this.lut[i]) * k;
  }

  /** Curve parameter for arc length s. */
  paramAt(s: number): number {
    const target = THREE.MathUtils.clamp(s, 0, this.length);
    let lo = 0;
    let hi = this.samples;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.lut[mid] < target) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    const span = this.lut[hi] - this.lut[lo];
    const k = span > 1e-9 ? (target - this.lut[lo]) / span : 0;
    return (lo + k) / this.samples;
  }

  pointAt(s: number, out: THREE.Vector3): THREE.Vector3 {
    return this.curve.getPoint(this.paramAt(s), out);
  }

  frameAt(s: number, out: PathFrame): PathFrame {
    const t = this.paramAt(s);
    this.curve.getPoint(t, out.point);
    this.curve.getTangent(Math.min(Math.max(t, 1e-4), 1 - 1e-4), out.tangent).normalize();
    out.up.copy(this.refUp).addScaledVector(out.tangent, -out.tangent.dot(this.refUp));
    if (out.up.lengthSq() < 1e-6) {
      out.up.set(0, 0, 1).addScaledVector(out.tangent, -out.tangent.z);
    }
    out.up.normalize();
    out.right.crossVectors(out.up, out.tangent).normalize();
    return out;
  }
}

export function createFrame(): PathFrame {
  return { point: new THREE.Vector3(), tangent: new THREE.Vector3(), up: new THREE.Vector3(), right: new THREE.Vector3() };
}

/** Samples arc-length positions with a spacing function (meters between rings). */
export function sampleRings(start: number, end: number, spacing: (s: number) => number, minCount = 2): number[] {
  const out: number[] = [];
  let s = start;
  out.push(s);
  while (s < end) {
    s += Math.max(spacing(s), 1e-3);
    out.push(Math.min(s, end));
  }
  if (out.length < minCount) {
    const n = minCount - 1;
    out.length = 0;
    for (let i = 0; i <= n; i++) {
      out.push(start + ((end - start) * i) / n);
    }
  }
  // Relax the final gap so the last ring spacing is not a sliver.
  if (out.length > 3) {
    const last = out.length - 1;
    const gap = out[last] - out[last - 1];
    const prev = out[last - 1] - out[last - 2];
    if (gap < prev * 0.5) {
      out.splice(last - 1, 1);
    }
  }
  return out;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = THREE.MathUtils.clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function gauss(x: number, sigma: number): number {
  const k = x / sigma;
  return Math.exp(-0.5 * k * k);
}

/** Wraps an angle difference into [-PI, PI]. */
export function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) {
    d -= Math.PI * 2;
  }
  while (d < -Math.PI) {
    d += Math.PI * 2;
  }
  return d;
}
