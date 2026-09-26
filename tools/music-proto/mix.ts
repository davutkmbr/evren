// Piece assembly: score -> performers -> instruments -> stems -> room reverb -> master (loudness, fades, loop).
import { SR, StereoBuffer, Biquad, convolve, dbToGain } from './dsp.ts';
import { parseScore, perform, type Performance } from './score.ts';
import { type Makam } from './makam.ts';
import { Kanun, type KanunOpts } from './kanun.ts';
import { Ud, type UdOpts } from './ud.ts';
import { Ney, type NeyOpts } from './ney.ts';
import { Bendir } from './bendir.ts';
import { roomIR } from './body.ts';
import { integratedLufs, truePeak } from './analysis.ts';

export interface InstrumentMix {
  /** Stem loudness relative to the loudest stem (LU). */
  level: number;
  /** Reverb send (0..1). */
  send: number;
}

export interface PieceDef {
  id: string;
  title: string;
  makam: Makam;
  seed: number;
  score: string;
  kanun?: Omit<KanunOpts, 'makam' | 'seed'> & InstrumentMix;
  ud?: Omit<UdOpts, 'makam' | 'seed'> & InstrumentMix;
  ney?: Omit<NeyOpts, 'makam' | 'seed'> & InstrumentMix;
  bendir?: { pan?: number; f1?: number } & InstrumentMix;
  reverb: { t60: number; predelay: number };
  targetLufs?: number;
  tail?: number;
}

export interface RenderResult {
  full: StereoBuffer;
  loop: StereoBuffer;
  timeline: { inst: string; start: number; end: number; notes: number }[];
  stemLufs: Record<string, number>;
  gainDb: number;
  /** Dry stems after balancing (before reverb and master gain), for inspection. */
  stems: Record<string, StereoBuffer>;
}

