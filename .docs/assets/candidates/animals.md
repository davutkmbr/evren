# Animal candidates (pending approval)

Status: **shortlist only, nothing is approved.** Nothing was bought, installed or downloaded (apart from the listings'
own thumbnails), added to `private-assets/` or `public/`, or referenced in code. Checked live on 2026-09-24.

Need ([kadikoy-soul.md](../../street/kadikoy-soul.md), "External assets needed" 1–5): realistic, rigged and animated
animals for the walkable Kadıköy street, seen at 1–3 m (cats, dogs) and 2–5 m (birds). The runtime is not decided
yet (three.js WebGPU, Godot 4.7 or Unreal 5.8), so every pick must work as FBX or glTF with skeletal animation.
Unreal-only packs are marked **UE-only**.

1. **Street cat** (priority): coats tabby, black-and-white, ginger, calico, white, grey; a kitten; LOD0 10–15k tris;
   clips sit, loaf, curled sleep, side sleep, groom, walk, trot, run, jump 0.5–1 m, eat, drink, stretch, rub, pounce,
   flinch.
2. **Large street dog** (Karabaş type; tan, black-masked, blond): side sleep, sphinx, get up, stretch, walk, trot,
   sniff, scratch, bark, yawn.
3. **Yellow-legged gull** (adult + brown juvenile): stand, walk, peck, long call, take-off, flap, glide, hang, land.
4. **Feral pigeon** (flocks of ~40): head-bob walk, peck, burst take-off, flap, land.
5. **Hooded crow** (optional): hop, peck, take-off, perched call.

## Read this first

- **No free asset reaches the realism bar for any of the five animals.** The best free cat is a single-clip
  CC-BY model at realism 2 of 5. Free realistic animated animals on Sketchfab, Fab, itch.io and OpenGameArt are
  either stylised, rigged with one or two clips, non-commercial, or ripped from commercial games.
- **Paid packs do reach it, and cheaply.**
  - One seller, Radik Bilalov on Fab, covers the cat (20 looks), the kitten and the dog. All three ship FBX and
    Blend files, 12–15k-tri LOD0 with four LODs, alpha fur cards and 100+ clips, from $29.99 each.
  - holylights01 (Fab) covers the rock pigeon and the hooded crow as the exact species, with 34 clips and FBX/Blend.
  - The gull is the weakest: no pack sells a yellow-legged gull, a brown juvenile or a long-call clip.
