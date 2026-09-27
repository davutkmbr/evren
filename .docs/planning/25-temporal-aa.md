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

TAA runs on the HDR scene colour, after the scene render and **before** the HDR passes. Clouds keep their own temporal
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
