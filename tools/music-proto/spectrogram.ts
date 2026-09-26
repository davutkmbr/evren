// Spectrogram / waveform PNG renderer for visual checks of the renders (no dependencies: node:zlib PNG encoder).
//
//   npx tsx tools/music-proto/spectrogram.ts .shots/music/hicaz-kanun.wav [start=0] [dur=12] [fmax=6000]
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fft } from './dsp.ts';
import { readWav } from './wav.ts';

function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

export function writePng(path: string, w: number, h: number, rgb: Uint8Array): void {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    Buffer.from(rgb.buffer, rgb.byteOffset + y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1);
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  writeFileSync(
    path,
    Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]),
  );
}

function colormap(v: number): [number, number, number] {
  // v in 0..1, dark blue -> purple -> orange -> pale yellow
  const stops: [number, number, number, number][] = [
    [0, 5, 5, 20],
    [0.35, 70, 20, 110],
    [0.65, 220, 80, 40],
    [0.85, 250, 180, 60],
    [1, 255, 250, 210],
  ];
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i][0]) {
      const a = stops[i - 1],
        b = stops[i];
      const t = (v - a[0]) / (b[0] - a[0]);
      return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
    }
  }
  return [255, 250, 210];
}

export function spectrogramPng(path: string, x: Float32Array, sr: number, start: number, dur: number, fmax: number, logFreq = true): void {
  const W = 1200,
    H = 500,
    WAVE = 80;
  const n = 4096;
  const s0 = Math.round(start * sr);
  const len = Math.round(dur * sr);
  const rgb = new Uint8Array(W * (H + WAVE) * 3);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const fmin = 50;
  for (let col = 0; col < W; col++) {
    const c = s0 + Math.round((col / W) * len);
    for (let i = 0; i < n; i++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
      re[i] = (x[c - n / 2 + i] ?? 0) * w;
      im[i] = 0;
    }
    fft(re, im);
    for (let row = 0; row < H; row++) {
      const fr = 1 - row / H;
      const f = logFreq ? fmin * Math.pow(fmax / fmin, fr) : fr * fmax;
      const k = Math.min(n / 2 - 1, Math.max(1, Math.round((f * n) / sr)));
      const db = 20 * Math.log10(Math.hypot(re[k], im[k]) / (n / 4) + 1e-9);
      const v = Math.max(0, Math.min(1, (db + 100) / 90));
      const [r, g, b] = colormap(v);
      const o = (row * W + col) * 3;
      rgb[o] = r;
      rgb[o + 1] = g;
      rgb[o + 2] = b;
    }
    // waveform strip
    let mx = 0;
    const step = Math.max(1, Math.round(len / W));
    for (let i = c; i < c + step; i++) mx = Math.max(mx, Math.abs(x[i] ?? 0));
    const hgt = Math.round(mx * WAVE);
    for (let yy = 0; yy < WAVE; yy++) {
      const o = ((H + yy) * W + col) * 3;
      const on = WAVE - yy <= hgt;
      rgb[o] = on ? 120 : 15;
      rgb[o + 1] = on ? 200 : 15;
      rgb[o + 2] = on ? 255 : 25;
    }
  }
  // 1-second ticks
  for (let s = 0; s <= dur; s++) {
    const col = Math.round((s / dur) * (W - 1));
    for (let yy = H; yy < H + 6; yy++) {
      const o = (yy * W + col) * 3;
      rgb[o] = rgb[o + 1] = rgb[o + 2] = 255;
    }
  }
  writePng(path, W, H + WAVE, rgb);
}

if (process.argv[1]?.endsWith('spectrogram.ts')) {
  const [file, st = '0', du = '12', fm = '6000'] = process.argv.slice(2);
  const { sr, ch } = readWav(file);
  const mono = ch[0].map((v, i) => (v + (ch[1]?.[i] ?? v)) * 0.5);
  const out = file.replace(/\.wav$/, `-spec-${st}s.png`);
  spectrogramPng(out, mono, sr, +st, +du, +fm);
  console.log(out);
}
