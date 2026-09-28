# Phase 28 — Frame budget on ultra

Milestone: C · Performance · Effort: measurement done, fixes M–L · Target: **ultra ≥ 60 fps at 1600x900 on the
reference machine (M2 Max), p99 frame ≤ 20 ms, no frame over 33 ms outside the first second after a teleport.**

Measured 2026-09-28 on origin/main `c9ca265` (TAA on by default, PR #109). Measurement only: no game code changed.

## Summary

- **Ultra is GPU-bound everywhere.** Main-thread CPU is 11–15 ms per frame, the frame is 27–40 ms. Chrome's GPU
  process main thread is 90–94 % busy (≈ 56 % of it decoding WebGL commands, the rest waiting on Metal).
- **Where the GPU time goes** (per frame, serialised timing, see Method): the planar water mirror 6–12 ms, the OSM
  regions 5–13 ms (their buildings alone 5–9 ms), key-light shadows 2.5–7.5 ms, the procedural city 2–5 ms, clouds
  1–2.5 ms. Pixel-proportional cost at 1600x900 is only 5–9 ms: resolution is not the main lever.
- **Headroom is real:** `wrefl=sky&osmregions=0` alone gives a locked 60 fps (median 16.7 ms, p99 17.8 ms) at Galata
  and at Kadıköy. The mirror and the regions have to get cheaper, not go away.
- **The stutter is not GC or CPU spikes.** 88–100 % of the long frames are one synchronous GPU round trip: the
  auto-exposure readback (`AsyncReadback.poll` → `getBufferSubData`, called from `PostPipeline.onFrameStart`) waits
  48–60 ms (up to 99 ms near Kadıköy) for the GPU process to drain its backlog. It only hurts because the GPU is over
  budget: under budget (the combo above) the same code runs at p99 17.8 ms. Streaming adds shader links on first use
  (23–77 ms), worker-result handlers (91–99 ms) and unattributed JS frame bodies (~100 ms).
- **Retina warning:** ultra allows `maxPixelRatio: 2`. At DPR 2 the same views cost **+17–20 ms** per frame
  (measured with a forced 2x render scale). If the owner plays in a Retina window, this is the first fix.

## Method

Everything ran through `scripts/snap.mjs --batch` (GPU queue) against the shared dev server, serving this checkout's
`src/` through the worktree shim page (`.shots/wt/index.html`, as `scripts/flicker-audit.mjs --worktree` does).
Headless Chrome, Metal ANGLE, 1600x900, DPR 1, `q=ultra&dynres=0`, uncapped (`fps=0`). The machine was shared with
other agents' GPU jobs, so every number carries noise: **±1.5 ms on serialised timings** (repeated baselines inside
one page agree within that), ±4 ms on pipelined medians.

- **Natural run** (flying, HUD on, `autostart=1`): per-frame instrumentation wraps every system's `update` /
  `preRender` and `PostPipeline.render`; 8 s window, plus `--perf 8000` and a Chrome trace (renderer main thread,
  GPU process, V8 GC) over the window. Kadıköy: `__evren.shotLatLon(40.990, 29.026, 150, 0, -15, 60)`, 30 s of
  streaming inside the trace, then the window.
- **Bisection** (frozen scene, `freeze=1&nohud=1`): the engine loop is stopped and each frame is run as
  `engine.frame()` followed by a 1-pixel `readPixels` of the canvas, which blocks until the GPU finished that frame.
  "Serialised ms" = CPU + GPU of one frame without pipelining (the pipelined frame is shorter, roughly 0.6–0.75x).
  Deltas against the baseline are the cost of a feature. The GPU timer (`?postprof`) is not usable here: ANGLE's
  Metal backend sums overlapping command buffers (see `gpu-timer.ts`).
- In-page toggles: `castShadow` on the key light, `setActiveCascades`, the shadow tile size, HDR passes pinned off,
  bloom off, `setFixedScale`, and hiding scene groups only during `renderer.render` (every pass: shadow, mirror,
  main). URL toggles that only apply at init (`wrefl=sky`, `osmregions=0`, `taa=0`, `q=high`) got a page each.

