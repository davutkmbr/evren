/**
 * Headless check for the moments ("Anlar", phase 19): validates every record and the places against the real
 * geography, and unit-tests the pure trigger evaluator. No browser, no GPU.
 *
 *   npx tsx tools/headless/moments-check.ts
 *
 * Exits non-zero on any failure. Warnings (placeholders, pending rights) are printed but do not fail.
 */
import { latLonToLocal, WORLD_BOUNDS } from '../../src/core/geo-coords';
import { unresolvedContent } from '../../src/moments/content';
import { ALL_MOMENTS } from '../../src/moments/data';
import { defaultMomentPrefs } from '../../src/moments/prefs';
import { BOSPHORUS_CORRIDOR } from '../../src/moments/data/city-life';
import {
  dayOfYearOf,
  eligibleMoments,
  inDateRange,
  inTimeWindow,
  isValidMonthDay,
  markFired,
  pointInPolygon,
  rejectReason,
  type MomentContext,
  type MomentSession,
} from '../../src/moments/triggers';
import type { LatLon, Moment } from '../../src/moments/types';
import { buildHeadlessGeo } from './geo';

const MAX_LINE = 90;
const MAX_CARD_TITLE = 40;
const MAX_CARD_TEXT = 320;
const LANDMARK_TOLERANCE = 150;
const PLACEHOLDER = /^\[\[.*\]\]$/;
const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

let failures = 0;
let warnings = 0;
let checks = 0;

function fail(where: string, msg: string): void {
  failures++;
  console.log(`  FAIL ${where}: ${msg}`);
}

function warn(where: string, msg: string): void {
  warnings++;
  console.log(`  warn ${where}: ${msg}`);
}

function expect(cond: boolean, where: string, msg: string): void {
  checks++;
  if (!cond) fail(where, msg);
}

function finite(...v: (number | undefined)[]): boolean {
  return v.every((x) => x === undefined || Number.isFinite(x));
}

function insideWorld(ll: LatLon): boolean {
  const p = latLonToLocal(ll.lat, ll.lon);
  return p.x >= WORLD_BOUNDS.minX && p.x <= WORLD_BOUNDS.maxX && p.z >= WORLD_BOUNDS.minZ && p.z <= WORLD_BOUNDS.maxZ;
}

/* ------------------------------------------------------------------ */
/* 1. Record validation                                                */
/* ------------------------------------------------------------------ */

