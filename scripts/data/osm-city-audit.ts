/**
 * Phase 24 stage S0 (.docs/planning/24-far-osm-layer.md): how well OSM maps the buildings and land use of the playable
 * square, per 250 m cell (the procedural city's layout cell), and how big a whole-city bake would be.
 *
 *   node scripts/data/osm-extract.mjs all          # once: the local extract index (data/osm-src/, gitignored)
 *   npx tsx scripts/data/osm-city-audit.ts         # -> .docs/research/osm-city-coverage.{json,png}
 *
 * Per cell:
 * - OSM building outlines by centroid: count, footprint area, vertices after the fetch's simplification (0.35 m,
 *   min 12 m²), how many carry height / building:levels;
 * - the geo land use the procedural city builds on (Urban, HistoricUrban, Highrise, Industrial, Suburban: the
 *   city/geo-window.ts buildable mask), as a fraction of the cell;
 * - OSM land-use / leisure / natural polygons by class (area by centroid).
 * Coverage = OSM footprint area / buildable geo area. The flight-scale regions (osm/regions.ts), where the map is known
 * to be good, give the reference distribution. The PNG shows coverage per cell (see the legend in the JSON).
 *
 * Data © OpenStreetMap contributors, ODbL 1.0.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { latLonToLocal, localToLatLon, WORLD_HALF_SIZE } from '../../src/core/geo-coords';
import { osmRegions } from '../../src/world/osm/regions';
import { buildHeadlessGeo } from '../../tools/headless/geo';
import { ROOT } from '../../tools/world-compiler/lib/areas.mjs';
import { INDEX_FILE, openIndex, runQL } from './lib/osm-local.mjs';

const CELL = 250;
const N = (WORLD_HALF_SIZE * 2) / CELL;
const BLOCK = 2000;
/** Geo land use the procedural city builds on (city/geo-window.ts). */
const BUILDABLE = new Set([2, 3, 4, 5, 13]);
/** Bytes per baked building (attributes) and per ring vertex (Int16 x, z). */
const BUILDING_BYTES = 12;
const VERTEX_BYTES = 4;

type LL = { lat: number; lon: number };
type Pt = [number, number];

const LAND_CLASSES: [string, RegExp][] = [
  ['park', /^(leisure=(park|garden|playground|dog_park|common|recreation_ground)|landuse=(recreation_ground|village_green))$/],
  ['grass', /^(landuse=(grass|meadow)|natural=(grassland|heath))$/],
  ['forest', /^(landuse=forest|natural=(wood|scrub))$/],
  ['cemetery', /^(landuse=cemetery|amenity=grave_yard)$/],
  ['farm', /^landuse=(farmland|orchard|vineyard|allotments|farmyard|greenhouse_horticulture)$/],
  ['water', /^(natural=water|landuse=(reservoir|basin))$/],
  ['industrial', /^landuse=(industrial|port|railway|quarry|landfill|construction|brownfield)$/],
  ['residential', /^landuse=(residential|commercial|retail)$/],
  ['pitch', /^leisure=(pitch|sports_centre|stadium|track|golf_course)$/],
];

function project(g: LL): Pt {
  const p = latLonToLocal(g.lat, g.lon);
  return [p.x, p.z];
}

function perpDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz;
  if (l2 < 1e-9) {
    return Math.hypot(p[0] - a[0], p[1] - a[1]);
  }
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
}

/** Douglas-Peucker vertex count of a closed ring (fetch-osm.mjs simplify). */
function simplifiedCount(pts: Pt[], tol: number): number {
  if (pts.length < 4) {
    return pts.length;
  }
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop()!;
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
  let n = 0;
  for (const k of keep) {
    n += k;
  }
  return Math.max(3, n - 1);
}

function area(pts: Pt[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a / 2);
}

function centroid(pts: Pt[]): Pt {
  let x = 0;
  let z = 0;
  for (const p of pts) {
    x += p[0];
    z += p[1];
  }
  return [x / pts.length, z / pts.length];
}

interface Poly {
  rings: Pt[][];
  tags: Record<string, string>;
}

