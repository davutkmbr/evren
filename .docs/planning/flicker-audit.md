# Flicker audit

Owner report (2026-09-26, HANDOFF item 6): while the camera moves or turns, reflections on the sea come and go in
hard, screen-aligned light and dark patches (by day with the sun ahead and in the evening), and at night car lights
and city window lights go black for a moment and come back. PR #66 (angular mirror margin) did not fix the sea;
`?dynres=0` did not change the night lights.

## Tool

`scripts/flicker-audit.mjs` (usage in its header), scenes in `scripts/flicker-scenes.json`. It runs on the
`scripts/snap.mjs` infrastructure (GPU slot, shared dev server on port 5199) and serves any checkout's `src/` through
a shim page (`--worktree [dir]`), so before / after runs use the same server.

- The page runs with `?fps=0&freeze=1&nohud=1&grain=0`; the engine's rAF loop is stopped and frames are stepped by
  hand on a fixed 1/60 s clock, the camera placed with `__evren.shot()` every frame (yaw sweep or straight
  fly-through). `freeze=1` stops the simulation clock, so only the camera moves (`--animate` lets it run).
- Frames i-1 and i+1 are reprojected onto frame i: by the camera rotation (exact for a yaw sweep: a stable renderer
  draws every world point identically under a pure rotation), and for fly-throughs also by the translation through
  the frame's depth (16-bit log distance read from the scene target).
