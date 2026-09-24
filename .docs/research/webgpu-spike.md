# WebGPU / TSL migration spike

Date: 2026-09-24 · three.js r186 · Chrome (headless, Metal) on the shared Apple Silicon dev machine · 1600x900, pixel ratio 1.

**Verdict: no-go for a full migration now.** The port is technically feasible: the facade material came across to TSL
almost pixel for pixel. But at the game's scale the WebGPU renderer brings no speed-up, and it costs about 3.5–4x more
CPU per draw call. A full migration is about **95–150 developer-days** (roughly 5–7 months for one developer). Revisit
under the conditions in [Recommendation](#recommendation).

## What was built

`/sandbox/webgpu.html` is a standalone page. `startSandbox` could not be used because its `Engine` creates a
`WebGLRenderer`.

| Query | Meaning |
|---|---|
| (default) | `WebGPURenderer` on the WebGPU backend (`await renderer.init()`). The backend is logged and shown in `__evren.stats().backend`. |
| `?backend=webgl` | The same `WebGPURenderer` forced onto its WebGL2 backend (`forceWebGL: true`). |
| `?backend=classic` | Control: the same scene drawn with the game's `WebGLRenderer`, the original GLSL facade / roof / prop materials, the ShaderChunk fog hook and a single shadow map. |
| `&post=0 &csm=0 &shadows=0 &props=0 &ground=0 &fog=0` | Switch features off, to isolate their cost. |
| `&stress=N` | Render the frame N times per animation frame, to measure past the 60 Hz vsync cap. |
| `&t=21` | Crude night mode (lit windows). |
| `&lat= &lon= &alt= &hdg= &pitch=` | Debug camera. `&env=` and `&exp=` override the environment intensity and the exposure. |

The page exposes `window.__evren` with `ready`, `pending()`, `stats()` (draws, triangles, CPU render ms and load
timings) and `bench()`, so `scripts/snap.mjs` can wait for it and read its numbers.

**Game code reused unchanged.**
- The geo system: its worker builds the grids.
- `loadOsmData` and `buildWorkerBase` (the foundation worker).
- The buildings worker and its protocol, through `runWorker`.
- `addTiledMesh`: the facade and roof are drawn as tiled meshes over shared buffers.
- `InstanceLod` for the six rooftop prop kinds.
- `loadPbrArrays` for the CC0 facade texture arrays.

The geometry pipeline is not forked. The only change to game code is two additive `export` keywords (`poiTriples`,
`landmarkPads`) in `src/world/osm/buildings/index.ts`.

**Ported to TSL.**

| File | Contents |
|---|---|
| `sandbox/webgpu/facade.ts` | The facade material as a `MeshStandardNodeMaterial`. It is a near-complete port of `facade-glsl.ts` (details below). |
| `sandbox/webgpu/roof.ts` | Roofs, fully ported: clay tiles, lead, metal, slate and weathering. |
| `sandbox/webgpu/atmosphere.ts` | The aerial perspective as `scene.fogNode`. It applies to every material, including built-in ones that three converts to node materials. |
| `sandbox/webgpu/tsl-common.ts` | `hash12` / `hash13` / `vnoise2` / `fbm2`, `fBox` / `fLine` and `LAYOUT_GLSL` (the storey, ground-row and balcony rules). |

In `atmosphere.ts`, the per-channel Rayleigh / aerosol / haze transmittance is an exact port. The in-scattered colour
is an analytic horizon + sun-glow term, because the sky-view LUT belongs to the unported sky system.

The facade port covers:
- texture-array layers: plinth, almaşık bands and clapboard;
- all weathering and the four flat-roof finishes;
- trim, and blank party walls with bare brick;
- the window grid, painted dressings, rustication and quoins, spandrels and roller boxes;
- arched and flat openings, and the ray-box recess with reveal normals and the key-light recess shadow;
- glass with frames and transoms; tulle, drapes and blinds; roller and louvred shutters;
- interior-mapped rooms with occupancy and lamp colours, and glass reflections;
- shop fronts with kepenk and Han iron doors, fascias, doors with lamps and grilles;
- the far-field window average and the night wash.

Skipped: only `fShop`, the interior-mapped shop contents. Shops show a flat lit interior instead.

**Also not ported.** The near-LOD facade details (12 instanced kinds with custom depth materials, the railing
`discard` and the bitmap sign font), streets, terrain, water, trees, traffic, clouds and the dragon. The page draws a
low-resolution terrain and sea grid instead, so buildings do not float.

**Lighting and post.**
- A sun `DirectionalLight` with the game's direction, colour and intensity at t=16. Shadows come from `CSMShadowNode`
  (4 cascades, 2048², to 2000 m, with fade); `&csm=0` switches to a single shadow map.
- `SkyMesh` for the sky, plus a PMREM of it as the environment.
- Post: `RenderPipeline` with `pass()` and an MRT (colour and emissive), `bloom()`, then the renderer's AgX tone mapping
  at the game's exposure (0.766).
- The camera is the game's exact `?view=galata` camera, read from the running game: position, quaternion,
  fov 60.93° and near 0.25.

## Measurements

The game and the spike were measured at the same camera. The game ran as
`/?view=galata&t=16&freeze=1&nohud=1&dynres=0&fps=0`, where `freeze` keeps the dragon (and so the camera) still.

**The GPU is shared with other agents and the user, so every number is best-of-repeats.** I tried three other timing
methods and none of them is reliable here:
- GPU timestamp queries report 2–8x the real frame time on this tile-based Apple GPU. This is true of both WebGPU
  `timestamp-query` and the game's own `EXT_disjoint_timer_query` (the game's `diagnostics.gpuMs` read 112–133 ms for
  26 ms frames).
