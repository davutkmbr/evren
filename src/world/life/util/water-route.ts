import type { GeoQuery } from '../../../core/contracts';
import type { P2 } from './path';
import { clearance, segmentClear } from './water-nav';

/**
 * Grid A* over the geo clearance field between two open-water points. Cells closer than `minClear` to the shore are
 * blocked (except around the endpoints, which may lie next to a pier); cost grows near the shore so routes keep to
 * open water. The raw cell path is string-pulled with straight clear segments.
 */
export function routeOverWater(geo: GeoQuery, a: P2, b: P2, minClear: number, cell = 70, margin = 2500): P2[] {
  if (segmentClear(geo, a, b, minClear, 30)) return [a, b];
  const minX = Math.min(a.x, b.x) - margin;
  const minZ = Math.min(a.z, b.z) - margin;
  const w = Math.ceil((Math.max(a.x, b.x) + margin - minX) / cell) + 1;
  const h = Math.ceil((Math.max(a.z, b.z) + margin - minZ) / cell) + 1;
  const n = w * h;
  const clear = new Float32Array(n);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) clear[j * w + i] = clearance(geo, minX + i * cell, minZ + j * cell);
  }
  const idx = (p: P2): number => {
    const i = Math.min(w - 1, Math.max(0, Math.round((p.x - minX) / cell)));
    const j = Math.min(h - 1, Math.max(0, Math.round((p.z - minZ) / cell)));
    return j * w + i;
  };
  const start = idx(a);
  const goal = idx(b);
  const gi = goal % w;
  const gj = Math.floor(goal / w);
  const si = start % w;
  const sj = Math.floor(start / w);
  const passable = (k: number): boolean => {
    if (clear[k] >= minClear) return true;
    const i = k % w;
    const j = Math.floor(k / w);
    const nearEnd = Math.hypot(i - gi, j - gj) * cell < minClear * 3 + 250 || Math.hypot(i - si, j - sj) * cell < minClear * 3 + 250;
    return nearEnd && clear[k] > 8;
  };
  const g = new Float32Array(n).fill(Infinity);
  const from = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  // Binary heap of [f, k].
  const heapF: number[] = [];
  const heapK: number[] = [];
  const push = (f: number, k: number): void => {
    heapF.push(f);
    heapK.push(k);
    let c = heapF.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (heapF[p] <= heapF[c]) break;
      [heapF[p], heapF[c]] = [heapF[c], heapF[p]];
      [heapK[p], heapK[c]] = [heapK[c], heapK[p]];
      c = p;
    }
  };
  const pop = (): number => {
    const top = heapK[0];
    const lf = heapF.pop()!;
    const lk = heapK.pop()!;
    if (heapF.length > 0) {
      heapF[0] = lf;
      heapK[0] = lk;
      let c = 0;
      for (;;) {
        const l = c * 2 + 1;
        const r = l + 1;
        let m = c;
        if (l < heapF.length && heapF[l] < heapF[m]) m = l;
        if (r < heapF.length && heapF[r] < heapF[m]) m = r;
        if (m === c) break;
        [heapF[m], heapF[c]] = [heapF[c], heapF[m]];
        [heapK[m], heapK[c]] = [heapK[c], heapK[m]];
        c = m;
      }
    }
    return top;
  };
  const heur = (k: number): number => Math.hypot((k % w) - gi, Math.floor(k / w) - gj) * cell;
  g[start] = 0;
  push(heur(start), start);
  const DI = [1, -1, 0, 0, 1, 1, -1, -1];
  const DJ = [0, 0, 1, -1, 1, -1, 1, -1];
  let found = false;
  let iterations = 0;
  while (heapF.length > 0 && iterations++ < 400000) {
    const k = pop();
    if (closed[k]) continue;
    closed[k] = 1;
    if (k === goal) {
      found = true;
      break;
    }
    const i = k % w;
    const j = Math.floor(k / w);
    for (let d = 0; d < 8; d++) {
      const ni = i + DI[d];
      const nj = j + DJ[d];
      if (ni < 0 || nj < 0 || ni >= w || nj >= h) continue;
      const nk = nj * w + ni;
      if (closed[nk] || !passable(nk)) continue;
      const step = (d < 4 ? 1 : Math.SQRT2) * cell;
      const shorePenalty = 1 + 1.5 * Math.max(0, 1 - clear[nk] / (minClear * 3 + 150));
      const cost = g[k] + step * shorePenalty;
      if (cost < g[nk]) {
        g[nk] = cost;
        from[nk] = k;
        push(cost + heur(nk), nk);
      }
    }
  }
  if (!found) return [a, b];
  const cells: P2[] = [];
  for (let k = goal; k !== -1; k = from[k]) cells.push({ x: minX + (k % w) * cell, z: minZ + Math.floor(k / w) * cell });
  cells.reverse();
  cells[0] = a;
  cells[cells.length - 1] = b;
  // String pulling.
  const out: P2[] = [a];
  let anchor = 0;
  while (anchor < cells.length - 1) {
    let next = anchor + 1;
    for (let k = cells.length - 1; k > anchor + 1; k--) {
      if (segmentClear(geo, cells[anchor], cells[k], minClear * 0.8, 25)) {
        next = k;
        break;
      }
    }
    out.push(cells[next]);
    anchor = next;
  }
  return out;
}
