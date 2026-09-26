/**
 * Headless check of the ferry escort ("Vapur eşliği", src/activities/escort). No browser, no GPU.
 *
 *   npx tsx tools/headless/escort-check.ts           # all sections
 *   npx tsx tools/headless/escort-check.ts --quick   # skips the real-fleet section
 *
 * 1. Start eligibility with a scripted ferry: the offer needs the ferry in service on its route, within 120 m and
 *    heading the dragon's way; none further away, crosswise or head-on, alongside a pier, slow, or during a race.
 * 2. Keeping and losing: staying within 200 m keeps the escort; drifting away shows the note (the hint line of the
 *    real zone director) after the short delay, coming back clears it, 30 s away ends the escort quietly.
 * 3. Arrival: the ferry coming alongside its next pier reports the leg once with its duration, and the arrival card
 *    takes the corner zone (the discovery card's priority, 9 s).
 * 4. Route records: the escortable routes (the directed legs of the vapur and city ferry lines), first / repeat
 *    escorts, the "3/N" count, the best time, storage in localStorage (and without it).
 * 5. Next leg: staying along while the ferry lies at the pier, the escort carries on when it leaves again.
 * 6. No escort in a race: no offer, a running escort ends, the escort's HUD items are deferred.
 * 7. Real fleet: the living world's vapurs and city ferries through the life service (pose and leg); the ?escort=
 *    shortcut puts the dragon beside one mid-crossing, the offer shows, and flying along with it the escort reaches the
 *    next pier and carries on with the following leg.
 *
 * Exits non-zero on any failure.
 */
import type { FerryLegInfo, HudZonesService, VesselPose } from '../../src/core/contracts';
import { HUD_PRIORITY, HudDirector } from '../../src/ui/zones/director';

// localStorage stand-in (the records use window.localStorage when it exists).
const store = new Map<string, string>();
(globalThis as unknown as { window: unknown }).window = {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
};

const { ESCORT_TUNING, EscortTracker, headingGap, offerDistance, vesselHeadingDeg } = await import('../../src/activities/escort/escort');
type EscortFerry = import('../../src/activities/escort/escort').EscortFerry;
type EscortEvent = import('../../src/activities/escort/escort').EscortEvent;
const { ESCORT_IDS, EscortPresenter } = await import('../../src/activities/escort/presenter');
const { ESCORT_ROUTES, clearEscortRecords, escortedRouteCount, loadEscortRecords, recordEscort } = await import('../../src/activities/escort/records');
const { ESCORT_TEXT, formatEscortDuration, shortPierName } = await import('../../src/activities/escort/text');
const { escortShortcut } = await import('../../src/activities/escort/shortcut');

const QUICK = process.argv.includes('--quick');
let failures = 0;
let checks = 0;
function check(cond: boolean, msg: string): void {
  checks++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!cond) failures++;
}
const f1 = (v: number): string => v.toFixed(1);

/* ------------------------------------------------------------------ */
/* Scripted ferry                                                      */
/* ------------------------------------------------------------------ */

/** A vapur running north (-Z) at 7 m/s from (0, 0) toward Kadıköy's dock 3 km away. */
function scriptedFerry(): EscortFerry {
  const pose: VesselPose = { id: 7, kind: 'vapur', x: 0, z: 0, yaw: 0, heave: 0, speed: 7, underway: true, length: 72, beam: 13, draft: 3, airDraft: 17 };
  const leg: FerryLegInfo = { line: 'eminonu-kadikoy', from: 'eminonu', to: 'kadikoy', fromName: 'Eminönü İskelesi', toName: 'Kadıköy İskelesi', phase: 'route', dockX: 0, dockZ: -3000 };
  return { pose, leg };
}

function advance(f: EscortFerry, dt: number): void {
  if (f.leg?.phase === 'route') {
    f.pose.z -= f.pose.speed * dt;
  }
}

/** Ferry heading 0° (north); dragon heading given. */
function dragonAt(x: number, z: number, headingDeg = 0): { x: number; z: number; headingDeg: number } {
  return { x, z, headingDeg };
}

function run(t: InstanceType<typeof EscortTracker>, frames: number, dt: number, input: Parameters<InstanceType<typeof EscortTracker>['update']>[1], each?: (ev: readonly EscortEvent[]) => void): EscortEvent[] {
  const all: EscortEvent[] = [];
  for (let i = 0; i < frames; i++) {
    for (const f of input.ferries) advance(f as EscortFerry, dt);
    const ev = t.update(dt, input);
    all.push(...ev);
    each?.(ev);
  }
  return all;
}

