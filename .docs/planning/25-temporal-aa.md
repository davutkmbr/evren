# Phase 25 — Temporal antialiasing (TAA)

Milestone: C · Visual quality · Effort: M–L · Depends on: the flicker audit (`scripts/flicker-audit.mjs`,
[flicker-audit.md](flicker-audit.md))

## Problem

The flicker audit fixed every cause that had a single source (mirror NaN, light splats, window cells, sharpening).
What is left is sub-pixel geometry: roof and facade edges, props, parked cars and distant window rows a pixel wide.
Measured after PR #72 (per mille of unstable pixel-frames, land): 0.42 at night (Rumeli Hisarı), 0.89 by day
(peninsula), 1.08–1.28 in fly-throughs. MSAA 2x + SMAA are spatial only: each frame samples the same pixel centres, so
a feature that falls between them blinks as the camera moves. `aa=fxaa` cut the day land score by 75 % by blurring,
which shows how much of the remaining flicker a temporal resolve can remove without the blur.

## Goal

- Remaining land flicker at least 60 % lower in every audit scene, sea flicker not higher.
- No visible ghosting on the dragon, traffic, boats, rain and particles (a new ghosting metric, below).
- Photo mode converges to a supersampled image while the camera is still.
- Frame cost at most +0.8 ms at 1600x900 on the reference machine (M2 Max), paid back where possible by MSAA 2x
  going off.

## Starting point (read in the code)

- WebGL 2 (`WebGLRenderer`, three r186, reversed-Z float depth). three's WebGL `TAARenderPass` only accumulates a still
  camera; the reprojecting `TRAANode` / `TAAUNode` are WebGPU/TSL only. We write our own pass, using `TRAANode` +
  `TAAUtils` (same package, `node_modules/three/examples/jsm/tsl/`) as the reference implementation.
- `PostPipeline.render` (`src/render/post/pipeline.ts`): scene into `sceneTarget` (HDR, MSAA 2x on high, depth
  texture) → HDR passes by order (clouds 100 with their own temporal reprojection and Halton jitter, weather 110,
  fx-particles 150, race rings 160) → bloom / exposure / flare / composite / AA (SMAA or FXAA) / output.
- Dynamic resolution changes the internal size in steps; the output pass upscales with Catmull-Rom.
- Moving things the camera alone cannot reproject: the dragon and rider (skinned, and in the chase camera they move
  *with* the camera), OSM and procedural traffic (BatchedMesh / instanced, matrices in textures), vessels, crowd,
  vertex-animated water and foliage wind, flags.

## Design

### 1. Where the pass sits

TAA runs on the HDR scene colour after the scene render and the clouds (HDR passes up to order 105) and **before** weather and particles (see the stage 1 result). Clouds keep their own temporal
path, and rain / particles / race rings are drawn after TAA, so they never ghost. Bloom, exposure metering, flare and
the output pass read the resolved image. SMAA / FXAA are skipped while TAA is on; MSAA drops to off (TRAANode requires
this too: the resolve needs the per-pixel jittered samples, and it saves 1–1.7 ms at 2x on high).

### 2. Jitter

A Halton(2, 3) sequence of 8 sub-pixel offsets, applied to the projection matrix (`camera.setViewOffset` semantics,
at the internal resolution) for the scene render only. The water mirror, the shadow cascades and the clouds' own
march keep unjittered matrices (the mirror copies the main camera: it must take the matrices before jitter). Screen-space
effects that read the scene depth (composite fog, flare occlusion) see a sub-pixel shift, which is below their
resolution.

### 3. Motion

- **Camera reprojection** for everything static: the resolve reconstructs the world position from depth and projects it
  with the previous view-projection (no velocity buffer needed for the world, which is almost every pixel).
- **Velocity only where it pays**: a small velocity target written by a second, velocity-only draw of the dragon, the
  rider and the nearest traffic (previous model and bone matrices kept per object). The chase camera moves with the
  dragon, so camera reprojection alone would smear it every frame; it is also the object the player looks at.
