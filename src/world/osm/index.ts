/**
 * OSM vertical slice (Eminönü, Galata Bridge, Karaköy, Galata, Tophane, Cihangir): real OpenStreetMap streets,
 * buildings, traffic and details. Only active with `?osm=1`; the city, vegetation and life systems then keep their
 * procedural buildings, urban trees and road traffic out of the area (area.ts osmExclusionRect()).
 *
 * This system loads the data (data.ts), builds the shared foundation once (geo windows + street raster in
 * shared/foundation.worker.ts, see types.ts OsmContext) and orchestrates the four layers; each layer builds its
 * geometry in its own module worker. Data © OpenStreetMap contributors (ODbL), fetched by scripts/data/fetch-osm.mjs.
 */
import * as THREE from 'three';
import type { EngineContext, GeoQuery, System } from '../../core/contracts';
import { UpdateOrder } from '../../core/contracts';
import { OSM_DATA_URL, osmAreaRect, osmEnabled, osmExclusionRect } from './area';
import { loadOsmData, type OsmData } from './data';
import { buildWorkerBase } from './shared/foundation';
import { FootprintIndex } from './shared/footprints';
import { StreetSurface } from './shared/street-surface';
import type { OsmContext, OsmLayer, OsmLayerFactory } from './types';

/**
 * Layers load independently: a layer that fails to import or build (e.g. mid-edit during development) is
 * skipped with a console error instead of taking the whole OSM area (or the game) down.
 */
const LAYER_LOADERS: readonly { name: string; load: () => Promise<OsmLayerFactory> }[] = [
  { name: 'streets', load: () => import('./streets').then((m) => m.createStreetsLayer) },
  { name: 'buildings', load: () => import('./buildings').then((m) => m.createBuildingsLayer) },
  { name: 'traffic', load: () => import('./traffic').then((m) => m.createTrafficLayer) },
  { name: 'details', load: () => import('./details').then((m) => m.createDetailsLayer) },
];

/** Debug handle: window.__osm (context, data and layers once loaded). */
export interface OsmDebug {
  ctx: OsmContext | null;
  data: OsmData | null;
  layers: readonly OsmLayer[];
}

class OsmSystem implements System {
  readonly name = 'osm';
  readonly order = UpdateOrder.World;
  private readonly root = new THREE.Group();
  private readonly layers: OsmLayer[] = [];
  private ctx: OsmContext | null = null;
  private data: OsmData | null = null;
  private loading = 0;
  private cancel: (() => void) | null = null;
  private disposed = false;

  init(engine: EngineContext): void {
    if (!osmEnabled(engine.debug.params)) {
      return;
    }
    this.root.name = 'osm';
    engine.scene.add(this.root);
    this.loading = 1;
    void engine.services
      .when('geo')
      .then((geo) => this.load(engine, geo))
      .catch((e: unknown) => {
        if (!this.disposed) {
          console.error('[osm] failed to load', e);
        }
      })
      .finally(() => {
        this.loading = 0;
      });
    const system = this;
    (window as unknown as { __osm: OsmDebug }).__osm = {
      get ctx() {
        return system.ctx;
      },
      get data() {
        return system.data;
      },
      layers: this.layers,
    };
  }

  pending(): number {
    let n = this.loading;
    for (const l of this.layers) {
      n += l.pending?.() ?? 0;
    }
    return n;
  }

  update(dt: number): void {
    const ctx = this.ctx;
    if (!ctx) {
      return;
    }
    for (const l of this.layers) {
      l.update?.(dt, ctx);
    }
  }

  private async load(engine: EngineContext, geo: GeoQuery): Promise<void> {
    const t0 = performance.now();
    const data = await loadOsmData(OSM_DATA_URL);
    if (this.disposed) {
      return;
    }
    const t1 = performance.now();
    const job = buildWorkerBase(geo, data, osmExclusionRect(), osmAreaRect());
    this.cancel = job.cancel;
    const { base, ms } = await job.promise;
    this.cancel = null;
    if (this.disposed) {
      return;
    }
    const ctx: OsmContext = {
      engine,
      geo,
      area: base.area,
      rect: base.rect,
      base,
      surface: new StreetSurface(base),
      footprints: new FootprintIndex(data.buildings),
    };
    this.ctx = ctx;
    this.data = data;
    const t2 = performance.now();
    const factories = await Promise.all(
      LAYER_LOADERS.map((l) =>
        l.load().catch((e: unknown) => {
          console.error(`[osm] layer "${l.name}" failed to load, skipping it`, e);
          return null;
        }),
      ),
    );
    factories.forEach((factory, i) => {
      if (!factory || this.disposed) {
        return;
      }
      try {
        const layer = factory(ctx, data);
        this.layers.push(layer);
        this.root.add(layer.group);
      } catch (e) {
        console.error(`[osm] layer "${LAYER_LOADERS[i].name}" failed to build, skipping it`, e);
      }
    });
    console.info(
      `[osm] data ${Math.round(t1 - t0)} ms (${data.buildings.length} buildings, ${data.roads.length} roads, ${data.points.length} points), street raster ${base.street.w}x${base.street.h} in ${ms} ms (total ${Math.round(t2 - t1)} ms), layers started`,
    );
  }

  dispose(): void {
    this.disposed = true;
    this.cancel?.();
    for (const l of this.layers) {
      l.dispose();
    }
    this.layers.length = 0;
    this.root.removeFromParent();
  }
}

export function createOsmSystem(): System {
  return new OsmSystem();
}
