import * as THREE from 'three';
import { RenderLayers } from '../../../core/contracts';
import type { VesselModel } from './model-types';

interface Group {
  near: THREE.BatchedMesh;
  far: THREE.BatchedMesh;
  nearGeom: Map<string, number>;
  farGeom: Map<string, number>;
}

export interface FleetHandle {
  big: boolean;
  nearId: number;
  farId: number;
  model: VesselModel;
  /** 0 hidden, 1 near, 2 far. */
  state: number;
}

/** Beyond this distance small craft are sub-pixel and skipped entirely. */
const SMALL_CULL = 7000;
const BIG_CULL = 30000;

/**
 * Draws the whole fleet with four BatchedMeshes (big/small x near/far LOD): one multi-draw call each.
 * Big ships live on the Default layer (planar water reflections), small craft on NoReflection.
 */
export class FleetRenderer {
  readonly object = new THREE.Group();
  private groups: { big: Group; small: Group };
  private handles: FleetHandle[] = [];
  private readonly tmpPos = new THREE.Vector3();

  constructor(models: Map<string, VesselModel>, material: THREE.Material, maxBig: number, maxSmall: number) {
    this.object.name = 'life-fleet';
    const all = [...models.values()];
    this.groups = {
      big: this.createGroup(all.filter((m) => m.big), material, maxBig, true),
      small: this.createGroup(all.filter((m) => !m.big), material, maxSmall, false),
    };
  }

  private createGroup(models: VesselModel[], material: THREE.Material, maxInstances: number, big: boolean): Group {
    const make = (lod: 0 | 1): { mesh: THREE.BatchedMesh; ids: Map<string, number> } => {
      let verts = 0;
      let indices = 0;
      for (const m of models) {
        const g = lod === 0 ? m.lod0 : m.lod1;
        verts += g.getAttribute('position').count;
        indices += g.getIndex()!.count;
      }
      const mesh = new THREE.BatchedMesh(Math.max(1, maxInstances), Math.max(3, verts), Math.max(3, indices), material);
      mesh.name = `life-fleet-${big ? 'big' : 'small'}-${lod === 0 ? 'near' : 'far'}`;
      mesh.sortObjects = false;
      mesh.perObjectFrustumCulled = true;
      mesh.frustumCulled = false;
      mesh.castShadow = lod === 0;
      mesh.receiveShadow = lod === 0;
      if (!big) mesh.layers.set(RenderLayers.NoReflection);
      const ids = new Map<string, number>();
      for (const m of models) ids.set(m.key, mesh.addGeometry(lod === 0 ? m.lod0 : m.lod1));
      this.object.add(mesh);
      return { mesh, ids };
    };
    const n = make(0);
    const f = make(1);
    return { near: n.mesh, far: f.mesh, nearGeom: n.ids, farGeom: f.ids };
  }

  add(model: VesselModel, paint: THREE.Color, seed: number): FleetHandle {
    const g = model.big ? this.groups.big : this.groups.small;
    const nearId = g.near.addInstance(g.nearGeom.get(model.key)!);
    const farId = g.far.addInstance(g.farGeom.get(model.key)!);
    const c = new THREE.Vector4(paint.r, paint.g, paint.b, seed);
    g.near.setColorAt(nearId, c);
    g.far.setColorAt(farId, c);
    g.near.setVisibleAt(nearId, false);
    g.far.setVisibleAt(farId, false);
    const h: FleetHandle = { big: model.big, nearId, farId, model, state: 0 };
    this.handles.push(h);
    return h;
  }

  /** Updates the transform and LOD of one vessel. */
  update(h: FleetHandle, matrix: THREE.Matrix4, camPos: THREE.Vector3): void {
    const g = h.big ? this.groups.big : this.groups.small;
    this.tmpPos.setFromMatrixPosition(matrix);
    const dist = this.tmpPos.distanceTo(camPos);
    const cull = h.big ? BIG_CULL : SMALL_CULL;
    const state = dist > cull ? 0 : dist < h.model.lodDistance ? 1 : 2;
    if (state !== h.state) {
      g.near.setVisibleAt(h.nearId, state === 1);
      g.far.setVisibleAt(h.farId, state === 2);
      h.state = state;
    }
    if (state === 1) g.near.setMatrixAt(h.nearId, matrix);
    else if (state === 2) g.far.setMatrixAt(h.farId, matrix);
  }

  clear(): void {
    for (const h of this.handles) {
      const g = h.big ? this.groups.big : this.groups.small;
      g.near.deleteInstance(h.nearId);
      g.far.deleteInstance(h.farId);
    }
    this.handles = [];
  }

  get meshes(): THREE.BatchedMesh[] {
    return [this.groups.big.near, this.groups.big.far, this.groups.small.near, this.groups.small.far];
  }

  dispose(): void {
    for (const m of this.meshes) m.dispose();
    this.object.clear();
  }
}