The scratch harness (in-page helpers, batch generator, trace analysers) is not committed; it is small enough to
rebuild from this description, and a future `scripts/frame-budget.mjs` should do the same with the per-frame
system breakdown built in.

## 1. Frame breakdown on ultra

### Natural run (flying, `--perf 8000` and the 8 s instrumented window)

| View | perf fps | frame median | p99 | max | frames > 50 ms | main-thread CPU median / p99 | draws | triangles | heap |
|---|---|---|---|---|---|---|---|---|---|
| `galata&t=15` | 33.3 | 32.2 ms | 67.8 ms | 73.7 ms | 24 | 15.2 / 22.3 ms | 1012 | 21.8 M | 2.5 GB |
| `bogaz&t=21` | 33.2 | 29.5 ms | 87.4 ms | 108 ms | 27 | 12.3 / 47.0 ms | 867 | 16.4 M | 1.8 GB |
| `sultanahmet&t=16` | 35.9 | 27.4 ms | 64.7 ms | 70.8 ms | 33 | 12.7 / 18.0 ms | 1179 | 20.3 M | 2.1 GB |
| Kadıköy 150 m | 27.3 | 23.1 ms | 93.9 ms | 111 ms | 66 | 11.2 / 13.0 ms | 1072 | 29.4 M | 2.0 GB |

Frame intervals are bimodal: most frames take 16.7–33 ms, every 3rd–5th frame takes 50–70 ms (section 3). Draw calls
and triangles include the shadow cascades, the water mirror and the main view (the frozen views below read 1214 draws
/ 26.0 M triangles at Galata).

### Main-thread CPU per system (mean / p99 / max, ms)

| System | Galata | Boğaz | Sultanahmet | Kadıköy |
|---|---|---|---|---|
| `PostPipeline.render` (scene + post submission) | 7.9 / 11.7 / 13.1 | 7.3 / 36.7 / 69 | 6.8 / 8.8 / 37.6 | 5.5 / 6.7 / 7.0 |
| `water:preRender` (mirror render submission) | 3.2 / 4.4 / 4.6 | 2.8 / 4.2 / 14.6 | 2.7 / 3.5 / 3.6 | 2.5 / 3.3 / 3.4 |
| `osm` | 2.0 / 3.1 / 9.7 | 1.1 / 1.9 / 3.7 | 1.4 / 2.2 / 5.3 | 1.3 / 1.7 / 1.9 |
| `life` | 0.8 / 1.4 / 2.1 | 0.8 / 1.3 / 1.6 | 0.6 / 1.0 / 1.2 | 0.4 / 0.8 / 1.3 |
| `dragon-model` | 0.6 / 1.0 / 1.0 | 0.5 / 0.7 / 1.1 | 0.5 / 0.8 / 1.1 | 0.4 / 0.6 / 0.6 |
| everything else | < 0.2 each | < 0.3 each (`flight` max 4.5) | < 0.2 each (`moments` max 8.3) | < 0.2 each |

The p99/max spikes in `PostPipeline.render` (37–69 ms) are shader programs linked on first use (section 3).

### CPU vs GPU (Chrome trace, 13 s windows)

| View | renderer main busy | of which blocked in GPU round trips | GPU-process main busy | GPU-process `WebGL` decode | GC (minor / major, max) |
|---|---|---|---|---|---|
| Galata | 99 % | ≈ 2.2 s in 36 long tasks | 93 % | 7.6 s (59 %) | 24 × ≤ 0.9 ms / none |
| Boğaz | 99 % | ≈ 2.8 s in 48 long tasks | 94 % | 7.2 s (54 %) | 27 × ≤ 1.2 ms / 1 × 4.1 ms |
| Sultanahmet | 99 % | ≈ 2.5 s in 44 long tasks | 90 % | 7.2 s (54 %) | 25 × ≤ 0.7 ms / 1 × 4.0 ms |
| Kadıköy (44 s incl. streaming) | 99 % | ≈ 17 s in 253 long tasks | 91 % | 22.6 s (51 %) | 94 × ≤ 3.7 ms / 4 × ≤ 4.8 ms |

