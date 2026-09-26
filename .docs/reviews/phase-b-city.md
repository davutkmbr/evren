# Review: city (`src/world/city`)

Phase 01 review, 2026-09-26, headless only. Files read: `city-system.ts`, `streamer.ts`, `lamps.ts`,
`colliders.ts`, `geo-window.ts`, `worker-pool.ts`, `protocol.ts`, `materials/building-material.ts`,
`worker/tile.ts`, `worker/mesh-writer.ts` (index layout). Budget: `npx tsx tools/headless/scene-budget.ts
--only=city` runs the real `CityStreamer` with the real tile builder in-process (no OSM regions headless, so the
procedural city is counted inside the OSM slice too: an overestimate there).

## Bug

1. **Street lights silently dropped when the lamp pool is full (fixed).** `LampPool` had a fixed 98,304 slots;
   Karaköy on "high" already uses 92k (96k high-water), and larger draw distances (ultra: 14 km) or LOD swaps overflow
   it, after which `add()` returned null and whole chunks stayed dark at night. The pool now grows (x2); the old
   attributes' GPU buffers are freed with `geometry.dispose()` before the new ones are attached.

## Budget

Biggest offender of the scene (all passes, "high"):

| view | main | shadow | reflection | all | main by level (L0 / L1 / L2) |
|---|---|---|---|---|---|
| Karaköy | 1.41M / 32 draws | 346k -> **304k** | 720k | 2.48M -> 2.43M | 240k / 180k / 990k |
| Bosphorus | 296k / 40 | 85k | 80k | 460k | 63k / 82k / 152k |
| Kadıköy | 1.61M / 37 | 771k -> **666k** | 857k | 3.23M -> 3.13M | 312k / 226k / 1.07M |
| overview | 1.05M / 25 | 0 | 233k | 1.28M | 0 / 21k / 1.02M |

1. **Chunks drawn into shadow cascades they cannot shade (fixed).** Workers now report each chunk's highest vertex
   (`TileResultMsg.top`, additive) and the streamer publishes it as `userData.shadowTop`; the cascaded shadow skips a
   chunk in cascades whose receivers all lie above its roofs (cascade 0 while flying): shadow -12 % / -14 %.
2. Open, proposal: **far (L2) chunks are ~1M main triangles** at every view (2 km tiles, 45k tris each, fade classes
   end at 5.0 / 6.3 / 7.6 / 10.6 km). Options: earlier fade for the Small / Mid classes (visual), or a cheaper L2 box
   (merge the 10-12 triangles per building into a single roof-top + 3 visible walls using the camera side of the
   tile). Needs owner GPU judgement.
3. Open, proposal: **L0 shadows are 262-589k** because a whole 500 m chunk is re-drawn into every cascade its sphere
   touches. Splitting the L0 index buffer into the four 250 m cells it is already emitted in (one draw range per cell
   per cascade, e.g. a BatchedMesh or 4 meshes) would let cascades 0-1 skip three quarters of it.
4. Open, proposal: **reflection 720-857k** near the water. L1 chunks reflect all their buildings; emitting L1 in fade
   class order (like L2) would let the reflection drop the Small class. Visual, needs owner check.

## Cleanup

- Fixed: `CityColliders.update()` allocated a Set and an array every frame; unused `scratchCenter` removed.
- Open (minor): `CityStreamer.dispatch()` builds a `queued` array every frame while streaming, `select()` a Set per
  re-selection.
- Memory: the chunks loaded at one probe view hold up to 231 MB of vertex / index buffers (GPU; the CPU copies are
  released after upload). Most of it is L2 (5.5M triangles loaded at Karaköy, 1.4M drawn).
- CPU per frame: 0.002-0.03 ms steady state (streamer update, excluding worker generation).
