/**
 * Moment sources ("Kaynak", phase 19): the original works behind a moment (a poem's text, a scan, the rights holder's
 * official video...) and the pure logic around them. No DOM and no three.js here: the data rules (validation, what
 * may be embedded), the embed URLs, and the window in which the "[I] Kaynağa bak" prompt is offered.
 *
 * Approval (CLAUDE.md, external assets): every item carries `approved`. Only an approved item that validates is
 * embedded in the game (a YouTube player, an image). An unapproved item is still listed in the source sheet, but only
 * as a plain external link with its domain ("Tarayıcıda aç"), never embedded, so nothing from it is loaded by the game.
 * Nothing third-party is requested before the player opens the source sheet.
 */
import type { Moment, MomentSource, MomentSourceEmbed, MomentSourceKind } from './types';

/** Seconds the prompt stays after a moment ends (its closing card shows 9 s; the prompt outlives it a little). */
export const SOURCE_PROMPT_AFTER_S = 10;

/** Hosts an approved image embed may load from (direct file URLs of open collections). */
export const IMAGE_EMBED_HOSTS: readonly string[] = ['upload.wikimedia.org'];

/** Host of every video embed: YouTube's privacy-enhanced player (no cookies until the player is used). */
export const YOUTUBE_EMBED_HOST = 'www.youtube-nocookie.com';

const KINDS: readonly MomentSourceKind[] = ['text', 'image', 'video', 'audio', 'link'];
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

/** The parsed URL when `raw` is an absolute https URL, else null. */
function httpsUrl(raw: string | undefined): URL | null {
  if (!raw) {
    return null;
  }
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && !!u.hostname ? u : null;
  } catch {
    return null;
  }
}

function validateEmbed(kind: MomentSourceKind, e: MomentSourceEmbed): string[] {
  const errors: string[] = [];
  if (e.kind === 'youtube') {
    if (kind !== 'video') {
      errors.push(`a YouTube embed needs kind 'video' (got '${kind}')`);
    }
    if (!YOUTUBE_ID.test(e.videoId)) {
      errors.push(`invalid YouTube video id '${e.videoId}' (11 characters: letters, digits, - and _)`);
    }
    const secs = (v: number | undefined): boolean => v === undefined || (Number.isInteger(v) && v >= 0);
    if (!secs(e.startSec) || !secs(e.endSec)) {
      errors.push('YouTube start / end must be whole seconds ≥ 0');
    } else if (e.startSec !== undefined && e.endSec !== undefined && e.endSec <= e.startSec) {
      errors.push('YouTube end must come after start');
    }
  } else if (e.kind === 'image') {
    if (kind !== 'image') {
      errors.push(`an image embed needs kind 'image' (got '${kind}')`);
    }
    const src = httpsUrl(e.src);
    if (!src) {
      errors.push('image embed src must be an https URL');
    } else if (!IMAGE_EMBED_HOSTS.includes(src.hostname)) {
      errors.push(`image embed host ${src.hostname} is not allowed (${IMAGE_EMBED_HOSTS.join(', ')})`);
    }
    if (!(e.width > 0 && e.height > 0)) {
      errors.push('image embed needs its width and height in pixels');
    }
  } else {
    errors.push(`unknown embed kind '${(e as { kind: string }).kind}'`);
  }
  return errors;
}

/**
 * Problems with one source item (empty when it is fine):
 * - a known kind, a Turkish title and an absolute https URL;
 * - approved items need `attribution` and `licence`;
 * - an embed must fit its kind: a YouTube embed (kind 'video') needs a valid 11-character id and sane seconds, an
 *   image embed (kind 'image') an https file on an allowed host and its size.
 * An unapproved item may carry a prepared embed; it is never used until the owner approves the item.
 */
export function validateSource(s: MomentSource): string[] {
  const errors: string[] = [];
  if (!KINDS.includes(s.kind)) {
    errors.push(`unknown kind '${s.kind}'`);
  }
  if (!s.title?.trim()) {
    errors.push('missing title');
  }
  if (!httpsUrl(s.url)) {
    errors.push(`url must be an absolute https URL (${s.url})`);
  }
  if (typeof s.approved !== 'boolean') {
    errors.push('approved must be true or false');
  }
  if (s.approved) {
    if (!s.attribution?.trim()) {
      errors.push('an approved source needs its attribution');
    }
    if (!s.licence?.trim()) {
      errors.push('an approved source needs its licence');
    }
  }
  if (s.embed) {
    errors.push(...validateEmbed(s.kind, s.embed));
  }
  return errors;
}

