# Phase 19 — Moments: references, legends and city life

Milestone: E · Variety · Effort: L · Depends on: 01 (bug fixes), 05 (thermals), 13 (living world)

Status: planned (agreed with the user on 25 September 2026). Nothing is built yet.

## Goal

Small, calm surprises placed on the real map: legends of the city, real city life and nods to films and series shot in
Istanbul. The player finds them by flying and landing; nothing is a mission or a fail state.

## Quality bar

- **No plastic look.** Characters, props and creatures must read as real material: textured and weathered surfaces,
  varied roughness (no uniform glossy or uniformly matte colour blocks), believable proportions and cloth, soft
  contact shadows, animation with weight and small idle motion. Use the approved CC0 texture sets and the facade /
  street weathering tools; judge every item in the game at landing distance next to a reference photo before it ships.
- **Stylised, not photographic, likeness** for anything that nods to a real person: an original character that evokes
  the scene, never a copy of an actor's face.
- Calm pacing: moments are short, skippable and never interrupt flight control.

## System: "Anlar" (moments)

Data-driven points on the map, one record per moment, so new ones are data, not code:

- **Place and trigger:** position / area, radius, on the ground or in the air, altitude band, time of day, season or
  date range, weather, once per session or repeatable, cooldown.
- **Content:** a character or object (model, idle and reaction animations), Turkish subtitled lines, sound, an
  optional camera hint, an optional discovery card.
- **External media:** an optional official video (YouTube embed of the rights holder's upload, start/end seconds),
  played in a small in-game panel. The media is streamed from YouTube, never stored in the repository.
- **Provenance:** every model, sound and text records its source and licence (CLAUDE.md rules); unapproved content
  cannot be referenced.

## Rights

The game is non-commercial, open source on GitHub and played in the browser.

- Clips or audio ripped from films and series are never committed (a DMCA notice can take the whole repository down).
  Real scenes are shown only through the rights holder's official YouTube upload, embedded.
- Characters that nod to real actors are original, stylised designs with our own lines.
- Legends, historic events and works whose authors died more than 70 years ago are free to use (e.g. Orhan Veli,
  died 1950; the Kadıköy Boğa sculpture, sculptor died 1901).

## Backlog (in order)

1. **Moments system:** the data format, triggers, subtitles, discovery-card integration, the video panel.
2. **Stork and raptor migration over the Bosphorus** (autumn): flocks circling in thermals the dragon can join
   (brings the thermal lift of phase 05).
3. **Hezarfen Ahmed Çelebi:** a ghost glider leaving the Galata Tower for Üsküdar; race it across the Bosphorus.
4. **Gull and simit, ferry moments:** a gull snatching a simit on a ferry (the dragon may do it too), dolphins
   jumping beside ferries, anglers on the Galata Bridge holding their hats when the dragon passes low.
5. **Aya Yorgi, Büyükada:** Saint George, the dragon slayer; a knight statue at the hilltop monastery "challenges"
   the dragon (a comic moment).
6. **Ezel, Eminönü fishing boat:** an original "wise uncle" character in front of the boat evoking Ramiz Dayı's scene,
   with the official scene embedded. Waiting for the user's location and video link.
7. **Lagari Hasan Çelebi:** the 1633 rocket from Sarayburnu; chase it and catch him before he lands in the sea.
8. **Ships over land, 1453:** ghost ships sliding from the Kasımpaşa hills into the Golden Horn, briefly at night.
9. **Kız Kulesi legend:** the princess and the snake, a small snake character and a told story near the tower at night.
10. **Kadıköy Boğa:** the bull sculpture modelled, with a small moment around it.
11. **Film locations:** a low rooftop run over the Grand Bazaar (Skyfall's opening chase), the Basilica Cistern
    entrance (From Russia with Love, the Medusa heads), the Museum of Innocence in Çukurcuma; more series and films
    chosen by the user, each with its official video.
12. **Istanbul postcards:** recreate famous views in photo mode to collect them (Kız Kulesi at sunset, the Galata
    skyline, fog under the Bosphorus Bridge).
13. **Optional audio guide:** short narrated histories of landmarks, our own text.
14. **Orhan Veli, "İstanbul'u Dinliyorum":** lines appear as subtitles while gliding low along the shore.
15. **Days and seasons** (with phase 13): Ramadan cannon and iftar lights, New Year fireworks, lodos waves on the
    Kadıköy shore, foghorns on misty mornings, match-day crowd sounds near stadiums (CC0 recordings, no real chants
    or club symbols).
