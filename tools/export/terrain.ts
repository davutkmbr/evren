/**
 * Terrain export for other runtimes (the Unreal port): the flight world's relief and coastline, built headlessly with
 * the same geo build the game runs at init (tools/headless/geo.ts), cut into square tiles and written as plain glTF
 * (float positions, no meshopt) with a JSON manifest.
 *
 *   npx tsx tools/export/terrain.ts --out <dir> [--holes <area export dir>[,...]] [--tile 1000] [--sea-floor 25]
 *                                   [--fan 0.05] [--only <i>_<j>[,...]] [--samples 400]
 *
 * Heights: the web terrain draws GeoQuery.heightAt, a bilinear surface over the 2048² height grid (23.4 m cells,
 * terrain/glsl/height.glsl.ts geoHeightExact). Each tile is a rectilinear grid whose lines are every height-grid node
 * line plus every 100 m line, so every vertex is an exact heightAt sample and every quad lies inside one bilinear cell.
 * A quad whose bilinear twist would leave the two-triangle split more than `--fan` metres off gets a centre vertex
 * (four triangles, a quarter of the error). The manifest reports the measured deviation against heightAt.
 *
 * Street holes: the street layer's compiled tiles carry their own ground, and the web game discards the terrain under
 * every live tile square (street/index.ts HoleMask, red channel). An importer that keeps those tiles as world geometry
 * cuts the terrain for good: quads inside a 100 m tile square of any area under `--holes` (world-compiler exports,
 * `<dir>/index.json`) are left out. The web keeps terrain inside landmark footprints because its street tiles leave
 * landmarks to the game's own models; exports compiled with `--landmarks block` carry the landmarks themselves, so the
 * whole square is cut.
 *
 * Vertex attributes: POSITION (metres, relative to the tile origin: the tile centre at sea level), NORMAL (GeoQuery
 * normalAt, identical on both sides of a tile edge), TEXCOORD_0 (world x, z in metres: world-scale UVs like the
 * compiler's tiles) and COLOR_0, the land-use surface weights averaged over the vertex's neighbourhood from the same
 * descriptor table the web terrain shader blends (terrain/landuse-table.ts):
 *   R = built fabric and paved ground, G = lawn and farmland, B = tree canopy (forest, cemeteries), A = sand;
 *   the rest (1 - sum) is bare ground. Slope rock and the sea floor are left to the material (normal, height).
 * Quads entirely deeper than `--sea-floor` metres are dropped; a tile without any quad is not written.
 *
 * Texture sets for the terrain material come from the approved assets through the world compiler's TextureBaker
 * (tools/assets/approved.json, public/textures), written to <out>/textures/ and listed as `materialDefs` in the
 * compiler's format, so importers share them with the street tiles.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as THREE from 'three';
import { WORLD_HALF_SIZE, WORLD_ORIGIN } from '../../src/core/geo-coords';
import { HEIGHT_GRID } from '../../src/world/geo/build/grid';
import { buildLandUseTable } from '../../src/world/terrain/landuse-table';
import { buildHeadlessGeo } from '../headless/geo';
import { defineMaterials, type MaterialDef } from '../world-compiler/src/materials';
import { TextureBaker, tilingOf } from '../world-compiler/src/textures';

const FORMAT = 'terrain-1';
/** Street tile size (m) of the world compiler's areas: holes are cut on this lattice. */
const STREET_TILE = 100;

interface Options {
  out: string;
  holes: string[];
  tile: number;
  seaFloor: number;
  fan: number;
  only: Set<string> | null;
  samples: number;
}

