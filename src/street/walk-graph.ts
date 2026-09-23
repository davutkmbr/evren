import type { WalkGraphData } from './format';

export interface Waypoint {
  x: number;
  z: number;
  label: string;
}

export interface PathSample {
  x: number;
  y: number;
  z: number;
  /** Unit horizontal direction of travel. */
  dirX: number;
  dirZ: number;
}

/** A polyline over walk-graph vertices, sampled by distance along it. */
export class WalkPath {
  /** Flat [x, y, z, ...]. */
  readonly points: Float64Array;
  /** Cumulative horizontal length at each point. */
  readonly cumulative: Float64Array;
  readonly length: number;
  /** Distance along the path at which each waypoint was reached. */
  readonly marks: { label: string; s: number }[];

  /** Metres of the path that leave the graph to bridge a hole in it (see WalkGraph.route). */
  readonly offGraph: number;

  constructor(points: number[], marks: { label: string; s: number }[], offGraph = 0) {
    this.offGraph = offGraph;
    this.points = Float64Array.from(points);
    const n = points.length / 3;
    this.cumulative = new Float64Array(n);
    for (let i = 1; i < n; i++) {
      const dx = points[i * 3] - points[i * 3 - 3];
      const dz = points[i * 3 + 2] - points[i * 3 - 1];
      this.cumulative[i] = this.cumulative[i - 1] + Math.hypot(dx, dz);
    }
    this.length = n > 0 ? this.cumulative[n - 1] : 0;
    this.marks = marks;
  }

  sample(s: number, out: PathSample): PathSample {
    const p = this.points;
    const c = this.cumulative;
    const n = c.length;
    if (n === 1) {
      out.x = p[0];
      out.y = p[1];
      out.z = p[2];
      out.dirX = 0;
      out.dirZ = -1;
      return out;
    }
    const d = Math.min(Math.max(s, 0), this.length);
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (c[mid] <= d) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    const seg = c[hi] - c[lo];
    const t = seg > 1e-9 ? (d - c[lo]) / seg : 0;
    const a = lo * 3;
    const b = hi * 3;
    out.x = p[a] + (p[b] - p[a]) * t;
    out.y = p[a + 1] + (p[b + 1] - p[a + 1]) * t;
    out.z = p[a + 2] + (p[b + 2] - p[a + 2]) * t;
    const len = Math.hypot(p[b] - p[a], p[b + 2] - p[a + 2]);
    out.dirX = len > 1e-9 ? (p[b] - p[a]) / len : 0;
    out.dirZ = len > 1e-9 ? (p[b + 2] - p[a + 2]) / len : -1;
    return out;
  }
}

/** Binary min-heap of (vertex, key) pairs for Dijkstra. */
class MinHeap {
  private ids: number[] = [];
  private keys: number[] = [];

  get size(): number {
    return this.ids.length;
  }

  push(id: number, key: number): void {
    const ids = this.ids;
    const keys = this.keys;
    let i = ids.length;
    ids.push(id);
    keys.push(key);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (keys[parent] <= key) {
        break;
      }
      ids[i] = ids[parent];
      keys[i] = keys[parent];
      i = parent;
    }
    ids[i] = id;
    keys[i] = key;
  }

  pop(): number {
    const ids = this.ids;
    const keys = this.keys;
    const top = ids[0];
    const lastId = ids.pop()!;
    const lastKey = keys.pop()!;
    const n = ids.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        if (l >= n) {
          break;
        }
        const r = l + 1;
        const c = r < n && keys[r] < keys[l] ? r : l;
        if (keys[c] >= lastKey) {
          break;
        }
        ids[i] = ids[c];
        keys[i] = keys[c];
        i = c;
      }
      ids[i] = lastId;
      keys[i] = lastKey;
    }
    return top;
  }
}

