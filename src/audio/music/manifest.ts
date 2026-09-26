/**
 * Music data format (adaptive music, `.docs/audio/music-system.md`).
 *
 * The approved music lives in `public/audio/music/` next to `manifest.json`. A manifest lists SETS: one piece of music
 * each, cut into equal-length loopable STEMS that the adaptive mixer fades in and out with the flight. Every set
 * carries its tempo grid (bpm, beats per bar, loop length in bars, phrase length), tags the rules choose sets by, and
 * its credit (title, author, licence, source URL, approval date) for the credits and the moments source panel.
 *
 * Pure module (no WebAudio, no DOM): the validator runs in the headless check and at runtime before a set is used.
 */

/** The five stem roles the rules mix (a set may leave any out; `base` is required). */
export const STEM_ROLES = ['base', 'strings', 'motion', 'colour', 'air'] as const;
export type StemRole = (typeof STEM_ROLES)[number];

/** Stingers: one-shots played on the bar grid (set start / end, race start "Başla!" / finish). */
export const STINGER_KINDS = ['intro', 'outro', 'go', 'finish'] as const;
export type StingerKind = (typeof STINGER_KINDS)[number];

/**
 * Licences a set may carry: `original` = made or commissioned by the owner with commercial rights (e.g. a paid Suno
 * plan); the CC licences need the attribution text shown in the credits (CC0 does not, but the credit is kept).
 */
export const MUSIC_LICENCES = ['original', 'CC0-1.0', 'CC-BY-4.0', 'CC-BY-3.0'] as const;
export type MusicLicence = (typeof MUSIC_LICENCES)[number];

/** Known mood / situation tags (free-form tags are allowed too; these are the ones the default rules use). */
export const KNOWN_TAGS = ['day', 'night', 'calm', 'flight', 'perch', 'water', 'race', 'storm', 'fog', 'moment', 'dawn', 'dusk'] as const;

/**
 * One audio file in fallback order, paths relative to `public/audio/music/` (e.g. `["bogaz/base.opus",
 * "bogaz/base.m4a"]`). The player uses the first one the browser can decode.
 */
export type SourceList = readonly string[];

export interface StemDef {
  src: SourceList;
  /** Static level trim 0..2 (default 1): balances the stems of a set against each other. */
  gain?: number;
  /** Measured duration (s) of the file, written by the owner's tooling; checked against the grid when present. */
  durationSec?: number;
}

export interface StingerDef {
  src: SourceList;
  /** Length on the set's grid in bars (the loop starts this many bars after an intro). Default 1. */
  bars?: number;
  gain?: number;
  durationSec?: number;
}

export interface MusicCredit {
  /** Title as it should be shown (the original title; Turkish or English). */
  title: string;
  author: string;
  licence: MusicLicence;
  /** Where the track comes from (the CC page, the generation page); required for CC licences. */
  sourceUrl?: string;
  /** Attribution text shown in the credits (required for CC-BY). */
  attribution?: string;
}

export interface MusicSetDef {
  /** Stable id (lower-case, digits, dashes); also the folder name under public/audio/music/. */
  id: string;
  bpm: number;
  /** Meter numerator (beats per bar), e.g. 4 for 4/4, 3 for 3/4, 6 for 6/8 counted in eighths. */
  beatsPerBar: number;
  /** Loop length in bars (every stem is exactly this long). */
  bars: number;
  /** Bars per phrase: set changes and endings wait for a phrase boundary (default 4, must divide `bars`). */
  phraseBars?: number;
  /** Key or makam tag, e.g. "D major", "A minor", "makam:hicaz", "makam:rast". */
  key: string;
  /** Mood / situation tags the rules choose by (see KNOWN_TAGS). */
  tags: readonly string[];
  stems: Partial<Record<StemRole, StemDef>>;
  stingers?: Partial<Record<StingerKind, StingerDef>>;
  credit: MusicCredit;
  /** ISO date (YYYY-MM-DD) the owner approved the set (CLAUDE.md: every external asset is approved first). */
  approvedOn: string;
  /** Overall level trim of the set 0..2 (default 1). */
  gain?: number;
  /**
   * Only for moments: a set that plays only as a moment's own bed (MomentContent.musicId), never in the normal
   * rotation.
   */
  momentOnly?: boolean;
}

export interface MusicManifest {
  version: 1;
  sets: readonly MusicSetDef[];
}

export const EMPTY_MANIFEST: MusicManifest = { version: 1, sets: [] };

