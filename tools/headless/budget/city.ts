/**
 * City probe: the real CityStreamer (quadtree LOD selection, per-pass index ranges, far fade classes) fed by a
 * synchronous stand-in for the worker pool that runs the real tile builder (city/worker/tile.ts) in-process. OSM
 * regions are not active headless (no street layer), so the procedural city is measured everywhere: an overestimate
 * inside the OSM slice.
 */
import * as THREE from 'three';
import { GeoWindowCutter, buildInitMessage, buildOccupancy } from '../../../src/world/city/geo-window';
import { LampPool } from '../../../src/world/city/lamps';
import { CityMaterials } from '../../../src/world/city/materials/building-material';
import { BASE_CELL, LEVEL_COUNT, LEVEL_SIZES, type CityWorkerResult, type ColliderRequestMsg, type TileRequestMsg } from '../../../src/world/city/protocol';
import { CityStreamer, type CityLodParams } from '../../../src/world/city/streamer';
import type { CityWorkerPool } from '../../../src/world/city/worker-pool';
import { buildTile } from '../../../src/world/city/worker/tile';
import { WorldData } from '../../../src/world/city/worker/world-data';
import type { QualitySettings } from '../../../src/core/quality';
import { cascadeSplits, cascadesFor, emptyView, frusta, MB, probeCamera, timeMedian, type ModuleReport, type ProbeContext } from './common';

const WORLD_HALF = 24000;
const WORKERS = 4;

/** Same as city-system.ts lodParams(). */
function lodParams(q: QualitySettings): CityLodParams {
  const draw = q.cityDrawDistance;
  const scale = q.preset === 'low' ? 0.7 : q.preset === 'medium' ? 0.85 : q.preset === 'ultra' ? 1.25 : 1;
  return {
    drawDistance: draw,
    split0: 800 * scale,
    split1: Math.min(draw * 0.4, 3000 * scale),
    densityScale: q.cityDensityScale,
    shadowDistance: q.shadowDistance * 1.1,
    classFade: [draw, draw * 0.84, draw * 0.7, draw * 0.56],
  };
}

/** Synchronous worker pool: jobs queue on submit and run in `drain()` (outside the timed streamer update). */
class SyncPool {
  private readonly jobs: { msg: TileRequestMsg; cb: (r: CityWorkerResult) => void; worker: number }[] = [];
  private readonly inflight = new Array<number>(WORKERS).fill(0);
  jobMs = 0;
  jobs0 = 0;
  constructor(
    private readonly world: WorldData,
    private readonly cache: Map<string, CityWorkerResult>,
  ) {}
  load(route: number): number {
    return this.inflight[((route % WORKERS) + WORKERS) % WORKERS];
  }
  submit(route: number, msg: Omit<TileRequestMsg, 'id'> | Omit<ColliderRequestMsg, 'id'>, cb: (r: CityWorkerResult) => void): number {
    const worker = ((route % WORKERS) + WORKERS) % WORKERS;
    this.inflight[worker]++;
    this.jobs.push({ msg: { ...(msg as Omit<TileRequestMsg, 'id'>), id: 0 }, cb, worker });
    return 0;
  }
  drain(): void {
    const list = this.jobs.splice(0);
    for (const j of list) {
      const k = `${j.msg.level}/${j.msg.ix}/${j.msg.iz}`;
      let res = this.cache.get(k);
      if (!res) {
        const t0 = performance.now();
        res = buildTile(j.msg, this.world);
        this.jobMs += performance.now() - t0;
        this.jobs0++;
        this.cache.set(k, res);
      }
      this.inflight[j.worker]--;
      j.cb(res);
    }
  }
  get pendingJobs(): number {
    return this.jobs.length;
  }
}

function levelMasks(base: Uint8Array): { n: number; data: Uint8Array }[] {
  const baseN = Math.round((WORLD_HALF * 2) / BASE_CELL);
  const masks: { n: number; data: Uint8Array }[] = [];
  for (let l = 0; l < LEVEL_COUNT; l++) {
    const span = LEVEL_SIZES[l] / BASE_CELL;
    const n = baseN / span;
    const data = new Uint8Array(n * n);
    for (let j = 0; j < baseN; j++) {
      for (let i = 0; i < baseN; i++) {
        if (base[j * baseN + i]) {
          data[Math.floor(j / span) * n + Math.floor(i / span)] = 1;
        }
      }
    }
    masks.push({ n, data });
  }
  return masks;
}

interface PassCounts {
  main: number;
  shadow: number;
  reflect: number;
}

