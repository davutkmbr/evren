import * as THREE from 'three';
import { fbm1, noise1 } from './math/noise1d';
import { clamp } from './math/scalar';

/** Converts meters of shake into view rotation (rad per meter of amplitude). */
const ROT_PER_METER = 0.022;

/**
 * Procedural camera shake. Impulses (impacts, roars) are measured in meters of offset amplitude and
 * decay exponentially; continuous sources (speed buffeting, turbulence, fire rumble) are set every frame.
 * Everything is band-limited gradient noise so it reads as physical vibration, not random jitter.
 */
export class CameraShake {
  /** Camera-local translation (m) for this frame. */
  readonly offset = new THREE.Vector3();
  /** Camera-local rotation (pitch, yaw, roll in radians) for this frame. */
  readonly rotation = new THREE.Vector3();

  private impulse = 0;
  private rumble = 0;
  private time = 0;

  /** Buffeting from airspeed (m amplitude), set per frame. */
  buffet = 0;
  /** Low-frequency turbulence sway (m amplitude), set per frame. */
  turbulence = 0;
  /** Deep rumble while breathing fire / roaring (m amplitude), set per frame. */
  firing = 0;

  add(amount: number): void {
    if (!(amount > 0)) {
      return;
    }
    // Energy-style accumulation so repeated small hits don't explode.
    this.impulse = clamp(Math.hypot(this.impulse, amount), 0, 3);
  }

  addRumble(amount: number): void {
    if (amount > 0) {
      this.rumble = clamp(Math.hypot(this.rumble, amount), 0, 1.5);
    }
  }

  get active(): number {
    return this.impulse + this.rumble + this.buffet + this.turbulence + this.firing;
  }

  update(dt: number): void {
    this.time += dt;
    this.impulse *= Math.exp(-3.2 * dt);
    this.rumble *= Math.exp(-1.6 * dt);
    if (this.impulse < 1e-4) {
      this.impulse = 0;
    }
    if (this.rumble < 1e-4) {
      this.rumble = 0;
    }
    const t = this.time;
    const hi = this.impulse;
    const rb = this.rumble + this.firing;
    const bf = this.buffet;
    const tb = this.turbulence;

    // Frequencies (Hz-ish): impacts 15, rumble 7, buffet 11, turbulence 0.6.
    const ox = hi * noise1(t * 15, 11) + rb * fbm1(t * 7, 21) + bf * noise1(t * 11, 31) + tb * fbm1(t * 0.6, 41);
    const oy = hi * noise1(t * 15, 12) + rb * fbm1(t * 7, 22) + bf * noise1(t * 11, 32) + tb * fbm1(t * 0.55, 42);
    const oz = (hi * noise1(t * 13, 13) + bf * noise1(t * 9, 33)) * 0.5;
    this.offset.set(ox, oy, oz);

    const rp = hi * noise1(t * 14, 14) + rb * fbm1(t * 6, 24) + bf * noise1(t * 10, 34) + tb * fbm1(t * 0.5, 44);
    const ry = hi * noise1(t * 14, 15) + rb * fbm1(t * 6, 25) + bf * noise1(t * 10, 35) + tb * fbm1(t * 0.45, 45);
    const rr = hi * noise1(t * 12, 16) * 1.4 + rb * fbm1(t * 5, 26) * 0.6 + bf * noise1(t * 8, 36) * 0.8 + tb * fbm1(t * 0.4, 46) * 1.5;
    this.rotation.set(rp * ROT_PER_METER, ry * ROT_PER_METER, rr * ROT_PER_METER);
  }

  reset(): void {
    this.impulse = 0;
    this.rumble = 0;
    this.offset.set(0, 0, 0);
    this.rotation.set(0, 0, 0);
  }
}
