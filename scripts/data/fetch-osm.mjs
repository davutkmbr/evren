#!/usr/bin/env node
/**
 * Extracts the OpenStreetMap content of one area of OSM_AREAS (src/world/osm/area.ts) and writes compact local-metre
 * JSON to the area's `dataFile` (or `--out <file>`):
 *
 *   node scripts/data/fetch-osm.mjs [--area galata|kadikoy] [--cache /tmp/overpass-<area>.json] [--out <file>]
 *   node scripts/data/fetch-osm.mjs --region <id>      # a flight-scale region of src/world/osm/regions.json
 *   node scripts/data/fetch-osm.mjs --bbox s,w,n,e --out <file>   # any rectangle, region profile (far city bake)
 *
 * --source local (default): the queries below run against the local Geofabrik extract index
 * (scripts/data/lib/osm-local.mjs; build it once with `node scripts/data/osm-extract.mjs all`), in seconds.
 * --source overpass: the same queries go to the public Overpass API (rate-limited; minutes per area).
 *
 * - galata (default, profile 'slice'): the OSM vertical slice (Eminönü, Galata Bridge, Karaköy, Galata, Tophane,
 *   Cihangir) -> public/data/osm/slice.json. Queries and records are unchanged by the street extension.
 * - --region <id> (profile 'slice'): one flight-scale region planned by scripts/data/osm-regions.mjs ->
 *   public/data/osm/regions/<id>.json. Same schema as the slice, plus `levelsFill` (fillLevels below) on untagged
 *   buildings.
 * - kadikoy (profile 'street'): world-compiler input -> data/osm/kadikoy.json (not served). Same schema plus the
 *   street extension ('street/1': entrance=* nodes linked to their building, craft=* POIs, kerb=* nodes,
 *   area:highway=* polygons, sidewalk widths and kerb tags on ways), documented in tools/world-compiler/README.md.
 *
 * Building merge (scripts/data/footprints-merge.ts, when data/footprints-src/merged/ holds its output): every profile
 * adds the merge's Microsoft ML footprints whose centroid lies in the fetched box (`source: 'ml'`) and replaces the
 * outlines it split by their row lots (`hasParts` on the outline, the lots as parts with `source: 'lot'` and `lotOf`),
 * and the storey fill (regions, bbox blocks) takes the merge's estimates, so every layer sees one building set with
 * one height per building. The merge must come from the same OSM snapshot; `--osm-only` fetches without it.
 *
 * Data © OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright). Added footprints: Microsoft
 * Global ML Building Footprints, CDLA-Permissive-2.0; storeys: İBB Açık Veri Portalı and GHS-BUILT-H R2023A (see
 * data/footprints/LICENSE.md).
 *
 * The output schema (version 2) is documented as TypeScript in src/world/osm/data.ts; keep both in sync.
 * The bbox is parsed from OSM_AREAS in src/world/osm/area.ts and the projection origin from WORLD_ORIGIN in
 * src/core/geo-coords.ts (tools/world-compiler/lib/areas.mjs), so neither is duplicated here.
 * Coordinates: +X east, +Z south, metres, rounded to 0.1 m. Outer rings have a positive shoelace area in the x/z
 * plane, holes a negative one; rings are not closed (no duplicate last point).
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { readArea, readOrigin, ROOT } from '../../tools/world-compiler/lib/areas.mjs';
import { extractSource, overpassLocal, sourceArg } from './lib/osm-local.mjs';
import { fillLevels } from './lib/levels-fill.mjs';
import { openMerged } from './lib/footprints/store.mjs';
import { buildingRecord, copyTags, flat, FOOT_HIGHWAYS, highwayWidth, isClosed, metres, num, osmId, pointInRing, polygonsOf as polygonsWith, projectAll as projectWith, projector, RAIL_KINDS, round, simplify, simplifyKeep, SKIP_HIGHWAYS } from './lib/osm-records.mjs';

const args = process.argv.slice(2);
const argOf = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const REGION = argOf('--region');
/** `--bbox s,w,n,e --out <file>`: any rectangle with the region profile (the far city bake's 2 km blocks). */
const BBOX_ARG = argOf('--bbox');
const AREA = BBOX_ARG ? readBboxArg(BBOX_ARG) : REGION ? readRegion(REGION) : readArea(argOf('--area') ?? 'galata');
/** Regions and bbox blocks estimate the storeys of untagged buildings (fillLevels). */
const FILL = !!(REGION || BBOX_ARG);
const STREET = AREA.profile === 'street';
const SOURCE = sourceArg(args);
const OUT = resolve(ROOT, argOf('--out') ?? AREA.dataFile);
const LEGACY_OUT = AREA.id === 'galata' && !argOf('--out') ? resolve(ROOT, 'public/data/osm/galata.json') : null;
const SCHEMA_VERSION = 2;
/** Street extension version (profile 'street' only). */
const STREET_EXTENSION = 'street/1';

