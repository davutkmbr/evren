import * as THREE from 'three';
import type { CameraMode } from '../../core/contracts';
import { createRng } from '../../core/math/noise';
import { WORLD_UP } from '../math/rotation';
import { AngleSpring } from '../math/springs';
import { FlybyShot, IncomingShot } from '../shots/fixed';
import { LandmarkShot } from '../shots/landmark';
import { OrbitShot } from '../shots/orbit';
import { PerchCameraRig, type PerchCameraStyle } from './perch-rig';
import { ShoulderShot } from '../shots/shoulder';
import type { Shot, ShotEnv, ShotKind } from '../shots/shot';
import { EstablishingShot, LowTrackingShot, SideTrackingShot } from '../shots/tracking';
import type { CameraController, CameraFrame, CameraPose } from '../types';

const BASE_WEIGHTS: Record<ShotKind, number> = {
  flyby: 3,
  incoming: 2,
  low: 2,
  side: 2,
  establishing: 1.5,
  orbit: 1.5,
  landmark: 3.5,
  shoulder: 1.5,
};

/** Seconds of sim time between line-of-sight checks, and how long the view may stay blocked before cutting. */
const LOS_INTERVAL = 0.25;
const LOS_TOLERANCE = 0.6;
const MAX_ATTEMPTS = 8;

const _subject = new THREE.Vector3();

/**
 * Automatic "director": picks a new well-composed shot every 6-10 s (hard cuts, like an edited film),
 * validates every setup against terrain/buildings and cuts early when the dragon gets occluded or leaves the shot.
 */
export class CinematicController implements CameraController {
  readonly mode: CameraMode = 'cinematic';

  private readonly orbitShot = new OrbitShot();
  private readonly shots: Record<ShotKind, Shot> = {
    flyby: new FlybyShot(),
    incoming: new IncomingShot(),
    low: new LowTrackingShot(),
    side: new SideTrackingShot(),
    establishing: new EstablishingShot(),
    orbit: this.orbitShot,
    landmark: new LandmarkShot(),
    shoulder: new ShoulderShot(),
  };
  private readonly kinds = Object.keys(BASE_WEIGHTS) as ShotKind[];
  private readonly tried = new Set<ShotKind>();
  private current: Shot | null = null;
  private previousKind: ShotKind | null = null;
  private readonly rng = createRng(0x0d2a90);
  private readonly heading = new AngleSpring();
  private readonly env: ShotEnv;
  private losTimer = 0;
  private blockedTime = 0;
  private cuts = 0;
  /** Perched on a viewpoint (phase 03): the perch camera replaces the director while the dragon sits there. */
  private readonly perchRig = new PerchCameraRig();
  private perchActive = false;
  private readonly perchAnchor = new THREE.Vector3();

  constructor() {
    this.env = {
      frame: null as unknown as CameraFrame,
      rng: this.rng,
      geo: null,
      headingYaw: 0,
      headingFwd: new THREE.Vector3(0, 0, -1),
      headingRight: new THREE.Vector3(1, 0, 0),
      aspect: 16 / 9,
    };
  }

  /** Current shot label/kind (debugging, UI). */
  get shotKind(): ShotKind | null {
    return this.perchActive ? null : (this.current?.kind ?? null);
  }

  /** No caption while perched: the viewing mode's own hint line names the camera. */
  get shotLabel(): string {
    return this.perchActive ? '' : (this.current?.label ?? '');
  }

  /** Style of the perch camera (orbit / fixed); switching restarts it around the dragon. */
  get perchStyle(): PerchCameraStyle {
    return this.perchRig.style;
  }

  set perchStyle(style: PerchCameraStyle) {
    this.perchRig.style = style;
  }

  /** The dragon sits on a perch: the perch camera frames it (true while it drives the view). */
  get perching(): boolean {
    return this.perchActive;
  }

  get cutCount(): number {
    return this.cuts;
  }

  enter(frame: CameraFrame, current: CameraPose): void {
    this.heading.reset(frame.target.travelYaw);
    this.refreshEnv(frame);
    // Start with an orbit continuing from the current viewpoint so the mode change reads as one camera move.
    // From the rider's eyes (POV) there is no orbit to continue: start a fresh one behind the dragon instead.
    const t = frame.target;
    const orbit = this.orbitShot;
    const fromRider = current.position.distanceTo(t.position) < Math.max(8, t.size * 0.4);
    orbit.begin(this.env, fromRider ? null : current, fromRider);
    this.activate(orbit);
  }

  reset(frame: CameraFrame): void {
    this.heading.reset(frame.target.travelYaw);
    this.refreshEnv(frame);
    this.cut();
  }

