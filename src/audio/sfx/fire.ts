import { clamp } from '../dsp/math';
import { expPoints, percEnv } from '../dsp/envelope';
import { Voice, type Placement, type SfxEnv } from './voice';

/** Gas ignition "whoomph" played when the fire breath starts (the loop itself lives in voices/fire.ts). */
export function playIgnition(env: SfxEnv, when: number, strength: number, place: Placement): number {
  const s = clamp(strength, 0.2, 1.3);
  const v = new Voice(env, { ...place, reverb: place.reverb * 1.3 }, when, 0.9);
  const { noise } = env;
  const t = v.t;

  const whoomph = v.noise(noise.brown);
  const lp = v.filter('lowpass', 200, 1.4);
  expPoints(lp.frequency, t, [
    [0, 160],
    [0.09, 2600],
    [0.35, 900],
    [0.9, 400],
  ]);
  const hp = v.filter('highpass', 40, 0.7);
  const wEnv = v.gain(0);
  percEnv(wEnv.gain, t, 1.9 * s, 0.05, 0.8);
  whoomph.connect(hp).connect(lp).connect(wEnv);
  v.toInput(wEnv);

  const flare = v.noise(noise.pink);
  const bp = v.filter('bandpass', 900, 0.7);
  expPoints(bp.frequency, t, [
    [0, 400],
    [0.12, 2200],
    [0.6, 1200],
  ]);
  const fEnv = v.gain(0);
  percEnv(fEnv.gain, t + 0.02, 0.8 * s, 0.07, 0.6);
  flare.connect(bp).connect(fEnv);
  v.toInput(fEnv, 0.3);

  const thump = v.osc('sine', 70);
  expPoints(thump.frequency, t, [
    [0, 80],
    [0.2, 42],
  ]);
  const tEnv = v.gain(0);
  percEnv(tEnv.gain, t + 0.02, 0.35 * s * (0.6 + 0.6 * place.closeness), 0.02, 0.3);
  thump.connect(tEnv);
  v.toInput(tEnv);

  const duration = 1.1;
  v.end(duration);
  return duration;
}
