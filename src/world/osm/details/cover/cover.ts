/**
 * Ground cover of the slice (worker side): OSM green areas, bare soil, park paths and parking lots as signed
 * distance channels of one RGBA8 raster (1 m texels over the build rect), plus the treatment of the leftover back
 * lots and courtyards (small gardens, trodden soil, gravel), and the draped mesh that carries the cover material.
 *
 * Every channel is intersected with the street raster so cover never paints over carriageways, sidewalks or granite
 * plazas. The mesh reuses the shared GroundGrid triangles (exactly the streets ground surface) wherever any channel
 * is present; the cover material (cover/material.ts) discards the rest.
 */
import type { OsmArea, OsmBuilding, OsmData, OsmRoad } from '../../data';
import { MeshBuf } from '../../shared/buffers';
import { bounds, hash, pointInRing } from '../../shared/geometry';
import { GROUND_STEP } from '../../shared/ground';
import type { StreetSurface } from '../../shared/street-surface';
import type { CoverRaster } from '../protocol';
import { COVER_RANGE, RasterGrid, buildingRaster, decodeSdf, encodeSdf, stampLine, stampPolygon } from '../raster';

/** RGBA channels of the cover raster. */
export const CoverChannel = {
  /** Lawns, parks, gardens, woods, pitches. */
  Green: 0,
  /** Trodden soil, construction sites, sand. */
  Soil: 1,
  /** Paths: gravel / stone paving through parks and lots. */
  Path: 2,
  /** Asphalt parking lots. */
  Parking: 3,
} as const;

const GREEN_KINDS = new Set([
  'leisure=park',
  'leisure=garden',
  'landuse=grass',
  'natural=grass',
  'landuse=forest',
  'natural=wood',
  'natural=scrub',
  'landuse=cemetery',
  'landuse=village_green',
  'landuse=meadow',
  'leisure=pitch',
  'leisure=playground',
]);
const SOIL_KINDS = new Set(['landuse=construction', 'landuse=brownfield']);
const SOIL_SURFACES = new Set(['dirt', 'sand', 'clay', 'ground', 'earth', 'gravel', 'fine_gravel', 'compacted', 'unpaved']);
const PATH_KINDS = new Set(['footway', 'path', 'steps', 'cycleway', 'bridleway', 'track']);

/**
 * Lot treatments (land not covered by buildings, streets or OSM areas):
 * - Bare: tiny gaps and light wells, left to the streets ground,
 * - Garden: enclosed courtyard with a lawn, soil beds along the walls and a tree or two (trees/placement.ts),
 * - Yard: enclosed courtyard of trodden earth, weeds along the walls,
 * - Paved: stone-paved courtyard,
 * - Plaza: open paved space along streets and the waterfront (unmapped squares, quays, forecourts); the crowd wanders
 *   across it (crowd/graph.ts),
 * - Vacant: open lot of compacted earth and gravel, weeds along its rim and in scattered tufts.
 */
export const LotStyle = { Bare: 0, Garden: 1, Yard: 2, Paved: 3, Plaza: 4, Vacant: 5 } as const;
export type LotStyle = (typeof LotStyle)[keyof typeof LotStyle];

/**
 * What a lot belongs to (lotHints()): the buildings on its rim and the OSM landuse around it.
 * - Grounds: consulates, palaces, churches, hospitals, museums and public buildings, military / religious landuse:
 *   walled gardens with old trees (the Swedish and Italian consulates, the Mevlevihane off İstiklal),
 * - School: schoolyards, Mosque: mosque courtyards (paved, a plane tree or two),
 * - Commercial: commercial / retail landuse (the Tahtakale bazaar blocks: paved), Industrial: concrete yards,
 * - Rail: railway land (gravel).
 */
export const LotHint = { None: 0, Grounds: 1, School: 2, Mosque: 3, Commercial: 4, Industrial: 5, Rail: 6 } as const;
export type LotHint = (typeof LotHint)[keyof typeof LotHint];

