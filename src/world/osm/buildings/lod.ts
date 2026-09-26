/**
 * Near-LOD streaming of facade details (main thread). The worker sorts every detail instance by 64 m tile and
 * precomputes its matrix (details.ts); here each kind becomes one InstancedMesh, and whenever the
 * camera has moved far enough the tiles inside the kind's radius are copied into the live instance range. The
 * detail shader shrinks instances to nothing between 80 % and 100 % of the radius, so the swap to the painted
 * shader dressing of far walls is soft.
 */
import * as THREE from 'three';
import { RenderLayers } from '../../../core/contracts';
import { setShadowGate } from '../../../core/shadow-gate';
import type { QualityPreset } from '../../../core/quality';
import { LOD_RADIUS_SCALE as RADIUS_SCALE } from '../shared/instance-lod';
import { DETAIL_RADIUS, type DetailKind, type DetailStream, type DetailTiles } from './details';
import type { BuildingMaterials } from './materials';
import { acGeometry, awningGeometry, balconyGeometry, frameGeometry, railingGeometry, shutterGeometry, signGeometry, sillGeometry, surroundArchGeometry, surroundCapGeometry, surroundPedimentGeometry } from './props';

/** Kinds whose shadows read at street level (the rest are too thin to matter). */
const SHADOW_KINDS = new Set<DetailKind>(['surroundCap', 'balcony', 'railing', 'parapet', 'awning', 'sign']);
/**
 * Casters live only within their kind's radius, so they are kept out of the cascades that start beyond it; thin ones
 * (window caps, railings: a few cm of shadow) also out of every cascade starting beyond THIN_SHADOW_DEPTH (m).
 */
const THIN_SHADOW = new Set<DetailKind>(['surroundCap', 'railing']);
const THIN_SHADOW_DEPTH = 150;
/** Camera travel (m) that triggers a re-stream. */
const RESTREAM_STEP = 12;

export function detailGeometry(kind: DetailKind): THREE.BufferGeometry {
  switch (kind) {
    case 'surroundCap':
      return surroundCapGeometry();
    case 'surroundPediment':
      return surroundPedimentGeometry();
    case 'surroundArch':
      return surroundArchGeometry();
    case 'sill':
      return sillGeometry();
    case 'frame':
      return frameGeometry();
    case 'shutter':
      return shutterGeometry();
    case 'balcony':
      return balconyGeometry();
    case 'railing':
      return railingGeometry(0.035);
    case 'parapet':
      return railingGeometry(0.12);
    case 'sign':
      return signGeometry();
    case 'awning':
      return awningGeometry();
    case 'ac':
      return acGeometry();
  }
}

interface KindStream {
  kind: DetailKind;
  /** Sized to the instances in range (grown on demand, never to the whole region). */
  mesh: THREE.InstancedMesh | null;
  geometry: THREE.BufferGeometry;
  material: BuildingMaterials['details'][DetailKind];
  /** Precomputed instance matrices / colours of every record (tile order). */
  matrices: Float32Array;
  colours: Float32Array;
  ranges: Int32Array;
  radius: number;
  fade: THREE.IUniform<THREE.Vector2>;
  /** Tiles currently streamed into the mesh. */
  tiles: number[];
}

/** Headroom when an instance buffer grows, so a camera drifting at the edge of a dense block does not regrow it. */
const GROW = 1.5;

export class DetailLod {
  private readonly kinds: KindStream[] = [];
  private readonly last = new THREE.Vector3(Infinity, 0, Infinity);
  private scale = 1;

  constructor(
    private readonly group: THREE.Object3D,
    streams: Partial<Record<DetailKind, DetailStream>>,
    private readonly tiles: DetailTiles,
    materials: BuildingMaterials,
    preset: QualityPreset,
  ) {
    this.scale = RADIUS_SCALE[preset] ?? 1;
    for (const [kind, stream] of Object.entries(streams) as [DetailKind, DetailStream][]) {
      const { matrices, colours } = stream;
      const n = colours.length / 3;
      if (!n) {
        continue;
      }
      const mat = materials.details[kind];
      const k: KindStream = { kind, mesh: null, geometry: detailGeometry(kind), material: mat, matrices, colours, ranges: stream.ranges, radius: DETAIL_RADIUS[kind], fade: mat.fade, tiles: [] };
      this.kinds.push(k);
      // A small mesh from the start, so its program is linked with the region, not when the first details stream in.
      this.meshFor(k, 0);
    }
    this.applyFade();
  }

  setPreset(preset: QualityPreset): void {
    this.scale = RADIUS_SCALE[preset] ?? 1;
    this.applyFade();
    this.last.set(Infinity, 0, Infinity);
  }

  private applyFade(): void {
    for (const k of this.kinds) {
      const r = k.radius * this.scale;
      k.fade.value.set(r * 0.8, r);
      if (k.mesh) {
        this.gateShadow(k, k.mesh);
      }
    }
  }