const BBOX = AREA.bbox;
const ORIGIN = readOrigin();
/* Same projection as src/core/geo-coords.ts (latLonToLocal). */
const project = projector(ORIGIN);
const projectAll = (geom) => projectWith(geom, project);
const polygonsOf = (el, tol, minArea) => polygonsWith(el, tol, minArea, project);
/**
 * Data is fetched ~75 m beyond the area so the seam band (OSM_SEAM in area.ts) is covered too. Street areas get
 * ~155 m: the compiler tiles every 100 m square that touches the area, so tiles reach up to 100 m past it.
 */
const MARGIN = STREET ? { lat: 0.0014, lon: 0.0019 } : { lat: 0.0007, lon: 0.0009 };
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://z.overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];


const LINE_KINDS = [
  ['barrier', new Set(['wall', 'retaining_wall', 'city_wall', 'fence', 'guard_rail', 'hedge', 'kerb', 'handrail'])],
  ['natural', new Set(['tree_row', 'coastline', 'cliff'])],
  ['man_made', new Set(['pier', 'quay', 'breakwater', 'embankment', 'groyne'])],
  ['railway', new Set(['platform'])],
  ['public_transport', new Set(['platform'])],
  ['historic', new Set(['citywalls'])],
];
/** Area kinds by key, in priority order (the first matching key names the area). `true`: needs area=yes. */
const AREA_KEYS = [
  ['highway', new Set(['pedestrian', 'footway', 'service', 'track']), true],
  ['place', new Set(['square'])],
  ['man_made', new Set(['pier', 'quay', 'breakwater', 'bridge'])],
  ['amenity', new Set(['parking', 'marketplace', 'fountain', 'bus_station', 'ferry_terminal', 'taxi'])],
  ['railway', new Set(['platform', 'station'])],
  ['public_transport', new Set(['platform', 'station'])],
  ['leisure', new Set(['park', 'garden', 'playground', 'pitch', 'common', 'marina', 'sports_centre', 'dog_park', 'swimming_pool'])],
  ['natural', new Set(['water', 'grass', 'scrub', 'wood', 'beach', 'bare_rock', 'sand', 'wetland'])],
  ['water', null],
  ['landuse', null],
  ['barrier', new Set(['wall', 'city_wall', 'retaining_wall', 'fence', 'hedge']), true],
];
/** Point kinds by key (null: every value). */
const POINT_KEYS = [
  ['highway', new Set(['street_lamp', 'traffic_signals', 'crossing', 'bus_stop', 'stop', 'give_way', 'elevator', 'turning_circle', 'speed_camera'])],
  ['railway', new Set(['tram_stop', 'station', 'halt', 'stop', 'tram_crossing', 'level_crossing', 'crossing', 'subway_entrance', 'switch', 'buffer_stop'])],
  ['public_transport', new Set(['platform', 'stop_position', 'station'])],
  ['natural', new Set(['tree', 'rock', 'spring'])],
  ['amenity', null],
  ['barrier', new Set(['bollard', 'block', 'gate', 'lift_gate', 'kerb', 'planter', 'turnstile', 'chain', 'jersey_barrier', 'cycle_barrier'])],
  ['shop', null],
  ['tourism', new Set(['hotel', 'hostel', 'guest_house', 'museum', 'artwork', 'attraction', 'viewpoint', 'information', 'gallery', 'apartment'])],
  ['emergency', new Set(['fire_hydrant', 'phone', 'defibrillator', 'siren'])],
  ['advertising', null],
  ['historic', null],
  ['man_made', new Set(['street_cabinet', 'flagpole', 'mast', 'lighthouse', 'monitoring_station', 'surveillance', 'water_tap', 'chimney', 'tower'])],
  ['leisure', new Set(['picnic_table', 'playground', 'fitness_station', 'outdoor_seating'])],
];
/**
 * Street profile: entrances first (a door wins over any other tag of the node), craft workshops as POIs, and kerb=*
 * nodes (crossing kerbs) that carry no other kind.
 */
const STREET_POINT_KEYS = [['entrance', null], ...POINT_KEYS, ['craft', null], ['kerb', null]];
const POINT_KEYS_ACTIVE = STREET ? STREET_POINT_KEYS : POINT_KEYS;

const cachePath = argOf('--cache');
/** `--osm-only`: OSM buildings only, without the building merge's footprints and lots. */
const OSM_ONLY = args.includes('--osm-only');

/** A `--bbox s,w,n,e` rectangle as an area definition (profile 'slice', written to `--out`). */
function readBboxArg(text) {
  const [south, west, north, east] = text.split(',').map(Number);
  if (![south, west, north, east].every(Number.isFinite) || !argOf('--out')) {
    throw new Error('--bbox needs four numbers s,w,n,e and --out <file>');
  }
  return { id: 'bbox', bbox: { south, west, north, east }, dataFile: argOf('--out'), profile: 'slice' };
}