export interface LotRegion {
  style: LotStyle;
  hint: LotHint;
  /** Area (m²), share of the rim that touches buildings, centroid. */
  area: number;
  enclosure: number;
  cx: number;
  cz: number;
  /** Texel indices of the region (row-major into the cover grid). */
  cells: Int32Array;
}

export interface CoverBuild {
  grid: RasterGrid;
  rgba: Uint8Array;
  /** Distance to the nearest building (0.1 m units, capped). */
  buildingDist: Uint16Array;
  lots: LotRegion[];
  /** Lot index per texel (-1 outside lots). */
  lotOf: Int32Array;
}

export function isGreenArea(a: OsmArea): boolean {
  if (a.kind === 'leisure=pitch' && a.surface && SOIL_SURFACES.has(a.surface)) {
    return false;
  }
  return GREEN_KINDS.has(a.kind);
}

function isSoilArea(a: OsmArea): boolean {
  return SOIL_KINDS.has(a.kind) || (a.kind === 'leisure=pitch' && !!a.surface && SOIL_SURFACES.has(a.surface));
}

function isParking(a: OsmArea): boolean {
  return a.kind === 'amenity=parking' && (a.parking === undefined || a.parking === 'surface') && (a.layer ?? 0) === 0;
}

export function isPathRoad(r: OsmRoad): boolean {
  return PATH_KINDS.has(r.kind) && !r.tunnel && !r.bridge && r.footway !== 'sidewalk' && r.footway !== 'crossing';
}

/** Two-pass 3-4 chamfer distance (0.1 m units) to the nearest set texel of `mask`. */
function distanceField(grid: RasterGrid, mask: Uint8Array): Uint16Array {
  const { w, h } = grid;
  const INF = 60000;
  const d = new Uint16Array(w * h);
  for (let k = 0; k < d.length; k++) {
    d[k] = mask[k] ? 0 : INF;
  }
  const a = Math.round(10 * grid.px);
  const b = Math.round(14.14 * grid.px);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = j * w + i;
      let v = d[k];
      if (i > 0) v = Math.min(v, d[k - 1] + a);
      if (j > 0) {
        v = Math.min(v, d[k - w] + a);
        if (i > 0) v = Math.min(v, d[k - w - 1] + b);
        if (i < w - 1) v = Math.min(v, d[k - w + 1] + b);
      }
      d[k] = v;
    }
  }
  for (let j = h - 1; j >= 0; j--) {
    for (let i = w - 1; i >= 0; i--) {
      const k = j * w + i;
      let v = d[k];
      if (i < w - 1) v = Math.min(v, d[k + 1] + a);
      if (j < h - 1) {
        v = Math.min(v, d[k + w] + a);
        if (i < w - 1) v = Math.min(v, d[k + w + 1] + b);
        if (i > 0) v = Math.min(v, d[k + w - 1] + b);
      }
      d[k] = v;
    }
  }
  return d;
}

/** Smooth value noise in [0, 1] (worker side twin of the shader's vnoise2). */
export function vnoise(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const h = (a: number, b: number): number => hash(a * 157.1 + b * 311.7);
  const a = h(ix, iz);
  const b = h(ix + 1, iz);
  const c = h(ix, iz + 1);
  const e = h(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + e) * ux * uz;
}

/**
 * `buildings`: OSM outlines plus the buildings layer's infill parcels; `pads`: landmark / mosque pads (x, z, radius);
 * `poi`: shop / café density (crowd/graph.ts poiDensity).
 */
