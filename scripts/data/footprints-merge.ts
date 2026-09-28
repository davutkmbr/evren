/**
 * Building merge of the shared world compiler: OpenStreetMap buildings, Microsoft ML footprints where OSM has none,
 * row lots in merged outlines toward İBB's building count, and one storey estimate per building, for the whole OSM
 * clip box (the İstanbul province) in one pass, so every layer (slice, regions, far-city blocks, street areas, the
 * Unreal city) takes the same result by id. Rules: scripts/data/lib/footprints/rules.ts; research and approval:
 * seventeenskies-unreal .docs/assets/candidates/building-footprints.md (approved 2026-09-28).
 *
 *   node scripts/data/fetch-footprints.mjs all         # once: the pinned sources into data/footprints-src/
 *   npx tsx scripts/data/footprints-merge.ts           # -> data/footprints-src/merged/buildings.bin (+ summary.json)
 *
 * Then re-fetch the layers (they add the merge's footprints and lots and take its storeys): the Galata slice and the
 * street areas (fetch-osm.mjs --area), the regions (osm-regions.mjs fetch), the far-city blocks (osm-city-bake.ts
 * --refetch), recompile the street areas, `npm run check:map`.
 *
 * Also written (committed): data/footprints/coverage.md (buildings per ilçe before and after, against İBB),
 * data/footprints/ibb-mahalle.json (the İBB table joined to the OSM mahalle) and the published additions for ODbL 4.6
 * (data/footprints/microsoft-additions.csv.gz: the kept Microsoft footprints with source tile and synthetic id).
 *
 * Data © OpenStreetMap contributors (ODbL 1.0); Microsoft Global ML Building Footprints (CDLA-Permissive-2.0); İBB Açık
 * Veri Portalı (İBB Açık Veri Lisansı 1.0); GHS-BUILT-H R2023A (European Commission, JRC, CC BY 4.0). See
 * data/footprints/LICENSE.md.
 */
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { createGunzip, gzipSync } from 'node:zlib';
import { readOrigin, ROOT } from '../../tools/world-compiler/lib/areas.mjs';
import { CLIP_BBOX, extractSource, overpassLocal } from './lib/osm-local.mjs';
import { buildingRecord, cleanRing, highwayWidth, isClosed, joinRings, polygonsOf, projector, RAIL_KINDS, SKIP_HIGHWAYS } from './lib/osm-records.mjs';
import { laeaEurope, mollweide, openGeoTiff } from './lib/footprints/geotiff.mjs';
import { MERGED_FILE, writeMerged } from './lib/footprints/store.mjs';
import { boxOf, ccw, Grid, pointInRing, Polygons, type Ring, ringArea, ringCentroid, Segments } from './lib/footprints/geometry';
import {
  assignClasses,
  assignIds,
  capLevels,
  classifyMl,
  classOf,
  classQuotas,
  CAP_SAMPLES,
  Drop,
  DROP_NAMES,
  duplicates,
  FILL_MAX,
  FILL_MIN,
  FILL_RADIUS,
  FILL_SKIP,
  ghsFactor,
  hash01,
  IBB_CLASSES,
  joinMahalle,
  LevelsFrom,
  lotKey,
  mlKey,
  mlKind,
  normName,
  RAIL_HALF_WIDTH,
  SPLIT_MAX_LEVELS,
  SPLIT_TARGET,
  SPLIT_TIERS,
  splitBlock,
  splitLots,
  storeysInClass,
  STOREY,
  taggedLevels,
  WALL_CLEARANCE,
} from './lib/footprints/rules';

const SRC = resolve(ROOT, 'data/footprints-src');
const PUB = resolve(ROOT, 'data/footprints');
const t0 = performance.now();
const log = (m: string): void => console.error(`[footprints-merge ${((performance.now() - t0) / 1000).toFixed(0)}s] ${m}`);
const ORIGIN = readOrigin();
const project = projector(ORIGIN) as (lat: number, lon: number) => [number, number];
const DEG = Math.PI / 180;
const M_LAT = 111_132.954 - 559.822 * Math.cos(2 * ORIGIN.lat * DEG) + 1.175 * Math.cos(4 * ORIGIN.lat * DEG);
const M_LON = DEG * 6_378_137 * Math.cos(ORIGIN.lat * DEG);
const unproject = (x: number, z: number): [number, number] => [ORIGIN.lat - z / M_LAT, ORIGIN.lon + x / M_LON];
/** The playable square (src/core/geo-coords.ts WORLD_HALF_SIZE): the web game's far city. */
const HALF = 24_000;
const inSquare = (x: number, z: number): boolean => Math.abs(x) < HALF && Math.abs(z) < HALF;
const BB = `${CLIP_BBOX.south},${CLIP_BBOX.west},${CLIP_BBOX.north},${CLIP_BBOX.east}`;
/** Grid cell (m) of the store's records. */
const STORE_CELL = 1000;

// Kinds that are not a building in İBB's sense (not counted, not estimated): outbuildings, canopies, sheds.
const MINOR_KINDS = new Set(['shed', 'garage', 'garages', 'roof', 'carport', 'kiosk', 'hut', 'container', 'service', 'toilets', 'cabin', 'greenhouse', 'transformer_tower', 'water_tower', 'tower', 'bridge', 'ruins', 'collapsed', 'construction', 'no', 'grandstand', 'shelter', 'booth', 'guardhouse']);
// Ground where ML detections are vehicles, containers, boats, stalls or planes, not buildings.
const OPEN_AREAS: [string, RegExp][] = [
  ['parking', /^amenity=(parking|parking_space|bus_station|boat_storage)$/],
  ['pitch', /^leisure=(pitch|track)$/],
  ['platform', /^(railway|public_transport)=platform$/],
  ['pier', /^man_made=(pier|breakwater)$/],
  ['marina', /^leisure=marina$/],
  ['port', /^landuse=(port|harbour)$/],
  ['railway', /^landuse=railway$/],
  ['apron', /^aeroway=(apron|runway|taxiway|helipad)$/],
  ['construction', /^landuse=(construction|landfill|quarry)$/],
  ['greenhouses', /^landuse=greenhouse_horticulture$/],
  ['cemetery', /^(landuse=cemetery|amenity=grave_yard)$/],
  ['square', /^(place=square|highway=pedestrian|area:highway=.+|amenity=marketplace)$/],
];
// Land where an outline is not a residential row (no split): industry, schools, hospitals, worship, the military...
const NO_SPLIT_LAND = /^(landuse=(industrial|military|railway|port|harbour|depot|logistics|warehouse|brownfield|cemetery|religious|education|construction|garages|farmyard|quarry|landfill|government|institutional|civic_admin|municipality|public)|amenity=(school|university|college|kindergarten|hospital|clinic|prison|place_of_worship|fire_station|police|townhall|courthouse|bus_station|research_institute|community_centre|social_facility|library|theatre)|military=.+|aeroway=.+|leisure=(stadium|sports_centre|marina|park|garden)|man_made=(pier|breakwater))$/;

interface Json {
  type: string;
  id: number;
  tags?: Record<string, string>;
  geometry?: ({ lat: number; lon: number } | null)[];
  members?: { type: string; ref: number; role: string; geometry?: ({ lat: number; lon: number } | null)[] }[];
}
const q = (body: string): Json[] => (overpassLocal(`[out:json];(${body});out body geom;`) as { elements: Json[] }).elements;
const readJson = <T>(file: string): T => JSON.parse(readFileSync(file, 'utf8')) as T;

