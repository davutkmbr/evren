/**
 * Headless check of sprinkle mode and moment music (src/audio/music/sprinkle.ts, moment-music.ts): no browser, no
 * WebAudio, a fake clock and a seeded RNG.
 *
 *   npx tsx tools/headless/music-sprinkle-check.ts
 *
 * 1. Manifest phrases: good sprinkle phrases and moment pieces validate; each bad example (missing licence / credit /
 *    approval, CC-BY without attribution, no family, bad duration, bad role, bad paths, missing file, duplicate or
 *    set-colliding id, bad gain / lufs) is rejected without taking a valid phrase down; advice only warns; the DEV test
 *    phrases and moment piece validate and keep a silent head and tail; loudness correction.
 * 2. Context: tags from the flight (day / night / dawn / dusk, water, perch, flight, calm, fog), holds (race, moment,
 *    photo, menu, under water) and busy flight (fast, dive, boost).
 * 3. Picking: time-of-day tags restrict, other tags weight (measured frequencies), adaptive off = plain rotation,
 *    no immediate repeat, no same family when another fits.
 * 4. Scheduler: gap distribution over simulated hours (default and without the long-calm shortening), the first gap,
 *    no repeats / no same-family repeats in a long run, holds with a gentle fade on interrupt and quiet afterwards,
 *    waiting for calm after sprints, dives and boosts, decode waits, determinism with a seeded RNG.
 * 5. Moment music: choice by musicId / category / mood / time, no repeat across moments, fades in and out, a short
 *    piece ends on its own (never looped), slow decodes dropped, back-to-back moments.
 * 6. Style: the automatic default, and the loop director ending its set in sparse style (endWindow).
 *
 * Exits non-zero on any failure.
 */
import { validateManifest, phraseGain, PHRASE_TARGET_LUFS, type MusicPhraseDef, type MusicSetDef } from '../../src/audio/music/manifest';
import { idleInput, MusicRulesEngine, type MusicInput } from '../../src/audio/music/rules';
import { seededRandom, MusicDirector, DEFAULT_DIRECTOR, type DirectorCommand } from '../../src/audio/music/director';
import {
  SprinkleDirector,
  SPRINKLE_DEFAULTS,
  sprinkleContext,
  pickPhrase,
  phraseFits,
  type SprinkleCommand,
  type SprinkleConfig,
  type SprinkleContext,
} from '../../src/audio/music/sprinkle';
import { MomentMusicDirector, MOMENT_MUSIC_DEFAULTS, chooseMomentPiece, scoreMomentPiece, type MomentMusicRequest } from '../../src/audio/music/moment-music';
import { effectiveMusicStyle } from '../../src/audio/music/settings';
import { TEST_PHRASES, TEST_MOMENT_PIECES, TEST_SETS, testPhraseNotes } from '../../src/audio/music/test-sets';

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
/* 1. Manifest phrases                                                  */
/* ------------------------------------------------------------------ */
section('manifest phrases');

