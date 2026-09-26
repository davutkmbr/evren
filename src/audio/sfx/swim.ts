import { clamp } from '../dsp/math';
import { expPoints, percEnv } from '../dsp/envelope';
import { randRange } from '../dsp/rng';
import { Voice, type Placement, type SfxEnv } from './voice';

/**
 * One wing stroke of a swimming dragon (phase 21 stage 5, swimming v2): the big open wing catching the water, pushing
 * it back, then lifting out. A full, deep stroke (tok), never a slap:
 *  - whump: at the catch, a low sine body (55-70 Hz, dropping a third) with a short low-passed thud of noise over it:
 *    the weight of a wing the size of a sail meeting the water;
 *  - swoosh: pink noise through a band sweeping up ~170 -> ~370 Hz, a gentle 40-80 ms swell and a decay that follows the
 *    power stroke (`power`, s);
 *  - push: brown noise low-passed at ~170 Hz under it, the mass of moved water, held through the power stroke;
 *  - gurgle: a few low bubble blips (Minnaert resonances 150-470 Hz with an upward chirp) through the push;
 *  - trickle: as the wing lifts out on the recovery (~0.9 x power later), a faint high hiss and a run of droplets thinning
 *    out over 0.35-0.7 s.
 * Each one is varied in length, colour, droplet count and pan. `strength` 0..1 is the stroke strength.
 */
export function playPaddle(env: SfxEnv, when: number, strength: number, place: Placement, power: number): number {
  const s = clamp(strength, 0.05, 1.2);
  const pw = clamp(power, 0.25, 1.4);
  const rng = env.rng;
  const v = new Voice(env, place, when, 0.9);
  const { noise } = env;
  const t = v.t;

  const attack = clamp(0.12 * pw, 0.04, 0.08) * randRange(rng, 0.85, 1.15);
  const decay = (0.18 + 0.2 * pw) * randRange(rng, 0.85, 1.2);
  // The catch: a deep, full body under the stroke.
  const whumpAt = randRange(rng, 0.01, 0.03);
  const whumpF = randRange(rng, 55, 70) * (0.95 + 0.1 * s);
  const whumpDecay = (0.22 + 0.12 * pw) * randRange(rng, 0.9, 1.15);
  const body = v.osc('sine', whumpF, whumpAt, 0, whumpDecay + 0.1);
  body.frequency.setValueAtTime(whumpF, t + whumpAt);
  body.frequency.exponentialRampToValueAtTime(whumpF * 0.68, t + whumpAt + whumpDecay);
  const bodyEnv = v.gain(0);
  percEnv(bodyEnv.gain, t + whumpAt, 0.42 * s * (0.65 + 0.5 * place.closeness), 0.018, whumpDecay);
  body.connect(bodyEnv);
  v.toInput(bodyEnv);
  const thud = v.noise(noise.brown, whumpAt);
  const thudLp = v.filter('lowpass', randRange(rng, 110, 150), 1.1);
  const thudEnv = v.gain(0);
  percEnv(thudEnv.gain, t + whumpAt, 0.5 * s * (0.6 + 0.5 * place.closeness), 0.012, 0.16 + 0.06 * pw);
  thud.connect(thudLp).connect(thudEnv);
  v.toInput(thudEnv);

  const f0 = randRange(rng, 150, 190) * (0.9 + 0.2 * s);
  const swoosh = v.noise(noise.pink);
  const bp = v.filter('bandpass', f0, randRange(rng, 0.8, 1.2));
  expPoints(bp.frequency, t, [
    [0, f0],
    [attack + 0.6 * pw, f0 * randRange(rng, 1.9, 2.3)],
  ]);
  const swooshEnv = v.gain(0);
  swooshEnv.gain.setValueAtTime(0, t);
  swooshEnv.gain.linearRampToValueAtTime(0.38 * s, t + attack);
  swooshEnv.gain.setTargetAtTime(0, t + attack + 0.08 * pw, decay / 2.5);
  swoosh.connect(bp).connect(swooshEnv);
  v.toInput(swooshEnv, (rng() * 2 - 1) * 0.2);

  const push = v.noise(noise.brown);
  const pushLp = v.filter('lowpass', 170, 0.9);
  const pushHp = v.filter('highpass', 32, 0.7);
  const pushEnv = v.gain(0);
  pushEnv.gain.setValueAtTime(0, t);
  pushEnv.gain.linearRampToValueAtTime(0.75 * s * (0.7 + 0.5 * place.closeness), t + attack * 1.4);
  pushEnv.gain.setTargetAtTime(0, t + attack * 1.4 + 0.12 * pw, decay / 2);
  push.connect(pushHp).connect(pushLp).connect(pushEnv);
  v.toInput(pushEnv);

  const blips = Math.round(2 + 4 * s * rng());
  for (let i = 0; i < blips; i++) {
    const start = attack + rng() * 0.5 * pw;
    const f = 150 + Math.pow(rng(), 1.4) * 320;
    const d = 0.03 + rng() * 0.05;
    const o = v.osc('sine', f, start, 0, d + 0.03);
    o.frequency.setValueAtTime(f, t + start);
    o.frequency.exponentialRampToValueAtTime(f * (1.25 + rng() * 0.35), t + start + d);
    const g = v.gain(0);
    percEnv(g.gain, t + start, (0.03 + rng() * 0.04) * s, 0.006, d);
    o.connect(g);
    v.toInput(g, (rng() * 2 - 1) * 0.5);
  }

  // The wing lifting out of the water: droplets and a thin trickle.
  const lift = 0.9 * pw * randRange(rng, 0.9, 1.1);
  const spread = randRange(rng, 0.35, 0.7);
  const hiss = v.noise(noise.white, lift);
  const hissHp = v.filter('highpass', randRange(rng, 2200, 3000), 0.6);
  const hissLp = v.filter('lowpass', 7000, 0.6);
  const hissEnv = v.gain(0);
  hissEnv.gain.setValueAtTime(0, t + lift);
  hissEnv.gain.linearRampToValueAtTime(0.05 * s, t + lift + 0.06);
  hissEnv.gain.setTargetAtTime(0, t + lift + 0.08, spread / 3);
  hiss.connect(hissHp).connect(hissLp).connect(hissEnv);
  v.toInput(hissEnv, (rng() * 2 - 1) * 0.6);
  const drops = Math.round(4 + 10 * s * (0.6 + 0.4 * rng()));
  for (let i = 0; i < drops; i++) {
    const x = Math.pow(rng(), 1.5);
    const start = lift + x * spread;
    const f = 900 + Math.pow(rng(), 1.3) * 2300;
    const d = 0.01 + rng() * 0.025;
    const o = v.osc('sine', f, start, 0, d + 0.02);
    o.frequency.setValueAtTime(f, t + start);
    o.frequency.exponentialRampToValueAtTime(f * (1.3 + rng() * 0.4), t + start + d);
    const g = v.gain(0);
    percEnv(g.gain, t + start, (0.02 + rng() * 0.03) * s * (1 - 0.6 * x), 0.001, d);
    o.connect(g);
    v.toInput(g, (rng() * 2 - 1) * 0.8);
  }

  const duration = Math.max(attack + decay * 2, lift + spread) + 0.3;
  v.end(duration);
  return duration;
}