export function buildCover(
  data: Pick<OsmData, 'areas' | 'roads' | 'points'>,
  buildings: readonly OsmBuilding[],
  surface: StreetSurface,
  pads: readonly number[],
  poi: (x: number, z: number) => number,
): CoverBuild {
  const sr = surface.raster;
  const grid = new RasterGrid({ minX: sr.minX, minZ: sr.minZ, maxX: sr.minX + sr.w * sr.px, maxZ: sr.minZ + sr.h * sr.px }, 1);
  const { w, h } = grid;
  const rgba = new Uint8Array(w * h * 4);
  for (const a of data.areas) {
    if ((a.layer ?? 0) < 0) {
      continue;
    }
    if (isGreenArea(a)) {
      stampPolygon(grid, rgba, CoverChannel.Green, a.ring, a.holes, a.kind === 'landuse=grass' ? 0.3 : 0);
    } else if (isSoilArea(a)) {
      stampPolygon(grid, rgba, CoverChannel.Soil, a.ring, a.holes, 0.2);
    } else if (isParking(a)) {
      stampPolygon(grid, rgba, CoverChannel.Parking, a.ring, a.holes, 0.2);
    }
  }
  for (const r of data.roads) {
    if (isPathRoad(r)) {
      stampLine(grid, rgba, CoverChannel.Path, r.pts, Math.min(2.5, Math.max(0.8, r.width / 2)));
    }
  }
  const { mask, ids } = buildingRaster(grid, buildings);
  const buildingDist = distanceField(grid, mask);
  const reserved = reservedMask(grid, pads);

  // Keep cover off carriageways, sidewalks and plazas (street raster), water and landmark pads.
  const geo = surface.geo;
  for (let j = 0; j < h; j++) {
    const z = grid.cz(j);
    for (let i = 0; i < w; i++) {
      const o = (j * w + i) * 4;
      if (rgba[o] === 0 && rgba[o + 1] === 0 && rgba[o + 2] === 0 && rgba[o + 3] === 0) {
        continue;
      }
      const x = grid.cx(i);
      const off = Math.min(streetClearance(surface, x, z), padClearance(pads, x, z));
      const lim = geo.coast(x, z) < 0.5 ? 0 : encodeSdf(off);
      for (let c = 0; c < 4; c++) {
        if (rgba[o + c] > lim) {
          rgba[o + c] = lim;
        }
      }
    }
  }
  const hints = buildingHints(data, buildings, grid, ids);
  const landuse = landuseHints(data.areas);
  const { lots, lotOf } = treatLots(grid, rgba, mask, ids, reserved, pads, buildingDist, surface, poi, (lot, rim) => lotHint(lot, rim, hints, landuse));
  return { grid, rgba, buildingDist, lots, lotOf };
}

const GROUNDS_KINDS = new Set(['government', 'public', 'civic', 'hospital', 'university', 'college', 'church', 'chapel', 'synagogue', 'monastery', 'dormitory', 'embassy', 'palace', 'museum']);
const GROUNDS_AMENITIES = new Set(['public_building', 'townhall', 'library', 'university', 'college', 'hospital', 'clinic', 'courthouse', 'embassy', 'police']);
const GROUNDS_NAME = /konsolos|consulat|embassy|elçili|sarayı|palazzo|palais|palace|köşkü|mevlevihane|hastane|hospital|kilise|church|sinagog|synagog|müzesi|museum/i;
const SCHOOL_NAME = /okulu|lisesi|koleji|\bschool|lycée|liceo|gymnasium/i;

function buildingHint(b: OsmBuilding): LotHint {
  const a = b.amenity ?? '';
  const name = b.name ?? '';
  if (b.kind === 'school' || b.kind === 'kindergarten' || a === 'school' || a === 'kindergarten' || SCHOOL_NAME.test(name)) {
    return LotHint.School;
  }
  if (b.kind === 'mosque' || b.religion === 'muslim' || /cami|mescid/i.test(name)) {
    return LotHint.Mosque;
  }
  if (GROUNDS_KINDS.has(b.kind) || GROUNDS_AMENITIES.has(a) || (a === 'place_of_worship' && b.religion !== 'muslim') || GROUNDS_NAME.test(name)) {
    return LotHint.Grounds;
  }
  return LotHint.None;
}

