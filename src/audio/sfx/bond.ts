import { clamp } from '../dsp/math';
import { Voice, type Placement, type SfxEnv } from './voice';

/**
 * Bond sounds of the dragon (phase 06). All synthesised: a large reptile-bird voice built from a low glottal tone
 * (sawtooth / square through a throat low-pass and one or two formant band-passes) and breath noise. Each function
 * schedules one phrase and returns its duration in seconds.
 */

/** A glottal source whose pitch follows `points` ([time s, Hz]) with a little jitter: saw + square mix. */
function glottal(v: Voice, points: readonly (readonly [number, number])[], squareMix = 0.35): AudioNode {
  const t = v.t;
  const pitch = v.constant(points[0][1]);
  pitch.offset.setValueAtTime(points[0][1], t);
  for (const [at, hz] of points.slice(1)) {
    pitch.offset.exponentialRampToValueAtTime(Math.max(hz, 1), t + at);
  }
  const mix = v.gain(1);
  const saw = v.osc('sawtooth', 0);
  pitch.connect(saw.frequency);
  saw.connect(v.gain(1 - squareMix)).connect(mix);
  const sq = v.osc('square', 0, 0, 7);
  pitch.connect(sq.frequency);
  sq.connect(v.gain(squareMix * 0.6)).connect(mix);
  return mix;
}

/** Envelope gain with linear segments ([time s, level]). */
function shape(v: Voice, points: readonly (readonly [number, number])[]): GainNode {
  const e = v.gain(0);
  const t = v.t;
  e.gain.setValueAtTime(points[0][1], t);
  for (const [at, level] of points.slice(1)) {
    e.gain.linearRampToValueAtTime(level, t + at);
  }
  return e;
}

/**
 * One purr phrase (~2 s) of a content dragon: a deep, cat-like rumble — a low sawtooth pulsing at ~24 Hz through a
 * throat-like low-pass plus a chest layer an octave down — that swells on the "exhale" and fades on the "inhale".
 * `strength` 0.1..1.2 scales level and depth (affection).
 */
export function playPurr(env: SfxEnv, when: number, strength: number, place: Placement): number {
  const s = clamp(strength, 0.1, 1.2);
  const rng = env.rng;
  const v = new Voice(env, { ...place, reverb: place.reverb * 0.4 }, when, 1);
  const dur = 1.9 + rng() * 0.4;
  const tone = v.osc('sawtooth', 32 + rng() * 5 - 4 * s);
  const pulse = v.gain(0.5);
  const pulseOsc = v.osc('sine', 22 + rng() * 4);
  const pulseDepth = v.gain(0.5);
  pulseOsc.connect(pulseDepth).connect(pulse.gain);
  const lp = v.filter('lowpass', 300, 1.3);
  const body = v.noise(env.noise.brown);
  const bodyLp = v.filter('lowpass', 240, 0.8);
  const bodyGain = v.gain(0.6);
  // Chest layer: an octave below, felt more than heard (the saddle vibrates with it).
  const chest = v.osc('triangle', 17 + rng() * 2);
  const chestGain = v.gain(0.55 * s);
  const e = shape(v, [
    [0, 0],
    [dur * 0.35, 0.9 * s],
    [dur * 0.6, 0.55 * s],
    [dur, 0],
  ]);
  tone.connect(pulse).connect(lp).connect(e);
  body.connect(bodyLp).connect(bodyGain).connect(pulse);
  chest.connect(chestGain).connect(pulse);
  v.toInput(e);
  v.end(dur + 0.1);
  return dur;
}

/** A longer, deeper purr phrase (~2.6 s) for a dragon that has been petted a while: two swells, slower pulse. */
export function playPurrDeep(env: SfxEnv, when: number, strength: number, place: Placement): number {
  const s = clamp(strength, 0.1, 1.3);
  const rng = env.rng;
  const v = new Voice(env, { ...place, reverb: place.reverb * 0.35 }, when, 1);
  const dur = 2.5 + rng() * 0.4;
  const tone = v.osc('sawtooth', 27 + rng() * 3);
  const pulse = v.gain(0.5);
  const pulseOsc = v.osc('sine', 19 + rng() * 3);
  pulseOsc.connect(v.gain(0.5)).connect(pulse.gain);
  const lp = v.filter('lowpass', 260, 1.5);
  const chest = v.osc('triangle', 14.5 + rng());
  const body = v.noise(env.noise.brown);
  const e = shape(v, [
    [0, 0],
    [dur * 0.25, 0.85 * s],
    [dur * 0.45, 0.5 * s],
    [dur * 0.7, 0.95 * s],
    [dur, 0],
  ]);
  tone.connect(pulse);
  chest.connect(v.gain(0.7 * s)).connect(pulse);
  body.connect(v.filter('lowpass', 200, 0.7)).connect(v.gain(0.7)).connect(pulse);
  pulse.connect(lp).connect(e);
  v.toInput(e);
  v.end(dur + 0.1);
  return dur;
}

