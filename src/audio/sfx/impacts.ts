import { clamp } from '../dsp/math';
import { expPoints, percEnv } from '../dsp/envelope';
import { Voice, type Placement, type SfxEnv } from './voice';

/**
 * Large body hitting water: surface slap, plunge "whump" (air cavity collapse), spray hiss with granular
 * modulation, and a cloud of bubble "blips" (Minnaert resonances: short sines with an upward chirp).
 */
export function playSplash(env: SfxEnv, when: number, strength: number, place: Placement): number {
  const s = clamp(strength, 0.1, 1.5);
  const rng = env.rng;
  const v = new Voice(env, { ...place, reverb: place.reverb * 1.2 }, when, 0.9);
  const { noise } = env;
  const t = v.t;

  const slap = v.noise(noise.white);
  const slapBp = v.filter('bandpass', 1400, 0.7);
  const slapEnv = v.gain(0);
  percEnv(slapEnv.gain, t, 1.1 * s, 0.002, 0.09);
  slap.connect(slapBp).connect(slapEnv);
  v.toInput(slapEnv);

  const plunge = v.noise(noise.brown);
  const plungeLp = v.filter('lowpass', 500, 1.2);
  expPoints(plungeLp.frequency, t, [
    [0, 1200],
    [0.12, 420],
    [0.6, 140],
  ]);
  const plungeHp = v.filter('highpass', 45, 0.7);
  const plungeEnv = v.gain(0);
  percEnv(plungeEnv.gain, t + 0.01, 1.2 * s, 0.03, 0.7);
  plunge.connect(plungeHp).connect(plungeLp).connect(plungeEnv);
  v.toInput(plungeEnv);

  const boom = v.osc('sine', 70);
  expPoints(boom.frequency, t, [
    [0, 88],
    [0.25, 44],
  ]);
  const boomEnv = v.gain(0);
  percEnv(boomEnv.gain, t + 0.02, 0.22 * s * (0.55 + 0.6 * place.closeness), 0.02, 0.4);
  boom.connect(boomEnv);
  v.toInput(boomEnv);

  const sprayDur = 0.9 + 0.9 * s;
  for (let side = -1; side <= 1; side += 2) {
    const spray = v.noise(noise.white);
    const hp = v.filter('highpass', 1800 + rng() * 500, 0.5);
    const lp = v.filter('lowpass', 9000, 0.5);
    const grain = v.gain(0.5);
    const grainSrc = v.noise(noise.buffet, 0, 6 + rng() * 3);
    const grainDepth = v.gain(0.5);
    grainSrc.connect(grainDepth).connect(grain.gain);
    const sprayEnv = v.gain(0);
    sprayEnv.gain.setValueAtTime(0, t);
    sprayEnv.gain.linearRampToValueAtTime(0.45 * s, t + 0.06);
    sprayEnv.gain.setTargetAtTime(0, t + 0.12, sprayDur / 4);
    spray.connect(hp).connect(lp).connect(grain).connect(sprayEnv);
    v.toInput(sprayEnv, side * 0.8);
  }

  const bubbles = Math.round(10 + 22 * s);
  for (let i = 0; i < bubbles; i++) {
    const start = 0.05 + Math.pow(rng(), 1.6) * (0.5 + 0.7 * s);
    const f = 500 + Math.pow(rng(), 1.5) * 2600;
    const d = 0.012 + rng() * 0.035;
    const o = v.osc('sine', f, start, 0, d + 0.03);
    o.frequency.setValueAtTime(f, t + start);
    o.frequency.exponentialRampToValueAtTime(f * (1.35 + rng() * 0.5), t + start + d);
    const g = v.gain(0);
    percEnv(g.gain, t + start, (0.05 + rng() * 0.08) * s, 0.001, d);
    o.connect(g);
    v.toInput(g, (rng() * 2 - 1) * 0.9);
  }

  const duration = sprayDur + 0.6;
  v.end(duration);
  return duration;
}

/**
 * Heavy landing: body impact (pink "whump" whose low-pass closes as the mass settles + a low sine drop felt more
 * than heard), claws/scales scraping, gravel debris.
 */
