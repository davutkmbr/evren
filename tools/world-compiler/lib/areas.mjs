/**
 * Reads the OSM area list (OSM_AREAS) and the projection origin (WORLD_ORIGIN) from the TypeScript sources as text,
 * so plain Node scripts (scripts/data/fetch-osm.mjs) and the world compiler share one definition without importing
 * browser modules (src/world/osm/area.ts reads import.meta.env at load time).
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

const AREA_FILE = 'src/world/osm/area.ts';

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
  return out;
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
