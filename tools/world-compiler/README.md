# World compiler (street layer)

Offline compiler for the street layer (`.docs/planning/16-street-layer.md`). It turns one street-profile OSM
area into ~100 m glTF 2.0 tiles plus JSON manifests that any runtime (three.js WebGPU, Godot 4.7) can load.
This is **format 0**: greybox geometry, no textures, no façade detail.

```sh
node scripts/data/fetch-osm.mjs --area kadikoy [--cache /tmp/overpass-kadikoy.json]   # input  -> data/osm/kadikoy.json
npm run compile:world -- --area kadikoy [--out public/world/kadikoy] [--no-validate] [--min-walk-share 0.9]  # output -> public/world/kadikoy/
npm run typecheck:world
```

The compiler runs the renderer-independent code of the `?osm=1` slice in Node (via `tsx`):

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

## Output layout

```
public/world/<area>/            (gitignored; served by Vite at /world/<area>/)
  index.json                    index manifest
  tiles/<i>_<j>.glb             one tile's geometry
  tiles/<i>_<j>.json            one tile's manifest
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
  places of worship and 5 otherwise. The block starts 0.3 m below the lowest ground under the footprint, or at
  `min_height`. Roofs are flat, and `building=roof` becomes a 0.4 m canopy slab.
- **Doors.** A door is a recess 0.35 m deep. It has a door leaf at the back, jambs, a head and a threshold, and the
  wall above and below the opening stays solid. The threshold is at the ground height 0.6 m in front of the door.
- **Ground.** The ground is built on 1 m cells, each split into two triangles. Each triangle is cut along the contour
  lines of the land field (OSM coastline and pier polygons), the carriageway distance and the footway distance, so
  kerbs, quay edges and material borders are straight, not stair-stepped.
  - The carriageway sits at the terrain height. Everything else is raised by the kerb lift from `StreetSurface`: 15 cm
    next to kerbed streets, tapering where they meet kerbless lanes. A vertical kerb face closes the step.
  - The land ends in a quay wall down to y = -1.5 m. Cells that lie entirely inside one building are left out.
  - Tram platforms are not raised in format 0.
- **Terrain and shore.** Heights come from the geo build (a 23 m grid) and are held at least at 0.95 m on OSM land.
  The shoreline is the OSM coastline, not the geo coast grid, which misses the reclaimed Kadıköy quays by up to 90 m.

### Tile manifest (`tiles/<i>_<j>.json`)

The types are in `src/format.ts` (`TileManifest`). All positions are in world metres, as `[x, y, z]`.

| field | content |
|---|---|
| `bounds`, `origin`, `content` | Nominal square, glb node translation, and the world AABB of the geometry. Buildings overhang their tile: each building belongs to the tile of its footprint centroid. |
| `buildings[]` | `id` (`w<way>` / `r<relation>`, with a `-k` suffix for further polygons of the same relation), `osmId`, `kind`, `part`, `name` (OSM, data only), `footprint` (flat `[x, z, ...]`, positive shoelace area, for colliders), `holes`, `groundY`, `bottomY`, `topY`, `height`, `heightSource` (`height` \| `levels` \| `default`), `levels` and `doors` (ids). |
| `doors[]` | `id` (`<building>/d<k>`), `building`, `position` (centre of the opening at threshold height, on the façade plane), `normal` (outward), `width`, `height`, `depth`, `inferred`, `entrance` (the `entrance=*` value, or `shop`) and `pois` (ids). |
| `pois[]` | `id` (`p<index of the point in the data file>`), `kind` (`shop=*`, `craft=*`, `amenity=*` places, `tourism=*`), `osmName` (data only: the businesses shown in the game are fictional), `position`, `building` and `door`. A POI belongs to its building's tile. |
| `lamps[]` | `position` (foot of the post or bracket), `kind` (`arm`, `armLow`, `double`, `lantern`, `wall`), `heading`, `light` (`sodium`, `led`, `warm`) and `inferred`. OSM maps no lamps in Kadıköy, so every lamp comes from the street lighting rules. |
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

Every glb is checked with the Khronos glTF-Validator (`gltf-validator`, the reference implementation compiled to JS).
A run fails (exit code 1) on any validator error, and also when the walk graph is not one network (see above). The
summary printed at the end reports tiles, triangles, byte sizes, doors, kerb-step lengths, graph sizes and
connectivity, validator totals and timings.

## Not in format 0

- Façade depth, windows, roof shapes, textures, UVs, LODs, baked AO and colliders beyond footprints.
- Tram platforms, steps as steps (they are slopes), and interiors.

Bump `FORMAT` in `src/format.ts` and this document on any breaking change to the files above.

## Dev dependencies

| package | licence | why |
|---|---|---|
| `tsx` | MIT | Runs the TypeScript sources in Node. Node's own type stripping cannot resolve the extensionless imports in `src/`. |
| `@gltf-transform/core` | MIT | Standard glTF 2.0 document model and GLB writer. |
| `gltf-validator` | Apache-2.0 | Khronos reference validator. |
| `@types/node` | MIT | Node typings for `npm run typecheck:world` only. The root tsconfig restricts `types`, so they do not leak into the game. |