/* ------------------------------------------------------------------ */
console.log('1. start eligibility');
{
  const f = scriptedFerry();
  check(Math.abs(vesselHeadingDeg(f.pose) - 0) < 1e-6, 'a ferry with yaw 0 heads north (0°)');
  const east = { ...f.pose, yaw: -Math.PI / 2 };
  check(Math.abs(vesselHeadingDeg(east) - 90) < 1e-6, 'yaw −π/2 heads east (90°), the dragon heading convention');
  check(headingGap(350, 10) === 20 && headingGap(90, 270) === 180, 'heading gap wraps around north');
  check(offerDistance(f, 80, 20, 10) > 0, 'offer: 82 m abeam, heading 10° off');
  check(offerDistance(f, 0, 115, 0) > 0, 'offer: 115 m astern');
  check(offerDistance(f, 130, 0, 0) < 0, `no offer beyond ${ESCORT_TUNING.startRadius} m (130 m)`);
  check(offerDistance(f, 60, 0, 90) < 0, 'no offer flying crosswise (90°)');
  check(offerDistance(f, 60, 0, 180) < 0, 'no offer flying head-on (180°)');
  check(offerDistance(f, 60, 0, 45) > 0 && offerDistance(f, 60, 0, 55) < 0, `offer within ${ESCORT_TUNING.startHeadingDeg}° of the ferry's heading only`);
  const slow = scriptedFerry();
  slow.pose.speed = 1.5;
  check(offerDistance(slow, 60, 0, 0) < 0, 'no offer for a ferry slowing to its pier (not in service)');
  const docked = scriptedFerry();
  docked.leg!.phase = 'dwell';
  check(offerDistance(docked, 60, 0, 0) < 0, 'no offer for a ferry alongside');
  const astern = scriptedFerry();
  astern.pose.speed = -1.2;
  astern.leg!.phase = 'undock';
  check(offerDistance(astern, 60, 0, 180) < 0, 'no offer while it backs out of the pier');
  const other = scriptedFerry();
  other.leg = null;
  check(offerDistance(other, 60, 0, 0) < 0, 'no offer for an unscheduled boat (no leg)');

  const t = new EscortTracker();
  const near = scriptedFerry();
  const far = scriptedFerry();
  far.pose.id = 9;
  far.pose.x = 100;
  t.update(0.1, { dragon: dragonAt(40, 0), racing: false, ferries: [far, near] });
  check(t.offer === 7, 'the nearest eligible ferry is on offer');
  const zones = new HudDirector();
  const pr = new EscortPresenter(zones);
  pr.sync(t);
  zones.update(0.05);
  const line = zones.hintLine();
  check(zones.isShown(ESCORT_IDS.prompt) && !!line && line.hints.some(([k, l]) => k === 'L' && l === 'Vapura eşlik et'), 'the hint line shows "[L] Vapura eşlik et"');
  t.update(0.1, { dragon: dragonAt(40, 0), racing: true, ferries: [far, near] });
  pr.sync(t);
  zones.update(0.05);
  check(t.offer < 0 && !zones.has(ESCORT_IDS.prompt), 'no offer during a race (the prompt is withdrawn)');
  t.update(0.1, { dragon: dragonAt(40, 0), racing: false, ferries: [far, near] });
  t.update(0.1, { dragon: dragonAt(40, 0), racing: false, airborne: false, ferries: [far, near] });
  check(t.offer < 0, 'no offer while the dragon is on the ground, in the water or perched');
  t.update(0.1, { dragon: dragonAt(40, 0), racing: false, ferries: [far, near] });
  check(t.start() && t.active && t.ferryId === 7, 'start() escorts the ferry on offer');
  check(!t.start(), 'start() while escorting does nothing');
}

