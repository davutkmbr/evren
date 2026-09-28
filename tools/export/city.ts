/**
 * Exports the flight game's far city (city/: the baked OSM buildings of the far OSM layer in the coverage mask's OSM
 * cells, the procedural lots in the others) for other runtimes (the Unreal game), as the city workers build it at the
 * mid level (city/worker/tile.ts buildTile, level 1: compact walls, pitched roofs, domes, minarets), one plain-float
 * glTF per 1 km chunk plus a manifest.
 *
 *   npx tsx tools/export/city.ts --out <dir> [--streets <area dir>,...] [--only i_j,...] [--level 1]
 *
 *   --streets  compiled street areas (world-compiler output dirs: index.json + tiles/<id>.json[.gz]). Their tiles are
 *              exact holes: a building a street tile draws (its OSM id) or whose centroid lies on one of the area's
 *              tiles is left out. Street areas without a dir here are cut by their tile rect (osm/street-areas.ts).
 *   --only     chunk ids (tests); stale chunks are not pruned then.
 *
 * Nothing is drawn twice: street areas as above (the web game cuts the same buildings out with its street hole mask);
 * the landmark models' ground claims and the city walls' buildings are already out of the bake (osm-city-bake.ts); the
 * procedural lots stay off the street areas (their land use is cut to Landmark, as for the web's OSM regions).
 *
 * Output (<dir>):
 * - chunks/<i>_<j>.glb: the buildings owned (by centroid) by the chunk [i * 1000, (i + 1) * 1000) x [j * 1000, ...),
 *   local to the chunk origin [cx, 0, cz] (web metres, +X east, +Y up, +Z south), one primitive per material slot.
 *   NORMAL: smoothed within 35 degrees (flat walls, round domes); COLOR_0: linear base colour (the city shader's
 *   albedo before its facade detail, roof tops coloured as the shader does); TEXCOORD_0: facade metres (u along the
 *   wall, v up from the ground floor); TEXCOORD_1: (floor height m, style bits: window type | usage << 4 | roof top
 *   << 6, city/protocol.ts). Chunks whose bytes do not change are not rewritten; chunks no longer produced are removed.
 * - index.json: { format: 'city-1', frame, source, osmBase, chunkSize, level, materials: [{ id, roughness,
 *   metallic }], streets: { exact, rects }, chunks: [{ id, i, j, file, hash, origin, bounds, triangles, vertices,
 *   buildings, bytes }], totals }.
 *
 * Data © OpenStreetMap contributors, ODbL 1.0.
 */
import { Document, NodeIO } from '@gltf-transform/core';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { WorldBounds } from '../../src/core/contracts';
import { buildInitMessage, GeoWindowCutter } from '../../src/world/city/geo-window';
import { osmCoverageMask } from '../../src/world/city/osm/mask';
import { BAKE_BLOCK, BAKE_HALF, type CityBakeIndex, type DecodedBuildings, decodeBuildings } from '../../src/world/city/osm/format';
import { BASE_CELL, Kind, KIND_MASK } from '../../src/world/city/protocol';
import { emitCompact, emitNear, type LampSink } from '../../src/world/city/worker/emit';
import { GeoSampler } from '../../src/world/city/worker/geo-sampler';
import { layoutCell } from '../../src/world/city/worker/layout';
import { MeshWriter } from '../../src/world/city/worker/mesh-writer';
import { emitOsm } from '../../src/world/city/worker/osm-emit';
import { WorldData } from '../../src/world/city/worker/world-data';
import { streetAreaRects, STREET_TILE_SIZE } from '../../src/world/osm/street-areas';
import { buildHeadlessGeo } from '../headless/geo';
import { ROOT } from '../world-compiler/lib/areas.mjs';

const FORMAT = 'city-1';
const CHUNK = 1000;
const WORLD_HALF = 24000;
const CELLS = (WORLD_HALF * 2) / BASE_CELL;
const SMOOTH_COS = Math.cos((35 * Math.PI) / 180);

const args = process.argv.slice(2);
const argOf = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const outArg = argOf('--out');
if (!outArg) {
  console.error('usage: city.ts --out <dir> [--streets <area dir>,...] [--only i_j,...] [--level 1]');
  process.exit(2);
}
const out = resolve(outArg);
const only = argOf('--only') ? new Set(argOf('--only')!.split(',')) : null;
const LEVEL = Number(argOf('--level') ?? 1);
if (LEVEL !== 0 && LEVEL !== 1) {
  console.error('--level must be 0 or 1');
  process.exit(2);
}
const t0 = performance.now();
const log = (msg: string): void => console.log(`[city ${((performance.now() - t0) / 1000).toFixed(0)}s] ${msg}`);

