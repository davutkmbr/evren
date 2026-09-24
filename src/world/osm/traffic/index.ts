/**
 * Traffic layer: vehicles and trams on the real OSM street graph of the slice.
 *
 * traffic.worker.ts builds the routable lane graph (network.ts: right-hand lanes from oneway / lanes / width,
 * junction connectors, signal heads, crossings, bus stops), the T1 / T2 tram tracks (rails.ts) and the parked
 * vehicles (parking.ts). On the main thread:
 * - decks.ts resolves the Galata Köprüsü deck heights (core 'roadSurface' service, else rays onto the rendered
 *   deck) and patches them into the deck lanes before any vehicle there is shown;
 * - signals.ts runs the signal plans on the same clock as the streets layer's signal lamps;
 * - sim.ts (cars: IDM car following, junction yielding, crossings, bus stops, time-of-day population) and
 *   trams.ts (Citadis pairs on T1, nostalgic trams on İstiklal) move everything;
 * - render.ts draws all vehicles in two BatchedMesh draws with three LODs, plus light glows and headlight pools.
 * The life module's procedural road traffic is hidden inside the slice (life/traffic/road-network.ts).
 * Debug: window.__osm.layers (this layer's `stats()`), URL `traffic=<scale>` scales the density (0 = none).
 */
import * as THREE from 'three';
import { globalUniforms } from '../../../core/uniforms';
import type { OsmData } from '../data';
import { LayerBase } from '../shared/layer';
import { runWorker } from '../shared/worker';
import type { OsmContext, OsmLayer } from '../types';
import { MODEL_WIDTH, paintOf } from './catalog';
import { DeckHeights, deckSpecs } from './decks';
import { PathFlag } from './paths';
import { LaneFlag, PARKED_STRIDE, SAMPLE_STRIDE, type TrafficNet, type TrafficRequest, type TrafficResult, type TramTrack } from './protocol';
import { VehicleRenderer } from './render';
import { Signals } from './signals';
import { CarSim } from './sim';
import { TramSim } from './trams';

/** Camera height above the ground (m) above which cars stop casting shadows. */
const CAR_SHADOW_AGL = 120;
const SEED = 0x0e1e5;
/** Moving vehicle capacity at most (the network's full-traffic count normally stays well below). */
const MOVING_CAP = 1300;
/** Slots reserved for tram modules. */
const TRAM_SLOTS = 64;
/** Real seconds to wait for the rendered deck before falling back to the streets layer's deck query. */
const DECK_TIMEOUT = 20;

const QUALITY_SCALE: Record<string, number> = { low: 0.6, medium: 0.85, high: 1, ultra: 1.2 };
const DENSITY_SCALE: Record<string, number> = { low: 0.55, medium: 0.8, high: 1, ultra: 1 };

class TrafficLayer extends LayerBase {
  private readonly decks: DeckHeights;
  private net: TrafficNet | null = null;
  private tracks: readonly TramTrack[] = [];
  private renderer: VehicleRenderer | null = null;
  private signals: Signals | null = null;
  private cars: CarSim | null = null;
  private trams: TramSim | null = null;
  private decksPatched = false;
  private deckWait = 0;
  private targetTimer = 0;
  private density = 1;
  private readonly frustum = new THREE.Frustum();
  private readonly proj = new THREE.Matrix4();
  private readonly cam = { x: 0, z: 0, frustum: this.frustum as THREE.Frustum | null };
  private readonly workerStats: Record<string, number> = {};
  private cpuMs = 0;
  /** Smoothed ms of: signals + trams, car simulation, posing, renderer end. */
  private readonly partMs = [0, 0, 0, 0];
  private readonly showroom: { slot: number; x: number; y: number; z: number; fx: number; fz: number }[] = [];

  constructor(ctx: OsmContext, data: OsmData) {
    super('traffic');
    const specs = deckSpecs(ctx.geo, ctx.rect);
    this.decks = new DeckHeights(specs);
    const param = Number(ctx.engine.debug.params.get('traffic') ?? '1');
    this.density = Number.isFinite(param) ? Math.max(0, param) : 1;
    const worker = new Worker(new URL('./traffic.worker.ts', import.meta.url), { type: 'module', name: 'osm-traffic' });
    const request: TrafficRequest = {
      base: ctx.base,
      data: { roads: data.roads, rails: data.rails, points: data.points, areas: data.areas, buildings: data.buildings },
      decks: specs,
      seed: SEED,
    };
    const job = runWorker<TrafficRequest, TrafficResult>(worker, request);
    this.onDispose(() => job.cancel());
    const t0 = performance.now();
    this.track(
      job.promise.then((res) => {
        if (!this.disposed) {
          this.start(ctx, res, performance.now() - t0);
        }
      }),
    );
  }

