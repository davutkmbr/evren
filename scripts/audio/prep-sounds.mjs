#!/usr/bin/env node
/**
 * Builds the game's recorded sounds from the approved CC0 recordings (tools/assets/approved.json, cached in
 * assets-src/sound/ by `node scripts/data/fetch-assets.mjs --kind=sound`): trims, high-passes, crossfade-loops and
 * slices them, encodes AAC (.m4a decodes in every current browser) into public/audio/ and writes
 * public/audio/sounds.json (loop points, sprite slots, levels for src/audio/samples.ts) and public/audio/LICENSES.md.
 *
 *   node scripts/audio/prep-sounds.mjs
 *
 * Needs ffmpeg (the AudioToolbox AAC encoder when available, ffmpeg's own otherwise) and sox (noise reduction).
 * - Loops are crossfaded (equal power) into seamless cycles and carry LOOP_MARGIN seconds of wrapped audio on both
 *   sides of [loopStart, loopEnd], so they stay seamless whether or not a decoder trims the AAC priming samples.
 * - Sprites hold one-shots (thunder claps, single wing flaps) separated by silence; slots are [start, duration] (s).
 * - Field recordings with background noise (the gulls) are denoised first: sox `noisered` with a noise profile taken
 *   from a quiet second of the same recording, after the high-pass.
 * The trim, loop and slice points come from envelope analysis of each recording (level-matched loop seams without
 * transients, onsets of the strong flaps); see .docs/assets/candidates/sounds.md for what each recording contains.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MANIFEST = resolve(ROOT, 'tools/assets/approved.json');
const CACHE = resolve(ROOT, 'assets-src/sound');
const OUT = resolve(ROOT, 'public/audio');
const SR = 48000;
const PEAK_DB = -1.5;
const LOOP_MARGIN = 0.25;
const SPRITE_LEAD = 0.05;
const SPRITE_GAP = 0.1;
const BITRATE = { 1: '96k', 2: '160k' };

/** The ten strong flaps of 2create 670509 (onset - 30 ms to the next event), in seconds. */
const FLAPS = [
  [1.03, 1.86],
  [2.435, 3.265],
  [3.755, 4.335],
  [5.08, 5.91],
  [6.5, 7.33],
  [8.005, 8.835],
  [9.85, 10.68],
  [11.0, 11.505],
  [11.985, 12.515],
  [12.97, 13.77],
];

/**
 * Call phrases (from, to in s) found by envelope analysis of the denoised recordings: activity in the 0.3-4 kHz call
 * band 15 dB over the floor, merged across gaps under 0.5 s, with at least 0.4 s at least 10 dB quieter around it.
 */
const GULL_CALLS = [
  ...[
    [14.1, 18.48],
    [19.72, 20.96],
    [28.06, 32.88],
    [43.22, 44.48],
    [67.64, 68.6],
    [71.62, 72.84],
    [110.32, 114.92],
    [141.22, 141.92],
    [200.88, 202.06],
    [203.12, 204.12],
    [207.74, 208.8],
    [246.9, 247.94],
    [266.22, 268.48],
  ].map(([from, to]) => ({ id: 'gulls_harbour_brunoauzet', from, to })),
  ...[
    [54.28, 55.2],
    [64.26, 68.48],
    [69.06, 72.52],
  ].map(([from, to]) => ({ id: 'gulls_adalar_felixblume', from, to })),
  // The herring gull's calls and its long call (split in two phrases).
  ...[
    [1.3, 3.8],
    [3.8, 7.4],
    [7.4, 11.9],
  ].map(([from, to]) => ({ id: 'gull_longcall_genghisattenborough', from, to })),
];

/** Noise profile (start of a quiet second, s) and noisered amount per denoised recording. */
const DENOISE = {
  gulls_harbour_brunoauzet: { at: 139.25, amount: 0.21 },
  gulls_adalar_felixblume: { at: 60.25, amount: 0.24 },
  gull_longcall_genghisattenborough: { at: 11.5, amount: 0.21 },
  gulls_distant_etienneleplumey: { at: 0, amount: 0.2 },
};

