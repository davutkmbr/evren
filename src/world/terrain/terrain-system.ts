import * as THREE from 'three';
import type { EngineContext, GeoQuery, System } from '../../core/contracts';
import { UpdateOrder } from '../../core/contracts';
import type { QualitySettings } from '../../core/quality';
import { globalUniforms } from '../../core/uniforms';
import { EXT_SIZE, LOD_COUNT, MID_MAX_LOD, TIER_COUNT, terrainQuality, type TerrainQuality, type TerrainTierId } from './config';
import { GpuBaker } from './bake/gpu-baker';
import { bakeHorizon } from './horizon/horizon-bake';
import { bakeDistrictMap } from './bake/district-map';
import { bakeNoiseTexture } from './bake/noise-bake';
import { buildRoadIndex } from './bake/road-index';
import { bakeSurfaceTiles, type SurfaceTiles } from './bake/tile-bake';
import { buildLandUseTable } from './landuse-table';
import { HeightBounds } from './height-bounds';
import { createPatchGeometry, createPatchGrid, type PatchGrid } from './patch-geometry';
import { PATCH_STRIDE, QuadtreeSelector } from './quadtree';
import { createTerrainMaterial, createTerrainUniforms, type TerrainUniforms } from './terrain-material';

const MAX_PATCHES = 6144;
const _projView = new THREE.Matrix4();
const _mirror = new THREE.Matrix4().makeScale(1, -1, 1);
const _camPos = new THREE.Vector3();

interface TierDraw {
  mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.MeshStandardMaterial>;
  patches: THREE.InstancedBufferAttribute;
  count: number;
}

/** Residential share of lit rooms by local hour (same curve as the city's windows, so the far carpet matches it). */
function windowOccupancy(hour: number): number {
  let dh = Math.abs(hour - 21);
  dh = Math.min(dh, 24 - dh);
  let dm = Math.abs(hour - 6.7);
  dm = Math.min(dm, 24 - dm);
  return 0.07 + 0.47 * Math.exp((-dh * dh) / 9.7) + 0.14 * Math.exp((-dm * dm) / 1.3);
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
}

export interface TerrainStats {
  patches: number[];
  triangles: number;
  selectMs: number;
  visitedNodes: number;
}

/**
 * CDLOD terrain: the quadtree selection runs on the CPU every frame (≈0.1 ms), patches are drawn as instances of one
 * shared grid in three tiered draws (near / mid / far shading programs). Heights come from the geo height texture in
 * the vertex shader; nothing is rebuilt on the CPU while flying.
 */
export class TerrainSystem implements System {
  readonly name = 'terrain';
  readonly order = UpdateOrder.World;

  /** Exponential moving average of the selection cost (ms). */
  selectMs = 0;

  private ctx: EngineContext | null = null;
  private readonly bounds = new HeightBounds();
  private readonly selector = new QuadtreeSelector(this.bounds, MAX_PATCHES);
  private readonly uniforms: TerrainUniforms = createTerrainUniforms();
  private readonly materials: THREE.MeshStandardMaterial[] = [];
  private tiers: TierDraw[] = [];
  private grid: PatchGrid | null = null;
  private quality: TerrainQuality = terrainQuality(1);
  private readonly frusta = [new THREE.Frustum(), new THREE.Frustum()];
  private unsubscribeQuality: (() => void) | null = null;
  private pendingJobs = 0;
  private baker: GpuBaker | null = null;
  private horizonTarget: THREE.WebGLRenderTarget | null = null;
  private noiseTarget: THREE.WebGLRenderTarget | null = null;
  private tiles: SurfaceTiles | null = null;
  private districtMap: THREE.DataTexture | null = null;
  private roadTexture: THREE.DataTexture | null = null;
  private disposed = false;

