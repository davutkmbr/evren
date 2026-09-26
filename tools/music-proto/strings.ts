// Digital-waveguide plucked string (extended Karplus–Strong, Jaffe–Smith style).
//
//   excitation ──► (+) ──► delay line (D samples, 4-point Lagrange read, time-varying for bends/vibrato)
//                   ▲                         │
//                   └── g · damp ◄── AP² (dispersion/stiffness) ◄── one-pole loss filter ◄──┘
//
// * Loop gain g and loss-filter pole p are solved so the fundamental decays with T60(f0) and a high reference
//   frequency decays with T60hi: this gives per-string, frequency-dependent damping.
// * Two first-order all-pass sections add stiffness dispersion (slightly stretched partials).
// * The phase delay of the loss filter and all-passes at f0 is subtracted from the delay length, so the string
//   is in tune (verified numerically by `render.ts --test`).
// * Events (pluck, retune/glide, damp, vibrato) are scheduled in samples; the string renders straight into a
//   stereo bus and sleeps when silent.

import { SR, Biquad, rng as mkRng, gaussian } from './dsp.ts';

export interface StringModel {
  /** T60 in seconds of the fundamental, as a function of f0. */
  t60: (f0: number) => number;
  /** T60 in seconds at the high reference frequency. */
  t60Hi: (f0: number) => number;
  /** High reference frequency (Hz); raised automatically to 3·f0 for high strings. */
  fHi: number;
  /** All-pass dispersion coefficient (0 = none, negative = stiffer). */
  dispersion: (f0: number) => number;
}

type Ev =
  | { at: number; kind: 'pluck'; exc: Float32Array; gain: number }
  | { at: number; kind: 'tune'; hz: number; glide: number; retuneLoss: boolean }
  | { at: number; kind: 'damp'; t60: number; fade: number }
  | { at: number; kind: 'undamp' }
  | { at: number; kind: 'vib'; depthCents: number; rate: number; ramp: number };

function lossFilterMag(p: number, w: number): number {
  return (1 - p) / Math.sqrt(1 - 2 * p * Math.cos(w) + p * p);
}

function lossFilterDelay(p: number, w: number): number {
  return Math.atan2(p * Math.sin(w), 1 - p * Math.cos(w)) / w;
}

function allpassDelay(a: number, w: number): number {
  const num = Math.atan2(-Math.sin(w), a + Math.cos(w));
  const den = Math.atan2(-a * Math.sin(w), 1 + a * Math.cos(w));
  let ph = num - den;
  while (ph > 0) ph -= 2 * Math.PI;
  return -ph / w;
}

export class WGString {
  private buf: Float64Array;
  private mask: number;
  private events: Ev[] = [];
  readonly model: StringModel;
  panL = 0.707;
  panR = 0.707;
  /** Detune of this physical string relative to its course, in cents. */
  detuneCents = 0;

  constructor(model: StringModel, lowestHz: number) {
    this.model = model;
    const need = Math.ceil(SR / lowestHz) + 16;
    let size = 1;
    while (size < need) size <<= 1;
    this.buf = new Float64Array(size);
    this.mask = size - 1;
  }

  setPan(pan: number): void {
    const a = ((Math.max(-1, Math.min(1, pan)) + 1) * Math.PI) / 4;
    this.panL = Math.cos(a);
    this.panR = Math.sin(a);
  }

  pluck(atSec: number, exc: Float32Array, gain = 1): void {
    this.events.push({ at: Math.round(atSec * SR), kind: 'pluck', exc, gain });
  }
  tune(atSec: number, hz: number, glideSec = 0, retuneLoss = true): void {
    this.events.push({ at: Math.round(atSec * SR), kind: 'tune', hz, glide: glideSec, retuneLoss });
  }
  damp(atSec: number, t60: number, fadeSec = 0.01): void {
    this.events.push({ at: Math.round(atSec * SR), kind: 'damp', t60, fade: fadeSec });
  }
  undamp(atSec: number): void {
    this.events.push({ at: Math.round(atSec * SR), kind: 'undamp' });
  }
  vibrato(atSec: number, depthCents: number, rate: number, rampSec = 0.3): void {
    this.events.push({ at: Math.round(atSec * SR), kind: 'vib', depthCents, rate, ramp: rampSec });
  }
  get hasEvents(): boolean {
    return this.events.length > 0;
  }

