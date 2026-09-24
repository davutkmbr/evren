# Sound candidates (decided)

## Decision (2026-09-24)

The user approved the recommended set: **18 recordings, all CC0 1.0, from Freesound.**

- **Thunder (6):** TRP 574412 (close crack) and bajko 399656 (blast) for near strikes; TRP 574386, 574385, 574384 and
  574391 (rolls from the same storm) for distant ones.
- **Wind (2):** zazz.sound.design 819581 (rush) and klankbeeld 611197 (ear buffet).
- **Wing flaps (8):** 2create 670509 and ani_music 1a–7a.
- **Rain (2):** TRP 574296 (heavy wash) and kyles 450360 (light rain).

Scope and integration:

- The game files are built from each sound's public HQ preview (OGG, about 192 kbps), which the user approved in place
  of the originals (those need a Freesound login, see [Integration notes](#integration-notes)).
- Not approved: every other candidate, including the optional dive layer (qubodup 162417), the real-recording wind
  fallback (cognito perceptu 20108) and the OpenGameArt "Dragon Flap".
- `node scripts/data/fetch-assets.mjs --kind=sound` caches them in `assets-src/sound/<id>/`.
  `node scripts/audio/prep-sounds.mjs` trims, high-passes, loops and slices them into `public/audio/` (AAC, 4.4 MB)
  and writes `sounds.json` and `LICENSES.md`. `src/audio/samples.ts` loads them; every voice synthesizes while its
  group is loading or unavailable.
- The TRP "ms" files are already decoded to L/R (highly correlated channels at equal level), so no M/S decoding.
- The 2create flaps are high-passed at 110 Hz: the close mic caught each flap's air blast as a sub-bass pulse.

Records: manifest [`tools/assets/approved.json`](../../../tools/assets/approved.json), cache record
[approved-assets.md](../approved-assets.md), licences [`public/audio/LICENSES.md`](../../../public/audio/LICENSES.md).

---

Status before the decision: shortlist only. No sound was downloaded, added to `assets-src/`, `private-assets/` or
`public/`, or referenced in code. The only files fetched were each sound page's own waveform and spectrogram images.
Checked live on 2026-09-24; everything below is kept unchanged as the record of the review.

Need (player feedback): the wing-flap and thunder sounds are "very bad", and the wind is "bad and too loud". All game
audio is synthesized with WebAudio today: thunder in `src/audio/sfx/weather.ts`, the wing beat in `src/audio/sfx/flap.ts`,
the airflow layers in `src/audio/voices/wind.ts` and the rain bed in `src/audio/voices/rain.ts`. Recorded CC0 sounds
should replace or underlay these layers:

1. **Thunder**: (a) close strike with a sharp crack and a heavy roll, 6–15 s; (b) distant rolling rumble, 8–20 s.
2. **Wind / airflow for flight**: a steady, loopable rushing-air bed (wind past the ears and body at speed, not wind
   howling through buildings), 20 s or longer. Optionally a stronger dive variant.
3. **Large wing flaps**: a big, deep, leathery "whoomp" (large bird wing, sail, canvas, tarp or large cloth), dry. Single
   hits or a series we can slice.
4. **Rain**: a loopable, steady rain bed (moderate rain on a city or roofs, no thunder), 30 s or longer.

## Read this first

- **Every candidate is CC0**, verified on its own Freesound page. CC0 needs no attribution and allows redistribution, so
  none of them needs `private-assets/`.
- **One storm covers thunder and rain.** Freesound user TRP recorded one session (file names "77mel 190903") with a
  Neumann KMR82i + AT2050 mid/side pair, uploaded as 24-bit FLAC. It contains the best close strike, five distant rolls
  and a steady rain wash, so near thunder, far thunder and rain would sound like one storm.
- **Wind is the weak spot.** No clean CC0 recording of airflow at flight speed exists. The skydive and car-window
  recordings found are clipped. The recommended bed is two layers: a designed broadband rush (zazz) and a "wind in the
  ears" buffet recording (klankbeeld). Dives would be built from the same bed.
- **All the flaps are foley** (bed sheets, a flag, fabric), not real wings. The plan is a sliced round-robin, pitched
  down, over the existing synthesized sub-bass thump.
- **I did not listen to anything.** Every "sounds like" line comes from the page text and tags plus my reading of the
  Freesound waveform and spectrogram. Listening on the Freesound pages is the approval step.
- **Downloading the originals needs a free Freesound login** (see [Integration notes](#integration-notes)).

## How this list was built

- **Sources**
  - Freesound, with the "Creative Commons 0" licence filter: about 70 searches (thunder crack / strike / clap / close /
    distant / rolling / rumble / no rain; wind loop / rushing / steady / constant / buffeting / in ears / helmet / car
    window / freefall / skydiving / paraglider / glider / wind tunnel / air rush; wing flap / large wings / dragon wings /
    cloth whoosh / cape / tarp / sail / umbrella / blanket; rain city / roof / street / balcony / steady / moderate / loop,
    excluding "thunder"). About 110 sound pages were read and about 100 waveforms and spectrograms inspected.
  - OpenGameArt CC0 sound effects (wind, thunder, rain, wing, flap): nothing better. The wind files are Pure Data synthesis
    or low-fi, and the rain files are GoPro or processed mono. "Dragon Flap" is listed under
    [flaps](#3-large-wing-flaps) as unevaluated.
  - Sonniss GameAudioGDC was not needed, because every need has CC0 candidates.
- **Licence rule** (CLAUDE.md, "External assets"): free with a clear licence, CC0 preferred. I searched with the CC0
  filter only, so no CC-BY candidates appear. I also skipped uploads whose CC0 rests on a doubtful claim (vintage studio
  transfers, mixes of other users' sounds).
- **Licence check.** Each page's licence link reads "Creative Commons 0" and points to
  `http://creativecommons.org/publicdomain/zero/1.0/`. I also scanned the descriptions for requests that conflict with it.
  None of the shortlisted pages has one; a few ask for optional credit or a comment.
- **Technical data** (type, duration, file size, sample rate, bit depth, channels) is copied from each page's info block.
  "Size" is the original upload. "Popularity" is the page's downloads and average rating (number of ratings).
- **Previews** are saved under `.shots/assets/sounds/<topic>-<n>.png`:
  - top: the page's own waveform, drawn at absolute scale, with red guide lines at full scale. A flat top against a red
    line means likely clipping.
  - bottom: the page's own spectrogram, on a log frequency axis from about 100 Hz to 22 kHz. I added 1 kHz and 10 kHz
    guides, calibrated against Freesound sine-tone uploads, and time ticks. Anything below about 100 Hz (sub rumble) is
    not visible in the spectrogram; the waveform shows it.

---

## 1a. Thunder: close strike

| # | Name | Author | Source | Licence (page) | Duration | Format | Size | Popularity | Preview |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Thunder big crack explosive close ms 77mel 190903.flac | TRP | [Freesound 574412](https://freesound.org/people/TRP/sounds/574412/) | CC0 | 0:18.0 | FLAC, 48 kHz, 24-bit, stereo (M/S pair) | 2.7 MB | 280 dl, 4.8 (11) | [thunder-close-1.png](../../../.shots/assets/sounds/thunder-close-1.png) |
| 2 | sfx_thunder blast.wav | bajko | [Freesound 399656](https://freesound.org/people/bajko/sounds/399656/) | CC0 | 0:17.3 | WAV, 48 kHz, 24-bit, stereo | 4.8 MB | 22,968 dl, 4.8 (238) | [thunder-close-2.png](../../../.shots/assets/sounds/thunder-close-2.png) |
| 3 | Heavy Thunder Strike - no Rain - QUADRO.wav | BlueDelta | [Freesound 446753](https://freesound.org/people/BlueDelta/sounds/446753/) | CC0 | 1:02.0 | WAV, 48 kHz, 24-bit, **4 channels** (FL, FR, RL, RR) | 34.1 MB | 46,073 dl, 4.7 (504) | [thunder-close-3.png](../../../.shots/assets/sounds/thunder-close-3.png) |
| 4 | big thunder clap | seth-m | [Freesound 458015](https://freesound.org/people/seth-m/sounds/458015/) | CC0 | 0:11.4 | WAV, 48 kHz, 16-bit, stereo | 2.1 MB | 1,116 dl, 4.4 (19) | [thunder-close-4.png](../../../.shots/assets/sounds/thunder-close-4.png) |

| # | Sounds like | Use in Evren | Caveats |
|---|---|---|---|
| 1 | A faint sizzle at 0.8 s, then an explosive broadband crack at 2.5 s (energy above 10 kHz). A heavy low-mid roll follows until about 8 s, with a low tail to 12 s. No rain. Peaks at 0.73 of full scale, no clipping. | One-shot for near strikes (thunder strength ≥ 0.6). Trim to 0.5–13 s. Replaces the synthesized "tear" and first roll; keep the synthesized sub swell under it. | Only 11 ratings. "ms" = mid/side pair: confirm the file is decoded L/R before use. |
| 2 | Starts on the blast: bright, broadband (to about 10 kHz), decaying over 3 s, with a second rumble at 5–8 s. Recorded on Nessebar beach (Bulgaria) with a Shure MV88 and de-noised in iZotope RX 6. | Variation for random choice. Use 0–9 s with a 5 ms fade-in. | No pre-roll (the attack starts at sample 0). After 8.5 s the de-noising leaves a gated, empty-sounding tail, so cut there. |
| 3 | A very heavy strike, mostly below 1 kHz, with dense rolling for 10 s that decays until about 25 s. The crack is softer than in #1. No rain, no limiter (the author says the whole dynamic range is kept). Peaks at 0.95. | The "heaviest" variation. Downmix 4 → 2 (FL+RL, FR+RR) and trim to 0–20 s. | Large 4-channel PolyWAV; the last 35 s are near silence. |
| 4 | A dry clap at 0.8 s (peaks 0.97) and a low roll until about 6 s, with no rain. Recorded on an Edirol R-09HR. | Short near-strike variation for frequent storms. Trim to 0.5–8 s. | 16-bit. The spectrogram shows an edited patch at 4–5.5 s (about 2–3 kHz), probably noise removal; listen for artefacts. |

Also considered:

- *Thunder Clap OWB KY 441x16.wav* (Dave Welsh, [194364](https://freesound.org/people/Dave%20Welsh/sounds/194364/)):
  the most-downloaded CC0 thunder (42,358 dl, 4.8 from 443 ratings), 16-bit. The clap sits flat against full scale in
  the waveform (clipped or limited). Worth one listen as a reference.
- *Closeup Thunder Strike 01* (loganzsound, [840628](https://freesound.org/people/loganzsound/sounds/840628/), 24-bit,
  5.0 from 35 ratings): the crack touches full scale (possible clipping). Recorded on a Blue Yeti Pro.
- Rejected for clipping or distortion: csengeri 434359 (dictaphone), Ionizing 22033 (the author says "clipped quite a
  bit"; the file also contains a reversed copy), Rowy101 186907, foad 243614 (the author warns of distortion) and
  Martineerok 264826.
- Rejected for other reasons: Filip_Merynos 619717 (heavy rain and peaks at full scale); AyaDrevis 652690 (a 90 KB OGG
  original); TRP 717907 and 717909 (MP3 originals); Fission9 534023 (small cracks with little roll, better as
  mid-distance); AudioPapkin 712017 (a dense roll hard-cut at 6.7 s); s-light 414050 (a mix of other users' sounds).

**Recommendation:** TRP 574412. It is the only close strike here with a clean crack, a heavy roll, 24-bit audio and no
clipping, and it comes from the same storm as the distant and rain picks. bajko 399656 is the second variation.

## 1b. Thunder: distant rolling rumble

| # | Name | Author | Source | Licence (page) | Duration | Format | Size | Popularity | Preview |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Rolling thunder closer rain drops ms 77mel 190903.flac | TRP | [Freesound 574386](https://freesound.org/people/TRP/sounds/574386/) | CC0 | 0:41.4 | FLAC, 48 kHz, 24-bit, stereo (M/S pair) | 6.3 MB | 158 dl, 5.0 (7) | [thunder-distant-1.png](../../../.shots/assets/sounds/thunder-distant-1.png) |
| 2 | THUNDER long rumbling - no Rain - 4-CHANNEL-44kHz.wav | BlueDelta | [Freesound 367702](https://freesound.org/people/BlueDelta/sounds/367702/) | CC0 | 1:00.2 | WAV, 44.1 kHz, 24-bit, **4 channels** | 30.4 MB | 2,040 dl, 4.9 (52) | [thunder-distant-2.png](../../../.shots/assets/sounds/thunder-distant-2.png) |
| 3 | Rolling thunder low muffled ms 77mel 190903.flac | TRP | [Freesound 574385](https://freesound.org/people/TRP/sounds/574385/) | CC0 | 0:15.1 | FLAC, 48 kHz, 24-bit, stereo (M/S pair) | 2.1 MB | 104 dl, 4.5 (4) | [thunder-distant-3.png](../../../.shots/assets/sounds/thunder-distant-3.png) |
| 4 | 230405 Thunder DRY rolling distant low rumbles, roof, EM272s, Toronto 7am | TRP | [Freesound 717845](https://freesound.org/people/TRP/sounds/717845/) | CC0 | 2:57.6 | **MP3** (about 320 kbps), 48 kHz, stereo | 6.8 MB | 749 dl, 4.9 (37) | [thunder-distant-4.png](../../../.shots/assets/sounds/thunder-distant-4.png) |

| # | Sounds like | Use in Evren | Caveats |
|---|---|---|---|
| 1 | A deep roll in several swells from 0 to about 26 s (the biggest at 9 s). Almost all the energy is below 1 kHz. Light rain drops and some wind remain after the roll. | Distant rumble one-shot (strength < 0.6). Use 0–22 s, or single swells as shorter variations. The existing distance low-pass and reverb still apply. | Faint steady background tones near 2.5 and 7 kHz. Rain drops in the tail, which the rain bed will cover. |
| 2 | A strike at about 4 s, then a long low roll decaying until about 35 s. No rain. Peaks at 0.94. Rode NT1-A mics in an IRT cross. | Medium-distance thunder (strength 0.4–0.7), or distant if the first 5 s are cut. Trim to 3–30 s and downmix 4 → 2. | Large 4-channel file. 44.1 kHz (resampled when decoded, which is fine). |
| 3 | One short, very low, muffled roll from 2 to 9 s. Energy is mostly below about 300 Hz, over a clean background. | Far-away variation (strength < 0.3). Its sister files from the same session add two more: [574384](https://freesound.org/people/TRP/sounds/574384/) (24.5 s) and [574391](https://freesound.org/people/TRP/sounds/574391/) (12.5 s), both CC0 FLAC. | Only about 7 s of roll. Few ratings. |
| 4 | About eight separate dry distant rolls over 3 minutes, with no rain. | Slice into 6–8 distant rumbles for random variety. | The original upload is MP3 (lossy, although that matters little below 1 kHz). The quiet gaps between rolls need trimming. |

Also considered:

- **Clean alternatives:** TRP 574387 *Rolling thunder closer* (same session), TRP 717890 (a second dry 4-minute MP3) and
  tams_kp 653664 *quiet rumble thunder* (24-bit, 21.5 s).
- **Usable, with caveats:** mikala_oidua 347562 (16-bit, noise-reduced), Emulius 744723 (quiet) and Yoyodaman234 267550
  (16-bit, peaks at full scale).
- **Rejected, rain throughout:** Fugeni 559804, elmoustachio 476738, bastipictures 243780 (also an MP3 original).
- **Rejected, not a plain recording:** BlueDelta 367222 is slowed to 0.7× speed; lmbubec 118806 is a wobbled metal sheet.

**Recommendation:** TRP 574386, plus its sister rolls 574385, 574384 and 574391. They come from the same storm and mics
as the close strike, and together they give four or five far-thunder variations.

## 2. Wind / airflow for flight

| # | Name | Author | Source | Licence (page) | Duration | Format | Size | Popularity | Preview |
|---|---|---|---|---|---|---|---|---|---|
| 1 | WINDDsgn_Buffeting Violent Wind_ZAZZ | zazz.sound.design | [Freesound 819581](https://freesound.org/people/zazz.sound.design/sounds/819581/) | CC0 | 1:10.6 | WAV, 96 kHz, 24-bit, stereo | 38.8 MB | 56 dl, 5.0 (3) | [wind-1.png](../../../.shots/assets/sounds/wind-1.png) |
| 2 | wind in ears.wav | klankbeeld | [Freesound 611197](https://freesound.org/people/klankbeeld/sounds/611197/) | CC0 | 0:32.4 | WAV, 44.1 kHz, 24-bit, stereo | 8.2 MB | 703 dl, 4.9 (20) | [wind-2.png](../../../.shots/assets/sounds/wind-2.png) |
| 3 | air over mic.wav | cognito perceptu | [Freesound 20108](https://freesound.org/people/cognito%20perceptu/sounds/20108/) | CC0 | 0:20.2 | WAV, 44.1 kHz, 16-bit, stereo | 3.4 MB | 1,074 dl, 4.3 (12) | [wind-3.png](../../../.shots/assets/sounds/wind-3.png) |
| 4 (dive) | Jet Plane Wind Noise Loop of a KC-135 Stratotanker 1.flac | qubodup | [Freesound 162417](https://freesound.org/people/qubodup/sounds/162417/) | CC0 | 0:06.2 | FLAC, 44.1 kHz, 24-bit, stereo | 1.2 MB | 703 dl, no ratings | [wind-4.png](../../../.shots/assets/sounds/wind-4.png) |

| # | Sounds like | Use in Evren | Caveats |
|---|---|---|---|
| 1 | A dense, steady broadband rush (energy up to about 10 kHz, strongest below 1 kHz) with slow buffeting swells. No whistle or tonal howl. Quiet file (peaks at 0.23). | Main airflow bed. Crossfade-loop about 60 s. Replaces the synthesized body and hiss noise layers; keep the existing speed curve, gusts and filters. | A designed sound (UCS category "WINDDsgn"), not a field recording, and its source is not stated. Published in August 2025 with only 3 ratings. Needs about +12 dB of normalisation. |
| 2 | Low, turbulent buffeting, like wind in the ears: energy below about 1 kHz with irregular puffs every 0.5–2 s. Loopable, according to the author. | Low buffet layer under #1, scaled by airspeed and the first-person blend. Replaces the synthesized rumble and buffeting modulation. | No highs, so it needs #1 on top. Tagged "sound-design", so it may be edited. |
| 3 | A real recording of air rushing over the mics while riding a bike downhill. A dense, bass-heavy rush up to about 8 kHz at an even level, with a few ticks at 12–18 s. | Real-recording alternative to #1, or a mid-speed layer. Crossfade-loop it. | 16-bit, recorded in 2006, only 20 s long (it needs a random start and rate drift to hide the loop). Bike rattles. |
| 4 | Roaring high-speed wind around a camera on a jet: dense and loud (peaks at 0.85), strongest from 100 Hz to 2 kHz. A gapless loop. | Optional dive layer on top of #1 above about 60 m/s. | Taken from a US Government video (public domain according to the uploader; I could not verify the source video). The audio has been through the video's lossy compression (nothing above about 18 kHz). Short loop with faint tonal bands. |

Also considered:

- **Close but flawed:**
  - felix.blume [685233](https://freesound.org/people/felix.blume/sounds/685233/) (car at speed, mic through the
    window, 96 kHz / 24-bit): a good muffled rush, but engine and tyre noise sit under it.
  - Grotelue 204736 *Sailplane Liftoff*: onboard glider airflow, but in an enclosed cockpit, with launch noise in the
    first 10 s.
  - felix.blume 167684 (strong wind in Anatolia): gusts through grass, not airflow past the ear. It could suit the
    ground ambience instead.
- **Rejected for clipping:** FunWithSound 439242 (car window, the waveform is pinned to full scale), DangerLaef 811077
  (skydive camcorder audio, clipped through the freefall), Argande102 170439 (tagged "clipping") and rylandbrooks 328101
  (low-fi GoPro audio).
- **Rejected for whistling or howling:** jpnien 97397 (a whistle band near 650 Hz), Electroviolence 234537 *Wind Tunnel*
  (resonant sweeps), and zazz 819582–819584, which are howling winds by name.
- **Rejected, the same technique as our own synthesis:** cobratronik 117136, Fission9 521820, android_lime 570890,
  sonically_sound 607839, jackstraton 760241, OpenGameArt *wind1* (Pure Data) and ChemiCatz 267899 (breath on the mic
  plus EQ).
- **Rejected, doubtful rights:** craigsmith's *Vintage Wind & Air* and *SSE Vintage Wind*. These are noisy mono
  transfers of 1930s–1970s Hollywood studio film effects. Their CC0 rests on the uploader's preservation claim.

**Recommendation:** layer zazz 819581 (the rush) with klankbeeld 611197 (the ear buffet) as the flight bed. If 819581
sounds too designed when heard, cognito perceptu 20108 is the real-recording fallback. No clean CC0 dive recording
exists, so build the dive by pushing 819581 and the existing synthesized flutter layer; add 162417 only if a jet-like
roar is wanted. "Too loud" is a mix problem: whichever bed is chosen, recalibrate `CRUISE_LOUD` / `SPEED_DB` in
`voices/wind.ts` after the swap.

## 3. Large wing flaps

| # | Name | Author | Source | Licence (page) | Duration | Format | Size | Popularity | Preview |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Huge wing flaps for bird, dragon, dinosaur. | 2create | [Freesound 670509](https://freesound.org/people/2create/sounds/670509/) | CC0 | 0:14.3 | WAV, 96 kHz, 32-bit float, mono | 5.3 MB | 3,694 dl, 4.7 (70) | [flap-1.png](../../../.shots/assets/sounds/flap-1.png) |
| 2 | Large Wings Flapping - Foley.wav | tothrec2 | [Freesound 596541](https://freesound.org/people/tothrec2/sounds/596541/) | CC0 | 0:03.9 | WAV, 48 kHz, 16-bit, stereo | 735 KB | 3,439 dl, 4.7 (58) | [flap-2.png](../../../.shots/assets/sounds/flap-2.png) |
| 3 | Wing Flap (Flag Flapping) 1a–7a (a set of 7 files) | ani_music | Freesound [1a](https://freesound.org/people/ani_music/sounds/244979/), [2a](https://freesound.org/people/ani_music/sounds/244978/), [3a](https://freesound.org/people/ani_music/sounds/244977/), [4a](https://freesound.org/people/ani_music/sounds/244976/), [5a](https://freesound.org/people/ani_music/sounds/244982/), [6a](https://freesound.org/people/ani_music/sounds/244981/), [7a](https://freesound.org/people/ani_music/sounds/244980/) | CC0 (all 7) | 0.38–0.88 s each | WAV, 44.1 kHz, 32-bit float, mono | 70–158 KB each, 748 KB total | 2,611–4,955 dl each, 4.3–4.8 | [flap-3.png](../../../.shots/assets/sounds/flap-3.png) |
| 4 | Large Wings / Superhero Cape Foley | Cultureshock007 | [Freesound 711122](https://freesound.org/people/Cultureshock007/sounds/711122/) | CC0 | 0:43.4 | **MP3** (about 192 kbps), 48 kHz, stereo | 1.0 MB | 1,157 dl, 4.6 (49) | [flap-4.png](../../../.shots/assets/sounds/flap-4.png) |

| # | Sounds like | Use in Evren | Caveats |
|---|---|---|---|
| 1 | About 15 separate bed-sheet flaps, 0.3–0.5 s each and roughly 0.5–1 s apart, with clean gaps. A low-mid body with airy tails up to about 5 kHz. Recorded with an Oktava MK-012 on a Zoom F3. | Slice into a round-robin of 10–15 hits, played pitched down to 0.6–0.85× according to wingspan and strength. Replaces the synthesized push and rush; keep the synthesized sub thump for weight. | Cloth, not leather, so little "leathery" snap (layer #3, or an umbrella snap). Mono, so pan it per wing. |
| 2 | Five deep "whomp" beats about 0.75 s apart. Each is a strong low-frequency air pulse with a short airy tail. | Five hits for the low push, layered with #1. | 16-bit, only five hits, and the foley source is not stated. |
| 3 | Seven single deep whoomps from a flapped flag, dry. Each is one or two big low-frequency air pulses, with energy mostly below about 500 Hz. | A ready-made round-robin for the low "whoomp" (the part the rider feels), pitched down for the 20 m wingspan and paired with #1's airy tails. | Very short hits. A flag has no membrane texture. The low pulses may need the same ~40 Hz high-pass as the wind rumble layer. |
| 4 | About 15 big fabric swoops 2–3 s apart, the last one a layered whoosh. Recorded with a Rode NT1. | Take-off, landing and big-flap variations; the final whoosh for a dive pull-out. | The original upload is MP3 (lossy). One hit near 3 s peaks at full scale. |

Also considered:

- **Useful layers:**
  - lunchmoney [383112](https://freesound.org/people/lunchmoney/sounds/383112/) *Umbrella Flapping* (24-bit mono,
    Sound Devices 788T): a bright, leathery membrane snap.
  - IENBA [701647](https://freesound.org/people/IENBA/sounds/701647/) *Fabric Flapping* (24-bit, Sennheiser MKH50):
    continuous cape flutter, a candidate for membrane rattle in glides and dives.
  - Cerise_Virtuelle 759529 *Large flying creature* (16-bit): tothrec2's #2 layered with an umbrella. A good reference
    for how to layer.
- **Rejected, identical repeated beats:** shatterstars 572216 (MP3), Justjooning 710731 (low-bitrate MP3 copies of one
  hit) and Lsoundaccount 753219 (also very quiet).
- **Rejected, not a big deep flap:** _stubb 389634 (a single harsh coat flap), martian 19295 (quiet flutter), Pdrum
  486462 (flute tones mixed in), Nox_Sound 495390 (light jacket whooshes) and anebulafont 651753 (fast satin flutter).
- **Not evaluated:** OpenGameArt [Dragon Flap](https://opengameart.org/content/dragon-flap-0) (VishwaJai, CC0, WAV
  833.5 KB). One designed double-wing flap, "separated in stereo … as if you're riding", with "amazingly heavy bass".
  OpenGameArt shows no waveform, so it needs a listen.

**Recommendation:** 2create 670509, sliced into a round-robin, with the ani_music whoomps (#3) layered underneath for the
low push. Keep the synthesized sub thump and `duckWind`.

## 4. Rain

| # | Name | Author | Source | Licence (page) | Duration | Format | Size | Popularity | Preview |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Rain heavy wash urban ms 77mel 190903.flac | TRP | [Freesound 574296](https://freesound.org/people/TRP/sounds/574296/) | CC0 | 1:32.5 | FLAC, 48 kHz, 24-bit, stereo (M/S pair) | 19.9 MB | 47 dl, no ratings | [rain-1.png](../../../.shots/assets/sounds/rain-1.png) |
| 2 | Rain on roofs | xkeril | [Freesound 669487](https://freesound.org/people/xkeril/sounds/669487/) | CC0 | 0:54.5 | WAV, 48 kHz, 24-bit, stereo | 15.0 MB | 858 dl, 4.5 (27) | [rain-2.png](../../../.shots/assets/sounds/rain-2.png) |
| 3 | rain medium on terrasse roof.flac | kyles | [Freesound 450360](https://freesound.org/people/kyles/sounds/450360/) | CC0 | 1:36.1 | FLAC, 48 kHz, 24-bit, stereo | 19.2 MB | 773 dl, 4.9 (18) | [rain-3.png](../../../.shots/assets/sounds/rain-3.png) |
| 4 | steady rain in the city.wav | roofusj | [Freesound 217236](https://freesound.org/people/roofusj/sounds/217236/) | CC0 | 3:05.7 | WAV, 96 kHz, 16-bit, stereo | 68.0 MB | 7,211 dl, 4.4 (103) | [rain-4.png](../../../.shots/assets/sounds/rain-4.png) |

| # | Sounds like | Use in Evren | Caveats |
|---|---|---|---|
| 1 | A dense, even wash of heavy urban rain, broadband from 200 Hz to 12 kHz (most energy at 0.5–2 kHz). No discrete events are visible. From the same session as thunder 1a-1 and 1b-1. | The `RainVoice` wash layer, replacing the band-passed pink noise. Crossfade-loop about 60 s. For "moderate", lower its level and low-pass it. | "Heavy" rather than moderate. Unrated (47 dl). Confirm the M/S file is decoded L/R. |
| 2 | Moderate-to-heavy rain on roof tiles, heard from a window (Zoom H5 + SGH-6 shotgun, Vevey). A very even level, body at 200 Hz–1 kHz, a few drips. | Wash layer with roof-tile character, which suits Istanbul's roofs. Crossfade-loop about 50 s. | Only 54 s. The shotgun mic gives a narrower image. The page tags it "metallic", so drips may stand out at the loop point. |
| 3 | Medium, steady rain on a terrace roof. Broadband with occasional louder drops and a light low end. | Lighter layer for low rain intensity, crossfaded with #1 by `rain` 0..1. | Gear not stated. Keep the louder drops away from the loop point. |
| 4 | Steady city rain from a windowsill (Zoom Q3HD), mostly below 1 kHz. A few close drops in the first minute and some distant city noise. | Alternative city bed: take a 60 s slice after 1:00. | 16-bit and a large 96 kHz file. The rain thins slightly after 1:00. |

Also considered:

- **Usable alternatives:**
  - tarasyoung [399685](https://freesound.org/people/tarasyoung/sounds/399685/) *Summer rain on quiet city street*:
    moderate city rain, 16-bit, 6:46 long, with a car passing at about 4:40.
  - Garuda1982 852917 (gentle steady city rain, EM272 mics, 16-bit).
  - Snoopy20111 399072 *Rain_Loop* (16-bit, 96 kHz, M/S, quiet).
  - TRP 574301 *Rain med drippy details* (same session): could feed the patter layer.
- **Rejected, the author's wish conflicts with our public build:** speakwithanimals 525046 *Rain Slowly Passing TREATED
  LOOP* is CC0, but the author asks people not to redistribute it.
- **Rejected, close or specific sources:** Q.K. 56311 (close roof drumming), conleec 171981 (mono, a stream splashing
  from a balcony), idomusics 518863 (quiet, drips), loopbasedmusic 157487 (low rumble and close drops) and Dominik_W
  398593 (very quiet Zoom H1 recording).
- **Rejected, not a plain rain recording:** szegvari 581148 (a designed drone underneath), Garuda1982 627272 (wind gusts)
  and the OpenGameArt rain loops (GoPro audio, or processed mono).

**Recommendation:** TRP 574296 for the wash: steady, 24-bit and from the same storm as the thunder. If moderate rain
needs its own texture, add kyles 450360 as the lighter layer.

---

## Recommendation

| Need | Pick | Licence | Why |
|---|---|---|---|
| Thunder, close | TRP [574412](https://freesound.org/people/TRP/sounds/574412/); bajko [399656](https://freesound.org/people/bajko/sounds/399656/) as a variation | CC0 | Clean crack and heavy roll, 24-bit, no clipping; same storm as the far thunder and rain. |
| Thunder, distant | TRP [574386](https://freesound.org/people/TRP/sounds/574386/) + 574385, 574384, 574391 | CC0 | Deep rolls from the same session, giving 4–5 variations with no extra mixing work. |
| Wind bed | zazz [819581](https://freesound.org/people/zazz.sound.design/sounds/819581/) + klankbeeld [611197](https://freesound.org/people/klankbeeld/sounds/611197/) | CC0 | Steady broadband rush plus a low ear buffet, both 24-bit and loopable, with no whistle. |
| Wind, dive | Push the bed plus the synthesized flutter; qubodup [162417](https://freesound.org/people/qubodup/sounds/162417/) optional | CC0 | No clean CC0 dive recording exists. |
| Wing flaps | 2create [670509](https://freesound.org/people/2create/sounds/670509/) + ani_music 1a–7a | CC0 | About 15 big flaps to slice plus 7 deep whoomps: enough hits for a round-robin with little audible repetition. |
| Rain | TRP [574296](https://freesound.org/people/TRP/sounds/574296/) (+ kyles [450360](https://freesound.org/people/kyles/sounds/450360/) for light rain) | CC0 | The steadiest wash, 24-bit, same storm as the thunder. |

## Integration notes

- **Licence and attribution**
  - Everything shortlisted is CC0, so no attribution is required and the encoded game files may sit in `public/`.
  - The project rule still applies: record source, author and URL on integration. CLAUDE.md names only
    `public/models/LICENSES.md` and `public/textures/LICENSES.md`, so audio needs a new `public/audio/LICENSES.md`
    (user's call).
- **Download**
  - Freesound originals need a free account: the page button reads "Login to download", and the APIv2 download
    endpoint "requires OAuth2 authentication" ([API docs](https://freesound.org/docs/api/resources_apiv2.html)).
    The open previews are lossy (MP3 at about 128 kbps, OGG at about 192 kbps), so they are not masters.
  - Approved sounds therefore go into `tools/assets/approved.json` as `kind: "sound"` with `download: "manual"`.
    `scripts/data/fetch-assets.mjs` lists them in `.docs/assets/manual-downloads.md`, and the raw originals go to the
    gitignored `assets-src/sound/<id>/` (about 110 MB for the recommended set).
- **Prep (offline, once)**
  - Trim, add fades and slice the flaps. Crossfade-loop the beds.
  - Downmix the 4-channel BlueDelta files. Confirm the TRP "ms" files are decoded L/R.
  - Loudness-normalise every file to one target so the `MIX` constants keep their meaning.
  - Write the game files to `public/audio/{thunder,wind,flap,rain}/`.
- **Format**
  - AAC (`.m4a`) decodes in every current browser.
  - Opus is smaller, but [caniuse](https://caniuse.com/opus) lists Safari macOS as partial.
  - FLAC works everywhere ([caniuse](https://caniuse.com/flac)) but is about four times larger.
  - MP3 and AAC pad the start and end of a file. For loops, either set `loopStart` / `loopEnd` on the source node to the
    prepared loop points, or ship the loops as FLAC.
- **Size and memory**
  - About 4 minutes of material in total (a 60 s rush bed, a 30 s ear-buffet bed, a 60 s rain bed, about six 12 s
    thunders, about 15 flap hits) is about 4 MB as 128 kbps AAC.
  - Decoded `AudioBuffer`s are 32-bit float, about 375 KB per second of 48 kHz stereo, so 4 minutes is about 90 MB.
  - To keep memory down: loops of 60 s at most (30 s where the loop stays hidden), mono flaps, and decode the thunder when
    a storm starts.
- **Loading**
  - Fetch and `decodeAudioData` in `AudioAssetLoader.load` (`src/audio/assets.ts`), next to the noise bank, so the
    buffers are ready when audio unlocks. Decoding resamples 44.1 / 96 kHz files to the context rate.
  - Keep today's synthesis as the fallback while loading or when a fetch fails.
- **Wiring** (replace or layer, per topic)
  - *Wind:* the recorded rush replaces the noise-bank loops in the body and hiss layers of `WindVoice`. `loopSource`
    already randomises the start offset, and `WindVoice` already drifts those loops' playback rates with the gusts. The
    ear buffet replaces the rumble/buffet layer. Bank, whistle, flutter, skim and cloth stay procedural.
  - *Rain:* the recording becomes the wash, taking L/R from the file instead of two decorrelated pink loops. Patter stays
    procedural.
  - *Thunder:* `playThunder` picks a close or distant sample by `strength`, at random among the variations, at ±5 %
    playback rate. It keeps the placement cutoff and reverb for distance, and the synthesized sub swell for near
    strikes.
  - *Flaps:* `playFlap` plays a random hit, at a playback rate from wingspan and strength (0.6–0.9), panned per wing with
    the existing offset. It keeps the synthesized thump and `duckWind`.
- **Fallback:** if the wind bed still falls short after a listening pass, the next source is the Sonniss GameAudioGDC
  bundles. Their FAQ ([sonniss.com/gameaudiogdc](https://sonniss.com/gameaudiogdc), read 2026-09-24) says they are
  royalty-free for commercial use with no attribution. They may not be redistributed "as standalone files or in sound
  effect libraries", and AI/ML training is prohibited. Such files would live in `private-assets/`, like MetaHuman.
