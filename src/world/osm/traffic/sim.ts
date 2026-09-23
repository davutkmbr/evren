/**
 * Road traffic simulation on the lane graph (main thread, struct-of-arrays, no per-frame allocation).
 *
 * - Car following: Intelligent Driver Model against the vehicle ahead (same path, or the rearmost vehicle on the
 *   next one or two paths of its route) and against virtual stops: red / amber signals, busy zebra crossings,
 *   approaching trams at tram crossings, bus stops (buses dwell) and junction entries it may not take yet.
 * - Speed: lane speed x driver factor, capped by the curvature speed profile of the path (connectors included).
 * - Junctions: signalised approaches obey their heads; elsewhere a vehicle commits to the junction only when the
 *   box is free of other approaches, no higher-ranked traffic is close and there is room behind the exit
 *   ("don't block the box"); long waits win fairness, very long ones force their way.
 * - Routes: weighted random choice among the lane's connectors on entering a lane (buses keep to bus lanes).
 * - Population: follows a time-of-day curve; vehicles enter at the slice edges and off screen, leave at exits /
 *   sinks, and fade in / out over the last metres before the build rect edge.
 */
import * as THREE from 'three';
import type { WorldBounds } from '../../../core/contracts';
import { MODEL_LENGTH, MODEL_WHEELBASE, Model, paintOf, pickModel, rng32, trafficMix } from './catalog';
import { VehicleState } from './materials';
import { PathFlag } from './paths';
import { LaneFlag, SAMPLE_STRIDE, StopKind, type TrafficNet } from './protocol';
import type { VehicleRenderer } from './render';
import type { Signals } from './signals';

/** Look-ahead (m) for leaders on following paths. */
const LOOK = 90;
/** Metres over which vehicles grow / shrink at the build rect edge. */
const EDGE_FADE = 14;
/**
 * Update-rate tiers (the simulation budget goes to what can be seen): vehicles within NEAR m or visible within
 * MID m tick every frame, visible ones farther away every 2nd, everything else every 4th frame (with the
 * accumulated dt). A vehicle is posed only when it ticks.
 */
const NEAR = 260;
const MID = 480;
/** No vehicle pops up inside the view frustum closer than this (m), nor within SPAWN_CLEAR m of the camera. */
const SPAWN_VIEW = 900;
const SPAWN_CLEAR = 320;

interface Driver {
  a: number;
  b: number;
  T: number;
  s0: number;
  vMax: number;
  factor: [number, number];
}

const DRIVERS: Record<number, Driver> = {
  [Model.Sedan]: { a: 2.2, b: 2.6, T: 1.15, s0: 1.8, vMax: 17, factor: [0.88, 1.15] },
  [Model.Hatch]: { a: 2.1, b: 2.6, T: 1.15, s0: 1.8, vMax: 16, factor: [0.88, 1.12] },
  [Model.Suv]: { a: 2.3, b: 2.6, T: 1.1, s0: 1.9, vMax: 17, factor: [0.92, 1.15] },
  [Model.TaxiDoblo]: { a: 2.6, b: 3.0, T: 0.85, s0: 1.5, vMax: 17, factor: [1.02, 1.25] },
  [Model.TaxiSedan]: { a: 2.7, b: 3.0, T: 0.85, s0: 1.5, vMax: 18, factor: [1.02, 1.25] },
  [Model.Van]: { a: 1.8, b: 2.4, T: 1.3, s0: 2.0, vMax: 15, factor: [0.9, 1.08] },
  [Model.PanelVan]: { a: 1.5, b: 2.2, T: 1.4, s0: 2.2, vMax: 14, factor: [0.85, 1.02] },
  [Model.Minibus]: { a: 1.9, b: 2.6, T: 1.0, s0: 1.8, vMax: 15, factor: [0.95, 1.15] },
  [Model.Bus]: { a: 1.1, b: 1.8, T: 1.6, s0: 2.6, vMax: 13, factor: [0.8, 0.95] },
  [Model.Moto]: { a: 3.2, b: 3.4, T: 0.7, s0: 1.2, vMax: 18, factor: [1.05, 1.3] },
  [Model.Truck]: { a: 1.3, b: 2.0, T: 1.5, s0: 2.4, vMax: 13, factor: [0.82, 1.0] },
};

/** Share of the full-traffic density by hour of day (piecewise linear). */
const TIME_CURVE: readonly (readonly [number, number])[] = [
  [0, 0.3],
  [2, 0.18],
  [5, 0.14],
  [6.5, 0.5],
  [8, 1],
  [10, 0.78],
  [13, 0.85],
  [17, 0.95],
  [18.5, 1],
  [20, 0.82],
  [22, 0.6],
  [24, 0.3],
];

export function timeFactor(h: number): number {
  const c = TIME_CURVE;
  for (let i = 1; i < c.length; i++) {
    if (h <= c[i][0]) {
      const t = (h - c[i - 1][0]) / (c[i][0] - c[i - 1][0]);
      return c[i - 1][1] + (c[i][1] - c[i - 1][1]) * t;
    }
  }
  return c[c.length - 1][1];
}

/** Stop state shared with other systems: busy pedestrian crossings and tram crossings (1 = must stop). */
export interface CrossingStates {
  tram: Uint8Array;
}

export interface SimStats {
  vehicles: number;
  target: number;
  spawned: number;
  despawned: number;
  stuck: number;
  /** Vehicles moved by rebalance(). */
  moved: number;
}