- The rAF frame time is capped at 16.7 ms by vsync.
- Loops that wait on the GPU without advancing three's node frame skip work (see bug 4 below).

The spike numbers below therefore come from `&stress=16`: 16 full renders per animation frame, with the node frame
advanced before each one. They are per-render times measured in 3 reps, which agreed within ±0.1 ms. CPU is the median
JS time of one `renderFrame()` call.

| Variant | Scene | Draw calls | Triangles / frame | Frame time | CPU submit / frame | Page → first frame | Pipeline / shader compile |
|---|---|---|---|---|---|---|---|
| (a) Current game, WebGL | Full game | 539 | 17.5 M | 25.9 ms avg, p95 50 ms (38.5 fps); 34–35 ms median with a GPU sync after every frame | 3.5 ms (engine `cpuMs`, whole frame) | ~17 s to ready | not isolated |
| (b) Spike, WebGPU backend | Buildings + CSM4 + post + fog + sky | 275 | 5.09 M | **3.5 ms** | **3.2 ms** | 3.6 s | 0.49 s warm (**2.6 s** on the first run with a cold Metal cache) |
| (c) Spike, `backend=webgl` (WebGL2 fallback) | Same | 275 | 5.09 M | **3.4 ms** | 2.8 ms | 4.1 s | 0.6–0.8 s warm (**3.7 s** cold; the first frame came 14 s after page start) |
| (b′) WebGPU, `post=0&csm=0` | Buildings, single shadow map | 129 | 2.74 M | 2.27 ms | 1.6–1.9 ms | 3.3 s | 0.43 s |
| (c′) WebGL2 fallback, `post=0&csm=0` | Same | 129 | 2.74 M | 2.30 ms | 1.5–1.6 ms | 3.6 s | 0.5–0.6 s |
| (d) Classic `WebGLRenderer` + the game's GLSL, `post=0&csm=0` | Same | 127 | 2.74 M | **2.09 ms** | **0.4–0.5 ms** | 2.9 s | lazy (the first frame pays) |

What the numbers show:
- **There is no GPU win.** On the same scene, both `WebGPURenderer` backends are within 10% of the classic renderer.
  Their stress numbers are largely CPU-bound, which is the next point.
