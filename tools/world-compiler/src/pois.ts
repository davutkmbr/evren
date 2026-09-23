/** Classification of OSM points into the manifest's POIs, entrances and street furniture. */
import type { OsmStreetPoint } from './osm-street';

/** amenity=* values that are places (POIs), not street furniture. */
const POI_AMENITIES = new Set([
  'cafe',
  'restaurant',
  'fast_food',
  'bar',
  'pub',
  'biergarten',
  'ice_cream',
  'food_court',
  'bank',
  'bureau_de_change',
  'pharmacy',
  'clinic',
  'dentist',
  'doctors',
  'hospital',
  'veterinary',
  'post_office',
  'library',
  'theatre',
  'cinema',
  'arts_centre',
  'community_centre',
  'nightclub',
  'events_venue',
  'place_of_worship',
  'school',
  'kindergarten',
  'college',
  'university',
  'language_school',
  'music_school',
  'driving_school',
  'police',
  'townhall',
  'courthouse',
  'marketplace',
  'ferry_terminal',
  'internet_cafe',
  'hookah_lounge',
  'public_bath',
  'coworking_space',
  'studio',
  'money_transfer',
  'payment_centre',
]);

/**
 * Storefront POIs that get an inferred door on the street side of their building when no tagged entrance is near:
 * every shop=* and craft=*, and these amenities.
 */
const STOREFRONT_AMENITIES = new Set(['cafe', 'restaurant', 'fast_food', 'bar', 'pub', 'ice_cream', 'bank', 'bureau_de_change', 'pharmacy', 'internet_cafe', 'hookah_lounge', 'money_transfer', 'payment_centre']);

export function isEntrance(p: OsmStreetPoint): boolean {
  return p.kind.startsWith('entrance=') && p.kind !== 'entrance=no';
}

export function isPoi(p: OsmStreetPoint): boolean {
  const [key, value] = p.kind.split('=');
  return key === 'shop' || key === 'craft' || (key === 'tourism' && value !== 'artwork' && value !== 'information' && value !== 'viewpoint') || (key === 'amenity' && POI_AMENITIES.has(value));
}

export function isStorefront(p: OsmStreetPoint): boolean {
  const [key, value] = p.kind.split('=');
  return key === 'shop' || key === 'craft' || (key === 'amenity' && STOREFRONT_AMENITIES.has(value));
}

export const isTree = (p: OsmStreetPoint): boolean => p.kind === 'natural=tree';
export const isBench = (p: OsmStreetPoint): boolean => p.kind === 'amenity=bench' || p.kind === 'leisure=picnic_table';

/** Door size (width, clear height in m) of an entrance by its entrance=* value and tagged width. */
export function entranceSize(p: OsmStreetPoint): [number, number] {
  const v = p.kind.slice('entrance='.length);
  const [w, h] = v === 'garage' ? [2.6, 2.4] : v === 'main' ? [1.6, 2.3] : v === 'service' || v === 'emergency' ? [1.0, 2.2] : v === 'staircase' || v === 'home' ? [1.1, 2.2] : [1.2, 2.3];
  return [p.width ? Math.min(Math.max(p.width, 0.8), 4) : w, h];
}

/** Door size of an inferred storefront door. */
export const INFERRED_DOOR: [number, number] = [1.4, 2.3];
