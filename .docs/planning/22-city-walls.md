# 22 — City walls: kit and placement

Status (2026-09-26): placed in the game. `npm run compile:walls` (tools/world-compiler/src/walls, ~20 s) bakes the kit
along `data/osm/walls.json` into `public/world/walls/` (gitignored); the walls system
(`src/world/landmarks/walls/system`) streams it. See "Placement (implemented)" at the end.

## What exists

- **Kit** (`kit/kit.ts`): parametric pieces built into the heritage `MeshBuilder` (heritage vertex format, 3 LODs,
  box colliders): `curtain` (any polyline: straight, corners with mitred joints; battered foot, wall-walk, parapet,
  merlons with a kept fraction and optional Ottoman pyramidal caps, `flush` / `crumbled` / `stepped` ends, `ruin`
  0..1, lateral wander, damage dips, fallen masonry), `tower` (square, pentagon prow, hexagon, octagon; battered
  plinth, brick string courses, arrow slits and arched windows with brick voussoirs, merlon platform, broken ruined
  tops), `gate` (arched passage with brick vault and voussoir ring, lintel band, optional doors and flanking towers),
  `seaFoundation` (stepped block plinth into the water + riprap boulders).
- **Material** (`render/material.ts`): heritage surface library + the approved CC0 Poly Haven stone and brick sets
  (albedo, roughness, normal), banded Byzantine masonry with varying 3–5-course brick bands, brick repair patches, lost
  facing exposing the rubble core (mostly at the foot), run-off, black crusts, algae at the waterline, plants in joints.
- **Data** (`data/osm/walls.json`, `scripts/data/fetch-walls.mjs`, schema `data/types.ts`): every OSM wall line (plus
  the approved OHM supplement),
  thick-wall outline, tower, gate in the playable square, with per-line openings (road / path / rail crossings and runs
  through ordinary buildings) and the OSM ids of the buildings the walls own. Not read by the game.
- **Reference**: `.docs/research/sea-walls-reference.md` (dimensions, photos studied, kit decisions);
  `.docs/assets/candidates/sea-walls-data.md` (OpenHistoricalMap trace, approved 2026-09-26).

## Coverage (2026-09-26)

`data/osm/walls.json` = OSM (ODbL) + the approved OpenHistoricalMap supplement `ohm-walls-constantinople` (CC0,
OpenHistoricalMap contributors; `node scripts/data/fetch-walls.mjs --supplement ohm-walls-constantinople`). OSM has
priority: OHM stretches are kept only farther than 40 m from every OSM wall line and when they do not shadow an OSM
wall 40–90 m away over most of their length. Supplement lines carry `src: "ohm-walls-constantinople"`.

| Stretch | Historic course | OSM wall lines | OHM supplement | Notes |
| --- | --- | --- | --- | --- |
| Land walls incl. Yedikule, Blachernae | ~9.0 km | ~7.1 km (79 %) | — | inner and outer walls as separate lines, 80 defensive towers, 21 gates, almost no height tags |
| Marmara (Yedikule → Sarayburnu) | ~8.5 km | ~1.4 km of the peninsula course (32 %) + Sur-ı Sultani outline | 3.6 km: Mermerkule (0.4 km), Samatya → Kumkapı → Kadırga (3.0 km), Çatladıkapı (0.15 km) | OSM: Sarayburnu–Ahırkapı (`height=11`), Sur-ı Sultani (`height=13-15`), Bukoleon, Yedikule → Narlıkapı, 41 towers |
| Golden Horn (Sarayburnu → Ayvansaray) | ~5.6 km | ~0.7 km (13 %) | 4.9 km: Sarayburnu → Unkapanı (2.9 km), Unkapanı → Ayvansaray (2.0 km) | most of the real wall was demolished in the 1870s; OSM has 12 towers, 2 gates |
| Galata | — | 0.2 km | — | four short `historic=citywalls` remnants |
| Rumeli / Anadolu Hisarı | — | 0.4 km | — | Anadolu Hisarı as five outlines; Rumeli Hisarı walls not tagged as walls |

Openings on the supplement stretches (from OSM context fetched along them): roads 0.48 km, paths 0.09 km, railways
0.02 km, ordinary buildings 0.13 km, water 0.09 km (kind 4: the coarse trace crosses the modern shoreline; no wall is
drawn there). Road crossings at grazing angles (< 20°) are ignored: a road running along the wall is not a breach.
The OHM trace is coarse (one vertex per ~125 m), so the compiler should smooth it and snap it to the terrain; along the
Golden Horn the placement should default to fragments / ruins (`ruin` 0.5+ with long gaps) rather than a continuous
wall, matching today's state.

Tags that carry information: `height` on 7 OSM lines only (values like `11`, `13-15`, `4`), `ruins=wall` /
`historic=ruins` on 3, `material` (limestone / stone / brick) on ~10, `historic:civilization=byzantine`, `start_date`.
Towers: `man_made=tower` + `tower:type=defensive` outlines (often `building=yes`, 16 m heights on the Sarayburnu towers).

