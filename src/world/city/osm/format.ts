/**
 * Far OSM layer bake (phase 24, .docs/planning/24-far-osm-layer.md): the real OSM buildings of the playable square,
 * written by scripts/data/osm-city-bake.ts to public/data/osm/city/ and read by the city workers (data mode).
 *
 * Layout:
 * - index.json (CityBakeIndex): source, snapshot, counts and the block files;
 * - blocks/<bi>_<bj>.bin.gz: every building of one 2 km block (BAKE_BLOCK), sorted by 500 m tile (the city's level 0
 *   tile); the city's 1 km and 2 km tiles are unions of these, and the workers thin them by fade class (the
 *   procedural city's far tiles keep every building too, city/worker/tile.ts), so no per-level copies are stored;
 * - land.bin.gz: OSM land-use polygons (LandClass) of the whole square.
 * The coverage mask (which 250 m cells OSM draws; the procedural city keeps the others) is src/world/city/osm/mask.json,
 * so the geo build can import it synchronously.
 *
 * Container (all .bin files): 'OCB1', u32 header byte length, JSON header, zero padding to 8 bytes, then the blobs at
 * the offsets the header records (relative to the blob start). Blobs are little-endian typed arrays; 16-bit blobs
 * named in SHUFFLED are stored as two byte planes (low bytes, then high bytes), which gzip packs far better.
 *
 * Building records (one per solid of the flight-scale layer, buildings/build.ts collectSolids + planSolid, so a
 * building is the same before and after its region loads), struct of arrays:
 * - nv (u8): outline vertex count; xy (i16 pairs, XY_UNIT m): each outline's first vertex relative to the block
 *   centre, then the step to each next vertex. Counter-clockwise (positive shoelace area in x / z); no courtyards.
 * - wallH, minH (u16, dm): wall height and bottom height (building:part min_height) above the reference ground.
 * - rise (u8, dm): roof rise; roof (u8, RoofClass); arch (u8, buildings/archetypes.ts Arch); floors (u8);
 *   floorH (u8, m x 50); flags (u8, FLAG); tint, roofTint (u16, sRGB 565).
 * - id (i32): OSM id minus the previous record's (parts carry their own id; infill parcels 2e9 + n).
 * decodeBuildings() undoes all of it.
 */

export const CITY_BAKE_FORMAT = 1;
export const BAKE_BLOCK = 2000;
export const BAKE_HALF = 24000;
export const BAKE_BLOCKS = (BAKE_HALF * 2) / BAKE_BLOCK;
/** Metres per xy unit. */
export const XY_UNIT = 0.2;
/** Coverage mask cell (m): the city's layout cell (city/protocol.ts BASE_CELL). */
export const MASK_CELL = 250;
export const MASK_SIZE = (BAKE_HALF * 2) / MASK_CELL;
const MAGIC = 0x3142434f; // 'OCB1'

/** 16-bit blobs stored as byte planes. */
export const SHUFFLED = ['xy', 'wallH', 'minH', 'tint', 'roofTint'] as const;

export const RoofClass = { Flat: 0, Hipped: 1, Gabled: 2, Pyramidal: 3, Skillion: 4, Dome: 5, Domes: 6 } as const;
export type RoofClass = (typeof RoofClass)[keyof typeof RoofClass];

/** Usage (FLAG usage bits): drives the night occupancy of the city shader. */
export const Usage = { Residential: 0, Office: 1, Industrial: 2, Worship: 3 } as const;

/** Fade class (FLAG fade bits): the city's far classes (city/protocol.ts), most important first. */
export const FadeClass = { Skyline: 0, Large: 1, Mid: 2, Small: 3 } as const;

export const FLAG = {
  minaret: 1,
  infill: 2,
  /** Bits 2-3: FadeClass. */
  fadeShift: 2,
  /** Bits 4-5: Usage. */
  usageShift: 4,
  tower: 64,
} as const;

/** OSM land-use classes of land.bin.gz (the geo build maps them to its LandUse). */
export const LandClass = { Park: 0, Grass: 1, Forest: 2, Cemetery: 3, Farm: 4, Water: 5, Industrial: 6, Residential: 7, Pitch: 8 } as const;
export type LandClass = (typeof LandClass)[keyof typeof LandClass];

export interface BakeTile {
  /** 500 m tile index on the city grid (x = -BAKE_HALF + i * 500). */
  i: number;
  j: number;
  first: number;
  count: number;
}

