/**
 * Slot expansion: a tile's slots (format.ts) + the module library -> merged geometry per material, in the tile's
 * frame (positions relative to the tile origin, like the tile glb's). Pure code without DOM or three.js, run in the
 * expansion worker (expand.worker.ts) and in Node (compiler checks). Two passes: pick every slot's variant and
 * count, then fill preallocated arrays, so a tile of tens of thousands of slots expands in a few milliseconds.
 *
 * Per vertex: the module position moved by the slot's size (`_DW/_DH/_DD`, 9-slice or repeat, see ModuleVariant),
 * placed on the wall frame, its normal turned with it, COLOR_0 multiplied by the slot's tint, and UV0 projected at
 * world scale exactly as the compiler's TileMesh does for flat faces (mesh.ts faceFrame; textures continue across
 * modules and walls) unless the primitive keeps its own (`uv: "module"`).
 */
import { decodeSlots, type ModuleCatalog, type ModuleFamily, type ModuleVariant, pickVariant, type SlotsFile, tintOf } from './format';

/** One primitive of a module mesh. */
export interface ModulePrim {
  material: string;
  tint: number | null;
  moduleUv: boolean;
  position: Float32Array;
  normal: Float32Array;
  color: Float32Array | null;
  /** Colour components per vertex (3 or 4). */
  colorSize: number;
  uv: Float32Array | null;
  dw: Float32Array | null;
  dh: Float32Array | null;
  dd: Float32Array | null;
  index: Uint32Array;
}

export interface ModuleMesh {
  name: string;
  prims: ModulePrim[];
}

/** Meshes of a module glb by name. */
export type ModuleGlb = Map<string, ModuleMesh>;

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

interface GltfJson {
  meshes?: { name?: string; primitives: { attributes: Record<string, number>; indices?: number; material?: number; extras?: { tint?: number; uv?: string } }[] }[];
  materials?: { name?: string }[];
  accessors: { bufferView?: number; byteOffset?: number; componentType: number; count: number; type: string; normalized?: boolean }[];
  bufferViews: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[];
}

/** Parses a plain glb (float attributes, u8/u16/u32 indices, no compression or sparse accessors). */
export function parseModuleGlb(bytes: ArrayBuffer): ModuleGlb {
  const v = new DataView(bytes);
  if (v.getUint32(0, true) !== 0x46546c67) {
    throw new Error('module glb: bad magic');
  }
  const jsonLen = v.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, jsonLen))) as GltfJson;
  const binAt = 20 + jsonLen + 8;
  const SIZE: Record<number, number> = { 5126: 4, 5125: 4, 5123: 2, 5121: 1 };
  const read = (k: number): Float32Array | Uint32Array => {
    const a = json.accessors[k];
    const bv = json.bufferViews[a.bufferView ?? 0];
    const comps = COMPONENTS[a.type] ?? 1;
    const size = SIZE[a.componentType];
    if (!size) {
      throw new Error(`module glb: component type ${a.componentType} is not supported`);
    }
    const off = binAt + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const stride = bv.byteStride ?? comps * size;
    const out = a.componentType === 5126 ? new Float32Array(a.count * comps) : new Uint32Array(a.count * comps);
    for (let i = 0; i < a.count; i++) {
      for (let c = 0; c < comps; c++) {
        const at = off + i * stride + c * size;
        out[i * comps + c] = a.componentType === 5126 ? v.getFloat32(at, true) : a.componentType === 5125 ? v.getUint32(at, true) : a.componentType === 5123 ? v.getUint16(at, true) : v.getUint8(at);
      }
    }
    return out;
  };
  const out: ModuleGlb = new Map();
  for (const m of json.meshes ?? []) {
    const prims: ModulePrim[] = [];
    for (const p of m.primitives) {
      const att = p.attributes;
      const position = read(att.POSITION) as Float32Array;
      const n = position.length / 3;
      const index = p.indices !== undefined ? (read(p.indices) as Uint32Array) : Uint32Array.from({ length: n }, (_, k) => k);
      const color = att.COLOR_0 !== undefined ? (read(att.COLOR_0) as Float32Array) : null;
      prims.push({
        material: json.materials?.[p.material ?? -1]?.name ?? 'default',
        tint: typeof p.extras?.tint === 'number' ? p.extras.tint : null,
        moduleUv: p.extras?.uv === 'module',
        position,
        normal: att.NORMAL !== undefined ? (read(att.NORMAL) as Float32Array) : new Float32Array(n * 3),
        color,
        colorSize: color ? (json.accessors[att.COLOR_0].type === 'VEC3' ? 3 : 4) : 4,
        uv: att.TEXCOORD_0 !== undefined ? (read(att.TEXCOORD_0) as Float32Array) : null,
        dw: att._DW !== undefined ? (read(att._DW) as Float32Array) : null,
        dh: att._DH !== undefined ? (read(att._DH) as Float32Array) : null,
        dd: att._DD !== undefined ? (read(att._DD) as Float32Array) : null,
        index,
      });
    }
    out.set(m.name ?? '', { name: m.name ?? '', prims });
  }
  return out;
}

