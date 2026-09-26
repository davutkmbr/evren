/**
 * Phase 24 stage S1 (.docs/planning/24-far-osm-layer.md): bakes the real OSM buildings and land use of the playable
 * square for the far OSM layer (format: src/world/city/osm/format.ts).
 *
 *   node scripts/data/osm-extract.mjs all              # once: the local extract index (data/osm-src/, gitignored)
 *   npx tsx scripts/data/osm-city-bake.ts [--refetch] [--jobs 4]
 *     -> public/data/osm/city/ (index.json, blocks/<bi>_<bj>.bin.gz, land.bin.gz) and src/world/city/osm/mask.json
 *
 * One map at every distance:
 * - Inside a flight-scale region's build rect, the buildings are the region layer's own: its data file, its infill
 *   (findInfill with the runtime's inputs) and its solids (buildings/build.ts collectSolids). Every other 2 km block
 *   is fetched with the same record code (fetch-osm.mjs --bbox, region profile, cached in data/osm-src/city-blocks/)
 *   and goes through the same functions, with its own infill (kept out of street areas and regions).
 * - Per building, the flight layer's plan (buildings/build.ts planSolid: archetype, storeys, wall height, roof shape
 *   and tints) is baked, so the far building and the region's building agree.
 * - Buildings the city walls draw (public/world/walls/index.json `owned`, when baked) are left out, like the OSM layers
 *   do.
 * One file per 2 km block holds every building (sorted by 500 m tile); the city workers derive their 1 km and 2 km
 * tiles from it (format.ts).
 * Two passes. Pass A reads the land-use polygons and the mapped footprint of every block and derives the coverage mask
 * from the hand-drawn land use. The game stamps those polygons into its land use inside the mask's OSM cells
 * (geo/build/osm-land.ts) and keeps mosque sites out of them, and pass B computes infill and the regions' solids on
 * exactly that geography (tools/headless/geo.ts buildGeoWith), so the bake matches the runtime.
 * Coverage mask (research/osm-city-coverage.md): a 250 m cell is OSM when the OSM footprint area over its 3 x 3
 * neighbourhood covers >= MASK_COVER of the geo-buildable land (one relaxed pass at MASK_RELAXED for cells mostly
 * surrounded by OSM cells), when the geo map does not build on it, or when it lies in a region. Buildings in the other
 * cells are dropped: the procedural city stays there.
 *
 * Data © OpenStreetMap contributors, ODbL 1.0.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import * as THREE from 'three';
import type { WorldBounds } from '../../src/core/contracts';
import { localToLatLon } from '../../src/core/geo-coords';
import { BAKE_BLOCK, BAKE_BLOCKS, BAKE_HALF, type BuildingFileHeader, CITY_BAKE_FORMAT, type CityBakeIndex, type CoverageMaskFile, decodeLand, encodeMask, FadeClass, FLAG, LAND_UNIT, LandClass, type LandFileHeader, MASK_CELL, MASK_SIZE, pack565, packContainer, RoofClass, shuffle16, Usage, XY_UNIT } from '../../src/world/city/osm/format';
import { LEVEL_SIZES } from '../../src/world/city/protocol';
import { landmarkClaims } from '../../src/world/landmarks/claims';
import { Arch } from '../../src/world/osm/buildings/archetypes';
import { collectSolids, planSolid, type Solid } from '../../src/world/osm/buildings/build';
import { findInfill } from '../../src/world/osm/buildings/infill';
import type { OsmArea, OsmBuilding, OsmData } from '../../src/world/osm/data';
import { osmRegions } from '../../src/world/osm/regions';
import { cutGeoWindows, reservedPads } from '../../src/world/osm/shared/foundation';
import { groundRect } from '../../src/world/osm/shared/ground';
import type { OsmWorkerBase } from '../../src/world/osm/shared/protocol';
import { buildStreetRaster, streetRasterInput } from '../../src/world/osm/shared/street-field';
import { StreetSurface } from '../../src/world/osm/shared/street-surface';
import { streetAreaRects } from '../../src/world/osm/street-areas';
import { buildGeoWith } from '../../tools/headless/geo';
import { ROOT } from '../../tools/world-compiler/lib/areas.mjs';
import { extractSource } from './lib/osm-local.mjs';

const args = process.argv.slice(2);
const REFETCH = args.includes('--refetch');
const JOBS = Number(args[args.indexOf('--jobs') + 1]) > 0 && args.includes('--jobs') ? Number(args[args.indexOf('--jobs') + 1]) : 4;
const BLOCK_DIR = resolve(ROOT, 'data/osm-src/city-blocks');
const OUT_DIR = resolve(ROOT, 'public/data/osm/city');
const MASK_FILE = resolve(ROOT, 'src/world/city/osm/mask.json');

const MASK_COVER = 0.05;
const MASK_RELAXED = 0.03;
/** Geo land use the procedural city builds on (city/geo-window.ts). */
const BUILDABLE = new Set([2, 3, 4, 5, 13]);
/** Blocks with fewer buildings than this get no infill run (no raster). */
const INFILL_MIN_BUILDINGS = 30;