  async init(ctx: EngineContext): Promise<void> {
    this.ctx = ctx;
    const geo = await ctx.services.when('geo');
    this.bounds.setWorldHeights(geo.heightGrid.data);

    const u = this.uniforms;
    u.uGeoHeight.value = geo.getHeightTexture();
    u.uLandUse.value = geo.getLandUseTexture();
    u.uCoast.value = geo.getCoastDistanceTexture();

    this.baker = new GpuBaker(ctx.renderer);
    this.horizonTarget = bakeHorizon(this.baker, u.uGeoHeight.value!);
    u.uExtMap.value = this.horizonTarget.texture;
    this.readBackHorizon(ctx.renderer, this.horizonTarget);
    this.noiseTarget = bakeNoiseTexture(this.baker);
    u.uNoise.value = this.noiseTarget.texture;

    buildLandUseTable(u.uLandUseTable.value);
    const roads = buildRoadIndex(geo.roads);
    this.roadTexture = roads.texture;
    u.uRoadData.value = roads.texture;
    u.uRoadLayout.value.copy(roads.layout);

    for (let t = 0; t < TIER_COUNT; t++) {
      this.materials.push(createTerrainMaterial(u, t as TerrainTierId));
    }
    this.applyQuality(ctx.quality.settings);
    this.unsubscribeQuality = ctx.quality.onChange((s) => this.applyQuality(s));
    const params = ctx.debug.params;
    const debugModes: Record<string, number> = { lod: 1, landuse: 2, grey: 3 };
    const debug = params.get('terrainDebug');
    u.uTerrainDebug.value.x = debug ? (debugModes[debug] ?? 0) : 0;
    u.uTerrainDebug.value.z = Number(params.get('terrainProf') ?? 0) || 0;
    void this.bakeResources(ctx, geo);
    (window as unknown as Record<string, unknown>).__terrain = { system: this, uniforms: u, selector: this.selector, stats: () => this.stats() };
  }

  /** Slow resources (district raster, surface tiles) are produced after init; pending() reports them. */
  private async bakeResources(ctx: EngineContext, geo: GeoQuery): Promise<void> {
    this.pendingJobs++;
    try {
      const [districts, tiles] = await Promise.all([bakeDistrictMap(geo), bakeSurfaceTiles(this.baker!, ctx.quality.settings.anisotropy)]);
      if (this.disposed) {
        districts.dispose();
        tiles.carpets.dispose();
        tiles.nature.dispose();
        tiles.detail.dispose();
        return;
      }
      this.districtMap = districts;
      this.tiles = tiles;
      const u = this.uniforms;
      u.uDistrictMap.value = districts;
      u.uCarpets.value = tiles.carpets.texture;
      u.uNature.value = tiles.nature.texture;
      u.uDetail.value = tiles.detail.texture;
      u.uTerrainDebug.value.y = 1;
    } catch (err) {
      console.error('[terrain] surface bake failed', err);
    } finally {
      this.pendingJobs--;
    }
  }

  private readBackHorizon(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget): void {
    this.pendingJobs++;
    const buffer = new Float32Array(EXT_SIZE * EXT_SIZE * 4);
    renderer
      .readRenderTargetPixelsAsync(target, 0, 0, EXT_SIZE, EXT_SIZE, buffer)
      .then(() => this.bounds.setExtensionHeights(buffer, EXT_SIZE))
      .catch((err: unknown) => console.warn('[terrain] horizon readback failed; using conservative bounds', err))
      .finally(() => this.pendingJobs--);
  }

  private applyQuality(settings: QualitySettings): void {
    const ctx = this.ctx;
    if (!ctx || this.materials.length === 0) {
      return;
    }
    const q = terrainQuality(settings.terrainLodScale);
    const rebuild = this.tiers.length === 0 || q.patchQuads !== this.quality.patchQuads;
    this.quality = q;
    this.selector.setBaseRange(q.baseRange);
    for (let k = 0; k < LOD_COUNT; k++) {
      this.uniforms.uLodMorph.value[k].copy(this.selector.morph[k]);
    }
    this.uniforms.uPatchQuads.value = q.patchQuads;
    const carpetParam = ctx.debug.params.get('carpetStart');
    const carpetStart = carpetParam !== null ? Number(carpetParam) : settings.cityDrawDistance * 0.72;
    this.uniforms.uTerrainRanges.value.set(carpetStart, 1 / Math.max(settings.cityDrawDistance * 0.3, 1), q.detailDistance, q.roadDetailDistance);
    if (rebuild) {
      this.rebuildMeshes(ctx, q.patchQuads);
    }
  }

  private rebuildMeshes(ctx: EngineContext, quads: number): void {
    this.disposeMeshes();
    const grid = createPatchGrid(quads);
    this.grid = grid;
    const bench = Math.min(16, Math.max(0, Number(ctx.debug.params.get('terrainBench') ?? 0) || 0));
    for (let t = 0; t < TIER_COUNT; t++) {
      const { geometry, patches } = createPatchGeometry(grid, MAX_PATCHES);
      const mesh = new THREE.Mesh(geometry, this.materials[t]);
      mesh.name = `terrain-tier${t}`;
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      // Drawn after the other opaque objects (buildings/trees occlude it through early-z), near tier first.
      mesh.renderOrder = 5 + t;
      for (let i = 1; i < bench; i++) {
        const copy = new THREE.Mesh(geometry, this.materials[t]);
        copy.frustumCulled = false;
        copy.receiveShadow = true;
        copy.matrixAutoUpdate = false;
        copy.renderOrder = 5 + t;
        mesh.add(copy);
      }
      ctx.scene.add(mesh);
      this.tiers.push({ mesh, patches, count: 0 });
    }
  }

