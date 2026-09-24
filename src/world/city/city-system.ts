/**
 * Procedural Istanbul city fabric: streams building chunks (3 LOD levels) generated in workers around the camera,
 * street/road lights and aviation beacons, and building colliders around the dragon.
 */
import * as THREE from 'three';
import type { EngineContext, GeoQuery, System } from '../../core/contracts';
import { RenderLayers, UpdateOrder } from '../../core/contracts';
import type { QualitySettings } from '../../core/quality';
import { CityColliders } from './colliders';
import { osmExclusionRect } from '../osm/area';
import { GeoWindowCutter, buildInitMessage, buildOccupancy } from './geo-window';
import { LampPool } from './lamps';
import { CityMaterials } from './materials/building-material';
import { BASE_CELL, LEVEL_COUNT, LEVEL_SIZES } from './protocol';
import { CityStreamer, type CityLodParams, type StreamStats } from './streamer';
import { CityWorkerPool } from './worker-pool';

const WORLD_HALF = 24000;
const COLLIDER_TILE = LEVEL_SIZES[0];
const COLLIDER_MARGIN = 130;
const MAX_COLLIDER_JOBS_PER_WORKER = 3;

interface LevelMask {
  n: number;
  data: Uint8Array;
}

function levelMasks(base: Uint8Array): LevelMask[] {
  const baseN = Math.round((WORLD_HALF * 2) / BASE_CELL);
  const masks: LevelMask[] = [];
  for (let l = 0; l < LEVEL_COUNT; l++) {
    const span = LEVEL_SIZES[l] / BASE_CELL;
    const n = baseN / span;
    const data = new Uint8Array(n * n);
    for (let j = 0; j < baseN; j++) {
      for (let i = 0; i < baseN; i++) {
        if (base[j * baseN + i]) {
          data[Math.floor(j / span) * n + Math.floor(i / span)] = 1;
        }
      }
    }
    masks.push({ n, data });
  }
  return masks;
}

function lodParams(q: QualitySettings): CityLodParams {
  const draw = q.cityDrawDistance;
  const scale = q.preset === 'low' ? 0.7 : q.preset === 'medium' ? 0.85 : q.preset === 'ultra' ? 1.25 : 1;
  return {
    drawDistance: draw,
    split0: 800 * scale,
    split1: Math.min(draw * 0.4, 3000 * scale),
    densityScale: q.cityDensityScale,
    shadowDistance: q.shadowDistance * 1.1,
    classFade: [draw, draw * 0.84, draw * 0.7, draw * 0.56],
  };
}

function workerCount(): number {
  const hc = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
  return Math.max(2, Math.min(4, Math.floor(hc / 3)));
}

export interface CityDebugApi {
  stats(): StreamStats & { colliderTiles: number; pendingColliders: number };
  clear(): void;
  /** 0 shaded, 1 emissive only, 2 albedo, 3 lighting without emission. */
  debugView(mode: number): void;
}

export class CitySystem implements System {
  readonly name = 'city';
  readonly order = UpdateOrder.World;

  private pool: CityWorkerPool | null = null;
  private streamer: CityStreamer | null = null;
  private colliders: CityColliders | null = null;
  private materials: CityMaterials | null = null;
  private lamps: LampPool | null = null;
  private cutter: GeoWindowCutter | null = null;
  private masks: LevelMask[] = [];
  private densityScale = 1;
  private unsubscribe: (() => void) | null = null;
  private readonly colliderCenter = new THREE.Vector3();

  async init(ctx: EngineContext): Promise<void> {
    const geo = await ctx.services.when('geo');
    this.setup(ctx, geo);
  }

