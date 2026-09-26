# Moment candidates: literature, songs, inscriptions and travellers

Research for the "Anlar" system (phase 19, `.docs/planning/19-moments.md`), 26 September 2026. The owner asked for
20–25 candidates "like the Orhan Veli poem": a quote from a book, a poem or another literary genre, all mixed. Each one
plays as timed Turkish subtitles (4–8 lines, about 4 s each) while the player glides or perches at a matching place,
then shows a closing card. Kanun/ud music is planned; a makam is suggested for each.

This file was the shortlist. The owner delegated the choice; ten candidates were chosen on 26 September 2026 and built
as records (see "Chosen and built" below). The rest stay here as ideas.

## Chosen and built (26 September 2026)

Chosen for variety of place, mood, genre and time, and for a low rights risk. Records: `src/moments/data/literature.ts`
(backlog item 16 in `.docs/planning/19-moments.md`), sources in `src/moments/data/sources.ts`. All are subtitle-only;
the moment music picks a piece by category and `musicMood`. Each opens with `?moment=<id>`.

| # | Record id | Plays? | Place and trigger as built | Text status |
|---|---|---|---|---|
| 1 | `nedim-bu-sehr-i-sitanbul` | yes | 250–600 m ASL within 900 m of Sarayburnu, 07–11 h, clear or haze | Two couplets; Vikikaynak, liseedebiyat.com and yedinota.com give the same words (transliteration differs) |
| 5 | `sinan-turbe-kitabesi` | **no, pending** | Within 200 m of the tomb (any surface, ≤ 90 m AGL and ≤ 170 m ASL), 16:30–20:30, clear or haze | Lines 1–4 have one source (every online copy goes back to one transcription); the TDV quotes the date line differently |
| 7 | `katibim-uskudar-yagmur` | yes | ≤ 80 m AGL within 450 m of Üsküdar square, rain | Traditional; Vikikaynak text, same words in the TSM listing |
| 8 | `ati-alan-uskudari-gecti` | yes | Diving (the fallback) over the strait mouth between Sarayburnu and Üsküdar, ≤ 250 m AGL, 06–21 h, not in a storm | Our retelling (MIT) |
| 9 | `karagoz-sehzadebasi` | yes | ≤ 60 m AGL within 250 m of Şehzadebaşı Caddesi, 20–24 h | Traditional opening and closing formulas (liseedebiyat.com, Türk Maarif Ansiklopedisi) plus our dialogue |
| 10 | `fikret-yagmur-asiyan` | yes | Within 300 m of Aşiyan (any surface, ≤ 80 m AGL), rain | First seven lines; turk-siiri.com and Milliyet give the same text, two more sites the same words |
| 12 | `hasim-bir-gunun-sonunda-arzu` | **no, pending** | Göksu fallback: gliding ≤ 35 m AGL over the Bosphorus off the Göksu mouth, 17–20:30 h, clear or haze | Versions disagree (the first print has a line the later text lacks) |
| 16 | `huseyin-rahmi-kuyrukluyildiz` | yes | 150–900 m ASL within 1.3 km of Heybeliada, 22–04 h, clear | Four lines of dialogue; the TDK and Remzi editions give the same words; opening and closing lines ours |
| 20 | `prokopios-gokten-asili-kubbe` | yes | Gliding or flying 150–450 m ASL within 300 m of the dome, 10–16 h, clear or haze | Our translation (MIT) from Dewing's English of *Buildings* I.1.27–46 (LacusCurtius) |
| 21 | `de-amicis-sis-kalkinca` | yes | ≤ 90 m AGL over the Marmara within 1.6 km south of Sarayburnu, 05–11 h, sea fog ≥ 0.2 (a foggy morning or fog weather) | Our translation (MIT) of sentences confirmed on experiences.it and a second site |

Notes on the build:

- **#12 place.** Küçükçekmece Lake lies at the west edge of the map (28.72–28.77° E): the flight turns the dragon back
  beyond 28.752° E, and the lake is not water in the game's geography. The Göksu stream is too narrow to be water, so
  the record uses the Bosphorus in front of the Göksu mouth, under Anadolu Hisarı.
- **#21 trigger.** Foggy mornings (`src/render/weather/sea-fog.ts`) usually come with the `clear` or `haze` preset,
  so the record format got a `seaFog` condition (the sea fog amount, read from the weather service).
- **#8** uses the diving fallback; a real speed or crossing-time condition is still future work.
- **Category.** All of them except #8 (a folk tale: `legend`) are in the `poem` category, whose player-facing name is
  now "Şiir ve edebiyat" / "Edebiyat".

**What the owner must check for the two pending records** (they play once the wording is confirmed, `pending` is
cleared and `text-approval` removed from `needs`):

- **#5 Sinan:** read lines 1–4 ("Ey iden bir iki gün dünyâ sarayında mekân" … "Yapdı bir câmi' verir Firdevs-i âlâdan
  nişân") and the date line against the stone or a critical reading (the Karadeniz Sosyal Bilimler Dergisi article
  "Mimar Sinan Türbesi Üzerine Bir Değerlendirme", or Sâî, *Tezkiretü'l-Bünyân*, Koç 2004). Open points: "Geçdi" or
  "Göçdü"; "mi'mârân-ı Sinân" (Dünya Bülteni transcription) or "mi'mârân Sinân" (TDV, fits the metre); the spellings
  "olub", "Yapdı".
- **#12 Haşim:** choose the version and read it against İnci Enginün, *Ahmet Haşim – Bütün Şiirleri* (Dergâh) or the
  1921 printing. The record uses the first print (Dergâh 1/1, 15 Nisan 1337/1921) as transcribed on Epigraf. Open
  points: whether line 7 "Üstümde semâ bir kavs-ı mutalsam!" belongs in the last stanza; line 2 "ilân." or "i'lân,";
  line 3 "bu akşam" or "her akşam"; line 4 "eyler?" or "eyler?.."; line 5 comma after "Akşam".