const LAND_CLASSES: [LandClass, RegExp][] = [
  [LandClass.Park, /^(leisure=(park|garden|playground|dog_park|common|recreation_ground)|landuse=(recreation_ground|village_green))$/],
  [LandClass.Grass, /^(landuse=(grass|meadow)|natural=(grassland|heath))$/],
  [LandClass.Forest, /^(landuse=forest|natural=(wood|scrub))$/],
  [LandClass.Cemetery, /^(landuse=cemetery|amenity=grave_yard)$/],
  [LandClass.Farm, /^landuse=(farmland|orchard|vineyard|allotments|farmyard|greenhouse_horticulture)$/],
  [LandClass.Water, /^(natural=water|landuse=(reservoir|basin))$/],
  [LandClass.Industrial, /^landuse=(industrial|port|railway|quarry|landfill|construction|brownfield)$/],
  [LandClass.Residential, /^landuse=(residential|commercial|retail)$/],
  [LandClass.Pitch, /^leisure=(pitch|sports_centre|stadium|track|golf_course)$/],
];

const t0 = performance.now();
const log = (msg: string): void => console.error(`[city-bake ${((performance.now() - t0) / 1000).toFixed(0)}s] ${msg}`);
const inRect = (r: WorldBounds, x: number, z: number): boolean => x >= r.minX && x < r.maxX && z >= r.minZ && z < r.maxZ;
const overlaps = (a: WorldBounds, b: WorldBounds): boolean => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
const blockRect = (bi: number, bj: number): WorldBounds => ({ minX: -BAKE_HALF + bi * BAKE_BLOCK, maxX: -BAKE_HALF + (bi + 1) * BAKE_BLOCK, minZ: -BAKE_HALF + bj * BAKE_BLOCK, maxZ: -BAKE_HALF + (bj + 1) * BAKE_BLOCK });

