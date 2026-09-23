# Street and façade material candidates (decided)

## Decision (2026-09-24)

The user approved every recommended set (Recommendation steps 1–4 below): **24 texture sets, all CC0 1.0.**

- **Poly Haven (12):** patterned_concrete_pavers, patterned_cobblestone, asphalt_02, granite_tile_04,
  peeling_painted_wall, damaged_plaster, long_white_tiles, painted_metal_shutter, worn_shutter, green_metal_rust,
  wood_peeling_paint_weathered, floor_tiles_02.
- **ambientCG (11):** Road013B, RoadLines004, RoadLines010, Leaking008, Leaking003 (street set); Tiles043, Terrazzo005,
  Tiles133B, Tiles024, PaintedWood009C, Marble019 (façade and interior set).
- **cgbookcase (1):** Galvanized Steel 01 (new source).

Conditions and scope:

- All sets are cached at 2K. The shipping format (KTX2/Basis or trimming, see "Budget" below) is decided in S1/S2.
- Galvanized Steel 01 has DirectX normals: flip the green channel before use.
- The planned replacement of the installed `sidewalk/` and `asphalt/` sets happens when the street compiler integrates
  them. `public/textures/` and `scripts/data/fetch-textures.mjs` stay unchanged until then.
- Not approved: the "Optional later" sets (brick_pavement_03, Road015B, Leaking010C, PaintedWood009B, Marble012,
  Granite002B) and every other alternative in the tables.

Records: manifest [`tools/assets/approved.json`](../../../tools/assets/approved.json), cache record
[approved-assets.md](../approved-assets.md). Galvanized Steel 01 has no direct download link, so it is listed in
[manual-downloads.md](../manual-downloads.md).

---

Status before the decision: shortlist only. Everything below was checked on the live sites and APIs on 2026-09-24 and
is kept unchanged as the record of the review.

## How this list was built

