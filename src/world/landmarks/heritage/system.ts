import * as THREE from 'three';
import type { EngineContext, GeoQuery, System } from '../../../core/contracts';
import { UpdateOrder } from '../../../core/contracts';
import type { CollisionWorld } from '../../../core/collision';
import type { QualitySettings } from '../../../core/quality';
import type { MeshData } from './build/mesh-builder';
import { SITE_BUILDERS } from './build/registry';
import { makeJob } from './jobs';
import type { ChunkResult, ColliderDesc, SiteJob, SiteResult, WorkerResponse } from './protocol';
import { createHeritageMaterial } from './render/material';
import { buildSite } from './worker/build-site';

const LODS = 2;

interface Chunk {
  site: string;
  levels: THREE.Mesh[];
  box: THREE.Box3;
  level: number;
  triangles: number[];
}

const _v = new THREE.Vector3();

function toGeometry(d: MeshData): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(d.positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(d.normals, 3, true));
  g.setAttribute('uv', new THREE.BufferAttribute(d.uvs, 2));
  g.setAttribute('aHCol', new THREE.BufferAttribute(d.colors, 4, true));
  g.setAttribute('aHSurf', new THREE.BufferAttribute(d.surf, 4, false));
  g.setIndex(new THREE.BufferAttribute(d.index, 1));
  g.boundingBox = new THREE.Box3(new THREE.Vector3(...d.min), new THREE.Vector3(...d.max));
  g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
  return g;
}

/**
 * Heritage landmarks (palaces, fortresses, walls, stations, monuments). Geometry is generated in a module worker
 * from geo.landmarks + terrain windows, then shown as per-chunk LOD meshes sharing one procedural material.
 */
export class HeritageSystem implements System {
  readonly name = 'heritage';
  readonly order = UpdateOrder.World;
  private root = new THREE.Group();
  private material: THREE.MeshStandardMaterial | null = null;
  private chunks: Chunk[] = [];
  private colliderIds: number[] = [];
  private outstanding = 0;
  private worker: Worker | null = null;
  private detailDistance = 2500;
  private unsubQuality: (() => void) | null = null;
  private collision: CollisionWorld | null = null;
  private frame = 0;
  private disposed = false;
  /** Build timings (ms) per site, for diagnostics. */
  readonly timings: Record<string, number> = {};

  init(ctx: EngineContext): void {
    this.root.name = 'heritage';
    ctx.scene.add(this.root);
    this.material = createHeritageMaterial();
    this.applyQuality(ctx.quality.settings);
    this.unsubQuality = ctx.quality.onChange((s) => this.applyQuality(s));
    this.collision = ctx.services.get('collision');
    this.outstanding = 1;
    void ctx.services.when('geo').then((geo) => this.start(geo, ctx));
  }

  private applyQuality(s: QualitySettings): void {
    this.detailDistance = s.landmarkDetailDistance;
  }

