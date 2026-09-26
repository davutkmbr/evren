/**
 * Headless check of the moment music sources (src/audio/music/moment-source.ts, moment-source-session.ts, the
 * director's lead-in in moment-music.ts, and src/moments/music-source.ts): no browser, no WebAudio, a fake clock.
 *
 *   npx tsx tools/headless/music-source-check.ts
 *
 * 1. Distance curve: level and cutoff fall with distance (the highs first, then the level), silent at the reach;
 *    night over calm water carries farther.
 * 2. Wind masking by speed and mode; perched or standing close is the clearest; memory is masked more gently.
 * 3. Lead-in: the piece starts from afar before the moment; the moment carries it on; a moment that never starts leaves
 *    it a world sound that fades as the player leaves.
 * 4. Opening and closing on the moment's start and end.
 * 5. World-to-memory cross-fade when the player flies far mid-moment (and back).
 * 6. Memory direction from `from`; centred and diffuse without it; no distance attenuation.
 * 7. The ferry source follows its moving anchor.
 * 8. NaN safety.
 * 9. Zero cost when no source is near.
 *
 * Exits non-zero on any failure.
 */
import { MOMENT_MUSIC_DEFAULTS, MomentMusicDirector, type MomentMusicRequest, type MomentMusicWorld } from '../../src/audio/music/moment-music';
import {
  distanceCutoff,
  distanceLevel,
  emptySourceMix,
  MUSIC_SOURCE_KINDS,
  SOURCE_TUNING,
  sourceMix,
  sourceReach,
  SourceTracker,
  windMask,
  WORLD_CHAINS,
  type MomentSourceSpec,
  type SourceEnv,
  type SourceListen,
  type WorldSourceKind,
} from '../../src/audio/music/moment-source';
import { MomentSourceSession, type MomentSourceFrame } from '../../src/audio/music/moment-source-session';
import type { SprinkleCommand } from '../../src/audio/music/sprinkle';
import { TEST_MOMENT_PIECES } from '../../src/audio/music/test-sets';
import type { ListenerPose, Vec3 } from '../../src/audio/spatial';
import { seededRandom } from '../../src/audio/music/director';
import { ALL_MOMENTS } from '../../src/moments/data';
import { MusicSourceResolver, hasWorldSource, musicSourceOf } from '../../src/moments/music-source';
import type { AnchorPoint } from '../../src/moments/triggers';

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
const section = (name: string): void => console.log(`\n# ${name}`);
const dbOf = (v: number): number => 20 * Math.log10(Math.max(v, 1e-9));
const allFinite = (o: object): boolean => Object.values(o).every((v) => typeof v !== 'number' || Number.isFinite(v));

const DAY: SourceEnv = { night: 0, windSpeed: 3, rain: 0, storm: 0, overWater: true, airspeed: 0, mode: 'hovering', perched: false };
const NIGHT: SourceEnv = { ...DAY, night: 1, windSpeed: 1 };
const listen = (distance: number, over: Partial<SourceListen> = {}): SourceListen => ({ distance, side: 0, fromSide: null, open: 0, memory: 0, reachScale: 1, sourceOverWater: false, ...over });

