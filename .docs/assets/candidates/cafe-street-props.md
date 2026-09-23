# Café and street prop candidates (decided)

## Decision (2026-09-24)

The user approved every recommended candidate (Recommendation batches 1–3 below; the AC unit is the Poly Haven one):
**20 assets.**

- **Poly Haven models, CC0 (10):** Outdoor Table Chair Set 01, Plastic Monobloc Chair 01, Standing Chalkboard 01,
  Modern Ceiling Lamp 01, Steel Frame Shelves 01, Potted Plant 04, Planter Pot Clay, Street Lamp 01, Street Lamp 02,
  Exterior Aircon Unit.
- **ambientCG decals, CC0 (2):** Manhole Cover 003, Manhole Cover 011.
- **Sketchfab models, CC BY 4.0 (8):** Free 3D French Bistro Chair (DELTAHEDRA), Dirty Wicker Stool (raymondrdorollo),
  Canarian Cafe - Coffee Machine (Lanzaman), Kettle / Teapot (Renend Studio), Classic Park Bench (Berk Gedik),
  Garbage Container (Renend Studio), Rusty House Satellite Dish (TomasKiniulis), Simit arabası (byrokestudios).

Conditions set by the user (the third-party mark must be removed before the asset is used in any build):

- Canarian Cafe - Coffee Machine: remove the "IBERICAFE" wordmark.
- Simit arabası: remove the İBB emblem from the side panel (the "SİMİTÇİ" lettering may stay).
- Manhole Cover 011: remove "ACO Drain" from the colour, normal and height maps (the "EN124 AWK B125" marks may stay).

Carried over from this shortlist:

- Manhole Cover 003: check the rim at full resolution for a foundry name before shipping.
- Every Sketchfab model: check the archive for readme or licence files and texture credits, and reject it if its
  textures come from Textures.com, Quixel Megascans or Poliigon (extra care with Renend Studio). Record the CC BY
  attribution and a note of the changes in `public/models/LICENSES.md` on integration.
- Not approved: batch 4 (optional), the "Do not approve" items and the Samad.Ahmed AC alternative. Part C stays
  procedural.

Records: manifest [`tools/assets/approved.json`](../../../tools/assets/approved.json), cache record
[approved-assets.md](../approved-assets.md). Sketchfab downloads need a login, so the 8 models are listed in
[manual-downloads.md](../manual-downloads.md).

---

Status before the decision: shortlist only. The text below is kept unchanged as the record of the review.

## How this list was built

- **Target:** the walkable Kadıköy street layer (`.docs/planning/16-street-layer.md`): S1 needs street furniture and a
  greybox café behind an open door, and S4 needs a café where the player sits and orders çay. The look is grounded
  realism: real proportions and photo-scanned PBR materials. Stylised low-poly kits do not fit.
- **Licence rule** (CLAUDE.md, "External assets"): free assets only. CC0 is preferred. CC-BY 4.0 is allowed if the
  attribution is recorded in `public/models/LICENSES.md` on integration. Non-commercial, no-derivatives, editorial,
  personal-use and unclear licences were skipped, as was anything that forbids redistribution in a public MIT repo.
- **Licence lines** (checked on the live pages on 2026-09-24):
  - **Poly Haven, CC0 1.0.** The licence page says: "Our assets are all licensed as CC0, which is effectively Public
    Domain even in jurisdictions that do not support the Public Domain" ([polyhaven.com/license](https://polyhaven.com/license)).
    Every Poly Haven asset page also shows CC0. Poly Haven textures are already approved, but **its models still need
    approval**.
  - **ambientCG, CC0 1.0.** The licence page says: "You can copy, modify, distribute and perform the assets, even for
    commercial purposes, all without asking permission." and "You can include the raw files in your project, for example
    a video game." ([docs.ambientcg.com/license](https://docs.ambientcg.com/license/)).
  - **Sketchfab, CC-BY 4.0.** Each model's licence comes from the Sketchfab API detail response
    (`GET https://api.sketchfab.com/v3/models/{uid}`). All candidates return `license.label = "CC Attribution"` and
    `license.url = http://creativecommons.org/licenses/by/4.0/`, and all are marked downloadable. The API search with
    `license=cc0` returns almost only museum scans, so no Sketchfab CC0 model qualified. Re-checked on 2026-09-24:
    all 27 Sketchfab candidates still return `license.slug = "by"` and `isDownloadable = true`. No description adds
    terms beyond CC-BY or credits third-party textures. DELTAHEDRA's own site states no conflicting terms, unlike
    the Renderpeople case in `humans.md`.
  - **On download (for each approved Sketchfab model):** check the archive for readme or licence files and for
    texture credits. Reject the model if its textures come from Textures.com, Quixel Megascans or Poliigon, whose
    licences forbid redistributing the raw files. Renend Studio (çaydanlık, garbage container) is a new account
    (joined 2026-01, 33 models), so check its files with extra care.
  - **Previews:** Poly Haven's Terms of Service §4.1 exclude "Asset example renders" from CC0, and Sketchfab
    thumbnails are the authors' renders. The previews in `.shots/` are for local review only (the folder is in
    `.gitignore`).
