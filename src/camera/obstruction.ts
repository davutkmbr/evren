import * as THREE from 'three';
import type { CollisionWorld, ContactResult } from '../core/collision';
import type { EngineContext } from '../core/contracts';

/** Minimum clearance above the water surface / terrain for any camera (m). */
export const WATER_CLEARANCE = 1.4;

const _dir = new THREE.Vector3();

/**
 * Camera-side wrapper around the shared collision world: boom casts, line-of-sight tests and a
 * push-out that keeps the eye out of terrain, water and static colliders.
 */
export class CameraCollision {
  private world: CollisionWorld | null = null;
  private readonly contact: ContactResult = { normal: new THREE.Vector3(), depth: 0, surface: '' };

  bind(ctx: EngineContext): void {
    this.world = ctx.services.tryGet('collision') ?? null;
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
    const hit = this.world.raycast(origin, dir, maxDist + margin, true);
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
    const hit = this.world.raycast(origin, dir, maxDist, true);
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
    const hit = this.world.raycast(from, _dir, reach, true);
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
    const hit = this.world.raycast(from, _dir, len, true);
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
        const c = world.resolveSphere(point, radius, this.contact);
        if (!c) {
          break;
        }
        const d = c.depth + 0.01;
        point.addScaledVector(c.normal, d);
        pushed += d;
      }
    }
    const minY = this.groundHeight(point.x, point.z) + Math.max(radius, WATER_CLEARANCE);
    if (point.y < minY) {
      pushed += minY - point.y;
      point.y = minY;
    }
    return pushed;
  }

  /** True if a sphere at `point` would intersect terrain, water or a collider. */
  blocked(point: THREE.Vector3, radius: number): boolean {
    if (point.y < this.groundHeight(point.x, point.z) + Math.max(radius, WATER_CLEARANCE)) {
      return true;
    }
    return this.world ? this.world.resolveSphere(point, radius, this.contact) !== null : false;
  }
}
