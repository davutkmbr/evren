# Data licence (data/osm)

- All files: OpenStreetMap data, © OpenStreetMap contributors, available under the
  [Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
- Source: since 2026-09-26 the fetch scripts (`scripts/data/fetch-osm.mjs`, `fetch-walls.mjs`, `osm-regions.mjs`)
  read a local extract by default instead of the public Overpass API: the Geofabrik Turkey extract
  (`https://download.geofabrik.de/europe/turkey-latest.osm.pbf`, downloaded 2026-09-26 as `turkey-260925.osm.pbf`,
  md5 `e8f36db2459374f4031406539262e58c`, OSM data as of 2026-09-25T20:24:36Z), clipped to the İstanbul province
  (40.7–41.7 N, 27.9–30.0 E) by `scripts/data/osm-extract.mjs`. Geofabrik redistributes OpenStreetMap data under the
  same ODbL 1.0; the extract and its index live in `data/osm-src/` (gitignored). Files record their source in
  `source` (the extract's host, or `Overpass API`) and the OSM data timestamp in `osmBase`.
- Refresh of 2026-09-26 (phase 24): the regions, the Galata slice and every street area were re-fetched from one
  extract, so near and far layers share one snapshot. `download.geofabrik.de` was unreachable from the cloud session,
  so the same Turkey extract came from the OpenStreetMap France mirror
  (`https://download.openstreetmap.fr/extracts/europe/turkey-latest.osm.pbf`, md5
  `20b78addfc93d177d3911fdf47277532`, OSM data as of 2026-09-25T01:52:55Z; OpenStreetMap France redistributes it
  under the same ODbL 1.0). `walls.json` was not re-fetched.
- `walls.json` additionally contains the course of the Constantinople sea walls from OpenHistoricalMap
  ([way 198283607](https://www.openhistoricalmap.org/way/198283607)), OpenHistoricalMap contributors,
  [CC0 1.0](https://www.openhistoricalmap.org/copyright) ("Map data courtesy of the OpenHistoricalMap project, in the
  public domain unless otherwise noted"). Those lines carry `"src": "ohm-walls-constantinople"`; approved 2026-09-26
  (`tools/assets/approved.json`, `.docs/assets/candidates/sea-walls-data.md`).
- The far OSM layer bake (`public/data/osm/city/`, `src/world/city/osm/mask.json`; phase 24, `npm run bake:city`) is a
  derived database of the same extract (OSM data as of 2026-09-25T01:52:55Z) and is released under the same ODbL 1.0,
  © OpenStreetMap contributors. The attribution line in the game covers it.
