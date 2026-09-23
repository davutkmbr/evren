import { FLAP } from './params';

const TWO_PI = Math.PI * 2;

/**
 * Wing-beat oscillator. Phase 0 = top of the upstroke; the loaded downstroke spans the first
 * FLAP.downstrokeFraction of the cycle (as the rig animates it), the quicker upstroke the rest.
 */
export class WingBeat {
  phase = 1.2;
  /** Smoothed physical effort 0..1 (drives force, frequency, stamina). */
  effort = 0;
  /** Visual stroke amplitude 0..1. */
  amplitude = 0;
  frequency: number = FLAP.freqMin;
  /** True on the substep in which a new downstroke began. */
  downstrokeStarted = false;

  reset(phase = 1.2): void {
    this.phase = phase;
    this.effort = 0;
    this.amplitude = 0;
    this.downstrokeStarted = false;
  }

  /** `amplitudeLimit` keeps the stroke shallow close to a surface (wingtips clear of water/ground). */
  update(h: number, effortTarget: number, hoverBlend: number, amplitudeLimit = 1): void {
    const tau = effortTarget > this.effort ? FLAP.riseTau : FLAP.fallTau + (FLAP.riseTau - FLAP.fallTau) * hoverBlend;
    this.effort += (effortTarget - this.effort) * (1 - Math.exp(-h / tau));
    if (this.effort < 1e-4) {
      this.effort = 0;
    }
    const ampTarget = effortTarget > 0.02 ? Math.min(0.3 + 0.7 * effortTarget, amplitudeLimit) : 0;
    // Stopping is quicker than starting: the last stroke folds back to the glide pose within one upstroke.
    const ampTau = ampTarget < this.amplitude ? FLAP.ampTau * 0.5 : FLAP.ampTau;
    this.amplitude += (ampTarget - this.amplitude) * (1 - Math.exp(-h / ampTau));
    this.frequency = FLAP.freqMin + (FLAP.freqMax - FLAP.freqMin) * Math.min(1, this.effort) + FLAP.freqHoverBonus * hoverBlend;
    this.phase += TWO_PI * this.frequency * h;
    this.downstrokeStarted = false;
    if (this.phase >= TWO_PI) {
      this.phase -= TWO_PI;
      if (this.amplitude > 0.12) {
        this.downstrokeStarted = true;
      }
    }
  }

  /** Instantaneous force profile (cycle mean 1); the downstroke spans the first `downstrokeFraction` of the cycle. */
  profile(): number {
    const split = TWO_PI * FLAP.downstrokeFraction;
    if (this.phase < split) {
      const s = Math.sin((Math.PI * this.phase) / split);
      return FLAP.downstrokeWeight * s * s;
    }
    const s = Math.sin((Math.PI * (this.phase - split)) / (TWO_PI - split));
    return FLAP.upstrokeWeight * s * s;
  }

  /** Mean force scale for the current effort. */
  forceScale(): number {
    return Math.pow(this.effort, FLAP.effortExponent);
  }
}
