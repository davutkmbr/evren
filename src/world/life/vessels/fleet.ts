import * as THREE from 'three';
import type { GeoQuery } from '../../../core/contracts';
import { latLonToLocal } from '../../../core/geo-coords';
import { createRng } from '../../../core/math/noise';
import { SMALL_CRAFT_ZONES } from '../data/places';
import { srgb } from '../util/mesh-builder';
import type { Path2 } from '../util/path';
import { AtAnchor, LaneTransit, LoopRoute, Vessel, Wander, type Zone } from './agents';
import { FleetRenderer, type FleetHandle } from './fleet-renderer';
import type { VesselModel } from './model-types';
import { anchorageSpots, buildTourLoop, type FerryLoop, type StraitLanes } from './routes';

const CARGO_HULLS = [0x7e2620, 0x1c1e21, 0x1d3150, 0x22453a, 0x474f57, 0x5e1c22, 0x2c4b69, 0x8f8b82, 0x9b3a1f];
const FISHING_HULLS = [0xf1efe8, 0x2d6db0, 0x3b7d4d, 0xb3312a, 0xe8d8a6, 0x288797, 0xf1efe8];
const SEINER_HULLS = [0x1f4f93, 0xa92f28, 0xe7e5de, 0x245d45];
const YACHT_HULLS = [0xf7f7f5, 0xf7f7f5, 0xf5f4ef, 0x1c2842, 0x6f767b];
const CARGO_KEYS = ['tanker-a', 'tanker-b', 'tanker-c', 'container-a', 'container-b', 'bulk-a', 'bulk-b'];

export interface FleetPlanInput {
  geo: GeoQuery;
  models: Map<string, VesselModel>;
  loops: FerryLoop[];
  lanes: StraitLanes;
  shipCount: number;
}

/** Palette seed: palette index in [0, 8) + weathering fraction, packed as the instance alpha. */
function packSeed(palette: number, weather: number): number {
  return (Math.floor(palette) % 8) / 8 + Math.min(Math.max(weather, 0), 0.999) / 8;
}

/**
 * Owns every vessel: plans the fleet from routes and quality, advances behaviours and computes per-vessel
 * transforms (heave / roll / pitch, turning heel, ballast freeboard).
 */
export class Fleet {
  readonly vessels: Vessel[] = [];
  readonly renderer: FleetRenderer;
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly p = new THREE.Vector3();
  private readonly one = new THREE.Vector3(1, 1, 1);
  private time = 0;
  private laneGroups: Vessel[][] = [];
  tourLoop: Path2 | null = null;

  constructor(private readonly input: FleetPlanInput, material: THREE.Material) {
    const plan = this.plan();
    const big = plan.filter((v) => v.model.big).length;
    this.renderer = new FleetRenderer(input.models, material, big + 4, plan.length - big + 4);
    for (const v of plan) {
      v.handle = this.renderer.add(v.model, v.paint, v.seed);
      this.vessels.push(v);
    }
  }

