#!/usr/bin/env node
/**
 * Fetches OpenStreetMap buildings and streets for a small prototype area (Galata / Karaköy / Tophane / Cihangir)
 * from the Overpass API and writes compact local-metre JSON to public/data/osm/galata.json.
 *
 *   node scripts/data/fetch-osm.mjs [--cache /tmp/overpass.json]
 *
 * Data © OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright).
 * Output: { bbox, buildings: [{ ring:[x,z,...], height?, levels?, roof?, kind }], roads: [{ pts:[x,z,...], kind, width, lanes?, bridge? }] }
 * Coordinates: +X east, +Z south, metres, same projection as src/core/geo-coords.ts. Rings are counter-clockwise in
 * the x/z plane (positive shoelace area), without the closing duplicate point.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = resolve(ROOT, 'public/data/osm/galata.json');
const BBOX = { south: 41.0215, west: 28.968, north: 41.038, east: 28.99 };
/** Data is fetched ~75 m beyond the prototype area so the seam band (see src/world/osm/area.ts) is covered too. */
const MARGIN = { lat: 0.0007, lon: 0.0009 };
const ENDPOINT = 'https://overpass-api.de/api/interpreter';

/* Projection duplicated from src/core/geo-coords.ts. */
const ORIGIN = { lat: 41.045, lon: 29.02 };
const DEG = Math.PI / 180;
const M_LAT = 111_132.954 - 559.822 * Math.cos(2 * ORIGIN.lat * DEG) + 1.175 * Math.cos(4 * ORIGIN.lat * DEG);
const M_LON = DEG * 6_378_137 * Math.cos(ORIGIN.lat * DEG);
const project = (lat, lon) => [(lon - ORIGIN.lon) * M_LON, -(lat - ORIGIN.lat) * M_LAT];

const ROAD_CLASSES = {
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
};

const args = process.argv.slice(2);
const cacheIdx = args.indexOf('--cache');
const cachePath = cacheIdx >= 0 ? args[cacheIdx + 1] : null;

