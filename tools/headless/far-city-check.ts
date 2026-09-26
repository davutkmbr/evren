/**
 * Far OSM layer (phase 24, S2), headless: the city workers' tile builder (city/worker/tile.ts) run in Node on the real
 * geography, once procedural only and once with the far OSM bake (public/data/osm/city), over the tiles the streamer
 * would draw around a few views at the "high" preset (LOD split distances of city-system.ts lodParams).
 *
 *   npx tsx tools/headless/far-city-check.ts [--preset low|medium|high|ultra] [--view galata]
 *
 * Checks: every tile builds in both modes; a view inside the OSM coverage draws real buildings; the data mode's
 * triangle total stays within BUDGET of the procedural city's (the GPU cost of the far city); worker time per tile.
 * It also prints the counts per view and level for tuning. It cannot measure frame times (no GPU): use
 * `node scripts/snap.mjs --perf` on the reference machine for those.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { latLonToLocal } from '../../src/core/geo-coords';
import { QUALITY_PRESETS } from '../../src/core/quality';
import { buildInitMessage, buildOccupancy, GeoWindowCutter } from '../../src/world/city/geo-window';
import { type CityBakeIndex, type DecodedBuildings, decodeBuildings } from '../../src/world/city/osm/format';
import { isOsmCell, osmBuiltMask } from '../../src/world/city/osm/mask';
import { BASE_CELL, LEVEL_SIZES, type TileRequestMsg } from '../../src/world/city/protocol';
import { blockKeyOf } from '../../src/world/city/worker/osm-blocks';
import { buildColliders, buildTile } from '../../src/world/city/worker/tile';
import { WorldData } from '../../src/world/city/worker/world-data';
import { ROOT } from '../world-compiler/lib/areas.mjs';
import { buildHeadlessGeo } from './geo';

const args = process.argv.slice(2);
const PRESET = (args.includes('--preset') ? args[args.indexOf('--preset') + 1] : 'high') as keyof typeof QUALITY_PRESETS;
const ONLY = args.includes('--view') ? args[args.indexOf('--view') + 1] : null;
/** Largest data-mode / procedural triangle ratio over all views before the check fails. */
const BUDGET = 1.25;
const WORLD_HALF = 24000;
const WINDOW_MARGIN = 130;

const VIEWS: [string, number, number][] = [
  ['galata', 41.0256, 28.9741],
  ['kadikoy', 40.9905, 29.0253],
  ['uskudar', 41.0262, 29.015],
  ['levent', 41.0808, 29.0106],
  ['fatih', 41.0186, 28.9397],
  ['atasehir', 40.9923, 29.1244],
  ['bakirkoy', 40.9807, 28.8724],
];