/** A region of src/world/osm/regions.json (scripts/data/osm-regions.mjs) as an area definition. */
function readRegion(id) {
  const m = JSON.parse(readFileSync(resolve(ROOT, 'src/world/osm/regions.json'), 'utf8'));
  const r = m.regions.find((x) => x.id === id);
  if (!r) {
    throw new Error(`unknown region '${id}' (run scripts/data/osm-regions.mjs plan)`);
  }
  return { id: r.id, bbox: r.bbox, dataFile: `public/${r.file}`, profile: 'slice' };
}

/** Overpass queries, split by theme so each one stays well inside the public servers' time limits. */
function overpassQueries() {
  const bb = `${BBOX.south - MARGIN.lat},${BBOX.west - MARGIN.lon},${BBOX.north + MARGIN.lat},${BBOX.east + MARGIN.lon}`;
  const head = '[out:json][timeout:180][maxsize:536870912];';
  const nodeFilters = POINT_KEYS_ACTIVE.map(([k, vals]) => (vals ? `node["${k}"~"^(${[...vals].join('|')})$"](${bb});` : `node["${k}"](${bb});`)).join('\n  ');
  const streetAreas = STREET ? `\n  way["area:highway"](${bb});` : '';
  return {
    buildings: `${head}
(
  way["building"](${bb});
  relation["building"](${bb});
  way["building:part"](${bb});
  relation["building:part"](${bb});
);
out body geom;`,
    network: `${head}
(
  way["highway"](${bb});
  way["railway"](${bb});
)->.w;
.w out body geom;
way.w["railway"]->.rails;
rel(bw.rails)["route"~"^(tram|light_rail|funicular|subway|train)$"];
out body;`,
    areas: `${head}
(
  way["barrier"](${bb});
  way["natural"](${bb});
  way["man_made"~"^(pier|quay|breakwater|embankment|groyne|bridge)$"](${bb});
  way["landuse"](${bb});
  way["leisure"](${bb});
  way["place"="square"](${bb});
  way["amenity"~"^(parking|marketplace|fountain|bus_station|ferry_terminal|taxi)$"](${bb});
  way["public_transport"="platform"](${bb});
  way["water"](${bb});
  way["historic"="citywalls"](${bb});${streetAreas}
);
out body geom;`,
    relations: `${head}
(
  relation["natural"~"^(water|grass|scrub|wood|beach|bare_rock|sand)$"](${bb});
  relation["man_made"~"^(pier|quay|breakwater|bridge)$"](${bb});
  relation["landuse"](${bb});
  relation["leisure"](${bb});
  relation["place"="square"](${bb});
  relation["amenity"~"^(parking|marketplace)$"](${bb});
);
out body geom;`,
    points: `${head}
(
  ${nodeFilters}
);
out body;`,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Index of the endpoint that answered last: later queries start there. */
let preferred = 0;

async function runQuery(name, q) {
  if (SOURCE === 'local') {
    const t = Date.now();
    const json = overpassLocal(q);
    console.error(`[fetch-osm] ${name}: ${json.elements.length} elements from the local index in ${Date.now() - t} ms`);
    return json;
  }
  let lastError = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    const endpoint = ENDPOINTS[(preferred + attempt) % ENDPOINTS.length];
    try {
      const t = Date.now();
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'User-Agent': 'seventeen-skies-slice/0.2 (scripts/data/fetch-osm.mjs)' },
        body: 'data=' + encodeURIComponent(q),
        signal: AbortSignal.timeout(200_000),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const json = await res.json();
      if (json.remark && /error|timed out|runtime/i.test(json.remark)) {
        throw new Error(`Overpass remark: ${json.remark}`);
      }
      console.error(`[fetch-osm] ${name}: ${json.elements.length} elements from ${endpoint} in ${Date.now() - t} ms`);
      preferred = ENDPOINTS.indexOf(endpoint);
      return json;
    } catch (e) {
      lastError = e;
      console.error(`[fetch-osm] ${name} via ${endpoint} failed (${e.message}), retrying`);
      await sleep(8000 * (attempt + 1));
    }
  }
  throw lastError;
}

