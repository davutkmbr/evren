/**
 * The OSM slice's ground for the shared stand rule (src/world/placement/stand.ts): valid only over the street raster
 * (the build rect, where the OSM ground mesh exists; OSM ways run far beyond it and every lookup there clamps to the
 * rect edge), coast from the geo window, ground = the visible OSM ground (StreetSurface.heightAt).
 */
import type { StandGround } from '../../placement/stand';
import type { FootprintIndex } from './footprints';
import { Zone, type StreetSurface } from './street-surface';

/** Metres kept inside the raster edge (the last texels blend with the terrain seam). */
const EDGE_INSET = 1;
/** Metres inside the carriageway edge from which a spot counts as on the carriageway. */
const CARRIAGEWAY_EDGE = 0.25;

export function osmStandGround(surface: StreetSurface, footprints?: FootprintIndex): StandGround {
  const r = surface.raster;
  const minX = r.minX + EDGE_INSET;
  const minZ = r.minZ + EDGE_INSET;
  const maxX = r.minX + r.w * r.px - EDGE_INSET;
  const maxZ = r.minZ + r.h * r.px - EDGE_INSET;
  return {
    covers: (x, z) => x >= minX && x <= maxX && z >= minZ && z <= maxZ,
    coast: (x, z) => surface.geo.coast(x, z),
    ground: (x, z) => surface.heightAt(x, z),
    inBuilding: footprints ? (x, z) => footprints.inside(x, z) : undefined,
    // Clearly on a vehicular carriageway (the lane lanterns of kerbless streets stand on its edge band).
    onCarriageway: (x, z) => surface.distance(x, z) < -CARRIAGEWAY_EDGE && surface.zone(x, z) === Zone.Carriageway,
  };
}