function parseOptions(argv: string[]): Options {
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const out = get('out');
  if (!out) {
    console.error('usage: terrain.ts --out <dir> [--holes <area dir>[,...]] [--tile 1000] [--sea-floor 25] [--fan 0.05] [--only i_j,...]');
    process.exit(2);
  }
  const tile = Number(get('tile') ?? 1000);
  if (!(tile > 0) || tile % STREET_TILE !== 0 || (2 * WORLD_HALF_SIZE) % tile !== 0) {
    throw new Error(`--tile must be a multiple of ${STREET_TILE} m that divides the world square`);
  }
  return {
    out: resolve(out),
    holes: (get('holes') ?? '').split(',').filter(Boolean).map((p) => resolve(p)),
    tile,
    seaFloor: Number(get('sea-floor') ?? 25),
    fan: Number(get('fan') ?? 0.05),
    only: get('only') ? new Set(get('only')!.split(',')) : null,
    samples: Number(get('samples') ?? 400),
  };
}

/** Street tile squares (100 m lattice keys "i_j") of the compiled areas: the terrain is cut under them. */
function readHoles(dirs: string[]): { cells: Set<string>; areas: { area: string; hash: string; tiles: number }[] } {
  const cells = new Set<string>();
  const areas: { area: string; hash: string; tiles: number }[] = [];
  for (const dir of dirs) {
    const file = join(dir, 'index.json');
    if (!existsSync(file)) {
      throw new Error(`--holes: no index.json in ${dir}`);
    }
    const index = JSON.parse(readFileSync(file, 'utf8')) as { area: string; hash: string; tileSize: number; tiles: { i: number; j: number }[] };
    if (index.tileSize !== STREET_TILE) {
      throw new Error(`${file}: tile size ${index.tileSize}, expected ${STREET_TILE}`);
    }
    for (const t of index.tiles) {
      cells.add(`${t.i}_${t.j}`);
    }
    areas.push({ area: index.area, hash: index.hash, tiles: index.tiles.length });
  }
  return { cells, areas };
}

/** Sorted grid lines over [a, b]: every height-grid node line, every 100 m line and both ends. */
function gridLines(a: number, b: number): number[] {
  const g = HEIGHT_GRID;
  const set = new Set<number>([a, b]);
  for (let k = Math.ceil((a - g.origin) / g.cell); ; k++) {
    const x = g.origin + k * g.cell;
    if (x > b) {
      break;
    }
    set.add(x);
  }
  for (let x = Math.ceil(a / STREET_TILE) * STREET_TILE; x <= b; x += STREET_TILE) {
    set.add(x);
  }
  return [...set].sort((p, q) => p - q);
}

/** Land-use surface weights (R built/paved, G lawn/farmland, B canopy, A sand) per class, from the web table. */
function surfaceWeights(): Float32Array {
  const table = Array.from({ length: 48 }, () => new THREE.Vector4());
  buildLandUseTable(table);
  const out = new Float32Array(16 * 4);
  for (let c = 0; c < 16; c++) {
    const a = table[c * 3];
    const b = table[c * 3 + 1];
    const d = table[c * 3 + 2];
    // a = (fabric, paved, canopy, lawn), b = (sand, farmland, rock, quay), d = (airport, cemetery, lights, irrigation)
    const built = Math.min(1, a.x + a.y + b.w + d.x * 0.65);
    const green = Math.min(1, a.w + b.y);
    const canopy = Math.min(1, a.z + d.y * 0.7);
    const sand = b.x;
    const sum = built + green + canopy + sand;
    const k = sum > 1 ? 1 / sum : 1;
    out.set([built * k, green * k, canopy * k, sand * k], c * 4);
  }
  return out;
}

interface TileMesh {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  colors: Uint8Array;
  indices: Uint16Array | Uint32Array;
  vertices: number;
  triangles: number;
  fans: number;
  holes: number;
  minY: number;
  maxY: number;
}

type Geo = ReturnType<typeof buildHeadlessGeo>;

