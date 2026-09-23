# Human and animation candidates (not chosen)

## Decision (2026-09-24)

None of the candidates below is approved. The user chose **MetaHuman characters + Mixamo animations** instead, kept
in the gitignored private asset store `private-assets/`. Their licences, sources and folder layout are recorded in
[private-assets.md](../private-assets.md). This shortlist is kept only as the record of what was checked.

---

Status: **shortlist only, nothing is approved.** No character or clip has been downloaded, added to `public/` or
referenced in code. Only the sources' own preview images were saved, under `.shots/assets/humans/`.

Need (plan 16, S1–S5): realistic adult men and women of varied ages and clothing for Kadıköy pedestrians, café NPCs
and the player on foot; one shared skeleton if possible; clips for idle, walk, jog, run, turn, stand-to-sit, sit
idle, sit-to-stand, talk gestures, drink/hold cup, phone, look around and open door; a crowd of 200 at medium framing.

## Read this first

- **The plan's current pick does not hold up.** Plan 16 says "Quaternius Universal Base Characters + UAL clips (CC0,
  one rig) now". The live pages show that the free tier of Universal Base Characters is **two muscular base bodies in
  underwear plus five hairstyles**. The only compatible clothing pack is fantasy, and its free part is a ranger and a
  peasant. There are no modern clothes at all. The free animation tiers also lack **turn, look around, drink and the
  barista "on counter" set**. Those clips are only in the paid Pro and Source tiers, which the asset rule does not allow.
- **Microsoft Rocketbox** is the only free set found that meets all of these: licence-clean, realistic, clothed,
  varied, on one skeleton, and shipped with a matching everyday-behaviour clip library (turns, sit down/stand up on
  chairs and at tables, talk and listen gestures, drink, phone, look around, door). It is MIT, not CC0. The brief
  accepts MIT, and it needs the copyright notice kept.

## How this list was built

- **Licence rule** (CLAUDE.md, "External assets", and this task): free assets only. CC0 is preferred. CC-BY is allowed
  only with the attribution recorded. MIT and BSD are accepted. Excluded: NC, ND, editorial, personal-use-only and
  unclear licences, and anything that forbids redistribution in a public MIT repo.
- **Checked live on 2026-09-24:** quaternius.com pack pages, their itch.io pages (download tiers, file sizes and
  changelogs) and the tier images; the Rocketbox GitHub repo through the API (LICENSE.md, README, the full file tree
  with sizes, and `Docs/all.pdf`); the MPFB2 repo (LICENSE.md, LICENSE.ASSETS.md, rig definitions); the MakeHuman
  licence page, asset-pack pages and the MPFB entry on extensions.blender.org; the CMU home page, FAQ and search;
  cgspeed; Zenodo and the 100STYLE page; the Mesh2Motion repos; the Sketchfab API.
- **Ranking:** realism at medium framing first (real proportions, everyday clothes). Then one shared skeleton and clip
  coverage, then licence clarity, then crowd cost (triangles, LODs, bytes per look).
- **Sizes:** "measured" means the figure comes from the source (GitHub tree sizes, itch.io upload sizes, Zenodo).
  "est." is my estimate for a converted glTF with 1K KTX2 textures and meshopt. Nothing has been converted or
  rendered in our engine yet.
- **Previews** are the sources' own images, re-saved as smaller JPEGs. Exceptions:
  - `rocketbox-catalogue.jpg` is the repo's own contact sheet (`Docs/all.pdf`) rendered to an image.
  - `mpfb-system-assets.jpg` puts eight of the asset-pack thumbnails on one sheet.
  - `cmu-13_09-drink-soda.jpg` is four frames from that trial's own preview video.
  - `100style-video-thumb.jpg` is the thumbnail of the dataset's own video.

---

## 1. Characters (bodies and looks)

