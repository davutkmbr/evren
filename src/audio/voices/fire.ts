import { SmoothParam } from '../dsp/param';
import type { NoiseBank } from '../dsp/noise';
import type { Rng } from '../dsp/rng';
import { Voice, placement, type SfxEnv, type VoiceStats } from '../sfx/voice';

/**
 * Fire-breath loop. A persistent placement stage (gain / air-absorption LP / pan / reverb send) follows the
 * dragon's mouth relative to the listener every frame; each burst builds its own source graph (event-driven,
 * not per frame) so overlapping stop/start fades never click:
 *  core    pink -> 70-900 Hz band + a brown sub layer, turbulent AM (burner roar), 7-12 Hz combustion throb
 *  jet     pink -> band-pass ~1.7 kHz (the gas jet whoosh)
 *  hiss    white -> high-pass (pressurized flow)
 *  crackle sparse pop buffer, rate-varied, high-passed (burning debris)
 */
export class FireVoice {
  private readonly stageIn: GainNode;
  private readonly send: GainNode;
  private readonly gain: SmoothParam;
  private readonly cutoff: SmoothParam;
  private readonly pan: SmoothParam;
  private readonly reverb: SmoothParam;
  private readonly env: SfxEnv;
  private burst: { voice: Voice; amp: GainNode } | null = null;
  private readonly nodes: AudioNode[];

  active = false;

  constructor(
    private readonly ctx: BaseAudioContext,
    noise: NoiseBank,
    rng: Rng,
    out: AudioNode,
    reverbSend: AudioNode,
    stats: VoiceStats,
  ) {
    this.stageIn = ctx.createGain();
    const level = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.5;
    lp.frequency.value = 16000;
    const pan = ctx.createStereoPanner();
    this.send = ctx.createGain();
    this.send.gain.value = 0.3;
    this.stageIn.connect(level).connect(lp).connect(pan).connect(out);
    pan.connect(this.send).connect(reverbSend);
    this.gain = new SmoothParam(level.gain, 1, 0.05);
    this.cutoff = new SmoothParam(lp.frequency, 16000, 0.05);
    this.pan = new SmoothParam(pan.pan, 0, 0.05);
    this.reverb = new SmoothParam(this.send.gain, 0.3, 0.1);
    this.nodes = [this.stageIn, level, lp, pan, this.send];
    const sink = ctx.createGain();
    sink.connect(this.stageIn);
    this.nodes.push(sink);
    this.env = { ctx, noise, rng, out: sink, reverb: sink, stats };
  }

  /** Placement of the mouth relative to the listener (updated per frame, cheap). */
  place(gain: number, pan: number, cutoff: number, reverb: number, now: number): void {
    this.gain.set(gain, now);
    this.pan.set(pan, now);
    this.cutoff.set(Math.min(cutoff, this.ctx.sampleRate * 0.45), now);
    this.reverb.set(reverb, now);
  }

  start(now: number, intensity = 1): void {
    if (this.active) {
      return;
    }
    this.active = true;
    const v = new Voice(this.env, placement({ reverb: 0, width: 0.7 }), now, 1);
    const { noise } = this.env;
    const rng = this.env.rng;
    const t = v.t;
    const amp = v.gain(0);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(intensity, t + 0.14);
    v.toInput(amp);

    const core = v.noise(noise.pink);
    const coreLp = v.filter('lowpass', 900, 0.7);
    const coreHp = v.filter('highpass', 70, 0.6);
    const coreAm = v.gain(0.75);
    const turb = v.noise(noise.buffet, 0, 2.1 + rng() * 0.6);
    const turbDepth = v.gain(0.4);
    turb.connect(turbDepth).connect(coreAm.gain);
    const throb = v.osc('sine', 7 + rng() * 5);
    const throbDepth = v.gain(0.14);
    throb.connect(throbDepth).connect(coreAm.gain);
    const coreG = v.gain(1.6);
    core.connect(coreHp).connect(coreLp).connect(coreAm).connect(coreG).connect(amp);
    const rumble = v.noise(noise.brown);
    const rumbleLp = v.filter('lowpass', 180, 0.7);
    const rumbleHp = v.filter('highpass', 42, 0.7);
    const rumbleG = v.gain(0.55);
    rumble.connect(rumbleHp).connect(rumbleLp).connect(rumbleG).connect(coreAm);

    for (let side = -1; side <= 1; side += 2) {
      const jet = v.noise(noise.pink, 0, side < 0 ? 1 : 0.97);
      const jetBp = v.filter('bandpass', side < 0 ? 1550 : 1850, 0.6);
      const jetG = v.gain(0.6);
      turbDepth.connect(jetG.gain);
      jet.connect(jetBp).connect(jetG);
      jetG.connect(v.panner(side * 0.35)).connect(amp);
    }

    const hiss = v.noise(noise.white);
    const hissHp = v.filter('highpass', 4500, 0.6);
    const hissG = v.gain(0.16);
    hiss.connect(hissHp).connect(hissG).connect(amp);

    for (let side = -1; side <= 1; side += 2) {
      const crackle = v.noise(noise.crackle, 0, 0.85 + rng() * 0.3);
      const crackHp = v.filter('highpass', 1100, 0.7);
      const crackG = v.gain(0.42);
      crackle.connect(crackHp).connect(crackG);
      crackG.connect(v.panner(side * 0.6)).connect(amp);
    }

    this.burst = { voice: v, amp };
  }

  stop(now: number): void {
    if (!this.active || !this.burst) {
      this.active = false;
      return;
    }
    this.active = false;
    const { voice, amp } = this.burst;
    this.burst = null;
    const t = Math.max(now, voice.t + 0.14);
    amp.gain.setTargetAtTime(0, t, 0.11);
    voice.end(t - voice.t + 0.9);
  }

  dispose(): void {
    this.stop(this.ctx.currentTime);
    for (const n of this.nodes) {
      n.disconnect();
    }
  }
}
