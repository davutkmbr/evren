import * as THREE from 'three';
import type { CameraMode, DragonRig, EngineContext, System } from '../core/contracts';
import { UpdateOrder } from '../core/contracts';
import { ModeBlend } from './blend';
import { clamp, smoothstep } from './math/scalar';
import { ChaseController } from './modes/chase';
import { CinematicController } from './modes/cinematic';
import { FreeController } from './modes/free';
import { PovController } from './modes/pov';
import { CameraCollision } from './obstruction';
import { CameraRigService, type CameraDebugInfo, type CameraRigHost } from './rig-service';
import { CameraShake } from './shake';
import { CAMERA_FEEL, cameraFeel } from './feel';
import type { ShotKind } from './shots/shot';
import { DragonTracker } from './tracker';
import { copyPose, createPose, type CameraController, type CameraFrame } from './types';

const CAMERA_FAR = 60000;
const MODE_CYCLE: readonly CameraMode[] = ['third', 'pov', 'cinematic'];
const VALID_MODES: readonly CameraMode[] = ['third', 'pov', 'cinematic', 'free'];
const MOUSE_RADIANS_PER_PIXEL = 0.0023;
/** The rider's head/hood is hidden once a POV transition brings the eye this close to it (m). */
const FIRST_PERSON_HIDE_DISTANCE = 1.6;
/**
 * Wheel zoom uses the raw pixel delta (core input only reports its sign): a mouse notch is ~100 px, a trackpad
 * swipe streams many small deltas, so zoom follows finger travel instead of the event count.
 */
const WHEEL_PIXELS_PER_NOTCH = 100;
const WHEEL_LINE_PIXELS = 33;
const WHEEL_MAX_PER_FRAME = 3;
/** Wheel input beyond this backlog is dropped (a free-spinning wheel would otherwise keep zooming for seconds). */
const WHEEL_BACKLOG_PIXELS = 4000;

type MutableFrame = { -readonly [K in keyof CameraFrame]: CameraFrame[K] };

const _shakeOffset = new THREE.Vector3();
const _shakeEuler = new THREE.Euler();
const _shakeQ = new THREE.Quaternion();

/**
 * Owns the render camera. Runs after flight physics and rig animation (UpdateOrder.Camera) and reads the
 * dragon's interpolated world transform, so the view never jitters against the model. Mode changes blend
 * (~0.4 s) from a dragon-relative snapshot of the previous view; teleports snap.
 */
export class CameraSystem implements System, CameraRigHost {
  readonly name = 'camera';
  readonly order = UpdateOrder.Camera;

  private ctx: EngineContext | null = null;
  private readonly tracker = new DragonTracker();
  private readonly collision = new CameraCollision();
  private readonly shaker = new CameraShake();
  private readonly chase = new ChaseController();
  private readonly pov = new PovController();
  private readonly cinematic = new CinematicController();
  private readonly free = new FreeController();
  private readonly controllers: Record<CameraMode, CameraController> = {
    third: this.chase,
    pov: this.pov,
    cinematic: this.cinematic,
    free: this.free,
  };
  private readonly service = new CameraRigService(this);

  /** Mode requested by the player/UI. */
  private requested: CameraMode = 'third';
  /** Mode whose controller currently drives the camera. */
  private active: CameraMode = 'third';
  private started = false;
  private snapPending = true;

  private readonly pose = createPose();
  private readonly finalPose = createPose();
  private readonly lastPose = createPose();

  private readonly blend = new ModeBlend();
  private wheelPixels = 0;
  private readonly onWheel = (e: WheelEvent): void => {
    const unit = e.deltaMode === 1 ? WHEEL_LINE_PIXELS : e.deltaMode === 2 ? WHEEL_PIXELS_PER_NOTCH * 3 : 1;
    this.wheelPixels += e.deltaY * unit;
  };

  private firstPersonApplied = false;
  private firstPersonRig: DragonRig | null = null;
  private readonly frame: MutableFrame;
  private readonly unsubscribe: Array<() => void> = [];

