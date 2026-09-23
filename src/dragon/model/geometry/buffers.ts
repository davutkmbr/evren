import * as THREE from 'three';

/** Growable Float32 buffer (avoids number[] boxing for large meshes). */
export class FloatBuffer {
  data: Float32Array;
  length = 0;

  constructor(initial = 1024) {
    this.data = new Float32Array(initial);
  }

  private grow(min: number): void {
    let cap = this.data.length * 2;
    while (cap < min) {
      cap *= 2;
    }
    const next = new Float32Array(cap);
    next.set(this.data.subarray(0, this.length));
    this.data = next;
  }

  push2(a: number, b: number): void {
    if (this.length + 2 > this.data.length) {
      this.grow(this.length + 2);
    }
    this.data[this.length++] = a;
    this.data[this.length++] = b;
  }

  push3(a: number, b: number, c: number): void {
    if (this.length + 3 > this.data.length) {
      this.grow(this.length + 3);
    }
    this.data[this.length++] = a;
    this.data[this.length++] = b;
    this.data[this.length++] = c;
  }

  push4(a: number, b: number, c: number, d: number): void {
    if (this.length + 4 > this.data.length) {
      this.grow(this.length + 4);
    }
    this.data[this.length++] = a;
    this.data[this.length++] = b;
    this.data[this.length++] = c;
    this.data[this.length++] = d;
  }

  toArray(): Float32Array {
    return this.data.slice(0, this.length);
  }
}

export class IndexBuffer {
  data: Uint32Array;
  length = 0;

  constructor(initial = 4096) {
    this.data = new Uint32Array(initial);
  }

  push3(a: number, b: number, c: number): void {
    if (this.length + 3 > this.data.length) {
      const next = new Uint32Array(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    this.data[this.length++] = a;
    this.data[this.length++] = b;
    this.data[this.length++] = c;
  }
}

/** Accumulates (bone, weight) influences and resolves the normalized top 4. */
export class SkinAccumulator {
  readonly bones: number[] = [];
  readonly weights: number[] = [];

  clear(): this {
    this.bones.length = 0;
    this.weights.length = 0;
    return this;
  }

  add(bone: number, weight: number): this {
    if (weight <= 1e-5) {
      return this;
    }
    const i = this.bones.indexOf(bone);
    if (i >= 0) {
      this.weights[i] += weight;
    } else {
      this.bones.push(bone);
      this.weights.push(weight);
    }
    return this;
  }

  /** Adds every influence of `other`, scaled. */
  addScaled(other: SkinAccumulator, scale: number): this {
    for (let i = 0; i < other.bones.length; i++) {
      this.add(other.bones[i], other.weights[i] * scale);
    }
    return this;
  }

  copy(other: SkinAccumulator): this {
    this.clear();
    return this.addScaled(other, 1);
  }

  /** Writes the top-4 normalized influences into the given arrays. */
  resolve(outIndex: number[], outWeight: number[]): void {
    const n = this.bones.length;
    const order: number[] = [];
    for (let i = 0; i < n; i++) {
      order.push(i);
    }
    order.sort((a, b) => this.weights[b] - this.weights[a]);
    let sum = 0;
    for (let k = 0; k < Math.min(4, n); k++) {
      sum += this.weights[order[k]];
    }
    for (let k = 0; k < 4; k++) {
      if (k < n && sum > 0) {
        outIndex[k] = this.bones[order[k]];
        outWeight[k] = this.weights[order[k]] / sum;
      } else {
        outIndex[k] = n > 0 ? this.bones[order[0]] : 0;
        outWeight[k] = k === 0 && (n === 0 || sum <= 0) ? 1 : 0;
      }
    }
  }
}

export interface VertexInput {
  position: THREE.Vector3;
  normal: THREE.Vector3;
  uv?: THREE.Vector2;
  /** xyz tangent + handedness w. */
  tangent?: THREE.Vector4;
  color?: THREE.Color;
  skin: SkinAccumulator;
  /** Custom per-vertex data (material id, param, mask, extra). */
  data?: THREE.Vector4;
  /** Optional extra vec3 (e.g. cloak drape offset); emitted as `aExtra` when any vertex sets it. */
  extra?: THREE.Vector3;
}

const tmpIdx = [0, 0, 0, 0];
const tmpW = [0, 0, 0, 0];

/**
 * Accumulates a skinned mesh with a fixed attribute layout:
 * position, normal, uv, tangent, color, skinIndex, skinWeight, aData (vec4).
 */
export class MeshBuilder {
  readonly positions = new FloatBuffer(8192);
  readonly normals = new FloatBuffer(8192);
  readonly uvs = new FloatBuffer(8192);
  readonly tangents = new FloatBuffer(8192);
  readonly colors = new FloatBuffer(8192);
  readonly skinIndex = new FloatBuffer(8192);
  readonly skinWeight = new FloatBuffer(8192);
  readonly data = new FloatBuffer(8192);
  readonly extra = new FloatBuffer(1024);
  private hasExtra = false;
  readonly indices = new IndexBuffer(16384);

  get vertexCount(): number {
    return this.positions.length / 3;
  }

  get triangleCount(): number {
    return this.indices.length / 3;
  }

  addVertex(v: VertexInput): number {
    const index = this.vertexCount;
    this.positions.push3(v.position.x, v.position.y, v.position.z);
    this.normals.push3(v.normal.x, v.normal.y, v.normal.z);
    if (v.uv) {
      this.uvs.push2(v.uv.x, v.uv.y);
    } else {
      this.uvs.push2(0, 0);
    }
    if (v.tangent) {
      this.tangents.push4(v.tangent.x, v.tangent.y, v.tangent.z, v.tangent.w);
    } else {
      this.tangents.push4(1, 0, 0, 1);
    }
    if (v.color) {
      this.colors.push3(v.color.r, v.color.g, v.color.b);
    } else {
      this.colors.push3(1, 1, 1);
    }
    v.skin.resolve(tmpIdx, tmpW);
    this.skinIndex.push4(tmpIdx[0], tmpIdx[1], tmpIdx[2], tmpIdx[3]);
    this.skinWeight.push4(tmpW[0], tmpW[1], tmpW[2], tmpW[3]);
    if (v.data) {
      this.data.push4(v.data.x, v.data.y, v.data.z, v.data.w);
    } else {
      this.data.push4(0, 0, 0, 0);
    }
    if (v.extra) {
      this.hasExtra = true;
      this.extra.push3(v.extra.x, v.extra.y, v.extra.z);
    } else {
      this.extra.push3(0, 0, 0);
    }
    return index;
  }

  addTriangle(a: number, b: number, c: number): void {
    this.indices.push3(a, b, c);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.positions.toArray(), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.normals.toArray(), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uvs.toArray(), 2));
    g.setAttribute('tangent', new THREE.BufferAttribute(this.tangents.toArray(), 4));
    g.setAttribute('color', new THREE.BufferAttribute(this.colors.toArray(), 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(Uint16Array.from(this.skinIndex.toArray()), 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(this.skinWeight.toArray(), 4));
    g.setAttribute('aData', new THREE.BufferAttribute(this.data.toArray(), 4));
    if (this.hasExtra) {
      g.setAttribute('aExtra', new THREE.BufferAttribute(this.extra.toArray(), 3));
    }
    const count = this.vertexCount;
    const idx = this.indices.data.slice(0, this.indices.length);
    g.setIndex(new THREE.BufferAttribute(count > 65535 ? idx : Uint16Array.from(idx), 1));
    return g;
  }
}
