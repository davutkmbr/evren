# Phase 01 — Review, bug fixing and performance

Milestone: A · Hardening · Effort: L · Depends on: none

## Goal

Close out the build that was cut short by usage limits: review and fix the unreviewed Phase B modules, resolve the
accumulated contract requests in one place, and relieve the scene, which currently runs at the GPU limit on "high".

## Current state

- Phase B modules (terrain, water, city, vegetation, mosques, structures, heritage, life) were stopped while polishing;
  `ui` finished. None of them has been reviewed.
- The second review round never ran for Phase A modules sky, dragon, fx, clouds and geo.
- Performance: 60 fps, but dynamic resolution sits at its floor (75%), the scene is 4–8 M triangles, 210–300 draw calls.

## Scope

### 1. Review and fix Phase B modules
Independent review per module (contract compliance, bugs, budget, visual quality from screenshots), then a fix pass:
terrain, water, city, vegetation, mosques, structures, heritage, life, ui.

### 2. Open items from Phase A
- **sky:** Atmosphere global uniforms are loaded with `void import('../sky/globals')`. On a loaded machine some shaders
  compile before the uniforms exist and fail on every draw. Switch to synchronous registration (post report).
- **sky:** The atmosphere breaks (everything turns teal) when the camera goes below sea level.
- **dragon:** The rider is still built from tubes and has no face. Material boundaries (palate, horn bases) are jagged at
  triangle resolution. In POV the snout is hidden; only the back of the skull shows.
- **fx:** Seen from behind (chase and POV) the fire reads as a fireball instead of a long flame jet. Wing-tip trails draw in front of smoke.
- **clouds:** Dashed lines along distant coastlines seen through cloud gaps. Speckled horizon band at twilight.
- **audio:** No human has listened to the sounds yet; `.shots/audio/*.wav` must be listened to and tuned.
  POV wind is 3.7 LU louder than third person.
- **flight:** Landing takes 15–23 s; shorten it for the chill feel. Hover controls are complicated. In wind, a 60° turn
  loses about 60 m of altitude in 20 s.
- **post:** "high" uses 2x MSAA; 0.12 m bridge hangers break into dashes at 500 m. Needs phone-wire AA for thin geometry (structures).
- **water:** Stair-stepping in reflections was partly fixed (filtered depth and sky coverage); a residue from the reflection resolution remains.

### 3. Bugs reported by the user
- **Cars float in the air on bridges.** Cause: `src/world/life/traffic/road-network.ts` does not read bridge heights
  from the bridge module; it uses a hard-coded `BRIDGE_DECKS` table plus an estimated ramp and camber curve. The bridge
  road polyline in geo is also not aligned with the deck line built by the structures module. Fix: the structures module
  publishes deck profiles through a service (`roadSurfaceAt(x, z)` or a height polyline + width per deck), and traffic
  uses only that, including approach viaducts. Check the Galata, Atatürk and Haliç bridges the same way.
- Verify cars sit on the ground on land roads as well (terrain height vs road surface within ±0.3 m).

### 4. Contract and core fixes (`src/core`)
- Add `DragonRig.dimensions.standHeight` to the contract (the rig already provides it; flight reads it via a cast).
- `ServiceRegistry.withdraw(key)`.
- `CollisionWorld.raycast(..., out?)` so the camera does not allocate every frame.
- `Engine.stats()` keeps the previous frame's `drawCalls/triangles`; the `?stats=1` overlay currently reads 0.
- A single owner for pointer lock (camera and UI both request it today).
- `VIEW_PRESETS.spawn` is labelled "Sarayburnu üzeri" but its coordinates are in Laleli–Aksaray; move the coordinates to Sarayburnu.
- View presets with a time (`gece`) should apply the time on page load (today only `__evren.view()` does).
- A default 1×1 texture for every sampler in SHARED_GLSL (sandboxes compile without sky and clouds).
- `AudioService.masterVolume` and `unlock()`; `GeoQuery.waterNameAt(x, z)`; `CameraRigState.shotLabel`;
  `EnvironmentState.humidity`; document HdrPass order ranges (clouds 100, transparent effects 150–199).
