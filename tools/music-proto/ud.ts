// Ud: fretless, double-course waveguide strings plucked with a risha; slides (portamento on a ringing string),
// hammer-ons / pull-offs, vibrato, risha tremolo, finger damping and a deep bowl-back body.
import { rng, gaussian, interpLog, convolve, StereoBuffer, clamp } from './dsp.ts';
import { WGString, plectrumExcitation, softExcitation, type StringModel } from './strings.ts';
import { commasToHz, pitchInMakam, type Makam } from './makam.ts';
import type { PerfNote } from './score.ts';
import { modalIR, randomModes, type Mode } from './body.ts';
import { blendIR } from './kanun.ts';

const UD_STRING: StringModel = {
  // stopped (fingered) fretless notes: flesh damping keeps the sustain shorter than a kanun's
  t60: (f) =>
    interpLog(
      [
        [70, 3.4],
        [140, 2.7],
        [280, 2.0],
        [560, 1.3],
        [1100, 0.8],
      ],
      f,
    ),
  t60Hi: (f) => interpLog([[80, 0.3], [300, 0.21], [800, 0.14]], f),
  fHi: 2400,
  dispersion: (f) => -interpLog([[70, 0.3], [200, 0.18], [600, 0.06]], f),
};

interface Voice {
  strings: WGString[];
  hz: number;
  lastT: number;
}

export interface UdOpts {
  dugahHz: number;
  makam: Makam;
  seed: number;
  pan?: number;
}

export class Ud {
  private voices: Voice[] = [];
  private vi = 0;
  private r: () => number;
  private seedN = 1;
  readonly o: Required<UdOpts>;

  constructor(o: UdOpts) {
    this.o = { pan: 0, ...o };
    this.r = rng(o.seed);
    for (let i = 0; i < 5; i++) {
      const d = 0.6 + this.r() * 1.0;
      const strings = [0, 1].map((k) => {
        const s = new WGString(UD_STRING, 50);
        s.detuneCents = k === 0 ? -d / 2 : d / 2;
        s.setPan(this.o.pan + (k === 0 ? -0.06 : 0.06) + (i - 2) * 0.02);
        return s;
      });
      this.voices.push({ strings, hz: 0, lastT: -10 });
    }
  }

  private hz(n: PerfNote): number {
    // fretless: AEU/practice pitch plus a little human intonation scatter
    return commasToHz(n.pitch.commas, this.o.dugahHz) * Math.pow(2, (2.2 * gaussian(this.r)) / 1200);
  }

  private strike(v: Voice, t: number, hz: number, vel: number, down = true): void {
    const r = this.r;
    const first = r() < 0.5 ? 0 : 1;
    v.strings.forEach((s, k) => {
      const idx = k === 0 ? first : 1 - first;
      const exc = plectrumExcitation({
        hz,
        pos: 0.13 + 0.07 * r(),
        widthMs: (down ? 1.25 : 1.05) - 0.5 * vel + 0.1 * r(),
        tiltHz: (down ? 1 : 1.15) * (600 + 1700 * vel * vel),
        noise: 0.18 + 0.2 * vel,
        vel: vel * 0.5 * (0.85 + 0.15 * r()),
        seed: this.o.seed * 1000 + this.seedN++,
      });
      v.strings[idx].pluck(t + k * (0.0006 + 0.001 * r()), exc);
    });
  }

