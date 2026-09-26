# Phase 24 — Far OSM layer: the real map out to the horizon

Milestone: C · Realistic city · Effort: L · Depends on: 16 (street layer), 23 (feature kits, region data), the
one-map rule (`src/world/osm/buildings/selection.ts`, `npm run check:map`)

A concrete version of [phase 08](08-real-city-data.md), items 1–3, 6 and 7. The data now comes from the local OSM
extract we already use (`scripts/data/osm-extract.mjs`) instead of Overture. The rendering reuses the procedural
city's streamer, vertex format and shaders, so the far city keeps its look and its cost profile.

## Problem

Today one real place is drawn from three different sources, depending on distance:

| Distance (high) | Buildings | Parks and trees |
|---|---|---|
| < 110 m and < 80 m AGL in a street area | compiled street tiles (OSM) | OSM (flight-layer trees) |
| < 2.6 km of a region (1.4 km on low) | flight-scale OSM region layer | OSM ground cover and OSM tree fill |
| everything else, out to 3.5–14 km | **procedural city** (seeded lots on the hand-drawn land use) | **hand-drawn land-use zones**, domain-warped by up to ±560 m; procedural trees |

- The region layer exists only within about 1.2 km of the 28 landing spots (46 regions, 117 km², 99,364 buildings,
  about 2 % of the province).
- Everywhere else, the city is procedural at every distance. A player who knows Istanbul sees an invented city.
- Approaching a landing spot, the procedural city is swapped for OSM in a single frame when the region finishes
  building (`osm/index.ts:341`, then `city-system.ts:374`, `streamer.ts:480-500` `swapRefreshed`, with no fade). The
  whole district changes shape, which is the "different map" players notice.

## Goal

From any distance, the buildings, parks and groves are those of the real map. Nearer layers only add detail:

- one building set;
- one height per building (within a floor);
- one park outline.

The procedural city remains only where OSM has no usable building coverage.

## Approach

### 1. Whole-city bake from the local extract (`scripts/data/osm-city.mjs`)

**Input.** The İstanbul index of the Geofabrik extract (`data/osm-src/istanbul.osmidx`, `scripts/data/lib/osm-local.mjs`),
clipped to the playable square (±24 km, `core/geo-coords.ts WORLD_HALF_SIZE`).

**Record rule.** The same record code as `fetch-osm.mjs`: ring simplification 0.35 m / min 12 m², parts over outlines
(S3DB), `fillLevels` for untagged buildings. The same draw rule as the other layers, `selection.ts`:

- non-solid kinds are dropped;
- canopies are left out;
- buildings on landmark pads are left out;
- wall-owned buildings are left out.

**Per-building attributes are computed at bake time with the flight layer's own code**, so a building looks the same
before and after its region loads. `osm/buildings/plan.ts` `planBuilding` / `wallHeight` give:

- wall height and roof rise;
- roof shape class (flat, hip, gable, dome);
- roof and wall colour;
- archetype and usage (residential / office / industrial / worship);
- floor height.

This needs `plan.ts` to run in Node without the worker surface. The ground height comes from the geo height grid at
bake time; the runtime adds the quay raise, as the region layer now does.

**Infill.** The flight layer's infill (`buildings/infill.ts`) is deterministic. The bake runs it with the same inputs:
the region data extent, street raster and keep-out rects. The parcels a region will draw then already stand in the far
layer. Alternative: drop infill once this layer lands. See decision 4 below.

**Tiling** follows the procedural city's quadtree: 500 m, 1 km and 2 km tiles (`city/protocol.ts:116`). Each level is
a pre-thinned set:

- **L0 (500 m):** every building, footprint simplified to 0.5 m.
- **L1 (1 km):** buildings under about 40 m² dropped, unless they sit in a row of neighbours. Footprints simplified
  to 2 m. Adjacent row buildings of the same height merged into one prism.
- **L2 (2 km):** only the fade classes the procedural L2 keeps: Skyline, Large and Mid (`city/protocol.ts:55-64`,
  thresholds 30 / 18 / 12 m). Footprints simplified to 4 m.

**Container.** The walls bake's container (`'WLB1'`-style header plus aligned blobs, gzip, loaded by
`src/street/format.ts fetchBytes` off the main thread). Per tile:

- quantised Int16 rings, 0.1 m around the tile origin;
- the per-building attribute block: height dm, min height dm, roof class, colour indices, usage, fade class and the
  OSM id (for the handover and the checks).

