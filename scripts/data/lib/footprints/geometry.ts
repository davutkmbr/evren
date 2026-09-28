/**
 * Geometry of the building merge (scripts/data/footprints-merge.ts): flat x, z rings in local metres (+X east,
 * +Z south; outer rings counter-clockwise, i.e. positive shoelace area, as in src/world/osm/data.ts), exact polygon
 * intersection areas, lattice samples, grids of boxes, segments and polygons, and the coastline sea test.
 */

export type Ring = number[];

/* ---------------------------------------------------------------------------------------------------------------- */
/* Geometry                                                                                                         */
/* ---------------------------------------------------------------------------------------------------------------- */

/** Signed shoelace area of a flat ring (positive: counter-clockwise in x / z, the data's outer rings). */
export function ringArea(r: ArrayLike<number>): number {
  let a = 0;
  const n = r.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    a += r[j * 2] * r[i * 2 + 1] - r[i * 2] * r[j * 2 + 1];
  }
  return a / 2;
}

/** Area-weighted centroid (vertex mean for degenerate rings). */
export function ringCentroid(r: ArrayLike<number>): [number, number] {
  let a = 0;
  let cx = 0;
  let cz = 0;
  const n = r.length / 2;
  // Relative to the first vertex: far from the origin the products lose precision otherwise.
  const ox = r[0];
  const oz = r[1];
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xj = r[j * 2] - ox;
    const zj = r[j * 2 + 1] - oz;
    const xi = r[i * 2] - ox;
    const zi = r[i * 2 + 1] - oz;
    const f = xj * zi - xi * zj;
    a += f;
    cx += (xj + xi) * f;
    cz += (zj + zi) * f;
  }
  if (Math.abs(a) < 1e-9) {
    let x = 0;
    let z = 0;
    for (let i = 0; i < n; i++) {
      x += r[i * 2];
      z += r[i * 2 + 1];
    }
    return [x / n, z / n];
  }
  return [ox + cx / (3 * a), oz + cz / (3 * a)];
}

export interface Box {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export function boxOf(r: ArrayLike<number>): Box {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (let k = 0; k < r.length; k += 2) {
    minX = Math.min(minX, r[k]);
    maxX = Math.max(maxX, r[k]);
    minZ = Math.min(minZ, r[k + 1]);
    maxZ = Math.max(maxZ, r[k + 1]);
  }
  return { minX, minZ, maxX, maxZ };
}

export function pointInRing(r: ArrayLike<number>, x: number, z: number): boolean {
  let inside = false;
  const n = r.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = r[i * 2];
    const zi = r[i * 2 + 1];
    const xj = r[j * 2];
    const zj = r[j * 2 + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Distance from (px, pz) to segment a-b, and the segment parameter of the closest point. */
export function segDistT(px: number, pz: number, ax: number, az: number, bx: number, bz: number): [number, number] {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  const t = l2 > 1e-12 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0;
  return [Math.hypot(px - ax - t * dx, pz - az - t * dz), t];
}

/** The ring counter-clockwise (positive area), as a copy. */
export function ccw(r: Ring): Ring {
  if (ringArea(r) >= 0) {
    return r.slice();
  }
  const out: Ring = [];
  for (let i = r.length - 2; i >= 0; i -= 2) {
    out.push(r[i], r[i + 1]);
  }
  return out;
}

/** Area of the convex hull of a ring. */
export function hullArea(r: ArrayLike<number>): number {
  const pts: [number, number][] = [];
  for (let i = 0; i < r.length; i += 2) {
    pts.push([r[i], r[i + 1]]);
  }
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list: [number, number][]): [number, number][] => {
    const out: [number, number][] = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) {
        out.pop();
      }
      out.push(p);
    }
    return out;
  };
  const lower = half(pts);
  const upper = half([...pts].reverse());
  return Math.abs(ringArea(lower.slice(0, -1).concat(upper.slice(0, -1)).flat()));
}

