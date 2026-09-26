import * as THREE from 'three';
import type { DragonBondState, DragonMood, EngineContext, VesselPose } from '../../../../core/contracts';
import type { DragonRigImpl } from '../../rig';
import { bankAngle, type RiderBehavior } from '../rider-behavior';
import { bondPose } from './apply';
import { BondCore } from './core';
import { MOOD_LINES } from './mood';
import { BOND, createInputs, estimateAirTemp, type AttentionCandidate, type BondInputs } from './types';

const DEG = Math.PI / 180;
/** Maneuvers the dragon glances back after ("did you like that?"); they also excite it a little. */
const GLANCE_AFTER = new Set(['catch', 'roll', 'loop', 'wingover', 'immelmann', 'splits']);
/** How often (s) the obstacle ray, the bird query and the ferry scan run. */
const OBSTACLE_EVERY = 0.2;
const BIRD_EVERY = 0.25;
const FERRY_EVERY = 1;
/** An attention hint from an event stays a candidate this long (s). */
const HINT_LIFE = 1.2;
/** POV: the view counts as "on the neck" inside this cone below the flight path (body frame, rad). */
const NECK_VIEW = { pitchMin: -72 * DEG, pitchMax: -16 * DEG, yaw: 48 * DEG };
/** Rumble pulse length (ms) and how often it is refreshed (s). */
const RUMBLE_MS = 140;
const RUMBLE_EVERY = 0.12;

const _v = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _invQ = new THREE.Quaternion();
const _bird = new THREE.Vector3();

interface Hint {
  candidate: AttentionCandidate;
  x: number;
  y: number;
  z: number;
  age: number;
}

/**
 * Engine wiring of the bond (phase 06): gathers the dragon's situation (flight state, camera, rider, time, weather,
 * birds, ferries, discoveries, attention hints), runs the pure BondCore, and applies its offsets on top of the flight
 * pose (after the rider behaviour, before the rig), plays its sounds, emits its puffs and captions, rumbles the pad.
 * Provides the 'bond' service (mood for the pause menu, nostril steam for fx).
 */
export class BondBehavior implements DragonBondState {
  readonly core = new BondCore();
  private readonly inp: BondInputs = createInputs();
  private readonly attention: AttentionCandidate[] = [];
  private readonly hints: Hint[] = [];
  private readonly vessels: VesselPose[] = [];
  private readonly unsubscribe: Array<() => void> = [];
  private obstacleIn = 0;
  private obstacleTime = Infinity;
  private birdIn = 0;
  private bird: { x: number; y: number; z: number; d: number } | null = null;
  private ferryIn = 0;
  private ferry: VesselPose | null = null;
  private rumbleIn = 0;
  private racing = false;
  private pendingDiscovery: string | null = null;
  private pendingGlance = false;
  private pendingTrick = false;