/* ------------------------------------------------------------------ */
console.log('2. keeping and losing the escort');
{
  const t = new EscortTracker();
  const f = scriptedFerry();
  const zones = new HudDirector();
  const pr = new EscortPresenter(zones);
  const d = dragonAt(70, 0);
  const input = { dragon: d, racing: false, ferries: [f] };
  t.update(1 / 24, input);
  t.start();
  const ev0 = t.update(1 / 24, input);
  check(ev0.some((e) => e.type === 'started' && e.leg.to === 'kadikoy'), "'started' with the leg to Kadıköy");
  const dt = 1 / 24;
  // Fly along 70 m off the beam for 60 s.
  let kept = true;
  run(t, 60 * 24, dt, input, () => {
    d.z = f.pose.z + 10;
    kept &&= t.active && t.away === 0;
    pr.sync(t);
    zones.update(dt);
  });
  check(kept, 'flying along 70 m abeam for 60 s keeps the escort, never away');
  check(zones.isShown(ESCORT_IDS.line) && pr.line.text === 'Sıradaki iskele: Kadıköy' && pr.line.detail.endsWith('km'), `the top line reads "${pr.line.text} · ${pr.line.detail}"`);
  check(Math.abs(pr.line.closeness - 70.7 / ESCORT_TUNING.keepRadius) < 0.02, `the closeness line sits at ${f1(pr.line.closeness * 100)} % of the radius`);
  // Hover in place: the ferry pulls away (7 m/s): beyond 200 m after ~27 s.
  let awayAt = -1;
  let noteAt = -1;
  let time = 0;
  const hoverZ = d.z;
  run(t, 40 * 24, dt, input, (ev) => {
    time += dt;
    d.z = hoverZ;
    if (awayAt < 0 && ev.some((e) => e.type === 'away')) awayAt = time;
    pr.sync(t);
    zones.update(dt);
    if (noteAt < 0 && zones.isShown(ESCORT_IDS.note)) noteAt = time;
  });
  const hl = zones.hintLine();
  check(awayAt > 0 && t.active, `hovering behind: 'away' after ${f1(awayAt)} s, the escort still runs (away ${f1(t.away)} s)`);
  check(noteAt > 0 && noteAt - awayAt < 0.5 && hl?.caption === 'Vapurdan uzaklaşıyorsun' && hl.hints.some(([k]) => k === 'L'), 'the note "Vapurdan uzaklaşıyorsun · [L] Eşliği bırak" takes the hint line');
  // Catch up: back within 200 m.
  let back = false;
  run(t, 24, dt, input, (ev) => {
    d.z = f.pose.z + 100;
    back ||= ev.some((e) => e.type === 'back');
    pr.sync(t);
    zones.update(dt);
  });
  run(t, 12, dt, input, () => {
    d.z = f.pose.z + 100;
    pr.sync(t);
    zones.update(dt);
  });
  check(back && t.away === 0 && t.active && !zones.has(ESCORT_IDS.note), "catching up: 'back', the note is gone, the escort goes on");
  // Stay behind for good: ends after 30 s away, quietly.
  let endAt = -1;
  let reason = '';
  time = 0;
  const stayZ = d.z;
  run(t, 60 * 24, dt, input, (ev) => {
    time += dt;
    d.z = stayZ;
    for (const e of ev) {
      if (e.type === 'ended' && endAt < 0) {
        endAt = time;
        reason = e.reason;
      }
    }
    pr.sync(t);
    zones.update(dt);
  });
  const beyondAt = (Math.sqrt(ESCORT_TUNING.keepRadius ** 2 - 70 ** 2) - 100) / 7;
  check(reason === 'drifted' && Math.abs(endAt - beyondAt - ESCORT_TUNING.grace) < 0.5, `left behind: ends 'drifted' ${f1(endAt - beyondAt)} s after passing 200 m (grace ${ESCORT_TUNING.grace} s)`);
  check(!t.active && !zones.has(ESCORT_IDS.line) && !zones.has(ESCORT_IDS.note), 'afterwards the line and the note are gone');
  check(ESCORT_TEXT.ended('drifted') !== null && ESCORT_TEXT.ended('race') === null, 'a quiet toast for drifting away, none for a race');
  // The player stops it.
  const t2 = new EscortTracker();
  t2.update(dt, { dragon: dragonAt(70, f.pose.z), racing: false, ferries: [f] });
  t2.start();
  t2.update(dt, { dragon: dragonAt(70, f.pose.z), racing: false, ferries: [f] });
  t2.stop('player');
  const ev = t2.update(dt, { dragon: dragonAt(70, f.pose.z), racing: false, ferries: [f] });
  check(ev.some((e) => e.type === 'ended' && e.reason === 'player') && !t2.active, "Z while escorting ends it ('player')");
  // The ferry vanishes (fleet rebuilt on a quality change).
  const t3 = new EscortTracker();
  t3.update(dt, { dragon: dragonAt(70, f.pose.z), racing: false, ferries: [f] });
  t3.start();
  t3.update(dt, { dragon: dragonAt(70, f.pose.z), racing: false, ferries: [f] });
  const ev3 = t3.update(dt, { dragon: dragonAt(70, f.pose.z), racing: false, ferries: [] });
  check(ev3.some((e) => e.type === 'ended' && e.reason === 'lost'), "the ferry gone: ends 'lost'");
}

