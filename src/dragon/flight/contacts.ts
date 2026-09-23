import * as THREE from 'three';
import type { CollisionWorld, ContactResult } from '../../core/collision';
import type { BodyState } from './body';
import { BODY_SPHERES, MOMENTS } from './params';

const _center = new THREE.Vector3();
const _lever = new THREE.Vector3();
const _omegaWorld = new THREE.Vector3();
const _pointVel = new THREE.Vector3();
const _tangent = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _tmp2 = new THREE.Vector3();
const _impulse = new THREE.Vector3();
const _invQ = new THREE.Quaternion();

export interface ImpactReport {
  /** Strongest normal approach speed this step (m/s), 0 if none. */
  speed: number;
  readonly point: THREE.Vector3;
  /** Contact normal of the strongest impact. */
  readonly normal: THREE.Vector3;
  surface: string;
  touched: boolean;
}

/**
 * Body collision spheres (chest, hips, head, tail) resolved against the static collision world with
 * rigid-body impulses (restitution + Coulomb friction), so glancing hits make the dragon tumble and bleed speed.
 */
export class BodyContacts {
  readonly offsets: THREE.Vector3[] = [];
  readonly radii: number[] = [];
  /** Depth of the lowest body point below the center of mass with legs tucked. */
  bellyDepth = 1.6;
  /** The tail sphere is skipped while hovering/landing (the tail is lifted clear of the ground). */
  tailEnabled = true;
  private readonly contact: ContactResult = { normal: new THREE.Vector3(), depth: 0, surface: '' };

  constructor() {
    this.configure(18, 2.4);
  }

  configure(length: number, standHeight: number): void {
    this.offsets.length = 0;
    this.radii.length = 0;
    for (const [x, y, z, r] of BODY_SPHERES) {
      this.offsets.push(new THREE.Vector3(x * length, y * length, z * length));
      this.radii.push(Math.min(r * length, Math.max(standHeight - 0.35, 0.5)));
    }
    this.bellyDepth = this.radii[0];
  }

  /**
   * Airborne resolution: full impulses. Water contacts are ignored here (flight handles water itself).
   */
  resolveAirborne(body: BodyState, collision: CollisionWorld, invInertia: THREE.Vector3, mass: number, report: ImpactReport): void {
    report.speed = 0;
    report.touched = false;
    const count = this.tailEnabled ? this.offsets.length : this.offsets.length - 1;
    for (let i = 0; i < count; i++) {
      const r = this.radii[i];
      _lever.copy(this.offsets[i]).applyQuaternion(body.quaternion);
      _center.copy(body.position).add(_lever);
      const c = this.query(collision, _center, r);
      if (!c) {
        continue;
      }
      report.touched = true;
      const n = c.normal;
      body.position.addScaledVector(n, c.depth);
      // Head and tail hang on flexible neck/tail chains: they pass on much less torque than the torso.
      const compliance = i >= 2 ? 0.25 : 1;
      const approach = this.applyImpulse(body, _lever, n, invInertia, mass, c.surface === 'ground' ? 0.12 : 0.15, c.surface === 'ground' ? 0.5 : 0.35, compliance);
      if (approach > report.speed) {
        report.speed = approach;
        report.point.copy(_center).addScaledVector(n, -r);
        report.normal.copy(n);
        report.surface = c.surface;
      }
    }
    const w = body.angularVelocity;
    const spin = w.length();
    if (spin > MOMENTS.maxAngularSpeed) {
      w.multiplyScalar(MOMENTS.maxAngularSpeed / spin);
    }
  }

  /**
   * Ground/water locomotion: only push out of structures horizontally (the surface itself is followed kinematically).
   * Returns true if a wall was hit.
   */
  resolveWalls(body: BodyState, collision: CollisionWorld, report: ImpactReport): boolean {
    report.speed = 0;
    report.touched = false;
    let hit = false;
    for (let i = 0; i < this.offsets.length; i++) {
      const r = this.radii[i] * 0.9;
      _lever.copy(this.offsets[i]).applyQuaternion(body.quaternion);
      _center.copy(body.position).add(_lever);
      const c = this.query(collision, _center, r);
      if (!c || c.surface === 'ground' || Math.abs(c.normal.y) > 0.7) {
        continue;
      }
      _tmp.set(c.normal.x, 0, c.normal.z);
      const len = _tmp.length();
      if (len < 1e-4) {
        continue;
      }
      _tmp.divideScalar(len);
      body.position.addScaledVector(_tmp, c.depth / len);
      const vn = body.velocity.dot(_tmp);
      if (vn < 0) {
        body.velocity.addScaledVector(_tmp, -vn);
        if (-vn > report.speed) {
          report.speed = -vn;
          report.point.copy(_center).addScaledVector(_tmp, -r);
          report.surface = c.surface;
        }
      }
      hit = true;
      report.touched = true;
    }
    return hit;
  }

  private query(collision: CollisionWorld, center: THREE.Vector3, r: number): ContactResult | null {
    let c = collision.resolveSphere(center, r, this.contact);
    if (c && c.surface === 'water') {
      // The collision world treats the sea surface as ground; re-test structures just above it.
      if (center.y - r < 0.02) {
        _tmp2.set(center.x, r + 0.02, center.z);
        c = collision.resolveSphere(_tmp2, r, this.contact);
        if (c && c.surface === 'water') {
          c = null;
        }
      } else {
        c = null;
      }
    }
    return c;
  }

  /** Rigid-body contact impulse at world lever arm `r`. Returns the normal approach speed (>= 0). */
  private applyImpulse(
    body: BodyState,
    r: THREE.Vector3,
    n: THREE.Vector3,
    invI: THREE.Vector3,
    mass: number,
    restitution: number,
    friction: number,
    angularScale: number,
  ): number {
    _omegaWorld.copy(body.angularVelocity).applyQuaternion(body.quaternion);
    _pointVel.crossVectors(_omegaWorld, r).add(body.velocity);
    const vn = _pointVel.dot(n);
    if (vn >= 0) {
      return 0;
    }
    _invQ.copy(body.quaternion).invert();
    const kn = 1 / mass + angularScale * this.angularTerm(r, n, invI, body.quaternion);
    const jn = (-(1 + restitution) * vn) / kn;
    _impulse.copy(n).multiplyScalar(jn);

    _tangent.copy(_pointVel).addScaledVector(n, -vn);
    const vt = _tangent.length();
    if (vt > 1e-4) {
      _tangent.divideScalar(vt);
      const kt = 1 / mass + angularScale * this.angularTerm(r, _tangent, invI, body.quaternion);
      const jt = Math.min(friction * jn, vt / kt);
      _impulse.addScaledVector(_tangent, -jt);
    }

    body.velocity.addScaledVector(_impulse, 1 / mass);
    _tmp.crossVectors(r, _impulse).applyQuaternion(_invQ).multiplyScalar(angularScale);
    body.angularVelocity.x += _tmp.x * invI.x;
    body.angularVelocity.y += _tmp.y * invI.y;
    body.angularVelocity.z += _tmp.z * invI.z;
    return -vn;
  }

  /** n · ((I⁻¹ (r × n)) × r) with I diagonal in the body frame. */
  private angularTerm(r: THREE.Vector3, n: THREE.Vector3, invI: THREE.Vector3, q: THREE.Quaternion): number {
    _tmp.crossVectors(r, n).applyQuaternion(_invQ);
    _tmp.set(_tmp.x * invI.x, _tmp.y * invI.y, _tmp.z * invI.z).applyQuaternion(q);
    _tmp2.crossVectors(_tmp, r);
    return _tmp2.dot(n);
  }
}