/** Header of a block file. Blobs: nv, xy, wallH, minH, rise, roof, arch, floors, floorH, flags, tint, roofTint, id. */
export interface BuildingFileHeader {
  format: number;
  block: [number, number];
  /** Block centre (x, z), the origin of xy. */
  origin: [number, number];
  count: number;
  vertices: number;
  /** Level 0 (500 m) tiles, in record order. */
  tiles: BakeTile[];
  blobs: Record<string, BlobRef>;
}

/** A decoded block file. */
export interface DecodedBuildings {
  header: BuildingFileHeader;
  nv: Uint8Array;
  /** Record k's first vertex index into xy / 2. */
  start: Uint32Array;
  /** Absolute vertices (x, z pairs, metres, world space). */
  xy: Float32Array;
  wallH: Uint16Array;
  minH: Uint16Array;
  rise: Uint8Array;
  roof: Uint8Array;
  arch: Uint8Array;
  floors: Uint8Array;
  floorH: Uint8Array;
  flags: Uint8Array;
  tint: Uint16Array;
  roofTint: Uint16Array;
  id: Float64Array;
}

/** Header of land.bin.gz. Blobs: cls (u8 per polygon), rings (u8 ring count per polygon), nv (u16 per ring), org (f32 x, z per polygon), xy (i16 pairs, LAND_UNIT m). */
export interface LandFileHeader {
  format: number;
  polygons: number;
  rings: number;
  vertices: number;
  blobs: Record<string, BlobRef>;
}
export const LAND_UNIT = 0.5;

export interface BlobRef {
  type: 'u8' | 'i16' | 'u16' | 'i32' | 'f32' | 'f64';
  offset: number;
  length: number;
}

export interface CityBakeIndex {
  format: number;
  generated: string;
  source: string;
  osmBase: string | null;
  block: number;
  files: { block: [number, number]; file: string; count: number; bytes: number }[];
  land: { file: string; polygons: number; bytes: number };
  stats: Record<string, number>;
}

/** Coverage mask as stored in mask.json: MASK_SIZE x MASK_SIZE cells, row-major (z rows), bit-packed, base64. */
export interface CoverageMaskFile {
  format: number;
  cell: number;
  size: number;
  osmBase: string | null;
  rule: string;
  bits: string;
}

const CTORS = { u8: Uint8Array, i16: Int16Array, u16: Uint16Array, i32: Int32Array, f32: Float32Array, f64: Float64Array } as const;
type AnyArray = Uint8Array | Int16Array | Uint16Array | Int32Array | Float32Array | Float64Array;

function typeOf(a: AnyArray): BlobRef['type'] {
  if (a instanceof Uint8Array) return 'u8';
  if (a instanceof Int16Array) return 'i16';
  if (a instanceof Uint16Array) return 'u16';
  if (a instanceof Int32Array) return 'i32';
  if (a instanceof Float32Array) return 'f32';
  return 'f64';
}

/** Packs a header (its `blobs` filled here) and named arrays into one container. */
export function packContainer<H extends { blobs: Record<string, BlobRef> }>(header: Omit<H, 'blobs'>, arrays: Record<string, AnyArray>): Uint8Array {
  const blobs: Record<string, BlobRef> = {};
  let offset = 0;
  for (const [name, a] of Object.entries(arrays)) {
    offset = Math.ceil(offset / 8) * 8;
    blobs[name] = { type: typeOf(a), offset, length: a.length };
    offset += a.byteLength;
  }
  const head = new TextEncoder().encode(JSON.stringify({ ...header, blobs }));
  const start = Math.ceil((8 + head.length) / 8) * 8;
  const out = new Uint8Array(start + Math.ceil(offset / 8) * 8);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, MAGIC, true);
  dv.setUint32(4, head.length, true);
  out.set(head, 8);
  for (const [name, a] of Object.entries(arrays)) {
    out.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), start + blobs[name].offset);
  }
  return out;
}

