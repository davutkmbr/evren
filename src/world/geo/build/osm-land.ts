/**
 * Real land use (phase 24): the OSM land-use polygons of the far city bake (public/data/osm/city/land.bin.gz,
 * scripts/data/osm-city-bake.ts) stamped over the hand-drawn land use. Only inside the coverage mask's OSM cells
 * (src/world/city/osm/mask.json), where the OSM buildings stand, so every consumer of the land-use grid (terrain,
 * vegetation, the procedural city, mosque sites, the map) sees the same parks and woods as the OSM layers. The S0 audit
 * found about 110 km² of real forest, meadow and park the hand-drawn map calls urban (.docs/research/osm-city-coverage.md).
 *
 * Rules:
 * - Water, roads, landmark pads, the airport and beaches keep their geo class (the coast and the reserved ground are
 *   the geo build's).
 * - Broad classes go first, specific ones last: residential and industrial, then farm and forest, then parks, grass,
 *   pitches and cemeteries, so a park inside a residential polygon stays a park.
 * - Residential land only claims ground the geo map leaves natural (forest, park, farmland); the geo map's own urban
 *   classes (historic, high-rise, suburban) stay.
 * - OSM water polygons are not stamped (inland water is the coast stage's).
 */
import { LandUse } from '../../../core/contracts';
import { type DecodedLand, LandClass, MASK_CELL, MASK_SIZE, BAKE_HALF } from '../../city/osm/format';
import { LANDUSE_GRID } from './grid';

const TARGET: Record<number, LandUse | null> = {
  [LandClass.Park]: LandUse.Park,
  [LandClass.Grass]: LandUse.Park,
  [LandClass.Pitch]: LandUse.Park,
  [LandClass.Forest]: LandUse.Forest,
  [LandClass.Cemetery]: LandUse.Cemetery,
  [LandClass.Farm]: LandUse.Farmland,
  [LandClass.Industrial]: LandUse.Industrial,
  [LandClass.Residential]: LandUse.Urban,
  [LandClass.Water]: null,
};
/** Stamping order (lower first). */
const ORDER: Record<number, number> = {
  [LandClass.Residential]: 0,
  [LandClass.Industrial]: 0,
  [LandClass.Farm]: 1,
  [LandClass.Forest]: 1,
  [LandClass.Park]: 2,
  [LandClass.Grass]: 2,
  [LandClass.Pitch]: 3,
  [LandClass.Cemetery]: 3,
  [LandClass.Water]: 9,
};
const KEEP = new Set<number>([LandUse.Water, LandUse.Road, LandUse.Landmark, LandUse.Airport, LandUse.Beach]);
const NATURAL = new Set<number>([LandUse.Forest, LandUse.Park, LandUse.Farmland]);

/** Stamps `land` into `landUse` (LANDUSE_GRID layout) inside the OSM cells of `mask`; returns the cells changed. */
export function stampOsmLand(landUse: Uint8Array, land: DecodedLand, mask: Uint8Array): number {
  const g = LANDUSE_GRID;
  // Ring offsets per polygon.
  const polys: { p: number; r0: number; v0: number; order: number; area: number }[] = [];
  let r = 0;
  let v = 0;
  for (let p = 0; p < land.cls.length; p++) {
    let area = 0;
    const n = land.nv[r];
    for (let q = 0; q < n; q++) {
      const a = (v + q) * 2;
      const b = (v + ((q + 1) % n)) * 2;
      area += land.xy[a] * land.xy[b + 1] - land.xy[b] * land.xy[a + 1];
    }
    polys.push({ p, r0: r, v0: v, order: ORDER[land.cls[p]] ?? 9, area: Math.abs(area / 2) });
    for (let k = 0; k < land.rings[p]; k++, r++) {
      v += land.nv[r];
    }
  }
  polys.sort((a, b) => a.order - b.order || b.area - a.area);
  let changed = 0;
  const xs: number[] = [];
  for (const poly of polys) {
    const target = TARGET[land.cls[poly.p]];
    if (target === null || target === undefined) {
      continue;
    }
    const rings = land.rings[poly.p];
    let minZ = Infinity;
    let maxZ = -Infinity;
    let minX = Infinity;
    let maxX = -Infinity;
    for (let k = 0, vv = poly.v0; k < rings; k++) {
      for (let q = 0; q < land.nv[poly.r0 + k]; q++, vv++) {
        minX = Math.min(minX, land.xy[vv * 2]);
        maxX = Math.max(maxX, land.xy[vv * 2]);
        minZ = Math.min(minZ, land.xy[vv * 2 + 1]);
        maxZ = Math.max(maxZ, land.xy[vv * 2 + 1]);
      }
    }
    const r0 = Math.max(0, Math.ceil((minZ - g.origin) / g.cell));
    const r1 = Math.min(g.size - 1, Math.floor((maxZ - g.origin) / g.cell));
    const c0 = Math.max(0, Math.ceil((minX - g.origin) / g.cell));
    const c1 = Math.min(g.size - 1, Math.floor((maxX - g.origin) / g.cell));
    for (let row = r0; row <= r1; row++) {
      // Cell centres of the land-use grid (geo/build/areas.ts useAt rounds to them).
      const z = g.origin + row * g.cell;
      xs.length = 0;
      for (let k = 0, vv = poly.v0; k < rings; k++) {
        const n = land.nv[poly.r0 + k];
        for (let q = 0; q < n; q++) {
          const a = (vv + q) * 2;
          const b = (vv + ((q + 1) % n)) * 2;
          const za = land.xy[a + 1];
          const zb = land.xy[b + 1];
          if (za > z !== zb > z) {
            xs.push(land.xy[a] + ((z - za) / (zb - za)) * (land.xy[b] - land.xy[a]));
          }
        }
        vv += n;
      }
      xs.sort((a, b) => a - b);
      const mj = Math.floor((z + BAKE_HALF) / MASK_CELL);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const ca = Math.max(c0, Math.ceil((xs[k] - g.origin) / g.cell));
        const cb = Math.min(c1, Math.floor((xs[k + 1] - g.origin) / g.cell));
        for (let col = ca; col <= cb; col++) {
          const x = g.origin + col * g.cell;
          const mi = Math.floor((x + BAKE_HALF) / MASK_CELL);
          if (mi < 0 || mj < 0 || mi >= MASK_SIZE || mj >= MASK_SIZE || !mask[mj * MASK_SIZE + mi]) {
            continue;
          }
          const idx = row * g.size + col;
          const cur = landUse[idx];
          if (KEEP.has(cur) || cur === target || (target === LandUse.Urban && !NATURAL.has(cur))) {
            continue;
          }
          landUse[idx] = target;
          changed++;
        }
      }
    }
  }
  return changed;
}