/**
 * level: 'peak' normalises every slot to PEAK_DB; 'match' gives every slot the same RMS over its loudest `window`
 * seconds (measured above `weightHz`, the audible band) and then normalises the whole sprite to PEAK_DB.
 */
const RECIPES = [
  { out: 'wind/rush', channels: 2, highpass: 60, loop: { id: 'wind_rush_zazz', start: 6, length: 44, crossfade: 4 } },
  { out: 'wind/ears', channels: 2, highpass: 25, loop: { id: 'wind_ears_klankbeeld', start: 3.25, length: 26, crossfade: 3 } },
  { out: 'rain/heavy', channels: 2, highpass: 120, loop: { id: 'rain_wash_trp', start: 23.75, length: 36, crossfade: 3 } },
  { out: 'rain/light', channels: 2, highpass: 150, loop: { id: 'rain_terrace_kyles', start: 55, length: 30, crossfade: 3 } },
  {
    out: 'thunder/near',
    channels: 2,
    highpass: 30,
    level: { mode: 'peak' },
    slots: [
      // The crack lands at 2.47 s; 0.37 s of the tearing sizzle before it is kept.
      { id: 'thunder_crack_trp', from: 2.1, to: 16.5, fadeIn: 0.03, fadeOut: 3 },
      // Starts on the blast; the de-noised tail after ~10 s sounds gated and is faded out.
      { id: 'thunder_blast_bajko', from: 0.05, to: 10.6, fadeIn: 0.005, fadeOut: 2.5 },
    ],
  },
  {
    out: 'thunder/far',
    channels: 1,
    highpass: 30,
    level: { mode: 'match', window: 3, weightHz: 60 },
    slots: [
      { id: 'thunder_roll_closer_trp', from: 0.2, to: 25.5, fadeIn: 0.3, fadeOut: 3 },
      { id: 'thunder_roll_low_trp', from: 0.2, to: 13.5, fadeIn: 0.2, fadeOut: 2.5 },
      { id: 'thunder_roll_muffled_trp', from: 1.5, to: 21.5, fadeIn: 0.3, fadeOut: 3 },
      { id: 'thunder_roll_short_trp', from: 0.2, to: 12.3, fadeIn: 0.2, fadeOut: 2 },
    ],
  },
  {
    out: 'flap/flaps',
    channels: 1,
    // The close mic caught each flap's air blast as a sub-bass pressure pulse: only the cloth above ~110 Hz is kept
    // (the whoomps and the synthesized thump carry the weight).
    highpass: 110,
    level: { mode: 'match', window: 0.3, weightHz: 150 },
    slots: FLAPS.map(([from, to]) => ({ id: 'wing_flaps_2create', from, to, fadeIn: 0.01, fadeOut: 0.15 })),
  },
  {
    out: 'flap/whoomps',
    channels: 1,
    highpass: 45,
    level: { mode: 'match', window: 0.25, weightHz: 60 },
    slots: [1, 2, 3, 4, 5, 6, 7].map((n) => ({ id: `wing_flap_ani_${n}a`, from: 0, to: null, fadeIn: 0.002, fadeOut: 0.08 })),
  },
  {
    out: 'gull/calls',
    channels: 1,
    // Gull calls sit at 0.7-4 kHz: everything under 300 Hz is wind, surf and traffic.
    highpass: 300,
    level: { mode: 'match', window: 0.4, weightHz: 700 },
    slots: GULL_CALLS.map((c) => ({ ...c, fadeIn: 0.03, fadeOut: 0.12 })),
  },
  { out: 'gull/bed', channels: 2, highpass: 250, loop: { id: 'gulls_distant_etienneleplumey', start: 40, length: 45, crossfade: 4 } },
];

const encoder = execFileSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' }).includes(' aac_at ') ? 'aac_at' : 'aac';

/** Profile start for a recording: its quietest second away from the edges when `at` is 0. */
function quietest(path) {
  const [x] = decode(path, 1);
  let best = SR;
  let bestE = Infinity;
  for (let s = SR; s + SR <= x.length - SR; s += SR / 4) {
    let e = 0;
    for (let i = s; i < s + SR; i += 4) {
      e += x[i] * x[i];
    }
    if (e > 1e-9 && e < bestE) {
      bestE = e;
      best = s;
    }
  }
  return best / SR;
}

