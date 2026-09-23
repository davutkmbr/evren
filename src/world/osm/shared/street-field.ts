/**
 * Street classification and the street raster (built once per load in shared/foundation.worker.ts): signed-distance
 * fields of all carriageways and footpaths (junctions merge naturally, no overlapping ribbons), the distance to the
 * nearest building, and per-texel ids (street surface and flags, ground cover of OSM areas, path surface), encoded
 * as StreetRaster for the ground shader and for StreetSurface queries in every layer.
 *
 * Owned by the streets layer (it decides widths, surfaces, sidewalks and kerbs); other layers only read the result
 * through shared/street-surface.ts.
 */
import type { WorldBounds } from '../../../core/contracts';
import type { OsmArea, OsmData, OsmRoad } from '../data';
import { BoxGrid, ringArea, segDist } from './geometry';
import { MASK_RANGE, SIDEWALK_MAX, type StreetRaster } from './protocol';

/** Surface classes of carriageways and paths (StreetRaster ids R & SURF_MASK, ids B). */
export const Surf = {
  Asphalt: 0,
  /** Sett / arnavut kaldırımı (Galata and Cihangir side streets). */
  Cobble: 1,
  /** Granite slabs (İstiklal, squares). */
  Granite: 2,
  /** Concrete paving stones / interlocking pavers. */
  Pavers: 3,
  Concrete: 4,
} as const;

/** Ground cover of OSM areas outside carriageways (StreetRaster ids G). */
export const Ground = {
  /** Anything unmapped: back lots, courtyards. */
  Lot: 0,
  /** Squares and pedestrian areas (Eminönü, Galataport). */
  Plaza: 1,
  Parking: 2,
  /** Surface tram platforms, raised by PLATFORM_HEIGHT (StreetSurface.heightAt, streets masonry). */
  Platform: 3,
  Grass: 4,
  Pitch: 5,
  Construction: 6,
  /** Piers and ferry terminals. */
  Quay: 7,
  /** Mosque / church courtyards. */
  Worship: 8,
} as const;

/** Bits of StreetRaster ids R. */
export const SURF_MASK = 7;
/** The winning street is pedestrian-only (no vehicles). */
export const FLAG_PEDESTRIAN = 8;
/** The winning street has kerbs (raised sidewalk / block ground next to it). */
export const FLAG_KERBED = 16;
/** Inside the bed of an embedded tram track. */
export const FLAG_TRAM = 32;
/** On (or right next to) the median strip of a dual carriageway: the strip itself is streets masonry. */
export const FLAG_MEDIAN = 64;
/** Gaps between the two carriageways of a dual carriageway up to this width (m) are median strips. */
export const MEDIAN_MAX = 6;

/** Raster texel size (m). */
export const STREET_RASTER_PX = 1;
/** Range (m) of the path distance field (StreetRaster A). */
export const PATH_RANGE = 4;
/** Range (m) of the building distance field (StreetRaster G). */
export const BUILDING_RANGE = 8;

export interface Street {
  /** Index into OsmData.roads. */
  road: number;
  pts: number[];
  hw: number;
  surf: number;
  /** Widest sidewalk of the two sides (m). */
  sidewalk: number;
  /** Sidewalk widths left / right of the way direction (m). */
  walkL: number;
  walkR: number;
  kerbed: boolean;
  pedestrian: boolean;
  rank: number;
  kind: string;
  oneway: boolean;
  lanes: number;
  name?: string;
}

/** Footways, paths and steps drawn as paved ground (not carriageways). */
export interface Path {
  road: number;
  pts: number[];
  hw: number;
  surf: number;
  kind: string;
  /** step_count of highway=steps. */
  stepCount?: number;
}

/** highway=* classes that get a carriageway in the raster. */
export const CARRIAGEWAY_KINDS = new Set([
  'motorway',
  'trunk',
  'primary',
  'secondary',
  'tertiary',
  'motorway_link',
  'trunk_link',
  'primary_link',
  'secondary_link',
  'tertiary_link',
  'unclassified',
  'residential',
  'living_street',
  'pedestrian',
  'service',
]);

/** highway=* classes drawn as paved paths. */
export const PATH_KINDS = new Set(['footway', 'path', 'cycleway', 'steps', 'bridleway', 'track']);

const COBBLE_SURFACES = new Set(['sett', 'cobblestone', 'unhewn_cobblestone', 'cobblestone:flattened']);
const ASPHALT_SURFACES = new Set(['asphalt', 'paved', 'chipseal']);
const CONCRETE_SURFACES = new Set(['concrete', 'concrete:plates', 'concrete:lanes', 'fine_gravel', 'compacted', 'wood', 'metal']);
const PAVER_SURFACES = new Set(['paving_stones', 'paving_stones:30', 'bricks', 'grass_paver', 'interlock']);
const SLAB_SURFACES = new Set(['tiles', 'stone', 'granite', 'marble']);
const MINOR = new Set(['residential', 'living_street', 'pedestrian', 'unclassified']);
const NO_KERB_KINDS = new Set(['pedestrian', 'living_street', 'service', 'track']);
const RANK: Record<string, number> = { trunk: 3, primary: 3, primary_link: 2.5, secondary: 2.5, secondary_link: 2, tertiary: 2, tertiary_link: 1.5 };
const WALK_WIDTH: Record<string, number> = {
  trunk: 3.2,
  primary: 3.2,
  secondary: 2.8,
  tertiary: 2.4,
  primary_link: 1.6,
  secondary_link: 1.6,
  tertiary_link: 1.6,
  trunk_link: 1.6,
  unclassified: 1.8,
  residential: 1.8,
};

