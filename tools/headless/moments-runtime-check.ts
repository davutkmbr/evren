/**
 * Headless check of the moment runtime (src/moments/runtime.ts): a scripted dragon flies the real geography and the
 * runner decides. No browser, no GPU.
 *
 *   npx tsx tools/headless/moments-runtime-check.ts
 *
 * 1. Geography: the Bosphorus corridor polygon covers the strait's water and both shores in world coordinates; the
 *    poem's waypoints and the ?moment= start pose sit where they should.
 * 2. Playability: which records play now (the poem, subtitle-only with a missing optional sound; the storks, ready
 *    with procedural content) and which wait.
 * 3. The poem on a low glide along the European shore from Beşiktaş toward Bebek: fires exactly once per session,
 *    after the dwell time, with the subtitle timeline of the record (4 s lines, 0.5 s gaps), the card at the end and
 *    the ambience lift; it does not fire when high, inland, in rain or storm, while flapping, during a race, or with
 *    its category (or the master switch) off.
 * 4. Pacing while playing: pause freezes it, a few wing beats or a small climb do not end it, leaving the band fades
 *    the line out (and a moment cut short early may try again later, one cut late is spent), a race or the settings
 *    end it, the global gap keeps moments apart, and the ?moment= shortcut forces one.
 * 5. The stork migration over the strait: the ?moment= start pose; fires once (with its actor started and ended, no
 *    ambience fallback) on a 420 m glide on 5 September at 11:00; stays silent outside 15 Aug – 15 Oct, 09–17 h,
 *    clear / haze, 150–1500 m ASL, on the ground, in a race, with city life off or outside the corridor; climbing out
 *    ends the lines; the 30 min cooldown; forcing ignores every gate; the kettle site is ahead, in view, around the
 *    dragon's altitude and often on a real thermal of the lift field.
 * 6. The "[I] Kaynağa bak" prompt (src/moments/sources.ts): offered on every frame of a moment with sources and for
 *    SOURCE_PROMPT_AFTER_S after it, not before, not after the window, not for a moment without sources, not while a
 *    race runs (a race also ends the window); the after-moment hint item is deferred by a race and ranks low.
 * 7. The gull and simit on a ferry (moving anchor 'ferry' from the anchor feed): fires gliding, hovering or perched
 *    near a ferry in service and names that ferry; not far from it, not at a stopped ferry, not at night, in rain or
 *    storm, high above, diving or swimming, during a race or with city life off, not along a shore without ferries;
 *    the hold follows the ferry as it pulls away, flying off ends it, the 600 s cooldown, the forced anchor and the
 *    ?moment= placement beside the ferry.
 * 8. The literary moments (backlog 16, src/moments/data/literature.ts): the eight playable ones fire once in their
 *    situation on the real geography (every line, the card, no ambience lift) and stay silent far away, outside their
 *    hours, weather, sea fog, altitude band or flight mode, on the ground, in a race or with their category off; the
 *    ?moment= start pose heads for the target clear of the surface and the forced moment plays anywhere; the two
 *    pending ones do not play; every record's sources validate.
 * Exits non-zero on any failure.
 */
import { latLonToLocal, localToLatLon, WORLD_ORIGIN } from '../../src/core/geo-coords';
import type { FlightMode, WeatherPreset } from '../../src/core/contracts';
import { ALL_MOMENTS } from '../../src/moments/data';
import { LITERATURE } from '../../src/moments/data/literature';
import { BOSPHORUS_CORRIDOR } from '../../src/moments/data/city-life';
import { defaultMomentPrefs, onMomentPrefsChange, saveMomentPrefs, type MomentPrefs } from '../../src/moments/prefs';
import { momentPlayability, MomentRunner, momentStartPose, type MomentFrame, type MomentSink } from '../../src/moments/runtime';
import { pointInPolygon, type MomentContext, type XZ } from '../../src/moments/triggers';
import type { Moment, SubtitleLine } from '../../src/moments/types';
import { SOURCE_PROMPT_AFTER_S, SourcePromptWindow, validateMomentSources, type SourcePromptState } from '../../src/moments/sources';
import { HUD_PRIORITY, HudDirector } from '../../src/ui/zones/director';
import { buildHeadlessGeo } from './geo';
import { AnchorFeed, ferryShortcut, inService } from '../../src/moments/anchors';
import type { LifeService, VesselPose } from '../../src/core/contracts';
import * as THREE from 'three';
import { chooseKettleSite, STORK_SITE } from '../../src/moments/storks/site';
import { dayOfYearOf } from '../../src/moments/triggers';

let failures = 0;
let checks = 0;
function check(cond: boolean, msg: string): void {
  checks++;
  if (!cond) {
    failures++;
    console.log(`  FAIL ${msg}`);
  }
}

const POEM_ID = 'orhan-veli-istanbulu-dinliyorum';
const poem = ALL_MOMENTS.find((m) => m.id === POEM_ID)!;
const GULL_ID = 'ferry-gull-simit';
const gull = ALL_MOMENTS.find((m) => m.id === GULL_ID)!;
const STORKS_ID = 'storks-bosphorus-migration';
const storks = ALL_MOMENTS.find((m) => m.id === STORKS_ID)!;
const FPS = 24;
const DT = 1 / FPS;
const STRAIT = 'İstanbul Boğazı';

