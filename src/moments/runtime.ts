/**
 * Moment runtime logic (pure TS, no DOM, no three.js): decides which moment plays, when, and drives its subtitle
 * timeline. The game system (./system.ts) feeds it a world snapshot every frame and renders what it asks for through a
 * `MomentSink`; the headless check (tools/headless/moments-runtime-check.ts) feeds it a scripted flight instead.
 *
 * Rules (phase 19, .docs/planning/19-moments.md):
 * - At most one moment at a time; a global gap after a moment keeps them rare; the records' own once-per-session /
 *   cooldown rules apply through the pure evaluator (./triggers.ts).
 * - A moment starts only after its trigger held for `dwellSec` (no flicker starts from a single frame).
 * - Once started, a moment plays to its end (owner decision, 26 Sep): leaving its place or its altitude band, landing
 *   or a change of weather no longer cut it short, so a second moment can never interrupt the first. Only a race and
 *   switching its category off in the settings end it early.
 * - Nothing advances while the game is paused (menus, map, photo mode: dt = 0); no moment starts or continues during a
 *   race; a category switched off in Ayarlar → Oyun → Anlar ends a playing moment of that category.
 * - Every end, early or not, starts the global gap (`minGapSec`) before the next moment. A moment cut short before
 *   half of its lines were shown is not spent: it may try again after `retrySec` (and the gap).
 */
import { momentAllowed, type MomentPrefs } from './prefs';
import { eligibleMoments, nearestAnchor, type MomentContext, type MomentSession } from './triggers';
import type { Moment, MomentNeed, SubtitleLine } from './types';
import { latLonToLocal } from '../core/geo-coords';
import { AVAILABLE_MOMENT_SOUNDS, unresolvedContent } from './content';

export interface MomentPacing {
  /** Seconds after a moment ends before another may start (moments stay rare). */
  minGapSec: number;
  /** Seconds the trigger must hold before the moment starts. */
  dwellSec: number;
  /** A moment cut short before half of its lines may start again after this many seconds. */
  retrySec: number;
  /** Seconds for the coastal ambience lift to swell in or out. */
  liftRampSec: number;
}

export const DEFAULT_PACING: MomentPacing = {
  minGapSec: 180,
  dwellSec: 1,
  retrySec: 90,
  liftRampSec: 2.5,
};

/* ------------------------------------------------------------------ */
/* Playability                                                          */
/* ------------------------------------------------------------------ */

export interface Playability {
  playable: boolean;
  /** English reason when not playable (logged once in dev). */
  reason?: string;
  /** The moment's own sound is missing: the runtime lifts the existing coastal ambience instead. */
  soundFallback: boolean;
}

/**
 * Can this moment play with what exists today? A 'ready' moment can when every content id it names resolves to the
 * procedural content (./content.ts). A 'draft' moment can when its content is
 * complete: the only missing piece allowed is its sound, and only for a subtitle-only moment (no character, object or
 * animation), where the soft bed is optional and the existing coastal ambience stands in for it. Anything that needs a
 * model, an animation, a video link, a runtime anchor or text approval waits.
 *
 * `availableSounds` names the moment sounds that exist (the synthesised ones of ./content.ts by default).
 */
