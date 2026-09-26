#!/usr/bin/env node
/**
 * Extracts the OpenStreetMap content of one area of OSM_AREAS (src/world/osm/area.ts) and writes compact local-metre
 * JSON to the area's `dataFile` (or `--out <file>`):
 *
 *   node scripts/data/fetch-osm.mjs [--area galata|kadikoy] [--cache /tmp/overpass-<area>.json] [--out <file>]
 *   node scripts/data/fetch-osm.mjs --region <id>      # a flight-scale region of src/world/osm/regions.json
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
 * Data © OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright).
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
import { overpassLocal, sourceArg } from './lib/osm-local.mjs';

const args = process.argv.slice(2);
const argOf = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const REGION = argOf('--region');
const AREA = REGION ? readRegion(REGION) : readArea(argOf('--area') ?? 'galata');
const STREET = AREA.profile === 'street';
const SOURCE = sourceArg(args);
const OUT = resolve(ROOT, argOf('--out') ?? AREA.dataFile);
const LEGACY_OUT = AREA.id === 'galata' && !argOf('--out') ? resolve(ROOT, 'public/data/osm/galata.json') : null;
const SCHEMA_VERSION = 2;
/** Street extension version (profile 'street' only). */
const STREET_EXTENSION = 'street/1';

const BBOX = AREA.bbox;
const ORIGIN = readOrigin();
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

/* Same projection as src/core/geo-coords.ts (latLonToLocal). */
const DEG = Math.PI / 180;
const M_LAT = 111_132.954 - 559.822 * Math.cos(2 * ORIGIN.lat * DEG) + 1.175 * Math.cos(4 * ORIGIN.lat * DEG);
const M_LON = DEG * 6_378_137 * Math.cos(ORIGIN.lat * DEG);
const project = (lat, lon) => [(lon - ORIGIN.lon) * M_LON, -(lat - ORIGIN.lat) * M_LAT];

/** Default carriageway / path widths (m) per highway class when `width` is not tagged. */
const HIGHWAY_WIDTH = {
  motorway: 16,
  trunk: 14,
  primary: 12,
  secondary: 10,
  tertiary: 8,
  unclassified: 6,
  residential: 5.5,
  living_street: 4.5,
  pedestrian: 6,
  motorway_link: 7,
  trunk_link: 7,
  primary_link: 7,
  secondary_link: 7,
  tertiary_link: 6,
  service: 4,
  busway: 7,
  road: 6,
  track: 3,
  footway: 2,
  path: 1.5,
  steps: 2.5,
  cycleway: 2,
  bridleway: 2,
};
const FOOT_HIGHWAYS = new Set(['footway', 'path', 'steps', 'cycleway', 'bridleway']);
const SKIP_HIGHWAYS = new Set(['proposed', 'construction', 'abandoned', 'razed', 'disused', 'corridor', 'elevator', 'platform', 'bus_stop', 'raceway', 'escape', 'services', 'rest_area']);
const RAIL_KINDS = new Set(['tram', 'light_rail', 'funicular', 'subway', 'rail', 'narrow_gauge', 'monorail']);
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
  ['leisure', new Set(['park', 'garden', 'playground', 'pitch', 'common', 'marina', 'sports_centre', 'dog_park'])],
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

/** A region of src/world/osm/regions.json (scripts/data/osm-regions.mjs) as an area definition. */
function readRegion(id) {
  const m = JSON.parse(readFileSync(resolve(ROOT, 'src/world/osm/regions.json'), 'utf8'));
  const r = m.regions.find((x) => x.id === id);
  if (!r) {
    throw new Error(`unknown region '${id}' (run scripts/data/osm-regions.mjs plan)`);
  }
  return { id: r.id, bbox: r.bbox, dataFile: `public/${r.file}`, profile: 'slice' };
}

/** Kinds that are neither sampled nor filled by fillLevels (sheds, kiosks, worship, roofs...). */
const FILL_SKIP = new Set(['roof', 'garage', 'garages', 'shed', 'kiosk', 'hut', 'container', 'carport', 'service', 'toilets', 'cabin', 'mosque', 'church', 'chapel', 'synagogue', 'cathedral', 'temple', 'shrine', 'greenhouse', 'bridge', 'ruins', 'stadium', 'grandstand', 'hangar', 'transformer_tower', 'water_tower', 'tower']);
/** Radius (m), minimum and maximum sample count of the neighbour median. */
const FILL_RADIUS = 160;
const FILL_MIN = 4;
const FILL_MAX = 24;

