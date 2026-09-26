# Handoff — state on 2026-09-26 evening

Written so another session can continue if this one stops. Everything finished is committed and pushed (main,
last known commit 4f78c6e plus later merges of the cloud branch `claude/confident-bohr-wh5qqg`, which the owner merges
as PRs). Rules: CLAUDE.md; every defect gets a generic rule (compiler + runtime), never a coordinate patch.

## Done today (committed)

- Street layer (compiled close-range tiles) on by default at 28 landing spots (`?street=0` off); hitch work; web
  profile (WebP, gzip, shared textures) — `src/street`, `src/world/street`, `tools/world-compiler`.
- 26 landing spots compiled (`tools/world-compiler/districts/landing-spots.json`); compiled output `public/world/` is
  gitignored (not on GitHub; publishing it is an open question).
- Placement stand rule, tram tracks/beds, bridge joints fitted to OSM, city/mosque colliders, walk test for any area.
- Parallel + per-stage cached world compiler (`--jobs`, `--check`, `--cache`); Fatih-size compile ~13.6 min under
  load, est. 6.5–10 min idle.
- OSM regions: real-OSM flight-scale surroundings (46 regions, 1.2 km around each spot) — `src/world/osm/regions.*`,
  `scripts/data/osm-regions.mjs`, `public/data/osm/regions`; `?osmregions=0` A/B switch.
- Local OSM backend: Geofabrik Turkey extract in gitignored `data/osm-src/` (`node scripts/data/osm-extract.mjs
  download|index`); all fetch scripts default to `--source local` (minutes instead of hours on Overpass).
- City walls kit (5 quality passes, approved CC0 textures), wall data with the approved OHM supplement; plan
  `.docs/planning/22-city-walls.md`. Plan `.docs/planning/23-osm-feature-kits.md`.

## In progress when this was written (uncommitted, in the working tree)

1. **Façade modules** and **compiler speed round 2**: finished and committed (07a8595). Façade variety is now slots +
   a shared module library (`public/world/_shared/modules`); LOD0 per landing −37…−56 %. Only karakoy, eminonu, balat,
   galata-kulesi and kadikoy are compiled in the new format 1.2 — recompile the rest.
2. **City walls placement** (just started): offline bake `compile:walls` separate from `cli.ts`, runtime streaming
   system in `src/world/landmarks/walls/system/`, follow `.docs/planning/22-city-walls.md` steps 1–9.
   **Owner report (live game): walls currently pass through buildings.** Fix generically first: no wall piece may
   intersect any building (OSM slice/regions, compiled tiles, procedural city); end `flush` against buildings on the
   line, small sheds/annexes step aside, larger buildings break the wall (thresholds + counts); procedural city keeps
   out of the wall corridor; towers never inside buildings; an overlap check per stretch with target 0.
   **Progress (walls agent, uncommitted):**
   - Bake: `npm run compile:walls` (`tools/world-compiler/src/walls/{cli,plan,build,poly}.ts`, ~10 s) → gitignored
     `public/world/walls/` (index.json with `owned`, colliders.json, lod0/ per 100 m tile, lod1/ per 1 km cell,
     lod2.bin.gz; container format `src/world/landmarks/walls/data/baked.ts`) + checked-in land-use corridors
     `src/world/landmarks/walls/data/corridors.json` (read by `src/world/geo/prepare.ts` as reserved lines).
   - Runtime: `src/world/landmarks/walls/system/` (registered in `src/main.ts`; `?walls=0` off): LOD2 and LOD1 as
     BatchedMesh, LOD0 tiles streamed; colliders `city-wall:<id>` (tag heritage); `owned.ts` = ids the OSM building
     layer (`src/world/osm/buildings/index.ts`, awaited in `src/world/osm/index.ts`) and the street compiler
     (`tools/world-compiler/src/osm-street.ts`) skip. Runtime OSM `barriers.ts` city-wall beams removed.
   - Buildings (owner report): `tools/world-compiler/src/walls/{buildings,fit}.ts` read all 93k footprints (slice,
     regions, street-area data); the wall is shifted (≤3 m) / thinned (≥1.6 m) to keep 0.35 m off buildings, breaks
     flush where a building stands on the line, small sheds (≤25 m², or ≤60 m² and low) and wall-ruin buildings step
     aside (ids join `owned`), towers shrink or are skipped; a verify pass rebuilds a run until no band point is in a
     building; `check.overlap*` in the bake log / index stats = 0 m, 0 overlaps (2026-09-26). Corridors grow 9 m past
     the faces (procedural city lots sample the 11.7 m land-use grid).
   - Done: shots at 300 m / 80 m / eye level for 7 stretches (`.shots/walls/ingame/`), top-down debug maps
     (`.shots/walls/debug/`, input lines by source, openings, placed pieces: positions match the real course — the
     owner's "wrong place" report was the aqueduct), walk-test --dragon kumkapi (0 phantoms, no city-wall collider
     blocks a street), perf (`.shots/walls/perf/`: +7 draw calls, +58k triangles at 300 m over the land walls, walls
     CPU < 0.01 ms), worktree typecheck clean. Data issues left: OSM tags the Hippodrome sphendone (321386212) and two
     Dolmabahçe garden walls (castle_wall) as walls; mapped land-wall gate openings are 11+ m (breaches, no gate
     pieces); street lamps / OSM trees are not kept out of the walls. Compiled street areas need a recompile to drop
     wall-owned buildings.
   - Roads (owner report: supplement walls stood in the Kennedy Cd median): carriageways (with their width + 0.5 m),
     rail / tram beds and the medians of divided major roads (< 35 m) are now obstacles like buildings (`buildings.ts`
     road quads, `fit.ts`); supplement (OHM) traces are snapped to the land side of major roads within 40 m before
     the fit (`plan.ts snapRoadside`, 7.2 km moved); where there is no room the wall breaks (Road opening, crumbled).
     Check now reports `check.roadMetres` = 0 (all stretches, OSM ones too). Placed 18.9 km (was 19.9; Golden Horn
     fragments 1.3 km, Marmara 5.5 km). Before / after: `.shots/walls/debug/kennedy-*`.