  private setup(ctx: EngineContext, geo: GeoQuery): void {
    const t0 = performance.now();
    this.masks = levelMasks(buildOccupancy(geo, BASE_CELL));
    this.cutter = new GeoWindowCutter(geo, osmExclusionRect());
    this.pool = new CityWorkerPool(workerCount());
    this.pool.init(buildInitMessage(geo));

    this.materials = new CityMaterials();
    const b = geo.bounds;
    this.materials.setHeightTexture(geo.getHeightTexture(), b.minX, b.minZ, b.maxX - b.minX);

    this.lamps = new LampPool(98304);
    this.lamps.points.layers.set(RenderLayers.NoReflection);
    ctx.scene.add(this.lamps.points);

    const q = ctx.quality.settings;
    this.densityScale = q.cityDensityScale;
    const occupied = (level: number, ix: number, iz: number): boolean => {
      const m = this.masks[level];
      return ix >= 0 && iz >= 0 && ix < m.n && iz < m.n && m.data[iz * m.n + ix] === 1;
    };
    this.streamer = new CityStreamer(this.pool, this.cutter, this.materials, this.lamps, occupied, lodParams(q));
    ctx.scene.add(this.streamer.group);

    this.colliders = new CityColliders(ctx.services.get('collision'), (ix, iz) => occupied(0, ix, iz));
    this.colliders.setRadius(2800);

    this.unsubscribe = ctx.quality.onChange((s) => {
      this.densityScale = s.cityDensityScale;
      this.streamer?.setParams(lodParams(s));
    });

    const api: CityDebugApi = {
      stats: () => ({
        ...this.streamer!.stats(),
        colliderTiles: this.colliders!.tileCount,
        pendingColliders: this.colliders!.pending(),
      }),
      clear: () => {
        this.streamer?.clear();
        this.colliders?.clear();
      },
      debugView: (mode: number) => {
        this.materials!.debugView.value = mode;
      },
    };
    const debugParam = ctx.debug.params.get('cityDebug');
    if (debugParam) {
      this.materials.debugView.value = Number(debugParam);
    }
    (window as unknown as { __city?: CityDebugApi }).__city = api;
    console.info(`[city] ready: ${this.pool.size} workers, setup ${Math.round(performance.now() - t0)} ms`);
  }

  update(dt: number, ctx: EngineContext): void {
    if (!this.streamer || !this.colliders || !this.pool || !this.cutter) {
      return;
    }
    const t0 = performance.now();
    ctx.camera.updateMatrixWorld();
    this.streamer.update(ctx.time.paused ? ctx.time.realDt : dt, ctx.camera, 1.2);
    const dragon = ctx.services.tryGet('dragon');
    this.colliderCenter.copy(dragon ? dragon.position : ctx.camera.position);
    const remaining = Math.max(0.2, 1.8 - (performance.now() - t0));
    this.colliders.update(this.colliderCenter, (ix, iz, done) => this.requestColliders(ix, iz, done), remaining);
  }

  private requestColliders(ix: number, iz: number, done: (boxes: Float32Array) => void): boolean {
    const pool = this.pool!;
    const route = (ix >> 2) * 7 + (iz >> 2) * 13;
    if (pool.load(route) >= MAX_COLLIDER_JOBS_PER_WORKER) {
      return false;
    }
    const x0 = -WORLD_HALF + ix * COLLIDER_TILE;
    const z0 = -WORLD_HALF + iz * COLLIDER_TILE;
    const win = this.cutter!.cut(x0 - COLLIDER_MARGIN, z0 - COLLIDER_MARGIN, x0 + COLLIDER_TILE + COLLIDER_MARGIN, z0 + COLLIDER_TILE + COLLIDER_MARGIN);
    pool.submit(route, { type: 'colliders', ix, iz, size: COLLIDER_TILE, densityScale: this.densityScale, win }, (res) => {
      if (res.type === 'colliders') {
        done(res.boxes);
      }
    });
    return true;
  }

  pending(): number {
    return (this.streamer?.pending() ?? 0) + (this.colliders?.pending() ?? 0);
  }

  dispose(): void {
    this.unsubscribe?.();
    this.streamer?.clear();
    this.colliders?.clear();
    this.streamer?.group.removeFromParent();
    this.lamps?.points.removeFromParent();
    this.lamps?.dispose();
    this.materials?.dispose();
    this.pool?.dispose();
    this.streamer = null;
    this.colliders = null;
    this.pool = null;
  }
}