/** The library as the expander sees it: the catalog and a lookup of loaded module meshes. */
export interface ModuleSource {
  catalog: ModuleCatalog;
  mesh(file: string, name: string): ModuleMesh | undefined;
}

export interface ExpandOptions {
  /** Texture tiling per material (metres per repeat); materials not listed get no UV0. */
  tiling: Record<string, [number, number]>;
  /** District profile of the area (variants may be limited to districts). */
  district: string | null;
  /** Tile origin (x, z) in world metres: world-scale UV0 is continuous across tiles like the compiler's. */
  origin: [number, number];
  /** District colours palettes may name (ModulesRef.colors). */
  colors?: Readonly<Record<string, readonly string[]>>;
}

/** Merged geometry of one material, positions relative to the tile origin. */
export interface ExpandedPart {
  material: string;
  position: Float32Array;
  normal: Float32Array;
  uv: Float32Array | null;
  color: Float32Array;
  index: Uint32Array;
}

export interface ExpandStats {
  slots: number;
  placed: number;
  /** Slots whose family is unknown or whose size no variant fits. */
  unmatched: number;
  vertices: number;
  triangles: number;
  byFamily: Record<string, number>;
}

interface Placement {
  slot: number;
  variant: ModuleVariant;
  mesh: ModuleMesh;
  caps: [ModuleMesh | null, ModuleMesh | null];
  copies: number;
  remap: Record<string, string> | undefined;
  /** Offset along x (glyphs of a text). */
  x0: number;
}

const glyphMaps = new WeakMap<ModuleFamily, Map<string, ModuleVariant>>();

/** The glyph family's variants by character. */
function glyphsOf(fam: ModuleFamily): Map<string, ModuleVariant> {
  let m = glyphMaps.get(fam);
  if (!m) {
    m = new Map(fam.variants.map((v) => [v.id, v]));
    glyphMaps.set(fam, m);
  }
  return m;
}

/** The files the slots of `data` need (to load them before expanding). */
export function filesFor(src: Pick<ModuleSource, 'catalog'>, s: SlotsFile, district: string | null): Set<string> {
  const files = new Set<string>();
  for (let i = 0; i < s.n; i++) {
    const famName = s.strings[s.family[i]];
    const fam = src.catalog.families[famName];
    if (!fam) {
      continue;
    }
    if (fam.text) {
      const g = src.catalog.families[fam.text.glyphs];
      if (g?.variants[0]) {
        files.add(g.variants[0].file);
      }
      continue;
    }
    const v = pickVariant(fam, famName, s.style[i] ? s.strings[s.style[i] - 1] : null, district, s.w[i] / 1000, s.h[i] / 1000, s.dd[i] / 1000, s.seed[i]);
    if (v) {
      files.add(v.file);
    }
  }
  return files;
}

