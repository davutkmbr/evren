/**
 * Distance LOD for instanced props (rooftop tanks and chimneys, street lamps, trees...). The records are bucketed once
 * into TILE-metre tiles; whenever the camera has moved RESTREAM_STEP metres, the tiles within `radius` (3D distance to
 * the tile's mean height) are copied into the live instance ranges of two meshes: the ring within `shadowRadius` into
 * one that casts shadows, the rest into one that does not. So a kind costs at most two draw calls however large the
 * area, nothing past its radius is drawn in any pass, and small props never fill the far shadow cascades.
 */
import * as THREE from 'three';
import { RenderLayers } from '../../../core/contracts';
import { setShadowGate } from '../../../core/shadow-gate';
import type { QualityPreset } from '../../../core/quality';
import { INSTANCE_STRIDE } from './protocol';

/** Draw and shadow radii scale with the quality preset (the facade details use the same table). */
export const LOD_RADIUS_SCALE: Record<QualityPreset, number> = { low: 0.55, medium: 0.8, high: 1, ultra: 1.25 };

const TILE = 96;
/** Camera travel (m) that triggers a re-stream. */
const RESTREAM_STEP = 12;

export interface InstanceLodOptions {
  /** Drawn within this distance (m, at the "high" preset); Infinity = always. */
  radius: number;
  /** Casts shadows within this distance (m, at the "high" preset); 0 = never. */
  shadowRadius: number;
  /** RenderLayers value (default NoReflection: small props stay out of the water's mirror image). */
  layer?: number;
  receiveShadow?: boolean;
  /** Extra per-instance attributes streamed with the instances (e.g. a lamp's light flag). */
  attributes?: Record<string, { data: Float32Array; itemSize: number }>;
}

interface Part {
  mesh: THREE.InstancedMesh;
  extra: { name: string; attr: THREE.InstancedBufferAttribute; src: Float32Array; size: number }[];
  tiles: number[];
}

export class InstanceLod {
  /** Shadow-casting ring first, then the rest. */
  readonly meshes: THREE.InstancedMesh[] = [];
  private readonly parts: Part[] = [];
  private readonly matrices: Float32Array;
  private readonly colours: Float32Array;
  /** Per tile: first sorted instance and count. */
  private readonly ranges: Int32Array;
  private readonly tileY: Float32Array;
  private readonly minX: number;
  private readonly minZ: number;
  private readonly nx: number;
  private readonly nz: number;
  private readonly last = new THREE.Vector3(Infinity, 0, Infinity);
  private lastScale = -1;

