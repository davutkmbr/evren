/**
 * Buildings layer: OSM outlines, building:part records and infill parcels become one facade mesh and one roof mesh
 * (buildings.worker.ts), rooftop / minaret prop instances, streamed near-LOD facade details (lod.ts) and one box
 * collider per building. Draw calls: facade, roof, six prop kinds and up to eleven detail kinds.
 */
import * as THREE from 'three';
import type { CollisionWorld } from '../../../core/collision';
import type { GeoQuery } from '../../../core/contracts';
import type { OsmData, OsmPoint } from '../data';
import { LayerBase } from '../shared/layer';
import { COLLIDER_STRIDE } from '../shared/protocol';
import { addInstanced, addMesh, countTriangles } from '../shared/three';
import { runWorker } from '../shared/worker';
import type { OsmContext, OsmLayer } from '../types';
import { Poi } from './build';
import { DETAIL_KINDS } from './details';
import { DetailLod } from './lod';
import { type BuildingMaterials, createBuildingMaterials } from './materials';
import { antennaGeometry, chimneyGeometry, dishGeometry, minaretGeometry, solarGeometry, tankGeometry } from './props';
import type { BuildingsRequest, BuildingsResult } from './protocol';
import type { PropKind } from './roofs';

const FOOD = /^amenity=(restaurant|cafe|fast_food|bar|pub|ice_cream|nightclub|biergarten)$|^shop=(bakery|confectionery|pastry|coffee|tea|deli)$/;
const SERVICE = /^amenity=(bank|pharmacy|bureau_de_change|post_office|dentist|doctors|clinic)$|^office=/;
const HOTEL = /^tourism=(hotel|hostel|guest_house|motel)$/;

/** Shop-front POIs as x, z, Poi kind triples. */
function poiTriples(points: readonly OsmPoint[]): Float32Array {
  const out: number[] = [];
  for (const p of points) {
    const kind = FOOD.test(p.kind) ? Poi.Food : SERVICE.test(p.kind) ? Poi.Service : HOTEL.test(p.kind) ? Poi.Hotel : p.kind.startsWith('shop=') && p.kind !== 'shop=kiosk' ? Poi.Shop : 0;
    if (kind) {
      out.push(p.x, p.z, kind);
    }
  }
  return new Float32Array(out);
}

/** Modelled landmarks (and neighbourhood mosques) whose footprint OSM buildings must leave free; bridges and walls are linear and excluded. */
function landmarkPads(geo: GeoQuery): Float32Array {
  const out: number[] = [];
  for (const l of geo.landmarks) {
    if (l.kind === 'bridge' || l.kind === 'walls') {
      continue;
    }
    out.push(l.x, l.z, l.radius);
  }
  for (const m of geo.smallMosqueSites) {
    out.push(m.x, m.z, m.radius);
  }
  return new Float32Array(out);
}

const PROP_GEOMETRY: Record<PropKind, () => THREE.BufferGeometry> = {
  chimney: chimneyGeometry,
  tank: tankGeometry,
  solar: solarGeometry,
  dish: dishGeometry,
  antenna: antennaGeometry,
  minaret: minaretGeometry,
};

class BuildingsLayer extends LayerBase {
  private collision: CollisionWorld | null = null;
  private colliderIds: number[] = [];
  private lod: DetailLod | null = null;

  constructor(ctx: OsmContext, data: OsmData) {
    super('buildings');
    const materials = createBuildingMaterials(ctx.engine.renderer, DETAIL_KINDS);
    this.onDispose(() => materials.dispose());
    const worker = new Worker(new URL('./buildings.worker.ts', import.meta.url), { type: 'module', name: 'osm-buildings' });
    const request: BuildingsRequest = {
      base: ctx.base,
      buildings: data.buildings,
      pois: poiTriples(data.points),
      pads: landmarkPads(ctx.geo),
      infill: { roads: data.roads, areas: data.areas, rails: data.rails },
    };
    const job = runWorker<BuildingsRequest, BuildingsResult>(worker, request);
    this.onDispose(() => job.cancel());
    const t0 = performance.now();
    this.track(
      Promise.all([job.promise, materials.ready]).then(([res]) => {
        if (!this.disposed) {
          this.upload(ctx, res, materials, performance.now() - t0);
        }
      }),
    );
    const off = ctx.engine.quality.onChange(() => this.lod?.setPreset(ctx.engine.quality.settings.preset));
    this.onDispose(off);
  }

  update(_dt: number, ctx: OsmContext): void {
    const cam = ctx.engine.camera.position;
    this.lod?.update(cam, cam.y - ctx.geo.heightAt(cam.x, cam.z));
  }

  private upload(ctx: OsmContext, res: BuildingsResult, materials: BuildingMaterials, workerMs: number): void {
    const t1 = performance.now();
    addMesh(this.group, 'osm-facade', res.facade, materials.facade, { castShadow: true });
    addMesh(this.group, 'osm-roof', res.roof, materials.roof, { castShadow: true });
    for (const k of Object.keys(PROP_GEOMETRY) as PropKind[]) {
      addInstanced(this.group, `osm-${k}`, res.props[k], PROP_GEOMETRY[k](), materials.prop, { castShadow: k !== 'dish' && k !== 'antenna' });
    }
    this.lod = new DetailLod(this.group, res.details, res.tiles, materials, ctx.engine.quality.settings.preset);
    this.update(0, ctx);

    const collision = ctx.engine.services.get('collision');
    const boxes = [];
    const b = res.colliders;
    for (let i = 0; i < b.length; i += COLLIDER_STRIDE) {
      boxes.push({ kind: 'box' as const, center: new THREE.Vector3(b[i], b[i + 1], b[i + 2]), halfSize: new THREE.Vector3(b[i + 3], b[i + 4], b[i + 5]), yaw: b[i + 6] });
    }
    this.collision = collision;
    this.colliderIds = collision.addMany(boxes, 'building');
    this.onDispose(() => {
      this.collision?.removeMany(this.colliderIds);
      this.colliderIds = [];
    });
    const debug = window as unknown as { __osmBuildings?: unknown };
    debug.__osmBuildings = { stats: res.stats, lod: () => this.lod?.counts() };
    console.info(
      `[osm:buildings] worker ${Math.round(workerMs)} ms ${JSON.stringify(res.stats)}, upload ${Math.round(performance.now() - t1)} ms, ${this.group.children.length} draws, ${countTriangles(this.group)} tris`,
    );
  }
}

export function createBuildingsLayer(ctx: OsmContext, data: OsmData): OsmLayer {
  return new BuildingsLayer(ctx, data);
}
