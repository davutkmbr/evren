/**
 * Main-thread orchestration of the structures module: samples terrain for every structure site, generates the
 * geometry in a module worker, uploads it into the material batches (opaque / glass BatchedMesh, wires, light
 * sprites), registers colliders and runs the per-frame LOD selection.
 */
import * as THREE from 'three';
import type { EngineContext, GeoQuery, LandmarkDef, System } from '../../../../core/contracts';
import { UpdateOrder } from '../../../../core/contracts';
import { globalUniforms } from '../../../../core/uniforms';
import { StructureBatches } from '../render/batches';
import { LightRenderer } from '../render/lights';
import { createGlassMaterial, createOpaqueMaterial } from '../render/materials';
import { WireRenderer } from '../render/wires';
import { BatchKind, LIGHT_STRIDE, WIRE_STRIDE } from '../types';
import type { PartData, StructureResult, WorkerRequest, WorkerResponse } from '../types';
import { prepareSite } from './site-planner';

export interface StructureSystemOptions {
  /** Only build these landmark ids (sandbox isolation). */
  only?: readonly string[];
}

const _cam = new THREE.Vector3();

export class StructureSystem implements System {
  readonly name = 'structures';
  readonly order = UpdateOrder.World;

  private ctx: EngineContext | null = null;
  private worker: Worker | null = null;
  private readonly opaqueMaterial = createOpaqueMaterial();
  private readonly glassMaterial = createGlassMaterial();
  private readonly batches = new StructureBatches({ [BatchKind.Opaque]: this.opaqueMaterial, [BatchKind.Glass]: this.glassMaterial });
  private readonly wires = new WireRenderer();
  private readonly lights = new LightRenderer();
  private readonly root = new THREE.Group();
  private readonly results = new Map<string, StructureResult>();
  private colliderIds: number[] = [];
  private outstanding = 0;
  private expected = 0;
  private generationMs = 0;

  constructor(private readonly options: StructureSystemOptions = {}) {
    this.root.name = 'structures';
    this.root.add(this.batches.group, this.wires.mesh, this.lights.mesh);
  }

  init(ctx: EngineContext): void {
    this.ctx = ctx;
    ctx.scene.add(this.root);
    this.outstanding = 1;
    void ctx.services.when('geo').then((geo) => this.start(geo));
  }

  pending(): number {
    return this.outstanding;
  }

  private start(geo: GeoQuery): void {
    const only = this.options.only;
    const defs = geo.landmarks.filter((l: LandmarkDef) => l.builder === 'structures' && (!only || only.includes(l.id)));
    if (defs.length === 0) {
      this.outstanding = 0;
      return;
    }
    const sites = defs.map((d) => prepareSite(d, geo));
    this.expected = sites.length;
    this.outstanding = sites.length;
    this.worker = new Worker(new URL('../worker/structures.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => this.onWorkerMessage(e.data);
    this.worker.onerror = (e) => {
      console.error('[structures] worker error', e.message);
      this.outstanding = 0;
    };
    const request: WorkerRequest = { type: 'build', sites };
    const transfer = sites.flatMap((s) => s.patches.map((p) => p.data.buffer as ArrayBuffer));
    this.worker.postMessage(request, transfer);
  }

  private onWorkerMessage(msg: WorkerResponse): void {
    if (msg.type === 'structure') {
      this.results.set(msg.result.id, msg.result);
      this.generationMs += msg.result.ms;
      this.addColliders(msg.result);
      this.outstanding = Math.max(this.outstanding - 1, 1);
    } else if (msg.type === 'error') {
      console.error(`[structures] ${msg.id}: ${msg.message}`);
      this.outstanding = Math.max(this.outstanding - 1, 1);
    } else if (msg.type === 'done') {
      this.upload();
      this.worker?.terminate();
      this.worker = null;
      this.outstanding = 0;
      if (this.ctx?.sandbox) {
        console.info(`[structures] ${this.results.size}/${this.expected} structures, worker ${msg.ms.toFixed(0)} ms, parts ${this.batches.partCount}, wires ${this.wires.count}, lights ${this.lights.count}`);
      }
    }
  }

  private addColliders(result: StructureResult): void {
    const collision = this.ctx?.services.get('collision');
    if (!collision) {
      return;
    }
    for (const c of result.colliders) {
      if (c.kind === 'box') {
        this.colliderIds.push(
          collision.add({ kind: 'box', center: new THREE.Vector3(...c.center), halfSize: new THREE.Vector3(...c.halfSize), yaw: c.yaw }, 'structure'),
        );
      } else if (c.kind === 'cylinder') {
        this.colliderIds.push(collision.add({ kind: 'cylinder', base: new THREE.Vector3(...c.base), radius: c.radius, height: c.height }, 'structure'));
      } else {
        this.colliderIds.push(collision.add({ kind: 'sphere', center: new THREE.Vector3(...c.center), radius: c.radius }, 'structure'));
      }
    }
  }

  private upload(): void {
    const parts: PartData[] = [];
    let wireFloats = 0;
    let lightFloats = 0;
    for (const r of this.results.values()) {
      parts.push(...r.parts);
      wireFloats += r.wires.length;
      lightFloats += r.lights.length;
    }
    this.batches.build(parts);
    const wires = new Float32Array(Math.max(wireFloats, WIRE_STRIDE));
    const lights = new Float32Array(Math.max(lightFloats, LIGHT_STRIDE));
    let wo = 0;
    let lo = 0;
    for (const r of this.results.values()) {
      wires.set(r.wires, wo);
      wo += r.wires.length;
      lights.set(r.lights, lo);
      lo += r.lights.length;
    }
    this.wires.setData(wires.subarray(0, wo));
    this.lights.setData(lights.subarray(0, lo));
    if (this.ctx) {
      this.updateLod(this.ctx);
    }
  }

  private updateLod(ctx: EngineContext): void {
    _cam.setFromMatrixPosition(ctx.camera.matrixWorld);
    this.batches.update(_cam, ctx.quality.settings.landmarkDetailDistance);
  }

  update(_dt: number, ctx: EngineContext): void {
    if (this.batches.partCount > 0) {
      this.updateLod(ctx);
    }
  }

  preRender(ctx: EngineContext): void {
    const res = globalUniforms.uResolution.value as THREE.Vector2;
    const scale = ctx.pipeline.renderScale || 1;
    const pixelAngle = (2 * Math.tan(THREE.MathUtils.degToRad(ctx.camera.fov) / 2)) / Math.max(res.y * scale, 1);
    this.wires.setPixelAngle(pixelAngle);
    this.lights.setPixelAngle(pixelAngle);
  }

  /** Debug info for sandboxes. */
  stats(): { parts: number; wires: number; lights: number; activeTriangles: number; generationMs: number } {
    return {
      parts: this.batches.partCount,
      wires: this.wires.count,
      lights: this.lights.count,
      activeTriangles: this.batches.activeTriangles,
      generationMs: Math.round(this.generationMs),
    };
  }

  dispose(): void {
    this.worker?.terminate();
    const collision = this.ctx?.services.tryGet('collision');
    collision?.removeMany(this.colliderIds);
    this.colliderIds = [];
    this.batches.dispose();
    this.wires.dispose();
    this.lights.dispose();
    this.opaqueMaterial.dispose();
    this.glassMaterial.dispose();
    this.root.removeFromParent();
  }
}
