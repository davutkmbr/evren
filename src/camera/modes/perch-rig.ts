import * as THREE from 'three';
import { WORLD_UP, lookRotation } from '../math/rotation';
import { DEG, clamp } from '../math/scalar';
import { Spring } from '../math/springs';
import type { CameraCollision } from '../obstruction';
import type { CameraPose } from '../types';

/** The viewing mode's camera styles: a slow drift around the perch, or a still "postcard" framing. */
export type PerchCameraStyle = 'orbit' | 'fixed';

export const PERCH_CAMERA = {
  /** Boom length as a multiple of the dragon's size (max of length and wingspan), and its slow breathing. */
  radius: 1.45,
  radiusFixed: 1.3,
  breathe: 0.08,
  /** Drift around "behind the dragon": amplitude and period of the azimuth swing, the elevation and its swing. */
  swing: 50 * DEG,
  swingPeriod: 84,
  elevation: 13 * DEG,
  elevationSwing: 6 * DEG,
  elevationPeriod: 53,
  elevationFixed: 9 * DEG,
  /** Azimuth centres tried when the shot starts (the clearest wins; ties go to the one nearest behind). */
  centreRange: 75 * DEG,
  centreStep: 15 * DEG,
  /** Look target: this far past the dragon along the view (m) and this far below the dragon. */
  aimAhead: 45,
  aimDrop: 6,
  /** Pivot above the dragon's centre (m); clearance the boom keeps from obstacles (m); shortest boom (m). */
  pivotUp: 1.5,
  boomMargin: 1.5,
  minBoom: 3,
  eyeRadius: 1.2,
  fov: 50,
  /** Mouse look: elevation limits (rad). */
  minElevation: -4 * DEG,
  maxElevation: 60 * DEG,
} as const;

const _pivot = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _aim = new THREE.Vector3();

/**
 * Perch viewing camera (phase 03): circles slowly behind and beside the perched dragon, framing the perch's view
 * direction (the dragon in the lower part of the frame, the city beyond it), or holds a still framing. The boom is
 * cast against the collision world every frame and the eye pushed out of geometry; mouse look moves the camera
 * around the dragon. Pure camera maths (no engine), so headless checks run it against the real colliders.
 */
export class PerchCameraRig {
  style: PerchCameraStyle = 'orbit';
  private time = 0;
  private centre = 0;
  private fixedAz = 0;
  private userAz = 0;
  private userEl = 0;
  private size = 24;
  private readonly boom = new Spring(30);

  /** Starts the shot around `anchor` (the dragon's centre) looking along `viewYaw` (Object3D yaw of the perch view). */
  begin(anchor: THREE.Vector3, viewYaw: number, size: number, collision: CameraCollision, from: CameraPose | null): void {
    this.size = clamp(size, 8, 60);
    this.time = 0;
    this.userAz = 0;
    this.userEl = 0;
    this.centre = this.clearestAzimuth(anchor, viewYaw, collision, PERCH_CAMERA.swing * 0.6, PERCH_CAMERA.elevation, this.size * PERCH_CAMERA.radius);
    this.fixedAz = this.clearestAzimuth(anchor, viewYaw, collision, 0, PERCH_CAMERA.elevationFixed, this.size * PERCH_CAMERA.radiusFixed, 35 * DEG);
    if (from) {
      // Continue from where the camera is: start the drift at its azimuth.
      _dir.subVectors(from.position, anchor);
      const az = Math.atan2(_dir.x, _dir.z) - viewYaw;
      this.userAz = wrap(az - this.centre);
      this.boom.reset(clamp(_dir.length(), PERCH_CAMERA.minBoom, this.size * 2));
    } else {
      this.boom.reset(this.size * PERCH_CAMERA.radius);
    }
  }