const goodPhrase = (): Record<string, any> => ({
  id: 'ney-sabah-1',
  src: ['phrases/ney-sabah-1.opus', 'phrases/ney-sabah-1.m4a'],
  durationSec: 28.4,
  family: 'ney',
  tags: ['day', 'dawn', 'calm', 'water'],
  gain: 0.9,
  lufs: -20.5,
  credit: { title: 'Sabah nefesi', author: 'Owner', licence: 'original', sourceUrl: 'https://suno.com/song/abc' },
  approvedOn: '2026-10-01',
});
const goodPiece = (): Record<string, any> => ({
  id: 'an-istanbul-1',
  role: 'moment',
  src: ['moments/an-istanbul-1.opus', 'moments/an-istanbul-1.m4a'],
  durationSec: 74,
  family: 'ney',
  tags: ['poem', 'nostalgic', 'sea'],
  credit: { title: 'İstanbul akşamı', author: 'Jane Doe', licence: 'CC-BY-4.0', sourceUrl: 'https://example.org/p/1', attribution: '“İstanbul akşamı” by Jane Doe' },
  approvedOn: '2026-10-01',
});
{
  const r = validateManifest({ version: 1, sets: [], phrases: [goodPhrase(), goodPiece()] });
  check(r.ok && r.manifest.phrases!.length === 2, `good phrase + moment piece validate (${r.errors.map((e) => `${e.path}: ${e.message}`).join('; ')})`);
  check(r.warnings.length === 0, `no warnings for good phrases (${r.warnings.map((w) => `${w.path}: ${w.message}`).join('; ')})`);
  const noPhrases = validateManifest({ version: 1, sets: [] });
  check(noPhrases.ok && Array.isArray(noPhrases.manifest.phrases) && noPhrases.manifest.phrases.length === 0, 'a manifest without phrases validates with phrases: []');
  check(!validateManifest({ version: 1, sets: [], phrases: {} }).ok, 'phrases must be an array');
  const pieceNoFamily = goodPiece();
  delete pieceNoFamily.family;
  check(validateManifest({ version: 1, sets: [], phrases: [pieceNoFamily] }).ok, 'a moment piece may leave out the family');
}
type Mut = (p: Record<string, any>) => void;
const badPhrases: Array<[string, Mut, RegExp]> = [
  ['missing credit (licence)', (p) => delete p.credit, /credit/],
  ['missing licence field', (p) => delete p.credit.licence, /licence must be one of/],
  ['bad licence', (p) => (p.credit.licence = 'CC-BY-NC-4.0'), /licence must be one of/],
  ['CC-BY without attribution', (p) => ((p.credit.licence = 'CC-BY-4.0'), delete p.credit.attribution), /attribution text is required/],
  ['CC0 without source URL', (p) => ((p.credit.licence = 'CC0-1.0'), delete p.credit.sourceUrl), /sourceUrl is required/],
  ['http source URL', (p) => (p.credit.sourceUrl = 'http://example.org'), /https/],
  ['no approval date', (p) => delete p.approvedOn, /approvedOn/],
  ['bad approval date', (p) => (p.approvedOn = 'yesterday'), /approvedOn/],
  ['no author', (p) => delete p.credit.author, /author/],
  ['no family', (p) => delete p.family, /family/],
  ['bad family', (p) => (p.family = 'Ney Üflemeli'), /family/],
  ['no duration', (p) => delete p.durationSec, /durationSec/],
  ['duration too long', (p) => (p.durationSec = 300), /durationSec/],
  ['duration too short', (p) => (p.durationSec = 1), /durationSec/],
  ['bad role', (p) => (p.role = 'loop'), /role must be one of/],
  ['absolute path', (p) => (p.src = ['/audio/music/phrases/x.opus']), /relative path/],
  ['parent path', (p) => (p.src = ['../x.opus']), /relative path/],
  ['not audio', (p) => (p.src = ['phrases/x.txt']), /not an audio file/],
  ['empty src', (p) => (p.src = []), /non-empty array/],
  ['bad id', (p) => (p.id = 'Ney Sabah'), /id must be/],
  ['gain out of range', (p) => (p.gain = 5), /gain/],
  ['lufs out of range', (p) => (p.lufs = 3), /lufs/],
  ['tags not strings', (p) => (p.tags = ['day', 3]), /tags must be/],
];
for (const [name, mut, expect] of badPhrases) {
  const p = goodPhrase();
  mut(p);
  const other = goodPhrase();
  other.id = 'other-phrase';
  const r = validateManifest({ version: 1, sets: [], phrases: [p, other] });
  const msgs = r.errors.map((e) => `${e.path}: ${e.message}`).join('; ');
  check(!r.ok && r.errors.some((e) => expect.test(e.message) && e.path.startsWith('phrases[0]')), `bad phrase (${name}) is rejected: ${msgs || 'no errors'}`);
  check(r.manifest.phrases!.length === 1 && r.manifest.phrases![0].id === 'other-phrase', `bad phrase (${name}) keeps the valid phrase only`);
}
{
  const dup = validateManifest({ version: 1, sets: [], phrases: [goodPhrase(), goodPhrase()] });
  check(!dup.ok && dup.errors.some((e) => /duplicate phrase id/.test(e.message)) && dup.manifest.phrases!.length === 1, 'duplicate phrase id fails, the first stays');
  const clash = validateManifest({ version: 1, sets: [{ ...TEST_SETS[0], id: 'ney-sabah-1' }], phrases: [goodPhrase()] });
  check(!clash.ok && clash.errors.some((e) => /also a set id/.test(e.message)), 'a phrase id equal to a set id fails (musicId must be unambiguous)');
  const missing = validateManifest({ version: 1, sets: [], phrases: [goodPhrase()] }, { exists: (p) => !p.endsWith('.m4a') });
  check(!missing.ok && missing.errors.some((e) => /does not exist/.test(e.message)), 'a missing phrase file fails (exists callback)');
  const long = goodPhrase();
  long.durationSec = 60;
  const w = validateManifest({ version: 1, sets: [], phrases: [long] });
  check(w.ok && w.warnings.some((x) => /recommended/.test(x.message)), 'a 60 s sprinkle only warns (recommended 15..45 s)');
  const shortPiece = goodPiece();
  shortPiece.durationSec = 25;
  check(validateManifest({ version: 1, sets: [], phrases: [shortPiece] }).warnings.some((x) => /recommended 40\.\.120/.test(x.message)), 'a 25 s moment piece only warns (recommended 40..120 s)');
  const raceTag = goodPhrase();
  raceTag.tags = ['race'];
  check(validateManifest({ version: 1, sets: [], phrases: [raceTag] }).warnings.some((x) => /never play during races/.test(x.message)), 'a race-tagged sprinkle warns');
  const unknown = goodPhrase();
  unknown.tags = ['day', 'sparkly'];
  check(validateManifest({ version: 1, sets: [], phrases: [unknown] }).warnings.some((x) => /unknown tag/.test(x.message)), 'an unknown tag only warns');
  const bothBad = validateManifest({ version: 1, sets: [{ ...TEST_SETS[0], credit: undefined }], phrases: [goodPhrase()] });
  check(!bothBad.ok && bothBad.manifest.sets.length === 0 && bothBad.manifest.phrases!.length === 1, 'a bad set does not take a valid phrase down');
}
{
  const r = validateManifest({ version: 1, sets: TEST_SETS, phrases: [...TEST_PHRASES, ...TEST_MOMENT_PIECES] });
  check(r.ok, `DEV test phrases and moment piece validate (${r.errors.map((e) => `${e.path}: ${e.message}`).join('; ')})`);
  for (const p of [...TEST_PHRASES, ...TEST_MOMENT_PIECES]) {
    const notes = testPhraseNotes(p.id);
    const first = Math.min(...notes.map((n) => n.t));
    const last = Math.max(...notes.map((n) => n.t + n.dur));
    check(notes.length > 0 && first >= 0.5 && last <= p.durationSec - 2.5, `test ${p.role ?? 'sprinkle'} ${p.id}: silent head ${first.toFixed(1)} s, notes end ${(p.durationSec - last).toFixed(1)} s before the end`);
  }
  check(new Set(TEST_PHRASES.map((p) => p.family)).size >= 3, 'test phrases cover at least three families');
  check(TEST_PHRASES.some((p) => p.tags.includes('night')) && TEST_PHRASES.some((p) => p.tags.includes('day')), 'test phrases cover day and night');
  check(TEST_MOMENT_PIECES.every((p) => p.role === 'moment') && TEST_MOMENT_PIECES.some((p) => p.tags.includes('poem')), 'a test moment piece for poems exists');
  check(
    TEST_MOMENT_PIECES.some((p) => p.tags.includes('legend')) && TEST_MOMENT_PIECES.some((p) => p.tags.includes('city-life')),
    'test moment pieces for legends and city life exist (every source kind is audible with ?music=test)',
  );
  check(near(phraseGain({ lufs: PHRASE_TARGET_LUFS - 6 }), Math.pow(10, 6 / 20)), 'a phrase 6 dB under the target is lifted 6 dB');
  check(near(phraseGain({ lufs: PHRASE_TARGET_LUFS + 30, gain: 0.5 }), 0.5 * Math.pow(10, -12 / 20)), 'the loudness correction is clamped to 12 dB and the trim applies');
  check(phraseGain({}) === 1, 'no lufs, no gain: unity');
}