/**
 * A swimming dragon blowing out through its nostrils now and then: a breathy, nasal "pfff" (pink noise band sweeping
 * down 1.5 kHz -> 700 Hz, fluttered at ~26 Hz by the nostrils), a low chest rumble under it and a fine spray of water
 * blown off the snout. ~0.9 s, varied each time.
 */
export function playSnort(env: SfxEnv, when: number, strength: number, place: Placement): number {
  const s = clamp(strength, 0.2, 1.2);
  const rng = env.rng;
  const v = new Voice(env, place, when, 0.85);
  const { noise } = env;
  const t = v.t;

  const hold = randRange(rng, 0.1, 0.22);
  const air = v.noise(noise.pink);
  const bp = v.filter('bandpass', 1500, 0.9);
  expPoints(bp.frequency, t, [
    [0, randRange(rng, 1300, 1700)],
    [hold + 0.35, randRange(rng, 620, 780)],
  ]);
  const flutter = v.gain(0.75);
  const flutterOsc = v.osc('sine', randRange(rng, 22, 30));
  const flutterDepth = v.gain(0.25);
  flutterOsc.connect(flutterDepth).connect(flutter.gain);
  const airEnv = v.gain(0);
  airEnv.gain.setValueAtTime(0, t);
  airEnv.gain.linearRampToValueAtTime(0.42 * s, t + 0.035);
  airEnv.gain.setTargetAtTime(0.3 * s, t + 0.05, 0.08);
  airEnv.gain.setTargetAtTime(0, t + 0.05 + hold, 0.12);
  air.connect(bp).connect(flutter).connect(airEnv);
  v.toInput(airEnv);

  const rumble = v.noise(noise.brown);
  const rLp = v.filter('lowpass', 160, 0.9);
  const rEnv = v.gain(0);
  percEnv(rEnv.gain, t + 0.01, 0.35 * s * (0.6 + 0.6 * place.closeness), 0.05, 0.3 + hold);
  rumble.connect(rLp).connect(rEnv);
  v.toInput(rEnv);

  const spray = v.noise(noise.white, 0.02);
  const sHp = v.filter('highpass', 3200, 0.6);
  const sEnv = v.gain(0);
  percEnv(sEnv.gain, t + 0.02, 0.08 * s, 0.02, 0.18 + hold * 0.5);
  spray.connect(sHp).connect(sEnv);
  v.toInput(sEnv, (rng() * 2 - 1) * 0.3);
  const drops = Math.round(3 + 5 * rng());
  for (let i = 0; i < drops; i++) {
    const start = 0.12 + rng() * (0.4 + hold);
    const f = 1200 + rng() * 2200;
    const d = 0.01 + rng() * 0.02;
    const o = v.osc('sine', f, start, 0, d + 0.02);
    o.frequency.setValueAtTime(f, t + start);
    o.frequency.exponentialRampToValueAtTime(f * (1.3 + rng() * 0.3), t + start + d);
    const g = v.gain(0);
    percEnv(g.gain, t + start, (0.015 + rng() * 0.025) * s, 0.001, d);
    o.connect(g);
    v.toInput(g, (rng() * 2 - 1) * 0.7);
  }

  const duration = 0.9 + hold;
  v.end(duration);
  return duration;
}
