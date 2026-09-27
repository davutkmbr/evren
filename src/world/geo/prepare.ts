import { LandUse } from '../../core/contracts';
import type { District, LandmarkDef, RoadDef, Vec2Like } from '../../core/contracts';
import { latLonToLocal } from '../../core/geo-coords';
import { BREAKWATERS, INLAND_WATER, LAND_RINGS } from './data/coastline';
import { DISTRICTS } from './data/districts';
import { ELEVATION_POINTS } from './data/elevation-points';
import { LANDMARKS } from './data/landmarks';
import { CIRCLE_ZONES, ZONES } from './data/landuse';
import { BATHYMETRY, BEACHES, BURIED_VALLEYS, SHORE_FLATS, STEEP_CHANNELS, SUMMITS } from './data/relief';
import { RIVER_VALLEYS } from './data/rivers';
import { ROADS } from './data/roads';
import { SPOT_HEIGHTS } from './data/spot-heights';
import { osmCoverageMask } from '../city/osm/mask';
import { osmStaticExclusion } from '../osm/regions';
import WALL_CORRIDORS from '../landmarks/walls/data/corridors.json';
import { lowStructureOutlines, STRUCTURE_REACH, STRUCTURE_STRIDE, STRUCTURE_VERGE, structureBoxes } from '../landmarks/structure-volumes';
import type { BuildInput, FlatRing } from './types';

/** Flat lat/lon pairs -> flat local x/z pairs. */
export function projectRing(ll: readonly number[]): FlatRing {
  const out = new Float64Array(ll.length);
  for (let i = 0; i < ll.length; i += 2) {
    const p = latLonToLocal(ll[i], ll[i + 1]);
    out[i] = p.x;
    out[i + 1] = p.z;
  }
  return out;
}

/** Flat lat/lon/value triples -> flat x/z/value triples. */
function projectTriples(t: readonly number[]): Float64Array {
  const out = new Float64Array(t.length);
  for (let i = 0; i < t.length; i += 3) {
    const p = latLonToLocal(t[i], t[i + 1]);
    out[i] = p.x;
    out[i + 1] = p.z;
    out[i + 2] = t[i + 2];
  }
  return out;
}

/**
 * Buffers a centerline (local meters, flat x, z pairs) into a closed ring `width` m wide with mitred joins
 * and square ends, counter-clockwise in map view like the other land rings.
 */
function bufferPolyline(line: FlatRing, width: number): FlatRing {
  const m = line.length >> 1;
  const half = width / 2;
  const left: number[] = [];
  const right: number[] = [];
  for (let i = 0; i < m; i++) {
    const a = Math.max(0, i - 1);
    const b = Math.min(m - 1, i + 1);
    let dx = line[b * 2] - line[a * 2];
    let dz = line[b * 2 + 1] - line[a * 2 + 1];
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    // Extend the end caps by half the width so the mound has square, not clipped, heads.
    const ext = i === 0 ? -half : i === m - 1 ? half : 0;
    const x = line[i * 2] + dx * ext;
    const z = line[i * 2 + 1] + dz * ext;
    left.push(x + dz * half, z - dx * half);
    right.push(x - dz * half, z + dx * half);
  }
  const ring: number[] = [...left];
  for (let i = m - 1; i >= 0; i--) {
    ring.push(right[i * 2], right[i * 2 + 1]);
  }
  let area = 0;
  for (let i = 0, n = ring.length >> 1; i < n; i++) {
    const j = (i + 1) % n;
    area += ring[i * 2] * ring[j * 2 + 1] - ring[j * 2] * ring[i * 2 + 1];
  }
  // x east, z south: a positive shoelace sum here is clockwise on a north-up map.
  if (area > 0) {
    const n = ring.length >> 1;
    const rev: number[] = [];
    for (let i = n - 1; i >= 0; i--) {
      rev.push(ring[i * 2], ring[i * 2 + 1]);
    }
    return new Float64Array(rev);
  }
  return new Float64Array(ring);
}

/** Local-space land rings: the coastline plus buffered breakwaters. */
function allLandRings(): { ring: FlatRing; side: number }[] {
  const rings = LAND_RINGS.map((r) => ({ ring: projectRing(r.ll), side: ringSide(r.id) }));
  for (const b of BREAKWATERS) {
    rings.push({ ring: bufferPolyline(projectRing(b.ll), b.width), side: SIDE_CODE[b.side] });
  }
  return rings;
}

export function ringToVecs(ring: FlatRing): Vec2Like[] {
  const out: Vec2Like[] = [];
  for (let i = 0; i < ring.length; i += 2) {
    out.push({ x: ring[i], z: ring[i + 1] });
  }
  return out;
}

