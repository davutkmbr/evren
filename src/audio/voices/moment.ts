import { SourceGate, loopSource } from '../dsp/gate';
import { clamp01 } from '../dsp/math';
import type { NoiseBank } from '../dsp/noise';
import { SmoothParam } from '../dsp/param';
import type { Rng } from '../dsp/rng';

/** Level of the moment wind bed at full amount (linear, into the ambience bus). */
export const MOMENT_BED_LEVEL = 0.2;

/**
 * Soft open-air wind bed for calm moments high over the city (src/moments, e.g. the stork migration): a wide, airy
 * band of pink noise (~250–1200 Hz) breathing with slow gusts, with a faint high air layer. It sits under the flight
 * wind, is started only while audible (SourceGate) and swells in and out slowly.
 */
export class MomentBedVoice {
  private readonly level: SmoothParam;
  private readonly gate: SourceGate;
  private readonly nodes: AudioNode[] = [];

  constructor(ctx: BaseAudioContext, noise: NoiseBank, destination: AudioNode, rng: Rng) {
    const node = <T extends AudioNode>(n: T): T => {
      this.nodes.push(n);
      return n;
    };
    const out = node(ctx.createGain());
    out.gain.value = 0;
    out.connect(destination);
    this.level = new SmoothParam(out.gain, 0, 1.6);
    const breath = node(ctx.createGain());
    breath.gain.value = 0.75;
    breath.connect(out);
    const low = node(ctx.createBiquadFilter());
    low.type = 'bandpass';
    low.frequency.value = 520;
    low.Q.value = 0.45;
    const lp = node(ctx.createBiquadFilter());
    lp.type = 'lowpass';
    lp.frequency.value = 1500;
    lp.Q.value = 0.5;
    low.connect(lp).connect(breath);
    const air = node(ctx.createBiquadFilter());
    air.type = 'bandpass';
    air.frequency.value = 3200;
    air.Q.value = 0.7;
    const airGain = node(ctx.createGain());
    airGain.gain.value = 0.12;
    air.connect(airGain).connect(breath);
    this.gate = new SourceGate((t, aux) => {
      const a = loopSource(ctx, noise.pink, t, 0.9, rng);
      a.connect(low);
      const b = loopSource(ctx, noise.white, t, 1, rng);
      b.connect(air);
      // Slow gusts: the bed breathes by ±60 %.
      const mod = loopSource(ctx, noise.gust, t, 0.45, rng);
      const depth = ctx.createGain();
      depth.gain.value = 0.6;
      mod.connect(depth).connect(breath.gain);
      aux.push(depth);
      return [a, b, mod];
    }, 10);
  }

  /** `amount` 0..1 (0 silent). */
  update(amount: number, now: number): void {
    const a = clamp01(amount);
    this.level.set(MOMENT_BED_LEVEL * a, now);
    this.gate.update(a > 1e-3, now);
  }

  dispose(now: number): void {
    this.gate.dispose(now);
    for (const n of this.nodes) {
      n.disconnect();
    }
  }
}
