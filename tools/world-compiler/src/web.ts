/**
 * Web delivery profile (`--web`): the glbs, manifests and textures the flight game downloads per landing, cut to what
 * it reads and packed for the network. The default output (Blender import, inspection) keeps everything.
 *
 * Geometry (applied in compress.ts before welding, so vertices split only by a dropped attribute merge again):
 * - attributes the game never reads are dropped: `_WEATHER`, the lightmap `TEXCOORD_1` (no material samples it) and
 *   `TEXCOORD_0` of primitives whose material has no texture on channel 0; material `weather` extras and the node's
 *   lightmap record go with them;
 * - world-scale `TEXCOORD_0` is shifted per connected component by a whole number of UV_SHIFT repeats (invisible:
 *   the textures repeat, and the game's paving bands every 4 repeats stay in phase) and snapped to 1/UV_GRID of a
 *   repeat, so the float coordinates are small with zero low mantissa bits and compress well;
 * - normals are stored octahedral (8 bits, EXT_meshopt_compression's filter), attributes with meshopt's vertex codec
 *   version 1 at its highest level (three's decoder reads both versions).
 * Packing (packWeb, after the index is written):
 * - textures are re-encoded as WebP (sharp, from @gltf-transform/functions' tree; cached by content) and moved to the
 *   shared store `<world>/_shared/tex/<content hash>.webp` next to the area folders, so every area references the same
 *   file for the same texture and a browser that landed elsewhere already has it cached; the image URIs in every glb,
 *   the index's texture list and its material records follow, and the area's own textures/ folder is removed;
 * - tile glbs, manifests, slot files, prop glbs and the module palette are gzipped to `<file>.gz` (the runtime inflates them with DecompressionStream,
 *   sniffing the gzip magic so a host that adds Content-Encoding itself still works) and the index points at them.
 */
import { type Accessor, type Document, type Material, type Primitive, type TextureInfo } from '@gltf-transform/core';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { availableParallelism } from 'node:os';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import sharp from 'sharp';
import { ROOT } from '../lib/areas.mjs';
import { patchGlbJson } from './gltf';

/** Texture size cap (px) of the web profile unless --tex-max says otherwise: every area then shares the same files. */
export const WEB_TEX_MAX = 1024;
/** UV0 of a component is shifted by multiples of this many repeats (a multiple of the game's paving band period). */
const UV_SHIFT = 4;
/** UV0 snap: 1/UV_GRID of a repeat (a quarter texel of a 1024 px texture). */
const UV_GRID = 4096;
/** WebP quality per texture role (sharp percent); alpha (leak streaks) near lossless. */
const WEBP_QUALITY = { color: 84, normal: 86, orm: 82 } as const;
const WEBP_ALPHA_QUALITY = 90;
/** Bump when the WebP encoding changes (invalidates the cache). */
const WEBP_VERSION = 1;
const WEBP_CACHE = resolve(ROOT, 'node_modules/.cache/evren-world/webp');

let enabled = false;

export function setWebProfile(on: boolean): void {
  enabled = on;
}

export function webProfile(): boolean {
  return enabled;
}

function textureInfos(m: Material): (TextureInfo | null)[] {
  return [
    m.getBaseColorTexture() ? m.getBaseColorTextureInfo() : null,
    m.getNormalTexture() ? m.getNormalTextureInfo() : null,
    m.getOcclusionTexture() ? m.getOcclusionTextureInfo() : null,
    m.getMetallicRoughnessTexture() ? m.getMetallicRoughnessTextureInfo() : null,
    m.getEmissiveTexture() ? m.getEmissiveTextureInfo() : null,
  ];
}

/** Texture coordinate channels a material samples. */
function channelsOf(m: Material | null): Set<number> {
  const used = new Set<number>();
  for (const info of m ? textureInfos(m) : []) {
    if (info) {
      used.add(info.getTexCoord());
    }
  }
  return used;
}

function drop(prim: Primitive, semantic: string): void {
  const a = prim.getAttribute(semantic);
  if (!a) {
    return;
  }
  prim.setAttribute(semantic, null);
  if (a.listParents().every((p) => p.propertyType === 'Root')) {
    a.dispose();
  }
}