  constructor() {
    this.frame = {
      ctx: null as unknown as EngineContext,
      dt: 0,
      camDt: 0,
      paused: false,
      target: this.tracker,
      collision: this.collision,
      lookYaw: 0,
      lookPitch: 0,
      lookActive: false,
      lookHeld: false,
      wheel: 0,
    };
  }

  /* ---------------- CameraRigHost ---------------- */

  get currentMode(): CameraMode {
    return this.requested;
  }

  get currentShotLabel(): string {
    return this.active === 'cinematic' ? this.cinematic.shotLabel : '';
  }

  get currentFov(): number {
    return this.ctx ? this.ctx.camera.fov : this.finalPose.fov;
  }

  placeFree(x: number, y: number, z: number, headingDeg: number, pitchDeg: number, fovDeg?: number): void {
    this.free.place(x, y, z, headingDeg, pitchDeg, fovDeg);
    this.requestMode('free');
    this.snapPending = true;
  }

  requestMode(mode: CameraMode): void {
    if (!VALID_MODES.includes(mode) || mode === this.requested) {
      return;
    }
    this.requested = mode;
    this.ctx?.events.emit('camera-mode', { mode });
  }

  addShake(amount: number): void {
    this.shaker.add(amount);
  }

  get debugInfo(): CameraDebugInfo {
    const cam = this.ctx?.camera;
    return {
      mode: this.active,
      blending: this.blend.active,
      shot: this.active === 'cinematic' ? (this.cinematic.shotKind ?? '') : '',
      shotLabel: this.currentShotLabel,
      cuts: this.cinematic.cutCount,
      zoom: this.chase.zoomDistance,
      orbitYawDeg: this.chase.orbitYawDeg,
      fov: cam?.fov ?? 0,
      near: cam?.near ?? 0,
      distanceToDragon: cam && this.tracker.available ? cam.position.distanceTo(this.tracker.position) : -1,
      speedEffect: this.finalPose.speedEffect,
    };
  }

  /** Sandbox/debug: jump straight to a cinematic shot type. */
  debugForceShot(kind: ShotKind): boolean {
    if (!this.ctx || !this.tracker.available) {
      return false;
    }
    if (this.active !== 'cinematic') {
      this.requestMode('cinematic');
      this.snapPending = true;
      this.update(0, this.ctx);
    }
    return this.cinematic.requestShot(this.frame, kind);
  }

  /** Sandbox/debug: set the chase zoom distance (m). */
  debugSetZoom(distance: number): void {
    this.chase.setZoom(distance);
  }

  /* ---------------- System ---------------- */

  init(ctx: EngineContext): void {
    this.ctx = ctx;
    this.frame.ctx = ctx;
    const cam = ctx.camera;
    cam.far = CAMERA_FAR;
    cam.near = 0.25;
    cam.updateProjectionMatrix();
    this.lastPose.position.copy(cam.position);
    this.lastPose.quaternion.copy(cam.quaternion);
    this.lastPose.fov = cam.fov;
    this.lastPose.near = cam.near;

    const initial = ctx.debug.cam;
    if (initial && VALID_MODES.includes(initial)) {
      this.requested = initial;
      this.active = initial;
    }
    ctx.services.provide('cameraRig', this.service);
    ctx.canvas.addEventListener('wheel', this.onWheel, { passive: true });
    this.unsubscribe.push(
      () => ctx.canvas.removeEventListener('wheel', this.onWheel),
    );

    this.unsubscribe.push(
      ctx.events.on('teleport', () => {
        this.snapPending = true;
      }),
      // Impacts, landings and roars call shake() from the flight module; splashes only shake when close to the eye.
      ctx.events.on('splash', ({ position, strength }) => {
        const d = ctx.camera.position.distanceTo(position);
        this.shaker.add(clamp(strength, 0, 3) * 0.15 * clamp(1 - d / 120, 0, 1));
      }),
      ctx.events.on('fire-start', () => {
        this.shaker.addRumble(0.05);
      }),
    );
  }

