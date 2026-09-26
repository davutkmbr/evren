/**
 * Details layer: everything that makes the slice feel inhabited, built in details.worker.ts and drawn in ~15 draw
 * calls:
 * - ground cover from OSM areas (lawns, soil, park paths, parking) and treated back lots / courtyards (cover/),
 * - trees: OSM trees and tree rows plus park, courtyard and mosque-yard fill (plane, cypress, stone pine, palm),
 * - pedestrians: an event-driven crowd on a walk graph of sidewalks, cobbled lanes, İstiklal, footways, crossings
 *   and squares, plus people waiting at stops, sitting at cafés and on benches, and the anglers of the Galata Bridge,
 * - street furniture (benches, bins, bollards, İETT shelters, kiosks, café tables, simit / chestnut carts),
 * - waterfront: rocking balık-ekmek boats at Eminönü and fishing boats on the quays, mooring bollards, flags and
 *   ground pigeons in front of Yeni Cami. Ferries, piers and flying birds stay with the life module.
 */
import * as THREE from 'three';
import { RenderLayers, type GeoQuery } from '../../../core/contracts';
import type { OsmData } from '../data';
import { LayerBase } from '../shared/layer';
import { InstanceLod, LOD_RADIUS_SCALE } from '../shared/instance-lod';
import { LodTiledMesh } from '../shared/lod-tiles';
import { addMesh, countTriangles, toGeometry } from '../shared/three';
import { runWorker } from '../shared/worker';
import type { OsmContext, OsmLayer } from '../types';
import { createCoverMaterial } from './cover/material';
import { Crowd } from './crowd/crowd';
import { createPropMaterial } from './props/material';
import { STANDER_STRIDE, VERT_STRIDE, type DetailsRequest, type DetailsResult } from './protocol';
import { createFoliageAtlas } from './trees/atlas';
import { createTreeMaterial } from './trees/material';
import { treeGeometries } from './trees/models';
import { TREE_SPECIES } from './trees/species';
import { GalataDeck, placeAnglers, standerArray } from './waterfront/bridge';
import { createFlags } from './waterfront/flags';
import { createPigeons } from './waterfront/pigeons';
import { landmarkClaims } from '../../landmarks/claims';
import { mosquePads } from './mosque-pads';
import { perchClearings } from '../../perches/clearings';

const CROWD_SCALE: Record<string, number> = { low: 0.35, medium: 0.6, high: 1, ultra: 1.2 };
/** Seconds to wait for the structures module's Galata Bridge before starting the crowd without it. */
const DECK_TIMEOUT = 40;

/** Trees shape the city from the air (always drawn) but cast shadows only within this distance (m, "high"). */
const TREE_SHADOW_RADIUS = 450;
/** Camera height above the ground (m) above which the merged street props stop casting shadows (sub-texel there). */
const PROPS_SHADOW_AGL = 120;
/**
 * Merged street props (benches, bins, bollards, shelters, kiosks, café tables) are drawn within this distance of
 * their tile (m at "high"; street furniture instances use 450 m) and cast shadows only into the cascades that start
 * within PROPS_SHADOW_DEPTH (a bench shadow is below a texel of the far cascades).
 */
const PROPS_DISTANCE = 450;
const PROPS_SHADOW_DEPTH = 150;

class DetailsLayer extends LayerBase {
  private crowd: Crowd | null = null;
  private readonly trees: InstanceLod[] = [];
  private props: LodTiledMesh | null = null;
  private kits: LodTiledMesh | null = null;
  private result: DetailsResult | null = null;
  private readonly deck: GalataDeck | null;
  private deckWait = 0;
  private deckNext = 0;
  private waiting = false;
  private readonly propMaterial = createPropMaterial('osm-details-props');
  private stats: Record<string, number> = {};