/** Expands decoded slots (or a slots file's bytes) into merged parts per material. */
export function expandSlots(src: ModuleSource, data: SlotsFile | ArrayBuffer, opts: ExpandOptions): { parts: ExpandedPart[]; stats: ExpandStats } {
  const s = data instanceof ArrayBuffer ? decodeSlots(data) : data;
  const stats: ExpandStats = { slots: s.n, placed: 0, unmatched: 0, vertices: 0, triangles: 0, byFamily: {} };
  /* Pass 1: variants and sizes per output material. */
  const places: Placement[] = [];
  const counts = new Map<string, { v: number; i: number; uv: boolean }>();
  const outName = (m: string, remap: Record<string, string> | undefined): string => remap?.[m] ?? m;
  const countMesh = (m: ModuleMesh, times: number, remap: Record<string, string> | undefined): void => {
    for (const p of m.prims) {
      const name = outName(p.material, remap);
      let c = counts.get(name);
      if (!c) {
        c = { v: 0, i: 0, uv: false };
        counts.set(name, c);
      }
      c.v += (p.position.length / 3) * times;
      c.i += p.index.length * times;
      c.uv ||= p.moduleUv || !!opts.tiling[name];
    }
  };
  for (let i = 0; i < s.n; i++) {
    const famName = s.strings[s.family[i]];
    const fam = src.catalog.families[famName];
    const style = s.style[i] ? s.strings[s.style[i] - 1] : null;
    const w = s.w[i] / 1000;
    if (fam?.text) {
      // Text: glyph variants side by side, centred on r, w = cap height.
      const gf = src.catalog.families[fam.text.glyphs];
      const glyphs = gf ? glyphsOf(gf) : null;
      if (!glyphs || !style) {
        stats.unmatched++;
        continue;
      }
      const track = fam.text.track;
      const chars = [...style];
      const adv = chars.map((ch) => (glyphs.get(ch) ?? glyphs.get(' '))?.advance ?? 0.5);
      let x = (-(adv.reduce((q, a) => q + a + track, 0) - track) * w) / 2;
      chars.forEach((ch, k) => {
        const gv = glyphs.get(ch);
        const mesh = gv?.mesh ? src.mesh(gv.file, gv.mesh) : undefined;
        if (gv && mesh) {
          places.push({ slot: i, variant: gv, mesh, caps: [null, null], copies: 1, remap: fam.remap, x0: x });
          countMesh(mesh, 1, fam.remap);
        }
        x += (adv[k] + track) * w;
      });
      stats.placed++;
      stats.byFamily[famName] = (stats.byFamily[famName] ?? 0) + 1;
      continue;
    }
    const variant = fam ? pickVariant(fam, famName, style, opts.district, w, s.h[i] / 1000, s.dd[i] / 1000, s.seed[i]) : null;
    const mesh = variant ? src.mesh(variant.file, variant.mesh) : undefined;
    if (!fam || !variant || !mesh) {
      // An empty variant (nothing drawn) is fine; unknown families and missing meshes are not.
      if (!fam || (variant && !mesh)) {
        stats.unmatched++;
      }
      continue;
    }
    const copies = variant.repeat ? Math.max(1, variant.repeat.up ? Math.ceil(w / variant.repeat.pitch - 1e-6) : Math.round(w / variant.repeat.pitch)) : 1;
    const caps: [ModuleMesh | null, ModuleMesh | null] = [
      variant.repeat?.caps?.[0] ? (src.mesh(variant.file, variant.repeat.caps[0]) ?? null) : null,
      variant.repeat?.caps?.[1] ? (src.mesh(variant.file, variant.repeat.caps[1]) ?? null) : null,
    ];
    const own = style ? fam.styles?.[style]?.remap : undefined;
    const remap = fam.remap && own ? { ...fam.remap, ...own } : (own ?? fam.remap);
    places.push({ slot: i, variant, mesh, caps, copies, remap, x0: 0 });
    stats.placed++;
    stats.byFamily[famName] = (stats.byFamily[famName] ?? 0) + 1;
    countMesh(mesh, copies, remap);
    for (const cap of caps) {
      if (cap) {
        countMesh(cap, 1, remap);
      }
    }
  }
  /* Pass 2: fill. */
  interface Out extends ExpandedPart {
    nv: number;
    ni: number;
    tiling: [number, number] | undefined;
  }
  const outs = new Map<string, Out>();
  for (const [name, c] of [...counts].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    outs.set(name, {
      material: name,
      position: new Float32Array(c.v * 3),
      normal: new Float32Array(c.v * 3),
      uv: c.uv ? new Float32Array(c.v * 2) : null,
      color: new Float32Array(c.v * 4),
      index: new Uint32Array(c.i),
      nv: 0,
      ni: 0,
      tiling: opts.tiling[name],
    });
  }
  const [tox, toz] = opts.origin;
  for (const pl of places) {
    const i = pl.slot;
    const f = s.frame[i] * 4;
    const fx = s.frames[f];
    const fz = s.frames[f + 1];
    const nx = s.frames[f + 2];
    const nz = s.frames[f + 3];
    const rx = nz;
    const rz = -nx;
    const r = s.r[i] / 1000;
    const y = s.y[i] / 1000;
    const d = s.d[i] / 1000;
    const W = s.w[i] / 1000;
    const Hh = s.h[i] / 1000;
    const D = s.dd[i] / 1000;
    const v = pl.variant;
    const tints = [tintOf(v, 0, s.tint0[i], s.seed[i], opts.colors), tintOf(v, 1, s.tint1[i], s.seed[i], opts.colors)];
    const emit = (m: ModuleMesh, x0: number, w: number): void => {
      const eW = w - v.ref[0];
      const eH = Hh - v.ref[1];
      const eD = D - v.ref[2];
      for (const p of m.prims) {
        const o = outs.get(outName(p.material, pl.remap))!;
        const base = o.nv;
        const n = p.position.length / 3;
        const P = p.position;
        const N = p.normal;
        const tint = p.tint === null ? null : tints[p.tint];
        const sx = !p.dw && v.slice?.x ? v.slice.x : null;
        const sy = !p.dh && v.slice?.y ? v.slice.y : null;
        for (let k = 0; k < n; k++) {
          let lx = P[k * 3];
          let ly = P[k * 3 + 1];
          let lz = P[k * 3 + 2];
          if (p.dw) {
            lx += p.dw[k * 3] * eW;
            ly += p.dw[k * 3 + 1] * eW;
            lz += p.dw[k * 3 + 2] * eW;
          } else if (sx) {
            lx = lx <= sx[0] ? lx : lx >= sx[1] ? lx + eW : sx[0] + ((lx - sx[0]) * (sx[1] - sx[0] + eW)) / (sx[1] - sx[0]);
          }
          if (p.dh) {
            lx += p.dh[k * 3] * eH;
            ly += p.dh[k * 3 + 1] * eH;
            lz += p.dh[k * 3 + 2] * eH;
          } else if (sy) {
            ly = ly <= sy[0] ? ly : ly >= sy[1] ? ly + eH : sy[0] + ((ly - sy[0]) * (sy[1] - sy[0] + eH)) / (sy[1] - sy[0]);
          }
          if (p.dd) {
            lx += p.dd[k * 3] * eD;
            ly += p.dd[k * 3 + 1] * eD;
            lz += p.dd[k * 3 + 2] * eD;
          }
          const ar = r + x0 + lx;
          const ad = d + lz;
          const X = fx + rx * ar + nx * ad;
          const Y = y + ly;
          const Z = fz + rz * ar + nz * ad;
          const q = (base + k) * 3;
          o.position[q] = X;
          o.position[q + 1] = Y;
          o.position[q + 2] = Z;
          const mx = N[k * 3];
          const my = N[k * 3 + 1];
          const mz = N[k * 3 + 2];
          const wx = rx * mx + nx * mz;
          const wz = rz * mx + nz * mz;
          o.normal[q] = wx;
          o.normal[q + 1] = my;
          o.normal[q + 2] = wz;
          const c4 = (base + k) * 4;
          const cs = p.colorSize;
          const cr = p.color ? p.color[k * cs] : 1;
          const cg = p.color ? p.color[k * cs + 1] : 1;
          const cb = p.color ? p.color[k * cs + 2] : 1;
          const ca = p.color && cs === 4 ? p.color[k * cs + 3] : 1;
          o.color[c4] = tint ? cr * tint[0] : cr;
          o.color[c4 + 1] = tint ? cg * tint[1] : cg;
          o.color[c4 + 2] = tint ? cb * tint[2] : cb;
          o.color[c4 + 3] = tint ? ca * tint[3] : ca;
          if (o.uv) {
            const u2 = (base + k) * 2;
            if (p.moduleUv && p.uv) {
              o.uv[u2] = p.uv[k * 2];
              o.uv[u2 + 1] = p.uv[k * 2 + 1];
            } else if (o.tiling) {
              worldUv(o.uv, u2, X, Y, Z, wx, my, wz, tox, toz, o.tiling);
            }
          }
        }
        const I = p.index;
        const io = o.ni;
        for (let k = 0; k < I.length; k++) {
          o.index[io + k] = I[k] + base;
        }
        o.nv += n;
        o.ni += I.length;
      }
    };
    if (pl.copies > 1 || v.repeat) {
      const w = W / pl.copies;
      for (let c = 0; c < pl.copies; c++) {
        emit(pl.mesh, c * w, w);
      }
      if (pl.caps[0]) {
        emit(pl.caps[0], 0, W);
      }
      if (pl.caps[1]) {
        emit(pl.caps[1], 0, W);
      }
    } else {
      emit(pl.mesh, pl.x0, W);
    }
  }
  const parts: ExpandedPart[] = [];
  for (const o of outs.values()) {
    stats.vertices += o.nv;
    stats.triangles += o.ni / 3;
    parts.push({ material: o.material, position: o.position, normal: o.normal, uv: o.uv, color: o.color, index: o.index });
  }
  return { parts, stats };
}

