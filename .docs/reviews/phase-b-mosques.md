# Review: mosques (`src/world/landmarks/mosques`)

Phase 01 review, 2026-09-26, headless only. Files read: `system/mosque-system.ts`, `system/placement.ts`,
`render/lod-batch.ts`, `render/geometry.ts`, `worker/client.ts`, `worker/run.ts`, `gen/build.ts`. Budget: `npx tsx
tools/headless/scene-budget.ts --only=mosques` (real generators: 21 landmark mosques, 12 neighbourhood prototypes on
400 geo sites, the system's LOD rules, per-object culling of the batch).

## Bug

- None found. The batch swaps per-pass geometry without extra draws; LOD0 meshes are NoReflection and disposed when
  far; colliders are removed on dispose.

## Budget

1. **Neighbourhood mosques far beyond the city (fixed, needs owner GPU check).** Small mosques stayed in LOD2 up to
   16.25 km on "high", 300-2000 triangles each for a 1-2 px dot, drawn in the main view and the reflection: they were
   the largest mosque cost (Kadıköy: 134k main in the far band). Now `small2` ends with the city's skyline fade
   (1.18 x cityDrawDistance: 10.6 km on high) and the far band has no reflection geometry (the city's far chunks keep
   only skyline and large buildings there too).

   | view | main before -> after | reflection before -> after | all passes before -> after |
   |---|---|---|---|
   | Karaköy | 103k -> 72k | 84k -> 11k | 198k -> 95k |
   | Bosphorus | 16k -> 16k | 14k -> 0.9k | 30k -> 17k |
   | Kadıköy | 185k -> 116k | 182k -> 48k | 397k -> 194k |
   | overview | 82k -> 56k | 82k -> 8k | 170k -> 70k |

2. Needs owner GPU check: landmark LOD0 is 120-144k triangles (Çamlıca, Süleymaniye, Sultanahmet) within 800 m;
   whether `landmark0` could start nearer (600 m) is a visual call.

## Cleanup

- Fixed: `updateLods()` allocated a hysteresis closure per site per frame and a distances object per frame (now
  recomputed only when the quality settings object changes).
- Open (minor): after `dispose()` in-flight worker jobs never settle their promises (counters stay up); harmless.
