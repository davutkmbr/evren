/**
 * Pure trigger evaluator for moments: given the records and a snapshot of the world, which moments may start now.
 *
 * No three.js, no scene, no clock: every input is in `MomentContext`, so the same inputs always give the same answer
 * (results are sorted by distance, then id). The runtime (./runtime.ts, driven by ./system.ts) fills the context every
 * frame, picks one of the eligible moments and records it in the session state.
 */
import type { FlightMode, WeatherPreset } from '../core/contracts';
import { latLonToLocal } from '../core/geo-coords';
import { momentAllowed, type MomentPrefs } from './prefs';
import type { DateRange, LatLon, Moment, MomentTrigger, MonthDay, Season, TimeWindow } from './types';

export interface XZ {
  x: number;
  z: number;
}

/** A moving anchor's position (e.g. one ferry in service); `id` names the object for the moment's actor. */
export interface AnchorPoint extends XZ {
  id?: number;
}

export interface MomentSession {
  /** Session clock in seconds (any monotonic clock, e.g. TimeState.elapsed). */
  now: number;
  /** Moment id → session time it last fired. Presence means it fired this session. */
  lastFired: ReadonlyMap<string, number>;
}

export interface MomentContext {
  /** Dragon position in local meters (x east, z south), as in the rest of the engine. */
  position: XZ;
  /** Altitude above sea level (m). */
  altitude: number;
  /** Height above the surface below (m). */
  agl: number;
  grounded: boolean;
  flightMode?: FlightMode;
  /** Signed coast distance at the dragon (GeoQuery.coastDistance); required by moments with `shoreDistance`. */
  coastDistance?: number;
  /** Local time of day in hours [0, 24). */
  timeOfDay: number;
  /** Day of year 1..365. */
  dayOfYear: number;
  weather: WeatherPreset | 'custom';
  /** Current positions of moving anchors by name (e.g. 'ferry'). */
  anchors?: Readonly<Record<string, readonly AnchorPoint[]>>;
  session: MomentSession;
}

export interface EvaluateOptions {
  /** Also consider 'draft' moments (the runtime passes its own playable list; tests). Default false: only 'ready'. */
  includeDrafts?: boolean;
  /** The player's settings; moments of a switched-off category (or all, when disabled) never play. */
  prefs?: MomentPrefs;
}

export interface EligibleMoment {
  moment: Moment;
  /** Distance in meters to the trigger's centre or nearest anchor (0 for area-only places). */
  distance: number;
}

/** Why a moment is not eligible, or null when it is. Stable strings, handy in tests and debug overlays. */
export type RejectReason =
  | 'status'
  | 'disabled'
  | 'place'
  | 'surface'
  | 'altitude'
  | 'flight-mode'
  | 'shore'
  | 'time-of-day'
  | 'season'
  | 'date'
  | 'weather'
  | 'once'
  | 'cooldown';

/* ------------------------------------------------------------------ */
/* Calendar and clock helpers (exported for the headless check)        */
/* ------------------------------------------------------------------ */

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Day of year (1..365, non-leap calendar) of a month/day. */
export function dayOfYearOf(md: MonthDay): number {
  let d = md.day;
  for (let m = 1; m < md.month; m++) {
    d += MONTH_DAYS[m - 1];
  }
  return d;
}

/** True when the month/day exists in a non-leap year. */
export function isValidMonthDay(md: MonthDay): boolean {
  return Number.isInteger(md.month) && Number.isInteger(md.day) && md.month >= 1 && md.month <= 12 && md.day >= 1 && md.day <= MONTH_DAYS[md.month - 1];
}

/** Month 1..12 of a day of year (clamped to 1..365). */
export function monthOfDay(dayOfYear: number): number {
  let d = Math.min(365, Math.max(1, Math.floor(dayOfYear)));
  for (let m = 0; m < 12; m++) {
    if (d <= MONTH_DAYS[m]) {
      return m + 1;
    }
    d -= MONTH_DAYS[m];
  }
  return 12;
}

export function seasonOfDay(dayOfYear: number): Season {
  const m = monthOfDay(dayOfYear);
  if (m >= 3 && m <= 5) return 'spring';
  if (m >= 6 && m <= 8) return 'summer';
  if (m >= 9 && m <= 11) return 'autumn';
  return 'winter';
}

/** Inclusive date range test; wraps past New Year when `from` is after `to`. */
export function inDateRange(dayOfYear: number, range: DateRange): boolean {
  const d = Math.min(365, Math.max(1, Math.floor(dayOfYear)));
  const a = dayOfYearOf(range.from);
  const b = dayOfYearOf(range.to);
  return a <= b ? d >= a && d <= b : d >= a || d <= b;
}

/** Half-open time window [from, to) in hours; wraps past midnight when `from > to`. */
export function inTimeWindow(hours: number, w: TimeWindow): boolean {
  const h = ((hours % 24) + 24) % 24;
  return w.from < w.to ? h >= w.from && h < w.to : h >= w.from || h < w.to;
}

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */

interface ProjectedPlace {
  center: XZ | null;
  area: XZ[] | null;
}

const projected = new WeakMap<MomentTrigger, ProjectedPlace>();