/* ------------------------------------------------------------------ */
/* 1. Distance curve                                                    */
/* ------------------------------------------------------------------ */
section('distance curve');
for (const kind of MUSIC_SOURCE_KINDS.filter((k): k is WorldSourceKind => k !== 'memory')) {
  const reach = sourceReach(kind, 1, DAY);
  let prevL = Infinity;
  let prevC = Infinity;
  let mono = true;
  for (let d = 5; d <= reach * 1.2; d += reach / 60) {
    const m = sourceMix(kind, listen(d), DAY);
    if (m.level > prevL + 1e-9 || m.cutoff > prevC + 1e-6) {
      mono = false;
    }
    prevL = m.level;
    prevC = m.cutoff;
  }
  check(mono, `${kind}: level and cutoff never rise with distance`);
  check(sourceMix(kind, listen(reach), DAY).level < 1e-6, `${kind}: silent at the reach (${reach.toFixed(0)} m)`);
  const close = sourceMix(kind, listen(WORLD_CHAINS[kind].ref), DAY);
  check(close.level > 0.5, `${kind}: close to the source the level is high (${close.level.toFixed(2)})`);
}
{
  // The highs go first: at 0.3 reach the cutoff is already under 4.5 kHz while the level is not yet faded.
  const reach = sourceReach('gramophone', 1, DAY);
  const d = reach * 0.3;
  const m = sourceMix('gramophone', listen(d), DAY);
  const undamped = Math.pow(Math.min(1, WORLD_CHAINS.gramophone.ref / d), SOURCE_TUNING.rolloff);
  check(distanceCutoff(0.3) < 4500 && Math.abs(distanceLevel(d, WORLD_CHAINS.gramophone.ref, reach) - undamped) < 1e-9, `highs first: at 0.3 R cutoff ${distanceCutoff(0.3).toFixed(0)} Hz, level not yet faded`);
  check(m.cutoff < 4500, 'the mix carries the air absorption cutoff');
  check(Math.abs(distanceCutoff(1) - SOURCE_TUNING.farCutoffHz) < 1 && Math.abs(distanceCutoff(0) - SOURCE_TUNING.nearCutoffHz) < 1, 'cutoff spans near → far');
  // Night carry.
  const day = sourceReach('venue', 1, DAY);
  const night = sourceReach('venue', 1, NIGHT);
  check(night > day * 1.5, `night over calm water carries farther (${day.toFixed(0)} → ${night.toFixed(0)} m)`);
  check(sourceReach('venue', 1, { ...NIGHT, overWater: false }) === day, 'no night carry away from the water');
  check(sourceReach('venue', 1, { ...NIGHT, overWater: false }, true) === night, 'a source by the water carries at night from the land too');
  check(sourceReach('venue', 1, { ...NIGHT, windSpeed: 12 }) < night * 0.8, 'a windy night carries less');
  check(sourceReach('venue', 1, { ...NIGHT, rain: 1 }) < night, 'rain shortens the night carry');
  const at = day * 0.8;
  check(sourceMix('venue', listen(at), NIGHT).level > sourceMix('venue', listen(at), DAY).level * 1.5, 'at 0.8 of the day reach the night is clearly louder');
  check(sourceMix('venue', listen(at), NIGHT).cutoff > sourceMix('venue', listen(at), DAY).cutoff, '... and brighter');
  check(sourceReach('gramophone', 1.8, DAY) > sourceReach('gramophone', 1, DAY) * 1.79, 'reachScale scales the reach');
  check(sourceReach('live', 2, NIGHT) <= SOURCE_TUNING.maxReach, `the largest reach (${sourceReach('live', 2, NIGHT).toFixed(0)} m) is within maxReach`);
}

/* ------------------------------------------------------------------ */
/* 2. Wind masking, perch clarity                                       */
/* ------------------------------------------------------------------ */
section('wind masking');
{
  let prev = -1;
  let mono = true;
  for (let v = 0; v <= 60; v += 2) {
    const m = windMask(v, 'flying', false);
    if (m < prev - 1e-9) mono = false;
    prev = m;
  }
  check(mono && windMask(0, 'flying', false) === 0 && windMask(60, 'flying', false) === 1, 'the mask grows with airspeed, 0 → 1');
  check(windMask(40, 'hovering', false) <= SOURCE_TUNING.hoverMask, 'hovering masks little');
  check(windMask(40, 'flying', true) === 0 && windMask(5, 'grounded', false) === 0, 'perched or standing: no mask');
  check(windMask(20, 'diving', false) >= 0.9, 'diving masks almost everything');
  const env = (airspeed: number, mode: SourceEnv['mode'], perched = false): SourceEnv => ({ ...DAY, airspeed, mode, perched });
  const slow = sourceMix('gramophone', listen(120), env(5, 'gliding'));
  const fast = sourceMix('gramophone', listen(120), env(40, 'flying'));
  check(fast.level < slow.level * 0.45 && fast.cutoff < slow.cutoff * 0.35, `fast flight ducks (${dbOf(fast.level / slow.level).toFixed(1)} dB) and low-passes (${fast.cutoff.toFixed(0)} Hz) the music`);
  const hover = sourceMix('gramophone', listen(45, { standDistance: 45 }), env(0, 'hovering'));
  const perch = sourceMix('gramophone', listen(45, { standDistance: 45 }), env(0, 'grounded', true));
  check(perch.clarity > hover.clarity && perch.level > hover.level && perch.cutoff > hover.cutoff, `perching within 60 m is the clearest (clarity ${hover.clarity.toFixed(2)} → ${perch.clarity.toFixed(2)})`);
  const perchFar = sourceMix('gramophone', listen(200, { standDistance: 200 }), env(0, 'grounded', true));
  const hoverFar = sourceMix('gramophone', listen(200, { standDistance: 200 }), env(0, 'hovering'));
  check(Math.abs(perchFar.level - hoverFar.level) < 1e-3 * hoverFar.level + 0.02 * hoverFar.level, 'the stand bonus is only within ~60 m');
  const memSlow = sourceMix('memory', listen(NaN), env(5, 'gliding'));
  const memFast = sourceMix('memory', listen(NaN), env(40, 'flying'));
  const worldDrop = dbOf(fast.level / slow.level);
  const memDrop = dbOf(memFast.memLevel / memSlow.memLevel);
  check(memDrop < 0 && memDrop > worldDrop / 2, `memory is masked more gently (${memDrop.toFixed(1)} dB vs ${worldDrop.toFixed(1)} dB)`);
  check(memFast.memCutoff < memSlow.memCutoff && memFast.memCutoff > fast.cutoff, 'memory is low-passed a little by speed');
}

