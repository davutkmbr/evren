/**
 * Bridge decks the traffic drives on (Galata Köprüsü, Atatürk Köprüsü): the deck frame comes from the landmark's
 * anchors exactly like world/landmarks/structures builds it (origin between the main piers, axis towards pier B);
 * lane and track offsets mirror the deck sections of structures/builders/bridges/golden-horn.ts.
 *
 * Heights: the core 'roadSurface' service when a module provides it; otherwise the rendered deck itself is sampled
 * once by casting rays down onto the structures batch at the lane positions, so vehicles sit exactly on the deck
 * that is drawn (profile per 4 m of station, linear in between).
 */
import * as THREE from 'three';
import type { GeoQuery, RoadSurfaceService, WorldBounds } from '../../../core/contracts';
import type { DeckSpec } from './protocol';

interface DeckLayout {
  halfWidth: number;
  /** Lane offsets per direction (outermost first); direction +1 uses +x (right of +axis). */
  lanes: number[];
  tracks: number[];
}

/** Mirrors GALATA_SECTION / ATATURK_SECTION (lanes = DeckTraffic lanes, tracks = rail strip centre spacing / 2). */
const DECK_LAYOUTS: Record<string, DeckLayout> = {
  'galata-koprusu': { halfWidth: 21, lanes: [9.2, 5.6], tracks: [1.7] },
  'ataturk-koprusu': { halfWidth: 12.5, lanes: [6.3, 2.7], tracks: [] },
};

export function deckSpecs(geo: GeoQuery, rect: WorldBounds): DeckSpec[] {
  const out: DeckSpec[] = [];
  for (const [id, layout] of Object.entries(DECK_LAYOUTS)) {
    const def = geo.landmark(id);
    const a = def?.anchors;
    if (!a || a.length < 4) {
      continue;
    }
    const ox = (a[0].x + a[1].x) / 2;
    const oz = (a[0].z + a[1].z) / 2;
    const len = Math.hypot(a[1].x - ox, a[1].z - oz) || 1;
    const ax = (a[1].x - ox) / len;
    const az = (a[1].z - oz) / len;
    const sOf = (p: { x: number; z: number }): number => (p.x - ox) * ax + (p.z - oz) * az;
    const s0 = Math.min(sOf(a[2]), sOf(a[3]));
    const s1 = Math.max(sOf(a[2]), sOf(a[3]));
    const inside = [a[2], a[3], a[0]].some((p) => p.x > rect.minX && p.x < rect.maxX && p.z > rect.minZ && p.z < rect.maxZ);
    if (!inside) {
      continue;
    }
    out.push({
      id,
      ox,
      oz,
      ax,
      az,
      s0,
      s1,
      halfWidth: layout.halfWidth,
      lanes: layout.lanes.flatMap((x) => [
        { x, dir: 1 as const },
        { x: -x, dir: -1 as const },
      ]),
      tracks: layout.tracks.flatMap((x) => [
        { x, dir: 1 as const },
        { x: -x, dir: -1 as const },
      ]),
    });
  }
  return out;
}

/** Deck heights sampled per station (rows) and per lateral offset (columns: the lane and track centres). */
interface Profile {
  spec: DeckSpec;
  s0: number;
  step: number;
  /** Lateral offsets of the columns, ascending. */
  offsets: number[];
  /** Heights, row-major [station][offset]. */
  h: Float32Array;
  /** Station range where the rays found the deck. */
  valid0: number;
  valid1: number;
}

const PROFILE_STEP = 4;

export class DeckHeights {
  private readonly profiles: Profile[] = [];
  private resolved = false;
  private service: RoadSurfaceService | null = null;

  constructor(private readonly specs: readonly DeckSpec[]) {
    if (specs.length === 0) {
      this.resolved = true;
    }
  }

  get ready(): boolean {
    return this.resolved;
  }

  /** Uses the core road surface service (deck heights from the structure builder). */
  useService(service: RoadSurfaceService): void {
    this.service = service;
    this.resolved = true;
  }

  /** Samples the rendered decks; returns true once every deck was found (call again later otherwise). */
  resolveFromScene(scene: THREE.Scene): boolean {
    if (this.resolved) {
      return true;
    }
    const target = scene.getObjectByName('structures.opaque');
    if (!target) {
      return false;
    }
    // parts outside the structures' draw distance are invisible and skipped by BatchedMesh.raycast: consider every
    // active instance while sampling (internal flags only, restored before the next render)
    const info = (target as unknown as { _instanceInfo?: { visible: boolean; active: boolean }[] })._instanceInfo ?? [];
    const saved = info.map((i) => i.visible);
    for (const i of info) {
      i.visible = true;
    }
    try {
      return this.sample(target);
    } finally {
      info.forEach((i, k) => {
        i.visible = saved[k];
      });
    }
  }

