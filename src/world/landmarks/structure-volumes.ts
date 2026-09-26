/**
 * Solid volumes of the modelled structures that claim no ground pad (bridges: footprint 'none'), so no other layer
 * draws through them: OSM buildings (some OSM building:parts are the bridge towers themselves), the far OSM bake, the
 * compiled street tiles, the procedural city and the trees.
 *
 * The volumes are the structures' own colliders (deck pieces, towers, piers, anchorages), built in Node by the real
 * builders and baked into data/structure-volumes.json (`npm run bake:structures`, scripts/data/structure-volumes.ts;
 * `npm run check:map` fails when the file is stale). Heights are stored relative to the terrain under each box, so a
 * building or tree is tested with its own height above its ground and needs no ground sampler:
 * - y0 = box bottom minus the highest ground under the box (a deck 64 m above the water: 60+; a tower: below 0);
 * - y1 = box top minus the lowest ground under the box;
 * - top = the box top above sea level, and cap, for the terrain cap under decks (geo/build/height.ts).
 * An object standing on the ground from `a` to `b` m (above its ground) hits a box when its footprint, grown by
 * STRUCTURE_CLEARANCE, overlaps the box's and a < y1 and b > y0 - STRUCTURE_CLEARANCE. Houses under a high deck stay;
 * a house on an approach that runs at roof height goes.
 */
import DATA from './data/structure-volumes.json';

/**
 * Floats per box: cx, cz, hx (along the bridge axis), hz, yaw (Object3D.rotation.y), y0, y1 (relative, see above),
 * top (absolute, m), cap (CapMode).
 */
export const STRUCTURE_STRIDE = 9;

/** What the terrain cap under a box does (geo/build/height.ts capUnderStructures). */
export const CapMode = {
  /** Towers, piers, anchorages: they stand in the ground; the terrain stays. */
  None: 0,
  /** A deck piece: no ground above its road surface, across its whole width and a bank beside it. */
  Deck: 1,
  /**
   * A deck piece near either end of the bridge, where its approach meets the ground: the builders end the approach
   * where the road reaches the terrain on the axis, so only the ground beside the axis is lowered (else the ends,
   * and the volumes, would move on every rebake).
   */
  DeckEnd: 2,
} as const;
/** Clearance (m) kept around every structure volume, in plan and below it. */
export const STRUCTURE_CLEARANCE = 1.5;
/**
 * Height (m) above the ground within which a bridge's volume reserves the land use under it (geo/prepare.ts): the
 * tallest procedural building or tree that could stand under it. Decks higher above the ground (the Bosphorus spans,
 * the approaches over the shore) leave the land under them as it is.
 */
export const STRUCTURE_REACH = 45;
/**
 * Verge (m) reserved around such a volume: at least the land-use grid's half cell diagonal (8.3 m), so the 10 m deck
 * pieces and the thin tower legs reserve every cell they touch.
 */
export const STRUCTURE_VERGE = 9;

export interface StructureVolumeFile {
  version: 1;
  /** Landmark ids whose volumes the file holds. */
  structures: { id: string; boxes: number[] }[];
}

let cached: Float32Array | null = null;

/** Every baked box of every structure, STRUCTURE_STRIDE floats each. */
export function structureBoxes(): Float32Array {
  if (!cached) {
    const file = DATA as StructureVolumeFile;
    cached = Float32Array.from(file.structures.flatMap((s) => s.boxes));
  }
  return cached;
}

const CELL = 128;
const indexes = new WeakMap<ArrayLike<number>, Map<number, number[]>>();
const key = (i: number, j: number): number => (i + 4096) * 8192 + (j + 4096);

/** Box offsets per CELL-square (built once per box array). */
function indexOf(boxes: ArrayLike<number>): Map<number, number[]> {
  let idx = indexes.get(boxes);
  if (!idx) {
    idx = new Map();
    for (let o = 0; o < boxes.length; o += STRUCTURE_STRIDE) {
      const [x0, z0, x1, z1] = boundsOf(boxes, o, 0);
      for (let j = Math.floor(z0 / CELL); j <= Math.floor(z1 / CELL); j++) {
        for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) {
          const list = idx.get(key(i, j)) ?? [];
          list.push(o);
          idx.set(key(i, j), list);
        }
      }
    }
    indexes.set(boxes, idx);
  }
  return idx;
}

/** Offsets of the boxes whose cells meet the bounds (grown by `grow`); empty far from every structure. */
function candidates(boxes: ArrayLike<number>, minX: number, minZ: number, maxX: number, maxZ: number, grow: number): number[] {
  if (!boxes.length) {
    return [];
  }
  const idx = indexOf(boxes);
  const out = new Set<number>();
  for (let j = Math.floor((minZ - grow) / CELL); j <= Math.floor((maxZ + grow) / CELL); j++) {
    for (let i = Math.floor((minX - grow) / CELL); i <= Math.floor((maxX + grow) / CELL); i++) {
      for (const o of idx.get(key(i, j)) ?? []) {
        out.add(o);
      }
    }
  }
  return [...out];
}

/** Whether a plan rectangle comes within `grow` of any structure box (a cheap test before planning a building). */
export function nearStructure(minX: number, minZ: number, maxX: number, maxZ: number, grow = STRUCTURE_CLEARANCE, boxes: ArrayLike<number> = structureBoxes()): boolean {
  for (const o of candidates(boxes, minX, minZ, maxX, maxZ, grow)) {
    const [bx0, bz0, bx1, bz1] = boundsOf(boxes, o, grow);
    if (!(maxX < bx0 || minX > bx1 || maxZ < bz0 || minZ > bz1)) {
      return true;
    }
  }
  return false;
}