The renderer is never the bottleneck: its own work is 11–15 ms, the rest of each frame is waiting. The GPU process
spends more than half its time translating WebGL commands for ANGLE, so **draw calls and state changes cost GPU-process
time on top of GPU execution**: fewer draws helps even where triangles do not change.

## 2. GPU bisection

Serialised frame, frozen scene. Baselines (mean of 2–3 in-page repeats): Galata 38.8 ms, Boğaz 33.3 ms, Sultanahmet
39.1 ms, Kadıköy 41.8 ms; CPU part ≈ 11 ms each. **Saved ms** (positive = cheaper); `≈0` = inside the ±1.5 ms noise.

| Toggle | Galata | Boğaz | Sultanahmet | Kadıköy | Notes |
|---|---|---|---|---|---|
| `wrefl=sky` (no planar mirror) | **11.7** | **7.2** | **6.4** | **7.1** | also −1.3…−5.3 ms main-thread CPU, −180…−220 draws |
| `osmregions=0` | **9.4** | **5.3** | **9.4** | **12.9** | −300…−400 draws, −6…−16 M tris, −0.4…−1.1 GB heap |
| hide `osm` (regions + slice) | 10.1 | 5.0 | 11.1 | 15.0 | |
| `shadows=0` | **6.3** | 2.5 | **7.5** | **7.4** | −420…−480 draws, −3…−8 M tris |
| shadow cascades 4 → 3 | ≈0 (1.2) | ≈0 | ≈0 | ≈0 | only −50 draws |
| shadow cascades 4 → 2 | ≈0 | ≈0 | ≈0 | ≈0 | |
| shadow tile 2048 → 1024 | ≈0 | ≈0 | ≈0 | ≈0 | fill is not the shadow cost |
| clouds pass off | 1.7 | 2.4 | 2.1 | 1.1 | ultra: half resolution, 112 steps |
| weather pass off | ≈0 | ≈0 | ≈0 | ≈0 | |
| `bloom=0` | ≈0 | ≈0 | ≈0 | ≈0 | |
| `taa=0` (ultra then uses MSAA 4x + SMAA) | −0.8 | −2.2 | −4.8 | −3.3 | TAA is already cheaper than the old AA |
| render scale 0.85 | 2.7 | ≈0 | 2.8 | 1.6 | |
| render scale 0.7 | 4.0 | 3.6 | 4.7 | 2.3 | pixel cost at 1.0 ≈ 5–9 ms |
| render scale 2 (= DPR 2, Retina) | **−16.7** | **−19.5** | **−18.6** | **−17.7** | cost added |
| `q=high` instead of ultra | 12.1 | 5.9 | 6.0 | 7.7 | |
| hide procedural `city` | 2.4 | 5.2 | 5.5 | 5.1 | ~170 tiles, each ≤ 1.6 ms |
| hide terrain | 1.7 | 2.8 | 3.2 | 3.6 | |
| hide water surface (mirror still rendered) | ≈0 | 3.9 | 2.9 | 2.7 | |
| hide dragon + rider | ≈0 | 3.5 | 1.5 | 2.4 | 38 meshes, ~220 draws with shadows |
| hide `life` | ≈0 | 3.3 | ≈0 | 2.0 | |
| hide heritage / walls / mosques / structures | ≤ 1.9 each | | | | |
| **`wrefl=sky` + `osmregions=0`** | **17.6** | — | — | **23.6** | pipelined: **60.0 fps, median 16.8, p99 17.8 ms** at both |

### Inside the OSM regions and the mirror (serialised, saved ms)

