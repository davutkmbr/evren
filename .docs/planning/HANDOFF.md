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