export class CarSim {
  readonly cap: number;
  private readonly rng = rng32(0x5eed);
  // vehicle state (struct of arrays)
  readonly alive: Uint8Array;
  readonly model: Uint8Array;
  readonly slot: Int32Array;
  private readonly path: Int32Array;
  private readonly prevPath: Int32Array;
  private readonly lane: Int32Array;
  private readonly conn: Int32Array;
  private readonly onConn: Uint8Array;
  readonly s: Float32Array;
  readonly v: Float32Array;
  private readonly acc: Float32Array;
  private readonly len: Float32Array;
  private readonly wb: Float32Array;
  private readonly factor: Float32Array;
  private readonly stopIdx: Int32Array;
  private readonly wait: Float32Array;
  private readonly dwell: Float32Array;
  private readonly committed: Uint8Array;
  private readonly state: Uint8Array;
  private readonly paint: Float32Array;
  private readonly served: Int32Array;
  /** Update interval (frames, 1 / 2 / 4) and dt accumulated while skipped. */
  private readonly rate: Uint8Array;
  private readonly lag: Float32Array;
  private readonly tick: Uint8Array;
  private frame = 0;
  private readonly free: number[] = [];
  private count = 0;
  // path occupancy: vehicle ids ordered front (largest s) first
  private readonly pathVeh: number[][];
  // junction bookkeeping
  private readonly nodeOcc: Int16Array;
  private readonly nodeHolder: Int32Array;
  private readonly nodeWaiter: Int32Array;
  private readonly nodeIncoming: number[][];
  private readonly laneSignalEnd: Uint8Array;
  // spawn tables
  private readonly spawnCum: Float64Array;
  private readonly entryLanes: number[];
  private readonly entryCum: Float64Array;
  private fullTarget = 0;
  target = 0;
  readonly stats: SimStats = { vehicles: 0, target: 0, spawned: 0, despawned: 0, stuck: 0, moved: 0 };
  private time = 0;
  /** Set by index.ts once bridge deck heights are in the samples. */
  decksReady = false;
  private lightsOn = false;
  private readonly tmp = { gap: 0, vl: 0 };

  constructor(
    private readonly net: TrafficNet,
    private readonly renderer: VehicleRenderer,
    private readonly signals: Signals,
    private readonly crossings: CrossingStates,
    private readonly rect: WorldBounds,
    capacity: number,
  ) {
    this.cap = capacity;
    const n = capacity;
    this.alive = new Uint8Array(n);
    this.model = new Uint8Array(n);
    this.slot = new Int32Array(n).fill(-1);
    this.path = new Int32Array(n);
    this.prevPath = new Int32Array(n).fill(-1);
    this.lane = new Int32Array(n);
    this.conn = new Int32Array(n).fill(-1);
    this.onConn = new Uint8Array(n);
    this.s = new Float32Array(n);
    this.v = new Float32Array(n);
    this.acc = new Float32Array(n);
    this.len = new Float32Array(n);
    this.wb = new Float32Array(n);
    this.factor = new Float32Array(n);
    this.stopIdx = new Int32Array(n);
    this.wait = new Float32Array(n);
    this.dwell = new Float32Array(n);
    this.committed = new Uint8Array(n);
    this.state = new Uint8Array(n);
    this.paint = new Float32Array(n * 3);
    this.served = new Int32Array(n).fill(-1);
    this.rate = new Uint8Array(n).fill(1);
    this.lag = new Float32Array(n);
    this.tick = new Uint8Array(n);
    for (let i = n - 1; i >= 0; i--) {
      this.free.push(i);
    }
    this.pathVeh = Array.from({ length: net.pathStart.length }, () => []);
    const N = net.nodeX.length;
    this.nodeOcc = new Int16Array(N);
    this.nodeHolder = new Int32Array(N).fill(-1);
    this.nodeWaiter = new Int32Array(N).fill(-1);
    this.nodeIncoming = Array.from({ length: N }, () => []);
    const L = net.lanePath.length;
    this.laneSignalEnd = new Uint8Array(L);
    const cum = new Float64Array(L);
    let acc = 0;
    const entries: number[] = [];
    for (let l = 0; l < L; l++) {
      this.nodeIncoming[net.laneTo[l]].push(l);
      const st = net.laneStopStart[l];
      for (let k = st; k < st + net.laneStopCount[l]; k++) {
        if (net.stopKind[k] === StopKind.Signal && net.pathLength[net.lanePath[l]] - net.stopS[k] < 30) {
          this.laneSignalEnd[l] = 1;
        }
      }
      const len = net.pathLength[net.lanePath[l]];
      const w = net.laneFlags[l] & LaneFlag.Hidden ? 0 : len * net.laneDensity[l];
      acc += w;
      cum[l] = acc;
      if (net.laneFlags[l] & LaneFlag.Entry && net.laneConnCount[l] > 0) {
        entries.push(l);
      }
    }
    this.spawnCum = cum;
    this.fullTarget = acc;
    this.entryLanes = entries;
    this.entryCum = new Float64Array(entries.length);
    let e = 0;
    entries.forEach((l, k) => {
      e += net.laneDensity[l] * 100;
      this.entryCum[k] = e;
    });
  }

  get vehicleCount(): number {
    return this.count;
  }

