/**
 * Incremental compile cache (under node_modules/.cache/evren-world/, like the texture and WebP caches); `--force`
 * ignores it, `--cache off` disables it.
 * - Area stamp: the hash of every input of the run (compiler sources, the area's data file, the texture sources,
 *   the options). When it matches the stamp of the last compile into the same output folder and that output is
 *   intact (index.json and every file it names), the run stops before loading anything ("nothing changed").
 * - Tile cache (TileCache): per tile, the files it wrote (glbs and manifest, before --web packing) and its TileOut
 *   record, under the assembly key cli.ts computes from the tile's stage chain (stage-cache.ts) and the assembly
 *   code (sources.ts assemblySourceHash).
 * - FeatureIndex: the OSM features around a tile, for `--cache local` stage keys.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { threadId } from 'node:worker_threads';
import { ROOT } from '../lib/areas.mjs';
import type { TileOut } from './parallel/tile-out';

export const CACHE_ROOT = resolve(ROOT, 'node_modules/.cache/evren-world');
/** Bump when the cache layout or the TileOut record changes. */
const CACHE_VERSION = 1;
/** Local tile keys: OSM features within this distance (m) of a tile's square count as its inputs. */
export const TILE_MARGIN = 150;

const sha = (...parts: (string | Uint8Array)[]): string => {
  const h = createHash('sha256');
  for (const p of parts) {
    h.update(p);
    h.update('\0');
  }
  return h.digest('hex').slice(0, 24);
};

/** Files whose content defines what the compiler does (sources, district profiles, reference cameras, lock file). */
const SOURCE_ROOTS = ['tools/world-compiler/src', 'tools/world-compiler/districts', 'tools/world-compiler/lib', 'tools/world-compiler/s1', 'src', '.docs/street', 'tools/assets/approved.json', 'scripts/blender/camera-overrides.json', 'package-lock.json'];
/** Texture and model sources: listed by path, size and mtime (the texture cache stamps them the same way). */
const ASSET_ROOTS = ['assets-src', 'public/textures'];

function walk(rel: string, out: string[]): void {
  const abs = resolve(ROOT, rel);
  if (!existsSync(abs)) {
    return;
  }
  if (statSync(abs).isFile()) {
    out.push(rel);
    return;
  }
  for (const e of readdirSync(abs, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (e.name.startsWith('.') || e.name === 'node_modules') {
      continue;
    }
    const r = `${rel}/${e.name}`;
    if (e.isDirectory()) {
      walk(r, out);
    } else if (e.isFile()) {
      out.push(r);
    }
  }
}

let sourceMemo: string | null = null;
/** Hash of the compiler's code and fixed inputs (content) and of the texture / model sources (path, size, mtime). */
export function sourceHash(): string {
  if (sourceMemo) {
    return sourceMemo;
  }
  const h = createHash('sha256');
  const files: string[] = [];
  for (const r of SOURCE_ROOTS) {
    walk(r, files);
  }
  for (const f of files) {
    h.update(f).update('\0').update(readFileSync(resolve(ROOT, f))).update('\0');
  }
  const assets: string[] = [];
  for (const r of ASSET_ROOTS) {
    walk(r, assets);
  }
  for (const f of assets) {
    const st = statSync(resolve(ROOT, f));
    h.update(`${f}:${st.size}:${Math.round(st.mtimeMs)}\0`);
  }
  h.update(`node ${process.versions.node} cache ${CACHE_VERSION}`);
  sourceMemo = h.digest('hex').slice(0, 24);
  return sourceMemo;
}

/** Options that change the output (everything but --jobs, --force, --check, --out, --cache). */
export function optionsKey(args: readonly string[]): string {
  const skip = new Set(['--jobs', '--out', '--cache']);
  const flags = new Set(['--force', '--check']);
  const kept: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (skip.has(args[i])) {
      i++;
      continue;
    }
    if (!flags.has(args[i])) {
      kept.push(args[i]);
    }
  }
  return kept.join(' ');
}

