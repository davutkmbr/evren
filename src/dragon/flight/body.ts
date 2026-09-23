import * as THREE from 'three';

/** Rigid body state. Angular velocity is expressed in the body frame (x pitch, y yaw, z roll; right-handed). */
export class BodyState {
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  readonly quaternion = new THREE.Quaternion();
  readonly angularVelocity = new THREE.Vector3();

  copy(other: BodyState): this {
    this.position.copy(other.position);
    this.velocity.copy(other.velocity);
    this.quaternion.copy(other.quaternion);
    this.angularVelocity.copy(other.angularVelocity);
    return this;
  }

  isFinite(): boolean {
    const p = this.position;
    const v = this.velocity;
    const q = this.quaternion;
    const w = this.angularVelocity;
    return (
      Number.isFinite(p.x + p.y + p.z) &&
      Number.isFinite(v.x + v.y + v.z) &&
      Number.isFinite(q.x + q.y + q.z + q.w) &&
      Number.isFinite(w.x + w.y + w.z)
    );
  }
}

const _step = new THREE.Quaternion();
const _axis = new THREE.Vector3();

/** Exact exponential-map update q <- q * exp(ω h / 2) for a body-frame angular velocity. */
export function integrateOrientation(q: THREE.Quaternion, omegaBody: THREE.Vector3, h: number): void {
  const speed = omegaBody.length();
  if (speed < 1e-9) {
    return;
  }
  _axis.copy(omegaBody).divideScalar(speed);
  _step.setFromAxisAngle(_axis, speed * h);
  q.multiply(_step).normalize();
}

/** Body axes in world space. Forward is -Z, up +Y, right +X. */
export class BodyAxes {
  readonly forward = new THREE.Vector3();
  readonly up = new THREE.Vector3();
  readonly right = new THREE.Vector3();

  update(q: THREE.Quaternion): this {
    this.forward.set(0, 0, -1).applyQuaternion(q);
    this.up.set(0, 1, 0).applyQuaternion(q);
    this.right.set(1, 0, 0).applyQuaternion(q);
    return this;
  }

  /** Bank angle, positive = right wing down. */
  bank(): number {
    return Math.atan2(-this.right.y, this.up.y);
  }

  /** Nose pitch above the horizon. */
  pitch(): number {
    return Math.asin(Math.max(-1, Math.min(1, this.forward.y)));
  }

  /** Yaw of the nose around +Y (Object3D convention, forward -Z). */
  yaw(): number {
    if (Math.abs(this.forward.y) < 0.985) {
      return Math.atan2(-this.forward.x, -this.forward.z);
    }
    // Nose (almost) vertical: use the belly/back direction projected on the ground.
    const s = this.forward.y > 0 ? 1 : -1;
    return Math.atan2(s * this.up.x, s * this.up.z);
  }
}
