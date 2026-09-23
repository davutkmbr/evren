import * as THREE from 'three';
import type { GeoQuery, RoadDef, RoadSurfaceService, WorldBounds } from '../../../core/contracts';
import { createRng } from '../../../core/math/noise';

export const ROAD_TEX_WIDTH = 1024;
/** Resampling step along every road (m). */
export const ROAD_STEP = 12;
/**
 * Texels per road sample: (x, y, z, hide) of the centreline point and the lateral surface profile (left, right,
 * left half, right half): surface heights relative to the centre at the track's `side` offset and half of it.
 */
export const ROAD_SAMPLE_TEXELS = 2;
const STRIDE = ROAD_SAMPLE_TEXELS * 4;
/** Wheels are lifted this much above the surface (m). */
const WHEEL_LIFT = 0.05;
/** Lowest road surface (m): roads the geo data puts over the sea run on the water surface. */
const MIN_ROAD_HEIGHT = 0;

export interface RoadTrack {
  def: RoadDef;
  start: number;
  count: number;
  length: number;
  /** Bounding circle of the road (for near-camera car selection). */
  cx: number;
  cz: number;
  radius: number;
  /** Lateral offset (m) of the outer profile samples (the outermost lane). */
  side: number;
  /** Bridge decks the road runs on (roadSurface ids) and the length it spends on them (m). */
  deckIds: string[];
  deckLength: number;
}

/** Per-sample surface kind (RoadNetwork.kinds). */
export const SampleKind = { Ground: 0, Deck: 1, Join: 2 } as const;

export interface CarRecord {
  road: number;
  /** Lateral offset (m, to the right of travel). */
  offset: number;
  dir: number;
  speed: number;
  phase: number;
  /** Paint / type seed [0, 1). */
  style: number;
  /** Vehicle type: 0 car, 1 taxi, 2 bus, 3 truck. */
  type: number;
  /** Visibility threshold vs. the time-of-day traffic volume. */
  hide: number;
}

interface LaneSpec {
  lanes: number;
  median: number;
  density: number;
  speed: number;
}

function laneSpec(r: RoadDef): LaneSpec {
  switch (r.kind) {
    case 'highway':
      return { lanes: 3, median: 1.8, density: 24, speed: 19 };
    case 'bridge':
      return { lanes: r.width > 50 ? 4 : 3, median: 1.2, density: 28, speed: 15 };
    case 'avenue':
      return { lanes: r.width >= 30 ? 3 : 2, median: 1.0, density: 17, speed: 11 };
    case 'coastal':
      return { lanes: r.width >= 20 ? 2 : 1, median: 0.4, density: 15, speed: 12 };
    default:
      return { lanes: 1, median: 0.2, density: 9, speed: 8 };
  }
}

/** One traffic lane of a track: offset to the right of travel, travel direction along the track, rank from the median. */
interface TrackLane {
  offset: number;
  dir: 1 | -1;
  rank: number;
  outer: boolean;
}

/** Pedestrian-only streets (no cars). */
const CAR_FREE = new Set(['istiklal-caddesi']);

/** Metres over which cars fade out when entering an excluded rectangle. */
const EXCLUDE_FADE = 15;

/**
 * A road enters a deck where its centreline is within this distance (m) of the carriageway (geo polylines of the
 * bridge roads run up to ~20 m beside the landmark's deck axis)...
 */
const DECK_ENTER_MARGIN = 25;
/** ...and runs nearly parallel to it (cos of the largest angle)... */
const DECK_PARALLEL = Math.cos(THREE.MathUtils.degToRad(30));
/** ...and stays on it (following the deck centre line) while it is within this lateral distance (m) of the axis... */
const DECK_STAY = 60;
/** ...for at least this long (m); shorter touches of a deck end are left alone. */
const DECK_MIN_RUN = 20;

/** 0 outside `r`, rising to 1 at EXCLUDE_FADE metres inside it. */
function excludeWeight(x: number, z: number, r: WorldBounds | null): number {
  if (!r) return 0;
  const inside = Math.min(x - r.minX, r.maxX - x, z - r.minZ, r.maxZ - z);
  return inside <= 0 ? 0 : Math.min(1, inside / EXCLUDE_FADE);
}

/** The roadSurface deck record; the structures module also publishes lanes and the full deck half width. */
type ServiceDeck = RoadSurfaceService['decks'][number] & { lanes?: readonly { x: number; dir: 1 | -1 }[]; halfWidth?: number };

/** A published deck as a straight axis with its surface profile by station. */
class DeckAxis {
  readonly id: string;
  readonly ox: number;
  readonly oz: number;
  readonly ax: number;
  readonly az: number;
  readonly length: number;
  readonly halfRoad: number;
  /** Lane centres relative to the axis (right of +s) with their direction along +s. */
  readonly lanes: readonly { x: number; dir: 1 | -1 }[];
  private readonly st: Float64Array;
  private readonly ys: Float32Array;

