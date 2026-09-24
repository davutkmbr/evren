/**
 * The strip compiled at full detail (format 1). Sources, first match wins:
 * 1. `--strip minX,minZ,maxX,maxZ` (local metres) or `--strip none` (every tile greybox);
 * 2. tools/world-compiler/s1/cameras.json: `strip.rect` / `strip.bounds` / `strip.bbox` as {minX, minZ, maxX, maxZ}
 *    or [minX, minZ, maxX, maxZ], or `strip.polygon` / `strip.corners` as [[x, z], ...] (its bbox is used);
 * 3. .docs/street/s1-strip.md: the first line naming a rect followed by four numbers (minX, minZ, maxX, maxZ);
 * 4. the bbox of the 'rihtim-carsi' walk route (src/street/routes.ts) grown by ROUTE_MARGIN.
 * Tiles whose square intersects the rect are 'full'; the others are 'greybox'.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { STREET_ROUTES } from '../../../src/street/routes';
import { ROOT } from '../lib/areas.mjs';
import type { Bounds2 } from './format';

const CAMERAS = 'tools/world-compiler/s1/cameras.json';
const SPEC = '.docs/street/s1-strip.md';
const ROUTE = 'rihtim-carsi';
const ROUTE_MARGIN = 30;

function fromValue(v: unknown): Bounds2 | null {
  if (!v) {
    return null;
  }
  if (Array.isArray(v) && v.length === 4 && v.every((n) => typeof n === 'number')) {
    const [a, b, c, d] = v as number[];
    return { minX: Math.min(a, c), minZ: Math.min(b, d), maxX: Math.max(a, c), maxZ: Math.max(b, d) };
  }
  if (Array.isArray(v) && v.length >= 3 && v.every((p) => Array.isArray(p) && p.length >= 2)) {
    const pts = v as number[][];
    return { minX: Math.min(...pts.map((p) => p[0])), minZ: Math.min(...pts.map((p) => p[p.length - 1])), maxX: Math.max(...pts.map((p) => p[0])), maxZ: Math.max(...pts.map((p) => p[p.length - 1])) };
  }
  const o = v as Record<string, unknown>;
  if (['minX', 'minZ', 'maxX', 'maxZ'].every((k) => typeof o[k] === 'number')) {
    return { minX: o.minX as number, minZ: o.minZ as number, maxX: o.maxX as number, maxZ: o.maxZ as number };
  }
  return null;
}

export function readStrip(cli: string | null): { rect: Bounds2; source: string } | null {
  if (cli === 'none') {
    return null;
  }
  if (cli) {
    const n = cli.split(',').map(Number);
    if (n.length !== 4 || n.some((v) => !Number.isFinite(v))) {
      throw new Error(`--strip wants minX,minZ,maxX,maxZ or none, got '${cli}'`);
    }
    return { rect: fromValue(n)!, source: 'cli' };
  }
  const cam = resolve(ROOT, CAMERAS);
  if (existsSync(cam)) {
    const json = JSON.parse(readFileSync(cam, 'utf8')) as Record<string, unknown>;
    const s = json.strip as Record<string, unknown> | undefined;
    const rect = s ? (fromValue(s.rect) ?? fromValue(s.bounds) ?? fromValue(s.bbox) ?? fromValue(s.polygon) ?? fromValue(s.corners) ?? fromValue(s)) : null;
    if (rect) {
      return { rect, source: CAMERAS };
    }
  }
  const spec = resolve(ROOT, SPEC);
  if (existsSync(spec)) {
    const m = readFileSync(spec, 'utf8').match(/rect[^\d\n-]*(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)/i);
    if (m) {
      return { rect: fromValue(m.slice(1, 5).map(Number))!, source: SPEC };
    }
  }
  const wp = STREET_ROUTES[ROUTE].waypoints;
  return {
    rect: {
      minX: Math.min(...wp.map((w) => w.x)) - ROUTE_MARGIN,
      minZ: Math.min(...wp.map((w) => w.z)) - ROUTE_MARGIN,
      maxX: Math.max(...wp.map((w) => w.x)) + ROUTE_MARGIN,
      maxZ: Math.max(...wp.map((w) => w.z)) + ROUTE_MARGIN,
    },
    source: `route:${ROUTE}`,
  };
}

export const intersects = (a: Bounds2, b: Bounds2): boolean => a.minX < b.maxX && b.minX < a.maxX && a.minZ < b.maxZ && b.minZ < a.maxZ;