**Coverage mask.** Per 250 m cell (the city's layout cell): the OSM footprint coverage, compared with the building
coverage the procedural city would place there (land use + density grid). A cell counts as covered above a tuned
threshold. The mask is stored with the bake and decides OSM versus procedural per cell. Its outline is the only place
where the two may meet.

**Land use** (see section 4): OSM `landuse` / `leisure` / `natural` polygons, simplified to 2 m, written as a
polygon list per 2 km tile.

**Snapshot parity.** One run of the extract feeds all three: the city bake, the regions (`osm-regions.mjs fetch`) and
the street areas (`fetch-osm.mjs --area`). The data drift `check:map` reports today (Taksim green areas) then
disappears.

**Size estimate.** To be measured in S0. For scale: the region JSON is about 215 B per building (21.35 MB for 99k).
The binary record is about 40 B per building (Int16 rings, about 7 vertices, plus about 12 B of attributes). At
0.5–1.5 M buildings in the square, that is roughly 20–60 MB raw and 10–30 MB gzip for L0, plus about 30 % for L1/L2.

### 2. City worker in data mode (`src/world/city`)

The streamer, tile selection, split distances, workers, uploads, fade classes, distance sink, LOD screen-door
cross-fade, shadows, reflection rules and lamps all stay as they are. Only the tile content source changes, per
250 m cell:

- **Covered cell:** the worker decodes the baked buildings of the tile level and emits them through the existing
  emitters. That keeps the 32 B vertex format, the one material and the `cityEval` shading.
  - L1/L2 use `emitCompact`, generalised from rectangular lots to polygons: walls per ring edge, and the roof class
    from the bake. Hip and gable roofs go on the footprint's oriented box when the footprint is near-rectangular;
    otherwise the roof is flat with a parapet.
  - L0 outside the regions uses the same compact geometry plus the `emitNear` parts that do not assume a rectangular
    lot (parapets, rooftop clutter).
  - Towers still go through `emitTower` when the bake flags them.
- **Uncovered cell:** the procedural layout, as today. Procedural lots never cross into a covered cell.

Colliders and lamps come from the same buildings. Street lights along real streets are a later refinement; the
procedural lamp rule first.

**Exclusion changes meaning.**
- Today, active region rects remove all city content (`geo-window.ts:112`).
- In data mode, a loaded region instead removes the baked buildings whose centroid lies in its build rect. That is the
  same ownership rule the region layer uses, so each building is drawn by exactly one layer.

### 3. Handover without a pop

When a region becomes active, the city content in its rect and the region's buildings cross-fade over about 0.75 s.
The city uses the complementary screen-door dither it already has for LOD swaps (`CITY_FADE_FRAGMENT`,
`city.glsl.ts:725`). The region's facade and roof materials get the same dither (compare the street layer's
`STREET_DITHER_GLSL` fade slots). Unloading reverses it.

This also fixes the pop players see today. Because both sides are the same buildings (same footprint, height within a
floor, same colours), the fade reads as detail sharpening, not as the city changing.

### 4. Real parks and groves from afar

The bake's land-use polygons are stamped into the geo land-use grid inside the geo build, as a last stage after
`buildLandUse` and the road/pad stamps: park, forest, cemetery, grass→park, industrial, residential→urban. Only
covered cells are stamped. Stamping in the geo build, rather than swapping the terrain texture, means every consumer
sees the same map:

- terrain;
- vegetation placement;
- city lots;
- mosque site selection;
- the map UI;
- audio;
- flight thermals;
- cloud city glow.

The polygons load before the geo build starts. They are small, and they can be fetched in parallel with the other
startup data.

**Trees.**
- Far procedural trees then grow inside the real park and wood outlines, and the city leaves the real parks free.
- Individual tree positions still differ between the procedural impostors and the region's OSM tree fill. That is
  accepted as detail. Stretch goal: seed the vegetation lattice inside covered cells from the same hash as
  `osm/details/trees` park fill, so the same trees stand at every distance.

**Mosque sites.** `BuildInput.siteExclusion` grows from the region rects to every covered cell. In covered cells the
real mosques (tagged buildings, drawn with minarets by the region layer) stand instead.

### 5. Night and look parity

The procedural city and the OSM facades use different occupancy curves and emission scales:

- city: `city.glsl.ts:126-164`;
- OSM facades: `facade-glsl.ts:264-266, 715-729`.