  constructor(deck: ServiceDeck) {
    const p = deck.points;
    const a = p[0];
    const b = p[p.length - 1];
    this.id = deck.id;
    this.ox = a.x;
    this.oz = a.z;
    this.length = Math.hypot(b.x - a.x, b.z - a.z);
    this.ax = (b.x - a.x) / Math.max(this.length, 1e-6);
    this.az = (b.z - a.z) / Math.max(this.length, 1e-6);
    this.halfRoad = deck.width / 2;
    this.lanes = deck.lanes ?? [];
    this.st = new Float64Array(p.length);
    this.ys = new Float32Array(p.length);
    p.forEach((q, i) => {
      this.st[i] = (q.x - a.x) * this.ax + (q.z - a.z) * this.az;
      this.ys[i] = q.y;
    });
  }

  s(x: number, z: number): number {
    return (x - this.ox) * this.ax + (z - this.oz) * this.az;
  }

  lateral(x: number, z: number): number {
    return -(x - this.ox) * this.az + (z - this.oz) * this.ax;
  }

  /** Surface height of the deck centre line at station s (clamped to the deck). */
  heightAt(s: number): number {
    const st = this.st;
    const n = st.length;
    if (s <= st[0]) return this.ys[0];
    if (s >= st[n - 1]) return this.ys[n - 1];
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (st[mid] <= s) lo = mid;
      else hi = mid;
    }
    const t = (s - st[lo]) / Math.max(st[hi] - st[lo], 1e-6);
    return this.ys[lo] + (this.ys[hi] - this.ys[lo]) * t;
  }

  /** Innermost / outermost lateral extent (m from the axis) of the traffic lanes; 0 / halfRoad without lanes. */
  get laneBand(): [number, number] {
    if (this.lanes.length === 0) return [0, this.halfRoad];
    const xs = this.lanes.map((l) => Math.abs(l.x));
    return [Math.max(0, Math.min(...xs) - 1.8), Math.min(this.halfRoad, Math.max(...xs) + 1.8)];
  }
}

/** Road polyline vertex; on a deck it carries the deck and its station there. */
interface PathPoint {
  x: number;
  z: number;
  deck: DeckAxis | null;
  s: number;
}

/** Road vertices with at most DENSIFY m between them (so a deck is always seen by some vertex). */
const DENSIFY = 10;

function densify(points: readonly { x: number; z: number }[]): PathPoint[] {
  const out: PathPoint[] = [{ x: points[0].x, z: points[0].z, deck: null, s: 0 }];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / DENSIFY));
    for (let k = 1; k <= n; k++) {
      out.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n, deck: null, s: 0 });
    }
  }
  return out;
}

/**
 * Replaces the stretch of `path` that runs along `deck` by the deck centre line: from where the road enters the
 * deck (or the deck end it comes over) to where it leaves it, so vehicles follow the deck the structures module
 * built, approach viaducts included.
 */
function snapToDeck(path: PathPoint[], deck: DeckAxis): { path: PathPoint[]; along: number } {
  const L = deck.length;
  const enter = deck.halfRoad + DECK_ENTER_MARGIN;
  const onAxis = (p: PathPoint, lat: number): boolean => {
    if (p.deck) return false;
    const s = deck.s(p.x, p.z);
    return s >= -0.5 && s <= L + 0.5 && Math.abs(deck.lateral(p.x, p.z)) <= lat;
  };
  const parallel = (i: number): boolean => {
    const a = path[i + 1 < path.length ? i : i - 1];
    const b = path[i + 1 < path.length ? i + 1 : i];
    const l = Math.hypot(b.x - a.x, b.z - a.z);
    return l > 1e-3 && Math.abs(((b.x - a.x) * deck.ax + (b.z - a.z) * deck.az) / l) >= DECK_PARALLEL;
  };
  const clampS = (p: PathPoint): number => THREE.MathUtils.clamp(deck.s(p.x, p.z), 0, L);
  const out: PathPoint[] = [];
  let along = 0;
  let i = 0;
  while (i < path.length) {
    if (!onAxis(path[i], enter) || !parallel(i)) {
      out.push(path[i]);
      i++;
      continue;
    }
    // Walk back over the vertices beside the deck (a curved approach next to the straight viaduct).
    let first = i;
    while (first > 0 && out.length > 0 && out[out.length - 1] === path[first - 1] && onAxis(path[first - 1], DECK_STAY)) {
      out.pop();
      first--;
    }
    let last = i;
    while (last + 1 < path.length && onAxis(path[last + 1], DECK_STAY)) {
      last++;
    }
    const before = first > 0 ? deck.s(path[first - 1].x, path[first - 1].z) : NaN;
    const after = last + 1 < path.length ? deck.s(path[last + 1].x, path[last + 1].z) : NaN;
    const sIn = before < 0 ? 0 : before > L ? L : clampS(path[first]);
    const sOut = after < 0 ? 0 : after > L ? L : clampS(path[last]);
    if (Math.abs(sOut - sIn) < DECK_MIN_RUN) {
      for (let k = first; k <= last; k++) out.push(path[k]);
      i = last + 1;
      continue;
    }
    for (const s of [sIn, sOut]) {
      out.push({ x: deck.ox + deck.ax * s, z: deck.oz + deck.az * s, deck, s });
    }
    along += Math.abs(sOut - sIn);
    i = last + 1;
  }
  return { path: out, along };
}

