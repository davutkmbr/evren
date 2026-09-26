#!/usr/bin/env node
/**
 * Fetches every city / castle wall of the playable world from OpenStreetMap (Overpass, one polite query) and writes
 * a compact wall dataset for the city-wall kit (src/world/landmarks/walls/kit):
 *
 *   node scripts/data/fetch-walls.mjs [--cache <overpass.json>] [--supplement <id>] [--source local|overpass]
 *
 * OSM queries run against the local Geofabrik extract index by default (scripts/data/lib/osm-local.mjs);
 * `--source overpass` sends them to the public Overpass API. The supplement always queries its own endpoint.
 *
 * Output: data/osm/walls.json (compiler input, not served and not read by the game; schema WallData in
 * src/world/landmarks/walls/data/types.ts). Coordinates are local metres (+X east, +Z south, same projection as
 * src/core/geo-coords.ts) rounded to 0.1 m. Placing the wall kit along these lines is the world compiler's job later
 * (.docs/planning/22-city-walls.md).
 *
 * What is extracted (all generic OSM tagging, nothing per coordinate):
 * - lines: barrier=city_wall / historic=citywalls|city_wall|castle_wall / wall=castle_wall ways and the outer members
 *   of such multipolygons. Closed ways are classified by shape: small compact rings are towers, thin rings (mean
 *   width 2 area / perimeter < 12 m) are a thick wall drawn as an outline ('areas', extruded), the rest are enclosures
 *   walked as closed lines. height / width / material / ruins / start_date tags are kept.
 * - towers: man_made=tower (tower:type defensive, or untyped within 30 m of a wall), historic=city_gate ways (gate
 *   pylons), compact city-wall rings; outlines kept (or a point for nodes).
 * - gates: historic=city_gate / barrier=city_gate nodes (and the centroids of gate ways).
 * - openings: per line, arc-length intervals where a highway or railway crosses (road breach, path gate, rail) or
 *   where the wall line runs through an OSM building that is not itself part of the walls (houses built into or over
 *   the wall line). Tunnels and bridges are ignored.
 * - owned: OSM ids of the buildings the walls module draws itself (towers, gate pylons, wall rings), so the OSM
 *   building layer can leave them out.
 *
 * --supplement <id>: merges an extra wall trace for courses OSM does not map (only stretches farther than 40 m from
 * every OSM line). It runs only when the source is approved in tools/assets/approved.json (an entry with that id and
 * kind "data"); see .docs/assets/candidates/sea-walls-data.md.
 *
 * Data © OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright). Supplement
 * ohm-walls-constantinople: OpenHistoricalMap contributors, CC0 1.0 (https://www.openhistoricalmap.org/copyright).
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { readOrigin, ROOT } from '../../tools/world-compiler/lib/areas.mjs';
import { overpassLocal, sourceArg } from './lib/osm-local.mjs';

const args = process.argv.slice(2);
const argOf = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const OUT = resolve(ROOT, 'data/osm/walls.json');
const cachePath = argOf('--cache');
const supplementId = argOf('--supplement');
const SOURCE = sourceArg(args);

const ORIGIN = readOrigin();
const DEG = Math.PI / 180;
const M_LAT = 111_132.954 - 559.822 * Math.cos(2 * ORIGIN.lat * DEG) + 1.175 * Math.cos(4 * ORIGIN.lat * DEG);
const M_LON = DEG * 6_378_137 * Math.cos(ORIGIN.lat * DEG);
const project = (lat, lon) => [(lon - ORIGIN.lon) * M_LON, -(lat - ORIGIN.lat) * M_LAT];
const unproject = (x, z) => [ORIGIN.lat - z / M_LAT, ORIGIN.lon + x / M_LON];
/** Playable square (WORLD_HALF_SIZE 24 km) in degrees, with a little margin. */
const HALF = 24_500;
const BBOX = [ORIGIN.lat - HALF / M_LAT, ORIGIN.lon - HALF / M_LON, ORIGIN.lat + HALF / M_LAT, ORIGIN.lon + HALF / M_LON].map((v) => v.toFixed(4)).join(',');

const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
const UA = 'evren-walls/1.0 (scripts/data/fetch-walls.mjs)';

