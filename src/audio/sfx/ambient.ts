import { linearPoints } from '../dsp/envelope';
import { Voice, pickSlot, type Placement, type SfxEnv } from './voice';

/** Recorded gull call level (the calls are loudness-matched in prep). */
const GULL_LEVEL = 0.67;
/** Longer phrases are cut to this (s) with a fade: a call or two, never a long chorus. */
const GULL_MAX = 1.8;

/**
 * One recorded gull call phrase (public/audio/gull/: Adalar, harbour and herring gull calls, denoised), a random slot
 * of the round-robin at a slightly random rate. Silent while the recordings load or when they are unavailable: the
 * synthesized call it replaced was what players disliked. Returns the duration (s).
 */
export function playGull(env: SfxEnv, when: number, place: Placement): number {
  const calls = env.samples?.gullCalls;
  if (!calls) {
    return 0;
  }
  const v = new Voice(env, place, when, GULL_LEVEL);
  const slot = pickSlot(calls, env.rng);
  const rate = 0.96 + 0.08 * env.rng();
  const length = Math.min(calls.slots[slot][1] / rate, GULL_MAX);
  const fade = v.gain(1);
  fade.gain.setValueAtTime(1, v.t + length - 0.35);
  fade.gain.linearRampToValueAtTime(0, v.t + length);
  v.slot(calls, slot, 0, rate).connect(fade).connect(v.input);
  v.end(length + 0.05);
  return length;
}

/** Distant two-tone car horn (Istanbul traffic), sometimes a double honk. */
export function playCarHorn(env: SfxEnv, when: number, place: Placement): number {
  const rng = env.rng;
  const v = new Voice(env, place, when, 3.5);
  const f1 = 380 + rng() * 60;
  const f2 = f1 * (1.22 + rng() * 0.06);
  const body = v.filter('bandpass', 950 + rng() * 300, 1.1);
  const lp = v.filter('lowpass', 2600, 0.7);
  const out = v.gain(1);
  body.connect(lp).connect(out);
  v.toInput(out);
  const honks = rng() < 0.35 ? 2 : 1;
  let t = 0;
  for (let h = 0; h < honks; h++) {
    const d = honks === 2 ? 0.12 + rng() * 0.08 : 0.22 + rng() * 0.35;
    for (const f of [f1, f2]) {
      const o = v.osc('square', f, t, (rng() - 0.5) * 10, d + 0.06);
      const g = v.gain(0);
      linearPoints(g.gain, v.t + t, [
        [0, 0],
        [0.012, 0.09],
        [d, 0.08],
        [d + 0.035, 0],
      ]);
      o.connect(g).connect(body);
    }
    t += d + 0.09;
  }
  v.end(t + 0.1);
  return t;
}

/**
 * Bosphorus ferry (vapur) horn: ~70-80 m vessel, so a 130-350 Hz whistle (COLREGs Annex III). Rich harmonic
 * tone with a slight pitch scoop at the onset, breathy air noise, and hill echoes via a feedback delay.
 */
export function playFerryHorn(env: SfxEnv, when: number, place: Placement): number {
  const rng = env.rng;
  const v = new Voice(env, { ...place, reverb: place.reverb * 1.8 }, when, 0.2);
  const t = v.t;
  const f = 150 + rng() * 40;
  const hold = 2.0 + rng() * 1.5;
  const total = 0.35 + hold + 0.9;

  const mix = v.gain(1);
  const tones: Array<[OscillatorType, number, number, number]> = [
    ['sawtooth', 1, 0, 0.3],
    ['sawtooth', 1, 7, 0.25],
    ['square', 1, -5, 0.12],
    ['sawtooth', 1.498, 3, 0.07],
  ];
  for (const [type, ratio, det, level] of tones) {
    const o = v.osc(type, f * ratio, 0, det);
    o.frequency.setValueAtTime(f * ratio * 0.93, t);
    o.frequency.exponentialRampToValueAtTime(f * ratio, t + 0.3);
    o.frequency.setValueAtTime(f * ratio, t + 0.35 + hold);
    o.frequency.exponentialRampToValueAtTime(f * ratio * 0.96, t + total);
    const g = v.gain(level);
    o.connect(g).connect(mix);
  }
  const air = v.noise(env.noise.pink);
  const airBp = v.filter('bandpass', f * 4, 6);
  const airG = v.gain(0.35);
  air.connect(airBp).connect(airG).connect(mix);

  const resonance = v.filter('peaking', 420, 1.5, 6);
  const lp = v.filter('lowpass', 1400, 0.7);
  const amp = v.gain(0);
  linearPoints(amp.gain, t, [
    [0, 0],
    [0.35, 1],
    [0.35 + hold, 0.95],
    [total, 0],
  ]);
  mix.connect(resonance).connect(lp).connect(amp);
  v.toInput(amp);

  const delay = v.delay(0.9 + rng() * 0.6);
  const fb = v.gain(0.28);
  const echoLp = v.filter('lowpass', 700, 0.6);
  const echoOut = v.gain(0.45);
  amp.connect(delay);
  delay.connect(echoLp).connect(fb).connect(delay);
  echoLp.connect(echoOut);
  v.toInput(echoOut, -0.4);

  const tail = total + 3.5;
  v.end(tail);
  return tail;
}