/**
 * Resamples geo.roads into a float texture (ROAD_SAMPLE_TEXELS texels per point at ROAD_STEP spacing: centreline
 * point, hide weight and the lateral surface profile) and lays out right-hand traffic lanes with car phases.
 * Bridge decks come only from the core 'roadSurface' service: the roads are re-aligned onto the published deck
 * centre lines and take their surface heights (and lanes) from there. `hide` is 1 inside the optional `exclude`
 * rectangle (the ?osm=1 slice, which runs its own traffic) and 0 elsewhere.
 */
export class RoadNetwork {
  readonly tracks: RoadTrack[] = [];
  readonly cars: CarRecord[] = [];
  readonly texture: THREE.DataTexture;
  readonly samples: Float32Array;
  /** Floats per road sample in `samples`. */
  readonly stride = STRIDE;
  /** SampleKind per road sample (debug / measurements). */
  readonly kinds: Uint8Array;
  private readonly lanes: TrackLane[][] = [];

  constructor(geo: GeoQuery, densityScale: number, exclude: WorldBounds | null = null, surface: RoadSurfaceService | null = null) {
    const decks = (surface?.decks ?? []).filter((d) => d.points.length >= 2).map((d) => new DeckAxis(d as ServiceDeck));
    const ground = (x: number, z: number): number => Math.max(geo.heightAt(x, z), MIN_ROAD_HEIGHT);
    const pts: number[] = [];
    const kinds: number[] = [];
    for (const def of geo.roads) {
      if (CAR_FREE.has(def.id) || def.points.length < 2) continue;
      let path = densify(def.points);
      const crossed: DeckAxis[] = [];
      let deckLength = 0;
      for (const deck of decks) {
        const r = snapToDeck(path, deck);
        if (r.along > 0) {
          path = r.path;
          crossed.push(deck);
          deckLength += r.along;
        }
      }
      const cum: number[] = [0];
      for (let i = 1; i < path.length; i++) {
        cum.push(cum[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z));
      }
      const length = cum[cum.length - 1];
      if (length < ROAD_STEP * 3) continue;
      const lanes = this.trackLanes(def, crossed, deckLength / length, path);
      const side = Math.max(...lanes.map((l) => l.offset), 1);
      const count = Math.floor(length / ROAD_STEP) + 1;
      const start = pts.length / STRIDE;
      // Sample points along the path, with the deck of the path segment they lie on.
      const xs = new Float64Array(count);
      const zs = new Float64Array(count);
      const on: (DeckAxis | null)[] = [];
      const near: (DeckAxis | null)[] = [];
      const st = new Float64Array(count);
      let seg = 0;
      for (let k = 0; k < count; k++) {
        const s = Math.min(k * ROAD_STEP, length);
        while (seg < cum.length - 2 && cum[seg + 1] < s) seg++;
        const a = path[seg];
        const b = path[seg + 1];
        const t = (s - cum[seg]) / Math.max(cum[seg + 1] - cum[seg], 1e-6);
        xs[k] = a.x + (b.x - a.x) * t;
        zs[k] = a.z + (b.z - a.z) * t;
        const deck = a.deck !== null && a.deck === b.deck ? a.deck : null;
        on.push(deck);
        near.push(deck ?? a.deck ?? b.deck);
        st[k] = deck ? a.s + (b.s - a.s) * t : 0;
      }
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (let k = 0; k < count; k++) {
        const x = xs[k];
        const z = zs[k];
        // Lateral axis from the resampled chords, as the car shader builds it.
        const k0 = Math.max(k - 1, 0);
        const k1 = Math.min(k + 1, count - 1);
        let dx = xs[k1] - xs[k0];
        let dz = zs[k1] - zs[k0];
        const dl = Math.hypot(dx, dz) || 1;
        dx /= dl;
        dz /= dl;
        const deck = on[k];
        const join = near[k];
        // Surface at `lat` m right of travel: the deck top (flat across) where the road runs on a deck; next to a
        // deck end the deck where it covers the point, else the ground.
        const at = (lat: number): number => {
          const px = x - dz * lat;
          const pz = z + dx * lat;
          const g = ground(px, pz);
          if (deck) return Math.max(deck.heightAt(st[k]), g);
          if (join) {
            const sj = join.s(px, pz);
            if (sj >= 0 && sj <= join.length && Math.abs(join.lateral(px, pz)) <= join.halfRoad + 1) {
              return Math.max(join.heightAt(sj), g);
            }
          }
          return g;
        };
        const yc = at(0);
        pts.push(x, yc + WHEEL_LIFT, z, excludeWeight(x, z, exclude));
        pts.push(at(-side) - yc, at(side) - yc, at(-side / 2) - yc, at(side / 2) - yc);
        kinds.push(deck ? SampleKind.Deck : join ? SampleKind.Join : SampleKind.Ground);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minZ = Math.min(minZ, z);
        maxZ = Math.max(maxZ, z);
      }
      const cx = (minX + maxX) / 2;
      const cz = (minZ + maxZ) / 2;
      this.tracks.push({
        def,
        start,
        count,
        length: (count - 1) * ROAD_STEP,
        cx,
        cz,
        radius: Math.hypot(maxX - minX, maxZ - minZ) / 2,
        side,
        deckIds: crossed.map((d) => d.id),
        deckLength,
      });
      this.lanes.push(lanes);
    }
    const texels = pts.length / 4;
    const rows = Math.max(1, Math.ceil(texels / ROAD_TEX_WIDTH));
    this.samples = new Float32Array(ROAD_TEX_WIDTH * rows * 4);
    this.samples.set(pts);
    this.texture = new THREE.DataTexture(this.samples, ROAD_TEX_WIDTH, rows, THREE.RGBAFormat, THREE.FloatType);
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;
    this.kinds = Uint8Array.from(kinds);
    this.layoutCars(densityScale);
  }

