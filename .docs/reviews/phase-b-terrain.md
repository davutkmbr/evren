# Review: terrain (`src/world/terrain`)

Phase 01 review, 2026-09-26, headless only. Files read: `terrain-system.ts`, `quadtree.ts`, `height-bounds.ts`,
`patch-geometry.ts`, `config.ts`, `bake/tile-bake.ts` (targets), `horizon/horizon-bake.ts` (targets). Budget:
`npx tsx tools/headless/scene-budget.ts --only=terrain` (the real `QuadtreeSelector` on the geo height pyramid).

## Bug

- None found. Contract use is correct (geo textures shared, never disposed here; quality listener removed;
  late bakes disposed when the system is gone; readback failure falls back to conservative bounds).

## Budget

| view | patches (near / mid / far) | main tris | reflection tris | draws | select CPU |
|---|---|---|---|---|---|
| Karaköy 150 m | 363 (64 / 108 / 191) | 418k | 418k | 3 + 3 | 0.15 ms |
| Bosphorus 120 m | 376 (84 / 98 / 194) | 433k | 433k | 3 + 3 | 0.05 ms |
| Kadıköy 140 m | 380 (80 / 101 / 199) | 438k | 438k | 3 + 3 | 0.02 ms |
| overview 2600 m | 245 (0 / 44 / 201) | 282k | 282k | 2 + 2 | 0.02 ms |

1. One patch list serves both the main view and the planar reflection. Measured: the mirrored frustum needs the same
   patches as the main one at these views (main-only = shared), so splitting the lists would save nothing.
2. About half of the patches are far-tier (>= 10 km) at the full 24x24 grid. A coarser far-tier grid would halve the
   terrain triangles, but CDLOD morphing needs one grid resolution across neighbouring levels: not a safe change,
   proposal only.
3. Needs owner GPU check: fragment cost of sea-floor patches under the water surface (terrain draws after the opaque
   objects at renderOrder 5-7; confirm the water occludes it through early-z or measure with `?terrainProf=1`).

## Cleanup

- `window.__terrain` is always installed (not only in sandboxes); harmless, left as is.
