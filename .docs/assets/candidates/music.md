# Music candidates for Anlar (pending approval)

Status: **shortlist only, nothing approved.** No music file was downloaded or added to `assets-src/`,
`private-assets/` or `public/`, and nothing is referenced in code. Researched on 2026-09-26.

**Read this first: every page below was checked through a web search index only.** This container's egress proxy
blocks every music host: freesound.org, cdn.freesound.org, commons.wikimedia.org, upload.wikimedia.org,
tr/en.wikipedia.org, archive.org, freemusicarchive.org, jamendo.com, ccmixter.org, pixabay.com, incompetech.com,
musopen.org, europeana.eu, loc.gov, gallica.bnf.fr, bandcamp.com, soundcloud.com, huggingface.co and zenodo.org all
return `403` on CONNECT (organization policy), for both `curl` and WebFetch. So:

- **No preview was fetched.** Every candidate is marked "preview not fetched (host blocked)", and
  `.shots/assets/music/` is empty.
- **No licence was read on the page itself.** The licences, durations and sizes below come from search-engine
  snippets of each page. Where a snippet gave no value, the field says *unverified*. The owner (or an agent with
  access) must open each page, check the licence badge and listen before approving. Treat this as a list of leads.
- **I did not listen to anything.** Makam and mood notes come from titles, descriptions and the performers'
  repertoire, not from listening.

Need: the moments (`.docs/planning/19-moments.md`, candidates in `.docs/moments/candidates.md`) are timed Turkish
subtitles of 30–90 s over a soft instrumental bed. Each candidate there suggests a makam as a mood. The owner's
request: *"Our self-made sounds are bad. There are very nice suitable things on the internet. Let's use them even if
licensed, but credit the owner as a source, respect them, and let players go to the source."*

## Licence rules for this list

**Credit alone does not give us the right to use a recording.** Naming the artist and linking to them is respectful
and we will always do it. But it only makes use legal when the work's licence (or the rights holder's written
permission) allows use in a game. A recording under standard copyright stays unusable however prominently we credit
it. So each candidate is sorted as follows:

| Class | Usable as a moment bed? | Obligations / flags |
|---|---|---|
| Public domain / CC0 | Yes | None; we credit anyway. |
| CC BY (3.0 / 4.0) | Yes | Credit (title, author, licence, link) shown in game and in the credits list. |
| CC BY-SA | **Owner decision** | Credit, plus share-alike: our edited version (trimmed, looped, faded) must be released under BY-SA. That is compatible with an open-source repo, but it binds the audio files, and possibly anything they are mixed into, to BY-SA. |
| CC BY-NC / BY-NC-SA | **Owner decision** | Credit, and no commercial use. The game is non-commercial today (`19-moments.md`, "Rights"), but commercial intent is still an open question in the GDD (`.docs/planning/README.md` music row, `07-regional-music.md` "Decided with the user … commercial intent"). An NC track would have to be removed before any monetization. |
| CC BY-ND / NC-ND | **No** | Trimming, looping, fading and syncing to subtitles count as adaptation. |
| "Royalty-free" / platform licences (Pixabay, etc.) | Owner decision, not recommended | Not Creative Commons. Pixabay forbids standalone redistribution, and a raw MP3 in a public GitHub repo is close to that. Many tracks there are AI-generated, so there is no human author to credit. |
| Old recording of an old composition | Only if the **recording** is PD or openly licensed | An old composer does not make a recording free. A taksim is the performer's own improvisation, so it is protected until 70 years after the *performer's* death (Turkey, EU). In the US, recordings published before 1923 are PD (Music Modernization Act); later ones stay protected for 100 years or more. |
| Standard copyright (YouTube uploads, commercial albums, Spotify, most SoundCloud) | **No, never as the bed** | May only be linked, or embedded from the rights holder's official upload, in the source sheet as "listen to the original". The existing `embed: { kind: 'youtube' }` source item already supports this. |

A second route that fixes NC/SA problems: **ask the artist.** A short written permission from the rights holder (for
example Ehl-i Keyif / Chubry, see C11–C12) is a valid licence, and it is also the most respectful form of "credit the
owner". It would be recorded in `public/audio/LICENSES.md` together with the permission.

### How attribution will appear

