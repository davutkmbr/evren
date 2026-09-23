import * as THREE from 'three';
import type { EngineContext, GeoQuery, System } from '../../core/contracts';
import { UpdateOrder } from '../../core/contracts';
import type { QualitySettings } from '../../core/quality';
import { createLifeMaterial } from './render/life-material';
import { buildCatalog } from './vessels/catalog';
import { Fleet } from './vessels/fleet';
import type { VesselModel } from './vessels/model-types';
import { WakeTrails } from './wakes/wake-trails';
import { LightPoints, Sector } from './lights/nav-lights';
import { VesselLights } from './lights/vessel-lights';
import { buildPiers, type PierLamp } from './piers/pier-builder';
import { globalUniforms } from '../../core/uniforms';
import { Flocks } from './birds/flocks';
import { CarTraffic } from './traffic/car-traffic';
import { osmEnabled, osmExclusionRect } from '../osm/area';

const TRAFFIC_DENSITY: Record<string, number> = { low: 0.35, medium: 0.6, high: 1.0, ultra: 1.25 };
import { buildStraitLanes, placeBerths, type Berth, type StraitLanes } from './vessels/routes';

/** Debug handle: window.__life */
export interface LifeDebug {
  system: LifeSystem;
}

export class LifeSystem implements System {
  readonly name = 'life';
  readonly order = UpdateOrder.World;
  readonly root = new THREE.Group();
  private ctx: EngineContext | null = null;
  private geo: GeoQuery | null = null;
  private material: THREE.MeshStandardMaterial | null = null;
  private models: Map<string, VesselModel> | null = null;
  berths: Map<string, Berth[]> | null = null;
  lanes: StraitLanes | null = null;
  fleet: Fleet | null = null;
  wakes: WakeTrails | null = null;
  lights: LightPoints | null = null;
  private vesselLights: VesselLights | null = null;
  private pierMesh: THREE.Mesh | null = null;
  private pierLamps: PierLamp[] = [];
  private colliderIds: number[] = [];
  private lightsAwake = true;
  flocks: Flocks | null = null;
  traffic: CarTraffic | null = null;
  private trafficPreset = '';
  private birdCount = -1;
  private jobs = 0;
  private clock = 0;
  private shipCount = -1;
  private unsubscribe: (() => void) | null = null;
  private readonly camPos = new THREE.Vector3();

  async init(ctx: EngineContext): Promise<void> {
    this.ctx = ctx;
    this.root.name = 'life';
    ctx.scene.add(this.root);
    this.jobs++;
    try {
      const geo = await ctx.services.when('geo');
      this.geo = geo;
      const t0 = performance.now();
      this.material = createLifeMaterial('life-vessel');
      this.models = await buildCatalog();
      const t1 = performance.now();
      this.berths = placeBerths(geo);
      this.lanes = buildStraitLanes(geo);
      const piers = buildPiers(geo, this.berths);
      this.pierMesh = new THREE.Mesh(piers.geometry, this.material);
      this.pierMesh.name = 'life-piers';
      this.pierMesh.castShadow = true;
      this.pierMesh.receiveShadow = true;
      this.root.add(this.pierMesh);
      this.pierLamps = piers.lamps;
      this.colliderIds = ctx.services.get('collision').addMany(piers.colliders, 'pier');
      const t2 = performance.now();
      this.rebuildFleet(ctx.quality.settings);
      this.rebuildTraffic(ctx.quality.settings);
      // Bridge decks arrive with the structures module; re-lay the roads onto them once they do.
      if (!ctx.services.has('roadSurface')) {
        void ctx.services.when('roadSurface').then(() => this.traffic && this.rebuildTraffic(ctx.quality.settings));
      }
      console.info(`[life] models ${Math.round(t1 - t0)} ms, routes ${Math.round(t2 - t1)} ms, fleet ${Math.round(performance.now() - t2)} ms`);
      this.unsubscribe = ctx.quality.onChange((s) => this.onQuality(s));
    } finally {
      this.jobs--;
    }
    (window as unknown as { __life: LifeDebug }).__life = { system: this };
  }