// ---------------------------------------------------------------------------------------------------------------------
// 0. Inputs: the pinned sources (fetch-footprints.mjs) and the OSM snapshot.
const manifestFile = resolve(SRC, 'manifest.json');
if (!existsSync(manifestFile)) {
  throw new Error(`${manifestFile} missing: run node scripts/data/fetch-footprints.mjs all`);
}
const manifest = readJson<{ sources: Record<string, any> }>(manifestFile);
for (const need of ['microsoft', 'ibb', 'ghsl']) {
  if (!manifest.sources[need]) {
    throw new Error(`source '${need}' missing: run node scripts/data/fetch-footprints.mjs ${need}`);
  }
}
const approvedIds = new Set(readJson<{ assets: { id: string; kind: string }[] }>(resolve(ROOT, 'tools/assets/approved.json')).assets.filter((a) => a.kind === 'data').map((a) => a.id));
for (const s of Object.values(manifest.sources)) {
  if (!approvedIds.has(s.id)) {
    throw new Error(`${s.id}: not approved in tools/assets/approved.json`);
  }
}
const summary: Record<string, any> = { rules: {}, ml: {}, splits: {}, levels: {}, ibb: {} };

// ---------------------------------------------------------------------------------------------------------------------
// 1. OSM buildings: the same records fetch-osm.mjs writes (0.35 m simplification, 12 m² outlines, 2 m² parts), plus
// outlines under construction (OSM's: no ML footprint may stand on them).
log('OSM buildings');
interface Osm {
  id: number;
  ring: Ring;
  holes: Ring[];
  kind: string;
  part: boolean;
  construction: boolean;
  hasParts?: boolean;
  levels: number;
  area: number;
  cx: number;
  cz: number;
  /** Vertex mean (the storey fill's neighbour centre). */
  vx: number;
  vz: number;
  tags: Record<string, any>;
}
const osm: Osm[] = [];
let osmBase: string | null = null;
{
  const res = overpassLocal(`[out:json];(way["building"](${BB});relation["building"](${BB});way["building:part"](${BB});relation["building:part"](${BB}););out body geom;`) as { osm3s?: { timestamp_osm_base?: string }; elements: Json[] };
  osmBase = res.osm3s?.timestamp_osm_base ?? null;
  const outlineIds = new Set<number>();
  for (const e of res.elements) {
    if (e.type === 'relation' && e.tags?.type === 'building') {
      for (const m of e.members ?? []) {
        if (m.role === 'outline') {
          outlineIds.add(m.type === 'relation' ? -m.ref : m.ref);
        }
      }
    }
  }
  for (const e of res.elements) {
    const t = e.tags ?? {};
    const part = !t.building && !!t['building:part'];
    if (!part && (t.building === 'no' || t.location === 'underground')) {
      continue;
    }
    if (e.type === 'relation' && t.type !== 'multipolygon') {
      continue;
    }
    for (const poly of polygonsOf(e, 0.35, part ? 2 : 12, project) as { outer: [number, number][]; holes: [number, number][][] }[]) {
      const rec = buildingRecord(e, poly, part) as Record<string, any>;
      const ring = rec.ring as Ring;
      const [cx, cz] = ringCentroid(ring);
      let vx = 0;
      let vz = 0;
      for (let k = 0; k < ring.length; k += 2) {
        vx += ring[k];
        vz += ring[k + 1];
      }
      osm.push({ id: rec.id, ring, holes: rec.holes ?? [], kind: rec.kind, part, construction: t.building === 'construction', hasParts: outlineIds.has(rec.id) || undefined, levels: taggedLevels(rec), area: Math.abs(ringArea(ring)), cx, cz, vx: vx / (ring.length / 2), vz: vz / (ring.length / 2), tags: rec });
    }
  }
}
// Outlines with building:part children (S3DB): their parts render instead; they count as one building.
{
  const parts = new Grid(50);
  osm.forEach((b, i) => b.part && parts.add(i, b.vx, b.vz, b.vx, b.vz));
  for (const b of osm) {
    if (b.part || b.hasParts) {
      continue;
    }
    const bx = boxOf(b.ring);
    parts.each(bx.minX, bx.minZ, bx.maxX, bx.maxZ, (i) => {
      if (!b.hasParts && pointInRing(b.ring, osm[i].vx, osm[i].vz)) {
        b.hasParts = true;
      }
    });
  }
}
const osmGrid = new Grid(64);
osm.forEach((b, i) => {
  const bx = boxOf(b.ring);
  osmGrid.add(i, bx.minX, bx.minZ, bx.maxX, bx.maxZ);
});
log(`OSM: ${osm.filter((b) => !b.part).length} outlines, ${osm.filter((b) => b.part).length} parts (snapshot ${osmBase})`);