function surfaceOf(r: OsmRoad): number {
  const s = r.surface;
  if ((r.name && /stiklal/i.test(r.name)) || (r.kind === 'pedestrian' && r.width >= 8 && (!s || PAVER_SURFACES.has(s) || SLAB_SURFACES.has(s)))) {
    return Surf.Granite;
  }
  if (s) {
    if (COBBLE_SURFACES.has(s)) {
      return Surf.Cobble;
    }
    if (PAVER_SURFACES.has(s)) {
      return Surf.Pavers;
    }
    if (SLAB_SURFACES.has(s)) {
      return Surf.Granite;
    }
    if (CONCRETE_SURFACES.has(s)) {
      return Surf.Concrete;
    }
    if (ASPHALT_SURFACES.has(s)) {
      return Surf.Asphalt;
    }
  }
  if (r.kind === 'pedestrian' || r.kind === 'living_street') {
    return Surf.Pavers;
  }
  return MINOR.has(r.kind) && r.width <= 6 ? Surf.Cobble : Surf.Asphalt;
}

function pathSurfaceOf(r: OsmRoad): number {
  const s = r.surface;
  if (s) {
    if (COBBLE_SURFACES.has(s)) {
      return Surf.Cobble;
    }
    if (ASPHALT_SURFACES.has(s)) {
      return Surf.Asphalt;
    }
    if (SLAB_SURFACES.has(s)) {
      return Surf.Granite;
    }
    if (CONCRETE_SURFACES.has(s)) {
      return Surf.Concrete;
    }
  }
  return r.kind === 'steps' ? Surf.Granite : Surf.Pavers;
}

/** Ground-level carriageways of the data (bridges and tunnels excluded), with surface class, sidewalks and kerbs. */
export function classifyStreets(roads: readonly OsmRoad[]): Street[] {
  const out: Street[] = [];
  roads.forEach((r, road) => {
    if (!CARRIAGEWAY_KINDS.has(r.kind) || r.bridge || r.tunnel || r.pts.length < 4) {
      return;
    }
    const surf = surfaceOf(r);
    const major = RANK[r.kind] ?? 0;
    const pedestrian = r.kind === 'pedestrian';
    const vehicular = !NO_KERB_KINDS.has(r.kind);
    const tagged = !!r.sidewalk && r.sidewalk !== 'no';
    // Kerbs on vehicular asphalt / concrete streets, and on paved streets that are tagged with sidewalks.
    const kerbed = vehicular && (surf === Surf.Asphalt || surf === Surf.Concrete || (surf === Surf.Pavers && tagged));
    let walkL = 0;
    let walkR = 0;
    if (kerbed) {
      const def = surf === Surf.Asphalt || major > 0 ? (WALK_WIDTH[r.kind] ?? 1.5) : 1.3;
      const side = r.sidewalk ?? 'both';
      walkL = side === 'both' || side === 'separate' || side === 'left' ? def : 0;
      walkR = side === 'both' || side === 'separate' || side === 'right' ? def : 0;
    }
    const rank = surf === Surf.Granite ? 2.5 : major + (surf === Surf.Asphalt ? 1 : 0.5) + (r.kind === 'service' ? -0.8 : 0);
    out.push({
      road,
      pts: r.pts,
      hw: (r.kind === 'service' ? Math.min(r.width, 4.5) : r.width) / 2,
      surf,
      sidewalk: Math.max(walkL, walkR),
      walkL,
      walkR,
      kerbed,
      pedestrian,
      rank,
      kind: r.kind,
      oneway: !!r.oneway,
      lanes: r.lanes ?? 0,
      name: r.name,
    });
  });
  return out;
}

/** Ground-level footways, paths and steps (crossing, traffic island and underground footways excluded). */
export function classifyPaths(roads: readonly OsmRoad[]): Path[] {
  const out: Path[] = [];
  roads.forEach((r, road) => {
    if (!PATH_KINDS.has(r.kind) || r.bridge || r.tunnel || (r.layer ?? 0) < 0 || r.pts.length < 4 || r.footway === 'crossing' || r.footway === 'traffic_island') {
      return;
    }
    out.push({ road, pts: r.pts, hw: Math.max(0.6, Math.min(r.width, 6) / 2), surf: pathSurfaceOf(r), kind: r.kind, stepCount: r.stepCount });
  });
  return out;
}

