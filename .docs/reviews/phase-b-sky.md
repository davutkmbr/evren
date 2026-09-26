# Review: sky (`src/render/sky`)

Phase 01 review, 2026-09-26, headless only (no GPU). Files read: `index.ts`, `globals.ts`, `environment.ts`,
`key-light.ts`, `cascaded-shadow.ts`, `sky-dome.ts`, `stars.ts`, `luts.ts`, `astronomy.ts`, `wind.ts`,
`shaders/atmosphere.glsl.ts`. Budget numbers: `npx tsx tools/headless/scene-budget.ts --only=sky,city`.

## Bug

1. **Atmosphere globals could still register late (fixed).** The `void import('../sky/globals')` from the plan was
   already gone, but when `core/uniforms` is the first module of the cycle `core/uniforms -> render/shaders ->
   atmosphere.glsl -> sky/globals` (the engine imports it first), `globalUniforms` is not initialised yet and the
   registration fell back to a microtask. Headless this left `uSkyViewLUT`, `uAtmoState`, `uCloudShadowMap`...
   missing for all synchronous code after the imports. Now `core/uniforms` calls `registerAtmosphereGlobals()` at the
   end of its own evaluation (TDZ-safe, idempotent), so both import orders register synchronously.
   `scene-budget.ts` asserts it on every run.
2. **Quality change during an amortised environment update (fixed).** `SkyEnvironment.setCubeSize()` replaced the
   cube target while a capture was waiting for its filter step; the next `step()` PMREM-filtered the new, empty cube
   (a black environment for one refresh). The stage is reset now.
3. **Below sea level (code verified, needs owner GPU check).** `atmoRayOrigin()` clamps the aerial-perspective ray
   origin to `y >= 0` and the sky-view LUT altitude is clamped to 1 m, so the teal breakdown has no remaining code
   path in the sky shaders; confirm visually (dive with POV and chase camera).

## Budget

1. **Shadow cascades draw casters that cannot shade anything (fixed).** Each cascade frustum now knows the lowest
   receiver of its view slice (`minReceiverY`, 0 when the mirrored reflection view can sample it); a caster wholly
   below it is skipped (sun above the horizon: its shadow falls below itself). Objects whose bounding sphere
   overstates their height can opt in with `userData.shadowTop` (city chunks do). Effect at 140-150 m flight
   altitude: city shadow triangles -12 % (Karaköy 346k -> 304k) and -14 % (Kadıköy 771k -> 666k), all from cascade 0.
2. The 4096² atlas re-renders all four cascades every frame, moonlight included. Needs owner GPU check
   (`?postprof=scene` with/without shadows) before trying a lower cascade-3 cadence.

## Contract

- `EnvironmentState.humidity` is now provided (poyraz ~0.6, lodos ~0.85, dawn bump, fog / rain), smoothed like the
  haze.

## Cleanup

- Per-frame work allocates nothing; the 4 Hz probe readback allocates one closure (`every`). No action.
- Lifecycle is complete (quality listener, render hook restore, targets, PMREM, placeholder LUT restore).
