/**
 * Headless check of the HUD zone director and the zone bands (pure TS, no browser):
 *
 *   npx tsx tools/headless/hud-zones-check.ts
 *
 * Director: the priority table order, highest priority wins a zone, one item per zone, the fade gap between two items,
 * ties go to the newer request (toasts replace in place), re-requests update in place, deferral and the drop of stale
 * items, the race context deferring the area title and the compass landmark label, and the shared hint line (race
 * "[Y] iptal" never shares a row with the start hints; joinable hints ride along). The owner's screenshot situation
 * (game start + race countdown) is replayed step by step.
 * Bands: from 1280 × 720 to 2560 × 1440 the top, title, centre, lowerCenter and bottom bands do not overlap, the
 * title band holds the countdown block and the centre keeps a clear area for the ring.
 *
 * Exits non-zero on any failure.
 */
import type { HudZoneId, HudZoneRequest } from '../../src/core/contracts';
import { HUD_PRIORITY, HUD_ZONES, HudDirector, ZONE_FADE_GAP_S } from '../../src/ui/zones/director';
import { zoneBands } from '../../src/ui/zones/bands';

let failures = 0;
let checks = 0;
function check(cond: boolean, msg: string): void {
  checks++;
  if (!cond) {
    failures++;
    console.error(`FAIL  ${msg}`);
  }
}

/** Steps the director in small frames (like the game loop). */
function run(d: HudDirector, seconds: number, frame = 1 / 30): void {
  let t = seconds;
  while (t > 1e-9) {
    const dt = Math.min(frame, t);
    d.update(dt);
    t -= dt;
  }
}

function req(id: string, zone: HudZoneId, priority: number, rest: Partial<HudZoneRequest> = {}): HudZoneRequest {
  return { id, zone, priority, ...rest };
}

/** At most one owner per zone, and it is the only shown item there (riders aside). */
function onePerZone(d: HudDirector, ids: readonly string[], zoneOf: Record<string, HudZoneId>, label: string): void {
  for (const z of HUD_ZONES) {
    const shown = ids.filter((id) => zoneOf[id] === z && d.isShown(id));
    check(shown.length <= 1, `${label}: one item in zone ${z} (shown: ${shown.join(', ')})`);
  }
}

/* ---------------- priority table ---------------- */
{
  const p = HUD_PRIORITY;
  const order = [p.raceCountdown, p.raceWarning, p.discovery, p.areaTitle, p.maneuver, p.flightHint, p.startHint, p.toast];
  check(order.every((v, i) => i === 0 || order[i - 1] > v), 'priority table: countdown > warnings > discovery > area > maneuver > flight hints > start hints > toasts');
}

/* ---------------- highest priority wins, lower waits, then shows ---------------- */
{
  const d = new HudDirector();
  d.request(req('low', 'title', 10, { duration: 2 }));
  d.request(req('high', 'title', 60, { duration: 1 }));
  run(d, 0.05);
  check(d.isShown('high') && !d.isShown('low'), 'priority: the higher item takes the zone');
  check(d.shownIn('title') === 'high', 'priority: shownIn reports the owner');
  run(d, 1.0);
  check(!d.has('high'), 'duration: the item ends after its duration');
  check(!d.isShown('low'), 'fade gap: the zone stays empty right after an item ends');
  run(d, ZONE_FADE_GAP_S + 0.05);
  check(d.isShown('low'), 'queue: the waiting item shows after the fade gap');
  run(d, 2.1);
  check(!d.has('low'), 'duration counts only while shown');
}

/* ---------------- preemption: a displaced item resumes with its remaining time ---------------- */
{
  const d = new HudDirector();
  d.request(req('cap', 'lowerCenter', HUD_PRIORITY.flightHint, { duration: 3, maxWait: 5 }));
  run(d, 1);
  d.request(req('race', 'lowerCenter', HUD_PRIORITY.raceCountdown, { duration: 1 }));
  run(d, 0.05);
  check(!d.isShown('race') && !d.isShown('cap'), 'preempt: the old item fades out before the new one fades in');
  run(d, ZONE_FADE_GAP_S);
  check(d.isShown('race') && !d.isShown('cap'), 'preempt: a higher item displaces the showing one');
  run(d, 1 + ZONE_FADE_GAP_S + 0.1);
  check(d.isShown('cap'), 'preempt: the displaced item comes back');
  run(d, 1.7);
  check(d.isShown('cap'), 'preempt: it keeps its remaining time (2 s left)');
  run(d, 0.5);
  check(!d.has('cap'), 'preempt: and ends when that time is used up');
}

