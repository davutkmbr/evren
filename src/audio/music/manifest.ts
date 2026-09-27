/**
 * Music data format (adaptive music, `.docs/audio/music-system.md`).
 *
 * The approved music lives in `public/audio/music/` next to `manifest.json`. A manifest lists SETS: one piece of music
 * each, cut into equal-length loopable STEMS that the adaptive mixer fades in and out with the flight. Every set
 * carries its tempo grid (bpm, beats per bar, loop length in bars, phrase length), tags the rules choose sets by, and
 * its credit (title, author, licence, source URL, approval date) for the credits and the moments source panel.
 *
 * Next to the sets, a manifest may list PHRASES: one-shot files played once, never looped. Role `sprinkle` (default):
 * short single-instrument phrases (a ney breath, a few kanun notes) that the sprinkle director (./sprinkle.ts) scatters
 * over long silences, chosen by context tags. Role `moment`: a longer, emotional piece (40–120 s, one or two
 * instruments) that plays under a moment's subtitles (./moment-music.ts), chosen by the moment's id, category and mood.
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
 * `public-domain`: a historic recording free in the US and in Turkey (the 78 rpm archive, .docs/assets/archive-78rpm.md).
 * `public-domain-tr`: free in Turkey but still protected in the US; such pieces never ship from public/ and live only in
 * the private manifest (private-assets/audio/moments/, .docs/assets/private-assets.md). Both need `sourceUrl` and the
 * full `attribution` (performer, label, year, archive).
 */
export const MUSIC_LICENCES = ['original', 'CC0-1.0', 'CC-BY-4.0', 'CC-BY-3.0', 'public-domain', 'public-domain-tr'] as const;
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

/** What a phrase is for: a sprinkle over the world, or a moment's piece under its subtitles. */
export const PHRASE_ROLES = ['sprinkle', 'moment'] as const;
export type PhraseRole = (typeof PHRASE_ROLES)[number];

/**
 * Mood tags of moment pieces (free-form tags are allowed too): the moment categories (`poem`, `legend`, `city-life`)
 * and the moods a moment's `musicMood` may ask for.
 */
export const MOMENT_MUSIC_TAGS = ['poem', 'legend', 'city-life', 'history', 'nostalgic', 'sea', 'night', 'day', 'dawn', 'dusk', 'tender', 'joyful', 'solemn', 'mystic'] as const;

/**
 * A one-shot phrase. Role `sprinkle` (default): one short, sparse, single-instrument phrase (20–40 s with a silent head
 * and tail), played now and then over the world sound in sprinkle mode ("Müzik tarzı: Seyrek"). Role `moment`: one
 * emotional piece (40–120 s) played once under a moment.
 */
/** The two versions of a restored historic recording: the default is chosen per piece (`MusicPhraseDef.variant`). */
export const PHRASE_VARIANTS = ['denoised', 'raw'] as const;
export type PhraseVariant = (typeof PHRASE_VARIANTS)[number];

/** One alternative version of a phrase's file (same cut, other processing). */
export interface PhraseVariantDef {
  src: SourceList;
  /** Measured integrated loudness of this version (LUFS). */
  lufs?: number;
}