/* ------------------------------------------------------------------ */
/* Scenario harness: resolver + session + director on a fake clock      */
/* ------------------------------------------------------------------ */

class FakeWorld implements MomentMusicWorld {
  readonly phrases = TEST_MOMENT_PIECES;
  private readonly ready = new Map<string, number>();
  readonly log: Array<SprinkleCommand & { now: number }> = [];
  isReady(id: string): boolean {
    return (this.ready.get(id) ?? Infinity) <= this.now;
  }
  now = 0;
  step(now: number, cmds: readonly SprinkleCommand[]): void {
    this.now = now;
    for (const c of cmds) {
      this.log.push({ ...c, now });
      if (c.type === 'load' && !this.ready.has(c.phraseId)) this.ready.set(c.phraseId, now + 0.5);
    }
  }
  count(type: SprinkleCommand['type']): number {
    return this.log.filter((c) => c.type === type).length;
  }
}

const GEO = { heightAt: () => 0, coastDistance: () => 30 };
const byId = (id: string) => ALL_MOMENTS.find((m) => m.id === id)!;

class Scenario {
  readonly resolver = new MusicSourceResolver();
  readonly session = new MomentSourceSession();
  readonly director = new MomentMusicDirector(MOMENT_MUSIC_DEFAULTS, seededRandom(3));
  readonly world = new FakeWorld();
  readonly listener: ListenerPose = { position: { x: 0, y: 30, z: 0 }, forward: { x: 0, y: 0, z: -1 }, right: { x: 1, y: 0, z: 0 } };
  env: SourceEnv = { ...DAY, mode: 'gliding', airspeed: 12 };
  t = 0;
  seq = 0;
  active: string | null = null;
  anchorId: number | undefined;
  anchors: Record<string, AnchorPoint[]> = { ferry: [] };
  req: MomentMusicRequest = { active: false, seq: 0, musicId: null, category: null, mood: [], time: ['day'] };
  readonly frame: MomentSourceFrame = { current: null, focus: null, nearby: null };
  candidates = ALL_MOMENTS.filter(hasWorldSource);

  at(p: Vec3): void {
    this.listener.position.x = p.x;
    this.listener.position.y = p.y;
    this.listener.position.z = p.z;
  }

  start(id: string): void {
    const m = byId(id);
    this.seq++;
    this.active = id;
    this.frame.current = this.resolver.resolve(m, GEO, this.anchors, this.anchorId);
    this.req = { active: true, seq: this.seq, musicId: m.content.musicId ?? null, category: m.category, mood: m.content.musicMood ?? [], time: ['day'], momentId: this.frame.current?.momentId ?? null, world: false };
  }

  end(): void {
    this.active = null;
    this.req = { active: false, seq: this.seq, musicId: null, category: null, mood: [], time: ['day'] };
  }

  /** One frame: the moments system's resolve, then the controller's session + director. */
  tick(dt: number): void {
    this.t += dt;
    const cur = this.active ? byId(this.active) : null;
    this.frame.current = cur ? this.resolver.resolve(cur, GEO, this.anchors, this.anchorId) : null;
    const focus = this.session.focus(this.director.view);
    const fm = focus && focus.momentId !== cur?.id ? byId(focus.momentId) : null;
    this.frame.focus = fm ? this.resolver.resolve(fm, GEO, this.anchors, focus?.anchorId) : null;
    const p = this.listener.position;
    this.frame.nearby = !cur && !focus ? this.resolver.nearest(this.candidates, p, GEO, this.anchors, SOURCE_TUNING.maxReach) : null;
    this.session.update({ dt, frame: this.frame, momentActive: !!this.active, view: this.director.view, listener: this.listener, dragon: p, env: this.env, blocked: false }, this.req);
    this.world.step(this.t, this.director.tick(this.t, this.req, this.world, this.session.state));
  }

