/**
 * Root index of the areas compiled for the flight game: `<world>/index.json` (public/world/index.json by default),
 * rewritten after every `--web` compile and runnable on its own:
 *
 *   npx tsx tools/world-compiler/src/world-index.ts [--world public/world]
 *
 * Lists every area folder whose index.json is a web profile build of that same area (folders compiled under another
 * name, e.g. before/after experiments, are left out) with what the game needs to pick the areas around the dragon
 * without loading each area's index: the tile-aligned rect, the compiled bounds, the tiles (grid cell and detail) and
 * the download sizes. Paths are relative to the root index.
 */
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT } from '../lib/areas.mjs';

export const WORLD_INDEX_FORMAT = 1;

interface Bounds2 {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

interface AreaIndexLike {
  format: number;
  area: string;
  hash: string;
  tileSize: number;
  areaBounds: Bounds2;
  rect: Bounds2;
  tiles: { id: string; i: number; j: number; detail?: string }[];
  totals?: { textureBytes: number; propBytes: number; glbBytes: number };
  web?: { sharedTextures?: string };
}

export interface WorldIndexArea {
  id: string;
  /** The area's index, relative to the root index. */
  index: string;
  hash: string;
  tileSize: number;
  rect: Bounds2;
  areaBounds: Bounds2;
  /** [i, j, detail] per tile ('f' full, 'g' greybox); the tile id is `${i}_${j}`. */
  tiles: [number, number, 'f' | 'g'][];
  bytes: { textures: number; props: number; glbs: number };
}

export interface WorldIndex {
  format: number;
  generated: string;
  sharedTextures: string;
  areas: WorldIndexArea[];
}

/** Scans `worldDir` and (re)writes its index.json; returns it. */
export function writeWorldIndex(worldDir: string): WorldIndex {
  const areas: WorldIndexArea[] = [];
  for (const id of readdirSync(worldDir).sort()) {
    const file = join(worldDir, id, 'index.json');
    if (id.startsWith('_') || !existsSync(file)) {
      continue;
    }
    let idx: AreaIndexLike;
    try {
      idx = JSON.parse(readFileSync(file, 'utf8')) as AreaIndexLike;
    } catch {
      continue; // being rewritten by a compile in progress; that compile rewrites the root index when done
    }
    if (idx.area !== id || !idx.web || idx.format < 1) {
      continue;
    }
    areas.push({
      id,
      index: `${id}/index.json`,
      hash: idx.hash,
      tileSize: idx.tileSize,
      rect: idx.rect,
      areaBounds: idx.areaBounds,
      tiles: idx.tiles.map((t) => [t.i, t.j, t.detail === 'greybox' ? 'g' : 'f']),
      bytes: { textures: idx.totals?.textureBytes ?? 0, props: idx.totals?.propBytes ?? 0, glbs: idx.totals?.glbBytes ?? 0 },
    });
  }
  const out: WorldIndex = { format: WORLD_INDEX_FORMAT, generated: new Date().toISOString(), sharedTextures: '_shared/tex/', areas };
  const target = join(worldDir, 'index.json');
  const tmp = `${target}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(out));
  renameSync(tmp, target);
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--world');
  const dir = resolve(ROOT, i >= 0 ? process.argv[i + 1] : 'public/world');
  const idx = writeWorldIndex(dir);
  console.log(JSON.stringify({ out: join(dir, 'index.json'), areas: idx.areas.map((a) => a.id) }));
}