/* ------------------------------------------------------------------------------------------------------------- */
/* Area stamp                                                                                                      */
/* ------------------------------------------------------------------------------------------------------------- */

const stampFile = (outDir: string): string => join(CACHE_ROOT, 'areas', `${sha(outDir)}.json`);

interface AreaStamp {
  key: string;
  outDir: string;
  indexHash: string;
  summary: unknown;
}

export function areaKey(parts: { source: string; data: Uint8Array; options: string; area: string }): string {
  return sha(parts.source, parts.data, parts.options, parts.area);
}

/** Every file index.json names (tiles, manifests, LODs, props, textures, graphs), relative to outDir. */
function indexFiles(outDir: string, index: Record<string, unknown>): string[] {
  const out: string[] = [];
  const tiles = (index.tiles ?? []) as { glb: string; manifest: string; lods?: { glb: string }[] }[];
  for (const t of tiles) {
    out.push(t.glb, t.manifest, ...(t.lods ?? []).map((l) => l.glb));
  }
  for (const p of Object.values((index.props ?? {}) as Record<string, { glb: string; lods?: { glb: string }[] }>)) {
    out.push(p.glb, ...(p.lods ?? []).map((l) => l.glb));
  }
  for (const t of (index.textures ?? []) as { file: string }[]) {
    out.push(t.file);
  }
  for (const g of [index.walkGraph, index.laneGraph] as ({ file?: string } | undefined)[]) {
    if (g?.file) {
      out.push(g.file);
    }
  }
  return out.map((f) => relative(outDir, resolve(outDir, f)));
}

/** The last run's summary when its stamp matches `key` and its output is intact, else null. */
export function readAreaStamp(outDir: string, key: string): AreaStamp | null {
  const f = stampFile(outDir);
  if (!existsSync(f)) {
    return null;
  }
  const stamp = JSON.parse(readFileSync(f, 'utf8')) as AreaStamp;
  const indexPath = join(outDir, 'index.json');
  if (stamp.key !== key || stamp.outDir !== outDir || !existsSync(indexPath)) {
    return null;
  }
  const index = JSON.parse(readFileSync(indexPath, 'utf8')) as Record<string, unknown>;
  if (index.hash !== stamp.indexHash || !indexFiles(outDir, index).every((p) => existsSync(resolve(outDir, p)))) {
    return null;
  }
  return stamp;
}

export function writeAreaStamp(outDir: string, key: string, indexHash: string, summary: unknown): void {
  const f = stampFile(outDir);
  mkdirSync(dirname(f), { recursive: true });
  writeAtomic(f, JSON.stringify({ key, outDir, indexHash, summary } satisfies AreaStamp));
}

export function clearAreaStamp(outDir: string): void {
  rmSync(stampFile(outDir), { force: true });
}

/* ------------------------------------------------------------------------------------------------------------- */
/* Tile entries                                                                                                    */
/* ------------------------------------------------------------------------------------------------------------- */

interface Box {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

/** Bounds of an OSM record: its x/z, and every flat [x, z, ...] coordinate array (ring, pts, holes). */
function boundsOf(rec: Record<string, unknown>): Box | null {
  const b: Box = { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity };
  const add = (x: number, z: number): void => {
    b.minX = Math.min(b.minX, x);
    b.maxX = Math.max(b.maxX, x);
    b.minZ = Math.min(b.minZ, z);
    b.maxZ = Math.max(b.maxZ, z);
  };
  if (typeof rec.x === 'number' && typeof rec.z === 'number') {
    add(rec.x, rec.z);
  }
  const flat = (v: unknown): void => {
    if (!Array.isArray(v)) {
      return;
    }
    if (v.length >= 2 && typeof v[0] === 'number') {
      for (let k = 0; k + 1 < v.length; k += 2) {
        add(v[k] as number, v[k + 1] as number);
      }
    } else {
      v.forEach(flat);
    }
  };
  for (const key of ['ring', 'pts', 'holes', 'rings', 'outer', 'inner']) {
    flat(rec[key]);
  }
  return b.minX <= b.maxX ? b : null;
}

/**
 * Digests of the OSM features around each tile. Features without coordinates (none today) count for every tile.
 */
export class FeatureIndex {
  private readonly items: { box: Box | null; digest: string }[] = [];