/** Reads a container: its header and typed views on its blobs (no copies). */
export function unpackContainer<H extends { blobs: Record<string, BlobRef> }>(bytes: Uint8Array): { header: H; arrays: Record<string, AnyArray> } {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== MAGIC) {
    throw new Error('not a city bake container');
  }
  const len = dv.getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + len))) as H;
  const start = Math.ceil((8 + len) / 8) * 8;
  const arrays: Record<string, AnyArray> = {};
  for (const [name, b] of Object.entries(header.blobs)) {
    const Ctor = CTORS[b.type];
    const at = bytes.byteOffset + start + b.offset;
    // Views need aligned offsets; copy when the container sits unaligned in its buffer.
    const buffer = bytes.buffer as ArrayBuffer;
    arrays[name] = at % Ctor.BYTES_PER_ELEMENT === 0 ? new Ctor(buffer, at, b.length) : new Ctor(bytes.slice(start + b.offset, start + b.offset + b.length * Ctor.BYTES_PER_ELEMENT).buffer);
  }
  return { header, arrays };
}

/** Bit-packs a coverage mask (1 = OSM draws the cell) into base64. */
export function encodeMask(mask: Uint8Array): string {
  const bits = new Uint8Array(Math.ceil(mask.length / 8));
  for (let k = 0; k < mask.length; k++) {
    if (mask[k]) {
      bits[k >> 3] |= 1 << (k & 7);
    }
  }
  let s = '';
  for (const b of bits) {
    s += String.fromCharCode(b);
  }
  return btoa(s);
}

/** Inverse of encodeMask. */
export function decodeMask(file: Pick<CoverageMaskFile, 'bits' | 'size'>): Uint8Array {
  const raw = atob(file.bits);
  const out = new Uint8Array(file.size * file.size);
  for (let k = 0; k < out.length; k++) {
    out[k] = (raw.charCodeAt(k >> 3) >> (k & 7)) & 1;
  }
  return out;
}

/** 16-bit array -> byte planes (all low bytes, then all high bytes). */
export function shuffle16(a: Int16Array | Uint16Array): Uint8Array {
  const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  const out = new Uint8Array(u.length);
  const n = a.length;
  for (let i = 0; i < n; i++) {
    out[i] = u[i * 2];
    out[n + i] = u[i * 2 + 1];
  }
  return out;
}

/** Inverse of shuffle16 into a new array of `Ctor`. */
export function unshuffle16<T extends Int16Array | Uint16Array>(planes: Uint8Array, Ctor: { new (n: number): T }): T {
  const n = planes.length / 2;
  const out = new Ctor(n);
  const u = new Uint8Array(out.buffer);
  for (let i = 0; i < n; i++) {
    u[i * 2] = planes[i];
    u[i * 2 + 1] = planes[n + i];
  }
  return out;
}

/** sRGB 0-255 -> 565. */
export function pack565(r: number, g: number, b: number): number {
  return ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);
}

/** 565 -> sRGB 0-1 triple. */
export function unpack565(c: number): [number, number, number] {
  return [((c >> 11) & 31) / 31, ((c >> 5) & 63) / 63, (c & 31) / 31];
}

/** Decodes a (gunzipped) block file: absolute world-space outlines and plain attribute arrays. */
export function decodeBuildings(bytes: Uint8Array): DecodedBuildings {
  const { header, arrays } = unpackContainer<BuildingFileHeader>(bytes);
  const u16 = (name: string): Uint16Array => unshuffle16(arrays[name] as Uint8Array, Uint16Array);
  const nv = arrays.nv as Uint8Array;
  const dxy = unshuffle16(arrays.xy as Uint8Array, Int16Array);
  const start = new Uint32Array(header.count + 1);
  const xy = new Float32Array(dxy.length);
  let v = 0;
  for (let k = 0; k < header.count; k++) {
    start[k] = v;
    let x = 0;
    let z = 0;
    for (let q = 0; q < nv[k]; q++, v++) {
      x += dxy[v * 2];
      z += dxy[v * 2 + 1];
      xy[v * 2] = header.origin[0] + x * XY_UNIT;
      xy[v * 2 + 1] = header.origin[1] + z * XY_UNIT;
    }
  }
  start[header.count] = v;
  const idDelta = arrays.id as Int32Array;
  const id = new Float64Array(header.count);
  let prev = 0;
  for (let k = 0; k < header.count; k++) {
    prev += idDelta[k];
    id[k] = prev;
  }
  return {
    header,
    nv,
    start,
    xy,
    wallH: u16('wallH'),
    minH: u16('minH'),
    rise: arrays.rise as Uint8Array,
    roof: arrays.roof as Uint8Array,
    arch: arrays.arch as Uint8Array,
    floors: arrays.floors as Uint8Array,
    floorH: arrays.floorH as Uint8Array,
    flags: arrays.flags as Uint8Array,
    tint: u16('tint'),
    roofTint: u16('roofTint'),
    id,
  };
}
