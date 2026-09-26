/**
 * Street surface query for every layer (main thread: OsmContext.surface; workers: `new StreetSurface(base)`):
 * where carriageways, sidewalks and pedestrian paving are, which surface they have, which way the street runs, and
 * the height to put things on. It decodes the same StreetRaster the ground shader renders, and follows the same
 * GroundGrid (plus the quay raise and the raised kerb / platform lifts) the ground mesh is built from, so query
 * results match what is drawn.
 *
 * Owned by the streets layer: when streets changes the ground (raised kerbs, tram platforms, quays...), it updates
 * heightAt() here so traffic and details keep sitting on the visible surface. Step flights are separate masonry and
 * not part of heightAt(). Elevated decks (Galata Bridge) are not in the raster: on the main thread topAt() asks the
 * deck query the streets layer attaches (core 'roadSurface' service when a module provides it, otherwise the
 * structure colliders over OSM bridge ways).
 */
import type { WorldBounds } from '../../../core/contracts';
import { GeoSampler } from './geo';
import { GROUND_LIFT, GROUND_STEP, GroundGrid } from './ground';
import { MASK_RANGE, SIDEWALK_MAX, type OsmWorkerBase, type StreetRaster } from './protocol';
import { BUILDING_RANGE, decodeSigned, FLAG_KERBED, FLAG_PEDESTRIAN, FLAG_TRACK_BED, FLAG_TRAM, Ground, PATH_RANGE, PLATFORM_HEIGHT, Surf, SURF_MASK } from './street-field';

export const Zone = {
  Water: 0,
  /** Asphalt, paved or cobbled carriageway (vehicles). */
  Carriageway: 1,
  /** Pedestrian streets, squares, platforms, footpaths and the wall-to-wall edges of kerbless streets. */
  Pedestrian: 2,
  /** Raised sidewalk along a kerbed carriageway (runs to the facade when the building line is close). */
  Sidewalk: 3,
  /** Anything else on land: back lots, courtyards, parks, building footprints. */
  Lot: 4,
} as const;
export type Zone = (typeof Zone)[keyof typeof Zone];

/** Height (m) of kerbs above the carriageway; blocks next to kerbed streets are raised by it. */
export const KERB_HEIGHT = 0.15;
/** A sidewalk runs on to the facade when the building line is at most this far (m) behind the sidewalk edge. */
export const FRONTAGE = 5;
/** Kerbless streets are paved wall to wall when the building line is at most this far (m) from the street edge. */
export const BARE_FRONTAGE = 4.5;
/** Kerbless cobbled / paved street surfaces run this far (m) past the carriageway edge. */
export const BARE_WIDEN = 0.5;
/** The OSM ground ends in a vertical stone quay wall at this coast distance (m, geo coast field, positive on land). */
export const QUAY_EDGE = 1;
/** Quay top above the water (m): lower coastal ground is raised to it (the terrain slopes into the sea there). */
export const QUAY_TOP = 0.95;
/** The quay raise holds up to QUAY_FLAT m from the coast and fades out by QUAY_FADE m. */
const QUAY_FLAT = 14;
const QUAY_FADE = 32;

/**
 * Height of the OSM ground before kerb lifts (carriageways) from the geo terrain height and signed coast distance at a
 * point: terrain + GROUND_LIFT, coastal ground below QUAY_TOP raised towards it (quayGridValues() per grid vertex).
 * Other modules use it to meet the drawn street exactly (bridge abutments, structures standing in the slice).
 */
export function osmGroundHeight(terrain: number, coast: number): number {
  return terrain + GROUND_LIFT + quayRaise(terrain + GROUND_LIFT, coast);
}

function quayRaise(y: number, coast: number): number {
  if (coast >= QUAY_FADE || y >= QUAY_TOP) {
    return 0;
  }
  const t = Math.min(1, Math.max(0, (QUAY_FADE - coast) / (QUAY_FADE - QUAY_FLAT)));
  return (QUAY_TOP - y) * t * t * (3 - 2 * t);
}

