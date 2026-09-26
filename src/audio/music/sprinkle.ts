/**
 * Sprinkle director (pure, fake-clock friendly): sprinkle mode ("Müzik tarzı: Seyrek") keeps the world mostly silent
 * musically and now and then plays one short, sparse, single-instrument PHRASE (a ney breath, a few kanun notes, a
 * tanbur note at night) over the world sound, the way Breath of the Wild and Minecraft do.
 *
 *   gaps     a random silence between phrases (SPRINKLE_DEFAULTS.gapMinSec..gapMaxSec, shorter after a long calm)
 *   context  the phrase is picked by tag match against the current context (time of day restricts, the rest weights)
 *   variety  never the same phrase twice in a row, and not the same instrument family if another one fits
 *   holds    nothing plays during races, moments, photo mode, menus / pause and under water; a phrase that is playing
 *            when a hold begins fades out gently
 *   calm     no new phrase during sprints, dives or flow boosts, and only after the calm has settled
 *
 * It emits commands with absolute AudioContext times (load / play / stop); the WebAudio player (./player.ts) executes
 * them on the music bus, so the "Müzik" volume and the music ducks apply. Randomness comes from an injected RNG.
 */
import type { MusicPhraseDef } from './manifest';
import type { ConditionId, MusicInput } from './rules';

/** Every tunable number of sprinkle mode in one place (seconds unless noted). */
export interface SprinkleConfig {
  /** Silence between two phrases, uniformly random in [gapMinSec, gapMaxSec]. */
  gapMinSec: number;
  gapMaxSec: number;
  /** Silence before the first phrase of a session. */
  firstGapMinSec: number;
  firstGapMaxSec: number;
  /** After a hold ends (race, moment, photo, menu, under water) at least this much quiet before a phrase. */
  afterHoldSec: number;
  /** After a sprint, dive or boost the calm must have lasted this long before a phrase starts. */
  calmSettleSec: number;
  /** A calm stretch this long (no hold, no busy flight) shortens the gap by `longCalmGapScale`... */
  longCalmSec: number;
  longCalmGapScale: number;
  /** ...but never below this. */
  gapFloorSec: number;
  /** Fades of a phrase (the files carry their own silent head and tail; these only soften the edges). */
  fadeInSec: number;
  fadeOutSec: number;
  /** Fade when a hold interrupts a phrase. */
  interruptFadeSec: number;
  /** When no phrase fits the context (or only the last one does), look again after this long. */
  retrySec: number;
  /** Decoding starts this long before the phrase is due. */
  preloadSec: number;
  /** Scheduling lookahead. */
  lookaheadSec: number;
  /** Pick weight: `baseWeight + tagWeight × matching context tags`. */
  baseWeight: number;
  tagWeight: number;
  /** Local hours of the `dawn` and `dusk` tags [from, to). */
  dawnHours: readonly [number, number];
  duskHours: readonly [number, number];
  /** Below this airspeed (m/s) an airborne dragon counts as `calm` (cruise is about 32 m/s). */
  calmAirspeed: number;
  /** A flow chain burst above this counts as a boost. */
  boostThreshold: number;
}

export const SPRINKLE_DEFAULTS: SprinkleConfig = {
  gapMinSec: 90,
  gapMaxSec: 240,
  firstGapMinSec: 25,
  firstGapMaxSec: 70,
  afterHoldSec: 20,
  calmSettleSec: 8,
  longCalmSec: 150,
  longCalmGapScale: 0.6,
  gapFloorSec: 60,
  fadeInSec: 1.5,
  fadeOutSec: 2.5,
  interruptFadeSec: 2.5,
  retrySec: 20,
  preloadSec: 8,
  lookaheadSec: 0.1,
  baseWeight: 1,
  tagWeight: 2,
  dawnHours: [5, 8],
  duskHours: [17.5, 20.5],
  calmAirspeed: 30,
  boostThreshold: 0.05,
};

/** Why nothing new may start (highest priority first). A hold also fades out a playing phrase. */
export type SprinkleHold = 'race' | 'moment' | 'photo' | 'menu' | 'underwater';
/** Why the director waits for calmer flight (a playing phrase continues). */
export type SprinkleBusy = 'fast' | 'dive' | 'boost';

export interface SprinkleContext {
  /** Context tags (KNOWN_TAGS vocabulary): day / night / dawn / dusk, fog, storm, water, perch, flight, calm. */
  tags: ReadonlySet<string>;
  hold: SprinkleHold | null;
  busy: SprinkleBusy | null;
  /** Adaptive music on: phrases are matched to the context; off = a plain rotation (holds still apply). */
  adaptive: boolean;
}