  constructor(
    private readonly rig: DragonRigImpl,
    private readonly rider: RiderBehavior,
    ctx: EngineContext,
  ) {
    const ev = ctx.events;
    this.unsubscribe.push(
      ev.on('maneuver', ({ id }) => {
        if (GLANCE_AFTER.has(id)) {
          this.pendingGlance = true;
          this.pendingTrick = true;
        }
      }),
      ev.on('landmark-discovered', ({ id }) => {
        this.pendingDiscovery = id;
      }),
      ev.on('activity', ({ state }) => {
        this.racing = state === 'started' || state === 'checkpoint';
      }),
      ev.on('dragon-attention', ({ x, y, z, kind, strength }) => {
        if (!Number.isFinite(x + y + z)) {
          return;
        }
        const key = kind === 'bird' ? 'moment-bird' : `${kind}:${Math.round(x / 200)}:${Math.round(z / 200)}`;
        const existing = this.hints.find((h) => h.candidate.key === key);
        const hint = existing ?? { candidate: { kind, key, yaw: 0, pitch: 0, distance: 0, strength }, x, y, z, age: 0 };
        hint.x = x;
        hint.y = y;
        hint.z = z;
        hint.age = 0;
        hint.candidate.strength = strength;
        if (!existing) {
          this.hints.push(hint);
        }
      }),
    );
    rider.gazeLevel = () => this.core.gaze.level;
    ctx.services.provide('bond', this);
    if (import.meta.env.DEV || ctx.sandbox) {
      // Feel testing: window.__bondDebug.behave('yawn', 'flame'), .mood('tired'), .state().
      const handle = {
        behave: (id: string, variant?: string): boolean => this.core.behaviors.force(id, variant),
        mood: (m: DragonMood): void => {
          this.core.mood.mood = m;
        },
        kick: (drive: 'fatigue' | 'affection' | 'curiosity' | 'excitement' | 'playfulness', amount: number): void => this.core.mood.kick(drive, amount),
        state: () => ({
          mood: this.core.out.mood,
          drives: { ...this.core.mood.drives },
          flightTime: this.core.mood.flightTime,
          gaze: this.core.gaze.level,
          behavior: this.core.out.behavior,
          safety: { ...this.core.safety.state },
          obstacleTime: this.obstacleTime,
          airTempC: this.inp.airTempC,
          steam: this.core.out.nostrilSteam,
          log: this.core.behaviors.log.slice(-10),
        }),
      };
      (window as unknown as { __bondDebug?: typeof handle }).__bondDebug = handle;
      this.unsubscribe.push(() => {
        const w = window as unknown as { __bondDebug?: typeof handle };
        if (w.__bondDebug === handle) {
          delete w.__bondDebug;
        }
      });
    }
  }

  get mood(): DragonMood {
    return this.core.out.mood;
  }

  get moodLevel(): number {
    return this.core.out.moodLevel;
  }

  get moodLine(): string {
    return MOOD_LINES[this.core.out.mood];
  }

  get nostrilSteam(): number {
    return this.core.out.nostrilSteam;
  }

  get exhale(): number {
    return this.core.out.exhale;
  }

  get behavior(): string | null {
    return this.core.out.behavior;
  }

  update(dt: number, ctx: EngineContext): void {
    if (!(dt > 0)) {
      this.apply(ctx, false);
      return;
    }
    this.gather(dt, ctx);
    this.core.update(this.inp);
    this.apply(ctx, true);
    this.inp.encourage = false;
    this.inp.discovery = null;
    this.inp.maneuverGlance = false;
    this.inp.trickDone = false;
  }

  dispose(): void {
    this.unsubscribe.forEach((u) => u());
  }