/** Ground cover class of an OSM area, or -1 when the area does not paint the ground. */
export function groundOf(a: OsmArea): number {
  switch (a.kind) {
    case 'amenity=parking':
      return a.parking === 'underground' || a.parking === 'multi-storey' || a.parking === 'rooftop' ? -1 : Ground.Parking;
    case 'amenity=bus_station':
    case 'amenity=taxi':
      return Ground.Parking;
    case 'highway=pedestrian':
    case 'place=square':
    case 'landuse=harbour':
    case 'leisure=playground':
    case 'amenity=fountain':
      return Ground.Plaza;
    case 'landuse=commercial':
      return a.name && /galataport/i.test(a.name) ? Ground.Plaza : -1;
    case 'railway=platform':
      return (a.layer ?? 0) < 0 ? -1 : Ground.Platform;
    case 'man_made=pier':
    case 'amenity=ferry_terminal':
      return Ground.Quay;
    case 'leisure=pitch':
      return a.surface === 'asphalt' || a.surface === 'concrete' ? Ground.Plaza : Ground.Pitch;
    case 'landuse=grass':
    case 'natural=grass':
    case 'leisure=garden':
    case 'leisure=park':
    case 'landuse=forest':
    case 'natural=wood':
    case 'natural=scrub':
    case 'landuse=cemetery':
    case 'landuse=village_green':
    case 'landuse=meadow':
      return Ground.Grass;
    case 'landuse=construction':
      return Ground.Construction;
    case 'landuse=religious':
      return Ground.Worship;
    default:
      return -1;
  }
}

/** Surface tram tracks embedded in the street (bridge and tunnel sections are left to their structures). */
export function streetTramTracks(data: Pick<OsmData, 'rails'>): { pts: number[]; gauge: number; routes?: string[] }[] {
  return data.rails.filter((r) => (r.kind === 'tram' || r.kind === 'light_rail') && !r.tunnel && !r.bridge);
}

/** Height (m) of raised tram platforms above the surrounding carriageway (low-floor T1 / T5 stops). */
export const PLATFORM_HEIGHT = 0.3;

/**
 * Surface tram platforms the streets layer raises (railway=platform areas at ground level next to a street tram
 * track); other platforms (mainline, metro, funicular) are indoors, elevated or underground and stay flat paving.
 */
export function tramPlatforms(data: Pick<OsmData, 'areas' | 'rails'>): OsmArea[] {
  const tracks = streetTramTracks(data);
  return data.areas.filter((a) => {
    if (a.kind !== 'railway=platform' || (a.layer ?? 0) < 0 || a.ring.length < 6) {
      return false;
    }
    const n = a.ring.length / 2;
    let cx = 0;
    let cz = 0;
    for (let k = 0; k < n; k++) {
      cx += a.ring[k * 2];
      cz += a.ring[k * 2 + 1];
    }
    cx /= n;
    cz /= n;
    for (const t of tracks) {
      for (let k = 2; k < t.pts.length; k += 2) {
        if (segDist(cx, cz, t.pts[k - 2], t.pts[k - 1], t.pts[k], t.pts[k + 1]) < 12) {
          return true;
        }
      }
    }
    return false;
  });
}

/** Everything the street raster is built from (foundation.ts posts exactly this to the foundation worker). */
export type StreetRasterInput = Pick<OsmData, 'roads' | 'areas' | 'buildings' | 'rails'>;

export function streetRasterInput(data: OsmData): StreetRasterInput {
  return { roads: data.roads, areas: data.areas, buildings: data.buildings, rails: data.rails };
}

/**
 * Byte of a signed distance over ±range, piecewise linear: |d| up to range / 4 takes the inner half of the byte range
 * (3 cm steps for MASK_RANGE), the rest the outer half. Linear around the edge matters: bilinear filtering then
 * reproduces straight kerbs exactly (a non-linear code bends the iso-line between texels into a 1 m zig-zag).
 */
export function encodeSigned(d: number, range: number): number {
  const a = Math.min(1, Math.abs(d) / range);
  const e = a <= 0.25 ? a * 2 : 0.5 + (a - 0.25) * (2 / 3);
  return Math.round((Math.sign(d) * e * 0.5 + 0.5) * 255);
}

/** Inverse of encodeSigned on a (bilinearly filtered) byte value 0..255. */
export function decodeSigned(byte: number, range: number): number {
  const e = (byte / 255) * 2 - 1;
  const a = Math.abs(e);
  return Math.sign(e) * (a <= 0.5 ? a / 2 : 0.25 + (a - 0.5) * 1.5) * range;
}

/**
 * Even-odd scanline fill of `rings` (outer ring + holes) at texel centres; calls `fn(index)` for every texel inside.
 */
