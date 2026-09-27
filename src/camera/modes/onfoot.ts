import * as THREE from 'three';
import type { CameraFrame, CameraPose } from '../types';
import { clamp } from '../math/scalar';

/** What the camera follows on foot: the character's root and state (src/dragon/model/rider/locomotion). */
export interface OnFootSubject {
  root: THREE.Object3D;
  hips?: THREE.Object3D;
  /** Travel velocity (world x, z) and vertical speed (m/s). */
  velocity: THREE.Vector2;
  vy: number;
  /** Facing (rad about +Y, 0 = +Z). */
  yaw: number;
  state: string;
  crouch: number;
}

const _target = new THREE.Vector3();
const _want = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _up = new THREE.Vector3(0, 1, 0);

/**
 * Over-the-shoulder follow camera for the rider on foot and gliding. The mouse (right button held or pointer locked)
 * orbits and the wheel zooms; left alone it swings back behind the direction of travel. It pulls back and widens while
 * gliding, lowers with a crouch, is pushed out of walls and kept above the ground. Entering, it glides over from
 * wherever the camera was (the dragon's chase view) instead of cutting.
 */
export class OnFootCamera {
  /** Orbit angles (yaw about +Y: the camera sits at -forward of this heading; pitch + = from above) and distance. */
  private yaw = 0;
  private pitch = 0.18;
  private distance = 3.6;
  private zoom = 1;
  private idle = 0;
  private readonly pos = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly startPos = new THREE.Vector3();
  private readonly startQuat = new THREE.Quaternion();
  private blend = 1;
  active = false;

  /** Starts following, blending over from the given pose. */
  enter(subject: OnFootSubject, from: CameraPose): void {
    this.yaw = subject.yaw;
    this.pitch = 0.2;
    this.zoom = 1;
    this.startPos.copy(from.position);
    this.startQuat.copy(from.quaternion);
    this.blend = 0;
    this.focus(subject, this.look);
    this.ideal(subject, this.pos);
    this.active = true;
  }

  exit(): void {
    this.active = false;
  }

  /** Where the camera looks: between the shoulders (lower when crouched). */
  private focus(s: OnFootSubject, out: THREE.Vector3): THREE.Vector3 {
    (s.hips ?? s.root).getWorldPosition(out);
    out.y += 0.5 - 0.25 * s.crouch;
    return out;
  }

  private ideal(s: OnFootSubject, out: THREE.Vector3): THREE.Vector3 {
    const gliding = s.state === 'glide';
    const dist = (gliding ? 7.5 : this.distance) * this.zoom;
    this.focus(s, _target);
    _dir.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    // A little to the right of the shoulder, so the character does not block the way ahead.
    const side = gliding ? 0 : 0.45;
    out.copy(_target).addScaledVector(_dir, dist);
    out.x += Math.cos(this.yaw) * -side;
    out.z += -Math.sin(this.yaw) * -side;
    return out;
  }

  update(frame: CameraFrame, s: OnFootSubject, out: CameraPose): void {
    const dt = frame.camDt;
    // Mouse orbit and wheel zoom.
    this.yaw += frame.lookYaw;
    this.pitch = clamp(this.pitch - frame.lookPitch, -0.35, 1.2);
    this.zoom = clamp(this.zoom * Math.pow(1.12, frame.wheel), 0.5, 3.5);
    // Left alone, swing back behind the travel (after a moment, faster when running or gliding).
    const speed = s.velocity.length();
    this.idle = frame.lookActive && (frame.lookYaw !== 0 || frame.lookPitch !== 0) ? 0 : this.idle + dt;
    if (!frame.lookHeld && speed > 0.6 && this.idle > 0.8) {
      const travel = Math.atan2(s.velocity.x, s.velocity.y);
      let d = travel - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      const rate = s.state === 'glide' ? 2.2 : clamp(speed / 5, 0.3, 1.2) * 1.6;
      this.yaw += d * (1 - Math.exp(-rate * dt));
      const wantPitch = s.state === 'glide' ? 0.3 : 0.18;
      this.pitch += (wantPitch - this.pitch) * (1 - Math.exp(-0.8 * dt));
    }
    this.ideal(s, _want);
    // Walls and the ground push the camera toward the character, never through.
    this.focus(s, _target);
    frame.collision.resolve(_want, 0.3);
    const floor = frame.collision.floorHeight(_want.x, _want.z, 0.35);
    if (_want.y < floor) {
      _want.y = floor;
    }
    // Follow: position eased (a touch of lag), the look point tighter.
    const kp = 1 - Math.exp(-(s.state === 'glide' ? 6 : 10) * dt);
    this.pos.lerp(_want, kp);
    this.look.lerp(_target, 1 - Math.exp(-16 * dt));
    _m.lookAt(this.pos, this.look, _up);
    out.quaternion.setFromRotationMatrix(_m);
    out.position.copy(this.pos);
    // Blend in from the previous view over ~0.8 s.
    if (this.blend < 1) {
      this.blend = Math.min(1, this.blend + dt / 0.8);
      const k = this.blend * this.blend * (3 - 2 * this.blend);
      out.position.lerpVectors(this.startPos, this.pos, k);
      out.quaternion.slerpQuaternions(this.startQuat, out.quaternion, k);
    }
    out.fov = s.state === 'glide' ? 66 : 55;
    out.near = 0.08;
    out.speedEffect = s.state === 'glide' ? 0.15 : 0;
    out.shakeTranslation = 0.3;
    out.shakeRotation = 0.3;
  }
}
