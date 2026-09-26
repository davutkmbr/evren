/**
 * Real OpenStreetMap content at flight scale: streets, buildings, traffic and details of the OSM regions
 * (regions.ts): the Galata slice (Eminönü, Galata Bridge, Karaköy, Galata, Tophane, Cihangir), always loaded, and the
 * regions around every landing spot, streamed in and out by distance. The city, vegetation and life systems keep
 * their procedural buildings, trees and road traffic out of the regions (regions.ts exclusion lists).
 *
 * Per region this system loads the data (data.ts), builds the shared foundation once (geo windows + street raster in
 * shared/foundation.worker.ts, see types.ts OsmContext) and orchestrates the four layers; each layer builds its
 * geometry in its own module worker. Regions build one at a time, nearest first. Data © OpenStreetMap contributors
 * (ODbL), fetched by scripts/data/fetch-osm.mjs (Galata) and scripts/data/osm-regions.mjs (regions).
 */
import * as THREE from 'three';
import type { EngineContext, GeoQuery, StreetGroundService, System } from '../../core/contracts';
import { UpdateOrder } from '../../core/contracts';
import type { QualityPreset } from '../../core/quality';
import { loadOsmData, type OsmData } from './data';
import { notifyOsmTreesChange, osmRegions, setOsmRegionActive, type OsmRegionDef } from './regions';
import { acquireOsmFade, OSM_FADE_SECONDS, releaseOsmFade, setOsmFade, tagOsmFade } from './fade';
import { buildWorkerBase } from './shared/foundation';
import { clipWaysToLand } from './shared/land';
import { groundLines, linesCrossing, type GroundLine, type GroundLineCrossing } from './shared/ground-lines';
import { classifyStreets } from './shared/street-field';
import { StreetSurface } from './shared/street-surface';
import type { OsmContext, OsmLayer, OsmLayerFactory } from './types';
import { wallsReady } from '../landmarks/walls/system/owned';
import { landmarkClaims } from '../landmarks/claims';
import { openLandmarkPassages } from './shared/landmark-passages';

/**
 * Layers load independently: a layer that fails to import or build (e.g. mid-edit during development) is
 * skipped with a console error instead of taking the whole OSM area (or the game) down.
 */
const LAYER_LOADERS: readonly { name: string; load: () => Promise<OsmLayerFactory>; nearOnly?: true }[] = [
  { name: 'streets', load: () => import('./streets').then((m) => m.createStreetsLayer) },
  { name: 'buildings', load: () => import('./buildings').then((m) => m.createBuildingsLayer) },
  // Vehicles are invisible from afar but simulated every frame: streamed regions run them only near the camera.
  { name: 'traffic', load: () => import('./traffic').then((m) => m.createTrafficLayer), nearOnly: true },
  { name: 'details', load: () => import('./details').then((m) => m.createDetailsLayer) },
];

let factoriesJob: Promise<(OsmLayerFactory | null)[]> | null = null;

function layerFactories(): Promise<(OsmLayerFactory | null)[]> {
  return (factoriesJob ??= Promise.all(
    LAYER_LOADERS.map((l) =>
      l.load().catch((e: unknown) => {
        console.error(`[osm] layer "${l.name}" failed to load, skipping it`, e);
        return null;
      }),
    ),
  ));
}

/**
 * Streaming distances (m from the camera to a region's rect, horizontal) at the "high" preset: a region loads inside
 * LOAD_DISTANCE and unloads beyond UNLOAD_DISTANCE; at most MAX_LOADED streamed regions are kept (nearest win).
 * Beyond about 1 km a region adds little over the far OSM layer (the same baked buildings, with near detail out to
 * 800 m; the region's own facade details, props and crowd end by 800 m), so regions load only as near as their build
 * time needs and few are kept: each one costs tens to hundreds of MB and per-frame work.
 */