// ---------------------------------------------------------------------------------------------------------------
// 1. Block data (fetch-osm.mjs --bbox, cached).
const blockFile = (bi: number, bj: number): string => resolve(BLOCK_DIR, `${bi}_${bj}.json`);
async function fetchBlocks(): Promise<void> {
  mkdirSync(BLOCK_DIR, { recursive: true });
  const todo: [number, number][] = [];
  for (let bj = 0; bj < BAKE_BLOCKS; bj++) {
    for (let bi = 0; bi < BAKE_BLOCKS; bi++) {
      if (REFETCH || !existsSync(blockFile(bi, bj))) {
        todo.push([bi, bj]);
      }
    }
  }
  log(`fetching ${todo.length} blocks (${JOBS} jobs)`);
  let done = 0;
  const run = async (): Promise<void> => {
    for (let t = todo.shift(); t; t = todo.shift()) {
      const [bi, bj] = t;
      const r = blockRect(bi, bj);
      const sw = localToLatLon(r.minX, r.maxZ);
      const ne = localToLatLon(r.maxX, r.minZ);
      await new Promise<void>((ok, fail) => {
        const p = spawn(process.execPath, ['scripts/data/fetch-osm.mjs', '--bbox', `${sw.lat},${sw.lon},${ne.lat},${ne.lon}`, '--out', blockFile(bi, bj)], { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'] });
        let err = '';
        p.stderr.on('data', (d) => (err += d));
        p.on('close', (code) => (code === 0 ? ok() : fail(new Error(`block ${bi}_${bj}: ${err.slice(-400)}`))));
      });
      if (++done % 50 === 0) {
        log(`  ${done} blocks fetched`);
      }
    }
  };
  await Promise.all(Array.from({ length: JOBS }, run));
}
await fetchBlocks();

// ---------------------------------------------------------------------------------------------------------------
// 2. Context: regions, claims, walls, helpers.
const regions = osmRegions().map((r) => ({ def: r, rect: groundRect(r.rect) }));
const regionFile = (url: string): string => resolve(ROOT, 'public', url.replace(/^\//, ''));
const streetRects = streetAreaRects().map((a) => a.rect);
const wallsIndex = resolve(ROOT, 'public/world/walls/index.json');
const wallOwned = new Set<number>(existsSync(wallsIndex) ? ((JSON.parse(readFileSync(wallsIndex, 'utf8')) as { owned?: number[] }).owned ?? []) : []);
if (!existsSync(wallsIndex)) {
  log('WARNING: public/world/walls/index.json missing (npm run compile:walls): wall-owned buildings stay in the bake');
}
const inAnyRegion = (x: number, z: number): boolean => regions.some((r) => inRect(r.rect, x, z));

interface Rec {
  s: Solid;
  cx: number;
  cz: number;
  area: number;
}
const centroidOf = (r: readonly number[]): [number, number] => {
  const n = r.length / 2;
  let x = 0;
  let z = 0;
  for (let i = 0; i < n; i++) {
    x += r[i * 2];
    z += r[i * 2 + 1];
  }
  return [x / n, z / n];
};
const areaOf = (r: readonly number[]): number => {
  let a = 0;
  const n = r.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += r[i * 2] * r[j * 2 + 1] - r[j * 2] * r[i * 2 + 1];
  }
  return a / 2;
};
const toRec = (s: Solid): Rec => {
  const [cx, cz] = centroidOf(s.ring);
  return { s, cx, cz, area: Math.abs(areaOf(s.ring)) };
};
/** Douglas-Peucker on a closed flat ring; null when it collapses. */
function simplifyRing(r: number[], tol: number): number[] | null {
  if (tol <= 0) {
    return r;
  }
  const pts: [number, number][] = [];
  for (let i = 0; i < r.length; i += 2) {
    pts.push([r[i], r[i + 1]]);
  }
  pts.push(pts[0]);
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop()!;
    let best = -1;
    let bestD = tol;
    const [ax, az] = pts[i0];
    const [bx, bz] = pts[i1];
    const dx = bx - ax;
    const dz = bz - az;
    const l2 = dx * dx + dz * dz;
    for (let i = i0 + 1; i < i1; i++) {
      const [px, pz] = pts[i];
      const t = l2 > 1e-9 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0;
      const d = Math.hypot(px - ax - t * dx, pz - az - t * dz);
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([i0, best], [best, i1]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    if (keep[i]) {
      out.push(pts[i][0], pts[i][1]);
    }
  }
  return out.length >= 6 && areaOf(out) > 0 ? out : null;
}

function reverse(r: number[]): number[] {
  const out: number[] = [];
  for (let i = r.length - 2; i >= 0; i -= 2) {
    out.push(r[i], r[i + 1]);
  }
  return out;
}

/** Land use: per polygon class, ring count, origin (f32) and rings (i16, LAND_UNIT m, 2 m simplification). */
function encodeLand(land: { cls: LandClass; rings: number[][] }[]): { bytes: Uint8Array; polygons: number } {
  const cls: number[] = [];
  const ringCount: number[] = [];
  const nvs: number[] = [];
  const org: number[] = [];
  const xy: number[] = [];
  for (const p of land) {
    const outer = simplifyRing(areaOf(p.rings[0]) < 0 ? reverse(p.rings[0]) : p.rings[0], 2);
    if (!outer) {
      continue;
    }
    // Holes are stored counter-clockwise too; the reader knows ring 0 is the outer ring.
    const holes = p.rings.slice(1).map((r) => simplifyRing(areaOf(r) < 0 ? reverse(r) : r, 2)).filter((r): r is number[] => !!r);
    const rings = [outer, ...holes].filter((r) => r.length / 2 < 65536);
    const [cx, cz] = centroidOf(rings[0]);
    if (!inRect({ minX: -BAKE_HALF, maxX: BAKE_HALF, minZ: -BAKE_HALF, maxZ: BAKE_HALF }, cx, cz)) {
      continue;
    }
    let far = false;
    for (const r of rings) {
      for (let q = 0; q < r.length; q++) {
        far ||= Math.abs(r[q] - (q % 2 ? cz : cx)) / LAND_UNIT > 32000;
      }
    }
    if (far) {
      continue;
    }
    cls.push(p.cls);
    ringCount.push(Math.min(255, rings.length));
    org.push(cx, cz);
    for (const r of rings.slice(0, 255)) {
      nvs.push(r.length / 2);
      for (let q = 0; q < r.length; q += 2) {
        xy.push(Math.round((r[q] - cx) / LAND_UNIT), Math.round((r[q + 1] - cz) / LAND_UNIT));
      }
    }
  }
  const header: Omit<LandFileHeader, 'blobs'> = { format: CITY_BAKE_FORMAT, polygons: cls.length, rings: nvs.length, vertices: xy.length / 2 };
  return { bytes: packContainer<LandFileHeader>(header, { cls: new Uint8Array(cls), rings: new Uint8Array(ringCount), nv: new Uint16Array(nvs), org: new Float32Array(org), xy: new Int16Array(xy) }), polygons: cls.length };
}

// ---------------------------------------------------------------------------------------------------------------
// 3. Pass A: land-use polygons and the mapped footprint per mask cell -> coverage mask. The mask reads the hand-drawn
// land use (what the procedural city would build on), so it does not depend on the OSM land use it gates.
const geoPlain = buildGeoWith(null);
const plainClaims = landmarkClaims({ landmarks: geoPlain.landmarks, smallMosqueSites: [] });
const N = MASK_SIZE;
const cellOf = (x: number, z: number): number => {
  const i = Math.floor((x + BAKE_HALF) / MASK_CELL);
  const j = Math.floor((z + BAKE_HALF) / MASK_CELL);
  return i < 0 || j < 0 || i >= N || j >= N ? -1 : j * N + i;
};
const footprint = new Float64Array(N * N);
const landSeen = new Set<number>();
const land: { cls: LandClass; rings: number[][] }[] = [];
let osmBase: string | null = null;
for (let bj = 0; bj < BAKE_BLOCKS; bj++) {
  for (let bi = 0; bi < BAKE_BLOCKS; bi++) {
    const rect = blockRect(bi, bj);
    const data = JSON.parse(readFileSync(blockFile(bi, bj), 'utf8')) as OsmData & { osmBase?: string };
    osmBase ??= data.osmBase ?? null;
    for (const s of collectSolids({ buildings: data.buildings.filter((b) => !wallOwned.has(b.id)), claims: plainClaims }, rect)) {
      const r = toRec(s);
      const k = inRect(rect, r.cx, r.cz) ? cellOf(r.cx, r.cz) : -1;
      if (k >= 0) {
        footprint[k] += r.area;
      }
    }
    for (const a of data.areas as OsmArea[]) {
      if (landSeen.has(a.id)) {
        continue;
      }
      const cls = LAND_CLASSES.find(([, re]) => re.test(a.kind))?.[0];
      if (cls === undefined) {
        continue;
      }
      landSeen.add(a.id);
      land.push({ cls, rings: [a.ring, ...(a.holes ?? [])] });
    }
  }
}
const buildable = new Float32Array(N * N);
const regionCell = new Uint8Array(N * N);
for (let j = 0; j < N; j++) {
  for (let i = 0; i < N; i++) {
    let b = 0;
    const S = 10;
    for (let sj = 0; sj < S; sj++) {
      for (let si = 0; si < S; si++) {
        b += BUILDABLE.has(geoPlain.landUseAt(-BAKE_HALF + i * MASK_CELL + ((si + 0.5) * MASK_CELL) / S, -BAKE_HALF + j * MASK_CELL + ((sj + 0.5) * MASK_CELL) / S)) ? 1 : 0;
      }
    }
    buildable[j * N + i] = b / (S * S);
    // Every cell a region touches: the region's own buildings stand in OSM cells up to its edge.
    const cell = { minX: -BAKE_HALF + i * MASK_CELL, maxX: -BAKE_HALF + (i + 1) * MASK_CELL, minZ: -BAKE_HALF + j * MASK_CELL, maxZ: -BAKE_HALF + (j + 1) * MASK_CELL };
    regionCell[j * N + i] = regions.some((r) => overlaps(r.rect, cell)) ? 1 : 0;
  }
}
const smooth = new Float32Array(N * N);
for (let j = 0; j < N; j++) {
  for (let i = 0; i < N; i++) {
    let f = 0;
    let b = 0;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const ii = i + di;
        const jj = j + dj;
        if (ii >= 0 && jj >= 0 && ii < N && jj < N) {
          f += footprint[jj * N + ii];
          b += buildable[jj * N + ii] * MASK_CELL * MASK_CELL;
        }
      }
    }
    smooth[j * N + i] = b > MASK_CELL * MASK_CELL * 0.9 ? f / b : 1;
  }
}
const mask = new Uint8Array(N * N);
for (let k = 0; k < N * N; k++) {
  mask[k] = regionCell[k] || buildable[k] < 0.3 || smooth[k] >= MASK_COVER ? 1 : 0;
}
// One relaxed pass: a cell just below the threshold joins when most of its neighbours are OSM (no frayed outline).
const relaxed = mask.slice();
for (let j = 1; j < N - 1; j++) {
  for (let i = 1; i < N - 1; i++) {
    const k = j * N + i;
    if (mask[k] || smooth[k] < MASK_RELAXED) {
      continue;
    }
    let nb = 0;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        nb += di || dj ? mask[k + dj * N + di] : 0;
      }
    }
    relaxed[k] = nb >= 5 ? 1 : 0;
  }
}
log(`pass A: ${relaxed.reduce((s, v) => s + v, 0)} OSM cells, ${land.length} land-use polygons`);
const landFile = encodeLand(land);

