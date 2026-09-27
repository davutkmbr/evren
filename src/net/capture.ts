/**
 * The local dragon's snapshot: its rendered transform (the flight system's interpolated object, which the pose
 * matches), velocity, mode and the rig's final pose.
 */
import type { DragonPose, DragonState } from '../core/contracts';
import { createSnapshot, poseToFields, type DragonSnapshot } from './snapshot';

export function captureSnapshot(state: DragonState, pose: Readonly<DragonPose>, t: number, out: DragonSnapshot = createSnapshot()): DragonSnapshot {
  const o = state.object;
  out.t = t;
  out.position[0] = o.position.x;
  out.position[1] = o.position.y;
  out.position[2] = o.position.z;
  out.quaternion[0] = o.quaternion.x;
  out.quaternion[1] = o.quaternion.y;
  out.quaternion[2] = o.quaternion.z;
  out.quaternion[3] = o.quaternion.w;
  out.velocity[0] = state.velocity.x;
  out.velocity[1] = state.velocity.y;
  out.velocity[2] = state.velocity.z;
  out.mode = state.mode;
  out.firing = state.firing;
  out.riderless = !!state.riderless;
  poseToFields(pose, out.pose);
  out.groundY = pose.groundY ?? Number.NaN;
  out.groundNx = pose.groundNx ?? 0;
  out.groundNz = pose.groundNz ?? 0;
  return out;
}