export function playLand(env: SfxEnv, when: number, strength: number, place: Placement): number {
  const s = clamp(strength, 0.1, 1.5);
  const rng = env.rng;
  const v = new Voice(env, place, when, 0.95);
  const { noise } = env;
  const t = v.t;

  const thud = v.osc('sine', 55);
  expPoints(thud.frequency, t, [
    [0, 76],
    [0.06, 52],
    [0.35, 38],
  ]);
  const thudEnv = v.gain(0);
  percEnv(thudEnv.gain, t, 0.4 * s * (0.55 + 0.6 * place.closeness), 0.004, 0.5);
  thud.connect(thudEnv);
  v.toInput(thudEnv);

  const body = v.noise(noise.pink);
  const bodyLp = v.filter('lowpass', 320, 1);
  expPoints(bodyLp.frequency, t, [
    [0, 1100],
    [0.08, 520],
    [0.3, 200],
  ]);
  const bodyHp = v.filter('highpass', 40, 0.7);
  const bodyEnv = v.gain(0);
  percEnv(bodyEnv.gain, t, 1.0 * s, 0.006, 0.45);
  body.connect(bodyHp).connect(bodyLp).connect(bodyEnv);
  v.toInput(bodyEnv);

  for (let side = -1; side <= 1; side += 2) {
    const debris = v.noise(noise.crackle, 0.015, 0.7 + rng() * 0.3);
    const bp = v.filter('bandpass', 2200 + rng() * 1200, 0.6);
    const dEnv = v.gain(0);
    dEnv.gain.setValueAtTime(0, t);
    dEnv.gain.linearRampToValueAtTime(1.4 * s, t + 0.03);
    dEnv.gain.setTargetAtTime(0, t + 0.05, 0.12 + 0.08 * s);
    debris.connect(bp).connect(dEnv);
    v.toInput(dEnv, side * 0.75);

    const scrape = v.noise(noise.pink, 0.01);
    const scrapeBp = v.filter('bandpass', 700 + rng() * 300, 1.4);
    const sEnv = v.gain(0);
    percEnv(sEnv.gain, t + 0.01 + rng() * 0.03, 0.5 * s, 0.01, 0.3);
    scrape.connect(scrapeBp).connect(sEnv);
    v.toInput(sEnv, side * 0.5);
  }

  const duration = 1.2;
  v.end(duration);
  return duration;
}

/** One footfall of a ~6 t quadruped: soft sub thud, padded body impact and a little grit under the claws. */
export function playStep(env: SfxEnv, when: number, strength: number, place: Placement): number {
  const s = clamp(strength, 0.1, 1.2);
  const rng = env.rng;
  const v = new Voice(env, place, when, 0.9);
  const { noise } = env;
  const t = v.t;

  const thud = v.osc('sine', 48, 0, 0, 0.35);
  expPoints(thud.frequency, t, [
    [0, 62],
    [0.18, 40],
  ]);
  const thudEnv = v.gain(0);
  percEnv(thudEnv.gain, t, 0.5 * s * (0.6 + 0.6 * place.closeness), 0.006, 0.28);
  thud.connect(thudEnv);
  v.toInput(thudEnv);

  const pad = v.noise(noise.pink);
  const padLp = v.filter('lowpass', 420, 0.8);
  const padEnv = v.gain(0);
  percEnv(padEnv.gain, t, 0.7 * s, 0.004, 0.16);
  pad.connect(padLp).connect(padEnv);
  v.toInput(padEnv);

  const grit = v.noise(noise.crackle, 0.005, 0.8 + rng() * 0.4);
  const gritBp = v.filter('bandpass', 2600 + rng() * 1400, 0.7);
  const gritEnv = v.gain(0);
  percEnv(gritEnv.gain, t + 0.005, 0.9 * s, 0.003, 0.14);
  grit.connect(gritBp).connect(gritEnv);
  v.toInput(gritEnv, (rng() - 0.5) * 0.6);

  v.end(0.45);
  return 0.45;
}
