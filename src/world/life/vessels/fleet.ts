import * as THREE from 'three';
import type { GeoQuery } from '../../../core/contracts';
import { latLonToLocal } from '../../../core/geo-coords';
import { createRng } from '../../../core/math/noise';
import { SMALL_CRAFT_ZONES } from '../data/places';
import { srgb } from '../util/mesh-builder';
import type { Path2 } from '../util/path';
import { AtAnchor, LaneTransit, LoopRoute, Moored, Priority, Sidestep, Vessel, Wander, type Zone } from './agents';
import { FleetRenderer, type FleetHandle } from './fleet-renderer';
import { HARBOUR_ZONES, MOORINGS, SERVICE_HANDLING, SERVICE_LINES } from './fleet-data';
import type { VesselModel } from './model-types';
import { BerthBook, FerryService } from './nav/ferry-service';
import { planService, type ServicePlan } from './nav/ferry-plan';
import { Track } from './nav/track';
import { KeepOut } from './nav/keep-out';
import { TrafficRules } from './nav/traffic-rules';
import { anchorageSpots, bridgeKeepOut, buildTourLoop, mooringSpots, type Berth, type StraitLanes } from './routes';
import { WakeTrails } from '../wakes/wake-trails';

const PLANING = new Set(['seabus', 'motorboat', 'pilot', 'yacht']);

/** Hull paints by ship type (tankers mostly black / navy / red, box ships in liner blues and greys, bulkers mixed). */
const CARGO_HULLS: Record<string, readonly number[]> = {
  tanker: [0x1c1e21, 0x1d3150, 0x7e2620, 0x1c1e21, 0x22453a, 0x5e1c22, 0x2c3a4a],
  container: [0x1d3150, 0x2c4b69, 0x474f57, 0x1c1e21, 0x7e2620, 0x22453a, 0x3b5f7a],
  bulk: [0x1c1e21, 0x7e2620, 0x1d3150, 0x8f8b82, 0x9b3a1f, 0x22453a, 0x474f57],
};
/** Sheer-strake / trim colours of the wooden and GRP fishing boats. */
const FISHING_TRIM = [0x2f9aa0, 0x3f7fc0, 0x1f3f7a, 0xb8322a, 0x3c8a5a, 0x2f9aa0, 0xd9a82a, 0x5aa9c9];
/** Purse seiners: weathered pale blue / green steel is the Rumelikavağı norm, with some white, blue and red hulls. */
const SEINER_HULLS = [0x8fb8bd, 0x9dbfae, 0x3f6f9a, 0xd8dad4, 0xa9332b, 0x7fa9b8];
const YACHT_HULLS = [0xf7f7f5, 0xf7f7f5, 0xf5f4ef, 0x1c2842, 0x6f767b];
/** Excursion boat stripes: Turyol blue, Dentur red, generic green/navy. */
const TOUR_STRIPES = [0x1f4f9a, 0xb3261e, 0x1f4f9a, 0x2b6c3f, 0x1c2842];
const MOTORBOAT_HULLS = [0xf4f4f1, 0xf4f4f1, 0x2a8a93, 0x1c2842, 0xc93a2c];
const CARGO_KEYS = ['tanker-a', 'tanker-b', 'tanker-c', 'container-a', 'container-b', 'bulk-a', 'bulk-b'];

export interface FleetPlanInput {
  geo: GeoQuery;
  models: Map<string, VesselModel>;
  berths: Map<string, Berth[]>;
  lanes: StraitLanes;
  shipCount: number;
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
 * Owns every vessel: plans the fleet from routes and quality, runs the traffic rules, advances behaviours and computes
 * per-vessel transforms (heave / roll / pitch in the waves, heel in turns, squat and trim when planing).
 */
export class Fleet {
  readonly vessels: Vessel[] = [];
  readonly renderer: FleetRenderer;
  readonly services: ServicePlan[] = [];
  readonly rules: TrafficRules;
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly p = new THREE.Vector3();
  private readonly one = new THREE.Vector3(1, 1, 1);
  private time = 0;
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
        const v = add(line.model, null, line.model === 'seabus' ? 0x1d2c56 : 0xeeede7, packSeed(0, 0.05 + rng() * 0.15));
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
        hull: pickHull(CARGO_HULLS[model.kind] ?? CARGO_HULLS.bulk),
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
    for (let k = 0; k < nFishing; k++) spawnWander('fishing', pickZone(), FISHING_TRIM, 2.6 + rng() * 1.2, 45, 0.6, 0.22);
    for (let k = 0; k < nSeiner; k++) spawnWander('seiner', pickZone(), SEINER_HULLS, 4.2, 70, 0.4, 0.1);
    for (let k = 0; k < nYacht; k++) spawnWander('yacht', pickZone(), YACHT_HULLS, 6 + rng() * 5, 60, 0.15, 0.14);
    for (let k = 0; k < nSail; k++) spawnWander('sailboat', pickZone(), [0xf6f6f3, 0xf6f6f3, 0x1d2a44, 0x2b4a3a], 2.8, 60, 0.25, 0.18);
    for (let k = 0; k < nMotor; k++) spawnWander('motorboat', pickZone(), MOTORBOAT_HULLS, 8 + rng() * 5, 50, 0.2, 0.3);
    for (let k = 0; k < nHarbour; k++) {
      const hz = HARBOUR_ZONES[k % HARBOUR_ZONES.length];
      const zone = { ...latLonToLocal(hz.lat, hz.lon), radius: hz.radius };
      if (hz.model === 'tug') spawnWander('tug', zone, [0xb3261e, 0xb3261e, 0xd9581c], 4.5, 60, 0.35, 0.12);
      else spawnWander('pilot', zone, [0xe0561b], 8.5, 60, 0.3, 0.2);
    }

