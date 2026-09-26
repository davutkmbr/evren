import * as THREE from 'three';
import { WORLD_UP } from '../math/rotation';
import { DEG, clamp } from '../math/scalar';
import { Spring } from '../math/springs';
import type { CameraCollision } from '../obstruction';
import type { CameraPose } from '../types';

/** The viewing mode's camera styles: a slow drift over the dragon's shoulder, or a still "postcard" framing. */
export type PerchCameraStyle = 'orbit' | 'fixed';

export const PERCH_CAMERA = {
  /** Boom length as a multiple of the dragon's size (max of length and wingspan). */
  radius: 1.25,
  radiusFixed: 1.4,
  /** Shortest boom the obstruction handling may pull in to, as a multiple of the size (never into the dragon). */
  minRadius: 0.55,
  /** Candidate placements searched when the shot starts: azimuths off "behind the dragon" and elevations. */
  searchAzimuth: 80 * DEG,
  searchStep: 10 * DEG,
  searchElevations: [7 * DEG, 12 * DEG, 18 * DEG, 26 * DEG] as readonly number[],
  /** Preferred placement: over the shoulder (this far off straight behind) at this elevation. */
  shoulder: 24 * DEG,
  elevation: 12 * DEG,
  /** Orbit drift around the chosen placement (azimuth / elevation amplitude, periods s) and the boom breathing. */
  swing: 16 * DEG,
  swingPeriod: 96,
  elevationSwing: 3 * DEG,
  elevationPeriod: 57,
  breathe: 0.05,
  /** Composition: where the dragon's centre sits on screen (NDC; y -0.38 = the lower third), and how far the view
   *  heading may be turned off the screen centre to keep it there (the view dominates the frame). */
  screenY: -0.38,
  maxScreenX: 0.33,
  /** View openness probe: rays from the eye along the view within ±spread, this long (m). */
  probeSpread: 25 * DEG,
  probeLength: 90,
  /** Pivot above the dragon's centre (m); clearance the boom keeps from obstacles (m). */
  pivotUp: 1.5,
  boomMargin: 1.5,
  eyeRadius: 1.2,
  fov: 52,
  /** Mouse look: elevation limits (rad). */
  minElevation: -4 * DEG,
  maxElevation: 60 * DEG,
} as const;

const _pivot = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _to = new THREE.Vector3();
const _probe = new THREE.Vector3();
const _look = new THREE.Vector3();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');

/** Dragon body points (offsets from its centre as fractions of the size) the camera must see. */
const BODY_POINTS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 0, 0],
  [0, 0.12, 0],
  [0.18, 0, 0],
  [-0.18, 0, 0],
  [0, 0, 0.2],
  [0, 0, -0.2],
];

/**
 * Perch viewing camera (phase 03). Composition rule: the dragon sits in the lower third and to one side, framed
 * against the perch's view, which fills the rest of the frame. When the shot starts, the rig searches placements
 * around the dragon (azimuth x elevation) with raycasts against the collision world and keeps the one with a full
 * clear boom, a clear line to the dragon's body and the most open view beyond, preferring the over-the-shoulder spot.
 * Orbit drifts slowly around that placement (only as far as it stays clear); fixed holds it. Every frame the boom is
 * cast (pulled in, never closer than minRadius), the line to the dragon checked (the drift eases back to the clear
 * placement when blocked) and the eye pushed out of geometry. The orientation is solved so the dragon lands on its
 * screen spot while the view heading stays as central as that allows. Pure camera maths (no engine).
 */
export class PerchCameraRig {
  style: PerchCameraStyle = 'orbit';
  private time = 0;
  private az = PERCH_CAMERA.shoulder;
  private el = PERCH_CAMERA.elevation;
  /** Clear drift range around `az` found by the search (rad, each side). */
  private swingRange: number = PERCH_CAMERA.swing;
  private userAz = 0;
  private userEl = 0;
  private size = 24;
  private readonly boom = new Spring(30);
  private readonly drift = new Spring(1);
  /** Last placement score parts (debugging / headless checks). */
  readonly last = { az: 0, el: 0, open: 0, clearBoom: 0, visible: 0 };

  /** Starts the shot around `anchor` (the dragon's centre) looking along `viewYaw` (Object3D yaw of the perch view). */
  begin(anchor: THREE.Vector3, viewYaw: number, size: number, collision: CameraCollision, from: CameraPose | null): void {
    this.size = clamp(size, 8, 60);
    this.time = 0;
    this.userAz = 0;
    this.userEl = 0;
    const fixed = this.style === 'fixed';
    const radius = this.size * (fixed ? PERCH_CAMERA.radiusFixed : PERCH_CAMERA.radius);
    this.choosePlacement(anchor, viewYaw, collision, radius, fixed);
    this.drift.reset(1);
    if (from) {
      _dir.subVectors(from.position, anchor);
      this.boom.reset(clamp(_dir.length(), this.size * PERCH_CAMERA.minRadius, this.size * 2));
    } else {
      this.boom.reset(radius);
    }
  }