  constructor(
    group: THREE.Object3D,
    readonly name: string,
    records: Float32Array,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    private readonly opt: InstanceLodOptions,
  ) {
    const n = records.length / INSTANCE_STRIDE;
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
      const o = i * INSTANCE_STRIDE;
      minX = Math.min(minX, records[o]);
      maxX = Math.max(maxX, records[o]);
      minZ = Math.min(minZ, records[o + 2]);
      maxZ = Math.max(maxZ, records[o + 2]);
    }
    this.minX = minX;
    this.minZ = minZ;
    this.nx = Math.max(1, Math.ceil((maxX - minX + 1e-3) / TILE));
    this.nz = Math.max(1, Math.ceil((maxZ - minZ + 1e-3) / TILE));
    const tiles = this.nx * this.nz;
    const tileOf = new Int32Array(n);
    const counts = new Int32Array(tiles);
    const ySum = new Float64Array(tiles);
    for (let i = 0; i < n; i++) {
      const o = i * INSTANCE_STRIDE;
      const tx = Math.min(this.nx - 1, Math.floor((records[o] - minX) / TILE));
      const tz = Math.min(this.nz - 1, Math.floor((records[o + 2] - minZ) / TILE));
      const t = tz * this.nx + tx;
      tileOf[i] = t;
      counts[t]++;
      ySum[t] += records[o + 1];
    }
    this.ranges = new Int32Array(tiles * 2);
    this.tileY = new Float32Array(tiles);
    let start = 0;
    for (let t = 0; t < tiles; t++) {
      this.ranges[t * 2] = start;
      this.ranges[t * 2 + 1] = counts[t];
      this.tileY[t] = counts[t] ? ySum[t] / counts[t] : 0;
      start += counts[t];
    }
    // Instances in tile order, with their matrices and colours precomputed (and the extra attributes reordered).
    this.matrices = new Float32Array(n * 16);
    this.colours = new Float32Array(n * 3);
    const extraSrc = Object.entries(opt.attributes ?? {}).map(([name, a]) => ({ name, size: a.itemSize, from: a.data, to: new Float32Array(n * a.itemSize) }));
    const fill = new Int32Array(tiles);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < n; i++) {
      const o = i * INSTANCE_STRIDE;
      const t = tileOf[i];
      const k = this.ranges[t * 2] + fill[t]++;
      p.set(records[o], records[o + 1], records[o + 2]);
      q.setFromAxisAngle(up, records[o + 3]);
      s.set(records[o + 4], records[o + 5], records[o + 4]);
      m4.compose(p, q, s).toArray(this.matrices, k * 16);
      this.colours[k * 3] = records[o + 6];
      this.colours[k * 3 + 1] = records[o + 7];
      this.colours[k * 3 + 2] = records[o + 8];
      for (const e of extraSrc) {
        for (let c = 0; c < e.size; c++) {
          e.to[k * e.size + c] = e.from[i * e.size + c];
        }
      }
    }

    for (let part = 0; part < 2; part++) {
      // The two meshes share the vertex data; each needs its own per-instance attributes.
      let g = geometry;
      if (part === 1) {
        g = new THREE.BufferGeometry();
        for (const [name, attr] of Object.entries(geometry.attributes)) {
          g.setAttribute(name, attr);
        }
        g.setIndex(geometry.index);
        for (const group of geometry.groups) {
          g.addGroup(group.start, group.count, group.materialIndex);
        }
      }
      const extra = extraSrc.map((e) => {
        const attr = new THREE.InstancedBufferAttribute(new Float32Array(n * e.size), e.size);
        attr.setUsage(THREE.DynamicDrawUsage);
        g.setAttribute(e.name, attr);
        return { name: e.name, attr, src: e.to, size: e.size };
      });
      const mesh = new THREE.InstancedMesh(g, material, n);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.visible = false;
      mesh.name = name;
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      mesh.castShadow = part === 0 && opt.shadowRadius > 0;
      mesh.receiveShadow = opt.receiveShadow ?? true;
      mesh.layers.set(opt.layer ?? RenderLayers.NoReflection);
      group.add(mesh);
      this.meshes.push(mesh);
      this.parts.push({ mesh, extra, tiles: [] });
    }
  }

  /** Instances drawn now (debug). */
  get count(): number {
    return this.parts[0].mesh.count + this.parts[1].mesh.count;
  }

  /** Re-streams when the camera moved RESTREAM_STEP metres (or the preset changed). */
  update(camera: THREE.Vector3, preset: QualityPreset): void {
    const scale = LOD_RADIUS_SCALE[preset] ?? 1;
    if (scale === this.lastScale && Math.hypot(camera.x - this.last.x, camera.z - this.last.z) < RESTREAM_STEP && Math.abs(camera.y - this.last.y) < RESTREAM_STEP) {
      return;
    }
    this.last.copy(camera);
    this.lastScale = scale;
    const radius = this.opt.radius * scale;
    const shadow = this.opt.shadowRadius * scale;
    // The shadow ring only holds casters within `shadow` (plus a tile): cascades starting beyond it get none of them.
    const caster = this.parts[0].mesh;
    if (caster.castShadow && Number.isFinite(shadow)) {
      setShadowGate(caster, { below: shadow + TILE });
    }
    const near: number[] = [];
    const far: number[] = [];
    // A tile counts as inside when its nearest point is (tile half-diagonal of slack).
    const slack = TILE * 0.71;
    for (let tz = 0; tz < this.nz; tz++) {
      for (let tx = 0; tx < this.nx; tx++) {
        const t = tz * this.nx + tx;
        if (!this.ranges[t * 2 + 1]) {
          continue;
        }
        const cx = this.minX + (tx + 0.5) * TILE;
        const cz = this.minZ + (tz + 0.5) * TILE;
        const flat = Math.max(0, Math.hypot(cx - camera.x, cz - camera.z) - slack);
        const d = Math.hypot(flat, camera.y - this.tileY[t]);
        if (d > radius) {
          continue;
        }
        (d <= shadow ? near : far).push(t);
      }
    }
    this.stream(this.parts[0], near);
    this.stream(this.parts[1], far);
  }

  private stream(part: Part, tiles: number[]): void {
    if (tiles.length === part.tiles.length && tiles.every((v, i) => v === part.tiles[i])) {
      return;
    }
    part.tiles = tiles;
    const mesh = part.mesh;
    const dst = mesh.instanceMatrix.array as Float32Array;
    const dstC = mesh.instanceColor!.array as Float32Array;
    let n = 0;
    for (const t of tiles) {
      const start = this.ranges[t * 2];
      const count = this.ranges[t * 2 + 1];
      dst.set(this.matrices.subarray(start * 16, (start + count) * 16), n * 16);
      dstC.set(this.colours.subarray(start * 3, (start + count) * 3), n * 3);
      for (const e of part.extra) {
        (e.attr.array as Float32Array).set(e.src.subarray(start * e.size, (start + count) * e.size), n * e.size);
      }
      n += count;
    }
    mesh.count = n;
    mesh.visible = n > 0;
    if (!n) {
      return;
    }
    mesh.instanceMatrix.clearUpdateRanges();
    mesh.instanceMatrix.addUpdateRange(0, n * 16);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor!.clearUpdateRanges();
    mesh.instanceColor!.addUpdateRange(0, n * 3);
    mesh.instanceColor!.needsUpdate = true;
    for (const e of part.extra) {
      e.attr.clearUpdateRanges();
      e.attr.addUpdateRange(0, n * e.size);
      e.attr.needsUpdate = true;
    }
  }
}
