/** A building outline taken from OpenStreetMap. */
export interface OsmFootprint {
  /** Stable key (slug of the OSM name, or t<way id>). */
  key: string;
  /** Flat lat, lon pairs of an open ring. */
  ll: readonly number[];
  /** OSM height (m above ground), when tagged. */
  h?: number;
  /** OSM min_height (m), for building parts. */
  minH?: number;
  /** OSM roof:shape, when tagged. */
  roof?: string;
}

/** A named point with an optional size (m). */
export interface GeoPoint {
  lat: number;
  lon: number;
}
