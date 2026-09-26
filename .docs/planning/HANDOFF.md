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
- Not ours, never commit: `scripts/blender/*`. Scratch, never commit: `data/osm/fatih-scratch.json`.

## Next, in order (agreed with the owner)

1. Recompile all 28 spots in format 1.2 (`npm run compile:world -- --area <id> --landmarks none --web`).
2. Fatih as one OSM region + compiled tiles (data from the local extract, not Overpass).
3. Generic performance: hierarchical LOD / screen-space-error budgets (regions add +1–1.4 GB heap with 8 loaded and
   +4–7 ms near Kadıköy — over budget; lower `MAX_LOADED`, drop base raster copy, merge far regions).
4. OSM feature kits first batch (pitches, pools, bus stops, fuel stations) — extend the fetch to keep those tags.
5. Small open items: bridge joints re-refined when later regions load (`structure-system.ts`); Haydarpaşa port and
   Hazine Kapısı as landmarks; generic "no vehicles on water" rule in life traffic; street layer test rerun on a quiet
   machine (`node scripts/street-layer-test.mjs`); street-layer-test gpu scenario errors with `THREE.Color: Unknown color kiremit` (find the named colour and
   map it); flip/pass/gpu need a rerun on a quiet machine; sea flicker (not reproduced — needs the owner's view/time/weather).

## Working notes

- Machine gets overloaded with >3 agents (load 40–90); screenshots go through one GPU queue (`scripts/snap.mjs`).
- Before bulk fan-out, pick the tool that fits the scale (local extract, parallel compiler).
- Commit per area; verify HEAD in an isolated `git worktree` typecheck before pushing; when merging the cloud branch,
  stash only overlapping dirty files and pop afterwards.
