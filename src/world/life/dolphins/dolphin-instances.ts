/**
 * Fills the instance buffers of the two dolphin LODs from the pods (pure TS, matrices composed by hand so the headless
 * check can time the loop). Dolphins deep under water are skipped for a camera above the water unless close by (the
 * water hides them anyway); beyond the far distance nothing is drawn.
 */
import { DOLPHIN_LOD } from './config';
import type { DolphinPod } from './pod-sim';

export interface DolphinInstanceTarget {
  /** 16 floats per instance (column-major matrices). */
  matrices: Float32Array;
  /** 4 floats per instance: tail beat phase, beat amplitude, tint, 0. */
  poses: Float32Array;
  capacity: number;
  count: number;
}

export interface DolphinInstanceStats {
  near: number;
  far: number;
  hidden: number;
  /** Closest dolphin to the camera (m). */
  nearest: number;
}

/** Writes every visible dolphin of `pods` into `near` or `far`; `camUnder` = the camera is below the water. */
export function fillDolphinInstances(
  pods: readonly DolphinPod[],
  camX: number,
  camY: number,
  camZ: number,
  camUnder: boolean,
  near: DolphinInstanceTarget,
  far: DolphinInstanceTarget,
  stats: DolphinInstanceStats,
): DolphinInstanceStats {
  let nn = 0;
  let nf = 0;
  let hidden = 0;
  let nearest = Infinity;
  const nearD2 = DOLPHIN_LOD.near * DOLPHIN_LOD.near;
  const farD2 = DOLPHIN_LOD.far * DOLPHIN_LOD.far;
  const deepR2 = DOLPHIN_LOD.deepRange * DOLPHIN_LOD.deepRange;
  for (const pod of pods) {
    for (let i = 0; i < pod.count; i++) {
      const x = pod.px[i];
      const y = pod.py[i];
      const z = pod.pz[i];
      const dx = x - camX;
      const dy = y - camY;
      const dz = z - camZ;
      const d2 = dx * dx + dy * dy + dz * dz;
      const d = Math.sqrt(d2);
      if (d < nearest) nearest = d;
      const deep = pod.yRel[i] < -DOLPHIN_LOD.deepHide;
      if (d2 > farD2 || (deep && !camUnder && d2 > deepR2) || (camUnder && d2 > deepR2 * 4)) {
        hidden++;
        continue;
      }
      const useNear = d2 < nearD2;
      const t = useNear ? near : far;
      const n = useNear ? nn : nf;
      if (n >= t.capacity) {
        hidden++;
        continue;
      }
      writeMatrix(t.matrices, n * 16, x, y, z, pod.yaw[i], pod.pitch[i], pod.roll[i], pod.size[i]);
      const p = n * 4;
      t.poses[p] = pod.beat[i];
      t.poses[p + 1] = pod.beatAmp[i];
      t.poses[p + 2] = pod.tint[i];
      t.poses[p + 3] = 0;
      if (useNear) nn++;
      else nf++;
    }
  }
  near.count = nn;
  far.count = nf;
  stats.near = nn;
  stats.far = nf;
  stats.hidden = hidden;
  stats.nearest = nearest;
  return stats;
}

/** Column-major T · Ry(yaw) · Rx(pitch) · Rz(roll) · S (three.js Euler order 'YXZ'; model -Z forward). */
export function writeMatrix(out: Float32Array, o: number, x: number, y: number, z: number, yaw: number, pitch: number, roll: number, s: number): void {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);
  out[o] = (cy * cr + sy * sp * sr) * s;
  out[o + 1] = cp * sr * s;
  out[o + 2] = (-sy * cr + cy * sp * sr) * s;
  out[o + 3] = 0;
  out[o + 4] = (-cy * sr + sy * sp * cr) * s;
  out[o + 5] = cp * cr * s;
  out[o + 6] = (sy * sr + cy * sp * cr) * s;
  out[o + 7] = 0;
  out[o + 8] = sy * cp * s;
  out[o + 9] = -sp * s;
  out[o + 10] = cy * cp * s;
  out[o + 11] = 0;
  out[o + 12] = x;
  out[o + 13] = y;
  out[o + 14] = z;
  out[o + 15] = 1;
}
