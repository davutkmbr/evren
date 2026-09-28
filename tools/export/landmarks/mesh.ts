/**
 * Mesh accumulation and plain-float glTF output for the landmark export (tools/export/landmarks.ts).
 *
 * A landmark mesh is a set of primitives, one per material id (the glTF material name, which the Unreal importer maps
 * to its material instance). Vertices are re-centred on the landmark origin; attributes are POSITION, NORMAL,
 * TEXCOORD_0 (metres, the material's tiling divides them) and COLOR_0 (linear tint x ambient occlusion, normalized
 * uint8). No quantization or meshopt: Interchange reads plain glTF only.
 */
import { Document, NodeIO } from '@gltf-transform/core';

export interface Primitive {
  pos: number[];
  nrm: number[];
  uv: number[];
  col: number[];
  idx: number[];
}

/** A source vertex: world position (m), normal, uv (m), linear colour (tint x AO). */
export interface Vertex {
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  u: number;
  v: number;
  r: number;
  g: number;
  b: number;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const r2 = (v: number): number => Math.round(v * 100) / 100;

export class LandmarkMesh {
  readonly prims = new Map<string, Primitive>();
  /** Per material: source vertex index -> output index, for the current source geometry. */
  private remap = new Map<string, Int32Array>();
  private sourceSize = 0;
  private readonly scratch: Vertex = { x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, u: 0, v: 0, r: 1, g: 1, b: 1 };

  constructor(
    readonly key: string,
    /** Origin subtracted from every position (web metres). */
    readonly origin: [number, number, number],
  ) {}

  /** Starts a new indexed source geometry of `vertices` vertices (triangle() indices refer to it). */
  beginSource(vertices: number): void {
    this.remap = new Map();
    this.sourceSize = vertices;
  }

  private prim(material: string): Primitive {
    let p = this.prims.get(material);
    if (!p) {
      p = { pos: [], nrm: [], uv: [], col: [], idx: [] };
      this.prims.set(material, p);
    }
    return p;
  }

  /**
   * Adds a triangle of the current source: `a, b, c` are source vertex indices; `read` fills a vertex from its source
   * index (called once per source vertex and material).
   */
  triangle(material: string, a: number, b: number, c: number, read: (i: number, out: Vertex) => void): void {
    const p = this.prim(material);
    let map = this.remap.get(material);
    if (!map) {
      map = new Int32Array(this.sourceSize).fill(-1);
      this.remap.set(material, map);
    }
    for (const i of [a, b, c]) {
      let o = map[i];
      if (o < 0) {
        read(i, this.scratch);
        o = p.pos.length / 3;
        map[i] = o;
        this.pushVertex(p, this.scratch);
      }
      p.idx.push(o);
    }
  }

  /** Adds an indexed patch of explicit vertices. */
  patch(material: string, verts: readonly Vertex[], index: readonly number[]): void {
    const p = this.prim(material);
    const base = p.pos.length / 3;
    for (const x of verts) {
      this.pushVertex(p, x);
    }
    for (const i of index) {
      p.idx.push(base + i);
    }
  }

  private pushVertex(p: Primitive, v: Vertex): void {
    p.pos.push(v.x - this.origin[0], v.y - this.origin[1], v.z - this.origin[2]);
    const l = Math.hypot(v.nx, v.ny, v.nz);
    // Degenerate normals (collapsed lathe poles) point up.
    if (l > 1e-6) p.nrm.push(v.nx / l, v.ny / l, v.nz / l);
    else p.nrm.push(0, 1, 0);
    p.uv.push(v.u, v.v);
    p.col.push(Math.round(clamp01(v.r) * 255), Math.round(clamp01(v.g) * 255), Math.round(clamp01(v.b) * 255), 255);
  }

  triangles(): number {
    let n = 0;
    for (const p of this.prims.values()) {
      n += p.idx.length / 3;
    }
    return n;
  }