/** Shifts TEXCOORD_0 per connected component (by index) by whole UV_SHIFT repeats and snaps it to the UV grid. */
function compactUv(prim: Primitive, uv: Accessor): void {
  const src = uv.getArray();
  if (!(src instanceof Float32Array)) {
    return;
  }
  const n = uv.getCount();
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    parent[i] = i;
  }
  const find = (a: number): number => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]];
      a = parent[a];
    }
    return a;
  };
  const idx = prim.getIndices()?.getArray();
  if (idx) {
    for (let t = 0; t + 2 < idx.length; t += 3) {
      const a = find(idx[t]);
      const b = find(idx[t + 1]);
      const c = find(idx[t + 2]);
      parent[b] = a;
      parent[find(c)] = a;
    }
  }
  const minU = new Float64Array(n).fill(Infinity);
  const minV = new Float64Array(n).fill(Infinity);
  for (let i = 0; i < n; i++) {
    const r = find(i);
    minU[r] = Math.min(minU[r], src[i * 2]);
    minV[r] = Math.min(minV[r], src[i * 2 + 1]);
  }
  const out = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const su = Math.floor(minU[r] / UV_SHIFT) * UV_SHIFT;
    const sv = Math.floor(minV[r] / UV_SHIFT) * UV_SHIFT;
    out[i * 2] = Math.round((src[i * 2] - su) * UV_GRID) / UV_GRID;
    out[i * 2 + 1] = Math.round((src[i * 2 + 1] - sv) * UV_GRID) / UV_GRID;
  }
  uv.setArray(out);
}

/** Drops what the game does not read and compacts TEXCOORD_0 (see the header). Call before welding. */
export function prepareWeb(doc: Document): void {
  const root = doc.getRoot();
  for (const m of root.listMaterials()) {
    const extras = { ...(m.getExtras() as Record<string, unknown>) };
    if ('weather' in extras) {
      delete extras.weather;
      m.setExtras(extras);
    }
  }
  for (const node of root.listNodes()) {
    const extras = node.getExtras() as Record<string, unknown>;
    if ('lightmap' in extras) {
      const { lightmap: _, ...rest } = extras;
      node.setExtras(rest);
    }
  }
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const used = channelsOf(prim.getMaterial());
      for (const sem of prim.listSemantics()) {
        if (sem.startsWith('_WEATHER')) {
          drop(prim, sem);
        }
      }
      for (let ch = 1; ch < 4; ch++) {
        if (!used.has(ch)) {
          drop(prim, `TEXCOORD_${ch}`);
        }
      }
      if (!used.has(0)) {
        drop(prim, 'TEXCOORD_0');
      } else {
        const uv = prim.getAttribute('TEXCOORD_0');
        if (uv && uv.listParents().filter((p) => p.propertyType !== 'Root').length === 1) {
          compactUv(prim, uv);
        }
      }
    }
  }
}

/* ------------------------------------------------------------------------------------------------------------- */
/* Packing                                                                                                         */
/* ------------------------------------------------------------------------------------------------------------- */

interface IndexLike {
  tiles: { glb: string; manifest: string; bytes: number; lods?: { glb: string; bytes: number }[]; slots?: { file: string; bytes: number } }[];
  props?: Record<string, { glb: string; bytes?: number; lods?: { glb: string }[] }>;
  textures?: { file: string; mimeType: string; bytes: number }[];
  materialDefs?: unknown[];
  totals?: { textureBytes: number; propBytes: number; glbBytes: number };
  web?: unknown;
  modules?: { palette: string };
}

const roleOf = (file: string): keyof typeof WEBP_QUALITY => (/_(normal|nor_gl)/.test(file) ? 'normal' : /_(orm|arm)/.test(file) ? 'orm' : 'color');

/** Folder of the shared texture store for areas compiled into `outDir` (a sibling of the area folders). */
export const sharedTextureDir = (outDir: string): string => join(dirname(outDir), '_shared', 'tex');

