// Offline analysis used to validate renders without listening: loudness (ITU-R BS.1770-4), peaks, DC, pitch, decay.
import { SR, fft, nextPow2 } from './dsp.ts';

/** Integrated loudness (LUFS) per BS.1770-4 with K-weighting and absolute/relative gating (48 kHz). */
export function integratedLufs(chs: Float32Array[]): number {
  const kw = chs.map((x) => kWeight(x));
  const block = Math.round(0.4 * SR);
  const hop = Math.round(0.1 * SR);
  const powers: number[] = [];
  for (let s = 0; s + block <= kw[0].length; s += hop) {
    let z = 0;
    for (const c of kw) {
      let acc = 0;
      for (let i = s; i < s + block; i++) acc += c[i] * c[i];
      z += acc / block;
    }
    powers.push(z);
  }
  const lk = (p: number) => -0.691 + 10 * Math.log10(p);
  const abs = powers.filter((p) => lk(p) > -70);
  if (!abs.length) return -Infinity;
  const meanAbs = abs.reduce((a, b) => a + b, 0) / abs.length;
  const relGate = lk(meanAbs) - 10;
  const rel = abs.filter((p) => lk(p) > relGate);
  return lk(rel.reduce((a, b) => a + b, 0) / rel.length);
}

/** Short-term (3 s) loudness maximum, useful to see how dynamic the piece is. */
export function maxShortTermLufs(chs: Float32Array[]): number {
  const kw = chs.map((x) => kWeight(x));
  const block = 3 * SR;
  const hop = Math.round(0.5 * SR);
  let best = -Infinity;
  for (let s = 0; s + block <= kw[0].length; s += hop) {
    let z = 0;
    for (const c of kw) {
      let acc = 0;
      for (let i = s; i < s + block; i++) acc += c[i] * c[i];
      z += acc / block;
    }
    best = Math.max(best, -0.691 + 10 * Math.log10(z));
  }
  return best;
}

function kWeight(x: Float32Array): Float32Array {
  // BS.1770 stage 1 (high shelf) and stage 2 (RLB high-pass) coefficients for 48 kHz
  const y = new Float32Array(x.length);
  let z1 = 0,
    z2 = 0,
    w1 = 0,
    w2 = 0;
  const [b0, b1, b2, a1, a2] = [1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585];
  const [c0, c1, c2, d1, d2] = [1.0, -2.0, 1.0, -1.99004745483398, 0.99007225036621];
  for (let i = 0; i < x.length; i++) {
    const s1 = b0 * x[i] + z1;
    z1 = b1 * x[i] - a1 * s1 + z2;
    z2 = b2 * x[i] - a2 * s1;
    const s2 = c0 * s1 + w1;
    w1 = c1 * s1 - d1 * s2 + w2;
    w2 = c2 * s1 - d2 * s2;
    y[i] = s2;
  }
  return y;
}

/** 4x oversampled true-peak estimate (windowed-sinc interpolation). */
export function truePeak(x: Float32Array): number {
  const taps = 12;
  const os = 4;
  const kern: Float64Array[] = [];
  for (let ph = 0; ph < os; ph++) {
    const k = new Float64Array(2 * taps);
    for (let j = -taps + 1; j <= taps; j++) {
      const t = j - ph / os;
      const sinc = t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t);
      const win = 0.5 + 0.5 * Math.cos((Math.PI * t) / (taps + 1));
      k[j + taps - 1] = sinc * win;
    }
    kern.push(k);
  }
  let peak = 0;
  for (let i = taps; i < x.length - taps; i++) {
    const a = Math.abs(x[i]);
    if (a > peak) peak = a;
    if (a < peak * 0.5) continue;
    for (let ph = 1; ph < os; ph++) {
      const k = kern[ph];
      let s = 0;
      for (let j = -taps + 1; j <= taps; j++) s += x[i + j] * k[j + taps - 1];
      const as = Math.abs(s);
      if (as > peak) peak = as;
    }
  }
  return peak;
}

export interface Stats {
  seconds: number;
  lufs: number;
  maxShortTerm: number;
  samplePeakDb: number;
  truePeakDb: number;
  rmsDb: number;
  dc: [number, number];
  clipped: number;
  centroidHz: number;
  stereoCorrelation: number;
}

