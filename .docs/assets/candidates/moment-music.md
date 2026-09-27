# Moment music: real recordings per moment

Status: **approved on 2026-09-26** (see the decision below): every candidate archived, the first picks integrated.
Researched on 2026-09-26. Companion to [`music.md`](music.md) (the earlier shortlist of modern CC BY taksim
recordings, C1–C19), which stays valid as the modern fallback pool.

Owner's direction (2026-09-26): **public-domain historic 78 rpm records ("taş plak") come first** for every moment.
CC0 / CC BY modern recordings and generated instrumentals are fallbacks only.

## Decision (2026-09-26)

The owner approved, on 2026-09-26:

1. **Archive every candidate recording in its original form, with its source** ("bizde kalsınlar, kaynaklarını da
   koru"). Later work only opens, copies or trims them.
2. **Integrate the first five picks now**, denoised when the restoration is clean, else with their crackle: H1
   *Kâğıthane Semaisi* intro (Nedim, the storks), H2 *Felek Bana* (Karagöz, as a distant gramophone), H8 the Isfahan
   gazel with Tanburi Cemil Bey (De Amicis), H13 Nafpliotis' Apolytikion of St George (Aya Yorgi, only if no modern
   drone was added), H9 *Reşadiye Marşı* (Kuyrukluyıldız).
3. **Also take the US-risky recordings** (free in Turkey, not yet in the US): Safiye Ayla's 1949 *Kâtibim*, the Pathé
   Istanbul discs of 1927–1928 and the others marked that way. The owner accepts the risk and wants full attribution
   and a takedown contact (`<contact-email>`, to be filled in by the owner). They never go to `public/` or git.

What was done (details, sha256 and rights per file: [`archive-78rpm.md`](../archive-78rpm.md)):

- **Archived (38 recordings):** H1–H7 (LoC WAV masters), H13 and both H14 transfers (analogion.com; also committed in
  `data/archive/78rpm/`), all 15 Pathé discs of H15–H22 (both sides each, from Gallica, which was reachable this time
  with a browser-style user agent), the Commons mirror of H15, and the Internet Archive uploads of Safiye Ayla's
  *Kâtibim*, both Hafız Burhan sides and the Darülelhan *Turnalar Turnalar*. Every entry is in
  `tools/assets/approved.json` (kind `recording`) and re-downloads with
  `node scripts/data/fetch-assets.mjs --kind=recording --no-docs`.
- **Listed but not downloaded yet:** the Commons files H8, H9, H10 (both transfers), H11, H12, M1 and M2:
  upload.wikimedia.org and the Commons API answered HTTP 429 to every request for over 90 minutes on 2026-09-26.
  Their entries carry the URLs; the sha256 fills in on the first successful fetch (`--write-sha`).
- **Integrated, public** (`public/audio/music/moments/`, both a denoised and a raw version): `kagithane-semaisi-1916`
  (H1, 0:07.5–1:03.5, default denoised) for Nedim and the storks; `felek-bana-1916` (H2, 0:01–1:56.5, default denoised)
  for Karagöz, whose music source is now a coffeehouse gramophone on Şehzadebaşı Caddesi;
  `aya-yorgi-apolitikiyonu-nafpliotis` (H13, whole, default raw: the transfer is already clean) for Aya Yorgi. **H13
  has no later drone**: no pitch holds longer than 1.5 s under the chant (see the archive doc); confirm by ear.
- **Integrated, private** (`private-assets/audio/moments/`, builds only): `katibim-safiye-ayla-1949` (Kâtibim, raw),
  `huseyni-taksim-hafiz-kemal` (H15 taksim side, Sinan, denoised), `huzzam-taksim-resad-bey` (H18 Hüzzam side, Haşim and
  Kız Kulesi, raw).
- **Waiting for the Commons download:** H8 (De Amicis) and H9 (Kuyrukluyıldız). Their recipes are ready in
  `tools/assets/moment-pieces.json`; once the files arrive, run the fetch, `python3 scripts/audio/prep-moment-music.py
  --id=isfahan-gazeli-cemil-bey,resadiye-marsi-1910`, and set `musicId` on the two moments (they keep the mood choice
  until then).
- **Not found:** Naftule Brandwein's 1924 *Der Terk in America* (no transfer on the Internet Archive).

Status per candidate: H1, H2, H13 taken and integrated; H3–H7, H14 archived; H8–H12 listed (download pending), H8 and
H9 to integrate; H15–H22 archived as US-risky, H15 (taksim) and H18 (Hüzzam taksim) integrated privately; Safiye Ayla
archived and integrated privately; Hafız Burhan and Darülelhan archived (US-risky); M1, M2 listed (download pending).

## Read this first

### Why the YouTube rips were excluded

The idea was to rip the well-known recordings (for example the famous "Kâtibim") from YouTube and credit them. That is
not allowed, for three independent reasons:

1. **Modern recordings are copyrighted.** A singer's 1970s or 2000s recording belongs to the label and the performers
   for decades. Credit or attribution does not grant a licence. Only the rights holder's permission or an open licence
   does.
2. **An old song does not make a recording free.** "Kâtibim" is traditional, so anyone may *perform* it, but every
   *recording* of it has its own rights.
3. **YouTube's terms forbid downloading** outside its own offline feature, whatever the licence of the content.

What remains is (a) recordings old enough to be in the public domain, (b) recordings under an open licence, and
(c) new instrumentals we generate or commission of a public-domain tune.

### The rights test for a historic recording (all three must pass)

| Test | Rule | Why |
|---|---|---|
| **US** | Published **before 1 January 1926** | Music Modernization Act (17 U.S.C. §1401): pre-1972 recordings published 1923–1946 are protected for 100 years from publication, so the 1925 releases entered the US public domain on 1 Jan 2026. The 1926 releases follow on **1 Jan 2027**, 1927 on 1 Jan 2028, 1928 on 1 Jan 2029. |
| **TR** | Published (or fixed) **before 1956** | FSEK related rights of performers and phonogram producers last 70 years. |
| **Composition** | Traditional, or the composer died **before 1956** (life + 70) | A şarkı by a composer alive after 1955 is still protected in Turkey even if the record is free. |

Two traps that the table hides:

- **A taksim or a gazel is an improvisation**, so the *performer* is its author. The performer must have died before
  1956 as well, otherwise the improvised music is protected in Turkey for 70 years after the performer's death. Where a
  performer's death date is unknown, the candidate is flagged.
