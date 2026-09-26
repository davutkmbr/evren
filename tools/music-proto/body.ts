// Synthetic body / soundboard impulse responses (modal: sums of exponentially decaying sinusoids) and the room IR.
import { SR, rng, gaussian, Biquad } from './dsp.ts';

export interface Mode {
  f: number;
  t60: number;
  amp: number;
}

export function modalIR(modes: Mode[], seconds: number, direct: number, seed: number): Float32Array {
  const r = rng(seed);
  const n = Math.round(seconds * SR);
  const h = new Float32Array(n);
  for (const m of modes) {
    if (m.f >= SR * 0.45) continue;
    const ph = r() * 2 * Math.PI;
    const decay = Math.exp(-6.9078 / (m.t60 * SR));
    const w = (2 * Math.PI * m.f) / SR;
    // recursive oscillator for speed
    let a = m.amp;
    const c = Math.cos(w),
      s = Math.sin(w);
    let x = Math.cos(ph),
      y = Math.sin(ph);
    const lim = Math.min(n, Math.round(m.t60 * 1.2 * SR));
    for (let i = 0; i < lim; i++) {
      h[i] += a * y;
      const nx = x * c - y * s;
      y = x * s + y * c;
      x = nx;
      a *= decay;
    }
  }
  // normalise energy of the resonant part, then add the direct (bridge) path
  let e = 0;
  for (let i = 0; i < n; i++) e += h[i] * h[i];
  const k = Math.sqrt((1 - direct * direct) / (e || 1));
  for (let i = 0; i < n; i++) h[i] *= k;
  h[0] += direct;
  return h;
}

/** Random modes spread log-uniformly with a spectral envelope and frequency-dependent damping. */
export function randomModes(
  seed: number,
  count: number,
  fLo: number,
  fHi: number,
  env: (f: number) => number,
  t60: (f: number) => number,
): Mode[] {
  const r = rng(seed);
  const out: Mode[] = [];
  for (let i = 0; i < count; i++) {
    const f = fLo * Math.pow(fHi / fLo, (i + r()) / count);
    out.push({ f, t60: t60(f) * (0.7 + 0.6 * r()), amp: env(f) * (0.5 + r()) });
  }
  return out;
}

/**
 * Synthetic room impulse response: early reflections plus a diffuse tail made from band-limited noise with per-band
 * T60 (highs die faster), decorrelated for left and right.
 */
export function roomIR(opts: { seconds: number; predelay: number; t60: [number, number][]; seed: number; early: number }): [Float32Array, Float32Array] {
  const n = Math.round(opts.seconds * SR);
  const out: Float32Array[] = [];
  for (let ch = 0; ch < 2; ch++) {
    const r = rng(opts.seed * 7 + ch * 1013);
    const h = new Float32Array(n);
    const pre = Math.round(opts.predelay * SR);
    for (const [fc, t60] of opts.t60) {
      const bp = Biquad.make('bp', fc, 1.1);
      const decay = Math.exp(-6.9078 / (t60 * SR));
      let a = 1;
      for (let i = pre; i < n; i++) {
        const build = Math.min(1, (i - pre) / (0.035 * SR)); // diffuse build-up
        h[i] += bp.process(gaussian(r)) * a * build;
        a *= decay;
      }
    }
    // early reflections (sparse taps, alternating sides)
    const er = rng(opts.seed * 13 + ch);
    for (let k = 0; k < 14; k++) {
      const t = 0.004 + er() * 0.075;
      const idx = Math.round((t + opts.predelay * 0.4) * SR);
      const amp = opts.early * (0.5 + er()) * Math.exp(-t / 0.05) * (er() < 0.5 ? -1 : 1);
      if (idx < n) h[idx] += amp;
    }
    let e = 0;
    for (let i = 0; i < n; i++) e += h[i] * h[i];
    const k = 1 / Math.sqrt(e || 1);
    for (let i = 0; i < n; i++) h[i] *= k;
    out.push(h);
  }
  return [out[0], out[1]];
}
