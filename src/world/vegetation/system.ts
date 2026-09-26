import * as THREE from 'three';
import type { EngineContext, GeoQuery, System } from '../../core/contracts';
import { UpdateOrder } from '../../core/contracts';
import type { QualitySettings } from '../../core/quality';
import type { VegetationAssets } from './assets';
import { createVegetationAssets, rebakeIfNeeded } from './assets';
import { TreeColliders } from './colliders';
import type { VegetationLodConfig } from './config';
import { lodConfigFor, TILE_SIZE, tileKeepLevel } from './config';
import { CHUNK, ImpostorPool } from './render/impostor-pool';
import type { NearBands } from './render/near-pools';
import { NearPools } from './render/near-pools';
import { SPECIES_COUNT, SPECIES_SHAPES } from './species';
import { onOsmExclusionChange, osmActiveExclusion } from '../osm/regions';
import { buildPlacementInit } from './stream/geo-window';
import type { VegTile } from './stream/tile-streamer';
import { TileState, TileStreamer } from './stream/tile-streamer';

/** Instances (re)written into the impostor pools per frame (upload + copy budget). */
const WRITE_BUDGET = 24_000;
/** Pool hysteresis (m) between the shadow-casting near impostor pool and the far pool. */
const POOL_HYSTERESIS = 48;

const NEAR = 0;
const FAR = 1;

/**
 * Trees & vegetation: procedural species (generated in a worker, textures and octahedral impostors baked on the GPU at
 * init), tile streaming from geo land use (placement workers), mesh LODs near the camera and two impostor pools
 * (shadow-casting near ring, far ring out to treeDrawDistance).
 */
export class VegetationSystem implements System {
  readonly name = 'vegetation';
  readonly order = UpdateOrder.World;

  private ctx: EngineContext | null = null;
  private assets: VegetationAssets | null = null;
  private cfg: VegetationLodConfig | null = null;
  private streamer: TileStreamer | null = null;
  private near: NearPools | null = null;
  private pools: ImpostorPool[] = [];
  private colliders: TreeColliders | null = null;
  private readonly root = new THREE.Group();
  private initJobs = 1;
  private readonly loadedScratch: VegTile[] = [];
  private readonly nearTiles: VegTile[] = [];
  private readonly writeQueue: VegTile[] = [];
  private readonly chunkScratch: number[] = [];
  private readonly heights: number[] = [];
  private readonly radii: number[] = [];
  private readonly lastRebuild = new THREE.Vector3(Infinity, 0, 0);
  private rebuildAge = 0;
  private lodScale = 1;
  private readonly bands: NearBands = { lod0: 0, lod0Fade: 0, lod1: 0, lod1Fade: 0, shadow: 0, margin: 4 };
  private unsubscribeQuality: (() => void) | null = null;
  private unsubscribeOsm: (() => void) | null = null;
  private disposed = false;

  async init(ctx: EngineContext): Promise<void> {
    this.ctx = ctx;
    this.root.name = 'vegetation';
    this.root.matrixAutoUpdate = false;
    ctx.scene.add(this.root);
    this.cfg = lodConfigFor(ctx.quality.settings);
    try {
      this.assets = await createVegetationAssets(ctx.renderer, this.cfg);
    } catch (err) {
      console.error('[vegetation] asset generation failed', err);
      this.initJobs = 0;
      return;
    }
    if (this.disposed) {
      return;
    }
    const a = this.assets;
    for (let s = 0; s < SPECIES_COUNT; s++) {
      this.heights.push(a.species[s].height);
      this.radii.push(a.species[s].radius);
    }
    this.near = new NearPools(a);
    this.root.add(this.near.group);
    this.pools = [
      new ImpostorPool('veg-impostors-near', a.quad, a.impostors.near, a.impostors.depth, 8192 / CHUNK),
      new ImpostorPool('veg-impostors-far', a.quad, a.impostors.far, null, 32768 / CHUNK),
    ];
    for (const p of this.pools) {
      this.root.add(p.mesh);
    }
    this.applyConfig();
    this.unsubscribeQuality = ctx.quality.onChange((q) => this.onQuality(q));
    const geo = ctx.services.tryGet('geo');
    if (geo) {
      this.startStreaming(geo);
    } else {
      void ctx.services.when('geo').then((g) => this.startStreaming(g));
    }
  }

  private startStreaming(geo: GeoQuery): void {
    if (this.disposed || !this.assets || !this.ctx) {
      return;
    }
    const crown = SPECIES_SHAPES.map((s) => s.crownWidth * 0.5);
    const init = buildPlacementInit(geo, this.assets.species, crown);
    this.streamer = new TileStreamer(geo, init, TILE_SIZE, (t) => this.releaseTile(t), undefined, osmActiveExclusion());
    this.unsubscribeOsm = onOsmExclusionChange((rect) => this.streamer?.invalidate(rect));
    this.colliders = new TreeColliders(this.ctx.services.get('collision'));
    this.initJobs = 0;
  }

