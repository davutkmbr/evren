import { SourceGate, loopSource } from '../dsp/gate';
import { clamp, clamp01 } from '../dsp/math';
import type { NoiseBank } from '../dsp/noise';
import { SmoothParam } from '../dsp/param';
import { randRange, type Rng } from '../dsp/rng';
import type { Placement } from '../sfx/voice';

/** Levels of the swimming water bed (linear, before the engine's MIX trim and the placement gain). */
export const SWIM_LAYERS = {
  /** Low lapping of the water against the flanks: always there while floating, a little louder with speed. */
  lap: 0.5,
  /** Mid slosh around the body (slowly wandering band), grows with speed. */
  slosh: 0.3,
  /** The bow wave's soft fizz along the chest, only when swimming fast. */
  wash: 0.2,
  /** Single wavelets clucking against the body (scheduled envelopes). */
  cluck: 0.32,
} as const;

/** Swim speed (m/s) at which the bed reaches its full level (the fast swim). */
const FULL_SPEED = 4.5;

/** Frame input of the swim voice. */
export interface SwimVoiceParams {
  /** 0..1 floating posture (0 = not swimming: the bed fades out and its sources stop). */
  swim: number;
  /** Speed through the water (m/s). */
  speed: number;
}

/**
 * The water around a swimming dragon, synthesised (phase 21 stage 5, swimming v2): a continuous, calm bed placed at the
 * body, never slappy.
 *  lap    brown noise band-passed at ~300 Hz, amplitude-modulated by the slow gust signal (0.1-1.6 Hz): water lapping
 *  slosh  pink noise band-passed around 650 Hz, its band and level wandering with the gust signal: the slosh around it
 *  wash   white noise band-passed 1.4-4.2 kHz with a fast shimmer, rising with speed: the bow wave
 *  cluck  short pink-noise wavelets (resonant band 420-900 Hz, ~20 ms swell, ~90 ms decay) at random 0.25-1.3 s
 *         intervals (more often with speed): single waves clucking against the flanks
 * Sources run only while swimming (SourceGate); every envelope is scheduled ahead, never per frame. The wing strokes'
 * swooshes and the snorts are one-shots (sfx/swim.ts).
 */
export class SwimVoice {
  private readonly nodes: AudioNode[] = [];
  private readonly gate: SourceGate;
  private readonly level: SmoothParam;
  private readonly cutoff: SmoothParam;
  private readonly pan: SmoothParam;
  private readonly lapGain: SmoothParam;
  private readonly sloshGain: SmoothParam;
  private readonly washGain: SmoothParam;
  private readonly cluck: GainNode;
  private readonly cluckBp: BiquadFilterNode;
  private nextCluck = 0;
  /** Current swim weight and speed (for the engine and checks). */
  swim = 0;
  speed = 0;