  private gateShadow(k: KindStream, mesh: THREE.InstancedMesh): void {
    if (mesh.castShadow) {
      const r = k.radius * this.scale;
      setShadowGate(mesh, { below: THIN_SHADOW.has(k.kind) ? Math.min(r, THIN_SHADOW_DEPTH * this.scale) : r });
    }
  }

  /** The kind's mesh with room for `count` instances: replaced by a larger one (the old buffers freed) when too small. */
  private meshFor(k: KindStream, count: number): THREE.InstancedMesh {
    if (k.mesh && k.mesh.instanceMatrix.count >= count) {
      return k.mesh;
    }
    const cap = Math.min(k.colours.length / 3, Math.max(count, Math.ceil(count * GROW), 256));
    const mesh = new THREE.InstancedMesh(k.geometry, k.material.material, cap);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.customDepthMaterial = k.material.depth;
    mesh.count = 0;
    mesh.name = `osm-detail-${k.kind}`;
    mesh.frustumCulled = false;
    mesh.castShadow = SHADOW_KINDS.has(k.kind);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.layers.set(RenderLayers.NoReflection);
    this.gateShadow(k, mesh);
    if (k.mesh) {
      this.group.remove(k.mesh);
      // Frees the old instance buffers on the GPU (the geometry is shared and stays).
      k.mesh.dispose();
    }
    this.group.add(mesh);
    k.mesh = mesh;
    return mesh;
  }

  /**
   * Re-streams the instance ranges when the camera moved more than RESTREAM_STEP since the last pass; `above` is the
   * camera height over the local ground.
   */
  update(camera: THREE.Vector3, above: number): void {
    if (Math.hypot(camera.x - this.last.x, camera.z - this.last.z) < RESTREAM_STEP && Math.abs(camera.y - this.last.y) < RESTREAM_STEP * 2) {
      return;
    }
    this.last.copy(camera);
    const t = this.tiles;
    for (const k of this.kinds) {
      // Height above the street counts too: from the air the details are sub-pixel anyway.
      const r = k.radius * this.scale + t.size * 0.75;
      const rh = Math.sqrt(Math.max(0, r * r - (1.6 * Math.max(0, above - 20)) ** 2));
      // Tiles inside the radius; the buffers are only rewritten when that set changes.
      const tiles: number[] = [];
      if (rh > 0) {
        const i0 = Math.max(0, Math.floor((camera.x - rh - t.minX) / t.size));
        const i1 = Math.min(t.nx - 1, Math.floor((camera.x + rh - t.minX) / t.size));
        const j0 = Math.max(0, Math.floor((camera.z - rh - t.minZ) / t.size));
        const j1 = Math.min(t.nz - 1, Math.floor((camera.z + rh - t.minZ) / t.size));
        for (let j = j0; j <= j1; j++) {
          for (let i = i0; i <= i1; i++) {
            const tile = j * t.nx + i;
            const cx = t.minX + (i + 0.5) * t.size;
            const cz = t.minZ + (j + 0.5) * t.size;
            if (k.ranges[tile * 2 + 1] && Math.hypot(cx - camera.x, cz - camera.z) <= rh + t.size * 0.71) {
              tiles.push(tile);
            }
          }
        }
      }
      if (tiles.length === k.tiles.length && tiles.every((v, i) => v === k.tiles[i])) {
        continue;
      }
      k.tiles = tiles;
      let total = 0;
      for (const tile of tiles) {
        total += k.ranges[tile * 2 + 1];
      }
      const mesh = this.meshFor(k, total);
      const dst = mesh.instanceMatrix.array as Float32Array;
      const dstC = mesh.instanceColor!.array as Float32Array;
      let n = 0;
      for (const tile of tiles) {
        const start = k.ranges[tile * 2];
        const count = k.ranges[tile * 2 + 1];
        dst.set(k.matrices.subarray(start * 16, (start + count) * 16), n * 16);
        dstC.set(k.colours.subarray(start * 3, (start + count) * 3), n * 3);
        n += count;
      }
      mesh.count = n;
      if (n) {
        mesh.instanceMatrix.clearUpdateRanges();
        mesh.instanceMatrix.addUpdateRange(0, n * 16);
        mesh.instanceMatrix.needsUpdate = true;
        mesh.instanceColor!.clearUpdateRanges();
        mesh.instanceColor!.addUpdateRange(0, n * 3);
        mesh.instanceColor!.needsUpdate = true;
      }
      mesh.visible = n > 0;
    }
  }

  /** Live instance counts per kind (debug). */
  counts(): Record<string, number> {
    return Object.fromEntries(this.kinds.map((k) => [k.kind, k.mesh?.count ?? 0]));
  }
}
