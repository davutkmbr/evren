import type { GeoQuery } from '../../../core/contracts';
import type { P2 } from './path';

/** Water clearance (m): distance to the nearest shore over water, negative on land. */
export function clearance(geo: GeoQuery, x: number, z: number): number {
  return -geo.coastDistance(x, z);
}

/** Gradient of the clearance field (unit vector pointing away from the nearest shore). */
export function clearanceGradient(geo: GeoQuery, x: number, z: number, out: P2, h = 15): P2 {
  const gx = clearance(geo, x + h, z) - clearance(geo, x - h, z);
  const gz = clearance(geo, x, z + h) - clearance(geo, x, z - h);
  const l = Math.hypot(gx, gz);
  if (l < 1e-6) {
    out.x = 0;
    out.z = 0;
  } else {
    out.x = gx / l;
    out.z = gz / l;
  }
  return out;
}

/** Moves a point along the clearance gradient until it has at least `minClear` metres of water around it. */
export function pushToWater(geo: GeoQuery, p: P2, minClear: number, maxIter = 40): P2 {
  const g = { x: 0, z: 0 };
  const out = { ...p };
  for (let i = 0; i < maxIter; i++) {
    const c = clearance(geo, out.x, out.z);
    if (c >= minClear) break;
    clearanceGradient(geo, out.x, out.z, g, Math.max(10, Math.min(60, Math.abs(c) * 0.5 + 10)));
    if (g.x === 0 && g.z === 0) break;
    const step = Math.min(Math.max(minClear - c, 5), 400);
    out.x += g.x * step;
    out.z += g.z * step;
  }
  return out;
}

/**
 * Re-centres polyline points on the channel's medial line: for every point the cross-section (perpendicular to the
 * local direction) is scanned and the point moves to the water position with the largest clearance, as long as land
 * is found on both sides within `maxHalfWidth`. Open water points are left untouched.
 */
export function centreInChannel(geo: GeoQuery, points: P2[], maxHalfWidth = 2200, step = 20): P2[] {
  const n = points.length;
  const out: P2[] = [];
  for (let i = 0; i < n; i++) {
    const a = points[Math.max(i - 1, 0)];
    const b = points[Math.min(i + 1, n - 1)];
    let tx = b.x - a.x;
    let tz = b.z - a.z;
    const l = Math.hypot(tx, tz) || 1;
    tx /= l;
    tz /= l;
    const rx = -tz;
    const rz = tx;
    const p = points[i];
    let left = -1;
    let right = -1;
    for (let d = 0; d <= maxHalfWidth; d += step) {
      if (right < 0 && clearance(geo, p.x + rx * d, p.z + rz * d) <= 0) right = d;
      if (left < 0 && clearance(geo, p.x - rx * d, p.z - rz * d) <= 0) left = d;
      if (left >= 0 && right >= 0) break;
    }
    if (left < 0 || right < 0) {
      out.push({ ...p });
      continue;
    }
    // Best clearance along the section between the two shores.
    let best = -Infinity;
    let bestD = 0;
    for (let d = -left; d <= right; d += step) {
      const c = clearance(geo, p.x + rx * d, p.z + rz * d);
      if (c > best) {
        best = c;
        bestD = d;
      }
    }
    out.push({ x: p.x + rx * bestD, z: p.z + rz * bestD });
  }
  return out;
}

/** Channel half-width estimate at a point (clearance of the medial point). */
export function channelHalfWidth(geo: GeoQuery, p: P2): number {
  return Math.max(clearance(geo, p.x, p.z), 0);
}

/** True when the straight segment a -> b keeps at least `minClear` metres from shore (sampled every `step` m). */
export function segmentClear(geo: GeoQuery, a: P2, b: P2, minClear: number, step = 25): boolean {
  const d = Math.hypot(b.x - a.x, b.z - a.z);
  const n = Math.max(1, Math.ceil(d / step));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    if (clearance(geo, a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t) < minClear) return false;
  }
  return true;
}
