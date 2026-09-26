import * as THREE from 'three';
import type { Collider } from '../../../../core/collision';
import type { EngineContext, GeoQuery, LandmarkDef, System } from '../../../../core/contracts';
import { RenderLayers, UpdateOrder } from '../../../../core/contracts';
import type { QualitySettings } from '../../../../core/quality';
import type { BuiltModel, GeomData, LocalCollider, LodLevel } from '../gen/types';
import { toBufferGeometry } from '../render/geometry';
import { LodBatchedMesh } from '../render/lod-batch';
import { createMosqueMaterial, type MosqueMaterialUniforms } from '../render/material';
import { MosqueWorkerPool } from '../worker/client';
import { chooseVariant, placementFromHeading, placementMatrix, worldColliders, type Placement } from './placement';

export interface MosqueSystemOptions {
  /** Sandbox: neighbourhood site i uses prototype i % count instead of the site-based choice. */
  cycleVariants?: boolean;
  /** Sandbox: force one LOD level for every mosque (landmark LOD0 is streamed as usual). */
  forceLod?: LodLevel;
}

interface LodDistances {
  landmark0: number;
  landmark1: number;
  landmarkShadow0: number;
  small0: number;
  small1: number;
  small2: number;
}

interface LandmarkEntry {
  def: LandmarkDef;
  placement: Placement;
  matrix: THREE.Matrix4;
  center: THREE.Vector3;
  radius: number;
  model: BuiltModel;
  geom1: number;
  geom2: number;
  instance: number;
  lod0: THREE.Mesh | null;
  lod0State: 'none' | 'loading' | 'ready' | 'failed';
  stateKey: number;
}

interface SiteEntry {
  placement: Placement;
  center: THREE.Vector3;
  radius: number;
  variant: number;
  instance: number;
  stateKey: number;
}

const _cam = new THREE.Vector3();
const _m = new THREE.Matrix4();
const UPLOAD_BUDGET_MS = 3;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function lodDistances(q: QualitySettings): LodDistances {
  const detail = q.landmarkDetailDistance;
  return {
    landmark0: clamp(detail * 0.32, 320, 1300),
    landmark1: detail,
    landmarkShadow0: clamp(detail * 0.14, 160, 480),
    small0: clamp(detail * 0.2, 220, 800),
    small1: clamp(detail * 1.3, 1200, 5200),
    small2: clamp(detail * 6.5, 6000, 22000),
  };
}

function sphereOf(g: GeomData, p: Placement): { center: THREE.Vector3; radius: number } {
  const b = g.bounds;
  const c = Math.cos(p.yaw);
  const s = Math.sin(p.yaw);
  const k = p.scale;
  const center = new THREE.Vector3(p.x + (b[6] * c + b[8] * s) * k, p.y + b[7] * k, p.z + (-b[6] * s + b[8] * c) * k);
  return { center, radius: b[9] * k };
}

/** Landmark Ottoman mosques (hand-configured) + procedural neighbourhood mosques on every geo mosque site. */
export class MosqueSystem implements System {
  readonly name = 'mosques';
  readonly order = UpdateOrder.World;

  private ctx: EngineContext | null = null;
  private geo: GeoQuery | null = null;
  private pool: MosqueWorkerPool | null = null;
  private readonly uniforms: MosqueMaterialUniforms = { uMqFlood: { value: 1 }, uMqWindowGlow: { value: 1 } };
  private material: THREE.MeshStandardMaterial | null = null;
  private batch: LodBatchedMesh | null = null;
  private readonly landmarks: LandmarkEntry[] = [];
  private readonly sites: SiteEntry[] = [];
  private smallGeoms: number[][] = [];
  private readonly uploads: (() => void)[] = [];
  private readonly colliderIds: number[] = [];
  private jobs = 0;
  private lod0Loading = 0;
  private started = false;
  private assembled = false;
  private disposed = false;
  private warmup: THREE.Mesh | null = null;
  /** Smoothed CPU time of the per-frame LOD selection (ms, runs in preRender). */
  private lodMs = 0;

  constructor(private readonly options: MosqueSystemOptions = {}) {}

  init(ctx: EngineContext): void {
    this.ctx = ctx;
    this.material = createMosqueMaterial(this.uniforms, 'mosques');
    const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
    this.pool = new MosqueWorkerPool(cores >= 8 ? 3 : 2);
    const geo = ctx.services.tryGet('geo');
    if (geo) {
      this.start(geo);
    } else {
      void ctx.services.when('geo').then((g) => this.start(g));
    }
  }

