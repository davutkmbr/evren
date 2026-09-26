/**
 * Music director (pure, fake-clock friendly): decides WHICH set plays and WHEN — the play / silence cycle, set choice
 * by the rules' tag preferences, set changes on bar or phrase boundaries, endings, race and moment overrides and
 * stingers. It emits commands with absolute AudioContext times; the WebAudio player (./player.ts) executes them.
 * The stem mix itself comes from the rules engine (./rules.ts) and is applied to whatever deck is current.
 */
import { nextBoundary, gridBarSec, type BarGrid } from './clock';
import { phraseBarsOf, type MusicSetDef, type StingerKind } from './manifest';
import type { MusicPolicy, MusicTarget } from './rules';

export interface DirectorConfig {
  /** A set plays for a random time in [playMinSec, playMaxSec], then ends on a phrase boundary. */
  playMinSec: number;
  playMaxSec: number;
  /** Silence between sets. */
  silenceMinSec: number;
  silenceMaxSec: number;
  /** Silence before the first set of a session. */
  firstSilenceMinSec: number;
  firstSilenceMaxSec: number;
  /** A normal set change waits until the current set has played this long. */
  minSetSec: number;
  /** A normal set change needs the new set to score this much higher. */
  switchMargin: number;
  /** Fade-in of a set started from silence without an intro stinger (s). */
  fadeInSec: number;
  /** Bars of the ending fade (without an outro stinger). */
  endFadeBars: number;
  /** Bars of a crossfade between sets. */
  crossfadeBars: number;
  /** Delay before an 'always' state (perch viewing) starts music from silence (s). */
  alwaysDelaySec: number;
  /** Race countdown length (s): the race set's downbeat is placed on "Başla!". */
  raceCountdownSec: number;
  /** Scheduling lookahead (s). */
  lookaheadSec: number;
  /** Score penalty of the set that played last (variety). */
  recentPenalty: number;
}

export const DEFAULT_DIRECTOR: DirectorConfig = {
  playMinSec: 120,
  playMaxSec: 240,
  silenceMinSec: 60,
  silenceMaxSec: 180,
  firstSilenceMinSec: 12,
  firstSilenceMaxSec: 30,
  minSetSec: 45,
  switchMargin: 2,
  fadeInSec: 4,
  endFadeBars: 2,
  crossfadeBars: 2,
  alwaysDelaySec: 1.5,
  raceCountdownSec: 3,
  lookaheadSec: 0.1,
  recentPenalty: 1.5,
};

export type DirectorCommand =
  /** Load a set's audio (idempotent; the director waits for isReady). */
  | { type: 'load'; setId: string }
  /**
   * Start a new deck: the loop's bar 0 at `loopAt` (all stems together), gain 0 → 1 over `fadeIn` s from `at`; an
   * intro stinger (when `intro`) plays at `at` and the loop starts after it.
   */
  | { type: 'start'; deck: number; setId: string; at: number; loopAt: number; fadeIn: number; intro: boolean }
  /** Fade a deck out from `at` over `duration` s, then stop it; `outro` plays the outro stinger at `at`. */
  | { type: 'end'; deck: number; at: number; duration: number; outro: boolean }
  /** Cancel a scheduled end that has not begun. */
  | { type: 'cancel-end'; deck: number }
  | { type: 'stinger'; setId: string; kind: StingerKind; at: number };

export interface DeckInfo {
  deck: number;
  set: MusicSetDef;
  grid: BarGrid;
  /** When the deck became audible (s). */
  startedAt: number;
}

export type DirectorPhase = 'silent' | 'playing';

export interface DirectorView {
  phase: DirectorPhase;
  current: DeckInfo | null;
  /** Deck that is fading out (after a switch or during an ending). */
  leaving: { deck: number; endsAt: number } | null;
  /** Pending end of the current deck (scheduled, not yet reached). */
  endAt: number | null;
  /** Planned end of the play window (s), or null while silent. */
  playUntil: number | null;
  /** Silence lasts until (s) while silent. */
  silenceUntil: number;
  /** Set waiting for its audio before it starts. */
  waiting: string | null;
  /** Last reason for a decision (debug). */
  note: string;
}

export interface DirectorWorld {
  sets: readonly MusicSetDef[];
  isReady(setId: string): boolean;
}