/** Outer rings of a way or multipolygon relation (members joined end to end). */
function polysOf(el: { type: string; geometry?: LL[]; members?: { type: string; role: string; geometry?: LL[] }[]; tags?: Record<string, string> }): Poly | null {
  const tags = el.tags ?? {};
  if (el.type === 'way') {
    const g = el.geometry;
    if (!g || g.length < 4) {
      return null;
    }
    const ring = g.filter(Boolean).map(project);
    return ring.length >= 4 ? { rings: [ring], tags } : null;
  }
  const segs = (el.members ?? []).filter((m) => m.type === 'way' && m.role !== 'inner' && m.geometry && m.geometry.length > 1).map((m) => m.geometry!.filter(Boolean).map(project)).filter((s) => s.length > 1);
  const rings: Pt[][] = [];
  const same = (a: Pt, b: Pt): boolean => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.01;
  while (segs.length) {
    let ring = segs.shift()!;
    let grew = true;
    while (!same(ring[0], ring[ring.length - 1]) && grew) {
      grew = false;
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        const end = ring[ring.length - 1];
        if (same(end, s[0])) {
          ring = ring.concat(s.slice(1));
        } else if (same(end, s[s.length - 1])) {
          ring = ring.concat(s.slice(0, -1).reverse());
        } else {
          continue;
        }
        segs.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (ring.length >= 4) {
      rings.push(ring);
    }
  }
  return rings.length ? { rings, tags } : null;
}

const cellOf = (x: number, z: number): number => {
  const i = Math.floor((x + WORLD_HALF_SIZE) / CELL);
  const j = Math.floor((z + WORLD_HALF_SIZE) / CELL);
  return i < 0 || j < 0 || i >= N || j >= N ? -1 : j * N + i;
};

const t0 = performance.now();
const idx = openIndex(INDEX_FILE);
const meta = (idx as { meta?: Record<string, unknown> }).meta ?? {};
const count = new Uint32Array(N * N);
const footprint = new Float64Array(N * N);
const vertices = new Uint32Array(N * N);
const tagged = new Uint32Array(N * N);
const land = new Map<string, Float64Array>(LAND_CLASSES.map(([k]) => [k, new Float64Array(N * N)]));
const landVertices = new Map<string, number>(LAND_CLASSES.map(([k]) => [k, 0]));
const landCount = new Map<string, number>(LAND_CLASSES.map(([k]) => [k, 0]));
let parts = 0;
let partVertices = 0;

const B = (WORLD_HALF_SIZE * 2) / BLOCK;
for (let bj = 0; bj < B; bj++) {
  for (let bi = 0; bi < B; bi++) {
    const x0 = -WORLD_HALF_SIZE + bi * BLOCK;
    const z0 = -WORLD_HALF_SIZE + bj * BLOCK;
    const sw = localToLatLon(x0, z0 + BLOCK);
    const ne = localToLatLon(x0 + BLOCK, z0);
    const bb = `${sw.lat},${sw.lon},${ne.lat},${ne.lon}`;
    const own = (c: Pt): boolean => c[0] >= x0 && c[0] < x0 + BLOCK && c[1] >= z0 && c[1] < z0 + BLOCK;
    const res = runQL(idx, `[out:json];(way["building"](${bb});relation["building"](${bb});way["building:part"](${bb});relation["building:part"](${bb}););out body geom;`) as { elements: Parameters<typeof polysOf>[0][] };
    for (const el of res.elements) {
      const p = polysOf(el);
      if (!p) {
        continue;
      }
      const isPart = !p.tags.building && !!p.tags['building:part'];
      for (const ring of p.rings) {
        const a = area(ring);
        const c = centroid(ring);
        if (a < (isPart ? 2 : 12) || !own(c)) {
          continue;
        }
        const v = simplifiedCount(ring, 0.35);
        if (isPart) {
          parts++;
          partVertices += v;
          continue;
        }
        const k = cellOf(c[0], c[1]);
        if (k < 0) {
          continue;
        }
        count[k]++;
        footprint[k] += a;
        vertices[k] += v;
        if (p.tags.height || p.tags['building:levels']) {
          tagged[k]++;
        }
      }
    }
    const lres = runQL(idx, `[out:json];(way["landuse"](${bb});way["leisure"](${bb});way["natural"](${bb});way["amenity"="grave_yard"](${bb});relation["landuse"](${bb});relation["leisure"](${bb});relation["natural"](${bb}););out body geom;`) as { elements: Parameters<typeof polysOf>[0][] };
    for (const el of lres.elements) {
      const p = polysOf(el);
      if (!p) {
        continue;
      }
      const kinds = ['landuse', 'leisure', 'natural', 'amenity'].filter((k) => p.tags[k]).map((k) => `${k}=${p.tags[k]}`);
      const cls = LAND_CLASSES.find(([, re]) => kinds.some((k) => re.test(k)))?.[0];
      if (!cls) {
        continue;
      }
      for (const ring of p.rings) {
        const c = centroid(ring);
        if (!own(c) || ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) {
          continue;
        }
        const k = cellOf(c[0], c[1]);
        if (k < 0) {
          continue;
        }
        land.get(cls)![k] += area(ring);
        landVertices.set(cls, landVertices.get(cls)! + simplifiedCount(ring, 2));
        landCount.set(cls, landCount.get(cls)! + 1);
      }
    }
  }
  process.stderr.write(`\r[audit] block row ${bj + 1}/${B}`);
}
process.stderr.write('\n');
const tQuery = performance.now();

// Geo: buildable and water fraction per cell (25 m samples).
const geo = buildHeadlessGeo();
const buildable = new Float32Array(N * N);
const water = new Float32Array(N * N);
const S = 10;
for (let j = 0; j < N; j++) {
  for (let i = 0; i < N; i++) {
    let b = 0;
    let w = 0;
    for (let sj = 0; sj < S; sj++) {
      for (let si = 0; si < S; si++) {
        const x = -WORLD_HALF_SIZE + i * CELL + ((si + 0.5) * CELL) / S;
        const z = -WORLD_HALF_SIZE + j * CELL + ((sj + 0.5) * CELL) / S;
        const u = geo.landUseAt(x, z);
        b += BUILDABLE.has(u) ? 1 : 0;
        w += u === 0 ? 1 : 0;
      }
    }
    buildable[j * N + i] = b / (S * S);
    water[j * N + i] = w / (S * S);
  }
}

// Coverage and the reference distribution inside the regions.
const cellArea = CELL * CELL;
const coverage = new Float32Array(N * N);
for (let k = 0; k < N * N; k++) {
  const built = buildable[k] * cellArea;
  coverage[k] = built > cellArea * 0.1 ? footprint[k] / built : footprint[k] > 0 ? 1 : 0;
}
const regions = osmRegions();
const inRegion = new Uint8Array(N * N);
for (let j = 0; j < N; j++) {
  for (let i = 0; i < N; i++) {
    const x = -WORLD_HALF_SIZE + (i + 0.5) * CELL;
    const z = -WORLD_HALF_SIZE + (j + 0.5) * CELL;
    inRegion[j * N + i] = regions.some((r) => x >= r.rect.minX && x < r.rect.maxX && z >= r.rect.minZ && z < r.rect.maxZ) ? 1 : 0;
  }
}
const quantiles = (vals: number[]): Record<string, number> => {
  const s = [...vals].sort((a, b) => a - b);
  const q = (p: number): number => (s.length ? Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))] * 1000) / 1000 : 0);
  return { n: s.length, p10: q(0.1), p25: q(0.25), p50: q(0.5), p75: q(0.75), p90: q(0.9) };
};
const builtCells = [...coverage.keys()].filter((k) => buildable[k] >= 0.3);
const refCoverage = quantiles(builtCells.filter((k) => inRegion[k]).map((k) => coverage[k]));
const allCoverage = quantiles(builtCells.map((k) => coverage[k]));
// Coverage over the 3 x 3 cells around each cell (750 m): one park or square does not make a hole in the mask.
const smooth = new Float32Array(N * N);
for (let j = 0; j < N; j++) {
  for (let i = 0; i < N; i++) {
    let f = 0;
    let b = 0;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const ii = i + di;
        const jj = j + dj;
        if (ii >= 0 && jj >= 0 && ii < N && jj < N) {
          f += footprint[jj * N + ii];
          b += buildable[jj * N + ii] * cellArea;
        }
      }
    }
    smooth[j * N + i] = b > cellArea * 0.9 ? f / b : f > 0 ? 1 : 0;
  }
}
const smoothThresholds = [0.05, 0.08, 0.1, 0.15].map((t) => {
  const covered = builtCells.filter((k) => smooth[k] >= t);
  return {
    threshold: t,
    coveredShare: Math.round((covered.length / builtCells.length) * 1000) / 1000,
    regionCellsCovered: Math.round((covered.filter((k) => inRegion[k]).length / Math.max(1, builtCells.filter((k) => inRegion[k]).length)) * 1000) / 1000,
    buildingsInCovered: covered.reduce((s, k) => s + count[k], 0),
  };
});
// What OSM says about the land in built cells without OSM buildings (coverage < 0.05): unmapped town, or land the
// hand-drawn geo map wrongly builds on.
const empty = builtCells.filter((k) => coverage[k] < 0.05);
const emptyLand = Object.fromEntries(
  LAND_CLASSES.map(([c]) => [c, Math.round((empty.reduce((s, k) => s + land.get(c)![k], 0) / 1e6) * 10) / 10]),
);
const emptyCells = { cells: empty.length, km2: Math.round((empty.reduce((s, k) => s + buildable[k] * cellArea, 0) / 1e6) * 10) / 10, osmLandKm2: emptyLand };
const thresholds = [0.05, 0.1, 0.15, 0.2, 0.3].map((t) => {
  const covered = builtCells.filter((k) => coverage[k] >= t);
  const osmOutside = [...count.keys()].filter((k) => count[k] > 0 && !(buildable[k] >= 0.3 && coverage[k] >= t));
  return {
    threshold: t,
    coveredCells: covered.length,
    coveredShare: Math.round((covered.length / builtCells.length) * 1000) / 1000,
    buildingsInCovered: covered.reduce((s, k) => s + count[k], 0),
    // Cells with OSM buildings that would stay procedural (or unbuilt) at this threshold.
    buildingsLeftOut: osmOutside.reduce((s, k) => s + count[k], 0),
  };
});

