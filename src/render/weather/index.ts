/**
 * Weather system (service 'weather'): fog, rain and thunderstorms as player settings, plus the distance softening of
 * the look. Drives the weather HdrPass (aerial blur, ground fog, the sea fog banks of poyraz mornings, lightning
 * flash), rain streaks and lightning bolts; the sky (haze), clouds (coverage), the sea (storm wind, rain rings) and
 * audio (rain bed, thunder) read `current`.
 */
import * as THREE from 'three';
import type { EngineContext, System, WeatherPreset, WeatherService, WeatherSettings } from '../../core/contracts';
import { UpdateOrder } from '../../core/contracts';
import { globalUniforms } from '../../core/uniforms';
import { Lightning } from './lightning';
import { DEFAULT_FAR_BLUR, WEATHER_LABELS, WEATHER_ORDER, WEATHER_PRESETS } from './presets';
import { RainStreaks } from './rain';
import { SEA_FOG, SeaFogModel, type SeaFogInputs } from './sea-fog';
import { WeatherPass } from './weather-pass';

const STORAGE_KEY = 'ejderha.weather.v1';
/** Time constants (s) of the weather transitions and of the look setting. */
const WEATHER_TAU = 2.5;
const LOOK_TAU = 0.25;
const FLASH_COLOR = new THREE.Color(0.74, 0.8, 1.0);
const SETTING_KEYS = ['fog', 'rain', 'storm', 'farBlur'] as const;
const BOLT_COLOR = new THREE.Color(0.8, 0.85, 1.0);

interface Stored {
  preset?: WeatherPreset | 'custom';
  settings?: Partial<WeatherSettings>;
}

function load(): Stored {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === 'object' ? (parsed as Stored) : {};
  } catch {
    return {};
  }
}

function save(value: Stored): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