  /** Full-traffic vehicle count of the network (before the capacity cap and the time-of-day curve). */
  get fullCount(): number {
    return this.fullTarget;
  }

  setTarget(hours: number, densityScale: number): void {
    this.target = Math.min(this.cap - 8, Math.round(this.fullTarget * densityScale * timeFactor(hours)));
    this.stats.target = this.target;
  }

  /**
   * Keeps the designed density distribution: random route choice slowly drains some links (a main road fed by turns)
   * and fills others. Out of sight, a vehicle on a lane holding more than twice its share is moved to a random lane
   * holding less than half of its share.
   */
  private rebalance(cam: { x: number; z: number; frustum: THREE.Frustum | null }): void {
    const net = this.net;
    const scale = this.target / Math.max(1, this.fullTarget);
    const lane = this.pickLane(this.spawnCum, this.fullTarget);
    const len = this.pathLen(net.lanePath[lane]);
    const share = len * net.laneDensity[lane] * scale;
    if (share < 0.6 || this.pathVeh[net.lanePath[lane]].length >= share * 0.5) {
      return;
    }
    for (let k = 0; k < 6; k++) {
      const i = (this.rng() * this.cap) | 0;
      if (!this.alive[i] || this.onConn[i] || this.committed[i]) {
        continue;
      }
      const l = this.lane[i];
      const own = this.pathLen(net.lanePath[l]) * net.laneDensity[l] * scale;
      if (this.pathVeh[net.lanePath[l]].length > Math.max(2, own * 2) && !this.visible(i, cam)) {
        this.despawn(i);
        if (!this.spawnRandomOn(lane, cam)) {
          this.spawnRandom(cam);
        }
        this.stats.moved++;
        return;
      }
    }
  }

  /* ---------------- sampling ---------------- */

  private pathLen(p: number): number {
    return this.net.pathLength[p];
  }

  /** Writes x, y, z and roll at arc s of path p into out[o..o+3] (clamped to the path). */
  private sample(p: number, s: number, out: Float32Array, o: number): void {
    const net = this.net;
    const n = net.pathCount[p];
    const f = Math.min(n - 1.0001, Math.max(0, s / net.pathStep[p]));
    const i = f | 0;
    const t = f - i;
    const d = net.samples;
    const a = (net.pathStart[p] + i) * SAMPLE_STRIDE;
    const b = a + SAMPLE_STRIDE;
    out[o] = d[a] + (d[b] - d[a]) * t;
    out[o + 1] = d[a + 1] + (d[b + 1] - d[a + 1]) * t;
    out[o + 2] = d[a + 2] + (d[b + 2] - d[a + 2]) * t;
    out[o + 3] = d[a + 3] + (d[b + 3] - d[a + 3]) * t;
  }

  private capAt(p: number, s: number): number {
    const net = this.net;
    const n = net.pathCount[p];
    const i = Math.min(n - 1, Math.max(0, Math.round(s / net.pathStep[p])));
    return net.samples[(net.pathStart[p] + i) * SAMPLE_STRIDE + 4];
  }

  /** Path after the current one on vehicle i's route (-1 if unknown). */
  private nextPath(i: number): number {
    if (this.onConn[i]) {
      return this.net.lanePath[this.lane[i]];
    }
    const c = this.conn[i];
    return c >= 0 ? this.net.connPath[c] : -1;
  }

  /** Point on vehicle i's route at arc s relative to its current path (may run into the next / previous path). */
  private routePoint(i: number, s: number, out: Float32Array, o: number): void {
    const p = this.path[i];
    const L = this.pathLen(p);
    if (s <= L && s >= 0) {
      this.sample(p, s, out, o);
      return;
    }
    if (s > L) {
      const np = this.nextPath(i);
      if (np >= 0 && s - L <= this.pathLen(np)) {
        this.sample(np, s - L, out, o);
        return;
      }
      // extrapolate along the end tangent
      this.sample(p, L, out, o);
      this.sample(p, Math.max(0, L - 1), SCRATCH, 0);
      const k = s - L;
      out[o] += (out[o] - SCRATCH[0]) * k;
      out[o + 2] += (out[o + 2] - SCRATCH[2]) * k;
      return;
    }
    const pp = this.prevPath[i];
    if (pp >= 0 && this.pathLen(pp) + s >= 0) {
      this.sample(pp, this.pathLen(pp) + s, out, o);
      return;
    }
    this.sample(p, 0, out, o);
    this.sample(p, Math.min(1, L), SCRATCH, 0);
    out[o] += (out[o] - SCRATCH[0]) * -s;
    out[o + 2] += (out[o + 2] - SCRATCH[2]) * -s;
  }

  /* ---------------- occupancy lists ---------------- */

  private enterPath(i: number, p: number, s: number): void {
    const list = this.pathVeh[p];
    // keep the list ordered by s (front first); new vehicles are normally the rearmost
    let k = list.length;
    while (k > 0 && this.s[list[k - 1]] < s) {
      k--;
    }
    if (k === list.length) {
      list.push(i);
    } else {
      list.splice(k, 0, i);
    }
    this.path[i] = p;
    this.s[i] = s;
  }

  private leavePath(i: number): void {
    const list = this.pathVeh[this.path[i]];
    const k = list.indexOf(i);
    if (k >= 0) {
      list.splice(k, 1);
    }
  }

  /* ---------------- spawning ---------------- */

