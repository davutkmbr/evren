import type { FlatRing } from '../types';
import type { GridSpec } from './grid';

/**
 * Even-odd scanline fill of a set of rings at cell centers. `span(row, c0, c1)` receives inclusive column ranges.
 * O(edges·rows spanned + filled cells) — no per-cell point-in-polygon tests.
 */
export function scanFill(rings: readonly FlatRing[], g: GridSpec, span: (row: number, c0: number, c1: number) => void): void {
  const n = g.size;
  const counts = new Int32Array(n + 1);
  const rowRange = (za: number, zb: number): [number, number] => {
    const lo = Math.min(za, zb);
    const hi = Math.max(za, zb);
    const r0 = Math.max(0, Math.ceil((lo - g.origin) / g.cell));
    const r1 = Math.min(n - 1, Math.ceil((hi - g.origin) / g.cell) - 1);
    return [r0, r1];
  };
  for (const ring of rings) {
    const m = ring.length >> 1;
    for (let i = 0; i < m; i++) {
      const j = (i + 1) % m;
      const za = ring[i * 2 + 1];
      const zb = ring[j * 2 + 1];
      if (za === zb) {
        continue;
      }
      const [r0, r1] = rowRange(za, zb);
      for (let r = r0; r <= r1; r++) {
        counts[r + 1]++;
      }
    }
  }
  for (let r = 0; r < n; r++) {
    counts[r + 1] += counts[r];
  }
  const xs = new Float64Array(counts[n]);
  const fill = counts.slice(0, n);
  for (const ring of rings) {
    const m = ring.length >> 1;
    for (let i = 0; i < m; i++) {
      const j = (i + 1) % m;
      const xa = ring[i * 2];
      const za = ring[i * 2 + 1];
      const xb = ring[j * 2];
      const zb = ring[j * 2 + 1];
      if (za === zb) {
        continue;
      }
      const [r0, r1] = rowRange(za, zb);
      const k = (xb - xa) / (zb - za);
      for (let r = r0; r <= r1; r++) {
        const zc = g.origin + r * g.cell;
        xs[fill[r]++] = xa + (zc - za) * k;
      }
    }
  }
  for (let r = 0; r < n; r++) {
    const a = counts[r];
    const b = counts[r + 1];
    if (b - a < 2) {
      continue;
    }
    const row = xs.subarray(a, b).sort();
    for (let i = 0; i + 1 < row.length; i += 2) {
      const c0 = Math.max(0, Math.ceil((row[i] - g.origin) / g.cell));
      const c1 = Math.min(n - 1, Math.ceil((row[i + 1] - g.origin) / g.cell) - 1);
      if (c1 >= c0) {
        span(r, c0, c1);
      }
    }
  }
}

/** Writes `value` into every cell inside the rings (even-odd). */
export function fillRingsValue(rings: readonly FlatRing[], g: GridSpec, target: Uint8Array, value: number): void {
  scanFill(rings, g, (row, c0, c1) => {
    target.fill(value, row * g.size + c0, row * g.size + c1 + 1);
  });
}

/**
 * Visits every cell whose center is within `halfWidth` of the polyline (flat x,z pairs).
 * `visit(index, distance, segmentIndex, t)`; cells may be visited more than once (once per nearby segment).
 */
export function stampPolyline(
  pts: Float64Array,
  halfWidth: number,
  g: GridSpec,
  visit: (index: number, distance: number, segment: number, t: number) => void,
): void {
  const n = g.size;
  const m = pts.length >> 1;
  for (let s = 0; s + 1 < m; s++) {
    const ax = pts[s * 2];
    const az = pts[s * 2 + 1];
    const bx = pts[s * 2 + 2];
    const bz = pts[s * 2 + 3];
    const dx = bx - ax;
    const dz = bz - az;
    const len2 = dx * dx + dz * dz;
    const c0 = Math.max(0, Math.floor((Math.min(ax, bx) - halfWidth - g.origin) / g.cell));
    const c1 = Math.min(n - 1, Math.ceil((Math.max(ax, bx) + halfWidth - g.origin) / g.cell));
    const r0 = Math.max(0, Math.floor((Math.min(az, bz) - halfWidth - g.origin) / g.cell));
    const r1 = Math.min(n - 1, Math.ceil((Math.max(az, bz) + halfWidth - g.origin) / g.cell));
    for (let r = r0; r <= r1; r++) {
      const z = g.origin + r * g.cell;
      for (let c = c0; c <= c1; c++) {
        const x = g.origin + c * g.cell;
        let t = len2 > 0 ? ((x - ax) * dx + (z - az) * dz) / len2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = ax + dx * t - x;
        const ez = az + dz * t - z;
        const d = Math.sqrt(ex * ex + ez * ez);
        if (d <= halfWidth) {
          visit(r * n + c, d, s, t);
        }
      }
    }
  }
}

/** Visits every cell whose center lies within `radius` of (x, z). */
export function stampDisc(x: number, z: number, radius: number, g: GridSpec, visit: (index: number, distance: number) => void): void {
  const n = g.size;
  const c0 = Math.max(0, Math.floor((x - radius - g.origin) / g.cell));
  const c1 = Math.min(n - 1, Math.ceil((x + radius - g.origin) / g.cell));
  const r0 = Math.max(0, Math.floor((z - radius - g.origin) / g.cell));
  const r1 = Math.min(n - 1, Math.ceil((z + radius - g.origin) / g.cell));
  for (let r = r0; r <= r1; r++) {
    const dz = g.origin + r * g.cell - z;
    for (let c = c0; c <= c1; c++) {
      const dx = g.origin + c * g.cell - x;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d <= radius) {
        visit(r * n + c, d);
      }
    }
  }
}

/** Point in polygon (even-odd) for a flat ring. */
export function pointInRing(ring: FlatRing, x: number, z: number): boolean {
  let inside = false;
  const m = ring.length >> 1;
  for (let i = 0, j = m - 1; i < m; j = i++) {
    const xi = ring[i * 2];
    const zi = ring[i * 2 + 1];
    const xj = ring[j * 2];
    const zj = ring[j * 2 + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}
