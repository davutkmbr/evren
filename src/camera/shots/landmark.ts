import * as THREE from 'three';
import type { LandmarkDef } from '../../core/contracts';
import { fbm1 } from '../math/noise1d';
import { AXIS_X, AXIS_Y, WORLD_UP, lookRotation, rotateLocal } from '../math/rotation';
import { DEG, clamp, wrapAngle } from '../math/scalar';
import { Spring, VecSpring, leadFor } from '../math/springs';
import type { CameraCollision } from '../obstruction';
import type { CameraPose } from '../types';
import { Shot, range, sign, verticalFovFor, type ShotEnv, type ShotKind } from './shot';

const MIN_DISTANCE = 250;
const MAX_DISTANCE = 5000;
const MIN_HEIGHT = 18;
/** The landmark must fill at least this fraction of the frame height (caps the FOV). */
const MIN_LANDMARK_FILL = 0.2;
const MAX_FOV = 42;
/** Elevation limits of the landmark→dragon line the camera sits on. */
const LINE_MIN_ELEVATION = -5 * DEG;
const LINE_MAX_ELEVATION = 30 * DEG;
/** Cut once the line has swung this far from its initial bearing (the dragon is flying past the landmark). */
const MAX_LINE_SWING = 55 * DEG;
/** Seconds the composition may exceed the FOV cap before cutting (after MIN_SHOT_TIME). */
const OVER_CAP_TOLERANCE = 0.4;
const MIN_SHOT_TIME = 2.5;

const _subject = new THREE.Vector3();
const _landmarkPoint = new THREE.Vector3();
const _toSubject = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _line = new THREE.Vector3();
const _lineUp = new THREE.Vector3();
const _perp = new THREE.Vector3();

interface Candidate {
  landmark: LandmarkDef;
  score: number;
}

interface Composition {
  /** FOV (deg) that fits the dragon and the whole landmark in ~78% of the frame. */
  fit: number;
  /** Largest FOV (deg) at which the landmark still fills MIN_LANDMARK_FILL of the frame height. */
  cap: number;
}

const candidates: Candidate[] = [];

/** Colliders must rise this fraction of the landmark's height above the local ground for it to count as built. */
const BUILT_HEIGHT_FRACTION = 0.3;
const SAMPLE_RING = [
  [0, 0],
  [0.35, 0],
  [-0.35, 0],
  [0, 0.35],
  [0, -0.35],
] as const;
const MAX_ANCHOR_SAMPLES = 6;

/**
 * Evidence that the landmark's geometry exists: landmark modules register colliders for what they build, so
 * somewhere around the site (centre, a ring inside the footprint, the anchors) a collider must stand well above
 * the local terrain or water.
 */
function landmarkBuilt(lm: LandmarkDef, col: CameraCollision): boolean {
  const need = lm.height * BUILT_HEIGHT_FRACTION;
  for (const [fx, fz] of SAMPLE_RING) {
    if (colliderRise(col, lm.x + fx * lm.radius, lm.z + fz * lm.radius) > need) {
      return true;
    }
  }
  const anchors = lm.anchors;
  if (anchors) {
    const n = Math.min(anchors.length, MAX_ANCHOR_SAMPLES);
    for (let i = 0; i < n; i++) {
      if (colliderRise(col, anchors[i].x, anchors[i].z) > need) {
        return true;
      }
    }
  }
  return false;
}

/** Height of the tallest collider at (x, z) above the terrain/water there (0 when there is none). */
function colliderRise(col: CameraCollision, x: number, z: number): number {
  return col.surfaceHeight(x, z) - col.groundHeight(x, z);
}
const composition: Composition = { fit: 0, cap: 0 };

/**
 * Long-lens shot that stacks the dragon over a nearby landmark (Galata, a mosque, a bridge tower...). The camera
 * is re-solved every frame on the line from the landmark through the dragon, offset a few degrees so the dragon
 * sits just above and beside the landmark; the compressed perspective keeps both large in frame.
 */
export class LandmarkShot extends Shot {
  readonly kind: ShotKind = 'landmark';
  private landmark: LandmarkDef | null = null;
  private readonly aim = new VecSpring();
  private readonly fov = new Spring(25);
  private readonly vertical = new Spring(0.05);
  private readonly eye = new THREE.Vector3();
  private distance = 200;
  private sideTan = 0.05;
  private side = 1;
  private startBearing = 0;
  private overCap = 0;
  private time = 0;
  private lastLandmarkId = '';

