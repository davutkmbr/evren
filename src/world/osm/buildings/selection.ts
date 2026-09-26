/**
 * Which OSM buildings the map draws. One rule for the flight-scale OSM layer (build.ts, seen from the air) and the
 * compiled street tiles (tools/world-compiler, seen up close), so both show the same map; only the detail differs.
 * `npm run check:map` (tools/headless/map-consistency-check.ts) checks both sides against it.
 *
 * - Outlines with building:part children are replaced by their parts (Simple 3D Buildings).
 * - NON_SOLID_KINDS are not drawn at all. CANOPY_KINDS are roofs on posts: the street tiles draw them as canopies,
 *   and the flight layer leaves them out, because a 0.3 m slab is detail that is too small to see from the air.
 * - A building on the ground claim of a landmark the game models itself (landmarks/claims.ts: mostly (PAD_COVER_MAX)
 *   inside a pad, or touching a line landmark's body such as the aqueduct) is left to that model. The street tiles
 *   flag it as a landmark (no geometry), so the game's model shows there at every distance.
 * - A building that would enter a bridge (landmarks/structure-volumes.ts: its towers, piers, anchorages or a deck
 *   that runs within its roof height) is left out (onStructure), wherever it stands; a house under a high deck stays.
 * - Nothing is dropped for the coarse geo shoreline. That grid misses reclaimed quays by up to about 90 m, and the
 *   street tiles keep every mapped building on the quays and piers.
 */
import { ringTouchesLineBody, type LandmarkClaims } from '../../landmarks/claim-shapes';
import { nearStructure, prismHitsStructure } from '../../landmarks/structure-volumes';

/** building=* values that are not solid buildings. */
export const NON_SOLID_KINDS: ReadonlySet<string> = new Set(['ruins', 'collapsed', 'bridge', 'construction', 'no']);
/** building=* values drawn as canopies up close and left out from the air. */
export const CANOPY_KINDS: ReadonlySet<string> = new Set(['roof', 'carport']);
/** A building with more than this fraction of its outline vertices (and centroid) on a landmark pad is the landmark's. */
export const PAD_COVER_MAX = 0.5;

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

/**
 * True when the ring (already cleaned, see footprint.ts cleanRing) belongs to a modelled landmark's ground claim
 * (landmarks/claims.ts): it lies mostly on a pad, or touches a line landmark's body.
 */
export function onLandmarkClaim(claims: LandmarkClaims, ring: readonly number[]): boolean {
  if (claims.pads.length) {
    const c = ringCentroid(ring);
    if (padCover(claims.pads, ring, c.x, c.z) > PAD_COVER_MAX) {
      return true;
    }
  }
  return claims.lines.length > 0 && ringTouchesLineBody(claims.lines, ring);
}

/** Whether the ring's bounds come near a structure volume of the claims (a cheap test before planning heights). */
export function nearClaimedStructure(claims: LandmarkClaims, ring: readonly number[]): boolean {
  if (!claims.structures?.length) {
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
  return nearStructure(minX, minZ, maxX, maxZ, undefined, claims.structures);
}

/**
 * True when a building standing from `y0` to `y1` m above its ground on `ring` would enter a structure of the claims
 * (a bridge's tower, pier, anchorage or deck): it is left to the structure.
 */
export function onStructure(claims: LandmarkClaims, ring: readonly number[], y0: number, y1: number): boolean {
  return !!claims.structures?.length && prismHitsStructure(ring, y0, y1, claims.structures);
}