  pending(): number {
    if (this.disposed) {
      return 0;
    }
    const waiting = this.started && !this.assembled ? 1 : 0;
    return this.jobs + this.uploads.length + this.lod0Loading + waiting;
  }

  /** Debug/sandbox access. */
  get stats(): { landmarks: number; sites: number; lod0: number; colliders: number; lodMs: number } {
    return {
      lodMs: Math.round(this.lodMs * 1000) / 1000,
      landmarks: this.landmarks.length,
      sites: this.sites.length,
      lod0: this.landmarks.filter((l) => l.lod0State === 'ready' && l.lod0?.visible).length,
      colliders: this.colliderIds.length,
    };
  }

  private start(geo: GeoQuery): void {
    if (this.started || this.disposed || !this.pool) {
      return;
    }
    this.started = true;
    this.geo = geo;
    const defs = geo.landmarks.filter((l) => l.builder === 'mosques');
    this.jobs += defs.length + 1;
    const landmarkJobs = defs.map((def) =>
      this.pool!.run({ kind: 'landmark', key: def.id, levels: [1, 2], fallback: { height: def.height, radius: def.radius } })
        .then((models) => models[0] ?? null)
        .catch((err: unknown) => {
          console.error(`[mosques] landmark ${def.id} failed`, err);
          return null;
        })
        .finally(() => this.jobs--),
    );
    const smallJob = this.pool
      .run({ kind: 'neighborhood' })
      .catch((err: unknown) => {
        console.error('[mosques] neighbourhood prototypes failed', err);
        return [] as BuiltModel[];
      })
      .finally(() => this.jobs--);
    void Promise.all([Promise.all(landmarkJobs), smallJob]).then(([models, small]) => {
      if (!this.disposed) {
        this.assemble(defs, models, small);
      }
    });
  }