export function fillRings(rings: readonly number[][], w: number, h: number, minX: number, minZ: number, px: number, fn: (idx: number) => void): void {
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const r of rings) {
    for (let k = 1; k < r.length; k += 2) {
      z0 = Math.min(z0, r[k]);
      z1 = Math.max(z1, r[k]);
    }
  }
  const j0 = Math.max(0, Math.floor((z0 - minZ) / px - 0.5));
  const j1 = Math.min(h - 1, Math.ceil((z1 - minZ) / px - 0.5));
  const xs: number[] = [];
  for (let j = j0; j <= j1; j++) {
    const z = minZ + (j + 0.5) * px;
    xs.length = 0;
    for (const r of rings) {
      const n = r.length / 2;
      for (let a = 0, b = n - 1; a < n; b = a++) {
        const za = r[a * 2 + 1];
        const zb = r[b * 2 + 1];
        if (za > z !== zb > z) {
          xs.push(r[a * 2] + ((z - za) / (zb - za)) * (r[b * 2] - r[a * 2]));
        }
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil((xs[k] - minX) / px - 0.5));
      const i1 = Math.min(w - 1, Math.floor((xs[k + 1] - minX) / px - 0.5));
      for (let i = i0; i <= i1; i++) {
        fn(j * w + i);
      }
    }
  }
}

/** Median strip of a dual carriageway: centre line (x, z pairs) and the strip width (m) at every vertex. */
export interface Median {
  pts: number[];
  widths: number[];
}

/**
 * Median strips between the two carriageways of dual carriageways (pairs of opposed oneway ways, OSM maps each
 * direction as its own way): every 2 m along a oneway carriageway a ray is cast to its left (right-hand traffic) and
 * the first opposed oneway centre line it meets closes a gap of `o - hw - hw'`. Gaps between 0.2 m and MEDIAN_MAX
 * become medians. The 1 m street raster cannot represent such thin ridges (they alias into saw teeth), so the
 * raster keeps them at carriageway level (FLAG_MEDIAN) and the streets layer builds the strip as geometry.
 */
export function findMedians(streets: readonly Street[]): Median[] {
  const oneway = streets.filter((s) => s.oneway && !s.pedestrian);
  const grid = new BoxGrid(24);
  const segs: number[] = [];
  oneway.forEach((s, si) => {
    const r = s.hw + MEDIAN_MAX + 8;
    for (let k = 2; k < s.pts.length; k += 2) {
      const id = segs.push(s.pts[k - 2], s.pts[k - 1], s.pts[k], s.pts[k + 1], si) / 5 - 1;
      grid.add(id, Math.min(s.pts[k - 2], s.pts[k]) - r, Math.min(s.pts[k - 1], s.pts[k + 1]) - r, Math.max(s.pts[k - 2], s.pts[k]) + r, Math.max(s.pts[k - 1], s.pts[k + 1]) + r);
    }
  });
  const taken = new BoxGrid(4);
  const takenPts: number[] = [];
  const free = (x: number, z: number): boolean => {
    for (const id of taken.at(x, z)) {
      if ((takenPts[id * 2] - x) ** 2 + (takenPts[id * 2 + 1] - z) ** 2 < 1.44) {
        return false;
      }
    }
    return true;
  };
  const claim = (x: number, z: number): void => {
    const id = takenPts.push(x, z) / 2 - 1;
    taken.add(id, x - 1.2, z - 1.2, x + 1.2, z + 1.2);
  };
  const out: Median[] = [];
  oneway.forEach((s, si) => {
    let cur: Median | null = null;
    const flush = (): void => {
      if (cur && cur.pts.length >= 6) {
        out.push(cur);
      }
      cur = null;
    };
    const p = s.pts;
    for (let k = 2; k < p.length; k += 2) {
      const ax = p[k - 2];
      const az = p[k - 1];
      const len = Math.hypot(p[k] - ax, p[k + 1] - az);
      if (len < 1e-3) {
        continue;
      }
      const tx = (p[k] - ax) / len;
      const tz = (p[k + 1] - az) / len;
      // Left of the way (the sweep's right side is (-tz, tx)).
      const lx = tz;
      const lz = -tx;
      for (let f = k === 2 ? 1 : 0; f < len; f += 2) {
        const px = ax + tx * f;
        const pz = az + tz * f;
        let best = Infinity;
        let bestHw = 0;
        for (const id of grid.at(px, pz)) {
          const o = id * 5;
          const ui = segs[o + 4];
          if (ui === si || oneway[ui].road === s.road) {
            continue;
          }
          const sx = segs[o + 2] - segs[o];
          const sz = segs[o + 3] - segs[o + 1];
          const sl = Math.hypot(sx, sz);
          if (sl < 1e-3 || (sx * tx + sz * tz) / sl > -0.85) {
            continue;
          }
          // Ray P + l t against segment A + (B - A) v.
          const det = lx * -sz - lz * -sx;
          if (Math.abs(det) < 1e-6) {
            continue;
          }
          const qx = segs[o] - px;
          const qz = segs[o + 1] - pz;
          const t = (qx * -sz - qz * -sx) / det;
          const v = (lx * qz - lz * qx) / det;
          if (t > 0 && v >= 0 && v <= 1 && t < best) {
            best = t;
            bestHw = oneway[ui].hw;
          }
        }
        const gap = best - s.hw - bestHw;
        const mx = px + lx * (s.hw + gap / 2);
        const mz = pz + lz * (s.hw + gap / 2);
        if (!(gap > 0.2 && gap < MEDIAN_MAX) || !free(mx, mz)) {
          flush();
          continue;
        }
        claim(mx, mz);
        if (!cur) {
          cur = { pts: [], widths: [] };
        }
        (cur as Median).pts.push(mx, mz);
        (cur as Median).widths.push(gap);
      }
    }
    flush();
  });
  return out;
}

