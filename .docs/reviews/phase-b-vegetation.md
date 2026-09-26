# Review: vegetation (`src/world/vegetation`)

Phase 01 review, 2026-09-26, headless only. Files read: `system.ts`, `config.ts`, `assets.ts`,
`render/near-pools.ts`, `render/impostor-pool.ts`, `render/tree-geometry.ts`, `stream/tile-streamer.ts`,
`stream/geo-window.ts`, `species.ts`. Budget: `npx tsx tools/headless/scene-budget.ts --only=vegetation` (real species
generator, real `TileStreamer` placement, the system's pool / keep-level / governor rules).

## Bug

- None found in the per-frame paths (no allocations besides chunk lists on writes; OSM and quality listeners removed;
  workers terminated).

## Budget

1. **Impostor pools were mostly empty slots (fixed).** Every tile rounds its trees up to whole 64-instance chunks and
   the zeroed tail still runs the vertex shader; far tiles hold a handful of thinned trees, so 30-77 % of the drawn
   impostor instances were empty. `CHUNK` is 16 now (initial pool capacity unchanged):

   | view | trees in tiles | written | slots before | slots after | all-pass tris before -> after |
   |---|---|---|---|---|---|
   | Karaköy | 19k | 5.2k | 23k | 8.9k | 60k -> 25k |
   | Bosphorus | 135k | 49k | 70k | 54k | 207k -> 170k |
   | Kadıköy | 29k | 4.6k | 15k | 6.8k | 39k -> 17k |
   | overview | 35k | 7.1k | 24k | 11k | 57k -> 29k |

2. At flight altitude (120-150 m) no tree is within the 3D LOD1 band (150 m), so only impostors draw; the governor
   stays at 1. Low-altitude views were not probed (plan views only).
3. Open, proposal: pools are drawn whole (bounding spheres around the camera), so trees behind the camera cost vertex
   work. Culling the near-pool rebuild by the view frustum would need rebuilds on camera rotation too.

## Resource

- Open (bounded): `InstanceStream.reserve()` swaps in a new interleaved buffer and the old GPU buffer stays allocated
  (three.js frees attribute buffers only on geometry dispose, and the pool geometries share the species attributes).
  Growth is x1.5, so the leak is bounded by ~2x the final pool size; not changed (the dispose route would also drop
  the shared species buffers).