const SIDE_CODE = { europe: 0, asia: 1, island: 2 } as const;
const PRINCES_ISLANDS = new Set(['kinaliada', 'burgazada', 'heybeliada', 'buyukada', 'sedef', 'kasik', 'sivriada', 'yassiada']);
const ASIAN_ISLETS = new Set(['kiz-kulesi-adacik', 'riva-kayasi']);

function ringSide(id: string): number {
  if (id === 'avrupa') {
    return 0;
  }
  if (id === 'anadolu' || ASIAN_ISLETS.has(id)) {
    return 1;
  }
  return PRINCES_ISLANDS.has(id) ? 2 : 0;
}

export const MOSQUE_SITE_TARGET = 400;

/** Landmarks projected to local meters (y is filled in after the terrain is built). */
export function buildLandmarkDefs(): LandmarkDef[] {
  return LANDMARKS.map((l) => {
    const p = latLonToLocal(l.lat, l.lon);
    const anchors = l.anchors ? ringToVecs(projectRing(l.anchors)) : undefined;
    if (anchors && l.anchorHeights) {
      anchors.forEach((a, i) => Object.assign(a, { height: l.anchorHeights![i] ?? l.height }));
    }
    return {
      id: l.id,
      name: l.name,
      kind: l.kind,
      builder: l.builder,
      lat: l.lat,
      lon: l.lon,
      x: p.x,
      z: p.z,
      y: 0,
      headingDeg: l.headingDeg,
      radius: l.radius,
      height: l.height,
      anchors,
      footprint: l.footprint ?? 'pad',
      footprintWidth: l.footprintWidth,
      bodyWidth: l.bodyWidth,
      info: l.info,
      year: l.year,
    };
  });
}

export function buildRoadDefs(): RoadDef[] {
  return ROADS.map((r) => ({ id: r.id, name: r.name, kind: r.kind, width: r.width, points: ringToVecs(projectRing(r.ll)) }));
}

export function buildDistrictDefs(): District[] {
  return DISTRICTS.map((d) => {
    const p = latLonToLocal(d.lat, d.lon);
    return {
      id: d.id,
      name: d.name,
      side: d.side,
      x: p.x,
      z: p.z,
      style: d.style,
      density: d.density,
      floorsMean: d.floorsMean,
      floorsMax: d.floorsMax,
    };
  });
}

export function buildCoastlines(): Vec2Like[][] {
  return allLandRings().map((r) => ringToVecs(r.ring));
}

/** Maps each landmark id to its pad index in BuildInput.pads (landmarks with a flattened pad only). */
export interface PreparedInput {
  input: BuildInput;
  padIndex: Map<string, number>;
}