/* ------------------------------------------------------------------ */
/* 2. Context                                                           */
/* ------------------------------------------------------------------ */
section('context');

const inp = (over: Partial<MusicInput>): MusicInput => ({ ...idleInput(), mode: 'gliding', airspeed: 24, agl: 200, hour: 12, ...over });
/** Settles the rules' debounced conditions for `input` and returns the sprinkle context. */
function ctxOf(input: MusicInput, adaptive = true): SprinkleContext {
  const e = new MusicRulesEngine();
  let t: ReturnType<MusicRulesEngine['update']> | null = null;
  for (let i = 0; i < 100; i++) {
    t = e.update(i * 0.1, input);
  }
  return sprinkleContext(input, t!.conditions, adaptive);
}
{
  const day = ctxOf(inp({}));
  check(day.tags.has('day') && day.tags.has('flight') && day.tags.has('calm') && !day.tags.has('night') && day.hold === null && day.busy === null, `slow day glide: day, flight, calm (${[...day.tags].join(' ')})`);
  const night = ctxOf(inp({ night: 0.9, hour: 23 }));
  check(night.tags.has('night') && !night.tags.has('day'), 'night');
  check(ctxOf(inp({ hour: 6.5 })).tags.has('dawn') && ctxOf(inp({ hour: 19 })).tags.has('dusk'), 'dawn and dusk from the hour');
  check(ctxOf(inp({ overWater: true, agl: 20 })).tags.has('water'), 'over the water: water');
  const perch = ctxOf(inp({ mode: 'grounded', perched: true, airspeed: 0, agl: 0 }));
  check(perch.tags.has('perch') && perch.tags.has('calm') && !perch.tags.has('flight'), 'perched: perch, calm, not flight');
  check(ctxOf(inp({ fog: 0.9 })).tags.has('fog'), 'fog');
  check(!ctxOf(inp({ airspeed: 34, mode: 'flying' })).tags.has('calm'), 'cruise speed is not calm');
  const holds: Array<[Partial<MusicInput>, string]> = [
    [{ race: 'countdown' }, 'race'],
    [{ race: 'running' }, 'race'],
    [{ race: 'result' }, 'race'],
    [{ moment: true }, 'moment'],
    [{ photo: true, menu: true }, 'photo'],
    [{ menu: true }, 'menu'],
    [{ underwater: 1, mode: 'underwater' }, 'underwater'],
  ];
  for (const [over, want] of holds) {
    check(ctxOf(inp(over)).hold === want, `hold: ${JSON.stringify(over)} → ${want}`);
  }
  check(ctxOf(inp({ airspeed: 50, mode: 'flying' })).busy === 'fast', 'sprint: busy (fast)');
  check(ctxOf(inp({ mode: 'diving', airspeed: 45, climbRate: -25 })).busy === 'dive', 'dive: busy (dive)');
  check(ctxOf(inp({ burst: 0.6 })).busy === 'boost', 'flow burst: busy (boost)');
}

/* ------------------------------------------------------------------ */
/* 3. Picking                                                           */
/* ------------------------------------------------------------------ */
section('picking');

