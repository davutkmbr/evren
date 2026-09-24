import * as THREE from 'three';
import { weatherCloudCoverage } from '../weather/presets';
import type { EngineContext, System } from '../../core/contracts';
import { UpdateOrder } from '../../core/contracts';
import type { QualitySettings } from '../../core/quality';
import { globalUniforms } from '../../core/uniforms';
import { CityGlowMap } from './city-glow';
import { CloudPass } from './cloud-pass';
import { BlueNoiseTexture } from './blue-noise';
import {
  createCloudUniforms,
  KEY_LIGHT_GAIN_DAY,
  KEY_LIGHT_GAIN_NIGHT,
  registerCloudShadowGlobals,
  type CloudUniformSet,
} from './cloud-uniforms';
import { CLOUD_CONSTANTS as C, CLOUD_QUALITY_LEVELS, type CloudQualityLevel } from './config';
import { FullscreenQuad } from './fullscreen';
import { CloudLighting, type CloudLightInputs } from './lighting';
import { CloudShadowMap } from './shadow-map';
import { bakeCloudTextures, type CloudTextures } from './textures';

/** Lattice period (m) of a 3-4-5 rotated lookup of a texture tiling every `period` meters. */
const rotatedPeriod = (period: number): number => period * 5;
const REGIONAL_PERIOD = rotatedPeriod(C.weatherPeriod / 0.371);
const CIRRUS_WRAP = rotatedPeriod(C.cirrusPeriod);

function wrap(v: number, period: number): number {
  const r = v % period;
  return r < 0 ? r + period : r;
}

/** Debug/sandbox handle (not part of the public System contract). */
export interface CloudDebugHandle {
  uniforms: CloudUniformSet;
  lighting: CloudLighting;
  /** Coverage bias (-0.5 .. 0.5); 0 = late-September fair weather. */
  setCoverage(bias: number): void;
  /**
   * Finds the densest cumulus (by weather coverage) within `radius` of (x, z) via a one-time GPU readback.
   * Returns world x/z of its centre and the approximate top height factor, or null before init.
   */
  findCloud(x: number, z: number, radius: number): { x: number; z: number; coverage: number; height: number } | null;
  setEnabled(enabled: boolean): void;
  /** Debug: multiplier on the key-light gain (0 isolates the ambient term). */
  setKeyGainScale(scale: number): void;
  /** Debug: synchronous timing of the cloud pass and shadow map (ms per frame, GPU-bound wall time). */
  benchmark(iterations: number): { pass: number; shadow: number; march: number };
  /** Debug: channel averages of the raw march buffer (?clouddebug=cost: probes, density evals, light samples). */
  rawAverage(): number[];
  /** Debug: [r, g, b, T, cloudKm, sceneKm, frontKm, sigmaFront, age] of the cloud buffer at screen uv (v = 0 bottom). */
  probe(u: number, v: number): number[];
  /** Debug: shadow map contents (grayscale, row 0 = v 0) and its region [centreX, centreZ, extent]. */
  shadowReadback(): { size: number; data: Uint8Array; region: number[] } | null;
}