| Toggle | Galata | Kadıköy |
|---|---|---|
| hide the region the camera is in (`osm-galata` / `osm-kadikoy-4`, 106 / 264 meshes) | 4.4 | **10.0** |
| hide all region **buildings** (243 / 260 meshes) | **5.4** | **8.7** |
| … buildings not casting shadows (1712 / 1976 casters) | 0.9 | 1.5 |
| … buildings not in the mirror | 2.4 | 2.7 |
| hide all region **details** (props, trees, kits) | 2.2 | 3.2 |
| hide all region **streets** | 1.8 | 2.6 |
| hide region traffic | ≈0 | ≈0 |
| mirror without `osm` | 2.7 | 2.8 |
| mirror without `osm` + `city` | 3.6 | 4.7 |

- Buildings are the region cost, and about half of the near region's building cost is the main view itself (LOD /
  triangle count), a third the mirror, the rest shadows.
- Shadow casters per scene group (castShadow off one group at a time) stayed inside the noise except OSM (−2.2 ms at
  Kadıköy). Since cascade count and map size are free, the rest of the 6–7.5 ms shadow cost is spread: many small
  caster draws (≈ 450 of them) plus four-cascade PCF sampling in every lit material (main view and mirror). Splitting
  those two needs one more run (casters off with receivers on).
- The procedural city is ~170 small tiles (0.1–1.6 ms each); its cost is draw count, not triangles.

## 3. Stutter

Long tasks (> 50 ms) on the renderer main thread, classified from the traces:

| Cause | Galata | Boğaz | Sultanahmet | Kadıköy (incl. 30 s streaming) |
|---|---|---|---|---|
| Exposure readback round trip in `onFrameStart` (48–60 ms, up to 99 ms) | 36 / 36 | 48 / 56 | 44 / 45 | 253 / 275 |
| Shader program linked on first use (`GetProgramiv` 23–77 ms inside the frame) | — | 1 | 1 | ≥ 6 |
| Worker result handlers (`HandlePostMessage`, 91–99 ms) | — | 3 | — | 9 |
| Frame body JS without GL waits (~95–104 ms, not attributed) | — | 1 (170 ms) | — | 4 |
| GC | none > 5 ms | none > 5 ms | none > 5 ms | none > 5 ms |

1. **GPU over budget, surfaced by the exposure readback.** `AutoExposure.meter()` queues a 64x36 float readback every
   frame; `AsyncReadback.poll()` runs at frame start and, once a fence has signalled, calls `getBufferSubData`. In
   Chrome that is a synchronous command-buffer round trip (`CommandBufferHelper::Finish`) that waits until the GPU
   process has processed every command already flushed, i.e. the previous frame's whole backlog. A/B with the poll
   disabled (5 s windows, frozen): median 29 → 19 ms (Galata), 20 → 17 ms (Kadıköy), but fps unchanged (30–33) and
   p99 **worse** (63 → 140 ms): without that sync Chrome's own swap backpressure stalls instead, in bigger steps. So
   the readback is the messenger; the cause is GPU time > frame time. Under budget (mirror + regions off) p99 is
   17.8 ms with the readback still on.
2. **Programs compiled on first sight.** New materials arriving with streamed regions (and a few others: Boğaz,
   Sultanahmet) are linked synchronously when first drawn; three's `getProgramParameter(LINK_STATUS)` blocks
   23–77 ms. Street layer, mosques, clouds and fx already warm up with `compileAsync`; the OSM regions do not.
3. **Region streaming on the main thread.** Worker results are consumed in one message handler of 91–99 ms, and
   ~100 ms frame bodies without GL waits appear while Kadıköy's regions load (JS work inside `update`, most likely
   geometry / buffer building; the per-system timers were not active during the load, so the owner is unconfirmed).
4. **Not causes:** GC (minor ≤ 3.7 ms, major ≤ 4.8 ms, incremental marking), the GPU timer queries, CPU spikes in
   steady flight.

## 4. Fixes, ranked by fps per effort

Budget: to hold 60 fps the serialised frame must drop to ≈ 23 ms (the measured combo that runs at a locked 60 fps).
That is **−16 ms at Galata, −10 ms at Boğaz, −16 ms at Sultanahmet, −19 ms at Kadıköy.** Expected savings are
serialised ms from the bisection; they overlap (e.g. OSM buildings appear in the mirror and in the shadows), so they
do not add up exactly.