function buildTile(geo: Geo, weights: Float32Array, x0: number, z0: number, size: number, holes: Set<string>, opts: Options): TileMesh | null {
  const xs = gridLines(x0, x0 + size);
  const zs = gridLines(z0, z0 + size);
  const nx = xs.length;
  const nz = zs.length;
  const cx = x0 + size / 2;
  const cz = z0 + size / 2;
  const h = new Float64Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      h[j * nx + i] = geo.heightAt(xs[i], zs[j]);
    }
  }
  // Quads kept, then the vertices they use (grid vertices on first use, fan centres appended).
  const tris: number[] = [];
  const used = new Int32Array(nx * nz).fill(-1);
  const verts: { x: number; z: number; y: number }[] = [];
  const vid = (i: number, j: number): number => {
    const k = j * nx + i;
    if (used[k] < 0) {
      used[k] = verts.length;
      verts.push({ x: xs[i], z: zs[j], y: h[k] });
    }
    return used[k];
  };
  // Up-facing (counter-clockwise seen from +Y) in the x-east, z-south frame.
  const tri = (a: number, b: number, c: number): void => {
    const A = verts[a];
    const B = verts[b];
    const C = verts[c];
    const up = (B.z - A.z) * (C.x - A.x) - (B.x - A.x) * (C.z - A.z);
    if (up >= 0) {
      tris.push(a, b, c);
    } else {
      tris.push(a, c, b);
    }
  };
  let fans = 0;
  let holeQuads = 0;
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const qx = (xs[i] + xs[i + 1]) / 2;
      const qz = (zs[j] + zs[j + 1]) / 2;
      if (holes.has(`${Math.floor(qx / STREET_TILE)}_${Math.floor(qz / STREET_TILE)}`)) {
        holeQuads++;
        continue;
      }
      const h00 = h[j * nx + i];
      const h10 = h[j * nx + i + 1];
      const h01 = h[(j + 1) * nx + i];
      const h11 = h[(j + 1) * nx + i + 1];
      if (Math.max(h00, h10, h01, h11) < -opts.seaFloor) {
        continue;
      }
      const v00 = vid(i, j);
      const v10 = vid(i + 1, j);
      const v01 = vid(i, j + 1);
      const v11 = vid(i + 1, j + 1);
      const twist = Math.abs(h00 - h10 - h01 + h11);
      if (twist / 4 > opts.fan) {
        const c = verts.length;
        verts.push({ x: qx, z: qz, y: geo.heightAt(qx, qz) });
        tri(c, v00, v10);
        tri(c, v10, v11);
        tri(c, v11, v01);
        tri(c, v01, v00);
        fans++;
      } else {
        tri(v00, v01, v10);
        tri(v10, v01, v11);
      }
    }
  }
  if (!tris.length) {
    return null;
  }
  const n = verts.length;
  const positions = new Float32Array(n * 3);
  const normals = new Float32Array(n * 3);
  const uvs = new Float32Array(n * 2);
  const colors = new Uint8Array(n * 4);
  const nrm = new THREE.Vector3();
  const lu = HEIGHT_GRID.cell / 2;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let k = 0; k < n; k++) {
    const v = verts[k];
    positions[k * 3] = v.x - cx;
    positions[k * 3 + 1] = v.y;
    positions[k * 3 + 2] = v.z - cz;
    geo.normalAt(v.x, v.z, nrm);
    normals.set([nrm.x, nrm.y, nrm.z], k * 3);
    uvs[k * 2] = v.x;
    uvs[k * 2 + 1] = v.z;
    minY = Math.min(minY, v.y);
    maxY = Math.max(maxY, v.y);
    // Land-use weights averaged over a 4 x 4 pattern spanning ±half a height cell (a few land-use cells).
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 0;
    for (let sj = 0; sj < 4; sj++) {
      for (let si = 0; si < 4; si++) {
        const c = geo.landUseAt(v.x + ((si - 1.5) / 1.5) * lu, v.z + ((sj - 1.5) / 1.5) * lu) * 4;
        r += weights[c];
        g += weights[c + 1];
        b += weights[c + 2];
        a += weights[c + 3];
      }
    }
    colors.set([Math.round((r / 16) * 255), Math.round((g / 16) * 255), Math.round((b / 16) * 255), Math.round((a / 16) * 255)], k * 4);
  }
  const indices = n <= 0xffff ? Uint16Array.from(tris) : Uint32Array.from(tris);
  return { positions, normals, uvs, colors, indices, vertices: n, triangles: tris.length / 3, fans, holes: holeQuads, minY, maxY };
}

