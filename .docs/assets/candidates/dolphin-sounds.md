# Dolphin sound candidates (rejected)

**Owner decision (26 Sep): all rejected.** The recordings are too noisy to use, and the whistles (the dolphins' own
underwater communication) are unpleasant to hear. The dolphins stay without calls; above water they are heard only
through the existing water splash on leaps. Do not add whistles or clicks. A clean breath "pff" may be revisited later
only from a clean studio-quality source.

Former status: **shortlist only, awaiting the owner's approval.** No recording was added to `assets-src/`, `private-assets/`
or `public/`, and nothing references them in code. The game already has the slots they drop into (see
[Integration notes](#integration-notes)); until then the dolphins are silent except for the existing generic water
splash on a leap. Checked live on 2026-09-26.

Need (phase 13 natural phenomena, `src/world/life/dolphins/`): the owner wants **real dolphin recordings, not
synthesized sounds**. Pods of short-beaked common dolphins (*Delphinus delphis*, the Bosphorus' usual species) and now
and then bottlenose dolphins (*Tursiops truncatus*) surface and leap in the strait.

1. **Whistles and clicks**: short whistle / click phrases, heard faintly above the water (the game lowers them a lot and
   plays them clearly only for a camera under water). A round-robin of about 8–15 one-shots of 1–3.5 s.
2. **Surfacing breath**: the short explosive "pff" of the blow as a dolphin breaks the surface, heard from a boat. A few
   one-shots of 0.3–1.2 s.
3. **Leap splash** (optional): a body re-entering the water after a leap, only if a recording beats the existing
   synthesized water splash (`playSplash`).

## Read this first

- **The best whistle source is public domain and the exact species.** NOAA Fisheries (Northeast Fisheries Science
  Center, Passive Acoustics Branch) publishes example clips of marine mammals, including a 23 s chorus of
  **short-beaked common dolphin whistles** and a bottlenose dolphin clip. Works of the US federal government are not
  under copyright in the US, and the NOAA Fisheries website policy says its information "may be distributed or copied,
  unless specifically noted otherwise", asking for a courtesy credit. The page gives a citation format; we should credit
  it in `public/audio/LICENSES.md` even though it is not legally required. Outside the US the public-domain status of
  US government works is not guaranteed everywhere; NOAA asks for credit, not permission.
- **Breaths are the hard part.** No CC0 upload on Freesound is a clean isolated dolphin blow. The only real one is the
  first ~36 s of geraldfiebig 385796 (wild Atlantic spotted dolphins recorded from a whale-watching boat: the page says
  "you can hear the dolphins breathing"); the breaths would be sliced from that part. The waveform shows about six
  short broadband bursts there over boat and sea noise.
- **Splashes:** no CC0 recording of a real dolphin leap exists on Freesound. The candidates are fish jumps and a person
  jumping into a harbour. The existing synthesized splash is probably as good at the distances dolphins are heard
  from; the splash is marked optional.
- **I did not listen to anything.** Every "sounds like" line comes from the page text and tags plus my reading of the
  waveform and spectrogram images. Listening on the source pages is the approval step.

## How this list was built

- **Freesound**, with the "Creative Commons 0" licence filter: dolphin, dolphins, dolphin whistle, dolphin breath,
  dolphin breathing, dolphin blow, dolphin jump, dolphin splash, dolphin click, dolphin boat, dolphins sea, dolphin
  watching, porpoise, cetacean, bottlenose, tursiops, delphinus, stenella, common dolphin, hydrophone dolphin, blowhole,
  whale blow, orca, fish jump splash, splash dive sea, body splash water, jump into sea. 18 unique dolphin-related
  results; 13 sound pages read. The Freesound API needs a key (401), so pages were read directly.
- **NOAA Fisheries** "Sounds in the Ocean: Mammals" page
  (<https://www.fisheries.noaa.gov/national/science-data/sounds-ocean-mammals>): the dolphin clips' MP3 files were
  fetched to a scratch folder (not the repository) only to measure duration and format, and deleted afterwards.
- **Wikimedia Commons** (API search `dolphin filetype:audio` and variants): 23 hits, mostly pronunciations and spoken
  articles; the one real recording is a copy of felix.blume 161691 (below). Several Commons searches were rate-limited.
- **Not reachable / not used:** DOSITS (dosits.org) answers 403 through this network; NOAA NCEI SanctSound data are
  hour-long raw hydrophone files, not clips; xeno-canto and most "free SFX" sites (Pixabay, Uppbeat, freesoundslibrary)
  have their own licences that do not meet the CC0 / CC-BY rule or are unclear about the original recordist.
- **Licence check:** each Freesound pick's licence box reads "Creative Commons 0" and links to
  `http://creativecommons.org/publicdomain/zero/1.0/`; the descriptions add no conflicting terms.
- **Previews** (the sources' own images) are saved under `.shots/assets/dolphin-sounds/`: Freesound's waveform
  (`*-wave.png`) and spectrogram (`*-spec.jpg`) for each Freesound candidate, and NOAA's own spectrogram
  (`noaa-*-spec.png`, 0–24 kHz, linear axis) for the NOAA clips.

---

## 1. Whistles and clicks

| # | Name | Author | Source | Licence | Duration | Format | Size | HQ file | Preview |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Short-beaked common dolphin, whistles (Dede_whistles_NOAA_PAGroup_01) | NOAA NEFSC Passive Acoustics Branch | [NOAA Fisheries](https://www.fisheries.noaa.gov/national/science-data/sounds-ocean-mammals) · [MP3](https://www.fisheries.noaa.gov/s3/2023-04/Dede-whistles-NOAA-PAGroup-01-short-beaked-common-dolphin-clip.mp3) | US public domain (courtesy credit requested) | 0:23.4 | MP3, 48 kHz, mono, VBR ~250 kbps | 0.72 MB | same file | [noaa-common-dolphin-whistles-spec.png](../../../.shots/assets/dolphin-sounds/noaa-common-dolphin-whistles-spec.png) |
| 2 | Bottlenose dolphin, whistles, clicks and pulses (Tutr_multisound_NOAA_PAGroup_03) | NOAA NEFSC Passive Acoustics Branch | [NOAA Fisheries](https://www.fisheries.noaa.gov/national/science-data/sounds-ocean-mammals) · [MP3](https://www.fisheries.noaa.gov/s3/2023-04/Tutr-multisound-NOAA-PAGroup-03-bottlenose-dolphin-clip.mp3) | US public domain (courtesy credit requested) | 0:05.6 | MP3, 48 kHz, mono, VBR | 0.11 MB | same file | [noaa-bottlenose-multisound-spec.png](../../../.shots/assets/dolphin-sounds/noaa-bottlenose-multisound-spec.png) |
| 3 | Dolphin screaming underwater in Caribbean Sea (Mexico) | felix.blume | [Freesound 161691](https://freesound.org/people/felix.blume/sounds/161691/) | CC0 | 0:44.0 | WAV, 48 kHz, 24-bit, mono | 6.0 MB | [OGG, 0.68 MB](https://cdn.freesound.org/previews/161/161691_1661766-hq.ogg) | [spec](../../../.shots/assets/dolphin-sounds/felixblume-161691-dolphins-caribbean-spec.jpg) · [wave](../../../.shots/assets/dolphin-sounds/felixblume-161691-dolphins-caribbean-wave.png) |
| 4 | Atlantic Spotted Dolphins off the coast of La Gomera, Canary Islands (hydrophone part) | geraldfiebig | [Freesound 385796](https://freesound.org/people/geraldfiebig/sounds/385796/) | CC0 | 3:00.1 | WAV, 44.1 kHz, 16-bit, stereo | 30.3 MB | [OGG, 4.65 MB](https://cdn.freesound.org/previews/385/385796_4438201-hq.ogg) | [spec](../../../.shots/assets/dolphin-sounds/geraldfiebig-385796-atlantic-spotted-dolphins-spec.jpg) · [wave](../../../.shots/assets/dolphin-sounds/geraldfiebig-385796-atlantic-spotted-dolphins-wave.png) |

| # | Sounds like | Use in Seventeen Skies | Caveats |
|---|---|---|---|
| 1 | A dense chorus of many common dolphins from a passive acoustic recorder: rising, falling and U-shaped whistle contours at 5–20 kHz throughout, over low sea noise below ~3 kHz. | **Main source.** The Bosphorus' own species. Slice 8–12 phrases of 1–3 s from the clearest passages (e.g. around 4–6 s, 11–13 s, 18–21 s), high-pass at ~3 kHz to drop the recorder's sea noise. | Whistles overlap (a chorus, not single animals), so single clean whistles are few; fine for "a pod". Recorded under water: above water the game plays it far down anyway. Public domain rather than CC0: record the NOAA credit. |
| 2 | Bottlenose whistles with click trains and burst pulses (a "rusty hinge" buzz), short. | Variety for bottlenose pods (tint ≥ 0.5): 2–3 one-shots with clicks. | Only 5.6 s of material. Same credit as #1. |
| 3 | Dolphins calling and whistling close to a boat off Punta Allen, recorded with an Aquarian H2a hydrophone and a Sound Devices 744T: loud, clear whistles and squeals, 24-bit. The most rated wild dolphin recording on Freesound (133 ratings). | CC0 alternative or complement to #1: clean close whistles, easy to slice into 6–10 one-shots. | Species not stated (Caribbean: likely bottlenose or spotted dolphins). "Screaming" in the title: some calls are loud; keep them well down. Some boat noise from the recording boat. |
| 4 | After the first ~36 s (above water, see need 2) the recordist switched to a hydrophone: a large group of wild spotted dolphins whistling and clicking, with a steady tonal band near 5 kHz (probably the boat) under it for the rest of the recording. | Second CC0 option for whistles; mainly shortlisted for its breaths (need 2), so one download serves both. | The steady tone runs through the hydrophone part and needs a notch filter. 16-bit. |

### Also considered

- **Rejected, not wild dolphins or not dolphins:** sabine.rains 472511 *Dolphins_01* (a show in a Cancún aquarium with
  an audience), Forpus_Prod 391317 *Dolphin.wav* ("human-made dolphin sound"), jfournier18 456151 (a friend imitating a
  dolphin), younoise 572318 *Dolphins At Sunset* (a piano piece), Mastersoundboy2005 719754 *Alien Dolphin Clicking*
  (sound design), milton. 244455 *dolphin robotic*, awaka 421602–423903 (unrelated electronic sounds tagged dolphin).
- **Close but flawed:** craigsmith [437947](https://freesound.org/people/craigsmith/sounds/437947/) *G12-15-Dolphins
  Underwater* (CC0, 24.8 s, 24-bit mono: whistling, squealing, burst pulses) is tagged "Vintage, Optical": it is one of a
  series of digitised vintage optical-film sound effects, so the uploader may not be the recordist and the CC0 rests on
  an unclear chain of rights. felix.blume [408555](https://freesound.org/people/felix.blume/sounds/408555/) *Amazonian
  Dolphins* (CC0, 2:48, 96 kHz / 24-bit) is excellent but a river dolphin (boto), whose sounds differ from marine
  dolphins. Wikimedia Commons *Whales and Dolphins … nueva esparta.ogg* mixes whale song in.

**Recommendation:** NOAA #1 (common dolphin whistles) as the main source, plus felix.blume #3 for clean close whistles.
Add NOAA #2 for bottlenose clicks if wanted.

## 2. Surfacing breath ("pff")

| # | Name | Author | Source | Licence | Duration | Format | Size | HQ file | Preview |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Atlantic Spotted Dolphins off the coast of La Gomera, Canary Islands (above-water part, 0–36 s) | geraldfiebig | [Freesound 385796](https://freesound.org/people/geraldfiebig/sounds/385796/) | CC0 | 3:00.1 (≈ 0:36 usable) | WAV, 44.1 kHz, 16-bit, stereo | 30.3 MB | [OGG, 4.65 MB](https://cdn.freesound.org/previews/385/385796_4438201-hq.ogg) | [spec](../../../.shots/assets/dolphin-sounds/geraldfiebig-385796-atlantic-spotted-dolphins-spec.jpg) · [wave](../../../.shots/assets/dolphin-sounds/geraldfiebig-385796-atlantic-spotted-dolphins-wave.png) |
| 2 | Thar'she blows | kaekhor | [Freesound 533985](https://freesound.org/people/kaekhor/sounds/533985/) | CC0 | 0:30.3 | WAV, 48 kHz, 24-bit, stereo | 8.4 MB | not checked | not saved |

| # | Sounds like | Use in Seventeen Skies | Caveats |
|---|---|---|---|
| 1 | Recorded from a whale-watching boat (ZOOM H2) among a large group of wild dolphins: the page says "you can hear the dolphins breathing". The waveform shows about six short broadband bursts in the first 36 s over a steady sea and boat bed. | **Only real candidate.** Slice the 4–6 clearest blows (0.3–0.8 s each), high-pass and denoise with the same sox `noisered` step the gull calls use (profile from a quiet second between blows). | Boat engine and water under the breaths; the denoise step is essential. Atlantic spotted dolphins, a close relative of the common dolphin (similar size and blow). |
| 2 | "A whale comes up for a breath of air and dips back into the ocean": a sound-design piece built from the author's recordings and samples. | Fallback reference only. | Sound design, not a field recording, and a whale-sized blow (much bigger than a dolphin). Not recommended. |

Nothing else found: Freesound has no CC0 "dolphin breath/blow" upload; the blowhole results (Chilsville 591559,
SonoRec 824088, ondrosik 121259 / 183141) are sea blowholes in rock (water forced through a rock hole).

**Recommendation:** geraldfiebig 385796, sliced and denoised. If the breaths turn out too buried, the dolphins stay
without a breath sound (no synthesized fallback, per the owner).

## 3. Leap splash (optional)

| # | Name | Author | Source | Licence | Duration | Format | Size | HQ file | Preview |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Fish Jumping Splash 2.wav | paulprit | [Freesound 507091](https://freesound.org/people/paulprit/sounds/507091/) | CC0 | 0:05.2 | WAV, 48 kHz, 32-bit, stereo | 1.9 MB | [OGG, 0.10 MB](https://cdn.freesound.org/previews/507/507091_8682843-hq.ogg) | [spec](../../../.shots/assets/dolphin-sounds/paulprit-507091-fish-jump-splash-2-spec.jpg) · [wave](../../../.shots/assets/dolphin-sounds/paulprit-507091-fish-jump-splash-2-wave.png) |
| 2 | Fish Jumping Splash 1.wav | paulprit | [Freesound 507092](https://freesound.org/people/paulprit/sounds/507092/) | CC0 | 0:02.4 | WAV, 48 kHz, 32-bit, stereo | 0.9 MB | [OGG, 0.06 MB](https://cdn.freesound.org/previews/507/507092_8682843-hq.ogg) | [spec](../../../.shots/assets/dolphin-sounds/paulprit-507092-fish-jump-splash-1-spec.jpg) · [wave](../../../.shots/assets/dolphin-sounds/paulprit-507092-fish-jump-splash-1-wave.png) |
| 3 | 130723_Brela_HarborJump_R_4824.wav | blaukreuz | [Freesound 195876](https://freesound.org/people/blaukreuz/sounds/195876/) | CC0 | 0:24.1 | WAV, 48 kHz, 24-bit, stereo | 6.6 MB | [OGG, 0.49 MB](https://cdn.freesound.org/previews/195/195876_623488-hq.ogg) | [spec](../../../.shots/assets/dolphin-sounds/blaukreuz-195876-harbour-jump-spec.jpg) · [wave](../../../.shots/assets/dolphin-sounds/blaukreuz-195876-harbour-jump-wave.png) |
| 4 | Foley_Natural_Water_Jump_Mono.wav | Nox_Sound | [Freesound 585744](https://freesound.org/people/Nox_Sound/sounds/585744/) | CC0 | 0:14.5 | WAV, 48 kHz, 24-bit, mono | 2.0 MB | [OGG, 0.16 MB](https://cdn.freesound.org/previews/585/585744_9250976-hq.ogg) | [spec](../../../.shots/assets/dolphin-sounds/noxsound-585744-water-jump-spec.jpg) · [wave](../../../.shots/assets/dolphin-sounds/noxsound-585744-water-jump-wave.png) |

| # | Sounds like | Use in Seventeen Skies | Caveats |
|---|---|---|---|
| 1 | "A fish jumping out of water and then landing back in the water": a small exit splash, then the entry. | Small porpoising / leap entries of common dolphins at a distance. | A fish is smaller than a dolphin; pitch down 10–20 %. |
| 2 | The same, shorter: one clean entry. | Round-robin with #1. | As #1; no ratings yet. |
| 3 | A person jumping off a 3 m stone jetty into a small fishing harbour on a warm evening (Zoom H2, rear channels), crickets and lapping waves around it; the splash is in the middle. | The right body size for a bottlenose leap entry: slice the ~1.5 s splash. | Crickets and waves around the splash; a 3 m jump is heavier than a dolphin's clean entry. |
| 4 | Three jumps into water, close foley (Tascam DR-05), 82 ratings. | Alternative body-size splash, very clean. | A person, close and dry; needs distance processing. |

**Recommendation:** none required. The existing synthesized splash already plays for leap entries; approve paulprit
507091 + 507092 only if, after listening, a recorded splash is wanted for the small dolphin entries.

---

## Recommendation

| Need | Pick | Licence | Size to fetch | Why |
|---|---|---|---|---|
| Whistles | NOAA common dolphin whistles (#1) + felix.blume [161691](https://freesound.org/people/felix.blume/sounds/161691/) | US public domain (credit) + CC0 | 0.72 MB MP3 + 0.68 MB OGG | The Bosphorus' own species as a chorus, plus clean close whistles. |
| Whistles, optional | NOAA bottlenose multisound (#2) | US public domain (credit) | 0.11 MB | Clicks and buzzes for bottlenose pods. |
| Breath | geraldfiebig [385796](https://freesound.org/people/geraldfiebig/sounds/385796/) (0–36 s) | CC0 | 4.65 MB OGG | The only real wild dolphin breaths found; also gives hydrophone whistles. |
| Splash (optional) | paulprit [507091](https://freesound.org/people/paulprit/sounds/507091/) + [507092](https://freesound.org/people/paulprit/sounds/507092/) | CC0 | 0.16 MB | Only if a recording should replace the synthesized splash. |

All listed download URLs were checked on 2026-09-26 (Freesound HQ OGG previews: HEAD, HTTP 200 with the sizes above;
NOAA MP3s: HTTP 200, fetched to a scratch folder to measure them and deleted).

## Integration notes

- **Drop-in slots (already wired, silent until files exist):** `src/audio/samples.ts` has a `dolphin` sample group with
  `dolphin/calls`, `dolphin/breaths` and `dolphin/splashes` sprite entries. Unlike the other groups it is partial: each
  entry is used as soon as it exists in `public/audio/sounds.json`, so the whistles can be approved without the
  breaths. `src/audio/audio-engine.ts` `dolphinCue('whistle' | 'breath' | 'splash', position, volume)` plays a random
  slot positionally (whistles faint above water, clear on the underwater bus when the camera is under water; breaths
  on the ambience bus; a splash without a recording falls back to the generic water splash). The dolphins
  (`src/world/life/dolphins/dolphins.ts`) already call it at every breath, leap splash and every few seconds of a pod
  near the camera.
- **After approval:** add each file to `tools/assets/approved.json` (`kind: "sound"`, `shortlist:
  ".docs/assets/candidates/dolphin-sounds.md"`; Freesound: `licence: "CC0-1.0"`, `resolution: "hq-preview"`,
  `download_url` = the HQ OGG above; NOAA: `source: "noaa"`, `licence: "public-domain-us-gov"`, `download_url` = the
  MP3, `attribution` = the NOAA citation below), fetch with `node scripts/data/fetch-assets.mjs --kind=sound`, then
  extend `scripts/audio/prep-sounds.mjs` with the slice points (found by envelope analysis, like the gull calls), a
  3 kHz high-pass for the hydrophone whistles and the `noisered` denoise for the boat breaths, writing
  `public/audio/dolphin/{calls,breaths,splashes}.m4a` and their `sounds.json` sprite entries. The prep script records
  them in `public/audio/LICENSES.md`.
- **NOAA credit** (their format): "NOAA [National Oceanic and Atmospheric Administration]. Northeast Fisheries Science
  Center. Passive Acoustics Branch. Dede_whistles_NOAA_PAGroup_01 / Tutr_multisound_NOAA_PAGroup_03.
  https://www.fisheries.noaa.gov/national/science-data/sounds-ocean".