// ---------------------------------------------------------------------------------------------------------------------
// 2. Context: streets, rails, walls, coastline, water, open ground, land use, mahalle and ilçe.
log('OSM context');
const streets = new Segments(64);
const rails = new Segments(64);
const walls = new Segments(64);
const coast = new Segments(128);
const water = new Polygons<string>(250);
const open = new Polygons<string>(250);
const noSplit = new Polygons<string>(250);
const lineOf = (e: Json): number[] => (e.geometry ?? []).filter((g): g is { lat: number; lon: number } => !!g).flatMap((g) => project(g.lat, g.lon));
const areaPolys = (e: Json): { outer: Ring; holes: Ring[] }[] =>
  (polygonsOf(e, 0.5, 1, project) as { outer: [number, number][]; holes: [number, number][][] }[]).map((p) => ({ outer: p.outer.flat(), holes: p.holes.map((h) => h.flat()) }));
{
  for (const e of q(`way["highway"](${BB});way["railway"](${BB});way["aeroway"~"^(runway|taxiway)$"](${BB});`)) {
    const t = e.tags ?? {};
    if (t.tunnel && t.tunnel !== 'no') {
      continue;
    }
    if (t.highway && !SKIP_HIGHWAYS.has(t.highway) && t.area !== 'yes') {
      streets.addLine(lineOf(e), highwayWidth(t).width / 2);
    } else if (t.railway && RAIL_KINDS.has(t.railway) && t.railway !== 'abandoned') {
      rails.addLine(lineOf(e), RAIL_HALF_WIDTH);
    } else if (t.aeroway) {
      const w = Number.parseFloat(t.width ?? '') || (t.aeroway === 'runway' ? 45 : 23);
      streets.addLine(lineOf(e), w / 2);
    }
  }
  log(`streets: ${streets.size} segments, rails: ${rails.size}`);
  for (const e of q(`way["natural"="coastline"](${BB});`)) {
    coast.addLine(lineOf(e), 0);
  }
  for (const e of q(`way["barrier"="city_wall"](${BB});way["historic"~"^(citywalls|city_wall|castle_wall)$"](${BB});way["wall"="castle_wall"](${BB});`)) {
    walls.addLine(lineOf(e), WALL_CLEARANCE);
  }
  const areaKind = (t: Record<string, string>): string | null => {
    for (const k of ['amenity', 'leisure', 'railway', 'public_transport', 'man_made', 'landuse', 'aeroway', 'place', 'area:highway', 'military']) {
      if (t[k]) {
        const kind = `${k}=${t[k]}`;
        if (OPEN_AREAS.some(([, re]) => re.test(kind)) || NO_SPLIT_LAND.test(kind)) {
          return kind;
        }
      }
    }
    if (t.highway === 'pedestrian' && t.area === 'yes') {
      return 'highway=pedestrian';
    }
    return null;
  };
  const areaQuery = [
    'way["natural"="water"]', 'relation["natural"="water"]', 'way["water"]', 'relation["water"]', 'way["waterway"="riverbank"]', 'relation["waterway"="riverbank"]', 'way["landuse"~"^(reservoir|basin)$"]', 'relation["landuse"~"^(reservoir|basin)$"]',
    'way["amenity"~"^(parking|parking_space|bus_station|boat_storage|marketplace|grave_yard|school|university|college|kindergarten|hospital|clinic|prison|place_of_worship|fire_station|police|townhall|courthouse|research_institute|community_centre|social_facility|library|theatre)$"]', 'relation["amenity"~"^(parking|grave_yard|school|university|college|hospital|place_of_worship|marketplace)$"]',
    'way["leisure"~"^(pitch|track|marina|stadium|sports_centre|park|garden)$"]', 'relation["leisure"~"^(pitch|track|marina|stadium|sports_centre|park|garden)$"]',
    'way["railway"="platform"]', 'way["public_transport"="platform"]', 'way["man_made"~"^(pier|breakwater)$"]', 'relation["man_made"~"^(pier|breakwater)$"]',
    'way["landuse"]', 'relation["landuse"]', 'way["aeroway"~"^(apron|runway|taxiway|helipad|aerodrome)$"]', 'relation["aeroway"]', 'way["military"]', 'relation["military"]',
    'way["place"="square"]', 'relation["place"="square"]', 'way["highway"="pedestrian"]["area"="yes"]', 'way["area:highway"]',
  ].map((s) => `${s}(${BB});`).join('');
  for (const e of q(areaQuery)) {
    const t = e.tags ?? {};
    if (e.type === 'way' && !(e.geometry && isClosed(e.geometry))) {
      continue;
    }
    const isWater = t.natural === 'water' || !!t.water || t.waterway === 'riverbank' || t.landuse === 'reservoir' || t.landuse === 'basin';
    const kind = isWater ? 'water' : areaKind(t);
    if (!kind) {
      continue;
    }
    for (const p of areaPolys(e)) {
      if (isWater) {
        water.add(p.outer, p.holes, 'water');
        continue;
      }
      const openKind = OPEN_AREAS.find(([, re]) => re.test(kind))?.[0];
      if (openKind) {
        open.add(p.outer, p.holes, openKind);
      }
      if (NO_SPLIT_LAND.test(kind)) {
        noSplit.add(p.outer, p.holes, kind);
      }
    }
  }
  log(`coast: ${coast.size} segments, walls: ${walls.size}, water: ${water.size} polygons, open ground: ${open.size}, no-split land: ${noSplit.size}`);
}
// Administrative areas: the 39 ilçe (admin_level 6) and their mahalle (admin_level 8).
interface Admin {
  id: number;
  name: string;
  outer: Ring;
  holes: Ring[];
}
const ilceList: Admin[] = [];
const mahalleList: Admin[] = [];
{
  // Boundary relations (type=boundary): rings assembled from their outer and inner member ways, 2 m simplification.
  const boundaryPolys = (e: Json): { outer: Ring; holes: Ring[] }[] => {
    const { outer, inner } = joinRings(e.members, project) as { outer: [number, number][][]; inner: [number, number][][] };
    const polys = outer
      .map((r) => cleanRing(r, true, 2, 100) as [number, number][] | null)
      .filter((r): r is [number, number][] => !!r)
      .map((r) => ({ outer: r.flat(), holes: [] as Ring[] }));
    for (const raw of inner) {
      const h = cleanRing(raw, false, 2, 10) as [number, number][] | null;
      if (h) {
        const [hx, hz] = ringCentroid(h.flat());
        polys.find((p) => pointInRing(p.outer, hx, hz))?.holes.push(h.flat());
      }
    }
    return polys;
  };
  for (const e of q(`relation["boundary"="administrative"]["admin_level"~"^(6|8)$"](${BB});`)) {
    const t = e.tags ?? {};
    for (const p of boundaryPolys(e)) {
      (t.admin_level === '6' ? ilceList : mahalleList).push({ id: e.id, name: t.name ?? '', outer: p.outer, holes: p.holes });
    }
  }
}
const ilce = new Polygons<number>(1000);
ilceList.forEach((a, i) => ilce.add(a.outer, a.holes, i));
const mahalle = new Polygons<number>(250);
mahalleList.forEach((a, i) => mahalle.add(a.outer, a.holes, i));
/** İstanbul's ilçe: those whose name İBB lists (the clip box also holds parts of Kocaeli and Tekirdağ). */
log(`admin: ${ilceList.length} ilçe polygons, ${mahalleList.length} mahalle polygons`);

// ---------------------------------------------------------------------------------------------------------------------
// 3. İBB storey classes per mahalle, joined to the OSM mahalle by ilçe + name.
interface IbbRow {
  ilce: string;
  mahalle: string;
  uavt: string;
  periods: number[];
  classes: number[];
}
const ibbRows: IbbRow[] = [];
{
  const src = manifest.sources.ibb;
  const text = new TextDecoder('windows-1254').decode(readFileSync(resolve(ROOT, src.resource.file)));
  const lines = text.trim().split(/\r?\n/);
  const head = lines[0].split(';');
  const col = (name: string): number => {
    const k = head.findIndex((h) => h.trim().toLowerCase() === name);
    if (k < 0) {
      throw new Error(`İBB CSV: column ${name} missing (${head.join(';')})`);
    }
    return k;
  };
  const [ci, cm, cu] = [col('ilce_adi'), col('mahalle_adi'), col('mahalle_uavt')];
  const cp = ['1980_oncesi', '1980-2000_arasi', '2000_sonrasi'].map(col);
  const cc = ['1-4 kat_arasi', '5-9 kat_arasi', '9-19 kat_arasi'].map(col);
  for (const line of lines.slice(1)) {
    const c = line.split(';');
    ibbRows.push({ ilce: c[ci].trim(), mahalle: c[cm].trim(), uavt: c[cu].trim(), periods: cp.map((k) => Number(c[k]) || 0), classes: cc.map((k) => Number(c[k]) || 0) });
  }
}
const aliasFile = resolve(PUB, 'ibb-aliases.json');
const aliases = existsSync(aliasFile) ? (readJson<{ aliases: Record<string, string | string[]> }>(aliasFile).aliases ?? {}) : {};
/** Mahalle -> ilçe (the ilçe polygon holding the mahalle's centroid). */
const mahalleIlce = mahalleList.map((m) => {
  const [x, z] = ringCentroid(m.outer);
  const k = ilce.at(x, z);
  return k === null ? '' : ilceList[k].name;
});
const join = joinMahalle(
  ibbRows,
  mahalleList.map((m, i) => ({ key: i, ilce: mahalleIlce[i], name: m.name })).filter((m) => m.ilce),
  aliases,
);
/** İBB row of each OSM mahalle polygon (-1 none). A row matched to several polygons (split since 2017) shares out. */
const ibbOfMahalle = new Int32Array(mahalleList.length).fill(-1);
for (const [row, keys] of join.match) {
  for (const k of keys) {
    ibbOfMahalle[k] = row;
  }
}
summary.ibb = { rows: ibbRows.length, buildings: ibbRows.reduce((s, r) => s + r.classes.reduce((a, b) => a + b, 0), 0), matched: join.match.size, unmatched: join.ibbUnmatched.map((i) => `${ibbRows[i].ilce}/${ibbRows[i].mahalle}`) };
log(`İBB: ${join.match.size} of ${ibbRows.length} mahalle joined to OSM (${join.ibbUnmatched.length} unmatched)`);