export function renderPiece(def: PieceDef, log: (s: string) => void = () => {}): RenderResult {
  const blocks = parseScore(def.score);
  const kanun = def.kanun ? new Kanun({ ...def.kanun, makam: def.makam, seed: def.seed + 1 }) : null;
  const ud = def.ud ? new Ud({ ...def.ud, makam: def.makam, seed: def.seed + 2 }) : null;
  const ney = def.ney ? new Ney({ ...def.ney, makam: def.makam, seed: def.seed + 3 }) : null;
  const bendir = def.bendir ? new Bendir({ seed: def.seed + 4, pan: def.bendir.pan, f1: def.bendir.f1 }) : null;

  const timeline: RenderResult['timeline'] = [];
  const named = new Map<string, Performance>();
  let prevEnd = 0;
  const deferred: typeof blocks = [];
  blocks.forEach((b, i) => {
    if (b.inst === 'bendir') {
      deferred.push(b);
      return;
    }
    const start = b.absolute ?? prevEnd + b.offset;
    const perf = perform(b, start, def.makam, def.seed * 100 + i);
    const inst = b.inst === 'kanun' ? kanun : b.inst === 'ud' ? ud : b.inst === 'ney' ? ney : null;
    if (!inst) throw new Error(`piece ${def.id}: no instrument "${b.inst}" configured`);
    inst.perform(perf.notes);
    timeline.push({ inst: b.inst, start: perf.start, end: perf.end, notes: perf.notes.length });
    if (b.params.id) named.set(b.params.id, perf);
    prevEnd = perf.end;
  });
  const musicEnd = prevEnd;
  const resolve = (ref: string): number => {
    const m = /^([A-Za-z]\w*)(\.end)?([+-][\d.]+)?$/.exec(ref);
    if (!m) return parseFloat(ref);
    const base = m[1] === 'end' ? musicEnd : m[2] ? named.get(m[1])!.end : named.get(m[1])!.start;
    return base + (m[3] ? parseFloat(m[3]) : 0);
  };
  for (const b of deferred) {
    if (!bendir) throw new Error('bendir block without bendir config');
    const from = resolve(b.params.from);
    const to = resolve(b.params.to);
    bendir.pattern(from, to, parseFloat(b.params.bpm ?? '52'), def.seed + 9);
    timeline.push({ inst: 'bendir', start: from, end: to, notes: 0 });
  }

  const tail = def.tail ?? 6;
  const len = Math.round((musicEnd + tail) * SR);
  const stems: { name: string; buf: StereoBuffer; mix: InstrumentMix }[] = [];
  const t0 = Date.now();
  if (kanun) stems.push({ name: 'kanun', buf: kanun.render(len), mix: def.kanun! });
  if (ud) stems.push({ name: 'ud', buf: ud.render(len), mix: def.ud! });
  if (ney) stems.push({ name: 'ney', buf: ney.render(len), mix: def.ney! });
  if (bendir) stems.push({ name: 'bendir', buf: bendir.render(len), mix: def.bendir! });
  log(`  instruments rendered in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

  // balance stems by measured loudness
  const stemLufs: Record<string, number> = {};
  for (const s of stems) stemLufs[s.name] = integratedLufs([s.buf.l, s.buf.r]);
  const dry = new StereoBuffer(len);
  const send = new StereoBuffer(len);
  const stemOut: Record<string, StereoBuffer> = {};
  for (const s of stems) {
    const g = dbToGain(-20 + s.mix.level - stemLufs[s.name]);
    stemOut[s.name] = s.buf;
    for (const ch of [s.buf.l, s.buf.r]) for (let i = 0; i < ch.length; i++) ch[i] *= g;
    dry.addStereo(s.buf, 0, 1 - s.mix.send * 0.35);
    send.addStereo(s.buf, 0, s.mix.send);
  }

  // room: synthetic IR, decorrelated L/R, highs decay faster
  const t60 = def.reverb.t60;
  const [irL, irR] = roomIR({
    seconds: Math.min(4.5, t60 * 1.6),
    predelay: def.reverb.predelay,
    seed: def.seed,
    early: 2.5,
    t60: [
      [120, t60 * 1.15],
      [250, t60 * 1.1],
      [500, t60],
      [1000, t60 * 0.92],
      [2000, t60 * 0.78],
      [4000, t60 * 0.58],
      [8000, t60 * 0.38],
    ],
  });
  const monoSend = new Float32Array(len);
  const sideSend = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    monoSend[i] = (send.l[i] + send.r[i]) * 0.5;
    sideSend[i] = (send.l[i] - send.r[i]) * 0.5;
  }
  const wl = convolve(monoSend, irL);
  const wr = convolve(monoSend, irR);
  const mix = new StereoBuffer(len);
  const wetGain = 0.9;
  for (let i = 0; i < len; i++) {
    mix.l[i] = dry.l[i] + wetGain * (wl[i] + sideSend[i] * 0.3);
    mix.r[i] = dry.r[i] + wetGain * (wr[i] - sideSend[i] * 0.3);
  }

  // master: remove rumble / DC, gentle air shelf taming
  for (const ch of [mix.l, mix.r]) {
    Biquad.make('hp', 32, 0.7).run(ch);
    Biquad.make('hp', 32, 0.7).run(ch);
    Biquad.make('highshelf', 9000, 0.7, -1.5).run(ch);
  }

  // loop variant: wrap everything after the loop point back onto the start (seamless, no fades)
  const loopLen = Math.round((musicEnd + 1.2) * SR);
  const loop = new StereoBuffer(loopLen);
  for (let i = 0; i < len; i++) {
    loop.l[i % loopLen] += mix.l[i];
    loop.r[i % loopLen] += mix.r[i];
  }

  // loudness normalisation (both versions share the gain measured on the full version)
  const target = def.targetLufs ?? -20;
  const lufs = integratedLufs([mix.l, mix.r]);
  let gain = dbToGain(target - lufs);
  const tp = Math.max(truePeak(mix.l), truePeak(mix.r), truePeak(loop.l), truePeak(loop.r)) * gain;
  if (tp > dbToGain(-1.5)) {
    log(`  true peak ${(20 * Math.log10(tp)).toFixed(2)} dBTP > -1.5: applying soft limiter`);
  }
  for (const b of [mix, loop]) {
    for (const ch of [b.l, b.r]) for (let i = 0; i < ch.length; i++) ch[i] = softLimit(ch[i] * gain);
  }
  // fades on the full version
  const fin = Math.round(0.25 * SR);
  const fout = Math.round(Math.min(4, tail * 0.7) * SR);
  for (let i = 0; i < fin; i++) {
    const g = Math.sin((Math.PI / 2) * (i / fin)) ** 2;
    mix.l[i] *= g;
    mix.r[i] *= g;
  }
  for (let i = 0; i < fout; i++) {
    const g = Math.cos((Math.PI / 2) * (i / fout)) ** 2;
    mix.l[len - fout + i] *= g;
    mix.r[len - fout + i] *= g;
  }
  return { full: mix, loop, timeline, stemLufs, gainDb: 20 * Math.log10(gain), stems: stemOut };
}

/** Transparent below -3 dBFS, smooth tanh knee above (only reached by rare transients). */
function softLimit(x: number): number {
  const knee = 0.708;
  const a = Math.abs(x);
  if (a <= knee) return x;
  const over = a - knee;
  const y = knee + (1 - knee) * Math.tanh(over / (1 - knee)) * 0.97;
  return Math.sign(x) * y;
}
