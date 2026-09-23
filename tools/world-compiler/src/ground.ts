/**
 * Greybox ground of one tile: 1 m cells, each split into two triangles and cut along the zero lines of two fields,
 * so kerbs and quay edges follow the street raster exactly instead of stair-stepping:
 * - land L = max(coast, pier distance) (coast.ts: the OSM coastline): water is dropped; the cut becomes a vertical
 *   quay wall down to QUAY_BOTTOM.
 * - carriageway D = StreetSurface.distance (negative on the carriageway): the carriageway stays at the base height,
 *   everything else is raised by the kerb lift; the cut becomes a kerb face (KERB_HEIGHT next to kerbed streets,
 *   fading to nothing next to kerbless lanes).
 * Heights: base = terrain + quay raise (StreetSurface.baseAt), off-carriageway = base + kerb lift (liftAt).
 * Tram platforms are not raised in format 0. Cells whose corners all lie inside one building are skipped.
 */
import type { WorldBounds } from '../../../src/core/contracts';
import type { OsmData } from '../../../src/world/osm/data';
import { BoxGrid, bounds, pointInRing, segDist } from '../../../src/world/osm/shared/geometry';
import { Ground, PATH_RANGE } from '../../../src/world/osm/shared/street-field';
import { MASK_RANGE } from '../../../src/world/osm/shared/protocol';
import { QUAY_EDGE, type StreetSurface } from '../../../src/world/osm/shared/street-surface';
import type { Foundation } from './foundation';
import type { MaterialName } from './materials';
import type { TileMesh, Vec3 } from './mesh';

/** Bottom of quay walls (m, sea level is 0). */
export const QUAY_BOTTOM = -1.5;
const CELL = 1;
const TAG_NONE = 0;
const TAG_COAST = 1;
const TAG_KERB = 2;

/** Signed distance to piers / quays / ferry terminals drawn over the water (positive inside). */
export class PierField {
  private readonly grid = new BoxGrid(25);
  private readonly polys: { ring: number[] }[] = [];
  private readonly lines: { pts: number[]; hw: number }[] = [];

  constructor(data: Pick<OsmData, 'areas' | 'lines'>) {
    for (const a of data.areas) {
      if (a.kind === 'man_made=pier' || a.kind === 'man_made=quay' || a.kind === 'amenity=ferry_terminal' || a.kind === 'man_made=breakwater') {
        const b = bounds(a.ring);
        this.grid.add(this.polys.push({ ring: a.ring }) - 1, b.minX - 30, b.minZ - 30, b.maxX + 30, b.maxZ + 30);
      }
    }
    for (const l of data.lines) {
      if ((l.kind === 'man_made=pier' || l.kind === 'man_made=breakwater') && !l.closed) {
        const b = bounds(l.pts);
        this.grid.add(-(this.lines.push({ pts: l.pts, hw: (l.width ?? 3) / 2 }) - 1) - 1, b.minX - 30, b.minZ - 30, b.maxX + 30, b.maxZ + 30);
      }
    }
  }

  get count(): number {
    return this.polys.length + this.lines.length;
  }

  /** Signed distance (m), clamped to -30 away from every pier. */
  at(x: number, z: number): number {
    let best = -30;
    for (const id of this.grid.at(x, z)) {
      if (id >= 0) {
        const r = this.polys[id].ring;
        let d = Infinity;
        const n = r.length / 2;
        for (let i = 0, j = n - 1; i < n; j = i++) {
          d = Math.min(d, segDist(x, z, r[j * 2], r[j * 2 + 1], r[i * 2], r[i * 2 + 1]));
        }
        best = Math.max(best, pointInRing(r, x, z) ? d : -d);
      } else {
        const l = this.lines[-id - 1];
        let d = Infinity;
        for (let k = 2; k < l.pts.length; k += 2) {
          d = Math.min(d, segDist(x, z, l.pts[k - 2], l.pts[k - 1], l.pts[k], l.pts[k + 1]));
        }
        best = Math.max(best, l.hw - d);
      }
    }
    return best;
  }
}

interface V {
  x: number;
  z: number;
  /** Land, carriageway distance, footway distance (fields of the cut). */
  L: number;
  D: number;
  P: number;
}

interface Poly {
  v: V[];
  /** tag[i]: origin of edge v[i] -> v[i + 1]. */
  tag: number[];
}

function lerpV(a: V, b: V, t: number): V {
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, L: a.L + (b.L - a.L) * t, D: a.D + (b.D - a.D) * t, P: a.P + (b.P - a.P) * t };
}

