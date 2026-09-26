// Ney: breath-driven reed flute. Hybrid model — additive harmonic tone with per-harmonic jitter, "tube-filtered"
// breath noise (noise through time-varying band-passes at the first harmonics) and broadband air hiss. Slow tone
// onset with a scoop from below, legato portamento between notes, delayed breath vibrato, phrase-level breath arcs.
import { SR, rng, gaussian, Biquad, StereoBuffer, clamp, smoothstep } from './dsp.ts';
import { commasToHz, pitchInMakam, type Makam } from './makam.ts';
import type { PerfNote } from './score.ts';

export interface NeyOpts {
  dugahHz: number;
  makam: Makam;
  seed: number;
  pan?: number;
  breath?: number; // relative breath-noise level
}

export class Ney {
  private notes: PerfNote[] = [];
  readonly o: Required<NeyOpts>;
  constructor(o: NeyOpts) {
    this.o = { pan: 0.2, breath: 1, ...o };
  }
  perform(notes: PerfNote[]): void {
    this.notes.push(...notes);
  }

  render(len: number): StereoBuffer {
    const r = rng(this.o.seed);
    const cents = new Float32Array(len); // pitch in cents relative to Dügâh
    const amp = new Float32Array(len); // tone amplitude target
    const noiseEnv = new Float32Array(len);
    const ref = this.o.dugahHz;
    const toCents = (commas: number) => ((commas - 9) * 1200) / 53;

    // group into breath phrases
    const phrases: PerfNote[][] = [];
    for (const n of this.notes) {
      const prev = phrases[phrases.length - 1]?.slice(-1)[0];
      if (!prev || n.first || n.t - (prev.t + prev.dur) > 0.06) phrases.push([n]);
      else phrases[phrases.length - 1].push(n);
    }

    for (const ph of phrases) {
      const t0 = ph[0].t;
      const t1 = ph[ph.length - 1].t + ph[ph.length - 1].dur;
      const i0 = Math.max(0, Math.round((t0 - 0.12) * SR));
      const i1 = Math.min(len, Math.round((t1 + 0.45) * SR));
      // base pitch + amplitude per note
      for (let k = 0; k < ph.length; k++) {
        const n = ph[k];
        const a = Math.round(n.t * SR);
        const b = k + 1 < ph.length ? Math.round(ph[k + 1].t * SR) : i1;
        const c = toCents(n.pitch.commas) + 2 * gaussian(r);
        for (let i = Math.max(i0, k === 0 ? i0 : a); i < b && i < len; i++) {
          cents[i] = c;
          // gentle swell and relax inside long notes (messa di voce)
          const x = (i - a) / Math.max(1, b - a);
          const swell = n.dur > 0.6 ? 1 + 0.12 * Math.sin(Math.PI * Math.min(1, x * 1.4)) - 0.1 * x : 1;
          amp[i] = (0.45 + 0.6 * n.vel) * swell;
        }
        // portamento from previous note
        if (k > 0) {
          const pc = cents[a - 1] ?? c;
          const pd = n.flags['s'] ? 0.2 : 0.05 + 0.03 * r();
          const s0 = Math.round((n.t - pd * 0.35) * SR);
          const s1 = Math.round((n.t + pd * 0.65) * SR);
          const prevC = toCents(ph[k - 1].pitch.commas);
          void pc;
          for (let i = s0; i < s1 && i < len; i++) cents[i] = prevC + (c - prevC) * smoothstep((i - s0) / (s1 - s0));
          // repeated pitch or explicit breath accent: small dip (re-articulation with the breath, ney is not tongued)
          if (Math.abs(prevC - c) < 5 || n.flags['br']) {
            for (let i = a - Math.round(0.05 * SR); i < a + Math.round(0.07 * SR); i++) {
              const x = (i - a) / (0.06 * SR);
              amp[i] *= 1 - 0.45 * Math.exp(-x * x * 3);
            }
          }
        }
        // scoop from below (always at a phrase start, or on request)
        if ((k === 0 || n.flags['sc']) && !n.flags['b']) {
          const depth = 30 + 30 * r();
          const L = Math.round((0.12 + 0.08 * r()) * SR);
          for (let i = a; i < a + L && i < len; i++) cents[i] -= depth * Math.pow(1 - (i - a) / L, 2);
        }
        if (typeof n.flags['b'] === 'string') {
          const from = toCents(pitchInMakam(n.flags['b'], this.o.makam).commas);
          const L = Math.round(0.28 * SR);
          for (let i = a; i < a + L && i < len; i++) cents[i] = from + (c - from) * smoothstep((i - a) / L);
        }
        if (n.flags['c']) {
          const up = c + 180;
          const L = Math.round(0.07 * SR);
          for (let i = a - L; i < a; i++) if (i >= 0) cents[i] = up;
        }
        // breath vibrato on long notes
        if (n.flags['v'] || n.dur > 0.9) {
          const st = a + Math.round((0.3 + 0.15 * r()) * SR);
          const rate = 4.6 + 0.8 * r();
          const depth = 7 + 6 * r();
          let phs = r() * 6;
          for (let i = st; i < b && i < len; i++) {
            const ramp = Math.min(1, (i - st) / (0.5 * SR));
            phs += (2 * Math.PI * rate * (1 + 0.04 * Math.sin(i / SR))) / SR;
            const s = Math.sin(phs);
            cents[i] += depth * ramp * s;
            amp[i] *= 1 + 0.12 * ramp * s;
          }
        }
      }
      // phrase breath envelope
      const atk = 0.16 + 0.1 * r();
      const rel = 0.3 + 0.1 * r();
      const tEndTone = t1;
      for (let i = i0; i < i1; i++) {
        const t = i / SR;
        let e = smoothstep((t - t0) / atk);
        if (t > tEndTone - rel * 0.4) e *= 1 - smoothstep((t - (tEndTone - rel * 0.4)) / rel);
        amp[i] *= e;
        // breath noise leads the tone and lingers a little at the end
        const lead = Math.exp(-Math.max(0, t - (t0 - 0.06)) / 0.12) * (t > t0 - 0.08 ? 1 : 0);
        noiseEnv[i] = 0.2 * amp[i] + 0.35 * lead * (1 - smoothstep((t - t0) / 0.25));
      }
      // hold pitch after the phrase end so the release does not jump
      for (let i = Math.round(t1 * SR); i < i1; i++) if (cents[i] === 0) cents[i] = cents[i - 1];
    }

    // slow intonation drift of the player's breath/embouchure (±3–4 c)
    const dp1 = r() * 6.28,
      dp2 = r() * 6.28;
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      cents[i] += 2.2 * Math.sin(2 * Math.PI * 0.23 * t + dp1) + 1.5 * Math.sin(2 * Math.PI * 0.41 * t + dp2);
    }
    // smooth amplitude (breath inertia ~ 35 ms) and pitch (~ 8 ms)
    onePoleSmooth(amp, 0.035);
    onePoleSmooth(cents, 0.008);

