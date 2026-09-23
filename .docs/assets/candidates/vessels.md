# Vessel model candidates (pending approval)

Status: **shortlist only, nothing is approved.** No model has been downloaded, added to `public/` or referenced in
code. The procedural vessels stay in place until the user approves a candidate.

## How this list was built

- **Licence rule** (CLAUDE.md, "External assets"): free assets only. CC0 is preferred. CC-BY 4.0 is allowed if the
  attribution is recorded in `public/models/LICENSES.md` on integration. CC-BY-SA, CC-BY-NC, CC-BY-ND, "editorial",
  "personal use" and unclear licences were skipped.
- **Licence check:** every licence below comes from the Sketchfab API detail response for that model
  (`GET https://api.sketchfab.com/v3/models/{uid}` → `license.label`, `license.url`), checked on 2026-09-23. "CC-BY 4.0"
  means `CC Attribution` → `http://creativecommons.org/licenses/by/4.0/`. "CC0 1.0" means `CC0 Public Domain` →
  `http://creativecommons.org/publicdomain/zero/1.0/`. All candidates are marked downloadable.
- **Sources searched:** Sketchfab API (about 70 queries in English and Turkish: vapur, Şehir Hatları, Bosphorus,
  İstanbul, sea bus, catamaran, tanker, bulk carrier, container ship, tug, pilot boat, fishing boat, seiner, kayık, gulet,
  vaporetto, yacht, sailboat …), Poly Haven (only 17th-century sailing ships), Poly Pizza, and Kenney Watercraft Kit
  (CC0, 45 models). Poly Pizza, Kenney and Quaternius models are cartoon low-poly. They do not match the realistic style,
  so none of them are listed.
  Smithsonian 3D and NASA have no suitable modern vessels. The only relevant CC0 maritime source was the Scottish
  Maritime Museum on Sketchfab, which has one usable small boat.
- **Ranking:** realism first (proportions, a recognisable silhouette seen from the air), then how well the vessel fits
  Istanbul, then cost. Triangle budget: about 50k or less for large ships and about 15k or less for small craft.
  Heavier models are marked **needs decimation**. "Tris" is the face count Sketchfab reports for its viewer.
  "Size" is the GLB archive size and the largest texture, as reported by Sketchfab search. Most of these archives
  would also need their textures reduced to 1K–2K.
- **Previews** are the source's own thumbnails, saved under `.shots/assets/vessels/`. One exception: the Paşabahçe
  model by typhoon476 has no preview on Sketchfab, so its file is the Sketchfab placeholder image.
- **Realism** is scored 1–10 from the preview and the model data. Nothing has been rendered in our engine yet.

---

## 1. City ferry: classic vapur and newer catamaran ferries