/**
 * Levels fill rule for untagged buildings (regions only; the slice keeps its data as is): the median storey count of
 * the nearest tagged neighbours (building:levels, else height / 3.1 m) within FILL_RADIUS of similar kind, written as
 * `levelsFill` (the renderer still varies ±1 floor and applies its archetype rules; src/world/osm/buildings/plan.ts).
 * Buildings with too few tagged neighbours keep none: the district profile (buildings/districts.ts) decides there.
 */
function fillLevels(buildings) {
  const levelsOf = (b) => b.levels ?? (b.height ? Math.max(1, Math.round((b.height - (b.roofHeight ?? 0)) / 3.1)) : 0);
  const centre = (b) => {
    let x = 0;
    let z = 0;
    const n = b.ring.length / 2;
    for (let k = 0; k < b.ring.length; k += 2) {
      x += b.ring[k];
      z += b.ring[k + 1];
    }
    return [x / n, z / n];
  };
  const cell = FILL_RADIUS;
  const grid = new Map();
  const samples = [];
  for (const b of buildings) {
    const lv = levelsOf(b);
    if (!lv || b.part || FILL_SKIP.has(b.kind) || Math.abs(signedArea(pairs(b.ring))) < 40) {
      continue;
    }
    const [x, z] = centre(b);
    const s = { x, z, lv, house: b.kind === 'house' || b.kind === 'detached' };
    samples.push(s);
    const key = `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
    grid.set(key, [...(grid.get(key) ?? []), s]);
  }
  const counts = { tagged: samples.length, filled: 0, unfilled: 0 };
  for (const b of buildings) {
    if (b.part || b.levels || b.height || FILL_SKIP.has(b.kind)) {
      continue;
    }
    const [x, z] = centre(b);
    const house = b.kind === 'house' || b.kind === 'detached';
    const near = [];
    const gx = Math.floor(x / cell);
    const gz = Math.floor(z / cell);
    for (let j = gz - 1; j <= gz + 1; j++) {
      for (let i = gx - 1; i <= gx + 1; i++) {
        for (const s of grid.get(`${i},${j}`) ?? []) {
          const d = Math.hypot(s.x - x, s.z - z);
          if (d < FILL_RADIUS && s.house === house) {
            near.push([d, s.lv]);
          }
        }
      }
    }
    if (near.length < FILL_MIN) {
      counts.unfilled++;
      continue;
    }
    const lv = near
      .sort((a, c) => a[0] - c[0])
      .slice(0, FILL_MAX)
      .map((e) => e[1])
      .sort((a, c) => a - c);
    b.levelsFill = lv[lv.length >> 1];
    counts.filled++;
  }
  return counts;
}

function pairs(flatPts) {
  const out = [];
  for (let k = 0; k < flatPts.length; k += 2) {
    out.push([flatPts[k], flatPts[k + 1]]);
  }
  return out;
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

function num(v) {
  if (v == null) {
    return undefined;
  }
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}

/** Metres from values like "12", "12 m", "12.5m", "40'" (feet). */
function metres(v) {
  if (v == null) {
    return undefined;
  }
  const s = String(v).trim();
  const n = num(s);
  if (n === undefined) {
    return undefined;
  }
  return /'|ft/.test(s) ? n * 0.3048 : n;
}

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

function perpDist(p, a, b) {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz;
  if (l2 < 1e-9) {
    return Math.hypot(p[0] - a[0], p[1] - a[1]);
  }
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
}

/** Douglas-Peucker keep flags on an open polyline of [x, z] points; `lock[i]` vertices are always kept. */
function simplifyKeep(pts, tol, lock) {
  const keep = new Uint8Array(pts.length);
  if (pts.length < 3) {
    return keep.fill(1);
  }
  keep[0] = keep[pts.length - 1] = 1;
  const anchors = [0];
  for (let i = 1; i < pts.length - 1; i++) {
    if (lock?.[i]) {
      keep[i] = 1;
      anchors.push(i);
    }
  }
  anchors.push(pts.length - 1);
  const stack = [];
  for (let a = 1; a < anchors.length; a++) {
    stack.push([anchors[a - 1], anchors[a]]);
  }
  while (stack.length) {
    const [i0, i1] = stack.pop();
    let best = -1;
    let bestD = tol;
    for (let i = i0 + 1; i < i1; i++) {
      const d = perpDist(pts[i], pts[i0], pts[i1]);
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
  return keep;
}

function simplify(pts, tol) {
  const keep = simplifyKeep(pts, tol, null);
  return pts.filter((_, i) => keep[i]);
}

function signedArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

function pointInRing(ring, x, z) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function centroid(ring) {
  let x = 0;
  let z = 0;
  for (const p of ring) {
    x += p[0];
    z += p[1];
  }
  return [x / ring.length, z / ring.length];
}

/** Closed point list -> simplified ring without the duplicate, positive area when `outer`, negative for holes. */
function cleanRing(pts, outer, tol, minArea) {
  if (pts.length < 4) {
    return null;
  }
  let ring = simplify(pts, tol);
  if (ring.length > 1 && Math.hypot(ring[0][0] - ring.at(-1)[0], ring[0][1] - ring.at(-1)[1]) < 0.05) {
    ring = ring.slice(0, -1);
  }
  if (ring.length < 3) {
    return null;
  }
  const area = signedArea(ring);
  if (Math.abs(area) < minArea) {
    return null;
  }
  return area < 0 === outer ? ring.reverse() : ring;
}

const isClosed = (geom) => geom.length > 3 && geom[0].lat === geom.at(-1).lat && geom[0].lon === geom.at(-1).lon;
const projectAll = (geom) => geom.map((g) => project(g.lat, g.lon));

/** Joins member ways of a multipolygon into closed rings, separately for outer and inner roles. */
function joinRings(members) {
  const join = (segs) => {
    const rings = [];
    const same = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.01;
    while (segs.length) {
      let ring = segs.shift();
      let grown = true;
      while (!same(ring[0], ring.at(-1)) && grown) {
        grown = false;
        for (let i = 0; i < segs.length; i++) {
          const s = segs[i];
          if (same(ring.at(-1), s[0])) {
            ring = ring.concat(s.slice(1));
          } else if (same(ring.at(-1), s.at(-1))) {
            ring = ring.concat(s.slice(0, -1).reverse());
          } else {
            continue;
          }
          segs.splice(i, 1);
          grown = true;
          break;
        }
      }
      if (same(ring[0], ring.at(-1))) {
        rings.push(ring);
      }
    }
    return rings;
  };
  const ways = (members ?? []).filter((m) => m.type === 'way' && m.geometry?.length > 1 && m.geometry.every((g) => g));
  return {
    outer: join(ways.filter((m) => m.role !== 'inner').map((m) => projectAll(m.geometry))),
    inner: join(ways.filter((m) => m.role === 'inner').map((m) => projectAll(m.geometry))),
  };
}

/** Polygons ({ outer, holes }) of a closed way or a multipolygon relation, simplified and oriented. */
function polygonsOf(el, tol, minArea) {
  if (el.type === 'way') {
    if (!el.geometry || !isClosed(el.geometry)) {
      return [];
    }
    const outer = cleanRing(projectAll(el.geometry), true, tol, minArea);
    return outer ? [{ outer, holes: [] }] : [];
  }
  if (el.type !== 'relation' || el.tags?.type !== 'multipolygon') {
    return [];
  }
  const { outer, inner } = joinRings(el.members);
  const polys = outer
    .map((r) => cleanRing(r, true, tol, minArea))
    .filter(Boolean)
    .map((o) => ({ outer: o, holes: [] }));
  for (const raw of inner) {
    const hole = cleanRing(raw, false, tol, 1);
    if (!hole) {
      continue;
    }
    const [hx, hz] = centroid(hole);
    polys.find((p) => pointInRing(p.outer, hx, hz))?.holes.push(hole);
  }
  return polys;
}

const round = (v) => Math.round(v * 10) / 10;
const flat = (pts) => pts.flatMap((p) => [round(p[0]), round(p[1])]);
/** Way ids positive, relation ids negative. */
const osmId = (el) => (el.type === 'relation' ? -el.id : el.id);

/** Copies the listed tags onto `rec` under new names when present (trimmed; lower-cased when `lower`). */
function copyTags(rec, t, map, lower = false) {
  for (const [key, name] of Object.entries(map)) {
    const v = t[key];
    if (v != null && v !== '') {
      rec[name] = lower ? String(v).trim().toLowerCase() : String(v).trim();
    }
  }
}

/* ------------------------------------------------------------------ */
/* Records                                                             */
/* ------------------------------------------------------------------ */

function buildingRecord(el, poly, part) {
  const t = el.tags ?? {};
  const rec = { id: osmId(el), ring: flat(poly.outer), kind: (part ? t['building:part'] : t.building) || 'yes' };
  if (poly.holes.length) {
    rec.holes = poly.holes.map(flat);
  }
  if (part) {
    rec.part = true;
  }
  const height = metres(t.height);
  const minHeight = metres(t.min_height);
  const levels = num(t['building:levels']);
  const minLevel = num(t['building:min_level']);
  const roofLevels = num(t['roof:levels']);
  const roofHeight = metres(t['roof:height']);
  if (height && height > 1 && height < 300) {
    rec.height = round(height);
  }
  if (minHeight && minHeight > 0 && minHeight < 300) {
    rec.minHeight = round(minHeight);
  }
  if (levels && levels > 0 && levels < 80) {
    rec.levels = Math.round(levels);
  }
  if (minLevel && minLevel > 0 && minLevel < 80) {
    rec.minLevel = Math.round(minLevel);
  }
  if (roofLevels !== undefined && roofLevels >= 0 && roofLevels < 10) {
    rec.roofLevels = Math.round(roofLevels);
  }
  if (roofHeight && roofHeight > 0 && roofHeight < 60) {
    rec.roofHeight = round(roofHeight);
  }
  const direction = num(t['roof:direction']);
  if (direction !== undefined) {
    rec.roofDirection = direction;
  }
  copyTags(rec, t, { 'roof:shape': 'roofShape', 'roof:colour': 'roofColour', 'roof:material': 'roofMaterial', 'roof:orientation': 'roofOrientation', 'building:colour': 'colour', 'building:material': 'material' }, true);
  copyTags(rec, t, { amenity: 'amenity', historic: 'historic', shop: 'shop', tourism: 'tourism', religion: 'religion', 'building:architecture': 'architecture', 'building:use': 'use', start_date: 'startDate' }, true);
  copyTags(rec, t, { name: 'name' });
  return rec;
}

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
        buildings.push(buildingRecord(el, poly, part));
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
      const lanes = num(t.lanes);
      const tagged = metres(t.width) ?? metres(t['width:carriageway']);
      const base = HIGHWAY_WIDTH[t.highway] ?? 6;
      const hasTag = tagged !== undefined && tagged > 0.8 && tagged < 40;
      const width = hasTag ? tagged : lanes && !FOOT_HIGHWAYS.has(t.highway) ? Math.max(base * 0.7, Math.min(base * 1.4, lanes * 3.3 + 1.5)) : base;
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

  const fill = REGION ? fillLevels(buildings) : null;

  const [x0, z1] = project(BBOX.south, BBOX.west);
  const [x1, z0] = project(BBOX.north, BBOX.east);
  const out = {
    version: SCHEMA_VERSION,
    source: `OpenStreetMap contributors, ODbL 1.0 (${SOURCE === 'local' ? 'Geofabrik extract' : 'Overpass API'})`,
    fetched: new Date().toISOString().slice(0, 10),
    osmBase: data.osm3s?.timestamp_osm_base ?? null,
    bbox: { ...BBOX, minX: round(x0), maxX: round(x1), minZ: round(z0), maxZ: round(z1) },
    ...(STREET ? { area: AREA.id, extension: STREET_EXTENSION } : {}),
    ...(REGION ? { region: REGION } : {}),
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
        buildings: buildings.length - parts.length,
        buildingParts: parts.length,
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