  /** Render the whole event list into the given stereo bus (additively). */
  render(outL: Float32Array, outR: Float32Array): void {
    if (!this.events.length) return;
    const evs = this.events.slice().sort((a, b) => a.at - b.at || order(a) - order(b));
    const buf = this.buf;
    const mask = this.mask;
    const N = outL.length;
    const detune = Math.pow(2, this.detuneCents / 1200);

    let w = 0;
    let hz = 220;
    let hzFrom = 220;
    let hzTo = 220;
    let glideLeft = 0;
    let glideLen = 0;
    let g = 0.99;
    let p = 0.3;
    let apA = 0;
    let damp = 1; // current extra per-sample gain
    let dampTarget = 1;
    let dampStep = 0;
    let vibDepth = 0;
    let vibRate = 5;
    let vibPhase = 0;
    let vibRamp = 1;
    let vibRampInc = 0;
    let lp = 0;
    let ap1x = 0,
      ap1y = 0,
      ap2x = 0,
      ap2y = 0;
    let D = 100;
    const active: { exc: Float32Array; pos: number; gain: number }[] = [];
    let awake = false;
    let quiet = 0;
    let ei = 0;
    let dampT60 = 0; // 0 = undamped

    const setLoss = (f: number) => {
      const m = this.model;
      const t60 = m.t60(f);
      const fHi = Math.min(SR * 0.45, Math.max(m.fHi, 3 * f));
      const t60Hi = Math.min(m.t60Hi(f), t60 * 0.95);
      const w0 = (2 * Math.PI * f) / SR;
      const wh = (2 * Math.PI * fHi) / SR;
      const target = Math.pow(10, (-3 / f) * (1 / t60Hi - 1 / t60));
      let lo = 0,
        hi = 0.995;
      for (let it = 0; it < 40; it++) {
        const mid = (lo + hi) / 2;
        const r = lossFilterMag(mid, wh) / lossFilterMag(mid, w0);
        if (r > target) lo = mid;
        else hi = mid;
      }
      p = (lo + hi) / 2;
      g = Math.pow(10, -3 / (t60 * f)) / lossFilterMag(p, w0);
      apA = m.dispersion(f);
      if (dampT60 > 0) {
        dampTarget = Math.min(1, Math.pow(10, -3 / (dampT60 * SR)) / Math.pow(10, -3 / (t60 * SR)));
        damp = dampTarget;
        dampStep = 0;
      }
    };

    const updateDelay = () => {
      let f = hz;
      if (vibDepth > 0) f *= Math.pow(2, (vibDepth * vibRamp * Math.sin(vibPhase)) / 1200);
      f *= detune;
      const w0 = (2 * Math.PI * f) / SR;
      D = SR / f - lossFilterDelay(p, w0) - (apA !== 0 ? 2 * allpassDelay(apA, w0) : 0);
      if (D < 3) D = 3;
    };

    const BLOCK = 16;
    for (let n = 0; n < N; ) {
      // apply due events
      while (ei < evs.length && evs[ei].at <= n) {
        const e = evs[ei++];
        switch (e.kind) {
          case 'pluck':
            active.push({ exc: e.exc, pos: 0, gain: e.gain });
            awake = true;
            quiet = 0;
            break;
          case 'tune':
            if (e.glide > 0 && awake) {
              hzFrom = hz;
              hzTo = e.hz;
              glideLen = glideLeft = Math.max(1, Math.round(e.glide * SR));
            } else {
              hz = hzTo = e.hz;
              glideLeft = 0;
            }
            if (e.retuneLoss || !awake) setLoss(e.hz * detune);
            break;
          case 'damp': {
            dampT60 = e.t60;
            const f = hz * detune;
            // per-sample multiplier giving the requested T60 overall
            const perSampleTarget = Math.pow(10, -3 / (e.t60 * SR));
            const perSampleNatural = Math.pow(10, -3 / (this.model.t60(f) * SR));
            dampTarget = Math.min(1, perSampleTarget / perSampleNatural);
            const steps = Math.max(1, Math.round(e.fade * SR));
            dampStep = (dampTarget - damp) / steps;
            break;
          }
          case 'undamp':
            dampT60 = 0;
            dampTarget = 1;
            dampStep = (1 - damp) / Math.round(0.004 * SR);
            break;
          case 'vib':
            vibDepth = e.depthCents;
            vibRate = e.rate;
            vibRamp = e.ramp > 0 ? 0 : 1;
            vibRampInc = e.ramp > 0 ? 1 / (e.ramp * SR) : 0;
            break;
        }
      }
      const nextAt = ei < evs.length ? evs[ei].at : N;
      if (!awake) {
        // skip silence up to the next event
        n = nextAt;
        if (ei >= evs.length) break;
        continue;
      }
      const end = Math.min(N, nextAt, n + BLOCK);
      // control-rate update
      if (glideLeft > 0) {
        const t = 1 - glideLeft / glideLen;
        const s = t * t * (3 - 2 * t);
        hz = hzFrom * Math.pow(hzTo / hzFrom, s);
        glideLeft -= end - n;
        if (glideLeft <= 0) hz = hzTo;
      }
      if (vibDepth > 0) {
        vibPhase += (2 * Math.PI * vibRate * (end - n)) / SR;
        vibRamp = Math.min(1, vibRamp + vibRampInc * (end - n));
      }
      updateDelay();
      const Dint = Math.floor(D);
      const frac = D - Dint;
      // 4-point Lagrange coefficients for reading at (w - D): points at offsets Dint+1, Dint, Dint-1, Dint-2
      const d = 1 - frac; // fractional position between x1 (older) and x2 (newer)
      const c0 = (-d * (d - 1) * (d - 2)) / 6;
      const c1 = ((d + 1) * (d - 1) * (d - 2)) / 2;
      const c2 = (-(d + 1) * d * (d - 2)) / 2;
      const c3 = ((d + 1) * d * (d - 1)) / 6;
      const oneMinusP = 1 - p;
      let peak = 0;
      for (; n < end; n++) {
        if (dampStep !== 0) {
          damp += dampStep;
          if ((dampStep > 0 && damp >= dampTarget) || (dampStep < 0 && damp <= dampTarget)) {
            damp = dampTarget;
            dampStep = 0;
          }
        }
        const base = w - Dint - 1;
        const x0 = buf[(base - 1) & mask];
        const x1 = buf[base & mask];
        const x2 = buf[(base + 1) & mask];
        const x3 = buf[(base + 2) & mask];
        const rd = c0 * x0 + c1 * x1 + c2 * x2 + c3 * x3;
        lp = oneMinusP * rd + p * lp;
        let y = lp;
        if (apA !== 0) {
          const o1 = apA * y + ap1x - apA * ap1y;
          ap1x = y;
          ap1y = o1;
          const o2 = apA * o1 + ap2x - apA * ap2y;
          ap2x = o1;
          ap2y = o2;
          y = o2;
        }
        y *= g * damp;
        if (active.length) {
          for (let k = active.length - 1; k >= 0; k--) {
            const a = active[k];
            y += a.exc[a.pos++] * a.gain;
            if (a.pos >= a.exc.length) active.splice(k, 1);
          }
        }
        buf[w & mask] = y;
        w++;
        outL[n] += y * this.panL;
        outR[n] += y * this.panR;
        const ay = y < 0 ? -y : y;
        if (ay > peak) peak = ay;
      }
      if (peak < 2e-6 && active.length === 0) {
        quiet += BLOCK;
        if (quiet > 4096) {
          awake = false;
          buf.fill(0);
          lp = ap1x = ap1y = ap2x = ap2y = 0;
          quiet = 0;
        }
      } else quiet = 0;
    }
  }
}

