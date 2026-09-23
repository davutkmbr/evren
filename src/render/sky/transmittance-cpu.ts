import * as THREE from 'three';
import { ATMOSPHERE } from './params';

const RG = ATMOSPHERE.groundRadiusKm;
const RT = ATMOSPHERE.topRadiusKm;
const STEPS = 64;
const HALF_DISK_MU = 0.0047;

const hazeExt = [0, 1, 2].map((i) => ATMOSPHERE.hazeScatteringPerKm[i] + ATMOSPHERE.hazeAbsorptionPerKm[i]);

function smoothstep(a: number, b: number, x: number): number {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Transmittance from a point at `heightM` toward a light whose direction has vertical component `mu` (same medium as
 * the GPU transmittance LUT, spherical planet), including the smooth planet shadow over the solar disk.
 */
export function lightTransmittance(heightM: number, mu: number, hazeMul: number, aerosolMul: number, out: THREE.Vector3): THREE.Vector3 {
  const r = RG + Math.max(heightM, 0) * 0.001;
  const muHorizon = -Math.sqrt(Math.max(1 - (RG / r) * (RG / r), 0));
  const shadow = smoothstep(muHorizon - HALF_DISK_MU, muHorizon + HALF_DISK_MU, mu);
  if (shadow <= 0) {
    return out.set(0, 0, 0);
  }
  const m = Math.max(mu, muHorizon);
  const sinT = Math.sqrt(Math.max(1 - m * m, 0));
  const tMax = -r * m + Math.sqrt(Math.max(r * r * m * m - r * r + RT * RT, 0));
  const invHR = 1 / ATMOSPHERE.rayleighScaleHeightKm;
  const invHM = 1 / ATMOSPHERE.mieScaleHeightKm;
  const invHH = 1 / ATMOSPHERE.hazeScaleHeightKm;
  let odR = 0;
  let odM = 0;
  let odH = 0;
  let odO = 0;
  let tPrev = 0;
  for (let i = 0; i < STEPS; i++) {
    const x = (i + 1) / STEPS;
    const t = tMax * x * x;
    const dt = t - tPrev;
    const ts = tPrev + dt * 0.5;
    tPrev = t;
    const px = sinT * ts;
    const py = r + m * ts;
    const h = Math.max(Math.sqrt(px * px + py * py) - RG, 0);
    odR += Math.exp(-h * invHR) * dt;
    odM += Math.exp(-h * invHM) * dt;
    odH += Math.exp(-h * invHH) * dt;
    odO += Math.max(0, 1 - Math.abs(h - ATMOSPHERE.ozoneCenterKm) / ATMOSPHERE.ozoneHalfWidthKm) * dt;
  }
  const mieExt = ATMOSPHERE.mieExtinctionPerKm * aerosolMul * odM;
  const R = ATMOSPHERE.rayleighScatteringPerKm;
  const O = ATMOSPHERE.ozoneAbsorptionPerKm;
  return out.set(
    Math.exp(-(R[0] * odR + mieExt + hazeExt[0] * hazeMul * odH + O[0] * odO)) * shadow,
    Math.exp(-(R[1] * odR + mieExt + hazeExt[1] * hazeMul * odH + O[1] * odO)) * shadow,
    Math.exp(-(R[2] * odR + mieExt + hazeExt[2] * hazeMul * odH + O[2] * odO)) * shadow,
  );
}