/* Material slots: what the city shader draws per surface kind, reduced to four materials with vertex colour. */
const SLOTS = [
  { id: 'city_wall', roughness: 0.85, metallic: 0 },
  { id: 'city_glass', roughness: 0.15, metallic: 0.3 },
  { id: 'city_roof', roughness: 0.8, metallic: 0 },
  { id: 'city_metal', roughness: 0.45, metallic: 0.6 },
] as const;
const WALL = 0;
const GLASS = 1;
const ROOF = 2;
const METAL = 3;
const SLOT_OF_KIND: number[] = [];
for (const [kind, slot] of [
  [Kind.Wall, WALL], [Kind.Stone, WALL], [Kind.Wood, WALL], [Kind.Curtain, GLASS], [Kind.RoofTile, ROOF], [Kind.RoofFlat, ROOF],
  [Kind.RoofMetal, METAL], [Kind.Slab, WALL], [Kind.Railing, METAL], [Kind.Solar, GLASS], [Kind.Metal, METAL], [Kind.Beacon, METAL],
  [Kind.Glazed, GLASS], [Kind.Awning, WALL], [Kind.Chimney, WALL], [Kind.Dark, METAL], [Kind.Soffit, WALL],
] as const) {
  SLOT_OF_KIND[kind] = slot;
}

/* Street areas: exact holes from compiled manifests where given, tile rects otherwise. */
interface Holes {
  rects: WorldBounds[];
  ids: Set<number>;
  exact: string[];
  byRect: string[];
}
function readJson(file: string): unknown {
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  if (existsSync(`${file}.gz`)) return JSON.parse(gunzipSync(readFileSync(`${file}.gz`)).toString('utf8'));
  return null;
}
function streetHoles(dirs: readonly string[]): Holes {
  const holes: Holes = { rects: [], ids: new Set(), exact: [], byRect: [] };
  const done = new Set<string>();
  const areas = new Set(streetAreaRects().map((a) => a.id));
  for (const dir of dirs) {
    const index = readJson(join(dir, 'index.json')) as { area: string; tiles: { id: string; bounds: WorldBounds }[] } | null;
    if (!index?.tiles) {
      console.warn(`warning: no compiled area in ${dir}`);
      continue;
    }
    // One compile per street area (the first dir wins); scratch compiles of other ids are not street areas.
    if (done.has(index.area) || !areas.has(index.area)) {
      console.warn(`warning: ${dir} skipped (area ${index.area} ${done.has(index.area) ? 'already given' : 'is not a street area'})`);
      continue;
    }
    for (const t of index.tiles) {
      holes.rects.push(t.bounds);
      const m = readJson(join(dir, 'tiles', `${t.id}.json`)) as { buildings?: { osmId?: number }[] } | null;
      for (const b of m?.buildings ?? []) {
        if (typeof b.osmId === 'number') holes.ids.add(b.osmId);
      }
    }
    holes.exact.push(index.area);
    done.add(index.area);
  }
  for (const a of streetAreaRects()) {
    if (!done.has(a.id)) {
      holes.rects.push(a.rect);
      holes.byRect.push(a.id);
    }
  }
  return holes;
}
const holes = streetHoles((argOf('--streets') ?? '').split(',').filter(Boolean).map((d) => resolve(d)));
log(`street holes: ${holes.exact.length} areas from manifests (${holes.ids.size} buildings), ${holes.byRect.length} by tile rect`);
/** 100 m street tiles as a set, for the centroid test. */
const holeTiles = new Set<number>();
for (const r of holes.rects) {
  for (let z = r.minZ; z < r.maxZ; z += STREET_TILE_SIZE) {
    for (let x = r.minX; x < r.maxX; x += STREET_TILE_SIZE) {
      holeTiles.add(Math.floor(z / STREET_TILE_SIZE) * 100000 + Math.floor(x / STREET_TILE_SIZE));
    }
  }
}
const inHole = (x: number, z: number): boolean => holeTiles.has(Math.floor(z / STREET_TILE_SIZE) * 100000 + Math.floor(x / STREET_TILE_SIZE));