/** High-passed (and, for DENOISE recordings, noise-reduced) channels of a cached recording. */
function load(id, channels, fc) {
  const path = sourceFile(id);
  const dn = DENOISE[id];
  if (!dn) {
    return decode(path, channels).map((x) => highpass(x, fc));
  }
  const tmp = mkdtempSync(join(tmpdir(), 'evren-denoise-'));
  try {
    const at = dn.at || quietest(path);
    // One channel at a time (sox's multi-channel noisered drains its channels unevenly at the end).
    return decode(path, channels).map((x, c) => {
      highpass(x, fc);
      const raw = join(tmp, `hp${c}.f32`);
      const wav = join(tmp, `hp${c}.wav`);
      const prof = join(tmp, `noise${c}.prof`);
      const out = join(tmp, `dn${c}.wav`);
      writeFileSync(raw, Buffer.from(x.buffer, x.byteOffset, x.byteLength));
      execFileSync('sox', ['-t', 'f32', '-r', String(SR), '-c', '1', raw, '-e', 'floating-point', '-b', '32', wav]);
      execFileSync('sox', [wav, '-n', 'trim', String(at), '1', 'noiseprof', prof]);
      execFileSync('sox', [wav, out, 'noisered', prof, String(dn.amount)]);
      return decode(out, 1)[0];
    });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function sourceFile(id) {
  const dir = join(CACHE, id);
  const file = readdirSync(dir).find((f) => f.endsWith('.ogg'));
  if (!file) {
    throw new Error(`${id}: no cached recording in ${dir} (run node scripts/data/fetch-assets.mjs --kind=sound)`);
  }
  return join(dir, file);
}

/** Decodes to `channels` Float32Arrays at SR. */
function decode(path, channels) {
  const buf = execFileSync('ffmpeg', ['-v', 'error', '-i', path, '-f', 'f32le', '-ac', String(channels), '-ar', String(SR), '-'], {
    maxBuffer: 1 << 30,
  });
  const all = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  const n = all.length / channels;
  return Array.from({ length: channels }, (_, c) => Float32Array.from({ length: n }, (_, i) => all[i * channels + c]));
}

/** 4th-order Butterworth high-pass (two RBJ biquads), in place. */
function highpass(x, fc) {
  for (const q of [0.5412, 1.3066]) {
    const w = (2 * Math.PI * fc) / SR;
    const cos = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    const b0 = (1 + cos) / 2 / a0;
    const b1 = -(1 + cos) / a0;
    const a1 = (-2 * cos) / a0;
    const a2 = (1 - alpha) / a0;
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const y = b0 * x[i] + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2;
      x2 = x1;
      x1 = x[i];
      y2 = y1;
      y1 = y;
      x[i] = y;
    }
  }
  return x;
}

const seconds = (s) => Math.round(s * SR);

function fade(x, fadeIn, fadeOut) {
  const a = seconds(fadeIn);
  const b = seconds(fadeOut);
  for (let i = 0; i < a && i < x.length; i++) {
    x[i] *= Math.sin((i / a) * Math.PI * 0.5);
  }
  for (let i = 0; i < b && i < x.length; i++) {
    x[x.length - 1 - i] *= Math.sin((i / b) * Math.PI * 0.5);
  }
}

/** Equal-power crossfade of the `crossfade` seconds after the cycle into its head: a seamless `length` s cycle. */
function makeLoop(x, start, length, crossfade) {
  const s = seconds(start);
  const n = seconds(length);
  const f = seconds(crossfade);
  if (s + n + f > x.length) {
    throw new Error(`loop ${start}+${length}+${crossfade} s exceeds the ${(x.length / SR).toFixed(2)} s recording`);
  }
  const out = x.slice(s, s + n);
  for (let i = 0; i < f; i++) {
    const t = (i / f) * Math.PI * 0.5;
    out[i] = x[s + i] * Math.sin(t) + x[s + n + i] * Math.cos(t);
  }
  return out;
}

/** [tail margin | cycle | head margin]. */
function withMargins(cycle) {
  const m = seconds(LOOP_MARGIN);
  const out = new Float32Array(cycle.length + 2 * m);
  out.set(cycle.subarray(cycle.length - m), 0);
  out.set(cycle, m);
  out.set(cycle.subarray(0, m), m + cycle.length);
  return out;
}

function peakOf(chs) {
  let p = 0;
  for (const x of chs) {
    for (let i = 0; i < x.length; i++) {
      p = Math.max(p, Math.abs(x[i]));
    }
  }
  return p;
}

function scale(chs, k) {
  for (const x of chs) {
    for (let i = 0; i < x.length; i++) {
      x[i] *= k;
    }
  }
}

function rmsOf(chs, from = 0, to = chs[0].length) {
  let e = 0;
  for (const x of chs) {
    for (let i = from; i < to; i++) {
      e += x[i] * x[i];
    }
  }
  return Math.sqrt(e / (chs.length * (to - from)));
}

/** RMS of the loudest `window` s (hop 10 ms), measured on a copy high-passed at `weightHz`. */
function loudestRms(chs, window, weightHz) {
  const weighted = chs.map((x) => highpass(Float32Array.from(x), weightHz));
  const w = Math.min(seconds(window), weighted[0].length);
  let best = 0;
  for (let s = 0; s + w <= weighted[0].length; s += seconds(0.01)) {
    best = Math.max(best, rmsOf(weighted, s, s + w));
  }
  return best;
}

const dbOf = (v) => 20 * Math.log10(Math.max(v, 1e-9));
const peakGain = (chs) => 10 ** (PEAK_DB / 20) / peakOf(chs);

function encode(chs, out) {
  const tmp = mkdtempSync(join(tmpdir(), 'evren-sound-'));
  try {
    const n = chs[0].length;
    const inter = new Float32Array(n * chs.length);
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < chs.length; c++) {
        inter[i * chs.length + c] = chs[c][i];
      }
    }
    const raw = join(tmp, 'in.f32');
    writeFileSync(raw, Buffer.from(inter.buffer));
    mkdirSync(dirname(out), { recursive: true });
    execFileSync(
      'ffmpeg',
      ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(SR), '-ac', String(chs.length), '-i', raw, '-c:a', encoder, '-b:a', BITRATE[chs.length], '-movflags', '+faststart', out],
      { stdio: 'pipe' },
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Decodes the encoded file back: sample offset of the best match against the source (0 when the priming is trimmed) and the error level. */
function verify(chs, out) {
  const back = decode(out, chs.length);
  const src = chs[0];
  const dec = back[0];
  const probe = Math.min(src.length, seconds(2));
  let bestLag = 0;
  let bestErr = Infinity;
  for (let lag = -3000; lag <= 3000; lag += 1) {
    let e = 0;
    for (let i = seconds(0.05); i < probe; i += 16) {
      const j = i + lag;
      const d = (dec[j] ?? 0) - src[i];
      e += d * d;
    }
    if (e < bestErr) {
      bestErr = e;
      bestLag = lag;
    }
  }
  let sig = 0;
  let err = 0;
  const n = Math.min(src.length, dec.length - Math.max(0, bestLag));
  for (let i = 0; i < n; i++) {
    const d = (dec[i + bestLag] ?? 0) - src[i];
    sig += src[i] * src[i];
    err += d * d;
  }
  return { lag: bestLag, snrDb: 10 * Math.log10(sig / Math.max(err, 1e-12)), length: dec.length - src.length };
}

function buildLoop(r) {
  const chs = load(r.loop.id, r.channels, r.highpass).map((x) => withMargins(makeLoop(x, r.loop.start, r.loop.length, r.loop.crossfade)));
  scale(chs, peakGain(chs));
  const m = seconds(LOOP_MARGIN);
  const entry = {
    channels: r.channels,
    loop: [LOOP_MARGIN, LOOP_MARGIN + r.loop.length],
    rms: +rmsOf(chs, m, m + seconds(r.loop.length)).toFixed(5),
  };
  return { chs, entry, sources: [r.loop.id] };
}

function buildSprite(r) {
  const decoded = new Map();
  const slots = r.slots.map((s) => {
    if (!decoded.has(s.id)) {
      decoded.set(s.id, load(s.id, r.channels, r.highpass));
    }
    const src = decoded.get(s.id);
    const to = s.to === null ? src[0].length : seconds(s.to);
    const chs = src.map((x) => x.slice(seconds(s.from), to));
    for (const x of chs) {
      fade(x, s.fadeIn, s.fadeOut);
    }
    return chs;
  });
  if (r.level.mode === 'peak') {
    for (const chs of slots) {
      scale(chs, peakGain(chs));
    }
  } else {
    const levels = slots.map((chs) => loudestRms(chs, r.level.window, r.level.weightHz));
    const target = Math.min(...levels);
    slots.forEach((chs, i) => scale(chs, target / levels[i]));
    const k = 10 ** (PEAK_DB / 20) / Math.max(...slots.map(peakOf));
    for (const chs of slots) {
      scale(chs, k);
    }
  }
  const lead = seconds(SPRITE_LEAD);
  const gap = seconds(SPRITE_GAP);
  const total = lead + slots.reduce((sum, chs) => sum + chs[0].length + gap, 0);
  const out = Array.from({ length: r.channels }, () => new Float32Array(total));
  const table = [];
  let at = lead;
  for (const chs of slots) {
    chs.forEach((x, c) => out[c].set(x, at));
    table.push([+(at / SR).toFixed(4), +(chs[0].length / SR).toFixed(4)]);
    at += chs[0].length + gap;
  }
  return { chs: out, entry: { channels: r.channels, slots: table }, sources: [...new Set(r.slots.map((s) => s.id))] };
}

function licences(manifest, built) {
  const byId = new Map(manifest.assets.map((a) => [a.id, a]));
  const rows = [];
  for (const { file, sources } of built) {
    for (const id of sources) {
      const a = byId.get(id);
      if (!a || a.licence !== 'CC0-1.0') {
        throw new Error(`${id}: not an approved CC0 asset in ${MANIFEST}`);
      }
      rows.push(`| \`${file}\` | [${a.name}](${a.url}) | ${a.author} | CC0 1.0 |`);
    }
  }
  return `# Audio licences

Generated by \`scripts/audio/prep-sounds.mjs\` from [\`tools/assets/approved.json\`](../../tools/assets/approved.json).
Every recording is **CC0 1.0 (public domain)** from [Freesound](https://freesound.org), approved by the user on
${manifest.approved} ([decision](../../.docs/assets/candidates/sounds.md#decision-${manifest.approved})). The files here are
trimmed, filtered, looped or sliced and re-encoded (AAC) from each sound's public HQ preview. CC0 needs no attribution;
the credits are kept anyway.

| File | Recording | Author | Licence |
| --- | --- | --- | --- |
${rows.join('\n')}
`;
}

function main() {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const sounds = {};
  const built = [];
  for (const r of RECIPES) {
    const { chs, entry, sources } = r.loop ? buildLoop(r) : buildSprite(r);
    const file = `${r.out}.m4a`;
    const path = join(OUT, file);
    encode(chs, path);
    const check = verify(chs, path);
    sounds[r.out] = { file, ...entry };
    built.push({ file, sources });
    console.log(
      `${file.padEnd(18)} ${(chs[0].length / SR).toFixed(2).padStart(6)} s ${r.channels} ch  ${(statSync(path).size / 1024).toFixed(0).padStart(5)} KB` +
        `  peak ${dbOf(peakOf(chs)).toFixed(1)} dBFS  rms ${dbOf(rmsOf(chs)).toFixed(1)} dBFS  decoded offset ${check.lag} smp, ` +
        `length ${check.length >= 0 ? '+' : ''}${check.length} smp, SNR ${check.snrDb.toFixed(1)} dB`,
    );
  }
  const json = {
    $comment:
      'Generated by scripts/audio/prep-sounds.mjs. Loops: play [loop[0], loop[1]] s (wrapped margins around it); rms is the cycle RMS. Sprites: slots are [start, duration] s.',
    sampleRate: SR,
    sounds,
  };
  writeFileSync(join(OUT, 'sounds.json'), `${JSON.stringify(json, null, 1)}\n`);
  writeFileSync(join(OUT, 'LICENSES.md'), licences(manifest, built));
  console.log(`encoder ${encoder}; wrote ${Object.keys(sounds).length} sounds, sounds.json and LICENSES.md to public/audio/`);
}

main();