| Name | Source | Licence | Author | Size | Tris | Realism | Istanbul fit | Preview |
|---|---|---|---|---|---|---|---|---|
| Pasabahce Steamboat | [Sketchfab](https://sketchfab.com/3d-models/4c964c346da041039d66fe17e420d382) | CC-BY 4.0 | CanberkYucekok | GLB 26.2 MB, 7 tex up to 4K | 313k (**needs decimation** to ~40k) | 8: correct long white hull, single funnel and superstructure. The author says it is "not 100% accurate" | 10: the real Şehir Hatları ferry *Paşabahçe*, the classic Bosphorus vapur | [ferry-pasabahce-yucekok.jpg](../../../.shots/assets/vessels/ferry-pasabahce-yucekok.jpg) |
| Pasabahce Vapur - Istanbul Bosphorus Ferry | [Sketchfab](https://sketchfab.com/3d-models/48f11407fa6e4b7f845d8ace314ffe75) | CC-BY 4.0 | typhoon476 | GLB 110 MB, tex 2K | 1.96M (**needs heavy decimation**) | ?: no preview image on Sketchfab. Published 2026-08-27 | 10 by name and tags (istanbul, vapur, pasabahce) | [ferry-pasabahce-typhoon476.jpg](../../../.shots/assets/vessels/ferry-pasabahce-typhoon476.jpg) (placeholder) |
| Bandırma vapuru | [Sketchfab](https://sketchfab.com/3d-models/056250c643634288b72cc0160781ae94) | CC-BY 4.0 | Batuhan13 | GLB 56.9 MB (27 textures, 2K) | 18k | 7: clean, but a 19th-century cargo-passenger steamer with masts | 2: Turkish, but the historic *Bandırma*, not a city ferry | [ferry-bandirma.jpg](../../../.shots/assets/vessels/ferry-bandirma.jpg) |
| Sydney Emerald-Class Low Poly | [Sketchfab](https://sketchfab.com/3d-models/8b39b8957231420d919b60febb627bd5) | CC-BY 4.0 | A Certain Duck (@TheOminousDuck) | GLB 1.5 MB, tex 1K | 2.6k | 5: good catamaran commuter-ferry shape, low detail. The author notes rough UVs | 5: a newer catamaran-type city ferry, but with Sydney's green and cream livery; needs a white retexture | [ferry-sydney-emerald.jpg](../../../.shots/assets/vessels/ferry-sydney-emerald.jpg) |

**Recommendation:** use **Pasabahce Steamboat (CanberkYucekok)**. It is a real Şehir Hatları vapur, but it must be
decimated from 313k to about 40k triangles and its textures reduced to 1–2K. For the newer catamaran ferries nothing is
good enough, so the procedural model stays. The Emerald-class ferry is only a retexture fallback.

## 2. Sea bus / fast passenger catamaran (İDO deniz otobüsü, ~38 m)

| Name | Source | Licence | Author | Size | Tris | Realism | Istanbul fit | Preview |
|---|---|---|---|---|---|---|---|---|
| A fast passenger catamaran ferry | [Sketchfab](https://sketchfab.com/3d-models/1325955eece245fb91bc20ed6d666194) | CC-BY 4.0 | kekgaminglive986 | GLB 20.8 MB, tex 2K | 249k (**needs decimation**) | 4: AI-generated (Rodin Gen-1) mesh with a messy surface and a loud livery | 5: correct type, wrong look | [seabus-fast-cat-rodin.jpg](../../../.shots/assets/vessels/seabus-fast-cat-rodin.jpg) |
| Jet Ferry | [Sketchfab](https://sketchfab.com/3d-models/fa6073b5b2af4f1789db15377ed6a40b) | CC-BY 4.0 | Gman The Cruise Dude (@gmanisdabossatbeastmode) | GLB 25.2 MB, no textures | 670k (**needs heavy decimation**) | 6: plausible wave-piercer catamaran shape, untextured | 6: shape is close to an İDO sea bus | [seabus-jet-ferry.jpg](../../../.shots/assets/vessels/seabus-jet-ferry.jpg) |
| Sydney Emerald-Class Low Poly (see §1) | [Sketchfab](https://sketchfab.com/3d-models/8b39b8957231420d919b60febb627bd5) | CC-BY 4.0 | A Certain Duck | GLB 1.5 MB | 2.6k | 5 | 4: right length (~35 m), but an open-deck commuter ferry, not an enclosed sea bus | [ferry-sydney-emerald.jpg](../../../.shots/assets/vessels/ferry-sydney-emerald.jpg) |

**Recommendation:** nothing good exists, so **keep the procedural model**. No free and licence-clear model has a
clean, enclosed İDO-style sea bus hull.

## 3. Oil / product tanker

| Name | Source | Licence | Author | Size | Tris | Realism | Istanbul fit | Preview |
|---|---|---|---|---|---|---|---|---|
| Tanker Ship | [Sketchfab](https://sketchfab.com/3d-models/96ebf61af42b4062ae98a6ad848e1a25) | CC-BY 4.0 | Art Blender (@ArtBlender) | GLB 10.2 MB, material colours only (no textures) | 193k (**needs decimation**) | 8: Suezmax (322 × 47 m per the author) with a detailed red deck, pipework and aft bridge | 8: Bosphorus tanker traffic; scale to ~180–250 m for a product tanker | [tanker-artblender.jpg](../../../.shots/assets/vessels/tanker-artblender.jpg) |
| Tanker | [Sketchfab](https://sketchfab.com/3d-models/7348ef4bc7da4540a28d307409106467) | CC-BY 4.0 | James Neal (@JamesNeal) | GLB 8.5 MB, 1 × 4K tex | 122k (**needs decimation**) | 7: weathered red and black hull, correct tanker profile | 8 | [tanker-jamesneal.jpg](../../../.shots/assets/vessels/tanker-jamesneal.jpg) |
| Tanker | [Sketchfab](https://sketchfab.com/3d-models/52f55201f76143d4b080c644bf15a61c) | CC-BY 4.0 | 3DDomino | GLB 0.3 MB, no textures | 8.2k | 5: correct silhouette, plain deck with no detail | 7: fits the budget without any work | [tanker-3ddomino.jpg](../../../.shots/assets/vessels/tanker-3ddomino.jpg) |

**Recommendation:** use **Tanker Ship (Art Blender)**, decimated to about 50k. It has no textures, so it costs little
GPU memory. Tanker (3DDomino) is the no-work fallback that already fits the budget.

## 4. Bulk carrier

| Name | Source | Licence | Author | Size | Tris | Realism | Istanbul fit | Preview |
|---|---|---|---|---|---|---|---|---|
| Alassia M/V Cymona Eagle (2024) | [Sketchfab](https://sketchfab.com/3d-models/ed358cd364ea4b5380d00b6957d12718) | CC-BY 4.0 | FHA_studios (@FHA_ships) | GLB 1.2 MB, tex 1K | 21k | 8: real Ultramax bulker with four deck cranes, hatch covers and correct proportions | 9: the most common large ship type passing through the Bosphorus | [bulk-cymona-eagle.jpg](../../../.shots/assets/vessels/bulk-cymona-eagle.jpg) |
| Bulk Carrier - TFCC HERITAGE - IBEE Corp | [Sketchfab](https://sketchfab.com/3d-models/e78b4f1fdc094a63bb7d6c24d8e7e7dd) | CC-BY 4.0 | Gwenaël Hervé (@Gwenael_Herve) | GLB 8.4 MB, tex 2K | 18k (14.8k tris per the author) | 8: textured, lightly weathered, cranes and hatches are separate objects | 9 | [bulk-tfcc-heritage.jpg](../../../.shots/assets/vessels/bulk-tfcc-heritage.jpg) |
| Bulk Carrier | [Sketchfab](https://sketchfab.com/3d-models/93c076900f004102b78dfac989efae1d) | CC-BY 4.0 | medialog | GLB 64.7 MB, tex 2K | 1.63M (**needs heavy decimation**) | 9: highly detailed | 9 | [bulk-medialog.jpg](../../../.shots/assets/vessels/bulk-medialog.jpg) |

**Recommendation:** use **Cymona Eagle (FHA_studios)**. It is realistic, fits the budget at 21k and is only 1.2 MB.
TFCC Heritage is a good second hull for variety.

## 5. Container ship (and general cargo)

| Name | Source | Licence | Author | Size | Tris | Realism | Istanbul fit | Preview |
|---|---|---|---|---|---|---|---|---|
| Container Ship | [Sketchfab](https://sketchfab.com/3d-models/aaa41cca946b4a08bc08cf692b7757be) | CC-BY 4.0 | RM02 | GLB 35.5 MB, 10 tex up to 4K | 189k (**needs decimation**) | 9: large loaded box ship with a correct bow and aft bridge | 8: mainline size; scale down for feeders | [container-rm02.jpg](../../../.shots/assets/vessels/container-rm02.jpg) |
| Small Cargo Ship | [Sketchfab](https://sketchfab.com/3d-models/6362d3e9b11e4396aaafa854c3aa6f06) | CC-BY 4.0 | Styx (@588276) | GLB 24.6 MB, tex 4K | 51k | 6: small feeder with containers, a student project with somewhat simple textures | 9: feeder size typical of Marmara and Ambarlı traffic | [container-styx-feeder.jpg](../../../.shots/assets/vessels/container-styx-feeder.jpg) |
| A Full Container Ship | [Sketchfab](https://sketchfab.com/3d-models/5b69bf89f02b4cd89de6e49656f3499f) | CC-BY 4.0 | Mixmamo.studio (description: "by William Douglas") | GLB 6.3 MB, tex 2K | 113k (**needs decimation**) | 8: fully loaded, branded containers | 8. **Provenance flag:** the uploader credits someone else. Credit both, or skip this model | [container-mixmamo.jpg](../../../.shots/assets/vessels/container-mixmamo.jpg) |
| Cargo ship (general cargo / multipurpose) | [Sketchfab](https://sketchfab.com/3d-models/b7c97df584824ca682d26daabf401f87) | CC-BY 4.0 | hungry_drifter | GLB 35.3 MB, tex 2K | 73k (light decimation) | 8: weathered multipurpose ship with deck cranes | 9: very common Bosphorus transit type (bonus, not a container ship) | [container-general-cargo.jpg](../../../.shots/assets/vessels/container-general-cargo.jpg) |

**Recommendation:** use **Container Ship (RM02)**, decimated to about 50k (the container stacks decimate well) with
textures reduced to 2K. Add hungry_drifter's general cargo ship as an extra merchant type. Container Ship (LavaWave,
20k) was checked and dropped because its preview shows an empty, low-detail hull.

## 6. Tugboat / pilot boat

| Name | Source | Licence | Author | Size | Tris | Realism | Istanbul fit | Preview |
|---|---|---|---|---|---|---|---|---|
| Rastar 3200 tugboat | [Sketchfab](https://sketchfab.com/3d-models/1bbadbe4ab0a4b2599cd3f450942e6fe) | CC-BY 4.0 | Brout (@davidbroutian) | GLB 20.0 MB, 2 × 4K tex | 47k (**needs decimation** to ~15k) | 8: modern escort tug with a fendered hull and a tall wheelhouse; game-ready PBR | 9: matches the tugs working Istanbul's ports and anchorages | [tug-rastar3200.jpg](../../../.shots/assets/vessels/tug-rastar3200.jpg) |
| Pilot II | [Sketchfab](https://sketchfab.com/3d-models/6ea031237b6b4382ab362790f8af4e66) | CC-BY 4.0 | gogiart (@agt14032013) | GLB 5.8 MB, tex 1K | 101k (**needs decimation**) | 8: modern pilot boat with "PILOT" markings and a red and white hull | 7: pilot boats meet every transit at the Bosphorus entrances | [tug-pilot2-gogiart.jpg](../../../.shots/assets/vessels/tug-pilot2-gogiart.jpg) |

**Recommendation:** use the **Rastar 3200 tugboat**, decimated to about 15k with textures reduced to 1K. Pilot II is
optional and would also need decimation. Other free tugs found (WYTL-65608, Tugboat by stek or neutralize, Pilot Boat
by AVZ) are crude or cartoon-like.

## 7. Small fishing boat and purse seiner

| Name | Source | Licence | Author | Size | Tris | Realism | Istanbul fit | Preview |
|---|---|---|---|---|---|---|---|---|
| Fishing boat | [Sketchfab](https://sketchfab.com/3d-models/2f894eb760ca49eca14c38c2d49058a1) | CC-BY 4.0 | Aurélien Duval (@aurelien.d) | GLB 24.8 MB (23 textures, 2K) | 14k | 8: weathered wooden hull, small wheelhouse and gear | 8: close to a Turkish wooden *balıkçı teknesi* | [fishing-aurelien.jpg](../../../.shots/assets/vessels/fishing-aurelien.jpg) |
| Fishing Boat | [Sketchfab](https://sketchfab.com/3d-models/649c006b72e748bf84e7cda011faaff2) | CC-BY 4.0 | masterjack20 | GLB 11.8 MB, tex 4K | 10k | 7: clean white hull with a red stripe, wheelhouse, mast and boom | 8: typical small Bosphorus motor fishing boat | [fishing-masterjack.jpg](../../../.shots/assets/vessels/fishing-masterjack.jpg) |
| "Venus", a Shetland fourareen (with base) | [Sketchfab](https://sketchfab.com/3d-models/4c903a14567f47fcb9d1bbf3e38ca502) | **CC0 1.0** | Scottish Maritime Museum | GLB 32.0 MB, tex 4K | 20k (the variant without a base, [ce4d6915](https://sketchfab.com/3d-models/ce4d6915e1d041459e08f2d8da521e86), has 50k) | 9: photogrammetry of a real 1898 wooden boat | 6: an open rowing boat, a stand-in for a *sandal* or *kayık*. The display base must be removed | [fishing-venus-cc0.jpg](../../../.shots/assets/vessels/fishing-venus-cc0.jpg) |
| Low Poly Old Rusty Fishing Boat | [Sketchfab](https://sketchfab.com/3d-models/3713c37983ea4c04b87fe173e2631b76) | CC-BY 4.0 | Ottto3d (@Ottto3ds) | GLB 67.1 MB (5 × 4K tex) | 10k | 7: rusty small cabin boat | 6: textures must be cut to 1K | [fishing-rusty-ottto.jpg](../../../.shots/assets/vessels/fishing-rusty-ottto.jpg) |
| Salt-Beaten Fishing Trawler (seiner stand-in) | [Sketchfab](https://sketchfab.com/3d-models/fd28c35b76754c9386b32aa281a0e238) | CC-BY 4.0 | Moon Moon (@zoherrose7) | GLB 5.8 MB, tex 2K | 77k (**needs decimation**) | 7: PBR steel trawler with realistic wear | 6: a trawler, not a purse seiner (*gırgır*). It has no net boom or skiff | [seiner-salt-beaten-trawler.jpg](../../../.shots/assets/vessels/seiner-salt-beaten-trawler.jpg) |
| Trawler (seiner stand-in) | [Sketchfab](https://sketchfab.com/3d-models/421f3239115c44539686fcb62835f115) | CC-BY 4.0 | JasperTobias | GLB 0.4 MB, tex 1K | 5.3k | 5: stylised low-poly, but with believable proportions | 5 | [seiner-trawler-jasper.jpg](../../../.shots/assets/vessels/seiner-trawler-jasper.jpg) |

**Recommendation:** use **Fishing boat (Aurélien Duval)** for the small fishing boat. It is 14k and closest to a
Turkish wooden fishing boat; reduce its 23 textures to 1K. For rowing *kayık*/*sandal* boats, "Venus" is the only CC0
option. For the purse seiner nothing matches, so **keep the procedural model**. The Salt-Beaten trawler is the closest
stand-in if a model is wanted. "Low poly Greek Fishing Boat" (Muyaya Concept, CC-BY) is a kaiki shape but cartoon-styled
and was dropped.

## 8. Bosphorus tour boat / small passenger motor boat

| Name | Source | Licence | Author | Size | Tris | Realism | Istanbul fit | Preview |
|---|---|---|---|---|---|---|---|---|
| 2010 Vaporetto | [Sketchfab](https://sketchfab.com/3d-models/71b8ec3054e14f62887d6da7ac1f5789) | CC-BY 4.0 | r_ka (@ruslan.kindruk) | GLB 1.7 MB, tex 512 | 2.5k | 6: Venetian water bus with a single deck, low detail | 5: similar size and use to the small Bosphorus passenger boats, but not the two-deck tour-boat look | [tour-vaporetto.jpg](../../../.shots/assets/vessels/tour-vaporetto.jpg) |

**Recommendation:** nothing good exists, so **keep the procedural model**. No free, realistic two-deck tour boat was
found. Other results were wrecks (Malletts Bay photogrammetry), a Disney-style jungle-cruise boat, or cruise ships.
The Vaporetto is the only possible stand-in.

## 9. Motor yacht and sailboat

| Name | Source | Licence | Author | Size | Tris | Realism | Istanbul fit | Preview |
|---|---|---|---|---|---|---|---|---|
| Yacht | [Sketchfab](https://sketchfab.com/3d-models/0dd451f295d049cea20c17d3ffa87ee3) | CC-BY 4.0 | Sergei (@sergeif) | GLB 17.1 MB, 3 × 4K tex | 8.5k | 9: ~40 m superyacht with teak decks and a hot tub, very clean | 9: the megayacht type moored at Bebek and İstinye | [yacht-sergeif.jpg](../../../.shots/assets/vessels/yacht-sergeif.jpg) |
| Yatch I (second edition) | [Sketchfab](https://sketchfab.com/3d-models/b826e1c52d604c599b893967bed8a254) | CC-BY 4.0 | dannzjs | GLB 5.9 MB, tex 2K | 26k (slightly over budget) | 8: ~15 m flybridge motor cruiser | 8 | [yacht-dannzjs-yatch1.jpg](../../../.shots/assets/vessels/yacht-dannzjs-yatch1.jpg) |
| Low-poly yatch (animation) | [Sketchfab](https://sketchfab.com/3d-models/35b5b137ca2d47698cc220a491dfff68) | CC-BY 4.0 | dannzjs | GLB 0.5 MB, tex 1K | 5.3k | 6: simple but realistic proportions | 7: cheap filler for small private motor boats | [yacht-dannzjs-lowpoly.jpg](../../../.shots/assets/vessels/yacht-dannzjs-lowpoly.jpg) |
| Sailboat | [Sketchfab](https://sketchfab.com/3d-models/76d0b1e24be14d2f9a524bfce3001aeb) | CC-BY 4.0 | Sergei (@sergeif) | GLB 8.3 MB, 3 × 4K tex | 2.5k | 8: modern sloop with good sails and deck texture | 8 | [sail-sergeif.jpg](../../../.shots/assets/vessels/sail-sergeif.jpg) |

**Recommendation:** use **Yacht (Sergei)** as the motor yacht and **Sailboat (Sergei)** as the sailboat. Both are
well within budget; only their textures need reducing to 1K. The two models come from the same author and share one
style.

---

## Summary

| Vessel type | Recommendation | Why |
|---|---|---|
| City ferry (vapur) | **Pasabahce Steamboat**, CanberkYucekok, CC-BY 4.0 | The real Şehir Hatları *Paşabahçe*. Needs decimation from 313k to ~40k and textures reduced to 1–2K |
| City ferry (newer catamaran type) | **Keep procedural** | Only the Sydney Emerald-class exists (5/10, Sydney livery) |
| Sea bus (İDO) | **Keep procedural** | Only an AI-generated mesh or a 670k untextured model exist |
| Oil/product tanker | **Tanker Ship**, Art Blender, CC-BY 4.0 | Most realistic and untextured, so cheap after decimating 193k to ~50k. Fallback: 3DDomino (8k) |
| Bulk carrier | **Alassia M/V Cymona Eagle**, FHA_studios, CC-BY 4.0 | Realistic Ultramax at 21k tris and 1.2 MB with no extra work |
| Container ship | **Container Ship**, RM02, CC-BY 4.0 | Best realism. Decimate 189k to ~50k. Add the hungry_drifter general cargo ship for variety |
| Tug / pilot boat | **Rastar 3200 tugboat**, Brout, CC-BY 4.0 | Modern, realistic PBR escort tug. Decimate 47k to ~15k |
| Small fishing boat | **Fishing boat**, Aurélien Duval, CC-BY 4.0 | Weathered wooden boat with a wheelhouse at 14k, closest to a *balıkçı teknesi*. CC0 rowboat option: "Venus" |
| Purse seiner | **Keep procedural** | No seiner found. The Salt-Beaten trawler is only a stand-in |
| Bosphorus tour boat | **Keep procedural** | No realistic two-deck tour boat found. The Vaporetto is a weak stand-in |
| Motor yacht | **Yacht**, Sergei, CC-BY 4.0 | Superyacht at 8.5k with excellent realism |
| Sailboat | **Sailboat**, Sergei, CC-BY 4.0 | 2.5k, realistic, same author and style as the yacht |

Attribution to record in `public/models/LICENSES.md` if a model is approved:
`"<Title>" by <Author> (https://sketchfab.com/3d-models/<uid>), licensed under CC BY 4.0
(http://creativecommons.org/licenses/by/4.0/)`, plus a note of any changes (decimation, retexture). CC0 models need
no attribution, but the source should still be listed.

## Integration cost (for the approval decision)

- The procedural fleet draws with **4 BatchedMesh draw calls** in total (big/small × near/far LOD) using one shared
  vertex-colour material with per-instance hull paint, weathering and night-lit windows. A textured GLB cannot join
  those batches: every approved model adds its own material and at least one draw call per LOD (plus shadow and
  reflection passes), so approving all nine recommendations would add roughly 15–25 draw calls to the life module
  (budget: about 40).
- Each model needs decimation, a generated far LOD, textures reduced to 1–2K (ideally one atlas per model) and a
  re-authored emissive mask for the night windows, otherwise it goes dark at night while the procedural ships light up.
- Per-instance liveries (hull colours, funnel colours) would be lost unless the hull is split into a paintable part.
- Recommendation: approve at most the two or three models that clearly beat the procedural ones at close range
  (the Paşabahçe vapur, the Cymona Eagle bulker and the Rastar tug); keep the procedural versions for the rest and as
  the far LOD.