export function probeCity(pc: ProbeContext, useTop = !process.argv.includes('--no-shadow-top')): ModuleReport {
  const geo = pc.geo;
  const world = new WorldData(buildInitMessage(geo));
  const cutter = new GeoWindowCutter(geo, []);
  const masks = levelMasks(buildOccupancy(geo, BASE_CELL));
  const occupied = (level: number, ix: number, iz: number): boolean => {
    const m = masks[level];
    return ix >= 0 && iz >= 0 && ix < m.n && iz < m.n && m.data[iz * m.n + ix] === 1;
  };
  const cache = new Map<string, CityWorkerResult>();
  const pool = new SyncPool(world, cache);
  const materials = new CityMaterials();
  const params = lodParams(pc.quality);
  const report: ModuleReport = {
    module: 'city',
    materials: 2,
    textureMB: 0,
    views: {},
    notes: [
      `draw ${params.drawDistance} m, splits ${params.split0.toFixed(0)} / ${params.split1.toFixed(0)} m, mid-tile shadows < ${params.shadowDistance.toFixed(0)} m`,
      'lamps: one additive point cloud (1 draw, NoReflection); counted in main draws',
    ],
  };
  let geometryBytes = 0;
  for (const v of pc.views) {
    const lamps = new LampPool(98304);
    const streamer = new CityStreamer(pool as unknown as CityWorkerPool, cutter, materials, lamps, occupied, params);
    const cam = probeCamera(v);
    for (let i = 0; i < 4000; i++) {
      streamer.update(1 / 60, cam, 1e9);
      pool.drain();
      if (i > 5 && streamer.pending() === 0 && pool.pendingJobs === 0) {
        break;
      }
    }
    // Let the cross-fades finish.
    for (let i = 0; i < 90; i++) {
      streamer.update(1 / 30, cam, 1e9);
    }
    const cpu = timeMedian(() => streamer.update(1 / 60, cam, 1.2), 40);
    const { main, mirror } = frusta(cam);
    const splits = cascadeSplits(pc.quality, cam.position.y);
    const r = emptyView();
    const sphere = new THREE.Sphere();
    let byLevel = [0, 0, 0];
    let fading = 0;
    let bytes = 0;
    const lvMain = [0, 0, 0];
    const lvShadow = [0, 0, 0];
    const lvRefl = [0, 0, 0];
    for (const child of streamer.group.children) {
      const mesh = child as THREE.Mesh;
      if (!mesh.visible) {
        continue;
      }
      const g = mesh.geometry;
      const c = g.userData as PassCounts;
      sphere.copy(g.boundingSphere!).applyMatrix4(mesh.matrix);
      const level = Number(mesh.name.split('-')[1].slice(1));
      byLevel[level]++;
      if ((mesh.material as THREE.Material).name.endsWith('fade')) {
        fading++;
      }
      for (const a of Object.values(g.attributes)) {
        bytes += (a as THREE.BufferAttribute).array.byteLength;
      }
      bytes += g.index!.array.byteLength;
      if (main.intersectsSphere(sphere) && c.main > 0) {
        r.main.tris += c.main / 3;
        r.main.draws++;
        lvMain[level] += c.main / 3;
      }
      if (c.reflect > 0 && mirror.intersectsSphere(sphere)) {
        r.reflection.tris += c.reflect / 3;
        r.reflection.draws++;
        lvRefl[level] += c.reflect / 3;
      }
      if (mesh.castShadow && c.shadow > 0) {
        // Highest vertex of the chunk (CityStreamer publishes it as userData.shadowTop for the cascade height cull).
        const top = typeof mesh.userData.shadowTop === 'number' ? mesh.userData.shadowTop : sphere.center.y + sphere.radius;
        const n = cascadesFor(splits, main, cam, sphere.center, sphere.radius, 150, useTop ? top : undefined);
        r.shadow.tris += (c.shadow / 3) * n;
        r.shadow.draws += n;
        lvShadow[level] += (c.shadow / 3) * n;
      }
    }
    geometryBytes = Math.max(geometryBytes, bytes);
    r.main.draws += lamps.count > 0 ? 1 : 0;
    const s = streamer.stats();
    // Lamp pool occupancy: lamps of displayed chunks, and chunks whose lamps found no room (LampPool.add -> null).
    let lampsWanted = 0;
    let lampsDropped = 0;
    for (const n of (streamer as unknown as { nodes: Map<number, { displayed: boolean; target: number; lampPos: Float32Array | null; lampRange: unknown }> }).nodes.values()) {
      if (n.displayed && n.target > 0 && n.lampPos && n.lampPos.length > 0) {
        lampsWanted += n.lampPos.length / 3;
        if (!n.lampRange) {
          lampsDropped += n.lampPos.length / 3;
        }
      }
    }
    r.cpuMs = cpu;
    r.detail = {
      chunks: s.displayed,
      L0: byLevel[0],
      L1: byLevel[1],
      L2: byLevel[2],
      fading,
      buildings: s.buildings,
      lamps: s.lamps,
      lampsWanted,
      lampsDropped,
      trisAllLoaded: Math.round(s.triangles),
      mainL0: Math.round(lvMain[0]),
      mainL1: Math.round(lvMain[1]),
      mainL2: Math.round(lvMain[2]),
      shadowL0: Math.round(lvShadow[0]),
      shadowL1: Math.round(lvShadow[1]),
      reflL0: Math.round(lvRefl[0]),
      reflL1: Math.round(lvRefl[1]),
      reflL2: Math.round(lvRefl[2]),
    };
    report.views[v.id] = r;
    streamer.clear();
    lamps.dispose();
    byLevel = [0, 0, 0];
  }
  report.geometryMB = geometryBytes / MB;
  report.notes.push(`worker generation (not frame time): ${pool.jobs0} tiles, ${(pool.jobMs / 1000).toFixed(1)} s total`);
  report.textureMB = 0;
  materials.dispose();
  return report;
}
