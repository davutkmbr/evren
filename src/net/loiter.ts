/**
 * Where an away player's dragon is (phase 26): a player whose tab is hidden stops simulating (the browser stops the
 * frame loop), so it sends one last snapshot flagged `away` and everyone continues the dragon on the same wide
 * right-hand circle from it, computed here from that snapshot and the time since. When the player comes back, their
 * own game places the dragon where this puts it, so nobody sees a jump. Pure and deterministic: every client gets the
 * same answer. The circle matches the flight autopilot's (same bank), which flies the dragon while a menu is open.
 */
import { POSE_FIELDS, type DragonSnapshot } from './snapshot';

/** Bank of the circle; the autopilot's (src/dragon/flight/pilot.ts) so both look alike. */
export const LOITER_BANK_DEG = 12;
const G = 9.81;
/** Loiter speed range (m/s): a hovering dragon glides off, a diving one eases down to a glide. */
const MIN_SPEED = 18;
const MAX_SPEED = 40;

/** Modes the circle continues; on the ground, perched or in the water the dragon simply waits where it is. */
export function loiters(s: DragonSnapshot): boolean {
  return s.mode !== 'grounded' && s.mode !== 'swimming' && s.mode !== 'underwater' && s.mode !== 'landing' && !s.riderless;
}

const field = (name: string) => POSE_FIELDS.findIndex((f) => f[0] === name);
const GLIDE_POSE: [number, number][] = [
  [field('flapAmplitude'), 0],
  [field('wingSpread'), 1],
  [field('wingSweep'), 0.1],
  [field('wingTwist'), 0.3],
  [field('legsTuck'), 1],
  [field('jawOpen'), 0],
  [field('walkAmount'), 0],
  [field('landFlare'), 0],
  [field('swim'), 0],
];

/**
 * The away snapshot `s` continued for `seconds` along the circle, written into `out` (a copy of `s` otherwise).
 * Only for snapshots where `loiters(s)`.
 */
export function loiter(s: DragonSnapshot, seconds: number, out: DragonSnapshot): DragonSnapshot {
  if (out !== s) {
    out.position = [...s.position];
    out.quaternion = [...s.quaternion];
    out.velocity = [...s.velocity];
    out.pose.set(s.pose);
    out.mode = s.mode;
    out.riderless = s.riderless;
    out.groundY = s.groundY;
    out.groundNx = s.groundNx;
    out.groundNz = s.groundNz;
  }
  out.t = s.t + seconds * 1000;
  out.firing = false;
  out.teleport = false;
  out.away = true;

  // Heading on the ground: the velocity's, or the body's forward (-Z) when barely moving.
  let dx = s.velocity[0];
  let dz = s.velocity[2];
  let v = Math.hypot(dx, dz);
  if (v < 1) {
    const [qx, qy, qz, qw] = s.quaternion;
    dx = -(2 * (qx * qz + qw * qy));
    dz = -(1 - 2 * (qx * qx + qy * qy));
    v = 0;
  }
  const len = Math.hypot(dx, dz) || 1;
  dx /= len;
  dz /= len;
  // Right of the heading on the ground.
  const rx = -dz;
  const rz = dx;
  const speed = Math.min(MAX_SPEED, Math.max(MIN_SPEED, v));
  const bank = (LOITER_BANK_DEG * Math.PI) / 180;
  const radius = (speed * speed) / (G * Math.tan(bank));
  const angle = (speed * seconds) / radius;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // Centre to the right; at angle 0 the dragon is where it was, moving along its heading.
  const cx = s.position[0] + rx * radius;
  const cz = s.position[2] + rz * radius;
  out.position[0] = cx - rx * radius * cos + dx * radius * sin;
  out.position[1] = s.position[1];
  out.position[2] = cz - rz * radius * cos + dz * radius * sin;
  const fx = dx * cos + rx * sin;
  const fz = dz * cos + rz * sin;
  out.velocity[0] = fx * speed;
  out.velocity[1] = 0;
  out.velocity[2] = fz * speed;

  // Orientation: yaw so the body's -Z points along (fx, fz), then the bank (right wing down: about +Z by -bank).
  const yaw = Math.atan2(-fx, -fz);
  const hy = yaw / 2;
  const hr = -bank / 2;
  const yq = [0, Math.sin(hy), 0, Math.cos(hy)];
  const rq = [0, 0, Math.sin(hr), Math.cos(hr)];
  out.quaternion[0] = yq[3] * rq[0] + yq[0] * rq[3] + yq[1] * rq[2] - yq[2] * rq[1];
  out.quaternion[1] = yq[3] * rq[1] - yq[0] * rq[2] + yq[1] * rq[3] + yq[2] * rq[0];
  out.quaternion[2] = yq[3] * rq[2] + yq[0] * rq[1] - yq[1] * rq[0] + yq[2] * rq[3];
  out.quaternion[3] = yq[3] * rq[3] - yq[0] * rq[0] - yq[1] * rq[1] - yq[2] * rq[2];

  for (const [i, value] of GLIDE_POSE) {
    if (i >= 0) {
      out.pose[i] = value;
    }
  }
  return out;
}

/** Compass heading (degrees) of a snapshot's velocity, for placing the local dragon on the circle. */
export function headingDeg(s: DragonSnapshot): number {
  const deg = (Math.atan2(s.velocity[0], -s.velocity[2]) * 180) / Math.PI;
  return (deg + 360) % 360;
}