3. **Bozdoğan Kemeri not visible** (owner report): the aqueduct landmark (`bozdogan-kemeri`) does not show over
   Atatürk Bulvarı; earlier its arches ran through buildings. Work in progress (uncommitted): landmark claims
   (`src/world/landmarks/claims.ts`, `claim-shapes.ts`, `visible-ground.ts`, `heritage/build/sites/aqueduct.ts`,
   `heritage/data/crossings.json`, `scripts/data/landmark-crossings.ts`, `src/world/osm/shared/landmark-passages.ts`,
   edits in `src/world/osm/{buildings,details,index.ts}`, `geo/*`, `site-planner.ts`). Goal: every hand-made landmark
   renders inside OSM regions and street-layer areas, buildings inside a landmark footprint are skipped, roads pass
   under arches; per-landmark visibility audit. Bisect with `?osmregions=0` / `?street=0`.
   **Done (ce05db7):** the aqueduct had no builder at all; now modelled + generic landmark ground claims. Follow-ups:
   the aqueduct material reads flat grey/plastic — reuse the city-wall kit's stone/brick material and weathering;
   11 heritage landmarks still have no builder (Topkapı, Dolmabahçe, Çırağan, Rumeli/Anadolu Hisarı, Yedikule,
   Haydarpaşa, Selimiye, Kuleli, Sirkeci, Hipodrom) — their OSM buildings show instead; model them one by one.
   **Done (cloud session, PR #30):** all 11 have site builders (`heritage/build/sites/*`, checked by
   `tools/headless/heritage-sites-check.ts`); Topkapı from the shipped OSM footprints (`scripts/data/heritage-footprints.ts`
   → `heritage/data/topkapi.ts`); Yedikule / Anadolu Hisarı draw only their towers / keep, the walls bake leaves those
   spots free (`HERITAGE_FORTRESS_TOWERS`); the aqueduct and the fortresses use the city-wall material
   (`WALL_MATERIAL_SITES`). Anadolu Hisarı's landmark point moved onto the keep. Needs an in-game look (proportions,
   Dolmabahçe / Selimiye claim discs dropping neighbouring OSM buildings).
