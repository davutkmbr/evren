import { softClipCurve } from '../dsp/curves';
import { SourceGate, loopSource } from '../dsp/gate';
import { clamp, clamp01, finiteOr, smoothstep } from '../dsp/math';
import type { NoiseBank } from '../dsp/noise';
import { SmoothParam } from '../dsp/param';
import type { LoopSample, SampleBank } from '../samples';

/** Airflow state at the listener, derived from the dragon (third/POV) or the free camera. */
export interface WindParams {
  /** Airflow speed at the listener (m/s). */
  airspeed: number;
  /** Angle of attack (rad, + = air from below). */
  aoa: number;
  /** Sideslip (rad, + = air from the right). */
  sideslip: number;
  /** Signed yaw rate (rad/s, + = turning right). */
  turnRate: number;
  /** Signed roll rate (rad/s). */
  rollRate: number;
  /** 0..1 wings folded in a dive. */
  diving: number;
  /** 0..1 stalled / flared (turbulent separated flow). */
  stall: number;
  /** 0..1 POV blend (ears in the airstream: more buffeting, wider). */
  pov: number;
  /** How exposed the listener is to the airflow (1 = rider POV, ~0.85 chase camera). */
  exposure: number;
  /** Ambient wind speed (m/s) -> gust depth. */
  ambientWind: number;
  /** 0..1 skimming low over water (spray hiss from the wake / wingtip vortices on the surface). */
  skim: number;
  /**
   * 0..1 perceived-speed surge (phase 20: race speeds and chain bursts, scaled by the race / flow context): the airflow
   * gets louder, faster and brighter on top of what the airspeed alone gives.
   */
  surge: number;
}

export function defaultWindParams(): WindParams {
  return { airspeed: 0, aoa: 0, sideslip: 0, turnRate: 0, rollRate: 0, diving: 0, stall: 0, pov: 0, exposure: 0.6, ambientWind: 4, skim: 0, surge: 0 };
}

const AUDIBLE = 2e-4;
/** Peak shaver on the voice output (absolute amplitude): transparent below the knee. */
const PEAK_SHAVE_KNEE = 0.55;
const PEAK_SHAVE_CEILING = 0.95;
const PEAK_SHAVE_SCALE = 2;
/** 4th-order Butterworth corner of the rumble layer. */
const RUMBLE_HP_HZ = 42;
/** Peak playback-rate deviation of the hiss / body noise loops (gust-driven read-position wander). */
const HISS_DRIFT = 0.018;
const BODY_DRIFT = 0.009;
/** Perceived-speed surge at full: airflow level × (1 + SURGE_GAIN), loop playback rate × (1 + SURGE_RATE). */
const SURGE_GAIN = 0.33;
const SURGE_RATE = 0.08;
/** Layer gains are calibrated at a 40 m/s cruise, where the base airflow level is this. */
const CRUISE_LOUD = 0.356;
/**
 * Recorded airflow (zazz 819581 rush for the body, klankbeeld 611197 ear buffet for the rumble; public/audio/wind/).
 * The rush plays through a low-pass that opens with speed and a playback rate that rises with it (faster air sounds
 * faster and brighter); the trims put the offline wind-* cases ~0.5 LU under the synthesized bed (already cut for
 * being too loud). The ear recording has its own buffeting, so the synthesized buffet AM only adds a little on top.
 */
const RUSH_CUT_MIN = 380;
const RUSH_CUT_SPAN = 4600;
const RUSH_TRIM = 0.37;
const EARS_TRIM = 0.73;
const EARS_BUFFET = 0.35;
const HISS_RECORDED = 0.6;
const BANK_RECORDED = 0.4;
/** Airflow level (dB relative to 40 m/s) against airspeed (m/s); interpolated in log-speed. */
const SPEED_DB: ReadonlyArray<readonly [number, number]> = [
  [3, -80],
  [6, -30],
  [10, -21],
  [15, -14.5],
  [20, -10.5],
  [30, -4.5],
  [40, 0],
  [55, 3.6],
  [70, 6],
  [95, 8],
  [130, 9],
];

