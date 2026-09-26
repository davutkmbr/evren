import type { DragonMood } from '../../../../core/contracts';
import { approach, BOND, BondRng, clamp, type AttentionCandidate, type BondInputs } from './types';

/** What the dragon may do with its head this frame. */
export interface Safety {
  /** A race, a landing / take-off, a dive, a stall, a trick, fire, a perch approach: nothing self-driven at all. */
  critical: boolean;
  /** It may turn its head right round to look at the rider. */
  gazeOk: boolean;
  /** It may glance aside at the world (a landmark, a bird, a ferry). */
  lookOk: boolean;
  /** A self-driven behaviour may start or keep playing. */
  behaviorOk: boolean;
}

const AIRBORNE = new Set(['flying', 'gliding', 'hovering', 'diving', 'stalling', 'landing', 'takeoff']);
const CRITICAL_MODES = new Set(['landing', 'takeoff', 'diving', 'stalling', 'underwater']);

/**
 * "Never while it needs to watch the way": the dragon looks back at the rider only when nothing asks for its eyes —
 * not near the ground or an obstacle ahead, not fast, not in a trick, a race or a landing. The obstacle test has
 * hysteresis (blocked under BOND.gaze.obstacleBlock s to impact, clear again past obstacleRelease), and after any
 * unsafe moment a look back waits for BOND.gaze.calmHold s of calm.
 */
export class SafetyGate {
  private obstacleBlocked = false;
  private calm = 0;
  readonly state: Safety = { critical: true, gazeOk: false, lookOk: false, behaviorOk: false };

  evaluate(inp: BondInputs): Safety {
    const g = BOND.gaze;
    const l = BOND.look;
    const airborne = AIRBORNE.has(inp.mode);
    const critical = inp.racing || inp.perchBusy || inp.maneuvering || inp.firing || inp.hardLanding !== null || CRITICAL_MODES.has(inp.mode);
    if (inp.obstacleTime < g.obstacleBlock) {
      this.obstacleBlocked = true;
    } else if (inp.obstacleTime > g.obstacleRelease) {
      this.obstacleBlocked = false;
    }
    const nearGround = airborne && inp.agl < g.minAgl && inp.airspeed > g.hoverSpeed;
    const surface = inp.mode === 'grounded' || inp.mode === 'swimming';
    const surfaceFast = surface && inp.groundSpeed > g.surfaceSpeed;
    const fast = inp.airspeed > g.maxAirspeed && !surface;
    const safeNow = !critical && !this.obstacleBlocked && !nearGround && !surfaceFast && !fast;
    this.calm = safeNow ? this.calm + inp.dt : 0;
    const s = this.state;
    s.critical = critical;
    s.gazeOk = safeNow && (this.calm >= g.calmHold || inp.perched);
    s.lookOk =
      !critical &&
      inp.obstacleTime > l.obstacleBlock &&
      !(airborne && inp.agl < l.minAgl && inp.airspeed > g.hoverSpeed) &&
      (surface || inp.airspeed < l.maxAirspeed);
    s.behaviorOk = s.lookOk && !this.obstacleBlocked && !nearGround && (this.calm >= g.calmHold || inp.perched);
    return s;
  }
}

interface Glance {
  delay: number;
  duration: number;
  level: number;
  side: number;
  expires: number;
  age: number;
}

/** How often the dragon looks back on its own, by mood (multiplies the wait). */
const GLANCE_WAIT: Record<DragonMood, number> = { content: 1, curious: 1.1, playful: 0.7, tired: 1.6, excited: 0.8, embarrassed: 1.4 };

/**
 * Looking back at the rider (DragonPose.gazeRider): while petted, when the rider's POV rests on the neck for
 * BOND.gaze.povDwell s, after a trick or when the rider stands up, and now and then on its own while gliding, perched
 * or resting. Every trigger waits for the safety gate; unsafe drops the look quickly.
 */
export class GazeController {
  level = 0;
  side = 1;
  private glance: Glance | null = null;
  private idleIn: number;
  private povTime = 0;
  private povAway = 99;
  private povActive = false;
  private petTime = 0;
  private wasStanding = false;