const t0 = Date.now();
const geo = buildHeadlessGeo();
console.log(`moments-runtime-check (geo built in ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
const corridor = BOSPHORUS_CORRIDOR.map((ll) => latLonToLocal(ll.lat, ll.lon));

/* ------------------------------------------------------------------ */
/* 1. Geography                                                         */
/* ------------------------------------------------------------------ */
console.log('1. geography');
{
  const o = latLonToLocal(WORLD_ORIGIN.lat, WORLD_ORIGIN.lon);
  check(Math.abs(o.x) < 1e-6 && Math.abs(o.z) < 1e-6, 'lat/lon: the world origin maps to (0, 0)');
  const bebek = latLonToLocal(41.0765, 29.0435);
  check(bebek.x > 1000 && bebek.z < -3000, `lat/lon: Bebek lies north-east of the origin (+x east, -z north), got (${bebek.x.toFixed(0)}, ${bebek.z.toFixed(0)})`);
  const back = localToLatLon(bebek.x, bebek.z);
  check(Math.abs(back.lat - 41.0765) < 1e-6 && Math.abs(back.lon - 29.0435) < 1e-6, 'lat/lon round trip');

  // Every water cell of the strait lies inside the corridor.
  let strait = 0;
  let inside = 0;
  for (let x = -24000; x < 24000; x += 200) {
    for (let z = -24000; z < 24000; z += 200) {
      if (geo.waterNameAt?.(x, z) === STRAIT) {
        strait++;
        if (pointInPolygon({ x, z }, corridor)) inside++;
      }
    }
  }
  check(strait > 800, `the strait has water cells (${strait})`);
  check(inside === strait, `corridor covers the Bosphorus water: ${inside} / ${strait} cells`);

  // Both shores: land within 30 m of the coast next to the strait's water lies inside the corridor.
  let shore = 0;
  let shoreInside = 0;
  let europe = 0;
  let asia = 0;
  for (let x = -24000; x < 24000; x += 100) {
    for (let z = -24000; z < 24000; z += 100) {
      const cd = geo.coastDistance(x, z);
      if (cd < 0 || cd > 30) continue;
      let byStrait = false;
      for (const [dx, dz] of [[80, 0], [-80, 0], [0, 80], [0, -80]]) {
        if (geo.waterNameAt?.(x + dx, z + dz) === STRAIT) byStrait = true;
      }
      if (!byStrait) continue;
      shore++;
      if (pointInPolygon({ x, z }, corridor)) shoreInside++;
      const side = geo.districtAt(x, z)?.side;
      if (side === 'europe') europe++;
      if (side === 'asia') asia++;
    }
  }
  check(shore > 200 && shoreInside / shore > 0.98, `corridor covers the Bosphorus shores: ${shoreInside} / ${shore} shore points`);
  check(europe > 50 && asia > 50, `shore points on both sides (europe ${europe}, asia ${asia})`);

  // The poem's waypoints: over the strait, inside the corridor, near the shore.
  for (const wp of poem.content.waypoints ?? []) {
    const q = latLonToLocal(wp.lat, wp.lon);
    const cd = geo.coastDistance(q.x, q.z);
    check(geo.waterNameAt?.(q.x, q.z) === STRAIT, `poem waypoint ${wp.id} is on the Bosphorus (${geo.waterNameAt?.(q.x, q.z)})`);
    check(pointInPolygon(q, corridor), `poem waypoint ${wp.id} inside the corridor`);
    check(cd < 0 && cd > -150, `poem waypoint ${wp.id} within 150 m of the shore (coast distance ${cd.toFixed(0)} m)`);
  }
  const pose = momentStartPose(poem);
  check(!!pose, 'poem has a start pose for ?moment=');
  if (pose) {
    const cd = geo.coastDistance(pose.x, pose.z);
    check(geo.isWater(pose.x, pose.z) && cd >= -150 && cd <= 30, `start pose over water near the shore (coast distance ${cd.toFixed(0)} m)`);
    check(pose.y >= 8 && pose.y <= 40, `start pose inside the ≤ 40 m band (${pose.y} m over the water)`);
    check(pose.headingDeg > 10 && pose.headingDeg < 80, `start pose heads north-east up the shore (${pose.headingDeg.toFixed(0)}°)`);
    const west = geo.districtAt(pose.x - 600, pose.z);
    check(west?.side === 'europe', `the shore west of the start is European (${west?.name})`);
  }
}

/* ------------------------------------------------------------------ */
/* 2. Playability                                                       */
/* ------------------------------------------------------------------ */
console.log('2. playability');
{
  const pp = momentPlayability(poem);
  check(pp.playable && pp.soundFallback, 'the poem plays now (draft, only its optional sound missing → ambience fallback)');
  const ps = momentPlayability(storks);
  check(ps.playable && !ps.soundFallback, `the storks play now (ready, procedural flock and synthesised sound, no ambience fallback) ${ps.reason ?? ''}`);
  const gp = momentPlayability(gull);
  check(gull.status === 'ready' && gp.playable && !gp.soundFallback, `the ferry gull moment plays now (ready; procedural flock, its own gull calls, no ambience fallback) ${gp.reason ?? ''}`);
  // The literary moments (backlog 16) are covered in section 8.
  for (const m of ALL_MOMENTS) {
    if (m === poem || m === storks || m === gull || LITERATURE.includes(m)) continue;
    const p = momentPlayability(m);
    check(!p.playable && !!p.reason, `${m.id} waits (${p.reason})`);
  }
  const base: Moment = { ...poem, id: 'test' };
  check(!momentPlayability({ ...base, content: { ...base.content, actorId: 'moments/x' } }).playable, 'a draft with a character is not playable while its sound is missing');
  check(!momentPlayability({ ...base, needs: ['sound', 'text-approval'] }).playable, 'a draft waiting for text approval is not playable');
  check(momentPlayability({ ...base, status: 'ready', needs: [] }).playable, 'a ready moment is playable');
  check(!momentPlayability({ ...storks, content: { ...storks.content, actorId: 'moments/unknown-actor' } }).playable, 'a ready moment whose actor has no procedural implementation is not playable');
  check(momentPlayability({ ...base, needs: [], content: { ...base.content, soundId: 'moments/x' } }, new Set(['moments/x'])).soundFallback === false, 'an available sound needs no fallback');
}

/* ------------------------------------------------------------------ */
/* Scripted flight                                                      */
/* ------------------------------------------------------------------ */

/** Points ~60 m off the European shore from Beşiktaş to Bebek (found on the real coastline). */
function shorePath(offshore = 60): XZ[] {
  const pts: XZ[] = [];
  for (let lat = 41.041; lat <= 41.0765; lat += 0.0005) {
    for (let lon = 28.99; lon < 29.09; lon += 0.0002) {
      const p = latLonToLocal(lat, lon);
      if (geo.waterNameAt?.(p.x, p.z) !== STRAIT) continue;
      let l2 = lon;
      let q = p;
      while (geo.coastDistance(q.x, q.z) > -offshore && l2 < lon + 0.01) {
        l2 += 0.00005;
        q = latLonToLocal(lat, l2);
      }
      pts.push(q);
      break;
    }
  }
  return pts;
}

/** Resamples a polyline at `speed` m/s: one position per frame, there and back again for `seconds`. */
function flyAlong(path: XZ[], speed: number, seconds: number): XZ[] {
  const seg: number[] = [0];
  for (let i = 1; i < path.length; i++) seg.push(seg[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z));
  const total = seg[seg.length - 1];
  const out: XZ[] = [];
  for (let f = 0; f < seconds * FPS; f++) {
    let s = (f * DT * speed) % (2 * total);
    if (s > total) s = 2 * total - s;
    let i = 1;
    while (i < seg.length - 1 && seg[i] < s) i++;
    const k = (s - seg[i - 1]) / Math.max(1e-6, seg[i] - seg[i - 1]);
    out.push({ x: path[i - 1].x + (path[i].x - path[i - 1].x) * k, z: path[i - 1].z + (path[i].z - path[i - 1].z) * k });
  }
  return out;
}

interface Log {
  shows: { t: number; index: number; line: SubtitleLine }[];
  hides: { t: number; how: 'end' | 'fade' }[];
  cards: number[];
  lift: number[];
  starts: { id: string; forced: boolean; t: number }[];
  ends: { id: string; reason: string; t: number }[];
}

function harness(moments: readonly Moment[] = ALL_MOMENTS, pacing = {}) {
  const log: Log = { shows: [], hides: [], cards: [], lift: [], starts: [], ends: [] };
  let runner!: MomentRunner;
  const sink: MomentSink = {
    showLine: (_m, line, index) => log.shows.push({ t: runner.now, index, line }),
    hideLine: (_m, how) => log.hides.push({ t: runner.now, how }),
    showCard: () => log.cards.push(runner.now),
    setAmbienceLift: (v) => log.lift.push(v),
    startMoment: (m, forced) => log.starts.push({ id: m.id, forced, t: runner.now }),
    endMoment: (m, reason) => log.ends.push({ id: m.id, reason, t: runner.now }),
  };
  runner = new MomentRunner(moments, sink, { pacing });
  return { runner, log };
}

interface Flight {
  agl: number;
  mode: FlightMode;
  weather: WeatherPreset;
  racing: boolean;
  prefs: MomentPrefs;
  timeOfDay: number;
}

function frameAt(p: XZ, f: Flight): MomentFrame {
  const ctx: Omit<MomentContext, 'session'> = {
    position: p,
    altitude: Math.max(0, geo.heightAt(p.x, p.z)) + f.agl,
    agl: f.agl,
    grounded: f.mode === 'grounded',
    flightMode: f.mode,
    coastDistance: geo.coastDistance(p.x, p.z),
    timeOfDay: f.timeOfDay,
    dayOfYear: 269,
    weather: f.weather,
  };
  return { context: ctx, prefs: f.prefs, racing: f.racing };
}

const flight = (over: Partial<Flight> = {}): Flight => ({ agl: 25, mode: 'gliding', weather: 'clear', racing: false, prefs: defaultMomentPrefs(), timeOfDay: 14, ...over });

/** Flies `positions` with a per-frame flight state; returns the runner's history. */
function fly(runner: MomentRunner, positions: XZ[], state: (i: number) => Flight): void {
  positions.forEach((p, i) => runner.update(DT, frameAt(p, state(i))));
}

const path = shorePath();
const SPEED = 22;

/* ------------------------------------------------------------------ */
/* 3. The poem on a low glide                                           */
/* ------------------------------------------------------------------ */
console.log('3. the poem along the shore');
{
  check(path.length > 50, `found the shore path (${path.length} points)`);
  let inBand = 0;
  for (const p of path) {
    const cd = geo.coastDistance(p.x, p.z);
    if (pointInPolygon(p, corridor) && cd >= -150 && cd <= 30) inBand++;
  }
  check(inBand === path.length, `the whole Beşiktaş → Bebek path is inside the corridor and the shore band (${inBand} / ${path.length})`);

  const { runner, log } = harness();
  const positions = flyAlong(path, SPEED, 600);
  const liftDuring: number[] = [];
  positions.forEach((p, i) => {
    runner.update(DT, frameAt(p, flight()));
    if (runner.current) liftDuring.push(runner.ambienceLift);
  });
  const plays = runner.history.filter((h) => h.id === POEM_ID);
  check(plays.length === 1, `the poem fired exactly once in 10 minutes of low gliding (fired ${plays.length}×)`);
  const h = plays[0];
  if (h) {
    check(h.reason === 'complete' && !h.forced, `it played to the end (${h.reason})`);
    check(Math.abs(h.start - runner.pacing.dwellSec) <= DT + 1e-6, `it started after the ${runner.pacing.dwellSec} s dwell (at ${h.start.toFixed(3)} s)`);
    const subs = poem.content.subtitles;
    check(log.shows.length === subs.length && h.linesShown === subs.length, `all ${subs.length} lines shown (${log.shows.length})`);
    let timingOk = true;
    subs.forEach((s, i) => {
      const show = log.shows[i];
      const hide = log.hides[i];
      if (!show || show.index !== i || show.line.text !== s.text || Math.abs(show.t - (h.start + s.at)) > DT + 1e-6) timingOk = false;
      if (!hide || hide.how !== 'end' || Math.abs(hide.t - (h.start + s.at + s.duration)) > DT + 1e-6) timingOk = false;
    });
    check(timingOk, 'each line shows at start + 4.5 s × i for 4 s (±1 frame), then a 0.5 s gap');
    check(subs.every((s) => s.duration === 4) && subs.every((s, i) => i === 0 || Math.abs(s.at - subs[i - 1].at - 4.5) < 1e-9), 'the record keeps 4 s lines with 0.5 s gaps');
    check(log.cards.length === 1 && Math.abs(log.cards[0] - h.end) < 1e-6, 'the card shows once, at the end');
    check(Math.abs(h.end - h.start - (subs[subs.length - 1].at + 4)) <= DT + 1e-6, `the poem lasts ${(h.end - h.start).toFixed(2)} s`);
  }
  check(Math.max(...liftDuring) > 0.99 && log.lift[log.lift.length - 1] === 0, 'the coastal ambience lifts while it plays and settles back after');

  const variants: Array<[string, Partial<Flight> | ((i: number) => Partial<Flight>), XZ[]?]> = [
    ['high (120 m AGL)', { agl: 120 }],
    ['just above the band (45 m AGL)', { agl: 45 }],
    ['in rain', { weather: 'rain' }],
    ['in a storm', { weather: 'storm' }],
    ['while flapping (flying, not gliding)', { mode: 'flying' }],
    ['during a race', { racing: true }],
    ['with the poem category off', { prefs: { enabled: true, categories: { legend: true, 'city-life': true, poem: false } } }],
    ['with Anlar off', { prefs: { enabled: false, categories: { legend: true, 'city-life': true, poem: true } } }],
    ['gliding in bursts shorter than the dwell', (i) => ({ mode: i % 18 < 12 ? 'gliding' : 'flying' })],
  ];
  // Inland: the same line moved 1.5 km west over the European side (Beşiktaş, Levent hills).
  const inland = path.map((p) => ({ x: p.x - 1500, z: p.z }));
  check(inland.every((p) => !geo.isWater(p.x, p.z) && geo.coastDistance(p.x, p.z) > 200), 'the inland path is over land, far from the shore');
  variants.push(['over land far from the shore', {}, inland]);
  for (const [label, over, alt] of variants) {
    const r = harness().runner;
    const pos = flyAlong(alt ?? path, SPEED, 300);
    fly(r, pos, (i) => flight(typeof over === 'function' ? over(i) : over));
    // Over the inland hills a 25 m glide can be 150 m above the sea: the storks may play there, the poem never.
    const fired = alt ? r.history.filter((x) => x.id === POEM_ID) : r.history;
    check(fired.length === 0, `no ${alt ? 'poem' : 'moment'} ${label} (fired ${fired.map((x) => x.id).join(', ') || 'nothing'})`);
  }
  // In fog and haze it may play.
  for (const weather of ['fog', 'haze'] as const) {
    const r = harness().runner;
    fly(r, flyAlong(path, SPEED, 60), () => flight({ weather }));
    check(r.history.length === 1, `plays in ${weather}`);
  }
}

/* ------------------------------------------------------------------ */
/* 4. Pacing while playing                                              */
/* ------------------------------------------------------------------ */
console.log('4. pacing');
{
  const positions = flyAlong(path, SPEED, 600);

  // Pause freezes the timeline.
  {
    const { runner, log } = harness();
    let i = 0;
    while (!runner.current && i < positions.length) runner.update(DT, frameAt(positions[i++], flight()));
    for (let k = 0; k < 48; k++) runner.update(DT, frameAt(positions[i++], flight()));
    const line = runner.currentLine;
    const now = runner.now;
    const shows = log.shows.length;
    for (let k = 0; k < 24 * 60; k++) runner.update(0, frameAt(positions[i], flight({ agl: 300, racing: true })));
    check(runner.now === now && runner.currentLine === line && log.shows.length === shows && !!runner.current, 'a paused minute (menu, photo mode) changes nothing, even with the dragon "elsewhere"');
  }

  // Once started it plays to the end (owner decision, 26 Sep): wing beats, a hover, climbing out of the band or flying
  // far away do not cut it short.
  {
    const { runner, log } = harness();
    fly(runner, positions.slice(0, 40 * FPS), (i) => {
      const t = i * DT;
      if (t > 6 && t < 7) return flight({ mode: 'flying' });
      if (t > 10 && t < 14) return flight({ agl: 300 });
      if (t > 16 && t < 20) return flight({ mode: 'hovering' });
      return flight();
    });
    check(runner.history[0]?.reason === 'complete', `flapping, climbing to 300 m and a 4 s hover do not end it (${runner.history[0]?.reason})`);
    check(log.hides.every((h) => h.how === 'end'), 'no line fades out early');
  }
  {
    const { runner, log } = harness();
    let climbAt = -1;
    fly(runner, positions.slice(0, 40 * FPS), (i) => {
      const t = i * DT;
      if (runner.currentLine === 1 && climbAt < 0) climbAt = t;
      return climbAt >= 0 ? flight({ agl: 900, mode: 'flying' }) : flight();
    });
    const h = runner.history[0];
    check(h?.reason === 'complete' && log.cards.length === 1, `leaving its band for good after line 2: it still plays every line and its card (${h?.reason}, cards ${log.cards.length})`);
  }

  // No other moment may start while one plays, and never right after one ends (the global gap applies to every end).
  {
    const { runner } = harness();
    const starts: number[] = [];
    let playing = false;
    fly(runner, positions.slice(0, 400 * FPS), () => {
      if (!!runner.current !== playing) {
        playing = !!runner.current;
        if (playing) starts.push(runner.now);
      }
      return flight();
    });
    let overlap = false;
    for (let k = 1; k < runner.history.length; k++) overlap ||= runner.history[k].start < runner.history[k - 1].end + runner.pacing.minGapSec - 1e-6;
    check(!overlap, `consecutive moments keep the ${runner.pacing.minGapSec} s gap (${runner.history.length} played)`);
  }

  // Cut short early by a race → it may try again after retrySec and the global gap, not before.
  {
    const { runner } = harness();
    let raceFrom = -1;
    fly(runner, positions.slice(0, 20 * FPS), (i) => {
      if (runner.currentLine === 1 && raceFrom < 0) raceFrom = i;
      return raceFrom >= 0 && i < raceFrom + 2 * FPS ? flight({ racing: true }) : flight();
    });
    const h = runner.history[0];
    check(h?.reason === 'race', `a race cuts it after 2 lines (${h?.reason})`);
    const cut = h?.end ?? 0;
    const wait = Math.max(runner.pacing.retrySec, runner.pacing.minGapSec);
    fly(runner, positions.slice(0, Math.round((cut + wait - 1 - runner.now) * FPS)), () => flight());
    check(runner.history.length === 1 && !runner.current, 'cut short after 2 lines: not again before the retry time and the gap');
    fly(runner, positions.slice(0, 40 * FPS), () => flight());
    check(runner.history.length === 2 && runner.history[1].start >= cut + wait - 1e-6, 'but it may play again after them');
  }

  // Race and settings end a playing moment.
  {
    const { runner, log } = harness();
    let raceAt = -1;
    fly(runner, positions.slice(0, 20 * FPS), (i) => {
      if (runner.currentLine === 2 && raceAt < 0) raceAt = i;
      return flight({ racing: raceAt >= 0 && i > raceAt });
    });
    check(runner.history[0]?.reason === 'race' && log.hides[log.hides.length - 1]?.how === 'fade', 'a race starting ends it at once');
  }
  {
    const { runner } = harness();
    let offAt = -1;
    fly(runner, positions.slice(0, 20 * FPS), (i) => {
      if (runner.currentLine === 1 && offAt < 0) offAt = i;
      return flight(offAt >= 0 && i > offAt ? { prefs: { enabled: true, categories: { legend: true, 'city-life': true, poem: false } } } : {});
    });
    check(runner.history[0]?.reason === 'disabled', 'switching the poem category off ends it');
  }

  // Global gap: a second (synthetic, repeatable) moment on the same shore waits minGapSec after the poem.
  {
    const other: Moment = { ...poem, id: 'test-repeatable', trigger: { ...poem.trigger, repeat: { kind: 'repeatable', cooldownSec: 30 } } };
    const { runner } = harness([poem, other]);
    fly(runner, positions, () => flight());
    const [a, b] = runner.history;
    check(!!a && !!b, `two moments played in 10 minutes (${runner.history.length})`);
    if (a && b) {
      check(b.start - a.end >= runner.pacing.minGapSec - 1e-6 && b.start - a.end <= runner.pacing.minGapSec + runner.pacing.dwellSec + 2 * DT, `the next one waits the ${runner.pacing.minGapSec} s gap (${(b.start - a.end).toFixed(1)} s)`);
    }
    check(runner.history.filter((x) => x.id === POEM_ID).length === 1, 'the poem itself still once');
  }

  // The ?moment= shortcut: plays whatever the conditions, but not during a race.
  {
    const { runner, log } = harness();
    check(!runner.force('hezarfen-galata-uskudar') && !runner.force('nope'), 'force refuses unplayable or unknown ids');
    check(runner.force(POEM_ID), 'force accepts the poem');
    const high = { x: -8000, z: 5000 };
    for (let k = 0; k < 5 * FPS; k++) runner.update(DT, frameAt(high, flight({ agl: 400, racing: true, weather: 'rain' })));
    check(runner.history.length === 0 && !runner.current, 'a forced moment waits while a race runs');
    for (let k = 0; k < 40 * FPS; k++) runner.update(DT, frameAt(high, flight({ agl: 400, weather: 'rain', mode: 'flying' })));
    check(runner.history[0]?.forced === true && runner.history[0]?.reason === 'complete' && log.cards.length === 1, 'forced: plays to the end high over land in the rain');
  }

  // Settings notify the runtime (Ayarlar → Oyun → Anlar).
  {
    let seen: MomentPrefs | null = null;
    const off = onMomentPrefsChange((p) => {
      seen = p;
    });
    const prefs = defaultMomentPrefs();
    prefs.categories.poem = false;
    saveMomentPrefs(prefs);
    off();
    const got = seen as MomentPrefs | null;
    check(!!got && got.categories.poem === false && got !== prefs, 'saving the settings notifies the runtime with a copy (even without storage)');
  }
}

/* ------------------------------------------------------------------ */
/* 5. The stork migration                                               */
/* ------------------------------------------------------------------ */
console.log('5. storks over the Bosphorus');
{
  // Start pose of the ?moment= shortcut: over the strait, inside the band, heading up the strait for the narrows.
  const pose = momentStartPose(storks);
  check(!!pose, 'storks have a start pose for ?moment=');
  if (pose) {
    check(geo.waterNameAt?.(pose.x, pose.z) === STRAIT && pointInPolygon(pose, corridor), 'storks start over the Bosphorus inside the corridor');
    check(pose.y >= 300 && pose.y <= 600, `storks start at ${pose.y} m ASL (inside 150–1500, low enough to see the kettle rise)`);
    check(pose.headingDeg > 5 && pose.headingDeg < 60, `storks start heading north-north-east up the strait (${pose.headingDeg.toFixed(0)}°)`);
  }

  interface SF {
    asl: number;
    doy: number;
    tod: number;
    weather: WeatherPreset;
    mode: FlightMode;
    racing: boolean;
    prefs: MomentPrefs;
  }
  const sf = (o: Partial<SF> = {}): SF => ({ asl: 420, doy: dayOfYearOf({ month: 9, day: 5 }), tod: 11, weather: 'clear', mode: 'gliding', racing: false, prefs: defaultMomentPrefs(), ...o });
  const storkFrame = (p: XZ, f: SF): MomentFrame => ({
    context: {
      position: p,
      altitude: f.asl,
      agl: f.asl - Math.max(0, geo.heightAt(p.x, p.z)),
      grounded: f.mode === 'grounded',
      flightMode: f.mode,
      coastDistance: geo.coastDistance(p.x, p.z),
      timeOfDay: f.tod,
      dayOfYear: f.doy,
      weather: f.weather,
    },
    prefs: f.prefs,
    racing: f.racing,
  });
  const flyStorks = (runner: MomentRunner, positions: XZ[], state: (i: number) => SF, dt = DT): void => {
    positions.forEach((p, i) => runner.update(dt, storkFrame(p, state(i))));
  };
  // A flight up and down the strait's axis: Arnavutköy → the narrows → Sarıyer and back.
  const axis = [latLonToLocal(41.055, 29.04), latLonToLocal(41.07, 29.052), latLonToLocal(41.084, 29.0615), latLonToLocal(41.11, 29.058), latLonToLocal(41.15, 29.07)];
  check(axis.every((p) => pointInPolygon(p, corridor)), 'the strait axis flight stays inside the corridor');
  const strait = flyAlong(axis, 25, 400);

  // Fires under its conditions: once, after the dwell, the whole timeline, the card, the actor started and ended.
  {
    const { runner, log } = harness();
    flyStorks(runner, strait.slice(0, 120 * FPS), () => sf());
    const plays = runner.history.filter((h) => h.id === STORKS_ID);
    check(plays.length === 1 && plays[0].reason === 'complete' && !plays[0].forced, `storks fire once on a 420 m glide over the strait on 5 September at 11:00 (${plays.length}×, ${plays[0]?.reason})`);
    check(!!plays[0] && Math.abs(plays[0].start - runner.pacing.dwellSec) <= DT + 1e-6, `after the ${runner.pacing.dwellSec} s dwell (at ${plays[0]?.start.toFixed(2)} s)`);
    check(log.shows.length === storks.content.subtitles.length && log.cards.length === 1, `all ${storks.content.subtitles.length} lines and the card (${log.shows.length}, ${log.cards.length})`);
    check(log.starts.length === 1 && log.starts[0].id === STORKS_ID && !log.starts[0].forced, 'the flock actor is started once with the moment');
    check(log.ends.length === 1 && log.ends[0].reason === 'complete', 'and told when the lines are done');
    check(!log.lift.some((v) => v > 0), 'no ambience fallback: the storks bring their own synthesised sound');
  }
  // Windows: date, time, weather, altitude, surface, race, settings, place.
  const westLand = latLonToLocal(41.0, 28.8);
  check(!pointInPolygon(westLand, corridor), 'the far-west test point (Bakırköy side) is outside the corridor');
  const cases: [string, Partial<SF>, boolean, XZ[]?][] = [
    ['on 15 August (first day)', { doy: dayOfYearOf({ month: 8, day: 15 }) }, true],
    ['on 15 October (last day)', { doy: dayOfYearOf({ month: 10, day: 15 }) }, true],
    ['on 14 August', { doy: dayOfYearOf({ month: 8, day: 14 }) }, false],
    ['on 16 October', { doy: dayOfYearOf({ month: 10, day: 16 }) }, false],
    ['in July', { doy: dayOfYearOf({ month: 7, day: 10 }) }, false],
    ['in spring (April)', { doy: dayOfYearOf({ month: 4, day: 10 }) }, false],
    ['at 09:00', { tod: 9 }, true],
    ['at 08:45', { tod: 8.75 }, false],
    ['at 16:50', { tod: 16.8 }, true],
    ['at 17:15', { tod: 17.25 }, false],
    ['at night', { tod: 23 }, false],
    ['in haze', { weather: 'haze' }, true],
    ['in fog', { weather: 'fog' }, false],
    ['in rain', { weather: 'rain' }, false],
    ['in a storm', { weather: 'storm' }, false],
    ['at 160 m ASL', { asl: 160 }, true],
    ['at 140 m ASL', { asl: 140 }, false],
    ['at 1450 m ASL', { asl: 1450 }, true],
    ['at 1600 m ASL', { asl: 1600 }, false],
    ['while flapping (flying)', { mode: 'flying' }, true],
    ['on the ground', { mode: 'grounded' }, false],
    ['during a race', { racing: true }, false],
    ['with city life off', { prefs: { enabled: true, categories: { legend: true, 'city-life': false, poem: true } } }, false],
    ['outside the corridor (far west)', {}, false, [westLand, { x: westLand.x + 400, z: westLand.z }]],
  ];
  for (const [label, over, expected, path2] of cases) {
    const r = harness().runner;
    const pos = path2 ? flyAlong(path2, 25, 30) : strait.slice(0, 30 * FPS);
    flyStorks(r, pos, () => sf(over));
    const fired = r.history.some((h) => h.id === STORKS_ID);
    check(fired === expected, `storks ${expected ? 'fire' : 'do not fire'} ${label} (${fired ? 'fired' : 'silent'})`);
  }
  // Leaving the band while it plays: climbing to 1600 m no longer ends it, the lines play to the end.
  {
    const { runner, log } = harness();
    flyStorks(runner, strait.slice(0, 60 * FPS), (i) => sf({ asl: i * DT > 6 ? 1600 : 420 }));
    check(runner.history[0]?.reason === 'complete' && log.ends[0]?.reason === 'complete', `climbing out of the band does not cut the lines (${runner.history[0]?.reason})`);
  }
  // Cooldown: repeatable after 30 minutes, not before (the global 3-minute gap is shorter).
  {
    const { runner } = harness();
    const dt = 0.25;
    const long = flyAlong(axis, 25, 2400).filter((_, i) => i % 6 === 0);
    flyStorks(runner, long, () => sf(), dt);
    const plays = runner.history.filter((h) => h.id === STORKS_ID);
    check(plays.length === 2, `in 40 minutes over the strait the storks play twice (${plays.length}×)`);
    if (plays.length >= 2) {
      const gap = plays[1].start - plays[0].start;
      check(gap >= 1800 - 1e-6 && gap <= 1800 + runner.pacing.dwellSec + 2 * dt, `the second flock comes when the 30 min cooldown ends (${(gap / 60).toFixed(2)} min after the first)`);
    }
  }
  // Forced (?moment=storks-bosphorus-migration): plays whatever the date, time, weather and place.
  {
    const { runner, log } = harness();
    check(runner.force(STORKS_ID), 'force accepts the storks');
    const land = { x: -8000, z: 5000 };
    for (let k = 0; k < 40 * FPS; k++) runner.update(DT, storkFrame(land, sf({ doy: 20, tod: 22, weather: 'rain', asl: 60 })));
    check(runner.history[0]?.id === STORKS_ID && runner.history[0]?.forced === true && log.starts[0]?.forced === true, 'forced: plays in January at night in the rain, low over land, and starts its actor');
  }
  // The kettle site on the real geography: ahead of the dragon, in view, around its altitude; real thermals preferred.
  {
    const sun = new THREE.Vector3(-0.35, 0.8, 0.45).normalize();
    const wind = new THREE.Vector3(3, 0, 1.5);
    let real = 0;
    let n = 0;
    let bad = 0;
    for (let k = 0; k < axis.length; k++) {
      const p = axis[k];
      for (const heading of [20, 110, 200, 290]) {
        const site = chooseKettleSite(geo, { sunDirection: sun, wind, time: 100 * k }, p.x, p.z, 420, heading, (k * 4 + heading / 90) / 20);
        n++;
        if (site.real) real++;
        const d = Math.hypot(site.x - p.x, site.z - p.z);
        const bearing = ((Math.atan2(site.x - p.x, -(site.z - p.z)) * 180) / Math.PI + 360) % 360;
        const off = ((bearing - heading + 540) % 360) - 180;
        const ground = Math.max(0, geo.heightAt(site.x, site.z));
        const course = ((Math.atan2(site.courseX, -site.courseZ) * 180) / Math.PI + 360) % 360;
        const ok =
          d >= STORK_SITE.minDistance - 1 &&
          d <= STORK_SITE.maxDistance + 1 &&
          Math.abs(off) <= STORK_SITE.halfAngleDeg + 1 &&
          site.baseY <= 420 &&
          site.topY >= 420 &&
          site.baseY >= ground + STORK_SITE.clearance - 1e-6 &&
          Math.abs(course - STORK_SITE.courseDeg) <= STORK_SITE.courseSpreadDeg + 1e-6;
        if (!ok) {
          bad++;
          console.log(`  site from axis point ${k} heading ${heading}°: ${d.toFixed(0)} m at ${off.toFixed(0)}°, ${site.baseY.toFixed(0)}–${site.topY.toFixed(0)} m, course ${course.toFixed(0)}°`);
        }
      }
    }
    check(bad === 0, `kettle sites: ahead (320–1000 m), in view (±${STORK_SITE.halfAngleDeg}°), around the dragon's altitude, course south (${n - bad} / ${n})`);
    console.log(`  kettle sites on a real thermal (≥ ${STORK_SITE.realThermal} m/s) on an afternoon: ${real} / ${n}`);
    // The ?moment= start faces the narrows: morning, noon and afternoon suns all put the kettle on a real thermal.
    if (pose) {
      const suns = [new THREE.Vector3(0.3, 0.6, 0.7), new THREE.Vector3(0, 0.85, 0.5), new THREE.Vector3(-0.45, 0.7, 0.5)].map((v) => v.normalize());
      const sites = suns.map((s) => chooseKettleSite(geo, { sunDirection: s, wind, time: 0 }, pose.x, pose.z, pose.y, pose.headingDeg, 0.5));
      check(sites.every((s) => s.real), `from the ?moment= start the kettle sits on a real thermal (${sites.map((s) => s.thermal.toFixed(1)).join(', ')} m/s)`);
    }
    // Heading along the 1–3 km wide strait the hills are often out of the cone (and the northern forests are weak): then
    // the flock brings its own column (STORK_SITE.minUpdraft).
    check(real >= n / 3, `a third or more of the sites over the strait sit on a real thermal of the hills (${real} / ${n})`);
  }
}