export function momentPlayability(m: Moment, availableSounds: ReadonlySet<string> = AVAILABLE_MOMENT_SOUNDS): Playability {
  const soundMissing = m.needs.includes('sound') || (m.content.soundId !== undefined && !availableSounds.has(m.content.soundId));
  if (m.content.subtitles.length === 0) {
    return { playable: false, reason: 'no subtitle lines', soundFallback: false };
  }
  if (m.status === 'ready') {
    // The actor and its animations must exist; a missing sound falls back to the lifted coastal ambience.
    const missing = unresolvedContent({ actorId: m.content.actorId, animationIds: m.content.animationIds });
    if (missing.length > 0) {
      return { playable: false, reason: `unresolved content ${missing.join(', ')}`, soundFallback: false };
    }
    return { playable: true, soundFallback: soundMissing };
  }
  const blocking: MomentNeed[] = m.needs.filter((n) => n !== 'sound');
  if (blocking.length > 0) {
    return { playable: false, reason: `needs ${blocking.join(', ')}`, soundFallback: false };
  }
  const subtitleOnly = !m.content.actorId && !(m.content.animationIds?.length ?? 0);
  if (soundMissing && !subtitleOnly) {
    return { playable: false, reason: 'needs its sound (not a subtitle-only moment)', soundFallback: false };
  }
  if (m.provenance.some((p) => p.pending)) {
    return { playable: false, reason: 'text provenance pending', soundFallback: false };
  }
  return { playable: true, soundFallback: soundMissing };
}

/* ------------------------------------------------------------------ */
/* Runner                                                               */
/* ------------------------------------------------------------------ */

/** What the runner asks the screen and the sound to do. */
export interface MomentSink {
  showLine(moment: Moment, line: SubtitleLine, index: number): void;
  /** 'end': the line's time is up; 'fade': the moment was cut short (fade out gently). */
  hideLine(moment: Moment, how: 'end' | 'fade'): void;
  showCard(moment: Moment): void;
  /** Coastal ambience lift 0..1 (the fallback bed for moments whose own sound is missing). */
  setAmbienceLift(amount: number): void;
  /** The moment started (its scene actor, if any, spawns); `anchorId` names the moving anchor it started at. */
  startMoment?(moment: Moment, forced: boolean, anchorId?: number): void;
  /** The moment ended; its actor may live on and leave by itself. */
  endMoment?(moment: Moment, reason: MomentEndReason): void;
}

/** One frame of input. */
export interface MomentFrame {
  /** The world around the dragon (the runner adds its session); null while there is no dragon or no geography. */
  context: Omit<MomentContext, 'session'> | null;
  prefs: MomentPrefs;
  /** A race is prepared, running or showing its result. */
  racing: boolean;
}

export type MomentEndReason = 'complete' | 'race' | 'disabled';

export interface MomentRecord {
  id: string;
  start: number;
  end: number;
  reason: MomentEndReason;
  forced: boolean;
  /** Subtitle lines that were on screen. */
  linesShown: number;
}

interface Playing {
  moment: Moment;
  soundFallback: boolean;
  t: number;
  line: number;
  linesShown: number;
  forced: boolean;
  start: number;
  prevFired: number | undefined;
  /** Id of the moving anchor the moment started at (the nearest one), when its place has an anchor. */
  anchorId: number | undefined;
}

export class MomentRunner {
  readonly pacing: MomentPacing;
  /** Moments that can play now, in record order. */
  readonly playable: readonly Moment[];
  /** Moments that wait for content, with the reason. */
  readonly skipped: readonly { moment: Moment; reason: string }[];
  /** Every moment played this session (tests, debug). */
  readonly history: MomentRecord[] = [];

  private readonly fallback = new Map<string, boolean>();
  private readonly lastFired = new Map<string, number>();
  private readonly retryAt = new Map<string, number>();
  private clock = 0;
  private lastEnd = -Infinity;
  private candidate: string | null = null;
  private dwell = 0;
  private playing: Playing | null = null;
  private pendingForce: Moment | null = null;
  private pendingAnchor: number | undefined = undefined;
  private lift = 0;

  constructor(
    moments: readonly Moment[],
    private readonly sink: MomentSink,
    options: { pacing?: Partial<MomentPacing>; availableSounds?: ReadonlySet<string> } = {},
  ) {
    this.pacing = { ...DEFAULT_PACING, ...options.pacing };
    const playable: Moment[] = [];
    const skipped: { moment: Moment; reason: string }[] = [];
    for (const m of moments) {
      const p = momentPlayability(m, options.availableSounds);
      if (p.playable) {
        playable.push(m);
        this.fallback.set(m.id, p.soundFallback);
      } else {
        skipped.push({ moment: m, reason: p.reason ?? 'not playable' });
      }
    }
    this.playable = playable;
    this.skipped = skipped;
  }

