# Kadıköy soul: the small details

A catalogue of the small things a local would miss if they were absent from the street layer
(`.docs/planning/16-street-layer.md`). It merges four research angles run on 2026-09-24: animals, street life,
visual clutter and night culture. It covers the S1 strip (`s1-strip.md`: pier square, Rıhtım Cd, Yasa Cd, the fish
end) first, then the S5 heart of Kadıköy, the later zones (Moda, Yeldeğirmeni, Kadife Sk) and Hamallar
(`.docs/planning/17-hamallar-coop.md`). Research only: nothing here is built yet.

## How to read this

- **Importance.** *Signature*: a local notices at once if it is missing. *Strong*: noticed within minutes.
  *Nice*: texture that regulars would recognise.
- **When.**
  - **S1r**: S1 revision, meaning cheap static details on the current strip.
  - **S3**: walking. **S4**: NPCs, barks and ink. **S5**: the heart of Kadıköy (animated life, schedules, sound).
  - **S6+**: sky to street and the later zones (Moda, Yeldeğirmeni, Kadife Sk). **S7**: driving.
  - **H**: Hamallar.
- **Build tags.**
  - **[proc]**: procedural in `tools/world-compiler`, or a runtime shader.
  - **[have]**: already exists in the repo.
  - **[ext]**: an external asset that needs the user's approval before use (CLAUDE.md: free licence, shortlist with previews).
  - **[MH]**: the approved MetaHuman + Mixamo pipeline.
  - **[clip]**: a motion clip Mixamo does not have, so it needs another source.
- **Density.** "(est.)" marks the researchers' calibrated guesses from photos and reports. None of these numbers was
  measured on site. Numbers without "(est.)" come from a source.