  constructor(private readonly rng: BondRng) {
    this.idleIn = rng.range(BOND.gaze.glideEvery[0], BOND.gaze.glideEvery[1]);
  }

  /** Queues a look back (it waits up to `expires` s for calm). */
  queue(delay: number, duration: number, level: number, expires: number, side = 0): void {
    this.glance = { delay, duration, level, side: side || (this.rng.next() < 0.5 ? 1 : -1), expires, age: 0 };
  }

  get busy(): boolean {
    return this.level > 0.08 || (this.glance !== null && this.glance.delay <= 0);
  }

  update(inp: BondInputs, safety: Safety, mood: DragonMood): void {
    const g = BOND.gaze;
    const dt = inp.dt;
    // Petting: the hand is on the right side of the neck, the head comes round on the right.
    this.petTime = inp.petActive && inp.petting > 0.6 ? this.petTime + dt : 0;
    // POV: the rider looking at the neck for a while.
    if (inp.pov && inp.povLookAtNeck) {
      this.povTime += dt;
      this.povAway = 0;
    } else {
      this.povAway += dt;
      if (this.povAway > g.povRelease) {
        this.povTime = 0;
      }
    }
    this.povActive = this.povTime >= g.povDwell;
    if (inp.maneuverGlance) {
      this.queue(0.5, this.rng.range(1.6, 2.2), 0.9, 5);
    }
    if (inp.riderStanding && !this.wasStanding) {
      this.queue(0.3, this.rng.range(1.5, 2.5), 0.9, 3);
    }
    this.wasStanding = inp.riderStanding;

    let target = 0;
    let side = this.side;
    if (this.petTime > g.petDelay) {
      target = g.petLevel;
      side = -1;
    } else if (this.povActive) {
      target = g.povLevel;
      side = inp.povLookSide < 0 ? -1 : 1;
    } else {
      this.updateGlance(inp, safety, mood);
      if (this.glance && this.glance.delay <= 0) {
        target = this.glance.level;
        side = this.glance.side;
      }
    }
    if (!safety.gazeOk) {
      target = 0;
    }
    // The side only changes while the head is (nearly) forward.
    if (this.level < 0.05) {
      this.side = side;
    }
    const rate = !safety.gazeOk ? g.rateUnsafe : target > this.level ? g.rateUp : g.rateDown;
    this.level = approach(this.level, target, rate, dt);
    if (this.level < 0.002 && target === 0) {
      this.level = 0;
    }
  }

  private updateGlance(inp: BondInputs, safety: Safety, mood: DragonMood): void {
    const dt = inp.dt;
    const gl = this.glance;
    if (gl) {
      gl.age += dt;
      if (gl.delay > 0) {
        if (safety.gazeOk) {
          gl.delay -= dt;
        } else if (gl.age > gl.expires) {
          this.glance = null;
        }
        return;
      }
      gl.duration -= dt;
      if (gl.duration <= 0 || !safety.gazeOk) {
        this.glance = null;
      }
      return;
    }
    const g = BOND.gaze;
    const context = inp.perched ? 'perch' : inp.mode === 'gliding' ? 'glide' : inp.mode === 'grounded' || inp.mode === 'hovering' ? 'ground' : null;
    if (!context || !safety.gazeOk) {
      return;
    }
    this.idleIn -= dt;
    if (this.idleIn > 0) {
      return;
    }
    const every = context === 'perch' ? g.perchEvery : context === 'glide' ? g.glideEvery : g.groundEvery;
    const time = context === 'perch' ? g.perchGlanceTime : g.glanceTime;
    this.queue(0, this.rng.range(time[0], time[1]), 0.85, 1);
    this.idleIn = this.rng.range(every[0], every[1]) * GLANCE_WAIT[mood];
  }
}

interface LookState {
  kind: AttentionCandidate['kind'];
  key: string;
  time: number;
  duration: number;
  yaw: number;
  pitch: number;
}

const PRIORITY: Record<AttentionCandidate['kind'], number> = { landmark: 5, horn: 4, stork: 3, ferry: 2, bird: 2, sound: 1 };

/**
 * Glances at the world: at a landmark when its discovery card opens, toward a ferry horn, a stork kettle, a passing
 * ferry or a close flock. One target at a time (higher priority may interrupt), per-target cooldowns so it never
 * stares or twitches between birds; the rider points at landmarks, storks and ferries the dragon looks at.
 */
