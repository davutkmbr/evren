# Phase 19 — Moments: references, legends and city life

Milestone: E · Variety · Effort: L · Depends on: 01 (bug fixes), 05 (thermals), 13 (living world)

Status: in progress. Planned with the user on 25 September 2026. Built: the record format, the pure trigger evaluator,
the settings (Ayarlar → Oyun → Anlar) and, since 26 September 2026, the **runtime**: moments play in the game. Playable
today: the Orhan Veli poem and the stork migration over the Bosphorus (procedural flock, see "Storks" below); every
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
  grounded), the clock (time of day, day of year), the weather preset and the race context, and hands it to the pure
  evaluator with the player's settings. Positions stay in world meters; the records' lat/lon are projected with
  `latLonToLocal()`.
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
- **Sound.** Moment sounds are synthesised (no external recordings); `src/moments/content.ts` lists the ones that
  exist (today the storks'). For a moment whose sound is missing the runtime asks the audio service to lift the
  existing coastal ambience (`setAmbienceLift`: surf forward, city back), so no new external asset is needed. The
  audio service also takes positional moment cues (`momentCue`) and a soft open-air wind bed (`setMomentBed`).
- **Procedural content and actors.** `src/moments/content.ts` names every actor, animation and sound built in code;
  `src/moments/actors.ts` maps actor ids to scene implementations. When a moment with an actor starts, the system
  spawns the actor (sink `startMoment`), tells it when the lines end (`endMoment`) and updates it every running frame
  while it is alive; an actor may outlive its lines (the storks glide away and fade). With no actor alive nothing is
  simulated or drawn.
- **Playability decision.** A `ready` record plays when its actor and animations resolve to procedural content
  (moments-check also requires its sound to resolve). A `draft` record plays only when its content is complete for
  what it is: a subtitle-only moment (no character, object or animation) whose single need is `sound` plays, because
  the soft bed is optional there and the ambience lift stands in for it. Anything needing a model, an animation, a
  video link, a runtime anchor or text approval waits; in dev the console logs each skipped record once with its
  reason.
- **Shortcut.** `?moment=<id>` puts the dragon at the record's `start` waypoint (heading for the next waypoint, inside
  the altitude band: 70 % of a ceiling, or a fifth of the way up a band with a floor) once the game starts and plays
  that moment once, whatever the conditions (date, time, weather, place; still not during a race).
- **Checks.** `tools/headless/moments-runtime-check.ts` flies a scripted low glide along the European shore from
  Beşiktaş to Bebek on the real geography: the poem fires exactly once, after the dwell, with the record's timeline
  (4 s lines, 0.5 s gaps) and the card at the end; it does not fire high, inland, in rain or storm, while flapping,
  during a race or with its category off; pause, hysteresis, fade-out, retry, race / settings cut-off, the global gap
  and the shortcut are covered; the corridor polygon is verified to cover all of the strait's water and both shores
  (its north end was extended to the Black Sea mouth, 41.24° N). Section 5 covers the storks (below).

### Playable now vs waiting