- **"Most heard" %** refers to a Koç University survey (Yelmi, 421 respondents) that asked which sounds people hear
  most in Istanbul. Source:
  [gazetekadikoy](https://www.gazetekadikoy.com.tr/gundem/istanbul039un-sesini-dinlemek-ister-misiniz).

## Assumptions this catalogue makes (for the user to confirm)

1. **Default date: late September**, Thursday 24 Sep 2026. It is palamut season: the fishing ban ended on 1 Sept, so
   the stalls are full and the market cats are at their best-fed. Other effects of the date:
   - brown juvenile gulls are begging;
   - this year's kittens are half-grown;
   - there are no mating yowls (those come in Jan–Mar);
   - it is still warm, so water bowls are out;
   - corn carts are out and chestnuts have not started (they begin in mid-October).

   Prayer times: 05:21, 13:01, 16:25, 19:06, 20:26. Sunrise is at 06:46.
2. **The pier square keeps its pre-works look of 2024–25.** Construction of the Kadıköy Meydanı project began on
   3 Mar 2026 and is due to finish in 2027. It removes the kiosks and pedestrianises the square. On 3 Aug 2026, 13 IETT
   lines left the Rıhtım platforms and 9 were cancelled. The S1 reference photos show the older square with its
   kiosks, carts and buses, so the pre-works look matches them.
3. **Dogs follow the same baseline**: 1–2 ear-tagged dogs on the square and the Rıhtım, none on Yasa Cd, never packs.
   Collections have taken dogs off the street since April 2026. The game does not depict them.
4. **Voice.** The street plan excludes voice acting, but vendor cries, market calls and crowd walla need Turkish
   voices. Proposal: dialogue and barks stay as text, and short street cries count as sound effects (field recordings
   with a free licence, or recorded for Seventeen Skies). This needs the user's decision.
5. **Tone filters.** The full list is under [Excluded and why](#excluded-and-why).
   - Every business, bank, delivery app and scooter brand is fictional, and no real logos appear.
   - Fenerbahçe appears as yellow-and-navy colours only, with no crest.
   - Politics appears only as neutral generic posters.
   - No real people appear, and no named real animals.

## Priority index

| # | Item | Importance | First place | When | External asset |
|---|---|---|---|---|---|
| 1 | Street cats and their spots | signature | whole strip | S1r placeholders, S5 | cat |
| 2 | Food and water bowls | signature | Yasa Cd, square, P0 | S1r | – |
| 3 | Fish-market cats | signature | P11 | S1r, S5 | cat |
| 4 | Gulls on the quay and roofs | signature | square, P11 | S1r static, S5 | gull, sound |
| 5 | Ferry pulse | signature | square | S3, S5 | – (synth horn exists) |
| 6 | Simit cart | signature | square (c02) | S1r, S4, S5 | clip |
| 7 | Call to prayer | signature | Yasa Cd | S5 | recordings |
| 8 | Shopkeepers' day | signature | Yasa Cd | S1r, S4, S5 | sound |
| 9 | Tea runner | signature | Yasa Cd | S1r, S4, S5 | clip |
| 10 | Fish stalls in palamut season | signature | P11 | S1r, S4, S5 | clip, sound |
| 11 | Stickers and posters on everything | signature | P2–P7, Yasa Cd | S1r | – |
| 12 | Shop cats | signature | Yasa Cd shops | S4, S5 | cat |
| 13 | Simit to the gulls | signature | quay, ferries | S4, S5, S6+ | gull |
| 14 | T3 tram and its bell | signature | P7 | S5 | tram model |
| 15 | Graffiti on closed shutters | signature | Yasa Cd at night | S1r | – |
| 16 | Night food: midye and kokoreç | signature | P8, Rıhtım | S1r, S5 | clip |
| 17 | Meyhane tables at the fish end | signature | P11 at night | S1r, S5 | clip, music |
| 18 | Yellow and navy, and match nights | signature | whole strip | S1r, S5, H | sound |
| 19 | Street musicians | signature | square | S5 | clip, music |
| 20 | The Boğa as a meeting point | signature | Altıyol | S5 | – |
| 21 | Moda rocks at sunset | signature | Moda | S6+ | – |
| 22 | Kadife Sk's standing crowd | signature | Kadife Sk | S6+ | music |
| 23 | Mural façades | signature | Yeldeğirmeni, Moda | S6+ | original art |
| 24 | Cat houses | strong | Yasa Cd, P0, P11 | S1r | – |
| 25 | Ear-tagged street dogs | strong | square | S5, H | dog |
| 26 | Pigeons that scatter | strong | square | S3, S5 | pigeon |
| 27 | Volunteer feeders' rounds | strong | bowl route | S4, S5 | clip |
| 28 | The bus-stop cat | strong | P0 | S1r, S5 | cat |
| 29 | Ear-tip notch | strong | on cats | S5 | cat (variant) |
| 30 | Anglers on the quay | strong | quay | S1r kit, S5 | clip |
| 31 | Akmar Pasajı, books, records and cats | strong | off P10 | S5 | music |
| 32 | Balconies and windowsills | strong | T1 upper floors | S1r | – |
| 33 | Façade services: gas risers, flues, drips | strong | all façades | S1r | – |
| 34 | Pavement spill-over | strong | Yasa Cd, P11 | S1r | – |
| 35 | Ground residue and patches | strong | square, Rıhtım Cd | S1r | – |
| 36 | Wall tags and painted-over patches | strong | plinths, side walls | S1r | – |
| 37 | Street signs, plaques, intercoms, notes | strong | junctions, doors | S1r | – |
| 38 | KİRALIK and SATILIK banners | strong | upper floors | S1r, H | – |
| 39 | Deliveries, couriers, scooters | strong | lane mouths, kerbs | S1r, S5, H | motorbike |
| 40 | Tea houses and tavla | strong | çarşı side streets | S4, S5 | clip |
| 41 | Seasonal carts: corn, chestnut, salep | strong | square | S1r, S5 | – |
| 42 | The çarşı's smell shops | strong | Yasa Cd, P11 | S1r, S5 | – |
| 43 | Waste cycle | strong | P11 lane mouth | S1r, S5 | clip |
| 44 | Wet pavement | strong | P11, shopfronts | S1r, S5 | – |
| 45 | Pharmacy sign and duty list | strong | strip edge | S1r | – |
| 46 | Night lighting character | strong | whole strip | S1r, S5, S6+ | – |
| 47 | Büfe and tekel before 22:00 | strong | kiosks | S1r, S5 | – |
| 48 | Dolmuş rank and calls | strong | west of square | S5, S7 | vehicle |
| 49 | Horon and halay by the pier | strong | Rıhtım | S5 | clip, music |
| 50 | Students in laptop cafés | strong | café interior | S4, S5 | – |
| 51 | Moda evening stroll | strong | Moda | S6+ | – |
| 52 | Hooded crows | nice | plane tree, quay | S5 | crow |
| 53 | Animal-welfare signs | nice | poles, Rıhtım Cd | S1r | – |
| 54 | Pop-up umbrella sellers | nice | pier exits | S5, H | – |
| 55 | Antiques street | nice | Tellalzade Sk | S5, H | props |
| 56 | Charity fundraisers | nice | Bahariye | S5 | – |
| 57 | Scrap-dealer van | nice | residential streets | S6+, H | voice loop |
| 58 | Aya Efimia bell | nice | P10 | S5 | – (synth) |
| 59 | İstanbulkart beeps | nice | pier gates | S3, S5 | – (synth) |
| 60 | Pilaf carts | nice | near square | S5 | – |
| 61 | ATM cluster | nice | Rıhtım Cd | S1r | – |
| 62 | Night watchmen | nice | side streets | S5 | – |
| 63 | Lodos nights | nice | quay, Moda | S5, H | – |
| 64 | Late-night cars with loud music | nice | edges of the çarşı | S7 | – |
| 65 | Tombili and the Moda dog statue | nice | outside the zones | S6+ (homage) | – |

## Signature

### 1. Street cats and their spots (sokak kedileri, "Kediköy")

- **What.** Well-fed, calm adult cats in mixed coats: tabby, black-and-white, ginger, calico and a few white. They
  loaf or sleep in plain view and do not run from people.
  - **Kittens.** In late September this year's kittens are 3–6-month juveniles, seen in groups of 2–3 near a feeding
    spot.
  - **Owned spots.** Cats claim warm, raised or sheltered places:
    - scooter and motorbike seats;
    - café chairs and cushions;
    - shop windows among the goods, and counters;
    - planters, sunny stone steps and the tops of low walls;
    - under cars and benches in rain or heat;
    - car bonnets in the cold months.
  - **People.** Shopkeepers step around them, and passers-by stop to photograph and stroke them.
- **Where, when.** Everywhere in the çarşı:
  - Yasa Cd thresholds and windows, and the café chairs at the P10 plaza;
  - the Aya Efimia wall top, the gate hood and the fountain niche (plausible, but no source found);
  - the benches and planters on the square.

  By day they sleep. They are active at the dawn and dusk feeding rounds, and at night around restaurants and bins.
- **Density.**
  - One cat every 20–30 m on Yasa Cd by day, which is 4–8 on the 138 m lane (est.).
  - 3–6 on the square (est.).
  - 30–50 % of the visible cats are in an owned spot (est.).
  - At least one cat in a shop window or on a café chair per 40 m of shopfront (est.).
- **Sound.** Silent by day. Short meows at doors and feeders, a chorus when a kibble bag rustles, and hisses and
  growls in night spats at bins.
- **Build.**
  - *Prop* [proc], S1r: add placeholder cats in three poses (loaf, curl, sit) at new `catSpots` manifest records, so
    the S1 shots can judge count and placement the way the placeholder pedestrians already are.
  - *Life* [ext cat]: a cat agent moves between its owned spot, a bowl and a short patrol. It seeks sun or shade,
    turns its head to the player and rarely moves off. Some rub against the player's legs. Kittens trail the adults.
  - *NPC*: a passer-by stops for a photo. Bark: "Şuna bak, uyuyor!"
  - *Rules*: in rain they move under awnings, cars and benches. In cold they take car bonnets and cat houses. In heat
    they lie in the shade under the stalls.
- **When.**
  - S1r: spots and placeholders.
  - S4: a player verb to stroke a cat (sev), answered with a purr.
  - S5: animated cats.
  - H: cats asleep on stairs and in doorways block the carrying route, and a cat slips into the flat and has to be
    carried out.
- **Src.** [Wikipedia: Feral cats in Istanbul](https://en.wikipedia.org/wiki/Feral_cats_in_Istanbul),
  [gazetekadikoy: esnaf kedileri](https://www.gazetekadikoy.com.tr/yasam/kadiky039n-esnaf-kedileri),
  [istairport blog](https://www.istairport.com/blog/istanbulda-kedileriyle-meshur-semtler).

### 2. Food and water bowls (mama ve su kapları)

- **What.** Most bowls are improvised:
  - 5–10 L water bottles cut in half;
  - washed yogurt tubs and takeaway boxes;
  - old ceramic plates;
  - dry kibble in a small heap on flattened cardboard or newspaper.

  Pet-shop bowls are rarer. The usual set is a water-and-food pair at a wall base, a threshold, a tree pit, a bench
  leg or a bus shelter. In summer, shopkeepers top up the water at their doors, which the municipality encourages
  with its "Bir Kap Su Ver" (give a bowl of water) campaign. In winter, blankets appear on windowsills. Some bowls get
  thrown away. An empty bowl still reads as "a cat lives here".
- **Where.** Yasa Cd corners and thresholds, the base of the Aya Efimia wall, tree pits and bench legs on the square,
  and the İskele bus stop at P0.
- **Density.** A set every 15–30 m on the çarşı lanes, which is 5–9 on Yasa Cd (est.). 2–4 on the square and one at
  most bus stops (est.).
- **Sound.** Kibble rattling into plastic, water splashing from a bottle, and cats converging.
- **Build.**
  - *Prop* [proc]: 6–8 bowl variants (cut bottle, yogurt tub, takeaway box, plate, steel bowl), each with fill states:
    full, half, empty, a dry kibble heap on a cardboard decal, and water with a leaf floating in it. Add scattered
    spilled kibble.
  - *Life*: cats eat and drink at the bowls. Gulls and crows raid them now and then.
  - *NPC*: feeders refill them (item 27). A shopkeeper pours water from a bottle in the morning.
  - *Rules*: the water level drops through the day. Summer brings more water bowls; winter brings blankets on the sills.
- **When.**
  - S1r: 5–9 sets on Yasa Cd, 2–4 on the square and a pair at P0.
  - S5: fill cycles.
  - H: knocking a bowl over with a sofa earns a bark from the shopkeeper.
- **Src.** [gazetekadikoy: durak kedileri](https://www.gazetekadikoy.com.tr/yasam/kadikoy-duraklarinin-kedileri),
  [gazetekadikoy: köşedeki Kadıköylüler](https://www.gazetekadikoy.com.tr/gundem/kosedagi-kadikoyluleri-sokak-hayvanlarina-sahip-cikmaya-cagiriyoruz).

### 3. Fish-market cats (balık pazarı kedileri)

- **What.** Cats sit low at the edges of the tilted tables, under the stalls beside the white EPS crates and the blue
  barrels, and by the drain grates. They stay a metre or two back but make sure the fishmonger has seen them. The
  fishmongers toss them heads, guts and damaged small fish without looking.
- **Where, when.** P11, ch 240–263 and along Güneşlibahçe Sk. Activity peaks while fish is cleaned to order in the late
  morning, and at the hose-down around 20:00–20:30.
- **Density.** 3–8 cats within about 20 m of the junction by day, more at closing (est.). About one cat per 1–2 stalls
  (est.).
- **Sound.** Meowing at the fishmonger's feet, and a fish head slapping onto wet paving. Bark: "Pisi pisi, al bakalım."
- **Build.**
  - *Prop*, S1r: placeholder cats under half of the fish stalls, and fish-scrap decals on the wet paving.
  - *Life*: a "wait" state at a stall slot. When a scrap lands, the nearest cat pounces and the others watch. Gulls
    drop in on any scrap left unguarded.
  - *NPC* [clip]: the fishmonger's throw loop, with a bark.
  - *Rules*: the count doubles between 19:30 and 20:30. At night the cats move to the meyhane tables (item 17).
- **When.** S1r placeholders, S4 bark, S5 animated cats with the fishmonger loop.
- **Src.** [turkeysforlife](https://www.turkeysforlife.com/2015/09/kadikoy-market-istanbul.html),
  [gazetekadikoy: balık sevinci](https://www.gazetekadikoy.com.tr/yasam/tarihi-arsida-balik-sevinci).

### 4. Gulls on the quay and the roofs (martı)

- **What.** Yellow-legged gulls: white, with a pale-grey back, a yellow bill with a red spot and yellow legs. In late
  September many are brown-mottled juveniles begging with thin whistles.
  - **Perches.** Bollards, lamp masts, pier roofs, ferry rails, moored boats and the çarşı rooftops. A February 2026
    photo series on Commons shows one on the Aya Efimia precinct.
  - **Stealing.** They take food left for the cats and food people drop.
- **Where.** The quay edge, the 1926 pier roof and apron, ferry sterns, the roofs above Yasa Cd, and circling over the
  fish end.
- **Density.**
  - 20–60 on and over the square and the water by day (est.).
  - 5–15 over the fish end (est.).
  - More at every ferry arrival and departure.
- **Sound.** The laughing long call, mewing cries, and the juveniles' whistles in Sept–Oct. The Rıhtım's base sound:
  11 % of "most heard".
- **Build.**
  - *Life*, eye level [ext gull]: a gull perched on a bollard 2–5 m from the player needs a proper rigged model.
    Behaviours:
    - perch and call;
    - hop off when the player comes within about 2 m;
    - hang in the wind over the quay;
    - dive on thrown food;
    - sit in rows on roof ridges.
  - *Life*, distance [have]: beyond about 30 m, reuse the flight world's flocks (`src/world/life/birds/flocks.ts`,
    kinds `coast` and `ferry`).
  - *Sound* [have]: `playGull` in `src/audio/sfx/ambient.ts`. Add a juvenile whistle variant.
  - *Rules*: in Mar–Jun, chicks sit on the pavements (May–Jul), adults dive at people, and a dawn chorus starts around
    05:00. None of this applies in September.
- **When.** S1r: static gulls on 3–5 bollards and the 1926 pier ridge. S5: animated. S6+: shared with the flight world.
- **Src.** [Commons: gull by Saint Euphemia](https://commons.wikimedia.org/wiki/File:Seagull_by_the_side_of_Saint_Euphemia_Greek_Orthodox_Church_in_Kad%C4%B1k%C3%B6y.jpg),
  [milliyet: chicks](https://www.milliyet.com.tr/pembenar/istanbulda-yavrular-artista-kaldirimda-sahilde-goruluyor-once-yuvaya-sonra-kutuya-7381440).

### 5. Ferry pulse (vapur)

- **What.** White-hulled, yellow-funnelled ferries (no operator logo) berth at the 1926 pier and the new pier.
  - **Berthing.** Deckhands throw the ropes, the gangway clanks down, and the ferry gives three short blasts when it
    backs off. The horn is thick and low.
  - **The surge.** Each arrival empties a few hundred people across the square in 2–3 minutes, and the square clears
    again within about 5 minutes.
  - **On board.** Tea in thin-waisted glasses from the buffet, simit, wooden benches at the stern, and musicians
    playing for tips.
  - **Late night.** The last boats leave around 00:00–01:00. After that people head for the dolmuş rank (item 48).
- **Where, when.** The quay edge, both aprons and the square. All day, with peaks at 07:00–09:00 and 17:00–19:30.
- **Density.** Several departures an hour at peak across all lines (est.). A pedestrian surge crosses every few
  minutes at rush hour (est.).
- **Sound.** The horn (13 % of "most heard"), the engine churning the water, ropes and gangway, gulls rising, pier
  announcements and turnstile beeps.
- **Build.**
  - *Life*: vessel agents already exist in the flight world (`src/world/life/vessels`). At street level, a berthing
    ferry with deckhands throwing lines [MH].
  - *Crowd*: each arrival spawns a pulse of 150–400 pedestrians at the pier gates, heading for the crossings, the
    metro and Yasa Cd.
  - *Sound* [have]: `playFerryHorn`. Add the three-blast astern signal, the engine churn and the gangway.
  - *Rules*: driven by a timetable. Lodos cancels sailings (item 63).
- **When.** S3 (stepping off the ferry is S3's deliverable), S5 crowd pulses, S6+ riding on board.
- **Src.** [gazetekadikoy: vapurlar, iskeleler](https://gazetekadikoy.com.tr/yasam/vapurlar-iskeleler-yolcular),
  [istiklal: vapur düdüğü](https://www.istiklal.com.tr/o-her-gun-duydugunuz-vapur-dudugunun-aslinda-gizli-bir-dil-oldugu-ortaya-cikti).

### 6. Simit cart (simit arabası)

- **What.** Kadıköy introduced its own cart in 2014: a cylindrical glass case shaped after the ring of a simit, with
  blue accents.
  - **The cart.** A perforated shelf over a drawer for fallen sesame, a small front counter, a raised wooden
    half-circle for the vendor to stand on, a tarp or umbrella, and a vendor number.
  - **The vendor.** Apron, gloves, tongs and paper bags. The same spot for years.
  - **Other uses.** The cart converts to roasting corn or chestnuts (item 41).
- **Where, when.** On the square (c02 shows one), at metro exits and at the Rıhtım crossings. Not inside Yasa Cd, which
  has bakeries instead. Vendors set up at 06:00–07:00 and work about 12 hours, busiest in the morning commute.
- **Density.** 2–4 around the square and the metro mouths (est.). About one per 100–150 m along the main flows (est.).
- **Sound.** "Taze simit!", "Sıcak sıcak!", paper bags and coins. A customer: "Bir simit abi."
- **Build.**
  - *Prop* [proc]: a generic cylindrical glass cart, inspired by the municipal model but not a copy of it, with no
    logo. Simit stacks as a procedural torus with a sesame normal map, and paper bags.
  - *NPC* [MH + clip]: a vendor loop (tongs, bag, change). A cry every 10–30 s.
- **When.** S1r: the cart at the c02 spot. S4: the player buys a simit. S5: vendor loops.
- **Src.** [ogunhaber 2014](https://www.ogunhaber.com/genel/kadikoye-5-yildizli-simit-arabalari-237198h.html),
  [canguvenir.com](https://canguvenir.com/simit-cart-kadikoy-municipality).

### 7. Call to prayer (ezan)

- **What.** İskele Camii (1761) has a single minaret and a side door onto Yasa Cd, and it calls first. Osmanağa Camii
  (1612) and further mosques follow a few seconds apart, overlapping and echoing. The shops keep trading and the
  street hardly pauses. At Friday noon the sela and the sermon come over the loudspeakers.
- **Where, when.** Heard over the whole strip, loudest on Yasa Cd under the İskele Camii minaret. Five times a day,
  about 3–5 minutes each (est.). The times for 24 Sep are listed under Assumptions.
- **Sound.** An amplified solo voice with delayed echoes from 2–3 other mosques (8 % of "most heard").
- **Build.**
  - *Sound* [ext]: licensed Istanbul recordings, never synthesised. Place them as point sources at the minarets, with
    long reverb, 2–5 s offsets between mosques and occlusion shaping.
  - *Rules*: a prayer-time table by date, and the Friday sela.
  - *NPC*: a few men walk to the mosque door before noon and afternoon prayers. Nothing else changes.
- **When.** S5; S1 has no audio. S6+: the flight world can reuse it.
- **Tone.** Respectful: no gags and no interactions.
- **Src.** [mimdap: İskele Camii](http://mimdap.org/2017/05/sultan-3-mustafa-camisi-yskele-camisi-arif-atylgan/),
  [haberturk: namaz vakitleri](https://www.haberturk.com/namaz-vakitleri/istanbul/kadikoy).

### 8. Shopkeepers' day (kepenk, siftah, kapı önü)

- **What.**
  - **Shutters.** Galvanised shutters rattle up in the morning and come down at night; restaurants stay open. Some are
    pulled down with a hooked pole and padlocked at the bottom.
  - **The first sale.** The siftah counts as a blessing: "Siftah senden, bereket Allah'tan" (the first sale from you,
    the plenty from God).
  - **At the door.** In slack hours shopkeepers sit on low stools with a tea and talk to the next shop. Passers-by say
    "Kolay gelsin" (may it go easy) and get "Sağ ol" back.
  - **Opening.** A broom and a splash of water at opening is common practice, though no Kadıköy source says so.
  - **Inside.** A radio plays Turkish classical or folk music. Some shops go back to 1923 or 1935.
- **Where, when.** Every shopfront. Shutters go up at 08:30–09:30. They come down in a cascade from 20:00 to 22:00, with
  isolated ones until 02:00. Stool-sitting happens mid-afternoon.
- **Density.** In slack hours, one shopkeeper at the door every 2–3 shops (est.). 10–20 shutters come down over an hour
  on 100 m of street (est.).
- **Sound.** A slat-by-slat rattle ending in a bang, then a padlock click. A broom scraping. "Kolay gelsin",
  "Hayırlı işler", "Bereketli olsun". A radio.
- **Build.**
  - *Prop* [have]: kepenks and their closed state already exist. Add a stool, a tea glass and a folded newspaper at
    about 30 % of doors, a hooked pole in a doorway and a padlock.
  - *NPC* [MH]: a shopkeeper schedule (open, sweep, sit, serve, close). A greeting bark on the player's first pass of
    each shop per day.
  - *Sound*: a kepenk rattle in 3–4 variants (synth first, recorded [ext] if it does not convince). A radio per shop,
    using music with a free licence only.
- **When.** S1r stools and props, S4 barks, S5 schedules and the closing cascade.
- **Src.** [dergipark: esnaf study](https://dergipark.org.tr/en/download/article-file/2938243),
  [gazetekadikoy: Kadıköy esnafı](https://www.gazetekadikoy.com.tr/yasam/kadiky-dkkanlari-kadiky-esnafi).

### 9. Tea runner (askılı çay tepsisi, çaycı)

- **What.** A tiny tea kitchen (çay ocağı) with double kettles hides in a passage or a shop corner. A runner carries
  tulip glasses on a round tray hung from a three-rod swinging handle, which stops them spilling. He weaves between
  the shops and comes back later for the empties and saucers. Shopkeepers order by shouting "Çaycı!" down the lane or
  by phone.
- **Where, when.** The whole çarşı by day, heaviest at opening (09:00–10:00) and mid-afternoon.
- **Density.** A runner crosses your path every 2–5 minutes in the market lanes (est.).
- **Sound.** Spoons clinking on glass. "Çaycı!", and "İki çay, biri açık" (two teas, one weak).
- **Build.**
  - *Prop* [proc]: the swinging tray with 2–6 glasses on saucers, empties left on counters and stools, and a çay
    ocağı hatch (double kettle, glass rack) in a side passage.
  - *NPC* [MH + clip]: a runner on a delivery loop between the ocak and 5–10 shops, fast and weaving through the crowd
    with navmesh priority. The clink sound follows him.
- **When.**
  - S1r: static trays and glasses at 2–3 counters.
  - S4: ordering çay (the café scene is the indoor version).
  - S5: runner loops.
  - H: the runner is a fast obstacle, and a collision means broken glasses and a bark.
- **Src.** [kadikoytarihicarsi: çay evi](https://kadikoytarihicarsi.com/2019/02/tarihi-moda-cay-evi/),
  [dailysabah: street sounds](https://www.dailysabah.com/feature/2016/02/16/sights-and-sounds-from-istanbuls-streets).

### 10. Fish stalls in palamut season (balıkçı tezgahı)

- **What.** Fish lie in rows on crushed ice on tilted tables under bare bulbs and awnings.
  - **The work.** Fishmongers in rubber aprons and boots gut and clean fish on the spot. EPS boxes and ice are unloaded
    in the morning. Prices are called out and drop at the end of the day, and the tables are hosed down in the evening.
  - **Water.** The hose water runs downhill towards the Rıhtım, because Yasa Cd climbs 2.1 %.
  - **The catch on 24 Sep.** Palamut dominates: in 2024 one fishmonger said 90 % of customers wanted it. Also
    istavrit, mezgit, tekir and farmed çipura and levrek. Hamsi comes in Oct–Nov.
- **Where, when.** P11, Güneşlibahçe Sk and Yağlıkçı İsmail Sk, open about 09:00–20:30. Busiest in the late morning and
  on Saturdays, with a second rush after 17:00. The hose-down is at 20:00–20:30.
- **Density.** A stall every 4–6 m on both sides of the lane (est.). The awnings nearly meet overhead.
- **Sound.** "Palamut var, palamut!", "Gel abla, taze taze!", knives thudding, ice being shovelled, a hose hissing on
  marble, and "Temizleyelim mi?" (shall we clean it?).
- **Build.**
  - *Prop* [have]: `facade/stalls.ts` already builds the tilted tables, EPS crates and the species (palamut, istavrit,
    hamsi, …). For S1r:
    - set the late-September mix: palamut in at least half of the big-fish rows, and no hamsi crates until October;
    - add wet run-off streaks draining west down the lane joints from P11;
    - add a knife board with scale decals and a coiled hose on a hook.
  - *NPC* [MH + clip]: fishmonger loops (call, gut, wrap, weigh on the hanging scale).
  - *Rules*: calls get louder and prices drop after 18:00, the hose-down comes at 20:00, and a seasonal species table
    sets the catch.
- **When.** S1r species and wet decals, S4 barks, S5 loops.
- **Src.** [gazetekadikoy: palamut mutluluğu](https://www.gazetekadikoy.com.tr/yasam/kadikoy-carsida-palamut-mutlulugu),
  [museumpass](https://museumpass.istanbul/kadikoy-fish-market-in-istanbul/).

### 11. Stickers and posters on everything (çıkartma, afiş)

- **What.**
  - **Stickers.** 5–15 cm stickers layered until the paint of the pole disappears: band and venue stickers, crew
    tags, fan stickers, half-peeled white backing and scraped residue. They run from 0.9 m to 2.2 m and are densest at
    1.4–1.7 m. They also cover sign backs, signal cabinets, bin lids, junction boxes and kepenk guide rails.
  - **Posters.** A3 and A2 sheets, taped or wheat-pasted in overlapping grids of 3–15: concerts, theatre, talks, yoga
    and language courses, and lost pets. Old layers are torn into strips and bleached by rain, with grey scraped
    patches where the municipality stripped them (436 complaints in 2025).
- **Where.** Every signal pole at P2/P3 and P6/P7, lamp columns and bollards on Yasa Cd, and the bins and stop pole on
  the square. Posters go on hoardings, cabinets, container sides and tree trunks.
- **Density.**
  - Stickers: 10–40 per crossing pole, 3–15 per lamp column, 5–20 per bin (est.). Nothing above about 2.5 m.
  - Posters: one cluster every 20–40 m of blank wall (est.).
- **Build.**
  - *Decal* [proc, partly have]: `streetWear` in `facade/build.ts` already puts posters, stickers and tags on the
    piers and shut kepenks. Extend it to the street furniture (poles, cabinets, bins, sign backs) with a sticker atlas
    of fictional designs, and add peeled-backing and residue layers, torn and bleached poster layers and scraped
    rectangles.
  - Keep the ≥ 5 mm offsets the layer already uses, to stay within checklist item 7 (no z-fighting on decals).
  - *Rules*: new layers appear overnight before weekends, and rain peels them (S5+).
- **Tone.** Neutral generic posters only (Konser, Tiyatro, Yoga, Kayıp kedi, invented band names). No party, protest
  or slogan content, and no real logos.
- **When.** S1r. It is cheap and very visible.
- **Src.** [nomadearthcatalog](https://nomadearthcatalog.com/kadikoy/),
  [cevre.kadikoy.bel.tr](https://cevre.kadikoy.bel.tr/icerik/goruntu-kirliligi-analizi-ve-temizligi-calismalari).

### 12. Shop cats (esnaf kedileri)

- **What.** Named cats that belong to a particular shop. Documented Kadıköy cases include a pharmacy with three
  regulars, a boutique cat asleep on the dresses in the window, restaurant residents of 13 years fed chicken every
  day, and a bookshop cat. Shopkeepers pool leftovers, such as spare chicken from a döner shop. There is a bowl at the
  door or behind the counter, and sometimes a shop dog as well.
- **Where.** The çarşı and fish lanes, Moda Cd and Bahariye. On the strip: the Yasa Cd shops, the deli and produce
  stalls, and the fish end.
- **Density.** One in 5–10 shopfronts (est.).
- **Sound.** The shopkeeper calling the cat by name, and a ceramic bowl set down on the threshold.
- **Build.**
  - *Prop* [proc]: the cat's own ceramic bowl, sometimes with a name in marker, and a cushion or basket in the window.
  - *Life*: the cat's home spot is inside the shop, and it follows the shopkeeper to the door.
  - *NPC* (ink): every hero shopkeeper has a named cat, with fictional names such as Pamuk, Duman, Tarçın or Şeker.
    Bark: "Paşa, gel buraya!" *(new)*. The cat opens conversations ("Adı ne?").
- **When.** S4: the S4 café owns a cat, which is cheap and memorable. S5: one per hero NPC. H: the client's cat.
- **Src.** [gazetekadikoy: esnaf kedileri](https://www.gazetekadikoy.com.tr/yasam/kadiky039n-esnaf-kedileri).

### 13. Simit to the gulls (vapurdan martıya simit)

- **What.** Passengers stand at the open stern and throw pieces of simit. The gulls hang at deck height in the wind,
  and the boldest take pieces from raised hands. The flock follows the ferry out. Smaller versions happen from the
  1926 pier apron and the quay edge. Experts say bread harms gulls, but the ritual goes on.
- **Density.** 10–30 gulls trail each departing ferry for the first minutes (est.). 2–6 people feed them (est.).
- **Sound.** Gull cries rising with the horn, and people laughing.
- **Build.**
  - *Life*: a gull food-swarm behaviour around a thrown-crumb target.
  - *NPC* [MH]: 1–3 passengers per departure with a throwing loop.
  - *Player* (S4): buy a simit (item 6) and throw it.
  - Optional NPC line that keeps it honest: "Simit martıya iyi değilmiş ama…"
- **When.** S4 on the quay, S5 NPCs, S6+ on board.
- **Src.** [hurriyet](https://www.hurriyet.com.tr/dunya/martilara-neler-oluyor-vapurda-simit-atarken-iyilik-etmiyoruz-41749429).

### 14. T3 nostalgic tram and its bell (nostaljik tramvay)

- **What.**
  - **The trams.** Two-axle German trams of the Gotha T57 and Rekowagen types.
  - **The route.** A 2.6 km single-track loop, clockwise only: Kadıköy, Altıyol, Bahariye, Moda. The "İskele Cami"
    stop has an oval sign at the P7 crossing. On Bahariye the tram moves at walking pace through pedestrians.
  - **Service.** Weekdays 06:55–21:00, Saturday 08:30–21:00, Sunday 10:00–20:00. One tram every 7 minutes at peak and
    every 10–15 minutes otherwise, carrying about 2,000 riders a day.
- **Sound.** The bell that goes "çın çın" before crossings and at pedestrians. Steel wheels grinding in the embedded
  rail, flange squeal on the tight corners and a hum from the overhead wire (3 % of "most heard").
- **Build.**
  - *S1*: the rails and the stop sign already exist.
  - *Vehicle*: the tram model (S5 already plans the tram).
  - *Sound* [proc]: the bell by modal synthesis, and a wheel-squeal synth.
  - *Rules*: the timetable. The 2026 suspensions are not modelled.
- **When.** S5. H: the tram blocks the lane.
- **Src.** [Wikipedia: T3](https://tr.wikipedia.org/wiki/T3_(%C4%B0stanbul_Tramvay%C4%B1)),
  [gazetekadikoy: Bahariye](https://www.gazetekadikoy.com.tr/yasam/kadikyn-baharligi-bahariye-caddesi).

### 15. Graffiti on closed shutters (kepenk grafitisi)

- **What.** When the shutters come down at night, nearly every one carries at least one tag, throw-up or character, in
  black, silver or chrome and bright colours. Some pieces are commissioned. A new shutter sometimes has a taped note
  asking painters to give it a few days. By day the art disappears into the coil boxes.
- **Where, when.** The çarşı, Yasa Cd and Güneşlibahçe after closing, from about 21:00–22:00 to 08:00–09:00.
- **Density.** 80–90 % of closed shutters, with 1–3 pieces each. The source says "almost all", but the evidence is
  only at the level of search snippets.
- **Build.** *Decal* [proc, partly have]: tags on shut kepenks already exist. Raise the coverage to 80–90 %, and add
  larger throw-ups, one or two characters across a whole shutter, and a taped A4 note on one new shutter. It is only
  visible in night cameras.
- **When.** S1r. The shuttered kiosk at ch 131–135 in c11 is the test.
- **Src.** [tuncdindas: kepenk graffiti](https://tuncdindas.com/etiket/kepenk-graffiti/).

### 16. Night food: midye and kokoreç (midyeci, kokoreççi)

- **What.**
  - **Midye.** A round aluminium tray on a folding stand holds mussels fanned out in rings, with lemon wedges and a
    bucket for empty shells. The vendor pops each shell, squeezes lemon over it and hands it over. People eat standing,
    use the top shell as a spoon and pay per piece. Lit mussel counters near the pier stay open until about 02:00.
  - **Kokoreç.** Lamb intestines roast on a horizontal spit over coals, are chopped fine with a cleaver, and are served
    in half a loaf and eaten on stools outside: the last meal of the night. A büfe at the Kadife Sk corner has outdoor
    stools and weekend queues until about 04:00.
- **Where, when.**
  - Midye trays: from dusk on the Rıhtım, Muvakkıthane Cd and Moda Cd.
  - A lit mussel counter on Rıhtım Cd, a few metres from the Yasa Cd entrance.
  - Kokoreç: 23:00–04:00 at weekends, in waves at 23:30–00:30 (concerts letting out) and at 02:00 (bars closing).
- **Density.** 1–3 trays around the square in the evening (est.), a lit counter every 100–200 m in the core (est.),
  and 10–30 people standing at a kokoreç büfe on weekend nights (est.).
- **Sound.**
  - Calls: "Midye, midye dolma!", "Bir tane daha?" (one more?), "Kaç oldu?" (how many is that?).
  - Shells clacking into the bucket.
  - The cleaver's fast rhythm on the board and the sizzle of the griddle, which is the strongest night cue.
- **Build.**
  - *Prop* [proc]: the tray on its stand, lemons, the shell bucket, empty-shell decals at the kerb, and a kokoreç spit
    and board.
  - *NPC* [MH + clip]: vendor loops, and standing customers.
  - *Rules*: trays from 17:00, kokoreç after 23:00.
- **When.** S1r: one tray stand at P8 (c11 is a night camera). S5: loops. S6+: Kadife.
- **Tone.** No named real sellers or shops.
- **Src.** [gazetekadikoy: 16 yıldır aynı yerde](https://www.gazetekadikoy.com.tr/yasam/16-yildir-tezghiyla-ayni-yerde),
  [yemek.com: kokoreççiler](https://yemek.com/istanbuldaki-kokorecciler/).

### 17. Meyhane tables at the fish end (meyhane, fasıl)

- **What.** As the fish stalls wind down, the fish restaurants and meyhanes set tables along both sides of the lane:
  rakı glasses, white meze plates and grilled fish. On weekend fasıl nights, Roma musicians with clarinet, violin,
  darbuka and kanun move from table to table. Cats circle for scraps.
- **Where, when.** Güneşlibahçe Sk and the lanes next to it, which is the S1 fish end, and Moda Cd. Tables fill from
  19:30–20:00 and peak at 21:00–23:30. Fasıl is mostly on Friday and Saturday.
- **Density.** About one table per 1.5 m of frontage (est.). Full on weekend nights, half full on weeknights (est.).
- **Sound.** Cutlery, toasts ("Şerefe!"), clarinet and darbuka, and waiters calling orders.
- **Build.**
  - *Prop* [have partly]: the café sets exist. Add a night dressing for the fish end: paper tablecloths, rakı glasses,
    water carafes and meze plates.
  - *NPC* [MH + clip]: seated diners, roving musicians and waiters.
  - *Rules*: the stalls switch to tables at about 20:00, after the hose-down.
- **When.** S1r night variant (c10-night), S5 animated.
- **Tone.** Alcohol is present but not the focus.
- **Src.** [gazetekadikoy: Balıkçı Ethem](https://www.gazetekadikoy.com.tr/yasam/baliki-ethemin-gznden-kadiky-arsisi),
  [mudavim: meyhaneler](https://mudavim.net/kadikoy-meyhaneleri/).

### 18. Yellow and navy, and match nights (sarı-lacivert)

- **What.**
  - **Every day.** Yellow-and-navy flags and pennants in shop windows, on taxi mirrors and on balcony railings, and fan
    stickers on the poles.
  - **Match days.** Fans in scarves come off the ferries and walk 15–30 minutes to the stadium, by Söğütlüçeşme and
    Kuşdili Cd or by Bahariye. Scarf sellers work the route and the police presence is heavy.
  - **From a distance.** A goal's roar carries streets away, and flares tint the sky red.
  - **After a win.** Horns and flags from car windows late into the night.
- **Where, when.** The colours are everywhere, every day. On match days the build-up starts 2–3 hours before an
  evening kick-off (about 20:00–21:45), and the crowd flows back for about 90 minutes after the final whistle.
- **Density.**
  - A flag or pennant every 30–60 m of shopfront (est.).
  - 1–3 balcony flags per block face (est.).
  - On match days, 50–200 people per 10 m of approach street (est.).
- **Build.**
  - *Prop* [proc]: plain yellow-and-navy striped flags and pennants, with no crest and no club name.
  - *Rules*: a match-day event (S5) that turns on:
    - the crowd flow;
    - scarf sellers;
    - a distant bed of chants and drums [ext];
    - a flare glow over Kuşdili;
    - after a win, a car-horn convoy.
- **When.** S1r flags, S5 match-day event, H the "match day near the stadium" event already in the plan.
- **Tone.** Colours only, and no fan conflict.
- **Src.** [liberoguide](https://liberoguide.com/fenerbahce/),
  [Wikipedia: Kadıköy](https://en.wikipedia.org/wiki/Kad%C4%B1k%C3%B6y).

### 19. Street musicians (sokak müzisyenleri)

- **What.**
  - **Square.** Buskers with a permit card play at a few designated points on the square from 19:00 to 21:00.
  - **Bahariye.** Pedestrianised for about 25 years, it has always had musicians: a violinist in front of closed
    shops, and an older, well-dressed accordionist playing nostalgic tunes.
  - **Elsewhere.** Students with guitars on the Moda lawns and rocks at sunset, and musicians on the ferries.
  - **Enforcement.** The zabıta moves unlicensed buskers on.
- **Density.** 1–3 audible at once on Bahariye in the evening, and 1–2 on the square during the permitted window
  (est.). Street musicians are 2 % of "most heard".
- **Sound.** Violin, accordion, acoustic guitar through a small battery amp and darbuka. Coins dropping into an open
  case, and applause from a small ring of people.
- **Build.**
  - *NPC* [MH + clip]: playing loops for each instrument, and an open case with coins [proc].
  - *Crowd*: an attractor that draws a ring of 5–30 listeners.
  - *Sound* [ext]: tunes with a free licence or written for Seventeen Skies only, so they stay streamer-safe.
  - *Rules*: the 19:00–21:00 window on the square, and more on weekends.
- **When.** S5 on the square and Bahariye, S6+ in Moda.
- **Src.** [cumhuriyet: sokak müziği](https://www.cumhuriyet.com.tr/haber/ozgurluk-sehirlerinde-sokak-muzigi-nasil-yapiliyor-253591),
  [gazetekadikoy: Bahariye](https://www.gazetekadikoy.com.tr/yasam/kadikyn-baharligi-bahariye-caddesi).

### 20. The Boğa as a meeting point (Boğa'da buluşmak)

- **What.** A bronze bull by Isidore Bonheur (1864) has stood at Altıyol since 1987. "Boğa'da buluşalım" (let's meet
  at the Bull) is the standard arrangement. A loose ring of people always waits there on their phones, waves to
  arriving friends and takes photos with the bull. Around it: colourful seats round the tree opposite (2017), flower
  buckets, and shoe shiners with brass-clad wooden boxes embossed with suns and crescents, a footrest on top and a row
  of polish bottles.
- **Where, when.** Altıyol, all day, peaking at 19:00–22:00 on Friday and Saturday.
- **Density.** 10–30 people waiting at any moment in the evening, turning over every few minutes. 1–3 flower buckets
  and 1–2 shoe shiners (est.).
- **Sound.** Traffic circling and horns. "Boğa'dayım, neredesin?" (I'm at the Bull, where are you?), camera shutters,
  and "Boyayalım abi?" (a shine, brother?).
- **Build.**
  - *Hero*: the statue is on the S5 hero list. The 1864 work is in the public domain.
  - *NPC*: "waiting" slots with phone clips [MH], and pairs that meet and leave together.
  - *Prop* [proc]: the shoe-shine box, with the shiner's loop [clip].
- **When.** S5.
- **Src.** [gazetekadikoy: buluşma noktası](https://www.gazetekadikoy.com.tr/yasam/bulusma-noktasi-altiyol-boga),
  [timeout](https://www.timeout.com/istanbul/tr/blog/bogada-bulusmak-artik-daha-kolay-110317).

### 21. Moda rocks at sunset (Moda sahili)

- **What.** Groups of friends sit on the rocks at the water's edge and on the grass slopes, with beer or wine, cracking
  sunflower seeds and dropping the shells. Someone has a guitar and the group sings along. At sunset the view is the
  Historic Peninsula skyline, with the Islands to the left. By day there are hammocks and slacklines, and in the
  evening poi spinners and anglers. Bottles and shells are left behind.
- **Where, when.** The rocks towards Moda Burnu and the grass above them. From late afternoon to after sunset (19:06 on
  24 Sep). Busiest in summer and at weekends; nearly empty in winter.
- **Density.** On summer evenings, a group every 2–3 m on the rocks and blankets of 3–8 people every ~5 m on the grass
  (est.). About half that in the shoulder season.
- **Sound.** Water slapping the rocks, seeds cracking, a guitar with singing, small speakers, distant ferry horns and
  gulls.
- **Build.** *NPC*: seated groups [MH]. *Prop* [proc]: bottles, seed-shell decals and blankets. *Rules*: density
  follows sunset and the weather.
- **When.** S6+. Moda is outside S5; the Moda Burnu landing pad comes in S6.
- **Src.** [gazetekadikoy: Moda sahili](https://www.gazetekadikoy.com.tr/yasam/moda-sahili-neden-popler),
  [rotasenin](https://www.rotasenin.com/kadikoy-moda-sahil-parki).

### 22. Kadife Sk's standing crowd (Barlar Sokağı)

- **What.**
  - **The street.** About 200 m, with around 30 venues in about 36 old buildings.
  - **The crowd.** Pavement tables have been banned since 2013 and the pavements are about 1 m wide, so people stand in
    the roadway holding bottles and cans.
  - **The noise.** Every door leaks different music. Concert let-outs pour crowds in black band T-shirts into the
    street.
  - **Between the bars.** Büfes and tattoo parlours. Empties collect on the kerbs and doorsteps.
  - **Closing.** The bars close at 02:00 (moved from 04:00). Moda bans live music outdoors from 00:00 to 07:00, so
    after midnight the music carries on behind closed doors.
- **Where, when.** Caferağa, from the cinema corner on Bahariye towards Moda Cd. The crowd forms from about 21:00, and
  the street is solid on Friday and Saturday from 23:00 to 02:00. Calm by day.
- **Density.** 1–2 people per m² at the weekend peak (est.). 5–15 outside each open door on weeknights (est.).
- **Sound.** Overlapping music from each doorway (muffled bass, full volume when a door opens), talk and laughter,
  bottles clinking and rolling, and shouting after 01:00.
- **Build.**
  - *NPC* [MH]: standing groups holding drinks.
  - *Sound*: door emitters with muffling.
  - *Prop* [proc]: bottles on ledges, and a morning-after litter layer.
  - *Rules*: the 22:00 sales cutoff (item 47), the 02:00 close and Moda's 00:00 music rule.
- **When.** S6+. The mouth of the street touches Bahariye, at the S5 boundary.
- **Tone.** Every bar is fictional. Do not recreate the recognisable real bars.
- **Src.** [gazetekadikoy: Kadife Sokak](https://www.gazetekadikoy.com.tr/gundem/kadife-sokak-zgrlk-m-rahatsizlik-mi),
  [theothertour](https://theothertour.com/kadikoy-nightlife/).

### 23. Mural façades (Mural-İst)

- **What.** 30–40 whole-façade murals painted since 2012 with municipal support, some up to ten storeys. They are in
  Yeldeğirmeni (İskele Sk, Karakolhane Cd, Misak-ı Milli, Talimhane, Nakil and Kır Kahvesi) and in Moda (Ağabey Sk,
  the Moda stairs, Hacı Şükrü Sk). Since the pandemic, more of this wall space has gone to adverts.
- **Density.** In Yeldeğirmeni a mural is visible from almost every corner of İskele Sk, Karakolhane and Misak-ı Milli.
- **Build.** The murals are copyrighted artworks, and some portray real people, so the game must not reproduce them.
  Put original large murals on the same walls, at the same scale and density, either commissioned or made for Seventeen Skies
  under a free licence [ext art].
- **When.** S6+.
- **Src.** [bayaiyi: Yeldeğirmeni guide](https://bayaiyi.com/yeldegirmeni-sokak-sanati-rehberi/),
  [kadikoy.bel.tr](https://www.kadikoy.bel.tr/tr/haber-detay/kadikoyde-duvarda-sanat-var-4861).

## Strong

### 24. Cat houses (kedi evi, kulübe)

- **What.** Four kinds:
  - wooden municipal houses in parks since about 2014: a small pitched roof and a round door;
  - volunteer-built houses spray-painted by children with cat drawings and a line saying the house is a cat's home
    (more than 200 made at a festival in Yoğurtçu Park);
  - "mini-mansion" houses built by carpenters;
  - winter shelters made from cardboard boxes or EPS fish crates, wrapped in packing tape and bin bags, with a plastic
    flap over the door.

  Houses also stand outside partner cafés in Caferağa and Osmanağa, and at some bus stops with bowls.
- **Where.** Clusters of 3–10 in parks. 0–2 per 100 m on the çarşı lanes.
- **Build.**
  - *Prop* [proc], four variants: wooden, child-painted, an EPS crate with tape and a flap, and a cardboard box with a
    blanket.
  - *Life*: a slot for a cat asleep in the doorway.
  - *Rules*: the cardboard and EPS variants swap in from November to March.
- **When.** S1r: 1–2 wooden houses at café fronts or against the precinct wall, and one EPS shelter at the fish end,
  where EPS crates are everywhere.
- **Src.** [kadikoy.bel.tr: kediler üşümeyecek](https://www.kadikoy.bel.tr/tr/haber-detay/kadikoyun-kedileri-usumeyecek-4900),
  [animalsaveturkey](https://animalsaveturkey.org/sokaklar-hepimizin-kedi-evleri/).

### 25. Ear-tagged street dogs (küpeli sokak köpekleri)

- **What.** Large, calm, heavy mixed-breed dogs of the Anatolian "Karabaş" type: tan, black-masked or blond. They lie
  flat on warm paving for hours, gather along the waterfront and sometimes ride the ferries. A numbered plastic ear
  tag (usually yellow, sometimes red or turquoise) marks a dog as vaccinated, sterilised and chipped. There are fewer
  of them than before the 2024 law, but they were still photographed on the pier in April and June 2026.
- **Where, when.** The square and the Rıhtım promenade, near the pier gates, turnstiles and benches, sleeping in the sun
  by day. Rare in the çarşı lanes.
- **Density.** 1–2 on the square at a time (the baseline in Assumptions). None on Yasa Cd, and never packs.
- **Sound.** Quiet by day. At night, barking at couriers' motorbikes, and howling at sirens.
- **Build.**
  - *Life* [ext dog]: behaviours:
    - long sleeps on the side, shifting between sun and shade;
    - lying up like a sphinx;
    - getting up, stretching and moving to a new spot;
    - sniffing and scratching;
    - barking at passing mopeds at night.

    A dog never approaches aggressively, and the crowd flows round it as a navmesh obstacle. The ear tag is part of
    the model.
- **When.** S5. H: a dog asleep across a doorway on the route ("uyandırma!"), which forces a slow detour.
- **Tone.** Dogs appear as neighbours. The collections and the protests are not depicted.
- **Src.** [Commons: köpek at Kadıköy İskelesi, 2026](https://commons.wikimedia.org/wiki/File:Kad%C4%B1k%C3%B6y_%C4%B0skelesinde_k%C3%B6pek.jpg),
  [gazetekadikoy: vapura binemez mi](https://www.gazetekadikoy.com.tr/yasam/sokak-hayvanlari-vapura-binemez-mi).

### 26. Pigeons that scatter (güvercin)

The research rated this *nice*; it is raised here because the scatter reaction is a core beat of ambient life.

- **What.** Grey city pigeons walk the square's paving and roost on ledges and cornices (Haldun Taner, the pier
  buildings). People drop simit crumbs. Unlike Eminönü, Kadıköy has no seed sellers.
- **Where.** The square and the P0 bus-stop area, the eaves of Haldun Taner, and around the simit cart and benches.
- **Density.** A flock of 10–40 on the square, and a few on the çarşı roofs (est.).
- **Sound.** Cooing, and a clatter of wings when the flock lifts.
- **Build.**
  - *Life* [have partly]: `src/world/osm/details/waterfront/pigeons.ts` (the Galata slice) already struts, pecks and
    bursts in the vertex shader at no CPU cost. Port it and add player triggers:
    - walking parts the flock, with birds hopping 0.5–1 m aside;
    - running makes it burst, wheel once and land again after 15–40 s;
    - crumbs attract it.
  - At 2 m the current 8-part mesh is too crude, so it needs a rigged or VAT-baked pigeon [ext].
- **When.** S3 (walking off the ferry through the flock), S5.
- **Src.** [Commons: pigeons in Kadıköy](https://commons.wikimedia.org/wiki/File:Pigeons_in_Kad%C4%B1k%C3%B6y,_Istanbul,_Turkey_-_20130106.jpg).

### 27. Volunteer feeders' rounds (mamacı teyze, gönüllü besleyiciler)

- **What.** Mostly older women, but also men and students, walk a fixed route with a two-wheeled shopping trolley or
  bags of dry kibble (15 kg sacks) and water bottles. They refill the same bowls every day and sometimes leave wet food
  on paper. The cats wait at the spots before they arrive. In winter, municipal teams also hand out food.
- **Where, when.** Everywhere there are bowls, at dawn (06:00–08:00) and at dusk.
- **Density.** 1–2 feeders an hour per lane at dawn and dusk. Each round serves 5–20 spots (est.).
- **Sound.** Trolley wheels on the paving, a bag rustling, "pisi pisi" and a chorus of meows.
- **Build.**
  - *NPC* [MH + clip for crouching to pour]: a scheduled agent whose route nodes are the bowls of item 2, with a
    trolley prop [proc].
  - *Life*: cats gather 1–3 minutes before the feeder arrives.
  - *Barks*: "Pisi pisi" (sourced); "Gel güzelim, gel" and "Acıktınız mı?" *(new)*.
  - Ink seed for later: help carry the sack (S8).
- **When.** S4 barks, S5 agent.
- **Src.** [sondakika: kış hazırlıkları](https://www.sondakika.com/guncel/haber-kadikoy-belediyesi-kis-hazirliklarini-tamamladi-18361055/).

### 28. The bus-stop cat (durak kedisi)

- **What.** Many bus shelters have a resident cat that sleeps on the bench or under it. Volunteers set up a cardboard
  house and a pair of bowls. A local paper that walked from Kadıköy to Bostancı found a cat at almost every stop. It is
  kept as its own item because it is the first cat the player meets off the ferry.
- **Build.**
  - *Prop*, S1r: at P0, a bowl pair, a cardboard house and a cat slot at the end of the bench.
  - *Life*: the cat leaves the bench when waiting passengers crowd it, and comes back afterwards.
- **When.** S1r, S5.
- **Src.** [gazetekadikoy: durak kedileri](https://www.gazetekadikoy.com.tr/yasam/kadikoy-duraklarinin-kedileri).

### 29. Ear-tip notch (kırpık kulak)

- **What.** A small triangular notch cut from the edge of one ear marks a street cat as sterilised. Kadıköy's project
  sterilised 5,500 cats in five years, and the municipality sterilises about 4,800 a year.
- **Density.** Roughly a third to a half of adult cats in central Kadıköy (est.).
- **Build.** A mesh or alpha variant of the cat asset, for the left or right ear. This is part of the cat asset spec.
- **When.** S5, with the cat asset.
- **Src.** [gazetekadikoy: kırpık kulaklar](https://gazetekadikoy.com.tr/yasam/kirpik-kulaklar-is-basinda).

### 30. Anglers on the quay (olta balıkçıları)

- **What.** Men with long rods and multi-hook çapari rigs for istavrit and mezgit, and lüfer in autumn. Each has a
  bucket, a bait box, a folding stool, a small headlamp and a radio. Cats sit beside the buckets waiting for undersized
  fish; a viral video shows one lifting a fish out of a bucket. Gulls hover close.
- **Where, when.** The Rıhtım quay edge, which is a night-fishing spot, the Haydarpaşa breakwater and the Moda pier and
  rocks. At 17:00–21:00 and 05:00–09:00, most of all in autumn.
- **Density.** 3–10 anglers along the quay in the evening, each with 1–2 cats and a few gulls (est.).
- **Sound.** A line whirring out, a sinker plopping, reel clicks, a fish flapping in the bucket, and a radio.
- **Build.**
  - *Prop* [proc]: rod, bucket with fish, bait box and stool.
  - *NPC* [MH + clip for casting and reeling].
  - *Life*: a cat slot waiting by the bucket, and a rare theft event.
- **When.** S1r: the static kit at the quay rail in night views. S5: animated.
- **Src.** [gazetekadikoy: olta balıkçılığı](https://www.gazetekadikoy.com.tr/yasam/olta-balikiligi-bir-tutku).

### 31. Akmar Pasajı: books, records and their cats (sahaf, plakçı, sahaf kedisi)

- **What.** Akmar Pasajı opened in 1982 in a former school building on Mühürdar Cd. Long corridors of second-hand
  bookshops have stacks and crates spilling into the passage, with record, antique and studio shops among them. The
  owners serve tea while they talk music. Cats sleep on piles of old books. In 2019 the centre had about 13 record
  shops, in Akmar, Kefeli Pasajı, Sakızgülü Sk and Serasker Cd.
- **Where, when.** Just off the P10 junction plaza, about 10:00–20:00.
- **Sound.** Records playing from shop doors with vinyl crackle, pages turning, bargaining, tea glasses. And the quiet.
- **Build.**
  - *Interior*: the planned han/pasaj L3 shell, with a book-stack and record-crate kit [proc].
  - *Life*: a cat slot on the book piles.
  - *Sound*: music with a free licence or written for Seventeen Skies only [ext].
- **When.** S5. It is a natural choice for one of the five enterable places.
- **Src.** [tr.wikipedia: Akmar Pasajı](https://tr.wikipedia.org/wiki/Akmar_Pasaj%C4%B1),
  [gazetekadikoy: sahaflık tarihi](https://www.gazetekadikoy.com.tr/yasam/kadikyn-sahaflik-tarihi).

### 32. Balconies and windowsills (çamaşır, çanak anten, cam balkon, kedi filesi, saksı)

- **What.**
  - Laundry on metal pulley racks clipped to the railings or on folding racks: sheets, towels, children's clothes.
    Rugs aired over the railings.
  - Satellite dishes bolted to balcony railings.
  - An aluminium glass enclosure on one balcony and not on its neighbour.
  - Striped fabric balcony awnings, and plastic chairs with a small table.
  - Green or black cat-safety nets on the balconies of cat owners.
  - Geraniums, basil and mint in old olive-oil tins and white yogurt buckets.
  - Ficus, olive or bay trees in pots at café doors, and buckets of cut flowers outside shops.
- **Density.**
  - 30–50 % of balconies show laundry on a sunny day (est.).
  - 1–2 dishes per building (est.).
  - Cat nets on 5–10 % of balconies (est.).
  - Plants on 20–40 % of sills and balconies, and 1–3 pots per café front (est.).
- **Sound.** A pulley squeaking, clothes-pegs clicking, a rug beaten over a railing in the morning, and water dripping
  from a watered balcony.
- **Build.**
  - *Prop* [proc]: laundry racks with cloth strips (wind flutter in a vertex shader), a cat net as an alpha mesh,
    balcony awnings, and tin and bucket pots.
  - *Prop* [have]: Potted Plant 04 and Planter Pot Clay.
  - *Rules*: no laundry in rain, more at weekends.
- **When.** S1r: T1 fronts are about 60 % of the strip, and the spec already has about 40 % of balconies glazed. H:
  balcony-hoist jobs pass through the laundry lines.
- **Src.** [theintrovertraveler](https://www.theintrovertraveler.com/post/kadikoy-and-street-art-when-istanbul-stops-being-imperial-and-becomes-contemporary),
  [nomadearthcatalog](https://nomadearthcatalog.com/kadikoy/).

### 33. Façade services: gas risers, flues, drips (doğalgaz borusu, kombi bacası, klima suyu)

- **What.** Four things the S1 kit lacks:
  - **Gas risers.** Yellow-painted steel pipes (Ø 25–50 mm) running up and along the façade, with a grey meter or
    regulator box near the entrance.
  - **Boiler flues.** Short white or grey combi-boiler terminals poking 20–40 cm out beside the windows. Each has a
    black soot fan above it and drip marks below, and gives off white vapour on cold mornings.
  - **AC condensate.** Hoses dripping onto the awnings and the paving in Jul–Sep, leaving wet spots and dark streaks.
  - **Cable coils.** Loops of spare cable hanging from the junction boxes.
- **Density.** One gas riser per building, one flue per flat, and wet spots under about one in three AC units in
  summer (est.).
- **Sound.** Drips tapping on fabric awnings, the hum of the AC units, a faint boiler whoosh in winter.
- **Build.**
  - *Prop* [proc], additions to the façade builder: risers as routed cylinders, flue terminals with a soot decal, and
    cable coils.
  - *Decals*: wet spots on the lane under the AC units.
  - *Rules*: drips in summer, vapour plumes in winter.
- **When.** S1r. They are cheap and add depth planes to the façades.
- **Src.** [servisjet: kombi bacası](https://www.servisjet.com/blog/kombi/kombi-bacasindan-su-gelmesi-ve-su-damlamasi-neden-olur-kombi-bacasindan-neden-su-akar/).

### 34. Pavement spill-over (kaldırım işgali)

- **What.** The municipality's own enforcement list works as an inventory of the clutter:
  - tables, chairs and mushroom heaters;
  - windbreak screens (vinyl or glass) set across the pavement;
  - projecting console signs;
  - greengrocer crates and hanging produce;
  - mannequins and clothing racks;
  - A-boards;
  - 19 L water carboys and gas cylinders stacked outside a bakkal (corner shop);
  - low plastic stools at tea stalls and büfes.
- **Where, when.** Yasa Cd café fronts, the fish and produce end, Moda Cd and Kadife Sk. Heaters and windbreaks from
  October to April.
- **Density.** Almost every shopfront pushes 0.5–2 m onto the lane. In winter about one café in three has a
  windbreak or a heater (est.).
- **Sound.** Chair legs scraping at opening and closing, and the gas hiss of the heaters.
- **Build.**
  - *Prop* [proc]: a carboy stack, a gas-cylinder cage, a clothing rack (the mannequin reuses `st_person`), a
    windbreak and a mushroom heater.
  - *Prop* [have]: café sets, chalkboards and the monobloc chair.
  - *Rules*: the winter set swaps in. H: all of it is in the way.
- **When.** S1r: carboys, racks and stools. S5: the winter set.
- **Src.** [Moda shopkeeper booklet (PDF)](https://anlat.kadikoy.bel.tr/kbpanel/Uploads/Files/modasemtiesnafinayonelik_bilginotlari.pdf).

### 35. Ground residue and patches (izmarit, çekirdek kabuğu, yama)

- **What.**
  - **Litter.** Cigarette butts in the paver joints, tree pits, the pier exits, the bus stop and around the bench legs,
    plus standing ashtrays outside cafés. Sunflower-seed husks in small piles round the benches. Simit crumbs, with
    pigeons working them. Chewing-gum spots.
  - **Patches.** Asphalt patches as darker, slightly raised rectangles over trenches, especially around the T3 rails.
    Pavers relaid after a dig in a different tone. Covers standing about 3 cm proud. Weeds in the joints.
  - **Damage.** Bent or leaning bollards, and stub holes where one is missing.
- **Density.**
  - Butts: 5–20 per m² at the pier exits and the bus stop (est.), and about one per m² mid-lane after the
    07:00–09:00 sweep, rising through the evening (est.).
  - Patches: 1–3 zones per 50 m (est.).
- **Sound.** A loose paver clacking underfoot.
- **Build.**
  - *Decals and small instances* [proc]: butts, husk piles, gum spots and paver-tone patches.
  - *Geometry*: raised cover offsets and one leaning bollard.
  - *Rules*: litter builds up through the day and the dawn sweep resets it.
- **When.** S1r. It is cheap and answers the S1 critique that "everything is too clean".
- **Src.** [sikayetvar: kaldırım](https://www.sikayetvar.com/kadikoy-belediyesi/kaldirim),
  [gazetekadikoy: fotoğraflı Kadıköy tarihi](https://www.gazetekadikoy.com.tr/yazarlar/emre-musazlioglu/fotografli-kadikoy-tarihi-10).

### 36. Wall tags and painted-over patches (duvar yazıları)

- **What.** Spray-can slogans and one-liners at 1–2.5 m, plus hand tags and stencils on plinths, stair passages and
  handrails. Where walls have been cleaned, flat rectangles of fresh paint in a slightly different beige or grey leave
  a patchwork on the render.
- **Density.** A tag every 5–15 m of plain plinth wall, and 1–2 painted-over patches per side wall (est.). Lighter on
  Yasa Cd, whose fronts are mostly glass and signs.
- **Build.** *Decal* [proc]: tags already exist in `streetWear`. Add the painted-over rectangles. All text is invented
  and has no political content.
- **When.** S1r.
- **Src.** [Commons: graffiti in Kadıköy, 25.04.2026](https://commons.wikimedia.org/wiki/File:Graffiti_in_Kad%C4%B1k%C3%B6y,_%C4%B0stanbul_25.04.2026_01.jpg).

### 37. Street signs, plaques, intercoms and taped notes (sokak tabelası, kapı numarası, apartman tabelası)

- **What.**
  - **Street signs.** The İBB standard since about 2005–07: crimson with white lettering in three bands (the street
    name with the door-number range, then the mahalle, then a district stripe). A small matching number plate at
    every entrance. Older blue-and-white plates and pre-1950 maroon enamel signs survive on some old buildings.
  - **Apartment doors.** "… APARTMANI" in brass letters or on a marble plaque above the door. Intercom panels with
    8–20 buttons labelled on tape or by hand.
  - **Taped notes.** "Kapıyı kapatınız", "Kapı önüne park etmeyiniz", "Tatildeyiz", "Devren kiralık", and lost-pet
    notices.
- **Where.** Building corners at 2.5–3 m at every junction on the strip (Yasa × Tavus, Yasa × Mühürdar, Güneşlibahçe,
  Yağlıkçı İsmail), and the 13 inferred doors on Yasa Cd.
- **Density.** A sign on each corner of every junction and a plate at every entrance. A taped note on about one door or
  shutter in three (est.).
- **Sound.** An intercom buzz and the clack of the door release.
- **Build.** *Prop* [proc]:
  - signs with the real street and mahalle names (take the mahalle from the OSM boundaries), set in a free font close
    to the original, because the custom "Kent" typeface is not licensed;
  - fictional apartment names;
  - a plaque and intercom kit.
- **When.** S1r. Real names on the corners give the "I know this corner" feeling.
- **Src.** [tr.wikipedia: İstanbul'un sokak tabelaları](https://tr.wikipedia.org/wiki/%C4%B0stanbul'un_sokak_tabelalar%C4%B1).

### 38. KİRALIK and SATILIK banners

- **What.** Vinyl banners (50×70 to 100×150 cm), yellow with black text or red with white, with eyelets at the corners.
  They are zip-tied to balcony railings or taped inside upper windows, and read "KİRALIK" (to let) or "SATILIK" (for
  sale) with a phone number in huge digits. Empty shops show "DEVREN KİRALIK" (lease for transfer) on paper.
- **Density.** 1–3 per residential block face, and about one per 40–60 m of upper floors on Yasa Cd (est.).
- **Sound.** Vinyl flapping in the wind.
- **Build.** *Prop* [proc]: a banner with a phone number that is clearly fictional and cannot be dialled.
- **When.** S1r. H: a banner marks a building that has a moving job, which gives the job board a hook in the world.
- **Src.** [expresstabela](https://www.expresstabela.com/kiralik-afisi/).

### 39. Deliveries, couriers and scooters (el arabası, moto kurye, scooter)

- **What.**
  - **Hand trucks.** In the morning, two-wheeled hand trucks bring crates, EPS fish boxes, ice and bread into the
    pedestrian lanes.
  - **Couriers.** Courier motorbikes with square top boxes thread through at walking pace. Pavement parking has been
    banned since 1 Sep 2025, so they cluster in painted bays; 109 spaces were added in May–June 2026, and there is a
    corral at the Muvakkıthane Cd entrance.
  - **E-scooters.** Shared e-scooters stand in clusters or lie tipped over on the pavements. Kadıköy ranked first in
    the world for shared-vehicle use per head in 2023.
- **Where, when.** Hand trucks at 07:00–10:00. Couriers all day, peaking at 12:00–14:00 and 19:00–22:00. Scooters at
  the corners of the square, on Rıhtım Cd and at the ends of Bahariye.
- **Density.**
  - 3–10 scooters at busy corners, and one every 30–80 m on the main pavements (est.).
  - Bike bays of 5–15 motorbikes (est.).
  - A courier every minute or two at the edges of the market (est.).
- **Sound.** Hard wheels rattling on the pavers, moped whine and horn taps, the scooter's unlock chime, and
  "Dikkat, dikkat!" / "Pardon abla".
- **Build.**
  - *Prop* [proc]: the e-scooter, the hand truck and the top box.
  - *Prop* [ext]: a 125 cc motorbike. Every livery is fictional.
  - *NPC* [MH + clip]: a porter pushing a hand truck, and courier vehicle agents at walking pace.
- **When.**
  - S1r: a motorbike bay at the Rıhtım kerb and 3–5 scooters near P8.
  - S5: agents.
  - H: delivery hours are a street event, scooters are obstacles, and the hand truck is a crew tool.
- **Src.** [gazetekadikoy: motosiklet park alanları](https://www.gazetekadikoy.com.tr/yasam/kadikoyde-motosikletler-icin-park-alanlari-yapiliyor),
  [hurriyet: scooter](https://www.hurriyet.com.tr/gundem/kadikoy-scooter-adimini-bekliyor-42204977).

### 40. Tea houses and tavla (çay ocağı, kahvehane, tavla)

- **What.** Men play backgammon in tea houses and tea gardens, slamming the checkers down and shaking the dice in their
  palms, and the tea glasses are refilled without asking. The çarşı's coffee houses became tea houses; one at the
  entrance of Tellalzade Sk plays Turkish classical music.
- **Density.** One tea house per 1–2 blocks off the main flows, each with 1–4 games in the afternoon (est.). Tea, nargile
  and tavla together are 2 % of "most heard".
- **Sound.** Dice rattling on wood, checkers clacking, "Şeşbeş!" and "Düşeş!" (dice calls), and glasses clinking.
- **Build.**
  - *Prop* [proc]: an open board with checkers, tea glasses and low stools.
  - *NPC* [MH + clip]: pairs playing tavla.
  - *Sound*: dice and checker emitters, which are unmistakable even off-screen.
- **When.** S4: a tavla table in the café. S5.
- **Src.** [kadikoytarihicarsi: çay evi](https://kadikoytarihicarsi.com/2019/02/tarihi-moda-cay-evi/).

### 41. Seasonal carts: corn, chestnut, salep, boza (mısırcı, kestaneci, salepçi, bozacı)

- **What.** The simit cart converts with the season:
  - **Late September.** Corn on the cob, boiled or grilled over charcoal, and salted.
  - **Mid-October to March.** Chestnuts on a perforated tray over coals, sold in paper cones that double as hand
    warmers, with smoke drifting.
  - **Winter.** Salep poured from heated brass urns and dusted with cinnamon.
  - **Rarely.** The bozacı's long evening call, as an occasional event.
- **Density.** 1–2 carts on the square and 1–2 on Bahariye, more in winter (est.).
- **Sound.** Coals crackling and chestnuts popping. "Sıcak kestane!", "Mısır, mısır!", "Saaalep", and a long "Boooza".
- **Build.**
  - *Prop* [proc]: cart variants of item 6, with smoke particles.
  - *Rules*: a season table.
- **When.** S1r: the corn variant of the square's cart in dusk views. S5: seasonal carts.
- **Src.** [haberturk: yeni arabalar](https://www.haberturk.com/istanbul-un-simit-kestane-ve-misir-arabalarina-yeni-tasarim-3730356),
  [theguideistanbul](https://www.theguideistanbul.com/cold-weather-treats-salep-boza-kestane/).

### 42. The çarşı's smell shops (turşucu, kurukahveci, kuruyemişçi)

- **What.** Pickle shops with walls of glowing jars sell pickle brine by the cup, drunk on the spot. A coffee roaster's
  smell drifts down the lanes, and nut roasters sell by weight. Spice sellers, cheese agers and bakeries are mixed in,
  and there is a confectioner on Yasa Cd itself. The game cannot carry smell, so it shows the sources: steam, a
  roasting drum turning, people drinking brine from plastic cups, and sacks open at the door.
- **Density.** A speciality food shop every 1–3 frontages in the market lanes (est.).
- **Sound.** A coffee grinder whirring, a nut-roaster drum turning, a scale beeping, and "Tadına bakın!" (have a
  taste!).
- **Build.**
  - *Prop* [have]: the pickle-jar walls in `stalls.ts`.
  - *Prop* [proc]: open sacks and bins at the door, a roasting drum with heat shimmer, and plastic cups.
  - *NPC*: a customer drinking brine.
- **When.** S1r: sacks and cups. S5.
- **Src.** [istanbul.com: Kadıköy market](https://istanbul.com/blog/about-istanbul/kadikoy-market-istanbul).

### 43. Waste cycle (konteyner, çöp kamyonu, süpürgeci)

- **What.** Four parts:
  - **Containers.** Large wheeled municipal containers with lids, often cracked; cats pull rubbish out of the broken
    plastic ones. Also bell-shaped glass bins, packaging and textile containers, and small waste-battery boxes on poles.
  - **Night.** Bin bags left at doors. 45 vehicles collect at night, with the compactor's whine around 23:00–01:00.
  - **Waste pickers.** They pull big white sacks on two-wheeled handcarts.
  - **Dawn.** From 06:00, sweepers in hi-vis work with long brooms and wheeled bins, and shopkeepers sweep their own
    frontage.
- **Density.** A container group every 50–100 m in residential streets, a battery box every few blocks, and 1–2 truck
  passes per street per night (est.).
- **Sound.** The compactor's hydraulic whine and the clank of the bin lift, glass cascading, lids banging, and brooms
  scraping at dawn.
- **Build.**
  - *Prop* [proc]: containers, a glass bell, a battery box and bin bags.
  - *NPC* [MH + clip]: waste pickers and sweepers.
  - *Vehicle*: the compactor truck, from the S7 vehicle kit.
  - *Rules*: bags appear after 21:00 and are cleared around 01:00; cats go to the bins at night.
- **When.** S1r: a container group at the P11 lane mouth and a battery box on a pole. S5: the night cycle.
- **Src.** [kadikoy.bel.tr: dönüşüm](https://www.kadikoy.bel.tr/tr/haber-detay/kadikoyde-donusum-5011),
  [gazetekadikoy: temizlik](https://www.gazetekadikoy.com.tr/cevre/kadikoyde-temizlik-24-saat-devam-ediyor).

### 44. Wet pavement (ıslak kaldırım)

- **What.**
  - **Morning.** Shopkeepers splash a bucket or hose their frontage (common practice, no Kadıköy source).
  - **Fish end.** The paving is wet all day, which the spec already has.
  - **Rain.** Water ponds in the sunken paver hollows and at the kerbs, and passing buses spray it. In a downpour on
    20 May 2026 roads flooded and a manhole overflowed.
- **Density.** The fish end is 100 % wet. After rain, a puddle every 10–20 m on the square (est.).
- **Sound.** A hose hissing, a bucket slapped out, tyres hissing on wet asphalt.
- **Build.**
  - *Prop*: a wetness mask and puddle decals. The square's puddle hollows are already in the spec.
  - *Rules*: morning wet patches at about one shopfront in four, 08:00–10:00, drying by late morning; a rain state.
- **When.** S1r: morning wet patches. S5: weather.
- **Src.** [dha: yollar göle döndü](https://www.dha.com.tr/amp/gundem/kadikoyde-yagmur-etkili-oluyor-yollar-gole-dondu-2876754).

### 45. Pharmacy sign and duty list (eczane, nöbetçi eczane)

- **What.** The sign is regulated: a white fascia with red "ECZANE" lettering and a red illuminated "E" in a square box,
  which is the only part allowed to light up. At night, the closed pharmacies tape the printed list of that night's
  on-duty pharmacies inside their door glass. The on-duty one shows a small red-and-white "NÖBETÇİ ECZANE" sign and
  serves through a hatch.
- **Density.** A pharmacy every 100–200 m in the centre (est.). After 19:00, at least one lit on-duty sign within a
  5–10 minute walk (est.).
- **Build.**
  - *Prop* [proc]: the sign kit and a taped-list decal.
  - One fictional pharmacy on the Rıhtım Cd frontage or at the edge of the strip.
  - *Rules*: the night list, and the red E as a night light.
- **When.** S1r. A red E at night reads as Turkey at once.
- **Src.** [ankara-tabela: eczane tabelası yönetmeliği](https://www.ankara-tabela.net.tr/rehber/eczane-tabelasi-yonetmeligi-uymaniz-gereken-zorunlu-kurallar-ve-guncel-bilgiler).

### 46. Night lighting character (gece ışığı)

- **What.** What is new beyond the S1 spec:
  - glowing büfe drink fridges and candle-lit bar windows;
  - Moda allows signs on ground floors only, none projecting or glaring, and Kadıköy asks buildings to turn off
    decorative façade lighting. The result is a warm band at street level under darker upper floors with lit windows;
  - across the water: the lit Historic Peninsula skyline, floodlit Haydarpaşa station and moving ferry lights;
  - on match nights, a red flare glow over Kuşdili.

  The mix of white LED and amber sodium lamps comes from general knowledge and is not verified street by street.
- **Build.**
  - *Lights*: small area lights for the fridge glow.
  - *Rules*: a lit fraction for upper-floor windows: 30–60 % from 19:00 to 23:00, falling after midnight (est.).
  - *L0*: the skyline as emissive.
- **When.** S1r: fridge glow and the lit-window rule. S5: the full night pass. S6+: the skyline.
- **Src.** [cevre.kadikoy.bel.tr: ışık kirliliği](https://cevre.kadikoy.bel.tr/icerik/isik-kirliligi-ile-mucadele-calismalari).

### 47. Büfe and tekel before 22:00 (büfe, tekel)

- **What.** Young people buy cheap beer at büfes (kiosks), tekel shops (licensed off-licences) and markets instead of
  paying bar prices. They drink standing, or carry it to Moda in plastic bags. Retail sales of alcohol are banned from
  22:00 to 06:00 (Law 6487), so there is a rush from 21:30 to 21:59. After 22:00 the fridges are locked or covered, and
  some tekels pull their shutters.
- **Density.** A büfe or tekel every 50–100 m in the çarşı, with queues of 3–10 just before 22:00 (est.).
- **Sound.** Fridge compressors humming, bottles clinking into plastic bags, the till beep, a shutter at 22:00.
- **Build.**
  - *Prop* [proc]: glowing fridges, and a chain or cover over them after 22:00.
  - *NPC*: a queue.
  - *Rules*: the 22:00 cutoff.
- **When.** S1r: fridge glow at the kiosk at ch 185–189. S5.
- **Src.** [cnnturk: satış yasağı](https://www.cnnturk.com/turkiye/icki-satis-yasagi-baslandi-46037).

### 48. Dolmuş rank and calls (sarı dolmuş, minibüs)

- **What.** Yellow shared taxis on line D-31 run Kadıköy–Taksim in about 45 minutes, nearly around the clock. They leave
  from beside the minibus station on the Haydarpaşa side. Weekend-night queues reach 100 m but clear in minutes. There
  is also a stop for the Bostancı dolmuş. A soundscape researcher recorded the drivers' calls as a typical Kadıköy
  sound.
- **Density.** A D-31 fills and leaves every few minutes at peak (est.).
- **Sound.** "Taksim! Taksim!", "Bostancı!", the sliding door slamming, fares passed forward hand to hand, a horn tap.
- **Build.**
  - *Vehicle*: from the S7 kit.
  - *NPC*: queue slots.
  - *Sound*: heard from the square.
- **When.** S5 (west of the strip), S7.
- **Src.** [dolmusbul](https://dolmusbul.com/kadikoy-taksim-dolmus-saatleri/),
  [gazetekadikoy: İstanbul'un sesi](https://www.gazetekadikoy.com.tr/gundem/istanbul039un-sesini-dinlemek-ister-misiniz).

### 49. Horon and halay by the pier (horon, halay)

- **What.** A group dances horon, the Black Sea line dance with arms linked and shoulders shimmying, to a kemençe (a
  small Black Sea fiddle), and sometimes halay. They gather next to the sea-bus pier nearly every evening and have for
  years, sometimes with small stalls selling food and handicrafts. Passers-by join the line. The only evidence is the
  titles of forum threads, so confidence is medium; verify before building.
- **Density.** One circle of 10–30 dancers plus a ring of watchers.
- **Sound.** The kemençe's fast, nasal drone, stamping, whoops and clapping.
- **Build.**
  - *NPC* [MH + clip]: a line-dance clip, which needs mocap because Mixamo has no horon.
  - *Sound* [ext]: kemençe music with a free licence or commissioned.
  - *Crowd*: an attractor.
  - Later (S8): the player can join the line.
- **When.** S5.
- **Src.** [ekşi: iskelede horon](https://eksisozluk.com/kadikoy-iskelede-horon-tepen-guruh--2220425) (title only).

### 50. Students in laptop cafés (ders çalışan öğrenciler)

- **What.** Cafés full of laptops, headphones and highlighters, with readers at almost every table in some Moda Cd
  cafés. A quiet municipal study space faces the sea. The book cafés are packed in exam season (January and May–June),
  and the budget is tea and cheap crêpes.
- **Density.** 60–90 % of seats taken in study cafés on weekday afternoons, with one laptop per 1–2 seats (est.).
- **Sound.** An espresso machine hissing, low talk, keyboards, lo-fi music.
- **Build.**
  - *Prop* [proc]: a laptop, notebooks and highlighters on the tables.
  - *NPC* [MH]: typing clips.
  - *Rules*: denser in exam season.
- **When.** S4: 1–3 students in the greybox café, which is cheap and very Kadıköy. S5.
- **Src.** [gazetekadikoy: ders çalışmak](https://www.gazetekadikoy.com.tr/gundem/ders-alismak-kadiky039de-kolay).

### 51. Moda evening stroll (dondurmacı, aile çay bahçesi)

- **What.** An ice-cream shop in Moda has been open since 1969, until 02:00, with queues on summer nights. Lemon and
  melon sell in summer and salep ice cream in winter. People walk down to the shore with their cones. At the family
  tea garden, waiters carry trays under tall trees facing the Moda pier and the Islands, and wood stoves heat the
  enclosed part in winter.
- **Density.** A queue of 15–40 on summer weekend nights, and 20–40 people per 10 m of Moda Cd (est.).
- **Build.** A fictional ice-cream shop, an NPC queue and a tea-garden kit.
- **When.** S6+.
- **Src.** [timeout: Ali Usta](https://www.timeout.com/istanbul/tr/restoranlar/meshur-dondurmaci-ali-usta).

## Nice

Each nice item is given as what and where, then density and sound, then build and when.

**52. Hooded crows (leş kargası).**
- What and where: grey body with a glossy black head, wings and tail, and unafraid of people. They drop mussels from
  the air onto the coast path to crack them, and raid bins and cat bowls. Pairs sit in the plane tree at the Aya
  Efimia junction and along the quay.
- Density and sound: 2–6 in view (est.). A hoarse "kraa", and the clack of a dropped shell.
- Build and when: a corvid model [ext] and recorded calls [ext]; a rare shell-drop event. S5.
  [hurriyet](https://www.hurriyet.com.tr/yazarlar/kanat-atkaya/kargalar-yuzunden-kadikoy-sakinleri-ikiye-ayrilmis-36840).

**53. Animal-welfare signs (kayıp kedi, sahiplen, veteriner).**
- What: A4 "Kayıp kedi" (lost cat) posters with a photo and a phone number, "adopt, don't buy" messaging, paw and cat
  stickers, and a "7/24 Veteriner" (24-hour vet) sign on the Rıhtım.
- Density: 1–3 per 50 m of lane (est.).
- Build and when: part of the sticker and poster atlas of item 11, plus a fictional vet fascia on Rıhtım Cd [proc].
  S1r. No protest banners.
  [gorenduyan](https://gorenduyan.com/category/kedi).

**54. Pop-up umbrella sellers (şemsiyeci).**
- What and where: sellers of cheap, often clear umbrellas appear at the pier exits, metro stairs and crossings within
  minutes of rain, and vanish when the sun comes out. It is a standing Istanbul joke.
- Density and sound: 2–4 around the square (est.). "Şemsiye, şemsiye!"
- Build and when: an NPC that spawns 2–5 minutes after rain starts, with pedestrians' umbrellas going up. S5; H rain
  jobs.
  [ekşi](https://eksisozluk.com/yagmurlu-havada-ansizin-beliren-semsiyeciler--5237786).

**55. Antiques street (Antikacılar Sokağı, Tellalzade Sk).**
- What and where: chandeliers, gramophones, frames, old photographs, furniture and pianos spill onto the pavement for
  about 100 m, and a tea house plays Turkish classical music. Old dealers remember walking with a sack and shouting
  "Eskici!" (junk man!).
- Build and when: an antique prop kit [proc/ext]. S5. H: the natural pickup street for the plan's antique mirror and
  piano jobs.
  [tellalzadeantiques](https://www.tellalzadeantiques.com/blog/2099/kadikoy-antikacilar-sokagi).

**56. Charity fundraisers (bağışçı).**
- What and where: pairs in vests with tablets stop passers-by on Bahariye with "Bir dakikanız var mı?" (have you got a
  minute?).
- Density: 1–3 pairs on a weekday afternoon (est.).
- Build and when: an NPC pair with a fictional charity, and the player can dodge them. S5. Political stands are
  excluded.
  [gazetekadikoy: Bahariye](https://www.gazetekadikoy.com.tr/yasam/kadikyn-baharligi-bahariye-caddesi).

**57. Scrap-dealer van (hurdacı, eskici).**
- What and where: a pickup crawls through residential streets playing a looped, distorted announcement that the scrap
  man is here and buys old fridges and washing machines. People find it nostalgic and annoying. It passes each street
  every day or two (est.).
- Build and when: a vehicle with a megaphone loop, which needs a recorded voice (see Assumption 4). S6+. H: the scrap
  man buys the crew's broken items.
  [ekşi: hurdacı](https://eksisozluk.com/hurdaci--62703).

**58. Aya Efimia bell (kilise çanı).**
- What: a few measured strokes of a single bell on Sunday mornings, when the community holds services. Unconfirmed;
  church bells are 2 % of "most heard" citywide.
- Build and when: a synth bell, and the gate open with a few people on Sunday mornings. S5, after verification.
  [tarihi.ist](https://www.tarihi.ist/ayia-efimia-rum-ortodoks-kilisesi/).

**59. İstanbulkart beeps (kart sesi).**
- What and where: every passenger taps a card at the pier turnstiles and on the tram. Different tones mark a normal
  fare, a transfer, a double tap and an empty card, and someone mutters "Yetersiz bakiye" (insufficient balance) while
  blocking the gate. The exact patterns are unconfirmed.
- Build and when: synth beeps and the turnstile arm's clunk. S3/S5.
  [metro.istanbul](https://www.metro.istanbul/icerik/seyahatkartlari).

**60. Pilaf carts (pilav arabası).**
- What and where: glass-cased carts sell chicken or chickpea pilaf by the plate at lunch, about 11:30–15:00, 1–2 of
  them within a few hundred metres of the square (est.).
- Sound: "Tavuklu mu, nohutlu mu?" (chicken or chickpea?), and a ladle scraping the pot.
- Build and when: a cart variant [proc]. S5.
  [kadikoytarihicarsi](https://kadikoytarihicarsi.com/2018/11/pilav-arabasi-pilav-sevenlerin-ugrak-yeri/).

**61. ATM cluster.**
- What and where: groups of 2–6 bank ATMs in fictional brand colours, with receipt slips on the ground and evening
  queues. 8–15 within 150 m of the pier (est.).
- Sound: keypad beeps and "Lütfen kartınızı alınız" (please take your card).
- Build and when: an ATM prop [proc]. S1r if Rıhtım Cd frontage is in view (c05).
  [bankasubeler](https://www.bankasubeler.com/turkiye-is-bankasi-eski-kadikoy-iskelesi-istanbul-atm-nerede.html).

**62. Night watchmen (bekçi).**
- What and where: uniformed market and neighbourhood watchmen patrol on foot in pairs from sunset to sunrise, with a
  torch and a whistle, blowing a single blast now and then. A pair passes each street every 30–60 minutes (est.).
- Build and when: an NPC pair on patrol and a synth whistle; the weapons are not featured. S5.
  [gazetekadikoy: bekçiler](https://www.gazetekadikoy.com.tr/gundem/bekiler-geri-dnd).

**63. Lodos nights (lodos).**
- What and where: the south-westerly gale cancels ferries. Waves slap over the Rıhtım edge and pound the Moda rocks, the
  seafront empties, and stranded commuters fill the pier halls.
- Build and when: a weather state with spray particles, banging awnings and shutters, cancellation announcements and
  the crowd rerouted indoors. S5; H job condition.
  [cumhuriyet](https://www.cumhuriyet.com.tr/turkiye/istanbulda-lodos-nedeniyle-bazi-vapur-seferleri-iptal-oldu-1888575).

**64. Late-night cars with loud music.**
- What and where: after 22:00 some visitors cruise with their sound systems at full volume, on summer weekends from
  23:00 to 03:00, and residents complain.
- Build and when: a traffic-agent variant with a bass emitter. S7.
  [voaturkce](https://www.voaturkce.com/a/kad%C4%B1koy-de-gece-yarisi-sokak-partileri-tepki-cekiyor/5964428.html).

**65. Tombili and the Moda dog statue (Tombili heykeli).**
- What and where: a bronze of the famous street cat Tombili lounging against the kerb, unveiled in 2016 in Ziverbey,
  and a dog statue on a stone pillow in Moda. Both are outside the planned zones.
- Build and when: both are recent works, so do not replicate them. Optionally add an original small animal bronze as a
  homage. S6+.
  [kadikoy.bel.tr](https://www.kadikoy.bel.tr/tr/haber-detay/kadikoyun-bickin-kedisi-tombili-heykeli-acildi-4984).

## S1 revision: cheap static details for the current strip

These need no animation and no external asset, with two stand-ins: the static gulls reuse the flight world's
low-poly gull (`src/world/life/birds/bird-geometry.ts`), and the motorbike bay uses a procedural low-detail bike until
a model [ext] is approved. They sit in the S1 build's existing modules (`facade/build.ts`
`streetWear`, `facade/props.ts`, `facade/stalls.ts`, `street/furniture.ts`, `street/kit-props.ts`) or in small new prop
builders, and they must keep the S1 checklist: decal offsets as in `streetWear` (no z-fighting) and LOD0 within 30 m.

| Detail (item) | Where on the strip | Count |
|---|---|---|
| Bowl pairs (2, 28) | Yasa Cd thresholds and wall bases, the Aya Efimia wall base (ch 219–247 N), P10 tree pits, square bench legs, P0 | 5–9 on Yasa Cd, 2–4 on the square, 1 pair at P0 |
| Placeholder cats plus `catSpots` records (1, 3) | P10 café chairs, a shop window, a scooter seat, the wall top and gate hood, square benches and planters, under the P11 stalls, the P0 bench | 4–8 on Yasa Cd, 3–6 on the square, 3–8 at P11, 1 at P0 |
| Cat houses (24, 28) | a café front or the precinct wall; the fish end; P0 | 1–2 wooden, 1 EPS crate, 1 cardboard at P0 |
| Static gulls (4) | quay bollards, the 1926 pier ridge | 3–5 bollards, a row on the ridge |
| Stickers on street furniture (11, 53) | signal poles at P2/P3 and P6/P7, Yasa Cd lamp columns and bollards, square bins and stop pole | 10–40 per crossing pole, 3–15 per column, 5–20 per bin |
| Poster grids with torn and scraped layers (11) | cabinets, kiosk backs, and the Haldun Taner hoarding if the scaffold is shown | a cluster every 20–40 m of blank wall |
| Shutter graffiti coverage (15) | every closed kepenk, with the c11 kiosk as the test | 80–90 % of closed shutters |
| Painted-over patches over old tags (36) | plinths and side walls | 1–2 per side wall |
| Street signs, number plates, apartment plaques, intercoms, taped notes (37) | the four junction corners and the 13 Yasa Cd doors | 1 per corner, 1 per door, notes on 1 in 3 |
| Gas risers, flues with soot fans, AC drip spots, cable coils (33) | all T1 and T3 façades, and the lane under the AC units | 1 riser per building, 1 flue per flat |
| Laundry, railing dishes, cat nets, tin pots (32) | T1 upper floors in day cameras | laundry 30–50 %, nets 5–10 % |
| KİRALIK and SATILIK banners, a DEVREN KİRALIK window (38) | upper floors on Yasa Cd | 1 per 40–60 m |
| Yellow-and-navy flags and pennants, no crest (18) | shop windows and balconies | 1 per 30–60 m; 1–3 per block face |
| Spill-over: carboys and gas cylinders, a clothing rack and mannequin, sacks, stools with a tea tray (8, 9, 34, 42) | Yasa Cd shop doors | stools at about 30 % of doors, trays at 2–3 |
| Butts, seed shells, gum, paver patches, asphalt patches at the rails, a leaning bollard (35) | pier exits, P0, benches, Rıhtım Cd | butts 5–20 per m² at the exits and P0 |
| Late-September fish mix, run-off streaks draining west, hose, scrap decals (3, 10) | P11 and ch 240–263 | – |
| Container group and battery box (43) | the P11 lane mouth, a pole on Yasa Cd | 1 group, 1 box |
| Night dressing: kiosk fridge glow, pharmacy E and duty list, meyhane tables, midye stand (16, 17, 45, 46, 47) | kiosk at ch 185–189, strip edge, P11 (c10-night), P8 (c11) | 1 each |
| Simit cart, with a corn variant at dusk (6, 41) | the c02 spot on the square | 1 |
| Motorbike bay (fictional liveries) and e-scooters (39) | the Rıhtım kerb near P1, and near P8 | 1 bay of 5–10, 3–5 scooters |
| Anglers' kit at the quay rail (30) | the quay edge in night views | 2–3 sets |

**Manifest additions.** These extend the planned manifest of doors, POIs, lights, spawn points, seats and NPC slots.
They are cheap now, and S5 can plug animated life into them without a recompile.

- `animals`: cat spots (with pose, owned-spot kind and a shelter flag), bowl sets, cat houses, dog sun spots, gull
  perches and pigeon feeding areas.
- `vendorSlots`: simit or corn cart, midye tray, busker points, angler points, tea ocak.
- `ambience`: sound zones: quay, crossing, lane, plaza, fish end, and the mosque side door.

## Soundscape plan (S5)

**Starting weights** come from the "most heard" survey: traffic and horns 18 %, ferry 13 %, crowds 12 %, gulls 11 %,
street vendors 9 %, ezan 8 %, sea 5 %, shop music 3 %, sirens and announcements 3 %, tram 3 %, markets 2 %, tea and
tavla 2 %, street musicians 2 %, construction 2 %, church bells 2 %. Yasa Cd is pedestrian, so cut traffic there to a
distant bed and raise the crowd, market and vendor layers.

| Zone | Bed (always on) | Day events | Evening and night events |
|---|---|---|---|
| Quay and square (P0–P1) | sea lapping on the quay wall, fenders creaking, Turkish walla scaled by crowd density, gulls | ferry horn, engine and gangway; arrival footstep surges; card beeps; simit and corn cries; pigeon wing clatter | busker 19:00–21:00; midye cries; dolmuş calls from the west; dogs barking at mopeds |
| Rıhtım Cd crossing (P2–P7) | traffic and buses, horns | tram bell, wheel grind and squeal; courier mopeds | quieter traffic; late cars with loud music (S7) |
| Yasa Cd lane (P8–P10) | dense walla, footsteps on the slabs, shop radios | "Kolay gelsin" and other greetings, tea-glass clinks, scale beeps, a coffee grinder, kepenk up (08:30–09:30), meows at bowls; the İskele Camii ezan is loudest here | kepenk cascade (20:00–22:00), fridge hum, the 22:00 rush, bekçi whistle, the compactor truck around 23:00–01:00 |
| Junction plaza and precinct (P10) | a quieter pocket, plane-tree leaves | crows in the tree; Sunday bell (unconfirmed) | café murmur |
| Fish end (P11) | fish calls, knife thuds, ice being shovelled | "Palamut var!", "Temizleyelim mi?", gulls overhead, meows under the stalls | the hose-down at 20:00; meyhane cutlery and glasses; fasıl clarinet on weekend nights; cat spats at the bins |

**What exists and what is needed.**

- **Exists.** The synth gull (`playGull`), ferry horn and car horn, and the ambience probe (`src/audio/voices/ambience.ts`).
- **Synth first.** Tram bell, church bell, card beeps, whistle, drips and kepenk.
- **Recordings [ext].** Ezan, walla and street cries (see Assumption 4), cats, dogs, pigeons, crows, dice and checkers,
  cleaver chopping, hose and ice, compactor, stadium roar, and music with a free licence or written for Seventeen Skies.

## One day on the strip (Thursday 24 Sep 2026)

| Time | What happens |
|---|---|
| 05:21 | Dawn ezan. Gulls call. |
| 06:00–08:00 | Feeders' rounds with cats waiting at the bowls. Brooms scrape. Simit carts set up. The first ferries arrive with commuter surges. |
| 06:55 | First tram. |
| 07:00–10:00 | Hand trucks bring EPS fish boxes, ice and bread. Shopfronts splashed. The ground residue is at its cleanest. |
| 08:30–09:30 | Kepenks go up. The siftah. Tea runners start. |
| Late morning | Market peak. Fish cleaned to order, with cats at the stalls. |
| 12:00–14:00 | Couriers peak. Pilaf carts. |
| 13:01 | Noon ezan. |
| Afternoon | Shopkeepers on stools, tavla, radios; cats asleep in the sun. |
| 16:25 | Afternoon ezan. |
| 17:00–19:30 | Evening commute surges. Midye trays appear. Fish prices drop. Corn carts. Anglers at the rail. |
| 19:00–21:00 | Permitted busking on the square. Meyhane tables fill from 19:30. |
| 19:06 | Sunset ezan. |
| 20:00–20:30 | Fish stalls hosed down, cats at their busiest. The kepenk cascade starts. The shutter graffiti appears. |
| 20:26 | Night ezan. |
| 21:00 | Last tram. Bin bags go out at doors. |
| 21:30–22:00 | Büfe and tekel rush; fridges locked at 22:00. |
| 23:00–01:00 | Compactor trucks. Kokoreç and midye crowds. Dogs bark at mopeds. Bekçi whistles. |
| 00:00–01:00 | Last ferries, then the dolmuş queue. |
| 02:00 | Bars close. A second kokoreç wave. Cats at the bins. |

## Season and weather rules

| Condition | Changes |
|---|---|
| Late September (default) | Palamut dominates; juvenile gulls whistle; half-grown kittens; water bowls out; corn carts; AC drips; no hamsi and no mating yowls |
| Mid-Oct to March | Chestnuts, salep and a rare boza call; hamsi (Oct–Nov); heaters and windbreaks at about one café in three; blankets on sills; cardboard and EPS cat houses; cats on warm car bonnets; boiler vapour plumes; dark by about 16:45 in December; Moda rocks empty |
| Jan to March | Cat mating yowls at night |
| March to July | Gulls breed on the flat roofs; chicks on the pavements in May–Jul; adults dive at people; dawn chorus around 05:00; kittens from May |
| Summer | "Bir Kap Su Ver" water bowls; Moda rocks and grass full; ice-cream queues; laundry at its peak; the most AC drips |
| Rain | Umbrella sellers within minutes; puddles every 10–20 m on the square; cats under awnings, cars and benches; pigeons shelter; no laundry; awnings drip |
| Lodos | Ferries cancelled, spray over the quay, the seafront empties, shutters and awnings bang |
| Match day (event) | Fan flow from the ferries, scarf sellers, chants and a flare glow, a post-win horn convoy |
| Sunday | Slow morning, the Aya Efimia gate open (bell unconfirmed), litter from the night before, brunch in Moda |

## Bark library seed (S4, Turkish lines for ink)

All lines below come from the sources. Proposed lines that were written for the game are marked *(new)*.

- **Shopkeepers.**
  - "Kolay gelsin." / "Sağ ol."
  - "Hayırlı işler."
  - "Bereketli olsun."
  - "Siftah senden, bereket Allah'tan."
  - "Buyrun abla, bakın."
- **Market.**
  - "Gel gel gel, taze taze!"
  - "Palamut var, palamut!"
  - "Temizleyelim mi?"
  - "Tadına bakın!"
  - A customer: "Kilosu kaç?"
- **Vendors.**
  - "Taze simit!"
  - "Sıcak sıcak!"
  - "Midye, midye dolma!"
  - "Bir tane daha?"
  - "Sıcak kestane!"
  - "Mısır, mısır!"
  - "Şemsiye, şemsiye!"
  - "Tavuklu mu, nohutlu mu?"
  - "Boyayalım abi?"
- **Tea.**
  - "Çaycı!"
  - "İki çay, biri açık."
- **Cats.**
  - "Pisi pisi."
  - "Gel güzelim, gel." *(new)*
  - "Şuna bak, uyuyor!" *(new)*
  - "Adı ne?" *(new)*
  - A shopkeeper calling a cat by its fictional name.
- **Transport.**
  - "Taksim! Taksim!"
  - "Bostancı!"
  - "Vapur kaçıyor, koş!"
  - "Boğa'dayım, neredesin?"
  - "Yetersiz bakiye…"
- **Night.**
  - "Afiyet olsun."
  - "Kaç oldu?"
  - "Şerefe!" *(new)*
- **Street.**
  - "Bir dakikanız var mı?"
  - "Dikkat, dikkat!"
  - "Pardon abla."
- **Hamallar.**
  - "Kolay gelsin!" Everyone says it to working people, so passers-by should say it to the crew constantly.
  - "Yavaş, yavaş!" *(new)*
  - "Aman kediye dikkat!" *(new)*

## Hamallar hooks

- **Animals.** Cats asleep on the stairs and in doorways; a cat that slips into the flat during a job; the plan's cat
  carrier item; a dog asleep across a doorway; pigeons bursting up in front of a sofa; a gull stealing the crew's
  simit.
- **Street obstacles.** Knocked-over bowls, with a shopkeeper's complaint; the tea runner (a collision means broken
  glasses); the wet, slippery fish end; stalls and spill-over in the lane; scooters and motorbike bays; the Kadife Sk
  crowd at night; the tram on Bahariye.
- **Job hooks.** KİRALIK banners mark buildings with jobs; the antiques street supplies mirrors and pianos; the
  scrap-dealer van buys broken items; the morning delivery window with hand trucks; balcony hoists through laundry
  lines.
- **Events.** Umbrella sellers and rain, lodos, match day.
- **Barks.** "Kolay gelsin" from every passer-by.
- **Steam achievement.** "Kediköy": stroke 50 different cats *(new)*.

## External assets needed (for a later shortlist)

1. **Cat (the priority).**
   - **Model.** Realistic and rigged, with a head and neck look-at chain and a tail chain for procedural motion. LOD0
     about 10–15k triangles, plus LODs.
   - **Clips.** Idle sit, loaf, curled sleep, side sleep, groom, walk, trot, run, jump up and down 0.5–1 m, eat from a
     bowl, drink, stretch, flinch or move off, rub against legs, and a pounce on a scrap.
   - **Variants.** Coats: tabby, black-and-white, ginger, calico, white, grey. An ear-tip notch on the left or right
     ear. A kitten at about 0.6 scale.
   - **Licence.** CC0 or CC-BY.
2. **Dog.** A large Anatolian mixed breed (the Karabaş type) in tan, black-masked and blond variants, rigged. Clips:
   lie on the side asleep, sphinx, get up, stretch, walk, trot, sniff, scratch, bark and yawn. An attachment point for
   the ear tag.
3. **Gull.** An adult yellow-legged gull and a brown juvenile, rigged well enough to hold up at 2–5 m. Clips: stand,
   walk, peck, long-call pose, take-off, flap, glide, hang in the wind and land. The flight world's procedural gull
   stays beyond about 30 m.
4. **Pigeon.** Rigged, or baked to a vertex-animation texture for flocks of 40. Clips: walk with head bob, peck, burst
   take-off, flap and land. The Galata shader behaviour can drive it.
5. **Hooded crow** (nice). A corvid model with hop, peck, take-off and a perched call.
6. **Motion clips Mixamo lacks** [clip]: gutting and wrapping fish, simit tongs, carrying the swinging tea tray,
   chopping with a cleaver, hosing, crouching to pour kibble, pulling a trolley or handcart, playing tavla, playing
   instruments (violin, accordion, guitar, darbuka, clarinet, kemençe), the horon or halay line, casting and reeling,
   and shining shoes.
7. **Recordings.** Ezan (Istanbul, licensed); Turkish walla and street cries (Assumption 4); cat vocalisations and
   purr; dog barks; pigeon coos and wing clatter; crow calls; kepenk rattle (if the synth fails); tea-glass clinks;
   dice and checkers; cleaver chopping; hose and ice; compactor truck; stadium roar. Music only under a free licence
   or written for Seventeen Skies: busker tunes, shop radios, fasıl, kemençe, bar music and records (streamer-safe).
8. **Vehicles and props.** A 125 cc courier motorbike (S1r), the T3 tram (S5 hero), the dolmuş minibus (S7), and
   antique props and a piano (H).
9. **Original murals** for the Mural-İst walls (S6+), commissioned or made for Seventeen Skies under a free licence.

**Procedural** [proc] (no approval needed):
- bowls, cat houses, placeholder cats;
- the sticker and poster atlas, shutter graffiti and painted-over patches;
- signs, plaques, intercoms and notes; banners and flags;
- laundry, nets, awnings and pots; gas risers, flues, drips and cable coils;
- spill-over props (carboys, cylinders, racks, stools, sacks, windbreaks, heaters);
- the tea tray and glasses;
- the simit, corn, chestnut and pilaf carts and the midye tray;
- the tavla board; the anglers' kit;
- ground decals (butts, husks, gum, patches, wet streaks);
- containers, glass bells, battery boxes and bin bags;
- the e-scooter and the hand truck; the ATM and the pharmacy sign.

Existing assets to reuse: fish [have], pigeon behaviour [have], and gull, ferry-horn and car-horn synths [have].

## Excluded and why

- **Politics.**
  - Excluded: rallies, marches, party and association stands, police lines, water cannon, protest banners (including
    the Rıhtım banners about the neighbourhood's dogs), political stickers and slogans.
  - Kept: neutral generic posters only.
- **Distressing current events.** The 2024 poisoning in Fenerbahçe and the removal of bowls that followed, the 2026 dog
  collections, and viral incidents.
- **Real people and named real animals.** Named sellers and fishmongers, the named Rıhtım dogs.
- **Real businesses.** All businesses are fictional, and no real bar, pickle shop, ice-cream shop or roaster is
  recreated.
- **Brands.** The club crest, the stadium sponsor, the ferry operator logo, scooter and delivery liveries, and bank
  logos.
- **Copyrighted works.** Real murals and recent statues (Tombili, the Moda dog) are replaced by originals. The
  municipal simit cart's exact design and the "Kent" typeface are replaced by generic versions.
- **Not sourced to Kadıköy.**
  - Lottery-ticket, balloon and candyfloss sellers.
  - Pigeon-seed sellers, who are documented in Eminönü.
  - Recycling pet-food machines: no evidence in Kadıköy.

## Research limits

- **Estimates.** Every density marked "(est.)" is a calibrated guess. No per-metre survey exists.
- **Blocked sources.** The shared web-search budget (200 calls) ran out near the end of each angle. Ekşi Sözlük,
  Medium and some news pages returned 403, so items citing them rest on search snippets.
- **Unconfirmed items.** Verify these before building them:
  - shutter graffiti coverage;
  - horon and halay at the pier;
  - the Aya Efimia Sunday bell;
  - the İstanbulkart beep patterns;
  - the tea seller's exact call;
  - cats in the fountain niche and on the precinct steps;
  - shopkeepers splashing water on the pavement;
  - lamp colours by street;
  - the Kadıköy container model and colour.
- **Reference photos.** Free-licence Commons photos for pose and texture reference, to add to `.shots/s1/reference/`
  after checking each licence:
  - Kadıköy İskelesinde köpek (27 Apr 2026);
  - Street dog in Kadıköy Ferry 01/02 (8 Jun 2026);
  - the gull by Saint Euphemia (February 2026 series);
  - A seagull in Kadıköy 01/02 (June 2026);
  - Kadıköy Kedisi (2022);
  - Feral cats in Fenerbahçe Park 01–05 (2026);
  - Graffiti in Kadıköy 25.04.2026 01–05 (CC BY 4.0);
  - Pigeons in Kadıköy 20130106.