const PEDESTRIAN_GROUND = new Set<number>([Ground.Plaza, Ground.Platform, Ground.Quay, Ground.Worship]);

export type DeckQuery = (x: number, z: number) => number | null;

export class StreetSurface {
  readonly geo: GeoSampler;
  readonly ground: GroundGrid;
  readonly raster: StreetRaster;
  private liftGrid: Float32Array | null = null;
  private quayGrid: Float32Array | null = null;
  private decks: DeckQuery | null = null;

  /** Build rect: the OSM ground exists only here (lookups outside clamp to its edge). */
  readonly rect: WorldBounds;

  constructor(base: OsmWorkerBase) {
    this.geo = new GeoSampler(base);
    this.ground = new GroundGrid(base.rect, this.geo);
    this.raster = base.street;
    this.rect = base.rect;
  }

  /** Whether (x, z) lies on the OSM ground (inside the build rect). */
  covers(x: number, z: number): boolean {
    const r = this.rect;
    return x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ;
  }

  /** Bilinear byte value (0..255) of RGBA channel `c` at (x, z), like the GPU's linear filter. */
  private channel(x: number, z: number, c: number): number {
    const r = this.raster;
    let fx = (x - r.minX) / r.px - 0.5;
    let fz = (z - r.minZ) / r.px - 0.5;
    fx = Math.min(r.w - 1.001, Math.max(0, fx));
    fz = Math.min(r.h - 1.001, Math.max(0, fz));
    const i = fx | 0;
    const j = fz | 0;
    const tx = fx - i;
    const tz = fz - j;
    const d = r.rgba;
    const k = (j * r.w + i) * 4 + c;
    const kn = k + r.w * 4;
    const a = d[k] + (d[k + 4] - d[k]) * tx;
    const b = d[kn] + (d[kn + 4] - d[kn]) * tx;
    return a + (b - a) * tz;
  }

  private texel(x: number, z: number): number {
    const r = this.raster;
    const i = Math.min(r.w - 1, Math.max(0, Math.floor((x - r.minX) / r.px)));
    const j = Math.min(r.h - 1, Math.max(0, Math.floor((z - r.minZ) / r.px)));
    return (j * r.w + i) * 4;
  }

  /** Signed distance (m) to the nearest carriageway edge: negative on the carriageway, clamped to ±MASK_RANGE. */
  distance(x: number, z: number): number {
    return decodeSigned(this.channel(x, z, 0), MASK_RANGE);
  }

  /** Distance (m) to the nearest building outline (0 inside), clamped to BUILDING_RANGE. */
  buildingDistance(x: number, z: number): number {
    return (this.channel(x, z, 1) / 255) * BUILDING_RANGE;
  }

  /** Sidewalk width (m) of the nearest carriageway on this side (0 without sidewalk). */
  sidewalkWidth(x: number, z: number): number {
    return (this.raster.rgba[this.texel(x, z) + 2] / 255) * SIDEWALK_MAX;
  }

  /** Sidewalk width (m) bilinearly filtered like the ground shader samples it (smooth across texel borders). */
  sidewalkWidthSmooth(x: number, z: number): number {
    return (this.channel(x, z, 2) / 255) * SIDEWALK_MAX;
  }

  /** Signed distance (m) to the nearest footway / path / steps edge (negative on the path), clamped to ±PATH_RANGE. */
  pathDistance(x: number, z: number): number {
    return decodeSigned(this.channel(x, z, 3), PATH_RANGE);
  }

  /** Surface class (Surf) of the nearest / winning carriageway. */
  surfaceAt(x: number, z: number): number {
    return this.raster.ids[this.texel(x, z)] & SURF_MASK;
  }

  /** Ground cover (Ground) of the OSM area at (x, z). */
  groundAt(x: number, z: number): number {
    return this.raster.ids[this.texel(x, z) + 1];
  }

  /** Surface class (Surf) of the nearest path. */
  pathSurfaceAt(x: number, z: number): number {
    return this.raster.ids[this.texel(x, z) + 2];
  }