// 4. The geography the game builds from this bake: OSM land use stamped into the OSM cells, mosque sites kept out of
// them. Infill (which leaves parks and woods free) and the regions' own solids are computed on it, as at runtime.
const geo = buildGeoWith(decodeLand(landFile.bytes), relaxed);
/** The runtime's claims (buildings/index.ts): regions use exactly these. */
const layerClaims = landmarkClaims(geo);
/** Outside the regions: modelled landmarks only (no mosque site reaches into an OSM cell). */
const bakeClaims = landmarkClaims({ landmarks: geo.landmarks, smallMosqueSites: [] });

function surfaceOver(data: OsmData, rect: WorldBounds, area: WorldBounds): StreetSurface {
  const g = groundRect(rect);
  const base: OsmWorkerBase = { rect: g, area, ...cutGeoWindows(geo, g), reserved: reservedPads(geo), street: buildStreetRaster(streetRasterInput(data, (x, z) => geo.coastDistance(x, z)), g) };
  return new StreetSurface(base);
}

// 5. Pass B: region solids (the region layer's own set and infill), then every other block with its own infill.
const regionRecs: Rec[] = [];
let regionInfill = 0;
for (const { def, rect } of regions) {
  const file = regionFile(def.url);
  if (!existsSync(file)) {
    continue;
  }
  const data = JSON.parse(readFileSync(file, 'utf8')) as OsmData;
  const buildings = data.buildings.filter((b) => !wallOwned.has(b.id));
  const infill = findInfill(buildings, { roads: data.roads, areas: data.areas, rails: data.rails, keepOut: streetRects }, layerClaims, surfaceOver(data, def.rect, def.area), def.area);
  regionInfill += infill.parcels.length;
  for (const s of collectSolids({ buildings, claims: layerClaims, extra: infill.parcels }, rect)) {
    // Half-open ownership: a centroid on the shared edge of two regions belongs to one of them.
    const r = toRec(s);
    if (inRect(rect, r.cx, r.cz)) {
      regionRecs.push(r);
    }
  }
}
log(`regions: ${regionRecs.length} solids (${regionInfill} infill parcels)`);
const recs: Rec[] = regionRecs.filter((r) => inRect({ minX: -BAKE_HALF, maxX: BAKE_HALF, minZ: -BAKE_HALF, maxZ: BAKE_HALF }, r.cx, r.cz));
let blockInfill = 0;
for (let bj = 0; bj < BAKE_BLOCKS; bj++) {
  for (let bi = 0; bi < BAKE_BLOCKS; bi++) {
    const rect = blockRect(bi, bj);
    const data = JSON.parse(readFileSync(blockFile(bi, bj), 'utf8')) as OsmData;
    const buildings = data.buildings.filter((b) => !wallOwned.has(b.id));
    let extra: OsmBuilding[] = [];
    if (buildings.length >= INFILL_MIN_BUILDINGS) {
      const keepOut = [...streetRects, ...regions.map((r) => r.rect)].filter((k) => overlaps(k, rect));
      extra = findInfill(buildings, { roads: data.roads, areas: data.areas, rails: data.rails, keepOut }, bakeClaims, surfaceOver(data, rect, rect), rect).parcels;
      blockInfill += extra.length;
    }
    for (const s of collectSolids({ buildings, claims: bakeClaims, extra }, rect)) {
      const r = toRec(s);
      if (inRect(rect, r.cx, r.cz) && !inAnyRegion(r.cx, r.cz)) {
        recs.push(r);
      }
    }
  }
  log(`block row ${bj + 1}/${BAKE_BLOCKS}: ${recs.length} solids`);
}
const kept = recs.filter((r) => {
  const k = cellOf(r.cx, r.cz);
  return k >= 0 && relaxed[k] === 1;
});
const droppedProcedural = recs.length - kept.length;
const builtCells = new Uint8Array(N * N);
for (const r of kept) {
  builtCells[cellOf(r.cx, r.cz)] = 1;
}
log(`mask: ${relaxed.reduce((s, v) => s + v, 0)} OSM cells; ${kept.length} solids kept, ${droppedProcedural} in procedural cells`);