/** Base URL of the music files (Vite serves public/ at the root). */
export const MUSIC_BASE = 'audio/music/';

/** Seconds per bar and per loop. */
export function barSeconds(set: Pick<MusicSetDef, 'bpm' | 'beatsPerBar'>): number {
  return (60 / set.bpm) * set.beatsPerBar;
}
export function loopSeconds(set: Pick<MusicSetDef, 'bpm' | 'beatsPerBar' | 'bars'>): number {
  return barSeconds(set) * set.bars;
}
export function phraseBarsOf(set: Pick<MusicSetDef, 'phraseBars' | 'bars'>): number {
  return set.phraseBars ?? Math.min(4, set.bars);
}

/** Stems present in a set, in role order. */
export function stemsOf(set: MusicSetDef): StemRole[] {
  return STEM_ROLES.filter((r) => set.stems[r] !== undefined);
}

/** Credit line for the credits screen and the source panel (Turkish, player-facing). */
export function creditLine(set: MusicSetDef): string {
  const c = set.credit;
  const licence = c.licence === 'original' ? 'Seventeen Skies için özgün' : c.licence.replace(/-/g, ' ');
  return c.attribution ? `${c.attribution} (${licence})` : `“${c.title}”, ${c.author} (${licence})`;
}

/* ------------------------------------------------------------------ */
/* Validation                                                           */
/* ------------------------------------------------------------------ */

export interface ManifestIssue {
  /** Where: `sets[2].stems.base`, `sets[0].credit`... */
  path: string;
  message: string;
}

export interface ManifestReport {
  ok: boolean;
  errors: ManifestIssue[];
  warnings: ManifestIssue[];
  /** The manifest with invalid sets removed (a valid set is never dropped for another set's error). */
  manifest: MusicManifest;
}

export interface ValidateOptions {
  /** File check for a path relative to public/audio/music/ (the headless check uses fs; omit to skip). */
  exists?: (path: string) => boolean;
  /** Tolerance (s) for durations against the grid and against each other. Default 0.02 s (about a video frame). */
  toleranceSec?: number;
}

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const AUDIO_EXT_RE = /\.(opus|ogg|oga|webm|m4a|aac|mp3|flac|wav)$/i;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

/**
 * Validates a parsed manifest.json. Errors drop the offending set (the rest stays usable); warnings are advice
 * (unknown tags, missing measured durations, a set without optional stems).
 */
