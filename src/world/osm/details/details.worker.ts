/// <reference lib="webworker" />
/**
 * Builds everything static of the details layer off the main thread (see index.ts): ground cover raster and mesh,
 * trees, the pedestrian walk graph, street furniture with its stationary people, moored boats, flags and pigeons.
 */
import type { WorldBounds } from '../../../core/contracts';
import { findInfill } from '../buildings/infill';
import type { OsmBuilding } from '../data';
import { StreetSurface } from '../shared/street-surface';
import { serveWorker } from '../shared/worker';
import { LotHint, LotStyle, buildCover, buildCoverMesh, coverRaster, type LotRegion } from './cover/cover';
import { buildWalkGraph, poiDensity } from './crowd/graph';
import { Placer, placeFurniture } from './props/placement';
import { PropStamper } from './props/stamp';
import { lodTileIndex, TriLod } from '../shared/mesh-tiles';
import type { DetailsRequest, DetailsResult } from './protocol';
import { placeTrees } from './trees/placement';
import { buildBoats } from './waterfront/boats';
import { osmStandGround } from '../shared/stand';

/** Placement margins keep this far from the area edge (props 24 m, walkers 26 m). */
const OPEN_SIDE = 26;

/** `area` grown by OPEN_SIDE on each side where `fade` lies beyond `rect` (edges shared with another region). */
function openSides(area: WorldBounds, rect: WorldBounds, fade: WorldBounds | undefined): WorldBounds {
  if (!fade) {
    return area;
  }
  return {
    minX: fade.minX < rect.minX - 1 ? area.minX - OPEN_SIDE : area.minX,
    maxX: fade.maxX > rect.maxX + 1 ? area.maxX + OPEN_SIDE : area.maxX,
    minZ: fade.minZ < rect.minZ - 1 ? area.minZ - OPEN_SIDE : area.minZ,
    maxZ: fade.maxZ > rect.maxZ + 1 ? area.maxZ + OPEN_SIDE : area.maxZ,
  };
}

/** Lot count and area (m²) per style and hint (debug stats). */
function lotStats(lots: readonly LotRegion[]): Record<string, number> {
  const out: Record<string, number> = {};
  const styles = Object.keys(LotStyle);
  const hints = Object.keys(LotHint);
  for (const l of lots) {
    if (l.style === LotStyle.Bare) {
      continue;
    }
    for (const key of [`lot${styles[l.style]}`, `hint${hints[l.hint]}`]) {
      out[key] = (out[key] ?? 0) + 1;
      out[`${key}M2`] = Math.round((out[`${key}M2`] ?? 0) + l.area);
    }
  }
  return out;
}

/** Builds the details layer of one region (the worker's job; also run headless by tools/headless/osm-details-check.ts). */
export function buildDetails(req: DetailsRequest): DetailsResult {
  const t0 = performance.now();
  const { base, data, pads } = req;
  const surface = new StreetSurface(base);
  const area = base.area;
  const poi = poiDensity(data.points, area);
  // The buildings layer fills blocks OSM leaves empty with row parcels: run the same (deterministic) infill so lots,
  // courtyard trees and plaza walkers stay out of those buildings.
  let parcels: OsmBuilding[] = [];
  try {
    parcels = findInfill(data.buildings, { roads: data.roads, areas: data.areas, rails: data.rails }, req.infillClaims, surface, area).parcels;
  } catch (e) {
    console.warn('[osm:details] infill parcels unavailable', e);
  }
  const ti = performance.now();
  const cover = buildCover(data, parcels.length ? data.buildings.concat(parcels) : data.buildings, surface, pads, poi);
  const t1 = performance.now();
  const coverMesh = buildCoverMesh(cover, surface);
  const trees = placeTrees(data, { surface, cover, area: base.rect, pads, lines: req.lines, mosques: req.mosques, clearings: req.clearings });
  const t2 = performance.now();
  // Props and walkers keep a margin from the area's edges, except where another OSM region continues (base.fade is
  // pushed far out there): on those sides they reach the shared edge.
  const place = openSides(area, base.rect, base.fade);
  const walk = buildWalkGraph(data, { surface, cover, area: place, pads, poi, deck: req.deck, trunks: trees.trunks });
  const t3 = performance.now();
  const boats = buildBoats(data, surface.geo);
  const stamper = new PropStamper(osmStandGround(surface));
  const placer = new Placer({ surface, cover, area: place, pads, lines: req.lines, poi }, stamper);
  for (let k = 0; k < trees.trunks.length; k += 2) {
    placer.reserve(trees.trunks[k], trees.trunks[k + 1]);
  }
  const placed = placeFurniture(placer, data, boats.anchors);
  const t4 = performance.now();
  const props = stamper.take();
  let propsTiles: Float64Array | null = null;
  if (props) {
    // Tiled (no far version): drawn and shadowed only near the camera (index.ts).
    const tiled = lodTileIndex(props.attributes.position.array as Float32Array, props.index, new Uint8Array(props.index.length / 3).fill(TriLod.Near));
    props.index = tiled.index;
    propsTiles = tiled.leaves;
  }
  const kits = stamper.takeKits();
  let kitsTiles: Float64Array | null = null;
  if (kits) {
    const tiled = lodTileIndex(kits.attributes.position.array as Float32Array, kits.index, new Uint8Array(kits.index.length / 3).fill(TriLod.Near));
    kits.index = tiled.index;
    kitsTiles = tiled.leaves;
  }
  return {
    cover: coverMesh.count ? { mesh: coverMesh.take(), raster: coverRaster(cover) } : null,
    trees: trees.trees,
    walk: walk.graph,
    standers: placed.standers,
    props,
    propsTiles,
    kits,
    kitsTiles,
    boats: boats.mesh,
    flags: placed.flags,
    pigeons: placed.pigeons,
    stats: {
      infillParcels: parcels.length,
      infillMs: Math.round(ti - t0),
      coverMs: Math.round(t1 - ti),
      coverTris: coverMesh.triangles,
      lots: cover.lots.length,
      ...lotStats(cover.lots),
      trees: trees.count,
      osmTrees: trees.osm,
      ...Object.fromEntries(Object.entries(trees.osmRejected).map(([k, v]) => [`osmTreeNo_${k}`, v])),
      treesMs: Math.round(t2 - t1),
      walkVerts: walk.vertices,
      walkLanes: walk.lanes,
      crossings: walk.crossings,
      squares: walk.squares,
      walkMs: Math.round(t3 - t2),
      boats: boats.count,
      propTris: stamper.mesh.triangles,
      kitTris: stamper.kits.triangles,
      ...Object.fromEntries(Object.entries(stamper.counts).map(([k, v]) => [`p_${k}`, v])),
      ...stamper.log.flat('stand.'),
      standers: placed.standers.length / 6,
      propsMs: Math.round(t4 - t3),
      ms: Math.round(performance.now() - t0),
    },
  };
}

// In a worker (not when imported headless, where there is no `self`).
if (typeof self !== 'undefined') {
  serveWorker<DetailsRequest, DetailsResult>(buildDetails);
}
