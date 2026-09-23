import type { AudioService, EngineContext, System } from '../core/contracts';
import { UpdateOrder } from '../core/contracts';
import { AudioEngine, createAudioFrame, type SoundName } from './audio-engine';
import { AudioAssetLoader, type AudioAssets } from './assets';
import { DragonProbe, readListener } from './dragon-probe';
import { GeoProbe } from './geo-probe';
import { clamp01, finiteOr, smoothstep } from './dsp/math';
import { loadVolume, saveVolume } from './settings';

const TWO_PI = Math.PI * 2;

export interface AudioDebugHandle {
  readonly engine: AudioEngine | null;
  readonly context: AudioContext | null;
  /** Creates/resumes the context without a gesture (works only where autoplay is allowed). */
  unlock(): void;
}

/**
 * Procedural audio system (service 'audio'). Everything is synthesized with WebAudio at runtime.
 * The AudioContext is created on the first user gesture; until then the system costs nothing.
 */
export function createAudioSystem(): System {
  let context: AudioContext | null = null;
  let engine: AudioEngine | null = null;
  let unlocked = false;
  let volume = loadVolume();
  let paused = false;
  const frame = createAudioFrame();
  const dragonProbe = new DragonProbe();
  const geoProbe = new GeoProbe();
  const prevCam = { x: 0, y: 0, z: 0, valid: false };
  let lastFlapEventAt = -1e9;
  let prevFlapPhase = Number.NaN;
  let prevStep = Number.NaN;
  let eventFiring = false;
  let externalRoar = false;
  let dragonReportsFiring = false;
  const gestureEvents = ['pointerdown', 'keydown', 'touchend', 'mousedown'] as const;
  const assets = new AudioAssetLoader();
  let building = false;
  let qualityPreset = 'high';
  const unsubscribers: Array<() => void> = [];

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
        engine = new AudioEngine(ctxRef, a ? { noise: a.noise, impulse: a.impulse } : {});
        engine.setVolume(volume);
        engine.setPaused(paused);
        engine.setQuality(qualityPreset);
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
      (window as unknown as { __ejderhaAudio?: AudioDebugHandle }).__ejderhaAudio = debugHandle;

      const ev = ctx.events;
      unsubscribers.push(
        ev.on('flap', ({ strength }) => {
          lastFlapEventAt = performance.now();
          engine?.flap(strength);
        }),
        ev.on('splash', ({ position, strength }) => engine?.splashAt(position, strength)),
        ev.on('ground-impact', ({ position, speed }) => engine?.landAt(position, speed)),
        ev.on('fire-start', () => {
          eventFiring = true;
        }),
        ev.on('fire-stop', () => {
          eventFiring = false;
        }),
        ev.on('landmark-discovered', () => engine?.play('discover')),
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
      geoProbe.update(geo, lp.x, lp.y, lp.z, realDt, frame.probe);
      const dragonAgl = dragon ? finiteOr(dragon.agl, 1e3) : 1e3;
      const skimTarget =
        dragon && geo && dragonAgl < 14 && dragon.mode !== 'swimming' && geo.isWater(frame.dragon.position.x, frame.dragon.position.z)
          ? (1 - Math.max(0, dragonAgl) / 14) * smoothstep(12, 35, frame.dragon.airspeed)
          : 0;
      frame.dragon.skim = finiteOr(frame.dragon.skim + (skimTarget - frame.dragon.skim) * (1 - Math.exp(-realDt * 6)), 0);

      engine.update(frame);

      // The flight model owns roar gating (cooldown, not while breathing fire or paused) and calls play('roar');
      // the raw input is only a fallback when no flight model is running at all.
      if (!dragon && !externalRoar && !ctx.time.paused && ctx.input.wasPressed('roar')) {
        engine.play('roar');
      }

      if (rig && dragon) {
        const pose = rig.getPose();
        const onSurface = dragon.mode === 'grounded' || dragon.mode === 'swimming';
        frame.dragon.grounded = onSurface;
        frame.dragon.exertion = clamp01(pose.breath);
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
        // Quadruped walk: four footfalls per gait cycle (hind feet land heavier).
        const step = Math.floor(pose.walkPhase / (Math.PI / 2));
        if (dragon.mode === 'grounded' && Number.isFinite(prevStep) && step !== prevStep && pose.walkAmount > 0.15) {
          const k = ((step % 4) + 4) % 4;
          engine.step(pose.walkAmount * (k % 2 === 0 ? 1 : 0.75), k < 2 ? -1 : 1);
        }
        prevStep = Number.isFinite(step) ? step : Number.NaN;
      } else {
        frame.dragon.grounded = dragon?.mode === 'grounded' || dragon?.mode === 'swimming';
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
      engine?.dispose();
      engine = null;
      assets.dispose();
      void context?.close().catch(() => undefined);
      context = null;
      unlocked = false;
      const debugGlobal = window as unknown as { __ejderhaAudio?: AudioDebugHandle };
      if (debugGlobal.__ejderhaAudio === debugHandle) {
        delete debugGlobal.__ejderhaAudio;
      }
    },
  };
}