  /** Session clock (s): simulation time seen by the runner. */
  get now(): number {
    return this.clock;
  }

  get session(): MomentSession {
    return { now: this.clock, lastFired: this.lastFired };
  }

  /** The moment playing now, or null. */
  get current(): Moment | null {
    return this.playing?.moment ?? null;
  }

  /** Index of the subtitle line on screen (-1 between lines or when idle). */
  get currentLine(): number {
    return this.playing?.line ?? -1;
  }

  /** Id of the moving anchor (e.g. the ferry) the playing moment belongs to, or undefined. */
  get currentAnchor(): number | undefined {
    return this.playing?.anchorId;
  }

  get ambienceLift(): number {
    return this.lift;
  }

  /**
   * Plays `id` on the next update whatever the conditions, pacing and settings (the ?moment= shortcut); still waits
   * while a race runs and still pauses with the game. Returns false for an unknown or unplayable id.
   */
  force(id: string, anchorId?: number): boolean {
    const m = this.playable.find((x) => x.id === id);
    if (!m) {
      return false;
    }
    this.pendingForce = m;
    this.pendingAnchor = anchorId;
    return true;
  }

  update(dt: number, frame: MomentFrame): void {
    if (!(dt > 0)) {
      // Paused (menus, map, photo mode): nothing moves.
      return;
    }
    this.clock += dt;
    if (this.playing) {
      this.advance(dt, frame);
    } else {
      this.consider(dt, frame);
    }
    this.updateLift(dt);
  }

  private consider(dt: number, frame: MomentFrame): void {
    if (this.pendingForce) {
      if (!frame.racing) {
        const m = this.pendingForce;
        this.pendingForce = null;
        this.start(m, true, this.pendingAnchor ?? (frame.context ? nearestAnchor(m, frame.context)?.id : undefined));
      }
      return;
    }
    if (frame.racing || !frame.context || this.clock - this.lastEnd < this.pacing.minGapSec) {
      this.candidate = null;
      this.dwell = 0;
      return;
    }
    const ctx: MomentContext = { ...frame.context, session: this.session };
    let top: Moment | null = null;
    for (const e of eligibleMoments(this.playable, ctx, { includeDrafts: true, prefs: frame.prefs })) {
      if ((this.retryAt.get(e.moment.id) ?? -Infinity) <= this.clock) {
        top = e.moment;
        break;
      }
    }
    if (!top) {
      this.candidate = null;
      this.dwell = 0;
      return;
    }
    if (top.id !== this.candidate) {
      this.candidate = top.id;
      this.dwell = 0;
    }
    this.dwell += dt;
    if (this.dwell >= this.pacing.dwellSec - 1e-9) {
      this.start(top, false, nearestAnchor(top, ctx)?.id);
    }
  }

  private start(m: Moment, forced: boolean, anchorId?: number): void {
    this.candidate = null;
    this.dwell = 0;
    this.playing = {
      moment: m,
      soundFallback: this.fallback.get(m.id) ?? false,
      t: 0,
      line: -1,
      linesShown: 0,
      forced,
      start: this.clock,
      prevFired: this.lastFired.get(m.id),
      anchorId,
    };
    this.lastFired.set(m.id, this.clock);
    this.retryAt.delete(m.id);
    this.sink.startMoment?.(m, forced, anchorId);
    this.tick();
  }

  private advance(dt: number, frame: MomentFrame): void {
    const p = this.playing!;
    if (frame.racing) {
      this.stop('race');
      return;
    }
    if (!p.forced && !momentAllowed(frame.prefs, p.moment.category)) {
      this.stop('disabled');
      return;
    }
    p.t += dt;
    this.tick();
  }

