import { SourceGate, loopSource } from '../dsp/gate';
import { clamp01, smoothstep } from '../dsp/math';
import type { NoiseBank } from '../dsp/noise';
import { SmoothParam } from '../dsp/param';
import type { Rng } from '../dsp/rng';
import type { SampleBank } from '../samples';

/** Recorded wash level (same loop RMS as the noise): ~4 LU under the synthesized wash, which drowned the calm mix. */
const RECORDED_WASH = 0.39;
/** Rain-on-water hiss at full rain right over the sea (first pass, to be balanced by ear with the `rain` analysis case). */
const RAIN_ON_SEA = 0.16;

/**
 * Rain bed (weather). Two layers, started only while audible:
 *  wash    rain on the roofs, streets and the sea around: the recorded beds (public/audio/rain/: kyles 450360 for
 *          light rain, TRP 574296 for heavy rain, crossfaded by intensity, low-passed softer when light); pink noise
 *          band-limited to 350 Hz - 6 kHz, L/R decorrelated, while the recordings are unavailable
 *  patter  drops hitting the dragon, the saddle and the rider's hood: sparse crackle grains through a bright
 *          band-pass; loudest in first person, thinned out at speed where the airstream masks it
 *  sea     rain on open water close below (phase 21 stage 6): the soft, bright hiss of countless drops on the sea
 *          (pink noise band-passed around 5 kHz, L/R decorrelated) on top of the wash, while the listener is low over
 *          the water
 */
export class RainVoice {
  private readonly washGain: SmoothParam;
  private readonly patterGain: SmoothParam;
  private readonly heavyGain: SmoothParam;
  private readonly lightGain: SmoothParam;
  private readonly recCut: SmoothParam;
  private readonly washGate: SourceGate;
  private readonly patterGate: SourceGate;
  private readonly seaGain: SmoothParam;
  private readonly seaGate: SourceGate;
  private readonly nodes: AudioNode[] = [];
  /** The running wash plays the recordings. */
  private recorded = false;

  constructor(
    ctx: BaseAudioContext,
    noise: NoiseBank,
    destination: AudioNode,
    rng: Rng,
    private readonly samples: SampleBank | null = null,
  ) {
    const node = <T extends AudioNode>(n: T): T => {
      this.nodes.push(n);
      return n;
    };
    const washOut = node(ctx.createGain());
    washOut.gain.value = 0;
    washOut.connect(destination);
    this.washGain = new SmoothParam(washOut.gain, 0, 0.8);
    const washInputs: AudioNode[] = [];
    for (let side = -1; side <= 1; side += 2) {
      const hp = node(ctx.createBiquadFilter());
      hp.type = 'highpass';
      hp.frequency.value = 350;
      const lp = node(ctx.createBiquadFilter());
      lp.type = 'lowpass';
      lp.frequency.value = 6000;
      const pan = node(ctx.createStereoPanner());
      pan.pan.value = side * 0.7;
      hp.connect(lp).connect(pan).connect(washOut);
      washInputs.push(hp);
    }
    const recHp = node(ctx.createBiquadFilter());
    recHp.type = 'highpass';
    recHp.frequency.value = 110;
    const recLp = node(ctx.createBiquadFilter());
    recLp.type = 'lowpass';
    recLp.frequency.value = 9000;
    const heavyIn = node(ctx.createGain());
    const lightIn = node(ctx.createGain());
    heavyIn.connect(recHp);
    lightIn.connect(recHp);
    recHp.connect(recLp).connect(washOut);
    this.heavyGain = new SmoothParam(heavyIn.gain, 0, 0.8);
    this.lightGain = new SmoothParam(lightIn.gain, 1, 0.8);
    this.recCut = new SmoothParam(recLp.frequency, 9000, 0.8);
    this.washGate = new SourceGate((t) => {
      const heavy = samples?.rainHeavy;
      const light = samples?.rainLight;
      this.recorded = !!(heavy && light);
      if (heavy && light) {
        const a = loopSource(ctx, heavy, t, 1, rng);
        const b = loopSource(ctx, light, t, 1, rng);
        a.connect(heavyIn);
        b.connect(lightIn);
        return [a, b];
      }
      return washInputs.map((input, i) => {
        const s = loopSource(ctx, noise.pink, t, 0.92 + 0.12 * i, rng);
        s.connect(input);
        return s;
      });
    }, 3);

    const patterOut = node(ctx.createGain());
    patterOut.gain.value = 0;
    patterOut.connect(destination);
    this.patterGain = new SmoothParam(patterOut.gain, 0, 0.5);
    const bp = node(ctx.createBiquadFilter());
    bp.type = 'bandpass';
    bp.frequency.value = 3200;
    bp.Q.value = 0.6;
    bp.connect(patterOut);
    this.patterGate = new SourceGate((t) => {
      const a = loopSource(ctx, noise.crackle, t, 1.7 + rng() * 0.3, rng);
      const b = loopSource(ctx, noise.crackle, t, 2.3 + rng() * 0.3, rng);
      a.connect(bp);
      b.connect(bp);
      return [a, b];
    }, 3);

    const seaOut = node(ctx.createGain());
    seaOut.gain.value = 0;
    seaOut.connect(destination);
    this.seaGain = new SmoothParam(seaOut.gain, 0, 1.2);
    const seaInputs: AudioNode[] = [];
    for (let side = -1; side <= 1; side += 2) {
      const hp = node(ctx.createBiquadFilter());
      hp.type = 'highpass';
      hp.frequency.value = 1800;
      const band = node(ctx.createBiquadFilter());
      band.type = 'bandpass';
      band.frequency.value = side < 0 ? 4600 : 5400;
      band.Q.value = 0.45;
      const pan = node(ctx.createStereoPanner());
      pan.pan.value = side * 0.6;
      hp.connect(band).connect(pan).connect(seaOut);
      seaInputs.push(hp);
    }
    this.seaGate = new SourceGate(
      (t) =>
        seaInputs.map((input, i) => {
          const s = loopSource(ctx, noise.pink, t, 1.07 + 0.09 * i, rng);
          s.connect(input);
          return s;
        }),
      3,
    );
  }

