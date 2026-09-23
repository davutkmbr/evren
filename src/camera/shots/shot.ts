import * as THREE from 'three';
import type { GeoQuery } from '../../core/contracts';
import { fbm1 } from '../math/noise1d';
import { AXIS_X, AXIS_Y, lookRotation, rotateLocal } from '../math/rotation';
import { VecSpring, leadFor } from '../math/springs';
import type { CameraFrame, CameraPose } from '../types';

export type ShotKind = 'flyby' | 'incoming' | 'low' | 'side' | 'establishing' | 'orbit' | 'landmark' | 'shoulder';

/** Shared per-frame context for cinematic shots. */
export interface ShotEnv {
  frame: CameraFrame;
  rng: () => number;
  geo: GeoQuery | null;
  /** Heavily smoothed travel heading (yaw about +Y) so tracking shots don't twitch with small corrections. */
  headingYaw: number;
  readonly headingFwd: THREE.Vector3;
  readonly headingRight: THREE.Vector3;
  aspect: number;
}

export abstract class Shot {
  abstract readonly kind: ShotKind;
  /** Planned length in seconds of simulation time. */
  duration = 8;
  elapsed = 0;
  /** Set by the shot when it can no longer frame the dragon well (passed, too far). */
  wantsCut = false;
  /** Label for debugging/UI. */
  label = '';

  /** Plans the shot from the current state. Returns false when no valid setup was found. */
  abstract begin(env: ShotEnv, from: CameraPose | null): boolean;
  abstract update(env: ShotEnv, out: CameraPose): void;

  protected start(duration: number): void {
    this.duration = duration;
    this.elapsed = 0;
    this.wantsCut = false;
  }
}

export function range(rng: () => number, lo: number, hi: number): number {
  return lo + (hi - lo) * rng();
}

export function sign(rng: () => number): number {
  return rng() < 0.5 ? -1 : 1;
}

const _aimTarget = new THREE.Vector3();

/**
 * Camera-operator aim: a critically damped aim point with velocity lead compensation (so a smoothly moving
 * subject stays centred with no steady-state lag), plus optional handheld drift.
 */
export class AimRig {
  readonly point = new VecSpring();
  private time = 0;
  private seed = 1;

  reset(target: THREE.Vector3, seed: number): void {
    this.point.reset(target);
    this.time = 0;
    this.seed = seed;
  }

  track(target: THREE.Vector3, velocity: THREE.Vector3, omega: number, dt: number): THREE.Vector3 {
    _aimTarget.copy(target).addScaledVector(velocity, leadFor(omega));
    return this.point.update(_aimTarget, omega, dt);
  }

  /** Writes the look orientation from `eye` toward the aim point. `handheld` = drift amplitude in radians. */
  orient(eye: THREE.Vector3, up: THREE.Vector3, out: THREE.Quaternion, handheld: number, dt: number): void {
    this.time += dt;
    lookRotation(eye, this.point.x, up, out);
    if (handheld > 0) {
      rotateLocal(out, AXIS_Y, fbm1(this.time * 0.45, this.seed) * handheld);
      rotateLocal(out, AXIS_X, fbm1(this.time * 0.4, this.seed + 7) * handheld * 0.8);
    }
  }
}

/** Vertical FOV (deg) that shows a horizontal half-angle `halfH` (rad) at the given aspect ratio. */
export function verticalFovFor(halfH: number, aspect: number): number {
  return (2 * Math.atan(Math.tan(halfH) / Math.max(aspect, 0.2)) * 180) / Math.PI;
}

/** Horizontal half-angle (rad) for a vertical FOV (deg). */
export function horizontalHalf(fovDeg: number, aspect: number): number {
  return Math.atan(Math.tan((fovDeg * Math.PI) / 360) * aspect);
}