| # | Fix | Expected saving | Effort | Evidence |
|---|---|---|---|---|
| 0 | **Cap ultra's pixel ratio** (`maxPixelRatio` 2 → 1, or 1.25 with TAA upscale) if the game runs on a Retina display | up to 17–20 ms on DPR 2 screens, 0 at DPR 1 | S | render scale 2: +16.7…+19.5 ms |
| 1 | **Mirror budget:** OSM regions, procedural city and region details on `RenderLayers.NoReflection` (keep cheap stand-ins / far layer in the mirror), mirror MSAA 4 → 2, `reflectionScale` 0.6 → 0.45 | 4–7 ms (full mirror costs 6.4–11.7) | S–M | `wrefl=sky` −6.4…−11.7; mirror without osm+city −3.6…−4.7 |
| 2 | **OSM region building budget:** screen-space-error LOD / HLOD for region buildings (merge far blocks into per-cell proxies, drop façade detail beyond ~400 m), cap draws per region | 4–7 ms (buildings 5.4–8.7, near region 4.4–10) | M–L | hide region buildings −5.4 / −8.7 |
| 3 | **Shadow caster budget:** gate small casters and region details out of cascades ≥ 1 (`shadowGate`), building proxies in the far cascades, refresh cascades 2–3 every other frame (static world, sun moves slowly) | 2–4 ms (shadows total 2.5–7.5) | M | `shadows=0` −6.3 / −7.5; cascades / tile size ≈0 → it is draws, not fill |
| 4 | **Draw-call batching** for the procedural city tiles (~170 meshes) and region layers (BatchedMesh / merged per cell): relieves the GPU-process decode (54–59 % busy) and `PostPipeline.render` CPU (5.5–7.9 ms) | 2–4 ms | M–L | hide `city` −2.4…−5.5 at ≤ 1.6 ms per tile |
| 5 | **Clouds on ultra at high's resolution** (divisor 2 → 3, steps 112 → 88) or temporal upsampling | ~1 ms (pass costs 1.1–2.4) | S | clouds off −1.1…−2.4 |
| 6 | **Exposure without a readback:** keep the meter and the adaptation on the GPU (1x1 adapted-luminance target read by the composite), so no frame ever waits on the GPU process; alternatively poll at most every 4th frame | median 0 ms; removes the 50–60 ms spikes once under budget | S–M | section 3.1; **done, section 5** |
| 7 | **Frame pacing:** one fence per frame, skip the frame's GPU work (not the simulation) while 2 frames are in flight | median 0; p99 → median when slightly over budget | S | poll-off A/B: backpressure stalls reach 140 ms; **done, section 5** |
| 8 | **Shader warm-up for streamed content:** `compileAsync` region / kit materials before they join the scene (as street layer and mosques do); share materials across regions | removes 23–77 ms hitches | S | `GetProgramiv` long tasks |
| 9 | **Spread region streaming:** time-slice the worker-result handler and geometry uploads (≤ 2 ms per frame), transfer ready buffers instead of rebuilding on the main thread | removes 90–100 ms hitches near regions | M | `HandlePostMessage` 91–99 ms; frame bodies ~100 ms |
| 10 | Dynamic resolution as the safety net (already there; floor 0.8 on ultra) | ≤ 3 ms | — | scale 0.7 only −2.3…−4.7 ms: cannot close the gap alone |

Suggested order: 0 (if Retina) → 1 → 5 → 8 → 3 → 2 → 6/7 → 9 → 4. Fixes 1 + 2 + 3 + 5 at their expected values
remove 11–19 ms, which reaches the ≈ 23 ms serialised target at every measured view; re-measure after each with the
same method (serialised frame + pipelined p99, frozen and flying, all four views).

## 5. Stutter: exposure and frame pacing