/** Every problem of a moment's sources, prefixed with the item's index and title. */
export function validateMomentSources(m: Moment): string[] {
  const out: string[] = [];
  (m.sources ?? []).forEach((s, i) => {
    for (const e of validateSource(s)) {
      out.push(`${m.id} sources[${i}] "${s.title}": ${e}`);
    }
  });
  return out;
}

/** The embed to show in the game, or null: only approved, valid items are ever embedded. */
export function sourceEmbed(s: MomentSource): MomentSourceEmbed | null {
  return s.approved && s.embed && validateSource(s).length === 0 ? s.embed : null;
}

/**
 * The sources the sheet lists: every item that validates as a link (kind, title, https URL). Approved items with an
 * embed are embedded; all others (unapproved ones included) show as external links only.
 */
export function visibleSources(m: Moment): MomentSource[] {
  return (m.sources ?? []).filter((s) => KINDS.includes(s.kind) && !!s.title?.trim() && !!httpsUrl(s.url));
}

/** Does the moment have anything to show behind "Kaynağa bak"? */
export function hasSources(m: Moment): boolean {
  return visibleSources(m).length > 0;
}

/** The domain shown next to a link, so the player knows where it goes ("tr.wikisource.org"). */
export function sourceDomain(url: string): string {
  const u = httpsUrl(url);
  return u ? u.hostname.replace(/^www\./, '') : '';
}

/**
 * The privacy-enhanced YouTube player URL for an embed: no autoplay (the player starts only when the viewer clicks
 * it), related videos from the same channel, start / end seconds when given.
 */
export function youtubeEmbedUrl(e: Extract<MomentSourceEmbed, { kind: 'youtube' }>): string {
  const q = new URLSearchParams({ rel: '0', playsinline: '1', modestbranding: '1' });
  if (e.startSec !== undefined) {
    q.set('start', String(e.startSec));
  }
  if (e.endSec !== undefined) {
    q.set('end', String(e.endSec));
  }
  return `https://${YOUTUBE_EMBED_HOST}/embed/${encodeURIComponent(e.videoId)}?${q.toString()}`;
}

/** The quoted excerpt as the player heard it: the subtitle lines in order, one per line. */
export function momentExcerpt(m: Moment): string[] {
  return [...m.content.subtitles].sort((a, b) => a.at - b.at).map((l) => (l.speaker ? `${l.speaker}: ${l.text}` : l.text));
}

/** The author / date line of the source sheet, from the text provenance of the subtitles ("Orhan Veli Kanık (1914–1950)"). */
export function momentAuthorLine(m: Moment): string {
  const p = m.provenance.find((x) => x.covers === 'subtitles' && x.kind === 'public-domain') ?? null;
  return p?.author ?? '';
}

/* ------------------------------------------------------------------ */
/* When the prompt is offered                                           */
/* ------------------------------------------------------------------ */

export type SourcePromptState =
  /** While the moment's subtitles play: the prompt rides under the subtitle line. */
  | { moment: Moment; phase: 'playing' }
  /** For SOURCE_PROMPT_AFTER_S after the moment ended: a quiet item of the hint line. */
  | { moment: Moment; phase: 'after'; remaining: number }
  | null;

/**
 * Decides, frame by frame, whether "[I] Kaynağa bak" is offered and for which moment: while a moment with sources
 * plays and for `afterSec` after it ends. Never during a race (a race also ends the window after a moment). Paused
 * frames (dt = 0) change nothing.
 */
export class SourcePromptWindow {
  private last: Moment | null = null;
  private after: Moment | null = null;
  private remaining = 0;
  private state: SourcePromptState = null;

  constructor(readonly afterSec = SOURCE_PROMPT_AFTER_S) {}

  get current(): SourcePromptState {
    return this.state;
  }

  update(dt: number, playing: Moment | null, racing: boolean): SourcePromptState {
    if (!(dt > 0)) {
      return this.state;
    }
    if (racing) {
      this.last = playing;
      this.after = null;
      this.state = null;
      return null;
    }
    if (playing) {
      this.last = playing;
      this.after = null;
      this.state = hasSources(playing) ? { moment: playing, phase: 'playing' } : null;
      return this.state;
    }
    if (this.last) {
      // The moment ended this frame: the window after it starts now.
      this.after = hasSources(this.last) ? this.last : null;
      this.remaining = this.afterSec;
      this.last = null;
    } else if (this.after) {
      this.remaining -= dt;
      if (this.remaining <= 1e-9) {
        this.after = null;
      }
    }
    this.state = this.after ? { moment: this.after, phase: 'after', remaining: this.remaining } : null;
    return this.state;
  }
}