  private disposeMeshes(): void {
    for (const tier of this.tiers) {
      tier.mesh.removeFromParent();
      tier.mesh.geometry.dispose();
    }
    this.tiers = [];
    this.grid = null;
  }

  update(): void {
    const u = this.uniforms.uTerrainLights.value;
    const night = globalUniforms.uNight.value as number;
    const hour = (globalUniforms.uTimeOfDay.value as number) ?? 12;
    u.x = 1;
    u.y = windowOccupancy(hour);
    u.z = smoothstep(0.06, 0.5, night);
  }

  preRender(ctx: EngineContext): void {
    if (this.tiers.length === 0) {
      return;
    }
    const t0 = performance.now();
    const cam = ctx.camera;
    _camPos.setFromMatrixPosition(cam.matrixWorld);
    _projView.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.frusta[0].setFromProjectionMatrix(_projView, cam.coordinateSystem, cam.reversedDepth);
    let frustumCount = 1;
    if (ctx.quality.settings.waterReflections === 'planar' && _camPos.y < 3000) {
      // Planar water reflections render the mirrored view: keep the patches it sees too.
      _projView.multiply(_mirror);
      this.frusta[1].setFromProjectionMatrix(_projView, cam.coordinateSystem, cam.reversedDepth);
      frustumCount = 2;
    }
    const count = this.selector.select(_camPos, this.frusta, frustumCount);
    const src = this.selector.data;
    for (const tier of this.tiers) {
      tier.count = 0;
    }
    for (let i = 0; i < count; i++) {
      const o = i * PATCH_STRIDE;
      const lod = src[o + 3];
      const tier = this.tiers[lod < 0.5 ? 0 : lod <= MID_MAX_LOD + 0.5 ? 1 : 2];
      const dst = tier.patches.array as Float32Array;
      const d = tier.count * PATCH_STRIDE;
      dst[d] = src[o];
      dst[d + 1] = src[o + 1];
      dst[d + 2] = src[o + 2];
      dst[d + 3] = lod;
      tier.count++;
    }
    for (const tier of this.tiers) {
      tier.patches.clearUpdateRanges();
      if (tier.count > 0) {
        tier.patches.addUpdateRange(0, tier.count * PATCH_STRIDE);
        tier.patches.needsUpdate = true;
      }
      tier.mesh.geometry.instanceCount = tier.count;
      tier.mesh.visible = tier.count > 0 && tier.mesh.userData.hidden !== true;
    }
    this.uniforms.uLodCamera.value.copy(_camPos);
    this.selectMs += (performance.now() - t0 - this.selectMs) * 0.05;
  }

  stats(): TerrainStats {
    const quadTris = (this.grid?.quads ?? 0) ** 2 * 2;
    const patches = this.tiers.map((t) => t.count);
    return {
      patches,
      triangles: patches.reduce((a, b) => a + b, 0) * quadTris,
      selectMs: Math.round(this.selectMs * 1000) / 1000,
      visitedNodes: this.selector.visited,
    };
  }

  /** Debug: show only the tiers in `mask` (bit per tier; true = all, false = none) for A/B GPU timing. */
  setVisible(mask: boolean | number): void {
    const bits = mask === true ? 0xff : mask === false ? 0 : mask;
    this.tiers.forEach((tier, i) => {
      const visible = (bits & (1 << i)) !== 0;
      tier.mesh.userData.hidden = !visible;
      tier.mesh.visible = visible && tier.count > 0;
    });
  }

  pending(): number {
    return this.pendingJobs;
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribeQuality?.();
    this.disposeMeshes();
    for (const m of this.materials) {
      m.dispose();
    }
    this.materials.length = 0;
    this.horizonTarget?.dispose();
    this.noiseTarget?.dispose();
    this.tiles?.carpets.dispose();
    this.tiles?.nature.dispose();
    this.tiles?.detail.dispose();
    this.districtMap?.dispose();
    this.roadTexture?.dispose();
    this.baker?.dispose();
  }
}
