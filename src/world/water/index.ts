/**
 * Sea, Bosphorus, Golden Horn and lakes: one camera-centred radial surface at y = 0 with Gerstner swell + FFT-band
 * detail normals, current-advected ripples, PBR water optics and (high/ultra) planar reflections.
 * Draw calls: 1 for the surface + the planar reflection pass.
 * Provides the `water` service: the same waves evaluated on the CPU (wave-query.ts) plus the baked surface current,
 * with the wave particles (particles/: hull wakes, the dragon's waves, splash rings; phase 21 stage 7a) on top, which
 * the surface also draws from a splat window around the camera, and the foam (foam/: an advected foam field around the
 * camera fed by breaking crests, wakes, surf, hulls, the dragon and splashes, plus spray sources for fx; stage 7c).
 * The weather reaches the sea here (weather/: a storm raises the wind the waves are built from, rain draws drop rings
 * and damps the short waves; stage 6).
 */
import * as THREE from 'three';
import type { EngineContext, GeoQuery, System } from '../../core/contracts';
import { UpdateOrder } from '../../core/contracts';
import { globalUniforms } from '../../core/uniforms';
import type { QualitySettings } from '../../core/quality';
import { GRID_EXTENT, GRID_INNER_RADIUS, ORIGIN_SNAP, REGION_GRID_SIZE, waterQualityFor, type WaterQuality } from './config';
import { WaterBakeClient } from './bake/client';
import type { RegionBakeResult } from './bake/region-bake';
import type { SpectrumJobResult } from './bake/protocol';
import { createWaterMaterial, createWaterUniforms, type WaterUniforms } from './material';
import { PlanarReflection } from './reflection';
import { SeaState } from './sea-state';
import { buildRadialGrid } from './surface-grid';
import { createBandTexture, createFlowTexture, createFoamTexture, createPlaceholders, createRegionTexture } from './textures';
import { UnderwaterController } from './underwater';
import { LowFlightController } from './lowflight';
import { decodeRegionMaps, WaveQuery } from './wave-query';
import { waveParticleQualityFor, type WaveParticleQuality } from './particles/config';
import { DragonWaves } from './particles/dragon-waves';
import { createWaveSplatUniforms, WaveSplatGpu } from './particles/splat-gpu';
import { WaveParticles } from './particles/wave-particles';
import { FoamController, foamQualityFor } from './foam';

/** Debug handle (sandbox / console): window.__water */
export interface WaterDebug {
  sea: SeaState;
  /** CPU wave evaluator behind the `water` service. */
  waves: WaveQuery;
  uniforms: WaterUniforms;
  mesh: THREE.Mesh;
  reflection: PlanarReflection;
  quality: () => WaterQuality;
  /** Low flight over the sea (phase 21 stage 2): model (the `lowFlight` service) and disturbance window. */
  lowFlight: LowFlightController;
  /** Wave particles (phase 21 stage 7a): the pool behind `water.dynamic`, its splat pass and quality tier. */
  particles: WaveParticles;
  splat: WaveSplatGpu;
  particleQuality: () => WaveParticleQuality;
  /** Foam and spray (phase 21 stage 7c): whitecap model, field window, sources, GPU passes. */
  foam: FoamController;
  regionStats: () => RegionBakeResult['stats'] | null;
}

function sampleGeoGrids(geo: GeoQuery, size: number): { height: Float32Array; coast: Float32Array } {
  const b = geo.bounds;
  const height = new Float32Array(size * size);
  const coast = new Float32Array(size * size);
  const cw = (b.maxX - b.minX) / size;
  const ch = (b.maxZ - b.minZ) / size;
  for (let y = 0; y < size; y++) {
    const z = b.minZ + (y + 0.5) * ch;
    for (let x = 0; x < size; x++) {
      const wx = b.minX + (x + 0.5) * cw;
      const i = y * size + x;
      height[i] = geo.heightAt(wx, z);
      coast[i] = geo.coastDistance(wx, z);
    }
  }
  return { height, coast };
}