function validateRecord(m: Moment): void {
  const w = m.id || '(no id)';
  expect(ID.test(m.id), w, 'id must be kebab-case');
  expect(m.title.trim().length > 0, w, 'title is empty');
  expect(m.status === 'draft' || m.status === 'ready', w, `bad status ${m.status}`);
  expect(Number.isInteger(m.backlog) && m.backlog >= 1 && m.backlog <= 15, w, 'backlog must be a phase 19 item number (1..15)');

  // Trigger: place.
  const t = m.trigger;
  const p = t.place;
  expect(p.label.trim().length > 0, w, 'place.label is empty');
  expect(!!(p.center || p.area || p.anchor), w, 'place needs a center, an area or an anchor');
  if (p.center || p.anchor !== undefined) {
    expect(p.radius !== undefined && p.radius > 0 && p.radius <= 20_000, w, 'center/anchor places need 0 < radius ≤ 20 km');
  }
  if (p.center) {
    expect(finite(p.center.lat, p.center.lon) && insideWorld(p.center), w, 'place.center outside the world bounds');
  }
  if (p.area) {
    expect(p.area.length >= 3, w, 'place.area needs ≥ 3 vertices');
    expect(p.area.every(insideWorld), w, 'place.area vertex outside the world bounds');
  }
  expect(['ground', 'air', 'any'].includes(t.surface), w, 'bad surface');
  for (const b of t.altitude ?? []) {
    expect(b.ref === 'asl' || b.ref === 'agl', w, 'altitude band needs ref asl|agl');
    expect(b.min !== undefined || b.max !== undefined, w, 'altitude band without min or max');
    expect(finite(b.min, b.max) && (b.min === undefined || b.max === undefined || b.min < b.max), w, 'altitude band min ≥ max');
    expect(b.min === undefined || b.min >= -50, w, 'altitude min below -50 m');
    expect(b.max === undefined || b.max <= 4000, w, 'altitude max above the world ceiling (4000 m)');
  }
  if (t.surface === 'ground') {
    expect(!(t.altitude ?? []).some((b) => b.ref === 'agl' && b.min !== undefined && b.min > 0), w, 'ground moment with a positive AGL floor');
  }
  if (t.shoreDistance) {
    const s = t.shoreDistance;
    expect(s.min !== undefined || s.max !== undefined, w, 'shoreDistance without min or max');
    expect(s.min === undefined || s.max === undefined || s.min < s.max, w, 'shoreDistance min ≥ max');
  }
  if (t.timeOfDay) {
    const { from, to } = t.timeOfDay;
    expect(finite(from, to) && from >= 0 && from < 24 && to >= 0 && to < 24, w, 'timeOfDay hours must be in [0, 24)');
    expect(from !== to, w, 'timeOfDay from === to (empty or full window; omit it for any time)');
  }
  if (t.dateRange) {
    expect(isValidMonthDay(t.dateRange.from) && isValidMonthDay(t.dateRange.to), w, 'dateRange has an invalid month/day');
  }
  if (t.seasons) {
    expect(t.seasons.length > 0 && t.seasons.length < 4, w, 'seasons must list 1..3 seasons (omit it for all year)');
  }
  if (t.weather) {
    expect(t.weather.length > 0, w, 'weather list is empty');
  }
  if (t.repeat.kind === 'repeatable') {
    expect(t.repeat.cooldownSec >= 30, w, 'repeatable moments need a cooldown ≥ 30 s');
  } else {
    expect(t.repeat.kind === 'once-per-session', w, 'bad repeat kind');
  }
  if (p.anchor !== undefined) {
    expect(m.needs.includes('runtime-anchor'), w, `anchor '${p.anchor}' needs 'runtime-anchor' in needs`);
  }

  // Content: subtitles.
  const subs = m.content.subtitles;
  expect(subs.length > 0, w, 'no subtitle lines');
  let prevEnd = 0;
  subs.forEach((s, i) => {
    const sw = `${w} line ${i + 1}`;
    const text = s.text.trim();
    expect(text.length > 0, sw, 'empty line');
    expect(s.text.length <= MAX_LINE, sw, `${s.text.length} chars > ${MAX_LINE}`);
    expect(s.text === text && !/\s{2,}/.test(s.text), sw, 'leading/trailing or double spaces');
    expect(s.duration >= 1.5 && s.duration <= 8, sw, `duration ${s.duration}s outside 1.5..8 s`);
    expect(s.at >= prevEnd - 1e-6, sw, 'overlaps the previous line');
    expect(text.length / s.duration <= 20 || PLACEHOLDER.test(text), sw, `reading speed ${(text.length / s.duration).toFixed(1)} chars/s > 20`);
    expect(s.speaker === undefined || s.speaker.trim().length > 0, sw, 'empty speaker label');
    if (PLACEHOLDER.test(text)) {
      expect(m.status === 'draft' && m.needs.includes('text-approval'), sw, "placeholder line outside a draft record with 'text-approval'");
    }
    prevEnd = s.at + s.duration;
  });
  if (subs.some((s) => PLACEHOLDER.test(s.text))) {
    warn(w, `${subs.filter((s) => PLACEHOLDER.test(s.text)).length} placeholder subtitle line(s) waiting for approval`);
  }
  const card = m.content.card;
  if (card) {
    expect(card.title.trim().length > 0 && card.title.length <= MAX_CARD_TITLE, w, 'card title empty or too long');
    expect(card.text.trim().length > 0 && card.text.length <= MAX_CARD_TEXT, w, `card text empty or > ${MAX_CARD_TEXT} chars (${card.text.length})`);
  }
  const wpIds = new Set<string>();
  for (const wp of m.content.waypoints ?? []) {
    expect(!wpIds.has(wp.id), w, `duplicate waypoint ${wp.id}`);
    wpIds.add(wp.id);
    expect(finite(wp.lat, wp.lon) && insideWorld(wp), w, `waypoint ${wp.id} outside the world bounds`);
    expect(wp.note.trim().length > 0, w, `waypoint ${wp.id} has no note`);
  }
  if (m.content.camera?.waypoint) {
    expect(wpIds.has(m.content.camera.waypoint), w, `camera hint names unknown waypoint ${m.content.camera.waypoint}`);
  }

  // Media: left empty until the user picks official uploads.
  if (m.media) {
    expect(/^[A-Za-z0-9_-]{11}$/.test(m.media.videoId), w, 'media.videoId is not a YouTube id');
    expect(m.media.startSec >= 0 && m.media.endSec > m.media.startSec, w, 'media start/end invalid');
    expect(m.media.rightsHolder.trim().length > 0, w, 'media.rightsHolder is empty');
    expect(m.needs.includes('video-link') === false, w, "record has media but still lists 'video-link'");
  }

  // Provenance: every text needs a source and licence.
  expect(m.provenance.length > 0, w, 'no provenance');
  const covered = new Set(m.provenance.map((pr) => pr.covers.split(':')[0]));
  expect(covered.has('subtitles'), w, 'subtitles have no provenance');
  if (card) expect(covered.has('card'), w, 'card has no provenance');
  for (const pr of m.provenance) {
    expect(pr.licence.trim().length > 0 && pr.author.trim().length > 0, w, `provenance for ${pr.covers} lacks licence/author`);
    if (pr.kind === 'original') expect(pr.licence === 'MIT', w, `original text for ${pr.covers} must be MIT like the repository`);
    if (pr.kind === 'public-domain') expect(!!pr.basis, w, `public-domain text for ${pr.covers} must name its source`);
    if (pr.pending) warn(w, `pending (${pr.covers}): ${pr.pending}`);
  }

  // Status.
  if (m.status === 'ready') {
    expect(m.needs.length === 0, w, `ready but still needs ${m.needs.join(', ')}`);
    expect(!m.provenance.some((pr) => pr.pending), w, 'ready with pending provenance');
    const missing = unresolvedContent(m.content);
    expect(missing.length === 0, w, `ready but its content ids do not resolve to procedural content: ${missing.join(', ')}`);
  }
}