const LOAD_DISTANCE = 1800;
const UNLOAD_DISTANCE = 2400;
const MAX_LOADED = 5;
/**
 * A loaded region takes over from the far layer (city swap + fade in) only inside this distance: between it and
 * LOAD_DISTANCE the region is built but hidden, so the far layer keeps drawing the same buildings in one merged set
 * of chunks instead of the region's own draws and shadow casters.
 */
const ACTIVATE_DISTANCE = 1200;
/** Near-only layers (traffic) of a streamed region start inside NEAR_ON and stop beyond NEAR_OFF (m, "high"). */
const NEAR_ON = 1000;
const NEAR_OFF = 1400;
const DISTANCE_SCALE: Record<QualityPreset, number> = { low: 0.55, medium: 0.75, high: 1, ultra: 1.3 };
/** Camera travel (m) between two streaming decisions. */
const RESELECT_STEP = 50;

type RegionState = 'loading' | 'ready' | 'failed';

/** One loaded region: its data, foundation, context and layers. */
class OsmRegion {
  readonly group = new THREE.Group();
  readonly layers: OsmLayer[];
  ctx: OsmContext | null = null;
  data: OsmData | null = null;
  state: RegionState = 'loading';
  /** The region's rect is in the active exclusion list (its buildings are drawn). */
  active = false;
  /** Handover (fade.ts): slot while fading, start time and direction of the running fade. */
  private fadeSlot: number | null = null;
  private casting = true;
  private fadeFrom: number | null = null;
  private fadeOut = false;
  /** Faded out: ready to be disposed. */
  gone = false;
  loadMs = 0;
  private cancel: (() => void) | null = null;
  private disposed = false;
  private lines: GroundLine[] | null = null;
  private factories: (OsmLayerFactory | null)[] = [];
  /** Near-only layers by LAYER_LOADERS index while the region is near. */
  private readonly nearLayers = new Map<number, OsmLayer>();
  /** Near-only layers wanted (always for the fixed Galata slice). */
  private near: boolean;

  constructor(
    readonly def: OsmRegionDef,
    parent: THREE.Object3D,
    layers: OsmLayer[] = [],
  ) {
    this.layers = layers;
    this.near = def.fixed;
    this.group.name = `osm-${def.id}`;
    // Streamed regions load hidden and fade in once the city has swapped its chunks over them (fade.ts).
    this.group.visible = def.fixed;
    parent.add(this.group);
  }

  /** Starts fading in from `t0` (the city's swap instant). */
  beginFadeIn(t0: number): void {
    if (this.gone || this.fadeOut) {
      return;
    }
    this.fadeSlot ??= acquireOsmFade(this.def.rect);
    tagOsmFade(this.group);
    this.group.visible = true;
    if (this.fadeSlot === null) {
      // No slot free: the region pops in, as before the handover existed.
      notifyOsmTreesChange(this.def.rect);
      return;
    }
    this.fadeFrom = t0;
    this.stepFade();
  }

  /** Turns the region's shadow casters off or back to what they were built with. */
  private setCasting(on: boolean): void {
    if (on === this.casting) {
      return;
    }
    this.casting = on;
    this.group.traverse((o) => {
      if (on) {
        if (o.userData.osmCastShadow !== undefined) {
          o.castShadow = o.userData.osmCastShadow as boolean;
          delete o.userData.osmCastShadow;
        }
      } else if (o.castShadow) {
        o.userData.osmCastShadow = true;
        o.castShadow = false;
      }
    });
  }

  /** Keeps the region fully drawn on a slot until beginFadeOut (called when it stops being active). */
  holdForFadeOut(): void {
    this.fadeSlot ??= acquireOsmFade(this.def.rect);
    this.fadeFrom = null;
    if (this.fadeSlot !== null) {
      setOsmFade(this.fadeSlot, this.group.visible ? 1 : 0, false);
    }
  }

  /** Starts fading out from `t0`; the region is `gone` when done. */
  beginFadeOut(t0: number): void {
    if (this.fadeSlot === null || !this.group.visible) {
      notifyOsmTreesChange(this.def.rect);
      this.gone = true;
      return;
    }
    tagOsmFade(this.group);
    this.fadeOut = true;
    this.fadeFrom = t0;
    // The procedural trees come back in the pixels the region gives up (OSM_FADE_OUT).
    notifyOsmTreesChange(this.def.rect);
    this.stepFade();
  }