- **The transfer.** A plain digital transfer of a public-domain disc adds no new right in the US or the EU. A
  restoration that adds material (the Nafpliotis page warns that some tracks had an ison drone overdubbed later) does,
  so only raw transfers qualify. Gallica (BnF) also attaches contract terms to its own files: non-commercial reuse is
  free, commercial reuse needs a BnF licence. That is a contract, not a copyright, but it matters if the game is ever
  sold.

**Rating used below**

| Tier | Meaning |
|---|---|
| **A: clean now** | Passes all three tests today. |
| **B: TR-clean, US soon** | Published 1926–1928: free in Turkey now, free in the US on 1 Jan 2027 / 2028 / 2029. Approve now, ship when the date passes, or accept the small residual US risk. |
| **C: open licence** | Modern recording under CC0 or CC BY (attribution required). |
| **D: fallback** | Generate (Gemini Lyria / Suno) or commission an instrumental of a public-domain tune. |
| **X: not usable** | Fails a test. Listed so that nobody reopens it. |

### What was and was not reachable

| Source | Reached? | Notes |
|---|---|---|
| Library of Congress National Jukebox (loc.gov JSON API, tile.loc.gov) | **Yes** | Metadata and **full WAV masters** (44.1 kHz) downloaded and analysed for 7 Turkish-series Victor records. The items carry the LoC's old Sony/EMI streaming notice, but the notice itself says pre-1923 releases entered the public domain in 2022. |
| Internet Archive (search API, metadata, downloads) | **Yes** | Great 78 Project and user uploads searched. Almost no pre-1926 Turkish material; the Turkish 78s there are 1930s–1940s US ethnic labels (Kaliphon, Metropolitan, Orthophonic) and Sahibinin Sesi. |
| BnF catalogue (SRU API) | **Yes** | Full list of the 102 Turkish Pathé discs of the Archives de la Parole harvested (titles, performers, matrices, dates). |
| Gallica (the audio itself) | **No** (HTTP 403 / connection refused) | The Pathé audio could not be heard; one side (Hüseyni Saz Semaisi) is mirrored on Commons. |
| Wikimedia Commons API (search, categories, file metadata) | **Yes**, rate-limited | Metadata read for every candidate. |
| upload.wikimedia.org (the audio files) | **No** (HTTP 429 on every attempt, spaced up to 60 s) | Commons files could not be downloaded, so their noise and vocal notes come from the file pages, not from analysis. |
| analogion.com (Nafpliotis transfers) | **Yes** | Three MP3s downloaded and analysed. |
| UCSB Cylinder Audio Archive | Yes | No Turkish cylinders (only Western "Turkish Patrol" pieces). |
| UCSB DAHR (adp.library.ucsb.edu), Europeana, Musopen, Discogs | **No** (403) | DAHR's Victor data is mirrored by the Jukebox for the items found. |
| freemusicarchive.org | Yes (pages) | Used to check the Turku album licence. |

**Nothing was listened to by a person.** Timestamps for instrumental passages and noise ratings come from a level and
spectral-centroid analysis of the downloaded files (0.5 s frames; the groove noise is measured in the run-in before the
music). A quiet, bright stretch at the start of a 78 followed by a loud, darker entry is almost always the
instrumental introduction followed by the voice, but **every timestamp must be checked by ear before cutting.**

### How a 78 would sit in the game

The moment types already support a diegetic source: `MomentContent.musicSource` with a world kind such as a
gramophone at a place or on the ferry anchor (`src/moments/types.ts`). A crackly 78 played quietly as a distant
gramophone (a café on the Galata Bridge, a yalı window, the ferry saloon) justifies the surface noise and makes a
sung record easier to accept under subtitles than a "score" would be.

Suggested treatment for every historic file: trim to the passage named below, gentle click removal and a mild
broadband denoise (keep some crackle; the gull recordings got the same treatment), high-pass at 80 Hz, fade in 2 s and
out 4 s, normalise to about −18 LUFS as `.docs/audio/music-system.md` asks.

**Vocals under subtitles, general recommendation:** for the poems and quoted texts (Nedim, Sinan, Fikret, Haşim,
Prokopios, De Amicis, Orhan Veli) use instrumental passages only, or a vocal record at a clearly "far away" gramophone
level. For the folk, city-life and theatre moments (Kâtibim, Karagöz, the anglers, the ferry) a distant sung 78 fits
the scene. Byzantine chant for the two Byzantine moments is a special case: it is sung, but it is a slow, wordless-
sounding texture to Turkish players and works like a church ambience.

## The moments

All ids from `src/moments/data/*.ts`. Legends and city-life records set no `musicMood`, so their mood below is read
from the subtitles.

| # | id | Title | Place | Mood (`musicMood` or inferred) | Category | Status |
|---|---|---|---|---|---|---|
| 1 | `nedim-bu-sehr-i-sitanbul` | Bu Şehr-i Sıtanbûl | High over Sarayburnu, 7–11 h | solemn, history | poem | ready |
| 2 | `sinan-turbe-kitabesi` | Pîr-i Mi'mârân Sinan | Sinan's tomb, Süleymaniye, dusk | solemn, tender, history | poem | draft |
| 3 | `katibim-uskudar-yagmur` | Kâtibim | Üsküdar shore and square, rain | joyful, tender | poem | ready |
| 4 | `ati-alan-uskudari-gecti` | Atı Alan Üsküdar'ı Geçti | Üsküdar crossing | joyful, sea | legend | ready |
| 5 | `karagoz-sehzadebasi` | Perde: Karagöz ile Hacivat | Şehzadebaşı (Direklerarası), 20–24 h | joyful, history | poem | ready |
| 6 | `fikret-yagmur-asiyan` | Yağmur | Aşiyan above Rumelihisarı, rain | nostalgic, tender | poem | ready |
| 7 | `hasim-bir-gunun-sonunda-arzu` | Bir Günün Sonunda Arzu | Bosphorus off the Göksu mouth, sunset | nostalgic, tender, mystic | poem | draft |
| 8 | `huseyin-rahmi-kuyrukluyildiz` | Kuyrukluyıldız | High over Heybeliada, night | joyful, mystic | poem | ready |
| 9 | `prokopios-gokten-asili-kubbe` | Gökten Asılı Kubbe | Around the Hagia Sophia dome | solemn, mystic, history | poem | ready |
| 10 | `de-amicis-sis-kalkinca` | Sis Kalkınca | Marmara approach south of Sarayburnu, morning | solemn, sea, history | poem | ready |
| 11 | `orhan-veli-istanbulu-dinliyorum` | İstanbul'u Dinliyorum | Low glide along the Bosphorus shores | nostalgic, sea | poem | draft |
| 12 | `hezarfen-galata-uskudar` | Hezarfen Ahmed Çelebi | Galata Tower → Doğancılar | adventurous, wonder (inferred) | legend | draft |
| 13 | `lagari-sarayburnu-rocket` | Lagari Hasan Çelebi | Sarayburnu point | festive, daring (inferred) | legend | draft |
| 14 | `kiz-kulesi-legend` | Kız Kulesi Efsanesi | Kız Kulesi islet, night | tender, tragic (inferred) | legend | draft |
| 15 | `aya-yorgi-challenge` | Aya Yorgi'nin Meydan Okuması | Aya Yorgi monastery, Büyükada | devotional, playful (inferred) | legend | draft |
| 16 | `ships-over-land-1453` | Karadan Yürüyen Gemiler | Beyoğlu hills above Kasımpaşa, night | epic, tense (inferred) | legend | draft |
| 17 | `storks-bosphorus-migration` | Boğaz'da Leylek Göçü | Bosphorus corridor, day | calm, wonder (inferred) | city-life | ready |
| 18 | `ferry-gull-simit` | Martı ve Simit | Near a ferry (moving anchor) | light, humorous (inferred) | city-life | ready |
| 19 | `galata-bridge-anglers` | Galata Köprüsü Oltacıları | Galata Bridge upper deck | calm, everyday (inferred) | city-life | draft |