function project(ll: LatLon): XZ {
  return latLonToLocal(ll.lat, ll.lon);
}

function placeOf(t: MomentTrigger): ProjectedPlace {
  let p = projected.get(t);
  if (!p) {
    p = {
      center: t.place.center ? project(t.place.center) : null,
      area: t.place.area ? t.place.area.map(project) : null,
    };
    projected.set(t, p);
  }
  return p;
}

/** Even-odd point-in-polygon test in local meters. */
export function pointInPolygon(p: XZ, poly: readonly XZ[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** Distance to the place (Infinity when outside), or 0 for an area-only place the dragon is inside. */
function placeDistance(t: MomentTrigger, ctx: MomentContext): number {
  const { place } = t;
  const pp = placeOf(t);
  const pos = ctx.position;
  if (pp.area && !pointInPolygon(pos, pp.area)) {
    return Infinity;
  }
  const radius = place.radius ?? 0;
  let distance = 0;
  if (pp.center) {
    distance = Math.hypot(pos.x - pp.center.x, pos.z - pp.center.z);
    if (distance > radius) {
      return Infinity;
    }
  }
  if (place.anchor !== undefined) {
    let best = Infinity;
    for (const a of ctx.anchors?.[place.anchor] ?? []) {
      best = Math.min(best, Math.hypot(pos.x - a.x, pos.z - a.z));
    }
    if (best > radius) {
      return Infinity;
    }
    distance = pp.center ? Math.min(distance, best) : best;
  }
  return distance;
}

/** The anchor of `moment`'s place nearest to the dragon (null when the place has no anchor or none is supplied). */
export function nearestAnchor(moment: Moment, ctx: Pick<MomentContext, 'position' | 'anchors'>): AnchorPoint | null {
  const name = moment.trigger.place.anchor;
  if (name === undefined) return null;
  let best: AnchorPoint | null = null;
  let bestD = Infinity;
  for (const a of ctx.anchors?.[name] ?? []) {
    const d = Math.hypot(ctx.position.x - a.x, ctx.position.z - a.z);
    if (d < bestD) {
      bestD = d;
      best = a;
    }
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* Evaluation                                                          */
/* ------------------------------------------------------------------ */

function inBand(v: number, min: number | undefined, max: number | undefined): boolean {
  return (min === undefined || v >= min) && (max === undefined || v <= max);
}

/**
 * Returns why `moment` cannot start in `ctx`, or null when it can. Checks run cheapest first; the place check is
 * last but one so debug output names the most specific reason. Pure and deterministic.
 */
export function rejectReason(moment: Moment, ctx: MomentContext, opts: EvaluateOptions = {}): RejectReason | null {
  const t = moment.trigger;
  if (moment.status !== 'ready' && !opts.includeDrafts) return 'status';
  if (opts.prefs && !momentAllowed(opts.prefs, moment.category)) return 'disabled';

  const last = ctx.session.lastFired.get(moment.id);
  if (last !== undefined) {
    if (t.repeat.kind === 'once-per-session') return 'once';
    if (ctx.session.now - last < t.repeat.cooldownSec) return 'cooldown';
  }

  if (t.surface === 'ground' && !ctx.grounded) return 'surface';
  if (t.surface === 'air' && ctx.grounded) return 'surface';
  for (const band of t.altitude ?? []) {
    if (!inBand(band.ref === 'asl' ? ctx.altitude : ctx.agl, band.min, band.max)) return 'altitude';
  }
  if (t.flightModes && (ctx.flightMode === undefined || !t.flightModes.includes(ctx.flightMode))) return 'flight-mode';
  if (t.shoreDistance && (ctx.coastDistance === undefined || !inBand(ctx.coastDistance, t.shoreDistance.min, t.shoreDistance.max))) return 'shore';
  if (t.timeOfDay && !inTimeWindow(ctx.timeOfDay, t.timeOfDay)) return 'time-of-day';
  if (t.seasons && !t.seasons.includes(seasonOfDay(ctx.dayOfYear))) return 'season';
  if (t.dateRange && !inDateRange(ctx.dayOfYear, t.dateRange)) return 'date';
  if (t.weather && (ctx.weather === 'custom' || !t.weather.includes(ctx.weather))) return 'weather';
  if (placeDistance(t, ctx) === Infinity) return 'place';
  return null;
}

/** All moments that may start now, nearest first (ties by id). Pure and deterministic. */
export function eligibleMoments(moments: readonly Moment[], ctx: MomentContext, opts: EvaluateOptions = {}): EligibleMoment[] {
  const out: EligibleMoment[] = [];
  for (const moment of moments) {
    if (rejectReason(moment, ctx, opts) === null) {
      out.push({ moment, distance: placeDistance(moment.trigger, ctx) });
    }
  }
  out.sort((a, b) => a.distance - b.distance || (a.moment.id < b.moment.id ? -1 : a.moment.id > b.moment.id ? 1 : 0));
  return out;
}

/** Returns a new session state with `id` fired at `now` (the evaluator never mutates its inputs). */
export function markFired(session: MomentSession, id: string, now: number = session.now): MomentSession {
  const lastFired = new Map(session.lastFired);
  lastFired.set(id, now);
  return { now, lastFired };
}
