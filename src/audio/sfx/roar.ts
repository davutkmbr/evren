import { driveCurve } from '../dsp/curves';
import { clamp } from '../dsp/math';
import { expPoints, linearPoints } from '../dsp/envelope';
import { Voice, type Placement, type SfxEnv } from './voice';

let cachedDrive: Float32Array<ArrayBuffer> | null = null;

/**
 * Dragon roar modelled like a big-cat / crocodilian vocalization scaled up:
 *  - glottal source: detuned sawtooth stack on a shared pitch contour (rise, strained hold, falling tail) with
 *    vibrato + random jitter, a period-doubled subharmonic that grows mid-roar (nonlinear phonation) and an
 *    inharmonic component for chaos
 *  - growl: 20-30 Hz amplitude modulation (roughness) on source, breath noise and a low throat rattle,
 *    plus slow random loudness fluctuation (an animal never holds a perfectly steady roar)
 *  - asymmetric saturation (rasp), then a long-vocal-tract formant bank whose F1/F2 open with the jaw
 *  - chest resonance on the fundamental (35-65 Hz, felt when riding), and a big reverb send for the tail over the city
 * Returns the duration in seconds.
 */
export function playRoar(env: SfxEnv, when: number, intensity: number, place: Placement): number {
  const rng = env.rng;
  const k = clamp(intensity, 0.2, 1.3);
  const dur = 2.2 + rng() * 0.7 + 0.3 * k;
  const f0 = 58 * (0.9 + rng() * 0.2);
  const formantScale = 0.92 + rng() * 0.16;
  const v = new Voice(env, { ...place, reverb: place.reverb * 1.7 }, when, 1);
  const t = v.t;
  const { noise } = env;

  const pitch = v.constant(f0);
  expPoints(pitch.offset, t, [
    [0, f0 * 0.6],
    [0.16, f0 * 0.95],
    [0.42, f0 * 1.14],
    [dur * 0.55, f0 * 1.02],
    [dur * 0.82, f0 * 0.82],
    [dur, f0 * 0.5],
  ]);
  const jitterSrc = v.noise(noise.buffet, 0, 1.4);
  const jitter = v.gain(f0 * 0.05);
  jitterSrc.connect(jitter).connect(pitch.offset);
  const vib = v.osc('sine', 4.6 + rng() * 1.2);
  const vibDepth = v.gain(f0 * 0.018);
  vib.connect(vibDepth).connect(pitch.offset);

  const source = v.gain(0.75);
  const addOsc = (type: OscillatorType, ratio: number, detune: number, level: number): OscillatorNode => {
    const o = v.osc(type, 0, 0, detune);
    const r = v.gain(ratio);
    pitch.connect(r).connect(o.frequency);
    const g = v.gain(level);
    o.connect(g).connect(source);
    return o;
  };
  addOsc('sawtooth', 1, 0, 0.42);
  addOsc('sawtooth', 1, 14, 0.32);
  addOsc('sawtooth', 2.003, -6, 0.12);
  addOsc('triangle', 1.414, 0, 0.1);
  const sub = v.osc('sawtooth', 0);
  const subRatio = v.gain(0.5);
  pitch.connect(subRatio).connect(sub.frequency);
  const subLevel = v.gain(0);
  linearPoints(subLevel.gain, t, [
    [0, 0],
    [0.35, 0.05],
    [dur * 0.45, 0.38],
    [dur * 0.75, 0.3],
    [dur, 0.12],
  ]);
  sub.connect(subLevel).connect(source);

  const growlRate = 22 + rng() * 9;
  const growl = v.osc('sine', growlRate);
  const growlDepth = v.gain(0);
  linearPoints(growlDepth.gain, t, [
    [0, 0.15],
    [0.4, 0.5],
    [dur * 0.6, 0.35],
    [dur, 0.6],
  ]);
  growl.connect(growlDepth).connect(source.gain);

  const breathSrc = v.noise(noise.pink);
  const breathBp = v.filter('bandpass', 1100 * formantScale, 0.6);
  const breath = v.gain(0.55);
  growlDepth.connect(breath.gain);
  breathSrc.connect(breathBp).connect(breath);

  const rattleSrc = v.noise(noise.brown, 0, 1);
  const rattleBp = v.filter('bandpass', 260 * formantScale, 1.1);
  const rattle = v.gain(0.9);
  growlDepth.connect(rattle.gain);
  rattleSrc.connect(rattleBp).connect(rattle);

  const preDrive = v.gain(2.4 + 0.8 * k);
  source.connect(preDrive);
  breath.connect(preDrive);
  rattle.connect(preDrive);
  cachedDrive ??= driveCurve(3.4, 0.22);
  const shaped = v.shaper(cachedDrive, '4x');
  preDrive.connect(shaped);
  const shaper = v.filter('highpass', 45, 0.7);
  shaped.connect(shaper);

  const tract = v.gain(0.55);
  const jawOpen = Math.min(0.5, dur * 0.2);
  const formants: Array<[number, number, number, number, number]> = [
    [240, 430, 290, 4.5, 1.0],
    [640, 930, 700, 5.5, 0.78],
    [1500, 1750, 1450, 7, 0.4],
    [2500, 2750, 2400, 8, 0.16],
  ];
  for (const [fStart, fOpen, fEnd, q, g] of formants) {
    const bp = v.filter('bandpass', fStart * formantScale, q);
    expPoints(bp.frequency, t, [
      [0, fStart * formantScale],
      [jawOpen, fOpen * formantScale],
      [dur * 0.7, fOpen * formantScale * 0.96],
      [dur, fEnd * formantScale],
    ]);
    const fg = v.gain(g * Math.sqrt(q));
    shaper.connect(bp).connect(fg).connect(tract);
  }
  const body = v.filter('lowpass', 330, 0.7);
  const bodyGain = v.gain(0.3);
  shaper.connect(body).connect(bodyGain).connect(tract);

  const amp = v.gain(0);
  linearPoints(amp.gain, t, [
    [0, 0],
    [0.09, 0.55],
    [0.3, 1],
    [dur * 0.6, 0.9],
    [dur * 0.85, 0.55],
    [dur, 0],
  ]);
  const unsteady = v.gain(1);
  const unsteadySrc = v.noise(noise.buffet, 0, 0.35 + rng() * 0.2);
  const unsteadyDepth = v.gain(0.22);
  unsteadySrc.connect(unsteadyDepth).connect(unsteady.gain);
  tract.connect(unsteady).connect(amp);
  v.toInput(amp);

  const chest = v.osc('sine', 0);
  const chestRatio = v.gain(1);
  pitch.connect(chestRatio).connect(chest.frequency);
  const chestEnv = v.gain(0);
  const chestLevel = 0.1 + 0.16 * place.closeness;
  linearPoints(chestEnv.gain, t, [
    [0, 0],
    [0.25, chestLevel],
    [dur * 0.7, chestLevel * 0.85],
    [dur, 0],
  ]);
  chest.connect(chestEnv);
  v.toInput(chestEnv);

  v.end(dur + 0.05);
  return dur;
}
