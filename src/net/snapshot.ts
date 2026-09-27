/**
 * A dragon's network snapshot (phase 26 stage 1, network design in phase 15): what another player needs to draw a
 * dragon, in a fixed 67-byte little-endian record (SNAPSHOT_BYTES). Pure: no three.js objects, shared by the client
 * and the server.
 *
 *   u32 t          sender clock (ms)
 *   f32 x, y, z    position (m, world)
 *   i16 qx..qw     orientation (unit quaternion * 32767)
 *   i16 vx, vy, vz velocity (0.1 m/s)
 *   u8  mode       FlightMode index
 *   u8  flags      bit 0 firing, bit 1 riderless, bit 2 ground plane valid
 *   u8  pose[..]   POSE_FIELDS quantized over their range (phases wrap)
 */
import type { DragonPose, FlightMode } from '../core/contracts';

export const FLIGHT_MODES: readonly FlightMode[] = ['flying', 'gliding', 'diving', 'hovering', 'stalling', 'landing', 'grounded', 'takeoff', 'swimming', 'underwater'];

const TAU = Math.PI * 2;

/** Pose fields on the wire: [key, min, max] or [key, 'phase'] (radians, wraps at 2π). */
type PoseField = readonly [keyof DragonPose, number, number] | readonly [keyof DragonPose, 'phase'];

export const POSE_FIELDS: readonly PoseField[] = [
  ['flapPhase', 'phase'],
  ['flapAmplitude', 0, 1],
  ['wingSpread', 0, 1],
  ['wingSweep', -1, 1],
  ['wingTwist', -1, 1],
  ['neckYaw', -Math.PI, Math.PI],
  ['neckPitch', -Math.PI, Math.PI],
  ['jawOpen', 0, 1],
  ['tailYaw', -Math.PI, Math.PI],
  ['tailPitch', -Math.PI, Math.PI],
  ['legsTuck', 0, 1],
  ['walkPhase', 'phase'],
  ['walkAmount', 0, 1],
  ['riderLeanPitch', -1.5, 1.5],
  ['riderLeanRoll', -1.5, 1.5],
  ['gait', 0, 2],
  ['stride', 0, 12],
  ['foreGround', 0, 1],
  ['wingRaise', 0, 1],
  ['heelLift', 0, 1],
  ['legReach', -1, 1],
  ['skid', 0, 1],
  ['landFlare', 0, 1],
  ['swim', 0, 1],
  ['swimPhase', 'phase'],
  ['swimStroke', 0, 1],
  ['bodyRoll', -Math.PI, Math.PI],
  ['headRoll', -Math.PI, Math.PI],
  ['riderTuck', 0, 1],
  ['riderCheer', 0, 1],
  ['riderReinLeft', 0, 1],
  ['riderReinRight', 0, 1],
];

/** Ground plane: height below the dragon (m, 0.1 m steps) and the normal's x / z. */
const GROUND_BYTES = 3;
const HEADER_BYTES = 4 + 12 + 8 + 6 + 2;
export const SNAPSHOT_BYTES = HEADER_BYTES + POSE_FIELDS.length + GROUND_BYTES;

export interface DragonSnapshot {
  /** Sender clock (ms). */
  t: number;
  position: [number, number, number];
  quaternion: [number, number, number, number];
  velocity: [number, number, number];
  mode: FlightMode;
  firing: boolean;
  riderless: boolean;
  /** POSE_FIELDS values in order. */
  pose: Float32Array;
  /** World height of the ground under the dragon, or NaN (no ground plane: the default standing plane). */
  groundY: number;
  groundNx: number;
  groundNz: number;
}

