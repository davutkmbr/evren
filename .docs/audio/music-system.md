# Adaptive music — system and owner workflow

Seventeen Skies has no single soundtrack loop. Each piece of music is a **set** of equal-length loopable **stems**
(piano, strings, light motion, an Istanbul colour instrument, airy pads) that play in sync; the game fades the stems in
and out with the flight — sparse on the ground, fuller in the air, a pulse when fast, the oud / ney low over the water,
a swell in a thermal — and lets the music rest between sets so it never tires. The target feel is a light, cozy
open-world soundtrack (Sky, Alto's Odyssey, A Short Hike) with at most a light Istanbul colour.

The game has two music styles ("Müzik tarzı" in the settings):

- **Seyrek (sparse, sprinkle mode)** — the default as soon as the manifest has sprinkle phrases. Mostly silence: every
  few minutes one short, sparse, single-instrument **phrase** (a ney breath, a few kanun notes, an oud phrase, a tanbur
  note at night) plays over the world sound, chosen by context — the way Breath of the Wild and Minecraft do it. Loops
  only play for races (race-tagged sets) and for a moment's own set. See [Sprinkle mode](#sprinkle-mode).
- **Sürekli (continuous)** — the looping stem sets described below, with their play / silence cycle.

In both styles a moment (a poem, a quotation, a historical memory) can have its own emotional **moment piece** under its
subtitles; see [Moment music](#moment-music).

No loop sets or sprinkle phrases are approved yet. The first **moment pieces** are: restored excerpts of historic 78 rpm
records (approved 2026-09-26), see [Historic 78 rpm recordings](#historic-78-rpm-recordings-archive-and-variants).
To hear the loops and sprinkles now, use the procedural DEV test sets and phrases (below).

## Hear it now

Open the game with **`?music=test,debug`** (e.g. `http://localhost:5199/?music=test,debug`):

- `test` renders, at runtime, three tiny procedural sets (a day set with a kanun-like pluck, a hicaz-coloured night set
  in 3/4 with a ney-like voice, a race set with stingers), four test phrases (a breathy ney by day, a few kanun plucks
  over the water, a low tanbur at night, a darker ney at night or in fog) and three test moment pieces (a slow ney over
  a soft pad for poems, a kanun tune over a tanbur drone for city life, a solemn tanbur for legends and history; only
  these carry a very faint 78-style hiss and crackle). They exist only in memory, are never shipped as files and never
  load without `?music=test` (or `__evrenMusic.useTestSets()`). They are test tones, not the game's music.
- Because test phrases exist, the style is **sparse** unless you chose "Sürekli" in the settings. Force a style for the
  session with `?music=test,sparse,debug` or `?music=test,continuous,debug`.
- `debug` shows the overlay: set, bar / beat, every stem's level (smoothed → target), the active rule and modifiers,
  the active conditions, the director's phase (playing / silence and time left); in sparse style the sprinkle line
  (`next in N s (phrase)`, the last phrase, the phrases played), the hold or busy reason and the context tags; the
  moment piece line; and the `source` line of the moment piece (kind, phase `lead` / `moment` / `world`, distance /
  reach, wind mask, clarity, opening, memory blend, level).
- `?music=off` disables music entirely.

**Sprinkles:** the first phrase comes 25–70 s after the start, then every 1.5–4 minutes. To skip the wait, run
`__evrenMusic.sprinkle()` in the console (or `__evrenMusic.sprinkle('test-tanbur-gece')` for one phrase, whatever the
context). Then fly slowly over the water by day (ney / kanun), sit on a perch at night (tanbur, ney), sprint or dive
(the next phrase waits for calm), open the menu or photo mode (a playing phrase fades out).

**Moment piece:** open `http://localhost:5199/?music=test,debug&moment=orhan-veli-istanbulu-dinliyorum`: the poem
moment starts after a few seconds and the test piece (chosen by the category `poem` and the moment's `musicMood`
`nostalgic`, `sea`) fades in under the subtitles as a memory (centred, airy, a slow wobble); when the moment ends it
fades out. Without a moment at hand: `__evrenMusic.moment({ category: 'poem', mood: ['sea'] })`, then
`__evrenMusic.endMoment()`.

**The real moment pieces (78 rpm records):** open the moment without `test`, e.g.
`http://localhost:5199/?music=debug&moment=nedim-bu-sehr-i-sitanbul`; add `raw` (`?music=raw,debug&moment=…`) for
the crackly original or `denoised` for the restored version, whatever the piece's default. The list of links is in
[Historic 78 rpm recordings](#historic-78-rpm-recordings-archive-and-variants).

**Moment sources** (see [Moment music sources](#moment-music-sources)), each with `?music=test,debug&moment=<id>`:

| Kind | Open | What to listen for |
| --- | --- | --- |
| `venue` | `katibim-uskudar-yagmur` | a muffled coffeehouse on the Üsküdar shore road; the music starts before the subtitles, opens a little when they begin, stays in the world afterwards |
| `gramophone` | `karagoz-sehzadebasi`, `fikret-yagmur-asiyan`, `huseyin-rahmi-kuyrukluyildiz` | a narrow, slightly metallic horn at a coffeehouse window on Şehzadebaşı Caddesi / a window of Aşiyan / the Heybeliada house |
| `ferry` | `ferry-gull-simit` | a small deck radio that moves with the ferry (the shortcut waits for a ferry in service) |
| `memory` | `nedim-bu-sehr-i-sitanbul`, `prokopios-gokten-asili-kubbe`, `orhan-veli-istanbulu-dinliyorum` | airy and far, from the palace / the dome, or centred for Orhan Veli |

Then fly: hover or land within ~60 m of a world source for the clearest sound, sprint past it (low-passed and
ducked), fly away mid-moment (it crosses into a memory beyond 0.9 of the reach), come back (it returns to the world),
leave after the moment (it fades just past the reach). `__evrenMusic.source()` returns the current mix.

**Loops** (continuous style, `?music=test,continuous,debug`), then fly: sit on a perch (calm set, gentle mix), cruise (base + strings), sprint or dive (+ motion), skim the water
(+ colour), climb in a thermal without flapping (air swell), change the time (night set, softer strings), start a race
(the race set's downbeat lands on "Başla!", stingers on the start and the finish), open the menu (ducked a little),
dive under water (muffled, base only).

Console (`window.__evrenMusic`):

| Call | Does |
| --- | --- |
| `__evrenMusic.state` | snapshot: set, bar, beat, stems, rule, conditions, phase |
| `__evrenMusic.play('test-gece')` / `.play()` | play that set (or the best one) now, ignoring the silence cycle, until `.release()` |
| `__evrenMusic.stop(10)` | end the music now; next set after 10 s (default: a normal gap) |
| `__evrenMusic.force({ perched: true })` | override state fields (`race: 'running'`, `moment: true`, `night: 1`, `underwater: 1`...); `.force(null)` clears |
| `__evrenMusic.setAdaptive(false)` | the plain full mix |
| `__evrenMusic.cue('go')` | play a stinger of the current set |
| `__evrenMusic.pause()` / `.resume()` | hard pause in place (the loops resume where they stopped) |
| `__evrenMusic.useTestSets()` | load the DEV test sets, phrases and moment piece without reloading |
| `__evrenMusic.setStyle('sparse')` / `('continuous')` | switch the style (stored like the setting) |
| `__evrenMusic.sprinkle()` / `.sprinkle('test-ney-gece')` | the next phrase (or that one) now, once holds and calm allow |
| `__evrenMusic.phrases()` | phrase and moment piece ids |
| `__evrenMusic.moment({ category: 'poem', mood: ['sea'], musicId })` / `.endMoment()` | fake a moment start / end as the moments system does |
| `__evrenMusic.source()` | the moment piece's source mix now (kind, distance, reach, level, cutoff, wind mask, clarity, opening, memory) |

## Architecture (`src/audio/music/`)

| File | Role |
| --- | --- |
| `manifest.ts` | data format, validation, credit line, source picking (pure) |
| `rules.ts` | game state → stem mix, duck, set preferences: conditions with hysteresis, the rules table, smoothing (pure) |
| `director.ts` | which set plays when: play / silence cycle, set choice by tags, bar- and phrase-quantised changes, race / moment overrides, stingers (pure) |
| `sprinkle.ts` | sprinkle mode: gaps, context tags, weighted phrase choice without repeats, holds and calm; all numbers in `SPRINKLE_DEFAULTS` (pure) |
| `moment-music.ts` | the moment piece: choice by `musicId` / category / mood, fades, no repeat; numbers in `MOMENT_MUSIC_DEFAULTS` (pure) |
| `moment-source.ts` | moment music sources: the kinds, their chain and distance tuning, `sourceMix` (distance / night / wind → level, cutoff, sends, pan), `SourceTracker` (opening, world ↔ memory) (pure) |
| `moment-source-session.ts` | per-frame glue between the moments system's source reports and the moment-music director (pure) |
| `source-graph.ts` | WebAudio: the world / memory chains the moment piece plays through (built on demand, torn down when idle) |
| `clock.ts` | bar-grid math (pure) |
| `player.ts` | WebAudio: on-demand decoding (at most 2 decoded sets, 6 phrases), sample-locked stem loops, fades, stingers, one-shot phrase voices, hard pause |
| `index.ts` | the controller hosted by the audio system: reads the services every frame, runs rules + director + sprinkle director + moment-music director on the AudioContext clock, drives the player; `__evrenMusic`, `?music=` |
| `settings.ts` | persisted "Müzik" volume, "Uyarlanabilir müzik" switch and "Müzik tarzı" |
| `test-sets.ts` | DEV-only procedural test sets, phrases and moment pieces (lazy chunk) |
| `debug-overlay.ts` | `?music=debug` overlay (lazy chunk) |

Signal path: stems → per-stem gain (adaptive mix × stem trim) → deck fade-in → deck fade-out → music output (level ×
volume² × duck) → master bus `music` input → the same under-water low-pass as the air sounds → master dynamics. The
music is **not** ducked by the pause filter: in menus and the map it keeps playing, 35 % quieter (the `menu` rule).
Sprinkle phrases play as one-shot voices (edge fades × loudness correction × `gain`) into the same music output, so the
"Müzik" volume and every duck apply. Moment pieces play into a sibling **moment output** (level × volume² × the menu
duck only): the strong moment duck hushes the stems and makes room for the piece, it does not hush the piece itself.
On the way there a moment piece passes the source graph (`source-graph.ts`: the world or memory chain of its
[source](#moment-music-sources)); the graph's open-air send reaches the master bus reverb through a moment send that
follows the moment output's gain.

All stems of a set start with one `start(when)` on the AudioContext clock and loop over the grid length (bars × beats
per bar × 60 / bpm), so they stay sample-locked. Everything musical lands on the grid: a set change waits for the next
phrase (or bar, for races and moments), an ending waits for a phrase and fades over 2 bars (or plays the outro
stinger).

Moments: the moments system calls `audio.setMomentMusic(true, musicId, { category, mood })` on start and `(false)` on
end. The loops duck strongly (−80 %) and nothing new starts; the existing moment wind bed and ambience lift are
untouched. A moment piece plays under the moment when one fits (see [Moment music](#moment-music)). With
`MomentContent.musicId` naming a *set* in the manifest (mark it `momentOnly`), that set comes in on the next bar at
full mix and leaves after the moment instead.

## Sprinkle mode

Style **Seyrek** (`sparse`). The sprinkle director (`sprinkle.ts`) runs on the AudioContext clock:

1. **Gaps.** After each phrase a random silence of **90–240 s** (uniform); the first phrase of a session comes after
   25–70 s. After a long calm stretch (150 s without a hold or busy flight) the gap shrinks to 60 % (never below
   60 s), so a player resting on a perch or gliding slowly hears a little more. With the defaults and 20–30 s phrases,
   music sounds about 10–15 % of the time.
2. **Context.** The current context is a set of tags: `day` or `night` (the `night` condition), `dawn` (05:00–08:00),
   `dusk` (17:30–20:30), `fog`, `storm`, `water` (over water, low over water or swimming), `perch`, `flight`
   (airborne), `calm` (perched, on the ground, slower than 30 m/s or in a thermal, and not busy). A phrase whose tags
   include time-of-day tags plays only when one of them is current (a night tanbur never plays at noon); every other
   matching tag adds weight: `weight = 1 + 2 × matching tags`, picked at random by weight.
3. **No repeats.** Never the same phrase twice in a row (a manifest with a single phrase is the only exception), and not
   the same `family` (instrument) twice in a row when another family fits. When only the last phrase fits, the director
   waits and tries again after 20 s.
4. **Holds.** Nothing new starts during a race (countdown, running, result), a moment, photo mode, a menu / the pause
   menu / the map / the start screen, or under water. A phrase that is playing when a hold begins fades out over 2.5 s.
   After a hold the director keeps at least 20 s of quiet before a phrase.
5. **Calm.** No new phrase during sprints (`fast`), dives (`diving`) or flow boosts (chain burst); once the flight is
   calm again it waits another 8 s. A phrase that already plays is not cut by a sprint.
6. **Playback.** The phrase is decoded 8 s before it is due, then plays once (never looped) with a 1.5 s fade-in and a
   2.5 s fade-out over its last seconds (the files carry their own silent head and tail; the fades only soften edges).
7. **Adaptive off.** With "Uyarlanabilir müzik" off the phrases are a plain rotation: no tag matching, no time-of-day
   restriction; holds, calm and no-repeat rules stay.

**Coexistence with the loops.** In sparse style the loop director only plays when a race or a moment asks for it: a
race-tagged set during races (with its stingers) and a moment's own `momentOnly` set. Outside those the director holds,
and a set that still plays (after a race) ends on its next phrase boundary. In continuous style the sprinkle director
does not run. Moment pieces play in both styles. With no sprinkle phrases in the manifest the default style is
continuous, so the game behaves as before until the owner adds phrases.

**Tuning:** every number above is in `SPRINKLE_DEFAULTS` (`sprinkle.ts`): gap ranges, first gap, after-hold quiet,
calm settle, long-calm length / scale / floor, fades, retry, preload, the pick weights, the dawn and dusk hours, the calm
airspeed and the boost threshold. Loudness target: `PHRASE_TARGET_LUFS` (`manifest.ts`).

## Moment music

While a moment plays, one emotional **moment piece** (a phrase with `role: "moment"`, 40–120 s, one or two
instruments: ney, kanun, oud, tanbur, piano, cello) plays once under the subtitles (`moment-music.ts`):

- **Choice.** `MomentContent.musicId` naming a moment piece wins. Otherwise the pieces are scored against the moment:
  +3 for the moment's category (`poem`, `legend`, `city-life`) among the piece's tags, +2 per matching
  `MomentContent.musicMood` tag (e.g. `nostalgic`, `sea`, `history`, `solemn`), +1 when a time-of-day tag matches (−2
  when the piece has time tags and none matches). The best score wins (ties at random); at least one category or mood
  match is needed, otherwise the moment keeps the plain duck.
- **No repeat.** Never the same piece for two moments in a row (unless a moment names it by `musicId`).
- **Fades.** The piece fades in over 2.5 s as soon as it is decoded (a decode slower than 8 s drops it). A piece
  shorter than the moment ends on its own — its file tail plus a 2 s edge fade — and is never looped. When the moment
  ends first the piece fades out over 3.5 s. A new moment right after another fades the old piece and chooses anew.
- **Ducking.** During every moment the loops duck by 80 % (the `moment` rule) and sprinkles hold (a playing phrase
  fades out); the piece itself plays on the moment output, so only the volume and the menu duck apply to it. While a
  source's music plays without a moment (its lead-in, or afterwards in the world) sprinkles hold and the loops duck by
  up to 60 % as the source gets audible.
- **Never direct.** The piece always plays through a source chain: a place in the world or a memory (next section).
- **Moment data.** Add `musicMood: ['nostalgic', 'sea']` to a moment's `content` (`src/moments/data/*.ts`) to steer
  the choice, or `musicId: '<piece-id>'` to pin one piece. "İstanbul'u Dinliyorum" already asks for
  `['nostalgic', 'sea']`.

Numbers: `MOMENT_MUSIC_DEFAULTS` in `moment-music.ts`.

## Moment music sources

Moment music is never heard "directly": it comes from a place in the world, or sounds like a distant memory. Each
moment record may carry a `musicSource` (`src/moments/types.ts`); without one it is `{ kind: 'memory' }`, centred and
diffuse.

Code: `moment-source.ts` (pure: the kinds, the tuning tables, the distance / wind / night mapping `sourceMix` and the
per-voice `SourceTracker`), `moment-source-session.ts` (pure: the per-frame glue the controller and the check share),
`source-graph.ts` (thin WebAudio graph that applies the numbers), `src/moments/music-source.ts` (resolves records into
world positions, finds the nearest lead-in candidate). The graph is built on the first moment piece and torn down 8 s
after the last one ends; with no source near, nothing runs but a few squared distances per frame.

### Kinds and their chains

| Kind | For | Chain |
| --- | --- | --- |
| `gramophone` | a horn gramophone on a yalı balcony or at a window | band-pass 300 Hz – 4 kHz (2nd order each side, LP Q 0.9), +4 dB at 1.3 kHz (Q 1.4), gentle tanh saturation (35 % wet), a little street room |
| `venue` | a coffeehouse or tavern heard from the street | high-pass 110 Hz, low-pass 1.5 kHz (walls and windows), +2.5 dB at 450 Hz, a short room (RT60 0.7 s) with facade reflections at 21 / 34 / 52 ms, send 0.55 |
| `live` | a Karagöz tent, a fasıl band | 70 Hz – 9 kHz, +1.5 dB at 260 Hz (warmth), a warm small room (RT60 0.9 s, send 0.3), a wider image (a 13 ms opposite-side copy) |
| `ferry` | a deck radio on a moving ferry | 480 Hz – 3.3 kHz, +5 dB at 1.9 kHz (Q 2.2), 55 % saturation: a small speaker; follows the moment's ferry |
| `memory` | open sky or sea, no physical source | 170 Hz – 5.2 kHz, a −5 dB high shelf at 2.8 kHz, a large airy hall (RT60 4.2 s), wow 0.55 Hz ±1.1 ms and flutter 6.3 Hz ±0.035 ms (a short modulated delay: about ±6 cents), panned toward `from` (60 % of its side) or centred with less dry and more hall |

Every world source also sends into the city's open-air reverb (the master bus reverb), more with distance, and all of
it goes through the music bus's under-water muffle.

### Distance, night, wind

World sources are positional (pan from the listener's right vector, as `placeSource` in `src/audio/spatial.ts`):

- **Air absorption.** The cutoff falls from 16 kHz at the source to 850 Hz at the reach, log-interpolated by
  `u^0.6` (`u` = distance / reach): the highs go first. The level is `(ref / d)^0.5`, held until 0.45 of the reach and
  faded to silence at the reach.
- **Night carry.** Reach × (1 + 0.6 · night · calm · water): calm = little wind (3–9 m/s), no rain or storm; water =
  the listener is over water or the source stands by it (a ferry, a source within 80 m of the coast).
- **Wind masking.** The mask grows with airspeed from 6 to 45 m/s (hovering at most 0.12, diving at least 0.9, perched,
  grounded or swimming 0). At full mask the world source loses 10 dB and its cutoff drops to 22 %; a memory only 4 dB and
  60 %.
- **Stop and listen.** Perched or standing within ~60 m (fading 40–80 m): +2 dB and cutoff × 1.25, the clearest sound.
- **Lead-in.** The music's own proximity start: while no moment plays, the nearest world source of a playable moment
  whose category is switched on starts its piece once the listener is inside its reach (4 s fade-in, the distance does
  the rest), long before the moment's own trigger. If the moment starts, the same piece carries on; if not, it stays a
  world sound and fades (3 s) once the listener is beyond 1.08 × the reach. A source whose music stopped does not lead
  in again for 240 s. Lead-ins wait during races and menus, and never start while another moment plays.
- **Opening and closing.** When the moment's subtitles begin, a world source opens over 2 s: +3 dB, cutoff × 1.6, the
  room 35 % drier; it stays positional. When the moment ends it sinks back over 3 s and stays a world sound until the
  player leaves.
- **World to memory.** Mid-moment, beyond 0.9 of the reach, the music cross-fades (equal power, 4 s) into the memory
  treatment, so the moment keeps its music; back inside 0.6 of the reach it returns to the world. A moment that ends
  as a memory fades its piece out (3.5 s).

### Tuning table (confirm by ear)

Day reach / night reach over calm water, and level / cutoff at 30, 60, 150 and 300 m (hovering, not opened):

| Kind | Reach day / night | 30 m | 60 m | 150 m | 300 m |
| --- | --- | --- | --- | --- | --- |
| `gramophone` | 420 / 672 m | −4.0 dB, 8.8 kHz | −7.0 dB, 6.4 kHz | −11.0 dB, 3.3 kHz | −19.5 dB, 1.5 kHz |
| `venue` | 380 / 608 m | −1.0 dB, 8.4 kHz | −4.0 dB, 6.1 kHz | −8.0 dB, 3.0 kHz | −20.7 dB, 1.3 kHz |
| `live` | 480 / 768 m | −1.8 dB, 9.2 kHz | −4.8 dB, 6.9 kHz | −8.8 dB, 3.7 kHz | −14.1 dB, 1.7 kHz |
| `ferry` | 400 / 640 m | −5.2 dB, 8.6 kHz | −8.2 dB, 6.2 kHz | −12.2 dB, 3.1 kHz | −22.5 dB, 1.4 kHz |

(The cutoff is the air-absorption stage; each chain's own band limits apply on top.) Wind mask by airspeed: 12 m/s
0.06, 20 m/s 0.29, 30 m/s 0.67, 45 m/s 1. Every number lives in `SOURCE_TUNING`, `WORLD_CHAINS` and `MEMORY_CHAIN`
(`moment-source.ts`) and `MOMENT_MUSIC_DEFAULTS` (`moment-music.ts`).

### Authoring `musicSource`

```ts
// A place in the world (lat/lon + height above the ground; checked against the real geography like a waypoint):
musicSource: { kind: 'venue', at: { lat: 41.0258, lon: 29.0135, height: 4, note: 'Coffeehouse on the shore road', expect: 'land' } },
// A quiet island night carries a gramophone farther (reachScale 0.25..2):
musicSource: { kind: 'gramophone', at: { lat: 40.8768, lon: 29.1004, height: 6, note: '…', expect: 'land' }, reachScale: 1.8 },
// The moving anchor the moment started at (must be the place's anchor):
musicSource: { kind: 'ferry', anchor: 'ferry', height: 8 },
// A memory from the moment's subject, or centred and diffuse without `from`:
musicSource: { kind: 'memory', from: { lat: 41.0085, lon: 28.98, height: 55, note: 'The Hagia Sophia dome', nearLandmark: 'ayasofya' } },
```

Rules (checked by `moments-check`): a world kind has exactly one of `at` / `anchor`; only `ferry` follows an anchor;
`from` is for memories; heights 0–120 m; `at` lies within its kind's day reach of the trigger centre, so the lead-in
reaches the moment's place; `expect` and `nearLandmark` are verified against the geography. Pick a real, plausible
spot near the moment's place (a street-level window ≈ 3 m, a first-floor balcony ≈ 6 m) and say where it is in `note`.

Current records: Kâtibim `venue` (Üsküdar shore road), Karagöz `gramophone` (a coffeehouse window on Şehzadebaşı
Caddesi, playing Felek Bana), Kuyrukluyıldız
`gramophone` (Hüseyin Rahmi's house on Heybeliada, reachScale 1.8), Yağmur `gramophone` (Aşiyan), gull and simit
`ferry`; memories: Orhan Veli (centred), Nedim and De Amicis (from Topkapı / Sarayburnu), Prokopios (the Hagia Sophia
dome), Sinan (his tomb), the legends (from their landmark); every other record defaults to a centred memory.

Real 78 rpm transfers get no added crackle; keep their own surface noise faint in the master. Only the synthesized test
pieces carry a very faint crackle.

## Historic 78 rpm recordings: archive and variants

The owner approved on 2026-09-26 ([decision](../assets/candidates/moment-music.md#decision-2026-09-26)) that every 78 rpm
candidate is **archived in its original form** with its source, and that the first picks become moment pieces.

**Archive (originals).** Each recording is an entry of kind `recording` in `tools/assets/approved.json`: archive page,
title, performers, label and catalogue / matrix numbers, year, licence and rights reasoning (`risk`: `clean` or
`us-risky`), and the exact original files with their format, size and **sha256**.
`node scripts/data/fetch-assets.mjs --kind=recording --no-docs` downloads them into the gitignored
`assets-src/audio/78rpm/<id>/` on any machine and verifies every hash (`--write-sha` fills in a missing one). Raw WAVs
are never committed; small clean originals from fragile sources are also kept byte for byte in `data/archive/78rpm/`.
The catalogue with full provenance is generated: `python3 scripts/data/archive-78rpm-doc.py` →
[`.docs/assets/archive-78rpm.md`](../assets/archive-78rpm.md). Open, copy or trim the originals; never overwrite them.

**Moment pieces.** `tools/assets/moment-pieces.json` lists each piece: the recording and side, the segment (seconds of
the side), fades, the noise region, tags, credit, the moments it is for, and its target (`public` or `private`).
`python3 scripts/audio/prep-moment-music.py [--id=…]` (numpy, scipy, soundfile, noisereduce, pyloudnorm and an ffmpeg
with libopus: `FFMPEG=/path/to/ffmpeg`, a static build works) makes **two versions of the same cut**:

- `denoised` (`<id>.opus` / `.m4a`): 70 Hz rumble high-pass, a hum notch only when the groove shows a mains peak,
  declick (impulses in a short-term LPC residual beyond 9 robust sigmas, gaps of up to 2.5 ms re-synthesised by
  least-squares AR interpolation), and a gentle stationary spectral gate (noisereduce, profile from the lead-in groove
  or a named groove-only pause, at most 50 % reduction) that leaves a thin even hiss rather than risk "underwater" or
  "metallic" artefacts (`scripts/audio/restore78.py`);
- `raw` (`<id>.raw.opus` / `.raw.m4a`): only a 30 Hz subsonic high-pass: the record's own crackle.

Both get the fades and are normalised to −18 LUFS integrated with a −1 dBTP true-peak ceiling (a crackly record often
stops at the ceiling below −18: the measured value goes into `lufs` and the player corrects the rest), then encoded to
Opus 96 kbps and AAC 128 kbps, 48 kHz mono. Nobody can listen in the build container, so the script **measures**:
SNR (music p70 minus groove), clicks per second, spectral flatness of the quietest frames, the groove's
power-spectrum kurtosis ratio (musical noise), and the change of the music's own power in 300 Hz–3 kHz and 3–6 kHz
after the dehiss stage. The default version is `denoised` only when the SNR gain is at least 3 dB, the kurtosis ratio
stays under 1, the music band moves less than 1.5 dB and the 3–6 kHz band loses less than 3 dB; otherwise `raw`
(a piece may force one with `"variant"`). The numbers go to `tools/assets/moment-pieces.report.json` and the table in
`archive-78rpm.md`, and the script writes the manifest entry.

**Choosing by ear.** The manifest entry holds the default in `src` / `lufs` / `variant` and both versions in
`variants`. `?music=raw` or `?music=denoised` plays that version of every restored piece for the session, so the
owner can A/B them; to change a default, set `"variant"` in `moment-pieces.json` and rerun the script.

**Public and private.** Clean recordings (published in the US before 1926, in Turkey before 1956, composer or
improviser dead before 1956) go to `public/audio/music/moments/` and `public/audio/music/manifest.json` with licence
`public-domain`. US-risky recordings (free in Turkey, not yet in the US) use licence `public-domain-tr` and go to the
gitignored `private-assets/audio/moments/` with their own `manifest.json` (paths `private/…`); `vite.config.ts` serves
that folder at `audio/music/private/` in dev and copies it into builds, and the game merges its phrases
([private-assets.md](../assets/private-assets.md)). The public manifest rejects `public-domain-tr` pieces and
`private/` paths. A moment naming a private piece falls back to the mood choice where the private files are absent.

| Piece | Moment(s) | Hear it | Default |
| --- | --- | --- | --- |
| `kagithane-semaisi-1916` | Nedim, the storks | `?music=debug&moment=nedim-bu-sehr-i-sitanbul`, `?music=debug&moment=storks-bosphorus-migration` | denoised |
| `felek-bana-1916` | Karagöz (street gramophone) | `?music=debug&moment=karagoz-sehzadebasi` | denoised |
| `aya-yorgi-apolitikiyonu-nafpliotis` | Aya Yorgi (draft: waits for its model) | console: `__evrenMusic.moment({ musicId: 'aya-yorgi-apolitikiyonu-nafpliotis' })` | raw (the transfer is already clean) |
| `katibim-safiye-ayla-1949` (private) | Kâtibim (coffeehouse venue) | `?music=debug&moment=katibim-uskudar-yagmur` | raw |
| `huseyni-taksim-hafiz-kemal` (private) | Sinan (draft: text approval) | console: `__evrenMusic.moment({ musicId: 'huseyni-taksim-hafiz-kemal' })` | denoised |
| `huzzam-taksim-resad-bey` (private) | Haşim (draft: text approval), Kız Kulesi (draft: model) | console: `__evrenMusic.moment({ musicId: 'huzzam-taksim-resad-bey' })` | raw |

A draft moment that cannot play yet cannot be forced with `?moment=` either; the console call plays its piece as a centred memory (`.endMoment()` stops it; put `raw` or `denoised` in `?music=` first). Credits: every piece carries `credit.attribution` (performer,
label, year, archive), and each moment lists its recording in the source sheet ("Kaynağa bak" → "Müzik: …",
`src/moments/data/music-sources.ts`).

## The stems

| Role | Content | When it is heard (default rules) |
| --- | --- | --- |
| `base` | piano (or harp / guitar): harmony and the core melody; must stand alone | almost always; alone under water |
| `strings` | soft strings / warm synth strings: sustain, lift | cruising, flight; softer at night and in storms |
| `motion` | pizzicato, light percussion, shakers, plucked ostinato | fast flight, dives, high flow, races |
| `colour` | the Istanbul colour: oud, kanun, ney, bağlama — a phrase or an ornament, never constant | low over the water, swimming, perched a little |
| `air` | pads, choir "aah", airy textures, shimmer | on the ground, perched, in thermals, in fog |

A set needs `base`; the other stems are optional (a missing stem is simply silent). Each stem must sound fine alone
and with any combination of the others — keep the melody in `base` or `colour`, not split across stems.

## Preparing stems (owner workflow)

1. **Generate or choose the piece.** Instrumental only, one steady tempo, no tempo changes, no fade-in / fade-out, no
   big ending. 60–100 bpm suits the cozy feel (races 110–130). See the Suno appendix.
2. **Get the stems.**
   - Suno: use its stem export where your plan includes it, or ask for separate versions of the same piece
     ("piano only", "strings only", "percussion only" with the same seed / persona / tempo). Generate on a plan that
     grants commercial use and keep the song page link for `sourceUrl`.
   - Or split a finished track with a stem splitter (open-source Demucs / Ultimate Vocal Remover: piano, drums,
     bass, other), then group the results into the five roles (bass goes with `base`).
   - CC-BY tracks with separate stems published by the author work the same way (record the attribution).
3. **Cut equal-length loops in a DAW** (Audacity, Reaper, Ableton...): set the project to the piece's bpm, pick a
   section of whole bars (8, 16 or 32 bars), and cut every stem at exactly the same bar lines. For a seamless loop,
   render the section twice in a row and keep the second pass (the reverb tail of the end is then already under the
   start). Loop length = `bars × beatsPerBar × 60 / bpm`: 16 bars of 4/4 at 84 bpm = 45.714 s.
4. **Loudness.** Balance the stems so the full mix (all stems at 100 %) measures about **−16 LUFS integrated, true
   peak ≤ −1 dBTP**. Do not normalise the stems one by one (their balance is the mix). High-pass below ~40 Hz and keep
   the low end light: the wind lives there. The game plays the music around −28 LUFS, under the world.
5. **Export** 48 kHz WAV masters, then encode each stem twice:
   `ffmpeg -i base.wav -c:a libopus -b:a 96k base.opus` and `ffmpeg -i base.wav -c:a aac -b:a 128k base.m4a` (the
   AAC file is the fallback for browsers without Opus). Measure the WAV length for `durationSec`:
   `ffprobe -v error -show_entries format=duration -of csv=p=0 base.wav`.
6. **Optional stingers:** `intro` (1–2 bars leading into bar 1), `outro` (a soft final chord), `go` (race start
   hit, plays on "Başla!"), `finish` (race finish flourish). Same tempo and key as the set.

### Naming and where files go (sets)

- Candidates first (CLAUDE.md, external assets): list the pieces in `.docs/assets/candidates/music.md` (title, author,
  licence, source URL, bpm, key, length, stems) with a short preview; nothing goes into `public/` before approval.
- After approval: `public/audio/music/<set-id>/<role>.opus` and `.m4a`, stingers as `<set-id>/<kind>.opus`.
  Set ids are lower-case with dashes, e.g. `bogaz-sabah`, `kule-gece`, `yaris-1`.
- Add the set to `public/audio/music/manifest.json`, record it in `public/audio/music/LICENSES.md`, then run
  `npx tsx tools/headless/music-check.ts` — it validates the shipped manifest and checks that every file exists.

## Preparing phrases and moment pieces (owner workflow)

**Sprinkle phrases** — a single short phrase, one instrument, then silence:

1. **Generate.** One instrument only (ney, kanun, oud, tanbur, bağlama, kemençe, santur, harp, soft piano), no
   accompaniment, no drums, no pads, no reverb wash; a few notes with space between them. Generate several takes and keep
   the calmest (prompt appendix below).
2. **Cut to 20–40 s** in a DAW: about **1 s of silence before the first note** and **3–5 s of silence (or the natural
   decay) after the last**, no hard cut at the end. The validator accepts 4–90 s and warns outside 15–45 s.
3. **Loudness.** Normalise each phrase to about **−18 LUFS integrated, true peak ≤ −1 dBTP** (quieter than the full
   loop mix: a solo instrument over the world). Measure it and write it as `lufs`; the player corrects any phrase to
   −18 LUFS (±12 dB at most), and `gain` trims on top. High-pass below ~60 Hz.
4. **Export** a 48 kHz WAV master, then encode twice: `ffmpeg -i ney-sabah-1.wav -c:a libopus -b:a 96k
   ney-sabah-1.opus` and `ffmpeg -i ney-sabah-1.wav -c:a aac -b:a 128k ney-sabah-1.m4a`. Measure `durationSec` with
   `ffprobe -v error -show_entries format=duration -of csv=p=0 ney-sabah-1.wav` and loudness with
   `ffmpeg -i ney-sabah-1.wav -af ebur128 -f null -` (the `I:` value).
5. **Name and place:** `<family>-<mood-or-time>-<n>`, e.g. `ney-sabah-1`, `kanun-su-2`, `tanbur-gece-1`, in
   `public/audio/music/phrases/<id>.opus` and `.m4a`. Tag each phrase with when it fits (`day` / `night` / `dawn` /
   `dusk`, `water`, `perch`, `flight`, `calm`, `fog`) and its `family`. 20–40 phrases across 4–6 families and both
   times of day make a rotation that does not wear out.

**Moment pieces** — one emotional piece for a whole scene:

1. **Generate** a soft piece of 40–120 s with one or two instruments (ney over a soft pad, kanun and cello, oud alone,
   piano and ney), a gentle start, a real ending (a held note that dies away), no drums.
2. **Cut** with about 1 s of silence at the head and the natural decay at the tail; no loop points needed (a piece plays
   once; a shorter piece than the moment simply ends).
3. **Loudness** as for phrases (about −18 LUFS integrated, `lufs` measured).
4. **Name and place:** `an-<mood>-<n>`, e.g. `an-siir-deniz-1`, `an-tarih-1`, in `public/audio/music/moments/<id>.opus`
   and `.m4a`, with `role: "moment"` and mood tags (`poem`, `legend`, `city-life`, `history`, `nostalgic`, `sea`,
   `night`, `tender`, `solemn`, `mystic`, `joyful`).

For both: candidates first in `.docs/assets/candidates/music.md` (nothing goes into `public/` before approval), then the
manifest entry with the credit and `approvedOn`, `public/audio/music/LICENSES.md`, and
`npx tsx tools/headless/music-check.ts` (which validates the shipped manifest, files included).

## Manifest reference

```json
{
  "version": 1,
  "sets": [
    {
      "id": "bogaz-sabah",
      "bpm": 84,
      "beatsPerBar": 4,
      "bars": 16,
      "phraseBars": 4,
      "key": "D major",
      "tags": ["day", "flight", "water"],
      "stems": {
        "base":    { "src": ["bogaz-sabah/base.opus", "bogaz-sabah/base.m4a"], "durationSec": 45.714 },
        "strings": { "src": ["bogaz-sabah/strings.opus", "bogaz-sabah/strings.m4a"], "durationSec": 45.714, "gain": 0.8 },
        "motion":  { "src": ["bogaz-sabah/motion.opus", "bogaz-sabah/motion.m4a"], "durationSec": 45.714 },
        "colour":  { "src": ["bogaz-sabah/colour.opus", "bogaz-sabah/colour.m4a"], "durationSec": 45.714 },
        "air":     { "src": ["bogaz-sabah/air.opus", "bogaz-sabah/air.m4a"], "durationSec": 45.714 }
      },
      "stingers": {
        "intro": { "src": ["bogaz-sabah/intro.opus", "bogaz-sabah/intro.m4a"], "bars": 1 }
      },
      "credit": {
        "title": "Boğaz Sabahı",
        "author": "Davut Kember",
        "licence": "original",
        "sourceUrl": "https://suno.com/song/…"
      },
      "approvedOn": "2026-10-01"
    }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `id` | lower-case, digits, dashes; unique |
| `bpm`, `beatsPerBar`, `bars` | the grid; loop length must match every stem's `durationSec` (±0.02 s) |
| `phraseBars` | set changes and endings wait for a phrase boundary (default 4; must divide `bars`) |
| `key` | key or makam tag: `"D major"`, `"makam:hicaz (A)"` |
| `tags` | what the rules choose by: `day`, `night`, `dawn`, `dusk`, `calm`, `flight`, `perch`, `water`, `race`, `storm`, `fog`, `moment` |
| `stems.<role>` | `src` (fallback order, relative to `public/audio/music/`), `gain` 0..2 trim, `durationSec` measured |
| `stingers.<kind>` | `intro`, `outro`, `go`, `finish`: `src`, `bars` (grid length, default 1), `gain` |
| `credit` | `title`, `author`, `licence` (`original`, `CC0-1.0`, `CC-BY-4.0`, `CC-BY-3.0`, `public-domain`, `public-domain-tr`), `sourceUrl` (required for CC and public domain), `attribution` (required for CC-BY and public domain; historic records: performer, label, year, archive) |
| `approvedOn` | the owner's approval date (required) |
| `gain` | overall set trim 0..2 |
| `momentOnly` | plays only as a moment's own bed (`MomentContent.musicId`), never in the rotation |

### Phrases (sprinkles and moment pieces)

```json
{
  "version": 1,
  "sets": [],
  "phrases": [
    {
      "id": "ney-sabah-1",
      "src": ["phrases/ney-sabah-1.opus", "phrases/ney-sabah-1.m4a"],
      "durationSec": 27.84,
      "family": "ney",
      "tags": ["day", "dawn", "calm", "water"],
      "lufs": -19.2,
      "credit": { "title": "Sabah Nefesi", "author": "Davut Kember", "licence": "original", "sourceUrl": "https://suno.com/song/…" },
      "approvedOn": "2026-10-01"
    },
    {
      "id": "tanbur-gece-1",
      "src": ["phrases/tanbur-gece-1.opus", "phrases/tanbur-gece-1.m4a"],
      "durationSec": 31.2,
      "family": "tanbur",
      "tags": ["night", "calm", "perch"],
      "lufs": -17.6,
      "gain": 0.9,
      "credit": { "title": "Gece Tanburu", "author": "Davut Kember", "licence": "original" },
      "approvedOn": "2026-10-01"
    },
    {
      "id": "an-siir-deniz-1",
      "role": "moment",
      "src": ["moments/an-siir-deniz-1.opus", "moments/an-siir-deniz-1.m4a"],
      "durationSec": 78.5,
      "family": "ney",
      "tags": ["poem", "nostalgic", "sea"],
      "lufs": -18.4,
      "credit": { "title": "Deniz Kıyısında", "author": "Davut Kember", "licence": "original" },
      "approvedOn": "2026-10-01"
    }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `id` | lower-case, digits, dashes; unique among phrases and not equal to a set id |
| `role` | `sprinkle` (default) or `moment` |
| `src` | fallback order, relative to `public/audio/music/` (`phrases/…` or `moments/…`) |
| `durationSec` | measured file length, required: sprinkles 4–90 s (warning outside 15–45 s), moment pieces 15–240 s (warning outside 40–120 s) |
| `family` | instrument family (`ney`, `kanun`, `oud`, `tanbur`...): required for sprinkles, optional for moment pieces |
| `tags` | sprinkles: `day`, `night`, `dawn`, `dusk` (restrict), `water`, `perch`, `flight`, `calm`, `fog`, `storm` (weight); moment pieces: category and mood tags |
| `lufs` | measured integrated loudness (−40..−6); the player corrects to −18 LUFS |
| `gain` | trim 0..2 on top of the loudness correction |
| `credit`, `approvedOn` | exactly as for sets (licence, `sourceUrl` for CC and public domain, `attribution` for CC-BY and public domain, approval date) |
| `variant`, `variants` | restored historic recordings: `variants.denoised` / `variants.raw` = `{ src, lufs }` of each version, `variant` = the default one, whose files `src` must equal; `?music=raw` / `?music=denoised` swaps (`applyPhraseVariant`) |

Phrases are validated as strictly as sets: an invalid phrase (a missing licence, credit or approval date, a bad path, a
missing file in the check, no family, a length out of range) is dropped with a console warning; valid sets and phrases
still play.

Validation (`validateManifest`, run by the headless check and by the game on load): grid values in range, every stem
the same length and on the grid, `base` present, known roles and stinger kinds, relative audio paths (and existing
files in the check), licence and credit fields complete, an approval date. An invalid set is dropped with a console
warning; valid sets still play. After decoding, the player checks the real lengths again and loops on the grid.

## Rules (`src/audio/music/rules.ts`)

**Conditions** turn raw state into stable booleans, each with an on / off threshold and hold times:

| Condition | On | Off | Hold on / off (s) |
| --- | --- | --- | --- |
| `underwater` | listener ≥ 0.6 under (or dragon under water) | < 0.3 | — |
| `moment`, `momentMusic` | a moment plays (with its own set) | ended | — |
| `race`, `raceCountdown` | race context on / before "Başla!" | off | — |
| `menu` | game paused (menu, map, photo) or start screen | — | — |
| `perched` | sitting on a perch | left | 0 / 1.5 |
| `grounded`, `swimming` | on the ground / swimming | — | 1.5 / 2.5, 1 / 2 |
| `fast` | airspeed ≥ 44 m/s (cruise ≈ 32) | < 38 | 1.5 / 3 |
| `diving` | dive mode or sink > 18 m/s | — | 0.6 / 2.5 |
| `highFlow` | flow ≥ 0.6 | < 0.45 | 1 / 3 |
| `lowOverWater` | over water, AGL ≤ 35 m | > 60 m | 1.5 / 3 |
| `thermal` | climbing ≥ 2.5 m/s with flap effort < 0.35 | < 1 m/s | 2 / 3 |
| `night` | night factor ≥ 0.6 | < 0.4 | — |
| `storm` | storm (or 0.7 × rain) ≥ 0.45 | < 0.25 | 0 / 5 |
| `fog` | fog ≥ 0.5 | < 0.3 | 0 / 5 |

**Rules table** — states are tried top to bottom (first match wins; a new state must hold 1.5 s unless it is
immediate), then every matching modifier applies. Levels are 0..1 per stem (`b s m c a` = base, strings, motion,
colour, air).

| Rule | Kind | When | Mix / effect | Prefer (avoid) | Policy |
| --- | --- | --- | --- | --- | --- |
| underwater | state, immediate | underwater | b .85 | — | hold |
| moment-own-music | state, immediate | momentMusic | full mix, duck .1 | the moment's set | moment |
| moment | state, immediate | moment | b .8 a .7, duck .8 | — | hold |
| race-countdown | state, immediate | raceCountdown | b .6 a .5, duck .3 | race | race |
| race | state, immediate | race | b .9 s .8 m 1 c .3 a .3 | race, flight | race |
| perched | state | perched | b .85 s .3 c .25 a .8 | calm, perch (race) | always |
| grounded | state | grounded | b .75 a .65 | calm (race) | normal |
| swimming | state | swimming | b .75 c .45 a .5 | water, calm (race) | normal |
| cruising | state | (fallback) | b .9 s .8 a .3 | flight (race) | normal |
| fast | modifier | fast | + m .75 | | |
| dive | modifier | diving | + m .9 s .1, duck .1 | | |
| high-flow | modifier | highFlow | + m .6 s .1 | | |
| low-over-water | modifier | lowOverWater | + c .9 | water | |
| thermal | modifier | thermal | + a .7 s .15 | | |
| night | modifier | night | × s .55 m .7, + a .1 | night (day) | |
| day | modifier | not night | — | day (night) | |
| storm | modifier | storm | × b .8 s .5 m .6 c .4 | storm | |
| fog | modifier | fog | + a .35, × m .7 | fog | |
| menu | modifier | menu | duck .35 | | |

States marked "duck only" (underwater, moments, races) take only the modifiers' ducks, not their stem changes.
Several ducks combine as 1 − Π(1 − duck).

**Policies** (how a state treats the play / silence cycle): `normal` music comes and goes; `always` starts music (after
1.5 s) even during a silence and keeps the set going (perch viewing); `race` like always, switching to a race-tagged
set on the next bar (during the countdown: placed so its downbeat hits "Başla!"); `moment` switches to the moment's
set on the next bar; `hold` starts and changes nothing (under water, moments without their own music).

**Smoothing:** each stem glides to its target with a one-pole filter (2.2 s rising, 3.5 s falling); the duck ducks in
with 0.5 s and releases with 1.6 s. With the hysteresis and hold times the mix never flickers (the check drives noisy
speed across the thresholds for a minute and allows at most one change).

**Set choice** (`director.ts`): every set scores +2 per preferred tag and −3 per avoided tag; the set that played last
gets −1.5 (variety). A normal change needs a 2-point lead and 45 s of the current set (a perch may change it at once),
and lands on a phrase boundary.

**Play / silence cycle:** first set after 12–30 s; a set plays 2–4 minutes, ends on a phrase boundary (2-bar fade or
the outro stinger), then 1–3 minutes of silence. Perch viewing, races and moments with their own set break a silence;
the music does not end while they last.

**Adaptive off** ("Uyarlanabilir müzik" off): every stem at full level, no set preferences (plain rotation, still
with silences); the moment duck, the menu duck and the under-water muffle remain.

### Tuning

- Levels, thresholds, hold times, policies: edit `MUSIC_RULES` / `MUSIC_CONDITIONS` in `rules.ts`; the time constants
  `RISE_TAU_S`, `FALL_TAU_S`, `DUCK_*`, `STATE_DWELL_S` sit below them.
- Cycle and transitions: `DEFAULT_DIRECTOR` in `director.ts` (play / silence ranges, minimum set time, switch margin,
  fade lengths, race countdown length).
- Overall music level against the world: `MUSIC_LEVEL` in `player.ts`. A single set or stem: `gain` in the manifest.
- New tags work without code: tag the sets and add `prefer` / `avoid` to a rule.
- After any change: `npx tsx tools/headless/music-check.ts`, then listen with `?music=debug`.

## Settings

Ayarlar → Ses: **Müzik** (volume, persisted as `ejderha.audio.music.volume`, default 80 %), **Müzik tarzı** (Seyrek /
Sürekli, persisted as `ejderha.audio.music.style`; unset = Seyrek when the manifest has sprinkle phrases, else Sürekli)
and **Uyarlanabilir müzik** (on / off, persisted as `ejderha.audio.music.adaptive`, default on). At zero volume nothing
new is decoded.

## Checks

`npx tsx tools/headless/music-check.ts` (Node only, fake clock, no WebAudio): manifest validation (a good example, 20+
bad ones, the shipped manifest with files on disk, the test sets), bar-grid math, the rules (every state and modifier,
hysteresis, no flicker, dwell, smoothing, adaptive off), and the director (an hour of play / silence, endings on
phrase boundaries, decode waits, perch, preference changes on phrases, race countdown sync and stingers, moment sets
on the next bar, holds, pause shift).

The music check also covers the historic recordings: the shipped manifest has no US-risky piece and no `private/`
path, every restored piece ships both variants with their measured loudness and `raw` swaps to the raw files, the
private manifest validates with its files when this machine has it and merges without conflicts, every moment's
`musicId` names a piece (a private one only notes its absence), and the licence / variant / merge rules reject bad
examples.

`npx tsx tools/headless/music-sprinkle-check.ts` (Node only, fake clock, seeded RNG): phrase validation (good sprinkles
and moment pieces, 20+ bad ones incl. a missing licence, advice warnings, the test phrases with their silent head and
tail, loudness correction), the context (tags, holds, busy flight), picking (time restriction, measured weights,
adaptive off, no phrase or family repeats), the scheduler over simulated hours (gap distribution, first gap, long-calm
shortening, holds for races, moments, photo mode, menus and under water with a fade on interrupt and quiet afterwards,
waiting for calm after sprints, dives and boosts, decode waits, determinism), moment music (choice by id / category /
mood / time, no repeat, 2.5 s fade-in, 3.5 s fade-out, short pieces ending on their own, slow decodes dropped,
back-to-back moments) and the styles (automatic default, loops ending after a race in sparse style).

`npx tsx tools/headless/music-source-check.ts` (Node only, fake clock): the moment music sources — the distance curve
(level and cutoff fall with distance, the highs first, silent at the reach, night carry and its limits), wind masking
by speed and mode and the perch / stand clarity, the lead-in (starting inside the reach long before the moment's
place, carried on by the moment, a world sound that fades just past the reach when the moment never starts, the
cooldown), the opening and closing, the world-to-memory cross-fade and its return, memory direction from `from`, the
ferry source following its moving anchor, NaN safety, and zero cost with no source near.

## Appendix: Suno prompts for stem-friendly music

General rules: instrumental, a fixed tempo written in the prompt, "loop", "no intro, no outro, no fade", sparse
arrangement (each instrument clearly separated, few instruments at once), soft dynamics. Generate several takes and
keep the one with a steady tempo and a clear section of 8 / 16 bars. Use the same style prompt with "solo piano" /
"strings only" etc. to get matching versions when stem export is not available.

**Day flight (`day`, `flight`)** — style:
`cozy open-world game soundtrack, instrumental, 84 bpm, D major, gentle felt piano melody, warm soft strings, light
pizzicato, soft shaker, subtle oud ornaments, airy pads, hopeful, wide, seamless loop, no intro, no outro, no fade`

**Perch / viewing (`calm`, `perch`)** — style:
`calm ambient game music, instrumental, 70 bpm, soft piano chords, distant ney flute phrases, warm pad, lots of space,
peaceful rooftop view at sunset, minimal, seamless loop, no drums, no intro, no outro`

**Night (`night`, `calm`)** — style:
`quiet night game soundtrack, instrumental, 66 bpm, 3/4 waltz feel, A hicaz flavour, soft piano, bowed strings very
soft, gentle kanun plucks, starry, intimate, sparse, seamless loop, no fade`

**Over the water (`water`, `flight`)** — style:
`light acoustic game music, instrumental, 90 bpm, flowing piano arpeggios, oud melody, soft frame drum, sea breeze,
Bosphorus morning, bright but gentle, seamless loop, no vocals`

**Race (`race`, `flight`)** — style:
`playful energetic game music, instrumental, 120 bpm, E minor, driving pizzicato strings, light percussion, piano
ostinato, bağlama riff accents, adventurous but friendly, seamless loop, strong downbeat on bar 1, no intro, no outro`

Stingers: prompt the same style with "short 2-bar ending flourish" (finish), "single bright chord hit" (go), "soft
2-bar lead-in" (intro).

Keep the Istanbul colour light: one colour instrument per set, in the `colour` stem, playing phrases with rests.

## Appendix: prompts for phrases and moment pieces (Gemini Lyria / Suno)

The key words for sprinkles are **a single short phrase, one instrument, then silence**. Generators like to fill time,
so say what must *not* be there, keep the requested length short, and cut the best 20–40 s from a longer take if
needed. Generate on a plan that grants commercial use and keep the generation link for `sourceUrl`.

**Gemini Lyria** (text-to-music; negative prompts help):

- Prompt: `a single short solo ney phrase, breathy and soft, a few slow notes in uşşak, then silence, recorded close,
  dry, peaceful Istanbul morning, 30 seconds` — negative: `drums, percussion, pads, strings, choir, vocals, chords,
  reverb wash, fade in, looping groove`.
- Prompt: `three or four gentle kanun notes, a small falling phrase, long pauses between notes, solo instrument, then
  silence, calm sea breeze` — negative: `accompaniment, rhythm, bass, ostinato, loop`.
- Prompt: `one low tanbur note ringing out, then two more after a long pause, solo, night, meditative, sparse, then
  silence` — negative as above.
- Lyria's "density" / "brightness" controls, where offered: density low, brightness low to medium; keep bpm unset or
  slow (60–70).

**Suno** (use Instrumental; the style field carries most of it):

- Style: `solo ney, single short phrase, sparse, very quiet, lots of silence, no drums, no accompaniment, no pads,
  ambient field recording feel, instrumental`. Lyrics field: `[Instrumental] [Solo ney phrase] [Silence] [End]`.
- Style: `solo oud, a short improvised taksim fragment in hicaz, a few notes then silence, intimate, dry room,
  instrumental, no percussion`.
- Suno tends to build up: pick takes that stay on one instrument and cut before any second instrument enters.

**Moment pieces** (40–120 s, one or two instruments, a real ending):

- `a tender, nostalgic piece for a poem read by the sea, solo ney with a very soft warm pad underneath, slow, rubato,
  80 seconds, gentle start, ends on a long held note that fades naturally, no drums` (Lyria negative: `beat, drums,
  vocals, choir, loop, abrupt ending`).
- `solemn historical memory, kanun and cello duet, slow, sparse, makam hicaz colour, 90 seconds, dignified, ends
  quietly, instrumental, no percussion`.
- `quiet night on the Bosphorus, solo piano and distant ney, very slow, lots of space, 60 seconds, soft ending`.

Keep the Istanbul colour honest and light: one instrument, played simply, with rests. Check each take for a clean,
silent tail before approval.
