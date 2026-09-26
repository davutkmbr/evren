/**
 * GPU side of the structure parts: one BatchedMesh per material (opaque surfaces, glass curtain walls), so every
 * bridge, tower and skyscraper costs a single multi-draw per pass. Each part is one batch instance whose geometry
 * id is switched between its LOD levels (distance to the bounding sphere, with hysteresis); parts beyond their
 * cull distance are hidden. Per-object frustum culling is done by BatchedMesh itself.
 */
import * as THREE from 'three';
import type { GeometryData, PartData } from '../types';
import { BatchKind } from '../types';

interface PartSlot {
  batch: THREE.BatchedMesh;
  instance: number;
  geometryIds: number[];
  cx: number;
  cy: number;
  cz: number;
  radius: number;
  detailScale: number;
  cullDistance: number;
  lod: number;
  triangles: number[];
}

function toBufferGeometry(g: GeometryData, sphere: THREE.Sphere): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(g.position, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(g.normal, 3, true));
  geometry.setAttribute('uv', new THREE.BufferAttribute(g.uv, 2));
  geometry.setAttribute('color', new THREE.BufferAttribute(g.color, 3, true));
  geometry.setAttribute('aSurf', new THREE.BufferAttribute(g.surf, 4));
  geometry.setAttribute('aEmit', new THREE.BufferAttribute(g.emit, 4));
  geometry.setIndex(new THREE.BufferAttribute(g.index, 1));
  geometry.boundingSphere = sphere.clone();
  return geometry;
}

/** LOD i covers distances [step * (2^i - 1), step * (2^(i+1) - 1)). */
export function lodFor(d: number, step: number, levels: number): number {
  return Math.min(Math.floor(Math.log2(d / step + 1)), levels - 1);
}

export class StructureBatches {
  readonly group = new THREE.Group();
  private slots: PartSlot[] = [];
  private batches: THREE.BatchedMesh[] = [];
  /** Triangles of the currently selected LODs (all parts, before frustum culling). */
  activeTriangles = 0;

  constructor(private readonly materials: Record<BatchKind, THREE.Material>) {
    this.group.name = 'structures.batches';
  }

  get partCount(): number {
    return this.slots.length;
  }

  /** Replaces the batches with the given parts. */
  build(parts: readonly PartData[]): void {
    this.clear();
    for (const kind of [BatchKind.Opaque, BatchKind.Glass]) {
      const list = parts.filter((p) => p.batch === kind);
      if (list.length === 0) {
        continue;
      }
      let vertices = 0;
      let indices = 0;
      for (const p of list) {
        for (const lod of p.lods) {
          vertices += lod.position.length / 3;
          indices += lod.index.length;
        }
      }
      const batch = new THREE.BatchedMesh(list.length, vertices, indices, this.materials[kind]);
      batch.name = kind === BatchKind.Opaque ? 'structures.opaque' : 'structures.glass';
      batch.sortObjects = false;
      batch.perObjectFrustumCulled = true;
      batch.castShadow = true;
      batch.receiveShadow = true;
      batch.frustumCulled = false;
      const sphere = new THREE.Sphere();
      for (const p of list) {
        sphere.center.set(p.center[0], p.center[1], p.center[2]);
        sphere.radius = p.radius;
        const ids = p.lods.map((g) => batch.addGeometry(toBufferGeometry(g, sphere)));
        const instance = batch.addInstance(ids[0]);
        batch.setVisibleAt(instance, false);
        this.slots.push({
          batch,
          instance,
          geometryIds: ids,
          cx: p.center[0],
          cy: p.center[1],
          cz: p.center[2],
          radius: p.radius,
          detailScale: p.detailScale,
          cullDistance: p.cullDistance,
          lod: -1,
          triangles: p.lods.map((g) => g.index.length / 3),
        });
      }
      this.batches.push(batch);
      this.group.add(batch);
    }
  }

  /** LOD / visibility selection for the given camera position. */
  update(camera: THREE.Vector3, detailDistance: number): void {
    let tris = 0;
    for (const s of this.slots) {
      const dx = camera.x - s.cx;
      const dy = camera.y - s.cy;
      const dz = camera.z - s.cz;
      const d = Math.max(Math.sqrt(dx * dx + dy * dy + dz * dz) - s.radius, 0);
      let lod = -1;
      if (d <= s.cullDistance) {
        const step = detailDistance * s.detailScale;
        const levels = s.geometryIds.length;
        lod = lodFor(d, step, levels);
        // hysteresis: only switch once the distance is 6 % past the threshold
        if (s.lod >= 0 && lod > s.lod && lodFor(d * 0.94, step, levels) <= s.lod) {
          lod = s.lod;
        } else if (s.lod >= 0 && lod < s.lod && lodFor(d * 1.06, step, levels) >= s.lod) {
          lod = s.lod;
        }
      }
      if (lod !== s.lod) {
        if (lod < 0) {
          s.batch.setVisibleAt(s.instance, false);
        } else {
          if (s.lod < 0) {
            s.batch.setVisibleAt(s.instance, true);
          }
          s.batch.setGeometryIdAt(s.instance, s.geometryIds[lod]);
        }
        s.lod = lod;
      }
      if (lod >= 0) {
        tris += s.triangles[lod];
      }
    }
    this.activeTriangles = tris;
  }

  clear(): void {
    for (const b of this.batches) {
      this.group.remove(b);
      b.dispose();
    }
    this.batches = [];
    this.slots = [];
  }

  dispose(): void {
    this.clear();
  }
}
