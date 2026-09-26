/**
 * One map at every distance, headless (no browser, no GPU). Up close the compiled street tiles (tools/world-compiler,
 * data/osm/<area>.json) replace the flight-scale OSM layer (src/world/osm, public/data/osm/**), and far out the
 * flight-scale layer is what the player sees. Both must show the same buildings and parks; only the detail may differ.
 *
 *   npm run check:map                    # every street area; exits 1 when a check fails
 *   npm run check:map -- --area balat    # one area
 *   npm run check:map -- --verbose       # list every mismatch
 *
 * 1. Street areas: src/world/osm/street-areas.ts (runtime) gives the same tile rects as the compiler
 *    (tools/world-compiler/lib/areas.mjs + the cli.ts tile grid).
 * 2. Coverage: every street area lies inside the flight-scale OSM regions (osm/regions.ts), whose data exists. Outside
 *    them the far city is procedural and cannot match the street tiles.
 * 3. Data: the street data and the region data describe the same buildings and green areas inside every street area
 *    (same OSM ids, centroids within DATA_SHIFT m). They come from different fetches (scripts/data/fetch-osm.mjs
 *    --area vs --region), so snapshot drift is reported, and fails beyond DATA_DRIFT_MAX.
 * 4. Buildings: the real flight-scale building pipeline (buildings/infill.ts findInfill + build.ts buildBuildings, run
 *    over each region like the game's worker does) against the compiler's rule (buildings.ts makeSolids + district.ts
 *    landmarkOf with the game's landmark claims, as compiled with `--landmarks none`). Every building the tiles draw up
 *    close is drawn from the air as well, and the other way round. Canopies (building=roof/carport) are near-only
 *    detail. The tiles' landmarks draw nothing, so the game's model or the flight-scale twin shows through them.
 * 5. Invented content: no neighbourhood mosque site (a procedural mosque whose pad removes OSM buildings) reaches into
 *    an OSM region, and no infill parcel (a building OSM does not have) reaches into a street area.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { WorldBounds } from '../../src/core/contracts';
import { latLonToLocal } from '../../src/core/geo-coords';
import { buildLandmarkDefs } from '../../src/world/geo/prepare';
import { buildBuildings } from '../../src/world/osm/buildings/build';
import { findInfill } from '../../src/world/osm/buildings/infill';
import { landmarkClaims } from '../../src/world/landmarks/claims';
import { CANOPY_KINDS, ringCentroid } from '../../src/world/osm/buildings/selection';
import type { OsmArea, OsmBuilding, OsmData } from '../../src/world/osm/data';
import { osmRegions, type OsmRegionDef } from '../../src/world/osm/regions';
import { cutGeoWindows, reservedPads } from '../../src/world/osm/shared/foundation';
import { groundRect } from '../../src/world/osm/shared/ground';
import type { OsmWorkerBase } from '../../src/world/osm/shared/protocol';
import { buildStreetRaster, streetRasterInput } from '../../src/world/osm/shared/street-field';
import { StreetSurface } from '../../src/world/osm/shared/street-surface';
import { STREET_TILE_SIZE, streetAreaRects } from '../../src/world/osm/street-areas';
import { makeSolids } from '../world-compiler/src/buildings';
import { landmarkOf, setLandmarkClaims, useDistrict } from '../world-compiler/src/district';
import { readAreas, ROOT } from '../world-compiler/lib/areas.mjs';
import { buildHeadlessGeo } from './geo';

const args = process.argv.slice(2);
const ONLY = args.includes('--area') ? args[args.indexOf('--area') + 1] : null;
const VERBOSE = args.includes('--verbose');

/** Largest centroid shift (m) of one feature between the street data and the region data. */
const DATA_SHIFT = 2;
/** Largest share of an area's features that may differ between the two fetches (snapshot drift). */
const DATA_DRIFT_MAX = 0.01;
/** Green area kinds (drawn by the street tiles' cover and the flight layer's ground cover alike). */
const GREEN = /^(leisure=(park|garden|playground|pitch|common|dog_park)|landuse=(grass|forest|cemetery|meadow|recreation_ground|village_green|orchard|allotments)|natural=(wood|scrub|grassland|heath))$/;

