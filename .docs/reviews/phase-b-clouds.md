# Review: clouds (`src/render/clouds`)

Phase 01 review, 2026-09-26, headless only. Files read: `index.ts`, `cloud-pass.ts`, `shadow-map.ts`,
`city-glow.ts`, `config.ts`, `textures.ts` (sizes), `glsl/passes.glsl.ts` (structure only).

## Bug

- None found in the host code: the history resets on camera jumps (350 m) and on real quality-level changes only,
  low-res targets are allocated for the largest drawing buffer (dynamic resolution never reallocates), the shadow map
  bakes in slices after a complete first bake, and dispose releases every target and material.

## Phase A items (need owner GPU check)

1. Dashed lines along distant coastlines seen through cloud gaps: most likely the depth-aware upsample of the 1/3
   resolution march buffer against full-resolution scene depth at thin far land / sea edges. Needs screenshots at
   `?view=yuksek` and `?view=camlica` with the `?clouddebug=` views before touching the shader.
2. Speckled horizon band at twilight: blue-noise jitter the temporal pass cannot converge where the cloud radiance
   changes fastest (low sun, long rays). Needs a GPU check at `t=19.2` and `t=6.4`.

## Budget

- Five full-screen draws per frame (ambient 1x1, march, temporal, composite, one shadow-map slice). Quality 2 on
  "high" marches 800x450 (1/3 of 2400x1350), 88 steps, 4 light steps; about 39 MB of textures and targets.
- GPU cost is unknown without a GPU: owner to run `?cloudprof=1` / the `benchmark()` handle at the four probe views.

## Cleanup

- Debug handles (`probe`, `rawAverage`, `findCloud`) allocate, but only when called from the console. No action.