- **Licence rule** (CLAUDE.md, "External assets"): free assets only, CC0 preferred. Every candidate here is CC0 1.0,
  so no attribution is required and redistribution in the public MIT repo is allowed. Source and ID are still recorded
  in `public/textures/LICENSES.md` on integration. Licence lines as quoted on the live pages:
  - **Poly Haven:** "Our assets are all licensed as CC0, which is effectively Public Domain"
    ([polyhaven.com/license](https://polyhaven.com/license)).
  - **ambientCG:** "All ambientCG assets are provided under the Creative Commons CC0 1.0 Universal License."
    ([docs.ambientcg.com/license](https://docs.ambientcg.com/license/)). Each asset page repeats the CC0 line.
  - **cgbookcase:** "The textures are published under the CC0 1.0 license"
    ([cgbookcase.com/textures](https://www.cgbookcase.com/textures)).
  - **TextureCan:** "…offered by TextureCan.com are under the Creative Commons CC0 1.0 Universe License."
    ([texturecan.com/terms](https://www.texturecan.com/terms/)).
  - CC0 1.0 deed: <https://creativecommons.org/publicdomain/zero/1.0/>.
- **Sources searched:** the Poly Haven API (`api.polyhaven.com/assets?t=textures`, 862 textures) and the ambientCG
  API v2 (`full_json?type=Material,Decal,Atlas`, 2,199 assets). Only ambientCG assets whose public `releaseDate` is on
  or before 2026-09-24 are listed, so nothing is early-access only. For the galvanised and kerb gaps, cgbookcase,
  TextureCan, ShareTextures and 3dtextures.me were also checked. Poliigon, textures.com, Architextures
  (personal/educational use only), metroscans and exorbitart were skipped because they are paid or not CC0.
- **What "approved" covers:** CLAUDE.md approves only the 11 Poly Haven sets already listed in
  `public/textures/LICENSES.md`. The Poly Haven IDs in §1 come from the same source under the same licence, but each
  one still needs your tick in the checklist below.
- **Author:** Poly Haven authors come from the API. ambientCG is made by Lennart Demes (Struffel Productions). The
  asset pages name no other author.
- **Resolution and formats:** every candidate is ≥ 2K, and most go up to 8K. The current sets were fetched at 1K, but
  eye-level street use needs 2K. Poly Haven offers JPG/PNG/EXR maps from 1K to 8K or 16K, plus `.blend`, glTF and
  MaterialX. ambientCG offers JPG/PNG zips from 1K to 8K with Color, **NormalGL** + NormalDX, Roughness and Displacement,
  plus AO, Opacity or Metalness where listed. Poly Haven `nor_gl` and ambientCG `NormalGL` use the OpenGL convention
  (three.js/Godot). cgbookcase ships only DirectX normals, whose green channel would have to be flipped.
- **Sizes:** Poly Haven sizes are the three 2K JPG maps we would ship (Diffuse, `nor_gl`, Rough), read from
  `api.polyhaven.com/files/<id>`. ambientCG sizes are the `2K-JPG` zip size from the API. Those zips also contain
  displacement, AO and a DirectX normal, so the part we ship is roughly a third to half of the zip. **Repeat** is the
  real-world size of one texture tile as published. "n/s" means it is not stated, so the scale is set by UV from the
  stone or tile size.
- **Budget:** the recommended set comes to about 160 MB as plain 2K JPG. The plan's web limit is 150 MB for *all*
  street data on first visit, so these textures must ship as KTX2/Basis or be trimmed. That decision belongs to S1/S2.
- **Previews:** each preview is the source's own thumbnail, saved under `.shots/assets/street-materials/`: `ph-*`
  (Poly Haven, 256 px), `acg-*` (ambientCG, 256 px) and `cgb-*` / `tc-*` (cgbookcase / TextureCan, downscaled to
  300 px). Nothing has been rendered in our engine yet. Polygon count, rig and animation do not apply to textures.

---

## 1. Coverage map: what Poly Haven already covers

"Installed" means the set is already in `public/textures/` (at 1K).

| Need | Poly Haven covers? | Poly Haven IDs (repeat · author · 2K size) | Kadıköy fit | Gap → |
|---|---|---|---|---|
| Interlocking concrete pavers (*kilit taşı*) | **Yes** | [patterned_concrete_pavers](https://polyhaven.com/a/patterned_concrete_pavers) (1.8 m · Amal Kumar · 8.3 MB) · [brick_pavement_03](https://polyhaven.com/a/brick_pavement_03) (2.5 m · Charlotte Baglioni · 8.0 MB) | Grey wavy (Z-type) pavers in herringbone, and grey double-T (*kemik*) pavers: the two common sidewalk kilit taşı types. The installed `sidewalk/` set ([pavement_03](https://polyhaven.com/a/pavement_03)) is a brown clay brick, not a kilit taşı, so **replace it**. Previews: [ph-patterned_concrete_pavers](../../../.shots/assets/street-materials/ph-patterned_concrete_pavers.jpg), [ph-brick_pavement_03](../../../.shots/assets/street-materials/ph-brick_pavement_03.jpg) | — |
| Granite/basalt cubes (*bazalt küp taş*) and *Arnavut kaldırımı* | **Yes** | [patterned_cobblestone](https://polyhaven.com/a/patterned_cobblestone) (2.5 m · Rob Tuytel · 10.5 MB) · [floor_pattern_02](https://polyhaven.com/a/floor_pattern_02) (1.2 m · Rob Tuytel · 10.9 MB) · [cobblestone_floor_04](https://polyhaven.com/a/cobblestone_floor_04) (installed `cobble/`) | patterned_cobblestone has small grey cubes laid in fan-shaped arcs, which is the municipal 10 × 10 cm basalt cube paving ([unit-price item 15.435.7003](https://www.birimfiyat.net/15.435.7003-dogal-bazalt-parke-tasi-10-10-cm-ile-doseme-kaplamasi-yapilmasi-yol-meydan-park-kaldirim-ve-benzeri-yerlerde)). Keep cobblestone_floor_04 (rough irregular setts) for Arnavut kaldırımı. Previews: [ph-patterned_cobblestone](../../../.shots/assets/street-materials/ph-patterned_cobblestone.jpg), [ph-floor_pattern_02](../../../.shots/assets/street-materials/ph-floor_pattern_02.jpg) | — |
| Granite kerbstones | Partly | [granite_tile_04](https://polyhaven.com/a/granite_tile_04) (2 m · Amal Kumar · 10.3 MB) | Rough, weathered brown-grey granite with recessed joints, cut along the joints for kerb blocks. Precast concrete kerbs can use the installed `concrete/`. Preview: [ph-granite_tile_04](../../../.shots/assets/street-materials/ph-granite_tile_04.jpg) | §I (jointless) |
| Worn asphalt with patches | Partly | [asphalt_02](https://polyhaven.com/a/asphalt_02) (3 m · Rob Tuytel · 10.3 MB) | Grey asphalt with tar-sealed cracks, a better base than the brownish installed `asphalt_01`. [worn_asphalt](https://polyhaven.com/a/worn_asphalt) was dropped because it has leaves and twigs baked in. **No repair patches.** Preview: [ph-asphalt_02](../../../.shots/assets/street-materials/ph-asphalt_02.jpg) | §A |
| Painted road markings, worn | **No** (Poly Haven publishes no decals) | — | — | §B |
| Cement plaster/render, pastel | **Yes** | installed `plaster/` ([plastered_wall](https://polyhaven.com/a/plastered_wall)) and `plaster_painted/` ([painted_plaster_wall](https://polyhaven.com/a/painted_plaster_wall)) · [beige_wall_001](https://polyhaven.com/a/beige_wall_001) (3 m · Dimitrios Savva, Rico Cilliers · 1.7 MB) · [blue_plaster_wall](https://polyhaven.com/a/blue_plaster_wall), [yellow_plaster](https://polyhaven.com/a/yellow_plaster) | Neutral renders tinted to pastel by the façade compiler cover all colours. The pre-coloured blue and yellow sets are extras. Preview: [ph-beige_wall_001](../../../.shots/assets/street-materials/ph-beige_wall_001.jpg) | — |
| Weathered paint | **Yes** | [peeling_painted_wall](https://polyhaven.com/a/peeling_painted_wall) (1.8 m · Dimitrios Savva · 6.3 MB) · [damaged_plaster](https://polyhaven.com/a/damaged_plaster) (1.85 m · Amal Kumar · 8.7 MB) · [blue_plaster_weathered](https://polyhaven.com/a/blue_plaster_weathered) · [red_plaster_weathered](https://polyhaven.com/a/red_plaster_weathered) | damaged_plaster shows render falling off brick, which is very typical of neglected Istanbul façades. Previews: [ph-peeling_painted_wall](../../../.shots/assets/street-materials/ph-peeling_painted_wall.jpg), [ph-damaged_plaster](../../../.shots/assets/street-materials/ph-damaged_plaster.jpg) | — |
| Terrazzo (*mozaik*) floors and stair treads | Weak | [old_mosaic_floor](https://polyhaven.com/a/old_mosaic_floor) (2 m · Amal Kumar · 8.3 MB) | Only a murky, weathered in-situ floor. [terrazzo_tiles](https://polyhaven.com/a/terrazzo_tiles) is brown and polished, not the grey/white mozaik. Preview: [ph-old_mosaic_floor](../../../.shots/assets/street-materials/ph-old_mosaic_floor.jpg) | §D |
| Ceramic tiles for shopfronts | Partly | [long_white_tiles](https://polyhaven.com/a/long_white_tiles) (1.27 m · Jenelle van Heerden, Sergej Majboroda · 7.0 MB) · [rounded_square_tiled_wall](https://polyhaven.com/a/rounded_square_tiled_wall) (beige small mosaic) | Scuffed white rectangular tiles are fine. There are no square white glazed tiles and no coloured small mosaic. Preview: [ph-long_white_tiles](../../../.shots/assets/street-materials/ph-long_white_tiles.jpg) | §E |
| Metal roller shutters (*kepenk*) | **Yes** | [painted_metal_shutter](https://polyhaven.com/a/painted_metal_shutter) (2 m · Dario Barresi, Rico Cilliers, Charlotte Baglioni · 7.9 MB) · [worn_shutter](https://polyhaven.com/a/worn_shutter) (1.37 m · Dimitrios Savva · 6.0 MB) · [rusty_metal_shutter](https://polyhaven.com/a/rusty_metal_shutter) | Grey painted slats read like galvanised kepenk. worn_shutter is the dark variant. Previews: [ph-painted_metal_shutter](../../../.shots/assets/street-materials/ph-painted_metal_shutter.jpg), [ph-worn_shutter](../../../.shots/assets/street-materials/ph-worn_shutter.jpg) | — |
| Galvanised railings | **No** | only [corrugated_iron_03](https://polyhaven.com/a/corrugated_iron_03) (a corrugated profile, wrong for tubes). Painted railings are covered by [green_metal_rust](https://polyhaven.com/a/green_metal_rust) (1 m · Rob Tuytel · 1.8 MB) | Painted balcony railings are covered. Bare galvanised pipe is not. Preview: [ph-green_metal_rust](../../../.shots/assets/street-materials/ph-green_metal_rust.jpg) | §F |
| Old wood doors and window frames | Partly | [wood_peeling_paint_weathered](https://polyhaven.com/a/wood_peeling_paint_weathered) (0.76 m · Rob Tuytel, Dimitrios Savva · 8.4 MB) · [distressed_painted_planks](https://polyhaven.com/a/distressed_painted_planks) · [fine_grained_wood](https://polyhaven.com/a/fine_grained_wood) (varnished door) | Plank sets cover door leaves and wooden shutters. There is no plank-free painted wood for thin frames and sashes. Preview: [ph-wood_peeling_paint_weathered](../../../.shots/assets/street-materials/ph-wood_peeling_paint_weathered.jpg) | §G |
| Marble | Partly | [floor_tiles_02](https://polyhaven.com/a/floor_tiles_02) (4 m · Rob Tuytel · 3.1 MB) · [floor_tiles_06](https://polyhaven.com/a/floor_tiles_06) (checkered) | Worn tiled marble floors for entrances are covered. There is no jointless white Marmara-type slab for treads, thresholds and sills. Preview: [ph-floor_tiles_02](../../../.shots/assets/street-materials/ph-floor_tiles_02.jpg) | §H |
| Grime and leak decals | **No** | — | — | §C |

---

## 2. Shortlists for the gaps

### A. Patched asphalt (repair patches)

| Candidate | Licence | Author | 2K size | Max res · repeat · maps | Kadıköy fit | Adds / replaces | Risks | Preview |
|---|---|---|---|---|---|---|---|---|
| [Road013B](https://ambientcg.com/view?id=Road013B) | CC0 1.0 ([ambientCG](https://docs.ambientcg.com/license/)) | Lennart Demes (ambientCG) | 32.3 MB zip | 8K · n/s · Color, Normal GL/DX, Rough, Disp, AO. Procedural, released 2026-03-10 | Grey asphalt with darker rectangular trench patches and fine cracks, and **no painted lines**: the look of side streets after utility digs | Adds a patched variant to asphalt_02. Markings go on top as decals (§B) | Procedural, not scanned, so it may read as CG next to scanned kerbs. The patch layout repeats every tile, so rotate it or mix in Road015B. Real size is not stated: tune it so patches are about 0.6–1.5 m wide | [acg-Road013B](../../../.shots/assets/street-materials/acg-Road013B.jpg) |
| [Road015B](https://ambientcg.com/view?id=Road015B) | CC0 1.0 ([ambientCG](https://docs.ambientcg.com/license/)) | Lennart Demes | 31.3 MB zip | 8K · n/s · same maps. Released 2026-03-10 | Same family with more cracks and lighter patches | Second variant to break repetition | Same as Road013B | [acg-Road015B](../../../.shots/assets/street-materials/acg-Road015B.jpg) |
| [Road004](https://ambientcg.com/view?id=Road004) | CC0 1.0 ([ambientCG](https://docs.ambientcg.com/license/)) | Lennart Demes | 30.1 MB zip | 8K · 7.5 × 7.5 m · Color, Normal GL/DX, Rough, Disp. Released 2019-12-05 | Dense small patches with **white** centre dashes and edge lines baked in (Turkish markings are white) | Would replace asphalt and markings together | The baked lane layout forces one UV strip per road and a fixed lane width. The patchwork is busy | [acg-Road004](../../../.shots/assets/street-materials/acg-Road004.jpg) |

**Pick:** Road013B, with Road015B as a variation set. Skip Road004.

### B. Painted road markings, worn

| Candidate | Licence | Author | 2K size | Max res · repeat · maps | Kadıköy fit | Adds / replaces | Risks | Preview |
|---|---|---|---|---|---|---|---|---|
| [RoadLines004](https://ambientcg.com/view?id=RoadLines004) (decal) | CC0 1.0 ([ambientCG](https://docs.ambientcg.com/license/)) | Lennart Demes | 4.5 MB zip | 8K · n/s · Color, Normal GL/DX, Rough, Disp, **Opacity**, AO. Released 2018-05-31 | Wide white bands with flaking, worn paint and transparency between them: zebra crossings (*yaya geçidi*) and stop lines | Adds crossings and stop lines | Needs a decal path: an alpha-blended overlay strip 1–2 cm above the road, or projected decals (Godot has a native `Decal`). Stripe width and spacing come from the texture, so set them per crossing by UV | [acg-RoadLines004](../../../.shots/assets/street-materials/acg-RoadLines004.jpg) |
| [RoadLines010](https://ambientcg.com/view?id=RoadLines010) (decal) | CC0 1.0 ([ambientCG](https://docs.ambientcg.com/license/)) | Lennart Demes | 3.8 MB zip | 8K · n/s · Color, Normal GL/DX, Rough, Disp, Opacity. Released 2019-04-03 | A set of thin white dashed and continuous lane lines on transparency, for the lane and edge lines of the main roads (Rıhtım Cd, Söğütlüçeşme Cd) | Adds lane and edge lines | Paint looks fairly fresh. Dash lengths and widths are fixed: check them against the Turkish road-marking standard before use | [acg-RoadLines010](../../../.shots/assets/street-materials/acg-RoadLines010.jpg) |
| [RoadLines002](https://ambientcg.com/view?id=RoadLines002) (decal) | CC0 1.0 ([ambientCG](https://docs.ambientcg.com/license/)) | Lennart Demes | 2.6 MB zip | 8K · 3.95 × 0.30 m (per API) · Color, Normal GL/DX, Rough, Disp, Opacity. Released 2018-01-17 | A single white band with heavy cracking, for old crossings | Alternative stripe for very worn crossings | The cracking is heavy. Asphalt is baked into the gaps, and only the opacity map removes it | [acg-RoadLines002](../../../.shots/assets/street-materials/acg-RoadLines002.jpg) |

**Pick:** RoadLines004 and RoadLines010. RoadLines019–035 (released 2026) were dropped because they use **yellow** paint
and some contain English words ("BUS", "SLOW", "TAXI LANE"). Road008–011A were dropped for their baked yellow centre
lines.

### C. Grime and leak decals

| Candidate | Licence | Author | 2K size | Max res · repeat · maps | Kadıköy fit | Adds / replaces | Risks | Preview |
|---|---|---|---|---|---|---|---|---|
| [Leaking008](https://ambientcg.com/view?id=Leaking008) (decal) | CC0 1.0 ([ambientCG](https://docs.ambientcg.com/license/)) | Lennart Demes | 4.7 MB zip | 8K · n/s · Color, Normal GL/DX, Rough, Disp, Opacity. Released 2022-01-23 | A dark band of rising splash grime along the foot of a wall, as on street façades and shopfront risers | Adds grime to every façade plinth (tiled horizontally) | The horizontal tiling seam must be hidden. Needs a decal pass or a second UV set for a detail blend | [acg-Leaking008](../../../.shots/assets/street-materials/acg-Leaking008.jpg) |
| [Leaking003](https://ambientcg.com/view?id=Leaking003) (decal) | CC0 1.0 ([ambientCG](https://docs.ambientcg.com/license/)) | Lennart Demes | 12.0 MB zip | 8K · n/s · Color, Normal GL/DX, Rough, Disp, Opacity. Released 2018-06-13 | Rain streaks running down from a top edge: under cornices, balcony slabs (*çıkma*) and window sills of 1950–70s apartments | Adds streaks under every horizontal ledge | The green algae tint should be desaturated to sooty grey. Larger file | [acg-Leaking003](../../../.shots/assets/street-materials/acg-Leaking003.jpg) |
| [Leaking010C](https://ambientcg.com/view?id=Leaking010C) (decal) | CC0 1.0 ([ambientCG](https://docs.ambientcg.com/license/)) | Lennart Demes | 18.3 MB zip (1K: 5.0 MB) | 8K · n/s · Color, Normal GL/DX, Rough, Disp, Opacity, AO. Released 2023-05-23 | A single long drip streak under an AC unit, balcony drain or downpipe | Adds point streaks at AC and drain slots from the manifest | Most of the texture is empty, so 1K is enough | [acg-Leaking010C](../../../.shots/assets/street-materials/acg-Leaking010C.jpg) |

**Pick:** Leaking008 and Leaking003. Leaking010C is optional, at 1K.

### D. Terrazzo (*mozaik*) floors and stair treads

| Candidate | Licence | Author | 2K size | Max res · repeat · maps | Kadıköy fit | Adds / replaces | Risks | Preview |
|---|---|---|---|---|---|---|---|---|
| [Tiles043](https://ambientcg.com/view?id=Tiles043) | CC0 1.0 ([ambientCG](https://docs.ambientcg.com/license/)) | Lennart Demes | 19.1 MB zip | 8K · n/s · Color, Normal GL/DX, Rough, Disp. Released 2019-06-08 | White terrazzo tiles with grey and black chips and thin joints: precast *mozaik karo* in apartment entrances, landings and shop floors | Adds floors for the stairwell and shop interior shells (L3) | Clean and new, so it needs a dirt/AO layer. Tile size is not stated: set the UV so tiles read 30–40 cm | [acg-Tiles043](../../../.shots/assets/street-materials/acg-Tiles043.jpg) |
| [Terrazzo005](https://ambientcg.com/view?id=Terrazzo005) | CC0 1.0 ([ambientCG](https://docs.ambientcg.com/license/)) | Lennart Demes | 22.3 MB zip | 8K · n/s · Color, Normal GL/DX, Rough, Disp. Released 2019-05-16 | Jointless white terrazzo with grey and black chips, for cast-in-place mozaik stair flights, treads and landings | Adds stair and landing material | Glossy, so raise the roughness. The chips are larger than the fine aggregate of many old floors | [acg-Terrazzo005](../../../.shots/assets/street-materials/acg-Terrazzo005.jpg) |
| [Tiles110](https://ambientcg.com/view?id=Tiles110) | CC0 1.0 ([ambientCG](https://docs.ambientcg.com/license/)) | Lennart Demes | 16.6 MB zip | 8K · 1.85 × 1.85 m · Color, Normal GL/DX, Rough, Disp, AO. Released 2021-12-19 | Beige and ochre terrazzo tiles: warm-toned mozaik karo for older entrances and balconies | Colour variant for entrances | Clean. The beige can read as modern travertine | [acg-Tiles110](../../../.shots/assets/street-materials/acg-Tiles110.jpg) |

**Pick:** Tiles043 for tiled floors and Terrazzo005 for stairs and treads. Poly Haven old_mosaic_floor remains the
worn fallback.

### E. Ceramic tiles for shopfronts

| Candidate | Licence | Author | 2K size | Max res · repeat · maps | Kadıköy fit | Adds / replaces | Risks | Preview |
|---|---|---|---|---|---|---|---|---|
| [Tiles133B](https://ambientcg.com/view?id=Tiles133B) | CC0 1.0 ([ambientCG](https://docs.ambientcg.com/license/)) | Lennart Demes | 14.6 MB zip | 8K · n/s · Color, Normal GL/DX, Rough, Disp, AO. Released 2024-07-01 | Square white glazed tiles with dirty grout and a few cracks: walls and counters of the fishmongers, butchers and *muhallebici* in the çarşı | Adds shop interior and stall walls | Tile size is not stated (UV about 15 cm). Glossy tiles need good local reflections | [acg-Tiles133B](../../../.shots/assets/street-materials/acg-Tiles133B.jpg) |
| [Tiles024](https://ambientcg.com/view?id=Tiles024) | CC0 1.0 ([ambientCG](https://docs.ambientcg.com/license/)) | Lennart Demes | 19.8 MB zip | 8K · n/s · Color, Normal GL/DX, Rough, Disp. Released 2018-08-23 | Small dark-green glossy mosaic, as on 1960–70s shop pilasters, stall risers and entrance soffits | Adds shopfront pilasters and risers | Clean, uniform colour. Needs grime (§C) | [acg-Tiles024](../../../.shots/assets/street-materials/acg-Tiles024.jpg) |
| [Tiles019](https://ambientcg.com/view?id=Tiles019) | CC0 1.0 ([ambientCG](https://docs.ambientcg.com/license/)) | Lennart Demes | 22.1 MB zip | **4K max** · n/s · Color, Normal GL/DX, Rough, Disp, AO. Photo-based ("approximated" PBR), captured on Juist, released 2018-07-07 | Irregular blue and turquoise small mosaic, for colourful pilasters | Colour variant | The hand-set, irregular look can read as a pool or art mosaic | [acg-Tiles019](../../../.shots/assets/street-materials/acg-Tiles019.jpg) |

**Pick:** Tiles133B and Tiles024. Poly Haven long_white_tiles covers the rectangular white tiles.

### F. Galvanised steel (railings, handrails, gutters, rooftop water tanks)

| Candidate | Licence | Author | 2K size | Max res · repeat · maps | Kadıköy fit | Adds / replaces | Risks | Preview |
|---|---|---|---|---|---|---|---|---|
| [Galvanized Steel 01](https://www.cgbookcase.com/textures/galvanized-steel-01) (cgbookcase) | CC0 1.0 ([cgbookcase](https://www.cgbookcase.com/textures)) | cgbookcase (Dorian Zgraggen) | not shown on the page (the download goes through a thank-you page) | 4K · n/s · Base Color, **Normal (DirectX)**, Roughness, Height, AO | Fine spangle and dull grey: weathered hot-dip galvanised pipe railings, stair handrails, gutters, downpipes and rooftop water tanks | Adds the railing and pipe metal | DirectX normal, so the compiler must flip green. Adds a new source to LICENSES.md. Size is known only after download | [cgb-GalvanizedSteel01](../../../.shots/assets/street-materials/cgb-GalvanizedSteel01.jpg) |
| [Galvanized Metal Sheet (metal_0010)](https://www.texturecan.com/details/67/) (TextureCan) | CC0 1.0 ([TextureCan](https://www.texturecan.com/terms/)) | TextureCan.com (no person named) | 51.6 MB zip (HTTP HEAD) | 4K (+ SBSAR) · n/s · Base Color, Normal, Roughness, Displacement, Metallic, AO | Large, bright crystal spangle: newer galvanised sheet such as water tanks, flashing and kepenk housings | Newer-metal variant | The spangle is large and contrasty for old railings. The 2K zip is heavy. The normal convention is not stated | [tc-metal_0010](../../../.shots/assets/street-materials/tc-metal_0010.jpg) |
| [Metal014](https://ambientcg.com/view?id=Metal014) (ambientCG) | CC0 1.0 ([ambientCG](https://docs.ambientcg.com/license/)) | Lennart Demes | 26.4 MB zip | 8K · n/s · Color, Normal GL/DX, Rough, Disp, **Metalness**. Procedural, released 2018-11-18 | Pale steel with blotchy light oxidation, close to aged zinc ("white rust") from a distance | Same role, and keeps the source count down | Not tagged galvanised. The blotches look bluish, like painted aluminium up close | [acg-Metal014](../../../.shots/assets/street-materials/acg-Metal014.jpg) |

**Pick:** cgbookcase Galvanized Steel 01. 3dtextures.me "Metal Grill 026" (CC0, galvanised) was dropped because its
free download is only 1K.

### G. Painted wood for window frames, sashes and doors

| Candidate | Licence | Author | 2K size | Max res · repeat · maps | Kadıköy fit | Adds / replaces | Risks | Preview |
|---|---|---|---|---|---|---|---|---|
| [PaintedWood009C](https://ambientcg.com/view?id=PaintedWood009C) | CC0 1.0 ([ambientCG](https://docs.ambientcg.com/license/)) | Lennart Demes | 28.0 MB zip | 8K · n/s · Color, Normal GL/DX, Rough, Disp, AO. Released 2023-06-14 | Off-white paint with grain cracks: original white-painted wooden window frames, sashes and çıkma casings of 1950–70s apartments | Adds frames and sashes (the plank sets stay for door leaves) | The grain runs one way, so rotate it per frame member. Procedural | [acg-PaintedWood009C](../../../.shots/assets/street-materials/acg-PaintedWood009C.jpg) |
| [PaintedWood006C](https://ambientcg.com/view?id=PaintedWood006C) | CC0 1.0 ([ambientCG](https://docs.ambientcg.com/license/)) | Lennart Demes | 27.5 MB zip | 8K · n/s · same maps. Released 2023-06-14 | Clean cream/beige paint for cream frames and entrance doors | Colour variant | Little wear, so it can look new | [acg-PaintedWood006C](../../../.shots/assets/street-materials/acg-PaintedWood006C.jpg) |
| [PaintedWood009B](https://ambientcg.com/view?id=PaintedWood009B) | CC0 1.0 ([ambientCG](https://docs.ambientcg.com/license/)) | Lennart Demes | 28.1 MB zip | 8K · n/s · same maps. Released 2023-06-14 | Green paint scratched down to the wood, for old shutters, shop doors and kiosk panels | Accent variant | Saturated green. Heavy wear | [acg-PaintedWood009B](../../../.shots/assets/street-materials/acg-PaintedWood009B.jpg) |

**Pick:** PaintedWood009C, with PaintedWood009B for accents.

### H. White marble (treads, thresholds, sills, counters)

| Candidate | Licence | Author | 2K size | Max res · repeat · maps | Kadıköy fit | Adds / replaces | Risks | Preview |
|---|---|---|---|---|---|---|---|---|
| [Marble019](https://ambientcg.com/view?id=Marble019) | CC0 1.0 ([ambientCG](https://docs.ambientcg.com/license/)) | Lennart Demes | 11.3 MB zip | 8K · n/s · Color, Normal GL/DX, Rough, Disp. Released 2021-06-20 | Honed (rough) bright white with fine grey veins: the matte, foot-worn Marmara-type white marble of stair treads, thresholds, door steps and shop sills | Adds treads and sills | Clean, with no edge wear | [acg-Marble019](../../../.shots/assets/street-materials/acg-Marble019.jpg) |
| [Marble012](https://ambientcg.com/view?id=Marble012) | CC0 1.0 ([ambientCG](https://docs.ambientcg.com/license/)) | Lennart Demes | 14.8 MB zip | 8K · n/s · same maps. Released 2020-01-26 | Polished white with grey veining, for entrance wall cladding, café tables and shop counters | Polished variant for interiors | Strong reflections, so raise the roughness outdoors | [acg-Marble012](../../../.shots/assets/street-materials/acg-Marble012.jpg) |
| [Marble003](https://ambientcg.com/view?id=Marble003) | CC0 1.0 ([ambientCG](https://docs.ambientcg.com/license/)) | Lennart Demes | 21.3 MB zip | 8K · n/s · same maps. Released 2018-06-21 | Cloudy grey-white marble for landings | Alternative to Marble012 | Bluish tint. Glossy | [acg-Marble003](../../../.shots/assets/street-materials/acg-Marble003.jpg) |

**Pick:** Marble019, with Marble012 for polished interiors. Poly Haven floor_tiles_02 covers tiled marble floors.

### I. Granite kerb, jointless

| Candidate | Licence | Author | 2K size | Max res · repeat · maps | Kadıköy fit | Adds / replaces | Risks | Preview |
|---|---|---|---|---|---|---|---|---|
| [granite_tile_04](https://polyhaven.com/a/granite_tile_04) (Poly Haven) | CC0 1.0 ([Poly Haven](https://polyhaven.com/license)) | Amal Kumar | 10.3 MB | 8K · 2 m · Diffuse, nor_gl, Rough (+ AO, Disp) | Rough, weathered granite. Its joints can double as kerb-block joints | Kerb faces and tops | Brown-grey rather than cool grey, so tint it | [ph-granite_tile_04](../../../.shots/assets/street-materials/ph-granite_tile_04.jpg) |
| [Granite002B](https://ambientcg.com/view?id=Granite002B) | CC0 1.0 ([ambientCG](https://docs.ambientcg.com/license/)) | Lennart Demes | 25.5 MB zip | 8K · n/s · Color, Normal GL/DX, Rough, Disp. Procedural (from GraniteSubstance001), released 2022-12-29 | Light grey granite with black speckle and no joints, for the grey granite kerbs and slab edges of renovated streets | Jointless kerb blocks | Tagged "countertop", so raise the roughness and add dirt. Very clean | [acg-Granite002B](../../../.shots/assets/street-materials/acg-Granite002B.jpg) |

**Pick:** granite_tile_04 first, since it adds no new source. Use Granite002B only if the joints look wrong on kerbs.
No CC0 scan made specifically for kerbs exists: the kerb scans found (metroscans, exorbitart, Architextures) are paid
or not CC0.

**Noticed, not shortlisted (outside this brief):** ambientCG
[TactilePaving003](https://ambientcg.com/view?id=TactilePaving003) is yellow tactile warning paving, CC0, 1.2 m repeat.
Kadıköy crossings have yellow tactile strips, so it is worth a later look.

---

## Licence re-check (2026-09-24)

A second pass opened each primary licence source again and looked for reasons a file could not ship in the public MIT
repo. **Nothing blocks any candidate. All 27 are CC0 1.0 with no per-asset exception.**

- **ambientCG (23 IDs):**
  - The licence page says "All ambientCG assets are provided under the Creative Commons CC0 1.0 Universal License",
    that this "applies to the downloadable asset files and the material preview renders", and "You can include the raw
    files in your project, for example a video game."
  - The API v2 returns all 23 IDs. Each `releaseDate` is 2026-08-14 or earlier, so none is still Patreon early access.
  - `createdUsing` and `basedOnThis` are empty for every ID, so no third-party source is declared.
  - RoadLines002/004 and Tiles019 are photo-based ("PBRApproximated"); the rest are procedural.
  - No asset carries text or logos: the markings are plain white paint.
- **Poly Haven (granite_tile_04 and the §1 IDs):**
  - The licence page says "Our assets are all licensed as CC0, which is effectively Public Domain even in
    jurisdictions that do not support the Public Domain" and "You can redistribute them".
  - The API returns every ID with the authors listed above.
  - Poly Haven's Terms of Service §4.1 exclude "Asset example renders" from CC0. The `ph-*` previews are therefore
    for local review only. `.shots/` is in `.gitignore`: keep it that way.
- **cgbookcase Galvanized Steel 01:** the CC0 line ("The textures are published under the CC0 1.0 license, which means
  … you can use them for free without giving credit") appears only in the sidebar of the `/textures` listing, linking
  the CC0 deed. The asset page shows no licence or author line. That is acceptable for a site-wide CC0 source, but
  record the listing URL as the licence source.
- **TextureCan metal_0010:** the terms say the textures "are under the Creative Commons CC0 1.0 Universe License" and
  "are allowed to be redistributed togehter with your projects and 3D assets". They also make the user responsible for
  any "brand names, logos and copyrighted graphics" in a texture; metal_0010 has none. The terms page refuses plain
  curl (HTTP 406), so it was read with a web-fetch tool instead.

## Recommendation

Approve in this order. Each step is usable on its own.

1. **Poly Haven additions** (same source and licence as the approved sets):
   - Replace `sidewalk/` with patterned_concrete_pavers.
   - Replace `asphalt/` with asphalt_02.
   - Add patterned_cobblestone for küp taş, keeping cobblestone_floor_04 for Arnavut kaldırımı.
   - Add granite_tile_04 (kerbs), peeling_painted_wall, damaged_plaster, painted_metal_shutter, worn_shutter,
     long_white_tiles, green_metal_rust, wood_peeling_paint_weathered and floor_tiles_02.

   These cover pavers, cobbles, kerbs, render, weathered paint, kepenk, painted railings and plank doors at 2K with no
   new source.
2. **ambientCG street set:** Road013B, RoadLines004, RoadLines010, Leaking008 and Leaking003. These are the eye-level
   gaps: patched asphalt, worn markings and façade grime.
3. **ambientCG façade and interior set:** Tiles043, Terrazzo005, Tiles133B, Tiles024, PaintedWood009C and Marble019.
4. **cgbookcase Galvanized Steel 01.** This is the only new source.

Optional later: brick_pavement_03, Road015B, Leaking010C, PaintedWood009B, Marble012, Granite002B.

## Approve?

- [x] Step 1: Poly Haven patterned_concrete_pavers, asphalt_02, patterned_cobblestone, granite_tile_04,
      peeling_painted_wall, damaged_plaster, painted_metal_shutter, worn_shutter, long_white_tiles, green_metal_rust,
      wood_peeling_paint_weathered, floor_tiles_02
- [x] Step 2: ambientCG Road013B, RoadLines004, RoadLines010, Leaking008, Leaking003
- [x] Step 3: ambientCG Tiles043, Terrazzo005, Tiles133B, Tiles024, PaintedWood009C, Marble019
- [x] Step 4: cgbookcase Galvanized Steel 01 (new source, DirectX normal)
- [ ] Optional: brick_pavement_03, Road015B, Leaking010C, PaintedWood009B, Marble012, Granite002B