/** Axis-aligned bounds of box k grown by `grow`. */
function boundsOf(b: ArrayLike<number>, o: number, grow: number): [number, number, number, number] {
  const c = Math.abs(Math.cos(b[o + 4]));
  const s = Math.abs(Math.sin(b[o + 4]));
  const ex = c * b[o + 2] + s * b[o + 3] + grow;
  const ez = s * b[o + 2] + c * b[o + 3] + grow;
  return [b[o] - ex, b[o + 1] - ez, b[o] + ex, b[o + 1] + ez];
}

/** Box-local plan coordinates of a world point (the collision world's convention, core/collision.ts). */
function local(b: ArrayLike<number>, o: number, x: number, z: number): [number, number] {
  const cos = Math.cos(b[o + 4]);
  const sin = Math.sin(b[o + 4]);
  const dx = x - b[o];
  const dz = z - b[o + 1];
  return [dx * cos - dz * sin, dx * sin + dz * cos];
}

/** Whether segment p-q (box-local) crosses the rectangle |x| <= hx, |z| <= hz (Liang-Barsky). */
function segmentHitsRect(px: number, pz: number, qx: number, qz: number, hx: number, hz: number): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = qx - px;
  const dz = qz - pz;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) {
      return q >= 0;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) {
        return false;
      }
      t0 = Math.max(t0, r);
    } else {
      if (r < t0) {
        return false;
      }
      t1 = Math.min(t1, r);
    }
    return true;
  };
  return clip(-dx, px + hx) && clip(dx, hx - px) && clip(-dz, pz + hz) && clip(dz, hz - pz) && t0 <= t1;
}

function pointInFlatRing(r: ArrayLike<number>, x: number, z: number): boolean {
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

/**
 * Whether a prism (flat ring, standing from y0 to y1 m above its ground) enters a structure volume. `boxes` defaults
 * to every baked structure.
 */
export function prismHitsStructure(ring: ArrayLike<number>, y0: number, y1: number, boxes: ArrayLike<number> = structureBoxes(), clearance = STRUCTURE_CLEARANCE): boolean {
  if (!boxes.length) {
    return false;
  }
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < ring.length; i += 2) {
    minX = Math.min(minX, ring[i]);
    maxX = Math.max(maxX, ring[i]);
    minZ = Math.min(minZ, ring[i + 1]);
    maxZ = Math.max(maxZ, ring[i + 1]);
  }
  const n = ring.length / 2;
  for (const o of candidates(boxes, minX, minZ, maxX, maxZ, clearance)) {
    if (!(y0 < boxes[o + 6] && y1 > boxes[o + 5] - clearance)) {
      continue;
    }
    const [bx0, bz0, bx1, bz1] = boundsOf(boxes, o, clearance);
    if (maxX < bx0 || minX > bx1 || maxZ < bz0 || minZ > bz1) {
      continue;
    }
    const hx = boxes[o + 2] + clearance;
    const hz = boxes[o + 3] + clearance;
    for (let i = 0; i < n; i++) {
      const [px, pz] = local(boxes, o, ring[i * 2], ring[i * 2 + 1]);
      const j = (i + 1) % n;
      const [qx, qz] = local(boxes, o, ring[j * 2], ring[j * 2 + 1]);
      if (segmentHitsRect(px, pz, qx, qz, hx, hz)) {
        return true;
      }
    }
    // The box wholly inside the ring.
    if (pointInFlatRing(ring, boxes[o], boxes[o + 1])) {
      return true;
    }
  }
  return false;
}

/** Whether a disc of radius r at (x, z), standing from y0 to y1 m above its ground (a tree), enters a structure volume. */
export function discHitsStructure(x: number, z: number, r: number, y0: number, y1: number, boxes: ArrayLike<number> = structureBoxes(), clearance = STRUCTURE_CLEARANCE): boolean {
  for (const o of candidates(boxes, x, z, x, z, r + clearance)) {
    if (!(y0 < boxes[o + 6] && y1 > boxes[o + 5] - clearance)) {
      continue;
    }
    const [bx0, bz0, bx1, bz1] = boundsOf(boxes, o, clearance + r);
    if (x < bx0 || x > bx1 || z < bz0 || z > bz1) {
      continue;
    }
    const [lx, lz] = local(boxes, o, x, z);
    const dx = Math.max(0, Math.abs(lx) - boxes[o + 2]);
    const dz = Math.max(0, Math.abs(lz) - boxes[o + 3]);
    if (dx * dx + dz * dz < (r + clearance) * (r + clearance)) {
      return true;
    }
  }
  return false;
}

/**
 * Plan outlines (flat rings) of the boxes whose bottom lies within `reach` m of the ground: where a building or tree
 * of that height could touch the structure. The geo build reserves them in the land use (prepare.ts), so the
 * procedural city and the trees keep off bridge towers and low approaches.
 */
export function lowStructureOutlines(reach: number, grow: number, boxes: ArrayLike<number> = structureBoxes()): number[][] {
  const out: number[][] = [];
  for (let o = 0; o < boxes.length; o += STRUCTURE_STRIDE) {
    if (boxes[o + 5] > reach) {
      continue;
    }
    const cos = Math.cos(boxes[o + 4]);
    const sin = Math.sin(boxes[o + 4]);
    const hx = boxes[o + 2] + grow;
    const hz = boxes[o + 3] + grow;
    const ring: number[] = [];
    for (const [lx, lz] of [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]]) {
      // Inverse of local(): world = R(-yaw) * local.
      ring.push(boxes[o] + lx * cos + lz * sin, boxes[o + 1] - lx * sin + lz * cos);
    }
    out.push(ring);
  }
  return out;
}