/* ---------------- stale items are dropped ---------------- */
{
  const d = new HudDirector();
  d.request(req('persistent', 'title', HUD_PRIORITY.raceCountdown));
  d.request(req('stale', 'title', HUD_PRIORITY.areaTitle, { duration: 3, maxWait: 1 }));
  run(d, 0.9);
  check(d.has('stale') && !d.isShown('stale'), 'defer: the lower item waits');
  run(d, 0.2);
  check(!d.has('stale'), 'drop: an item that waited past maxWait is dropped');
  d.release('persistent');
  run(d, 1);
  check(d.shownIn('title') === '', 'drop: a dropped item never shows later');
}

/* ---------------- ties: the newer request wins (toasts replace in place) ---------------- */
{
  const d = new HudDirector();
  d.request(req('toast.1', 'toast', HUD_PRIORITY.toast, { duration: 3.6, maxWait: 2.5 }));
  run(d, 0.5);
  d.request(req('toast.2', 'toast', HUD_PRIORITY.toast, { duration: 3.6, maxWait: 2.5 }));
  run(d, ZONE_FADE_GAP_S + 0.1);
  check(d.isShown('toast.2') && !d.isShown('toast.1'), 'tie: the newest toast replaces the current one');
  run(d, 2.6);
  check(!d.has('toast.1'), 'tie: the replaced toast is dropped once stale');
  // Keyed update in place: same id, restarted duration, onShow runs again for the new content.
  let shows = 0;
  const camera = req('toast.camera', 'toast', HUD_PRIORITY.toast + 1, { duration: 1, onShow: () => shows++ });
  d.request(camera);
  run(d, ZONE_FADE_GAP_S + 0.1);
  run(d, 0.8);
  d.request({ ...camera });
  run(d, 0.5);
  check(d.isShown('toast.camera') && shows === 2, 'update: a re-request refreshes in place and restarts the duration');
}

/* ---------------- one item per zone under load ---------------- */
{
  const d = new HudDirector();
  const zoneOf: Record<string, HudZoneId> = {};
  const ids: string[] = [];
  let seed = 7;
  const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let step = 0; step < 600; step++) {
    if (rnd() < 0.2) {
      const zone = HUD_ZONES[Math.floor(rnd() * HUD_ZONES.length)];
      const id = `r${step}`;
      zoneOf[id] = zone;
      ids.push(id);
      d.request(req(id, zone, Math.floor(rnd() * 100), { duration: 0.2 + rnd() * 3, maxWait: rnd() * 4 }));
    }
    d.update(1 / 30);
    onePerZone(d, ids, zoneOf, `load step ${step}`);
  }
}

/* ---------------- race context: area title deferred, dropped if stale; compass label hidden ---------------- */
{
  const d = new HudDirector();
  d.request(req('compass.landmark', 'top', HUD_PRIORITY.startHint, { deferIn: ['race'] }));
  run(d, 0.1);
  check(d.isShown('compass.landmark'), 'race: the landmark label shows in free flight');
  d.setContext('race', true);
  d.request(req('area.title', 'title', HUD_PRIORITY.areaTitle, { duration: 2.8, maxWait: 8, deferIn: ['race'] }));
  run(d, 0.1);
  check(!d.isShown('compass.landmark'), 'race: the landmark label hides while racing');
  check(!d.isShown('area.title') && d.shownIn('title') === '', 'race: the area title is deferred even with an empty title zone');
  run(d, 3);
  d.setContext('race', false);
  run(d, ZONE_FADE_GAP_S + 0.1);
  check(d.isShown('area.title'), 'race: a deferred area title shows after a short race');
  check(d.isShown('compass.landmark'), 'race: the landmark label returns after the race');
  // A long race: the title goes stale.
  d.release('area.title');
  d.setContext('race', true);
  d.request(req('area.title', 'title', HUD_PRIORITY.areaTitle, { duration: 2.8, maxWait: 8, deferIn: ['race'] }));
  run(d, 60);
  d.setContext('race', false);
  run(d, 1);
  check(!d.has('area.title') && !d.isShown('area.title'), 'race: an area title deferred past maxWait is dropped');
}