/** Minimum-area rectangle over the ring's edge directions: centre, unit long axis, half length and half width. */
export function orientedBox(r: ArrayLike<number>): { cx: number; cz: number; dx: number; dz: number; hl: number; hw: number } {
  const n = r.length / 2;
  let best = { area: Infinity, cx: r[0], cz: r[1], dx: 1, dz: 0, hl: 0, hw: 0 };
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    let dx = r[j * 2] - r[i * 2];
    let dz = r[j * 2 + 1] - r[i * 2 + 1];
    const len = Math.hypot(dx, dz);
    if (len < 0.5) {
      continue;
    }
    dx /= len;
    dz /= len;
    let s0 = Infinity;
    let s1 = -Infinity;
    let t0 = Infinity;
    let t1 = -Infinity;
    for (let k = 0; k < n; k++) {
      const s = r[k * 2] * dx + r[k * 2 + 1] * dz;
      const t = -r[k * 2] * dz + r[k * 2 + 1] * dx;
      s0 = Math.min(s0, s);
      s1 = Math.max(s1, s);
      t0 = Math.min(t0, t);
      t1 = Math.max(t1, t);
    }
    const area = (s1 - s0) * (t1 - t0);
    if (area < best.area) {
      const sc = (s0 + s1) / 2;
      const tc = (t0 + t1) / 2;
      const cx = sc * dx - tc * dz;
      const cz = sc * dz + tc * dx;
      const along = (s1 - s0) / 2;
      const across = (t1 - t0) / 2;
      best = along >= across ? { area, cx, cz, dx, dz, hl: along, hw: across } : { area, cx, cz, dx: -dz, dz: dx, hl: across, hw: along };
    }
  }
  return best;
}

/** Sutherland-Hodgman: `subject` (any simple ring) clipped by the convex counter-clockwise ring `clip`. */
export function clipConvex(subject: Ring, clip: Ring): Ring {
  let out = subject;
  const m = clip.length / 2;
  for (let e = 0; e < m && out.length >= 6; e++) {
    const ax = clip[e * 2];
    const az = clip[e * 2 + 1];
    const bx = clip[((e + 1) % m) * 2];
    const bz = clip[((e + 1) % m) * 2 + 1];
    // Counter-clockwise in x / z (positive shoelace): the inside is where the cross product is >= 0.
    const side = (x: number, z: number): number => (bx - ax) * (z - az) - (bz - az) * (x - ax);
    const input = out;
    out = [];
    const n = input.length / 2;
    for (let i = 0; i < n; i++) {
      const px = input[((i + n - 1) % n) * 2];
      const pz = input[((i + n - 1) % n) * 2 + 1];
      const qx = input[i * 2];
      const qz = input[i * 2 + 1];
      const sp = side(px, pz);
      const sq = side(qx, qz);
      if (sq >= 0) {
        if (sp < 0) {
          const t = sp / (sp - sq);
          out.push(px + (qx - px) * t, pz + (qz - pz) * t);
        }
        out.push(qx, qz);
      } else if (sp >= 0) {
        const t = sp / (sp - sq);
        out.push(px + (qx - px) * t, pz + (qz - pz) * t);
      }
    }
  }
  return out;
}

/**
 * The pieces of a simple ring on the side n . p >= d of a line (normal nx, nz): every connected component, so a cut
 * through a concave outline (an L or U shaped row) yields each arm on its own. Crossings are sorted along the line;
 * inside a simple polygon they pair up into the intervals the line runs inside, and each piece is traced along the
 * ring, jumping across those intervals. Pieces come out counter-clockwise when the ring is.
 */
