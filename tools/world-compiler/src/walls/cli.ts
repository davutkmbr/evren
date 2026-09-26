/**
 * City-wall bake (.docs/planning/22-city-walls.md): places the wall kit along data/osm/walls.json over the flight
 * world's ground and writes the tiles the game streams (public/world/walls/, schema src/world/landmarks/walls/data/
 * baked.ts), plus the land-use corridors the geo build reserves (src/world/landmarks/walls/data/corridors.json) and the
 * wall-tower perch candidates (src/world/landmarks/walls/data/towers.json, perch-towers.ts).
 *
 *   npm run compile:walls                     # everything
 *   npm run compile:walls -- --plan           # plan and print the statistics only (no meshes)
 *   npm run compile:walls -- --out <dir>      # output folder (default public/world/walls)
 *
 * Separate from the street compiler (src/cli.ts): the walls run ~20 km around the historic peninsula and are drawn
 * from the air everywhere, not only in the compiled landing areas.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { CELL_TILES, encodeMeshes, WALLS_FORMAT, WALLS_TILE, type MeshArrays, type MeshKind, type WallsColliders, type WallsIndex, type WallsTile } from '../../../../src/world/landmarks/walls/data/baked';
import type { WallData } from '../../../../src/world/landmarks/walls/data/types';
import { latLonToLocal } from '../../../../src/core/geo-coords';
import { HERITAGE_FORTRESS_TOWERS } from '../../../../src/world/landmarks/heritage/data/fortresses';
import { isModelled } from '../../../../src/world/landmarks/claims';
import { osmGroundHeight } from '../../../../src/world/osm/shared/street-surface';
import { buildHeadlessGeo } from '../../../headless/geo';
import { buildPieces, LODS, mergeParts } from './build';
import { loadFootprints } from './buildings';
import { towerCandidates } from './perch-towers';
import { planWalls, type Site } from './plan';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const args = process.argv.slice(2);
const argOf = (name: string): string | null => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? null) : null;
};
const OUT = resolve(ROOT, argOf('--out') ?? 'public/world/walls');
const CORRIDORS = resolve(ROOT, 'src/world/landmarks/walls/data/corridors.json');
const TOWERS = resolve(ROOT, 'src/world/landmarks/walls/data/towers.json');
const log = (m: string): void => console.log(`[walls] ${m}`);

const t0 = performance.now();
const data = JSON.parse(readFileSync(resolve(ROOT, 'data/osm/walls.json'), 'utf8')) as WallData;
const geo = buildHeadlessGeo();
// Walls mapped on a modelled palace's grounds are its garden and court walls (OSM tags some castle_wall), not
// fortifications: the palace model owns that ground, so the wall kit leaves them out.
const palaces = geo.landmarks.filter((l) => l.kind === 'palace' && isModelled(l));
const onPalace = (pts: readonly number[]): string | null => {
  const n = pts.length / 2;
  for (const p of palaces) {
    let inside = 0;
    for (let i = 0; i < n; i++) {
      inside += Math.hypot(pts[i * 2] - p.x, pts[i * 2 + 1] - p.z) < p.radius ? 1 : 0;
    }
    if (inside * 2 >= n) {
      return p.id;
    }
  }
  return null;
};
const dropped: string[] = [];
data.lines = data.lines.filter((l) => {
  const p = onPalace(l.pts);
  return p ? (dropped.push(`${l.id}@${p}`), false) : true;
});
data.areas = data.areas.filter((a) => {
  const p = onPalace(a.ring);
  return p ? (dropped.push(`${a.id}@${p}`), false) : true;
});
if (dropped.length) {
  log(`left to the palaces: ${dropped.join(', ')}`);
}
const site: Site = {
  reservedTowers: HERITAGE_FORTRESS_TOWERS.map((t) => ({ ...latLonToLocal(t.lat, t.lon), r: t.r })),
  ground: (x, z) => osmGroundHeight(geo.heightAt(x, z), geo.coastDistance(x, z)),
  coast: (x, z) => geo.coastDistance(x, z),
  waterName: (x, z) => geo.waterNameAt(x, z),
  density: (x, z) => geo.densityAt(x, z),
};
const footprints = loadFootprints(ROOT);
const t1 = performance.now();
const plan = planWalls(data, site, footprints.fp);
const t2 = performance.now();
log(`geo + ${footprints.fp.list.length} building footprints from ${footprints.files} files ${Math.round(t1 - t0)} ms, plan ${Math.round(t2 - t1)} ms: ${plan.pieces.length} pieces, ${plan.owned.length} owned buildings`);
log(JSON.stringify(plan.stats));
if (plan.overlap) {
  const bad = Object.entries(plan.overlap.byStretch).filter(([, v]) => v.metres > 0 || v.towers > 0);
  const bad2 = Object.entries(plan.overlap.byStretch).filter(([, v]) => v.metres > 0 || v.towers > 0 || v.roadMetres > 0);
  log(`wall-vs-building/road check: ${plan.overlap.metres} m in buildings, ${plan.overlap.count} overlaps, ${plan.overlap.roadMetres} m on roads${bad2.length ? `: ${bad2.map(([k, v]) => `${k} ${v.metres} m / ${v.buildings} buildings / ${v.towers} towers / ${v.roadMetres} m road`).join('; ')}` : ''}`);
  void bad;
}

writeFileSync(
  CORRIDORS,
  `${JSON.stringify({
    $comment: 'Generated by npm run compile:walls (tools/world-compiler/src/walls). Land-use corridors the geo build reserves along the placed city walls: [half width, x0, z0, x1, z1, ...] in local metres. Data © OpenStreetMap contributors (ODbL); OpenHistoricalMap contributors (CC0).',
    lines: plan.corridors,
  })}\n`,
);

if (args.includes('--plan')) {
  process.exit(0);
}

const ground = site.ground;
const perchTowers = towerCandidates(plan.pieces, ground, footprints.fp, new Set(plan.owned), geo);
writeFileSync(
  TOWERS,
  `${JSON.stringify({
    $comment:
      'Generated by npm run compile:walls (tools/world-compiler/src/walls/perch-towers.ts). Wall-tower perch candidates: [osm id, x, z, grip y, ground y, outward x, outward z, neighbour top] in local metres, and the named gates [name, x, z]. Data © OpenStreetMap contributors (ODbL); OpenHistoricalMap contributors (CC0).',
    towers: perchTowers.candidates,
    // Player-facing names are Turkish: the untranslated OpenHistoricalMap names ("… Gate") are left out.
    gates: data.gates.filter((g) => g.name && !/ Gate$/.test(g.name)).map((g) => [g.name, Math.round(g.x * 10) / 10, Math.round(g.z * 10) / 10]),
  })}\n`,
);
log(`perch candidates: ${perchTowers.candidates.length} of ${perchTowers.towers} towers (${perchTowers.jagged} too jagged on top)`);
const built = buildPieces(plan.pieces, ground, log);
const t3 = performance.now();
log(`kit ${built.ms.join(' / ')} ms per LOD, ${built.tiles.size} tiles, ${built.colliders.length} colliders`);

if (existsSync(OUT)) {
  rmSync(OUT, { recursive: true, force: true });
}
mkdirSync(join(OUT, 'lod0'), { recursive: true });
mkdirSync(join(OUT, 'lod1'), { recursive: true });

const write = (rel: string, bytes: Uint8Array): number => {
  const gz = gzipSync(bytes, { level: 6 });
  writeFileSync(join(OUT, rel), gz);
  return gz.byteLength;
};

const tiles: WallsTile[] = [];
const cells = new Map<string, { cell: [number, number]; list: { tile: [number, number]; kind: MeshKind; data: MeshArrays }[] }>();
const lod2: { tile: [number, number]; kind: MeshKind; data: MeshArrays }[] = [];
const tris = [0, 0, 0];
const bytes = [0, 0, 0];
const verts = [0, 0, 0];
const sorted = [...built.tiles.values()].sort((a, b) => a.j - b.j || a.i - b.i);
for (const t of sorted) {
  const entry: WallsTile = { i: t.i, j: t.j, box: [...t.min, ...t.max].map((v) => Math.round(v * 10) / 10), tris: [] };
  for (let lod = 0; lod < LODS; lod++) {
    const meshes: { tile: [number, number]; kind: MeshKind; data: MeshArrays }[] = [];
    let n = 0;
    for (const kind of ['wall', 'leaf'] as const) {
      const m = mergeParts(t.parts[lod][kind]);
      if (m) {
        meshes.push({ tile: [t.i, t.j], kind, data: m });
        n += m.index.length / 3;
        verts[lod] += m.positions.length / 3;
      }
    }
    entry.tris.push(n);
    tris[lod] += n;
    if (!meshes.length) {
      continue;
    }
    if (lod === 0) {
      entry.lod0 = `lod0/${t.i}_${t.j}.bin.gz`;
      entry.bytes0 = write(entry.lod0, encodeMeshes(meshes));
      bytes[0] += entry.bytes0;
    } else if (lod === 1) {
      const ci = Math.floor(t.i / CELL_TILES);
      const cj = Math.floor(t.j / CELL_TILES);
      const k = `${ci}_${cj}`;
      let c = cells.get(k);
      if (!c) {
        c = { cell: [ci, cj], list: [] };
        cells.set(k, c);
      }
      c.list.push(...meshes);
    } else {
      lod2.push(...meshes);
    }
  }
  if (Number.isFinite(t.min[0])) {
    tiles.push(entry);
  }
}
const count = (list: { data: MeshArrays }[]): { vertices: number; indices: number } => ({
  vertices: list.reduce((s, m) => s + m.data.positions.length / 3, 0),
  indices: list.reduce((s, m) => s + m.data.index.length, 0),
});
const lod1 = [...cells.values()].map((c) => {
  const file = `lod1/${c.cell[0]}_${c.cell[1]}.bin.gz`;
  bytes[1] += write(file, encodeMeshes(c.list));
  return { cell: c.cell, file, ...count(c.list) };
});
bytes[2] = write('lod2.bin.gz', encodeMeshes(lod2));

const sources: string[] = [];
const srcIndex = new Map<number, number>();
const boxes: number[] = [];
const r2 = (v: number): number => Math.round(v * 100) / 100;
for (const { c, src } of built.colliders) {
  let k = srcIndex.get(src);
  if (k === undefined) {
    k = sources.push(`city-wall:${src}`) - 1;
    srcIndex.set(src, k);
  }
  boxes.push(r2(c.cx), r2(c.cy), r2(c.cz), r2(c.hx), r2(c.hy), r2(c.hz), Math.round(c.yaw * 1e4) / 1e4, k);
}
const colliders: WallsColliders = { sources, boxes };
writeFileSync(join(OUT, 'colliders.json'), JSON.stringify(colliders));

const index: WallsIndex = {
  format: WALLS_FORMAT,
  generated: new Date().toISOString(),
  tileSize: WALLS_TILE,
  cellTiles: CELL_TILES,
  tiles,
  lod1,
  lod2: { file: 'lod2.bin.gz', ...count(lod2) },
  colliders: 'colliders.json',
  owned: plan.owned,
  stats: {
    ...plan.stats,
    overlapByStretch: JSON.stringify(plan.overlap?.byStretch ?? {}),
    tiles: tiles.length,
    colliders: built.colliders.length,
    'tris.lod0': tris[0],
    'tris.lod1': tris[1],
    'tris.lod2': tris[2],
    'verts.lod0': verts[0],
    'verts.lod1': verts[1],
    'verts.lod2': verts[2],
    'bytes.lod0': bytes[0],
    'bytes.lod1': bytes[1],
    'bytes.lod2': bytes[2],
  },
};
writeFileSync(join(OUT, 'index.json'), JSON.stringify(index));
log(`tiles ${tiles.length}, triangles ${tris.join(' / ')}, gzip bytes ${bytes.map((b) => (b / 1e6).toFixed(1) + ' MB').join(' / ')}`);
log(`done in ${Math.round(performance.now() - t0)} ms (write ${Math.round(performance.now() - t3)} ms) -> ${OUT}`);