  perform(notes: PerfNote[]): void {
    const r = this.r;
    let cur: Voice | null = null;
    for (const n of notes) {
      const f = n.flags;
      const hz = this.hz(n);
      const t = n.t + 0.004 * gaussian(r);
      const legato = cur && n.prev && (f['s'] || f['h']) && n.t - (n.prev.t + n.prev.dur) < 0.05;
      if (legato && cur) {
        for (const s of cur.strings) s.vibrato(t - 0.05, 0, 5);
        if (f['s']) {
          const g = clamp(0.45 * (n.prev?.dur ?? 0.3), 0.06, 0.16);
          for (const s of cur.strings) s.tune(t - g * 0.6, hz, g, false);
          // the sliding finger adds a whisper of energy
          cur.strings[0].pluck(t, softExcitation(hz, n.vel * 0.06, this.seedN++));
        } else {
          for (const s of cur.strings) s.tune(t, hz, 0.012, false);
          const down = hz < cur.hz;
          for (const s of cur.strings) s.pluck(t + 0.001, softExcitation(hz, n.vel * (down ? 0.2 : 0.16), this.seedN++));
        }
        cur.hz = hz;
      } else {
        // new stroke; the finger leaving the previous note damps it (unless asked to ring)
        if (cur && !f['r']) for (const s of cur.strings) s.damp(t + 0.012, 0.22, 0.03);
        const v = this.voices[this.vi++ % this.voices.length];
        for (const s of v.strings) {
          s.vibrato(t - 0.01, 0, 5);
          s.undamp(t - 0.006);
          if (f['c'] || f['cl']) {
            // çarpma: strike the neighbour, then hammer/pull to the note
            const nb = this.neighbour(n, f['c'] ? 1 : -1);
            s.tune(t - 0.07, nb);
            s.tune(t, hz, 0.01, false);
          } else s.tune(t - 0.004, hz);
        }
        if (f['c'] || f['cl']) {
          this.strike(v, t - 0.07, this.neighbour(n, f['c'] ? 1 : -1), n.vel * 0.85);
          for (const s of v.strings) s.pluck(t + 0.001, softExcitation(hz, n.vel * 0.18, this.seedN++));
        } else this.strike(v, t, hz, n.vel);
        v.hz = hz;
        cur = v;
      }
      if (f['v'] && n.dur > 0.45) {
        const depth = 9 + 7 * r();
        for (const s of cur.strings) s.vibrato(t + 0.16 + 0.1 * r(), depth, 4.9 + 0.8 * r(), 0.35);
      }
      if (f['tr']) {
        const rate = 13 + 2 * r();
        const endT = t + n.dur * 0.9;
        let k = 1;
        for (let tt = t + 1 / rate; tt < endT; tt += (1 / rate) * (1 + 0.06 * gaussian(r)), k++) {
          const x = (tt - t) / (endT - t);
          const sw = 0.45 + 0.3 * Math.sin(Math.PI * Math.pow(x, 0.7)) - 0.1 * x;
          this.strike(cur, tt, hz, n.vel * sw * (k % 2 ? 0.8 : 1), k % 2 === 0);
        }
      }
      cur.lastT = t;
    }
  }

  private neighbour(n: PerfNote, dir: number): number {
    // nearest scale step of the makam above/below (by course letter)
    const sc = this.o.makam.ascending.map((p) => pitchInMakam(p, this.o.makam));
    const all = [-1, 0, 1].flatMap((o) => sc.map((p) => ({ commas: p.commas + 53 * o, course: p.course + 7 * o })));
    const target = all.find((p) => p.course === n.pitch.course + dir);
    const commas = target ? target.commas : n.pitch.commas + dir * 9;
    return commasToHz(commas, this.o.dugahHz);
  }

  render(len: number): StereoBuffer {
    const bus = new StereoBuffer(len);
    for (const v of this.voices) for (const s of v.strings) s.render(bus.l, bus.r);
    const out = new StereoBuffer(len);
    const irL = udBody(this.o.seed);
    const irR = blendIR(irL, udBody(this.o.seed + 5), 0.2);
    out.l.set(convolve(bus.l, irL).subarray(0, len));
    out.r.set(convolve(bus.r, irR).subarray(0, len));
    return out;
  }
}

/** Ud body: strong Helmholtz air mode of the bowl, low top-plate modes, highs rolled off (warm, woody). */
export function udBody(seed: number): Float32Array {
  const fixed: Mode[] = [
    { f: 104, t60: 0.28, amp: 1.3 },
    { f: 196, t60: 0.2, amp: 0.8 },
    { f: 262, t60: 0.16, amp: 0.75 },
    { f: 338, t60: 0.14, amp: 0.6 },
    { f: 425, t60: 0.12, amp: 0.5 },
    { f: 530, t60: 0.1, amp: 0.45 },
    { f: 655, t60: 0.09, amp: 0.4 },
  ];
  const rnd = randomModes(
    seed,
    60,
    150,
    6000,
    (f) => 0.6 / (1 + Math.pow(f / 900, 1.6)),
    (f) => Math.max(0.015, 0.2 * Math.pow(200 / f, 0.5)),
  );
  return modalIR([...fixed, ...rnd], 0.5, 0.35, seed);
}
