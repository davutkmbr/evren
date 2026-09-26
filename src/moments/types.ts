/**
 * "Anlar" (moments): small, calm surprises placed on the real map (phase 19, .docs/planning/19-moments.md).
 *
 * One record per moment, so new moments are data, not code. This file only describes the data; the pure trigger
 * evaluator lives in ./triggers.ts and the records in ./data/. Nothing here depends on three.js or the scene.
 *
 * Conventions follow src/core/contracts.ts: meters, seconds, hours [0, 24) for time of day, day of year 1..365.
 * Positions are real coordinates (lat/lon, WGS84); the evaluator projects them with latLonToLocal().
 * Player-facing strings are Turkish; everything else (ids, notes) is English.
 */
import type { FlightMode, WeatherPreset } from '../core/contracts';

/**
 * 'draft' until every referenced model, animation and sound exists and is approved. 'ready' moments play; a 'draft'
 * moment plays only when its content is complete for what it is: a subtitle-only moment whose single need is its
 * (optional) sound plays over the lifted coastal ambience (see momentPlayability in ./runtime.ts).
 */
export type MomentStatus = 'draft' | 'ready';

/** Player-facing groups; each can be switched off in the settings (see prefs.ts). */
export type MomentCategory = 'legend' | 'city-life' | 'poem';

export interface LatLon {
  lat: number;
  lon: number;
}

/** A named key point of a moment (start of a flight, landing spot, a character's stand...). */
export interface MomentWaypoint extends LatLon {
  /** Stable id inside the record, e.g. 'start', 'landing'. */
  id: string;
  /** English note for developers ("tip of Sarayburnu, where the rocket rose"). */
  note: string;
  /** Where the point must be, checked headlessly against the real geography. */
  expect?: 'land' | 'water';
  /** Optional landmark id (src/world/geo/data/landmarks.ts) the point must lie near (≤ 150 m from its centre). */
  nearLandmark?: string;
}

/**
 * Where a moment can happen. At least one of `center`, `area` or `anchor` is required; when several are given all must
 * hold (e.g. a circle clipped to a polygon).
 */
export interface MomentPlace {
  /** English label for developers and the README table. */
  label: string;
  /** Circle centre; requires `radius`. */
  center?: LatLon;
  /** Trigger radius in meters around `center` or around each anchor position. */
  radius?: number;
  /** Closed polygon (≥ 3 vertices, implicitly closed). */
  area?: readonly LatLon[];
  /**
   * Moving anchor supplied at runtime by another system (e.g. 'ferry' → the ferries' current positions).
   * The context passes `anchors[anchor]`; the moment is in range when within `radius` of any of them.
   */
  anchor?: string;
}

/** Altitude band in meters; `ref` picks sea level ('asl') or height above the surface below ('agl'). */
export interface AltitudeBand {
  ref: 'asl' | 'agl';
  min?: number;
  max?: number;
}

/** Local time-of-day window in hours [0, 24). `from > to` wraps past midnight (e.g. 21 → 4). `from === to` is invalid. */
export interface TimeWindow {
  from: number;
  to: number;
}

export interface MonthDay {
  /** 1..12 */
  month: number;
  /** 1..31 (checked against a non-leap calendar). */
  day: number;
}

/** Inclusive date range; `from` later in the year than `to` wraps past New Year (e.g. 20 Dec → 5 Jan). */
export interface DateRange {
  from: MonthDay;
  to: MonthDay;
}

/** Meteorological seasons: spring Mar–May, summer Jun–Aug, autumn Sep–Nov, winter Dec–Feb. */
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

export type MomentRepeat =
  /** Plays at most once per game session. */
  | { kind: 'once-per-session' }
  /** Plays again after `cooldownSec` session seconds since it last fired. */
  | { kind: 'repeatable'; cooldownSec: number };

export interface MomentTrigger {
  place: MomentPlace;
  /** 'ground': the dragon must be grounded (landed/walking); 'air': must be airborne; 'any': either. */
  surface: 'ground' | 'air' | 'any';
  /** Altitude bands; all must hold (e.g. an ASL ceiling and an AGL floor). */
  altitude?: readonly AltitudeBand[];
  /** Only in these flight modes (e.g. gliding low along the shore). Omitted = any mode. */
  flightModes?: readonly FlightMode[];
  /** Signed distance to the coastline in meters (positive on land, negative over water), from GeoQuery.coastDistance. */
  shoreDistance?: { min?: number; max?: number };
  timeOfDay?: TimeWindow;
  /** Seasons in which the moment can happen; combined with `dateRange` by AND when both are given. */
  seasons?: readonly Season[];
  dateRange?: DateRange;
  /** Allowed weather presets; omitted = any weather. A 'custom' weather never matches a list. */
  weather?: readonly WeatherPreset[];
  repeat: MomentRepeat;
}

/** One subtitle line (Turkish), timed from the start of the moment. */
export interface SubtitleLine {
  /** Seconds from the moment's start. */
  at: number;
  /** Seconds on screen. */
  duration: number;
  /** Turkish subtitle text, ≤ ~90 characters. */
  text: string;
  /** Turkish speaker label shown before the line ("Oltacı"); omitted = narrator / no label. */
  speaker?: string;
}

