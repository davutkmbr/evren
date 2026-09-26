import { SourceGate, loopSource } from '../dsp/gate';
import { clamp, clamp01, smoothstep } from '../dsp/math';
import type { NoiseBank } from '../dsp/noise';
import { SmoothParam } from '../dsp/param';
import type { Rng } from '../dsp/rng';
import type { Placement } from '../sfx/voice';

/** Levels of the low-flight sea layers (linear, before the engine's MIX trims and the placement gain). */
export const SEA_LAYERS = {
  /** Continuous rumble of the downwash beating on the water (hover / slow low flight). */
  buffet: 0.55,
  /** Each downstroke's gust slapping the water: a low thump and a spray patter after it. */
  gustThump: 0.9,
  gustPatter: 0.4,
  /** Skim: water tearing along the belly (fast, rough band noise) and the low furrow rush. */
  tear: 0.5,
  furrow: 0.45,
  /** Fire on water: the high sizzling hiss (sputtering) and the bubbling boil under it. */
  hiss: 0.55,
  boil: 0.3,
} as const;

/** Frame input of the sea voice (0..1 intensities from the lowFlight service). */
export interface SeaVoiceParams {
  downwash: number;
  wake: number;
  /** Horizontal speed (m/s): the tearing sound rises with it. */
  speed: number;
  steam: number;
}

/**
 * The sea reacting to low flight (phase 21 stage 2), synthesised:
 *  buffet  brown noise low-passed at ~420 Hz, amplitude-modulated by the buffet control signal (downwash beating)
 *  gust    per downstroke over the water: band-passed pink thump (~260 Hz) and a delayed high spray patter
 *  tear    white noise band-passed 900-2400 Hz (rising with speed), fast AM: water tearing along the belly in a skim
 *  furrow  brown noise low-passed at ~190 Hz: the rush of the furrow
 *  hiss    white noise high-passed at 2.8 kHz with a 6.5 kHz presence peak, sputtered by the crackle buffer: fire on water
 *  boil    brown noise band-passed at ~170 Hz, slowly modulated: the water boiling under the steam
 * The downwash and skim layers share one placed channel at the water under the dragon; the steam has its own at the
 * steam point. Sources run only while a layer is audible (SourceGate); the gust envelopes are scheduled once per
 * downstroke, never per frame. The existing wind voice keeps the airy skim spray hiss (`skim`); this voice adds the water.
 */
export class SeaVoice {
  private readonly nodes: AudioNode[] = [];
  private readonly bodyGate: SourceGate;
  private readonly steamGate: SourceGate;
  private readonly bodyLevel: SmoothParam;
  private readonly bodyCutoff: SmoothParam;
  private readonly bodyPan: SmoothParam;
  private readonly steamLevel: SmoothParam;
  private readonly steamCutoff: SmoothParam;
  private readonly steamPan: SmoothParam;
  private readonly buffetGain: SmoothParam;
  private readonly tearGain: SmoothParam;
  private readonly tearFreq: SmoothParam;
  private readonly furrowGain: SmoothParam;
  private readonly hissGain: SmoothParam;
  private readonly boilGain: SmoothParam;
  private readonly thump: GainNode;
  private readonly patter: GainNode;
  /** Current intensities (for the engine's gust gating and checks). */
  downwash = 0;
  wake = 0;
  steam = 0;

