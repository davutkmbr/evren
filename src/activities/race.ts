/**
 * Ring race state machine (pure logic, no three.js): idle → countdown → running → finished | aborted.
 *
 * Each update takes the dragon's position this frame; the segment from the previous position to the current one is
 * tested against the disc of the NEXT gate only (crossing its plane in the normal direction, inside the radius).
 * Crossing another gate never counts: a later gate reports `missed` (the racer skipped one), crossing the next gate
 * backwards reports `wrongWay`. The race aborts when the dragon strays too far from the current leg or stays on the
 * ground / in the water.
 */
import { COUNTDOWN_SECONDS, type CompiledCourse, type Gate } from './courses';

export type RacePhase = 'idle' | 'countdown' | 'running' | 'finished' | 'aborted';
export type AbortReason = 'stray' | 'landed' | 'cancel' | 'teleport';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type RaceEvent =
  | { type: 'countdown'; secondsLeft: number }
  | { type: 'go' }
  | { type: 'gate'; index: number; elapsed: number; split: number; bestSplit?: number }
  | { type: 'missed'; expected: number; crossed: number }
  | { type: 'wrongWay'; index: number }
  | { type: 'strayWarning'; distance: number }
  | { type: 'finished'; time: number; splits: readonly number[] }
  | { type: 'aborted'; reason: AbortReason };

export interface RaceOptions {
  /** Horizontal distance from the current leg (m) that triggers a warning. */
  strayWarn?: number;
  /** Horizontal distance from the current leg (m) that aborts the race. */
  strayAbort?: number;
  /** Seconds on the ground / in the water before the race aborts. */
  groundedGrace?: number;
  countdown?: number;
  /** Best splits (cumulative seconds per gate) to compare against, if a record exists. */
  bestSplits?: readonly number[];
}

/**
 * Tests the segment a→b against a gate disc. Returns 1 for a forward pass (crossing along the normal inside the
 * radius), -1 for a backward pass, 0 otherwise.
 */
export function gateCrossing(gate: Gate, a: Vec3, b: Vec3): -1 | 0 | 1 {
  const da = (a.x - gate.x) * gate.nx + (a.y - gate.y) * gate.ny + (a.z - gate.z) * gate.nz;
  const db = (b.x - gate.x) * gate.nx + (b.y - gate.y) * gate.ny + (b.z - gate.z) * gate.nz;
  const forward = da < 0 && db >= 0;
  const backward = da >= 0 && db < 0;
  if (!forward && !backward) {
    return 0;
  }
  const t = da / (da - db);
  const qx = a.x + (b.x - a.x) * t - gate.x;
  const qy = a.y + (b.y - a.y) * t - gate.y;
  const qz = a.z + (b.z - a.z) * t - gate.z;
  if (qx * qx + qy * qy + qz * qz > gate.radius * gate.radius) {
    return 0;
  }
  return forward ? 1 : -1;
}

/** Horizontal distance from p to the segment a→b (m). */
export function horizontalDistanceToSegment(p: Vec3, a: Vec3, b: Vec3): number {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const len2 = abx * abx + abz * abz;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.z - a.z) * abz) / len2)) : 0;
  return Math.hypot(p.x - (a.x + abx * t), p.z - (a.z + abz * t));
}

export class RaceSession {
  readonly course: CompiledCourse;
  phase: RacePhase = 'idle';
  /** Index of the gate that counts next. */
  next = 0;
  /** Seconds since GO (0 before). */
  elapsed = 0;
  /** Cumulative time at each passed gate (s). */
  readonly splits: number[] = [];
  abortReason: AbortReason | null = null;

  private countdownLeft = 0;
  private lastCountdownSecond = 0;
  private prev: Vec3 | null = null;
  private groundedFor = 0;
  private strayWarned = false;
  private readonly opts: Required<Omit<RaceOptions, 'bestSplits'>> & { bestSplits?: readonly number[] };

  constructor(course: CompiledCourse, opts: RaceOptions = {}) {
    this.course = course;
    this.opts = {
      strayWarn: opts.strayWarn ?? 900,
      strayAbort: opts.strayAbort ?? 1500,
      groundedGrace: opts.groundedGrace ?? 2,
      countdown: opts.countdown ?? COUNTDOWN_SECONDS,
      bestSplits: opts.bestSplits,
    };
  }

  get total(): number {
    return this.course.gates.length;
  }

  get active(): boolean {
    return this.phase === 'countdown' || this.phase === 'running';
  }