export interface MusicPhraseDef {
  /** Stable id (lower-case, digits, dashes); files in public/audio/music/phrases/<id>.* (moment pieces: moments/<id>.*). */
  id: string;
  /** Default `sprinkle`. */
  role?: PhraseRole;
  /** Fallback order, like stems: `["phrases/ney-sabah-1.opus", "phrases/ney-sabah-1.m4a"]`. */
  src: SourceList;
  /** Measured length of the file (s), required: the scheduler plans the fade-out and the next gap with it. */
  durationSec: number;
  /**
   * Instrument family ("ney", "kanun", "oud", "tanbur"...): the same family never plays twice in a row if avoidable.
   * Required for sprinkles, optional for moment pieces.
   */
  family?: string;
  /**
   * Sprinkles: context tags (KNOWN_TAGS); time of day (`day`, `night`, `dawn`, `dusk`) restricts, the others weight
   * the choice. Moment pieces: mood tags (MOMENT_MUSIC_TAGS) matched against the moment's category and `musicMood`.
   */
  tags: readonly string[];
  /** Level trim 0..2 (default 1), applied after the loudness correction. */
  gain?: number;
  /**
   * Measured integrated loudness of the file (LUFS, e.g. -19.5). When present the player corrects the phrase to
   * PHRASE_TARGET_LUFS so a quiet ney and a bright kanun sit at the same level.
   */
  lufs?: number;
  credit: MusicCredit;
  /** ISO date (YYYY-MM-DD) the owner approved the phrase. */
  approvedOn: string;
  /**
   * Restored historic recordings: which version `src` / `lufs` hold (the default, chosen from the restoration metrics),
   * and every version by name. `?music=raw` or `?music=denoised` plays the other one for A/B listening
   * (applyPhraseVariant).
   */
  variant?: PhraseVariant;
  variants?: Partial<Record<PhraseVariant, PhraseVariantDef>>;
}

export interface MusicManifest {
  version: 1;
  sets: readonly MusicSetDef[];
  /** Sprinkle phrases (optional in the file; always present in a validated manifest). */
  phrases?: readonly MusicPhraseDef[];
}

export const EMPTY_MANIFEST: MusicManifest = { version: 1, sets: [], phrases: [] };

/** Loudness the player corrects measured phrases to (LUFS integrated; see the owner guide). */
export const PHRASE_TARGET_LUFS = -18;
/** Allowed phrase lengths (s): outside the recommended range only warns, outside these bounds is an error. */
export const PHRASE_MIN_SEC = 4;
export const PHRASE_MAX_SEC = 90;
export const PHRASE_RECOMMENDED_SEC: readonly [number, number] = [15, 45];
/** The same for moment pieces. */
export const MOMENT_PIECE_MIN_SEC = 15;
export const MOMENT_PIECE_MAX_SEC = 240;
export const MOMENT_PIECE_RECOMMENDED_SEC: readonly [number, number] = [40, 120];

export function roleOf(p: Pick<MusicPhraseDef, 'role'>): PhraseRole {
  return p.role ?? 'sprinkle';
}

/** Linear gain of a phrase: its trim times the loudness correction to PHRASE_TARGET_LUFS (clamped to ±12 dB). */
export function phraseGain(p: Pick<MusicPhraseDef, 'gain' | 'lufs'>): number {
  const trim = p.gain ?? 1;
  if (p.lufs === undefined) {
    return trim;
  }
  const db = Math.max(-12, Math.min(12, PHRASE_TARGET_LUFS - p.lufs));
  return trim * Math.pow(10, db / 20);
}

/** Base URL of the music files (Vite serves public/ at the root). */
export const MUSIC_BASE = 'audio/music/';

/**
 * The private manifest (US-risky historic recordings, gitignored in private-assets/audio/moments/): served and built
 * under `audio/music/private/` by vite.config.ts when the folder exists; its `src` paths start with `private/`.
 */
export const PRIVATE_MANIFEST = 'private/manifest.json';
export const PRIVATE_PREFIX = 'private/';

/**
 * The phrase with the requested version in `src` / `lufs` (and `variant`); unchanged when it has no such version.
 * Pure: used by the game for `?music=raw|denoised` and by the checks.
 */
export function applyPhraseVariant(p: MusicPhraseDef, want: PhraseVariant | null): MusicPhraseDef {
  const v = want ? p.variants?.[want] : undefined;
  if (!want || !v || p.variant === want) {
    return p;
  }
  return { ...p, src: v.src, lufs: v.lufs ?? p.lufs, variant: want };
}

/**
 * Merges the private manifest's phrases into the public one (a private phrase never replaces a public id). Every
 * private phrase must point into `private/`: a US-risky file must never be looked up in public/.
 */