  private onQuality(q: QualitySettings): void {
    if (!this.ctx || !this.assets) {
      return;
    }
    const prev = this.cfg;
    this.cfg = lodConfigFor(q);
    rebakeIfNeeded(this.ctx.renderer, this.assets, this.cfg);
    this.applyConfig();
    if (prev && (prev.drawDistance !== this.cfg.drawDistance || prev.densityScale !== this.cfg.densityScale)) {
      this.streamer?.reset();
    } else if (this.streamer) {
      for (const t of this.streamer.tiles.values()) {
        this.assignPool(t, true);
      }
    }
  }

  /** Pushes the (governor scaled) LOD distances into the material uniforms. */
  private applyConfig(): void {
    const cfg = this.cfg;
    const a = this.assets;
    if (!cfg || !a) {
      return;
    }
    const k = this.lodScale;
    const b = this.bands;
    b.lod0 = cfg.lod0 * k;
    b.lod0Fade = cfg.lod0Fade * Math.max(k, 0.6);
    b.lod1 = Math.max(cfg.lod1 * Math.sqrt(k), b.lod0 + 30);
    b.lod1Fade = cfg.lod1Fade;
    b.shadow = cfg.meshShadowRange * k;
    a.trees.fade0.set(-1, 0, b.lod0 - b.lod0Fade, b.lod0 + b.lod0Fade);
    a.trees.fade1.set(b.lod0 - b.lod0Fade, b.lod0 + b.lod0Fade, b.lod1 - b.lod1Fade, b.lod1 + b.lod1Fade);
    a.trees.fadeDepth.set(-1, 0, b.shadow, b.shadow + 0.01);
    a.impostors.fadeNear.set(b.lod1 - b.lod1Fade, b.lod1 + b.lod1Fade, 1e9, 1e9);
    a.impostors.fadeFar.set(b.lod1 - b.lod1Fade, b.lod1 + b.lod1Fade, cfg.drawDistance * 0.86, cfg.drawDistance);
    a.impostors.fadeDepth.set(b.shadow, b.shadow + 0.01, 1e9, 1e9);
    a.impostors.uniforms.uVegThin.value.set(cfg.fullDensityDistance, 0.06, 0.3, 1.45);
  }

  update(_dt: number, ctx: EngineContext): void {
    const streamer = this.streamer;
    const cfg = this.cfg;
    if (!streamer || !cfg || !this.near) {
      return;
    }
    const cam = ctx.camera.position;
    const evaluated = streamer.update(cam.x, cam.z, cfg.drawDistance, cfg.densityScale);
    streamer.drainLoaded(this.loadedScratch);
    if (evaluated) {
      this.assignPools();
    }
    for (const t of this.loadedScratch) {
      this.assignPool(t);
    }
    this.flushWrites();
    this.colliders?.update(evaluated || this.loadedScratch.length > 0 ? streamer.tiles.values() : null);
    this.updateNear(cam, evaluated || this.loadedScratch.length > 0);
    this.updateBounds(cam);
  }

  /** Re-derives pool membership and far thinning level of every loaded tile after the camera moved. */
  private assignPools(): void {
    for (const t of this.streamer!.tiles.values()) {
      this.assignPool(t);
    }
  }

  private assignPool(t: VegTile, force = false): void {
    const cfg = this.cfg!;
    if (t.state !== TileState.Ready || t.count === 0) {
      return;
    }
    let pool = t.pool;
    if (pool < 0) {
      pool = t.dist < cfg.impostorShadowRange ? NEAR : FAR;
    } else if (pool === NEAR && t.dist > cfg.impostorShadowRange + POOL_HYSTERESIS) {
      pool = FAR;
    } else if (pool === FAR && t.dist < cfg.impostorShadowRange - POOL_HYSTERESIS) {
      pool = NEAR;
    }
    const keep = pool === NEAR ? 1 : tileKeepLevel(t.dist, cfg);
    const want = Math.min(t.count, Math.ceil(t.count * keep));
    if (pool !== t.pool || want !== t.written || force) {
      if (pool !== t.pool && t.pool >= 0) {
        this.pools[t.pool].release(t.chunks);
        t.written = 0;
      }
      t.pool = pool;
      if (!t.queued) {
        t.queued = true;
        this.writeQueue.push(t);
      }
    }
  }

