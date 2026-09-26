/**
 * Adaptive music (`.docs/audio/music-system.md`): the game side. Hosted by the audio system (src/audio/index.ts),
 * which owns the AudioContext and the master bus.
 *
 *   manifest.ts  data format + validation (public/audio/music/manifest.json)
 *   rules.ts     game state → stem mix, duck, set preferences (conditions with hysteresis, rules table, smoothing)
 *   director.ts  which set plays when: play / silence cycle, bar / phrase-quantised changes, race / moment overrides
 *   sprinkle.ts  sprinkle mode ("Müzik tarzı: Seyrek"): mostly silence, a short single-instrument phrase now and then
 *   moment-music.ts  the emotional one-shot piece under a moment's subtitles
 *   clock.ts     bar-grid math
 *   player.ts    WebAudio: on-demand decoding, sample-locked stem loops, fades, stingers, one-shot phrase voices
 *   test-sets.ts DEV-ONLY procedural test sets, phrases and a moment piece (`?music=test`)
 *
 * Every frame this controller reads the services into a MusicInput, runs the rules, the director (loops), the sprinkle
 * director (sparse style) and the moment-music director on the AudioContext clock and hands the commands and the
 * smoothed mix to the player.
 *
 * Styles: `sparse` plays sprinkles and keeps the loops only for races (race-tagged sets) and a moment's own set;
 * `continuous` plays the loop cycle and no sprinkles. Moment pieces play in both.
 *
 * Debug: `?music=debug` overlay, `?music=test` procedural test sets and phrases (combine: `?music=test,debug`),
 * `?music=sparse` / `?music=continuous` force the style for the session, `?music=off` no music; `window.__evrenMusic`
 * (state, play / stop / force a set or a state, sprinkle now, style, adaptive on/off, pause / resume).
 */
import type { EngineContext } from '../../core/contracts';
import { positionAt } from './clock';
import { DEFAULT_DIRECTOR, MusicDirector, type DirectorCommand } from './director';
import { EMPTY_MANIFEST, MUSIC_BASE, roleOf, stemsOf, validateManifest, type MusicPhraseDef, type MusicSetDef, type StemRole, type StingerKind } from './manifest';
import { MomentMusicDirector, type MomentMusicRequest } from './moment-music';
import { MusicPlayer } from './player';
import { idleInput, MUSIC_CONDITIONS, MUSIC_RULES, MusicRulesEngine, type MusicInput, type MusicPolicy, type MusicTarget, type StemMix } from './rules';
import { effectiveMusicStyle, loadAdaptiveMusic, loadMusicStyle, loadMusicVolume, saveAdaptiveMusic, saveMusicStyle, saveMusicVolume, type MusicStyle } from './settings';
import { SprinkleDirector, sprinkleContext, TIME_TAGS, type SprinkleCommand, type SprinkleContext } from './sprinkle';
import type { MusicDebugOverlay } from './debug-overlay';

export interface MusicSnapshot {
  set: string | null;
  setTitle: string | null;
  bar: number;
  beat: number;
  bars: number;
  beatsPerBar: number;
  bpm: number;
  phase: string;
  next: string;
  state: string;
  policy: MusicPolicy;
  modifiers: string[];
  conditions: string[];
  mix: StemMix;
  target: StemMix;
  stemsPresent: StemRole[];
  duck: number;
  volume: number;
  adaptive: boolean;
  paused: boolean;
  sets: string[];
  note: string;
  /** Style in effect and whether it was chosen (or automatic / forced by the URL). */
  style: MusicStyle;
  styleSource: 'setting' | 'auto' | 'url';
  sprinkle: {
    phase: string;
    current: string | null;
    /** Seconds until the gap is over (null while playing). */
    nextIn: number | null;
    next: string | null;
    last: string | null;
    hold: string | null;
    busy: string | null;
    tags: string[];
    note: string;
    played: number;
    phrases: string[];
  };
  moment: { current: string | null; pending: string | null; last: string | null; note: string; pieces: string[] };
}

/** Extra facts about a moment for choosing its piece (AudioService.setMomentMusic). */
export interface MomentMusicInfo {
  category?: string;
  mood?: readonly string[];
}

