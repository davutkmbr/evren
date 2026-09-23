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
- **Direction change (24 September 2026): walkable Kadıköy.** The user wants to land, walk as a human, enter cafés,
  talk to NPCs and drive, with street-level detail that feels like really walking through Kadıköy. Research outcome:
  a separate street layer built by an offline world compiler, with the runtime (three.js WebGPU or Godot 4.7) chosen
  by a measured street-level test. See [16 — Street track](16-street-layer.md). Kadıköy hero-spot research is done
  (`.docs/research/kadikoy-hero-spots.json`).
- **S0 done (24 September 2026):** Kadıköy OSM data (`data/osm/kadikoy.json`), the offline world compiler
  (`tools/world-compiler`, format 0: 139 greybox glTF tiles + manifests, one connected walk graph, lane graph), the
  eye-level sandbox (`sandbox/street.html`, free walk or `?route=rihtim-carsi|altiyol-sureyya`) and `scripts/walk-test.mjs`.
  Phase 01 bug fixes (landing, hover, turns, fire jet, POV head, rider face, bridge decks for traffic) are committed.
  S1 assets are approved and cached (`tools/assets/approved.json`); humans are MetaHuman + Mixamo in `private-assets/`
  (`.docs/assets/humans-pipeline.md`).

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
| MetaHuman characters | Yes (humans, private store) | Modern realistic humans, free under $1 M revenue, usable in any engine; faces animated with MetaHuman Animator. Raw files stay in `private-assets/`, never in the public repo. |
| Mixamo animations | Yes (body clips, private store) | Good mocap, free; its terms forbid distributing raw files, so they live in `private-assets/` and ship only inside builds. |
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
| 16 | [Street track S0–S8: walkable Kadıköy](16-street-layer.md) | G · On foot | L×many | 01 (bug fixes only) |

Effort: S ≈ half a workflow session, M ≈ one workflow session, L ≈ two or more sessions.

Order (since 24 September 2026): 01 (bugs and performance only) → 16 S0–S2 (compiler, one Kadıköy strip, runtime
decision) → S3–S5 (walk, enter and talk, the heart of Kadıköy) → S6 (sky to street, absorbs the tiling of 08/09 and the
landing pads of 03/04) → S7 (drive) → S8 (chapter one). Flight-only phases 02 and 05–07 fit in between when they do not
touch the street layer. Parked until the Kadıköy slice ships: 11, 12, 14, 15. Phase 10's rider becomes a CC0 human
(MetaHuman + Mixamo clips, kept in the private asset store).

## Working method

- Each phase runs as its own workflow: one builder agent per module, then a single review + fix round.
- Usage limits drive pacing: check the limit before starting a phase and size the number of parallel agents accordingly.
- Contracts change through `src/core/contracts.ts`; any contract change a phase needs is made once, up front, by one
  owner; module agents only touch their own folders.
- Verification: `node scripts/snap.mjs` for GPU screenshots + stats; every phase's acceptance criteria are written to be measurable with it.
- Checkpoints: a git commit before and after each phase.