// ---------------------------------------------------------------------------------------------------------------------
// 4. Microsoft footprints: parsed, clipped to the box, classified against OSM and the context, deduplicated.
interface Ml {
  key: string;
  quadkey: string;
  confidence: number;
  ring: Ring;
  area: number;
  cx: number;
  cz: number;
  drop: number;
  what?: string;
}
const mls: Ml[] = [];
{
  let parsed = 0;
  let outside = 0;
  for (const tile of manifest.sources.microsoft.tiles as { file: string; quadkey: string }[]) {
    const rl = createInterface({ input: createReadStream(resolve(ROOT, tile.file)).pipe(createGunzip()), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) {
        continue;
      }
      const f = JSON.parse(line) as { properties?: { confidence?: number }; geometry: { type: string; coordinates: any } };
      const polys: number[][][] = f.geometry.type === 'Polygon' ? [f.geometry.coordinates[0]] : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates.map((p: number[][][]) => p[0]) : [];
      for (const outer of polys) {
        parsed++;
        // Centroid in degrees (the id key) and the clip test.
        let lat = 0;
        let lon = 0;
        const n = outer.length - (outer[0][0] === outer.at(-1)![0] && outer[0][1] === outer.at(-1)![1] ? 1 : 0);
        for (let k = 0; k < n; k++) {
          lon += outer[k][0];
          lat += outer[k][1];
        }
        lat /= n;
        lon /= n;
        if (lat < CLIP_BBOX.south || lat > CLIP_BBOX.north || lon < CLIP_BBOX.west || lon > CLIP_BBOX.east) {
          outside++;
          continue;
        }
        const pts = outer.map(([x, y]) => project(y, x));
        if (pts.length && (pts[0][0] !== pts.at(-1)![0] || pts[0][1] !== pts.at(-1)![1])) {
          pts.push(pts[0]);
        }
        const clean = cleanRing(pts, true, 0.35, 0) as [number, number][] | null;
        if (!clean) {
          continue;
        }
        const ring = clean.flat();
        const [cx, cz] = ringCentroid(ring);
        const conf = f.properties?.confidence;
        mls.push({ key: mlKey(tile.quadkey, lat, lon), quadkey: tile.quadkey, confidence: typeof conf === 'number' && conf >= 0 ? conf : -1, ring, area: Math.abs(ringArea(ring)), cx, cz, drop: -1 });
      }
    }
  }
  summary.ml.parsed = parsed;
  summary.ml.outsideBox = outside;
  log(`Microsoft: ${parsed} footprints parsed, ${mls.length} in the box`);
}
{
  const ctx = {
    osmNear: (box: { minX: number; minZ: number; maxX: number; maxZ: number }, fn: (ring: Ring, holes: readonly Ring[]) => boolean | void): void => {
      let stop = false;
      osmGrid.each(box.minX, box.minZ, box.maxX, box.maxZ, (i) => {
        if (!stop && fn(osm[i].ring, osm[i].holes)) {
          stop = true;
        }
      });
    },
    streets,
    rails,
    walls,
    coast,
    water,
    open,
  };
  const openKinds: Record<string, number> = {};
  let done = 0;
  for (const m of mls) {
    const r = classifyMl(m.ring, ctx);
    m.drop = r.drop;
    if (r.what) {
      m.what = r.what;
      openKinds[r.what] = (openKinds[r.what] ?? 0) + 1;
    }
    if (++done % 100_000 === 0) {
      log(`  classified ${done}`);
    }
  }
  const kept = mls.filter((m) => m.drop === Drop.Kept);
  const dup = duplicates(
    kept.map((m) => m.ring),
    kept.map((m) => m.key),
  );
  kept.forEach((m, i) => dup[i] && (m.drop = Drop.Duplicate));
  const counts: Record<string, number> = {};
  for (const m of mls) {
    counts[DROP_NAMES[m.drop]] = (counts[DROP_NAMES[m.drop]] ?? 0) + 1;
  }
  summary.ml.rules = counts;
  summary.ml.openGround = openKinds;
  log(`Microsoft rules: ${JSON.stringify(counts)}`);
}
const kept = mls.filter((m) => m.drop === Drop.Kept);
const usedIds = new Set<number>();
const mlIds = assignIds(
  kept.map((m) => m.key),
  usedIds,
);
summary.ml.idCollisions = mlIds.collisions;
summary.ml.kept = kept.length;
summary.ml.outbuildings = kept.filter((m) => mlKind(m.area) === 'shed').length;

// ---------------------------------------------------------------------------------------------------------------------
// 5. Units: every building that counts (OSM outlines, kept ML footprints), with its mahalle.
interface Unit {
  id: number;
  source: 'osm' | 'ml';
  ring: Ring;
  area: number;
  cx: number;
  cz: number;
  vx: number;
  vz: number;
  kind: string;
  tags: Record<string, any>;
  levels: number;
  mahalle: number;
  ilce: number;
  /** Buildings this unit stands for (lots of a split outline). */
  weight: number;
  lots?: Ring[];
  est?: number;
  from?: number;
}
const units: Unit[] = [];
const whereIs = (x: number, z: number): [number, number] => [mahalle.at(x, z) ?? -1, ilce.at(x, z) ?? -1];
for (const b of osm) {
  if (b.part || b.construction) {
    continue;
  }
  const [m, i] = whereIs(b.cx, b.cz);
  units.push({ id: b.id, source: 'osm', ring: b.ring, area: b.area, cx: b.cx, cz: b.cz, vx: b.vx, vz: b.vz, kind: b.kind, tags: { ...b.tags, hasParts: b.hasParts, holes: b.holes.length ? b.holes : undefined }, levels: b.levels, mahalle: m, ilce: i, weight: 1 });
}
for (const m of kept) {
  const [mh, il] = whereIs(m.cx, m.cz);
  let vx = 0;
  let vz = 0;
  for (let k = 0; k < m.ring.length; k += 2) {
    vx += m.ring[k];
    vz += m.ring[k + 1];
  }
  const kind = mlKind(m.area);
  units.push({ id: mlIds.ids.get(m.key)!, source: 'ml', ring: m.ring, area: m.area, cx: m.cx, cz: m.cz, vx: vx / (m.ring.length / 2), vz: vz / (m.ring.length / 2), kind, tags: { kind }, levels: 0, mahalle: mh, ilce: il, weight: 1 });
}
const counts = (u: Unit): boolean => !MINOR_KINDS.has(u.kind);
log(`units: ${units.length} (${units.filter((u) => u.source === 'osm').length} OSM, ${units.filter((u) => u.source === 'ml').length} ML)`);