  private plan(): Vessel[] {
    const { geo, models, loops, lanes } = this.input;
    const rng = createRng(0x51f7);
    const out: Vessel[] = [];
    let id = 0;
    const add = (key: string, behaviour: Vessel['behaviour'], paintHex: number, seed: number, lift = 0): Vessel => {
      const model = models.get(key)!;
      const v = new Vessel(id++, model, behaviour, srgb(paintHex), seed);
      v.lift = lift;
      out.push(v);
      return v;
    };
    const budget = Math.max(12, this.input.shipCount);
    const lowFerries = budget < 40;

    // Scheduled ferries.
    for (const loop of loops) {
      const n = lowFerries ? 1 : loop.line.vessels;
      const key = loop.line.kind === 'seabus' ? 'seabus' : 'vapur';
      const model = models.get(key)!;
      const vmax = key === 'seabus' ? 13.5 : 7.0;
      const accel = key === 'seabus' ? 0.5 : 0.22;
      for (let k = 0; k < n; k++) {
        const start = loop.path.length * ((k + 0.37 * (loop.stops.length > 0 ? 1 : 0)) / n) + rng() * 150;
        const beh = new LoopRoute(loop.path, loop.stops, vmax, accel, loop.line.dwell, start);
        const v = add(key, beh, key === 'seabus' ? 0xf1f1ee : 0xebe9e2, packSeed(0, 0.05 + rng() * 0.15));
        void model;
        this.initState(v);
      }
    }

    const rest = Math.max(0, budget - out.length);
    const nTransit = Math.round(rest * 0.26);
    const nAnchor = Math.round(rest * 0.24);
    const nFishing = Math.round(rest * 0.18);
    const nYacht = Math.round(rest * 0.12);
    const nSail = Math.round(rest * 0.05);
    const nTour = Math.max(1, Math.round(rest * 0.08));
    const nSeiner = Math.max(0, rest - nTransit - nAnchor - nFishing - nYacht - nSail - nTour);

    const cargoPick = (): { key: string; hull: number; seed: number; lift: number } => {
      const key = CARGO_KEYS[Math.floor(rng() * CARGO_KEYS.length)];
      const model = models.get(key)!;
      const ballast = rng() < 0.4;
      return {
        key,
        hull: CARGO_HULLS[Math.floor(rng() * CARGO_HULLS.length)],
        seed: packSeed(rng() * 8, 0.25 + rng() * 0.7),
        lift: ballast ? model.draft * (0.3 + rng() * 0.15) : rng() * model.draft * 0.08,
      };
    };

    // Transit traffic, split between both lanes and spread along them.
    const laneList: [Path2, Vessel[]][] = [
      [lanes.south, []],
      [lanes.north, []],
    ];
    for (let k = 0; k < nTransit; k++) {
      const [path, group] = laneList[k % 2];
      const c = cargoPick();
      const idx = Math.floor(k / 2);
      const per = Math.ceil(nTransit / 2);
      const start = (path.length * (idx + 0.2 + rng() * 0.5)) / per;
      const beh = new LaneTransit(path, 4.6 + rng() * 1.0, start);
      const v = add(c.key, beh, c.hull, c.seed, c.lift);
      group.push(v);
      this.initState(v);
    }
    this.laneGroups = laneList.map(([, g]) => g);

    // Anchored ships (all roughly head to the Bosphorus outflow: NE).
    const spots = anchorageSpots(geo, nAnchor, rng);
    for (const p of spots) {
      const c = cargoPick();
      const yaw = -THREE.MathUtils.degToRad(35 + (rng() - 0.5) * 50);
      const v = add(c.key, new AtAnchor(p.x, p.z, yaw, 0.12 + rng() * 0.1), c.hull, c.seed, c.lift);
      this.initState(v);
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
    const spawnWander = (key: string, hulls: number[], cruise: number, minClear: number, pauseChance: number): void => {
      const zone = pickZone();
      const p = Wander.randomPoint(geo, zone, minClear, rng);
      if (!p) return;
      const v = add(key, null as unknown as Vessel['behaviour'], hulls[Math.floor(rng() * hulls.length)], packSeed(rng() * 8, rng() * 0.6));
      v.state.x = p.x;
      v.state.z = p.z;
      v.state.yaw = rng() * Math.PI * 2;
      v.behaviour = new Wander(geo, zone, cruise, minClear, pauseChance, createRng(0x9e37 + v.id * 131), v.state);
    };
    for (let k = 0; k < nFishing; k++) spawnWander('fishing', FISHING_HULLS, 2.6 + rng() * 1.2, 45, 0.6);
    for (let k = 0; k < nSeiner; k++) spawnWander('seiner', SEINER_HULLS, 4.2, 70, 0.4);
    for (let k = 0; k < nYacht; k++) spawnWander('yacht', YACHT_HULLS, 6 + rng() * 5, 60, 0.15);
    for (let k = 0; k < nSail; k++) spawnWander('sailboat', [0xf6f6f3, 0xf6f6f3, 0x1d2a44, 0x2b4a3a], 2.8, 60, 0.25);

    // Sightseeing boats on a loop through the lower Bosphorus.
    this.tourLoop = buildTourLoop(geo, lanes.centre, 41.013, 41.086);
    for (let k = 0; k < nTour; k++) {
      const beh = new LoopRoute(this.tourLoop, [], 4.3 + rng() * 0.5, 0.2, 0, (this.tourLoop.length * k) / nTour + rng() * 200);
      const v = add('tour', beh, [0xf2f0ea, 0xeeece6, 0x2c4f86][k % 3], packSeed(1, rng() * 0.3));
      this.initState(v);
    }
    return out;
  }

  private initState(v: Vessel): void {
    v.behaviour.update(0.0001, v.state);
    v.behaviour.update(0.0001, v.state);
  }

  update(dt: number, camPos: THREE.Vector3): void {
    this.time += dt;
    // Gap keeping inside each separation lane.
    for (const group of this.laneGroups) {
      const sorted = group.map((v) => v.behaviour as LaneTransit).sort((a, b) => a.s - b.s);
      for (let i = 0; i < sorted.length; i++) {
        const me = sorted[i];
        const ahead = sorted[i + 1];
        if (ahead) {
          me.gapAhead = ahead.s - me.s;
          me.speedAhead = ahead.v;
        } else {
          me.gapAhead = Infinity;
        }
      }
    }
    const t = this.time;
    for (const v of this.vessels) {
      v.behaviour.update(dt, v.state);
      const L = v.model.length;
      const st = v.state;
      const sizeK = Math.pow(30 / L, 0.75);
      const rollAmp = THREE.MathUtils.degToRad(Math.min(3.2, 0.9 * sizeK));
      const pitchAmp = THREE.MathUtils.degToRad(Math.min(1.6, 0.35 * sizeK));
      const heaveAmp = Math.min(0.28, 0.1 * Math.pow(30 / L, 0.5));
      const rollPeriod = 3.2 + v.model.beam * 0.42;
      const w = (Math.PI * 2) / rollPeriod;
      v.roll = rollAmp * (Math.sin(t * w + v.phase) * 0.8 + Math.sin(t * w * 1.63 + v.phase * 2.1) * 0.2);
      v.roll += THREE.MathUtils.clamp(-st.yawRate * st.speed * (L < 40 ? 0.06 : 0.12), -0.09, 0.09);
      const planing = v.model.kind === 'yacht' || v.model.kind === 'seabus' ? THREE.MathUtils.smoothstep(st.speed, 3, 10) : 0;
      v.pitch = pitchAmp * Math.sin(t * w * 1.37 + v.phase * 1.7) + planing * THREE.MathUtils.degToRad(v.model.kind === 'yacht' ? 2.2 : 0.8);
      v.heave = heaveAmp * Math.sin(t * w * 1.1 + v.phase * 0.7) + planing * 0.15;
      this.e.set(v.pitch, st.yaw, v.roll, 'YXZ');
      this.q.setFromEuler(this.e);
      this.p.set(st.x, v.heave + v.lift, st.z);
      v.matrix.compose(this.p, this.q, this.one);
      this.renderer.update(v.handle as FleetHandle, v.matrix, camPos);
    }
  }

  dispose(): void {
    this.renderer.dispose();
  }
}