1. **In the moment's source sheet** ("[I] Kaynağa bak"): every moment with a music bed gets one more `MomentSource`,
   `kind: 'audio'`, with the track title, the `attribution`, the `licence` and the canonical `url` (the Freesound, FMA
   or Commons page), so "[n] Tarayıcıda aç" takes the player to the performer's page. Suggested Turkish line:
   **`Müzik: <eser> — <icracı / yükleyen> (<lisans>)`**, e.g. `Müzik: Segah-Ney — xserra, SegahNey atölyesi (CC BY 3.0)`.
   Where an official video of the same performer exists, it can be added as a separate "Orijinalini dinle" source (a
   link or an approved YouTube embed only, never as audio in the game).
2. **In a credits list** (pause menu → Anlar or a "Emeği geçenler / Müzik" page): every track with its title, author,
   licence and link, generated from `public/audio/LICENSES.md` like the existing sound credits.
3. **In `public/audio/LICENSES.md`** and `tools/assets/approved.json`: file → source page, author, licence, the
   changes we made (trimmed, looped, faded, re-encoded). CC BY requires us to say that the file was changed.

## Summary

Status key: **idx** = seen only through a search index (page not opened, audio not heard).

| # | Title | Performer / author | Instrument | Makam | Duration | Licence | Host | Status | Best moments |
|---|---|---|---|---|---|---|---|---|---|
| C1 | Ruhi-Ayangil-Kanun-1.wav | Ruhi Ayangil, rec. xserra | kanun | unknown (listen) | *unverified* | CC BY (version unverified) | Freesound | idx | 1, 20, 21 |
| C2 | Ruhi-Ayangil-Kanun-2.wav | Ruhi Ayangil, rec. xserra | kanun | unknown | *unverified* | CC BY (version unverified) | Freesound | idx | 1, 20, 21 |
| C3 | Segah-Ney.wav | SegahNey workshop (Izmir), rec. xserra | ney | unknown (shop name) | 1:04 | CC BY (version unverified) | Freesound | idx | 3, 20, 12 |
| C4 | ney.wav | Hamza Zeytinoğlu, rec. xserra | ney | unknown | *unverified* | CC BY (version unverified) | Freesound | idx | 3, 11, 12 |
| C5 | oud.wav | Hamza Zeytinoğlu, rec. xserra | ud | unknown | *unverified* | CC BY (version unverified) | Freesound | idx | 7, 14, 18 |
| C6 | tanbur.wav | Hamza Zeytinoğlu, rec. xserra | tanbur | unknown | *unverified* | CC BY | Freesound | idx | 5, 24, 3 |
| C7 | Selcuk-Sipahioglu-1.wav | Selçuk Sipahioğlu, rec. xserra | tanbur | unknown | 1:02 | CC BY 4.0 | Freesound | idx | 10, 12, 5 |
| C8 | ussak_cesni_kemence.wav | Neva Günaydın, rec. ajaysm | kemençe | Uşşak (motif) | *unverified*, likely short | CC BY (version unverified) | Freesound | idx | 2, 18 (texture) |
| C9 | kanun_taksimi.mp3 | taner2011 | kanun | unknown | 1:29 | **CC BY-NC** | Freesound | idx | 5, 24, 14 |
| C10 | duduk, kanun. loop.wav | muri_kuri | duduk + kanun | unknown | *unverified* | *unverified* | Freesound | idx | 6, 11 |
| C11 | Hüzzam Kanun Taksim | Ehl-i Keyif (Georgi "Chubry" Dimitrov, kanun) | kanun | **Hüzzam** | 2:41 | **CC BY-NC-SA** | FMA / Bandcamp / IA | idx | 5, 24 |
| C12 | Karcığar Ud Taksim | Ehl-i Keyif (Koray Yalçın, ud) | ud | **Karcığar** | *unverified* | **CC BY-NC-SA** | FMA / Bandcamp / IA | idx | 16, 17, 7 |
| C13 | Anadolu Kavağı | Turku, Nomads of the Silk Road | saz, ud, percussion | unknown | *unverified* | CC BY (per FMA album) | FMA / IA | idx | 8, 6 (lively) |
| C14 | Ibn Al-Noor (alt: Desert City) | Kevin MacLeod | sampled/synth "Middle Eastern" | 12-TET, not a makam | 3:38 (Desert City 1:29) | CC BY 4.0 (Desert City: CC BY 3.0) | incompetech | idx | fallback only |
| C15 | Solo on kanoon [qanun] | Bedros Haroutunian, rec. Sidney Robertson Cowell (1939) | kanun | unknown | *unverified* | "no known US copyright" (LoC statement, not a licence) | Library of Congress | idx | 9, 15 (historic colour) |
| C16 | Tanburi Cemil Bey – Şevk-efza Gazel | Tanburi Cemil Bey (1873–1916) | tanbur (+ voice?) | Şevk-efza | 0:30 | PD by age (file page unverified) | tr.wikipedia file | idx | 1, 5 (historic colour) |
| C17 | WoodenYaylıTanbur recording | Dr. Ozan Yarman | yaylı tanbur | unknown | 0:33 | **CC BY-SA 3.0** | Commons | idx | 3, 12 |
| C18 | Medina Lights – Soft Oud & Kanun | djovan | ud + kanun | Arabic style | 1:29 | Pixabay Content License | Pixabay | idx | 14, 18 |
| C19 | Heritage Echoes (1) | Mohamed_hassan | "ud, ney, kanun" (**AI-generated**) | n/a | 1:30 | Pixabay Content License | Pixabay | idx | not recommended |

