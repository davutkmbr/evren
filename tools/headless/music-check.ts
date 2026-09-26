/**
 * Headless check of the adaptive music logic (src/audio/music): no browser, no WebAudio, a fake clock.
 *
 *   npx tsx tools/headless/music-check.ts
 *
 * 1. Manifest: a complete good example validates; each bad example fails with the expected issue (stem lengths
 *    differ, a duration off the grid, missing / bad licence fields, missing base stem, unknown role, bad paths, a
 *    missing file, duplicate ids, bad grid values, no approval date) and never takes a valid set down with it; the
 *    shipped public/audio/music/manifest.json validates (with the files checked on disk); the DEV test sets are valid
 *    and their notes fit their loops; decoded-length check, source picking, credit line.
 * 2. Bar grid: positions, bar / phrase boundaries with lookahead, loop offsets.
 * 3. Rules: state sequences → stem targets (grounded, perched, cruising, fast, dive, flow, low over water, thermal,
 *    night, storm, fog, race, moment with and without its own music, underwater, menu), hysteresis and hold times (no
 *    flicker on noisy input), state dwell, smoothing bounds, non-adaptive full mix.
 * 4. Director: the play / silence cycle over a simulated hour (window and gap lengths, endings on phrase boundaries,
 *    variety), waiting for decoding, perch breaking a silence, set changes by preference (min set time, phrase
 *    quantised), race countdown sync (the race set's downbeat on "Başla!") and stingers, a moment's own set on the
 *    next bar and back, moments without music holding, underwater holding, schedule shift after a pause.
 *
 * Exits non-zero on any failure.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { positionAt, nextBoundary, loopOffsetAt, gridBarSec, type BarGrid } from '../../src/audio/music/clock';
import { checkDecodedLengths, creditLine, loopSeconds, pickSource, validateManifest, type MusicSetDef, type StemRole } from '../../src/audio/music/manifest';
import { idleInput, MusicRulesEngine, applyRules, matchState, ConditionTracker, MUSIC_RULES, FULL_MIX, type MusicInput, type MusicTarget } from '../../src/audio/music/rules';
import { MusicDirector, DEFAULT_DIRECTOR, seededRandom, scoreSet, type DirectorCommand, type DirectorWorld } from '../../src/audio/music/director';
import { TEST_SETS, testScore } from '../../src/audio/music/test-sets';

let failures = 0;
let passes = 0;
function check(cond: boolean, what: string): void {
  if (cond) {
    passes++;
  } else {
    failures++;
    console.error(`FAIL ${what}`);
  }
}
const near = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) <= eps;
const section = (name: string): void => console.log(`\n# ${name}`);

/* ------------------------------------------------------------------ */
/* 1. Manifest                                                          */
/* ------------------------------------------------------------------ */
section('manifest');