const failures: string[] = [];
function check(ok: boolean, label: string, details: string[] = []): void {
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}`);
  if (!ok) {
    failures.push(label);
    for (const d of details.slice(0, 10)) {
      console.log(`         ${d}`);
    }
  }
}

const geo = buildHeadlessGeo();
const bakeDir = resolve(ROOT, 'public/data/osm/city');
const index = JSON.parse(readFileSync(resolve(bakeDir, 'index.json'), 'utf8')) as CityBakeIndex;
const blocks = index.files.map((f) => `${f.block[0]}_${f.block[1]}`);
const procWorld = new WorldData(buildInitMessage(geo, null));
const osmWorld = new WorldData(buildInitMessage(geo, { base: '', blocks }));
const cutter = new GeoWindowCutter(geo, []);
const decoded = new Map<string, DecodedBuildings | null>();
const blockOf = (x0: number, z0: number): DecodedBuildings | null => {
  const key = blockKeyOf(x0 + 1, z0 + 1);
  if (!decoded.has(key)) {
    decoded.set(key, blocks.includes(key) ? decodeBuildings(new Uint8Array(gunzipSync(readFileSync(resolve(bakeDir, `blocks/${key}.bin.gz`))))) : null);
  }
  return decoded.get(key)!;
};

// Tile selection of the streamer (streamer.ts), simplified: level by the camera distance to the tile, occupied only.
const q = QUALITY_PRESETS[PRESET];
const scale = PRESET === 'low' ? 0.7 : PRESET === 'medium' ? 0.85 : PRESET === 'ultra' ? 1.25 : 1;
const split0 = 800 * scale;
const split1 = Math.min(q.cityDrawDistance * 0.4, 3000 * scale);
const baseN = (WORLD_HALF * 2) / BASE_CELL;
const occProc = buildOccupancy(geo, BASE_CELL);
const occOsm = occProc.slice();
const built = osmBuiltMask();
for (let k = 0; k < occOsm.length; k++) {
  occOsm[k] |= built[k];
}
function occupied(occ: Uint8Array, x0: number, z0: number, size: number): boolean {
  const span = size / BASE_CELL;
  const i0 = Math.round((x0 + WORLD_HALF) / BASE_CELL);
  const j0 = Math.round((z0 + WORLD_HALF) / BASE_CELL);
  for (let j = j0; j < j0 + span; j++) {
    for (let i = i0; i < i0 + span; i++) {
      if (occ[j * baseN + i]) {
        return true;
      }
    }
  }
  return false;
}
function tilesAround(cx: number, cz: number): { level: number; ix: number; iz: number; x0: number; z0: number; size: number }[] {
  const out: { level: number; ix: number; iz: number; x0: number; z0: number; size: number }[] = [];
  const s2 = LEVEL_SIZES[2];
  const draw = q.cityDrawDistance;
  const visit = (level: number, ix: number, iz: number): void => {
    const size = LEVEL_SIZES[level];
    const x0 = -WORLD_HALF + ix * size;
    const z0 = -WORLD_HALF + iz * size;
    const dx = Math.max(x0 - cx, 0, cx - (x0 + size));
    const dz = Math.max(z0 - cz, 0, cz - (z0 + size));
    const d = Math.hypot(dx, dz);
    if (d > draw) {
      return;
    }
    if (level > 0 && d < (level === 2 ? split1 : split0)) {
      for (let j = 0; j < 2; j++) {
        for (let i = 0; i < 2; i++) {
          visit(level - 1, ix * 2 + i, iz * 2 + j);
        }
      }
      return;
    }
    out.push({ level, ix, iz, x0, z0, size });
  };
  const n2 = (WORLD_HALF * 2) / s2;
  for (let iz = 0; iz < n2; iz++) {
    for (let ix = 0; ix < n2; ix++) {
      visit(2, ix, iz);
    }
  }
  return out;
}

console.log(`Far OSM layer: tiles around ${ONLY ?? `${VIEWS.length} views`} at "${PRESET}" (draw ${q.cityDrawDistance} m)`);
let triProc = 0;
let triOsm = 0;
let worst = { ms: 0, what: '' };
const bad: string[] = [];
let id = 1;
for (const [name, lat, lon] of VIEWS.filter((v) => !ONLY || v[0] === ONLY)) {
  const c = latLonToLocal(lat, lon);
  const per = [0, 1, 2].map(() => ({ tiles: 0, bProc: 0, bOsm: 0, tProc: 0, tOsm: 0 }));
  for (const t of tilesAround(c.x, c.z)) {
    const win = cutter.cut(t.x0 - WINDOW_MARGIN, t.z0 - WINDOW_MARGIN, t.x0 + t.size + WINDOW_MARGIN, t.z0 + t.size + WINDOW_MARGIN);
    const req: TileRequestMsg = { type: 'tile', id: id++, level: t.level, ix: t.ix, iz: t.iz, densityScale: q.cityDensityScale, win, exclude: [] };
    const p = per[t.level];
    try {
      if (occupied(occProc, t.x0, t.z0, t.size)) {
        const a = buildTile(req, procWorld, null);
        p.bProc += a.buildings;
        p.tProc += (a.mesh?.index.length ?? 0) / 3;
      }
      if (occupied(occOsm, t.x0, t.z0, t.size)) {
        const b = buildTile(req, osmWorld, blockOf(t.x0, t.z0));
        p.bOsm += b.buildings;
        p.tOsm += (b.mesh?.index.length ?? 0) / 3;
        if (b.ms > worst.ms) {
          worst = { ms: b.ms, what: `${name} L${t.level} ${t.ix}_${t.iz}` };
        }
      }
      p.tiles++;
    } catch (err) {
      bad.push(`${name} L${t.level} ${t.ix}_${t.iz}: ${(err as Error).message}`);
    }
  }
  const tp = per.reduce((s, p) => s + p.tProc, 0);
  const to = per.reduce((s, p) => s + p.tOsm, 0);
  triProc += tp;
  triOsm += to;
  console.log(`  ${name.padEnd(9)} ${isOsmCell(c.x, c.z) ? 'OSM ' : 'proc'}  ${per.map((p, l) => `L${l} ${p.tiles} tiles ${p.bProc}→${p.bOsm} bldg ${(p.tProc / 1e3).toFixed(0)}k→${(p.tOsm / 1e3).toFixed(0)}k tri`).join(' | ')}  total ${(tp / 1e6).toFixed(2)}M→${(to / 1e6).toFixed(2)}M`);
  if (isOsmCell(c.x, c.z) && per[0].bOsm === 0) {
    bad.push(`${name}: inside the OSM coverage but no baked building near the camera`);
  }
}
check(bad.length === 0, 'every tile builds in both modes; OSM views draw real buildings', bad);
check(triOsm <= triProc * BUDGET, `triangles: ${(triOsm / 1e6).toFixed(2)} M with the far OSM layer vs ${(triProc / 1e6).toFixed(2)} M procedural (budget x${BUDGET})`);
console.log(`  slowest data-mode tile: ${worst.ms.toFixed(1)} ms (${worst.what})`);
{
  const c = latLonToLocal(41.0256, 28.9741);
  const x0 = -WORLD_HALF + Math.floor((c.x + WORLD_HALF) / 500) * 500;
  const z0 = -WORLD_HALF + Math.floor((c.z + WORLD_HALF) / 500) * 500;
  const win = cutter.cut(x0 - WINDOW_MARGIN, z0 - WINDOW_MARGIN, x0 + 500 + WINDOW_MARGIN, z0 + 500 + WINDOW_MARGIN);
  const res = buildColliders({ type: 'colliders', id: id++, ix: Math.round((x0 + WORLD_HALF) / 500), iz: Math.round((z0 + WORLD_HALF) / 500), size: 500, densityScale: 1, win, exclude: [] }, osmWorld, blockOf(x0, z0));
  check(res.boxes.length > 0 && res.boxes.every(Number.isFinite), `colliders: ${res.boxes.length / 7} boxes in the Galata tile, all finite`);
}
console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nall checks passed');
process.exit(failures.length ? 1 : 0);