/** Linear airflow level relative to cruise (1 at 40 m/s, 0 below 3 m/s). */
export function speedLevel(v: number): number {
  if (!(v > SPEED_DB[0][0])) {
    return 0;
  }
  const last = SPEED_DB[SPEED_DB.length - 1];
  if (v >= last[0]) {
    return Math.pow(10, last[1] / 20);
  }
  let i = 1;
  while (SPEED_DB[i][0] < v) {
    i++;
  }
  const [v0, d0] = SPEED_DB[i - 1];
  const [v1, d1] = SPEED_DB[i];
  const t = Math.log(v / v0) / Math.log(v1 / v0);
  const db = d0 + (d1 - d0) * t;
  return db <= -79 ? 0 : Math.pow(10, db / 20);
}

/**
 * Layered airflow noise. Filters/gains/panners are persistent; each layer's sources run only while the layer
 * is audible (SourceGate), so a grounded dragon or a calm glide costs almost no audio-thread DSP.
 *  rumble  brown -> 2x LP (70-450 Hz), amplitude-modulated by audio-rate turbulent buffeting, 42 Hz HP after the AM
 *  body    decorrelated pink L/R -> band-pass whose centre climbs with speed, slow gust modulation, stereo width
 *  hiss    white L/R -> high-pass, grows faster than the rest with speed (only at speed)
 *  whistle narrow band-pass resonance (rider gear / scale edges), sideslip makes it sing
 *  bank    band-pass whoosh panned to the turn side, driven by turn + roll rate
 *  flutter folded-wing membrane flutter in dives / separated flow when stalling (fast AM of a low band)
 *  skim    spray hiss when skimming the water surface (granular AM of high-passed noise)
 *  cloth   POV only: the rider's cloak/sleeves flogging in the airstream (fast irregular AM, like a flag)
 * Output: static soft clip (peak shaver) -> destination. Levels follow speedLevel() (compressed above cruise).
 * The gust signals also drift the body/hiss loops' playback rates, so steady cruise never exposes a noise loop.
 * With the recorded airflow loaded, the rush recording feeds body (L/R channels, low-passed) and bank, and the ear
 * recording feeds rumble; a running layer keeps its sources, so a late load takes over the next time airflow starts.
 */
export class WindVoice {
  private readonly nodes: AudioNode[] = [];
  private readonly gates: SourceGate[] = [];

  private readonly rumbleCut1: SmoothParam;
  private readonly rumbleCut2: SmoothParam;
  private readonly rumbleGain: SmoothParam;
  private readonly buffetRate: SmoothParam;
  private readonly buffetDepth: SmoothParam;

  private readonly bodyFreqL: SmoothParam;
  private readonly bodyFreqR: SmoothParam;
  private readonly bodyGainL: SmoothParam;
  private readonly bodyGainR: SmoothParam;
  private readonly gustDepthL: SmoothParam;
  private readonly gustDepthR: SmoothParam;
  private readonly panL: SmoothParam;
  private readonly panR: SmoothParam;

  private readonly hissCutL: SmoothParam;
  private readonly hissCutR: SmoothParam;
  private readonly hissGainL: SmoothParam;
  private readonly hissGainR: SmoothParam;

  private readonly whistleFreq: SmoothParam;
  private readonly whistleGain: SmoothParam;

  private readonly bankFreq: SmoothParam;
  private readonly bankGain: SmoothParam;
  private readonly bankPan: SmoothParam;

  private readonly flutterRate: SmoothParam;
  private readonly flutterGain: SmoothParam;

  private readonly skimGain: SmoothParam;
  private readonly clothGain: SmoothParam;
  private readonly clothRate: SmoothParam;

  private readonly master: SmoothParam;
  private readonly rushRate: SmoothParam;
  private readonly earsRate: SmoothParam;
  /** The running core layer plays the recordings. */
  private recorded = false;
  private bankRecorded = false;

  private readonly coreGate: SourceGate;
  private readonly whistleGate: SourceGate;
  private readonly bankGate: SourceGate;
  private readonly flutterGate: SourceGate;
  private readonly skimGate: SourceGate;
  private readonly clothGate: SourceGate;