async function query() {
  if (cachePath && existsSync(cachePath)) {
    return JSON.parse(readFileSync(cachePath, 'utf8'));
  }
  const seen = new Set();
  const merged = { osm3s: null, elements: [] };
  for (const [name, q] of Object.entries(overpassQueries())) {
    const json = await runQuery(name, q);
    merged.osm3s ??= json.osm3s;
    for (const e of json.elements) {
      const key = `${e.type}/${e.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.elements.push(e);
      }
    }
    if (SOURCE === 'overpass') {
      await sleep(2500);
    }
  }
  if (cachePath) {
    writeFileSync(cachePath, JSON.stringify(merged));
  }
  return merged;
}

/* ------------------------------------------------------------------ */
/* Tag parsing                                                         */
/* ------------------------------------------------------------------ */

function speed(v) {
  if (v == null) {
    return undefined;
  }
  const s = String(v);
  const n = num(s);
  if (n !== undefined) {
    return /mph/.test(s) ? Math.round(n * 1.609) : n;
  }
  return { 'TR:urban': 50, 'TR:rural': 90, 'TR:motorway': 120, 'TR:living_street': 20, walk: 7 }[s];
}

const yes = (v) => v === 'yes' || v === 'true' || v === '1';
const present = (v) => v != null && v !== 'no' && v !== 'false' && v !== '0';

function sidewalkOf(t) {
  const both = t.sidewalk ?? t['sidewalk:both'];
  if (both === 'both' || both === 'left' || both === 'right' || both === 'no' || both === 'none' || both === 'separate') {
    return both === 'none' ? 'no' : both;
  }
  if (both === 'yes') {
    return 'both';
  }
  const l = t['sidewalk:left'];
  const r = t['sidewalk:right'];
  if (l || r) {
    const hasL = l === 'yes' || l === 'separate';
    const hasR = r === 'yes' || r === 'separate';
    if (l === 'separate' && r === 'separate') {
      return 'separate';
    }
    return hasL && hasR ? 'both' : hasL ? 'left' : hasR ? 'right' : 'no';
  }
  return undefined;
}

/** [left, right] parking orientation ('parallel' | 'diagonal' | 'perpendicular' | 'no' | raw value) or undefined. */
function parkingOf(t) {
  const side = (s) => t[`parking:${s}`] ?? t[`parking:lane:${s}`];
  const both = side('both');
  const l = side('left') ?? both;
  const r = side('right') ?? both;
  if (!l && !r) {
    return undefined;
  }
  const orient = (v, s) => {
    if (!v || v === 'no' || v === 'none' || v === 'separate') {
      return 'no';
    }
    const o = t[`parking:${s}:orientation`] ?? t['parking:both:orientation'];
    return o ?? (v === 'lane' || v === 'street_side' || v === 'on_kerb' || v === 'half_on_kerb' ? 'parallel' : v);
  };
  return [orient(l, 'left'), orient(r, 'right')];
}

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Records                                                             */
/* ------------------------------------------------------------------ */

/**
 * Identity tags of street-profile points and buildings (quests resolve by wikidata, then OSM id, then name; the game
 * shows localised names): copied as given.
 */
const IDENTITY_TAGS = { wikidata: 'wikidata', 'name:tr': 'nameTr', 'name:en': 'nameEn', 'addr:street': 'addrStreet' };

function areaKind(t) {
  for (const [key, vals, needsArea] of AREA_KEYS) {
    const v = t[key];
    if (v && (!vals || vals.has(v)) && (!needsArea || t.area === 'yes')) {
      return `${key}=${v}`;
    }
  }
  if (STREET && t['area:highway']) {
    return `area:highway=${t['area:highway']}`;
  }
  return null;
}

/** Sidewalk widths [left, right] (m) from sidewalk:{both,left,right}:width / sidewalk:width, or undefined. */
function sidewalkWidthOf(t) {
  const both = metres(t['sidewalk:both:width']) ?? metres(t['sidewalk:width']);
  const l = metres(t['sidewalk:left:width']) ?? both;
  const r = metres(t['sidewalk:right:width']) ?? both;
  const ok = (v) => (v !== undefined && v > 0.3 && v < 15 ? round(v) : 0);
  return l !== undefined || r !== undefined ? [ok(l), ok(r)] : undefined;
}

function lineKind(t) {
  for (const [key, vals] of LINE_KINDS) {
    if (t[key] && vals.has(t[key])) {
      return `${key}=${t[key]}`;
    }
  }
  return null;
}

function pointKind(t) {
  for (const [key, vals] of POINT_KEYS_ACTIVE) {
    const v = t[key];
    if (v && (!vals || vals.has(v))) {
      return `${key}=${v}`;
    }
  }
  return null;
}

/**
 * Street profile: OSM id of the building outline (way) each node is a vertex of, preferring building=* outlines over
 * building:part ways. Multipolygon members carry no node ids in Overpass geometry output; the compiler matches those
 * entrances to the nearest outline instead.
 */
function entranceOwners(elements) {
  const owner = new Map();
  for (const pass of [true, false]) {
    for (const e of elements) {
      if (e.type !== 'way' || !e.nodes || !e.tags) {
        continue;
      }
      const isOutline = !!e.tags.building && e.tags.building !== 'no';
      if (pass !== isOutline || (!isOutline && !e.tags['building:part'])) {
        continue;
      }
      for (const id of e.nodes) {
        if (!owner.has(id)) {
          owner.set(id, e.id);
        }
      }
    }
  }
  return owner;
}

/** Street profile fields of a point record (entrance details, kerb type). */
function streetPointFields(rec, node, t, owners) {
  if (rec.kind.startsWith('entrance=')) {
    const building = owners?.get(node.id);
    if (building !== undefined) {
      rec.building = building;
    }
    copyTags(rec, t, { door: 'door', access: 'access', wheelchair: 'wheelchair' }, true);
    copyTags(rec, t, { ref: 'entranceRef', 'addr:housenumber': 'housenumber' });
    const width = metres(t.width) ?? metres(t['door:width']);
    if (width && width > 0.5 && width < 12) {
      rec.width = round(width);
    }
  }
  copyTags(rec, t, { kerb: 'kerb' }, true);
}

/**
 * Adds the building merge's footprints and lots (scripts/data/footprints-merge.ts) to `buildings`: the ML footprints
 * whose centroid lies in the fetched box, and for every split outline (OSM or ML) its row lots as parts. Returns the
 * provenance written into the data (`footprints`), or null when no merge has been built.
 */
function mergeFootprints(buildings, osmBase) {
  const merged = openMerged();
  if (!merged) {
    console.error('[fetch-osm] no building merge (data/footprints-src/merged/): OSM buildings only');
    return null;
  }
  if (merged.osmBase !== osmBase) {
    throw new Error(`the building merge was built from OSM ${merged.osmBase}, this data is ${osmBase}: re-run npm run merge:footprints (or pass --osm-only)`);
  }
  const lotsOf = (parent, kind) =>
    merged.lotsOf(parent).map((l) => ({ id: l.id, ring: l.ring, kind, part: true, source: 'lot', lotOf: parent }));
  const added = [];
  let splits = 0;
  for (const b of buildings) {
    if (!b.part && merged.isSplit(b.id)) {
      b.hasParts = true;
      added.push(...lotsOf(b.id, b.kind));
      splits++;
    }
  }
  const [x0, z1] = project(BBOX.south - MARGIN.lat, BBOX.west - MARGIN.lon);
  const [x1, z0] = project(BBOX.north + MARGIN.lat, BBOX.east + MARGIN.lon);
  let ml = 0;
  for (const r of merged.mlIn(x0, z0, x1, z1)) {
    const rec = { id: r.id, ring: r.ring, kind: r.kind, source: 'ml' };
    added.push(rec);
    ml++;
    if (merged.isSplit(r.id)) {
      rec.hasParts = true;
      added.push(...lotsOf(r.id, r.kind));
      splits++;
    }
  }
  for (const b of added) {
    buildings.push(b);
  }
  return { merge: merged.stamp, release: merged.header.release, ml, lots: added.length - ml, splits };
}

async function main() {
  const t0 = Date.now();
  const data = await query();
  const elements = data.elements;
  const relations = elements.filter((e) => e.type === 'relation');

  /* Route refs (T1, T2 İstiklal nostalgic tram, F2 Tünel...) per rail way id. */
  const routesByWay = new Map();
  for (const r of relations) {
    const t = r.tags ?? {};
    if (!t.route || !/^(tram|light_rail|funicular|subway|train)$/.test(t.route)) {
      continue;
    }
    const ref = t.ref ?? t.name;
    if (!ref) {
      continue;
    }
    for (const m of r.members ?? []) {
      if (m.type === 'way') {
        const list = routesByWay.get(m.ref) ?? [];
        if (!list.includes(ref)) {
          list.push(ref);
        }
        routesByWay.set(m.ref, list);
      }
    }
  }

  /* Outline ids of type=building relations (Simple 3D Buildings): they have building:part children. */
  const outlineIds = new Set();
  for (const r of relations) {
    if (r.tags?.type === 'building') {
      for (const m of r.members ?? []) {
        if (m.role === 'outline') {
          outlineIds.add(m.type === 'relation' ? -m.ref : m.ref);
        }
      }
    }
  }

  /* Linear network ways (highways + rails) and their node usage, for junction / feature references. */
  const isRoadWay = (e) => e.type === 'way' && e.tags?.highway && !SKIP_HIGHWAYS.has(e.tags.highway) && e.tags.area !== 'yes' && e.geometry?.length > 1;
  const isRailWay = (e) => e.type === 'way' && RAIL_KINDS.has(e.tags?.railway) && e.geometry?.length > 1;
  const nodeUse = new Map();
  for (const w of elements) {
    if (isRoadWay(w) || isRailWay(w)) {
      for (const id of new Set(w.nodes ?? [])) {
        nodeUse.set(id, (nodeUse.get(id) ?? 0) + 1);
      }
    }
  }
  const pointNodes = elements.filter((e) => e.type === 'node' && e.tags && pointKind(e.tags));
  const featureIds = new Set(pointNodes.map((n) => n.id));
  const refOf = new Map();
  const refFor = (id) => {
    let r = refOf.get(id);
    if (r === undefined) {
      r = refOf.size;
      refOf.set(id, r);
    }
    return r;
  };
  const isRefNode = (id) => (nodeUse.get(id) ?? 0) > 1 || featureIds.has(id);

  const buildings = [];
  const roads = [];
  const rails = [];
  const areas = [];
  const lines = [];
  const points = [];
  const stats = { skippedBuildings: 0, skippedAreas: 0 };

  /** Simplified polyline with locked junction / feature vertices; refs = [vertexIndex, ref, ...]. */
  const network = (el, tol) => {
    const geom = projectAll(el.geometry);
    const ids = el.nodes?.length === geom.length ? el.nodes : [];
    const keep = simplifyKeep(
      geom,
      tol,
      ids.map((id) => isRefNode(id)),
    );
    const pts = [];
    const refs = [];
    for (let i = 0; i < geom.length; i++) {
      if (!keep[i]) {
        continue;
      }
      if (ids.length && isRefNode(ids[i])) {
        refs.push(pts.length, refFor(ids[i]));
      }
      pts.push(geom[i]);
    }
    return [pts, refs];
  };

  for (const el of elements) {
    const t = el.tags ?? {};
    if (el.type === 'node' || t.type === 'route') {
      continue;
    }
    /* Buildings and building parts. */
    if (t.building || t['building:part']) {
      const part = !t.building && !!t['building:part'];
      if (!part && (t.building === 'no' || t.building === 'construction' || t.location === 'underground')) {
        stats.skippedBuildings++;
        continue;
      }
      if (el.type === 'relation' && t.type !== 'multipolygon') {
        continue;
      }
      const polys = polygonsOf(el, 0.35, part ? 2 : 12);
      if (!polys.length) {
        stats.skippedBuildings++;
      }
      for (const poly of polys) {
        buildings.push(buildingRecord(el, poly, part, STREET ? IDENTITY_TAGS : null));
      }
      continue;
    }
    /* Highways: linear ways, or pedestrian / footway areas (area=yes). */
    if (t.highway && el.type === 'way' && el.geometry && !SKIP_HIGHWAYS.has(t.highway)) {
      if (t.area === 'yes') {
        for (const poly of polygonsOf(el, 0.3, 4)) {
          const rec = { id: osmId(el), kind: `highway=${t.highway}`, ring: flat(poly.outer) };
          copyTags(rec, t, { name: 'name', surface: 'surface' });
          areas.push(rec);
        }
        continue;
      }
      let [pts, refs] = network(el, FOOT_HIGHWAYS.has(t.highway) ? 0.4 : 0.8);
      if (pts.length < 2) {
        continue;
      }
      const reversed = t.oneway === '-1' || t.oneway === 'reverse';
      if (reversed) {
        pts = pts.reverse();
        const flipped = [];
        for (let k = refs.length - 2; k >= 0; k -= 2) {
          flipped.push(pts.length - 1 - refs[k], refs[k + 1]);
        }
        refs = flipped;
      }
      const { width, tagged: hasTag, lanes } = highwayWidth(t);
      const rec = { id: osmId(el), pts: flat(pts), kind: t.highway, width: round(width) };
      if (hasTag) {
        rec.widthTagged = true;
      }
      if (lanes) {
        rec.lanes = lanes;
      }
      const lf = num(t['lanes:forward']);
      const lb = num(t['lanes:backward']);
      const [fw, bw] = reversed ? [lb, lf] : [lf, lb];
      if (fw !== undefined) {
        rec.lanesForward = fw;
      }
      if (bw !== undefined) {
        rec.lanesBackward = bw;
      }
      if (yes(t.oneway) || reversed || (t.junction === 'roundabout' && t.oneway !== 'no') || (t.highway === 'motorway' && t.oneway !== 'no')) {
        rec.oneway = true;
      }
      if (present(t.bridge)) {
        rec.bridge = true;
      }
      if (present(t.tunnel)) {
        rec.tunnel = true;
      }
      if (t.covered === 'yes') {
        rec.covered = true;
      }
      const layer = num(t.layer);
      if (layer) {
        rec.layer = layer;
      }
      const maxspeed = speed(t.maxspeed);
      if (maxspeed) {
        rec.maxspeed = maxspeed;
      }
      const sidewalk = sidewalkOf(t);
      if (sidewalk) {
        rec.sidewalk = sidewalk;
      }
      if (t.lit) {
        rec.lit = yes(t.lit);
      }
      const parking = parkingOf(t);
      if (parking) {
        rec.parking = parking;
      }
      const access = t.motor_vehicle ?? t.vehicle ?? t.access;
      if (access) {
        rec.access = access;
      }
      copyTags(rec, t, { name: 'name', surface: 'surface', junction: 'junction', service: 'service', footway: 'footway', crossing: 'crossing', incline: 'incline', smoothness: 'smoothness' });
      const stepCount = num(t.step_count);
      if (stepCount) {
        rec.stepCount = stepCount;
      }
      if (STREET) {
        const walkWidth = sidewalkWidthOf(t);
        if (walkWidth) {
          rec.sidewalkWidth = walkWidth;
        }
        copyTags(rec, t, { kerb: 'kerb' }, true);
      }
      if (refs.length) {
        rec.refs = refs;
      }
      roads.push(rec);
      continue;
    }
    /* Rails: tram, light rail, funicular, metro, mainline. */
    if (isRailWay(el)) {
      const [pts, refs] = network(el, 0.3);
      if (pts.length < 2) {
        continue;
      }
      const rec = { id: osmId(el), kind: t.railway, pts: flat(pts), gauge: (num(t.gauge) ?? 1435) / 1000 };
      if (present(t.bridge)) {
        rec.bridge = true;
      }
      if (present(t.tunnel)) {
        rec.tunnel = true;
      }
      if (t.embedded && t.embedded !== 'no') {
        rec.embedded = true;
      }
      const layer = num(t.layer);
      if (layer) {
        rec.layer = layer;
      }
      const routes = routesByWay.get(el.id);
      if (routes) {
        rec.routes = routes;
      }
      copyTags(rec, t, { name: 'name', service: 'service', usage: 'usage', electrified: 'electrified' });
      if (refs.length) {
        rec.refs = refs;
      }
      rails.push(rec);
      continue;
    }
    /* Areas (landuse, parks, squares, parking, piers, water, platforms...). */
    const aKind = areaKind(t);
    if (aKind && (el.type === 'relation' || (el.geometry && isClosed(el.geometry)))) {
      const polys = polygonsOf(el, 0.4, 4);
      if (!polys.length) {
        stats.skippedAreas++;
      }
      for (const poly of polys) {
        const rec = { id: osmId(el), kind: aKind, ring: flat(poly.outer) };
        if (poly.holes.length) {
          rec.holes = poly.holes.map(flat);
        }
        const layer = num(t.layer);
        if (layer) {
          rec.layer = layer;
        }
        copyTags(rec, t, { name: 'name', surface: 'surface', parking: 'parking', sport: 'sport' });
        areas.push(rec);
      }
      continue;
    }
    /* Linear features (walls, tree rows, coastline, piers, platforms). */
    const lKind = lineKind(t);
    if (lKind && el.type === 'way' && el.geometry?.length > 1) {
      const rec = { id: osmId(el), kind: lKind, pts: flat(simplify(projectAll(el.geometry), lKind === 'natural=coastline' ? 1 : 0.3)) };
      const height = metres(t.height);
      if (height && height > 0 && height < 40) {
        rec.height = round(height);
      }
      const width = metres(t.width);
      if (width && width > 0 && width < 40) {
        rec.width = round(width);
      }
      copyTags(rec, t, { name: 'name', material: 'material', surface: 'surface' });
      if (isClosed(el.geometry)) {
        rec.closed = true;
      }
      lines.push(rec);
    }
  }

  /* Road / rail indices per junction ref, so points know the ways they sit on. */
  const indexRefs = (list) => {
    const map = new Map();
    list.forEach((r, i) => {
      for (let k = 1; k < (r.refs?.length ?? 0); k += 2) {
        const ways = map.get(r.refs[k]) ?? [];
        if (!ways.includes(i)) {
          ways.push(i);
        }
        map.set(r.refs[k], ways);
      }
    });
    return map;
  };
  const roadsByRef = indexRefs(roads);
  const railsByRef = indexRefs(rails);
  const entranceOwner = STREET ? entranceOwners(elements) : null;

  for (const n of pointNodes) {
    const t = n.tags;
    const [x, z] = project(n.lat, n.lon);
    const rec = { kind: pointKind(t), x: round(x), z: round(z) };
    if (STREET) {
      // The OSM element: a stable key for POIs and entrances (array positions change with every upstream edit).
      rec.osm = `n${n.id}`;
    }
    const ref = refOf.get(n.id);
    if (ref !== undefined) {
      rec.ref = ref;
      if (roadsByRef.has(ref)) {
        rec.roads = roadsByRef.get(ref);
      }
      if (railsByRef.has(ref)) {
        rec.rails = railsByRef.get(ref);
      }
    }
    copyTags(rec, t, { name: 'name' });
    if (STREET) {
      copyTags(rec, t, IDENTITY_TAGS);
    }
    copyTags(
      rec,
      t,
      {
        crossing: 'crossing',
        'crossing:markings': 'markings',
        'crossing:signals': 'signals',
        direction: 'direction',
        'traffic_signals:direction': 'direction',
        lamp_mount: 'mount',
        support: 'support',
        'light:count': 'lightCount',
        shelter: 'shelter',
        bench: 'bench',
        genus: 'genus',
        leaf_type: 'leafType',
        denotation: 'denotation',
        material: 'material',
        colour: 'colour',
        backrest: 'backrest',
        cuisine: 'cuisine',
        level: 'level',
      },
      true,
    );
    const height = metres(t.height);
    if (height && height > 0 && height < 60) {
      rec.height = round(height);
    }
    const crown = metres(t.diameter_crown);
    if (crown && crown > 0 && crown < 40) {
      rec.crown = round(crown);
    }
    const species = t.species ?? t['species:en'] ?? t.taxon;
    if (species) {
      rec.species = String(species).trim();
    }
    if (STREET) {
      streetPointFields(rec, n, t, entranceOwner);
    }
    points.push(rec);
  }

  /* Outlines with building:part children render their parts instead (Simple 3D Buildings). */
  const parts = buildings.filter((b) => b.part);
  const cell = 50;
  const partGrid = new Map();
  for (const p of parts) {
    let x = 0;
    let z = 0;
    const n = p.ring.length / 2;
    for (let k = 0; k < n; k++) {
      x += p.ring[k * 2];
      z += p.ring[k * 2 + 1];
    }
    const key = `${Math.floor(x / n / cell)},${Math.floor(z / n / cell)}`;
    partGrid.set(key, [...(partGrid.get(key) ?? []), [x / n, z / n]]);
  }
  for (const b of buildings) {
    if (b.part) {
      continue;
    }
    let has = outlineIds.has(b.id);
    if (!has && parts.length) {
      const ring = [];
      for (let k = 0; k < b.ring.length; k += 2) {
        ring.push([b.ring[k], b.ring[k + 1]]);
      }
      const xs = ring.map((p) => p[0]);
      const zs = ring.map((p) => p[1]);
      for (let gz = Math.floor(Math.min(...zs) / cell); gz <= Math.floor(Math.max(...zs) / cell) && !has; gz++) {
        for (let gx = Math.floor(Math.min(...xs) / cell); gx <= Math.floor(Math.max(...xs) / cell) && !has; gx++) {
          has = (partGrid.get(`${gx},${gz}`) ?? []).some(([px, pz]) => pointInRing(ring, px, pz));
        }
      }
    }
    if (has) {
      b.hasParts = true;
    }
  }

  const osmParts = parts.length;
  const footprints = OSM_ONLY ? null : mergeFootprints(buildings, data.osm3s?.timestamp_osm_base ?? null);
  const fill = FILL ? fillLevels(buildings, { merge: footprints?.merge ?? null }) : null;

  const [x0, z1] = project(BBOX.south, BBOX.west);
  const [x1, z0] = project(BBOX.north, BBOX.east);
  const out = {
    version: SCHEMA_VERSION,
    source: `OpenStreetMap contributors, ODbL 1.0 (${SOURCE === 'local' ? extractSource() : 'Overpass API'})${footprints ? `; building footprints: Microsoft Global ML Building Footprints ${footprints.release}, CDLA-Permissive-2.0; storeys: İBB Açık Veri Portalı (İBB Açık Veri Lisansı), GHS-BUILT-H R2023A (EC JRC, CC BY 4.0)` : ''}`,
    fetched: new Date().toISOString().slice(0, 10),
    osmBase: data.osm3s?.timestamp_osm_base ?? null,
    bbox: { ...BBOX, minX: round(x0), maxX: round(x1), minZ: round(z0), maxZ: round(z1) },
    ...(STREET ? { area: AREA.id, extension: STREET_EXTENSION } : {}),
    ...(REGION ? { region: REGION } : {}),
    ...(footprints ? { footprints } : {}),
    buildings,
    roads,
    rails,
    areas,
    lines,
    points,
  };
  mkdirSync(dirname(OUT), { recursive: true });
  const text = JSON.stringify(out);
  writeFileSync(OUT, text);
  if (LEGACY_OUT && existsSync(LEGACY_OUT)) {
    rmSync(LEGACY_OUT);
  }
  const entrances = points.filter((p) => p.kind.startsWith('entrance='));
  const streetStats = STREET
    ? {
        entrances: entrances.length,
        entrancesOnOutline: entrances.filter((p) => p.building !== undefined).length,
        craftPois: points.filter((p) => p.kind.startsWith('craft=')).length,
        kerbNodes: points.filter((p) => p.kerb).length,
        sidewalkWidthWays: roads.filter((r) => r.sidewalkWidth).length,
      }
    : {};

  const countBy = (list) => list.reduce((m, r) => ((m[r.kind] = (m[r.kind] ?? 0) + 1), m), {});
  const top = (m, n) => Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n));
  console.log(
    JSON.stringify(
      {
        ok: true,
        out: OUT,
        bytes: text.length,
        buildings: buildings.filter((b) => !b.part).length,
        buildingParts: osmParts,
        ...(footprints ? { footprints } : {}),
        outlinesWithParts: buildings.filter((b) => b.hasParts).length,
        withHeight: buildings.filter((b) => b.height).length,
        withLevels: buildings.filter((b) => b.levels).length,
        ...(fill ? { levelsFill: fill } : {}),
        withRoofShape: buildings.filter((b) => b.roofShape).length,
        withColour: buildings.filter((b) => b.colour || b.roofColour).length,
        withHoles: buildings.filter((b) => b.holes).length,
        roads: roads.length,
        roadKinds: top(countBy(roads), 40),
        rails: rails.length,
        railKinds: countBy(rails),
        railRoutes: [...new Set(rails.flatMap((r) => r.routes ?? []))],
        areas: areas.length,
        areaKinds: top(countBy(areas), 40),
        lines: lines.length,
        lineKinds: countBy(lines),
        points: points.length,
        pointKinds: top(countBy(points), 70),
        junctionRefs: refOf.size,
        ...streetStats,
        ...stats,
        ms: Date.now() - t0,
      },
      null,
      1,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