export interface MusicDebugApi {
  readonly state: MusicSnapshot;
  /** Set ids available (manifest or test sets). */
  sets(): string[];
  /** Plays a set now (or the best one), ignoring the silence cycle, until release(). */
  play(setId?: string): void;
  /** Back to the automatic choice. */
  release(): void;
  /** Ends the music now; the next set comes after `silenceSec` (default: the normal gap). */
  stop(silenceSec?: number): void;
  /** Overrides MusicInput fields (e.g. {perched: true}, {race: 'running'}, {moment: true}); null clears. */
  force(input: Partial<MusicInput> | null): void;
  setAdaptive(on: boolean): void;
  setVolume(v: number): void;
  /** Loads the procedural DEV test sets, phrases and moment piece (same as ?music=test). */
  useTestSets(): Promise<void>;
  /** Sprinkle phrase ids (and moment piece ids) available. */
  phrases(): string[];
  /** Sprinkle mode: the next phrase (or this one) comes now, once holds and calm allow. */
  sprinkle(phraseId?: string): void;
  /** Switches the style ('sparse' = sprinkles, 'continuous' = loops) and stores it like the setting. */
  setStyle(style: MusicStyle): void;
  /** Starts a fake moment (as the moments system does) with a category / mood / musicId; `endMoment()` ends it. */
  moment(info?: MomentMusicInfo & { musicId?: string }): void;
  endMoment(): void;
  /** Plays a stinger of the current set ('go', 'finish', 'intro', 'outro'). */
  cue(kind: StingerKind): void;
  pause(): void;
  resume(): void;
  readonly rules: typeof MUSIC_RULES;
  readonly conditions: typeof MUSIC_CONDITIONS;
}

/** Seconds between water look-ups under the dragon (a GeoQuery grid sample). */
const WATER_PROBE_S = 0.25;

export class MusicController {
  private audio: BaseAudioContext | null = null;
  private player: MusicPlayer | null = null;
  private readonly rules = new MusicRulesEngine();
  private readonly director = new MusicDirector(DEFAULT_DIRECTOR);
  private readonly sprinkles = new SprinkleDirector();
  private readonly momentMusic = new MomentMusicDirector();
  private sets: MusicSetDef[] = [];
  /** Every phrase of the manifest (sprinkles and moment pieces). */
  private phrases: MusicPhraseDef[] = [];
  private sprinklePhrases: MusicPhraseDef[] = [];
  private storedStyle: MusicStyle | null = loadMusicStyle();
  private urlStyle: MusicStyle | null = null;
  private appliedStyle: MusicStyle | null = null;
  private momentSeq = 0;
  private momentReq: MomentMusicRequest = { active: false, seq: 0, musicId: null, category: null, mood: [], time: [] };
  private momentDuck = 0;
  private sprinkleCtx: SprinkleContext | null = null;
  private volume = loadMusicVolume();
  private adaptive = loadAdaptiveMusic();
  private readonly input: MusicInput = idleInput();
  private forced: Partial<MusicInput> | null = null;
  private target: MusicTarget | null = null;
  private momentActive = false;
  private momentMusicId: string | null = null;
  private raceContext = false;
  private raceRunning = false;
  private raceDone = false;
  private waterTimer = 0;
  private overlay: MusicDebugOverlay | null = null;
  private readonly unsubscribers: Array<() => void> = [];
  private disabled = false;
  private testMode = false;
  private manifestLoaded = false;
  private readonly pendingCues: StingerKind[] = [];
  private uiRoot: HTMLElement | null = null;
  private prestartEl: HTMLElement | null = null;

  constructor() {
    this.rules.adaptive = this.adaptive;
  }

  /* ---------------- service surface (AudioService) ---------------- */