/* ---------------- the shared hint line ---------------- */
{
  const d = new HudDirector();
  const start = [['M', 'Harita'], ['H', 'Yardım'], ['O', 'Fotoğraf'], ['Esc', 'Menü']] as const;
  d.request(req('hints.start', 'lowerCenter', HUD_PRIORITY.startHint, { duration: 14, maxWait: 30, hints: start }));
  d.request(req('race.hints', 'lowerCenter', HUD_PRIORITY.raceCountdown, { caption: 'İlk kapıya doğru uç', hints: [['Y', 'iptal']] }));
  run(d, 0.1);
  let line = d.hintLine();
  check(line?.id === 'race.hints', 'hint line: the race line owns the row');
  check(!!line && line.hints.length === 1 && line.hints[0][0] === 'Y' && line.caption === 'İlk kapıya doğru uç', 'hint line: [Y] iptal and the caption in one row');
  check(!!line && !line.hints.some(([k]) => k === 'M'), 'hint line: start hints never share the row with [Y] iptal');
  check(!d.isShown('hints.start'), 'hint line: start hints wait while the race line is up');
  // A joinable hint rides along on the showing line.
  d.request(req('hint.ghost', 'lowerCenter', HUD_PRIORITY.flightHint, { hints: [['G', 'Hayalet']], joinable: true, duration: 5 }));
  run(d, 0.1);
  line = d.hintLine();
  check(!!line && line.hints.map(([k]) => k).join(',') === 'Y,G', 'hint line: a joinable hint merges into the same row');
  check(d.isShown('hint.ghost'), 'hint line: a riding hint counts as shown');
  d.release('hint.ghost');
  // A maneuver caption (no hints) outranks the start hints but waits behind the race line, then goes stale.
  d.request(req('caption.maneuver', 'lowerCenter', HUD_PRIORITY.maneuver, { duration: 1.4, maxWait: 0.6 }));
  run(d, 1);
  check(!d.has('caption.maneuver'), 'hint line: a maneuver caption behind the race line is dropped when stale');
  d.release('race.hints');
  run(d, ZONE_FADE_GAP_S + 0.1);
  line = d.hintLine();
  check(line?.id === 'hints.start' && line.hints.length === 4, 'hint line: start hints show once nothing higher is active');
  d.request(req('caption.maneuver', 'lowerCenter', HUD_PRIORITY.maneuver, { duration: 1.4, maxWait: 0.6 }));
  run(d, ZONE_FADE_GAP_S + 0.1);
  check(d.isShown('caption.maneuver') && d.hintLine() === null, 'hint line: a caption replaces the hint row (never beside it)');
  run(d, 1.4 + ZONE_FADE_GAP_S + 0.1);
  check(d.hintLine()?.id === 'hints.start', 'hint line: the start hints come back after the caption');
}

/* ---------------- the owner's screenshot: game start + race countdown ---------------- */
{
  const d = new HudDirector();
  const zoneOf: Record<string, HudZoneId> = {
    'compass.landmark': 'top',
    'hints.start': 'lowerCenter',
    'area.title': 'title',
    'race.intro': 'title',
    'race.hints': 'lowerCenter',
    'race.readout': 'top',
    'toast.1': 'toast',
  };
  const ids = Object.keys(zoneOf);
  // Game start.
  d.request(req('compass.landmark', 'top', HUD_PRIORITY.startHint, { deferIn: ['race'] }));
  d.request(req('hints.start', 'lowerCenter', HUD_PRIORITY.startHint, { duration: 14, maxWait: 30, hints: [['M', 'Harita']] }));
  run(d, 0.2);
  // The race starts at once (?race=): its start screen, the toast and the area title all arrive together.
  d.setContext('race', true);
  d.request(req('race.intro', 'title', HUD_PRIORITY.raceCountdown));
  d.request(req('race.hints', 'lowerCenter', HUD_PRIORITY.raceCountdown, { caption: 'İlk kapıya doğru uç', hints: [['Y', 'iptal']] }));
  d.request(req('toast.1', 'toast', HUD_PRIORITY.toast, { duration: 3.6, maxWait: 2.5 }));
  d.request(req('area.title', 'title', HUD_PRIORITY.areaTitle, { duration: 2.8, maxWait: 8, deferIn: ['race'] }));
  run(d, ZONE_FADE_GAP_S + 0.1);
  onePerZone(d, ids, zoneOf, 'countdown');
  check(d.shownIn('title') === 'race.intro', 'countdown: the title zone shows the race intro (name, numeral, targets)');
  check(!d.isShown('area.title'), 'countdown: the area title is deferred');
  check(!d.isShown('compass.landmark'), 'countdown: the compass landmark label is hidden');
  check(d.hintLine()?.id === 'race.hints' && !d.isShown('hints.start'), 'countdown: one hint row, the race\'s, without the start hints');
  check(d.isShown('toast.1'), 'countdown: the toast has its own slot');
  // "Başla!": the intro holds one more second, the readout takes the top zone.
  run(d, 3);
  d.request(req('race.intro', 'title', HUD_PRIORITY.raceCountdown, { duration: 1 }));
  d.request(req('race.hints', 'lowerCenter', HUD_PRIORITY.raceCountdown, { duration: 1, caption: 'Kapıdan geç, süre akıyor' }));
  d.request(req('race.readout', 'top', HUD_PRIORITY.raceCountdown));
  run(d, 0.1);
  onePerZone(d, ids, zoneOf, 'go');
  check(d.isShown('race.readout') && !d.isShown('compass.landmark'), 'go: the race readout replaces the landmark line');
  run(d, 1 + ZONE_FADE_GAP_S + 0.1);
  check(d.shownIn('title') === '', 'running: the title zone is free again (area title still deferred)');
  check(d.hintLine()?.id === 'hints.start', 'running: the start hints show once the race line is gone');
  // A 4-minute run: the area title is stale by the end.
  run(d, 240);
  d.release('race.readout');
  d.setContext('race', false);
  run(d, 1);
  check(!d.has('area.title'), 'finish: the stale area title was dropped');
  check(d.isShown('compass.landmark'), 'finish: the landmark label is back');
}

