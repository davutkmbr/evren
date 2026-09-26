import type { AudioService, EngineContext, System } from '../core/contracts';
import { UpdateOrder } from '../core/contracts';
import { feelContext } from '../core/speed-feel';
import { AudioEngine, createAudioFrame, type SoundName } from './audio-engine';
import { AudioAssetLoader, type AudioAssets } from './assets';
import { DragonProbe, readListener } from './dragon-probe';
import { GeoProbe } from './geo-probe';
import { clamp01, finiteOr, smoothstep } from './dsp/math';
import { loadVolume, saveVolume } from './settings';
import { createMusicController } from './music';
import { footfallOffsets } from '../core/gait';

const TWO_PI = Math.PI * 2;

function copyFinite(src: { x: number; y: number; z: number }, dst: { x: number; y: number; z: number }): void {
  if (Number.isFinite(src.x) && Number.isFinite(src.y) && Number.isFinite(src.z)) {
    dst.x = src.x;
    dst.y = src.y;
    dst.z = src.z;
  }
}
/**
 * The flight model marks the nostril bubbles of an under-water dragon as tiny splashes where they reach the surface
 * (phase 21 stage 3, PLUNGE.bubbleStrength 0.05); at or below this strength, with the dragon under water, they play
 * as bubbles instead of a splash.
 */
const BUBBLE_SPLASH_MAX = 0.08;
/**
 * Swimming (phase 21 stage 5 v2): the rig's swim phase (DragonPose.swimPhase) puts the left wing's catch at 0 and the
 * right one's at pi (the animator's convention); the power stroke lasts this share of the cycle (SWIM_RIG.paddlePower).
 */
const SWIM_POWER_SHARE = 0.45;
/** The swimming posture weight (pose.swim) above which strokes are heard (the take-off run fades it below). */
const SWIM_STROKE_MIN = 0.6;

export interface AudioDebugHandle {
  readonly engine: AudioEngine | null;
  readonly context: AudioContext | null;
  /** Creates/resumes the context without a gesture (works only where autoplay is allowed). */
  unlock(): void;
}

/**
 * Audio system (service 'audio'): WebAudio synthesis plus the recorded CC0 sounds in public/audio/
 * (src/audio/samples.ts). The AudioContext is created on the first user gesture; until then the system only builds the
 * noise bank in a worker and fetches and decodes the flight recordings.
 */