export const TIME_TAGS: readonly string[] = ['day', 'night', 'dawn', 'dusk'];

const inHours = (h: number, [from, to]: readonly [number, number]): boolean => h >= from && h < to;

/**
 * Derives the sprinkle context from the music input and the rules' debounced conditions (pure). Holds read the raw
 * input (they must act at once); busy flight uses the debounced `fast` / `diving` conditions so a phrase does not wait
 * for every short speed bump.
 */
export function sprinkleContext(input: MusicInput, conditions: Iterable<ConditionId>, adaptive = true, cfg: SprinkleConfig = SPRINKLE_DEFAULTS): SprinkleContext {
  const cond = new Set(conditions);
  const hold: SprinkleHold | null =
    input.race !== 'none' ? 'race' : input.moment ? 'moment' : input.photo ? 'photo' : input.menu ? 'menu' : input.underwater >= 0.3 || input.mode === 'underwater' ? 'underwater' : null;
  const busy: SprinkleBusy | null = cond.has('diving') ? 'dive' : input.burst > cfg.boostThreshold ? 'boost' : cond.has('fast') ? 'fast' : null;
  const tags = new Set<string>();
  tags.add(cond.has('night') ? 'night' : 'day');
  if (inHours(input.hour, cfg.dawnHours)) {
    tags.add('dawn');
  }
  if (inHours(input.hour, cfg.duskHours)) {
    tags.add('dusk');
  }
  if (cond.has('fog')) {
    tags.add('fog');
  }
  if (cond.has('storm')) {
    tags.add('storm');
  }
  if (input.overWater || cond.has('lowOverWater') || input.mode === 'swimming') {
    tags.add('water');
  }
  if (input.perched) {
    tags.add('perch');
  }
  const airborne = input.mode !== 'none' && input.mode !== 'grounded' && input.mode !== 'swimming' && input.mode !== 'underwater';
  if (airborne && !input.perched) {
    tags.add('flight');
  }
  if (!busy && (input.perched || !airborne || input.airspeed < cfg.calmAirspeed || cond.has('thermal'))) {
    tags.add('calm');
  }
  return { tags, hold, busy, adaptive };
}

/** A phrase may play in this context: its time-of-day tags (if any) must include one of the current ones. */
export function phraseFits(p: Pick<MusicPhraseDef, 'tags'>, ctx: SprinkleContext): boolean {
  if (!ctx.adaptive) {
    return true;
  }
  const times = p.tags.filter((t) => TIME_TAGS.includes(t));
  return times.length === 0 || times.some((t) => ctx.tags.has(t));
}

/** Pick weight of a fitting phrase (pure). */
export function phraseWeight(p: Pick<MusicPhraseDef, 'tags'>, ctx: SprinkleContext, cfg: SprinkleConfig = SPRINKLE_DEFAULTS): number {
  if (!ctx.adaptive) {
    return 1;
  }
  let n = 0;
  for (const t of new Set(p.tags)) {
    if (ctx.tags.has(t)) {
      n++;
    }
  }
  return cfg.baseWeight + cfg.tagWeight * n;
}

export interface PhrasePick {
  phrase: MusicPhraseDef | null;
  /** Why nothing was picked (debug). */
  why: string;
}

/**
 * Picks the next phrase (pure but for `random`): fitting phrases, minus the last phrase, minus the last family when
 * another family fits, weighted by tag match. The last phrase repeats only when it is the only phrase there is.
 */
export function pickPhrase(
  phrases: readonly MusicPhraseDef[],
  ctx: SprinkleContext,
  last: { id: string | null; family: string | null },
  random: () => number,
  cfg: SprinkleConfig = SPRINKLE_DEFAULTS,
): PhrasePick {
  if (phrases.length === 0) {
    return { phrase: null, why: 'no phrases' };
  }
  let pool = phrases.filter((p) => phraseFits(p, ctx));
  if (pool.length === 0) {
    return { phrase: null, why: 'no phrase fits the context' };
  }
  if (phrases.length > 1) {
    pool = pool.filter((p) => p.id !== last.id);
    if (pool.length === 0) {
      return { phrase: null, why: 'only the last phrase fits' };
    }
  }
  const otherFamily = pool.filter((p) => (p.family ?? null) !== last.family || last.family === null);
  if (otherFamily.length > 0) {
    pool = otherFamily;
  }
  const weights = pool.map((p) => phraseWeight(p, ctx, cfg));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = random() * total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r < 0) {
      return { phrase: pool[i], why: '' };
    }
  }
  return { phrase: pool[pool.length - 1], why: '' };
}