  run(sec: number, dt = 0.1, each?: () => void): void {
    const end = this.t + sec;
    while (this.t < end - 1e-9) {
      each?.();
      this.tick(dt);
    }
  }
}

const katibim = byId('katibim-uskudar-yagmur');
const katibimSpec = new MusicSourceResolver().resolve(katibim, GEO)!;
const src = katibimSpec.position!;

/* ------------------------------------------------------------------ */
/* 3. Lead-in                                                           */
/* ------------------------------------------------------------------ */
section('lead-in');
{
  check(musicSourceOf(katibim).kind === 'venue' && !!src, 'Kâtibim has a venue source');
  const s = new Scenario();
  const reach = sourceReach('venue', 1, s.env, katibimSpec.overWater);
  // Approach from 1.2 km west at 15 m/s, 30 m up.
  let x = src.x - 1200;
  let playAtDist = NaN;
  s.run(75, 0.1, () => {
    if (x < src.x - 120) x += 1.5;
    s.at({ x, y: 30, z: src.z });
    if (Number.isNaN(playAtDist) && s.world.count('play') > 0) playAtDist = src.x - x;
  });
  check(s.world.count('play') === 1, 'the lead-in piece started from the approach');
  check(playAtDist > 150 && playAtDist <= reach + 5, `it started inside the reach, well before the moment's place (${playAtDist.toFixed(0)} m of ${reach.toFixed(0)} m)`);
  check(s.director.view.phase === 'lead' && s.director.view.momentId === katibim.id, 'the voice is a lead-in of Kâtibim');
  const mixLead = s.session.mix!;
  check(mixLead.kind === 'venue' && mixLead.open === 0 && mixLead.memory === 0, 'the lead-in is a plain positional world sound');
  // The moment starts at 120 m: the same piece carries on, no new play.
  s.start(katibim.id);
  s.run(3);
  check(s.world.count('play') === 1 && s.world.count('stop') === 0, 'the moment carries the lead-in on (no restart)');
  check(s.director.view.phase === 'moment', 'the voice is now the moment\'s');
  s.end();
  s.run(40, 0.1);
  // (The piece may end on its own; the check below covers the leave.)
}
{
  // A moment that never starts: the music stays a world sound and fades as the player leaves.
  const s = new Scenario();
  const reach = sourceReach('venue', 1, s.env, katibimSpec.overWater);
  s.at({ x: src.x - 250, y: 30, z: src.z });
  s.run(8);
  check(s.world.count('play') === 1 && s.director.view.phase === 'lead', 'the lead-in plays at 250 m without a moment');
  let x = src.x - 250;
  let stopDist = NaN;
  s.run(40, 0.1, () => {
    x -= 12;
    s.at({ x, y: 30, z: src.z });
    if (Number.isNaN(stopDist) && s.world.count('stop') > 0) stopDist = src.x - x;
  });
  check(s.world.count('stop') === 1 && !s.director.playing, 'the piece fades out once the player has left');
  check(stopDist >= reach && stopDist <= reach * SOURCE_TUNING.releaseAt + 20, `... just beyond the reach (${stopDist.toFixed(0)} m, reach ${reach.toFixed(0)} m)`);
  const stop = s.world.log.find((c) => c.type === 'stop');
  check(stop?.type === 'stop' && stop.fade === MOMENT_MUSIC_DEFAULTS.leaveFadeSec, 'with the leave fade');
  // Coming back at once: the cooldown keeps it from starting again right away.
  s.at({ x: src.x - 200, y: 30, z: src.z });
  s.run(20);
  check(s.world.count('play') === 1, `no new lead-in within the cooldown (${MOMENT_MUSIC_DEFAULTS.leadCooldownSec} s)`);
  s.run(MOMENT_MUSIC_DEFAULTS.leadCooldownSec);
  check(s.world.count('play') >= 2, 'after the cooldown the source plays again');
}