  constructor(
    private readonly ctx: BaseAudioContext,
    noise: NoiseBank,
    out: AudioNode,
    rng: () => number = Math.random,
    samples: SampleBank | null = null,
  ) {
    const gain = (v: number): GainNode => {
      const g = ctx.createGain();
      g.gain.value = v;
      this.nodes.push(g);
      return g;
    };
    const filter = (type: BiquadFilterType, f: number, q: number): BiquadFilterNode => {
      const b = ctx.createBiquadFilter();
      b.type = type;
      b.frequency.value = f;
      b.Q.value = q;
      this.nodes.push(b);
      return b;
    };
    const panner = (p: number): StereoPannerNode => {
      const s = ctx.createStereoPanner();
      s.pan.value = p;
      this.nodes.push(s);
      return s;
    };
    const loop = (buffer: AudioBuffer | LoopSample, when: number, rate: number, dest: AudioNode): AudioBufferSourceNode => {
      const s = loopSource(ctx, buffer, when, rate, rng);
      s.connect(dest);
      return s;
    };
    // Placeholder param until a gate starts its source and rebinds the smoother.
    const scratchParam = (): AudioParam => ctx.createGain().gain;

    const master = gain(0);
    // Static soft clip (no time constants, so no pumping): shaves the rare Gaussian peaks of loud dive airflow
    // (~13 dB crest) before they reach the master dynamics; cruise-level airflow stays below the knee.
    const clipIn = gain(1 / PEAK_SHAVE_SCALE);
    const clip = ctx.createWaveShaper();
    clip.curve = softClipCurve(2048, PEAK_SHAVE_KNEE / PEAK_SHAVE_SCALE, PEAK_SHAVE_CEILING / PEAK_SHAVE_SCALE);
    clip.oversample = 'none';
    this.nodes.push(clip);
    const clipOut = gain(PEAK_SHAVE_SCALE);
    master.connect(clipIn).connect(clip).connect(clipOut).connect(out);
    this.master = new SmoothParam(master.gain, 0, 0.3);

    // Rumble / body / hiss share one gate: they are all present whenever there is airflow.
    // The high-pass sits after the buffeting AM (which folds energy down to |carrier - 4..32 Hz|): everything below
    // ~40 Hz is inaudible on small speakers and would only drive the master dynamics.
    const rLp1 = filter('lowpass', 120, 0.6);
    const rLp2 = filter('lowpass', 160, 0.5);
    const rGain = gain(0);
    const rHp1 = filter('highpass', RUMBLE_HP_HZ, 0.5412);
    const rHp2 = filter('highpass', RUMBLE_HP_HZ, 1.3066);
    rLp1.connect(rLp2).connect(rGain).connect(rHp1).connect(rHp2).connect(master);
    const bDepth = gain(0);
    bDepth.connect(rGain.gain);
    this.rumbleCut1 = new SmoothParam(rLp1.frequency, 120, 0.1);
    this.rumbleCut2 = new SmoothParam(rLp2.frequency, 160, 0.1);
    this.rumbleGain = new SmoothParam(rGain.gain, 0, 0.08);
    this.buffetDepth = new SmoothParam(bDepth.gain, 0, 0.08);

    const pL = panner(-0.5);
    const pR = panner(0.5);
    pL.connect(master);
    pR.connect(master);
    this.panL = new SmoothParam(pL.pan, -0.5, 0.2);
    this.panR = new SmoothParam(pR.pan, 0.5, 0.2);

    const body = (p: StereoPannerNode): { bp: BiquadFilterNode; gd: GainNode; params: [SmoothParam, SmoothParam, SmoothParam] } => {
      const bp = filter('bandpass', 400, 0.55);
      const g = gain(0);
      bp.connect(g).connect(p);
      const gd = gain(0);
      gd.connect(g.gain);
      return { bp, gd, params: [new SmoothParam(bp.frequency, 400, 0.1), new SmoothParam(g.gain, 0, 0.08), new SmoothParam(gd.gain, 0, 0.3)] };
    };
    const bodyL = body(pL);
    const bodyR = body(pR);
    [this.bodyFreqL, this.bodyGainL, this.gustDepthL] = bodyL.params;
    [this.bodyFreqR, this.bodyGainR, this.gustDepthR] = bodyR.params;

    const hiss = (p: StereoPannerNode): { hp: BiquadFilterNode; params: [SmoothParam, SmoothParam] } => {
      const hp = filter('highpass', 3000, 0.5);
      const g = gain(0);
      hp.connect(g).connect(p);
      return { hp, params: [new SmoothParam(hp.frequency, 3000, 0.1), new SmoothParam(g.gain, 0, 0.08)] };
    };
    const hissL = hiss(pL);
    const hissR = hiss(pR);
    [this.hissCutL, this.hissGainL] = hissL.params;
    [this.hissCutR, this.hissGainR] = hissR.params;

    this.buffetRate = new SmoothParam(scratchParam(), 1, 0.3);
    this.rushRate = new SmoothParam(scratchParam(), 1, 0.4);
    this.earsRate = new SmoothParam(scratchParam(), 1, 0.4);
    const rushSplit = ctx.createChannelSplitter(2);
    this.nodes.push(rushSplit);
    rushSplit.connect(bodyL.bp, 0);
    rushSplit.connect(bodyR.bp, 1);
    this.coreGate = new SourceGate((t, aux) => {
      const rush = samples?.windRush;
      const ears = samples?.windEars;
      this.recorded = !!(rush && ears);
      // Low-pass Q is in dB in WebAudio: -3 dB is the flat (Butterworth) response; the band-pass Q is linear.
      for (const f of [bodyL.bp, bodyR.bp]) {
        f.type = this.recorded ? 'lowpass' : 'bandpass';
        f.Q.value = this.recorded ? -3 : 0.55;
      }
      const buffet = loop(noise.buffet, t, 1, bDepth);
      this.buffetRate.bind(buffet.playbackRate);
      const gustL = loop(noise.gust, t, 0.9 + rng() * 0.25, bodyL.gd);
      const gustR = loop(noise.gust, t, 0.9 + rng() * 0.25, bodyR.gd);
      const hissSrcL = loop(noise.white, t, 1.013, hissL.hp);
      const hissSrcR = loop(noise.white, t, 0.991, hissR.hp);
      // The unmodulated hiss would expose its loop as frozen, repeating noise: the gusts also make every broadband
      // source's read position wander (a slow random playback-rate drift), so no loop ever repeats verbatim.
      const drift = (mod: AudioNode, target: AudioBufferSourceNode, depth: number): void => {
        const g = ctx.createGain();
        g.gain.value = depth;
        mod.connect(g).connect(target.playbackRate);
        aux.push(g);
      };
      drift(gustL, hissSrcL, HISS_DRIFT);
      drift(gustR, hissSrcR, -HISS_DRIFT);
      if (rush && ears) {
        const rushSrc = loop(rush, t, 1, rushSplit);
        this.rushRate.bind(rushSrc.playbackRate);
        const earsSrc = loop(ears, t, 1, rLp1);
        this.earsRate.bind(earsSrc.playbackRate);
        drift(gustR, rushSrc, BODY_DRIFT);
        return [earsSrc, buffet, gustL, gustR, rushSrc, hissSrcL, hissSrcR];
      }
      const bodySrcL = loop(noise.pink, t, 1.006, bodyL.bp);
      const bodySrcR = loop(noise.pink, t, 0.973, bodyR.bp);
      drift(gustR, bodySrcL, BODY_DRIFT);
      drift(gustL, bodySrcR, -BODY_DRIFT);
      return [loop(noise.brown, t, 0.994, rLp1), buffet, gustL, gustR, bodySrcL, bodySrcR, hissSrcL, hissSrcR];
    }, 3);
    this.gates.push(this.coreGate);

    const wBp = filter('bandpass', 900, 9);
    const wGain = gain(0);
    wBp.connect(wGain).connect(panner(0.25)).connect(master);
    this.whistleFreq = new SmoothParam(wBp.frequency, 900, 0.15);
    this.whistleGain = new SmoothParam(wGain.gain, 0, 0.12);
    this.whistleGate = new SourceGate((t) => [loop(noise.pink, t, 1.013, wBp)], 2);
    this.gates.push(this.whistleGate);

    const bBp = filter('bandpass', 600, 1.1);
    const bGain = gain(0);
    const bPan = panner(0);
    bBp.connect(bGain).connect(bPan).connect(master);
    this.bankFreq = new SmoothParam(bBp.frequency, 600, 0.12);
    this.bankGain = new SmoothParam(bGain.gain, 0, 0.1);
    this.bankPan = new SmoothParam(bPan.pan, 0, 0.2);
    this.bankGate = new SourceGate((t) => {
      this.bankRecorded = !!samples?.windRush;
      return [loop(samples?.windRush ?? noise.pink, t, 0.987, bBp)];
    }, 2);
    this.gates.push(this.bankGate);

    const fBp = filter('bandpass', 180, 1.3);
    const fAm = gain(0.5);
    const fDepth = gain(0.5);
    fDepth.connect(fAm.gain);
    const fGain = gain(0);
    fBp.connect(fAm).connect(fGain).connect(master);
    this.flutterGain = new SmoothParam(fGain.gain, 0, 0.1);
    this.flutterRate = new SmoothParam(scratchParam(), 20, 0.2);
    this.flutterGate = new SourceGate((t) => {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      this.flutterRate.bind(osc.frequency);
      osc.connect(fDepth);
      osc.start(t);
      return [loop(noise.pink, t, 1.07, fBp), osc];
    }, 2);
    this.gates.push(this.flutterGate);

    const sHp = filter('highpass', 1100, 0.6);
    const sLp = filter('lowpass', 6000, 0.5);
    const sAm = gain(0.5);
    const sDepth = gain(0.5);
    sDepth.connect(sAm.gain);
    const sGain = gain(0);
    sHp.connect(sLp).connect(sAm).connect(sGain);
    sGain.connect(pL);
    sGain.connect(pR);
    this.skimGain = new SmoothParam(sGain.gain, 0, 0.15);
    this.skimGate = new SourceGate((t) => [loop(noise.white, t, 0.97, sHp), loop(noise.buffet, t, 3.2, sDepth)], 2);
    this.gates.push(this.skimGate);

    const cBp = filter('bandpass', 950, 0.8);
    const cAm = gain(0.35);
    const cDepth = gain(0.65);
    cDepth.connect(cAm.gain);
    const cGain = gain(0);
    cBp.connect(cAm).connect(cGain).connect(panner(-0.35)).connect(master);
    this.clothGain = new SmoothParam(cGain.gain, 0, 0.15);
    this.clothRate = new SmoothParam(scratchParam(), 2, 0.3);
    this.clothGate = new SourceGate((t) => {
      const mod = loop(noise.buffet, t, 2, cDepth);
      this.clothRate.bind(mod.playbackRate);
      return [loop(noise.pink, t, 1.031, cBp), mod];
    }, 2);
    this.gates.push(this.clothGate);
  }