  constructor(
    private readonly ctx: BaseAudioContext,
    noise: NoiseBank,
    out: AudioNode,
    rng: Rng,
  ) {
    const node = <T extends AudioNode>(n: T): T => {
      this.nodes.push(n);
      return n;
    };
    const filter = (type: BiquadFilterType, f: number, q: number, gainDb = 0): BiquadFilterNode => {
      const b = node(ctx.createBiquadFilter());
      b.type = type;
      b.frequency.value = f;
      b.Q.value = q;
      b.gain.value = gainDb;
      return b;
    };
    const gain = (v: number): GainNode => {
      const g = node(ctx.createGain());
      g.gain.value = v;
      return g;
    };
    const channel = (): { master: GainNode; lp: BiquadFilterNode; pan: StereoPannerNode } => {
      const master = gain(0);
      const lp = filter('lowpass', 12000, 0.5);
      const pan = node(ctx.createStereoPanner());
      master.connect(lp).connect(pan).connect(out);
      return { master, lp, pan };
    };

    const body = channel();
    this.bodyLevel = new SmoothParam(body.master.gain, 0, 0.08);
    this.bodyCutoff = new SmoothParam(body.lp.frequency, 12000, 0.15);
    this.bodyPan = new SmoothParam(body.pan.pan, 0, 0.1);

    const buffetLp = filter('lowpass', 420, 0.7);
    const buffetAm = gain(0.5);
    const buffetDepth = gain(0.5);
    buffetDepth.connect(buffetAm.gain);
    const buffetOut = gain(0);
    buffetLp.connect(buffetAm).connect(buffetOut).connect(body.master);
    this.buffetGain = new SmoothParam(buffetOut.gain, 0, 0.12);

    const thumpBp = filter('bandpass', 260, 0.7);
    this.thump = gain(0);
    thumpBp.connect(this.thump).connect(body.master);
    const patterHp = filter('highpass', 2400, 0.6);
    const patterLp = filter('lowpass', 7500, 0.5);
    this.patter = gain(0);
    patterHp.connect(patterLp).connect(this.patter).connect(body.master);

    const tearBp = filter('bandpass', 1300, 0.8);
    const tearAm = gain(0.4);
    const tearDepth = gain(0.6);
    tearDepth.connect(tearAm.gain);
    const tearOut = gain(0);
    tearBp.connect(tearAm).connect(tearOut).connect(body.master);
    this.tearGain = new SmoothParam(tearOut.gain, 0, 0.06);
    this.tearFreq = new SmoothParam(tearBp.frequency, 1300, 0.2);

    const furrowLp = filter('lowpass', 190, 0.8);
    const furrowOut = gain(0);
    furrowLp.connect(furrowOut).connect(body.master);
    this.furrowGain = new SmoothParam(furrowOut.gain, 0, 0.1);

    this.bodyGate = new SourceGate((t) => {
      const buffet = loopSource(ctx, noise.brown, t, 0.9, rng);
      buffet.connect(buffetLp);
      const buffetMod = loopSource(ctx, noise.buffet, t, 0.6, rng);
      buffetMod.connect(buffetDepth);
      const thump = loopSource(ctx, noise.pink, t, 0.8, rng);
      thump.connect(thumpBp);
      const patter = loopSource(ctx, noise.white, t, 1.03, rng);
      patter.connect(patterHp);
      const tear = loopSource(ctx, noise.white, t, 0.94, rng);
      tear.connect(tearBp);
      const tearMod = loopSource(ctx, noise.buffet, t, 2.6, rng);
      tearMod.connect(tearDepth);
      const furrow = loopSource(ctx, noise.brown, t, 1.1, rng);
      furrow.connect(furrowLp);
      return [buffet, buffetMod, thump, patter, tear, tearMod, furrow];
    }, 2);

    const steam = channel();
    this.steamLevel = new SmoothParam(steam.master.gain, 0, 0.08);
    this.steamCutoff = new SmoothParam(steam.lp.frequency, 12000, 0.15);
    this.steamPan = new SmoothParam(steam.pan.pan, 0, 0.1);
    const hissHp = filter('highpass', 2800, 0.6);
    const hissPeak = filter('peaking', 6500, 1.1, 4);
    const hissAm = gain(0.55);
    const hissDepth = gain(0.8);
    hissDepth.connect(hissAm.gain);
    const hissOut = gain(0);
    hissHp.connect(hissPeak).connect(hissAm).connect(hissOut).connect(steam.master);
    this.hissGain = new SmoothParam(hissOut.gain, 0, 0.08);
    const boilBp = filter('bandpass', 170, 1.0);
    const boilAm = gain(0.6);
    const boilDepth = gain(0.4);
    boilDepth.connect(boilAm.gain);
    const boilOut = gain(0);
    boilBp.connect(boilAm).connect(boilOut).connect(steam.master);
    this.boilGain = new SmoothParam(boilOut.gain, 0, 0.15);
    this.steamGate = new SourceGate((t) => {
      const hiss = loopSource(ctx, noise.white, t, 1.0, rng);
      hiss.connect(hissHp);
      const sputter = loopSource(ctx, noise.crackle, t, 1.6, rng);
      sputter.connect(hissDepth);
      const boil = loopSource(ctx, noise.brown, t, 0.7, rng);
      boil.connect(boilBp);
      const boilMod = loopSource(ctx, noise.buffet, t, 0.35, rng);
      boilMod.connect(boilDepth);
      return [hiss, sputter, boil, boilMod];
    }, 2);
  }

