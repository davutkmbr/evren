/** WaveShaper transfer curves (input domain [-1, 1] mapped over the array). */

/** Transparent below `knee`, smooth tanh saturation up to `ceiling`: final safety stage on the master bus. */
export function softClipCurve(samples = 4096, knee = 0.72, ceiling = 0.985): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(samples);
  const range = ceiling - knee;
  for (let i = 0; i < samples; i++) {
    const x = (i / (samples - 1)) * 2 - 1;
    const ax = Math.abs(x);
    const y = ax <= knee ? ax : knee + range * Math.tanh((ax - knee) / range);
    curve[i] = Math.sign(x) * y;
  }
  return curve;
}

/**
 * Asymmetric tube-like drive (adds even + odd harmonics, i.e. rasp/growl). Unity small-signal gain.
 * `drive` ~1..8, `asymmetry` 0..0.5.
 */
export function driveCurve(drive: number, asymmetry: number, samples = 2048): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(samples);
  const bias = asymmetry;
  const off = Math.tanh(drive * bias);
  const norm = 1 / Math.max(Math.tanh(drive * (1 + bias)) - off, 1e-6);
  for (let i = 0; i < samples; i++) {
    const x = (i / (samples - 1)) * 2 - 1;
    curve[i] = (Math.tanh(drive * (x + bias)) - off) * norm;
  }
  return curve;
}