export function createSnapshot(): DragonSnapshot {
  return {
    t: 0,
    position: [0, 0, 0],
    quaternion: [0, 0, 0, 1],
    velocity: [0, 0, 0],
    mode: 'flying',
    firing: false,
    riderless: false,
    pose: new Float32Array(POSE_FIELDS.length),
    groundY: Number.NaN,
    groundNx: 0,
    groundNz: 0,
  };
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const wrap = (a: number) => ((a % TAU) + TAU) % TAU;

function quantize(field: PoseField, v: number): number {
  if (!Number.isFinite(v)) {
    v = 0;
  }
  if (field[1] === 'phase') {
    return Math.round((wrap(v) / TAU) * 256) & 255;
  }
  const [, lo, hi] = field;
  return Math.round(((clamp(v, lo, hi) - lo) / (hi - lo)) * 255);
}

function dequantize(field: PoseField, b: number): number {
  if (field[1] === 'phase') {
    return (b / 256) * TAU;
  }
  const [, lo, hi] = field;
  return lo + (b / 255) * (hi - lo);
}

/** Reads the pose fields (missing optional fields read as 0). */
export function poseToFields(pose: Readonly<DragonPose>, out: Float32Array): Float32Array {
  POSE_FIELDS.forEach((f, i) => {
    out[i] = (pose[f[0]] as number | undefined) ?? 0;
  });
  return out;
}

/** Writes the pose fields into a pose object. */
export function fieldsToPose(fields: Float32Array, pose: DragonPose): DragonPose {
  const target = pose as unknown as Record<string, number>;
  POSE_FIELDS.forEach((f, i) => {
    target[f[0]] = fields[i];
  });
  return pose;
}

/** Whether a pose field is a phase (interpolated the short way round). */
export function isPhaseField(i: number): boolean {
  return POSE_FIELDS[i][1] === 'phase';
}

export function encodeSnapshot(s: DragonSnapshot, out = new ArrayBuffer(SNAPSHOT_BYTES), offset = 0): ArrayBuffer {
  const v = new DataView(out, offset, SNAPSHOT_BYTES);
  let o = 0;
  v.setUint32(o, Math.round(s.t) >>> 0, true);
  o += 4;
  for (const p of s.position) {
    v.setFloat32(o, p, true);
    o += 4;
  }
  const [qx, qy, qz, qw] = s.quaternion;
  const qs = qw < 0 ? -1 : 1;
  for (const q of [qx * qs, qy * qs, qz * qs, qw * qs]) {
    v.setInt16(o, Math.round(clamp(q, -1, 1) * 32767), true);
    o += 2;
  }
  for (const c of s.velocity) {
    v.setInt16(o, Math.round(clamp(c * 10, -32767, 32767)), true);
    o += 2;
  }
  v.setUint8(o++, Math.max(0, FLIGHT_MODES.indexOf(s.mode)));
  const ground = Number.isFinite(s.groundY);
  v.setUint8(o++, (s.firing ? 1 : 0) | (s.riderless ? 2 : 0) | (ground ? 4 : 0));
  POSE_FIELDS.forEach((f, i) => v.setUint8(o++, quantize(f, s.pose[i])));
  const dy = ground ? clamp(Math.round((s.groundY - s.position[1]) * 10), -127, 127) : 0;
  v.setInt8(o++, dy);
  v.setInt8(o++, Math.round(clamp(s.groundNx, -1, 1) * 127));
  v.setInt8(o++, Math.round(clamp(s.groundNz, -1, 1) * 127));
  return out;
}

export function decodeSnapshot(buf: ArrayBuffer, offset = 0, out = createSnapshot()): DragonSnapshot {
  const v = new DataView(buf, offset, SNAPSHOT_BYTES);
  let o = 0;
  out.t = v.getUint32(o, true);
  o += 4;
  for (let i = 0; i < 3; i++, o += 4) {
    out.position[i] = v.getFloat32(o, true);
  }
  let len = 0;
  for (let i = 0; i < 4; i++, o += 2) {
    out.quaternion[i] = v.getInt16(o, true) / 32767;
    len += out.quaternion[i] ** 2;
  }
  len = Math.sqrt(len) || 1;
  for (let i = 0; i < 4; i++) {
    out.quaternion[i] /= len;
  }
  for (let i = 0; i < 3; i++, o += 2) {
    out.velocity[i] = v.getInt16(o, true) / 10;
  }
  out.mode = FLIGHT_MODES[v.getUint8(o++)] ?? 'flying';
  const flags = v.getUint8(o++);
  out.firing = (flags & 1) !== 0;
  out.riderless = (flags & 2) !== 0;
  POSE_FIELDS.forEach((f, i) => {
    out.pose[i] = dequantize(f, v.getUint8(o++));
  });
  const dy = v.getInt8(o++);
  out.groundY = flags & 4 ? out.position[1] + dy / 10 : Number.NaN;
  out.groundNx = v.getInt8(o++) / 127;
  out.groundNz = v.getInt8(o++) / 127;
  return out;
}