/** Encodes one texture as WebP (cached by source content and settings) and returns the bytes. */
async function toWebp(src: string): Promise<Buffer> {
  const bytes = readFileSync(src);
  const role = roleOf(src);
  const key = createHash('sha256').update(bytes).update(`${WEBP_VERSION}:${role}:${WEBP_QUALITY[role]}:${WEBP_ALPHA_QUALITY}`).digest('hex').slice(0, 20);
  const cached = join(WEBP_CACHE, `${key}.webp`);
  if (!existsSync(cached)) {
    mkdirSync(WEBP_CACHE, { recursive: true });
    // Colour gets smart chroma subsampling; normal and ORM maps are data and keep plain subsampling.
    const out = await sharp(bytes).webp({ quality: WEBP_QUALITY[role], alphaQuality: WEBP_ALPHA_QUALITY, effort: 6, smartSubsample: role === 'color' }).toBuffer();
    writeFileAtomic(cached, out);
  }
  return readFileSync(cached);
}

/** Writes through a temporary file and a rename: parallel compiles share the store and the WebP cache. */
function writeFileAtomic(file: string, bytes: Uint8Array): void {
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  writeFileSync(tmp, bytes);
  renameSync(tmp, file);
}

/** Adds WebP bytes to the shared store under their content hash; returns the file name. */
function toStore(storeDir: string, webp: Uint8Array): string {
  const name = `${createHash('sha256').update(webp).digest('hex').slice(0, 16)}.webp`;
  const file = join(storeDir, name);
  if (!existsSync(file)) {
    mkdirSync(storeDir, { recursive: true });
    writeFileAtomic(file, webp);
  }
  return name;
}

const posix = (p: string): string => p.split(sep).join('/');

const gzAsync = promisify(gzip);
/** Same bytes as gzipSync at level 9; runs on the libuv thread pool (UV_THREADPOOL_SIZE, raised by run.mjs). */
const gzAsync9 = (bytes: Uint8Array): Promise<Uint8Array> => gzAsync(bytes, { level: 9 });

/**
 * Packs a compiled area for the web (see the header): WebP textures, gzipped glbs and manifests, index paths updated.
 * Returns the bytes before and after.
 */
