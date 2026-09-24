# S1 strip: Rıhtım to the fish market (spec)

Phase S1 of the street track (`.docs/planning/16-street-layer.md`). This file defines what the S1 strip is, what it must
contain and how it is judged. It does not describe compiler code. The cameras are in
[`tools/world-compiler/s1/cameras.json`](../../tools/world-compiler/s1/cameras.json). The reference photos are in
`.shots/s1/reference/`, which is gitignored: they stay local and are never shipped. The photos are listed in the table
in section 7.

The frame is Evren local metres (`src/core/geo-coords.ts`): +X east, +Y up, +Z south. Heights are the format-0 compiled
ground (`public/world/kadikoy`, compiled 2026-09-24). Map data © OpenStreetMap contributors, ODbL 1.0.

## 1. Strip definition

**Route.** The strip starts on the pier square between the 1926 pier and the new pier. It crosses Rıhtım Cd on the
signalised crossings and the traffic island, then runs the length of **Yasa Cd** to the fish-market junction with
Güneşlibahçe Sk and Yağlıkçı İsmail Sk.

**Why Yasa Cd.** It is the direct line from the piers into the çarşı, and it has the densest mix on one continuous path:

- late-Ottoman masonry at the entrance;
- 1950–70s çıkma blocks and 1980s+ refits;
- Şekerci Cafer Erol;
- the Aya Efimia precinct with the 1693/94 Sürmeli Ali Paşa fountain;
- fish, produce and deli stalls at the end.

Muvakkıthane Cd has 35 POIs over 231 m, but they are mostly cafés and banks. Güneşlibahçe Sk and Mühürdar Cd branch off
the end of the strip. The route follows the shortest path on the compiled walk graph (`walk.json`), which gives
P0–P7. P8–P11 are the Yasa Cd centreline.

| Point | x, y, z | Chainage (m) | Tile | Where |
|---|---|---|---|---|
| P0 | 235.8, 3.86, 5944.4 | 0 | 2_59 | pier square, İskele bus stop |
| P1 | 262.2, 4.05, 5945.4 | 26.4 | 2_59 | quay-side pavement of Rıhtım Cd |
| P2 | 284.5, 4.10, 5940.0 | 49.3 | 2_59 | north kerb, signalised crossing |
| P3 | 285.1, 4.34, 5949.6 | 58.9 | 2_59 | island kerb, after crossing 8.4 m (2 lanes, westbound) |
| P4 | 296.8, 4.55, 5953.4 | 71.2 | 2_59 | island |
| P5 | 300.1, 4.71, 5960.7 | 79.2 | 3_59 | island |
| P6 | 293.8, 4.87, 5975.5 | 95.3 | 2_59 | island tip, start of the zebra |
| P7 | 306.2, 5.09, 5982.3 | 109.4 | 3_59 | end of the zebra (8.4 m carriageway, T3 track, 4.9 m busway) |
| P8 | 321.9, 5.27, 5985.4 | 125.4 | 3_59 | Yasa Cd entrance, Tavus Sk corner |
| P9 | 335.0, 5.58, 5991.3 | 139.8 | 3_59 | Yasa Cd |
| P10 | 405.1, 7.16, 6032.1 | 220.9 | 4_60 | Yasa × Mühürdar junction plaza |
| P11 | 442.2, 8.16, 6052.5 | 263.2 | 4_60 | Yasa × Güneşlibahçe × Yağlıkçı İsmail (fish market) |

- **Length.** The spine is 263 m: 125 m of square and crossings, and 138 m of market lane. It is longer than the
  nominal 200 m because the signalised crossings force a 30 m dog-leg (P2–P7).
- **Arrival square.** The strip also includes the pier square, a polygon of 8,430 m² in `cameras.json` →
  `strip.arrivalSquare`. It is bounded by the quay edge (OSM coastline 755588171), the west front of Haldun Taner, the
  north kerb of Rıhtım Cd and the apron of the 1926 pier. Cameras c01–c04 stand in it.
- **Gradient.** The ground rises 4.3 m from P0 to P11 (y 3.86 → 8.16). Yasa Cd climbs 2.1 % (5.27 → 8.16 over 138 m),
  so shop floors and thresholds step along the lane.
- **Width of Yasa Cd.** OSM gives 6 m. Measured façade to façade on the compiled footprints:
  - 5.3–6.7 m for ch 150–215;
  - 4.6 m pinch at ch 135;
  - 7.7–9.1 m at the junction.

  The lane has no kerbs.
- **Tiles.**
  - Walking-scale content: `1_59` (1926 pier), `2_58` and `2_59` (square, Haldun Taner, crossing), `3_59`, `3_60`
    and `4_60` (Yasa Cd).
  - Seen in the views but not walked (hero and L1 detail only): `2_57` (new pier), `3_58`, `4_59`, `5_59`, `5_60`,
    `3_61` and `4_61`.
- **Content already in the format-0 manifests** (within 12 m of Yasa Cd): 15 POIs (restaurant, fast food, café,
  confectionery, bakery, seafood, clothes, optician, mobile phone), 13 inferred doors (all 1.4 m wide, none tagged) and
  12 warm lantern lamps at 8–12 m spacing. The four spine tiles hold 78 lamp records in all.

## 2. Buildings along the strip

- **Sides.** N is the north side of Yasa Cd and S the south side. Chainage (ch) is the frontage range along the spine.
- **Heights.** "f0" is the format-0 height. Almost no building on the strip has `building:levels`, so f0 is mostly the
  15.5 m default.
- **Storeys.** "Est." storeys come from the photos where one is cited, and are a guess otherwise.
- **Typologies** (see section 3): T1 is the 1950–70s balconied apartment, T2 late-Ottoman / early-Republic masonry,
  T3 1980s+ infill or refit, T5 a kiosk, H a hero building.