const ph = (id: string, family: string, tags: string[], durationSec = 24): MusicPhraseDef => ({
  id,
  src: [`phrases/${id}.opus`],
  durationSec,
  family,
  tags,
  credit: { title: id, author: 'test', licence: 'original' },
  approvedOn: '2026-09-26',
});
const PHRASES: MusicPhraseDef[] = [
  ph('kanun-gunduz', 'kanun', ['day', 'flight']),
  ph('ney-su', 'ney', ['water']),
  ph('tanbur-gece', 'tanbur', ['night', 'calm']),
  ph('ud-tepe', 'oud', ['perch']),
  ph('ney-sabah', 'ney', ['day', 'dawn', 'calm']),
  ph('kanun-su', 'kanun', ['day', 'water']),
  ph('ney-gece', 'ney', ['night', 'fog']),
];
const mkCtx = (tags: string[], adaptive = true): SprinkleContext => ({ tags: new Set(tags), hold: null, busy: null, adaptive });
{
  const night = mkCtx(['night', 'calm']);
  check(!phraseFits(PHRASES[0], night) && phraseFits(PHRASES[1], night) && phraseFits(PHRASES[2], night), 'time tags restrict (a day phrase never fits the night); untimed phrases fit');
  const rnd = seededRandom(1);
  const pool = [PHRASES[0], PHRASES[1], PHRASES[2], PHRASES[3]];
  const counts = new Map<string, number>();
  const N = 6000;
  for (let i = 0; i < N; i++) {
    const p = pickPhrase(pool, mkCtx(['day', 'water', 'flight']), { id: null, family: null }, rnd).phrase!;
    counts.set(p.id, (counts.get(p.id) ?? 0) + 1);
  }
  // weights: kanun-gunduz 1 + 2×2 = 5, ney-su 1 + 2 = 3, ud-tepe 1, tanbur-gece excluded (night)
  const f = (id: string): number => (counts.get(id) ?? 0) / N;
  check(!counts.has('tanbur-gece'), 'by day the night phrase is never picked');
  check(Math.abs(f('kanun-gunduz') - 5 / 9) < 0.03 && Math.abs(f('ney-su') - 3 / 9) < 0.03 && Math.abs(f('ud-tepe') - 1 / 9) < 0.03, `weighted by tag match: ${[...counts].map(([k, v]) => `${k} ${(v / N).toFixed(2)}`).join(', ')} (expect .56 .33 .11)`);
  const flat = new Map<string, number>();
  for (let i = 0; i < N; i++) {
    const p = pickPhrase(pool, mkCtx(['day', 'water'], false), { id: null, family: null }, rnd).phrase!;
    flat.set(p.id, (flat.get(p.id) ?? 0) + 1);
  }
  check(flat.size === 4 && [...flat.values()].every((v) => Math.abs(v / N - 0.25) < 0.03), 'adaptive off: plain rotation over every phrase');
  let repeats = 0;
  let famRepeats = 0;
  let last: MusicPhraseDef | null = null;
  for (let i = 0; i < 2000; i++) {
    const p = pickPhrase(PHRASES, mkCtx(['day', 'water', 'calm']), { id: last?.id ?? null, family: last?.family ?? null }, rnd).phrase!;
    repeats += p.id === last?.id ? 1 : 0;
    famRepeats += p.family === last?.family ? 1 : 0;
    last = p;
  }
  check(repeats === 0 && famRepeats === 0, `2000 picks: ${repeats} phrase repeats, ${famRepeats} family repeats`);
  const oneFamily = [ph('ney-a', 'ney', ['day']), ph('ney-b', 'ney', ['day'])];
  const p1 = pickPhrase(oneFamily, mkCtx(['day']), { id: 'ney-a', family: 'ney' }, rnd);
  check(p1.phrase?.id === 'ney-b', 'only one family fits: the family may repeat, the phrase may not');
  const onlyLast = pickPhrase([ph('ney-a', 'ney', ['day']), ph('tanbur-n', 'tanbur', ['night'])], mkCtx(['day']), { id: 'ney-a', family: 'ney' }, rnd);
  check(onlyLast.phrase === null && /only the last/.test(onlyLast.why), 'only the last phrase fits: nothing (retry later)');
  const single = pickPhrase([ph('ney-a', 'ney', ['day'])], mkCtx(['day']), { id: 'ney-a', family: 'ney' }, rnd);
  check(single.phrase?.id === 'ney-a', 'a single-phrase manifest may repeat its phrase');
  check(pickPhrase([], mkCtx(['day']), { id: null, family: null }, rnd).why === 'no phrases', 'no phrases: nothing');
}

/* ------------------------------------------------------------------ */
/* 4. Scheduler                                                         */
/* ------------------------------------------------------------------ */
section('scheduler');