- `LandmarkDef.extent` for bridges, walls, the aqueduct and tower clusters (`radius` is now only a small disc).

### 5. Performance
- Triangle budget: LOD distances for city, vegetation and landmarks; impostors for far LODs.
- Reflection pass: confirm the NoReflection layer is used correctly (trees, small boats, particles); reflection camera far distance.
- GPU profiling: per-system GPU time table using EXT_disjoint_timer_query (requested in the post report).
- Target: 60 fps on "high" with dynamic resolution ≥ 90%.

## Technical approach

1. Core contract fixes first, by a single owner.
2. Workflow: review → fix (one round) for the 9 Phase B modules and 5 Phase A modules; then a performance agent.
3. Finally a visual QA pass over the full app: 10 views × day/night screenshots.

## Acceptance criteria

- `npx tsc --noEmit` clean; no console errors in 10 preset views via `snap.mjs`.
- "high" preset at 1600x900: `?view=spawn`, `galata`, `koprusu`, `gece&t=21.5` run at 60 fps with dynamic resolution ≥ 0.9.
- A review report for every Phase B module; all critical and major findings closed.
- No stair-stepping in reflections (bridge and night view screenshots).
- On all three Bosphorus bridges and the Golden Horn bridges, cars sit on the deck surface (±0.3 m), confirmed with close-up screenshots.
- Sound recordings listened to and levels approved (user sign-off).

## Risks

- Usage limits: 14 review + 14 fix agents are expensive. If needed, split into two sessions (Phase B first, then the Phase A leftovers).
- The performance work spans modules; a single performance agent touches all of them, so it runs last and never in parallel with module agents.

## Status

### Headless pass 2026-09-26 (sky, clouds, terrain, city, vegetation, mosques, structures, heritage, geo, render)

Done without a GPU (Node / tsx only); water, life, fx, dragon / flight, moments, audio and activities are handled by
other agents and are not covered here. Review reports: `.docs/reviews/phase-b-{sky,clouds,terrain,city,vegetation,
mosques,structures,heritage,geo,render}.md`. Budget tool: `npx tsx tools/headless/scene-budget.ts` (see below).

**1. Review and fix** — terrain, city, vegetation, mosques, structures, heritage: reviewed, bugs fixed (done); water,
life, ui: not in this pass.

**2. Open items from Phase A**

| item | status |
|---|---|
| sky: atmosphere globals loaded late | done: `core/uniforms` completes the registration synchronously in the cycle case (the microtask fallback left them missing for all synchronous code); asserted by `scene-budget.ts` |
| sky: teal atmosphere below sea level | done in code (ray origin clamped to y >= 0, LUT altitude >= 1 m); needs GPU check |
| clouds: dashed coastlines through gaps, speckled twilight band | needs GPU |
| post: thin geometry under 2x MSAA | done in code (phone-wire AA ribbons in `structures/render/wires.ts`); needs GPU check |
| dragon, fx, audio, flight, water | not in this pass |

**4. Contract and core fixes** (the parts owned by these modules)

| item | status |
|---|---|
| default 1x1 texture for every SHARED_GLSL sampler | done (verified) |
| `EnvironmentState.humidity` | done: provided by the sky (poyraz ~0.6, lodos ~0.85, dawn, fog / rain) |
| HdrPass order ranges documented | done (contract) |
| `GeoQuery.waterNameAt` | done (verified) |
| `LandmarkDef.extent` | open: filling it broke `races-check`, which treats extent as a solid cylinder; semantics need the contract owner |
| other core items (standHeight, withdraw, raycast out, stats, pointer lock, presets) | not in this pass |

**5. Performance**

| item | status |
|---|---|
| LOD distances / impostors | partly done: neighbourhood mosque LOD2 ends with the city (10.6 km), far-band mosque reflections off, impostor chunk 64 -> 16; city far tiles, L0 shadows and L1 reflections: proposals in `phase-b-city.md` (need GPU judgement) |
| shadow caster culling | done: cascades skip casters below their lowest receiver; city chunks publish their real top (`userData.shadowTop`) |
| reflection NoReflection use | checked: trees, lamps, mosque LOD0 are NoReflection; the wire depth pass must stay in the mirror (coverage) |
| GPU profiling table (EXT_disjoint_timer_query) | needs GPU |
| 60 fps with dynamic resolution >= 0.9 | needs GPU |

