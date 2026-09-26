// Kanun: 3-string courses of waveguide strings, mandal tuning, mızrap plucks, tremolo, octave doubling, glissando,
// mandal/fingernail bends, sympathetic resonance of the undamped courses and a modal fish-skin/soundboard body.
import { SR, rng, gaussian, interpLog, convolve, Biquad, StereoBuffer, clamp } from './dsp.ts';
import { WGString, plectrumExcitation, type StringModel } from './strings.ts';
import { kanunMandalCents, pitchInMakam, type Makam } from './makam.ts';
import type { PerfNote } from './score.ts';
import { modalIR, randomModes, type Mode } from './body.ts';

// Nylon kanun strings over a fish-skin bridge: long low sustain, strongly damped highs.
const KANUN_STRING: StringModel = {
  t60: (f) =>
    interpLog(
      [
        [90, 6.0],
        [180, 4.6],
        [360, 3.2],
        [720, 2.0],
        [1440, 1.2],
      ],
      f,
    ),
  t60Hi: (f) => interpLog([[100, 0.5], [400, 0.38], [1500, 0.3]], f),
  fHi: 3500,
  dispersion: (f) => -interpLog([[90, 0.28], [300, 0.16], [1000, 0.06]], f),
};

interface Course {
  strings: WGString[];
  hz: number; // current mandal pitch (course centre)
  lastPluck: number;
}

export interface KanunOpts {
  dugahHz: number;
  makam: Makam;
  seed: number;
  pan?: number; // centre of the instrument in the stereo field
  spread?: number; // low strings to one side, high strings to the other
  sympathetic?: number; // sympathetic resonance send level
}

export class Kanun {
  private courses = new Map<number, Course>();
  private r: () => number;
  private seedN = 1;
  private symCourses = new Map<number, number>(); // course -> hz of its default mandal setting
  readonly o: Required<KanunOpts>;

  constructor(o: KanunOpts) {
    this.o = { pan: -0.1, spread: 0.5, sympathetic: 1, ...o };
    this.r = rng(o.seed);
    // default mandal setting from the makam scale (all octaves)
    const scale = [...o.makam.ascending];
    for (let oct = -1; oct <= 1; oct++) {
      for (const name of scale) {
        const marks = oct > 0 ? "'" : oct < 0 ? ',' : '';
        const p = pitchInMakam(name + marks, o.makam);
        if (p.course < -6 || p.course > 16) continue;
        if (!this.symCourses.has(p.course)) this.symCourses.set(p.course, this.hzOf(p.commas));
      }
    }
  }

  hzOf(commas: number): number {
    return this.o.dugahHz * Math.pow(2, kanunMandalCents(commas) / 1200);
  }

  private course(ci: number, hz: number): Course {
    let c = this.courses.get(ci);
    if (!c) {
      const strings: WGString[] = [];
      const d = 0.5 + this.r() * 1.3; // course detune spread in cents (imperfect unison => beating)
      const dets = [-d, (this.r() - 0.5) * 0.4, d * (0.8 + 0.4 * this.r())];
      const pan = this.o.pan + this.o.spread * clamp((ci - 5) / 12, -1, 1);
      for (let k = 0; k < 3; k++) {
        const s = new WGString(KANUN_STRING, Math.min(hz, 60) * 0.7);
        s.detuneCents = dets[k];
        s.setPan(pan + (k - 1) * 0.03);
        s.tune(0, hz);
        strings.push(s);
      }
      c = { strings, hz, lastPluck: -10 };
      this.courses.set(ci, c);
    }
    return c;
  }

  /** Default (makam) mandal pitch of a course, used by glissandi and grace notes. */
  private courseHz(ci: number): number | null {
    const c = this.courses.get(ci);
    if (c) return c.hz;
    return this.symCourses.get(ci) ?? null;
  }

