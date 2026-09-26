# Phase 07 — Regional and adaptive music

Milestone: B · Chill loop · Effort: M · Depends on: 03

## Goal

Music specific to the region we are flying over, feeling different while perched, while soaring and at night.

## Status (2026-09-26): adaptive system built, no music yet

The adaptive music system is built (`src/audio/music/`, owner guide and rules table in
[`.docs/audio/music-system.md`](../audio/music-system.md)); the pieces themselves are pending — the owner produces
them (Suno) or picks CC-BY tracks, and each set is approved before it is added. `?music=test,debug` plays three
procedural DEV test sets so the adaptation can be heard now.

As built:

- **Sets of stems** instead of one track per layer: each set has up to five equal-length loopable stems (`base` piano,
  `strings`, `motion` pizzicato / light percussion, `colour` oud / kanun / ney, `air` pads), a tempo grid (bpm, meter,
  bars, phrase), a key / makam tag, mood tags, optional stingers (intro, outro, race go / finish) and its credit and
  approval date, in `public/audio/music/manifest.json` (validated on load and by `tools/headless/music-check.ts`).
- **Rules table** (data, not per track): conditions with hysteresis and hold times → a state (underwater, moment,
  race, perched, grounded, swimming, cruising) and modifiers (fast, dive, high flow, low over water, thermal, night,
  storm, fog, menu) → a target stem mix, a music duck and set tag preferences, smoothed with one-pole glides.
- **Director:** a set plays 2–4 min, ends on a phrase boundary, then 1–3 min of silence; set changes land on phrase
  boundaries (races and moments on the next bar); perch viewing, races and a moment's own set break a silence; the
  race set's downbeat is placed on "Başla!".
- **Engine:** a music bus on the master bus (own volume, ducks, the under-water muffle; not the pause filter — menus
  keep the music, 35 % quieter), sample-locked stem loops on the AudioContext clock, on-demand decoding with at most
  two decoded sets.
- **Settings:** Ayarlar → Ses → Müzik (volume) and Uyarlanabilir müzik (off = plain full mix).
- Moments duck the music strongly, or play their own set when `MomentContent.musicId` names one.

Not yet: region-aware set choice (the table below — planned as tags such as `region:peninsula` that a rule prefers
from the geo district, no engine change needed), the "play only while viewing" option and the track name on the
viewing screen (the credit line exists: `creditLine()` in `manifest.ts`).

## Music regions

Defined from the geo module's district and land-use data:

| Region | Character |
|---|---|
| Historic peninsula | Classical Turkish music flavour: ney, oud, kanun; Hicaz and Rast makams |
| Beyoğlu and Galata | Urban, light jazz and old Istanbul |
| Bosphorus | Wide and flowing, strings and ney |
| Princes' Islands | Calm, acoustic, with wave sounds |
| Black Sea entrance and northern forests | Windy, kemençe and tulum flavour |
| Above the clouds | Ambient, high and wide |
| Levent and Ataşehir | Modern, electronic underlayer |

## Adaptive layers

- Each regional piece is layered (stems): exploration (base), viewing/perch (calm), soaring (rising), action (Phase 11), night variant.
- Layers fade in and out with the flight state over a few seconds; region changes crossfade aligned to the bar.
- High-speed wind slightly ducks the music; while perched the music comes forward.
- Silence is designed too: music does not play constantly; it arrives on region entry and during viewing moments.

## Source and licensing

- Well-known songs are copyrighted and cannot be used without a licence.
- Options:
  1. Royalty-free tracks whose licence allows use in games.
  2. Original tracks generated with a service that grants commercial rights.
  3. Commissioning a composer.
- A licence record per set is kept in `public/audio/music/LICENSES.md` and in the manifest's `credit` field.
- Fallback layer: makam-based synthesized ambience in the existing audio module (offline and licence-free).
- Decided with the user at the start of this phase (budget and commercial intent).

## Technical approach

- `src/audio/music/` (built): layer mixer, WebAudio playback (Opus with AAC fallback), bar and tempo metadata; the
  region resolver (position → region tag, with hysteresis) remains to be added as a rule condition.
- Files in `public/audio/music/<set-id>/<role>.opus` (+ `.m4a`); decoded on demand, at most two sets in memory.
- UI: music volume in settings, a "play only while viewing" option, the current track name (on the viewing screen).

## Acceptance criteria

- At least one piece for each of the 7 regions; no hard cut at region boundaries.
- The viewing layer arrives within 3 s of perching; takeoff switches to the soaring layer.
- Memory: audio for at most 2 regions loaded at a time.
- Every track's licence is documented.
