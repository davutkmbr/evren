// Score notation and "performer" (rubato, dynamics) for the taksim pieces.
//
// Notation (one phrase per line, `#` starts a comment):
//
//   @kanun +0.4            block header: instrument and start time relative to the end of the previous block
//                          (negative = overlap / answer while the other instrument still rings). `@ney at=12` is absolute.
//   neva:1.8:tr+8  huseyni:.28  neva:.25  nimHicaz:.3  neva:.9:c
//   _:0.8                  rest
//
// A token is  perde:duration[:flags]  where duration is onset-to-onset time in seconds (before rubato) and flags are
// joined with `+`. Octave marks: neva' = one octave up, neva, = one octave down (classical aliases such as muhayyer,
// yegah, tizNeva also work). Flags understood by the instruments:
//
//   tr      tremolo (kanun: repeated mızrap strokes; ud: risha tremolo)
//   8 / 8u  octave doubling below / above (kanun, both hands)
//   gu=N    glissando sweep up into the note across N courses (kanun); gd=N from above
//   c / cl  çarpma: grace from the upper / lower neighbour
//   m       mordent (note – upper – note)
//   b=perde bend into the note from another perde (kanun: mandal/fingernail bend; ney: lip glide)
//   s       slide (portamento) from the previous note, no new attack (ud, ney)
//   h       hammer-on / pull-off from the previous note (ud)
//   v       vibrato (ud, ney)
//   sc      scoop from below at the onset (ney)
//   br      audible breath before the note (ney)
//   @0.8    velocity override (0..1);  p / f  softer / louder
//   r       let the previous note ring (ud)

import { rng, gaussian, clamp } from './dsp.ts';
import { pitchInMakam, type Makam, type Pitch } from './makam.ts';

export interface ScoreNote {
  perde: string | null; // null = rest
  dur: number;
  flags: Record<string, string | true>;
}

export interface ScoreBlock {
  inst: string;
  offset: number;
  absolute?: number;
  phrases: ScoreNote[][];
  params: Record<string, string>;
}

export function parseScore(text: string): ScoreBlock[] {
  const blocks: ScoreBlock[] = [];
  let cur: ScoreBlock | null = null;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    if (line.startsWith('@')) {
      const [head, ...rest] = line.slice(1).split(/\s+/);
      cur = { inst: head, offset: 0, phrases: [], params: {} };
      for (const r of rest) {
        if (/^[+-]?\d/.test(r)) cur.offset = parseFloat(r);
        else if (r.includes('=')) {
          const [k, v] = r.split('=');
          if (k === 'at') cur.absolute = parseFloat(v);
          else cur.params[k] = v;
        }
      }
      blocks.push(cur);
      continue;
    }
    if (!cur) throw new Error('score line before any @block header');
    const phrase: ScoreNote[] = [];
    for (const tok of line.split(/\s+/)) {
      const [name, durS, flagS] = tok.split(':');
      const flags: Record<string, string | true> = {};
      if (flagS)
        for (const f of flagS.split('+')) {
          if (f.startsWith('@')) flags['vel'] = f.slice(1);
          else if (f.includes('=')) {
            const [k, v] = f.split('=');
            flags[k] = v;
          } else flags[f] = true;
        }
      phrase.push({ perde: name === '_' ? null : name, dur: parseFloat(durS), flags });
    }
    cur.phrases.push(phrase);
  }
  return blocks;
}

export interface PerfNote {
  t: number;
  dur: number;
  pitch: Pitch;
  vel: number;
  flags: Record<string, string | true>;
  phrase: number;
  first: boolean; // first sounding note of its phrase
  last: boolean; // last sounding note of its phrase
  prev?: PerfNote;
  next?: PerfNote;
}

export interface Performance {
  notes: PerfNote[];
  start: number;
  end: number;
}

/**
 * Turn a block into timed notes with taksim-style rubato: phrases start a little broad, move in the middle, and
 * linger on the final note; short run notes are pushed forward; every duration gets a small random deviation. The
 * dynamics follow an arch per phrase and a slower arch over the whole block.
 */
export function perform(block: ScoreBlock, start: number, makam: Makam, seed: number, opts: { rubato?: number } = {}): Performance {
  const r = rng(seed);
  const rub = opts.rubato ?? 1;
  const notes: PerfNote[] = [];
  let t = start;
  const K = block.phrases.length;
  block.phrases.forEach((phrase, k) => {
    const arc = 0.86 + 0.2 * Math.sin(Math.PI * Math.pow((k + 0.5) / K, 0.85));
    const phraseDyn = arc * (1 + 0.05 * gaussian(r));
    const sounding = phrase.filter((n) => n.perde);
    const n = sounding.length;
    let si = 0;
    for (const sn of phrase) {
      if (!sn.perde) {
        t += sn.dur * (1 + 0.1 * rub * gaussian(r));
        continue;
      }
      const x = n > 1 ? si / (n - 1) : 0.5;
      let tempo = 1 + rub * 0.07 * (1 - 4 * x * (1 - x));
      if (sn.dur < 0.3) tempo *= 1 - 0.05 * rub;
      if (si === n - 1) tempo *= 1 + 0.12 * rub;
      tempo *= Math.exp(0.035 * rub * gaussian(r));
      const dur = sn.dur * tempo;
      let vel = (0.6 + 0.2 * Math.sin(Math.PI * Math.pow(x, 0.7))) * phraseDyn + 0.035 * gaussian(r);
      if (sn.dur >= 0.8) vel += 0.05;
      if (sn.dur < 0.25) vel -= 0.06;
      if (sn.flags['p']) vel -= 0.15;
      if (sn.flags['f']) vel += 0.12;
      if (sn.flags['vel']) vel = parseFloat(sn.flags['vel'] as string);
      const pn: PerfNote = {
        t,
        dur,
        pitch: pitchInMakam(sn.perde, makam),
        vel: clamp(vel, 0.15, 1),
        flags: sn.flags,
        phrase: k,
        first: si === 0,
        last: si === n - 1,
      };
      const prev = notes[notes.length - 1];
      if (prev) {
        pn.prev = prev;
        prev.next = pn;
      }
      notes.push(pn);
      t += dur;
      si++;
    }
  });
  return { notes, start, end: t };
}
