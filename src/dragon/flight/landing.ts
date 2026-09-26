/**
 * Landing v2 style: which landing this is (a variant picked by context and a seeded random, never the same twice in
 * a row) and the animal-like modulation of its approach and flare. The landing laws in controller.ts turn it into
 * control targets (path, bank, airbrake, beats), so every change of speed comes out of the flight model; the pose
 * driver reads the cues (look at the spot, tail steering, flare envelope).
 */
import { clamp, createRng, smoothstep } from '../../core/math/noise';
import { LANDING_STYLE, type LandingVariantParams } from './params';
import type { FlightSim } from './sim';

export type LandingVariant = keyof typeof LANDING_STYLE.variants;

const TWO_PI = Math.PI * 2;

export class LandingStyle {
  /** Variant of the landing under way (null outside a landing). */
  variant: LandingVariant | null = null;
  /** Variant of the previous landing (never repeated when another applies). */
  last: LandingVariant | null = null;
  /** Test / scenario hook: the next landing uses this variant (cleared once used). */
  forceNext: LandingVariant | null = null;
  params: LandingVariantParams = LANDING_STYLE.variants.shallow;
  /** Seconds since the landing began. */
  time = 0;
  /** Foot clearance when the landing began (m). */
  entryClearance = 0;
  /** Approach progress 0..1 (L → flare), kept monotonic. */
  progress = 0;
  /** Downstrokes in the flare before the touchdown: all of them, and the backstrokes (while they still brake). */
  beats = 0;
  backstrokes = 0;
  /** 0..1 envelope of the current check (braking beat) in the approach. */
  check = 0;
  /** Checks flown so far. */
  checks = 0;
  /** 0..1 flare envelope for the pose (rises through the flare, 0 in the approach). */
  flare = 0;
  /** Seconds since the flare began (-1: not yet). */
  flareTime = -1;
  /** Seconds since the run-out flare kicked off its backstroke (-1: not yet). */
  kickTime = -1;
  /** Bank (rad) the style asks for now (weave / turn); the tail steers with its rate. */
  bank = 0;
  bankRate = 0;
  /** Seeded slow waves for the wings (−1..1). */
  sweepWave = 0;
  spreadWave = 0;
  /** Effort jitter of the current beat (tired landings: sloppier beats), multiplier around 1. */
  beatJitter = 1;
  /** The last finished landing (touched down or broken off): its variant, backstrokes and checks. */
  readonly previous = { variant: null as LandingVariant | null, beats: 0, backstrokes: 0, checks: 0, sink: 0, speed: 0 };
  /** Vertical (m/s, + = down) and ground speed (m/s) at the touchdown of the landing under way (NaN before it). */
  private touchSink = Number.NaN;
  private touchSpeed = Number.NaN;

  private rng = createRng(LANDING_STYLE.seed);
  private weaveAmp = 0;
  private weaveOmega = 1;
  private weavePhase = 0;
  private weaveOmega2 = 1;
  private turnDir = 1;
  private turnStart = 0;
  private nextCheck = Infinity;
  private checkAge = Infinity;
  private waveSeed = 0;

  reset(): void {
    this.variant = null;
    this.last = null;
    this.forceNext = null;
    this.rng = createRng(LANDING_STYLE.seed);
    this.end();
  }

  /** Seeded random 0..1. */
  random(): number {
    return this.rng();
  }

  /** Clears the per-landing state (the variant history is kept). */
  end(): void {
    if (this.variant !== null) {
      this.previous.variant = this.variant;
      this.previous.beats = this.beats;
      this.previous.backstrokes = this.backstrokes;
      this.previous.checks = this.checks;
      this.previous.sink = this.touchSink;
      this.previous.speed = this.touchSpeed;
    }
    this.touchSink = Number.NaN;
    this.touchSpeed = Number.NaN;
    this.variant = null;
    this.time = 0;
    this.progress = 0;
    this.beats = 0;
    this.backstrokes = 0;
    this.check = 0;
    this.checks = 0;
    this.flare = 0;
    this.flareTime = -1;
    this.kickTime = -1;
    this.bank = 0;
    this.bankRate = 0;
    this.checkAge = Infinity;
    this.nextCheck = Infinity;
    this.beatJitter = 1;
  }

  /**
   * Picks the variant for a landing that starts now. The most specific one that applies wins (tired first), but never
   * the one used last time when another applies; the steep drop-in needs height, the shallow approach little of it,
   * and between the two (and the two run-outs) a seeded random decides.
   */
  pick(sim: FlightSim, runOut: boolean, clearance: number): LandingVariant {
    const S = LANDING_STYLE;
    const candidates: LandingVariant[] = [];
    if (runOut) {
      if (this.random() < 0.5) {
        candidates.push('glide', 'swoop');
      } else {
        candidates.push('swoop', 'glide');
      }
    } else {
      if (sim.tired || sim.stamina < S.tiredStamina) {
        candidates.push('tired');
      }
      const drop = clearance >= S.dropMinHeight;
      const shallow = clearance <= S.shallowMaxHeight;
      if (drop && shallow) {
        candidates.push(...(this.random() < 0.5 ? (['drop', 'shallow'] as const) : (['shallow', 'drop'] as const)));
      } else {
        candidates.push(drop ? 'drop' : 'shallow');
      }
    }
    const fresh = candidates.length > 1 ? candidates.filter((c) => c !== this.last) : candidates;
    return fresh[0];
  }