Fixed bugs outside the plan list: city street lights dropped when the lamp pool was full (it grows now), structures
wire / light GPU buffers leaked on every rebuild, heritage duplicated sites after a partial worker failure, geo worker
errors between two awaits were lost (possible hang), a black environment after a cube-size change mid-update, and
per-frame allocations in the mosque LOD pass, city colliders and weather.

### Scene budget (headless)

`npx tsx tools/headless/scene-budget.ts [--only=city,terrain] [--views=karakoy] [--json=path]` builds the real geo,
terrain selection, city streamer + tile builder, vegetation placement + species, mosque / structure / heritage
generators and the sky classes in Node, and reports per module and probe camera the triangles and draw calls of the
main, shadow (4 cascades, estimated per view-distance slice) and planar-reflection passes, the module's per-frame CPU
time, program counts and texture / geometry memory. Targets ("high", the probed modules' share of a ~5 M triangle /
~220 draw frame): all passes <= 4 M triangles, main <= 2.5 M, <= 160 draws, <= 3 ms CPU.

Totals of the probed modules, before -> after this pass:

| view | main tris | shadow tris | reflection tris | all passes | draws | CPU |
|---|---|---|---|---|---|---|
| Karaköy 150 m | 2.04M -> 1.98M | 377k -> 329k | 1.29M -> 1.21M | 3.70M -> 3.52M | 137 -> 135 | 0.49 ms |
| Bosphorus (Bebek) 120 m | 954k -> 922k | 153k -> 149k | 597k -> 584k | 1.70M -> 1.65M | 141 | 0.25 ms |
| Kadıköy 140 m | 2.33M -> 2.25M | 808k -> 698k | 1.55M -> 1.41M | 4.69M -> **4.36M (over)** | 157 -> 154 | 0.16 ms |
| overview 2600 m | 1.53M -> 1.48M | 15k -> 14k | 675k -> 601k | 2.23M -> 2.10M | 101 | 0.07 ms |

Biggest offender: the city (2.4-3.1M of the 3.5-4.4M at the city views; far L2 tiles alone ~1M main triangles),
then terrain (~0.85M, same patch list in main and reflection), mosques (0.2M after the fix), structures (0.15M).
Headless the OSM regions are inactive, so the procedural city is also counted inside the OSM slice.

### Owner GPU checklist

1. Dive below the sea at `?view=kizkulesi` with the POV and chase cameras: no teal atmosphere, surface line clean.
2. Clouds at `?view=yuksek` and `?view=camlica`, day and `t=19.2`: dashed coastline lines through gaps, speckled
   horizon band.
3. `?view=koprusu` at 500 m from the Bosphorus bridge: hangers read as continuous faint lines (phone-wire AA).
4. Shadow height cull: fly at 100-200 m over Beyoğlu / Kadıköy at `t=10` and `t=17.5`; no shadows missing on the
   dragon, rooftops or streets near the camera; then land on a roof and check building shadows around it.
5. Night at `?view=galata&t=21.5` and `?q=ultra`: every street chunk lit (`__city.stats().lamps`), no dark squares.
6. Neighbourhood mosques from Karaköy / Kadıköy: no visible pop at ~10.6 km, no missing reflection close to the shore.
7. Far forests: impostor thinning looks unchanged after the chunk change (no seams, no flicker while streaming).
8. GPU timing per system (EXT_disjoint_timer_query, `?postprof=scene`, `?cloudprof=1`, `?terrainProf=1`) at the four
   probe views and `?view=spawn`, `galata`, `koprusu`, `gece&t=21.5`; confirm 60 fps with dynamic resolution >= 0.9.
9. Terrain sea-floor overdraw under the water surface (early-z vs. water draw order).
10. MSAA x2 at DPR 1.5 vs. DPR 1.25 + CAS on "high" (cost and look).
11. Decide on the city proposals in `phase-b-city.md` (far-tile cost, L0 shadow sub-ranges, L1 reflection classes)
    and on `LandmarkDef.extent` semantics.