  constructor(
    private readonly ctx: OsmContext,
    data: OsmData,
  ) {
    super('details');
    this.onDispose(() => this.propMaterial.dispose());
    this.deck = GalataDeck.fromGeo(ctx.geo);
    const worker = new Worker(new URL('./details.worker.ts', import.meta.url), { type: 'module', name: 'osm-details' });
    // Modelled landmarks' ground (landmarks/claims.ts); pads grown by 10 m for trees, furniture and walkers.
    const claims = landmarkClaims(ctx.geo);
    const grown = landmarkClaims(ctx.geo, 10);
    const request: DetailsRequest = {
      base: ctx.base,
      data: { points: data.points, lines: data.lines, areas: data.areas, buildings: data.buildings, roads: data.roads, rails: data.rails },
      crowdScale: CROWD_SCALE[ctx.engine.quality.settings.preset] ?? 1,
      deck: this.deck?.frame ?? null,
      pads: Array.from(grown.pads),
      lines: Array.from(claims.lines),
      infillClaims: claims,
      mosques: mosquePads(ctx.geo),
      clearings: perchClearings(ctx.geo),
    };
    const job = runWorker<DetailsRequest, DetailsResult>(worker, request);
    this.onDispose(() => job.cancel());
    const t0 = performance.now();
    this.track(
      job.promise.then((res) => {
        if (!this.disposed) {
          this.upload(res, performance.now() - t0);
        }
      }),
    );
  }

  override pending(): number {
    return super.pending() + (this.waiting ? 1 : 0);
  }

  private upload(res: DetailsResult, workerMs: number): void {
    const t1 = performance.now();
    const ctx = this.ctx;
    this.result = res;
    if (res.cover) {
      const cover = createCoverMaterial(ctx.engine.renderer, res.cover.raster, ctx.fade);
      this.onDispose(() => cover.dispose());
      const mesh = res.cover.mesh;
      this.track(
        cover.ready.then(() => {
          if (!this.disposed) {
            const m = addMesh(this.group, 'osm-cover', mesh, cover.material, { layer: RenderLayers.NoReflection });
            if (m) {
              m.renderOrder = -1;
            }
          }
        }),
      );
    }
    const atlas = createFoliageAtlas();
    const treeMat = createTreeMaterial(atlas);
    this.onDispose(() => {
      atlas.dispose();
      treeMat.dispose();
    });
    const geos = treeGeometries();
    for (const s of TREE_SPECIES) {
      const records = res.trees[s];
      if (records?.length) {
        this.trees.push(new InstanceLod(this.group, `osm-tree-${s}`, records, geos[s], treeMat, { radius: Infinity, shadowRadius: TREE_SHADOW_RADIUS }));
      } else {
        geos[s].dispose();
      }
    }
    if (res.props && res.propsTiles) {
      this.props = new LodTiledMesh(this.group, 'osm-details-props', res.props, res.propsTiles, this.propMaterial, { distance: PROPS_DISTANCE, shadowDistance: PROPS_SHADOW_DEPTH, castShadow: true });
      this.props.setEnabled(ctx.engine.debug.params.get('osmlod') !== '0');
    }
    if (res.kits && res.kitsTiles) {
      const kitMat = createPropMaterial('osm-details-kits', false, false);
      this.onDispose(() => kitMat.dispose());
      this.kits = new LodTiledMesh(this.group, 'osm-details-kits', res.kits, res.kitsTiles, kitMat, { distance: PROPS_DISTANCE, shadowDistance: PROPS_SHADOW_DEPTH, castShadow: true });
      this.kits.setEnabled(ctx.engine.debug.params.get('osmlod') !== '0');
    }
    if (res.boats) {
      const boatMat = createPropMaterial('osm-boats', true);
      this.onDispose(() => boatMat.dispose());
      const boats = addMesh(this.group, 'osm-boats', res.boats, boatMat, { castShadow: true });
      if (boats) {
        boats.frustumCulled = false;
      }
    }
    const flags = createFlags(res.flags);
    if (flags) {
      this.group.add(flags.mesh);
      this.onDispose(() => flags.dispose());
    }
    const pigeons = createPigeons(res.pigeons);
    if (pigeons) {
      this.group.add(pigeons.mesh);
      this.onDispose(() => pigeons.dispose());
    }
    this.stats = { ...res.stats, workerMs: Math.round(workerMs), uploadMs: Math.round(performance.now() - t1) };
    // The crowd waits for the Galata Bridge walkway heights (anglers, deck lanes).
    if (this.deck) {
      this.waiting = true;
    } else {
      this.startCrowd(null);
    }
  }

