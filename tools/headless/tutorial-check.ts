/**
 * Headless check of the contextual move hints (src/ui/tutorial; pure TS, no browser):
 *
 *   npx tsx tools/headless/tutorial-check.ts
 *
 * Drives the real tutorial engine and the real HUD zone director with scripted flight-state sequences:
 * - every catalogue entry fires in a representative situation (and only that one);
 * - the global pacing: nothing in the first seconds or while the start hints are up, one new hint per gap, the line
 *   quiet first, a session cap;
 * - per hint: the trigger must hold, one show per cooldown, max shows, tried (fewer shows, longer cooldown), learned
 *   (never again), performing the move removes its hint, a non-sticky hint leaves when its moment passes, a sticky
 *   one stays;
 * - never during races, landing approaches, perching, moments' subtitle lines or other messages (a displaced hint
 *   does not come back), menus (suspend);
 * - never two hints at once; persistence round trip (switch, shown counts, tried, learned), corrupt or throwing
 *   storage, reset.
 *
 * Exits non-zero on any failure.
 */
import { HudDirector, HUD_PRIORITY } from '../../src/ui/zones/director';
import { TUTORIAL_HINT_ID, TutorialEngine, type TutorialPacing } from '../../src/ui/tutorial/engine';
import { TUTORIAL_HINTS, TUTORIAL_PACING, type TutorialFrame } from '../../src/ui/tutorial/hints-data';
import { TutorialStore, type KeyValueStorage } from '../../src/ui/tutorial/store';
import { emptyFrame, senseTutorial } from '../../src/ui/tutorial/sense';
import * as THREE from 'three';
import type { EngineContext } from '../../src/core/contracts';

let failures = 0;
let checks = 0;
function check(cond: boolean, msg: string): void {
  checks++;
  if (!cond) {
    failures++;
    console.error(`FAIL  ${msg}`);
  }
}

