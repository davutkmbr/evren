/**
 * Façade module library and tile slots (street format 1.2), shared by the world compiler and the runtime.
 *
 * Tiles keep the wall shell and its openings; what fills and dresses the openings (window frames, glass, rooms and
 * curtains behind them, shutters, sills, surrounds, roller boxes, flues...) is a list of SLOTS per tile
 * (`tiles/<id>.slots.bin`). A slot names a module FAMILY, a style, a seed, a place on a wall and the size it must
 * fill; the runtime picks one of the family's VARIANTS from the module library by family + style + size + seed
 * (+ the area's district) and assembles the chosen modules into merged geometry per material, off the main thread
 * (expand.ts, expand.worker.ts). Adding a variant is adding a module glb and a catalog entry: no tile recompiles.
 *
 * Library (`world/_shared/modules/`): `catalog.json` (ModuleCatalog) and plain glTF 2.0 glbs (float accessors, no
 * extensions). A variant is one mesh of a glb, authored at a reference size `ref` = [w, h, d] in the MODULE FRAME:
 * x runs right along the wall seen from outside, y up, z out of the wall (the slot's d = 0 plane). Vertices move
 * with the slot's size through three custom attributes, `_DW`, `_DH`, `_DD` (VEC3, metres per metre of w, h, d over
 * the reference): position = POSITION + _DW (w - ref.w) + _DH (h - ref.h) + _DD (d - ref.d). A mesh without them is
 * stretched 9-slice style by `slice` (see ModuleVariant). Primitive extras: `tint` (0 or 1: COLOR_0 is multiplied by
 * that tint of the slot, or by the variant's palette when the slot has none) and `uv: "module"` (keep the mesh's
 * TEXCOORD_0, e.g. decals; other primitives get world-scale UV0 projected like the compiler's, from the area's
 * material tiling).
 *
 * Slots file (little endian): magic "EVSL", u16 version, u16 flags, u16 string count, u16 0, u32 frames, u32 slots;
 * strings (u16 byte length + UTF-8 each), padded to 4; frames as float32 [ox, oz, nx, nz] (tile-local wall origin
 * and outward normal; +r = (nz, -nx)); then columns, each padded to 4: family u8 (string index), style u16 (string
 * index + 1, 0 = none), seed u16, frame u16, r i32 mm, y i32 mm, d i16 mm, w u16 mm, h u16 mm, dd u16 mm, tint0 u32,
 * tint1 u32 (linear RGBA8, 0 = none). Slots are sorted by frame.
 *
 * Text: a family with `text` lays out its slot's style string with the glyph family's variants (one per character,
 * authored at cap height 1 from x = 0, `advance` wide): r is the text's centre, y its baseline, d the face plane and
 * w the cap height (the shop signs' fictional names, trade words, door numbers are strings in the slots file).
 */

export const SLOTS_MAGIC = 0x4c535645; // "EVSL"
export const SLOTS_VERSION = 1;

/** Linear RGBA in [0, 1]. */
export type Rgba = [number, number, number, number];

export interface ModuleCatalog {
  format: 1;
  /** Families by name ("window.frame", "window.curtain"...). */
  families: Record<string, ModuleFamily>;
  /**
   * glb files of the library: content hash (16 hex) and size, for cache busting and checks; `gz`: size of the gzipped
   * copy `<file>.gz` next to it, which runtimes fetch instead (a file added by hand needs none).
   */
  files: Record<string, { hash: string; bytes: number; gz?: number }>;
  /** sha256 (16 hex) of the catalog without this field: changes whenever a module or entry changes. */
  hash: string;
}

export interface ModuleFamily {
  /** What the family is for (documentation). */
  doc?: string;
  /** Material renames applied to every slot of the family (e.g. neon letters). */
  remap?: Record<string, string>;
  /** A text family: the slot's style is a string set with `glyphs` (a family whose variant ids are characters). */
  text?: { glyphs: string; track: number };
  /** Slot styles: material renames applied to every variant of the family (e.g. timber frames). */
  styles?: Record<string, { remap?: Record<string, string> }>;
  variants: ModuleVariant[];
}

