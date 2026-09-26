# Phase 19 — Moments: references, legends and city life

Milestone: E · Variety · Effort: L · Depends on: 01 (bug fixes), 05 (thermals), 13 (living world)

Status: in progress. Planned with the user on 25 September 2026. Built: the record format, the pure trigger evaluator,
the settings (Ayarlar → Oyun → Anlar) and, since 26 September 2026, the **runtime**: moments play in the game. Playable
today: the Orhan Veli poem and the gull and simit on a ferry (procedural flock anchored to the ferries in service); every
other record waits for its assets (see "Runtime" below).

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

## Runtime (built 26 September 2026)

Code: `src/moments/runtime.ts` (pure: playability, pacing, subtitle timeline), `src/moments/system.ts` (the game
system, registered in `src/main.ts`), `src/moments/view.ts` + `moments.css` (subtitle line and closing card).

- **Context.** Every frame the system reads the dragon (position → coast distance from geo, AGL, ASL, flight mode,
  grounded), the clock (time of day, day of year), the weather preset, the race context and the **moving anchors**, and
  hands it to the pure evaluator with the player's settings. Positions stay in world meters; the records' lat/lon are
  projected with `latLonToLocal()`.
- **Moving anchors** (`src/moments/anchors.ts`). A record's place may name an anchor instead of (or besides) a centre:
  the moment is in range within `radius` of any of the anchor's current positions. The game supplies `ferry`: the vapurs
  and city ferries (double-enders) in service, i.e. underway on their line and going ahead faster than 2 m/s, read every
  frame from the living world's new `life` service (`src/world/life/life-service.ts`: vessel poses by kind, by id).
  Each anchor point carries the vessel id; the runner remembers the anchor nearest to the dragon when a moment starts
  (`MomentRunner.currentAnchor`), and while it plays the anchor radius gets 100 m of hysteresis (the ferry pulls away
  while the dragon watches). `moments-check` accepts an anchored `ready` record only for anchors the game supplies.
- **Actors** (`src/moments/actors/`). Procedural scene content registered by the record's `actorId`: built when the
  moment starts, updated every running frame, told when the lines are over, and disposed once it has wound down. Nothing
  exists (no meshes, no simulation) while no moment with an actor plays. An actor that plays its own sound counts as the
  moment's sound (no ambience lift for it).
- **Pacing.** One moment at a time. A moment starts after its trigger held for 1 s; after a moment another may start
  only after a 180 s gap; records keep their own once-per-session / cooldown rules. Nothing starts or continues during a
  race, and nothing advances while the game is paused (menus, map, photo mode). The settings gate playback: a category
  switched off (or Anlar off) never starts and ends a playing moment of that category.
- **Never takes control.** While a moment plays its conditions are re-checked with a little hysteresis (altitude band
  ±15 m, shore band ±60 m, flapping allowed during a glide). When they fail for 1.2 s (the dragon climbs out of the
  band, leaves the shore, lands, rain starts) the line on screen fades out slowly and the rest is skipped. A moment cut
  short before half of its lines is not spent and may try again after 90 s; one cut later is spent.
- **Screen.** Subtitle lines go through the HUD zone director in the `lowerCenter` zone (priority 45: below maneuver
  captions, above flight and start hints; deferred by a race): italic, shadowed, no box, slow fades. The closing card
  uses the discovery card's look in the `corner` zone ("Yeni an", category, title, text; 9 s). Design language updated.
- **Sound.** For a moment whose sound is missing the runtime asks the audio service to lift the existing coastal
  ambience (`setAmbienceLift`: surf forward, city back), so no new external asset is needed. Actors place their own
  sounds through `audio.playAt()` (the ferry gulls: the approved CC0 gull calls and synthesized wing beats).
- **Playability decision.** A `ready` record plays. A `draft` record plays only when its content is complete for what
  it is: a subtitle-only moment (no character, object or animation) whose single need is `sound` plays, because the
  soft bed is optional there and the ambience lift stands in for it. Anything needing a model, an animation, a video
  link, a runtime anchor or text approval waits; in dev the console logs each skipped record once with its reason.
- **Shortcut.** `?moment=<id>` puts the dragon at the record's `start` waypoint (heading for the next waypoint) once
  the game starts and plays that moment once, whatever the conditions (still not during a race). For an anchored
  moment it waits (up to 90 s, the fleet loads late) for an anchor in service, puts the dragon beside it and plays the
  moment at that anchor.
