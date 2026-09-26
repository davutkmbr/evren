# Review: heritage (`src/world/landmarks/heritage`)

Phase 01 review, 2026-09-26, headless only. Files read: `system.ts`, `jobs.ts`, `protocol.ts`, `build/registry.ts`,
`worker/build-site.ts`, `worker/heritage.worker.ts`, `render/material.ts` (lifecycle). Budget: `npx tsx
tools/headless/scene-budget.ts --only=heritage`.

## Bug

1. **Duplicate sites after a worker failure (fixed).** When the worker failed after delivering some sites, the
   main-thread fallback rebuilt every job: the delivered sites got a second set of meshes and colliders and the
   pending counter went wrong. The fallback now builds only the missing sites; results are ignored after dispose and
   the main-thread slices stop on dispose.

## Budget

- Only Beylerbeyi Sarayı is still built by this module (the other palaces, fortresses, stations and walls moved to
  the OSM slice, districts and the walls module): 1 chunk, 574 triangles at its far LOD. Nothing to reduce.

## Cleanup

- Fixed: removed `data/topkapi.ts` (imported nowhere).
- Open: `jobs.ts` `extraExtent()` keeps branches for Dolmabahçe, Çırağan, Anadolu Hisarı, Selimiye and Kuleli, which
  have no site builder any more; their data files are still imported (and `data/fortresses.ts` is used by the
  perches). Remove together with the site data once the owner confirms those sites stay with the other modules.
- Each chunk is its own mesh per LOD (no batching); fine at one chunk.