const failures: string[] = [];
function check(ok: boolean, label: string, details: string[] = []): void {
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}`);
  if (!ok) {
    failures.push(label);
  }
  if (details.length && (!ok || VERBOSE)) {
    for (const d of details.slice(0, VERBOSE ? Infinity : 8)) {
      console.log(`         ${d}`);
    }
    if (!VERBOSE && details.length > 8) {
      console.log(`         ... ${details.length - 8} more (--verbose)`);
    }
  }
}

const inRect = (r: WorldBounds, x: number, z: number): boolean => x >= r.minX && x < r.maxX && z >= r.minZ && z < r.maxZ;
const overlaps = (a: WorldBounds, b: WorldBounds): boolean => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
const key = (r: WorldBounds): string => `${r.minX},${r.minZ},${r.maxX},${r.maxZ}`;
const readJson = <T>(file: string): T => JSON.parse(readFileSync(file, 'utf8')) as T;

/** Buildings the city walls draw (baked walls index): both the tiles and the flight layer leave them out. */
const wallsFile = resolve(ROOT, 'public/world/walls/index.json');
const wallOwned = new Set<number>(existsSync(wallsFile) ? (readJson<{ owned?: number[] }>(wallsFile).owned ?? []) : []);

// ---------------------------------------------------------------------------------------------------------------
console.log('1. Street areas: runtime rects = compiler rects');
const compilerAreas = readAreas()
  .filter((a) => a.profile === 'street')
  .map((a) => {
    // tools/world-compiler/src/cli.ts: every TILE_SIZE square that touches the area.
    const sw = latLonToLocal(a.bbox.south, a.bbox.west);
    const ne = latLonToLocal(a.bbox.north, a.bbox.east);
    const T = STREET_TILE_SIZE;
    const i0 = Math.floor(sw.x / T);
    const i1 = Math.floor((ne.x - 1e-6) / T);
    const j0 = Math.floor(ne.z / T);
    const j1 = Math.floor((sw.z - 1e-6) / T);
    return { id: a.id, dataFile: a.dataFile, rect: { minX: i0 * T, maxX: (i1 + 1) * T, minZ: j0 * T, maxZ: (j1 + 1) * T } };
  });
{
  const runtime = new Map(streetAreaRects().map((a) => [a.id, a.rect]));
  const bad = compilerAreas.filter((a) => !runtime.has(a.id) || key(runtime.get(a.id)!) !== key(a.rect)).map((a) => `${a.id}: compiler ${key(a.rect)}, runtime ${runtime.has(a.id) ? key(runtime.get(a.id)!) : 'missing'}`);
  for (const id of runtime.keys()) {
    if (!compilerAreas.some((a) => a.id === id)) {
      bad.push(`${id}: runtime only`);
    }
  }
  check(bad.length === 0, `${compilerAreas.length} street areas, same tile rects`, bad);
}
const areas = compilerAreas.filter((a) => (!ONLY || a.id === ONLY) && existsSync(resolve(ROOT, a.dataFile)));
if (ONLY && !areas.length) {
  throw new Error(`no street area '${ONLY}' with data`);
}

// ---------------------------------------------------------------------------------------------------------------
console.log('2. Coverage: street areas lie inside the flight-scale OSM regions');
const geo = buildHeadlessGeo();
const regions = osmRegions();
const regionFile = (r: OsmRegionDef): string => resolve(ROOT, 'public', r.url.replace(/^\//, ''));
const streetData = new Map(areas.map((a) => [a.id, readJson<OsmData>(resolve(ROOT, a.dataFile))]));
{
  const covered = (x: number, z: number): boolean => regions.some((r) => inRect(r.rect, x, z) && existsSync(regionFile(r)));
  const bad: string[] = [];
  const STEP = 10;
  for (const a of areas) {
    // Land (open sea needs no region) and every mapped building.
    let uncovered = 0;
    for (let z = a.rect.minZ + STEP / 2; z < a.rect.maxZ; z += STEP) {
      for (let x = a.rect.minX + STEP / 2; x < a.rect.maxX; x += STEP) {
        if (!geo.isWater(x, z) && !covered(x, z)) {
          uncovered++;
        }
      }
    }
    const orphans = streetData.get(a.id)!.buildings.filter((b) => {
      const c = ringCentroid(b.ring);
      return inRect(a.rect, c.x, c.z) && !covered(c.x, c.z);
    }).length;
    if (uncovered || orphans) {
      bad.push(`${a.id}: ${uncovered * STEP * STEP} m² of land and ${orphans} buildings outside every region with data`);
    }
  }
  check(bad.length === 0, `${areas.length} street areas covered by regions with data`, bad);
}

// ---------------------------------------------------------------------------------------------------------------
const regionData = new Map<string, OsmData>();
const dataOf = (r: OsmRegionDef): OsmData => {
  let d = regionData.get(r.id);
  if (!d) {
    d = readJson<OsmData>(regionFile(r));
    regionData.set(r.id, d);
  }
  return d;
};
/** The region that draws a feature: the one whose build rect holds its centroid (rects never overlap). */
const ownerOf = (x: number, z: number): OsmRegionDef | null => regions.find((r) => inRect(r.rect, x, z)) ?? null;

console.log('3. Data: street data and region data describe the same map');
{
  interface Feature {
    id: number;
    ring: number[];
  }
  const compare = (label: string, pick: (d: OsmData) => Feature[]): void => {
    const bad: string[] = [];
    const lines: string[] = [];
    for (const a of areas) {
      const near = pick(streetData.get(a.id)!).filter((f) => {
        const c = ringCentroid(f.ring);
        return inRect(a.rect, c.x, c.z);
      });
      let drift = 0;
      const seen = new Set<number>();
      for (const f of near) {
        const c = ringCentroid(f.ring);
        const owner = ownerOf(c.x, c.z);
        if (!owner) {
          continue;
        }
        seen.add(f.id);
        const twin = pick(dataOf(owner)).find((g) => g.id === f.id);
        if (!twin) {
          drift++;
          lines.push(`${a.id}: ${label} ${f.id} only in the street data`);
          continue;
        }
        const t = ringCentroid(twin.ring);
        const d = Math.hypot(t.x - c.x, t.z - c.z);
        if (d > DATA_SHIFT) {
          drift++;
          lines.push(`${a.id}: ${label} ${f.id} moved ${d.toFixed(1)} m`);
        }
      }
      // Features the regions have inside the area that the street data lacks.
      for (const r of regions.filter((q) => overlaps(q.rect, a.rect) && existsSync(regionFile(q)))) {
        for (const g of pick(dataOf(r))) {
          const c = ringCentroid(g.ring);
          if (inRect(a.rect, c.x, c.z) && inRect(r.rect, c.x, c.z) && !seen.has(g.id)) {
            drift++;
            lines.push(`${a.id}: ${label} ${g.id} only in the region data (${r.id})`);
          }
        }
      }
      const share = near.length ? drift / near.length : 0;
      if (share > DATA_DRIFT_MAX) {
        bad.push(`${a.id}: ${drift} of ${near.length} ${label}s differ (${(share * 100).toFixed(1)} %)`);
      }
    }
    check(bad.length === 0, `${label}s: same ids and places (drift <= ${DATA_DRIFT_MAX * 100} % per area; ${lines.length} differences in all)`, [...bad, ...lines]);
  };
  compare('building', (d) => d.buildings.filter((b) => !wallOwned.has(b.id)));
  compare('green area', (d) => d.areas.filter((x: OsmArea) => GREEN.test(x.kind)));
}

// ---------------------------------------------------------------------------------------------------------------
console.log('4. Buildings: the flight layer draws what the street tiles draw');
/** The claims as the compiler builds them (cli.ts) and as the buildings layer builds them (buildings/index.ts). */
const compilerClaims = landmarkClaims({ landmarks: buildLandmarkDefs(), smallMosqueSites: [] });
const layerClaims = landmarkClaims(geo);
const keepOut = streetAreaRects().map((a) => a.rect);

interface FlightBuild {
  drawn: Set<number>;
  parcels: OsmBuilding[];
}
const flightBuilds = new Map<string, FlightBuild>();
/** Runs the flight-scale buildings worker (buildings.worker.ts) for one region, synchronously. */
function flightBuild(r: OsmRegionDef): FlightBuild {
  const cached = flightBuilds.get(r.id);
  if (cached) {
    return cached;
  }
  const data = dataOf(r);
  // osm/index.ts + shared/foundation.ts buildWorkerBase, without the workers.
  const rect = groundRect(r.rect);
  const base: OsmWorkerBase = {
    rect,
    area: r.area,
    ...cutGeoWindows(geo, rect),
    reserved: reservedPads(geo),
    street: buildStreetRaster(streetRasterInput(data, (x, z) => geo.coastDistance(x, z)), rect),
  };
  const surface = new StreetSurface(base);
  const buildings = data.buildings.filter((b) => !wallOwned.has(b.id));
  const infill = findInfill(buildings, { roads: data.roads, areas: data.areas, rails: data.rails, keepOut }, layerClaims, surface, base.area);
  const out = buildBuildings({ buildings, pois: new Float32Array(), claims: layerClaims, extra: infill.parcels }, surface, base.rect);
  const res = { drawn: new Set(Array.from(out.drawnIds)), parcels: infill.parcels };
  flightBuilds.set(r.id, res);
  return res;
}

const flatHeights = { at: () => 0, carriage: () => 0, off: () => 0 };
{
  const bad: string[] = [];
  const lines: string[] = [];
  let compared = 0;
  // Buildings only one of the two fetches has (section 3) are data drift, not a rule difference.
  let drift = 0;
  setLandmarkClaims(compilerClaims);
  for (const a of areas) {
    useDistrict(a.id);
    const data = streetData.get(a.id)!;
    const buildings = data.buildings.filter((b) => !wallOwned.has(b.id));
    const byId = new Map(buildings.map((b) => [b.id, b]));
    // The compiler's rule: makeSolids (outlines with parts and non-solid kinds go), landmarks draw no geometry.
    const near = new Map<number, 'drawn' | 'canopy' | 'landmark'>();
    for (const s of makeSolids(buildings, flatHeights)) {
      if (!inRect(a.rect, s.cx, s.cz)) {
        continue;
      }
      const b = byId.get(s.rec.osmId)!;
      near.set(s.rec.osmId, landmarkOf(b) ? 'landmark' : CANOPY_KINDS.has(b.kind) ? 'canopy' : 'drawn');
    }
    let mismatch = 0;
    for (const b of buildings) {
      const c = ringCentroid(b.ring);
      if (!inRect(a.rect, c.x, c.z)) {
        continue;
      }
      const owner = ownerOf(c.x, c.z);
      if (!owner || !existsSync(regionFile(owner))) {
        continue;
      }
      if (!dataOf(owner).buildings.some((x) => x.id === b.id)) {
        drift++;
        continue;
      }
      compared++;
      const far = flightBuild(owner).drawn.has(b.id);
      const n = near.get(b.id);
      const label = `${a.id}: ${b.id} (${b.kind}${b.part ? ' part' : ''}${b.name ? ` "${b.name}"` : ''})`;
      if (n === 'drawn' && !far) {
        mismatch++;
        lines.push(`${label} drawn up close, missing from the air`);
      } else if (far && n === undefined) {
        mismatch++;
        lines.push(`${label} drawn from the air, missing up close`);
      }
    }
    if (mismatch) {
      bad.push(`${a.id}: ${mismatch} buildings differ`);
    }
  }
  setLandmarkClaims(null);
  check(bad.length === 0, `${compared} buildings in ${areas.length} street areas: same set up close and from the air (${drift} not in both fetches, see 3)`, [...bad, ...lines]);
}

// ---------------------------------------------------------------------------------------------------------------
console.log('5. Invented content stays out of the real map');
{
  const bad: string[] = [];
  for (const m of geo.smallMosqueSites) {
    for (const r of regions) {
      const dx = Math.max(r.rect.minX - m.x, 0, m.x - r.rect.maxX);
      const dz = Math.max(r.rect.minZ - m.z, 0, m.z - r.rect.maxZ);
      if (dx * dx + dz * dz < m.radius * m.radius) {
        bad.push(`mosque site at ${m.x.toFixed(0)}, ${m.z.toFixed(0)} (r ${m.radius.toFixed(0)} m) reaches into region ${r.id}`);
      }
    }
  }
  check(bad.length === 0, `${geo.smallMosqueSites.length} neighbourhood mosque sites, none in the ${regions.length} OSM regions`, bad);
}
{
  const bad: string[] = [];
  let parcels = 0;
  for (const [id, fb] of flightBuilds) {
    parcels += fb.parcels.length;
    for (const p of fb.parcels) {
      const box = { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity };
      for (let k = 0; k < p.ring.length; k += 2) {
        box.minX = Math.min(box.minX, p.ring[k]);
        box.maxX = Math.max(box.maxX, p.ring[k]);
        box.minZ = Math.min(box.minZ, p.ring[k + 1]);
        box.maxZ = Math.max(box.maxZ, p.ring[k + 1]);
      }
      const hit = streetAreaRects().find((a) => overlaps(a.rect, box));
      if (hit) {
        const depth = Math.min(box.maxX - hit.rect.minX, hit.rect.maxX - box.minX, box.maxZ - hit.rect.minZ, hit.rect.maxZ - box.minZ);
        bad.push(`region ${id}: infill parcel at ${box.minX.toFixed(0)}, ${box.minZ.toFixed(0)} reaches ${depth.toFixed(2)} m into street area ${hit.id}`);
      }
    }
  }
  check(bad.length === 0, `${parcels} infill parcels in ${flightBuilds.size} regions, none in a street area`, bad);
}

console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nall checks passed');
process.exit(failures.length ? 1 : 0);
