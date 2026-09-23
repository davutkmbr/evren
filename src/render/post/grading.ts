import * as THREE from 'three';

/** Per-frame look parameters derived from the sun elevation (time of day). */
export interface GradingState {
  whiteBalance: THREE.Vector3;
  lookSlope: THREE.Vector3;
  lookPower: number;
  lookSaturation: number;
  lift: THREE.Vector3;
  gain: THREE.Vector3;
  /** Display-space split toning (luma-normalised multipliers): shadows weighted (1-l)^2, highlights l^2. */
  shadowTint: THREE.Vector3;
  highlightTint: THREE.Vector3;
  bloomStrength: number;
  vignette: number;
  purkinje: number;
  grain: number;
}

interface GradingKey {
  /** Sun elevation in degrees. */
  elevation: number;
  whiteBalance: [number, number, number];
  lookSlope: [number, number, number];
  lookPower: number;
  lookSaturation: number;
  lift: [number, number, number];
  gain: [number, number, number];
  shadowTint: [number, number, number];
  highlightTint: [number, number, number];
  bloomStrength: number;
  vignette: number;
  purkinje: number;
  grain: number;
}

/**
 * Keys sorted by descending elevation: neutral midday, golden hour, blue hour, night.
 * The sky module already renders warm sunlight, so warmth is added only as a highlight split-tone (white balance
 * stays near neutral and shadows/sky keep their blue); blue hour cools the whole frame; night keeps cool shadows
 * with warm (sodium) highlights plus scotopic desaturation (purkinje).
 */
const KEYS: GradingKey[] = [
  {
    elevation: 40,
    whiteBalance: [1.0, 1.0, 1.0],
    lookSlope: [1.0, 1.0, 1.0],
    lookPower: 1.04,
    lookSaturation: 1.1,
    lift: [0.0, 0.0, 0.0],
    gain: [1.0, 1.0, 1.0],
    shadowTint: [1.0, 1.0, 1.0],
    highlightTint: [1.0, 1.0, 1.0],
    bloomStrength: 0.035,
    vignette: 0.26,
    purkinje: 0.0,
    grain: 0.008,
  },
  {
    elevation: 14,
    whiteBalance: [1.005, 1.0, 0.99],
    lookSlope: [1.0, 1.0, 1.0],
    lookPower: 1.05,
    lookSaturation: 1.12,
    lift: [0.0, 0.0, 0.002],
    gain: [1.0, 1.0, 1.0],
    shadowTint: [0.995, 1.0, 1.01],
    highlightTint: [1.015, 1.0, 0.975],
    bloomStrength: 0.038,
    vignette: 0.27,
    purkinje: 0.0,
    grain: 0.008,
  },
  {
    elevation: 4,
    whiteBalance: [1.01, 1.0, 0.985],
    lookSlope: [1.0, 1.0, 1.0],
    lookPower: 1.07,
    lookSaturation: 1.14,
    lift: [0.0, 0.001, 0.005],
    gain: [1.0, 1.0, 1.0],
    shadowTint: [0.98, 1.0, 1.04],
    highlightTint: [1.045, 1.0, 0.93],
    bloomStrength: 0.045,
    vignette: 0.3,
    purkinje: 0.0,
    grain: 0.009,
  },
  {
    elevation: -1.5,
    whiteBalance: [1.0, 1.0, 1.0],
    lookSlope: [1.0, 1.0, 1.0],
    lookPower: 1.07,
    lookSaturation: 1.12,
    lift: [0.0, 0.002, 0.008],
    gain: [1.0, 1.0, 1.0],
    shadowTint: [0.975, 1.0, 1.05],
    highlightTint: [1.04, 1.0, 0.94],
    bloomStrength: 0.05,
    vignette: 0.3,
    purkinje: 0.05,
    grain: 0.011,
  },
  {
    elevation: -6,
    whiteBalance: [0.96, 0.99, 1.06],
    lookSlope: [1.0, 1.0, 1.0],
    lookPower: 1.06,
    lookSaturation: 1.04,
    lift: [0.0, 0.004, 0.012],
    gain: [1.0, 1.0, 1.0],
    shadowTint: [0.97, 1.0, 1.06],
    highlightTint: [1.02, 1.0, 0.97],
    bloomStrength: 0.055,
    vignette: 0.32,
    purkinje: 0.3,
    grain: 0.012,
  },
  {
    elevation: -14,
    whiteBalance: [0.98, 0.995, 1.03],
    lookSlope: [1.0, 1.0, 1.0],
    lookPower: 1.08,
    lookSaturation: 1.02,
    lift: [0.0, 0.003, 0.011],
    gain: [1.0, 1.0, 1.0],
    shadowTint: [0.97, 1.0, 1.07],
    highlightTint: [1.05, 1.0, 0.9],
    bloomStrength: 0.06,
    vignette: 0.34,
    purkinje: 0.6,
    grain: 0.013,
  },
];

