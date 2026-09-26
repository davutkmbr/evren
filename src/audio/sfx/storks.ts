import { clamp } from '../dsp/math';
import { expPoints, percEnv } from '../dsp/envelope';
import { Voice, type Placement, type SfxEnv } from './voice';

/**
 * White storks (moment "Boğaz'da Leylek Göçü", src/moments/storks), synthesised: storks have no song and are silent
 * in flight almost all the time, so the flock is heard only up close and rarely:
 *  - bill clatter: the stork's only real "voice" (mostly at the nest, now and then in the air): a rapid wooden rattle of
 *    the mandibles, speeding up and slowing down, resonating in the throat;
 *  - a soft wing beat: the deep, slow downstroke heard when a flapping stork is within a few tens of metres;
 *  - an air rush: a gliding stork passing close by.
 */

/** Bill clatter: `strength` 0..1.5 (distance is in `place`). Returns the duration (s). */
export function playStorkClatter(env: SfxEnv, when: number, strength: number, place: Placement): number {
  const s = clamp(strength, 0.1, 1.5);
  const rng = env.rng;
  const v = new Voice(env, place, when, 1);
  const t = v.t;
  const dur = 0.9 + 1.1 * rng();
  // Clap rate: starts around 9 Hz, speeds up to ~15 Hz and settles again (a "machine-gun" rattle).
  const r0 = 8 + 2 * rng();
  const r1 = 13.5 + 3 * rng();
  // One noise source and one hollow "knock" tone, each gated by a train of percussive envelopes.
  const knockSrc = v.noise(env.noise.white);
  const body = v.filter('bandpass', 1050 + 250 * rng(), 3.2);
  const throat = v.filter('peaking', 620 + 120 * rng(), 2.5, 7);
  const knockEnv = v.gain(0);
  knockSrc.connect(body).connect(throat).connect(knockEnv);
  v.toInput(knockEnv, (rng() - 0.5) * 0.3);
  const tick = v.noise(env.noise.white);
  const tickBp = v.filter('bandpass', 2900 + 600 * rng(), 2.2);
  const tickEnv = v.gain(0);
  tick.connect(tickBp).connect(tickEnv);
  v.toInput(tickEnv, (rng() - 0.5) * 0.3);
  const tone = v.osc('triangle', 520 + 90 * rng());
  const toneEnv = v.gain(0);
  tone.connect(toneEnv);
  v.toInput(toneEnv);
  let at = 0;
  let i = 0;
  while (at < dur) {
    const k = at / dur;
    const rate = r0 + (r1 - r0) * Math.sin(Math.PI * Math.min(1, k * 1.3));
    const accent = (i % 2 === 0 ? 1 : 0.78) * (0.8 + 0.4 * rng()) * (k < 0.1 ? 0.6 + 4 * k : k > 0.85 ? (1 - k) / 0.15 : 1);
    percEnv(knockEnv.gain, t + at, 1.1 * s * accent, 0.0015, 0.035);
    percEnv(tickEnv.gain, t + at, 0.35 * s * accent, 0.0008, 0.012);
    percEnv(toneEnv.gain, t + at, 0.12 * s * accent, 0.002, 0.03);
    at += (1 / rate) * (0.92 + 0.16 * rng());
    i++;
  }
  v.end(dur + 0.15);
  return dur;
}

/** One soft downstroke of a stork's wings nearby. */
export function playStorkWingbeat(env: SfxEnv, when: number, strength: number, place: Placement): number {
  const s = clamp(strength, 0.1, 1.5);
  const rng = env.rng;
  const v = new Voice(env, place, when, 1);
  const t = v.t;
  const push = v.noise(env.noise.pink);
  const bp = v.filter('bandpass', 300, 0.9);
  expPoints(bp.frequency, t, [
    [0, 240 + 60 * rng()],
    [0.09, 430 + 80 * rng()],
    [0.34, 190],
  ]);
  const e = v.gain(0);
  percEnv(e.gain, t, 0.9 * s, 0.07, 0.34);
  push.connect(bp).connect(e);
  v.toInput(e);
  // The feathers' faint rustle as the hand feathers separate.
  const rustle = v.noise(env.noise.white);
  const hp = v.filter('bandpass', 3600 + 800 * rng(), 1.3);
  const re = v.gain(0);
  percEnv(re.gain, t + 0.04, 0.12 * s, 0.03, 0.16);
  rustle.connect(hp).connect(re);
  v.toInput(re, (rng() - 0.5) * 0.6);
  v.end(0.5);
  return 0.5;
}

/** Air rushing past as a gliding stork passes within a few metres. `pan` sweeps from `panFrom` to the placement's pan. */
export function playStorkPass(env: SfxEnv, when: number, strength: number, place: Placement, panFrom: number): number {
  const s = clamp(strength, 0.1, 1.5);
  const v = new Voice(env, { ...place, pan: 0 }, when, 1);
  const t = v.t;
  const dur = 0.75;
  const src = v.noise(env.noise.pink);
  const bp = v.filter('bandpass', 900, 1.4);
  expPoints(bp.frequency, t, [
    [0, 650],
    [dur * 0.45, 1900 + 500 * s],
    [dur, 700],
  ]);
  const pan = v.panner(clamp(panFrom, -1, 1));
  pan.pan.setValueAtTime(clamp(panFrom, -1, 1), t);
  pan.pan.linearRampToValueAtTime(clamp(place.pan, -1, 1), t + dur);
  const e = v.gain(0);
  e.gain.setValueAtTime(0, t);
  e.gain.linearRampToValueAtTime(0.55 * s, t + dur * 0.45);
  e.gain.linearRampToValueAtTime(0, t + dur);
  src.connect(bp).connect(e).connect(pan).connect(v.input);
  v.end(dur + 0.1);
  return dur;
}
