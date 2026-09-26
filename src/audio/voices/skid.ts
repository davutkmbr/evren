import { SourceGate, loopSource } from '../dsp/gate';
import { clamp01, smoothstep } from '../dsp/math';
import type { NoiseBank } from '../dsp/noise';
import { SmoothParam } from '../dsp/param';
import { mulberry32, type Rng } from '../dsp/rng';

/**
 * The braking skid of a run-out: claws raking the ground. Three synthesised layers, all driven by one intensity
 * (skid × ground speed): a grinding scrape (band-passed white noise whose centre rises with speed), claw catches
 * (the crackle buffer, high-passed) and a low body drag (brown noise). Sources run only while it is audible.
 */
export class SkidVoice {
  private readonly nodes: AudioNode[] = [];
  private readonly gate: SourceGate;
  private readonly level: SmoothParam;
  private readonly cutoff: SmoothParam;
  private readonly pan: SmoothParam;
  private readonly grindFreq: SmoothParam;
  private readonly grindGain: SmoothParam;
  private readonly clawGain: SmoothParam;
  private readonly dragGain: SmoothParam;
  private readonly clawRate: SmoothParam;
  private readonly rng: Rng;

  constructor(
    private readonly ctx: BaseAudioContext,
    noise: NoiseBank,
    out: AudioNode,
    seed = 23,
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
    lp.frequency.value = 9000;
    const pan = node(ctx.createStereoPanner());
    master.connect(lp).connect(pan).connect(out);
    this.level = new SmoothParam(master.gain, 0, 0.08);
    this.cutoff = new SmoothParam(lp.frequency, 9000, 0.1);
    this.pan = new SmoothParam(pan.pan, 0, 0.1);

    const grindBp = node(ctx.createBiquadFilter());
    grindBp.type = 'bandpass';
    grindBp.Q.value = 0.9;
    grindBp.frequency.value = 1400;
    const grind = node(ctx.createGain());
    grind.gain.value = 0;
    grindBp.connect(grind).connect(master);
    this.grindFreq = new SmoothParam(grindBp.frequency, 1400, 0.15);
    this.grindGain = new SmoothParam(grind.gain, 0, 0.08);

    const clawHp = node(ctx.createBiquadFilter());
    clawHp.type = 'highpass';
    clawHp.frequency.value = 1800;
    const claw = node(ctx.createGain());
    claw.gain.value = 0;
    clawHp.connect(claw).connect(master);
    this.clawGain = new SmoothParam(claw.gain, 0, 0.08);

    const dragLp = node(ctx.createBiquadFilter());
    dragLp.type = 'lowpass';
    dragLp.frequency.value = 260;
    const drag = node(ctx.createGain());
    drag.gain.value = 0;
    dragLp.connect(drag).connect(master);
    this.dragGain = new SmoothParam(drag.gain, 0, 0.1);

    // The claw layer's playback rate follows the speed (more catches per second when faster); bound on each start.
    const rateHolder = node(ctx.createConstantSource());
    this.clawRate = new SmoothParam(rateHolder.offset, 1, 0.15);

    this.gate = new SourceGate((t) => {
      const g = loopSource(ctx, noise.white, t, 1, this.rng);
      g.connect(grindBp);
      const c = loopSource(ctx, noise.crackle, t, this.clawRate.value, this.rng);
      this.clawRate.bind(c.playbackRate);
      c.connect(clawHp);
      const d = loopSource(ctx, noise.brown, t, 1, this.rng);
      d.connect(dragLp);
      return [g, c, d];
    }, 1.5);
  }

  /**
   * @param skid 0..1 braking skid (pose.skid)
   * @param speed ground speed (m/s)
   */
  update(skid: number, speed: number, gain: number, pan: number, cutoff: number, now: number): void {
    const k = clamp01(skid) * smoothstep(1.5, 16, speed);
    const active = k > 0.02 && gain > 1e-4;
    this.gate.update(active, now);
    this.level.set(active ? gain * Math.pow(k, 0.8) : 0, now);
    this.pan.set(pan, now);
    this.cutoff.set(cutoff, now);
    if (!active) {
      return;
    }
    const s = smoothstep(2, 22, speed);
    this.grindFreq.set(900 + 1600 * s, now);
    this.grindGain.set(0.55 + 0.35 * s, now);
    this.clawGain.set(0.5 + 0.3 * (1 - s), now);
    this.dragGain.set(0.7 + 0.5 * s, now);
    this.clawRate.set(0.7 + 0.9 * s, now);
  }

  dispose(): void {
    this.gate.dispose(this.ctx.currentTime);
    for (const n of this.nodes) {
      n.disconnect();
    }
  }
}