  constructor(data: Record<string, unknown>) {
    for (const layer of ['buildings', 'roads', 'rails', 'areas', 'lines', 'points']) {
      const list = (data[layer] ?? []) as Record<string, unknown>[];
      list.forEach((rec, k) => this.items.push({ box: boundsOf(rec), digest: sha(layer, String(k), JSON.stringify(rec)) }));
    }
  }

  /** Digest of every feature whose bounds come within `margin` of `b`. */
  digest(b: Box, margin = TILE_MARGIN): string {
    const h = createHash('sha256');
    for (const it of this.items) {
      const x = it.box;
      if (!x || (x.maxX >= b.minX - margin && x.minX <= b.maxX + margin && x.maxZ >= b.minZ - margin && x.minZ <= b.maxZ + margin)) {
        h.update(it.digest);
      }
    }
    return h.digest('hex').slice(0, 24);
  }
}

/**
 * `strict` (default): tile keys include the whole data file, so any OSM change rebuilds every tile of the area.
 * Area-wide plans (the crowd's seats, the street furniture plan, shop names) draw from one random stream across the
 * area, so an edit far away can shift a tile's details; strict keys never reuse such a tile. `local` keys only the
 * features within TILE_MARGIN (and the tile as the area setup made it): after an OSM refetch only the tiles around
 * the edits rebuild, at the price of that rare drift (compare with --check).
 */
export type TileKeyScope = 'strict' | 'local';

export class TileCache {
  private readonly dir: string;

  constructor(
    area: string,
    options: string,
    readonly outDir: string,
  ) {
    this.dir = join(CACHE_ROOT, 'tiles', `${area}-${sha(options).slice(0, 8)}`);
    mkdirSync(this.dir, { recursive: true });
  }

  private entry(tile: string, key: string): string {
    return join(this.dir, `${tile}.${key}`);
  }

  /** The cached record of `tile` under `key`, with its files copied back into outDir; null on a miss. */
  restore(tile: string, key: string): TileOut | null {
    const e = this.entry(tile, key);
    const rec = join(e, 'out.json');
    if (!existsSync(rec)) {
      return null;
    }
    const out = JSON.parse(readFileSync(rec, 'utf8')) as TileOut;
    if (!out.files.every((f) => existsSync(join(e, f.replaceAll('/', '__'))))) {
      return null;
    }
    for (const f of out.files) {
      copyFileSync(join(e, f.replaceAll('/', '__')), join(this.outDir, f));
    }
    return out;
  }

  /** Stores a freshly compiled tile (its files must still be the unpacked ones in outDir). */
  store(tile: string, key: string, out: TileOut): void {
    const e = this.entry(tile, key);
    const tmp = `${e}.${process.pid}-${threadId}.tmp`;
    rmSync(tmp, { recursive: true, force: true });
    mkdirSync(tmp, { recursive: true });
    for (const f of out.files) {
      copyFileSync(join(this.outDir, f), join(tmp, f.replaceAll('/', '__')));
    }
    writeFileSync(join(tmp, 'out.json'), JSON.stringify(out));
    rmSync(e, { recursive: true, force: true });
    renameSync(tmp, e);
  }

  /** Removes entries of this area and options other than `keep` (`<tile>.<key>`): older keys of the same tiles. */
  prune(keep: readonly string[]): number {
    const k = new Set(keep);
    let n = 0;
    for (const name of readdirSync(this.dir)) {
      if (!k.has(name) && !name.endsWith('.tmp')) {
        rmSync(join(this.dir, name), { recursive: true, force: true });
        n++;
      }
    }
    return n;
  }
}

function writeAtomic(file: string, text: string): void {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}