  /** One mızrap stroke on a course. hand: 'R' (upper, brighter) or 'L' (lower octave, a bit darker). */
  pluck(t: number, ci: number, hz: number, vel: number, hand: 'R' | 'L' = 'R', opts: { bendFromHz?: number; bendTime?: number } = {}): void {
    const c = this.course(ci, hz);
    const startHz = opts.bendFromHz ?? hz;
    if (Math.abs(1200 * Math.log2(startHz / c.hz)) > 1) {
      // mandal change: players flip the mandal just before the stroke; stop the old pitch first
      const tc = Math.max(0, t - 0.035);
      for (const s of c.strings) {
        s.damp(tc, 0.05, 0.008);
        s.tune(t - 0.004, startHz);
        s.undamp(t - 0.002);
      }
      c.hz = startHz;
    }
    const r = this.r;
    const v = clamp(vel, 0.05, 1);
    const up = r() < 0.5;
    for (let k = 0; k < 3; k++) {
      const s = c.strings[up ? 2 - k : k];
      const offs = k * (0.0004 + 0.0008 * r()) * (1.2 - v * 0.5);
      const width = (hand === 'R' ? 0.5 : 0.62) - 0.28 * v + 0.05 * r();
      const tilt = (hand === 'R' ? 1 : 0.8) * (800 + 2600 * v * v);
      const exc = plectrumExcitation({
        hz: startHz,
        pos: 0.1 + 0.05 * r(),
        widthMs: width,
        tiltHz: tilt,
        noise: 0.12 + 0.18 * v,
        vel: v * (0.85 + 0.15 * r()) * 0.33,
        seed: this.o.seed * 1000 + this.seedN++,
      });
      s.pluck(t + offs, exc);
    }
    if (opts.bendFromHz !== undefined) {
      const bt = opts.bendTime ?? 0.16;
      for (const s of c.strings) s.tune(t + 0.04, hz, bt, false);
      c.hz = hz;
    }
    c.lastPluck = t;
  }

  /** Perform a list of timed notes with kanun idioms. */
  perform(notes: PerfNote[]): void {
    const r = this.r;
    for (const n of notes) {
      const ci = n.pitch.course;
      const hz = this.hzOf(n.pitch.commas);
      const f = n.flags;
      // tiny human timing scatter
      const t = n.t + 0.004 * gaussian(r);
      // glissando sweep across neighbouring courses (with their current mandal settings)
      const gl = f['gu'] ? +(f['gu'] === true ? 5 : f['gu']) : f['gd'] ? -(f['gd'] === true ? 5 : +f['gd']) : 0;
      if (gl) {
        const cnt = Math.abs(gl);
        const dir = Math.sign(gl);
        let tt = t;
        const dts: number[] = [];
        for (let k = 0; k < cnt; k++) dts.push(0.026 + 0.012 * (k / cnt) + 0.004 * r());
        for (let k = 1; k <= cnt; k++) {
          tt -= dts[k - 1];
          const cj = ci - dir * k;
          const h = this.courseHz(cj);
          if (h) this.pluck(tt, cj, h, n.vel * (0.32 + 0.25 * (1 - k / cnt)), 'R');
        }
      }
      if (f['c'] || f['cl']) {
        const cj = ci + (f['c'] ? 1 : -1);
        const h = this.courseHz(cj);
        if (h) this.pluck(t - 0.065 - 0.015 * r(), cj, h, n.vel * 0.6, 'R');
      }
      const bendFrom = typeof f['b'] === 'string' ? this.hzOf(pitchInMakam(f['b'], this.o.makam).commas) : undefined;
      this.pluck(t, ci, hz, n.vel, 'R', { bendFromHz: bendFrom });
      if (f['m']) {
        const h = this.courseHz(ci + 1);
        if (h) this.pluck(t + 0.075, ci + 1, h, n.vel * 0.55, 'R');
        this.pluck(t + 0.15, ci, hz, n.vel * 0.6, 'R');
      }
      const oct = f['8'] ? -1 : f['8u'] ? 1 : 0;
      const octCi = ci + 7 * oct;
      const octHz = oct ? this.hzOf(n.pitch.commas + 53 * oct) : 0;
      if (oct && !f['tr']) this.pluck(t + 0.006 + 0.012 * r(), octCi, octHz, n.vel * 0.72, oct < 0 ? 'L' : 'R');
      if (f['tr']) {
        // tremolo: alternating hands, ~12–14 strokes/s, swelling then relaxing, stops a little before the next note
        const rate = 12.2 + 1.8 * r();
        const endT = t + n.dur * 0.88;
        let k = 1;
        for (let tt = t + 1 / rate; tt < endT; tt += (1 / rate) * (1 + 0.07 * gaussian(r)), k++) {
          const x = (tt - t) / (endT - t);
          const swell = 0.5 + 0.3 * Math.sin(Math.PI * Math.pow(x, 0.6)) - 0.15 * x;
          const alt = k % 2 === 1;
          const v = n.vel * swell * (alt ? 0.9 : 1) * (1 + 0.06 * gaussian(r));
          if (oct && alt) this.pluck(tt, octCi, octHz, v * 0.85, oct < 0 ? 'L' : 'R');
          else this.pluck(tt, ci, hz, v, alt ? 'L' : 'R');
        }
      }
    }
  }