/* ------------------------------------------------------------------ */
console.log('3. arrival, 4. route records, 5. next leg');
{
  clearEscortRecords();
  check(ESCORT_ROUTES.length === 24 && ESCORT_ROUTES.includes('eminonu>kadikoy') && ESCORT_ROUTES.includes('kadikoy>eminonu') && ESCORT_ROUTES.includes('buyukada>heybeliada') && !ESCORT_ROUTES.some((k) => k.includes('kadikoy-ido')), `${ESCORT_ROUTES.length} escortable routes: both ways of the 4 short lines, 8 legs each of the island and Bosphorus lines, no sea bus`);
  const t = new EscortTracker();
  const f = scriptedFerry();
  const zones = new HudDirector();
  const pr = new EscortPresenter(zones);
  const d = dragonAt(60, 0);
  const input = { dragon: d, racing: false, ferries: [f] };
  const dt = 1 / 24;
  t.update(dt, input);
  t.start();
  const all: EscortEvent[] = [];
  let time = 0;
  let arrivedAt = -1;
  const step = (frames: number, script: () => void): void => {
    for (let i = 0; i < frames; i++) {
      script();
      advance(f, dt);
      d.z = f.pose.z;
      time += dt;
      const ev = t.update(dt, input);
      all.push(...ev);
      for (const e of ev) {
        if (e.type === 'arrived') {
          arrivedAt = time;
          const r = recordEscort(e.routeKey, e.duration);
          pr.arrived({ route: ESCORT_TEXT.card.route(e.leg.fromName, e.leg.toName), duration: formatEscortDuration(e.duration), warm: ESCORT_TEXT.card.warm(r.done), routes: ESCORT_TEXT.card.routes(r.done, r.total), first: r.first });
        }
      }
      pr.sync(t);
      zones.update(dt);
    }
  };
  // Run 3 km, then come alongside at Kadıköy.
  step(Math.ceil((3000 / 7) * 24), () => undefined);
  check(!all.some((e) => e.type === 'arrived'), 'no arrival while it runs');
  f.leg = { ...f.leg!, phase: 'dwell', from: 'kadikoy', to: 'eminonu', fromName: 'Kadıköy İskelesi', toName: 'Eminönü İskelesi', dockX: 0, dockZ: 0 };
  f.pose.speed = 0;
  f.pose.underway = false;
  step(1, () => undefined);
  const arrived = all.filter((e) => e.type === 'arrived');
  const a = arrived[0];
  check(arrived.length === 1 && a?.type === 'arrived' && a.routeKey === 'eminonu>kadikoy' && Math.abs(a.duration - arrivedAt) < 0.1, `alongside at Kadıköy: 'arrived' once, eminonu>kadikoy in ${a?.type === 'arrived' ? formatEscortDuration(a.duration) : '?'}`);
  check(zones.isShown(ESCORT_IDS.card) && zones.shownIn('corner') === ESCORT_IDS.card, 'the arrival card takes the corner zone');
  const card = pr.lastCard!;
  check(card.route === 'Eminönü → Kadıköy' && card.routes === `Eşlik edilen hatlar 1/${ESCORT_ROUTES.length}` && card.first && card.duration === '7 dk 9 sn', `card: "Vapur eşliği · ${card.route}", ${card.duration}, "${card.warm}", "${card.routes}"`);
  check(t.phase === 'docked' && pr.line.text === 'Vapur iskelede · Sıradaki iskele: Eminönü' && pr.line.detail === '', `alongside: "${pr.line.text}"`);
  step(Math.ceil(9.5 * 24), () => undefined);
  check(!zones.has(ESCORT_IDS.card), 'the card leaves after 9 s');
  // Stay along through the dwell, then it leaves: the next leg.
  step(60 * 24, () => undefined);
  check(t.active && t.phase === 'docked' && !all.some((e) => e.type === 'leg'), 'hovering beside the pier through the dwell keeps the escort');
  f.leg = { ...f.leg, phase: 'route', dockX: 0, dockZ: 0 };
  f.pose.yaw = Math.PI;
  f.pose.speed = 7;
  f.pose.underway = true;
  step(1, () => undefined);
  const leg = all.find((e) => e.type === 'leg');
  check(leg?.type === 'leg' && leg.leg.from === 'kadikoy' && leg.leg.to === 'eminonu' && t.phase === 'escorting' && t.legTime < 0.1, "leaving the pier: 'leg' Kadıköy → Eminönü, the leg time restarts");
  check(pr.line.text === 'Sıradaki iskele: Eminönü', `the top line: "${pr.line.text} · ${pr.line.detail}"`);
  // Run back and dock at Eminönü.
  f.pose.z = -3000;
  const back = (): void => {
    f.pose.z += 7 * dt * 2; // advance() moved it north; this nets 7 m/s south
  };
  step(Math.ceil((3000 / 7) * 24) - 5, back);
  f.leg = { ...f.leg, phase: 'dwell', from: 'eminonu', to: 'kadikoy', fromName: 'Eminönü İskelesi', toName: 'Kadıköy İskelesi', dockX: 0, dockZ: -3000 };
  f.pose.speed = 0;
  step(1, () => undefined);
  const second = all.filter((e) => e.type === 'arrived')[1];
  check(second?.type === 'arrived' && second.routeKey === 'kadikoy>eminonu' && pr.lastCard?.routes === `Eşlik edilen hatlar 2/${ESCORT_ROUTES.length}`, `second leg recorded: kadikoy>eminonu, "${pr.lastCard?.routes}"`);
  check(t.legsDone === 2 && t.active, 'two legs in one escort, still escorting');

  // Records.
  const recs = loadEscortRecords();
  check(!!recs['eminonu>kadikoy'] && recs['eminonu>kadikoy'].count === 1 && escortedRouteCount() === 2, 'records: two routes, one escort each');
  const again = recordEscort('eminonu>kadikoy', 300);
  check(!again.first && again.record.count === 2 && again.record.best === 300 && again.done === 2, 'a repeat escort counts again, keeps the best time, the route count stays');
  const slower = recordEscort('eminonu>kadikoy', 900);
  check(slower.record.best === 300 && slower.record.count === 3, 'a slower escort does not replace the best time');
  recordEscort('karakoy>kadikoy', 500);
  check(escortedRouteCount() === 3 && ESCORT_TEXT.card.routes(escortedRouteCount(), ESCORT_ROUTES.length) === `Eşlik edilen hatlar 3/${ESCORT_ROUTES.length}`, `"Eşlik edilen hatlar 3/${ESCORT_ROUTES.length}"`);
  const saved = JSON.parse(store.get('evren.escort.v1') ?? '{}') as Record<string, { count: number }>;
  check(saved['eminonu>kadikoy']?.count === 3 && Object.keys(saved).length === 3, 'records are written to localStorage (evren.escort.v1)');
  recordEscort('not-a-route', 10);
  check(escortedRouteCount() === 3, 'legs outside the escortable routes do not count');
  // Without storage: records live in memory.
  const w = (globalThis as unknown as { window: { localStorage: unknown } }).window;
  const ls = w.localStorage;
  Object.defineProperty(w, 'localStorage', {
    configurable: true,
    get() {
      throw new Error('blocked');
    },
  });
  clearEscortRecords();
  const r = recordEscort('eminonu>uskudar', 200);
  check(r.first && r.done === 1 && escortedRouteCount() === 1, 'storage blocked: records still work for the session');
  Object.defineProperty(w, 'localStorage', { configurable: true, value: ls });
  check(shortPierName('Kadıköy İskelesi') === 'Kadıköy' && shortPierName('Anadolu Kavağı İskelesi') === 'Anadolu Kavağı', 'pier names are shortened ("Kadıköy İskelesi" → "Kadıköy")');
  check(formatEscortDuration(45) === '45 sn' && formatEscortDuration(412) === '6 dk 52 sn' && formatEscortDuration(1260) === '21 dk', 'durations: 45 sn, 6 dk 52 sn, 21 dk');
}

