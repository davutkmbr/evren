# Moments ("Anlar")

Phase 19 (`.docs/planning/19-moments.md`): small, calm surprises placed on the real map. Each moment is one data
record, so a new moment is data, not code. This folder documents the format; the code lives in `src/moments/`.

Status: the record format, the pure trigger evaluator and the first nine records exist. Nothing is rendered or wired
into the game yet (no system in `main.ts`, no models, sounds, subtitles UI or video panel). Every record is `draft`.

| Path | What |
| --- | --- |
| `src/moments/types.ts` | The record format (`Moment`) |
| `src/moments/triggers.ts` | Pure evaluator: `eligibleMoments(moments, ctx)`, `rejectReason()`, `markFired()` |
| `src/moments/data/*.ts` | The records (`ALL_MOMENTS` in `data/index.ts`) |
| `tools/headless/moments-check.ts` | Validation, geography checks and evaluator tests (`npx tsx tools/headless/moments-check.ts`) |

## Record format

A `Moment` has five parts. Player-facing text (title, subtitles, speaker labels, card) is Turkish; ids and notes
are English.

- **Identity**: `id` (kebab-case, stable), `title`, `status` (`'draft' | 'ready'`), `backlog` (item number in the
  phase doc), `needs` (what is still missing: `model`, `animation`, `sound`, `video-link`, `text-approval`,
  `runtime-anchor`), `notes`.
- **Trigger** (`trigger`), all conditions combined with AND:
  - `place`: a circle (`center` lat/lon + `radius` m), a polygon (`area`), and/or a moving `anchor` supplied at runtime
    (e.g. `'ferry'`: in range of any ferry). When several are given, all must hold.
  - `surface`: `'ground'` (landed), `'air'` or `'any'`.
  - `altitude`: bands in metres, each `{ ref: 'asl' | 'agl', min?, max? }`.
  - `flightModes`: optional list of `FlightMode`s (e.g. only while `'gliding'`).
  - `shoreDistance`: signed coast distance band (positive on land, negative over water; `GeoQuery.coastDistance`).
  - `timeOfDay`: `{ from, to }` in hours, half-open; `from > to` wraps past midnight (21 → 4 is a night window).
  - `seasons` (meteorological: spring Mar–May … winter Dec–Feb) and/or `dateRange` (`{ month, day }` pairs, inclusive,
    wraps past New Year when `from` is later than `to`). Day of year uses a non-leap calendar, like `TimeState.dayOfYear`.
  - `weather`: allowed `WeatherPreset`s (a `'custom'` weather never matches a list).
  - `repeat`: `{ kind: 'once-per-session' }` or `{ kind: 'repeatable', cooldownSec }`.
- **Content** (`content`): placeholder ids for the actor model, animations and sound; `subtitles` (timed Turkish lines
  `{ at, duration, text, speaker? }`); an optional `camera` hint (never takes control from the player); an optional
  discovery `card` (`title`, `text`); `waypoints` (named key points such as a flight's start and landing, each can
  declare `expect: 'land' | 'water'` and `nearLandmark` for the headless check).
- **External media** (`media`, optional): `{ provider: 'youtube', videoId, startSec, endSec, rightsHolder }` — the rights
  holder's official upload, embedded and streamed, never stored. Empty in every record for now.
- **Provenance** (`provenance`): one entry per text (`covers: 'subtitles' | 'card' | 'subtitles:3'`) with `kind`
  (`original` or `public-domain`), `licence`, `author`, `basis` (the source it rests on) and `pending` (anything the user
  still has to confirm). Our own writing is `original`, licence `MIT` (the repository licence), author
  `Evren contributors`; a public-domain source is always named in `basis`.

### Evaluator

`eligibleMoments(moments, ctx, { includeDrafts? })` returns the moments that may start now, nearest first (ties by
id). The context is plain data: dragon position in local metres (`{ x, z }`), `altitude`, `agl`, `grounded`,
`flightMode`, `coastDistance`, `timeOfDay`, `dayOfYear`, `weather`, `anchors` (moving anchor positions by name) and
`session` (`now` plus a map of moment id → session time it last fired). It has no three.js or scene dependency and
never mutates its inputs; `markFired(session, id)` returns the next session state. Only `ready` moments are returned
unless `includeDrafts` is set. `rejectReason()` names the first failing condition (for tests and debug overlays).

## Adding a moment

1. Pick the backlog item and write the record in the matching `src/moments/data/*.ts` file (or a new file added to
   `data/index.ts`). Start with `status: 'draft'` and list everything missing in `needs`.
2. Place it: real lat/lon (check against OpenStreetMap), a radius or area that fits the scene, and waypoints with
   `expect` / `nearLandmark` wherever the geography matters (a landing in the sea, a character on land).