/** A minimal binary glTF 2.0: one mesh, one primitive, one material slot named after the terrain material. */
function writeGlb(file: string, name: string, m: TileMesh, material: string): Buffer {
  const parts: Buffer[] = [];
  const views: object[] = [];
  const accessors: object[] = [];
  let offset = 0;
  const add = (data: ArrayBufferView, target: number): number => {
    const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    const pad = (4 - (buf.length % 4)) % 4;
    views.push({ buffer: 0, byteOffset: offset, byteLength: buf.length, target });
    parts.push(buf, Buffer.alloc(pad));
    offset += buf.length + pad;
    return views.length - 1;
  };
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < m.vertices; k++) {
    for (let c = 0; c < 3; c++) {
      min[c] = Math.min(min[c], m.positions[k * 3 + c]);
      max[c] = Math.max(max[c], m.positions[k * 3 + c]);
    }
  }
  const ARRAY = 34962;
  const ELEMENT = 34963;
  accessors.push({ bufferView: add(m.positions, ARRAY), componentType: 5126, count: m.vertices, type: 'VEC3', min, max });
  accessors.push({ bufferView: add(m.normals, ARRAY), componentType: 5126, count: m.vertices, type: 'VEC3' });
  accessors.push({ bufferView: add(m.uvs, ARRAY), componentType: 5126, count: m.vertices, type: 'VEC2' });
  accessors.push({ bufferView: add(m.colors, ARRAY), componentType: 5121, normalized: true, count: m.vertices, type: 'VEC4' });
  accessors.push({ bufferView: add(m.indices, ELEMENT), componentType: m.indices instanceof Uint16Array ? 5123 : 5125, count: m.indices.length, type: 'SCALAR' });
  const bin = Buffer.concat(parts);
  const json = {
    asset: { version: '2.0', generator: 'seventeenskies terrain export' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name, mesh: 0 }],
    meshes: [{ name, primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2, COLOR_0: 3 }, indices: 4, material: 0 }] }],
    materials: [{ name: material, pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 } }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: views,
    accessors,
  };
  let jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + bin.length, 8);
  const chunk = (len: number, type: number): Buffer => {
    const b = Buffer.alloc(8);
    b.writeUInt32LE(len, 0);
    b.writeUInt32LE(type, 4);
    return b;
  };
  const glb = Buffer.concat([header, chunk(jsonBuf.length, 0x4e4f534a), jsonBuf, chunk(bin.length, 0x004e4942), bin]);
  writeFileSync(file, glb);
  return glb;
}

/** Height of the written triangle surface at local (x, z), or null outside every triangle (a hole or cut sea floor). */
function meshHeight(m: TileMesh, x: number, z: number): number | null {
  const p = m.positions;
  const idx = m.indices;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3;
    const b = idx[t + 1] * 3;
    const c = idx[t + 2] * 3;
    const ax = p[a];
    const az = p[a + 2];
    const bx = p[b];
    const bz = p[b + 2];
    const qx = p[c];
    const qz = p[c + 2];
    if ((x < ax && x < bx && x < qx) || (x > ax && x > bx && x > qx) || (z < az && z < bz && z < qz) || (z > az && z > bz && z > qz)) {
      continue;
    }
    const d = (bz - qz) * (ax - qx) + (qx - bx) * (az - qz);
    if (d === 0) {
      continue;
    }
    const w0 = ((bz - qz) * (x - qx) + (qx - bx) * (z - qz)) / d;
    const w1 = ((qz - az) * (x - qx) + (ax - qx) * (z - qz)) / d;
    const w2 = 1 - w0 - w1;
    if (w0 >= -1e-9 && w1 >= -1e-9 && w2 >= -1e-9) {
      return w0 * p[a + 1] + w1 * p[b + 1] + w2 * p[c + 1];
    }
  }
  return null;
}

