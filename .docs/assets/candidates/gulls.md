# Gull call candidates (decided)

## Decision (2026-09-24)

The user approved all four recommended recordings (all CC0 1.0, Freesound) and asked for noise reduction, because
they carry background ambience:

- **Calls:** felix.blume 167129 (Adalar), bruno.auzet 690332 (harbour town) and genghisattenborough 744592 (herring
  gull long call).
- **Bed:** etienne.leplumey 450529 (distant gulls in a quiet street at dawn).

Integration:

- `node scripts/data/fetch-assets.mjs --kind=sound` caches the HQ previews in `assets-src/sound/<id>/`.
- `scripts/audio/prep-sounds.mjs` high-passes each recording (300 Hz for calls, 250 Hz for the bed), denoises it with
  sox `noisered` (profile from a quiet second of the same recording; the harbour recording's floor drops by about
  15 dB) and keeps only the call phrases: 19 phrases found by envelope analysis (13 harbour, 3 Adalar, 3 herring gull)
  in `public/audio/gull/calls.m4a`, and a 45 s crossfaded loop in `public/audio/gull/bed.m4a`.
- In game (`src/audio/voices/ambience.ts`): gulls are a moment, not a bed. Near the water each 700 m square of the map
  plays at most 3 calls per session (25–160 m away, each cut to 1.8 s), and its quiet distant-gull bed fades out as
  they are used up, so a stretch of shore hears gulls on the first pass and then stays quiet (user request). Loaded as
  the `coast` sample group only near the water. No synthesized fallback: while the recordings load or if they fail,
  there are no gulls.

Records: manifest [`tools/assets/approved.json`](../../../tools/assets/approved.json), licences
[`public/audio/LICENSES.md`](../../../public/audio/LICENSES.md).

---

Status before the decision: shortlist only. No sound was downloaded, added to `assets-src/`,
`private-assets/` or `public/`, or referenced in code. The only files fetched were each sound page's own waveform and
spectrogram images (and HEAD requests on the recommended previews). Checked live on 2026-09-24.

Need (player feedback): the synthesized gull calls (`playGull` in `src/audio/sfx/ambient.ts`, spawned near the coast
and over water by `AmbienceVoice` in `src/audio/voices/ambience.ts`) were "very disturbing" and are off
(`GULL_CALLS = false`). They should come back as recorded CC0 calls: occasional, distant to mid-distance gulls over the
Bosphorus and the Golden Horn, calm rather than shrill close-up screams.

1. **Calls**: single calls or short series at distance or mid-distance that can be sliced into a round-robin of about
   10–20 one-shots. Dry-ish, with little traffic, voices, wind or surf.
2. **Colony bed (optional)**: a soft "gulls at a distance" harbour bed for the waterfront, loopable.

Istanbul's gulls are mostly yellow-legged gulls (*Larus michahellis*), plus black-headed and herring-type gulls.
Mediterranean and Istanbul recordings are preferred; herring gull recordings are an acceptable substitute.

## Read this first

- **Every candidate is CC0**, verified on its own Freesound page. CC0 needs no attribution and allows redistribution, so
  none of them needs `private-assets/`.
- **There is a real Istanbul gull recording.** felix.blume recorded gulls on the top of the Princes' Islands (Adalar) in
  June 2012 with a Schoeps M/S pair on a Sound Devices 744T, uploaded as 24-bit WAV. The islands have no car traffic,
  so the background is quiet. These are the species and the place the game shows.
