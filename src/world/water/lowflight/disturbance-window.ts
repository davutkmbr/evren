/**
 * Bookkeeping of the sea disturbance field (phase 21 stage 2), CPU only: a square window of `size` texels that follows
 * the dragon in whole-texel steps (so the simulation can scroll its state by an integer offset without resampling),
 * the stamps queued for the next simulation pass, the fixed-step clock and whether the field holds anything at all.
 * The GPU side (disturbance-gpu.ts) consumes one frame's worth at a time; headless checks drive it directly.
 */
import { DISTURBANCE_SIM, type DisturbanceQuality } from './config';

/**
 * One stamp: a capsule from (x0, z0) to (x1, z1) with `radius` (a disk when both ends coincide), optionally hollow
 * (`ring` > 0: only a band of that width at the rim). Amounts: `height` (m, added to the ripple height, signed),
 * `rough` and `foam` (added to those channels). `noise` 0..1 breaks the amounts up with a world-space noise (ruffled
 * patches, a boiling surface).
 */
export interface DisturbanceStamp {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  radius: number;
  ring: number;
  height: number;
  rough: number;
  foam: number;
  noise: number;
}

const newStamp = (): DisturbanceStamp => ({ x0: 0, z0: 0, x1: 0, z1: 0, radius: 1, ring: 0, height: 0, rough: 0, foam: 0, noise: 0 });

export class DisturbanceWindow {
  size = 0;
  texel = 1;
  /** Window minimum corner in whole texels of the world lattice (world metres = index × texel). */
  originX = 0;
  originZ = 0;
  /** Texels the window moved since the last simulation pass consumed the frame (the pass scrolls by this). */
  shiftX = 0;
  shiftZ = 0;
  /** The field's stored state is stale (first use, re-activation, a jump, a quality change): clear before simulating. */
  needsClear = true;
  /** Simulation steps to run this frame (fixed step). */
  steps = 0;
  /** Stamps queued this frame (the first `count` of `stamps`). */
  readonly stamps: DisturbanceStamp[] = [];
  count = 0;
  /** Stamps dropped this frame because the queue was full or they fell outside the window. */
  dropped = 0;
  /** Time (s) of the last stamp; the field is alive for DISTURBANCE_SIM.lifetime after it. */
  lastStamp = -1e9;
  private now = 0;
  private stepClock = 0;
  private placed = false;

  constructor(quality?: DisturbanceQuality) {
    for (let i = 0; i < DISTURBANCE_SIM.maxStamps; i++) {
      this.stamps.push(newStamp());
    }
    if (quality) {
      this.setQuality(quality);
    }
  }

  get enabled(): boolean {
    return this.size > 0;
  }

  /** Window side length (m). */
  get extent(): number {
    return this.size * this.texel;
  }

  /** The field holds something worth simulating and drawing. */
  get alive(): boolean {
    return this.enabled && this.now - this.lastStamp < DISTURBANCE_SIM.lifetime;
  }

  /** World x / z of the window's minimum corner (m). */
  get minX(): number {
    return this.originX * this.texel;
  }

  get minZ(): number {
    return this.originZ * this.texel;
  }

  setQuality(q: DisturbanceQuality): void {
    if (q.size === this.size && q.texel === this.texel) {
      return;
    }
    this.size = Math.max(0, Math.floor(q.size));
    this.texel = q.texel > 0 ? q.texel : 1;
    this.placed = false;
    this.needsClear = true;
    this.lastStamp = -1e9;
    this.count = 0;
  }

