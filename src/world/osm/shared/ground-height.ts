/**
 * Height of the OSM ground (street-surface.ts StreetSurface.baseAt without the ground grid): terrain + GROUND_LIFT,
 * coastal ground below QUAY_TOP raised towards it. Its own small module so the city workers (the far OSM layer) can
 * stand the baked buildings on the same ground as the flight-scale layer without pulling in the street raster.
 */
import { GROUND_LIFT } from './ground';

/** Quay top above the water (m): lower coastal ground is raised to it (the terrain slopes into the sea there). */
export const QUAY_TOP = 0.95;
/** The quay raise holds up to QUAY_FLAT m from the coast and fades out by QUAY_FADE m. */
const QUAY_FLAT = 14;
const QUAY_FADE = 32;

/**
 * Height of the OSM ground before kerb lifts (carriageways) from the geo terrain height and signed coast distance at a
 * point: terrain + GROUND_LIFT, coastal ground below QUAY_TOP raised towards it (StreetSurface.quayGridValues() per
 * grid vertex). Other modules use it to meet the drawn street exactly (bridge abutments, structures standing in the
 * slice, the far OSM layer's buildings).
 */
export function osmGroundHeight(terrain: number, coast: number): number {
  return terrain + GROUND_LIFT + quayRaise(terrain + GROUND_LIFT, coast);
}

/** Raise (m) of ground at height `y` and signed coast distance `coast` (m, positive on land) towards QUAY_TOP. */
export function quayRaise(y: number, coast: number): number {
  if (coast >= QUAY_FADE || y >= QUAY_TOP) {
    return 0;
  }
  const t = Math.min(1, Math.max(0, (QUAY_FADE - coast) / (QUAY_FADE - QUAY_FLAT)));
  return (QUAY_TOP - y) * t * t * (3 - 2 * t);
}
