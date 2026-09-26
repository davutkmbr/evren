import * as THREE from 'three';
import type { GeoQuery } from '../../../core/contracts';
import { RenderLayers } from '../../../core/contracts';
import { latLonToLocal } from '../../../core/geo-coords';
import { createRng } from '../../../core/math/noise';
import { GULL_SITES, PIGEON_MOSQUES } from '../data/places';
import type { Vessel } from '../vessels/agents';
import { buildBirdGeometry } from './bird-geometry';
import { createBirdMaterial } from './bird-material';

type FlockKind = 'coast' | 'ferry' | 'pigeon';

interface Flock {
  kind: FlockKind;
  /** Anchor (ground/water level) and flight band. */
  x: number;
  z: number;
  ground: number;
  minH: number;
  maxH: number;
  radius: number;
  size: number;
  vessel: Vessel | null;
  birds: number[];
  /** Pigeon flock leader state (wheeling circle). */
  lx: number;
  ly: number;
  lz: number;
  lAngle: number;
  lDir: number;
  lTimer: number;
  panic: number;
  active: boolean;
  seed: number;
}

/** Activation radius (m): flocks further from the camera are dormant (birds would be sub-pixel). */
const ACTIVE_RADIUS = 2600;
const FLEE_RADIUS = 70;

/**
 * Seagull and pigeon flocks with boids-lite steering: gulls circle over quays and trail ferries, pigeons wheel over
 * mosque courtyards; everything scatters from the dragon. Birds are pooled and only simulated near the camera.
 */
export class Flocks {
  readonly mesh: THREE.InstancedMesh;
  private readonly flocks: Flock[] = [];
  private readonly px: Float32Array;
  private readonly py: Float32Array;
  private readonly pz: Float32Array;
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly vz: Float32Array;
  private readonly param: Float32Array;
  private readonly bank: Float32Array;
  private readonly free: number[] = [];
  private readonly flap: THREE.InstancedBufferAttribute;
  /** Per-bird flap state (phase, frequency, amplitude, species tint) indexed by bird id. */
  private readonly flapData: Float32Array;
  /** GPU copy in draw order. */
  private readonly flapGpu: Float32Array;
  private readonly speciesOf: Uint8Array;
  private readonly rng = createRng(0xb1d5);
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private time = 0;
  /** Ferry flocks handed over to a moment (src/moments): dormant until given back. */
  private readonly borrowed = new Set<Flock>();

  constructor(
    readonly capacity: number,
    private readonly geo: GeoQuery,
    vessels: readonly Vessel[],
  ) {
    const geometry = buildBirdGeometry();
    this.flapData = new Float32Array(capacity * 4);
    this.flapGpu = new Float32Array(Math.max(1, capacity) * 4);
    this.flap = new THREE.InstancedBufferAttribute(this.flapGpu, 4);
    this.flap.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aFlap', this.flap);
    this.mesh = new THREE.InstancedMesh(geometry, createBirdMaterial(), Math.max(1, capacity));
    this.mesh.name = 'life-birds';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.layers.set(RenderLayers.NoReflection);
    this.px = new Float32Array(capacity);
    this.py = new Float32Array(capacity);
    this.pz = new Float32Array(capacity);
    this.vx = new Float32Array(capacity);
    this.vy = new Float32Array(capacity);
    this.vz = new Float32Array(capacity);
    this.param = new Float32Array(capacity * 4);
    this.bank = new Float32Array(capacity);
    this.speciesOf = new Uint8Array(capacity);
    for (let i = capacity - 1; i >= 0; i--) this.free.push(i);
    this.createFlocks(vessels);
  }