class MemoryStorage implements KeyValueStorage {
  readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

/** Plain cruise that triggers nothing (banked 20°: no calm-flight hints; 100 m over rough land). */
const NEUTRAL: TutorialFrame = {
  mode: 'flying',
  speed: 25,
  agl: 100,
  pathDeg: 0,
  bankDeg: 20,
  stamina: 1,
  flow: 0,
  ground: 'rough',
  waterDepth: 0,
  coastDistance: 1000,
  racing: false,
  perchBusy: false,
  lineBusy: false,
  startHints: false,
};
const frame = (o: Partial<TutorialFrame>): TutorialFrame => ({ ...NEUTRAL, ...o });

const DART = frame({ speed: 35, agl: 60, bankDeg: 0 });
const POWER = frame({ speed: 18, agl: 50, bankDeg: 0 });
const SPLITS = frame({ mode: 'diving', speed: 35, agl: 300, pathDeg: -40, bankDeg: 0 });

interface Rig {
  d: HudDirector;
  e: TutorialEngine;
  store: TutorialStore;
  storage: MemoryStorage;
  /** Shows per hint id (counted on the zone item's first appearance). */
  shows: Map<string, number>;
  /** Frames on which the line showed the tutorial item and something else at once, or the engine disagreed. */
  conflicts: number;
  t: number;
  wasOn: boolean;
}

function rig(pacing: Partial<TutorialPacing> = {}, storage = new MemoryStorage()): Rig {
  const d = new HudDirector();
  const store = new TutorialStore(storage);
  const e = new TutorialEngine(d, store, TUTORIAL_HINTS, pacing);
  return { d, e, store, storage, shows: new Map(), conflicts: 0, t: 0, wasOn: false };
}

/** Runs `seconds` of play at 30 fps like the UI loop: the engine first (with the gates read from the director), then the zones. */
function run(r: Rig, seconds: number, f: TutorialFrame, fps = 30): void {
  const dt = 1 / fps;
  let left = seconds;
  while (left > 1e-9) {
    const step = Math.min(dt, left);
    const line = r.d.shownIn('lowerCenter');
    const busy = (line !== '' && line !== TUTORIAL_HINT_ID) || r.d.shownIn('title') !== '' || r.d.shownIn('corner') !== '';
    r.e.update(step, { ...f, lineBusy: busy, startHints: f.startHints || r.d.has('hints.start'), racing: f.racing || r.d.hasContext('race') });
    r.d.update(step);
    const on = r.d.isShown(TUTORIAL_HINT_ID);
    if (on && !r.wasOn) {
      r.shows.set(r.e.showing, (r.shows.get(r.e.showing) ?? 0) + 1);
    }
    if (on && (r.d.shownIn('lowerCenter') !== TUTORIAL_HINT_ID || r.e.showing === '')) {
      r.conflicts++;
    }
    r.wasOn = on;
    r.t += step;
    left -= step;
  }
}

/** Runs until the tutorial item is on screen (or `limit` seconds); returns the time it took. */
function runUntilShown(r: Rig, f: TutorialFrame, limit: number): number {
  const t0 = r.t;
  while (r.t - t0 < limit) {
    run(r, 1 / 30, f);
    if (r.d.isShown(TUTORIAL_HINT_ID)) {
      return r.t - t0;
    }
  }
  return Infinity;
}

const count = (r: Rig, id: string): number => r.shows.get(id) ?? 0;
const free: Partial<TutorialPacing> = { firstAfter: 0, gap: 0, quiet: 0 };

/* ---------------- catalogue: every entry fires in its situation ---------------- */
{
  const cases: Array<{ id: string; f: TutorialFrame; pre?: (r: Rig) => void }> = [
    { id: 'breach', f: frame({ mode: 'underwater', speed: 5, agl: 0, ground: 'water', waterDepth: 30 }) },
    { id: 'water-takeoff', f: frame({ mode: 'swimming', speed: 1, agl: 0, ground: 'water', waterDepth: 30 }) },
    { id: 'touchgo', f: frame({ mode: 'grounded', speed: 12, agl: 0, ground: 'flat' }), pre: (r) => r.e.note({ kind: 'start', id: 'runout' }) },
    { id: 'plunge', f: frame({ mode: 'diving', speed: 30, agl: 120, pathDeg: -30, ground: 'water', waterDepth: 30, coastDistance: 500 }) },
    { id: 'splits', f: SPLITS },
    { id: 'wingover', f: frame({ speed: 30, agl: 80, bankDeg: 60 }) },
    { id: 'immelmann', f: frame({ speed: 25, agl: 90, bankDeg: 0 }), pre: (r) => r.e.note({ kind: 'start', id: 'loop' }) },
    { id: 'runout', f: frame({ speed: 25, agl: 10, ground: 'flat' }) },
    { id: 'skim', f: frame({ speed: 25, agl: 10, bankDeg: 0, ground: 'water', waterDepth: 5 }) },
    { id: 'dart', f: DART },
    { id: 'power', f: POWER },
    { id: 'flow', f: frame({ flow: 0.3 }) },
    { id: 'dive', f: frame({ agl: 200 }) },
    { id: 'roll', f: frame({ agl: 70, bankDeg: 0 }), pre: (r) => (r.store.progress.shown.power = 1) },
    { id: 'loop', f: frame({ agl: 90, bankDeg: 0 }), pre: (r) => r.store.progress.learned.add('roll') },
    { id: 'slip', f: frame({ agl: 30, bankDeg: 0 }), pre: (r) => r.store.progress.learned.add('dart') },
    { id: 'land', f: frame({ speed: 12, agl: 20, bankDeg: 0, ground: 'flat', stamina: 0.3 }) },
  ];
  check(cases.length === TUTORIAL_HINTS.length, `catalogue: a situation for every entry (${cases.length} / ${TUTORIAL_HINTS.length})`);
  for (const c of cases) {
    const r = rig(free);
    run(r, 0.1, frame({ mode: 'gliding', agl: 100 }));
    c.pre?.(r);
    const took = runUntilShown(r, c.f, 12);
    check(took < 12 && r.e.showing === c.id, `catalogue: ${c.id} fires in its situation (showing '${r.e.showing}' after ${took.toFixed(2)} s)`);
    const line = r.d.hintLine();
    const def = TUTORIAL_HINTS.find((h) => h.id === c.id)!;
    const text = def.keys ? line?.hints[0]?.join(' ') : line?.caption;
    check(text === (def.keys ? `${def.keys} ${def.text}` : def.text), `catalogue: ${c.id} shows its key and text on the hint line (${text})`);
  }
  const r = rig(free);
  run(r, 120, NEUTRAL);
  check(r.shows.size === 0, 'catalogue: plain banked cruise triggers nothing');
  // Key-first: every keyed entry names its key, keyless ones are automatic features.
  for (const h of TUTORIAL_HINTS) {
    check(h.text.length > 0 && h.text[0] === h.text[0].toLocaleUpperCase('tr-TR'), `catalogue: ${h.id} text in sentence case`);
  }
  check(new Set(TUTORIAL_HINTS.map((h) => h.id)).size === TUTORIAL_HINTS.length, 'catalogue: unique ids');
  check(!TUTORIAL_HINTS.some((h) => h.text.includes('Kon') || h.text.includes('Kaynağa')), 'catalogue: no duplicate of the perch prompt or the moments source prompt');
}

/* ---------------- pacing: first hint, start hints, gap ---------------- */
{
  const r = rig();
  r.d.request({ id: 'hints.start', zone: 'lowerCenter', priority: HUD_PRIORITY.startHint, duration: 14, maxWait: 30, hints: [['M', 'Harita']] });
  run(r, 44, DART);
  check(count(r, 'dart') === 0, 'pacing: nothing in the first 45 s of play');
  const took = runUntilShown(r, DART, 3);
  check(took < 3 && r.e.showing === 'dart', `pacing: the dart hint shows once 45 s have passed (at ${(44 + took).toFixed(1)} s)`);
  run(r, TUTORIAL_PACING.duration + 0.5, DART);
  check(!r.d.isShown(TUTORIAL_HINT_ID), 'pacing: the hint leaves after its duration');
  // A different move is ready right after: it waits for the global gap.
  run(r, 40, POWER);
  check(count(r, 'power') === 0, 'pacing: no second hint within the gap');
  const t2 = runUntilShown(r, POWER, 30);
  const at = r.t;
  check(t2 < 30 && r.e.showing === 'power', `pacing: the next hint after the gap (at ${at.toFixed(1)} s)`);
  check(at >= 45 + TUTORIAL_PACING.gap - 0.5, 'pacing: the gap is at least 60 s of play');
}
{
  // Start hints still up (requested) at 45 s: nothing until they are gone.
  const r = rig();
  r.d.request({ id: 'hints.start', zone: 'lowerCenter', priority: HUD_PRIORITY.startHint, maxWait: 1e9, hints: [['M', 'Harita']] });
  r.d.setContext('race', false);
  run(r, 60, DART);
  check(count(r, 'dart') === 0, 'pacing: nothing while the start hints are requested');
  r.d.release('hints.start');
  run(r, 2, DART);
  check(count(r, 'dart') === 0, 'pacing: the line must be quiet 3 s after the start hints');
  check(runUntilShown(r, DART, 3) < 3, 'pacing: then the hint shows');
}
{
  // Session cap.
  const r = rig({ ...free, cooldown: 0, maxShows: 99, sessionMax: 2, duration: 1 });
  run(r, 60, DART);
  check(count(r, 'dart') === 2, `pacing: at most sessionMax hints per session (${count(r, 'dart')})`);
}

/* ---------------- hold ---------------- */
{
  const r = rig(free);
  run(r, 0.3, SPLITS);
  run(r, 5, NEUTRAL);
  check(count(r, 'splits') === 0, 'hold: a trigger held 0.3 s does not fire (Split-S needs 0.5 s)');
  run(r, 0.9, SPLITS);
  check(count(r, 'splits') === 1, 'hold: held long enough, it fires');
}

/* ---------------- cooldown, max shows, tried, learned ---------------- */
{
  const r = rig();
  run(r, 1200, DART);
  check(count(r, 'dart') === TUTORIAL_PACING.maxShows, `max shows: the dart hint shows ${TUTORIAL_PACING.maxShows} times in 20 min of dart-ready flight (${count(r, 'dart')})`);
  check(r.store.progress.shown.dart === TUTORIAL_PACING.maxShows, 'max shows: the count is persisted');
}
{
  const r = rig();
  runUntilShown(r, DART, 60);
  check(r.e.showing === 'dart', 'tried: the dart hint is up');
  r.e.note({ kind: 'start', id: 'dart' });
  run(r, 0.1, DART);
  check(!r.d.isShown(TUTORIAL_HINT_ID) && r.e.showing === '', 'tried: performing the move removes its hint at once');
  check(r.e.status('dart') === 'tried', 'tried: status tried');
  run(r, 400, DART);
  check(count(r, 'dart') === 1, 'tried: the cooldown doubles (no show within 480 s)');
  run(r, 200, DART);
  check(count(r, 'dart') === 2, 'tried: one more show after the doubled cooldown');
  run(r, 1200, DART);
  check(count(r, 'dart') === 2, 'tried: at most two shows once tried');
  r.e.note({ kind: 'end', id: 'dart', clean: false });
  check(r.e.status('dart') === 'tried', 'learned: an unclean end is not learned');
  r.e.note({ kind: 'end', id: 'dart', clean: true });
  check(r.e.status('dart') === 'learned', 'learned: a clean end is learned');
}
{
  const storage = new MemoryStorage();
  const r0 = rig({}, storage);
  r0.e.note({ kind: 'start', id: 'runout' });
  const r = rig({ ...free }, storage);
  run(r, 300, frame({ speed: 25, agl: 10, ground: 'flat' }));
  check(count(r, 'runout') === 0, 'learned: a learned move (run-out) never shows again, also in a new session');
  r.e.note({ kind: 'start', id: 'takeoff' });
  check(r.e.status('water-takeoff') === 'new', 'learned: a take-off from land does not count as the water take-off');
  run(r, 0.5, frame({ mode: 'swimming', speed: 1, agl: 0, ground: 'water' }));
  r.e.note({ kind: 'start', id: 'takeoff' });
  check(r.e.status('water-takeoff') === 'learned', 'learned: a take-off while swimming learns the water take-off');
  r.e.note({ kind: 'link', link: 1 });
  check(r.e.status('flow') === 'new', 'learned: one chain link is not yet a chain');
  r.e.note({ kind: 'link', link: 2 });
  check(r.e.status('flow') === 'learned', 'learned: a chain of two links learns flow');
  r.e.note({ kind: 'start', id: 'breach', clean: false });
  check(r.e.status('breach') === 'tried', 'learned: an unclean breach is only tried');
}

/* ---------------- relevance: non-sticky leave, sticky stay ---------------- */
{
  const r = rig(free);
  runUntilShown(r, SPLITS, 5);
  run(r, 1, SPLITS);
  run(r, 2.2, NEUTRAL);
  check(!r.d.isShown(TUTORIAL_HINT_ID), 'relevance: the Split-S hint leaves ~1.5 s after the dive ends');
  const f = frame({ flow: 0.3 });
  const r2 = rig(free);
  runUntilShown(r2, f, 5);
  run(r2, 4, NEUTRAL);
  check(r2.d.isShown(TUTORIAL_HINT_ID) && r2.e.showing === 'flow', 'relevance: the sticky flow hint keeps its time');
  run(r2, 3, NEUTRAL);
  check(!r2.d.isShown(TUTORIAL_HINT_ID), 'relevance: then it leaves');
  run(r2, 600, frame({ flow: 0.3 }));
  check(count(r2, 'flow') === 1, 'max shows: flow shows once');
}

/* ---------------- gates: races, landing, perching, moments, menus ---------------- */
{
  const r = rig(free);
  r.d.setContext('race', true);
  run(r, 120, DART);
  check(r.shows.size === 0, 'gates: nothing during a race');
  r.d.setContext('race', false);
  check(runUntilShown(r, DART, 5) < 5, 'gates: hints resume after the race');
  r.d.setContext('race', true);
  run(r, 0.1, DART);
  check(!r.d.isShown(TUTORIAL_HINT_ID) && r.e.showing === '', 'gates: a race starting removes the hint');
}
{
  const r = rig(free);
  run(r, 60, frame({ mode: 'landing', speed: 25, agl: 10, ground: 'flat' }));
  check(r.shows.size === 0, 'gates: nothing on a landing approach');
  run(r, 60, { ...DART, perchBusy: true });
  check(r.shows.size === 0, 'gates: nothing with a perch prompt, approach or perched viewing');
  run(r, 30, { ...DART, mode: null });
  check(r.shows.size === 0, 'gates: nothing without a dragon');
}
{
  // A moment's subtitle line holds the hint line (and goes quiet between lines): the default quiet time applies.
  const r = rig({ firstAfter: 0, gap: 0 });
  run(r, 1, NEUTRAL);
  r.d.request({ id: 'moment.line', zone: 'lowerCenter', priority: HUD_PRIORITY.momentLine, deferIn: ['race'] });
  run(r, 20, DART);
  check(r.shows.size === 0, 'gates: nothing under a moment subtitle line');
  r.d.release('moment.line');
  run(r, 1.5, DART);
  r.d.request({ id: 'moment.line', zone: 'lowerCenter', priority: HUD_PRIORITY.momentLine, deferIn: ['race'] });
  run(r, 5, DART);
  check(r.shows.size === 0, 'gates: nothing in a short pause between two subtitle lines');
  r.d.release('moment.line');
  r.d.request({ id: 'moment.card', zone: 'corner', priority: HUD_PRIORITY.discovery, duration: 8 });
  run(r, 6, DART);
  check(r.shows.size === 0, 'gates: nothing while a card is in the corner');
  run(r, 8, DART);
  check(count(r, 'dart') === 1, 'gates: the hint shows once the screen is quiet');
}
{
  // Displaced by a maneuver caption: gone, does not come back.
  const r = rig(free);
  runUntilShown(r, DART, 5);
  r.d.request({ id: 'caption.maneuver', zone: 'lowerCenter', priority: HUD_PRIORITY.maneuver, duration: 1.4, maxWait: 0.6 });
  run(r, 0.2, NEUTRAL);
  check(!r.d.isShown(TUTORIAL_HINT_ID) && r.e.showing === '', 'gates: a maneuver caption displaces the hint');
  run(r, 3, NEUTRAL);
  check(!r.d.isShown(TUTORIAL_HINT_ID), 'gates: the displaced hint does not come back');
}
{
  // Menus / photo mode: the UI suspends the engine (no updates) and the hint leaves.
  const r = rig(free);
  runUntilShown(r, DART, 5);
  const played = r.e.playTime;
  r.e.suspend();
  r.d.update(0.5);
  check(!r.d.isShown(TUTORIAL_HINT_ID) && r.e.showing === '', 'gates: opening a menu removes the hint');
  check(r.e.playTime === played, 'gates: menu time is not play time');
}
{
  // Disabled: nothing, and turning it off removes the showing hint.
  const r = rig(free);
  runUntilShown(r, DART, 5);
  r.e.setEnabled(false);
  run(r, 0.1, DART);
  check(!r.d.isShown(TUTORIAL_HINT_ID), 'settings: switching the hints off removes the hint');
  run(r, 300, POWER);
  check(count(r, 'power') === 0, 'settings: no hints while switched off');
}

/* ---------------- never two at once (long mixed sequence) ---------------- */
{
  const r = rig({ ...free, cooldown: 5, maxShows: 99, sessionMax: 999, duration: 3 });
  const seq = [DART, POWER, SPLITS, frame({ flow: 0.3 }), frame({ speed: 30, agl: 80, bankDeg: 60 }), frame({ speed: 25, agl: 10, bankDeg: 0, ground: 'water', waterDepth: 5 })];
  for (let i = 0; i < 120; i++) {
    run(r, 0.7 + (i % 5) * 0.9, seq[i % seq.length]);
    if (i % 17 === 0) {
      r.d.request({ id: 'caption.maneuver', zone: 'lowerCenter', priority: HUD_PRIORITY.maneuver, duration: 1.4, maxWait: 0.6 });
    }
  }
  const total = [...r.shows.values()].reduce((a, b) => a + b, 0);
  check(total > 10, `one at a time: the mixed sequence shows hints (${total})`);
  check(r.conflicts === 0, `one at a time: the tutorial item never shares the line or disagrees with the engine (${r.conflicts})`);
}

/* ---------------- persistence ---------------- */
{
  const storage = new MemoryStorage();
  const r = rig({}, storage);
  runUntilShown(r, DART, 60);
  r.e.note({ kind: 'start', id: 'power' });
  r.e.note({ kind: 'start', id: 'runout' });
  r.e.setEnabled(false);
  const back = new TutorialStore(storage).progress;
  check(back.shown.dart === 1, 'persistence: shown counts survive a reload');
  check(back.tried.has('power') && !back.learned.has('power'), 'persistence: tried survives');
  check(back.learned.has('runout'), 'persistence: learned survives');
  check(back.enabled === false, 'persistence: the switch survives');
  const again = new TutorialStore(storage);
  again.reset();
  const cleared = new TutorialStore(storage).progress;
  check(Object.keys(cleared.shown).length === 0 && cleared.tried.size === 0 && cleared.learned.size === 0, 'persistence: reset clears progress');
  check(cleared.enabled === false, 'persistence: reset keeps the switch');

  const corrupt = new MemoryStorage();
  corrupt.setItem('ejderha.ui.tutorial.v1', '{not json');
  const c = new TutorialStore(corrupt).progress;
  check(c.enabled && c.learned.size === 0, 'persistence: a corrupt entry falls back to defaults');
  const odd = new MemoryStorage();
  odd.setItem('ejderha.ui.tutorial.v1', JSON.stringify({ enabled: 'yes', shown: { dart: 'x', power: 2 }, learned: [1, 'loop'] }));
  const o = new TutorialStore(odd).progress;
  check(o.enabled && o.shown.power === 2 && o.shown.dart === undefined && o.learned.has('loop') && o.learned.size === 1, 'persistence: bad fields are ignored');

  const throwing: KeyValueStorage = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
  };
  let ok = true;
  try {
    const s = new TutorialStore(throwing);
    s.save();
    s.reset();
    const e = new TutorialEngine(new HudDirector(), s, TUTORIAL_HINTS, free);
    e.update(1, DART);
    e.note({ kind: 'start', id: 'dart' });
  } catch {
    ok = false;
  }
  check(ok, 'persistence: a throwing storage never throws out of the store or the engine');
  const none = new TutorialStore(null);
  check(none.progress.enabled, 'persistence: no storage at all works with defaults');

