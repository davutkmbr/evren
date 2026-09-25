/**
 * Near / far drawing of a worker mesh with a simplified far version (shared/mesh-tiles.ts lodTileIndex). Every leaf
 * of the quadtree (~260 x 320 m over the slice) is near or far by the camera's distance to its bounds; near leaves
 * draw the full mesh one draw call each, far leaves draw the far version merged per quadtree node (a whole quarter of
 * the slice in one call when none of its leaves is near). All draws share one set of GPU buffers (draw ranges).
 *
 * Shadows: near leaves cast the full mesh only into cascades that start within the switch distance and their far
 * version into the cascades beyond (shadow-only stand-ins); far leaves cast their far version everywhere. Reflection:
 * optionally the far version of the whole mesh in one draw call (the mirror image is blurred and distorted anyway).
 */
import * as THREE from 'three';
import { RenderLayers } from '../../../core/contracts';
import type { QualityPreset } from '../../../core/quality';
import { setShadowGate } from '../../../core/shadow-gate';
import { LOD_RADIUS_SCALE } from './instance-lod';
import { LOD_LEAF_STRIDE } from './mesh-tiles';
import type { MeshArrays } from './protocol';
import { toGeometry } from './three';

export interface LodTiledOptions {
  /** Near -> far switch distance (m) at the "high" preset, scaled with LOD_RADIUS_SCALE. */
  distance: number;
  castShadow?: boolean;
  receiveShadow?: boolean;
  /** Draw the far version into the water reflection (default: nothing reflected). */
  reflection?: boolean;
  /**
   * Near leaves cast shadows only into cascades that start within this distance (m at "high"; default `distance`).
   * Meshes without a far version (all triangles Near) use it to keep small casters out of the far cascades.
   */
  shadowDistance?: number;
  /** Quadtree depth the worker used (leaves = 4^levels). */
  levels?: number;
}

/** Relative hysteresis of the near / far switch. */
const HYSTERESIS = 0.06;
/** Merged far draws stop at this quadtree level (1 = quarters of the slice): bigger merges would defeat culling. */
const MIN_MERGE_LEVEL = 1;

interface Node {
  level: number;
  /** First leaf and leaf count (Morton order). */
  leaf0: number;
  leaves: number;
  far: THREE.Mesh | null;
  children: Node[];
}

const _box = new THREE.Box3();

export class LodTiledMesh {
  private readonly near: (THREE.Mesh | null)[] = [];
  private readonly shadowProxy: (THREE.Mesh | null)[] = [];
  private readonly isNear: Uint8Array;
  private readonly bounds: THREE.Box3[] = [];
  private readonly root: Node;
  private readonly shared: THREE.BufferGeometry;
  private readonly reflection: THREE.Mesh | null = null;
  private readonly nearGate = { below: 0 };
  private readonly proxyGate = { from: 0 };
  private enabled = true;
  /** Switch distance in use (m). */
  distance = 0;

  constructor(
    private readonly group: THREE.Object3D,
    readonly name: string,
    arrays: MeshArrays,
    private readonly leaves: Float64Array,
    private readonly material: THREE.Material,
    private readonly opt: LodTiledOptions,
  ) {
    const levels = opt.levels ?? 3;
    const count = leaves.length / LOD_LEAF_STRIDE;
    this.isNear = new Uint8Array(count);
    this.shared = toGeometry(arrays);
    this.shared.boundingSphere = null;
    const castShadow = opt.castShadow ?? false;
    for (let k = 0; k < count; k++) {
      const o = k * LOD_LEAF_STRIDE;
      const b = leaves[o + 1] + leaves[o + 3] > 0 ? new THREE.Box3(new THREE.Vector3(leaves[o + 4], leaves[o + 5], leaves[o + 6]), new THREE.Vector3(leaves[o + 7], leaves[o + 8], leaves[o + 9])) : new THREE.Box3();
      this.bounds.push(b);
      const near = this.mesh(`${name}-near`, leaves[o], leaves[o + 1], b, RenderLayers.NoReflection, castShadow);
      this.near.push(near);
      let proxy: THREE.Mesh | null = null;
      if (castShadow && near) {
        proxy = this.mesh(`${name}-shadow`, leaves[o + 2], leaves[o + 3], b, RenderLayers.ShadowOnly, true);
      }
      this.shadowProxy.push(proxy);
    }
    this.root = this.node(0, 0, count, levels);
    if (opt.reflection) {
      const first = leaves[2];
      const last = (count - 1) * LOD_LEAF_STRIDE;
      const all = new THREE.Box3();
      for (const b of this.bounds) {
        all.union(b);
      }
      this.reflection = this.mesh(`${name}-reflection`, first, leaves[last + 2] + leaves[last + 3] - first, all, RenderLayers.ReflectionOnly, false);
    }
  }

