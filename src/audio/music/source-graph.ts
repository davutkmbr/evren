/**
 * Moment music source graph (Web Audio, thin): applies a SourceMix (./moment-source.ts) to the moment piece. Built on
 * the first moment piece and torn down after it has been idle for a while, so no node runs while no source is near.
 *
 *   input ─┬─ world: hp → lp (kind top) → peak (resonance) → shaper (saturation) → air lp (distance, wind, opening)
 *          │         → level ─┬─ pan ───────────────────────────────→ output
 *          │                  ├─ spread (short delay, opposite pan) ─→ output      (image width)
 *          │                  ├─ room send → room convolver ────────→ output      (street / tent room)
 *          │                  └─ open-air send → the city's reverb (master bus reverbSend: distance tail)
 *          └─ memory: wow / flutter delay → hp → lp → high shelf → dry (pan toward `from`) → output
 *                                                              └→ hall send → hall convolver → output
 *   output → the player's moment output (volume, menu duck) → master bus `music` (the under-water muffle)
 *
 * The world and memory branches cross-fade with equal power; every parameter moves with setTargetAtTime, so a new
 * mix each frame never clicks. The saturation is a fixed gentle curve blended in by a wet / dry pair.
 */
import { generateImpulseData, impulseFromData, type ImpulseOptions } from '../dsp/impulse';
import { clamp, finiteOr } from '../dsp/math';
import { MEMORY_CHAIN, WORLD_CHAINS, isWorldKind, type MusicSourceKind, type SourceMix } from './moment-source';

/** A short room with the street's facades answering (coffeehouse, gramophone window, ferry deck). */
const STREET_ROOM: ImpulseOptions = {
  seconds: 1,
  rt60: 0.7,
  brightness: 3200,
  // Facades 7–18 m across the street: 20–55 ms slaps.
  echoes: [
    [0.021, 0.34],
    [0.034, 0.27],
    [0.052, 0.2],
  ],
  seed: 17,
};
/** A warm small room (a tent, a meyhane with a band). */
const TENT_ROOM: ImpulseOptions = { seconds: 1.2, rt60: 0.9, brightness: 5200, echoes: [[0.016, 0.18]], seed: 23 };
/** The memory hall: large and airy, a long soft tail. */
const MEMORY_HALL: ImpulseOptions = { seconds: 5, rt60: 4.2, brightness: 3600, echoes: [], seed: 41 };

const IR_CACHE = new Map<string, AudioBuffer | null>();

/** Parameter smoothing (s) of the per-frame mix. */
const TAU = 0.12;

function satCurve(): Float32Array<ArrayBuffer> {
  const n = 1024;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(2.2 * x) / Math.tanh(2.2);
  }
  return c;
}

export class SourceGraph {
  readonly input: GainNode;
  private readonly nodes: AudioNode[] = [];
  private readonly sources: AudioScheduledSourceNode[] = [];
  private readonly worldIn: GainNode;
  private readonly hp: BiquadFilterNode;
  private readonly lp: BiquadFilterNode;
  private readonly peak: BiquadFilterNode;
  private readonly satDry: GainNode;
  private readonly satWet: GainNode;
  private readonly airLp: BiquadFilterNode;
  private readonly level: GainNode;
  private readonly pan: StereoPannerNode;
  private readonly spreadGain: GainNode;
  private readonly spreadPan: StereoPannerNode;
  private readonly roomSend: GainNode;
  private readonly room: ConvolverNode;
  private readonly openAirSend: GainNode | null;
  private readonly memIn: GainNode;
  private readonly memLp: BiquadFilterNode;
  private readonly memDry: GainNode;
  private readonly memPan: StereoPannerNode;
  private readonly memHall: GainNode;
  private kind: MusicSourceKind | null = null;
  private roomIr: 'street' | 'tent' | null = null;

