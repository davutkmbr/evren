/**
 * Street infrastructure placement (worker): traffic signals at OSM signal nodes (one pole per approach, facing the
 * traffic, with a stop line), the yellow bus stop bays on the carriageway, T1 / T5 stop canopies with ticket gates
 * on the tram platforms, and retractable bollards across the mouths of pedestrian streets (İstiklal, Galip Dede...).
 *
 * Benches, bins, sidewalk bollards and İETT shelters belong to the details layer (it seats and queues people at
 * them); this pass only leaves room for them.
 */
import type { OsmData, OsmRoad } from '../data';
import type { FootprintIndex } from '../shared/footprints';
import { hash, ringArea, segDist } from '../shared/geometry';
import { CARRIAGEWAY_KINDS, streetTramTracks, type Street } from '../shared/street-field';
import type { StreetSurface } from '../shared/street-surface';
import { type PropSink, Spacing, yawTowards } from './sink';

/** Painted marks the decals pass draws: stop lines and bus stop bays (centre, unit direction along the kerb). */
export interface Marks {
  /** x, z, tx, tz (travel direction), half width across the lanes. */
  stopLines: number[];
  /** x, z, tx, tz (along the kerb), side (+1: kerb on the right of t). */
  busBays: number[];
}

type Pts = readonly number[];

/** Vertex index of junction ref `ref` in `road`, or -1. */
function vertexOf(road: OsmRoad, ref: number): number {
  const r = road.refs;
  if (!r) {
    return -1;
  }
  for (let k = 0; k < r.length; k += 2) {
    if (r[k + 1] === ref) {
      return r[k];
    }
  }
  return -1;
}

/** Nearest point on any street centre line within `max` m: street index, closest point, unit tangent. */
function nearestStreet(streets: readonly Street[], x: number, z: number, max: number, accept?: (s: Street) => boolean): { s: number; px: number; pz: number; tx: number; tz: number; dist: number } | null {
  let best: { s: number; px: number; pz: number; tx: number; tz: number; dist: number } | null = null;
  streets.forEach((st, si) => {
    if (accept && !accept(st)) {
      return;
    }
    const p = st.pts;
    for (let k = 2; k < p.length; k += 2) {
      const ax = p[k - 2];
      const az = p[k - 1];
      const bx = p[k];
      const bz = p[k + 1];
      if (Math.min(ax, bx) - max > x || Math.max(ax, bx) + max < x || Math.min(az, bz) - max > z || Math.max(az, bz) + max < z) {
        continue;
      }
      const d = segDist(x, z, ax, az, bx, bz);
      if (d < max && (!best || d < best.dist)) {
        const l = Math.hypot(bx - ax, bz - az) || 1;
        const tx = (bx - ax) / l;
        const tz = (bz - az) / l;
        const t = Math.max(0, Math.min(l, (x - ax) * tx + (z - az) * tz));
        best = { s: si, px: ax + tx * t, pz: az + tz * t, tx, tz, dist: d };
      }
    }
  });
  return best;
}

/** Centre, long axis (unit) and half length of a ring (PCA of its vertices, centred on the extent). */
export function ringAxis(r: readonly number[]): { cx: number; cz: number; ax: number; az: number; half: number; width: number } {
  const n = r.length / 2;
  let cx = 0;
  let cz = 0;
  for (let k = 0; k < n; k++) {
    cx += r[k * 2];
    cz += r[k * 2 + 1];
  }
  cx /= n;
  cz /= n;
  let sxx = 0;
  let szz = 0;
  let sxz = 0;
  for (let k = 0; k < n; k++) {
    const dx = r[k * 2] - cx;
    const dz = r[k * 2 + 1] - cz;
    sxx += dx * dx;
    szz += dz * dz;
    sxz += dx * dz;
  }
  const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  const ax = Math.cos(ang);
  const az = Math.sin(ang);
  let lo = Infinity;
  let hi = -Infinity;
  let wlo = Infinity;
  let whi = -Infinity;
  for (let k = 0; k < n; k++) {
    const dx = r[k * 2] - cx;
    const dz = r[k * 2 + 1] - cz;
    const s = dx * ax + dz * az;
    const w = -dx * az + dz * ax;
    lo = Math.min(lo, s);
    hi = Math.max(hi, s);
    wlo = Math.min(wlo, w);
    whi = Math.max(whi, w);
  }
  const mid = (lo + hi) / 2;
  const wmid = (wlo + whi) / 2;
  return { cx: cx + ax * mid - az * wmid, cz: cz + az * mid + ax * wmid, ax, az, half: (hi - lo) / 2, width: whi - wlo };
}