// ---------------------------------------------------------------------------------------------------------------
// 6. Building records.
interface Out {
  ring: number[];
  cx: number;
  cz: number;
  wallH: number;
  minH: number;
  rise: number;
  roof: number;
  arch: number;
  floors: number;
  floorH: number;
  flags: number;
  tint: number;
  roofTint: number;
  id: number;
}
const ROOF: Record<string, number> = { flat: RoofClass.Flat, hipped: RoofClass.Hipped, gabled: RoofClass.Gabled, pyramidal: RoofClass.Pyramidal, skillion: RoofClass.Skillion, dome: RoofClass.Dome, domes: RoofClass.Domes };
const INDUSTRIAL = /^(industrial|warehouse|factory|manufacture|hangar|storage_tank|depot)$/;
const c565 = (c: THREE.Color): number => {
  const h = c.getHex();
  return pack565((h >> 16) & 255, (h >> 8) & 255, h & 255);
};
const outs: Out[] = kept.map((r) => {
  const { plan, rise, wallH } = planSolid(r.s);
  const b = r.s.b;
  const total = wallH + rise;
  const usage = plan.arch === Arch.Mosque ? Usage.Worship : INDUSTRIAL.test(b.kind) ? Usage.Industrial : plan.office ? Usage.Office : Usage.Residential;
  const fade = total >= 30 ? FadeClass.Skyline : total >= 18 || r.area >= 700 || usage === Usage.Industrial ? FadeClass.Large : total >= 12 ? FadeClass.Mid : FadeClass.Small;
  return {
    ring: r.s.ring,
    cx: r.cx,
    cz: r.cz,
    wallH: Math.min(65535, Math.round(wallH * 10)),
    minH: Math.min(65535, Math.round(plan.minH * 10)),
    rise: Math.min(255, Math.round(rise * 10)),
    roof: ROOF[plan.roof] ?? RoofClass.Flat,
    arch: plan.arch,
    floors: Math.min(255, plan.floors),
    floorH: Math.min(255, Math.round(plan.floorH * 50)),
    flags: (plan.minaret ? FLAG.minaret : 0) | (r.s.infill ? FLAG.infill : 0) | (fade << FLAG.fadeShift) | (usage << FLAG.usageShift) | (total >= 30 ? FLAG.tower : 0),
    tint: c565(plan.tint),
    roofTint: c565(plan.roofTint),
    id: r.s.b.id,
  };
});