## Candidate catalogue

Each candidate has an id (H = historic, M = modern) used in the per-moment sections.

### Tier A: Victor records, New York 1916–1919 (Library of Congress National Jukebox)

Ottoman-Armenian and Turkish musicians who recorded for Victor's Turkish series in New York. Published in the US
before 1923, so public domain in the US since 2022, and far past 70 years in Turkey. Download: the "WAV" link on each
LoC page (`tile.loc.gov/storage-services/master/mbrsrs/mbrsjukebox/<id>/<id>.wav`), 44.1 kHz, 30–38 MB. Credit line
asked by the LoC: *Library of Congress, National Jukebox*.

| Id | Title (label spelling → Turkish) | Performers | Recorded | Label / matrix | Length | Source |
|---|---|---|---|---|---|---|
| **H1** | Käkidhana zemany → *Kâğıthane Semaisi* | Karekin Proodian (tenor, 1884–1977), Kemani Minas (violin), "Morene Eff." (kanun), Hagop (flute) | 6 Dec 1916 | Victor 69173, B-18808/2 | 3:38 | https://www.loc.gov/item/jukebox-20789/ |
| **H2** | Felek bana → *Felek Bana* | same ensemble | 6 Dec 1916 | Victor 69175, B-18809/1 | 3:27 | https://www.loc.gov/item/jukebox-20790/ |
| **H3** | Chifta telly gazel → *Çiftetelli gazel* | Kemani Minas (voice, violin), oud | 6 Dec 1916 | Victor 69178, B-18814/1 | 3:09 | https://www.loc.gov/item/jukebox-20795/ |
| **H4** | Husseiny uzery saba → *Hüseyni üzeri Saba* (gazel) | Jemal Bey "Oody" (voice, oud) | 8 Oct 1919 | Victor 72865, B-22491/1 | 2:53 | https://www.loc.gov/item/jukebox-191460/ |
| **H5** | Rast gazel | Jemal Bey (voice) with oud, kanun, kemençe | 18 Nov 1919 | Victor 72526, B-23339/1 | 3:02 | https://www.loc.gov/item/jukebox-34204/ |
| **H6** | Medley of Turkish melodies | Joseph Moskowitz (cimbalom, 1879–1954), Max Yussim (piano) | 27 Mar 1916 | Victor 67988, B-17394/1 | 2:58 | https://www.loc.gov/item/jukebox-17072/ |
| **H7** | Chasen senem → *Hasan'ım / Hasan senem* (title unclear) | Joseph Moskowitz (cimbalom), Max Yussim (piano) | 19 Jul 1916 | Victor 67988, B-18204/2 | 3:04 | https://www.loc.gov/item/jukebox-19027/ |

Other sides of the same sessions, not analysed but equally clean: *Ghitdy ghenchlik* (Gitti gençlik), *Peck juda
dushdim* (Pek cüda düştüm), *İftilâh-ı derd-i aşkın*, *Dayanılmıyor doktor* (Proodian with the ensemble,
jukebox-20786/20791/20792/20793), *Memo*, *Koozy*, *Ben neler*, *Nezerimda yena*, *Beny sermez bilirim* (Kemani Minas
with violin, jukebox-20794…20799), *Yeny memos*, *Yeny kessik kerem* (Jemal Bey, jukebox-34206/34207).

Analysis (level in dBFS; "groove" is the run-in before the music; S/N is music level p70 minus groove):

| Id | Instrumental passages (estimate, check by ear) | Voice | Groove | S/N | Clicks | Verdict on noise |
|---|---|---|---|---|---|---|
| H1 | **0:08–1:03** intro (55 s, quiet, bright: violin, kanun, flute); short interludes ~2:13–2:17, ~3:08–3:15 | from ~1:04 | −40 | 18 dB | 0.6/s | Charming. The intro is soft (−31 dB), so the crackle is audible there; a light denoise makes it usable. |
| H2 | **0:05–0:38** intro (33 s) | from ~0:40, steady to 3:20 | −36 | 17 dB | 0.4/s | Charming; the vocal body is loud and even. |
| H3 | 0:00–0:25 intro | from ~0:25 | −35 | 13 dB | 0.6/s | Noticeably hissy (7 % of energy above 4 kHz). |
| H4 | Oud alone ~**0:00–0:19** and ~**1:25–1:48**, short oud answers ~0:55, ~1:10, ~2:20 | gazel lines between | −43 | 18 dB | **5.2/s** | Crackly (many clicks) but a low hiss floor; the oud passages are quiet. De-click needed. |
| H5 | intro ~0:00–0:18, interludes ~0:35, ~1:10, ~1:45–1:53 | gazel | −34 | 14 dB | 1.6/s | Fair. |
| H6 | **all of it**, 0:05–2:55 (steadiest 1:56–2:56) | none | −39 | **9 dB** | 0.6/s | Noisy: the cimbalom was recorded very quietly, so normalising lifts the surface roar. Charming only at low volume or as a gramophone source. |
| H7 | **all of it**, 0:27–2:50 (steadiest 1:12–2:12) | none | −34 | **7 dB** | 0.2/s | Noisy, as H6. |

Rights notes:

- **H1, H2:** composed or traditional şarkı/semai; the composers are not named on the labels (check the lyrics against
  a şarkı index; if a named composer died after 1955, Turkey would still protect the song). Proodian's performance is
  covered by the 70-years-from-publication rule, so his late death (1977) does not matter.
