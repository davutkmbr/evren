/**
 * Reads the OSM area list (OSM_AREAS) and the projection origin (WORLD_ORIGIN) from the TypeScript sources as text,
 * so plain Node scripts (scripts/data/fetch-osm.mjs) and the world compiler share one definition without importing
 * browser modules (src/world/osm/area.ts reads import.meta.env at load time). The dragon's landing spots
 * (tools/world-compiler/districts/landing-spots.json) add one street area each, unless an OSM_AREAS entry covers them.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

const AREA_FILE = 'src/world/osm/area.ts';
const SPOT_FILE = 'tools/world-compiler/districts/landing-spots.json';

/** Numeric fields of `export const NAME = { k: v, ... }` in `file`. */
export function parseConst(file, name, keys) {
  const src = readFileSync(resolve(ROOT, file), 'utf8');
  const m = src.match(new RegExp(`export const ${name} = \\{([^}]*)\\}`));
  if (!m) {
    throw new Error(`${name} not found in ${file}`);
  }
  const out = {};
  for (const k of keys) {
    const v = m[1].match(new RegExp(`${k}:\\s*(-?[\\d.]+)`));
    if (!v) {
      throw new Error(`${name}.${k} not found in ${file}`);
    }
    out[k] = Number(v[1]);
  }
  return out;
}

/** @returns {{ id: string, bbox: { south: number, west: number, north: number, east: number }, dataFile: string, profile: 'slice' | 'street' }[]} */
export function readAreas() {
  const src = readFileSync(resolve(ROOT, AREA_FILE), 'utf8');
  const list = src.match(/export const OSM_AREAS[^=]*=\s*\[([\s\S]*?)\];/);
  if (!list) {
    throw new Error(`OSM_AREAS not found in ${AREA_FILE}`);
  }
  const re = /\{\s*id:\s*'([\w-]+)',\s*bbox:\s*(\w+),\s*dataFile:\s*'([^']+)',\s*profile:\s*'(slice|street)'\s*\}/g;
  const out = [];
  for (const m of list[1].matchAll(re)) {
    out.push({ id: m[1], bbox: parseConst(AREA_FILE, m[2], ['south', 'west', 'north', 'east']), dataFile: m[3], profile: m[4] });
  }
  if (!out.length) {
    throw new Error(`OSM_AREAS in ${AREA_FILE} has no parsable entries`);
  }
  // Landing spots without an area of their own become street areas: the square of half side `radius` around the spot.
  for (const s of readLandingSpots()) {
    if (s.area) {
      if (!out.some((a) => a.id === s.area)) {
        throw new Error(`landing spot '${s.id}': unknown area '${s.area}'`);
      }
      continue;
    }
    if (out.some((a) => a.id === s.id)) {
      throw new Error(`landing spot '${s.id}' clashes with an OSM_AREAS id`);
    }
    out.push({ id: s.id, bbox: s.bbox, dataFile: `data/osm/${s.id}.json`, profile: 'street', spot: s.id });
  }
  return out;
}

/**
 * Landing spots (SPOT_FILE) with their compiled square: `rect` in world-local metres (+X east, +Z south) and `bbox`
 * (the same square in degrees, through the local projection, so the fetched bbox and the strip rect agree exactly).
 */
export function readLandingSpots() {
  const { spots } = JSON.parse(readFileSync(resolve(ROOT, SPOT_FILE), 'utf8'));
  // Scratch spots (benchmarks, experiments): EVREN_SCRATCH_SPOTS names a JSON file of the same shape. They exist only
  // for the tools run with that variable (fetch-osm.mjs, the compiler), never for the game.
  if (process.env.EVREN_SCRATCH_SPOTS) {
    spots.push(...JSON.parse(readFileSync(resolve(ROOT, process.env.EVREN_SCRATCH_SPOTS), 'utf8')).spots);
  }
  const o = readOrigin();
  const deg = Math.PI / 180;
  const mLat = 111_132.954 - 559.822 * Math.cos(2 * o.lat * deg) + 1.175 * Math.cos(4 * o.lat * deg);
  const mLon = deg * 6_378_137 * Math.cos(o.lat * deg);
  const ids = new Set();
  return spots.map((s) => {
    if (!/^[a-z][a-z0-9-]*$/.test(s.id) || ids.has(s.id)) {
      throw new Error(`landing spot id '${s.id}' is invalid or repeated`);
    }
    ids.add(s.id);
    const x = (s.lon - o.lon) * mLon;
    const z = -(s.lat - o.lat) * mLat;
    const r = s.radius;
    const rect = { minX: Math.round(x - r), minZ: Math.round(z - r), maxX: Math.round(x + r), maxZ: Math.round(z + r) };
    const bbox = {
      south: o.lat - rect.maxZ / mLat,
      west: o.lon + rect.minX / mLon,
      north: o.lat - rect.minZ / mLat,
      east: o.lon + rect.maxX / mLon,
    };
    return { ...s, placeWords: s.placeWords ?? [], x, z, rect, bbox };
  });
}

export function readLandingSpot(id) {
  return readLandingSpots().find((s) => s.id === id) ?? null;
}

export function readArea(id) {
  const areas = readAreas();
  const a = areas.find((x) => x.id === id);
  if (!a) {
    throw new Error(`unknown area '${id}' (known: ${areas.map((x) => x.id).join(', ')})`);
  }
  return a;
}

export function readOrigin() {
  return parseConst('src/core/geo-coords.ts', 'WORLD_ORIGIN', ['lat', 'lon']);
}