/** Camera suggestion for the moment; the camera system may ignore it and never takes control away from the player. */
export interface CameraHint {
  kind: 'look-at' | 'follow' | 'orbit';
  /** Waypoint id of this record the camera should frame. */
  waypoint?: string;
  /** English note ("frame the tower and the snake basket at landing distance"). */
  note: string;
}

/** Discovery card unlocked when the moment first plays (Turkish). */
export interface DiscoveryCard {
  title: string;
  text: string;
}

export interface MomentContent {
  /** Placeholder id of the character or object model (not yet built; see `needs`). */
  actorId?: string;
  /** Placeholder ids of the idle / reaction animations. */
  animationIds?: readonly string[];
  /** Placeholder id of the sound cue (not yet recorded or approved). */
  soundId?: string;
  subtitles: readonly SubtitleLine[];
  camera?: CameraHint;
  card?: DiscoveryCard;
  /** Key points of the scene (start and end of a flight, a character's stand...). */
  waypoints?: readonly MomentWaypoint[];
}

/**
 * Optional official video: an embed of the rights holder's own YouTube upload, streamed and never stored.
 * Left empty in every record until the user picks the scene and the official link.
 */
export interface ExternalMedia {
  provider: 'youtube';
  videoId: string;
  startSec: number;
  endSec: number;
  /** Who owns the upload (must be the rights holder's official channel). */
  rightsHolder: string;
}

/**
 * Source and licence of one piece of text in a record. Our own writing is MIT like the rest of the repository;
 * a public-domain source (legend, chronicle, a poem whose author died more than 70 years ago) is named explicitly.
 */
export interface TextProvenance {
  /** Which text this entry covers: 'subtitles', 'card', or 'subtitles:3' for a single line. */
  covers: string;
  kind: 'original' | 'public-domain';
  /** 'MIT' for our own writing, 'public domain' for PD works. */
  licence: string;
  /** Author of the text as it appears in the game ("Seventeen Skies contributors" for our own writing). */
  author: string;
  /** What the text is based on, e.g. "Evliya Çelebi, Seyahatname (17th century), public domain". */
  basis?: string;
  /** Anything the user still has to confirm about this text (rights or accuracy); empty when settled. */
  pending?: string;
}

/** What a moment still needs before it can become 'ready'. */
export type MomentNeed = 'model' | 'animation' | 'sound' | 'video-link' | 'text-approval' | 'runtime-anchor';

export interface Moment {
  /** Stable kebab-case id. */
  id: string;
  /** Short Turkish name (used on the discovery list). */
  title: string;
  category: MomentCategory;
  status: MomentStatus;
  /** Item number in the phase 19 backlog. */
  backlog: number;
  trigger: MomentTrigger;
  content: MomentContent;
  media?: ExternalMedia;
  provenance: readonly TextProvenance[];
  needs: readonly MomentNeed[];
  /** English notes for developers (historical caveats, design intent). */
  notes?: string;
  /** Original sources behind the moment ("Kaynak": the poem's text, a scan, an official video...), see ./sources.ts. */
  sources?: readonly MomentSource[];
}

/* ------------------------------------------------------------------ */
/* Sources ("Kaynak")                                                   */
/* ------------------------------------------------------------------ */

/** What a source is: a text page, an image, a video, a recording or any other page. */
export type MomentSourceKind = 'text' | 'image' | 'video' | 'audio' | 'link';

/** How an approved source is shown inside the game (only approved items are ever embedded). */
export type MomentSourceEmbed =
  /** The rights holder's own YouTube upload, played through youtube-nocookie.com; seconds are optional. */
  | { kind: 'youtube'; videoId: string; startSec?: number; endSec?: number }
  /** A direct https image file URL (e.g. upload.wikimedia.org) with its pixel size, loaded only when the sheet opens. */
  | { kind: 'image'; src: string; width: number; height: number };

/**
 * One original source behind a moment, reached with the "Kaynağa bak" key (./sources.ts). `url` is the canonical page
 * (Vikikaynak / Wikisource, Project Gutenberg, a Wikimedia Commons file page, the rights holder's official YouTube
 * upload, a museum page...). Only items with `approved: true` (the owner approved them, CLAUDE.md) are ever embedded;
 * an unapproved item is shown as a plain external link and never embedded.
 */
export interface MomentSource {
  kind: MomentSourceKind;
  /** Turkish title shown in the source sheet ("Şiirin tam metni"). */
  title: string;
  /** Canonical https URL, opened in a new tab. */
  url: string;
  embed?: MomentSourceEmbed;
  /** Who made or holds the work ("Orhan Veli Kanık", the channel name). Required when approved. */
  attribution?: string;
  /** Licence as the source states it ("kamu malı", "CC BY-SA 4.0"). Required when approved. */
  licence?: string;
  /** The owner approved this item for the game (required before anything is embedded). */
  approved: boolean;
  /** English note for developers (how the URL was verified, what is still to confirm). */
  note?: string;
}
