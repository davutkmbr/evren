/**
 * Buildings layer: OSM outlines, building:part records and infill parcels become one facade mesh and one roof mesh
 * (buildings.worker.ts), rooftop / minaret prop instances, streamed near-LOD facade details (lod.ts) and one box
 * collider per building. Draw calls: facade, roof, six prop kinds and up to eleven detail kinds.
 */
import * as THREE from 'three';
import type { CollisionWorld } from '../../../core/collision';
import type { OsmData, OsmPoint } from '../data';
import { LayerBase } from '../shared/layer';
import { findPassages } from '../shared/passages';
import { InstanceLod, type InstanceLodOptions } from '../shared/instance-lod';
import { LodTiledMesh } from '../shared/lod-tiles';
import { countTriangles } from '../shared/three';
import { runWorker } from '../shared/worker';
import type { OsmContext, OsmLayer } from '../types';
import { isWallOwned } from '../../landmarks/walls/system/owned';
import { landmarkClaims } from '../../landmarks/claims';
import { Poi } from './build';
import { streetAreaRects } from '../street-areas';
import { DETAIL_KINDS } from './details';
import { DetailLod } from './lod';
import { type BuildingMaterials, createBuildingMaterials } from './materials';
import { antennaGeometry, chimneyGeometry, dishGeometry, minaretGeometry, solarGeometry, tankGeometry } from './props';
import { type BuildingsRequest, type BuildingsResult, decodePrisms } from './protocol';
import type { PropKind } from './roofs';

const FOOD = /^amenity=(restaurant|cafe|fast_food|bar|pub|ice_cream|nightclub|biergarten)$|^shop=(bakery|confectionery|pastry|coffee|tea|deli)$/;
const SERVICE = /^amenity=(bank|pharmacy|bureau_de_change|post_office|dentist|doctors|clinic)$|^office=/;
const HOTEL = /^tourism=(hotel|hostel|guest_house|motel)$/;

/** Shop-front POIs as x, z, Poi kind triples. */
export function poiTriples(points: readonly OsmPoint[]): Float32Array {
  const out: number[] = [];
  for (const p of points) {
    const kind = FOOD.test(p.kind) ? Poi.Food : SERVICE.test(p.kind) ? Poi.Service : HOTEL.test(p.kind) ? Poi.Hotel : p.kind.startsWith('shop=') && p.kind !== 'shop=kiosk' ? Poi.Shop : 0;
    if (kind) {
      out.push(p.x, p.z, kind);
    }
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

/**
 * Rooftop props: drawn within `radius`, casting shadows within `shadowRadius` (m at the "high" preset). A 1 m tank is
 * ~1.5 px at 650 m; drawing the whole slice's 7000 tanks into every shadow cascade used to cost ~5 M triangles a frame.
 */
const PROP_LOD: Record<PropKind, InstanceLodOptions> = {
  tank: { radius: 650, shadowRadius: 220 },
  solar: { radius: 800, shadowRadius: 260 },
  chimney: { radius: 550, shadowRadius: 200 },
  dish: { radius: 450, shadowRadius: 0 },
  antenna: { radius: 420, shadowRadius: 0 },
  minaret: { radius: Infinity, shadowRadius: Infinity },
};

/**
 * Facades and roofs switch to their far version (walls, cornice fronts, roof planes and caps; no string courses,
 * cornice tops, eaves, ridge caps or parapets) beyond this distance (m at "high"): the parts it drops are at most
 * ~0.6 m, one pixel at 1600 x 900 and 60 degrees there. The far version also fills the far shadow cascades and the
 * water reflection. `?osmlod=0` turns it off for A/B comparisons.
 */
const SHELL_FAR_DISTANCE = 450;

class BuildingsLayer extends LayerBase {
  private readonly shells: LodTiledMesh[] = [];
  private collision: CollisionWorld | null = null;
  private colliderIds: number[] = [];
  private lod: DetailLod | null = null;
  private readonly props: InstanceLod[] = [];

  constructor(ctx: OsmContext, data: OsmData) {
    super('buildings');
    const materials = createBuildingMaterials(ctx.engine.renderer, DETAIL_KINDS);
    this.onDispose(() => materials.dispose());
    const worker = new Worker(new URL('./buildings.worker.ts', import.meta.url), { type: 'module', name: 'osm-buildings' });
    const request: BuildingsRequest = {
      base: ctx.base,
      // Towers and gate pylons of the city walls are drawn by the walls system.
      buildings: data.buildings.filter((b) => !isWallOwned(b.id)),
      pois: poiTriples(data.points),
      // Modelled landmarks keep their ground (pads, line bodies such as the aqueduct): no OSM building through them.
      claims: landmarkClaims(ctx.geo),
      passages: findPassages(data.buildings, data.roads),
      infill: { roads: data.roads, areas: data.areas, rails: data.rails, keepOut: streetAreaRects().map((a) => a.rect) },
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
    const preset = ctx.engine.quality.settings.preset;
    for (const s of this.shells) {
      s.update(cam, preset);
    }
    for (const p of this.props) {
      p.update(cam, preset);
    }
  }

  private upload(ctx: OsmContext, res: BuildingsResult, materials: BuildingMaterials, workerMs: number): void {
    const t1 = performance.now();
    const lodOn = ctx.engine.debug.params.get('osmlod') !== '0';
    for (const [name, arrays, leaves, material] of [
      ['osm-facade', res.facade, res.facadeTiles, materials.facade],
      ['osm-roof', res.roof, res.roofTiles, materials.roof],
    ] as const) {
      if (arrays.index.length) {
        const shell = new LodTiledMesh(this.group, name, arrays, leaves, material, { distance: SHELL_FAR_DISTANCE, castShadow: true, reflection: true });
        shell.setEnabled(lodOn);
        this.shells.push(shell);
      }
    }
    for (const k of Object.keys(PROP_GEOMETRY) as PropKind[]) {
      const records = res.props[k];
      if (records?.length) {
        this.props.push(new InstanceLod(this.group, `osm-${k}`, records, PROP_GEOMETRY[k](), materials.prop, PROP_LOD[k]));
      }
    }
    this.lod = new DetailLod(this.group, res.details, res.tiles, materials, ctx.engine.quality.settings.preset);
    this.update(0, ctx);

    const collision = ctx.engine.services.get('collision');
    this.collision = collision;
    decodePrisms(res.colliders, (bottom, top, rings, i) => {
      this.colliderIds.push(collision.add({ kind: 'prism', rings, bottom, top }, 'building', `osm-building:${res.colliderIds[i]}`));
    });
    this.onDispose(() => {
      this.collision?.removeMany(this.colliderIds);
      this.colliderIds = [];
    });
    const debug = window as unknown as { __osmBuildings?: unknown };
    debug.__osmBuildings = { stats: res.stats, lod: () => this.lod?.counts(), shells: () => this.shells.map((s) => ({ name: s.name, ...s.counts() })) };
    console.info(
      `[osm:buildings] worker ${Math.round(workerMs)} ms ${JSON.stringify(res.stats)}, upload ${Math.round(performance.now() - t1)} ms, ${this.group.children.length} draws, ${countTriangles(this.group)} tris`,
    );
  }
}

export function createBuildingsLayer(ctx: OsmContext, data: OsmData): OsmLayer {
  return new BuildingsLayer(ctx, data);
}
