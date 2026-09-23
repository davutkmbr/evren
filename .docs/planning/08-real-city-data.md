# Phase 08 — Real city data (Overture / OSM)

Milestone: C · Realistic city · Effort: L · Depends on: 01, 02

## Goal

Buildings and streets in their real places in Istanbul, with their real shapes and heights. The biggest jump in visual
realism. Lighting, the night city and materials stay procedural.

## Data sources

- **Overture Maps buildings:** A conflation of OSM, Esri Community Maps, Google Open Buildings and Microsoft ML Building
  Footprints. Footprints, height where available, floor count and OSM roof shape (`roof:shape`). Licence: ODbL.
- **Overture/OSM transportation:** The real road network (class, lanes, bridge and tunnel flags), tram and metro lines.
- **Overture/OSM base and land use:** Parks, cemeteries, squares, piers.
- Attribution: a "© OpenStreetMap contributors, Overture Maps Foundation" line in the UI (ODbL "Produced Work" requirement).

## Scope

1. **Data pipeline** (`scripts/data/`, Node): download Overture GeoParquet for the Istanbul box, convert to local
   coordinates, simplify, and pack into compact binary tiles (e.g. 500 m) at `public/data/city/*.bin`: footprint polygon,
   height, floors, roof type and building class (residential, mosque, office, industrial…).
2. **Estimating missing heights:** From the district profile (existing `District.floorsMean/floorsMax`) and footprint
   area. Low in the historic fabric, high in Levent.
3. **City module switches to data mode:** Real footprints are extruded instead of procedural placement; the facade and
   roof shaders stay as they are. Where there is no data, the current procedural generation remains as a fallback.
4. **Roof shapes:** Hipped, gabled, flat, dome; real hipped roofs from the footprint polygon via a straight skeleton.
5. **Road network:** The terrain module's road mask and traffic are fed from the real network (Phase 09); thanks to the
   bridge and tunnel flags, bridge roads run over the deck rather than the terrain.
6. **Overlap with landmarks:** Footprints of landmarks already in Overture (Hagia Sophia, Galata Kulesi…) are removed
   inside landmark pads; the procedural landmark models stay.
7. **LOD and streaming:** The existing city streaming system is kept; tile files are decoded in worker threads; far tiles show only tall buildings.

## Technical notes

- Estimated data size: a few hundred thousand buildings for the city core; tens of MB tiled and compressed. Int16
  vertices with local coordinates and 0.1 m quantization.
- Consistency with the geo coastline: footprints spilling into the sea are clipped.
- Licence: the ODbL share-alike requirement only applies if we distribute a derived database; if the packed tiles are
  published openly they are released under ODbL (stated in the README).

## Acceptance criteria

- `?view=galata`, `sultanahmet`, `uskudar`, `kadikoy` and `levent` views are recognisable in street fabric and building
  clusters when compared side by side with real satellite imagery.
- Performance: 60 fps on "high"; no hitches while streaming (main-thread work ≤ 2 ms/frame).
- Initial load time grows by at most 3 s (tiles load lazily).
- The attribution line is visible.