  /** A landing begins (first landing-law substep). */
  begin(sim: FlightSim, runOut: boolean, clearance: number): void {
    this.end();
    const forced = this.forceNext;
    const runOutVariant = forced === 'glide' || forced === 'swoop';
    const variant = forced !== null && runOutVariant === runOut ? forced : this.pick(sim, runOut, clearance);
    this.forceNext = null;
    this.variant = variant;
    this.last = variant;
    this.params = LANDING_STYLE.variants[variant];
    this.entryClearance = Math.max(clearance, 1);
    const p = this.params;
    const [w0, w1] = p.weavePeriod;
    const period = w0 + (w1 - w0) * this.random();
    this.weaveOmega = TWO_PI / period;
    this.weaveOmega2 = this.weaveOmega * (1.7 + 0.4 * this.random());
    this.weavePhase = TWO_PI * this.random();
    this.weaveAmp = p.weave * (0.75 + 0.5 * this.random());
    this.turnDir = this.random() < 0.5 ? -1 : 1;
    this.turnStart = 0.5 + 0.8 * this.random();
    this.waveSeed = TWO_PI * this.random();
    this.nextCheck = this.checkInterval() * (0.35 + 0.4 * this.random());
  }

  private checkInterval(): number {
    const [a, b] = this.params.checkEvery;
    return b > 0 ? a + (b - a) * this.random() : Infinity;
  }

  /**
   * Advances the style one substep. `quiet`: too low (or too close to the flare) for checks, weave and turns;
   * `room`: open air around the track (no deck or ceiling over it) for a weave or a turn.
   */
  step(sim: FlightSim, h: number, quiet: boolean, room: boolean): void {
    this.time += h;
    const p = this.params;
    const sloppy = p.sloppy;
    // Checks: one nose-up pulse with the airbrake and a deep beat, every checkEvery seconds while high enough.
    this.checkAge += h;
    if (!quiet && this.flareTime < 0 && this.time >= this.nextCheck) {
      this.checkAge = 0;
      this.checks++;
      this.nextCheck = this.time + this.checkInterval() * (1 + 0.35 * sloppy * (this.random() - 0.5));
    }
    const c = this.checkAge / LANDING_STYLE.checkTime;
    this.check = c < 1 ? Math.sin(Math.PI * c) ** 2 : 0;
    // Weave and turn: a bank the controller holds while the pilot leaves the stick alone.
    let bank = 0;
    if (room && !quiet && this.flareTime < 0) {
      const env = smoothstep(0, 1.2, this.time);
      const t = this.time;
      // Cosine phase: the heading swings about the entry heading instead of drifting to one side.
      bank = this.weaveAmp * env * (Math.cos(this.weaveOmega * t + this.weavePhase) + 0.35 * sloppy * Math.sin(this.weaveOmega2 * t));
      if (p.turnBank > 0) {
        const u = (t - this.turnStart) / p.turnTime;
        if (u > 0 && u < 1) {
          bank += this.turnDir * p.turnBank * Math.sin(Math.PI * u) ** 2;
        }
      }
    }
    const rate = h > 0 ? (bank - this.bank) / h : 0;
    this.bankRate += (rate - this.bankRate) * (1 - Math.exp(-h / 0.25));
    this.bank = bank;
    const w = this.time * 0.9 + this.waveSeed;
    this.sweepWave = Math.sin(w) * 0.7 + 0.3 * Math.sin(2.3 * w + 1.1);
    this.spreadWave = Math.sin(0.7 * w + 2.1);
    if (this.flareTime >= 0) {
      this.flareTime += h;
    }
    if (this.kickTime >= 0) {
      this.kickTime += h;
    }
    this.flare = this.flareTime < 0 ? Math.max(0, this.flare - 2 * h) : Math.min(1, this.flare + h / 0.45);
    // Tired: every beat a little different.
    if (sim.beat.downstrokeStarted) {
      this.beatJitter = 1 + 0.3 * sloppy * (this.random() - 0.5) * 2;
    }
  }

  /** Approach progress from the current clearance (monotonic). */
  updateProgress(clearance: number, flareHeight: number): number {
    const span = Math.max(this.entryClearance - flareHeight, 1);
    this.progress = Math.max(this.progress, clamp(1 - (clearance - flareHeight) / span, 0, 1));
    return this.progress;
  }

  /** Glide-slope multiplier over the approach: steepest in the middle, rounding out towards the flare. */
  pathShape(): number {
    const S = LANDING_STYLE;
    const p = this.progress;
    if (p < S.peakAt) {
      return S.shapeStart + (S.shapePeak - S.shapeStart) * Math.sin((0.5 * Math.PI * p) / S.peakAt);
    }
    return S.shapeEnd + (S.shapePeak - S.shapeEnd) * Math.cos((0.5 * Math.PI * (p - S.peakAt)) / (1 - S.peakAt));
  }

  /** The feet meet the ground (called before the stance takes over): sink (m/s, + = down) and ground speed (m/s). */
  touchdown(sink: number, speed: number): void {
    this.touchSink = sink;
    this.touchSpeed = speed;
  }

  /** The flare begins (first flare substep). */
  startFlare(): void {
    if (this.flareTime < 0) {
      this.flareTime = 0;
      this.check = 0;
      this.checkAge = Infinity;
    }
  }
}