/* ------------------------------------------------------------------ */
/* 6. The "[I] Kaynağa bak" prompt window                               */
/* ------------------------------------------------------------------ */
console.log('6. source prompt');
{
  const positions = flyAlong(path, SPEED, 120);
  type Phase = 'none' | 'playing' | 'after';
  const phaseOf = (s: SourcePromptState): Phase => (s ? s.phase : 'none');

  // A full glide: nothing before the moment, the prompt all through it, then SOURCE_PROMPT_AFTER_S more, then nothing.
  {
    const { runner } = harness();
    const win = new SourcePromptWindow();
    const trace: { t: number; phase: Phase; playing: boolean; id?: string }[] = [];
    positions.forEach((p) => {
      runner.update(DT, frameAt(p, flight()));
      const s = win.update(DT, runner.current, false);
      trace.push({ t: runner.now, phase: phaseOf(s), playing: !!runner.current, id: s?.moment.id });
    });
    const h = runner.history[0];
    check(!!h && h.reason === 'complete', 'the poem played in the prompt run');
    if (h) {
      const before = trace.filter((x) => x.t < h.start - 1e-6);
      check(before.length > 0 && before.every((x) => x.phase === 'none'), 'no prompt before the moment starts');
      const during = trace.filter((x) => x.playing);
      check(during.length > 0 && during.every((x) => x.phase === 'playing' && x.id === POEM_ID), `the prompt is offered on every frame of the moment (${during.length} frames)`);
      const after = trace.filter((x) => x.phase === 'after');
      const afterSpan = after.length * DT;
      check(after.length > 0 && after.every((x) => x.t >= h.end - 1e-6), 'the after-window follows the moment');
      check(Math.abs(afterSpan - SOURCE_PROMPT_AFTER_S) <= DT + 1e-6, `it lasts ${SOURCE_PROMPT_AFTER_S} s after the moment (${afterSpan.toFixed(2)} s)`);
      const later = trace.filter((x) => x.t > h.end + SOURCE_PROMPT_AFTER_S + DT);
      check(later.length > 0 && later.every((x) => x.phase === 'none'), 'no prompt once the window has passed');
    }
  }

  // Paused frames do not use up the window.
  {
    const { runner } = harness();
    const win = new SourcePromptWindow();
    let i = 0;
    while ((runner.history.length === 0 || runner.current) && i < positions.length) {
      runner.update(DT, frameAt(positions[i], flight()));
      win.update(DT, runner.current, false);
      i++;
    }
    for (let k = 0; k < 60 * FPS; k++) win.update(0, runner.current, false);
    check(win.current?.phase === 'after', 'a paused minute right after the moment keeps the prompt (menu open)');
  }

  // A race: no prompt while it runs, and a race ends the window after a moment.
  {
    const { runner } = harness();
    const win = new SourcePromptWindow();
    let raceAt = -1;
    const phases: Phase[] = [];
    positions.forEach((p, i) => {
      if (runner.currentLine === 2 && raceAt < 0) raceAt = i;
      const racing = raceAt >= 0 && i > raceAt && i < raceAt + 5 * FPS;
      runner.update(DT, frameAt(p, flight({ racing })));
      const s = win.update(DT, runner.current, racing);
      // Up to 15 s after the race began (the cut-short poem may retry after 90 s, with a fresh prompt then).
      if (raceAt >= 0 && i > raceAt && i < raceAt + 15 * FPS) phases.push(phaseOf(s));
    });
    check(runner.history[0]?.reason === 'race', 'the race ended the poem');
    check(phases.length > 0 && phases.every((x) => x === 'none'), 'no prompt during the race, and none after the race ends it');
  }
  {
    const { runner } = harness();
    const win = new SourcePromptWindow();
    let endAt = -1;
    let seenAfter = false;
    const afterRace: Phase[] = [];
    positions.forEach((p, i) => {
      const racing = endAt >= 0 && i >= endAt + 3 * FPS && i < endAt + 4 * FPS;
      runner.update(DT, frameAt(p, flight({ racing })));
      const s = win.update(DT, runner.current, racing);
      if (runner.history.length > 0 && endAt < 0) endAt = i;
      if (endAt >= 0 && i < endAt + 3 * FPS && s?.phase === 'after') seenAfter = true;
      if (endAt >= 0 && i >= endAt + 3 * FPS) afterRace.push(phaseOf(s));
    });
    check(seenAfter, 'the prompt shows right after the moment');
    check(afterRace.length > 0 && afterRace.every((x) => x === 'none'), 'a race starting in the window removes the prompt for good');
  }

  // A moment without sources offers no prompt.
  {
    const bare: Moment = { ...poem, sources: undefined };
    const { runner } = harness([bare]);
    const win = new SourcePromptWindow();
    let any = false;
    positions.forEach((p) => {
      runner.update(DT, frameAt(p, flight()));
      if (win.update(DT, runner.current, false)) any = true;
    });
    check(runner.history.length === 1 && !any, 'a moment without sources offers no prompt');
  }

  // The hint item after a moment: low priority, deferred by a race, never over race lines.
  {
    const zones = new HudDirector();
    const hint = { id: 'moment.source', zone: 'lowerCenter' as const, priority: HUD_PRIORITY.momentSource, duration: 10, maxWait: 10, deferIn: ['race'], hints: [['I', 'Kaynağa bak']] as const, joinable: true };
    zones.request(hint);
    zones.update(DT);
    check(zones.isShown('moment.source'), 'the after-moment hint shows on a free hint line');
    zones.setContext('race', true);
    zones.update(DT);
    check(!zones.isShown('moment.source'), 'it is deferred while a race runs');
    zones.setContext('race', false);
    zones.request({ id: 'race.hint', zone: 'lowerCenter', priority: HUD_PRIORITY.raceCountdown, hints: [['Y', 'iptal']] });
    zones.update(1);
    check(zones.shownIn('lowerCenter') === 'race.hint', 'a race hint line outranks it');
    check(HUD_PRIORITY.momentSource < HUD_PRIORITY.flightHint && HUD_PRIORITY.momentSource < HUD_PRIORITY.momentLine, 'its priority sits below flight hints and moment lines');
  }
}

