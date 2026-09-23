import * as THREE from 'three';
import { wrapAngle } from './scalar';

/**
 * Critically damped spring, integrated analytically so it is exact and stable for any dt.
 * x(t) = target + (c1 + c2·t)·e^(-ωt), c1 = x0 - target, c2 = v0 + ω·c1.
 * `omega` is the natural frequency (rad/s); settle time ≈ 4.6 / omega. Following a ramp of slope v
 * it lags by 2v/omega in steady state (see `leadFor`).
 */
export class Spring {
  x: number;
  v = 0;

  constructor(x = 0) {
    this.x = x;
  }

  update(target: number, omega: number, dt: number): number {
    if (dt <= 0) {
      return this.x;
    }
    const c1 = this.x - target;
    const c2 = this.v + omega * c1;
    const e = Math.exp(-omega * dt);
    this.x = target + (c1 + c2 * dt) * e;
    this.v = (c2 - omega * (c1 + c2 * dt)) * e;
    return this.x;
  }

  reset(x: number, v = 0): void {
    this.x = x;
    this.v = v;
  }
}

/** Critically damped spring on an angle (radians), always taking the short way round. */
export class AngleSpring {
  x: number;
  v = 0;

  constructor(x = 0) {
    this.x = x;
  }

  update(target: number, omega: number, dt: number): number {
    if (dt <= 0) {
      return this.x;
    }
    const c1 = wrapAngle(this.x - target);
    const c2 = this.v + omega * c1;
    const e = Math.exp(-omega * dt);
    this.x = wrapAngle(target + (c1 + c2 * dt) * e);
    this.v = (c2 - omega * (c1 + c2 * dt)) * e;
    return this.x;
  }

  reset(x: number, v = 0): void {
    this.x = wrapAngle(x);
    this.v = v;
  }
}

/** Critically damped spring on a Vector3 (component-wise, exact). */
export class VecSpring {
  readonly x = new THREE.Vector3();
  readonly v = new THREE.Vector3();

  update(target: THREE.Vector3, omega: number, dt: number): THREE.Vector3 {
    if (dt <= 0) {
      return this.x;
    }
    const e = Math.exp(-omega * dt);
    this.x.x = step(this, 'x', target.x, omega, dt, e);
    this.x.y = step(this, 'y', target.y, omega, dt, e);
    this.x.z = step(this, 'z', target.z, omega, dt, e);
    return this.x;
  }

  reset(x: THREE.Vector3, v?: THREE.Vector3): void {
    this.x.copy(x);
    if (v) {
      this.v.copy(v);
    } else {
      this.v.set(0, 0, 0);
    }
  }
}

function step(s: VecSpring, k: 'x' | 'y' | 'z', target: number, omega: number, dt: number, e: number): number {
  const c1 = s.x[k] - target;
  const c2 = s.v[k] + omega * c1;
  s.v[k] = (c2 - omega * (c1 + c2 * dt)) * e;
  return target + (c1 + c2 * dt) * e;
}

/**
 * Under-damped mass-spring-damper (ζ < 1 gives a little overshoot, used for the rider's head inertia).
 * Semi-implicit Euler with fixed sub-steps, stable for the stiffness we use.
 */
export class DampedOscillator {
  readonly x = new THREE.Vector3();
  readonly v = new THREE.Vector3();

  update(target: THREE.Vector3, omega: number, zeta: number, dt: number): THREE.Vector3 {
    if (dt <= 0) {
      return this.x;
    }
    const steps = Math.min(8, Math.max(1, Math.ceil(dt * 240)));
    const h = dt / steps;
    const k = omega * omega;
    const c = 2 * zeta * omega;
    for (let i = 0; i < steps; i++) {
      this.v.x += (-k * (this.x.x - target.x) - c * this.v.x) * h;
      this.v.y += (-k * (this.x.y - target.y) - c * this.v.y) * h;
      this.v.z += (-k * (this.x.z - target.z) - c * this.v.z) * h;
      this.x.x += this.v.x * h;
      this.x.y += this.v.y * h;
      this.x.z += this.v.z * h;
    }
    return this.x;
  }

  reset(): void {
    this.x.set(0, 0, 0);
    this.v.set(0, 0, 0);
  }
}

/** Time a critically damped follower lags behind a constant-velocity target (aim ahead by v * this). */
export function leadFor(omega: number): number {
  return 2 / omega;
}

/** Frame-rate independent exponential smoothing factor. */
export function expAlpha(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}