// 84 bpm, 4/4, 16 bars = 45.714 s
const LOOP = loopSeconds({ bpm: 84, beatsPerBar: 4, bars: 16 });
const goodSet = (): Record<string, unknown> => ({
  id: 'bogaz-sabah',
  bpm: 84,
  beatsPerBar: 4,
  bars: 16,
  phraseBars: 4,
  key: 'D major',
  tags: ['day', 'flight', 'water'],
  stems: {
    base: { src: ['bogaz-sabah/base.opus', 'bogaz-sabah/base.m4a'], durationSec: LOOP },
    strings: { src: ['bogaz-sabah/strings.opus', 'bogaz-sabah/strings.m4a'], durationSec: LOOP, gain: 0.8 },
    motion: { src: ['bogaz-sabah/motion.opus'], durationSec: LOOP },
    colour: { src: ['bogaz-sabah/colour.opus'], durationSec: LOOP },
    air: { src: ['bogaz-sabah/air.opus'], durationSec: LOOP },
  },
  stingers: { intro: { src: ['bogaz-sabah/intro.opus'], bars: 1 }, finish: { src: ['bogaz-sabah/finish.opus'], bars: 2 } },
  credit: { title: 'Bosphorus Morning', author: 'Jane Doe', licence: 'CC-BY-4.0', sourceUrl: 'https://example.org/track/1', attribution: '“Bosphorus Morning” by Jane Doe' },
  approvedOn: '2026-10-01',
});
{
  const r = validateManifest({ version: 1, sets: [goodSet()] });
  check(r.ok && r.errors.length === 0 && r.manifest.sets.length === 1, `good manifest validates (${r.errors.map((e) => `${e.path}: ${e.message}`).join('; ')})`);
  check(r.warnings.length === 0, `good manifest has no warnings (${r.warnings.map((w) => w.message).join('; ')})`);
  const orig = goodSet();
  orig.credit = { title: 'Kıyı', author: 'Owner', licence: 'original' };
  check(validateManifest({ version: 1, sets: [orig] }).ok, "an 'original' licence needs no source URL / attribution");
}
type Mut = (s: Record<string, any>) => void;
const bad: Array<[string, Mut, RegExp]> = [
  ['stem lengths differ', (s) => (s.stems.air.durationSec = LOOP + 0.5), /does not match the grid|lengths differ/],
  ['stem lengths differ from each other (grid unknown to the stems)', (s) => ((s.stems.base.durationSec = LOOP), (s.stems.strings.durationSec = LOOP - 0.3)), /lengths differ|does not match/],
  ['duration off the grid', (s) => (s.bpm = 90), /does not match the grid/],
  ['missing credit', (s) => delete s.credit, /credit/],
  ['bad licence', (s) => (s.credit.licence = 'CC-BY-NC-4.0'), /licence must be one of/],
  ['CC-BY without attribution', (s) => delete s.credit.attribution, /attribution text is required/],
  ['CC0 without source URL', (s) => ((s.credit.licence = 'CC0-1.0'), delete s.credit.sourceUrl), /sourceUrl is required/],
  ['http source URL', (s) => (s.credit.sourceUrl = 'http://example.org'), /https/],
  ['missing base stem', (s) => delete s.stems.base, /base stem is required/],
  ['unknown stem role', (s) => (s.stems.vocals = { src: ['x/vocals.opus'] }), /unknown stem role/],
  ['absolute path', (s) => (s.stems.base.src = ['/audio/music/base.opus']), /relative path/],
  ['parent path', (s) => (s.stems.base.src = ['../secret/base.opus']), /relative path/],
  ['not audio', (s) => (s.stems.base.src = ['bogaz-sabah/base.txt']), /not an audio file/],
  ['empty src', (s) => (s.stems.base.src = []), /non-empty array/],
  ['unknown stinger', (s) => (s.stingers.drop = { src: ['x/drop.opus'] }), /unknown stinger/],
  ['bad bpm', (s) => (s.bpm = 500), /bpm/],
  ['bad meter', (s) => (s.beatsPerBar = 1.5), /beatsPerBar/],
  ['phrase does not divide bars', (s) => (s.phraseBars = 5), /phraseBars/],
  ['no key', (s) => delete s.key, /key/],
  ['bad id', (s) => (s.id = 'Boğaz Sabah'), /id must be/],
  ['no approval date', (s) => delete s.approvedOn, /approvedOn/],
  ['stem gain out of range', (s) => (s.stems.base.gain = 3), /gain/],
];
for (const [name, mut, expect] of bad) {
  const s = goodSet() as Record<string, any>;
  mut(s);
  const other = goodSet();
  other.id = 'other-set';
  const r = validateManifest({ version: 1, sets: [s, other] });
  const msgs = r.errors.map((e) => `${e.path}: ${e.message}`).join('; ');
  check(!r.ok && r.errors.some((e) => expect.test(e.message)), `bad manifest (${name}) fails: ${msgs || 'no errors'}`);
  check(r.manifest.sets.length === 1 && r.manifest.sets[0].id === 'other-set', `bad manifest (${name}) keeps the valid set only`);
}
{
  const dup = validateManifest({ version: 1, sets: [goodSet(), goodSet()] });
  check(!dup.ok && dup.errors.some((e) => /duplicate id/.test(e.message)) && dup.manifest.sets.length === 1, 'duplicate set id fails, the first stays');
  const missing = validateManifest({ version: 1, sets: [goodSet()] }, { exists: (p) => !p.endsWith('colour.opus') });
  check(!missing.ok && missing.errors.some((e) => /does not exist/.test(e.message) && e.path.includes('colour')), 'a missing file fails (exists callback)');
  check(!validateManifest(null).ok && !validateManifest({ version: 2, sets: [] }).ok && !validateManifest({ version: 1 }).ok, 'bad top level fails');
  check(validateManifest({ version: 1, sets: [] }).ok, 'an empty manifest is valid');
  const noDur = goodSet() as Record<string, any>;
  delete noDur.stems.air.durationSec;
  const w = validateManifest({ version: 1, sets: [noDur] });
  check(w.ok && w.warnings.some((x) => /no measured duration/.test(x.message)), 'a stem without a measured duration only warns');
  const tag = goodSet() as Record<string, any>;
  tag.tags = ['day', 'sparkly'];
  check(validateManifest({ version: 1, sets: [tag] }).warnings.some((x) => /unknown tag/.test(x.message)), 'an unknown tag only warns');
}
{
  // The shipped manifest (empty until the owner approves music) validates with the files checked on disk.
  const root = join(import.meta.dirname, '../../public/audio/music');
  const path = join(root, 'manifest.json');
  if (existsSync(path)) {
    const r = validateManifest(JSON.parse(readFileSync(path, 'utf8')), { exists: (p) => existsSync(join(root, p)) });
    check(r.ok, `public/audio/music/manifest.json validates (${r.errors.map((e) => `${e.path}: ${e.message}`).join('; ')})`);
    console.log(`  shipped manifest: ${r.manifest.sets.length} set(s)`);
  } else {
    console.log('  no public/audio/music/manifest.json (no music: fine)');
  }
}
{
  const r = validateManifest({ version: 1, sets: TEST_SETS });
  check(r.ok, `DEV test sets validate (${r.errors.map((e) => `${e.path}: ${e.message}`).join('; ')})`);
  for (const s of TEST_SETS) {
    const loop = loopSeconds(s);
    const score = testScore(s.id);
    const all = Object.values(score).flat();
    check(all.length > 0 && all.every((n) => n.t >= 0 && n.t < loop && n.dur > 0), `test set ${s.id}: every note starts inside its ${loop.toFixed(2)} s loop`);
    check(Object.keys(score).length === 5, `test set ${s.id}: five stems`);
  }
  const set = validateManifest({ version: 1, sets: [goodSet()] }).manifest.sets[0];
  const lens = (v: number): Partial<Record<StemRole, number>> => ({ base: v, strings: v, motion: v, colour: v, air: v });
  check(checkDecodedLengths(set, lens(LOOP)).length === 0, 'decoded lengths on the grid pass');
  check(checkDecodedLengths(set, lens(LOOP + 0.05)).length === 0, 'a short encoder tail passes');
  check(checkDecodedLengths(set, { ...lens(LOOP), motion: LOOP - 1 }).length === 1, 'a short stem is reported');
  check(pickSource(['a.opus', 'a.m4a'], (m) => m.includes('mp4')) === 'a.m4a', 'pickSource falls back to m4a');
  check(pickSource(['a.opus', 'a.m4a'], () => true) === 'a.opus', 'pickSource prefers the first');
  check(pickSource(['a.opus'], () => false) === null, 'pickSource: none playable');
  check(creditLine(set).includes('Jane Doe') && creditLine(set).includes('CC BY 4.0'), `credit line: ${creditLine(set)}`);
}

