# Phase 19 — Moments: references, legends and city life

Milestone: E · Variety · Effort: L · Depends on: 01 (bug fixes), 05 (thermals), 13 (living world)

Status: in progress. Planned with the user on 25 September 2026. Built: the record format, the pure trigger evaluator,
the settings (Ayarlar → Oyun → Anlar) and, since 26 September 2026, the **runtime**: moments play in the game. Playable
today: the Orhan Veli poem, the stork migration over the Bosphorus (procedural flock, see "Storks" below) and the gull
and simit on a ferry (procedural flock anchored to the ferries in service, see "Gull and simit on a ferry") and, since
26 September 2026, eight literary moments (backlog 16, see "Literary moments"); two more literary records wait for the
owner's text check and every other record waits for its assets (see "Runtime" below).

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
  played in a small in-game panel. The media is streamed from YouTube, never stored in the repository. Built as the
  moment's `sources` and the source sheet (see "Sources" below).
- **Provenance:** every model, sound and text records its source and licence (CLAUDE.md rules); unapproved content
  cannot be referenced.

## Runtime (built 26 September 2026)

Code: `src/moments/runtime.ts` (pure: playability, pacing, subtitle timeline), `src/moments/system.ts` (the game
system, registered in `src/main.ts`), `src/moments/view.ts` + `moments.css` (subtitle line and closing card).

- **Context.** Every frame the system reads the dragon (position → coast distance from geo, AGL, ASL, flight mode,
  grounded), the clock (time of day, day of year), the weather preset and the sea fog amount (`WeatherService.seaFog`,
  for the record condition `seaFog`: foggy mornings come with the clear or haze preset), the race context and the
  **moving anchors**, and
  hands it to the pure evaluator with the player's settings. Positions stay in world meters; the records' lat/lon are
  projected with `latLonToLocal()`.
- **Moving anchors** (`src/moments/anchors.ts`). A record's place may name an anchor instead of (or besides) a centre:
  the moment is in range within `radius` of any of the anchor's current positions. The game supplies `ferry`: the vapurs
  and city ferries (double-enders) in service, i.e. underway on their line and going ahead faster than 2 m/s, read every
  frame from the living world's new `life` service (`src/world/life/life-service.ts`: vessel poses by kind, by id).
  Each anchor point carries the vessel id; the runner remembers the anchor nearest to the dragon when a moment starts
  (`MomentRunner.currentAnchor`). `moments-check` accepts an anchored `ready` record only for anchors the game supplies.
- **Pacing.** One moment at a time. A moment starts after its trigger held for 1 s; after a moment another may start
  only after a 180 s gap; records keep their own once-per-session / cooldown rules. Nothing starts or continues during a
  race, and nothing advances while the game is paused (menus, map, photo mode). The settings gate playback: a category
  switched off (or Anlar off) never starts and ends a playing moment of that category.
- **Plays to its end.** Once a moment has started it runs to its last line whatever the dragon does: climbing out of
  the band, leaving the shore, flying away from the ferry, landing or a change of weather no longer cut it short
  (owner decision, 26 Sep: before, a moment cut by its conditions after 1.2 s did not start the global gap, so the next
  moment in range started at once and seemed to interrupt the first). Only a race and switching its category off end it
  early (the line fades out). Every end, early or not, starts the 180 s gap. A moment cut short before half of its
  lines is not spent and may try again after 90 s (and the gap); one cut later is spent.
- **Screen.** Subtitle lines go through the HUD zone director in the `lowerCenter` zone (priority 45: below maneuver
  captions, above flight and start hints; deferred by a race): italic, shadowed, no box, slow fades. The closing card
  uses the discovery card's look in the `corner` zone ("Yeni an", category, title, text; 9 s). Design language updated.
