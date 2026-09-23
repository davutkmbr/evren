import * as THREE from 'three';
import type { GeoQuery } from '../../core/contracts';
import type { CollisionWorld } from '../../core/collision';
import type { ParticlePool, SpawnSpec } from '../particles/particle-pool';

/** Per-frame data shared by all emitters. */
export interface EmitContext {
  /** Fx time (s), rebased elapsed simulation time. */
  now: number;
  dt: number;
  /** Filtered ambient wind (m/s) the shaders relax particles towards. */
  wind: THREE.Vector3;
  /** Emission multiplier derived from quality.particleBudget. */
  budgetScale: number;
  vol: ParticlePool;
  sharp: ParticlePool;
  geo: GeoQuery | undefined;
  collision: CollisionWorld | undefined;
  rng: () => number;
}

export function range(rng: () => number, lo: number, hi: number): number {
  return lo + (hi - lo) * rng();
}

/** Emission throttle as a pool fills up (prevents overwriting live particles). */
export function poolThrottle(pool: ParticlePool): number {
  const load = pool.load;
  return load < 0.8 ? 1 : Math.max(0, 1 - (load - 0.8) / 0.18);
}

/** Accumulates fractional emission: returns how many particles to spawn this frame. */
export class EmissionAccumulator {
  private acc = 0;

  take(rate: number, dt: number): number {
    this.acc += Math.max(rate, 0) * dt;
    const n = Math.floor(this.acc);
    this.acc -= n;
    return n;
  }

  reset(): void {
    this.acc = 0;
  }
}

const _u = new THREE.Vector3();
const _v = new THREE.Vector3();

/** Uniform random direction inside a cone of half-angle `angle` around unit `dir`. */
export function coneDirection(dir: THREE.Vector3, angle: number, rng: () => number, out: THREE.Vector3): THREE.Vector3 {
  const ref = Math.abs(dir.y) < 0.95 ? THREE.Object3D.DEFAULT_UP : _v.set(1, 0, 0);
  _u.crossVectors(dir, ref).normalize();
  _v.crossVectors(dir, _u);
  const cosA = 1 - rng() * (1 - Math.cos(angle));
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const phi = rng() * Math.PI * 2;
  const cu = Math.cos(phi) * sinA;
  const cv = Math.sin(phi) * sinA;
  return out.set(
    dir.x * cosA + _u.x * cu + _v.x * cv,
    dir.y * cosA + _u.y * cu + _v.y * cv,
    dir.z * cosA + _u.z * cu + _v.z * cv,
  );
}

/** Terrain or water height (water surface = 0), ignoring buildings. */
export function groundHeightAt(ctx: EmitContext, x: number, z: number): number {
  if (ctx.collision) {
    return ctx.collision.groundHeight(x, z);
  }
  return ctx.geo ? Math.max(ctx.geo.heightAt(x, z), 0) : 0;
}

/** Highest surface at x,z: roofs and landmark colliders included, otherwise terrain/water. */
export function surfaceHeightAt(ctx: EmitContext, x: number, z: number): number {
  if (ctx.collision) {
    return ctx.collision.surfaceHeight(x, z);
  }
  return groundHeightAt(ctx, x, z);
}

export function isWaterAt(ctx: EmitContext, x: number, z: number): boolean {
  if (!ctx.geo) {
    return true;
  }
  return ctx.geo.heightAt(x, z) <= 0.05 || ctx.geo.isWater(x, z);
}

/** Sets the spawn collision plane to the horizontal surface at height h. */
export function setGroundPlane(spec: SpawnSpec, h: number): void {
  spec.planeNx = 0;
  spec.planeNz = 0;
  spec.planeD = h;
}

/** Sets the spawn collision plane from a hit (normal must point away from the surface). */
export function setPlane(spec: SpawnSpec, n: THREE.Vector3, point: THREE.Vector3): void {
  let nx = n.x;
  let ny = n.y;
  let nz = n.z;
  if (ny < 0) {
    // Downward-facing surfaces are stored as vertical walls (ny is reconstructed as >= 0).
    ny = 0;
    const l = Math.hypot(nx, nz) || 1;
    nx /= l;
    nz /= l;
  }
  spec.planeNx = nx;
  spec.planeNz = nz;
  spec.planeD = nx * point.x + ny * point.y + nz * point.z;
}