export function cutRing(ring: Ring, nx: number, nz: number, d: number): Ring[] {
  const n = ring.length / 2;
  const f = (i: number): number => {
    const v = nx * ring[i * 2] + nz * ring[i * 2 + 1] - d;
    // Vertices on the line count as kept: no zero-length crossings.
    return v === 0 ? 1e-12 : v;
  };
  let kept = 0;
  for (let i = 0; i < n; i++) {
    kept += f(i) > 0 ? 1 : 0;
  }
  if (kept === n) {
    return [ring.slice()];
  }
  if (kept === 0) {
    return [];
  }
  // Augmented ring: kept vertices and the crossings (exit: kept -> dropped, entry: dropped -> kept).
  interface V {
    x: number;
    z: number;
    cross: 0 | 1 | 2;
    u: number;
    partner: number;
  }
  const tx = -nz;
  const tz = nx;
  const list: V[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const fi = f(i);
    const fj = f(j);
    if (fi > 0) {
      list.push({ x: ring[i * 2], z: ring[i * 2 + 1], cross: 0, u: 0, partner: -1 });
    }
    if (fi > 0 !== fj > 0) {
      const t = fi / (fi - fj);
      const x = ring[i * 2] + (ring[j * 2] - ring[i * 2]) * t;
      const z = ring[i * 2 + 1] + (ring[j * 2 + 1] - ring[i * 2 + 1]) * t;
      list.push({ x, z, cross: fi > 0 ? 1 : 2, u: tx * x + tz * z, partner: -1 });
    }
  }
  const crossings = list.map((_, k) => k).filter((k) => list[k].cross);
  crossings.sort((a, b) => list[a].u - list[b].u);
  for (let k = 0; k + 1 < crossings.length; k += 2) {
    list[crossings[k]].partner = crossings[k + 1];
    list[crossings[k + 1]].partner = crossings[k];
  }
  const done = new Uint8Array(list.length);
  const out: Ring[] = [];
  for (let s = 0; s < list.length; s++) {
    if (done[s] || list[s].cross === 1) {
      continue;
    }
    const piece: Ring = [];
    let k = s;
    let guard = list.length * 2;
    while (!done[k] && guard-- > 0) {
      done[k] = 1;
      piece.push(list[k].x, list[k].z);
      if (list[k].cross === 1) {
        // Exit: run along the line to the other end of the interval, an entry, and go on from there.
        const p = list[k].partner;
        if (p < 0) {
          break;
        }
        if (!done[p]) {
          done[p] = 1;
          piece.push(list[p].x, list[p].z);
        }
        k = (p + 1) % list.length;
      } else {
        k = (k + 1) % list.length;
      }
    }
    if (piece.length >= 6 && Math.abs(ringArea(piece)) > 1e-6) {
      out.push(piece);
    }
  }
  return out;
}

/** Ear-clipping triangulation of a simple counter-clockwise ring: flat triangles [x0, z0, x1, z1, x2, z2]. */
export function triangulate(r: Ring): Ring[] {
  const n = r.length / 2;
  if (n < 3) {
    return [];
  }
  if (n === 3) {
    return [r.slice()];
  }
  const idx = Array.from({ length: n }, (_, i) => i);
  const out: Ring[] = [];
  const x = (i: number): number => r[i * 2];
  const z = (i: number): number => r[i * 2 + 1];
  const convex = (a: number, b: number, c: number): boolean => (x(b) - x(a)) * (z(c) - z(a)) - (z(b) - z(a)) * (x(c) - x(a)) > 1e-12;
  const inTri = (p: number, a: number, b: number, c: number): boolean => {
    const d1 = (x(b) - x(a)) * (z(p) - z(a)) - (z(b) - z(a)) * (x(p) - x(a));
    const d2 = (x(c) - x(b)) * (z(p) - z(b)) - (z(c) - z(b)) * (x(p) - x(b));
    const d3 = (x(a) - x(c)) * (z(p) - z(c)) - (z(a) - z(c)) * (x(p) - x(c));
    return d1 >= 0 && d2 >= 0 && d3 >= 0;
  };
  let guard = n * n;
  while (idx.length > 3 && guard-- > 0) {
    let cut = false;
    for (let k = 0; k < idx.length; k++) {
      const a = idx[(k + idx.length - 1) % idx.length];
      const b = idx[k];
      const c = idx[(k + 1) % idx.length];
      if (!convex(a, b, c)) {
        continue;
      }
      let ear = true;
      for (const p of idx) {
        if (p !== a && p !== b && p !== c && inTri(p, a, b, c)) {
          ear = false;
          break;
        }
      }
      if (ear) {
        out.push([x(a), z(a), x(b), z(b), x(c), z(c)]);
        idx.splice(k, 1);
        cut = true;
        break;
      }
    }
    if (!cut) {
      // Degenerate remainder (collinear points): drop the flattest vertex.
      idx.splice(0, 1);
    }
  }
  if (idx.length === 3) {
    out.push([x(idx[0]), z(idx[0]), x(idx[1]), z(idx[1]), x(idx[2]), z(idx[2])]);
  }
  return out;
}