let totalBuildings = 0;
let totalVertices = 0;
let totalTagged = 0;
let totalFootprint = 0;
for (let k = 0; k < N * N; k++) {
  totalBuildings += count[k];
  totalVertices += vertices[k];
  totalTagged += tagged[k];
  totalFootprint += footprint[k];
}
const l0Bytes = totalBuildings * BUILDING_BYTES + totalVertices * VERTEX_BYTES + parts * BUILDING_BYTES + partVertices * VERTEX_BYTES;
const landBytes = [...landVertices.values()].reduce((s, v) => s + v * VERTEX_BYTES, 0) + [...landCount.values()].reduce((s, v) => s + v * 8, 0);

const out = {
  $comment: 'Phase 24 S0 audit (scripts/data/osm-city-audit.ts). Coverage = OSM footprint area / buildable geo area per 250 m cell; built cells: geo buildable >= 30 %. PNG legend: blue = geo water, grey = not buildable and no OSM buildings, red -> yellow -> green = coverage 0 -> 0.15 -> >= 0.3 in built cells, cyan = OSM buildings on land the geo map does not build on, white outline = flight-scale regions.',
  extract: { osmBase: meta.osmBase ?? null, source: meta.source ?? null },
  square: { half: WORLD_HALF_SIZE, cell: CELL, cells: N * N, builtCells: builtCells.length },
  buildings: {
    outlines: totalBuildings,
    parts,
    footprintKm2: Math.round(totalFootprint / 1e4) / 100,
    withHeightOrLevels: totalTagged,
    withHeightOrLevelsShare: Math.round((totalTagged / Math.max(1, totalBuildings)) * 1000) / 1000,
    verticesPerOutline: Math.round((totalVertices / Math.max(1, totalBuildings)) * 10) / 10,
  },
  coverage: { regions: refCoverage, all: allCoverage, thresholds, smoothThresholds, emptyBuiltCells: emptyCells },
  land: Object.fromEntries(LAND_CLASSES.map(([k]) => [k, { polygons: landCount.get(k), km2: Math.round([...land.get(k)!].reduce((s, v) => s + v, 0) / 1e4) / 100 }])),
  size: {
    l0RawMB: Math.round((l0Bytes / 1e6) * 10) / 10,
    l0GzipMBEstimate: Math.round((l0Bytes / 1e6) * 0.55 * 10) / 10,
    lodPyramidRawMBEstimate: Math.round(((l0Bytes * 1.3) / 1e6) * 10) / 10,
    landRawMB: Math.round((landBytes / 1e6) * 10) / 10,
    note: 'Int16 rings (4 B per vertex) + 12 B attributes per building; gzip ratio 0.55 assumed for quantised coordinates; L1/L2 add ~30 %.',
  },
  ms: { query: Math.round(tQuery - t0), total: Math.round(performance.now() - t0) },
};
writeFileSync(resolve(ROOT, '.docs/research/osm-city-coverage.json'), JSON.stringify(out, null, 1) + '\n');