/**
 * World-scale UV0 of a flat-face vertex, as the compiler's TileMesh.flatVertex computes it: the face frame of the
 * normal (floors: u east, v south; other faces: u right when facing the face, v down), metres / tiling, shifted by
 * whole repeats of the tile origin's projection. (x, y, z) are relative to the tile origin (ox, oz).
 */
function worldUv(out: Float32Array, at: number, x: number, y: number, z: number, nx: number, ny: number, nz: number, ox: number, oz: number, tiling: [number, number]): void {
  const [tw, th] = tiling;
  let ux: number;
  let uy: number;
  let uz: number;
  let vx: number;
  let vy: number;
  let vz: number;
  if (Math.abs(ny) > 0.7) {
    ux = 1;
    uy = 0;
    uz = 0;
    vx = 0;
    vy = 0;
    vz = 1;
  } else {
    const h = Math.hypot(nx, nz) || 1;
    const rx = nz / h;
    const rz = -nx / h;
    ux = rx;
    uy = 0;
    uz = rz;
    vx = -(ny * rz);
    vy = -(nz * rx - nx * rz);
    vz = -(-ny * rx);
  }
  const su = x * ux + y * uy + z * uz;
  const sv = x * vx + y * vy + z * vz;
  const ou = (ox * ux + oz * uz) % tw;
  const ov = (ox * vx + oz * vz) % th;
  out[at] = (su + ou) / tw;
  out[at + 1] = (sv + ov) / th;
}