/** Hint per building (index into `buildings`): its own tags, or those of the institution POI mapped inside it. */
function buildingHints(data: Pick<OsmData, 'points'>, buildings: readonly OsmBuilding[], grid: RasterGrid, ids: Int32Array): Uint8Array {
  const out = new Uint8Array(buildings.length);
  buildings.forEach((b, i) => {
    out[i] = buildingHint(b);
  });
  for (const p of data.points) {
    let hint: LotHint = LotHint.None;
    if (/^amenity=(school|kindergarten|college)$/.test(p.kind)) {
      hint = LotHint.School;
    } else if (/^amenity=(hospital|clinic|townhall|library|courthouse|embassy|university)$|^tourism=museum$|^office=(diplomatic|government)$/.test(p.kind)) {
      hint = LotHint.Grounds;
    }
    if (hint === LotHint.None) {
      continue;
    }
    const k = grid.index(p.x, p.z);
    const id = k < 0 ? -1 : ids[k];
    if (id >= 0 && out[id] === LotHint.None) {
      out[id] = hint;
    }
  }
  return out;
}

interface LanduseHint {
  hint: LotHint;
  ring: number[];
  box: { minX: number; minZ: number; maxX: number; maxZ: number };
}

function landuseHints(areas: readonly OsmArea[]): LanduseHint[] {
  const out: LanduseHint[] = [];
  for (const a of areas) {
    let hint: LotHint = LotHint.None;
    switch (a.kind) {
      case 'landuse=military':
      case 'landuse=religious':
      case 'amenity=hospital':
      case 'amenity=university':
        hint = LotHint.Grounds;
        break;
      case 'amenity=school':
      case 'amenity=kindergarten':
        hint = LotHint.School;
        break;
      case 'landuse=commercial':
      case 'landuse=retail':
        hint = LotHint.Commercial;
        break;
      case 'landuse=industrial':
        hint = LotHint.Industrial;
        break;
      case 'landuse=railway':
        hint = LotHint.Rail;
        break;
    }
    if (hint !== LotHint.None) {
      out.push({ hint, ring: a.ring, box: bounds(a.ring) });
    }
  }
  // Smallest first: a school inside a commercial district wins.
  return out.sort((p, q) => (p.box.maxX - p.box.minX) * (p.box.maxZ - p.box.minZ) - (q.box.maxX - q.box.minX) * (q.box.maxZ - q.box.minZ));
}

/** Rim contacts per building index (texels of the lot rim against that building). */
type RimContacts = Map<number, number>;

/**
 * Hint of a lot: the institution on its rim (at least 5 m of contact, School > Mosque > Grounds), otherwise the
 * smallest hinted landuse around its centroid.
 */
function lotHint(lot: { cx: number; cz: number }, rim: RimContacts, hints: Uint8Array, landuse: readonly LanduseHint[]): LotHint {
  let best: LotHint = LotHint.None;
  const rank = (h: LotHint): number => (h === LotHint.School ? 3 : h === LotHint.Mosque ? 2 : h === LotHint.Grounds ? 1 : 0);
  for (const [id, n] of rim) {
    const h = hints[id] as LotHint;
    if (n >= 5 && rank(h) > rank(best)) {
      best = h;
    }
  }
  if (best !== LotHint.None) {
    return best;
  }
  for (const l of landuse) {
    const b = l.box;
    if (lot.cx >= b.minX && lot.cx <= b.maxX && lot.cz >= b.minZ && lot.cz <= b.maxZ && pointInRing(l.ring, lot.cx, lot.cz)) {
      return l.hint;
    }
  }
  return LotHint.None;
}

/** Lot style from size, enclosure, hint, waterfront and shop density (see LotStyle); `r` is the lot's random. */
function lotStyle(area: number, enclosure: number, hint: LotHint, coast: number, poi: number, r: number): LotStyle {
  if (area < 25) {
    return LotStyle.Bare;
  }
  switch (hint) {
    case LotHint.Grounds:
      return area < 60 ? LotStyle.Paved : LotStyle.Garden;
    case LotHint.School:
    case LotHint.Mosque:
    case LotHint.Industrial:
      return LotStyle.Paved;
    case LotHint.Commercial:
      return area >= 150 && enclosure < 0.5 ? LotStyle.Plaza : LotStyle.Paved;
    case LotHint.Rail:
      return LotStyle.Vacant;
  }
  if (enclosure > 0.5) {
    // Inner-block courtyards and back gardens.
    if (area < 2500) {
      return r < 0.45 ? LotStyle.Garden : r < 0.72 ? LotStyle.Yard : LotStyle.Paved;
    }
    return r < 0.6 ? LotStyle.Garden : r < 0.85 ? LotStyle.Paved : LotStyle.Yard;
  }
  if (area < 150) {
    return LotStyle.Paved;
  }
  if (coast < 140 || poi > 0.35) {
    return LotStyle.Plaza;
  }
  // Open land along quieter streets: gardens and forecourts, the odd paved or vacant lot.
  return r < 0.4 ? LotStyle.Garden : r < 0.65 ? LotStyle.Plaza : r < 0.88 ? LotStyle.Paved : LotStyle.Vacant;
}

