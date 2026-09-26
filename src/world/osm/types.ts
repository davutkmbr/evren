/**
 * Layer contract of the OSM slice (src/world/osm). index.ts loads the data, builds the shared foundation
 * (OsmContext) and calls one factory per layer folder; every layer owns its folder, main-thread side and worker:
 *
 *   buildings/ createBuildingsLayer  facades, roofs, rooftop clutter, building colliders   (buildings.worker.ts)
 *   streets/   createStreetsLayer    ground mesh, street surfaces, markings, rails, lamps   (streets.worker.ts)
 *   traffic/   createTrafficLayer    vehicles and trams on the OSM street graph
 *   details/   createDetailsLayer    trees, parks, pedestrians, waterfront and small life   (details.worker.ts)
 *   shared/    foundation and helpers used by several layers (street raster + StreetSurface query, terrain
 *              sampling, ground grid, footprints, mesh buffers, worker plumbing, texture loading, prop helpers).
 *
 * Rules for parallel work: a layer only edits its own folder. shared/street-field.ts and shared/street-surface.ts
 * belong to the streets layer (everyone else reads them). Other shared files are append-only helpers. index.ts,
 * area.ts, data.ts and types.ts are the foundation's.
 *
 * Heavy generation runs in the layer's module worker: create it in the layer's own file with
 * `new Worker(new URL('./x.worker.ts', import.meta.url), { type: 'module' })`, post `{ base: ctx.base, ... }` with
 * runWorker() (shared/worker.ts) and answer with serveWorker() in the worker. `ctx.base` is structured-cloned, never
 * transferred (every layer gets its own copy).
 */
import type * as THREE from 'three';
import type { EngineContext, GeoQuery, WorldBounds } from '../../core/contracts';
import type { OsmData } from './data';
import type { OsmWorkerBase } from './shared/protocol';
import type { StreetSurface } from './shared/street-surface';

export interface OsmContext {
  readonly engine: EngineContext;
  readonly geo: GeoQuery;
  /** The region's own area in local metres (OSM_AREA for the Galata slice). */
  readonly area: WorldBounds;
  /** Area plus seam: the build rect, where OSM content replaces procedural content. */
  readonly rect: WorldBounds;
  /**
   * Where the ground and ground cover fade out into the terrain: `rect`, except on sides shared with another OSM
   * region (regions.ts OsmRegionDef.fade), where the neighbour's ground continues seamlessly.
   */
  readonly fade: WorldBounds;
  /** Plain-data foundation for layer workers (geo windows, landmark pads, street raster). */
  readonly base: OsmWorkerBase;
  /** Main-thread street surface query (same data the workers and the ground shader use). */
  readonly surface: StreetSurface;
}

export interface OsmLayer {
  /** Root of everything the layer draws; index.ts adds it to the scene. */
  readonly group: THREE.Object3D;
  /** Per-frame update (dt = clamped simulation dt, 0 when paused). */
  update?(dt: number, ctx: OsmContext): void;
  /** Outstanding async jobs (workers, texture loads); screenshot tooling waits for 0. */
  pending?(): number;
  /** Frees GPU resources, workers and colliders. */
  dispose(): void;
}

export type OsmLayerFactory = (ctx: OsmContext, data: OsmData) => OsmLayer;