/* ------------------------------------------------------------------ */
/* 2. Bar grid                                                          */
/* ------------------------------------------------------------------ */
section('bar grid');
{
  const g: BarGrid = { anchor: 10, bpm: 120, beatsPerBar: 4, bars: 8 }; // bar = 2 s, loop 16 s
  check(near(gridBarSec(g), 2), 'bar length 2 s at 120 bpm 4/4');
  const p = positionAt(g, 10 + 2 * 3 + 1.2);
  check(p.bar === 3 && p.beat === 2, `position bar 3 beat 2 (${p.bar}, ${p.beat})`);
  check(positionAt(g, 10 + 16 * 2 + 0.1).bar === 0 && positionAt(g, 10 + 16 * 2 + 0.1).loop === 2, 'position wraps per loop');
  check(near(nextBoundary(g, 13.0, 1), 14), 'next bar after 13.0 → 14');
  check(near(nextBoundary(g, 13.97, 1), 16), 'next bar with lookahead after 13.97 → 16 (14 is too close)');
  check(near(nextBoundary(g, 14.0 - 0.05, 1, 0.05), 14), 'boundary exactly at lookahead');
  check(near(nextBoundary(g, 13.0, 4), 18), 'next phrase (4 bars) after 13 → 18');
  check(near(nextBoundary(g, 5, 4), 10), 'before the anchor → the anchor');
  check(near(loopOffsetAt(g, 10 + 16 * 3 + 5), 5), 'loop offset');
  const w: BarGrid = { anchor: 0, bpm: 66, beatsPerBar: 3, bars: 8 };
  const b = nextBoundary(w, 7.3, 4);
  check(near((b / (gridBarSec(w) * 4)) % 1, 0, 1e-9) && b > 7.3, '3/4 phrase boundary is a whole multiple of the phrase');
}