/** Deterministic PRNG (mulberry32) so the headless check can replay a session. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tag score of a set against the rules' preferences (pure). */
export function scoreSet(set: MusicSetDef, prefer: readonly string[], avoid: readonly string[]): number {
  let s = 0;
  for (const t of new Set(prefer)) {
    if (set.tags.includes(t)) {
      s += 2;
    }
  }
  for (const t of new Set(avoid)) {
    if (set.tags.includes(t)) {
      s -= 3;
    }
  }
  return s;
}

const PLAYING_POLICIES: ReadonlySet<MusicPolicy> = new Set(['always', 'race', 'moment']);

export class MusicDirector {
  private phase: DirectorPhase = 'silent';
  private current: DeckInfo | null = null;
  private leaving: { deck: number; endsAt: number } | null = null;
  private endAt: number | null = null;
  private endIsFinal = false;
  private playUntil: number | null = null;
  private silenceUntil = Number.NaN;
  private waiting: string | null = null;
  private deckSeq = 0;
  private lastSetId: string | null = null;
  private lastPolicy: MusicPolicy = 'normal';
  private lastState = '';
  /** A state with a playing policy began after the current set started: it may change the set at once. */
  private stateChangedSinceStart = false;
  private note = 'idle';
  private readonly out: DirectorCommand[] = [];
  private readonly jitter = new Map<string, number>();
  /** Forced set (debug / __evrenMusic.play): overrides the choice until cleared. */
  forcedSet: string | null = null;

  constructor(
    readonly config: DirectorConfig = DEFAULT_DIRECTOR,
    private readonly random: () => number = Math.random,
  ) {}

  get view(): DirectorView {
    return {
      phase: this.phase,
      current: this.current,
      leaving: this.leaving,
      endAt: this.endAt,
      playUntil: this.playUntil,
      silenceUntil: this.silenceUntil,
      waiting: this.waiting,
      note: this.note,
    };
  }

  /**
   * Tie-break per set, re-rolled at every start and every silence: rotation varies between sessions, but the choice
   * never flickers between equal sets from one frame to the next.
   */
  private tieBreak(id: string): number {
    let j = this.jitter.get(id);
    if (j === undefined) {
      j = this.random() * 0.01;
      this.jitter.set(id, j);
    }
    return j;
  }

  private rand(min: number, max: number): number {
    return min + (max - min) * this.random();
  }

  /** The set the rules want now (null: none fits / none exists). */
  choose(target: MusicTarget, world: DirectorWorld): MusicSetDef | null {
    const byId = (id: string | null): MusicSetDef | null => (id ? (world.sets.find((s) => s.id === id) ?? null) : null);
    const forced = byId(this.forcedSet);
    if (forced) {
      return forced;
    }
    if (target.policy === 'moment') {
      const m = byId(target.momentSet);
      if (m) {
        return m;
      }
    }
    let best: MusicSetDef | null = null;
    let bestScore = -Infinity;
    const cand = world.sets.filter((s) => !s.momentOnly);
    cand.forEach((s) => {
      let sc = scoreSet(s, target.prefer, target.avoid) + this.tieBreak(s.id);
      if (s.id === this.lastSetId && this.current?.set.id !== s.id) {
        sc -= this.config.recentPenalty;
      }
      if (s.id === this.current?.set.id) {
        sc += 0.02; // stay put on an exact tie
      }
      if (sc > bestScore) {
        bestScore = sc;
        best = s;
      }
    });
    return best;
  }

  /** Session start: the first set comes after a short silence. */
  begin(now: number): void {
    this.silenceUntil = now + this.rand(this.config.firstSilenceMinSec, this.config.firstSilenceMaxSec);
    this.note = 'first silence';
  }

  /** Shifts every scheduled time by `dt` (after a hard pause of `dt` seconds). */
  shift(dt: number): void {
    if (this.current) {
      this.current.grid.anchor += dt;
      this.current.startedAt += dt;
    }
    if (this.leaving) {
      this.leaving.endsAt += dt;
    }
    if (this.endAt !== null) {
      this.endAt += dt;
    }
    if (this.playUntil !== null) {
      this.playUntil += dt;
    }
    this.silenceUntil += dt;
  }

