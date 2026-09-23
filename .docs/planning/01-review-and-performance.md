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
- View presets with a time (`gece`) should apply the time on page load (today only `__ejderha.view()` does).
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

1. Initial commit (the repository has no commits).
2. Core contract fixes first, by a single owner.
3. Workflow: review → fix (one round) for the 9 Phase B modules and 5 Phase A modules; then a performance agent.
4. Finally a visual QA pass over the full app: 10 views × day/night screenshots.

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