  // Engine reset: everything may show again at once (the session pacing starts over).
  const r2 = rig({}, new MemoryStorage());
  runUntilShown(r2, DART, 60);
  r2.e.note({ kind: 'end', id: 'dart', clean: true });
  r2.e.reset();
  check(r2.e.status('dart') === 'new' && r2.e.shownCount('dart') === 0, 'reset: progress cleared');
  check(runUntilShown(r2, DART, 5) < 5, 'reset: the hint may show again right away');
}

/* ---------------- sense: attitude, ground, gates from the game state ---------------- */
{
  const dragon = {
    mode: 'flying',
    airspeed: 30,
    agl: 40,
    altitude: 40,
    stamina: 0.8,
    flow: 0.1,
    position: new THREE.Vector3(10, 40, 20),
    velocity: new THREE.Vector3(0, -10, -Math.sqrt(3) * 10),
    quaternion: new THREE.Quaternion(),
    perch: { phase: 'free', offer: null },
  };
  const geo = {
    heightAt: () => -25,
    isWater: () => true,
    coastDistance: () => -300,
    normalAt: (_x: number, _z: number, out: THREE.Vector3) => out.set(0, 1, 0),
    densityAt: () => 0,
  };
  const services: Record<string, unknown> = { dragon, geo };
  const ctx = { services: { tryGet: (name: string) => services[name] } } as unknown as EngineContext;
  const d = new HudDirector();
  const f = emptyFrame();
  // Rolled 60° to the right about the nose (-Z): the right wing goes down.
  dragon.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, -1), THREE.MathUtils.degToRad(60));
  senseTutorial(ctx, d, f);
  check(Math.abs(Math.abs(f.bankDeg) - 60) < 0.5, `sense: bank from the attitude (${f.bankDeg.toFixed(1)}°)`);
  check(Math.abs(f.pathDeg + 30) < 0.5, `sense: flight path angle from the velocity (${f.pathDeg.toFixed(1)}°)`);
  check(f.ground === 'water' && f.waterDepth === 25 && f.coastDistance === 300, 'sense: deep water below');
  dragon.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, -1), THREE.MathUtils.degToRad(150));
  senseTutorial(ctx, d, f);
  check(Math.abs(f.bankDeg) > 90, 'sense: inverted reads beyond 90°');
  check(!f.lineBusy && !f.racing && !f.perchBusy && !f.startHints, 'sense: no gates in plain flight');
  d.request({ id: TUTORIAL_HINT_ID, zone: 'lowerCenter', priority: HUD_PRIORITY.tutorialHint, hints: [['L', 'x']] });
  d.update(0.1);
  senseTutorial(ctx, d, f);
  check(!f.lineBusy, 'sense: its own hint does not make the line busy');
  d.release(TUTORIAL_HINT_ID);
  d.request({ id: 'moment.line', zone: 'lowerCenter', priority: HUD_PRIORITY.momentLine });
  d.setContext('race', true);
  d.update(0.5);
  senseTutorial(ctx, d, f);
  check(f.lineBusy && f.racing, 'sense: another line item and the race context are gates');
  (dragon.perch as { offer: unknown }).offer = { id: 'galata' };
  senseTutorial(ctx, d, f);
  check(f.perchBusy, 'sense: a perch prompt is a gate');
  delete services.dragon;
  senseTutorial(ctx, d, f);
  check(f.mode === null, 'sense: no dragon, no mode');
}

console.log(`tutorial-check: ${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  process.exit(1);
}