  private stepFade(): void {
    if (this.fadeFrom === null) {
      return;
    }
    const f = Math.min(1, (performance.now() - this.fadeFrom) / (OSM_FADE_SECONDS * 1000));
    if (this.fadeSlot !== null) {
      setOsmFade(this.fadeSlot, this.fadeOut ? 1 - f : f, this.fadeOut);
    }
    // The shadow switches at the middle of the dither, like the city chunks it replaces (city/streamer.ts).
    this.setCasting(this.fadeOut ? f < 0.5 : f >= 0.5);
    if (f < 1) {
      return;
    }
    this.fadeFrom = null;
    if (this.fadeOut) {
      this.gone = true;
    } else {
      // Fully drawn. The slot stays at 1 while the region is loaded: the procedural trees under it stay hidden
      // (OSM_FADE_OUT) until the vegetation has rebuilt its tiles without them, and it is ready for the fade out.
      notifyOsmTreesChange(this.def.rect);
    }
  }

  async load(engine: EngineContext, geo: GeoQuery): Promise<void> {
    const t0 = performance.now();
    // The city walls draw their towers themselves: their ids must be known before the buildings layer starts.
    const [data] = await Promise.all([loadOsmData(this.def.url), wallsReady()]);
    if (this.disposed) {
      return;
    }
    // Vehicle ways never over water (sea tunnels, reclaimed ground the flight world does not have).
    const clip = clipWaysToLand(data, (x, z) => geo.coastDistance(x, z));
    // Roads OSM maps as passages under a landmark's arches are ground roads (the landmark model stands over them).
    openLandmarkPassages(data, landmarkClaims(geo));
    const t1 = performance.now();
    const job = buildWorkerBase(geo, data, this.def.rect, this.def.area);
    this.cancel = job.cancel;
    const { base, ms } = await job.promise;
    this.cancel = null;
    if (this.disposed) {
      return;
    }
    base.fade = this.def.fade;
    const ctx: OsmContext = {
      engine,
      geo,
      area: base.area,
      rect: base.rect,
      fade: this.def.fade,
      base,
      surface: new StreetSurface(base),
    };
    this.ctx = ctx;
    this.data = data;
    const t2 = performance.now();
    const factories = await layerFactories();
    if (this.disposed) {
      return;
    }
    this.factories = factories;
    factories.forEach((_, i) => {
      if (!LAYER_LOADERS[i].nearOnly || this.near) {
        this.addLayer(i);
      }
    });
    this.state = 'ready';
    this.loadMs = Math.round(performance.now() - t0);
    console.info(
      `[osm:${this.def.id}] data ${Math.round(t1 - t0)} ms (${data.buildings.length} buildings, ${data.roads.length} roads, ${data.points.length} points), street raster ${base.street.w}x${base.street.h} in ${ms} ms (total ${Math.round(t2 - t1)} ms), ways over water: ${clip.clipped} clipped, ${clip.removed} removed (${clip.metres} m), layers started`,
    );
  }

  private addLayer(i: number): void {
    const factory = this.factories[i];
    if (!factory || !this.ctx || !this.data) {
      return;
    }
    try {
      const layer = factory(this.ctx, this.data);
      this.layers.push(layer);
      this.group.add(layer.group);
      if (LAYER_LOADERS[i].nearOnly) {
        this.nearLayers.set(i, layer);
      }
    } catch (e) {
      console.error(`[osm:${this.def.id}] layer "${LAYER_LOADERS[i].name}" failed to build, skipping it`, e);
    }
  }