/* ------------------------------------------------------------------ */
/* 4. Opening and closing                                               */
/* ------------------------------------------------------------------ */
section('opening and closing');
{
  const s = new Scenario();
  s.env = { ...DAY, mode: 'hovering', airspeed: 0 };
  s.at({ x: src.x - 150, y: 20, z: src.z });
  s.run(6);
  const before = { ...s.session.mix! };
  s.start(katibim.id);
  s.run(1);
  const half = s.session.tracker.open;
  s.run(1.2);
  const opened = { ...s.session.mix! };
  check(half > 0.3 && half < 0.7, `the source opens gradually (${half.toFixed(2)} after 1 s)`);
  check(opened.open === 1, 'fully open after ~2 s');
  check(dbOf(opened.level / before.level) > 2.5 && opened.cutoff > before.cutoff * 1.4, `opened: +${dbOf(opened.level / before.level).toFixed(1)} dB, cutoff ${before.cutoff.toFixed(0)} → ${opened.cutoff.toFixed(0)} Hz`);
  check(opened.room < before.room && opened.memory === 0, 'a little drier, still positional');
  s.end();
  s.run(1.5);
  const closing = s.session.tracker.open;
  s.run(2);
  check(closing > 0.2 && closing < 0.8 && s.session.tracker.open === 0, `after the moment it sinks back over ~3 s (${closing.toFixed(2)} at 1.5 s)`);
  check(s.director.view.phase === 'world' && s.world.count('stop') === 0, 'the piece stays a world sound after the moment');
  let x = src.x - 150;
  s.run(40, 0.1, () => {
    x -= 12;
    s.at({ x, y: 20, z: src.z });
  });
  check(s.world.count('stop') === 1 && !s.director.playing, 'and fades as the player leaves');
}

/* ------------------------------------------------------------------ */
/* 5. World to memory                                                   */
/* ------------------------------------------------------------------ */
section('world to memory');
{
  const s = new Scenario();
  const reach = sourceReach('venue', 1, s.env, katibimSpec.overWater);
  s.at({ x: src.x - 100, y: 30, z: src.z });
  s.run(3);
  s.start(katibim.id);
  s.run(3);
  check(s.req.world === true && s.session.mix!.memory === 0, 'near the source the moment\'s music is a world sound');
  // Fly away mid-moment.
  let x = src.x - 100;
  let crossAt = NaN;
  s.run(9, 0.1, () => {
    x -= 5;
    s.at({ x, y: 30, z: src.z });
    if (Number.isNaN(crossAt) && s.session.tracker.crossed) crossAt = src.x - x;
  });
  check(crossAt > reach * 0.85 && crossAt < reach * 0.95 + 20, `it crosses into memory beyond ${SOURCE_TUNING.memoryAt} R (${crossAt.toFixed(0)} m)`);
  check(s.session.mix!.memory === 1 && s.req.world === false, 'the moment keeps its music as a memory');
  check(s.world.count('stop') === 0 && s.director.playing, 'the piece did not stop far from the source mid-moment');
  const mem = s.session.mix!;
  check(mem.memLevel > 0.5 && mem.audible > 0.4, `the memory is audible far away (${mem.audible.toFixed(2)})`);
  // Back toward the source: returns to the world inside 0.6 R.
  s.run(11, 0.1, () => {
    if (x < src.x - 50) x += 5;
    s.at({ x, y: 30, z: src.z });
  });
  check(!s.session.tracker.crossed && s.session.mix!.memory === 0, 'back near the source it returns to the world');
  // Cross again and end the moment far away: a memory fades at the end instead of staying in the world.
  s.run(6, 0.1, () => {
    x -= 5;
    s.at({ x, y: 30, z: src.z });
  });
  s.end();
  s.run(1);
  check(s.world.count('stop') === 1 && !s.director.playing, 'a moment that ended as a memory fades its music out');
}
{
  // The cross-fade takes memoryFadeSec.
  const tr = new SourceTracker();
  const L: ListenerPose = { position: { x: src.x - 100, y: 30, z: src.z }, forward: { x: 0, y: 0, z: -1 }, right: { x: 1, y: 0, z: 0 } };
  tr.update({ dt: 0.1, spec: katibimSpec, momentActive: true, listener: L, dragon: null, env: DAY });
  check(tr.memory === 0, 'a moment that starts near its source is a world sound');
  L.position.x = src.x - 1000;
  tr.update({ dt: 0.1, spec: katibimSpec, momentActive: true, listener: L, dragon: null, env: DAY });
  let t = 0.1;
  while (tr.memory < 1 && t < 10) {
    tr.update({ dt: 0.1, spec: katibimSpec, momentActive: true, listener: L, dragon: null, env: DAY });
    t += 0.1;
  }
  check(Math.abs(t - SOURCE_TUNING.memoryFadeSec) < 0.35, `the world → memory cross-fade takes ~${SOURCE_TUNING.memoryFadeSec} s (${t.toFixed(1)} s)`);
  const far = new SourceTracker();
  far.update({ dt: 0.1, spec: katibimSpec, momentActive: true, listener: L, dragon: null, env: DAY });
  check(far.memory === 1 && far.crossed, 'a moment that starts far from its source is a memory from the first frame');
}