export function createCloudSystemWithHandle(): { system: System; handle: CloudDebugHandle } {
  const shadowGlobals = registerCloudShadowGlobals();
  const shared = createCloudUniforms();
  const lighting = new CloudLighting();
  const glow = new CityGlowMap();
  const lightInputs: CloudLightInputs = {
    sunDir: new THREE.Vector3(0, 1, 0),
    sunColor: new THREE.Color(),
    moonDir: new THREE.Vector3(0, 1, 0),
    night: 0,
  };
  let blueNoise: BlueNoiseTexture | null = null;
  let quad: FullscreenQuad | null = null;
  let textures: CloudTextures | null = null;
  let pass: CloudPass | null = null;
  let shadowMap: CloudShadowMap | null = null;
  let engineFrame = 0;
  let windX = 0;
  let windZ = 0;
  let cirrusX = 0;
  let cirrusZ = 0;
  let evolve = 0;
  let unsubscribeQuality: (() => void) | null = null;
  let rendererRef: THREE.WebGLRenderer | null = null;
  let ctxRef: EngineContext | null = null;
  let weatherPixels: Uint8Array | null = null;
  let disposed = false;
  let keyGainScale = 1;
  let appliedLevel: CloudQualityLevel | null | undefined;
  /** Coverage bias set through the debug handle; the weather adds its own on top every frame. */
  let coverageBase = 0;

  const applyQuality = (settings: QualitySettings): void => {
    if (!pass || !shadowMap) {
      return;
    }
    const q = settings.cloudQuality;
    const level = q === 0 ? null : CLOUD_QUALITY_LEVELS[q];
    // Other modules change unrelated settings at runtime: only a different cloud level may touch the history.
    if (level === appliedLevel) {
      return;
    }
    appliedLevel = level;
    if (!level) {
      pass.enabled = false;
      shadowMap.disable();
      return;
    }
    pass.setLevel(level);
    pass.enabled = true;
    shadowMap.setLevel(level);
  };

  const readEnvironment = (ctx: EngineContext): void => {
    const env = ctx.services.tryGet('env');
    lightInputs.sunDir.copy(globalUniforms.uSunDir.value as THREE.Vector3).normalize();
    lightInputs.sunColor.copy(globalUniforms.uSunColor.value as THREE.Color);
    lightInputs.moonDir.copy(globalUniforms.uMoonDir.value as THREE.Vector3).normalize();
    lightInputs.night = globalUniforms.uNight.value as number;
    if (env && env.nightFactor > lightInputs.night) {
      lightInputs.night = env.nightFactor;
    }
  };

  const system: System = {
    name: 'clouds',
    order: UpdateOrder.Environment + 10,

    async init(ctx) {
      const renderer = ctx.renderer;
      rendererRef = renderer;
      ctxRef = ctx;
      quad = new FullscreenQuad();
      blueNoise = new BlueNoiseTexture();
      textures = bakeCloudTextures(renderer, quad);
      shared.uCloudWeather.value = textures.weather;
      shared.uCloudBaseNoise.value = textures.base;
      shared.uCloudDetailNoise.value = textures.detail;
      shared.uCloudCirrus.value = textures.cirrus;
      shared.uCloudGlow.value = glow.texture;

      const level = CLOUD_QUALITY_LEVELS[ctx.quality.settings.cloudQuality === 0 ? 2 : ctx.quality.settings.cloudQuality];
      pass = new CloudPass(quad, shared, level, blueNoise);
      shadowMap = new CloudShadowMap(quad, shared, shadowGlobals);
      applyQuality(ctx.quality.settings);
      unsubscribeQuality = ctx.quality.onChange(applyQuality);
      ctx.pipeline.addHdrPass(pass);

      const debugMode = ctx.debug.params.get('clouddebug');
      if (debugMode) {
        (window as unknown as { __cloudsDebug?: CloudDebugHandle }).__cloudsDebug = handle;
        for (const name of debugMode.split(',')) {
          if (name && name !== '1') {
            pass.setDebugDefine(name);
          }
        }
      }

      readEnvironment(ctx);
      lighting.update(lightInputs);
      try {
        await renderer.compileAsync(quad.compileScene([...pass.materials, shadowMap.material]), quad.camera);
      } catch {
        /* programs compile lazily on first use */
      }
      void ctx.services.when('geo').then((geo) => {
        if (!disposed) {
          glow.start(geo);
        }
      });
    },

    update(dt, ctx) {
      engineFrame = ctx.time.frame;
      glow.step();
      const weather = ctx.services.tryGet('weather');
      shared.uCloudShape.value.x = coverageBase + (weather ? weatherCloudCoverage(weather.current) : 0);

      const wind = globalUniforms.uWind.value as THREE.Vector3;
      windX += wind.x * C.windScale * dt;
      windZ += wind.z * C.windScale * dt;
      cirrusX += wind.x * C.cirrusWindScale * dt;
      cirrusZ += wind.z * C.cirrusWindScale * dt;
      evolve += C.evolveSpeed * dt;
      shared.uCloudWind.value.set(
        wrap(windX, C.weatherPeriod),
        wrap(windZ, C.weatherPeriod),
        wrap(evolve, C.baseNoisePeriod),
        wrap(evolve * 2, C.detailNoisePeriod),
      );
      shared.uCloudWind2.value.set(wrap(windX, REGIONAL_PERIOD), wrap(windZ, REGIONAL_PERIOD), wrap(cirrusX, CIRRUS_WRAP), wrap(cirrusZ, CIRRUS_WRAP));

      readEnvironment(ctx);
      lighting.update(lightInputs);
      const keyDir = globalUniforms.uKeyLightDir?.value as THREE.Vector3 | undefined;
      const atmo = globalUniforms.uAtmoState?.value as THREE.Vector4 | undefined;
      if (keyDir && atmo && atmo.y > 0.5) {
        shared.uCloudLightDir.value.copy(keyDir).normalize();
      } else {
        shared.uCloudLightDir.value.copy(lighting.lightDir);
      }
      shared.uCloudLightColor.value.copy(lighting.lightColor);
      shared.uCloudAmbientTop.value.copy(lighting.ambientTop);
      shared.uCloudAmbientBottom.value.copy(lighting.ambientBottom);
      shared.uCloudGlowColor.value.copy(lighting.glowColor);
      shared.uCloudMisc.value.x = lighting.earthShadowAltitude;
      // Rain clouds are thick and dark underneath: less sunlight comes through the deck than the sky around it gets.
      const rainDark = weather ? 1 - 0.5 * weather.current.rain - 0.15 * weather.current.storm : 1;
      shared.uCloudMisc.value.w =
        keyGainScale * rainDark * THREE.MathUtils.lerp(KEY_LIGHT_GAIN_DAY, KEY_LIGHT_GAIN_NIGHT, THREE.MathUtils.clamp(lightInputs.night, 0, 1));
    },

    preRender(ctx) {
      if (!shadowMap || !pass?.enabled) {
        return;
      }
      shadowMap.update(ctx.renderer, ctx.camera, globalUniforms.uSunDir.value as THREE.Vector3, lightInputs.night);
    },

    pending() {
      return (glow.pending ? 1 : 0) + (blueNoise?.pending ? 1 : 0) + (pass?.isWarmingUp(engineFrame) ? 1 : 0);
    },

    dispose() {
      disposed = true;
      unsubscribeQuality?.();
      if (pass) {
        ctxRef?.pipeline.removeHdrPass(pass);
      }
      shadowMap?.disable();
      pass?.dispose();
      blueNoise?.dispose();
      shadowMap?.dispose();
      textures?.dispose();
      quad?.dispose();
      glow.dispose();
    },
  };

  const handle: CloudDebugHandle = {
    uniforms: shared,
    lighting,
    setCoverage(bias) {
      coverageBase = bias;
      shared.uCloudShape.value.x = bias;
    },
    benchmark(iterations) {
      if (!pass || !rendererRef || !shadowMap || !ctxRef) {
        return { pass: -1, shadow: -1, march: -1 };
      }
      return {
        pass: pass.benchmark(rendererRef, iterations),
        march: pass.benchmark(rendererRef, iterations, true),
        shadow: shadowMap.benchmark(rendererRef, ctxRef.camera, globalUniforms.uSunDir.value as THREE.Vector3, iterations),
      };
    },
    shadowReadback() {
      return shadowMap && rendererRef ? shadowMap.readback(rendererRef) : null;
    },
    rawAverage() {
      return pass && rendererRef ? pass.rawAverage(rendererRef) : [];
    },
    probe(u, v) {
      return pass && rendererRef ? pass.probe(rendererRef, u, v) : [];
    },
    setKeyGainScale(scale) {
      keyGainScale = scale;
    },
    setEnabled(enabled) {
      if (pass) {
        pass.enabled = enabled;
      }
    },
    findCloud(x, z, radius) {
      if (!textures || !rendererRef) {
        return null;
      }
      const size = textures.weatherTarget.width;
      if (!weatherPixels) {
        weatherPixels = new Uint8Array(size * size * 4);
        rendererRef.readRenderTargetPixels(textures.weatherTarget, 0, 0, size, size, weatherPixels);
      }
      const px = weatherPixels;
      const texel = (u: number, v: number, c: number): number => {
        const iu = ((Math.floor(u * size) % size) + size) % size;
        const iv = ((Math.floor(v * size) % size) + size) % size;
        return px[(iv * size + iu) * 4 + c] / 255;
      };
      const wind = shared.uCloudWind.value;
      const wind2 = shared.uCloudWind2.value;
      let best: { x: number; z: number; coverage: number; height: number } | null = null;
      const step = C.weatherPeriod / size;
      for (let dz = -radius; dz <= radius; dz += step) {
        for (let dx = -radius; dx <= radius; dx += step) {
          const wx = x + dx;
          const wz = z + dz;
          const u = (wx - wind.x) / C.weatherPeriod;
          const v = (wz - wind.y) / C.weatherPeriod;
          const k = 0.371 / C.weatherPeriod;
          const qx = (wx - wind2.x) * k;
          const qz = (wz - wind2.y) * k;
          const ru = 0.8 * qx + 0.6 * qz + 0.31;
          const rv = -0.6 * qx + 0.8 * qz + 0.77;
          const reg = texel(ru, rv, 3) + shared.uCloudShape.value.x * 0.4;
          const regZ = (reg - 0.5) * 10;
          const cov = texel(u, v, 0) * THREE.MathUtils.smoothstep(regZ, -1.6, 0.9) * (0.3 + texel(u, v, 1));
          if (!best || cov > best.coverage) {
            best = { x: wx, z: wz, coverage: cov, height: texel(u, v, 1) };
          }
        }
      }
      return best;
    },
  };
  return { system, handle };
}

export function createCloudSystem(): System {
  return createCloudSystemWithHandle().system;
}
