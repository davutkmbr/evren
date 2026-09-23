import { SourceGate, loopSource } from '../dsp/gate';
import { clamp01, smoothstep } from '../dsp/math';
import type { NoiseBank } from '../dsp/noise';
import { ParamGroup, SmoothParam, type ParamTarget } from '../dsp/param';
import { mulberry32, randExp, randRange, type Rng } from '../dsp/rng';
import { playCarHorn, playFerryHorn, playGull } from '../sfx/ambient';
import { placement, type SfxEnv } from '../sfx/voice';
import { placeAmbient } from '../spatial';

/** What the listener's surroundings sound like (sampled from geo a few times per second). */
export interface AmbienceProbe {
  /** Listener height above the surface below (m). */
  agl: number;
  /** Listener altitude above sea level (m). */
  altitude: number;
  /** Urban density around the listener 0..1. */
  urban: number;
  /** Fraction of forest/park around 0..1. */
  foliage: number;
  /** Fraction of water around 0..1. */
  water: number;
  /** Proximity to a shoreline 0..1 (1 = right at the coast). */
  coast: number;
  /** 0..1 over/near the Bosphorus / Golden Horn / ferry waters. */
  strait: number;
  /** 0 = day, 1 = night (env.nightFactor). */
  night: number;
}

export function emptyProbe(): AmbienceProbe {
  return { agl: 200, altitude: 200, urban: 0, foliage: 0, water: 0, coast: 0, strait: 0, night: 0 };
}

const PROBE_KEYS: ReadonlyArray<keyof AmbienceProbe> = ['agl', 'altitude', 'urban', 'foliage', 'water', 'coast', 'strait', 'night'];

const WAVE_POINTS = 96;
const WAVE_SHAPES = 6;
const AUDIBLE = 1e-4;

interface WaveChannel {
  gain: GainNode;
  lp: BiquadFilterNode;
  next: number;
}

/**
 * Environmental beds + sparse ambient events around the listener. Filters/gains are persistent; each bed's
 * sources run only while it is audible (SourceGate). Events (gulls, car horns, ferry horns) are one-shots on
 * Poisson timers.
 *  city     distant traffic roar: pink -> 2x LP, darker and quieter with height (area source + air absorption)
 *  traffic  mid-band L/R with fast fluctuation (individual cars) when low over dense districts
 *  sea      breaking waves near shores: per-wave envelopes (setValueCurveAtTime) on gain and brightness, L/R
 *  foam     delayed high-passed wash after each crest
 *  lapping  open water chop under a low pass
 *  foliage  leaves in gusts over forests/parks
 *  high     thin lonely wind with drifting resonances above ~1500 m
 *  crickets late-September night chorus over parks, gardens and suburbs (pulsed ~3-5 kHz tones)
 * Night thins out traffic, horns and gulls; ferries keep running into the evening.
 * Every sustained noise bed drifts its playback rate slowly at random (see `drift`), so no loop repeats verbatim.
 */
export class AmbienceVoice {
  private readonly nodes: AudioNode[] = [];
  private readonly gates: SourceGate[] = [];
  private readonly rng: Rng;

  private readonly cityGain: SmoothParam;
  private readonly cityCut: SmoothParam;
  private readonly trafficGain: SmoothParam;
  private readonly trafficCut: ParamTarget;
  private readonly seaLevel: SmoothParam;
  private readonly foamLevel: SmoothParam;
  private readonly lapGain: SmoothParam;
  private readonly foliageGain: SmoothParam;
  private readonly highGain: SmoothParam;
  private readonly highFreqA: SmoothParam;
  private readonly highFreqB: SmoothParam;
  private readonly cricketGain: SmoothParam;

  private readonly cityGate: SourceGate;
  private readonly trafficGate: SourceGate;
  private readonly seaGate: SourceGate;
  private readonly lapGate: SourceGate;
  private readonly foliageGate: SourceGate;
  private readonly highGate: SourceGate;
  private readonly cricketGate: SourceGate;

