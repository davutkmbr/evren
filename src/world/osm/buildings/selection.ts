/**
 * Which OSM buildings the map draws. One rule for the flight-scale OSM layer (build.ts, seen from the air) and the
 * compiled street tiles (tools/world-compiler, seen up close), so both show the same map; only the detail differs.
 * `npm run check:map` (tools/headless/map-consistency-check.ts) checks both sides against it.
 *
 * - Outlines with building:part children are replaced by their parts (Simple 3D Buildings).
 * - NON_SOLID_KINDS are not drawn at all. CANOPY_KINDS are roofs on posts: the street tiles draw them as canopies,
 *   and the flight layer leaves them out, because a 0.3 m slab is detail that is too small to see from the air.
 * - A building that lies mostly (PAD_COVER_MAX) inside the pad of a landmark the game models itself (a mosque, a
 *   palace or a tower) is left to that model. The street tiles flag it as a landmark (no geometry), so the game's
 *   model shows there at every distance.
 * - Nothing is dropped for the coarse geo shoreline. That grid misses reclaimed quays by up to about 90 m, and the
 *   street tiles keep every mapped building on the quays and piers.
 */

/** building=* values that are not solid buildings. */
export const NON_SOLID_KINDS: ReadonlySet<string> = new Set(['ruins', 'collapsed', 'bridge', 'construction', 'no']);
/** building=* values drawn as canopies up close and left out from the air. */
export const CANOPY_KINDS: ReadonlySet<string> = new Set(['roof', 'carport']);
/** A building with more than this fraction of its outline vertices (and centroid) on a landmark pad is the landmark's. */
export const PAD_COVER_MAX = 0.5;

/** Landmark kinds that are linear (bridges, city walls): they own no pad. */
const LINEAR_LANDMARKS = new Set(['bridge', 'walls']);

/** Pads (x, z, radius triples) of the landmarks the game models itself; linear landmarks have none. */
export function landmarkPadsOf(landmarks: readonly { kind: string; x: number; z: number; radius: number }[]): number[] {
  const out: number[] = [];
  for (const l of landmarks) {
    if (!LINEAR_LANDMARKS.has(l.kind)) {
      out.push(l.x, l.z, l.radius);
    }
  }
  return out;
}

function padHit(pads: ArrayLike<number>, x: number, z: number): boolean {
  for (let k = 0; k < pads.length; k += 3) {
    const dx = x - pads[k];
    const dz = z - pads[k + 1];
    if (dx * dx + dz * dz < pads[k + 2] * pads[k + 2]) {
      return true;
    }
  }
  return false;
}

/** Fraction of ring vertices (and the centroid cx, cz) inside a pad. */
export function padCover(pads: ArrayLike<number>, r: readonly number[], cx: number, cz: number): number {
  let hit = padHit(pads, cx, cz) ? 1 : 0;
  const n = r.length / 2;
  for (let i = 0; i < n; i++) {
    hit += padHit(pads, r[i * 2], r[i * 2 + 1]) ? 1 : 0;
  }
  return hit / (n + 1);
}

/** Vertex mean of a flat ring. */
export function ringCentroid(r: readonly number[]): { x: number; z: number } {
  const n = r.length / 2;
  let x = 0;
  let z = 0;
  for (let i = 0; i < n; i++) {
    x += r[i * 2];
    z += r[i * 2 + 1];
  }
  return { x: x / n, z: z / n };
}

/** True when the ring (already cleaned, see footprint.ts cleanRing) lies mostly on a landmark pad. */
export function onLandmarkPad(pads: ArrayLike<number>, ring: readonly number[]): boolean {
  if (!pads.length) {
    return false;
  }
  const c = ringCentroid(ring);
  return padCover(pads, ring, c.x, c.z) > PAD_COVER_MAX;
}