- **Sources searched:**
  - Poly Haven: the full model list (521 models) through `api.polyhaven.com`.
  - ambientCG: the API, which has manhole decals only and no furniture models.
  - Sketchfab: the API, with about 60 queries in English and Turkish (çay bardağı, çaydanlık, semaver, cezve, tabure,
    hasır, simit, kokoreç, bistro, Thonet, espresso, bollard, bin, bench, awning, AC unit, satellite dish, manhole …).
  - Kenney [Furniture Kit](https://kenney.nl/assets/furniture-kit) ("Creative Commons CC0", 140 files) and Quaternius
    [Ultimate House Interior](https://quaternius.com/packs/ultimatehomeinterior.html) (CC0, 123 models). Both are
    stylised with flat colours, so nothing from them is listed.
  - Smithsonian Open Access (CC0): only museum objects, nothing usable.
  - **ShareTextures was excluded.** Its "custom CC0-based license" says "No asset redistribution on other websites, in
    plugins, or as part of collections without our written permission"
    ([sharetextures.com/p/license](https://www.sharetextures.com/p/license)), and our public repo would redistribute the
    files.
- **Flags found while searching:**
  - Several models by plaggy are titled "CC0 - …" and say CC0 in the description, but Sketchfab labels them
    CC Attribution. Treat them as CC-BY.
  - "Worn street signs" (nkilstrup) uses textures "from Textures.com", whose terms forbid redistribution, so it was excluded.
  - "AC Outdoor Unit - Low Poly" (Samad.Ahmed) shows a GREE logo, a trademark, plus a USAID logo and other stickers.
  - "Diner-counter" (lanzaboy) and "Chalkboard_sign_V1" (clon6767) have signage and text baked into their textures.
- **Third-party marks found in the licence re-check (2026-09-24).** CC0 and CC-BY cover the author's copyright only.
  They do not license trademarks or emblems (CC0 §4a: "No trademark or patent rights held by Affirmer are waived"). So
  these marks must be painted out of the textures **before** a file enters the repo. Each was confirmed on the
  source's own larger preview:
  - Canarian Cafe coffee machine (recommended): an "IBERICAFE" wordmark on the drip-tray front.
  - Commercial Coffee Machine: a gold "Coffee Master" badge on the group head.
  - Simit arabası (recommended): what appears to be the **İBB (Istanbul Metropolitan Municipality) emblem** on the
    side panel, next to "SİMİTÇİ".
  - Manhole Cover 011 (recommended): "ACO Drain" cast into the frame, a drainage manufacturer's trademark, beside the
    "EN124 AWK B125" rating marks.
  - AC Units (Udon-San): a "SAHARA" wordmark embossed on the first unit.
  - Chalkboard_sign_V1: one board is a "SMOKEY BONES Bar & Fire Grill" menu, a real restaurant chain.
  - Rollershutter Window 01 / Door: the graffiti variant is covered in tags and a piece ("Snuk", "FLOW") that look
    like real graffiti. The artists' rights were not Poly Haven's to waive, so use the clean variant only.
- **Numbers:**
  - Poly Haven "tris" is the triangle count its API reports; the asset page shows the same number as "tris".
  - Poly Haven "glTF 1K" is the glTF plus its 1K textures, summed from `api.polyhaven.com/files/{id}`.
  - Sketchfab "faces" is the face count its viewer reports. "GLB" is the archive size and texture count × largest
    texture, both from the Sketchfab search API.
  - Dimensions are from Poly Haven metadata, in metres.
- **Formats:**
  - Poly Haven: glTF, FBX, Blend and USD, with textures from 1K to 4K or 8K.
  - Sketchfab: glTF and GLB (Sketchfab's own conversion), USDZ and the author's original upload.
  - ambientCG: zipped JPG or PNG map sets from 1K to 8K.
  - All props are static, so no rig, skeleton or animation applies.
- **Scores:** realism and Kadıköy fit are rated 1–10 from the preview and the metadata. Nothing has been rendered in
  our engine yet.
- **Previews** are the source's own thumbnails, saved with curl under `.shots/assets/cafe-street-props/`
  (48 files, 1.7 MB). Poly Haven previews are 256 px PNGs, Sketchfab previews are 720 px JPEGs and ambientCG
  previews are 256 px JPEGs.

Short licence tags used in the tables:

- **CC0 (PH):** Poly Haven, "licensed as CC0" ([licence](https://polyhaven.com/license)).
- **CC0 (ACG):** ambientCG, "Creative Commons CC0 1.0 Universal License" ([licence](https://docs.ambientcg.com/license/)).
- **CC-BY 4.0 (SF):** Sketchfab, "CC Attribution" ([licence](http://creativecommons.org/licenses/by/4.0/)).

---

# Part A: café

## A1. Sidewalk and indoor café seating (bistro sets, Thonet chairs)

| Name | Source | Licence | Author | Size | Tris / textures | Realism | Kadıköy fit | Replaces / adds | Risks | Preview |
|---|---|---|---|---|---|---|---|---|---|---|
| Outdoor Table Chair Set 01 | [Poly Haven](https://polyhaven.com/a/outdoor_table_chair_set_01) | CC0 (PH) | James Ray Cock | glTF 1K 1.2 MB (2K 3.2 MB) | 9.8k tris for the table and 2 chairs; up to 4K | 9: scanned-quality wood slats on a folding metal frame | 9: the folding bistro set on café sidewalks in the çarşı and Moda | Replaces the near LOD of the details layer's `cafeTable` | Chairs and table are one set and must be split for seating slots | [bistro-ph-outdoor-table-chair-set-01.png](../../../.shots/assets/cafe-street-props/bistro-ph-outdoor-table-chair-set-01.png) |
| Free 3D French Bistro Chair | [Sketchfab](https://sketchfab.com/3d-models/6b0a51cfa9784a60ae82e05db38f9ec0) | CC-BY 4.0 (SF) | DELTAHEDRA (@deltahedra) | GLB 1.3 MB, 1 × 1K | 17k faces (**needs decimation** to ~3k) | 8: bentwood Thonet-style chair | 9: the classic chair of Istanbul cafés and meyhanes | Adds indoor café chairs (L3 café shell) | Heavy for a chair, and bentwood curves need care when decimating | [bistro-sf-french-bistro-chair.jpg](../../../.shots/assets/cafe-street-props/bistro-sf-french-bistro-chair.jpg) |
| Chaise de café | [Sketchfab](https://sketchfab.com/3d-models/92fc926cadae41468a3976b931c58ba4) | CC-BY 4.0 (SF) | gilles.schaeck | GLB 2.1 MB, 3 × 1K | 6.3k faces | 7: thin metal chair with a woven seat | 6: a French terrace chair, less common in Kadıköy | Adds variety to sidewalk seating | Thin rods can alias at distance, so it needs a simpler far LOD | [bistro-sf-chaise-de-cafe.jpg](../../../.shots/assets/cafe-street-props/bistro-sf-chaise-de-cafe.jpg) |
| Round Wooden Table 02 | [Poly Haven](https://polyhaven.com/a/round_wooden_table_02) | CC0 (PH) | Ulan Cabanilla | glTF 1K 1.9 MB | 4.3k tris; up to 4K; Ø 0.80 m × 0.75 m | 8: dark pedestal table | 7: indoor café table | Adds indoor tables | A pedestal cabinet base, heavier-looking than a café table | [bistro-ph-round-wooden-table-02.png](../../../.shots/assets/cafe-street-props/bistro-ph-round-wooden-table-02.png) |

**Recommendation:** approve **Outdoor Table Chair Set 01** for sidewalk cafés and the **French Bistro Chair** for
indoor cafés, decimated to about 3k faces. Build tables procedurally (see Part C), because their sizes and tops
(marble, wood, tablecloth) vary by place.

## A2. Tea-garden and kahvehane seating (low wicker stools, plastic chairs)

| Name | Source | Licence | Author | Size | Tris / textures | Realism | Kadıköy fit | Replaces / adds | Risks | Preview |
|---|---|---|---|---|---|---|---|---|---|---|
| Dirty Wicker Stool | [Sketchfab](https://sketchfab.com/3d-models/34d4383eaaae493896a058b77342b09e) | CC-BY 4.0 (SF) | raymondrdorollo | GLB 13.8 MB, 3 × 2K | 1.5k faces | 8: worn wooden frame with a woven rush seat | 10: the low *hasır tabure* of çay ocakları, kahvehanes and tea gardens | Adds the signature tea-house seat | Textures must be cut to 512–1K | [teagarden-sf-dirty-wicker-stool.jpg](../../../.shots/assets/cafe-street-props/teagarden-sf-dirty-wicker-stool.jpg) |
| Plastic Monobloc Chair 01 | [Poly Haven](https://polyhaven.com/a/plastic_monobloc_chair_01) | CC0 (PH) | Kuutti Siitonen | glTF 1K 2.0 MB | 3.4k tris; up to 4K | 9: weathered white monobloc | 9: tea gardens, seaside kiosks, shop fronts | Adds cheap outdoor seating | None | [teagarden-ph-plastic-monobloc-chair-01.png](../../../.shots/assets/cafe-street-props/teagarden-ph-plastic-monobloc-chair-01.png) |
| Furniture Pack For Summer Caffe FREE | [Sketchfab](https://sketchfab.com/3d-models/441daec1a1f149698a88694780151b94) | CC-BY 4.0 (SF) | Kozlov Maksim (@kozlovchik) | GLB 35.1 MB, 3 × 4K | 3.8k faces (table 692 tris, chair 1052 tris per the author) | 7: grey painted folding wooden table and chairs | 8: close to tea-garden folding sets | Adds tea-garden tables and chairs | 4K textures, so reduce to 1K | [teagarden-sf-summer-caffe-pack.jpg](../../../.shots/assets/cafe-street-props/teagarden-sf-summer-caffe-pack.jpg) |
| plastic_stool | [Sketchfab](https://sketchfab.com/3d-models/2f7eef3500c846b8a112433be9912118) | CC-BY 4.0 (SF) | c.gleison | GLB 0.8 MB, 3 × 1K | 2.7k faces | 7: scratched green plastic stool | 8: common at çay ocakları and street stalls | Adds low plastic stools | None | [teagarden-sf-plastic-stool.jpg](../../../.shots/assets/cafe-street-props/teagarden-sf-plastic-stool.jpg) |

**Recommendation:** approve the **Dirty Wicker Stool** and the **Plastic Monobloc Chair 01**. Together they cover the
tea-house look. The Summer Caffe pack and the plastic stool are optional variety.

## A3. Counter / bar

No candidate is recommended. **Build it procedurally.** The counter must be fitted to each L3 café shell (length,
corner, doorway), and a Kadıköy café counter is a simple box in tile, marble or wood with a glass pastry vitrine. That is
cheaper to generate with CC0 Poly Haven / ambientCG materials than to adapt a model. Checked and rejected:
[bar counter](https://sketchfab.com/3d-models/78c700db0d9f4d7c800fb789dfa2e057) (Gnossiennes, a curved tavern counter),
[Diner-counter](https://sketchfab.com/3d-models/61a8b17cb1784b05901e83e8d42d403d) (lanzaboy, a US diner with "Jay's" signage),
and "Cafe Counter Area" / "Modern Coffee Shop Interior" (0.35M–1.8M faces, untextured whole scenes).

## A4. Espresso machine

| Name | Source | Licence | Author | Size | Tris / textures | Realism | Kadıköy fit | Replaces / adds | Risks | Preview |
|---|---|---|---|---|---|---|---|---|---|---|
| Canarian Cafe - Coffee Machine | [Sketchfab](https://sketchfab.com/3d-models/17042d9af8c5461e98876064fd80385d) | CC-BY 4.0 (SF) | Lanzaman (@lanzaboy) | GLB 3.3 MB, 4 × 4K | 16.5k faces | 8: retro teal two-group commercial machine | 8: the third-wave cafés of Moda and Kadıköy | Adds the hero prop behind the counter (one per café) | **"IBERICAFE" wordmark** on the drip-tray front must be painted out before it enters the repo; reduce to 1K | [espresso-sf-canarian-coffee-machine.jpg](../../../.shots/assets/cafe-street-props/espresso-sf-canarian-coffee-machine.jpg) |
| Commercial Coffee Machine | [Sketchfab](https://sketchfab.com/3d-models/bab05bc7805d4b0dbc2cdcbb48441956) | CC-BY 4.0 (SF) | M.Reslan (@mreslan) | GLB 28.4 MB, 4 × 4K | 29k faces | 8: chrome and red two-group machine with a cup warmer | 8 | Same as above, a second café's variant | Heavier; reduce textures to 1K. **Gold "Coffee Master" badge** on the group head must be painted out | [espresso-sf-commercial-coffee-machine.jpg](../../../.shots/assets/cafe-street-props/espresso-sf-commercial-coffee-machine.jpg) |

**Recommendation:** approve the **Canarian Cafe coffee machine**, which is light (3.3 MB) and realistic, **on the
condition that the "IBERICAFE" wordmark is painted out** of its textures before the file enters the repo. The only CC0
option, Poly Haven [Coffee Cart 01](https://polyhaven.com/a/CoffeeCart_01), is an office drip-brewer cart, not an
espresso machine, so it is not listed.

## A5. Çaydanlık, semaver and tea boiler

| Name | Source | Licence | Author | Size | Tris / textures | Realism | Kadıköy fit | Replaces / adds | Risks | Preview |
|---|---|---|---|---|---|---|---|---|---|---|
| Kettle / Teapot - Low Poly / Game Ready | [Sketchfab](https://sketchfab.com/3d-models/7c39cde0ada943b480a2d7786c1bd633) | CC-BY 4.0 (SF) | Renend Studio (@RenendStudio) | GLB 0.2 MB, no textures (material colours) | 4.8k faces | 8: stainless double-stacked çaydanlık, as the author describes it | 10: the çaydanlık on every café and home stove | Adds the S4 çay-service prop | Chrome relies on good reflections (probes) | [tea-sf-caydanlik-renend.jpg](../../../.shots/assets/cafe-street-props/tea-sf-caydanlik-renend.jpg) |
| Copper Water Boiler | [Sketchfab](https://sketchfab.com/3d-models/65f8054471694c7b92d3a2cd3e6596a7) | CC-BY 4.0 (SF) | Dudzy | GLB 55.1 MB, **75** textures up to 2K | 11k faces | 8: engraved copper tea boiler with taps | 9: "an industrial-style teapot used in coffeehouses in Turkey" (author) | Adds the kahvehane / çay ocağı counter boiler | 75 textures must be baked into one atlas | [tea-sf-copper-water-boiler.jpg](../../../.shots/assets/cafe-street-props/tea-sf-copper-water-boiler.jpg) |
| Samovar - Semaver | [Sketchfab](https://sketchfab.com/3d-models/f889583ee3d3483e8f79f1257acd2500) | CC-BY 4.0 (SF) | tarkouz | GLB 4.0 MB, untextured | 113k faces (**needs decimation** to ~10k) | 6: correct modern Turkish semaver shape, no materials | 9: "widely used in Turkey to make tea" (author); tea gardens | Adds the tea-garden semaver | Needs decimation and our own chrome/black materials | [tea-sf-semaver-tarkouz.jpg](../../../.shots/assets/cafe-street-props/tea-sf-semaver-tarkouz.jpg) |
| Samovar | [Sketchfab](https://sketchfab.com/3d-models/f428aa1644724b61895f1287b5a8db93) | CC-BY 4.0 (SF) | hellotaia | GLB 9.4 MB, 3 × 2K | 7.4k faces | 8: antique copper samovar | 5: decoration for antique shops and meyhanes, not for serving | Adds decoration | None | [tea-sf-samovar-hellotaia.jpg](../../../.shots/assets/cafe-street-props/tea-sf-samovar-hellotaia.jpg) |

**Recommendation:** approve the **Renend Studio çaydanlık** now for S4. The Copper Water Boiler and the tarkouz
semaver are good later additions for a kahvehane and a tea garden (S5), after atlasing or decimation.

## A6. İnce belli tea glass, saucer and cups

| Name | Source | Licence | Author | Size | Tris / textures | Realism | Kadıköy fit | Replaces / adds | Risks | Preview |
|---|---|---|---|---|---|---|---|---|---|---|
| Caybardag/tea cup | [Sketchfab](https://sketchfab.com/3d-models/a3d3662b2d104031b305be295769ef18) | CC-BY 4.0 (SF) | Bıyıklıküp (@Esritogan) | GLB 0.2 MB, untextured | 4.9k faces | 6: correct tulip profile and saucer, no glass or tea material | 10 by shape | Adds the tea glass for S4 | Needs glass and tea materials; 4.9k faces is heavy for a cup | [glass-sf-caybardagi-esritogan.jpg](../../../.shots/assets/cafe-street-props/glass-sf-caybardagi-esritogan.jpg) |
| Turkish Delight Scene | [Sketchfab](https://sketchfab.com/3d-models/0fb7741c63a442a19b6932a4f8f9fecc) | CC-BY 4.0 (SF) | nur_ay | GLB 54.9 MB, 6 × 4K | 76k faces for the whole scene | 8: tea glasses on a tray, çaydanlık, tavla (backgammon) board, lokum, side table | 9: kahvehane table dressing | Adds tavla and a tea tray (split into parts) | Must be split, decimated and cut to 1K | [glass-sf-turkish-delight-scene.jpg](../../../.shots/assets/cafe-street-props/glass-sf-turkish-delight-scene.jpg) |

**Recommendation:** **build the tea glass, saucer, spoon, tea liquid and coffee cups procedurally.** They are lathe
profiles of about 200–400 triangles each, and what sells them is the glass/tea material, not the mesh. Keep
Esritogan's glass only as a fallback. The Turkish Delight Scene is optional for a later kahvehane with tavla.

## A7. Menu board

| Name | Source | Licence | Author | Size | Tris / textures | Realism | Kadıköy fit | Replaces / adds | Risks | Preview |
|---|---|---|---|---|---|---|---|---|---|---|
| Standing Chalkboard 01 | [Poly Haven](https://polyhaven.com/a/standing_chalkboard_01) | CC0 (PH) | ParzivalCG | glTF 1K 2.6 MB | 2.4k tris; up to 4K; 0.92 × 0.76 × 1.51 m | 9: blank, smudged slate in an oak A-frame | 9: the sidewalk menu board in front of cafés | Adds A-frame boards; our Turkish menu text goes on as a decal | None | [menu-ph-standing-chalkboard-01.png](../../../.shots/assets/cafe-street-props/menu-ph-standing-chalkboard-01.png) |
| Chalkboard_sign_V1 | [Sketchfab](https://sketchfab.com/3d-models/d989e2cf9a0744cb8bcb90c2560bb409) | CC-BY 4.0 (SF) | clon6767 | GLB 12.1 MB, 6 × 2K | 608 faces | 7 | 5: English menu text is baked in | Same | **Reject:** one board is a "SMOKEY BONES Bar & Fire Grill" menu (a real restaurant chain), so every slate texture would have to be replaced | [menu-sf-chalkboard-sign-v1.jpg](../../../.shots/assets/cafe-street-props/menu-sf-chalkboard-sign-v1.jpg) |

**Recommendation:** approve **Standing Chalkboard 01** (CC0, blank slate). Wall-mounted menu boards behind the
counter are flat panels and can be procedural.

## A8. Pendant and ceiling lights

| Name | Source | Licence | Author | Size | Tris / textures | Realism | Kadıköy fit | Replaces / adds | Risks | Preview |
|---|---|---|---|---|---|---|---|---|---|---|
| Modern Ceiling Lamp 01 | [Poly Haven](https://polyhaven.com/a/modern_ceiling_lamp_01) | CC0 (PH) | James Ray Cock | glTF 1K 0.44 MB | 5.6k tris; up to 8K; Ø 0.43 × 0.95 m | 9: frosted glass globe on a cord | 8: common in cafés and shops | Adds café pendants (light positions in the interior manifest) | Needs an emissive mask for the lit globe | [light-ph-modern-ceiling-lamp-01.png](../../../.shots/assets/cafe-street-props/light-ph-modern-ceiling-lamp-01.png) |
| Hanging Industrial Lamp | [Poly Haven](https://polyhaven.com/a/hanging_industrial_lamp) | CC0 (PH) | Kuutti Siitonen | glTF 1K 3.2 MB | 9.5k tris; up to 4K; has an emissive map | 8: caged green factory lamp | 6: industrial-style cafés and workshops | Adds variety | Big and heavy for a pendant | [light-ph-hanging-industrial-lamp.png](../../../.shots/assets/cafe-street-props/light-ph-hanging-industrial-lamp.png) |
| Pull Chain Light Socket | [Poly Haven](https://polyhaven.com/a/pull_chain_light_socket) | CC0 (PH) | Josh Dean | glTF 1K 2.1 MB | 10.9k tris for an 11 cm object; up to 8K | 9: porcelain socket with a brass pull chain | 6: bare-bulb ceilings in old shops and stairwells | Adds a bare-bulb fitting | Far too many triangles for its size | [light-ph-pull-chain-light-socket.png](../../../.shots/assets/cafe-street-props/light-ph-pull-chain-light-socket.png) |

**Recommendation:** approve **Modern Ceiling Lamp 01**. Build the **bare-bulb pendant** (cord, holder, filament bulb,
the most common Kadıköy café light) procedurally. The other two are optional.

## A9. Shelves

| Name | Source | Licence | Author | Size | Tris / textures | Realism | Kadıköy fit | Replaces / adds | Risks | Preview |
|---|---|---|---|---|---|---|---|---|---|---|
| Steel Frame Shelves 01 | [Poly Haven](https://polyhaven.com/a/steel_frame_shelves_01) | CC0 (PH) | James Ray Cock | glTF 1K 1.6 MB | 4.3k tris; up to 8K; 1.10 × 0.50 × 2.14 m | 9: black steel frame with wooden planks | 8: café back walls, bakkal and book-café shelving | Adds interior shelving | Shelves are empty; dressing comes from other props | [shelf-ph-steel-frame-shelves-01.png](../../../.shots/assets/cafe-street-props/shelf-ph-steel-frame-shelves-01.png) |
| Wooden Display Shelves 01 | [Poly Haven](https://polyhaven.com/a/wooden_display_shelves_01) | CC0 (PH) | James Ray Cock | glTF 1K 0.47 MB | 3.2k tris; up to 8K; 1.08 × 0.37 × 1.56 m | 8: pine cube shelf with bins | 6: an IKEA-like look | Adds variety | None | [shelf-ph-wooden-display-shelves-01.png](../../../.shots/assets/cafe-street-props/shelf-ph-wooden-display-shelves-01.png) |

**Recommendation:** approve **Steel Frame Shelves 01**. Poly Haven [Painted Wooden Shelves](https://polyhaven.com/a/painted_wooden_shelves)
(524 tris) is a small wall-shelf alternative.

## A10. Plants

| Name | Source | Licence | Author | Size | Tris / textures | Realism | Kadıköy fit | Replaces / adds | Risks | Preview |
|---|---|---|---|---|---|---|---|---|---|---|
| Potted Plant 04 | [Poly Haven](https://polyhaven.com/a/potted_plant_04) | CC0 (PH) | James Ray Cock | glTF 1K 2.1 MB | 6.1k tris; up to 8K; 0.27 m tall | 9: zebra haworthia in a ceramic pot | 8: café tables and windowsills | Adds small table plants | None | [plant-ph-potted-plant-04.png](../../../.shots/assets/cafe-street-props/plant-ph-potted-plant-04.png) |
| Planter Pot Clay | [Poly Haven](https://polyhaven.com/a/planter_pot_clay) | CC0 (PH) | Amal Kumar | glTF 1K 1.8 MB | 3.1k tris; up to 4K; Ø 0.27 m | 9: weathered, mossy terracotta | 9: the pots lining shop fronts and balconies | Pot for the existing `planter` prop; filled with our foliage-atlas cards | Empty pot; the plant is ours | [plant-ph-planter-pot-clay.png](../../../.shots/assets/cafe-street-props/plant-ph-planter-pot-clay.png) |
| Potted Plant 02 | [Poly Haven](https://polyhaven.com/a/potted_plant_02) | CC0 (PH) | Rico Cilliers | glTF 1K 2.6 MB | 70k tris (**needs decimation**); alpha leaves; 0.84 m tall | 9: large-leaved plant in terracotta | 7: café corners | Adds one large indoor plant | Heavy; alpha overdraw | [plant-ph-potted-plant-02.png](../../../.shots/assets/cafe-street-props/plant-ph-potted-plant-02.png) |

**Recommendation:** approve **Potted Plant 04** and **Planter Pot Clay**. Potted Plant 02 is optional after decimation.

---

# Part B: street

## B1. Street lamps

| Name | Source | Licence | Author | Size | Tris / textures | Realism | Kadıköy fit | Replaces / adds | Risks | Preview |
|---|---|---|---|---|---|---|---|---|---|---|
| Street Lamp 01 | [Poly Haven](https://polyhaven.com/a/street_lamp_01) | CC0 (PH) | Josh Dean | glTF 1K 2.2 MB | 30.6k tris (**needs decimation** to ~5k); up to 8K; 3.87 m tall; opacity map | 9: black cast-iron lantern post with glass panes | 7: the historic-lane / pedestrian-street lantern type (çarşı, Moda); İBB lanterns differ in detail | Near LOD of `lampLantern` | Needs an emissive mask for the glass and the `LAMP_HEADS` offsets re-measured | [lamp-ph-street-lamp-01.png](../../../.shots/assets/cafe-street-props/lamp-ph-street-lamp-01.png) |
| Street Lamp 02 | [Poly Haven](https://polyhaven.com/a/street_lamp_02) | CC0 (PH) | Josh Dean | glTF 1K 1.9 MB | 20.3k tris (**needs decimation** to ~4k); up to 8K; 1.68 m bracket | 9: wall-bracket lantern with scrollwork | 7: façade lanterns of kerbless cobbled lanes | Near LOD of `lampWall` | Same as above | [lamp-ph-street-lamp-02.png](../../../.shots/assets/cafe-street-props/lamp-ph-street-lamp-02.png) |

**Recommendation:** approve **Street Lamp 01 and 02** as near LODs for the lantern types. **Keep the LED and sodium
masts procedural** (`lampArm`, `lampArmLow`, `lampDouble`): they are plain galvanised poles that the generator already
matches, and their per-instance light colour and head sprites are wired into `kinds.ts`. No free model of an İBB mast
was found. Sketchfab "Fancy Street Lamp" (beru837, 65k faces, a double-globe park lamp) was dropped.

## B2. Bollards

| Name | Source | Licence | Author | Size | Tris / textures | Realism | Kadıköy fit | Replaces / adds | Risks | Preview |
|---|---|---|---|---|---|---|---|---|---|---|
| Street Bollard | [Sketchfab](https://sketchfab.com/3d-models/9b9db79ae21c4e118423efae658e7fb7) | CC-BY 4.0 (SF) | Faheem Yusuf (@FameProductions) | GLB 7.1 MB, 4 × 2K | 1.5k faces | 7: black cast-iron post with a gold band | 5: a UK bollard ("found around the streets of the UK", author) | Near LOD of `bollard` | Wrong national profile | [bollard-sf-street-bollard-fame.jpg](../../../.shots/assets/cafe-street-props/bollard-sf-street-bollard-fame.jpg) |

**Recommendation:** **keep bollards procedural.** An İBB bollard is a lathe profile (dark steel or cast-iron post,
often ball-topped) that thousands of instances share, which is easier to match exactly in code, textured with CC0 metal
materials. Also checked: "Bollard" (dk_artist, an orange flexible post) and "Old bollard" (gigissw, ornate), both a
poor fit.

## B3. Bins and waste containers

| Name | Source | Licence | Author | Size | Tris / textures | Realism | Kadıköy fit | Replaces / adds | Risks | Preview |
|---|---|---|---|---|---|---|---|---|---|---|
| Garbage Container - Game Ready | [Sketchfab](https://sketchfab.com/3d-models/0b5a86c23ee8408d85cfb56d13b90370) | CC-BY 4.0 (SF) | Renend Studio (@RenendStudio) | GLB 0.4 MB, 1 × 512 | 2.1k faces | 7: worn galvanised four-wheel container with an open lid and rubbish inside | 9: the metal containers standing on Kadıköy side streets | Adds side-street waste containers (new) | 512 textures are soft up close | [bin-sf-garbage-container-renend.jpg](../../../.shots/assets/cafe-street-props/bin-sf-garbage-container-renend.jpg) |
| Trash Container | [Sketchfab](https://sketchfab.com/3d-models/c8c76cb8539146b0b3104b92969921a5) | CC-BY 4.0 (SF) | Dasamura | GLB 55.8 MB, 3 × 4K | 9.2k faces | 8: black steel four-wheel dumpster with a hinged lid | 7 | Variant of the above | 4K textures, so reduce to 1K | [bin-sf-trash-container-dasamura.jpg](../../../.shots/assets/cafe-street-props/bin-sf-trash-container-dasamura.jpg) |
| Trash Can | [Sketchfab](https://sketchfab.com/3d-models/f61aeec14ff441abb0f6add5485a2e90) | CC-BY 4.0 (SF) | Lyskilde (@longtail) | GLB 4.5 MB, 6 × 1K (4 colour variants) | 980 tris per the author (3.9k faces in the viewer) | 7: two-wheel wheelie bins in green, blue, black and grey | 6: smaller than the typical Istanbul container | Adds wheelie bins at shop doors | None | [bin-sf-trash-can-longtail.jpg](../../../.shots/assets/cafe-street-props/bin-sf-trash-can-longtail.jpg) |

**Recommendation:** approve the **Renend Studio Garbage Container** for the side-street containers. **Keep the
pole-mounted litter bins procedural** (`bin`): no free Istanbul-style model exists, and the photoscans found (ffedo,
Tbilisi) have 125k–415k faces. Poly Haven [Metal Trash Can](https://polyhaven.com/a/metal_trash_can) is a US-style
ribbed can and was not listed.

## B4. Benches

| Name | Source | Licence | Author | Size | Tris / textures | Realism | Kadıköy fit | Replaces / adds | Risks | Preview |
|---|---|---|---|---|---|---|---|---|---|---|
| Classic Park Bench (Low Poly) | [Sketchfab](https://sketchfab.com/3d-models/01a5b64427984632bb44242da3813bb1) | CC-BY 4.0 (SF) | Berk Gedik (@berkgedik) | GLB 22.2 MB, 9 × 2K | 4.8k faces | 8: wooden slats on black cast-iron legs | 9: the common İBB park and seafront bench | Near LOD of `bench` | 9 textures, so merge into one 1K set | [bench-sf-classic-park-bench-berkgedik.jpg](../../../.shots/assets/cafe-street-props/bench-sf-classic-park-bench-berkgedik.jpg) |
| Park Bench | [Sketchfab](https://sketchfab.com/3d-models/2ee2bc87756d4bf0932d83ab860ddb8f) | CC-BY 4.0 (SF) | RBG_illustrations | GLB 14.6 MB, 6 × 2K | 2.9k faces | 8: wood with green cast-iron ends | 8 | Alternative near LOD | Same | [bench-sf-park-bench-rbg.jpg](../../../.shots/assets/cafe-street-props/bench-sf-park-bench-rbg.jpg) |
| Modular Street Seating | [Poly Haven](https://polyhaven.com/a/modular_street_seating) | CC0 (PH) | Stuart Attenborrow | glTF 1K 7.6 MB | 25k tris for the whole kit; up to 4K | 9: modern timber-on-steel modules, straight and curved | 7: renovated squares and the İskele area | Adds modern plaza seating | Kit must be split; heavy at 1K | [bench-ph-modular-street-seating.png](../../../.shots/assets/cafe-street-props/bench-ph-modular-street-seating.png) |

**Recommendation:** approve the **Classic Park Bench (Berk Gedik)**. The seated-people slots in `placement.ts` need
the seat height and depth re-measured. Modular Street Seating is optional for modern squares.

## B5. Bicycle racks

| Name | Source | Licence | Author | Size | Tris / textures | Realism | Kadıköy fit | Replaces / adds | Risks | Preview |
|---|---|---|---|---|---|---|---|---|---|---|
| Bike Rack #4 | [Sketchfab](https://sketchfab.com/3d-models/8c8fd4fa06eb4b1c8db5bd3584892f3c) | CC-BY 4.0 (SF) | aecoviz | GLB 2.3 MB, 3 × 2K | 1.1k faces | 7: stainless hoop with a bicycle-symbol plate | 6 | Adds bike racks (new) | None | [bikerack-sf-bike-rack-4-aecoviz.jpg](../../../.shots/assets/cafe-street-props/bikerack-sf-bike-rack-4-aecoviz.jpg) |
| CC0 - Bicycle Stand 4 | [Sketchfab](https://sketchfab.com/3d-models/597656d383f94bca8fa098905a126ee1) | CC-BY 4.0 (SF), although the title and description say CC0 | plaggy | GLB 38.7 MB, 3 × 4K | 7.5k faces | 7: row of galvanised hoops | 6 | Same | **Licence mismatch**, so treat it as CC-BY | [bikerack-sf-bicycle-stand-4-plaggy.jpg](../../../.shots/assets/cafe-street-props/bikerack-sf-bicycle-stand-4-plaggy.jpg) |

**Recommendation:** **build bike racks procedurally** (bent tube sweeps). They are rare in Kadıköy and trivial to
generate. Neither model is needed.

## B6. Simit, newspaper and street-food stands

| Name | Source | Licence | Author | Size | Tris / textures | Realism | Kadıköy fit | Replaces / adds | Risks | Preview |
|---|---|---|---|---|---|---|---|---|---|---|
| Simit arabası / Bagel seller | [Sketchfab](https://sketchfab.com/3d-models/919b1932f9004d5ebb0801777ddb2d9f) | CC-BY 4.0 (SF) | byrokestudios | GLB 16.2 MB, 7 × 1K | 312k faces (**needs heavy decimation** to ~8k) | 8: the red glass-case simit cart on spoked wheels | 10: the exact Istanbul simit arabası | Near LOD of `simitCart` | Heavy; check that the decimated glass case stays clean. **The side panel carries what appears to be the İBB emblem**, which must be painted out before it enters the repo | [vendor-sf-simit-arabasi-byroke.jpg](../../../.shots/assets/cafe-street-props/vendor-sf-simit-arabasi-byroke.jpg) |
| Street Food Vendor Challenge - Kokorec | [Sketchfab](https://sketchfab.com/3d-models/141db37d07fc4ccba84ab5f38a8181b5) | CC-BY 4.0 (SF) | Berk Gedik (@berkgedik) | GLB 86.9 MB, 20 × 4K | 53.5k faces (**needs decimation**) | 9: weathered, hand-painted kokoreç cart with grill and goods | 9: a Turkish street-food cart | Adds a hero street vendor (S5) | 20 × 4K textures must be atlased to 1–2K | [vendor-sf-kokorec-berkgedik.jpg](../../../.shots/assets/cafe-street-props/vendor-sf-kokorec-berkgedik.jpg) |

**Recommendation:** approve the **Simit arabası (byrokestudios)**, decimated, as the near LOD for simit carts, **on the
condition that the İBB emblem on the side panel is painted out** before the file enters the repo. A real municipal
emblem must not ship in the repo or read as an endorsement. The "SİMİTÇİ" lettering can stay. The
kokoreç cart is an optional S5 hero prop. **Keep the newspaper kiosk / büfe procedural** (`kiosk`): no free, realistic
Istanbul büfe or newspaper stand exists. The Sketchfab newspaper stands found are US rotating racks (137k–313k faces),
and "Simitçi - Street Vendor Car" (boraozakaltun) is stylised.

## B7. Awnings

No candidate is recommended. **Keep them procedural.** Awnings are already generated per shop (`awning` in
`buildings/details.ts`, width, drop and colour per unit), and a model cannot follow each shopfront's width. Use a CC0
canvas/fabric texture for close range. Checked: "Old Awning" (exiS7-Gs, 120 MB, 6 × 8K), "Shop Awning" (ar.jethin),
"CC0 - Awning" (plaggy, labelled CC-BY).

## B8. Air-conditioner outdoor units

| Name | Source | Licence | Author | Size | Tris / textures | Realism | Kadıköy fit | Replaces / adds | Risks | Preview |
|---|---|---|---|---|---|---|---|---|---|---|
| Exterior Aircon Unit | [Poly Haven](https://polyhaven.com/a/exterior_aircon_unit) | CC0 (PH) | Monsta3D | glTF 1K 7.7 MB | 19k tris for 2 variants, clean and rusted (**needs decimation** to ~1.5k each); up to 4K | 9: beige unit with grille, fan and wall brackets | 8: façade AC units are everywhere; Kadıköy's are mostly white split units | Near LOD of the façade `ac` detail | Many instances, so decimate hard and bake normals | [ac-ph-exterior-aircon-unit.png](../../../.shots/assets/cafe-street-props/ac-ph-exterior-aircon-unit.png) |
| AC Units | [Sketchfab](https://sketchfab.com/3d-models/aa3a54a4a56b4878a8fc7d4e56ab7fc3) | CC-BY 4.0 (SF) | Udon-San (@udonsan) | GLB 39.4 MB, 9 × 2K | 42.5k faces for 3 units ("maybe not good optimized mesh", author) | 8: white split units | 9 | Same | Needs decimation. **"SAHARA" wordmark** on the first unit | [ac-sf-ac-units-udonsan.jpg](../../../.shots/assets/cafe-street-props/ac-sf-ac-units-udonsan.jpg) |
| AC Outdoor Unit - Low Poly | [Sketchfab](https://sketchfab.com/3d-models/314f9f270cbe4920bdb002afa937bcf5) | CC-BY 4.0 (SF) | Samad.Ahmed | GLB 3.3 MB, 4 × 2K | 1k faces | 8: white split unit with copper pipes | 9 | Same, already at budget | **GREE and USAID logos** and several stickers on the side panel must be painted out | [ac-sf-ac-outdoor-lowpoly-samad.jpg](../../../.shots/assets/cafe-street-props/ac-sf-ac-outdoor-lowpoly-samad.jpg) |

**Recommendation:** approve **Exterior Aircon Unit (Poly Haven, CC0)**, decimated and baked, as the near LOD. Keep the
procedural `acGeometry` as the far LOD. If the user prefers white split units with no decimation work, approve the
Samad.Ahmed unit on the condition that the GREE and USAID logos and the stickers are removed from the texture. The
Udon-San units also carry a brand wordmark ("SAHARA").

## B9. Satellite dishes

| Name | Source | Licence | Author | Size | Tris / textures | Realism | Kadıköy fit | Replaces / adds | Risks | Preview |
|---|---|---|---|---|---|---|---|---|---|---|
| Rusty House Satellite Dish | [Sketchfab](https://sketchfab.com/3d-models/929f056abe02416da19d7b1aa805d235) | CC-BY 4.0 (SF) | TomasKiniulis | GLB 11.0 MB, 3 × 2K | 3.2k faces | 8: rusted offset dish on a wall arm | 9: the balcony and rooftop dishes of Istanbul apartments | Near LOD of `dish` | Textures must be cut to 512 | [dish-sf-rusty-satellite-dish.jpg](../../../.shots/assets/cafe-street-props/dish-sf-rusty-satellite-dish.jpg) |

**Recommendation:** approve it as the near LOD, or keep the procedural `dishGeometry` everywhere. This is the only
fitting free model. The other Sketchfab dishes are radar dishes, 1M-face scans or untextured.

## B10. Street signs

No candidate is recommended. **Keep them procedural.** Our text goes on the blue İBB street and mahalle plates, the
poles are simple, and traffic signs are flat decals. "Worn street signs" (nkilstrup) was excluded because its textures
come from Textures.com.

## B11. Manhole covers (decal or material)

| Name | Source | Licence | Author | Size | Maps / resolution | Realism | Kadıköy fit | Replaces / adds | Risks | Preview |
|---|---|---|---|---|---|---|---|---|---|---|
| Manhole Cover 003 | [ambientCG](https://ambientcg.com/a/ManholeCover003) | CC0 (ACG) | ambientCG (no individual author credited) | 1K-JPG zip 6.0 MB (up to 8K) | Height-field photogrammetry decal, 80 × 80 cm: colour, normal, roughness, metalness, AO, displacement, opacity | 9: round cast-iron cover | 8: round covers like İSKİ's; the small rim lettering is not Turkish | Adds sidewalk and road covers as decals (new) | Rim text may be legible at 1 m; unreadable in the 1K preview, so check the full-size colour and height maps for a foundry name before shipping | [manhole-acg-manholecover003.jpg](../../../.shots/assets/cafe-street-props/manhole-acg-manholecover003.jpg) |
| Manhole Cover 011 | [ambientCG](https://ambientcg.com/a/ManholeCover011) | CC0 (ACG) | ambientCG (no individual author credited) | 1K-JPG zip 8.1 MB (up to 8K) | Same maps, 90 × 90 cm | 9: square infill cover with a steel frame | 8: square utility covers on sidewalks | Same | **"ACO Drain"** (a manufacturer's trademark) is cast into the frame next to "EN124 AWK B125": paint it out of the colour, normal and height maps before it enters the repo | [manhole-acg-manholecover011.jpg](../../../.shots/assets/cafe-street-props/manhole-acg-manholecover011.jpg) |
| Water Manhole Cover | [Poly Haven](https://polyhaven.com/a/water_manhole_cover) | CC0 (PH) | Raunox | glTF 1K 2.3 MB | Model, 6.3k tris, Ø 0.69 m, up to 4K | 9 | 3: large English "WATER" lettering | Same | Wrong language | [manhole-ph-water-manhole-cover.png](../../../.shots/assets/cafe-street-props/manhole-ph-water-manhole-cover.png) |

**Recommendation:** approve **ambientCG Manhole Cover 003 and 011** as decals at 1K. **011 is approved only on the
condition that "ACO Drain" is painted out** of its colour, normal and height maps; the "EN124 AWK B125" rating marks
are generic and can stay. Check 003's rim at full resolution for a foundry name. Our own "İSKİ" lettering can be
added later as a normal-map overlay. Skip the Poly Haven cover.

## B12. Found in passing (optional)

| Name | Source | Licence | Author | Size | Tris / textures | Realism | Kadıköy fit | Replaces / adds | Risks | Preview |
|---|---|---|---|---|---|---|---|---|---|---|
| Rollershutter Window 01 (and [Rollershutter Door](https://polyhaven.com/a/rollershutter_door)) | [Poly Haven](https://polyhaven.com/a/rollershutter_window_01) | CC0 (PH) | MP | glTF 1K 2.2 MB | 1.1k tris; up to 8K; clean and graffiti variants | 9 | 10: shop *kepenk* pulled down at night | Adds closed-shop kepenks for night scenes | **Use the clean variant only.** The graffiti variant carries tags and a piece that look like real graffiti; the graffiti artists' rights are not covered by Poly Haven's CC0 | [extra-ph-rollershutter-window-01.png](../../../.shots/assets/cafe-street-props/extra-ph-rollershutter-window-01.png) |
| Utility Box 02 | [Poly Haven](https://polyhaven.com/a/utility_box_02) | CC0 (PH) | James Ray Cock | glTF 1K 2.0 MB | 6.3k tris; up to 8K | 9: green riveted electrical cabinet with warning stickers | 8: sidewalk electricity cabinets | Adds sidewalk clutter | English "DANGER" sticker | [extra-ph-utility-box-02.png](../../../.shots/assets/cafe-street-props/extra-ph-utility-box-02.png) |

---

# Part C: better made procedurally (no approval needed)

| Prop | Generator | Why procedural wins |
|---|---|---|
| Counter / bar, vitrine | new, in the L3 café shell | Must fit each shell; simple boxes in CC0 tile, marble and wood |
| Café tables (square tea-garden tables, marble bistro tops, tablecloths) | new, next to `cafeTable` (`details/props/models.ts`) | Sizes and tops vary; a few hundred triangles each |
| Tea glass, saucer, spoon, tea liquid, coffee cups | new lathe profiles | 200–400 triangles each; the material matters, not the mesh |
| Bare-bulb pendant, wall menu boards | new | Cord + bulb + emissive; flat panels carrying our text |
| LED and sodium street masts, signals | `streets/props.ts` (`lampArm*`, `lampDouble`, `signal`) | Plain poles already matched; per-instance light type and head sprites in `kinds.ts` |
| Bollards (sidewalk and retractable) | `details/props/models.ts` `bollard`, `streets/props.ts` `bollard` | İBB profile via lathe; thousands of instances |
| Pole-mounted litter bins | `details/props/models.ts` `bin` | No Istanbul-style free model |
| Bicycle racks | new tube sweeps | Rare in Kadıköy, trivial geometry |
| Newspaper kiosk / büfe, bus shelters | `kiosk`, `busShelter` | No free realistic Istanbul model |
| Awnings | `buildings/details.ts` `awning` | Per-shop width, drop and colour |
| Street signs and plates | new, with our text | Text is ours; flat plates on poles |
| Far LODs of every approved model (lamps, AC, dishes, benches, carts) | existing generators | Keeps the merged low-draw-call far field |

---

## Summary

| Need | Recommendation | Licence | Why |
|---|---|---|---|
| Sidewalk bistro set | **Outdoor Table Chair Set 01** (Poly Haven) | CC0 | Realistic folding set, 9.8k tris, 1.2 MB |
| Indoor café chair | **Free 3D French Bistro Chair** (DELTAHEDRA) | CC-BY 4.0 | Thonet style of Istanbul cafés and meyhanes; decimate 17k → ~3k |
| Tea-house stool | **Dirty Wicker Stool** (raymondrdorollo) | CC-BY 4.0 | Exact *hasır tabure*, 1.5k faces |
| Tea-garden chair | **Plastic Monobloc Chair 01** (Poly Haven) | CC0 | Ubiquitous, 3.4k tris |
| Counter / bar | **Procedural** | – | Fitted to the shell |
| Espresso machine | **Canarian Cafe - Coffee Machine** (Lanzaman), "IBERICAFE" wordmark removed | CC-BY 4.0 | Realistic two-group machine, 3.3 MB |
| Çaydanlık | **Kettle / Teapot** (Renend Studio) | CC-BY 4.0 | Real double çaydanlık, 4.8k faces, 0.2 MB |
| Semaver / kahvehane boiler | Later: Copper Water Boiler (Dudzy) and Samovar - Semaver (tarkouz) | CC-BY 4.0 | Good fit, but they need atlasing or decimation |
| Tea glass, saucer, cups | **Procedural** (fallback: Caybardag, Esritogan) | – | Lathe profile + glass material |
| Menu board | **Standing Chalkboard 01** (Poly Haven) | CC0 | Blank slate for our text |
| Pendant light | **Modern Ceiling Lamp 01** (Poly Haven) + procedural bare bulb | CC0 | 0.44 MB globe pendant |
| Shelves | **Steel Frame Shelves 01** (Poly Haven) | CC0 | 4.3k tris, café back wall |
| Plants | **Potted Plant 04**, **Planter Pot Clay** (Poly Haven) | CC0 | Small and realistic; pots take our foliage |
| Historic lanterns | **Street Lamp 01 / 02** (Poly Haven), decimated | CC0 | Near LOD for `lampLantern` / `lampWall` |
| Masts, bollards, bike racks, litter bins, kiosks, awnings, signs | **Procedural** | – | See Part C |
| Waste container | **Garbage Container - Game Ready** (Renend Studio) | CC-BY 4.0 | Galvanised four-wheel container, 2.1k faces |
| Bench | **Classic Park Bench** (Berk Gedik) | CC-BY 4.0 | Wood on cast iron, 4.8k faces |
| Simit cart | **Simit arabası** (byrokestudios), decimated, İBB emblem removed | CC-BY 4.0 | Exact Istanbul cart; decimate 312k → ~8k |
| AC unit | **Exterior Aircon Unit** (Poly Haven), decimated | CC0 | Clean and rusted variants, no logos; alternative Samad.Ahmed without its GREE/USAID logos |
| Satellite dish | **Rusty House Satellite Dish** (TomasKiniulis) | CC-BY 4.0 | Only fitting model, 3.2k faces |
| Manhole covers | **ambientCG Manhole Cover 003 + 011**, "ACO Drain" removed from 011 | CC0 | Photogrammetry decals, no English words |

Attribution to record in `public/models/LICENSES.md` for every approved Sketchfab model:
`"<Title>" by <Author> (https://sketchfab.com/3d-models/<uid>), licensed under CC BY 4.0
(http://creativecommons.org/licenses/by/4.0/)`, plus a note of the changes (decimation, texture resize or atlas,
logo removal, new materials). CC0 assets need no attribution, but the source should still be listed.

## Integration cost (for the approval decision)

- **Target layer:** these props are for the S1+ street layer and L3 interiors, which the offline compiler (Node +
  Blender CLI) emits as glTF tiles. Approved models go into the compiler's prop kit: decimated, atlased (one 1K atlas
  per prop family, 512 px for small props), KTX2-compressed and instanced. Nothing changes in the live flight game.
- **Draw calls:** the current details layer draws all its furniture as one merged, vertex-coloured mesh in about
  15 draw calls. Textured models cannot join it, so each approved model adds a material and at least one instanced draw
  per LOD (plus shadows). That is why the procedural versions stay as far LODs.
- **Budgets:**
  - Instanced street props with hundreds in view (lamps, benches, AC units, dishes, bins) should stay at about 1.5–5k
    triangles near and fall back to the procedural far LOD.
  - Café props with a few instances per interior can stay at 5–15k.
  - The S2 web budget is ≤ 150 MB of street data on first visit, so every texture set is cut to 1K.
  - The recommended set is about 20 models. At roughly 1–2 MB per model at 1K, that is about 20–40 MB before KTX2.
- **Night:** the lanterns, the ceiling lamp and the kiosk or cart lamps need an emissive mask and a light record in the
  tile manifest (≥ 32 night lights in the S1 test).
- **Rework per model:**
  - Decimation: Bistro Chair, Street Lamps 01/02, Aircon Unit, Simit arabası; later the Semaver and the Kokoreç cart.
  - Atlasing: Copper Water Boiler (75 textures), Kokoreç cart (20), Classic Park Bench (9).
  - Materials: çaydanlık chrome and the semaver need our own materials. The tea glass is procedural.
  - Logo and emblem removal (before the files enter the repo): Canarian coffee machine ("IBERICAFE"), Simit arabası
    (İBB emblem), Manhole Cover 011 ("ACO Drain"), and the Samad.Ahmed AC unit (GREE, USAID) if chosen. Rollershutter:
    clean variant only.

## Recommendation: approve in this order

1. **CC0 batch for S1 (the strip and the greybox café; no attribution):** Outdoor Table Chair Set 01, Plastic
   Monobloc Chair 01, Standing Chalkboard 01, Modern Ceiling Lamp 01, Steel Frame Shelves 01, Potted Plant 04, Planter
   Pot Clay, Street Lamp 01, Street Lamp 02, Exterior Aircon Unit (Poly Haven); Manhole Cover 003 and 011 (ambientCG),
   with "ACO Drain" painted out of 011.
2. **CC-BY batch for the S4 çay scene:** Kettle / Teapot (çaydanlık, Renend Studio), Dirty Wicker Stool, Free 3D
   French Bistro Chair, Canarian Cafe - Coffee Machine (with its "IBERICAFE" wordmark painted out).
3. **CC-BY street near LODs:** Classic Park Bench (Berk Gedik), Garbage Container (Renend Studio), Rusty House
   Satellite Dish, Simit arabası (byrokestudios, with the İBB emblem painted out).
4. **Later (S5 hero places), optional:** Copper Water Boiler, Samovar - Semaver (tarkouz), Turkish Delight Scene
   (tavla + tea tray), Kokoreç cart, Rollershutter Window/Door (kepenk, clean variant only), Utility Box 02, Round
   Wooden Table 02, Potted Plant 02, Hanging Industrial Lamp, Furniture Pack For Summer Caffe, plastic_stool.
5. **Do not approve:** Chalkboard_sign_V1 (a real restaurant chain's menu is baked in), AC Units by Udon-San ("SAHARA"
   wordmark), Commercial Coffee Machine (unless its "Coffee Master" badge is painted out).

Everything in Part C is built procedurally and needs no approval.

## Approve?

- [x] Batch 1: 10 Poly Haven models + 2 ambientCG manhole decals (all CC0; "ACO Drain" painted out of Manhole Cover 011)
- [x] Batch 2: çaydanlık (Renend Studio), Dirty Wicker Stool, French Bistro Chair (DELTAHEDRA), Canarian coffee machine with "IBERICAFE" painted out (all CC-BY 4.0)
- [x] Batch 3: Classic Park Bench (Berk Gedik), Garbage Container (Renend Studio), Rusty House Satellite Dish (TomasKiniulis), Simit arabası (byrokestudios) with the İBB emblem painted out (all CC-BY 4.0)
- [x] AC unit choice: Poly Haven Exterior Aircon Unit (CC0, decimate), **or** Samad.Ahmed low-poly unit (CC-BY, remove the GREE and USAID logos and the stickers). Chosen: Poly Haven Exterior Aircon Unit.
- [ ] Batch 4 (optional, later): name the items wanted
- [ ] Confirm the procedural list in Part C (counter, tables, tea glass and cups, masts, bollards, bins, bike racks, kiosks, awnings, signs)