Fixes 6 and 7, measured 2026-09-28 on `feat/gpu-exposure` against origin/main `76966f9`. Before and after ran in the
same `snap.mjs --batch`, interleaved per view (the baseline is a frozen copy of main's `src/` served through its own
shim page). Flying, `q=ultra&dynres=0&fps=0&autostart=1`, 1600x900. The numbers come from the page's 8 s frame window
(`frameTimes`, one sample per rendered frame). The same noise as above applies: repeated runs of one variant move p99 by
one or two 16.7 ms vsync steps.

### What changed

- **Auto exposure runs entirely on the GPU.** Meter (64x36 log luminance, unchanged), then a 128x1 histogram pass
  with the same centre weights, then a 2x1 float32 adaptation pass that ping-pongs the state: the percentile band
  (35–93 %), the target EV (key 0.18, `minLog` / `maxLog` clamp, dark / bright / night compensation, `?ev=` bias),
  and the rise / fall time constants (1.5 s / 0.7 s) with the frame's `dt`. `?exposure=` writes the fixed value, and
  teleports and time jumps still snap for 3 frames. Composite, bloom's Karis weights and the `?postdebug` views sample
  the exposure from that texture. There is no CPU readback on the per-frame path.
- **The CPU copy uses occlusion queries, not a fenced readback.** The weather's lightning, `diagnostics` and the
  black-frame log still need the value. A fenced `getBufferSubData` does not work for this in Chrome (next section).
  4 times per second, 30 one-pixel draws encode the state bit by bit (exposure at 12 bits, about ±0.3 %; metered
  luminance at 10 bits; black fraction at 7 bits; 1 validity bit). Each draw sits in its own `ANY_SAMPLES_PASSED` query,
  and the results arrive asynchronously. `async-readback.ts` is gone.
- **Frame pacing** (`?pace=N`, default 2, `0` = off). The pipeline puts a fence after every frame. At the start of an
  animation frame, while the fences of the last N frames are all unsignalled (polled with `clientWaitSync(…, 0)`),
  the engine skips that animation frame instead of queueing more work (at most 6 in a row). The next frame takes the
  whole elapsed `dt`.

### Why the fence alone does not help in Chrome

In-page test during flight (Galata, ultra, 20 samples each): a 4x4 readback into a pixel-pack buffer, a fence, the
fence polled each frame until signalled, then `getBufferSubData`:

| Buffer | Fence polled with | `getBufferSubData` median / max |
|---|---|---|
| `STREAM_READ`, reused | `clientWaitSync(0)` | 81 / 95 ms |
| `STREAM_READ`, fresh per read | `clientWaitSync(0)` | 40 / 79 ms |
| `STREAM_READ`, reused | `getSyncParameter` | 3 / 76 ms |
| `STREAM_COPY`, reused | `clientWaitSync(0)` | 73 / 91 ms |

The call stays a synchronous command-buffer round trip that waits until the GPU process has drained its backlog,
even after the fence signalled. Chrome's `READ`-usage shadow copy did not take effect: it logs "written again before
being read back" and discards it. An exposure copy read this way every 0.25 s still cost 20–110 ms per read
(first attempt on this branch). Collecting it only when every frame fence had signalled did not help either: on ultra
the GPU never caught up, so no copy qualified. Occlusion-query results carry no such round trip.

### Results

| View | Variant | fps (rendered) | median | p99 | max | frames > 50 ms |
|---|---|---|---|---|---|---|
| `galata&t=15` | before (main) | 33.4 | 16.7 | 66.7 | 83.3 | 30 |
| | GPU exposure, no pacing (`pace=0`) | 30.4 | 16.8 | 100.1 | 116.6 | 33 |
| | **GPU exposure + pacing (default)** | 31.4 | 33.3 | **50.1** | **66.7** | 6 |
| `bogaz&t=21` | before (main) | 31.4 | 33.3 | 83.4 | 133.3 | 20 |
| | GPU exposure, no pacing | 31.3 | 33.2 | 100.1 | 100.1 | 29 |
| | **GPU exposure + pacing** | 30.2 | 33.3 | **66.8** | 149.9 | 23 |
| Kadıköy 150 m | before (main) | 27.1 | 33.3 | 100.0 | 133.4 | 53 |
| | GPU exposure, no pacing | 26.8 | 33.3 | 116.7 | 116.8 | 33 |
| | **GPU exposure + pacing** | 26.2 | 33.4 | **83.3** | **83.4** | 29 |

