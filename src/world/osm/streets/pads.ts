/**
 * Landmark pads (OsmWorkerBase.reserved) as the streets layer applies them: pads standing on land (mosques, towers,
 * stations) keep the OSM ground and street lamps away because the landmark brings its own. Pads centred on the water
 * (the Golden Horn bridges) are skipped: their discs reach far over both shores, where the quays, squares and bridge
 * approaches are ordinary OSM streets.
 */
import type { GeoSampler } from '../shared/geo';

export type PadTest = (x: number, z: number) => boolean;

export function landPads(geo: GeoSampler, reserved: readonly number[]): PadTest {
  const pads: number[] = [];
  for (let k = 0; k < reserved.length; k += 3) {
    if (!geo.isWater(reserved[k], reserved[k + 1])) {
      pads.push(reserved[k], reserved[k + 1], reserved[k + 2]);
    }
  }
  return (x, z) => {
    for (let k = 0; k < pads.length; k += 3) {
      const r = pads[k + 2];
      if ((x - pads[k]) ** 2 + (z - pads[k + 1]) ** 2 < r * r) {
        return true;
      }
    }
    return false;
  };
}
