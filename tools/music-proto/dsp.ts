// Small pure-TypeScript DSP toolkit for the music prototype: RNG, FFT, FFT convolution, biquads.

export const SR = 48000;

/** Deterministic PRNG (mulberry32) so every render is reproducible. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gaussian(r: () => number): number {
  const u = Math.max(1e-12, r());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

export const dbToGain = (db: number) => Math.pow(10, db / 20);
export const gainToDb = (g: number) => 20 * Math.log10(Math.max(1e-12, g));
export const centsToRatio = (c: number) => Math.pow(2, c / 1200);
export const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (t: number) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

/** Log-frequency interpolation over a table of [freq, value] points. */
export function interpLog(table: [number, number][], f: number): number {
  if (f <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    if (f <= table[i][0]) {
      const t = Math.log(f / table[i - 1][0]) / Math.log(table[i][0] / table[i - 1][0]);
      return lerp(table[i - 1][1], table[i][1], t);
    }
  }
  return table[table.length - 1][1];
}

// ---------------------------------------------------------------- FFT

const twiddleCache = new Map<number, { cos: Float64Array; sin: Float64Array; rev: Uint32Array }>();

function twiddles(n: number) {
  let t = twiddleCache.get(n);
  if (t) return t;
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / n);
    sin[i] = Math.sin((2 * Math.PI * i) / n);
  }
  const bits = Math.log2(n) | 0;
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  t = { cos, sin, rev };
  twiddleCache.set(n, t);
  return t;
}

/** In-place iterative radix-2 complex FFT. inverse=true also scales by 1/n. */
export function fft(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length;
  const { cos, sin, rev } = twiddles(n);
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  const sgn = inverse ? 1 : -1;
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * step];
        const wi = sgn * sin[k * step];
        const a = start + k;
        const b = a + half;
        const xr = re[b] * wr - im[b] * wi;
        const xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
  }
}

export const nextPow2 = (n: number) => 1 << Math.ceil(Math.log2(Math.max(2, n)));

/** Linear convolution y = x * h via FFT overlap-add. Output length x.length + h.length - 1. */
export function convolve(x: Float32Array, h: Float32Array): Float32Array {
  const hl = h.length;
  const n = Math.max(1 << 14, nextPow2(2 * hl));
  const block = n - hl + 1;
  const hr = new Float64Array(n);
  const hi = new Float64Array(n);
  hr.set(h);
  fft(hr, hi);
  const out = new Float32Array(x.length + hl - 1);
  const br = new Float64Array(n);
  const bi = new Float64Array(n);
  for (let pos = 0; pos < x.length; pos += block) {
    br.fill(0);
    bi.fill(0);
    const len = Math.min(block, x.length - pos);
    let any = false;
    for (let i = 0; i < len; i++) {
      br[i] = x[pos + i];
      if (br[i] !== 0) any = true;
    }
    if (!any) continue;
    fft(br, bi);
    for (let i = 0; i < n; i++) {
      const r = br[i] * hr[i] - bi[i] * hi[i];
      const im = br[i] * hi[i] + bi[i] * hr[i];
      br[i] = r;
      bi[i] = im;
    }
    fft(br, bi, true);
    const lim = Math.min(n, out.length - pos);
    for (let i = 0; i < lim; i++) out[pos + i] += br[i];
  }
  return out;
}

// ---------------------------------------------------------------- Biquad (RBJ cookbook)

export class Biquad {
  b0 = 1;
  b1 = 0;
  b2 = 0;
  a1 = 0;
  a2 = 0;
  z1 = 0;
  z2 = 0;

  set(b0: number, b1: number, b2: number, a0: number, a1: number, a2: number): this {
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
    return this;
  }

  static make(type: 'lp' | 'hp' | 'bp' | 'peak' | 'lowshelf' | 'highshelf', f: number, q = 0.7071, gainDb = 0): Biquad {
    return new Biquad().design(type, f, q, gainDb);
  }

  design(type: 'lp' | 'hp' | 'bp' | 'peak' | 'lowshelf' | 'highshelf', f: number, q = 0.7071, gainDb = 0): this {
    const w = (2 * Math.PI * Math.min(f, SR * 0.49)) / SR;
    const cw = Math.cos(w);
    const sw = Math.sin(w);
    const alpha = sw / (2 * q);
    const A = Math.pow(10, gainDb / 40);
    switch (type) {
      case 'lp':
        return this.set((1 - cw) / 2, 1 - cw, (1 - cw) / 2, 1 + alpha, -2 * cw, 1 - alpha);
      case 'hp':
        return this.set((1 + cw) / 2, -(1 + cw), (1 + cw) / 2, 1 + alpha, -2 * cw, 1 - alpha);
      case 'bp': // constant 0 dB peak gain
        return this.set(alpha, 0, -alpha, 1 + alpha, -2 * cw, 1 - alpha);
      case 'peak':
        return this.set(1 + alpha * A, -2 * cw, 1 - alpha * A, 1 + alpha / A, -2 * cw, 1 - alpha / A);
      case 'lowshelf': {
        const s = 2 * Math.sqrt(A) * alpha;
        return this.set(
          A * (A + 1 - (A - 1) * cw + s),
          2 * A * (A - 1 - (A + 1) * cw),
          A * (A + 1 - (A - 1) * cw - s),
          A + 1 + (A - 1) * cw + s,
          -2 * (A - 1 + (A + 1) * cw),
          A + 1 + (A - 1) * cw - s,
        );
      }
      case 'highshelf': {
        const s = 2 * Math.sqrt(A) * alpha;
        return this.set(
          A * (A + 1 + (A - 1) * cw + s),
          -2 * A * (A - 1 + (A + 1) * cw),
          A * (A + 1 + (A - 1) * cw - s),
          A + 1 - (A - 1) * cw + s,
          2 * (A - 1 - (A + 1) * cw),
          A + 1 - (A - 1) * cw - s,
        );
      }
    }
  }

  process(x: number): number {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }

  run(buf: Float32Array): Float32Array {
    for (let i = 0; i < buf.length; i++) buf[i] = this.process(buf[i]);
    return buf;
  }
}

/** Apply a chain of biquads in place. */
export function filterChain(buf: Float32Array, ...filters: Biquad[]): Float32Array {
  for (const f of filters) f.run(buf);
  return buf;
}

export class StereoBuffer {
  l: Float32Array;
  r: Float32Array;
  constructor(len: number) {
    this.l = new Float32Array(len);
    this.r = new Float32Array(len);
  }
  get length() {
    return this.l.length;
  }
  /** Mix a mono signal in with constant-power pan (-1 left .. +1 right). */
  addMono(src: Float32Array, offset: number, gain: number, pan: number): void {
    const a = ((clamp(pan, -1, 1) + 1) * Math.PI) / 4;
    const gl = Math.cos(a) * gain;
    const gr = Math.sin(a) * gain;
    const n = Math.min(src.length, this.l.length - offset);
    for (let i = 0; i < n; i++) {
      this.l[offset + i] += src[i] * gl;
      this.r[offset + i] += src[i] * gr;
    }
  }
  addStereo(src: StereoBuffer, offset: number, gain: number): void {
    const n = Math.min(src.length, this.l.length - offset);
    for (let i = 0; i < n; i++) {
      this.l[offset + i] += src.l[i] * gain;
      this.r[offset + i] += src.r[i] * gain;
    }
  }
}

export function panGains(pan: number): [number, number] {
  const a = ((clamp(pan, -1, 1) + 1) * Math.PI) / 4;
  return [Math.cos(a), Math.sin(a)];
}