  /** Starts or stops the near-only layers. */
  setNear(near: boolean): void {
    if (near === this.near || this.def.fixed) {
      return;
    }
    this.near = near;
    if (this.state !== 'ready') {
      return;
    }
    LAYER_LOADERS.forEach((l, i) => {
      if (!l.nearOnly) {
        return;
      }
      const layer = this.nearLayers.get(i);
      if (near && !layer) {
        this.addLayer(i);
      } else if (!near && layer) {
        layer.dispose();
        this.nearLayers.delete(i);
        this.layers.splice(this.layers.indexOf(layer), 1);
      }
    });
  }

  /** Outstanding jobs of this region (loading, layer workers, uploads). */
  pending(): number {
    let n = this.state === 'loading' ? 1 : 0;
    for (const l of this.layers) {
      n += l.pending?.() ?? 0;
    }
    return n;
  }

  /** Buildings uploaded (or the buildings layer missing): the procedural city may step aside. */
  buildingsDrawn(): boolean {
    if (this.state !== 'ready') {
      return false;
    }
    const buildings = this.layers.find((l) => l.group.name === 'osm-buildings');
    return buildings ? (buildings.pending?.() ?? 0) === 0 : this.pending() === 0;
  }

  update(dt: number): void {
    this.stepFade();
    const ctx = this.ctx;
    // Built but not yet taken over from the far layer (hidden): nothing of it is drawn, so its LODs need no streaming.
    if (!ctx || !this.group.visible) {
      return;
    }
    for (const l of this.layers) {
      l.update?.(dt, ctx);
    }
  }

  /** Tram tracks and lane lines of the drawn ground (streetGround.linesAcross), built on first use. */
  groundLines(): GroundLine[] {
    return (this.lines ??= groundLines(this.ctx!.surface.tramTracks, classifyStreets(this.data!.roads)));
  }

  dispose(): void {
    this.disposed = true;
    if (this.fadeSlot !== null) {
      releaseOsmFade(this.fadeSlot);
      this.fadeSlot = null;
    }
    this.cancel?.();
    for (const l of this.layers) {
      l.dispose();
    }
    this.layers.length = 0;
    this.group.removeFromParent();
    this.ctx = null;
    this.data = null;
  }
}

/** A handover never waits longer than this (ms) for the city's swap (a stalled chunk must not keep a region hidden). */
const HANDOVER_TIMEOUT = 5000;

/** `p`, or now after HANDOVER_TIMEOUT. */
function withTimeout(p: Promise<number>): Promise<number> {
  return Promise.race([p, new Promise<number>((resolve) => setTimeout(() => resolve(performance.now()), HANDOVER_TIMEOUT))]);
}

const inside = (r: { minX: number; maxX: number; minZ: number; maxZ: number }, x: number, z: number): boolean => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ;

function rectDistance(r: OsmRegionDef['rect'], x: number, z: number): number {
  return Math.hypot(Math.max(r.minX - x, 0, x - r.maxX), Math.max(r.minZ - z, 0, z - r.maxZ));
}

/** Debug handle: window.__osm (the Galata slice's context, data and layers, plus the region streamer state). */
export interface OsmDebug {
  ctx: OsmContext | null;
  data: OsmData | null;
  layers: readonly OsmLayer[];
  /** Every region with its state and distance (m) from the camera. */
  regions(): { id: string; state: string; active: boolean; distance: number; pending: number; loadMs: number; buildings: number }[];
  /** Context, data and layers of a loaded region. */
  region(id: string): { ctx: OsmContext | null; data: OsmData | null; layers: readonly OsmLayer[] } | null;
}

class OsmSystem implements System {
  readonly name = 'osm';
  readonly order = UpdateOrder.World;
  private readonly root = new THREE.Group();
  /** Galata's layer list (a stable array for window.__osm.layers). */
  private readonly galataLayers: OsmLayer[] = [];
  private readonly loaded = new Map<string, OsmRegion>();
  /** Regions fading out after they stopped being active (fade.ts). */
  private readonly leaving = new Set<OsmRegion>();
  private engine: EngineContext | null = null;
  private geo: GeoQuery | null = null;
  private building: OsmRegion | null = null;
  private waiting = 1;
  private readonly lastCam = new THREE.Vector3(Infinity, 0, Infinity);
  /** Streamed regions wanted at the last decision (for pending()). */
  private wantedMissing = 0;
  private disposed = false;

