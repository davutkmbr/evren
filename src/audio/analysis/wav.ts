/** 16-bit PCM WAV encoder (TPDF-dithered) for dumping offline renders. */
export function encodeWav(buffer: AudioBuffer): ArrayBuffer {
  const channels = buffer.numberOfChannels;
  const sr = buffer.sampleRate;
  const n = buffer.length;
  const bytes = 44 + n * channels * 2;
  const out = new ArrayBuffer(bytes);
  const view = new DataView(out);
  const str = (off: number, s: string): void => {
    for (let i = 0; i < s.length; i++) {
      view.setUint8(off + i, s.charCodeAt(i));
    }
  };
  str(0, 'RIFF');
  view.setUint32(4, bytes - 8, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sr, true);
  view.setUint32(28, sr * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  str(36, 'data');
  view.setUint32(40, n * channels * 2, true);
  const data: Float32Array[] = [];
  for (let c = 0; c < channels; c++) {
    data.push(buffer.getChannelData(c));
  }
  let off = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < channels; c++) {
      const dither = (Math.random() - Math.random()) / 32768;
      const v = Math.max(-1, Math.min(1, data[c][i] + dither));
      view.setInt16(off, Math.round(v * 32767), true);
      off += 2;
    }
  }
  return out;
}

export function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}