  private gather(dt: number, ctx: EngineContext): void {
    const inp = this.inp;
    const state = ctx.services.tryGet('dragon');
    const pose = this.rig.getPose();
    inp.dt = dt;
    if (state) {
      inp.mode = state.mode;
      inp.airspeed = state.airspeed;
      inp.groundSpeed = Math.hypot(state.velocity.x, state.velocity.z);
      inp.agl = state.agl;
      inp.stamina = state.stamina;
      inp.flapEffort = state.flapEffort;
      inp.flow = state.flow ?? 0;
      inp.firing = state.firing;
      const phase = state.perch?.phase ?? 'free';
      inp.perched = phase === 'perched';
      inp.perchBusy = phase === 'approach' || phase === 'leaving';
      const bank = Math.abs(bankAngle(state));
      const g = state.gForce;
      inp.maneuvering = (pose.riderTuck ?? 0) > 0.2 || bank > 35 * DEG || g > 1.6 || g < 0.4;
    }
    inp.racing = this.racing || (ctx.services.tryGet('hudZones')?.hasContext?.('race') ?? false);
    this.updateObstacle(dt, ctx);
    inp.obstacleTime = this.obstacleTime;

    // POV: is the rider's view resting on the neck?
    const cam = ctx.services.tryGet('cameraRig');
    inp.pov = cam ? cam.mode === 'pov' || (inp.perched && cam.perchCamera === 'rider') : false;
    inp.povLookAtNeck = false;
    if (inp.pov && state) {
      _dir.set(0, 0, -1).applyQuaternion(ctx.camera.quaternion);
      _invQ.copy(state.quaternion).invert();
      _dir.applyQuaternion(_invQ);
      const yaw = Math.atan2(-_dir.x, -_dir.z);
      const pitch = Math.asin(THREE.MathUtils.clamp(_dir.y, -1, 1));
      inp.povLookAtNeck = pitch > NECK_VIEW.pitchMin && pitch < NECK_VIEW.pitchMax && Math.abs(yaw) < NECK_VIEW.yaw;
      inp.povLookSide = yaw >= 0 ? 1 : -1;
    }

    inp.petting = this.rider.petAmount;
    inp.petActive = this.rider.isPetting;
    inp.riderStanding = this.rider.standing;
    if (ctx.input.wasPressed('encourage') && this.rider.canPat && (pose.riderTuck ?? 0) < 0.2 && inp.mode !== 'underwater') {
      inp.encourage = true;
    }

    // Time, light and weather.
    const env = ctx.services.tryGet('env');
    const weather = ctx.services.tryGet('weather')?.current;
    inp.hours = ctx.time.timeOfDay;
    inp.dayOfYear = ctx.time.dayOfYear;
    inp.nightFactor = env?.nightFactor ?? 0;
    const rain = weather?.rain ?? 0;
    const storm = weather?.storm ?? 0;
    const fog = weather?.fog ?? 0;
    inp.rain = rain;
    inp.humidity = Math.max(env?.humidity ?? 0.6, 0.6 + 0.4 * fog, 0.7 + 0.3 * rain);
    inp.light = (1 - inp.nightFactor) * (1 - 0.3 * fog) * (1 - 0.3 * rain) * (1 - 0.3 * storm) * (inp.mode === 'underwater' ? 0.4 : 1);
    inp.airTempC = estimateAirTemp(inp.dayOfYear, inp.hours, state ? state.altitude : 0, rain, storm);

    // Attention: discoveries, event hints, the closest bird, a passing ferry.
    this.attention.length = 0;
    if (state) {
      if (this.pendingDiscovery) {
        const l = ctx.services.tryGet('geo')?.landmark(this.pendingDiscovery);
        if (l) {
          inp.discovery = this.toCandidate(state, 'landmark', l.id, l.x, l.y + 25, l.z, 1, {} as AttentionCandidate);
        }
        this.pendingDiscovery = null;
      }
      for (let i = this.hints.length - 1; i >= 0; i--) {
        const h = this.hints[i];
        h.age += dt;
        if (h.age > HINT_LIFE) {
          this.hints.splice(i, 1);
          continue;
        }
        this.attention.push(this.toCandidate(state, h.candidate.kind, h.candidate.key, h.x, h.y, h.z, h.candidate.strength, h.candidate));
      }
      this.updateBird(dt, ctx, state.position);
      if (this.bird) {
        this.attention.push(this.toCandidate(state, 'bird', 'bird', this.bird.x, this.bird.y, this.bird.z, 0.6, this.birdCandidate));
      }
      this.updateFerry(dt, ctx, state.position);
      if (this.ferry) {
        const f = this.ferry;
        this.attention.push(this.toCandidate(state, 'ferry', `ferry:${f.id}`, f.x, f.heave + f.airDraft * 0.5, f.z, 0.6, this.ferryCandidate));
      }
    }
    inp.attention = this.attention;
    inp.maneuverGlance = this.pendingGlance;
    inp.trickDone = this.pendingTrick;
    this.pendingGlance = false;
    this.pendingTrick = false;
  }

  private readonly birdCandidate = {} as AttentionCandidate;
  private readonly ferryCandidate = {} as AttentionCandidate;

