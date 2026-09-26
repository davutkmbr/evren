import type { GeoQuery } from '../../core/contracts';
import { inRects, osmStaticExclusion } from '../osm/regions';
import { osmGroundHeight, QUAY_EDGE } from '../osm/shared/street-surface';

/**
 * The ground a landmark stands on: the OSM street ground inside the OSM regions (quays raised, ground lift), the geo
 * terrain elsewhere, so abutments, piers and bases meet the drawn surface exactly. `terrain` skips the height lookup
 * when the caller already has geo.heightAt(x, z).
 */
export function visibleGround(geo: GeoQuery): (x: number, z: number, terrain?: number) => number {
  const rects = osmStaticExclusion();
  return (x, z, terrain) => {
    const h = terrain ?? geo.heightAt(x, z);
    if (!inRects(rects, x, z)) {
      return h;
    }
    // The OSM ground ends in the quay wall (QUAY_EDGE): seaward of it the sea floor stays.
    const c = geo.coastDistance(x, z);
    return c > QUAY_EDGE ? osmGroundHeight(h, c) : h;
  };
}
