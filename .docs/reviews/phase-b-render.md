# Review: render (`src/render/post`, `src/render/weather`, `src/render/shaders`)

Phase 01 review, 2026-09-26, headless only. Sky and clouds have their own reports (`phase-b-sky.md`,
`phase-b-clouds.md`). The underwater branch of the post composite is out of scope (water owner). Files read:
`post/pipeline.ts`, `post/options.ts`, `post/targets.ts`, `weather/index.ts`, `shaders/index.ts`,
`shaders/atmosphere.glsl.ts`, `shaders/cloudshadow.glsl.ts`.

## Bug

- None found. The pipeline guards its rAF callback after dispose, unsubscribes quality / teleport / time listeners,
  skips frames with non-finite camera matrices instead of drawing black, rebuilds the scene target on MSAA or size
  changes and hands HdrPasses fresh inputs every frame.

## Phase A / contract items

- Every sampler declared in `SHARED_GLSL` (`uSkyViewLUT`, `uCloudShadowMap`) has a 1x1 default and is registered
  synchronously while the chunk loads (see `phase-b-sky.md`; asserted by `scene-budget.ts`). Done.
- HdrPass order ranges are documented in the contract (clouds 100, transparent effects 150-199). Done.
- "high" 2x MSAA and thin geometry: the structures wires carry their own phone-wire AA (`phase-b-structures.md`).
  Done in code, needs owner GPU check.

## Budget

- About 20 full-screen draws per frame (bloom chain down / up, metering, flare, composite, SMAA 3 passes, output).
- Render targets at the "high" internal size (1600x900 x DPR 1.5 = 2400x1350, scale 1): ~218 MB estimated, of which
  the 2x MSAA scene target with float depth is the largest part. Needs owner GPU check: frame cost of MSAA x2 at DPR
  1.5 vs. DPR 1.25 + the output CAS (visual trade-off, not changed).
- Weather: one HdrPass when fog / rain / storm / far blur is active, otherwise disabled.

## Cleanup

- Fixed: the weather update allocated its settings-key array every frame.