export function createWeatherSystem(): System {
  const settings: WeatherSettings = { fog: 0, rain: 0, storm: 0, farBlur: DEFAULT_FAR_BLUR };
  const current: WeatherSettings = { ...settings };
  let preset: WeatherPreset | 'custom' = 'clear';
  let ctxRef: EngineContext | null = null;
  const pass = new WeatherPass();
  const rain = new RainStreaks(pass.overlayDepth);
  const lightning = new Lightning(pass.overlayDepth);
  pass.overlay.add(rain.mesh, lightning.mesh);
  const thunderOut: number[] = [];
  const tmpColor = new THREE.Color();
  const drift = new THREE.Vector2();
  // Fog banks on the sea (phase 21 stage 6): poyraz mornings and fog weather; off (zero cost) otherwise.
  const seaFog = new SeaFogModel();
  const seaFogIn: SeaFogInputs = { fog: 0, rain: 0, hours: 12, lodos: 0, u10: 5, humidity: 0.65, day: 1 };
  const seaDrift = new THREE.Vector2();

  function matchPreset(): WeatherPreset | 'custom' {
    for (const name of WEATHER_ORDER) {
      const p = WEATHER_PRESETS[name];
      if (Math.abs(p.fog - settings.fog) < 1e-3 && Math.abs(p.rain - settings.rain) < 1e-3 && Math.abs(p.storm - settings.storm) < 1e-3) {
        return name;
      }
    }
    return 'custom';
  }

  function persist(): void {
    save({ preset, settings: { ...settings } });
  }

  const service: WeatherService = {
    get settings() {
      return settings;
    },
    get current() {
      return current;
    },
    get preset() {
      return preset;
    },
    get flash() {
      return lightning.flash;
    },
    setPreset(p: WeatherPreset) {
      const values = WEATHER_PRESETS[p];
      settings.fog = values.fog;
      settings.rain = values.rain;
      settings.storm = values.storm;
      preset = p;
      persist();
    },
    set(partial: Partial<WeatherSettings>) {
      for (const key of SETTING_KEYS) {
        const v = partial[key];
        if (typeof v === 'number') {
          settings[key] = clamp01(v);
        }
      }
      preset = matchPreset();
      persist();
    },
    cycle() {
      const index = preset === 'custom' ? 0 : WEATHER_ORDER.indexOf(preset);
      const next = WEATHER_ORDER[(index + 1) % WEATHER_ORDER.length];
      service.setPreset(next);
      return next;
    },
  };

  function heightAt(x: number, z: number): number {
    const col = ctxRef?.services.tryGet('collision');
    return col ? col.surfaceHeight(x, z) : 0;
  }

  function applyUrl(params: URLSearchParams): boolean {
    let any = false;
    const named = params.get('weather');
    if (named && named in WEATHER_PRESETS) {
      service.setPreset(named as WeatherPreset);
      any = true;
    }
    const partial: Partial<WeatherSettings> = {};
    for (const [key, param] of [
      ['fog', 'fog'],
      ['rain', 'rain'],
      ['storm', 'storm'],
      ['farBlur', 'farblur'],
    ] as const) {
      if (params.has(param)) {
        partial[key] = Number(params.get(param));
        any = true;
      }
    }
    if (Object.keys(partial).length > 0) {
      service.set(partial);
    }
    return any;
  }

  return {
    name: 'weather',
    // Before the sky (haze) and the clouds (coverage) read `current`.
    order: UpdateOrder.Environment - 5,

    init(ctx) {
      ctxRef = ctx;
      const stored = load();
      if (stored.settings) {
        service.set(stored.settings);
      }
      if (stored.preset && stored.preset !== 'custom' && stored.preset in WEATHER_PRESETS) {
        service.setPreset(stored.preset);
      }
      applyUrl(ctx.debug.params);
      Object.assign(current, settings);
      const forcedSeaFog = ctx.debug.params.get('seafog');
      if (forcedSeaFog !== null && Number.isFinite(Number(forcedSeaFog))) {
        seaFog.forced = Number(forcedSeaFog);
      }
      ctx.pipeline.addHdrPass(pass);
      ctx.services.provide('weather', service);
      if (import.meta.env.DEV || ctx.sandbox || ctx.debug.params.has('weatherdebug')) {
        (window as unknown as { __weather?: unknown }).__weather = {
          service,
          strike: () => lightning.trigger(ctx.camera, Math.max(current.storm, 0.6), heightAt),
          pass,
          rain,
          lightning,
          seaFog,
        };
      }
    },

    update(_dt, ctx) {
      if (ctx.input.wasPressed('weather')) {
        const next = service.cycle();
        ctx.events.emit('toast', { text: `Hava: ${WEATHER_LABELS[next]}` });
      }
      // Weather keeps changing while the game is paused (menu previews).
      const dt = Math.min(0.1, Math.max(0, ctx.time.realDt));
      const kw = 1 - Math.exp(-dt / WEATHER_TAU);
      const kl = 1 - Math.exp(-dt / LOOK_TAU);
      current.fog += (settings.fog - current.fog) * kw;
      current.rain += (settings.rain - current.rain) * kw;
      current.storm += (settings.storm - current.storm) * kw;
      current.farBlur += (settings.farBlur - current.farBlur) * kl;
      for (const key of SETTING_KEYS) {
        if (Math.abs(current[key] - settings[key]) < 1e-3) {
          current[key] = settings[key];
        }
      }

      lightning.update(dt, current.storm, ctx.camera, heightAt, thunderOut);
      if (thunderOut.length > 0) {
        const audio = ctx.services.tryGet('audio');
        for (const s of thunderOut) {
          audio?.play('thunder', s);
        }
      }
      const wind = globalUniforms.uWind.value as THREE.Vector3;
      drift.x -= wind.x * 0.6 * dt;
      drift.y -= wind.z * 0.6 * dt;
      seaDrift.x -= wind.x * SEA_FOG.drift * dt;
      seaDrift.y -= wind.z * SEA_FOG.drift * dt;

      const sea = ctx.services.tryGet('water')?.seaState;
      const env = ctx.services.tryGet('env');
      seaFogIn.fog = current.fog;
      seaFogIn.rain = current.rain;
      seaFogIn.hours = ctx.time.timeOfDay;
      seaFogIn.lodos = sea ? sea.lodos : 0;
      seaFogIn.u10 = sea ? sea.windSpeed : Math.hypot(wind.x, wind.z) * 0.78;
      seaFogIn.humidity = env?.humidity ?? 0.65;
      seaFogIn.day = ctx.time.dayOfYear;
      seaFog.update(dt, seaFogIn);
    },

    preRender(ctx) {
      const env = ctx.services.tryGet('env');
      const night = env ? env.nightFactor : (globalUniforms.uNight.value as number);
      const exposure = Math.max(ctx.pipeline.exposure, 1e-4);
      const horizon = globalUniforms.uFogColor.value as THREE.Color;
      const sun = env ? env.sunColor : (globalUniforms.uSunColor.value as THREE.Color);
      const p = pass.params;

      const fog = current.fog;
      const rainLevel = current.rain;
      // Aerial softening: a radius of ~2.2 px (at 900 px) at 63 % of the curve; thicker air softens sooner.
      p.blurRadius = current.farBlur * 3.4 * (1 + 0.5 * fog + 0.3 * rainLevel);
      p.blurStart = 650 - 300 * fog;
      p.blurScale = 6000 / (1 + 1.5 * fog + 0.6 * rainLevel);
      p.blurEdge = 0.5;
      p.fogDensity = 4e-3 * THREE.MathUtils.smoothstep(fog, 0.3, 1) + 0.5e-3 * rainLevel;
      p.fogHeight = 90 + 30 * rainLevel;
      p.fogPatches = 0.6;
      // A fog bank is a white diffuser: the radiance of a white surface lit by the sun from above and by the sky.
      const sunDir = env ? env.sunDirection : (globalUniforms.uSunDir.value as THREE.Vector3);
      const ambient = env ? env.ambientColor : (globalUniforms.uAmbient.value as THREE.Color);
      p.fogLight
        .copy(sun)
        .multiplyScalar(0.6 * Math.max(sunDir.y, 0.05))
        .add(tmpColor.copy(ambient).multiplyScalar(0.85))
        .multiplyScalar(1 / Math.PI);
      const grey = p.fogLight.r * 0.2126 + p.fogLight.g * 0.7152 + p.fogLight.b * 0.0722;
      p.fogLight.lerp(tmpColor.setRGB(grey, grey, grey), 0.5);
      p.fogSun.copy(sun).multiplyScalar(0.22 * (1 - 0.8 * rainLevel));
      p.fogDrift.copy(drift);
      p.seaFogDensity = seaFog.density;
      p.seaFogHeight = seaFog.height;
      p.seaFogPatches = SEA_FOG.patches;
      p.seaFogDistance = SEA_FOG.maxDistance;
      p.seaFogDrift.copy(seaDrift);

      const flash = lightning.flash * (0.5 + 0.5 * night);
      p.flashSky.copy(FLASH_COLOR).multiplyScalar((2.2 * flash) / exposure);
      p.flashNear.copy(FLASH_COLOR).multiplyScalar((0.3 * flash) / exposure);
      p.flashDir.copy(lightning.strike.glow).sub(ctx.camera.position).normalize();
      lightning.setColor(tmpColor.copy(BOLT_COLOR).multiplyScalar((30 * (0.6 + 0.4 * night)) / exposure));

      lightning.setFog(p.fogDensity, p.fogHeight);
      tmpColor.copy(horizon).multiplyScalar(0.9).add(p.flashSky);
      const wind = env ? env.wind : (globalUniforms.uWind.value as THREE.Vector3);
      rain.update(ctx.time.realDt, ctx.camera, rainLevel, wind, tmpColor);

      pass.overlayActive = rain.mesh.visible || lightning.visible;
      pass.enabled = pass.active;
    },

    dispose() {
      ctxRef?.pipeline.removeHdrPass(pass);
      pass.dispose();
      rain.dispose();
      lightning.dispose();
    },
  };
}