export interface ModuleVariant {
  id: string;
  /** glb file (relative to the catalog) and the mesh in it. */
  file: string;
  mesh: string;
  /** Reference size [w, h, d] the mesh was authored at. */
  ref: [number, number, number];
  /** Slot sizes the variant fits (inclusive min, exclusive max); a slot outside every variant's fit gets none. */
  fit?: { w?: [number, number]; h?: [number, number]; d?: [number, number] };
  /** Slot styles the variant serves (default: every style). */
  styles?: string[];
  /** District profiles the variant serves (default: every district). */
  districts?: string[];
  /** Relative pick weight among the fitting variants (default 1). A variant with no mesh (`mesh: ""`) draws nothing. */
  weight?: number;
  /** Per tint: sRGB hex colours ("#rrggbb" or "#rrggbbaa"), one picked by the slot's seed when the slot gives none. */
  palettes?: string[][];
  /**
   * 9-slice planes for meshes without `_DW/_DH/_DD`: x (or y) below slice[0] keeps its distance to the left (bottom)
   * edge, above slice[1] to the right (top) edge, between them it scales.
   */
  slice?: { x?: [number, number]; y?: [number, number] };
  /**
   * Repeats the mesh along x: n = max(1, round(w / pitch)) copies (`up`: ceil, i.e. bays of at most `pitch`) of
   * width w / n side by side (railing bays, bar grids). `caps` meshes of the same file are placed once at x = 0 and
   * x = w.
   */
  repeat?: { pitch: number; caps?: [string | null, string | null]; up?: boolean };
  /** Glyph variants: advance width in cap heights (without tracking). */
  advance?: number;
}

/** One slot as the compiler writes it and the expander reads it. */
export interface Slot {
  family: string;
  style: string | null;
  seed: number;
  frame: number;
  r: number;
  y: number;
  d: number;
  w: number;
  h: number;
  dd: number;
  tint0: Rgba | null;
  tint1: Rgba | null;
}

/** A wall frame: tile-local origin (x, z) and unit outward normal (x, z). */
export type SlotFrame = [number, number, number, number];

export interface SlotsFile {
  strings: string[];
  frames: Float32Array;
  n: number;
  family: Uint8Array;
  style: Uint16Array;
  seed: Uint16Array;
  frame: Uint16Array;
  r: Int32Array;
  y: Int32Array;
  d: Int16Array;
  w: Uint16Array;
  h: Uint16Array;
  dd: Uint16Array;
  tint0: Uint32Array;
  tint1: Uint32Array;
}

const mm = (v: number): number => Math.round(v * 1000);
const clampU16 = (v: number): number => Math.max(0, Math.min(65535, v));
const clampI16 = (v: number): number => Math.max(-32768, Math.min(32767, v));

/** Packs linear RGBA into u32 (never 0 for a colour: alpha 0 is stored as 1). */
export function packRgba(c: Rgba | null): number {
  if (!c) {
    return 0;
  }
  const b = (v: number): number => Math.max(0, Math.min(255, Math.round(v * 255)));
  return ((b(c[0]) | (b(c[1]) << 8) | (b(c[2]) << 16) | (Math.max(1, b(c[3])) << 24)) >>> 0);
}

export function unpackRgba(v: number): Rgba | null {
  if (!v) {
    return null;
  }
  return [(v & 255) / 255, ((v >>> 8) & 255) / 255, ((v >>> 16) & 255) / 255, ((v >>> 24) & 255) / 255];
}