const WALL_FILTERS = ['["barrier"="city_wall"]', '["historic"="citywalls"]', '["historic"="city_wall"]', '["historic"="castle_wall"]', '["wall"="castle_wall"]'];
const QUERY = `[out:json][timeout:240];
(
${WALL_FILTERS.map((f) => `  way${f}(${BBOX});\n  relation${f}(${BBOX});`).join('\n')}
)->.w;
(
  node["man_made"="tower"](${BBOX});
  way["man_made"="tower"](${BBOX});
  node["historic"="city_gate"](${BBOX});
  way["historic"="city_gate"](${BBOX});
  node["barrier"="city_gate"](${BBOX});
)->.f;
.w out body geom;
.f out body geom;
(
  way(around.w:40)["highway"];
  way(around.w:40)["railway"];
  way(around.w:40)["building"];
  relation(around.w:40)["building"];
)->.n;
.n out body geom;`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function overpass(url, q, name) {
  if (!url && SOURCE === 'local') {
    const json = overpassLocal(q);
    console.error(`[fetch-walls] ${name}: ${json.elements.length} elements from the local index`);
    return json;
  }
  let last = null;
  const endpoints = url ? [url] : ENDPOINTS;
  for (let attempt = 0; attempt < 6; attempt++) {
    const ep = endpoints[attempt % endpoints.length];
    try {
      const t = Date.now();
      const res = await fetch(ep, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'User-Agent': UA },
        body: 'data=' + encodeURIComponent(q),
        signal: AbortSignal.timeout(260_000),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const text = await res.text();
      if (!text.startsWith('{')) {
        throw new Error('non-JSON answer (server busy)');
      }
      const json = JSON.parse(text);
      if (json.remark && /error|timed out|runtime/i.test(json.remark)) {
        throw new Error(`remark: ${json.remark}`);
      }
      console.error(`[fetch-walls] ${name}: ${json.elements.length} elements from ${ep} in ${Date.now() - t} ms`);
      return json;
    } catch (e) {
      last = e;
      console.error(`[fetch-walls] ${name} via ${ep} failed (${e.message}), retrying`);
      await sleep(15000 * (attempt + 1));
    }
  }
  throw last;
}

/* ---------------------------------------------------------------- geometry */

const r1 = (v) => Math.round(v * 10) / 10;
const ringOf = (geom) => geom.map((p) => project(p.lat, p.lon));
function isClosed(g) {
  return g.length > 3 && g[0][0] === g[g.length - 1][0] && g[0][1] === g[g.length - 1][1];
}
function area(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}
function perimeter(pts, closed) {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  if (closed) l += Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]);
  return l;
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
function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz || 1e-9;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2));
  return Math.hypot(ax + dx * t - px, az + dz * t - pz);
}
function polyDist(pts, x, z) {
  let d = Infinity;
  for (let i = 1; i < pts.length; i++) d = Math.min(d, segDist(x, z, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]));
  return d;
}
function pointInRing(ring, x, z) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a[1] > z !== b[1] > z && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1] || 1e-9) + a[0]) inside = !inside;
  }
  return inside;
}
/** Segment intersection parameter t on a→b (or null). */
function segHit(a, b, c, d) {
  const rx = b[0] - a[0];
  const rz = b[1] - a[1];
  const sx = d[0] - c[0];
  const sz = d[1] - c[1];
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c[0] - a[0]) * sz - (c[1] - a[1]) * sx) / den;
  const u = ((c[0] - a[0]) * rz - (c[1] - a[1]) * rx) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { t, sin: Math.abs(den) / (Math.hypot(rx, rz) * Math.hypot(sx, sz) || 1) };
}

/** Parses "14", "14 m", "13-15", "12;14" to metres (mean). */
function metres(v) {
  if (!v) return undefined;
  const nums = String(v)
    .replace(',', '.')
    .match(/\d+(\.\d+)?/g);
  if (!nums) return undefined;
  const n = nums.map(Number);
  const m = n.reduce((a, b) => a + b, 0) / n.length;
  return m > 0 && m < 80 ? r1(m) : undefined;
}
function year(v) {
  if (!v) return undefined;
  const s = String(v).trim();
  const c = s.match(/^[cC](\d{1,2})$/);
  if (c) return (Number(c[1]) - 1) * 100 + 50;
  const y = s.match(/^-?\d{1,4}/);
  return y ? Number(y[0]) : undefined;
}