- **Sound.** Moment sounds are synthesised or reuse the already approved CC0 recordings (the gull calls);
  `src/moments/content.ts` lists the ones that exist (the storks' and the ferry gulls'). For a moment whose sound is missing the runtime asks the audio service to lift the
  existing coastal ambience (`setAmbienceLift`: surf forward, city back), so no new external asset is needed. The
  audio service also takes positional moment cues (`momentCue`: the storks' clatter, wing beats and pass; the ferry
  gulls' `gull-call` and `gull-wingbeat`) and a soft open-air wind bed (`setMomentBed`).
- **Procedural content and actors.** `src/moments/content.ts` names every actor, animation and sound built in code;
  `src/moments/actors.ts` maps actor ids to scene implementations. When a moment with an actor starts, the system
  spawns the actor (sink `startMoment`), tells it when the lines end (`endMoment`) and updates it every running frame
  while it is alive; an actor may outlive its lines (the storks glide away and fade; the ferry gulls linger while the
  dragon stays near the ferry). `startMoment` also passes the moving anchor the moment started at, so an anchored
  actor follows that object. With no actor alive nothing is simulated or drawn.
- **Playability decision.** A `ready` record plays when its actor and animations resolve to procedural content
  (moments-check also requires its sound to resolve). A `draft` record plays only when its content is complete for
  what it is: a subtitle-only moment (no character, object or animation) whose single need is `sound` plays, because
  the soft bed is optional there and the ambience lift stands in for it. Anything needing a model, an animation, a
  video link, a runtime anchor or text approval waits; in dev the console logs each skipped record once with its
  reason.
- **Shortcut.** `?moment=<id>` puts the dragon at the record's `start` waypoint (heading for the next waypoint, inside
  the altitude band: 70 % of a ceiling, or a fifth of the way up a band with a floor) once the game starts and plays
  that moment once, whatever the conditions (date, time, weather, place; still not during a race). For an anchored
  moment it waits (up to 90 s, the fleet loads late) for an anchor in service, puts the dragon beside it and plays the
  moment at that anchor.
- **Checks.** `tools/headless/moments-runtime-check.ts` flies a scripted low glide along the European shore from
  Beşiktaş to Bebek on the real geography: the poem fires exactly once, after the dwell, with the record's timeline
  (4 s lines, 0.5 s gaps) and the card at the end; it does not fire high, inland, in rain or storm, while flapping,
  during a race or with its category off; pause, playing to the end whatever the flight does, no overlap and the global gap after every end, retry, race / settings cut-off
  and the shortcut are covered; the corridor polygon is verified to cover all of the strait's water and both shores
  (its north end was extended to the Black Sea mouth, 41.24° N). Section 5 covers the storks, section 7 the ferry
  moment on the real geography with the anchor feed (below); `tools/headless/moments-gulls-check.ts` covers the gull
  flock.

### Playable now vs waiting

