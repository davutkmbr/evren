import * as THREE from 'three';
import { WORLD_UP } from '../math/rotation';
import { clamp } from '../math/scalar';
import { Spring } from '../math/springs';
import type { CameraPose } from '../types';
import { AimRig, Shot, range, sign, verticalFovFor, type ShotEnv, type ShotKind } from './shot';

const _future = new THREE.Vector3();
const _subject = new THREE.Vector3();
const _toSubject = new THREE.Vector3();

/** Subject point: a little above the body origin so the rider is in the frame too. */
function subjectPoint(env: ShotEnv, out: THREE.Vector3): THREE.Vector3 {
  const t = env.frame.target;
  return out.copy(t.position).addScaledVector(WORLD_UP, t.riderHeight * 0.4);
}

/**
 * Static camera planted beside the predicted flight path a few seconds ahead; it pans to follow the
 * dragon as it roars past (classic air-show flyby).
 */
export class FlybyShot extends Shot {
  readonly kind: ShotKind = 'flyby';
  private readonly eye = new THREE.Vector3();
  private readonly aim = new AimRig();
  private fov = 50;
  /** Cut once the dragon is this far past the camera (m). */
  private passDistance = 230;

  begin(env: ShotEnv): boolean {
    const t = env.frame.target;
    const col = env.frame.collision;
    const rng = env.rng;
    if (t.speed < 12) {
      return false;
    }
    const scale = clamp(t.size / 24, 0.6, 2);
    const lead = clamp(t.speed * range(rng, 2.6, 3.6), 70, 280);
    const side = sign(rng) * range(rng, 11, 24) * scale;
    const vert = range(rng, -5, 8) * scale;
    _future.copy(t.position).addScaledVector(t.travelDir, lead);
    this.eye.copy(_future).addScaledVector(t.travelRight, side).addScaledVector(WORLD_UP, vert);
    if (col.resolve(this.eye, 2.5) > 25) {
      return false;
    }
    subjectPoint(env, _subject);
    if (!col.lineOfSight(this.eye, _subject, 3) || !col.lineOfSight(this.eye, _future, 3)) {
      return false;
    }
    this.fov = range(rng, 42, 52);
    this.aim.reset(_subject, 3 + Math.floor(rng() * 1000));
    this.start(clamp(lead / t.speed + range(rng, 3.0, 4.0), 6, 10));
    this.passDistance = Math.max(230, t.speed * 4.5);
    this.label = 'Geçiş';
    return true;
  }

  update(env: ShotEnv, out: CameraPose): void {
    const t = env.frame.target;
    const dt = env.frame.dt;
    subjectPoint(env, _subject);
    this.aim.track(_subject, t.velocity, 7, dt);
    out.position.copy(this.eye);
    this.aim.orient(this.eye, WORLD_UP, out.quaternion, 0.0022 * (this.fov / 50), dt);
    out.fov = this.fov;
    out.near = 0.3;
    out.speedEffect = 0;
    out.shakeTranslation = 0.2;
    out.shakeRotation = 0.25;
    _toSubject.subVectors(t.position, this.eye);
    if (_toSubject.dot(t.velocity) > 0 && _toSubject.length() > this.passDistance) {
      this.wantsCut = true;
    }
  }
}

/**
 * Long-lens shot from far ahead: the dragon approaches head-on out of a compressed city backdrop while the
 * operator slowly zooms out to keep it at a constant size in frame.
 */
export class IncomingShot extends Shot {
  readonly kind: ShotKind = 'incoming';
  private readonly eye = new THREE.Vector3();
  private readonly aim = new AimRig();
  private readonly fov = new Spring(20);

  begin(env: ShotEnv): boolean {
    const t = env.frame.target;
    const col = env.frame.collision;
    const rng = env.rng;
    if (t.speed < 15) {
      return false;
    }
    const lead = clamp(t.speed * range(rng, 7, 9), 260, 640);
    _future.copy(t.position).addScaledVector(t.travelDir, lead);
    this.eye
      .copy(_future)
      .addScaledVector(t.travelRight, sign(rng) * range(rng, 8, 28))
      .addScaledVector(WORLD_UP, range(rng, -6, 12));
    if (col.resolve(this.eye, 3) > 30) {
      return false;
    }
    subjectPoint(env, _subject);
    _future.copy(t.position).addScaledVector(t.travelDir, lead * 0.5);
    if (!col.lineOfSight(this.eye, _subject, 3) || !col.lineOfSight(this.eye, _future, 3)) {
      return false;
    }
    this.fov.reset(this.framingFov(env));
    this.aim.reset(_subject, 11 + Math.floor(rng() * 1000));
    this.start(clamp((lead - 50) / t.speed, 6, 9));
    this.label = 'Tele yaklaşma';
    return true;
  }

  update(env: ShotEnv, out: CameraPose): void {
    const t = env.frame.target;
    const dt = env.frame.dt;
    subjectPoint(env, _subject);
    this.aim.track(_subject, t.velocity, 5, dt);
    out.position.copy(this.eye);
    const fov = this.fov.update(this.framingFov(env), 1.6, dt);
    this.aim.orient(this.eye, WORLD_UP, out.quaternion, 0.0016 * (fov / 50), dt);
    out.fov = fov;
    out.near = 0.3;
    out.speedEffect = 0;
    out.shakeTranslation = 0.1;
    out.shakeRotation = 0.1;
    _toSubject.subVectors(t.position, this.eye);
    const dist = _toSubject.length();
    if (dist < Math.max(40, t.size * 1.8) || _toSubject.dot(t.velocity) > 0) {
      this.wantsCut = true;
    }
  }

  /** Keeps the dragon's span at ~45% of the frame width. */
  private framingFov(env: ShotEnv): number {
    const t = env.frame.target;
    const dist = Math.max(1, this.eye.distanceTo(t.position));
    return clamp(verticalFovFor(Math.atan(t.size / (dist * 0.9)), env.aspect), 5, 50);
  }
}