  get musicVolume(): number {
    return this.volume;
  }

  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
    saveMusicVolume(this.volume);
    this.player?.setVolume(this.volume);
  }

  get adaptiveMusic(): boolean {
    return this.adaptive;
  }

  setAdaptive(on: boolean): void {
    this.adaptive = on;
    this.rules.adaptive = on;
    saveAdaptiveMusic(on);
  }

  setMomentMusic(active: boolean, musicId?: string, info?: MomentMusicInfo): void {
    this.momentActive = active;
    this.momentMusicId = active ? (musicId ?? null) : null;
    if (active) {
      this.momentSeq++;
    }
    this.momentReq = {
      active,
      seq: this.momentSeq,
      musicId: active ? (musicId ?? null) : null,
      category: active ? (info?.category ?? null) : null,
      mood: active ? [...(info?.mood ?? [])] : [],
      time: this.momentReq.time,
    };
  }

  /** "Müzik tarzı" in effect. */
  get musicStyle(): MusicStyle {
    return this.urlStyle ?? effectiveMusicStyle(this.storedStyle, this.sprinklePhrases.length > 0);
  }

  setMusicStyle(style: MusicStyle): void {
    this.storedStyle = style;
    this.urlStyle = null;
    saveMusicStyle(style);
  }

  private setPhrases(list: readonly MusicPhraseDef[]): void {
    this.phrases = [...list];
    this.sprinklePhrases = this.phrases.filter((p) => roleOf(p) === 'sprinkle');
  }

  /* ---------------- lifecycle ---------------- */

  init(ctx: EngineContext): void {
    this.uiRoot = ctx.uiRoot;
    const modes = (ctx.debug.params.get('music') ?? '').split(/[\s,+]+/).filter(Boolean);
    this.disabled = modes.includes('off');
    this.testMode = modes.includes('test');
    this.urlStyle = modes.includes('sparse') || modes.includes('sprinkle') ? 'sparse' : modes.includes('continuous') || modes.includes('loops') ? 'continuous' : null;
    if (modes.includes('debug')) {
      void import('./debug-overlay').then(({ MusicDebugOverlay }) => {
        this.overlay = new MusicDebugOverlay(document.body);
      });
    }
    const ev = ctx.events;
    this.unsubscribers.push(
      ev.on('activity', (e) => {
        if (!e.activityId.startsWith('race:')) {
          return;
        }
        if (e.state === 'started') {
          this.raceRunning = true;
          this.raceDone = false;
          this.pendingCues.push('go');
        } else if (e.state === 'finished') {
          this.raceRunning = false;
          this.raceDone = true;
          this.pendingCues.push('finish');
        } else if (e.state === 'aborted') {
          this.raceRunning = false;
          this.raceDone = true;
        }
      }),
    );
    (window as unknown as { __evrenMusic?: MusicDebugApi }).__evrenMusic = this.debugApi;
    if (!this.disabled) {
      if (this.testMode) {
        void this.useTestSets();
      } else {
        void this.loadManifest();
      }
    }
  }

  /** The audio system calls this once its engine (and master bus) exists. */
  attach(audio: BaseAudioContext, destination: AudioNode): void {
    this.audio = audio;
    this.player = new MusicPlayer(audio, destination);
    this.player.setVolume(this.volume);
    if (this.testMode) {
      void this.registerTestLoaders();
    }
  }

  private async loadManifest(): Promise<void> {
    let raw: unknown = EMPTY_MANIFEST;
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}${MUSIC_BASE}manifest.json`, { cache: 'no-cache' });
      if (res.ok) {
        raw = await res.json();
      }
    } catch {
      /* no manifest: no music */
    }
    const report = validateManifest(raw);
    for (const e of report.errors) {
      console.warn(`[music] manifest ${e.path}: ${e.message}`);
    }
    if (!this.testMode) {
      this.sets = [...report.manifest.sets];
      this.setPhrases(report.manifest.phrases ?? []);
    }
    this.manifestLoaded = true;
  }

  async useTestSets(): Promise<void> {
    const mod = await import('./test-sets');
    this.testMode = true;
    this.director.stopNow(this.audio?.currentTime ?? 0, 0);
    this.player?.stopAll(0.5);
    this.player?.stopVoices('s', 0.5);
    this.sprinkles.stopNow(this.audio?.currentTime ?? 0);
    this.sets = [...mod.TEST_SETS];
    this.setPhrases([...mod.TEST_PHRASES, ...mod.TEST_MOMENT_PIECES]);
    this.manifestLoaded = true;
    await this.registerTestLoaders();
    console.info(`[music] DEV test sets: ${this.sets.map((s) => s.id).join(', ')}; phrases: ${this.phrases.map((p) => p.id).join(', ')}`);
  }

  private async registerTestLoaders(): Promise<void> {
    if (!this.player) {
      return;
    }
    const mod = await import('./test-sets');
    for (const s of mod.TEST_SETS) {
      this.player.loaders.set(s.id, (set) => mod.renderTestSet(set));
    }
    for (const p of [...mod.TEST_PHRASES, ...mod.TEST_MOMENT_PIECES]) {
      this.player.phraseLoaders.set(p.id, (phrase) => mod.renderTestPhrase(phrase));
    }
  }

  /** The start screen is up (the UI marks its root). */
  private prestart(): boolean {
    this.prestartEl ??= this.uiRoot?.querySelector<HTMLElement>('.ejd:not(.race-ui)') ?? null;
    return !!this.prestartEl?.classList.contains('is-prestart');
  }

  /** Photo mode is on (the UI marks its root). */
  private photoMode(): boolean {
    this.prestartEl ??= this.uiRoot?.querySelector<HTMLElement>('.ejd:not(.race-ui)') ?? null;
    return !!this.prestartEl?.classList.contains('is-photo');
  }

  private readInput(ctx: EngineContext, dt: number): MusicInput {
    const s = this.input;
    const services = ctx.services;
    const dragon = services.tryGet('dragon');
    if (dragon) {
      s.mode = dragon.mode;
      s.airspeed = Number.isFinite(dragon.airspeed) ? dragon.airspeed : 0;
      s.agl = Number.isFinite(dragon.agl) ? dragon.agl : 1e3;
      s.climbRate = Number.isFinite(dragon.velocity.y) ? dragon.velocity.y : 0;
      s.flapEffort = Number.isFinite(dragon.flapEffort) ? dragon.flapEffort : 0;
      s.flow = Number.isFinite(dragon.flow ?? 0) ? (dragon.flow ?? 0) : 0;
      s.perched = dragon.perch?.phase === 'perched';
      s.burst = Number.isFinite(dragon.burst ?? 0) ? (dragon.burst ?? 0) : 0;
      this.waterTimer -= dt;
      if (this.waterTimer <= 0) {
        this.waterTimer = WATER_PROBE_S;
        const geo = services.tryGet('geo');
        const p = dragon.position;
        s.overWater = !!geo && Number.isFinite(p.x) && Number.isFinite(p.z) && geo.isWater(p.x, p.z);
      }
    } else {
      s.mode = 'none';
      s.perched = false;
      s.overWater = false;
      s.burst = 0;
    }
    s.hour = Number.isFinite(ctx.time.timeOfDay) ? ctx.time.timeOfDay : 12;
    const env = services.tryGet('env');
    s.night = env && Number.isFinite(env.nightFactor) ? env.nightFactor : 0;
    const weather = services.tryGet('weather');
    s.storm = weather?.current.storm ?? 0;
    s.rain = weather?.current.rain ?? 0;
    s.fog = weather?.current.fog ?? 0;
    const uw = services.tryGet('underwater');
    s.underwater = uw && Number.isFinite(uw.amount) ? uw.amount : 0;
    const zones = services.tryGet('hudZones');
    const raceCtx = zones?.hasContext ? zones.hasContext('race') : this.raceRunning;
    if (raceCtx && !this.raceContext) {
      this.raceRunning = false;
      this.raceDone = false;
    }
    if (!raceCtx) {
      this.raceRunning = false;
      this.raceDone = false;
    }
    this.raceContext = raceCtx;
    s.race = !raceCtx ? 'none' : this.raceRunning ? 'running' : this.raceDone ? 'result' : 'countdown';
    s.moment = this.momentActive;
    s.momentMusic = this.momentMusicId && this.sets.some((x) => x.id === this.momentMusicId) ? this.momentMusicId : null;
    s.photo = this.photoMode();
    s.menu = ctx.time.paused || this.prestart() || s.photo;
    return this.forced ? { ...s, ...this.forced } : s;
  }

  update(ctx: EngineContext, realDt: number): void {
    const player = this.player;
    const audio = this.audio;
    if (!player || !audio || this.disabled) {
      return;
    }
    const now = audio.currentTime;
    const input = this.readInput(ctx, realDt);
    const target = this.rules.update(now, input);
    this.target = target;
    const style = this.musicStyle;
    const sctx = sprinkleContext(input, target.conditions, this.adaptive);
    this.sprinkleCtx = sctx;
    if (!player.isPaused && this.manifestLoaded) {
      if (style !== this.appliedStyle) {
        this.switchStyle(style, now);
      }
      // Sparse style: loops only for races (race-tagged sets) and a moment's own set; otherwise the director holds and
      // lets a set that still plays end on its next phrase.
      const sparse = style === 'sparse';
      const loopTarget = sparse && (target.policy === 'normal' || target.policy === 'always') ? { ...target, policy: 'hold' as const } : target;
      if (sparse && loopTarget !== target && this.director.view.phase === 'playing' && !this.director.forcedSet) {
        this.director.endWindow(now);
      }
      const sets = sparse ? this.sets.filter((x) => x.momentOnly || x.tags.includes('race') || x.id === this.director.forcedSet) : this.sets;
      const world = { sets, isReady: (id: string) => player.isReady(id) };
      // Volume at zero: nothing new starts (no decoding for silence); what plays runs on inaudibly.
      const audible = this.volume > 0.001;
      if (audible || this.director.view.phase === 'playing') {
        this.run(this.director.tick(now, loopTarget, world), target);
      }
      for (const kind of this.pendingCues.splice(0)) {
        this.run(this.director.cue(kind, now), target);
      }
      const phraseReady = (id: string): boolean => player.isPhraseReady(id);
      if (sparse && (audible || this.sprinkles.view.phase === 'playing')) {
        const phrases = this.sprinklePhrases.filter((p) => !player.hasPhraseFailed(p.id));
        this.runOneShots('s', this.sprinkles.tick(now, sctx, { phrases, isReady: phraseReady }), 'main');
      }
      this.momentReq.time = [...sctx.tags].filter((t) => TIME_TAGS.includes(t));
      if (audible || this.momentMusic.playing) {
        const pieces = this.phrases.filter((p) => roleOf(p) === 'moment' && !player.hasPhraseFailed(p.id));
        this.runOneShots('m', this.momentMusic.tick(now, this.momentReq, { phrases: pieces, isReady: phraseReady }), 'moment');
      }
    }
    // The moment piece takes only the menu duck (the moment duck is there to make room for it).
    const wantMomentDuck = target.conditions.includes('menu') ? (MUSIC_RULES.find((r) => r.id === 'menu')?.duck ?? 0) : 0;
    this.momentDuck += (wantMomentDuck - this.momentDuck) * (1 - Math.exp(-realDt / 0.5));
    player.update(target.mix, target.duck, this.momentDuck);
    this.overlay?.update(realDt, this.snapshot());
  }

  private switchStyle(style: MusicStyle, now: number): void {
    const first = this.appliedStyle === null;
    this.appliedStyle = style;
    if (first) {
      return;
    }
    if (style === 'continuous') {
      this.runOneShots('s', this.sprinkles.stopNow(now), 'main');
    }
    console.info(`[music] style: ${style}`);
  }

  private runOneShots(owner: string, cmds: readonly SprinkleCommand[], bus: 'main' | 'moment'): void {
    for (const c of cmds) {
      this.player!.executeOneShot(owner, c, this.phrases, bus);
    }
  }

  private run(cmds: readonly DirectorCommand[], target: MusicTarget): void {
    for (const c of cmds) {
      this.player!.execute(c, this.sets, target.mix);
    }
  }

  snapshot(): MusicSnapshot {
    const v = this.director.view;
    const t = this.target;
    const now = this.audio?.currentTime ?? 0;
    const cur = v.current;
    const pos = cur ? positionAt(cur.grid, now) : null;
    const zero: StemMix = { base: 0, strings: 0, motion: 0, colour: 0, air: 0 };
    let next = '';
    if (v.phase === 'silent') {
      next = v.waiting ? `loading ${v.waiting}` : Number.isFinite(v.silenceUntil) ? `silence ${Math.max(0, v.silenceUntil - now).toFixed(0)} s left` : '';
    } else if (v.endAt !== null) {
      next = `ends in ${Math.max(0, v.endAt - now).toFixed(1)} s`;
    } else if (v.playUntil !== null) {
      next = `window ${Math.max(0, v.playUntil - now).toFixed(0)} s left`;
    }
    const sv = this.sprinkles.view;
    const mv = this.momentMusic.view;
    return {
      style: this.musicStyle,
      styleSource: this.urlStyle ? 'url' : this.storedStyle ? 'setting' : 'auto',
      sprinkle: {
        phase: sv.phase,
        current: sv.current,
        nextIn: sv.phase === 'waiting' && Number.isFinite(sv.dueAt) ? Math.max(0, sv.dueAt - now) : null,
        next: sv.pending,
        last: sv.last,
        hold: sv.hold,
        busy: sv.busy,
        tags: this.sprinkleCtx ? [...this.sprinkleCtx.tags] : [],
        note: sv.note,
        played: sv.played,
        phrases: this.sprinklePhrases.map((p) => p.id),
      },
      moment: { current: mv.current, pending: mv.pending, last: mv.last, note: mv.note, pieces: this.phrases.filter((p) => roleOf(p) === 'moment').map((p) => p.id) },
      set: cur?.set.id ?? null,
      setTitle: cur?.set.credit.title ?? null,
      bar: pos?.bar ?? 0,
      beat: pos?.beat ?? 0,
      bars: cur?.set.bars ?? 0,
      beatsPerBar: cur?.set.beatsPerBar ?? 0,
      bpm: cur?.set.bpm ?? 0,
      phase: v.phase,
      next,
      state: t?.state ?? '—',
      policy: t?.policy ?? 'normal',
      modifiers: t?.modifiers ?? [],
      conditions: t?.conditions ?? [],
      mix: t?.mix ?? zero,
      target: t?.targetMix ?? zero,
      stemsPresent: cur ? stemsOf(cur.set) : [],
      duck: t?.duck ?? 0,
      volume: this.volume,
      adaptive: this.adaptive,
      paused: this.player?.isPaused ?? false,
      sets: this.sets.map((s) => s.id),
      note: v.note,
    };
  }

  private readonly debugApi: MusicDebugApi = this.buildDebugApi();

  private buildDebugApi(): MusicDebugApi {
    const controller = this;
    return {
      get state(): MusicSnapshot {
        return controller.snapshot();
      },
      sets: () => this.sets.map((s) => s.id),
      play: (setId?: string) => {
        const now = this.audio?.currentTime ?? 0;
        this.director.forcedSet = setId ?? this.director.choose(this.target ?? this.rules.update(now, this.input), { sets: this.sets, isReady: () => true })?.id ?? null;
        this.director.skipSilence(now);
      },
      release: () => {
        this.director.forcedSet = null;
      },
      stop: (silenceSec?: number) => {
        this.director.forcedSet = null;
        const now = this.audio?.currentTime ?? 0;
        const gap = silenceSec ?? DEFAULT_DIRECTOR.silenceMinSec + Math.random() * (DEFAULT_DIRECTOR.silenceMaxSec - DEFAULT_DIRECTOR.silenceMinSec);
        for (const c of this.director.stopNow(now, gap)) {
          this.player?.execute(c, this.sets, this.target?.mix ?? { base: 0, strings: 0, motion: 0, colour: 0, air: 0 });
        }
      },
      force: (input: Partial<MusicInput> | null) => {
        this.forced = input;
      },
      setAdaptive: (on: boolean) => this.setAdaptive(on),
      setVolume: (v: number) => this.setVolume(v),
      useTestSets: () => this.useTestSets(),
      phrases: () => this.phrases.map((p) => p.id),
      sprinkle: (phraseId?: string) => {
        const now = this.audio?.currentTime ?? 0;
        this.sprinkles.dueIn(now, 0, this.sprinklePhrases.find((p) => p.id === phraseId) ?? null);
      },
      setStyle: (style: MusicStyle) => this.setMusicStyle(style),
      moment: (info?: MomentMusicInfo & { musicId?: string }) => {
        this.setMomentMusic(true, info?.musicId, info);
      },
      endMoment: () => this.setMomentMusic(false),
      cue: (kind: StingerKind) => {
        this.pendingCues.push(kind);
      },
      pause: () => this.player?.pause(),
      resume: () => {
        const dt = this.player?.resume() ?? 0;
        if (dt > 0) {
          this.director.shift(dt);
          this.sprinkles.shift(dt);
          this.momentMusic.shift(dt);
        }
      },
      rules: MUSIC_RULES,
      conditions: MUSIC_CONDITIONS,
    };
  }

  dispose(): void {
    for (const u of this.unsubscribers.splice(0)) {
      u();
    }
    this.overlay?.dispose();
    this.overlay = null;
    this.player?.dispose();
    this.player = null;
    const g = window as unknown as { __evrenMusic?: MusicDebugApi };
    if (g.__evrenMusic === this.debugApi) {
      delete g.__evrenMusic;
    }
  }
}

/** Creates the controller the audio system hosts. */
export function createMusicController(): MusicController {
  return new MusicController();
}
