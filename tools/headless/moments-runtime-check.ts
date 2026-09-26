/**
 * Headless check of the moment runtime (src/moments/runtime.ts): a scripted dragon flies the real geography and the
 * runner decides. No browser, no GPU.
 *
 *   npx tsx tools/headless/moments-runtime-check.ts
 *
 * 1. Geography: the Bosphorus corridor polygon covers the strait's water and both shores in world coordinates; the
 *    poem's waypoints and the ?moment= start pose sit where they should.
 * 2. Playability: which records play now (the poem, subtitle-only with a missing optional sound) and which wait.
 * 3. The poem on a low glide along the European shore from Beşiktaş toward Bebek: fires exactly once per session,
 *    after the dwell time, with the subtitle timeline of the record (4 s lines, 0.5 s gaps), the card at the end and
 *    the ambience lift; it does not fire when high, inland, in rain or storm, while flapping, during a race, or with
 *    its category (or the master switch) off.
 * 4. Pacing while playing: pause freezes it, a few wing beats or a small climb do not end it, leaving the band fades
 *    the line out (and a moment cut short early may try again later, one cut late is spent), a race or the settings
 *    end it, the global gap keeps moments apart, and the ?moment= shortcut forces one.
 * 5. The gull and simit on a ferry (moving anchor 'ferry' from the anchor feed): fires gliding, hovering or perched
 *    near a ferry in service and names that ferry; not far from it, not at a stopped ferry, not at night, in rain or
 *    storm, high above, diving or swimming, during a race or with city life off, not along a shore without ferries;
 *    the hold follows the ferry as it pulls away, flying off ends it, the 600 s cooldown, the forced anchor and the
 *    ?moment= placement beside the ferry.
 *
 * Exits non-zero on any failure.
 */
import { latLonToLocal, localToLatLon, WORLD_ORIGIN } from '../../src/core/geo-coords';
import type { FlightMode, WeatherPreset } from '../../src/core/contracts';
import { ALL_MOMENTS } from '../../src/moments/data';
import { BOSPHORUS_CORRIDOR } from '../../src/moments/data/city-life';
import { defaultMomentPrefs, onMomentPrefsChange, saveMomentPrefs, type MomentPrefs } from '../../src/moments/prefs';
import { HOLD, momentPlayability, MomentRunner, momentStartPose, type MomentFrame, type MomentSink } from '../../src/moments/runtime';
import { pointInPolygon, type MomentContext, type XZ } from '../../src/moments/triggers';
import type { Moment, SubtitleLine } from '../../src/moments/types';
import { buildHeadlessGeo } from './geo';
import { actorSounds } from '../../src/moments/actors';
import { AnchorFeed, ferryShortcut, inService } from '../../src/moments/anchors';
import type { LifeService, VesselPose } from '../../src/core/contracts';

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
  const gp = momentPlayability(gull, actorSounds());
  check(gull.status === 'ready' && gp.playable && !gp.soundFallback, 'the ferry gull moment plays now (ready; its actor brings its own gull calls, no ambience fallback)');
  for (const m of ALL_MOMENTS) {
    if (m === poem || m === gull) continue;
    const p = momentPlayability(m);
    check(!p.playable && !!p.reason, `${m.id} waits (${p.reason})`);
  }
  const base: Moment = { ...poem, id: 'test' };
  check(!momentPlayability({ ...base, content: { ...base.content, actorId: 'moments/x' } }).playable, 'a draft with a character is not playable while its sound is missing');
  check(!momentPlayability({ ...base, needs: ['sound', 'text-approval'] }).playable, 'a draft waiting for text approval is not playable');
  check(momentPlayability({ ...base, status: 'ready', needs: [] }).playable, 'a ready moment is playable');
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
}