  /** Forces a cut to a specific shot kind if it can be set up (debug / sandbox). */
  requestShot(frame: CameraFrame, kind: ShotKind): boolean {
    this.refreshEnv(frame);
    const shot = this.shots[kind];
    if (shot.begin(this.env, null)) {
      this.activate(shot);
      return true;
    }
    return false;
  }

  update(frame: CameraFrame, out: CameraPose): void {
    this.refreshEnv(frame);
    if (this.updatePerch(frame, out)) {
      return;
    }
    if (!this.current) {
      this.cut();
    }
    let shot = this.current!;
    shot.elapsed += frame.dt;
    if (shot.elapsed >= shot.duration || shot.wantsCut) {
      this.cut();
      shot = this.current!;
    }
    shot.update(this.env, out);

    // Occlusion watchdog.
    if (shot.kind !== 'shoulder' && frame.dt > 0) {
      this.losTimer += frame.dt;
      if (this.losTimer >= LOS_INTERVAL) {
        this.losTimer = 0;
        const t = frame.target;
        _subject.copy(t.position).addScaledVector(WORLD_UP, t.riderHeight * 0.4);
        if (frame.collision.lineOfSight(out.position, _subject, Math.max(4, t.size * 0.3))) {
          this.blockedTime = 0;
        } else {
          this.blockedTime += LOS_INTERVAL;
          if (this.blockedTime >= LOS_TOLERANCE) {
            this.cut();
            this.current!.update(this.env, out);
          }
        }
      }
    }
  }

  /**
   * Perch viewing (phase 03): while the dragon is perched the perch camera frames the perch's view; when it leaves,
   * the director cuts back in with a fresh shot. Returns true when the perch camera wrote the pose.
   */
  private updatePerch(frame: CameraFrame, out: CameraPose): boolean {
    const perch = frame.target.dragon?.perch;
    const point = perch && perch.phase === 'perched' ? perch.point : null;
    if (!point) {
      if (this.perchActive) {
        this.perchActive = false;
        this.cut();
      }
      return false;
    }
    const t = frame.target;
    this.perchAnchor.copy(t.position);
    const yaw = -point.headingDeg * (Math.PI / 180);
    if (!this.perchActive) {
      this.perchActive = true;
      this.perchRig.begin(this.perchAnchor, yaw, t.size, frame.collision, null);
    }
    this.perchRig.update(frame.camDt, this.perchAnchor, yaw, frame.collision, frame.lookActive ? frame.lookYaw : 0, frame.lookActive ? frame.lookPitch : 0, out);
    return true;
  }

  /** Restarts the perch camera (a style change). */
  restartPerch(frame: CameraFrame): void {
    this.perchActive = false;
    this.refreshEnv(frame);
  }

  private refreshEnv(frame: CameraFrame): void {
    const env = this.env;
    const t = frame.target;
    env.frame = frame;
    env.geo = frame.ctx.services.tryGet('geo') ?? null;
    env.aspect = frame.ctx.camera.aspect;
    env.headingYaw = this.heading.update(t.travelYaw, 1.4 * t.horizontalness, frame.dt);
    const yaw = env.headingYaw;
    env.headingFwd.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    env.headingRight.set(Math.cos(yaw), 0, -Math.sin(yaw));
  }

  private cut(): void {
    const t = this.env.frame.target;
    this.tried.clear();
    if (this.current) {
      this.tried.add(this.current.kind);
    }
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const kind = this.pickKind(t.speed);
      if (!kind) {
        break;
      }
      this.tried.add(kind);
      const shot = this.shots[kind];
      if (shot.begin(this.env, null)) {
        this.activate(shot);
        return;
      }
    }
    // Orbit always succeeds (it shortens its boom against obstacles).
    const orbit = this.shots.orbit;
    orbit.begin(this.env, null);
    this.activate(orbit);
  }

  private activate(shot: Shot): void {
    this.previousKind = this.current?.kind ?? null;
    this.current = shot;
    this.losTimer = 0;
    this.blockedTime = 0;
    this.cuts++;
  }

  private pickKind(speed: number): ShotKind | null {
    let total = 0;
    for (const kind of this.kinds) {
      total += this.weight(kind, speed);
    }
    if (total <= 0) {
      return null;
    }
    let r = this.rng() * total;
    for (const kind of this.kinds) {
      const w = this.weight(kind, speed);
      if (w <= 0) {
        continue;
      }
      r -= w;
      if (r <= 0) {
        return kind;
      }
    }
    return null;
  }

  private weight(kind: ShotKind, speed: number): number {
    if (this.tried.has(kind) || kind === this.previousKind) {
      return 0;
    }
    let w = BASE_WEIGHTS[kind];
    if (speed < 12 && (kind === 'flyby' || kind === 'incoming')) {
      w = 0;
    }
    if (speed < 8 && kind === 'orbit') {
      w *= 2;
    }
    return w;
  }
}