The two get one shared curve and one scale, so windows do not change when a region loads. Decision 3 below picks the
curve. Roof and wall colours already match through the bake (section 1).

### 6. Checks

`npm run check:map` grows new sections:

- **Far vs region.** Inside every region rect, the baked building ids equal the ids the region layer draws. Checked
  through the real pipeline, as section 4 of the check does today.
  - Centroids match within 0.5 m (L0).
  - Wall height matches within one floor.
  - Roof class and colours match.
- **Coverage.** No procedural lot is placed in a covered cell. No baked building lies in an uncovered cell.
- **Land use.** Every OSM park, wood and cemetery polygon in a covered cell is stamped into the geo grid, and its
  area matches within 5 %.
- **Mosques.** No mosque site lies in a covered cell.
- **Snapshot.** The city bake, the region files and the street files share one `osmBase`.

Performance checks with `snap.mjs --perf` on the reference machine:

- `?view=levent`, `camlica`, `yuksek` and `uskudar`: triangles and draw calls per pass against the procedural city
  today.
- Streaming main-thread time per frame.
- Initial load time.

## Stages

| # | Stage | Result | Gate |
|---|---|---|---|
| S0 | Audit | Build the extract index; count OSM buildings, footprint coverage and land-use polygons per 250 m cell over the square; coverage map image against the procedural density; bake size estimate | **User decides** coverage scope and storage (decisions 1–2) |
| S1 | Bake | `osm-city.mjs` → L0/L1/L2 tiles, coverage mask and land-use polygons. Regions and street areas re-fetched from the same extract. `plan.ts` runs in Node | `check:map` far-vs-region section green |
| S2 | Data mode | City worker emits baked buildings in covered cells; region exclusion by centroid ownership | Views recognisable against satellite imagery (phase 08 criteria); perf within budget |
| S3 | Handover | Screen-door cross-fade between city and region content, both directions | No visible pop when flying into and out of every landing region |
| S4 | Land use | OSM land use stamped into the geo build; mosque sites and vegetation follow | `check:map` land-use section green |
| S5 | Night | One occupancy curve and emission scale | Night flight into a region shows no window change at the handover |

S2 is useful on its own even before S3–S5. S3 also helps before S2, because it removes today's pop against the
procedural city.

## Decisions for the user

1. **Coverage scope.**
   - (a) The whole playable square, with the procedural fallback in poorly mapped cells. Recommended: this is what
     fixes "the far map is different" everywhere.
   - (b) Only the 46 region rects, plus a ring around them. Smaller, and it fixes only the landing approaches.
2. **Storage of the bake** (10–30 MB gzip estimated, measured in S0).
   - Commit it under `public/data/osm/city/`, like the region files are today.
   - Or keep it gitignored and built locally like `public/world/`. Then the Pages deploy needs it from somewhere
     (see HANDOFF.md's open question on publishing `public/world/`).
   - Git LFS is the middle way.
3. **Night light model.** The procedural city's curve, with the terrain carpet already matching it: evening peak
   21 h, morning 6.7 h. Or the OSM facade curve.
4. **Infill.** Bake the same deterministic infill into the far layer (consistent, bake cost only). Or drop infill once
   real coverage decides where the city is.

## Not in this phase

- **The geo coastline.** The 23 m grid misses reclaimed quays by up to about 90 m. Buildings keep standing on the
  quay raise, as the region layer does now. Replacing the geo coast with the OSM coastline is a separate phase: it
  moves the terrain, water and every coast consumer.
- **Real road network for traffic and terrain roads.** That is phase 09.
- **Growing the region layer** (full facades, props, OSM trees) beyond the landing spots. The far layer is what makes
  that optional.

## Acceptance criteria

- On "high", flying from 9 km towards any landing spot shows no change of building layout, heights (beyond one floor)
  or park outlines. The handover to the region layer and to the street tiles reads as detail only.
- Phase 08's views (`?view=galata`, `sultanahmet`, `uskudar`, `kadikoy`, `levent`) are recognisable next to
  satellite imagery.
- `npm run check:map` is green, including the new sections.
- Performance:
  - 60 fps on "high" (M2 Max, 1600 × 900);
  - triangles and draw calls per pass within 10 % of today's procedural city on the reference views;
  - streaming main-thread work ≤ 2 ms per frame;
  - initial load +3 s at most.
- The ODbL attribution line stays visible. The bake's licence is recorded in `data/osm/LICENSE.md`.