**Not chosen:** #13 and #18 (US copyright risk); #6, #11 and #17 (need snow); #14 (needs the moon phase); #3 and #4
(religious sensitivity); the rest overlap with the chosen ones (#2 with #1, #15 and #23 with #16 and #20, #19, #22,
#24 and #25 with #21).

## Rules used

- **Rights, Turkey (FSEK art. 27):** life of the author + 70 years. An author who died before 1 January 1956 is in the
  public domain in Turkey in 2026. Anonymous folk works (türkü, legends, proverbs, Karagöz formulas) are traditional.
- **Rights, United States** (the repository is on GitHub): works first published before 1 January 1931 are public
  domain in the US in 2026 (the owner's safe cutoff of 1929 is stricter still). A foreign work published in 1931 or later
  may have a restored US term (95 years from publication) even when it is free in Turkey. **US risk** marks those.
  Following the owner's decision for Orhan Veli, they get only a short excerpt (a first stanza or a few lines).
- **Foreign texts:** the original is public domain; every Turkish translation here is **our own draft** (existing
  published translations are usually still in copyright). Those entries are marked *needs our translation* and
  should be proofread before use.
- **Content:** calm and warm. No political or nationalist polemic, nothing religiously divisive, no violence. Religious
  words that are simply part of an old text (a fountain inscription asking for a prayer) are kept but flagged.
- **Not duplicated:** the existing records (Hezarfen, Lagari, Kız Kulesi legend, Aya Yorgi, ships over land 1453,
  storks, gull and simit, Galata anglers, Orhan Veli's "İstanbul'u Dinliyorum").
- **Lines:** each subtitle is 90 characters or fewer (README rule). Lines over 80 characters (three of them: #14
  line 5, #16 line 4, #24 line 7) need about 4.5 s on screen to stay under 20 characters per second. `[bizim]` marks a line we wrote (MIT) and that is
  not a quotation. `…` marks a cut inside the quoted text.

### How the texts were checked, and what is still open

The build container could not open the source pages: Wikisource/Vikikaynak, Project Gutenberg, archive.org and the
literary sites were all blocked by the egress proxy. Every quotation was checked **through search-engine excerpts of
those pages** (several independent hits where possible) and against what is known about the editions. That is good
enough for a shortlist, not for shipping. **Before a candidate becomes a record, its lines must be read against the
named edition** (the "Wording" note of each entry says what to check). Ottoman-era Turkish texts are given in the usual
Latin transliteration; spelling of long vowels (â, î, û) varies between editions.

### Trigger features the current format does not have

Several ideas below need a condition the record format (`src/moments/types.ts`) does not offer yet. Each entry gives a
fallback that works today.

- **Snow:** `WeatherPreset` has `clear | haze | fog | rain | storm`, no snow. Fallback: `seasons: ['winter']` with
  `fog` or `haze`.
- **Moon phase** (a "mehtap" night): not in the time state. Fallback: a night window.
- **Speed or crossing time** (a fast Bosphorus crossing): not a condition. Fallback: `flightModes: ['diving']` in a
  corridor, or a two-waypoint check in the runtime later.
- **"After a storm"** (weather sequence): not tracked. Fallback: morning window with `rain` or `haze`.

## Summary

Makam suggestions are moods for the future music, not claims about existing settings of the texts.

| # | Title (in game) | Genre | Author / source | Date | Place | Trigger idea | Mood | Makam (why) | Rights | US risk |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Bu Şehr-i Sitanbul | Divan poetry (kaside) | Nedim | c. 1720s | Sarayburnu, over the Seraglio point | air, 250–600 m ASL, morning, clear | awe | Rast: majestic, the "mother" makam, for a panoramic praise | PD (d. 1730) | none |
| 2 | Sâdâbâd'a Gidelim | Divan poetry (şarkı) | Nedim | c. 1720s | Kâğıthane (Sâdâbâd), head of the Golden Horn | glide < 60 m AGL over the creek, spring, afternoon | joyful | Uşşak: light, lyrical, Tulip Era şarkı feel | PD (d. 1730) | none |
| 3 | Hoşça Bak Zâtına | Divan poetry (müseddes) | Şeyh Galib | late 18th c. | Galata Mevlevihanesi (Kulekapı) | ground (perched) within 120 m, dusk 18–21 h | contemplative | Segah: ney and Mevlevi colour, inward | PD (d. 1799) | none |
| 4 | Aç Besmeleyle İç Suyu | Inscription (tarih beyti) | Sultan Ahmed III | 1728 (1141 H) | III. Ahmed Çeşmesi, Bab-ı Hümayun, Sultanahmet | ground within 80 m, summer, 11–16 h | warm, playful | Mahur: bright, open daylight | PD (d. 1736) | none |
| 5 | Pîr-i Mi'mârân Sinan | Inscription (türbe kitabesi) | Sâî Mustafa Çelebi | 1588 (996 H) | Mimar Sinan türbesi, Süleymaniye | ground within 100 m, sunset 17–20 h | elegiac | Hüzzam: bittersweet, for a farewell at dusk | PD (d. 1595) | none |
| 6 | Yol Oldu Üsküdar'a | Chronicle + tarih mısraı | Peçevi / poet Hâşimî (our retelling) | 1621 (1030 H) | Bosphorus between Üsküdar and Beşiktaş | low glide over water, winter (snow later) | wonder, light humour | Acemkürdî: cool, glassy, wintry | PD (17th c.) | none |
| 7 | Kâtibim | Folk song (türkü) | Anonymous | traditional | Üsküdar shore and square | air < 80 m AGL, rain | playful | Nihavend: the song's own makam, the ud can hint the tune | traditional | none |
| 8 | Atı Alan Üsküdar'ı Geçti | Proverb + folk tale (retold) | Traditional (Köroğlu cycle) | traditional | Eminönü → Üsküdar crossing | diving across the strait corridor | humorous | Hüseynî: folk and âşık colour of the Köroğlu tales | traditional; retelling ours | none |
| 9 | Perde: Karagöz ile Hacivat | Shadow theatre | Traditional formulas + our dialogue | traditional | Şehzadebaşı (Direklerarası) | air < 60 m AGL, night 20–24 h | humorous | Hicaz: classic Ottoman stage and street entertainment | traditional; dialogue ours | none |
| 10 | Yağmur | Modern poetry (Servet-i Fünun) | Tevfik Fikret | 1890s (in *Rübab-ı Şikeste*, 1900) | Aşiyan, Rumelihisarı | ground or hover near the house, rain | melancholic | Kürdilihicazkâr: modern melancholy, rain on glass | PD (d. 1915) | none |
| 11 | Elhân-ı Şitâ | Modern poetry (Servet-i Fünun) | Cenap Şahabettin | 1897 | Moda, Kadıköy | air, winter, fog/haze (snow later) | hushed wonder | Acemaşiran: soft, spacious, for falling snow | PD (d. 1934) | none |
| 12 | Bir Günün Sonunda Arzu | Modern poetry | Ahmet Haşim | 1921 | Küçükçekmece Lake reeds (fallback: Göksu) | glide < 30 m AGL over the lake, sunset | melancholic | Saba: the deepest dusk sorrow | PD (d. 1933) | none |
| 13 | Hürriyete Doğru | Modern poetry (Garip) | Orhan Veli Kanık | 1949 (*Karşı*) | Rumelifeneri fishing harbour (fallback: Sarıyer) | low glide over sea, dawn 5–7 h | joyful, free | Rast: bright morning | PD in TR (d. 1950) | **yes** (1949) |
| 14 | Mehtap Âlemleri | Novel | Halit Ziya Uşaklıgil, *Aşk-ı Memnu* | 1899–1900 | Bosphorus off Kandilli–Göksu | low glide over water, night 21–2 h | romantic, nostalgic | Nihavend: late-Ottoman salon romance | PD (d. 1945) | none if the 1900–01 text is used |
| 15 | Çamlıca Bahçesi | Novel | Recaizade Mahmut Ekrem, *Araba Sevdası* | 1896–98 | Büyük Çamlıca hill | ground or hover, spring (May), afternoon | comic | Hicazkâr: 19th-century salon pomp | PD (d. 1914) | none |
| 16 | Kuyrukluyıldız | Novel | Hüseyin Rahmi Gürpınar, *Kuyruklu Yıldız Altında Bir İzdivaç* | 1912 | Heybeliada, over his house | air > 150 m, night 22–4 h, clear | humorous | Karcığar: playful, folk-urban wit | PD (d. 1944) | none |
| 17 | Şehrin Temennileri | Newspaper letters (chronicle) | Ahmet Rasim, *Şehir Mektupları* | 1897–99 | Golden Horn at Ayvansaray (Eyüp ferry line) | low over water near a ferry, winter | humorous | Kürdî: lively city song | PD (d. 1932) | none |
| 18 | Haritada Bir Nokta | Short story | Sait Faik Abasıyanık | 1952 (*Son Kuşlar*) | Burgazada, harbour and boats | low glide, morning, haze/fog | warm, wistful | Uşşak: intimate, sea-folk warmth | PD in TR (d. 1954) | **yes** (1952) |
| 19 | Körler Ülkesi | Ancient history | Herodotus, *Histories* 4.144 | c. 430 BC | Over the Bosphorus mouth, facing Kadıköy | air, sunset, heading east | witty | Neva: archaic, grave but light | PD | none (*needs our translation*) |
| 20 | Gökten Asılı Kubbe | Byzantine history | Procopius, *Buildings* I.1 | c. 550s | Over the Hagia Sophia dome | circling within 250 m, 150–400 m ASL, 11–15 h | awe | Segah: luminous, suspended | PD | none (*needs our translation*) |
| 21 | Sis Kalkınca | Travel writing | Edmondo De Amicis, *Costantinopoli* | 1877 | Sea of Marmara approach to Sarayburnu | low over water, fog, morning | awe | Suzinak: veiled, then bright | PD (d. 1908) | none (*needs our translation*) |
| 22 | Hayalin Kurduğu Venedik | Travel writing | H. C. Andersen, *En Digters Bazar* | 1842 | Marmara off Kumkapı–Yenikapı | low glide, morning 6–9 h, rain/haze | fairy-tale wonder | Kürdî: clearing sky, a tale's lightness | PD (d. 1875) | none (*needs our translation*) |
| 23 | Soylu Bir Tablo | Travel writing (humour) | Mark Twain, *The Innocents Abroad* | 1869 | High over the anchorage off Karaköy–Tophane | air > 300 m ASL, any clear day | humorous | Nikriz: quirky, a little ironic | PD (d. 1910) | none (*needs our translation*) |
| 24 | Eyüp'e Doğru | Novel / diary | Pierre Loti, *Aziyadé* | 1879 | Pera ridge over the Golden Horn → Eyüp | glide from Tepebaşı toward Eyüp, summer afternoon | nostalgic | Hüzzam: the Loti-at-Eyüp longing | PD (d. 1923) | none (*needs our translation*) |
| 25 | Belgrad Köyü'nden Mektup | Letters | Lady Mary Wortley Montagu, *Turkish Embassy Letters* | 1717 (publ. 1763) | Belgrad Forest, the old village site | glide < 60 m AGL over the forest, summer | idyllic | Mahur: bright pastoral | PD (d. 1762) | none (*needs our translation*) |

**By genre:** divan poetry 3 · inscriptions 2 · chronicle with a tarih line 1 · folk song 1 · proverb and folk tale 1 ·
shadow theatre 1 · modern poetry 4 · novels 3 (+ Loti) · short story 1 · newspaper letters 1 · ancient and Byzantine
history 2 · foreign travel writing 3 · novel/diary 1 (Loti) · letters 1. That is 25 in all.

**By place:** historic peninsula 6 (1, 4, 5, 9, 20, 21) · Golden Horn 4 (2, 3, 17, 24) · Bosphorus, European shore
and north 4 (10, 13, 23, 25) · Bosphorus water and Asian shore 6 (6, 7, 8, 14, 15, 19) · Kadıköy and Moda 1 (11) ·
islands 2 (16, 18) · Marmara and outskirts 2 (12, 22).

---

## 1. Bu Şehr-i Sitanbul (Nedim, kaside)

- **Place / trigger:** Sarayburnu (41.0165, 28.986), radius 900 m; `air`, 250–600 m ASL, 7–11 h, `clear | haze`.
  Once per session.
- **Excerpt** (the first two couplets of *Kaside der vasf-ı İstanbul ve sitâyiş-i Sadrazam İbrâhim Paşa*):
  1. Bu şehr-i Sitanbul ki bî-misl ü bahâdır
  2. Bir sengine yek-pâre Acem mülkü fedâdır
  3. Bir gevher-i yek-pâre iki bahr arasında
  4. Hurşîd-i cihân-tâb ile tartılsa sezâdır
- **Closing card:** "Nedim (1681?–1730), Lâle Devri'nin şairi. 'Eşsiz ve paha biçilmez bu İstanbul'un tek taşına
  bütün Acem ülkesi feda olsun; iki deniz arasında tek parça bir mücevher, güneşle tartılsa yeridir.'"
- **Sources:** Vikikaynak, *Kaside Der Vasf-ı İstanbul* (tr.wikisource.org/wiki/Kaside_Der_Vasf-ı_İstanbul);
  edebiyatgozlugu.com and siir.sitesi.web.tr (same text). Scholarly edition: Nedim Divanı (ed. Muhsin Macit).
- **Rights:** Nedim died 1730. Public domain everywhere. The modern gloss in the card is ours.
- **Wording:** "Sitanbul / Sıtanbûl" and "yekpâre / yek-pâre" vary by edition. The rest of the kaside praises the Grand
  Vizier. Use only these two couplets.

## 2. Sâdâbâd'a Gidelim (Nedim, şarkı)

- **Place / trigger:** Kâğıthane creek at the old Sâdâbâd grounds (≈ 41.073, 28.972), radius 500 m; `air`, < 60 m
  AGL, `gliding`; `seasons: ['spring']`, 13–18 h, `clear | haze`.
- **Excerpt** (first two stanzas, each ending in the refrain):
  1. Bir safâ bahşedelim gel şu dil-i nâşâda
  2. Gidelim serv-i revânım yürü Sa'dâbâd'a
  3. İşte üç çifte kayık iskelede âmâde
  4. Gidelim serv-i revânım yürü Sa'dâbâd'a
  5. Gülelim oynayalım kâm alalım dünyâdan
  6. Mâ-i Tesnîm içelim çeşme-i nev-peydâdan
  7. Görelim âb-ı hayât aktığın ejderhâdan
  8. Gidelim serv-i revânım yürü Sa'dâbâd'a
- **Closing card:** "Nedim bu şarkıyı Kâğıthane'deki Sâdâbâd için yazdı. 'Ejderhâdan akan âb-ı hayat' diye
  andığı, yeni çeşmelerin lülelerinden akan sudur. Bir ejderhanın bunu duyması şaşırtıcı sayılmaz."
- **Sources:** Vikikaynak, *Bir safa bahşedelim gel şu dil-i nâ-şâda*; insanvesanat.wordpress.com (musammat şarkı).
- **Rights:** PD. Seven lines are quoted; a short poem, so the full two stanzas are fine.
- **Wording:** "dil-i nâşâda / dili nâşâda", "Sa'dâbâd / Sâdâbâd" vary. Commentaries read "ejderhâ" as the
  dragon-shaped fountain spouts. The card says so without claiming more. "Mâ-i Tesnîm" (a spring of paradise) is a
  conventional image, not a religious statement.

## 3. Hoşça Bak Zâtına (Şeyh Galib)

- **Place / trigger:** Galata Mevlevihanesi, Kulekapı (≈ 41.0280, 28.9745), radius 120 m; `ground`, 18–21 h.
  Galib was the şeyh of this lodge and is buried there.
- **Excerpt:**
  1. Ey dil ey dil niye bu rütbede pür-gamsın sen
  2. Gerçi vîrâne isen genc-i mutalsamsın sen
  3. Hoşça bak zâtına kim zübde-i âlemsin sen
  4. Merdüm-i dîde-i ekvân olan âdemsin sen
- **Closing card:** "Şeyh Galib (1757–1799) bu dergâhın şeyhiydi ve burada yatıyor. 'Ey gönül, neden bu kadar
  kederlisin? Yıkık görünsen de tılsımlı bir hazinesin. Kendine iyi bak: evrenin özü, varlığın gözbebeğisin.'"
- **Sources:** turkedebiyati.org and art-isanat.com.tr (full text of the gazel/müseddes); Galib Divanı (ed. Muhsin
  Kalkışım).
- **Rights:** PD.
- **Wording:** lines 1–2 open the first stanza and lines 3–4 are the refrain couplet. The stanza's middle lines are
  skipped on purpose (they carry Qur'anic and Christian references). Mystical but universal; flag it for the owner
  only if Sufi vocabulary at a Mevlevi lodge is a concern.

## 4. Aç Besmeleyle İç Suyu (III. Ahmed Çeşmesi)

- **Place / trigger:** III. Ahmed Çeşmesi in front of Bab-ı Hümayun (≈ 41.0103, 28.9808), radius 80 m; `ground`;
  `seasons: ['summer']`, 11–16 h.
- **Excerpt:**
  1. `[bizim]` Bab-ı Hümâyun'un önünde, 1728'den beri akan bir çeşme.
  2. Târîhi Sultân Ahmed'in cârî zebân-ı lûleden
  3. Aç besmeleyle iç suyu Hân Ahmed'e eyle duâ
  4. `[bizim]` İkinci mısraın harfleri ebcedle toplanınca 1141 eder: çeşmenin yılı.
- **Closing card:** "Sultan III. Ahmed bu tarih beytini kendisi yazdı, hattını da kendi eliyle çizdi. Ebced
  hesabıyla 1141 (1728–29) yılını verir."
- **Sources:** kulturenvanteri.com (III. Ahmet Sebili ve Çeşmesi); Milliyet Cadde, "Aç besmeleyle iç suyu Han Ahmed'e
  eyle dua"; H. Aynur & H. T. Karateke, *III. Ahmed Devri İstanbul Çeşmeleri* (1995), the scholarly reading.
- **Rights:** PD (inscription on a public monument, author died 1736).
- **Wording:** the first line reads "Târîhi Sultân Ahmedin cârî zebân-ı lûleden" in one search source. Check it
  against Aynur & Karateke. The couplet asks the drinker to say the basmala and pray for the Sultan. It is a normal
  inscription formula, but it is flagged in case the owner prefers to avoid religious words.
- **Also on the fountain:** couplets by Nedim, Şâkir and Rahmî, a possible second moment later.

## 5. Pîr-i Mi'mârân Sinan (Sinan's tomb inscription)

- **Place / trigger:** Mimar Sinan türbesi at the north corner of the Süleymaniye complex (≈ 41.0170, 28.9635), radius
  100 m; `ground`, 17–20 h, `clear | haze`.
- **Excerpt:**
  1. Ey iden bir iki gün dünyâ sarayında mekân
  2. Cây-i asâyiş değildir âdeme milk-i cihân
  3. Hân Süleymân'a olub mi'mâr bu merd-i güzîn
  4. Yapdı bir câmi' verir Firdevs-i âlâdan nişân
  5. …
  6. Göçdü bu demde cihândan pîr-i mi'mârân Sinân
- **Closing card:** "Kitabeyi Sinan'ın dostu şair Sâî Mustafa Çelebi yazdı. Son mısra ebcedle 996'yı (1588)
  verir. Sinan'ın ölüm yılını bildiren tek belge budur."
- **Sources:** dunyabulteni.net, "Mimar Sinan'ın türbe kitabesi"; ozhanozturk.com; TDV İslâm Ansiklopedisi, "Sâî
  Mustafa Çelebi" and "Sinan"; Karadeniz Sosyal Bilimler Dergisi, "Mimar Sinan Türbesi Üzerine Bir Değerlendirme".
- **Rights:** PD.
- **Wording:** the last line is quoted both as "Göçdü" and "Geçdi". Read the stone or a critical reading (e.g. the
  Karadeniz article) before use. The inscription has fifteen couplets; only the opening and the date line are used.

## 6. Yol Oldu Üsküdar'a (the frozen Bosphorus, 1621)

- **Place / trigger:** Bosphorus water between Üsküdar and Beşiktaş (polygon around 41.030–41.045 N, 29.000–29.020
  E); `air`, < 50 m AGL; `seasons: ['winter']`, `fog | haze` (switch to snow when the weather has it). Could also use
  `dateRange` 24 Jan – 9 Feb, the days of the 1621 freeze.
- **Excerpt** (our retelling from the chronicles, with the poet's line quoted):
  1. `[bizim]` 1621 kışı. On beş gün durmadan kar yağdı.
  2. `[bizim]` Boğaz buz tuttu; ortada yalnız bir ırmak kadar su akıyordu.
  3. `[bizim]` İnsanlar Üsküdar'dan İstanbul'a buzun üstünden yürüdü.
  4. `[bizim]` Şair Hâşimî o kışa bir tarih düşürdü:
  5. Yol oldu Üsküdar'a, bin otuzda Akdeniz dondu!
- **Closing card:** "Peçevi ve Tûğî o kışı tarihlerine yazdı. Hicrî 1030 (1621) yılında Boğaz'ın buzla kaplandığı
  günler, İstanbul'un en soğuk hatıralarından. Bugün aynı suyun üstünden bir ejderha geçiyor."
- **Sources:** Peçevî, *Târîh* (17th c.), quoting Hâşimî; Tûğî, *Musîbetnâme*; summaries in Erhan Afyoncu,
  "Eskiden İstanbul'da Boğaz bile donardı" (Sabah / A Haber, 2017) and denizhaber.com, "İstanbul Boğazı'nın Donduğu
  Gün".
- **Rights:** PD sources. The retelling is ours (MIT).
- **Wording:** the line is quoted in two orders, "Yol oldu Üsküdar'a, bin otuzda Akdeniz dondu" and "Yol oldı
  Üsküdar'a Akdeniz tondı bin otuzda". Check Peçevi (e.g. the Kültür Bakanlığı edition). The meaning of "Akdeniz" here
  (the strait's water, not the Mediterranean) needs one line of explanation in the card, or leave it poetic. The same
  winter also brought famine and the young Sultan's nickname "uğursuz". Those are left out on purpose.

## 7. Kâtibim (türkü)

- **Place / trigger:** Üsküdar shore and square (≈ 41.0265, 29.0155), radius 400 m; `air`, < 80 m AGL, `rain`. Once
  per session.
- **Excerpt:**
  1. Üsküdar'a gider iken aldı da bir yağmur
  2. Kâtibimin setresi uzun, eteği çamur
  3. Kâtip uykudan uyanmış, gözleri mahmur
  4. Kâtip benim, ben kâtibin, el ne karışır?
  5. Kâtibime kolalı da gömlek ne güzel yaraşır
- **Closing card:** "İstanbul'un en bilinen türküsü: söz ve müzik anonim, makamı Nihavend. Yağmur yine
  Üsküdar'da yakaladı, ama bu kez ıslanan bir ejderha."
- **Sources:** TRT/TSM repertoire listing, tsm.fisek.com.tr (Nihâvend, nim sofyan, anonim); turkudostlari.net.
- **Rights:** traditional, anonymous. The words are free. The music must be our own arrangement (a specific
  recording is not).
- **Wording:** stable across sources. Some sing "Kâtibimin setresi uzun eteği çamur" without the comma.

## 8. Atı Alan Üsküdar'ı Geçti (proverb, retold)

- **Place / trigger:** the strait corridor from Eminönü/Sarayburnu to Üsküdar; `air`, `flightModes: ['diving',
  'flying']`, crossing toward the east. Later, a timed crossing when the runtime supports it.
- **Excerpt** (our retelling):
  1. `[bizim]` Köroğlu'nun atı Kırat kaybolmuş, derler.
  2. `[bizim]` Köroğlu dağ bayır aramış, sonunda İstanbul'da bir at pazarında bulmuş.
  3. `[bizim]` "Şu ata bir bineyim hele" demiş satıcıya. Satıcı "buyur" demiş.
  4. `[bizim]` Kırat sahibini tanımış, şaha kalkmış, dörtnala uzaklaşmış.
  5. `[bizim]` Kalabalıktan biri seslenmiş: "Atı alan Üsküdar'ı geçti!"
- **Closing card:** "Deyim, iş işten geçti demektir. Hikâye halk arasında Köroğlu'na bağlanır; deyimin kendisi daha
  eskidir, bir rivayette Battal Gazi'ye uzanır. Hangisi doğru olursa olsun, sen de geçtin."
- **Sources:** TDK, *Atasözleri ve Deyimler Sözlüğü* (meaning); retellings on nukteler.com, eksiseyler.com; the
  Battal Gazi variant noted on muzakerat.com.
- **Rights:** traditional; retelling ours (MIT).
- **Wording:** the tale has many versions; the card says "halk arasında" and "bir rivayette". The Battal Gazi variant
  involves Kız Kulesi and an abduction, so it is not told, to avoid overlapping the Kız Kulesi legend.

## 9. Perde: Karagöz ile Hacivat (shadow theatre)

- **Place / trigger:** Şehzadebaşı / Direklerarası (≈ 41.0145, 28.957), radius 250 m; `air`, < 60 m AGL, 20–24 h.
  Historically the street of Ramadan-night Karagöz shows. A `dateRange` for Ramadan would need a lunar calendar, so the
  moment is not tied to Ramadan.
- **Excerpt** (speaker labels are used):
  1. Hacivat: Of, of… Hay Hak! Yâr bana bir eğlence, medet!
  2. `[bizim]` Karagöz: Hacivat, bak! Perdeye kocaman bir gölge düştü!
  3. `[bizim]` Hacivat: Aman Karagözüm, ejderha dedikleri bu olmalı. Edebinle selam ver.
  4. `[bizim]` Karagöz: Verdim! Kanadıyla perdeyi yelpazeledi, mum söndü!
  5. Hacivat: Yıktın perdeyi, eyledin viran; varayım sahibine haber vereyim heman!
  6. Karagöz: Her ne kadar sürç-i lisan ettikse affola.
- **Closing card:** "Karagöz gölge oyunu yüzyıllarca İstanbul kahvehanelerinde, en çok da Şehzadebaşı'nda oynandı.
  2009'dan beri UNESCO'nun Somut Olmayan Kültürel Miras listesinde."
- **Sources:** Türk Maarif Ansiklopedisi, "Karagöz"; TÜBİTAK Bilim Çocuk, "Karşınızda Karagöz ile Hacivat" (2025);
  turkedebiyati.org (play structure: mukaddime, muhavere, fasıl, bitiş). The UNESCO listing (2009) is well documented.
- **Rights:** the opening and closing formulas are traditional; the middle dialogue is ours (MIT).
- **Wording:** the opening is quoted both as "Of… Hay Hak!" and "Ah bana bir eğlence, yâr bana bir eğlence, medet".
  Pick one from Cevdet Kudret's edition of the plays (reference only; do not copy his text).

## 10. Yağmur (Tevfik Fikret)

- **Place / trigger:** Aşiyan, Rumelihisarı (≈ 41.0835, 29.0550), radius 200 m; `ground` or `hovering`, `rain`.
  The poet's own house, now a museum.
- **Excerpt:**
  1. Küçük, muttarid, muhteriz darbeler
  2. Kafeslerde, camlarda pür ihtizaz
  3. Olur dembedem nevha-ger, nağme-saz
  4. Kafeslerde, camlarda pür ihtizaz
  5. Küçük, muttarid, muhteriz darbeler
  6. Sokaklarda seylâbeler ağlaşır
  7. Ufuk yaklaşır, yaklaşır, yaklaşır;
- **Closing card:** "Tevfik Fikret (1867–1915) bu şiirde yağmurun sesini kelimelerle çalar: küçük, düzenli,
  çekingen damlalar. Boğaz'a bakan Aşiyan onun evidir."
- **Sources:** milliyet.com.tr/siirler (Yağmur); edebiyatogretmeni.net; *Rübab-ı Şikeste* (1900).
- **Rights:** PD in Turkey (d. 1915) and the US (publ. before 1931).
- **Wording:** "pür ihtizaz / pür-ihtizâz", "dembedem / dem-be-dem" vary. The first published date of the poem
  (Servet-i Fünun, 1890s) should be confirmed for the card if a year is shown.

## 11. Elhân-ı Şitâ (Cenap Şahabettin)

- **Place / trigger:** Moda point and shore (≈ 40.980, 29.025), radius 600 m; `air`; `seasons: ['winter']`,
  `fog | haze` (snow later).
- **Excerpt:**
  1. Göklerden emeller gibi rîzân oluyor kar,
  2. Her sûda hayâlim gibi pûyân oluyor kar.
  3. Soldan sağa, sağdan sola lerzân ü girîzân,
  4. Gâh uçmada tüyler gibi, gâh olmada rîzân…
  5. Ey dest-i âsmân-ı şitâ, durma, durma, çek
  6. Her şâhsârın üstüne bir sütre-i sefîd!
- **Closing card:** "Cenap Şahabettin'in (1870–1934) 'Kış Nağmeleri'. 'Kar, gökten umutlar gibi dökülüyor;
  hayallerim gibi her yana koşuyor.' Rivayete göre İstanbul'a ilk kar düştüğünde gazeteler bu şiiri basardı."
- **Sources:** turkedebiyati.org and milliyet.com.tr/siirler (Elhan-ı Şita); Vikikaynak, *Elhan-ı Şita*; ensonhaber
  (text with a modern rendering).
- **Rights:** PD (d. 1934; publ. 1897).
- **Wording:** the three couplets were confirmed separately; their **order in the poem is not confirmed** (lines 5–6
  may come earlier). Check against Vikikaynak or a critical edition. The "newspapers" line is a popular anecdote, so
  the card says "rivayete göre".

## 12. Bir Günün Sonunda Arzu (Ahmet Haşim)

- **Place / trigger:** Küçükçekmece Lake, reedy north-east shore (≈ 41.015, 28.765), radius 1 km; `air`, < 30 m AGL,
  `gliding`; 17–20 h, `clear | haze`. The lake lies near the west edge of the world square (lon 28.735): check the
  terrain there. Fallback place: the Göksu stream at Anadolu Hisarı.
- **Excerpt:**
  1. Altın kulelerden yine kuşlar
  2. Tekrârını ömrün eder i'lân,
  3. Kuşlar mıdır onlar ki her akşam
  4. Âlemlerimizden sefer eyler?..
  5. Akşam, yine akşam, yine akşam,
  6. Bir sırma kemerdir suya baksam,
  7. Akşam, yine akşam, yine akşam,
  8. Göllerde bu dem bir kamış olsam!
- **Closing card:** "Ahmet Haşim'in (1884–1933) *Göl Saatleri*'nden. Akşamın suya düşen sırma kemeri ve
  bir kamış olmak isteyen bir şair."
- **Sources:** epigraf.fisek.com.tr (num=210); milliyet.com.tr/siirler; Mustafa Apaydın's article (turkoloji.cu.edu.tr).
- **Rights:** PD in Turkey (d. 1933). First printed 1921 (Dergâh), so PD in the US.
- **Wording:** stable. The first stanza ("Yorgun gözümün halkalarında…") is skipped for length. The owner may prefer
  it instead of lines 1–4.

## 13. Hürriyete Doğru (Orhan Veli Kanık)

- **Place / trigger:** Rumelifeneri fishing harbour at the Black Sea mouth (≈ 41.235, 29.110), radius 700 m; `air`,
  < 40 m AGL; 5–7 h, `clear | haze`. Fallback: Sarıyer harbour.
- **Excerpt** (recommended: lines 1–6; lines 7–8 only if the owner accepts the length):
  1. Gün doğmadan,
  2. Deniz daha bembeyazken çıkacaksın yola.
  3. Kürekleri tutmanın şehveti avuçlarında,
  4. İçinde bir iş görmenin saadeti,
  5. Gideceksin;
  6. Gideceksin ırıpların çalkantısında.
  7. Balıklar çıkacak yoluna, karşıcı;
  8. Sevineceksin.
- **Closing card:** "Orhan Veli'nin 'Hürriyete Doğru'su (1949): şafakta denize açılan bir balıkçı. Aynı şairin
  'İstanbul'u Dinliyorum'u Boğaz kıyısında seni bekliyor."
- **Sources:** Vikikaynak, *Hürriyete Doğru*; lyrikline.org (text and the poet's page); *Karşı* (1949).
- **Rights:** PD in Turkey since 2021 (d. 14 Nov 1950). **US risk:** first published 1949 in *Karşı*; a restored US
  term could run to the end of 2044. Keep to the opening lines, as with "İstanbul'u Dinliyorum".
- **Wording:** stable. Line 3 is sensual in tone ("şehveti"); the owner may cut it.

## 14. Mehtap Âlemleri (Halit Ziya, *Aşk-ı Memnu*)

- **Place / trigger:** Bosphorus water off Kandilli and Göksu (≈ 41.075, 29.060), radius 800 m; `air`, < 40 m AGL,
  `gliding`; 21–2 h, `clear | haze`. A moon-phase condition would make it perfect ("mehtap").
- **Excerpt:**
  1. Bütün Göksu, Kâğıthane, Kalender, Bendler müdavimleri onları tanırlar;
  2. Boğaziçi'nin mehtap âlemlerinde en ziyade onların sandalı takip olunur;
  3. en ziyade onların yalısının önünde tevakkuf olunarak
  4. pencerelerin saklı şeyler ifşa etmesine intizar edilir;
  5. bir piyano sesine, perdelerin arkasından fark edilen bir iki zarif gölgeye dikkat olunur…
- **Closing card:** "Halit Ziya Uşaklıgil'in *Aşk-ı Memnu*'su (1899–1900) Boğaziçi'nin yalılarında geçer.
  Mehtap âlemleri, ay ışığında sandallarla müzik dinlenen Boğaz geceleriydi."
- **Sources:** Vikikaynak, *Aşk-ı Memnu/Bölüm 1*; kitappad.com (chapter 1); Ötüken critical edition (ed. Necati Tonga).
- **Rights:** PD in Turkey (d. 1945). **Edition matters for the US:** the novel was serialised in *Servet-i Fünun*
  (1899–1900) and printed in 1901, all PD. The author's own **simplified 1939 version** could still carry a US term
  to 2034. Take the wording from a transliteration of the 1900–01 text, not the 1939 one.
- **Wording:** the excerpt comes from a search excerpt of the online text and may be the 1939 or a modernised
  version. Check it against a 1901-based transliteration before use.

## 15. Çamlıca Bahçesi (Recaizade Mahmut Ekrem, *Araba Sevdası*)

- **Place / trigger:** Büyük Çamlıca hill (≈ 41.027, 29.069), radius 400 m; `ground` or `hovering`;
  `dateRange` May 1–31, 13–18 h, `clear | haze`.
- **Excerpt** (one quoted sentence, the rest ours):
  1. Burası "Çamlıca Bahçesi" namıyla
  2. İstanbul'da en evvel tanzim ve küşat olunmuş olan bahçedir.
  3. `[bizim]` Bir mayıs günü Bihruz Bey, sarı bir landoda sarışın bir hanım gördü.
  4. `[bizim]` Adının Periveş olduğunu öğrendi ve oracıkta âşık oldu.
  5. `[bizim]` Gerisi Fransızca laflar, yanlış anlamalar ve pek çok araba gezintisi.
  6. `[bizim]` Mösyö Bihruz'a söylemeyin: bu tepeye artık kanatla da gelinebiliyor.
- **Closing card:** "Recaizade Mahmut Ekrem'in *Araba Sevdası* (1896–98), züppe Bihruz Bey'le alay eden ilk
  realist Türk romanlarından. Hikâye bu tepedeki bahçede başlar."
- **Sources:** TDV İslâm Ansiklopedisi, "Araba Sevdası"; Anadolu University text (kdm.anadolu.edu.tr/TurkKlasikleri/
  Araba_Sevdasi.pdf); teoridergisi.com, "Romanımız parkta başlar".
- **Rights:** PD (d. 1914; serialised in *Servet-i Fünun* 1896, book 1898).
- **Wording:** only lines 1–2 are verified (a search excerpt of the full sentence). A second quoted sentence from the
  Çamlıca chapter would make the moment stronger; read the Anadolu University PDF. The historical Çamlıca Bahçesi may
  have been on Küçük Çamlıca: confirm the location before placing the trigger.

## 16. Kuyrukluyıldız (Hüseyin Rahmi Gürpınar)

- **Place / trigger:** high over Heybeliada (≈ 40.878, 29.095), radius 1.2 km; `air`, > 150 m ASL; 22–4 h, `clear`.
  Hüseyin Rahmi lived on Heybeliada; his house is a museum.
- **Excerpt** (dialogue):
  1. — Kuyruklu bize ne vakit çarpacakmış?
  2. — Önümüzdeki Mayıs'ın bilmem kaçında… Sabaha karşı çarpacakmış diyorlar.
  3. — Çarpacağını böyle günüyle saatiyle nasıl biliyorlar?
  4. — Kuyruklu, "falan günde falan saatte çarpacağım" diye bu dünyaya telgraf mı göndermiş?
- **Closing card:** "Hüseyin Rahmi (1864–1944) bu romanı 1910'da Halley kuyrukluyıldızının yarattığı 'dünyanın
  sonu' telaşı üzerine yazdı. Yıldız geçti, dünya yerinde. Bir sonraki ziyareti 2061'de."
- **Sources:** TDK edition, *Kuyruklu Yıldız Altında Bir İzdivaç* (tdk.gov.tr PDF, ed. Emine Gürsoy Naskali);
  turkedebiyati.org summary.
- **Rights:** PD in Turkey (d. 1944) and the US (1912).
- **Wording:** confirm punctuation and speaker turns in the TDK edition. One summary gives "1908" for the setting;
  Halley's passage was May 1910.

## 17. Şehrin Temennileri (Ahmet Rasim)

- **Place / trigger:** Golden Horn at Ayvansaray (≈ 41.040, 28.945), radius 500 m, plus `anchor: 'ferry'` within
  150 m when the ferry anchor exists; `air`, < 60 m AGL; `seasons: ['winter']`.
- **Excerpt:**
  1. `[bizim]` Ahmet Rasim, 1890'larda İstanbul'un gizli dileklerini yazmıştı:
  2. Eyüp vapurları: Karlı havalar esse de Ayvansaray önünde istirahat etsek.
  3. 4 ve 5 numaralar: Acaba bizim numaraları değiştirseler süratli gidebilir miyiz?
  4. Köprü memurları: Bir günlük hasılatı bana verseler rahat rahat saysam.
  5. `[bizim]` Ve bir ejderha: Bir gün de beni vapur sansalar, iskelede beklesem.
- **Closing card:** "Ahmet Rasim (1864–1932), İstanbul'un gündelik hayatını gazete mektuplarında incelikli bir
  mizahla anlattı. *Şehir Mektupları* 1897–99 yıllarının İstanbul'undan kalma."
- **Sources:** gazetekadikoy.com.tr, "Ahmet Rasim – Şehir Mektupları" and "Vapurlar, iskeleler, yolcular"; İSEV PDF
  edition (isev.org.tr).
- **Rights:** PD (d. 1932; written 1897–99).
- **Wording:** the three wishes come from a search excerpt. Check them against a full edition. Numbers 4 and 5 were
  Şirket-i Hayriye / Kadıköy-line ferries in the original; the card need not explain it.

## 18. Haritada Bir Nokta (Sait Faik)

- **Place / trigger:** Burgazada harbour and west shore (≈ 40.880, 29.065), radius 700 m; `air`, < 40 m AGL; 7–11 h,
  `haze | fog`.
- **Excerpt:**
  1. Haritada ada görmeyeyim,
  2. içimdeki dostluklar, sevgiler, bir karıncalanmadır başlayıverir.
  3. Hemen gözlerimin içine bakan bir köpek,
  4. hemen az konuşan, hareketleri ağır, elleri çabuk, abalar giymiş bir balıkçı,
  5. … sandalın peşini bırakmayan bir kuş, ağ, balık, pul,
  6. … buğusu tüten kara bir tencere, ufukları dar sisli bir deniz…
- **Closing card:** "Sait Faik Abasıyanık (1906–1954) Burgazada'da yaşadı, adayı ve balıkçılarını anlattı. Evi
  bugün müze."
- **Sources:** goodreads.com quote page (text); edebiyatvesanatakademisi.com, "Sait Faik Haritada Bir Nokta metni";
  *Son Kuşlar* (1952).
- **Rights:** PD in Turkey since 1 January 2025 (d. 11 May 1954). **US risk:** first published 1952; a restored
  US term could run to the end of 2047. Keep the excerpt this short (two sentences, trimmed).
- **Wording:** the story's first-print year should be confirmed (usually given as *Son Kuşlar*, 1952). The famous
  last line ("Yazmasam deli olacaktım") is not used; it carries the story's bitter ending.

## 19. Körler Ülkesi (Herodotus 4.144)

- **Place / trigger:** over the Bosphorus mouth between Sarayburnu and Kadıköy (≈ 41.005, 29.000), radius 1 km; `air`,
  80–400 m ASL, heading roughly east (toward Kadıköy); 17–20 h.
- **Original** (Greek, Hude/Godley text): Οὗτος δὲ ὁ Μεγάβαζος … γενόμενος γὰρ ἐν Βυζαντίῳ ἐπύθετο ἑπτακαίδεκα ἔτεσι
  πρότερον Καλχηδονίους κτίσαντας τὴν χώρην Βυζαντίων, πυθόμενος δὲ ἔφη Καλχηδονίους τοῦτον τὸν χρόνον τυγχάνειν
  ἐόντας τυφλούς· οὐ γὰρ ἂν τοῦ καλλίονος παρεόντος κτίζειν χώρου τὸν αἰσχίονα ἑλέσθαι, εἰ μὴ ἦσαν τυφλοί.
- **Reference translation** (G. C. Macaulay, 1890, PD): "…being once at Byzantion he heard that the men of Calchedon
  had settled in that region seventeen years before the Byzantians, and having heard it he said that those of
  Calchedon at that time chanced to be blind; for assuredly they would not have chosen the worse place, when they
  might have settled in that which was better, if they had not been blind."
- **Excerpt** (*needs our translation*; draft):
  1. Pers komutanı Megabazos Byzantion'a geldiğinde bir şey öğrendi:
  2. Kalkhedonlular bu kıyıya Byzantionlulardan on yedi yıl önce yerleşmişti.
  3. Bunu duyunca şöyle dedi:
  4. "Demek Kalkhedonlular o zamanlar kördü.
  5. Yoksa güzel yer dururken çirkinini seçmezlerdi."
  6. `[bizim]` Herodot'a göre bu söz, onu ölümsüz kıldı.
- **Closing card:** "Kalkhedon bugünkü Kadıköy'dür. Byzas'ın kenti 'körler ülkesinin karşısına' kurduğu da
  anlatılır. Moda'dan gün batımını seyredenler kimin kör olduğuna kendi karar verir."
- **Sources:** Macaulay text at lexundria.com/hdt/4.144/mcly; Greek at Perseus (Hdt. 4.144); livius.org, "Greek
  Byzantium".
- **Rights:** PD. The Turkish translation is ours. The Greek above was written from the standard text and must be
  checked against Perseus before any is shown (the game shows only Turkish).
- **Wording:** Macaulay confirmed. Tacitus (*Annals* 12.63) tells the same story with the Delphic oracle; that could be
  a variant card.

## 20. Gökten Asılı Kubbe (Procopius, *Buildings* I.1)

- **Place / trigger:** circling the Hagia Sophia dome (41.0086, 28.9802), radius 250 m; `air`, 150–400 m ASL,
  `gliding | flying`; 11–15 h, `clear`.
- **Reference text** (H. B. Dewing, Loeb 1940; LacusCurtius states the translation is in the US public domain):
  "…a spectacle of marvellous beauty, overwhelming to those who see it, but to those who know it by hearsay
  altogether incredible. … Indeed one might say that its interior is not illuminated from without by the sun, but
  that the radiance comes into being within it, such an abundance of light bathes this shrine. … [the dome] seems not
  to rest upon solid masonry, but to cover the space with its golden dome suspended from Heaven."
- **Excerpt** (*needs our translation*, from the Greek; draft):
  1. Görenleri büyüleyen, işitenlere inanılmaz gelen bir güzellik…
  2. Göğe erişircesine yükselir, kentin geri kalanına yukarıdan bakar.
  3. İçi güneşle ve mermerlerden yansıyan ışıkla dolup taşar.
  4. Denebilir ki içerisi dışarıdan, güneşle aydınlanmaz;
  5. ışık içeride doğar.
  6. Kubbe ise sağlam duvarlara oturmuyor da
  7. altın kubbesiyle gökten asılı duruyormuş gibi görünür.
- **Closing card:** "Bizanslı tarihçi Prokopios bu satırları 550'lerde, yapı yeni bittiğinde yazdı. Kubbe 558
  depreminde çöktü ve yeniden kuruldu. Bugün gördüğün kubbe, o yenisidir."
- **Sources:** LacusCurtius, penelope.uchicago.edu/Thayer/E/Roman/texts/Procopius/buildings/1A*.html (Dewing text and
  copyright note); Greek: Haury–Wirth, *Procopii opera* IV.
- **Rights:** Greek text PD. Our translation is made from the Greek, with Dewing as a crib. **Owner decision (mild):**
  Hagia Sophia's status is a public debate. The draft uses the neutral "yapı", not "kilise" or "cami", and the card
  stays architectural.
- **Wording:** the light and dome sentences are confirmed; the "spectacle" sentence is from memory of Dewing 1.1.27.
  Check all three against the Greek.

## 21. Sis Kalkınca (Edmondo De Amicis, *Costantinopoli*)

- **Place / trigger:** Sea of Marmara south of Sarayburnu (≈ 41.000, 28.985), radius 1.2 km; `air`, < 80 m AGL,
  heading north; 6–10 h, `fog`. Nice touch for the runtime later: let the fog thin while the lines play.
- **Original** (Italian, 1877; confirmed fragments): «C'era la nebbia.» … Scutari, «velata dai vapori luminosi del
  mattino, ridente, fresca come una città sorta allora al tocco di una verga fatata» … (after the Seraglio point)
  «Ecco Costantinopoli!»
- **Excerpt** (*needs our translation*; draft):
  1. Sis vardı.
  2. `[bizim, paraphrase]` Sonra sis aralandı, karşımızda Üsküdar belirdi:
  3. sabahın ışıklı buğusuna bürünmüş, gülümseyen,
  4. sihirli bir değneğin dokunuşuyla az önce doğmuş bir şehir kadar taze.
  5. `[bizim, paraphrase]` Sarayburnu'nu dönünce…
  6. İşte Konstantinopolis!
- **Closing card:** "İtalyan yazar Edmondo De Amicis İstanbul'a 1874'te sisli bir sabah geldi. Sis kalkınca
  gördükleri, *Costantinopoli*'nin (1877) meşhur açılışı oldu."
- **Sources:** experiences.it, "Edmondo De Amicis, Costantinopoli: L'arrivo" (full Italian chapter);
  sempreverdi.net and IntraText (full text); English: Gutenberg #51728 (Tilton, 1896) as a crib only.
- **Rights:** PD (d. 1908). Translation ours.
- **Wording:** lines 1, 3–4 and 6 are quotations confirmed in search excerpts (the exact place of "Ecco
  Costantinopoli!" in the chapter is not confirmed). Lines 2 and 5 are our bridge. Replace them with De Amicis' own
  sentences once the chapter is read.

## 22. Hayalin Kurduğu Venedik (H. C. Andersen, *En Digters Bazar*)

- **Place / trigger:** Marmara off Kumkapı–Yenikapı (≈ 40.995, 28.955), radius 1.2 km; `air`, < 80 m AGL, heading
  north-east; 6–9 h, `rain | haze` (standing in for "after a stormy night").
- **Original** (Danish, 1842): "Det havde den hele Nat været et stormfuldt Byge-Veir; i Morgenstunden kjæmpede
  Solskinnet mod Skyer og Taage, bag ved os væltede Marmorhavet sine mørkegrønne, skummende Bølger, men forude saae
  vi, som et Venedig, bygget af Phantasien, det uhyre Constantinopel, Tyrkernes Stambul. Sorte Cypresser og lysegrønne
  Løvtræer, tittede arabeskartigt frem mellem dette Steen-Hav af mørkerøde Bygninger, hvor Moskeernes Kupler med
  gyldne Kugler og Halvmaane, hver hvilede som en Noahs Ark; og hvor i hundredeviis de høie, søileagtige Minareter med
  deres spidse Taarne skinnede mod den graa, skyfulde Luft."
- **Excerpt** (*needs our translation*; draft):
  1. Bütün gece fırtınalı, sağanaklı bir hava vardı;
  2. sabaha karşı güneş, bulutlarla ve sisle boğuştu.
  3. Ardımızda Marmara koyu yeşil, köpüklü dalgalarını devirip duruyordu;
  4. ama önümüzde, hayalin kurduğu bir Venedik gibi,
  5. koskoca Konstantinopolis'i, Türklerin İstanbul'unu gördük.
  6. Camilerin altın alemli kubbeleri, her biri bir Nuh'un gemisi gibi duruyordu;
  7. yüzlerce ince minare, gri ve bulutlu göğe karşı parlıyordu.
- **Closing card:** "Masalcı Hans Christian Andersen İstanbul'a 1841 baharında geldi. Gördüklerini *Bir Şairin
  Çarşısı*'nda (1842) anlattı."
- **Sources:** visithcandersen.dk/bazar-4-06.htm ("Ankomst til Constantinopel og Pera"); hcandersen-homepage.dk;
  Det Kgl. Bibliotek text portal (tekster.kb.dk) for the critical text.
- **Rights:** PD. Translation ours.
- **Wording:** both sentences confirmed in search excerpts. Line 6 compresses the cypress clause; check it against the
  kb.dk critical text.

## 23. Soylu Bir Tablo (Mark Twain, *The Innocents Abroad*)

- **Place / trigger:** high over the anchorage off Karaköy–Tophane (≈ 41.024, 28.985), radius 900 m; `air`, > 300 m
  ASL, `hovering | gliding`; any daytime, `clear | haze`.
- **Original** (1869, ch. 33): "…is by far the handsomest city we have seen. Its dense array of houses swells upward
  from the water's edge, and spreads over the domes of many hills; and the gardens that peep out here and there, the
  great globes of the mosques, and the countless minarets that meet the eye every where, invest the metropolis with
  the quaint Oriental aspect one dreams of when he reads books of eastern travel. Constantinople makes a noble
  picture. But its attractiveness begins and ends with its picturesqueness."
- **Excerpt** (*needs our translation*; draft):
  1. Demirlediğimiz yerden bakınca, gördüğümüz en yakışıklı şehir.
  2. Sık evleri su kıyısından yukarı kabarıyor, nice tepenin kubbesine yayılıyor;
  3. arada göz kırpan bahçeler, camilerin koca küreleri, her yanda sayısız minare…
  4. Doğu seyahatnameleri okurken düşlenen o tuhaf, masalsı görünüm.
  5. Konstantinopolis soylu bir tablo.
  6. Ama çekiciliği, tablo oluşuyla başlar ve biter.
- **Closing card:** "Mark Twain 1867'de geldi, karaya çıkınca çamurdan, köpeklerden, rehberlerden yakındı. Sen en
  akıllıcasını yaptın: yukarıda kaldın."
- **Sources:** Project Gutenberg #3176, ch. XXXIII; twain.lib.virginia.edu/innocent/text/inn33.html.
- **Rights:** PD. Translation ours.
- **Wording:** "noble picture … picturesqueness" confirmed. The opening clause ("from the anchorage (or from a mile or
  so up the Bosporus)") is quoted only in paraphrase by the search results; check it in Gutenberg. The humour is
  gentle and aimed at the tourist; the rest of the chapter is harsher and is not used.

## 24. Eyüp'e Doğru (Pierre Loti, *Aziyadé*)

- **Place / trigger:** start over the Pera ridge above the Golden Horn (Tepebaşı, ≈ 41.034, 28.972), radius 400 m;
  `air`, `gliding`, heading up the Golden Horn toward Eyüp (41.048, 28.934); `seasons: ['summer']`, 14–19 h.
- **Original** (French, 1879): "Ma maison était située en un point retiré de Péra, dominant de haut la Corne d'or et
  le panorama lointain de la ville turque ; la splendeur de l'été donnait du charme à cette habitation. En travaillant
  la langue de l'islam devant ma grande fenêtre ouverte, je planais sur le vieux Stamboul baigné de soleil. Tout au
  fond, dans un bois de cyprès, apparaissait Eyoub, où il eût été doux d'aller avec elle cacher son existence, — point
  mystérieux et ignoré où notre vie eût trouvé un cadre étrange et charmant."
- **Excerpt** (*needs our translation*; draft):
  1. Evim Pera'nın kuytu bir köşesindeydi;
  2. yukarıdan Haliç'e ve uzaktaki Türk şehrine bakıyordu.
  3. Yazın görkemi bu eve ayrı bir tat veriyordu.
  4. Büyük açık penceremin önünde Türkçe çalışırken
  5. güneşe gömülmüş eski İstanbul'un üzerinde süzülüyordum.
  6. Ta en dipte, bir selvi korusunun içinde Eyüp görünürdü;
  7. hayatımızın tuhaf ve büyüleyici bir çerçeve bulacağı gizemli, bilinmedik bir köşe.
- **Closing card:** "Pierre Loti (1850–1923) İstanbul'a âşık bir Fransız denizciydi. Eyüp sırtındaki kahve bugün
  onun adını taşıyor."
- **Sources:** fr.wikisource.org, *Aziyadé* (Texte entier); Gutenberg #11035; ebooksgratuits.com PDF.
- **Rights:** PD. Translation ours.
- **Wording:** confirmed in a search excerpt. "La langue de l'islam" is rendered "Türkçe" (Loti means the Turkish he
  was learning). Say so in the notes or keep it literal. The novel's frame (a love affair with a woman from a harem)
  is left out; only the landscape passage is used.

## 25. Belgrad Köyü'nden Mektup (Lady Mary Wortley Montagu)

- **Place / trigger:** Belgrad Forest near the old village site and the bents (≈ 41.185, 28.970), radius 1.5 km;
  `air`, < 60 m AGL, `gliding`; `seasons: ['summer']`, 10–17 h, `clear | haze`.
- **Original** (letter to Alexander Pope, Belgrade Village, 17 June 1717; publ. 1763): "The heats of Constantinople
  have driven me to this place, which perfectly answers the description of the Elysian fields. I am in the middle of a
  wood, consisting chiefly of fruit trees, watered by a vast number of fountains, famous for the excellency of their
  water, and divided into many shady walks, upon short grass… within view of the Black Sea, from whence we perpetually
  enjoy the refreshment of cool breezes, that make us insensible of the heat of summer."
- **Excerpt** (*needs our translation*; draft):
  1. İstanbul'un sıcakları beni buraya sürdü;
  2. burası Elysion çayırlarının tarifine tıpatıp uyuyor.
  3. Çoğu meyve ağacından bir ormanın ortasındayım;
  4. suyuyla ünlü sayısız çeşme her yanı suluyor,
  5. kısa çimenli gölgeli yollar ağaçların arasından geçiyor.
  6. Karadeniz de görünüyor; oradan esen serin meltem
  7. bize yazın sıcağını unutturuyor.
- **Closing card:** "Lady Mary Wortley Montagu 1717 yazını İngiliz elçisi eşiyle Belgrad Köyü'nde geçirdi.
  Mektupları, bir kadının gözünden Osmanlı İstanbul'unun en canlı tanıklıklarındandır."
- **Sources:** Project Gutenberg, *Letters of the Right Honourable Lady M—y W—y M—e* (the Turkish Embassy Letters);
  jacklynch.net/Texts/montagu-letters.html; levantineheritage.com, "A Lost Thracian Village—Belgrad".
- **Rights:** PD. Translation ours.
- **Wording:** **least verified entry.** Search results confirm the letter, the place, the date and the "Black Sea …
  cool breezes" phrase, but the full passage above is partly from memory. Check every word against the 1763 text
  before use. Some editions address the letter to Pope, others to "the Lady —". Check that too.

---

## Rejected or needing an owner decision

| Item | Why | Suggestion |
|---|---|---|
| Evliya Çelebi's dream at the Ahi Çelebi mosque (Yemiş İskelesi), where he says "seyahat" instead of "şefaat" | A lovely, famous origin story for his travels, but it narrates a meeting with the Prophet in a dream. Religiously sensitive for some players. Evliya is also already the source of two legends. | **Owner decision.** If wanted: a respectful retelling that does not quote the Prophet ("Rüyamda heyecandan dilim sürçtü…"). |
| Lamartine, *Voyage en Orient* (1835): "le point de vue le plus merveilleux que le regard humain puisse contempler sur la terre" | Verified and very quotable, but a third "arrival by sea" next to De Amicis and Andersen. | Keep as an **alternate** for #21 or #22 (clear-weather version). |
| Nerval, *Voyage en Orient* (1851): Constantinople as "une décoration de théâtre, qu'il faut regarder de la salle sans en visiter les coulisses" | Verified; witty, but mildly disparaging and close to the Twain joke. | Alternate for #23. |
| Petrus Gyllius, "while other cities are mortal, this one will endure as long as there are men on Earth" | The popular English wording seems to be a modern paraphrase (possibly John Freely's, still in copyright). The Latin original was not found. | Rejected until the Latin (*De Bosporo Thracio*, 1561) passage is located. |
| Flaubert, letter from Constantinople (1850), "capital of the world in a hundred years" | Could not be verified; the letter found (19 Dec 1850) says something else, about the harem. | Rejected (unverified). |
| Tevfik Fikret, "Sis" (1902) | Famous fog poem, but it curses the city as a political allegory ("Ey köhne Bizans…"). Controversial. | **Owner decision**; "Yağmur" (#10) is used instead. |
| Mehmet Akif Ersoy, *Safahat* (Süleymaniye/Fatih kürsüsünde) | PD since 2007, but sermons with religious and political content. | Rejected. |
| Namık Kemal, "Hürriyet Kasidesi" | Political. | Rejected. |
| Mehmet Rauf, *Eylül* (1901) | A fitting autumn Bosphorus novel, but no reliable excerpt was found and the plot is an adultery drama. | Possible later with a landscape passage. |
| İstanbul manileri (e.g. ayaklı mâni) | No reliably sourced text found. Collections are recent and edited. | Write our own manis in the traditional form (MIT) if the owner likes the genre. |
| Busbecq, *Turkish Letters* | The famous tulip passage is not set in Istanbul; the Latin on the city was not verified. | Rejected for now. |
| Still in copyright in Turkey (2026) | Yahya Kemal (d. 1958), Ahmet Hamdi Tanpınar (d. 1962, *Beş Şehir*), Nazım Hikmet (d. 1963), Abdülhak Şinasi Hisar (d. 1963, *Boğaziçi Mehtapları*), Refik Halit Karay (d. 1965), Reşat Nuri Güntekin (d. 1956, PD 2027), Cahit Sıtkı Tarancı (d. 1956, PD 2027), Ercüment Ekrem Talu (d. 1956, PD 2027), Faruk Nafiz Çamlıbel (d. 1973), Orhan Pamuk; Le Corbusier, *Voyage d'Orient* (d. 1965). Also every existing Turkish translation of the foreign travellers above. | Excluded. Yahya Kemal and the 1956 group could be revisited when they fall into the public domain. |

## What the owner needed to decide (original list)

Item 1 is settled (see "Chosen and built" at the top); items 2, 4 and 5 were settled by not choosing those candidates
(#20 is built with the neutral "yapı"); item 3 still applies to #20 and #21 (a Turkish proofread is welcome, they play
already as our MIT text); item 6 was redone for the chosen ones: on 26 September 2026 the source pages (Vikikaynak,
TDK, LacusCurtius and others) could be opened from the container, and each record's provenance says what was read.

1. **Pick the candidates** to turn into records (all 25 fit the subtitle-only pattern that plays today, except where a
   missing trigger feature is noted).
2. **US-risk items:** #13 Orhan Veli, "Hürriyete Doğru" (1949) and #18 Sait Faik, "Haritada Bir Nokta" (1952). Both
   are kept short, like "İstanbul'u Dinliyorum". Accept them, shorten them further, or drop them. For #14 (*Aşk-ı
   Memnu*) confirm we use the 1900–01 text, not the 1939 revision.
3. **Our translations** (#19–25) need a Turkish proofread before they ship. They become our own MIT text with the PD
   original named in `provenance`.
4. **Mild sensitivities:** #4 (basmala and prayer in the inscription), #3 (Sufi vocabulary), #20 (Hagia Sophia), and
   the Evliya dream in the rejected list.
5. **Trigger features:** snow weather (#6, #11, #17), moon phase (#14), crossing speed (#8). Build them, or use the
   fallbacks given.
6. **Verification pass:** every quotation was checked through search excerpts only (source sites were blocked from
   the build container). Each needs one read against the named edition before its record is made; the least verified
   are #25 (Lady Mary), #15 (Araba Sevdası beyond the first sentence), #11 (line order), #6 (word order) and #20
   (first sentence).
