/**
 * Building data (`--buildings data`): the compiler ships its buildings as light data instead of geometry, for a runtime
 * that builds them itself from the same rules (the Unreal game's façade generator). Tiles keep the ground, the
 * streets and the street props; every building of a tile becomes a record in the tile manifest
 * (`extra.buildingData`), and the area-wide inputs of the rules go to `buildings.json` next to the index.
 *
 * A record carries everything the façade rules read that depends on the site or on the one height / style decision,
 * already resolved, so every runtime draws the same building:
 * - the solid: id, footprint and holes (positive area, world metres [x, z, ...]), ground, bottom and top heights, doors
 *   (edge, position along it, width, height, threshold), passage openings, OSM tags and the street it faces;
 * - how it is drawn (`mode`): `facade` (the façade kit, with its FacadePlan), `plain` (a block with door recesses:
 *   contained footprints, raised parts, greybox parts), `massing` (a landmark block in stone), `canopy`
 *   (building=roof), `hero` (a hand-made model replaces it), `none` (left to a landmark model the runtime draws);
 * - the plan (typology, storeys, G / F, roof, paint and trim colours in linear RGBA, wear, seed...) and per footprint
 *   edge the facts only the street surface and the neighbours know: kind (street / open / party / short), median free
 *   depth, convex ends, and every 0.5 m along the wall the ground 0.6 m in front (`g`) and the free depth before the
 *   next building (`free`, -1 = none within reach; the grid the façade code's gapOf caches on).
 *
 * Frame conventions are the tile format's (world metres, +X east, +Y up, +Z south). Edge i runs from ring vertex i to
 * i + 1 of the positive-area ring; the façade frame's r runs the other way (r = len - t, facade/frame.ts Frame.ofEdge),
 * and edge samples are indexed by r.
 */
import type { OsmBuilding } from '../../../src/world/osm/data';
import { ringArea } from '../../../src/world/osm/shared/geometry';
import { cleanRing } from '../../../src/world/osm/buildings/footprint';
import { onLandmarkClaim } from '../../../src/world/osm/buildings/selection';
import { structureBlocks } from '../../../src/world/osm/buildings/build';
import type { Solid } from './buildings';
import { type Edge, gapFrom } from './facade/build';
import type { FacadePlan } from './facade/plan';
import { claimsOf, district } from './district';
import { portalsOn } from './passages';
import { isPoi } from './pois';
import type { AreaContext, TileContext } from './registry';
import { FACADE_MATERIALS } from './facade/materials';
import { FACADE_PROP_MATERIALS } from './facade/props';

/**
 * Materials a runtime building the façades needs whatever the tiles use: the façade kit's (walls, openings, module
 * materials), its props', and the core block materials of plain and landmark blocks.
 */
export const FACADE_KIT_MATERIALS: readonly string[] = [...FACADE_MATERIALS.map((d) => d.id), ...FACADE_PROP_MATERIALS.map((d) => d.id), 'wall', 'roof', 'door', 'doorInferred'];

let enabled = false;

/** `--buildings data`: building records instead of building geometry. */
export function setBuildingData(on: boolean): void {
  enabled = on;
}

export function buildingDataEnabled(): boolean {
  return enabled;
}

/** Record format version: bump when a field changes meaning. */
export const BUILDING_DATA_VERSION = 1;

export type BuildingMode = 'facade' | 'plain' | 'massing' | 'canopy' | 'hero' | 'none';

const r3 = (v: number): number => Math.round(v * 1000) / 1000;
const r2 = (v: number): number => Math.round(v * 100) / 100;
const rgba = (c: readonly number[]): number[] => c.map((v) => Math.round(v * 10000) / 10000);

/** Spacing (m) of the per-edge samples; the façade code caches free depth on the same 0.5 m grid (gapOf). */
const SAMPLE = 0.5;