/* ------------------------------------------------------------------ */
/* 3. Rules                                                             */
/* ------------------------------------------------------------------ */
section('rules');
const inp = (over: Partial<MusicInput>): MusicInput => ({ ...idleInput(), mode: 'flying', airspeed: 32, agl: 200, ...over });
/** Runs the engine with a 30 fps fake clock for `sec` seconds. */
function runFor(e: MusicRulesEngine, clock: { t: number }, sec: number, input: MusicInput | ((t: number) => MusicInput)): MusicTarget {
  let last!: MusicTarget;
  const end = clock.t + sec;
  while (clock.t < end - 1e-9) {
    clock.t += 1 / 30;
    last = e.update(clock.t, typeof input === 'function' ? input(clock.t) : input);
  }
  return last;
}
{
  const e = new MusicRulesEngine();
  const c = { t: 0 };
  let t = runFor(e, c, 5, inp({ mode: 'grounded', airspeed: 0, agl: 0 }));
  check(t.state === 'grounded' && t.targetMix.base > 0.5 && t.targetMix.air > 0.5 && t.targetMix.strings === 0 && t.targetMix.motion === 0, `grounded: sparse base + air (${JSON.stringify(t.targetMix)})`);
  t = runFor(e, c, 5, inp({ mode: 'grounded', perched: true, airspeed: 0, agl: 0 }));
  check(t.state === 'perched' && t.policy === 'always' && t.prefer.includes('calm') && t.targetMix.motion === 0, 'perched: calm set preferred, gentle mix, music comes');
  t = runFor(e, c, 8, inp({}));
  check(t.state === 'cruising' && t.targetMix.base > 0.5 && t.targetMix.strings > 0.5 && t.targetMix.motion === 0, 'cruising: base + strings');
  check(Math.abs(t.mix.strings - t.targetMix.strings) < 0.1, 'cruising mix has settled after 8 s');
  t = runFor(e, c, 1.0, inp({ airspeed: 50 }));
  check(t.targetMix.motion === 0, 'fast: not before the 1.5 s hold');
  t = runFor(e, c, 1.0, inp({ airspeed: 50 }));
  check(t.modifiers.includes('fast') && t.targetMix.motion > 0.5, 'fast flight: + motion');
  check(t.mix.motion < t.targetMix.motion, 'motion rises smoothly (not a jump)');
  t = runFor(e, c, 1.5, inp({ airspeed: 40 }));
  check(t.modifiers.includes('fast'), 'fast stays on between the thresholds (hysteresis, 40 > 38)');
  t = runFor(e, c, 4, inp({ airspeed: 30 }));
  check(!t.modifiers.includes('fast'), 'fast turns off below 38 m/s after its hold');
  t = runFor(e, c, 3, inp({ mode: 'diving', airspeed: 45, climbRate: -25 }));
  check(t.modifiers.includes('dive') && t.targetMix.motion >= 0.9 && t.targetDuck > 0, 'dive: + motion, a slight duck (wind)');
  t = runFor(e, c, 4, inp({ flow: 0.8 }));
  check(t.modifiers.includes('high-flow') && t.targetMix.motion > 0.5, 'high flow: + motion');
  t = runFor(e, c, 5, inp({ agl: 20, overWater: true }));
  check(t.modifiers.includes('low-over-water') && t.targetMix.colour > 0.8 && t.prefer.includes('water'), 'low over water: + colour');
  t = runFor(e, c, 1, inp({ agl: 50, overWater: true }));
  check(t.modifiers.includes('low-over-water'), 'low over water holds up to 60 m (hysteresis)');
  t = runFor(e, c, 5, inp({ agl: 80, overWater: true }));
  check(!t.modifiers.includes('low-over-water'), 'low over water ends above 60 m');
  t = runFor(e, c, 4, inp({ climbRate: 3.5, flapEffort: 0.1, mode: 'gliding' }));
  check(t.modifiers.includes('thermal') && t.targetMix.air > 0.8, 'climbing in a thermal: air swell');
  t = runFor(e, c, 4, inp({ climbRate: 3.5, flapEffort: 0.9 }));
  check(!t.modifiers.includes('thermal'), 'climbing by flapping is not a thermal');
  const day = runFor(e, c, 6, inp({}));
  t = runFor(e, c, 6, inp({ night: 0.9 }));
  check(t.modifiers.includes('night') && t.targetMix.strings < day.targetMix.strings && t.prefer.includes('night') && t.avoid.includes('day'), 'night: strings softer, night sets preferred');
  check(day.prefer.includes('day') && day.avoid.includes('night'), 'day prefers day sets');
  t = runFor(e, c, 3, inp({ storm: 0.9, rain: 0.9 }));
  const sum = (m: Record<string, number>): number => Object.values(m).reduce((a, b) => a + b, 0);
  check(t.modifiers.includes('storm') && sum(t.targetMix) < sum(day.targetMix), 'storm: thinner mix');
  t = runFor(e, c, 8, inp({ fog: 0.9 }));
  check(t.modifiers.includes('fog') && !t.modifiers.includes('storm') && t.targetMix.air > day.targetMix.air, 'fog: more air (storm released after its 5 s hold)');
}
{
  const e = new MusicRulesEngine();
  const c = { t: 0 };
  runFor(e, c, 6, inp({}));
  let t = runFor(e, c, 1 / 30, inp({ race: 'countdown' }));
  check(t.state === 'race-countdown' && t.policy === 'race' && t.stateSince === c.t, 'race countdown switches at once');
  t = runFor(e, c, 3, inp({ race: 'running', airspeed: 30 }));
  check(t.state === 'race' && t.targetMix.motion === 1 && t.prefer[0] === 'race', 'race: motion forced, race set preferred');
  t = runFor(e, c, 1 / 30, inp({ race: 'none' }));
  check(t.state === 'cruising', 'race over: restored at once');
  t = runFor(e, c, 1 / 30, inp({ moment: true }));
  check(t.state === 'moment' && t.targetDuck >= 0.75 && t.policy === 'hold', 'moment: strong duck, holds (nothing new starts)');
  t = runFor(e, c, 3, inp({ moment: true }));
  check(t.duck > 0.7, `moment duck reaches ${t.duck.toFixed(2)} in 3 s`);
  t = runFor(e, c, 1 / 30, inp({ moment: true, momentMusic: 'poem-bed' }));
  check(t.state === 'moment-own-music' && t.policy === 'moment' && t.momentSet === 'poem-bed' && near(t.targetMix.base, 1) && t.targetDuck < 0.2, "moment with its own music: that set, full mix");
  t = runFor(e, c, 6, inp({}));
  check(t.state === 'cruising' && t.duck < 0.05, 'after the moment the duck is released');
  t = runFor(e, c, 1 / 30, inp({ underwater: 1, mode: 'underwater', airspeed: 45, flow: 0.9 }));
  check(t.state === 'underwater' && t.targetMix.base > 0 && t.targetMix.strings === 0 && t.targetMix.motion === 0 && t.policy === 'hold', 'underwater: base only (muffled by the bus), modifiers off');
  t = runFor(e, c, 3, inp({ menu: true }));
  check(t.modifiers.includes('menu') && near(t.targetDuck, 0.35) && t.state === 'cruising', 'menu: music continues, ducked a little');
  t = runFor(e, c, 1, inp({ menu: true, underwater: 1, mode: 'underwater' }));
  check(t.modifiers.includes('menu') && t.targetDuck > 0.3, 'menu duck applies under water too');
}
{
  // No flicker: speed jitters around the threshold; a one-second landing does not switch the state.
  const e = new MusicRulesEngine();
  const c = { t: 0 };
  runFor(e, c, 5, inp({}));
  let flips = 0;
  let prev = 0;
  let maxStep = 0;
  let prevMix = 0;
  const e2 = e;
  const c2 = c;
  for (let i = 0; i < 30 * 60; i++) {
    c2.t += 1 / 30;
    const s = 44 + 3 * Math.sin(c2.t * 5) + ((i * 7919) % 13) / 13 - 0.5; // 40.5..47.5, crossing both thresholds fast
    const tt = e2.update(c2.t, inp({ airspeed: s }));
    if (tt.targetMix.motion !== prev) {
      flips++;
      prev = tt.targetMix.motion;
    }
    maxStep = Math.max(maxStep, Math.abs(tt.mix.motion - prevMix));
    prevMix = tt.mix.motion;
  }
  check(flips <= 1, `noisy speed around the thresholds: motion target changes ${flips} time(s) in 60 s (≤ 1)`);
  check(maxStep < 0.02, `per-frame stem change stays small (${maxStep.toFixed(4)} < 0.02 at 30 fps)`);
  const e3 = new MusicRulesEngine();
  const c3 = { t: 0 };
  runFor(e3, c3, 5, inp({}));
  runFor(e3, c3, 1, inp({ mode: 'grounded', airspeed: 0, agl: 0 }));
  const t3 = runFor(e3, c3, 3, inp({}));
  check(t3.state === 'cruising', 'a 1 s touch-and-go does not switch to grounded');
  // A perch flag toggling every 0.6 s (e.g. a glitchy phase): the state must not chatter.
  const e4 = new MusicRulesEngine();
  const c4 = { t: 0 };
  runFor(e4, c4, 3, inp({}));
  let changes = 0;
  let last = '';
  for (let i = 0; i < 30 * 20; i++) {
    c4.t += 1 / 30;
    const st = e4.update(c4.t, inp({ perched: Math.floor(c4.t / 0.6) % 2 === 0 })).state;
    if (st !== last) {
      changes++;
      last = st;
    }
  }
  check(changes <= 2, `a flag toggling every 0.6 s changes the state ${changes} time(s) (≤ 2: dwell + minOff)`);
}
{
  // Non-adaptive: full mix whatever the flight; moment duck and underwater hold remain.
  const e = new MusicRulesEngine();
  e.adaptive = false;
  const c = { t: 0 };
  let t = runFor(e, c, 5, inp({ mode: 'grounded', airspeed: 0 }));
  check(Object.values(t.targetMix).every((v) => v === 1) && t.policy === 'normal' && t.prefer.length === 0, 'adaptive off: full mix, no preferences');
  t = runFor(e, c, 2, inp({ moment: true }));
  check(t.targetDuck >= 0.75 && t.policy === 'hold', 'adaptive off: a moment still ducks');
  // Rule table sanity: the last state matches always; every rule id unique.
  check(matchState(MUSIC_RULES, new Set()).id === 'cruising', 'the fallback state is cruising');
  check(new Set(MUSIC_RULES.map((r) => r.id)).size === MUSIC_RULES.length, 'rule ids are unique');
  const r = applyRules(MUSIC_RULES, matchState(MUSIC_RULES, new Set(['race', 'fast', 'night'])), new Set(['race', 'fast', 'night']));
  check(r.state.id === 'race' && r.modifiers.length === 0, 'race ignores flight modifiers (duck-only)');
  check(FULL_MIX.base === 1, 'full mix constant');
  const tr = new ConditionTracker();
  tr.update(0, inp({ airspeed: 50 }));
  tr.update(1.49, inp({ airspeed: 50 }));
  check(!tr.active.has('fast'), 'condition hold: not at 1.49 s');
  tr.update(1.5, inp({ airspeed: 50 }));
  check(tr.active.has('fast'), 'condition hold: on at 1.5 s');
}

