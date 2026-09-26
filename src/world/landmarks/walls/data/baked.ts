/**
 * Baked city walls (tools/world-compiler/src/walls, `npm run compile:walls`, output public/world/walls/, gitignored):
 * the wall kit instantiated along data/osm/walls.json, cut into 100 m tiles per LOD. Read by the walls system
 * (../system). Positions are relative to the tile's corner (i * tileSize, 0, j * tileSize).
 *
 * Files:
 * - index.json (WallsIndex, plain JSON: the OSM layer reads `owned` before it builds its buildings);
 * - colliders.json (WallsColliders);
 * - lod0/<i>_<j>.bin.gz: one tile at LOD 0 (wall mesh + foliage mesh), streamed near the camera;
 * - lod1/<ci>_<cj>.bin.gz: every tile of one CELL_TILES x CELL_TILES cell at LOD 1;
 * - lod2.bin.gz: every tile at LOD 2.
 * Mesh files are a container: 'WLB1', u32 header length, JSON header (MeshRecord list), padded to 4 bytes, then the
 * attribute blobs (heritage vertex format, MeshBuilder MeshData) at the recorded byte offsets.
 */

export const WALLS_FORMAT = 1;
export const WALLS_TILE = 100;
/** LOD 1 files group CELL_TILES x CELL_TILES tiles. */
export const CELL_TILES = 10;
const MAGIC = 0x31424c57; // 'WLB1'

export interface WallsTile {
  i: number;
  j: number;
  /** World-space bounds [minX, minY, minZ, maxX, maxY, maxZ] of the LOD 0 geometry. */
  box: number[];
  /** Triangles per LOD (wall + foliage). */
  tris: number[];
  /** LOD 0 file (relative to the index), absent when the tile has no LOD 0 geometry. */
  lod0?: string;
  bytes0?: number;
}

export interface WallsIndex {
  format: number;
  generated: string;
  tileSize: number;
  cellTiles: number;
  tiles: WallsTile[];
  /** LOD 1 files per cell and their vertex / index totals (capacity of the batched mesh). */
  lod1: { cell: [number, number]; file: string; vertices: number; indices: number }[];
  lod2: { file: string; vertices: number; indices: number };
  colliders: string;
  /** OSM building ids the walls draw (towers, gate pylons, wall rings): the OSM building layers skip them. */
  owned: number[];
  stats: Record<string, number | string>;
}

export interface WallsColliders {
  /** Collider sources ("city-wall:<osm id>"). */
  sources: string[];
  /** [cx, cy, cz, hx, hy, hz, yaw, source index] per box. */
  boxes: number[];
}

export type MeshKind = 'wall' | 'leaf';

export interface MeshRecord {
  tile: [number, number];
  kind: MeshKind;
  vertices: number;
  indices: number;
  /** Byte offsets of position (f32 x3), normal (i8 x3), uv (f32 x2), colour (u8 x4), surf (u8 x4), index. */
  pos: number;
  nrm: number;
  uv: number;
  col: number;
  srf: number;
  idx: number;
  idx32: boolean;
}

export interface MeshArrays {
  positions: Float32Array;
  normals: Int8Array;
  uvs: Float32Array;
  colors: Uint8Array;
  surf: Uint8Array;
  index: Uint16Array | Uint32Array;
}

export interface DecodedMesh extends MeshArrays {
  record: MeshRecord;
}

const pad4 = (n: number): number => (n + 3) & ~3;

/** Packs meshes into one container (bake side). */
export function encodeMeshes(list: { tile: [number, number]; kind: MeshKind; data: MeshArrays }[]): Uint8Array {
  const records: MeshRecord[] = [];
  let off = 0;
  const blobs: [number, ArrayBufferView][] = [];
  const put = (v: ArrayBufferView): number => {
    const at = off;
    blobs.push([at, v]);
    off = pad4(off + v.byteLength);
    return at;
  };
  for (const m of list) {
    const d = m.data;
    records.push({
      tile: m.tile,
      kind: m.kind,
      vertices: d.positions.length / 3,
      indices: d.index.length,
      pos: put(d.positions),
      nrm: put(d.normals),
      uv: put(d.uvs),
      col: put(d.colors),
      srf: put(d.surf),
      idx: put(d.index),
      idx32: d.index instanceof Uint32Array,
    });
  }
  const header = new TextEncoder().encode(JSON.stringify(records));
  const head = pad4(8 + header.byteLength);
  const out = new Uint8Array(head + off);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, MAGIC, true);
  dv.setUint32(4, header.byteLength, true);
  out.set(header, 8);
  for (const [at, v] of blobs) {
    out.set(new Uint8Array(v.buffer, v.byteOffset, v.byteLength), head + at);
  }
  return out;
}

/** Reads a container (runtime side); the arrays view the given buffer. */
export function decodeMeshes(buf: ArrayBuffer): DecodedMesh[] {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== MAGIC) {
    throw new Error('[walls] not a wall mesh container');
  }
  const len = dv.getUint32(4, true);
  const records = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, len))) as MeshRecord[];
  const head = pad4(8 + len);
  return records.map((r) => ({
    record: r,
    positions: new Float32Array(buf, head + r.pos, r.vertices * 3),
    normals: new Int8Array(buf, head + r.nrm, r.vertices * 3),
    uvs: new Float32Array(buf, head + r.uv, r.vertices * 2),
    colors: new Uint8Array(buf, head + r.col, r.vertices * 4),
    surf: new Uint8Array(buf, head + r.srf, r.vertices * 4),
    index: r.idx32 ? new Uint32Array(buf, head + r.idx, r.indices) : new Uint16Array(buf, head + r.idx, r.indices),
  }));
}
