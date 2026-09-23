import type { Skeleton } from './skeleton';
import { V3 } from './vec3';

export interface ColonizeParams {
  /** Growth step (m). */
  segment: number;
  /** Radius within which an attractor pulls its closest node. */
  influence: number;
  /** Attractors closer than this to a node are consumed. */
  kill: number;
  maxIterations: number;
  /** Constant bias added to every growth direction (e.g. slight phototropism). */
  tropism: V3;
  maxNodes: number;
}

/** Spatial hash of points with integer cell keys. */
class PointGrid {
  private cells = new Map<number, number[]>();
  constructor(private readonly cell: number) {}

  private key(ix: number, iy: number, iz: number): number {
    return ((ix + 512) * 1024 + (iy + 512)) * 1024 + (iz + 512);
  }

  insert(id: number, p: V3): void {
    const k = this.key(Math.floor(p.x / this.cell), Math.floor(p.y / this.cell), Math.floor(p.z / this.cell));
    let list = this.cells.get(k);
    if (!list) {
      list = [];
      this.cells.set(k, list);
    }
    list.push(id);
  }

  /** Calls fn for every id in the 27 cells around p. */
  near(p: V3, fn: (id: number) => void): void {
    const cx = Math.floor(p.x / this.cell);
    const cy = Math.floor(p.y / this.cell);
    const cz = Math.floor(p.z / this.cell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const list = this.cells.get(this.key(cx + dx, cy + dy, cz + dz));
          if (list) {
            for (let i = 0; i < list.length; i++) {
              fn(list[i]);
            }
          }
        }
      }
    }
  }
}

/**
 * Space colonization (Runions et al. 2007): nodes that may grow are pulled toward the attractors closest to them;
 * attractors reached by the crown are removed. Grows the given skeleton in place.
 */
export const colonizeStats = { nodes: 0, alive: 0, iterations: 0, attractors: 0 };

export function colonize(skel: Skeleton, attractors: V3[], params: ColonizeParams): void {
  const nodes = skel.nodes;
  const nodeGrid = new PointGrid(params.influence);
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].canGrow) {
      nodeGrid.insert(i, nodes[i].p);
    }
  }
  const alive = new Uint8Array(attractors.length).fill(1);
  let aliveCount = attractors.length;
  const attractorGrid = new PointGrid(params.kill);
  for (let i = 0; i < attractors.length; i++) {
    attractorGrid.insert(i, attractors[i]);
  }
  const influence2 = params.influence * params.influence;
  const kill2 = params.kill * params.kill;
  const pull = new Map<number, V3>();
  const dir = new V3();

  const killAround = (p: V3): void => {
    attractorGrid.near(p, (a) => {
      if (!alive[a]) {
        return;
      }
      const q = attractors[a];
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const dz = q.z - p.z;
      if (dx * dx + dy * dy + dz * dz < kill2) {
        alive[a] = 0;
        aliveCount--;
      }
    });
  };
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].canGrow) {
      killAround(nodes[i].p);
    }
  }

  for (let iter = 0; iter < params.maxIterations && aliveCount > 0 && nodes.length < params.maxNodes; iter++) {
    pull.clear();
    for (let a = 0; a < attractors.length; a++) {
      if (!alive[a]) {
        continue;
      }
      const q = attractors[a];
      let best = -1;
      let bestD = influence2;
      nodeGrid.near(q, (id) => {
        const p = nodes[id].p;
        const dx = q.x - p.x;
        const dy = q.y - p.y;
        const dz = q.z - p.z;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bestD) {
          bestD = d;
          best = id;
        }
      });
      if (best < 0) {
        continue;
      }
      let v = pull.get(best);
      if (!v) {
        v = new V3();
        pull.set(best, v);
      }
      const p = nodes[best].p;
      const inv = 1 / Math.sqrt(bestD);
      v.x += (q.x - p.x) * inv;
      v.y += (q.y - p.y) * inv;
      v.z += (q.z - p.z) * inv;
    }
    if (pull.size === 0) {
      break;
    }
    let grew = 0;
    for (const [id, v] of pull) {
      dir.copy(v).normalize().add(params.tropism);
      if (dir.length() < 0.2) {
        continue;
      }
      dir.normalize();
      const parent = nodes[id];
      // Refuse to regrow the same direction twice from one node (oscillation between two attractor groups).
      let duplicate = false;
      for (const c of parent.children) {
        const cp = nodes[c].p;
        const dx = cp.x - parent.p.x;
        const dy = cp.y - parent.p.y;
        const dz = cp.z - parent.p.z;
        if ((dx * dir.x + dy * dir.y + dz * dir.z) / params.segment > 0.9) {
          duplicate = true;
          break;
        }
      }
      if (duplicate) {
        continue;
      }
      const np = parent.p.clone().addScaled(dir, params.segment);
      const ni = skel.add(np, id, true);
      nodeGrid.insert(ni, np);
      killAround(np);
      grew++;
      if (nodes.length >= params.maxNodes) {
        break;
      }
    }
    colonizeStats.iterations = iter + 1;
    if (grew === 0) {
      break;
    }
  }
  colonizeStats.nodes = nodes.length;
  colonizeStats.alive = aliveCount;
  colonizeStats.attractors = attractors.length;
}