export function stats(l: Float32Array, r: Float32Array): Stats {
  let peak = 0,
    ss = 0,
    dl = 0,
    dr = 0,
    clipped = 0,
    lr = 0,
    ll = 0,
    rr = 0;
  for (let i = 0; i < l.length; i++) {
    const a = Math.max(Math.abs(l[i]), Math.abs(r[i]));
    if (a > peak) peak = a;
    if (a >= 0.9999) clipped++;
    ss += l[i] * l[i] + r[i] * r[i];
    dl += l[i];
    dr += r[i];
    lr += l[i] * r[i];
    ll += l[i] * l[i];
    rr += r[i] * r[i];
  }
  const db = (v: number) => 20 * Math.log10(Math.max(1e-12, v));
  return {
    seconds: l.length / SR,
    lufs: integratedLufs([l, r]),
    maxShortTerm: maxShortTermLufs([l, r]),
    samplePeakDb: db(peak),
    truePeakDb: db(Math.max(truePeak(l), truePeak(r))),
    rmsDb: db(Math.sqrt(ss / (2 * l.length))),
    dc: [dl / l.length, dr / r.length],
    clipped,
    centroidHz: spectralCentroid(l, r),
    stereoCorrelation: lr / Math.sqrt(ll * rr + 1e-20),
  };
}

export function spectralCentroid(l: Float32Array, r: Float32Array): number {
  const n = 8192;
  let num = 0,
    den = 0;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let s = 0; s + n <= l.length; s += n * 2) {
    for (let i = 0; i < n; i++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
      re[i] = (l[s + i] + r[s + i]) * 0.5 * w;
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 1; k < n / 2; k++) {
      const m = Math.hypot(re[k], im[k]);
      num += m * ((k * SR) / n);
      den += m;
    }
  }
  return den ? num / den : 0;
}

/**
 * Fundamental estimate near an expected frequency: Hann window, 16x zero-padded FFT, parabolic interpolation on the
 * log magnitude of the strongest peak within ±60 cents of the expectation.
 */
export function estimatePitch(x: Float32Array, start: number, len: number, expectHz: number): number {
  const n = nextPow2(len) * 16;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < len; i++) re[i] = (x[start + i] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / len));
  fft(re, im);
  const binHz = SR / n;
  const lo = Math.floor((expectHz * Math.pow(2, -60 / 1200)) / binHz);
  const hi = Math.ceil((expectHz * Math.pow(2, 60 / 1200)) / binHz);
  let best = lo;
  let bm = -Infinity;
  const mag = (k: number) => Math.log(Math.hypot(re[k], im[k]) + 1e-20);
  for (let k = lo; k <= hi; k++) {
    const m = mag(k);
    if (m > bm) {
      bm = m;
      best = k;
    }
  }
  const a = mag(best - 1),
    b = mag(best),
    c = mag(best + 1);
  const off = (0.5 * (a - c)) / (a - 2 * b + c);
  return (best + off) * binHz;
}

/** T60 estimate from the broadband energy envelope (T20: fit from -5 to -25 dB after the peak, extrapolated). */
export function estimateT60(x: Float32Array, start = 0, maxLen = x.length): number {
  const win = Math.round(0.01 * SR);
  const env: number[] = [];
  for (let s = start; s + win <= Math.min(x.length, start + maxLen); s += win) {
    let e = 0;
    for (let i = s; i < s + win; i++) e += x[i] * x[i];
    env.push(10 * Math.log10(e / win + 1e-30));
  }
  let pk = 0;
  for (let i = 1; i < env.length; i++) if (env[i] > env[pk]) pk = i;
  const top = env[pk];
  let i5 = -1,
    i25 = -1;
  for (let i = pk; i < env.length; i++) {
    if (i5 < 0 && env[i] <= top - 5) i5 = i;
    if (i25 < 0 && env[i] <= top - 25) {
      i25 = i;
      break;
    }
  }
  if (i5 < 0 || i25 < 0) return NaN;
  // least-squares slope over [i5, i25]
  let sx = 0,
    sy = 0,
    sxx = 0,
    sxy = 0,
    m = 0;
  for (let i = i5; i <= i25; i++) {
    const t = i * 0.01;
    sx += t;
    sy += env[i];
    sxx += t * t;
    sxy += t * env[i];
    m++;
  }
  const slope = (m * sxy - sx * sy) / (m * sxx - sx * sx);
  return -60 / slope;
}
