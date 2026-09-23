# Phase 07 — Regional and adaptive music

Milestone: B · Chill loop · Effort: M · Depends on: 03

## Goal

Music specific to the region we are flying over, feeling different while perched, while soaring and at night.

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
- A licence record per track is kept under `.docs/licenses/`.
- Fallback layer: makam-based synthesized ambience in the existing audio module (offline and licence-free).
- Decided with the user at the start of this phase (budget and commercial intent).

## Technical approach

- `src/audio/music/`: region resolver (position → region, with hysteresis), layer mixer, WebAudio streaming playback
  (OGG/Opus), bar and tempo metadata.
- Files in `public/music/<region>/<layer>.ogg`; lazy loading, only nearby regions cached.
- UI: music volume in settings, a "play only while viewing" option, the current track name (on the viewing screen).

## Acceptance criteria

- At least one piece for each of the 7 regions; no hard cut at region boundaries.
- The viewing layer arrives within 3 s of perching; takeoff switches to the soaring layer.
- Memory: audio for at most 2 regions loaded at a time.
- Every track's licence is documented.
