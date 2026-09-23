import { V3 } from './vec3';

export interface SkelNode {
  p: V3;
  parent: number;
  children: number[];
  radius: number;
  /** May sprout new growth during space colonization. */
  canGrow: boolean;
  /** Fixed radius (trunk/limbs built explicitly); pipe-model radii never go below it. */
  minRadius: number;
}

/** Branch graph grown by explicit construction and/or space colonization. Children always have larger indices. */
export class Skeleton {
  readonly nodes: SkelNode[] = [];

  add(p: V3, parent: number, canGrow = true, minRadius = 0): number {
    const i = this.nodes.length;
    this.nodes.push({ p, parent, children: [], radius: 0, canGrow, minRadius });
    if (parent >= 0) {
      this.nodes[parent].children.push(i);
    }
    return i;
  }

  /** Adds a polyline of nodes starting at `from` (exclusive) and returns the node indices. */
  addChain(from: number, points: V3[], canGrow: boolean, radii?: number[]): number[] {
    const out: number[] = [];
    let prev = from;
    for (let i = 0; i < points.length; i++) {
      prev = this.add(points[i], prev, canGrow, radii ? radii[i] : 0);
      out.push(prev);
    }
    return out;
  }

  /** Pipe model: r_parent^e = sum r_child^e, tips get `tipRadius`. */
  computeRadii(tipRadius: number, exponent: number): void {
    const n = this.nodes;
    for (let i = n.length - 1; i >= 0; i--) {
      const node = n[i];
      if (node.children.length === 0) {
        node.radius = Math.max(tipRadius, node.minRadius);
        continue;
      }
      let s = 0;
      for (const c of node.children) {
        s += Math.pow(n[c].radius, exponent);
      }
      node.radius = Math.max(Math.pow(s, 1 / exponent), node.minRadius);
    }
  }

  /** Number of nodes in each subtree (used to pick the continuing child of a chain). */
  subtreeSizes(): Int32Array {
    const n = this.nodes;
    const size = new Int32Array(n.length);
    for (let i = n.length - 1; i >= 0; i--) {
      size[i] += 1;
      const p = n[i].parent;
      if (p >= 0) {
        size[p] += size[i];
      }
    }
    return size;
  }

  /** Laplacian smoothing of interior chain nodes (keeps roots, forks and tips fixed). */
  smooth(iterations: number, amount: number, fromIndex = 0): void {
    const n = this.nodes;
    const tmp = new V3();
    for (let it = 0; it < iterations; it++) {
      for (let i = fromIndex; i < n.length; i++) {
        const node = n[i];
        if (node.parent < 0 || node.children.length !== 1 || node.minRadius > 0) {
          continue;
        }
        const a = n[node.parent].p;
        const b = n[node.children[0]].p;
        tmp.set((a.x + b.x) * 0.5, (a.y + b.y) * 0.5, (a.z + b.z) * 0.5);
        node.p.lerp(tmp, amount);
      }
    }
  }
}

export interface Chain {
  /** Node indices; the first one is the attachment node on the parent chain (except for the root chain). */
  nodes: number[];
  /** Branching order: 0 = trunk. */
  level: number;
  /** Chain length (m) and distance of its start from the root along the parent chains. */
  length: number;
  startDistance: number;
}

/**
 * Splits the graph into chains: each chain continues through the child with the largest subtree; the other
 * children start new chains one level deeper.
 */
export function extractChains(skel: Skeleton): Chain[] {
  const n = skel.nodes;
  if (n.length === 0) {
    return [];
  }
  const size = skel.subtreeSizes();
  const chains: Chain[] = [];
  const stack: { start: number; attach: number; level: number; dist: number }[] = [{ start: 0, attach: -1, level: 0, dist: 0 }];
  while (stack.length > 0) {
    const job = stack.pop()!;
    const nodes: number[] = [];
    if (job.attach >= 0) {
      nodes.push(job.attach);
    }
    let cur = job.start;
    let len = 0;
    for (;;) {
      nodes.push(cur);
      const node = n[cur];
      if (nodes.length > 1) {
        len += node.p.distanceTo(n[nodes[nodes.length - 2]].p);
      }
      if (node.children.length === 0) {
        break;
      }
      let best = node.children[0];
      for (const c of node.children) {
        if (size[c] > size[best] || (size[c] === size[best] && n[c].radius > n[best].radius)) {
          best = c;
        }
      }
      for (const c of node.children) {
        if (c !== best) {
          stack.push({ start: c, attach: cur, level: job.level + 1, dist: job.dist + len });
        }
      }
      cur = best;
    }
    chains.push({ nodes, level: job.level, length: len, startDistance: job.dist });
  }
  return chains;
}
