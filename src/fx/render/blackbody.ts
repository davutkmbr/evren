import * as THREE from 'three';

export const BLACKBODY_MIN_K = 500;
export const BLACKBODY_MAX_K = 12000;
const LUT_SIZE = 256;

/**
 * Blackbody chromaticities (sRGB, gamma encoded) from Mitchell Charity's CIE 1931 2° table, extended below
 * 1000 K towards the dull red of barely glowing soot. Interpolated in linear space.
 */
const TABLE: ReadonlyArray<[number, number, number, number]> = [
  [500, 255, 18, 0],
  [800, 255, 33, 0],
  [1000, 255, 56, 0],
  [1500, 255, 109, 0],
  [2000, 255, 137, 18],
  [2500, 255, 161, 72],
  [3000, 255, 180, 107],
  [3500, 255, 196, 137],
  [4000, 255, 209, 163],
  [4500, 255, 219, 186],
  [5000, 255, 228, 206],
  [5500, 255, 236, 224],
  [6000, 255, 243, 239],
  [6500, 255, 249, 253],
  [7000, 245, 243, 255],
  [8000, 227, 233, 255],
  [9000, 214, 225, 255],
  [10000, 204, 219, 255],
  [12000, 191, 211, 255],
];

const toLinear = (v: number): number => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** Linear sRGB chromaticity of a blackbody at `kelvin`, normalized to luminance 1. */
export function blackbodyRgb(kelvin: number, out: THREE.Color): THREE.Color {
  const k = Math.min(Math.max(kelvin, TABLE[0][0]), TABLE[TABLE.length - 1][0]);
  let i = 0;
  while (i < TABLE.length - 2 && TABLE[i + 1][0] < k) {
    i++;
  }
  const a = TABLE[i];
  const b = TABLE[i + 1];
  const t = (k - a[0]) / (b[0] - a[0]);
  const r = toLinear(a[1]) + (toLinear(b[1]) - toLinear(a[1])) * t;
  const g = toLinear(a[2]) + (toLinear(b[2]) - toLinear(a[2])) * t;
  const bl = toLinear(a[3]) + (toLinear(b[3]) - toLinear(a[3])) * t;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  return out.setRGB(r / lum, g / lum, bl / lum);
}

/** 256×1 RGBA half-float LUT over [BLACKBODY_MIN_K, BLACKBODY_MAX_K], unit luminance. */
export function createBlackbodyLut(): THREE.DataTexture {
  const data = new Uint16Array(LUT_SIZE * 4);
  const c = new THREE.Color();
  for (let i = 0; i < LUT_SIZE; i++) {
    const kelvin = BLACKBODY_MIN_K + ((BLACKBODY_MAX_K - BLACKBODY_MIN_K) * i) / (LUT_SIZE - 1);
    blackbodyRgb(kelvin, c);
    data[i * 4] = THREE.DataUtils.toHalfFloat(c.r);
    data[i * 4 + 1] = THREE.DataUtils.toHalfFloat(c.g);
    data[i * 4 + 2] = THREE.DataUtils.toHalfFloat(c.b);
    data[i * 4 + 3] = THREE.DataUtils.toHalfFloat(1);
  }
  const tex = new THREE.DataTexture(data, LUT_SIZE, 1, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}