  begin(env: ShotEnv): boolean {
    const t = env.frame.target;
    const rng = env.rng;
    const geo = env.geo;
    if (!geo || geo.landmarks.length === 0) {
      return false;
    }
    candidates.length = 0;
    for (const lm of geo.landmarks) {
      // Wall polylines have no meaningful centre to frame.
      if (lm.height < MIN_HEIGHT || lm.kind === 'walls') {
        continue;
      }
      const dx = lm.x - t.position.x;
      const dz = lm.z - t.position.z;
      const d = Math.hypot(dx, dz);
      if (d < MIN_DISTANCE + lm.radius || d > MAX_DISTANCE) {
        continue;
      }
      // Geo lists every landmark, but its model (and colliders) may not be built or streamed in yet.
      if (!landmarkBuilt(lm, env.frame.collision)) {
        continue;
      }
      const ahead = (dx * t.travelFlat.x + dz * t.travelFlat.z) / d;
      let score = (lm.height / Math.sqrt(d)) * (1 + 0.4 * ahead);
      if (lm.id === this.lastLandmarkId) {
        score *= 0.25;
      }
      candidates.push({ landmark: lm, score });
    }
    if (candidates.length === 0) {
      return false;
    }
    candidates.sort((a, b) => b.score - a.score);
    const pickCount = Math.min(3, candidates.length);
    for (let attempt = 0; attempt < pickCount; attempt++) {
      const lm = candidates[Math.min(pickCount - 1, Math.floor(rng() * pickCount))].landmark;
      if (this.plan(env, lm)) {
        this.lastLandmarkId = lm.id;
        this.label = lm.name;
        this.start(range(rng, 7, 9.5));
        return true;
      }
    }
    return false;
  }

  private plan(env: ShotEnv, lm: LandmarkDef): boolean {
    const t = env.frame.target;
    const col = env.frame.collision;
    const rng = env.rng;
    this.landmark = lm;
    const scale = clamp(t.size / 24, 0.6, 2);
    this.distance = range(rng, 150, 280) * scale;
    this.sideTan = Math.tan(range(rng, 2, 5) * DEG);
    this.side = sign(rng);
    this.subject(env, _subject);
    this.startBearing = Math.atan2(_subject.x - lm.x, _subject.z - lm.z);
    this.vertical.reset(this.requiredVertical(env, lm));
    this.solve(env, lm, this.eye);
    if (col.resolve(this.eye, 3) > 20) {
      return false;
    }
    this.subject(env, _subject);
    if (!col.lineOfSight(this.eye, _subject, 3)) {
      return false;
    }
    // The landmark itself is a collider: accept a hit that lands on (or right in front of) it.
    this.landmarkPoint(lm, _landmarkPoint);
    const toLm = this.eye.distanceTo(_landmarkPoint);
    const hit = col.firstHit(this.eye, _landmarkPoint);
    if (hit < toLm - lm.radius - 25) {
      return false;
    }
    this.compose(env, lm, _aim, composition);
    if (composition.fit > composition.cap) {
      return false;
    }
    this.fov.reset(composition.fit);
    this.aim.reset(_aim);
    this.overCap = 0;
    this.time = 0;
    return true;
  }

  update(env: ShotEnv, out: CameraPose): void {
    const t = env.frame.target;
    const dt = env.frame.dt;
    const lm = this.landmark;
    this.time += dt;
    if (lm) {
      this.vertical.update(this.requiredVertical(env, lm), 1.5, dt);
      this.solve(env, lm, this.eye);
      if (env.frame.collision.resolve(this.eye, 3) > 20) {
        this.wantsCut = true;
      }
      this.compose(env, lm, _aim, composition);
      _aim.addScaledVector(t.velocity, leadFor(4) * 0.5);
      this.aim.update(_aim, 4, dt);
      out.fov = this.fov.update(Math.min(composition.fit, composition.cap), 1.5, dt);
      this.overCap = composition.fit > composition.cap * 1.1 ? this.overCap + dt : 0;
      this.subject(env, _subject);
      const bearing = Math.atan2(_subject.x - lm.x, _subject.z - lm.z);
      const passing = Math.hypot(_subject.x - lm.x, _subject.z - lm.z) < MIN_DISTANCE * 0.6;
      const swung = Math.abs(wrapAngle(bearing - this.startBearing)) > MAX_LINE_SWING;
      if (passing || swung || (this.elapsed > MIN_SHOT_TIME && this.overCap > OVER_CAP_TOLERANCE)) {
        this.wantsCut = true;
      }
    } else {
      out.fov = this.fov.x;
    }
    out.position.copy(this.eye);
    lookRotation(this.eye, this.aim.x, WORLD_UP, out.quaternion);
    const hh = 0.0012 * (out.fov / 50);
    rotateLocal(out.quaternion, AXIS_Y, fbm1(this.time * 0.4, 77) * hh);
    rotateLocal(out.quaternion, AXIS_X, fbm1(this.time * 0.35, 78) * hh);
    out.near = 0.5;
    out.speedEffect = 0;
    out.shakeTranslation = 0.1;
    out.shakeRotation = 0.1;
  }