/** Signed distance (m) to the nearest landmark / mosque pad circle ([x, z, r] triples): negative inside one. */
function padClearance(pads: readonly number[], x: number, z: number): number {
  let d = COVER_RANGE;
  for (let p = 0; p < pads.length; p += 3) {
    const dx = Math.abs(x - pads[p]);
    const dz = Math.abs(z - pads[p + 1]);
    const r = pads[p + 2];
    if (dx < r + d && dz < r + d) {
      d = Math.min(d, Math.hypot(dx, dz) - r);
    }
  }
  return d;
}

/** One byte per texel: 1 on landmark / mosque pads (GeoSampler.reserved as a raster). */
function reservedMask(grid: RasterGrid, pads: readonly number[]): Uint8Array {
  const out = new Uint8Array(grid.w * grid.h);
  for (let p = 0; p < pads.length; p += 3) {
    const r = pads[p + 2];
    const ring: number[] = [];
    for (let a = 0; a < 24; a++) {
      ring.push(pads[p] + Math.cos((a / 24) * Math.PI * 2) * r, pads[p + 1] + Math.sin((a / 24) * Math.PI * 2) * r);
    }
    grid.fill([ring], (i, j) => {
      out[j * grid.w + i] = 1;
    });
  }
  return out;
}

/** Lot texels stay LOT_COAST m from the water and off texels where other cover reaches LOT_MAX_OTHER (encoded). */
const LOT_COAST = 3;
const LOT_MAX_OTHER = 110;
const LOT_OTHER_COVER = -decodeSdf(LOT_MAX_OTHER);

/** Signed clearance (m) from the street surfaces: negative on carriageways, plazas and sidewalks. */
export function streetClearance(surface: StreetSurface, x: number, z: number): number {
  // Bilinear sidewalk width (as the ground shader draws it): the per-texel value jumps where two streets meet and cut
  // the cover along a 1 m staircase.
  const d = surface.distance(x, z);
  return d - surface.sidewalkWidthSmooth(x, z) - 0.15;
}

/**
 * Back lots and courtyards: connected land texels outside buildings, streets and OSM cover, classified by size,
 * enclosure (share of the rim against buildings), the institution or landuse they belong to (LotHint), waterfront
 * and shop density (see lotStyle()), then painted into the cover channels with soft, noise-shaped edges.
 */
