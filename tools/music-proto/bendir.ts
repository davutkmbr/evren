// Bendir (frame drum with gut snares): modal membrane (circular-membrane mode ratios) with a pitch drop on strong
// hits, centre (düm) vs edge (tek/ka) mode weighting, and snare buzz driven by the membrane motion.
import { SR, rng, gaussian, Biquad, StereoBuffer } from './dsp.ts';

const RATIOS = [1, 1.594, 2.136, 2.296, 2.653, 2.918, 3.156, 3.501, 4.06];
const T60 = [0.45, 0.32, 0.3, 0.22, 0.2, 0.16, 0.14, 0.12, 0.1];
const W_DUM = [1, 0.22, 0.38, 0.08, 0.17, 0.06, 0.08, 0.04, 0.03];
const W_TEK = [0.18, 0.55, 0.45, 0.5, 0.42, 0.38, 0.34, 0.3, 0.25];

export type Stroke = 'dum' | 'tek' | 'ka';

export class Bendir {
  private hits: { t: number; s: Stroke; v: number }[] = [];
  constructor(private o: { seed: number; pan?: number; f1?: number }) {}

  hit(t: number, s: Stroke, v: number): void {
    this.hits.push({ t, s, v });
  }

  /** A soft Sofyan-like cycle (düm – tek ka) at a slow tempo, fading in and out. */
  pattern(from: number, to: number, bpm: number, seed: number): void {
    const r = rng(seed);
    const beat = 60 / bpm;
    const cycles = Math.floor((to - from) / (beat * 4));
    for (let c = 0; c < cycles; c++) {
      const t = from + c * 4 * beat;
      const fade = Math.min(1, (c + 1) / 3, (cycles - c) / 3);
      const hum = () => 0.012 * gaussian(r);
      this.hit(t + hum(), 'dum', 0.8 * fade);
      if (c % 4 === 3) this.hit(t + beat * 1.5 + hum(), 'dum', 0.4 * fade);
      this.hit(t + beat * 2 + hum(), 'tek', 0.55 * fade);
      this.hit(t + beat * 3 + hum(), 'ka', 0.35 * fade);
      if (c % 2 === 1) this.hit(t + beat * 3.5 + hum(), 'ka', 0.22 * fade);
    }
  }

  render(len: number): StereoBuffer {
    const r = rng(this.o.seed);
    const out = new Float32Array(len);
    const f1 = this.o.f1 ?? 64;
    for (const h of this.hits) {
      const start = Math.round(h.t * SR);
      const w = h.s === 'dum' ? W_DUM : W_TEK;
      const tMul = h.s === 'dum' ? 1 : 0.45;
      const n = Math.round(0.9 * SR);
      const mem = new Float32Array(n);
      const drop = h.s === 'dum' ? 0.1 * h.v : 0.03;
      RATIOS.forEach((ratio, k) => {
        let ph = r() * 0.3;
        const dec = Math.exp(-6.9078 / (T60[k] * tMul * SR));
        let a = w[k] * h.v * (0.9 + 0.2 * r());
        const lim = Math.min(n, Math.round(T60[k] * tMul * 1.3 * SR));
        for (let i = 0; i < lim; i++) {
          const f = f1 * ratio * (1 + drop * Math.exp(-i / (0.035 * SR)));
          ph += (2 * Math.PI * f) / SR;
          // hand contact ~2 ms (soft attack, no click)
          const atk = i < 0.002 * SR ? 0.5 - 0.5 * Math.cos((Math.PI * i) / (0.002 * SR)) : 1;
          mem[i] += Math.sin(ph) * a * atk;
          a *= dec;
        }
      });
      // snare buzz: noise gated by membrane displacement
      const bp = Biquad.make('bp', 1500, 0.7);
      const hp = Biquad.make('hp', 700, 0.7);
      let env = 0;
      const buzzLevel = h.s === 'dum' ? 0.1 : 0.07;
      for (let i = 0; i < n; i++) {
        const m = Math.abs(mem[i]);
        env = Math.max(m, env * 0.9995);
        const gate = Math.max(0, m - 0.05 * env) * 1.6;
        mem[i] += hp.process(bp.process(gaussian(r))) * gate * buzzLevel;
      }
      // finger slap on edge strokes
      if (h.s !== 'dum') {
        const sl = Biquad.make('bp', 1600, 1.2);
        for (let i = 0; i < 0.006 * SR; i++) mem[i] += sl.process(gaussian(r)) * h.v * 0.25 * Math.exp(-i / (0.0015 * SR));
      }
      for (let i = 0; i < n && start + i < len; i++) if (start + i >= 0) out[start + i] += mem[i];
    }
    const st = new StereoBuffer(len);
    st.addMono(out, 0, 0.5, this.o.pan ?? 0.05);
    return st;
  }
}
