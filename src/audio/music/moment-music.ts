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
 *   sources   the piece is never heard "directly" (./moment-source.ts, ./source-graph.ts): a moment with a world source
 *             (gramophone, venue, live, ferry) starts its piece as a world sound before the moment (the lead-in, when the
 *             player comes within the source's reach), keeps it under the subtitles, and afterwards lets it sink back
 *             into the world until the player leaves; a memory moment fades it out at the end as before
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
  /** Fade-in of a lead-in piece (s): slow, it starts far away anyway. */
  leadFadeInSec: number;
  /** Fade-out when the player leaves a world source (s). */
  leaveFadeSec: number;
  /** A source whose music stopped does not lead in again for this long (s). */
  leadCooldownSec: number;
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
  leadFadeInSec: 4,
  leaveFadeSec: 3,
  leadCooldownSec: 240,
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
  /** The moment's id: a lead-in piece of the same moment carries on instead of a new choice. */
  momentId?: string | null;
  /** The moment's music follows a world source now (not a memory): after the moment it sinks back into the world. */
  world?: boolean;
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

/** Where the playing moment piece stands: before its moment (lead-in), under it, or back in the world after it. */
export type MomentVoicePhase = 'lead' | 'moment' | 'world';

/** A world source within reach while no moment plays: its piece may start before the moment (the lead-in). */
export interface LeadInRequest {
  momentId: string;
  musicId: string | null;
  category: string | null;
  mood: readonly string[];
}

/** What the source side (moment-source.ts, via the controller) tells the director every frame. */
export interface MomentSourceState {
  /** A world source within its reach that may lead in (null: none, or a moment plays). */
  lead: LeadInRequest | null;
  /** The current voice's world source is still within its release distance. */
  inReach: boolean;
}

export const NO_SOURCE: MomentSourceState = { lead: null, inReach: false };

export interface MomentMusicView {
  /** Piece playing now (also while fading out after the moment). */
  current: string | null;
  endsAt: number | null;
  /** Moment the playing piece belongs to, and where it stands. */
  momentId: string | null;
  phase: MomentVoicePhase | null;
  /** Piece waiting for its audio. */
  pending: string | null;
  last: string | null;
  note: string;
}

interface CurrentVoice {
  voice: number;
  piece: MusicPhraseDef;
  endsAt: number;
  momentId: string | null;
  phase: MomentVoicePhase;
}

interface PendingPiece {
  piece: MusicPhraseDef;
  since: number;
  loadSent: boolean;
  momentId: string | null;
  phase: MomentVoicePhase;
}

export class MomentMusicDirector {
  private seq = 0;
  private current: CurrentVoice | null = null;
  private pending: PendingPiece | null = null;
  private lastId: string | null = null;
  private voiceSeq = 0;
  private note = 'idle';
  /** The last active request said the moment's music follows a world source (it sinks back into the world at the end). */
  private lastWorld = false;
  /** When a source's music last stopped (s), by moment id: no new lead-in within `leadCooldownSec`. */
  private readonly stoppedAt = new Map<string, number>();
  private readonly out: SprinkleCommand[] = [];

  constructor(
    readonly config: MomentMusicConfig = MOMENT_MUSIC_DEFAULTS,
    private readonly random: () => number = Math.random,
  ) {}

  get view(): MomentMusicView {
    const c = this.current;
    return { current: c?.piece.id ?? null, endsAt: c?.endsAt ?? null, momentId: c?.momentId ?? null, phase: c?.phase ?? null, pending: this.pending?.piece.id ?? null, last: this.lastId, note: this.note };
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
    for (const [k, v] of this.stoppedAt) {
      this.stoppedAt.set(k, v + dt);
    }
  }

  private fadeOut(now: number, note: string, fade = this.config.endFadeSec): void {
    const c = this.current;
    if (c) {
      if (now < c.endsAt - this.config.tailFadeSec) {
        this.out.push({ type: 'stop', voice: c.voice, at: now, fade });
      }
      if (c.momentId) {
        this.stoppedAt.set(c.momentId, now);
      }
      this.current = null;
    }
    this.note = note;
  }

  private cooling(momentId: string, now: number): boolean {
    const t = this.stoppedAt.get(momentId);
    return t !== undefined && now - t < this.config.leadCooldownSec;
  }

  tick(now: number, req: MomentMusicRequest, world: MomentMusicWorld, src: MomentSourceState = NO_SOURCE): SprinkleCommand[] {
    const c = this.config;
    const out = this.out;
    out.length = 0;
    const cur = this.current;
    if (cur && now >= cur.endsAt) {
      if (cur.momentId) {
        this.stoppedAt.set(cur.momentId, now);
      }
      this.current = null;
      this.note = 'piece ended on its own';
    }
    const momentId = req.momentId ?? null;
    if (req.active && req.seq !== this.seq) {
      this.seq = req.seq;
      const lead = this.current;
      if (lead && momentId !== null && lead.momentId === momentId && lead.phase !== 'moment') {
        // The lead-in (or the world sound of this moment) was already playing: it carries on under the subtitles.
        lead.phase = 'moment';
        this.pending = null;
        this.note = `lead-in ${lead.piece.id} continues under the moment`;
      } else {
        // A new moment: whatever still sounds fades, then this moment's piece is chosen.
        this.fadeOut(now, 'new moment');
        const pick = chooseMomentPiece(world.phrases, req, this.lastId, this.random, c);
        this.pending = pick.piece ? { piece: pick.piece, since: now, loadSent: false, momentId, phase: 'moment' } : null;
        this.note = pick.piece ? `chose ${pick.piece.id} (${pick.why})` : pick.why;
      }
    }
    if (req.active) {
      this.lastWorld = !!req.world;
    } else {
      if (this.pending?.phase === 'moment') {
        this.pending = null;
      }
      const v = this.current;
      if (v?.phase === 'moment') {
        if (this.lastWorld) {
          // The moment is over: its music sinks back into the world and fades as the player leaves.
          v.phase = 'world';
          this.note = 'moment over: back in the world';
        } else {
          this.fadeOut(now, 'moment over: fading out');
        }
      }
      if (this.current && this.current.phase !== 'moment' && !src.inReach) {
        this.fadeOut(now, 'left the source', c.leaveFadeSec);
      }
      if (!this.current) {
        const lead = src.lead;
        if (this.pending?.phase === 'lead' && this.pending.momentId !== lead?.momentId) {
          this.pending = null;
          this.note = 'lead-in source out of reach';
        }
        if (!this.pending && lead && !this.cooling(lead.momentId, now)) {
          const pick = chooseMomentPiece(world.phrases, { active: true, seq: this.seq, musicId: lead.musicId, category: lead.category, mood: lead.mood, time: req.time }, this.lastId, this.random, c);
          if (pick.piece) {
            this.pending = { piece: pick.piece, since: now, loadSent: false, momentId: lead.momentId, phase: 'lead' };
            this.note = `lead-in ${pick.piece.id} for ${lead.momentId} (${pick.why})`;
          } else {
            // Nothing fits: remember it, so the choice is not retried every frame.
            this.stoppedAt.set(lead.momentId, now);
            this.note = `no lead-in piece for ${lead.momentId}: ${pick.why}`;
          }
        }
      }
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
        if (p.momentId) {
          this.stoppedAt.set(p.momentId, now);
        }
        this.note = `${p.piece.id} decoded too slowly: dropped`;
      } else {
        this.note = `loading ${p.piece.id}`;
      }
      return out.slice();
    }
    const at = now + c.lookaheadSec;
    const voice = ++this.voiceSeq;
    const d = p.piece.durationSec;
    // A lead-in fades in slowly: the distance does the rest (it starts faint, far away).
    const fadeIn = Math.min(p.phase === 'lead' ? c.leadFadeInSec : c.fadeInSec, d / 4);
    out.push({ type: 'play', voice, phraseId: p.piece.id, at, duration: d, fadeIn, fadeOut: Math.min(c.tailFadeSec, d / 4) });
    this.current = { voice, piece: p.piece, endsAt: at + d, momentId: p.momentId, phase: p.phase };
    this.lastId = p.piece.id;
    this.pending = null;
    this.note = `play ${p.piece.id}${p.phase === 'lead' ? ' (lead-in)' : ''}`;
    return out.slice();
  }
}
