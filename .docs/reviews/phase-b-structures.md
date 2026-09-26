# Review: structures (`src/world/landmarks/structures`)

Phase 01 review, 2026-09-26, headless only. Files read: `system/structure-system.ts`, `system/road-surface.ts`,
`system/site-planner.ts`, `render/batches.ts`, `render/wires.ts`, `render/lights.ts`, `types.ts`. Budget: `npx tsx
tools/headless/scene-budget.ts --only=structures` (every structures landmark built with the real builders: 161 parts,
13,757 wire segments, 2,827 light sprites).

## Bug

1. **GPU buffers leaked on every rebuild (fixed).** `WireRenderer.setData()` and `LightRenderer.setData()` deleted
   the old instance attributes and attached a new interleaved buffer; three.js frees attribute buffers only when the
   geometry is disposed, so each upload (the first build plus one or two joint refinements) left the previous wire
   (~0.9 MB) and light buffers allocated. Both now dispose the geometry first (it re-uploads on the next draw).

## Budget

- 132-154k triangles per pass at the probe views (main and reflection each), 5 draws (opaque + glass batches, wire
  depth + colour, lights), shadows 0-5k. Parts are mostly LOD0/LOD1 because the LOD step is 2.5 km on "high".
- The wire depth pass must stay in the water reflection: the mirror's coverage meshes use its depth to keep cables
  that cross the sky (checked in `water/reflection.ts`; moving it to NoReflection would erase them).

## Phase A item

- post "0.12 m bridge hangers break into dashes at 500 m": the phone-wire AA ribbons (minimum ~1.4 px width, opacity
  = true coverage) are implemented in `render/wires.ts`. Done in code; needs owner GPU check at `?view=koprusu`.

## Contract

- `roadSurface` is published from the worker's deck data; `deckHeightAt` is allocation-free. The traffic side
  (life) is out of scope here.

## Cleanup

- Open (minor): `results` keeps every structure's CPU geometry (~21 MB) for later joint rebuilds, because `upload()`
  rebuilds all batches from all parts. Keeping only the rebuilt structures' parts would need per-structure batches.
- `lodFor` is exported for the headless budget.
