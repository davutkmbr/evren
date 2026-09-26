// Minimal WAV writer/reader: 24-bit PCM stereo (writer), 16/24-bit PCM (reader, for analysis).
import { writeFileSync, readFileSync } from 'node:fs';
import { SR } from './dsp.ts';

export function writeWav24(path: string, l: Float32Array, r: Float32Array, sampleRate = SR): void {
  const n = l.length;
  const bytesPerSample = 3;
  const dataBytes = n * 2 * bytesPerSample;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2 * bytesPerSample, 28);
  buf.writeUInt16LE(2 * bytesPerSample, 32);
  buf.writeUInt16LE(24, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataBytes, 40);
  let o = 44;
  const max = 8388607;
  for (let i = 0; i < n; i++) {
    for (const ch of [l, r]) {
      let v = Math.round(Math.max(-1, Math.min(1, ch[i])) * max);
      if (v < 0) v += 0x1000000;
      buf[o++] = v & 0xff;
      buf[o++] = (v >> 8) & 0xff;
      buf[o++] = (v >> 16) & 0xff;
    }
  }
  writeFileSync(path, buf);
}

export function readWav(path: string): { sr: number; ch: Float32Array[] } {
  const b = readFileSync(path);
  let o = 12;
  let fmt = { channels: 2, sr: SR, bits: 24 };
  while (o < b.length) {
    const id = b.toString('ascii', o, o + 4);
    const size = b.readUInt32LE(o + 4);
    if (id === 'fmt ') {
      fmt = { channels: b.readUInt16LE(o + 10), sr: b.readUInt32LE(o + 12), bits: b.readUInt16LE(o + 22) };
    } else if (id === 'data') {
      const bps = fmt.bits / 8;
      const frames = Math.floor(size / (bps * fmt.channels));
      const ch = Array.from({ length: fmt.channels }, () => new Float32Array(frames));
      let p = o + 8;
      for (let i = 0; i < frames; i++) {
        for (let c = 0; c < fmt.channels; c++) {
          ch[c][i] = bps === 2 ? b.readInt16LE(p) / 32768 : b.readIntLE(p, 3) / 8388608;
          p += bps;
        }
      }
      return { sr: fmt.sr, ch };
    }
    o += 8 + size + (size & 1);
  }
  throw new Error(`no data chunk in ${path}`);
}