  render(len: number): StereoBuffer {
    const bus = new StereoBuffer(len);
    for (const c of this.courses.values()) for (const s of c.strings) s.render(bus.l, bus.r);
    if (this.o.sympathetic > 0) this.addSympathetic(bus);
    // body: two slightly different modal IRs for L/R
    // L/R share most of the body response (a real instrument is one source); a small part differs for width
    const irL = kanunBody(this.o.seed);
    const irR = blendIR(irL, kanunBody(this.o.seed + 17), 0.2);
    const out = new StereoBuffer(len);
    const cl = convolve(bus.l, irL);
    const cr = convolve(bus.r, irR);
    out.l.set(cl.subarray(0, len));
    out.r.set(cr.subarray(0, len));
    return out;
  }

  /** Undamped courses ring in sympathy: KS resonators at the makam's mandal pitches, fed by the bridge signal. */
  private addSympathetic(bus: StereoBuffer): void {
    const len = bus.length;
    const hp = Biquad.make('hp', 180, 0.7);
    const drive = new Float32Array(len);
    for (let i = 0; i < len; i++) drive[i] = hp.process((bus.l[i] + bus.r[i]) * 0.5);
    const outL = new Float32Array(len);
    const outR = new Float32Array(len);
    const k = 0.001 * this.o.sympathetic;
    for (const [ci, hz] of this.symCourses) {
      if (hz > 1400) continue;
      const D = SR / hz;
      const size = 1 << Math.ceil(Math.log2(D + 4));
      const buf = new Float64Array(size);
      const mask = size - 1;
      const t60 = KANUN_STRING.t60(hz) * 0.8;
      const g = Math.pow(10, -3 / (t60 * hz));
      const p = 0.35;
      const Di = Math.floor(D - 0.5);
      const fr = D - 0.5 - Di; // one-pole(0.35) adds ~0.5 sample of delay at low f; close enough for a resonator
      let lp = 0;
      const pan = this.o.pan + this.o.spread * clamp((ci - 5) / 12, -1, 1);
      const a = ((clamp(pan, -1, 1) + 1) * Math.PI) / 4;
      const gl = Math.cos(a),
        gr = Math.sin(a);
      let w = 0;
      for (let i = 0; i < len; i++) {
        const x1 = buf[(w - Di) & mask];
        const x2 = buf[(w - Di - 1) & mask];
        const rd = x1 + (x2 - x1) * fr;
        lp = (1 - p) * rd + p * lp;
        const y = lp * g + drive[i] * k;
        buf[w & mask] = y;
        w++;
        outL[i] += y * gl;
        outR[i] += y * gr;
      }
    }
    for (let i = 0; i < len; i++) {
      bus.l[i] += outL[i];
      bus.r[i] += outR[i];
    }
  }
}

const bodyCache = new Map<number, Float32Array>();

/** (1-k)·a + k·b, renormalised to a's energy. */
export function blendIR(a: Float32Array, b: Float32Array, k: number): Float32Array {
  const n = Math.min(a.length, b.length);
  const out = new Float32Array(n);
  let ea = 0,
    eo = 0;
  for (let i = 0; i < n; i++) {
    out[i] = (1 - k) * a[i] + k * b[i];
    ea += a[i] * a[i];
    eo += out[i] * out[i];
  }
  const g = Math.sqrt(ea / (eo || 1));
  for (let i = 0; i < n; i++) out[i] *= g;
  return out;
}

/** Kanun body: air/rosette resonance, spruce top modes and bright, fast-decaying fish-skin modes under the bridge. */
export function kanunBody(seed: number): Float32Array {
  const hit = bodyCache.get(seed);
  if (hit) return hit;
  const bump = (f: number, c: number, w: number) => Math.exp(-Math.pow(Math.log2(f / c) / w, 2));
  const fixed: Mode[] = [
    { f: 172, t60: 0.2, amp: 1.0 },
    { f: 248, t60: 0.15, amp: 0.8 },
    { f: 333, t60: 0.12, amp: 0.65 },
    { f: 421, t60: 0.1, amp: 0.55 },
    { f: 547, t60: 0.09, amp: 0.5 },
    { f: 689, t60: 0.08, amp: 0.45 },
  ];
  const rnd = randomModes(
    seed,
    90,
    180,
    8000,
    (f) => 0.35 + 0.5 * bump(f, 260, 0.8) + 0.45 * bump(f, 1150, 0.5) + 0.75 * bump(f, 2700, 0.6) - 0.3 * clamp((f - 5000) / 3000, 0, 1),
    (f) => Math.max(0.012, 0.17 * Math.pow(250 / f, 0.6)),
  );
  const ir = modalIR([...fixed, ...rnd], 0.4, 0.5, seed);
  bodyCache.set(seed, ir);
  return ir;
}