/** Kerb corner radius (m) at junctions of two kerbed main roads / other kerbed streets / a kerbed and a kerbless one. */
const FILLET_MAJOR = 7;
const FILLET_MINOR = 3.5;
const FILLET_MIXED = 2;
/** Junction wedges wider than this (rad) are treated as straight continuations (no fillet). */
const FILLET_MAX_ANGLE = (165 * Math.PI) / 180;
const FILLET_MIN_ANGLE = (22 * Math.PI) / 180;

/** Rounded kerb corner: the region between the two kerb lines and the arc (circle centre, radius). */
export interface KerbFillet {
  /** Kerb line intersection (the sharp corner). */
  c0: [number, number];
  /** Tangent points on the kerb lines of the two arms. */
  ta: [number, number];
  tb: [number, number];
  /** Arc centre and radius. */
  c: [number, number];
  r: number;
}

interface Arm {
  ang: number;
  dx: number;
  dz: number;
  hw: number;
  /** Sidewalk width on the counter-clockwise (+) and clockwise (-) side of the arm. */
  walkCcw: number;
  walkCw: number;
  /** Usable straight length (m) from the node. */
  len: number;
  kerbed: boolean;
  major: boolean;
  pedestrian: boolean;
}

/** Arm of street `s` leaving vertex `v` towards `dir` (+1 next, -1 previous): direction of the first ~8 m. */
function armOf(s: Street, v: number, dir: 1 | -1): Arm | null {
  const p = s.pts;
  const n = p.length / 2;
  const x0 = p[v * 2];
  const z0 = p[v * 2 + 1];
  let len = 0;
  let ex = x0;
  let ez = z0;
  for (let k = v + dir; k >= 0 && k < n; k += dir) {
    const l = Math.hypot(p[k * 2] - ex, p[k * 2 + 1] - ez);
    ex = p[k * 2];
    ez = p[k * 2 + 1];
    len += l;
    if (len >= 8) {
      break;
    }
  }
  const l = Math.hypot(ex - x0, ez - z0);
  if (l < 1) {
    return null;
  }
  const dx = (ex - x0) / l;
  const dz = (ez - z0) / l;
  // (-dz, dx) is the counter-clockwise side; along the way (dir +1) that is its right side (street-field sweep()).
  const ccwRight = dir > 0;
  return {
    ang: Math.atan2(dz, dx),
    dx,
    dz,
    hw: s.hw,
    walkCcw: ccwRight ? s.walkR : s.walkL,
    walkCw: ccwRight ? s.walkL : s.walkR,
    len: Math.min(len, 40),
    kerbed: s.kerbed,
    major: (RANK[s.kind] ?? 0) >= 2,
    pedestrian: s.pedestrian,
  };
}

/**
 * Rounded kerb corners at street junctions (OSM nodes shared by several carriageways, data.ts `refs`): for every
 * pair of neighbouring arms, the circle tangent to both kerb lines, with the radius of the street class, shrunk until
 * the sidewalk in front of the corner building keeps its width (`clear(x, z)`: distance to the nearest building).
 */
