/**
 * Exports the landmarks of the flight game for other runtimes (the Unreal game): mosques, bridges, towers,
 * skyscraper clusters, heritage sites and the city walls, generated headlessly by the game's own builders at full
 * detail (landmarks/sources.ts), one plain-float glTF per mesh plus a manifest.
 *
 *   npx tsx tools/export/landmarks.ts --out <dir> [--only id,id,...] [--walls <bake dir>] [--no-walls]
 *
 *   --only        landmark ids (heritage chunks export with their site; `neighbourhood-mosques` for the small mosques)
 *   --walls       the city-wall bake to read (default public/world/walls, written by `npm run compile:walls`)
 *
 * Output (<dir>):
 * - meshes/<key>.glb: one mesh, a primitive per material, local to its item's origin (web metres, +X east, +Y up,
 *   +Z south), UV0 in metres, COLOR_0 = linear tint x ambient occlusion. Meshes no longer produced are removed.
 * - textures/: the materials' maps, processed and named like the world compiler's (shared with the street tiles).
 * - index.json: { format, frame, materialDefs (world compiler shape), meshes: { key: { file, hash, triangles,
 *   bounds } }, items: [{ id, name, kind, family, mesh, origin [x, y, z], yawDeg, scale }] }. An item places its mesh
 *   at origin, turned by yawDeg about +Y (three.js rotation.y = -yawDeg, the web's heading; equal to the Unreal yaw)
 *   and scaled uniformly.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { FACADE_STYLES, Surf as HS } from '../../src/world/landmarks/heritage/build/surfaces';
import { buildHeadlessGeo } from '../headless/geo';
import { ROOT } from '../world-compiler/lib/areas.mjs';
import { banded, byzantine, facade } from './landmarks/composite';
import { bakeSet, isTinted, materialRecords, type LandmarkMaterial } from './landmarks/materials';
import { collectHeritage, collectMosques, collectStructures, collectWalls, type Collected } from './landmarks/sources';

const FORMAT = 1;
const args = process.argv.slice(2);
const argOf = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const outArg = argOf('--out');
if (!outArg) {
  console.error('usage: landmarks.ts --out <dir> [--only id,...] [--walls <dir>] [--no-walls]');
  process.exit(2);
}
const out = resolve(outArg);
const only = argOf('--only') ? new Set(argOf('--only')!.split(',')) : null;
const wallsDir = resolve(ROOT, argOf('--walls') ?? 'public/world/walls');
const t0 = performance.now();

/* Composite textures (built from approved sets baked in a cache folder, copied to the output when used). */
const cache = resolve(ROOT, 'node_modules/.cache/evren-world/landmarks');
const src = join(cache, 'sets');
const stone = await bakeSet(src, 'cmp_stone', { public: 'stone' }, [2.2, 2.2]);
const brick = await bakeSet(src, 'cmp_brick', { public: 'brick' }, [1, 1]);
const wallStone = await bakeSet(src, 'cmp_wall_stone', { asset: 'Bricks102' }, [4.8, 2.4]);
const marble = await bakeSet(src, 'cmp_marble', { asset: 'Marble019' }, [2, 2]);
const plaster = await bakeSet(src, 'cmp_plaster', { public: 'plaster' }, [2, 2]);
const gen = join(cache, 'generated');
const extra: LandmarkMaterial[] = [await byzantine(gen, wallStone, brick), await banded(gen, stone, brick)];
const facadeIds: string[] = [];
for (const style of FACADE_STYLES) {
  const base = style.base === HS.Marble ? [marble, 0.6] : style.base === HS.Plaster ? [plaster, 1] : style.base === HS.Brick ? [brick, 1] : [stone, 0.95];
  const m = await facade(gen, style, base[0] as typeof stone, base[1] as number);
  extra.push(m);
  facadeIds.push(m.id);
}
const tinted = (id: string): boolean => isTinted(id, extra);

/* Landmarks. */
const geo = buildHeadlessGeo();
const col: Collected = { items: [], meshes: new Map(), warnings: [] };
const timed = (label: string, fn: () => void): void => {
  const t = performance.now();
  fn();
  console.log(`${label}: ${((performance.now() - t) / 1000).toFixed(1)} s`);
};
timed('mosques', () => collectMosques(geo, only, tinted, col));
timed('structures', () => collectStructures(geo, only, tinted, col));
timed('heritage', () => collectHeritage(geo, only, tinted, (style) => facadeIds[style], col));
if (!args.includes('--no-walls') && (!only || only.has('walls'))) {
  timed('walls', () => collectWalls(wallsDir, tinted, col));
}

/* Meshes: written when their bytes change; stale files pruned. */
const meshDir = join(out, 'meshes');
mkdirSync(meshDir, { recursive: true });
const meshes: Record<string, { file: string; hash: string; triangles: number; bounds: [number[], number[]] }> = {};
const used = new Set<string>();
let written = 0;
for (const [key, mesh] of [...col.meshes].sort(([a], [b]) => a.localeCompare(b))) {
  if (!mesh.triangles()) {
    continue;
  }
  for (const m of mesh.prims.keys()) used.add(m);
  const bytes = await mesh.glb();
  const hash = createHash('sha1').update(bytes).digest('hex').slice(0, 16);
  const file = `meshes/${key}.glb`;
  const path = join(out, file);
  if (!existsSync(path) || createHash('sha1').update(readFileSync(path)).digest('hex').slice(0, 16) !== hash) {
    writeFileSync(path, bytes);
    written++;
  }
  meshes[key] = { file, hash, triangles: mesh.triangles(), bounds: mesh.bounds() };
}
if (!only) {
  for (const f of readdirSync(meshDir)) {
    if (!meshes[f.replace(/\.glb$/, '')]) rmSync(join(meshDir, f));
  }
}

/* Materials and textures. */
const materialDefs = await materialRecords(out, used, extra);
const textures = new Set(materialDefs.flatMap((m) => [m.baseColor, m.normal, m.orm]).filter((f): f is string => !!f).map((f) => f.replace('textures/', '')));
if (!only) {
  for (const f of readdirSync(join(out, 'textures'))) {
    if (!textures.has(f)) rmSync(join(out, 'textures', f));
  }
}

const items = col.items.filter((i) => meshes[i.mesh]);
const index = {
  format: FORMAT,
  frame: 'web metres: +X east, +Y up, +Z south; origin 41.045 N 29.02 E; a mesh is local to its item origin; yawDeg turns about +Y (three.js rotation.y = -yawDeg)',
  generated: new Date().toISOString().slice(0, 10),
  materialDefs,
  meshes,
  items,
};
writeFileSync(join(out, 'index.json'), JSON.stringify(index, null, 1));

const byKind = new Map<string, number>();
for (const i of items) byKind.set(i.kind, (byKind.get(i.kind) ?? 0) + 1);
const tris = Object.values(meshes).reduce((s, m) => s + m.triangles, 0);
console.log(`items ${items.length} (${[...byKind].map(([k, n]) => `${k} ${n}`).join(', ')}), meshes ${Object.keys(meshes).length} (${written} written), ${(tris / 1e6).toFixed(2)} M triangles, materials ${materialDefs.length}`);
for (const w of col.warnings) console.warn(`warning: ${w}`);
console.log(`landmarks export: ${out} in ${((performance.now() - t0) / 1000).toFixed(0)} s`);
