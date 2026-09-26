#!/usr/bin/env node
/**
 * Plans, fetches and indexes the flight-scale OSM regions: real OpenStreetMap buildings and streets around every
 * dragon landing spot (tools/world-compiler/districts/landing-spots.json), streamed by src/world/osm/index.ts next to
 * the always-loaded Galata slice (OSM_AREA).
 *
 *   node scripts/data/osm-regions.mjs plan                 # writes src/world/osm/regions.json (no network)
 *   node scripts/data/osm-regions.mjs fetch [--only a,b] [--force]
 *                                                          # fetch-osm.mjs --region <id> for each region, one at a time
 *   node scripts/data/osm-regions.mjs index                # drops empty regions, records sizes in regions.json
 *
 * Plan rules (generic, no per-place data):
 * - A global CELL lattice anchored at the Galata slice's build rect (so the slice's west / north edges are cell
 *   lines). A cell is covered when it lies within SURROUND of a landing spot.
 * - Covered cells are grouped per BLOCK x BLOCK block; each block's cells become the fewest axis-aligned rectangles
 *   (full block, halves, single cells). Every rectangle minus the Galata build rect (up to four pieces) is a region;
 *   pieces thinner than MIN_SIDE are dropped (the procedural city fills them).
 * - Regions never overlap (runtime: src/world/osm/regions.ts derives the build rects and seams from these areas).
 *
 * Data © OpenStreetMap contributors, ODbL 1.0.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { readArea, readLandingSpots, readOrigin, ROOT } from '../../tools/world-compiler/lib/areas.mjs';

const MANIFEST = resolve(ROOT, 'src/world/osm/regions.json');
const DATA_DIR = 'public/data/osm/regions';
/** Lattice cell (m). */
const CELL = 1000;
/** Cells per block side: a region is at most BLOCK x BLOCK cells. */
const BLOCK = 2;
/** A cell is covered when its nearest point is within this distance (m) of a landing spot. */
const SURROUND = 1200;
/** Region pieces thinner than this (m) are dropped. */
const MIN_SIDE = 200;
/** Must match OSM_SEAM (area.ts) and GROUND_STEP (shared/ground.ts). */
const SEAM = 40;
const GROUND_STEP = 5;
/** Regions with less content than this are dropped by `index` (open water, empty hillsides). */
const MIN_CONTENT = { buildings: 12, roads: 12 };

const args = process.argv.slice(2);
const cmd = args[0];
const argOf = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};

const o = readOrigin();
const DEG = Math.PI / 180;
const M_LAT = 111_132.954 - 559.822 * Math.cos(2 * o.lat * DEG) + 1.175 * Math.cos(4 * o.lat * DEG);
const M_LON = DEG * 6_378_137 * Math.cos(o.lat * DEG);
const toLocal = (lat, lon) => ({ x: (lon - o.lon) * M_LON, z: -(lat - o.lat) * M_LAT });
const toBbox = (r) => ({
  south: +(o.lat - r.maxZ / M_LAT).toFixed(6),
  west: +(o.lon + r.minX / M_LON).toFixed(6),
  north: +(o.lat - r.minZ / M_LAT).toFixed(6),
  east: +(o.lon + r.maxX / M_LON).toFixed(6),
});

/** Galata slice build rect: OSM_AREA + seam, grown to the ground lattice (shared/foundation.ts buildWorkerBase). */
function galataRect() {
  const g = readArea('galata').bbox;
  const sw = toLocal(g.south, g.west);
  const ne = toLocal(g.north, g.east);
  const s = GROUND_STEP;
  return {
    minX: Math.floor((sw.x - SEAM) / s) * s,
    maxX: Math.ceil((ne.x + SEAM) / s) * s,
    minZ: Math.floor((ne.z - SEAM) / s) * s,
    maxZ: Math.ceil((sw.z + SEAM) / s) * s,
  };
}

const rectDist = (r, x, z) => Math.hypot(Math.max(r.minX - x, 0, x - r.maxX), Math.max(r.minZ - z, 0, z - r.maxZ));
const overlaps = (a, b) => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;

