import * as THREE from 'three';
import type { GeoQuery, WaterService } from '../../../core/contracts';
import { latLonToLocal } from '../../../core/geo-coords';
import { createRng } from '../../../core/math/noise';
import { SMALL_CRAFT_ZONES } from '../data/places';
import { srgb } from '../util/mesh-builder';
import type { Path2 } from '../util/path';
import { AtAnchor, LaneTransit, LoopRoute, Moored, Priority, Sidestep, Vessel, Wander, type Zone } from './agents';
import { FleetRenderer, type FleetHandle } from './fleet-renderer';
import { HARBOUR_ZONES, HULL_PAINTS, MOORINGS, SERVICE_HANDLING, SERVICE_LINES } from './fleet-data';
import type { VesselModel } from './model-types';
import { BerthBook, FerryService } from './nav/ferry-service';
import { planService, type ServicePlan } from './nav/ferry-plan';
import { Track } from './nav/track';
import { KeepOut } from './nav/keep-out';
import { TrafficRules } from './nav/traffic-rules';
import { anchorageSpots, bridgeKeepOut, buildTourLoop, mooringSpots, type Berth, type StraitLanes } from './routes';
import { WakeTrails } from '../wakes/wake-trails';
import { VesselPhysics } from './physics/vessel-physics';

const PLANING = new Set(['seabus', 'motorboat', 'pilot', 'yacht']);

const CARGO_KEYS = ['tanker-a', 'tanker-b', 'tanker-c', 'container-a', 'container-b', 'bulk-a', 'bulk-b'];

export interface FleetPlanInput {
  geo: GeoQuery;
  models: Map<string, VesselModel>;
  berths: Map<string, Berth[]>;
  lanes: StraitLanes;
  shipCount: number;
  /** The sea surface (heights, current); flat still water until it is set. */
  water?: WaterService | null;
}

/** Palette seed: palette index in [0, 8) + weathering fraction, packed as the instance alpha. */
function packSeed(palette: number, weather: number): number {
  return (Math.floor(palette) % 8) / 8 + Math.min(Math.max(weather, 0), 0.999) / 8;
}

const PRIORITY: Record<string, Priority> = {
  vapur: Priority.Ferry,
  ferry: Priority.Ferry,
  seabus: Priority.Ferry,
  tour: Priority.Service,
  tug: Priority.Service,
  pilot: Priority.Service,
  tanker: Priority.Ship,
  container: Priority.Ship,
  bulk: Priority.Ship,
};

/**
 * Owns every vessel: plans the fleet from routes and quality, runs the traffic rules, advances the navigation
 * behaviours (the reference pose each vessel steers for) and runs the floating rigid bodies (physics/): heave, roll
 * and pitch on the real waves, thrust, rudder and drag in the plane, heel in turns, squat and planing trim.
 */
export class Fleet {
  readonly vessels: Vessel[] = [];
  readonly renderer: FleetRenderer;
  readonly services: ServicePlan[] = [];
  readonly rules: TrafficRules;
  readonly physics: VesselPhysics;
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly p = new THREE.Vector3();
  private readonly one = new THREE.Vector3(1, 1, 1);
  tourLoop: Path2 | null = null;

  constructor(
    private readonly input: FleetPlanInput,
    material: THREE.Material,
  ) {
    const plan = this.plan();
    const big = plan.filter((v) => v.model.big).length;
    this.renderer = new FleetRenderer(input.models, material, big + 4, plan.length - big + 4);
    for (const v of plan) {
      v.handle = this.renderer.add(v.model, v.paint, v.seed);
      this.vessels.push(v);
    }
    this.rules = new TrafficRules(this.vessels);
    this.physics = new VesselPhysics(this.vessels, input.geo);
    this.physics.water = input.water ?? null;
  }