/** Deterministic pseudo-random sequence (the check points stay the same between runs). */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Texture sets of the terrain material's layers (approved CC0 sets the street tiles already use). */
const LAYERS: MaterialDef[] = [
  { id: 'terrain_built', color: 0xffffff, textures: { public: 'concrete' }, tiling: [2.7, 2.7], roughness: 0.9, surface: 'ground' },
  { id: 'terrain_green', color: 0xffffff, textures: { asset: 'Grass004' }, roughness: 1, surface: 'ground' },
  { id: 'terrain_soil', color: 0xffffff, textures: { asset: 'forest_ground_05' }, roughness: 1, surface: 'ground' },
  { id: 'terrain_rock', color: 0xffffff, textures: { asset: 'Rocks025' }, roughness: 0.9, surface: 'ground' },
];

async function bakeLayers(out: string): Promise<{ defs: object[]; textures: string[] }> {
  defineMaterials(LAYERS);
  const baker = new TextureBaker(out);
  const defs: object[] = [];
  for (const l of LAYERS) {
    const set = await baker.material(l.id);
    if (!set) {
      throw new Error(`terrain layer ${l.id}: texture set unavailable (${[...baker.problems.values()].join('; ')})`);
    }
    defs.push({
      id: l.id,
      baseColor: set.baseColor ? `textures/${set.baseColor.file}` : undefined,
      normal: set.normal ? `textures/${set.normal.file}` : undefined,
      orm: set.orm ? `textures/${set.orm.file}` : undefined,
      tiling: tilingOf(l.id),
      roughness: l.roughness ?? 1,
      metallic: 0,
      credit: set.credit,
    });
  }
  return { defs, textures: baker.written().map((t) => `textures/${t.file}`) };
}