| Moment | Plays now? | Why |
|---|---|---|
| Orhan Veli, "İstanbul'u Dinliyorum" (#14) | yes | subtitle-only; its soft shore bed is replaced by the lifted coastal ambience |
| Storks over the Bosphorus (#2) | yes | procedural white-stork flock, wing poses and synthesised sounds (`ready`) |
| Hezarfen Ahmed Çelebi (#3) | no | needs the ghost glider model, animations and sound |
| Gull and simit on a ferry (#4) | yes | procedural gull flock and simit pieces at the ferries in service; CC0 gull calls |
| Galata Bridge anglers (#4) | no | needs the angler models, animations and sound |
| Aya Yorgi challenge (#5) | no | needs the knight statue model, animations and sound (and the hilltop point confirmed) |
| Lagari Hasan Çelebi (#7) | no | needs the rocket model, animations and sound |
| Ships over land, 1453 (#8) | no | needs the galley model, animations and sound |
| Kız Kulesi legend (#9) | no | needs the snake model, animations and sound |
| Literary moments (#16): Nedim, Kâtibim, Atı alan Üsküdar'ı geçti, Karagöz, Yağmur, Kuyrukluyıldız, Prokopios, De Amicis | yes | subtitle-only, text confirmed or ours (`ready`) |
| Literary moments (#16): Sinan's tomb inscription, Ahmet Haşim | no | text provenance pending: the owner checks the wording |

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
- **Actor** (`src/moments/gull-simit/`, registered in `src/moments/actors.ts` as `moments/ferry-gull-flock`): `flock.ts` is the pure simulation (no three.js), `actor.ts` renders it
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
- **Checks:** `moments-runtime-check` section 7 (fires gliding, hovering or perched near a ferry in service and names
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

## Literary moments (built 26 September 2026)

Ten texts chosen from `.docs/moments/candidates.md` (the owner delegated the choice) for variety of place, mood, genre
and time and for a low rights risk. Records: `src/moments/data/literature.ts`; sources ("Kaynağa bak"):
`src/moments/data/sources.ts`. The candidates file lists what was chosen, built and left pending, and why.

- **Subtitle-only.** No model, animation or sound of their own; no ambience lift. The moment music chooses a piece by
  category and `musicMood` (existing tags only: `solemn`, `history`, `tender`, `joyful`, `sea`, `nostalgic`,
  `mystic`). Lines hold 4 s (older Turkish 5 s, long lines at ≤ 16 characters per second) with half-second gaps.
- **Category.** All but "Atı alan Üsküdar'ı geçti" (a folk tale, `legend`) are `poem`; the settings call that category
  "Şiir ve edebiyat" and the card and the source sheet "Edebiyat".
- **Rare.** Every one plays once per session, only in its place and in a narrow time or weather window, and the global
  3-minute gap applies.
- **Text gate.** Traditional texts, our retelling and our translations (MIT, PD original named) play now. A quoted
  public-domain Turkish text plays only when two independent sources gave the same wording; the two that did not
  (Sinan's inscription, Haşim) stay drafts with `pending` provenance and `text-approval`. Quotations are verbatim.
- **New condition.** `seaFog: { min?, max? }` (0..1, the sea fog layer of `src/render/weather/sea-fog.ts`), for De
  Amicis's arrival in the fog on the foggy mornings of about 30 % of game days.

| Moment | `?moment=` | Where and when | Plays? |
|---|---|---|---|
| Bu Şehr-i Sıtanbûl (Nedim) | `nedim-bu-sehr-i-sitanbul` | 250–600 m ASL over Sarayburnu, 07–11 h, clear or haze | yes |
| Pîr-i Mi'mârân Sinan (Sâî) | `sinan-turbe-kitabesi` | at Sinan's tomb by the Süleymaniye, ≤ 90 m AGL, 16:30–20:30, clear or haze | pending |
| Kâtibim | `katibim-uskudar-yagmur` | ≤ 80 m AGL over Üsküdar square and shore, in rain | yes |
| Atı Alan Üsküdar'ı Geçti | `ati-alan-uskudari-gecti` | diving over the strait mouth between Sarayburnu and Üsküdar, 06–21 h | yes |
| Perde: Karagöz ile Hacivat | `karagoz-sehzadebasi` | ≤ 60 m AGL over Şehzadebaşı, 20–24 h | yes |
| Yağmur (Tevfik Fikret) | `fikret-yagmur-asiyan` | at Aşiyan above Rumelihisarı, ≤ 80 m AGL, in rain | yes |
| Bir Günün Sonunda Arzu (Haşim) | `hasim-bir-gunun-sonunda-arzu` | gliding ≤ 35 m AGL off the Göksu mouth, 17–20:30 h (Göksu fallback: Küçükçekmece Lake is at the map edge and not water in the game) | pending |
| Kuyrukluyıldız (Hüseyin Rahmi) | `huseyin-rahmi-kuyrukluyildiz` | 150–900 m ASL over Heybeliada, 22–04 h, clear | yes |
| Gökten Asılı Kubbe (Prokopios) | `prokopios-gokten-asili-kubbe` | gliding or flying 150–450 m ASL around the Hagia Sophia dome, 10–16 h | yes |
| Sis Kalkınca (De Amicis) | `de-amicis-sis-kalkinca` | ≤ 90 m AGL over the Marmara south of Sarayburnu, 05–11 h, on a foggy morning | yes |

The `?moment=` shortcut starts the dragon at each record's `start` waypoint (over water or low ground, heading for the
target) and plays the moment whatever the time and weather; a pending record logs that it cannot play yet.

**Checks.** `moments-check` section 4: every record's place inside the flight's soft boundary with an altitude that
fits its bands, the shore band met inside the place; the literary records' intended playability, subtitle-only content,
music mood, sources, card and rarity; the crossing polygon is open strait water, Üsküdar, Heybeliada, Aşiyan on its
hill, the Marmara approach, the Göksu fallback off Anadolu Hisarı. `moments-runtime-check` section 8: each playable one
fires once in its situation on the real geography and not far away, outside its hours, weather, sea fog, band or flight
mode, on the ground, in a race or with its category off; the start pose and the forced play; the sources validate.

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

## Music sources: from the world or as a memory (built 26 September 2026)

Moment music is never heard "directly" (owner decision): each record's optional `content.musicSource` says where it
comes from (details, chains and tuning: `.docs/audio/music-system.md`, Moment music sources).

- **World kinds.** `gramophone` (a horn at a yalı window), `venue` (a coffeehouse heard from the street), `live` (a
  Karagöz tent, a fasıl band), `ferry` (a deck radio following the moment's ferry). Positional: the highs fall first
  with distance, then the level; the reach grows at night over calm water; speed and wind mask the music, hovering and
  above all perching or standing within ~60 m give the clearest sound.
- **Lead-in.** The music has its own proximity start: inside a source's reach (380–480 m by day) its piece starts,
  before the moment's trigger and its subtitles. The moment carries the same piece on and opens it up a little (2 s);
  afterwards it sinks back into the world and fades as the player leaves. If the moment never starts (rain, time of
  day, altitude), the music simply stays a world sound. The moments system hands the music the nearest world source
  of a playable moment whose category is on (`src/moments/music-source.ts`); the runner is untouched.
- **Memory.** Moments in open sky or sea: a long airy reverb, band-limited, a slow wow and flutter, panned toward
  `from` (the landmark) without distance attenuation, or centred and diffuse. A world source whose player flies far
  mid-moment cross-fades into the memory treatment, so the moment keeps its music to the end.
- **Records.** Kâtibim `venue` on the Üsküdar shore road (41.0258, 29.0135, between Şemsi Paşa and the İskele
  square, ~50 m from the water); Karagöz `live` on Şehzadebaşı Caddesi (41.0129, 28.9584, beside the perde waypoint,
  < 150 m from the Şehzade mosque); Kuyrukluyıldız `gramophone` at Hüseyin Rahmi's house by his monument on Heybeliada
  (40.8768, 29.1004; reachScale 1.8 for the high, quiet night flight; the house's exact footprint is to confirm);
  Yağmur `gramophone` at Aşiyan (41.08266, 29.05345); gull and simit `ferry`. Memories: Orhan Veli (centred: "gözlerim
  kapalı"), Nedim and De Amicis from Topkapı / Sarayburnu, Prokopios from the Hagia Sophia dome, Sinan from his tomb,
  the legends from their landmark. Other records default to a centred memory. Every point is checked against the geo
  data by `moments-check` (land / water, landmark distance, district, the reach covering the trigger centre).
- **Hear it now.** `?music=test,debug&moment=<id>` (e.g. `katibim-uskudar-yagmur`, `karagoz-sehzadebasi`,
  `fikret-yagmur-asiyan`, `ferry-gull-simit`, `nedim-bu-sehr-i-sitanbul`); the debug overlay's `source` line shows the
  kind, the distance / reach, the wind mask and the clarity. The real music will be public-domain 78 rpm recordings,
  pending the owner's approval.

## Sources: "Kaynağa bak" (built 26 September 2026)

Owner request: when a moment quotes something, one key takes the player to the original (a text, a video, an image...).

Code: `src/moments/sources.ts` (pure: validation, what may be embedded, embed URLs, the prompt window),
`src/moments/source-prompt.ts` (prompt + key in the moments system), `src/moments/seen.ts` (moments seen, per viewer),
`src/moments/data/sources.ts` (the lists), `src/ui/moments/` (source sheet, pause menu → Anlar, shared detail view).

- **Data.** A record may carry `sources: MomentSource[]` (`src/moments/types.ts`). Each item: `kind` (`text`, `image`,
  `video`, `audio`, `link`), a Turkish `title`, the canonical https `url` (Vikikaynak / Wikisource, Project
  Gutenberg, a Wikimedia Commons file page, the rights holder's official YouTube upload, a museum page), an optional
  `embed` (`{ kind: 'youtube', videoId, startSec?, endSec? }` or `{ kind: 'image', src, width, height }` with `src` on
  `upload.wikimedia.org`), `attribution`, `licence`, `approved` and a developer `note`. Only URLs verified to exist are
  added; wished-for items stay as TODO comments.
- **Approval (CLAUDE.md).** `approved: true` means the owner approved the item for the game. Approved items must name
  their attribution and licence, and only approved items that validate are **embedded**. An unapproved item is still
  **listed as a plain external link** (title, domain, "Tarayıcıda aç"), never embedded, so the game itself loads nothing
  from it; a link only leaves the game when the player chooses it. To approve: the owner confirms the item, set
  `approved: true`, fill `attribution` / `licence`, and run `tools/headless/moment-sources-check.ts`.
- **Prompt.** While a moment with sources plays, a quiet "[I] Kaynağa bak" rides under its subtitle line (the line owns
  the hint zone then); for 10 s after the moment ends (the closing card's 9 s and a little more) it is a hint-line item
  with the moment's title as caption (`HUD_PRIORITY.momentSource` = 35: below flight hints and moment lines, joinable,
  deferred by a race). Never during a race; a race also ends the window. Key **I** (input button `source`; V stays
  reserved, I is free in flight, races and the editor; the race picker's own I works only inside that sheet).
- **Source sheet.** I pauses the game and opens a centred sheet ("Kaynak · oyun duraklatıldı", "[Esc] Kapat"): title,
  category and author with dates, the full excerpt (the subtitle lines together), the card text, and the sources. Each
  source shows its kind, title, attribution · licence, an approved embed (YouTube via `youtube-nocookie.com`, sandboxed
  iframe, no autoplay, start/end; an image with its credit) and a key-first link "[1] Tarayıcıda aç  tr.wikisource.org"
  (`target=_blank`, `rel="noopener noreferrer"`). Digits 1–9 open the links, Esc or I closes and resumes, the scrim
  closes it too; mouse works everywhere.
- **Pause menu → Anlar.** A fourth tab lists the moments seen (newest first, stored in localStorage
  `evren.moments.seen.v1` when a moment starts, like the discoveries) with the same detail view; arrow keys move the
  selection, digits open links.
- **Privacy.** Nothing third-party is requested before the player opens the sheet or the tab (no preloading); embeds
  are created when the detail renders and removed when it closes (the video stops). Iframes use `sandbox`,
  `referrerpolicy` and a minimal `allow`; images `referrerpolicy="no-referrer"`. The site has no CSP today; the embed
  hosts are fixed in code (`youtube-nocookie.com`, `upload.wikimedia.org`), so a CSP can allow exactly those
  (`frame-src https://www.youtube-nocookie.com; img-src 'self' https://upload.wikimedia.org`). Offline
  (`navigator.onLine` false) embeds are replaced by a calm note; a failed image shows a short message.
- **First example.** The Orhan Veli poem: the poem on Vikikaynak (text) and Orhan Veli's Vikikaynak page (link), both
  unapproved links for now (the pages were confirmed through a search index; the container cannot reach Wikimedia).
  An official video and a Commons image are TODO comments until the owner picks them.
- **Checks.** `moment-sources-check.ts` (validation rules, never embedding unapproved items, the embed URL, every
  record's sources); `moments-runtime-check.ts` section 6 (the prompt window during and after a moment, not otherwise,
  not during races; the hint item's priority and race deferral).

## Rights

The game is non-commercial, open source on GitHub and played in the browser.

- Clips or audio ripped from films and series are never committed (a DMCA notice can take the whole repository down).
  Real scenes are shown only through the rights holder's official YouTube upload, embedded.
- Characters that nod to real actors are original, stylised designs with our own lines.
- Legends, historic events and works whose authors died more than 70 years ago are free to use (e.g. Orhan Veli,
  died 1950; the Kadıköy Boğa sculpture, sculptor died 1901).

## Backlog (in order)

1. **Moments system:** the data format, triggers, subtitles, discovery-card integration (built), sources with the
   "[I] Kaynağa bak" sheet and pause menu → Anlar (built; approved YouTube videos play in the sheet, see "Sources").
2. **Stork and raptor migration over the Bosphorus** (autumn): flocks circling in thermals the dragon can join
   (brings the thermal lift of phase 05). (Storks playable; raptors not built yet.)
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
16. **Literary moments:** ten texts from `.docs/moments/candidates.md` (divan poetry, an inscription, a türkü, a
    proverb tale, Karagöz, modern poems, a novel, Byzantine history, travel writing) as subtitle-only moments; eight
    playable, two waiting for the owner's text check (see "Literary moments").