/** The compiled walk graph (walk.json) with shortest-path routing between waypoints. */
export class WalkGraph {
  readonly count: number;
  readonly vertices: Float64Array;
  private readonly adjStart: Int32Array;
  private readonly adjTo: Int32Array;
  private readonly adjLen: Float64Array;
  /** Connected-component id of each vertex, and the id of the largest component. */
  private readonly component: Int32Array;
  private readonly mainComponent: number;

  /** Raw connected components in walk.json, and gap edges added by stitching. */
  readonly rawComponents: number;
  readonly stitchedEdges: number;
  readonly mainSize: number;

  /**
   * @param stitchRadius The compiled graph is split into many fragments whose ends lie close together but share no
   * vertex. Vertices of different fragments closer than this (horizontally, with less than 0.6 m height difference)
   * are joined by a gap edge, so routes can cross fragment borders. 0 keeps the raw graph.
   */
  constructor(data: WalkGraphData, stitchRadius = 4) {
    this.vertices = Float64Array.from(data.vertices);
    const n = (this.count = data.vertices.length / 3);
    const v = this.vertices;
    const parent = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      parent[i] = i;
    }
    const find = (a: number): number => {
      while (parent[a] !== a) {
        parent[a] = parent[parent[a]];
        a = parent[a];
      }
      return a;
    };
    const e: number[] = data.edges.slice();
    for (let k = 0; k < e.length; k += 2) {
      parent[find(e[k])] = find(e[k + 1]);
    }
    const roots = new Set<number>();
    for (let i = 0; i < n; i++) {
      roots.add(find(i));
    }
    this.rawComponents = roots.size;
    let stitched = 0;
    if (stitchRadius > 0) {
      const cells = new Map<string, number[]>();
      const key = (cx: number, cz: number) => `${cx},${cz}`;
      for (let i = 0; i < n; i++) {
        const k = key(Math.floor(v[i * 3] / stitchRadius), Math.floor(v[i * 3 + 2] / stitchRadius));
        let list = cells.get(k);
        if (!list) {
          cells.set(k, (list = []));
        }
        list.push(i);
      }
      const r2 = stitchRadius * stitchRadius;
      for (let i = 0; i < n; i++) {
        const cx = Math.floor(v[i * 3] / stitchRadius);
        const cz = Math.floor(v[i * 3 + 2] / stitchRadius);
        let best = -1;
        let bestD = r2;
        for (let dx = -1; dx <= 1; dx++) {
          for (let dz = -1; dz <= 1; dz++) {
            for (const j of cells.get(key(cx + dx, cz + dz)) ?? []) {
              if (find(j) === find(i) || Math.abs(v[i * 3 + 1] - v[j * 3 + 1]) > 0.6) {
                continue;
              }
              const d = (v[i * 3] - v[j * 3]) ** 2 + (v[i * 3 + 2] - v[j * 3 + 2]) ** 2;
              if (d <= bestD) {
                bestD = d;
                best = j;
              }
            }
          }
        }
        if (best >= 0) {
          parent[find(i)] = find(best);
          e.push(i, best);
          stitched++;
        }
      }
    }
    this.stitchedEdges = stitched;
    const degree = new Int32Array(n + 1);
    for (let k = 0; k < e.length; k += 2) {
      degree[e[k]]++;
      degree[e[k + 1]]++;
    }
    this.adjStart = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) {
      this.adjStart[i + 1] = this.adjStart[i] + degree[i];
    }
    const fill = this.adjStart.slice(0, n);
    this.adjTo = new Int32Array(this.adjStart[n]);
    this.adjLen = new Float64Array(this.adjStart[n]);
    for (let k = 0; k < e.length; k += 2) {
      const a = e[k];
      const b = e[k + 1];
      const len = Math.hypot(v[a * 3] - v[b * 3], v[a * 3 + 1] - v[b * 3 + 1], v[a * 3 + 2] - v[b * 3 + 2]);
      this.adjTo[fill[a]] = b;
      this.adjLen[fill[a]++] = len;
      this.adjTo[fill[b]] = a;
      this.adjLen[fill[b]++] = len;
    }
    this.component = new Int32Array(n);
    const sizes = new Map<number, number>();
    for (let i = 0; i < n; i++) {
      const r = find(i);
      this.component[i] = r;
      sizes.set(r, (sizes.get(r) ?? 0) + 1);
    }
    let main = 0;
    let mainSize = -1;
    for (const [r, size] of sizes) {
      if (size > mainSize) {
        mainSize = size;
        main = r;
      }
    }
    this.mainComponent = main;
    this.mainSize = mainSize;
  }

  /** Nearest vertex (horizontal distance) in the largest connected component. */
  nearestMain(x: number, z: number): number {
    const v = this.vertices;
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < this.count; i++) {
      if (this.component[i] !== this.mainComponent) {
        continue;
      }
      const d = (v[i * 3] - x) ** 2 + (v[i * 3 + 2] - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  /** Dijkstra from `from`; returns the distance and predecessor arrays. */
  private search(from: number): { dist: Float64Array; prev: Int32Array } {
    const dist = new Float64Array(this.count).fill(Infinity);
    const prev = new Int32Array(this.count).fill(-1);
    const heap = new MinHeap();
    dist[from] = 0;
    heap.push(from, 0);
    while (heap.size) {
      const a = heap.pop();
      const da = dist[a];
      for (let k = this.adjStart[a]; k < this.adjStart[a + 1]; k++) {
        const b = this.adjTo[k];
        const nd = da + this.adjLen[k];
        if (nd < dist[b]) {
          dist[b] = nd;
          prev[b] = a;
          heap.push(b, nd);
        }
      }
    }
    return { dist, prev };
  }

  /** Nearest vertex (horizontal distance) in any component. */
  nearestAny(x: number, z: number): number {
    const v = this.vertices;
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < this.count; i++) {
      const d = (v[i * 3] - x) ** 2 + (v[i * 3 + 2] - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  /**
   * Shortest walkable path through the waypoints. Each leg ends at the vertex nearest its waypoint. Where the graph
   * has a hole (a fragment the stitching could not join), the leg may leave the graph for a straight gap costed at
   * GAP_COST times its length, so a gap is only taken when the graph detour is at least that much longer. Gap metres
   * are reported in `WalkPath.offGraph`.
   */
  route(waypoints: Waypoint[]): WalkPath {
    const GAP_COST = 3;
    const v = this.vertices;
    let current = this.nearestMain(waypoints[0].x, waypoints[0].z);
    const pts: number[] = [v[current * 3], v[current * 3 + 1], v[current * 3 + 2]];
    const marks = [{ label: waypoints[0].label, s: 0 }];
    let length = 0;
    let offGraph = 0;
    const append = (i: number): number => {
      const step = Math.hypot(v[i * 3] - pts[pts.length - 3], v[i * 3 + 2] - pts[pts.length - 1]);
      length += step;
      pts.push(v[i * 3], v[i * 3 + 1], v[i * 3 + 2]);
      return step;
    };
    for (let w = 1; w < waypoints.length; w++) {
      const { x, z, label } = waypoints[w];
      const target = this.nearestAny(x, z);
      const { dist, prev } = this.search(current);
      let exit = current;
      let bestCost = Infinity;
      for (let i = 0; i < this.count; i++) {
        if (!Number.isFinite(dist[i])) {
          continue;
        }
        const cost = dist[i] + GAP_COST * Math.hypot(v[i * 3] - v[target * 3], v[i * 3 + 2] - v[target * 3 + 2]);
        if (cost < bestCost) {
          bestCost = cost;
          exit = i;
        }
      }
      const chain: number[] = [];
      for (let i = exit; i !== current && i >= 0; i = prev[i]) {
        chain.push(i);
      }
      chain.reverse();
      for (const i of chain) {
        append(i);
      }
      if (exit !== target) {
        offGraph += append(target);
      }
      marks.push({ label, s: length });
      current = target;
    }
    return new WalkPath(pts, marks, offGraph);
  }
}
