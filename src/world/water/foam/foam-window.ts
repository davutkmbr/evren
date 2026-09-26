/**
 * Bookkeeping of the advected foam field (phase 21 stage 7c), CPU only: a square window of `size` texels around the
 * camera, placed in whole texels of the world lattice (so a scroll moves the stored state by an integer offset and
 * never resamples it), the fixed-step clock, and the foam stamps (hull wakes, the dragon, splashes) queued for the
 * next draw. The window only moves when a simulation step runs; in between the water keeps sampling the last
 * placement (the field's own rectangle), so no pass is needed just to scroll. The GPU side (foam-gpu.ts) consumes
 * one frame at a time; the headless checks drive this class directly with a CPU port of the shaders.
 */
import { FOAM_SIM, type FoamQuality } from './config';

/**
 * One stamp: a tapered capsule from (x0, z0) with radius r0 to (x1, z1) with radius r1 (a disk when the ends
 * coincide), or with `ring` > 0 a hollow ring of that band width at radius r0 around (x0, z0). The field is raised to
 * at least the stamp's levels (max blend): foam (fresh, fast-decaying), wake (long-lived), bubbles, slick.
 */
export interface FoamStamp {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  r0: number;
  r1: number;
  ring: number;
  foam: number;
  wake: number;
  bubbles: number;
  slick: number;
}

const newStamp = (): FoamStamp => ({ x0: 0, z0: 0, x1: 0, z1: 0, r0: 1, r1: 1, ring: 0, foam: 0, wake: 0, bubbles: 0, slick: 0 });

export class FoamWindow {
  size = 0;
  texel = 1;
  /** Window minimum corner in whole texels of the world lattice (world metres = index x texel). */
  originX = 0;
  originZ = 0;
  /** Texels the window moved since the last simulation pass consumed the frame (the first step scrolls by this). */
  shiftX = 0;
  shiftZ = 0;
  /** The stored state is stale (first use, a jump, a quality change): the first step starts from zero. */
  needsClear = true;
  /** Simulation steps to run this frame (fixed step). */
  steps = 0;
  /** Simulation time of the field (s, advanced by whole steps). */
  simTime = 0;
  /** Stamps queued this frame (the first `count` of `stamps`). */
  readonly stamps: FoamStamp[] = [];
  count = 0;
  /** Stamps dropped this frame (queue full, outside the window, bad numbers). */
  dropped = 0;
  maxStamps = 0;
  private stepClock = 0;
  private placed = false;

  constructor(quality?: FoamQuality) {
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

  get minX(): number {
    return this.originX * this.texel;
  }

  get minZ(): number {
    return this.originZ * this.texel;
  }

  setQuality(q: FoamQuality): void {
    this.maxStamps = Math.max(0, Math.floor(q.maxStamps));
    while (this.stamps.length < this.maxStamps) {
      this.stamps.push(newStamp());
    }
    if (q.size === this.size && q.texel === this.texel) {
      return;
    }
    this.size = Math.max(0, Math.floor(q.size));
    this.texel = q.texel > 0 ? q.texel : 1;
    this.placed = false;
    this.needsClear = true;
    this.count = 0;
    this.shiftX = 0;
    this.shiftZ = 0;
  }

  /** Forget the stored state (the camera jumped, the field was paused): the next step starts from zero. */
  reset(): void {
    this.placed = false;
    this.needsClear = true;
    this.shiftX = 0;
    this.shiftZ = 0;
  }

  /**
   * Starts a frame: drops the previous frame's stamps and advances the fixed-step clock; when a step is due the
   * window moves so (cx, cz) (the camera) sits at its centre (the first placement happens at once).
   */
  beginFrame(dt: number, cx: number, cz: number): void {
    this.count = 0;
    this.dropped = 0;
    if (!this.enabled) {
      this.steps = 0;
      return;
    }
    const step = FOAM_SIM.step;
    this.stepClock += Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.25)) : 0;
    let steps = Math.floor(this.stepClock / step + 1e-9);
    this.stepClock -= steps * step;
    if (steps > FOAM_SIM.maxSteps) {
      steps = FOAM_SIM.maxSteps;
      this.stepClock = 0;
    }
    this.steps = steps;
    this.simTime += steps * step;
    if (!this.placed || steps > 0) {
      this.place(cx, cz);
    }
  }

  private place(cx: number, cz: number): void {
    const ox = Math.floor(cx / this.texel - this.size / 2);
    const oz = Math.floor(cz / this.texel - this.size / 2);
    if (!Number.isFinite(ox) || !Number.isFinite(oz)) {
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
    if (this.needsClear) {
      this.shiftX = 0;
      this.shiftZ = 0;
    }
  }

  /**
   * Queues a stamp (see FoamStamp). Returns false when it was dropped: the field is off, the levels are negligible
   * or not finite, it lies outside the window, or this frame's queue is full.
   */
  stamp(x0: number, z0: number, x1: number, z1: number, r0: number, r1: number, ring: number, foam: number, wake: number, bubbles: number, slick: number): boolean {
    if (!this.enabled || this.maxStamps === 0) {
      return false;
    }
    if (!(foam > 1e-3 || wake > 1e-3 || bubbles > 1e-3 || slick > 1e-3)) {
      return false;
    }
    if (!Number.isFinite(x0 + z0 + x1 + z1 + r0 + r1 + ring + foam + wake + bubbles + slick)) {
      this.dropped++;
      return false;
    }
    const r = Math.max(r0, r1, 0.05) + ring;
    const minX = this.minX;
    const minZ = this.minZ;
    const e = this.extent;
    if (Math.max(x0, x1) + r < minX || Math.min(x0, x1) - r > minX + e || Math.max(z0, z1) + r < minZ || Math.min(z0, z1) - r > minZ + e) {
      this.dropped++;
      return false;
    }
    if (this.count >= this.maxStamps) {
      this.dropped++;
      return false;
    }
    const s = this.stamps[this.count++];
    s.x0 = x0;
    s.z0 = z0;
    s.x1 = x1;
    s.z1 = z1;
    s.r0 = Math.max(0.05, r0);
    s.r1 = Math.max(0.05, r1);
    s.ring = Math.max(0, ring);
    s.foam = clamp01(foam);
    s.wake = clamp01(wake);
    s.bubbles = clamp01(bubbles);
    s.slick = clamp01(slick);
    return true;
  }

  /** The GPU consumed this frame (scroll applied, cleared if asked, stamps drawn). */
  consumed(): void {
    this.shiftX = 0;
    this.shiftZ = 0;
    // A clear always runs a pass (a step, or an apply-only pass without one).
    this.needsClear = false;
    this.count = 0;
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
