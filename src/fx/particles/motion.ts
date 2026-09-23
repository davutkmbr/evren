import type { MotionProfile } from './types';

/**
 * Closed-form particle motion (mirrors particleMotion() in particle-common.glsl.ts):
 *   v' = -k (v - w) + g ŷ + B e^{-ct} ŷ
 *   p(t) = p0 + v∞ t + (v0 - v∞)(1 - e^{-kt})/k + ŷ B/(k-c) [(1 - e^{-ct})/c - (1 - e^{-kt})/k],  v∞ = w + carrier + ŷ g/k
 * Curl-noise turbulence and surface clamping are GPU-only (not needed for depth sorting).
 */
export interface Vec3Out {
  x: number;
  y: number;
  z: number;
}

/** Position plus the distance travelled relative to the air (drives jet spreading). */
export interface MotionOut extends Vec3Out {
  rel: number;
}

export function evalMotion(
  data: Float32Array,
  o: number,
  now: number,
  profile: MotionProfile,
  windX: number,
  windY: number,
  windZ: number,
  out: MotionOut,
): void {
  const age = Math.max(0, now - data[o + 3]);
  const k = Math.max(data[o + 10], 0.02);
  const wf = profile.wind;
  const vix = windX * wf + data[o + 20];
  const viy = windY * wf + data[o + 21] + profile.gravity / k;
  const viz = windZ * wf + data[o + 22];
  const ek = Math.exp(-k * age);
  const fk = (1 - ek) / k;
  out.x = data[o] + vix * age + (data[o + 4] - vix) * fk;
  out.y = data[o + 1] + viy * age + (data[o + 5] - viy) * fk;
  out.z = data[o + 2] + viz * age + (data[o + 6] - viz) * fk;
  out.rel = Math.hypot(data[o + 4] - vix, data[o + 5] - viy, data[o + 6] - viz) * fk;
  const buoy = data[o + 11];
  if (buoy !== 0) {
    let c = profile.buoyDecay;
    if (Math.abs(k - c) < 0.01) {
      c += 0.02;
    }
    const ec = Math.exp(-c * age);
    out.y += (buoy / (k - c)) * ((1 - ec) / c - fk);
  }
}

/**
 * Initial jet speed (relative to the emitter) so that a particle with drag k emitted from an emitter moving at `v`
 * along the jet reaches `reach` meters ahead of the emitter (full velocity inheritance):
 *   reach·k = s - v·ln(1 + s/v)
 */
export function jetSpeedForReach(reach: number, drag: number, emitterSpeed: number): number {
  const target = reach * drag;
  const v = Math.max(emitterSpeed, 0);
  if (v < 0.5) {
    return target;
  }
  let s = target + v * 0.5;
  for (let i = 0; i < 8; i++) {
    const f = s - v * Math.log(1 + s / v) - target;
    const df = 1 - v / (v + s);
    s = Math.max(1, s - f / Math.max(df, 1e-3));
  }
  return s;
}