export interface EdgeRecord {
  kind: Edge['kind'];
  len: number;
  /** Median free depth in front (m), -1 = none within reach. */
  gap: number;
  convexL: boolean;
  convexR: boolean;
  gMean: number;
  /** Ground 0.6 m in front of the wall at r = k * 0.5 (k = 0 .. round(len / 0.5), the last one at r = len). */
  g: number[];
  /** Free depth (m) in front of the wall at r = k * 0.5 before another building, -1 = none within reach. */
  free: number[];
  /** Passage openings on this edge, in façade-frame r: [r0, r1, crownY, arc r, y, r, y, ...]. */
  portals?: number[][];
}

/** Edge records of a façade building from classifyEdges' output. */
function edgeRecords(a: AreaContext, s: Solid, edges: readonly Edge[]): EdgeRecord[] {
  return edges.map((e) => {
    const n = Math.max(1, Math.round(e.len / SAMPLE));
    const g: number[] = [];
    const free: number[] = [];
    for (let k = 0; k <= n; k++) {
      const r = Math.min(e.len, k * SAMPLE);
      g.push(r3(e.gAt(r)));
      const [px, pz] = e.f.xz(Math.max(0.05, Math.min(e.len - 0.05, r)), 0);
      const gap = gapFrom(a.outlines, s, px, pz, e.f.nx, e.f.nz);
      free.push(Number.isFinite(gap) ? r3(gap) : -1);
    }
    const rec: EdgeRecord = { kind: e.kind, len: r3(e.len), gap: Number.isFinite(e.gap) ? r3(e.gap) : -1, convexL: e.convexL, convexR: e.convexR, gMean: r3(e.gMean), g, free };
    const portals = portalsOn(s, 0, e.i);
    if (portals.length) {
      rec.portals = portals.map((po) => [r3(e.len - po.t1), r3(e.len - po.t0), r3(po.crownY), ...po.arc.flatMap(([t, y]) => [r3(e.len - t), r3(y)])]);
    }
    return rec;
  });
}

function planRecord(p: FacadePlan): Record<string, unknown> {
  return {
    typ: p.typ,
    storeys: p.storeys,
    G: p.G,
    F: p.F,
    base: p.base,
    roofY: p.roofY,
    roof: p.roof,
    parapet: p.parapet,
    pitch: p.pitch,
    wall: rgba(p.wall),
    trim: rgba(p.trim),
    accent: rgba(p.accent),
    frame: p.frame,
    frameColor: rgba(p.frameColor),
    cikma: p.cikma,
    cikmaDepth: p.cikmaDepth,
    balcony: p.balcony,
    railing: p.railing,
    railColor: rgba(p.railColor),
    shutters: p.shutters,
    triple: p.triple,
    glazedBase: p.glazedBase,
    wear: p.wear,
    seed: p.seed,
    source: p.source,
  };
}

/** The OSM tags a runtime may query (gameplay: building type, names, heritage). */
function tagsOf(b: OsmBuilding | undefined): Record<string, string | number> | undefined {
  if (!b) {
    return undefined;
  }
  const t: Record<string, string | number> = {};
  const keys = ['name', 'nameTr', 'nameEn', 'wikidata', 'addrStreet', 'amenity', 'historic', 'shop', 'tourism', 'religion', 'architecture', 'use', 'startDate', 'material', 'colour', 'roofShape', 'roofColour', 'roofMaterial', 'levels', 'height', 'roofLevels', 'minLevel', 'minHeight'] as const;
  for (const k of keys) {
    const v = b[k];
    if (v !== undefined && v !== null && v !== '') {
      t[k] = v as string | number;
    }
  }
  return Object.keys(t).length ? t : undefined;
}

/** A building on the ground claim of a landmark the runtime models (its model stands there instead). */
function claimed(b: OsmBuilding | undefined): boolean {
  const claims = claimsOf();
  if (!claims || !b?.ring) {
    return false;
  }
  return onLandmarkClaim(claims, cleanRing(b.ring)) || structureBlocks(claims, b);
}

