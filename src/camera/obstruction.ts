import * as THREE from 'three';
import type { CollisionWorld, ContactResult } from '../core/collision';
import type { EngineContext, WaterService } from '../core/contracts';

/** Minimum clearance above the water surface / terrain for any camera (m). */
export const WATER_CLEARANCE = 1.4;
/** Under water (phase 21 stage 4): minimum clearance above the seabed (m). */
export const SEABED_CLEARANCE = 1.5;
/**
 * After the dragon leaves the water, the depth the camera may still be under the surface shrinks exponentially at
 * this rate (1/s) plus a linear SUBMERGE_RISE (m/s), from wherever the camera was: it follows the dragon out without a
 * jump and never lingers under the surface.
 */
const SUBMERGE_DECAY = 3;
const SUBMERGE_RISE = 1.2;
/** "Unlimited" allowance while the dragon is under water: only the seabed and colliders bound the camera. */
const SUBMERGE_FREE = 1e4;

const _dir = new THREE.Vector3();

/**
 * Camera-side wrapper around the shared collision world: boom casts, line-of-sight tests and a
 * push-out that keeps the eye out of terrain, water and static colliders.
 */
export class CameraCollision {
  private world: CollisionWorld | null = null;
  private water: WaterService | null = null;
  private readonly contact: ContactResult = { normal: new THREE.Vector3(), depth: 0, surface: '' };
  /**
   * How far below the water floor (surface + clearance) the camera may go (m): unlimited while the dragon is under
   * water, then shrinking to 0 once it has left (updateSubmerge). 0 = the camera stays above the waves.
   */
  submerge = 0;

  bind(ctx: EngineContext): void {
    this.world = ctx.services.tryGet('collision') ?? null;
    this.water = ctx.services.tryGet('water') ?? null;
  }

  /** Headless checks: bind the collision world and the water service directly. */
  bindDirect(world: CollisionWorld | null, water: WaterService | null): void {
    this.world = world;
    this.water = water;
  }

  /**
   * Once per frame before the controllers: `dragonUnder` = the dragon is in its under-water mode, `eye` = last frame's
   * camera position. While under, the camera may follow it down to the seabed; afterwards the allowance starts at the
   * eye's own depth (no jump) and shrinks, so every floor rises smoothly back above the waves.
   */
  updateSubmerge(dragonUnder: boolean, eye: THREE.Vector3, dt: number): void {
    if (dragonUnder) {
      this.submerge = SUBMERGE_FREE;
      return;
    }
    if (this.submerge <= 0) {
      return;
    }
    const t = this.terrainHeight(eye.x, eye.z);
    // Depth of the eye below the above-water floor: the allowance never exceeds it (a camera that got out early
    // does not get pulled back in).
    const depth = t < 0 ? Math.max(0, this.waterSurface(eye.x, eye.z) + WATER_CLEARANCE - eye.y) : 0;
    let a = Math.min(this.submerge, depth);
    a = a * Math.exp(-SUBMERGE_DECAY * dt) - SUBMERGE_RISE * dt;
    this.submerge = Number.isFinite(a) && a > 0 ? a : 0;
  }

  /** Terrain height (m), negative on the seabed. */
  terrainHeight(x: number, z: number): number {
    return this.world ? this.world.terrainHeight(x, z) : 0;
  }

  /** Water surface for the camera: the rendered waves' crest height where they rise above y = 0 (never below 0). */
  waterSurface(x: number, z: number): number {
    const h = this.water ? this.water.heightAt(x, z) : 0;
    return Number.isFinite(h) && h > 0 ? h : 0;
  }

  /**
   * Lowest height the camera may take at x,z with `clearance` (m) above terrain / the water surface: the terrain on
   * land; over water the waves (never cutting through a crest), or down to the seabed while submerging is allowed.
   */
  floorHeight(x: number, z: number, clearance: number): number {
    const t = this.terrainHeight(x, z);
    if (t >= 0) {
      return t + clearance;
    }
    const above = this.waterSurface(x, z) + clearance;
    if (this.submerge <= 0) {
      return above;
    }
    return Math.max(t + Math.max(clearance, SEABED_CLEARANCE), above - this.submerge);
  }