  /** Local bounds [min, max] (metres, relative to the origin). */
  bounds(): [[number, number, number], [number, number, number]] {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const p of this.prims.values()) {
      for (let i = 0; i < p.pos.length; i += 3) {
        for (let k = 0; k < 3; k++) {
          const v = p.pos[i + k];
          if (v < min[k]) min[k] = v;
          if (v > max[k]) max[k] = v;
        }
      }
    }
    return [min.map(r2) as [number, number, number], max.map(r2) as [number, number, number]];
  }

  /** Binary glTF: one node, one mesh, a primitive per material (sorted by id for stable bytes). */
  async glb(): Promise<Uint8Array> {
    const doc = new Document();
    const buffer = doc.createBuffer();
    const mesh = doc.createMesh(this.key);
    const acc = (type: 'VEC2' | 'VEC3' | 'VEC4' | 'SCALAR', array: Float32Array | Uint8Array | Uint32Array | Uint16Array) =>
      doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
    for (const id of [...this.prims.keys()].sort()) {
      const p = this.prims.get(id)!;
      if (!p.idx.length) {
        continue;
      }
      const n = p.pos.length / 3;
      const prim = doc
        .createPrimitive()
        .setAttribute('POSITION', acc('VEC3', new Float32Array(p.pos)))
        .setAttribute('NORMAL', acc('VEC3', new Float32Array(p.nrm)))
        .setAttribute('TEXCOORD_0', acc('VEC2', new Float32Array(p.uv)))
        .setAttribute('COLOR_0', acc('VEC4', new Uint8Array(p.col)).setNormalized(true))
        .setIndices(acc('SCALAR', n < 65536 ? new Uint16Array(p.idx) : new Uint32Array(p.idx)))
        .setMaterial(doc.createMaterial(id));
      mesh.addPrimitive(prim);
    }
    doc.createScene(this.key).addChild(doc.createNode(this.key).setMesh(mesh));
    return new NodeIO().writeBinary(doc);
  }
}

/**
 * An open tube of `sides` sides from a to b: the structures' cables, hangers and stays, which the web draws as
 * camera-facing ribbons, as real geometry.
 */
export function tube(mesh: LandmarkMesh, material: string, a: readonly number[], b: readonly number[], radius: number, rgb: readonly number[], sides = 6): void {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-4 || radius <= 0) {
    return;
  }
  const ax = dx / len;
  const ay = dy / len;
  const az = dz / len;
  const [hx, hy, hz] = Math.abs(ay) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let px = hy * az - hz * ay;
  let py = hz * ax - hx * az;
  let pz = hx * ay - hy * ax;
  const pl = Math.hypot(px, py, pz);
  px /= pl;
  py /= pl;
  pz /= pl;
  const qx = ay * pz - az * py;
  const qy = az * px - ax * pz;
  const qz = ax * py - ay * px;
  const verts: Vertex[] = [];
  const index: number[] = [];
  for (let s = 0; s <= sides; s++) {
    const t = (s / sides) * Math.PI * 2;
    const nx = px * Math.cos(t) + qx * Math.sin(t);
    const ny = py * Math.cos(t) + qy * Math.sin(t);
    const nz = pz * Math.cos(t) + qz * Math.sin(t);
    const u = t * radius;
    verts.push({ x: a[0] + nx * radius, y: a[1] + ny * radius, z: a[2] + nz * radius, nx, ny, nz, u, v: 0, r: rgb[0], g: rgb[1], b: rgb[2] });
    verts.push({ x: b[0] + nx * radius, y: b[1] + ny * radius, z: b[2] + nz * radius, nx, ny, nz, u, v: len, r: rgb[0], g: rgb[1], b: rgb[2] });
  }
  for (let s = 0; s < sides; s++) {
    const i = s * 2;
    index.push(i, i + 2, i + 1, i + 1, i + 2, i + 3);
  }
  mesh.patch(material, verts, index);
}