4. **Perches** (owner report): many perch points are hidden by trees and have bad camera angles. Rule: perches only on
   elevated structures (Galata Tower, bridge towers, Kız Kulesi, Beyazıt/Çamlıca towers, wall towers), never ground or
   bare hilltops; clear the tallest neighbour within ~40 m; perch camera frames the dragon in the lower third against
   an unobstructed view, occluders fade. Audit shots in `.shots/perches/audit/`. Files: `src/world/perches/*`,
   `src/dragon/flight/perch.ts`, `src/ui/perch-*` (the cloud session also edits perch code).
   **Stopped mid-work (2026-09-26 ~20:00):** the unfinished work is on branch `wip/perches` (eb7bdfa, pushed; not on
   main): `src/world/perches/rules.ts` (new), perch data/resolve/service/index, `src/camera/modes/perch-rig.ts`,
   `src/ui/menu/places.ts`, `scripts/perch-audit.mjs` + `scripts/lib/perch-measure.mjs`, headless perch checks.
   Before shots in `.shots/perches/audit/before`. Continue: `git merge wip/perches` into main (or cherry-pick),
   rerun the audit (`node scripts/perch-audit.mjs`), finish the camera composition and occluder fade, verify shots.
   **Done (cloud session, PR #30):** view-cone and front-only own-structure rules; occluder fade
   (`src/core/occluder-fade.ts`); city-wall tower perches picked by rule from the walls bake (`perches/walls.ts`,
   `walls/data/towers.json`); no tree grows over a perch (`perches/clearings.ts`). Not perches (documented in
   `perches/data.ts`): tower galleries / terraces, Beyazıt and Çamlıca Kulesi (the dragon's rig does not fit).
5. Owner wants bigger race payoffs from chains (15–25 %, felt bursts, perceived-speed effects) — given to the cloud
   session as a prompt; not ours.
- Not ours, never commit: `scripts/blender/*`. Scratch, never commit: `data/osm/fatih-scratch.json`.

## Next, in order (agreed with the owner)

1. Recompile all 28 spots in format 1.2 (`npm run compile:world -- --area <id> --landmarks none --web`).
2. Fatih as one OSM region + compiled tiles (data from the local extract, not Overpass).
3. Generic performance: hierarchical LOD / screen-space-error budgets (regions add +1–1.4 GB heap with 8 loaded and
   +4–7 ms near Kadıköy — over budget; lower `MAX_LOADED`, drop base raster copy, merge far regions).
4. OSM feature kits first batch (pitches, pools, bus stops, fuel stations) — extend the fetch to keep those tags.
5. Small open items: Haydarpaşa port and Hazine Kapısı as landmarks (Hazine Kapısı is now part of the Dolmabahçe
   model; "port" unclear — ask); street layer test rerun on a quiet machine (`node scripts/street-layer-test.mjs`);
   flip/pass/gpu need a rerun on a quiet machine; sea flicker (not reproduced — needs the owner's view/time/weather).
   **Done (cloud session, PR #30):** bridge joints re-refined when later regions start drawing; no vehicles on the
   water (`tools/headless/traffic-water-check.ts`); OSM colour tags incl. Turkish words (`osm/shared/colour.ts`, fixes
   `Unknown color kiremit`).
   Items 1–4 overlap the map session's phase 24 work (far OSM layer, re-fetched regions, one building rule): wait
   for its merge before recompiling the spots or extending the fetch.

## Working notes

- Machine gets overloaded with >3 agents (load 40–90); screenshots go through one GPU queue (`scripts/snap.mjs`).
- Before bulk fan-out, pick the tool that fits the scale (local extract, parallel compiler).
- Commit per area; verify HEAD in an isolated `git worktree` typecheck before pushing; when merging the cloud branch,
  stash only overlapping dirty files and pop afterwards.
- 2026-09-26 landmarks agent (uncommitted): Bozdoğan Kemeri was never built (the heritage `SITE_BUILDERS` held only Beylerbeyi) → new aqueduct builder (`heritage/build/sites/aqueduct.ts`, arches centred on OSM crossings from `scripts/data/landmark-crossings.ts` → `heritage/data/crossings.json`), anchors from the OSM way 23276526; generic landmark ground claims (`src/world/landmarks/claims.ts`: only modelled landmarks claim ground, line bodies drop touching OSM buildings, infill/trees/props respect them), OSM `building_passage` pieces under a line landmark become ground roads (`osm/shared/landmark-passages.ts`), heritage sites sample the visible (OSM) ground. 12 heritage landmarks still have no builder (OSM buildings now show there instead of empty pads). Shots: `.shots/landmarks/bozdogan/after-*`.
