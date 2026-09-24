# Hamallar — co-op moving game in Kadıköy

Milestone: H · Co-op · Effort: L×many · Depends on: 16 S4 (walk, enter, talk) and the S2 runtime decision

Decided 2026-09-24 as the co-op direction: a small-area co-op game built on the walkable Kadıköy street layer, fun
for friend groups and streamers to play together, and crafted rather than a cheap gimmick.

## Pitch

2–4 players run a small moving and delivery crew (*hamal* team) in Kadıköy. They carry pianos, fridges, sofas,
antiques and fragile boxes through real streets: narrow apartment stairwells, the Moda slopes, the crowded çarşı,
the tram on Bahariye and the ferry at the Rıhtım. Broken items come off the pay, clients comment, the clock runs.
Physics and proximity voice turn every job into shared comedy; the real city makes it recognisable and new.

## Why this concept

- **Proven streamer loop:** carrying fragile valuables with physics under pressure (R.E.P.O., 2025) and co-op moving
  (Moving Out) produce friction, laughter and clips; proximity voice and physics drive the "friendslop" genre that
  keeps topping co-op viewership (Lethal Company, PEAK, Meccha Chameleon in 2026).
- **Unique setting:** no other game has a walkable, realistic Kadıköy. The *hamal* is an iconic Istanbul figure.
- **Reuses the street track directly:** streets and crowds (S1/S5), apartment stairwell and shop interiors (L3 shells),
  NPCs and ink dialogue (S4), vehicles (S7). A small area is enough.
- **Fits the tone:** chaotic but warm; no horror, no violence; the chill flight game stays the other side of Evren.

## Core loop (one job, 15–25 minutes)

1. Pick a job at the crew's base (a han courtyard off the çarşı): pickup, destination, items, time, pay, special
   conditions (antique, piano, "the client is watching", rain).
2. Plan the route: van where cars can go; by hand, trolley or *semer* (carrying saddle) through pedestrian lanes;
   the tram or a ferry for cross-town jobs.
3. Carry together: shared physics objects that need 1–4 people, stamina, balance on stairs and slopes, doors and
   corners that need rotating, crowds and street stalls in the way.
4. Deliver: the client inspects damage, pays, tips or complains (ink dialogue, barks).
5. Between jobs: upgrade tools (straps, trolleys, a better van), unlock districts and item types, crew cosmetics.

## Variety

- Buildings with different stairwells (1950–70s apartments, a late-Ottoman house with a wooden stair, a modern block
  with a tiny lift), rooftop and balcony hoists (rope and pulley through the window, as done in Istanbul).
- Items with their own physics and rules: piano (heavy, 4 people), fridge (must stay upright), aquarium (sloshes),
  antique mirror (fragile, reflective), cat carrier (moves by itself), mattress (flops).
- Street events: çarşı delivery hours, a match day near the stadium, the tram blocking the lane, a wedding convoy.
- Day and night jobs; weather.

## Modes (later)

- **Kalabalığa karış** (hide in the crowd): on the same map, some players act as NPCs in the çarşı crowd while others
  try to spot them. Cheap to add once the crowd exists; strong streamer mode.
- **Vapur crew** (ferry co-op sim) as a separate, calmer mode if the ferry systems are reused.

## Technical requirements

- **Networking:** host-authoritative, 2–4 players, shared rigid bodies with ownership hand-off while carrying,
  client-side prediction for the carrier, interpolation for others; tolerant of 150 ms latency.
- **Platform:** a desktop Steam build (lobbies, invites, friends, achievements, Steam Deck check). Runtime paths:
  Godot 4.7 + GodotSteam, or three.js packaged with Electron/Tauri + steamworks.js. Compared in S2 ("co-op readiness").
- **Voice:** proximity voice chat (Steam voice or an open-source WebRTC layer), push-to-talk option.
- **Streamer mode:** no licensed music, hidden lobby codes, optional chat-driven events (viewers vote on the next
  street event) later.
- **Characters:** MetaHuman crew with Mixamo carry, lift, push, fall and cheer clips; ragdoll on falls.
- **Content scope:** Kadıköy core first (the S5 area plus Moda slopes), 8–12 buildings with interiors, 20–30 item
  types, 3 vehicles.

## Milestones

| # | Milestone | Deliverable |
|---|---|---|
| H0 | Co-op spike (inside S2) | Two players carry one box together over the network in both runtimes; Steam lobby and voice checked |
| H1 | Carry prototype | 2 players, 3 items (box, fridge, piano) from a van up one apartment stairwell on the S1 strip |
| H2 | One full job | Job board, route, delivery, damage and pay, one client dialogue, 4 players |
| H3 | Vertical slice | 5 jobs across Kadıköy core, stamina and balance, trolley and *semer*, tram and ferry use, progression |
| H4 | Steam playtest | Closed playtest with a few streamers; tune fun, clips and difficulty |

## Risks

- Networked physics with shared carried objects is the hardest part; keep player count at 4 and the host
  authoritative, and prototype it first (H0) before content.
- Realistic visuals must not slow the comedy: readability of items and damage comes before detail.
- Scope creep: one district, capped buildings and items until H4 proves the fun.
- Cultural tone: affectionate, never mocking the profession; consult real *hamal* practice for tools and techniques.
