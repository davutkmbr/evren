/**
 * Fills the instance buffers of the two stork LODs from the flock simulation (pure TS, no three.js objects: the
 * matrices are composed by hand, so the per-frame cost is a tight loop the headless check can time).
 *
 * Orientation: the body points along the air-relative velocity (storks crab into a cross wind), pitched slightly nose
 * down in the glide, rolled by the simulated bank. Birds beyond the fade band shrink away (they are a pixel or less
 * there); near birds use the detailed mesh, far ones the simple one.
 */
import { StorkState, type StorkFlockSim } from './flock-sim';

export const STORK_LOD = {
  /** Camera distance (m) where the far mesh takes over (~12 px wingspan at 1080p, 60° FOV). */
  nearDistance: 240,
  /** Distance band (m) over which birds shrink away. */
  fadeStart: 2300,
  fadeEnd: 2900,
} as const;

export interface StorkInstanceTarget {
  /** 16 floats per instance (column-major matrices). */
  matrices: Float32Array;
  /** 4 floats per instance: flap phase, amplitude, flex, tint. */
  poses: Float32Array;
  capacity: number;
  count: number;
}

export interface StorkInstanceStats {
  near: number;
  far: number;
  hidden: number;
  /** Closest bird to the camera (m). */
  nearest: number;
}

/**
 * Writes every visible stork into `near` or `far`. `fade` 0..1 scales the whole flock (despawn), `camX/Y/Z` is the
 * camera. Returns counts (also stored in the targets).
 */
export function fillStorkInstances(sim: StorkFlockSim, camX: number, camY: number, camZ: number, fade: number, near: StorkInstanceTarget, far: StorkInstanceTarget, stats: StorkInstanceStats): StorkInstanceStats {
  let nn = 0;
  let nf = 0;
  let hidden = 0;
  let nearest = Infinity;
  const wx = sim.windX;
  const wz = sim.windZ;
  const nearD2 = STORK_LOD.nearDistance * STORK_LOD.nearDistance;
  for (let i = 0; i < sim.count; i++) {
    const x = sim.px[i];
    const y = sim.py[i];
    const z = sim.pz[i];
    const dx = x - camX;
    const dy = y - camY;
    const dz = z - camZ;
    const d2 = dx * dx + dy * dy + dz * dz;
    const d = Math.sqrt(d2);
    if (d < nearest) nearest = d;
    let k = fade;
    if (d > STORK_LOD.fadeStart) {
      k *= Math.max(0, 1 - (d - STORK_LOD.fadeStart) / (STORK_LOD.fadeEnd - STORK_LOD.fadeStart));
    }
    if (k <= 0.02) {
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
    const hx = sim.vx[i] - wx;
    const hz = sim.vz[i] - wz;
    const hl = Math.sqrt(hx * hx + hz * hz);
    const yaw = hl > 1e-3 ? Math.atan2(-hx, -hz) : 0;
    const glide = sim.state[i] === StorkState.Glide;
    // Air-relative flight path: slightly nose down (sink over airspeed), level during a flap.
    const pitch = (glide ? -0.085 : -0.06) * (1 - 0.7 * sim.amp[i]);
    const roll = sim.bank[i];
    const s = sim.size[i] * k;
    writeMatrix(t.matrices, n * 16, x, y, z, yaw, pitch, roll, s);
    const p = n * 4;
    t.poses[p] = sim.phase[i];
    t.poses[p + 1] = sim.amp[i];
    t.poses[p + 2] = sim.flex[i];
    t.poses[p + 3] = sim.tint[i];
    if (useNear) nn++;
    else nf++;
  }
  near.count = nn;
  far.count = nf;
  stats.near = nn;
  stats.far = nf;
  stats.hidden = hidden;
  stats.nearest = nearest;
  return stats;
}

/** Column-major T · Ry(yaw) · Rx(pitch) · Rz(roll) · S (three.js Euler order 'YXZ'). */
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