/** `r` minus `cut`: up to four rectangles (north / south full width, west / east between them). */
function subtract(r, cut) {
  if (!overlaps(r, cut)) {
    return [r];
  }
  const out = [];
  if (cut.minZ > r.minZ) out.push({ ...r, maxZ: cut.minZ });
  if (cut.maxZ < r.maxZ) out.push({ ...r, minZ: cut.maxZ });
  const z0 = Math.max(r.minZ, cut.minZ);
  const z1 = Math.min(r.maxZ, cut.maxZ);
  if (cut.minX > r.minX) out.push({ minX: r.minX, maxX: cut.minX, minZ: z0, maxZ: z1 });
  if (cut.maxX < r.maxX) out.push({ minX: cut.maxX, maxX: r.maxX, minZ: z0, maxZ: z1 });
  return out;
}

/** Fewest rectangles covering the set cells of a BLOCK x BLOCK mask (greedy largest-first; exact for BLOCK = 2). */
function blockRects(mask) {
  const left = mask.map((row) => row.slice());
  const rects = [];
  for (;;) {
    let best = null;
    for (let j0 = 0; j0 < BLOCK; j0++) {
      for (let i0 = 0; i0 < BLOCK; i0++) {
        for (let j1 = j0; j1 < BLOCK; j1++) {
          for (let i1 = i0; i1 < BLOCK; i1++) {
            let full = true;
            for (let j = j0; j <= j1 && full; j++) for (let i = i0; i <= i1 && full; i++) full = left[j][i];
            const n = (j1 - j0 + 1) * (i1 - i0 + 1);
            if (full && (!best || n > best.n)) best = { i0, j0, i1, j1, n };
          }
        }
      }
    }
    if (!best) return rects;
    for (let j = best.j0; j <= best.j1; j++) for (let i = best.i0; i <= best.i1; i++) left[j][i] = false;
    rects.push(best);
  }
}

function plan() {
  const spots = readLandingSpots();
  const galata = galataRect();
  const ox = galata.minX;
  const oz = galata.minZ;
  const cellRect = (i, j) => ({ minX: ox + i * CELL, maxX: ox + (i + 1) * CELL, minZ: oz + j * CELL, maxZ: oz + (j + 1) * CELL });
  const covered = new Set();
  for (const s of spots) {
    const r = Math.ceil(SURROUND / CELL) + 1;
    const ci = Math.floor((s.x - ox) / CELL);
    const cj = Math.floor((s.z - oz) / CELL);
    for (let j = cj - r; j <= cj + r; j++) {
      for (let i = ci - r; i <= ci + r; i++) {
        if (rectDist(cellRect(i, j), s.x, s.z) <= SURROUND) covered.add(`${i},${j}`);
      }
    }
  }
  const blocks = new Map();
  for (const key of covered) {
    const [i, j] = key.split(',').map(Number);
    const bi = Math.floor(i / BLOCK);
    const bj = Math.floor(j / BLOCK);
    const bk = `${bi},${bj}`;
    if (!blocks.has(bk)) blocks.set(bk, { bi, bj, mask: Array.from({ length: BLOCK }, () => new Array(BLOCK).fill(false)) });
    blocks.get(bk).mask[j - bj * BLOCK][i - bi * BLOCK] = true;
  }
  const regions = [];
  for (const { bi, bj, mask } of [...blocks.values()].sort((a, b) => a.bj - b.bj || a.bi - b.bi)) {
    for (const b of blockRects(mask)) {
      const rect = {
        minX: ox + (bi * BLOCK + b.i0) * CELL,
        maxX: ox + (bi * BLOCK + b.i1 + 1) * CELL,
        minZ: oz + (bj * BLOCK + b.j0) * CELL,
        maxZ: oz + (bj * BLOCK + b.j1 + 1) * CELL,
      };
      for (const piece of subtract(rect, galata)) {
        if (piece.maxX - piece.minX >= MIN_SIDE && piece.maxZ - piece.minZ >= MIN_SIDE) regions.push(piece);
      }
    }
  }
  // Name each region after the nearest landing spot (suffixes when several regions share one).
  const used = new Map();
  const named = regions.map((area) => {
    const cx = (area.minX + area.maxX) / 2;
    const cz = (area.minZ + area.maxZ) / 2;
    let best = spots[0];
    for (const s of spots) if (Math.hypot(s.x - cx, s.z - cz) < Math.hypot(best.x - cx, best.z - cz)) best = s;
    const n = (used.get(best.id) ?? 0) + 1;
    used.set(best.id, n);
    return { id: n === 1 ? best.id : `${best.id}-${n}`, spot: best.id, area };
  });
  const out = {
    $comment:
      'Flight-scale OSM regions, generated by scripts/data/osm-regions.mjs (plan / fetch / index); do not edit by hand. area: local metres (+X east, +Z south) the region owns; bbox: the same in degrees (fetched with a margin); file: data under public/, bytes / gzipBytes / buildings filled by `index`.',
    cell: CELL,
    surround: SURROUND,
    galata: { rect: galata },
    regions: named.map((r) => ({ id: r.id, spot: r.spot, area: r.area, bbox: toBbox(r.area), file: `data/osm/regions/${r.id}.json` })),
  };
  writeFileSync(MANIFEST, JSON.stringify(out, null, 1) + '\n');
  const km2 = named.reduce((s, r) => s + ((r.area.maxX - r.area.minX) * (r.area.maxZ - r.area.minZ)) / 1e6, 0);
  console.log(JSON.stringify({ ok: true, manifest: MANIFEST, regions: named.length, km2: +km2.toFixed(1), galata, ids: named.map((r) => r.id) }, null, 1));
}

