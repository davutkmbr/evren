# 23 — OSM feature kits: one parametric kit per place type, placed by the world compiler

Status: first kits live in the runtime details layer (cloud session, PR #30, 2026-09-26; see
[Runtime kits (built)](#runtime-kits-built)); the compiler twins for the landing spots are still to do. Pattern:
[22 — City walls](22-city-walls.md) (kit first, generic placement from OSM, counts and checks). Nothing here is
hand-placed per spot.

## Runtime kits (built)

`src/world/osm/details/props/features.ts` (rules) + `props/models.ts` (kits), from the shipped OSM regions only, no
refetch. Every prop goes through the shared stand rule; per-slice budgets. Counts per region:
`npx tsx tools/headless/osm-details-check.ts <region>`.

| OSM | kit / rule |
| --- | --- |
| `amenity=fuel` | canopy + 2 pump islands facing the street, shop behind, price pylon; brand colour from the name |
| `leisure=pitch` | football goals (small under 45 m) / basketball hoops at the ends of the long axis |
| `leisure=playground` | swing, slide tower, climbing frame |
| green areas (`landuse=grass`, park, garden, scrub, heath, meadow, bare rock, `landuse=flowerbed`) | shrubs, stones, flower clumps by density per kind |
| untagged lots (cover.ts `LotStyle`) | shrubs on garden lots, stones + weedy scrub on vacant lots (road verges) |
| cafés, restaurants, shops / `amenity=pharmacy` / `amenity=atm` | awning on the facade / lit "E" sign / wall ATM |
| `amenity=fountain` | marble çeşme on its wall, else a round basin |
| `tourism=artwork`, `historic=memorial/monument` / `tourism=viewpoint` | statue on plinth / coin telescope |
| `landuse=cemetery`, `amenity=grave_yard` | rows of Ottoman headstones |
| `amenity=marketplace` | rows of tinted stalls with produce |
| `emergency=fire_hydrant`, `amenity=recycling/waste_disposal`, `amenity=bicycle_parking`, `leisure=fitness_station`, `barrier=hedge`, `railway=subway_entrance`, `amenity=taxi` | hydrant, recycling bins, bike rack, outdoor gym, hedge segments, metro entrance, taksi durağı |

Flight-scale land use (highway verges and interchanges seen from the air, outside the OSM regions) is the phase 24
map work (OSM land use stamped into the geo build, [24](24-far-osm-layer.md) S2).

## Idea

OSM maps many place types in detail: stadiums, pitches, fuel stations, bus stops, ferry terminals, schools,
hospitals, places of worship, playgrounds, marinas, lighthouses, chimneys, cranes, water towers, stations and
platforms, individual trees, traffic signals, shops and cafés, car parks, cemeteries. For each type we build a
**parametric, non-plastic model kit once** (real proportions, approved CC0 materials, weathering, 3 LODs), add **one
generic world-compiler placement rule** driven by OSM geometry and tags (e.g. the fuel-station canopy centred on the
forecourt with pumps under it, the brand from `brand`), with per-rule counts and validation, so every compiled area
gets them automatically. Once kit dressing is referenced by id (as the façade modules already are,
[Format 1.2](../../tools/world-compiler/README.md#format-12--façade-modules)), new variants need no recompile.

Stays hand-made (landmark class): the big stadiums (Şükrü Saracoğlu, Vodafone Park / Tüpraş Stadyumu, RAMS Park,
Atatürk Olimpiyat, Başakşehir Fatih Terim), the major stations (Haydarpaşa, Sirkeci, the Marmaray / metro hubs
seen from the air), the historic mosques (the `mosques` landmark module), Kız Kulesi and the named towers of
`structures/builders/towers`, the bridges. The compiler already hides landmark buildings (`landmarkOf`,
`--landmarks none`); feature kits must honour the same list and skip any feature a landmark owns.

## What exists

- **Runtime OSM details layer** (`src/world/osm/details/props/placement.ts`, worker): benches, bins, bollards, İETT
  shelters with waiting passengers at `highway=bus_stop`, tram platform crowds, kiosks, café tables at cafés and
  restaurants, flag poles, and the hoardings and tower cranes of construction sites. Trees (`details/trees/`: species
  mix, atlas, OSM `natural=tree` + park fill). Ground cover (`details/cover/cover.ts`) paints pitches, playgrounds,
  cemeteries as green or soil by `surface`. None of this is a kit with a placement rule, counts and a compiler twin.
- **World compiler** (`tools/world-compiler/`): placement predicates (`src/street/placement.ts`, the shared
  `stand.*` rule from `src/world/placement/stand.ts`), per-rule counts in the summary, the stage and tile caches,
  worker threads, props as instances with decimated LODs, façade modules by id, landmark handling, 28 landing spots.
- **Fetchers** (`scripts/data/fetch-osm.mjs`, `scripts/data/osm-regions.mjs`): what they keep is the limit for
  every kit — see [Fetch gaps](#fetch-gaps).

## Coverage (2026-09-26)

### Istanbul province (Overpass, `admin_level=4`, relation 223474, OSM base 2026-09-26 13:20 UTC)

`n / w / r` = nodes / ways / relations. Detail columns count features carrying that tag.

| type | total | n / w / r | detail tags |
| --- | --- | --- | --- |
| `leisure=stadium` | 35 | 2 / 31 / 2 | name 23, sport 11, capacity 5, building 4, height 2 |
| `building=stadium` | 15 | 0 / 14 / 1 | building:levels 2, height 0 |
| `leisure=pitch` | 4,480 | 38 / 4,440 / 2 | sport 4,068 (91 %), surface 310 (7 %), name 262 |
| `leisure=sports_centre` | 342 | 73 / 268 / 1 | name 200, building 78 |
| `leisure=track` | 140 | 0 / 117 / 23 | — |
| `leisure=swimming_pool` | 7,919 | 88 / 7,831 / 0 | access 640 |
| `leisure=playground` | 1,953 | 263 / 1,686 / 4 | name 90, surface 36 |
| `leisure=fitness_station` | 197 | 59 / 138 / 0 | — |
| `amenity=fuel` | 796 | 710 / 86 / 0 | brand 632 (79 %), brand:wikidata 615, name 659, operator 196, fuel:lpg 103 |
| `amenity=charging_station` | 108 | 100 / 8 / 0 | — |
| `amenity=car_wash` | 362 | 279 / 82 / 1 | — |
| `amenity=parking` | 5,120 | 711 / 4,374 / 35 | parking 1,890 (surface / multi-storey 68 / underground 157), capacity 215, name 684 |
| `building=parking` | 23 | 0 / 23 / 0 | — |
| `highway=bus_stop` | 14,923 | 14,903 / 20 / 0 | name 14,852, shelter 2,161 (yes 1,468), bench 1,792 |
| `public_transport=platform` | 15,750 | 15,029 / 579 / 142 | (mostly the bus-stop twin node) |
| `amenity=bus_station` | 158 | 48 / 108 / 2 | name 131 |
| `amenity=ferry_terminal` | 157 | 103 / 53 / 1 | name 135, building 25 |
| `railway=station` | 229 | 228 / 1 / 0 | name 229, station 175 (subway / light_rail / train) |
| `building=train_station` | 375 | 0 / 373 / 2 | — |
| `railway=platform` | 537 | 0 / 398 / 139 | shelter 138, covered 22, ref 13 |
| `railway=tram_stop` | 156 | 156 / 0 / 0 | — |
| `railway=subway_entrance` | 560 | 560 / 0 / 0 | — |
| `amenity=school` | 3,021 | 570 / 2,440 / 11 | name 2,449 |
| `building=school` | 2,754 | 3 / 2,736 / 15 | building:levels 540 (20 %), height 150 |
| `amenity=kindergarten` | 202 | 116 / 85 / 1 | — |
| `amenity=university` | 180 | 57 / 119 / 4 | — |
| `amenity=hospital` | 421 | 132 / 286 / 3 | name 383, beds 12 |
| `building=hospital` | 536 | 1 / 519 / 16 | building:levels 111 (21 %), height 7 |
| `amenity=clinic` | 607 | 414 / 192 / 1 | — |
| `amenity=place_of_worship` | 3,111 | 155 / 2,904 / 52 | religion=muslim 2,831, christian 181, name 2,997, building 2,923 |
| `building=mosque` | 2,570 | 0 / 2,522 / 48 | building:levels 61, height 37, roof:shape 11 |
| `landuse=cemetery` | 427 | 16 / 402 / 9 | name 317, religion 219 |
| `amenity=grave_yard` | 38 | 15 / 23 / 0 | — |
| `amenity=fire_station` | 124 | 11 / 113 / 0 | — |
| `amenity=police` | 240 | 83 / 155 / 2 | — |
| `leisure=marina` ¹ | 25 | 8 / 17 / 0 | name 17, capacity 7 |
| `man_made=pier` ¹ | 448 | 0 / 443 / 5 | name 57, floating 28 |
| `man_made=breakwater` ¹ | 34 | 0 / 34 / 0 | — |
| `man_made=lighthouse` ¹ | 19 | 11 / 8 / 0 | name 13, seamark:type 8, seamark:light:colour 4, height 2 |
| `seamark:type` minor lights and beacons ¹ | 102 | 98 / 4 / 0 | — |
| `landuse=port` / `harbour` ¹ | 13 | 0 / 13 / 0 | — |
| `natural=tree` | 12,982 | 12,982 / 0 / 0 | leaf_type 857 (7 %), denotation 427, height 102, circumference 57, genus 31, species 9 |
| `natural=tree_row` | 1,037 | 0 / 1,037 / 0 | leaf_type 50 |

¹ Answered by the kumi.systems mirror, whose database was at OSM base 2026-05-06 (overpass-api.de timed out);
counts may lag the main instance by a few months.

<!-- OVERPASS-PENDING -->
**Pending, to be measured from the local extract** (`data/osm-src/turkey-latest.osm.pbf`, Geofabrik, once
`scripts/data/lib/osm-local.mjs` exists; Overpass timed out on these groups on 2026-09-26, and the private.coffee
mirror returned 0 for everything because it has no area index for the province, so those zeros were discarded):

- tall single features: chimneys, cranes, water towers, `man_made=tower` by `tower:type`, masts, storage tanks,
  silos, `power=tower` / `power=line`, flagpoles, helipads;
- street items: traffic signals, street lamps, crossings, benches, bins, fountains, `advertising=*`, kiosks;
- `shop=*`, cafés, restaurants, fast food, banks, pharmacies, markets, hotels (name / brand / outdoor_seating);
- `building=*` detail-tag shares (building:levels, height, roof:shape, roof:colour, building:colour, material).

The local regions below give the order of magnitude for these in the meantime.
<!-- /OVERPASS-PENDING -->

### What our fetched data already holds

46 flight-scale regions (`public/data/osm/regions/`, 117 km², ~2 % of the province's ~5,460 km²), the 28 street
areas (`data/osm/*.json`) and the slice (`public/data/osm/slice.json`) overlap; region counts:

| type | regions | as | note |
| --- | --- | --- | --- |
| `leisure=pitch` | 541 | areas (`sport` on 523) | `surface` kept |
| `leisure=playground` | 149 + 69 | areas + points | |
| `leisure=sports_centre` / `marina` | 19 / 6 | areas | |
| `leisure=stadium`, `track`, `swimming_pool` | — | not fetched | `building=stadium` 2 outlines only |
| `amenity=fuel` | 62 | **points only** | forecourt areas dropped (`AREA_KEYS` has no `amenity=fuel`), `brand` not copied |
| `amenity=parking` | 776 + 137 | areas + points | `parking` kept on 367 |
| `highway=bus_stop` | 1,430 | points | `shelter` on 377 points of all kinds, `bench` on 366 |
| `railway=platform` / `public_transport=platform` | 125 / 20 | areas (+17 lines) | |
| `amenity=ferry_terminal` | 12 | areas | points too |
| `railway=station` / `public_transport=station` | 34 / 96 | points | `building=train_station` 22 outlines |
| `amenity=school` / `building=school` | 133 / 335 | points / outlines | school grounds not kept as areas (`landuse=education` 12) |
| `amenity=hospital` / `building=hospital` | 24 / 91 | points / outlines | |
| `landuse=cemetery` | 144 | areas | `amenity=grave_yard` 9 points |
| `natural=tree` / `tree_row` | 1,696 / 47 | points / lines | leaf_type on 81, genus on 7: species must be inferred |
| `highway=traffic_signals` | 749 | points | `highway=crossing` 1,606 |
| `man_made=tower` / `mast` / `lighthouse` | 52 / 63 / 1 | points | `chimney` kept but 0 found; `crane`, `water_tower`, `storage_tank` not fetched |
| shops / cafés / restaurants | ~6,900 / 1,522 / 1,910 | points | `name` kept, `brand` not |

Building tags in the regions (99,633 outlines): `building:levels` on 3,449 (3.5 %), `height` 458, `roof:shape` 297,
`roof:colour` 226; the street areas are similar (levels 886 of 19,474).

### Fetch gaps

Every kit rule needs its input in the data files first (one `fetch-osm.mjs` change, then a refetch of the regions
and landing spots, one area at a time):

- `AREA_KEYS`: `leisure=stadium|track|swimming_pool|marina|slipway`, `amenity=fuel|school|hospital|university|
  kindergarten|grave_yard`, `man_made=storage_tank|silo|water_tower|chimney|crane` outlines, `landuse=port`.
- Points: `man_made=crane|water_tower|storage_tank|silo`, `power=tower`, `seamark:type` lights and beacons,
  `advertising=billboard` (already `advertising=*`).
- Lines: `power=line` (pylons between towers).
- Tags to copy: `brand`, `brand:wikidata`, `operator`, `capacity`, `sport`, `covered`, `shelter`, `bench`,
  `height`, `tower:type`, `crane:type`, `genus`, `species`, `leaf_type`, `seamark:light:colour`, `fuel:*`.
- The fetch output stays deterministic and schema-versioned (`src/world/osm/data.ts`); the compiler keys caches on
  the data file, so the refetch rebuilds every tile once.

## Kits and placement rules

Every kit is a pure builder (no three.js; the compiler and the runtime worker import it, like the walls kit) with
real dimensions from a reference sheet (`.docs/research/feature-kits-reference.md`, written per kit: photos studied,
standard sizes), approved CC0 materials with weathering (`_WEATHER` / COLOR_0), 3 LODs and box colliders. Every rule
logs `kept / moved / shortened / dropped / flagged` under `placement.<rule>` in the compile summary, and every
standing piece passes `stand.water` and `stand.audit` (on land, base within 0.4 m of `groundY`, none in the air).

| type | OSM gives | kit | placement rule (`feature.<id>`) | validation | fallback when data is thin |
| --- | --- | --- | --- | --- | --- |
| **Fuel station** | point (89 %) or forecourt area; `brand` 79 %, `fuel:lpg` | canopy (steel columns, fascia with brand colour band, underside lights), pump islands (2–6), shop kiosk, price totem, air / water post, car-wash bay | area: canopy = largest rectangle inside the forecourt, long side parallel to the adjacent road, islands under it on the drive direction; point: synthesise a forecourt (the lot between the point and the nearest non-motorway road, 25–40 m frontage, off buildings), else drop | islands and canopy off carriageways and buildings, canopy clear of façades by 1 m, totem 1.5 m behind the kerb, driveway joins a road | no brand → neutral livery (fictional); brand colours only as colour bands, no logos (trademarks), names fictional like shops |
| **Bus stop** | point, `name` 99.5 %, `shelter` 14 %, `bench` 12 % | İETT shelter (glass + ad panel + name board), pole-only stop, bench | shelter when `shelter=yes`, or on main roads when untagged and the pavement is ≥ 2.6 m; faces the carriageway, back to the façade; pole otherwise | `prop.pole` / `prop.furniture` + 1.2 m walkway clear behind; never on the carriageway (points often sit on the road centre line: snap to the kerb side of the served way) | `shelter=no` → pole; name board text from `name` (public stop names are real, fine) |
| **Pitch** | area, `sport` 91 %, `surface` 7 % | line-marking decals per sport (football 5/7/11-a-side by size, basketball, tennis, volleyball), goals / hoops / nets, perimeter fence 4–6 m with a gate, floodlight masts on larger pitches | markings fitted to the oriented bounding rectangle, size class from area; fence along the outline; floodlights at corners when ≥ 40 m long | fence off roads and buildings, goals inside the outline | no `sport` → football when ≥ 30 × 18 m, else multi-use; surface: artificial turf (the common Istanbul case) unless `grass` / soil |
| **Playground** | area 86 %, few tags | swings, slide tower, see-saw, spring riders, rubber-tile ground, low fence | pieces packed in the outline (seeded per feature), ground material from outline | `prop.furniture` rules, 1.5 m between pieces | point → 12 m disc on park ground only, else drop |
| **Swimming pool** | area (7,831), `access` 8 % | water surface with tile rim, coping, ladders, loungers for private ones | the outline itself, sunk 1.5 m; loungers on the deck ring | not on roofs unless the building is flat and the outline sits inside it (roof pools) | — (high value from the air: blue patches in villa districts) |
| **Stadium / sports centre** | area; `capacity` 14 % | stands (straight / corner, rows, roof on the main stand), pitch, track, floodlight masts | stands along the outline between pitch and outline edge, tiers from `capacity` or area | stands never over roads; landmark ids skip | small grounds only; the big five stay hand-made |
| **Ferry terminal / pier** | 103 points + 53 areas; piers as areas / lines | iskele kit: pontoon, gangway, waiting hall (standard İDO / Şehir Hatları types), bollards, fenders | at the pier head closest to deep water; hall on the terminal area | pontoon at water, hall on land; `stand.water` exempt for the pontoon (floating) | historic iskele buildings (Kadıköy, Beşiktaş...) stay heroes |
| **Railway / tram platform, station** | platform areas 74 %, `shelter` 26 %; station points | platform edge, tactile strip, canopy bays, benches, signs, lamp posts | platform outline extruded to 0.9 m (rail) / 0.3 m (tram), canopy over the middle 60 % when `shelter` / `covered` | platform edge 1.35 m (tram, as `platformClearance`) / 1.65 m from track centre | major stations hand-made; station points without platforms get a sign only |
| **School / hospital / fire / police** | grounds (area) + building outlines; `building:levels` 20 % | not a new building kit: façade profile rules (school: long corridor blocks, painted walls, flag pole, courtyard with basketball pitch and wall; hospital: tall slab, helipad on the roof, ambulance bay) | the grounds area drives the typology of the buildings inside it; courtyard props on the open ground | the usual façade and prop rules | levels default by type (school 3–4, hospital 6–10) |
| **Place of worship** | outlines, `religion` 91 % muslim | neighbourhood mosque kit (dome or pitched roof, 1–2 minarets with şerefe count by size, son cemaat yeri, şadırvan) for **unnamed-or-small** mosques; churches keep their block | footprint → prayer hall + minaret at the corner nearest the qibla side's end | never on the landmark list; minaret inside the outline or its courtyard | the `mosques` module's catalogue wins; sensitivity rule: never damaged |
| **Cemetery** | area, `religion` 51 % | Muslim graves (headstones, turban tops on old ones, cypress rows), Christian / Jewish variants | graves on a jittered grid aligned to the qibla (Muslim) or the outline, paths kept free, cypresses along paths | graves off paths, roads, buildings | no `religion` → Muslim |
| **Marina** | 25 (17 areas), `capacity` 7; 448 piers, 28 floating | floating pontoons, finger piers, moored sail and motor boats | pontoons across the water part of the outline, boats per berth | pontoons in water only, boats clear of lanes (`life` vessel lanes) | — |
| **Tall single features** | points (pending counts): lighthouse, chimney, crane, water tower, communication tower, mast, storage tank, pylon | one kit each, sized from `height` else type defaults (chimney 30–60 m, pylon 30–45 m) | at the point or outline centre; pylons along `power=line` with wires as catenaries | on land, off buildings unless the tag says roof mount | heights: `height`, else defaults; cranes also appear on `landuse=construction` (already done at runtime) |
| **Trees** | 12,982 points (genus 31, leaf_type 7 %), 1,037 rows | the existing species set of `details/trees` | per point, species from genus / leaf_type, else by district mix and street type (plane trees on avenues, pines on the Bosphorus) | `prop.tree` (0.6 m behind the kerb, 0.8 m off façades) | tree rows → spacing 6–8 m |
| **Traffic signals** | points on junction nodes | signal heads on poles, mast arms on wide roads, pedestrian heads at signalised crossings | one head per approach way, pole on the kerb corner to its right | `prop.pole` | exists at runtime for the slice; compiler rule already partly present — unify |
| **Car park** | areas 85 %; `parking` 37 % | bay markings, kerb stops, ticket machine, parked cars from the traffic layer's fleet | markings along the longest edge, aisles 6 m; multi-storey outlines → deck building kit | `ground.areaEdge` | untagged → surface |
| **Shops / cafés** | POIs | already covered by shopfronts, façade modules and café tables | — | — | — |

LOD / performance budget per kit (LOD0 within 120 m, LOD1 to 600 m, LOD2 to the flight-scale draw distance):

| kit | LOD0 tris | LOD1 | LOD2 | instances per km² (Istanbul mean) |
| --- | --- | --- | --- | --- |
| fuel station | 6–10 k | 1.5 k | 200 (canopy slab + colour band) | 0.15 |
| bus shelter | 1.2 k | 300 | — (dropped past 600 m) | 2.7 |
| pitch dressing | 3 k (+ decal) | 800 | 50 (markings baked into the ground texture) | 0.8 |
| playground | 4 k | 600 | — | 0.4 |
| stands (per 10 m) | 2 k | 400 | 60 | small |
| neighbourhood mosque | 20–30 k | 4 k | 600 | 0.5 |
| cemetery (per 100 graves) | 8 k | 1 k | ground texture | — |
| pylon | 1.5 k | 200 | 24 (billboard-free lines) | pending |

Instanced kits (shelters, graves, pumps, trees, pylons) go through the prop instance path and its decimated LODs;
area kits (pitches, pools, cemeteries, platforms) emit tile geometry per material, so a whole tile of them stays one
primitive per material.

## Priority

Score = visibility (from 300 m and at 30–80 m landing distance) × coverage × 1 / effort:

| rank | kit | why |
| --- | --- | --- |
| 1 | **Pitches** | 4,480 outlines with `sport` on 91 %; bright green rectangles with white lines and fences read from any altitude; area rule and decals, low effort |
| 2 | **Swimming pools** | 7,919 outlines; blue in the Bosphorus villages and the islands, almost free (outline + material) |
| 3 | **Bus stops** | 14,923 points on every main road, the first thing seen after landing; shelter kit exists at runtime (port it) |
| 4 | **Fuel stations** | 796, brand 79 %; the canopy is a landmark of every arterial road from the air and at landing distance; needs the forecourt synthesis |
| 5 | **Cemeteries** | 427 areas, large (Karacaahmet, Zincirlikuyu, Edirnekapı); cypress rows are very Istanbul from the air |
| 6 | **Playgrounds** | 1,953, mostly areas; at landing distance in every neighbourhood park |
| 7 | **Platforms / tram stops** | 537 platforms, 156 tram stops; the T1 line crosses the landing spots |
| 8 | **Neighbourhood mosques** | 2,570 outlines, a minaret every few hundred metres is the skyline signature; bigger effort, sensitivity rules |
| 9 | School / hospital façade profiles, car-park markings, trees by species, signals | refinements of existing systems |
| 10 | Tall single features, marinas (25), lighthouses (19), stands of small grounds | small counts or pending counts |

**First batch:** pitches, swimming pools, bus stops, fuel stations (one kit each, one rule each), plus the fetch
change they need (pitch / pool / fuel areas, `brand`, `shelter`). Cemeteries next.

**Hand-made:** the big stadiums, Haydarpaşa, Sirkeci and the main transport hubs, historic mosques and churches,
historic iskele buildings, the named towers, Kız Kulesi, the bridges, the city walls ([22](22-city-walls.md)).

## Pipeline

1. **Compiled tiles (close range, landing spots):** each kit is a `COMPILE_STEPS` entry (`featureKits`, after
   `buildings`, before `lampFixtures`) with a `prepare` that indexes the features of the area and a `tile` that places
   the ones whose anchor lies in the tile (anchor = the feature's centroid tile, as buildings; pieces may overhang).
   Seeds per feature id (`tileSeed` of the OSM id), never a shared stream, so parallel and cached compiles give the
   serial bytes (`--check`). Kit pieces that repeat (pumps, graves, goals, swings) are props (instances); area
   dressing is tile geometry. Kit variants (canopy fascia, shelter style, headstones) become module families
   referenced by id in the slot files, so a new variant is a glb and a catalog entry, no recompile.
2. **Runtime OSM regions (flight scale):** the same pure builders run in the details worker for the 46 regions,
   at LOD1 / LOD2 only (pitch markings baked into the ground texture, pool colour, canopy slabs, pylons, minarets),
   with the same placement predicates (`src/world/placement/stand.ts`). The tile fade (`src/street/fade.ts`) hides
   the flight-scale version where a compiled tile is live, as it does for buildings.
3. **Procedural city beyond the regions:** no OSM there, nothing to place; the regions grow instead.
4. **Recompile cost:** a new kit step re-runs only that step in every tile (stage cache replays ground, buildings and
   façades), then re-assembles the tiles it changed. Eminönü's 47 full-detail tiles take a few minutes at `--jobs
   auto`; all 28 landing spots about one sitting, one area at a time on the shared machine. The fetch change forces
   one full rebuild (the data file is part of every key); `--cache local` limits later OSM refetches to the tiles
   near edits.

## Checks

- Compile summary: `placement.feature.*` counts per rule and outcome, `stand.audit` flagged = 0, glTF validator
  clean; a count change is a regression signal.
- `src/street/tools/placement-scan.ts <area>`: kit props on the carriageway, in buildings or water.
- Shots with `scripts/snap.mjs --batch`: 300 m and 80 m over Kadıköy (Fenerbahçe pitches, Karacaahmet), Beşiktaş,
  Eyüp (cemetery), a fuel station on the Kennedy Caddesi / D100, a bus stop at eye level in every landing spot.
- `snap.mjs --perf` before / after each kit in the regions; triangle and draw-call budgets above hold per kit.
- New external models or textures for kits follow the asset rule (shortlist → approval → `LICENSES.md`); the kits
  are procedural first.