  private readonly waves: WaveChannel[] = [];
  private readonly foamGain: GainNode;
  private readonly waveShapes: Float32Array<ArrayBuffer>[] = [];
  private readonly foamShapes: Float32Array<ArrayBuffer>[] = [];
  private readonly cutShapes: Float32Array<ArrayBuffer>[] = [];

  private gullTimer: number;
  private hornTimer: number;
  private ferryTimer: number;
  private driftTime = 0;
  private readonly place = placement();
  /** One-shot voice budget: ambient events are the first to be dropped. */
  maxVoices = 40;

  /** Smoothed probe (geo sampling is coarse). */
  private readonly smooth: AmbienceProbe = emptyProbe();

  constructor(
    private readonly ctx: BaseAudioContext,
    noise: NoiseBank,
    private readonly env: SfxEnv,
    out: AudioNode,
    seed = 7,
  ) {
    this.rng = mulberry32(seed);
    const rng = this.rng;
    const t0 = ctx.currentTime;
    const loop = (buffer: AudioBuffer, when: number, rate: number, dest: AudioNode): AudioBufferSourceNode => {
      const s = loopSource(ctx, buffer, when, rate, rng);
      s.connect(dest);
      return s;
    };
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
    // Slow random playback-rate drift: sustained beds run for minutes, and a noise loop heard verbatim every few
    // seconds becomes a recognizable pattern. `mod` is a smooth random source started by the same gate.
    const drift = (aux: AudioNode[], mod: AudioNode, target: AudioBufferSourceNode, depth: number): void => {
      const g = ctx.createGain();
      g.gain.value = depth;
      mod.connect(g).connect(target.playbackRate);
      aux.push(g);
    };
    const driftSource = (when: number): AudioBufferSourceNode => loopSource(ctx, noise.gust, when, 0.8 + rng() * 0.4, rng);
    const gate = (hold: number, start: (t: number, aux: AudioNode[]) => AudioScheduledSourceNode[]): SourceGate => {
      const g = new SourceGate(start, hold);
      this.gates.push(g);
      return g;
    };

    // City bed: broadband low-mid wash (pink, not brown: distant traffic still has 200-800 Hz body).
    const cityHp = filter('highpass', 45, 0.6);
    const cityCut = filter('lowpass', 300, 0.6);
    const cityCut2 = filter('lowpass', 420, 0.5);
    const cityG = gain(0);
    cityHp.connect(cityCut).connect(cityCut2).connect(cityG).connect(out);
    this.cityGain = new SmoothParam(cityG.gain, 0, 0.5);
    this.cityCut = new SmoothParam(cityCut.frequency, 300, 0.5);
    this.cityGate = gate(4, (t, aux) => {
      const src = loop(noise.pink, t, 0.94, cityHp);
      const mod = driftSource(t);
      drift(aux, mod, src, 0.015);
      return [src, mod];
    });

    const trafficG = gain(0);
    const trafficBp: BiquadFilterNode[] = [];
    const trafficMods: GainNode[] = [];
    for (let side = -1; side <= 1; side += 2) {
      const bp = filter('bandpass', 800, 0.8);
      trafficBp.push(bp);
      const g = gain(0.6);
      const md = gain(0.45);
      md.connect(g.gain);
      trafficMods.push(md);
      bp.connect(g).connect(panner(side * 0.6)).connect(trafficG);
    }
    trafficG.connect(out);
    this.trafficGain = new SmoothParam(trafficG.gain, 0, 0.5);
    this.trafficCut = new ParamGroup([trafficBp[0].frequency, trafficBp[1].frequency], 800, [0.95, 1.05], 0.5);
    this.trafficGate = gate(4, (t, aux) => {
      const srcL = loop(noise.pink, t, 1.008, trafficBp[0]);
      const srcR = loop(noise.pink, t, 0.96, trafficBp[1]);
      const mod = driftSource(t);
      drift(aux, mod, srcL, 0.015);
      drift(aux, mod, srcR, -0.012);
      return [srcL, srcR, mod, loop(noise.gust, t, 7 + rng() * 4, trafficMods[0]), loop(noise.gust, t, 7 + rng() * 4, trafficMods[1])];
    });

    // Sea: two independent wave trains L/R (+ foam wash).
    const seaG = gain(0);
    const waveInputs: BiquadFilterNode[] = [];
    for (let side = -1; side <= 1; side += 2) {
      const hp = filter('highpass', 40, 0.7);
      const lp = filter('lowpass', 500, 0.7);
      const g = gain(0.22);
      hp.connect(lp).connect(g).connect(panner(side * 0.55)).connect(seaG);
      waveInputs.push(hp);
      this.waves.push({ gain: g, lp, next: t0 + 0.1 + rng() * 2 });
    }
    seaG.connect(out);
    this.seaLevel = new SmoothParam(seaG.gain, 0, 0.6);
    const foamOut = gain(0);
    this.foamGain = gain(0);
    const foamHp = filter('highpass', 2600, 0.5);
    const foamLp = filter('lowpass', 9000, 0.5);
    foamHp.connect(foamLp).connect(this.foamGain).connect(foamOut).connect(out);
    this.foamLevel = new SmoothParam(foamOut.gain, 0, 0.6);
    this.seaGate = gate(5, (t, aux) => {
      const waveL = loop(noise.pink, t, 1.02, waveInputs[0]);
      const waveR = loop(noise.pink, t, 0.98, waveInputs[1]);
      const foam = loop(noise.white, t, 1.021, foamHp);
      const mod = driftSource(t);
      drift(aux, mod, waveL, 0.012);
      drift(aux, mod, waveR, -0.012);
      drift(aux, mod, foam, 0.018);
      return [waveL, waveR, foam, mod];
    });

    const lapG = gain(0);
    const lapBp = filter('bandpass', 1300, 0.9);
    const lapAm = gain(0.5);
    const lapDepth = gain(0.5);
    lapDepth.connect(lapAm.gain);
    lapBp.connect(lapAm).connect(lapG).connect(out);
    this.lapGain = new SmoothParam(lapG.gain, 0, 0.6);
    this.lapGate = gate(5, (t, aux) => {
      const src = loop(noise.pink, t, 1.05, lapBp);
      const mod = driftSource(t);
      drift(aux, mod, src, 0.02);
      return [src, mod, loop(noise.buffet, t, 0.35, lapDepth)];
    });

    // Foliage: leaves in gusts, stereo.
    const folG = gain(0);
    const folHp = filter('highpass', 1500, 0.5);
    const folLp = filter('lowpass', 6500, 0.5);
    folHp.connect(folLp);
    const folMods: GainNode[] = [];
    for (let side = -1; side <= 1; side += 2) {
      const g = gain(0.5);
      const md = gain(0.48);
      md.connect(g.gain);
      folMods.push(md);
      folLp.connect(g).connect(panner(side * 0.7)).connect(folG);
    }
    folG.connect(out);
    this.foliageGain = new SmoothParam(folG.gain, 0, 0.8);
    this.foliageGate = gate(6, (t, aux) => {
      const src = loop(noise.pink, t, 1.1, folHp);
      const gustL = loop(noise.gust, t, 1.5 + rng(), folMods[0]);
      drift(aux, gustL, src, 0.015);
      return [src, gustL, loop(noise.gust, t, 1.5 + rng(), folMods[1])];
    });

    // High-altitude wind.
    const highG = gain(0);
    const hA = filter('bandpass', 420, 3.5);
    const hB = filter('bandpass', 980, 6);
    const hLow = filter('lowpass', 240, 0.6);
    const hLowHp = filter('highpass', 48, 0.7);
    hLowHp.connect(hLow);
    const gA = gain(0.9);
    const gB = gain(0.5);
    const gL = gain(0.25);
    const mdA = gain(0.5);
    mdA.connect(gA.gain);
    const mdB = gain(0.45);
    mdB.connect(gB.gain);
    hA.connect(gA).connect(panner(-0.45)).connect(highG);
    hB.connect(gB).connect(panner(0.45)).connect(highG);
    hLow.connect(gL).connect(highG);
    highG.connect(out);
    this.highGain = new SmoothParam(highG.gain, 0, 1.0);
    this.highFreqA = new SmoothParam(hA.frequency, 420, 2.5);
    this.highFreqB = new SmoothParam(hB.frequency, 980, 2.5);
    this.highGate = gate(7, (t, aux) => {
      const srcA = loop(noise.pink, t, 0.93, hA);
      const srcB = loop(noise.pink, t, 1.07, hB);
      const srcLow = loop(noise.brown, t, 0.9, hLowHp);
      const modA = loop(noise.gust, t, 0.6, mdA);
      const modB = loop(noise.gust, t, 0.83, mdB);
      drift(aux, modA, srcB, 0.015);
      drift(aux, modB, srcA, -0.015);
      drift(aux, modA, srcLow, 0.012);
      return [srcA, srcB, srcLow, modA, modB];
    });

    // Night crickets: each voice is a carrier tone gated by a fast pulse train (the stridulation) that is
    // itself gated by a slow chirp-rate square wave. Slightly different rates keep the chorus unsynchronized.
    const crickets = gain(0);
    const cricketDefs: Array<[number, number, number, number]> = [
      [4450, 31, 2.3, -0.55],
      [4780, 28, 2.9, 0.4],
      [3120, 44, 0.0, 0.1],
      [4600, 34, 3.4, 0.7],
    ];
    const cricketVoices = cricketDefs.map(([freq, pulse, chirp, p]) => {
      const toneGain = gain(0.5);
      const pulseDepth = gain(0.5);
      pulseDepth.connect(toneGain.gain);
      const chirpGain = gain(chirp > 0 ? 0.5 : 1);
      const chirpDepth = gain(0.5);
      chirpDepth.connect(chirpGain.gain);
      toneGain.connect(chirpGain).connect(panner(p)).connect(crickets);
      return { freq: freq * (0.98 + rng() * 0.04), pulse, chirp, toneGain, pulseDepth, chirpDepth };
    });
    crickets.connect(out);
    this.cricketGain = new SmoothParam(crickets.gain, 0, 1.5);
    this.cricketGate = gate(9, (t) => {
      const started: AudioScheduledSourceNode[] = [];
      const osc = (type: OscillatorType, f: number, dest: AudioNode, when: number): void => {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = f;
        o.connect(dest);
        o.start(when);
        started.push(o);
      };
      for (const c of cricketVoices) {
        osc('sine', c.freq, c.toneGain, t);
        osc('square', c.pulse, c.pulseDepth, t + rng() * 0.05);
        if (c.chirp > 0) {
          osc('square', c.chirp, c.chirpDepth, t + rng() * 0.4);
        }
      }
      return started;
    });

    this.buildWaveShapes();
    this.gullTimer = randExp(rng, 4);
    this.hornTimer = randExp(rng, 6);
    this.ferryTimer = 18 + randExp(rng, 30);
  }