// ---------------------------------------------------------------------------------------------------------------------
// 6. Storeys measured or read off tagged neighbours (they also keep high-rise blocks out of the row splits).
const estimable = (u: Unit): boolean => !u.levels && counts(u) && !FILL_SKIP.has(u.kind);
{
  // 6a. Urban Atlas Building Block Height 2021 (10 m rooftop heights), once the owner has placed the file.
  const uaDir = resolve(SRC, 'urban-atlas');
  const uaFile = existsSync(uaDir) ? readdirSync(uaDir).find((f) => /\.tif{1,2}$/i.test(f)) : undefined;
  let fromUa = 0;
  if (uaFile) {
    const tif = openGeoTiff(readFileSync(resolve(uaDir, uaFile)));
    for (const u of units) {
      if (!estimable(u)) {
        continue;
      }
      // Pixels whose centres fall inside the footprint (the nearest 3 for small ones): the 75th percentile.
      const vals: number[] = [];
      const bx = boxOf(u.ring);
      for (let z = Math.floor(bx.minZ / 10) * 10 + 5; z < bx.maxZ; z += 10) {
        for (let x = Math.floor(bx.minX / 10) * 10 + 5; x < bx.maxX; x += 10) {
          if (!pointInRing(u.ring, x, z)) {
            continue;
          }
          const [lat, lon] = unproject(x, z);
          const [e, n] = laeaEurope(lat, lon);
          const v = tif.window(Math.floor((e - tif.origin[0]) / tif.pixel[0]), Math.floor((tif.origin[1] - n) / tif.pixel[1]), 1, 1)[0];
          if (Number.isFinite(v) && v >= 3) {
            vals.push(v);
          }
        }
      }
      if (vals.length >= 3) {
        vals.sort((a, b) => a - b);
        u.est = Math.max(1, Math.round(vals[Math.floor(0.75 * (vals.length - 1))] / STOREY));
        u.from = LevelsFrom.UrbanAtlas;
        fromUa++;
      }
    }
  }
  summary.levels.urbanAtlas = uaFile ? fromUa : 'pending (no file in data/footprints-src/urban-atlas/)';

  // 6b. Median of tagged neighbours (scripts/data/lib/levels-fill.mjs rule, over the whole box at once).
  const samples = new Grid(FILL_RADIUS);
  const sampleList: { x: number; z: number; lv: number; house: boolean }[] = [];
  for (const b of osm) {
    if (!b.part && b.levels && !FILL_SKIP.has(b.kind) && b.area >= 40) {
      samples.add(sampleList.length, b.vx, b.vz, b.vx, b.vz);
      sampleList.push({ x: b.vx, z: b.vz, lv: b.levels, house: b.kind === 'house' || b.kind === 'detached' });
    }
  }
  let fromNeighbours = 0;
  for (const u of units) {
    if (!estimable(u) || u.from) {
      continue;
    }
    const house = u.kind === 'house' || u.kind === 'detached';
    const near: [number, number][] = [];
    samples.each(u.vx - FILL_RADIUS, u.vz - FILL_RADIUS, u.vx + FILL_RADIUS, u.vz + FILL_RADIUS, (i) => {
      const s = sampleList[i];
      const d = Math.hypot(s.x - u.vx, s.z - u.vz);
      if (d < FILL_RADIUS && s.house === house) {
        near.push([d, s.lv]);
      }
    });
    if (near.length < FILL_MIN) {
      continue;
    }
    const lv = near
      .sort((a, c) => a[0] - c[0])
      .slice(0, FILL_MAX)
      .map((e) => e[1])
      .sort((a, c) => a - c);
    u.est = lv[lv.length >> 1];
    u.from = LevelsFrom.Neighbours;
    fromNeighbours++;
  }
  summary.levels.neighbours = fromNeighbours;
}

// ---------------------------------------------------------------------------------------------------------------------
// 7. Row splits toward İBB's count per mahalle.
{
  const byMahalle = new Map<number, Unit[]>();
  for (const u of units) {
    if (u.mahalle >= 0 && counts(u)) {
      const list = byMahalle.get(u.mahalle) ?? [];
      list.push(u);
      byMahalle.set(u.mahalle, list);
    }
  }
  // İBB rows split over several OSM mahalle (renamed / split since 2017): each gets the row's count by its share of units.
  const rowUnits = new Map<number, number>();
  for (const [m, list] of byMahalle) {
    const row = ibbOfMahalle[m];
    if (row >= 0) {
      rowUnits.set(row, (rowUnits.get(row) ?? 0) + list.length);
    }
  }
  let split = 0;
  let lots = 0;
  let noCandidates = 0;
  let deficitLeft = 0;
  let skippedLand = 0;
  /** Outlines of 600 m² and more in mahalle short of İBB's count, by the reason they were not split. */
  const blocked: Record<string, number> = {};
  const byTier = SPLIT_TIERS.map(() => 0);
  for (const [m, list] of byMahalle) {
    const row = ibbOfMahalle[m];
    if (row < 0) {
      continue;
    }
    const ibbTotal = ibbRows[row].classes.reduce((s, v) => s + v, 0) * (list.length / Math.max(1, rowUnits.get(row)!));
    let deficit = Math.round(SPLIT_TARGET * ibbTotal) - list.length;
    if (deficit <= 0) {
      continue;
    }
    for (let tier = 0; tier < SPLIT_TIERS.length && deficit > 0; tier++) {
      const last = tier === SPLIT_TIERS.length - 1;
      const cands = list
        .filter((u) => {
          if (u.lots || u.area < SPLIT_TIERS[tier][0]) {
            return false;
          }
          if ((u.est ?? 0) >= SPLIT_MAX_LEVELS) {
            if (last) {
              blocked.highRise = (blocked.highRise ?? 0) + 1;
            }
            return false;
          }
          const why = u.source === 'ml' || u.id > 0 ? splitBlock({ kind: u.kind, ...u.tags }, u.ring, tier) : 'relation';
          if (why && last) {
            blocked[why] = (blocked[why] ?? 0) + 1;
          }
          if (why) {
            return false;
          }
          const bad = noSplit.at(u.cx, u.cz) !== null;
          skippedLand += bad && last ? 1 : 0;
          return !bad;
        })
        .map((u) => {
          const bx = boxOf(u.ring);
          return { u, len: Math.max(bx.maxX - bx.minX, bx.maxZ - bx.minZ) };
        })
        .sort((a, b) => b.len - a.len || a.u.id - b.u.id);
      if (!cands.length && last) {
        noCandidates++;
      }
      for (const { u } of cands) {
        if (deficit <= 0) {
          break;
        }
        const parts = splitLots(u.ring, `split:${u.id}`);
        if (parts.length < 2) {
          continue;
        }
        u.lots = parts;
        u.weight = parts.length;
        deficit -= parts.length - 1;
        split++;
        lots += parts.length;
        byTier[tier]++;
      }
    }
    deficitLeft += Math.max(0, deficit);
  }
  summary.splits = { outlines: split, lots, added: lots - split, byTier, mahalleWithoutCandidates: noCandidates, candidatesOnNonResidentialLand: skippedLand, notSplit: blocked, deficitLeft };
  log(`splits: ${split} outlines into ${lots} lots (+${lots - split} buildings), ${deficitLeft} short of the targets`);
}