export function mergePrivatePhrases(pub: MusicManifest, priv: MusicManifest): { manifest: MusicManifest; skipped: string[] } {
  const ids = new Set([...pub.sets.map((s) => s.id), ...(pub.phrases ?? []).map((p) => p.id)]);
  const skipped: string[] = [];
  const add: MusicPhraseDef[] = [];
  for (const p of priv.phrases ?? []) {
    if (ids.has(p.id)) {
      skipped.push(`${p.id}: id already used by the public manifest`);
    } else if (!p.src.every((s) => s.startsWith(PRIVATE_PREFIX)) || !Object.values(p.variants ?? {}).every((v) => v.src.every((s) => s.startsWith(PRIVATE_PREFIX)))) {
      skipped.push(`${p.id}: private phrases must live under ${PRIVATE_PREFIX}`);
    } else {
      ids.add(p.id);
      add.push(p);
    }
  }
  return { manifest: { ...pub, phrases: [...(pub.phrases ?? []), ...add] }, skipped };
}

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
export function creditLine(set: Pick<MusicSetDef, 'credit'>): string {
  const c = set.credit;
  const licence =
    c.licence === 'original'
      ? 'Seventeen Skies için özgün'
      : c.licence === 'public-domain'
        ? 'kamu malı'
        : c.licence === 'public-domain-tr'
          ? 'Türkiye’de kamu malı'
          : c.licence.replace(/-/g, ' ');
  return c.attribution ? `${c.attribution} (${licence})` : `“${c.title}”, ${c.author} (${licence})`;
}

/* ------------------------------------------------------------------ */
/* Validation                                                           */
/* ------------------------------------------------------------------ */

export interface ManifestIssue {
  /** Where: `sets[2].stems.base`, `sets[0].credit`, `phrases[1].family`... */
  path: string;
  message: string;
}

export interface ManifestReport {
  ok: boolean;
  errors: ManifestIssue[];
  warnings: ManifestIssue[];
  /** The manifest with invalid sets and phrases removed (a valid entry is never dropped for another entry's error). */
  manifest: MusicManifest;
}

export interface ValidateOptions {
  /** File check for a path relative to public/audio/music/ (the headless check uses fs; omit to skip). */
  exists?: (path: string) => boolean;
  /** Tolerance (s) for durations against the grid and against each other. Default 0.02 s (about a video frame). */
  toleranceSec?: number;
  /**
   * The public manifest (public/audio/music/manifest.json): US-risky recordings (`public-domain-tr`) and files under
   * `private/` are errors there; they belong in the private manifest only.
   */
  publicManifest?: boolean;
}

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const AUDIO_EXT_RE = /\.(opus|ogg|oga|webm|m4a|aac|mp3|flac|wav)$/i;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

type IssueFn = (path: string, message: string) => void;

/** Credit, licence and approval rules shared by sets and phrases (paths relative to the entry). */
function validateCredit(s: Record<string, unknown>, err: IssueFn, opts: ValidateOptions = {}): void {
  if (!isStr(s.approvedOn) || !DATE_RE.test(s.approvedOn)) {
    err('.approvedOn', 'approvedOn (YYYY-MM-DD) is required: every music asset is approved by the owner first');
  }
  const c = s.credit;
  if (!isObj(c)) {
    err('.credit', 'credit {title, author, licence, sourceUrl?, attribution?} is required');
    return;
  }
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
      err('.credit.sourceUrl', 'sourceUrl is required for CC and public-domain licences');
    }
    if ((c.licence.startsWith('CC-BY') || c.licence.startsWith('public-domain')) && !isStr(c.attribution)) {
      err('.credit.attribution', 'attribution text is required for CC-BY and historic public-domain recordings');
    }
  }
  if (opts.publicManifest && c.licence === 'public-domain-tr') {
    err('.credit.licence', 'public-domain-tr (US-risky) recordings must not ship from public/: use the private manifest');
  }
  if (c.sourceUrl !== undefined && (!isStr(c.sourceUrl) || !/^https:\/\//.test(c.sourceUrl))) {
    err('.credit.sourceUrl', 'sourceUrl must be an https URL');
  }
}