export function kerbFillets(streets: readonly Street[], roads: readonly OsmRoad[], clear: (x: number, z: number) => number): KerbFillet[] {
  const nodes = new Map<number, { x: number; z: number; arms: Arm[] }>();
  for (const s of streets) {
    const refs = roads[s.road].refs;
    if (!refs) {
      continue;
    }
    const n = s.pts.length / 2;
    for (let k = 0; k < refs.length; k += 2) {
      const v = refs[k];
      let node = nodes.get(refs[k + 1]);
      if (!node) {
        node = { x: s.pts[v * 2], z: s.pts[v * 2 + 1], arms: [] };
        nodes.set(refs[k + 1], node);
      }
      for (const dir of [1, -1] as const) {
        if ((dir > 0 && v < n - 1) || (dir < 0 && v > 0)) {
          const arm = armOf(s, v, dir);
          if (arm) {
            node.arms.push(arm);
          }
        }
      }
    }
  }
  const out: KerbFillet[] = [];
  for (const node of nodes.values()) {
    const arms = node.arms;
    if (arms.length < 2) {
      continue;
    }
    arms.sort((p, q) => p.ang - q.ang);
    for (let i = 0; i < arms.length; i++) {
      const a = arms[i];
      const b = arms[(i + 1) % arms.length];
      let theta = b.ang - a.ang;
      if (theta <= 0) {
        theta += Math.PI * 2;
      }
      if (arms.length === 2 && i === 1 && theta > Math.PI) {
        continue;
      }
      if (theta > FILLET_MAX_ANGLE || theta < FILLET_MIN_ANGLE || a.pedestrian || b.pedestrian || (!a.kerbed && !b.kerbed)) {
        continue;
      }
      // Kerb lines: arm a offset to its counter-clockwise side, arm b to its clockwise side (both face the wedge).
      const pax = node.x - a.dz * a.hw;
      const paz = node.z + a.dx * a.hw;
      const pbx = node.x + b.dz * b.hw;
      const pbz = node.z - b.dx * b.hw;
      // Solve pa + t a = pb + u b.
      const det = a.dx * -b.dz - a.dz * -b.dx;
      if (Math.abs(det) < 1e-4) {
        continue;
      }
      const rx = pbx - pax;
      const rz = pbz - paz;
      const t = (rx * -b.dz - rz * -b.dx) / det;
      const c0x = pax + a.dx * t;
      const c0z = paz + a.dz * t;
      let bx = a.dx + b.dx;
      let bz = a.dz + b.dz;
      const bl = Math.hypot(bx, bz) || 1;
      bx /= bl;
      bz /= bl;
      const half = theta / 2;
      const walk = Math.max(a.walkCcw, b.walkCw);
      let r = a.kerbed && b.kerbed ? (a.major && b.major ? FILLET_MAJOR : FILLET_MINOR) : FILLET_MIXED;
      // The corner must not run past the straight part of either arm (measured from the node).
      const reach = Math.min(a.len, b.len) - 1.5;
      for (; r >= 0.75; r -= 0.5) {
        const tan = r / Math.tan(half);
        const along = tan + Math.hypot(c0x - node.x, c0z - node.z);
        if (along > reach) {
          continue;
        }
        const depth = r / Math.sin(half) - r;
        const mx = c0x + bx * depth;
        const mz = c0z + bz * depth;
        if (clear(mx, mz) >= walk + 0.35 && clear(c0x, c0z) > 0) {
          break;
        }
      }
      if (r < 0.75) {
        continue;
      }
      const tan = r / Math.tan(half);
      const dc = r / Math.sin(half);
      out.push({
        c0: [c0x, c0z],
        ta: [c0x + a.dx * tan, c0z + a.dz * tan],
        tb: [c0x + b.dx * tan, c0z + b.dz * tan],
        c: [c0x + bx * dc, c0z + bz * dc],
        r,
      });
    }
  }
  return out;
}

/** Signed distance (negative inside) from (px, pz) to the triangle a, b, c. */
function sdTriangle(px: number, pz: number, ax: number, az: number, bx: number, bz: number, cx: number, cz: number): number {
  const e0x = bx - ax;
  const e0z = bz - az;
  const e1x = cx - bx;
  const e1z = cz - bz;
  const e2x = ax - cx;
  const e2z = az - cz;
  const v0x = px - ax;
  const v0z = pz - az;
  const v1x = px - bx;
  const v1z = pz - bz;
  const v2x = px - cx;
  const v2z = pz - cz;
  const c0 = Math.max(0, Math.min(1, (v0x * e0x + v0z * e0z) / (e0x * e0x + e0z * e0z || 1)));
  const c1 = Math.max(0, Math.min(1, (v1x * e1x + v1z * e1z) / (e1x * e1x + e1z * e1z || 1)));
  const c2 = Math.max(0, Math.min(1, (v2x * e2x + v2z * e2z) / (e2x * e2x + e2z * e2z || 1)));
  const q0 = (v0x - e0x * c0) ** 2 + (v0z - e0z * c0) ** 2;
  const q1 = (v1x - e1x * c1) ** 2 + (v1z - e1z * c1) ** 2;
  const q2 = (v2x - e2x * c2) ** 2 + (v2z - e2z * c2) ** 2;
  const s = Math.sign(e0x * e2z - e0z * e2x);
  const s0 = s * (v0x * e0z - v0z * e0x);
  const s1 = s * (v1x * e1z - v1z * e1x);
  const s2 = s * (v2x * e2z - v2z * e2x);
  const d = Math.min(q0, q1, q2);
  return -Math.sqrt(d) * Math.sign(Math.min(s0, s1, s2));
}

export class StreetField {
  readonly w: number;
  readonly h: number;
  readonly px = STREET_RASTER_PX;
  readonly minX: number;
  readonly minZ: number;
  /** Signed carriageway distance (m). */
  readonly d: Float32Array;
  private readonly key: Float32Array;
  /** ids R: surface | flags of the winning street. */
  readonly street: Uint8Array;
  /** ids A: direction of the winning street's nearest segment, angle atan2(dz, dx) folded to [0, pi) as 0..255. */
  readonly dir: Uint8Array;
  /** Sidewalk width (m) of the winning street on this texel's side. */
  readonly sw: Float32Array;
  /** Signed path distance (m) and surface of the nearest path. */
  readonly pd: Float32Array;
  readonly pathSurf: Uint8Array;
  /** Ground cover id (Ground). */
  readonly ground: Uint8Array;
  /** Distance (m) to the nearest building outline (0 inside). */
  readonly bd: Float32Array;