  constructor(
    private readonly ctx: BaseAudioContext,
    noise: NoiseBank,
    out: AudioNode,
    private readonly rng: Rng,
  ) {
    const node = <T extends AudioNode>(n: T): T => {
      this.nodes.push(n);
      return n;
    };
    const filter = (type: BiquadFilterType, f: number, q: number): BiquadFilterNode => {
      const b = node(ctx.createBiquadFilter());
      b.type = type;
      b.frequency.value = f;
      b.Q.value = q;
      return b;
    };
    const gain = (v: number): GainNode => {
      const g = node(ctx.createGain());
      g.gain.value = v;
      return g;
    };
    const master = gain(0);
    const lp = filter('lowpass', 12000, 0.5);
    const panner = node(ctx.createStereoPanner());
    master.connect(lp).connect(panner).connect(out);
    this.level = new SmoothParam(master.gain, 0, 0.25);
    this.cutoff = new SmoothParam(lp.frequency, 12000, 0.15);
    this.pan = new SmoothParam(panner.pan, 0, 0.1);

    // Lap: slow, deep, breathing with the gust signal ([-1, 1]; 0.55 + 0.45 x it never drops to silence).
    const lapBp = filter('bandpass', 300, 0.7);
    const lapAm = gain(0.55);
    const lapDepth = gain(0.45);
    lapDepth.connect(lapAm.gain);
    const lapOut = gain(0);
    lapBp.connect(lapAm).connect(lapOut).connect(master);
    this.lapGain = new SmoothParam(lapOut.gain, 0, 0.3);

    // Slosh: a mid band whose centre wanders (the gust signal drives the frequency) with its own slow swell.
    const sloshBp = filter('bandpass', 650, 1.3);
    const sloshWander = gain(160);
    sloshWander.connect(sloshBp.frequency);
    const sloshAm = gain(0.5);
    const sloshDepth = gain(0.5);
    sloshDepth.connect(sloshAm.gain);
    const sloshOut = gain(0);
    sloshBp.connect(sloshAm).connect(sloshOut).connect(master);
    this.sloshGain = new SmoothParam(sloshOut.gain, 0, 0.3);

    // Wash: the bow wave's airy fizz, shimmering.
    const washHp = filter('highpass', 1400, 0.6);
    const washLp = filter('lowpass', 4200, 0.6);
    const washAm = gain(0.6);
    const washDepth = gain(0.4);
    washDepth.connect(washAm.gain);
    const washOut = gain(0);
    washHp.connect(washLp).connect(washAm).connect(washOut).connect(master);
    this.washGain = new SmoothParam(washOut.gain, 0, 0.3);

    // Clucks: one resonant band, its centre and the envelope set per wavelet.
    this.cluckBp = filter('bandpass', 600, 3);
    this.cluck = gain(0);
    this.cluckBp.connect(this.cluck).connect(master);

    this.gate = new SourceGate((t) => {
      const lap = loopSource(ctx, noise.brown, t, 0.8, rng);
      lap.connect(lapBp);
      const lapMod = loopSource(ctx, noise.gust, t, 1.3, rng);
      lapMod.connect(lapDepth);
      const slosh = loopSource(ctx, noise.pink, t, 0.9, rng);
      slosh.connect(sloshBp);
      const wander = loopSource(ctx, noise.gust, t, 0.7, rng);
      wander.connect(sloshWander);
      const sloshMod = loopSource(ctx, noise.gust, t, 2.1, rng);
      sloshMod.connect(sloshDepth);
      const wash = loopSource(ctx, noise.white, t, 0.97, rng);
      wash.connect(washHp);
      const washMod = loopSource(ctx, noise.buffet, t, 0.5, rng);
      washMod.connect(washDepth);
      const cluck = loopSource(ctx, noise.pink, t, 1.05, rng);
      cluck.connect(this.cluckBp);
      return [lap, lapMod, slosh, wander, sloshMod, wash, washMod, cluck];
    }, 2);
  }

  /** Per frame: `place` puts the bed at the swimming body, `mix` is the engine's MIX trim. */
  update(p: SwimVoiceParams, place: Placement, mix: number, now: number): void {
    const swim = clamp01(Number.isFinite(p.swim) ? p.swim : 0);
    const speed = Math.max(0, Number.isFinite(p.speed) ? p.speed : 0);
    this.swim = swim;
    this.speed = speed;
    const on = swim > 0.02;
    this.gate.update(on, now);
    const sp = clamp01(speed / FULL_SPEED);
    this.level.set(on ? place.gain * mix * swim : 0, now);
    this.cutoff.set(clamp(place.cutoff, 250, 18000), now);
    this.pan.set(clamp(place.pan, -1, 1), now);
    this.lapGain.set(SWIM_LAYERS.lap * (0.6 + 0.4 * sp), now);
    this.sloshGain.set(SWIM_LAYERS.slosh * (0.35 + 0.65 * sp), now);
    this.washGain.set(SWIM_LAYERS.wash * sp * sp, now);
    if (!on || !this.gate.isRunning) {
      this.nextCluck = now + 0.3;
      return;
    }
    // Wavelets clucking against the flanks, scheduled one ahead.
    if (this.nextCluck < now + 0.1) {
      const t = Math.max(this.nextCluck, now + 0.02);
      const rng = this.rng;
      const peak = SWIM_LAYERS.cluck * (0.45 + 0.55 * rng()) * (0.6 + 0.4 * sp);
      this.cluckBp.frequency.setValueAtTime(randRange(rng, 420, 900), t);
      const g = this.cluck.gain;
      g.setTargetAtTime(peak, t, 0.012 + 0.012 * rng());
      g.setTargetAtTime(0, t + 0.035, 0.05 + 0.06 * rng());
      this.nextCluck = t + randRange(rng, 0.25, 1.3) * (1 - 0.45 * sp);
    }
  }

  dispose(now: number): void {
    this.gate.dispose(now);
    for (const n of this.nodes) {
      n.disconnect();
    }
  }
}