export function createAudioSystem(): System {
  let context: AudioContext | null = null;
  let engine: AudioEngine | null = null;
  let unlocked = false;
  let volume = loadVolume();
  let paused = false;
  /** Coastal ambience lift requested by a playing moment (src/moments), 0..1. */
  let ambienceLift = 0;
  /** The probe's own coast / urban values: the geo probe samples only a few times a second, the lift is re-applied. */
  const rawProbe = { coast: 0, urban: 0 };
  const frame = createAudioFrame();
  const dragonProbe = new DragonProbe();
  const geoProbe = new GeoProbe();
  const prevCam = { x: 0, y: 0, z: 0, valid: false };
  let lastFlapEventAt = -1e9;
  let prevFlapPhase = Number.NaN;
  let prevCycle = Number.NaN;
  const footfall = [0, 0.5, 0.25, 0.75];
  let prevSwimPhase = Number.NaN;
  /** Smoothed stroke frequency (Hz) from the swim phase's rate. */
  let swimFreq = 0.5;
  let eventFiring = false;
  let externalRoar = false;
  let dragonReportsFiring = false;
  const gestureEvents = ['pointerdown', 'keydown', 'touchend', 'mousedown'] as const;
  const assets = new AudioAssetLoader();
  let building = false;
  let qualityPreset = 'high';
  const unsubscribers: Array<() => void> = [];
  /** Adaptive music (src/audio/music): plays on the master bus's music input once the engine exists. */
  const music = createMusicController();

  const removeGestureListeners = (): void => {
    for (const e of gestureEvents) {
      window.removeEventListener(e, unlock, true);
    }
  };

  function unlock(): void {
    if (!context) {
      try {
        context = new AudioContext({ latencyHint: 'interactive' });
      } catch (err) {
        console.warn('[audio] WebAudio unavailable', err);
        removeGestureListeners();
        return;
      }
      const ctxRef = context;
      ctxRef.onstatechange = () => {
        unlocked = ctxRef.state === 'running';
      };
      building = true;
      const startEngine = (a: AudioAssets | null): void => {
        if (context !== ctxRef) {
          return;
        }
        // Without pre-built assets the engine generates its noise bank and reverb synchronously (~60 ms, once).
        engine = new AudioEngine(ctxRef, a ? { noise: a.noise, impulse: a.impulse, samples: a.samples } : {});
        engine.setVolume(volume);
        engine.setPaused(paused);
        engine.setQuality(qualityPreset);
        music.attach(ctxRef, engine.bus.music);
      };
      void assets
        .load(ctxRef)
        .then(startEngine, (err: unknown) => {
          if (context === ctxRef) {
            console.warn('[audio] background asset build failed, generating on the main thread', err);
            startEngine(null);
          }
        })
        .catch((err: unknown) => console.warn('[audio] audio engine failed to start', err))
        .finally(() => {
          building = false;
        });
    }
    if (context.state === 'running') {
      unlocked = true;
      removeGestureListeners();
      return;
    }
    context.resume().then(
      () => {
        unlocked = context?.state === 'running';
        if (unlocked) {
          removeGestureListeners();
        }
      },
      () => undefined,
    );
  }

  let suspendedByVisibility = false;
  const onVisibility = (): void => {
    if (!context || context.state === 'closed') {
      return;
    }
    if (document.hidden) {
      if (context.state === 'running') {
        suspendedByVisibility = true;
        void context.suspend().catch(() => undefined);
      }
    } else if (suspendedByVisibility) {
      suspendedByVisibility = false;
      void context.resume().catch(() => undefined);
    }
  };

  const service: AudioService = {
    play(name: SoundName, vol?: number): void {
      if (name === 'roar') {
        externalRoar = true;
      }
      engine?.play(name, vol ?? 1);
    },
    get unlocked(): boolean {
      return unlocked;
    },
    setMasterVolume(v: number): void {
      volume = Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
      saveVolume(volume);
      engine?.setVolume(volume);
    },
    get masterVolume(): number {
      return volume;
    },
    unlock,
    setAmbienceLift(amount: number): void {
      ambienceLift = clamp01(finiteOr(amount, 0));
    },
    momentCue(cue, position, vol, panFrom): void {
      engine?.momentCue(cue, position, vol, panFrom);
    },
    bondCue(cue, vol): void {
      engine?.bondCue(cue, vol ?? 1);
    },
    dolphinCue(cue, position, vol): void {
      engine?.dolphinCue(cue, position, vol ?? 1);
    },
    setMomentBed(amount: number): void {
      engine?.setMomentBed(amount);
    },
    setMusicVolume(v: number): void {
      music.setVolume(v);
    },
    get musicVolume(): number {
      return music.musicVolume;
    },
    setAdaptiveMusic(on: boolean): void {
      music.setAdaptive(on);
    },
    get adaptiveMusic(): boolean {
      return music.adaptiveMusic;
    },
    setMusicStyle(style: 'sparse' | 'continuous'): void {
      music.setMusicStyle(style);
    },
    get musicStyle(): 'sparse' | 'continuous' {
      return music.musicStyle;
    },
    setMomentMusic(active: boolean, musicId?: string, info?: { category?: string; mood?: readonly string[] }): void {
      music.setMomentMusic(active, musicId, info);
    },
  };

  const debugHandle: AudioDebugHandle = {
    get engine() {
      return engine;
    },
    get context() {
      return context;
    },
    unlock,
  };

  return {
    name: 'audio',
    order: UpdateOrder.Audio,

    init(ctx: EngineContext): void {
      ctx.services.provide('audio', service);
      paused = ctx.time.paused;
      qualityPreset = ctx.quality.settings.preset;
      unsubscribers.push(
        ctx.quality.onChange((settings) => {
          qualityPreset = settings.preset;
          engine?.setQuality(qualityPreset);
        }),
      );
      assets.preload();
      for (const e of gestureEvents) {
        window.addEventListener(e, unlock, true);
      }
      document.addEventListener('visibilitychange', onVisibility);
      (window as unknown as { __evrenAudio?: AudioDebugHandle }).__evrenAudio = debugHandle;
      music.init(ctx);

      const ev = ctx.events;
      unsubscribers.push(
        ev.on('flap', ({ strength }) => {
          lastFlapEventAt = performance.now();
          engine?.flap(strength);
        }),
        ev.on('splash', ({ position, strength }) => {
          if (strength <= BUBBLE_SPLASH_MAX && ctx.services.tryGet('dragon')?.mode === 'underwater') {
            engine?.bubblesAt(position, strength);
          } else {
            engine?.splashAt(position, strength);
          }
        }),
        ev.on('ground-impact', ({ position, speed }) => engine?.landAt(position, speed)),
        ev.on('fire-start', () => {
          eventFiring = true;
        }),
        ev.on('fire-stop', () => {
          eventFiring = false;
        }),
        ev.on('landmark-discovered', () => engine?.play('discover')),
        ev.on('flow-moment', ({ kind }) => {
          const d = ctx.services.tryGet('dragon');
          engine?.flowMoment(kind, feelContext(!!d?.racing, d?.flow ?? 0));
        }),
        ev.on('chain-link', ({ link, dv }) => {
          const d = ctx.services.tryGet('dragon');
          engine?.chainLink(link, dv, feelContext(!!d?.racing, d?.flow ?? 0));
        }),
        ev.on('pause', ({ paused: p }) => {
          paused = p;
          engine?.setPaused(p);
        }),
      );
    },

    update(_dt: number, ctx: EngineContext): void {
      if (!engine) {
        return;
      }
      const realDt = Math.min(0.25, Math.max(0, finiteOr(ctx.time.realDt, 0)));
      frame.dt = realDt;
      frame.paused = ctx.time.paused;
      const weather = ctx.services.tryGet('weather');
      frame.rain = weather?.current.rain ?? 0;
      frame.storm = weather?.current.storm ?? 0;
      const underwater = ctx.services.tryGet('underwater');
      frame.underwater = underwater ? clamp01(finiteOr(underwater.amount, 0)) : 0;
      frame.underwaterDepth = underwater ? Math.max(0, finiteOr(underwater.depth, 0)) : 0;

      // The camera system has already placed the camera this frame; refresh its world matrix before reading.
      // A non-finite camera (one glitched frame, e.g. during a camera-mode switch) keeps the last good listener pose.
      ctx.camera.updateMatrixWorld();
      const listenerOk = readListener(ctx.camera, frame.listener);
      const lp = frame.listener.position;
      if (listenerOk) {
        if (prevCam.valid && realDt > 0) {
          const v = Math.hypot(lp.x - prevCam.x, lp.y - prevCam.y, lp.z - prevCam.z) / realDt;
          if (v < 400) {
            frame.listenerSpeed += (v - frame.listenerSpeed) * (1 - Math.exp(-realDt * 3));
          }
        }
        prevCam.x = lp.x;
        prevCam.y = lp.y;
        prevCam.z = lp.z;
        prevCam.valid = true;
      }

      const services = ctx.services;
      frame.cameraMode = services.tryGet('cameraRig')?.mode ?? 'third';
      const dragon = services.tryGet('dragon');
      const rig = services.tryGet('rig');
      dragonProbe.update(dragon, rig, realDt, frame.dragon);
      if (dragon?.firing) {
        dragonReportsFiring = true;
      }
      frame.dragon.firing = dragonReportsFiring ? !!dragon?.firing : eventFiring;

      const env = services.tryGet('env');
      frame.ambientWind = env ? finiteOr(env.wind.length(), 4) : 4;
      frame.probe.night = env ? clamp01(env.nightFactor) : 0;
      const geo = services.tryGet('geo');
      frame.probe.coast = rawProbe.coast;
      frame.probe.urban = rawProbe.urban;
      geoProbe.update(geo, lp.x, lp.y, lp.z, realDt, frame.probe);
      rawProbe.coast = frame.probe.coast;
      rawProbe.urban = frame.probe.urban;
      // A calm moment (src/moments): the shore comes forward, the city steps back (the ambience smooths the change).
      frame.probe.coast += (1 - frame.probe.coast) * 0.6 * ambienceLift;
      frame.probe.urban *= 1 - 0.45 * ambienceLift;
      const dragonAgl = dragon ? finiteOr(dragon.agl, 1e3) : 1e3;
      // The sea's reaction to low flight (phase 21 stage 2): the same numbers the water surface and the sprays use.
      const low = services.tryGet('lowFlight');
      const fd = frame.dragon;
      if (low && low.active && dragon) {
        fd.downwash = clamp01(finiteOr(low.downwash + 0.5 * low.edgeSpray, 0));
        fd.wake = clamp01(finiteOr(Math.max(low.wake, 0.5 * low.vortex), 0));
        fd.steam = clamp01(finiteOr(low.steam, 0));
        copyFinite(low.surfacePoint, fd.seaPoint);
        copyFinite(low.steamPoint, fd.steamPoint);
      } else {
        fd.downwash = 0;
        fd.wake = 0;
        fd.steam = 0;
      }
      const skimLow =
        dragon && geo && dragonAgl < 14 && dragon.mode !== 'swimming' && dragon.mode !== 'underwater' && geo.isWater(frame.dragon.position.x, frame.dragon.position.z)
          ? (1 - Math.max(0, dragonAgl) / 14) * smoothstep(12, 35, frame.dragon.airspeed)
          : 0;
      // The airy spray hiss of the wind voice follows the wake too (a wave-relative contact the agl misses in a swell).
      const skimTarget = Math.max(skimLow, fd.wake);
      frame.dragon.skim = finiteOr(frame.dragon.skim + (skimTarget - frame.dragon.skim) * (1 - Math.exp(-realDt * 6)), 0);

      engine.update(frame);
      music.update(ctx, realDt);

      // The flight model owns roar gating (cooldown, not while breathing fire or paused) and calls play('roar');
      // the raw input is only a fallback when no flight model is running at all.
      if (!dragon && !externalRoar && !ctx.time.paused && ctx.input.wasPressed('roar')) {
        engine.play('roar');
      }

      if (rig && dragon) {
        const pose = rig.getPose();
        const onSurface = dragon.mode === 'grounded' || dragon.mode === 'swimming' || dragon.mode === 'underwater';
        // Breathing is audible standing or swimming, not while holding breath under water.
        frame.dragon.grounded = onSurface && dragon.mode !== 'underwater';
        frame.dragon.exertion = clamp01(pose.breath);
        frame.dragon.skid = dragon.mode === 'grounded' ? clamp01(pose.skid ?? 0) : 0;
        frame.dragon.groundSpeed = Math.hypot(dragon.velocity.x, dragon.velocity.z);
        // Swimming: the water bed follows the floating posture; each wing's catch (its phase crossing 0 / pi) plays its
        // stroke, as strong as the stroke and as long as its power stroke.
        const swim = dragon.mode === 'swimming' ? clamp01(finiteOr(pose.swim ?? 0, 0)) : 0;
        frame.dragon.swimming = swim;
        const swimPhase = pose.swimPhase ?? Number.NaN;
        if (swim > 0 && Number.isFinite(swimPhase) && Number.isFinite(prevSwimPhase) && !ctx.time.paused) {
          let dp = swimPhase - prevSwimPhase;
          if (dp < -Math.PI) {
            dp += TWO_PI;
          }
          if (dp >= 0 && dp < 1 && realDt > 0) {
            swimFreq += (dp / TWO_PI / realDt - swimFreq) * (1 - Math.exp(-realDt * 2));
            const power = SWIM_POWER_SHARE / Math.max(0.15, swimFreq);
            for (const [catchAt, side] of [
              [0, -1],
              [Math.PI, 1],
            ] as const) {
              // Crossing catchAt going forward (the phase wraps at 2 pi).
              const a = (((prevSwimPhase - catchAt) % TWO_PI) + TWO_PI) % TWO_PI;
              if (a + dp >= TWO_PI && swim > SWIM_STROKE_MIN) {
                engine.swimStroke(clamp01(finiteOr(pose.swimStroke ?? 0, 0)), side, power);
              }
            }
          }
        }
        prevSwimPhase = swim > 0 ? swimPhase : Number.NaN;
        // Fallback when the flight model does not emit 'flap' events: follow the rig's wing-beat phase. The phase may
        // be wrapped to [0, 2pi) (the flight model does) or continuous (the contract allows both): detect either.
        const phase = pose.flapPhase;
        if (Number.isFinite(phase)) {
          const newCycle = Number.isFinite(prevFlapPhase) && (phase < prevFlapPhase - Math.PI || Math.floor(phase / TWO_PI) !== Math.floor(prevFlapPhase / TWO_PI));
          if (newCycle && !onSurface && performance.now() - lastFlapEventAt > 4000 && pose.flapAmplitude > 0.45 && pose.wingSpread > 0.4) {
            engine.flap(Math.min(1, pose.flapAmplitude));
          }
          prevFlapPhase = phase;
        }
        // Footsteps: one per foot as it plants, with the rig's footfall timing (walk, trot, gallop). Hind feet land
        // heavier; faster gaits land harder; the wrists only step while they are fore feet; a skid digs in instead.
        const cycle = pose.walkPhase / TWO_PI;
        if (dragon.mode === 'grounded' && Number.isFinite(cycle) && Number.isFinite(prevCycle) && pose.walkAmount > 0.15) {
          const gait = pose.gait ?? 0;
          footfallOffsets(gait, footfall);
          const fore = pose.foreGround ?? 1;
          const skid = pose.skid ?? 0;
          const base = pose.walkAmount * (0.85 + 0.2 * gait) * (1 - 0.6 * skid);
          for (let i = 0; i < 4; i++) {
            if (Math.floor(cycle + footfall[i]) === Math.floor(prevCycle + footfall[i])) {
              continue;
            }
            const hind = i < 2;
            if (!hind && fore < 0.5) {
              continue;
            }
            engine.step(Math.min(1.2, base * (hind ? 1 : 0.75)), i % 2 === 0 ? -1 : 1);
          }
        }
        prevCycle = Number.isFinite(cycle) && dragon.mode === 'grounded' ? cycle : Number.NaN;
      } else {
        frame.dragon.grounded = dragon?.mode === 'grounded' || dragon?.mode === 'swimming';
        frame.dragon.skid = 0;
        frame.dragon.swimming = 0;
      }
    },

    pending(): number {
      return assets.pending + (building ? 1 : 0);
    },

    dispose(): void {
      for (const u of unsubscribers.splice(0)) {
        u();
      }
      removeGestureListeners();
      document.removeEventListener('visibilitychange', onVisibility);
      music.dispose();
      engine?.dispose();
      engine = null;
      assets.dispose();
      void context?.close().catch(() => undefined);
      context = null;
      unlocked = false;
      const debugGlobal = window as unknown as { __evrenAudio?: AudioDebugHandle };
      if (debugGlobal.__evrenAudio === debugHandle) {
        delete debugGlobal.__evrenAudio;
      }
    },
  };
}