/** Area (m²) of the intersection of two simple rings; holes of `b` are subtracted. */
export function intersectionArea(a: Ring, b: Ring, bHoles: readonly Ring[] = []): number {
  const ba = boxOf(a);
  const bb = boxOf(b);
  if (ba.maxX <= bb.minX || bb.maxX <= ba.minX || ba.maxZ <= bb.minZ || bb.maxZ <= ba.minZ) {
    return 0;
  }
  let sum = 0;
  const bb2 = ccw(b);
  for (const tri of triangulate(ccw(a))) {
    sum += Math.abs(ringArea(clipConvex(bb2, tri)));
    for (const h of bHoles) {
      sum -= Math.abs(ringArea(clipConvex(ccw(h), tri)));
    }
  }
  return Math.max(0, sum);
}

/** Sample points inside a ring on a lattice (about `target` points, spacing at least 0.5 m), centroid first. */
export function samplePoints(r: Ring, target = 32): number[] {
  const [cx, cz] = ringCentroid(r);
  const out = [cx, cz];
  const b = boxOf(r);
  const step = Math.max(0.5, Math.sqrt(Math.abs(ringArea(r)) / target));
  for (let z = b.minZ + step / 2; z < b.maxZ; z += step) {
    for (let x = b.minX + step / 2; x < b.maxX; x += step) {
      if (pointInRing(r, x, z)) {
        out.push(x, z);
      }
    }
  }
  return out;
}

/* ---------------------------------------------------------------------------------------------------------------- */
/* Spatial index                                                                                                    */
/* ---------------------------------------------------------------------------------------------------------------- */

/** Uniform grid of item boxes with box queries (each item reported once per query). */
export class Grid {
  private readonly cells = new Map<number, number[]>();
  private stamp: Uint32Array = new Uint32Array(1024);
  private query = 0;

  constructor(readonly cell: number) {}

  private key(i: number, j: number): number {
    return (i + 1_000_000) * 2_000_003 + (j + 1_000_000);
  }

  add(id: number, minX: number, minZ: number, maxX: number, maxZ: number): void {
    if (id >= this.stamp.length) {
      const s = new Uint32Array(Math.max(id + 1, this.stamp.length * 2));
      s.set(this.stamp);
      this.stamp = s;
    }
    for (let j = Math.floor(minZ / this.cell); j <= Math.floor(maxZ / this.cell); j++) {
      for (let i = Math.floor(minX / this.cell); i <= Math.floor(maxX / this.cell); i++) {
        const k = this.key(i, j);
        const list = this.cells.get(k);
        if (list) {
          list.push(id);
        } else {
          this.cells.set(k, [id]);
        }
      }
    }
  }

  /** Calls `fn(id)` for every item whose box's cells meet the query box. */
  each(minX: number, minZ: number, maxX: number, maxZ: number, fn: (id: number) => void): void {
    const q = ++this.query;
    for (let j = Math.floor(minZ / this.cell); j <= Math.floor(maxZ / this.cell); j++) {
      for (let i = Math.floor(minX / this.cell); i <= Math.floor(maxX / this.cell); i++) {
        const list = this.cells.get(this.key(i, j));
        if (!list) {
          continue;
        }
        for (const id of list) {
          if (this.stamp[id] !== q) {
            this.stamp[id] = q;
            fn(id);
          }
        }
      }
    }
  }
}

/* ---------------------------------------------------------------------------------------------------------------- */
/* Lines and polygons of the drop rules                                                                             */
/* ---------------------------------------------------------------------------------------------------------------- */

/** Line features (streets, rails, walls, coastline) as segments with a half width, gridded for point queries. */
export class Segments {
  readonly ax: number[] = [];
  readonly az: number[] = [];
  readonly bx: number[] = [];
  readonly bz: number[] = [];
  readonly half: number[] = [];
  private readonly grid: Grid;
  private maxHalf = 0;

  constructor(cell = 64) {
    this.grid = new Grid(cell);
  }

  /** Adds a polyline (flat x, z) of half width `half`. */
  addLine(pts: ArrayLike<number>, half: number): void {
    for (let k = 0; k + 3 < pts.length; k += 2) {
      const id = this.ax.length;
      this.ax.push(pts[k]);
      this.az.push(pts[k + 1]);
      this.bx.push(pts[k + 2]);
      this.bz.push(pts[k + 3]);
      this.half.push(half);
      this.maxHalf = Math.max(this.maxHalf, half);
      this.grid.add(id, Math.min(pts[k], pts[k + 2]) - half, Math.min(pts[k + 1], pts[k + 3]) - half, Math.max(pts[k], pts[k + 2]) + half, Math.max(pts[k + 1], pts[k + 3]) + half);
    }
  }

