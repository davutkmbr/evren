import { driveCurve } from '../dsp/curves';
import { linearPoints } from '../dsp/envelope';
import { Voice, type Placement, type SfxEnv } from './voice';

let gullDrive: Float32Array<ArrayBuffer> | null = null;
const GULL_LEVEL = 0.42;

interface GullNote {
  start: number;
  dur: number;
  /** Nominal fundamental (Hz). */
  f: number;
  amp: number;
  /** Pitch the note swoops up to, then falls toward (ratios of f). */
  rise: number;
  fall: number;
  /** Breath-noise share 0..1 (alarm notes are mostly noise). */
  noise: number;
}

function gullNotes(rng: () => number, base: number): GullNote[] {
  const notes: GullNote[] = [];
  const type = rng();
  if (type < 0.45) {
    // Long call: a drawn "kyaaow" (big swoop up, long fall), then a run of "kya" notes, irregularly spaced and
    // mostly speeding up while they fade.
    const d0 = 0.32 + rng() * 0.16;
    notes.push({ start: 0, dur: d0, f: base, amp: 1, rise: 1.16 + rng() * 0.1, fall: 0.6 + rng() * 0.08, noise: 0.45 });
    let t = d0 + 0.07 + rng() * 0.1;
    let gap = 0.12 + rng() * 0.06;
    const n = 3 + Math.floor(rng() * 5);
    for (let i = 0; i < n; i++) {
      const d = (0.11 + rng() * 0.07) * (1 - i * 0.03);
      notes.push({
        start: t,
        dur: d,
        f: base * (1.08 + rng() * 0.1 - i * 0.012),
        amp: (0.9 - i * 0.07) * (0.8 + rng() * 0.35),
        rise: 1.06 + rng() * 0.08,
        fall: 0.76 + rng() * 0.1,
        noise: 0.45 + rng() * 0.25,
      });
      gap *= 0.84 + rng() * 0.3;
      t += d + Math.max(0.05, gap);
    }
  } else if (type < 0.8) {
    // Alarm "kek-kek-kek": short, low, harsh, mostly noise.
    let t = 0;
    const n = 3 + Math.floor(rng() * 4);
    for (let i = 0; i < n; i++) {
      const d = 0.07 + rng() * 0.05;
      notes.push({ start: t, dur: d, f: base * (0.76 + rng() * 0.08), amp: 0.75 + rng() * 0.25, rise: 1.05, fall: 0.84, noise: 0.75 + rng() * 0.2 });
      t += d + 0.07 + rng() * 0.1;
    }
  } else {
    // Mew: one long plaintive descending note.
    notes.push({ start: 0, dur: 0.55 + rng() * 0.25, f: base * 1.05, amp: 0.95, rise: 1.1, fall: 0.64, noise: 0.35 });
  }
  return notes;
}

/**
 * Yellow-legged gull (the Istanbul gull). Harsh, noisy voice: a sawtooth "syrinx" (plus an occasional subharmonic:
 * period doubling) on curved pitch swoops with irregular jitter, breath noise with a consonant burst at each onset,
 * random rasp AM, a hard asymmetric drive and two nasal formants; harmonics reach 6-8 kHz. Call types:
 * long call ("kyaaow" + "kya" run), alarm ("kek-kek"), mew (one long falling note).
 */
export function playGull(env: SfxEnv, when: number, place: Placement): number {
  const rng = env.rng;
  const v = new Voice(env, place, when, 0.5);
  const t0 = v.t;
  // Deeper than the herring gull: long-call notes around 0.75-1 kHz.
  const base = 740 + rng() * 260;
  const notes = gullNotes(rng, base);

  // One pitch contour drives the fundamental (and the subharmonic): irregular jitter rides on it.
  const pitch = v.constant(base);
  const jitter = v.gain(base * 0.03);
  v.noise(env.noise.buffet, 0, 5 + rng() * 4).connect(jitter).connect(pitch.offset);
  const tone = v.gain(0);
  const saw = v.osc('sawtooth', 0);
  pitch.connect(saw.frequency);
  saw.connect(tone);
  if (rng() < 0.4) {
    const sub = v.osc('sawtooth', 0);
    const subPitch = v.gain(0.5);
    const subLevel = v.gain(0.2 + rng() * 0.15);
    pitch.connect(subPitch).connect(sub.frequency);
    sub.connect(subLevel).connect(tone);
  }
  const breathBp = v.filter('bandpass', 2300 + rng() * 900, 0.7);
  const breath = v.gain(0);
  v.noise(env.noise.white, 0, 0.9 + rng() * 0.2).connect(breathBp).connect(breath);

  const rough = v.gain(0.6);
  const roughDepth = v.gain(0.4);
  v.noise(env.noise.buffet, 0, 3 + rng() * 3).connect(roughDepth).connect(rough.gain);
  tone.connect(rough);
  breath.connect(rough);
  const drive = v.shaper((gullDrive ??= driveCurve(3, 0.25)));
  const f1 = v.filter('peaking', 1700 + rng() * 500, 1.6, 7);
  const f2 = v.filter('peaking', 3400 + rng() * 800, 2.2, 5);
  const hp = v.filter('highpass', 600, 0.7);
  const lp = v.filter('lowpass', 8000, 0.6);
  const out = v.gain(GULL_LEVEL);
  rough.connect(drive).connect(f1).connect(f2).connect(hp).connect(lp).connect(out);
  v.toInput(out);

  const fp = pitch.offset;
  let end = 0;
  for (const n of notes) {
    const s = t0 + n.start;
    const d = n.dur;
    // Curved contour: a fast exponential swoop up, then a slower fall that starts at a random point.
    fp.setValueAtTime(n.f * (0.78 + rng() * 0.08), s);
    fp.setTargetAtTime(n.f * n.rise, s, d * (0.05 + rng() * 0.05));
    fp.setTargetAtTime(n.f * n.fall, s + d * (0.25 + rng() * 0.2), d * (0.35 + rng() * 0.2));
    const att = 0.008 + rng() * 0.025;
    const a = n.amp;
    linearPoints(tone.gain, s, [
      [0, 0],
      [att, a * 0.3],
      [d * (0.3 + rng() * 0.15), a * (0.24 + rng() * 0.06)],
      [d * 0.8, a * 0.18],
      [d, 0],
    ]);
    const b = a * n.noise;
    linearPoints(breath.gain, s, [
      [0, 0],
      [0.006, b * 1.7],
      [0.022 + rng() * 0.01, b * 1.15],
      [d * 0.6, b * 0.9],
      [d, 0],
    ]);
    end = Math.max(end, n.start + d);
  }
  v.end(end + 0.1);
  return end;
}