/* ------------------------------------------------------------------ */
/* 2. Places against the real geography                                */
/* ------------------------------------------------------------------ */

function checkGeo(): void {
  const t0 = Date.now();
  const geo = buildHeadlessGeo();
  console.log(`  (geo built in ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  const local = (ll: LatLon) => latLonToLocal(ll.lat, ll.lon);

  for (const m of ALL_MOMENTS) {
    const p = m.trigger.place;
    if (m.trigger.surface === 'ground' && p.center) {
      const c = local(p.center);
      expect(!geo.isWater(c.x, c.z), m.id, 'ground moment centred over water');
    }
    for (const wp of m.content.waypoints ?? []) {
      const q = local(wp);
      const where = `${m.id} waypoint ${wp.id}`;
      if (wp.expect === 'water') expect(geo.isWater(q.x, q.z), where, `expected water (coast distance ${geo.coastDistance(q.x, q.z).toFixed(0)} m)`);
      if (wp.expect === 'land') expect(!geo.isWater(q.x, q.z), where, `expected land (coast distance ${geo.coastDistance(q.x, q.z).toFixed(0)} m)`);
      if (wp.nearLandmark) {
        const lm = geo.landmark(wp.nearLandmark);
        expect(!!lm, where, `unknown landmark ${wp.nearLandmark}`);
        if (lm) {
          const d = Math.hypot(lm.x - q.x, lm.z - q.z);
          expect(d <= LANDMARK_TOLERANCE, where, `${d.toFixed(0)} m from ${wp.nearLandmark} (> ${LANDMARK_TOLERANCE} m)`);
        }
      }
    }
  }

  // Record-specific sanity.
  const byId = new Map(ALL_MOMENTS.map((m) => [m.id, m]));
  const wp = (id: string, w: string) => byId.get(id)?.content.waypoints?.find((x) => x.id === w);

  const hez = wp('hezarfen-galata-uskudar', 'landing');
  if (hez) {
    const q = local(hez);
    expect(geo.districtAt(q.x, q.z)?.name === 'Üsküdar', 'hezarfen landing', `district is ${geo.districtAt(q.x, q.z)?.name}, expected Üsküdar`);
  }
  const hezStart = wp('hezarfen-galata-uskudar', 'start');
  if (hez && hezStart) {
    const a = local(hezStart);
    const b = local(hez);
    const d = Math.hypot(a.x - b.x, a.z - b.z);
    // Evliya's flight crosses the Bosphorus mouth: roughly 3.5 km.
    expect(d > 2500 && d < 5000, 'hezarfen flight', `Galata → Doğancılar is ${d.toFixed(0)} m, expected 2.5–5 km`);
    let crossesWater = false;
    for (let i = 1; i < 20; i++) {
      const f = i / 20;
      if (geo.isWater(a.x + (b.x - a.x) * f, a.z + (b.z - a.z) * f)) crossesWater = true;
    }
    expect(crossesWater, 'hezarfen flight', 'the straight line Galata → Doğancılar does not cross water');
  }
  const lag = wp('lagari-sarayburnu-rocket', 'launch');
  if (lag) {
    const q = local(lag);
    const cd = geo.coastDistance(q.x, q.z);
    expect(cd > 0 && cd < 200, 'lagari launch', `Sarayburnu point should be on land near the shore (coast distance ${cd.toFixed(0)} m)`);
  }
  const lagLand = wp('lagari-sarayburnu-rocket', 'landing');
  if (lagLand) {
    const q = local(lagLand);
    const name = geo.waterNameAt?.(q.x, q.z);
    expect(name === 'İstanbul Boğazı' || name === 'Marmara Denizi', 'lagari landing', `lands in ${name}, expected the Bosphorus mouth or the Marmara`);
  }
  const ships = wp('ships-over-land-1453', 'water');
  if (ships) {
    const q = local(ships);
    expect(geo.waterNameAt?.(q.x, q.z) === 'Haliç', 'ships water', `launch water is ${geo.waterNameAt?.(q.x, q.z)}, expected Haliç`);
  }
  const ridge = wp('ships-over-land-1453', 'ridge');
  const shipsArea = byId.get('ships-over-land-1453')?.trigger.place.area;
  if (ridge && shipsArea) {
    const q = local(ridge);
    expect(geo.heightAt(q.x, q.z) > 40, 'ships ridge', `ridge only ${geo.heightAt(q.x, q.z).toFixed(0)} m high`);
    expect(pointInPolygon(q, shipsArea.map(local)), 'ships ridge', 'ridge waypoint outside the trigger area');
  }
  const yorgi = byId.get('aya-yorgi-challenge')?.trigger.place.center;
  if (yorgi) {
    const q = local(yorgi);
    expect(geo.districtAt(q.x, q.z)?.name === 'Büyükada', 'aya yorgi', `district is ${geo.districtAt(q.x, q.z)?.name}, expected Büyükada`);
    expect(geo.heightAt(q.x, q.z) > 120, 'aya yorgi', `monastery hilltop only ${geo.heightAt(q.x, q.z).toFixed(0)} m high (Yücetepe ≈ 200 m)`);
  }
  const corridor = BOSPHORUS_CORRIDOR.map(local);
  for (const id of ['bogazici-koprusu', 'fsm-koprusu', 'kiz-kulesi', 'rumeli-hisari', 'anadolu-hisari', 'yss-koprusu']) {
    const lm = geo.landmark(id);
    expect(!!lm && pointInPolygon(lm, corridor), 'bosphorus corridor', `${id} is outside the corridor`);
  }
  let water = 0;
  let land = 0;
  for (let i = 0; i < 400; i++) {
    // Deterministic lattice over the corridor's bounding box.
    const x = -3500 + (i % 20) * 525;
    const z = -19000 + Math.floor(i / 20) * 1150;
    if (!pointInPolygon({ x, z }, corridor)) continue;
    if (geo.isWater(x, z)) water++;
    else land++;
  }
  expect(water > 20 && land > 20, 'bosphorus corridor', `corridor should span water and both shores (water ${water}, land ${land})`);
}

/* ------------------------------------------------------------------ */
/* 3. Trigger evaluator unit tests                                     */
/* ------------------------------------------------------------------ */

function testTriggers(): void {
  const T = 'triggers';
  const at = (lat: number, lon: number) => latLonToLocal(lat, lon);
  const emptySession: MomentSession = { now: 1000, lastFired: new Map() };
  const base = (over: Partial<MomentContext> = {}): MomentContext => ({
    position: { x: 0, z: 0 },
    altitude: 100,
    agl: 80,
    grounded: false,
    flightMode: 'gliding',
    coastDistance: -50,
    timeOfDay: 12,
    dayOfYear: 200,
    weather: 'clear',
    session: emptySession,
    ...over,
  });
  const mk = (over: Partial<Moment['trigger']>, id = 'test'): Moment => ({
    id,
    title: 'Test',
    category: 'legend',
    status: 'draft',
    backlog: 1,
    trigger: { place: { label: 'origin', center: { lat: 41.045, lon: 29.02 }, radius: 100 }, surface: 'any', repeat: { kind: 'once-per-session' }, ...over },
    content: { subtitles: [{ at: 0, duration: 2, text: 'Deneme.' }] },
    provenance: [],
    needs: [],
  });
  const opts = { includeDrafts: true };

  // Helpers.
  expect(inTimeWindow(23, { from: 21, to: 4 }) && inTimeWindow(2, { from: 21, to: 4 }) && inTimeWindow(21, { from: 21, to: 4 }), T, 'wrap window 21→4 should include 21, 23 and 2');
  expect(!inTimeWindow(4, { from: 21, to: 4 }) && !inTimeWindow(12, { from: 21, to: 4 }), T, 'wrap window 21→4 should exclude 4 and 12');
  expect(inTimeWindow(10, { from: 8, to: 19 }) && !inTimeWindow(19, { from: 8, to: 19 }) && !inTimeWindow(7.99, { from: 8, to: 19 }), T, 'plain window 8→19');
  expect(inTimeWindow(25, { from: 0, to: 2 }), T, 'hours are wrapped into [0, 24)');
  expect(dayOfYearOf({ month: 1, day: 1 }) === 1 && dayOfYearOf({ month: 12, day: 31 }) === 365 && dayOfYearOf({ month: 3, day: 1 }) === 60, T, 'dayOfYearOf');
  const xmas = { from: { month: 12, day: 20 }, to: { month: 1, day: 5 } };
  expect(inDateRange(355, xmas) && inDateRange(365, xmas) && inDateRange(1, xmas) && inDateRange(5, xmas), T, 'date range across New Year should include 21 Dec, 31 Dec, 1 Jan, 5 Jan');
  expect(!inDateRange(6, xmas) && !inDateRange(353, xmas) && !inDateRange(180, xmas), T, 'date range across New Year should exclude 6 Jan, 19 Dec, June');
  expect(!isValidMonthDay({ month: 2, day: 29 }) && isValidMonthDay({ month: 2, day: 28 }), T, 'non-leap calendar');

  // Place.
  const circle = mk({});
  expect(rejectReason(circle, base(), opts) === null, T, 'inside the circle should be eligible');
  expect(rejectReason(circle, base({ position: { x: 150, z: 0 } }), opts) === 'place', T, 'outside the circle should be rejected by place');
  expect(rejectReason(circle, base()) === 'status', T, 'drafts are skipped unless includeDrafts');

  // Player settings (Ayarlar → Oyun → Anlar).
  const prefs = defaultMomentPrefs();
  expect(rejectReason(circle, base(), { ...opts, prefs }) === null, T, 'default prefs allow every category');
  prefs.categories.legend = false;
  expect(rejectReason(circle, base(), { ...opts, prefs }) === 'disabled', T, 'a switched-off category is rejected');
  expect(rejectReason({ ...circle, category: 'poem' }, base(), { ...opts, prefs }) === null, T, 'other categories still play');
  prefs.categories.legend = true;
  prefs.enabled = false;
  expect(rejectReason({ ...circle, category: 'poem' }, base(), { ...opts, prefs }) === 'disabled', T, 'the master switch silences everything');
  const square = mk({ place: { label: 'sq', area: [{ lat: 41.04, lon: 29.01 }, { lat: 41.04, lon: 29.03 }, { lat: 41.05, lon: 29.03 }, { lat: 41.05, lon: 29.01 }] } });
  expect(rejectReason(square, base(), opts) === null && rejectReason(square, base({ position: at(41.06, 29.02) }), opts) === 'place', T, 'area polygon');
  const anchored = mk({ place: { label: 'ferry', anchor: 'ferry', radius: 60 } });
  expect(rejectReason(anchored, base(), opts) === 'place', T, 'anchor place without anchors is out of range');
  expect(rejectReason(anchored, base({ anchors: { ferry: [{ x: 500, z: 0 }, { x: 40, z: 30 }] } }), opts) === null, T, 'anchor place near the second ferry');

  // Surface and altitude.
  const ground = mk({ surface: 'ground' });
  expect(rejectReason(ground, base(), opts) === 'surface' && rejectReason(ground, base({ grounded: true, agl: 0 }), opts) === null, T, 'ground surface');
  expect(rejectReason(mk({ surface: 'air' }), base({ grounded: true }), opts) === 'surface', T, 'air surface while grounded');
  const band = mk({ altitude: [{ ref: 'asl', min: 50, max: 300 }, { ref: 'agl', max: 100 }] });
  expect(rejectReason(band, base(), opts) === null, T, 'inside both altitude bands');
  expect(rejectReason(band, base({ altitude: 400 }), opts) === 'altitude' && rejectReason(band, base({ agl: 150 }), opts) === 'altitude', T, 'outside an altitude band');
  expect(rejectReason(mk({ flightModes: ['gliding'] }), base({ flightMode: 'flying' }), opts) === 'flight-mode', T, 'flight mode filter');
  const shore = mk({ shoreDistance: { min: -150, max: 30 } });
  expect(rejectReason(shore, base(), opts) === null && rejectReason(shore, base({ coastDistance: -400 }), opts) === 'shore' && rejectReason(shore, base({ coastDistance: undefined }), opts) === 'shore', T, 'shore distance');

  // Time, season, date, weather.
  const night = mk({ timeOfDay: { from: 21, to: 4 } });
  expect(rejectReason(night, base({ timeOfDay: 23.5 }), opts) === null && rejectReason(night, base({ timeOfDay: 0.5 }), opts) === null, T, 'night window past midnight');
  expect(rejectReason(night, base({ timeOfDay: 12 }), opts) === 'time-of-day', T, 'night window at noon');
  const winter = mk({ seasons: ['winter'] });
  expect(rejectReason(winter, base({ dayOfYear: 15 }), opts) === null && rejectReason(winter, base({ dayOfYear: 350 }), opts) === null && rejectReason(winter, base({ dayOfYear: 100 }), opts) === 'season', T, 'winter season spans New Year');
  const newYear = mk({ dateRange: xmas });
  expect(rejectReason(newYear, base({ dayOfYear: 2 }), opts) === null && rejectReason(newYear, base({ dayOfYear: 200 }), opts) === 'date', T, 'date range in the evaluator');
  const dry = mk({ weather: ['clear', 'haze'] });
  expect(rejectReason(dry, base({ weather: 'rain' }), opts) === 'weather' && rejectReason(dry, base({ weather: 'custom' }), opts) === 'weather' && rejectReason(dry, base(), opts) === null, T, 'weather filter');

  // Session: once per session and cooldown.
  const once = mk({}, 'once');
  const s1 = markFired(emptySession, 'once', 1000);
  expect(emptySession.lastFired.size === 0, T, 'markFired must not mutate the input session');
  expect(rejectReason(once, base({ session: s1 }), opts) === 'once' && rejectReason(once, base({ session: { ...s1, now: 1e6 } }), opts) === 'once', T, 'once per session never repeats');
  const rep = mk({ repeat: { kind: 'repeatable', cooldownSec: 300 } }, 'rep');
  const s2 = markFired(emptySession, 'rep', 1000);
  expect(rejectReason(rep, base({ session: { ...s2, now: 1100 } }), opts) === 'cooldown', T, 'repeatable inside the cooldown');
  expect(rejectReason(rep, base({ session: { ...s2, now: 1299.9 } }), opts) === 'cooldown', T, 'repeatable just before the cooldown ends');
  expect(rejectReason(rep, base({ session: { ...s2, now: 1300 } }), opts) === null, T, 'repeatable after the cooldown');
  expect(rejectReason(rep, base({ session: s1 }), opts) === null, T, 'other moments do not share a cooldown');

  // Ordering and determinism.
  const far = mk({ place: { label: 'far', center: { lat: 41.045, lon: 29.02 }, radius: 1000 } }, 'b-far');
  const near = mk({ place: { label: 'near', center: { lat: 41.045, lon: 29.0205 }, radius: 1000 } }, 'a-near');
  const ctx = base({ position: at(41.045, 29.021) });
  const r1 = eligibleMoments([far, near], ctx, opts).map((e) => e.moment.id);
  const r2 = eligibleMoments([near, far], ctx, opts).map((e) => e.moment.id);
  expect(r1.join() === 'a-near,b-far' && r1.join() === r2.join(), T, `nearest first and order-independent (got ${r1.join()} / ${r2.join()})`);

  // Real records in plausible situations.
  const find = (id: string) => ALL_MOMENTS.find((m) => m.id === id)!;
  const galata = at(41.02563, 28.97421);
  const hezCtx = base({ position: { x: galata.x + 50, z: galata.z }, altitude: 120, agl: 70, timeOfDay: 10 });
  expect(rejectReason(find('hezarfen-galata-uskudar'), hezCtx, opts) === null, T, 'Hezarfen above the Galata Tower at 10:00');
  expect(rejectReason(find('hezarfen-galata-uskudar'), { ...hezCtx, timeOfDay: 22 }, opts) === 'time-of-day', T, 'Hezarfen is a daytime moment');
  const kiz = at(41.02111, 29.0041);
  const kizCtx = base({ position: kiz, altitude: 20, agl: 20, timeOfDay: 1 });
  expect(rejectReason(find('kiz-kulesi-legend'), kizCtx, opts) === null, T, 'Kız Kulesi at 01:00');
  expect(rejectReason(find('kiz-kulesi-legend'), { ...kizCtx, timeOfDay: 13 }, opts) === 'time-of-day', T, 'Kız Kulesi legend waits for the night');
  const stork = find('storks-bosphorus-migration');
  const storkCtx = base({ position: at(41.1, 29.07), altitude: 500, agl: 480, timeOfDay: 11 });
  expect(rejectReason(stork, { ...storkCtx, dayOfYear: dayOfYearOf({ month: 9, day: 10 }) }, opts) === null, T, 'storks on 10 September');
  expect(rejectReason(stork, { ...storkCtx, dayOfYear: dayOfYearOf({ month: 12, day: 10 }) }, opts) === 'date', T, 'no storks in December');
}

/* ------------------------------------------------------------------ */

console.log(`moments-check: ${ALL_MOMENTS.length} records`);
console.log('1. records');
const ids = new Set<string>();
for (const m of ALL_MOMENTS) {
  expect(!ids.has(m.id), m.id, 'duplicate id');
  ids.add(m.id);
  validateRecord(m);
}
console.log('2. geography');
checkGeo();
console.log('3. trigger evaluator');
testTriggers();

for (const m of ALL_MOMENTS) {
  console.log(`  ${m.status.padEnd(5)} #${String(m.backlog).padStart(2)} ${m.id.padEnd(34)} needs: ${m.needs.join(', ') || '-'}`);
}
console.log(`moments-check: ${checks} checks, ${failures} failed, ${warnings} warnings`);
process.exit(failures > 0 ? 1 : 0);
