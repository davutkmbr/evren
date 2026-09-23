import * as THREE from 'three';
import type { GeoQuery } from './contracts';

/**
 * Simple static collision world: terrain/water from geo + primitive colliders in a spatial hash.
 * Landmarks and city chunks register colliders; flight and camera query it.
 * All colliders are static (moving objects like ships are not registered).
 */
export type Collider =
  /** Box rotated around +Y by `yaw` (radians, same as Object3D.rotation.y). `center` is the box center. */
  | { kind: 'box'; center: THREE.Vector3; halfSize: THREE.Vector3; yaw: number }
  /** Vertical cylinder standing on `base` (bottom center). */
  | { kind: 'cylinder'; base: THREE.Vector3; radius: number; height: number }
  | { kind: 'sphere'; center: THREE.Vector3; radius: number };

export interface ContactResult {
  normal: THREE.Vector3;
  depth: number;
  /** 'ground' | 'water' | collider tag */
  surface: string;
}

export interface RayHit {
  distance: number;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  surface: string;
}

interface Entry {
  id: number;
  collider: Collider;
  tag: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  top: number;
  bottom: number;
  stamp: number;
}

const CELL = 64;
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();

export class CollisionWorld {
  geo: GeoQuery | null = null;
  private entries = new Map<number, Entry>();
  private cells = new Map<number, number[]>();
  private nextId = 1;
  private stamp = 0;

  setGeo(geo: GeoQuery): void {
    this.geo = geo;
  }

  get colliderCount(): number {
    return this.entries.size;
  }

  add(collider: Collider, tag = 'structure'): number {
    const e = this.makeEntry(this.nextId++, collider, tag);
    this.entries.set(e.id, e);
    this.forCells(e, (key) => {
      let list = this.cells.get(key);
      if (!list) {
        list = [];
        this.cells.set(key, list);
      }
      list.push(e.id);
    });
    return e.id;
  }

  addMany(colliders: Collider[], tag = 'structure'): number[] {
    return colliders.map((c) => this.add(c, tag));
  }

  remove(id: number): void {
    const e = this.entries.get(id);
    if (!e) {
      return;
    }
    this.entries.delete(id);
    this.forCells(e, (key) => {
      const list = this.cells.get(key);
      if (!list) {
        return;
      }
      const i = list.indexOf(id);
      if (i >= 0) {
        list.splice(i, 1);
      }
      if (list.length === 0) {
        this.cells.delete(key);
      }
    });
  }

  removeMany(ids: number[]): void {
    ids.forEach((id) => this.remove(id));
  }

  /** Terrain height (m), sea floor negative. */
  terrainHeight(x: number, z: number): number {
    return this.geo ? this.geo.heightAt(x, z) : 0;
  }

  /** Walkable/landable ground: terrain or water surface (>= 0). */
  groundHeight(x: number, z: number): number {
    return Math.max(this.terrainHeight(x, z), 0);
  }

