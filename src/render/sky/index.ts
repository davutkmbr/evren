import * as THREE from 'three';
import type { EngineContext, EnvironmentState, System } from '../../core/contracts';
import { UpdateOrder } from '../../core/contracts';
import { VIEW_PRESETS } from '../../core/debug';
import type { QualitySettings } from '../../core/quality';
import { globalUniforms } from '../../core/uniforms';
import { computeCelestial, createCelestialState, moonPhaseBrightness, refract } from './astronomy';
import { SkyClock, advanceCalendar } from './clock';
import { SkyEnvironment } from './environment';
import { atmosphereUniforms, ensureCloudShadowSampler, registerAtmosphereGlobals } from './globals';
import { KeyLight } from './key-light';
import { AtmosphereLuts } from './luts';
import { createMilkyWayTexture } from './milky-way';
import { createMoonTexture } from './moon-texture';
import {
  AIRGLOW,
  ATMOSPHERE,
  HAZE,
  LIGHT_POLLUTION,
  MILKY_WAY_RADIANCE,
  MOON_ILLUMINANCE_FULL,
  MOON_SKY_SCALE,
  OBSERVER,
  SKY_VIEW_LUT_SIZE,
  STAR_BRIGHTNESS,
  SUN_DISK_RADIANCE,
  SUN_ILLUMINANCE,
} from './params';
import { installSkyShaderPatches } from './shader-patches';
import { SkyDome, type SkyDomeParams } from './sky-dome';
import { StarField } from './stars';
import { nightSkyWeight, twilightSkyBoost, twilightSkyDirection } from './twilight';
import { WindModel } from './wind';

registerAtmosphereGlobals();
installSkyShaderPatches();

const DEG = Math.PI / 180;
const MOON_KEY_TINT = new THREE.Vector3(0.74, 0.86, 1.0);
const ENV_REFRESH_SECONDS = 3;
const PROBE_INTERVAL_SECONDS = 0.25;
/** Horizontal camera move (km) after which the night sky LUT is re-rendered (the skyglow dome is city-centred). */
const CITY_OFFSET_REFRESH_KM = 1.5;

