/**
 * Keeps vehicle ways on land. OSM carriageways and rails can run where the flight world has sea: tunnels under the
 * Bosphorus / Marmara (Avrasya Tüneli, Marmaray), reclaimed ground the geo coastline does not have (ports, fills).
 * Drawn at ground level they became lane paint and traffic on open water. Every region's data passes through
 * clipWaysToLand() before its layers are built: the parts of non-bridge carriageways and rails that lie over water
 * are cut away (bridges keep their decks; footways keep piers). Point features are re-linked to the remaining ways.
 */
import type { OsmData, OsmPoint, OsmRail, OsmRoad } from '../data';
import { CARRIAGEWAY_KINDS } from './street-field';

/** A sample counts as water this far (m) beyond the coastline (quay roads sit right at 0). */
const WATER_MARGIN = 6;
/** Sample spacing (m) along a way. */
const STEP = 4;
/** Water runs shorter than this (m) are kept (coastline noise). */
const MIN_WATER_RUN = 12;
/** Land pieces shorter than this (m) are dropped. */
const MIN_LAND_RUN = 8;

type Way = OsmRoad | OsmRail;

export interface LandClipStats {
  /** Ways shortened or split. */
  clipped: number;
  /** Ways removed entirely (wholly over water). */
  removed: number;
  /** Metres of way removed. */
  metres: number;
}

/**
 * Pieces of `way` on land (the way itself when nothing is over water). Vertices are inserted where a piece starts or
 * ends between two vertices; junction refs stay on the vertices they were on.
 */
function landPieces<T extends Way>(way: T, water: (x: number, z: number) => boolean, stats: LandClipStats): T[] {
  const p = way.pts;
  const n = p.length / 2;
  // Per segment: sample flags (true = water), with the arc length of every sample.
  const samples: { x: number; z: number; seg: number; t: number; wet: boolean }[] = [];
  for (let i = 0; i < n - 1; i++) {
    const ax = p[i * 2];
    const az = p[i * 2 + 1];
    const bx = p[i * 2 + 2];
    const bz = p[i * 2 + 3];
    const len = Math.hypot(bx - ax, bz - az);
    const k = Math.max(1, Math.ceil(len / STEP));
    for (let s = 0; s < k; s++) {
      const t = s / k;
      const x = ax + (bx - ax) * t;
      const z = az + (bz - az) * t;
      samples.push({ x, z, seg: i, t, wet: water(x, z) });
    }
  }
  samples.push({ x: p[p.length - 2], z: p[p.length - 1], seg: n - 1, t: 0, wet: water(p[p.length - 2], p[p.length - 1]) });
  // Runs of water samples long enough to count.
  const cut = new Uint8Array(samples.length);
  let anyCut = false;
  for (let a = 0; a < samples.length; ) {
    if (!samples[a].wet) {
      a++;
      continue;
    }
    let b = a;
    while (b + 1 < samples.length && samples[b + 1].wet) {
      b++;
    }
    const runM = (b - a + 1) * STEP;
    if (runM >= MIN_WATER_RUN) {
      cut.fill(1, a, b + 1);
      anyCut = true;
    }
    a = b + 1;
  }
  if (!anyCut) {
    return [way];
  }
  const refAt = new Map<number, number>();
  for (let k = 0; k + 1 < (way.refs?.length ?? 0); k += 2) {
    refAt.set(way.refs![k], way.refs![k + 1]);
  }
  const pieces: T[] = [];
  let a = 0;
  while (a < samples.length) {
    if (cut[a]) {
      a++;
      continue;
    }
    let b = a;
    while (b + 1 < samples.length && !cut[b + 1]) {
      b++;
    }
    // Piece from sample a to sample b: its own sample points plus every original vertex in between.
    const pts: number[] = [];
    const refs: number[] = [];
    const push = (x: number, z: number, ref?: number): void => {
      const l = pts.length;
      if (l >= 2 && Math.hypot(pts[l - 2] - x, pts[l - 1] - z) < 0.05) {
        return;
      }
      if (ref !== undefined) {
        refs.push(l / 2, ref);
      }
      pts.push(x, z);
    };
    const sa = samples[a];
    const sb = samples[b];
    push(sa.x, sa.z, sa.t === 0 ? refAt.get(sa.seg) : undefined);
    for (let v = sa.seg + 1; v <= sb.seg; v++) {
      push(p[v * 2], p[v * 2 + 1], refAt.get(v));
    }
    push(sb.x, sb.z, sb.t === 0 ? refAt.get(sb.seg) : undefined);
    let len = 0;
    for (let k = 2; k < pts.length; k += 2) {
      len += Math.hypot(pts[k] - pts[k - 2], pts[k + 1] - pts[k - 1]);
    }
    if (pts.length >= 4 && len >= MIN_LAND_RUN) {
      const piece = { ...way, pts } as T;
      if (refs.length) {
        piece.refs = refs;
      } else {
        delete piece.refs;
      }
      pieces.push(piece);
    }
    a = b + 1;
  }
  let total = 0;
  for (let k = 2; k < p.length; k += 2) {
    total += Math.hypot(p[k] - p[k - 2], p[k + 1] - p[k - 1]);
  }
  let kept = 0;
  for (const w of pieces) {
    for (let k = 2; k < w.pts.length; k += 2) {
      kept += Math.hypot(w.pts[k] - w.pts[k - 2], w.pts[k + 1] - w.pts[k - 1]);
    }
  }
  stats.metres += Math.max(0, total - kept);
  if (pieces.length) {
    stats.clipped++;
  } else {
    stats.removed++;
  }
  return pieces;
}