// ---------------------------------------------------------------------------------------------------------------------
// 8. Storeys for the rest: İBB's mix, GHS-BUILT-H, sanity limits.
{
  // 8a. İBB's storey mix per mahalle for the rest: the largest footprints take the highest classes first.
  const byMahalle = new Map<number, Unit[]>();
  for (const u of units) {
    if (u.mahalle >= 0 && counts(u)) {
      const list = byMahalle.get(u.mahalle) ?? [];
      list.push(u);
      byMahalle.set(u.mahalle, list);
    }
  }
  let fromIbb = 0;
  const qa: { mahalle: string; ibb: number[]; result: number[] }[] = [];
  for (const [m, list] of byMahalle) {
    const row = ibbOfMahalle[m];
    if (row < 0) {
      continue;
    }
    const decided = [0, 0, 0];
    let total = 0;
    const open2: Unit[] = [];
    for (const u of list) {
      total += u.weight;
      const lv = u.levels || u.est || 0;
      if (lv) {
        decided[classOf(lv)] += u.weight;
      } else if (estimable(u)) {
        open2.push(u);
      }
    }
    const undecided = open2.reduce((s, u) => s + u.weight, 0);
    open2.sort((a, b) => b.area - a.area || a.id - b.id);
    const classes = assignClasses(
      open2.map((u) => u.weight),
      classQuotas(ibbRows[row].classes, total, decided, undecided),
    );
    open2.forEach((u, i) => {
      u.est = storeysInClass(classes[i], hash01(`storeys:${u.id}`));
      u.from = LevelsFrom.Ibb;
      fromIbb++;
    });
    const result = [0, 0, 0];
    for (const u of list) {
      const lv = u.levels || u.est || 0;
      if (lv) {
        result[classOf(lv)] += u.weight;
      }
    }
    qa.push({ mahalle: `${mahalleIlce[m]}/${mahalleList[m].name}`, ibb: ibbRows[row].classes, result });
  }

  // 8b. GHS-BUILT-H: each 100 m cell's area-weighted mean height within GHS_BAND of the raster; the cell mean for
  // buildings nothing else estimated.
  const ghs = openGeoTiff(readFileSync(resolve(ROOT, manifest.sources.ghsl.tif.file)));
  const cellOf = (u: Unit): number => {
    const [lat, lon] = unproject(u.cx, u.cz);
    const [x, y] = mollweide(lat, lon);
    const i = Math.floor((x - ghs.origin[0]) / ghs.pixel[0]);
    const j = Math.floor((ghs.origin[1] - y) / ghs.pixel[1]);
    return i < 0 || j < 0 || i >= ghs.width || j >= ghs.height ? -1 : j * ghs.width + i;
  };
  const cells = new Map<number, Unit[]>();
  for (const u of units) {
    if (!counts(u)) {
      continue;
    }
    const c = cellOf(u);
    if (c >= 0) {
      const list = cells.get(c) ?? [];
      list.push(u);
      cells.set(c, list);
    }
  }
  let ghsScaled = 0;
  let ghsCells = 0;
  let fromGhs = 0;
  for (const [c, list] of cells) {
    const g = ghs.window(c % ghs.width, Math.floor(c / ghs.width), 1, 1)[0];
    if (!(g > 0)) {
      continue;
    }
    let fixed = 0;
    let est = 0;
    let area = 0;
    for (const u of list) {
      area += u.area;
      if (u.levels) {
        fixed += u.area * (u.tags.height ?? u.levels * STOREY);
      } else if (u.est && u.from !== LevelsFrom.UrbanAtlas) {
        est += u.area * u.est * STOREY;
      } else if (u.est) {
        fixed += u.area * u.est * STOREY;
      }
    }
    const f = ghsFactor(g, fixed, est, area);
    if (f !== 1) {
      ghsCells++;
      for (const u of list) {
        if (!u.levels && u.est && u.from !== LevelsFrom.UrbanAtlas) {
          const v = Math.max(1, Math.round(u.est * f));
          ghsScaled += v !== u.est ? 1 : 0;
          u.est = v;
        }
      }
    }
    for (const u of list) {
      if (estimable(u) && !u.est) {
        const h = hash01(`ghs:${u.id}`);
        u.est = Math.max(1, Math.round(g / STOREY) + (h < 0.2 ? -1 : h > 0.8 ? 1 : 0));
        u.from = LevelsFrom.Ghs;
        fromGhs++;
      }
    }
  }

  // 8c. Sanity limits: outbuildings one storey, small footprints two, nothing above the mahalle's tallest tagged
  // building (with enough tagged ones) or İBB's highest class.
  const capOf = new Map<number, number>();
  const tagged = new Map<number, number[]>();
  for (const u of units) {
    if (u.levels && u.mahalle >= 0) {
      const list = tagged.get(u.mahalle) ?? [];
      list.push(u.levels);
      tagged.set(u.mahalle, list);
    }
  }
  for (let m = 0; m < mahalleList.length; m++) {
    const t = tagged.get(m) ?? [];
    const row = ibbOfMahalle[m];
    const ibbCap = row >= 0 ? IBB_CLASSES[ibbRows[row].classes[2] > 0 ? 2 : ibbRows[row].classes[1] > 0 ? 1 : 0][1] : IBB_CLASSES[2][1];
    capOf.set(m, t.length >= CAP_SAMPLES ? Math.max(...t) : ibbCap);
  }
  let capped = 0;
  for (const u of units) {
    if (u.est) {
      const v = capLevels(u.est, u.area, u.kind, u.mahalle >= 0 ? capOf.get(u.mahalle)! : IBB_CLASSES[2][1]);
      capped += v !== u.est ? 1 : 0;
      u.est = v;
    }
  }
  const drift = qa
    .map((r) => {
      const s = r.ibb.reduce((a, b) => a + b, 0);
      const t = r.result.reduce((a, b) => a + b, 0);
      const d = s && t ? Math.max(...r.ibb.map((v, k) => Math.abs(v / s - r.result[k] / t))) : 0;
      return { ...r, drift: Math.round(d * 100) / 100 };
    })
    .filter((r) => r.drift > 0.25)
    .sort((a, b) => b.drift - a.drift);
  summary.levels = { ...summary.levels, ibb: fromIbb, ghs: fromGhs, ghsCellsAdjusted: ghsCells, ghsBuildingsChanged: ghsScaled, capped, unestimated: units.filter((u) => estimable(u) && !u.est).length, mahalleDriftingFromIbb: drift.length, driftExamples: drift.slice(0, 12) };
  log(`storeys: ${summary.levels.neighbours} neighbours, ${fromIbb} İBB, ${fromGhs} GHS, ${ghsCells} GHS cells adjusted (${ghsScaled} buildings), ${capped} capped`);
}

