import type { V3 } from './vec3';

/** Flat vertex streams of one tree LOD (see render/tree-material.ts for the attribute meaning). */
export interface TreeMeshData {
  position: Float32Array;
  normal: Float32Array;
  /** u, v, texture array layer. */
  tex: Float32Array;
  /** trunk bend weight, branch sway weight, leaf flutter weight, phase [0, 1). */
  wind: Float32Array;
  /** Offset from the vertex to its card centre (xyz) and billboard factor (w). Zero for bark. */
  card: Float32Array;
  /** Billboard corner (x, y) in metres and ambient occlusion (z). */
  corner: Float32Array;
  index: Uint32Array;
}

export interface VertexAttribs {
  u: number;
  v: number;
  layer: number;
  windTrunk: number;
  windBranch: number;
  windLeaf: number;
  phase: number;
  ao: number;
}

export class MeshBuilder {
  private pos: number[] = [];
  private nrm: number[] = [];
  private tex: number[] = [];
  private wind: number[] = [];
  private card: number[] = [];
  private corner: number[] = [];
  private idx: number[] = [];

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  get triangleCount(): number {
    return this.idx.length / 3;
  }

  /** Adds a bark/solid vertex. */
  vertex(p: V3, n: V3, a: VertexAttribs): number {
    return this.cardVertex(p, n, a, 0, 0, 0, 0, 0, 0);
  }

  /** Adds a vertex with billboard data (cx, cy = corner in metres; ox..oz = offset to the card centre). */
  cardVertex(p: V3, n: V3, a: VertexAttribs, ox: number, oy: number, oz: number, billboard: number, cx: number, cy: number): number {
    const i = this.pos.length / 3;
    this.pos.push(p.x, p.y, p.z);
    this.nrm.push(n.x, n.y, n.z);
    this.tex.push(a.u, a.v, a.layer);
    this.wind.push(a.windTrunk, a.windBranch, a.windLeaf, a.phase);
    this.card.push(ox, oy, oz, billboard);
    this.corner.push(cx, cy, a.ao);
    return i;
  }

  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }

  quad(a: number, b: number, c: number, d: number): void {
    this.idx.push(a, b, c, a, c, d);
  }

  /** Minimum and maximum vertex y and the largest horizontal radius. */
  bounds(): { minY: number; maxY: number; radiusXZ: number } {
    let minY = Infinity;
    let maxY = -Infinity;
    let r2 = 0;
    const p = this.pos;
    for (let i = 0; i < p.length; i += 3) {
      minY = Math.min(minY, p[i + 1]);
      maxY = Math.max(maxY, p[i + 1]);
      r2 = Math.max(r2, p[i] * p[i] + p[i + 2] * p[i + 2]);
    }
    return { minY, maxY, radiusXZ: Math.sqrt(r2) };
  }

  /** Largest distance from (0, cy, 0) including billboard reach. */
  radiusAround(cy: number): number {
    let r2 = 0;
    const p = this.pos;
    const c = this.corner;
    const k = this.card;
    for (let i = 0, j = 0, q = 0; i < p.length; i += 3, j += 3, q += 4) {
      const reach = Math.hypot(c[j], c[j + 1]) * k[q + 3];
      const dx = p[i] + k[q];
      const dy = p[i + 1] + k[q + 1] - cy;
      const dz = p[i + 2] + k[q + 2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) + reach;
      const d0 = Math.sqrt(p[i] * p[i] + (p[i + 1] - cy) ** 2 + p[i + 2] * p[i + 2]);
      r2 = Math.max(r2, d * d, d0 * d0);
    }
    return Math.sqrt(r2);
  }

  build(): TreeMeshData {
    return {
      position: new Float32Array(this.pos),
      normal: new Float32Array(this.nrm),
      tex: new Float32Array(this.tex),
      wind: new Float32Array(this.wind),
      card: new Float32Array(this.card),
      corner: new Float32Array(this.corner),
      index: new Uint32Array(this.idx),
    };
  }
}

export function transferablesOf(m: TreeMeshData): ArrayBuffer[] {
  return [m.position, m.normal, m.tex, m.wind, m.card, m.corner, m.index].map((a) => a.buffer as ArrayBuffer);
}
