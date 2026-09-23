import * as THREE from 'three';
import type { GeoQuery, RoadDef } from '../../../core/contracts';
import { createRng } from '../../../core/math/noise';
import { BRIDGE_DECKS } from '../data/places';

export const ROAD_TEX_WIDTH = 1024;
/** Resampling step along every road (m). */
export const ROAD_STEP = 12;

export interface RoadTrack {
  def: RoadDef;
  start: number;
  count: number;
  length: number;
  /** Bounding circle of the road (for near-camera car selection). */
  cx: number;
  cz: number;
  radius: number;
}

export interface CarRecord {
  road: number;
  /** Lateral offset (m, to the right of travel). */
  offset: number;
  dir: number;
  speed: number;
  phase: number;
  /** Paint / type seed [0, 1). */
  style: number;
  /** Vehicle type: 0 car, 1 taxi, 2 bus, 3 truck. */
  type: number;
  /** Visibility threshold vs. the time-of-day traffic volume. */
  hide: number;
}

interface LaneSpec {
  lanes: number;
  median: number;
  density: number;
  speed: number;
}

function laneSpec(r: RoadDef): LaneSpec {
  switch (r.kind) {
    case 'highway':
      return { lanes: 3, median: 1.8, density: 24, speed: 19 };
    case 'bridge':
      return { lanes: r.width > 50 ? 4 : 3, median: 1.2, density: 28, speed: 15 };
    case 'avenue':
      return { lanes: r.width >= 30 ? 3 : 2, median: 1.0, density: 17, speed: 11 };
    case 'coastal':
      return { lanes: r.width >= 20 ? 2 : 1, median: 0.4, density: 15, speed: 12 };
    default:
      return { lanes: 1, median: 0.2, density: 9, speed: 8 };
  }
}

/** Pedestrian-only streets (no cars). */
const CAR_FREE = new Set(['istiklal-caddesi']);

/**
 * Resamples geo.roads into a float texture of road centreline points (x, y, z) at ROAD_STEP spacing and lays out
 * right-hand traffic lanes with car phases. Bridge spans follow their deck heights.
 */
export class RoadNetwork {
  readonly tracks: RoadTrack[] = [];
  readonly cars: CarRecord[] = [];
  readonly texture: THREE.DataTexture;
  readonly samples: Float32Array;

  constructor(geo: GeoQuery, densityScale: number) {
    const pts: number[] = [];
    for (const def of geo.roads) {
      if (CAR_FREE.has(def.id) || def.points.length < 2) continue;
      const cum: number[] = [0];
      for (let i = 1; i < def.points.length; i++) {
        const a = def.points[i - 1];
        const b = def.points[i];
        cum.push(cum[i - 1] + Math.hypot(b.x - a.x, b.z - a.z));
      }
      const length = cum[cum.length - 1];
      if (length < ROAD_STEP * 3) continue;
      const count = Math.floor(length / ROAD_STEP) + 1;
      const start = pts.length / 4;
      const deck = BRIDGE_DECKS[def.id];
      const h0 = Math.max(geo.heightAt(def.points[0].x, def.points[0].z), 0);
      const h1 = Math.max(geo.heightAt(def.points[def.points.length - 1].x, def.points[def.points.length - 1].z), 0);
      let seg = 0;
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (let k = 0; k < count; k++) {
        const s = Math.min(k * ROAD_STEP, length);
        while (seg < cum.length - 2 && cum[seg + 1] < s) seg++;
        const a = def.points[seg];
        const b = def.points[seg + 1];
        const t = (s - cum[seg]) / Math.max(cum[seg + 1] - cum[seg], 1e-6);
        const x = a.x + (b.x - a.x) * t;
        const z = a.z + (b.z - a.z) * t;
        let y: number;
        if (deck !== undefined) {
          const u = s / length;
          const ramp = Math.min(0.22, 260 / length);
          const rise = THREE.MathUtils.smoothstep(u, 0, ramp) * (1 - THREE.MathUtils.smoothstep(u, 1 - ramp, 1));
          const base = THREE.MathUtils.lerp(h0, h1, u);
          const camber = deck > 30 ? Math.sin(u * Math.PI) * 2.5 : 0;
          y = Math.max(THREE.MathUtils.lerp(base, deck, rise) + camber * rise, base);
        } else {
          y = Math.max(geo.heightAt(x, z), 0.4);
        }
        pts.push(x, y + 0.05, z, 0);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minZ = Math.min(minZ, z);
        maxZ = Math.max(maxZ, z);
      }
      const cx = (minX + maxX) / 2;
      const cz = (minZ + maxZ) / 2;
      this.tracks.push({ def, start, count, length: (count - 1) * ROAD_STEP, cx, cz, radius: Math.hypot(maxX - minX, maxZ - minZ) / 2 });
    }
    const texels = pts.length / 4;
    const rows = Math.max(1, Math.ceil(texels / ROAD_TEX_WIDTH));
    this.samples = new Float32Array(ROAD_TEX_WIDTH * rows * 4);
    this.samples.set(pts);
    this.texture = new THREE.DataTexture(this.samples, ROAD_TEX_WIDTH, rows, THREE.RGBAFormat, THREE.FloatType);
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;
    this.layoutCars(densityScale);
  }

  private layoutCars(densityScale: number): void {
    const rng = createRng(0xca75);
    this.tracks.forEach((tr, road) => {
      const spec = laneSpec(tr.def);
      const halfW = tr.def.width / 2;
      const laneW = Math.min(3.5, (halfW - spec.median) / spec.lanes);
      for (const dir of [1, -1]) {
        for (let lane = 0; lane < spec.lanes; lane++) {
          const offset = spec.median + (lane + 0.5) * laneW;
          // Inner lanes are faster; each lane keeps one speed so cars never overlap.
          const speed = spec.speed * (1.12 - 0.12 * lane) * (0.85 + rng() * 0.3);
          const perKm = spec.density * densityScale * (lane === spec.lanes - 1 ? 1.15 : 1);
          const n = Math.max(1, Math.round((tr.length / 1000) * perKm));
          const spacing = tr.length / n;
          for (let k = 0; k < n; k++) {
            const r = rng();
            const type = spec.lanes > 1 && lane === spec.lanes - 1 && r < 0.14 ? (r < 0.06 ? 2 : 3) : rng() < 0.13 ? 1 : 0;
            this.cars.push({
              road,
              offset,
              dir,
              speed,
              phase: (k + (rng() - 0.5) * 0.5) * spacing,
              style: rng(),
              type,
              hide: rng(),
            });
          }
        }
      }
    });
  }

  dispose(): void {
    this.texture.dispose();
  }
}