// ---------------------------------------------------------------------------------------------------------------
// 7. Files.
rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(resolve(OUT_DIR, 'blocks'), { recursive: true });
const index: CityBakeIndex = {
  format: CITY_BAKE_FORMAT,
  generated: new Date().toISOString(),
  source: `OpenStreetMap contributors, ODbL 1.0 (${extractSource()})`,
  osmBase,
  block: BAKE_BLOCK,
  files: [],
  land: { file: 'land.bin.gz', polygons: 0, bytes: 0 },
  stats: {},
};
const byBlock = new Map<string, Out[]>();
for (const o of outs) {
  const key = `${Math.floor((o.cx + BAKE_HALF) / BAKE_BLOCK)}_${Math.floor((o.cz + BAKE_HALF) / BAKE_BLOCK)}`;
  let list = byBlock.get(key);
  if (!list) {
    byBlock.set(key, (list = []));
  }
  list.push(o);
}
const TILE0 = LEVEL_SIZES[0];
writeFileSync(resolve(OUT_DIR, 'land.bin.gz'), gzipSync(landFile.bytes, { level: 9 }));
index.land = { file: 'land.bin.gz', polygons: landFile.polygons, bytes: statSync(resolve(OUT_DIR, 'land.bin.gz')).size };
let buildingBytes = 0;
let longRings = 0;
for (const [key, list] of byBlock) {
  const [bi, bj] = key.split('_').map(Number);
  const ox = -BAKE_HALF + (bi + 0.5) * BAKE_BLOCK;
  const oz = -BAKE_HALF + (bj + 0.5) * BAKE_BLOCK;
  const rows = list.map((o) => {
    let ring: number[] | null = o.ring;
    // At most 255 vertices (nv is a byte): simplify the rare long outlines until they fit.
    for (let tol = 0.25; ring && ring.length / 2 > 255; tol *= 2) {
      ring = simplifyRing(o.ring, tol);
    }
    if (ring !== o.ring) {
      longRings++;
    }
    return { o, ring: ring ?? o.ring.slice(0, 255 * 2), ti: Math.floor((o.cx + BAKE_HALF) / TILE0), tj: Math.floor((o.cz + BAKE_HALF) / TILE0) };
  });
  rows.sort((a, b) => a.tj - b.tj || a.ti - b.ti || a.o.id - b.o.id);
  const n = rows.length;
  const verts = rows.reduce((s, r) => s + r.ring.length / 2, 0);
  const nv = new Uint8Array(n);
  const xy = new Int16Array(verts * 2);
  const u8 = (): Uint8Array => new Uint8Array(n);
  const [rise, roof, arch, floors, floorH, flags] = [u8(), u8(), u8(), u8(), u8(), u8()];
  const [wallH, minH, tint, roofTint] = [new Uint16Array(n), new Uint16Array(n), new Uint16Array(n), new Uint16Array(n)];
  const id = new Int32Array(n);
  const tiles: BuildingFileHeader['tiles'] = [];
  let v = 0;
  let prevId = 0;
  rows.forEach((r, k) => {
    const last = tiles[tiles.length - 1];
    if (!last || last.i !== r.ti || last.j !== r.tj) {
      tiles.push({ i: r.ti, j: r.tj, first: k, count: 0 });
    }
    tiles[tiles.length - 1].count++;
    nv[k] = r.ring.length / 2;
    let px = 0;
    let pz = 0;
    for (let q = 0; q < r.ring.length; q += 2) {
      const x = Math.round((r.ring[q] - ox) / XY_UNIT);
      const z = Math.round((r.ring[q + 1] - oz) / XY_UNIT);
      xy[v++] = x - px;
      xy[v++] = z - pz;
      px = x;
      pz = z;
    }
    const o = r.o;
    wallH[k] = o.wallH;
    minH[k] = o.minH;
    rise[k] = o.rise;
    roof[k] = o.roof;
    arch[k] = o.arch;
    floors[k] = o.floors;
    floorH[k] = o.floorH;
    flags[k] = o.flags;
    tint[k] = o.tint;
    roofTint[k] = o.roofTint;
    const d = o.id - prevId;
    if (!Number.isInteger(d) || Math.abs(d) > 2 ** 31 - 1) {
      throw new Error(`OSM id step ${d} does not fit the i32 id blob (format.ts): widen it`);
    }
    id[k] = d;
    prevId = o.id;
  });
  const header: Omit<BuildingFileHeader, 'blobs'> = { format: CITY_BAKE_FORMAT, block: [bi, bj], origin: [ox, oz], count: n, vertices: verts, tiles };
  const bytes = gzipSync(
    packContainer<BuildingFileHeader>(header, { nv, xy: shuffle16(xy), wallH: shuffle16(wallH), minH: shuffle16(minH), rise, roof, arch, floors, floorH, flags, tint: shuffle16(tint), roofTint: shuffle16(roofTint), id }),
    { level: 9 },
  );
  const file = `blocks/${key}.bin.gz`;
  writeFileSync(resolve(OUT_DIR, file), bytes);
  index.files.push({ block: [bi, bj], file, count: n, bytes: bytes.length });
  buildingBytes += bytes.length;
}

