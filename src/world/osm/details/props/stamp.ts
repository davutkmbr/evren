/**
 * Stamps prop templates (props/models.ts) into one merged, vertex-coloured mesh in the worker: static furniture
 * costs a single draw call however many pieces the slice has.
 */
import type * as THREE from 'three';
import { MeshBuf } from '../../shared/buffers';
import type { MeshArrays } from '../../shared/protocol';
import { propTemplates, type PropKind } from './models';

interface Template {
  pos: Float32Array;
  nrm: Float32Array;
  col: Float32Array;
  glow: Float32Array;
  count: number;
}

function flatten(g: THREE.BufferGeometry): Template {
  const src = g.index ? g.toNonIndexed() : g;
  const count = src.getAttribute('position').count;
  return {
    pos: src.getAttribute('position').array as Float32Array,
    nrm: src.getAttribute('normal').array as Float32Array,
    col: src.getAttribute('color').array as Float32Array,
    glow: src.getAttribute('aGlow').array as Float32Array,
    count,
  };
}

export class PropStamper {
  private readonly templates: Record<PropKind, Template>;
  readonly mesh = new MeshBuf({ position: 3, normal: 3, color: 3, aGlow: 1 });
  readonly counts: Partial<Record<PropKind, number>> = {};

  constructor() {
    const t = propTemplates();
    this.templates = {} as Record<PropKind, Template>;
    for (const k of Object.keys(t) as PropKind[]) {
      this.templates[k] = flatten(t[k]);
    }
  }

  /**
   * Places one prop: base at (x, y, z), front (+Z) turned to yaw (world direction (sin yaw, cos yaw)), uniform
   * `scale` (vertical `sy` when given). White template vertices take `tint` (parasol canopies).
   */
  add(kind: PropKind, x: number, y: number, z: number, yaw: number, scale = 1, tint?: [number, number, number], sy = scale): void {
    const t = this.templates[kind];
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const m = this.mesh;
    for (let v = 0; v < t.count; v++) {
      const o = v * 3;
      const px = t.pos[o] * scale;
      const py = t.pos[o + 1] * sy;
      const pz = t.pos[o + 2] * scale;
      const nx = t.nrm[o];
      const ny = t.nrm[o + 1];
      const nz = t.nrm[o + 2];
      let r = t.col[o];
      let g = t.col[o + 1];
      let b = t.col[o + 2];
      if (tint && r > 0.99 && g > 0.99 && b > 0.99) {
        [r, g, b] = tint;
      }
      m.vertex(x + px * c + pz * s, y + py, z - px * s + pz * c, nx * c + nz * s, ny, -nx * s + nz * c, r, g, b, t.glow[v]);
    }
    const base = m.count - t.count;
    for (let v = 0; v < t.count; v += 3) {
      m.tri(base + v, base + v + 1, base + v + 2);
    }
    this.counts[kind] = (this.counts[kind] ?? 0) + 1;
  }

  take(): MeshArrays | null {
    return this.mesh.count ? this.mesh.take('color') : null;
  }
}