// ---------------------------------------------------------------------------------------------------------------------
// 9. Store: added ML footprints and lots (gridded by centroid), split outlines, storeys by id.
interface Rec {
  id: number;
  parent: number;
  source: number;
  kind: string;
  quadkey: string | null;
  confidence: number;
  ring: Ring;
  cx: number;
  cz: number;
}
const recs: Rec[] = [];
const levelsById = new Map<number, [number, number]>();
const lotKeys: string[] = [];
const lotRefs: { u: Unit; ring: Ring }[] = [];
for (const u of units) {
  if (u.est) {
    levelsById.set(u.id, [u.est, u.from ?? 0]);
  }
  u.lots?.forEach((ring, k) => {
    lotKeys.push(lotKey(u.id, 0, k));
    lotRefs.push({ u, ring });
  });
}
const lotIds = assignIds(lotKeys, usedIds);
summary.splits.idCollisions = lotIds.collisions;
const mlById = new Map(kept.map((m) => [mlIds.ids.get(m.key)!, m]));
for (const u of units) {
  if (u.source === 'ml') {
    const m = mlById.get(u.id)!;
    recs.push({ id: u.id, parent: 0, source: 1, kind: u.kind, quadkey: m.quadkey, confidence: m.confidence, ring: ccw(u.ring), cx: u.cx, cz: u.cz });
  }
}
lotRefs.forEach((l, i) => {
  const id = lotIds.ids.get(lotKeys[i])!;
  const [cx, cz] = ringCentroid(l.ring);
  recs.push({ id, parent: l.u.id, source: 2, kind: l.u.kind, quadkey: null, confidence: -1, ring: ccw(l.ring), cx, cz });
  // A lot stands as tall as its outline's estimate; the renderer varies each lot on its own id.
  if (l.u.est) {
    levelsById.set(id, [l.u.est, l.u.from ?? 0]);
  }
});
{
  const g = (() => {
    const [x0, z1] = project(CLIP_BBOX.south, CLIP_BBOX.west);
    const [x1, z0] = project(CLIP_BBOX.north, CLIP_BBOX.east);
    return { x0: Math.floor(x0 / STORE_CELL) * STORE_CELL, z0: Math.floor(z0 / STORE_CELL) * STORE_CELL, nx: Math.ceil((x1 - x0) / STORE_CELL) + 2, nz: Math.ceil((z1 - z0) / STORE_CELL) + 2, cell: STORE_CELL };
  })();
  const cellIdx = (r: Rec): number => Math.min(g.nz - 1, Math.max(0, Math.floor((r.cz - g.z0) / g.cell))) * g.nx + Math.min(g.nx - 1, Math.max(0, Math.floor((r.cx - g.x0) / g.cell)));
  recs.sort((a, b) => cellIdx(a) - cellIdx(b) || a.id - b.id);
  const n = recs.length;
  const cellStart = new Uint32Array(g.nx * g.nz + 1);
  for (const r of recs) {
    cellStart[cellIdx(r) + 1]++;
  }
  for (let c = 0; c < g.nx * g.nz; c++) {
    cellStart[c + 1] += cellStart[c];
  }
  const kinds = [...new Set(recs.map((r) => r.kind))].sort();
  const quadkeys = [...new Set(recs.map((r) => r.quadkey).filter((x): x is string => !!x))].sort();
  const ringStart = new Uint32Array(n + 1);
  recs.forEach((r, k) => (ringStart[k + 1] = ringStart[k] + r.ring.length / 2));
  const xy = new Float32Array(ringStart[n] * 2);
  recs.forEach((r, k) => xy.set(r.ring, ringStart[k] * 2));
  const levelIds = Float64Array.from([...levelsById.keys()].sort((a, b) => a - b));
  const levels = new Uint8Array(levelIds.length);
  const levelsFrom = new Uint8Array(levelIds.length);
  levelIds.forEach((id, k) => {
    [levels[k], levelsFrom[k]] = levelsById.get(id)!;
  });
  const splitIds = Float64Array.from(units.filter((u) => u.lots).map((u) => u.id).sort((a, b) => a - b));
  const inputs = {
    osm: { source: extractSource(), osmBase },
    microsoft: { release: manifest.sources.microsoft.release, tiles: manifest.sources.microsoft.tiles.map((t: { quadkey: string; location: string; md5: string }) => `${t.location}-${t.quadkey}:${t.md5}`) },
    ibb: { md5: manifest.sources.ibb.resource.md5, aliases: createHash('md5').update(JSON.stringify(aliases)).digest('hex') },
    ghsl: { tile: manifest.sources.ghsl.tile, md5: manifest.sources.ghsl.tif.md5 },
    urbanAtlas: manifest.sources['urban-atlas']?.status === 'present' ? manifest.sources['urban-atlas'].md5 : null,
  };
  // The code that decides the result: this script, the rules, the geometry and the OSM record code.
  const rulesHash = ['scripts/data/footprints-merge.ts', 'scripts/data/lib/footprints/rules.ts', 'scripts/data/lib/footprints/geometry.ts', 'scripts/data/lib/osm-records.mjs']
    .reduce((h, f) => h.update(readFileSync(resolve(ROOT, f))), createHash('sha256'))
    .digest('hex')
    .slice(0, 12);
  const stamp = createHash('sha256').update(JSON.stringify(inputs)).update(rulesHash).digest('hex').slice(0, 16);
  const header = {
    stamp,
    created: new Date().toISOString(),
    osmBase,
    release: manifest.sources.microsoft.release,
    inputs,
    rules: rulesHash,
    grid: g,
    kinds,
    quadkeys,
    counts: { ml: recs.filter((r) => r.source === 1).length, lots: recs.filter((r) => r.source === 2).length, splits: splitIds.length, levels: levelIds.length },
  };
  const bytes = writeMerged(MERGED_FILE, header, {
    cellStart,
    id: Float64Array.from(recs.map((r) => r.id)),
    parent: Float64Array.from(recs.map((r) => r.parent)),
    source: Uint8Array.from(recs.map((r) => r.source)),
    kind: Uint8Array.from(recs.map((r) => kinds.indexOf(r.kind))),
    quadkey: Uint8Array.from(recs.map((r) => (r.quadkey ? quadkeys.indexOf(r.quadkey) : 255))),
    confidence: Uint8Array.from(recs.map((r) => (r.confidence >= 0 ? Math.round(r.confidence * 100) : 255))),
    cx: Float32Array.from(recs.map((r) => r.cx)),
    cz: Float32Array.from(recs.map((r) => r.cz)),
    ringStart,
    xy,
    splitIds,
    levelIds,
    levels,
    levelsFrom,
  });
  summary.store = { file: 'data/footprints-src/merged/buildings.bin', bytes, stamp, ...header.counts };
  log(`store: ${(bytes / 1e6).toFixed(1)} MB, stamp ${stamp}`);
}