  update(dt: number, ctx: EngineContext): void {
    const paused = ctx.time.paused;
    const frame = this.frame;
    frame.dt = dt;
    frame.camDt = paused ? Math.min(ctx.time.realDt, 0.05) : dt;
    frame.paused = paused;
    this.collision.bind(ctx);
    this.tracker.update(ctx, dt);
    this.readInput(ctx);
    if (this.tracker.jumped) {
      this.snapPending = true;
    }
    if (this.requested !== 'free' && !this.tracker.available) {
      return;
    }

    if (!this.started) {
      this.active = this.requested;
      const controller = this.controllers[this.active];
      if (this.active === 'free') {
        controller.enter(frame, this.lastPose);
      } else {
        controller.reset(frame);
      }
      this.started = true;
      this.snapPending = false;
    } else if (this.active !== this.requested) {
      this.switchTo(this.requested);
    }
    // Under water (phase 21 stage 4) every camera may follow the dragon below the surface; afterwards the allowance
    // shrinks from the eye's own depth so the camera comes out smoothly.
    this.collision.updateSubmerge(this.tracker.mode === 'underwater', this.lastPose.position, frame.dt);
    if (this.snapPending) {
      this.snapPending = false;
      this.blend.cancel();
      this.shaker.reset();
      if (this.tracker.mode !== 'underwater') {
        this.collision.submerge = 0;
      }
      this.controllers[this.active].reset(frame);
    }

    this.controllers[this.active].update(frame, this.pose);
    copyPose(this.finalPose, this.pose);
    this.blend.apply(this.pose, this.finalPose, this.tracker, this.collision, frame.camDt);
    copyPose(this.lastPose, this.finalPose);
    this.applyShake(ctx);
    this.writeCamera(ctx);
    this.applyFirstPerson();
    ctx.pipeline.speedEffect = clamp(this.finalPose.speedEffect, 0, 1);
  }

  pending(): number {
    return 0;
  }

  dispose(): void {
    for (const off of this.unsubscribe) {
      off();
    }
    this.unsubscribe.length = 0;
    if (this.firstPersonRig && this.firstPersonApplied) {
      this.firstPersonRig.setFirstPerson(false);
    }
  }

  /* ---------------- internals ---------------- */

  private readInput(ctx: EngineContext): void {
    const input = ctx.input;
    const frame = this.frame;
    const lookActive = input.enabled && (input.isHeld('look') || input.pointerLocked);
    const sens = MOUSE_RADIANS_PER_PIXEL * input.settings.mouseSensitivity;
    const invertY = input.settings.invertMouseY ? -1 : 1;
    frame.lookActive = lookActive;
    frame.lookHeld = input.enabled && input.isHeld('look');
    frame.lookYaw = lookActive ? -input.mouseDelta.x * sens : 0;
    frame.lookPitch = lookActive ? -input.mouseDelta.y * sens * invertY : 0;
    // Rate-limited, but a burst larger than the per-frame limit carries over to the next frames instead of being lost.
    const notches = input.enabled ? clamp(this.wheelPixels / WHEEL_PIXELS_PER_NOTCH, -WHEEL_MAX_PER_FRAME, WHEEL_MAX_PER_FRAME) : 0;
    this.wheelPixels = input.enabled ? clamp(this.wheelPixels - notches * WHEEL_PIXELS_PER_NOTCH, -WHEEL_BACKLOG_PIXELS, WHEEL_BACKLOG_PIXELS) : 0;
    frame.wheel = notches;
    if (input.enabled && input.wasPressed('camera') && this.requested !== 'free') {
      if (this.tracker.dragon?.perch?.phase === 'perched') {
        this.cyclePerchCamera();
      } else {
        const i = MODE_CYCLE.indexOf(this.requested);
        this.requestMode(MODE_CYCLE[(i + 1) % MODE_CYCLE.length]);
      }
    }
  }

  /**
   * Perched on a viewpoint (phase 03), C cycles the viewing cameras: the slow orbit, the still framing (both the
   * cinematic mode's perch camera) and the rider's eyes.
   */
  private cyclePerchCamera(): void {
    const cin = this.cinematic;
    if (this.requested === 'cinematic' && cin.perchStyle === 'orbit') {
      cin.perchStyle = 'fixed';
      cin.restartPerch(this.frame);
    } else if (this.requested === 'cinematic') {
      this.requestMode('pov');
    } else {
      cin.perchStyle = 'orbit';
      cin.restartPerch(this.frame);
      this.requestMode('cinematic');
    }
  }