3. Write the Turkish lines: short (≤ 90 characters, ≤ 20 characters per second on screen), calm, a little witty, never
   preachy. If a historic claim rests on one source, say so lightly in the game ("rivayete göre", "Evliya'ya göre").
4. Fill `provenance` for every text; put open questions in `pending`.
5. Run `npx tsx tools/headless/moments-check.ts` (≈ 3 s) and `npx tsc --noEmit`.
6. A record becomes `ready` only when `needs` is empty, nothing is `pending`, and the actor passes the phase 19 quality
   bar in the game (textured, weathered, no plastic look, judged at landing distance next to a reference photo).

## Rights checklist

From the phase doc and `CLAUDE.md`; check every item before a moment becomes `ready`:

- [ ] No clips or audio ripped from films or series anywhere in the repository. Real scenes only through the rights
      holder's **official** YouTube upload, embedded (`media`), never downloaded or stored.
- [ ] Characters that nod to real people or actors are original, stylised designs with our own lines; no copied faces.
- [ ] Texts are our own writing (MIT) or public domain with the source named (legends, historic events, works whose
      authors died more than 70 years ago). Public-domain status is checked for **both** Turkey and the United States
      (the repository is hosted there).
- [ ] Every model, texture and sound is free with a clear licence, approved by the user before integration, and
      recorded in `public/models/LICENSES.md`, `public/textures/LICENSES.md` or `public/audio/LICENSES.md`
      (private assets such as MetaHuman / Mixamo only in `private-assets/`).
- [ ] Unapproved content is not referenced: placeholder ids only until approval.

## Records

| # | Id | Title (in game) | Status | Still needs |
| --- | --- | --- | --- | --- |
| 2 | `storks-bosphorus-migration` | Boğaz'da Leylek Göçü | draft | Stork flock model (textured feathers), soar/glide animations, stork bill-clatter sound; thermal lift from phase 05 |
| 3 | `hezarfen-galata-uskudar` | Hezarfen Ahmed Çelebi | draft | Ghost glider model (17th-century clothes, eagle-feather wings), leap/glide/wave animations, wing-cloth sound; race gameplay |
| 4 | `ferry-gull-simit` | Martı ve Simit | draft | Passenger (MetaHuman) + gull models, snatch animations, gull call (the approved CC0 gull recordings may fit); ferry positions as the `ferry` anchor (phase 13) |
| 4 | `galata-bridge-anglers` | Galata Köprüsü Oltacıları | draft | Angler characters (MetaHuman) with rods and hats, hold-hat/shake-fist animations, reel and shout sound |
| 5 | `aya-yorgi-challenge` | Aya Yorgi'nin Meydan Okuması | draft | Original knight statue (weathered bronze/stone), spear animations, armour-creak sound; confirm the hilltop point in game |
| 7 | `lagari-sarayburnu-rocket` | Lagari Hasan Çelebi | draft | Rocket + rider model, launch/wings/splash animations, fuse and whoosh sound; chase gameplay |
| 8 | `ships-over-land-1453` | Karadan Yürüyen Gemiler | draft | Translucent galley model, slide/fade animations, wood-creak sound |
| 9 | `kiz-kulesi-legend` | Kız Kulesi Efsanesi | draft | Small snake character and fruit basket, idle/peek/hide animations, night-sea sound |
| 14 | `orhan-veli-istanbulu-dinliyorum` | İstanbul'u Dinliyorum | draft | The poem's text (placeholders now; wording to verify, US status to decide), soft shore ambience |

No record uses `media`; film and series items (backlog 6 and 11) wait for the user's choices and official links.

## Open questions for the user

- **Orhan Veli.** Public domain in Turkey since 1 January 2021 (died 14 November 1950; FSEK life + 70). In the United
  States a Turkish work that was still protected in Turkey on 1 January 1996 can have a restored term of 95 years from
  publication (for a poem from the 1940s, into the 2040s). The poem's lines are therefore placeholders; decide whether
  to include the full text, a few lines, or only the title, and confirm the wording against a reliable edition.
- **Hezarfen and Lagari** rest only on Evliya Çelebi's Seyahatname; the game says so ("rivayete göre", "Evliya Çelebi
  anlatıyor"). Hezarfen's year is not given by Evliya, so the game names only the reign of Murad IV.
- **Ships over land**: sources differ on the number (67–80) and the route (from Tophane or Dolmabahçe over the hills
  to Kasımpaşa); the game says "yetmiş kadar" and "kaynağa göre değişir".
- **Aya Yorgi**: the knight statue is an invented prop; the joke stays on the dragon and a rusty spear.