/* ------------------------------------------------------------------ */
/* 6. Memory direction                                                  */
/* ------------------------------------------------------------------ */
section('memory direction');
{
  const nedim = byId('nedim-bu-sehr-i-sitanbul');
  const spec = new MusicSourceResolver().resolve(nedim, GEO)!;
  check(spec.kind === 'memory' && !!spec.from, 'Nedim is a memory from the palace');
  const from = spec.from!;
  const tr = new SourceTracker();
  const pose = (x: number, z: number): ListenerPose => ({ position: { x, y: 300, z }, forward: { x: 0, y: 0, z: -1 }, right: { x: 1, y: 0, z: 0 } });
  const right = tr.update({ dt: 0.1, spec, momentActive: true, listener: pose(from.x - 800, from.z), dragon: null, env: DAY })!;
  check(right.memPan > 0.3 && right.memory === 1, `the subject to the right pans right (${right.memPan.toFixed(2)})`);
  const left = tr.update({ dt: 0.1, spec, momentActive: true, listener: pose(from.x + 800, from.z), dragon: null, env: DAY })!;
  check(left.memPan < -0.3, `the subject to the left pans left (${left.memPan.toFixed(2)})`);
  const farL = tr.update({ dt: 0.1, spec, momentActive: true, listener: pose(from.x + 4000, from.z), dragon: null, env: DAY })!;
  check(Math.abs(farL.memLevel - left.memLevel) < 1e-9, 'memory is not distance-attenuated');
  const plain = sourceMix('memory', listen(NaN), DAY);
  check(plain.memPan === 0 && plain.memDry < left.memDry && plain.memHall > left.memHall, 'without `from`: centred and more diffuse');
  const orhan = byId('orhan-veli-istanbulu-dinliyorum');
  check(musicSourceOf(orhan).kind === 'memory' && !musicSourceOf(orhan).from, 'Orhan Veli is a centred memory');
  const storks = byId('storks-bosphorus-migration');
  check(musicSourceOf(storks).kind === 'memory', 'a record without musicSource defaults to memory');
  for (const id of ['nedim-bu-sehr-i-sitanbul', 'de-amicis-sis-kalkinca', 'prokopios-gokten-asili-kubbe']) {
    const ms = musicSourceOf(byId(id));
    check(ms.kind === 'memory' && !!ms.from, `${id}: memory with from`);
  }
  for (const m of ALL_MOMENTS.filter((x) => x.category === 'legend')) {
    check(musicSourceOf(m).kind === 'memory', `legend ${m.id}: memory`);
  }
}

/* ------------------------------------------------------------------ */
/* 7. Ferry source on a moving anchor                                   */
/* ------------------------------------------------------------------ */
section('ferry anchor');
{
  const ferry = byId('ferry-gull-simit');
  check(musicSourceOf(ferry).kind === 'ferry' && musicSourceOf(ferry).anchor === 'ferry', 'the gull-and-simit moment has a ferry deck radio');
  const s = new Scenario();
  s.anchors.ferry = [
    { x: 0, z: 0, id: 7 },
    { x: 3000, z: 0, id: 9 },
  ];
  s.at({ x: -150, y: 20, z: 60 });
  s.run(3);
  check(s.director.view.phase === 'lead' && s.director.view.momentId === ferry.id, 'the deck radio leads in near a ferry');
  check(s.session.voiceSpec?.anchorId === 7, 'it locked on the nearest ferry (id 7)');
  s.anchorId = 7;
  s.start(ferry.id);
  const pans: number[] = [];
  const dists: number[] = [];
  s.run(12, 0.1, () => {
    // Ferry 7 steams east at 6 m/s; ferry 9 comes close from the other side (must not steal the source).
    s.anchors.ferry[0].x += 0.6;
    s.anchors.ferry[1].x -= 25;
    pans.push(s.session.mix?.pan ?? 0);
    dists.push(s.session.mix?.distance ?? NaN);
  });
  const spec = s.frame.current!;
  check(spec.anchorId === 7 && Math.abs(spec.position!.x - s.anchors.ferry[0].x) < 1e-6, 'the source follows ferry 7 as it moves');
  check(pans[pans.length - 1] > pans[5] && dists[dists.length - 1] > dists[5], 'the pan and the distance follow the moving ferry');
  // The ferry leaves service mid-moment: the last known position is kept.
  const lastX = spec.position!.x;
  s.anchors.ferry = [];
  s.run(1);
  check(s.frame.current?.position?.x === lastX, 'a ferry out of service keeps its last position');
  check(new MusicSourceResolver().resolve(ferry, GEO, { ferry: [] }) === null, 'no ferry ever seen: no source');
}