/* ---------------- bands ---------------- */
{
  const sizes: Array<[number, number]> = [
    [1280, 720], [1366, 768], [1440, 900], [1536, 864], [1600, 900], [1680, 1050], [1920, 1080], [1920, 1200], [2560, 1080], [2560, 1440],
  ];
  for (const [w, h] of sizes) {
    const b = zoneBands(w, h);
    const tag = `${w}×${h}`;
    const headingBottom = b.gutter + 2 + 48;
    check(b.topLine >= headingBottom, `${tag}: the top zone's second line sits under the heading number`);
    check(b.raceReadout >= b.topLine, `${tag}: the race readout starts at or below the landmark line`);
    check(b.top.y1 < b.title.y0, `${tag}: top band ends before the title band (${b.top.y1} < ${b.title.y0})`);
    check(b.title.y1 <= b.center.y0 && b.center.y1 <= b.lowerCenter.y0, `${tag}: title, centre and lowerCenter bands in order`);
    check(b.lowerCenter.y1 <= b.bottom.y0, `${tag}: the hint line ends above the bottom cluster (${b.lowerCenter.y1} <= ${b.bottom.y0})`);
    check(b.center.y1 - b.center.y0 >= 0.25 * h, `${tag}: the centre keeps at least 25 % of the height clear (${b.center.y1 - b.center.y0} px)`);
    check(b.title.y1 <= 0.5 * h, `${tag}: the title band stays in the upper half (ends at ${Math.round((b.title.y1 / h) * 100)} %)`);
    // Countdown block: name (22 px · 1.2) + gap + numeral clamp(64px, 10.5vh, 112px) + gap + info line (≈20 px).
    const numeral = Math.min(112, Math.max(64, 0.105 * h));
    const block = 26 + 4 + numeral + 8 + 20;
    check(block <= b.title.y1 - b.title.y0, `${tag}: the countdown block fits the title band (${Math.round(block)} <= ${b.title.y1 - b.title.y0})`);
    // Area title: 46 px · 1.1 + 8 + rule + 8 + subtitle.
    check(51 + 8 + 1 + 8 + 20 <= b.title.y1 - b.title.y0, `${tag}: the area title fits the title band`);
  }
  const b = zoneBands(1440, 900);
  console.log(
    `bands 1440×900: top ${b.top.y0}–${b.top.y1} (line ${b.topLine}, readout ${b.raceReadout}) · title ${b.title.y0}–${b.title.y1} · ` +
      `centre ${b.center.y0}–${b.center.y1} · lowerCenter ${b.lowerCenter.y0}–${b.lowerCenter.y1} · bottom ${b.bottom.y0}–${b.bottom.y1}`,
  );
}

console.log(`${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  process.exit(1);
}
