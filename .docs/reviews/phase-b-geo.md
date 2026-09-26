# Review: geo (`src/world/geo`)

Phase 01 review, 2026-09-26, headless only. Files read: `index.ts`, `build-client.ts`, `query.ts`, `prepare.ts`,
`geo.worker.ts`, `water-names.ts` (use). The headless build (`tools/headless/geo.ts`) runs in ~2 s and feeds every
other headless check.

## Bug

1. **A geo worker error between two awaits was lost (fixed).** `GeoWorkerHandle` kept only the reject of the latest
   `expect()`; an error while no promise of that worker was pending (e.g. worker B failing in the height stage while
   the build awaits worker A's land use) rejected nothing, and the build could wait forever instead of falling back
   to the main thread. The error is sticky now: it rejects every pending and every later `expect()`.

## Contract

- `waterNameAt()` is implemented; queries are O(1) and allocation-free; out-of-range lookups clamp.
- `LandmarkDef.extent` (plan item) stays **open**: filling it for every anchored landmark (max anchor distance +
  radius) was tried and reverted, because `races-check` treats `extent` as a solid cylinder volume (Topkapı's outer
  wall polygon became a 700 m solid disc and three course gates failed). The semantics (extent disc vs. anchor
  polyline) need a decision by the contract owner before geo fills it.

## Budget

- Textures owned here (shared by terrain, city, water): height R32F 2048² (16 MB), land use R8 4096² (16 MB), coast
  distance R32F 2048² (16 MB). Nothing per frame.

## Cleanup

- None needed.