  private flushWrites(): void {
    if (this.writeQueue.length === 0) {
      return;
    }
    // Nearest tiles first.
    this.writeQueue.sort((a, b) => b.dist - a.dist);
    let budget = WRITE_BUDGET;
    const scratch = this.chunkScratch;
    while (this.writeQueue.length > 0 && budget > 0) {
      const t = this.writeQueue.pop()!;
      t.queued = false;
      if (t.pool < 0 || this.streamer?.tiles.get(t.key) !== t) {
        continue;
      }
      const pool = this.pools[t.pool];
      const keep = t.pool === NEAR ? 1 : tileKeepLevel(t.dist, this.cfg!);
      const want = Math.min(t.count, Math.ceil(t.count * keep));
      const chunks = Math.ceil(want / CHUNK);
      if (chunks !== t.chunks.length) {
        pool.release(t.chunks);
        pool.allocate(chunks, scratch);
        t.chunks = scratch.slice();
      }
      pool.write(t.chunks, t.instances, want);
      t.written = want;
      budget -= Math.max(want, CHUNK);
    }
  }

  private releaseTile(t: VegTile): void {
    if (t.pool >= 0) {
      this.pools[t.pool].release(t.chunks);
    }
    t.pool = -1;
    t.written = 0;
    this.colliders?.release(t);
  }

  /** Rebuilds the mesh LOD pools when the camera moved; runs the triangle governor. */
  private updateNear(cam: THREE.Vector3, tilesChanged: boolean): void {
    this.rebuildAge++;
    const moved = cam.distanceToSquared(this.lastRebuild);
    if (moved < 0.25 && !tilesChanged && this.rebuildAge < 30) {
      return;
    }
    this.rebuildAge = 0;
    this.lastRebuild.copy(cam);
    const b = this.bands;
    const reach = b.lod1 + b.lod1Fade + b.margin + 40;
    this.nearTiles.length = 0;
    for (const t of this.streamer!.tiles.values()) {
      if (t.state === TileState.Ready && t.count > 0) {
        const dx = Math.max(t.x0 - cam.x, cam.x - (t.x0 + TILE_SIZE), 0);
        const dz = Math.max(t.z0 - cam.z, cam.z - (t.z0 + TILE_SIZE), 0);
        if (dx * dx + dz * dz < reach * reach) {
          this.nearTiles.push(t);
        }
      }
    }
    this.near!.rebuild(this.nearTiles, cam, b, this.heights, this.radii);
    this.govern();
  }

  /** Scales LOD distances so the estimated vegetation triangle load stays within the preset budget. */
  private govern(): void {
    const a = this.assets!;
    const c = this.near!.counts;
    let tris = 0;
    for (let s = 0; s < SPECIES_COUNT; s++) {
      const [t0, t1] = a.species[s].triangles;
      tris += c.lod0[s] * t0 + c.lod1[s] * t1 + c.shadow[s] * t1 * 2;
    }
    tris += this.pools[NEAR].instanceCount * 2 * 3 + this.pools[FAR].instanceCount * 2;
    const budget = this.cfg!.triangleBudget;
    const prev = this.lodScale;
    if (tris > budget) {
      this.lodScale = Math.max(0.35, this.lodScale * 0.93);
    } else if (tris < budget * 0.75) {
      this.lodScale = Math.min(1, this.lodScale * 1.02);
    }
    if (this.lodScale !== prev) {
      this.applyConfig();
    }
    this.lastTriangles = tris;
  }

  private lastTriangles = 0;

  private updateBounds(cam: THREE.Vector3): void {
    const cfg = this.cfg!;
    this.pools[NEAR].setBounds(cam, cfg.impostorShadowRange + POOL_HYSTERESIS + TILE_SIZE * 1.5);
    this.pools[FAR].setBounds(cam, cfg.drawDistance + TILE_SIZE * 1.5);
  }

  pending(): number {
    if (this.initJobs > 0) {
      return this.initJobs;
    }
    if (!this.streamer) {
      return 0;
    }
    return this.streamer.pending() + this.writeQueue.length;
  }

  /** Debug snapshot (sandbox / console). */
  stats(): Record<string, number> {
    const c = this.near?.counts;
    const sum = (v: number[] | undefined): number => (v ? v.reduce((x, y) => x + y, 0) : 0);
    let trees = 0;
    let tiles = 0;
    for (const t of this.streamer?.tiles.values() ?? []) {
      tiles++;
      trees += t.count;
    }
    return {
      tiles,
      trees,
      lod0: sum(c?.lod0),
      lod1: sum(c?.lod1),
      shadow: sum(c?.shadow),
      impostorsNear: this.pools[NEAR]?.instanceCount ?? 0,
      impostorsFar: this.pools[FAR]?.instanceCount ?? 0,
      lodScale: Math.round(this.lodScale * 100) / 100,
      estTriangles: this.lastTriangles,
      colliderOps: this.colliders?.pendingOps ?? 0,
    };
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribeQuality?.();
    this.unsubscribeOsm?.();
    this.colliders?.dispose();
    this.streamer?.dispose();
    this.near?.dispose();
    for (const p of this.pools) {
      p.dispose();
    }
    this.assets?.dispose();
    this.root.removeFromParent();
  }
}