class FakePhraseWorld {
  ready = new Set<string>();
  loads = new Map<string, number>();
  log: Array<SprinkleCommand & { now: number }> = [];
  constructor(
    public phrases: readonly MusicPhraseDef[],
    public loadDelay = 0.8,
  ) {}
  isReady(id: string): boolean {
    return this.ready.has(id);
  }
  step(now: number, cmds: SprinkleCommand[]): void {
    for (const [id, at] of this.loads) {
      if (now >= at) {
        this.ready.add(id);
        this.loads.delete(id);
      }
    }
    for (const c of cmds) {
      this.log.push({ ...c, now });
      if (c.type === 'load' && !this.ready.has(c.phraseId) && !this.loads.has(c.phraseId)) {
        this.loads.set(c.phraseId, now + this.loadDelay);
      }
    }
  }
  plays(): Array<Extract<SprinkleCommand, { type: 'play' }> & { now: number }> {
    return this.log.filter((c): c is Extract<SprinkleCommand, { type: 'play' }> & { now: number } => c.type === 'play');
  }
  stops(): Array<Extract<SprinkleCommand, { type: 'stop' }> & { now: number }> {
    return this.log.filter((c): c is Extract<SprinkleCommand, { type: 'stop' }> & { now: number } => c.type === 'stop');
  }
}
interface Sim {
  d: SprinkleDirector;
  e: MusicRulesEngine;
  w: FakePhraseWorld;
  t: number;
  adaptive: boolean;
}
function sim(seed = 7, phrases: readonly MusicPhraseDef[] = PHRASES, cfg: SprinkleConfig = SPRINKLE_DEFAULTS, loadDelay = 0.8): Sim {
  return { d: new SprinkleDirector(cfg, seededRandom(seed)), e: new MusicRulesEngine(), w: new FakePhraseWorld(phrases, loadDelay), t: 0, adaptive: true };
}
function advance(s: Sim, sec: number, input: MusicInput | ((t: number) => MusicInput)): void {
  const end = s.t + sec;
  while (s.t < end - 1e-9) {
    s.t += 0.1;
    const i = typeof input === 'function' ? input(s.t) : input;
    const target = s.e.update(s.t, i);
    s.w.step(s.t, s.d.tick(s.t, sprinkleContext(i, target.conditions, s.adaptive), s.w));
  }
}
const phraseById = (id: string): MusicPhraseDef => PHRASES.find((p) => p.id === id)!;
function gapsOf(w: FakePhraseWorld): number[] {
  const plays = w.plays();
  return plays.slice(1).map((p, i) => p.at - (plays[i].at + plays[i].duration));
}
const calmDay = inp({ overWater: true, agl: 80 });
{
  // Gap distribution without the long-calm shortening.
  const noLong: SprinkleConfig = { ...SPRINKLE_DEFAULTS, longCalmSec: Infinity };
  const s = sim(21, PHRASES, noLong);
  advance(s, 6 * 3600, calmDay);
  const plays = s.w.plays();
  const gaps = gapsOf(s.w);
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  check(plays.length >= 80 && plays.length <= 135, `six calm hours: ${plays.length} phrases`);
  check(plays[0].at >= SPRINKLE_DEFAULTS.firstGapMinSec && plays[0].at <= SPRINKLE_DEFAULTS.firstGapMaxSec + 0.3, `first phrase after ${plays[0].at.toFixed(1)} s (25..70)`);
  check(gaps.every((g) => g >= noLong.gapMinSec - 0.01 && g <= noLong.gapMaxSec + 0.3), `gaps within 90..240 s (min ${Math.min(...gaps).toFixed(1)}, max ${Math.max(...gaps).toFixed(1)})`);
  check(Math.abs(mean - 165) < 15, `mean gap ${mean.toFixed(1)} s (uniform 90..240 → 165)`);
  const lowQ = gaps.filter((g) => g < 127.5).length / gaps.length;
  const highQ = gaps.filter((g) => g > 202.5).length / gaps.length;
  check(lowQ > 0.12 && lowQ < 0.4 && highQ > 0.12 && highQ < 0.4, `gaps spread over the range (lowest quarter ${(lowQ * 100).toFixed(0)} %, highest ${(highQ * 100).toFixed(0)} %)`);
  const music = plays.reduce((a, p) => a + p.duration, 0) / (6 * 3600);
  check(music > 0.05 && music < 0.25, `music sounds ${(music * 100).toFixed(0)} % of the time (mostly silence)`);
  let rep = 0;
  let fam = 0;
  for (let i = 1; i < plays.length; i++) {
    rep += plays[i].phraseId === plays[i - 1].phraseId ? 1 : 0;
    fam += phraseById(plays[i].phraseId).family === phraseById(plays[i - 1].phraseId).family ? 1 : 0;
  }
  check(rep === 0, `no immediate phrase repeat in ${plays.length} phrases`);
  check(fam === 0, `no same family twice in a row in ${plays.length} phrases`);
  check(plays.every((p) => phraseFits(phraseById(p.phraseId), mkCtx(['day']))), 'by day only phrases that fit the day');
  check(plays.every((p) => p.fadeIn > 0 && p.fadeOut > 0 && near(p.duration, phraseById(p.phraseId).durationSec)), 'every phrase fades in and out and plays its full length');
  check(plays.every((p) => s.w.log.some((c) => c.type === 'load' && c.phraseId === p.phraseId && c.now <= p.now)), 'every phrase is decoded before it plays');
  check(plays.every((p) => p.at >= p.now), 'plays are scheduled in the future');
  const water = plays.filter((p) => phraseById(p.phraseId).tags.includes('water')).length / plays.length;
  check(water > 0.4, `over the water, water phrases dominate (${(water * 100).toFixed(0)} %)`);
}
{
  // Default config: a long calm stretch shortens the gap (never below the floor).
  const s = sim(22);
  advance(s, 3 * 3600, calmDay);
  const gaps = gapsOf(s.w);
  const c = SPRINKLE_DEFAULTS;
  check(gaps.every((g) => g >= c.gapFloorSec - 0.01 && g <= c.gapMaxSec * c.longCalmGapScale + 0.3), `long calm: gaps ${Math.min(...gaps).toFixed(0)}..${Math.max(...gaps).toFixed(0)} s (60..144)`);
  // Interrupting calm with sprints keeps the long gaps.
  const b = sim(22, PHRASES, SPRINKLE_DEFAULTS);
  advance(b, 3 * 3600, (t) => (t % 100 < 8 ? inp({ airspeed: 50, mode: 'flying' }) : calmDay));
  const bg = gapsOf(b.w);
  check(bg.some((g) => g > c.gapMaxSec * c.longCalmGapScale + 1), 'with a sprint every 100 s the gap is not shortened');
}
{
  // Determinism.
  const a = sim(33);
  const b = sim(33);
  const c = sim(34);
  advance(a, 3600, calmDay);
  advance(b, 3600, calmDay);
  advance(c, 3600, calmDay);
  const key = (w: FakePhraseWorld): string => w.plays().map((p) => `${p.phraseId}@${p.at.toFixed(3)}`).join(',');
  check(key(a.w) === key(b.w) && key(a.w).length > 0, 'the same seed replays the same session');
  check(key(a.w) !== key(c.w), 'another seed gives another session');
}
{
  // Holds: a phrase playing when a hold begins fades out; nothing plays during the hold; quiet after it.
  const holds: Array<[string, Partial<MusicInput>]> = [
    ['race', { race: 'countdown' }],
    ['moment', { moment: true }],
    ['photo', { photo: true, menu: true }],
    ['menu', { menu: true }],
    ['underwater', { underwater: 1, mode: 'underwater' }],
  ];
  for (const [name, over] of holds) {
    const s = sim(40);
    advance(s, 5, calmDay);
    s.d.dueIn(s.t, 0);
    advance(s, 3, calmDay);
    const playing = s.d.view;
    check(playing.phase === 'playing' && s.w.plays().length === 1, `${name}: a phrase plays before the hold`);
    const t0 = s.t;
    advance(s, 0.1, inp(over));
    const stop = s.w.stops()[0];
    check(!!stop && stop.voice === s.w.plays()[0].voice && near(stop.at, t0 + 0.1, 0.11) && stop.fade >= 1.5, `${name}: the phrase fades out gently at once (fade ${stop?.fade} s)`);
    check(s.d.view.hold === name && s.d.view.phase === 'waiting', `${name}: the director holds (${s.d.view.hold})`);
    advance(s, 600, inp(over));
    check(s.w.plays().length === 1, `${name}: nothing plays during a 10 min hold`);
    const end = s.t;
    s.d.dueIn(s.t - SPRINKLE_DEFAULTS.afterHoldSec - 1, 0); // due long ago; only the hold keeps it back
    advance(s, 0.1, inp(over));
    advance(s, 200, calmDay);
    const next = s.w.plays()[1];
    check(!!next && next.at - end >= SPRINKLE_DEFAULTS.afterHoldSec - 0.2, `${name}: the next phrase waits ${next ? (next.at - end).toFixed(1) : '—'} s after the hold (≥ 20 s)`);
  }
  // A hold that begins while waiting only delays.
  const q = sim(41);
  advance(q, 20, calmDay);
  advance(q, 120, inp({ race: 'running' }));
  check(q.w.plays().length === 0 && q.w.stops().length === 0, 'a race during the first gap: nothing plays, nothing to stop');
}
{
  // Waiting for calm: sprints, dives and boosts block a due phrase; the calm must settle first.
  const cases: Array<[string, Partial<MusicInput>, number]> = [
    ['fast', { airspeed: 50, mode: 'flying' }, 3],
    ['dive', { mode: 'diving', airspeed: 45, climbRate: -25 }, 2.5],
    ['boost', { burst: 0.7, airspeed: 34, mode: 'flying' }, 0],
  ];
  for (const [name, over, minOff] of cases) {
    const s = sim(50);
    advance(s, 3, calmDay);
    advance(s, 5, inp(over));
    s.d.dueIn(s.t, 0);
    advance(s, 60, inp(over));
    check(s.w.plays().length === 0 && s.d.view.busy === name && /calm/.test(s.d.view.note), `${name}: a due phrase waits (${s.d.view.note})`);
    const calmFrom = s.t;
    advance(s, 40, calmDay);
    const p = s.w.plays()[0];
    const wait = p ? p.at - calmFrom : NaN;
    check(!!p && wait >= SPRINKLE_DEFAULTS.calmSettleSec + minOff - 0.3 && wait <= SPRINKLE_DEFAULTS.calmSettleSec + minOff + 1, `${name}: plays ${wait.toFixed(1)} s after the calm returns (condition release + ${SPRINKLE_DEFAULTS.calmSettleSec} s settle)`);
  }
  // A sprint during a playing phrase does not cut it.
  const s = sim(51);
  advance(s, 3, calmDay);
  s.d.dueIn(s.t, 0);
  advance(s, 2, calmDay);
  advance(s, 10, inp({ airspeed: 50, mode: 'flying' }));
  check(s.w.plays().length === 1 && s.w.stops().length === 0, 'a sprint does not cut a playing phrase');
}
{
  // Decoding: a slow decode delays the phrase; preloading hides a normal one.
  const slow = sim(60, PHRASES, SPRINKLE_DEFAULTS, 15);
  advance(slow, 200, calmDay);
  const first = slow.w.plays()[0];
  const load = slow.w.log.find((c) => c.type === 'load')!;
  check(!!first && first.now >= load.now + 15 - 1e-6, `a 15 s decode delays the phrase (${first ? (first.now - load.now).toFixed(1) : '—'} s after the load)`);
  const fast = sim(61);
  advance(fast, 200, calmDay);
  const fl = fast.w.log.find((c) => c.type === 'load')!;
  const fp = fast.w.plays()[0];
  check(!!fp && fp.now - fl.now >= SPRINKLE_DEFAULTS.preloadSec - 0.2, 'the phrase is decoded ahead of time (preload)');
  // No phrases: no commands.
  const none = sim(62, []);
  advance(none, 600, calmDay);
  check(none.w.log.length === 0 && none.d.view.note === 'no phrases', 'no phrases: no commands');
  // Only night phrases by day: nothing plays, it retries.
  const nightOnly = sim(63, [PHRASES[2], PHRASES[6]]);
  advance(nightOnly, 600, calmDay);
  check(nightOnly.w.plays().length === 0 && /fits/.test(nightOnly.d.view.note), `nothing fits: silence (${nightOnly.d.view.note})`);
  advance(nightOnly, 600, inp({ night: 1, hour: 23 }));
  check(nightOnly.w.plays().length >= 2, 'at night the night phrases play');
  // A forced phrase (debug) plays whatever the context.
  const forced = sim(64);
  advance(forced, 3, calmDay);
  forced.d.dueIn(forced.t, 0, PHRASES[2]);
  advance(forced, 3, calmDay);
  check(forced.w.plays()[0]?.phraseId === 'tanbur-gece', 'a phrase asked for by name plays at once, even out of context');
  // Stop (style switch) fades a playing phrase.
  const st = forced.d.stopNow(forced.t);
  check(st.length === 1 && st[0].type === 'stop', 'stopNow fades the playing phrase');
  // Shift after a hard pause.
  const sh = sim(65);
  advance(sh, 10, calmDay);
  const due0 = sh.d.view.dueAt;
  sh.d.shift(12);
  check(near(sh.d.view.dueAt, due0 + 12), 'shift moves the gap');
}