export function createGradingState(): GradingState {
  return {
    whiteBalance: new THREE.Vector3(1, 1, 1),
    lookSlope: new THREE.Vector3(1, 1, 1),
    lookPower: 1,
    lookSaturation: 1,
    lift: new THREE.Vector3(),
    gain: new THREE.Vector3(1, 1, 1),
    shadowTint: new THREE.Vector3(1, 1, 1),
    highlightTint: new THREE.Vector3(1, 1, 1),
    bloomStrength: 0.04,
    vignette: 0.25,
    purkinje: 0,
    grain: 0.01,
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function setLerp(out: THREE.Vector3, a: [number, number, number], b: [number, number, number], t: number): void {
  out.set(lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t));
}

function normaliseLuma(v: THREE.Vector3): void {
  v.multiplyScalar(1 / (v.x * 0.2126 + v.y * 0.7152 + v.z * 0.0722));
}

/** Interpolates the grading keys for the given sun elevation (degrees). Allocation free. */
export function updateGrading(out: GradingState, sunElevationDeg: number): void {
  let hi = KEYS[0];
  let lo = KEYS[KEYS.length - 1];
  let t = 0;
  if (sunElevationDeg >= KEYS[0].elevation) {
    lo = hi;
  } else if (sunElevationDeg <= lo.elevation) {
    hi = lo;
  } else {
    for (let i = 0; i < KEYS.length - 1; i++) {
      const a = KEYS[i];
      const b = KEYS[i + 1];
      if (sunElevationDeg <= a.elevation && sunElevationDeg >= b.elevation) {
        hi = a;
        lo = b;
        const x = (a.elevation - sunElevationDeg) / (a.elevation - b.elevation);
        t = x * x * (3 - 2 * x);
        break;
      }
    }
  }
  setLerp(out.whiteBalance, hi.whiteBalance, lo.whiteBalance, t);
  normaliseLuma(out.whiteBalance);
  setLerp(out.lookSlope, hi.lookSlope, lo.lookSlope, t);
  setLerp(out.lift, hi.lift, lo.lift, t);
  setLerp(out.gain, hi.gain, lo.gain, t);
  setLerp(out.shadowTint, hi.shadowTint, lo.shadowTint, t);
  normaliseLuma(out.shadowTint);
  setLerp(out.highlightTint, hi.highlightTint, lo.highlightTint, t);
  normaliseLuma(out.highlightTint);
  out.lookPower = lerp(hi.lookPower, lo.lookPower, t);
  out.lookSaturation = lerp(hi.lookSaturation, lo.lookSaturation, t);
  out.bloomStrength = lerp(hi.bloomStrength, lo.bloomStrength, t);
  out.vignette = lerp(hi.vignette, lo.vignette, t);
  out.purkinje = lerp(hi.purkinje, lo.purkinje, t);
  out.grain = lerp(hi.grain, lo.grain, t);
}