function readManifest() {
  return JSON.parse(readFileSync(MANIFEST, 'utf8'));
}

async function fetchAll() {
  const m = readManifest();
  const only = argOf('--only')?.split(',');
  const force = args.includes('--force');
  for (const r of m.regions) {
    if (only && !only.includes(r.id)) continue;
    const file = resolve(ROOT, 'public', r.file);
    if (existsSync(file) && !force) {
      console.error(`[osm-regions] ${r.id}: have ${r.file}`);
      continue;
    }
    console.error(`[osm-regions] ${r.id}: fetching`);
    // OSM_CACHE_DIR keeps the raw Overpass answers, so re-runs (e.g. after a converter change) need no network.
    const cache = process.env.OSM_CACHE_DIR ? ['--cache', resolve(process.env.OSM_CACHE_DIR, `overpass-${r.id}.json`)] : [];
    const res = spawnSync(process.execPath, [resolve(ROOT, 'scripts/data/fetch-osm.mjs'), '--region', r.id, ...cache], { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' });
    if (res.status !== 0) {
      console.error(`[osm-regions] ${r.id}: fetch failed (exit ${res.status}), continuing`);
    } else {
      const summary = JSON.parse(res.stdout);
      console.error(`[osm-regions] ${r.id}: ${summary.buildings} buildings, ${summary.roads} roads, ${(summary.bytes / 1e6).toFixed(2)} MB`);
    }
    // Be polite to the public Overpass servers: one region at a time, with a pause.
    await new Promise((ok) => setTimeout(ok, 10_000));
  }
}

function index() {
  const m = readManifest();
  const kept = [];
  let raw = 0;
  let gz = 0;
  for (const r of m.regions) {
    const file = resolve(ROOT, 'public', r.file);
    if (!existsSync(file)) {
      console.error(`[osm-regions] ${r.id}: no data yet, kept without sizes`);
      kept.push(r);
      continue;
    }
    const text = readFileSync(file, 'utf8');
    const d = JSON.parse(text);
    const buildings = d.buildings.filter((b) => !b.part).length;
    if (buildings < MIN_CONTENT.buildings && d.roads.length < MIN_CONTENT.roads) {
      console.error(`[osm-regions] ${r.id}: ${buildings} buildings, ${d.roads.length} roads: dropped`);
      continue;
    }
    const g = gzipSync(text, { level: 9 }).length;
    raw += text.length;
    gz += g;
    kept.push({ ...r, bytes: text.length, gzipBytes: g, buildings });
  }
  m.regions = kept;
  writeFileSync(MANIFEST, JSON.stringify(m, null, 1) + '\n');
  console.log(JSON.stringify({ ok: true, regions: kept.length, rawMB: +(raw / 1e6).toFixed(2), gzipMB: +(gz / 1e6).toFixed(2) }, null, 1));
}

if (cmd === 'plan') plan();
else if (cmd === 'fetch') await fetchAll();
else if (cmd === 'index') index();
else {
  console.error('usage: node scripts/data/osm-regions.mjs plan | fetch [--only a,b] [--force] | index');
  process.exit(1);
}