  private rebuildTraffic(s: QualitySettings): void {
    if (!this.geo) return;
    if (this.traffic) {
      this.root.remove(this.traffic.group);
      this.traffic.dispose();
    }
    this.trafficPreset = s.preset;
    const osmSlice = this.ctx && osmEnabled(this.ctx.debug.params) ? osmExclusionRect() : null;
    this.traffic = new CarTraffic(this.geo, TRAFFIC_DENSITY[s.preset] ?? 1, osmSlice, this.ctx?.services.tryGet('roadSurface') ?? null);
    this.root.add(this.traffic.group);
  }

  private onQuality(s: QualitySettings): void {
    if (s.preset !== this.trafficPreset) this.rebuildTraffic(s);
    if (s.shipCount !== this.shipCount) this.rebuildFleet(s);
    else if (s.birdCount !== this.birdCount) this.rebuildBirds(s);
  }

  private rebuildBirds(s: QualitySettings): void {
    if (!this.geo || !this.fleet) return;
    if (this.flocks) {
      this.root.remove(this.flocks.mesh);
      this.flocks.dispose();
    }
    this.birdCount = s.birdCount;
    this.flocks = new Flocks(Math.max(0, s.birdCount), this.geo, this.fleet.vessels);
    this.root.add(this.flocks.mesh);
  }

  private rebuildFleet(s: QualitySettings): void {
    if (!this.geo || !this.models || !this.lanes || !this.material || !this.berths) return;
    if (this.fleet) {
      this.root.remove(this.fleet.renderer.object);
      this.fleet.dispose();
    }
    this.shipCount = s.shipCount;
    this.fleet = new Fleet({ geo: this.geo, models: this.models, berths: this.berths, lanes: this.lanes, shipCount: s.shipCount }, this.material);
    this.root.add(this.fleet.renderer.object);
    if (this.wakes) {
      this.root.remove(this.wakes.mesh);
      this.wakes.dispose();
    }
    this.wakes = this.fleet.createWakes();
    this.root.add(this.wakes.mesh);

    if (this.lights) {
      this.root.remove(this.lights.points);
      this.lights.dispose();
    }
    let lightCount = this.pierLamps.length;
    for (const v of this.fleet.vessels) lightCount += v.model.lights.length;
    this.lights = new LightPoints(lightCount + 8);
    const base = this.lights.alloc(this.pierLamps.length);
    this.pierLamps.forEach((l, i) => this.lights!.set(base + i, l.x, l.y, l.z, 0, -1, Sector.AllRound, 18, 13.5, 8.5, 0.45));
    this.vesselLights = new VesselLights(this.lights, this.fleet.vessels);
    this.lights.upload();
    this.lightsAwake = true;
    this.root.add(this.lights.points);
    this.rebuildBirds(s);
  }

  update(dt: number, ctx: EngineContext): void {
    if (!this.fleet) return;
    this.camPos.setFromMatrixPosition(ctx.camera.matrixWorld);
    this.fleet.update(dt, this.camPos);
    this.clock += dt;
    const time = this.clock;
    if (this.wakes) {
      this.fleet.feedWakes(this.wakes, time);
    }
    this.traffic?.update(dt, time, ctx.time.timeOfDay, this.camPos);
    if (this.flocks) {
      const dragon = ctx.services.tryGet('dragon');
      this.flocks.update(dt, this.camPos, dragon ? dragon.position : null);
    }
    // Lights only need per-frame work around dusk and at night.
    const night = (ctx.services.tryGet('env')?.nightFactor ?? (globalUniforms.uNight.value as number)) > 0.02;
    if (this.lights && this.vesselLights && (night || this.lightsAwake)) {
      this.vesselLights.update();
      this.lights.upload();
      this.lightsAwake = night;
      this.lights.points.visible = night;
    }
  }

  pending(): number {
    return this.jobs;
  }

  dispose(): void {
    this.unsubscribe?.();
    this.fleet?.dispose();
    this.wakes?.dispose();
    this.lights?.dispose();
    this.flocks?.dispose();
    this.traffic?.dispose();
    this.pierMesh?.geometry.dispose();
    this.ctx?.services.tryGet('collision')?.removeMany(this.colliderIds);
    this.material?.dispose();
    if (this.models) {
      for (const m of this.models.values()) {
        m.lod0.dispose();
        m.lod1.dispose();
      }
    }
    this.root.removeFromParent();
  }
}