/* The world as the game builds it. */
const geo = buildHeadlessGeo();
const world = new WorldData(buildInitMessage(geo, null));
const cutter = new GeoWindowCutter(geo, holes.rects);
const mask = osmCoverageMask();
const bakeDir = resolve(ROOT, 'public/data/osm/city');
const bake = JSON.parse(readFileSync(join(bakeDir, 'index.json'), 'utf8')) as CityBakeIndex & { osmBase?: string; source?: string };
const blockFiles = new Map(bake.files.map((f) => [`${f.block[0]}_${f.block[1]}`, f.file]));
const blocks = new Map<string, DecodedBuildings | null>();
function block(x: number, z: number): DecodedBuildings | null {
  const key = `${Math.floor((x + BAKE_HALF) / BAKE_BLOCK)}_${Math.floor((z + BAKE_HALF) / BAKE_BLOCK)}`;
  if (!blocks.has(key)) {
    const file = blockFiles.get(key);
    blocks.set(key, file ? decodeBuildings(new Uint8Array(gunzipSync(readFileSync(join(bakeDir, file))))) : null);
    if (blocks.size > 8) blocks.delete(blocks.keys().next().value!);
  }
  return blocks.get(key)!;
}
log('geography built');

/** Baked records owned by the chunk: centroid inside, in an OSM cell, not a street building. */
function osmRecords(d: DecodedBuildings, x0: number, z0: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < d.header.count; k++) {
    const r0 = d.ringStart[k];
    let cx = 0;
    let cz = 0;
    for (let v = d.start[r0]; v < d.start[r0 + 1]; v++) {
      cx += d.xy[v * 2];
      cz += d.xy[v * 2 + 1];
    }
    cx /= d.nv[r0];
    cz /= d.nv[r0];
    if (cx < x0 || cx >= x0 + CHUNK || cz < z0 || cz >= z0 + CHUNK) continue;
    const ci = Math.floor((cx + WORLD_HALF) / BASE_CELL);
    const cj = Math.floor((cz + WORLD_HALF) / BASE_CELL);
    if (ci < 0 || cj < 0 || ci >= CELLS || cj >= CELLS || mask[cj * CELLS + ci] !== 1) continue;
    if (holes.ids.has(d.id[k]) || inHole(cx, cz)) continue;
    out.push(k);
  }
  return out;
}

/* glTF output: split the writer's vertices per material slot and normal group, add colour and facade UVs. */
const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fract = (x: number): number => x - Math.floor(x);
/** common.glsl.ts hash11. */
function hash11(p: number): number {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}
interface Prim {
  pos: number[];
  nrm: number[];
  col: number[];
  uv0: number[];
  uv1: number[];
  idx: number[];
}
function toPrims(w: MeshWriter): { prims: Prim[]; triangles: number; vertices: number } | null {
  const mesh = w.finish();
  if (!mesh) return null;
  const { position: P, color: C, facade: F, params: A, index: I } = mesh;
  const prims: Prim[] = SLOTS.map(() => ({ pos: [], nrm: [], col: [], uv0: [], uv1: [], idx: [] }));
  // Per source vertex and slot: normal groups [nx, ny, nz (accumulated), first face nx, ny, nz, output index].
  const groups = new Map<number, number[][]>();
  let triangles = 0;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t];
    const b = I[t + 1];
    const c = I[t + 2];
    const ex = P[b * 3] - P[a * 3];
    const ey = P[b * 3 + 1] - P[a * 3 + 1];
    const ez = P[b * 3 + 2] - P[a * 3 + 2];
    const fx = P[c * 3] - P[a * 3];
    const fy = P[c * 3 + 1] - P[a * 3 + 1];
    const fz = P[c * 3 + 2] - P[a * 3 + 2];
    let nx = ey * fz - ez * fy;
    let ny = ez * fx - ex * fz;
    let nz = ex * fy - ey * fx;
    const area = Math.hypot(nx, ny, nz);
    if (area < 1e-6) continue;
    nx /= area;
    ny /= area;
    nz /= area;
    // Slot and colour of the face (its first vertex's part): a wall-like face looking up is a compact roof top.
    const kind = C[a * 4 + 3] & KIND_MASK;
    let slot = SLOT_OF_KIND[kind] ?? WALL;
    let rgb: [number, number, number] = [C[a * 4] / 255, C[a * 4 + 1] / 255, C[a * 4 + 2] / 255];
    const wallLike = kind <= Kind.Curtain || kind === Kind.Glazed;
    if (wallLike && ny > 0.7) {
      const roofTop = (A[a * 4 + 3] >> 6) & 3;
      const h = hash11(A[a * 4] * 0.73 + 0.1);
      if (roofTop === 1) {
        slot = ROOF;
        rgb = [0.66 + (0.55 - 0.66) * h, 0.34 + (0.3 - 0.34) * h, 0.22];
      } else if (roofTop === 2) {
        slot = METAL;
        rgb = [0.55 + 0.1 * h, 0.55 + 0.1 * h, 0.55 + 0.1 * h];
      } else {
        slot = ROOF;
        rgb = [0.5 + 0.18 * h, 0.49 + 0.17 * h, 0.46 + 0.16 * h];
      }
    }
    const prim = prims[slot];
    for (const v of [a, b, c]) {
      const key = v * 4 + slot;
      let list = groups.get(key);
      if (!list) groups.set(key, (list = []));
      let g = list.find((q) => q[3] * nx + q[4] * ny + q[5] * nz >= SMOOTH_COS);
      if (!g) {
        const o = prim.pos.length / 3;
        const x = P[v * 3];
        const y = P[v * 3 + 1];
        const z = P[v * 3 + 2];
        prim.pos.push(x, y, z);
        prim.col.push(srgbToLinear(rgb[0]), srgbToLinear(rgb[1]), srgbToLinear(rgb[2]), 1);
        // Facade u from world position on WorldU faces (city.glsl.ts), else the writer's.
        let u = F[v * 4] / 16;
        if (F[v * 4 + 3] & 32) {
          const tl = Math.hypot(nz, nx) || 1;
          u = (x + w.ox) * (nz / tl) + (z + w.oz) * (-nx / tl);
        }
        prim.uv0.push(u, F[v * 4 + 1] / 16);
        prim.uv1.push(A[v * 4 + 1] / 10, A[v * 4 + 3]);
        g = [0, 0, 0, nx, ny, nz, o];
        list.push(g);
      }
      g[0] += nx * area;
      g[1] += ny * area;
      g[2] += nz * area;
      prim.idx.push(g[6]);
    }
    triangles++;
  }
  for (const [key, list] of groups) {
    const prim = prims[key & 3];
    for (const g of list) {
      const l = Math.hypot(g[0], g[1], g[2]) || 1;
      prim.nrm[g[6] * 3] = g[0] / l;
      prim.nrm[g[6] * 3 + 1] = g[1] / l;
      prim.nrm[g[6] * 3 + 2] = g[2] / l;
    }
  }
  return { prims, triangles, vertices: prims.reduce((s, p) => s + p.pos.length / 3, 0) };
}