  /** Allocates the batch and queues time-sliced geometry uploads, instances and colliders. */
  private assemble(defs: LandmarkDef[], models: (BuiltModel | null)[], small: BuiltModel[]): void {
    const ctx = this.ctx!;
    const geo = this.geo!;
    let verts = 0;
    let indices = 0;
    const count = (g: GeomData | null): void => {
      if (g) {
        verts += g.position.length / 3;
        indices += g.index.length;
      }
    };
    models.forEach((m) => {
      count(m?.lods[1] ?? null);
      count(m?.lods[2] ?? null);
    });
    small.forEach((m) => m.lods.forEach(count));
    const sites = small.length > 0 ? geo.smallMosqueSites : [];
    const maxInstances = Math.max(1, models.filter(Boolean).length + sites.length);
    const batch = new LodBatchedMesh(maxInstances, Math.max(3, verts), Math.max(3, indices), this.material!);
    batch.name = 'mosques-batch';
    batch.mainCamera = ctx.camera;
    batch.castShadow = true;
    batch.receiveShadow = true;
    batch.frustumCulled = false;
    batch.matrixAutoUpdate = false;
    this.batch = batch;

    const geomIds = new Map<GeomData, number>();
    const addGeom = (g: GeomData | null): void => {
      if (g) {
        this.uploads.push(() => {
          const bg = toBufferGeometry(g, true);
          geomIds.set(g, batch.addGeometry(bg));
          bg.dispose();
        });
      }
    };
    models.forEach((m) => {
      addGeom(m?.lods[1] ?? null);
      addGeom(m?.lods[2] ?? null);
    });
    small.forEach((m) => m.lods.forEach(addGeom));

    this.uploads.push(() => {
      defs.forEach((def, i) => {
        const model = models[i];
        if (!model || !model.lods[1] || !model.lods[2]) {
          return;
        }
        const placement = placementFromHeading(def.x, def.y, def.z, def.headingDeg);
        const matrix = placementMatrix(placement, new THREE.Matrix4());
        const geom1 = geomIds.get(model.lods[1])!;
        const geom2 = geomIds.get(model.lods[2])!;
        const instance = batch.addInstance(geom1);
        batch.setMatrixAt(instance, matrix);
        const { center, radius } = sphereOf(model.lods[1], placement);
        this.landmarks.push({ def, placement, matrix, center, radius, model, geom1, geom2, instance, lod0: null, lod0State: 'none', stateKey: -1 });
        this.addColliders(worldColliders(model.colliders, placement), `mosque:${def.id}`, def.id);
      });
    });

    const footprints = small.map((m) => m.footprint ?? m.radius);
    const pitched = small.map((m) => !!m.pitched);
    const SITE_CHUNK = 80;
    for (let start = 0; start < sites.length; start += SITE_CHUNK) {
      this.uploads.push(() => {
        if (start === 0) {
          this.smallGeoms = small.map((m) => m.lods.map((g) => (g ? geomIds.get(g)! : -1)));
        }
        for (let i = start; i < Math.min(sites.length, start + SITE_CHUNK); i++) {
          const site = sites[i];
          const choice = this.options.cycleVariants ? { variant: i % small.length, scale: 1 } : chooseVariant(site, footprints, pitched, geo);
          const placement = placementFromHeading(site.x, site.y, site.z, site.headingDeg, choice.scale);
          const proto = small[choice.variant];
          const instance = batch.addInstance(this.smallGeoms[choice.variant][2]);
          batch.setMatrixAt(instance, placementMatrix(placement, _m));
          const { center, radius } = sphereOf(proto.lods[0]!, placement);
          this.sites.push({ placement, center, radius, variant: choice.variant, instance, stateKey: -1 });
          this.addColliders(worldColliders(proto.colliders, placement, keepSmallCollider), 'mosque', `mosque-site:${i}:${proto.id}`);
        }
      });
    }

    this.uploads.push(() => {
      const warmGeo = small[0]?.lods[2] ? toBufferGeometry(small[0].lods[2]!) : null;
      if (warmGeo) {
        this.warmup = new THREE.Mesh(warmGeo, this.material!);
        this.warmup.receiveShadow = true;
        this.warmup.castShadow = true;
      }
      const group = new THREE.Group();
      group.add(batch);
      if (this.warmup) {
        group.add(this.warmup);
      }
      this.jobs++;
      const finish = (): void => {
        this.jobs--;
        group.remove(batch);
        if (this.warmup) {
          group.remove(this.warmup);
          this.warmup.geometry.dispose();
          this.warmup = null;
        }
        if (this.disposed) {
          return;
        }
        this.updateLods();
        ctx.scene.add(batch);
        batch.updateMatrixWorld(true);
        this.assembled = true;
      };
      ctx.renderer.compileAsync(group, ctx.camera, ctx.scene).then(finish, finish);
    });
  }

  private addColliders(colliders: Collider[], tag: string, source: string): void {
    const world = this.ctx?.services.tryGet('collision');
    if (!world) {
      return;
    }
    for (const c of colliders) {
      this.colliderIds.push(world.add(c, tag, source));
    }
  }

  update(): void {
    if (this.uploads.length === 0) {
      return;
    }
    const t0 = performance.now();
    while (this.uploads.length > 0 && performance.now() - t0 < UPLOAD_BUDGET_MS) {
      this.uploads.shift()!();
    }
  }

  preRender(): void {
    if (this.assembled) {
      const t0 = performance.now();
      this.updateLods();
      this.lodMs += (performance.now() - t0 - this.lodMs) * 0.05;
    }
  }