export function createWaterSystem(): System {
  const client = new WaterBakeClient();
  // Start the spectrum bake immediately so it overlaps with the systems initialised before water.
  const spectrumJob = client.spectrum();

  const sea = new SeaState();
  const waves = new WaveQuery();
  const underwater = new UnderwaterController();
  const lowFlight = new LowFlightController();
  let particleQuality = waveParticleQualityFor('high');
  const particles = new WaveParticles(particleQuality);
  waves.dynamic = particles;
  const dragonWaves = new DragonWaves(particles);
  const splatPlaceholder = new THREE.DataTexture(new Uint16Array(4), 1, 1, THREE.RGBAFormat, THREE.HalfFloatType);
  splatPlaceholder.needsUpdate = true;
  const splat = new WaveSplatGpu(createWaveSplatUniforms(splatPlaceholder));
  const foam = new FoamController();
  waves.foam = foam.sources;
  let unsubscribeSplash: (() => void) | null = null;
  let geoRef: GeoQuery | null = null;
  const placeholders = createPlaceholders();
  const origin = new THREE.Vector2();
  const tmpWind = new THREE.Vector3();
  let quality: WaterQuality = waterQualityFor('high', 'planar');
  /** `?wrefl=sky`: sky-only reflections whatever the preset (A/B against the planar mirror). */
  let forceSky = false;
  const reflectionsOf = (settings: QualitySettings): 'sky' | 'planar' => (forceSky ? 'sky' : settings.waterReflections);
  let uniforms: WaterUniforms | null = null;
  let material: THREE.ShaderMaterial | null = null;
  let mesh: THREE.Mesh | null = null;
  let reflection: PlanarReflection | null = null;
  let anisotropy = 8;
  let regionStats: RegionBakeResult['stats'] | null = null;
  let disposed = false;
  let unsubscribeQuality: (() => void) | null = null;
  let owner: EngineContext | null = null;
  const owned: THREE.Texture[] = [];

  function applySpectrum(result: SpectrumJobResult): void {
    if (disposed || !uniforms) {
      return;
    }
    const bands = createBandTexture(result.bands, anisotropy);
    const foam = createFoamTexture(result.foam, anisotropy);
    owned.push(bands, foam);
    uniforms.uBands.value = bands;
    uniforms.uFoamTex.value = foam;
  }

  function applyRegions(result: RegionBakeResult): void {
    if (disposed || !uniforms) {
      return;
    }
    const flow = createFlowTexture(result);
    const region = createRegionTexture(result);
    owned.push(flow, region);
    uniforms.uFlowTex.value = flow;
    uniforms.uRegionTex.value = region;
    regionStats = result.stats;
    waves.setRegions(decodeRegionMaps(result));
  }

  function applyQuality(settings: QualitySettings): void {
    const next = waterQualityFor(settings.preset, reflectionsOf(settings));
    anisotropy = settings.anisotropy;
    for (const tex of owned) {
      if (tex.anisotropy !== anisotropy && tex.minFilter === THREE.LinearMipmapLinearFilter) {
        tex.anisotropy = anisotropy;
        tex.needsUpdate = true;
      }
    }
    if (mesh && next.segments !== quality.segments) {
      const old = mesh.geometry;
      mesh.geometry = buildRadialGrid(next.segments, GRID_INNER_RADIUS, GRID_EXTENT);
      old.dispose();
    }
    if (material && next.bands !== quality.bands) {
      material.defines.WATER_BANDS = next.bands;
      material.needsUpdate = true;
    }
    quality = next;
    particleQuality = waveParticleQualityFor(settings.preset);
    particles.setQuality(particleQuality);
    foam.setQuality(foamQualityFor(settings.preset));
    if (!quality.planar && uniforms) {
      uniforms.uReflParams.value.x = 0;
    }
  }

  function resizeReflection(): void {
    if (!reflection) {
      return;
    }
    const res = globalUniforms.uResolution.value as THREE.Vector2;
    reflection.setSize(res.x * quality.reflectionScale, res.y * quality.reflectionScale, anisotropy, quality.reflectionSamples);
  }

  return {
    name: 'water',
    order: UpdateOrder.World,

    async init(ctx: EngineContext) {
      const geo = await ctx.services.when('geo');
      owner = ctx;
      waves.setCoast((x, z) => geo.coastDistance(x, z));
      particles.coast = (x, z) => geo.coastDistance(x, z);
      particleQuality = waveParticleQualityFor(ctx.quality.settings.preset);
      particles.setQuality(particleQuality);
      foam.setQuality(foamQualityFor(ctx.quality.settings.preset));
      ctx.services.provide('water', waves);
      // Splashes (skim contacts, plunges, breaches, strokes) start wave rings and leave foam (the nostril bubbles under
      // water do neither).
      unsubscribeSplash = ctx.events.on('splash', ({ position, strength }) => {
        const dragon = ctx.services.tryGet('dragon');
        dragonWaves.splash(position.x, position.z, strength, dragon);
        if (!(dragon && dragon.mode === 'underwater' && strength <= 0.08)) {
          foam.sources.splash(position.x, position.z, strength);
        }
      });
      geoRef = geo;
      underwater.init(ctx);
      lowFlight.init(ctx);
      anisotropy = ctx.quality.settings.anisotropy;
      const forcedU10 = Number(ctx.debug.params.get('wu10'));
      sea.forcedU10 = forcedU10 > 0 ? forcedU10 : null;
      forceSky = ctx.debug.params.get('wrefl') === 'sky';
      quality = waterQualityFor(ctx.quality.settings.preset, reflectionsOf(ctx.quality.settings));
      const b = geo.bounds;
      reflection = new PlanarReflection(anisotropy, quality.reflectionSamples);
      uniforms = createWaterUniforms(
        sea.uniforms,
        {
          geoHeight: geo.getHeightTexture(),
          geoCoast: geo.getCoastDistanceTexture(),
          region: placeholders.region,
          flow: placeholders.flow,
          bands: placeholders.bands,
          foam: placeholders.foam,
          reflection: reflection.target.texture,
          reflectionDepth: reflection.target.depthTexture,
        },
        new THREE.Vector4(b.minX, b.minZ, 1 / (b.maxX - b.minX), 1 / (b.maxZ - b.minZ)),
        lowFlight.uniforms,
        splat.uniforms,
        foam.uniforms,
      );
      foam.attach(uniforms);
      const debugViews = ['off', 'region', 'flow', 'depth', 'rough', 'shore', 'nan', 'foam'];
      material = createWaterMaterial(uniforms, quality.bands, Math.max(0, debugViews.indexOf(ctx.debug.params.get('wdebug') ?? 'off')));
      mesh = new THREE.Mesh(buildRadialGrid(quality.segments, GRID_INNER_RADIUS, GRID_EXTENT), material);
      mesh.name = 'water-surface';
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      // Drawn after the other opaque geometry so land/buildings early-z reject the expensive water pixels.
      mesh.renderOrder = 10;
      mesh.matrixAutoUpdate = false;
      ctx.scene.add(mesh);
      resizeReflection();

      unsubscribeQuality = ctx.quality.onChange(applyQuality);

      void spectrumJob.then(applySpectrum).catch((err) => console.error('[water] spectrum bake failed', err));
      const grids = sampleGeoGrids(geo, REGION_GRID_SIZE);
      void client
        .regions({ size: REGION_GRID_SIZE, height: grids.height, coast: grids.coast })
        .then((r) => {
          applyRegions(r);
          console.info(`[water] regions baked ${JSON.stringify(r.stats)}`);
        })
        .catch((err) => console.error('[water] region bake failed', err));

      (window as unknown as { __water: WaterDebug }).__water = {
        sea,
        waves,
        uniforms,
        mesh,
        reflection,
        quality: () => quality,
        lowFlight,
        particles,
        splat,
        particleQuality: () => particleQuality,
        foam,
        regionStats: () => regionStats,
      };
    },

    update(dt: number, ctx: EngineContext) {
      if (!uniforms) {
        return;
      }
      const cam = ctx.camera;
      origin.set(Math.round(cam.position.x / ORIGIN_SNAP) * ORIGIN_SNAP, Math.round(cam.position.z / ORIGIN_SNAP) * ORIGIN_SNAP);
      const env = ctx.services.tryGet('env');
      const wind = env ? env.wind : tmpWind.copy(globalUniforms.uWind.value as THREE.Vector3);
      // The weather over the sea (phase 21 stage 6): storms raise the sea's wind, rain draws drop rings.
      const weather = ctx.services.tryGet('weather');
      sea.weather.rain = weather ? weather.current.rain : 0;
      sea.weather.storm = weather ? weather.current.storm : 0;
      sea.update(wind, ctx.time.elapsed, dt, origin.x, origin.y);
      waves.sync(sea, origin.x, origin.y, ctx.time.elapsed);
      uniforms.uOrigin.value.copy(origin);
      underwater.update(ctx, waves, geoRef);
      uniforms.uCamUnder.value = underwater.state.under ? 1 : 0;
      lowFlight.update(ctx, waves, geoRef);
      // Wave particles: the dragon's waves (after the low-flight model of this frame), then one step of the pool.
      const dragon = ctx.services.tryGet('dragon');
      if (dragon) {
        particles.setFocus(cam.position.x, cam.position.z, dragon.position.x, dragon.position.z);
      } else {
        particles.setFocus(cam.position.x, cam.position.z);
      }
      dragonWaves.update(dragon, lowFlight.model, waves);
      particles.update(dt);
      // Foam: whitecap statistics, the field's clock and window, spray sources.
      foam.update(ctx, sea, waves);
    },

    preRender(ctx: EngineContext) {
      if (!uniforms || !mesh || !reflection) {
        return;
      }
      const cam = ctx.camera;
      mesh.position.set(cam.position.x, 0, cam.position.z);
      mesh.updateMatrix();
      mesh.updateMatrixWorld();
      uniforms.uGridCenter.value.set(cam.position.x - origin.x, cam.position.z - origin.y);
      // The disturbance field under a low-flying dragon (nothing drawn while it is not alive).
      lowFlight.preRender(ctx, origin.x, origin.y);
      // Wave particles near the camera into the splat window (off on "low" and while none is near).
      splat.update(ctx.renderer, particles, cam.position.x, cam.position.z, origin.x, origin.y, particleQuality.splatSize, particleQuality.splatTexel);
      // The foam field (reads this frame's splat): stamps from hulls, splashes and the dragon, then its steps.
      foam.preRender(ctx, origin.x, origin.y);

      // The mirror pass reuses the main camera's shadow map; until it exists (first frame, after a shadow-quality
      // change) lit materials would sample an unbound shadow sampler, so the pass waits a frame.
      const keyLight = ctx.services.tryGet('env')?.light as THREE.DirectionalLight | undefined;
      const shadowReady = !keyLight || !keyLight.castShadow || !!keyLight.shadow?.map;
      // Under water the surface shows its underside (Snell's window), which never samples the mirror.
      const planar = quality.planar && shadowReady && !underwater.state.under && PlanarReflection.seesWater(cam);
      if (planar) {
        resizeReflection();
        reflection.render(ctx.renderer, ctx.scene, cam, mesh);
        uniforms.uReflTex.value = reflection.target.texture;
        uniforms.uReflDepth.value = reflection.target.depthTexture;
        uniforms.uReflMatrix.value.copy(reflection.textureMatrix);
        uniforms.uReflInvProj.value.copy(reflection.camera.projectionMatrixInverse);
      }
      uniforms.uReflParams.value.x = planar ? 1 : 0;
    },

    pending() {
      return client.pending;
    },

    onResize() {
      resizeReflection();
    },

    dispose() {
      disposed = true;
      if (owner?.services.tryGet('water') === waves) {
        owner.services.withdraw('water');
      }
      unsubscribeQuality?.();
      unsubscribeSplash?.();
      splat.dispose();
      splatPlaceholder.dispose();
      foam.dispose();
      particles.clear();
      underwater.dispose();
      lowFlight.dispose();
      client.dispose();
      if (mesh) {
        mesh.removeFromParent();
        mesh.geometry.dispose();
      }
      material?.dispose();
      reflection?.dispose();
      for (const tex of owned) {
        tex.dispose();
      }
      for (const tex of Object.values(placeholders)) {
        tex.dispose();
      }
      owned.length = 0;
    },
  };
}