  /** Texel centres sit on whole metres of `rect` (rect.minX + i), matching the ground grid vertices. */
  constructor(rect: WorldBounds) {
    this.minX = rect.minX - this.px / 2;
    this.minZ = rect.minZ - this.px / 2;
    this.w = Math.ceil((rect.maxX - rect.minX) / this.px) + 2;
    this.h = Math.ceil((rect.maxZ - rect.minZ) / this.px) + 2;
    const n = this.w * this.h;
    this.d = new Float32Array(n).fill(MASK_RANGE);
    this.key = new Float32Array(n).fill(1e9);
    this.street = new Uint8Array(n);
    this.dir = new Uint8Array(n);
    this.sw = new Float32Array(n);
    this.pd = new Float32Array(n).fill(PATH_RANGE);
    this.pathSurf = new Uint8Array(n).fill(Surf.Pavers);
    this.ground = new Uint8Array(n);
    this.bd = new Float32Array(n).fill(BUILDING_RANGE);
  }

  private range(lo: number, hi: number, min: number, size: number): [number, number] {
    return [Math.max(0, Math.floor((lo - min) / this.px - 0.5)), Math.min(size - 1, Math.ceil((hi - min) / this.px - 0.5))];
  }

  /**
   * Calls fn(idx, distance, side, dir) for texels within `reach` of any segment of `pts` (side > 0: right of the way;
   * dir: the segment's direction byte, see `dir`).
   */
  private sweep(pts: readonly number[], reach: number, fn: (idx: number, dist: number, side: number, dir: number) => void): void {
    for (let k = 2; k < pts.length; k += 2) {
      const ax = pts[k - 2];
      const az = pts[k - 1];
      const bx = pts[k];
      const bz = pts[k + 1];
      const tx = bx - ax;
      const tz = bz - az;
      let ang = Math.atan2(tz, tx);
      if (ang < 0) {
        ang += Math.PI;
      }
      const dir = Math.round((ang / Math.PI) * 256) & 255;
      const [i0, i1] = this.range(Math.min(ax, bx) - reach, Math.max(ax, bx) + reach, this.minX, this.w);
      const [j0, j1] = this.range(Math.min(az, bz) - reach, Math.max(az, bz) + reach, this.minZ, this.h);
      for (let j = j0; j <= j1; j++) {
        const z = this.minZ + (j + 0.5) * this.px;
        for (let i = i0; i <= i1; i++) {
          const x = this.minX + (i + 0.5) * this.px;
          const dist = segDist(x, z, ax, az, bx, bz);
          if (dist < reach) {
            fn(j * this.w + i, dist, tx * (z - az) - tz * (x - ax), dir);
          }
        }
      }
    }
  }

  stampStreet(s: Street): void {
    const flags = s.surf | (s.pedestrian ? FLAG_PEDESTRIAN : 0) | (s.kerbed ? FLAG_KERBED : 0);
    this.sweep(s.pts, s.hw + MASK_RANGE, (idx, dist, side, dir) => {
      const dd = dist - s.hw;
      if (dd < this.d[idx]) {
        this.d[idx] = dd;
      }
      const key = dd < 0 ? dd - s.rank * 100 : dd;
      if (key < this.key[idx]) {
        this.key[idx] = key;
        this.street[idx] = flags | (this.street[idx] & FLAG_TRAM);
        this.sw[idx] = side > 0 ? s.walkR : s.walkL;
        this.dir[idx] = dir;
      }
    });
  }

  /** Adds a rounded kerb corner to the carriageway distance field (texels keep the ids of their winning street). */
  stampFillet(f: KerbFillet): void {
    const xs = [f.c0[0], f.ta[0], f.tb[0]];
    const zs = [f.c0[1], f.ta[1], f.tb[1]];
    const [i0, i1] = this.range(Math.min(...xs) - MASK_RANGE, Math.max(...xs) + MASK_RANGE, this.minX, this.w);
    const [j0, j1] = this.range(Math.min(...zs) - MASK_RANGE, Math.max(...zs) + MASK_RANGE, this.minZ, this.h);
    for (let j = j0; j <= j1; j++) {
      const z = this.minZ + (j + 0.5) * this.px;
      for (let i = i0; i <= i1; i++) {
        const x = this.minX + (i + 0.5) * this.px;
        const tri = sdTriangle(x, z, f.c0[0], f.c0[1], f.ta[0], f.ta[1], f.tb[0], f.tb[1]);
        const df = Math.max(tri, f.r - Math.hypot(x - f.c[0], z - f.c[1]));
        const idx = j * this.w + i;
        if (df < this.d[idx]) {
          this.d[idx] = df;
        }
      }
    }
  }

  /** Flags the texels of a median strip (and 0.75 m of carriageway around it) with FLAG_MEDIAN. */
  stampMedian(m: Median): void {
    const w = Math.max(...m.widths);
    this.sweep(m.pts, w / 2 + 0.75, (idx) => {
      if (this.d[idx] > -0.8) {
        this.street[idx] |= FLAG_MEDIAN;
      }
    });
  }