export function buildFurniture(
  streets: readonly Street[],
  data: Pick<OsmData, 'roads' | 'points' | 'areas' | 'lines' | 'rails'>,
  surface: StreetSurface,
  footprints: FootprintIndex,
  sink: PropSink,
): { marks: Marks; stats: Record<string, number> } {
  const { geo } = surface;
  const marks: Marks = { stopLines: [], busBays: [] };
  const blocked = (x: number, z: number): boolean => footprints.inside(x, z) || geo.isWater(x, z);
  const streetOfRoad = new Map<number, Street>();
  for (const s of streets) {
    streetOfRoad.set(s.road, s);
  }

  // Traffic signals: a pole at the right kerb of every approach, a stop line across its lanes.
  const signalSpacing = new Spacing(8);
  for (const p of data.points) {
    if (p.kind !== 'highway=traffic_signals' || p.ref === undefined || !p.roads) {
      continue;
    }
    for (const ri of p.roads) {
      const road = data.roads[ri];
      const s = streetOfRoad.get(ri);
      if (!road || !s || !CARRIAGEWAY_KINDS.has(road.kind) || s.pedestrian) {
        continue;
      }
      const v = vertexOf(road, p.ref);
      if (v < 0) {
        continue;
      }
      const pts: Pts = road.pts;
      // Approaches: from the previous vertex (travel +) and, on two-way roads, from the next one (travel -).
      const approaches: number[] = [];
      if (v > 0 && p.direction !== 'backward') {
        approaches.push(v - 1);
      }
      if (!road.oneway && v < pts.length / 2 - 1 && p.direction !== 'forward') {
        approaches.push(v + 1);
      }
      for (const u of approaches) {
        const ax = pts[u * 2];
        const az = pts[u * 2 + 1];
        const l = Math.hypot(p.x - ax, p.z - az);
        if (l < 2) {
          continue;
        }
        const tx = (p.x - ax) / l;
        const tz = (p.z - az) / l;
        const rx = -tz;
        const rz = tx;
        const back = Math.min(3, l * 0.4);
        const px = p.x - tx * back + rx * (s.hw + 0.55);
        const pz = p.z - tz * back + rz * (s.hw + 0.55);
        if (blocked(px, pz) || surface.distance(px, pz) < 0.1) {
          continue;
        }
        if (signalSpacing.claim(px, pz, 4)) {
          sink.add('signal', px, surface.heightAt(px, pz) - 0.03, pz, yawTowards(-tx, -tz));
        }
        const sl = Math.min(l * 0.8, back + 1.2);
        const half = road.oneway ? s.hw - 0.3 : s.hw / 2 - 0.2;
        const off = road.oneway ? 0 : s.hw / 2;
        marks.stopLines.push(p.x - tx * sl + rx * off, p.z - tz * sl + rz * off, tx, tz, half);
      }
    }
  }

  // Bus stops: the yellow bay on the carriageway along the kerb (the shelter itself is the details layer's).
  let bays = 0;
  for (const p of data.points) {
    if (p.kind !== 'highway=bus_stop') {
      continue;
    }
    const near = nearestStreet(streets, p.x, p.z, 25, (s) => s.kerbed && !s.pedestrian && s.hw >= 3);
    if (!near) {
      continue;
    }
    const s = streets[near.s];
    const rx = -near.tz;
    const rz = near.tx;
    const side = s.oneway ? 1 : (p.x - near.px) * rx + (p.z - near.pz) * rz < -0.3 ? -1 : 1;
    marks.busBays.push(near.px + rx * side * (s.hw - 1.4), near.pz + rz * side * (s.hw - 1.4), near.tx, near.tz, side);
    bays++;
  }

  // Tram stop canopies along surface platforms (open towards the nearest track) and ticket gates at the ends.
  const tracks = streetTramTracks(data);
  let canopies = 0;
  for (const a of data.areas) {
    if (a.kind !== 'railway=platform' || (a.layer ?? 0) < 0 || Math.abs(ringArea(a.ring)) < 40) {
      continue;
    }
    const { cx, cz, ax, az, half } = ringAxis(a.ring);
    let best = Infinity;
    let fx = 0;
    let fz = 0;
    for (const t of tracks) {
      for (let k = 2; k < t.pts.length; k += 2) {
        const d = segDist(cx, cz, t.pts[k - 2], t.pts[k - 1], t.pts[k], t.pts[k + 1]);
        if (d < best) {
          best = d;
          const nx = -az;
          const nz = ax;
          const mx = (t.pts[k - 2] + t.pts[k]) / 2 - cx;
          const mz = (t.pts[k - 1] + t.pts[k + 1]) / 2 - cz;
          const sgn = mx * nx + mz * nz < 0 ? -1 : 1;
          fx = nx * sgn;
          fz = nz * sgn;
        }
      }
    }
    if (best > 12 || half < 8) {
      continue;
    }
    const count = half > 22 ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const f = count === 1 ? 0 : (i - 0.5) * 14;
      const px = cx + ax * f;
      const pz = cz + az * f;
      if (!blocked(px, pz)) {
        sink.add('tramCanopy', px, surface.heightAt(px, pz), pz, yawTowards(fx, fz));
        canopies++;
      }
    }
    for (const end of [-1, 1]) {
      if (hash(a.id * 0.37 + end) < 0.35) {
        continue;
      }
      const ex = cx + ax * end * (half - 2.2);
      const ez = cz + az * end * (half - 2.2);
      if (!blocked(ex, ez)) {
        sink.add('ticketGate', ex, surface.heightAt(ex, ez), ez, yawTowards(-az, ax));
      }
    }
  }

  // Retractable bollards across pedestrian street mouths (unless OSM maps a barrier there).
  const osmBarriers = new Spacing(8);
  for (const p of data.points) {
    if (p.kind === 'barrier=bollard' || p.kind === 'barrier=gate' || p.kind === 'barrier=lift_gate') {
      osmBarriers.add(p.x, p.z);
    }
  }
  const mouths = new Spacing(12);
  let mouthBollards = 0;
  for (const s of streets) {
    if (!s.pedestrian || s.hw < 1.8) {
      continue;
    }
    const n = s.pts.length / 2;
    for (const end of [0, n - 1]) {
      const x0 = s.pts[end * 2];
      const z0 = s.pts[end * 2 + 1];
      const nb = end === 0 ? 1 : n - 2;
      let tx = s.pts[nb * 2] - x0;
      let tz = s.pts[nb * 2 + 1] - z0;
      const l = Math.hypot(tx, tz);
      if (l < 4) {
        continue;
      }
      tx /= l;
      tz /= l;
      // The end must meet a vehicular street: step back out of the pedestrian street and look for its carriageway.
      const ox = x0 - tx * 1.5;
      const oz = z0 - tz * 1.5;
      if (!(surface.distance(ox, oz) < 0 && !surface.pedestrianStreet(ox, oz))) {
        continue;
      }
      const mx = x0 + tx * 2.5;
      const mz = z0 + tz * 2.5;
      if (!osmBarriers.free(mx, mz, 7) || !mouths.claim(mx, mz, 10)) {
        continue;
      }
      const half = Math.min(s.hw - 0.4, 6);
      const count = Math.max(2, Math.round((half * 2) / 1.5) + 1);
      for (let i = 0; i < count; i++) {
        const o = -half + (i * half * 2) / (count - 1);
        const bx = mx - tz * o;
        const bz = mz + tx * o;
        if (!blocked(bx, bz) && surface.buildingDistance(bx, bz) > 0.6) {
          sink.add('bollard', bx, surface.heightAt(bx, bz) - 0.02, bz, 0);
          mouthBollards++;
        }
      }
    }
  }

  return {
    marks,
    stats: {
      signals: sink.count('signal'),
      busBays: bays,
      canopies,
      gates: sink.count('ticketGate'),
      mouthBollards,
    },
  };
}