export function validateManifest(raw: unknown, opts: ValidateOptions = {}): ManifestReport {
  const errors: ManifestIssue[] = [];
  const warnings: ManifestIssue[] = [];
  const tol = opts.toleranceSec ?? 0.02;
  const good: MusicSetDef[] = [];
  if (!isObj(raw)) {
    errors.push({ path: '', message: 'manifest must be a JSON object' });
    return { ok: false, errors, warnings, manifest: EMPTY_MANIFEST };
  }
  if (raw.version !== 1) {
    errors.push({ path: 'version', message: 'version must be 1' });
  }
  if (!Array.isArray(raw.sets)) {
    errors.push({ path: 'sets', message: 'sets must be an array' });
    return { ok: false, errors, warnings, manifest: EMPTY_MANIFEST };
  }
  const ids = new Set<string>();
  raw.sets.forEach((s: unknown, i: number) => {
    const at = `sets[${i}]`;
    const before = errors.length;
    const err = (path: string, message: string): void => {
      errors.push({ path: `${at}${path}`, message });
    };
    const warn = (path: string, message: string): void => {
      warnings.push({ path: `${at}${path}`, message });
    };
    if (!isObj(s)) {
      err('', 'set must be an object');
      return;
    }
    if (!isStr(s.id) || !ID_RE.test(s.id)) {
      err('.id', 'id must be lower-case letters, digits and dashes');
    } else if (ids.has(s.id)) {
      err('.id', `duplicate id "${s.id}"`);
    } else {
      ids.add(s.id);
    }
    if (!isNum(s.bpm) || s.bpm < 30 || s.bpm > 240) {
      err('.bpm', 'bpm must be a number in 30..240');
    }
    if (!isNum(s.beatsPerBar) || !Number.isInteger(s.beatsPerBar) || s.beatsPerBar < 2 || s.beatsPerBar > 12) {
      err('.beatsPerBar', 'beatsPerBar must be an integer in 2..12');
    }
    if (!isNum(s.bars) || !Number.isInteger(s.bars) || s.bars < 1 || s.bars > 256) {
      err('.bars', 'bars must be an integer in 1..256');
    }
    if (s.phraseBars !== undefined && (!isNum(s.phraseBars) || !Number.isInteger(s.phraseBars) || s.phraseBars < 1 || (isNum(s.bars) && s.bars % s.phraseBars !== 0))) {
      err('.phraseBars', 'phraseBars must be a positive integer dividing bars');
    }
    if (!isStr(s.key)) {
      err('.key', 'key (or makam tag) is required');
    }
    if (!Array.isArray(s.tags) || s.tags.some((t) => !isStr(t))) {
      err('.tags', 'tags must be an array of strings');
    } else {
      for (const t of s.tags as string[]) {
        if (!(KNOWN_TAGS as readonly string[]).includes(t)) {
          warn('.tags', `unknown tag "${t}" (the default rules ignore it)`);
        }
      }
    }
    for (const g of ['gain'] as const) {
      if (s[g] !== undefined && (!isNum(s[g]) || (s[g] as number) < 0 || (s[g] as number) > 2)) {
        err(`.${g}`, 'gain must be in 0..2');
      }
    }
    if (!isStr(s.approvedOn) || !DATE_RE.test(s.approvedOn)) {
      err('.approvedOn', 'approvedOn (YYYY-MM-DD) is required: every music asset is approved by the owner first');
    }
    // Credit / licence.
    const c = s.credit;
    if (!isObj(c)) {
      err('.credit', 'credit {title, author, licence, sourceUrl?, attribution?} is required');
    } else {
      if (!isStr(c.title)) {
        err('.credit.title', 'title is required');
      }
      if (!isStr(c.author)) {
        err('.credit.author', 'author is required');
      }
      if (!isStr(c.licence) || !(MUSIC_LICENCES as readonly string[]).includes(c.licence)) {
        err('.credit.licence', `licence must be one of ${MUSIC_LICENCES.join(', ')}`);
      } else {
        if (c.licence !== 'original' && !isStr(c.sourceUrl)) {
          err('.credit.sourceUrl', 'sourceUrl is required for CC licences');
        }
        if (c.licence.startsWith('CC-BY') && !isStr(c.attribution)) {
          err('.credit.attribution', 'attribution text is required for CC-BY');
        }
      }
      if (c.sourceUrl !== undefined && (!isStr(c.sourceUrl) || !/^https:\/\//.test(c.sourceUrl))) {
        err('.credit.sourceUrl', 'sourceUrl must be an https URL');
      }
    }
    // Grid length.
    const gridOk = isNum(s.bpm) && isNum(s.beatsPerBar) && isNum(s.bars);
    const loop = gridOk ? loopSeconds(s as unknown as MusicSetDef) : NaN;
    if (gridOk && (loop < 4 || loop > 600)) {
      err('', `loop length ${loop.toFixed(2)} s is outside 4..600 s`);
    }
    const checkSources = (path: string, src: unknown): void => {
      if (!Array.isArray(src) || src.length === 0 || src.some((p) => !isStr(p))) {
        err(path, 'src must be a non-empty array of file paths');
        return;
      }
      for (const p of src as string[]) {
        if (p.startsWith('/') || p.includes('..') || /^[a-z]+:/i.test(p)) {
          err(path, `"${p}" must be a relative path inside public/audio/music/`);
        } else if (!AUDIO_EXT_RE.test(p)) {
          err(path, `"${p}" is not an audio file (opus, ogg, m4a, mp3...)`);
        } else if (opts.exists && !opts.exists(p)) {
          err(path, `file "${p}" does not exist`);
        }
      }
    };
    // Stems.
    const stems = s.stems;
    if (!isObj(stems)) {
      err('.stems', 'stems must be an object keyed by role');
    } else {
      if (stems.base === undefined) {
        err('.stems.base', 'the base stem is required');
      }
      const durations: Array<[string, number]> = [];
      for (const [role, def] of Object.entries(stems)) {
        const p = `.stems.${role}`;
        if (!(STEM_ROLES as readonly string[]).includes(role)) {
          err(p, `unknown stem role "${role}" (${STEM_ROLES.join(', ')})`);
          continue;
        }
        if (!isObj(def)) {
          err(p, 'stem must be an object {src, gain?, durationSec?}');
          continue;
        }
        checkSources(`${p}.src`, def.src);
        if (def.gain !== undefined && (!isNum(def.gain) || def.gain < 0 || def.gain > 2)) {
          err(`${p}.gain`, 'gain must be in 0..2');
        }
        if (def.durationSec !== undefined) {
          if (!isNum(def.durationSec)) {
            err(`${p}.durationSec`, 'durationSec must be a number');
          } else {
            durations.push([role, def.durationSec]);
            if (gridOk && Math.abs(def.durationSec - loop) > tol) {
              err(`${p}.durationSec`, `${def.durationSec.toFixed(3)} s does not match the grid (${s.bars} bars at ${s.bpm} bpm = ${loop.toFixed(3)} s)`);
            }
          }
        } else {
          warn(`${p}.durationSec`, 'no measured duration: equal length is checked only after decoding');
        }
      }
      for (let k = 1; k < durations.length; k++) {
        if (Math.abs(durations[k][1] - durations[0][1]) > tol) {
          err('.stems', `stem lengths differ: ${durations[0][0]} ${durations[0][1]} s vs ${durations[k][0]} ${durations[k][1]} s`);
          break;
        }
      }
      if (Object.keys(stems).length < 2) {
        warn('.stems', 'a single stem cannot adapt (only its level follows the flight)');
      }
    }
    // Stingers.
    if (s.stingers !== undefined) {
      if (!isObj(s.stingers)) {
        err('.stingers', 'stingers must be an object keyed by kind');
      } else {
        for (const [kind, def] of Object.entries(s.stingers)) {
          const p = `.stingers.${kind}`;
          if (!(STINGER_KINDS as readonly string[]).includes(kind)) {
            err(p, `unknown stinger "${kind}" (${STINGER_KINDS.join(', ')})`);
            continue;
          }
          if (!isObj(def)) {
            err(p, 'stinger must be an object {src, bars?, gain?}');
            continue;
          }
          checkSources(`${p}.src`, def.src);
          if (def.bars !== undefined && (!isNum(def.bars) || !Number.isInteger(def.bars) || def.bars < 1 || def.bars > 16)) {
            err(`${p}.bars`, 'bars must be an integer in 1..16');
          }
          if (def.gain !== undefined && (!isNum(def.gain) || def.gain < 0 || def.gain > 2)) {
            err(`${p}.gain`, 'gain must be in 0..2');
          }
        }
      }
    }
    if (errors.length === before) {
      good.push(s as unknown as MusicSetDef);
    }
  });
  return { ok: errors.length === 0, errors, warnings, manifest: { version: 1, sets: good } };
}

/**
 * Checks decoded stem lengths (s) of a set after loading: all equal to the grid loop within `toleranceSec` (a file
 * may carry a short silent tail from the encoder: up to `tailSec` longer is accepted, the loop point is the grid).
 * Returns the problems (empty = fine).
 */
export function checkDecodedLengths(set: MusicSetDef, lengths: Partial<Record<StemRole, number>>, toleranceSec = 0.03, tailSec = 0.1): string[] {
  const loop = loopSeconds(set);
  const out: string[] = [];
  for (const role of stemsOf(set)) {
    const len = lengths[role];
    if (len === undefined) {
      out.push(`${role}: not decoded`);
    } else if (len < loop - toleranceSec || len > loop + tailSec) {
      out.push(`${role}: ${len.toFixed(3)} s, the grid loop is ${loop.toFixed(3)} s`);
    }
  }
  return out;
}

/**
 * Picks the first source the browser can decode. `canPlay(mime)` wraps HTMLMediaElement.canPlayType (returns
 * true for "probably"/"maybe").
 */
export function pickSource(src: SourceList, canPlay: (mime: string) => boolean): string | null {
  for (const p of src) {
    const mime = mimeOf(p);
    if (!mime || canPlay(mime)) {
      return p;
    }
  }
  return null;
}

export function mimeOf(path: string): string | null {
  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase();
  switch (ext) {
    case 'opus':
      return 'audio/ogg; codecs=opus';
    case 'ogg':
    case 'oga':
      return 'audio/ogg; codecs=vorbis';
    case 'webm':
      return 'audio/webm; codecs=opus';
    case 'm4a':
    case 'aac':
      return 'audio/mp4; codecs=mp4a.40.2';
    case 'mp3':
      return 'audio/mpeg';
    case 'flac':
      return 'audio/flac';
    case 'wav':
      return 'audio/wav';
    default:
      return null;
  }
}
