/**
 * Per-landmark build context handed to every builder: terrain lookups, part/wire/light/collider sinks and a
 * deterministic RNG. Parts are described by a closure that is invoked once per LOD level with a fresh builder.
 */
import * as THREE from 'three';
import { createRng, hashString } from '../../../../core/math/noise';
import type { ColliderData, PartData, SiteDef, SiteInput, StructureResult } from '../types';
import { BatchKind } from '../types';
import { HeightSampler } from './height-sampler';
import { LightList } from './light-list';
import { MeshBuilder } from './mesh-builder';
import { WireList } from './wire-list';

export interface PartOptions {
  /** Number of LOD levels generated (the closure receives lod = 0..lods-1). Default 2. */
  lods?: number;
  detailScale?: number;
  cullDistance?: number;
}

export type PartFn = (mb: MeshBuilder, lod: number) => void;

export class StructureBuild {
  readonly def: SiteDef;
  readonly terrain: HeightSampler;
  readonly wires = new WireList();
  readonly lights = new LightList();
  readonly colliders: ColliderData[] = [];
  readonly rng: () => number;
  private readonly parts: PartData[] = [];

  constructor(site: SiteInput) {
    this.def = site.def;
    this.terrain = new HeightSampler(site.patches);
    this.rng = createRng(hashString(site.def.id));
  }

  /** Terrain height (sea floor negative). */
  ground(x: number, z: number): number {
    return this.terrain.heightAt(x, z);
  }

  part(batch: BatchKind, fn: PartFn, opts: PartOptions = {}): void {
    const levels = opts.lods ?? 2;
    const builders: MeshBuilder[] = [];
    for (let lod = 0; lod < levels; lod++) {
      const mb = new MeshBuilder();
      fn(mb, lod);
      if (!mb.isEmpty()) {
        builders.push(mb);
      }
    }
    if (builders.length === 0) {
      return;
    }
    const bounds = builders[0].bounds();
    this.parts.push({
      batch,
      lods: builders.map((b) => b.build()),
      center: bounds.center,
      radius: bounds.radius,
      detailScale: opts.detailScale ?? 1,
      cullDistance: opts.cullDistance ?? 40000,
    });
  }

  opaque(fn: PartFn, opts?: PartOptions): void {
    this.part(BatchKind.Opaque, fn, opts);
  }

  glass(fn: PartFn, opts?: PartOptions): void {
    this.part(BatchKind.Glass, fn, opts);
  }

  boxCollider(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, yaw: number): void {
    this.colliders.push({ kind: 'box', center: [cx, cy, cz], halfSize: [hx, hy, hz], yaw });
  }

  cylinderCollider(x: number, y: number, z: number, radius: number, height: number): void {
    this.colliders.push({ kind: 'cylinder', base: [x, y, z], radius, height });
  }

  sphereCollider(x: number, y: number, z: number, radius: number): void {
    this.colliders.push({ kind: 'sphere', center: [x, y, z], radius });
  }

  /**
   * Box collider spanning segment a-b (horizontal-ish) with a cross-section half width / half height.
   * Yaw follows Object3D.rotation.y: local +X maps to world (cos yaw, -sin yaw).
   */
  segmentCollider(a: THREE.Vector3, b: THREE.Vector3, halfWidth: number, halfHeight: number): void {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    const yaw = Math.atan2(-dz, dx);
    this.boxCollider((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2, len / 2, halfHeight + Math.abs(b.y - a.y) / 2, halfWidth, yaw);
  }

  /** Vertical box collider for a leg/column from a to b (the axis may lean slightly). */
  columnCollider(a: THREE.Vector3, b: THREE.Vector3, halfX: number, halfZ: number, yaw: number): void {
    const hy = Math.abs(b.y - a.y) / 2;
    const lean = Math.hypot(b.x - a.x, b.z - a.z) / 2;
    this.boxCollider((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2, halfX + lean * 0.5, hy, halfZ + lean * 0.5, yaw);
  }

  result(ms: number): StructureResult {
    return {
      id: this.def.id,
      parts: this.parts,
      wires: this.wires.build(),
      lights: this.lights.build(),
      colliders: this.colliders,
      ms,
    };
  }
}

export { MeshBuilder };