function order(e: Ev): number {
  // tune before pluck at the same instant; undamp before pluck
  return e.kind === 'tune' ? 0 : e.kind === 'undamp' ? 1 : e.kind === 'damp' ? 2 : e.kind === 'vib' ? 3 : 4;
}

// ---------------------------------------------------------------- excitations

export interface PluckOpts {
  hz: number;
  /** Relative pluck position along the string (0..0.5); sets comb notches. */
  pos: number;
  /** Width of the plectrum contact pulse in ms (narrow = bright). */
  widthMs: number;
  /** Corner of the -6 dB/oct tilt (Hz), models the 1/k spectrum of a released string. */
  tiltHz: number;
  /** Plectrum click/scrape noise level relative to the pulse. */
  noise: number;
  vel: number;
  seed: number;
}

/** Plectrum (mızrap / risha) excitation: raised-cosine contact pulse, pluck-position comb, spectral tilt, click noise. */
export function plectrumExcitation(o: PluckOpts): Float32Array {
  const r = mkRng(o.seed);
  const period = SR / o.hz;
  const W = Math.max(3, Math.round((o.widthMs / 1000) * SR));
  const combD = Math.max(1, Math.round(o.pos * period));
  const len = W + combD + Math.round(0.004 * SR);
  const pulse = new Float32Array(len);
  for (let i = 0; i < W; i++) pulse[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 0.5)) / W);
  // pluck-position comb (1 - z^-βP)
  const e = new Float32Array(len);
  for (let i = 0; i < len; i++) e[i] = pulse[i] - (i >= combD ? pulse[i - combD] : 0);
  // tilt: leaky integrator above tiltHz
  const a = Math.exp((-2 * Math.PI * o.tiltHz) / SR);
  let s = 0;
  let norm = 0;
  for (let i = 0; i < len; i++) {
    s = a * s + (1 - a) * e[i];
    e[i] = s + e[i] * 0.08;
    norm = Math.max(norm, Math.abs(e[i]));
  }
  // click noise (highpassed, 0.6 ms)
  const hp = Biquad.make('hp', 2500, 0.7);
  const nLen = Math.round(0.0015 * SR);
  for (let i = 0; i < nLen; i++) {
    const env = Math.exp(-i / (0.0004 * SR));
    e[i] += hp.process(gaussian(r)) * env * o.noise * norm;
  }
  const k = o.vel / (norm || 1);
  for (let i = 0; i < len; i++) e[i] *= k;
  return e;
}

/** Soft finger/hammer excitation (no plectrum click), for hammer-ons and slides. */
export function softExcitation(hz: number, vel: number, seed: number): Float32Array {
  return plectrumExcitation({ hz, pos: 0.23, widthMs: 2.2, tiltHz: 350, noise: 0, vel, seed });
}