/** Splits a convex polygon along the line field `f` = `level` (fields are linear inside the source triangle). */
function split(p: Poly, f: 'L' | 'D' | 'P', newTag: number, level = 0): { neg: Poly | null; pos: Poly | null } {
  const neg: Poly = { v: [], tag: [] };
  const pos: Poly = { v: [], tag: [] };
  const n = p.v.length;
  for (let i = 0; i < n; i++) {
    const a = p.v[i];
    const b = p.v[(i + 1) % n];
    const fa = a[f] - level;
    const fb = b[f] - level;
    const sa = fa >= 0;
    const sb = fb >= 0;
    const here = sa ? pos : neg;
    here.v.push(a);
    here.tag.push(p.tag[i]);
    if (sa !== sb) {
      const c = lerpV(a, b, fa / (fa - fb));
      here.v.push(c);
      here.tag.push(newTag);
      const there = sa ? neg : pos;
      there.v.push(c);
      there.tag.push(p.tag[i]);
    }
  }
  const ok = (q: Poly): Poly | null => (q.v.length >= 3 ? q : null);
  return { neg: ok(neg), pos: ok(pos) };
}

function centroid(p: Poly): [number, number] {
  let x = 0;
  let z = 0;
  for (const v of p.v) {
    x += v.x;
    z += v.z;
  }
  return [x / p.v.length, z / p.v.length];
}

/** Horizontal outward normal of edge a -> b of a convex polygon with centroid c. */
function outward(a: V, b: V, c: [number, number]): Vec3 {
  let nx = b.z - a.z;
  let nz = -(b.x - a.x);
  const l = Math.hypot(nx, nz) || 1;
  nx /= l;
  nz /= l;
  if (nx * (c[0] - a.x) + nz * (c[1] - a.z) > 0) {
    nx = -nx;
    nz = -nz;
  }
  return [nx, 0, nz];
}

export interface GroundHeights {
  /** Carriageway surface. */
  carriage(x: number, z: number): number;
  /** Everything off the carriageway (sidewalks, lots, pedestrian areas, quays). */
  off(x: number, z: number): number;
  /** Top of the visible ground at (x, z). */
  at(x: number, z: number): number;
}

export function groundHeights(surface: StreetSurface): GroundHeights {
  const carriage = (x: number, z: number): number => surface.baseAt(x, z);
  const off = (x: number, z: number): number => surface.baseAt(x, z) + surface.liftAt(x, z);
  return { carriage, off, at: (x, z) => (surface.distance(x, z) < 0 ? carriage(x, z) : off(x, z)) };
}

/**
 * Land field: positive on land and on piers. The quay edge is the OSM coastline itself; with the coarse geo coast
 * (no coastline in the data) it sits QUAY_EDGE inland like the flight slice's ground.
 */
export function landField(f: Pick<Foundation, 'surface' | 'coastSource'>, piers: PierField): (x: number, z: number) => number {
  const edge = f.coastSource === 'osm' ? 0 : QUAY_EDGE;
  return (x, z) => Math.max(f.surface.geo.coast(x, z) - edge, piers.at(x, z));
}

/**
 * Open ground this close (m) to a carriageway / footway is paved. Both stay well inside the raster's distance ranges
 * (MASK_RANGE 8 m, PATH_RANGE 4 m): near the clamp the fields flatten and their contour lines turn ragged.
 */
const PAVED_REACH = MASK_RANGE * 0.75;
const PATH_REACH = PATH_RANGE * 0.75;

/**
 * Material of ground off the carriageway. Unlike the flight slice's zone() (sidewalk only up to FRONTAGE from the
 * building line, back lots elsewhere), every open patch within reach of a street is paved: raised sidewalk next to
 * kerbed streets, pedestrian paving next to kerbless lanes, pedestrian streets and footways. Mapped greens, quays and
 * squares keep their cover; only ground far from every street stays a bare lot.
 */
function offMaterial(surface: StreetSurface, x: number, z: number): MaterialName {
  if (surface.geo.isWater(x, z)) {
    return 'quay';
  }
  const d = surface.distance(x, z);
  const kerbed = surface.kerbed(x, z);
  if (kerbed && d < surface.sidewalkWidth(x, z)) {
    return 'sidewalk';
  }
  if (surface.pathDistance(x, z) < 0) {
    return 'pedestrian';
  }
  const g = surface.groundAt(x, z);
  if (g === Ground.Grass || g === Ground.Pitch) {
    return 'grass';
  }
  if (g === Ground.Quay) {
    return 'quay';
  }
  if (g === Ground.Plaza || g === Ground.Worship || g === Ground.Platform) {
    return 'pedestrian';
  }
  if (d < PAVED_REACH) {
    return kerbed ? 'sidewalk' : 'pedestrian';
  }
  return surface.pathDistance(x, z) < PATH_REACH ? 'pedestrian' : 'lot';
}