  /** Stops at once (debug / music switched off); the next set comes after `silence` s. */
  stopNow(now: number, silence = 0): DirectorCommand[] {
    this.out.length = 0;
    if (this.current) {
      this.out.push({ type: 'end', deck: this.current.deck, at: now, duration: 1.5, outro: false });
      this.lastSetId = this.current.set.id;
    }
    this.current = null;
    this.endAt = null;
    this.playUntil = null;
    this.phase = 'silent';
    this.waiting = null;
    this.silenceUntil = now + silence;
    this.note = 'stopped';
    return this.out.slice();
  }

  /** Skips the rest of the current silence (debug / __evrenMusic.play). */
  skipSilence(now: number): void {
    this.silenceUntil = now;
  }

  /** Race / moment cues: plays the stinger now if the current set (or the race set) has one. */
  cue(kind: StingerKind, now: number): DirectorCommand[] {
    const set = this.current?.set;
    if (set?.stingers?.[kind]) {
      this.note = `stinger ${kind}`;
      return [{ type: 'stinger', setId: set.id, kind, at: now + this.config.lookaheadSec * 0.5 }];
    }
    return [];
  }

  tick(now: number, target: MusicTarget, world: DirectorWorld): DirectorCommand[] {
    const c = this.config;
    const out = this.out;
    out.length = 0;
    if (Number.isNaN(this.silenceUntil)) {
      this.begin(now);
    }
    const policy = target.policy;
    if (target.state !== this.lastState) {
      if (PLAYING_POLICIES.has(policy)) {
        this.stateChangedSinceStart = true;
      }
      this.lastState = target.state;
    }
    const policyChanged = policy !== this.lastPolicy;
    this.lastPolicy = policy;

    // Finished fades.
    if (this.leaving && now >= this.leaving.endsAt) {
      this.leaving = null;
    }
    // A scheduled end reached.
    if (this.current && this.endAt !== null && now >= this.endAt) {
      if (this.endIsFinal) {
        const fade = gridBarSec(this.current.grid) * c.endFadeBars;
        this.leaving = { deck: this.current.deck, endsAt: this.endAt + fade };
        this.lastSetId = this.current.set.id;
        this.current = null;
        this.phase = 'silent';
        this.playUntil = null;
        this.silenceUntil = this.endAt + fade + this.rand(c.silenceMinSec, c.silenceMaxSec);
        this.jitter.clear();
        this.note = 'silence';
      }
      this.endAt = null;
    }

    const want = this.choose(target, world);
    if (!want) {
      this.note = world.sets.length ? 'no set fits' : 'no music';
      return out.slice();
    }

    if (this.phase === 'silent') {
      if (policy === 'hold' && !this.forcedSet) {
        return out.slice();
      }
      const due = PLAYING_POLICIES.has(policy) || this.forcedSet !== null || now >= this.silenceUntil;
      if (!due) {
        return out.slice();
      }
      if (!world.isReady(want.id)) {
        this.requestLoad(want.id);
        return out.slice();
      }
      this.waiting = null;
      let at = now + c.lookaheadSec;
      if (policy === 'always' && policyChanged) {
        at = now + c.alwaysDelaySec;
      }
      if (target.state === 'race-countdown') {
        at = Math.max(at, target.stateSince + c.raceCountdownSec);
      }
      // No intro before "Başla!": the loop's downbeat itself lands on the start.
      this.startDeck(want, at, now, !!want.stingers?.intro && target.state !== 'race-countdown', target.state === 'race-countdown' ? 0.05 : c.fadeInSec);
      this.note = `start (${policy})`;
      return out.slice();
    }

    // Playing.
    const cur = this.current!;
    // Keep playing while a playing policy holds: an end not yet begun is cancelled, the play window extended.
    if (PLAYING_POLICIES.has(policy) || this.forcedSet) {
      if (this.endAt !== null && this.endIsFinal && now < this.endAt) {
        out.push({ type: 'cancel-end', deck: cur.deck });
        this.endAt = null;
        this.note = 'end cancelled';
      }
      this.playUntil = Math.max(this.playUntil ?? now, now + 30);
    }
    if (this.endAt !== null) {
      return out.slice();
    }

    if (want.id !== cur.set.id && this.switchAllowed(now, target, cur.set, want)) {
      if (!world.isReady(want.id)) {
        this.requestLoad(want.id);
      } else {
        this.waiting = null;
        const quant = policy === 'race' || policy === 'moment' ? 1 : phraseBarsOf(cur.set);
        let at = nextBoundary(cur.grid, now, quant, c.lookaheadSec);
        let fadeFrom = at;
        let fade = gridBarSec(cur.grid) * c.crossfadeBars;
        if (target.state === 'race-countdown') {
          // Place the race set's downbeat on "Başla!": the old set fades out over the countdown.
          at = Math.max(now + c.lookaheadSec, target.stateSince + c.raceCountdownSec);
          fadeFrom = now + c.lookaheadSec;
          fade = Math.max(0.5, at - fadeFrom);
        }
        out.push({ type: 'end', deck: cur.deck, at: fadeFrom, duration: fade, outro: false });
        this.leaving = { deck: cur.deck, endsAt: fadeFrom + fade };
        this.lastSetId = cur.set.id;
        const keepWindow = this.playUntil;
        this.startDeck(want, at, now, !!want.stingers?.intro && target.state !== 'race-countdown', target.state === 'race-countdown' ? 0.05 : Math.min(fade, gridBarSec(cur.grid)));
        this.playUntil = keepWindow;
        this.note = `switch ${cur.set.id} → ${want.id} (${policy})`;
        return out.slice();
      }
    }

    // The play window ran out: end on a phrase boundary (not while a playing policy holds; a moment-only set that
    // outlived its moment ends too when no normal set is wanted).
    const leftMoment = cur.set.momentOnly && policy !== 'moment';
    if ((this.playUntil !== null && now >= this.playUntil && !PLAYING_POLICIES.has(policy) && !this.forcedSet) || leftMoment) {
      const at = nextBoundary(cur.grid, now, leftMoment ? 1 : phraseBarsOf(cur.set), c.lookaheadSec);
      const outro = !!cur.set.stingers?.outro;
      out.push({ type: 'end', deck: cur.deck, at, duration: gridBarSec(cur.grid) * c.endFadeBars, outro });
      this.endAt = at;
      this.endIsFinal = true;
      this.note = leftMoment ? 'moment over: ending' : 'play window over: ending';
    }
    return out.slice();
  }

