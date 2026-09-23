# Phase 09 — Materials, street detail and traffic

Milestone: C · Realistic city · Effort: L · Depends on: 08

## Goal

Buildings, roads and cars look real up close, and traffic flows properly along the roads.

## Scope

### Materials
- CC0 PBR texture sets (Poly Haven, ambientCG): plaster, stone, brick, roof tiles, asphalt, cobblestone, concrete.
  Albedo, normal and roughness; texture arrays compressed with KTX2/Basis.
- Facade shader: real textures + procedural window grid and grime; a material palette per district (stone and timber
  on the historic peninsula, plaster in Kadıköy, glass in Levent).
- Roofs: tile textures, hip ridges, chimneys, water tanks, solar panels, satellite dishes.
- Roads: lane markings, crosswalks, kerbs, manholes and patch marks (decals).

### Street detail
- Street lights along the real road network (pools of light at night), traffic lights, bus stops.
- Tree-lined avenues (Bağdat Caddesi, Barbaros), tram tracks (Kabataş–Bağcılar, Kadıköy–Moda).
- Piers, quays, seaside promenades.

### Traffic
- Vehicle simulation on the real road graph (Phase 08): lane following, following distance, slowing at junctions and
  traffic lights, congestion on bridges and time-of-day traffic (busy mornings and evenings).
- **Sitting on the road surface:** Vehicles are always placed from a road-surface query (terrain, viaduct or bridge deck)
  and tilt with the slope on hills. The general form of the Phase 01 bridge fix.
- Vehicle types (procedural, 3 LODs): car, taxi (yellow), dolmuş, İETT bus, metrobüs, truck, tram.
- Headlights and brake lights at night (existing light streams attached to real vehicles); only light points at a distance.
- The metrobüs runs in its own lane in the middle of the E-5; ferry and sea-bus routes stay in the existing life module.

## Technical approach

- `RoadSurfaceService`: `surfaceAt(x, z, roadId?) → { y, normal }`; merges terrain, viaducts and bridge decks.
  Used by traffic, street detail and the landing system.
- Traffic simulation runs in a worker; only instance matrices are transferred to the main thread.
- Texture budget: texture arrays ≤ 256 MB of GPU memory in total ("high").

## Acceptance criteria

- Cars sit on the surface on all roads and bridges (±0.2 m); no floating or buried vehicles on bridge ramps.
- `?view=galata` close-up at 30 m altitude: facade, roof and road textures look realistic; no obvious tiling.
- At night the street lights follow the road network.
- Performance: traffic ≤ 0.5 ms CPU; total draw-call increase ≤ 60.