/* ------------------------------------------------------------------ */
console.log('6. no escort in a race');
{
  const t = new EscortTracker();
  const f = scriptedFerry();
  const zones = new HudDirector();
  const pr = new EscortPresenter(zones);
  const d = dragonAt(60, 0);
  const dt = 1 / 24;
  t.update(dt, { dragon: d, racing: false, ferries: [f] });
  t.start();
  t.update(dt, { dragon: d, racing: false, ferries: [f] });
  pr.sync(t);
  zones.update(dt);
  check(zones.isShown(ESCORT_IDS.line), 'escorting: the top line shows');
  // A race starts (the activity system sets the 'race' context and dragon.racing).
  zones.setContext('race', true);
  const ev = t.update(dt, { dragon: d, racing: true, ferries: [f] });
  pr.sync(t);
  zones.update(dt);
  check(ev.some((e) => e.type === 'ended' && e.reason === 'race') && !t.active, "a race ends the escort ('race')");
  check(!t.start() && t.offer < 0, 'no offer and no start while racing');
  pr.arrived({ route: 'A → B', duration: '1 dk', warm: '', routes: '1/24', first: true });
  zones.update(dt);
  check(zones.has(ESCORT_IDS.card) && !zones.isShown(ESCORT_IDS.card), 'escort HUD items are deferred during a race');
  const hz: HudZonesService = zones;
  check(HUD_PRIORITY.escortLine > HUD_PRIORITY.startHint && HUD_PRIORITY.escortPrompt < HUD_PRIORITY.momentLine && HUD_PRIORITY.escortNote < HUD_PRIORITY.momentLine && !!hz, 'priorities: the escort line above the compass label, prompt and note under moment lines');
  zones.setContext('race', false);
}