/** A content chirp: a short, bright upward chirrup from the throat, like a big bird (~0.35 s). */
export function playChirp(env: SfxEnv, when: number, strength: number, place: Placement): number {
  const s = clamp(strength, 0.1, 1.3);
  const rng = env.rng;
  const v = new Voice(env, place, when, 1);
  const dur = 0.32 + rng() * 0.08;
  const f0 = 210 + rng() * 40;
  const src = glottal(v, [
    [0, f0 * 0.8],
    [dur * 0.45, f0 * 1.45],
    [dur, f0 * 1.1],
  ], 0.2);
  const f1 = v.filter('bandpass', 900 + rng() * 150, 3);
  const f2 = v.filter('bandpass', 2300 + rng() * 300, 5);
  const e = shape(v, [
    [0, 0],
    [0.03, 0.55 * s],
    [dur * 0.6, 0.4 * s],
    [dur, 0],
  ]);
  src.connect(f1).connect(e);
  src.connect(f2).connect(v.gain(0.5)).connect(e);
  v.toInput(e);
  v.end(dur + 0.05);
  return dur;
}

/** A curious rising trill: a warbling tone that climbs, with a quick amplitude flutter (~0.6 s). */
export function playTrill(env: SfxEnv, when: number, strength: number, place: Placement): number {
  const s = clamp(strength, 0.1, 1.3);
  const rng = env.rng;
  const v = new Voice(env, place, when, 1);
  const dur = 0.55 + rng() * 0.12;
  const f0 = 170 + rng() * 30;
  const src = glottal(v, [
    [0, f0],
    [dur * 0.7, f0 * 1.8],
    [dur, f0 * 1.95],
  ], 0.25);
  const flutter = v.gain(0.6);
  const lfo = v.osc('sine', 22 + rng() * 6);
  lfo.connect(v.gain(0.4)).connect(flutter.gain);
  const f1 = v.filter('bandpass', 1100, 2.5);
  const e = shape(v, [
    [0, 0],
    [0.05, 0.5 * s],
    [dur * 0.8, 0.45 * s],
    [dur, 0],
  ]);
  src.connect(flutter).connect(f1).connect(e);
  v.toInput(e);
  v.end(dur + 0.05);
  return dur;
}

/** A tired grumble: a low, gravelly growl sliding down, with breath through the nostrils (~1 s). */
export function playGrumble(env: SfxEnv, when: number, strength: number, place: Placement): number {
  const s = clamp(strength, 0.1, 1.3);
  const rng = env.rng;
  const v = new Voice(env, { ...place, reverb: place.reverb * 0.8 }, when, 1);
  const dur = 0.9 + rng() * 0.3;
  const f0 = 62 + rng() * 10;
  const src = glottal(v, [
    [0, f0 * 1.15],
    [dur * 0.3, f0],
    [dur, f0 * 0.72],
  ], 0.5);
  // Gravel: amplitude roughness at ~30 Hz.
  const rough = v.gain(0.6);
  const lfo = v.noise(env.noise.brown, 0, 3);
  lfo.connect(v.gain(1.4)).connect(rough.gain);
  const lp = v.filter('lowpass', 520, 1.2);
  const formant = v.filter('bandpass', 380, 2);
  const breath = v.noise(env.noise.pink);
  const e = shape(v, [
    [0, 0],
    [0.08, 0.8 * s],
    [dur * 0.7, 0.5 * s],
    [dur, 0],
  ]);
  src.connect(rough).connect(lp).connect(e);
  rough.connect(formant).connect(v.gain(0.4)).connect(e);
  breath.connect(v.filter('bandpass', 700, 1.2)).connect(v.gain(0.12 * s)).connect(e);
  v.toInput(e);
  v.end(dur + 0.05);
  return dur;
}

/** A yawn: a long breathy groan that opens up and slides down, the mouth's formant rising as the jaw opens (~2 s). */
export function playYawn(env: SfxEnv, when: number, strength: number, place: Placement): number {
  const s = clamp(strength, 0.1, 1.3);
  const rng = env.rng;
  const v = new Voice(env, { ...place, reverb: place.reverb * 1.1 }, when, 1);
  const t = v.t;
  const dur = 1.8 + rng() * 0.5;
  const f0 = 95 + rng() * 15;
  const src = glottal(v, [
    [0, f0 * 1.3],
    [dur * 0.25, f0 * 1.5],
    [dur, f0 * 0.6],
  ], 0.3);
  const air = v.noise(env.noise.pink);
  const formant = v.filter('bandpass', 400, 2.2);
  formant.frequency.setValueAtTime(380, t);
  formant.frequency.linearRampToValueAtTime(900, t + dur * 0.4);
  formant.frequency.linearRampToValueAtTime(450, t + dur);
  const e = shape(v, [
    [0, 0],
    [dur * 0.2, 0.45 * s],
    [dur * 0.55, 0.55 * s],
    [dur, 0],
  ]);
  src.connect(formant).connect(e);
  air.connect(v.filter('bandpass', 1200, 0.8)).connect(v.gain(0.35 * s)).connect(e);
  v.toInput(e);
  v.end(dur + 0.05);
  return dur;
}