const HIGHWAY_WIDTH = {
  motorway: 16, trunk: 14, primary: 12, secondary: 10, tertiary: 8, unclassified: 6, residential: 5.5, living_street: 4.5, pedestrian: 6,
  motorway_link: 7, trunk_link: 7, primary_link: 7, secondary_link: 7, tertiary_link: 6, service: 4, busway: 7, road: 6, track: 3,
  footway: 2, path: 1.5, steps: 2.5, cycleway: 2, bridleway: 2,
};
const FOOT = new Set(['footway', 'path', 'steps', 'cycleway', 'bridleway', 'pedestrian', 'track']);
const RAIL = new Set(['rail', 'tram', 'light_rail', 'narrow_gauge', 'subway', 'funicular']);
const NOT_DEFENSIVE = /communication|minaret|bell_tower|observation|cooling|lighting|water|radar|clock|chimney|transmission/;

/** Opening kinds (see data/types.ts). */
const OPEN_ROAD = 0;
const OPEN_PATH = 1;
const OPEN_BUILDING = 2;
const OPEN_RAIL = 3;
const OPEN_WATER = 4;

/* ---------------------------------------------------------------- main */

function isWallTagged(t) {
  return t.barrier === 'city_wall' || t.historic === 'citywalls' || t.historic === 'city_wall' || t.historic === 'castle_wall' || t.wall === 'castle_wall';
}

function lineMeta(t) {
  const m = {};
  const h = metres(t.height);
  if (h) m.h = h;
  const w = metres(t.width) ?? metres(t.thickness);
  if (w && w < 15) m.thick = w;
  if (t.ruins === 'yes' || t.ruins === 'wall' || t.historic === 'ruins' || t['ruins:historic'] || t.ruined === 'yes') m.ruined = 1;
  const mat = (t.material || t['wall:material'] || t['building:material'] || '').toLowerCase();
  if (mat) m.mat = mat.includes('brick') ? 'brick' : mat.includes('lime') ? 'limestone' : 'stone';
  const civ = (t['historic:civilization'] || t['historic:period'] || '').toLowerCase();
  if (civ.includes('byzant') || civ.includes('roman')) m.era = 'byzantine';
  else if (civ.includes('ottoman')) m.era = 'ottoman';
  else if (civ.includes('genoese')) m.era = 'genoese';
  const y = year(t.start_date);
  if (y !== undefined) m.year = y;
  if (t.wall === 'castle_wall' || t.historic === 'castle_wall' || (t.barrier === 'wall' && !t.historic)) m.castle = 1;
  if (t.name) m.name = t.name;
  return m;
}

function supplementApproved(id) {
  const file = resolve(ROOT, 'tools/assets/approved.json');
  const approved = JSON.parse(readFileSync(file, 'utf8'));
  return approved.assets.find((a) => a.id === id && a.kind === 'data') ?? null;
}