- **CPU per draw is about 12–14 µs for `WebGPURenderer` on either backend, against about 3.5 µs for `WebGLRenderer`.**
  That is 3.5–4x. It matches three.js issues
  [#30560](https://github.com/mrdoob/three.js/issues/30560) (per-object UBO cost) and
  [#31055](https://github.com/mrdoob/three.js/issues/31055), and forum reports
  ([1](https://discourse.threejs.org/t/why-webgpurenderer-performance-significantly-lower-than-webglrenderer/77629)).
  At the game's roughly 540 draws, that is **about 5 ms more main-thread time per frame**, with nothing given back on
  the GPU.
- **The WebGPU backend is not faster than its own WebGL2 fallback** here (3.5 vs 3.4 ms).
- **CSM adds draws.** `CSMShadowNode` renders every cascade as its own shadow map with no receiver-aware caster
  culling, so draws go from 129 to 263 (263 to 275 with post). The game's `SunLightShadow` atlas culls each caster per
  cascade.
- **Cold start is slower.** Pipeline creation takes 2.6 s cold on WebGPU and 3.7 s on the fallback, for 47 pipelines.
  The game has 99 programs, so expect roughly 5–8 s of cold compile before warm-up tricks.

### Screenshots (`.shots/webgpu/`)

| File | What it shows |
|---|---|
| `webgl-game.png` | The game at the same camera (frozen, no HUD). |
| `webgpu-spike.png` | The spike on the WebGPU backend. |
| `webgl-fallback-spike.png` | The spike on the WebGL2 fallback. It is visually identical to the WebGPU backend. |
| `classic-spike.png` | The same scene with the game's GLSL materials. |
| `close-webgpu.png` and `close-classic.png` | Facade A/B from 40 m. Windows, curtains, flaking paint, roof finishes and props match almost pixel for pixel. |
| `shadow-webgpu.png` and `shadow-classic.png` | Shadow A/B with the sun behind the camera. |
| `night-webgpu.png` | Lit windows with the interior-mapped rooms and lamp colours. |

The spike looks flatter than the game because it has no clouds, terrain shading, water, SMAA, auto-exposure, grading
or real sky LUT. The facade itself matches the GLSL version.

## Porting log (facade)

**Effort.**
- As executed in this spike (by an agent): about 10 minutes to write the facade and roof TSL, 720 + 86 lines, from
  about 520 lines of facade GLSL. Then about 15 minutes of runtime debugging, covering bugs 1–3 below.
- Estimated human equivalent for a developer who knows TSL: about 1.5–2 days for the facade including visual A/B, and
  about 0.5 day for roofs. The estimates below use roughly **300 GLSL lines per day** for straight fragment code. For
  passes with render targets, readbacks or pipelines, they use roughly **150 lines per day** plus integration.

**Mapped cleanly.**
- **Texture arrays:** `texture(arr, uv).depth(int(layer))`.
- **Uniform arrays:** `uniformArray(values, 'float').element(i)`.
- **Derivatives:** `fwidth` works as in GLSL.
- **Custom attributes and varyings:** `attribute('aFac', 'vec4')` read in the fragment stage becomes a varying
  automatically.
- **World position and normal:** `positionWorld` and `normalWorldGeometry`.
- **Loops:** `Loop(n)` with a compile-time count. The GLSL's runtime `break` became one function per octave count.
- **The multi-output patch** (`color_fragment`, `roughnessmap`, `normal_fragment_maps`, `emissivemap`): one `colorNode`
  Fn writes `property()` variables, which `roughnessNode`, `emissiveNode`, `normalNode` and `aoNode` read. This is a
  clean and reusable pattern.
- **Instancing:** `InstancedMesh` with `instanceColor` worked unchanged with a node material.
- **The global fog hook:** `scene.fogNode = Fn(() => vec4(applyAtmosphere(output.rgb, positionWorld), output.a))()`
  replaces the `fog_*` ShaderChunk override for every material. This is simpler than the WebGL version.

**Painful or different.**
- **Mechanical verbosity.** Every operator becomes a method call (`a.mul(b).add(c)`), and the port grows about 40% in
  lines.
- **Strict TypeScript and TSL typings do not mix.** `@types/three` picks the first `float` overload for untyped
  parameters, so the spike types nodes as `any`. A strictly typed production port costs extra time.
- **Method-chaining argument order differs.** `x.smoothstep(a, b)` means `smoothstep(a, b, x)`, and `x.mix(a, b)`
  means `mix(a, b, x)`. This is easy to get wrong.
- **No vector `select`** to replace a `bvec3` `mix`. It has to be done per component (`atmoColumn`).
- **There is no `reflectedLight` hook after lighting.** The GLSL multiplies direct diffuse and specular of all lights by
  `1 - fShadow`. The TSL version uses `receivedShadowNode`, which affects only the shadow-casting key light (fine here),
  and `aoNode` for indirect light. Exact parity needs a custom `LightingModel` subclass.
- **Per-cascade shadow tweaks have no hook.** The game's `SunLightShadow` behaviour has no TSL equivalent: the 2x2
  atlas, per-cascade normal bias in texels, the tile-bounds test, receiver-aware caster culling, and `keyLightRatio()`
  with `cloudShadow()` on every lit material. It means subclassing or forking `CSMShadowNode` / `ShadowNode`, plus a
  custom lighting model or light `colorNode` for the height-dependent key light. This is the riskiest subsystem.
- **8-bit x3 vertex colours** (`color`, u8 normalised) are padded to x4 on the CPU by the WebGPU backend: an extra copy
  at upload and more memory.

### three.js r186 bugs and limitations found

1. **Uniforms inside `Fn().setLayout()` functions break across materials.** The generated function body is shared
   between materials, but the uniform names in it (`object.nodeUniformN`) are resolved for the first material only. The
   result in other materials: "struct member nodeUniform2 not found", `mix(f32, vec3<f32>, …)` and similar WGSL errors,
   invalid pipelines and a broken shadow material. Workaround: no layout on functions that read uniforms, or pass the
   uniforms in as parameters.
2. **An expression-bodied `If` callback silently drops code.** In `If(cond, () => c.mulAssign(x))` the callback returns
   the node, so TSL treats it as a `return` statement. It then comments it out and only warns: "Return statement used in
   an inline 'Fn()'". Always use braces.
3. **`SkyMesh` breaks with `reversedDepthBuffer: true`.** It puts its vertices at `z = w`, which is the near plane under
   reversed depth, so the sky covers the whole frame. Workaround: `sky.renderOrder = -1000`. The game uses reversed
   depth.
4. **`pass()` and `bloom()` update once per node frame** (`NodeUpdateType.FRAME`). Rendering the pipeline again within
   the same animation frame reuses the old result unless `renderer._nodes.nodeFrame.update()` is called (a private API).
   This affects multi-render tooling and benchmarks.
5. **GPU timers are unusable on Apple GPUs** through both the WebGPU timestamp-query path and the WebGL timer
   extension. Dynamic resolution (`render/post/dynamic-resolution.ts`) already relies on the WebGL timer and should be
   checked. That is out of scope here.
6. `PMREMGenerator.fromSceneAsync()` is deprecated.

## Per-system migration estimate

All figures are in developer-days. The GLSL line counts are the lines of `/* glsl */` template literals under `src/`,
about 13k in total. The facade port is the calibration point.

| System | GLSL lines / hooks | Work | Days |
|---|---|---|---|
| Renderer / engine bootstrap | engine, quality detection (raw GL), stats (`info` API differs), `compileAsync` warm-up, sandbox harness, render layers, snap / walk-test hooks | async init, backend detection, stats mapping, warm-up to hide the 5–8 s cold compile | 3–5 |
| Post chain | 749 / 7 ShaderMaterials; dynres, MSAA, SMAA/FXAA, auto-exposure with async readback, flare, grading, AgX, CAS, grain | rebuild on `RenderPipeline`; readback via `getArrayBufferAsync`; dynres via pass resolution; the GPU timer needs a replacement | 8–12 |
| Sky + LUTs + stars + moon + Milky Way + environment | 705 / 6 | LUT passes through `QuadMesh`, dome, stars, moon, PMREM from the LUT | 6–9 |
| Clouds | 1212 / 3 (raymarch, blue noise, shadow map, city glow) | raymarch loops in TSL, perf-critical; compute is an option | 7–10 |
| Cascaded shadows + key light | ShaderChunk patches (atlas, per-cascade bias, culling), `keyLightRatio`, cloud shadow on all lit materials | custom `ShadowNode` / CSM fork and custom lighting model; **highest risk** | 6–10 |
| Global atmosphere / fog | 216 shared | `scene.fogNode` is done in the spike; add the sky-view LUT sampling and the shared helpers | 2–3 |
| Terrain | 2363 / 16 files | largest shader; splatting, streets mask, shore | 10–15 |
| Water | 571 / 3 (reflection, flow) | reflection on `ReflectorNode` or a second pass, flow maps | 5–8 |
| OSM buildings / roofs / details / signs | 949; facade and roofs done | 12 detail kinds (anchored instancing, custom depth materials, `discard`, bitmap sign font), shop interiors | 4–6 |
| Streets (OSM streets + street track props) | 277 + patches | ground shader with the street raster, markings, lamps | 3–5 |
| Landmarks / structures | 1309 / 3 patches, 2 ShaderMaterials | mosque, bridge and tower materials | 6–9 |
| Procedural city | 758 | facade variant of the same ideas | 4–6 |
| Vegetation + impostors | 801 / 2 + 2 | tree wind, impostor baking to render targets | 5–8 |
| Traffic / life / lights / wakes (+ OSM details) | 698 + 190 + 353 | instanced vehicles, pedestrians, lights, wakes | 6–9 |
| FX / fire / particles | 1014 + FX passes, 3D noise volumes | particle shaders; GPU compute particles later | 6–9 |
| Weather (rain / lightning / fog presets) | 224 / 3 | screen-space rain pass, lightning | 2–4 |
| Dragon + rider materials | 647 / 3 patches, skinned (87 bones), MetaHuman | skinning works; wing membrane, rider skin and hair | 4–6 |
| UI-related render bits | map, labels, loading | minimap or label projection helpers | 1–3 |
| Perf work, QA, tooling | — | draw-call reduction to offset the CPU cost (batching / `BatchedMesh`), A/B screenshots of every view, snap / walk-test updates, Firefox and Safari checks | 8–15 |
| **Total** | about 13k GLSL lines | | **95–150 developer-days** |

An agent-driven port could compress the mechanical translation a lot: the facade took minutes. It would not compress
the visual A/B, the shadow and lighting rework, the performance recovery or the regression QA much. A realistic
agent-assisted calendar is **8–12 weeks**, with the user reviewing screenshots per system.

### Recommended order (if and when we go)

1. Engine bootstrap behind a flag, with `WebGPURenderer` on its WebGL2 backend first. This gives one code path and
   lets both backends be compared in every sandbox.
2. The global atmosphere `fogNode` and the shared TSL library (noise, hashes, layout helpers). Everything else depends
   on them.
3. Sky and LUTs, then the key light and cascaded shadows. This is the riskiest part, so prove it early.
4. The post chain.
5. Terrain, then water. These are the largest screen area.
6. OSM buildings and details, city, streets, landmarks.
7. Vegetation, traffic and life, FX, weather, dragon.
8. Performance: batching, fewer draws, and GPU-driven culling or compute, which are the actual WebGPU payoff. Then QA
   and tooling.

## Recommendation

**Do not migrate now.** The measured cost is about 5 ms more CPU per frame at the game's draw count, 5–8 s cold compile
and 5–7 developer-months, with no GPU gain on this hardware. The game's real bottleneck is 17.5 M triangles and 540
draws per frame at about 26 ms. It is cheaper to attack that in WebGL: caster and triangle budgets, LOD, merging.

**Go when one of these holds.**
- **We need compute:** GPU-driven culling or indirect draws for the city, GPU particles, simulated water or clouds.
  WebGPU is the only path to those in the browser, and they would pay for the draw-call overhead.
- **three.js lands the per-object uniform rework** (#30560) and the spike's CPU cost per draw comes within about 1.5x
  of `WebGLRenderer`. Re-run `/sandbox/webgpu.html?stress=16` against `?backend=classic` after each three.js upgrade;
  the page is kept as a canary.
- **Bugs 1–3 above are fixed upstream,** or we accept the workarounds.

Whatever we decide, new shader work is safest written so it can be ported later: small pure functions, uniforms passed
as parameters, and no dependence on `reflectedLight` internals. The facade port shows that such code translates almost
mechanically.