/** Encodes a tile's slots (sorted by frame, then family, r, y for compression); deterministic. */
export function encodeSlots(frames: readonly SlotFrame[], slots: readonly Slot[]): Uint8Array {
  const strings: string[] = [];
  const sid = new Map<string, number>();
  const str = (s: string): number => {
    let i = sid.get(s);
    if (i === undefined) {
      i = strings.length;
      strings.push(s);
      sid.set(s, i);
    }
    return i;
  };
  const list = [...slots].sort((a, b) => a.frame - b.frame || (a.family < b.family ? -1 : a.family > b.family ? 1 : 0) || mm(a.y) - mm(b.y) || mm(a.r) - mm(b.r) || a.seed - b.seed);
  // Family names first (their index is a byte), then the styles.
  for (const s of list) {
    str(s.family);
  }
  for (const s of list) {
    if (s.style !== null) {
      str(s.style);
    }
  }
  if (strings.length > 65534) {
    throw new Error(`slots: ${strings.length} family and style strings, at most 65534`);
  }
  const families = new Set(list.map((s) => s.family));
  if ([...families].some((f) => str(f) > 255)) {
    throw new Error('slots: family names must come first in the string table');
  }
  if (frames.length > 65535) {
    throw new Error(`slots: ${frames.length} frames, at most 65535`);
  }
  const enc = new TextEncoder();
  const bytes = strings.map((s) => enc.encode(s));
  const n = list.length;
  const pad4 = (v: number): number => (v + 3) & ~3;
  let size = 20;
  for (const b of bytes) {
    size += 2 + b.length;
  }
  size = pad4(size);
  const framesAt = size;
  size += frames.length * 16;
  const cols: [string, number][] = [
    ['family', 1],
    ['style', 2],
    ['seed', 2],
    ['frame', 2],
    ['r', 4],
    ['y', 4],
    ['d', 2],
    ['w', 2],
    ['h', 2],
    ['dd', 2],
    ['tint0', 4],
    ['tint1', 4],
  ];
  const at: Record<string, number> = {};
  for (const [k, w] of cols) {
    at[k] = size;
    size = pad4(size + n * w);
  }
  const buf = new ArrayBuffer(size);
  const v = new DataView(buf);
  const u8 = new Uint8Array(buf);
  v.setUint32(0, SLOTS_MAGIC, true);
  v.setUint16(4, SLOTS_VERSION, true);
  v.setUint16(6, 0, true);
  v.setUint16(8, strings.length, true);
  v.setUint16(10, 0, true);
  v.setUint32(12, frames.length, true);
  v.setUint32(16, n, true);
  let o = 20;
  for (const b of bytes) {
    v.setUint16(o, b.length, true);
    u8.set(b, o + 2);
    o += 2 + b.length;
  }
  frames.forEach((f, k) => {
    for (let c = 0; c < 4; c++) {
      v.setFloat32(framesAt + k * 16 + c * 4, f[c], true);
    }
  });
  list.forEach((s, i) => {
    v.setUint8(at.family + i, str(s.family));
    v.setUint16(at.style + i * 2, s.style === null ? 0 : str(s.style) + 1, true);
    v.setUint16(at.seed + i * 2, s.seed & 0xffff, true);
    v.setUint16(at.frame + i * 2, s.frame, true);
    v.setInt32(at.r + i * 4, mm(s.r), true);
    v.setInt32(at.y + i * 4, mm(s.y), true);
    v.setInt16(at.d + i * 2, clampI16(mm(s.d)), true);
    v.setUint16(at.w + i * 2, clampU16(mm(s.w)), true);
    v.setUint16(at.h + i * 2, clampU16(mm(s.h)), true);
    v.setUint16(at.dd + i * 2, clampU16(mm(s.dd)), true);
    v.setUint32(at.tint0 + i * 4, packRgba(s.tint0), true);
    v.setUint32(at.tint1 + i * 4, packRgba(s.tint1), true);
  });
  return u8;
}

/** Decodes a slots file (views into a copy-free buffer where aligned). */
export function decodeSlots(data: ArrayBuffer): SlotsFile {
  const v = new DataView(data);
  if (v.getUint32(0, true) !== SLOTS_MAGIC) {
    throw new Error('slots: bad magic');
  }
  const version = v.getUint16(4, true);
  if (version !== SLOTS_VERSION) {
    throw new Error(`slots: version ${version}, expected ${SLOTS_VERSION}`);
  }
  const ns = v.getUint16(8, true);
  const nf = v.getUint32(12, true);
  const n = v.getUint32(16, true);
  const dec = new TextDecoder();
  const strings: string[] = [];
  let o = 20;
  for (let k = 0; k < ns; k++) {
    const len = v.getUint16(o, true);
    strings.push(dec.decode(new Uint8Array(data, o + 2, len)));
    o += 2 + len;
  }
  const pad4 = (x: number): number => (x + 3) & ~3;
  o = pad4(o);
  const frames = new Float32Array(data, o, nf * 4);
  o += nf * 16;
  const col = <T>(make: (b: ArrayBuffer, off: number, len: number) => T, width: number): T => {
    const out = make(data, o, n);
    o = pad4(o + n * width);
    return out;
  };
  return {
    strings,
    frames,
    n,
    family: col((b, off, len) => new Uint8Array(b, off, len), 1),
    style: col((b, off, len) => new Uint16Array(b, off, len), 2),
    seed: col((b, off, len) => new Uint16Array(b, off, len), 2),
    frame: col((b, off, len) => new Uint16Array(b, off, len), 2),
    r: col((b, off, len) => new Int32Array(b, off, len), 4),
    y: col((b, off, len) => new Int32Array(b, off, len), 4),
    d: col((b, off, len) => new Int16Array(b, off, len), 2),
    w: col((b, off, len) => new Uint16Array(b, off, len), 2),
    h: col((b, off, len) => new Uint16Array(b, off, len), 2),
    dd: col((b, off, len) => new Uint16Array(b, off, len), 2),
    tint0: col((b, off, len) => new Uint32Array(b, off, len), 4),
    tint1: col((b, off, len) => new Uint32Array(b, off, len), 4),
  };
}