  /** Builds the quadtree node over leaves [leaf0, leaf0 + leaves) with its merged far draw. */
  private node(level: number, leaf0: number, leaves: number, levels: number): Node {
    const children: Node[] = [];
    if (level < levels) {
      const q = leaves / 4;
      for (let c = 0; c < 4; c++) {
        children.push(this.node(level + 1, leaf0 + c * q, q, levels));
      }
    }
    let far: THREE.Mesh | null = null;
    if (level >= MIN_MERGE_LEVEL) {
      const o0 = leaf0 * LOD_LEAF_STRIDE;
      const o1 = (leaf0 + leaves - 1) * LOD_LEAF_STRIDE;
      const start = this.leaves[o0 + 2];
      const end = this.leaves[o1 + 2] + this.leaves[o1 + 3];
      _box.makeEmpty();
      for (let k = leaf0; k < leaf0 + leaves; k++) {
        if (this.leaves[k * LOD_LEAF_STRIDE + 3] > 0) {
          _box.union(this.bounds[k]);
        }
      }
      far = this.mesh(`${this.name}-far`, start, end - start, _box.clone(), RenderLayers.NoReflection, this.opt.castShadow ?? false);
    }
    return { level, leaf0, leaves, far, children };
  }

  private mesh(name: string, start: number, count: number, bounds: THREE.Box3, layer: number, castShadow: boolean): THREE.Mesh | null {
    if (count <= 0 || bounds.isEmpty()) {
      return null;
    }
    const g = new THREE.BufferGeometry();
    for (const [attrName, attr] of Object.entries(this.shared.attributes)) {
      g.setAttribute(attrName, attr);
    }
    g.setIndex(this.shared.index);
    g.setDrawRange(start, count);
    g.boundingSphere = bounds.getBoundingSphere(new THREE.Sphere());
    g.boundingBox = bounds.clone();
    const mesh = new THREE.Mesh(g, this.material);
    mesh.name = name;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = this.opt.receiveShadow ?? true;
    mesh.matrixAutoUpdate = false;
    mesh.visible = false;
    mesh.layers.set(layer);
    this.group.add(mesh);
    return mesh;
  }

  /** Turns the shadows of the near leaves on or off (they were created casting). */
  setCastShadow(on: boolean): void {
    if (!this.opt.castShadow) {
      return;
    }
    for (const m of this.near) {
      if (m) {
        m.castShadow = on;
      }
    }
  }

  /** false draws the full mesh everywhere (A/B comparisons). */
  setEnabled(on: boolean): void {
    this.enabled = on;
  }

  update(camera: THREE.Vector3, preset: QualityPreset): void {
    const scale = LOD_RADIUS_SCALE[preset] ?? 1;
    const d = this.opt.distance * scale;
    this.distance = d;
    this.nearGate.below = this.opt.shadowDistance !== undefined ? this.opt.shadowDistance * scale : d;
    this.proxyGate.from = d;
    const gate = this.enabled ? this.nearGate : null;
    if (this.reflection) {
      this.reflection.visible = this.enabled;
    }
    for (let k = 0; k < this.near.length; k++) {
      const near = this.near[k];
      if (!near) {
        this.isNear[k] = 0;
        continue;
      }
      const dist = this.enabled ? this.bounds[k].distanceToPoint(camera) : 0;
      const was = this.isNear[k] === 1;
      const isNear = was ? dist < d * (1 + HYSTERESIS) : dist < d * (1 - HYSTERESIS);
      this.isNear[k] = isNear ? 1 : 0;
      near.visible = isNear;
      near.layers.set(this.enabled || !this.reflection ? RenderLayers.NoReflection : RenderLayers.Default);
      if (near.castShadow) {
        setShadowGate(near, gate);
      }
      const proxy = this.shadowProxy[k];
      if (proxy) {
        proxy.visible = isNear && this.enabled;
        setShadowGate(proxy, this.proxyGate);
      }
    }
    this.place(this.root);
  }

  /** Shows the far draw of `n` when none of its leaves is near, else recurses; returns the near leaf count. */
  private place(n: Node): number {
    let nearLeaves = 0;
    if (n.children.length) {
      for (const c of n.children) {
        nearLeaves += this.countNear(c);
      }
    } else {
      nearLeaves = this.isNear[n.leaf0];
    }
    const merged = nearLeaves === 0 && n.far !== null;
    if (n.far) {
      n.far.visible = merged;
    }
    if (!merged) {
      for (const c of n.children) {
        this.place(c);
      }
    } else {
      this.hide(n.children);
    }
    return nearLeaves;
  }

  private countNear(n: Node): number {
    let c = 0;
    for (let k = n.leaf0; k < n.leaf0 + n.leaves; k++) {
      c += this.isNear[k];
    }
    return c;
  }

  private hide(nodes: Node[]): void {
    for (const n of nodes) {
      if (n.far) {
        n.far.visible = false;
      }
      this.hide(n.children);
    }
  }

  /** Near leaves and visible far draws (debug). */
  counts(): { near: number; far: number; distance: number } {
    let far = 0;
    const walk = (n: Node): void => {
      if (n.far?.visible) {
        far++;
      }
      n.children.forEach(walk);
    };
    walk(this.root);
    return { near: this.isNear.reduce((a, b) => a + b, 0), far, distance: Math.round(this.distance) };
  }
}