  private pickLane(cum: Float64Array, total: number): number {
    const r = this.rng() * total;
    let lo = 0;
    let hi = cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < r) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return lo;
  }

  /** Room check: no vehicle within `gap` m of arc s on path p. */
  private clearAt(p: number, s: number, halfLen: number, gap: number): boolean {
    for (const j of this.pathVeh[p]) {
      if (Math.abs(this.s[j] - s) < halfLen + this.len[j] / 2 + gap) {
        return false;
      }
    }
    return true;
  }

  private chooseModel(lane: number): number {
    const net = this.net;
    const bus = (net.laneFlags[lane] & LaneFlag.Bus) !== 0;
    return pickModel(trafficMix(net.laneRank[lane], bus), this.rng());
  }

  spawn(lane: number, s: number, model: number, v: number): number {
    const i = this.free.pop();
    if (i === undefined) {
      return -1;
    }
    const net = this.net;
    const drv = DRIVERS[model];
    this.alive[i] = 1;
    this.model[i] = model;
    this.len[i] = MODEL_LENGTH[model];
    this.wb[i] = MODEL_WHEELBASE[model];
    this.factor[i] = drv.factor[0] + (drv.factor[1] - drv.factor[0]) * this.rng();
    this.lane[i] = lane;
    this.onConn[i] = 0;
    this.prevPath[i] = -1;
    this.committed[i] = 0;
    this.wait[i] = 0;
    this.dwell[i] = 0;
    this.served[i] = -1;
    this.v[i] = v;
    this.acc[i] = 0;
    this.rate[i] = 1;
    this.lag[i] = 0;
    this.tick[i] = 1;
    this.enterPath(i, net.lanePath[lane], s);
    const st = net.laneStopStart[lane];
    let k = st;
    while (k < st + net.laneStopCount[lane] && net.stopS[k] < s + this.len[i] / 2) {
      k++;
    }
    this.stopIdx[i] = k;
    this.conn[i] = this.chooseConn(i, lane);
    const c = paintOf(model, this.rng(), this.rng());
    this.paint.set(c, i * 3);
    const grey = Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]) < 0.05 && c[0] > 0.05 && c[0] < 0.55;
    this.state[i] = grey || this.rng() < 0.2 ? VehicleState.Metallic : 0;
    this.slot[i] = this.renderer.allocate(model, c, this.state[i]);
    this.count++;
    this.stats.spawned++;
    return i;
  }

  private despawn(i: number): void {
    if (!this.alive[i]) {
      return;
    }
    this.releaseJunction(i);
    this.leavePath(i);
    this.renderer.release(this.slot[i]);
    this.slot[i] = -1;
    this.alive[i] = 0;
    this.free.push(i);
    this.count--;
    this.stats.despawned++;
  }

  private releaseJunction(i: number): void {
    if (this.committed[i] || this.onConn[i]) {
      const c = this.conn[i];
      if (c >= 0) {
        const node = this.net.connNode[c];
        this.nodeOcc[node] = Math.max(0, this.nodeOcc[node] - 1);
        if (this.nodeOcc[node] === 0) {
          this.nodeHolder[node] = -1;
        }
      }
      this.committed[i] = 0;
    }
  }

  /** Weighted random connector of a lane for vehicle i (-1 at exits / sinks). */
  private chooseConn(i: number, lane: number): number {
    const net = this.net;
    const n = net.laneConnCount[lane];
    if (n === 0) {
      return -1;
    }
    const c0 = net.laneConnStart[lane];
    const bus = this.model[i] === Model.Bus;
    const heavy = bus || this.model[i] === Model.Truck;
    let total = 0;
    for (let k = c0; k < c0 + n; k++) {
      total += this.connW(k, bus, heavy);
    }
    let r = this.rng() * total;
    for (let k = c0; k < c0 + n; k++) {
      r -= this.connW(k, bus, heavy);
      if (r <= 0) {
        return k;
      }
    }
    return c0 + n - 1;
  }

  private connW(k: number, bus: boolean, heavy: boolean): number {
    const net = this.net;
    let w = net.connWeight[k];
    const to = net.connTo[k];
    if (bus && !(net.laneFlags[to] & LaneFlag.Bus)) {
      w *= 0.02;
    }
    if (heavy && net.laneRank[to] <= 1) {
      w *= 0.1;
    }
    return Math.max(w, 1e-6);
  }

  /** Initial population spread over the network (off-screen rules do not apply at load). */
  populate(): void {
    let guard = this.target * 4;
    while (this.count < this.target && guard-- > 0) {
      this.spawnRandom(null);
    }
  }

  private spawnRandom(camera: { x: number; z: number; frustum: THREE.Frustum | null } | null): boolean {
    return this.spawnRandomOn(this.pickLane(this.spawnCum, this.fullTarget), camera);
  }

  private spawnRandomOn(lane: number, camera: { x: number; z: number; frustum: THREE.Frustum | null } | null): boolean {
    const net = this.net;
    const p = net.lanePath[lane];
    const L = this.pathLen(p);
    if (L < 8) {
      return false;
    }
    const model = this.chooseModel(lane);
    const half = MODEL_LENGTH[model] / 2;
    const s = half + this.rng() * (L - 2 * half);
    if (!this.clearAt(p, s, half, 3)) {
      return false;
    }
    if (camera) {
      const o = SCRATCH;
      this.sample(p, s, o, 0);
      const dx = o[0] - camera.x;
      const dz = o[2] - camera.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < SPAWN_CLEAR * SPAWN_CLEAR) {
        return false;
      }
      if (camera.frustum && d2 < SPAWN_VIEW * SPAWN_VIEW) {
        SPHERE.center.set(o[0], o[1], o[2]);
        SPHERE.radius = 8;
        if (camera.frustum.intersectsSphere(SPHERE)) {
          return false;
        }
      }
    }
    return this.spawn(lane, s, model, Math.min(net.laneSpeed[lane] * 0.7, 8) * this.rng()) >= 0;
  }

  private spawnEntry(): boolean {
    if (!this.entryLanes.length) {
      return false;
    }
    const k = this.pickLane(this.entryCum, this.entryCum[this.entryCum.length - 1]);
    const lane = this.entryLanes[k];
    const p = this.net.lanePath[lane];
    const model = this.chooseModel(lane);
    const half = MODEL_LENGTH[model] / 2;
    if (this.pathLen(p) < half * 2 + 2 || !this.clearAt(p, half, half, 6)) {
      return false;
    }
    return this.spawn(lane, half, model, Math.min(this.net.laneSpeed[lane], 9)) >= 0;
  }

  /* ---------------- per-frame ---------------- */

  /** Leader gap / speed of vehicle i into this.tmp (gap = Infinity when free). */
  private leader(i: number): void {
    const t = this.tmp;
    const p = this.path[i];
    const list = this.pathVeh[p];
    const k = list.indexOf(i);
    const front = this.s[i] + this.len[i] / 2;
    if (k > 0) {
      const j = list[k - 1];
      t.gap = this.s[j] - this.len[j] / 2 - front;
      t.vl = this.v[j];
      return;
    }
    let dist = this.pathLen(p) - front;
    let np = this.nextPath(i);
    // after the next path, the lane of a chosen connector
    let np2 = -1;
    if (!this.onConn[i] && this.conn[i] >= 0) {
      np2 = this.net.lanePath[this.net.connTo[this.conn[i]]];
    }
    for (let hop = 0; hop < 2 && np >= 0 && dist < LOOK; hop++) {
      const l2 = this.pathVeh[np];
      if (l2.length) {
        const j = l2[l2.length - 1];
        t.gap = dist + this.s[j] - this.len[j] / 2;
        t.vl = this.v[j];
        return;
      }
      dist += this.pathLen(np);
      np = hop === 0 ? np2 : -1;
    }
    t.gap = Infinity;
    t.vl = 0;
  }

  /** Distance from vehicle i's front to the nearest stop it must respect (Infinity if none). */
  private stopGap(i: number): number {
    const net = this.net;
    const front = this.s[i] + this.len[i] / 2;
    const v = this.v[i];
    const model = this.model[i];
    let gap = Infinity;
    if (!this.onConn[i]) {
      const lane = this.lane[i];
      const end = net.laneStopStart[lane] + net.laneStopCount[lane];
      for (let k = this.stopIdx[i]; k < end; k++) {
        const d = net.stopS[k] - front;
        if (d < -0.5) {
          this.stopIdx[i] = k + 1;
          continue;
        }
        if (d > 80) {
          break;
        }
        if (this.stopActive(i, k, d, v, model)) {
          gap = d;
          break;
        }
      }
      // junction entry
      const pathL = this.pathLen(this.path[i]);
      const dEnd = pathL - front;
      if (!this.committed[i] && this.conn[i] >= 0 && dEnd < Math.max(7, (v * v) / 5 + 5)) {
        if (this.canEnter(i)) {
          this.commit(i);
        } else {
          gap = Math.min(gap, dEnd - 0.4);
          this.registerWaiter(i);
        }
      }
    } else {
      // crossings right behind the junction
      const lane = this.lane[i];
      const rest = this.pathLen(this.path[i]) - front;
      const st = net.laneStopStart[lane];
      const end = st + net.laneStopCount[lane];
      for (let k = st; k < end; k++) {
        const d = rest + net.stopS[k];
        if (d > 40) {
          break;
        }
        if (net.stopKind[k] !== StopKind.BusStop && this.stopActive(i, k, d, v, model)) {
          gap = d;
          break;
        }
      }
    }
    return gap;
  }

  private stopActive(i: number, k: number, d: number, v: number, model: number): boolean {
    const net = this.net;
    const ref = net.stopRef[k];
    switch (net.stopKind[k]) {
      case StopKind.Signal:
        return this.signals.mustStop(ref, d, v);
      case StopKind.Crossing:
        return crossingBusy(ref, net.crossingBusy[ref], this.time) && d > (v * v) / 9 - 0.3;
      case StopKind.TramCrossing:
        return this.crossings.tram[ref] === 1 && d > (v * v) / 10 - 0.3;
      case StopKind.BusStop: {
        if (model !== Model.Bus) {
          return false;
        }
        if (this.served[i] === k) {
          return false;
        }
        // not every stop has passengers
        if (hash2(i * 7.1 + this.slot[i] * 0.37, k * 1.3) < 0.25) {
          this.served[i] = k;
          return false;
        }
        if (d < 1.2 && v < 0.4) {
          if (this.dwell[i] <= 0) {
            this.dwell[i] = 9 + hash2(i, k) * 12;
          }
          return true;
        }
        return true;
      }
      default:
        return false;
    }
  }

  private registerWaiter(i: number): void {
    if (this.v[i] > 0.5) {
      return;
    }
    const node = this.net.laneTo[this.lane[i]];
    const w = this.nodeWaiter[node];
    if (w < 0 || !this.alive[w] || w === i || this.wait[i] > this.wait[w]) {
      this.nodeWaiter[node] = i;
    }
  }

  private canEnter(i: number): boolean {
    const net = this.net;
    const lane = this.lane[i];
    const c = this.conn[i];
    const node = net.connNode[c];
    const waited = this.wait[i];
    // room behind the exit
    const tgt = net.lanePath[net.connTo[c]];
    const tl = this.pathVeh[tgt];
    if (tl.length && waited < 25) {
      const j = tl[tl.length - 1];
      const rear = this.s[j] - this.len[j] / 2;
      if (rear < this.len[i] + 2.5 && this.v[j] < 2.5) {
        return false;
      }
    }
    // one-at-a-time street: wait while oncoming traffic is on it
    const tl2 = net.connTo[c];
    if (net.laneFlags[tl2] & LaneFlag.Narrow && waited < 30) {
      const rev = net.laneReverse[tl2];
      if (rev >= 0 && this.pathVeh[net.lanePath[rev]].length) {
        return false;
      }
    }
    const cl = this.pathVeh[net.connPath[c]];
    if (cl.length && waited < 25) {
      const j = cl[cl.length - 1];
      if (this.s[j] - this.len[j] / 2 < this.len[i] * 0.5 + 1) {
        return false;
      }
    }
    if (this.laneSignalEnd[lane] || net.nodeDegree[node] <= 2 || waited > 14) {
      return true;
    }
    const edge = net.laneEdge[lane];
    if (this.nodeOcc[node] > 0 && this.nodeHolder[node] !== edge) {
      return false;
    }
    const w = this.nodeWaiter[node];
    if (w >= 0 && w !== i && this.alive[w] && this.wait[w] > 3.5 && this.wait[w] > waited && net.laneEdge[this.lane[w]] !== edge && !this.onConn[w]) {
      return false;
    }
    const rank = net.laneRank[lane];
    if (rank + 0.4 < net.nodeRank[node]) {
      for (const m of this.nodeIncoming[node]) {
        if (net.laneRank[m] <= rank + 0.4 || net.laneEdge[m] === edge) {
          continue;
        }
        const lm = this.pathVeh[net.lanePath[m]];
        if (lm.length) {
          const f = lm[0];
          const dEnd = this.pathLen(net.lanePath[m]) - this.s[f] - this.len[f] / 2;
          if (dEnd < 30 && (this.v[f] > 1.5 || this.committed[f])) {
            return false;
          }
        }
      }
    }
    return true;
  }

  private commit(i: number): void {
    const node = this.net.connNode[this.conn[i]];
    this.committed[i] = 1;
    this.nodeOcc[node]++;
    this.nodeHolder[node] = this.net.laneEdge[this.lane[i]];
    if (this.nodeWaiter[node] === i) {
      this.nodeWaiter[node] = -1;
    }
  }

  update(dt: number, hours: number, night: number, cam: { x: number; z: number; frustum: THREE.Frustum | null }): void {
    this.time += dt;
    this.lightsOn = night > 0.28;
    const net = this.net;
    const n = this.cap;
    this.frame++;
    const frame = this.frame;
    for (let i = 0; i < n; i++) {
      this.tick[i] = this.alive[i] && ((frame + i) & (this.rate[i] - 1)) === 0 ? 1 : 0;
    }
    if (dt > 0) {
      // accelerations
      for (let i = 0; i < n; i++) {
        if (!this.tick[i]) {
          if (this.alive[i]) {
            this.lag[i] += dt;
          }
          continue;
        }
        this.acc[i] = this.accel(i);
      }
      // integration and path transitions
      for (let i = 0; i < n; i++) {
        if (!this.tick[i]) {
          continue;
        }
        const h = dt + this.lag[i];
        this.lag[i] = 0;
        let v = this.v[i] + this.acc[i] * h;
        if (v < 0) {
          v = 0;
        }
        if (this.dwell[i] > 0) {
          this.dwell[i] -= h;
          v = 0;
          if (this.dwell[i] <= 0) {
            // done at this bus stop
            const lane = this.lane[i];
            const st = net.laneStopStart[lane];
            for (let k = this.stopIdx[i]; k < st + net.laneStopCount[lane]; k++) {
              if (net.stopKind[k] === StopKind.BusStop) {
                this.served[i] = k;
                break;
              }
            }
          }
        }
        this.v[i] = v;
        this.wait[i] = v < 0.3 ? this.wait[i] + h : 0;
        this.s[i] += v * h;
        this.advance(i);
      }
      // population
      let spawns = 3;
      while (this.count < this.target && spawns-- > 0) {
        if (this.rng() < 0.55) {
          this.spawnEntry();
        } else {
          this.spawnRandom(cam);
        }
      }
      if (this.count > this.target + 12) {
        const i = (this.rng() * n) | 0;
        if (this.alive[i] && !this.visible(i, cam)) {
          this.despawn(i);
        }
      } else if (this.count >= this.target - 4) {
        this.rebalance(cam);
      }
    }
    this.stats.vehicles = this.count;
  }

  /** Vehicle i near the camera or in view (used to avoid popping). */
  private visible(i: number, cam: { x: number; z: number; frustum: THREE.Frustum | null }): boolean {
    this.sample(this.path[i], this.s[i], SCRATCH, 0);
    const dx = SCRATCH[0] - cam.x;
    const dz = SCRATCH[2] - cam.z;
    if (dx * dx + dz * dz < 250 * 250) {
      return true;
    }
    if (cam.frustum) {
      SPHERE.center.set(SCRATCH[0], SCRATCH[1], SCRATCH[2]);
      SPHERE.radius = 6;
      return cam.frustum.intersectsSphere(SPHERE);
    }
    return false;
  }

  private accel(i: number): number {
    const net = this.net;
    const model = this.model[i];
    const drv = DRIVERS[model];
    const p = this.path[i];
    const v = this.v[i];
    const front = this.s[i] + this.len[i] / 2;
    const lane = this.lane[i];
    // desired speed: lane speed, curve caps here and at the start of the next path
    let vDes = Math.min(net.laneSpeed[lane] * this.factor[i], drv.vMax, this.capAt(p, front));
    const np = this.nextPath(i);
    if (np >= 0) {
      const dEnd = Math.max(0, this.pathLen(p) - front);
      const cn = this.capAt(np, 0);
      vDes = Math.min(vDes, Math.sqrt(cn * cn + 2 * 2.0 * dEnd));
    }
    vDes = Math.max(vDes, 1.2);
    const a = drv.a;
    const r = v / vDes;
    let acc = a * (1 - r * r * r * r);
    this.leader(i);
    let gap = this.tmp.gap;
    let vl = this.tmp.vl;
    let s0 = drv.s0;
    const sg = this.stopGap(i);
    if (sg < gap) {
      gap = sg;
      vl = 0;
      s0 = 0.3;
    }
    if (gap < 150) {
      const sStar = s0 + Math.max(0, v * drv.T + (v * (v - vl)) / (2 * Math.sqrt(a * drv.b)));
      const q = sStar / Math.max(gap, 0.05);
      acc -= a * q * q;
    }
    if (this.dwell[i] > 0) {
      acc = -drv.b;
    }
    return Math.max(-9, Math.min(a, acc));
  }

  /** Path transitions after moving vehicle i; despawns at exits. */
  private advance(i: number): void {
    const net = this.net;
    // never run into the leader on the same path
    const p0 = this.path[i];
    const list = this.pathVeh[p0];
    const k = list.indexOf(i);
    if (k > 0) {
      const j = list[k - 1];
      const maxS = this.s[j] - this.len[j] / 2 - this.len[i] / 2 - 0.25;
      if (this.s[i] > maxS) {
        this.s[i] = Math.max(maxS, this.s[i] - this.v[i] * 0.05);
        this.v[i] = Math.min(this.v[i], this.v[j]);
      }
    }
    for (let guard = 0; guard < 4; guard++) {
      const p = this.path[i];
      const L = this.pathLen(p);
      if (this.s[i] <= L) {
        break;
      }
      const over = this.s[i] - L;
      if (!this.onConn[i]) {
        const c = this.conn[i];
        if (c < 0) {
          this.despawn(i);
          return;
        }
        if (!this.committed[i]) {
          this.commit(i);
        }
        this.leavePath(i);
        this.prevPath[i] = p;
        this.onConn[i] = 1;
        this.enterPath(i, net.connPath[c], over);
      } else {
        const c = this.conn[i];
        this.releaseJunction(i);
        this.leavePath(i);
        this.prevPath[i] = p;
        this.onConn[i] = 0;
        const lane = net.connTo[c];
        this.lane[i] = lane;
        this.enterPath(i, net.lanePath[lane], over);
        this.stopIdx[i] = net.laneStopStart[lane];
        this.served[i] = -1;
        this.conn[i] = this.chooseConn(i, lane);
      }
    }
    // stuck for very long (gridlock at the slice edge, odd geometry): recycle
    if (this.wait[i] > 75) {
      this.stats.stuck++;
      this.despawn(i);
    }
  }

  /**
   * Poses the vehicles that ticked this frame: a cheap visibility / LOD test on the vehicle centre first, the full
   * pose (axle points, slope, roll) only for visible ones; also picks each vehicle's next update rate.
   */
  place(cam: { x: number; z: number }): void {
    const net = this.net;
    const r = this.rect;
    const P = POSE;
    const renderer = this.renderer;
    for (let i = 0; i < this.cap; i++) {
      if (!this.tick[i] || !this.alive[i]) {
        continue;
      }
      this.sample(this.path[i], this.s[i], P, 0);
      const cx = P[0];
      const cz = P[2];
      const inside = Math.min(cx - r.minX, r.maxX - cx, cz - r.minZ, r.maxZ - cz);
      const scale = Math.min(1, Math.max(0, inside / EDGE_FADE));
      const pf = net.pathFlags[this.path[i]];
      const hidden = (pf & PathFlag.Hidden) !== 0 || ((pf & PathFlag.Deck) !== 0 && !this.decksReady) || scale < 0.02;
      const visible = renderer.test(this.slot[i], cx, P[1], cz, hidden);
      const dx = cx - cam.x;
      const dz = cz - cam.z;
      const d2 = dx * dx + dz * dz;
      this.rate[i] = d2 < NEAR * NEAR || (visible && d2 < MID * MID) ? 1 : visible ? 2 : 4;
      if (!visible) {
        continue;
      }
      const half = this.wb[i] / 2;
      this.routePoint(i, this.s[i] + half, P, 0);
      this.routePoint(i, this.s[i] - half, P, 4);
      const x = (P[0] + P[4]) / 2;
      const y = (P[1] + P[5]) / 2;
      const z = (P[2] + P[6]) / 2;
      let fx = P[0] - P[4];
      let fy = P[1] - P[5];
      let fz = P[2] - P[6];
      const fl = Math.hypot(fx, fy, fz) || 1;
      fx /= fl;
      fy /= fl;
      fz /= fl;
      const roll = (P[3] + P[7]) / 2;
      // right = normalize(f x up), up = right x f, then roll about f (+ = right side down)
      let rx = -fz;
      let rz = fx;
      const rl = Math.hypot(rx, rz) || 1;
      rx /= rl;
      rz /= rl;
      let ux = -rz * fy;
      let uy = rz * fx - rx * fz;
      let uz = rx * fy;
      const cr = Math.cos(roll);
      const sr = Math.sin(roll);
      const rxx = rx * cr - ux * sr;
      const ryy = -uy * sr;
      const rzz = rz * cr - uz * sr;
      ux = ux * cr + rx * sr;
      uy = uy * cr;
      uz = uz * cr + rz * sr;
      renderer.pose(this.slot[i], x, y, z, fx, fy, fz, rxx, ryy, rzz, ux, uy, uz, scale);
      // lamp state
      let st = this.state[i] & VehicleState.Metallic;
      if (this.lightsOn) {
        st |= VehicleState.Lights;
        if (this.model[i] === Model.Bus || this.model[i] === Model.Minibus) {
          st |= VehicleState.Interior;
        }
      }
      if (this.acc[i] < -1.2 || (this.v[i] < 0.4 && this.wait[i] > 0.2)) {
        st |= VehicleState.Brake;
      }
      // indicators from ~35 m before a turn until the turn is done
      const c = this.conn[i];
      if (c >= 0 && (this.onConn[i] || net.pathLength[this.path[i]] - this.s[i] < 35)) {
        const turn = net.connTurn[c];
        if (turn > 0.5) {
          st |= VehicleState.IndicatorL;
        } else if (turn < -0.5) {
          st |= VehicleState.IndicatorR;
        }
      }
      if (st !== this.state[i]) {
        this.state[i] = st;
        this.renderer.setState(this.slot[i], this.paint.subarray(i * 3, i * 3 + 3), st);
      }
    }
  }

  /** Debug: vehicles per lane rank (on lanes and connectors) and the share of them standing still. */
  rankCensus(): Record<string, [number, number]> {
    const out: Record<string, [number, number]> = {};
    for (let i = 0; i < this.cap; i++) {
      if (!this.alive[i]) {
        continue;
      }
      const k = String(this.net.laneRank[this.lane[i]]);
      const e = (out[k] ??= [0, 0]);
      e[0]++;
      if (this.v[i] < 0.5) {
        e[1]++;
      }
    }
    return out;
  }

  /** Debug: vehicles within r m of (x, z): position, heading (deg), speed, lane, flags, waiting time. */
  probe(x: number, z: number, r: number): Record<string, number>[] {
    const out: Record<string, number>[] = [];
    for (let i = 0; i < this.cap; i++) {
      if (!this.alive[i]) {
        continue;
      }
      this.routePoint(i, this.s[i] + 1, POSE, 0);
      this.routePoint(i, this.s[i] - 1, POSE, 4);
      const px = (POSE[0] + POSE[4]) / 2;
      const pz = (POSE[2] + POSE[6]) / 2;
      if ((px - x) ** 2 + (pz - z) ** 2 > r * r) {
        continue;
      }
      const hd = (Math.atan2(POSE[0] - POSE[4], -(POSE[2] - POSE[6])) * 180) / Math.PI;
      out.push({ i, model: this.model[i], x: Math.round(px), y: +((POSE[1] + POSE[5]) / 2).toFixed(2), z: Math.round(pz), hd: Math.round((hd + 360) % 360), v: +this.v[i].toFixed(1), lane: this.lane[i], onConn: this.onConn[i], flags: this.net.laneFlags[this.lane[i]], wait: Math.round(this.wait[i]) });
    }
    return out;
  }

  dispose(): void {
    for (let i = 0; i < this.cap; i++) {
      if (this.alive[i]) {
        this.despawn(i);
      }
    }
  }
}

const SCRATCH = new Float32Array(4);
const POSE = new Float32Array(8);
const SPHERE = new THREE.Sphere();

function hash2(a: number, b: number): number {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * Pedestrians on a crossing without signals: busy windows of 4-9 s in a per-crossing cycle of 25-70 s, in about a
 * third of the cycles on marked crossings (weight 1), less on unmarked ones (İstanbul drivers rarely yield).
 */
export function crossingBusy(ref: number, weight: number, t: number): boolean {
  const period = 25 + hash2(ref, 1.7) * 45;
  const cycle = Math.floor((t + hash2(ref, 3.1) * period) / period);
  if (hash2(ref + cycle * 0.37, 5.3) > 0.36 * weight) {
    return false;
  }
  const phase = (t + hash2(ref, 3.1) * period) % period;
  return phase < 4 + hash2(ref, cycle) * 5;
}