- **H3, H4, H5 are gazels, i.e. vocal improvisations,** and the oud and violin fills are improvised too. Their authors
  are the performers. Kemani Minas's and Jemal Bey's death dates are **unknown**, and the Jukebox even credits Jemal
  Bey as "composer". Low practical risk (both were adults recording in the 1910s), but it is a flag.
- **H6, H7:** traditional melodies arranged by Moskowitz, who died in 1954, so the arrangement is free in Turkey since
  2025. Clean.

### Tier A: Istanbul commercial discs 1905–1918 (Wikimedia Commons, analogion.com)

| Id | Title | Performers | Year, label | Length | Vocals | Source | Rights |
|---|---|---|---|---|---|---|---|
| **H8** | *Dil verme gönül*, gazel in makam Isfahan | Mulla Osman al-Mawsili (voice, 1854–1923), **Tanburi Cemil Bey** (tanbur, 1873–1916) | Istanbul, c. 1912 (label not given) | 3:39 | yes, with tanbur | https://commons.wikimedia.org/wiki/File:ملا_عثمان_الموصلي_-_غزل_اصفهان_Isfahan_Gazel_-_Uthman_al-Mosuli.ogg | All three tests pass (performers are the improvising authors and died 1916/1923). Weak provenance: the Commons file came from a YouTube upload, so the transfer is second-hand (fine legally, unknown quality). |
| **H9** | *Reşadiye Marşı* (March of Sultan Mehmed V) | Odeon Orchestra | 1910, **Odeon 54745** | 2:58 | none (orchestra) | https://commons.wikimedia.org/wiki/File:Marche_de_sa_Majesté_Impériale_Le_Sultan_Mohammed_V._par_Italo_Selvelli.ogg | Composer Italo Selvelli (1863–1918). Clean. |
| **H10** | *Hamidiye Marşı* | band (Odeon) | c. 1905–1908, **Odeon 54142** | 2:54 | none (band) | https://commons.wikimedia.org/wiki/File:Hamidiye_March_by_Nedjib_Pasha.ogg | Composer Necip Paşa (d. 1883). Clean. Second transfer: Zonophone X-100025, 2:22, https://commons.wikimedia.org/wiki/File:Marche_de_sa_Majesté_Impériale_Le_Sultan_Abdul-Hamid-Han_II._par_S._E._Nédjib_Pacha.ogg |
| **H11** | *Sivastopol Önünde Yatar Gemiler* (Sivastopol Marşı) | Hafız Yaşar Bey (voice) | 1910, **Favorite Record** | 3:13 | **yes** | https://commons.wikimedia.org/wiki/File:Sivastopol_Önünde_Yatar_Gemiler.ogg | Composer Rıfat Bey (19th c.). Performer (Aksaraylı Hafız Yaşar, d. 1966) is not an author here (composed song), so the 70-year rule for performers applies. Clean. |
| **H12** | *Plevne Marşı* | Hafız Yaşar Bey (voice) | 1910, Gramophone (recorded by F. Gaisberg) | 3:11 | **yes** | https://commons.wikimedia.org/wiki/File:Plevna_March.ogg | 1877 march (composer attributed to Mehmet Ali Bey, Dikran Çuhacıyan or Edouard Taxim, all 19th c.). Clean. |
| **H13** | *Os ton echmaloton eleftherotis*, Apolytikion of St George (4th mode, chromatic) | **Iakovos Nafpliotis** (1864–1942), Archon Protopsaltis of the Patriarchate | Orfeon, Constantinople, 1913–1918 (site's dating) | 1:15 | chant | https://analogion.com/site/mp3/Apolytikion-AgGeorgiou-INafpliotis.mp3 (page https://analogion.com/site/html/Nafpliotis.html) | Byzantine chant is traditional; published pre-1926 in Constantinople. Clean *if* this is a raw 78 transfer: the page warns that an ison drone was overdubbed on some tracks decades later (that overdub would be protected). Ask the site or compare with another transfer. |
| **H14** | *Trisagion (Dynamis), Synithismenon*, 2nd mode; also *Tin oraiotita* | Iakovos Nafpliotis (and K. Pringos on some) | Orfeon, 1913–1918 | 3:06; 3:46 | chant | https://analogion.com/site/mp3/Nafpliotis/IakovosNafpliotis052_TrisagiosHymnosSynithismenon.mp3 · https://analogion.com/site/mp3/Nafpliotis/IakovosNafpliotis009a_TinOraiotita.mp3 | As H13. |

Analysis of the files that could be downloaded:

| Id | Usable stretch | Noise |
|---|---|---|
| H13 | the whole piece, 0:00–1:15 | Processed transfer: no clicks left, band-limited (nothing above ~5 kHz), 128 kbps MP3. Sounds "clean but dull"; no crackle charm, no disturbing noise. |
| H14 | a 60–90 s phrase of either (Trisagion steadiest in the middle third) | 11 kHz, 64 kbps-class MP3: telephone-like bandwidth. Fine as a distant church texture, too dull as foreground. |
| H8–H12 | not analysed (upload.wikimedia.org returned 429) | File pages give no noise notes. Expect typical 1905–1912 acoustic surface noise; listen before approving. |

### Tier B: Pathé discs, Istanbul, 1920s (BnF, Archives de la Parole)

The BnF holds 102 Turkish Pathé discs donated to the Archives de la Parole, recorded in the 1920s and published
before the alphabet change of November 1928 ([Bulletin de l'AFAS, "Le fonds de disques 78 tours Pathé de musique arabe et orientale…", part 2](https://journals.openedition.org/afas/2903)).
The catalogue dates them "192." or "19.."; the two sister discs with a firm date (Pathé 76136, 76147) are **1928**, and
the matrix numbers of the unnumbered discs (N 11016–11200) are only a few hundred below them, so **1927–1928** is the
likely range. That makes them **Tier B**: free in Turkey now (published before 1956; composers 19th century; the
improvising performers below died before 1956), free in the US on 1 Jan 2028 or 2029. Audio is on Gallica (blocked
from here); Gallica's reuse terms apply to its files (see "Read this first").

These are **the only calm, instrumental, makam-proper classical pieces found** in the whole search, which is why they
are listed.

| Id | Title | Performers | BnF record | Instrumental? |
|---|---|---|---|---|
| **H15** | *Hüseyni Taksim* / *Hüseyni Saz Semaisi* | **Hafız Kemal Bey** (kemençe, 1884–1939), Hayriye Hanım (ud) | Pathé, matrices N 11016/11017, [cb42415946n](https://catalogue.bnf.fr/ark:/12148/cb42415946n); saz semai side on Commons: https://commons.wikimedia.org/wiki/File:Husseyni_Saz_Semayissi_.ogg (3:09) | **yes, both sides** |
| H16 | *Şehnaz Peşrevi* / *İsfahan Taksim* | Hafız Kemal Bey, Hayriye Hanım | N 11019/11039, cb42415974w | yes |
| H17 | *Tahir Buselik* (4 parts) | Hafız Kemal Bey, Hayriye Hanım | N 11037/11038, cb424162537 | yes |
| H18 | *Hüseyni Taksim* / *Hüzzam Taksim*; *Nihavend Taksim*; *Hicaz Saz Semaisi* / *Hicaz Taksim*; *Neveser Peşrevi* / *Taksim*; *Acemaşiran Saz Semaisi*; *Hicaz Hümayun*, *Hicazkâr* peşrevs | Reşad Bey (violin; piano on some) | N 11135/11136; Pathé 76218, 76217, 76220, 76216, 76219; cb42413851g, cb424185766, cb42418574h, cb42417139n, cb42413442d | yes (piano accompaniment on the peşrevs is a Western touch) |
| H19 | *Mahur Saz Semaisi* | Sedad Bey (ud), Mesut Cemil (kemençe) | N 11075, cb42416329n | yes (composed piece, so Mesut Cemil's 1963 death does not matter) |
| H20 | *Saz Semaisi* (parts 1–2) | Tanburi Refik Bey (tanbur), Madame Neva (kemençe) | Pathé 76232, cb42418279d | yes |
| H21 | *Uşşak Taksim* | Udi Nevres Bey (ud, 1873–1937) | N 11126, cb42413833j | yes |
| H22 | *Aksaray Kantosu*, *Dolaycı Kantosu*, *Beyoğlu Kantosu* | Aksaraylı Hafız Yaşar Bey (voice) | Pathé 76225; N 11121/11125 | no (kanto songs, the music of the Direklerarası stage) |

Excluded from the Pathé list: Mesut Cemil's own taksims (*Hicazkâr Taksim*, *İsfahan Taksim*, N 11109/11836): he
improvised them and died in 1963, so they are protected in Turkey until the end of 2033.

### Tier C: modern open-licence recordings

| Id | Title | Performer | Licence | Length | Source | Notes |
|---|---|---|---|---|---|---|
| **M1** | *Üsküdar'a Gider İken* | Turku, Nomads of the Silk Road (US ensemble: saz, violin, ud, percussion) | **CC BY 4.0** | 3:12 | https://commons.wikimedia.org/wiki/File:Turku_Nomads_of_the_Silk_Road_-_01_-_-Uskudara_Gideriken.ogg (album: https://freemusicarchive.org/music/Turku_Nomads_of_the_Silk_Road/Alleys_of_Istanbul/) | The only openly licensed real performance of Kâtibim found. Vocals not confirmed (the band sings on most of the album). Credit: *Müzik: Üsküdar'a Gider İken — Turku, Nomads of the Silk Road (CC BY 4.0)*. |
| M2 | *Kâtibim* (score rendering) | Commons user Baba66 (computer rendering of an engraved score) | public domain | 1:13 | https://commons.wikimedia.org/wiki/File:Kâtibim.mp3 | Not a performance, a synthesised score playback. Useful only as a melody reference for a generated instrumental. |
| M3 | xserra CompMusic recordings (Ruhi Ayangil kanun, Segah ney, Sipahioğlu tanbur, Zeytinoğlu ud) | see [`music.md`](music.md) C1–C7 | CC BY 3.0/4.0 | ~1 min each | Freesound | The modern instrumental pool from the earlier shortlist. |

### Not usable (X)

| Item | Why |
|---|---|
| Safiye Ayla, *Kâtibim (Üsküdar'a Gider İken)*, 78 rpm, https://archive.org/details/KatibimuskudaraGiderIken-SafiyeAyla (3:21, violin, kanun, ud, clarinet; uploader's "public domain" tag) | The famous recording, but from **1949** (per Wikipedia): free in Turkey since 2020, protected in the US until 2059. Fails the US test. Analysis for the record: 0:00–0:16 quieter introduction, vocal from ~0:16, 2.7 clicks/s, fair noise. **Taken 2026-09-26 as a US-risky private piece** (owner accepts the risk; see the decision). |
| Hafız Burhan, *Kadifeden Kesesi*, *Ben Yemenimi Al İsterim* (Internet Archive, same uploader) | No label or date; Hafız Burhan recorded from the 1910s to the 1930s, so the US test cannot be shown. |
| Darülelhan folk-song series (e.g. *Turnalar Turnalar*, Denizkızı Eftalya) | 1926–1929: US-free from 2027–2030 at the earliest; dates per disc unknown. |
| Udi Hrant, Marko Melkon, Kanuni Garbis taksims (Great 78 Project) | 1930s–1940s US releases; also improvisations by performers who died after 1955. |
| Ahmed Djewdet, *Taxim Hicaz*, Polydor c. 1928 (Commons/FMA) | Improvisation by Ahmet Cevdet Çağla (d. 1988): protected in Turkey until 2058. |
| "Byzantine Ecclesiastical Hymns" (Commons, CC0 tag) | Taken from a Moldovan FTP server with no provenance; the CC0 tag is the uploader's claim. |
| *Ceddin Deden* (Commons, CC BY-SA 4.0, Mahmoud Gul) | Share-alike, apparently a synthesised arrangement; composer attribution disputed. |
| Kürdilihicazkâr Peşrevi "Tanburi Cemil Bey" (archive.org `kurdilihicazkar-perevi`) | A modern performance of Cemil Bey's piece ("eser icrası"), no licence. |
| Any YouTube / Spotify / Kalan / Traditional Crossroads reissue of Tanburi Cemil Bey, Hafız Burhan, Neyzen Tevfik | Link only (an official YouTube embed in the source sheet is fine). |

## Per moment

### 1. `nedim-bu-sehr-i-sitanbul` — Bu Şehr-i Sıtanbûl (solemn, history; morning over Sarayburnu)

| Candidate | Why | Vocals under subtitles |
|---|---|---|
| **H1 intro, 0:08–1:03** (Tier A) | *Kâğıthane Semaisi*: Kâğıthane and Sadâbâd were the Lâle Devri pleasure grounds Nedim sang about. 55 s of violin, kanun and flute. | Instrumental cut only. |
| H15 *Hüseyni Saz Semaisi* (Tier B) | The most "court" sound: kemençe and ud, stately. | Instrumental. |
| H8 Isfahan gazel with Tanburi Cemil (Tier A) | The greatest Istanbul player of the era; tanbur fills. | Sung: only at gramophone distance. |

**Pick: H1 intro.** Upgrade to H15 once Tier B is accepted.

### 2. `sinan-turbe-kitabesi` — Pîr-i Mi'mârân Sinan (elegiac, dusk)

| Candidate | Why | Vocals |
|---|---|---|
| **H15** *Hüseyni Taksim* side (Tier B) | A solo kemençe taksim: inward, unmetered, ideal for an epitaph. | Instrumental. |
| H21 Udi Nevres, *Uşşak Taksim* (Tier B) | Solo ud, warm and grave. | Instrumental. |
| H4 oud passages (Tier A) | Only ~20 s of oud at a time between sung lines; too short for 40 s without the voice. | Sung between. |
| D: generated tanbur taksim (see fallbacks) | | |

**Pick: H15 taksim (Tier B)**; until then the fallback. No Tier A instrumental of the right character and length was
found.

### 3. `katibim-uskudar-yagmur` — Kâtibim (joyful, tender; Üsküdar in the rain)

The owner's wish was the real Kâtibim. What exists:

| Candidate | Status | Notes |
|---|---|---|
| Safiye Ayla, 1949 | **X** | The famous recording; fails the US test (see above). |
| Naftule Brandwein, *Der Terk in America*, 1924 (instrumental klezmer version of the same tune, per Wikipedia's Kâtibim article) | **Lead, not found** | Would pass the US and TR tests (published 1924; the tune is traditional; Brandwein died 1963, but an arrangement credit could matter in Turkey). No clean online transfer was found (not in the Jukebox; the Internet Archive has other Brandwein sides only). Worth a targeted look in DAHR or a collector's transfer. Klezmer clarinet, not Istanbul style. |
| **M1** Turku, *Üsküdar'a Gider İken* (CC BY 4.0) | Tier C | A real, openly licensed performance of the tune with saz, violin and ud. Probably sung. |
| **D** generated instrumental of the traditional tune | Fallback | The tune itself is public domain. |

**Pick: D (generated instrumental)**, with M1 as the "real recording" alternative if the owner accepts a modern CC BY
band and its vocals. A sung Kâtibim under the Kâtibim subtitles would double the words; if the owner wants the voice,
play it as a far-away gramophone in a Üsküdar coffeehouse.

### 4. `ati-alan-uskudari-gecti` — Atı Alan Üsküdar'ı Geçti (joyful, sea)

| Candidate | Why | Vocals |
|---|---|---|
| **H6** Moskowitz, *Medley of Turkish melodies* (Tier A) | Brisk, instrumental throughout, a chase feeling. | None. |
| H2 *Felek Bana* (Tier A) | Lively ensemble. | Sung from 0:40. |
| H9 *Reşadiye Marşı* (Tier A) | Comic grandeur for a galloping thief. | None. |

**Pick: H6** (keep it quiet; noisy transfer).

### 5. `karagoz-sehzadebasi` — Perde: Karagöz ile Hacivat (joyful, history; Ramadan night)

| Candidate | Why | Vocals |
|---|---|---|
| **H2** *Felek Bana* (Tier A), whole record | A 1916 şarkı with violin, kanun and flute: the sound of a Direklerarası night heard through a coffeehouse door. | Sung; fits here at a distant gramophone level. |
| H22 Hafız Yaşar, *Aksaray Kantosu* (Tier B) | A kanto is exactly the music of the Şehzadebaşı stages around Karagöz. | Sung. Check the kanto composer. |
| H1 intro (Tier A) | Instrumental option if the owner wants no voice. | None. |

**Pick: H2**, as a gramophone source placed on the street. Note: no public-domain recording of a Karagöz perde
(nareke, the göstermelik song) was found online; early Karagöz discs existed (Hayali Küçük Ali and others) but none
with a traceable free transfer.

### 6. `fikret-yagmur-asiyan` — Yağmur (nostalgic, tender; rain)

| Candidate | Why | Vocals |
|---|---|---|
| **H7** Moskowitz, *Chasen senem* (Tier A) | Cimbalom tremolo sounds like rain on a roof; Fikret's poem imitates the rain's rhythm. 1916, a year after Fikret's death. | None. |
| H6 (Tier A) | Same instrument, more festive. | None. |
| H15 (Tier B) | Calm kemençe. | None. |

**Pick: H7** (quiet; noisy transfer, the noise reads as rain).

### 7. `hasim-bir-gunun-sonunda-arzu` — Bir Günün Sonunda Arzu (nostalgic, tender, mystic; sunset on the water)

| Candidate | Why | Vocals |
|---|---|---|
| **H19** *Mahur Saz Semaisi* (Tier B) | Mahur is bright but wistful; ud and kemençe. | None. |
| H18 Reşad Bey, *Hüzzam Taksim* (Tier B) | Hüzzam is the classic dusk makam. | None. |
| D: generated ney over soft kanun | | |

**Pick: H18 Hüzzam Taksim (Tier B)**; the fallback until the date passes. No Tier A fit.

### 8. `huseyin-rahmi-kuyrukluyildiz` — Kuyrukluyıldız (joyful, mystic; night over Heybeliada)

Hüseyin Rahmi's comic novel is set during Halley's comet of 1910.

| Candidate | Why | Vocals |
|---|---|---|
| **H9** *Reşadiye Marşı*, Odeon 1910 (Tier A) | Literally a record of 1910: the new Sultan's march on a gramophone, pompous and funny under a comet panic. | None. |
| H10 *Hamidiye Marşı* (Tier A) | The previous reign's march, same effect. | None. |
| H6 (Tier A) | Lighter alternative. | None. |

**Pick: H9**, ideally as a gramophone source on Heybeliada.

### 9. `prokopios-gokten-asili-kubbe` — Gökten Asılı Kubbe (solemn, mystic, history)

| Candidate | Why | Vocals |
|---|---|---|
| **H14** Nafpliotis, *Trisagion* (Tier A) | The Patriarchate's own chant, recorded in Constantinople: the oldest surviving sound of the rite that filled the dome. | Chant; slow and melismatic, works as a texture at low level. |
| H14 *Tin oraiotita* (Tier A) | Alternative phrase. | Chant. |
| D: generated low drone with distant male voices, no words | | |

**Pick: H14 Trisagion**, a 60–90 s phrase. Lo-fi transfer: keep it distant.

### 10. `de-amicis-sis-kalkinca` — Sis Kalkınca (solemn, sea, history; the city appears from the fog)

| Candidate | Why | Vocals |
|---|---|---|
| **H8** Isfahan gazel, Tanburi Cemil Bey (Tier A) | Slow, expansive, the Istanbul sound par excellence; the reveal of the skyline. | Sung; keep far away, or cut the tanbur-only fills (not analysed: file not downloadable). |
| H15 (Tier B) | Instrumental and stately. | None. |
| H10 *Hamidiye Marşı* (Tier A) | Ceremonial arrival. De Amicis came in 1874 (the Aziziye march era); Hamidiye is close in style. | None. |

**Pick: H8** if its tanbur fills or a distant level work under the prose; otherwise H15 once Tier B is accepted.

### 11. `orhan-veli-istanbulu-dinliyorum` — İstanbul'u Dinliyorum (nostalgic, sea)

The poem is a catalogue of city sounds heard with eyes closed; a faraway gramophone is one of them.

| Candidate | Why | Vocals |
|---|---|---|
| **H4** Jemal Bey, *Hüseyni üzeri Saba* (Tier A) | Oud and voice, intimate; start on the oud passage 0:00–0:19. | Sung after 0:19. Play it as a distant gramophone from a shore window, clearly quieter than the subtitles need. |
| H15 (Tier B) | Instrumental alternative. | None. |
| H1 intro (Tier A) | Instrumental alternative (shared with Nedim). | None. |

**Pick: H4 as a gramophone source**, with H15 as the instrumental upgrade.

### 12. `hezarfen-galata-uskudar` — Hezarfen Ahmed Çelebi (adventure)

| Candidate | Why | Vocals |
|---|---|---|
| **H10** *Hamidiye Marşı* (Tier A) | Brass-band flourish for a daring flight and the Sultan's purse of gold. | None. |
| H6 (Tier A) | Airy cimbalom. | None. |
| D: generated mehter-like piece | | |

**Pick: H10.**

### 13. `lagari-sarayburnu-rocket` — Lagari Hasan Çelebi (festive)

The flight was part of the celebrations for a royal birth.

| Candidate | Why | Vocals |
|---|---|---|
| **H12** *Plevne Marşı* (Tier A) | Rousing Ottoman march. | Sung by Hafız Yaşar: fine for a festive legend. |
| H9 (Tier A) | Instrumental ceremonial march. | None. |
| D: generated mehter with zurna and kös | | The historically right colour; no clean mehter recording exists. |

**Pick: H9 (instrumental)**, H12 if the owner likes the voice.

### 14. `kiz-kulesi-legend` — Kız Kulesi Efsanesi (tender, tragic; night)

| Candidate | Why | Vocals |
|---|---|---|
| **H18** Reşad Bey, *Hüzzam Taksim* (Tier B) | Lament-like violin. | None. |
| H17 *Tahir Buselik* (Tier B) | Tender kemençe and ud. | None. |
| D: generated kemençe lament | | |

**Pick: H18 (Tier B)**; fallback until then. No Tier A fit.

### 15. `aya-yorgi-challenge` — Aya Yorgi'nin Meydan Okuması

| Candidate | Why | Vocals |
|---|---|---|
| **H13** Nafpliotis, *Apolytikion of St George* (Tier A) | The actual hymn of the saint the monastery is named after, by the Patriarchate's first cantor, recorded in Constantinople. 75 s: a perfect length. | Chant. |
| H14 (Tier A) | Other Nafpliotis chant. | Chant. |

**Pick: H13.** Confirm it is a raw transfer (no later ison overdub).

### 16. `ships-over-land-1453` — Karadan Yürüyen Gemiler (epic, night)

| Candidate | Why | Vocals |
|---|---|---|
| H11 *Sivastopol Önünde Yatar Gemiler* (Tier A) | "The ships lying before Sevastopol": a real Ottoman war song about ships, 1910. Four centuries off. | Sung. |
| H14 Nafpliotis chant (Tier A) | The besieged city's side. | Chant. |
| **D** generated mehter-inspired night march | | The right colour for Mehmed's army. |

**Pick: D.** H11 is a clean real alternative but a weak fit.

### 17. `storks-bosphorus-migration` — Boğaz'da Leylek Göçü (calm, wonder)

| Candidate | Why | Vocals |
|---|---|---|
| **H1 intro** (Tier A) | Gentle, airy flute and violin. | None. |
| H20 *Saz Semaisi*, Refik Bey (Tier B) | Tanbur and kemençe. | None. |
| M3 xserra ney / kanun (Tier C) | | None. |

**Pick: H1 intro** (shared with Nedim; the variety rule only stops two moments in a row).

### 18. `ferry-gull-simit` — Martı ve Simit (light, humorous; ferry)

| Candidate | Why | Vocals |
|---|---|---|
| **H6** (Tier A) | Bouncy cimbalom; a record on the ferry saloon's gramophone (`musicSource` with the ferry anchor). | None. |
| H2 (Tier A) | A sung şarkı from the saloon. | Sung; fine here. |

**Pick: H6** (shared with Atı Alan).

### 19. `galata-bridge-anglers` — Galata Köprüsü Oltacıları (calm, everyday)

| Candidate | Why | Vocals |
|---|---|---|
| **H5** Jemal Bey, *Rast gazel* (Tier A) | A coffeehouse gramophone under the bridge; Rast is the everyday makam. | Sung; fine as a distant source. |
| H4 (Tier A) | Same singer, oud only. | Sung. |
| H21 *Uşşak Taksim* (Tier B) | Instrumental. | None. |

**Pick: H5** as a gramophone source.

## Summary

| # | Moment | Pick | Tier | Vocals | Length used |
|---|---|---|---|---|---|
| 1 | nedim-bu-sehr-i-sitanbul | H1 *Kâğıthane Semaisi*, intro 0:08–1:03 (Victor 69173, 1916) | A | none (cut) | 55 s |
| 2 | sinan-turbe-kitabesi | D generated; upgrade H15 Hafız Kemal *Hüseyni Taksim* | D (B) | none | 60–90 s |
| 3 | katibim-uskudar-yagmur | D generated *Üsküdar'a Gider İken*; alt. M1 Turku (CC BY 4.0) | D (C) | none / sung | 60–90 s |
| 4 | ati-alan-uskudari-gecti | H6 Moskowitz *Medley of Turkish melodies* (Victor 67988, 1916) | A | none | 60–90 s |
| 5 | karagoz-sehzadebasi | H2 *Felek Bana* (Victor 69175, 1916) as street gramophone | A | sung, distant | 60–120 s |
| 6 | fikret-yagmur-asiyan | H7 Moskowitz *Chasen senem* (Victor 67988, 1916) | A | none | 60–90 s |
| 7 | hasim-bir-gunun-sonunda-arzu | D generated; upgrade H18 Reşad Bey *Hüzzam Taksim* | D (B) | none | 60–90 s |
| 8 | huseyin-rahmi-kuyrukluyildiz | H9 *Reşadiye Marşı* (Odeon 54745, 1910) | A | none | 60–90 s |
| 9 | prokopios-gokten-asili-kubbe | H14 Nafpliotis *Trisagion* (Orfeon, 1913–18) | A | chant, distant | 60–90 s |
| 10 | de-amicis-sis-kalkinca | H8 Isfahan gazel with Tanburi Cemil Bey (c. 1912) | A | sung, distant | 60–120 s |
| 11 | orhan-veli-istanbulu-dinliyorum | H4 Jemal Bey *Hüseyni üzeri Saba* (Victor 72865, 1919) as gramophone | A | oud intro, then sung | 60–90 s |
| 12 | hezarfen-galata-uskudar | H10 *Hamidiye Marşı* (Odeon 54142, c. 1906) | A | none | 60–90 s |
| 13 | lagari-sarayburnu-rocket | H9 *Reşadiye Marşı* (or H12 *Plevne Marşı*, sung) | A | none | 60–90 s |
| 14 | kiz-kulesi-legend | D generated; upgrade H18 Reşad Bey *Hüzzam Taksim* | D (B) | none | 60–90 s |
| 15 | aya-yorgi-challenge | H13 Nafpliotis *Apolytikion of St George* | A | chant | 75 s |
| 16 | ships-over-land-1453 | D generated mehter-style; alt. H11 *Sivastopol Önünde Yatar Gemiler* (1910) | D (A) | none | 60–90 s |
| 17 | storks-bosphorus-migration | H1 intro 0:08–1:03 (shared) | A | none | 55 s |
| 18 | ferry-gull-simit | H6 (shared) | A | none | 60–90 s |
| 19 | galata-bridge-anglers | H5 Jemal Bey *Rast gazel* (Victor 72526, 1919) as gramophone | A | sung, distant | 60–120 s |

**Count: 14 moments have a clean (Tier A) real historic recording as the pick; 5 need a fallback** (Sinan, Kâtibim,
Haşim, Kız Kulesi, the ships). Three of the five (Sinan, Haşim, Kız Kulesi) have a Tier B Pathé recording that fits
better than anything in Tier A and becomes fully clean in the US on 1 Jan 2028 or 2029. Kâtibim has a real open-licence
performance (M1) and a Tier A lead (Brandwein 1924) that was not found online.

Honesty note on fit: the Tier A pool is small (New York Victor sides, Istanbul marches, Byzantine chant, one Tanburi
Cemil gazel). Several picks are period-right colour rather than an exact match (marches for the 17th-century legends,
a 1916 cimbalom for Fikret's rain). The owner should listen to H1, H2, H6, H7, H9, H13 first; they carry 11 of the 14.

## No clean real recording: fallbacks

Generate these as instrumentals, 60–90 s, one or two instruments, no drums unless stated, a real ending (held note
dying away), per the moment-piece workflow in `.docs/audio/music-system.md`. Gemini Lyria prompts (Suno works with the
same text). Each tune named is traditional or by a composer who died before 1956, so a new performance is ours.

1. **Kâtibim** — *"Solo oud and kanun duet playing the traditional Istanbul folk tune 'Üsküdar'a Gider İken'
   (Kâtibim), makam Nihavend-like minor, 2/4 at a relaxed walking tempo, around 84 bpm. Warm close-miked oud states the
   melody once, kanun answers with the second phrase and light tremolo, gentle rain-day mood, intimate, no percussion,
   no vocals, no reverb wash. 75 seconds, ends on a held low note."* Reference melody: M2 (Commons score rendering).
   If a live player is available instead, a single ud recording of the tune is the ideal file.
2. **Sinan (epitaph at dusk)** — *"Unmetered Ottoman tanbur taksim in makam Hüzzam, slow and grave, long silences
   between phrases, soft drone, dusk at a mosque courtyard, no percussion, no vocals, 80 seconds, ends on the tonic."*
3. **Haşim (sunset on the water)** — *"Ney improvisation in makam Hüzzam over a very soft kanun tremolo drone, twilight
   over still water, breathy and close, no percussion, no vocals, 90 seconds, fades on a long held ney note."*
4. **Kız Kulesi (tragic legend at night)** — *"Kemençe (Istanbul classical kemenche) lament in makam Uşşak, unmetered,
   quiet night sea, tender and sorrowful, occasional ud plucks, no percussion, no vocals, 75 seconds."*
5. **Ships over land, 1453** — *"Distant Ottoman mehter-inspired night march: slow davul heartbeat and low kös drum,
   one zurna far away playing a modal phrase, soft cymbal (zil) accents, tense and heroic, sparse, no vocals, no brass
   band harmony, 80 seconds, ends with a single drum stroke."* (Name no specific march: *Ceddin Deden* and the like
   have unclear authorship.)

## Next steps for the owner

1. **Listen first** to the Tier A picks: H1, H2, H6, H7 (LoC WAVs), H9, H10, H8 (Commons), H13, H14 (analogion). Approve
   or reject each.
2. **Tier B decision:** accept the Pathé recordings (H15–H22) now with a ship-after date, or wait. If accepted, get the
   audio from Gallica (from an unblocked machine) and note Gallica's commercial-reuse clause.
3. **Kâtibim:** choose between a generated instrumental (D), the Turku CC BY 4.0 recording (M1, credit required), or
   a search for a transfer of Brandwein's 1924 *Der Terk in America*.
4. **Checks before integration:** lyrics/composer of H1 and H2 against a şarkı index; the death dates of Kemani Minas
   and Jemal Bey (H3–H5 are their improvisations); that H13/H14 are raw transfers without the later ison overdub.
5. After approval, record each file in `public/audio/LICENSES.md` and `tools/assets/approved.json` with the source
   page, label and catalogue number, date, rights reasoning (the three tests) and the edits made (trim, de-click,
   denoise, fade, loudness). Credit lines in Turkish, e.g. *Müzik: Felek Bana — Karekin Proodian, Kemani Minas ve
   topluluğu, Victor 69175 (1916), Library of Congress National Jukebox (kamu malı)*.
6. Previews: per the brief this pass wrote only this document, so no preview images were saved under
   `.shots/assets/`. The LoC and Commons pages have players.