  private createFlocks(vessels: readonly Vessel[]): void {
    const scale = Math.max(0.35, Math.min(1.6, this.capacity / 300));
    const base = (kind: FlockKind, x: number, z: number, ground: number, size: number, minH: number, maxH: number, radius: number, vessel: Vessel | null = null): void => {
      this.flocks.push({
        kind,
        x,
        z,
        ground,
        minH,
        maxH,
        radius,
        size: Math.max(3, Math.round(size * scale)),
        vessel,
        birds: [],
        lx: x,
        ly: ground + (minH + maxH) / 2,
        lz: z,
        lAngle: this.rng() * Math.PI * 2,
        lDir: this.rng() < 0.5 ? -1 : 1,
        lTimer: 5 + this.rng() * 10,
        panic: 0,
        active: false,
        seed: this.rng(),
      });
    };
    for (const [lat, lon, w] of GULL_SITES) {
      const p = latLonToLocal(lat, lon);
      base('coast', p.x, p.z, 0, 16 * w, 6, 45, 90 + 50 * w);
    }
    for (const v of vessels) {
      if (v.model.kind === 'vapur' || v.model.kind === 'tour' || (v.model.kind === 'fishing' && this.rng() < 0.4)) {
        base('ferry', v.x, v.z, 0, v.model.kind === 'vapur' ? 12 : 7, 5, 22, 30, v);
      }
    }
    for (const [id, w] of PIGEON_MOSQUES) {
      const l = this.geo.landmark(id);
      if (!l) continue;
      base('pigeon', l.x, l.z, Math.max(l.y, 0), 30 * w, 14, 40, 45 + 20 * w);
    }
  }

  private activate(f: Flock): void {
    f.active = true;
    for (let k = 0; k < f.size && this.free.length > 0; k++) {
      const i = this.free.pop()!;
      f.birds.push(i);
      const a = this.rng() * Math.PI * 2;
      const r = f.radius * (0.3 + 0.7 * this.rng());
      const ax = f.vessel ? f.vessel.x : f.x;
      const az = f.vessel ? f.vessel.z : f.z;
      this.px[i] = ax + Math.cos(a) * r;
      this.pz[i] = az + Math.sin(a) * r;
      this.py[i] = f.ground + f.minH + (f.maxH - f.minH) * this.rng();
      const sp = f.kind === 'pigeon' ? 12 : 8;
      this.vx[i] = -Math.sin(a) * sp;
      this.vz[i] = Math.cos(a) * sp;
      this.vy[i] = 0;
      // Personal orbit params: radius factor, height factor, angular direction, wander phase.
      this.param[i * 4] = 0.5 + this.rng() * 0.7;
      this.param[i * 4 + 1] = this.rng();
      this.param[i * 4 + 2] = this.rng() < 0.5 ? -1 : 1;
      this.param[i * 4 + 3] = this.rng() * 100;
      const pigeon = f.kind === 'pigeon';
      this.speciesOf[i] = pigeon ? 1 : 0;
      this.flapData[i * 4] = this.rng() * Math.PI * 2;
      this.flapData[i * 4 + 1] = pigeon ? 5.5 + this.rng() * 1.5 : 2.4 + this.rng() * 0.6;
      this.flapData[i * 4 + 2] = pigeon ? 1 : 0.3;
      this.flapData[i * 4 + 3] = pigeon ? 0.5 + this.rng() * 0.49 : 0;
    }
  }

  private deactivate(f: Flock): void {
    f.active = false;
    for (const i of f.birds) this.free.push(i);
    f.birds.length = 0;
  }