  update(dt: number, anchor: THREE.Vector3, viewYaw: number, collision: CameraCollision, lookYaw: number, lookPitch: number, out: CameraPose): void {
    this.time += dt;
    this.userAz = wrap(this.userAz + lookYaw);
    this.userEl += lookPitch;
    const orbit = this.style === 'orbit';
    const t = this.time;
    let radius = this.size * (!orbit ? PERCH_CAMERA.radiusFixed : PERCH_CAMERA.radius);
    let az = this.az;
    let el = this.el;
    if (orbit) {
      const k = this.drift.x;
      az += this.swingRange * k * Math.sin((t / PERCH_CAMERA.swingPeriod) * Math.PI * 2);
      el += PERCH_CAMERA.elevationSwing * k * Math.sin((t / PERCH_CAMERA.elevationPeriod) * Math.PI * 2);
      radius *= 1 + PERCH_CAMERA.breathe * Math.sin((t / 61) * Math.PI * 2);
    }
    az += this.userAz;
    this.userEl = clamp(this.userEl, PERCH_CAMERA.minElevation - this.el, PERCH_CAMERA.maxElevation - this.el);
    el = clamp(el + this.userEl, PERCH_CAMERA.minElevation, PERCH_CAMERA.maxElevation);
    this.direction(viewYaw, az, el, _dir);
    _pivot.copy(anchor).addScaledVector(WORLD_UP, PERCH_CAMERA.pivotUp);
    const minBoom = this.size * PERCH_CAMERA.minRadius;
    let allowed = Math.max(minBoom, collision.castBoom(_pivot, _dir, radius, PERCH_CAMERA.boomMargin));
    // The dragon must stay visible: a blocked line pulls the eye in to just before the obstacle, and the drift eases
    // back toward the searched (clear) placement.
    _eye.copy(_pivot).addScaledVector(_dir, Math.min(allowed, this.boom.x));
    const visible = this.bodyVisible(_eye, anchor, collision);
    if (orbit && dt > 0) {
      this.drift.update(visible ? 1 : 0, visible ? 0.25 : 1.5, dt);
    }
    if (!visible) {
      const hit = collision.firstHit(_pivot, _eye);
      if (Number.isFinite(hit)) {
        allowed = Math.max(minBoom, Math.min(allowed, hit - PERCH_CAMERA.boomMargin));
      }
    }
    if (allowed < this.boom.x || dt <= 0) {
      this.boom.reset(allowed);
    } else {
      this.boom.update(allowed, 1.2, dt);
    }
    out.position.copy(_pivot).addScaledVector(_dir, Math.min(radius, this.boom.x));
    collision.resolve(out.position, PERCH_CAMERA.eyeRadius);
    this.compose(out.position, anchor, viewYaw, out.quaternion);
    out.fov = PERCH_CAMERA.fov;
    out.near = 0.3;
    out.speedEffect = 0;
    out.shakeTranslation = 0.3;
    out.shakeRotation = 0.3;
  }

  /**
   * Orientation that puts the dragon's centre at (x, screenY) on screen, with x as close to the view heading's own
   * screen position as allowed: the camera yaws toward the view heading until the dragon would leave ±maxScreenX.
   */
  private compose(eye: THREE.Vector3, anchor: THREE.Vector3, viewYaw: number, out: THREE.Quaternion): void {
    _to.subVectors(anchor, eye);
    const horiz = Math.hypot(_to.x, _to.z);
    const dragonYaw = Math.atan2(-_to.x, -_to.z);
    const dragonPitch = Math.atan2(_to.y, Math.max(horiz, 1e-3));
    const tanV = Math.tan((PERCH_CAMERA.fov * DEG) / 2);
    const tanH = tanV * (16 / 9);
    // Yaw: look along the view heading, turned toward the dragon just enough to keep it inside ±maxScreenX.
    const maxOff = Math.atan(PERCH_CAMERA.maxScreenX * tanH);
    const off = wrap(dragonYaw - viewYaw);
    const yaw = dragonYaw - clamp(off, -maxOff, maxOff);
    // Pitch: the dragon at screenY below the centre.
    const pitch = dragonPitch - Math.atan(PERCH_CAMERA.screenY * tanV);
    _euler.set(clamp(pitch, -70 * DEG, 30 * DEG), yaw, 0);
    out.setFromEuler(_euler);
  }

