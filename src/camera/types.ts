import * as THREE from 'three';
import type { CameraMode, EngineContext } from '../core/contracts';
import type { DragonTracker } from './tracker';
import type { CameraCollision } from './obstruction';

/** Everything a camera controller produces for one frame. */
export interface CameraPose {
  readonly position: THREE.Vector3;
  readonly quaternion: THREE.Quaternion;
  /** Vertical field of view in degrees. */
  fov: number;
  near: number;
  /** Radial speed-lines strength 0..1 for the post pipeline. */
  speedEffect: number;
  /** Scales screen shake for this pose (0 = none). */
  shakeTranslation: number;
  shakeRotation: number;
}

export function createPose(): CameraPose {
  return {
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    fov: 60,
    near: 0.25,
    speedEffect: 0,
    shakeTranslation: 1,
    shakeRotation: 1,
  };
}

export function copyPose(dst: CameraPose, src: CameraPose): CameraPose {
  dst.position.copy(src.position);
  dst.quaternion.copy(src.quaternion);
  dst.fov = src.fov;
  dst.near = src.near;
  dst.speedEffect = src.speedEffect;
  dst.shakeTranslation = src.shakeTranslation;
  dst.shakeRotation = src.shakeRotation;
  return dst;
}

/** Per-frame inputs shared by all controllers. */
export interface CameraFrame {
  readonly ctx: EngineContext;
  /** Simulation dt (0 while paused). */
  readonly dt: number;
  /** Camera integration dt: real time while paused so the user can still look around. */
  readonly camDt: number;
  readonly paused: boolean;
  readonly target: DragonTracker;
  readonly collision: CameraCollision;
  /** Mouse look delta in radians for this frame (sensitivity and inversion applied), 0 when look is inactive. */
  readonly lookYaw: number;
  readonly lookPitch: number;
  /** True while mouse/stick movement steers the view (RMB held, pointer locked, right stick). */
  readonly lookActive: boolean;
  /** True only while the look control is explicitly held (RMB): blocks auto-recentering. */
  readonly lookHeld: boolean;
  /** Mouse wheel notches this frame (+ = zoom out), rate-limited so trackpad bursts stay controllable. */
  readonly wheel: number;
}

export interface CameraController {
  readonly mode: CameraMode;
  /** Called when the controller becomes active; `current` is the pose the camera had last frame. */
  enter(frame: CameraFrame, current: CameraPose): void;
  /** Snap to the ideal pose immediately (teleports, first frame). */
  reset(frame: CameraFrame): void;
  update(frame: CameraFrame, out: CameraPose): void;
  /** Called when another mode takes over. */
  exit?(frame: CameraFrame): void;
}