function treatLots(
  grid: RasterGrid,
  rgba: Uint8Array,
  mask: Uint8Array,
  ids: Int32Array,
  reserved: Uint8Array,
  pads: readonly number[],
  bdist: Uint16Array,
  surface: StreetSurface,
  poi: (x: number, z: number) => number,
  hintOf: (lot: { cx: number; cz: number }, rim: RimContacts) => LotHint,
): { lots: LotRegion[]; lotOf: Int32Array } {
  const { w, h } = grid;
  const n = w * h;
  const free = new Uint8Array(n);
  const geo = surface.geo;
  for (let j = 0; j < h; j++) {
    const z = grid.cz(j);
    for (let i = 0; i < w; i++) {
      const k = j * w + i;
      const o = k * 4;
      if (mask[k] || reserved[k] || rgba[o] > LOT_MAX_OTHER || rgba[o + 1] > LOT_MAX_OTHER || rgba[o + 2] > LOT_MAX_OTHER || rgba[o + 3] > LOT_MAX_OTHER) {
        continue;
      }
      const x = grid.cx(i);
      if (streetClearance(surface, x, z) < 0.6 || geo.coast(x, z) < LOT_COAST) {
        continue;
      }
      free[k] = 1;
    }
  }
  const label = new Int32Array(n).fill(-1);
  const queue = new Int32Array(n);
  const lots: LotRegion[] = [];
  for (let s = 0; s < n; s++) {
    if (!free[s] || label[s] >= 0) {
      continue;
    }
    let head = 0;
    let tail = 0;
    queue[tail++] = s;
    label[s] = lots.length;
    let rim = 0;
    let rimBuilding = 0;
    const contacts: RimContacts = new Map();
    let sx = 0;
    let sz = 0;
    while (head < tail) {
      const k = queue[head++];
      const i = k % w;
      const j = (k - i) / w;
      sx += i;
      sz += j;
      const nb = [i > 0 ? k - 1 : -1, i < w - 1 ? k + 1 : -1, j > 0 ? k - w : -1, j < h - 1 ? k + w : -1];
      let edge = false;
      let byBuilding = -1;
      for (const q of nb) {
        if (q < 0) {
          edge = true;
          continue;
        }
        if (free[q]) {
          if (label[q] < 0) {
            label[q] = lots.length;
            queue[tail++] = q;
          }
        } else {
          edge = true;
          if (mask[q]) {
            byBuilding = ids[q];
          }
        }
      }
      if (byBuilding >= 0) {
        contacts.set(byBuilding, (contacts.get(byBuilding) ?? 0) + 1);
      }
      if (edge) {
        rim++;
        if (byBuilding >= 0) {
          rimBuilding++;
        }
      }
    }
    const area = tail * grid.px * grid.px;
    const cells = queue.slice(0, tail);
    const cx = grid.cx(sx / tail);
    const cz = grid.cz(sz / tail);
    const enclosure = rim > 0 ? rimBuilding / rim : 0;
    const r = hash(cx * 0.013 + cz * 0.029);
    const hint = area < 25 ? LotHint.None : hintOf({ cx, cz }, contacts);
    const style = lotStyle(area, enclosure, hint, geo.coast(cx, cz), poi(cx, cz), r);
    lots.push({ style, hint, area, enclosure, cx, cz, cells });
  }
  for (const lot of lots) {
    if (lot.style !== LotStyle.Bare) {
      paintLot(grid, rgba, bdist, surface, pads, lot);
    }
  }
  return { lots, lotOf: label };
}