/* ------------------------------------------------------------------ */
/* 7. Gull and simit on a ferry (moving anchor)                         */
/* ------------------------------------------------------------------ */
console.log('7. gull and simit on a ferry');
{
  // A vapur in service on the open water between Sarayburnu and Kadıköy, 7 m/s heading north-east.
  const FERRY_ID = 42;
  const start = latLonToLocal(41.0, 29.0);
  check(geo.isWater(start.x, start.z) && geo.coastDistance(start.x, start.z) < -300, `the ferry's water is open sea (coast distance ${geo.coastDistance(start.x, start.z).toFixed(0)} m)`);
  const yaw = (-45 * Math.PI) / 180; // forward (-sin yaw, -cos yaw) = north-east
  const ferryAt = (t: number): VesselPose => ({
    id: FERRY_ID,
    kind: 'vapur',
    x: start.x - Math.sin(yaw) * 7 * t,
    z: start.z - Math.cos(yaw) * 7 * t,
    yaw,
    heave: 0,
    speed: 7,
    underway: true,
    length: 72,
    beam: 13.2,
    draft: 3.1,
    airDraft: 19.7,
  });

  // The anchor feed on a stand-in life service: the ferry above, a moored vapur and a tanker (not ferries).
  let now = 0;
  let serviceOn = true;
  const docked: VesselPose = { ...ferryAt(0), id: 7, x: start.x + 90, speed: 0, underway: false };
  const tanker: VesselPose = { ...ferryAt(0), id: 8, kind: 'tanker', x: start.x - 90 };
  const life: LifeService = {
    vessels(kinds, out) {
      const all = [serviceOn ? ferryAt(now) : { ...ferryAt(now), speed: 0.5 }, docked, tanker].filter((p) => kinds.includes(p.kind));
      out.length = 0;
      out.push(...all);
      return out;
    },
    vessel: (id, out) => (id === FERRY_ID ? Object.assign(out, ferryAt(now)) : null),
  };
  const feed = new AnchorFeed();
  const pts = feed.update(life);
  check(pts.ferry.length === 1 && pts.ferry[0].id === FERRY_ID, `the 'ferry' anchor lists the vapur in service only (not the moored one, not the tanker): ${pts.ferry.map((a) => a.id).join(', ')}`);
  check(inService(ferryAt(0)) && !inService(docked), 'in service = underway and going ahead');

  interface FerryFlight extends Flight {
    /** Dragon offset from the ferry: along its heading and to starboard (m). */
    along: number;
    side: number;
    service: boolean;
  }
  const ferryFlight = (over: Partial<FerryFlight> = {}): FerryFlight => ({ ...flight({ agl: 20, mode: 'gliding' }), along: -60, side: 80, service: true, ...over });
  /** Runs `seconds` with the dragon riding along the ferry at an offset (or where `state` puts it). */
  function flyFerry(runner: MomentRunner, seconds: number, state: (t: number) => FerryFlight, t0 = 0): void {
    for (let k = 0; k < seconds * FPS; k++) {
      const t = t0 + k * DT;
      now = t;
      const s = state(t);
      serviceOn = s.service;
      const fp = ferryAt(t);
      const fx = -Math.sin(fp.yaw);
      const fz = -Math.cos(fp.yaw);
      const rx = Math.cos(fp.yaw);
      const rz = -Math.sin(fp.yaw);
      const p = { x: fp.x + fx * s.along + rx * s.side, z: fp.z + fz * s.along + rz * s.side };
      const fr = frameAt(p, s);
      fr.context!.anchors = feed.update(life);
      runner.update(DT, fr);
    }
  }
  const gullOnly = (): ReturnType<typeof harness> => harness([gull]);

  // Fires near the ferry, under its conditions.
  {
    const { runner, log } = gullOnly();
    flyFerry(runner, 30, () => ferryFlight());
    const h = runner.history[0];
    check(!!h && h.id === GULL_ID && h.reason === 'complete' && Math.abs(h.start - runner.pacing.dwellSec) <= DT + 1e-6, `gliding 20 m up, 100 m off the stern quarter: fires after the dwell and plays to the end (${h?.reason}, at ${h?.start.toFixed(2)} s)`);
    check(log.shows.length === gull.content.subtitles.length && log.cards.length === 1, `all ${gull.content.subtitles.length} lines and the card (${log.shows.length}, ${log.cards.length})`);
  }
  {
    const { runner } = gullOnly();
    let anchor: number | undefined;
    for (let k = 0; k < 3 && anchor === undefined; k++) {
      flyFerry(runner, 2, () => ferryFlight({ mode: 'hovering', agl: 30, along: -120, side: 40 }), k * 2);
      anchor = runner.currentAnchor;
    }
    check(anchor === FERRY_ID, `hovering by the stern: fires and names its ferry as the anchor (${anchor})`);
  }
  {
    const { runner } = gullOnly();
    flyFerry(runner, 5, () => ferryFlight({ mode: 'grounded', agl: 0, along: 25, side: 0 }));
    check(runner.history.length === 1 || !!runner.current, 'perched on the ferry: fires');
  }
  {
    const { runner } = gullOnly();
    flyFerry(runner, 5, () => ferryFlight({ along: -200, side: 0, agl: 45 }));
    check(!!runner.current || runner.history.length === 1, 'gliding 45 m up 164 m behind the stern (within 250 m of its centre): fires');
  }
  const noFire: Array<[string, Partial<FerryFlight>]> = [
    ['300 m abeam (beyond 250 m)', { side: 300, along: 0 }],
    ['1 km away', { side: 1000 }],
    ['the ferry not in service (alongside, stopped)', { service: false }],
    ['at night (22:00)', { timeOfDay: 22 }],
    ['before dawn (05:30)', { timeOfDay: 5.5 }],
    ['in rain', { weather: 'rain' }],
    ['in a storm', { weather: 'storm' }],
    ['high above it (150 m AGL)', { agl: 150 }],
    ['diving past it', { mode: 'diving' }],
    ['swimming beside it', { mode: 'swimming', agl: 0 }],
    ['during a race', { racing: true }],
    ['with the city-life category off', { prefs: { enabled: true, categories: { legend: true, 'city-life': false, poem: true } } }],
  ];
  for (const [label, over] of noFire) {
    const { runner } = gullOnly();
    flyFerry(runner, 20, () => ferryFlight(over));
    check(runner.history.length === 0 && !runner.current, `no ferry moment ${label}`);
  }
  // Not away from ferries: the same glide along the European shore where no ferry runs.
  {
    const { runner } = gullOnly();
    positionsLoop: for (const p of flyAlong(path, SPEED, 60)) {
      const fr = frameAt(p, flight({ agl: 20 }));
      fr.context!.anchors = feed.update(life);
      runner.update(DT, fr);
      if (runner.history.length > 0) break positionsLoop;
    }
    check(runner.history.length === 0, 'no ferry moment gliding along the shore away from the ferry');
  }
  // Fog and haze are fine.
  for (const weather of ['fog', 'haze'] as const) {
    const { runner } = gullOnly();
    flyFerry(runner, 5, () => ferryFlight({ weather }));
    check(!!runner.current || runner.history.length === 1, `fires in ${weather}`);
  }
  // Flying away from the ferry mid-moment no longer ends it: it plays to the end.
  {
    const { runner, log } = gullOnly();
    let leftAt = -1;
    flyFerry(runner, 30, (t) => {
      if (runner.currentLine === 1 && leftAt < 0) leftAt = t;
      return ferryFlight(leftAt >= 0 ? { side: 700 } : {});
    });
    check(runner.history[0]?.reason === 'complete' && log.hides.every((h) => h.how === 'end'), `flying 700 m away mid-moment: it plays to the end (${runner.history[0]?.reason})`);
  }
  {
    const { runner } = gullOnly();
    flyFerry(runner, 30, () => ferryFlight({ side: 240, along: 0, mode: 'hovering' }));
    check(runner.history[0]?.reason === 'complete', 'hovering 240 m abeam while the ferry sails on: plays to the end');
  }
  // Cooldown: repeatable after 600 s (and the global gap), not before.
  {
    const { runner } = gullOnly();
    flyFerry(runner, 700, () => ferryFlight());
    const plays = runner.history.filter((x) => x.id === GULL_ID);
    const cd = gull.trigger.repeat.kind === 'repeatable' ? gull.trigger.repeat.cooldownSec : Infinity;
    check(plays.length === 2, `staying by the ferry for 700 s: plays twice (${plays.length}×)`);
    if (plays.length === 2) {
      const gap = plays[1].start - plays[0].start;
      check(gap >= cd - 1e-6 && gap <= cd + runner.pacing.dwellSec + 2 * DT, `the second time after the ${cd} s cooldown (${gap.toFixed(1)} s)`);
    }
  }
  // The shortcut: forced with an explicit anchor.
  {
    const { runner } = gullOnly();
    check(runner.force(GULL_ID, FERRY_ID), 'force accepts the ferry moment with its anchor');
    flyFerry(runner, 2, () => ferryFlight({ side: 3000, weather: 'rain' }));
    check(runner.currentAnchor === FERRY_ID && !!runner.current, 'forced: plays at the given ferry whatever the conditions');
  }
  // The ?moment= placement next to a ferry in service.
  {
    now = 0;
    serviceOn = true;
    feed.update(life);
    const sc = ferryShortcut(feed.vesselsOf('ferry'), (x, z) => geo.coastDistance(x, z));
    check(!!sc && sc.anchorId === FERRY_ID, `?moment=${GULL_ID} picks the vapur in service (${sc?.anchorId})`);
    if (sc) {
      const fp = ferryAt(0);
      const d = Math.hypot(sc.pose.x - fp.x, sc.pose.z - fp.z);
      check(geo.isWater(sc.pose.x, sc.pose.z) && d > 30 && d < 90, `it hovers over the water beside the ferry (${d.toFixed(0)} m from its centre)`);
      check(sc.pose.speed === 0 && sc.pose.y >= 10 && sc.pose.y <= 30, `hovering (speed 0) at ${sc.pose.y} m, inside the 60 m band`);
      const toShip = (Math.atan2(fp.x - sc.pose.x, -(fp.z - sc.pose.z)) * 180) / Math.PI;
      const diff = Math.abs(((sc.pose.headingDeg - toShip + 540) % 360) - 180);
      check(diff < 60, `facing the ship's stern quarter (${diff.toFixed(0)}° off the line to its centre)`);
      // And from there the trigger would fire by itself.
      const r = gullOnly().runner;
      const ctx = frameAt({ x: sc.pose.x, z: sc.pose.z }, flight({ agl: sc.pose.y, mode: 'hovering' }));
      ctx.context!.anchors = feed.update(life);
      for (let k = 0; k < 2 * FPS; k++) r.update(DT, ctx);
      check(!!r.current, 'the shortcut pose satisfies the trigger on its own');
    }
  }
}