| Name | Source | Licence | Author | Size | Polys / textures | Rig | Formats | Realism | Kadıköy fit | Preview |
|---|---|---|---|---|---|---|---|---|---|---|
| **Microsoft Rocketbox Avatar Library** | [GitHub](https://github.com/microsoft/Microsoft-Rocketbox) | **MIT** | Microsoft (made by Rocketbox Studios, Markus Wojcik and team) | Measured: ~95 MB per avatar folder (median; 0.5–0.8 MB FBX with all LODs, 2 MB facial FBX, 7 uncompressed 2048² TGAs). Repo 4.1 GB. Est.: 1–1.5 MB per look after conversion | 4 LODs in each FBX: 10k / 5k / 2.5k / 500 tris. 2048² body and head textures (colour, normal, specular) plus an opacity map for hair | One skeleton shared by all 115 avatars and all clips: 56 body bones including fingers, plus 28 facial bones. `_facial.fbx` variants add 15 visemes, 48 FACS shapes and ARKit shapes | FBX (3ds Max export), `.max` sources | 7: realistic proportions and photo-based textures, but a 2010s real-time look (hair cards, specular workflow). Good at medium framing | 8: mostly casual urban clothes, business, delivery, chef and joggers. Some outfits do not fit (see risks) | [rocketbox-sample.jpg](../../../.shots/assets/humans/rocketbox-sample.jpg), [rocketbox-catalogue.jpg](../../../.shots/assets/humans/rocketbox-catalogue.jpg) |
| **MPFB2 / MakeHuman** (CC0 core; optional CC-BY packs) | [MPFB](https://static.makehumancommunity.org/mpfb.html), [asset packs](https://static.makehumancommunity.org/assets/assetpacks.html), [repo](https://github.com/makehumancommunity/mpfb2) | **CC0** (base mesh, targets, skins, system clothes and hair, rigs; output). Code is GPLv3, but the output is not affected. Some packs are **CC-BY** (per author) | MakeHuman team; pack assets by community authors (Margaret Toigo, Mindfront, Elvaerwyn, punkduck …) | Measured: system assets 267 MB; Skins 01 99 MB (23 skins), Skins 02 72 MB (13); CC0 clothing packs 20–79 MB each. Est.: 2–4 MB per exported character at 1K | Base mesh 13,380 body vertices, all quads (≈26k tris); low-poly proxies of about 1.6k (`male1591`, `female1605`) and 741. Clothes add 1–10k each. Skin resolution not stated per pack | Selectable at export: `game_engine` (53 bones, UE-mannequin naming), `mixamo`, **`cmu_mb` (the CMU BVH bone names)**, `default`, Rigify | Made in Blender 4.2+ (MPFB 2.0.17, 2026-07-22) and exported as glTF or FBX | 6–8: real anatomy with age, weight, muscle and proportion sliders. The CC0 system hair and clothes look plain and dated. The high-poly hair is CC-BY | 8: any age or body type; 18 CC0 system skins (young / middle-aged / old × African / Asian / Caucasian × male / female); a CC0 hijab exists | [mpfb-main-view.jpg](../../../.shots/assets/humans/mpfb-main-view.jpg) (hair and sweater in this shot are CC-BY), [mpfb-system-assets.jpg](../../../.shots/assets/humans/mpfb-system-assets.jpg) |
| Quaternius Universal Base Characters (free "Standard" tier) | [Site](https://quaternius.com/packs/universalbasecharacters.html), [itch.io](https://quaternius.itch.io/universal-base-characters) | **CC0** | Quaternius | Measured: free zip 122 MB (Source $19.99: 600 MB) | ~13k tris on average. PBR textures, resolution not stated | Quaternius humanoid rig (renamed 2026-01 to match UAL and the outfits) | FBX, OBJ, glTF (Blend only in the paid Source tier) | 3: semi-stylised faces and sculpted stylised hair. The free pair are heavily muscled | 2: underwear only. Compatible clothes are fantasy (free: ranger and peasant) | [quaternius-ubc-free-tier.jpg](../../../.shots/assets/humans/quaternius-ubc-free-tier.jpg), [quaternius-ubc.jpg](../../../.shots/assets/humans/quaternius-ubc.jpg), [quaternius-outfits-free-tier.jpg](../../../.shots/assets/humans/quaternius-outfits-free-tier.jpg) |

### Microsoft Rocketbox

- **Licence:** [LICENSE.md](https://github.com/microsoft/Microsoft-Rocketbox/blob/master/LICENSE.md) is the standard
  MIT text: "Copyright (c) 2020 Microsoft … Permission is hereby granted, free of charge … to deal in the Software
  without restriction". The README says: "The library of avatars is now released under MIT License" (updated 12/2020).
  The GitHub API reports `MIT`. The older wording "free for research and academic use" (the 2020 paper and the MSR
  blog title) is from before this change.
- **Contents (measured from the repo tree):**
  - 117 avatar folders, 115 unique: `Female_Party_01/02` appear under both Adults and Professions.
  - 40 Adults (17 women, 21 men, 2 "party"), 73 Professions and 4 children.
  - Professions: business 11, construction 9, fire 10, medical 8, military 8, police 8, pilot 5, sports 6, security 2,
    and one each of chef, delivery, gardener and wood worker.
- **What it replaces or adds:** it replaces the planned Quaternius crowd and stand-in NPC for S1–S4 (200 pedestrians,
  barista and café guests) and can serve as the on-foot player in S3. Its clips are §2A.
- **Looks for a crowd of 200:** about **55–60 street-fitting looks**. These are 36 adults (all except the Afghan-style
  burqa and the three thobe/keffiyeh men, which can be optional tourists), 11 business, chef, delivery, gardener, wood
  worker, 2–3 construction, 2 sports (joggers for Moda; the other sports looks are swimwear or football kits) and 2 medical. Each look repeats 3–4 times in a crowd of 200.
  There is no per-part tint mask, so recolouring clothes needs a hand-made mask.
- **Risks:**
  - The avatars date from the 2000s–2010s.
  - The specular/gloss materials must be converted to PBR metal-rough.
  - Hair uses alpha cards, which need alpha-hash or alpha-to-coverage under TAA.
  - The FBX files come from 3ds Max: a one-time Blender conversion pass is needed (bone orientation, LOD split,
    materials).
  - Ages are mostly 20–55, with only a handful who look 55–65 and nobody clearly elderly.
  - Uniforms (police, military, fire, pilot, security) carry foreign insignia: skip them or retexture them.
  - `Sports_Male_02/03` wear striped football kits: check for logos.
  - Casual looks with printed T-shirts or jackets: check each texture for brand prints during the conversion pass.
    MIT covers Microsoft's copyright, not third-party trademarks.
  - Real people: the avatars were built from studio photos of real people, but the paper says the source material was
    "mixed and strongly modified" so that the avatars "represent generic humans that do not exist in reality". No
    likeness issue was found.
  - The repo has had no commits since 2022-10 (the assets are static).
  - At 2–3 materials per avatar, 200 full-LOD people would be 400–600 draw calls. The built-in 2.5k and 500-tri LODs
    (or baked-animation instancing for the far crowd) are needed.

### MPFB2 / MakeHuman

- **Licence:**
  - [LICENSE.md](https://github.com/makehumancommunity/mpfb2/blob/master/LICENSE.md): "These assets have been released
    under CC0 1.0 Universal". This covers the base mesh, proxies, targets, textures, clothes, rigs and poses. On
    output: "the MakeHuman team makes no claim whatsoever over output such as … Exports to files (FBX, OBJ …)".
  - [License page](https://static.makehumancommunity.org/about/license.html): "All core assets are shared under
    Creative Commons, CC0".
  - Pack licences, per the [asset packs page](https://static.makehumancommunity.org/assets/assetpacks.html):
    - **CC0:** system assets (10 hairstyles, 20 clothes including `male_casualsuit01–06`, `female_casualsuit01–02`,
      elegant, work and sport suits and 6 shoes, 23 skins, 7 proxies); Skins 01/02; Suits 01 (8 formal suits);
      Shirts 01 (t-shirts, polo, fisherman sweater); Pants 01 (cargo, wool, jeans shorts); Skirts 01; Dress 01;
      Shoes 01; Glasses 01; Hats 01 (includes a newsboy cap); Bodyparts 05 (beards); Poses 01 (sitting).
    - **CC-BY** (attribution per author; the FAQ links
      [CC BY 2.5 SE](https://creativecommons.org/licenses/by/2.5/se/deed.en)): Hair 02 (21 high-poly styles,
      Elvaerwyn); Shirts 02 (cardigans, knitted sweaters, shirt and tie); Pants 02 (jeans, trousers); Shoes 02
      (sneakers, oxfords); Equipment 03 (handbag, shopping bag).
    - A **CC0 hijab**, "Femal Muslim head cover simple hijab" by abumeqbel, is in the
      [asset repository](http://www.makehumancommunity.org/clothes/femal_muslim_head_cover_simple_hijab.html) but not in
      a pack. Its page says "License: CC0 - Creative Commons Zero" (checked on 2026-09-24).
  - **Per-asset exclusions found in the licence re-check (2026-09-24).** Every row in the CC0 pack tables says CC0,
    and every row in the four CC-BY packs says CC-BY. Three assets still carry third-party marks, which neither CC0
    nor CC-BY licenses:
    - Hats 01 `toigo_maga_hat`: a political campaign cap, and its slogan is a registered trademark. Take only
      `jujube_newsboy_cap` (or the pack without this hat).
    - Shirts 02 `punkduck_deathnote_t-shirt`: the thumbnail shows the *Death Note* logo printed on the shirt.
    - Shoes 02 `punkduck_kill_bill_shoes`: yellow sneakers with the Onitsuka Tiger stripes (an ASICS trademark).
  - **Provenance of community assets.** The FAQ says: "Apart from the “makehuman system assets”, the bundled assets are
    mostly from third part authors." The CC0 or CC-BY label is the uploader's own statement. Realistic skins are often
    painted from photo-texture sites whose licences forbid redistribution, so prefer the system skins (made by the
    MakeHuman team). Use a community skin (Skins 01/02) only after checking its asset-repository page for a stated
    source.
- **What it replaces or adds:** it adds hero NPCs (S4–S5) and a player character with exact Istanbul looks: older
  people, heavier builds and headscarves. It is the long-term close-range upgrade over Rocketbox faces. The plan
  already names it for heroes.
- **Looks for a crowd of 200:** unlimited to author (age, weight and proportion morphs × skins × clothes), but every
  variant is its own exported mesh and textures. In practice that means 20–40 exported variants, or 5–10 heroes plus
  Rocketbox for the crowd.
- **Risks:**
  - There are **no animations**, so clips must be retargeted onto its rig once in Blender. The exception is CMU BVH on
    the `cmu_mb` rig, which plays without retargeting.
  - The CC0 wardrobe is thin for everyday Kadıköy clothes; the good jeans, sweaters and sneakers are CC-BY.
  - The "enhanced skin" is a Blender shader node group and does not carry into glTF, so plain PBR skin textures are
    needed.
  - Clothes can let skin poke through on extreme body shapes. The FAQ says delete groups help, and some assets lack
    them.
  - The MakeHuman community site was down on HTTPS during the check (it answered on HTTP).

### Quaternius Universal Base Characters: not recommended

- **Licence:** the site says "Free to use in personal, educational and commercial projects. (CC0 License)" and links
  [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). itch.io lists "Asset license: Creative Commons Zero
  v1.0 Universal".
- **Free tier, from the tier image:** "2 base models and 5 hairstyles completely free". The site says 6 base models in
  total, while the itch.io Source upload says "All 8 base models". The discrepancy is noted and does not matter
  here.
- **Why not:** it is stylised and has no modern clothes in any free tier. For grounded realism it would need a
  wardrobe that does not exist free.

**Also checked and not listed:**

- Renderpeople's free samples on Sketchfab (3 rigged and 3 animated photoscans) are labelled CC-BY 4.0 on Sketchfab.
  Renderpeople's own terms for the same free models forbid making them downloadable as single files, so the licence is
  **unclear**.
- One-off Sketchfab "realistic animated" people (such as jungle_jim uploads) have unclear provenance.
- Mixamo is already dropped in plan 16 because its terms forbid distributing raw files.

---

## 2. Animation clips

| Name | Source | Licence | Author | Size | Clips | Skeleton | Formats | Fit | Preview |
|---|---|---|---|---|---|---|---|---|---|
| **Rocketbox animation library** | [Assets/Animations](https://github.com/microsoft/Microsoft-Rocketbox/tree/master/Assets/Animations) | **MIT** (same repo) | Microsoft / Rocketbox | Measured: 471 FBX, 1.46 GB, median 2.2 MB each. Est.: under 0.1 MB per clip as skeleton-only glTF | 471 (the README says 417): 326 in place, 71 with XY root motion (walks and runs), 74 with XYZ root motion (turns, sit down, stand up). Male and female versions | Native Rocketbox skeleton, **no retargeting** | FBX (3ds Max) | 8: everyday behaviour at natural timing, built for VR and crowd research | [rocketbox-sample.jpg](../../../.shots/assets/humans/rocketbox-sample.jpg) |
| Quaternius Universal Animation Library 1 + 2, free "Standard" tiers | [UAL1](https://quaternius.itch.io/universal-animation-library), [UAL2](https://quaternius.itch.io/universal-animation-library-2) | **CC0** | Quaternius (with Gonzalo Furnier) | Measured: free zips 15 MB and 17 MB | UAL1 free ≈ 40 of 120+; UAL2 free = 42 of 130+. With and without root motion | Quaternius humanoid; must be retargeted onto Rocketbox or MPFB | FBX, GLB | 5: hand-keyed game timing, many combat and fantasy clips | [quaternius-ual1-free-list.jpg](../../../.shots/assets/humans/quaternius-ual1-free-list.jpg), [quaternius-ual2-free-list.jpg](../../../.shots/assets/humans/quaternius-ual2-free-list.jpg) |
| 100STYLE | [Zenodo](https://zenodo.org/records/8127870), [page](https://ianxmason.github.io/100style/) | **CC BY 4.0** | Ian Mason, Sebastian Starke, Taku Komura | Measured: BVH zip 1.47 GB (the labelled data, 14.8 GB, is not needed) | 100 locomotion styles × walk, run, sidestep, backwards, idle and transitions. Useful styles: Old, WalkingStickLeft/Right, ArmsBehindBack, HandsInPockets, OnPhoneLeft/Right, Rushed, Heavyset, Depressed, Neutral | 28-bone XSens, 60 fps, one actor, **no fingers**; must be retargeted | BVH | 7: raw mocap and good gaits, but many styles are theatrical | [100style-video-thumb.jpg](../../../.shots/assets/humans/100style-video-thumb.jpg) |
| CMU Graphics Lab Motion Capture Database | [mocap.cs.cmu.edu](http://mocap.cs.cmu.edu/), [FAQ](http://mocap.cs.cmu.edu/faqs.php), [BVH by cgspeed](https://sites.google.com/a/cgspeed.com/cgspeed/motion-capture) | **Custom permissive** (quoted below) | CMU Graphics Lab (NSF EIA-0196217) | A few MB per trial (120 fps) | 2,605 trials. Search counts: walk 617, run 156, jog 39, turn 145, sit 55, drink 16, phone 6, wave 9, look around 1, talk 0, door 0 | A calibrated skeleton per subject. The cgspeed BVH names match MPFB's `cmu_mb` rig. Onto Rocketbox it must be retargeted. No fingers | ASF/AMC, C3D, BVH (cgspeed) | 6: real mocap but noisy; needs trimming, looping, foot-locking and root extraction | [cmu-13_09-drink-soda.jpg](../../../.shots/assets/humans/cmu-13_09-drink-soda.jpg) |

**Licence lines:**

- **Rocketbox:** see §1 (MIT).
- **Quaternius:** "Free to use in personal, educational and commercial projects. (CC0 License)", linking
  [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).
- **100STYLE:** Zenodo licence `cc-by-4.0` ([CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)). The retargeted
  version in [orangeduck/100style-retarget](https://github.com/orangeduck/100style-retarget) is also CC BY 4.0, but
  its `Geno.fbx` mesh is "free for non-commercial research use" and must not be used.
- **CMU:**
  - Home page: "This dataset of motions is free for all uses." and "You may include this data in commercially-sold
    products, but you may not resell this data directly, even in converted form."
  - [FAQ](http://mocap.cs.cmu.edu/faqs.php): "The motion capture data may be copied, modified, or redistributed without
    permission."
  - Requested acknowledgement: "The data used in this project was obtained from mocap.cs.cmu.edu. The database was
    created with funding from NSF EIA-0196217."
  - Redistribution is allowed. The no-resale clause conflicts with MIT's "sell copies", so CMU-derived files would
    need their own notice outside the repo's MIT scope.

### Clip coverage

| Need | Rocketbox (MIT) | UAL1+2 free (CC0) | 100STYLE (CC BY) | CMU |
|---|---|---|---|---|
| Idle | ✔ `idle_neutral_01–09`, `idle_breathe`, `idle_waiting` | ✔ Idle, Idle_Talking, Idle_FoldArms, Idle_Rail | ✔ `*_ID` per style | ~ inside longer takes |
| Walk | ✔ `walk_neutral(_01–04)`, slow, fast, stroll, self-assured, start/stop | ✔ Walk, Walk_Formal, Walk_Carry | ✔ Neutral, Old, HandsInPockets, ArmsBehindBack … | ✔ 617 trials |
| Jog | ~ `run_slow_01/02` | ✔ Jog_Fwd | ✔ slow runs | ✔ 16_35–16_42 |
| Run | ✔ `run_neutral`, `run_fast`, start/stop, walk↔run | ~ Sprint only | ✔ `*_FR` | ✔ 156 trials |
| Turn | ✔ `turn_left/right_60/90/120/180`, `*_to_walk` | ✘ Turn 90 is Pro-only | ✘ | ✔ walk with 90° turns (16_17–16_29) |
| Stand-to-sit | ✔ `sit_down_chair_01/02/left/right`, `sit_down_table_left/right` | ✔ Sitting_Enter | ✘ | ✔ high stool (13_01–13_03) |
| Sit idle | ✔ ~14 `sit_chair_idle_*` and ~13 `sit_table_idle_*` per gender | ✔ Sitting_Idle | ✘ | ~ |
| Sit-to-stand | ✔ `sit_stand_up_chair_*`, `sit_stand_up_table_*` | ✔ Sitting_Exit | ✘ | ✔ |
| Talk gestures | ✔ `gestic_talk_*` (neutral, relaxed, excited, angry, nervous, sad, self-assured), `gestic_listen_*`, shrug, laugh, seated `sit_*_gestic_*` | ~ Idle_Talking, Sitting_Talking, Yes, Idle_No | ✘ | ✘ |
| Drink / hold cup | ✔ `drink_drinking`, `drink_idle` (standing only) | ~ Consume (Drink is Pro-only) | ✘ | ✔ drink soda (13_09, 79_40) |
| Phone | ✔ `cell_phone_talk_01/02`, `cell_phone_listen_01`, `cell_phone_textmessage` | ✔ Idle_Talking_Phone | ✔ OnPhoneLeft/Right (walking) | ~ landline dialing (79_37) |
| Look around | ✔ `idle_look_around_01–03`, `sit_*_idle_look_around` | ✘ Pro-only | ~ LookUp | ✘ |
| Open door | ~ `try_door_inwards/outwards`, `knock_door`, `listen_door` | ~ Interact (generic) | ✘ | ✘ |

Rocketbox covers 11 of the 13 needs fully and jog and door partly. It also has umbrella, hold bag, newspaper, take
picture, headphones, trolley, wave and invite-to-sit, which suit café and ferry-pier life. Gaps that remain in every
free source are seated drinking and a full open-and-walk-through door. Those need a small upper-body layer and a door
cut or fade, as the plan already allows.

**Also checked and not listed:**

- Mesh2Motion ([app](https://github.com/Mesh2Motion/mesh2motion-app): MIT code, CC0 assets) is a free web auto-rigger
  and retargeter. Its human clips are mostly the free Quaternius UAL clips (bundled under `CC0-packs/Quaternius`) plus
  a few of the author's own (Walk_Female, Idle Listening, Greeting, Head Nod). It is useful as a tool, but it is not
  a separate clip source. Preview: [mesh2motion-readme.jpg](../../../.shots/assets/humans/mesh2motion-readme.jpg).
- Bandai Namco Research Motion Dataset 1/2 is CC BY-NC 4.0, and Ubisoft LAFAN1 is CC BY-NC-ND 4.0. Both are
  **excluded** as NC.

---

## Licence re-check (2026-09-24)

A second pass opened each primary licence source again and looked for reasons a file could not ship in the public MIT
repo.

| Candidate | Verdict | Primary source checked | Notes |
|---|---|---|---|
| Rocketbox avatars | OK, keep the MIT notice | `LICENSE.md` (MIT, "Copyright (c) 2020 Microsoft"); README "November 2020 License Update"; GitHub API `mit`; full tree (4,027 paths) | There is no other licence or notice file in the repo, so the animations and facial variants fall under the same MIT file. Uniform insignia and kit logos are third-party marks: keep them excluded |
| Rocketbox animations | OK, keep the MIT notice | same repo | none |
| MPFB2 CC0 core | OK (CC0) with one exclusion | repo `LICENSE.md` §C; `LICENSE.ASSETS.md` (CC0 text); licence page; per-asset tables of the system, Skins 01/02, Suits/Shirts/Pants/Skirts/Dress/Shoes/Glasses/Hats 01 and Bodyparts 05 packs (all rows CC0); hijab page | Exclude `toigo_maga_hat`. Check community skins for their source |
| MPFB2 CC-BY packs | OK with attribution, two exclusions | pack tables (all rows "CC-BY"); FAQ links CC BY 2.5 SE | Exclude `punkduck_deathnote_t-shirt` and `punkduck_kill_bill_shoes` |
| 100STYLE | OK with attribution | Zenodo API `cc-by-4.0`; dataset page ("licensed under a Creative Commons Attribution 4.0 International License", with the credit form it asks for); retarget repo (GitHub `cc-by-4.0`) | Never ship `Geno.fbx` ("free for non-commercial research use") |
| Quaternius UAL1/UAL2 free tiers | OK (CC0) | itch.io "Asset license: Creative Commons Zero v1.0 Universal"; quaternius.com FAQ ("All models are under the CC0 License") | Only the free Standard zips; the Pro and Source zips are paid |
| Quaternius UBC free tier | Licence OK (CC0); not recommended for fit | same | none |
| CMU mocap | **Problem** | home page and FAQ | The no-resale clause ("you may not resell this data directly, even in converted form") adds a restriction the MIT repo cannot pass on, so the files would need their own notice. Not recommended |

Preview images in `.shots/` stay local (the folder is in `.gitignore`). Do not commit them: they are the sources' own
renders, which are not always under the asset's licence.

## Recommendation

1. **Approve Microsoft Rocketbox first: the avatars subset and the clip subset below.** It is the only free set that
   gives realistic, clothed, varied adults and the needed everyday clips on **one skeleton with no retargeting**. It
   has built-in crowd LODs (5k / 2.5k / 500 tris). It should replace "Quaternius UBC + UAL now" in plan 16 for S1
   (200 pedestrians, stand-in NPC), S3 (walk, jog, run, turn) and S4 (sit, çay, talk, phone). The web budget allows
   about 24–32 looks on first visit (est. 25–45 MB); desktop can use all of them.
2. **Approve MPFB2's CC0 core next, for S4–S5 hero NPCs and the player.** That means the system assets, Skins 01/02,
   Suits/Shirts/Pants/Skirts/Dress/Shoes 01, Glasses 01, Hats 01, Bodyparts 05 and the CC0 hijab. It adds the elderly,
   heavier builds, headscarves and faces close to Istanbul that Rocketbox lacks. It costs one Blender retarget of the
   Rocketbox clips onto the MPFB `game_engine` rig. Add the CC-BY packs (Hair 02, Shirts 02, Pants 02, Shoes 02) only
   if the S2 renders show the CC0 wardrobe is too plain. Every CC-BY asset used needs its author credited. Leave out
  `toigo_maga_hat`, `punkduck_deathnote_t-shirt` and `punkduck_kill_bill_shoes` (third-party trademarks, see §1).
3. **Optional: a 100STYLE subset for gait variety** (Old, WalkingStick, ArmsBehindBack, HandsInPockets, OnPhone,
   Rushed, Heavyset). It is CC BY 4.0 with one credit line and needs a retarget. It is worth it because an old man
   walking with hands behind his back is a Kadıköy staple that no other source has.
4. **Optional: Quaternius UAL1/UAL2 free clips as gap fillers** (Jog_Fwd, Sprint, Sitting_Talking,
   Idle_Talking_Phone, Consume, Walk_Carry). They are CC0 but need a retarget, and Rocketbox already covers almost all
   of these.
5. **Do not approve now:**
   - Quaternius Universal Base Characters, for the reasons above.
   - CMU, which adds little over Rocketbox and has a custom no-resale clause that needs its own notice.
   - Renderpeople-on-Sketchfab, whose licence is unclear.

Attribution to record on integration:

- **Rocketbox:** in `public/models/LICENSES.md`, "Microsoft Rocketbox Avatar Library
  (https://github.com/microsoft/Microsoft-Rocketbox), Copyright (c) 2020 Microsoft, MIT License", followed by the full
  MIT text. Note the changes made (glTF conversion, texture resize).
- **MPFB CC0:** no attribution needed; list the source anyway.
- **MPFB CC-BY:** one line per asset: "<asset> by <author>, MakeHuman Community asset repository, CC BY
  (https://creativecommons.org/licenses/by/2.5/se/deed.en)", plus a note of the changes. The pack tables say only
  "CC-BY"; the FAQ's "full text" link is CC BY 2.5 SE, so cite that.
- **100STYLE:** "The 100STYLE Dataset - Ian Mason" (the credit the dataset page asks for), then "by Ian Mason,
  Sebastian Starke and Taku Komura (https://zenodo.org/records/8127870), CC BY 4.0
  (https://creativecommons.org/licenses/by/4.0/)", plus a note of the retarget.

## Approve?

- [ ] **Rocketbox avatars, crowd subset (~55–60 looks):**
  - `Female_Adult_01–15`, `Female_Adult_17`, `Female_Party_01/02`, and `Female_Adult_10` optional.
  - `Male_Adult_01–14`, `Male_Adult_16–18`, `Male_Adult_20`, and `Male_Adult_15/19/21` optional as tourists.
  - `Business_Female_01–04`, `Business_Male_01–07`, `Chef_Female_01`, `Delivery_Male_01`, `Gardener_Male_01`,
    `Wood_Male_01`.
  - 3 of `Construction_*`, `Sports_Female_02`, `Sports_Male_04`, 2 of `Medical_*`.
  - Uniformed professions, swimwear and football-kit sports looks, and children are excluded.
- [ ] **Rocketbox clips (m_ and f_):**
  - Idle and walk: `idle_neutral_*`, `idle_look_around_*`, `idle_waiting_*`, `walk_neutral*`, `walk_slow_*`,
    `walk_fast_*`, `walk_stroll_*`, `walk_start/stop`.
  - Run and turn: `run_slow_*`, `run_neutral*`, `run_start/stop`, `walk_to_run`, `run_to_walk`, `turn_*`.
  - Sitting: `sit_down_*`, `sit_stand_up_*`, `sit_chair_idle_*`, `sit_table_idle_*`, `sit_*_gestic_*`.
  - Talking: `gestic_talk_*`, `gestic_listen_*`, `gestic_shrug_*`, `gestic_laugh_*`.
  - Props and door: `drink_*`, `cell_phone_*`, `try_door_*`, `knock_door`, `hold_bag_*`, `umbrella_*`,
    `newspaper_*`, `wave_*`, `invite_sit`.
- [ ] MPFB2 CC0 core packs and the CC0 hijab, for hero NPCs and the player (S4–S5). Excludes `toigo_maga_hat`;
      community skins only after a source check.
- [ ] Optional: MPFB2 CC-BY packs Hair 02, Shirts 02, Pants 02 and Shoes 02, decided after the S2 renders. Excludes
      `punkduck_deathnote_t-shirt` and `punkduck_kill_bill_shoes`.
- [ ] Optional: the 100STYLE gait subset.
- [ ] Optional: Quaternius UAL1/UAL2 free clips.
- [ ] Confirm the plan change: plan 16 replaces "Quaternius UBC + UAL now" with Rocketbox, and Quaternius UBC is
      declined.