/* ------------------------------------------------------------------ */
/* 4. Director                                                          */
/* ------------------------------------------------------------------ */
section('director');
const mkSet = (id: string, tags: string[], extra: Partial<MusicSetDef> = {}): MusicSetDef => ({
  id,
  bpm: 90,
  beatsPerBar: 4,
  bars: 16,
  phraseBars: 4,
  key: 'C',
  tags,
  stems: { base: { src: [`${id}/base.opus`] }, strings: { src: [`${id}/strings.opus`] }, motion: { src: [`${id}/motion.opus`] } },
  credit: { title: id, author: 'test', licence: 'original' },
  approvedOn: '2026-09-26',
  ...extra,
});
const SETS: MusicSetDef[] = [
  mkSet('day-a', ['day', 'flight']),
  mkSet('day-b', ['day', 'flight', 'water']),
  mkSet('night-a', ['night', 'calm', 'perch'], { bpm: 70, beatsPerBar: 3, bars: 8 }),
  mkSet('perch-day', ['day', 'calm', 'perch'], { bpm: 76 }),
  mkSet('race-a', ['race', 'flight'], { bpm: 120, stingers: { go: { src: ['race-a/go.opus'] }, finish: { src: ['race-a/finish.opus'], bars: 2 } } }),
  mkSet('poem-bed', ['moment'], { momentOnly: true, bpm: 60, bars: 8 }),
];