/* ------------------------------------------------------------------ */
/* 5. Moment music                                                      */
/* ------------------------------------------------------------------ */
section('moment music');

const piece = (id: string, tags: string[], durationSec = 60): MusicPhraseDef => ({ ...ph(id, 'ney', tags, durationSec), role: 'moment', src: [`moments/${id}.opus`] });
const PIECES: MusicPhraseDef[] = [
  piece('an-siir-deniz', ['poem', 'nostalgic', 'sea']),
  piece('an-siir-gece', ['poem', 'night', 'tender']),
  piece('an-tarih', ['history', 'legend', 'solemn']),
  piece('an-sehir', ['city-life', 'joyful']),
  piece('an-kisa', ['poem', 'sea'], 20),
];
const req = (over: Partial<MomentMusicRequest>): MomentMusicRequest => ({ active: true, seq: 1, musicId: null, category: 'poem', mood: [], time: ['day'], ...over });
{
  const rnd = seededRandom(3);
  const all = [...PIECES, ...PHRASES];
  check(chooseMomentPiece(all, req({ musicId: 'an-tarih' }), null, rnd).piece?.id === 'an-tarih', 'musicId names the piece (whatever the category)');
  check(chooseMomentPiece(all, req({ musicId: 'an-tarih' }), 'an-tarih', rnd).piece?.id === 'an-tarih', 'a named piece may repeat');
  check(chooseMomentPiece(all, req({ musicId: 'kanun-gunduz' }), null, rnd).piece?.role === 'moment', 'a sprinkle id is not a moment piece (falls back to the choice)');
  const poemSea = chooseMomentPiece(all, req({ mood: ['nostalgic', 'sea'] }), null, rnd).piece;
  check(poemSea?.id === 'an-siir-deniz', `poem + nostalgic sea → an-siir-deniz (${poemSea?.id})`);
  const legend = chooseMomentPiece(all, req({ category: 'legend', mood: ['history'] }), null, rnd).piece;
  check(legend?.id === 'an-tarih', 'legend + history → an-tarih');
  const nightPoem = chooseMomentPiece(all, req({ time: ['night'] }), null, rnd).piece;
  check(nightPoem?.id === 'an-siir-gece', `a poem at night → the night poem piece (${nightPoem?.id})`);
  check(scoreMomentPiece(PIECES[1], req({ time: ['day'] })) < scoreMomentPiece(PIECES[1], req({ time: ['night'] })), 'a night piece scores lower by day');
  check(chooseMomentPiece(all, req({ category: 'city-life', mood: ['nostalgic'] }), null, rnd).piece !== null, 'a matching mood alone is enough');
  const none = chooseMomentPiece([PIECES[3]], req({ category: 'poem', mood: ['solemn'] }), null, rnd);
  check(none.piece === null && /no piece matches/.test(none.why), 'no category / mood match: no piece (the moment keeps the plain duck)');
  const noRep = chooseMomentPiece(all, req({ mood: ['nostalgic', 'sea'] }), 'an-siir-deniz', rnd).piece;
  check(!!noRep && noRep.id !== 'an-siir-deniz', `no repeat: the next best piece (${noRep?.id})`);
  check(chooseMomentPiece(PHRASES, req({}), null, rnd).why === 'no moment pieces', 'no moment pieces: nothing');
}
class FakeMomentWorld extends FakePhraseWorld {}
function momentSim(seed = 5, loadDelay = 0.8): { d: MomentMusicDirector; w: FakeMomentWorld; t: number } {
  return { d: new MomentMusicDirector(MOMENT_MUSIC_DEFAULTS, seededRandom(seed)), w: new FakeMomentWorld(PIECES, loadDelay), t: 0 };
}
function mAdvance(s: { d: MomentMusicDirector; w: FakeMomentWorld; t: number }, sec: number, r: MomentMusicRequest): void {
  const end = s.t + sec;
  while (s.t < end - 1e-9) {
    s.t += 0.1;
    s.w.step(s.t, s.d.tick(s.t, r, s.w));
  }
}
{
  const off: MomentMusicRequest = { active: false, seq: 1, musicId: null, category: null, mood: [], time: ['day'] };
  // A long moment, a short piece: the piece ends on its own, never looped, no stop command.
  const s = momentSim();
  mAdvance(s, 2, off);
  const t0 = s.t;
  mAdvance(s, 60, req({ seq: 1, musicId: 'an-kisa' }));
  const plays = s.w.plays();
  check(plays.length === 1 && plays[0].phraseId === 'an-kisa', 'the named short piece plays once');
  check(plays[0].now - t0 <= 1.2, `it starts as soon as it is decoded (${(plays[0].now - t0).toFixed(1)} s)`);
  check(near(plays[0].fadeIn, MOMENT_MUSIC_DEFAULTS.fadeInSec) && plays[0].fadeIn >= 2 && plays[0].fadeIn <= 3, `fade-in ${plays[0].fadeIn} s (2–3 s)`);
  check(s.w.stops().length === 0 && s.d.view.current === null && /on its own/.test(s.d.view.note), 'a piece shorter than the moment ends on its own (no loop, no cut)');
  mAdvance(s, 2, { ...off, seq: 1 });
  check(s.w.stops().length === 0, 'the moment ending after the piece: nothing to fade');
  // A short moment, a long piece: fade out over 3–4 s when the moment ends.
  mAdvance(s, 1, req({ seq: 2, mood: ['nostalgic', 'sea'] }));
  mAdvance(s, 1, req({ seq: 2, mood: ['nostalgic', 'sea'] }));
  const second = s.w.plays()[1];
  check(!!second && second.phraseId === 'an-siir-deniz', `the next moment chooses by mood (${second?.phraseId})`);
  mAdvance(s, 15, req({ seq: 2, mood: ['nostalgic', 'sea'] }));
  const tEnd = s.t;
  mAdvance(s, 0.1, { ...off, seq: 2 });
  const stop = s.w.stops()[0];
  check(!!stop && stop.voice === second.voice && near(stop.at, tEnd + 0.1, 0.11) && stop.fade >= 3 && stop.fade <= 4, `moment over: the piece fades out over ${stop?.fade} s`);
  // The same mood again: never the same piece twice in a row.
  mAdvance(s, 5, { ...off, seq: 2 });
  mAdvance(s, 3, req({ seq: 3, mood: ['nostalgic', 'sea'] }));
  const third = s.w.plays()[2];
  check(!!third && third.phraseId !== 'an-siir-deniz', `no repeat across moments (${third?.phraseId})`);
  // Back-to-back moments without an inactive frame: the old piece fades, the new one starts.
  mAdvance(s, 3, req({ seq: 4, category: 'legend', mood: ['history'] }));
  const fourth = s.w.plays()[3];
  check(!!fourth && fourth.phraseId === 'an-tarih' && s.w.stops().some((x) => x.voice === third.voice), 'a new moment right after another: the old piece fades, the new one plays');
  // A slow decode is dropped.
  const slow = momentSim(6, 20);
  mAdvance(slow, 30, req({ seq: 1 }));
  check(slow.w.plays().length === 0 && /too slowly/.test(slow.d.view.note), `a piece that takes > ${MOMENT_MUSIC_DEFAULTS.maxWaitSec} s to decode is dropped`);
  // No match: nothing.
  const nm = momentSim(7);
  mAdvance(nm, 10, req({ seq: 1, category: 'unknown', mood: [] }));
  check(nm.w.log.length === 0 && /no piece/.test(nm.d.view.note), 'no matching piece: no commands');
  // Shift.
  const sh = momentSim(8);
  mAdvance(sh, 3, req({ seq: 1 }));
  const e0 = sh.d.view.endsAt!;
  sh.d.shift(5);
  check(near(sh.d.view.endsAt!, e0 + 5), 'shift moves the piece end');
  // Sprinkles hold while a moment (and so its piece) plays: covered by the moment hold above.
  check(ctxOf(inp({ moment: true })).hold === 'moment', 'sprinkles hold during moments');
}

