/**
 * Instantiates the planned pieces with the wall kit at every LOD and cuts the result into WALLS_TILE tiles: each
 * piece is built whole (continuous seeds, mitres and damage along it), then every triangle goes to the tile of its
 * centroid. LOD 0 colliders are collected with their `city-wall:<id>` sources.
 */
import { MeshBuilder, type MeshData } from '../../../../src/world/landmarks/heritage/build/mesh-builder';
import type { MeshArrays, MeshKind } from '../../../../src/world/landmarks/walls/data/baked';
import { WALLS_TILE } from '../../../../src/world/landmarks/walls/data/baked';
import { curtain, gate, seaFoundation, tower, type GroundFn, type KitCollider, type KitOut } from '../../../../src/world/landmarks/walls/kit/kit';
import type { Piece } from './plan';

export const LODS = 3;

interface Part {
  positions: Float32Array;
  normals: Int8Array;
  uvs: Float32Array;
  colors: Uint8Array;
  surf: Uint8Array;
  index: Uint32Array;
}

export interface TileBuild {
  i: number;
  j: number;
  /** Parts per LOD and kind. */
  parts: Record<MeshKind, Part[]>[];
  min: [number, number, number];
  max: [number, number, number];
}

export interface BuildResult {
  tiles: Map<string, TileBuild>;
  colliders: { c: KitCollider; src: number }[];
  ms: number[];
}

