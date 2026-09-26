#!/usr/bin/env node
/**
 * Runtime copies of the approved city-wall texture sets (tools/assets/approved.json, decision
 * .docs/assets/candidates/wall-scans.md) from the source cache assets-src/texture/<id>/ (fetch them first with
 * `node scripts/data/fetch-assets.mjs --id=Bricks102,castle_brick_broken_06,Rocks025,LeafSet029`):
 *
 *   node scripts/data/prep-wall-textures.mjs
 *
 * public/textures/wall_stone (Bricks102), wall_brick (castle_brick_broken_06), wall_core (Rocks025):
 * {albedo,normal,rough}.jpg at 1024 px on the long side; public/textures/wall_ivy (LeafSet029): {albedo,opacity}.jpg.
 * Resized with macOS `sips` (JPEG quality 85). All CC0 1.0; recorded in public/textures/LICENSES.md.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = join(ROOT, 'assets-src/texture');
const OUT = join(ROOT, 'public/textures');
const SIZE = 1024;

/** folder -> source id and the file-name suffix of each map. */
const SETS = {
  wall_stone: { id: 'Bricks102', maps: { albedo: '_Color.jpg', normal: '_NormalGL.jpg', rough: '_Roughness.jpg' } },
  wall_brick: { id: 'castle_brick_broken_06', maps: { albedo: '_diff_2k.jpg', normal: '_nor_gl_2k.jpg', rough: '_rough_2k.jpg' } },
  wall_core: { id: 'Rocks025', maps: { albedo: '_Color.jpg', normal: '_NormalGL.jpg', rough: '_Roughness.jpg' } },
  wall_ivy: { id: 'LeafSet029', maps: { albedo: '_Color.jpg', opacity: '_Opacity.jpg' } },
};

for (const [folder, set] of Object.entries(SETS)) {
  const dir = join(SRC, set.id);
  if (!existsSync(dir)) {
    throw new Error(`${set.id} is not cached: run node scripts/data/fetch-assets.mjs --id=${set.id}`);
  }
  const files = readdirSync(dir);
  mkdirSync(join(OUT, folder), { recursive: true });
  for (const [map, suffix] of Object.entries(set.maps)) {
    const src = files.find((f) => f.endsWith(suffix));
    if (!src) {
      throw new Error(`${set.id}: no *${suffix}`);
    }
    const out = join(OUT, folder, `${map}.jpg`);
    execFileSync('sips', ['-Z', String(SIZE), '-s', 'format', 'jpeg', '-s', 'formatOptions', '85', join(dir, src), '--out', out], { stdio: 'ignore' });
    console.log(`${folder}/${map}.jpg <- ${set.id}/${src}`);
  }
}