async function glb(name: string, prims: readonly Prim[]): Promise<Uint8Array> {
  const doc = new Document();
  doc.getRoot().getAsset().generator = 'Evren city export (city-1)';
  const buffer = doc.createBuffer();
  const mesh = doc.createMesh(name);
  prims.forEach((p, s) => {
    if (!p.idx.length) return;
    const n = p.pos.length / 3;
    const material = doc.createMaterial(SLOTS[s].id).setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(SLOTS[s].roughness).setMetallicFactor(SLOTS[s].metallic);
    const acc = (id: string, type: 'VEC2' | 'VEC3' | 'VEC4' | 'SCALAR', array: Float32Array | Uint16Array | Uint32Array) => doc.createAccessor(`${SLOTS[s].id}_${id}`).setType(type).setArray(array).setBuffer(buffer);
    mesh.addPrimitive(
      doc
        .createPrimitive()
        .setAttribute('POSITION', acc('position', 'VEC3', new Float32Array(p.pos)))
        .setAttribute('NORMAL', acc('normal', 'VEC3', new Float32Array(p.nrm)))
        .setAttribute('COLOR_0', acc('color', 'VEC4', new Float32Array(p.col)))
        .setAttribute('TEXCOORD_0', acc('uv0', 'VEC2', new Float32Array(p.uv0)))
        .setAttribute('TEXCOORD_1', acc('uv1', 'VEC2', new Float32Array(p.uv1)))
        .setIndices(acc('index', 'SCALAR', n <= 65535 ? new Uint16Array(p.idx) : new Uint32Array(p.idx)))
        .setMaterial(material),
    );
  });
  const node = doc.createNode(name).setMesh(mesh);
  doc.getRoot().setDefaultScene(doc.createScene(name).addChild(node));
  return new NodeIO().writeBinary(doc);
}