## Placement design (world compiler, later)

1. **Input**: `data/osm/walls.json` (OSM + OHM supplement) per compiled area; OSM regions provide the
   buildings, roads and ground the walls must respect.
2. **Line preparation**: merge ways that share end nodes into continuous lines; classify thin `area=yes` outlines as
   thick walls (centre line by pairing the long sides, thickness = mean width) instead of extruding the outline; drop
   stretches over water (signed coast distance < 1 m) and inside the openings.
3. **Outer side**: mapped towers project outward (vote); else the sea side (coast distance); else the less built-up
   side; the kit needs the outer side on the right, so lines are reversed when needed.
4. **Parameters from tags, then defaults from the reference sheet**: height (`height`, else 12 m Marmara / Blachernae,
   10 m Golden Horn, 7 m castle walls, 8.5 m outer land wall), thickness (4–5 m), `ruin` from `ruins=*` plus the
   surveyed state; double land walls: the line with a parallel partner on its inner side is the lower outer wall.
5. **Openings**: road / rail crossings become breaches with `crumbled` ends (a `gate` piece when a mapped gate is
   within ~20 m and the gap is under 10 m); paths become gate passages; runs through ordinary buildings end `flush`
   (the house abuts the wall) — the wall is never drawn through a building or a road.
6. **Towers**: mapped outlines first (square / polygon plan fitted from the outline); elsewhere every ~45 m (Marmara)
   / ~50 m (Golden Horn, land walls) with a shape mix of ~80 % square, the rest pentagon / hexagon / octagon; never in
   an opening or within 9 m of one.
7. **Terrain and coast**: pieces take the compiler's ground function; sea walls whose outer foot is within ~8 m of the
   water get a `seaFoundation`; the land-use reservation keeps procedural buildings a few metres off both faces.
8. **Output**: the kit's LOD meshes per 100 m tile (like the street tiles), box colliders with `city-wall:<osm id>`
   sources under the `heritage` tag, and the owned tower ids so the OSM building layer skips those buildings (the
   runtime OSM `barriers.ts` city-wall beams go away at the same time).
9. **Checks**: `walk-test --dragon --area <id>` over every area with walls, `?colliders=1` overlay, eye-level and
   300 m / 80 m shots along Kumkapı, Samatya, Sarayburnu, Ayvansaray and Balat, `snap.mjs --perf` before / after.

## Placement (implemented)

- **Bake** (`tools/world-compiler/src/walls/`): `plan.ts` (steps 2–7), `fit.ts` (walls vs buildings), `build.ts` (kit
  per LOD, triangles cut into 100 m tiles by centroid), `cli.ts` (files). Ground: `osmGroundHeight` over the headless
  geo world (the OSM ground's function). Output: `index.json` (tiles, LOD files, `owned`, stats incl. the overlap
  check), `colliders.json`, `lod0/<i>_<j>.bin.gz`, `lod1/<ci>_<cj>.bin.gz` (1 km cells), `lod2.bin.gz`; container format
  `src/world/landmarks/walls/data/baked.ts`. Land-use corridors (`data/corridors.json`, checked in) are reserved by the
  geo build (`src/world/geo/prepare.ts`), so the procedural city and OSM infill keep ~9 m off the faces.
- **Runtime** (`src/world/landmarks/walls/system/`): LOD 2 and LOD 1 in one `BatchedMesh` each (per-tile visibility),
  LOD 0 tiles streamed within 260 m (quality-scaled), LOD 1 within 1 km; box colliders `city-wall:<id>` (tag
  `heritage`); foliage without shadows. The OSM building layer and the street compiler skip `owned` buildings; the
  runtime OSM city-wall beams (`streets/barriers.ts`) are gone. `?walls=0` turns the walls off.
- **Buildings**: no piece may stand in a building of the slice, the regions or the street areas. The wall is shifted
  (≤ 3 m) / thinned (≥ 1.6 m) to keep 0.35 m off; where a building stands on the line the wall breaks with flush ends;
  small sheds (≤ 25 m², or ≤ 60 m² and ≤ 1 storey / ≤ 4.5 m / shed-like) and buildings that are the wall itself
  (ruins / towers mostly inside the band) step aside (`owned`). Towers shrink once or are skipped. A verify pass
  rebuilds a run until no band point is in a building; the bake reports `check.overlapMetres` / `check.overlapCount`
  (target 0).
- **Roads**: carriageways (full width), rail / tram beds and divided-road medians are obstacles like buildings; the
  coarse supplement traces are snapped to the land side of major roads within 40 m first (the sea walls stand
  behind the coastal avenues built on fill). The check reports `check.roadMetres` (target 0).
- **Rules not yet done**: road gates at mapped gates need gaps < 10 m, and the mapped road openings at the land-wall
  gates are 11+ m (breaches instead); OSM trees are not kept out of the walls.