function harness(moments: readonly Moment[] = ALL_MOMENTS, pacing = {}) {
  const log: Log = { shows: [], hides: [], cards: [], lift: [] };
  let runner!: MomentRunner;
  const sink: MomentSink = {
    showLine: (_m, line, index) => log.shows.push({ t: runner.now, index, line }),
    hideLine: (_m, how) => log.hides.push({ t: runner.now, how }),
    showCard: () => log.cards.push(runner.now),
    setAmbienceLift: (v) => log.lift.push(v),
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
    check(r.history.length === 0, `no moment ${label} (fired ${r.history.map((x) => x.id).join(', ') || 'nothing'})`);
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

  // A few wing beats and a small climb inside the hysteresis do not end the glide.
  {
    const { runner } = harness();
    fly(runner, positions.slice(0, 40 * FPS), (i) => {
      const t = i * DT;
      if (t > 6 && t < 7) return flight({ mode: 'flying' });
      if (t > 10 && t < 14) return flight({ agl: 40 + HOLD.altitude - 3 });
      if (t > 16 && t < 16.8) return flight({ mode: 'hovering' });
      return flight();
    });
    check(runner.history[0]?.reason === 'complete', `flapping 1 s, climbing to ${40 + HOLD.altitude - 3} m and a 0.8 s hover do not end it (${runner.history[0]?.reason})`);
  }

  // Leaving the band fades the line out; cut short early → may try again after retrySec, not before.
  {
    const { runner, log } = harness();
    let climbAt = -1;
    fly(runner, positions.slice(0, 20 * FPS), (i) => {
      const t = i * DT;
      if (runner.currentLine === 1 && climbAt < 0) climbAt = t;
      return climbAt >= 0 && t >= climbAt + 1 ? flight({ agl: 90 }) : flight();
    });
    const h = runner.history[0];
    check(h?.reason === 'conditions', `climbing to 90 m ends it (${h?.reason})`);
    const lastHide = log.hides[log.hides.length - 1];
    check(lastHide?.how === 'fade', 'the line on screen fades out gently');
    check(!!h && Math.abs(h.end - (climbAt + 1) - runner.pacing.graceSec) <= 2 * DT + 1e-6, `it ends ${runner.pacing.graceSec} s after leaving the band (after ${h ? (h.end - climbAt - 1).toFixed(2) : '?'} s)`);
    check(log.shows.length === 2 && log.cards.length === 0, `no more lines and no card after the fade (lines ${log.shows.length}, cards ${log.cards.length})`);
    // Back low right away: waits for the retry time.
    const cut = h?.end ?? 0;
    fly(runner, positions.slice(20 * FPS, 20 * FPS + Math.round((cut + runner.pacing.retrySec - 1 - runner.now) * FPS)), () => flight());
    check(runner.history.length === 1 && !runner.current, 'cut short after 2 lines: not again before the retry time');
    fly(runner, positions.slice(0, 40 * FPS), () => flight());
    check(runner.history.length === 2 && runner.history[1].start >= cut + runner.pacing.retrySec - 1e-6, 'but it may play again after the retry time');
  }
  {
    const { runner } = harness();
    let climbAt = -1;
    fly(runner, positions.slice(0, 500 * FPS), (i) => {
      const t = i * DT;
      if (runner.currentLine === 4 && climbAt < 0) climbAt = t;
      return climbAt >= 0 && t >= climbAt && t < climbAt + 20 ? flight({ agl: 90 }) : flight();
    });
    check(runner.history.length === 1 && runner.history[0].reason === 'conditions', 'cut short after 5 of 7 lines: spent for the session');
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
/* 5. Gull and simit on a ferry (moving anchor)                         */
/* ------------------------------------------------------------------ */
console.log('5. gull and simit on a ferry');
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
  // Hold: the ferry pulls away while the dragon hovers; within the 250 + 100 m hold it goes on, leaving ends it.
  {
    const { runner, log } = gullOnly();
    let leftAt = -1;
    flyFerry(runner, 30, (t) => {
      if (runner.currentLine === 1 && leftAt < 0) leftAt = t;
      return ferryFlight(leftAt >= 0 ? { side: 700 } : {});
    });
    check(runner.history[0]?.reason === 'conditions' && log.hides[log.hides.length - 1]?.how === 'fade', `flying 700 m away mid-moment fades it out (${runner.history[0]?.reason})`);
  }
  {
    const { runner } = gullOnly();
    flyFerry(runner, 30, () => ferryFlight({ side: 240, along: 0, mode: 'hovering' }));
    check(runner.history[0]?.reason === 'complete', 'hovering 240 m abeam while the ferry sails on (beyond 250 m after a few seconds, inside the 350 m hold): plays to the end');
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

console.log(`moments-runtime-check: ${checks} checks, ${failures} failed`);
process.exit(failures > 0 ? 1 : 0);