/** Fake player: loads take `loadDelay` s; records commands. */
class FakeWorld implements DirectorWorld {
  ready = new Set<string>();
  loads = new Map<string, number>();
  log: Array<DirectorCommand & { now: number }> = [];
  constructor(
    public sets: readonly MusicSetDef[],
    public loadDelay = 0.8,
  ) {}
  isReady(id: string): boolean {
    return this.ready.has(id);
  }
  step(now: number, cmds: DirectorCommand[]): void {
    for (const [id, at] of this.loads) {
      if (now >= at) {
        this.ready.add(id);
        this.loads.delete(id);
      }
    }
    for (const c of cmds) {
      this.log.push({ ...c, now });
      if (c.type === 'load' && !this.ready.has(c.setId) && !this.loads.has(c.setId)) {
        this.loads.set(c.setId, now + this.loadDelay);
      }
    }
  }
  starts(): Array<Extract<DirectorCommand, { type: 'start' }> & { now: number }> {
    return this.log.filter((c): c is Extract<DirectorCommand, { type: 'start' }> & { now: number } => c.type === 'start');
  }
  ends(): Array<Extract<DirectorCommand, { type: 'end' }> & { now: number }> {
    return this.log.filter((c): c is Extract<DirectorCommand, { type: 'end' }> & { now: number } => c.type === 'end');
  }
}

interface Sim {
  d: MusicDirector;
  e: MusicRulesEngine;
  w: FakeWorld;
  t: number;
}
function sim(seed = 7, sets = SETS, loadDelay = 0.8): Sim {
  return { d: new MusicDirector(DEFAULT_DIRECTOR, seededRandom(seed)), e: new MusicRulesEngine(), w: new FakeWorld(sets, loadDelay), t: 0 };
}
/** Advances at 10 Hz (the director only needs a coarse tick; the lookahead covers the frame). */
function advance(s: Sim, sec: number, input: MusicInput | ((t: number) => MusicInput), onTick?: (t: MusicTarget) => void): void {
  const end = s.t + sec;
  while (s.t < end - 1e-9) {
    s.t += 0.1;
    const target = s.e.update(s.t, typeof input === 'function' ? input(s.t) : input);
    s.w.step(s.t, s.d.tick(s.t, target, s.w));
    onTick?.(target);
  }
}
const onGrid = (at: number, grid: BarGrid, unitBars: number): boolean => {
  const u = gridBarSec(grid) * unitBars;
  const k = (at - grid.anchor) / u;
  return Math.abs(k - Math.round(k)) < 1e-6;
};
const setById = (id: string): MusicSetDef => SETS.find((x) => x.id === id)!;