function tileOf(tiles: Map<string, TileBuild>, i: number, j: number): TileBuild {
  const k = `${i}_${j}`;
  let t = tiles.get(k);
  if (!t) {
    t = { i, j, parts: Array.from({ length: LODS }, () => ({ wall: [], leaf: [] })), min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    tiles.set(k, t);
  }
  return t;
}

/** Splits one finalized piece (origin 0, 0) by triangle centroid into tile-relative parts. */
function distribute(tiles: Map<string, TileBuild>, d: MeshData, lod: number, kind: MeshKind): void {
  const T = WALLS_TILE;
  const tri = d.index.length / 3;
  const keys = new Int32Array(tri * 2);
  const groups = new Map<string, number[]>();
  const P = d.positions;
  for (let t = 0; t < tri; t++) {
    const a = d.index[t * 3];
    const b = d.index[t * 3 + 1];
    const c = d.index[t * 3 + 2];
    const cx = (P[a * 3] + P[b * 3] + P[c * 3]) / 3;
    const cz = (P[a * 3 + 2] + P[b * 3 + 2] + P[c * 3 + 2]) / 3;
    const i = Math.floor(cx / T);
    const j = Math.floor(cz / T);
    keys[t * 2] = i;
    keys[t * 2 + 1] = j;
    const k = `${i}_${j}`;
    let g = groups.get(k);
    if (!g) {
      g = [];
      groups.set(k, g);
    }
    g.push(t);
  }
  const remap = new Int32Array(d.vertexCount).fill(-1);
  for (const list of groups.values()) {
    const i = keys[list[0] * 2];
    const j = keys[list[0] * 2 + 1];
    const tile = tileOf(tiles, i, j);
    const ox = i * T;
    const oz = j * T;
    const used: number[] = [];
    const index = new Uint32Array(list.length * 3);
    list.forEach((t, n) => {
      for (let q = 0; q < 3; q++) {
        const v = d.index[t * 3 + q];
        if (remap[v] < 0) {
          remap[v] = used.length;
          used.push(v);
        }
        index[n * 3 + q] = remap[v];
      }
    });
    const n = used.length;
    const part: Part = { positions: new Float32Array(n * 3), normals: new Int8Array(n * 3), uvs: new Float32Array(n * 2), colors: new Uint8Array(n * 4), surf: new Uint8Array(n * 4), index };
    used.forEach((v, k) => {
      const x = P[v * 3];
      const y = P[v * 3 + 1];
      const z = P[v * 3 + 2];
      part.positions[k * 3] = x - ox;
      part.positions[k * 3 + 1] = y;
      part.positions[k * 3 + 2] = z - oz;
      if (lod === 0) {
        tile.min[0] = Math.min(tile.min[0], x);
        tile.min[1] = Math.min(tile.min[1], y);
        tile.min[2] = Math.min(tile.min[2], z);
        tile.max[0] = Math.max(tile.max[0], x);
        tile.max[1] = Math.max(tile.max[1], y);
        tile.max[2] = Math.max(tile.max[2], z);
      }
      part.normals.set(d.normals.subarray(v * 3, v * 3 + 3), k * 3);
      part.uvs.set(d.uvs.subarray(v * 2, v * 2 + 2), k * 2);
      part.colors.set(d.colors.subarray(v * 4, v * 4 + 4), k * 4);
      part.surf.set(d.surf.subarray(v * 4, v * 4 + 4), k * 4);
    });
    for (const v of used) {
      remap[v] = -1;
    }
    tile.parts[lod][kind].push(part);
  }
}

function buildPiece(o: KitOut, piece: Piece, ground: GroundFn): void {
  switch (piece.kind) {
    case 'curtain':
      curtain(o, piece.pts, ground, piece.p);
      break;
    case 'tower':
      tower(o, piece.at, piece.dir, ground, piece.p);
      break;
    case 'gate':
      gate(o, piece.a, piece.b, ground, piece.p);
      break;
    case 'sea':
      seaFoundation(o, piece.pts, piece.p);
      break;
  }
}

export function buildPieces(pieces: readonly Piece[], ground: GroundFn, log: (msg: string) => void): BuildResult {
  const tiles = new Map<string, TileBuild>();
  const colliders: { c: KitCollider; src: number }[] = [];
  const ms: number[] = [];
  for (let lod = 0; lod < LODS; lod++) {
    const t0 = performance.now();
    pieces.forEach((piece, n) => {
      const mb = new MeshBuilder(0, 0);
      // Vegetation cards get their own mesh at LOD 0 (drawn without shadows); coarser LODs keep the few cards inline.
      const fb = lod === 0 ? new MeshBuilder(0, 0) : undefined;
      const cols: KitCollider[] = [];
      buildPiece({ mb, lod, colliders: lod === 0 ? cols : undefined, foliage: fb }, piece, ground);
      for (const c of cols) {
        colliders.push({ c, src: piece.src });
      }
      if (!mb.isEmpty()) {
        distribute(tiles, mb.finalize(ground), lod, 'wall');
      }
      if (fb && !fb.isEmpty()) {
        distribute(tiles, fb.finalize(ground), lod, 'leaf');
      }
      if (lod === 0 && n % 200 === 199) {
        log(`  lod0: ${n + 1}/${pieces.length} pieces`);
      }
    });
    ms.push(Math.round(performance.now() - t0));
  }
  return { tiles, colliders, ms };
}

/** Concatenates the parts of one tile, LOD and kind (index width by vertex count). */
export function mergeParts(parts: readonly Part[]): MeshArrays | null {
  if (!parts.length) {
    return null;
  }
  let nv = 0;
  let ni = 0;
  for (const p of parts) {
    nv += p.positions.length / 3;
    ni += p.index.length;
  }
  const out: MeshArrays = {
    positions: new Float32Array(nv * 3),
    normals: new Int8Array(nv * 3),
    uvs: new Float32Array(nv * 2),
    colors: new Uint8Array(nv * 4),
    surf: new Uint8Array(nv * 4),
    index: nv < 65536 ? new Uint16Array(ni) : new Uint32Array(ni),
  };
  let v0 = 0;
  let i0 = 0;
  for (const p of parts) {
    const n = p.positions.length / 3;
    out.positions.set(p.positions, v0 * 3);
    out.normals.set(p.normals, v0 * 3);
    out.uvs.set(p.uvs, v0 * 2);
    out.colors.set(p.colors, v0 * 4);
    out.surf.set(p.surf, v0 * 4);
    for (let k = 0; k < p.index.length; k++) {
      out.index[i0 + k] = p.index[k] + v0;
    }
    v0 += n;
    i0 += p.index.length;
  }
  return out;
}