  /** True when the eye sees most of the dragon's body (at most one probe point blocked). */
  private bodyVisible(eye: THREE.Vector3, anchor: THREE.Vector3, collision: CameraCollision): boolean {
    let blocked = 0;
    for (const [x, y, z] of BODY_POINTS) {
      _probe.set(anchor.x + x * this.size, anchor.y + y * this.size, anchor.z + z * this.size);
      if (!collision.lineOfSight(eye, _probe, 1.5)) {
        blocked++;
        if (blocked > 1) {
          return false;
        }
      }
    }
    return true;
  }

  /** Unit direction from the pivot to the eye: azimuth `az` off "behind the dragon", elevation `el`. */
  private direction(viewYaw: number, az: number, el: number, out: THREE.Vector3): THREE.Vector3 {
    // Behind the dragon is +forward reversed: yaw direction (sin yaw, cos yaw) points backwards (forward is -sin, -cos).
    const a = viewYaw + az;
    const ce = Math.cos(el);
    return out.set(Math.sin(a) * ce, Math.sin(el), Math.cos(a) * ce);
  }

  /**
   * Searches placements around the dragon and keeps the best: a full clear boom, the dragon visible, the view open
   * (probe rays along the heading from the eye), close to the preferred over-the-shoulder spot. For the orbit it also
   * measures how far the drift can swing either way and stay clear.
   */
  private choosePlacement(anchor: THREE.Vector3, viewYaw: number, collision: CameraCollision, radius: number, fixed: boolean): void {
    const C = PERCH_CAMERA;
    _pivot.copy(anchor).addScaledVector(WORLD_UP, C.pivotUp);
    let best = { score: -Infinity, az: C.shoulder, el: C.elevation, open: 0, clearBoom: 0, visible: 0 };
    for (let az = -C.searchAzimuth; az <= C.searchAzimuth + 1e-6; az += C.searchStep) {
      for (const el of C.searchElevations) {
        const s = this.placementScore(anchor, viewYaw, collision, radius, az, el);
        // Prefer the shoulder (either side), then a moderate elevation; the still framing sits a little lower.
        const prefEl = fixed ? C.elevation - 3 * DEG : C.elevation;
        const score = s.clearBoom * 3 + s.visible * 3 + s.open * 2 - Math.abs(Math.abs(az) - C.shoulder) * 0.9 - Math.abs(el - prefEl) * 1.2;
        if (score > best.score) {
          best = { score, az, el, ...s };
        }
      }
    }
    this.az = best.az;
    this.el = best.el;
    Object.assign(this.last, { az: best.az, el: best.el, open: best.open, clearBoom: best.clearBoom, visible: best.visible });
    // Drift range: grow each side while the placement stays clear.
    let range = 0;
    for (let r = C.searchStep / 2; r <= C.swing + 1e-6; r += C.searchStep / 2) {
      const a = this.placementScore(anchor, viewYaw, collision, radius, best.az + r, best.el);
      const b = this.placementScore(anchor, viewYaw, collision, radius, best.az - r, best.el);
      if (a.clearBoom < 1 || b.clearBoom < 1 || a.visible < 1 || b.visible < 1) {
        break;
      }
      range = r;
    }
    this.swingRange = range;
  }

  private placementScore(anchor: THREE.Vector3, viewYaw: number, collision: CameraCollision, radius: number, az: number, el: number): { clearBoom: number; visible: number; open: number } {
    const C = PERCH_CAMERA;
    this.direction(viewYaw, az, el, _dir);
    const boom = collision.castBoom(_pivot, _dir, radius, C.boomMargin);
    const clearBoom = boom >= radius - 0.01 ? 1 : boom / radius;
    _eye.copy(_pivot).addScaledVector(_dir, Math.max(boom, this.size * C.minRadius));
    const visible = collision.blocked(_eye, C.eyeRadius) ? 0 : this.bodyVisible(_eye, anchor, collision) ? 1 : 0;
    // View openness: rays from the eye along the heading (level, slightly down and through the lower part of the
    // frame beside the dragon), clear for probeLength: foreground structure right under the view counts against.
    let open = 0;
    let n = 0;
    for (const s of [-1, -0.5, 0, 0.5, 1]) {
      for (const p of [-18 * DEG, -6 * DEG, 2 * DEG]) {
        const a = viewYaw + s * C.probeSpread;
        _look.set(-Math.sin(a) * Math.cos(p), Math.sin(p), -Math.cos(a) * Math.cos(p));
        // Start past the dragon so its own perch does not count as a blocker of the view.
        _probe.copy(_eye).addScaledVector(_look, 1);
        const d = collision.hitDistance(_probe, _look, C.probeLength);
        open += Number.isFinite(d) ? Math.min(1, d / C.probeLength) : 1;
        n++;
      }
    }
    return { clearBoom, visible, open: open / n };
  }
}

function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}