/* Chunks. */
const chunkDir = join(out, 'chunks');
mkdirSync(chunkDir, { recursive: true });
interface ChunkRec {
  id: string;
  i: number;
  j: number;
  file: string;
  hash: string;
  origin: [number, number, number];
  bounds: [number[], number[]];
  triangles: number;
  vertices: number;
  buildings: number;
  bytes: number;
}
const chunks: ChunkRec[] = [];
const sink: LampSink = { pos: [], col: [] };
const n = (WORLD_HALF * 2) / CHUNK;
const per = CHUNK / BASE_CELL;
let written = 0;
for (let cj = 0; cj < n; cj++) {
  for (let ci = 0; ci < n; ci++) {
    const x0 = -WORLD_HALF + ci * CHUNK;
    const z0 = -WORLD_HALF + cj * CHUNK;
    const i = Math.floor(x0 / CHUNK);
    const j = Math.floor(z0 / CHUNK);
    const id = `${i}_${j}`;
    if (only && !only.has(id)) continue;
    const cx = x0 + CHUNK / 2;
    const cz = z0 + CHUNK / 2;
    const win = cutter.cut(x0, z0, x0 + CHUNK, z0 + CHUNK);
    const sampler = new GeoSampler(win, world.landUseSpec, world.heightSpec);
    const writer = new MeshWriter(cx, cz, 65536);
    let buildings = 0;
    const b0i = Math.round((x0 + WORLD_HALF) / BASE_CELL);
    const b0j = Math.round((z0 + WORLD_HALF) / BASE_CELL);
    for (let bj = 0; bj < per; bj++) {
      for (let bi = 0; bi < per; bi++) {
        // OSM cells draw the baked buildings below; the others the procedural lots.
        if (mask[(b0j + bj) * CELLS + b0i + bi] === 1) continue;
        for (const b of layoutCell(b0i + bi, b0j + bj, sampler, world).buildings) {
          buildings++;
          if (LEVEL === 0) emitNear(b, writer, sink);
          else emitCompact(b, writer, 1, sink);
        }
      }
    }
    const d = block(x0 + 1, z0 + 1);
    if (d) {
      for (const k of osmRecords(d, x0, z0)) {
        buildings++;
        emitOsm(d, k, writer, LEVEL, sampler);
      }
    }
    sink.pos.length = 0;
    sink.col.length = 0;
    const built = buildings ? toPrims(writer) : null;
    if (!built || !built.triangles) continue;
    const bytes = await glb(`city_${id}`, built.prims);
    const hash = createHash('sha1').update(bytes).digest('hex').slice(0, 16);
    const file = `chunks/${id}.glb`;
    const path = join(out, file);
    if (!existsSync(path) || createHash('sha1').update(readFileSync(path)).digest('hex').slice(0, 16) !== hash) {
      writeFileSync(path, bytes);
      written++;
    }
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const p of built.prims) {
      for (let v = 0; v < p.pos.length; v += 3) {
        for (let a = 0; a < 3; a++) {
          const w = p.pos[v + a] + (a === 0 ? cx : a === 2 ? cz : 0);
          if (w < min[a]) min[a] = w;
          if (w > max[a]) max[a] = w;
        }
      }
    }
    const round = (x: number): number => Math.round(x * 100) / 100;
    chunks.push({ id, i, j, file, hash, origin: [cx, 0, cz], bounds: [min.map(round), max.map(round)], triangles: built.triangles, vertices: built.vertices, buildings, bytes: bytes.length });
  }
  if ((cj + 1) % 8 === 0) log(`row ${cj + 1}/${n}: ${chunks.length} chunks, ${(chunks.reduce((s, c) => s + c.triangles, 0) / 1e6).toFixed(2)} M triangles`);
}
if (!only) {
  const keep = new Set(chunks.map((c) => `${c.id}.glb`));
  for (const f of readdirSync(chunkDir)) {
    if (!keep.has(f)) rmSync(join(chunkDir, f));
  }
}

const totals = {
  chunks: chunks.length,
  buildings: chunks.reduce((s, c) => s + c.buildings, 0),
  triangles: chunks.reduce((s, c) => s + c.triangles, 0),
  vertices: chunks.reduce((s, c) => s + c.vertices, 0),
  bytes: chunks.reduce((s, c) => s + c.bytes, 0),
  maxTriangles: Math.max(0, ...chunks.map((c) => c.triangles)),
};
const index = {
  format: FORMAT,
  frame: 'web metres: +X east, +Y up, +Z south; origin 41.045 N 29.02 E; a chunk mesh is local to its origin',
  generated: new Date().toISOString().slice(0, 10),
  source: bake.source ?? 'OpenStreetMap contributors, ODbL 1.0',
  osmBase: bake.osmBase ?? null,
  chunkSize: CHUNK,
  level: LEVEL,
  materials: SLOTS,
  streets: { exact: holes.exact, rects: holes.byRect },
  chunks,
  totals,
};
writeFileSync(join(out, 'index.json'), JSON.stringify(index, null, 1));
log(`${totals.chunks} chunks (${written} written), ${totals.buildings} buildings, ${(totals.triangles / 1e6).toFixed(2)} M triangles (max ${totals.maxTriangles} per chunk), ${(totals.bytes / 1e6).toFixed(0)} MB`);
console.log(`city export: ${out} in ${((performance.now() - t0) / 1000).toFixed(0)} s`);