  /** Number of beds whose sources are currently running (diagnostics). */
  get runningLayers(): number {
    let n = 0;
    for (const g of this.gates) {
      n += g.isRunning ? 1 : 0;
    }
    return n;
  }

  private buildWaveShapes(): void {
    const rng = this.rng;
    for (let s = 0; s < WAVE_SHAPES; s++) {
      const wave = new Float32Array(WAVE_POINTS);
      const foam = new Float32Array(WAVE_POINTS);
      const cut = new Float32Array(WAVE_POINTS);
      const crest = 0.5 + rng() * 0.18;
      const floor = 0.22;
      const peak = 0.75 + rng() * 0.25;
      for (let i = 0; i < WAVE_POINTS; i++) {
        const x = i / (WAVE_POINTS - 1);
        let w: number;
        if (x < crest) {
          const u = x / crest;
          w = floor + (peak - floor) * Math.pow(u, 2.2);
        } else {
          const u = (x - crest) / (1 - crest);
          w = floor + (peak - floor) * (0.55 * Math.exp(-u * 9) + 0.45 * Math.exp(-u * 2.6) * (1 - u));
        }
        w *= 1 + 0.06 * Math.sin(x * 37 + s * 3.1) * Math.sin(x * 11);
        wave[i] = i === 0 || i === WAVE_POINTS - 1 ? floor : w;
        const fu = (x - crest + 0.03) / (1 - crest);
        foam[i] = fu <= 0 || i === WAVE_POINTS - 1 ? 0 : Math.min(1, fu * 12) * Math.exp(-fu * 3.2) * (1 - fu);
        cut[i] = 380 + 1500 * Math.pow(clamp01((w - floor) / (peak - floor)), 1.3);
      }
      cut[0] = 380;
      cut[WAVE_POINTS - 1] = 380;
      this.waveShapes.push(wave);
      this.foamShapes.push(foam);
      this.cutShapes.push(cut);
    }
  }