  /** World point → body-relative direction (yaw > 0 left, pitch > 0 up) and distance, into `out`. */
  private toCandidate(
    state: { position: THREE.Vector3; quaternion: THREE.Quaternion },
    kind: AttentionCandidate['kind'],
    key: string,
    x: number,
    y: number,
    z: number,
    strength: number,
    out: AttentionCandidate,
  ): AttentionCandidate {
    _v.set(x - state.position.x, y - state.position.y, z - state.position.z);
    const distance = _v.length();
    _invQ.copy(state.quaternion).invert();
    _v.applyQuaternion(_invQ);
    out.kind = kind;
    out.key = key;
    out.distance = distance;
    out.strength = strength;
    out.yaw = Math.atan2(-_v.x, -_v.z);
    out.pitch = distance > 1e-3 ? Math.asin(THREE.MathUtils.clamp(_v.y / distance, -1, 1)) : 0;
    return out;
  }

  /** Seconds to the first obstacle along the velocity (terrain, buildings, structures; the sea surface does not count). */
  private updateObstacle(dt: number, ctx: EngineContext): void {
    this.obstacleIn -= dt;
    if (this.obstacleIn > 0) {
      return;
    }
    this.obstacleIn = OBSTACLE_EVERY;
    const state = ctx.services.tryGet('dragon');
    const collision = ctx.services.tryGet('collision');
    const speed = state ? state.velocity.length() : 0;
    if (!state || !collision || speed < 5 || state.mode === 'grounded' || state.mode === 'swimming') {
      this.obstacleTime = Infinity;
      return;
    }
    _dir.copy(state.velocity).divideScalar(speed);
    const reach = Math.min(speed * (BOND.gaze.obstacleRelease + 1), 500);
    const hit = collision.raycast(state.position, _dir, reach, false);
    this.obstacleTime = hit ? hit.distance / speed : Infinity;
  }

  private updateBird(dt: number, ctx: EngineContext, at: THREE.Vector3): void {
    this.birdIn -= dt;
    if (this.birdIn > 0) {
      return;
    }
    this.birdIn = BIRD_EVERY;
    const life = ctx.services.tryGet('life');
    const d = life?.nearestBird ? life.nearestBird(at.x, at.y, at.z, BOND.look.birdRange, _bird) : -1;
    this.bird = d >= 0 ? { x: _bird.x, y: _bird.y, z: _bird.z, d } : null;
  }

  private updateFerry(dt: number, ctx: EngineContext, at: THREE.Vector3): void {
    this.ferryIn -= dt;
    if (this.ferryIn > 0) {
      return;
    }
    this.ferryIn = FERRY_EVERY;
    const life = ctx.services.tryGet('life');
    this.ferry = null;
    if (!life) {
      return;
    }
    let best: number = BOND.look.ferryRange;
    for (const v of life.vessels(['vapur'], this.vessels)) {
      const d = Math.hypot(v.x - at.x, v.z - at.z);
      if (v.underway && d < best) {
        best = d;
        this.ferry = v;
      }
    }
  }

  /** Puts the core's offsets on the rig pose (every frame, also paused: the flight pose is re-sent each frame). */
  private apply(ctx: EngineContext, live: boolean): void {
    const o = this.core.out;
    const p = bondPose(this.rig.getPose(), o, this.inp.pov);
    this.rig.setPose(p);
    this.rig.setGazeSide(o.gazeSide);
    if (!live) {
      return;
    }
    const audio = ctx.services.tryGet('audio');
    for (const s of o.sounds) {
      if (s.cue === 'purr' || s.cue === 'flap') {
        audio?.play(s.cue, s.volume);
      } else {
        audio?.bondCue?.(s.cue, s.volume);
      }
    }
    for (const puff of o.puffs) {
      ctx.events.emit('dragon-puff', { kind: puff.kind, strength: puff.strength });
    }
    for (const label of o.captions) {
      ctx.events.emit('maneuver', { id: 'encourage', label });
    }
    this.rumbleIn -= ctx.time.dt;
    if (o.rumble > 0.01 && this.rumbleIn <= 0) {
      this.rumbleIn = RUMBLE_EVERY;
      ctx.input.rumble(o.rumble, RUMBLE_MS);
    }
  }
}
