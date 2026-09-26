import { clamp } from '../dsp/math';
import { expPoints, percEnv } from '../dsp/envelope';
import { Voice, pickSlot, type Placement, type SfxEnv } from './voice';

/** Recorded push level (two flaps pitched further down than a wing beat) against the synthesized one. */
const RECORDED_SNAP_PUSH = 1.1;

/**
 * Wings snapping open out of a dive or free fall: both membranes catching the airstream at once (a deep "whump"
 * with a taut leather crack) and the air mass shoved aside; the push uses the recorded wing flaps when loaded.
 * Returns the duration in seconds.
 */
export function playWingSnap(env: SfxEnv, when: number, strength: number, place: Placement): number {
  const s = clamp(strength, 0.1, 1.5);
  const rng = env.rng;
  const v = new Voice(env, place, when, 1);
  const { noise } = env;
  const t = v.t;
  for (let side = -1; side <= 1; side += 2) {
    const at = side < 0 ? 0 : 0.008 + rng() * 0.01;
    const snap = v.noise(noise.white, at);
    const bp = v.filter('bandpass', 1500 + rng() * 500, 0.9);
    const snapEnv = v.gain(0);
    percEnv(snapEnv.gain, t + at, 0.8 * s, 0.002, 0.08);
    snap.connect(bp).connect(snapEnv);
    v.toInput(snapEnv, side * 0.9);

    const flaps = env.samples?.flaps;
    if (flaps) {
      const src = v.slot(flaps, pickSlot(flaps, rng), at, 0.56 + 0.05 * rng());
      const g = v.gain(RECORDED_SNAP_PUSH * s);
      src.connect(g);
      v.toInput(g, side * 0.6);
      continue;
    }
    const push = v.noise(noise.pink, at);
    const pushBp = v.filter('bandpass', 260, 0.6);
    expPoints(pushBp.frequency, t + at, [
      [0, 200],
      [0.08, 520 + 200 * s],
      [0.5, 160],
    ]);
    const pushEnv = v.gain(0);
    percEnv(pushEnv.gain, t + at, 1.6 * s, 0.03, 0.8);
    push.connect(pushBp).connect(pushEnv);
    v.toInput(pushEnv, side * 0.5);
  }
  const thump = v.osc('sine', 58);
  expPoints(thump.frequency, t, [
    [0, 64],
    [0.3, 38],
  ]);
  const thumpEnv = v.gain(0);
  percEnv(thumpEnv.gain, t, 0.5 * s * (0.5 + 0.5 * place.closeness), 0.01, 0.45);
  thump.connect(thumpEnv);
  v.toInput(thumpEnv);
  v.end(1.2);
  return 1.2;
}

/** Air rushing past during a roll or loop: a band-passed noise sweep that pans across. Returns the duration. */
export function playWhoosh(env: SfxEnv, when: number, strength: number, place: Placement): number {
  const s = clamp(strength, 0.1, 1.5);
  const v = new Voice(env, place, when, 1);
  const t = v.t;
  const dur = 0.9 + 0.3 * s;
  const src = v.noise(env.noise.pink);
  const bp = v.filter('bandpass', 400, 1.1);
  expPoints(bp.frequency, t, [
    [0, 280],
    [dur * 0.45, 900 + 500 * s],
    [dur, 320],
  ]);
  const pan = v.panner(-0.7);
  pan.pan.setValueAtTime(-0.7, t);
  pan.pan.linearRampToValueAtTime(0.7, t + dur);
  const e = v.gain(0);
  e.gain.setValueAtTime(0, t);
  e.gain.linearRampToValueAtTime(0.9 * s, t + dur * 0.45);
  e.gain.linearRampToValueAtTime(0, t + dur);
  src.connect(bp).connect(e).connect(pan).connect(v.input);
  v.end(dur + 0.1);
  return dur;
}

/**
 * A chain burst (phase 20): the air rushing past as the dragon surges forward. Shorter and brighter than the pass-by
 * whoosh, centred (the push is straight ahead): a fast rise of band-passed pink noise whose centre sweeps up with the
 * push, a low body thump under it, and a slower tail. Returns the duration in seconds.
 */
export function playBurstRush(env: SfxEnv, when: number, strength: number, place: Placement): number {
  const s = clamp(strength, 0.2, 1.5);
  const v = new Voice(env, place, when, 1);
  const t = v.t;
  const dur = 0.55 + 0.35 * s;
  const src = v.noise(env.noise.pink);
  const bp = v.filter('bandpass', 500, 0.9);
  expPoints(bp.frequency, t, [
    [0, 420],
    [dur * 0.3, 1400 + 900 * s],
    [dur, 600],
  ]);
  const e = v.gain(0);
  e.gain.setValueAtTime(0, t);
  e.gain.linearRampToValueAtTime(0.85 * s, t + dur * 0.22);
  e.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(bp).connect(e);
  v.toInput(e);
  const thump = v.osc('sine', 72, 0, 0, 0.3);
  thump.frequency.setValueAtTime(95, t);
  thump.frequency.exponentialRampToValueAtTime(52, t + 0.25);
  const tg = v.gain(0);
  percEnv(tg.gain, t, 0.35 * s, 0.012, 0.22);
  thump.connect(tg);
  v.toInput(tg);
  v.end(dur + 0.1);
  return dur;
}