  private start(ctx: OsmContext, res: TrafficResult, workerMs: number): void {
    const t1 = performance.now();
    const net = res.net;
    this.net = net;
    this.tracks = res.tracks;
    Object.assign(this.workerStats, res.stats);
    const preset = ctx.engine.quality.settings.preset;
    const quality = QUALITY_SCALE[preset] ?? 1;
    this.density *= DENSITY_SCALE[preset] ?? 1;
    let full = 0;
    for (let l = 0; l < net.lanePath.length; l++) {
      if (!(net.laneFlags[l] & LaneFlag.Hidden)) {
        full += net.pathLength[net.lanePath[l]] * net.laneDensity[l];
      }
    }
    const capacity = Math.min(MOVING_CAP, Math.ceil(full * Math.max(1, this.density) * 1.1) + 16);
    const renderer = new VehicleRenderer(capacity + TRAM_SLOTS, res.parked, PARKED_STRIDE, quality);
    this.renderer = renderer;
    this.group.add(renderer.group);
    this.signals = new Signals(net);
    this.trams = new TramSim(net, res.tracks, renderer);
    this.cars = new CarSim(net, renderer, this.signals, { tram: this.trams.crossing }, ctx.rect, capacity);
    this.onDispose(() => {
      this.cars?.dispose();
      this.trams?.dispose();
      renderer.dispose();
    });
    const road = ctx.engine.services.tryGet('roadSurface');
    if (road) {
      this.decks.useService(road);
    }
    this.cars.setTarget(ctx.engine.time.timeOfDay, this.density);
    this.cars.populate();
    this.trams.populate();
    this.signals.update(ctx.engine.time.elapsed);
    console.info(
      `[osm:traffic] worker ${Math.round(workerMs)} ms ${JSON.stringify(res.stats)}, ${this.cars.vehicleCount} vehicles (full ${Math.round(full)}), ${this.trams.count} trams, ${res.parked.length / PARKED_STRIDE} parked, setup ${Math.round(performance.now() - t1)} ms`,
    );
  }

  /** Deck heights into the deck lanes / tracks once the rendered deck is there (or after DECK_TIMEOUT). */
  private resolveDecks(ctx: OsmContext, realDt: number): void {
    if (!this.net) {
      return;
    }
    this.deckWait += realDt;
    let query: ((x: number, z: number) => number | null) | null = null;
    if (this.decks.ready || this.decks.resolveFromScene(ctx.engine.scene)) {
      query = (x, z) => this.decks.heightAt(x, z);
    } else if (this.deckWait > DECK_TIMEOUT) {
      console.warn('[osm:traffic] rendered bridge deck not found, using the streets deck query');
      query = (x, z) => ctx.surface.deckAt(x, z);
    }
    if (!query) {
      return;
    }
    const net = this.net;
    const d = net.samples;
    for (let p = 0; p < net.pathFlags.length; p++) {
      if (!(net.pathFlags[p] & PathFlag.Deck)) {
        continue;
      }
      const s0 = net.pathStart[p];
      const n = net.pathCount[p];
      for (let i = 0; i < n; i++) {
        const o = (s0 + i) * SAMPLE_STRIDE;
        const h = query(d[o], d[o + 2]);
        if (h !== null) {
          d[o + 1] = h;
          d[o + 3] = 0;
        }
      }
    }
    this.decksPatched = true;
    this.cars!.decksReady = true;
    this.trams!.decksReady = true;
  }

  override pending(): number {
    return super.pending() + (this.net && !this.decksPatched ? 1 : 0);
  }