  init(engine: EngineContext): void {
    this.root.name = 'osm';
    engine.scene.add(this.root);
    this.engine = engine;
    void engine.services
      .when('geo')
      .then((geo) => {
        if (this.disposed) {
          return;
        }
        this.geo = geo;
        this.waiting = 0;
        this.start(osmRegions()[0], this.galataLayers);
      })
      .catch((e: unknown) => console.error('[osm] failed to start', e));
    const system = this;
    const galata = (): OsmRegion | undefined => this.loaded.get('galata');
    (window as unknown as { __osm: OsmDebug }).__osm = {
      get ctx() {
        return galata()?.ctx ?? null;
      },
      get data() {
        return galata()?.data ?? null;
      },
      layers: this.galataLayers,
      regions: () => {
        const cam = system.engine?.camera.position ?? new THREE.Vector3();
        return osmRegions().map((d) => {
          const r = system.loaded.get(d.id);
          return {
            id: d.id,
            state: r ? r.state : 'unloaded',
            active: r?.active ?? false,
            distance: Math.round(rectDistance(d.rect, cam.x, cam.z)),
            pending: r?.pending() ?? 0,
            loadMs: r?.loadMs ?? 0,
            buildings: r?.data?.buildings.length ?? 0,
          };
        });
      },
      region: (id: string) => {
        const r = system.loaded.get(id);
        return r ? { ctx: r.ctx, data: r.data, layers: r.layers } : null;
      },
    };
  }

  pending(): number {
    let n = this.waiting + this.wantedMissing;
    for (const r of this.loaded.values()) {
      n += r.pending();
    }
    return n;
  }

  update(dt: number): void {
    const engine = this.engine;
    if (!engine || !this.geo) {
      return;
    }
    const cam = engine.camera.position;
    if (this.building && this.building.state !== 'loading' && this.building.pending() === 0) {
      this.building = null;
    }
    if (Math.hypot(cam.x - this.lastCam.x, cam.z - this.lastCam.z) > RESELECT_STEP || !this.building) {
      this.select(cam.x, cam.z, engine.quality.settings.preset);
    }
    const scale = DISTANCE_SCALE[engine.quality.settings.preset] ?? 1;
    for (const r of this.loaded.values()) {
      const dist = rectDistance(r.def.rect, cam.x, cam.z);
      if (dist < NEAR_ON * scale) {
        r.setNear(true);
      } else if (dist > NEAR_OFF * scale) {
        r.setNear(false);
      }
      if (!r.active && r.buildingsDrawn() && dist < ACTIVATE_DISTANCE * scale) {
        r.active = true;
        void withTimeout(setOsmRegionActive(r.def, true)).then((t0) => r.beginFadeIn(t0));
      }
      r.update(dt);
    }
    for (const r of [...this.leaving]) {
      r.update(dt);
      if (r.gone) {
        r.dispose();
        this.leaving.delete(r);
      }
    }
  }

  /** Loads the nearest wanted region (one build at a time) and unloads regions that fell far behind. */
  private select(x: number, z: number, preset: QualityPreset): void {
    this.lastCam.set(x, 0, z);
    // `?osmregions=0`: Galata slice only (A/B comparisons).
    if (this.engine?.debug.params.get('osmregions') === '0') {
      return;
    }
    const scale = DISTANCE_SCALE[preset] ?? 1;
    const wanted = osmRegions()
      .filter((d) => !d.fixed)
      .map((d) => ({ d, dist: rectDistance(d.rect, x, z) }))
      .filter((w) => w.dist < LOAD_DISTANCE * scale)
      .sort((a, b) => a.dist - b.dist)
      .slice(0, MAX_LOADED);
    const keep = new Set(wanted.map((w) => w.d.id));
    for (const [id, r] of this.loaded) {
      if (r.def.fixed || keep.has(id)) {
        continue;
      }
      const dist = rectDistance(r.def.rect, x, z);
      const over = this.loaded.size - 1 > MAX_LOADED;
      if (dist > UNLOAD_DISTANCE * scale || over) {
        this.stop(r);
      }
    }
    const missing = wanted.filter((w) => !this.loaded.has(w.d.id));
    this.wantedMissing = missing.length;
    if (!this.building && missing.length) {
      this.start(missing[0].d);
      this.wantedMissing--;
    }
  }

