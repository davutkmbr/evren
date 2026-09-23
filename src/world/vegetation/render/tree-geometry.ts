import * as THREE from 'three';
import type { TreeMeshData } from '../gen/mesh-builder';
import { INSTANCE_STRIDE } from '../species';

/** Shared (non-instanced) vertex streams of one tree LOD. Every pool that draws this LOD references them. */
export interface TreeLodSource {
  index: THREE.BufferAttribute;
  attributes: Record<string, THREE.BufferAttribute>;
  triangles: number;
  vertices: number;
}

export function createLodSource(mesh: TreeMeshData): TreeLodSource {
  const vertices = mesh.position.length / 3;
  return {
    index: new THREE.BufferAttribute(mesh.index, 1),
    attributes: {
      position: new THREE.BufferAttribute(mesh.position, 3),
      normal: new THREE.BufferAttribute(mesh.normal, 3),
      aTex: new THREE.BufferAttribute(mesh.tex, 3),
      aWind: new THREE.BufferAttribute(mesh.wind, 4),
      aCard: new THREE.BufferAttribute(mesh.card, 4),
      aCorner: new THREE.BufferAttribute(mesh.corner, 3),
    },
    triangles: mesh.index.length / 3,
    vertices,
  };
}

/**
 * A growable, dynamically updated instance stream (float32, INSTANCE_STRIDE per instance) exposed as aInst0 / aInst1.
 * Several geometries may share one stream.
 */
export class InstanceStream {
  buffer: THREE.InstancedInterleavedBuffer;
  private inst0: THREE.InterleavedBufferAttribute;
  private inst1: THREE.InterleavedBufferAttribute;
  private readonly users: THREE.InstancedBufferGeometry[] = [];

  constructor(capacity: number, usage: THREE.Usage = THREE.DynamicDrawUsage) {
    this.buffer = new THREE.InstancedInterleavedBuffer(new Float32Array(Math.max(1, capacity) * INSTANCE_STRIDE), INSTANCE_STRIDE, 1);
    this.buffer.setUsage(usage);
    this.inst0 = new THREE.InterleavedBufferAttribute(this.buffer, 4, 0);
    this.inst1 = new THREE.InterleavedBufferAttribute(this.buffer, 4, 4);
  }

  get capacity(): number {
    return this.buffer.count;
  }

  get array(): Float32Array {
    return this.buffer.array as Float32Array;
  }

  attach(geometry: THREE.InstancedBufferGeometry): void {
    geometry.setAttribute('aInst0', this.inst0);
    geometry.setAttribute('aInst1', this.inst1);
    this.users.push(geometry);
  }

  /** Makes room for `count` instances (keeps the content). Reallocation re-uploads the whole buffer. */
  reserve(count: number): boolean {
    if (count <= this.capacity) {
      return false;
    }
    let cap = this.capacity;
    while (cap < count) {
      cap = Math.ceil(cap * 1.5) + 64;
    }
    const next = new Float32Array(cap * INSTANCE_STRIDE);
    next.set(this.array);
    const usage = this.buffer.usage;
    this.buffer = new THREE.InstancedInterleavedBuffer(next, INSTANCE_STRIDE, 1);
    this.buffer.setUsage(usage);
    this.inst0 = new THREE.InterleavedBufferAttribute(this.buffer, 4, 0);
    this.inst1 = new THREE.InterleavedBufferAttribute(this.buffer, 4, 4);
    for (const g of this.users) {
      g.setAttribute('aInst0', this.inst0);
      g.setAttribute('aInst1', this.inst1);
    }
    return true;
  }

  /** Marks [start, start + count) instances for upload. */
  markRange(start: number, count: number): void {
    if (count <= 0) {
      return;
    }
    this.buffer.addUpdateRange(start * INSTANCE_STRIDE, count * INSTANCE_STRIDE);
    this.buffer.needsUpdate = true;
  }

  dispose(): void {
    this.users.length = 0;
  }
}

/** Instanced geometry drawing `source` for every instance of `stream`. */
export function createPoolGeometry(source: TreeLodSource | { index: THREE.BufferAttribute; attributes: Record<string, THREE.BufferAttribute> }, stream: InstanceStream): THREE.InstancedBufferGeometry {
  const g = new THREE.InstancedBufferGeometry();
  g.setIndex(source.index);
  for (const [name, attr] of Object.entries(source.attributes)) {
    g.setAttribute(name, attr);
  }
  stream.attach(g);
  g.instanceCount = 0;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
  g.boundingBox = new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
  return g;
}

/** Unit quad used by impostors (corner in [-1, 1]²). */
export function createQuadSource(): { index: THREE.BufferAttribute; attributes: Record<string, THREE.BufferAttribute> } {
  return {
    index: new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1),
    attributes: {
      position: new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3),
    },
  };
}