  /** Shows the line due at the current time; ends the moment after its last line. */
  private tick(): void {
    const p = this.playing!;
    const subs = p.moment.content.subtitles;
    let idx = -1;
    for (let i = 0; i < subs.length; i++) {
      if (p.t >= subs[i].at - 1e-9 && p.t < subs[i].at + subs[i].duration - 1e-9) {
        idx = i;
      }
    }
    if (idx !== p.line) {
      if (p.line >= 0) {
        this.sink.hideLine(p.moment, 'end');
      }
      p.line = idx;
      if (idx >= 0) {
        p.linesShown = Math.max(p.linesShown, idx + 1);
        this.sink.showLine(p.moment, subs[idx], idx);
      }
    }
    const last = subs[subs.length - 1];
    if (p.t >= last.at + last.duration - 1e-9) {
      this.stop('complete');
    }
  }

  private stop(reason: MomentEndReason): void {
    const p = this.playing!;
    this.playing = null;
    if (p.line >= 0) {
      this.sink.hideLine(p.moment, reason === 'complete' ? 'end' : 'fade');
    }
    if (reason === 'complete' && p.moment.content.card) {
      this.sink.showCard(p.moment);
    }
    const seen = reason === 'complete' || p.linesShown >= Math.ceil(p.moment.content.subtitles.length / 2);
    this.lastEnd = this.clock;
    if (!seen) {
      // Cut short early: not spent, it may try again a little later.
      if (p.prevFired === undefined) {
        this.lastFired.delete(p.moment.id);
      } else {
        this.lastFired.set(p.moment.id, p.prevFired);
      }
      this.retryAt.set(p.moment.id, this.clock + this.pacing.retrySec);
    }
    this.history.push({ id: p.moment.id, start: p.start, end: this.clock, reason, forced: p.forced, linesShown: p.linesShown });
    this.sink.endMoment?.(p.moment, reason);
  }

  private updateLift(dt: number): void {
    const target = this.playing?.soundFallback ? 1 : 0;
    if (target === this.lift) {
      return;
    }
    const step = dt / Math.max(1e-3, this.pacing.liftRampSec);
    this.lift = target > this.lift ? Math.min(target, this.lift + step) : Math.max(target, this.lift - step);
    this.sink.setAmbienceLift(this.lift);
  }
}

/* ------------------------------------------------------------------ */
/* Start pose for the ?moment= shortcut                                 */
/* ------------------------------------------------------------------ */

export interface MomentStartPose {
  x: number;
  /** Altitude above sea level (m). */
  y: number;
  z: number;
  headingDeg: number;
  pitchDeg: number;
  speed: number;
}

/**
 * Where the ?moment= shortcut puts the dragon: the record's 'start' waypoint, heading for the waypoint after it, inside
 * the trigger's altitude band (70 % of a ceiling; with a floor too, a fifth of the way up the band: 150–1500 m ASL →
 * 420 m; the start points are over water or low shore). Null when the record has no 'start' waypoint.
 */
export function momentStartPose(m: Moment): MomentStartPose | null {
  const wps = m.content.waypoints ?? [];
  const i = wps.findIndex((w) => w.id === 'start');
  if (i < 0) {
    return null;
  }
  const a = latLonToLocal(wps[i].lat, wps[i].lon);
  const next = wps[i + 1];
  let headingDeg = 0;
  if (next) {
    const b = latLonToLocal(next.lat, next.lon);
    // Compass heading: 0 = north (-z), 90 = east (+x).
    headingDeg = ((Math.atan2(b.x - a.x, -(b.z - a.z)) * 180) / Math.PI + 360) % 360;
  }
  const band = m.trigger.altitude?.find((b) => b.max !== undefined);
  const ceiling = band?.max;
  const floor = band?.min;
  const y = ceiling === undefined ? 60 : floor !== undefined ? Math.round(floor + 0.2 * (ceiling - floor)) : Math.max(8, Math.round(ceiling * 0.7));
  return { x: a.x, y, z: a.z, headingDeg, pitchDeg: -2, speed: 22 };
}