/** Name of the nearest named street (within 30 m) in front of the main street edge, else of the centroid. */
function streetOf(a: AreaContext, s: Solid, edges: readonly Edge[] | undefined): string | undefined {
  const main = edges?.filter((e) => e.kind === 'street').sort((p, q) => q.len - p.len)[0];
  const [px, pz] = main ? main.f.xz(main.len / 2, 3) : [s.cx, s.cz];
  let best: string | undefined;
  let bestD = 30;
  for (const road of a.data.roads) {
    if (!road.name) {
      continue;
    }
    const pts = road.pts;
    for (let k = 0; k + 3 < pts.length; k += 2) {
      const ax = pts[k];
      const az = pts[k + 1];
      const bx = pts[k + 2];
      const bz = pts[k + 3];
      if (Math.abs(ax - px) > 300 || Math.abs(az - pz) > 300) {
        continue;
      }
      const l2 = (bx - ax) ** 2 + (bz - az) ** 2 || 1e-9;
      const t = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (pz - az) * (bz - az)) / l2));
      const d = Math.hypot(ax + (bx - ax) * t - px, az + (bz - az) * t - pz);
      if (d < bestD) {
        bestD = d;
        best = road.name;
      }
    }
  }
  return best;
}

/** What the façade step's prepare decided (facade/step.ts Shared). */
export interface FacadeDecisions {
  plans: ReadonlyMap<Solid, { plan: FacadePlan; edges: Edge[] }>;
  massing: ReadonlySet<Solid>;
}

/** Writes the tile's building records (`extra.buildingData`); the tile gets no building geometry. */
export function recordBuildingData(t: TileContext, sh: FacadeDecisions, skip: ReadonlySet<string> | undefined): void {
  const a = t.area;
  const byId = new Map(a.data.buildings.map((b) => [b.id, b]));
  const heroIds = district().buildings.heroIds;
  const out: Record<string, unknown>[] = [];
  for (const s of t.solids) {
    const osm = byId.get(s.rec.osmId);
    const entry = sh.plans.get(s);
    let mode: BuildingMode;
    if (skip?.has(s.rec.id) || heroIds.has(s.rec.osmId)) {
      mode = 'hero';
    } else if (s.rec.landmark && claimed(osm)) {
      mode = 'none';
    } else if (sh.massing.has(s)) {
      mode = s.rec.landmark ? 'massing' : 'plain';
    } else if (entry) {
      mode = 'facade';
    } else if (s.rec.kind === 'roof' && s.holes.length === 0) {
      mode = 'canopy';
    } else {
      mode = 'plain';
    }
    const rec: Record<string, unknown> = {
      id: s.rec.id,
      osmId: s.rec.osmId,
      kind: s.rec.kind,
      mode,
      footprint: s.ring.map(r3),
      groundY: s.rec.groundY,
      bottomY: s.rec.bottomY,
      topY: s.rec.topY,
      height: s.rec.height,
      heightSource: s.rec.heightSource,
      grounded: s.grounded,
      area: r2(Math.abs(ringArea(s.ring))),
      doors: s.doors.filter((d) => d.rec).map((d) => ({ id: d.rec!.id, edge: d.edge, t: r3(d.t), width: r3(d.width), height: r3(d.height), bottom: r3(d.bottom), inferred: d.inferred, entrance: d.entrance })),
    };
    if (s.holes.length) {
      rec.holes = s.holes.map((h) => h.map(r3));
    }
    if (s.rec.part) {
      rec.part = true;
    }
    if (s.rec.levels) {
      rec.levels = s.rec.levels;
    }
    // The building merge's provenance: an added footprint ('ml') or row lot ('lot', of outline `lotOf`), and where an
    // estimated storey count came from.
    if (osm?.source) {
      rec.source = osm.source;
    }
    if (osm?.lotOf !== undefined) {
      rec.lotOf = osm.lotOf;
    }
    if (osm?.levelsFrom) {
      rec.levelsFrom = osm.levelsFrom;
    }
    if (s.rec.landmark) {
      rec.landmark = s.rec.landmark;
    }
    if (s.flightTop !== undefined) {
      rec.flightTop = r3(s.flightTop);
    }
    const tags = tagsOf(osm);
    if (tags) {
      rec.tags = tags;
    }
    const street = streetOf(a, s, entry?.edges);
    if (street) {
      rec.street = street;
    }
    if (entry) {
      rec.plan = planRecord(entry.plan);
      rec.edges = edgeRecords(a, s, entry.edges);
      rec.market = district().facade.market(s.cx, s.cz);
    }
    out.push(rec);
  }
  t.record('buildingData', { version: BUILDING_DATA_VERSION, buildings: out });
}