  /** Highest surface at x,z including collider tops (buildings, landmarks). */
  surfaceHeight(x: number, z: number): number {
    let h = this.groundHeight(x, z);
    const list = this.cells.get(this.key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (list) {
      for (const id of list) {
        const e = this.entries.get(id)!;
        if (x < e.minX || x > e.maxX || z < e.minZ || z > e.maxZ || e.top <= h) {
          continue;
        }
        if (this.containsXZ(e.collider, x, z)) {
          h = e.top;
        }
      }
    }
    return h;
  }

  /**
   * Sphere vs world. Returns the deepest contact (push-out normal and depth) or null.
   */
  resolveSphere(center: THREE.Vector3, radius: number, out?: ContactResult): ContactResult | null {
    const res = out ?? { normal: new THREE.Vector3(), depth: 0, surface: '' };
    let best = 0;

    const tH = this.terrainHeight(center.x, center.z);
    const gH = Math.max(tH, 0);
    const dGround = gH + radius - center.y;
    if (dGround > best) {
      best = dGround;
      if (tH >= 0 && this.geo) {
        this.geo.normalAt(center.x, center.z, res.normal);
      } else {
        res.normal.set(0, 1, 0);
      }
      res.depth = dGround;
      res.surface = tH >= 0 ? 'ground' : 'water';
    }

    this.stamp++;
    const r = radius;
    const c0x = Math.floor((center.x - r) / CELL);
    const c1x = Math.floor((center.x + r) / CELL);
    const c0z = Math.floor((center.z - r) / CELL);
    const c1z = Math.floor((center.z + r) / CELL);
    for (let cx = c0x; cx <= c1x; cx++) {
      for (let cz = c0z; cz <= c1z; cz++) {
        const list = this.cells.get(this.key(cx, cz));
        if (!list) {
          continue;
        }
        for (const id of list) {
          const e = this.entries.get(id)!;
          if (e.stamp === this.stamp) {
            continue;
          }
          e.stamp = this.stamp;
          if (center.x + r < e.minX || center.x - r > e.maxX || center.z + r < e.minZ || center.z - r > e.maxZ) {
            continue;
          }
          if (center.y - r > e.top || center.y + r < e.bottom) {
            continue;
          }
          const d = this.sphereDepth(e.collider, center, r, _n);
          if (d > best) {
            best = d;
            res.depth = d;
            res.normal.copy(_n);
            res.surface = e.tag;
          }
        }
      }
    }
    return best > 0 ? res : null;
  }

  /** Ray vs terrain/water/colliders. `dir` must be normalized. */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, includeWater = true): RayHit | null {
    let bestT = maxDist;
    let hit: RayHit | null = null;

    const tTerrain = this.rayTerrain(origin, dir, maxDist, includeWater);
    if (tTerrain !== null && tTerrain < bestT) {
      bestT = tTerrain;
      const p = origin.clone().addScaledVector(dir, tTerrain);
      const n = new THREE.Vector3(0, 1, 0);
      const th = this.terrainHeight(p.x, p.z);
      if (this.geo && th >= 0) {
        this.geo.normalAt(p.x, p.z, n);
      }
      hit = { distance: tTerrain, point: p, normal: n, surface: th >= 0 ? 'ground' : 'water' };
    }

    // DDA through cells
    this.stamp++;
    const steps = Math.ceil(maxDist / (CELL * 0.5)) + 1;
    const stepLen = maxDist / steps;
    let lastKey = NaN;
    for (let i = 0; i <= steps; i++) {
      const t = i * stepLen;
      if (t > bestT + CELL) {
        break;
      }
      const px = origin.x + dir.x * t;
      const pz = origin.z + dir.z * t;
      for (let ox = -1; ox <= 1; ox++) {
        for (let oz = -1; oz <= 1; oz++) {
          const key = this.key(Math.floor(px / CELL) + ox, Math.floor(pz / CELL) + oz);
          if (key === lastKey) {
            continue;
          }
          const list = this.cells.get(key);
          if (!list) {
            continue;
          }
          for (const id of list) {
            const e = this.entries.get(id)!;
            if (e.stamp === this.stamp) {
              continue;
            }
            e.stamp = this.stamp;
            const tt = this.rayCollider(e.collider, origin, dir, _n);
            if (tt !== null && tt >= 0 && tt < bestT) {
              bestT = tt;
              hit = { distance: tt, point: origin.clone().addScaledVector(dir, tt), normal: _n.clone(), surface: e.tag };
            }
          }
        }
      }
      lastKey = NaN;
    }
    return hit;
  }

  /* ---------------------------------------------------------------- */

  private rayTerrain(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, includeWater: boolean): number | null {
    const h = (x: number, z: number) => (includeWater ? Math.max(this.terrainHeight(x, z), 0) : this.terrainHeight(x, z));
    let t = 0;
    let prevT = 0;
    let prevD = origin.y - h(origin.x, origin.z);
    if (prevD <= 0) {
      return 0;
    }
    while (t < maxDist) {
      const step = Math.max(0.5, Math.min(prevD * 0.6, 50));
      t = Math.min(t + step, maxDist);
      const x = origin.x + dir.x * t;
      const y = origin.y + dir.y * t;
      const z = origin.z + dir.z * t;
      const d = y - h(x, z);
      if (d <= 0) {
        let lo = prevT;
        let hi = t;
        for (let i = 0; i < 8; i++) {
          const mid = (lo + hi) * 0.5;
          const mx = origin.x + dir.x * mid;
          const my = origin.y + dir.y * mid;
          const mz = origin.z + dir.z * mid;
          if (my - h(mx, mz) <= 0) {
            hi = mid;
          } else {
            lo = mid;
          }
        }
        return hi;
      }
      prevT = t;
      prevD = d;
      if (t >= maxDist) {
        break;
      }
    }
    return null;
  }