// Coverage map: 4 px per cell, north up (z grows south, so row j is image row j).
const PX = 4;
const W = N * PX;
const img = Buffer.alloc(W * W * 3);
for (let j = 0; j < N; j++) {
  for (let i = 0; i < N; i++) {
    const k = j * N + i;
    let c: [number, number, number];
    if (buildable[k] >= 0.3) {
      const t = Math.min(1, coverage[k] / 0.3);
      c = t < 0.5 ? [220, Math.round(60 + 340 * t), 40] : [Math.round(220 - 360 * (t - 0.5)), 230, 60];
    } else if (count[k] > 0) {
      c = [60, 200, 220];
    } else if (water[k] > 0.5) {
      c = [28, 44, 80];
    } else {
      c = [90, 90, 90];
    }
    const edge = inRegion[k] && (!inRegion[k - 1] || !inRegion[k + 1] || !inRegion[k - N] || !inRegion[k + N]);
    for (let y = 0; y < PX; y++) {
      for (let x = 0; x < PX; x++) {
        const o = ((j * PX + y) * W + i * PX + x) * 3;
        const e = edge && (x === 0 || y === 0);
        img[o] = e ? 255 : c[0];
        img[o + 1] = e ? 255 : c[1];
        img[o + 2] = e ? 255 : c[2];
      }
    }
  }
}
await sharp(img, { raw: { width: W, height: W, channels: 3 } }).png().toFile(resolve(ROOT, '.docs/research/osm-city-coverage.png'));
console.log(JSON.stringify(out, null, 1));