  /** Direction (rad, 0..pi, atan2(dz, dx) of the axis) of the nearest / winning carriageway at (x, z). */
  directionAt(x: number, z: number): number {
    return (this.raster.ids[this.texel(x, z) + 3] / 256) * Math.PI;
  }

  /** The nearest carriageway has kerbs. */
  kerbed(x: number, z: number): boolean {
    return (this.raster.ids[this.texel(x, z)] & FLAG_KERBED) !== 0;
  }

  /** The nearest carriageway is a pedestrian street. */
  pedestrianStreet(x: number, z: number): boolean {
    return (this.raster.ids[this.texel(x, z)] & FLAG_PEDESTRIAN) !== 0;
  }

  /**
   * Street tram tracks inside the rect as every layer draws them (kerb-lane tracks moved onto the carriageway,
   * tram-tracks.ts correctTramTracks; bridge sections excluded), centre lines resampled every metre.
   */
  get tramTracks(): StreetRaster['tracks'] {
    return this.raster.tracks;
  }

  /** Within the rail reach of a (corrected) street tram track. */
  tramBed(x: number, z: number): boolean {
    return (this.raster.ids[this.texel(x, z)] & FLAG_TRAM) !== 0;
  }

  /**
   * Inside a flush tram track bed (median and own right-of-way tracks, street-field.ts stampTrackBeds): part of the
   * carriageway (distance() < 0), at carriageway level.
   */
  trackBedAt(x: number, z: number): boolean {
    return (this.raster.ids[this.texel(x, z)] & FLAG_TRACK_BED) !== 0;
  }

  /** Zone at (x, z), matching the ground shader's split. */
  zone(x: number, z: number): Zone {
    if (this.geo.isWater(x, z)) {
      return Zone.Water;
    }
    const k = this.texel(x, z);
    const flags = this.raster.ids[k];
    const kerbed = (flags & FLAG_KERBED) !== 0;
    const d = this.distance(x, z);
    if (d < (kerbed ? 0 : BARE_WIDEN)) {
      return flags & FLAG_PEDESTRIAN ? Zone.Pedestrian : Zone.Carriageway;
    }
    const bd = this.buildingDistance(x, z);
    if (bd <= 0.05) {
      return Zone.Lot;
    }
    if (kerbed) {
      const sw = (this.raster.rgba[k + 2] / 255) * SIDEWALK_MAX;
      if (sw > 0.1 && (d < sw || d + bd < sw + FRONTAGE)) {
        return Zone.Sidewalk;
      }
    } else if (d < MASK_RANGE - 0.5 && d + bd < BARE_FRONTAGE) {
      return Zone.Pedestrian;
    }
    if (this.pathDistance(x, z) < 0 || PEDESTRIAN_GROUND.has(this.raster.ids[k + 1])) {
      return Zone.Pedestrian;
    }
    return Zone.Lot;
  }

  /**
   * Kerb lift (m) per ground grid vertex: KERB_HEIGHT where the ground next to it borders kerbed carriageways,
   * fading to 0 next to kerbless streets and deep inside blocks (sampled over ±4 m around the vertex).
   */
  liftGridValues(): Float32Array {
    if (this.liftGrid) {
      return this.liftGrid;
    }
    const g = this.ground;
    const r = this.raster;
    const out = new Float32Array(g.nx * g.nz);
    // Ground vertex (i, j) sits on texel (5 i, 5 j) + offset (texel centres are whole metres of the rect).
    const oi = Math.round((g.x0 - r.minX) / r.px - 0.5);
    const oj = Math.round((g.z0 - r.minZ) / r.px - 0.5);
    const step = GROUND_STEP / r.px;
    const zero = 127.5;
    for (let j = 0; j < g.nz; j++) {
      for (let i = 0; i < g.nx; i++) {
        const ci = oi + i * step;
        const cj = oj + j * step;
        let n = 0;
        let kerb = 0;
        for (let dj = -4; dj <= 4; dj += 2) {
          const tj = cj + dj;
          if (tj < 0 || tj >= r.h) {
            continue;
          }
          for (let di = -4; di <= 4; di += 2) {
            const ti = ci + di;
            if (ti < 0 || ti >= r.w) {
              continue;
            }
            const t = (tj * r.w + ti) * 4;
            if (r.rgba[t] > zero && r.rgba[t] < 255) {
              n++;
              if (r.ids[t] & FLAG_KERBED) {
                kerb++;
              }
            }
          }
        }
        out[j * g.nx + i] = n ? (KERB_HEIGHT * kerb) / n : 0;
      }
    }
    this.liftGrid = out;
    return out;
  }