/** A sneeze: a sharp intake, then an explosive noise burst through the nostrils with a short voiced "tchh" (~0.5 s). */
export function playSneeze(env: SfxEnv, when: number, strength: number, place: Placement): number {
  const s = clamp(strength, 0.1, 1.3);
  const rng = env.rng;
  const v = new Voice(env, place, when, 1);
  const t = v.t;
  const dur = 0.45 + rng() * 0.1;
  const burst = v.noise(env.noise.white);
  const bp = v.filter('bandpass', 1800 + rng() * 600, 0.9);
  bp.frequency.setValueAtTime(2600, t + 0.12);
  bp.frequency.exponentialRampToValueAtTime(900, t + dur);
  const e = shape(v, [
    [0, 0.04 * s],
    [0.1, 0.12 * s],
    [0.13, 1 * s],
    [0.2, 0.5 * s],
    [dur, 0],
  ]);
  const voiced = glottal(v, [
    [0, 180],
    [dur, 110],
  ], 0.4);
  const ve = shape(v, [
    [0, 0],
    [0.12, 0],
    [0.15, 0.3 * s],
    [0.3, 0],
  ]);
  burst.connect(bp).connect(e);
  voiced.connect(v.filter('lowpass', 1200, 0.8)).connect(ve);
  v.toInput(e);
  v.toInput(ve);
  v.end(dur + 0.05);
  return dur;
}

/** Jaws snapping shut on air: a hard, woody clack with a short resonance (~0.15 s). */
export function playSnap(env: SfxEnv, when: number, strength: number, place: Placement): number {
  const s = clamp(strength, 0.1, 1.3);
  const rng = env.rng;
  const v = new Voice(env, { ...place, reverb: place.reverb * 1.2 }, when, 1);
  const dur = 0.16;
  const click = v.noise(env.noise.white);
  const bp = v.filter('bandpass', 1400 + rng() * 300, 4);
  const body = v.osc('sine', 180 + rng() * 40);
  const e = shape(v, [
    [0, 0],
    [0.003, 1 * s],
    [0.03, 0.25 * s],
    [dur, 0],
  ]);
  const be = shape(v, [
    [0, 0],
    [0.004, 0.5 * s],
    [0.09, 0],
  ]);
  click.connect(bp).connect(e);
  body.connect(be);
  v.toInput(e);
  v.toInput(be);
  v.end(dur + 0.03);
  return dur;
}

/** A nasal huff: a short puff of air through the nostrils (~0.35 s). */
export function playHuff(env: SfxEnv, when: number, strength: number, place: Placement): number {
  const s = clamp(strength, 0.1, 1.3);
  const rng = env.rng;
  const v = new Voice(env, place, when, 1);
  const dur = 0.3 + rng() * 0.1;
  const air = v.noise(env.noise.pink);
  const bp = v.filter('bandpass', 650 + rng() * 150, 1.4);
  const e = shape(v, [
    [0, 0],
    [0.03, 0.7 * s],
    [dur, 0],
  ]);
  air.connect(bp).connect(e);
  v.toInput(e);
  v.end(dur + 0.03);
  return dur;
}

/** A short, happy roar (~1 s): brighter and higher than the full roar, rising then falling. */
export function playShortRoar(env: SfxEnv, when: number, strength: number, place: Placement): number {
  const s = clamp(strength, 0.1, 1.3);
  const rng = env.rng;
  const v = new Voice(env, { ...place, reverb: place.reverb * 1.5 }, when, 1);
  const dur = 0.95 + rng() * 0.2;
  const f0 = 82 + rng() * 12;
  const src = glottal(v, [
    [0, f0 * 0.8],
    [0.15, f0 * 1.25],
    [dur * 0.6, f0 * 1.15],
    [dur, f0 * 0.7],
  ], 0.45);
  const rough = v.gain(0.7);
  v.noise(env.noise.brown, 0, 4).connect(v.gain(1.1)).connect(rough.gain);
  const f1 = v.filter('bandpass', 520, 1.8);
  const f2 = v.filter('bandpass', 1350, 3);
  const air = v.noise(env.noise.pink);
  const e = shape(v, [
    [0, 0],
    [0.1, 0.9 * s],
    [dur * 0.65, 0.7 * s],
    [dur, 0],
  ]);
  src.connect(rough);
  rough.connect(f1).connect(e);
  rough.connect(f2).connect(v.gain(0.45)).connect(e);
  air.connect(v.filter('bandpass', 1600, 0.9)).connect(v.gain(0.25 * s)).connect(e);
  v.toInput(e);
  v.end(dur + 0.05);
  return dur;
}