// ---------------------------------------------------------------------------------------------------------------------
// 10. Coverage per ilçe (the province and the playable square) against İBB 2017, the İBB join table, the published
// additions, the summary.
{
  const norm = (s: string): string => normName(s);
  const ilceAlias = (name: string): string => {
    const a = aliases[norm(name)];
    return norm(typeof a === 'string' ? a : name);
  };
  // İBB per ilçe (province) and per mahalle polygon share (square: a row's count by its units inside the square).
  const ibbIlce = new Map<string, number>();
  for (const r of ibbRows) {
    const k = ilceAlias(r.ilce);
    ibbIlce.set(k, (ibbIlce.get(k) ?? 0) + r.classes.reduce((a, b) => a + b, 0));
  }
  const unitsOfRow = new Map<number, { all: number; square: number }>();
  for (const u of units) {
    const row = u.mahalle >= 0 ? ibbOfMahalle[u.mahalle] : -1;
    if (row < 0 || u.source !== 'osm') {
      continue;
    }
    const e = unitsOfRow.get(row) ?? { all: 0, square: 0 };
    e.all++;
    e.square += inSquare(u.cx, u.cz) ? 1 : 0;
    unitsOfRow.set(row, e);
  }
  const ibbSquare = new Map<string, number>();
  for (const [row, e] of unitsOfRow) {
    const k = ilceAlias(ibbRows[row].ilce);
    ibbSquare.set(k, (ibbSquare.get(k) ?? 0) + (ibbRows[row].classes.reduce((a, b) => a + b, 0) * e.square) / Math.max(1, e.all));
  }
  type Row = { osm: number; ml: number; sheds: number; lots: number };
  const blank = (): Row => ({ osm: 0, ml: 0, sheds: 0, lots: 0 });
  const prov = new Map<string, Row>();
  const square = new Map<string, Row>();
  for (const u of units) {
    const name = u.ilce >= 0 ? norm(ilceList[u.ilce].name) : '';
    const key = ibbIlce.has(name) ? name : '(outside İstanbul)';
    for (const [map, on] of [[prov, true], [square, inSquare(u.cx, u.cz)]] as const) {
      if (!on) {
        continue;
      }
      const r = map.get(key) ?? blank();
      if (u.source === 'osm') {
        r.osm++;
      } else if (u.kind === 'shed') {
        r.sheds++;
      } else {
        r.ml++;
      }
      r.lots += u.lots ? u.lots.length - 1 : 0;
      map.set(key, r);
    }
  }
  const pct = (a: number, b: number): string => (b > 0 ? `${Math.round((a / b) * 100)} %` : '–');
  const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');
  const table = (map: Map<string, Row>, ibb: Map<string, number>): string => {
    const names = [...map.keys()].filter((k) => ibb.has(k)).sort((a, b) => (map.get(a)!.osm / (ibb.get(a) || 1)) - (map.get(b)!.osm / (ibb.get(b) || 1)));
    const lines = ['| İlçe | İBB 2017 | OSM | OSM ÷ İBB | + Microsoft | + outbuildings | + row lots | After | After ÷ İBB |', '|---|---:|---:|---:|---:|---:|---:|---:|---:|'];
    const tot = blank();
    let ibbTot = 0;
    for (const k of names) {
      const r = map.get(k)!;
      const i = ibb.get(k) ?? 0;
      if (i < 1) {
        continue;
      }
      const after = r.osm + r.ml + r.lots;
      lines.push(`| ${k.charAt(0)}${k.slice(1).toLocaleLowerCase('tr')} | ${fmt(i)} | ${fmt(r.osm)} | ${pct(r.osm, i)} | ${fmt(r.ml)} | ${fmt(r.sheds)} | ${fmt(r.lots)} | ${fmt(after)} | ${pct(after, i)} |`);
      tot.osm += r.osm;
      tot.ml += r.ml;
      tot.sheds += r.sheds;
      tot.lots += r.lots;
      ibbTot += i;
    }
    const after = tot.osm + tot.ml + tot.lots;
    lines.push(`| **Total** | **${fmt(ibbTot)}** | **${fmt(tot.osm)}** | **${pct(tot.osm, ibbTot)}** | **${fmt(tot.ml)}** | **${fmt(tot.sheds)}** | **${fmt(tot.lots)}** | **${fmt(after)}** | **${pct(after, ibbTot)}** |`);
    return lines.join('\n');
  };
  const rulesLine = Object.entries(summary.ml.rules as Record<string, number>)
    .map(([k, v]) => `${k} ${fmt(v)}`)
    .join(', ');
  const md = `# Building coverage: OSM, Microsoft footprints and row lots against İBB

Generated by \`scripts/data/footprints-merge.ts\` (merge stamp \`${summary.store?.stamp ?? ''}\`); do not edit by hand. Buildings are
counted per ilçe by centroid: OSM outlines (building=*, parts not counted), Microsoft ML footprints the merge keeps
(outbuildings under 30 m² separately; İBB does not count them), and the buildings added by splitting merged row
outlines into lots. İBB 2017: Mahalle Bazlı Bina Sayıları (buildings under 20 floors, MAKS 2016-2017); in the playable
square each mahalle counts with the share of its OSM buildings inside the square.

Inputs: OSM ${osmBase} (${extractSource()}); Microsoft Global ML Building Footprints ${manifest.sources.microsoft.release};
İBB Açık Veri Portalı (md5 ${manifest.sources.ibb.resource.md5}); GHS-BUILT-H R2023A ${manifest.sources.ghsl.tile}.

Microsoft footprints in the box: ${fmt(mls.length)}; rules (first that applies): ${rulesLine}. Row splits:
${fmt(summary.splits.outlines)} outlines into ${fmt(summary.splits.lots)} lots (+${fmt(summary.splits.added)} buildings), toward
${SPLIT_TARGET} of İBB's count per mahalle; ${fmt(summary.splits.deficitLeft)} buildings short where no outline qualifies.

## Playable square (48 x 48 km, the web game's far city)

${table(square, ibbSquare)}

## İstanbul province (39 ilçe)

${table(prov, ibbIlce)}

## Storeys of buildings without height tags

First hit: Urban Atlas ${typeof summary.levels.urbanAtlas === 'number' ? fmt(summary.levels.urbanAtlas) : 'pending (Copernicus account)'}, tagged neighbours
${fmt(summary.levels.neighbours)}, İBB storey mix ${fmt(summary.levels.ibb)}, GHS-BUILT-H cell mean ${fmt(summary.levels.ghs)}; GHS-BUILT-H moved
${fmt(summary.levels.ghsBuildingsChanged)} estimates in ${fmt(summary.levels.ghsCellsAdjusted)} cells back into its ±30 % band; ${fmt(summary.levels.capped)} capped by the
sanity limits; ${fmt(summary.levels.unestimated)} left to the district profile. ${summary.levels.mahalleDriftingFromIbb} mahalle end more than 25 points away from
İBB's class shares (examples in data/footprints-src/merged/summary.json).
`;
  writeFileSync(resolve(PUB, 'coverage.md'), md);
  summary.coverage = { square: Object.fromEntries(square), province: Object.fromEntries(prov) };

  // İBB table joined to the OSM mahalle (committed: the derived table stays public with the compiler).
  const osmOfRow = new Map<number, number[]>();
  mahalleList.forEach((m, i) => {
    const row = ibbOfMahalle[i];
    if (row >= 0) {
      osmOfRow.set(row, [...new Set([...(osmOfRow.get(row) ?? []), m.id])]);
    }
  });
  writeFileSync(
    resolve(PUB, 'ibb-mahalle.json'),
    JSON.stringify(
      {
        $comment: 'İBB Açık Veri Portalı, Mahalle Bazlı Bina Sayıları (2017): buildings per mahalle by construction period (before 1980, 1980-2000, after 2000) and storey class (1-4, 5-9, 9-19 floors), joined to the OSM mahalle relations (admin_level 8) by scripts/data/footprints-merge.ts. Contains public sector information licensed under the İBB Açık Veri Lisansı 1.0 (https://data.ibb.gov.tr/en/license). OSM relation ids: © OpenStreetMap contributors, ODbL 1.0.',
        source: manifest.sources.ibb.resource.url,
        md5: manifest.sources.ibb.resource.md5,
        osmBase,
        rows: ibbRows.map((r, i) => ({ ilce: r.ilce, mahalle: r.mahalle, uavt: r.uavt, periods: r.periods, storeys: r.classes, osm: osmOfRow.get(i) ?? [] })),
      },
      null,
      0,
    ).replace(/\},\{/g, '},\n{') + '\n',
  );

  // Published additions (ODbL 4.6): the kept Microsoft footprints any layer of the web game uses (the playable
  // square), with synthetic id, source tile and confidence, as the compiler uses them (lon / lat, 7 decimals).
  const out: string[] = ['id,quadkey,confidence,kind,wkt'];
  for (const u of units) {
    if (u.source !== 'ml' || !inSquare(u.cx, u.cz)) {
      continue;
    }
    const m = mlById.get(u.id);
    const pts: string[] = [];
    const r = ccw(u.ring);
    for (let k = 0; k <= r.length; k += 2) {
      const [lat, lon] = unproject(r[k % r.length], r[(k + 1) % r.length]);
      pts.push(`${lon.toFixed(7)} ${lat.toFixed(7)}`);
    }
    out.push(`${u.id},${m?.quadkey ?? ''},${m && m.confidence >= 0 ? m.confidence.toFixed(3) : ''},${u.kind},"POLYGON((${pts.join(',')}))"`);
  }
  const gz = gzipSync(Buffer.from(out.join('\n') + '\n'), { level: 9 });
  writeFileSync(resolve(PUB, 'microsoft-additions.csv.gz'), gz);
  summary.published = { file: 'data/footprints/microsoft-additions.csv.gz', footprints: out.length - 1, bytes: gz.length };
  log(`published additions: ${out.length - 1} footprints, ${(gz.length / 1e6).toFixed(1)} MB`);
}
mkdirSync(resolve(SRC, 'merged'), { recursive: true });
summary.ms = Math.round(performance.now() - t0);
writeFileSync(resolve(SRC, 'merged/summary.json'), JSON.stringify(summary, null, 1) + '\n');
console.log(JSON.stringify({ ok: true, ml: summary.ml, splits: summary.splits, levels: { ...summary.levels, driftExamples: undefined }, ibb: { ...summary.ibb, unmatched: summary.ibb.unmatched.length }, store: summary.store, published: summary.published, ms: summary.ms }, null, 1));