  get ready(): boolean {
    return this.world !== null;
  }

  /** Terrain or water surface height (>= 0). */
  groundHeight(x: number, z: number): number {
    return this.world ? this.world.groundHeight(x, z) : 0;
  }

  /** Highest surface including building/landmark collider tops. */
  surfaceHeight(x: number, z: number): number {
    return this.world ? this.world.surfaceHeight(x, z) : 0;
  }

  /**
   * Largest distance along `dir` (normalized) from `origin` that stays `margin` meters clear of the first hit,
   * or `maxDist` when unobstructed. Hits closer than `ignoreBelow` are treated as self-intersection and skipped.
   */
  castBoom(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, margin: number, ignoreBelow = 0.4): number {
    if (!this.world || maxDist <= 0) {
      return maxDist;
    }
    const hit = this.world.raycast(origin, dir, maxDist + margin, this.submerge <= 0);
    if (!hit || hit.distance < ignoreBelow) {
      return maxDist;
    }
    return Math.max(0, Math.min(maxDist, hit.distance - margin));
  }

  /** Distance to the first hit along `dir` (normalized) within `maxDist`, Infinity when clear or closer than `ignoreBelow`. */
  hitDistance(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, ignoreBelow = 0.4): number {
    if (!this.world || maxDist <= 0) {
      return Infinity;
    }
    const hit = this.world.raycast(origin, dir, maxDist, this.submerge <= 0);
    return hit && hit.distance >= ignoreBelow ? hit.distance : Infinity;
  }

  /** True when nothing blocks the segment from `from` to `to` (ignoring the last `slack` meters near `to`). */
  lineOfSight(from: THREE.Vector3, to: THREE.Vector3, slack = 2): boolean {
    if (!this.world) {
      return true;
    }
    _dir.subVectors(to, from);
    const len = _dir.length();
    if (len < 1e-3) {
      return true;
    }
    _dir.divideScalar(len);
    const reach = len - slack;
    if (reach <= 0) {
      return true;
    }
    const hit = this.world.raycast(from, _dir, reach, this.submerge <= 0);
    return !hit;
  }

  /** Distance to the first obstruction along the segment (Infinity if clear). */
  firstHit(from: THREE.Vector3, to: THREE.Vector3): number {
    if (!this.world) {
      return Infinity;
    }
    _dir.subVectors(to, from);
    const len = _dir.length();
    if (len < 1e-3) {
      return Infinity;
    }
    _dir.divideScalar(len);
    const hit = this.world.raycast(from, _dir, len, this.submerge <= 0);
    return hit ? hit.distance : Infinity;
  }

  /**
   * Pushes `point` out of terrain, water and colliders so that a sphere of `radius` fits.
   * Returns the total push distance (0 when the point was already clear).
   */
  resolve(point: THREE.Vector3, radius: number): number {
    let pushed = 0;
    const world = this.world;
    if (world) {
      for (let i = 0; i < 3; i++) {
        // While submerging, the water plane is not a floor (the floor clamp below handles terrain and seabed).
        const c = world.resolveSphere(point, radius, this.contact, this.submerge <= 0);
        if (!c) {
          break;
        }
        const d = c.depth + 0.01;
        point.addScaledVector(c.normal, d);
        pushed += d;
      }
    }
    const minY = this.floorHeight(point.x, point.z, Math.max(radius, WATER_CLEARANCE));
    if (point.y < minY) {
      pushed += minY - point.y;
      point.y = minY;
    }
    return pushed;
  }

  /** True if a sphere at `point` would intersect terrain, water or a collider. */
  blocked(point: THREE.Vector3, radius: number): boolean {
    if (point.y < this.floorHeight(point.x, point.z, Math.max(radius, WATER_CLEARANCE))) {
      return true;
    }
    return this.world ? this.world.resolveSphere(point, radius, this.contact, this.submerge <= 0) !== null : false;
  }
}