- A pixel is unstable when its luma lies more than 12/255 above the 3x3 maximum, or below the 3x3 minimum, of both
  reprojected neighbours: an up-down or down-up spike that neither sub-pixel edge motion nor resampling produces.
  A still camera scores 0.00-0.02 per mille (the tool's own noise).
- Score: `rate` = unstable pixel-frames per mille of pixel-frames, per region (sea = pixels whose depth changes when
  the water mesh is hidden, sky = no depth, land = the rest). Heatmaps: `.shots/flicker/<scene>/<run>/heat.png`
  (red to yellow = how often a pixel spiked; sea outlined in cyan).
- Tracing modes that found the causes below: `--blame N` (binary search over the scene's drawables for the object
  behind a spike), `--only` / `hide:` / `pass:` toggles, `--events` (per-frame visibility changes), `--mirror
  [lod|depth|bad]` (capture the water's planar reflection; `bad` counts non-finite texels and finds the object that
  writes them), `--pre` (shader probes).

Scenes (1280x720, 48 frames): `night-hisar` (Rumeli Hisarı, t=21, yaw 0.15 deg/frame), `night-hisar-fly` (same,
fly 1.5 m/frame), `peninsula-day` / `peninsula-photo` (historic peninsula from off Üsküdar, t=16, sun ahead; the
photo variant at fov 20 and 0.05 deg/frame), `sea-dusk` (slow turn over the sea, t=19), and the fly-throughs
`sea-dusk-fly`, `peninsula-day-fly`, `bosphorus-day-fly`, `seawalls-day-fly`.

## Bisection

Run on commit 720acf3 (the tool, before any fix), one toggle per run. Cells: sea / land unstable pixel-frames per
mille; **bold** where the toggle moves the value by more than 25 %. `sharpen=0` and `msaa=4` were run afterwards
for the two scenes where the antialiasing toggles mattered.

| toggle | `night-hisar` | `night-hisar-fly` | `peninsula-day` | `peninsula-photo` | `sea-dusk` |
|---|---|---|---|---|---|
| `baseline` | 0.08 / 0.88 | 2.91 / 0.88 | 0.04 / 2.08 | 0.01 / 0.4 | 0.22 / 1.71 |
| `wrefl=sky` | **0.03** / 0.89 | **0.04** / 0.89 | 0.04 / 2.05 | 0.01 / 0.39 | **0.01** / 1.61 |
| `dynres=0` | 0.08 / 0.87 | 2.92 / 0.88 | 0.04 / 2.05 | 0.01 / 0.4 | 0.22 / 1.7 |
| `osmfar=0` | 0.08 / 0.82 | **1.44** / 0.89 | 0.04 / 2.01 | 0.01 / 0.41 | **0.64** / 2.09 |
| `osmregions=0` | **0.02** / **0.6** | **0.02** / **0.52** | 0.04 / **1.55** | 0.01 / **0.21** | **0.12** / 2.08 |
| `street=0` | 0.08 / 0.87 | 2.93 / 0.88 | 0.04 / 2.06 | 0.01 / 0.41 | 0.22 / 1.69 |
| `traffic=0` | 0.08 / 0.79 | 2.91 / 0.81 | 0.04 / 2.09 | 0.01 / 0.4 | 0.22 / 1.7 |
| `walls=0` | **0.03** / 0.87 | 2.91 / 0.88 | 0.04 / 2.01 | 0.01 / 0.41 | **0.13** / 1.71 |
| `bloom=0` | 0.08 / 0.93 | 3.19 / 0.94 | 0.04 / 2.16 | 0.02 / 0.42 | 0.22 / 1.8 |
| `aa=none` | 0.08 / 0.8 | 2.93 / 0.76 | 0.04 / 2.24 | 0.01 / 0.39 | 0.21 / 1.43 |
| `aa=fxaa` | 0.07 / 0.73 | 3.03 / 0.75 | 0.02 / **0.53** | 0.01 / **0.1** | 0.22 / 1.58 |
| `aa=smaa` | 0.08 / 0.87 | 2.92 / 0.88 | 0.04 / 2.07 | 0.01 / 0.41 | 0.22 / 1.72 |
| `flare=0` | 0.08 / 0.87 | 2.91 / 0.88 | 0.04 / 2.08 | 0.01 / 0.41 | 0.22 / 1.69 |
| `shadows=0` | 0.08 / 0.91 | 2.92 / 0.89 | 0.04 / 2.14 | 0.01 / 0.42 | 0.22 / 1.7 |
| `wfade=0` | 0.08 / 0.87 | 2.93 / 0.88 | 0.04 / 2.08 | 0.01 / 0.41 | 0.22 / 1.71 |
| `sharpen=0` | 0.07 / 0.66 | – | 0.02 / **0.91** | – | – |
| `msaa=4` | 0.08 / 0.79 | – | 0.03 / **1.53** | – | – |

- Sea: only `wrefl=sky` (planar mirror off) removes the sea flicker, and `osmregions=0` in the fly-through (the
  mirror sees the regions' facades): cause 1. `wfade=0`, `dynres=0` and `shadows=0` change nothing, so the
  mirror's edge hand-over, dynamic resolution and the shadow cascades are not the cause.
- Night land: no single system switch removes it (`osmregions=0` -32 %, the rest less); `--blame` / `--only` runs
  show many small independent sources (lamp splats, window cells, sub-pixel geometry of every OSM layer): causes 2
  and 3. `dynres=0` does not change it, as the owner saw.
- Day land: `aa=fxaa` (-75 %) and `sharpen=0` (-56 %): the final CAS sharpening doubles the contrast of pixel-sized
  aliasing: cause 5. `msaa=4` helps less (-26 %).

## Causes and fixes

### 1. Water mirror: non-finite texels spread by the mips (the sea patches)

The planar reflection (`src/world/water/reflection.ts`) is mip-mapped so the water can blur it by the unresolved wave
roughness. On some frames 1-4 of its texels were NaN / Inf. The mip chain spread each over a whole block (8x8 texels
at mip 3), and the water shader, which rejects a non-finite lookup and shows its own sky reflection instead, drew the
block as a hard, screen-aligned patch for that one frame: dark where the mirror held lit geometry, bright where a
finite over-range texel was averaged in. That is the owner's "reflections come and go".

How it was found: in `night-hisar-fly` two frames spiked by 5,000-9,500 pixels (`perTriple`); `--dump` showed a dark
rectangle on the sea in exactly those frames; `wrefl=sky` and `osmregions=0` removed it; the mirror's base level was
unchanged but its mip 3 held white / black blocks (`--mirror 3`); `--mirror bad` counted the non-finite texels
(frames 3, 10, 25, 39, 43) and its object search named the writers: the OSM facades' reflection meshes
(`osm-facade-reflection`, Rumeli Hisarı, Süleymaniye, Dolmabahçe, by day and at night) and the city-wall material
(`heritage/rumeli-hisari`). Probes (`--pre`) put the facade's NaN in its indirect (IBL) lighting term, with finite
normal, albedo, roughness, AO, radiance and irradiance.

Rule (commit "Water mirror: clean non-finite texels before the mips"): the mirror renders into a multisampled target
without mips; a clean-up pass copies it into the mip-mapped target the water samples, turning non-finite texels into
sky (zero colour and coverage) and capping radiance at 1e4. Whatever material writes a bad texel, it can no longer
become a patch.

### 2. Small lights narrower than a pixel (night lights dimming)

Street lamp heads (`city-lamps`, `osm-lamp-sprites`), traffic head / tail lights and navigation lights are
screen-space splats whose Gaussian core shrank to ~0.4 px sigma at distance: a light on a pixel corner kept ~20 % of
its peak, so distant lights dimmed to near black and back as the view moved (`--blame` named `city-lamps` for 7 of
the 30 hottest night pixels, `osm-lamp-sprites` for 3). Rule (`render/shaders/light-splat.glsl.ts`): the core never
gets narrower than 0.9 px sigma and a light drawn wider than it would look is dimmed by the area ratio, so its energy
is unchanged.

### 3. Far window lights point-sampled (city windows blinking)

Distant lit windows (procedural city, far OSM layer, OSM facades) were pixel-sized cells, point-sampled, or window
rectangles filtered over one pixel: a lit window about a pixel wide straddling two pixels drops to half its peak.
The zoom strips (`zoom.png`) showed single-pixel windows toggling 1-2-1 from frame to frame. Rule
(`render/shaders/night-lights.glsl.ts` `cityFarLit`): lit windows and cells are box-filtered over a 2 px footprint,
where the peak of a sub-pixel light no longer depends on its phase.

### 4. Cloud shadows ignored the moon (the dragon's shadow under an overcast night)

`cloudShadow()` and its baked map followed the sun only (strength 0 at night), while the moon becomes the key light
below -3.5 deg sun elevation. Under an overcast night the moon therefore lit the sea and cast the dragon's shadow at
full strength. Rule: the cloud shadow map is baked along the key light (`uKeyLightDir`: sun by day, moon at night),
`cloudShadow()` samples along it, and the bake restarts in one frame when the key light switches. Shots:
`.shots/flicker/moon/low-compare.jpg` (dragon low over the sea at Kız Kulesi, t=21: the wing shadow on the moonlit
water before, gone under the clouds after; by day `day-compare.jpg` is unchanged).

### 5. Final sharpening amplified pixel-sized aliasing (land shimmer)

The output pass sharpened every frame (CAS at 0.2). Without temporal antialiasing CAS roughly doubles the contrast of
pixel-sized detail, which is what aliases as the view moves. Rule: no sharpening by default (`?sharpen=` still turns it
on); the image is only slightly softer (`.shots/flicker/peninsula-day/sharpen-compare.png`).

## Before / after

Each column adds one commit (measured on that commit, 9 scenes, same server). Cells: sea / land per mille; the last
column also gives the whole frame. Heatmaps before / after: `.shots/flicker/<scene>/before-after.jpg`; the sea
patch: `.shots/flicker/night-hisar-fly/sea-patch-before-after.jpg`.

| scene | before | + mirror | + splats | + windows | + clouds, no sharpen | all: before -> after |
|---|---|---|---|---|---|---|
| `night-hisar` | 0.08 / 0.87 | 0.08 / 0.88 | 0.07 / 0.77 | 0.07 / 0.77 | 0.06 / 0.42 | 0.4 -> 0.2 (-50 %) |
| `night-hisar-fly` | 2.91 / 0.88 | 0.02 / 0.86 | 0.02 / 0.81 | 0.02 / 0.81 | 0.01 / 0.46 | 0.8 -> 0.22 (-72 %) |
| `sea-dusk` | 0.22 / 1.71 | 0.12 / 1.67 | 0.11 / 1.53 | 0.11 / 1.29 | 0.11 / 0.67 | 0.25 -> 0.13 (-48 %) |
| `sea-dusk-fly` | 0.39 / 2.21 | 0.27 / 2.13 | 0.26 / 2 | 0.26 / 1.73 | 0.26 / 1.08 | 0.45 -> 0.28 (-38 %) |
| `peninsula-day` | 0.04 / 2.06 | 0.04 / 2.06 | 0.04 / 2.08 | 0.05 / 2.07 | 0.02 / 0.89 | 0.12 -> 0.05 (-58 %) |
| `peninsula-photo` | 0.01 / 0.41 | 0.01 / 0.4 | 0.01 / 0.41 | 0.01 / 0.41 | 0.01 / 0.2 | 0.1 -> 0.05 (-50 %) |
| `peninsula-day-fly` | 0.11 / 2.51 | 0.12 / 2.51 | 0.12 / 2.47 | 0.12 / 2.49 | 0.02 / 1.28 | 0.14 -> 0.06 (-57 %) |
| `bosphorus-day-fly` | 0.21 / 1.35 | 0.21 / 1.34 | 0.21 / 1.35 | 0.21 / 1.35 | 0.04 / 0.69 | 0.25 -> 0.09 (-64 %) |
| `seawalls-day-fly` | 0.43 / 1.95 | 0.12 / 1.93 | 0.12 / 1.93 | 0.12 / 1.93 | 0.02 / 1.21 | 0.33 -> 0.08 (-76 %) |

## Open

- **Where the NaN comes from.** The mirror clean-up makes any bad texel harmless, but the OSM facade material still
  writes non-finite values in its indirect (IBL) term for some pixels of the mirror's upward view (the city-wall
  material too). Reproduce and trace: `node scripts/flicker-audit.mjs --scene night-hisar-fly --worktree --mirror bad`
  (culprits in `nanSource`), then shader probes with `--pre @probe.js`. The main view's post pipeline already
  sanitises its HDR input, so there it would be single black pixels at most.
- **Remaining night / day land flicker** (0.4-1.3 per mille) is sub-pixel geometry of the OSM layers and the far city:
  roof and facade edges, props and parked cars a pixel wide. Without temporal antialiasing it cannot go to zero; the
  next steps are a TAA / temporal resolve in the post pipeline, or fading small instanced detail out by projected
  size instead of fixed radii (`osm/shared/instance-lod.ts`).
- **Sun glitter on the near sea** (`bosphorus-day-fly`, `sea-dusk-fly`: 0.04-0.26 per mille) flickers in
  screen-horizontal bands in the heatmaps. Likely cause, not verified: the camera-following radial grid
  (`water/surface-grid.ts`, `mesh.position = camera`), whose rings slide over the waves as the camera moves;
  snapping the grid per ring (geo-clipmap style) would test it.
- **Mirror vs. main camera**: the mirror renders in the water's preRender, before the main view renders this frame's
  shadow map, so the reflection's shadows are one frame late. `shadows=0` changes no score; left as is.
- The day scenes do not reproduce hard sea patches while turning; the patches need the mirror NaN, which the
  fly-throughs past OSM facades hit (Rumeli Hisarı, Süleymaniye, Dolmabahçe) by day and at night.