  private plan(): Vessel[] {
    const { geo, models, berths, lanes } = this.input;
    const rng = createRng(0x51f7);
    const out: Vessel[] = [];
    let id = 0;
    const add = (key: string, behaviour: Vessel['behaviour'] | null, paintHex: number, seed: number, lift = 0): Vessel => {
      const model = models.get(key)!;
      const v = new Vessel(id++, model, behaviour as Vessel['behaviour'], srgb(paintHex), seed);
      v.lift = lift;
      v.priority = PRIORITY[model.kind] ?? Priority.Small;
      out.push(v);
      return v;
    };
    const budget = Math.max(12, this.input.shipCount);
    const lowFerries = budget < 40;

    // Scheduled ferries.
    const book = new BerthBook();
    for (const line of SERVICE_LINES) {
      const model = models.get(line.model);
      const handling = SERVICE_HANDLING[line.model];
      if (!model || !handling) continue;
      const plan = planService(geo, berths, line, { length: model.length, beam: model.beam, ...handling });
      if (!plan) continue;
      this.services.push(plan);
      const n = lowFerries ? 1 : line.vessels;
      for (let k = 0; k < n; k++) {
        const legIndex = Math.floor((k * plan.legs.length) / n);
        const start = k === 0 && line.vessels > 1 ? -0.5 : 0.15 + rng() * 0.6;
        const v = add(line.model, null, HULL_PAINTS[model.kind][0], packSeed(0, 0.05 + rng() * 0.15));
        v.behaviour = new FerryService(plan, v.id, book, legIndex, start, new Sidestep(geo, model.beam / 2));
        this.initState(v);
      }
    }

    const rest = Math.max(0, budget - out.length);
    const nTransit = Math.round(rest * 0.24);
    const nAnchor = Math.round(rest * 0.2);
    const nFishing = Math.round(rest * 0.13);
    const nYacht = Math.round(rest * 0.08);
    const nSail = Math.round(rest * 0.04);
    const nMotor = Math.round(rest * 0.08);
    const nHarbour = Math.max(2, Math.round(rest * 0.06));
    const nTour = Math.max(1, Math.round(rest * 0.08));
    const nSeiner = Math.max(0, rest - nTransit - nAnchor - nFishing - nYacht - nSail - nMotor - nHarbour - nTour);

    const pickHull = (list: readonly number[]): number => list[Math.floor(rng() * list.length)];
    const cargoPick = (): { key: string; hull: number; seed: number; lift: number } => {
      const key = CARGO_KEYS[Math.floor(rng() * CARGO_KEYS.length)];
      const model = models.get(key)!;
      const ballast = rng() < 0.4;
      return {
        key,
        hull: pickHull(HULL_PAINTS[model.kind]),
        seed: packSeed(rng() * 8, 0.15 + rng() * 0.75),
        lift: ballast ? model.draft * (0.3 + rng() * 0.15) : rng() * model.draft * 0.08,
      };
    };

    // Corridors kept clear: anchored ships stay well off the lanes and ferry tracks, small craft loiter outside them.
    this.tourLoop = buildTourLoop(geo, lanes.centre, 41.013, 41.086);
    const anchorKeepOut = new KeepOut();
    const craftKeepOut = new KeepOut();
    for (const lane of [lanes.south, lanes.north]) {
      anchorKeepOut.addTrack(lane.xs, lane.zs, 380);
      craftKeepOut.addTrack(lane.xs, lane.zs, 170);
    }
    for (const plan of this.services) {
      for (const leg of plan.legs) {
        anchorKeepOut.addTrack(leg.route.xs, leg.route.zs, 220);
        craftKeepOut.addTrack(leg.route.xs, leg.route.zs, 70);
      }
    }
    anchorKeepOut.addTrack(this.tourLoop.xs, this.tourLoop.zs, 160);
    craftKeepOut.addTrack(this.tourLoop.xs, this.tourLoop.zs, 60);

    // Transit traffic, split between both lanes and spread along them (8–11 kn).
    const laneTracks = [new Track(lanes.south.points()), new Track(lanes.north.points())];
    for (let k = 0; k < nTransit; k++) {
      const track = laneTracks[k % 2];
      const c = cargoPick();
      const idx = Math.floor(k / 2);
      const per = Math.ceil(nTransit / 2);
      const start = (track.length * (idx + 0.2 + rng() * 0.5)) / per;
      const v = add(c.key, new LaneTransit(track, 4.2 + rng() * 1.5, start, new Sidestep(geo, models.get(c.key)!.beam / 2)), c.hull, c.seed, c.lift);
      this.initState(v);
    }

    // Anchored ships (all roughly head to the Bosphorus outflow: NE).
    for (const p of anchorageSpots(geo, nAnchor, rng, anchorKeepOut)) {
      const c = cargoPick();
      const yaw = -THREE.MathUtils.degToRad(35 + (rng() - 0.5) * 50);
      const v = add(c.key, new AtAnchor(p.x, p.z, yaw, 0.12 + rng() * 0.1, rng()), c.hull, c.seed, c.lift);
      this.initState(v);
    }

    // Boats made fast along the waterfront (scaled with the quality budget).
    const mooredShare = Math.min(1, budget / 70);
    const bridges = bridgeKeepOut(geo);
    for (const m of MOORINGS) {
      const model = models.get(m.model);
      if (!model) continue;
      const count = Math.max(1, Math.round(m.count * mooredShare));
      const spots = mooringSpots(geo, m.lat, m.lon, m.layout, count, model.length, model.beam, model.draft, berths, bridges, rng);
      spots.forEach((s, k) => {
        const beh = s.buoy ? new AtAnchor(s.x, s.z, s.yaw, 0.25, rng()) : new Moored(s.x, s.z, s.yaw, rng());
        const v = add(m.model, beh, m.paints[k % m.paints.length], packSeed(rng() * 8, 0.2 + rng() * 0.6));
        this.initState(v);
      });
    }

    // Small craft.
    const zones: (Zone & { weight: number })[] = SMALL_CRAFT_ZONES.map((z) => ({ ...latLonToLocal(z.lat, z.lon), radius: z.radius, weight: z.weight }));
    const totalW = zones.reduce((s, z) => s + z.weight, 0);
    const pickZone = (): Zone => {
      let r = rng() * totalW;
      for (const z of zones) {
        r -= z.weight;
        if (r <= 0) return z;
      }
      return zones[0];
    };
    const spawnWander = (key: string, zone: Zone, hulls: readonly number[], cruise: number, minClear: number, pauseChance: number, turnRate: number): void => {
      const p = Wander.randomPoint(geo, zone, minClear, rng, craftKeepOut);
      if (!p) return;
      const v = add(key, null, hulls[Math.floor(rng() * hulls.length)], packSeed(rng() * 8, rng() * 0.6));
      v.state.x = p.x;
      v.state.z = p.z;
      v.state.yaw = rng() * Math.PI * 2;
      v.behaviour = new Wander(geo, zone, cruise, minClear, pauseChance, createRng(0x9e37 + v.id * 131), v.state, turnRate, craftKeepOut);
    };
    for (let k = 0; k < nFishing; k++) spawnWander('fishing', pickZone(), HULL_PAINTS.fishing, 2.6 + rng() * 1.2, 45, 0.6, 0.22);
    for (let k = 0; k < nSeiner; k++) spawnWander('seiner', pickZone(), HULL_PAINTS.seiner, 4.2, 70, 0.4, 0.1);
    for (let k = 0; k < nYacht; k++) spawnWander('yacht', pickZone(), HULL_PAINTS.yacht, 6 + rng() * 5, 60, 0.15, 0.14);
    for (let k = 0; k < nSail; k++) spawnWander('sailboat', pickZone(), HULL_PAINTS.sailboat, 2.8, 60, 0.25, 0.18);
    for (let k = 0; k < nMotor; k++) spawnWander('motorboat', pickZone(), HULL_PAINTS.motorboat, 8 + rng() * 5, 50, 0.2, 0.3);
    for (let k = 0; k < nHarbour; k++) {
      const hz = HARBOUR_ZONES[k % HARBOUR_ZONES.length];
      const zone = { ...latLonToLocal(hz.lat, hz.lon), radius: hz.radius };
      if (hz.model === 'tug') spawnWander('tug', zone, HULL_PAINTS.tug, 4.5, 60, 0.35, 0.12);
      else spawnWander('pilot', zone, HULL_PAINTS.pilot, 8.5, 60, 0.3, 0.2);
    }

    // Sightseeing and excursion boats on a loop through the lower Bosphorus (~9 kn).
    for (let k = 0; k < nTour; k++) {
      const beh = new LoopRoute(this.tourLoop, 4.3 + rng() * 0.6, 0.2, (this.tourLoop.length * k) / nTour + rng() * 200, new Sidestep(geo, models.get('tour')!.beam / 2));
      const v = add('tour', beh, HULL_PAINTS.tour[k % HULL_PAINTS.tour.length], packSeed(1, rng() * 0.3));
      this.initState(v);
    }
    return out;
  }