  private start(def: OsmRegionDef, layers?: OsmLayer[]): void {
    const engine = this.engine!;
    // Back before its fade-out finished: drop the leaving copy (one region per rect and fade slot).
    for (const r of this.leaving) {
      if (r.def.id === def.id) {
        r.dispose();
        this.leaving.delete(r);
      }
    }
    const region = new OsmRegion(def, this.root, layers);
    this.loaded.set(def.id, region);
    this.building = region;
    if (def.fixed) {
      region.active = true;
    }
    region
      .load(engine, this.geo!)
      .then(() => {
        if (region.ctx && !engine.services.tryGet('streetGround')) {
          engine.services.provide('streetGround', this.streetGround());
        }
      })
      .catch((e: unknown) => {
        region.state = 'failed';
        if (!this.disposed) {
          console.error(`[osm:${def.id}] failed to load`, e);
        }
      });
  }

  private stop(r: OsmRegion): void {
    if (this.building === r) {
      this.building = null;
    }
    this.loaded.delete(r.def.id);
    if (r.active && !r.def.fixed && !this.disposed) {
      // Stays drawn until the city's chunks with its buildings swap in, then fades out (fade.ts).
      r.active = false;
      r.holdForFadeOut();
      this.leaving.add(r);
      void withTimeout(setOsmRegionActive(r.def, false)).then((t0) => r.beginFadeOut(t0));
      return;
    }
    if (r.active) {
      r.active = false;
      void setOsmRegionActive(r.def, false);
      notifyOsmTreesChange(r.def.rect);
    }
    r.dispose();
  }

  /** The drawn street ground of every loaded region, for other modules (bridge decks landing on the streets). */
  private streetGround(): StreetGroundService {
    const at = (x: number, z: number): OsmRegion | null => {
      for (const r of this.loaded.values()) {
        if (r.ctx && inside(r.def.rect, x, z) && r.ctx.surface.covers(x, z)) {
          return r;
        }
      }
      return null;
    };
    return {
      covers: (x, z) => at(x, z) !== null,
      heightAt: (x, z) => {
        const r = at(x, z) ?? this.loaded.get('galata');
        return r?.ctx ? r.ctx.surface.heightAt(x, z) : (this.geo?.heightAt(x, z) ?? 0);
      },
      linesAcross: (ax, az, bx, bz, reach) => {
        const out: GroundLineCrossing[] = [];
        const box = { minX: Math.min(ax, bx) - reach, maxX: Math.max(ax, bx) + reach, minZ: Math.min(az, bz) - reach, maxZ: Math.max(az, bz) + reach };
        for (const r of this.loaded.values()) {
          const q = r.def.rect;
          if (r.ctx && r.data && box.minX < q.maxX && box.maxX > q.minX && box.minZ < q.maxZ && box.maxZ > q.minZ) {
            out.push(...linesCrossing(r.groundLines(), ax, az, bx, bz, reach));
          }
        }
        return out.sort((a, b) => a.t - b.t);
      },
    };
  }

  dispose(): void {
    this.disposed = true;
    if (this.engine?.services.tryGet('streetGround')) {
      this.engine.services.withdraw('streetGround');
    }
    for (const r of [...this.loaded.values()]) {
      this.stop(r);
    }
    for (const r of this.leaving) {
      r.dispose();
    }
    this.leaving.clear();
    this.root.removeFromParent();
  }
}

export function createOsmSystem(): System {
  return new OsmSystem();
}