- **Checks.** `tools/headless/moments-runtime-check.ts` flies a scripted low glide along the European shore from
  Beşiktaş to Bebek on the real geography: the poem fires exactly once, after the dwell, with the record's timeline
  (4 s lines, 0.5 s gaps) and the card at the end; it does not fire high, inland, in rain or storm, while flapping,
  during a race or with its category off; pause, hysteresis, fade-out, retry, race / settings cut-off, the global gap
  and the shortcut are covered; the corridor polygon is verified to cover all of the strait's water and both shores
  (its north end was extended to the Black Sea mouth, 41.24° N). Its section 5 covers the ferry moment on the real
  geography with the anchor feed (see below). `tools/headless/moments-gulls-check.ts` covers the gull flock.

### Playable now vs waiting

| Moment | Plays now? | Why |
|---|---|---|
| Orhan Veli, "İstanbul'u Dinliyorum" (#14) | yes | subtitle-only; its soft shore bed is replaced by the lifted coastal ambience |
| Storks over the Bosphorus (#2) | no | needs the stork flock model, animations and sound |
| Hezarfen Ahmed Çelebi (#3) | no | needs the ghost glider model, animations and sound |
| Gull and simit on a ferry (#4) | yes | procedural gull flock and simit pieces at the ferries in service; CC0 gull calls |
| Galata Bridge anglers (#4) | no | needs the angler models, animations and sound |
| Aya Yorgi challenge (#5) | no | needs the knight statue model, animations and sound (and the hilltop point confirmed) |
| Lagari Hasan Çelebi (#7) | no | needs the rocket model, animations and sound |
| Ships over land, 1453 (#8) | no | needs the galley model, animations and sound |
| Kız Kulesi legend (#9) | no | needs the snake model, animations and sound |

### Gull and simit on a ferry (built 26 September 2026)

The classic vapur scene: someone at the stern rail breaks a simit and tosses the pieces; gulls hang almost still in the
ferry's slipstream, peel off and snatch them in the air, and pick the ones that fall from the water.

- **Trigger** (`src/moments/data/city-life.ts`, `ferry-gull-simit`, `ready`): within 250 m of a ferry in service
  (`ferry` anchor), up to 60 m above the surface, flying, gliding, hovering or perched (on the ferry too; not diving,
  swimming or under water), 07:00–20:00, clear, hazy or foggy weather (not rain or storm); repeatable after 600 s
  (plus the global 180 s gap between moments). The record's old 60 m radius and 40 m ceiling were too tight for a
  dragon with a 20 m wingspan; while playing the radius grows to 350 m.
- **Lines** (Turkish, own text): "Vapurun arkasında biri simidini bölüp martılara atıyor." · "Martılar rüzgârda asılı
  duruyor, parçayı havada kapıyorlar." · Martı: "Yanında çay da var mı?"; the card "Martı ve Simit" at the end.
- **Actor** (`src/moments/actors/gull-simit/`): `flock.ts` is the pure simulation (no three.js), `actor.ts` renders it
  (one instanced mesh of gulls with the ambient bird shader, one of simit pieces) and places the sounds, `geometry.ts`
  builds the gull (the ambient gull plus a yellow bill with the red gonys spot, region 5 of the bird shader: grey mantle,
  white body, black wingtips) and the simit piece (a ~100° arc of a sesame ring, crust with seeds, pale crumb on the
  broken ends, drawn 1.5x so it reads at gull distance). 18–36 gulls by the quality's bird budget (≤ 40).
  - Each gull has its own slot 2.5–21 m behind the ferry's trailing end, around rail height, in the ship's frame, with
    a slow personal drift and small wing adjustments; slots are spaced ≥ 3.6 m apart. The flock follows the ferry
    through its turns with the ship's velocity plus a spring toward the slot.
  - Every 2.6–5.5 s (sometimes two at once) a piece leaves the stern rail in an arc (gravity, air drag); one to three
    nearby gulls chase it with a lead and catch it with the bill in the air; it hangs from the bill for a second. A
    piece that falls in the water is picked by one gull (glide down, sit, pick, climb away). Pieces float 14 s at most.
  - The dragon: gulls within 42 m flee (away and up, flapping), come back once it is 57 m away, and their slots are
    pushed out to 50 m around it, so they regroup further back while it hovers at the stern.
  - Hard constraints after the steering every sub-step: no two gull centres closer than 1.6 m (wingspan 1.35 m), no
    gull inside the ship's box (length × beam × air draft, plus 0.8 m). Sub-steps ≤ 1/60 s.
  - The ferry's ambient gulls (world/life/birds, ~12 per vapur) are handed over to the moment's flock through the
    `life` service when it starts (no bird pops in) and handed back when it ends; the extra gulls fly in from 70–150 m
    aft, out of the close view, and fly off again at the end (vanishing ≥ 150 m from the camera).
  - The scene lingers after the lines while the dragon stays within 350 m of the ferry (up to 150 s after the start),
    then winds down.
- **Sound:** sparse gull calls from the approved CC0 recordings (`public/audio/gull/calls`, ~every 3.4 s on average,
  catches call more often, calls ≥ 0.9 s apart), placed at the calling bird; soft synthesized wing beats of the gull
  nearest to the camera when one flaps hard within 24 m. The ferry's engine and wake beds are untouched.
- **Cost:** CPU 0.02–0.05 ms per frame for 36 gulls (headless), zero while no ferry moment plays.
- **Checks:** `moments-runtime-check` section 5 (fires gliding, hovering or perched near a ferry in service and names
  it; not 300 m or 1 km away, not at a stopped ferry, not at night or before dawn, in rain or storm, high above, diving,
  swimming, in a race or with city life off, not along a shore without ferries; hold, fade-out, cooldown, forced anchor,
  shortcut pose). `moments-gulls-check` (scripted vapur with a 170° turn and heave: gulls stay by the stern anchor, catches
  in the air and from the water, no overlaps, no hull intersections, the dragon scattering them and their regrouping,
  1/24, 1/60, 1/144 s frames and hitches, wind-down and hand-back, CPU; plus two minutes behind a real vapur of the
  living world through the anchor feed). `moments-gulls-sheet` draws the gull poses and the simit piece
  (`.shots/moments/gulls/`).

**Where to see the gulls:** fly low (under ~60 m) and slow within ~250 m of a vapur or city ferry that is under way, in
daytime (07:00–20:00) and not in rain or storm: e.g. the Eminönü / Karaköy – Kadıköy vapurs crossing the harbour mouth,
the Kabataş – Adalar vapurs over the Marmara, the Boğaz turu vapur, or the Üsküdar double-enders. Hovering beside the
stern or gliding alongside it is best; the first line appears after a second. Or open the game with
`?moment=ferry-gull-simit`: after the start screen the dragon waits for a ferry in service in open water, hovers 48 m
off its beam just ahead of the stern, facing it, and the moment plays at that ferry.

**Where to see the poem:** glide (wings still, no flapping) at 20–30 m over the water within ~150 m of the European
shore, anywhere from Beşiktaş past Ortaköy and Kuruçeşme toward Bebek, in clear, hazy or foggy weather; the first line
appears after a second of steady low gliding. Once per session. Or open the game with
`?moment=orhan-veli-istanbulu-dinliyorum`: after the start screen the dragon is placed off Beşiktaş, heading up the
shore, and the poem plays.

## Rights

The game is non-commercial, open source on GitHub and played in the browser.

- Clips or audio ripped from films and series are never committed (a DMCA notice can take the whole repository down).
  Real scenes are shown only through the rights holder's official YouTube upload, embedded.
- Characters that nod to real actors are original, stylised designs with our own lines.
- Legends, historic events and works whose authors died more than 70 years ago are free to use (e.g. Orhan Veli,
  died 1950; the Kadıköy Boğa sculpture, sculptor died 1901).

## Backlog (in order)

1. **Moments system:** the data format, triggers, subtitles, discovery-card integration (built), the video panel (not
   built yet).
2. **Stork and raptor migration over the Bosphorus** (autumn): flocks circling in thermals the dragon can join
   (brings the thermal lift of phase 05).
3. **Hezarfen Ahmed Çelebi:** a ghost glider leaving the Galata Tower for Üsküdar; race it across the Bosphorus.
4. **Gull and simit, ferry moments:** gulls snatching simit behind a ferry (playable; the dragon snatching one too is
   future gameplay), dolphins jumping beside ferries, anglers on the Galata Bridge holding their hats when the dragon
   passes low.
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
14. **Orhan Veli, "İstanbul'u Dinliyorum":** lines appear as subtitles while gliding low along the shore. (Playable.)
15. **Days and seasons** (with phase 13): Ramadan cannon and iftar lights, New Year fireworks, lodos waves on the
    Kadıköy shore, foghorns on misty mornings, match-day crowd sounds near stadiums (CC0 recordings, no real chants
    or club symbols).