  private rayCollider(c: Collider, o: THREE.Vector3, d: THREE.Vector3, nOut: THREE.Vector3): number | null {
    if (c.kind === 'sphere') {
      _v.subVectors(o, c.center);
      const b = _v.dot(d);
      const cc = _v.lengthSq() - c.radius * c.radius;
      const disc = b * b - cc;
      if (disc < 0) {
        return null;
      }
      const t = -b - Math.sqrt(disc);
      if (t < 0) {
        return null;
      }
      nOut.copy(o).addScaledVector(d, t).sub(c.center).normalize();
      return t;
    }
    if (c.kind === 'box') {
      const cos = Math.cos(c.yaw);
      const sin = Math.sin(c.yaw);
      const lx = o.x - c.center.x;
      const lz = o.z - c.center.z;
      const ox = lx * cos - lz * sin;
      const oz = lx * sin + lz * cos;
      const oy = o.y - c.center.y;
      const dx = d.x * cos - d.z * sin;
      const dz = d.x * sin + d.z * cos;
      const dy = d.y;
      let tmin = -Infinity;
      let tmax = Infinity;
      let axis = -1;
      let sign = 1;
      const o3 = [ox, oy, oz];
      const d3 = [dx, dy, dz];
      const h3 = [c.halfSize.x, c.halfSize.y, c.halfSize.z];
      for (let i = 0; i < 3; i++) {
        if (Math.abs(d3[i]) < 1e-9) {
          if (o3[i] < -h3[i] || o3[i] > h3[i]) {
            return null;
          }
          continue;
        }
        let t1 = (-h3[i] - o3[i]) / d3[i];
        let t2 = (h3[i] - o3[i]) / d3[i];
        let s = -1;
        if (t1 > t2) {
          const tmp = t1;
          t1 = t2;
          t2 = tmp;
          s = 1;
        }
        if (t1 > tmin) {
          tmin = t1;
          axis = i;
          sign = s;
        }
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) {
          return null;
        }
      }
      if (tmin < 0 || axis < 0) {
        return null;
      }
      const ln = [0, 0, 0];
      ln[axis] = sign;
      nOut.set(ln[0] * cos + ln[2] * sin, ln[1], -ln[0] * sin + ln[2] * cos);
      return tmin;
    }
    // cylinder
    const ox = o.x - c.base.x;
    const oz = o.z - c.base.z;
    const a = d.x * d.x + d.z * d.z;
    let best: number | null = null;
    if (a > 1e-9) {
      const b = ox * d.x + oz * d.z;
      const cc = ox * ox + oz * oz - c.radius * c.radius;
      const disc = b * b - a * cc;
      if (disc >= 0) {
        const t = (-b - Math.sqrt(disc)) / a;
        const y = o.y + d.y * t;
        if (t >= 0 && y >= c.base.y && y <= c.base.y + c.height) {
          best = t;
          nOut.set(ox + d.x * t, 0, oz + d.z * t).normalize();
        }
      }
    }
    if (Math.abs(d.y) > 1e-9) {
      const t = (c.base.y + c.height - o.y) / d.y;
      if (t >= 0 && (best === null || t < best)) {
        const x = ox + d.x * t;
        const z = oz + d.z * t;
        if (x * x + z * z <= c.radius * c.radius) {
          best = t;
          nOut.set(0, 1, 0);
        }
      }
    }
    return best;
  }

  private sphereDepth(c: Collider, p: THREE.Vector3, r: number, nOut: THREE.Vector3): number {
    if (c.kind === 'sphere') {
      nOut.subVectors(p, c.center);
      const dist = nOut.length();
      const d = c.radius + r - dist;
      if (d <= 0) {
        return 0;
      }
      if (dist > 1e-6) {
        nOut.divideScalar(dist);
      } else {
        nOut.set(0, 1, 0);
      }
      return d;
    }
    if (c.kind === 'cylinder') {
      const dx = p.x - c.base.x;
      const dz = p.z - c.base.z;
      const top = c.base.y + c.height;
      const horiz = Math.hypot(dx, dz);
      if (p.y >= top) {
        // above: sphere vs top disc
        const ex = Math.max(0, horiz - c.radius);
        const ey = p.y - top;
        const dist = Math.hypot(ex, ey);
        const d = r - dist;
        if (d <= 0) {
          return 0;
        }
        if (ex > 0) {
          nOut.set((dx / horiz) * ex, ey, (dz / horiz) * ex).normalize();
        } else {
          nOut.set(0, 1, 0);
        }
        return d;
      }
      const side = c.radius + r - horiz;
      if (side <= 0) {
        return 0;
      }
      const up = top + r - p.y;
      if (up < side && horiz < c.radius) {
        nOut.set(0, 1, 0);
        return up;
      }
      if (horiz > 1e-6) {
        nOut.set(dx / horiz, 0, dz / horiz);
      } else {
        nOut.set(1, 0, 0);
      }
      return side;
    }
    // box (yawed)
    const cos = Math.cos(c.yaw);
    const sin = Math.sin(c.yaw);
    const lx0 = p.x - c.center.x;
    const lz0 = p.z - c.center.z;
    const lx = lx0 * cos - lz0 * sin;
    const lz = lx0 * sin + lz0 * cos;
    const ly = p.y - c.center.y;
    const hx = c.halfSize.x;
    const hy = c.halfSize.y;
    const hz = c.halfSize.z;
    const qx = Math.max(-hx, Math.min(hx, lx));
    const qy = Math.max(-hy, Math.min(hy, ly));
    const qz = Math.max(-hz, Math.min(hz, lz));
    let nx = lx - qx;
    let ny = ly - qy;
    let nz = lz - qz;
    let dist = Math.hypot(nx, ny, nz);
    let depth: number;
    if (dist > 1e-6) {
      depth = r - dist;
      if (depth <= 0) {
        return 0;
      }
      nx /= dist;
      ny /= dist;
      nz /= dist;
    } else {
      // center inside box: push along the axis of least penetration
      const px = hx - Math.abs(lx);
      const py = hy - Math.abs(ly);
      const pz = hz - Math.abs(lz);
      if (py <= px && py <= pz) {
        nx = 0;
        ny = Math.sign(ly) || 1;
        nz = 0;
        dist = py;
      } else if (px <= pz) {
        nx = Math.sign(lx) || 1;
        ny = 0;
        nz = 0;
        dist = px;
      } else {
        nx = 0;
        ny = 0;
        nz = Math.sign(lz) || 1;
        dist = pz;
      }
      depth = dist + r;
    }
    nOut.set(nx * cos + nz * sin, ny, -nx * sin + nz * cos);
    return depth;
  }

  private containsXZ(c: Collider, x: number, z: number): boolean {
    if (c.kind === 'sphere') {
      return (x - c.center.x) ** 2 + (z - c.center.z) ** 2 <= c.radius * c.radius;
    }
    if (c.kind === 'cylinder') {
      return (x - c.base.x) ** 2 + (z - c.base.z) ** 2 <= c.radius * c.radius;
    }
    const cos = Math.cos(c.yaw);
    const sin = Math.sin(c.yaw);
    const lx0 = x - c.center.x;
    const lz0 = z - c.center.z;
    const lx = lx0 * cos - lz0 * sin;
    const lz = lx0 * sin + lz0 * cos;
    return Math.abs(lx) <= c.halfSize.x && Math.abs(lz) <= c.halfSize.z;
  }

  private makeEntry(id: number, c: Collider, tag: string): Entry {
    let minX: number, maxX: number, minZ: number, maxZ: number, top: number, bottom: number;
    if (c.kind === 'sphere') {
      minX = c.center.x - c.radius;
      maxX = c.center.x + c.radius;
      minZ = c.center.z - c.radius;
      maxZ = c.center.z + c.radius;
      top = c.center.y + c.radius;
      bottom = c.center.y - c.radius;
    } else if (c.kind === 'cylinder') {
      minX = c.base.x - c.radius;
      maxX = c.base.x + c.radius;
      minZ = c.base.z - c.radius;
      maxZ = c.base.z + c.radius;
      top = c.base.y + c.height;
      bottom = c.base.y;
    } else {
      const ex = Math.abs(Math.cos(c.yaw)) * c.halfSize.x + Math.abs(Math.sin(c.yaw)) * c.halfSize.z;
      const ez = Math.abs(Math.sin(c.yaw)) * c.halfSize.x + Math.abs(Math.cos(c.yaw)) * c.halfSize.z;
      minX = c.center.x - ex;
      maxX = c.center.x + ex;
      minZ = c.center.z - ez;
      maxZ = c.center.z + ez;
      top = c.center.y + c.halfSize.y;
      bottom = c.center.y - c.halfSize.y;
    }
    return { id, collider: c, tag, minX, maxX, minZ, maxZ, top, bottom, stamp: 0 };
  }

  private forCells(e: Entry, fn: (key: number) => void): void {
    const x0 = Math.floor(e.minX / CELL);
    const x1 = Math.floor(e.maxX / CELL);
    const z0 = Math.floor(e.minZ / CELL);
    const z1 = Math.floor(e.maxZ / CELL);
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        fn(this.key(x, z));
      }
    }
  }

  private key(cx: number, cz: number): number {
    return (cx + 32768) * 65536 + (cz + 32768);
  }
}