- **Ground floors.** Uses come from OSM POIs. Photos show every ground floor on Yasa Cd as an active shop.

### Heroes on the square and the crossing

| OSM | Tile | OSM levels / f0 | Real (source) | Type | Ground floor |
|---|---|---|---|---|---|
| w102190096, 1926 pier | 1_59 | 2 / 6.2 m | eaves about 10 m, hipped-roof ridge 13 m, 36.7 × 16.7 m (hero spots) | H: First National Architecture, 1926, restored 2023 | ferry hall, İBB İskele Kütüphanesi, Vapur Kafe |
| w560203763, new pier | 2_57 | 2 / 6.2 m | eaves 10–11 m, roof 13 m, 82 × 18 m (hero spots) | H: 1982, re-clad 2005–08 | passenger hall, café |
| w102190100, Haldun Taner | 2_58 | – / 15.5 m | 2 storeys + glazed roof, 12–14 m, 63 × 30–37 m (hero spots) | H: 1927 market hall by Umberto Ferrari | theatre, under restoration since 2021 (scaffold in the April 2026 photo) |
| w102190093, İskele Camii | 3_60 | – / missing | dome about 15 m, minaret 30–35 m (hero spots) | H: 1760–61 | mosque; a row of shops stands between it and Yasa Cd |

### Yasa Cd

| ch | Side | OSM | Tile | f0 | Frontage | Type (evidence) | Est. storeys | Ground floor (OSM POIs) |
|---|---|---|---|---|---|---|---|---|
| 122 | S | w1462853463 (Tavus Sk 14) | 3_59 | 15.5 | 9 m off | T2/T1 guess | 3–4 | restaurant (Pidem) |
| 125–132 | N | w179197246 | 3_59 | 15.5 | 10.9 | T2 (c11, yasa-entrance-night) | 3–4 | fast food (Bambi), restaurant |
| 131–135 | S | w709156144 | 3_59 | 15.5 | 4.8 | T2 (c11: bracketed cornice) | 4 | shuttered kiosk shop (1930 lottery office) |
| 132–138 | N | w694298370 | 3_59 | 15.5 | 6.0 | T2 (arched upper windows) | 3–4 | restaurant |
| 135–141 | S | w709156145 | 3_59 | 15.5 | 5.5 | T2 (c11: iron balcony, brackets) | 4 | mobile phones (OSM name Buket Parfümeri) |
| 146–151 | S | w694298380 | 3_60 | 15.5 | 4.8 | T1 guess | 5–6 | shop |
| 151–156 | S | w694298381 | 3_60 | 15.5 | 4.9 | T1 guess | 5–6 | shop |
| 152–163 | N | w694298376 (corner of Tavus Sk) | 3_59 | 15.5 | 11.6 | T3 refit of T1 (c06: grey panels, 2-storey glazing, çıkma) | 6 | restaurant (islama köfte), optician |
| 156–169 | S | w709156143 | 3_60 | 15.5 | 12.6 | T1 guess | 5–6 | shop |
| 163–169 | N | w694298375 | 3_59 | 15.5 | 5.4 | T1 (c06 background) | 5 | shop |
| 169–173 | N | w694298374 | 3_60 | 15.5 | 4.3 | T1 guess | 5 | shop |
| 177–182 | N | w694298373 | 3_60 | 15.5 | 4.4 | T2 guess (34 m² plot) | 2–3 | shop |
| 181 | S | w179197314 | 3_60 | 15.5 | 7 m off | T1 guess | 5 | clothes |
| 185–189 | S | w694298383 | 3_60 | 3.1 | 4.3 | T5 kiosk | 1 | shop |
| 187–199 | N | w179197243 (part of w1462853448, OSM L5) | 3_60 | 15.5 | 11.8 | T3 (c06: white, glass balustrades) | 5 | kokoreç restaurant, café |
| 189–208 | S | w179197266 (356 m²) | 3_60 | 15.5 | 19.0 | T1/T3 guess | 5–6 | 2 × fast food, künefe café |
| 199–204 | N | w1462853447 (Yasa 19) | 3_60 | 15.5 | 5.1 | T1 guess | 5 | shop |
| 204–211 | N | w179197226 (part of w1462853446, OSM L3, Yasa 21A) | 3_60 | 15.5 | 6.5 | T2 with hipped tile roof (c07) | 2–3 | confectioner (Şekerci Cafer Erol) |
| 211–215 | N | w1462853450 (part of w1462853446) | 4_60 | 15.5 | 4 m off | T2 (same building) | 2–3 | bakery |
| 219–247 | N | Aya Efimia precinct (179197257, wall), church w694298362 | 4_60 | missing | 28 m | H: church 1694, rebuilt 1830; wall about 3.5 m | – | precinct wall with two gates, fountain at ch ≈ 226 |
| 231–234 | S | w711321929 (junction corner) | 4_60 | 15.5 | 2.8 | T1-early plain render (c07: cream, dark-green frames) | 3–4 | restaurant, fast food |
| 234–238 | S | w694715116 | 4_60 | 15.5 | 4.3 | T1 guess | 4–5 | shop |
| 238–245 | S | w711321928 | 4_60 | 15.5 | 7.1 | T1 guess | 4–5 | shop |
| 246–252 | S | w694715117 | 4_60 | 15.5 | 5.6 | T1 guess | 4–5 | clothes |
| 247–259 | N | w694298355 | 4_60 | 15.5 | 11.9 | T1 guess | 4–5 | fish market |
| 253–259 | S | w694715125 | 4_60 | 15.5 | 6.1 | T1 guess | 4–5 | shop |
| 263 | N | w694298352, w694298353 | 4_60 | 15.5 | 3–7 m off | T1 guess | 3–4 | stalls |
| 263 | S | w694715137, w694715138 | 4_60 | 15.5 | 3.8 | T1 guess | 3–4 | fish (Sen Balıkçılık) |

