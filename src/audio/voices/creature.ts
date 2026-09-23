import { SourceGate, loopSource } from '../dsp/gate';
import { SmoothParam } from '../dsp/param';
import type { NoiseBank } from '../dsp/noise';
import { mulberry32, randRange, type Rng } from '../dsp/rng';

const POINTS = 64;

/**
 * The dragon's breathing while it stands, walks or swims (in flight the wind masks it): slow nasal inhale,
 * longer throaty exhale with a faint rumble. Each breath is a scheduled envelope curve (not per frame);
 * exertion shortens the cycle and makes it louder (panting after hard flight).
 */
export class CreatureVoice {
  private readonly nodes: AudioNode[] = [];
  private readonly gate: SourceGate;
  private readonly airGain: GainNode;
  private readonly airBp: BiquadFilterNode;
  private readonly rumbleGain: GainNode;
  private readonly level: SmoothParam;
  private readonly cutoff: SmoothParam;
  private readonly pan: SmoothParam;
  private readonly inhale = new Float32Array(POINTS);
  private readonly exhale = new Float32Array(POINTS);
  private readonly inhaleF = new Float32Array(POINTS);
  private readonly exhaleF = new Float32Array(POINTS);
  private readonly exhaleRumble = new Float32Array(POINTS);
  private readonly silence = new Float32Array(POINTS);
  private readonly rng: Rng;
  private next = 0;
  private exhaling = false;

  constructor(
    private readonly ctx: BaseAudioContext,
    noise: NoiseBank,
    out: AudioNode,
    seed = 11,
  ) {
    this.rng = mulberry32(seed);
    const node = <T extends AudioNode>(n: T): T => {
      this.nodes.push(n);
      return n;
    };
    const master = node(ctx.createGain());
    master.gain.value = 0;
    const lp = node(ctx.createBiquadFilter());
    lp.type = 'lowpass';
    lp.frequency.value = 8000;
    const pan = node(ctx.createStereoPanner());
    master.connect(lp).connect(pan).connect(out);
    this.level = new SmoothParam(master.gain, 0, 0.25);
    this.cutoff = new SmoothParam(lp.frequency, 8000, 0.1);
    this.pan = new SmoothParam(pan.pan, 0, 0.1);

    this.airBp = node(ctx.createBiquadFilter());
    this.airBp.type = 'bandpass';
    this.airBp.Q.value = 1.1;
    this.airBp.frequency.value = 500;
    this.airGain = node(ctx.createGain());
    this.airGain.gain.value = 0;
    this.airBp.connect(this.airGain).connect(master);

    const rLp = node(ctx.createBiquadFilter());
    rLp.type = 'lowpass';
    rLp.frequency.value = 140;
    this.rumbleGain = node(ctx.createGain());
    this.rumbleGain.gain.value = 0;
    const rAm = node(ctx.createGain());
    rAm.gain.value = 0.7;
    const growlDepth = node(ctx.createGain());
    growlDepth.gain.value = 0.3;
    growlDepth.connect(rAm.gain);
    const rHp = node(ctx.createBiquadFilter());
    rHp.type = 'highpass';
    rHp.frequency.value = 38;
    rHp.Q.value = 0.7;
    rLp.connect(rAm).connect(this.rumbleGain).connect(rHp).connect(master);

    this.gate = new SourceGate((t) => {
      const growl = ctx.createOscillator();
      growl.frequency.value = 19;
      growl.connect(growlDepth);
      growl.start(t);
      const air = loopSource(ctx, noise.pink, t, 0.9, this.rng);
      air.connect(this.airBp);
      const rumble = loopSource(ctx, noise.brown, t, 1, this.rng);
      rumble.connect(rLp);
      return [growl, air, rumble];
    }, 3);

    for (let i = 0; i < POINTS; i++) {
      const x = i / (POINTS - 1);
      this.inhale[i] = Math.pow(Math.sin(Math.PI * Math.pow(x, 0.8)), 1.6);
      this.exhale[i] = Math.pow(Math.sin(Math.PI * Math.pow(x, 0.55)), 1.3);
      this.inhaleF[i] = 650 + 350 * x;
      this.exhaleF[i] = 520 - 240 * x;
      this.exhaleRumble[i] = this.exhale[i] * 0.9;
    }
    this.inhale[POINTS - 1] = 0;
    this.exhale[POINTS - 1] = 0;
    this.exhaleRumble[POINTS - 1] = 0;
  }

  /**
   * @param active dragon on the ground / in water
   * @param exertion 0..1 (pose.breath): faster, louder breaths
   */
  update(active: boolean, exertion: number, gain: number, pan: number, cutoff: number, now: number): void {
    this.gate.update(active && gain > 1e-4, now);
    this.level.set(active ? gain * (0.55 + 0.6 * exertion) : 0, now);
    this.pan.set(pan, now);
    this.cutoff.set(cutoff, now);
    if (!active) {
      this.next = Math.max(this.next, now);
      return;
    }
    if (this.next > now + 0.3) {
      return;
    }
    const start = Math.max(this.next + 0.002, now + 0.02);
    const period = 4.2 - 2.6 * exertion;
    if (this.exhaling) {
      const dur = period * randRange(this.rng, 0.52, 0.6);
      this.airGain.gain.setValueCurveAtTime(this.exhale, start, dur);
      this.airBp.frequency.setValueCurveAtTime(this.exhaleF, start, dur);
      this.rumbleGain.gain.setValueCurveAtTime(this.exhaleRumble, start, dur);
      this.next = start + dur + randRange(this.rng, 0.3, 0.9) * (1 - exertion * 0.8);
    } else {
      const dur = period * randRange(this.rng, 0.36, 0.42);
      this.airGain.gain.setValueCurveAtTime(this.inhale, start, dur);
      this.airBp.frequency.setValueCurveAtTime(this.inhaleF, start, dur);
      this.rumbleGain.gain.setValueCurveAtTime(this.silence, start, dur);
      this.next = start + dur + 0.08;
    }
    this.exhaling = !this.exhaling;
  }

  dispose(): void {
    this.gate.dispose(this.ctx.currentTime);
    for (const n of this.nodes) {
      n.disconnect();
    }
  }
}