| Moment | Plays now? | Why |
|---|---|---|
| Orhan Veli, "İstanbul'u Dinliyorum" (#14) | yes | subtitle-only; its soft shore bed is replaced by the lifted coastal ambience |
| Storks over the Bosphorus (#2) | yes | procedural white-stork flock, wing poses and synthesised sounds (`ready`) |
| Hezarfen Ahmed Çelebi (#3) | no | needs the ghost glider model, animations and sound |
| Gull and simit on a ferry (#4) | no | needs models, animations, sound and the ferry runtime anchor |
| Galata Bridge anglers (#4) | no | needs the angler models, animations and sound |
| Aya Yorgi challenge (#5) | no | needs the knight statue model, animations and sound (and the hilltop point confirmed) |
| Lagari Hasan Çelebi (#7) | no | needs the rocket model, animations and sound |
| Ships over land, 1453 (#8) | no | needs the galley model, animations and sound |
| Kız Kulesi legend (#9) | no | needs the snake model, animations and sound |

**Where to see the poem:** glide (wings still, no flapping) at 20–30 m over the water within ~150 m of the European
shore, anywhere from Beşiktaş past Ortaköy and Kuruçeşme toward Bebek, in clear, hazy or foggy weather; the first line
appears after a second of steady low gliding. Once per session. Or open the game with
`?moment=orhan-veli-istanbulu-dinliyorum`: after the start screen the dragon is placed off Beşiktaş, heading up the
shore, and the poem plays.

## Storks over the Bosphorus (playable, 26 September 2026)

"Boğaz'da Leylek Göçü" (record `storks-bosphorus-migration`, `src/moments/data/city-life.ts`). Everything is built in
code: no external model, texture or recording.

**Where, when, how to see it.** Fly (any flight mode) at **150–1500 m above sea level** anywhere over the Bosphorus
corridor (Sarayburnu to the Black Sea mouth, both shores), between **15 August and 15 October**, **09:00–17:00**, in
**clear or hazy** weather. After a second in the band the first line appears and a kettle of storks rises 320–1000 m
ahead of the dragon (it picks the strongest thermal of the lift field in view). Repeatable every 30 minutes (and the
global 3-minute gap between moments applies). The game starts on 23 September at 18:00, so set the clock to daytime
first (`[` / `]`, or `?t=11`). Shortcut: `?moment=storks-bosphorus-migration` puts the dragon mid-strait off Kandilli
at 420 m, heading for the Rumelihisarı narrows, and plays the moment 2.5 s later whatever the date, time and weather
(add `&t=11` for daylight if the clock is late).

**The stork** (`src/moments/storks/stork-model.ts`, material `stork-material.ts`): real size (2.0 m wingspan, bill tip
to tail 1.15 m), long neck held out and a little low, long red bill, red legs trailing ~0.2 m past the short white
tail; broad arm, six separated "fingered" primaries. White body and coverts, black secondaries (a jagged covert
edge) and a black hand. Wing pose in the vertex shader: shoulder and wrist dihedral, arm and hand sweep, finger fan
and upward tip curl under load; soaring (flat, fingers fanned and curled), gliding (hands swept back, fingers closed),
slow deep flaps (~2 Hz); idle flutter of the tips. No plastic look: per-bird brightness and warmth, soft body
feathering and a greyer belly, feather striation on the black flight feathers, high roughness on the plumage, a
glossier bill; about a third of the flock are juveniles (duller flight feathers, dark bill, paler legs). LODs: near
602 triangles, far 112 (from 240 m); birds shrink away 2.3–2.9 km from the camera. Pose sheet:
`npx tsx tools/headless/storks-sheet.ts` → `.shots/moments/storks/` (poses × views, LODs, the kettle).

**Behaviour** (`flock-sim.ts`): the kettle is a rotating column; every stork circles the column's axis on its own
circle (18–72 m, 11.5 m/s airspeed, banked into the turn, all turning one way), climbing with the thermal minus its
sink (1–3 m/s; ~2 m/s typical). The column drifts with the game's wind (`env.wind`) and leans downwind with height;
every 2 s the flock re-centres on the lift field's thermal core. Near the top storks peel off when heading along the
course and glide in a loose stream to the south (185° ± 15°, the eastern flyway continues south to south-east over
Anatolia) at 15 m/s, sinking 1.25 m/s (glide ratio ~12), crabbing into the wind and drifting with it. Flaps are
occasional (~3 % of bird-frames): at the thermal's base, to regain a place in the stream, and when frightened.
Separation through a spatial hash plus a hard 2.6 m minimum distance (no intersections). The dragon: storks within
~60 m (and on its predicted path, 3 s ahead) spread away, drop and flap; nobody gets inside 22 m of its centre; they
calm down within ~6–8 s and drift back into their circles.

**Moment content.** Four lines (improved wording) and the card; the flock lives on after the lines (the kettle empties
into the stream over ~2–3 minutes), fades out far away and is removed when nothing is visible (at most 7 minutes). A
race or switching city life off fades it out in 3 s.

**Sound** (`src/audio/sfx/storks.ts`, `src/audio/voices/moment.ts`), deliberately sparse because storks have no song
and are almost silent in flight: a soft open-air wind bed while the flock is near (or the lines play), a faint wing
beat when a flapping stork is within ~45 m, an air rush when one passes within ~14 m, and every 18–45 s a short bill
clatter (the stork's only real voice, a wooden rattle speeding up and slowing down) from a stork within ~220 m.

**Performance.** Up to 400 birds on high and ultra (220 medium, 120 low); simulation + instance buffers ~0.15–0.2 ms per
frame for 400 in Node (budget 0.3 ms); two instanced draws (near + far LOD); nothing simulated or in the scene while
no flock is alive.

**Checks.** `tools/headless/storks-check.ts`: model size and poses, instance matrices vs three.js, kettle rotation
(period ~28 s), climb (~2 m/s), glide ratio (~12), occasional flapping, no intersections and no NaNs over 4 minutes,
dragon fly-through / dive / circling in the kettle / hovering (closest ≥ 22 m, the soft dodge does the work, calm
again after), dt robustness from 4 to 144 fps and jitter, the budget. `moments-runtime-check` section 5 covers the
trigger windows, the cooldown, the shortcut and the kettle sites on the real geography.

**Tunables.** `STORK` in `flock-sim.ts` (speeds, sinks, climb band, orbit radii, lean, separation, dragon radii, alarm
decay, flap rate), `STORK_SITE` in `site.ts` (search ring and cone, kettle depth, minimum updraft, course),
`STORK_COUNT` / `LIFE` in `stork-actor.ts` (flock size per quality, lifetime and fades), `STORK_LOD` in
`stork-instances.ts` (LOD and fade distances), the `SOUND` ranges in `stork-actor.ts`, and `MIX.stork*` /
`MOMENT_BED_LEVEL` in the audio engine.

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
   (brings the thermal lift of phase 05). (Storks playable; raptors not built yet.)
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
14. **Orhan Veli, "İstanbul'u Dinliyorum":** lines appear as subtitles while gliding low along the shore. (Playable.)
15. **Days and seasons** (with phase 13): Ramadan cannon and iftar lights, New Year fireworks, lodos waves on the
    Kadıköy shore, foghorns on misty mornings, match-day crowd sounds near stadiums (CC0 recordings, no real chants
    or club symbols).
