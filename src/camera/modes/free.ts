import * as THREE from 'three';
import type { CameraMode } from '../../core/contracts';
import { DEG, clamp } from '../math/scalar';
import { Spring, VecSpring } from '../math/springs';
import type { CameraController, CameraFrame, CameraPose } from '../types';

const BASE_SPEED = 18;
const FAST_MULTIPLIER = 6;

const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _wish = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();

/**
 * Detached fly camera for photo mode: mouse look (RMB / pointer lock), WASD move along the view,
 * Q/E (or Space/Ctrl) down/up, Shift fast, wheel changes the focal length. Runs on real time so it
 * keeps working while the simulation is paused.
 */
export class FreeController implements CameraController {
  readonly mode: CameraMode = 'free';

  private readonly position = new THREE.Vector3();
  private yaw = 0;
  private pitch = 0;
  private readonly velocity = new VecSpring();
  private readonly fov = new Spring(60);
  private fovTarget = 60;
  private placement: { x: number; y: number; z: number; yaw: number; pitch: number; fov?: number } | null = null;

  /** Queues an exact placement, applied on the next update (after any reset). */
  place(x: number, y: number, z: number, headingDeg: number, pitchDeg: number, fovDeg?: number): void {
    this.placement = { x, y, z, yaw: -headingDeg * DEG, pitch: clamp(pitchDeg * DEG, -89 * DEG, 89 * DEG), fov: fovDeg };
  }

  enter(_frame: CameraFrame, current: CameraPose): void {
    this.position.copy(current.position);
    _euler.setFromQuaternion(current.quaternion, 'YXZ');
    this.yaw = _euler.y;
    this.pitch = clamp(_euler.x, -89 * DEG, 89 * DEG);
    this.velocity.reset(_wish.set(0, 0, 0));
    this.fovTarget = clamp(current.fov, 15, 100);
    this.fov.reset(this.fovTarget);
  }

  reset(frame: CameraFrame): void {
    const t = frame.target;
    if (!t.available) {
      return;
    }
    // After a teleport, put the camera behind the dragon looking along its heading.
    this.position.copy(t.position).addScaledVector(t.travelFlat, -30);
    this.position.y += 8;
    frame.collision.resolve(this.position, 0.6);
    this.yaw = t.travelYaw;
    this.pitch = -8 * DEG;
    this.velocity.reset(_wish.set(0, 0, 0));
  }

  update(frame: CameraFrame, out: CameraPose): void {
    const dt = frame.camDt;
    const input = frame.ctx.input;
    if (this.placement) {
      const p = this.placement;
      this.placement = null;
      this.position.set(p.x, p.y, p.z);
      this.yaw = p.yaw;
      this.pitch = p.pitch;
      this.velocity.reset(_wish.set(0, 0, 0));
      if (p.fov !== undefined) {
        this.fovTarget = clamp(p.fov, 15, 100);
        this.fov.reset(this.fovTarget);
      }
    }

    if (frame.lookActive) {
      this.yaw += frame.lookYaw;
      this.pitch = clamp(this.pitch + frame.lookPitch, -89 * DEG, 89 * DEG);
    }
    if (frame.wheel !== 0) {
      this.fovTarget = clamp(this.fovTarget * Math.pow(1.08, frame.wheel), 15, 100);
    }

    _euler.set(this.pitch, this.yaw, 0, 'YXZ');
    out.quaternion.setFromEuler(_euler);
    _fwd.set(0, 0, -1).applyQuaternion(out.quaternion);
    _right.set(1, 0, 0).applyQuaternion(out.quaternion);

    const pitchSign = input.settings.invertPitch ? -1 : 1;
    const forward = input.axis('pitch') * pitchSign;
    const strafe = input.axis('roll');
    const vertical = clamp(input.axis('yaw') + (input.isHeld('flap') ? 1 : 0) - (input.isHeld('brake') ? 1 : 0), -1, 1);
    const agl = Math.max(0, this.position.y - frame.collision.groundHeight(this.position.x, this.position.z));
    const speed = BASE_SPEED * (input.isHeld('dive') ? FAST_MULTIPLIER : 1) * clamp(1 + agl / 150, 1, 10);
    _wish.set(0, 0, 0).addScaledVector(_fwd, forward).addScaledVector(_right, strafe);
    _wish.y += vertical;
    if (_wish.lengthSq() > 1) {
      _wish.normalize();
    }
    _wish.multiplyScalar(speed);
    this.velocity.update(_wish, 5, dt);
    this.position.addScaledVector(this.velocity.x, dt);
    frame.collision.resolve(this.position, 0.6);

    out.position.copy(this.position);
    out.fov = this.fov.update(this.fovTarget, 8, dt);
    out.near = 0.2;
    out.speedEffect = 0;
    out.shakeTranslation = 0;
    out.shakeRotation = 0;
  }
}
