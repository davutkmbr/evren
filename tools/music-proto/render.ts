// Entry point: renders the prototype pieces to .shots/music/ and prints an analysis report.
//
//   npx tsx tools/music-proto/render.ts            render all pieces (+ loop variants) and analyse them
//   npx tsx tools/music-proto/render.ts hicaz      render only pieces whose id contains "hicaz"
//   npx tsx tools/music-proto/render.ts --test     instrument checks: pitch accuracy of makam intervals, decays
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SR } from './dsp.ts';
import { writeWav24 } from './wav.ts';
import { PIECES } from './pieces.ts';
import { renderPiece } from './mix.ts';
import { stats, estimatePitch, estimateT60 } from './analysis.ts';
import { MAKAMS, pitchInMakam, commasToHz, kanunMandalCents, COMMA_CENTS, type Makam } from './makam.ts';
import { Kanun } from './kanun.ts';
import { Ud } from './ud.ts';
import { Ney } from './ney.ts';
import type { PerfNote } from './score.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = resolve(root, '.shots/music');
mkdirSync(outDir, { recursive: true });

const args = process.argv.slice(2);

if (args.includes('--test')) runTests();
else renderAll(args.filter((a) => !a.startsWith('--')));

function renderAll(filters: string[]) {
  const pieces = PIECES.filter((p) => !filters.length || filters.some((f) => p.id.includes(f)));
  for (const p of pieces) {
    const t0 = Date.now();
    console.log(`\n== ${p.title}`);
    const res = renderPiece(p, console.log);
    const full = resolve(outDir, `${p.id}.wav`);
    const loop = resolve(outDir, `${p.id}-loop.wav`);
    writeWav24(full, res.full.l, res.full.r);
    writeWav24(loop, res.loop.l, res.loop.r);
    if (args.includes('--stems')) {
      mkdirSync(resolve(outDir, 'stems'), { recursive: true });
      for (const [name, b] of Object.entries(res.stems)) {
        const st = stats(b.l, b.r);
        console.log(`  stem ${name}: centroid ${st.centroidHz.toFixed(0)} Hz, L/R corr ${st.stereoCorrelation.toFixed(2)}, peak ${st.samplePeakDb.toFixed(1)} dBFS`);
        writeWav24(resolve(outDir, 'stems', `${p.id}-${name}.wav`), b.l, b.r);
      }
    }
    for (const t of res.timeline)
      console.log(`  ${t.inst.padEnd(6)} ${t.start.toFixed(2).padStart(6)} – ${t.end.toFixed(2).padStart(6)} s  ${t.notes} notes`);
    console.log(`  stem loudness (raw): ${Object.entries(res.stemLufs).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(', ')}  master gain ${res.gainDb.toFixed(1)} dB`);
    for (const [name, buf] of [
      ['full', res.full],
      ['loop', res.loop],
    ] as const) {
      const s = stats(buf.l, buf.r);
      console.log(
        `  ${name}: ${s.seconds.toFixed(1)} s | ${s.lufs.toFixed(1)} LUFS (max short-term ${s.maxShortTerm.toFixed(1)}) | ` +
          `peak ${s.samplePeakDb.toFixed(1)} dBFS, true peak ${s.truePeakDb.toFixed(1)} dBTP | RMS ${s.rmsDb.toFixed(1)} dBFS | ` +
          `DC ${s.dc.map((d) => d.toExponential(1)).join('/')} | clipped ${s.clipped} | centroid ${s.centroidHz.toFixed(0)} Hz | L/R corr ${s.stereoCorrelation.toFixed(2)}`,
      );
    }
    // loop seam check: jump at the wrap point vs typical sample-to-sample change
    const L = res.loop.l;
    let typical = 0;
    for (let i = 1; i < L.length; i++) typical += Math.abs(L[i] - L[i - 1]);
    typical /= L.length;
    console.log(`  loop seam step ${Math.abs(L[0] - L[L.length - 1]).toExponential(2)} (mean step ${typical.toExponential(2)})`);
    console.log(`  -> ${full}\n  -> ${loop}  (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  }
}

function note(t: number, name: string, makam: Makam, dur: number, flags: Record<string, string | true> = {}): PerfNote {
  return { t, dur, pitch: pitchInMakam(name, makam), vel: 0.7, flags, phrase: 0, first: true, last: true };
}

function runTests() {
  const cents = (a: number, b: number) => 1200 * Math.log2(a / b);
  console.log('Pitch accuracy: each scale degree rendered in isolation (kanun: 3-string course incl. body; ud: 2-string course; ney).');
  console.log('Intervals are measured between successive degrees and printed in commas (1 comma = 22.64 c).\n');
  for (const key of ['hicaz', 'ussak', 'nihavend'] as const) {
    const m = MAKAMS[key];
    const deg = m.ascending;
    for (const inst of ['kanun', 'ud', 'ney'] as const) {
      const dugahHz = inst === 'ud' ? 110 : 220;
      const measured: number[] = [];
      const errs: number[] = [];
      for (const name of deg) {
        const p = pitchInMakam(name, m);
        const target = inst === 'kanun' ? dugahHz * Math.pow(2, kanunMandalCents(p.commas) / 1200) : commasToHz(p.commas, dugahHz);
        const len = Math.round(2.2 * SR);
        let buf: Float32Array;
        if (inst === 'kanun') {
          const k = new Kanun({ dugahHz, makam: m, seed: 5, sympathetic: 0 });
          k.perform([note(0.05, name, m, 1.5)]);
          const b = k.render(len);
          buf = b.l.map((v, i) => v + b.r[i]);
        } else if (inst === 'ud') {
          const u = new Ud({ dugahHz, makam: m, seed: 5 });
          u.perform([note(0.05, name, m, 1.5)]);
          const b = u.render(len);
          buf = b.l.map((v, i) => v + b.r[i]);
        } else {
          const n = new Ney({ dugahHz, makam: m, seed: 5, breath: 0.3 });
          n.perform([note(0.05, name, m, 1.6)]);
          const b = n.render(len);
          buf = b.l.map((v, i) => v + b.r[i]);
        }
        // ney: window before vibrato; strings: after the attack
        const start = Math.round((inst === 'ney' ? 0.25 : 0.3) * SR);
        const f = estimatePitch(buf, start, Math.round((inst === 'ney' ? 0.14 : 0.9) * SR), target);
        measured.push(f);
        errs.push(cents(f, target));
      }
      const intervals = measured.slice(1).map((f, i) => cents(f, measured[i]) / COMMA_CENTS);
      const want = deg.slice(1).map((n, i) => pitchInMakam(n, m).commas - pitchInMakam(deg[i], m).commas);
      const maxErr = Math.max(...errs.map(Math.abs));
      console.log(
        `${m.tr.padEnd(9)} ${inst.padEnd(5)} max |error| vs target ${maxErr.toFixed(2)} c | intervals ` +
          intervals.map((x, i) => `${x.toFixed(2)}(${want[i]})`).join(' '),
      );
    }
  }
  console.log('\nNotes: kanun targets are the 72-EDO mandal positions (≤ 8 c from AEU), so kanun intervals deviate slightly');
  console.log('from the AEU comma counts in brackets; the Uşşak segâh includes the -1 comma performance-practice lowering.');
  console.log('The ud adds ±2 c random intonation scatter (fretless) and the ney a slow ±4 c breath drift, so their errors');
  console.log('of a few cents are intentional.\n');

  console.log('Kanun decay per course (T20-extrapolated broadband T60, single dry course, 6 s render):');
  for (const name of ['yegah', 'rast', 'dugah', 'neva', 'gerdaniye', 'tizNeva', "gerdaniye'"]) {
    const m = MAKAMS.hicaz;
    const k = new Kanun({ dugahHz: 220, makam: m, seed: 3, sympathetic: 0 });
    k.perform([note(0.05, name, m, 1)]);
    const b = k.render(6 * SR);
    const x = b.l.map((v, i) => v + b.r[i]);
    const hz = 220 * Math.pow(2, kanunMandalCents(pitchInMakam(name, m).commas) / 1200);
    console.log(`  ${name.padEnd(11)} ${hz.toFixed(1).padStart(7)} Hz  T60 ≈ ${estimateT60(x).toFixed(2)} s`);
  }
  console.log('Ud decay per register:');
  for (const name of ['huseyniAsiran', 'dugah', 'neva', 'muhayyer']) {
    const m = MAKAMS.ussak;
    const u = new Ud({ dugahHz: 110, makam: m, seed: 3 });
    u.perform([note(0.05, name, m, 1)]);
    const b = u.render(5 * SR);
    const x = b.l.map((v, i) => v + b.r[i]);
    console.log(`  ${name.padEnd(13)} ${commasToHz(pitchInMakam(name, m).commas, 110).toFixed(1).padStart(7)} Hz  T60 ≈ ${estimateT60(x).toFixed(2)} s`);
  }
}