export function prepareBuildInput(): PreparedInput {
  const pads: BuildInput['pads'] = [];
  const reservedDiscs: BuildInput['reservedDiscs'] = [];
  const reservedLines: BuildInput['reservedLines'] = [];
  const reservedPolygons: BuildInput['reservedPolygons'] = [];
  const padIndex = new Map<string, number>();

  for (const l of LANDMARKS) {
    const p = latLonToLocal(l.lat, l.lon);
    const footprint = l.footprint ?? 'pad';
    const anchors = l.anchors ? projectRing(l.anchors) : null;
    if (footprint === 'pad') {
      padIndex.set(l.id, pads.length);
      pads.push({ x: p.x, z: p.z, radius: l.radius, blend: Math.max(35, l.radius * 0.6), strength: 1 });
      reservedDiscs.push({ x: p.x, z: p.z, radius: l.radius });
    } else if (footprint === 'slope') {
      reservedDiscs.push({ x: p.x, z: p.z, radius: l.radius });
    } else if (footprint === 'cluster' && anchors) {
      const r = l.footprintWidth ?? 40;
      padIndex.set(l.id, pads.length);
      pads.push({ x: p.x, z: p.z, radius: 1, blend: 1, strength: 0 });
      for (let i = 0; i < anchors.length; i += 2) {
        pads.push({ x: anchors[i], z: anchors[i + 1], radius: r, blend: 30, strength: 0.9 });
        reservedDiscs.push({ x: anchors[i], z: anchors[i + 1], radius: r });
      }
    } else if (footprint === 'line' && anchors) {
      reservedLines.push({ pts: anchors, halfWidth: l.footprintWidth ?? 15 });
    } else if (footprint === 'polygon' && anchors) {
      reservedPolygons.push(l.footprintPolygon ? projectRing(l.footprintPolygon) : anchors);
      padIndex.set(l.id, pads.length);
      pads.push({ x: p.x, z: p.z, radius: l.footprintWidth ?? l.radius * 0.45, blend: l.radius * 0.4, strength: 0.65 });
    }
  }

  // Bridges (landmarks/structure-volumes.ts): their towers, piers, anchorages and the deck pieces that run within
  // STRUCTURE_REACH of the ground are no place for procedural buildings or trees.
  for (const ring of lowStructureOutlines(STRUCTURE_REACH, STRUCTURE_VERGE)) {
    reservedPolygons.push(Float64Array.from(ring));
  }

  // The placed city walls (npm run compile:walls): procedural buildings keep a few metres off both faces.
  for (const c of (WALL_CORRIDORS as { lines: number[][] }).lines) {
    reservedLines.push({ pts: Float64Array.from(c.slice(1)), halfWidth: c[0] });
  }

  const rivers: BuildInput['rivers'] = [...RIVER_VALLEYS, ...BURIED_VALLEYS].map((r) => ({
    pts: projectTriples(r.pts),
    halfWidth: r.halfWidth,
    wallSlope: r.wallSlope,
  }));

  const elev: number[] = [];
  for (const [, lat, lon, e] of ELEVATION_POINTS) {
    elev.push(lat, lon, e);
  }
  const bathy: number[] = [];
  for (const [lat, lon, d] of BATHYMETRY) {
    bathy.push(lat, lon, d);
  }

  const land = allLandRings();
  const input: BuildInput = {
    landRings: land.map((r) => r.ring),
    landRingSides: land.map((r) => r.side),
    steepChannels: STEEP_CHANNELS.map((r) => projectRing(r)),
    lakeRings: INLAND_WATER.map((r) => ({ ring: projectRing(r.ll), depth: r.depth ?? 10 })),
    zones: ZONES.map((z) => ({ ring: projectRing(z.ll), use: z.use, shoreStrip: !!z.shoreStrip })),
    circles: CIRCLE_ZONES.map((c) => ({ ...latLonToLocal(c.lat, c.lon), radius: c.radius, use: c.use })),
    beaches: BEACHES.map(([, lat, lon, radius, width]) => ({ ...latLonToLocal(lat, lon), radius, width })),
    elevationPoints: projectTriples(elev),
    bathymetryPoints: projectTriples(bathy),
    spotHeights: projectTriples(SPOT_HEIGHTS),
    rivers,
    summits: SUMMITS.map(([, lat, lon, elevation, radius, headingDeg, elongation]) => ({
      ...latLonToLocal(lat, lon),
      elevation,
      radius,
      headingRad: (headingDeg * Math.PI) / 180,
      elongation,
    })),
    flats: SHORE_FLATS.map((f) => ({ pts: projectRing(f.ll), reach: f.reach, width: f.width, level: f.level, rise: f.rise, wallSlope: f.wallSlope })),
    pads,
    reservedDiscs,
    reservedLines,
    reservedPolygons,
    structureCaps: Float32Array.from(structureBoxes()),
    structureStride: STRUCTURE_STRIDE,
    roads: ROADS.map((r) => ({ pts: projectRing(r.ll), halfWidth: Math.max(6, r.width / 2 + 3), overWater: r.kind === 'bridge', highway: r.kind === 'highway' ? r.name : undefined })),
    breakwaters: BREAKWATERS.map((b) => ({ pts: projectRing(b.ll), halfWidth: b.width / 2 + 12 })),
    districts: DISTRICTS.map((d) => ({
      ...latLonToLocal(d.lat, d.lon),
      reach: d.reach,
      side: SIDE_CODE[d.side],
      density: d.density,
      historic: d.style === 'historic',
    })),
    landmarkMosques: LANDMARKS.filter((l) => l.builder === 'mosques').map((l) => ({ ...latLonToLocal(l.lat, l.lon), radius: l.radius })),
    mosqueTarget: MOSQUE_SITE_TARGET,
    siteExclusion: osmStaticExclusion().map((r) => ({ minX: r.minX, maxX: r.maxX, minZ: r.minZ, maxZ: r.maxZ })),
    siteMask: osmCoverageMask(),
  };
  return { input, padIndex };
}

/** Land uses that count as "green" for density purposes. */
export const NON_BUILT_USES: readonly LandUse[] = [LandUse.Water, LandUse.Beach, LandUse.Park, LandUse.Forest, LandUse.Cemetery, LandUse.Landmark, LandUse.Road, LandUse.Airport];