/* ------------------------------------------------------------------ */
/* 8. NaN safety                                                        */
/* ------------------------------------------------------------------ */
section('NaN safety');
{
  const bad: SourceEnv = { night: NaN, windSpeed: NaN, rain: NaN, storm: Infinity, overWater: true, airspeed: NaN, mode: 'flying', perched: false };
  let ok = true;
  for (const kind of MUSIC_SOURCE_KINDS) {
    for (const d of [NaN, Infinity, -5, 0, 1e9]) {
      const m = sourceMix(kind, { distance: d, side: NaN, standDistance: NaN, fromSide: NaN, open: NaN, memory: NaN, reachScale: NaN, sourceOverWater: false }, bad);
      const nums = [m.level, m.cutoff, m.room, m.openAir, m.pan, m.width, m.memLevel, m.memCutoff, m.memDry, m.memHall, m.memPan, m.memory, m.open, m.windMask, m.clarity, m.audible, m.reach];
      if (!nums.every(Number.isFinite)) ok = false;
    }
  }
  check(ok, 'sourceMix never returns a non-finite number (NaN / Infinity inputs)');
  const tr = new SourceTracker();
  const L: ListenerPose = { position: { x: NaN, y: NaN, z: NaN }, forward: { x: 0, y: 0, z: -1 }, right: { x: NaN, y: 0, z: 0 } };
  const m = tr.update({ dt: NaN, spec: katibimSpec, momentActive: true, listener: L, dragon: { x: NaN, y: 0, z: 0 }, env: bad })!;
  check([m.level, m.cutoff, m.pan, m.memory, m.open].every(Number.isFinite) && m.level === 0, 'a NaN listener gives a silent, finite world mix');
  const r = new MusicSourceResolver();
  check(r.nearest(ALL_MOMENTS, { x: NaN, z: 0 }, GEO, undefined, 1000) === null, 'no candidate for a NaN position');
  const nanFerry = r.resolve(byId('ferry-gull-simit'), GEO, { ferry: [{ x: NaN, z: 0, id: 1 }] }, 1);
  check(nanFerry === null, 'a NaN anchor is ignored');
  const empty = emptySourceMix();
  check(allFinite({ ...empty, distance: 0 }) && empty.level === 0 && empty.memLevel === 0, "the idle mix is silent and finite (distance NaN = no source)");
}

/* ------------------------------------------------------------------ */
/* 9. Zero cost when no source is near                                  */
/* ------------------------------------------------------------------ */
section('zero cost');
{
  const s = new Scenario();
  // Over the Marmara far from every source (south of Sarayburnu, 8 km out).
  s.at({ x: -3000, y: 100, z: 14000 });
  s.run(120);
  check(s.frame.nearby === null, 'no candidate beyond maxReach');
  check(s.session.state.lead === null && s.session.mix === null, 'no lead-in and no source mix (the graph is never built)');
  check(s.world.log.length === 0, 'the director emits no commands');
  const t0 = performance.now();
  const r = new MusicSourceResolver();
  const cands = ALL_MOMENTS.filter(hasWorldSource);
  for (let i = 0; i < 20000; i++) r.nearest(cands, { x: -3000, z: 14000 }, GEO, { ferry: [] }, SOURCE_TUNING.maxReach);
  const us = ((performance.now() - t0) / 20000) * 1000;
  check(us < 20, `the per-frame candidate search is cheap (${us.toFixed(2)} µs)`);
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