  /**
   * Lanes of one track. A road that mostly runs on a bridge deck uses the deck's own lanes (e.g. the Galata tram
   * and the Yavuz Sultan Selim railway in the middle); a road that only touches a deck keeps its lane pattern,
   * squeezed into the deck's carriageway.
   */
  private trackLanes(def: RoadDef, crossed: readonly DeckAxis[], deckShare: number, path: readonly PathPoint[]): TrackLane[] {
    const spec = laneSpec(def);
    const main = crossed.find((d) => d.lanes.length > 0);
    if (main && deckShare >= 0.5) {
      // Travel sense of the track along the deck axis.
      const on = path.findIndex((p, i) => p.deck === main && path[i + 1]?.deck === main);
      const sigma = on >= 0 && path[on + 1].s < path[on].s ? -1 : 1;
      const out: TrackLane[] = [];
      for (const dir of [1, -1] as const) {
        const own = main.lanes
          .filter((l) => l.dir * sigma === dir)
          .map((l) => l.x * l.dir)
          .sort((p, q) => p - q);
        own.forEach((offset, rank) => out.push({ offset, dir, rank, outer: rank === own.length - 1 }));
      }
      if (out.length > 0) return out;
    }
    let median = spec.median;
    let halfW = def.width / 2;
    for (const d of crossed) {
      const [inner, outer] = d.laneBand;
      median = Math.max(median, inner);
      halfW = Math.min(halfW, outer);
    }
    const laneW = Math.max(2.4, Math.min(3.5, (halfW - median) / spec.lanes));
    const out: TrackLane[] = [];
    for (const dir of [1, -1] as const) {
      for (let lane = 0; lane < spec.lanes; lane++) {
        out.push({ offset: median + (lane + 0.5) * laneW, dir, rank: lane, outer: lane === spec.lanes - 1 });
      }
    }
    return out;
  }

  private layoutCars(densityScale: number): void {
    const rng = createRng(0xca75);
    this.tracks.forEach((tr, road) => {
      const spec = laneSpec(tr.def);
      const multi = this.lanes[road].length > 2;
      for (const lane of this.lanes[road]) {
        // Inner lanes are faster; each lane keeps one speed so cars never overlap.
        const speed = spec.speed * (1.12 - 0.12 * lane.rank) * (0.85 + rng() * 0.3);
        const perKm = spec.density * densityScale * (lane.outer ? 1.15 : 1);
        const n = Math.max(1, Math.round((tr.length / 1000) * perKm));
        const spacing = tr.length / n;
        for (let k = 0; k < n; k++) {
          const r = rng();
          const type = multi && lane.outer && r < 0.14 ? (r < 0.06 ? 2 : 3) : rng() < 0.13 ? 1 : 0;
          this.cars.push({
            road,
            offset: lane.offset,
            dir: lane.dir,
            speed,
            phase: (k + (rng() - 0.5) * 0.5) * spacing,
            style: rng(),
            type,
            hide: rng(),
          });
        }
      }
    });
  }

  dispose(): void {
    this.texture.dispose();
  }
}
