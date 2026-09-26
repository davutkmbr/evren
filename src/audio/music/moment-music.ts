/**
 * Moment music (pure, fake-clock friendly): while a moment plays (a poem, a quotation, a historical memory) one
 * emotional piece — a manifest phrase with `role: "moment"`, 40–120 s, one or two instruments — plays once under the
 * subtitles.
 *
 *   choice    the moment's `musicId` when it names a piece; otherwise the best tag match for the moment's category and
 *             `musicMood` (at least one category / mood tag must match, else the moment keeps the plain duck)
 *   variety   never the same piece for two moments in a row (unless a moment names it)
 *   playback  fade in over MOMENT_MUSIC_DEFAULTS.fadeInSec; a piece shorter than the moment ends on its own (its file
 *             tail plus a short edge fade), never looped; when the moment ends first it fades out over `endFadeSec`
 *
 * The rules duck the world music strongly during every moment (rules.ts, `moment`), the sprinkle director holds, and
 * the player plays the piece on its own un-ducked branch of the music bus (volume and menu duck still apply).
 * It emits the same load / play / stop commands as the sprinkle director.
 */
import { roleOf, type MusicPhraseDef } from './manifest';
import { TIME_TAGS, type SprinkleCommand } from './sprinkle';

export interface MomentMusicConfig {
  /** Fade-in of the piece (s). */
  fadeInSec: number;
  /** Fade-out when the moment ends before the piece (s). */
  endFadeSec: number;
  /** Edge fade over the last seconds of a piece that ends on its own (the file carries its own tail). */
  tailFadeSec: number;
  /** A piece that takes longer than this to decode is dropped (the moment keeps the plain duck). */
  maxWaitSec: number;
  lookaheadSec: number;
  /** Score per tag: the moment's category, each `musicMood` tag, the time of day. */
  categoryWeight: number;
  moodWeight: number;
  timeWeight: number;
  /** A piece whose time-of-day tags all miss the current time loses this much. */
  timeMissPenalty: number;
  /** Minimum score of a chosen piece (one category or mood match). */
  minScore: number;
}

export const MOMENT_MUSIC_DEFAULTS: MomentMusicConfig = {
  fadeInSec: 2.5,
  endFadeSec: 3.5,
  tailFadeSec: 2,
  maxWaitSec: 8,
  lookaheadSec: 0.1,
  categoryWeight: 3,
  moodWeight: 2,
  timeWeight: 1,
  timeMissPenalty: 2,
  minScore: 2,
};

/** What the moments system tells the music about the moment that plays (see AudioService.setMomentMusic). */
export interface MomentMusicRequest {
  active: boolean;
  /** Counts moment starts: a new value is a new moment (even without an inactive frame between two). */
  seq: number;
  /** MomentContent.musicId (a set id is handled by the stem director, not here). */
  musicId: string | null;
  /** Moment category ('poem', 'legend', 'city-life'). */
  category: string | null;
  /** MomentContent.musicMood tags. */
  mood: readonly string[];
  /** Current time-of-day tags ('day' / 'night', 'dawn', 'dusk'). */
  time: readonly string[];
}

export const NO_MOMENT: MomentMusicRequest = { active: false, seq: 0, musicId: null, category: null, mood: [], time: [] };

/** Tag score of a moment piece for a request (pure). */
export function scoreMomentPiece(p: Pick<MusicPhraseDef, 'tags'>, req: MomentMusicRequest, cfg: MomentMusicConfig = MOMENT_MUSIC_DEFAULTS): number {
  let s = 0;
  if (req.category && p.tags.includes(req.category)) {
    s += cfg.categoryWeight;
  }
  for (const m of new Set(req.mood)) {
    if (m !== req.category && p.tags.includes(m)) {
      s += cfg.moodWeight;
    }
  }
  const times = p.tags.filter((t) => TIME_TAGS.includes(t));
  if (times.length > 0) {
    s += times.some((t) => req.time.includes(t)) ? cfg.timeWeight : -cfg.timeMissPenalty;
  }
  return s;
}

export interface MomentPiecePick {
  piece: MusicPhraseDef | null;
  why: string;
}

/**
 * The piece for a moment (pure but for `random`, which breaks ties): the named one, else the best-scoring moment piece
 * other than the last one (at least `minScore`).
 */