  private scheduleWaves(now: number, active: boolean): void {
    for (let c = 0; c < this.waves.length; c++) {
      const ch = this.waves[c];
      if (ch.next > now + 1.2) {
        continue;
      }
      if (!active) {
        // Never move `next` before the end of an already scheduled curve (curves must not overlap).
        ch.next = Math.max(ch.next, now + 0.5);
        continue;
      }
      const start = Math.max(ch.next + 0.002, now + 0.05);
      const dur = randRange(this.rng, 4.8, 9.5);
      const shape = Math.floor(this.rng() * WAVE_SHAPES);
      ch.gain.gain.setValueCurveAtTime(this.waveShapes[shape], start, dur);
      ch.lp.frequency.setValueCurveAtTime(this.cutShapes[shape], start, dur);
      if (c === 0) {
        this.foamGain.gain.setValueCurveAtTime(this.foamShapes[shape], start, dur);
      }
      ch.next = start + dur + (c === 0 ? 0 : this.rng() * 0.3);
    }
  }

  update(probe: AmbienceProbe, dt: number, now: number, spawnEvents: boolean): void {
    const k = 1 - Math.exp(-Math.max(0, dt) * 1.5);
    const s = this.smooth;
    // Non-finite probe values are skipped and a poisoned smoothed value is re-seeded, so one bad sample can never
    // silence the beds for the rest of the session.
    for (const key of PROBE_KEYS) {
      const target = probe[key];
      if (!Number.isFinite(target)) {
        continue;
      }
      const next = s[key] + (target - s[key]) * k;
      s[key] = Number.isFinite(next) ? next : target;
    }
    const agl = Math.max(0, s.agl);
    const day = 1 - s.night;

    const city = (0.4 * s.urban * (1 - smoothstep(900, 1700, agl)) * (0.55 + 0.45 * day)) / (1 + agl / 140);
    this.cityGate.update(city > AUDIBLE, now);
    this.cityGain.set(city, now);
    this.cityCut.set(170 + 650 / (1 + agl / 110), now);

    const traffic = (0.4 * s.urban * s.urban * (1 - smoothstep(250, 650, agl)) * (0.4 + 0.6 * day)) / (1 + agl / 70);
    this.trafficGate.update(traffic > AUDIBLE, now);
    this.trafficGain.set(traffic, now);
    this.trafficCut.set(650 + 500 / (1 + agl / 150), now);

    const surf = (s.coast * (1 - smoothstep(220, 600, agl))) / (1 + agl / 70);
    this.seaGate.update(surf > AUDIBLE, now);
    this.seaLevel.set(1.0 * surf, now);
    this.foamLevel.set(0.35 * surf, now);
    this.scheduleWaves(now, surf > 0.005);

    const lap = (0.55 * s.water * (1 - s.coast * 0.7) * (1 - smoothstep(120, 350, agl))) / (1 + agl / 45);
    this.lapGate.update(lap > AUDIBLE, now);
    this.lapGain.set(lap, now);

    const foliage = (0.5 * s.foliage * (1 - smoothstep(120, 320, agl))) / (1 + agl / 50);
    this.foliageGate.update(foliage > AUDIBLE, now);
    this.foliageGain.set(foliage, now);

    const cricketHabitat = Math.min(1, s.foliage * 1.6 + s.urban * 0.35) * (1 - s.water);
    const crickets = (0.022 * smoothstep(0.55, 0.9, s.night) * cricketHabitat * (1 - smoothstep(60, 260, agl))) / (1 + agl / 60);
    this.cricketGate.update(crickets > AUDIBLE * 0.1, now);
    this.cricketGain.set(crickets, now);

    const high = 0.6 * smoothstep(1250, 1900, s.altitude);
    this.highGate.update(high > AUDIBLE, now);
    this.highGain.set(high, now);
    this.driftTime += dt;
    if (this.driftTime > 2.5) {
      this.driftTime = 0;
      this.highFreqA.set(randRange(this.rng, 330, 560), now);
      this.highFreqB.set(randRange(this.rng, 800, 1250), now);
    }

    if (!spawnEvents) {
      return;
    }
    const gullRate = clamp01(Math.max(s.coast, s.water * 0.6)) * (1 - smoothstep(120, 380, agl)) * (0.15 + 0.85 * day);
    this.gullTimer -= dt * gullRate;
    if (this.gullTimer <= 0) {
      this.gullTimer = randExp(this.rng, 6.5);
      this.spawnGull(agl);
    }
    const hornRate = s.urban * s.urban * (1 - smoothstep(180, 480, agl)) * (0.3 + 0.7 * day);
    this.hornTimer -= dt * hornRate;
    if (this.hornTimer <= 0) {
      this.hornTimer = randExp(this.rng, 7);
      this.spawnCarHorn(agl);
    }
    const ferryRate = s.strait * (1 - smoothstep(700, 1400, agl)) * (0.5 + 0.5 * day);
    this.ferryTimer -= dt * ferryRate;
    if (this.ferryTimer <= 0) {
      this.ferryTimer = 45 + randExp(this.rng, 50);
      this.spawnFerry(agl);
    }
  }

  private bearing(): number {
    return Math.sin(this.rng() * Math.PI * 2);
  }

  /** `distance` (horizontal m) is random when omitted. */
  spawnGull(agl: number, distance?: number): void {
    if (this.env.stats.active > this.maxVoices) {
      return;
    }
    const h = distance ?? randRange(this.rng, 25, 160);
    const height = Math.max(0, agl - randRange(this.rng, 0, 30));
    playGull(this.env, this.ctx.currentTime + 0.02, placeAmbient(h, height, this.bearing(), 18, 0.12, this.place));
  }

  spawnCarHorn(agl: number, distance?: number): void {
    if (this.env.stats.active > this.maxVoices) {
      return;
    }
    const h = distance ?? randRange(this.rng, 150, 650);
    playCarHorn(this.env, this.ctx.currentTime + 0.02, placeAmbient(h, agl, this.bearing(), 45, 0.4, this.place));
  }

  spawnFerry(agl: number, distance?: number): void {
    if (this.env.stats.active > this.maxVoices + 4) {
      return;
    }
    const h = distance ?? randRange(this.rng, 900, 2400);
    playFerryHorn(this.env, this.ctx.currentTime + 0.02, placeAmbient(h, agl, this.bearing(), 260, 0.35, this.place));
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