  /** Fade the whole layer (e.g. 0 when there is no airflow source). */
  setLevel(level: number, now: number): void {
    this.master.set(level, now);
  }

  /** Number of layers whose sources are currently running (diagnostics). */
  get runningLayers(): number {
    let n = 0;
    for (const g of this.gates) {
      n += g.isRunning ? 1 : 0;
    }
    return n;
  }

  update(p: WindParams, now: number): void {
    const v = Math.max(0, finiteOr(p.airspeed, 0));
    const sN = clamp((v - 3) / 72, 0, 1.6);
    const exposure = p.exposure;
    // Airflow level relative to a 40 m/s cruise. Aerodynamic noise physically grows ~v^6 (+22 dB from cruise to a
    // 95 m/s dive); the mix follows it up to cruise speed and then compresses it to ~+8 dB so dives stay exciting
    // without burying everything else (and without driving the master dynamics).
    const surge = clamp01(finiteOr(p.surge, 0));
    // The surge lifts the airflow by up to ~+2.5 dB and its pitch by up to ~8 % (a burst is heard as the air rushing).
    const rel = speedLevel(v) * (1 + SURGE_GAIN * surge);
    const loud = CRUISE_LOUD * rel * exposure;
    const aoaN = clamp01(Math.abs(p.aoa) / 0.4);
    const slipN = clamp01(Math.abs(p.sideslip) / 0.35);
    const pov = p.pov;
    const on = this.master.value > AUDIBLE;

    // In POV the ears sit in the airstream: more buffeting, pushed up into the 60-300 Hz range small speakers can play.
    // Low-frequency buffeting grows slower than the broadband roar: faster flow moves the energy up in frequency.
    const turbulence = 1 + 0.75 * aoaN + 0.2 * p.diving + 1.0 * p.stall;
    const rec = this.recorded;
    const rumble = 1.5 * CRUISE_LOUD * Math.pow(rel, 0.6) * exposure * (0.3 + 0.45 * pov) * turbulence * (rec ? EARS_TRIM : 1);
    this.coreGate.update(on && loud > AUDIBLE, now);
    this.rumbleCut1.set(70 + 210 * sN + 60 * p.stall + 70 * pov, now);
    this.rumbleCut2.set(110 + 220 * sN + 90 * pov, now);
    this.rumbleGain.set(rumble, now);
    this.buffetRate.set(0.45 + 1.25 * sN + 0.6 * p.stall, now);
    this.buffetDepth.set(rumble * (0.5 + 0.3 * aoaN + 0.15 * pov) * (rec ? EARS_BUFFET : 1), now);
    const sR = Math.min(sN, 1.3);
    this.rushRate.set((0.9 + 0.26 * sR) * (1 + SURGE_RATE * surge), now);
    this.earsRate.set((0.85 + 0.35 * sR) * (1 + SURGE_RATE * surge), now);

    const center = rec ? RUSH_CUT_MIN + RUSH_CUT_SPAN * Math.pow(sR, 1.1) + 600 * aoaN : 170 + 1150 * Math.pow(sN, 1.2) + 280 * aoaN;
    this.bodyFreqL.set(center * 0.94, now);
    this.bodyFreqR.set(center * 1.06, now);
    const body = 1.05 * loud * (1 - 0.25 * p.stall) * (rec ? RUSH_TRIM : 1);
    this.bodyGainL.set(body, now);
    this.bodyGainR.set(body, now);
    const gust = clamp(0.2 + p.ambientWind * 0.03, 0.2, 0.55);
    this.gustDepthL.set(body * gust, now);
    this.gustDepthR.set(body * gust, now);
    const width = 0.3 + 0.55 * pov;
    this.panL.set(-width, now);
    this.panR.set(width, now);

    const hissCut = (2000 + 2400 * Math.min(sN, 1.3)) * (1 + 0.25 * surge);
    this.hissCutL.set(hissCut, now);
    this.hissCutR.set(hissCut * 1.08, now);
    const hiss = 0.045 * Math.pow(rel, 1.3) * exposure * (0.55 + 0.45 * pov) * (1 + 0.3 * p.diving) * (rec ? HISS_RECORDED : 1);
    this.hissGainL.set(hiss, now);
    this.hissGainR.set(hiss, now);

    const whistle = 0.008 * Math.pow(rel, 1.2) * (0.35 + 1.8 * slipN) * exposure;
    this.whistleGate.update(on && whistle > AUDIBLE, now);
    this.whistleFreq.set(520 + 820 * Math.min(sN, 1.3) + 480 * slipN, now);
    this.whistleGain.set(whistle, now);

    const bankAmt = clamp01(Math.abs(p.turnRate) / 0.9 + Math.abs(p.rollRate) / 2.2);
    const bank = 1.1 * bankAmt * Math.sqrt(Math.min(sN, 1.4)) * exposure * (this.bankRecorded ? BANK_RECORDED : 1);
    this.bankGate.update(on && bank > AUDIBLE, now);
    this.bankFreq.set(320 + 1200 * bankAmt * Math.min(sN, 1.2), now);
    this.bankGain.set(bank, now);
    const side = Math.abs(p.turnRate) > 0.02 ? Math.sign(p.turnRate) : Math.sign(p.rollRate);
    this.bankPan.set(side * 0.65 * (0.4 + 0.6 * pov), now);

    // Folded membranes flutter from free-fall speeds on (a drop from a hover is heard before it gets fast).
    const flutterAmt = Math.max(p.diving * smoothstep(14, 75, v), p.stall * smoothstep(5, 20, v));
    const flutter = 0.6 * flutterAmt * exposure;
    this.flutterGate.update(on && flutter > AUDIBLE, now);
    this.flutterRate.set(11 + 22 * Math.min(sN, 1.4), now);
    this.flutterGain.set(flutter, now);

    const skim = 0.32 * p.skim * Math.min(1, sN * 1.5);
    this.skimGate.update(on && skim > AUDIBLE, now);
    this.skimGain.set(skim, now);

    const cloth = 0.09 * pov * Math.pow(rel, 0.9);
    this.clothGate.update(on && cloth > AUDIBLE, now);
    this.clothGain.set(cloth, now);
    this.clothRate.set(1.2 + 3.2 * Math.min(sN, 1.3), now);
  }

  dispose(): void {
    const now = this.ctx.currentTime;
    for (const g of this.gates) {
      g.dispose(now);
    }
    for (const n of this.nodes) {
      n.disconnect();
    }
  }
}