  update(dt: number, ctx: OsmContext): void {
    const cars = this.cars;
    const trams = this.trams;
    const renderer = this.renderer;
    if (!cars || !trams || !renderer || !this.signals) {
      return;
    }
    const t0 = performance.now();
    const engine = ctx.engine;
    if (!this.decksPatched) {
      this.resolveDecks(ctx, engine.time.realDt);
    }
    const hours = engine.time.timeOfDay;
    const night = globalUniforms.uNight.value as number;
    this.targetTimer -= dt;
    if (this.targetTimer <= 0) {
      cars.setTarget(hours, this.density);
      this.targetTimer = 1;
    }
    const camera = engine.camera;
    renderer.setShadows(camera.position.y - ctx.geo.heightAt(camera.position.x, camera.position.z) < CAR_SHADOW_AGL);
    camera.updateMatrixWorld();
    this.proj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.proj, camera.coordinateSystem);
    this.cam.x = camera.position.x;
    this.cam.z = camera.position.z;
    this.signals.update(engine.time.elapsed);
    trams.update(dt, night);
    const t1 = performance.now();
    cars.update(dt, hours, night, this.cam);
    const t2 = performance.now();
    renderer.begin(camera, (globalUniforms.uResolution.value as THREE.Vector2).y);
    cars.place(this.cam);
    trams.place(ctx.rect);
    for (const v of this.showroom) {
      renderer.place(v.slot, v.x, v.y, v.z, v.fx, 0, v.fz, -v.fz, 0, v.fx, 0, 1, 0, 1, false);
    }
    const t3 = performance.now();
    renderer.end();
    const t4 = performance.now();
    this.cpuMs += (t4 - t0 - this.cpuMs) * 0.05;
    this.partMs[0] += (t1 - t0 - this.partMs[0]) * 0.05;
    this.partMs[1] += (t2 - t1 - this.partMs[1]) * 0.05;
    this.partMs[2] += (t3 - t2 - this.partMs[2]) * 0.05;
    this.partMs[3] += (t4 - t3 - this.partMs[3]) * 0.05;
  }

  /** Debug numbers (window.__osm.layers[i].stats()). */
  stats(): Record<string, number> {
    return {
      ...this.workerStats,
      vehicles: this.cars?.vehicleCount ?? 0,
      target: this.cars?.target ?? 0,
      trams: this.trams?.count ?? 0,
      visibleMoving: this.renderer?.visibleCounts()[0] ?? 0,
      visibleParked: this.renderer?.visibleCounts()[1] ?? 0,
      triangles: this.renderer?.triangles() ?? 0,
      cpuMs: Math.round(this.cpuMs * 1000) / 1000,
      msTrams: Math.round(this.partMs[0] * 1000) / 1000,
      msSim: Math.round(this.partMs[1] * 1000) / 1000,
      msPlace: Math.round(this.partMs[2] * 1000) / 1000,
      msEnd: Math.round(this.partMs[3] * 1000) / 1000,
      spawned: this.cars?.stats.spawned ?? 0,
      despawned: this.cars?.stats.despawned ?? 0,
      stuck: this.cars?.stats.stuck ?? 0,
      moved: this.cars?.stats.moved ?? 0,
      tracks: this.tracks.length,
    };
  }

  /**
   * Debug: a static line-up of every model (plus colour variants) centred at (x, z), vehicles facing `headingDeg`,
   * spaced along the perpendicular; state = VehicleState bits (lights, brake...). Call with no models to clear.
   */
  lineup(ctx: OsmContext, x: number, z: number, headingDeg: number, models: number[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13], state = 0, gap = 1.2): void {
    const r = this.renderer;
    if (!r) {
      return;
    }
    for (const v of this.showroom) {
      r.release(v.slot);
    }
    this.showroom.length = 0;
    const h = (headingDeg * Math.PI) / 180;
    const fx = Math.sin(h);
    const fz = -Math.cos(h);
    const rx = -fz;
    const rz = fx;
    let off = 0;
    const widths = models.map((m) => MODEL_WIDTH[m]);
    const total = widths.reduce((a, w) => a + w + gap, -gap);
    off = -total / 2;
    models.forEach((m, k) => {
      const c = off + widths[k] / 2;
      off += widths[k] + gap;
      const px = x + rx * c;
      const pz = z + rz * c;
      const paint = paintOf(m, (k * 0.37) % 1, 0.5);
      const slot = r.allocate(m, paint, state);
      this.showroom.push({ slot, x: px, y: this.topAt(px, pz, ctx), z: pz, fx, fz });
    });
  }

  /** Debug: trams and tracks. */
  tramInfo(): unknown {
    return { trams: this.trams?.describe() ?? [], tracks: this.tracks.map((t) => ({ line: t.line, stops: t.stops.map(Math.round), pair: t.pair, single: t.single, deck: t.deck })) };
  }

  /** Debug: vehicles (and standing ones) per lane rank. */
  census(): Record<string, [number, number]> {
    return this.cars?.rankCensus() ?? {};
  }

  /** Debug: moving vehicles near (x, z). */
  probe(x: number, z: number, r = 30): Record<string, number>[] {
    return this.cars?.probe(x, z, r) ?? [];
  }

  /** Debug: drivable surface height (deck when on the rendered bridge deck). */
  topAt(x: number, z: number, ctx: OsmContext): number {
    return this.decks.heightAt(x, z) ?? ctx.surface.heightAt(x, z);
  }

  /** Deck profile debug (station ranges and heights). */
  deckInfo(): ReturnType<DeckHeights['describe']> {
    return this.decks.describe();
  }
}

export function createTrafficLayer(ctx: OsmContext, data: OsmData): OsmLayer {
  return new TrafficLayer(ctx, data);
}