async function main() {
  let raw;
  if (cachePath && existsSync(cachePath)) {
    raw = JSON.parse(readFileSync(cachePath, 'utf8'));
    console.error(`[fetch-walls] using cache ${cachePath} (${raw.elements.length} elements)`);
  } else {
    raw = await overpass(null, QUERY, 'walls');
    if (cachePath) writeFileSync(cachePath, JSON.stringify(raw));
  }

  const lines = [];
  const areas = [];
  const towers = [];
  const gates = [];
  const owned = new Set();
  const wallIds = new Set();

  const addTower = (id, ring, t, gate) => {
    const c = centroid(ring);
    const rec = { id, x: r1(c[0]), z: r1(c[1]), ring: ring.flatMap((p) => [r1(p[0]), r1(p[1])]) };
    const h = metres(t.height);
    if (h) rec.h = h;
    if (t.historic === 'ruins' || t.ruins === 'yes') rec.ruined = 1;
    if (gate) rec.gate = 1;
    if (t.name) rec.name = t.name;
    towers.push(rec);
    owned.add(id);
  };

  const wallGeoms = [];
  const seen = new Set();
  const handleWallRing = (id, geomPts, t, closedFlag) => {
    if (seen.has(id)) return;
    seen.add(id);
    const closed = closedFlag || isClosed(geomPts);
    const pts = closed && isClosed(geomPts) ? geomPts.slice(0, -1) : geomPts;
    if (pts.length < 2) return;
    const meta = lineMeta(t);
    if (closed && pts.length >= 3) {
      const A = Math.abs(area(pts));
      const P = perimeter(pts, true);
      const compact = (4 * Math.PI * A) / (P * P);
      const meanWidth = (2 * A) / P;
      if (P < 90 && compact > 0.35) {
        addTower(id, pts, t, false);
        return;
      }
      if (meanWidth < 12 && (t.area === 'yes' || t.building || meanWidth < 6)) {
        areas.push({ id, ring: pts.flatMap((p) => [r1(p[0]), r1(p[1])]), ...meta });
        owned.add(id);
        wallGeoms.push(pts.concat([pts[0]]));
        return;
      }
    }
    if (t.building) owned.add(id);
    lines.push({ id, pts, closed: closed ? 1 : 0, meta });
    wallGeoms.push(closed ? pts.concat([pts[0]]) : pts);
  };

  const els = raw.elements;
  // Wall ways and relations.
  for (const e of els) {
    const t = e.tags ?? {};
    if (!isWallTagged(t) || t.man_made === 'tower' || t.historic === 'city_gate') continue;
    if (e.type === 'way' && e.geometry) {
      wallIds.add(e.id);
      handleWallRing(e.id, ringOf(e.geometry), t, false);
    } else if (e.type === 'relation') {
      for (const m of e.members ?? []) {
        if (m.type === 'way' && m.geometry && m.role !== 'inner') {
          wallIds.add(m.ref);
          handleWallRing(m.ref, ringOf(m.geometry), t, t.type === 'multipolygon');
        }
      }
    }
  }
  // Towers and gates.
  const nearWall = (x, z, d) => wallGeoms.some((g) => polyDist(g, x, z) < d);
  for (const e of els) {
    const t = e.tags ?? {};
    const tower = t.man_made === 'tower' && !NOT_DEFENSIVE.test(t['tower:type'] ?? '');
    const gate = t.historic === 'city_gate' || t.barrier === 'city_gate';
    if (!tower && !gate) continue;
    if (e.type === 'node') {
      const [x, z] = project(e.lat, e.lon);
      if (gate) {
        if (!gates.some((g) => Math.hypot(g.x - x, g.z - z) < 8)) gates.push({ x: r1(x), z: r1(z), ...(t.name ? { name: t.name } : {}) });
      } else if ((t['tower:type'] ?? '').includes('defen') || nearWall(x, z, 15)) {
        towers.push({ id: e.id, x: r1(x), z: r1(z), ...(metres(t.height) ? { h: metres(t.height) } : {}) });
      }
    } else if (e.type === 'way' && e.geometry) {
      const g = ringOf(e.geometry);
      const ring = isClosed(g) ? g.slice(0, -1) : g;
      if (ring.length < 3) continue;
      const [cx, cz] = centroid(ring);
      if (!gate && !(t['tower:type'] ?? '').includes('defen') && !nearWall(cx, cz, 30)) continue;
      if (Math.abs(area(ring)) > 2500) continue;
      addTower(e.id, ring, t, gate);
      if (gate && !gates.some((q) => Math.hypot(q.x - cx, q.z - cz) < 30)) gates.push({ x: r1(cx), z: r1(cz), ...(t.name ? { name: t.name } : {}) });
    }
  }

  // Optional supplement for courses OSM does not map.
  if (supplementId) {
    const entry = supplementApproved(supplementId);
    if (!entry) {
      throw new Error(`--supplement ${supplementId}: not approved (no entry with this id and kind "data" in tools/assets/approved.json)`);
    }
    const sup = await overpass(entry.endpoint, entry.query.replace('{{bbox}}', BBOX), supplementId);
    let added = 0;
    for (const e of sup.elements) {
      if (e.type !== 'way' || !e.geometry || e.tags?.end_date) continue;
      const pts = ringOf(e.geometry);
      // Keep only the stretches not covered by an OSM wall (40 m), densified to 10 m so the cut is clean.
      const dense = [];
      for (let i = 0; i < pts.length - 1; i++) {
        const n = Math.max(1, Math.ceil(Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]) / 10));
        for (let k = 0; k < n; k++) dense.push([pts[i][0] + ((pts[i + 1][0] - pts[i][0]) * k) / n, pts[i][1] + ((pts[i + 1][1] - pts[i][1]) * k) / n]);
      }
      dense.push(pts[pts.length - 1]);
      let run = [];
      let part = 0;
      const flush = () => {
        const shadow = run.filter((q) => nearWall(q[0], q[1], 90)).length / Math.max(1, run.length);
        if (run.length > 1 && perimeter(run, false) > 60 && shadow < 0.6) {
          lines.push({ id: e.id * 100 + part++, pts: run, closed: 0, meta: { ...lineMeta(e.tags ?? {}), src: supplementId } });
          added++;
        }
        run = [];
      };
      for (const p of dense) {
        if (nearWall(p[0], p[1], 40)) flush();
        else run.push(p);
      }
      // Drop stretches that shadow a mapped OSM wall 40-90 m away over most of their length (the coarse trace of a
      // course OSM already has).
      flush();
    }
    console.error(`[fetch-walls] supplement ${supplementId}: ${added} stretches`);
    // OSM context around the supplemented stretches (the main query only covered the OSM walls): roads, railways,
    // buildings for the openings, and the coastline to keep the wall off the water. One query.
    const sup2 = lines.filter((L) => L.meta.src === supplementId);
    if (sup2.length) {
      const around = (r, L) => {
        const ll = [];
        for (let i = 0; i < L.pts.length; i += Math.max(1, Math.floor(L.pts.length / 40))) ll.push(...unproject(L.pts[i][0], L.pts[i][1]).map((v) => v.toFixed(6)));
        const last = L.pts[L.pts.length - 1];
        ll.push(...unproject(last[0], last[1]).map((v) => v.toFixed(6)));
        return `around:${r},${ll.join(',')}`;
      };
      const q = `[out:json][timeout:240];\n(\n${sup2
        .map((L) => `  way(${around(40, L)})["highway"];\n  way(${around(40, L)})["railway"];\n  way(${around(40, L)})["building"];\n  relation(${around(40, L)})["building"];\n  way(${around(90, L)})["natural"="coastline"];`)
        .join('\n')}\n);\nout body geom;`;
      const ctxCache = cachePath ? `${cachePath}.${supplementId}.json` : null;
      let ctx;
      if (ctxCache && existsSync(ctxCache)) {
        ctx = JSON.parse(readFileSync(ctxCache, 'utf8'));
      } else {
        ctx = await overpass(null, q, `${supplementId} context`);
        if (ctxCache) writeFileSync(ctxCache, JSON.stringify(ctx));
      }
      const seenIds = new Set(els.map((e) => `${e.type}${e.id}`));
      for (const e of ctx.elements) {
        if (!seenIds.has(`${e.type}${e.id}`)) {
          els.push(e);
          seenIds.add(`${e.type}${e.id}`);
        }
      }
    }
  }
  // Coastline segments (land on the left of the drawing direction) for the water test.
  const coast = [];
  for (const e of els) {
    if (e.type === 'way' && e.geometry && e.tags?.natural === 'coastline') coast.push(ringOf(e.geometry));
  }
  /** True when (x, z) is on the sea side of the nearest coastline segment within 90 m. */
  const inWater = (x, z) => {
    let best = null;
    let bd = 90;
    for (const c of coast) {
      for (let i = 1; i < c.length; i++) {
        const d = segDist(x, z, c[i - 1][0], c[i - 1][1], c[i][0], c[i][1]);
        if (d < bd) {
          bd = d;
          best = [c[i - 1], c[i]];
        }
      }
    }
    if (!best) return false;
    const [a, b] = best;
    // x right, z south: land on the left in map view means cross((b-a),(p-a)) < 0 in x/z for water... test sign.
    const cr = (b[0] - a[0]) * (z - a[1]) - (b[1] - a[1]) * (x - a[0]);
    return cr > 0;
  };

  // Openings: crossings with roads / rails and runs through foreign buildings.
  const roads = [];
  const buildings = [];
  for (const e of els) {
    const t = e.tags ?? {};
    if (e.type !== 'way' && e.type !== 'relation') continue;
    if (wallIds.has(e.id) || owned.has(e.id) || isWallTagged(t) || t.man_made === 'tower' || t.historic === 'city_gate') continue;
    if (e.type === 'way' && e.geometry && (t.highway || t.railway)) {
      if (t.tunnel && t.tunnel !== 'no') continue;
      if (t.bridge && t.bridge !== 'no') continue;
      if (t.layer && Number(t.layer) < 0) continue;
      if (t.highway && (t.area === 'yes' || !HIGHWAY_WIDTH[t.highway])) continue;
      if (t.railway && !RAIL.has(t.railway)) continue;
      const kind = t.railway ? OPEN_RAIL : FOOT.has(t.highway) ? OPEN_PATH : OPEN_ROAD;
      const w = metres(t.width) ?? (t.railway ? (t.railway === 'tram' ? 6 : 8) : HIGHWAY_WIDTH[t.highway]);
      roads.push({ pts: ringOf(e.geometry), kind, w });
    } else if (t.building && t.building !== 'no' && !t.historic && !t.castle_type && t.building !== 'ruins' && t.building !== 'roof' && t.building !== 'castle') {
      // Historic buildings (castles, ruins, gatehouses) share the wall line; only ordinary buildings open it.
      if (e.type === 'way' && e.geometry) buildings.push(Object.assign(ringOf(e.geometry), { id: e.id }));
      else if (e.type === 'relation') {
        const holes = (e.members ?? []).filter((m) => m.role === 'inner' && m.geometry).map((m) => ringOf(m.geometry));
        for (const m of e.members ?? []) if (m.role === 'outer' && m.geometry) buildings.push(Object.assign(ringOf(m.geometry), { id: e.id, holes }));
      }
    }
  }

  const outLines = [];
  for (const L of lines) {
    const pts = L.closed ? L.pts.concat([L.pts[0]]) : L.pts;
    const acc = [0];
    for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = acc[acc.length - 1];
    const open = [];
    for (const r of roads) {
      for (let i = 0; i < pts.length - 1; i++) {
        for (let k = 0; k < r.pts.length - 1; k++) {
          const hit = segHit(pts[i], pts[i + 1], r.pts[k], r.pts[k + 1]);
          if (!hit) continue;
          // Grazing hits (< 20 degrees) are a road running along the wall line (or a coarse trace wobbling across a
          // parallel road), not a crossing.
          if (hit.sin < 0.34) continue;
          const s = acc[i] + (acc[i + 1] - acc[i]) * hit.t;
          const half = Math.min(15, (r.w / 2 + (r.kind === OPEN_PATH ? 0.6 : 1.5)) / hit.sin);
          open.push([s - half, s + half, r.kind]);
        }
      }
    }
    // Runs inside foreign buildings (1 m samples). A building holding more than 50 m of the line is the wall itself
    // (or a castle) mapped as a building, not a house over the wall line: it does not open the wall.
    const bb = buildings.filter((b) => b.some((p) => polyDist(pts, p[0], p[1]) < 60));
    const step = 1;
    const hits = [];
    const inside = new Map();
    for (let s = 0; s <= total + 1e-6; s += step) {
      let i = 1;
      while (i < acc.length - 1 && acc[i] < s) i++;
      const t = acc[i] > acc[i - 1] ? (s - acc[i - 1]) / (acc[i] - acc[i - 1]) : 0;
      const x = pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t;
      const z = pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t;
      const hitB = bb.find((b) => pointInRing(b, x, z) && !(b.holes ?? []).some((h) => pointInRing(h, x, z))) ?? null;
      hits.push(hitB);
      if (hitB) inside.set(hitB.id, (inside.get(hitB.id) ?? 0) + step);
    }
    let runStart = -1;
    for (let k = 0; k <= hits.length; k++) {
      const b = k < hits.length ? hits[k] : null;
      const inB = !!b && inside.get(b.id) <= 50;
      if (inB && runStart < 0) runStart = k * step;
      if (!inB && runStart >= 0) {
        if (k * step - runStart >= 2) open.push([runStart - 0.5, k * step - 0.5, OPEN_BUILDING]);
        runStart = -1;
      }
    }
    // Stretches over water (supplement lines only: OSM walls are drawn where they stand).
    if (L.meta.src && coast.length) {
      let w0 = -1;
      for (let s2 = 0; s2 <= total + 1e-6; s2 += 2) {
        let i = 1;
        while (i < acc.length - 1 && acc[i] < s2) i++;
        const t = acc[i] > acc[i - 1] ? (s2 - acc[i - 1]) / (acc[i] - acc[i - 1]) : 0;
        const wet = inWater(pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t);
        if (wet && w0 < 0) w0 = s2;
        if ((!wet || s2 + 2 > total) && w0 >= 0) {
          open.push([w0 - 1, s2 + 1, OPEN_WATER]);
          w0 = -1;
        }
      }
    }
    // Merge overlapping openings (the stronger kind wins: water > road > rail > building > path).
    open.sort((a, b) => a[0] - b[0]);
    const rank = [3, 0, 1, 2, 4];
    const merged = [];
    for (const o of open) {
      const lo = Math.max(0, o[0]);
      const hi = Math.min(total, o[1]);
      if (hi <= lo) continue;
      const last = merged[merged.length - 1];
      if (last && lo <= last[1] + 1) {
        last[1] = Math.max(last[1], hi);
        if (rank[o[2]] > rank[last[2]]) last[2] = o[2];
      } else merged.push([lo, hi, o[2]]);
    }
    const rec = { id: L.id, ...L.meta, pts: L.pts.flatMap((p) => [r1(p[0]), r1(p[1])]) };
    if (L.closed) rec.closed = 1;
    if (merged.length) rec.open = merged.flatMap((o) => [r1(o[0]), r1(o[1]), o[2]]);
    outLines.push(rec);
  }

  // Openings of the outline walls: road / rail crossing points on the outline, [x, z, half width, kind].
  for (const a of areas) {
    const ring = [];
    for (let i = 0; i < a.ring.length; i += 2) ring.push([a.ring[i], a.ring[i + 1]]);
    ring.push(ring[0]);
    const pts = [];
    for (const r of roads) {
      for (let i = 0; i < ring.length - 1; i++) {
        for (let k = 0; k < r.pts.length - 1; k++) {
          const hit = segHit(ring[i], ring[i + 1], r.pts[k], r.pts[k + 1]);
          if (!hit) continue;
          const x = ring[i][0] + (ring[i + 1][0] - ring[i][0]) * hit.t;
          const z = ring[i][1] + (ring[i + 1][1] - ring[i][1]) * hit.t;
          pts.push(r1(x), r1(z), r1(Math.min(20, (r.w / 2 + (r.kind === OPEN_PATH ? 0.6 : 1.5)) / Math.max(0.35, hit.sin))), r.kind);
        }
      }
    }
    if (pts.length) a.open = pts;
  }

  const counts = { lines: outLines.length, areas: areas.length, towers: towers.length, gates: gates.length, owned: owned.size, roads: roads.length, buildings: buildings.length };
  const km = outLines.reduce((a, l) => {
    let s = 0;
    for (let i = 2; i < l.pts.length; i += 2) s += Math.hypot(l.pts[i] - l.pts[i - 2], l.pts[i + 1] - l.pts[i - 1]);
    return a + s;
  }, 0);
  console.error(`[fetch-walls] ${JSON.stringify(counts)}, ${(km / 1000).toFixed(1)} km of wall lines`);

  const data = {
    $comment: `Generated by scripts/data/fetch-walls.mjs. Data © OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright).${supplementId ? ` Lines with src "${supplementId}": OpenHistoricalMap contributors, CC0 1.0 (https://www.openhistoricalmap.org/copyright).` : ''}`,
    generated: new Date().toISOString().slice(0, 10),
    sources: ['osm', ...(supplementId ? [supplementId] : [])],
    lines: outLines,
    areas,
    towers,
    gates,
    owned: [...owned].sort((a, b) => a - b),
  };
  const body = JSON.stringify(data);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, body);
  console.error(`[fetch-walls] wrote ${OUT} (${(body.length / 1024).toFixed(1)} KB)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
