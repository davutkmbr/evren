/**
 * Street tram tracks as every layer draws them: the kerb-lane move (OSM draws single kerb-lane tracks on the
 * pavement; they run in the carriageway's kerb lane) and the tram platform clearance. Run once per load while the
 * street raster is built (street-field.ts buildStreetRaster, on the float distance field); the result travels with
 * the raster (StreetRaster.tracks), so the runtime slice (decals, catenary, platforms, bridge joints) and the world
 * compiler (common.ts) use exactly the same rails.
 */
import { BoxGrid, segDist } from './geometry';

/** Carriageway distance and flush-bed queries the correction reads (StreetField during the raster build). */
export interface TrackField {
  /** Signed distance (m) to the nearest carriageway edge, negative on the carriageway (bilinear). */
  distance(x: number, z: number): number;
  /** Inside a flush track bed (median and own right-of-way tracks). */
  trackBedAt(x: number, z: number): boolean;
}

export interface TramTrack {
  /** Centre line [x, z, ...], resampled every TRAM_STEP m. */
  pts: number[];
  gauge: number;
  routes?: string[];
}

/**
 * A street tram track off the carriageway with a carriageway on one side only, its centre closer than this (m) to it,
 * runs in that carriageway's kerb lane and is moved onto it (correctTramTracks). Other tracks off the carriageway get a
 * flush track bed.
 */
export const TRACK_KERB_REACH = 5;
/** Resampling step (m) of the corrected tram tracks. */
export const TRAM_STEP = 1;
/** Clearance (m) from the kerb line to the near rail of a tram track in a kerb lane. */
export const TRAM_KERB = 0.85;
/** Largest lateral shift (m per m along the track) of a kerb-lane move next to an anchored (bedded) stretch. */
const TRAM_TAPER = 0.12;
/** Narrowest raised ground (m) past a carriageway edge that counts as a kerb for the kerb-lane clearance. */
const KERB_ISLAND = 1;
/**
 * Lane and edge lines keep this far (m) from a tram track centre: the tram body's half width (1.33 m, the 2.65 m wide
 * T1 Citadis) plus 0.7 m; it also clears the sett inlay and the flush track bed.
 */
export const TRAM_PAINT_CLEAR = 2;
/** Raised tram platforms keep their edge from this distance (m) off the track centre (the tram body's half width). */
export const TRACK_PLATFORM_CLEAR = 1.35;
/**
 * Half width (m) of the granite sett inlay of standard-gauge tracks (T1, T5): half the gauge plus 0.95 m. Metre-gauge
 * heritage lines (T2 İstiklal, T3 Kadıköy) run in the street's own surface.
 */
export function tramInlayHalf(gauge: number): number {
  return gauge >= 1.2 ? gauge / 2 + 0.95 : 0;
}

/**
 * Half width (m) of a tram track's bed across which crossing paint stops (the Istanbul T1 crossings leave the granite
 * bed unpainted): the sett inlay of standard-gauge lines, else the rails plus 0.55 m (the raster's rail reach,
 * street-field.ts stampTram).
 */
export function tramBedHalf(gauge: number): number {
  return Math.max(tramInlayHalf(gauge), gauge / 2 + 0.55);
}

/**
 * The street tram tracks, resampled every TRAM_STEP m; a stretch that OSM draws on the pavement or with its near rail
 * closer than TRAM_KERB to the kerb (but within TRACK_KERB_REACH m of the carriageway) is moved along the carriageway
 * distance gradient until the near rail clears the kerb by TRAM_KERB, the samples next to a moved stretch ease into
 * it, so the track bends instead of kinking; a sample on the carriageway is only moved when a kerb really lies up
 * the distance gradient (not on the seam of two carriageways that meet). Samples in the flush track bed (a median
 * between two carriageways or an own right-of-way, street-field.ts stampTrackBeds) stay on the OSM line and anchor
 * the easing; next to them the move tapers off (TRAM_TAPER). `moved` / `kept` count moved and anchored samples.
 */