  /**
   * Starts a frame: drops the previous frame's stamps, moves the window so (cx, cz) (the dragon, trailed back along
   * its motion by the caller) sits at its centre, and advances the fixed-step clock (steps run only while alive).
   */
  beginFrame(now: number, dt: number, cx: number, cz: number): void {
    const wasAlive = this.alive;
    this.now = now;
    this.count = 0;
    this.dropped = 0;
    if (!this.enabled) {
      this.steps = 0;
      return;
    }
    const ox = Math.floor(cx / this.texel - this.size / 2);
    const oz = Math.floor(cz / this.texel - this.size / 2);
    if (!Number.isFinite(ox) || !Number.isFinite(oz)) {
      this.steps = 0;
      return;
    }
    if (!this.placed) {
      this.placed = true;
      this.needsClear = true;
    } else {
      this.shiftX += ox - this.originX;
      this.shiftZ += oz - this.originZ;
    }
    this.originX = ox;
    this.originZ = oz;
    if (Math.abs(this.shiftX) >= this.size || Math.abs(this.shiftZ) >= this.size) {
      this.needsClear = true;
    }
    if (!wasAlive || !this.alive) {
      // A dead field is not simulated; whatever the textures still hold is stale.
      this.needsClear = true;
    }
    if (this.needsClear) {
      this.shiftX = 0;
      this.shiftZ = 0;
    }
    this.stepClock += Math.max(0, Math.min(dt, 0.25));
    const step = DISTURBANCE_SIM.step;
    let steps = Math.floor(this.stepClock / step);
    this.stepClock -= steps * step;
    if (steps > DISTURBANCE_SIM.maxSteps) {
      steps = DISTURBANCE_SIM.maxSteps;
      this.stepClock = 0;
    }
    this.steps = steps;
  }

  /**
   * Queues a stamp (see DisturbanceStamp). Returns false when it was dropped: the field is off, the amounts are
   * negligible or not finite, it lies outside the window, or this frame's queue is full.
   */
  stamp(x0: number, z0: number, x1: number, z1: number, radius: number, ring: number, height: number, rough: number, foam: number, noise: number): boolean {
    if (!this.enabled) {
      return false;
    }
    if (!(Math.abs(height) > 1e-5 || rough > 1e-5 || foam > 1e-5)) {
      return false;
    }
    const values = [x0, z0, x1, z1, radius, ring, height, rough, foam, noise];
    for (const v of values) {
      if (!Number.isFinite(v)) {
        this.dropped++;
        return false;
      }
    }
    const minX = this.minX;
    const minZ = this.minZ;
    const e = this.extent;
    const r = Math.max(radius, 0.01);
    if (Math.max(x0, x1) + r < minX || Math.min(x0, x1) - r > minX + e || Math.max(z0, z1) + r < minZ || Math.min(z0, z1) - r > minZ + e) {
      this.dropped++;
      return false;
    }
    if (this.count >= this.stamps.length) {
      this.dropped++;
      return false;
    }
    const s = this.stamps[this.count++];
    s.x0 = x0;
    s.z0 = z0;
    s.x1 = x1;
    s.z1 = z1;
    s.radius = r;
    s.ring = Math.max(0, ring);
    s.height = height;
    s.rough = Math.max(0, rough);
    s.foam = Math.max(0, foam);
    s.noise = Math.min(1, Math.max(0, noise));
    if (!this.alive) {
      this.needsClear = true;
      this.shiftX = 0;
      this.shiftZ = 0;
    }
    this.lastStamp = this.now;
    return true;
  }

  /**
   * This frame needs a simulation pass even without a step due (stamps, a scroll or a clear): the GPU then runs one
   * apply-only pass that does not advance time, so the ripples keep their real speed at any frame rate.
   */
  get needsPass(): boolean {
    return this.needsClear || this.count > 0 || this.shiftX !== 0 || this.shiftZ !== 0;
  }

  /** The simulation pass consumed this frame (scroll applied, stamps drawn, textures cleared if asked). */
  consumed(): void {
    this.shiftX = 0;
    this.shiftZ = 0;
    this.needsClear = false;
    this.count = 0;
  }

  /** Texel coordinates (continuous, 0..size) of a world point in the current window. */
  toTexel(x: number, z: number, out: { x: number; z: number }): { x: number; z: number } {
    out.x = x / this.texel - this.originX;
    out.z = z / this.texel - this.originZ;
    return out;
  }
}