/** Deterministic 32-bit hash of a slot seed and a salt (the family name's hash), as a number in [0, 1). */
export function seedUnit(seed: number, salt: number): number {
  let h = (Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt, 0xc2b2ae35)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** FNV-1a hash of a string (family names salt the variant pick). */
export function nameHash(s: string): number {
  let h = 0x811c9dc5;
  for (let k = 0; k < s.length; k++) {
    h = Math.imul(h ^ s.charCodeAt(k), 0x01000193) >>> 0;
  }
  return h;
}

const inRange = (v: number, r: [number, number] | undefined): boolean => !r || (v >= r[0] - 1e-4 && v < r[1] - 1e-4);

/**
 * The variant a slot gets: the family's variants that serve its style and district and fit its size, one picked by
 * weight with the seed. null when none fits (or the pick is an empty variant).
 */
export function pickVariant(fam: ModuleFamily, familyName: string, style: string | null, district: string | null, w: number, h: number, d: number, seed: number): ModuleVariant | null {
  let total = 0;
  const fits: ModuleVariant[] = [];
  for (const v of fam.variants) {
    if (v.styles && (style === null || !v.styles.includes(style))) {
      continue;
    }
    if (v.districts && (district === null || !v.districts.includes(district))) {
      continue;
    }
    if (!inRange(w, v.fit?.w) || !inRange(h, v.fit?.h) || !inRange(d, v.fit?.d)) {
      continue;
    }
    fits.push(v);
    total += v.weight ?? 1;
  }
  if (!fits.length || total <= 0) {
    return null;
  }
  let u = seedUnit(seed, nameHash(familyName)) * total;
  for (const v of fits) {
    u -= v.weight ?? 1;
    if (u < 0) {
      return v.mesh ? v : null;
    }
  }
  const last = fits[fits.length - 1];
  return last.mesh ? last : null;
}

/** Linear RGBA of an sRGB hex string "#rrggbb" or "#rrggbbaa" (alpha stays linear). */
export function hexLinear(hex: string): Rgba {
  const s = hex.replace('#', '');
  const ch = (k: number): number => parseInt(s.slice(k * 2, k * 2 + 2), 16) / 255;
  const lin = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return [lin(ch(0)), lin(ch(1)), lin(ch(2)), s.length >= 8 ? ch(3) : 1];
}

/**
 * The tint k of a slot: its own, or one of the variant's palette colours picked by the seed; null = none. A palette
 * entry `$name.i` is colour i of the area's district colours `name` (ModulesRef.colors, e.g. `$flag.0`).
 */
export function tintOf(v: ModuleVariant, k: number, own: number, seed: number, colors?: Readonly<Record<string, readonly string[]>>): Rgba | null {
  const t = unpackRgba(own);
  if (t) {
    return t;
  }
  const pal = v.palettes?.[k];
  if (!pal?.length) {
    return null;
  }
  const u = seedUnit(seed, 0x51ed27 + k * 7919);
  let c = pal[Math.min(pal.length - 1, Math.floor(u * pal.length))];
  if (c.startsWith('$')) {
    const [name, i] = c.slice(1).split('.');
    c = colors?.[name]?.[Number(i)] ?? '#ffffff';
  }
  return hexLinear(c);
}

/** Index extension of an area (index.json `modules`): where the library is and what the tiles' materials look like. */
export interface ModulesRef {
  /** URL of the catalog, relative to the area folder. */
  catalog: string;
  /** Hash of the catalog the tiles were compiled against (informative: the runtime reads the current one). */
  catalogHash: string;
  /** glb holding one material per module material (the area's own definitions and textures), relative to the area folder. */
  palette: string;
  /** Texture tiling (metres per repeat, [u, v]) of every palette material, for world-scale UV0. */
  tiling: Record<string, [number, number]>;
  /** District profile of the area (variants may be limited to districts). */
  district: string;
  /** District colours palettes may name (`$flag.0`), sRGB hex. */
  colors: Record<string, string[]>;
}

/** Tile ref extension (index.json tiles[] `slots`). */
export interface SlotsRef {
  file: string;
  hash: string;
  bytes: number;
  count: number;
}
