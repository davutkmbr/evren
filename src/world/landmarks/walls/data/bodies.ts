/**
 * The placed city walls' bodies, from the land-use corridors the walls bake writes (corridors.json): each corridor is
 * the wall's half width (or a tower's outline) plus WALL_CORRIDOR_GROW. Props and trees of other systems ask
 * inWallBody() so a lamp or a crown never stands inside the masonry; the ground around the walls stays theirs.
 * Import-free apart from the data, so workers use it too.
 */
import CORRIDORS from './corridors.json';

/** Land-use corridor growth (m) beyond the wall faces / tower outlines (the walls bake adds it, plan.ts). */
export const WALL_CORRIDOR_GROW = 9;

const CELL = 50;

interface Segments {
  /** ax, az, bx, bz, half width per segment. */
  seg: Float32Array;
  cells: Map<number, number[]>;
}

let index: Segments | null = null;

const key = (i: number, j: number): number => (i + 4096) * 8192 + (j + 4096);

function build(): Segments {
  const seg: number[] = [];
  const cells = new Map<number, number[]>();
  for (const line of (CORRIDORS as { lines: number[][] }).lines) {
    const hw = line[0] - WALL_CORRIDOR_GROW;
    if (hw <= 0) {
      continue;
    }
    for (let k = 1; k + 3 < line.length; k += 2) {
      const [ax, az, bx, bz] = [line[k], line[k + 1], line[k + 2], line[k + 3]];
      const id = seg.length / 5;
      seg.push(ax, az, bx, bz, hw);
      const i0 = Math.floor((Math.min(ax, bx) - hw) / CELL);
      const i1 = Math.floor((Math.max(ax, bx) + hw) / CELL);
      const j0 = Math.floor((Math.min(az, bz) - hw) / CELL);
      const j1 = Math.floor((Math.max(az, bz) + hw) / CELL);
      for (let i = i0; i <= i1; i++) {
        for (let j = j0; j <= j1; j++) {
          const c = cells.get(key(i, j));
          if (c) {
            c.push(id);
          } else {
            cells.set(key(i, j), [id]);
          }
        }
      }
    }
  }
  return { seg: new Float32Array(seg), cells };
}

/** Whether (x, z) lies within `margin` m of a city wall's or tower's body. */
export function inWallBody(x: number, z: number, margin = 0): boolean {
  const { seg, cells } = (index ??= build());
  const list = cells.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
  if (!list) {
    return false;
  }
  for (const id of list) {
    const o = id * 5;
    const ax = seg[o];
    const az = seg[o + 1];
    const dx = seg[o + 2] - ax;
    const dz = seg[o + 3] - az;
    const l2 = dx * dx + dz * dz;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
    const r = seg[o + 4] + margin;
    if ((x - ax - t * dx) ** 2 + (z - az - t * dz) ** 2 < r * r) {
      return true;
    }
  }
  return false;
}
