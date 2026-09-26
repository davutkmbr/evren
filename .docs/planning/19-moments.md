# Phase 19 — Moments: references, legends and city life

Milestone: E · Variety · Effort: L · Depends on: 01 (bug fixes), 05 (thermals), 13 (living world)

Status: in progress. Planned with the user on 25 September 2026. Built: the record format, the pure trigger evaluator,
the settings (Ayarlar → Oyun → Anlar) and, since 26 September 2026, the **runtime**: moments play in the game. Only the
Orhan Veli poem is playable today; every other record waits for its assets (see "Runtime" below).

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
- **Sound.** No moment sound exists yet. For a moment whose sound is missing the runtime asks the audio service to lift
  the existing coastal ambience (`setAmbienceLift`: surf forward, city back), so no new external asset is needed.
- **Playability decision.** A `ready` record plays. A `draft` record plays only when its content is complete for what
  it is: a subtitle-only moment (no character, object or animation) whose single need is `sound` plays, because the
  soft bed is optional there and the ambience lift stands in for it. Anything needing a model, an animation, a video
  link, a runtime anchor or text approval waits; in dev the console logs each skipped record once with its reason.
- **Shortcut.** `?moment=<id>` puts the dragon at the record's `start` waypoint (heading for the next waypoint) once
  the game starts and plays that moment once, whatever the conditions (still not during a race).
- **Checks.** `tools/headless/moments-runtime-check.ts` flies a scripted low glide along the European shore from
  Beşiktaş to Bebek on the real geography: the poem fires exactly once, after the dwell, with the record's timeline
  (4 s lines, 0.5 s gaps) and the card at the end; it does not fire high, inland, in rain or storm, while flapping,
  during a race or with its category off; pause, hysteresis, fade-out, retry, race / settings cut-off, the global gap
  and the shortcut are covered; the corridor polygon is verified to cover all of the strait's water and both shores
  (its north end was extended to the Black Sea mouth, 41.24° N).

### Playable now vs waiting

| Moment | Plays now? | Why |
|---|---|---|
| Orhan Veli, "İstanbul'u Dinliyorum" (#14) | yes | subtitle-only; its soft shore bed is replaced by the lifted coastal ambience |
| Storks over the Bosphorus (#2) | no | needs the stork flock model, animations and sound |
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
  record's sources); `moments-runtime-check.ts` section 5 (the prompt window during and after a moment, not otherwise,
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
14. **Orhan Veli, "İstanbul'u Dinliyorum":** lines appear as subtitles while gliding low along the shore. (Playable.)
15. **Days and seasons** (with phase 13): Ramadan cannon and iftar lights, New Year fireworks, lodos waves on the
    Kadıköy shore, foghorns on misty mornings, match-day crowd sounds near stadiums (CC0 recordings, no real chants
    or club symbols).
