/**
 * Adaptive music (`.docs/audio/music-system.md`): the game side. Hosted by the audio system (src/audio/index.ts),
 * which owns the AudioContext and the master bus.
 *
 *   manifest.ts  data format + validation (public/audio/music/manifest.json)
 *   rules.ts     game state → stem mix, duck, set preferences (conditions with hysteresis, rules table, smoothing)
 *   director.ts  which set plays when: play / silence cycle, bar / phrase-quantised changes, race / moment overrides
 *   clock.ts     bar-grid math
 *   player.ts    WebAudio: on-demand decoding, sample-locked stem loops, fades, stingers
 *   test-sets.ts DEV-ONLY procedural test sets (`?music=test`)
 *
 * Every frame this controller reads the services into a MusicInput, runs the rules and the director on the
 * AudioContext clock and hands the commands and the smoothed mix to the player.
 *
 * Debug: `?music=debug` overlay, `?music=test` procedural test sets (combine: `?music=test,debug`), `?music=off`
 * no music; `window.__evrenMusic` (state, play / stop / force a set or a state, adaptive on/off, pause / resume).
 */
import type { EngineContext } from '../../core/contracts';
import { positionAt } from './clock';
import { DEFAULT_DIRECTOR, MusicDirector, type DirectorCommand } from './director';
import { EMPTY_MANIFEST, MUSIC_BASE, stemsOf, validateManifest, type MusicSetDef, type StemRole, type StingerKind } from './manifest';
import { MusicPlayer } from './player';
import { idleInput, MUSIC_CONDITIONS, MUSIC_RULES, MusicRulesEngine, type MusicInput, type MusicPolicy, type MusicTarget, type StemMix } from './rules';
import { loadAdaptiveMusic, loadMusicVolume, saveAdaptiveMusic, saveMusicVolume } from './settings';
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
  /** Loads the procedural DEV test sets (same as ?music=test). */
  useTestSets(): Promise<void>;
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
  private sets: MusicSetDef[] = [];
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

  setMomentMusic(active: boolean, musicId?: string): void {
    this.momentActive = active;
    this.momentMusicId = active ? (musicId ?? null) : null;
  }

  /* ---------------- lifecycle ---------------- */

  init(ctx: EngineContext): void {
    this.uiRoot = ctx.uiRoot;
    const modes = (ctx.debug.params.get('music') ?? '').split(/[\s,+]+/).filter(Boolean);
    this.disabled = modes.includes('off');
    this.testMode = modes.includes('test');
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
    }
    this.manifestLoaded = true;
  }

  async useTestSets(): Promise<void> {
    const mod = await import('./test-sets');
    this.testMode = true;
    this.director.stopNow(this.audio?.currentTime ?? 0, 0);
    this.player?.stopAll(0.5);
    this.sets = [...mod.TEST_SETS];
    this.manifestLoaded = true;
    await this.registerTestLoaders();
    console.info(`[music] DEV test sets: ${this.sets.map((s) => s.id).join(', ')}`);
  }

  private async registerTestLoaders(): Promise<void> {
    if (!this.player) {
      return;
    }
    const mod = await import('./test-sets');
    for (const s of mod.TEST_SETS) {
      this.player.loaders.set(s.id, (set) => mod.renderTestSet(set));
    }
  }

  /** The start screen is up (the UI marks its root). */
  private prestart(): boolean {
    this.prestartEl ??= this.uiRoot?.querySelector<HTMLElement>('.ejd:not(.race-ui)') ?? null;
    return !!this.prestartEl?.classList.contains('is-prestart');
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
    }
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
    s.menu = ctx.time.paused || this.prestart();
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
    if (!player.isPaused && this.manifestLoaded) {
      const world = { sets: this.sets, isReady: (id: string) => player.isReady(id) };
      // Volume at zero: nothing new starts (no decoding for silence); what plays runs on inaudibly.
      if (this.volume > 0.001 || this.director.view.phase === 'playing') {
        this.run(this.director.tick(now, target, world), target);
      }
      for (const kind of this.pendingCues.splice(0)) {
        this.run(this.director.cue(kind, now), target);
      }
    }
    player.update(target.mix, target.duck);
    this.overlay?.update(realDt, this.snapshot());
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
    return {
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
      cue: (kind: StingerKind) => {
        this.pendingCues.push(kind);
      },
      pause: () => this.player?.pause(),
      resume: () => {
        const dt = this.player?.resume() ?? 0;
        if (dt > 0) {
          this.director.shift(dt);
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
