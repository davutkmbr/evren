# World compiler (street layer)

Offline compiler for the street layer (`.docs/planning/16-street-layer.md`). It turns one street-profile OSM
area into ~100 m glTF 2.0 tiles plus JSON manifests that any runtime (three.js WebGPU, Godot 4.7, Blender) can load.
The default output is **format 1** (textured PBR materials with shared external textures, UV0/UV1, LOD glbs with
distance bands, prop instances, a light list, a strip at full detail; see [Format 1](#format-1)). `--format 0` still
writes the greybox **format 0**, byte-identical to the S0 compiler.

```sh
node scripts/data/fetch-osm.mjs --area kadikoy [--cache /tmp/overpass-kadikoy.json]   # input  -> data/osm/kadikoy.json
npm run compile:world -- --area kadikoy                                                 # output -> public/world/kadikoy/
npm run typecheck:world
```

The compiler works for any Istanbul district: everything district-flavoured (typology mix, paint, shop names, which
hand-authored steps run, the default strip) comes from a [district profile](#district-profiles) chosen by the area
id; areas without their own profile use the generic one.

| flag | default | effect |
|---|---|---|
| `--area <id>` | `kadikoy` | street-profile area of `src/world/osm/area.ts` |
| `--out <dir>` | `public/world/<area>` | output folder (deleted and rewritten) |
| `--format 0\|1` | `1` | output format |
| `--strip auto\|none\|minX,minZ,maxX,maxZ` | `auto` | format 1: the rect compiled at full detail ([Strip](#strip); `auto` = the district profile's) |
| `--tiles all\|strip` | `all` | `strip` writes only the strip's tiles (fast iteration; the graphs stay whole) |
| `--tex-max <px>` | none | caps every processed texture (defaults: base colour and normal 2048, ORM 1024) |
| `--all-props` | off | processes every registered prop, also those no tile places (inspection, Blender) |
| `--no-validate` | off | skips the glTF-Validator |
| `--no-compress` | off | format 1: writes plain float glbs instead of quantized, meshopt-compressed ones |
| `--landmarks block\|none` | `block` | `none`: landmark buildings (worship, tombs, fountains, hamams, the profile's list) get no geometry and keep their ground, for a runtime that draws its own models (the flight game); manifest records stay |
| `--min-walk-share <0..1>` | `0.9` | walk-graph connectivity threshold |

The compiler runs the renderer-independent code of the OSM slice in Node (via `tsx`):

- terrain: the flight world's geo build (`src/world/geo/build`);
- street raster and `StreetSurface` (`src/world/osm/shared`): carriageways, sidewalks, kerbs, paths, ground cover;
- building outline index (`FootprintIndex`);
- walk graph (`src/world/osm/details/crowd/graph.ts`) and lane graph (`src/world/osm/traffic/network.ts`);
- street lighting rules (`src/world/osm/streets/lamps.ts`).

Map data © OpenStreetMap contributors, ODbL 1.0. Every index manifest repeats the attribution.

## Input: street extension `street/1`

Areas live in `OSM_AREAS` in `src/world/osm/area.ts`. `fetch-osm.mjs` and the compiler read that list as text
(`lib/areas.mjs`), because `area.ts` reads `import.meta.env` when it loads. `galata` (profile `slice`) is the runtime
slice and does not change. Its queries and output are byte-identical to the script before the street extension.
Street areas (profile `street`) are fetched about 155 m past their bbox, instead of 75 m, because tiles reach up to
100 m beyond the area. The output file sits outside `public/` and has schema version 2 (`src/world/osm/data.ts`).
It adds `area`, `extension: "street/1"` and these optional fields (typed in `src/osm-street.ts`):

| Record | Addition |
|---|---|
| points | `entrance=<v>` kinds. An entrance wins over every other tag of its node. Entrances have `building` (the OSM way id of the outline or part the node is a vertex of), `door`, `access`, `wheelchair`, `entranceRef`, `housenumber` and `width`. |
| points | `craft=<v>` POIs; `kerb=<v>` nodes without another kind; `kerb` on any point |
| roads | `sidewalkWidth: [left, right]` (from `sidewalk:*:width`), `kerb` |
| areas | `area:highway=<v>` kinds |

## Compression

Format 1 glbs (tiles, props, prop LODs) are welded, quantized (`KHR_mesh_quantization`: 14-bit positions, 10-bit
normals, 12-bit texture coordinates in [0, 1], 8-bit colours and weather) and compressed with
`EXT_meshopt_compression` (`src/compress.ts`); the index manifest says `"compression": "meshopt"`. Runtimes need a
meshopt decoder (three.js: `GLTFLoader.setMeshoptDecoder`, as in `src/street/tile-streamer.ts`). The repeating
world-space `TEXCOORD_0` stays float. Eminönü (47 full-detail tiles): tile glbs 1,043 MB → 203 MB; with
`--tex-max 1024` the whole output is 252 MB, of which one landing streams a fraction.

## Output layout

```
public/world/<area>/            (gitignored; served by Vite at /world/<area>/)
  index.json                    index manifest
  tiles/<i>_<j>.glb             one tile's geometry (format 1: LOD0)
  tiles/<i>_<j>.lod1.glb        format 1: LOD1, when it differs from LOD0 (full-detail tiles)
  tiles/<i>_<j>.json            one tile's manifest
  textures/<set>_<role>.jpg|png format 1: processed textures, shared by every tile and prop
  props/<prop>.glb              format 1: prop models placed by the tile manifests' instances
  walk.json                     walk graph
  lanes.json                    lane graph
```

Frame: Evren local metres (`src/core/geo-coords.ts`), +X east, +Y up, +Z south (north is -Z), origin 41.045 N,
29.02 E, sea level y = 0. The glTF axes are the same, so no conversion is needed. Tile `i_j` covers
`[i·100, (i+1)·100) × [j·100, (j+1)·100)`. Tiles are made for every 100 m square that touches the area bbox. Squares
with nothing but water are skipped.

### Tile glb

- Plain glTF 2.0 binary, with no `extensionsUsed` and no `extensionsRequired`.
- One scene with one node `tile_<i>_<j>`. The node's `translation` is the tile centre `[x, 0, z]`, and the vertices
  are relative to it. The node's `extras` are `{ format, area, tile }`.
- One mesh with one primitive per material. Each primitive has POSITION, NORMAL and indices (uint16 when the vertex
  count allows it).
- Materials are unlit-looking PBR (metallic 0, roughness 1). `baseColorFactor` is linear. Colours in sRGB:

| material | colour | what |
|---|---|---|
| `wall` | `#b8ada0` | walls, door jambs, heads and thresholds, undersides of raised parts |
| `roof` | `#7a3b2e` | flat roofs |
| `road` | `#303236` | carriageways |
| `sidewalk` | `#9c9c98` | raised pavement next to kerbed streets |
| `kerb` | `#e8e6dc` | kerb faces (vertical) |
| `pedestrian` | `#c2a878` | pedestrian streets, kerbless lanes' paving, footways, squares |
| `quay` | `#6b7885` | piers and quay walls |
| `lot` | `#6f6a55` | open ground away from every street |
| `grass` | `#55743a` | mapped greens |
| `door` | `#c42020` | door leaf of an `entrance=*` node |
| `doorInferred` | `#f08a10` | door leaf inferred from a storefront POI |

Geometry rules:

- **Buildings.** There is one block per footprint. Outlines with `building:part` children are replaced by their
  parts (Simple 3D Buildings). The height is `height`, or else (`building:levels` + `roof:levels`) × 3.1 m, or else a
  default. The default is 1 level for small kinds or footprints under 25 m², 2 for houses and pier buildings, 3 for
  places of worship and the district profile's `buildings.defaultLevels` otherwise (Kadıköy 5, Eminönü and generic 4). The block starts 0.3 m below the lowest ground under the footprint, or at
  `min_height`. Roofs are flat, and `building=roof` becomes a 0.4 m canopy slab.
- **Doors.** A door is a recess 0.35 m deep. It has a door leaf at the back, jambs, a head and a threshold, and the
  wall above and below the opening stays solid. The threshold is at the ground height 0.6 m in front of the door.
- **Ground.** The ground is built on 1 m cells, each split into two triangles. Each triangle is cut along the contour
  lines of the land field (OSM coastline and pier polygons), the carriageway distance and the footway distance, so
  kerbs, quay edges and material borders are straight, not stair-stepped.
  - The carriageway sits at the terrain height. Everything else is raised by the kerb lift from `StreetSurface`: 15 cm
    next to kerbed streets, tapering where they meet kerbless lanes. A vertical kerb face closes the step.
  - The land ends in a quay wall down to y = -1.5 m. Cells that lie entirely inside one building are left out. In
    format 1 that is one block the tiles emit (`src/cover.ts`), with its courtyards open: ground under outlines whose
    parts leave gaps, under buildings outside the tile rect, in courtyards and between two blocks stays, so ground and
    blocks cover the area without holes. Format 0 keeps the S0 rule (any OSM outline, courtyards included).
  - Tram platforms are not raised in format 0.
- **Terrain and shore.** Heights come from the geo build (a 23 m grid) and are held at least at 0.95 m on OSM land.
  The shoreline is the OSM coastline, not the geo coast grid, which misses the reclaimed Kadıköy quays by up to 90 m.

### Tile manifest (`tiles/<i>_<j>.json`)

The types are in `src/format.ts` (`TileManifest`). All positions are in world metres, as `[x, y, z]`.

| field | content |
|---|---|
| `bounds`, `origin`, `content` | Nominal square, glb node translation, and the world AABB of the geometry. Buildings overhang their tile: each building belongs to the tile of its footprint centroid. |
| `buildings[]` | `id` (`w<way>` / `r<relation>`, with a `-k` suffix for further polygons of the same relation), `osmId`, `kind`, `part`, `name` (OSM, data only), `footprint` (flat `[x, z, ...]`, positive shoelace area, for colliders), `holes`, `groundY`, `bottomY`, `topY`, `height`, `heightSource` (`height` \| `levels` \| `default`), `levels`, `doors` (ids) and, format 1, `landmark` ([District profiles](#district-profiles)). |
| `doors[]` | `id` (`<building>/d<k>`), `building`, `position` (centre of the opening at threshold height, on the façade plane), `normal` (outward), `width`, `height`, `depth`, `inferred`, `entrance` (the `entrance=*` value, or `shop`) and `pois` (ids). |
| `pois[]` | `id` (`p<index of the point in the data file>`), `kind` (`shop=*`, `craft=*`, `amenity=*` places, `tourism=*`), `osmName` (data only: the businesses shown in the game are fictional), `position`, `building` and `door`. A POI belongs to its building's tile. |
| `lamps[]` | `position` (foot of the post or bracket), `kind` (`arm`, `armLow`, `double`, `lantern`, `wall`), `heading`, `light` (`sodium`, `led`, `warm`) and `inferred`. OSM maps no lamps in Kadıköy or Eminönü, so every lamp there comes from the street lighting rules. |
| `trees[]`, `benches[]` | Taken from OSM nodes (`natural=tree`, `amenity=bench`, `leisure=picnic_table`), with the tags they carry. |
| `spawns[]` | Up to 4 walk-graph vertices per tile, at least 25 m apart (`kind: "walk"`), plus the walk vertex nearest each pier or ferry terminal (`kind: "pier"`). Each has a `heading` along the walkway. |

Door placement:

- **Tagged doors.** Every `entrance=*` node inside the tile grid is snapped to the nearest façade edge within 3 m.
  The outline the node belongs to is preferred.
- **Inferred doors.** Storefront POIs are every `shop=*` and `craft=*`, plus cafés, restaurants, fast food, bars,
  pubs, ice cream, banks, bureaux de change, pharmacies and similar amenities. Each one gets an inferred door on the
  street side of the building it stands in (or of the nearest building within 8 m):
  - The street side is the edge facing a carriageway, sidewalk or pedestrian area. Open forecourts within about 8 m
    of a carriageway also count, with a 3 m penalty.
  - A POI links to an existing door instead when a tagged door on the same building is within 4 m, or an inferred
    door within 2.5 m.
- **Overlaps.** Doors keep 0.2 m from corners and 0.3 m from each other. When two doors overlap, the tagged one wins.

### Index manifest (`index.json`)

The index has `format`, `area`, `compiler`, `frame`, `osm` (source, licence, fetch date, `osmBase`, bbox),
`tileSize`, `areaBounds`, `rect`, `materials` and `tiles[]`. Each tile entry holds `id`, `i`, `j`, `bounds`, `glb`,
`manifest`, `glbHash`, `manifestHash`, `hash`, `bytes` and `triangles`. The index also points to `walkGraph` and
`laneGraph` (file, hash, size).

`hash` covers every tile and both graphs. All hashes are sha256, truncated to 16 hex digits. The output is
deterministic: the index has no timestamps, and the same input gives the same hashes.

### Walk graph (`walk.json`)

- `vertices`: flat `[x, y, z, ...]`.
- `halfWidth[i]`: the lane's half width at vertex `i`.
- `edges`: undirected pairs `[a, b, ...]`.
- `density[k]`: the desired number of walkers per metre on edge `k`.
- `tile[i]`: the tile id of vertex `i`.

The lanes follow sidewalks, the full width of kerbless lanes, pedestrian streets split into parallel lanes,
footways, steps, crossings and wander graphs across squares. Vertex heights follow the compiled ground.

The graph is **one network**. The runtime crowd graph (`src/world/osm/details/crowd/graph.ts`) is the starting point.
It stays unchanged for the flight slice, but it falls apart into hundreds of fragments. `src/walk-network.ts` joins
them in the compiler:

1. Vertices at the same position (OSM nodes that two lanes share) are merged into one.
2. Footways, mapped sidewalks, steps and crossing ways are walked again at the runtime spacing (9 m or less).
   - Samples the runtime dropped are added back. Most of them are mapped sidewalks that lie inside the carriageway
     raster, which is wider than the real road. They are moved onto the raised pavement, up to 4 m.
   - A sample that crosses a kerbed road (its way runs more than 45° off the road axis) stays where it is and
     becomes a crossing. So does a sample at a `highway=crossing` node.
   - Samples at a shared OSM node become one vertex, so crossing ways join their sidewalks.
3. Some streets get no runtime lanes: kerbless asphalt streets, that is pedestrian and living streets (for example
   Bahariye south of Nail Bey Sk) and service roads. They get full-width lanes.
4. Lane ends are linked to the nearest vertex of another lane within 8 m (5 m for crossings), off carriageways.
5. Crossings are synthesised in two places:
   - at `highway=crossing` nodes that no foot way passes through;
   - on every junction arm of a street with pavement on both sides. The crossing sits just past the kerbs of the
     other streets, and no mapped crossing may lie within 7 m.

   Each synthesised crossing runs from the pavement to the kerb, across the road to the other kerb, and onto the
   pavement again.
6. The fragments that remain are joined by the shortest clear links (Kruskal). Links within 12 m are tried first,
   then links within 25 m. In each round, links that stay off carriageways go first. No link passes through a
   building or water.

The summary reports the result: `walkGraph.components`, `largestShare`, `isolated`, the crossings by source, and
counts for each step. The run **fails** (exit code 1) when the largest component holds less than 90% of the vertices
(`--min-walk-share` changes the threshold).

### Lane graph (`lanes.json`)

`paths[]` lists directed drivable paths: `{ id, kind: "lane" | "connector", points: [x, y, z, ...], next: [path
ids], flags }`. Lanes run along a street, and connectors link lanes through a junction. `flags` are the traffic
layer's `LaneFlag` bits for lanes, and its `PathFlag` bits for connectors.

## Validation

Every glb (tiles, LOD1 tiles and props; their external images too) is checked with the Khronos glTF-Validator
(`gltf-validator`, the reference implementation compiled to JS). A run fails (exit code 1) on any validator error,
and also when the walk graph is not one network (see above). Expected non-errors in format 1: the warning
`MESH_PRIMITIVE_GENERATED_TANGENT_SPACE` (tangents are generated by runtimes) and the infos `URI_GLB` (external
images) and `UNUSED_OBJECT` (TEXCOORD_1 until bakes use it). The summary printed at the end reports tiles,
triangles, byte sizes, doors, kerb-step lengths, graph sizes and connectivity, and in format 1 the strip, LODs,
lightmap densities, materials, textures (and skipped sets), props (and skipped ones), instances, lights by source,
asset credits, per-step times, validator totals by message code and timings.

## Placement rules

Small street details are not taken from OSM as-is: OSM crossing ways stop short of the kerb, tagged road widths
differ from the carriageway raster, trees and bollard rows sit in the road. `src/street/placement.ts` holds the
predicates every street emitter asks before it emits a detail. A detail that breaks its rule is moved to the nearest
valid spot, shortened or dropped. Every district gets the same rules.

Surfaces (`PlacementRules.surface`) follow what `street/ground.ts` draws:

| surface | where |
|---|---|
| `carriageway` | carriageway distance D < 0, no pedestrian street wins the texel |
| `gutter` | the 0.3 m band in front of a raised kerb |
| `pedestrianLane` | carriageway raster of a pedestrian street (paving, no traffic) |
| `kerb` | the 0.15 m kerb stone behind a raised kerb line |
| `pavement` | everything else that is walkable: raised sidewalks, kerbless paving, squares, paths, lots |
| `building`, `water` | building outlines, water |

| rule | emitter | predicate | on failure |
|---|---|---|---|
| `crossing.span` | `street/common.ts` | a marked crossing runs from kerb to kerb, has no building or water 0.8 m past either end and is no more than 30 m long | an end inside the carriageway is extended to the kerb line, up to 6 m (`moved`). An end with no edge within 6 m (a traffic island, a junction) stays open (`flagged`). A crossing that fails the checks is `dropped`. Dropped kerbs go only where an end lies within 0.3 m of the kerb line |
| `paint.zebraBar` | `street/markings.ts` | both long edges of the bar are paintable: carriageway 0.05 m inside the edge, 0.3 m clear of pedestrian paving | clipped outwards from the bar's middle (`shortened`); `dropped` when less than 1 m is left |
| `paint.laneLine` | markings | every corner of the 0.3 m stripe is paintable, out of the gutter band, off parking ground, 1.25 m from tram tracks, and the carriageway that wins the texel runs the stripe's way (within 25°) | the 1.5 m segment is `dropped` |
| `paint.edgeLine` | markings | as `paint.laneLine`. The offset comes from the kerb line found along the normal (gutter plus 0.3 m inside a kerb, 0.35 m inside a kerbless edge), not from the tagged width. Where no edge lies within the half width plus 4 m (a divided road's other half, a merge), the tagged offset stays | `moved` when the offset differs from the tagged one by more than 0.1 m; `dropped` when the stripe fails the checks or its offset jumps by more than 0.6 m within a segment |
| `tactile.pad` | markings | blister pads 0.6 m deep follow the kerb line, found from each 0.25 m station along the dropped kerb. The whole depth of a station is `pavement`, behind the kerb stone, 0.2 m off façades and out of door approaches | stations that fail are left out (`shortened`); a pad with fewer than 3 stations is `dropped` |
| `tactile.guide` | markings (arrival square) | guide pavers on `pavement` or `pedestrianLane` only | 0.6 m quads `dropped` |
| `manhole` | markings | at least 1.45 m from a tram track centre line (and, as before, 0.6 m inside the carriageway, off junctions and zebras) | `dropped` |
| `rail.corrected` | common.ts | tram track samples OSM draws on the pavement or too close to the kerb (within 5 m of the carriageway) | `moved` onto the carriageway (1 m samples) |
| `rail.track` | markings | rails lie on the carriageway | a stretch on raised pavement (a separate right-of-way) is kept for the track's continuity and `flagged` (1 m segments) |
| `prop.tree` | `street/furniture.ts` | off the carriageway, 0.6 m behind the kerb line, 0.8 m off façades, out of door approaches (pedestrian paving allowed) | moved up to 2.5 m, else `dropped` |
| `prop.bollard` | furniture | 0.2 m behind the kerb line, 0.3 m off façades, out of door approaches; on pedestrian paving only, never on a vehicular carriageway | moved up to 1.2 m, else `dropped` |
| `prop.bollardMouth` | furniture | the bollard row across a pedestrian lane's mouth stands 0.8 m inside the lane's own paving, not where the OSM end node lies in the crossing road | `moved` inwards (up to 12 m along the lane); `dropped` when the lane never leaves the carriageway |
| `prop.pole` | furniture, `street/lights.ts` | signals, stop poles, lamp masts and post lanterns: off every carriageway, 0.3 m behind the kerb line, 0.3 m off façades, out of door approaches | moved up to 1.5 m, else `dropped` (wall brackets are exempt) |
| `prop.furniture` | furniture | benches, bins, cabinets, planters, lantern columns, parasols, café sets, chairs and A-frames: 0.45 m behind the kerb line, 0.2 m off façades, out of door approaches (pedestrian paving allowed) | moved up to 1.5 m, else `dropped` |
| `railing` | `street/barriers.ts` | the ends and middle of each 2.4 m railing piece stand off the carriageway and gutter, out of buildings and door approaches | `dropped` |

- A door approach is the area in front of a door, up to 1.3 m out and 0.2 m past each jamb.
- Props placed from reference photos (the Kadıköy S1 fits, e.g. the c05 stop and the gate A plaza) are never moved.
  A violation is counted as `flagged`.
- Hanging pendants, vehicles, chalk menus (they stand on their A-frame) and wall lamps are exempt.

The compile summary lists the counts per rule and outcome under `placement` (`kept`, `moved`, `shortened`,
`dropped`, `flagged`). Zebra bars, pads and stripes are counted in the tile that owns them. A change in these counts
shows a regression. `src/street/tools/placement-scan.ts <area>` checks compiled tiles independently: it decodes the
full-detail glbs and instances and counts, against the surface raster, paint triangles off the carriageway, on
pedestrian paving, parking or tram beds; tactile triangles on the road, on kerbs or in buildings; rails off the
carriageway; and props on the carriageway or kerb. It also lists the worst 4 m cells, as places to take shots.

## Not in format 0

- Façade depth, windows, roof shapes, textures, UVs, LODs, baked AO and colliders beyond footprints.
- Tram platforms, steps as steps (they are slopes), and interiors.

Bump `FORMAT` in `src/format.ts` and this document on any breaking change to the files above.

## Format 1

Format 1 keeps every format 0 record and file (same frame, tile grid, doors, POIs, lamps, spawns, graphs) and adds:
textured materials, UV sets, LOD glbs, prop instances, lights and a full-detail strip. `index.format` and every tile
manifest's `format` are `1`. Types: `src/format.ts` (compiler) and `src/street/format.ts` (the sandbox's subset).

### Tile glbs

- Plain glTF 2.0, no `extensionsUsed` / `extensionsRequired` (Godot 4.7, three.js and Blender load them as they are).
- One node `tile_<i>_<j>` (LOD1: `tile_<i>_<j>_lod1`) translated to the tile centre; node `extras` are
  `{ format, area, tile, lod, detail, lightmap }`.
- One primitive per material with POSITION, NORMAL, **TEXCOORD_0**, **TEXCOORD_1**, indices and, where a step set one,
  **COLOR_0**. No TANGENT: runtimes generate MikkTSpace tangents (the validator's
  `MESH_PRIMITIVE_GENERATED_TANGENT_SPACE` warning says exactly this).
  - **TEXCOORD_0** is world-scale: metres divided by the material's `tiling` (texture repeats). Floors (|n.y| > 0.7)
    project on world X/Z (u east, v south); walls and other faces use the face's horizontal tangent (u runs right
    when facing the face) and world up (v runs down the image, so the image stands upright). Each tile shifts the
    coordinates by whole repeats, so textures run on across tile borders. Steps may pass their own UVs.
  - **TEXCOORD_1** is a non-overlapping lightmap / AO atlas per tile and LOD, in [0, 1]. Every emitted planar face
    is one chart (the whole ground of a tile is one X/Z chart; generic meshes get box-projected charts); charts are
    shelf-packed into a square atlas (`lightmap.size`, 2048 for full-detail LOD0, 1024 otherwise, grown when needed)
    with `lightmap.padding` = 2 empty texels around each chart, at the largest uniform `lightmap.texelsPerM` that
    fits (about 7–20 texels/m on the strip). No material uses UV1 yet (validator info `UNUSED_OBJECT`): bakes
    (AO, lightmaps) write per-tile images for it later.
  - **COLOR_0** (linear RGBA float) multiplies the base colour, as glTF defines: use it for grime and wear darkening.
- Materials are the registry's (`src/materials.ts`), named by id and identical in every tile: `baseColorFactor` is
  the linear tint; `baseColorTexture` (sRGB), `normalTexture` (OpenGL convention, +Y up) and one **ORM** image used
  as both `occlusionTexture` (R = the texture's AO) and `metallicRoughnessTexture` (G = roughness, B = metalness).
  All use texCoord 0, REPEAT wrapping and trilinear filtering. Images are **external**:
  `"uri": "../textures/<file>"`, relative to the glb (validator info `URI_GLB`), one file per texture for the whole
  area. Material `extras`: `tiling` [u, v] m, `surface` (`ground` = walkable, `wall`, `roof`, `metal`, ...),
  `castShadow`, `set` (source texture set), and `emissive: { nits, night, source }` for glowing materials (glTF
  core caps `emissiveFactor` at 1, so the luminance in nits lives here; `night: true` = off by day).

### LOD

| level | glb | contents | shown while (distance to the tile square) |
|---|---|---|---|
| 0 | `<i>_<j>.glb` | full street detail | 0 – 120 m |
| 1 | `<i>_<j>.lod1.glb` | façade detail collapsed to the block (door recesses, reveals, balconies gone) | 120 – 600 m |

- `index.lod` = `{ bands: [{ level, min, max }], hysteresis: 10 }`. A runtime measures the horizontal distance `d`
  from the camera to the tile's `bounds` square and shows the level whose band holds `d`; it keeps the current level
  until `d` leaves its band by more than `hysteresis` metres. Beyond the last band the tile is not drawn.
- Greybox tiles have one mesh for every LOD: both `lods` entries name the same glb, so a runtime switches nothing.
- Full-detail tiles write LOD1 separately. Steps choose the LODs of what they emit (`mesh.withLod(LOD0, ...)`);
  everything else reaches every LOD. The core buildings step already emits recessed doors to LOD0 and plain blocks
  to LOD1.
- Prop instances are drawn while `d` < their prop's `drawDistance`, never beyond the last band.
- A LOD2 (coarser, merged blocks) is not written yet; `index.lod.bands` will list it when it is.

### Tile manifest additions

| field | content |
|---|---|
| `detail` | `full` (inside the strip) or `greybox` |
| `lods[]` | `{ level, glb, hash, bytes, triangles, lightmap: { size, texelsPerM, padding, charts } }` (glb relative to `tiles/`) |
| `instances[]` | prop instances: `asset` (prop id in `index.props`), `variant` (a root node name of the prop glb; absent = the whole prop), `position` (world metres, the prop's foot), `rotation` (unit quaternion `[x, y, z, w]`), `scale` (number or `[x, y, z]`, default 1), `ref` (the record it stands for, e.g. `3_59/lamp0`), `seed` (runtime variation) |
| `lights[]` | the tile's lights ([Lights](#lights)) |
| `extra` | records of compile steps, keyed by step id (`TileContext.record`) |
| `triangles` | LOD0 triangles |

A prop instance's world matrix is `T(position) · R(rotation) · S(scale)` applied to the prop glb's scene (or to the
chosen variant node with its own transform inside the prop). No glTF instancing extension is used.

### Index additions

| field | content |
|---|---|
| `lod` | LOD policy (above) |
| `strip` | `{ source, rect, tiles }`: where the full-detail rect came from and which tiles are `full` |
| `materialDefs[]` | every material the tiles use: `id`, `baseColorFactor`, `baseColor` / `normal` / `orm` (paths under `textures/`, or null), `tiling`, `roughness`, `metallic`, `alphaMode`, `alphaCutoff`, `doubleSided`, `emissive`, `surface`, `castShadow`, `set`; format 1.1: `variantOf`, `variant`, `weather` |
| `textures[]` | `{ file, mimeType, width, height, bytes }` of every processed texture |
| `props` | prop id → `{ glb, hash, bytes, triangles, variants, bounds, drawDistance, castShadow, source, lights }` |
| `assets[]` | credits of every external asset in the output: `id`, `name`, `kind`, `source`, `url`, `licence`, `author`, `attribution`, `conditions` (each with how it was met) and `usedBy` (material and prop ids) |
| `totals` | tiles, LOD0 / LOD1 triangles, instances, lights, texture / prop / glb bytes |
| `tiles[]` | adds `detail`, `lods[]` (paths relative to the index), `instances` and `lights` counts; `glb`, `bytes`, `triangles` describe LOD0 |

`index.materials` (`{ name, color }`) lists the used materials for format 0 readers. `hash` also covers the
material definitions, textures and props.

### Props

`props/<id>.glb`: plain glTF 2.0 with external textures (`../textures/prop_<id>_<name>.jpg|png`), metres, +Y up, the
prop's foot at the origin and its front / reach along **+Z**. The root nodes are the variants. Sources:

- approved models of `tools/assets/approved.json` (cached in `assets-src/model/<id>/`), textures re-encoded once;
  Poly Haven's opacity-as-colour JPEGs become RGBA cut-outs (MASK) and opaque "glass" JPEGs with BLEND get alpha 0.35;
- procedural stand-ins built by the compiler: `mannequin` (neutral 1.75 m figure, variants `standing`, `walking`,
  `sitting`, facing +Z; placeholder for the MetaHuman crowd), `lamp_mast` / `lamp_mast_low` / `lamp_mast_double`
  (8.3 / 6.2 / 9.3 m kerb masts with the arm along +Z, variants `sodium`, `led`, `warm`).

Props of 1500+ triangles also get decimated LODs (`props/<id>.lod1.glb`, `.lod2.glb`: same nodes and materials,
meshoptimizer, seams kept), listed in `props[id].lods` as `{ level, glb, hash, bytes, triangles, error, distance }`: draw
level k from `distance` metres on (where its geometric `error` is under a pixel at 1600×900, 60° FOV), LOD0 before.

A model that is not downloaded yet, or whose approval conditions are not met, is skipped: its instances are dropped
and the summary lists it under `props.skipped`. `props[id].lights` is the light template every instance gets
(prop-local positions; `TileContext.place` adds them to the tile's lights).

### Lights

`lights[]` entries: `id` (`<tile>/l<k>`), `type` (`point`, `spot`, `area`), `position` (world m), `direction` (unit,
spot and area), `kelvin` and `color` (linear RGB of that colour temperature, max channel 1), **`intensity` in candela**
for point and spot lights (nits for area lights), `lumens`, `range` (m; where the light falls below ~0.3 lx, capped at
45 m), `cone` (`inner` / `outer` half-angles in degrees), `size` (area, m), `night` (on at night only), `source`
(`lamp`, `sign`, `window`, `interior`, `other`), `ref` (instance or record) and `castShadow`.

- three.js (physically correct lights): `PointLight` / `SpotLight` `intensity` = candela, `distance` = `range`,
  `decay` = 2, spot `angle` = outer, `penumbra` = 1 − inner / outer.
- Godot 4.7 with physical light units: `OmniLight3D` / `SpotLight3D` `light_intensity_lumens` = `lumens`,
  `light_temperature` = `kelvin`, `omni_range` / `spot_range` = `range`, `spot_angle` = outer.
- Blender: point `energy` (W) = `lumens / 683`; spot `energy` = `intensity × 4π / 683` (a Blender spot is a masked
  point light), `spot_size` = 2 × outer, `spot_blend` ≈ 1 − inner / outer.
- Emissive materials follow the same switch: `extras.emissive.night` materials are dark by day.

The default `lampFixtures` step turns every lamp record into an instance (kerb masts, Poly Haven post lanterns,
Poly Haven wall brackets 3.9 m up) plus the lights of its template, coloured by the lamp's class (sodium 2000 K,
LED 4000 K, warm 3000 K): 8000 lm spots for masts, 2500 lm points for lanterns, 1800 lm for wall brackets.

### Textures

`src/textures.ts` reads only approved sources: assets of `tools/assets/approved.json` (cached raw files in
`assets-src/<kind>/<id>/`) and the Poly Haven sets listed in `public/textures/LICENSES.md`. A texture set is
processed once per compile (macOS `sips` decodes, resizes and encodes; channel work runs in Node; PNGs are written
with `node:zlib`) and cached in `node_modules/.cache/evren-world/textures/`:

| file | content |
|---|---|
| `<set>_color.jpg` | base colour, sRGB, ≤ 2048 px |
| `<set>_color.png` | base colour with alpha from the set's opacity map (materials with a MASK / BLEND alpha mode) |
| `<set>_normal.jpg` | OpenGL normal map, ≤ 2048 px; a DirectX map has its green channel flipped |
| `<set>_orm.jpg` | R = ambient occlusion (255 without), G = roughness, B = metalness (0 without), ≤ 1024 px |

Approval conditions are honoured: an asset with conditions is used only when every one is met, either by the
compiler (a "Normal map is DirectX" condition flips the green channel) or by a `conditions.json` next to the raw
files (`{ "met": ["<condition text>", ...] }`) written by whoever did the manual work (e.g. removing a trademark).
Otherwise the material falls back to its flat colour and the summary lists the set under `textures.skippedSets`.
Sets that are not downloaded yet are skipped the same way.

### Strip

The strip is the rect compiled at full detail (`detail: "full"`); every other tile is greybox (format 0 geometry,
textured materials, LOD0 = LOD1). The rect comes from `--strip minX,minZ,maxX,maxZ`, else from the district profile's
`strip`: its `rect` (Eminönü), else a camera file (`strip.rect` / `bounds` / `bbox` as `{minX, minZ, maxX, maxZ}` or
`[minX, minZ, maxX, maxZ]`, or `strip.polygon` / `corners` as `[[x, z], ...]`, local metres; Kadıköy:
`tools/world-compiler/s1/cameras.json`), else a spec file (the first line naming a `rect` followed by four numbers;
Kadıköy: `.docs/street/s1-strip.md`), else the bbox of a walk route of `src/street/routes.ts` grown by 30 m (Kadıköy:
`rihtim-carsi`). A profile without a strip (the generic one) and `--strip none` make every tile greybox. Tiles whose
square intersects the rect are full-detail. `index.strip.source` says which source won (`cli`, `district:<id>`, a
file or `route:<id>`).

## District profiles

`src/district.ts` defines `DistrictProfile`; the profiles live in `tools/world-compiler/districts/<area>.ts` and are
listed by area id in `districts/index.ts`. `cli.ts` selects the profile of `--area` before anything else
(`useDistrict`); an area without an entry gets `districts/generic.ts`. Every module reads the active profile with
`district()` (one compile run compiles one area). The data-driven core runs for every area: OSM geometry, the façade
kit, shopfronts from POIs, kerbs and sidewalks, paving, weathering, props, lamps from the lighting rules, the walk
and lane graphs. A profile holds only what is district-flavoured:

| field | what | Kadıköy | Eminönü | generic |
|---|---|---|---|---|
| `strip` | default full-detail rect ([Strip](#strip)) | S1 cameras / spec / `rihtim-carsi` | the rect of the dragon's landing area | none |
| `cameras` | hand-fitted reference cameras: S1 spine, arrival square, off-spine kit tiles, clear foregrounds, the c05 stop | `s1/cameras.json` | none | none |
| `handAuthored` | hand-authored steps that run: `heroes` (piers, Haldun Taner, İskele Camii, Aya Efimia, ferry, skyline), `soul`, `precinct` (Aya Efimia wall), `interiors` (the café) | all | none | none |
| `buildings` | default levels, typology weights by footprint area and kind, storey ranges, per-building spec rows, hero ids and heights, landmark ids, shuttered shops, wear bias | S1 spec table | hans and masonry (T2) with commercial infill (T3), few apartments; Mısır Çarşısı a landmark | mixed |
| `facade` | paint per typology and trims, T1 balcony layout weights, T2 balcony share, AC unit share, flag colours, the market end | photo-sampled paint, yellow-navy flags, fish end | older, muted stone and ochre, few balconies, fewer AC units | neutral |
| `shops` | first words of the fictional names (place words of the district), filler trades, market filler, fallback trades, POI kind → trade overrides | Rıhtım, İskele, Vapur... | Eminönü, Tahtakale, Haliç, Mahmutpaşa...; spice, nuts, coffee, textiles, housewares, hardware, jewellery | no place words |
| `street.crowd` | placeholder crowd density (people / m²) on pedestrian streets, pavements and squares where no reference spine drives it | (spine-driven) | 0.08 / 0.04 / 0.03 | 0.07 / 0.03 / 0.03 |
| `street.barriers` | iron railings (1.05 m, posts, three rails, balusters; `st_iron`) along OSM `barrier=fence` lines, step `streetBarriers` | off | on | off |
| `materials` | district versions of registered materials (same id, registered over the lanes' definitions) | none | `st_pavers`: light granite slabs (granite_tile_04 colour, 0.8 m); `lot`: concrete; `fac_shutter_wood`: faded brown paint over the wood relief | none |

- Without reference cameras the whole street-kit area counts as the spine: the spine-gated rules (quay benches,
  junction planters, café seat use, browsers at shop doors, traffic before signalised crossings) run everywhere, and
  the crowd follows `street.crowd` along the walk graph.
- **Landmarks** (`landmarkOf`): places of worship (`building=mosque|church|...` or `amenity=place_of_worship`),
  `historic=tomb|monument|memorial|fountain|...`, hamams and the profile's `landmarkIds` get no façade plan and no
  shopfronts: they are simple stone massing (`fac_stone` walls, flat roof, every LOD) and their manifest record has
  `landmark` (`worship`, `market`, `landmark` or the OSM `historic` / `amenity` value), so a runtime that draws its own
  landmark model can hide them. Their footprint and height stay valid for colliders.
- A footprint lying 70 %+ inside another emitted block (outside its courtyards) is a duplicate outline or an unmarked
  part: it stays a plain block (`extra.facade.contained`).

### Façade edges and projections

`facade/build.ts classifyEdges` classifies each footprint edge by what it faces, probing the free space along its
outward normal against the building outlines (`src/cover.ts`, courtyards open):

- **party**: another building 1 m behind the wall (two of three samples), or a neighbour across a sliver narrower
  than 1.2 m (median free depth): a blank wall;
- **street**: a street surface (carriageway, pavement, pedestrian area, footway) lies in the free space in front of
  the wall, before the next building (up to 7.5 m), however narrow the lane; or, with at least 2 m of free space, a
  street is near (forecourts, set-backs). A street behind a neighbour or across a courtyard does not count;
- **open**: courtyards and back lots; **short**: under 1.2 m.

Everything that projects from a wall fits the room in front of it (`roomAt`): half the free depth to the building
across (whose wall may project as much) minus 0.15 m, unlimited past 9 m. Balconies and their laundry, the çıkma, AC
units, dishes, awnings, projecting signs and stall displays are dropped or shortened where the lane is too narrow, and
shop units leave out stretches of wall with a neighbour less than 1 m in front.

### Adding a district

1. **Area.** Add a bbox constant and an `OSM_AREAS` entry with `profile: 'street'` to `src/world/osm/area.ts`, e.g.
   `{ id: 'eminonu', bbox: EMINONU_AREA, dataFile: 'data/osm/eminonu.json', profile: 'street' }` (one line, parsed as
   text by `lib/areas.mjs`).
2. **Fetch.** `node scripts/data/fetch-osm.mjs --area <id>` writes `data/osm/<id>.json` (street extension).
3. **Profile.** Copy `districts/generic.ts` to `districts/<id>.ts`, set `id`, `label` and the default `strip` rect
   (local metres, `minX, minZ, maxX, maxZ`), tune typology weights, storeys, paint, balconies, shop words and trades,
   landmark ids; keep `handAuthored` off and `cameras: null` unless the district has hand-fitted steps. List it in
   `districts/index.ts`. Every business name stays fictional: place words are neighbourhood names, never real shops.
4. **Compile.** `npm run compile:world -- --area <id>` (or `--strip x0,z0,x1,z1` to try another rect), then look at
   it at eye level: `/sandbox/street.html?area=<id>&at=<x>,<z>,<headingDeg>,<pitchDeg>&hud=0&t=day` on the shared dev
   server (`&eye=<m>` raises the camera for an oblique overview). Take screenshots with `node scripts/snap.mjs`.
5. `npm run typecheck:world` and `npm run typecheck`; the glTF validator runs with every compile.

### Adding to the compiler (lanes)

Everything the compiler runs is listed in `src/registry.ts`; a lane adds **one line** to a list there and keeps the
rest in its own files.

- `COMPILE_STEPS`: `{ id, formats?, tiles?, handAuthored?, prepare?(area), tile?(tile), finish?(area) }`, run in list
  order. `formats` defaults to `[1]`; `tiles` is `all` (default), `full` or `greybox`; a step fitted to one district's
  places or cameras sets `handAuthored` (`heroes`, `soul`, `precinct`, `interiors`) and runs only where the district
  profile enables it. The core list is `ground`,
  `buildings`, `lampFixtures`; a lane may put its step before, after or instead of one of them.
- `MATERIAL_SETS`: arrays of `MaterialDef` (`src/materials.ts`): `id`, `color` (sRGB tint), `textures`
  (`{ asset }` or `{ public }`), `tiling` (m), `maps`, `roughness`, `metallic`, `normalScale`, `occlusion`,
  `alphaMode`, `alphaCutoff`, `doubleSided`, `emissive` (`{ color, nits, night, source }`), `surface`,
  `castShadow`, `flat` (format 0 colour), `weather` (format 1.1). Registration order is primitive order. A library of
  neutral materials exists for every approved set (ids = asset ids, `ph_<folder>` for public sets). Using an
  unregistered id throws. Variants `<base>@<variant>` come from `withVariants` / `materialVariant`.
- `PROP_SETS`: arrays of `PropDef` (`src/props.ts`): `id`, `asset` (approved model) or `build` (procedural, emitted
  through a `TileMesh` per variant), `unitScale`, `variantsAtOrigin`, `drawDistance`, `castShadow`, `emissive`
  overrides by material name, `lights` template (`position: 'emissive'` = centre of the emissive parts).

`AreaContext` (every step): `format`, `area`, `data` (OSM street data), `foundation` (terrain, `StreetSurface`,
footprints), `heights` (`carriage`, `off`, `at`), `land`, `piers`, `solids` (with doors), `tileOfSolid`, `outlines`
and `cover` (hole-aware outline / emitted-block indices, `src/cover.ts`), `district` (the profile),
`manifests`, `walk`, `lanes`, `strip`, `detailOf(tileId)`, `outDir`, `shared` (scratch map keyed by step id).

`TileContext` (tile steps): `id`, `manifest` (the format 0 records: buildings, doors, POIs, lamps, trees, benches,
spawns), `bounds`, `origin`, `detail`, `solids` (the solids whose centroid lies in the tile), `mesh`, `instances`,
`lights`, `place(asset, position, yaw, { variant, scale, ref, seed, lights })` and `record(stepId, data)`.

`TileMesh` (positions in world metres):

| method | use |
|---|---|
| `groundPolygon(m, pts, opts?)` | convex ground polygon, welded and smooth (the tile's ground chart) |
| `flatPolygon(m, pts, n, opts?)` | planar convex polygon with normal `n` (one chart) |
| `flatTriangles(m, pts, tris, n, opts?)` | triangulated planar shape (one chart) |
| `wall(m, ax, az, bx, bz, ya0, ya1, yb0, yb1, n, opts?)` | vertical quad |
| `addMesh(m, { positions, indices, normals?, uv?, uvm?, color?, lod? })` | any mesh (railings, profiles); box-projected charts and UV0 |
| `decal(m, centre, n, { size, offset?, rotation?, rect?, color?, weather?, lod? })` | decal quad in front of a surface ([Format 1.1](#format-11--weathering)) |
| `decalOnWall(m, ax, az, bx, bz, n, along, y, decalOpts)` | decal on a wall, `along` metres from a, centre at height `y` |
| `withLod(mask, fn)` / `lodMask` | LOD mask of what `fn` emits (`LOD0`, `LOD1`, `LOD2`, `ALL_LODS`) |

`opts`: `uv` (UV0 in repeats per vertex), `uvm` (UV0 in metres), `color` (linear RGBA, one or per vertex), `weather`
(`_WEATHER` `[dirt, streak, edge, damp]`, one or per vertex), `lod`.
`yaw` for `place` is radians about +Y; `headingYaw(compassDeg, '+Z')` (`src/instances.ts`) turns a compass heading
into it. Light helpers: `kelvinToRgb`, `spotCandela`, `pointCandela`, `lightRange` (`src/lights.ts`).

The compile must keep working after every change: `npm run compile:world -- --area kadikoy`,
`npm run typecheck:world`, `npx tsc --noEmit`.

### Blender and other runtimes

- glTF importers convert Y-up to their own axes. Blender: Evren `(x, y, z)` → Blender `(x, -z, y)`; a rotation about
  Evren +Y is the same angle about Blender +Z. Manifest positions (instances, lights) need that conversion; the tile
  glbs are converted by the importer.
- Blender's importer keeps UV0 and UV1 as two UV maps, imports every shared image once and puts glTF `extras` into
  custom properties (material `emissive`, `tiling`; node `lightmap`).
- Every Blender job runs through `node scripts/blender-run.mjs` (machine-wide GPU slot, `nice`, thread cap,
  timeout; `npm run blender -- <script.py> -- <args>`).
- `sandbox/street.html` previews format 0 and 1 in the WebGL2 renderer: LOD bands, shared textures, instanced props,
  `?t=day|dusk|night` with the nearest lit manifest lights in a fixed pool of 24 point and 24 spot lights.

## Format 1.1 — weathering

Additive to format 1 (`format` stays `1`; readers that ignore the additions render the clean materials). Nothing
changes for a step that does not use it: format 0 and format 1 output stay byte-identical.

### `_WEATHER` vertex attribute

| | |
|---|---|
| name | `_WEATHER` (glTF custom attribute: the leading `_` makes the Khronos validator and default loaders accept and ignore it) |
| type | `VEC4`, `FLOAT` (5126), not normalized, values in [0, 1]. Float keeps the values exact in every runtime; Blender's importer turns a normalized ubyte VEC4 into an sRGB byte colour, which would distort them. |
| x | dirt / AO grime: concave corners, reveals, soffits, soot |
| y | rain streak: under sills, cornices, balconies, AC units |
| z | edge wear: convex edges, corners, sill and cornice noses (runtimes may gate it further by curvature) |
| w | damp / splash: wall bases, below leaking gutters |
| where | tile glbs, on the primitives of materials where a step set it (`opts.weather` / `MeshInput.weather`); the other vertices of such a primitive get 0. Primitives without it: 0 everywhere. Procedural props do not carry it yet. |

Weathering needs vertices where the gradient changes: emit denser rows where it matters (0.5 m rows near the ground,
under sills), within the +30 % LOD0 triangle budget.

### Material variants

- Id: `<base>@<variant>`, e.g. `fac_plaster@weathered`, `fac_plaster@damaged`. Base ids contain no `@`; variant names
  match `^[a-z][a-z0-9_]*$`; `weathered` and `damaged` are the canonical ones (the base is the clean one).
- A variant is a full material: the base definition plus overrides (`materialVariant(base, name, overrides)`, or
  `...withVariants(base, { weathered: {...}, damaged: {...} })` in a MATERIAL_SETS list). The base is registered first.
- Steps pick a variant per wall segment by id (`mesh.wall('fac_plaster@weathered', ...)`). Variants with the same
  textures and tiling share texture files and keep UV0 continuous.
- `materialDefs[]` and glTF material `extras` carry `variantOf` (base id) and `variant`.

### Weather layers

A material's `weather` (`MaterialDef.weather`, `WeatherDef` in `src/materials.ts`) lists up to four layers, each
driven by one `_WEATHER` channel: `dirt` (x), `streak` (y), `edge` (z), `damp` (w). A layer takes its maps from a
registry material (`material`; approved sets only: `WEATHER_LAYER_MATERIALS` has `wx_grime` (concrete),
`wx_streak` (Leaking003, alpha), `wx_band` (Leaking008, alpha), `wx_substrate` (damaged_plaster)), or none (a flat
layer: tint, darken, roughness). `WALL_WEATHER` is a starting preset for rendered walls. The compiler bakes the layer
materials with the tile's materials and lists them in `materialDefs` and `assets` (credits).

`materialDefs[].weather` (paths relative to the index) and glTF material `extras.weather` (paths relative to the glb,
`../textures/...`) are the same record (`WeatherRec` in `src/format.ts`):

```json
{ "attribute": "_WEATHER",
  "layers": {
    "dirt":   { "channel": 0, "material": "wx_grime", "baseColor": "textures/ph_concrete_color.jpg", "normal": "textures/ph_concrete_normal.jpg",
                "orm": null, "alpha": false, "tiling": [2.7, 2.7], "wrap": "repeat", "tint": [0.25, 0.22, 0.19], "strength": 0.9,
                "blend": "multiply", "darken": 1, "roughness": 0.95, "normalScale": 1, "curvature": 0 },
    "streak": { "channel": 1, "material": "wx_streak", "baseColor": "textures/Leaking003_color.png", "alpha": true, "wrap": "mirror", ... },
    "edge":   { "channel": 2, "material": "wx_substrate", ..., "curvature": 0.75 },
    "damp":   { "channel": 3, "material": null, "baseColor": null, "blend": "multiply", "darken": 0.6, "roughness": 0.45, ... } } }
```

### What each runtime implements (S2)

Per material with `weather`, in the fragment shader, starting from the material's own base colour (texture × factor
× COLOR_0), roughness and normal, apply the layers in the order dirt, streak, edge, damp:

1. Layer UV = UV0 × (material `tiling` / layer `tiling`), per axis; sample with `wrap` (`mirror` = mirrored repeat).
2. Coverage `m = clamp(_WEATHER[channel] × strength, 0, 1) × (alpha ? layer baseColor.a : 1) × mix(1, convex, curvature)`.
   `convex` in [0, 1] is the runtime's convex-edge estimate; a runtime without one uses 1.
3. Layer colour `c = (baseColor ? layer baseColor.rgb (sRGB decoded) : 1) × tint`.
   Colour: `mix(col, c, m)` for `blend: "mix"`, `col × mix(1, c, m)` for `"multiply"`; then `col × mix(1, darken, m)`.
4. Roughness: `roughness` null keeps it; with `orm`: `mix(r, orm.g × roughness, m)`; else `mix(r, roughness, m)`.
5. Normal: with `normal` (tangent space, OpenGL, UV0 tangents): `normalize(mix(n, n_layer(normalScale), m))`.

- **three.js** (WebGPU, TSL): `GLTFLoader` (r186) lower-cases unknown attribute names, so the data arrives as
  `geometry.attributes._weather` (`attribute('_weather', 'vec4')` in TSL). Extend `MeshStandardNodeMaterial`
  `colorNode` / `roughnessNode` / `normalNode` per weathered material; `convex` = 1.
- **Godot 4.7**: the importer maps only `_CUSTOM0`..`_CUSTOM3` (VEC4) to `CUSTOM0`..`CUSTOM3`
  (`GLTFDocument::_parse_meshes`) and ignores `_WEATHER`. Either a `GLTFDocumentExtension._import_preflight` renames
  `_WEATHER` to `_CUSTOM0` in `state.json`, or the compiler adds a `_CUSTOM0` semantic pointing at the same accessor
  (zero bytes; not done yet, decide in S2). A `ShaderMaterial` per weathered material reads `CUSTOM0`; `convex` = 1.
- **Unreal 5.8**: not verified yet whether Interchange keeps `_` attributes; plan for a post-import step that moves
  `_WEATHER` into a second vertex colour or UV2/UV3, and one master material with the four layers as instance
  parameters (textures, tiling, tint, strength, blend, darken, roughness, curvature); `convex` from a curvature map
  or 1.
- **Blender** (reference renders): `scripts/blender/weather.py`, called by `import_area.build()`: one node group
  `evren_weather` per file, inserted between each weathered material's maps and its Principled BSDF; `convex` =
  bevel-normal turn (radius `Edge Radius` 3 cm × `Curvature Gain` 4) × smoothstep(`Cavity AO` 0.85, 0.98, local AO
  within 25 cm), so concave corners get no edge wear.

### Decals

`TileMesh.decal(m, centre, n, opts)` / `decalOnWall(m, ax, az, bx, bz, n, along, y, opts)` emit one quad `offset`
(default 1 cm, keep 0.5–2 cm) in front of the surface: `size` [w, h] m, `rotation` (radians, counter-clockwise seen
from the front), `rect` [u0, v0, u1, v1] image rectangle as UV0 (tiling does not apply), `color` (COLOR_0 tint /
alpha), `weather`, `lod`. The image stands upright on walls and runs east / south on floors. Use a `BLEND` (soft
stains) or `MASK` (paint, cracks) material with `castShadow: false` and an approved decal set (`opacity` baked into
the PNG's alpha). Every decal of one material in a tile lands in that material's single primitive (merged per
material per tile), so decals cost one draw call per decal material and tile. Leaking003 / Leaking008 are
top- / bottom-anchored stains: as tiled `weather` layers their phase is fixed in world height (`mirror` hides the
seam), so sill-anchored streaks read best as decals or with a vertically tileable streak texture.

## Dev dependencies

| package | licence | why |
|---|---|---|
| `tsx` | MIT | Runs the TypeScript sources in Node. Node's own type stripping cannot resolve the extensionless imports in `src/`. |
| `@gltf-transform/core` | MIT | Standard glTF 2.0 document model and GLB writer. |
| `gltf-validator` | Apache-2.0 | Khronos reference validator. |
| `@types/node` | MIT | Node typings for `npm run typecheck:world` only. The root tsconfig restricts `types`, so they do not leak into the game. |
| `meshoptimizer` | MIT | Decimated prop LODs (`src/street/prop-lod.ts`): the approved post lantern alone has 30.6k triangles on 900+ lamps. |