  /** Distance (m) to the nearest building at (x, z) (nearest texel; valid after buildingDistance()). */
  buildingDistanceAt(x: number, z: number): number {
    const i = Math.min(this.w - 1, Math.max(0, Math.floor((x - this.minX) / this.px)));
    const j = Math.min(this.h - 1, Math.max(0, Math.floor((z - this.minZ) / this.px)));
    return this.bd[j * this.w + i];
  }

  stampPath(p: Path): void {
    this.sweep(p.pts, p.hw + PATH_RANGE, (idx, dist) => {
      const dd = dist - p.hw;
      if (dd < this.pd[idx]) {
        this.pd[idx] = dd;
        this.pathSurf[idx] = p.surf;
      }
    });
  }

  stampTram(pts: readonly number[], gauge: number): void {
    this.sweep(pts, gauge / 2 + 0.55, (idx) => {
      this.street[idx] |= FLAG_TRAM;
    });
  }

  fillGround(rings: readonly number[][], id: number): void {
    fillRings(rings, this.w, this.h, this.minX, this.minZ, this.px, (idx) => {
      this.ground[idx] = id;
    });
  }

  /** Marks building outlines (courtyard holes stay open) and turns the mask into a chamfer distance field (m). */
  buildingDistance(buildings: readonly { ring: number[]; holes?: number[][] }[]): void {
    const { w, h, bd } = this;
    for (const b of buildings) {
      fillRings([b.ring, ...(b.holes ?? [])], w, h, this.minX, this.minZ, this.px, (idx) => {
        bd[idx] = 0;
      });
    }
    const a = this.px;
    const c = this.px * Math.SQRT2;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const k = j * w + i;
        let v = bd[k];
        if (v === 0) {
          continue;
        }
        if (i > 0) {
          v = Math.min(v, bd[k - 1] + a);
        }
        if (j > 0) {
          v = Math.min(v, bd[k - w] + a);
          if (i > 0) {
            v = Math.min(v, bd[k - w - 1] + c);
          }
          if (i < w - 1) {
            v = Math.min(v, bd[k - w + 1] + c);
          }
        }
        bd[k] = v;
      }
    }
    for (let j = h - 1; j >= 0; j--) {
      for (let i = w - 1; i >= 0; i--) {
        const k = j * w + i;
        let v = bd[k];
        if (v === 0) {
          continue;
        }
        if (i < w - 1) {
          v = Math.min(v, bd[k + 1] + a);
        }
        if (j < h - 1) {
          v = Math.min(v, bd[k + w] + a);
          if (i < w - 1) {
            v = Math.min(v, bd[k + w + 1] + c);
          }
          if (i > 0) {
            v = Math.min(v, bd[k + w - 1] + c);
          }
        }
        bd[k] = v;
      }
    }
  }

  toRaster(): StreetRaster {
    const n = this.w * this.h;
    const rgba = new Uint8Array(n * 4);
    const ids = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      rgba[o] = encodeSigned(this.d[i], MASK_RANGE);
      rgba[o + 1] = Math.round(Math.min(1, this.bd[i] / BUILDING_RANGE) * 255);
      rgba[o + 2] = Math.round(Math.min(1, this.sw[i] / SIDEWALK_MAX) * 255);
      rgba[o + 3] = encodeSigned(this.pd[i], PATH_RANGE);
      ids[o] = this.street[i];
      ids[o + 1] = this.ground[i];
      ids[o + 2] = this.pathSurf[i];
      ids[o + 3] = this.dir[i];
    }
    return { rgba, ids, w: this.w, h: this.h, minX: this.minX, minZ: this.minZ, px: this.px };
  }
}

/** Builds the street raster of the data over `rect` (runs in shared/foundation.worker.ts). */
export function buildStreetRaster(data: StreetRasterInput, rect: WorldBounds): StreetRaster {
  const field = new StreetField(rect);
  const raised = new Set(tramPlatforms(data));
  const areas = data.areas
    .map((a) => ({ a, id: a.kind === 'railway=platform' && !raised.has(a) ? Ground.Plaza : groundOf(a), size: Math.abs(ringArea(a.ring)) }))
    .filter((e) => e.id >= 0)
    .sort((p, q) => q.size - p.size);
  for (const { a, id } of areas) {
    field.fillGround([a.ring, ...(a.holes ?? [])], id);
  }
  field.buildingDistance(data.buildings.filter((b) => !b.part));
  for (const t of streetTramTracks(data)) {
    field.stampTram(t.pts, t.gauge);
  }
  const streets = classifyStreets(data.roads);
  for (const s of streets) {
    field.stampStreet(s);
  }
  for (const f of kerbFillets(streets, data.roads, (x, z) => field.buildingDistanceAt(x, z))) {
    field.stampFillet(f);
  }
  for (const m of findMedians(streets)) {
    field.stampMedian(m);
  }
  for (const p of classifyPaths(data.roads)) {
    field.stampPath(p);
  }
  return field.toRaster();
}