function gitCommit(): string {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

async function main(): Promise<void> {
  const opts = parseOptions(process.argv.slice(2));
  const t0 = Date.now();
  const geo = buildHeadlessGeo();
  const tGeo = Date.now() - t0;
  const holes = readHoles(opts.holes);
  const weights = surfaceWeights();
  mkdirSync(join(opts.out, 'tiles'), { recursive: true });
  const { defs, textures } = await bakeLayers(opts.out);

  const n = (2 * WORLD_HALF_SIZE) / opts.tile;
  const first = -WORLD_HALF_SIZE / opts.tile;
  const tiles: { id: string; hash: string }[] = [];
  const written = new Set<string>();
  const meshes = new Map<string, { m: TileMesh; x0: number; z0: number }>();
  let triangles = 0;
  let bytes = 0;
  let fans = 0;
  let maxVertexError = 0;
  for (let j = first; j < first + n; j++) {
    for (let i = first; i < first + n; i++) {
      const id = `${i}_${j}`;
      if (opts.only && !opts.only.has(id)) {
        continue;
      }
      const x0 = i * opts.tile;
      const z0 = j * opts.tile;
      const m = buildTile(geo, weights, x0, z0, opts.tile, holes.cells, opts);
      if (!m) {
        continue;
      }
      const ox = x0 + opts.tile / 2;
      const oz = z0 + opts.tile / 2;
      // As written (float32): each vertex against heightAt at its own position.
      for (let k = 0; k < m.vertices; k++) {
        const e = Math.abs(m.positions[k * 3 + 1] - geo.heightAt(m.positions[k * 3] + ox, m.positions[k * 3 + 2] + oz));
        maxVertexError = Math.max(maxVertexError, e);
      }
      const glbName = `tiles/${id}.glb`;
      const glb = writeGlb(join(opts.out, glbName), `terrain_${id}`, m, 'terrain');
      written.add(`${id}.glb`);
      meshes.set(id, { m, x0, z0 });
      const hash = createHash('sha1').update(glb).digest('hex').slice(0, 16);
      tiles.push({
        id,
        i,
        j,
        bounds: { minX: x0, minZ: z0, maxX: x0 + opts.tile, maxZ: z0 + opts.tile },
        origin: [ox, 0, oz],
        glb: glbName,
        hash,
        bytes: glb.length,
        vertices: m.vertices,
        triangles: m.triangles,
        fans: m.fans,
        holeQuads: m.holes,
        minY: Math.round(m.minY * 100) / 100,
        maxY: Math.round(m.maxY * 100) / 100,
      } as { id: string; hash: string });
      triangles += m.triangles;
      bytes += glb.length;
      fans += m.fans;
    }
  }
  // Tiles of an earlier export that are not produced any more.
  if (!opts.only) {
    for (const f of readdirSync(join(opts.out, 'tiles'))) {
      if (f.endsWith('.glb') && !written.has(f)) {
        rmSync(join(opts.out, 'tiles', f));
      }
    }
  }

  // Deviation of the written surface from GeoQuery.heightAt at random land points, and reference points (x, z,
  // heightAt) for importers to check their collision against.
  const rand = rng(17);
  let maxErr = 0;
  let sumErr = 0;
  let count = 0;
  const ids = [...meshes.keys()];
  const samples: { x: number; z: number; y: number }[] = [];
  for (let k = 0; k < opts.samples * 25 && ids.length; k++) {
    const { m, x0, z0 } = meshes.get(ids[Math.floor(rand() * ids.length)])!;
    const x = x0 + rand() * opts.tile;
    const z = z0 + rand() * opts.tile;
    const want = geo.heightAt(x, z);
    if (want <= 0) {
      continue;
    }
    const got = meshHeight(m, x - x0 - opts.tile / 2, z - z0 - opts.tile / 2);
    if (got === null) {
      continue;
    }
    const e = Math.abs(got - want);
    maxErr = Math.max(maxErr, e);
    sumErr += e;
    count++;
    if (samples.length < opts.samples) {
      samples.push({ x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100, y: Math.round(geo.heightAt(Math.round(x * 100) / 100, Math.round(z * 100) / 100) * 1000) / 1000 });
    }
  }

  const index = {
    format: FORMAT,
    frame: { units: 'm', up: '+Y', east: '+X', south: '+Z', origin: WORLD_ORIGIN, halfSize: WORLD_HALF_SIZE },
    source: { commit: gitCommit(), heightGrid: { size: HEIGHT_GRID.size, cell: HEIGHT_GRID.cell, origin: HEIGHT_GRID.origin } },
    tileSize: opts.tile,
    seaFloor: opts.seaFloor,
    fanTolerance: opts.fan,
    holes: { tileSize: STREET_TILE, cells: holes.cells.size, areas: holes.areas },
    colors: { r: 'built and paved', g: 'lawn and farmland', b: 'tree canopy', a: 'sand' },
    material: 'terrain',
    materialDefs: defs,
    textures,
    tiles,
    check: {
      vertexMaxError: maxVertexError,
      surfaceMaxError: Math.round(maxErr * 1000) / 1000,
      surfaceMeanError: Math.round((sumErr / Math.max(1, count)) * 10000) / 10000,
      points: count,
    },
    samples,
    totals: { tiles: tiles.length, triangles, fans, bytes },
    hash: '',
  };
  index.hash = createHash('sha1')
    .update(JSON.stringify([tiles.map((t) => t.hash), defs]))
    .digest('hex')
    .slice(0, 16);
  writeFileSync(join(opts.out, 'index.json'), JSON.stringify(index, null, 1));
  console.log(
    `terrain: ${tiles.length} tiles, ${(triangles / 1e6).toFixed(2)}M triangles (${fans} fan quads), ${(bytes / 1048576).toFixed(0)} MB, ` +
      `${holes.cells.size} street holes from ${holes.areas.map((a) => a.area).join(', ') || 'no areas'}; ` +
      `heights: vertices max ${maxVertexError.toExponential(1)} m, surface max ${maxErr.toFixed(3)} m / mean ${(sumErr / Math.max(1, count)).toFixed(4)} m over ${count} land points; ` +
      `geo ${(tGeo / 1000).toFixed(1)} s, total ${((Date.now() - t0) / 1000).toFixed(0)} s -> ${opts.out}`,
  );
}

await main();
