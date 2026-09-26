/**
 * Worker-safe shapes and tests of the landmark ground claims (claims.ts builds them on the main thread).
 */
export interface LandmarkClaims {
  /** x, z, radius triples. */
  pads: Float32Array;
  /** ax, az, bx, bz, body radius, corridor radius per segment of a line landmark. */
  lines: Float32Array;
}

export const LINE_STRIDE = 6;

/** Squared distance from (x, z) to the segment a-b. */
function segDist2(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
  const ex = x - ax - t * dx;
  const ez = z - az - t * dz;
  return ex * ex + ez * ez;
}

/** Whether (x, z) lies within `grow` + the body of any line claim. */
export function onLineBody(lines: ArrayLike<number>, x: number, z: number, grow = 0): boolean {
  for (let k = 0; k < lines.length; k += LINE_STRIDE) {
    const r = lines[k + 4] + grow;
    if (segDist2(x, z, lines[k], lines[k + 1], lines[k + 2], lines[k + 3]) < r * r) {
      return true;
    }
  }
  return false;
}

function segmentsCross(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): boolean {
  const d1 = (dx - cx) * (az - cz) - (dz - cz) * (ax - cx);
  const d2 = (dx - cx) * (bz - cz) - (dz - cz) * (bx - cx);
  const d3 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
  const d4 = (bx - ax) * (dz - az) - (bz - az) * (dx - ax);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

function pointInRing(ring: ArrayLike<number>, x: number, z: number): boolean {
  let inside = false;
  const n = ring.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
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

/**
 * Whether a building outline (flat x, z ring) touches the body of any line claim: an outline vertex within the body
 * radius, an outline edge closer than it to the line, or the line running through the outline.
 */
export function ringTouchesLineBody(lines: ArrayLike<number>, ring: ArrayLike<number>): boolean {
  const n = ring.length / 2;
  for (let k = 0; k < lines.length; k += LINE_STRIDE) {
    const ax = lines[k];
    const az = lines[k + 1];
    const bx = lines[k + 2];
    const bz = lines[k + 3];
    const r = lines[k + 4];
    const r2 = r * r;
    for (let i = 0; i < n; i++) {
      const px = ring[i * 2];
      const pz = ring[i * 2 + 1];
      const j = (i + 1) % n;
      const qx = ring[j * 2];
      const qz = ring[j * 2 + 1];
      if (
        segDist2(px, pz, ax, az, bx, bz) < r2 ||
        segDist2(ax, az, px, pz, qx, qz) < r2 ||
        segDist2(bx, bz, px, pz, qx, qz) < r2 ||
        segmentsCross(ax, az, bx, bz, px, pz, qx, qz)
      ) {
        return true;
      }
    }
    if (pointInRing(ring, ax, az)) {
      return true;
    }
  }
  return false;
}