  update(dt: number, cam: THREE.Vector3, dragon: THREE.Vector3 | null): void {
    this.time += dt;
    const t = this.time;
    for (const f of this.flocks) {
      if (f.vessel) {
        f.x = f.vessel.x;
        f.z = f.vessel.z;
      }
      const dc = Math.hypot(f.x - cam.x, f.z - cam.z);
      const want = dc < ACTIVE_RADIUS && (!f.vessel || f.vessel.state.speed > 0.5 || f.birds.length > 0) && !this.borrowed.has(f);
      if (want && !f.active) this.activate(f);
      else if (!want && f.active && dc > ACTIVE_RADIUS * 1.1) this.deactivate(f);
    }
    let n = 0;
    for (const f of this.flocks) {
      if (!f.active) continue;
      if (dt > 0) this.stepFlock(f, dt, t, dragon);
      for (const i of f.birds) {
        this.writeMatrix(n, i);
        this.flapGpu[n * 4] = this.flapData[i * 4];
        this.flapGpu[n * 4 + 1] = this.flapData[i * 4 + 1];
        this.flapGpu[n * 4 + 2] = this.flapData[i * 4 + 2];
        this.flapGpu[n * 4 + 3] = this.flapData[i * 4 + 3];
        n++;
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.clearUpdateRanges();
    this.mesh.instanceMatrix.addUpdateRange(0, n * 16);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.flap.clearUpdateRanges();
    this.flap.addUpdateRange(0, n * 4);
    this.flap.needsUpdate = true;
  }

  private stepFlock(f: Flock, dt: number, t: number, dragon: THREE.Vector3 | null): void {
    const birds = f.birds;
    const pigeon = f.kind === 'pigeon';
    // Dragon proximity drives a flock-wide panic level.
    if (dragon) {
      const dd = Math.hypot(dragon.x - f.x, dragon.z - f.z, dragon.y - (f.ground + f.maxH * 0.5));
      if (dd < f.radius + FLEE_RADIUS * 1.5) f.panic = Math.min(1, f.panic + dt * 2);
    }
    f.panic = Math.max(0, f.panic - dt * 0.12);
    if (pigeon) {
      // Leader wheels around the courtyard, reversing direction now and then.
      f.lTimer -= dt;
      if (f.lTimer < 0) {
        f.lTimer = 6 + this.rng() * 12;
        if (this.rng() < 0.5) f.lDir *= -1;
      }
      f.lAngle += f.lDir * dt * (0.35 + 0.25 * f.panic);
      const r = f.radius * (0.8 + 0.3 * Math.sin(t * 0.13 + f.seed * 10));
      f.lx = f.x + Math.cos(f.lAngle) * r;
      f.lz = f.z + Math.sin(f.lAngle) * r;
      f.ly = f.ground + f.minH + (f.maxH - f.minH) * (0.5 + 0.5 * Math.sin(t * 0.21 + f.seed * 6)) + f.panic * 25;
    }
    const vesselVx = f.vessel ? -Math.sin(f.vessel.yaw) * f.vessel.state.speed : 0;
    const vesselVz = f.vessel ? -Math.cos(f.vessel.yaw) * f.vessel.state.speed : 0;
    const followX = f.vessel ? f.vessel.x + Math.sin(f.vessel.yaw) * f.vessel.model.length * 0.55 : f.x;
    const followZ = f.vessel ? f.vessel.z + Math.cos(f.vessel.yaw) * f.vessel.model.length * 0.55 : f.z;
    const cruise = pigeon ? 13 : 9;
    const maxAcc = pigeon ? 14 : 7;
    for (let k = 0; k < birds.length; k++) {
      const i = birds[k];
      const x = this.px[i];
      const y = this.py[i];
      const z = this.pz[i];
      let ax = 0;
      let ay = 0;
      let az = 0;
      const pr = this.param[i * 4];
      const ph = this.param[i * 4 + 1];
      const dir = this.param[i * 4 + 2];
      const wander = this.param[i * 4 + 3];
      let tx: number;
      let ty: number;
      let tz: number;
      if (pigeon) {
        // Formation slot around the leader.
        const a = ph * 6.283 + t * 0.2;
        tx = f.lx + Math.cos(a) * 7 * pr;
        tz = f.lz + Math.sin(a) * 7 * pr;
        ty = f.ly + (ph - 0.5) * 6;
      } else if (f.vessel) {
        // Hover in the ferry's slipstream, weaving slowly.
        const a = t * 0.25 * dir + ph * 6.283;
        tx = followX + Math.cos(a) * f.radius * pr;
        tz = followZ + Math.sin(a) * f.radius * pr;
        ty = f.ground + f.minH + (f.maxH - f.minH) * (0.5 + 0.5 * Math.sin(t * 0.3 + wander));
      } else {
        // Soaring circles over the quay with slow drifting centres.
        const a = t * (0.09 + 0.05 * pr) * dir + ph * 6.283;
        const cx = f.x + Math.sin(t * 0.017 + wander) * f.radius * 0.5;
        const cz = f.z + Math.cos(t * 0.013 + wander * 1.3) * f.radius * 0.5;
        tx = cx + Math.cos(a) * f.radius * pr;
        tz = cz + Math.sin(a) * f.radius * pr;
        ty = f.ground + f.minH + (f.maxH - f.minH) * (0.5 + 0.5 * Math.sin(t * 0.05 + wander));
      }
      // Seek the target with arrival (desired velocity - velocity).
      let dx = tx - x;
      let dy = ty - y;
      let dz = tz - z;
      const dl = Math.hypot(dx, dy, dz) || 1;
      const desired = Math.min(cruise * (1 + f.panic * 0.6), dl * 0.6 + 4);
      dx = (dx / dl) * desired + vesselVx;
      dy = (dy / dl) * desired * 0.5;
      dz = (dz / dl) * desired + vesselVz;
      ax += (dx - this.vx[i]) * 0.9;
      ay += (dy - this.vy[i]) * 0.9;
      az += (dz - this.vz[i]) * 0.9;
      // Separation from a few flock mates.
      for (let s = 1; s <= 3; s++) {
        const j = birds[(k + s * 7) % birds.length];
        if (j === i) continue;
        const sx = x - this.px[j];
        const sy = y - this.py[j];
        const sz = z - this.pz[j];
        const d2 = sx * sx + sy * sy + sz * sz;
        const minD = pigeon ? 2.2 : 5;
        if (d2 < minD * minD && d2 > 1e-4) {
          const d = Math.sqrt(d2);
          const push = (minD - d) / minD * 12;
          ax += (sx / d) * push;
          ay += (sy / d) * push;
          az += (sz / d) * push;
        }
      }
      // Scatter from the dragon.
      let fleeing = 0;
      if (dragon) {
        const fx = x - dragon.x;
        const fy = y - dragon.y;
        const fz = z - dragon.z;
        const d = Math.hypot(fx, fy, fz);
        if (d < FLEE_RADIUS && d > 1e-3) {
          fleeing = 1 - d / FLEE_RADIUS;
          const push = fleeing * 45;
          ax += (fx / d) * push;
          ay += (fy / d) * push * 0.6 + fleeing * 12;
          az += (fz / d) * push;
        }
      }
      const acc = Math.hypot(ax, ay, az);
      const lim = maxAcc * (1 + fleeing * 3 + f.panic);
      if (acc > lim) {
        ax *= lim / acc;
        ay *= lim / acc;
        az *= lim / acc;
      }
      this.vx[i] += ax * dt;
      this.vy[i] += ay * dt;
      this.vz[i] += az * dt;
      const sp = Math.hypot(this.vx[i], this.vy[i], this.vz[i]);
      const maxSp = (pigeon ? 18 : 14) * (1 + fleeing * 0.8 + f.panic * 0.4);
      if (sp > maxSp) {
        this.vx[i] *= maxSp / sp;
        this.vy[i] *= maxSp / sp;
        this.vz[i] *= maxSp / sp;
      }
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;
      const floor = Math.max(this.geo.heightAt(this.px[i], this.pz[i]), 0) + 2;
      if (this.py[i] < floor) {
        this.py[i] = floor;
        this.vy[i] = Math.max(this.vy[i], 0);
      }
      // Bank into turns: lateral acceleration relative to the heading.
      const hx = this.vx[i];
      const hz = this.vz[i];
      const hl = Math.hypot(hx, hz) || 1;
      const lateral = (ax * -hz + az * hx) / hl;
      this.bank[i] += (THREE.MathUtils.clamp(-lateral * 0.12, -1.1, 1.1) - this.bank[i]) * Math.min(1, dt * 3);
      // Flap when climbing, accelerating or fleeing; gulls glide otherwise.
      const effort = THREE.MathUtils.clamp((ay > 0 ? ay * 0.12 : 0) + Math.max(0, ax * hx + az * hz) / (hl * maxAcc) * 0.6 + fleeing * 2 + f.panic * 0.6, 0, 1);
      const targetAmp = pigeon ? 0.75 + 0.25 * effort : effort > 0.25 ? 0.45 + 0.55 * effort : 0.0;
      this.flapData[i * 4 + 2] += (targetAmp - this.flapData[i * 4 + 2]) * Math.min(1, dt * 2.5);
    }
  }

  private writeMatrix(n: number, i: number): void {
    const vx = this.vx[i];
    const vy = this.vy[i];
    const vz = this.vz[i];
    const h = Math.hypot(vx, vz);
    const yaw = Math.atan2(-vx, -vz);
    const pitch = Math.atan2(vy, Math.max(h, 0.01)) * 0.7;
    this.e.set(pitch, yaw, this.bank[i], 'YXZ');
    this.q.setFromEuler(this.e);
    const sc = this.speciesOf[i] === 1 ? 0.5 : 1.0;
    this.s.set(sc, sc, sc);
    this.p.set(this.px[i], this.py[i], this.pz[i]);
    this.m.compose(this.p, this.q, this.s);
    this.m.toArray(this.mesh.instanceMatrix.array, n * 16);
  }

  /**
   * Hands the gulls trailing vessel `vesselId` to a moment: writes their states (x, y, z, vx, vy, vz per bird) into
   * `out` and keeps the flock dormant until returnVesselFlock. Returns the number of birds written.
   */
  borrowVesselFlock(vesselId: number, out: Float32Array): number {
    const f = this.flocks.find((x) => x.vessel?.id === vesselId);
    if (!f) return 0;
    let n = 0;
    for (const i of f.birds) {
      if ((n + 1) * 6 > out.length) break;
      out.set([this.px[i], this.py[i], this.pz[i], this.vx[i], this.vy[i], this.vz[i]], n * 6);
      n++;
    }
    if (f.active) this.deactivate(f);
    this.borrowed.add(f);
    return n;
  }

  /** Gives a borrowed ferry flock back, continuing from `count` bird states (flat as in borrowVesselFlock). */
  returnVesselFlock(vesselId: number, states: Float32Array, count: number): void {
    const f = this.flocks.find((x) => x.vessel?.id === vesselId);
    if (!f || !this.borrowed.delete(f)) return;
    if (count <= 0) return;
    this.activate(f);
    const n = Math.min(count, f.birds.length);
    while (f.birds.length > n) this.free.push(f.birds.pop()!);
    for (let k = 0; k < n; k++) {
      const i = f.birds[k];
      this.px[i] = states[k * 6];
      this.py[i] = states[k * 6 + 1];
      this.pz[i] = states[k * 6 + 2];
      this.vx[i] = states[k * 6 + 3];
      this.vy[i] = states[k * 6 + 4];
      this.vz[i] = states[k * 6 + 5];
    }
  }

  /**
   * Closest active bird to (x, y, z) within `maxDistance` m (the dragon's attention, phase 06): writes its position
   * into `out` and returns the distance, or -1 when none. Dormant and borrowed flocks are skipped.
   */
  nearestBird(x: number, y: number, z: number, maxDistance: number, out: THREE.Vector3): number {
    let best = maxDistance * maxDistance;
    let found = -1;
    for (const f of this.flocks) {
      if (!f.active || this.borrowed.has(f)) continue;
      const ax = f.vessel ? f.vessel.x : f.x;
      const az = f.vessel ? f.vessel.z : f.z;
      const reach = maxDistance + f.radius * 2;
      if ((ax - x) * (ax - x) + (az - z) * (az - z) > reach * reach) continue;
      for (const i of f.birds) {
        const dx = this.px[i] - x;
        const dy = this.py[i] - y;
        const dz = this.pz[i] - z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < best) {
          best = d2;
          found = i;
        }
      }
    }
    if (found < 0) return -1;
    out.set(this.px[found], this.py[found], this.pz[found]);
    return Math.sqrt(best);
  }

  /** Debug: world position and velocity of the n-th drawn bird. */
  debugBird(n: number, pos: THREE.Vector3, vel: THREE.Vector3): boolean {
    let k = 0;
    for (const f of this.flocks) {
      if (!f.active) continue;
      for (const i of f.birds) {
        if (k++ === n) {
          pos.set(this.px[i], this.py[i], this.pz[i]);
          vel.set(this.vx[i], this.vy[i], this.vz[i]);
          return true;
        }
      }
    }
    return false;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
