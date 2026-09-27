/**
 * Places closed to private motor traffic by local rule rather than by per-way OSM tags, for both traffic systems (the
 * procedural road network here and the OSM lane graph, osm/traffic/network.ts) and the OSM parking lots.
 * - Adalar (the Princes' Islands): no private cars; the islands' few municipal electric vehicles are not modelled.
 *   The outline runs through the sea around Kınalıada, Burgazada, Heybeliada, Büyükada and Sedef Adası and keeps the
 *   Maltepe–Kartal shore outside.
 */
import { latLonToLocal } from '../../../core/geo-coords';

const ZONES_LATLON: readonly { name: string; ring: readonly (readonly [number, number])[] }[] = [
  {
    name: 'Adalar',
    ring: [
      [40.928, 29.032],
      [40.928, 29.103],
      [40.904, 29.139],
      [40.885, 29.157],
      [40.833, 29.163],
      [40.833, 29.032],
    ],
  },
];

/** The zones as flat [x, z, ...] rings in world metres. */
const ZONES: readonly number[][] = ZONES_LATLON.map((z) =>
  z.ring.flatMap(([lat, lon]) => {
    const p = latLonToLocal(lat, lon);
    return [p.x, p.z];
  }),
);

/** True when (x, z) lies in a car-free zone. */
export function carFree(x: number, z: number): boolean {
  for (const r of ZONES) {
    let inside = false;
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      if (r[i + 1] > z !== r[j + 1] > z && x < ((r[j] - r[i]) * (z - r[i + 1])) / (r[j + 1] - r[i + 1]) + r[i]) {
        inside = !inside;
      }
    }
    if (inside) {
      return true;
    }
  }
  return false;
}
