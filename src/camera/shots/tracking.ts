import * as THREE from 'three';
import { AXIS_X, WORLD_UP, rotateLocal } from '../math/rotation';
import { DEG, clamp, smootherstep, smoothstep } from '../math/scalar';
import { VecSpring } from '../math/springs';
import type { CameraPose } from '../types';
import { AimRig, Shot, horizontalHalf, range, sign, verticalFovFor, type ShotEnv, type ShotKind } from './shot';

const _offset = new THREE.Vector3();
const _rel = new THREE.Vector3();
const _aimPoint = new THREE.Vector3();
const _subject = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _pan = new THREE.Quaternion();

/**
 * A camera travelling with the dragon at an offset expressed in the smoothed heading frame
 * (x = right, y = up, z = behind). The offset drifts from `relStart` to `relEnd` over the shot (crane/dolly).
 */
abstract class RelativeShot extends Shot {
  protected readonly relStart = new THREE.Vector3();
  protected readonly relEnd = new THREE.Vector3();
  protected fov = 50;
  protected relOmega = 2.5;
  protected aimOmega = 6;
  protected aimAhead = 0;
  protected aimUp = 0;
  protected handheld = 0.0015;
  protected speedFx = 0;
  protected shakeScale = 0.4;
  /** Where the aim point sits on screen (NDC, -1..1; 0 = centre): rule-of-thirds composition. */
  protected screenX = 0;
  protected screenY = 0;
  private readonly offset = new VecSpring();
  private readonly aim = new AimRig();
  private readonly eye = new THREE.Vector3();

  protected abstract plan(env: ShotEnv): boolean;

  begin(env: ShotEnv): boolean {
    if (!this.plan(env)) {
      return false;
    }
    const t = env.frame.target;
    const col = env.frame.collision;
    this.headingOffset(env, this.relStart, _offset);
    this.eye.copy(t.position).add(_offset);
    if (col.resolve(this.eye, 1.5) > 12) {
      return false;
    }
    this.subject(env, _subject);
    if (!col.lineOfSight(this.eye, _subject, 3)) {
      return false;
    }
    this.offset.reset(_offset.subVectors(this.eye, t.position));
    this.aimPoint(env, _aimPoint);
    this.aim.reset(_aimPoint, 29 + Math.floor(env.rng() * 1000));
    return true;
  }

  update(env: ShotEnv, out: CameraPose): void {
    const t = env.frame.target;
    const dt = env.frame.dt;
    const u = smootherstep(this.elapsed / Math.max(this.duration, 1e-3));
    _rel.lerpVectors(this.relStart, this.relEnd, u);
    this.headingOffset(env, _rel, _offset);
    this.offset.update(_offset, this.relOmega, dt);
    this.eye.copy(t.position).add(this.offset.x);
    env.frame.collision.resolve(this.eye, 1.5);
    this.aimPoint(env, _aimPoint);
    this.aim.track(_aimPoint, t.velocity, this.aimOmega, dt);
    out.position.copy(this.eye);
    this.aim.orient(this.eye, WORLD_UP, out.quaternion, this.handheld * (this.fov / 50), dt);
    if (this.screenX !== 0 || this.screenY !== 0) {
      // Pan about the world vertical and tilt about the camera's own horizontal axis, so the offset never rolls the horizon.
      const tanV = Math.tan((this.fov * DEG) / 2);
      _fwd.set(0, 0, -1).applyQuaternion(out.quaternion);
      const pan = Math.atan(this.screenX * tanV * env.aspect) / Math.max(Math.sqrt(1 - _fwd.y * _fwd.y), 0.5);
      out.quaternion.premultiply(_pan.setFromAxisAngle(WORLD_UP, pan));
      rotateLocal(out.quaternion, AXIS_X, Math.atan(-this.screenY * tanV));
    }
    out.fov = this.fov;
    out.near = 0.3;
    out.speedEffect = this.speedFx * smoothstep(40, 110, t.speed);
    out.shakeTranslation = this.shakeScale;
    out.shakeRotation = this.shakeScale;
  }

  protected subject(env: ShotEnv, out: THREE.Vector3): THREE.Vector3 {
    const t = env.frame.target;
    return out.copy(t.position).addScaledVector(WORLD_UP, t.riderHeight * 0.4);
  }

  protected aimPoint(env: ShotEnv, out: THREE.Vector3): THREE.Vector3 {
    this.subject(env, out);
    out.addScaledVector(env.headingFwd, this.aimAhead);
    out.y += this.aimUp;
    return out;
  }

  private headingOffset(env: ShotEnv, rel: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    return out
      .set(0, 0, 0)
      .addScaledVector(env.headingRight, rel.x)
      .addScaledVector(WORLD_UP, rel.y)
      .addScaledVector(env.headingFwd, -rel.z);
  }
}