  /** Enters the countdown. The caller places the dragon at course.start. */
  start(): RaceEvent[] {
    this.phase = 'countdown';
    this.next = 0;
    this.elapsed = 0;
    this.splits.length = 0;
    this.abortReason = null;
    this.prev = null;
    this.groundedFor = 0;
    this.strayWarned = false;
    this.countdownLeft = this.opts.countdown;
    this.lastCountdownSecond = Math.ceil(this.countdownLeft);
    if (this.countdownLeft <= 0) {
      this.phase = 'running';
      return [{ type: 'go' }];
    }
    return [{ type: 'countdown', secondsLeft: this.lastCountdownSecond }];
  }

  abort(reason: AbortReason): RaceEvent[] {
    if (!this.active) {
      return [];
    }
    this.phase = 'aborted';
    this.abortReason = reason;
    return [{ type: 'aborted', reason }];
  }

  /** Forget the previous position (after a teleport the next frame starts a new segment). */
  resetTrail(): void {
    this.prev = null;
  }

  /**
   * Advances the race by dt seconds with the dragon at `pos`. `grounded` = standing, landing or swimming.
   * dt = 0 (paused) changes nothing.
   */
  update(dt: number, pos: Vec3, grounded: boolean): RaceEvent[] {
    const events: RaceEvent[] = [];
    if (!this.active || dt <= 0) {
      return events;
    }
    if (this.phase === 'countdown') {
      this.countdownLeft -= dt;
      const sec = Math.ceil(this.countdownLeft);
      if (this.countdownLeft <= 0) {
        this.phase = 'running';
        this.elapsed = 0;
        events.push({ type: 'go' });
        // The segment used for the first gate starts at GO, so an early crossing does not count.
        this.prev = { x: pos.x, y: pos.y, z: pos.z };
        return events;
      }
      if (sec !== this.lastCountdownSecond) {
        this.lastCountdownSecond = sec;
        events.push({ type: 'countdown', secondsLeft: sec });
      }
      this.prev = { x: pos.x, y: pos.y, z: pos.z };
      return events;
    }

    // Running.
    this.elapsed += dt;
    const prev = this.prev;
    this.prev = { x: pos.x, y: pos.y, z: pos.z };
    if (prev) {
      const gates = this.course.gates;
      const cross = gateCrossing(gates[this.next], prev, pos);
      if (cross === 1) {
        // Sub-frame timing: interpolate the crossing instant inside this frame.
        const g = gates[this.next];
        const da = (prev.x - g.x) * g.nx + (prev.y - g.y) * g.ny + (prev.z - g.z) * g.nz;
        const db = (pos.x - g.x) * g.nx + (pos.y - g.y) * g.ny + (pos.z - g.z) * g.nz;
        const frac = da !== db ? da / (da - db) : 1;
        const t = this.elapsed - dt * (1 - frac);
        this.splits.push(t);
        const index = this.next;
        this.next++;
        this.strayWarned = false;
        events.push({ type: 'gate', index, elapsed: t, split: t, bestSplit: this.opts.bestSplits?.[index] });
        if (this.next >= gates.length) {
          this.phase = 'finished';
          this.elapsed = t;
          events.push({ type: 'finished', time: t, splits: this.splits.slice() });
          return events;
        }
      } else if (cross === -1) {
        events.push({ type: 'wrongWay', index: this.next });
      } else {
        for (let i = this.next + 1; i < gates.length; i++) {
          if (gateCrossing(gates[i], prev, pos) === 1) {
            events.push({ type: 'missed', expected: this.next, crossed: i });
            break;
          }
        }
      }
    }

    // Stray and ground checks against the current leg.
    const target = this.course.gates[this.next];
    const from: Vec3 = this.next > 0 ? this.course.gates[this.next - 1] : this.course.start;
    const dist = horizontalDistanceToSegment(pos, from, target);
    if (dist > this.opts.strayAbort) {
      events.push(...this.abort('stray'));
      return events;
    }
    if (dist > this.opts.strayWarn) {
      if (!this.strayWarned) {
        this.strayWarned = true;
        events.push({ type: 'strayWarning', distance: dist });
      }
    } else if (dist < this.opts.strayWarn * 0.8) {
      this.strayWarned = false;
    }
    this.groundedFor = grounded ? this.groundedFor + dt : 0;
    if (this.groundedFor > this.opts.groundedGrace) {
      events.push(...this.abort('landed'));
    }
    return events;
  }
}
