function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Void-and-cluster blue noise (Ulichney 1993) on a size x size torus. Returns ranks scaled to 0..255.
 * Phase 3 uses argmin of the ones-energy over zeros, which equals the tightest cluster of the zeros.
 */
export function generateBlueNoise(size: number, seed: number): Uint8Array {
  const n = size * size;
  const sigma = 1.9;
  const kernel = new Float32Array(n);
  for (let y = 0; y < size; y++) {
    const dy = Math.min(y, size - y);
    for (let x = 0; x < size; x++) {
      const dx = Math.min(x, size - x);
      kernel[y * size + x] = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
    }
  }
  const energy = new Float64Array(n);
  const bits = new Uint8Array(n);
  const splat = (index: number, sign: number): void => {
    const px = index % size;
    const py = (index - px) / size;
    for (let y = 0; y < size; y++) {
      const row = ((py + y) % size) * size;
      const krow = y * size;
      for (let x = 0; x < size; x++) {
        energy[row + ((px + x) % size)] += sign * kernel[krow + x];
      }
    }
  };
  const extreme = (wantOnes: boolean): number => {
    let best = -1;
    let bestValue = wantOnes ? -Infinity : Infinity;
    for (let i = 0; i < n; i++) {
      if ((bits[i] === 1) !== wantOnes) {
        continue;
      }
      const e = energy[i];
      if (wantOnes ? e > bestValue : e < bestValue) {
        bestValue = e;
        best = i;
      }
    }
    return best;
  };

  const rnd = mulberry32(seed);
  const initialOnes = Math.floor(n * 0.1);
  let placed = 0;
  while (placed < initialOnes) {
    const i = Math.floor(rnd() * n);
    if (bits[i] === 0) {
      bits[i] = 1;
      splat(i, 1);
      placed++;
    }
  }
  for (let iter = 0; iter < n; iter++) {
    const cluster = extreme(true);
    bits[cluster] = 0;
    splat(cluster, -1);
    const voidIndex = extreme(false);
    bits[voidIndex] = 1;
    splat(voidIndex, 1);
    if (voidIndex === cluster) {
      break;
    }
  }

  const prototype = bits.slice();
  const prototypeEnergy = energy.slice();
  const rank = new Int32Array(n);
  let ones = initialOnes;
  while (ones > 0) {
    const i = extreme(true);
    bits[i] = 0;
    splat(i, -1);
    ones--;
    rank[i] = ones;
  }
  bits.set(prototype);
  energy.set(prototypeEnergy);
  ones = initialOnes;
  while (ones < n) {
    const i = extreme(false);
    bits[i] = 1;
    splat(i, 1);
    rank[i] = ones;
    ones++;
  }
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = Math.floor((rank[i] * 256) / n);
  }
  return out;
}