export type SprinkleCommand =
  /** Decode a phrase (idempotent; the director waits for isReady). */
  | { type: 'load'; phraseId: string }
  /** Play a phrase once on voice `voice` from `at`: fade in over `fadeIn`, fade out over the last `fadeOut` s. */
  | { type: 'play'; voice: number; phraseId: string; at: number; duration: number; fadeIn: number; fadeOut: number }
  /** Fade a voice out from `at` over `fade` s and stop it. */
  | { type: 'stop'; voice: number; at: number; fade: number };

export interface SprinkleWorld {
  phrases: readonly MusicPhraseDef[];
  isReady(phraseId: string): boolean;
}

export interface SprinkleView {
  phase: 'waiting' | 'playing';
  /** Phrase playing now. */
  current: string | null;
  /** When the current phrase ends (s). */
  endsAt: number | null;
  /** Last phrase played (or playing) and its family. */
  last: string | null;
  lastFamily: string | null;
  /** When the gap is over (s; the phrase may still wait for calm or a hold). */
  dueAt: number;
  /** Phrase chosen ahead (preloading). */
  pending: string | null;
  hold: SprinkleHold | null;
  busy: SprinkleBusy | null;
  /** What the director is waiting for (debug). */
  note: string;
  /** Phrases played this session. */
  played: number;
}

export class SprinkleDirector {
  private phase: 'waiting' | 'playing' = 'waiting';
  private current: { voice: number; phrase: MusicPhraseDef; endsAt: number } | null = null;
  private lastId: string | null = null;
  private lastFamily: string | null = null;
  private gapStart = Number.NaN;
  private gapLen = 0;
  private lastHoldAt = -Infinity;
  private lastBusyAt = -Infinity;
  private pending: MusicPhraseDef | null = null;
  /** The pending phrase was asked for by name (debug): it plays whatever the context. */
  private pendingForced = false;
  /** Why the last pick found nothing (shown until a pick succeeds). */
  private retryWhy: string | null = null;
  private loading: string | null = null;
  private voiceSeq = 0;
  private hold: SprinkleHold | null = null;
  private busy: SprinkleBusy | null = null;
  private note = 'idle';
  private played = 0;
  private lastNow = 0;
  private readonly out: SprinkleCommand[] = [];

  constructor(
    readonly config: SprinkleConfig = SPRINKLE_DEFAULTS,
    private readonly random: () => number = Math.random,
  ) {}

  private rand(min: number, max: number): number {
    return min + (max - min) * this.random();
  }

  /** When the current gap ends, the long-calm shortening included. */
  private dueAt(now: number): number {
    if (Number.isNaN(this.gapStart)) {
      return Infinity;
    }
    const c = this.config;
    const calmSince = Math.max(this.lastHoldAt, this.lastBusyAt);
    let len = this.gapLen;
    if (now - calmSince >= c.longCalmSec) {
      len = Math.max(Math.min(len, c.gapFloorSec), len * c.longCalmGapScale);
    }
    return this.gapStart + len;
  }

  get view(): SprinkleView {
    return {
      phase: this.phase,
      current: this.current?.phrase.id ?? null,
      endsAt: this.current?.endsAt ?? null,
      last: this.lastId,
      lastFamily: this.lastFamily,
      dueAt: this.dueAt(this.lastNow),
      pending: this.pending?.id ?? null,
      hold: this.hold,
      busy: this.busy,
      note: this.note,
      played: this.played,
    };
  }

  private newGap(from: number): void {
    this.gapStart = from;
    this.gapLen = this.rand(this.config.gapMinSec, this.config.gapMaxSec);
    this.pending = null;
    this.pendingForced = false;
  }

  /**
   * The next phrase is due in `sec` seconds (debug: `__evrenMusic.sprinkle()`), optionally a given phrase whatever the
   * context; holds and busy flight still apply, the settle times are skipped.
   */
  dueIn(now: number, sec: number, phrase: MusicPhraseDef | null = null): void {
    this.gapStart = now;
    this.gapLen = Math.max(0, sec);
    this.lastHoldAt = Math.min(this.lastHoldAt, now - this.config.afterHoldSec);
    this.lastBusyAt = Math.min(this.lastBusyAt, now - this.config.calmSettleSec);
    this.pending = phrase;
    this.pendingForced = phrase !== null;
  }