/** File list rules shared by stems, stingers and phrases. */
function validateSources(path: string, src: unknown, err: IssueFn, opts: ValidateOptions): void {
  if (!Array.isArray(src) || src.length === 0 || src.some((p) => !isStr(p))) {
    err(path, 'src must be a non-empty array of file paths');
    return;
  }
  for (const p of src as string[]) {
    if (p.startsWith('/') || p.includes('..') || /^[a-z]+:/i.test(p)) {
      err(path, `"${p}" must be a relative path inside public/audio/music/`);
    } else if (opts.publicManifest && p.startsWith(PRIVATE_PREFIX)) {
      err(path, `"${p}" is a private file: list it in the private manifest, not in public/audio/music/manifest.json`);
    } else if (!AUDIO_EXT_RE.test(p)) {
      err(path, `"${p}" is not an audio file (opus, ogg, m4a, mp3...)`);
    } else if (opts.exists && !opts.exists(p)) {
      err(path, `file "${p}" does not exist`);
    }
  }
}

/** Tags must be strings; unknown ones only warn. */
function validateTags(tags: unknown, err: IssueFn, warn: IssueFn, known: readonly string[] = KNOWN_TAGS): void {
  if (!Array.isArray(tags) || tags.some((t) => !isStr(t))) {
    err('.tags', 'tags must be an array of strings');
    return;
  }
  for (const t of tags as string[]) {
    if (!known.includes(t)) {
      warn('.tags', `unknown tag "${t}" (the default rules ignore it)`);
    }
  }
}

/** `variant` / `variants` of a restored recording: the named default exists and matches `src`; files like `src`. */
function validateVariants(p: Record<string, unknown>, err: IssueFn, opts: ValidateOptions): void {
  if (p.variants === undefined) {
    if (p.variant !== undefined) {
      err('.variant', 'variant needs variants');
    }
    return;
  }
  if (!isObj(p.variants) || Object.keys(p.variants).length === 0) {
    err('.variants', 'variants must be an object keyed by version (denoised, raw)');
    return;
  }
  for (const [name, v] of Object.entries(p.variants)) {
    const at = `.variants.${name}`;
    if (!(PHRASE_VARIANTS as readonly string[]).includes(name)) {
      err(at, `unknown variant "${name}" (${PHRASE_VARIANTS.join(', ')})`);
      continue;
    }
    if (!isObj(v)) {
      err(at, 'variant must be an object {src, lufs?}');
      continue;
    }
    validateSources(`${at}.src`, v.src, err, opts);
    if (v.lufs !== undefined && (!isNum(v.lufs) || v.lufs < -40 || v.lufs > -6)) {
      err(`${at}.lufs`, 'lufs (measured integrated loudness) must be in -40..-6');
    }
  }
  if (!isStr(p.variant) || !(PHRASE_VARIANTS as readonly string[]).includes(p.variant)) {
    err('.variant', `variant (the default version: ${PHRASE_VARIANTS.join(', ')}) is required with variants`);
  } else {
    const def = (p.variants as Record<string, unknown>)[p.variant];
    if (!isObj(def)) {
      err('.variant', `the default variant "${p.variant}" is not listed in variants`);
    } else if (JSON.stringify(def.src) !== JSON.stringify(p.src)) {
      err('.variant', `src must be the default variant's files (${p.variant})`);
    }
  }
}