/* ------------------------------------------------------------------ */
/* 6. Style                                                             */
/* ------------------------------------------------------------------ */
section('style');
{
  check(effectiveMusicStyle(null, true) === 'sparse', 'automatic: sparse when phrases exist');
  check(effectiveMusicStyle(null, false) === 'continuous', 'automatic: continuous without phrases');
  check(effectiveMusicStyle('continuous', true) === 'continuous' && effectiveMusicStyle('sparse', false) === 'sparse', 'a chosen style wins');
  // Sparse style: the loop director sees 'hold' outside races / moments; endWindow ends a playing set on a phrase.
  const set: MusicSetDef = { ...TEST_SETS[2] };
  const d = new MusicDirector(DEFAULT_DIRECTOR, seededRandom(2));
  const e = new MusicRulesEngine();
  const ready = { sets: [set], isReady: () => true };
  const cmds: Array<DirectorCommand & { now: number }> = [];
  let t = 0;
  for (; t < 10; t += 0.1) {
    for (const c of d.tick(t, e.update(t, inp({ race: 'running' })), ready)) {
      cmds.push({ ...c, now: t });
    }
  }
  check(d.view.phase === 'playing' && cmds.some((c) => c.type === 'start'), 'a race starts the race set in sparse style');
  for (; t < 30; t += 0.1) {
    const target = e.update(t, inp({}));
    const held = { ...target, policy: 'hold' as const };
    d.endWindow(t);
    for (const c of d.tick(t, held, ready)) {
      cmds.push({ ...c, now: t });
    }
  }
  const end = cmds.find((c) => c.type === 'end');
  check(!!end && end.now < 10.5 + (60 / set.bpm) * set.beatsPerBar * (set.phraseBars ?? 4), 'after the race the set ends on its next phrase (endWindow)');
  const silentD = new MusicDirector(DEFAULT_DIRECTOR, seededRandom(3));
  let starts = 0;
  for (let u = 0; u < 600; u += 0.5) {
    starts += silentD.tick(u, { ...e.update(u, inp({})), policy: 'hold' }, ready).filter((c) => c.type === 'start').length;
  }
  check(starts === 0, 'sparse style: no loop starts outside races and moments');
}

console.log(`\n${passes} passed, ${failures} failed`);
if (failures > 0) {
  process.exit(1);
}