export function correctTramTracks(s: TrackField, tracks: readonly { pts: readonly number[]; gauge: number; routes?: string[] }[]): { tracks: TramTrack[]; moved: number; kept: number } {
  const out: TramTrack[] = [];
  let movedN = 0;
  let keptN = 0;
  /**
   * A kerb really lies up the distance gradient of a sample on the carriageway (d0 < 0): the field reaches 0 there
   * and stays raised for KERB_ISLAND m. Where the two halves of a dual carriageway meet without a gap (or with a
   * ridge thinner than that), a track on the seam has no kerb to clear.
   */
  const kerbSide = (x: number, z: number, d0: number): boolean => {
    if (d0 >= 0) {
      return true;
    }
    const h = 0.3;
    const gx = s.distance(x + h, z) - s.distance(x - h, z);
    const gz = s.distance(x, z + h) - s.distance(x, z - h);
    const l = Math.hypot(gx, gz) || 1;
    const at = (q: number): number => s.distance(x + (gx / l) * q, z + (gz / l) * q);
    for (let q = 0.25; q <= -d0 + 0.5; q += 0.25) {
      if (at(q) >= 0) {
        for (let e = q + 0.25; e <= q + KERB_ISLAND; e += 0.25) {
          if (at(e) < 0) {
            return false;
          }
        }
        return true;
      }
    }
    return false;
  };
  for (const tr of tracks) {
    const want = -(tr.gauge / 2 + 0.05 + TRAM_KERB);
    const pts: number[] = [];
    for (let k = 2; k < tr.pts.length; k += 2) {
      const ax = tr.pts[k - 2];
      const az = tr.pts[k - 1];
      const len = Math.hypot(tr.pts[k] - ax, tr.pts[k + 1] - az);
      const m = Math.max(1, Math.round(len / TRAM_STEP));
      for (let i = k === 2 ? 0 : 1; i <= m; i++) {
        pts.push(ax + ((tr.pts[k] - ax) * i) / m, az + ((tr.pts[k + 1] - az) * i) / m);
      }
    }
    const moved = new Float64Array(pts.length);
    const anchored = new Uint8Array(pts.length / 2);
    for (let k = 0; k < pts.length; k += 2) {
      let x = pts[k];
      let z = pts[k + 1];
      if (s.trackBedAt(x, z)) {
        anchored[k / 2] = 1;
        continue;
      }
      const d0 = s.distance(x, z);
      if (d0 > want && d0 < TRACK_KERB_REACH && kerbSide(x, z, d0)) {
        for (let it = 0; it < 40; it++) {
          const d = s.distance(x, z);
          if (d <= want) {
            break;
          }
          const h = 0.3;
          let gx = s.distance(x + h, z) - s.distance(x - h, z);
          let gz = s.distance(x, z + h) - s.distance(x, z - h);
          const l = Math.hypot(gx, gz) || 1;
          gx /= l;
          gz /= l;
          const stepLen = Math.min(0.5, Math.max(0.05, d - want));
          x -= gx * stepLen;
          z -= gz * stepLen;
        }
        moved[k] = x - pts[k];
        moved[k + 1] = z - pts[k + 1];
      }
    }
    // Next to an anchored (bedded) stretch the move tapers off at TRAM_TAPER m per m along the track: the kerb-lane
    // stretch bends back onto the OSM line instead of tearing away from the anchored rails.
    const n = anchored.length;
    const gap = new Float64Array(n).fill(Infinity);
    for (let pass = 0; pass < 2; pass++) {
      let last = -Infinity;
      for (let q = 0; q < n; q++) {
        const i = pass ? n - 1 - q : q;
        if (anchored[i]) {
          last = i;
        }
        gap[i] = Math.min(gap[i], Math.abs(i - last) * TRAM_STEP);
      }
    }
    for (let i = 0; i < n; i++) {
      const m = Math.hypot(moved[i * 2], moved[i * 2 + 1]);
      const cap = gap[i] * TRAM_TAPER;
      if (m > cap) {
        moved[i * 2] *= cap / m;
        moved[i * 2 + 1] *= cap / m;
      }
    }
    // Ease the untouched samples next to a moved stretch (diffusion with the moved samples fixed), so the track
    // bends away from the OSM line over several metres instead of kinking.
    const fixed = (i: number): boolean => anchored[i] === 1 || moved[i * 2] !== 0 || moved[i * 2 + 1] !== 0;
    let off = moved;
    for (let pass = 0; pass < 16; pass++) {
      const next = Float64Array.from(off);
      for (let i = 0; i < n; i++) {
        if (fixed(i)) {
          continue;
        }
        let sx = 0;
        let sz = 0;
        let w = 0;
        for (let j = Math.max(0, i - 2); j <= Math.min(n - 1, i + 2); j++) {
          sx += off[j * 2];
          sz += off[j * 2 + 1];
          w++;
        }
        next[i * 2] = sx / w;
        next[i * 2 + 1] = sz / w;
      }
      off = next;
    }
    for (let pass = 0; pass < 2; pass++) {
      const next = Float64Array.from(off);
      for (let i = 1; i + 1 < n; i++) {
        if (anchored[i]) {
          continue;
        }
        next[i * 2] = (off[i * 2 - 2] + off[i * 2] * 2 + off[i * 2 + 2]) / 4;
        next[i * 2 + 1] = (off[i * 2 - 1] + off[i * 2 + 1] * 2 + off[i * 2 + 3]) / 4;
      }
      off = next;
    }
    for (let i = 0; i < n; i++) {
      movedN += moved[i * 2] !== 0 || moved[i * 2 + 1] !== 0 ? 1 : 0;
      keptN += anchored[i];
    }
    out.push({ pts: pts.map((v, k) => v + off[k]), gauge: tr.gauge, ...(tr.routes ? { routes: tr.routes } : {}) });
  }
  return { tracks: out, moved: movedN, kept: keptN };
}