/* ------------------------------------------------------------------ */
if (!QUICK) {
  console.log('7. real fleet');
  const THREE = await import('three');
  const { buildHeadlessGeo } = await import('./geo');
  const { buildCatalog } = await import('../../src/world/life/vessels/catalog');
  const { Fleet } = await import('../../src/world/life/vessels/fleet');
  const { buildStraitLanes, placeBerths } = await import('../../src/world/life/vessels/routes');
  const { createLifeService } = await import('../../src/world/life/life-service');
  const { ANCHOR_KINDS } = await import('../../src/moments/anchors');
  const geo = buildHeadlessGeo();
  const models = await buildCatalog();
  const fleet = new Fleet({ geo, models, berths: placeBerths(geo), lanes: buildStraitLanes(geo), shipCount: 45 }, new THREE.MeshBasicMaterial());
  const life = createLifeService({ fleet, flocks: null });
  const cam = new THREE.Vector3(0, 50, 0);
  const dt = 1 / 12;
  for (let k = 0; k < 60 / dt; k++) fleet.update(dt, cam);
  const poses: VesselPose[] = [];
  const ferries: EscortFerry[] = [];
  const read = (): void => {
    life.vessels(ANCHOR_KINDS.ferry, poses);
    ferries.length = poses.length;
    for (let i = 0; i < poses.length; i++) {
      const leg = { line: '', from: '', to: '', fromName: '', toName: '', phase: 'route', dockX: 0, dockZ: 0 } as FerryLegInfo;
      ferries[i] = { pose: poses[i], leg: life.ferryLeg!(poses[i].id, leg) };
    }
  };
  read();
  const scheduled = ferries.filter((f) => f.leg);
  check(scheduled.length >= 6 && scheduled.every((f) => f.leg!.fromName.endsWith('İskelesi') && f.leg!.from !== f.leg!.to), `life.ferryLeg: ${scheduled.length} scheduled vapurs and city ferries with their legs (${scheduled.map((f) => `${f.leg!.from}>${f.leg!.to}`).slice(0, 4).join(', ')}, …)`);
  check(scheduled.every((f) => ESCORT_ROUTES.includes(`${f.leg!.from}>${f.leg!.to}`)), 'every live leg is one of the escortable routes');
  const pick = escortShortcut(ferries, (x, z) => geo.coastDistance(x, z));
  check(!!pick, '?escort= finds a ferry mid-crossing');
  if (pick) {
    const t = new EscortTracker();
    const zones = new HudDirector();
    const pr = new EscortPresenter(zones);
    const d = { x: pick.pose.x, z: pick.pose.z, headingDeg: pick.pose.headingDeg };
    t.update(dt, { dragon: d, racing: false, ferries });
    const f0 = ferries.find((f) => f.pose.id === pick.ferryId)!;
    check(t.offer === pick.ferryId, `the shortcut pose is on offer (${f1(Math.hypot(d.x - f0.pose.x, d.z - f0.pose.z))} m from ${f0.pose.kind} #${pick.ferryId}, ${f0.leg!.fromName} → ${f0.leg!.toName})`);
    t.start();
    // Fly along: keep the offset in the ferry's frame (abeam, a little astern), matching its heading.
    const offX = d.x - f0.pose.x;
    const offZ = d.z - f0.pose.z;
    const events: EscortEvent[] = [];
    let time = 0;
    let arrivedAt = -1;
    let legAt = -1;
    let maxDist = 0;
    const firstTo = f0.leg!.to;
    let lineSeen = '';
    for (; time < 45 * 60; time += dt) {
      fleet.update(dt, cam.set(d.x, 50, d.z));
      read();
      const f = ferries.find((x) => x.pose.id === pick.ferryId);
      if (f) {
        d.x = f.pose.x + offX;
        d.z = f.pose.z + offZ;
        d.headingDeg = vesselHeadingDeg(f.pose);
      }
      const ev = t.update(dt, { dragon: d, racing: false, ferries });
      events.push(...ev);
      pr.sync(t);
      zones.update(dt);
      if (t.active) maxDist = Math.max(maxDist, t.distance);
      if (!lineSeen && zones.isShown(ESCORT_IDS.line)) lineSeen = `${pr.line.text} · ${pr.line.detail}`;
      if (arrivedAt < 0 && ev.some((e) => e.type === 'arrived')) arrivedAt = time;
      if (legAt < 0 && ev.some((e) => e.type === 'leg')) {
        legAt = time;
        break;
      }
      if (!t.active) break;
    }
    const arrived = events.find((e) => e.type === 'arrived');
    const leg = events.find((e) => e.type === 'leg');
    console.log(`     (line "${lineSeen}", farthest ${f1(maxDist)} m from the ferry)`);
    check(arrived?.type === 'arrived' && arrived.leg.to === firstTo, `the real ferry comes alongside ${f0.leg!.toName} after ${f1(arrivedAt / 60)} min: 'arrived' ${arrived?.type === 'arrived' ? `${arrived.routeKey} in ${formatEscortDuration(arrived.duration)}` : ''}`);
    check(leg?.type === 'leg' && leg.leg.from === firstTo && t.active && t.phase === 'escorting', `after the dwell (${f1(legAt - arrivedAt)} s) the escort carries on: ${leg?.type === 'leg' ? `${shortPierName(leg.leg.fromName)} → ${shortPierName(leg.leg.toName)}` : 'no next leg'}`);
    check(!events.some((e) => e.type === 'ended'), 'flying along, the escort never ends');
  }
}