/** Distant two-tone car horn (Istanbul traffic), sometimes a double honk. */
export function playCarHorn(env: SfxEnv, when: number, place: Placement): number {
  const rng = env.rng;
  const v = new Voice(env, place, when, 3.5);
  const f1 = 380 + rng() * 60;
  const f2 = f1 * (1.22 + rng() * 0.06);
  const body = v.filter('bandpass', 950 + rng() * 300, 1.1);
  const lp = v.filter('lowpass', 2600, 0.7);
  const out = v.gain(1);
  body.connect(lp).connect(out);
  v.toInput(out);
  const honks = rng() < 0.35 ? 2 : 1;
  let t = 0;
  for (let h = 0; h < honks; h++) {
    const d = honks === 2 ? 0.12 + rng() * 0.08 : 0.22 + rng() * 0.35;
    for (const f of [f1, f2]) {
      const o = v.osc('square', f, t, (rng() - 0.5) * 10, d + 0.06);
      const g = v.gain(0);
      linearPoints(g.gain, v.t + t, [
        [0, 0],
        [0.012, 0.09],
        [d, 0.08],
        [d + 0.035, 0],
      ]);
      o.connect(g).connect(body);
    }
    t += d + 0.09;
  }
  v.end(t + 0.1);
  return t;
}

/**
 * Bosphorus ferry (vapur) horn: ~70-80 m vessel, so a 130-350 Hz whistle (COLREGs Annex III). Rich harmonic
 * tone with a slight pitch scoop at the onset, breathy air noise, and hill echoes via a feedback delay.
 */
export function playFerryHorn(env: SfxEnv, when: number, place: Placement): number {
  const rng = env.rng;
  const v = new Voice(env, { ...place, reverb: place.reverb * 1.8 }, when, 0.2);
  const t = v.t;
  const f = 150 + rng() * 40;
  const hold = 2.0 + rng() * 1.5;
  const total = 0.35 + hold + 0.9;

  const mix = v.gain(1);
  const tones: Array<[OscillatorType, number, number, number]> = [
    ['sawtooth', 1, 0, 0.3],
    ['sawtooth', 1, 7, 0.25],
    ['square', 1, -5, 0.12],
    ['sawtooth', 1.498, 3, 0.07],
  ];
  for (const [type, ratio, det, level] of tones) {
    const o = v.osc(type, f * ratio, 0, det);
    o.frequency.setValueAtTime(f * ratio * 0.93, t);
    o.frequency.exponentialRampToValueAtTime(f * ratio, t + 0.3);
    o.frequency.setValueAtTime(f * ratio, t + 0.35 + hold);
    o.frequency.exponentialRampToValueAtTime(f * ratio * 0.96, t + total);
    const g = v.gain(level);
    o.connect(g).connect(mix);
  }
  const air = v.noise(env.noise.pink);
  const airBp = v.filter('bandpass', f * 4, 6);
  const airG = v.gain(0.35);
  air.connect(airBp).connect(airG).connect(mix);

  const resonance = v.filter('peaking', 420, 1.5, 6);
  const lp = v.filter('lowpass', 1400, 0.7);
  const amp = v.gain(0);
  linearPoints(amp.gain, t, [
    [0, 0],
    [0.35, 1],
    [0.35 + hold, 0.95],
    [total, 0],
  ]);
  mix.connect(resonance).connect(lp).connect(amp);
  v.toInput(amp);

  const delay = v.delay(0.9 + rng() * 0.6);
  const fb = v.gain(0.28);
  const echoLp = v.filter('lowpass', 700, 0.6);
  const echoOut = v.gain(0.45);
  amp.connect(delay);
  delay.connect(echoLp).connect(fb).connect(delay);
  echoLp.connect(echoOut);
  v.toInput(echoOut, -0.4);

  const tail = total + 3.5;
  v.end(tail);
  return tail;
}