  /**
   * Quay raise (m) per ground grid vertex: coastal ground below QUAY_TOP is lifted to it near the water, so the
   * OSM ground ends in a level quay above the sea instead of sloping under it (buildings stand further inland).
   */
  quayGridValues(): Float32Array {
    if (this.quayGrid) {
      return this.quayGrid;
    }
    const g = this.ground;
    const out = new Float32Array(g.nx * g.nz);
    for (let j = 0; j < g.nz; j++) {
      for (let i = 0; i < g.nx; i++) {
        const k = j * g.nx + i;
        out[k] = quayRaise(g.y[k], this.geo.groundCoast(g.x0 + i * GROUND_STEP, g.z0 + j * GROUND_STEP));
      }
    }
    this.quayGrid = out;
    return out;
  }

  /** Quay raise (m) at (x, z), interpolated like GroundGrid.yAt(). */
  quayAt(x: number, z: number): number {
    return this.gridAt(this.quayGridValues(), x, z);
  }

  /** Height (m) of the OSM ground mesh before kerb lifts: terrain grid plus the quay raise. */
  baseAt(x: number, z: number): number {
    return this.ground.yAt(x, z) + this.quayAt(x, z);
  }

  /** Kerb lift (m) of ground off the carriageway at (x, z), interpolated like GroundGrid.yAt(). */
  liftAt(x: number, z: number): number {
    return this.gridAt(this.liftGridValues(), x, z);
  }

  /** Per-vertex grid value `l` at (x, z) on the GroundGrid triangulation. */
  private gridAt(l: Float32Array, x: number, z: number): number {
    const g = this.ground;
    let fx = (x - g.x0) / GROUND_STEP;
    let fz = (z - g.z0) / GROUND_STEP;
    fx = Math.min(g.nx - 1.001, Math.max(0, fx));
    fz = Math.min(g.nz - 1.001, Math.max(0, fz));
    const i = fx | 0;
    const j = fz | 0;
    const u = fx - i;
    const v = fz - j;
    const n = g.nx;
    const a = l[j * n + i];
    const b = l[j * n + i + 1];
    const c = l[(j + 1) * n + i];
    const d = l[(j + 1) * n + i + 1];
    return u + v <= 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v);
  }

  /** Height (m) of the visible OSM ground (carriageway, raised sidewalk, tram platform top, quay, lot) at (x, z). */
  heightAt(x: number, z: number): number {
    const y = this.baseAt(x, z);
    if (this.distance(x, z) <= 0) {
      return y;
    }
    return this.groundAt(x, z) === Ground.Platform ? y + PLATFORM_HEIGHT : y + this.liftAt(x, z);
  }

  /** Attaches the elevated deck query (main thread; set by the streets layer). */
  setDecks(query: DeckQuery | null): void {
    this.decks = query;
  }

  /** Deck height (m) of a bridge / elevated road at (x, z), or null (then use heightAt). */
  deckAt(x: number, z: number): number | null {
    return this.decks ? this.decks(x, z) : null;
  }

  /** Top walkable / drivable surface: bridge deck when one covers (x, z), otherwise heightAt(). */
  topAt(x: number, z: number): number {
    return this.deckAt(x, z) ?? this.heightAt(x, z);
  }
}

export { Ground, PLATFORM_HEIGHT, Surf };