/** Validates `raw.phrases` (absent = none) with the same licence, approval and file rules as sets. */
function validatePhrases(raw: Record<string, unknown>, errors: ManifestIssue[], warnings: ManifestIssue[], opts: ValidateOptions): MusicPhraseDef[] {
  const good: MusicPhraseDef[] = [];
  if (raw.phrases === undefined) {
    return good;
  }
  if (!Array.isArray(raw.phrases)) {
    errors.push({ path: 'phrases', message: 'phrases must be an array' });
    return good;
  }
  const ids = new Set<string>();
  raw.phrases.forEach((p: unknown, i: number) => {
    const at = `phrases[${i}]`;
    const before = errors.length;
    const err: IssueFn = (path, message) => errors.push({ path: `${at}${path}`, message });
    const warn: IssueFn = (path, message) => warnings.push({ path: `${at}${path}`, message });
    if (!isObj(p)) {
      err('', 'phrase must be an object');
      return;
    }
    if (!isStr(p.id) || !ID_RE.test(p.id)) {
      err('.id', 'id must be lower-case letters, digits and dashes');
    } else if (ids.has(p.id)) {
      err('.id', `duplicate phrase id "${p.id}"`);
    } else if (Array.isArray(raw.sets) && raw.sets.some((x) => isObj(x) && x.id === p.id)) {
      err('.id', `phrase id "${p.id}" is also a set id (a moment's musicId must be unambiguous)`);
    } else {
      ids.add(p.id);
    }
    if (p.role !== undefined && !(PHRASE_ROLES as readonly unknown[]).includes(p.role)) {
      err('.role', `role must be one of ${PHRASE_ROLES.join(', ')}`);
    }
    const moment = p.role === 'moment';
    validateSources('.src', p.src, err, opts);
    const [min, max] = moment ? [MOMENT_PIECE_MIN_SEC, MOMENT_PIECE_MAX_SEC] : [PHRASE_MIN_SEC, PHRASE_MAX_SEC];
    const [recMin, recMax] = moment ? MOMENT_PIECE_RECOMMENDED_SEC : PHRASE_RECOMMENDED_SEC;
    if (!isNum(p.durationSec) || p.durationSec < min || p.durationSec > max) {
      err('.durationSec', `durationSec (measured) is required, ${min}..${max} s`);
    } else if (p.durationSec < recMin || p.durationSec > recMax) {
      warn('.durationSec', `${p.durationSec.toFixed(1)} s is outside the recommended ${recMin}..${recMax} s`);
    }
    if (p.family !== undefined || !moment) {
      if (!isStr(p.family) || !ID_RE.test(p.family)) {
        err('.family', 'family (instrument, lower-case, e.g. "ney", "kanun") is required');
      }
    }
    if (moment) {
      validateTags(p.tags, err, warn, MOMENT_MUSIC_TAGS);
      if (Array.isArray(p.tags) && p.tags.length === 0) {
        warn('.tags', 'a moment piece without tags plays only when a moment names it (musicId)');
      }
    } else {
      validateTags(p.tags, err, warn);
      if (Array.isArray(p.tags) && (p.tags.includes('race') || p.tags.includes('moment'))) {
        warn('.tags', 'sprinkles never play during races or moments: the race / moment tags have no effect');
      }
    }
    if (p.gain !== undefined && (!isNum(p.gain) || p.gain < 0 || p.gain > 2)) {
      err('.gain', 'gain must be in 0..2');
    }
    if (p.lufs !== undefined && (!isNum(p.lufs) || p.lufs < -40 || p.lufs > -6)) {
      err('.lufs', 'lufs (measured integrated loudness) must be in -40..-6');
    }
    validateCredit(p, err, opts);
    validateVariants(p, err, opts);
    if (errors.length === before) {
      good.push(p as unknown as MusicPhraseDef);
    }
  });
  return good;
}

/**
 * Validates a parsed manifest.json. Errors drop the offending set or phrase (the rest stays usable); warnings are
 * advice (unknown tags, missing measured durations, a set without optional stems, a phrase outside 15..45 s).
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
    validateTags(s.tags, err, warn);
    for (const g of ['gain'] as const) {
      if (s[g] !== undefined && (!isNum(s[g]) || (s[g] as number) < 0 || (s[g] as number) > 2)) {
        err(`.${g}`, 'gain must be in 0..2');
      }
    }
    validateCredit(s, err, opts);
    // Grid length.
    const gridOk = isNum(s.bpm) && isNum(s.beatsPerBar) && isNum(s.bars);
    const loop = gridOk ? loopSeconds(s as unknown as MusicSetDef) : NaN;
    if (gridOk && (loop < 4 || loop > 600)) {
      err('', `loop length ${loop.toFixed(2)} s is outside 4..600 s`);
    }
    const checkSources = (path: string, src: unknown): void => validateSources(path, src, err, opts);
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
  const phrases = validatePhrases(raw, errors, warnings, opts);
  return { ok: errors.length === 0, errors, warnings, manifest: { version: 1, sets: good, phrases } };
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