export async function packWeb(outDir: string, index: IndexLike): Promise<{ before: Record<string, number>; after: Record<string, number> }> {
  const before: Record<string, number> = { textures: 0, tiles: 0, manifests: 0, props: 0, slots: 0 };
  const after: Record<string, number> = { textures: 0, tiles: 0, manifests: 0, props: 0, slots: 0 };
  /* Textures: every jpg/png (or webp of an earlier pack) in textures/ goes to the shared store as a webp. */
  const texDir = join(outDir, 'textures');
  const storeDir = sharedTextureDir(outDir);
  /** Source file name -> absolute path in the store. */
  const stored = new Map<string, string>();
  for (const f of existsSync(texDir) ? readdirSync(texDir) : []) {
    if (!/\.(jpe?g|png|webp)$/i.test(f)) {
      continue;
    }
    before.textures += statSync(join(texDir, f)).size;
    const webp = /\.webp$/i.test(f) ? readFileSync(join(texDir, f)) : await toWebp(join(texDir, f));
    after.textures += webp.byteLength;
    stored.set(f, join(storeDir, toStore(storeDir, webp)));
  }
  /** A path relative to `from` (a folder) that names a file of textures/, moved to the store; null when it is not one. */
  const moved = (rel: string, from: string): string | null => {
    const abs = resolve(from, decodeURIComponent(rel));
    const dst = dirname(abs) === texDir ? stored.get(abs.slice(texDir.length + 1)) : undefined;
    return dst ? posix(relative(from, dst)) : null;
  };
  for (const t of index.textures ?? []) {
    const dst = moved(t.file, outDir);
    if (dst) {
      t.bytes = statSync(resolve(outDir, dst)).size;
      t.file = dst;
      t.mimeType = 'image/webp';
    }
  }
  // Material records name their maps relative to the area folder (baseColor, normal, orm, weather maps).
  const retargetStrings = (v: unknown): unknown => {
    if (typeof v === 'string') {
      return moved(v, outDir) ?? v;
    }
    if (Array.isArray(v)) {
      return v.map(retargetStrings);
    }
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, retargetStrings(x)]));
    }
    return v;
  };
  if (index.materialDefs) {
    index.materialDefs = retargetStrings(index.materialDefs) as unknown[];
  }
  const retarget = (glb: Uint8Array, glbDir: string): Uint8Array =>
    patchGlbJson(glb, (json) => {
      for (const img of (json.images ?? []) as { uri?: string; mimeType?: string }[]) {
        const dst = img.uri && !img.uri.startsWith('data:') ? moved(img.uri, glbDir) : null;
        if (dst) {
          img.uri = dst;
          img.mimeType = 'image/webp';
        }
      }
    });
  /**
   * Gzips one glb (images retargeted) or json file in place; returns the new relative path at once and queues the
   * compression, which runs on the libuv thread pool (several files at a time; level 9 is the slow part of packing).
   */
  const jobs: (() => Promise<void>)[] = [];
  const pack = (rel: string, kind: string): string => {
    if (rel.endsWith('.gz')) {
      return rel;
    }
    const file = join(outDir, rel);
    if (!existsSync(file)) {
      return rel;
    }
    jobs.push(async () => {
      let bytes: Uint8Array = readFileSync(file);
      before[kind] += bytes.byteLength;
      if (rel.endsWith('.glb')) {
        bytes = retarget(bytes, dirname(file));
      }
      const packed = await gzAsync9(bytes);
      writeFileSync(`${file}.gz`, packed);
      rmSync(file);
      after[kind] += packed.byteLength;
    });
    return `${rel}.gz`;
  };
  const done = new Map<string, string>();
  const once = (rel: string, kind: string): string => {
    let r = done.get(rel);
    if (!r) {
      r = pack(rel, kind);
      done.set(rel, r);
    }
    return r;
  };
  for (const t of index.tiles) {
    t.glb = once(t.glb, 'tiles');
    t.manifest = once(t.manifest, 'manifests');
    for (const l of t.lods ?? []) {
      l.glb = once(l.glb, 'tiles');
    }
    if (t.slots) {
      t.slots.file = once(t.slots.file, 'slots');
    }
  }
  for (const p of Object.values(index.props ?? {})) {
    p.glb = once(p.glb, 'props');
    for (const l of p.lods ?? []) {
      l.glb = once(l.glb, 'props');
    }
  }
  if (index.modules) {
    index.modules.palette = once(index.modules.palette, 'props');
  }
  // A few files per thread-pool thread in flight (a district's glbs do not all fit in memory at once).
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(jobs.length, availableParallelism() * 2) }, async () => {
      while (next < jobs.length) {
        await jobs[next++]();
      }
    }),
  );
  let glbBytes = 0;
  for (const t of index.tiles) {
    for (const l of t.lods ?? []) {
      l.bytes = statSync(join(outDir, l.glb)).size;
    }
    t.bytes = statSync(join(outDir, t.glb)).size;
    if (t.slots) {
      t.slots.bytes = statSync(join(outDir, t.slots.file)).size;
    }
    glbBytes += (t.lods ?? []).filter((l, k, all) => all.findIndex((q) => q.glb === l.glb) === k).reduce((s, l) => s + l.bytes, 0);
  }
  let propBytes = 0;
  for (const p of Object.values(index.props ?? {})) {
    for (const g of [p.glb, ...(p.lods ?? []).map((l) => l.glb)]) {
      propBytes += statSync(join(outDir, g)).size;
    }
  }
  if (index.totals) {
    index.totals.textureBytes = after.textures;
    index.totals.propBytes = propBytes;
    index.totals.glbBytes = glbBytes;
  }
  rmSync(texDir, { recursive: true, force: true });
  index.web = { encoding: 'gzip', textures: 'webp', quality: WEBP_QUALITY, sharedTextures: posix(relative(outDir, storeDir)) + '/' };
  return { before, after };
}