/** Area-wide inputs of the façade rules (district profile parts, OSM words shop names avoid), for buildings.json. */
export function areaRecord(a: AreaContext, avoid: ReadonlySet<string>): Record<string, unknown> {
  const dp = district();
  return {
    version: BUILDING_DATA_VERSION,
    area: a.area.id,
    district: dp.id,
    label: dp.label,
    facade: { acScale: dp.facade.acScale, flag: dp.facade.flag, t2Balcony: dp.facade.t2Balcony },
    buildings: { shuttered: [...dp.buildings.shuttered], wearBias: dp.buildings.wearBias },
    shops: { firstWords: dp.shops.firstWords, filler: dp.shops.filler, marketFiller: dp.shops.marketFiller, fallback: dp.shops.fallback, tradeOverrides: dp.shops.tradeOverrides },
    avoid: [...avoid].sort(),
    streets: streetsOf(a),
    places: placesOf(a),
  };
}

/** Kinds of named points that are places to go to but not storefront POIs (stations, monuments, fountains, piers). */
const PLACE_KEYS = new Set(['historic', 'man_made', 'railway', 'public_transport', 'amenity', 'tourism', 'leisure', 'memorial']);

/** The rect every tile of the area covers (the union of the tile squares). */
function tileRect(a: AreaContext): { minX: number; minZ: number; maxX: number; maxZ: number } {
  const r = { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity };
  for (const m of a.manifests.values()) {
    r.minX = Math.min(r.minX, m.bounds.minX);
    r.minZ = Math.min(r.minZ, m.bounds.minZ);
    r.maxX = Math.max(r.maxX, m.bounds.maxX);
    r.maxZ = Math.max(r.maxZ, m.bounds.maxZ);
  }
  return r;
}

/** Named OSM ways of the streets (and steps) in the compiled tiles: name, kind, OSM way and polyline (x, z). */
function streetsOf(a: AreaContext): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const r = tileRect(a);
  for (const road of a.data.roads) {
    if (!road.name && road.kind !== 'steps') {
      continue;
    }
    const pts = road.pts;
    let inside = false;
    for (let k = 0; k + 1 < pts.length && !inside; k += 2) {
      inside = pts[k] >= r.minX && pts[k] <= r.maxX && pts[k + 1] >= r.minZ && pts[k + 1] <= r.maxZ;
    }
    if (!inside) {
      continue;
    }
    out.push({ osm: `w${road.id}`, kind: `highway=${road.kind}`, ...(road.name ? { name: road.name } : {}), pts: pts.map((v) => Math.round(v * 100) / 100) });
  }
  return out;
}

/** Named points that are not storefront POIs (the tile manifests' `pois`): stations, monuments, fountains, piers. */
function placesOf(a: AreaContext): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const r = tileRect(a);
  for (const p of a.data.points) {
    const key = p.kind.split('=')[0];
    if (!p.name || !PLACE_KEYS.has(key) || isPoi(p) || p.x < r.minX || p.x > r.maxX || p.z < r.minZ || p.z > r.maxZ) {
      continue;
    }
    out.push({ kind: p.kind, name: p.name, x: Math.round(p.x * 100) / 100, z: Math.round(p.z * 100) / 100, y: Math.round(a.heights.at(p.x, p.z) * 100) / 100, ...(p.osm ? { osm: p.osm } : {}), ...(p.wikidata ? { wikidata: p.wikidata } : {}), ...(p.nameEn ? { nameEn: p.nameEn } : {}) });
  }
  return out;
}
