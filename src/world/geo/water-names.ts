import { latLonToLocal } from '../../core/geo-coords';
import { INLAND_WATER } from './data/coastline';
import { BOSPHORUS_AXIS, GOLDEN_HORN_AXIS } from './data/waterways';
import { projectRing } from './prepare';
import type { FlatRing } from './types';

/**
 * Entrance lines of the strait and the Golden Horn (lat, lon of both ends), with a point on the inner side.
 * South: Ahırkapı lighthouse – İnciburnu (Haydarpaşa breakwater). North: Rumeli Feneri – Anadolu Feneri.
 * Golden Horn mouth: Sarayburnu – Tophane.
 */
const SOUTH_ENTRANCE = { a: [41.0053, 28.9836], b: [41.0087, 29.0145], inside: [41.03, 29.005] } as const;
const NORTH_ENTRANCE = { a: [41.2366, 29.1115], b: [41.2176, 29.152], inside: [41.18, 29.09] } as const;
const GOLDEN_HORN_MOUTH = { a: [41.0161, 28.9853], b: [41.0268, 28.9838], inside: [41.03, 28.955] } as const;

/** Largest distance (m) from the centre line still counted as the Golden Horn / the Bosphorus. */
const GOLDEN_HORN_REACH = 800;
const BOSPHORUS_REACH = 2600;
/** Open sea between the entrances but away from the strait: north of this latitude it is the Black Sea coast. */
const BLACK_SEA_LAT = 41.12;

interface HalfPlane {
  ax: number;
  az: number;
  nx: number;
  nz: number;
}

interface Lake {
  name: string;
  ring: FlatRing;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

function halfPlane(line: { a: readonly number[]; b: readonly number[]; inside: readonly number[] }): HalfPlane {
  const a = latLonToLocal(line.a[0], line.a[1]);
  const b = latLonToLocal(line.b[0], line.b[1]);
  const p = latLonToLocal(line.inside[0], line.inside[1]);
  let nx = -(b.z - a.z);
  let nz = b.x - a.x;
  if ((p.x - a.x) * nx + (p.z - a.z) * nz < 0) {
    nx = -nx;
    nz = -nz;
  }
  return { ax: a.x, az: a.z, nx, nz };
}

function inside(h: HalfPlane, x: number, z: number): boolean {
  return (x - h.ax) * h.nx + (z - h.az) * h.nz >= 0;
}

/** Distance (m) from a point to a polyline of flat x, z pairs. */
function polylineDistance(line: FlatRing, x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i + 3 < line.length; i += 2) {
    const ax = line[i];
    const az = line[i + 1];
    const dx = line[i + 2] - ax;
    const dz = line[i + 3] - az;
    const len2 = dx * dx + dz * dz;
    const t = len2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / len2)) : 0;
    const d = Math.hypot(x - ax - t * dx, z - az - t * dz);
    if (d < best) {
      best = d;
    }
  }
  return best;
}

function inRing(ring: FlatRing, x: number, z: number): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const xi = ring[i];
    const zi = ring[i + 1];
    const xj = ring[j];
    const zj = ring[j + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) {
      hit = !hit;
    }
  }
  return hit;
}

/**
 * Names the water body at a point from the geo data: lakes and reservoirs from their rings, the Golden Horn and the
 * Bosphorus from their centre lines, the Black Sea and the Sea of Marmara beyond the strait's entrance lines.
 * Built lazily on the first call; each query is a handful of segment distances.
 */
export class WaterNames {
  private lakes: Lake[] | null = null;
  private bosphorus: FlatRing = new Float64Array(0);
  private goldenHorn: FlatRing = new Float64Array(0);
  private south!: HalfPlane;
  private north!: HalfPlane;
  private hornMouth!: HalfPlane;
  private blackSeaZ = 0;

  /** Name of the water at x, z; the caller has already checked that the point is water. */
  nameAt(x: number, z: number): string {
    const lakes = this.lakes ?? this.build();
    for (const lake of lakes) {
      if (x >= lake.minX && x <= lake.maxX && z >= lake.minZ && z <= lake.maxZ && inRing(lake.ring, x, z)) {
        return lake.name;
      }
    }
    if (inside(this.hornMouth, x, z) && polylineDistance(this.goldenHorn, x, z) < GOLDEN_HORN_REACH) {
      return 'Haliç';
    }
    if (!inside(this.north, x, z)) {
      return 'Karadeniz';
    }
    if (!inside(this.south, x, z)) {
      return 'Marmara Denizi';
    }
    if (polylineDistance(this.bosphorus, x, z) < BOSPHORUS_REACH) {
      return 'İstanbul Boğazı';
    }
    return z < this.blackSeaZ ? 'Karadeniz' : 'Marmara Denizi';
  }

  private build(): Lake[] {
    this.bosphorus = projectRing(BOSPHORUS_AXIS);
    this.goldenHorn = projectRing(GOLDEN_HORN_AXIS);
    this.south = halfPlane(SOUTH_ENTRANCE);
    this.north = halfPlane(NORTH_ENTRANCE);
    this.hornMouth = halfPlane(GOLDEN_HORN_MOUTH);
    this.blackSeaZ = latLonToLocal(BLACK_SEA_LAT, 29).z;
    const lakes: Lake[] = [];
    for (const water of INLAND_WATER) {
      const ring = projectRing(water.ll);
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (let i = 0; i < ring.length; i += 2) {
        minX = Math.min(minX, ring[i]);
        maxX = Math.max(maxX, ring[i]);
        minZ = Math.min(minZ, ring[i + 1]);
        maxZ = Math.max(maxZ, ring[i + 1]);
      }
      lakes.push({ name: water.name, ring, minX, maxX, minZ, maxZ });
    }
    this.lakes = lakes;
    return lakes;
  }
}