  /**
   * Per frame. `body` places the downwash / skim channel (the water under the dragon), `steamAt` the steam channel.
   * `gainBody` / `gainSteam` are the engine's MIX trims.
   */
  update(p: SeaVoiceParams, body: Placement, steamAt: Placement, gainBody: number, gainSteam: number, now: number): void {
    const dw = clamp01(p.downwash);
    const wake = clamp01(p.wake);
    const steam = clamp01(p.steam);
    this.downwash = dw;
    this.wake = wake;
    this.steam = steam;
    const fast = smoothstep(10, 45, Number.isFinite(p.speed) ? p.speed : 0);

    const bodyOn = dw > 1e-3 || wake > 1e-3;
    this.bodyGate.update(bodyOn, now);
    this.bodyLevel.set(bodyOn ? body.gain * gainBody : 0, now);
    this.bodyCutoff.set(clamp(body.cutoff, 250, 18000), now);
    this.bodyPan.set(clamp(body.pan, -1, 1), now);
    this.buffetGain.set(SEA_LAYERS.buffet * dw * dw, now);
    this.tearGain.set(SEA_LAYERS.tear * wake * (0.45 + 0.55 * fast), now);
    this.tearFreq.set(900 + 1500 * fast, now);
    this.furrowGain.set(SEA_LAYERS.furrow * wake * (0.6 + 0.4 * fast), now);

    const steamOn = steam > 1e-3;
    this.steamGate.update(steamOn, now);
    this.steamLevel.set(steamOn ? steamAt.gain * gainSteam : 0, now);
    this.steamCutoff.set(clamp(steamAt.cutoff, 250, 18000), now);
    this.steamPan.set(clamp(steamAt.pan, -1, 1), now);
    this.hissGain.set(SEA_LAYERS.hiss * steam, now);
    this.boilGain.set(SEA_LAYERS.boil * steam, now);
  }

  /** A downstroke's gust hitting the water (strength 0..1 already scaled by the downwash): thump, then spray patter. */
  gust(strength: number, when: number): void {
    const s = clamp01(strength);
    if (s < 0.02 || !this.bodyGate.isRunning) {
      return;
    }
    const t = Math.max(when, this.ctx.currentTime);
    const th = this.thump.gain;
    th.cancelScheduledValues(t);
    th.setTargetAtTime(SEA_LAYERS.gustThump * s, t, 0.018);
    th.setTargetAtTime(0, t + 0.09, 0.14);
    const pa = this.patter.gain;
    pa.cancelScheduledValues(t);
    pa.setTargetAtTime(SEA_LAYERS.gustPatter * s, t + 0.07, 0.05);
    pa.setTargetAtTime(0, t + 0.3, 0.22);
  }

  dispose(now: number): void {
    this.bodyGate.dispose(now);
    this.steamGate.dispose(now);
    for (const n of this.nodes) {
      n.disconnect();
    }
  }
}
