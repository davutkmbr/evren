/**
 * Speed ring boost envelope (pure math, no three.js). Flying through a speed ring adds up to BOOST_DV m/s along the
 * flight direction, spread over BOOST_TIME seconds with a smooth sin² profile (no jerk at either end). The total is
 * capped so the boost alone never pushes the dragon past BOOST_SPEED_CAP, which sits below the folded-wing dive
 * envelope (80-90 m/s, dragon/flight/params.ts): a boost is a push, never a new top speed.
 */

/** Speed added by one ring (m/s) when far below the cap. */
export const BOOST_DV = 10;
/** Seconds the push is spread over. */
export const BOOST_TIME = 1.5;
/** The boost never takes the airspeed above this (m/s): under the dive envelope's lower end. */
export const BOOST_SPEED_CAP = 78;

/** Speed a ring adds at `speed` (m/s): BOOST_DV, less near the cap, 0 at or above it. */
export function boostDeltaV(speed: number): number {
  if (!Number.isFinite(speed)) {
    return 0;
  }
  return Math.max(0, Math.min(BOOST_DV, BOOST_SPEED_CAP - speed));
}

/** Fraction of the boost delivered by time t (0..1): the integral of a sin² rate over [0, BOOST_TIME]. */
export function boostProgress(t: number, duration = BOOST_TIME): number {
  if (t <= 0) {
    return 0;
  }
  if (t >= duration) {
    return 1;
  }
  const u = t / duration;
  return u - Math.sin(2 * Math.PI * u) / (2 * Math.PI);
}

/**
 * One running boost. start() fixes the total from the speed at the ring; step(dt) returns the speed to add this
 * frame (m/s). The steps of one boost sum to exactly `total`.
 */
export class BoostEnvelope {
  total = 0;
  private t = 0;
  private delivered = 0;
  private readonly duration: number;

  constructor(duration = BOOST_TIME) {
    this.duration = duration;
  }

  get active(): boolean {
    return this.delivered < this.total - 1e-9;
  }

  /** Starts a boost at airspeed `speed`; returns the total it will add (m/s). A running boost is replaced. */
  start(speed: number): number {
    this.total = boostDeltaV(speed);
    this.t = 0;
    this.delivered = 0;
    return this.total;
  }

  /**
   * Speed to add this frame (m/s). `speed` is the current airspeed: the step is trimmed so the push never takes the
   * dragon above the cap (drag and pitch change the speed during the boost too).
   */
  step(dt: number, speed = 0): number {
    if (!this.active || dt <= 0) {
      return 0;
    }
    this.t += dt;
    const target = this.total * boostProgress(this.t, this.duration);
    let dv = target - this.delivered;
    this.delivered = target;
    dv = Math.min(dv, Math.max(0, BOOST_SPEED_CAP - speed));
    if (this.t >= this.duration) {
      this.delivered = this.total;
    }
    return Math.max(0, dv);
  }

  cancel(): void {
    this.total = 0;
    this.delivered = 0;
    this.t = 0;
  }
}
