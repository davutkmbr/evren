import type { NoiseBank } from '../dsp/noise';
import type { Rng } from '../dsp/rng';

/** Shared resources for synthesizing one-shots on any BaseAudioContext (realtime or offline). */
export interface SfxEnv {
  readonly ctx: BaseAudioContext;
  readonly noise: NoiseBank;
  readonly rng: Rng;
  /** Dry destination bus. */
  readonly out: AudioNode;
  /** Reverb send input. */
  readonly reverb: AudioNode;
  readonly stats: VoiceStats;
}

export interface VoiceStats {
  active: number;
  started: number;
}

/** How a sound source sits relative to the listener. Computed once when a one-shot starts. */
export interface Placement {
  /** Distance attenuation (linear). */
  gain: number;
  /** -1 (left) .. 1 (right). */
  pan: number;
  /** Air absorption / directivity low-pass (Hz). */
  cutoff: number;
  /** Reverb send level (linear). */
  reverb: number;
  /** 0 = distant, 1 = the listener sits on the source (POV rider): more sub-bass and body. */
  closeness: number;
  /** Stereo spread multiplier for multi-part sounds (0 = mono, 1 = full). */
  width: number;
  /** Propagation delay (s). */
  delay: number;
}

const SUBSONIC_HZ = 32;

export function placement(partial: Partial<Placement> = {}): Placement {
  return { gain: 1, pan: 0, cutoff: 20000, reverb: 0.25, closeness: 0, width: 0.6, delay: 0, ...partial };
}

/**
 * Builds a one-shot voice: every node it creates is tracked and disconnected when the voice ends.
 * Output stage: stereo sum -> subsonic high-pass -> air-absorption low-pass -> balance pan -> dry bus (+ reverb send).
 */
export class Voice {
  readonly t: number;
  /** Stereo summing input of the output stage. */
  readonly input: GainNode;
  private readonly nodes: AudioNode[] = [];
  private readonly sources: AudioScheduledSourceNode[] = [];
  private readonly stopTimes: number[] = [];
  private finished = false;

  constructor(
    readonly env: SfxEnv,
    readonly place: Placement,
    when: number,
    level: number,
  ) {
    const ctx = env.ctx;
    this.t = Math.max(when, ctx.currentTime) + place.delay;
    this.input = this.gain(level * place.gain);
    // Nothing a one-shot makes below ~30 Hz is audible on laptop speakers or earbuds; it only costs headroom.
    const hp = this.filter('highpass', SUBSONIC_HZ, 0.7);
    const lp = this.filter('lowpass', Math.min(place.cutoff, ctx.sampleRate * 0.45), 0.5);
    const pan = ctx.createStereoPanner();
    pan.pan.value = clampPan(place.pan);
    this.nodes.push(pan);
    this.input.connect(hp).connect(lp).connect(pan).connect(env.out);
    if (place.reverb > 0) {
      const send = this.gain(place.reverb);
      pan.connect(send).connect(env.reverb);
    }
    env.stats.active++;
    env.stats.started++;
  }

  get ctx(): BaseAudioContext {
    return this.env.ctx;
  }

  gain(value = 1): GainNode {
    const g = this.env.ctx.createGain();
    g.gain.value = value;
    this.nodes.push(g);
    return g;
  }

  filter(type: BiquadFilterType, frequency: number, q = 0.707, gainDb = 0): BiquadFilterNode {
    const f = this.env.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = Math.min(frequency, this.env.ctx.sampleRate * 0.49);
    f.Q.value = q;
    f.gain.value = gainDb;
    this.nodes.push(f);
    return f;
  }

  delay(seconds: number, max = 3): DelayNode {
    const d = this.env.ctx.createDelay(max);
    d.delayTime.value = seconds;
    this.nodes.push(d);
    return d;
  }

  panner(pan: number): StereoPannerNode {
    const p = this.env.ctx.createStereoPanner();
    p.pan.value = clampPan(pan);
    this.nodes.push(p);
    return p;
  }

  shaper(curve: Float32Array<ArrayBuffer>, oversample: OverSampleType = '2x'): WaveShaperNode {
    const s = this.env.ctx.createWaveShaper();
    s.curve = curve;
    s.oversample = oversample;
    this.nodes.push(s);
    return s;
  }

  /** Oscillator starting at t + start; `length` (s) stops it early instead of at the voice end. */
  osc(type: OscillatorType, frequency: number, start = 0, detune = 0, length = Infinity): OscillatorNode {
    const o = this.env.ctx.createOscillator();
    o.type = type;
    o.frequency.value = frequency;
    o.detune.value = detune;
    o.start(this.t + start);
    this.track(o, this.t + start + length);
    return o;
  }

  private track(node: AudioScheduledSourceNode, stopAt = Infinity): void {
    this.nodes.push(node);
    this.sources.push(node);
    this.stopTimes.push(stopAt);
  }

  /** Control signal source (e.g. a shared pitch contour feeding several oscillators). */
  constant(offset: number): ConstantSourceNode {
    const c = this.env.ctx.createConstantSource();
    c.offset.value = offset;
    c.start(this.t);
    this.track(c);
    return c;
  }

  /** Looping noise source starting at a random offset. */
  noise(buffer: AudioBuffer, start = 0, rate = 1): AudioBufferSourceNode {
    const s = this.env.ctx.createBufferSource();
    s.buffer = buffer;
    s.loop = true;
    s.playbackRate.value = rate;
    s.start(this.t + start, this.env.rng() * buffer.duration);
    this.track(s);
    return s;
  }

  /** Mono source -> panned (relative to the voice) into the stereo input. */
  toInput(node: AudioNode, pan = 0): void {
    if (pan === 0) {
      node.connect(this.input);
      return;
    }
    node.connect(this.panner(pan * this.place.width)).connect(this.input);
  }

  /** Stops every source at t + duration and releases all nodes afterwards. */
  end(duration: number): void {
    if (this.finished) {
      return;
    }
    this.finished = true;
    const stopAt = this.t + duration;
    let remaining = this.sources.length;
    const release = (): void => {
      remaining--;
      if (remaining > 0) {
        return;
      }
      for (const n of this.nodes) {
        n.disconnect();
      }
      this.env.stats.active--;
    };
    if (remaining === 0) {
      release();
      return;
    }
    for (let i = 0; i < this.sources.length; i++) {
      const s = this.sources[i];
      s.onended = release;
      s.stop(Math.min(stopAt, this.stopTimes[i]));
    }
  }
}

function clampPan(p: number): number {
  return p < -1 ? -1 : p > 1 ? 1 : p;
}