  private startCrowd(deck: GalataDeck | null): void {
    const res = this.result;
    if (!res || this.disposed) {
      return;
    }
    this.waiting = false;
    let standers = res.standers;
    if (deck) {
      const anglers = placeAnglers(deck, (x, z) => this.ctx.geo.coastDistance(x, z));
      if (anglers.mesh) {
        const gear = new THREE.Mesh(anglers.mesh, this.propMaterial);
        gear.name = 'osm-bridge-anglers';
        gear.matrixAutoUpdate = false;
        gear.layers.set(RenderLayers.NoReflection);
        this.group.add(gear);
      }
      const extra = standerArray(anglers.standers);
      const merged = new Float32Array(standers.length + extra.length);
      merged.set(standers);
      merged.set(extra, standers.length);
      standers = merged;
      this.stats.anglers = anglers.count;
    }
    // Deck vertices of the walk graph: Galata walkways from the sampled profile, other bridges from the deck query
    // (vertices left NaN are skipped by the crowd).
    const v = res.walk.verts;
    let lifted = 0;
    for (let o = 0; o < v.length; o += VERT_STRIDE) {
      if (Number.isNaN(v[o + 1])) {
        const y = deck?.walkwayAt(v[o], v[o + 2]) ?? this.ctx.surface.deckAt(v[o], v[o + 2]);
        if (y !== null && y > 0.5) {
          v[o + 1] = y;
          lifted++;
        }
      }
    }
    this.stats.deckVerts = lifted;
    const crowd = new Crowd(res.walk, standers, CROWD_SCALE[this.ctx.engine.quality.settings.preset] ?? 1, this.ctx.engine.time.elapsed);
    this.crowd = crowd;
    this.group.add(crowd.group);
    this.onDispose(() => crowd.dispose());
    this.stats.walkers = crowd.stats.walkers;
    this.stats.standers = standers.length / STANDER_STRIDE;
    console.info(`[osm:details] ${JSON.stringify(this.stats)}, ${this.group.children.length} draws, ${countTriangles(this.group)} tris`);
  }

  update(dt: number, ctx: OsmContext): void {
    if (this.waiting && this.deck) {
      this.deckWait += ctx.engine.time.realDt;
      if (this.deckWait >= this.deckNext) {
        this.deckNext = this.deckWait + 1;
        if (this.deck.resolve(ctx.engine.scene)) {
          this.startCrowd(this.deck);
        } else if (this.deckWait > DECK_TIMEOUT) {
          console.warn('[osm:details] Galata Bridge deck not found; anglers and bridge walkers skipped');
          this.startCrowd(null);
        }
      }
    }
    const cam = ctx.engine.camera.position;
    const preset = ctx.engine.quality.settings.preset;
    this.crowd?.setLodScale(LOD_RADIUS_SCALE[preset] ?? 1);
    this.crowd?.update(ctx.engine.time.elapsed, cam);
    for (const t of this.trees) {
      t.update(cam, preset);
    }
    for (const m of [this.props, this.kits]) {
      if (!m) {
        continue;
      }
      m.update(cam, preset);
      m.setCastShadow(cam.y - ctx.geo.heightAt(cam.x, cam.z) < PROPS_SHADOW_AGL);
    }
  }
}

export function createDetailsLayer(ctx: OsmContext, data: OsmData): OsmLayer {
  return new DetailsLayer(ctx, data);
}

export { toGeometry };