export function chooseMomentPiece(
  phrases: readonly MusicPhraseDef[],
  req: MomentMusicRequest,
  lastId: string | null,
  random: () => number,
  cfg: MomentMusicConfig = MOMENT_MUSIC_DEFAULTS,
): MomentPiecePick {
  const pieces = phrases.filter((p) => roleOf(p) === 'moment');
  if (req.musicId) {
    const named = pieces.find((p) => p.id === req.musicId);
    if (named) {
      return { piece: named, why: 'named by the moment' };
    }
  }
  if (pieces.length === 0) {
    return { piece: null, why: 'no moment pieces' };
  }
  let best: MusicPhraseDef[] = [];
  let bestScore = -Infinity;
  for (const p of pieces) {
    if (p.id === lastId && pieces.length > 1) {
      continue;
    }
    const s = scoreMomentPiece(p, req, cfg);
    if (s > bestScore) {
      bestScore = s;
      best = [p];
    } else if (s === bestScore) {
      best.push(p);
    }
  }
  if (best.length === 0 || bestScore < cfg.minScore) {
    return { piece: null, why: 'no piece matches the moment' };
  }
  if (best.length === 1 && best[0].id === lastId) {
    return { piece: null, why: 'only the last piece matches' };
  }
  return { piece: best[Math.min(best.length - 1, Math.floor(random() * best.length))], why: `score ${bestScore}` };
}

export interface MomentMusicWorld {
  phrases: readonly MusicPhraseDef[];
  isReady(phraseId: string): boolean;
}

export interface MomentMusicView {
  /** Piece playing now (also while fading out after the moment). */
  current: string | null;
  endsAt: number | null;
  /** Piece waiting for its audio. */
  pending: string | null;
  last: string | null;
  note: string;
}

export class MomentMusicDirector {
  private seq = 0;
  private current: { voice: number; piece: MusicPhraseDef; endsAt: number } | null = null;
  private pending: { piece: MusicPhraseDef; since: number; loadSent: boolean } | null = null;
  private lastId: string | null = null;
  private voiceSeq = 0;
  private note = 'idle';
  private readonly out: SprinkleCommand[] = [];

  constructor(
    readonly config: MomentMusicConfig = MOMENT_MUSIC_DEFAULTS,
    private readonly random: () => number = Math.random,
  ) {}

  get view(): MomentMusicView {
    return { current: this.current?.piece.id ?? null, endsAt: this.current?.endsAt ?? null, pending: this.pending?.piece.id ?? null, last: this.lastId, note: this.note };
  }

  /** A piece is audible now (the sprinkle director holds anyway during moments; the debug overlay shows it). */
  get playing(): boolean {
    return this.current !== null;
  }

  shift(dt: number): void {
    if (this.current) {
      this.current.endsAt += dt;
    }
    if (this.pending) {
      this.pending.since += dt;
    }
  }

  private fadeOut(now: number, note: string): void {
    if (this.current) {
      if (now < this.current.endsAt - this.config.tailFadeSec) {
        this.out.push({ type: 'stop', voice: this.current.voice, at: now, fade: this.config.endFadeSec });
      }
      this.current = null;
    }
    this.note = note;
  }

  tick(now: number, req: MomentMusicRequest, world: MomentMusicWorld): SprinkleCommand[] {
    const c = this.config;
    const out = this.out;
    out.length = 0;
    if (this.current && now >= this.current.endsAt) {
      this.current = null;
      this.note = 'piece ended on its own';
    }
    if (req.active && req.seq !== this.seq) {
      // A new moment: whatever still sounds from the last one fades, then this moment's piece is chosen.
      this.seq = req.seq;
      this.fadeOut(now, 'new moment');
      const pick = chooseMomentPiece(world.phrases, req, this.lastId, this.random, c);
      this.pending = pick.piece ? { piece: pick.piece, since: now, loadSent: false } : null;
      this.note = pick.piece ? `chose ${pick.piece.id} (${pick.why})` : pick.why;
    }
    if (!req.active) {
      this.pending = null;
      if (this.current) {
        this.fadeOut(now, 'moment over: fading out');
      }
      return out.slice();
    }
    const p = this.pending;
    if (!p) {
      return out.slice();
    }
    if (!world.isReady(p.piece.id)) {
      if (!p.loadSent) {
        p.loadSent = true;
        out.push({ type: 'load', phraseId: p.piece.id });
      }
      if (now - p.since > c.maxWaitSec) {
        this.pending = null;
        this.note = `${p.piece.id} decoded too slowly: dropped`;
      } else {
        this.note = `loading ${p.piece.id}`;
      }
      return out.slice();
    }
    const at = now + c.lookaheadSec;
    const voice = ++this.voiceSeq;
    const d = p.piece.durationSec;
    out.push({ type: 'play', voice, phraseId: p.piece.id, at, duration: d, fadeIn: Math.min(c.fadeInSec, d / 4), fadeOut: Math.min(c.tailFadeSec, d / 4) });
    this.current = { voice, piece: p.piece, endsAt: at + d };
    this.lastId = p.piece.id;
    this.pending = null;
    this.note = `play ${p.piece.id}`;
    return out.slice();
  }
}