- **Reactive mask** for the rest of the moving things (traffic beyond the velocity radius, vessels, crowd, flags,
  foliage wind): their materials write 1 into a mask channel, and the resolve lowers the history weight there
  (the approach of FSR 2's reactive / transparency masks). Water gets a fixed, lower history weight: waves move
  slowly, and the neighbourhood clip handles the glitter.

### 4. Resolve (one full-screen pass)

Following Karis 2014 and TRAANode: closest depth in the 3x3 neighbourhood picks the motion vector; history sampled with
Catmull-Rom; previous-depth disocclusion test (history invalid where the reprojected depth disagrees); variance
clipping in YCoCg (Salvi 2016, gamma ~1) against the current 3x3 neighbourhood; luma-weighted blend (flicker
reduction) with a current-frame weight of ~0.1, raised by velocity length, the reactive mask and disocclusion.
Non-finite inputs are rejected with the bit-level test (flicker audit, cause 1), so one bad pixel never enters the
history. Two RGBA16F history targets (ping-pong) plus the previous depth.

### 5. Resets and resolution changes

History is dropped on teleports, camera cuts (camera system snaps, cinematic shot changes, perch cameras), quality
changes and resizes. A dynamic-resolution step resamples the history (bilinear) instead of dropping it. The shared
`uFrame` drives the jitter index so screenshots and the audit stay deterministic.

### 6. Sharpening

TAA softens slightly. After the resolve, CAS may come back at a low strength (0.1–0.2): with a temporally stable input
it no longer amplifies aliasing. The flicker audit decides the value.

### 7. Switches and presets

`?taa=0|1`; `low` keeps FXAA without TAA (its GPUs pay for the extra targets); `medium`, `high` and `ultra` use TAA with
MSAA off. The settings menu gets no new control in this phase.

## Stages

1. **Static-world TAA** — jitter, history, camera reprojection, variance clipping, resets, `?taa=`. Accept: the flicker
   audit's yaw-sweep scenes −60 % land flicker, still-camera noise ≤ 0.05 per mille after 16 frames, no new
   console errors.
2. **Dragon velocity** — velocity-only draw of the dragon and rider. Accept: the ghosting metric (below) on
   `dragon-chase` at most 20 % above `?taa=0`.
3. **Reactive mask** for traffic, vessels, crowd, flags, foliage; water weight. Accept: ghosting metric on
   `traffic-night` and `harbour` scenes; sea flicker not above today's values.
4. **Presets, MSAA off, CAS retune, perf** — `snap.mjs --perf` before / after on the audit scenes. Accept: ≤ +0.8 ms
   net on high.
5. *(Later, separate phase)* **Temporal upscaling** (TAAU): with the history in place, dynamic resolution can render
   at a lower internal size and resolve to display size (the `TAAUNode` approach), which would pay for TAA many times.

## Stage 1 result (2026-09-27, `?taa=1`, opt-in)

`src/render/post/taa.ts`, wired in `post/pipeline.ts`. Flicker audit, all / land per mille, `taa=0` → `taa=1`:

| scene | all | land |
|---|---|---|
| `night-hisar` | 0.20 → 0.05 | 0.42 → 0.07 |
| `night-hisar-fly` | 0.23 → 0.07 | 0.48 → 0.13 |
| `peninsula-day` | 0.05 → 0.01 | 0.93 → 0.16 |
| `peninsula-photo` | 0.05 → 0.02 | 0.21 → 0.05 |
| `sea-dusk` | 0.14 → 0.07 | 0.71 → 0.24 |
| `peninsula-day-fly` | 0.05 → 0.01 | 1.23 → 0.14 |

Still camera: 0.01 (noise floor). Frame time at `?view=bogaz&t=16&dynres=0`: 20.9 → 18.4 ms (MSAA off pays for the
resolve). Two corrections to the design found by the audit:

- **Disocclusion by range, not by surface.** Comparing the stored distance with one reprojected surface (TRAANode's
  approach, 2 % tolerance) rejected static pixels of distant, grazing ground every frame (still camera 6 per mille);
  the history is now valid when its distance lies within the current 3x3 neighbourhood's distances as the previous
  camera sees them.
- **After the clouds, not before all HDR passes.** The clouds composite over the scene by its (jittered) depth: their
  mask along the skyline flipped with the jitter over a resolved image. The resolve now runs after the passes up to
  order 105 (clouds 100) and before weather and particles.

Not in stage 1: moving objects (the dragon ghosts in the chase camera; stage 2), which is why TAA stays opt-in.

## Stage 2 result (2026-09-27, still opt-in)

`src/render/post/velocity.ts` (velocity-only draw of the meshes under `core/motion.ts` roots: previous model, bone and
bind matrices), registered by the flight system for the dragon and its rider; the resolve takes the velocity of the
closest sample. Measured with the new `dragon-chase` scene: the dragon is carried with the camera
(`flicker-audit.mjs --carry dragon`) while the world moves past, compared frame by frame with the MSAA + SMAA image of
the same run (`scripts/lib/ghost-metric.py`: mean luma difference within 8 px of the dragon / elsewhere):

| | near the dragon | elsewhere | ratio |
|---|---|---|---|
| `taa=1&taavel=0` (stage 1) | 4.22 | 2.75 | 1.54 |
| `taa=1` (stage 2) | 3.56 | 2.75 | 1.29 |

Without velocity the dragon's edges are stair-stepped and the far wing tip leaves a trail; with it the dragon matches
the reference (`.shots/flicker/dragon-chase/dragon-030.png`). Land flicker in that scene 2.03 → 1.34 per mille; the
static scenes are unchanged; the velocity draw costs less than the timing noise (±0.8 ms).

Found on the way: three's bone matrices are world-space and `bindMatrixInverse` follows the mesh every frame, so the
previous skinned position needs the previous `bindMatrixInverse` (with the current one, motion counted twice). The
disocclusion test of object pixels compares the history with the distance the velocity pass reports for the previous
frame, and falls back to the static range test (silhouette pixels take the object's motion but may show background).

Left for stage 3: wing-membrane flutter is not in the velocity (thin strips of the membrane fall back to the current
frame), traffic, vessels and other movers still use camera reprojection.

## Stage 3 status (2026-09-27, done, opt-in)

Reactive mask: traffic (OSM and procedural), crowd, birds and dolphins register with `trackReactive`
(`core/motion.ts`); `post/velocity.ts` draws them once more with their own materials into a depth mask (the scene's
child list swapped for the lights and the reactive roots: 0.21 ms CPU instead of 0.9 ms for a full scene walk); the
resolve raises the current-frame weight to 0.25 there. `?taareact=0` for A/B. Vessels stay on camera reprojection: they
are slow and come out clean, while the mask made ferries aliased. Pedestrians on the quays, which the plain resolve
erased, stay visible with the mask.

Tuning (`--animate`, 48 frames after warm-up; land flicker in per mille, ghosting = `ghost-metric.py` ratio near the
cars against the no-TAA run, `traffic-night` now looks up Barbaros Bulvarı from 45 m):

| reactive weight | harbour land | traffic-night land | traffic-night ghosting |
|---|---|---|---|
| no mask (`?taareact=0`) | 0.34 | 0.09 | 1.35 |
| 0.5 (first cut) | 0.62 | 0.08 | 1.36 |
| **0.25 (kept)** | **0.33** | **0.07** | **1.35** |
| 0.15, clip box x0.5 | 0.41 | 0.11 | – |
| 0.5, clip box x0.5 | 0.79 | 0.10 | – |

A weight of 0.5 made the masked pixels (quay crowd, cars) mostly the jittered current frame, which the audit counts as
flicker; 0.25 keeps them at the unmasked level with no measurable extra trail. A tighter variance clip on masked
pixels was worse in both scenes and was dropped.

## Stage 4 result (2026-09-27, on by default from medium)

`QualitySettings.taa`: on for medium, high and ultra (MSAA and the spatial AA pass off there), off for low; `?taa=0`
still switches it off. Sharpening stays off under TAA.

Performance (`snap.mjs --perf`, 1600x900, `?dynres=0`, fps, two runs each; medium is at the 60 fps cap either way):

| view (high) | TAA off (MSAA 2x + SMAA) | TAA on |
|---|---|---|
| galata t=15 | 22.7* / 43.6 | 47.2 / 41.2 |
| bogaz t=21 | 44.7 / 39.7 | 45.0 / 46.4 |
| sultanahmet t=16 | 44.3 / 54.3 | 46.9 / 57.1 |

(*first run of the batch, still warming up.) TAA costs nothing net on high: the resolve and velocity passes are paid
for by dropping MSAA and SMAA. Acceptance (<= +0.8 ms) met.

CAS sweep (flicker audit, land per mille, still camera yaw sweep):

| scene | TAA off | TAA | TAA + sharpen 0.2 | TAA + sharpen 0.35 |
|---|---|---|---|---|
| peninsula-day | 0.93 | **0.17** | 0.55 | 0.64 |
| night-hisar | 0.42 | **0.08** | 0.16 | 0.16 |

Sharpening brings back 2-3x the flicker TAA removed, for a small gain in crispness (`.shots/perf/cas-*`), so it stays
off. Next (separate phase): temporal upscaling (item 5 of the plan).

## Stage 5 (TAAU) result (2026-09-28, opt-in `?taau=<scale>`)

`?taau=0.67` (with TAA on) renders the scene at 0.67 x the dynamic-resolution size per axis; the TAA resolve writes
the history and its output at the **display** size, and everything after it (weather, fx particles, race rings, bloom,
exposure, flare, composite, output) runs there. Off by default. Implementation:

- **Resolve** (`post/taa.ts`, `TAAU` variant of the same shader): per output pixel the nearest jittered input sample
  (`floor(pIn - sampleOffset)`), its 3x3 neighbourhood for the clip box and the disocclusion range, velocity and
  reactive lookups at that sample. The current colour is a Gaussian-weighted sum of the 9 samples by their distance to
  the output pixel centre (`exp(-2.29 d^2)`, TAAUNode / FSR 2): distance in **output** pixels where the history is
  valid (sharp), in input pixels where it is not or where the pixel moves fast or belongs to a tracked object (smooth,
  no input-resolution stair steps). The still-camera current weight scales with the nearest sample's coverage of the
  output pixel (`0.1 x (0.3 + 1.4 exp(-2 d_out^2))`), so a pixel takes new information when a sample lands near its
  centre and keeps its history otherwise. The clip box is the neighbourhood's min / max instead of mean +- sigma:
  the variance box pulled the upscaled detail back to the input's blur (the first cut was visibly softer than a plain
  bilinear upscale).
- **Jitter**: Halton(2, 3) with `ceil(8 x (display / render)^2)` phases (FSR 2): 18 at 0.67, 32 at 0.5.
- **Pipeline** (`post/pipeline.ts`): internal size = display x dynres scale x taau; the passes up to order 105
  (clouds) run at the internal size (own `lowA/lowB` targets), the ones after the resolve at the display size
  (`pingA/pingB`, LDR, bloom). The passes after TAA read the internal-size depth by uv, except rain and lightning,
  which used `texelFetch(gl_FragCoord)`; they now scale the pixel by depth / output size (`uDepthScale`).
- **Mip bias**: `core/uniforms.ts` injects `texture2D(s, c) -> texture(s, c, uTexLodBias)` into every fragment shader
  that goes through the global uniform injection when the page has `?taau` (`?taalod=0` leaves it out); the pipeline
  sets `log2(render / display)` around the scene render only (mirror, shadows, bakes stay at 0). This covers three's
  built-in materials (dragon, landmark structures, street tiles). It does **not** reach the materials that sample
  their texture arrays with `texture()` / `textureGrad()` (OSM facades, terrain detail, streets, walls, trees): a
  global bias there needs a per-shader change (or a shared sampling helper), so it is left out. Visible effect at
  0.67 on the galata view: none measurable by eye (`.shots/taau/c4.png`, columns 2 and 3).

Performance (`snap.mjs --perf 8000`, 1600x900, `?fps=0&dynres=0&q=ultra`, fps; three runs, the third on a quieter GPU
queue; the scene is CPU-heavy, ~11-15 ms CPU per frame, so the GPU savings show only partly):

| view | TAA 1.0 | TAAU 0.67 | TAAU 0.5 |
|---|---|---|---|
| galata t=15 | 34.1 / 35.7 / 41.2 | 34.2 / 39.6 / 45.1 | 38.1 / 32.2 / 47.0 |
| bogaz t=21 | 37.0 / 35.0 / 38.8 | 36.1 / 40.0 / 42.6 | 39.9 / 38.5 / 45.4 |
| sultanahmet t=16 | 40.5 / 36.6 / 43.4 | 42.9 / 41.9 / 46.4 | 43.9 / 39.0 / 51.5 |

Run 3: +7-10 % at 0.67, +14-19 % at 0.5.

Flicker (flicker audit, per mille, all / land):

| scene | TAA 1.0 | TAAU 0.67 | TAAU 0.5 |
|---|---|---|---|
| peninsula-day | 0.01 / 0.17 | 0.01 / 0.13 | 0.01 / 0.19 |
| night-hisar | 0.05 / 0.08 | 0.03 / 0.06 | 0.05 / 0.05 (sea 0.13) |
| dragon-chase (fly) | 0.29 / 3.14 | 0.22 / 2.32 | 0.18 / 2.08 |

No flicker regression; TAAU is as stable as TAA at scale 1 (softer images flicker less).

Ghosting (`ghost-metric.py` on `dragon-chase` against `taa=0`, near the dragon / elsewhere / ratio): TAA 1.0 3.70 /
2.50 / 1.48, TAAU 0.67 6.76 / 4.32 / 1.56, TAAU 0.5 5.92 / 4.46 / 1.33. The absolute differences grow with the lost
resolution everywhere; the ratio (trail near the dragon) stays at the TAA level.

Quality (1:1 crops, `.shots/taau/`): still, TAAU 0.67 is clearly sharper than a plain 0.67 render upscaled with
Catmull-Rom (window grids and roof edges resolved) but softer than TAA at 1.0; 0.5 is soft but stable. In motion
(`m-dragon.png`, `m-land.png`) the water and the dragon lose fine detail; 0.5 looks like a low-resolution render.
Known artefacts:

- Sub-pixel movers (quay crowd, distant cars) fade at 0.67 and vanish at 0.5: they are rarely sampled and the reactive
  weight keeps little history.
- Fast-moving, deforming silhouettes (the wing trailing edge) show input-resolution steps for a frame or two where the
  history is rejected.
- Texture-array materials are not mip-biased (above), so facades and terrain stay at the render resolution's mip.

The owner decides on defaults. A likely next step: TAAU 0.75-0.85 as the dynamic-resolution floor on high / ultra,
where it replaces the plain upscale.

## Measurement

- The flicker audit already reprojects and scores; with TAA the scenes need a warm-up of 16+ frames (history) before
  the 48 captured ones, and the still-camera run becomes the noise floor check.
- **Ghosting metric** (new, in `flicker-audit.mjs`): chase-camera scenes with the simulation running (`--animate`);
  compare each TAA frame with a 16x supersampled reference of the same frame (the engine renders it by accumulating 16
  jittered frames of a frozen state) and report the mean error on pixels near moving objects. A trail shows as error
  behind the object, which blur alone does not produce.
- New scenes: `dragon-chase` (day, low over the sea), `traffic-night` (Beşiktaş coast road), `harbour` (Karaköy,
  vessels).

## Risks

- **Custom shaders everywhere**: jitter is only in the projection matrix, so every material follows; but shaders that
  derive screen positions themselves (point-sprite sizes, `gl_FragCoord` dithers: OSM fade, occluder fade, street
  holes) will jitter their pattern. The dithers are screen-door fades; TAA will smooth them (a gain), but their
  pattern must not be jitter-locked, or it will crawl. Check each in stage 1.
- **Water mirror and TAA**: the mirror renders before the scene; it must take the unjittered matrices, or reflections
  shimmer.
- **Skinned velocity cost**: a second skinned draw of the dragon; capped by drawing velocity for the dragon and rider
  only.
- **Memory**: +2 RGBA16F history targets and a depth copy at internal resolution (~26 MB at 1600x900), minus the MSAA
  renderbuffers.

## References

- B. Karis, "High Quality Temporal Supersampling", SIGGRAPH 2014 (Unreal Engine 4).
- M. Salvi, "An Excursion in Temporal Supersampling", GDC 2016 (variance clipping).
- L. J. F. Pedersen, "Temporal Reprojection Anti-Aliasing in INSIDE", GDC 2016; github.com/playdeadgames/temporal.
- three.js r186 `examples/jsm/tsl/display/TRAANode.js`, `examples/jsm/tsl/utils/TAAUtils.js` (reference code).
- AMD FidelityFX Super Resolution 2: reactive and transparency & composition masks.