  private updateLods(): void {
    const ctx = this.ctx!;
    const batch = this.batch!;
    const D = lodDistances(ctx.quality.settings);
    _cam.setFromMatrixPosition(ctx.camera.matrixWorld);
    const forced = this.options.forceLod;

    for (const e of this.landmarks) {
      const d = Math.max(0, _cam.distanceTo(e.center) - e.radius);
      const lod0Active = e.lod0State === 'ready' && e.lod0!.visible;
      let want0 = forced !== undefined ? forced === 0 : d < D.landmark0 * (lod0Active ? 1.12 : 1);
      if (want0 && e.lod0State === 'none') {
        this.requestLod0(e);
      }
      if (e.lod0State === 'ready' && !want0 && d > D.landmark0 * 1.8 && forced === undefined) {
        this.disposeLod0(e);
      }
      want0 = want0 && e.lod0State === 'ready';
      if (want0) {
        const casts = d < D.landmarkShadow0;
        e.lod0!.visible = true;
        e.lod0!.castShadow = casts;
        batch.setInstanceLods(e.instance, -1, casts ? -1 : e.geom1, e.geom1);
        e.stateKey = 0;
        continue;
      }
      if (e.lod0) {
        e.lod0.visible = false;
      }
      const lod = forced !== undefined ? (forced === 2 ? 2 : 1) : d < D.landmark1 * (e.stateKey === 2 ? 1 : 1.08) ? 1 : 2;
      const near = d < D.landmark0 * 1.5;
      if (lod === 1) {
        batch.setInstanceLods(e.instance, e.geom1, near ? e.geom1 : e.geom2, near ? e.geom1 : e.geom2);
      } else {
        batch.setInstanceLods(e.instance, e.geom2, e.geom2, e.geom2);
      }
      e.stateKey = lod;
    }

    const shadow0 = D.landmarkShadow0 * 0.6;
    for (const s of this.sites) {
      const d = Math.max(0, _cam.distanceTo(s.center) - s.radius);
      const cur = s.stateKey;
      const h = (lod: number): number => (cur === lod ? 1.1 : 1);
      let lod: number;
      if (forced !== undefined) {
        lod = forced;
      } else if (d < D.small0 * h(0)) {
        lod = 0;
      } else if (d < D.small1 * h(1)) {
        lod = 1;
      } else if (d < D.small2 * h(2)) {
        lod = 2;
      } else {
        lod = 3;
      }
      const g = this.smallGeoms[s.variant];
      if (lod === 0) {
        batch.setInstanceLods(s.instance, g[0], d < shadow0 ? g[0] : g[1], g[1]);
      } else if (lod === 1) {
        batch.setInstanceLods(s.instance, g[1], g[2], g[2]);
      } else if (lod === 2) {
        batch.setInstanceLods(s.instance, g[2], g[2], g[2]);
      } else {
        batch.setInstanceLods(s.instance, -1, -1, -1);
      }
      s.stateKey = lod;
    }
  }

  private requestLod0(e: LandmarkEntry): void {
    if (!this.pool) {
      return;
    }
    e.lod0State = 'loading';
    this.lod0Loading++;
    this.pool
      .run({ kind: 'landmark', key: e.def.id, levels: [0], fallback: { height: e.def.height, radius: e.def.radius } })
      .then((models) => {
        const g = models[0]?.lods[0];
        if (this.disposed || !g || e.lod0State !== 'loading') {
          if (e.lod0State === 'loading') {
            e.lod0State = g ? 'none' : 'failed';
          }
          return;
        }
        const mesh = new THREE.Mesh(toBufferGeometry(g), this.material!);
        mesh.name = `mosque-lod0:${e.def.id}`;
        mesh.matrixAutoUpdate = false;
        mesh.matrix.copy(e.matrix);
        mesh.receiveShadow = true;
        mesh.castShadow = true;
        mesh.visible = false;
        mesh.layers.set(RenderLayers.NoReflection);
        this.ctx!.scene.add(mesh);
        mesh.updateMatrixWorld(true);
        e.lod0 = mesh;
        e.lod0State = 'ready';
      })
      .catch((err: unknown) => {
        console.error(`[mosques] LOD0 ${e.def.id} failed`, err);
        e.lod0State = 'failed';
      })
      .finally(() => this.lod0Loading--);
  }

  private disposeLod0(e: LandmarkEntry): void {
    if (e.lod0) {
      e.lod0.removeFromParent();
      e.lod0.geometry.dispose();
    }
    e.lod0 = null;
    e.lod0State = 'none';
    e.stateKey = -1;
  }

  dispose(): void {
    this.disposed = true;
    const world = this.ctx?.services.tryGet('collision');
    if (world) {
      world.removeMany(this.colliderIds);
    }
    this.colliderIds.length = 0;
    for (const e of this.landmarks) {
      this.disposeLod0(e);
    }
    if (this.batch) {
      this.batch.removeFromParent();
      this.batch.dispose();
      this.batch = null;
    }
    this.material?.dispose();
    this.pool?.dispose();
    this.pool = null;
    this.uploads.length = 0;
  }
}

/**
 * Neighbourhood mosques register the prayer hall, dome and minaret colliders. Porticos (open arcades, flagged by the
 * builder: their 5.6-8.6 m roofs made a height test keep them as solid walls between the columns) and low boxes are
 * skipped.
 */
function keepSmallCollider(c: LocalCollider): boolean {
  if (c.kind === 'box') {
    return !c.open && c.hy > 2.5;
  }
  return true;
}