    const out = new Float32Array(len);
    const H = 9;
    const phase = new Float64Array(H);
    const jit = new Float64Array(H);
    const jitT = new Float64Array(H);
    const bp1 = new Biquad();
    const bp2 = new Biquad();
    const bp3 = new Biquad();
    const bp1b = new Biquad();
    const bp2b = new Biquad();
    const bp3b = new Biquad();
    const hiss = Biquad.make('bp', 3800, 0.55);
    const hissLo = Biquad.make('bp', 1400, 0.9);
    const base = [1, 0.3, 0.17, 0.08, 0.055, 0.03, 0.02, 0.012, 0.008];
    const breath = this.o.breath;
    let tubeNorm = 1;
    for (let i = 0; i < len; i++) {
      const a = amp[i];
      const ne = noiseEnv[i];
      if (a < 1e-5 && ne < 1e-5) {
        // keep filters quiet
        continue;
      }
      const f0 = ref * Math.pow(2, cents[i] / 1200);
      if ((i & 63) === 0) {
        bp1.design('bp', f0, 16);
        bp2.design('bp', f0 * 2, 16);
        bp3.design('bp', f0 * 3, 16);
        bp1b.b0 = bp1.b0; bp1b.b1 = bp1.b1; bp1b.b2 = bp1.b2; bp1b.a1 = bp1.a1; bp1b.a2 = bp1.a2;
        bp2b.b0 = bp2.b0; bp2b.b1 = bp2.b1; bp2b.b2 = bp2.b2; bp2b.a1 = bp2.a1; bp2b.a2 = bp2.a2;
        bp3b.b0 = bp3.b0; bp3b.b1 = bp3.b1; bp3b.b2 = bp3.b2; bp3b.a1 = bp3.a1; bp3b.a2 = bp3.a2;
        tubeNorm = Math.sqrt((2 * 16 * SR) / (Math.PI * f0));
        for (let k = 0; k < H; k++) {
          jitT[k] = 1 + 0.12 * gaussian(r);
        }
      }
      // brightness: louder and higher => more upper harmonics; low notes are breathier and darker
      const bright = clamp(0.55 + 0.5 * a + 0.00025 * (f0 - 300), 0.4, 1.15);
      let s = 0;
      for (let k = 0; k < H; k++) {
        const fk = f0 * (k + 1);
        if (fk > 12000) break;
        phase[k] += (2 * Math.PI * fk) / SR;
        if (phase[k] > 6.283185307179586) phase[k] -= 6.283185307179586;
        jit[k] += (jitT[k] - jit[k]) * 0.0008;
        s += Math.sin(phase[k]) * base[k] * Math.pow(bright, k) * jit[k];
      }
      const wn = gaussian(r);
      // band-pass outputs normalised to unit RMS for white input (power of an RBJ band-pass ≈ π f / (Q·SR))
      // each band-pass runs twice (4th order) so the skirts do not smear noise far below the fundamental
      const tube =
        bp1b.process(bp1.process(wn)) * tubeNorm + bp2b.process(bp2.process(wn)) * tubeNorm * 0.45 + bp3b.process(bp3.process(wn)) * tubeNorm * 0.25;
      const lowReg = clamp((350 - f0) / 200, 0, 1); // low ney notes are breathier
      out[i] =
        s * a +
        tube * 0.11 * (1 + 0.8 * lowReg) * (a + 1.5 * ne) * breath +
        (hiss.process(wn) * 0.036 + hissLo.process(wn) * 0.034) * (ne * 2 + 0.1 * a) * (1 + 0.6 * lowReg) * breath;
    }
    // gentle tone shaping: no sub rumble, soft top
    const hp = Biquad.make('hp', 110, 0.7);
    const lp = Biquad.make('lp', 9500, 0.7);
    const pk = Biquad.make('peak', 1800, 1.0, -2);
    hp.run(out);
    lp.run(out);
    pk.run(out);
    const st = new StereoBuffer(len);
    st.addMono(out, 0, 0.35, this.o.pan);
    return st;
  }
}

function onePoleSmooth(x: Float32Array, tau: number): void {
  const a = Math.exp(-1 / (tau * SR));
  let y = x[0];
  for (let i = 0; i < x.length; i++) {
    y = a * y + (1 - a) * x[i];
    x[i] = y;
  }
}