/* ------------------------------------------------------------------ */
/* 8. The literary moments (backlog 16)                                  */
/* ------------------------------------------------------------------ */
console.log('8. literary moments');
{
  const litPlayable = LITERATURE.filter((m) => momentPlayability(m).playable);
  check(litPlayable.length === 8, `8 literary moments play now (${litPlayable.map((m) => m.id).join(', ')})`);
  for (const id of ['sinan-turbe-kitabesi', 'hasim-bir-gunun-sonunda-arzu']) {
    const m = LITERATURE.find((x) => x.id === id)!;
    const p = momentPlayability(m);
    check(!p.playable && /pending|text-approval/.test(p.reason ?? ''), `${id} waits for the owner's text check (${p.reason})`);
  }

  /** A situation that meets every condition of `m`'s trigger at its target (centre or area centroid). */
  const situation = (m: Moment): Omit<MomentContext, 'session'> => {
    const t = m.trigger;
    const pl = t.place;
    let ll = pl.center ?? { lat: 0, lon: 0 };
    if (!pl.center && pl.area) {
      ll = { lat: pl.area.reduce((a, v) => a + v.lat, 0) / pl.area.length, lon: pl.area.reduce((a, v) => a + v.lon, 0) / pl.area.length };
    }
    let p = latLonToLocal(ll.lat, ll.lon);
    // A shore band: walk out from the target to the nearest point that meets it.
    if (t.shoreDistance) {
      const sd = t.shoreDistance;
      const ok = (q: XZ) => {
        const cd = geo.coastDistance(q.x, q.z);
        return (sd.min === undefined || cd >= sd.min) && (sd.max === undefined || cd <= sd.max);
      };
      for (let i = 0; i < 2000 && !ok(p); i++) {
        const a = i * 2.399963;
        const r = (pl.radius ?? 300) * Math.sqrt(i / 2000);
        const q = latLonToLocal(ll.lat, ll.lon);
        const cand = { x: q.x + Math.cos(a) * r, z: q.z + Math.sin(a) * r };
        if (ok(cand)) p = cand;
      }
    }
    const ground = Math.max(0, geo.heightAt(p.x, p.z));
    let lo = ground + 5;
    let hi = ground + 600;
    for (const b of t.altitude ?? []) {
      const off = b.ref === 'agl' ? ground : 0;
      if (b.min !== undefined) lo = Math.max(lo, b.min + off);
      if (b.max !== undefined) hi = Math.min(hi, b.max + off);
    }
    const altitude = (lo + hi) / 2;
    const tw = t.timeOfDay;
    const timeOfDay = tw ? (tw.from + (((tw.to - tw.from + 24) % 24) / 2)) % 24 : 12;
    return {
      position: p,
      altitude,
      agl: altitude - ground,
      grounded: false,
      flightMode: t.flightModes?.[0] ?? 'gliding',
      coastDistance: geo.coastDistance(p.x, p.z),
      timeOfDay,
      dayOfYear: 269,
      weather: t.weather?.[0] ?? 'clear',
      seaFog: t.seaFog ? Math.min(1, (t.seaFog.min ?? 0) + 0.3) : 0,
    };
  };
  const runFor = (moments: readonly Moment[], ctx: Omit<MomentContext, 'session'>, seconds: number, over: Partial<MomentFrame> = {}) => {
    const h = harness(moments);
    const frame: MomentFrame = { context: ctx, prefs: defaultMomentPrefs(), racing: false, ...over };
    for (let k = 0; k < seconds * FPS; k++) h.runner.update(DT, frame);
    return h;
  };

  for (const m of litPlayable) {
    const ctx = situation(m);
    const subs = m.content.subtitles;
    const length = subs[subs.length - 1].at + subs[subs.length - 1].duration;
    // Alone: fires after the dwell, shows every line and the card, once per session.
    const { runner, log } = runFor([m], ctx, length + 30);
    const h = runner.history[0];
    check(runner.history.length === 1 && h?.reason === 'complete' && !h.forced, `${m.id}: fires once in its situation and plays to the end (${runner.history.length}×, ${h?.reason})`);
    check(log.shows.length === subs.length && log.cards.length === 1, `${m.id}: all ${subs.length} lines and the card (${log.shows.length}, ${log.cards.length})`);
    check(Math.max(0, ...log.lift) === 0, `${m.id}: no ambience lift (subtitle-only, the moment music plays)`);
    const again = runFor([m], ctx, 2 * length + runner.pacing.minGapSec + 60).runner;
    check(again.history.length === 1, `${m.id}: once per session (${again.history.length}× in ${Math.round(2 * length + runner.pacing.minGapSec + 60)} s)`);
    // With every record: something plays there (nearest first; an area-only moment such as the storks may win).
    const all = runFor(ALL_MOMENTS, ctx, 5).runner;
    check(!!all.current || all.history.length > 0, `${m.id}: its situation starts a moment with every record loaded (${all.current?.id ?? all.history[0]?.id ?? 'none'})`);

    // Outside its conditions: nothing.
    const t = m.trigger;
    const negatives: Array<[string, Partial<Omit<MomentContext, 'session'>>]> = [];
    const far = latLonToLocal(41.2, 28.8);
    negatives.push(['far away (Kilyos forests)', { position: far, coastDistance: geo.coastDistance(far.x, far.z) }]);
    if (t.timeOfDay) negatives.push(['outside its hours', { timeOfDay: (t.timeOfDay.to + 1) % 24 }]);
    if (t.weather && !t.weather.includes('storm')) negatives.push(['in a storm', { weather: 'storm' }]);
    if (t.weather && !t.weather.includes('clear')) negatives.push(['in clear weather', { weather: 'clear' }]);
    if (t.seaFog) negatives.push(['without sea fog', { seaFog: 0 }]);
    if (t.altitude?.some((b) => b.max !== undefined)) negatives.push(['far above its band', { altitude: ctx.altitude + 1200, agl: ctx.agl + 1200 }]);
    if (t.altitude?.some((b) => b.min !== undefined)) negatives.push(['below its band', { altitude: Math.max(0, ctx.altitude - ctx.agl) + 10, agl: 10 }]);
    if (t.flightModes) negatives.push(['in another flight mode', { flightMode: 'hovering' }]);
    if (t.surface === 'air') negatives.push(['on the ground', { grounded: true, flightMode: 'grounded', agl: 0 }]);
    for (const [label, over] of negatives) {
      const r = runFor([m], { ...ctx, ...over }, 10).runner;
      check(r.history.length === 0 && !r.current, `${m.id}: silent ${label}`);
    }
    const race = runFor([m], ctx, 10, { racing: true }).runner;
    check(race.history.length === 0 && !race.current, `${m.id}: silent during a race`);
    const off = defaultMomentPrefs();
    off.categories[m.category] = false;
    const disabled = runFor([m], ctx, 10, { prefs: off }).runner;
    check(disabled.history.length === 0 && !disabled.current, `${m.id}: silent with its category off`);

    // The ?moment= shortcut: a start pose inside the world, then the forced moment plays whatever the conditions.
    const pose = momentStartPose(m);
    check(!!pose && Math.abs(pose.x) < 22_500 && Math.abs(pose.z) < 22_500, `${m.id}: ?moment= start pose inside the playable map`);
    if (pose) {
      const wps = m.content.waypoints ?? [];
      const target = latLonToLocal(wps[1].lat, wps[1].lon);
      const toTarget = (Math.atan2(target.x - pose.x, -(target.z - pose.z)) * 180) / Math.PI;
      const diff = Math.abs(((pose.headingDeg - toTarget + 540) % 360) - 180);
      const clearance = pose.y - Math.max(0, geo.heightAt(pose.x, pose.z));
      check(diff < 1 && clearance > 20, `${m.id}: start pose heads for '${wps[1].id}' (${diff.toFixed(1)}° off) ${clearance.toFixed(0)} m above the surface`);
    }
    const forced = harness([m]);
    check(forced.runner.force(m.id), `${m.id}: force accepts it`);
    const noon = { ...ctx, position: far, timeOfDay: 12, weather: 'storm' as const, seaFog: 0 };
    for (let k = 0; k < (length + 5) * FPS; k++) forced.runner.update(DT, { context: noon, prefs: defaultMomentPrefs(), racing: false });
    check(forced.runner.history[0]?.forced === true && forced.runner.history[0]?.reason === 'complete', `${m.id}: forced, it plays to the end anywhere`);
  }

  // The sources sheet has something for every literary moment.
  for (const m of LITERATURE) {
    check(validateMomentSources(m).length === 0 && (m.sources?.length ?? 0) > 0, `${m.id}: its sources validate (${validateMomentSources(m).join('; ')})`);
  }
}

console.log(`moments-runtime-check: ${checks} checks, ${failures} failed`);
process.exit(failures > 0 ? 1 : 0);