index.stats = {
  solids: outs.length,
  regionSolids: regionRecs.length,
  infill: outs.filter((o) => o.flags & FLAG.infill).length,
  infillRegions: regionInfill,
  infillBlocks: blockInfill,
  droppedProcedural,
  longRings,
  wallOwnedApplied: existsSync(wallsIndex) ? 1 : 0,
  buildingBytes,
  landBytes: index.land.bytes,
  maskCells: relaxed.reduce((s, v) => s + v, 0),
  ms: Math.round(performance.now() - t0),
};
writeFileSync(resolve(OUT_DIR, 'index.json'), JSON.stringify(index) + '\n');
const maskFile: CoverageMaskFile = {
  format: CITY_BAKE_FORMAT,
  cell: MASK_CELL,
  size: N,
  osmBase,
  rule: `OSM where the OSM footprint area over the 3 x 3 cells covers >= ${MASK_COVER} of the geo-buildable land (relaxed ${MASK_RELAXED} with >= 5 OSM neighbours), where the geo map does not build (< 30 % buildable), or inside a flight-scale region`,
  bits: encodeMask(relaxed),
  built: encodeMask(builtCells),
};
writeFileSync(MASK_FILE, JSON.stringify(maskFile, null, 1) + '\n');
log(`done: ${JSON.stringify(index.stats)}`);