  constructor(
    private readonly ctx: BaseAudioContext,
    output: AudioNode,
    openAir: AudioNode | null,
  ) {
    const n = <T extends AudioNode>(node: T): T => {
      this.nodes.push(node);
      return node;
    };
    const gain = (v: number): GainNode => {
      const g = n(ctx.createGain());
      g.gain.value = v;
      return g;
    };
    const filter = (type: BiquadFilterType, f: number, q = 0.707, g = 0): BiquadFilterNode => {
      const b = n(ctx.createBiquadFilter());
      b.type = type;
      b.frequency.value = Math.min(f, ctx.sampleRate * 0.45);
      b.Q.value = q;
      b.gain.value = g;
      return b;
    };
    this.input = gain(1);
    // World branch.
    this.worldIn = gain(0);
    this.hp = filter('highpass', 100, 0.8);
    this.lp = filter('lowpass', 8000, 0.7);
    this.peak = filter('peaking', 1000, 1, 0);
    const shaper = n(ctx.createWaveShaper());
    shaper.curve = satCurve();
    shaper.oversample = '2x';
    this.satDry = gain(1);
    this.satWet = gain(0);
    const satSum = gain(1);
    this.airLp = filter('lowpass', 16000, 0.5);
    this.level = gain(0);
    this.pan = n(ctx.createStereoPanner());
    const spreadDelay = n(ctx.createDelay(0.05));
    spreadDelay.delayTime.value = 0.013;
    this.spreadGain = gain(0);
    this.spreadPan = n(ctx.createStereoPanner());
    this.roomSend = gain(0);
    this.room = n(ctx.createConvolver());
    this.room.normalize = false;
    this.input.connect(this.worldIn).connect(this.hp).connect(this.lp).connect(this.peak);
    this.peak.connect(this.satDry).connect(satSum);
    this.peak.connect(shaper).connect(this.satWet).connect(satSum);
    satSum.connect(this.airLp).connect(this.level);
    this.level.connect(this.pan).connect(output);
    this.level.connect(spreadDelay).connect(this.spreadGain).connect(this.spreadPan).connect(output);
    this.level.connect(this.roomSend).connect(this.room).connect(output);
    this.openAirSend = openAir ? gain(0) : null;
    if (this.openAirSend && openAir) {
      this.level.connect(this.openAirSend).connect(openAir);
    }
    // Memory branch: wow and flutter as a modulated short delay.
    const m = MEMORY_CHAIN;
    this.memIn = gain(0);
    const wowDelay = n(ctx.createDelay(0.05));
    wowDelay.delayTime.value = 0.012;
    const lfo = (hz: number, depthMs: number): void => {
      const o = ctx.createOscillator();
      o.frequency.value = hz;
      const d = gain(depthMs / 1000);
      o.connect(d).connect(wowDelay.delayTime);
      o.start();
      this.nodes.push(o);
      this.sources.push(o);
    };
    lfo(m.wowHz, m.wowMs);
    lfo(m.flutterHz, m.flutterMs);
    const memHp = filter('highpass', m.hpHz, 0.7);
    this.memLp = filter('lowpass', m.lpHz, 0.6);
    const shelf = filter('highshelf', m.shelfHz, 0.7, m.shelfDb);
    this.memDry = gain(0);
    this.memPan = n(ctx.createStereoPanner());
    this.memHall = gain(0);
    const hall = n(ctx.createConvolver());
    hall.normalize = false;
    hall.buffer = this.ir('hall', MEMORY_HALL);
    this.input.connect(this.memIn).connect(wowDelay).connect(memHp).connect(this.memLp).connect(shelf);
    shelf.connect(this.memDry).connect(this.memPan).connect(output);
    shelf.connect(this.memHall).connect(hall).connect(output);
  }

  /** The impulse responses are generated once per sample rate (a few ms each) and kept across graph rebuilds. */
  private ir(key: string, opts: ImpulseOptions): AudioBuffer | null {
    const k = key + '@' + this.ctx.sampleRate;
    if (!IR_CACHE.has(k)) {
      IR_CACHE.set(k, impulseFromData(this.ctx, generateImpulseData(this.ctx.sampleRate, opts)));
    }
    return IR_CACHE.get(k) ?? null;
  }

  /** Sets the world chain of a kind (filters, saturation, room); instant, called when the source changes. */
  private setKind(kind: MusicSourceKind): void {
    if (kind === this.kind) {
      return;
    }
    this.kind = kind;
    if (!isWorldKind(kind)) {
      return;
    }
    const c = WORLD_CHAINS[kind];
    const now = this.ctx.currentTime;
    this.hp.frequency.setTargetAtTime(c.hpHz, now, 0.05);
    this.lp.frequency.setTargetAtTime(c.lpHz, now, 0.05);
    this.lp.Q.setTargetAtTime(c.lpQ, now, 0.05);
    this.peak.frequency.setTargetAtTime(c.peakHz, now, 0.05);
    this.peak.gain.setTargetAtTime(c.peakDb, now, 0.05);
    this.peak.Q.setTargetAtTime(c.peakQ, now, 0.05);
    this.satWet.gain.setTargetAtTime(c.drive, now, 0.05);
    this.satDry.gain.setTargetAtTime(1 - c.drive * 0.6, now, 0.05);
    if (c.roomIr !== this.roomIr) {
      this.roomIr = c.roomIr;
      this.room.buffer = c.roomIr === 'tent' ? this.ir('tent', TENT_ROOM) : this.ir('street', STREET_ROOM);
    }
  }

  /** Applies one frame's mix (smoothed). */
  apply(mix: SourceMix): void {
    this.setKind(mix.kind);
    const now = this.ctx.currentTime;
    const set = (p: AudioParam, v: number, lo: number, hi: number): void => {
      p.setTargetAtTime(clamp(finiteOr(v, lo), lo, hi), now, TAU);
    };
    const mem = clamp(finiteOr(mix.memory, 1), 0, 1);
    const worldG = isWorldKind(mix.kind) ? Math.cos((mem * Math.PI) / 2) : 0;
    const memG = isWorldKind(mix.kind) ? Math.sin((mem * Math.PI) / 2) : 1;
    set(this.worldIn.gain, worldG, 0, 1);
    set(this.memIn.gain, memG, 0, 1);
    const nyq = this.ctx.sampleRate * 0.45;
    set(this.airLp.frequency, mix.cutoff, 200, nyq);
    set(this.level.gain, mix.level, 0, 4);
    set(this.pan.pan, mix.pan * (1 - 0.5 * mix.width), -1, 1);
    set(this.spreadGain.gain, 0.45 * mix.width, 0, 1);
    set(this.spreadPan.pan, -mix.pan * 0.5 - 0.6 * mix.width * Math.sign(mix.pan || 1), -1, 1);
    set(this.roomSend.gain, mix.room, 0, 2);
    if (this.openAirSend) {
      set(this.openAirSend.gain, mix.openAir, 0, 2);
    }
    set(this.memLp.frequency, mix.memCutoff, 200, nyq);
    set(this.memDry.gain, mix.memLevel * mix.memDry, 0, 4);
    set(this.memHall.gain, mix.memLevel * mix.memHall, 0, 4);
    set(this.memPan.pan, mix.memPan, -1, 1);
  }

  dispose(): void {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    for (const node of this.nodes) {
      node.disconnect();
    }
    this.nodes.length = 0;
  }
}