  /**
   * Ideal eye: on the landmark→dragon line, `distance` beyond the dragon, shifted sideways by `sideTan` and
   * down by `vertical` (tangents of the dragon's angular offset from the line as seen from the eye).
   */
  private solve(env: ShotEnv, lm: LandmarkDef, out: THREE.Vector3): THREE.Vector3 {
    this.subject(env, _subject);
    this.landmarkPoint(lm, _landmarkPoint);
    _line.subVectors(_subject, _landmarkPoint);
    const flat = Math.max(Math.hypot(_line.x, _line.z), 1);
    const dirX = _line.x / flat;
    const dirZ = _line.z / flat;
    const el = clamp(Math.atan2(_line.y, flat), LINE_MIN_ELEVATION, LINE_MAX_ELEVATION);
    const ce = Math.cos(el);
    const se = Math.sin(el);
    _line.set(dirX * ce, se, dirZ * ce);
    _lineUp.set(-dirX * se, ce, -dirZ * se);
    _perp.set(-dirZ, 0, dirX).multiplyScalar(this.side);
    const d = this.distance;
    return out
      .copy(_subject)
      .addScaledVector(_line, d)
      .addScaledVector(_perp, d * this.sideTan)
      .addScaledVector(_lineUp, -d * this.vertical.x);
  }

  /**
   * Downward eye offset (tangent) that lifts the dragon just clear of the landmark's top in frame: seen from the
   * eye, the dragon's offset from the line is v and the landmark's is v·d/(d + |u|), so they separate by v·|u|/(d + |u|).
   */
  private requiredVertical(env: ShotEnv, lm: LandmarkDef): number {
    const t = env.frame.target;
    this.subject(env, _subject);
    this.landmarkPoint(lm, _landmarkPoint);
    const u = Math.max(_subject.distanceTo(_landmarkPoint), 1);
    const far = this.distance + u;
    const lmTop = Math.atan((lm.height * 0.55) / far);
    const dragonHalf = Math.atan((t.size * 0.2) / this.distance);
    return clamp(((lmTop + dragonHalf * 0.7) * far) / u, 0.01, 0.25);
  }

  private subject(env: ShotEnv, out: THREE.Vector3): THREE.Vector3 {
    const t = env.frame.target;
    return out.copy(t.position).addScaledVector(WORLD_UP, t.riderHeight * 0.4);
  }

  private landmarkPoint(lm: LandmarkDef, out: THREE.Vector3): THREE.Vector3 {
    return out.set(lm.x, lm.y + lm.height * 0.45, lm.z);
  }

  /**
   * Angular bounding box (yaw/elevation seen from the eye) of the dragon and the whole landmark from base to top.
   * Writes the aim point (centre of the box, at the dragon's distance) and the fitting / capped FOVs.
   */
  private compose(env: ShotEnv, lm: LandmarkDef, aimOut: THREE.Vector3, result: Composition): Composition {
    const t = env.frame.target;
    const eye = this.eye;
    this.subject(env, _subject);
    _toSubject.subVectors(_subject, eye);
    const ds = Math.max(_toSubject.length(), 1);
    const yawS = Math.atan2(_toSubject.x, _toSubject.z);
    const elevS = Math.asin(clamp(_toSubject.y / ds, -1, 1));
    const dxL = lm.x - eye.x;
    const dzL = lm.z - eye.z;
    const flatL = Math.max(Math.hypot(dxL, dzL), 1);
    const yawL = Math.atan2(dxL, dzL);
    const elevBase = Math.atan2(lm.y - eye.y, flatL);
    const elevTop = Math.atan2(lm.y + lm.height - eye.y, flatL);
    const dYaw = wrapAngle(yawL - yawS);
    const dragonHalfW = Math.atan((t.size * 0.55) / ds);
    const dragonHalfH = Math.atan((t.size * 0.22) / ds);
    const lmHalfW = Math.atan(Math.max(lm.radius * 0.8, lm.height * 0.25) / flatL);
    const left = Math.min(-dragonHalfW, dYaw - lmHalfW);
    const right = Math.max(dragonHalfW, dYaw + lmHalfW);
    const bottom = Math.min(elevS - dragonHalfH, elevBase);
    const top = Math.max(elevS + dragonHalfH, elevTop);
    const yaw = yawS + (left + right) * 0.5;
    const elev = (top + bottom) * 0.5;
    const ce = Math.cos(elev);
    aimOut.set(Math.sin(yaw) * ce, Math.sin(elev), Math.cos(yaw) * ce).multiplyScalar(ds).add(eye);
    const fill = 1 / 0.78;
    const vertical = ((top - bottom) * fill * 180) / Math.PI;
    const horizontal = verticalFovFor((right - left) * 0.5 * fill * Math.cos(elev), env.aspect);
    result.fit = clamp(Math.max(vertical, horizontal), 6, MAX_FOV);
    result.cap = clamp(((elevTop - elevBase) * 180) / Math.PI / MIN_LANDMARK_FILL, 6, MAX_FOV);
    return result;
  }
}
