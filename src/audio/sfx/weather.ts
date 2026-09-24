import { clamp } from '../dsp/math';
import { expPoints } from '../dsp/envelope';
import { Voice, pickSlot, type Placement, type SfxEnv } from './voice';

/** Strikes at least this strong (within ~3.5 km, see render/weather/lightning.ts) play a recorded crack. */
const NEAR_STRENGTH = 0.72;
/** Recorded clap levels: a near crack ~3 LU under the synthesized one (calmer), far rolls a little clearer. */
const RECORDED_NEAR = 0.45;
const RECORDED_FAR = 1.15;

/** Low pressure swell under a close strike (felt more than heard). */
function subSwell(v: Voice, s: number, level = 1): void {
  const sub = v.osc('sine', 52);
  expPoints(sub.frequency, v.t, [
    [0, 56],
    [2.0, 33],
  ]);
  const subEnv = v.gain(0);
  subEnv.gain.setValueAtTime(0, v.t);
  subEnv.gain.linearRampToValueAtTime(0.28 * level * s * s, v.t + 0.25);
  subEnv.gain.setTargetAtTime(0, v.t + 0.3, 0.8);
  sub.connect(subEnv);
  v.toInput(subEnv);
}

/**
 * Thunder. `strength` 0..1 encodes distance: 1 = a strike a few hundred metres away, 0.2 = a cell kilometres off.
 * Recorded claps from one storm (public/audio/thunder/): a crack for near strikes, rolling rumbles for distant ones,
 * each at a slightly random rate so repeats differ; distance darkens them further through the placement cutoff.
 * Synthesized when the recordings are unavailable. Returns the duration (s).
 */
export function playThunder(env: SfxEnv, when: number, strength: number, place: Placement): number {
  const s = clamp(strength, 0.05, 1);
  const near = s >= NEAR_STRENGTH;
  const sprite = near ? env.samples?.thunderNear : env.samples?.thunderFar;
  if (!sprite) {
    // A strike in the first second of a storm, while the recordings decode, stays silent instead of switching voices.
    return env.samples?.pending('storm') ? 0 : synthThunder(env, when, s, place);
  }
  const rng = env.rng;
  const v = new Voice(env, { ...place, reverb: place.reverb * (near ? 1.2 : 1.5) }, when, 1);
  const slot = pickSlot(sprite, rng);
  // Farther claps also play a little slower: deeper and longer.
  const rate = (near ? 0.97 : 0.9 + 0.1 * s) * (0.96 + 0.08 * rng());
  const src = v.slot(sprite, slot, 0, rate);
  const level = v.gain(near ? RECORDED_NEAR : RECORDED_FAR);
  src.connect(level);
  v.toInput(level);
  // The recorded rolls carry their own low end: the swell only adds weight under the crack.
  if (s > 0.35) {
    subSwell(v, s, 0.5);
  }
  const length = sprite.slots[slot][1] / rate;
  v.end(length + 0.5);
  return length;
}

/**
 * Synthesized thunder:
 *  - tear (near strikes only): a quick run of low-passed noise bursts, the channel ripping open (no bright hiss)
 *  - rolls: several deep brown-noise swells at random times, each sound path of the long, crooked channel arriving
 *    from a different distance; the first is the loudest, later ones soften and darken
 *  - sub: a low pressure swell under a close strike
 * Everything sits below ~1.5 kHz; distance shortens the attack and darkens it further.
 */
function synthThunder(env: SfxEnv, when: number, s: number, place: Placement): number {
  const rng = env.rng;
  const v = new Voice(env, { ...place, reverb: place.reverb * 1.5 }, when, 1);
  const { noise } = env;
  const t = v.t;
  const near = Math.max(0, (s - 0.5) / 0.5);
  const length = 5 + 4 * (1 - s) + rng() * 2;

  if (near > 0) {
    const bursts = 4 + Math.floor(rng() * 4);
    let at = 0;
    for (let i = 0; i < bursts; i++) {
      const src = v.noise(noise.pink, at);
      const lp = v.filter('lowpass', 1400 + 900 * near, 0.7);
      const hp = v.filter('highpass', 110, 0.7);
      const e = v.gain(0);
      const peak = (i === 0 ? 0.75 : 0.35 + 0.3 * rng()) * near;
      e.gain.setValueAtTime(0, t + at);
      e.gain.linearRampToValueAtTime(peak, t + at + 0.006);
      e.gain.setTargetAtTime(0, t + at + 0.01, 0.03 + 0.05 * rng());
      src.connect(hp).connect(lp).connect(e);
      v.toInput(e, (rng() - 0.5) * 0.9);
      at += 0.02 + rng() * 0.07;
    }
  }

  // Rolls: the first arrives with the (near) tear or after a short swell (far), the rest spread over the tail.
  const rolls = 5 + Math.floor(rng() * 4);
  for (let i = 0; i < rolls; i++) {
    const k = i / Math.max(rolls - 1, 1);
    const start = i === 0 ? (near > 0 ? 0.03 : 0.1 + 0.4 * rng()) : length * (0.08 + 0.6 * Math.pow(rng(), 1.3));
    const attack = 0.12 + 0.35 * rng() + 0.3 * (1 - s);
    const hold = 0.5 + 1.6 * rng();
    const level = (i === 0 ? 1 : 0.35 + 0.5 * rng() * (1 - 0.5 * k)) * (0.45 + 0.55 * s);
    const src = v.noise(noise.brown, start);
    const lp = v.filter('lowpass', 200, 0.8);
    expPoints(lp.frequency, t + start, [
      [0, 140 + 520 * s * (i === 0 ? 1 : 0.6)],
      [attack + hold, 70 + 160 * s],
    ]);
    const hp = v.filter('highpass', 38, 0.6);
    const e = v.gain(0);
    e.gain.setValueAtTime(0, t + start);
    e.gain.linearRampToValueAtTime(level, t + start + attack);
    e.gain.setTargetAtTime(0, t + start + attack, hold / 2.5);
    src.connect(hp).connect(lp).connect(e);
    v.toInput(e, (rng() - 0.5) * 1.2);
  }

  if (s > 0.35) {
    subSwell(v, s);
  }

  v.end(length + 1);
  return length;
}