/** Distance (m) from (x, z) to the nearest centre line of `tracks` (Infinity without tracks). */
export function trackDistance(tracks: readonly { pts: readonly number[] }[], x: number, z: number): number {
  let d = Infinity;
  for (const t of tracks) {
    const p = t.pts;
    for (let k = 2; k < p.length; k += 2) {
      // Cheap reject on the segment's box.
      if (Math.min(p[k - 2], p[k]) - d > x || Math.max(p[k - 2], p[k]) + d < x || Math.min(p[k - 1], p[k + 1]) - d > z || Math.max(p[k - 1], p[k + 1]) + d < z) {
        continue;
      }
      d = Math.min(d, segDist(x, z, p[k - 2], p[k - 1], p[k], p[k + 1]));
    }
  }
  return d;
}

/**
 * The raised part of a tram platform outline: `ring` clipped to where `inside(x, z) > 0` (street-field.ts
 * platformClearance: off the carriageway and TRACK_PLATFORM_CLEAR m off every track centre). The ring is resampled
 * every 0.5 m, the kept vertices stay, crossing points are interpolated, and a gap between an exit and the next entry
 * is bridged by points projected onto the boundary every 0.5 m (the cut follows a curved track). Returns the clipped
 * rings (empty when nothing is left; the ring itself when nothing is cut).
 */
export function clipPlatformRing(ring: readonly number[], inside: (x: number, z: number) => number): number[][] {
  const n0 = ring.length / 2;
  const P: number[] = [];
  for (let k = 0; k < n0; k++) {
    const ax = ring[k * 2];
    const az = ring[k * 2 + 1];
    const bx = ring[((k + 1) % n0) * 2];
    const bz = ring[((k + 1) % n0) * 2 + 1];
    const m = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.5));
    for (let i = 0; i < m; i++) {
      P.push(ax + ((bx - ax) * i) / m, az + ((bz - az) * i) / m);
    }
  }
  const n = P.length / 2;
  const f = Array.from({ length: n }, (_, i) => inside(P[i * 2], P[i * 2 + 1]));
  if (f.every((v) => v > 0)) {
    return [ring.slice()];
  }
  if (f.every((v) => v <= 0)) {
    return [];
  }
  /** Moves (x, z) onto inside = 0 along the numeric gradient. */
  const project = (x: number, z: number): [number, number] => {
    for (let it = 0; it < 12; it++) {
      const v = inside(x, z);
      if (Math.abs(v) < 0.01) {
        break;
      }
      const h = 0.2;
      const gx = (inside(x + h, z) - inside(x - h, z)) / (2 * h);
      const gz = (inside(x, z + h) - inside(x, z - h)) / (2 * h);
      const g2 = gx * gx + gz * gz;
      if (g2 < 1e-6) {
        break;
      }
      const s = Math.max(-0.5, Math.min(0.5, v / Math.sqrt(g2)));
      x -= (gx / Math.sqrt(g2)) * s;
      z -= (gz / Math.sqrt(g2)) * s;
    }
    return [x, z];
  };
  // Start at an inside sample right after an outside one, walk once around.
  let start = 0;
  while (!(f[start] > 0 && f[(start + n - 1) % n] <= 0)) {
    start++;
  }
  const rings: number[][] = [];
  let cur: number[] = [];
  let exit: [number, number] | null = null;
  for (let q = 0; q <= n; q++) {
    const i = (start + q) % n;
    const j = (i + n - 1) % n;
    if (f[i] > 0 && f[j] <= 0) {
      // Entry: bridge from the last exit along the boundary.
      const t = f[j] / (f[j] - f[i]);
      const e = project(P[j * 2] + (P[i * 2] - P[j * 2]) * t, P[j * 2 + 1] + (P[i * 2 + 1] - P[j * 2 + 1]) * t);
      if (exit) {
        const len = Math.hypot(e[0] - exit[0], e[1] - exit[1]);
        const m = Math.ceil(len / 0.5);
        for (let s = 1; s < m; s++) {
          const [x, z] = project(exit[0] + ((e[0] - exit[0]) * s) / m, exit[1] + ((e[1] - exit[1]) * s) / m);
          cur.push(x, z);
        }
      }
      if (q === n) {
        break;
      }
      cur.push(e[0], e[1]);
    }
    if (q === n) {
      break;
    }
    if (f[i] > 0) {
      cur.push(P[i * 2], P[i * 2 + 1]);
      const k = (i + 1) % n;
      if (f[k] <= 0) {
        const t = f[i] / (f[i] - f[k]);
        exit = project(P[i * 2] + (P[k * 2] - P[i * 2]) * t, P[i * 2 + 1] + (P[k * 2 + 1] - P[i * 2 + 1]) * t);
        cur.push(exit[0], exit[1]);
      }
    }
  }
  if (cur.length >= 6) {
    rings.push(cur);
  }
  return rings;
}

