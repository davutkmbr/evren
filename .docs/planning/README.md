# Ejderha · İstanbul — Roadmap

An open-world, realistic and "chill" flight simulation where we ride a dragon over Istanbul.
This folder holds the upcoming work split into phases. Each phase has its own file with goal, scope,
technical approach, dependencies, acceptance criteria and an effort estimate.

## Vision

- **Chill:** The player should relax and keep discovering small surprises. No fail state, forgiving controls,
  the dragon is a companion rather than a vehicle.
- **Realism:** Real geography, real dimensions, physically based light and atmosphere; night as good as day.
- **Variety:** Every behaviour has several variations; landings, takeoffs, reactions, music and views never feel repetitive.
- **Performance:** Stable 60 fps on an M2 Max at 1600x900 on the "high" preset.

## Current state (23 September 2026)

- All 18 modules are integrated and running; `tsc` is clean, no browser console errors, 60 fps.
- Phase A modules (geo, sky, clouds, post, dragon, flight, camera, fx, audio) went through build + one review/fix round.
- Phase B modules (terrain, water, city, vegetation, mosques, structures, heritage, life) were stopped during polishing;
  `ui` finished. None of them has been reviewed.
- Details of the remaining work: [01 — Review and performance](01-review-and-performance.md).

## External asset policy

Decision: **hybrid**. Lighting and the world stay procedural; licence-clean external sources are used where they add the most realism.

| Source | Decision | Rationale |
|---|---|---|
| Google Photorealistic 3D Tiles | No | Usage limited to "map visualizations", caching/offline prohibited; lighting and shadows are baked into the photos, so the day/night cycle and dynamic lights cannot work; paid at scale. |
| Overture Maps / OSM (building footprints, roads, roof shapes) | Yes | Real city fabric; ODbL, free; lighting stays ours. Attribution required. |
| CC0 PBR textures (Poly Haven, ambientCG) | Yes | Close-range realism for facades, roof tiles, asphalt; no attribution required. |
| Mixamo animations | Yes (rider) | Free and royalty-free in games, as long as raw files are not redistributed on their own. Far more natural than hand-coded animation. |
| Music | Licensed | Well-known songs are copyrighted. Royalty-free licensed tracks or generated music with commercial rights; synthesized ambience as a fallback layer. |
| Vehicle models | Procedural | They are small from dragon altitude; realism comes from traffic behaviour and lights, not the models. |

Sensitivity rule: real mosques, Hagia Sophia and similar landmarks are never damaged; attack targets are fictional.

## Phases

| # | Phase | Milestone | Effort | Depends on |
|---|---|---|---|---|
| 01 | [Review, bug fixing and performance](01-review-and-performance.md) | A · Hardening | L | — |
| 02 | [Realistic relief and terrain shadows](02-relief-and-terrain-shadows.md) | A · Hardening | M | 01 |
| 03 | [Viewpoints (perch system)](03-viewpoints.md) | B · Chill loop | M | 01, 02 |
| 04 | [Landing and takeoff variety](04-landing-takeoff-variety.md) | B · Chill loop | L | 03 |
| 05 | [Flight feel: falling, g-force, thermals](05-flight-feel.md) | B · Chill loop | M | 02 |
| 06 | [Bond with the dragon: gaze, petting, mood](06-dragon-bond.md) | B · Chill loop | M | 03 (stronger with 10) |
| 07 | [Regional and adaptive music](07-regional-music.md) | B · Chill loop | M | 03 |
| 08 | [Real city data (Overture/OSM)](08-real-city-data.md) | C · Realistic city | L | 01, 02 |
| 09 | [Materials, street detail and traffic](09-materials-traffic-detail.md) | C · Realistic city | L | 08 |
| 10 | [Rider animation system](10-rider-animations.md) | D · Character and action | L | 01 |
| 11 | [Attack types](11-attack-types.md) | D · Character and action | L | 01 (14 for rival dragons) |
| 12 | [Dragon and rider variants](12-dragon-rider-variants.md) | E · Variety | M | 01 (stronger with 10) |
| 13 | [Living world: weather, seasons, events, activities](13-living-world.md) | E · Variety | L | 01, 07 |
| 14 | [Multi-dragon foundation](14-multi-dragon-foundation.md) | F · Multiplayer | M | 01, 12 |
| 15 | [Multiplayer](15-multiplayer.md) | F · Multiplayer | L | 14 |

Effort: S ≈ half a workflow session, M ≈ one workflow session, L ≈ two or more sessions.

Suggested order: 01 → 02 → B bundle (03, 04, 05, 06, 07 as one release) → 08 → 09 → 10 → 11 → 12 → 13 → 14 → 15.

## Working method

- Each phase runs as its own workflow: one builder agent per module, then a single review + fix round.
- Usage limits drive pacing: check the limit before starting a phase and size the number of parallel agents accordingly.
- Contracts change through `src/core/contracts.ts`; any contract change a phase needs is made once, up front, by one
  owner; module agents only touch their own folders.
- Verification: `node scripts/snap.mjs` for GPU screenshots + stats; every phase's acceptance criteria are written to be measurable with it.
- Checkpoints: a git commit before and after each phase (the repository has no commits yet; the first task is an initial commit).