/** Re-links point features to the ways through their junction ref (data.ts OsmPoint.roads / rails). */
function relink(points: OsmPoint[], roads: readonly OsmRoad[], rails: readonly OsmRail[]): void {
  const index = (list: readonly Way[]): Map<number, number[]> => {
    const m = new Map<number, number[]>();
    list.forEach((w, i) => {
      for (let k = 1; k < (w.refs?.length ?? 0); k += 2) {
        const ref = w.refs![k];
        const l = m.get(ref) ?? [];
        if (!l.includes(i)) {
          l.push(i);
        }
        m.set(ref, l);
      }
    });
    return m;
  };
  const byRoad = index(roads);
  const byRail = index(rails);
  for (const pt of points) {
    if (pt.ref === undefined) {
      continue;
    }
    const r = byRoad.get(pt.ref);
    const t = byRail.get(pt.ref);
    if (r) {
      pt.roads = r;
    } else {
      delete pt.roads;
    }
    if (t) {
      pt.rails = t;
    } else {
      delete pt.rails;
    }
  }
}

/**
 * Cuts the water parts out of the non-bridge carriageways and rails of `data` (in place). `coast` is the flight
 * world's signed coast distance (m, positive on land).
 */
export function clipWaysToLand(data: OsmData, coast: (x: number, z: number) => number): LandClipStats {
  const stats: LandClipStats = { clipped: 0, removed: 0, metres: 0 };
  const water = (x: number, z: number): boolean => coast(x, z) < -WATER_MARGIN;
  const clip = <T extends Way>(list: T[], vehicle: (w: T) => boolean): T[] => {
    const out: T[] = [];
    for (const w of list) {
      if (w.bridge || !vehicle(w) || w.pts.length < 4) {
        out.push(w);
      } else {
        out.push(...landPieces(w, water, stats));
      }
    }
    return out;
  };
  const roads = clip(data.roads, (r) => CARRIAGEWAY_KINDS.has(r.kind));
  const rails = clip(data.rails, () => true);
  if (stats.clipped || stats.removed) {
    data.roads = roads;
    data.rails = rails;
    relink(data.points, roads, rails);
  }
  stats.metres = Math.round(stats.metres);
  return stats;
}