function sizeScale(env: ShotEnv): number {
  return clamp(env.frame.target.size / 24, 0.6, 2);
}

/** Low angle from below and to the side, looking up at the dragon against the sky; skims the water when low. */
export class LowTrackingShot extends RelativeShot {
  readonly kind: ShotKind = 'low';

  protected plan(env: ShotEnv): boolean {
    const t = env.frame.target;
    const rng = env.rng;
    const s = sizeScale(env);
    const side = sign(rng) * range(rng, 15, 22) * s;
    const back = range(rng, 10, 20) * s;
    let down = range(rng, 7, 12) * s;
    down = Math.min(down, Math.max(-2, t.agl - 5));
    this.relStart.set(side, -down, back);
    this.relEnd.set(side * range(rng, 0.85, 1.15), -down * range(rng, 0.75, 1.1), back - range(rng, 8, 16) * s);
    this.fov = range(rng, 52, 60);
    this.relOmega = 3;
    this.aimOmega = 6;
    this.aimAhead = 6 * s;
    this.aimUp = 0.5;
    this.handheld = 0.0018;
    this.speedFx = 0.35;
    this.shakeScale = 0.5;
    this.start(range(rng, 6, 9));
    this.label = 'Alçak takip';
    return true;
  }
}

/** Long-lens parallel tracking from the side; the dragon slowly overtakes the camera with lead room ahead. */
export class SideTrackingShot extends RelativeShot {
  readonly kind: ShotKind = 'side';

  protected plan(env: ShotEnv): boolean {
    const rng = env.rng;
    const s = sizeScale(env);
    const side = sign(rng) * range(rng, 36, 55) * s;
    const y = range(rng, -3, 6) * s;
    this.relStart.set(side, y, -range(rng, 6, 14) * s);
    this.relEnd.set(side * range(rng, 0.9, 1.05), y, range(rng, 6, 14) * s);
    this.fov = range(rng, 28, 36);
    // Lead room: the dragon on the trailing third (aim ahead by a third of the half frame width), but never so far
    // that the tail leaves the frame. If even a centred dragon would not fit, widen the lens instead.
    const t = env.frame.target;
    const reach = 0.55 * Math.max(t.length, t.wingspan * 0.6) + 1;
    const dist = Math.abs(side);
    const halfWidth = dist * Math.tan(0.92 * horizontalHalf(this.fov, env.aspect));
    if (halfWidth < reach) {
      this.fov = verticalFovFor(Math.atan(reach / dist) / 0.92, env.aspect);
    }
    const usable = dist * Math.tan(0.92 * horizontalHalf(this.fov, env.aspect)) - reach;
    this.aimAhead = clamp((dist * Math.tan(horizontalHalf(this.fov, env.aspect))) / 3, 0, Math.max(0, usable));
    this.relOmega = 2;
    this.aimOmega = 5;
    this.aimUp = 0;
    this.handheld = 0.0012;
    this.speedFx = 0.15;
    this.shakeScale = 0.25;
    this.start(range(rng, 6, 9));
    this.label = 'Yan takip';
    return true;
  }
}

/** Smallest wingspan / frame-width ratio for the establishing shot. */
const ESTABLISHING_MIN_SPAN = 0.17;

/** High, wide crane shot behind the dragon that shows the city it is flying into. */
export class EstablishingShot extends RelativeShot {
  readonly kind: ShotKind = 'establishing';

  protected plan(env: ShotEnv): boolean {
    const rng = env.rng;
    const t = env.frame.target;
    const s = sizeScale(env);
    const sideSign = sign(rng);
    const side = sideSign * range(rng, 14, 32) * s;
    const back = range(rng, 48, 72) * s;
    const up = range(rng, 16, 30) * s;
    this.relStart.set(side, up, back);
    this.relEnd.set(side * 1.2, up * 1.2, back * 0.85);
    // Low enough that the skyline stays in the upper part of the frame; the lens is chosen so the wingspan fills
    // at least MIN_SPAN of the frame width from the farthest point of the move.
    const far = Math.max(this.relStart.length(), this.relEnd.length());
    const maxFov = verticalFovFor(Math.atan(t.wingspan / (2 * far * ESTABLISHING_MIN_SPAN)), env.aspect);
    this.fov = clamp(Math.min(range(rng, 50, 58), maxFov), 30, 58);
    // Dragon on a lower-third intersection, on the side it is seen from, with the city ahead filling the rest.
    this.aimAhead = 0;
    this.aimUp = 0;
    this.screenX = -sideSign / 3;
    this.screenY = -1 / 3;
    this.relOmega = 1.3;
    this.aimOmega = 3;
    this.handheld = 0.0014;
    this.speedFx = 0;
    this.shakeScale = 0.15;
    this.start(range(rng, 7, 10));
    this.label = 'Genel plan';
    return true;
  }
}