  get size(): number {
    return this.ax.length;
  }

  /** True when (x, z) lies inside a segment's corridor (distance < its half width, plus `extra`). */
  covers(x: number, z: number, extra = 0): boolean {
    let hit = false;
    this.grid.each(x - extra, z - extra, x + extra, z + extra, (id) => {
      if (!hit && segDistT(x, z, this.ax[id], this.az[id], this.bx[id], this.bz[id])[0] < this.half[id] + extra) {
        hit = true;
      }
    });
    return hit;
  }

  /** Calls `fn(id)` for every segment whose corridor box meets the query box. */
  each(minX: number, minZ: number, maxX: number, maxZ: number, fn: (id: number) => void): void {
    this.grid.each(minX, minZ, maxX, maxZ, fn);
  }

  /** Nearest segment within `radius` m: [id, distance, t], or null. */
  nearest(x: number, z: number, radius: number): [number, number, number] | null {
    let best: [number, number, number] | null = null;
    this.grid.each(x - radius, z - radius, x + radius, z + radius, (id) => {
      const [d, t] = segDistT(x, z, this.ax[id], this.az[id], this.bx[id], this.bz[id]);
      if (d <= radius && (!best || d < best[1])) {
        best = [id, d, t];
      }
    });
    return best;
  }
}

/** Polygons with holes, gridded for point-in-polygon queries; each polygon carries a label. */
export class Polygons<L = string> {
  readonly rings: Ring[] = [];
  readonly holes: Ring[][] = [];
  readonly labels: L[] = [];
  private readonly grid: Grid;

  constructor(cell = 250) {
    this.grid = new Grid(cell);
  }

  add(ring: Ring, holes: readonly Ring[], label: L): void {
    const id = this.rings.length;
    this.rings.push(ring);
    this.holes.push(holes.slice());
    this.labels.push(label);
    const b = boxOf(ring);
    this.grid.add(id, b.minX, b.minZ, b.maxX, b.maxZ);
  }

  get size(): number {
    return this.rings.length;
  }

  /** Label of the first polygon containing (x, z), or null. */
  at(x: number, z: number): L | null {
    let found: L | null = null;
    this.grid.each(x, z, x, z, (id) => {
      if (found === null && pointInRing(this.rings[id], x, z) && !this.holes[id].some((h) => pointInRing(h, x, z))) {
        found = this.labels[id];
      }
    });
    return found;
  }
}

/**
 * Sea test on OSM coastline ways, which keep the land on their left in the direction of travel (OSM convention). In
 * the local frame (+X east, +Z south) the right-hand (sea) normal of a segment a->b is (-(bz - az), bx - ax). The
 * nearest segment within `radius` decides; when the closest point is a vertex, the normals of the segments meeting
 * there are summed (pseudo-normal). Farther than `radius` from every coastline counts as land.
 */
export function atSea(coast: Segments, x: number, z: number, radius = 300): boolean {
  const near = coast.nearest(x, z, radius);
  if (!near) {
    return false;
  }
  const [id, , t] = near;
  const normal = (k: number): [number, number] => {
    const dx = coast.bx[k] - coast.ax[k];
    const dz = coast.bz[k] - coast.az[k];
    const l = Math.hypot(dx, dz) || 1;
    return [-dz / l, dx / l];
  };
  let [nx, nz] = normal(id);
  let px = coast.ax[id] + (coast.bx[id] - coast.ax[id]) * t;
  let pz = coast.az[id] + (coast.bz[id] - coast.az[id]) * t;
  if (t <= 0 || t >= 1) {
    px = t <= 0 ? coast.ax[id] : coast.bx[id];
    pz = t <= 0 ? coast.az[id] : coast.bz[id];
    const eps = 0.01;
    coast.each(px - eps, pz - eps, px + eps, pz + eps, (k) => {
      if (k === id) {
        return;
      }
      const meets = (Math.abs(coast.ax[k] - px) < eps && Math.abs(coast.az[k] - pz) < eps) || (Math.abs(coast.bx[k] - px) < eps && Math.abs(coast.bz[k] - pz) < eps);
      if (meets) {
        const [ox, oz] = normal(k);
        nx += ox;
        nz += oz;
      }
    });
  }
  return (x - px) * nx + (z - pz) * nz > 0;
}
