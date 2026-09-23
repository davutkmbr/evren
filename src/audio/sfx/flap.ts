import { clamp } from '../dsp/math';
import { expPoints, percEnv } from '../dsp/envelope';
import { Voice, type Placement, type SfxEnv } from './voice';

/**
 * One wing beat of a ~20 m span leather-winged dragon, triggered at the start of the downstroke:
 *  - membrane snap: the skin catching air and going taut (band-passed noise with a fast flutter), one per wing
 *  - push: the air mass shoved down (band-passed noise sweeping up then down: the "vwoomp")
 *  - thump: sub-bass pressure pulse felt more than heard (stronger when riding: closeness)
 *  - rush: the displaced air sliding off the trailing edge (soft band-passed tail)
 * Returns the duration in seconds.
 */
export function playFlap(env: SfxEnv, when: number, strength: number, place: Placement): number {
  const s = clamp(strength, 0.05, 1.5);
  const rng = env.rng;
  const v = new Voice(env, place, when, 0.95);
  const { noise } = env;
  const bright = 0.75 + 0.25 * s;

  for (let side = -1; side <= 1; side += 2) {
    const offset = side < 0 ? 0 : 0.006 + rng() * 0.012;

    const snapSrc = v.noise(noise.pink, offset);
    const snapBp = v.filter('bandpass', (850 + rng() * 350) * bright, 0.75);
    const flutter = v.gain(1);
    const flutterOsc = v.osc('square', 34 + rng() * 12, offset);
    const flutterDepth = v.gain(0.6);
    flutterOsc.connect(flutterDepth).connect(flutter.gain);
    const snapEnv = v.gain(0);
    percEnv(snapEnv.gain, v.t + offset, 0.9 * s, 0.004, 0.13 + 0.06 * s);
    snapSrc.connect(snapBp).connect(flutter).connect(snapEnv);
    v.toInput(snapEnv, side * 0.85);

    const crackSrc = v.noise(noise.white, offset);
    const crackBp = v.filter('bandpass', 1900 + rng() * 800, 1.0);
    const crackEnv = v.gain(0);
    percEnv(crackEnv.gain, v.t + offset + 0.002, 0.45 * s * s, 0.001, 0.04);
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

  const thump = v.osc('sine', 60);
  expPoints(thump.frequency, v.t, [
    [0, 66],
    [0.05, 54],
    [0.22, 42],
  ]);
  const thumpEnv = v.gain(0);
  percEnv(thumpEnv.gain, v.t + 0.015, 0.2 * s * (0.5 + 0.9 * place.closeness), 0.015, 0.26);
  thump.connect(thumpEnv);
  v.toInput(thumpEnv);

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
