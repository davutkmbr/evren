/**
 * Sea, Bosphorus, Golden Horn and lakes: one camera-centred radial surface at y = 0 with Gerstner swell + FFT-band
 * detail normals, current-advected ripples, PBR water optics and (high/ultra) planar reflections.
 * Draw calls: 1 for the surface + the planar reflection pass.
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

/** Debug handle (sandbox / console): window.__water */
export interface WaterDebug {
  sea: SeaState;
  uniforms: WaterUniforms;
  mesh: THREE.Mesh;
  reflection: PlanarReflection;
  quality: () => WaterQuality;
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
  const placeholders = createPlaceholders();
  const origin = new THREE.Vector2();
  const tmpWind = new THREE.Vector3();
  let quality: WaterQuality = waterQualityFor('high', 'planar');
  let uniforms: WaterUniforms | null = null;
  let material: THREE.ShaderMaterial | null = null;
  let mesh: THREE.Mesh | null = null;
  let reflection: PlanarReflection | null = null;
  let anisotropy = 8;
  let regionStats: RegionBakeResult['stats'] | null = null;
  let disposed = false;
  let unsubscribeQuality: (() => void) | null = null;
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
  }

  function applyQuality(settings: QualitySettings): void {
    const next = waterQualityFor(settings.preset, settings.waterReflections);
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
      anisotropy = ctx.quality.settings.anisotropy;
      const forcedU10 = Number(ctx.debug.params.get('wu10'));
      sea.forcedU10 = forcedU10 > 0 ? forcedU10 : null;
      quality = waterQualityFor(ctx.quality.settings.preset, ctx.quality.settings.waterReflections);
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
      );
      const debugViews = ['off', 'region', 'flow', 'depth', 'rough', 'shore', 'nan'];
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
        uniforms,
        mesh,
        reflection,
        quality: () => quality,
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
      sea.update(wind, ctx.time.elapsed, dt, origin.x, origin.y);
      uniforms.uOrigin.value.copy(origin);
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

      // The mirror pass reuses the main camera's shadow map; until it exists (first frame, after a shadow-quality
      // change) lit materials would sample an unbound shadow sampler, so the pass waits a frame.
      const keyLight = ctx.services.tryGet('env')?.light as THREE.DirectionalLight | undefined;
      const shadowReady = !keyLight || !keyLight.castShadow || !!keyLight.shadow?.map;
      const planar = quality.planar && shadowReady && PlanarReflection.seesWater(cam);
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
      unsubscribeQuality?.();
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