function smoothstep(a: number, b: number, x: number): number {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

class SkyEnvironmentState implements EnvironmentState {
  readonly sunDirection = new THREE.Vector3(0, 1, 0);
  readonly moonDirection = new THREE.Vector3(0, -1, 0);
  readonly sunColor = new THREE.Color(0, 0, 0);
  readonly ambientColor = new THREE.Color(0.3, 0.35, 0.45);
  readonly wind = new THREE.Vector3();
  night = 0;
  constructor(
    readonly light: THREE.Light,
    private readonly setTime: (hours: number) => void,
  ) {}
  get nightFactor(): number {
    return this.night;
  }
  setTimeOfDay(hours: number): void {
    this.setTime(hours);
  }
}

function cameraAltitude(): number {
  return Math.max((globalUniforms.uCamPos.value as THREE.Vector3).y, 1);
}

/** Debug overrides (sandbox measurement lab): null = automatic. */
interface SkyOverrides {
  boost: number | null;
  moonSky: number | null;
  pollution: number | null;
}

export function createSkySystem(): System {
  let ctx: EngineContext | null = null;
  const overrides: SkyOverrides = { boost: null, moonSky: null, pollution: null };
  const celestial = createCelestialState();
  const clock = new SkyClock(18);
  let wind = new WindModel();
  const keyLight = new KeyLight();
  const state = new SkyEnvironmentState(keyLight.light, (h) => clock.set(h, true));

  let luts: AtmosphereLuts | null = null;
  let dome: SkyDome | null = null;
  let stars: StarField | null = null;
  let environment: SkyEnvironment | null = null;
  let moonTarget: THREE.WebGLRenderTarget | null = null;
  let milkyWayTarget: THREE.WebGLRenderTarget | null = null;
  let unsubscribeQuality: (() => void) | null = null;
  let removeRenderHook: (() => void) | null = null;
  let placeholderLut: THREE.Texture | null = null;

  let year = 2026;
  let hazeMul: number = HAZE.poyraz;
  let hazeOverride: number | null = null;
  const aerosolMul = 1;
  let lutMediumHaze = -1;
  let lutMediumAerosol = -1;
  let multiScatteringDirty = true;
  let skyViewDirty = true;
  let lastEmittedHours = -1;
  let wasTransitioning = false;
  let envTimer = 0;
  let probeTimer = 0;
  let shadowWanted = true;
  let keyIsMoon = false;
  let firstFrame = true;
  let sinceInit = 0;

  const sunIllum = new THREE.Vector3(SUN_ILLUMINANCE, SUN_ILLUMINANCE, SUN_ILLUMINANCE);
  const moonIllum = new THREE.Vector3();
  const keyIllum = new THREE.Vector3();
  const keyDir = new THREE.Vector3();
  const tmpV = new THREE.Vector3();
  const moonRadiance = new THREE.Vector3();
  const milkyWay = new THREE.Vector3();
  const lightPollution = new THREE.Vector4();
  const airglow = new THREE.Vector3();
  const ambientSmoothed = new THREE.Color(0.3, 0.35, 0.45);
  const horizonSmoothed = new THREE.Color(0.5, 0.55, 0.62);

  const lutSunDir = new THREE.Vector3(0, -2, 0);
  const lutMoonDir = new THREE.Vector3(0, -2, 0);
  const lutCityOffset = new THREE.Vector2(1e9, 1e9);
  let lutAltitude = -1;
  let lutMoonLevel = -1;
  let lutPollution = -1;
  let lutSunLevel = -1;
  const envSunDir = new THREE.Vector3(0, -2, 0);
  let envAltitude = -1;
  let envNight = -1;
  let envHaze = -1;
  let envMoonLevel = -1;
  let shadowDistance = -1;

  const domeParams: SkyDomeParams = {
    sunDir: celestial.sunDirection,
    sunDiskRadiance: SUN_DISK_RADIANCE,
    sunFlatten: 1,
    moonDir: celestial.moonDirection,
    moonRadius: celestial.moonAngularRadius,
    moonRadiance,
    earthshine: 0,
    equatorialToLocal: celestial.equatorialToLocal,
    milkyWay,
  };

  const lightsForLut = {
    camAltitudeM: 100,
    lightDirA: new THREE.Vector3(),
    lightIllumA: new THREE.Vector3(),
    lightDirB: new THREE.Vector3(),
    lightIllumB: new THREE.Vector3(),
    lightPollution,
    cityOffsetKm: new THREE.Vector2(),
    airglow,
  };

  function applyQuality(settings: QualitySettings): void {
    keyLight.applyQuality(settings);
    shadowDistance = -1;
    if (environment && ctx) {
      environment.setCubeSize(settings.preset === 'low' ? 64 : 128);
      if (!environment.envTarget) {
        ctx.scene.environment = environment.captureNow();
      }
    }
  }

  function targetHaze(): number {
    if (hazeOverride !== null) {
      return hazeOverride;
    }
    const morning = Math.exp(-(((clock.hours - 7.5) / 2.2) ** 2)) * HAZE.morningBoost;
    return THREE.MathUtils.lerp(HAZE.poyraz, HAZE.lodos, wind.lodos) * (1 + morning);
  }

  function updateCelestialAndLights(c: EngineContext): void {
    computeCelestial(celestial, year, c.time.dayOfYear, clock.hours, OBSERVER.latDeg, OBSERVER.lonDeg, OBSERVER.utcOffsetHours);
    const sunElev = celestial.sunElevationDeg;
    state.sunDirection.copy(celestial.sunDirection);
    state.moonDirection.copy(celestial.moonDirection);
    state.night = 1 - smoothstep(-9, 3, sunElev);

    const moonLevel = MOON_ILLUMINANCE_FULL * moonPhaseBrightness(celestial.moonPhaseAngle);
    moonIllum.copy(MOON_KEY_TINT).multiplyScalar(moonLevel);

    keyIsMoon = sunElev < -3.5;
    if (keyIsMoon) {
      keyDir.copy(celestial.moonDirection);
      keyIllum.copy(moonIllum).multiplyScalar(smoothstep(-3.5, -9, sunElev));
    } else {
      keyDir.copy(celestial.sunDirection);
      keyIllum.copy(sunIllum);
    }
    keyLight.update(keyDir, keyIllum, hazeMul, aerosolMul);
    if (keyIsMoon) {
      state.sunColor.setRGB(0, 0, 0);
    } else {
      keyLight.groundColor(tmpV);
      state.sunColor.setRGB(tmpV.x, tmpV.y, tmpV.z);
    }

    // Moonlit sky and city skyglow fade in as the twilight fades out (their sum with the twilight keeps falling);
    // skyglow scales with the scattering of the humid boundary layer.
    const nightWeight = nightSkyWeight(sunElev);
    const cityLights = overrides.pollution ?? nightWeight * LIGHT_POLLUTION.strength * (0.9 + 0.15 * hazeMul);
    lightPollution.set(
      LIGHT_POLLUTION.color[0] * cityLights,
      LIGHT_POLLUTION.color[1] * cityLights,
      LIGHT_POLLUTION.color[2] * cityLights,
      1 / LIGHT_POLLUTION.scaleHeightKm,
    );
    airglow.set(AIRGLOW.color[0], AIRGLOW.color[1], AIRGLOW.color[2]).multiplyScalar(AIRGLOW.strength * state.night);

    twilightSkyDirection(celestial.sunDirection, sunElev, lightsForLut.lightDirA);
    lightsForLut.lightIllumA.copy(sunIllum).multiplyScalar(overrides.boost ?? twilightSkyBoost(sunElev));
    lightsForLut.lightDirB.copy(celestial.moonDirection);
    const moonSky = overrides.moonSky ?? (celestial.moonElevationDeg > -6 ? moonLevel * MOON_SKY_SCALE * nightWeight : 0);
    lightsForLut.lightIllumB.setScalar(moonSky);
    const cam = globalUniforms.uCamPos.value as THREE.Vector3;
    lightsForLut.cityOffsetKm.set(cam.x * 0.001, cam.z * 0.001);
  }

  function writeGlobals(c: EngineContext): void {
    // Re-asserted every frame: the uniform object is shared by reference with every program, and code that clears
    // its own material's texture uniforms after use can null it for the whole app (black sky, no aerial perspective).
    if (luts && atmosphereUniforms.uSkyViewLUT.value !== luts.skyView.texture) {
      atmosphereUniforms.uSkyViewLUT.value = luts.skyView.texture;
    }
    ensureCloudShadowSampler();
    globalUniforms.uTimeOfDay.value = clock.hours;
    (globalUniforms.uSunDir.value as THREE.Vector3).copy(celestial.sunDirection);
    (globalUniforms.uMoonDir.value as THREE.Vector3).copy(celestial.moonDirection);
    (globalUniforms.uSunColor.value as THREE.Color).copy(state.sunColor);
    globalUniforms.uNight.value = state.night;
    (globalUniforms.uWind.value as THREE.Vector3).copy(state.wind);

    atmosphereUniforms.uKeyLightDir.value.copy(keyLight.direction);
    atmosphereUniforms.uKeyLightColor.value.copy(keyLight.referenceColor);
    const ratios = atmosphereUniforms.uKeyLightRatio.value;
    for (let i = 0; i < ratios.length; i++) {
      ratios[i].copy(keyLight.ratios[i]);
    }
    const st = atmosphereUniforms.uAtmoState.value;
    st.z = hazeMul;
    st.w = aerosolMul;

    if (environment?.result.valid) {
      const k = firstFrame ? 1 : 1 - Math.exp(-c.time.realDt * 4);
      ambientSmoothed.lerp(environment.result.irradianceUp, k);
      horizonSmoothed.lerp(environment.result.horizon, k);
    }
    state.ambientColor.copy(ambientSmoothed);
    (globalUniforms.uAmbient.value as THREE.Color).copy(ambientSmoothed);
    (globalUniforms.uFogColor.value as THREE.Color).copy(horizonSmoothed);
    const hazeExtGreen = (ATMOSPHERE.hazeScatteringPerKm[1] + ATMOSPHERE.hazeAbsorptionPerKm[1]) * hazeMul;
    globalUniforms.uFogDensity.value = (hazeExtGreen + ATMOSPHERE.rayleighScatteringPerKm[1] + ATMOSPHERE.mieExtinctionPerKm * aerosolMul) * 1e-3;
    globalUniforms.uFogHeightFalloff.value = 1 / (ATMOSPHERE.hazeScaleHeightKm * 1000);

    // Radiance of distant ground below the horizon (sea + city), incl. the city's lights at night.
    const albedo = ATMOSPHERE.groundAlbedo[1] / Math.PI;
    const keyGround = keyLight.groundColor(tmpV).multiplyScalar(Math.max(keyLight.direction.y, 0));
    const cityGlow = smoothstep(0.3, 0.8, state.night) * 0.0035;
    atmosphereUniforms.uAtmoGround.value.set(
      albedo * (keyGround.x + ambientSmoothed.r) + cityGlow,
      albedo * (keyGround.y + ambientSmoothed.g) + cityGlow * 0.62,
      albedo * (keyGround.z + ambientSmoothed.b) + cityGlow * 0.36,
    );
  }

  function updateDomeAndStars(): void {
    if (!dome || !stars) {
      return;
    }
    const sunElev = celestial.sunElevationDeg;
    const night = state.night;
    // Vertical squash of the refracted solar disk near the horizon: d(apparent)/d(true).
    const dApp = refract(sunElev + 0.3) - refract(sunElev - 0.3);
    const sunFlatten = THREE.MathUtils.clamp(0.6 / Math.max(dApp, 0.3), 1, 1.35);
    moonRadiance.set(1.0, 0.985, 0.965).multiplyScalar(THREE.MathUtils.lerp(3.2, 9, night));
    const earthshine = 0.012 * (1 - Math.cos(celestial.moonPhaseAngle)) * 0.5;
    // The Milky Way drowns in moonlight (and in the city's skyglow, which the additive band cannot out-shine).
    const moonUp = moonPhaseBrightness(celestial.moonPhaseAngle) * smoothstep(-3, 20, celestial.moonElevationDeg);
    milkyWay.setScalar(MILKY_WAY_RADIANCE * smoothstep(-10, -18, sunElev) * (1 - 0.85 * moonUp));
    domeParams.sunFlatten = sunFlatten;
    domeParams.moonRadius = celestial.moonAngularRadius;
    domeParams.earthshine = earthshine;
    dome.update(domeParams);
    // Visibility per star follows the local sky brightness (limiting magnitude in the star shader).
    stars.update(celestial.equatorialToLocal, STAR_BRIGHTNESS * smoothstep(-1, -5, sunElev), celestial.moonDirection, celestial.moonAngularRadius);
  }

  function updateLuts(c: EngineContext, force: boolean): void {
    if (!luts) {
      return;
    }
    const renderer = c.renderer;
    const mediumChanged = Math.abs(hazeMul - lutMediumHaze) > 0.004 || Math.abs(aerosolMul - lutMediumAerosol) > 0.004;
    if (mediumChanged || force) {
      luts.setMediumScale(hazeMul, aerosolMul);
      luts.renderTransmittance(renderer);
      lutMediumHaze = hazeMul;
      lutMediumAerosol = aerosolMul;
      multiScatteringDirty = true;
      if (!force) {
        return;
      }
    }
    if (multiScatteringDirty) {
      luts.renderMultiScattering(renderer);
      multiScatteringDirty = false;
      skyViewDirty = true;
      if (!force) {
        return;
      }
    }
    const altitude = cameraAltitude();
    const altChanged = Math.abs(altitude - lutAltitude) > Math.max(3, lutAltitude * 0.02);
    const sunChanged = lutSunDir.dot(lightsForLut.lightDirA) < Math.cos(0.02 * DEG);
    const moonChanged = lutMoonDir.dot(celestial.moonDirection) < Math.cos(0.1 * DEG);
    const moonLevel = lightsForLut.lightIllumB.x;
    const levelChanged =
      Math.abs(moonLevel - lutMoonLevel) > Math.max(1e-5, lutMoonLevel * 0.01) ||
      Math.abs(lightPollution.x - lutPollution) > Math.max(1e-6, lutPollution * 0.01) ||
      Math.abs(lightsForLut.lightIllumA.x - lutSunLevel) > Math.max(1e-4, lutSunLevel * 0.005);
    const cityMoved = lightPollution.x > 0 && lutCityOffset.distanceTo(lightsForLut.cityOffsetKm) > CITY_OFFSET_REFRESH_KM;
    if (skyViewDirty || force || altChanged || sunChanged || moonChanged || levelChanged || cityMoved) {
      lightsForLut.camAltitudeM = altitude;
      luts.renderSkyView(renderer, lightsForLut);
      lutAltitude = altitude;
      lutSunDir.copy(lightsForLut.lightDirA);
      lutMoonDir.copy(celestial.moonDirection);
      lutMoonLevel = moonLevel;
      lutPollution = lightPollution.x;
      lutSunLevel = lightsForLut.lightIllumA.x;
      lutCityOffset.copy(lightsForLut.cityOffsetKm);
      skyViewDirty = false;
      atmosphereUniforms.uAtmoState.value.x = altitude;
    }
  }

  function updateEnvironment(c: EngineContext, force: boolean): void {
    if (!environment) {
      return;
    }
    if (environment.step()) {
      return;
    }
    envTimer += c.time.realDt;
    const altitude = cameraAltitude();
    const sunMoved = envSunDir.dot(celestial.sunDirection) < Math.cos(0.5 * DEG);
    const nightChanged = Math.abs(state.night - envNight) > 0.015;
    const altChanged = Math.abs(Math.log((altitude + 50) / (envAltitude + 50))) > 0.2;
    const moonLevel = lightsForLut.lightIllumB.x;
    const drifted =
      envSunDir.dot(celestial.sunDirection) < Math.cos(0.05 * DEG) ||
      Math.abs(hazeMul - envHaze) > 0.01 ||
      Math.abs(moonLevel - envMoonLevel) > Math.max(1e-4, envMoonLevel * 0.02);
    if (force) {
      c.scene.environment = environment.captureNow();
    } else if (sunMoved || nightChanged || altChanged || (envTimer > ENV_REFRESH_SECONDS && drifted)) {
      environment.begin();
    } else {
      return;
    }
    envTimer = 0;
    envHaze = hazeMul;
    envSunDir.copy(celestial.sunDirection);
    envNight = state.night;
    envAltitude = altitude;
    envMoonLevel = moonLevel;
  }

  function emitTime(c: EngineContext): void {
    const h = clock.hours;
    let diff = Math.abs(h - lastEmittedHours);
    diff = Math.min(diff, 24 - diff);
    const transitionEnded = wasTransitioning && !clock.transitioning;
    wasTransitioning = clock.transitioning;
    if (diff >= 1 / 60 || (transitionEnded && diff > 1e-6)) {
      lastEmittedHours = h;
      c.events.emit('time-of-day', { hours: h });
    }
  }

  function advanceDays(c: EngineContext): void {
    const days = clock.consumeDayCarry();
    if (days !== 0) {
      const next = advanceCalendar(year, c.time.dayOfYear, days);
      year = next.year;
      c.time.dayOfYear = next.dayOfYear;
    }
  }

  return {
    name: 'sky',
    order: UpdateOrder.Environment,

    init(c) {
      ctx = c;
      const params = c.debug.params;
      year = Number(params.get('year') ?? 2026) || 2026;
      if (params.has('doy')) {
        c.time.dayOfYear = Math.round(THREE.MathUtils.clamp(Number(params.get('doy')) || c.time.dayOfYear, 1, 365));
      }
      const forcedWind = params.get('wind');
      wind = new WindModel(forcedWind === 'lodos' || forcedWind === 'poyraz' ? forcedWind : null);
      if (params.has('haze')) {
        hazeOverride = Math.max(0, Number(params.get('haze')));
      }
      // ?t= wins; otherwise a named view (?view=gece) brings its suggested time of day.
      const presetTime = c.debug.view !== undefined ? VIEW_PRESETS[c.debug.view]?.time : undefined;
      clock.set(c.debug.time ?? presetTime ?? c.time.timeOfDay, false);
      c.time.timeOfDay = clock.hours;
      lastEmittedHours = clock.hours;

      const renderer = c.renderer;
      luts = new AtmosphereLuts(SKY_VIEW_LUT_SIZE);
      moonTarget = createMoonTexture(renderer);
      milkyWayTarget = createMilkyWayTexture(renderer);
      dome = new SkyDome({ transmittance: luts.transmittance.texture, moon: moonTarget.texture, milkyWay: milkyWayTarget.texture }, luts.medium);
      stars = new StarField(luts.transmittance.texture, luts.skyView.texture, luts.medium);
      environment = new SkyEnvironment(renderer, dome.envMesh, c.quality.settings.preset === 'low' ? 64 : 128);

      placeholderLut = atmosphereUniforms.uSkyViewLUT.value;
      atmosphereUniforms.uSkyViewLUT.value = luts.skyView.texture;
      atmosphereUniforms.uAtmoState.value.y = 1;

      c.scene.add(dome.mesh, stars.points, keyLight.light);
      c.scene.background = null;
      c.scene.environmentIntensity = 1;

      keyLight.applyQuality(c.quality.settings);
      unsubscribeQuality = c.quality.onChange(applyQuality);

      // Cascades are fitted to (and rendered for) the main camera only; other cameras (planar reflections) reuse
      // this frame's shadow map instead of re-rendering it for a mirrored frustum.
      const scene = c.scene;
      const previousHook = scene.onBeforeRender;
      const mainCamera = c.camera;
      type RenderHook = (this: THREE.Scene, renderer: unknown, scene: unknown, camera: unknown, target: unknown) => void;
      const previous = previousHook as unknown as RenderHook;
      const hook = function skyShadowHook(this: THREE.Scene, renderer: unknown, s: unknown, camera: unknown, target: unknown): void {
        previous.call(this, renderer, s, camera, target);
        keyLight.shadow.autoUpdate = shadowWanted && camera === mainCamera;
      } as unknown as THREE.Scene['onBeforeRender'];
      scene.onBeforeRender = hook;
      removeRenderHook = () => {
        if (scene.onBeforeRender === hook) {
          scene.onBeforeRender = previousHook;
        }
      };

      c.camera.updateMatrixWorld();
      (globalUniforms.uCamPos.value as THREE.Vector3).setFromMatrixPosition(c.camera.matrixWorld);
      wind.update(c.time.elapsed);
      state.wind.copy(wind.vector);
      hazeMul = targetHaze();
      updateCelestialAndLights(c);
      writeGlobals(c);
      updateDomeAndStars();
      updateLuts(c, true);
      updateEnvironment(c, true);
      environment.requestProbe();

      c.services.provide('env', state);
      if (c.sandbox) {
        (window as unknown as Record<string, unknown>).__skyDebug = { luts, environment, keyLight, celestial, state, clock, overrides, calendar: () => ({ year, dayOfYear: c.time.dayOfYear }) };
      }
    },

    update(dt, c) {
      if (c.input.wasPressed('timeFwd')) {
        clock.shift(0.5);
      }
      if (c.input.wasPressed('timeBack')) {
        clock.shift(-0.5);
      }
      clock.update(c.time.realDt, dt, c.time.dayTimeScale);
      advanceDays(c);
      c.time.timeOfDay = clock.hours;
      emitTime(c);

      wind.update(c.time.elapsed);
      state.wind.copy(wind.vector);
      hazeMul += (targetHaze() - hazeMul) * Math.min(1, c.time.realDt * 0.2);

      updateCelestialAndLights(c);
      writeGlobals(c);
      updateDomeAndStars();
    },

    preRender(c) {
      // Stretch the shadow range with altitude (quantised in x1.25 steps so cascades stay stable, at most x2).
      const base = c.quality.settings.shadowDistance;
      const want = Math.max(base, Math.min(cameraAltitude() * 1.8, base * 2));
      const distance = base * Math.pow(1.25, Math.ceil(Math.log(want / base) / Math.log(1.25) - 1e-6));
      if (distance !== shadowDistance) {
        shadowDistance = distance;
        keyLight.shadow.setDistance(distance);
      }
      // Rendered every frame (sun and moon): a stale map offsets a moving caster's self shadow by a frame of motion.
      // The atlas must exist before any lit material samples it (a null sampler2DShadow makes draws fail).
      shadowWanted = !keyLight.shadow.map || keyLight.intensity > 1e-5;
      keyLight.shadow.autoUpdate = shadowWanted;
      updateLuts(c, false);
      if (luts && atmosphereUniforms.uSkyViewLUT.value !== luts.skyView.texture) {
        atmosphereUniforms.uSkyViewLUT.value = luts.skyView.texture;
      }
      updateEnvironment(c, false);
      sinceInit += c.time.realDt;
      probeTimer += c.time.realDt;
      if (probeTimer >= PROBE_INTERVAL_SECONDS && environment) {
        probeTimer = 0;
        environment.requestProbe();
      }
      firstFrame = false;
    },

    pending() {
      let n = 0;
      if (clock.transitioning) {
        n++;
      }
      // Wait for the first ambient readback, but never block screenshots for more than a few seconds.
      if (environment && (environment.busy || (environment.readbacks === 0 && sinceInit < 4))) {
        n++;
      }
      return n;
    },

    dispose() {
      unsubscribeQuality?.();
      removeRenderHook?.();
      if (ctx) {
        ctx.scene.remove(keyLight.light);
        if (dome) {
          ctx.scene.remove(dome.mesh);
        }
        if (stars) {
          ctx.scene.remove(stars.points);
        }
        if (environment?.envTarget && ctx.scene.environment === environment.envTarget.texture) {
          ctx.scene.environment = null;
        }
      }
      if (placeholderLut) {
        atmosphereUniforms.uSkyViewLUT.value = placeholderLut;
      }
      atmosphereUniforms.uAtmoState.value.y = 0;
      keyLight.dispose();
      luts?.dispose();
      dome?.dispose();
      stars?.dispose();
      environment?.dispose();
      moonTarget?.dispose();
      milkyWayTarget?.dispose();
    },
  };
}