  /**
   * `rain` 0..1, `pov` 0..1 (first-person blend), `airspeed` m/s of the listener's airflow, `sea` 0..1 open water close
   * below the listener (the rain-on-water hiss).
   */
  update(rain: number, pov: number, airspeed: number, now: number, sea = 0): void {
    const r = clamp01(rain);
    const masked = 1 / (1 + (Math.max(airspeed, 0) / 45) ** 2);
    // While the recordings decode (a fraction of a second after the rain starts) the wash waits instead of synthesizing.
    const waiting = !this.recorded && !this.samples?.rainHeavy && !!this.samples?.pending('rain');
    const recorded = this.recorded || (!this.washGate.isRunning && !!this.samples?.rainHeavy);
    const wash = waiting ? 0 : 0.5 * Math.pow(r, 0.8) * (0.55 + 0.45 * masked) * (recorded ? RECORDED_WASH : 1);
    const patter = 0.9 * r * (0.35 + 0.65 * pov) * (0.4 + 0.6 * masked);
    // Equal-power crossfade from the light bed to the heavy one; light rain is also darker.
    const heavy = smoothstep(0.25, 0.85, r);
    this.heavyGain.set(Math.sin(heavy * Math.PI * 0.5), now);
    this.lightGain.set(Math.cos(heavy * Math.PI * 0.5), now);
    this.recCut.set(5500 + 6500 * r, now);
    this.washGain.set(wash, now);
    this.patterGain.set(patter, now);
    this.washGate.update(wash > 1e-3, now);
    this.patterGate.update(patter > 1e-3, now);
    const seaHiss = RAIN_ON_SEA * Math.pow(r, 0.9) * clamp01(sea) * (0.5 + 0.5 * masked);
    this.seaGain.set(seaHiss, now);
    this.seaGate.update(seaHiss > 1e-3, now);
  }

  dispose(now: number): void {
    this.washGate.dispose(now);
    this.patterGate.dispose(now);
    this.seaGate.dispose(now);
    for (const n of this.nodes) {
      n.disconnect();
    }
  }
}