- **The GPU exposure alone does not help.** It is the section 3.1 A/B again: without the readback's implicit sync,
  Chrome's backpressure stalls in 100–117 ms steps.
- **The two together fix the stutter.** p99 drops by 17 ms per view (one vsync step), and the Galata and Kadıköy
  maxima drop by 17–50 ms. Frame times go from bimodal (16.7 ms frames plus 50–130 ms stalls) to a steady 33 ms
  cadence. Rendered fps changes by −3…−6 %, within the noise. The Boğaz max of 150 ms is most likely a
  shader-program link (the trace of the same view shows one, below).
- The remaining p99 (50–83 ms) comes from pacing skipping animation frames while the GPU is over budget. The main
  thread no longer waits: a skipped frame costs nothing. It falls toward the median once the GPU fits its budget
  (fixes 1–5).
- Pacing depth: `pace=1` halves throughput (Chrome reports fence completion one frame or more late: 50–67 ms median,
  16–23 fps); `pace=3` behaves like no pacing (p99 83–100 ms). 2 is the default.
- The `snap.mjs --perf` fps counts animation frames. With pacing it includes skipped ones (it reads 49–56 fps here),
  so use `frameTimes.frames` for the rendered rate.

### Chrome traces (renderer main thread, long tasks > 50 ms, 8 s window)

| View | Before: exposure readback | Before: other | After: exposure readback | After: other | Main thread busy before → after |
|---|---|---|---|---|---|
| Galata | 35 (≤ 66 ms) | 0 | **0** | 0 | 99 % → 54 % |
| Boğaz | 16 (≤ 64 ms) | 4 (2 program links, 1 worker handler, 1 frame body) | **0** | 1 program link (58 ms) | 97 % → 53 % |
| Kadıköy (last 8 s) | 62 (≤ 113 ms) | 2 GPU round trips | **0** | 1 GPU round trip (61 ms) | 99 % → 48 % |

Over the whole 38 s Kadıköy trace (with streaming), long tasks fell from 290 (272 of them the exposure readback) to 23.
Those 23 are program links (fix 8), worker result handlers and frame bodies (fix 9), and 6 round trips from the sky's
irradiance probe. The probe reads back through three's `readRenderTargetPixelsAsync` every 0.25 s
(`render/sky/index.ts`), which is the same fenced-`getBufferSubData` pattern and is the next readback to move to the
GPU or to a query readout.

### Visual check

- Before and after screenshots of the same views match (`galata&t=15`, `bogaz&t=21`, `?ev=1`, `?exposure=1.2`,
  `?postdebug=hdr`).
- The CPU copy reads the same values as main's readback: Galata EV −1.168 vs −1.170, Boğaz night −0.254 vs −0.250,
  `?exposure=1.2` 0.262 vs 0.263 EV, and `?ev=1` +1 EV.
- Exposure over time was probed by cutting the camera from sky to dark water and back at 19:12, then moving the clock
  from 18:00 to 21:00 in 0.1 h steps. It tracks main within about 0.1 EV at matching phases, including the rise (τ 1.5 s:
  −0.44 → 1.61 EV on main, −0.34 → 1.63 EV here, in 3.7 s) and the fall into night. Up to 0.25 EV appear where the
  two probes' clocks are offset by a few hundred ms. The sky-to-water cut shows no change on either build: both stay
  at the `minLog` clamp.

## Open

- Split the shadow cost into casters vs receiver sampling (castShadow off everywhere, receivers on).
- Attribute the ~100 ms streaming frame bodies near Kadıköy (per-system timers active during the region load).
- Repeat the headline numbers on a quiet machine (no parallel GPU jobs) and in a headed Chrome at DPR 2.