console.log('8. the land key doubles as the escort key');
{
  // Input needs a window and a canvas for its listeners; stubs are enough to drive a key press.
  const g = globalThis as unknown as { window?: Record<string, unknown> };
  g.window ??= {};
  g.window.addEventListener ??= () => {};
  g.window.removeEventListener ??= () => {};
  const gd = globalThis as unknown as { document?: Record<string, unknown> };
  gd.document ??= {};
  gd.document.addEventListener ??= () => {};
  const { Input } = await import('../../src/core/input');
  const canvas = { addEventListener() {}, removeEventListener() {} } as unknown as HTMLElement;
  const inp = new Input(canvas);
  const press = (): void => {
    const onKeyDown = (inp as unknown as { onKeyDown: (e: unknown) => void }).onKeyDown;
    const onKeyUp = (inp as unknown as { onKeyUp: (e: unknown) => void }).onKeyUp;
    onKeyDown({ code: 'KeyL', repeat: false, target: null, ctrlKey: false, preventDefault() {} });
    onKeyUp({ code: 'KeyL', target: null, preventDefault() {} });
    inp.update(1 / 24);
  };
  press();
  check(inp.wasPressed('land') && !inp.wasClaimedPress('land'), 'unclaimed: L lands (the flight reads it, the escort does not)');
  inp.claim('land', true);
  press();
  check(!inp.wasPressed('land') && inp.wasClaimedPress('land'), 'claimed while the offer shows: L starts the escort and does not land');
  inp.claim('land', false);
  press();
  check(inp.wasPressed('land'), 'released again: L lands');
}

console.log(`escort-check: ${checks} checks, ${failures} failed`);
process.exit(failures > 0 ? 1 : 0);
