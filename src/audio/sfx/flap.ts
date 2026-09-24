import { clamp } from '../dsp/math';
import { expPoints, percEnv } from '../dsp/envelope';
import { Voice, pickSlot, type Placement, type SfxEnv } from './voice';

/** Recorded layer levels against the synthesized beat (same event strength): keep the flap-* offline cases in place. */
const RECORDED_FLAP = 0.85;
const RECORDED_WHOOMP = 0.5;

/** Sub-bass pressure pulse felt more than heard (stronger when riding: closeness). */
function thump(v: Voice, s: number, closeness: number, level = 1): void {
  const osc = v.osc('sine', 60);
  expPoints(osc.frequency, v.t, [
    [0, 66],
    [0.05, 54],
    [0.22, 42],
  ]);
  const env = v.gain(0);
  percEnv(env.gain, v.t + 0.015, 0.2 * level * s * (0.5 + 0.9 * closeness), 0.015, 0.26);
  osc.connect(env);
  v.toInput(env);
}

/**
 * One wing beat of a ~20 m span leather-winged dragon, triggered at the start of the downstroke. Recorded
 * (public/audio/flap/): one big cloth flap per wing from a round-robin of ten (2create 670509), pitched down for a
 * 20 m membrane and panned to its side, over a deep flag whoomp (ani_music, felt most when riding) and the synthesized
 * sub thump.
 * Synthesized while the recordings are unavailable. Returns the duration in seconds.
 */
export function playFlap(env: SfxEnv, when: number, strength: number, place: Placement): number {
  const flaps = env.samples?.flaps;
  const whoomps = env.samples?.whoomps;
  if (!flaps || !whoomps) {
    return synthFlap(env, when, strength, place);
  }
  const s = clamp(strength, 0.05, 1.5);
  const rng = env.rng;
  const v = new Voice(env, place, when, 0.95);
  let duration = 0;
  for (let side = -1; side <= 1; side += 2) {
    const offset = side < 0 ? 0 : 0.006 + rng() * 0.012;
    // Pitched down a little for the 20 m membrane; stronger beats push the air harder: a little faster and brighter.
    const rate = (0.78 + 0.1 * Math.min(s, 1)) * (0.97 + 0.06 * rng());
    const slot = pickSlot(flaps, rng);
    const src = v.slot(flaps, slot, offset, rate);
    const g = v.gain(RECORDED_FLAP * s);
    src.connect(g);
    v.toInput(g, side * 0.85);
    duration = Math.max(duration, offset + flaps.slots[slot][1] / rate);
  }
  const slot = pickSlot(whoomps, rng);
  const rate = 0.85 + 0.1 * rng();
  const whoomp = v.slot(whoomps, slot, 0.004, rate);
  // The deep whoomp is mostly felt: it comes through the saddle when riding.
  const wg = v.gain(RECORDED_WHOOMP * s * (0.25 + 0.75 * place.closeness));
  whoomp.connect(wg);
  v.toInput(wg);
  thump(v, s, place.closeness, 0.5);
  duration = Math.max(duration, 0.3, whoomps.slots[slot][1] / rate);
  v.end(duration);
  return duration;
}

/**
 * Synthesized wing beat:
 *  - membrane snap: the skin catching air and going taut (band-passed noise with a fast flutter), one per wing
 *  - push: the air mass shoved down (band-passed noise sweeping up then down: the "vwoomp")
 *  - thump: sub-bass pressure pulse
 *  - rush: the displaced air sliding off the trailing edge (soft band-passed tail)
 */
function synthFlap(env: SfxEnv, when: number, strength: number, place: Placement): number {
  const s = clamp(strength, 0.05, 1.5);
  const rng = env.rng;
  const v = new Voice(env, place, when, 0.95);
  const { noise } = env;
  const bright = 0.75 + 0.25 * s;

  for (let side = -1; side <= 1; side += 2) {
    const offset = side < 0 ? 0 : 0.006 + rng() * 0.012;

    // Membrane going taut: a soft leathery snap with a gentle ripple (a square-wave flutter here buzzed).
    const snapSrc = v.noise(noise.pink, offset);
    const snapBp = v.filter('bandpass', (520 + rng() * 180) * bright, 0.6);
    const flutter = v.gain(1);
    const flutterOsc = v.osc('sine', 18 + rng() * 8, offset);
    const flutterDepth = v.gain(0.22);
    flutterOsc.connect(flutterDepth).connect(flutter.gain);
    const snapEnv = v.gain(0);
    percEnv(snapEnv.gain, v.t + offset, 0.5 * s, 0.012, 0.16 + 0.06 * s);
    snapSrc.connect(snapBp).connect(flutter).connect(snapEnv);
    v.toInput(snapEnv, side * 0.85);

    const crackSrc = v.noise(noise.pink, offset);
    const crackBp = v.filter('bandpass', 1100 + rng() * 300, 0.8);
    const crackEnv = v.gain(0);
    percEnv(crackEnv.gain, v.t + offset + 0.004, 0.1 * s * s, 0.004, 0.05);
    crackSrc.connect(crackBp).connect(crackEnv);
    v.toInput(crackEnv, side * 0.9);

    const pushSrc = v.noise(noise.pink, offset + 0.01);
    const pushBp = v.filter('bandpass', 200, 0.7);
    expPoints(pushBp.frequency, v.t + offset, [
      [0, 170],
      [0.07, 380 + 330 * s],
      [0.25, 260 + 90 * s],
      [0.6, 150],
    ]);
    const pushEnv = v.gain(0);
    percEnv(pushEnv.gain, v.t + offset + 0.01, 1.5 * s, 0.06, 0.5 + 0.12 * s);
    pushSrc.connect(pushBp).connect(pushEnv);
    v.toInput(pushEnv, side * 0.4);
  }

  thump(v, s, place.closeness);

  const rush = v.noise(noise.pink, 0.04);
  const rushBp = v.filter('bandpass', 600, 0.6);
  expPoints(rushBp.frequency, v.t + 0.04, [
    [0, 900 + 400 * s],
    [0.5, 320],
  ]);
  const rushEnv = v.gain(0);
  percEnv(rushEnv.gain, v.t + 0.05, 0.45 * s, 0.1, 0.6);
  rush.connect(rushBp).connect(rushEnv);
  v.toInput(rushEnv, (rng() - 0.5) * 0.4);

  const duration = 0.85 + 0.2 * s;
  v.end(duration);
  return duration;
}