  update(dt: number, anchor: THREE.Vector3, viewYaw: number, collision: CameraCollision, lookYaw: number, lookPitch: number, out: CameraPose): void {
    this.time += dt;
    this.userAz = wrap(this.userAz + lookYaw);
    this.userEl += lookPitch;
    const orbit = this.style === 'orbit';
    const t = this.time;
    let az: number;
    let el: number;
    let radius: number;
    if (orbit) {
      az = this.centre + PERCH_CAMERA.swing * Math.sin((t / PERCH_CAMERA.swingPeriod) * Math.PI * 2);
      el = PERCH_CAMERA.elevation + PERCH_CAMERA.elevationSwing * Math.sin((t / PERCH_CAMERA.elevationPeriod) * Math.PI * 2);
      radius = this.size * PERCH_CAMERA.radius * (1 + PERCH_CAMERA.breathe * Math.sin((t / 61) * Math.PI * 2));
    } else {
      az = this.fixedAz;
      el = PERCH_CAMERA.elevationFixed;
      radius = this.size * PERCH_CAMERA.radiusFixed;
    }
    az += this.userAz;
    el = clamp(el + this.userEl, PERCH_CAMERA.minElevation, PERCH_CAMERA.maxElevation);
    this.userEl = el - (orbit ? PERCH_CAMERA.elevation : PERCH_CAMERA.elevationFixed);
    this.direction(viewYaw, az, el, _dir);
    _pivot.copy(anchor).addScaledVector(WORLD_UP, PERCH_CAMERA.pivotUp);
    const allowed = Math.max(PERCH_CAMERA.minBoom, collision.castBoom(_pivot, _dir, radius, PERCH_CAMERA.boomMargin));
    if (allowed < this.boom.x || dt <= 0) {
      this.boom.reset(allowed);
    } else {
      this.boom.update(allowed, 1.2, dt);
    }
    out.position.copy(_pivot).addScaledVector(_dir, Math.min(radius, this.boom.x));
    collision.resolve(out.position, PERCH_CAMERA.eyeRadius);
    // Look past the dragon along the view: it sits low in the frame with the city beyond.
    _aim.set(-Math.sin(viewYaw), 0, -Math.cos(viewYaw)).multiplyScalar(PERCH_CAMERA.aimAhead).add(anchor);
    _aim.y -= PERCH_CAMERA.aimDrop;
    lookRotation(out.position, _aim, WORLD_UP, out.quaternion);
    out.fov = PERCH_CAMERA.fov;
    out.near = 0.3;
    out.speedEffect = 0;
    out.shakeTranslation = 0.3;
    out.shakeRotation = 0.3;
  }

  /** Unit direction from the pivot to the eye: azimuth `az` off "behind the dragon", elevation `el`. */
  private direction(viewYaw: number, az: number, el: number, out: THREE.Vector3): THREE.Vector3 {
    // Behind the dragon is +forward reversed: yaw direction (sin yaw, cos yaw) points backwards (forward is -sin, -cos).
    const a = viewYaw + az;
    const ce = Math.cos(el);
    return out.set(Math.sin(a) * ce, Math.sin(el), Math.cos(a) * ce);
  }

  /** Azimuth centre with the longest clear boom over ±`spread` around it (ties: nearest behind the dragon). */
  private clearestAzimuth(anchor: THREE.Vector3, viewYaw: number, collision: CameraCollision, spread: number, el: number, radius: number, range: number = PERCH_CAMERA.centreRange): number {
    _pivot.copy(anchor).addScaledVector(WORLD_UP, PERCH_CAMERA.pivotUp);
    let best = 0;
    let bestScore = -Infinity;
    for (let c = -range; c <= range + 1e-6; c += PERCH_CAMERA.centreStep) {
      let worst = Infinity;
      for (const s of spread > 0 ? [-spread, -spread / 2, 0, spread / 2, spread] : [0]) {
        this.direction(viewYaw, c + s, el, _dir);
        worst = Math.min(worst, collision.castBoom(_pivot, _dir, radius, PERCH_CAMERA.boomMargin));
      }
      const score = Math.min(worst, radius) - Math.abs(c) * 0.5;
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    return best;
  }
}

function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}