  private switchAllowed(now: number, target: MusicTarget, cur: MusicSetDef, want: MusicSetDef): boolean {
    const policy = target.policy;
    if (this.forcedSet) {
      return true;
    }
    if (policy === 'hold') {
      return false;
    }
    if (policy === 'moment' || policy === 'race') {
      return true;
    }
    if (cur.momentOnly) {
      return true; // back from a moment's own set
    }
    const margin = scoreSet(want, target.prefer, target.avoid) - scoreSet(cur, target.prefer, target.avoid);
    if (margin < this.config.switchMargin) {
      return false;
    }
    const played = now - (this.current?.startedAt ?? now);
    return played >= this.config.minSetSec || (policy === 'always' && this.stateChangedSinceStart);
  }

  private requestLoad(setId: string): void {
    if (this.waiting !== setId) {
      this.waiting = setId;
      this.out.push({ type: 'load', setId });
      this.note = `loading ${setId}`;
    }
  }

  private startDeck(set: MusicSetDef, at: number, now: number, intro: boolean, fadeIn: number): void {
    const introBars = intro ? (set.stingers?.intro?.bars ?? 1) : 0;
    const bar = (60 / set.bpm) * set.beatsPerBar;
    const loopAt = at + introBars * bar;
    const deck = ++this.deckSeq;
    this.out.push({ type: 'start', deck, setId: set.id, at, loopAt, fadeIn: intro ? 0.05 : fadeIn, intro });
    this.jitter.clear();
    this.current = { deck, set, grid: { anchor: loopAt, bpm: set.bpm, beatsPerBar: set.beatsPerBar, bars: set.bars }, startedAt: at };
    this.phase = 'playing';
    this.endAt = null;
    this.endIsFinal = false;
    this.stateChangedSinceStart = false;
    this.playUntil = Math.max(at, now) + this.rand(this.config.playMinSec, this.config.playMaxSec);
  }
}
