/**
 * Lines drawn on the OSM street ground that other surfaces must continue: tram track centrelines and painted lane
 * lines. One definition for the decals that draw them (streets/decals.ts) and for the modules that join the ground
 * (bridge decks: their rails and lane lines follow these at a landed end, structures/build/deck-joint.ts).
 */
import { Surf, type Street } from './street-field';

/** Carriageway kinds that get lane paint. */
const LANE_KINDS = /^(trunk|primary|secondary|tertiary)/;

export interface LaneLine {
  /** Lateral offset (m) from the way centreline, positive to the right of the way direction (-tz, tx). */
  offset: number;
  halfWidth: number;
  /** Dash and gap length (m); solid without. */
  dash?: [number, number];
}

/** Painted lane lines of a street (none on non-asphalt, narrow or minor streets). */
export function laneLines(s: Street): LaneLine[] {
  if (s.surf !== Surf.Asphalt || s.hw < 2.9 || !LANE_KINDS.test(s.kind)) {
    return [];
  }
  const lanes = s.lanes || Math.max(s.oneway ? 1 : 2, Math.round((s.hw * 2) / 3.3));
  const out: LaneLine[] = [];
  if (!s.oneway) {
    if (s.hw >= 5.5) {
      out.push({ offset: -0.12, halfWidth: 0.06 }, { offset: 0.12, halfWidth: 0.06 });
    } else {
      out.push({ offset: 0, halfWidth: 0.07, dash: [3, 5] });
    }
    const perDir = Math.max(1, Math.floor(lanes / 2));
    const lw = s.hw / perDir;
    for (let l = 1; l < perDir; l++) {
      out.push({ offset: l * lw, halfWidth: 0.06, dash: [3, 6] }, { offset: -l * lw, halfWidth: 0.06, dash: [3, 6] });
    }
  } else if (lanes >= 2) {
    const lw = (s.hw * 2) / lanes;
    for (let l = 1; l < lanes; l++) {
      out.push({ offset: -s.hw + l * lw, halfWidth: 0.06, dash: [3, 6] });
    }
  }
  return out;
}

export type GroundLineKind = 'track' | 'lane';

export interface GroundLine {
  kind: GroundLineKind;
  /** Polyline x, z pairs. */
  pts: number[];
}

/** `pts` offset by `o` m to the right of its direction (vertex normals averaged over the adjacent segments). */
function offsetPolyline(pts: readonly number[], o: number): number[] {
  const n = pts.length / 2;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    let rx = 0;
    let rz = 0;
    for (const [a, b] of [
      [i - 1, i],
      [i, i + 1],
    ]) {
      if (a < 0 || b >= n) {
        continue;
      }
      const dx = pts[b * 2] - pts[a * 2];
      const dz = pts[b * 2 + 1] - pts[a * 2 + 1];
      const l = Math.hypot(dx, dz) || 1;
      rx += -dz / l;
      rz += dx / l;
    }
    const l = Math.hypot(rx, rz) || 1;
    out.push(pts[i * 2] + (rx / l) * o, pts[i * 2 + 1] + (rz / l) * o);
  }
  return out;
}

/** Tram track centrelines (the street tram tracks as drawn, StreetSurface.tramTracks) and lane lines of `streets`. */
export function groundLines(tracks: readonly { pts: number[] }[], streets: readonly Street[]): GroundLine[] {
  const out: GroundLine[] = tracks.map((t) => ({ kind: 'track' as const, pts: t.pts }));
  for (const s of streets) {
    for (const l of laneLines(s)) {
      out.push({ kind: 'lane', pts: offsetPolyline(s.pts, l.offset) });
    }
  }
  return out;
}

export interface GroundLineCrossing {
  /** Distance (m) from a along a-b. */
  t: number;
  kind: GroundLineKind;
}

/**
 * Where `lines` cross the segment a-b. A line ending up to `reach` m short of the segment (a street track or lane
 * line stopping where a bridge way begins) is extended along its last segment.
 */
export function linesCrossing(lines: readonly GroundLine[], ax: number, az: number, bx: number, bz: number, reach: number): GroundLineCrossing[] {
  const ux = bx - ax;
  const uz = bz - az;
  const len = Math.hypot(ux, uz);
  if (len < 1e-6) {
    return [];
  }
  const out: GroundLineCrossing[] = [];
  const minX = Math.min(ax, bx) - reach;
  const maxX = Math.max(ax, bx) + reach;
  const minZ = Math.min(az, bz) - reach;
  const maxZ = Math.max(az, bz) + reach;
  // Segment p-q against a-b: t along a-b (0..len) and the parameter along p-q.
  const cross = (px: number, pz: number, qx: number, qz: number): { t: number; v: number } | null => {
    const vx = qx - px;
    const vz = qz - pz;
    const den = ux * vz - uz * vx;
    if (Math.abs(den) < 1e-9) {
      return null;
    }
    const wx = px - ax;
    const wz = pz - az;
    const u = (wx * vz - wz * vx) / den;
    const v = (wx * uz - wz * ux) / den;
    return { t: u * len, v };
  };
  for (const line of lines) {
    const p = line.pts;
    const n = p.length / 2;
    let near = false;
    for (let i = 0; i < n && !near; i++) {
      near = p[i * 2] >= minX && p[i * 2] <= maxX && p[i * 2 + 1] >= minZ && p[i * 2 + 1] <= maxZ;
    }
    if (!near || n < 2) {
      continue;
    }
    let hit = false;
    for (let i = 1; i < n; i++) {
      const c = cross(p[i * 2 - 2], p[i * 2 - 1], p[i * 2], p[i * 2 + 1]);
      if (c && c.v >= 0 && c.v <= 1 && c.t >= 0 && c.t <= len) {
        out.push({ t: c.t, kind: line.kind });
        hit = true;
      }
    }
    if (hit) {
      continue;
    }
    // Extend the end segments (as rays beyond their end vertex) by up to `reach` m.
    for (const [i0, i1] of [
      [1, 0],
      [n - 2, n - 1],
    ]) {
      const sx = p[i1 * 2] - p[i0 * 2];
      const sz = p[i1 * 2 + 1] - p[i0 * 2 + 1];
      const sl = Math.hypot(sx, sz);
      if (sl < 1e-3) {
        continue;
      }
      const c = cross(p[i1 * 2], p[i1 * 2 + 1], p[i1 * 2] + (sx / sl) * reach, p[i1 * 2 + 1] + (sz / sl) * reach);
      if (c && c.v >= 0 && c.v <= 1 && c.t >= 0 && c.t <= len) {
        out.push({ t: c.t, kind: line.kind });
      }
    }
  }
  return out.sort((a, b) => a.t - b.t);
}
