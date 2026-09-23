# Evren — Roadmap

An open-world, realistic and "chill" flight simulation where we ride a dragon over Istanbul.
This folder holds the upcoming work split into phases. Each phase has its own file with goal, scope,
technical approach, dependencies, acceptance criteria and an effort estimate.

## Vision

- **Chill:** The player should relax and keep discovering small surprises. No fail state, forgiving controls,
  the dragon is a companion rather than a vehicle.
- **Realism:** Real geography, real dimensions, physically based light and atmosphere; night as good as day.
- **Variety:** Every behaviour has several variations; landings, takeoffs, reactions, music and views never feel repetitive.
- **Performance:** Stable 60 fps on an M2 Max at 1600x900 on the "high" preset.

## Current state (23 September 2026, end of day)

- All 18 modules are integrated and running; `tsc` is clean, no browser console errors.
- Phase A modules (geo, sky, clouds, post, dragon, flight, camera, fx, audio) went through build + one review/fix round.
- Phase B modules (terrain, water, city, vegetation, mosques, structures, heritage, life) were stopped during polishing;
  `ui` finished. None of them has been reviewed yet (phase 01).
- **Galata–Karaköy–Eminönü vertical slice** (behind `?osm=1`, `src/world/osm/`): real OSM streets and buildings with
  four worker-backed layers (streets, buildings, traffic, details). Stopped at a good-enough state on purpose ("this work
  has no end"); canonical shots in `scripts/slice-shots.json`. Known gap: **31–46 M triangles with the slice on**
  (8–11 M without) — the layers have no LOD yet; must be fixed before rolling out city-wide.
- **Vessels** (`src/world/life/`): realistic ferries, fishing boats, tugs, cargo ships, Kelvin wakes, collision-free
  lanes. Declared good enough for now. External model candidates await approval in
  `.docs/assets/candidates/vessels.md` (agent's advice: only vapur, bulk carrier, tug).
- **Phase 01-A** (fixes in playable modules): render part done (exposure hardening + black-frame detector, synchronous
  atmosphere globals, below-sea atmosphere, cloud seams, water reflection filtering). Still open: dragon & fx (flame jet
  from behind, POV head visibility, rider face) and flight/camera/ui/audio (landing ≤ 8 s, simpler hover controls,
  altitude-holding turns, single pointer-lock owner, masterVolume/unlock, shotLabel, waterNameAt, POV wind loudness).
- **Kadıköy hero spots**: research was interrupted; rerun the research step only and stop before building (user's
  request). A `districts` landmark builder type exists in the contract for it.
- Details of the remaining review work: [01 — Review and performance](01-review-and-performance.md).

## Detail tiers (how Istanbul gets detailed)

The whole city cannot be hand-detailed, so detail comes in three tiers:

1. **City-wide, automatic:** the standard settled in the Galata slice (OSM streets, footprints, parks, traffic,
   pedestrians) rolled out to all of Istanbul with tiling, streaming and LOD (phases 08–09).
2. **District profiles, semi-automatic:** per-district style data (building types and eras, facade colours, floor
   heights, shop density, street surfaces), e.g. Kadıköy's 1950–70s balconied apartments, Moda's early-20th-century houses.
3. **Hero spots, handcrafted:** the symbolic places of each detailed district, modelled one by one in
   `src/world/landmarks/districts/<district>/` (builder `districts`). Order: Galata–Karaköy–Eminönü (done as the slice),
   Kadıköy–Moda (next), then Sultanahmet, Beşiktaş–Ortaköy, Üsküdar, Bebek–Arnavutköy, Balat–Fener, the Islands.

## Working agreements

- Keep the machine usable while agents work: prefer sequential or low-concurrency workflows; screenshots only through
  `scripts/snap.mjs` (machine-wide queue, 24 fps cap); no extra dev servers (see `CLAUDE.md`).
- Every polishing task needs an explicit stop criterion (a critic score or a fixed issue list); open-ended "until it is
  convincing" loops are not used.
- External assets are shortlisted with previews and approved by the user before integration (see `CLAUDE.md`).

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
- Checkpoints: a git commit before and after each phase.