  private sample(target: THREE.Object3D): boolean {
    const t0 = performance.now();
    const ray = new THREE.Raycaster();
    ray.layers.enableAll();
    ray.far = 80;
    const down = new THREE.Vector3(0, -1, 0);
    const origin = new THREE.Vector3();
    const hits: THREE.Intersection[] = [];
    const profiles: Profile[] = [];
    let rays = 0;
    for (const d of this.specs) {
      const s0 = d.s0 - 30;
      const n = Math.ceil((d.s1 + 30 - s0) / PROFILE_STEP) + 1;
      const offsets = [...new Set([...d.lanes.map((l) => l.x), ...d.tracks.map((t) => t.x)])].sort((a, b) => a - b);
      if (!offsets.length) {
        offsets.push(0);
      }
      const m = offsets.length;
      const h = new Float32Array(n * m).fill(NaN);
      for (let i = 0; i < n; i++) {
        const s = s0 + i * PROFILE_STEP;
        for (let k = 0; k < m; k++) {
          const lx = offsets[k];
          origin.set(d.ox + d.ax * s - d.az * lx, 60, d.oz + d.az * s + d.ax * lx);
          ray.set(origin, down);
          hits.length = 0;
          target.raycast(ray, hits);
          rays++;
          hits.sort((p, q) => p.distance - q.distance);
          for (const hit of hits) {
            const ny = hit.face ? Math.abs(hit.face.normal.y) : 1;
            if (ny > 0.6 && hit.point.y > -2 && hit.point.y < 40) {
              h[i * m + k] = hit.point.y;
              break;
            }
          }
        }
      }
      // station range where every column found the deck
      let first = -1;
      let last = -1;
      for (let i = 0; i < n; i++) {
        let found = 0;
        for (let k = 0; k < m; k++) {
          found += Number.isNaN(h[i * m + k]) ? 0 : 1;
        }
        if (found * 2 > m) {
          if (first < 0) {
            first = i;
          }
          last = i;
        }
      }
      if (first < 0) {
        return false;
      }
      // fill holes per column (bascule joints, missed rays) by interpolating along the stations
      for (let k = 0; k < m; k++) {
        let prev = -1;
        for (let i = first; i <= last; i++) {
          if (Number.isNaN(h[i * m + k])) {
            continue;
          }
          if (prev < 0 && i > first) {
            for (let q = first; q < i; q++) {
              h[q * m + k] = h[i * m + k];
            }
          } else if (prev >= 0 && i - prev > 1) {
            for (let q = prev + 1; q < i; q++) {
              h[q * m + k] = h[prev * m + k] + ((h[i * m + k] - h[prev * m + k]) * (q - prev)) / (i - prev);
            }
          }
          prev = i;
        }
        for (let q = prev + 1; prev >= 0 && q <= last; q++) {
          h[q * m + k] = h[prev * m + k];
        }
      }
      profiles.push({ spec: d, s0, step: PROFILE_STEP, offsets, h, valid0: s0 + first * PROFILE_STEP, valid1: s0 + last * PROFILE_STEP });
    }
    this.profiles.push(...profiles);
    this.resolved = true;
    console.info(`[osm:traffic] bridge decks sampled: ${rays} rays in ${Math.round(performance.now() - t0)} ms`);
    return true;
  }

  /** Deck road height at (x, z), or null off the decks. */
  heightAt(x: number, z: number): number | null {
    if (this.service) {
      return this.service.deckHeightAt(x, z);
    }
    for (const p of this.profiles) {
      const d = p.spec;
      const dx = x - d.ox;
      const dz = z - d.oz;
      const s = dx * d.ax + dz * d.az;
      const l = -dx * d.az + dz * d.ax;
      if (Math.abs(l) > d.halfWidth || s < p.valid0 || s > p.valid1) {
        continue;
      }
      const f = (s - p.s0) / p.step;
      const n = p.h.length / p.offsets.length;
      const i = Math.min(n - 2, Math.max(0, Math.floor(f)));
      const t = f - i;
      const col = (k: number): number => {
        const m = p.offsets.length;
        return p.h[i * m + k] + (p.h[(i + 1) * m + k] - p.h[i * m + k]) * t;
      };
      const o = p.offsets;
      if (l <= o[0]) {
        return col(0);
      }
      if (l >= o[o.length - 1]) {
        return col(o.length - 1);
      }
      let k = 0;
      while (k < o.length - 2 && l > o[k + 1]) {
        k++;
      }
      const u = (l - o[k]) / (o[k + 1] - o[k]);
      return col(k) + (col(k + 1) - col(k)) * u;
    }
    return null;
  }

  /** Debug: station ranges and end heights of the resolved decks. */
  describe(): { id: string; valid: [number, number]; offsets: number[]; ends: number[][]; mid: number[] }[] {
    const row = (p: Profile, s: number): number[] => {
      const i = Math.round((s - p.s0) / p.step);
      return p.offsets.map((_, k) => +p.h[i * p.offsets.length + k].toFixed(2));
    };
    return this.profiles.map((p) => ({ id: p.spec.id, valid: [p.valid0, p.valid1], offsets: p.offsets, ends: [row(p, p.valid0), row(p, p.valid1)], mid: row(p, 0) }));
  }
}