  private start(geo: GeoQuery, ctx: EngineContext): void {
    const only = ctx.sandbox ? ctx.debug.params.get('id') : null;
    const defs = geo.landmarks.filter((l) => l.builder === 'heritage' && SITE_BUILDERS[l.id] && (!only || only === l.id));
    const jobs: SiteJob[] = defs.map((l) => makeJob(geo, l, LODS));
    this.outstanding = jobs.length;
    if (jobs.length === 0) {
      return;
    }
    const received = new Set<string>();
    const onResult = (r: SiteResult): void => {
      if (this.disposed || received.has(r.id)) {
        return;
      }
      received.add(r.id);
      this.addSite(r);
      this.outstanding = Math.max(0, this.outstanding - 1);
    };
    // A worker that fails part-way already delivered some sites: the fallback builds only the missing ones (building
    // all of them again stacked duplicate meshes and colliders on the delivered sites).
    const missing = (): SiteJob[] => jobs.filter((j) => !received.has(j.def.id));
    try {
      this.worker = new Worker(new URL('./worker/heritage.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
        const msg = ev.data;
        if (msg.type === 'site') {
          onResult(msg.result);
        } else {
          this.worker?.terminate();
          this.worker = null;
        }
      };
      this.worker.onerror = (e) => {
        console.warn('[heritage] worker failed, building on the main thread', e.message);
        this.worker?.terminate();
        this.worker = null;
        this.buildOnMainThread(missing(), onResult);
      };
      this.worker.postMessage({ type: 'build', jobs });
    } catch (err) {
      console.warn('[heritage] worker unavailable, building on the main thread', err);
      this.buildOnMainThread(missing(), onResult);
    }
  }

  /** Fallback: one site per frame-ish slice. */
  private buildOnMainThread(jobs: SiteJob[], onResult: (r: SiteResult) => void): void {
    const queue = jobs.slice();
    const step = (): void => {
      const job = queue.shift();
      if (!job || this.disposed) {
        return;
      }
      onResult(buildSite(job));
      setTimeout(step, 0);
    };
    step();
  }

  private addSite(r: SiteResult): void {
    this.timings[r.id] = Math.round(r.ms);
    if (r.error) {
      console.error(`[heritage] ${r.id}: ${r.error}`);
    }
    const mat = this.material!;
    for (const c of r.chunks) {
      this.chunks.push(this.makeChunk(r.id, c, mat));
    }
    this.addColliders(r.colliders, r.id);
  }

  private makeChunk(site: string, c: ChunkResult, mat: THREE.Material): Chunk {
    const box = new THREE.Box3();
    const levels: THREE.Mesh[] = [];
    const triangles: number[] = [];
    c.lods.forEach((d, i) => {
      const mesh = new THREE.Mesh(toGeometry(d), mat);
      mesh.name = `${site}:${c.key}:lod${i}`;
      mesh.position.set(c.originX, 0, c.originZ);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      mesh.visible = false;
      mesh.frustumCulled = true;
      this.root.add(mesh);
      levels.push(mesh);
      triangles.push(d.triangleCount);
      if (i === 0) {
        box.set(new THREE.Vector3(...d.min), new THREE.Vector3(...d.max)).translate(_v.set(c.originX, 0, c.originZ));
      }
    });
    return { site, levels, box, level: -1, triangles };
  }

  private addColliders(list: ColliderDesc[], site: string): void {
    const col = this.collision;
    if (!col) {
      return;
    }
    for (const c of list) {
      if (c.kind === 'box') {
        this.colliderIds.push(col.add({ kind: 'box', center: new THREE.Vector3(c.cx, c.cy, c.cz), halfSize: new THREE.Vector3(c.hx, c.hy, c.hz), yaw: c.yaw }, 'heritage', site));
      } else {
        this.colliderIds.push(col.add({ kind: 'cylinder', base: new THREE.Vector3(c.x, c.y, c.z), radius: c.r, height: c.h }, 'heritage', site));
      }
    }
  }

  update(_dt: number, ctx: EngineContext): void {
    this.frame++;
    const cam = ctx.camera.position;
    const d0 = this.detailDistance;
    for (const c of this.chunks) {
      const dist = c.box.distanceToPoint(cam);
      let lvl = c.level;
      if (lvl <= 0) {
        lvl = dist > d0 * 1.04 ? 1 : 0;
      } else {
        lvl = dist < d0 * 0.96 ? 0 : 1;
      }
      lvl = Math.min(lvl, c.levels.length - 1);
      if (lvl !== c.level) {
        if (c.level >= 0) {
          c.levels[c.level].visible = false;
        }
        c.levels[lvl].visible = true;
        c.level = lvl;
      }
    }
  }

  pending(): number {
    return this.outstanding;
  }

  /** Diagnostics: visible triangle count by site (current LODs, before frustum culling). */
  stats(): { chunks: number; triangles: number; bySite: Record<string, number> } {
    const bySite: Record<string, number> = {};
    let total = 0;
    for (const c of this.chunks) {
      if (c.level < 0) {
        continue;
      }
      const t = c.triangles[c.level];
      bySite[c.site] = (bySite[c.site] ?? 0) + t;
      total += t;
    }
    return { chunks: this.chunks.length, triangles: total, bySite };
  }

  dispose(): void {
    this.disposed = true;
    this.worker?.terminate();
    this.worker = null;
    this.unsubQuality?.();
    for (const c of this.chunks) {
      for (const m of c.levels) {
        m.geometry.dispose();
      }
    }
    this.chunks = [];
    if (this.collision) {
      this.collision.removeMany(this.colliderIds);
    }
    this.colliderIds = [];
    this.material?.dispose();
    this.root.removeFromParent();
  }
}