/** Distance (m) to the nearest track centre line, exact up to `reach` (farther: Infinity), over a segment grid. */
export function trackDistanceIndex(tracks: readonly { pts: readonly number[] }[], reach: number): (x: number, z: number) => number {
  const grid = new BoxGrid(16);
  const segs: number[] = [];
  for (const t of tracks) {
    const p = t.pts;
    for (let k = 2; k < p.length; k += 2) {
      const id = segs.push(p[k - 2], p[k - 1], p[k], p[k + 1]) / 4 - 1;
      grid.add(id, Math.min(p[k - 2], p[k]) - reach, Math.min(p[k - 1], p[k + 1]) - reach, Math.max(p[k - 2], p[k]) + reach, Math.max(p[k - 1], p[k + 1]) + reach);
    }
  }
  return (x, z) => {
    let d = Infinity;
    for (const id of grid.at(x, z)) {
      const o = id * 4;
      d = Math.min(d, segDist(x, z, segs[o], segs[o + 1], segs[o + 2], segs[o + 3]));
    }
    return d <= reach ? d : Infinity;
  };
}

/** The pieces of `tracks` with a segment within `margin` m of the box of `ring` (short lists for trackDistance). */
export function tracksNear(tracks: readonly { pts: readonly number[] }[], ring: readonly number[], margin: number): { pts: number[] }[] {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let k = 0; k < ring.length; k += 2) {
    minX = Math.min(minX, ring[k]);
    maxX = Math.max(maxX, ring[k]);
    minZ = Math.min(minZ, ring[k + 1]);
    maxZ = Math.max(maxZ, ring[k + 1]);
  }
  const out: { pts: number[] }[] = [];
  for (const t of tracks) {
    const p = t.pts;
    let cur: number[] = [];
    for (let k = 2; k < p.length; k += 2) {
      const near = Math.max(p[k - 2], p[k]) >= minX - margin && Math.min(p[k - 2], p[k]) <= maxX + margin && Math.max(p[k - 1], p[k + 1]) >= minZ - margin && Math.min(p[k - 1], p[k + 1]) <= maxZ + margin;
      if (near) {
        if (!cur.length) {
          cur.push(p[k - 2], p[k - 1]);
        }
        cur.push(p[k], p[k + 1]);
      } else if (cur.length) {
        out.push({ pts: cur });
        cur = [];
      }
    }
    if (cur.length) {
      out.push({ pts: cur });
    }
  }
  return out;
}

/**
 * Clearance (m) from (x, z) to the nearest tram track bed edge (tramBedHalf of its gauge), negative inside a bed;
 * exact up to `reach` m (farther: Infinity), over a segment grid. Crossing paint (zebra bars) keeps this >= 0 in every
 * layer: the world compiler's placement rule `paint.zebraTrack` and the runtime slice's decals.
 */
export function trackBedClearanceIndex(tracks: readonly { pts: readonly number[]; gauge: number }[], reach: number): (x: number, z: number) => number {
  const grid = new BoxGrid(16);
  const segs: number[] = [];
  for (const t of tracks) {
    const p = t.pts;
    const half = tramBedHalf(t.gauge);
    const r = reach + half;
    for (let k = 2; k < p.length; k += 2) {
      const id = segs.push(p[k - 2], p[k - 1], p[k], p[k + 1], half) / 5 - 1;
      grid.add(id, Math.min(p[k - 2], p[k]) - r, Math.min(p[k - 1], p[k + 1]) - r, Math.max(p[k - 2], p[k]) + r, Math.max(p[k - 1], p[k + 1]) + r);
    }
  }
  return (x, z) => {
    let d = Infinity;
    for (const id of grid.at(x, z)) {
      const o = id * 5;
      d = Math.min(d, segDist(x, z, segs[o], segs[o + 1], segs[o + 2], segs[o + 3]) - segs[o + 4]);
    }
    return d <= reach ? d : Infinity;
  };
}