Counts by licence (19 candidates): CC BY **8** (C1–C8), CC BY by album listing **1** (C13), CC BY library music **1**
(C14), CC BY-NC **1** (C9), CC BY-NC-SA **2** (C11, C12), CC BY-SA **1** (C17), public domain / no known restrictions
**2** (C15, C16, both need a check), Pixabay licence **2** (C18, C19), licence unknown **1** (C10). None is verified CC0.

## Candidates

All previews: **preview not fetched (host blocked).** Durations and sizes are from search snippets.

### Freesound: the CompMusic field recordings by xserra (CC BY)

Xavier Serra (Freesound user `xserra`, head of the MTG / CompMusic project at UPF Barcelona) recorded Istanbul makam
musicians in February 2011 with a Sony PCM-D50 for the pack
[turkish music](https://freesound.org/people/xserra/packs/7862/). Each page's description ends in the Freesound
"Attribution" wording ("free to share and remix as long as you credit the author"). Uploads from 2011 are usually
**CC BY 3.0**, while C7 was listed as **Attribution 4.0**. The exact version must be read from each page's licence
badge. These are the strongest *permissive* leads: real players, quiet rooms, a good recorder, no vocals. The unknowns
are length (several may be short demonstrations rather than full taksims) and makam.

Credit line: CC BY asks us to credit the author (the uploader, xserra), and we name the performer too, for respect.

#### C1 · Ruhi-Ayangil-Kanun-1.wav
- **Source:** https://freesound.org/s/115223/ · licence: badge on that page (*unverified*: "Attribution").
- **Performer / author:** Ruhi Ayangil (kanun soloist, composer, conductor), recorded in his Istanbul studio,
  18 Feb 2011, by xserra.
- **Instrument / makam:** kanun solo; makam unknown (listen). **Format:** WAV 44.1 kHz; duration and size *unverified*.
- **Attribution (TR):** `Müzik: Ruhi Ayangil, kanun — kayıt: xserra / Freesound (CC BY 3.0)`.
- **Fits:** 1 *Bu Şehr-i Sitanbul* (awe), 20 *Gökten Asılı Kubbe*, 21 *Sis Kalkınca*: a kanun from one of the
  instrument's masters, which suits the panoramic moments.
- **Risks:** may be a short demonstration of the instrument's range rather than a phrase; studio chatter possible.
- Preview not fetched (host blocked).

#### C2 · Ruhi-Ayangil-Kanun-2.wav
- **Source:** https://freesound.org/people/xserra/sounds/115224/ · same session and licence family as C1.
- Same notes as C1. Taking both gives two kanun phrases from one player for a round of variations.
- **Attribution (TR):** `Müzik: Ruhi Ayangil, kanun — kayıt: xserra / Freesound (CC BY 3.0)`.
- Preview not fetched (host blocked).

#### C3 · Segah-Ney.wav
- **Source:** https://freesound.org/people/xserra/sounds/115614/ · licence: "Attribution" (version *unverified*).
- **Performer:** a ney maker of the SegahNey workshop (Izmir) playing a ney made by Ergin Karabulut; 26 Feb 2011.
- **Instrument / makam:** ney solo. "Segah" is the shop's name, so the makam is **unknown** (listen).
- **Format:** WAV 44.1 kHz 16-bit stereo, **1:04.3, 10.8 MB**.
- **Attribution (TR):** `Müzik: Segah-Ney — SegahNey atölyesi (İzmir), kayıt: xserra / Freesound (CC BY 3.0)`.
- **Fits:** 3 *Hoşça Bak Zâtına* (Mevlevi ney colour at the Galata Mevlevihanesi), 20 *Gökten Asılı Kubbe*
  (suggested Segah), 12 *Bir Günün Sonunda Arzu*. A minute of solo ney covers a 30–60 s moment without a loop.
- **Risks:** shop ambience; possibly a test-blow rather than a composed phrase.
- Preview not fetched (host blocked).

#### C4 · ney.wav (Hamza Zeytinoğlu)
- **Source:** https://freesound.org/people/xserra/sounds/115398/ · "Attribution" (version *unverified*).
- **Performer:** Hamza Zeytinoğlu (plays "practically all Turkish instruments"), his Istanbul apartment, 20 Feb 2011.
- **Instrument / makam:** ney; makam unknown. Duration and size *unverified*.
- **Attribution (TR):** `Müzik: Hamza Zeytinoğlu, ney — kayıt: xserra / Freesound (CC BY 3.0)`.
- **Fits:** 3, 11 *Elhân-ı Şitâ* (hushed), 12. A second ney voice alongside C3.
- **Risks:** length unknown, room sound. Note: the other xserra "Ney.wav" (115222, a Beyoğlu music shop) is only
  **0:19.8**, too short for a bed.
- Preview not fetched (host blocked).

#### C5 · oud.wav (Hamza Zeytinoğlu)
- **Source:** https://freesound.org/people/xserra/sounds/115399/ · "Attribution" (version *unverified*).
- **Performer / date:** Hamza Zeytinoğlu, Istanbul, 20 Feb 2011. **Instrument:** ud; makam unknown; length *unverified*.
- **Attribution (TR):** `Müzik: Hamza Zeytinoğlu, ud — kayıt: xserra / Freesound (CC BY 3.0)`.
- **Fits:** warm moments: 7 *Kâtibim* (Nihavend if the phrase allows), 14 *Mehtap Âlemleri*, 18 *Haritada Bir Nokta*.
- **Risks:** length unknown.
- Preview not fetched (host blocked).

#### C6 · tanbur.wav (Hamza Zeytinoğlu)
- **Source:** https://freesound.org/people/xserra/sounds/115400/ · "This work is licensed under the Attribution
  License" (snippet; version *unverified*).
- **Instrument:** tanbur (fretted long-neck lute of Ottoman classical music); makam and length unknown.
- **Attribution (TR):** `Müzik: Hamza Zeytinoğlu, tanbur — kayıt: xserra / Freesound (CC BY 3.0)`.
- **Fits:** 5 *Pîr-i Mi'mârân Sinan* and 24 *Eyüp'e Doğru* (elegiac, suggested Hüzzam), 3 *Hoşça Bak Zâtına*. The
  tanbur is the most "Ottoman court" sound in the list.
- Preview not fetched (host blocked).

#### C7 · Selcuk-Sipahioglu-1.wav
- **Source:** https://freesound.org/people/xserra/sounds/126099/ · **CC BY 4.0** (per snippet) —
  https://creativecommons.org/licenses/by/4.0/
- **Performer:** Selçuk Sipahioğlu, tanbur; recorded in Ankara, 7 Jun 2011.
- **Format:** WAV 44.1 kHz 16-bit stereo, **1:02.0, 10.4 MB**. Makam unknown.
- **Attribution (TR):** `Müzik: Selçuk Sipahioğlu, tanbur — kayıt: xserra / Freesound (CC BY 4.0)`.
- **Fits:** melancholic: 10 *Yağmur* (Tevfik Fikret), 12 *Bir Günün Sonunda Arzu*, 5.
- **Risks:** few; the best-documented permissive candidate. Note the page URL carried `?flag=1` in the index, which is
  harmless.
- Preview not fetched (host blocked).

#### C8 · ussak_cesni_kemence.wav
- **Source:** https://freesound.org/people/ajaysm/sounds/194700/ · "Attribution" (version *unverified*).
- **Performer:** Neva Günaydın, kemençe; recorded by Ajay Srinivasamurthy (CompMusic) at the Galata Electroacoustic
  Orchestra programme, Genova, 17 Jul 2013.
- **Makam:** **Uşşak** çeşni (a characteristic motif). Same uploader: "Scale of Ussak Makam" (194639).
- **Attribution (TR):** `Müzik: Neva Günaydın, kemençe (Uşşak çeşnisi) — kayıt: ajaysm / Freesound (CC BY 3.0)`.
- **Fits:** 2 *Sâdâbâd'a Gidelim* and 18 *Haritada Bir Nokta* (both suggested Uşşak), as a short texture or a
  closing-card sting, not a full bed.
- **Risks:** almost certainly a few seconds long; a scale is not music.
- Preview not fetched (host blocked).

### Freesound: other uploaders

#### C9 · kanun_taksimi.mp3
- **Source:** https://freesound.org/people/taner2011/sounds/128863/ · **CC BY-NC 3.0** (snippet: "Attribution
  Noncommercial") — https://creativecommons.org/licenses/by-nc/3.0/
- **Author:** taner2011 (uploaded 22 Sep 2011; "the voice of an instrument used in Turkish art music").
- **Format:** MP3 128 kbps 44.1 kHz stereo, **1:29.2, 1.4 MB**. Makam unknown.
- **Attribution (TR):** `Müzik: kanun taksimi — taner2011 / Freesound (CC BY-NC 3.0)`.
- **Fits:** a real 90 s kanun taksim, the right length for the longest moments: 5, 24, 14.
- **Risks:** **NC (owner decision)**; 128 kbps MP3 (acceptable for a quiet bed); authorship: it is unclear whether
  taner2011 is the player or re-uploaded someone's recording (check the description).
- Preview not fetched (host blocked).

#### C10 · duduk, kanun. loop.wav
- **Source:** https://freesound.org/people/muri_kuri/sounds/690455/ · licence **unverified** (not in any snippet).
- **Author:** muri_kuri. **Instruments:** duduk and kanun, cut as a loop.
- **Fits:** 6 *Yol Oldu Üsküdar'a* and 11 *Elhân-ı Şitâ* (wintry, spacious), *if* it is CC0/CC BY.
- **Risks:** licence unknown; duduk is Armenian rather than Ottoman classical colour; may be a sample-library
  construction (check that the uploader owns it).
- Preview not fetched (host blocked).

### Free Music Archive and netlabels

#### C11 · Hüzzam Kanun Taksim — Ehl-i Keyif
- **Source:** https://freemusicarchive.org/music/Ehl-i_Keyif/ (album *Ehl-i Keyif*, 11 tracks), mirrored at
  https://chubry.bandcamp.com/album/ehl-i-keyif and https://archive.org/details/Ehl-i_Keyif-20300 .
- **Licence:** **CC BY-NC-SA** (FMA artist page; version *unverified*, most likely 4.0 —
  https://creativecommons.org/licenses/by-nc-sa/4.0/).
- **Performers:** Ehl-i Keyif, a trio: Georgi "Chubry" Dimitrov (kanun), Koray Yalçın (ud), Myrto Palamas (bendir).
- **Makam:** **Hüzzam**, solo kanun taksim, **2:41**. Format on FMA: MP3 (bitrate *unverified*, usually 320 kbps).
- **Attribution (TR):** `Müzik: Hüzzam Kanun Taksim — Ehl-i Keyif (Georgi Dimitrov, kanun) (CC BY-NC-SA 4.0)`.
- **Fits:** exactly the makam suggested for 5 *Pîr-i Mi'mârân Sinan* and 24 *Eyüp'e Doğru*. A taksim is unmetered,
  so it can be cut at any phrase end and fades naturally.
- **Risks:** **NC + SA (owner decision)**. SA means our trimmed or faded file is also BY-NC-SA. The alternative is to
  ask Chubry/Ehl-i Keyif for permission (they publish openly and study makam music, so they are likely to agree).
- **Other tracks on the album** (same licence, more rhythmic, less suited to a bed): *Hüzzam Saz Semaisi "Nargile"*,
  *Karcığar Peşrev* (Tatyos Efendi, composition PD), *Rast Zeybek*, *Nihavent Longa*, *Nihavent Oyun Havası*,
  *Hicazkâr "Yağcılar" Zeybek*. They give Rast, Nihavend and Hicaz colour if the owner accepts NC-SA.
- Preview not fetched (host blocked).

#### C12 · Karcığar Ud Taksim — Ehl-i Keyif
- **Source / licence / performers:** as C11 (ud: Koray Yalçın). **Makam:** **Karcığar**; duration *unverified*.
- **Attribution (TR):** `Müzik: Karcığar Ud Taksimi — Ehl-i Keyif (Koray Yalçın, ud) (CC BY-NC-SA 4.0)`.
- **Fits:** 16 *Kuyrukluyıldız* (suggested Karcığar), 17 *Şehrin Temennileri*, 7 *Kâtibim*: a warm ud voice.
- **Risks:** NC + SA as C11.
- Preview not fetched (host blocked).

#### C13 · Anadolu Kavağı — Turku, Nomads of the Silk Road
- **Source:** https://freemusicarchive.org/music/Turku_Nomads_of_the_Silk_Road/Alleys_of_Istanbul/04_-Anadolu_Kavagi
  (album *Alleys of Istanbul*, also https://archive.org/details/Alleys_of_Istanbul-20263).
- **Licence:** **CC BY** per the FMA album listing (version *unverified*); the band's other album mixes CC BY and
  BY-NC-SA, so check this track's badge.
- **Performers:** Turku (US-based ensemble: several saz, violin, ud, tar, davul, dümbek). Listed as instrumental.
- **Attribution (TR):** `Müzik: Anadolu Kavağı — Turku, Nomads of the Silk Road (CC BY 4.0)`.
- **Fits:** 8 *Atı Alan Üsküdar'ı Geçti* (folk, humorous, suggested Hüseynî), 6. It is named after the Bosphorus
  village, a nice nod.
- **Risks:** folk ensemble with percussion, probably too busy for a subtitle bed; most other album tracks are songs
  with vocals (*Misket*, *Yeşilim*, *Maçka Yolları*).
- Preview not fetched (host blocked).

### Library music

#### C14 · Ibn Al-Noor (alt: Desert City) — Kevin MacLeod
- **Source:** incompetech.com (track pages blocked; see https://incompetech.com/music/royalty-free/music.html).
- **Licence:** **CC BY 4.0** (incompetech's current licence; older copies say 3.0).
- **Details:** *Ibn Al-Noor* 3:38, calm "cinematic"; *Desert City* 1:29, "Middle Eastern atmospheric, sort of chill",
  percussion and dulcimer, easy to loop.
- **Attribution (TR):** `Müzik: Ibn Al-Noor — Kevin MacLeod (incompetech.com) (CC BY 4.0)`.
- **Fits:** fallback only. It is sampled library music in equal temperament: no makam, no Turkish instruments, and a
  generic "Arabian" cliché. Many players will recognise it from YouTube.
- **Risks:** authenticity. The licence is clean.
- Preview not fetched (host blocked).

### Historic and public-domain recordings

#### C15 · Solo on kanoon [qanun] — Bedros Haroutunian (1939)
- **Source:** https://www.loc.gov/item/2017701996/ (related: "Taksim and wedding dance" on kemençe,
  https://www.loc.gov/item/2017701993 ; tuning and scale demonstrations 2017701997–2017701999).
- **Collection:** *California Gold: Northern California Folk Music from the Thirties*, WPA California Folk Music
  Project, recorded by Sidney Robertson Cowell in Fresno, 22 Apr 1939.
- **Rights statement:** "The Library of Congress is not aware of any U.S. copyright protection" for the collection,
  with the caveat that privacy/publicity rights and rights "in the underlying works" may apply
  (https://www.loc.gov/collections/sidney-robertson-cowell-northern-california-folk-music/about-this-collection/).
  **This is not a licence** (owner decision). A taksim's underlying work is the player's own improvisation. Haroutunian's
  dates are unknown, so the risk is low but not zero.
- **Instrument:** kanun, "Armenian and Armeno-Turkish music". Duration and format *unverified* (LoC usually offers
  MP3 and WAV).
- **Attribution (TR):** `Müzik: Solo on kanoon — Bedros Haroutunian, kayıt: Sidney Robertson Cowell, 1939 (Library of Congress, bilinen telif kısıtlaması yok)`.
- **Fits:** historic colour for 9 *Karagöz ile Hacivat* and 15 *Çamlıca Bahçesi*.
- **Risks:** 1939 acetate-disc field recording, with surface noise and a narrow band; it would need denoising, as the
  gull recordings did.
- Preview not fetched (host blocked).

#### C16 · Tanburi Cemil Bey — Şevk-efza Gazel (30 s excerpt)
- **Source:** https://tr.wikipedia.org/wiki/Dosya:Tanburi_Cemil_Bey_-_Sevk._Efza_Gazel.ogg (Ogg Vorbis, **0:30,
  45 kbps, 164 KB**).
- **Licence:** *unverified* on the page. By age it should be public domain: Tanburi Cemil Bey died in 1916 (so the
  composition and improvisation are PD everywhere at life + 70), and his discs date from about 1910–14 (US PD as a
  pre-1923 recording; the Turkish phonogram rights of 70 years from fixation have expired). A modern restoration (e.g.
  a Kalan or Traditional Crossroads remaster) could carry its own claim in some countries, so the file page's source
  matters.
- **Attribution (TR):** `Müzik: Şevk-efza Gazel — Tanburi Cemil Bey (y. 1910–1914) (kamu malı)`.
- **Fits:** the most "Istanbul" voice in this list (the great tanbur and kemençe master): 1, 5, and a closing card
  about Ottoman music.
- **Risks:** a *gazel* is normally sung, so there is probably a voice (check); acoustic-era noise; only 30 s.
  Better Cemil Bey instrumental taksims (Hüzzam, Segah on kemençe) exist on commercial reissues only (Apple Music,
  Kalan), which is not usable. A clean PD transfer of those would be ideal: a lead for the owner.
- Preview not fetched (host blocked).

### Wikimedia Commons

#### C17 · WoodenYaylıTanbur recording Dr. Ozan Yarman
- **Source:** https://commons.wikimedia.org/wiki/File:WoodenYayl%C4%B1Tanbur_recording_Dr._Ozan_Yarman.ogg
  (sister file: *CumbusTanbur recording Dr. Ozan Yarman.ogg*, 0:30; category
  https://commons.wikimedia.org/wiki/Category:Yayl%C4%B1_tambur).
- **Licence:** **CC BY-SA 3.0** — https://creativecommons.org/licenses/by-sa/3.0/
- **Performer:** Dr. Ozan Yarman (makam theorist), bowed tanbur. **Format:** Ogg Vorbis, **0:33, 286 KB**.
- **Attribution (TR):** `Müzik: Yaylı tanbur — Dr. Ozan Yarman / Wikimedia Commons (CC BY-SA 3.0)`.
- **Fits:** 3, 12: bowed tanbur is ney-like and inward.
- **Risks:** **SA (owner decision)**; the player calls himself an amateur on this instrument; 33 s is short; possibly
  a tuning demonstration (the related YouTube video concerns his 24-tone fretting).
- Preview not fetched (host blocked).

### Pixabay (flagged, not recommended)

The [Pixabay Content License](https://pixabay.com/service/license-summary/) is not CC. It allows use in projects with
no attribution, but forbids distributing the content "on a standalone basis" and registering it with Content ID. The
game ships audio as separate files in a public repository, which is a grey zone. Many new Pixabay "Turkish" tracks are
AI-generated, and the owner's intent (credit and respect a real musician) does not apply to those.

#### C18 · Medina Lights – Soft Oud & Kanun — djovan
- **Source:** Pixabay search https://pixabay.com/music/search/oud/ (track page URL not in the index). **1:29.**
- **Attribution (TR):** `Müzik: Medina Lights — djovan / Pixabay (Pixabay İçerik Lisansı)`.
- **Fits:** 14, 18 (soft). **Risks:** licence class; "Maghreb" tag, so an Arabic rather than Turkish idiom; AI
  generation not ruled out.
- Preview not fetched (host blocked).

#### C19 · Heritage Echoes (1) — Mohamed_hassan
- **Source:** https://pixabay.com/music/folk-heritage-echoes-1-340292/ · **1:30** · Pixabay Content License.
- **Page says "AI Generated"** (tags: Turkish, Oud, Ney, Kanun, Maqam; published 13 May 2025).
- Listed only to show the problem: no performer to credit, no real makam practice behind it. **Not recommended.**
- Preview not fetched (host blocked).

### Considered and rejected

| Item | Why rejected |
|---|---|
| Ahmet Djewdet (Ahmet Cevdet Çağla), *Taxim Hicaz*, Polydor c. 1928 — [FMA](https://freemusicarchive.org/music/Ahmet_Djewdet/single/Taxim_Hicaz/) | FMA shows CC BY-NC, but it was uploaded by a record collector (Excavated Shellac), not the rights holder. Çağla died in 1988 (his improvisation is protected in Turkey until 2058), and US protection of a 1928 recording runs to 2029. That licence cannot be relied on. The page can still be a link. |
| Udi Hrant, *Sabah Taksim* 78 rpm — [archive.org](https://archive.org/details/78_sabah-taksim-oud-ile-hrand_gbia0406960b) | Great 78 Project preservation transfer with no licence; Hrant Kenkulian died in 1978. Link only. |
| Sherita, *Oud Taksim / Batan Gün Kana* — FMA | CC BY-NC-**ND**: no edits allowed. |
| TimTaj, *Arabic / Arabian / Middle Eastern Oud* — FMA | CC BY-NC-ND; also Arabic idiom. |
| Serge Quadrado, *Duduk and Ney* — FMA | CC BY-NC (could move to the NC group), but duduk plus "Islamic" library style. |
| frozenmusics, *Istanbul.wav* (Freesound 395673, 3:51) | CC BY-NC 3.0; a mosque ambience, not music. |
| archive.org "Taquasim 3oud", "Şiirler İçin Fon Müzikleri 2019", "Ali Tan Bayâti Taksim" | User uploads of commercial recordings (rips) with no rights statement. |
| Gallica *Hedjazguiar Taxim Tambour* (Mesut Cemil) | Mesut Cemil died in 1963 (protected until 2033); Gallica allows non-commercial reuse only by its own terms. |
| Tanburi Cemil Bey / Neyzen Tevfik / Artaki Candan on Kalan, Traditional Crossroads, Canary, Honest Jon's | Commercial reissues. Link only ("Orijinalini dinle"). |
| SoundCloud / Spotify / YouTube taksims (Kudsi Erguner, Mustafa Dedeoğlu, Aytaç Doğan, Osman Öksüzoğlu …) | Standard copyright. Link or an official YouTube embed in the source sheet only. |
| Igor Marynowski, *Rast Saz Semai*, *Dawn in the Valley (Ney & Kaval)* — FMA | Licence not in any snippet; titles read like generated library music. Recheck if the owner wants. |
| Musopen, ccMixter, Jamendo, Europeana | Nothing Turkish-classical found through the index (Musopen is Western classical; Jamendo only had Ben OThman's Arabic "Oud" tracks, licence unknown). |

## Recommendation

**The cleanest set (CC BY only, needs only the owner's approval):**

1. **C1/C2 Ruhi Ayangil, kanun** — the master kanun voice for the awe and panorama moments (1, 20, 21).
2. **C3 Segah-Ney** — 64 s of solo ney for the Mevlevi and suspended-dome moments (3, 20).
3. **C7 Selçuk Sipahioğlu, tanbur (CC BY 4.0)** — the melancholic bed (10, 12, 5).
4. **C5 Hamza Zeytinoğlu, ud** — the warm bed (7, 14, 18).

**Plus, if the owner accepts NC-SA (or better, gets Ehl-i Keyif's permission):**

5. **C11 Hüzzam Kanun Taksim** — the only verified-makam calm solo, and exactly the Hüzzam suggested for 5 and 24.
6. **C12 Karcığar Ud Taksim** — Karcığar for 16, a second warm ud.

**Makam coverage and the gap.** The only named makams are Hüzzam (C11), Karcığar (C12) and an Uşşak motif (C8). The
xserra recordings have no makam in their descriptions, so their makam can only be learned by listening. **No
permissively licensed, calm, solo Rast, Hicaz, Nihavend, Kürdi or Segah taksim was found through the search index.**
Freesound's own search (filter "Creative Commons 0" or "Attribution"; queries *taksim, taksimi, kanun, ud, oud, ney,
tanbur, kemençe, hicaz, rast, nihavent, segah, kürdi, uşşak, makam*) is the most promising next step and was
impossible from here. I recommend one more pass from a machine that can reach freesound.org, commons.wikimedia.org
and archive.org before the owner decides. Note: moment makams are moods, not requirements
(`.docs/moments/candidates.md`), so a tanbur or ney taksim in a neighbouring makam is fine for most moments.

Integration idea (after approval, not done): cut 30–90 s at phrase ends, fade in over 2 s and out over 4 s under the
closing card, duck under the subtitles, and loop only unmetered taksims (crossfade at a silence). Store the files in
`public/audio/music/` and record them in `public/audio/LICENSES.md` and `tools/assets/approved.json`.

## What the owner must decide

1. **Approve any of C1–C8 (CC BY)** after listening on the Freesound pages (check length, makam and the licence badge
   version).
2. **NC:** accept CC BY-NC / BY-NC-SA tracks (C9, C11, C12) while the game is non-commercial, knowing they must be
   removed before any monetization. Or ask Ehl-i Keyif (via chubry.bandcamp.com) for a written permission.
3. **SA:** accept CC BY-SA (C17, and C11/C12 via NC-SA), which makes our edited audio files share-alike.
4. **No-licence public domain:** accept C15 (LoC "no known restrictions") and C16 (PD by age; the file page's source
   and licence must be checked, and whether it has a voice).
5. **Pixabay:** reject C18/C19 (my recommendation) or accept the Pixabay licence for C18 after checking it is not
   AI-generated.
6. **Unverifiable here** (every page, but especially): C10 (licence unknown), C13 (track badge), C14 (version), the
   exact CC versions of C1–C6 and C8, and all durations marked *unverified*.
7. Whether to run a second search pass from an unblocked machine to fill Rast / Hicaz / Nihavend / Kürdi / Segah.