    // Sightseeing and excursion boats on a loop through the lower Bosphorus (~9 kn).
    for (let k = 0; k < nTour; k++) {
      const beh = new LoopRoute(this.tourLoop, 4.3 + rng() * 0.6, 0.2, (this.tourLoop.length * k) / nTour + rng() * 200, new Sidestep(geo, models.get('tour')!.beam / 2));
      const v = add('tour', beh, TOUR_STRIPES[k % TOUR_STRIPES.length], packSeed(1, rng() * 0.3));
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
    this.time += dt;
    this.rules.update();
    const t = this.time;
    for (const v of this.vessels) {
      v.behaviour.update(dt, v.state);
      const L = v.model.length;
      const st = v.state;
      const kind = v.model.kind;
      // Motion in the waves: small hulls roll and pitch visibly, big ones hardly at all.
      const sizeK = Math.pow(30 / L, 0.75);
      const calm = st.mode === 'moored' ? 0.45 : 1;
      const rollAmp = THREE.MathUtils.degToRad(Math.min(3.2, 0.9 * sizeK)) * calm;
      const pitchAmp = THREE.MathUtils.degToRad(Math.min(1.6, 0.35 * sizeK)) * calm;
      const heaveAmp = Math.min(0.28, 0.1 * Math.pow(30 / L, 0.5)) * calm;
      const rollPeriod = 3.2 + v.model.beam * 0.42;
      const w = (Math.PI * 2) / rollPeriod;
      v.roll = rollAmp * (Math.sin(t * w + v.phase) * 0.8 + Math.sin(t * w * 1.63 + v.phase * 2.1) * 0.2);
      // Heel in turns (outwards for displacement hulls).
      v.roll += THREE.MathUtils.clamp(-st.yawRate * st.speed * (L < 40 ? 0.06 : 0.12), -0.09, 0.09);
      const planes = kind === 'yacht' || kind === 'seabus' || kind === 'motorboat' || kind === 'pilot';
      const planing = planes ? THREE.MathUtils.smoothstep(st.speed, 3, 10) : 0;
      const trim = kind === 'motorboat' ? 4.5 : kind === 'yacht' ? 2.2 : kind === 'pilot' ? 2.8 : 0.8;
      // Displacement hulls squat a little by the stern at speed.
      const squat = planes ? 0 : THREE.MathUtils.smoothstep(st.speed, 2, 8) * THREE.MathUtils.degToRad(0.25);
      v.pitch = pitchAmp * Math.sin(t * w * 1.37 + v.phase * 1.7) + planing * THREE.MathUtils.degToRad(trim) + squat;
      v.heave = heaveAmp * Math.sin(t * w * 1.1 + v.phase * 0.7) + planing * (kind === 'motorboat' ? 0.25 : 0.15);
      this.e.set(v.pitch, st.yaw, v.roll, 'YXZ');
      this.q.setFromEuler(this.e);
      this.p.set(st.x, v.heave + v.lift, st.z);
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
      if (v.wakeBroken || Math.abs(Math.atan2(Math.sin(st.yaw - v.wakeYaw), Math.cos(st.yaw - v.wakeYaw))) > 1.2) {
        wakes.restart(v.wake);
        v.wakeBroken = false;
      }
      v.wakeYaw = st.yaw;
      const half = v.model.length * 0.485;
      wakes.feed(v.wake, st.x - Math.sin(st.yaw) * half, st.z - Math.cos(st.yaw) * half, time);
    }
    wakes.commit(time);
  }

  dispose(): void {
    this.renderer.dispose();
  }
}