- **Recommended set: about $250** (Personal tier) for cat, kitten, dog, gull and pigeon, or about $410 with the
  hooded crow. See [Recommendation and cost](#recommendation-and-cost).
- **Every pick leaves a few clips to author:**
  - cat: stretch and rub;
  - dog: sniff, yawn and stretch;
  - gull: long call and hover, plus a juvenile texture.
- **The asset rule blocks paid assets today.** CLAUDE.md allows only free assets. Buying any pack below needs an
  explicit exception from the user. Paid Fab assets would then follow the MetaHuman handling: Fab Standard License,
  kept in `private-assets/`, shipped only inside builds (see [Licence notes](#licence-notes)).

## How this list was built

- **Sources checked live:** Fab search and listing data (licence tiers and prices, formats, per-format technical
  details and file lists), read through a reader proxy because fab.com sits behind a bot check; the Sketchfab v3 API
  (search filtered to downloadable, animated, CC-BY/CC0; model licence, author, counts); gim.studio (Animalia clip
  lists); Quaternius and poly.pizza pack pages; Truebones' Gumroad page; the Fab EULA; Unity's Asset Store licence
  statements; CGTrader and TurboSquid search results.
- **Licence rule for the free tier:** CC0 or CC-BY (attribution recorded). Excluded: NC, ND, editorial,
  personal-use-only, unclear licences and game rips.
- **Realism** is my 1–5 judgement of the source's own preview at the stated distance (1 = toy/cartoon, 3 = good
  mobile game, 4 = current PC game, 5 = film). Nothing was rendered in our engine.
- **"not stated"** means the listing gives no number. **"(est.)"** marks my estimates.
- **Previews** are each listing's own thumbnail, saved under `.shots/assets/animals/`.
  `cat-fab-radik-cats-pack-coats.jpg` is a contact sheet of that listing's own gallery images.

## Licence notes

**Fab Standard License** ([EULA](https://www.fab.com/eula), last updated 2024-10-01). Applies to every paid Fab row.

| Question | Answer | Source line |
|---|---|---|
| Any engine (three.js, Godot)? | **Yes**, unless the listing is marked UE-only or ships only `.uasset` files. | Fab docs: "The Fab Standard License enables you to use the assets … in any game engine or tool you want" (quoted in [metahuman-outfits.md](metahuman-outfits.md)). |
| Ship inside the game? | Yes. | §4(c): "you may Distribute software applications (such as video games) that include Content to the general public". |
| Extraction | Must be restricted. | §4(c): "you must restrict end users from extracting or otherwise using Content outside of the Project". |
| Raw files in the public MIT repo? | **No.** | §5(a): "you may not Distribute Content on a standalone basis to third parties". |
| Personal vs Professional tier | Personal is enough while the buyer has earned ≤ $100k in the last 12 months; Professional costs 2–3× more. | §2(a): eligible for Personal only if you "have not generated more than $100,000 USD in gross revenue … in the last 12 months". |
| AI | Most listings here are tagged NoAI (no generative-AI training). | Listing flag `isAiForbidden`. |

**Web-build condition** (same as MetaHuman/Mixamo in [private-assets.md](../private-assets.md)): a three.js build
serves files over HTTP, so extraction cannot be fully prevented. It needs a packed or obfuscated container instead of
browsable `.glb` URLs and a no-extraction clause in the game's terms. Residual risk, not a blocker.

**CC-BY on Sketchfab and Fab:** free to use and redistribute, including in `public/`, with the credit line recorded
in `public/models/LICENSES.md`.

**Unity Asset Store:** Unity's licence lets non-"Restricted" assets be used outside Unity (Unity support article,
summarised by [gamefromscratch](https://gamefromscratch.com/using-asset-store-assets-in-other-engines-is-it-legal/)).
Packs shipped only as `.unitypackage` still have to be exported to FBX by hand.

---

## 1. Street cat (priority)

### Free

| Name | Source | Licence | Author | Formats | Rig / clips | Tris | Textures | Fur | Realism (1–3 m) | Engine limits | Preview |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Bicolor Cat | [Sketchfab](https://sketchfab.com/3d-models/bicolor-cat-e623a618ca344a8393d7ba4d63ec23cf) | **CC-BY 4.0** ("Author must be credited. Commercial use is allowed.") | kenchoo, a rebuild of "Fripouille" by guillaume bolis (CC-BY): credit both | Sketchfab download (glTF, plus the original upload) | rigged, **1 clip** (not named) | 8,646 | not stated | texture only | **2**: correct anatomy, flat fur | none | [cat-sketchfab-kenchoo-bicolor.jpg](../../../.shots/assets/animals/cat-sketchfab-kenchoo-bicolor.jpg) |
| Cat v1.0 (black) | [Sketchfab](https://sketchfab.com/3d-models/cat-v10-7239efeec7104dc3af46a8842a66aec0) | **CC-BY 4.0** | rhcreations | Sketchfab download (Blender 2.79 source) | rigged, 1 clip | 37,140 | not stated | texture only | 2 | none | [cat-sketchfab-rhcreations-black-cat.jpg](../../../.shots/assets/animals/cat-sketchfab-rhcreations-black-cat.jpg) |
| Somali Cat Animated 1.2 | [Sketchfab](https://sketchfab.com/3d-models/somali-cat-animated-ver-12-e185c3fd92b64c32b4515a32b29252fc) | **CC-BY 4.0** | DreamNoms | Sketchfab download (Blender) | idle, walk, sit, sit down, stand up | 7,632 | hand-painted | painted | 1: cartoon | none | [cat-sketchfab-dreamnoms-somali.jpg](../../../.shots/assets/animals/cat-sketchfab-dreamnoms-somali.jpg) |
| Animal - Cat, Free Bundle | [Fab](https://www.fab.com/listings/bb864687-9852-4c54-a160-4cb28ce3e2ea) | Fab Standard: Personal **$0**, Professional $5.99 | CocainClub (listing flagged **AI-generated**) | **UE-only** (`.uasset`) | 10 in-place clips + locomotion BP, 10 coats | 30k verts, no LODs | 2048² | texture only | 2–3 | UE-only; no FBX | [cat-fab-cocainclub-free-bundle.jpg](../../../.shots/assets/animals/cat-fab-cocainclub-free-bundle.jpg) |

Rejected free cats:

- *An Animated Cat* (Evil_Katz), *Cat [Murdered: Soul Suspect]* (mark2580), *Animated cat* (Huh1_): the same
  7,372-tri mesh ripped from a commercial game; the CC-BY label is not valid.
- *Demo Lazy Cat* (Pocolov, Fab, CC-BY): cartoon and not rigged. *Toon Cat FREE*, *Cute Little Kitty*, *Cartoon
  Cat* and similar: stylised.
- **Quaternius:** the [Ultimate Animated Animal Pack](https://quaternius.com/packs/ultimateanimatedanimals.html)
  (CC0) has 12 animals (Alpaca, Bull, Cow, Deer, Donkey, Fox, Horse ×2, Husky, Shiba Inu, Stag, Wolf) and no cat.
  The older LowPoly Animated Animals pack is low-poly and stylised (realism 1).
- **Truebones Free Zoo** ([Gumroad](https://truebones.gumroad.com/p/free-truebones-zoo-over-75-animated-animals-with-textures-in-fbx-format)):
  the page calls it "100% ROYALTY FREE License! (DO NOT RESELL)" and "REDISTRIBUTION or RESALE … STRICTLY FORBIDDEN",
  with no written licence and no animal list. The models are dated and low-poly. Private store at best, so not listed.
- **Poly Haven and ambientCG:** no rigged animals.

### Paid

| Name | Source | Price (Personal / Professional) | Licence | Seller | Formats | Rig / clips | Tris | Textures | Fur | Realism (1–3 m) | Engine limits | Preview |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Cats Pack** | [Fab](https://www.fab.com/listings/43c831f0-fc9f-499d-8d53-9596047dbb5e) | **$59.99** / $179.99 | Fab Standard | Radik Bilalov (5.0, 6 ratings) | UE 5.1–5.7, **FBX, Blend**, OBJ (Fab's glTF/USDZ files are converted from the static OBJ, without the rig) | one 50-bone skeleton for all bodies; 175 clips in UE, 123 tracks in the FBX (see below) | 12,000 LOD0 + 4 LODs; 2,500 mobile mesh | 2048² albedo with alpha, ORM, normal; 512² low-poly set | **alpha fur cards** (a no-alpha mesh is included too) | **4** | none | [cat-fab-radik-cats-pack.jpg](../../../.shots/assets/animals/cat-fab-radik-cats-pack.jpg), [coats](../../../.shots/assets/animals/cat-fab-radik-cats-pack-coats.jpg) |
| Kitten - Simple (add-on) | [Fab](https://www.fab.com/listings/5c8fcb26-1e15-480d-8aab-36a018a26df5) | **$29.99** / $90.99 | Fab Standard | Radik Bilalov | UE, FBX, Blend, OBJ | 50 bones (same rig as the adults, est.), 100+ clips, same list as the adults | 11,200 + 4 LODs; 2,100 mobile | **4096²** | alpha fur cards | 4 | none | [cat-fab-radik-kitten-simple.jpg](../../../.shots/assets/animals/cat-fab-radik-kitten-simple.jpg) |
| AnimX: Advanced Cats | [Fab](https://www.fab.com/listings/7b57ab44-9bc9-4564-879d-f99f42ddff67) | $139.99 / $324.99 | Fab Standard | Indie Cat (4.45, 20 ratings) | UE 4.26–5.8 complete project, **Blender 3.2 file** with rig, all clips and textures (753 MB) | 90 root-motion clips; AnimX controller (UE Blueprint); low-poly version | not stated; with-fur model (6 LODs), without-fur model (5 LODs) | 41 textures, all 4K | fur mesh (cards or shells, not stated) | **4** | the controller is UE-only; mesh and clips go anywhere through the .blend | [cat-fab-animx-advanced-cats.jpg](../../../.shots/assets/animals/cat-fab-animx-advanced-cats.jpg) |
| Animalia - Domestic Cat | [Fab](https://www.fab.com/listings/f2e3ef1b-bc1d-4dd4-9638-e72b1a29241b), [clip list](https://gim.studio/cat/) | $89.99 / $179.99 | Fab Standard | GiM (5.0, 3 ratings) | **UE and Unity only** on Fab. GiM says FBX/PNG data come only with the commercial licence of its PRO version, sold outside Fab | 110 clips at 60 fps, with and without root motion; Maya and 3ds Max rigs | 8,907 verts, LODs | 4K | **gFur shells** (free UE plugin); texture only elsewhere | 4 in UE with gFur, 3 without | FBX needs export from UE, or the PRO licence | [cat-fab-gim-animalia-cat.jpg](../../../.shots/assets/animals/cat-fab-gim-animalia-cat.jpg) |
| Milo the Cat (Realistic) | [Fab](https://www.fab.com/listings/5cc9995e-fe74-4955-8ea1-83da2c17b47f) | $99.99 / $199.99 | Fab Standard | MalberS Animations (4.4, 5 ratings) | UE 5.2–5.8, Unity 6, **3ds Max source** (457 MB) | 287 clips; 19 blend shapes plus scalable bones (a kitten is a shape preset; the seller says "the anatomy is not 100% accurate") | 46,776 with fur, 27,488 without; auto LODs | up to 4K; 72 skin sets | fur-card shell mesh | **3**: large, stylised eyes | FBX needs export from 3ds Max | [cat-fab-malbers-milo.jpg](../../../.shots/assets/animals/cat-fab-malbers-milo.jpg) |
| 8 Cats Pack + Animations (budget) | [Fab](https://www.fab.com/listings/194ab6ac-dfcd-47da-a200-e0911ba7ed34) | **$16.99** / $40.99 | Fab Standard | KasitStudio (5.0, 1 rating; its single *Orange Cat* listing is rated 2.33 by 6) | FBX, Blend, Unity | 24 clips: sleeping on side, on belly, on back, rolling in sleep, licking, scratching, eating, drinking, jump, run, idle, idle seated, sitting on belly, stand up, meow, angry … | not stated | not stated | cards (visible in preview) | 3 | none | [cat-fab-kasit-8-cats-pack.jpg](../../../.shots/assets/animals/cat-fab-kasit-8-cats-pack.jpg) |

Radik Bilalov's clip list (Cats Pack, Strays and Kitten share it): idle 1–7, sitting idle 1–3, lie 1–2, lie belly 1–3
(loaf), sleep, sleep belly, licking (groom), scratch ear, scratch the carpet, eat, drink, walk (6 directions), trot,
run, run fast, crouch move (stalk), turn and turn 180, a 15-stage jump (start, fly up, fly down high and low, land,
edge fall, hook and climb), attack series (pounce), hit front/back/middle (flinch), combat, swim, death. Start, loop and
end are authored for eat, sleep and lie. Accessories: collars, bowls, cat house, carrier, scratching post, tray.

Coats in the Cats Pack gallery: black, white, black-and-white (tuxedo and bicolour), ginger, brown tabby, grey tabby,
tortoiseshell/calico and grey. The listing says "4 variants of cats - a thin cat, a stray cat, an ordinary cat and a
fat cat. Each geometry option has 5 types of color" (20 looks). *Cats - Strays* ($29.99, thin and shabby bodies,
[preview](../../../.shots/assets/animals/cat-fab-radik-cats-strays.jpg)) and
*Cats - Simple* ($29.99) are subsets of the pack.

Also seen and not shortlisted: *Next Gen Cat / Cats* (AnimalDev, $69.99, UE-only, no ratings); the TurboSquid
*Cat Tuxedo* and *Gray Tabby Rigged Animated* (fur made with Blender's hair system, which does not export to real-time
engines); CGTrader *Realistic Cat Rigged* ($4, a rig with no clips).

### Cat: gaps and recommendation

- **Free:** nothing usable beyond a placeholder. Keep the procedural placeholder cats. Bicolor Cat (CC-BY) is the only
  free realistic-ish mesh, and it has one clip.
- **Paid, recommended:** **Radik Bilalov Cats Pack ($59.99) + Kitten - Simple ($29.99) = $89.98** (Personal tier).
  - It covers all six coats, including calico, and four body types on one 50-bone skeleton.
  - It has 12k-tri LOD0 with four LODs (the brief asks for 10–15k), FBX and Blend sources, and authored
    start/loop/end transitions.
  - It covers 12 of the 15 wanted clips.
  - **Missing:** stretch and rub against legs. Curled sleep and side sleep map only roughly onto "sleep" and
    "sleep belly". These three clips must be keyed in Blender on the same rig (about 1–2 days, est.).
  - **Not included:** an ear-tip notch. It needs a small mesh or alpha edit per ear.
- **Paid fallback:** AnimX Advanced Cats ($139.99). It has 4K textures, a separate fur mesh and 90 clips, and its
  Blender file keeps the pack engine-neutral. It is the better buy only if the runtime is Unreal, where its
  controller saves work.

---

## 2. Large street dog (Karabaş type)

### Free

| Name | Source | Licence | Author | Formats | Rig / clips | Tris | Textures | Fur | Realism (1–3 m) | Missing clips | Preview |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Labrador Dog | [Sketchfab](https://sketchfab.com/3d-models/1f56cfbab07e4fe49b5d9e521c82073a) | **CC-BY 4.0** | kenchoo, built on "Dog" by all of life (credit both) | Sketchfab download (glTF) | rigged, 1 clip (idle) | 52,772 | not stated | texture only | 3: right blond short-coat body | all 10 | [dog-sketchfab-kenchoo-labrador.jpg](../../../.shots/assets/animals/dog-sketchfab-kenchoo-labrador.jpg) |
| German Shepherd 3D Dog Model | [Fab](https://www.fab.com/listings/5ffcabde-3356-4d75-b98e-580825f15e47) | Fab Standard, $0 in both tiers | RetroStyle Games | FBX, UE, Unity | 8 clips: idle breathing, idle playing, run, run lean L/R, walk, walk turn L/R | 2,272 | 2K PBR | texture only | 2.5 | all except walk | [dog-fab-retrostyle-german-shepherd.jpg](../../../.shots/assets/animals/dog-fab-retrostyle-german-shepherd.jpg) |
| PitBull | [Sketchfab](https://sketchfab.com/3d-models/2be37d5b9f754ed4bcc2d8f41b23a1d7) | **CC-BY 4.0** | Joseph.AD | glTF | 8 clips, not named (tagged "bark") | 12,894 | not stated | texture only | 2 | most (not verifiable) | [dog-sketchfab-josephad-pitbull.jpg](../../../.shots/assets/animals/dog-sketchfab-josephad-pitbull.jpg) |
| Ultimate Animated Animals (Husky, Shiba Inu, Wolf) | [Quaternius](https://quaternius.com/packs/ultimateanimatedanimals.html) | **CC0** | Quaternius | FBX, glTF, OBJ, Blend | 12+ clips each (attack, death, gallop, walk, jump …) | low poly | flat colour | none | 1: stylised | all except walk | [dog-quaternius-ultimate-animals.jpg](../../../.shots/assets/animals/dog-quaternius-ultimate-animals.jpg) |

Also checked: *white shepherd dog* (artwido2, CC-BY, 104k tris, 1 clip,
[preview](../../../.shots/assets/animals/dog-sketchfab-artwido2-white-shepherd.jpg)); *Animated Wolf* (igor-lir, CC-BY,
27k tris, 1 standing clip, [preview](../../../.shots/assets/animals/dog-sketchfab-igorlir-wolf.jpg)).

Rejected free dogs:

- *Labrador dog no description (serioulsy)* (107 clips, labelled CC-BY): tagged "cotw", so almost certainly ripped
  from theHunter: Call of the Wild.
- HL2 dog rigs: ripped from Half-Life 2.
- *kangal köpek* (emrekama714) and *Anatolian Shepherd & Kangal Hybrid* (JahnStar): CC-BY but static, no rig.
- *Stylized Anatolian Shepherd* (Fab, $2.99): AI-generated, no animation tracks.
- 3DCreator3527's Kangal and Caucasian Shepherd: print models without a rig. Tashi59's *Street Dog*: no rig or
  textures.

### Paid

| Name | Source | Price (Personal / Professional) | Seller | Formats | Rig / clips | Tris | Textures | Fur | Realism (1–3 m) | Missing clips | Preview |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Dog - Labrador** (same rig and clips: [Shepherd](https://www.fab.com/listings/0fce1bc8-ac63-4c5f-9ba4-d7b6e1470ffd), [Great Dane](https://www.fab.com/listings/227a85d2-4db2-4cf4-8c42-29aea1287f8a), [Dogs Big Pack](https://www.fab.com/listings/84176747-6d44-4a4f-9939-4c96b3911072) $99.99) | [Fab](https://www.fab.com/listings/b9c1424d-f5c1-40b5-9a19-cb3813704c54) | **$29.99** / $89.99 | Radik Bilalov (5.0, 2 ratings) | UE, **FBX** (111 tracks), **Blend** (112), OBJ | 57 bones; 157 clips in UE: lie 1–2, lie belly 1–2 (sphinx), sleep, sleep belly (start/loop/end, which gives get up), walk and trot in 3 directions, bark, scratch ear, dig, eat, eat tear, drink, idle 1–7, sit, 15-stage jump, attack, hit | 14,600 + 4 LODs; 2,900 mobile | 2K | **alpha fur cards** (a no-alpha mesh is included) | 3.5 | stretch, sniff, yawn | [dog-fab-radik-shepherd.jpg](../../../.shots/assets/animals/dog-fab-radik-shepherd.jpg) |
| **Kangal Shepherd Dog** | [Fab](https://www.fab.com/listings/920dc3b1-2344-4f9c-a907-796bbe8ed2ee), [CGTrader](https://www.cgtrader.com/3d-models/animal/mammal/kangal-shepherd-dog-e69e29e6-6c16-4522-bd4f-e04150ab6eae) | **$39.99** / $59.99 on Fab; CGTrader $15 on sale ($50 list, "Royalty Free License (no AI)") | Nyi Nyi Tun (no ratings) | Blend, FBX, **native glTF/GLB** (34 tracks), USD(Z), OBJ | 34 clips at 30 fps: attack ×7, bark, dead, die ×2, eat, hit, idle A/B/C, jump, run (4 directions), sit sideways, sit up, sitting, swim ×5, walk (4 directions) | 29,479 | 4K PBR | texture only | 3: **the only breed-correct look** (cream coat, black mask) | side sleep ("dead" at most), sphinx, get up, stretch, trot, sniff, scratch, yawn | [dog-fab-nyinyitun-kangal.jpg](../../../.shots/assets/animals/dog-fab-nyinyitun-kangal.jpg) |
| AnimX: German Shepherd | [Fab](https://www.fab.com/listings/a284ef72-e7b9-441e-9ac4-2669f0c6d027) | $119.99 / $274.99 | Indie Cat (3.67, 12 ratings) | UE project + Blender 3.2 file (rig, clips, textures) | 68 root-motion clips (names only in screenshots) | fur mesh 460k → 3.1k, no-fur mesh 157k → 3.1k | 4K | fur geometry | 4 | not verified | [dog-fab-animx-german-shepherd.jpg](../../../.shots/assets/animals/dog-fab-animx-german-shepherd.jpg) |
| Animalia - German Shepherd | [Fab](https://www.fab.com/listings/f4d98a0f-6a16-49d9-ab3b-54c453a7d965) | $89.99 / $179.99 | GiM | **UE and Unity only** (FBX only with GiM's PRO commercial data) | 99 clips at 60 fps: lying 00–02, sleeping, lying↔sleeping transitions, walk, trot, sitting, stand | 16,871 verts | 4K | gFur shells (UE only) | 4 in UE | sniff, scratch, bark, yawn, stretch | [dog-fab-gim-german-shepherd.jpg](../../../.shots/assets/animals/dog-fab-gim-german-shepherd.jpg) |
| Dog - Husky Realistic Animated | [Fab](https://www.fab.com/listings/276db528-fb19-47dd-b401-3e5d2b86fba0) | $40.99 / $72.99 | Kiwi.cg | FBX, Maya | 26 clips incl. drink, trot, walk, sit, jump, howl, dig, **stretching**, dead | 46k body mesh (334k total) | 4K | hair cards | 4, but a long-coated husky | sphinx, get up, sniff, scratch, bark, yawn | [dog-fab-kiwicg-husky.jpg](../../../.shots/assets/animals/dog-fab-kiwicg-husky.jpg) |

UE-only and not tabled: AnimalDev *Next Gen Dogs* ($69.99, ~200k verts with fur), Nyi Nyi Tun *Dog Character and
Animation Pack* ($49.99, 20 breeds, 44 clips, Unreal files only). Unity: 4toon *Dog Pack* ($60, includes a Tatra
Sheepdog with 40 clips; realism about 2; no preview saved).

### Dog: gaps and recommendation

- **Free:** nothing usable beyond locomotion tests. The RetroStyle German Shepherd ($0, FBX) is the only free one with
  more than one clip. Keep the dog behind a placeholder until one is bought (dogs are S5).
- **Paid, recommended:** **Radik Bilalov Dog - Labrador ($29.99)**, repainted into tan, black-masked and blond coats
  and scaled up about 10–15 % (est.).
  - It has the right short dense coat, fur cards, LODs and 7 of the 10 wanted clips, with authored lie and sleep
    transitions for "get up".
  - The Great Dane on the same rig is the choice if the Labrador reads too small.
  - **Missing:** sniff and yawn can be additive head/jaw layers on the idle. Stretch (play bow) must be keyed.
  - **Ear tag:** an attachment socket on the ear bone.
- **Look upgrade:** Nyi Nyi Tun's Kangal ($39.99, or $15 on CGTrader during the sale) is the only breed-correct
  model. Its clip set misses the resting behaviours, so it only pays off with Radik's lie and sleep clips
  retargeted onto it in Blender (different skeletons).

---

## 3. Yellow-legged gull

No listing sells *Larus michahellis*. The closest are generic "seagulls" (herring-gull look) and one common gull.

### Free

| Name | Source | Licence | Author | Formats | Rig / clips | Tris | Feathers | Realism (2–5 m) | Missing | Preview |
|---|---|---|---|---|---|---|---|---|---|---|
| Seagull | [Sketchfab](https://sketchfab.com/3d-models/dc42ffc81c86480e9e7f7752fa134174) (also free on Fab, CC-BY) | **CC-BY 4.0** | Dayvable | glTF/FBX; Blend on Fab | "basic bones only rig", 1 flight clip, made for flocks | 4,352 | texture | 2 | all ground clips, take-off, land, hover, call | [gull-sketchfab-dayvable-seagull.jpg](../../../.shots/assets/animals/gull-sketchfab-dayvable-seagull.jpg) |
| Ring-Billed Gull | [Sketchfab](https://sketchfab.com/3d-models/3df7913df7f34b90b152b05e12737c43) (plus a separate "in Flight" model) | **CC-BY 4.0** | OSU.Multimedia | glTF/FBX | 1 clip, rig not stated | 2,884 | texture | 2.5 | almost all | [gull-sketchfab-osu-ring-billed-gull.jpg](../../../.shots/assets/animals/gull-sketchfab-osu-ring-billed-gull.jpg) |

Rejected free gulls:

- kenchoo *Seagull* is CC-BY-NC-SA. teacherap123's *seagull* is a CC-BY re-upload with the same 5,624 tris.
- AnimalMesh3D, WildPoly3D and LostModels2025 gulls are NC. geminga's *Flying Seagull* is CC-BY-SA.
- The *Little Nightmares* gulls are game rips.

### Paid

| Name | Source | Price (Personal / Professional) | Formats | Rig / clips | Tris / textures | Feathers | Realism (2–5 m) | Limits / missing | Preview |
|---|---|---|---|---|---|---|---|---|---|
| **Seagull** | [Fab](https://www.fab.com/listings/529038be-1f0c-4af8-9acc-35f58b020f75) | **$29.99** / $89.99 | UE; FBX + Blend in extra files | 68 clips, in place and root motion: walk, run, fly, fly idle, fly fast, stand idle 1–3, eat, turn, attack, hit, death | 4 LODs 18,850 → 3,620; 2K | texture | 3 | take-off and land not named; "fly idle" may be the hover (est.); no call | [gull-fab-rifatbilalov-seagull.jpg](../../../.shots/assets/animals/gull-fab-rifatbilalov-seagull.jpg) |
| Seagull feathered | [Fab](https://www.fab.com/listings/60a1499a-0cb3-460e-bff2-f5bf7a2b5bb9) | $34.99 / $94.99 | same | same 68 clips | 25,000 → 10,500; 2K | feather cards (est.) | 3 | same gaps | [gull-fab-rifatbilalov-seagull-feathered.jpg](../../../.shots/assets/animals/gull-fab-rifatbilalov-seagull-feathered.jpg) |
| Common Gull | [Fab](https://www.fab.com/listings/57cf2996-bda2-452d-a448-846adb9dc076) | $42.99 / $64.99 | **FBX** | 24 clips; named: idle, flying, gliding, walk | 35,624, no LODs; 2K | feather cards (est.) | **4** | a smaller species (*Larus canus*); heavy; take-off, land, peck, call and hover not stated | [gull-fab-nestaeric-common-gull.jpg](../../../.shots/assets/animals/gull-fab-nestaeric-common-gull.jpg) |
| Seagull | [Fab](https://www.fab.com/listings/9b99a250-0137-4b0b-be43-5b11aec56f2c) | $19.99 / $19.99 | **UE-only** (`.uasset`) | 11 clips: idle, walk ×3, eat, takeoff, fly ×3, glide, landing | 7,482; 4K + 2K | feather textures | 3.5; closest yellow legs | Unreal only; no call or hover | [gull-fab-wdallgraphics-seagull.jpg](../../../.shots/assets/animals/gull-fab-wdallgraphics-seagull.jpg) |
| SEAGULL | [Fab](https://www.fab.com/listings/1143184a-e5f8-4a7c-bb43-ac0081b42c01) | $14.99 / $44.99 | UE + Unity package | 16 clips, not named; 40 bones | 2,640; 2K | texture | 3 | FBX must come out of the Unity package | [gull-fab-protofactor-seagull.jpg](../../../.shots/assets/animals/gull-fab-protofactor-seagull.jpg) |

Also seen: 3DRT *Seagull* ($18.99, 748 tris, 10 clips incl. take-off and land; realism 2; for distant flocks,
[preview](../../../.shots/assets/animals/gull-fab-3drt-seagull.jpg)); Massimo Righi *Seagull Animated* ($399.99,
Maya-only offline rig with modelled feathers, [preview](../../../.shots/assets/animals/gull-fab-massimorighi-seagull.jpg)).

### Gull: gaps and recommendation

- **Free:** nothing holds up at 2–5 m. Dayvable's CC-BY gull can stand in for distant flocks, next to the flight
  world's procedural gull.
- **Paid, recommended:** **RifatBilalov Seagull ($29.99)**. It is engine-neutral (FBX + Blend), has 68 clips and
  LODs down to 3.6k tris for the ferry swarm.
  - Repaint it for the yellow-legged look: yellow legs, a red gonys spot and a darker grey mantle.
  - Paint a brown mottled juvenile texture.
  - Key the long call (head thrown back) and a wind hang if "fly idle" is not one.
- **Close-up upgrade:** Nestaeric Common Gull ($42.99, realism 4). Use it only for the 3–5 perched bollard gulls,
  since it has no LODs.
- **If the runtime is Unreal:** WDallgraphics ($19.99) has the right clip set and yellow legs.

---

## 4. Feral pigeon

### Free

| Name | Source | Licence | Author | Rig / clips | Tris | Realism (2–5 m) | Notes | Preview |
|---|---|---|---|---|---|---|---|---|
| **Animated Pigeon - Rigged & Optimized** | [Sketchfab](https://sketchfab.com/3d-models/6cdb9b2f5f784d8f9abc92e4c132f116) | **CC-BY 4.0** (API, checked 2026-09-24) | GAMICO | 17 clips; the text mentions flight, walking and idle | 1,284 | 3 | Published today, and its text promotes a Fab listing. Save the licence page with the download. Head bob not confirmed | [pigeon-sketchfab-gamico-pigeon.jpg](../../../.shots/assets/animals/pigeon-sketchfab-gamico-pigeon.jpg) |
| Pigeon | [Sketchfab](https://sketchfab.com/3d-models/ddd5ef4a94eb4159937a9de25c45697c) | **CC-BY 4.0**; derived from "Pigeon #1" (CC-BY), so credit both | kenchoo | 1 simple clip | 6,928 | 3 | nearly every clip missing | [pigeon-sketchfab-kenchoo-pigeon.jpg](../../../.shots/assets/animals/pigeon-sketchfab-kenchoo-pigeon.jpg) |
| Animated Bird, Pigeon | [Sketchfab](https://sketchfab.com/3d-models/797d27b68af3453e865149435df6aa30) | **CC-BY 4.0** (author calls it public domain) | dudecon | glide, flap, ground idle, takeoff, landing | 710 | 1.5 | no walk or peck | [pigeon-sketchfab-dudecon-pigeon.jpg](../../../.shots/assets/animals/pigeon-sketchfab-dudecon-pigeon.jpg) |

Rejected: AnimalMesh3D *Pigeon Stylized* (NC) and *Animated Pigeon* (badge CC-BY, but the text says "personal use
only"); LostModels2025 and Nyilonelycompany pigeons (NC); Nyi Nyi Tun *Gascogne Pigeon Free* (no rig).

### Paid

| Name | Source | Price (Personal / Professional) | Formats | Rig / clips | Tris / textures | Realism (2–5 m) | Limits | Preview |
|---|---|---|---|---|---|---|---|---|
| **Realistic Animated Rock Pigeon** | [Fab](https://www.fab.com/listings/9c41010e-deee-4823-a1db-04fd68187981) (also TurboSquid, $198) | **$99.99** / $149.99 | UE, Unity; extra files: **FBX**, DAE, Blend 3.3, Maya, Max, C4D | 34 clips at 30 fps: walking, running, startFlying, flying, gliding, soaring, descending, landing, start/eating/stop (peck), lookingAround, preening, goingToSleep, hit, falling … | LOD0 23,096 → LOD3 **1,752**; 4K PBR with alpha | **4** | head bob not stated; no ratings yet | [pigeon-fab-holylights-rock-pigeon.jpg](../../../.shots/assets/animals/pigeon-fab-holylights-rock-pigeon.jpg) |
| PIGEON | [Fab](https://www.fab.com/listings/809f191b-95f7-4f55-a96d-ccdd03263471) | **$14.99** / $44.99 | UE + Unity package | 17 clips, not named; 45 bones | 2,390; 2K | 3 | FBX from the Unity package | [pigeon-fab-protofactor-pigeon.jpg](../../../.shots/assets/animals/pigeon-fab-protofactor-pigeon.jpg) |
| Rock Dove | [Fab](https://www.fab.com/listings/e9c556c7-caa5-4e44-b256-d8f248bc217d) | $35.99 / $55.99 | FBX, **glTF/GLB**, Blend, USDZ, UE | 20 in-place clips, not named | 21,072, no LODs; 4K | 3.5 | no LODs, poor for a flock of 40 | [pigeon-fab-nyinyitun-rock-dove.jpg](../../../.shots/assets/animals/pigeon-fab-nyinyitun-rock-dove.jpg) |
| Pigeon Feathered | [Fab](https://www.fab.com/listings/5d196c75-86a6-4eb0-a1c1-8a116f533edf) | $39.99 / $119.99 | UE; FBX + Blend | 56 clips: idle 1–4, walk, run, eat 1–3, fly, fly start, landing, turn … | 17,200 → 8,100; 2K; 2 colours | 3.5 | lowest LOD 8.1k is heavy for 40 | [pigeon-fab-rifatbilalov-pigeon-feathered.jpg](../../../.shots/assets/animals/pigeon-fab-rifatbilalov-pigeon-feathered.jpg) |
| Realistic Pigeon & Animations | [Fab](https://www.fab.com/listings/c883d506-d0a6-40d8-bdee-dddcbf007935) | $39.99 / $94.99 | **UE-only** | 7 root-motion clips + flock Blueprint | 7 LODs, 13,418 → 788 verts; 4K | 4.5 | Unreal only | [pigeon-fab-lepotic-realistic-pigeon.jpg](../../../.shots/assets/animals/pigeon-fab-lepotic-realistic-pigeon.jpg) |

Also UE-only: WDallgraphics *Pigeon* ($19.99, 2,304 tris, 26 clips incl. preen and scratch,
[preview](../../../.shots/assets/animals/pigeon-fab-wdallgraphics-pigeon.jpg)).

### Pigeon: gaps and recommendation

- **Free:** **GAMICO pigeon (CC-BY)** is good enough to start with.
  - It has 1.3k tris and 17 clips, is realism 3 at 2–5 m, and is already the right size for a vertex-animation
    flock.
  - If approved, download it now: it was published today, and its text points to a paid Fab version.
- **Paid, recommended:** **holylights01 Rock Pigeon ($99.99).** It is the exact species with 34 clips and every
  exchange format, and it is the only one that is both close-up quality (23k LOD0) and flock-ready (1.75k LOD3,
  bakeable to a vertex-animation texture).
  - The head bob must be checked on the walk clip. If it is missing, add it procedurally: the existing Galata
    behaviour already drives the head.
- **Budget:** Protofactor ($14.99).

---

## 5. Hooded crow (optional)

| Name | Source | Price / licence | Formats | Clips | Tris / textures | Realism | Notes | Preview |
|---|---|---|---|---|---|---|---|---|
| Crow in **ANIMAL VARIETY PACK** (free) | [Fab](https://www.fab.com/listings/2dd7964c-a601-4264-a53d-465dcae1644c) | **$0 / $0**, Fab Standard (Epic's permanent free collection, Nov 2018) | **Unreal files only**; FBX via export from Unreal | 17, not named; 61 bones | 2,210; 2K | 3 | black crow; a grey body texture must be painted | [crow-fab-protofactor-animal-variety-pack.jpg](../../../.shots/assets/animals/crow-fab-protofactor-animal-variety-pack.jpg) |
| Crow (free) | [Sketchfab](https://sketchfab.com/3d-models/d5a9b0df4da3493688b63ce42c8a83e2) | **CC-BY 4.0**, Alexei Ostapenko | glTF/FBX | 1 | 2,208 | 3 | placeholder only | [crow-sketchfab-ostapenko-crow.jpg](../../../.shots/assets/animals/crow-sketchfab-ostapenko-crow.jpg) |
| **Realistic Animated Hooded Crow** | [Fab](https://www.fab.com/listings/6a270f23-0204-4d7b-85e7-cc65bed149d6) | **$159.99** / $239.99 (3.0, 1 rating) | UE, Unity, **FBX**, Blend, Maya, Max, C4D | 34: walking, hopping, jumping, startFlying, flying, gliding, landing, eating, cawing, lookingAround, preening … | 4 LODs, 36.7k → 2.26k polys; 4K PBR with alpha | 4 | **exact species; every wanted clip** | [crow-fab-holylights-hooded-crow.jpg](../../../.shots/assets/animals/crow-fab-holylights-hooded-crow.jpg) |
| Crow Feathered | [Fab](https://www.fab.com/listings/0ee6d1f7-40a4-4990-a14e-7ce8f15ed202) | $29.99 / $89.99 | UE; FBX + Blend | 56 (same set as the pigeon) | 20,700 → 8,300; "2 colors" (tagged grey) | 3.5 | whether the grey is hooded-crow grey is not confirmed | [crow-fab-rifatbilalov-crow-feathered.jpg](../../../.shots/assets/animals/crow-fab-rifatbilalov-crow-feathered.jpg) |
| Carrion Crow | [Fab](https://www.fab.com/listings/41e3e768-2ad1-4696-83c3-0ffc52eaba3d) | $35.99 / $49.99 | FBX, glTF/GLB, Blend, USDZ, UE | 28 in place, not named | 9,225 verts, no LODs; 4K | 3.5 | black; needs a grey body | [crow-fab-nyinyitun-carrion-crow.jpg](../../../.shots/assets/animals/crow-fab-nyinyitun-carrion-crow.jpg) |

Also saved: Nestaeric *American Crow* ($42.99, FBX/Blend/glTF, 27 clips, rated 3.25 by 4,
[preview](../../../.shots/assets/animals/crow-fab-nestaeric-american-crow.jpg)); Protofactor *CROW* ($14.99, the Variety
Pack crow with a Unity package, [preview](../../../.shots/assets/animals/crow-fab-protofactor-crow.jpg)); Lahcen.el
*Crow Ascend* (CC-BY, one flight clip, [preview](../../../.shots/assets/animals/crow-sketchfab-lahcen-crow-ascend.jpg)).
Rejected: *Hello Neighbor 2* and *Little Nightmares* crows (game rips); LostModels2025 *Crow Fly* (NC); Charlie
catling's crow (stylised, landing only).

**Crow recommendation:**

- **Free:** the Variety Pack crow ($0), repainted grey. It comes as Unreal files only: export it to FBX once in the
  UE 5.8 install. Doing this for use in another engine is allowed, because the Standard License has no engine
  clause.
- **Paid:** holylights01 Hooded Crow ($159.99). It is expensive for a "nice" item, so buy it only if crows become
  a feature.

### Multi-bird packs

- **Birds** (Living Systems, [Fab](https://www.fab.com/listings/c5b54173-3087-4060-9380-5f9c500c31ec)): $64.99 /
  $349.99, **UE-only**. Crow, pigeon and seagull; 87 clips with walk/hop/feed/fly/perch AI; 4K; LODs; 4.27 from 56
  ratings. The best single pack if the runtime is Unreal
  ([preview](../../../.shots/assets/animals/crow-fab-livingsystems-birds-pack.jpg)).
- **BIRDS PACK** (Protofactor, [Fab](https://www.fab.com/listings/0d26d643-46e7-48eb-8b38-9a9873068d29)): $54.99,
  Unreal files. Seven birds incl. crow, pigeon and seagull, realism 3. The three singles cost $44.97 and add Unity
  packages ([preview](../../../.shots/assets/animals/gull-fab-protofactor-birds-pack.jpg)).
- holylights01 sells pigeon, hooded crow, carrion crow, raven, wood pigeon and white dove on one 34-clip structure,
  but no gull.

---

## Recommendation and cost

Prices are for the Fab **Personal** tier (buyer at or under $100k revenue in the last 12 months). The Professional
column is what the same set costs above that line.

| Animal | Free pick (now) | Paid pick | Personal | Professional |
|---|---|---|---|---|
| Cat | procedural placeholder (Bicolor Cat, CC-BY, if a mesh is needed) | Radik Bilalov **Cats Pack** + **Kitten - Simple** | $89.98 | $270.98 |
| Dog | RetroStyle German Shepherd ($0) for locomotion tests | Radik Bilalov **Dog - Labrador** | $29.99 | $89.99 |
| Gull | Dayvable Seagull (CC-BY) for distant flocks | RifatBilalov **Seagull** | $29.99 | $89.99 |
| Pigeon | **GAMICO pigeon (CC-BY)** | holylights01 **Rock Pigeon** | $99.99 | $149.99 |
| **Core set** | | | **$249.95** | **$600.95** |
| Hooded crow (optional) | Animal Variety Pack crow ($0, Unreal files) | holylights01 **Hooded Crow** | +$159.99 | +$239.99 |
| Close-up gull (optional) | – | Nestaeric **Common Gull** | +$42.99 | +$64.99 |

- **Budget variant, $164.95:** Cats Pack + Kitten, Labrador, RifatBilalov Seagull, Protofactor Pigeon and the free
  Variety Pack crow ($14.99 buys the crow singly with a Unity package). The pigeon drops to realism 3.
- **If the runtime becomes Unreal:** consider Living Systems *Birds* ($64.99) in place of the gull and pigeon picks.
  Its flock AI replaces our own, but it locks the birds to Unreal.
- **What approval would mean:**
  - an exception to the free-only rule in CLAUDE.md;
  - the Fab assets stored in `private-assets/animals/` and recorded in [private-assets.md](../private-assets.md);
  - the CC-BY picks allowed in `public/models/` with their credits in `LICENSES.md`.

## Clips to author (all picks)

Each missing clip is keyed in Blender on the pack's own rig, or built as an additive layer at runtime. Estimates are
mine.

| Animal | Missing | Suggested fix |
|---|---|---|
| Cat | stretch, rub against legs, curled sleep | Key stretch and rub (about 1 day). Build curled sleep from "sleep" plus a tail-wrap pose. Look-at, tail sway and ear flicks run procedurally (the brief already asks for the chains). |
| Dog | sniff, yawn, stretch | Sniff and yawn as additive head/jaw layers on the idle; key the play-bow stretch (about 1 day). |
| Gull | long call, wind hang, brown juvenile | Key the long-call pose. Hang = "fly idle" or glide plus wing noise. Paint the juvenile texture. |
| Pigeon | head bob (unverified) | Check the walk clip; add procedural head-lock if it is missing. Flocks of 40: bake LOD3 to a vertex-animation texture. |
| Crow | none | – |

## What to expect per runtime

All picks except the Unreal-only rows are skinned FBX/Blend meshes with alpha-card fur or feathers. The same files
work in all three runtimes. How good the cards look depends mostly on the anti-aliasing of alpha-tested geometry.

| | Unreal 5.8 | Godot 4.7 | three.js WebGPU |
|---|---|---|---|
| Fur and feathers from these packs | Best. Alpha cards with TSR and Lumen look like the previews (realism 4). gFur (Animalia) and strand grooms work only here, and none of the recommended picks needs them. | Cards with Alpha Hash, or alpha antialiasing with MSAA. A bit noisier than in UE (about realism 3.5). No shell-fur add-on is maintained for Godot 4 ([ShellFurGodot](https://github.com/Arnklit/ShellFurGodot) is Godot 3), so shells would be our own shader. | Cards with `alphaHash` need [TRAA](https://threejs.org/docs/pages/TRAANode.html) to hide the noise, or `alphaToCoverage` with MSAA. About realism 3–3.5. Shells are possible in TSL, but at 4–8 cats on screen the cards are the cheaper path. |
| Clips and procedural layers | IK Retargeter for the Kangal option; Control Rig look-at; AnimDynamics tails; Anim to Texture for pigeon flocks. | AnimationTree; LookAtModifier3D and SpringBoneSimulator3D (4.4+) for head and tail; our own vertex-animation shader for the flock. | AnimationMixer; our own look-at and tail springs (as in the pigeon behaviour); instanced vertex-animation flock. |
| Licence handling | Packed `.pak`; no extra work. | Packed `.pck`; no extra work. | Needs an obfuscated container and a no-extraction clause (see [Licence notes](#licence-notes)). |

The cats and dogs are the only animals seen at 1 m. There the fur cards and the 2K textures on the Radik Bilalov models are the limit: whiskers and the fur silhouette hold up, but the fur shows no strand detail. The
Kitten's 4K maps and AnimX's 4K set are the upgrade path if close-ups disappoint.