- **No clean CC0 yellow-legged gull one-shot exists.** Freesound has no CC0 upload tagged "yellow-legged gull" or
  "Larus michahellis" (both searches return 0), and the "isolated single call" uploads are either processed or of
  doubtful origin (see [Also considered](#also-considered)). The one-shots will be sliced from field recordings.
- **Distance is best done in the game.** The quiet, mid-distance recordings below are the raw material; the existing
  `placeAmbient` distance low-pass, level and reverb push them further out. That is calmer than using recordings made
  far away, which bring their own traffic and surf.
- **I did not listen to anything.** Every "sounds like" line comes from the page text and tags plus my reading of the
  Freesound waveform and spectrogram. Listening on the Freesound pages is the approval step.

## How this list was built

- **Sources**
  - Freesound, with the "Creative Commons 0" licence filter: 59 searches (seagull / gull / seagulls / gulls, up to 27
    result pages each; yellow-legged gull, Larus michahellis, michahellis, Larus cachinnans, herring gull, Larus
    argentatus, black-headed gull, Larus; harbour / harbor / port gulls, gull colony, gull flock, seagull call / cry /
    single / laugh / long call / rooftop, distant gulls; the words for gull in Turkish, Spanish, Italian, French,
    Portuguese, German, Dutch, Danish and Finnish; Istanbul, Bosphorus, Golden Horn, Kadıköy, Üsküdar, Beşiktaş,
    Eminönü, Karaköy, Adalar, Büyükada, Princes Island, İzmir, Marmara, Turkey; Mediterranean ports: Marseille, Genova,
    Naples, Piraeus, Athens, Split, Dubrovnik, Venice, Barcelona, Valencia, Málaga, Lisbon, Porto, Cyprus). 847 unique
    results were collected, 360 of which mention gulls. 72 sound pages were read and about 70 waveforms and spectrograms
    inspected.
  - xeno-canto was not used: its recordings are mostly CC BY-NC-SA, which the project rules out.
- **Licence rule** (CLAUDE.md, "External assets"): free with a clear licence, CC0 preferred. I searched with the CC0
  filter only, so no CC-BY candidates appear. I skipped uploads whose CC0 rests on a doubtful claim (a call "isolated
  from a longer free sound downloaded from the internet") or whose description adds its own licence terms.
- **Licence check.** Each shortlisted page's licence box reads "Creative Commons 0" and links to
  `http://creativecommons.org/publicdomain/zero/1.0/`. I also scanned the descriptions for requests that conflict with
  it; none of the shortlisted pages has one (felix.blume and vhio only ask for a rating or a comment).
- **Technical data** (type, duration, file size, sample rate, bit depth, channels) is copied from each page's info
  block. "Size" is the original upload. "Popularity" is the page's downloads and average rating (number of ratings).
  "HQ preview" is the size of the public OGG preview the pipeline would fetch (HEAD `Content-Length`).
- **Previews** are saved under `.shots/assets/gulls/<need>-<n>.png`, built the same way as the earlier sound shortlist:
  - top: the page's own waveform, drawn at absolute scale, with red guide lines at full scale. A flat top against a red
    line means likely clipping.
  - bottom: the page's own spectrogram, on a log frequency axis from about 100 Hz to 22 kHz, with 1 kHz and 10 kHz
    guides and time ticks. Gull calls show as stacked harmonic "chevrons": the herring and yellow-legged gull long call
    has its fundamental near 0.7–1 kHz.

---

## 1. Calls (one-shot round-robin)

| # | Name | Author | Source | Licence (page) | Duration | Format | Size | Popularity | HQ preview | Preview |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Seagulls on the top of Princes Island (Turkey) | felix.blume | [Freesound 167129](https://freesound.org/people/felix.blume/sounds/167129/) | CC0 | 1:32.2 | WAV, 48 kHz, 24-bit, stereo (M/S decoded to L/R) | 25.3 MB | 1,030 dl, 4.8 (23) | [OGG, 2.1 MB](https://cdn.freesound.org/previews/167/167129_1661766-hq.ogg) | [calls-1.png](../../../.shots/assets/gulls/calls-1.png) |
| 2 | seagulls in town.wav | bruno.auzet | [Freesound 690332](https://freesound.org/people/bruno.auzet/sounds/690332/) | CC0 | 5:51.3 | WAV, 96 kHz, 32-bit, stereo | 257.3 MB | 782 dl, 4.8 (26) | [OGG, 8.7 MB](https://cdn.freesound.org/previews/690/690332_11519060-hq.ogg) | [calls-2.png](../../../.shots/assets/gulls/calls-2.png) |
| 3 | Herring Gull passing over roof | genghisattenborough | [Freesound 744592](https://freesound.org/people/genghisattenborough/sounds/744592/) | CC0 | 0:13.5 | WAV, 44.1 kHz, 24-bit, stereo | 3.4 MB | 109 dl, 4.7 (10) | [OGG, 0.3 MB](https://cdn.freesound.org/previews/744/744592_205108-hq.ogg) | [calls-3.png](../../../.shots/assets/gulls/calls-3.png) |
| 4 | Sines_Recreational Port_Seaguls_Andre Fonseca_Sonotomia.wav | Sonotomia | [Freesound 571033](https://freesound.org/people/Sonotomia/sounds/571033/) | CC0 | 0:19.4 | WAV, 48 kHz, 24-bit, stereo | 5.3 MB | 3,210 dl, 4.7 (51) | [OGG, 0.4 MB](https://cdn.freesound.org/previews/571/571033_12425327-hq.ogg) | [calls-4.png](../../../.shots/assets/gulls/calls-4.png) |

| # | Sounds like | Use in Seventeen Skies | Caveats |
|---|---|---|---|
| 1 | Gulls calling over the Princes' Islands, in Istanbul itself: long calls and "kyow" notes with harmonic stacks at 0.6–3 kHz. Busy swells at 0–35 s and 50–72 s, quieter passages at 35–50 s and after 1:12. The background below 500 Hz is low and even (no cars on the islands). | Main source: slice 10–15 calls and short series from the clearest passages (single birds where they stand out), for mid-distance calls near the coast and the islands. | Peaks at about 0.95 of full scale near 1:07; listen for clipping there and skip that call if needed. Tagged "crow, crowing", so a rooster may be audible; slice around it. Several birds often overlap in the busy swells. |
| 2 | Gulls in a Breton harbour town at evening, "some close to us, other faraway" (EM172 AB pair, Zoom F3). Sporadic clusters of long calls and single notes (fundamental about 0.6–1.2 kHz) at 0:05–0:50, 1:05, 2:20, 3:15–3:40, 4:40 and 5:15–5:40, over a very quiet background. | Second source, for variety: gives both near and far calls, so the round-robin gets natural distance differences. About 8–10 usable one-shots. | Two car passes (about 1:25–1:35 and 3:00–3:15) and one sharp impulse near 1:13 (peak 0.69), plus a moped and faraway voices according to the page: cut around them. Likely herring gulls (Brittany), not yellow-legged. |
| 3 | One herring gull's full long call as it passes over a rooftop at night: two lead-in notes, then about 12 clean "kyow" notes at 0.8–2.5 kHz. Very quiet background, peaks at 0.62. Recorded during a nocturnal flight-call session. | A clean, complete long call, the gull sound most players know. Use whole (about 11 s) or split into 2–3 phrases, pitched ±5 %, pushed far with the distance filter. | One bird and one call, so on its own it gives only 2–3 variations. Recorded close, so it must never play unfiltered. |
| 4 | A flock at the recreational port of Sines (Portugal, yellow-legged gull range), recorded for the Sonotomia library: many short laughing calls at 0.8–3 kHz for the whole 19 s. Quiet (peaks at 0.14), already high-passed (nothing below about 150 Hz). | Mediterranean-species alternative: slice 5–8 short calls, or use short 2–4 s chunks as "a few gulls" events. | Dense: calls overlap, so clean single calls are few. Needs about +15 dB of gain. |

### Also considered

- **Close but flawed:**
  - Lydmakeren [510917](https://freesound.org/people/Lydmakeren/sounds/510917/) *Seagulls_short* (Norway, 24-bit,
    8,457 dl, 4.6): one clean herring gull long call at 3–9.5 s; a good alternative to #3. Its sister
    [510912](https://freesound.org/people/Lydmakeren/sounds/510912/) (Lofoten, 1:11) has one more long call at 18–24 s
    and faint distant calls.
  - OleSouWester [434779](https://freesound.org/people/OleSouWester/sounds/434779/) *URBAN SEAGULLS* (Plymouth,
    96 kHz / 24-bit): clear calls at 20–25 s, but background traffic under the whole file.
  - sinewave1kHz [202996](https://freesound.org/people/sinewave1kHz/sounds/202996/) *Seagulls* (Croatia, Adriatic,
    24-bit mono, 5.0 from 36): ten begging gulls on a calm sea; a few isolated calls at 10–25 s, then one repetitive
    begging call for a minute.
  - AlienXXX 798340 (UK, 16-bit, noise-reduced, with a low rumble), speakingmusic 586831 (Pacific, 16-bit, gaps look
    gated), svenne2000 507380 (Kiel, 16-bit, overlapping calls) and TRP 616621 (Aarhus, a noisy long call).
- **Rejected, close-up or harsh:** squashy555 353416 (the most downloaded CC0 gull, but an MP3 original of one bird on a
  beach), Snapper4298 166703 / 166707 / 166709 (camera audio, one at 11 kHz), Canardo55 538016 / 538015 (a tame gull
  at arm's length, silenced gaps), kyles 637813 (peaks at full scale), Vurca 318092 (a gull "very close"),
  Fania_Katz 848876 (an angry gull, low-bitrate M4A), mycompasstv 738675 (a repeated mew call with an airplane).
- **Rejected, processed or doubtful origin:** steaq 263786 *Seagull single call* (isolated "from a longer free sound
  downloaded from the internet", so its CC0 is doubtful), nigelcoop 73497 and 75195 (background "stripped out", with
  gating artefacts), Kinoton 468080 (denoised, and its description adds "By using this sound you agree to a license
  agreement"), SoundsExciting 543900 (*Cawing Seagull (Fake)*), Snapper4298 166704 / 166710 (echo effects),
  JohnLaVine333 399391 (slowed down).
- **Rejected, too much wind, surf or traffic:** Sandy-Ogilvie 818829 (strong wind), SiriusParsec 532092 (wind),
  GirlWithSoundRecorder 493253 and 414672 (surf), henner1964 699979 (MP3 original, wind), yiorgis 835075 (Chalkis,
  Greece: traffic dominates), kyles 451037 (Marseille port: traffic), richwise 806018 (ship noise), bruno.auzet 829207
  and 785882 (water), Further_Roman 208074 (very loud harbour noise).

**Recommendation:** felix.blume 167129 as the main source (the actual place and species, 24-bit, quiet island
background) plus bruno.auzet 690332 for more calls and natural distance differences. Together they should give 15–20
one-shots. Add genghisattenborough 744592 if one clean, complete long call is wanted.

## 2. Colony bed (optional)

| # | Name | Author | Source | Licence (page) | Duration | Format | Size | Popularity | HQ preview | Preview |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Seagulls in a quiet street, 6AM, Harbour City | etienne.leplumey | [Freesound 450529](https://freesound.org/people/etienne.leplumey/sounds/450529/) | CC0 | 4:15.5 | WAV, 48 kHz, 24-bit, stereo | 70.5 MB | 1,693 dl, 4.7 (40) | [OGG, 5.6 MB](https://cdn.freesound.org/previews/450/450529_997174-hq.ogg) | [bed-1.png](../../../.shots/assets/gulls/bed-1.png) |
| 2 | Seagulls / gaviotas clean wildtrack.WAV | Soojay | [Freesound 462462](https://freesound.org/people/Soojay/sounds/462462/) | CC0 | 1:16.4 | WAV, 48 kHz, 24-bit, stereo | 21.0 MB | 11,851 dl, 4.7 (133) | [OGG, 1.7 MB](https://cdn.freesound.org/previews/462/462462_2752236-hq.ogg) | [bed-2.png](../../../.shots/assets/gulls/bed-2.png) |
| 3 | BIRDSea Rooftop seagull cacophony in a courtyard, Karlskrona | vhio | [Freesound 795967](https://freesound.org/people/vhio/sounds/795967/) | CC0 | 3:50.8 | WAV, 96 kHz, 24-bit, stereo | 126.8 MB | 220 dl, 4.8 (11) | [OGG, 5.6 MB](https://cdn.freesound.org/previews/795/795967_15774433-hq.ogg) | [bed-3.png](../../../.shots/assets/gulls/bed-3.png) |
| 4 | Seagulls screaming in Istanbul (Turkey) | felix.blume | [Freesound 167374](https://freesound.org/people/felix.blume/sounds/167374/) | CC0 | 2:00.9 | WAV, 48 kHz, 24-bit, stereo (M/S decoded to L/R) | 33.2 MB | 3,079 dl, 4.6 (56) | [OGG, 2.5 MB](https://cdn.freesound.org/previews/167/167374_1661766-hq.ogg) | [bed-4.png](../../../.shots/assets/gulls/bed-4.png) |

| # | Sounds like | Use in Seventeen Skies | Caveats |
|---|---|---|---|
| 1 | Gulls calling from the rooftops of Cherbourg's harbour quarter at 6 AM in July: a steady scatter of calls at 0.8–3 kHz, none of them dominant, over a very quiet street (almost nothing below 500 Hz). Peaks at 0.28. | Waterfront bed: crossfade-loop about 60 s from the evenest stretch (for example 2:30–3:30), faded in with `coast` near the shore and the harbours. Calls on top come from the round-robin. | Herring gulls (Normandy), not yellow-legged. Early-morning character. Check for footsteps or doors in the chosen stretch. |
| 2 | "Clean recording of a bunch of seagulls": continuous chatter of many birds at 1–3 kHz for 0–55 s, then thinning out. Low noise floor. The most popular CC0 gull bed (11,851 dl). | Denser, closer flock: a loop from 5–50 s, low-passed and quieter for "the gulls around the pier" at Eminönü and Karaköy. | Location not stated ("gaviotas" suggests Spain). The chatter is dense, so it can read as close; keep it well down in the mix. Only about 45 s of even material. |
| 3 | Many gulls calling from different rooftops around a courtyard, with a natural echo. Distant to mid-distance, quiet (peaks at 0.14), most energy at 0.7–2 kHz. | Alternative distant bed with a city-echo character, which suits the Golden Horn's hills. Loop about 60 s. | The author mentions an air-conditioning unit, a few vehicles and some wind. Sweden (herring gulls). Needs about +15 dB of gain. |
| 4 | Gulls calling non-stop over the Şişli district, with dense city traffic under them (strong energy below 500 Hz). | The authentic Istanbul colour: high-pass at 400–600 Hz so only the gulls remain, then use it as a far, low-level layer. | The traffic doubles the game's own traffic ambience, and a high-pass will not remove all of it. Best as a reference for how Istanbul's gulls sound. |

### Also considered

- **Usable alternatives:** kyles [453768](https://freesound.org/people/kyles/sounds/453768/) *birds seagulls large group
  marina* (16-bit FLAC, 4:26, a steady dense colony but with high-pitched calls, likely smaller gulls; source location
  not stated), bruno.auzet 690332 (the calls pick #2, which also works as a sparse bed), TRP
  [574388](https://freesound.org/people/TRP/sounds/574388/) *Seagulls distant urban St John* (24-bit FLAC, distant, but
  a steady urban noise floor), and Ambientsoundapp 536346 / 537853 (small high-pitched gulls over broadband noise).
- **Rejected, not gulls first:** selcukartut 546565 and 546302 (İzmir, Karaburun: a lovely quiet seaside, but the gulls
  are barely visible under the waves), nicotep 813720 / 813722 (Rome rooftop, 16-bit: swifts and parakeets dominate),
  saorenjoyer 688228 (Venice at night: a drone), pblzr 770761 (Almada: church bells), AlperShal 592542 (Istanbul: 20
  minutes of rainy street, 16-bit, few gulls), fielastro 250508 (a Kadıköy ferry deck, 16-bit, 17 minutes, engine and
  people), suukadi 410323 (Sarıyer, Istanbul: MP3 original with strong surf).
- **Rejected, noise:** Ambientsoundapp 537854 *Seagulls distant* (broadband surf covers the gulls), rthijs 864817 /
  864818 (pier and surf), ivolipa 328807 / 328808 (harbour engines), joakgust 425970 (city and building site).

**Recommendation:** etienne.leplumey 450529 as the bed: it is the only long, 24-bit recording where many gulls call at a
distance over near silence, which is what "calm" needs. Soojay 462462 is the denser alternative.

---

## Recommendation

| Need | Pick | Licence | HQ preview | Why |
|---|---|---|---|---|
| Calls | felix.blume [167129](https://freesound.org/people/felix.blume/sounds/167129/) + bruno.auzet [690332](https://freesound.org/people/bruno.auzet/sounds/690332/) | CC0 | 2.1 + 8.7 MB | Istanbul's own gulls over a quiet island, plus a quiet harbour town with near and far calls: 15–20 one-shots. |
| Calls, optional | genghisattenborough [744592](https://freesound.org/people/genghisattenborough/sounds/744592/) | CC0 | 0.3 MB | One clean, complete long call. |
| Colony bed (optional) | etienne.leplumey [450529](https://freesound.org/people/etienne.leplumey/sounds/450529/) | CC0 | 5.6 MB | Distant gulls over a silent street, 4 minutes to choose a loop from. |

The recommended set is three previews, **16.4 MB** in total (16.7 MB with the optional long call). All four HQ preview
URLs were checked with a HEAD request on 2026-09-24 and return HTTP 200.

## Integration notes

- **Licence and attribution:** everything shortlisted is CC0, so no attribution is required and the encoded game files
  may sit in `public/audio/`. The approved sounds are recorded in `public/audio/LICENSES.md` by the prep script.
- **Manifest:** each approved sound goes into `tools/assets/approved.json` like the earlier sounds: `source:
  "freesound"`, `kind: "sound"`, `licence: "CC0-1.0"`, `resolution: "hq-preview"`, `download: "api"`,
  `shortlist: ".docs/assets/candidates/gulls.md"` and `download_url` set to the page's public HQ OGG preview
  (`https://cdn.freesound.org/previews/<id/1000>/<id>_<userId>-hq.ogg`):
  - 167129: `https://cdn.freesound.org/previews/167/167129_1661766-hq.ogg`
  - 690332: `https://cdn.freesound.org/previews/690/690332_11519060-hq.ogg`
  - 744592 (optional): `https://cdn.freesound.org/previews/744/744592_205108-hq.ogg`
  - 450529 (bed): `https://cdn.freesound.org/previews/450/450529_997174-hq.ogg`
- **Fetch:** `node scripts/data/fetch-assets.mjs --kind=sound` caches them in `assets-src/sound/<id>/`.
- **Prep:** `scripts/audio/prep-sounds.mjs` gets two new recipes.
  - A `gull/calls` sprite (mono is enough, since the calls are placed in the game): 15–20 slots found by envelope
    analysis, as for the flaps. High-pass at about 300 Hz to drop surf, wind and traffic rumble, 10–20 ms fades, and
    `level: 'match'` so no call jumps out.
  - An optional `gull/bed` loop from 450529 (for example start 150 s, length 50 s, crossfade 4 s), high-passed at about
    200 Hz.
- **Loading:** a new `SampleGroup` (for example `'coast'`) in `src/audio/samples.ts`, requested the first time the
  player is near the coast or over water, so the gull buffers never delay the flight sounds.
- **Wiring:** `spawnGull` in `src/audio/voices/ambience.ts` plays a random sprite slot, never the same one twice in a
  row, at ±4 % playback rate, through the existing `placeAmbient(h, height, bearing, …)` placement: its 25–160 m
  distance, low-pass and reverb make the calls distant. It falls back to silence rather than to `playGull` while the
  group loads or if it fails, since the synthesized call is what players disliked. Then set `GULL_CALLS = true` again
  and re-tune the call rate (today about one call per 6.5 s at full coast weight; recorded calls may want it slower)
  and the level, so the calls stay occasional.
- **Size and memory:** 15–20 one-shots of about 1–3 s each is about 40 s of mono audio, about 0.5 MB as 96 kbps AAC and
  about 8 MB decoded. A 50 s stereo bed adds about 1 MB of AAC and 19 MB decoded.