  /** Perch camera style the viewing mode names in its hints ('rider' when looking through the rider's eyes). */
  get perchCamera(): 'orbit' | 'fixed' | 'rider' | 'other' {
    if (this.requested === 'pov') {
      return 'rider';
    }
    return this.requested === 'cinematic' ? this.cinematic.perchStyle : 'other';
  }

  private switchTo(next: CameraMode): void {
    const frame = this.frame;
    const prev = this.active;
    this.controllers[prev].exit?.(frame);
    this.controllers[next].enter(frame, this.lastPose);
    this.active = next;
    if (this.snapPending) {
      this.blend.cancel();
    } else {
      this.blend.begin(this.lastPose, prev, next, this.tracker);
    }
  }

  private applyShake(ctx: EngineContext): void {
    const shaker = this.shaker;
    const t = this.tracker;
    const env = ctx.services.tryGet('env');
    const speed = t.available ? t.speed : 0;
    // Buffeting grows with speed; a falling dragon's folded wings and loose gear flutter (kept subtle for POV).
    // Perceived speed (camera/feel.ts): a light rumble at race speeds and on a chain burst, scaled by the speed feel.
    const feel = cameraFeel(t);
    shaker.buffet =
      0.05 * smoothstep(55, 125, speed) +
      (t.available ? 0.035 * t.weightless * smoothstep(12, 50, speed) : 0) +
      feel.feel * (CAMERA_FEEL.buffet * feel.speed + CAMERA_FEEL.burstBuffet * feel.burst);
    shaker.turbulence = env ? 0.02 * clamp(env.wind.length() / 8, 0, 2) * smoothstep(5, 40, speed) : 0;
    shaker.firing = t.dragon?.firing ? 0.035 : 0;
    if (ctx.time.paused) {
      return;
    }
    shaker.update(this.frame.dt);
    const pose = this.finalPose;
    if (shaker.active <= 0 || (pose.shakeTranslation <= 0 && pose.shakeRotation <= 0)) {
      return;
    }
    _shakeOffset.copy(shaker.offset).multiplyScalar(pose.shakeTranslation).applyQuaternion(pose.quaternion);
    pose.position.add(_shakeOffset);
    const r = pose.shakeRotation;
    _shakeEuler.set(shaker.rotation.x * r, shaker.rotation.y * r, shaker.rotation.z * r, 'YXZ');
    pose.quaternion.multiply(_shakeQ.setFromEuler(_shakeEuler));
    const nearRider = this.active === 'pov' || (this.blend.active && this.blend.kind !== 'orbit');
    if (!nearRider && this.active !== 'free' && _shakeOffset.lengthSq() > 1e-6) {
      this.collision.resolve(pose.position, 0.5);
    }
  }

  private writeCamera(ctx: EngineContext): void {
    const cam = ctx.camera;
    const pose = this.finalPose;
    cam.position.copy(pose.position);
    cam.quaternion.copy(pose.quaternion);
    if (Math.abs(cam.fov - pose.fov) > 1e-4 || Math.abs(cam.near - pose.near) > 1e-6 || cam.far !== CAMERA_FAR) {
      cam.fov = pose.fov;
      cam.near = pose.near;
      cam.far = CAMERA_FAR;
      cam.updateProjectionMatrix();
    }
  }

  private applyFirstPerson(): void {
    // Settled POV always hides the rider's head; otherwise (swoops, free/photo camera) it hides whenever the
    // eye is close enough to end up inside the hood.
    const settledPov = this.active === 'pov' && !this.blend.active;
    const want = settledPov || this.finalPose.position.distanceTo(this.tracker.headPosition) < FIRST_PERSON_HIDE_DISTANCE;
    const rig = this.tracker.rig;
    if (!rig) {
      return;
    }
    if (rig !== this.firstPersonRig) {
      this.firstPersonRig = rig;
      this.firstPersonApplied = !want;
    }
    if (want !== this.firstPersonApplied) {
      rig.setFirstPerson(want);
      this.firstPersonApplied = want;
    }
  }
}