/** Paints one lot: SDF-like values (m) are min-combined edge insets and noise fields, encoded like the areas. */
function paintLot(grid: RasterGrid, rgba: Uint8Array, bdist: Uint16Array, surface: StreetSurface, pads: readonly number[], lot: LotRegion): void {
  const { w } = grid;
  const seed = hash(lot.cx * 0.7 + lot.cz * 1.3) * 100;
  const put = (o: number, c: number, d: number): void => {
    const v = encodeSdf(d);
    if (v > rgba[o + c]) {
      rgba[o + c] = v;
    }
  };
  for (let q = 0; q < lot.cells.length; q++) {
    const k = lot.cells[q];
    const i = k % w;
    const j = (k - i) / w;
    const x = grid.cx(i);
    const z = grid.cz(j);
    const wall = bdist[k] / 10;
    const street = streetClearance(surface, x, z);
    const o = k * 4;
    // Every border of the lot is a smooth distance, not only walls and streets: the lot mask stops LOT_OTHER_COVER m
    // off other cover and LOT_COAST m from the water, and a painted value that stays high up to such a mask edge
    // shows the 1 m texel staircase of the mask.
    const other = decodeSdf(Math.max(rgba[o], rgba[o + 1], rgba[o + 2], rgba[o + 3]));
    const edge = Math.min(wall - 0.5, street - 0.7, -other - LOT_OTHER_COVER, surface.geo.coast(x, z) - LOT_COAST, padClearance(pads, x, z));
    const n1 = vnoise(x * 0.09 + seed, z * 0.09) * 0.65 + vnoise(x * 0.31, z * 0.31 + seed) * 0.35;
    const n2 = vnoise(x * 0.55 + seed * 3, z * 0.55);
    switch (lot.style) {
      case LotStyle.Garden:
        // Lawn inset from the walls with a few bare holes, a soil bed along the walls.
        put(o, CoverChannel.Green, Math.min(edge - 1.1, (n1 - 0.18) * 7));
        put(o, CoverChannel.Soil, Math.min(edge + 0.5, 2.4 - edge));
        break;
      case LotStyle.Yard:
        // Trodden earth, weeds hugging the walls.
        put(o, CoverChannel.Soil, edge + 0.4);
        put(o, CoverChannel.Green, Math.min(edge + 0.3, 1.6 - wall + (n1 - 0.45) * 3, (n2 - 0.35) * 6));
        break;
      case LotStyle.Paved:
      case LotStyle.Plaza:
        put(o, CoverChannel.Path, edge + 0.6);
        break;
      case LotStyle.Vacant: {
        // Compacted earth and gravel; weeds along the rim and in small tufts.
        put(o, CoverChannel.Soil, edge + 0.5);
        const rim = Math.min(edge + 0.3, 2.8 - edge + (n1 - 0.5) * 4, (n2 - 0.3) * 5);
        const tuft = (vnoise(x * 0.8 + seed, z * 0.8 - seed) - 0.8) * 12;
        put(o, CoverChannel.Green, Math.max(rim, Math.min(edge - 1, tuft)));
        break;
      }
    }
  }
}

/** Draped mesh over every GroundGrid cell that has cover (same triangles and heights as the streets ground mesh). */
export function buildCoverMesh(cover: CoverBuild, surface: StreetSurface): MeshBuf {
  const { ground } = surface;
  const { grid, rgba } = cover;
  const mesh = new MeshBuf({ position: 3, normal: 3 });
  const n = ground.nx;
  const ids = new Int32Array(ground.nx * ground.nz).fill(-1);
  const normal: [number, number, number] = [0, 1, 0];
  // Same vertex heights as the off-street cells of the streets ground mesh (terrain + quay raise + kerb lift): the
  // plain terrain grid lies up to ~1 m under the raised quays, where the ground hid the cover along its 5 m triangles.
  const quay = surface.quayGridValues();
  const lift = surface.liftGridValues();
  const vid = (i: number, j: number): number => {
    const k = j * n + i;
    if (ids[k] < 0) {
      ground.normalAt(i, j, normal);
      ids[k] = mesh.vertex(ground.x0 + i * GROUND_STEP, ground.y[k] + quay[k] + lift[k], ground.z0 + j * GROUND_STEP, normal[0], normal[1], normal[2]);
    }
    return ids[k];
  };
  const threshold = 128 - Math.round(128 / COVER_RANGE);
  for (let j = 0; j < ground.nz - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const x0 = ground.x0 + i * GROUND_STEP;
      const z0 = ground.z0 + j * GROUND_STEP;
      let any = false;
      for (let dz = 0; dz <= GROUND_STEP && !any; dz += 1) {
        for (let dx = 0; dx <= GROUND_STEP && !any; dx += 1) {
          const k = grid.index(x0 + dx, z0 + dz);
          if (k < 0) {
            continue;
          }
          const o = k * 4;
          any = rgba[o] > threshold || rgba[o + 1] > threshold || rgba[o + 2] > threshold || rgba[o + 3] > threshold;
        }
      }
      if (!any) {
        continue;
      }
      const a = vid(i, j);
      const b = vid(i + 1, j);
      const c = vid(i, j + 1);
      const d = vid(i + 1, j + 1);
      mesh.tri(a, c, b);
      mesh.tri(b, c, d);
    }
  }
  return mesh;
}

export function coverRaster(cover: CoverBuild): CoverRaster {
  return { rgba: cover.rgba, w: cover.grid.w, h: cover.grid.h, minX: cover.grid.minX, minZ: cover.grid.minZ, px: cover.grid.px };
}
