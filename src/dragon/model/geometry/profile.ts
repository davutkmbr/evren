import * as THREE from 'three';
import { superellipse } from './loft';
import { angleDiff, gauss } from './path';

/** Superellipse section parameters (meters) relative to the path point, in the path frame. */
export interface SectionKey {
  s: number;
  /** Vertical offset of the section center. */
  cy: number;
  halfWidth: number;
  top: number;
  bottom: number;
  nTop: number;
  nBottom: number;
}

/** Gaussian radial bump in (s, theta). Mirrored to both sides unless `single`. */
export interface Bump {
  s: number;
  sigmaS: number;
  theta: number;
  sigmaTheta: number;
  amp: number;
  single?: boolean;
  /** Optional sinusoidal modulation along s (wavelength m) for ribs/ridges. */
  ripple?: number;
}

const KEYS: Array<keyof Omit<SectionKey, 's'>> = ['cy', 'halfWidth', 'top', 'bottom', 'nTop', 'nBottom'];

function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

/** Keyframed section profile with bumps; evaluates a closed outline for (s, theta). */
export class SectionProfile {
  readonly keys: SectionKey[];
  readonly bumps: Bump[];
  private readonly current: SectionKey = { s: 0, cy: 0, halfWidth: 0, top: 0, bottom: 0, nTop: 2, nBottom: 2 };
  private lastS = Number.NaN;
  private readonly base = new THREE.Vector2();

  constructor(keys: SectionKey[], bumps: Bump[] = []) {
    this.keys = [...keys].sort((a, b) => a.s - b.s);
    this.bumps = bumps;
  }

  paramsAt(s: number): SectionKey {
    if (s === this.lastS) {
      return this.current;
    }
    this.lastS = s;
    const k = this.keys;
    const out = this.current;
    out.s = s;
    if (s <= k[0].s) {
      for (const key of KEYS) {
        out[key] = k[0][key];
      }
      return out;
    }
    if (s >= k[k.length - 1].s) {
      for (const key of KEYS) {
        out[key] = k[k.length - 1][key];
      }
      return out;
    }
    let i = 0;
    while (i < k.length - 2 && k[i + 1].s < s) {
      i++;
    }
    const a = k[Math.max(i - 1, 0)];
    const b = k[i];
    const c = k[i + 1];
    const d = k[Math.min(i + 2, k.length - 1)];
    const t = (s - b.s) / Math.max(c.s - b.s, 1e-6);
    for (const key of KEYS) {
      // Clamp to the segment range to avoid Catmull-Rom overshoot producing bulges.
      const lo = Math.min(b[key], c[key]);
      const hi = Math.max(b[key], c[key]);
      const span = hi - lo;
      const val = catmull(a[key], b[key], c[key], d[key], t);
      out[key] = THREE.MathUtils.clamp(val, lo - span * 0.15, hi + span * 0.15);
    }
    return out;
  }

  bumpAt(s: number, theta: number): number {
    let sum = 0;
    for (const b of this.bumps) {
      const ds = s - b.s;
      if (Math.abs(ds) > b.sigmaS * 3.5) {
        continue;
      }
      const ws = gauss(ds, b.sigmaS);
      let wt = gauss(angleDiff(theta, b.theta), b.sigmaTheta);
      if (!b.single) {
        wt = Math.max(wt, gauss(angleDiff(theta, -b.theta), b.sigmaTheta));
      }
      let amp = b.amp;
      if (b.ripple) {
        amp *= 0.5 + 0.5 * Math.cos((ds / b.ripple) * Math.PI * 2);
      }
      sum += amp * ws * wt;
    }
    return sum;
  }

  /** Outline point (x right, y up) for arc length s and angle theta. */
  evaluate(s: number, theta: number, out: THREE.Vector2): THREE.Vector2 {
    const p = this.paramsAt(s);
    superellipse(theta, p.halfWidth, p.top, p.bottom, p.nTop, p.nBottom, this.base);
    const r = this.base.length();
    const bump = this.bumpAt(s, theta);
    if (r > 1e-6) {
      this.base.multiplyScalar(Math.max(r + bump, r * 0.2) / r);
    }
    return out.set(this.base.x, this.base.y + p.cy);
  }
}