  private initState(v: Vessel): void {
    v.behaviour.update(0.0001, v.state);
    v.behaviour.update(0.0001, v.state);
    v.state.yawRate = 0;
  }

  update(dt: number, camPos: THREE.Vector3): void {
    this.rules.update();
    const physics = this.physics;
    for (const v of this.vessels) {
      // The navigation waits for a hull that lags behind its reference (the traffic rules' cap is kept as it was).
      const st = v.state;
      const cap = st.cap;
      st.cap = Math.min(cap, physics.lagCap(v));
      v.behaviour.update(dt, st);
      st.cap = cap;
    }
    physics.update(dt, camPos);
    for (const v of this.vessels) {
      this.e.set(v.pitch, v.yaw, v.roll, 'YXZ');
      this.q.setFromEuler(this.e);
      this.p.set(v.x, v.heave, v.z);
      v.matrix.compose(this.p, this.q, this.one);
      this.renderer.update(v.handle as FleetHandle, v.matrix, camPos);
    }
  }

  /** Wake pool with one trail per vessel that ever moves (planing hulls get the wider spray pattern). */
  createWakes(): WakeTrails {
    const moving = this.vessels.filter((v) => !v.stationary);
    const wakes = new WakeTrails(Math.max(1, moving.length));
    for (const v of moving) v.wake = wakes.add(v.model.length, v.model.beam, PLANING.has(v.model.kind) ? 1 : 0);
    return wakes;
  }

  /**
   * Feeds every trail its bow position. Going astern adds nothing (the old wake fades where it is); once the vessel
   * goes ahead again, or a double-ender swaps ends, the trail restarts so it never draws a ribbon back across the hull.
   */
  feedWakes(wakes: WakeTrails, time: number): void {
    for (const v of this.vessels) {
      if (v.wake < 0) continue;
      const st = v.state;
      if (st.astern) {
        v.wakeBroken = true;
        continue;
      }
      if (v.wakeBroken || Math.abs(Math.atan2(Math.sin(v.yaw - v.wakeYaw), Math.cos(v.yaw - v.wakeYaw))) > 1.2) {
        wakes.restart(v.wake);
        v.wakeBroken = false;
      }
      v.wakeYaw = v.yaw;
      const half = v.model.length * 0.485;
      wakes.feed(v.wake, v.x - Math.sin(v.yaw) * half, v.z - Math.cos(v.yaw) * half, time);
    }
    wakes.commit(time);
  }

  dispose(): void {
    this.renderer.dispose();
  }
}