export interface GroundStats {
  cells: number;
  skippedInBuildings: number;
  kerbWallM: number;
  /** Kerb face length (m) by step height: < 0.05, 0.05-0.12, 0.12-0.15 (the target), > 0.15. */
  kerbStepM: [number, number, number, number];
  quayWallM: number;
}

/** Emits the ground of `tile` into `mesh`. */
export function buildGround(tile: WorldBounds, f: Foundation, heights: GroundHeights, land: (x: number, z: number) => number, mesh: TileMesh): GroundStats {
  const s = f.surface;
  const nx = Math.round((tile.maxX - tile.minX) / CELL);
  const nz = Math.round((tile.maxZ - tile.minZ) / CELL);
  const W = nx + 1;
  const L = new Float32Array(W * (nz + 1));
  const D = new Float32Array(W * (nz + 1));
  const P = new Float32Array(W * (nz + 1));
  const inside = new Uint8Array(W * (nz + 1));
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const x = tile.minX + i * CELL;
      const z = tile.minZ + j * CELL;
      const k = j * W + i;
      L[k] = land(x, z);
      D[k] = s.distance(x, z);
      P[k] = s.pathDistance(x, z);
      inside[k] = f.footprints.inside(x, z) ? 1 : 0;
    }
  }
  const stats: GroundStats = { cells: nx * nz, skippedInBuildings: 0, kerbWallM: 0, kerbStepM: [0, 0, 0, 0], quayWallM: 0 };
  const corner = (i: number, j: number): V => {
    const k = j * W + i;
    return { x: tile.minX + i * CELL, z: tile.minZ + j * CELL, L: L[k], D: D[k], P: P[k] };
  };
  const emit = (p: Poly, carriage: boolean): void => {
    const c = centroid(p);
    const h = carriage ? heights.carriage : heights.off;
    const mat: MaterialName = carriage ? (s.pedestrianStreet(c[0], c[1]) ? 'pedestrian' : 'road') : offMaterial(s, c[0], c[1]);
    const pts: Vec3[] = p.v.map((v) => [v.x, h(v.x, v.z), v.z]);
    mesh.groundPolygon(mat, pts);
    const n = p.v.length;
    for (let i = 0; i < n; i++) {
      const tag = p.tag[i];
      if (tag === TAG_NONE || (tag === TAG_KERB && carriage)) {
        continue;
      }
      const a = p.v[i];
      const b = p.v[(i + 1) % n];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 1e-4) {
        continue;
      }
      const nrm = outward(a, b, c);
      if (tag === TAG_COAST) {
        mesh.wall('quay', a.x, a.z, b.x, b.z, QUAY_BOTTOM, pts[i][1], QUAY_BOTTOM, pts[(i + 1) % n][1], nrm);
        stats.quayWallM += len;
      } else {
        const ya = heights.carriage(a.x, a.z);
        const yb = heights.carriage(b.x, b.z);
        mesh.wall('kerb', a.x, a.z, b.x, b.z, ya, pts[i][1], yb, pts[(i + 1) % n][1], nrm);
        const step = (pts[i][1] - ya + pts[(i + 1) % n][1] - yb) / 2;
        if (step > 0.01) {
          stats.kerbWallM += len;
          stats.kerbStepM[step < 0.05 ? 0 : step < 0.12 ? 1 : step <= 0.1505 ? 2 : 3] += len;
        }
      }
    }
  };
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * W + i;
      if (inside[k] && inside[k + 1] && inside[k + W] && inside[k + W + 1]) {
        stats.skippedInBuildings++;
        continue;
      }
      const c00 = corner(i, j);
      const c10 = corner(i + 1, j);
      const c01 = corner(i, j + 1);
      const c11 = corner(i + 1, j + 1);
      for (const tri of [
        [c00, c01, c10],
        [c10, c01, c11],
      ]) {
        if (tri[0].L < 0 && tri[1].L < 0 && tri[2].L < 0) {
          continue;
        }
        const landPart = split({ v: tri, tag: [TAG_NONE, TAG_NONE, TAG_NONE] }, 'L', TAG_COAST).pos;
        if (!landPart) {
          continue;
        }
        const parts = split(landPart, 'D', TAG_KERB);
        if (parts.neg) {
          emit(parts.neg, true);
        }
        if (parts.pos) {
          // Material borders off the carriageway follow the footway edge and the paving reach, not the 1 m cells.
          let pieces: Poly[] = [parts.pos];
          for (const [field, level] of [
            ['P', 0],
            ['P', PATH_REACH],
            ['D', PAVED_REACH],
          ] as const) {
            pieces = pieces.flatMap((q) => {
              const r = split(q, field, TAG_NONE, level);
              return [r.neg, r.pos].filter((x): x is Poly => x !== null);
            });
          }
          for (const q of pieces) {
            emit(q, false);
          }
        }
      }
    }
  }
  return stats;
}