{
  // Play / silence cycle over an hour of day cruising.
  const s = sim(11);
  const cruising = inp({});
  let playing = 0;
  let total = 0;
  let lastPhase = 'silent';
  let phaseSince = 0;
  const windows: number[] = [];
  const gaps: number[] = [];
  const phraseChecks: boolean[] = [];
  advance(s, 3600, cruising, () => {
    const v = s.d.view;
    total++;
    if (v.phase === 'playing') {
      playing++;
    }
    if (v.phase !== lastPhase) {
      (lastPhase === 'playing' ? windows : gaps).push(s.t - phaseSince);
      lastPhase = v.phase;
      phaseSince = s.t;
    }
  });
  const starts = s.w.starts();
  const ends = s.w.ends();
  check(starts.length >= 8 && starts.length <= 22, `an hour: ${starts.length} set starts`);
  const first = starts[0];
  check(first.at >= DEFAULT_DIRECTOR.firstSilenceMinSec && first.at <= DEFAULT_DIRECTOR.firstSilenceMaxSec + 2, `first set after the first silence (${first.at.toFixed(1)} s)`);
  const frac = playing / total;
  check(frac > 0.35 && frac < 0.8, `music plays ${(frac * 100).toFixed(0)} % of the time (not always on)`);
  const ws = windows.slice(0);
  const gs = gaps.slice(1); // the first gap is the short first silence
  check(ws.every((x) => x >= DEFAULT_DIRECTOR.playMinSec - 1 && x <= DEFAULT_DIRECTOR.playMaxSec + 25), `play windows ${ws.map((x) => x.toFixed(0)).join(', ')} s within 120..240 s (+ phrase + fade)`);
  check(gs.every((x) => x >= DEFAULT_DIRECTOR.silenceMinSec - 1 && x <= DEFAULT_DIRECTOR.silenceMaxSec + 1), `silences ${gs.map((x) => x.toFixed(0)).join(', ')} s within 60..180 s`);
  for (const en of ends) {
    const st = [...starts].reverse().find((x) => x.deck === en.deck)!;
    const set = setById(st.setId);
    const grid: BarGrid = { anchor: st.loopAt, bpm: set.bpm, beatsPerBar: set.beatsPerBar, bars: set.bars };
    phraseChecks.push(onGrid(en.at, grid, set.phraseBars ?? 4));
  }
  check(phraseChecks.length > 0 && phraseChecks.every(Boolean), `every ending starts on a phrase boundary (${phraseChecks.length})`);
  check(starts.every((x) => x.setId !== 'race-a' && x.setId !== 'night-a' && x.setId !== 'poem-bed' && x.setId !== 'perch-day'), 'day cruising picks only day flight sets (never race, night, perch or moment-only)');
  const consecutive = starts.slice(1).filter((x, i) => x.setId === starts[i].setId).length;
  check(consecutive <= starts.length / 3, `variety: ${consecutive} back-to-back repeats of ${starts.length}`);
  const loadsBeforeStart = starts.every((st) => s.w.log.some((c) => c.type === 'load' && c.setId === st.setId && c.now <= st.now));
  check(loadsBeforeStart, 'every set is loaded before it starts (decode on demand)');
  check(starts.every((st) => st.at >= st.now), 'starts are scheduled in the future');
}
{
  // Perch breaks a silence; the set changes to a calm one only via preference rules.
  const s = sim(3);
  advance(s, 1, inp({}));
  check(s.d.view.phase === 'silent', 'silent during the first silence');
  advance(s, 3.5, inp({ mode: 'grounded', perched: true, airspeed: 0, agl: 0 }));
  const st = s.w.starts();
  check(st.length === 1 && st[0].setId === 'perch-day', `perched by day: the calm day perch set starts (${st.map((x) => x.setId).join(',')})`);
  check(st.length === 1 && st[0].at - 1 <= DEFAULT_DIRECTOR.alwaysDelaySec + 1.2, `perched: music within ~3 s (${st[0]?.at.toFixed(2)} s)`);
}
{
  // Night falls while a day set plays: switch waits for minSetSec and lands on a phrase boundary.
  const s = sim(5);
  advance(s, 40, inp({}));
  const first = s.w.starts()[0];
  check(!!first && first.setId.startsWith('day'), 'a day set plays');
  advance(s, 10, inp({ night: 1 }));
  check(s.w.starts().length === 1, 'no switch before the minimum set time');
  advance(s, 60, inp({ night: 1 }));
  const sw = s.w.starts()[1];
  check(!!sw && sw.setId === 'night-a', `night: switched to the night set (${sw?.setId})`);
  if (sw) {
    const set = setById(first.setId);
    const grid: BarGrid = { anchor: first.loopAt, bpm: set.bpm, beatsPerBar: set.beatsPerBar, bars: set.bars };
    check(onGrid(sw.at, grid, 4), 'the switch lands on a phrase boundary of the old set');
    check(sw.at - first.at >= DEFAULT_DIRECTOR.minSetSec, 'after the minimum set time');
    const end = s.w.ends().find((x) => x.deck === first.deck)!;
    check(!!end && near(end.at, sw.at) && end.duration > 0, 'the old set fades out from the boundary (crossfade)');
  }
}
{
  // Race: countdown sync, stingers, back to normal.
  const s = sim(9);
  advance(s, 40, inp({}));
  const cd0 = s.t;
  advance(s, 0.1, inp({ race: 'countdown' }));
  const raceStartAt = cd0 + 0.1;
  advance(s, 1.4, inp({ race: 'countdown' }));
  const rs = s.w.starts().find((x) => x.setId === 'race-a');
  check(!!rs, 'race countdown: the race set is scheduled');
  if (rs) {
    check(near(rs.loopAt, raceStartAt + DEFAULT_DIRECTOR.raceCountdownSec, 0.11), `race set downbeat on "Başla!" (${rs.loopAt.toFixed(2)} vs ${(raceStartAt + 3).toFixed(2)})`);
    const end = s.w.ends().find((x) => x.deck !== rs.deck);
    check(!!end && end.at < rs.at && near(end.at + end.duration, rs.at, 0.05), 'the previous set fades out over the countdown');
  }
  advance(s, 1.6, inp({ race: 'countdown' }));
  const go = s.d.cue('go', s.t);
  check(go.length === 1 && go[0].type === 'stinger' && go[0].setId === 'race-a', 'go stinger on "Başla!"');
  advance(s, 300, inp({ race: 'running', airspeed: 40 }));
  check(s.d.view.phase === 'playing' && s.d.view.current?.set.id === 'race-a', 'a long race keeps its set (no silence gap)');
  const fin = s.d.cue('finish', s.t);
  check(fin.length === 1 && fin[0].type === 'stinger' && fin[0].kind === 'finish', 'finish stinger');
  check(s.d.cue('outro', s.t).length === 0, 'no stinger when the set has none');
  advance(s, 70, inp({}));
  const back = s.w.starts().at(-1)!;
  const endedOrSwitched = back.setId !== 'race-a' || s.d.view.phase === 'silent';
  check(endedOrSwitched, `after the race the music leaves the race set (${back.setId}, ${s.d.view.phase})`);
}
{
  // Race from silence starts music; the race set is chosen.
  const s = sim(4);
  advance(s, 2, inp({}));
  advance(s, 4, inp({ race: 'running' }));
  const st = s.w.starts();
  check(st.length === 1 && st[0].setId === 'race-a', 'a race during a silence starts the race set');
}
{
  // Moments.
  const s = sim(6);
  advance(s, 40, inp({}));
  const before = s.w.starts().length;
  advance(s, 10, inp({ moment: true }));
  check(s.w.starts().length === before && s.d.view.phase === 'playing', 'a moment without music: no switch, the set plays on (ducked by the rules)');
  advance(s, 0.1, inp({ moment: true, momentMusic: 'poem-bed' }));
  advance(s, 2, inp({ moment: true, momentMusic: 'poem-bed' }));
  const mb = s.w.starts().find((x) => x.setId === 'poem-bed');
  check(!!mb, "a moment with its own music: its set is scheduled");
  if (mb) {
    const prev = s.w.starts()[before - 1];
    const set = setById(prev.setId);
    const grid: BarGrid = { anchor: prev.loopAt, bpm: set.bpm, beatsPerBar: set.beatsPerBar, bars: set.bars };
    check(onGrid(mb.at, grid, 1), "the moment's set comes in on the next bar of the old set");
    check(mb.at - mb.now <= gridBarSec(grid) + 0.2, 'within one bar');
  }
  advance(s, 20, inp({ moment: true, momentMusic: 'poem-bed' }));
  check(s.d.view.current?.set.id === 'poem-bed', 'the moment set plays while the moment lasts');
  advance(s, 15, inp({}));
  check(s.d.view.current?.set.id !== 'poem-bed' || s.d.view.endAt !== null, 'the moment set does not outlive the moment');
  // A moment during silence without music stays silent.
  const q = sim(8);
  advance(q, 5, inp({ moment: true }));
  advance(q, 60, inp({ moment: true }));
  check(q.w.starts().length === 0, 'a moment without music during a silence keeps the silence');
  // Underwater holds.
  const u = sim(12);
  advance(u, 5, inp({}));
  advance(u, 60, inp({ mode: 'underwater', underwater: 1 }));
  check(u.w.starts().length === 0, 'under water nothing new starts');
}
{
  // Waiting for decoding: a slow load delays the start, nothing is scheduled in the past.
  const s = sim(13, SETS, 6);
  advance(s, 40, inp({}));
  const st = s.w.starts()[0];
  const ld = s.w.log.find((c) => c.type === 'load')!;
  check(!!st && st.now >= ld.now + 6 - 1e-6, `start waits for the 6 s decode (${st && (st.now - ld.now).toFixed(1)} s)`);
}
{
  // Shift after a hard pause: the grid and the plan move together.
  const s = sim(14);
  advance(s, 40, inp({}));
  const v0 = s.d.view;
  const a0 = v0.current!.grid.anchor;
  const p0 = v0.playUntil!;
  s.d.shift(12.5);
  check(near(s.d.view.current!.grid.anchor, a0 + 12.5) && near(s.d.view.playUntil!, p0 + 12.5), 'shift moves the grid anchor and the play window');
  // Scoring.
  check(scoreSet(setById('race-a'), ['race'], []) > scoreSet(setById('day-a'), ['race'], []), 'race tag scores higher for race');
  check(scoreSet(setById('night-a'), ['day'], ['night']) < 0, 'avoided tags score negative');
  // Forced set (debug) plays at once, even during a silence.
  const f = sim(15);
  f.d.forcedSet = 'night-a';
  advance(f, 2, inp({}));
  check(f.w.starts().length === 1 && f.w.starts()[0].setId === 'night-a', 'a forced set starts at once');
  // Empty manifest: nothing happens, no crash.
  const empty = sim(16, []);
  advance(empty, 600, inp({}));
  check(empty.w.log.length === 0 && empty.d.view.note === 'no music', 'no sets: no commands');
}

console.log(`\n${passes} passed, ${failures} failed`);
if (failures > 0) {
  process.exit(1);
}