export class AttentionController {
  yaw = 0;
  pitch = 0;
  weight = 0;
  /** 0..1 rider points at the current target (landmark, stork, ferry, horn). */
  show = 0;
  private look: LookState | null = null;
  private readonly cooldown = new Map<string, number>();
  private kindCooldown: Record<string, number> = {};
  private time = 0;

  constructor(private readonly rng: BondRng) {}

  /** The current target (for gull snaps: the closest bird). */
  get target(): LookState | null {
    return this.look;
  }

  update(inp: BondInputs, safety: Safety, blocked: boolean): void {
    const dt = inp.dt;
    this.time += dt;
    this.started = null;
    const l = BOND.look;
    if (inp.discovery) {
      this.start(inp.discovery, l.landmarkTime);
    }
    for (const c of inp.attention) {
      if (!this.eligible(c)) {
        continue;
      }
      const current = this.look ? PRIORITY[this.look.kind] : 0;
      if (PRIORITY[c.kind] > current) {
        this.start(c, this.durationOf(c.kind));
      }
    }
    const look = this.look;
    let target = 0;
    if (look) {
      look.time += dt;
      // Follow a moving target (a bird, a ferry) with the same key.
      for (const c of inp.attention) {
        if (c.key === look.key) {
          look.yaw = c.yaw;
          look.pitch = c.pitch;
        }
      }
      if (look.time > look.duration) {
        this.look = null;
      } else if (safety.lookOk && !blocked) {
        target = 1 - Math.max(0, (look.time - look.duration + 0.5) / 0.5);
      }
    }
    if (this.look) {
      this.yaw = clamp(this.look.yaw, -l.maxYaw, l.maxYaw);
      this.pitch = clamp(this.look.pitch, -l.maxPitchDown, l.maxPitchUp);
    }
    this.weight = approach(this.weight, target, target > this.weight ? l.rate : l.rate * 1.4, dt);
    const showing = this.look && this.look.kind !== 'bird' && this.look.time < l.showTime + 0.4 && this.look.time > 0.4 && target > 0 ? 1 : 0;
    this.show = approach(this.show, showing, 5, dt);
  }

  private durationOf(kind: AttentionCandidate['kind']): number {
    const l = BOND.look;
    switch (kind) {
      case 'bird':
        return l.birdTime * this.rng.range(0.8, 1.25);
      case 'ferry':
        return l.ferryTime;
      case 'stork':
        return l.storkTime;
      case 'horn':
      case 'sound':
        return l.hornTime;
      default:
        return l.landmarkTime;
    }
  }

  private eligible(c: AttentionCandidate): boolean {
    const l = BOND.look;
    const range = c.kind === 'bird' ? l.birdRange : c.kind === 'ferry' ? l.ferryRange : c.kind === 'stork' ? l.storkRange : l.hornRange;
    if (c.distance > range || !Number.isFinite(c.yaw + c.pitch)) {
      return false;
    }
    // Birds and ferries straight behind are not worth craning for.
    if ((c.kind === 'bird' || c.kind === 'ferry') && Math.abs(c.yaw) > 2.2) {
      return false;
    }
    const until = this.cooldown.get(c.key) ?? -1;
    return this.time >= until && this.time >= (this.kindCooldown[c.kind] ?? -1);
  }

  /** Kind of the look started this frame (the core turns it into curiosity), or null. */
  started: AttentionCandidate['kind'] | null = null;

  private start(c: AttentionCandidate, duration: number): void {
    const l = BOND.look;
    this.started = c.kind;
    this.look = { kind: c.kind, key: c.key, time: 0, duration, yaw: c.yaw, pitch: c.pitch };
    const cd = c.kind === 'bird' ? l.birdCooldown : c.kind === 'ferry' ? l.ferryCooldown : c.kind === 'stork' ? l.storkCooldown : c.kind === 'landmark' ? 30 : l.hornCooldown;
    this.cooldown.set(c.key, this.time + cd);
    this.kindCooldown[c.kind] = this.time + (c.kind === 'bird' ? cd * 0.5 : 4);
  }
}