async function query() {
  if (cachePath && existsSync(cachePath)) {
    return JSON.parse(readFileSync(cachePath, 'utf8'));
  }
  const bb = `${BBOX.south - MARGIN.lat},${BBOX.west - MARGIN.lon},${BBOX.north + MARGIN.lat},${BBOX.east + MARGIN.lon}`;
  const hw = Object.keys(ROAD_CLASSES).join('|');
  const q = `[out:json][timeout:120];
(
  way["building"](${bb});
  relation["building"]["type"="multipolygon"](${bb});
  way["highway"~"^(${hw})$"](${bb});
  way["railway"="tram"](${bb});
  way["natural"="tree_row"](${bb});
  node["natural"="tree"](${bb});
  node["highway"="crossing"](${bb});
);
out geom tags;`;
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'evren-prototype/0.1 (fetch-osm.mjs)' },
    body: 'data=' + encodeURIComponent(q),
  });
  if (!res.ok) {
    throw new Error(`Overpass HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const json = await res.json();
  if (cachePath) {
    writeFileSync(cachePath, JSON.stringify(json));
  }
  return json;
}

function num(v) {
  if (v == null) {
    return undefined;
  }
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}

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

/** Douglas-Peucker on an open polyline of [x, z] points. */
function simplify(pts, tol) {
  if (pts.length < 3) {
    return pts;
  }
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
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

/** Closed ring (first == last) -> simplified CCW ring without the duplicate, or null when degenerate. */
function cleanRing(pts) {
  if (pts.length < 4) {
    return null;
  }
  let ring = simplify(pts, 0.35);
  if (ring.length > 1 && Math.hypot(ring[0][0] - ring.at(-1)[0], ring[0][1] - ring.at(-1)[1]) < 0.05) {
    ring = ring.slice(0, -1);
  }
  if (ring.length < 3) {
    return null;
  }
  const area = signedArea(ring);
  if (Math.abs(area) < 12) {
    return null;
  }
  return area < 0 ? ring.reverse() : ring;
}

/** Joins outer member ways of a multipolygon into closed rings. */
function joinRings(members) {
  const segs = members.filter((m) => m.type === 'way' && m.role !== 'inner' && m.geometry?.length > 1).map((m) => m.geometry.map((g) => project(g.lat, g.lon)));
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
}

const round = (v) => Math.round(v * 10) / 10;
const flat = (pts) => pts.flatMap((p) => [round(p[0]), round(p[1])]);

function buildingRecord(ring, tags) {
  const rec = { ring: flat(ring), kind: tags.building === 'yes' ? (tags.amenity ?? tags.shop ? 'commercial' : 'yes') : tags.building };
  const height = num(tags.height);
  const levels = num(tags['building:levels']);
  if (height && height > 2 && height < 250) {
    rec.height = round(height);
  }
  if (levels && levels > 0 && levels < 60) {
    rec.levels = Math.round(levels);
  }
  if (tags['roof:shape']) {
    rec.roof = tags['roof:shape'];
  }
  return rec;
}

async function main() {
  const t0 = Date.now();
  const data = await query();
  const buildings = [];
  const roads = [];
  const plazas = [];
  const trams = [];
  const treeRows = [];
  const trees = [];
  const crossings = [];
  let skipped = 0;
  for (const el of data.elements) {
    const tags = el.tags ?? {};
    if (el.type === 'node') {
      const [x, z] = project(el.lat, el.lon);
      if (tags.natural === 'tree') {
        trees.push(round(x), round(z));
      } else if (tags.crossing !== 'unmarked' && tags.crossing !== 'no') {
        crossings.push(round(x), round(z));
      }
      continue;
    }
    if (tags.railway === 'tram' && el.geometry) {
      if (!tags.tunnel || tags.tunnel === 'no') {
        trams.push({ pts: flat(simplify(el.geometry.map((g) => project(g.lat, g.lon)), 0.3)), gauge: (num(tags.gauge) ?? 1435) / 1000 });
      }
      continue;
    }
    if (tags.natural === 'tree_row' && el.geometry) {
      treeRows.push({ pts: flat(simplify(el.geometry.map((g) => project(g.lat, g.lon)), 1)) });
      continue;
    }
    if (tags.highway === 'pedestrian' && tags.area === 'yes' && el.geometry) {
      const ring = cleanRing(el.geometry.map((g) => project(g.lat, g.lon)));
      if (ring) {
        plazas.push({ ring: flat(ring) });
      }
      continue;
    }
    if (tags.building) {
      if (tags.building === 'no' || tags.building === 'construction' || tags.location === 'underground') {
        skipped++;
        continue;
      }
      const rings = el.type === 'way' ? (el.geometry ? [el.geometry.map((g) => project(g.lat, g.lon))] : []) : joinRings(el.members ?? []);
      for (const raw of rings) {
        const ring = cleanRing(raw);
        if (ring) {
          buildings.push(buildingRecord(ring, tags));
        } else {
          skipped++;
        }
      }
    } else if (tags.highway && el.type === 'way' && el.geometry) {
      if (tags.tunnel && tags.tunnel !== 'no') {
        continue;
      }
      if (tags.area === 'yes') {
        continue;
      }
      const pts = simplify(
        el.geometry.map((g) => project(g.lat, g.lon)),
        0.8,
      );
      if (pts.length < 2) {
        continue;
      }
      const lanes = num(tags.lanes);
      const tagged = num(tags.width);
      const base = ROAD_CLASSES[tags.highway] ?? 6;
      const width = tagged && tagged > 2 && tagged < 40 ? tagged : lanes ? Math.max(base * 0.7, Math.min(base * 1.4, lanes * 3.3 + 1.5)) : base;
      const rec = { pts: flat(pts), kind: tags.highway, width: round(width) };
      if (lanes) {
        rec.lanes = lanes;
      }
      if (tags.bridge && tags.bridge !== 'no') {
        rec.bridge = true;
      }
      if (tags.name) {
        rec.name = tags.name;
      }
      if (tags.surface) {
        rec.surface = tags.surface;
      }
      if (tags.oneway === 'yes') {
        rec.oneway = true;
      }
      roads.push(rec);
    }
  }
  const [x0, z1] = project(BBOX.south, BBOX.west);
  const [x1, z0] = project(BBOX.north, BBOX.east);
  const out = {
    source: 'OpenStreetMap contributors, ODbL 1.0 (Overpass API)',
    fetched: new Date().toISOString().slice(0, 10),
    bbox: { ...BBOX, minX: round(x0), maxX: round(x1), minZ: round(z0), maxZ: round(z1) },
    buildings,
    roads,
    plazas,
    trams,
    trees,
    treeRows,
    crossings,
  };
  mkdirSync(dirname(OUT), { recursive: true });
  const text = JSON.stringify(out);
  writeFileSync(OUT, text);
  console.log(
    JSON.stringify({ ok: true, out: OUT, bytes: text.length, buildings: buildings.length, roads: roads.length, plazas: plazas.length, trams: trams.length, trees: trees.length / 2, treeRows: treeRows.length, crossings: crossings.length / 2, skipped, withHeight: buildings.filter((b) => b.height).length, withLevels: buildings.filter((b) => b.levels).length, ms: Date.now() - t0 }),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
