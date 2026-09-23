# Phase 03 — Viewpoints (perch system)

Milestone: B · Chill loop · Effort: M · Depends on: 01, 02

## Goal

Land the dragon on specific spots and watch the city: settle on top of a bridge tower and look over the Bosphorus,
watch the sunset from Çamlıca. The core of the chill loop.

## Viewpoints (initial list)

| Point | Type | Note |
|---|---|---|
| 15 Temmuz Şehitler Köprüsü tower top | Tower | 165 m, both shores of the Bosphorus |
| FSM Köprüsü tower top | Tower | View over Rumeli Hisarı |
| Yavuz Sultan Selim Köprüsü tower top | Tower | 322 m, highest point, Black Sea entrance |
| Galata Kulesi cap | Tower | Historic peninsula and the Golden Horn |
| Süleymaniye dome | Dome | Golden Horn and Galata |
| Kız Kulesi | Islet | At sea level, Üsküdar and Sarayburnu |
| Rumeli Hisarı, Zağanos Paşa tower | Bastion | The narrowest point of the Bosphorus |
| Büyük Çamlıca hill | Hill | Whole city, sunset |
| Otağtepe | Hill | Looking down on the FSM bridge |
| Pierre Loti hill | Hill | The classic Golden Horn view |
| Istanbul Sapphire roof | Skyscraper | Levent and the Bosphorus |
| Büyükada, Aya Yorgi hill | Hill | Princes' Islands and the Marmara |
| Aydos hill | Hill | Asian side, highest natural point |
| Yuşa Tepesi | Hill | Black Sea mouth of the Bosphorus |

## Gameplay

1. On approach a subtle marker and a "Press L to land" hint appear (distance < 400 m, slow enough).
2. Perch landing: the dragon brakes with its wings, grips with its claws, balances with its wings and wraps its tail
   around the structure (animation: [Phase 04](04-landing-takeoff-variety.md)).
3. Viewing mode:
   - The camera switches to a slow cinematic orbit; free mouse look; rider POV selectable.
   - Calm regional music starts ([Phase 07](07-regional-music.md)).
   - Stamina refills.
   - Place name and a short info text on screen.
4. Time-lapse: hold a key to watch the sunset or the city lights switching on within seconds.
5. Photo mode opens from this screen with one key.
6. Leaving: Space triggers the "drop off" takeoff (free-fall feel from [Phase 05](05-flight-feel.md)).

## Technical approach

- Contract: `PerchPoint { id, name, position, headingDeg, surface: 'tower'|'dome'|'hill'|'roof'|'rock', gripRadius, info }`.
  Points are registered into a `perches` service by the owning module (tower tops by structures, domes by mosques, hills by geo).
- Flight: new `perched` mode; approach path (align with the target, brake, automatic guidance in the last 20 m); grip
  point from the collision world's top surface.
- Camera: `perch` cinematic mode (slow orbit, framed views).
- UI: approach marker, viewing screen, info merged with the discovery card; viewpoint icons on the minimap.
- Audio and music: viewing-music trigger, wind sound fades down.

## Acceptance criteria

- The dragon can land on each of the 14 points without clipping into the structure or hovering above it.
- In viewing mode the camera orbits for 60 s without collisions; framed views approved with sunset and night screenshots.
- Time-lapse and photo mode work.
- After takeoff control returns to the player within 2 s.