- **Frontage mix.** Frontages run 2.8–19 m, with a median of 5.5 m. By count: T1 about 60 %, T2 about 25 %, T3 about
  10 %, plus one kiosk.
- **Business names.** The names in the table are OSM data only. Every business shown in the game is fictional.

## 3. Typologies (numbers for the kit)

Each value says where it comes from:

- **[P]** measured on the reference photos (ratios, counted elements);
- **[R]** the current regulation (PAİY 2017 / İBB), which gives upper bounds for new work;
- **[A]** the repo's existing façade archetypes (`src/world/osm/buildings/archetypes.ts`);
- **[L]** literature.

### T1: 1950–70s balconied apartment (dominant)

| Element | Value |
|---|---|
| Storeys | G + 4–5. Total height 17–20 m (f0's 15.5 m is 1–2 floors low) [P] |
| Floor-to-floor, upper | 2.95–3.10 m, typically 3.00 [A Plain 2.95–3.15]. New-build cap is 3.60 m [R Art. 28(1)c] |
| Ground floor | 4.0–4.5 m. Up to 5.5 m with an asma kat [R Art. 28(1)ç/a]. Emel Apt: shop band about 1.6× an upper floor [P] |
| Bays | 2.6–3.2 m. Frontage 4–7 m gives 2 bays, 7–10 m gives 3, 10–13 m gives 4 [A bayW 3.1; frontages in section 2] |
| Windows | White PVC in ≈ 80 % of openings, otherwise brown timber [P]. Single 1.2–1.4 m wide; living-room triple 2.4–2.8 m. Height 1.45–1.55 m, sill 0.85–0.95 m, reveal 0.12–0.18 m [A halfW 0.62, sill 0.9, head 2.35, depth 0.16] |
| Roller shutters | Surface-mounted PVC/aluminium box 0.20–0.25 m high × 0.22 m deep above the head [A crown 0.25]. Some folding PVC shutters stacked beside the windows (Emel Apt) [P] |
| Çıkma | Closed. 0.9–1.2 m on the 6 m lanes; legal max 1.5 m [R Art. 41(1)a]. Soffit ≥ 3.0 m above the lane (legal min 2.4 m [R Art. 41(2)]). Covers the full frontage minus 0.3–0.6 m at each party wall, or the middle 60–70 % with rounded ends (Emel Apt) [P] |
| Balconies | Slab edge 0.12–0.15 m, projection 0.8–1.2 m. Parapets: solid rendered 0.9–1.0 m with a painted band, or steel flat-bar / square-bar railings 0.9–1.0 m. ≈ 40 % are glazed in with PVC [P]. Railing forms are linear, planar, gridal or applique; wrought iron and concrete are the most common materials [L Tulum Okur & Ekenyazıcı Güney 2022]. Flower boxes and travertine slab facings are period features [L GRID, Bağdat Cd apartments] |
| AC units | Outdoor units 0.80 × 0.55 × 0.28 m on brackets under windows or on balconies, 0.5–1.5 per floor per plot, with condensate streaks below (Leaking008/003 decals) [P] |
| Roof | Flat, with a 0.3–0.6 m slab eave or a low parapet; water tanks, satellite dishes, aerials; sometimes a set-back top floor [P] |
| Colours | Ochre yellow, salmon, pale green, cream, light grey, white. 1–2 colours per façade. Ground floor often clad in grey or black composite panels or tiles [P] |
| Wear | Soot streaks 0.3–1.0 m under slab edges and sills, peeling paint on parapets, cable bundles on façades, graffiti up to 2.5 m high [P] |

### T2: late-Ottoman / early-Republic masonry, 1880s–1930s

| Element | Value |
|---|---|
| Height | 2–4 storeys. Floor-to-floor 3.6–4.2 m [A Levantine 3.8–4.25]. Ground floor 3.8–4.5 m |
| Windows | Tall, 0.9–1.1 × 1.9–2.3 m, sill 0.7–0.8 m, reveal ≈ 0.24 m. Caps, pediments or round/pointed arches (arched windows at the Yasa entrance) [P, A] |
| Projections | Bays on stone brackets 0.6–0.9 m. Wrought-iron balconies 0.5–0.8 m on consoles. Cornice 0.3–0.5 m with brackets (c11) [P] |
| Roof | Hipped Marseille-tile roof on some (Yasa 21, Cafer Erol, c07), otherwise flat behind a parapet [P] |
| Finish | Pale yellow, cream or stone grey. Heavy wear [P] |

### T3: 1980s+ infill or refit

5–7 storeys, floor-to-floor 3.0–3.3 m [A Modern 3.05–3.35]. Ribbon or curtain glazing, grey or white composite panels,
glass balustrades, and often a two-storey glazed shop base (c06, AKO corner) [P].

### Heroes

- **1926 pier** (c01).
  - Form: white render, hipped red-tile roof, chimneys and a small dome.
  - Details: pointed-arch windows with blue tile panels, and an arcaded loggia on the east (square) side of about
    5 bays × 3.5 m.
  - Setting: bollards and benches on the apron, which is flush with the square.
- **Haldun Taner** (c04).
  - Form: two-storey pavilions with Seljuk crests and blue tile bands above the arched windows, and a deep canopy over
    the arcaded ground floor.
  - Colour: dusty salmon/beige in the 2013–2019 photos. The hero-spots entry says "cherry red" (vişne çürüğü), so the
    colour after the restoration is unknown.
- **New pier** (c03). It is 82 m long: a two-storey pavilion with a hipped metal roof and a glazed upper floor, then a
  long one-storey arcade with arched windows in cream panels. Tyre fenders run along the quay wall.
- **İskele Camii.** Cut stone with a lead dome and a single minaret. From the strip it is seen over and between the
  small shops on Tavus Sk.
- **Aya Efimia precinct** (c07–c09).
  - Wall: yellow rendered, 3.0–3.5 m high, with a two-tone band at about 1 m.
  - Gates: a gabled gate with an arched fanlight and a cross facing the junction plaza (grey double door in 2024), and
    a wooden double gate under a moulded hood on Yasa Cd.
  - Behind the wall: a stone bell tower with an octagonal lead dome at the south-west, a large plane tree, and
    two-storey yellow annexes with red-tile roofs.
  - History: church 1694, rebuilt 1830 (tarihi.ist).
- **Sürmeli Ali Paşa Çeşmesi** (1693/94, küfeki stone, marble basin, restored 2007).
  - Position: at the east end of the long wall section, about (424.5, 7.4, 6036.5) ±3 m, facing south-south-west
    (heading ≈ 200°).
  - Form: a pointed-arch niche about 1.2 m wide × 2.2 m high in a stone frame about 2.4 m wide, with an inscription
    panel above.

### Shopfront anatomy (every ground floor on Yasa Cd)

| Element | Value |
|---|---|
| Opening | Plot width minus 0.3–0.5 m piers, clear height 2.6–3.0 m. Entrance door 0.9–1.2 m (format-0 doors are 1.4 m) [P] |
| Kepenk | Galvanised roller shutter, 77 mm slats (77–100 mm on the market) [supplier data]. Coil box 0.30–0.35 m behind the fascia, guide rails 60–80 mm. Down at night except on restaurants (c11) [P] |
| Sign band | Fascia 0.6–1.0 m high. Legal max 1.0 m high × 0.30 m deep [R İBB Art. 6(2)]. Box letters or light boxes. Projecting and oval hanging signs about 0.5 × 0.7 m [P; R Art. 6(25)] |
| Awning | Retractable fabric: red/white stripes, green, blue, dark red. Clearance ≥ 2.4 m [R İBB Art. 6(23)]. The rule allows 1.5 m of projection, but in the fish and produce lanes awnings reach 2.5–3.5 m and nearly meet over the lane (c10, Güneşlibahçe photos). Follow the photos |
| Glazing | Aluminium frames, 2.4–2.8 m high, bright interiors [P] |
| Fish stall | Tilted table 0.85–0.95 m at the front rising to 1.2–1.3 m at the back, 1.5–3.0 m deep, spilling 1–2 m onto the lane. Fish on crushed ice in white polystyrene crates, green artificial-grass mats, yellow price tags on sticks. Blue 220 L barrels and bowls, hanging scales, wet paving over drain grates, staff in rubber boots (c10-day, fish-stall photos) [P] |
| Produce / deli | Crates stepped up to 1.2 m. Strings of dried peppers, aubergines and garlic 1–2 m long. Walls of pickle jars. Bare pendant bulbs at 2.2–2.5 m (c10-night, turşu, Güneşlibahçe) [P] |
| Café front | 2–4 tables and 4–8 chairs within 1.5–2 m of the façade, plus A-frame boards and umbrellas (c06, c11, Güneşlibahçe) [P] |

### Surfaces, furniture, cables, night light

- **Yasa Cd paving.** Flush grey concrete/granite slabs ≈ 0.4 × 0.6 m in running bond (c11, c09), dark accent pavers
  (c08), drain grates, 0.6 m manholes (ManholeCover003/011 with their conditions).
- **Square paving.** Interlocking concrete pavers with a white guide line (c01, c02, city-sign photo), and black steel
  bollards 0.9 m high along the Rıhtım edge.
- **Rıhtım Cd.** Asphalt, 15 cm granite kerbs, dropped kerbs with yellow tactile strips at P2/P3 and P6/P7, zebra
  markings, T3 rails embedded in asphalt, signal poles 3.0–3.5 m (c05).
- **Furniture.**
  - Black ball-top bollards 0.9–1.0 m at the lane entrances.
  - Wooden-slat benches on concrete feet.
  - Blue İBB bins 0.9 m high.
  - Planters and lamp columns with twin lanterns at the junction (c07).
  - Café sets and chalkboards (approved assets).
- **Cables.** Span wires cross the lane every 10–15 m at 5–7 m height and carry pendant lamps (c07, c11, Güneşlibahçe
  photos). Façade cable bundles run under the eaves.
- **Night light.**
  - Yasa Cd: warm 2700–3000 K pendant or bracket lanterns every 8–15 m at 5–6 m. Shop interiors at 4000–6500 K spill
    3–5 m onto the lane. Fish and produce stalls use warm halogen or bare bulbs under the awnings. Red and green neon
    signs (c10-night, c11, yasa-entrance-night).
  - Square: tall LED masts at about 4000 K, a warm floodlight on the 1926 pier (c01-night), and ferry deck lights.
  - Rıhtım Cd: sodium and LED arm lamps.
- **Night count.** The strip has ≥ 32 local lights before shop windows are counted (the manifests alone give 12 on
  Yasa Cd).

## 4. Content checklist (pass/fail per camera)

1. **Façade depth is visible.** Every T1/T2 façade within 40 m shows at least 3 depth planes: window reveal
   0.12–0.24 m, slab edge or sill 0.05–0.15 m, and a çıkma of 0.9–1.2 m (T1) or a bay of 0.6–0.9 m (T2). Çıkma soffits,
   slab edges and cornices cast readable shadow lines at c04, c06, c07 and c11.
2. **Shopfront density and signage match the photos.**
   - One shopfront per 4–7 m of frontage, and 100 % of the Yasa Cd ground floor active (except the precinct wall,
     ch 219–247 N).
   - A sign band on every shopfront, and at least 1 projecting sign per 15 m.
   - Awnings on at least 60 % of shopfronts, and at least 90 % at the fish end (ch 240–263).
   - Signs in Turkish with fictional names.
3. **Kerbs and sidewalks read correctly.** 15 cm kerbs, dropped kerbs and tactile strips on Rıhtım Cd. Yasa Cd flush.
   The paving grid is readable at 2–10 m, with texel density ≥ 512 px/m within 10 m and no stretched or repeating tiles
   visible.
4. **Furniture and people are present.**
   - Bollards at both lane entrances and at the junction.
   - At least 1 bench and 1 bin in each square or Rıhtım view.
   - Café furniture at 4 or more fronts on Yasa Cd.
   - Pedestrians (placeholder mannequins): 0.1–0.2/m² on Yasa Cd by day (c06 photo), 0.4–0.6/m² at the fish end
     (c10), and at least 20 in view at c02 and c04.
5. **AO in corners.** Contact darkening 0.2–0.5 m wide at wall/paving junctions, under çıkma soffits and awnings, and
   inside window reveals. The fish lane reads darker under its awnings (c10).
6. **No visible LOD swap within 30 m.** LOD0 for everything within 30 m of the camera. Along a 1.4 m/s walk
   P0 → P11, no pop is visible and no LOD transition happens inside 30 m.
7. **No flicker.** Railings, 77 mm shutter slats, span wires (≤ 10 mm) and sign text stay stable at 1600×900 during the
   walk (≤ 1 px shimmer, no z-fighting on decals).

## 5. Cameras

Every pose was fitted by projecting the compiled footprints and the walk graph into the photo
(`.shots/s1/reference/tools/pose-overlay.py`, output in `.shots/s1/reference/overlays/`; CPU only).

- **Confidence.** "High" means the outlines line up to within about 1°. "Medium" means within about 3° or 3 m. "Low"
  means the framing matches only.
- **Height.** y is the format-0 ground plus 1.6 m (1.5 m for c05). When the compiled ground changes, re-snap y and
  move the target by the same amount.
- **Other times of day.** Photos for other times of day show the same place, and their framing may differ. They
  judge the character of the light, not the pose.

| Camera | Position [x, y, z] | Heading / pitch | vFOV | Times | Pose from (confidence) |
|---|---|---|---|---|---|
| `c01-pier-1926` | 208, 4.93, 5936.1 | 281.5° / 3.1° | 20.0° | day, night | day (high) |
| `c02-pier-square` | 189.8, 4.86, 5937.6 | 299.5° / 2.9° | 61.1° | day | day (medium) |
| `c03-new-pier` | 215, 3.45, 5893 | 19.6° / 0.3° | 37.7° | day | day (medium) |
| `c04-haldun-taner` | 212, 3.69, 5905 | 89° / 4° | 41.8° | day | day (high) |
| `c05-rihtim-tram` (off spine) | 271.1, 6.97, 6032.8 | 279.6° / 0° | 53.1° | day, dusk | day (high) |
| `c06-yasa-west-above` (7 m up) | 385.7, 13.6, 6016.4 | 308° / −12° | 38.7° | day | day (low) |
| `c07-junction-above` (19 m up) | 392, 26.5, 6030 | 80° / −32° | 53.5° | day | day (low) |
| `c08-aya-efimia-gate` | 401.1, 8.76, 6030.8 | 73° / 11.7° | 55.6° | day, night | day (medium) |
| `c09-fountain-wall` | 419, 9.14, 6046.5 | 20° / 3° | 39.2° | day, night | day (medium) |
| `c10-guneslibahce` | 437, 9.81, 6053.9 | 212° / 2° | 53.0° | day, night | night (medium) |
| `c11-yasa-entrance-night` (extra) | 317, 6.87, 5987 | 112° / −3° | 56.8° | night | night (medium) |

Notes on single cameras:

- **c05.** No freely licensed day photo exists at the crossing (P6–P7). c05 is the nearest Rıhtım Cd / T3 view, 61 m
  south-west in tile `2_60`, and it judges the shared street kit only. Build its foreground kit, or leave c05 out of
  pass/fail.
- **c11.** The only on-spine view of the Yasa Cd entrance. It has a 2011 night photo only.
- **c03 and c06.** Their photo GPS tags disagree with the fitted view. c03 was moved 40 m to the quay edge. c06 keeps
  the GPS position, but its compass tag (44°) is wrong.

### What must be recognisable

- **c01.**
  - White 2-storey pier with a hipped red-tile roof, chimneys and a small dome.
  - East loggia of pointed arches, and blue tile panels over the arched windows.
  - The apron is flush with the square; bollards and benches in the foreground.
  - Night: warm floodlit façade, lit arches, dark sky, people as silhouettes.
- **c02.**
  - The square fills the lower 45 % of the frame: grey pavers with puddle hollows.
  - The pier left of centre, and a ferry with a yellow funnel on the right.
  - Lamp mast, simit cart, benches, bins, people crossing.
- **c03.**
  - Water in the lower half.
  - The new pier broadside: two-storey pavilion with a hipped roof and glazed upper floor, then the long arcade with
    arched windows.
  - Tyre fenders along the quay wall.
- **c04.**
  - Haldun Taner: crested pavilions, blue tile bands, the canopy over the arcade.
  - Lamp mast on the left.
  - An open square with 20+ people at 10–40 m.
- **c05.**
  - Embedded T3 rail, zebra and yellow tactile strip.
  - Oval "İskele Cami" stop sign on a grey pole.
  - Bench on concrete feet, blue bin, bollards.
  - Dusk: overhead tram wire, crowd, warm shop light.
- **c06.**
  - The 6 m lane recedes west-north-west to the Rıhtım.
  - Striped retractable awnings and café tables in the foreground.
  - Grey-panel corner refit with 2-storey glazing, a 1960s çıkma block and white glass-balcony infill.
- **c07.**
  - Aya Efimia bell tower behind the plane tree, and the red-tile roofs of the precinct.
  - Junction plaza with planters, bollards, a twin-lantern column and umbrellas.
- **c08.**
  - Gabled yellow gate, arched fanlight, cross, grey double door, octagonal-domed bell tower.
  - Grey pavers with dark accent pavers.
  - Night: warm wash on the yellow wall and a lit fanlight.
- **c09.**
  - A long yellow wall with a two-tone band at about 1 m, a wooden gate under a hood, a bench.
  - The stone fountain niche at the right edge.
  - Night: the fountain lit warm next to a bright cool shop window.
- **c10.**
  - Awnings on both sides nearly meeting over the lane.
  - Fish on tilted iced tables, produce crates, hanging dried vegetables, pendant bulbs, a dense crowd.
  - Day: the anatomy of the fish stall.
- **c11.** Bambi row with awnings and café chairs on the left, a shuttered kepenk kiosk on the right, grey slab paving
  with a manhole, and the lane vanishing east-south-east under warm lamps.

## 6. Data issues for other lanes

These come from the format-0 manifests of 2026-09-24. Each one affects what the S1 cameras show:

1. **İskele Camii** (w102190093). The outline is replaced by its only part, the dome (w694298377), extruded to 15.5 m.
   The prayer hall and the portico are missing. Owner: hero or foundation.
2. **Aya Efimia** (w694298362). The outline is replaced by its only part, the bell tower (w694298363, 3.1 m). The
   church body and the precinct wall (way 179197257, `barrier=wall`) are not built. Owner: hero or street.
3. **Parts lose their parent's levels.** Yasa 21 (w1462853446, L3) and w1462853448 (L5) are replaced by parts with no
   levels, so they get the 15.5 m default. Yasa 21 should be about 9–10 m with a hipped roof. Owner: foundation or
   façade.
4. **Heights.** The piers are 6.2 m (2 levels × 3.1 m) but should be 10–13 m. Haldun Taner is 15.5 m (default) but
   should be 12–14 m. Almost every Yasa Cd building is the 15.5 m default, while the photos show 2–4 storeys (T2) and
   5–6 (T1/T3). Owner: façade (per-building storeys in section 2).
5. **Doors.** All 13 inferred doors on Yasa Cd are 1.4 m wide, and ground floors without a POI have no door. The
   photos show every ground floor open (openings 2.6–3.0 m high across almost the full plot). Owner: façade/shopfront.

## 7. Reference photos

Photos live in `.shots/s1/reference/`, with 1280 px copies. Context-only photos are in `context/`.
`sources.json` repeats this table. `strip-map.png` shows the spine, the square and the camera wedges. The
`_index*.jpg` files are contact sheets. The licences allow local reference use. The photos are never committed or
shipped, and they must be credited if ever shown.

| File | Camera | Time | Taken | Author | Licence | Source |
|---|---|---|---|---|---|---|
| `c01-day.jpg` | c01 | day | 2024-06-12 | Dosseman | CC BY-SA 4.0 | [Kadıköy Iskele Kütüphanesi in 2024 6711.jpg](https://commons.wikimedia.org/wiki/File:Kad%C4%B1k%C3%B6y_Iskele_K%C3%BCt%C3%BCphanesi_in_2024_6711.jpg) |
| `c01-night.jpg` | c01 | night | 2024-04-01 | YG01 | CC BY 4.0 | [Kadikoy Pier Library.IMG 1852.jpg](https://commons.wikimedia.org/wiki/File:Kadikoy_Pier_Library.IMG_1852.jpg) |
| `c02-day.jpg` | c02 | day | 2024-01-16 | Kurmanbek | CC BY-SA 4.0 | [Kadıköy Ferry Terminal in January 2024 03.jpg](https://commons.wikimedia.org/wiki/File:Kad%C4%B1k%C3%B6y_Ferry_Terminal_in_January_2024_03.jpg) |
| `c03-day.jpg` | c03 | day | 2019-12-11 | Matti Blume | CC BY-SA 4.0 | [Kadikoey, Istanbul (P1100156).jpg](https://commons.wikimedia.org/wiki/File:Kadikoey,_Istanbul_(P1100156).jpg) |
| `c04-day.jpg` | c04 | day | 2019-12-11 | Matti Blume | CC BY-SA 4.0 | [Theatre, Kadikoey, Istanbul (P1100155).jpg](https://commons.wikimedia.org/wiki/File:Theatre,_Kadikoey,_Istanbul_(P1100155).jpg) |
| `c05-day.jpg` | c05 | day | 2025-07-22 | Kayra | CC BY 4.0 | [İskele Cami Tramvay İstasyonu T3 2025.jpg](https://commons.wikimedia.org/wiki/File:%C4%B0skele_Cami_Tramvay_%C4%B0stasyonu_T3_2025.jpg) |
| `c05-dusk.jpg` | c05 | dusk | 2024-10-03 | Vano111ru | CC BY 4.0 | [İskele Camii tram station.jpg](https://commons.wikimedia.org/wiki/File:%C4%B0skele_Camii_tram_station.jpg) |
| `c06-day.jpg` | c06 | day | 2014-04-25 | aachim3 | CC BY 3.0 | [Kadiköy - panoramio (4).jpg](https://commons.wikimedia.org/wiki/File:Kadik%C3%B6y_-_panoramio_(4).jpg) |
| `c07-day.jpg` | c07 | day | 2010-07-27 | QuartierLatin1968 | CC BY-SA 3.0 | [Sancte Euphemia Kadıköy.jpg](https://commons.wikimedia.org/wiki/File:Sancte_Euphemia_Kad%C4%B1k%C3%B6y.jpg) |
| `c08-day.jpg` | c08 | day | 2024-05-18 | Yeditepekilisezeynep | CC BY 4.0 | [Ayia Efimia Rum Ortodoks Kilisesi 18.05.jpg](https://commons.wikimedia.org/wiki/File:Ayia_Efimia_Rum_Ortodoks_Kilisesi_18.05.jpg) |
| `c08-night.jpg` | c08 | night | 2019-11-05 | Sp!ros | CC BY-SA 4.0 | [Hagia Eufemia, Istanbul.jpeg](https://commons.wikimedia.org/wiki/File:Hagia_Eufemia,_Istanbul.jpeg) |
| `c09-day.jpg` | c09 | day | 2011-04-13 | M. PINARCI | CC BY-SA 3.0 | [Istanbul, İstanbul, Turkey - panoramio (4).jpg](https://commons.wikimedia.org/wiki/File:Istanbul,_%C4%B0stanbul,_Turkey_-_panoramio_(4).jpg) |
| `c09-night.jpg` | c09 | night | 2023-12-23 | Kurmanbek | CC BY-SA 4.0 | [Sürmeli Ali Paşa Fountain (December 2023).jpg](https://commons.wikimedia.org/wiki/File:S%C3%BCrmeli_Ali_Pa%C5%9Fa_Fountain_(December_2023).jpg) |
| `c10-day.jpg` | c10 | day | 2025-04-29 | Jorge Franganillo | CC BY 4.0 | [Istanbul - Deniz Balıkçılık.jpg](https://commons.wikimedia.org/wiki/File:Istanbul_-_Deniz_Bal%C4%B1k%C3%A7%C4%B1l%C4%B1k.jpg) |
| `c10-night.jpg` | c10 | night | 2019-12-10 | Matti Blume | CC BY-SA 4.0 | [Osmanaga, Istanbul (LRM 20191210 184543-RR).jpg](https://commons.wikimedia.org/wiki/File:Osmanaga,_Istanbul_(LRM_20191210_184543-RR).jpg) |
| `c11-night.jpg` | c11 | night | 2011-05-09 | M. PINARCI | CC BY-SA 3.0 | [Two Days - panoramio.jpg](https://commons.wikimedia.org/wiki/File:Two_Days_-_panoramio.jpg) |
| `context/square-dusk.jpg` | – | dusk | 2019-12-14 | Matti Blume | CC BY-SA 4.0 | [Kadeikoey, Istanbul (LRM 20191214 175515).jpg](https://commons.wikimedia.org/wiki/File:Kadeikoey,_Istanbul_(LRM_20191214_175515).jpg) |
| `context/pier-1926-loggia-night.jpg` | – | night | 2024-04-01 | YG01 | CC BY 4.0 | [Kadikoy Pier Library.IMG 1853.jpg](https://commons.wikimedia.org/wiki/File:Kadikoy_Pier_Library.IMG_1853.jpg) |
| `context/new-pier-dusk.jpg` | – | dusk | 2024-09-28 | Anil Öztas | CC BY 4.0 | [Istanbul (TR), Hafen von Haydarpaşa -- 2024 -- 1093.jpg](https://commons.wikimedia.org/wiki/File:Istanbul_(TR),_Hafen_von_Haydarpa%C5%9Fa_--_2024_--_1093.jpg) |
| `context/haldun-taner-rihtim-dusk.jpg` | – | dusk | 2014-02-07 | Ail Subway | CC BY 3.0 | [Hâldun Taner Sahnesi.JPG](https://commons.wikimedia.org/wiki/File:H%C3%A2ldun_Taner_Sahnesi.JPG) |
| `context/haldun-taner-kiosks-2013.jpg` | – | day | 2013-12-07 | Mark Ahsmann | CC BY-SA 3.0 | [20131207 Istanbul 109.jpg](https://commons.wikimedia.org/wiki/File:20131207_Istanbul_109.jpg) |
| `context/haldun-taner-scaffold-2026.jpg` | – | day | 2026-04-29 | Kurmanbek | CC BY-SA 4.0 | [Haldun Taner Stage restoration in April 2026.jpg](https://commons.wikimedia.org/wiki/File:Haldun_Taner_Stage_restoration_in_April_2026.jpg) |
| `context/yasa-entrance-night.jpg` | – | night | 2011-03-31 | M. PINARCI | CC BY-SA 3.0 | [Closer - panoramio.jpg](https://commons.wikimedia.org/wiki/File:Closer_-_panoramio.jpg) |
| `context/yasa-entrance-rain-night.jpg` | – | night | 2011-03-31 | M. PINARCI | CC BY-SA 3.0 | [Been There - panoramio.jpg](https://commons.wikimedia.org/wiki/File:Been_There_-_panoramio.jpg) |
| `context/cafer-erol-night-seasonal.jpg` | – | night | 2023-12-23 | Kurmanbek | CC BY-SA 4.0 | [Cafer Erol Candy Shop with new year decorations.jpg](https://commons.wikimedia.org/wiki/File:Cafer_Erol_Candy_Shop_with_new_year_decorations.jpg) |
| `context/fountain-night-close.jpg` | – | night | 2023-10-20 | Kurmanbek | CC BY-SA 4.0 | [Sürmeli Ali Paşa Fountain.jpg](https://commons.wikimedia.org/wiki/File:S%C3%BCrmeli_Ali_Pa%C5%9Fa_Fountain.jpg) |
| `context/church-gate-2011.jpg` | – | day | 2011-07-18 | M. PINARCI | CC BY-SA 3.0 | [Yellow Church - panoramio.jpg](https://commons.wikimedia.org/wiki/File:Yellow_Church_-_panoramio.jpg) |
| `context/fish-stall-2.jpg` | – | day | 2025-05-07 | Jorge Franganillo | CC BY 4.0 | [Istanbul - Deniz Balıkçılık (55104271093).jpg](https://commons.wikimedia.org/wiki/File:Istanbul_-_Deniz_Bal%C4%B1k%C3%A7%C4%B1l%C4%B1k_(55104271093).jpg) |
| `context/fish-stall-marmara.jpg` | – | day | 2025-04-29 | Jorge Franganillo | CC BY 4.0 | [Istanbul - Marmara Balık (55107416916).jpg](https://commons.wikimedia.org/wiki/File:Istanbul_-_Marmara_Bal%C4%B1k_(55107416916).jpg) |
| `context/tursu-display.jpg` | – | day | 2024-06-12 | Dosseman | CC BY-SA 4.0 | [Kadıköy turşu in 2024 6705.jpg](https://commons.wikimedia.org/wiki/File:Kad%C4%B1k%C3%B6y_tur%C5%9Fu_in_2024_6705.jpg) |
| `context/typology-t1-emel-apt.jpg` | – | day | 2025-10-06 | Aykabo | CC BY-SA 4.0 | [Emel Apartmanı.jpg](https://commons.wikimedia.org/wiki/File:Emel_Apartman%C4%B1.jpg) |
| `context/typology-guneslibahce-2012.jpg` | – | day | 2012-10-21 | Helge Høifødt | CC BY-SA 3.0 | [Guneslibahce street Kadikoy.JPG](https://commons.wikimedia.org/wiki/File:Guneslibahce_street_Kadikoy.JPG) |
| `context/typology-cafe-street.jpg` | – | day | 2018-05-20 | Raicem | CC BY-SA 4.0 | [Cafe in Kadıköy district.jpg](https://commons.wikimedia.org/wiki/File:Cafe_in_Kad%C4%B1k%C3%B6y_district.jpg) |
| `context/typology-t2-muhurdar-36.jpg` | – | day | 2024-06-12 | Dosseman | CC BY-SA 4.0 | [Kadıköy Fine façade in Mühürdar Caddesi No36 in 2024 6708.jpg](https://commons.wikimedia.org/wiki/File:Kad%C4%B1k%C3%B6y_Fine_fa%C3%A7ade_in_M%C3%BCh%C3%BCrdar_Caddesi_No36_in_2024_6708.jpg) |
| `context/iskele-camii-plaza-night.jpg` | – | night | 2011-05-08 | M. PINARCI | CC BY-SA 3.0 | [No Title - panoramio (2).jpg](https://commons.wikimedia.org/wiki/File:No_Title_-_panoramio_(2).jpg) |
| `context/junction-dusk-flickr.jpg` | – | dusk | 2014 | Harold Litwiler, Poppy | CC BY 2.0 | [Street scene, Kadikoy](https://www.flickr.com/photos/116337886@N07/14487170496) |
| `context/typology-carsi-street-flickr.jpg` | – | day | 2014 | Harold Litwiler, Poppy | CC BY 2.0 | [Streets of Kadikoy](https://www.flickr.com/photos/116337886@N07/14491352256) |

## 8. Sources

- OSM: `data/osm/kadikoy.json` (fetched 2026-09-23), Overpass for way 179197257 (precinct wall) and building tags;
  compiled `public/world/kadikoy` (tiles, `walk.json`).
- Planlı Alanlar İmar Yönetmeliği, consolidated text, Art. 28 (floor heights) and Art. 41 (çıkma):
  <https://mevzuat.gov.tr/File/GeneratePdf?mevzuatNo=23722&mevzuatTur=KurumVeKurulusYonetmeligi&mevzuatTertip=5>.
- İBB Reklam, İlan ve Tanıtım Yönetmeliği, Art. 6(2), 6(23), 6(25):
  <https://uploads.ibb.istanbul/uploads/reklam_ilan_ve_tanitim_yonetmeligi_02_6a962588d4.pdf>.
- H. Tulum Okur, E. Ekenyazıcı Güney, "1960–1980 İstanbul, Kadıköy Konut Mimarlığında Cephede Öne Çıkan Bir Eleman
  Olarak Balkon Korkuluklarının Analizi", Kent Araştırmaları Dergisi, 2022:
  <https://dergipark.org.tr/tr/pub/idealkent/article/1137878>.
- "Geç Modern Dönem konut mimarlığında çiçekliklerin cephe dilindeki yeri: Bağdat Caddesi apartmanları", GRID:
  <https://dergipark.org.tr/en/pub/grid/article/1098245>.
- Kepenk slat sizes (77–100 mm galvanised): <https://www.dalmislarkepenk.com/tr/page/galvaniz-celik-kepenk>,
  <https://ycsmakine.com/77lik-lamel/>.
- Sürmeli Ali Paşa Çeşmesi: <https://tr.wikipedia.org/wiki/S%C3%BCrmeli_Ali_Pa%C5%9Fa_%C3%87e%C5%9Fmesi_(Cafera%C4%9Fa)>.
- Aya Efimia: <https://www.tarihi.ist/ayia-efimia-rum-ortodoks-kilisesi/>.
- Haldun Taner: <https://indigodergisi.com/2025/10/haldun-taner-sahnesi-tarihi-umberto-ferrari/>,
  <https://www.hurriyet.com.tr/gundem/haldun-tanerde-restorasyon-basliyor-hal-binasindan-dev-sahneye-41765486>.
- Piers, İskele Camii, Haldun Taner dimensions: `.docs/research/kadikoy-hero-spots.json` and its sources.
- Repo façade parameters: `src/world/osm/buildings/archetypes.ts` (`ARCHETYPES`).