  /** Stops a playing phrase (style switched, music off) and starts a fresh gap. */
  stopNow(now: number, fade = this.config.interruptFadeSec): SprinkleCommand[] {
    this.out.length = 0;
    this.interrupt(now, fade, 'stopped');
    return this.out.slice();
  }

  /** Shifts every scheduled time by `dt` (after a hard pause of `dt` seconds). */
  shift(dt: number): void {
    this.gapStart += dt;
    this.lastHoldAt += dt;
    this.lastBusyAt += dt;
    if (this.current) {
      this.current.endsAt += dt;
    }
  }

  private interrupt(now: number, fade: number, note: string): void {
    if (this.current) {
      this.out.push({ type: 'stop', voice: this.current.voice, at: now, fade });
      this.current = null;
      this.phase = 'waiting';
      this.newGap(now + fade);
    }
    this.note = note;
  }

  tick(now: number, ctx: SprinkleContext, world: SprinkleWorld): SprinkleCommand[] {
    const c = this.config;
    const out = this.out;
    out.length = 0;
    this.lastNow = now;
    if (Number.isNaN(this.gapStart)) {
      // Session start: the first gap, and the calm (for the long-calm shortening) counts from now.
      this.gapStart = now;
      this.gapLen = this.rand(c.firstGapMinSec, c.firstGapMaxSec);
      this.lastBusyAt = Math.max(this.lastBusyAt, now - c.calmSettleSec);
    }
    this.hold = ctx.hold;
    this.busy = ctx.busy;
    if (ctx.hold) {
      this.lastHoldAt = now;
      this.interrupt(now, c.interruptFadeSec, `hold: ${ctx.hold}`);
      return out.slice();
    }
    if (ctx.busy) {
      this.lastBusyAt = now;
    }
    if (this.current) {
      if (now < this.current.endsAt) {
        this.note = `playing ${this.current.phrase.id}`;
        return out.slice();
      }
      this.current = null;
      this.phase = 'waiting';
      this.newGap(now);
    }
    if (world.phrases.length === 0) {
      this.note = 'no phrases';
      return out.slice();
    }
    const due = this.dueAt(now);
    // Choose ahead and decode while the gap runs out.
    if (now >= due - c.preloadSec && (!this.pending || (!this.pendingForced && !phraseFits(this.pending, ctx)) || !world.phrases.includes(this.pending))) {
      const pick = pickPhrase(world.phrases, ctx, { id: this.lastId, family: this.lastFamily }, this.random, c);
      this.pending = pick.phrase;
      if (!pick.phrase) {
        this.gapStart = now;
        this.gapLen = c.retrySec;
        this.retryWhy = pick.why;
        this.note = `${pick.why}: retry in ${c.retrySec} s`;
        return out.slice();
      }
      this.retryWhy = null;
    }
    if (this.pending && !world.isReady(this.pending.id) && this.loading !== this.pending.id) {
      this.loading = this.pending.id;
      out.push({ type: 'load', phraseId: this.pending.id });
    }
    if (now < due) {
      this.note = this.pending ? `gap (next: ${this.pending.id})` : this.retryWhy ? `${this.retryWhy}: retry` : 'gap';
      return out.slice();
    }
    if (ctx.busy) {
      this.note = `waiting for calm (${ctx.busy})`;
      return out.slice();
    }
    if (now - this.lastHoldAt < c.afterHoldSec) {
      this.note = 'quiet after a hold';
      return out.slice();
    }
    if (now - this.lastBusyAt < c.calmSettleSec) {
      this.note = 'calm settling';
      return out.slice();
    }
    const p = this.pending;
    if (!p) {
      return out.slice();
    }
    if (!world.isReady(p.id)) {
      this.note = `loading ${p.id}`;
      return out.slice();
    }
    const at = now + c.lookaheadSec;
    const voice = ++this.voiceSeq;
    const fadeOut = Math.min(c.fadeOutSec, p.durationSec / 3);
    out.push({ type: 'play', voice, phraseId: p.id, at, duration: p.durationSec, fadeIn: Math.min(c.fadeInSec, p.durationSec / 3), fadeOut });
    this.current = { voice, phrase: p, endsAt: at + p.durationSec };
    this.phase = 'playing';
    this.lastId = p.id;
    this.lastFamily = p.family ?? null;
    this.pending = null;
    this.pendingForced = false;
    this.loading = null;
    this.played++;
    this.note = `play ${p.id}`;
    return out.slice();
  }
}
