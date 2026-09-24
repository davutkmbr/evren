# MetaHuman outfit candidates (pending approval)

## Decision (2026-09-24)

Approved by the user:

- **Epic's free MetaHuman wardrobe on Fab** (§1): the 20 garment and shoe listings, Clothing Construction Presets
  (Set of 4, incl. the additional-files zip), and optionally the Crowd Sample, the Fashion Starter Kit and the free
  Epic grooms. Fab Standard License, Professional tier ($0); private store only (`private-assets/`), shipped only inside
  builds; no-extraction measures for any web build.
- **Six garments tailored by us** (§4): *başörtüsü* (headscarf, starting from MakeHuman's CC0 hijab), *pardesü*
  (long coat), apron, cardigan/vest, trousers and a midi skirt. Our own work, MIT.

Not approved: the third-party free listings (§2), the paid packs (§3) and City Sample Crowds (UE-only).
Click list for the user: `.shots/assets/metahuman-outfits/checklist.html` (local).


Status: **shortlist only, nothing is approved.** Nothing was installed, downloaded (apart from the listings' own
thumbnails), added to Unreal, `private-assets/` or `public/`, or referenced in code. Checked live on 2026-09-24.

Need: modern everyday clothing for a 200-person Kadıköy street crowd and café NPCs. The installed MetaHuman wardrobe
has one outfit (`WI_DefaultGarment`: T-shirt, shorts, barefoot). Hair is not the gap: UE 5.8.3 already ships 38 hair
grooms, 16 beards, 16 mustaches and 18 eyebrow grooms (`MetaHumanCharacter/Content/Optional/Grooms`).

Context: [humans-pipeline.md](../humans-pipeline.md), [private-assets.md](../private-assets.md),
`tools/unreal/metahumans/evren_metahumans.py`.

## Read this first

- **Epic gives away a full basic wardrobe on Fab, and it can be used outside Unreal.**
  - The set has 20 free parametric garment listings, 34 wardrobe items in total (the "MHC Web App to Parametric
    Clothing Set" plus the Techwear outfit): jeans, slim jeans (3 lengths), cargo pants, shorts, yoga pants,
    T-shirts (5 sleeve styles), tucked T-shirts (5), crop tops (4), a sweater, a hoodie, and 9 shoe styles.
  - Every item is under the **Fab Standard License**. That licence has no engine restriction. The one Epic crowd pack
    that *is* limited to Unreal (City Sample Crowds, "UE-Only Content") is rejected below.
- **The free set is young and casual.** Nothing free covers coats (trench, puffer, *pardesü*), jackets (denim,
  leather, bomber, blazer), cardigans, button shirts, tailored trousers, dresses, skirts, the *başörtüsü*, aprons,
  rubber boots, vests or flat caps. Free third-party listings add only a few usable pieces.
- **Recommendation:** approve the Epic set first, then tailor about six of our own basics for the gaps (§4). Paid packs
  fill the same gaps faster, but the asset rule does not allow them (§3).
- **Licence caveat:** Fab Standard content is a new *private asset* source. It may ship only inside builds, and players
  must be restricted from extracting it. This needs the same handling as MetaHuman and Mixamo, and a new row in
  `private-assets.md` when it is approved.

## How this list was built

- **Sources checked live:**
  - Fab's listing search and detail data (through a reader proxy, because fab.com sits behind a bot check), covering
    the Epic Games seller and all free listings in the MetaHuman channel's clothing category (58 listings);
  - keyword searches of the MetaHuman channel (hijab, apron, trench coat, puffer, flat cap, cardigan, blazer, leather
    jacket, dress, skirt, vest, barista, rubber boots and more);
  - the Fab EULA, the Fab licence docs, the MetaHuman licence FAQ and the UE EULA;
  - Epic's tailoring and parametric-clothing docs (5.7/5.8), and the UE 5.8.3 install for the scripting API.
- **Not shown on the listings:** Epic states no triangle counts or texture sizes for these garments, only "Includes 4
  body LODs" (matching the MetaHuman body LOD0–3) and recolourable materials. File size is shown only where noted.
  Numbers marked *est.* are mine.
- **Previews** are each listing's own thumbnail (640 px), saved under `.shots/assets/metahuman-outfits/`.
- **Parametric** means a Chaos Outfit asset that resizes to any MetaHuman body in MetaHuman Creator. **Fixed** means
  a skeletal mesh fitted to one body shape.

## Licence (applies to every Fab row below)

All candidates are offered under the Fab **Standard License** ([EULA](https://www.fab.com/eula), last updated
2024-10-01). The Epic items cost $0 in both the Personal and the Professional tier.

| Question | Answer | Source line |
|---|---|---|
| Can it be used in a game made with another engine (three.js, Godot)? | **Yes.** The Standard License has no engine clause. Only content marked "UE-Only" is limited to Unreal, and none of the recommended listings carries that mark. | Fab docs: "The Fab Standard License enables you to use the assets, including Megascans, in any game engine or tool you want." ([Licenses and Pricing](https://dev.epicgames.com/documentation/en-us/fab/licenses-and-pricing-in-fab)). Contrast: City Sample Crowds says "UE-Only Content - Licensed for Use Only with Unreal Engine-based Products". |
| Can exported meshes ship in a non-Unreal build? | **Yes, as part of the game only.** | EULA §4(c): "you may Distribute software applications (such as video games) that include Content to the general public", but "you must restrict end users from extracting or otherwise using Content outside of the Project". |
| Can the raw or converted files go in the public MIT repo? | **No.** | EULA §5(a): "you may not Distribute Content on a standalone basis to third parties". |
| Can it be converted to glTF? | Yes. | §3(a) allows you to "reproduce, display, perform, and modify the Content". §6(i) forbids you to "reverse engineer, decompile, translate…". I read "translate" there as applying to code, not to mesh format conversion. |
| Is combining with GPL code a problem? | Only for GPL code that ships with the content. Evren is MIT. Character DNA (GPLv3) is only a tool and does not ship in the build. | EULA §6(a) forbids combining Standard content with code under "GNU General Public License (GPL)". |
| AI | The Epic listings are tagged NoAI: the content may not be used to train generative AI. | EULA §16(l). |
| Tier | Pick **Professional** when acquiring (it is also $0), so the Personal tier's revenue limit never applies. | EULA §2(a): the Personal tier requires "not generated more than $100,000 USD in gross revenue". |

Also relevant: MetaHumans themselves are licensed through the UE EULA. The MetaHuman FAQ says it "provides for
MetaHuman characters and animation to be used across all engines and creative software"
([metahuman.com/license](https://www.metahuman.com/license)).

**Web-build condition:** a three.js build serves files over HTTP, so extraction cannot be fully prevented. Meeting
"restrict end users from extracting" needs:

- a packed or obfuscated runtime container instead of browsable `.glb` URLs;
- a no-extraction clause in the game's terms.

This is the same handling that `private-assets.md` already requires for MetaHuman and Mixamo. Flagged as a residual
risk, not a blocker.

---

## 1. Free: Epic Games (MetaHuman channel)

Common to every garment row: author **Epic Games**, price **Free**, licence **Fab Standard**, format `.mhpkg`,
**parametric**, 4 body LODs, recolourable in MetaHuman Creator, and a verdict of **ok-with-conditions** (see
[Licence](#licence-applies-to-every-fab-row-below)). The garments are separate items that combine with each other,
because MetaHuman Creator lets one character wear several items in the Outfits slot.

| Name | Link | Contents | Size / notes | Preview |
|---|---|---|---|---|
| MetaHuman Techwear Outfit | [Fab](https://www.fab.com/listings/9e04c752-1979-4723-b78f-6d24afc532bc) | Jacket, pants and shoes as **one** item (not separable) | 401.63 MB; UE 5.6–5.7 listed; 4.8★ (12) | [jpg](../../../.shots/assets/metahuman-outfits/epic-techwear-outfit.jpg) |
| MetaHuman Jeans | [Fab](https://www.fab.com/listings/07dc895c-7402-411c-a74a-e1c47b33ac68) | Straight jeans | updated 2026-08-13 | [jpg](../../../.shots/assets/metahuman-outfits/epic-jeans.jpg) |
| MetaHuman Slim Jeans Variants | [Fab](https://www.fab.com/listings/c5ed3971-03fd-4cec-804c-646422881fb3) | 3 lengths: full, mid-calf, above knee | | [jpg](../../../.shots/assets/metahuman-outfits/epic-slim-jeans-variants.jpg) |
| MetaHuman Cargo Pants | [Fab](https://www.fab.com/listings/586d2fd4-9ae9-4d91-9e61-2a362008d052) | Cargo trousers (the closest thing to chinos) | | [jpg](../../../.shots/assets/metahuman-outfits/epic-cargo-pants.jpg) |
| MetaHuman Shorts | [Fab](https://www.fab.com/listings/1904a7ee-66f6-4e09-9d4a-b3eea464b761) | Sport shorts | | [jpg](../../../.shots/assets/metahuman-outfits/epic-shorts.jpg) |
| MetaHuman Yoga Pants Variants | [Fab](https://www.fab.com/listings/518ee338-a0a5-4b7e-8c9f-6b4c1a2a2206) | Full length and above knee | | [jpg](../../../.shots/assets/metahuman-outfits/epic-yoga-pants-variants.jpg) |
| MetaHuman T Shirt Variants | [Fab](https://www.fab.com/listings/1b1009ae-4327-4c9d-9567-9314d88e7a86) | 5 sleeve styles: short, ¾, long, long cuffed, pushed-up | 4.75★ (4) | [jpg](../../../.shots/assets/metahuman-outfits/epic-t-shirt-variants.jpg) |
| MetaHuman Tucked T Shirt Variants | [Fab](https://www.fab.com/listings/839b9239-5ea4-40a0-90b3-076e0d9959f7) | The same 5 sleeve styles, tucked in | | [jpg](../../../.shots/assets/metahuman-outfits/epic-tucked-t-shirt-variants.jpg) |
| MetaHuman Crop Top Variants | [Fab](https://www.fab.com/listings/39bcebb4-cbc7-4c5e-9cd6-d6dd6b5ed9ff) | 4 sleeve styles | | [jpg](../../../.shots/assets/metahuman-outfits/epic-crop-top-variants.jpg) |
| MetaHuman Sweater | [Fab](https://www.fab.com/listings/d401d47a-204f-4fde-aaec-c230042e7f60) | Crew-neck knit sweater | | [jpg](../../../.shots/assets/metahuman-outfits/epic-sweater.jpg) |
| MetaHuman Hoodie | [Fab](https://www.fab.com/listings/fae6467c-1d14-412c-b9b0-a579f0eb1b22) | Pullover hoodie | | [jpg](../../../.shots/assets/metahuman-outfits/epic-hoodie.jpg) |
| MetaHuman Casual Sneakers | [Fab](https://www.fab.com/listings/7e58d5c5-5666-4ab2-9c4e-011eeaba3c07) | Shoes | | [jpg](../../../.shots/assets/metahuman-outfits/epic-casual-sneakers.jpg) |
| MetaHuman Running Shoes | [Fab](https://www.fab.com/listings/c79be75e-b5bb-461c-9c2b-72272254daea) | Shoes | | [jpg](../../../.shots/assets/metahuman-outfits/epic-running-shoes.jpg) |
| MetaHuman Hightops | [Fab](https://www.fab.com/listings/0bdf37d3-8ebf-4ec1-905d-65737b1c2809) | Shoes | | [jpg](../../../.shots/assets/metahuman-outfits/epic-hightops.jpg) |
| MetaHuman Boots | [Fab](https://www.fab.com/listings/c6596c37-e34f-46d4-a44e-fc360cc079c4) | Combat boots | | [jpg](../../../.shots/assets/metahuman-outfits/epic-boots.jpg) |
| MetaHuman Chelsea Boots | [Fab](https://www.fab.com/listings/b910abee-3189-4396-9bd2-d8ce57b7bb88) | Shoes | | [jpg](../../../.shots/assets/metahuman-outfits/epic-chelsea-boots.jpg) |
| MetaHuman Loafers | [Fab](https://www.fab.com/listings/2f631109-17ab-4c87-a78c-5148927de957) | Shoes (older men, office) | | [jpg](../../../.shots/assets/metahuman-outfits/epic-loafers.jpg) |
| MetaHuman Oxfords | [Fab](https://www.fab.com/listings/25b79aec-45c7-4f9a-88eb-5c3220d975bd) | Shoes (sandal-like open oxford, see preview) | | [jpg](../../../.shots/assets/metahuman-outfits/epic-oxfords.jpg) |
| MetaHuman Flats | [Fab](https://www.fab.com/listings/735c8256-e1b2-4157-b411-9e53ed6f34f2) | Women's flats | | [jpg](../../../.shots/assets/metahuman-outfits/epic-flats.jpg) |
| MetaHuman FlipFlops | [Fab](https://www.fab.com/listings/73272acc-25fe-43ee-a97f-d82a0888d46c) | Summer and seafront | | [jpg](../../../.shots/assets/metahuman-outfits/epic-flipflops.jpg) |

**Epic tools and samples**

| Name | Link | Contents | Verdict | Preview |
|---|---|---|---|---|
| MetaHuman Clothing Construction Presets, Set of 4 | [Fab](https://www.fab.com/listings/3c0c4df1-ce96-44cf-8a30-c47d744d2a0c) | 4 body presets (`.mhpkg`) plus **FBX of each body with the head combined**, "ready for use in garment creation in your DCC". 6.32 MB; UE 5.6–5.7. (A [Set of 2](https://www.fab.com/listings/8047c06c-3d08-4a33-a029-560d6b4f25f9) also exists.) | **ok-with-conditions**: needed for §4 (tailoring) | [jpg](../../../.shots/assets/metahuman-outfits/epic-construction-presets-4.jpg) |
| MetaHuman Crowd Sample | [Fab](https://www.fab.com/listings/5f481d73-afb1-4d94-ba6e-7cabf5d296fa) | UE 5.8 project for "1000s of visually distinct MetaHumans": Collections, Instances, crowd LODs, grooms converted to cards. The garments it contains are **not listed**. | **ok-with-conditions**; reference for the crowd build. Check its wardrobe after "Add to Project". | [jpg](../../../.shots/assets/metahuman-outfits/epic-crowd-sample.jpg) |
| MetaHuman Fashion Starter Kit | [Fab](https://www.fab.com/listings/32809841-5170-4c32-85ac-ea441b33bafd) | One MetaHuman with a body preset for CLO or Marvelous Designer, 60 s of catwalk mocap and a lighting set. **No garments.** | Not needed | [jpg](../../../.shots/assets/metahuman-outfits/epic-fashion-starter-kit.jpg) |
| City Sample Crowds | [Fab](https://www.fab.com/listings/903037e9-e1ac-4f41-96e8-1683c6fa7ad4) | Legacy MetaHuman-based crowd: tops, bottoms and shoes on 6 bodies; UE 5.0–5.3 | **Reject**: "UE-Only Content - Licensed for Use Only with Unreal Engine-based Products" | [jpg](../../../.shots/assets/metahuman-outfits/epic-city-sample-crowds.jpg) |
| Free Epic grooms (optional) | [Long High Ponytail](https://www.fab.com/listings/d48ad98a-e343-4a2c-abb3-08730c3bf7d9), [Updo Messy Bun](https://www.fab.com/listings/513ddbde-b618-42f5-bd8d-17e5073a637b), [Slick Ponytail](https://www.fab.com/listings/81e087c3-fffb-4cbb-9ed9-1052bcf3f758), [Dutch Braid](https://www.fab.com/listings/7fabdfc3-a431-4051-b817-72c84da00251), [Cornrows](https://www.fab.com/listings/85c45e5a-2cb1-4568-988c-eb8ec7dd8836), [Bantu Knots](https://www.fab.com/listings/9f5879e9-de7a-4ec3-9d7a-9a06375564c2) | Strand grooms, published 2026-06-17 | ok-with-conditions. Only the ponytail and the bun add much to the 38 installed styles. | [ponytail](../../../.shots/assets/metahuman-outfits/epic-groom-long-high-ponytail.jpg), [bun](../../../.shots/assets/metahuman-outfits/epic-groom-updo-messy-bun.jpg) |

## 2. Free: third-party sellers

All are $0 under the Fab Standard License. Ratings have few votes, so quality varies. Test one before relying on a
seller.

| Name | Link | Author | Type | Contents | Size / textures | Verdict | Preview |
|---|---|---|---|---|---|---|---|
| MetaOutfits – Casual Wear – Male | [Fab](https://www.fab.com/listings/c556fd02-6daa-46a8-b8d9-9994a781905e) | Wizark Studios | Parametric ("works best with Tall Normal Male") | T-shirt, pants, slippers | 4K PBR; 5.0★ (4) | **ok-with-conditions**; plain basics | [jpg](../../../.shots/assets/metahuman-outfits/wizark-metaoutfits-casual-male.jpg) |
| MetaOutfits – Casual Wear – Female | [Fab](https://www.fab.com/listings/575d159d-f0ad-44e1-982c-bf36274f97a7) | Wizark Studios | Parametric | T-shirt, pants, slippers | 4K PBR; 5.0★ (2) | **ok-with-conditions** | [jpg](../../../.shots/assets/metahuman-outfits/wizark-metaoutfits-casual-female.jpg) |
| Half T-Shirt Outfit (Resizable) | [Fab](https://www.fab.com/listings/4cefc057-bf6b-4faf-9b7d-f4d48cdaa67d) | polycornStudio | Parametric | Polo-style T-shirt, jeans, shoes | 93.58 MB; UE 5.7 | **ok-with-conditions**; a free sample of the paid pack in §3 | [jpg](../../../.shots/assets/metahuman-outfits/polycorn-half-t-shirt-outfit.jpg) |
| Survivor Outfit (Resizable) | [Fab](https://www.fab.com/listings/230a9d3e-f502-4ad2-924d-ee7995693710) | polycornStudio | Parametric | Jacket, T-shirt, pants, boots | 119.72 MB; UE 5.7; 3.0★ (1) | ok-with-conditions; worn look (a fisherman or porter at most) | [jpg](../../../.shots/assets/metahuman-outfits/polycorn-survivor-outfit.jpg) |
| MetaHuman Casual Jacket | [Fab](https://www.fab.com/listings/75804b80-b63a-4c01-9de7-52962da41526) | Arcline Jack | Resizes ("adjusted to your character setup") | Zip jacket; extra colours as textures; FBX source | not stated | **ok-with-conditions**; the only free jacket | [jpg](../../../.shots/assets/metahuman-outfits/arcline-casual-jacket.jpg) |
| MetaHuman Casual Shorts | [Fab](https://www.fab.com/listings/a18bd372-c5af-49c6-8279-45993f0d5da3) | Arcline Jack | Resizes ("perfect fitting cannot be guaranteed") | Denim shorts, 6 colours | 379.70 MB; 4K; UE 5.8 | ok-with-conditions; low priority | [jpg](../../../.shots/assets/metahuman-outfits/arcline-casual-shorts.jpg) |
| Shirt V-neck with rolled sleeves | [Fab](https://www.fab.com/listings/c4079e06-cef5-440c-8963-e05fd9462828) | Nyanpasinka | Probably fixed (UE 5.3–5.7; also ships FBX and OBJ) | Short-sleeve shirt | 7 × 4096² PBR + 5 masks; 5.0★ (2) | ok-with-conditions; check the fit | [jpg](../../../.shots/assets/metahuman-outfits/nyanpasinka-shirt-vneck-rolled.jpg) |
| FREE Sleeveless Shirt Outfit | [Fab](https://www.fab.com/listings/7d8af3be-7776-415d-aef1-5efb06511daf) | WhiteBoxx | Parametric | Sleeveless shirt | 61.48 MB; UE 5.6–5.8 | ok-with-conditions; summer only | [jpg](../../../.shots/assets/metahuman-outfits/whiteboxx-sleeveless-shirt.jpg) |
| Basic Sweatpants | [Fab](https://www.fab.com/listings/bc90695b-485c-4c2c-b61c-e2692cfca65b) | Kurmanin Tailor | Parametric (4 sizes) | Sweatpants | 288.26 MB; 4K; UE 5.7 | ok-with-conditions; the seller asks "credit me if you are using the free version" (record it) | [jpg](../../../.shots/assets/metahuman-outfits/kurmanin-basic-sweatpants.jpg) |
| Streetwear Parametric Outfit 01 | [Fab](https://www.fab.com/listings/5691adb6-a02c-4fe9-b67b-b4b468baf36b) | Paradoox | Parametric | Streetwear vest outfit plus sample uproject | not stated; 4.17★ (6) | ok licence; styled, a few crowd members at most | [jpg](../../../.shots/assets/metahuman-outfits/paradoox-streetwear-01.jpg) |
| Metahuman Customizable Mini Dress_01 | [Fab](https://www.fab.com/listings/8a2c223f-4fd2-4ca0-ba7a-e63bcda33531) | Mukilartz | Parametric | Short party dress | 89.17 MB; UE 5.6 | ok licence; **poor fit** for a street crowd | [jpg](../../../.shots/assets/metahuman-outfits/mukilartz-mini-dress-01.jpg) |
| Streetwear Parametric Outfit 12 | [Fab](https://www.fab.com/listings/cb85da0d-4b8e-4ef1-8844-d04a7e02ddad) | Paradoox | Parametric | Satin two-piece | not stated | **Reject** (wrong look) | [jpg](../../../.shots/assets/metahuman-outfits/paradoox-streetwear-12.jpg) |

Also seen and rejected for their look: "Poor man Outfit" (NOETA, desert wanderer), swimwear, lingerie and bodysuits
(QuingKhaos and others), a cowboy hat and a racing helmet. **No free headscarf, coat, dress for everyday wear, apron
or vest exists on Fab today.**

## 3. Paid fallbacks (NOT allowed by the current asset rule; listed only if the free set proves too thin)

All are under the Fab Standard License (same conditions as above). None is rated by more than 4 buyers.

| Name | Link | Author | Price (Personal / Professional) | Type | Covers | Preview |
|---|---|---|---|---|---|---|
| **Unisex Business Outfit Pack** | [Fab](https://www.fab.com/listings/f9a58805-69b5-4a8c-bb44-c2a349f416cd) | 2AwesomeWork | **$99.99** / $199.99 | MetaHuman `.mhpkg` per item | 2 blazers, **2 long coats** (the *pardesü*), **2 waistcoats**, 3 formal shirts, turtleneck, **5 formal trousers**, **pencil skirt**, **crepe dress**, 4 dress shoes. Best single gap-filler. | [jpg](../../../.shots/assets/metahuman-outfits/paid-2awesomework-unisex-business-pack.jpg) |
| **Smart Casual Outfit Collection** (5 resizable sets) | [Fab](https://www.fab.com/listings/c6fed140-6752-428b-b6b3-ad59f8a6fbca) | polycornStudio | **$50.99** / $70.99 | Parametric | **Cardigan**, knit polo, **Oxford shirt**, turtleneck, turtleneck plus **blazer**, each with trousers and shoes. Older men and café guests. Try the free Half T-Shirt (§2) first. | [jpg](../../../.shots/assets/metahuman-outfits/paid-polycorn-smart-casual-collection.jpg) |
| **Civilian Professions Bundle** | [Fab](https://www.fab.com/listings/79fee585-0829-489e-a346-20ef5c08c98a) | Quantum Assets | **$149.99** / $199.99 | Parametric | "over 40 unique Civilian Professions Outfit assets" (PDF catalogue: hi-vis vests, overalls, hard hats, medical). The same seller sells single items at $9.99: [Rubber Boots](https://www.fab.com/listings/8236af3c-848a-4020-84b9-9be2650f8752), [Flat Cap](https://www.fab.com/listings/863dcaf3-d44e-41cc-9f2a-a009ed66a1ec), Worker Vest. The seller's Casual bundle is rated 3.5★ (4). | [jpg](../../../.shots/assets/metahuman-outfits/paid-quantum-civilian-professions-bundle.jpg), [boots](../../../.shots/assets/metahuman-outfits/paid-quantum-rubber-boots.jpg), [cap](../../../.shots/assets/metahuman-outfits/paid-quantum-flat-cap.jpg) |

Single paid gap items seen:

- OF Studio [Modest Layered Hijab](https://www.fab.com/listings/ccdde561-233f-4e33-a591-669109fe5066), $8.99. Its
  description says FBX; the `.mhpkg` type is unclear.
  [jpg](../../../.shots/assets/metahuman-outfits/paid-ofstudio-hijab.jpg)
- OF Studio [Barista uniform with green apron](https://www.fab.com/listings/8f624156-a1bd-47f1-ab2d-1d30e394fdf3),
  $18.99. [jpg](../../../.shots/assets/metahuman-outfits/paid-ofstudio-barista-uniform.jpg)
- 2AwesomeWork [Casual Unisex Outfit Pack](https://www.fab.com/listings/6e5d38d5-4c07-4790-b999-22ff8d5872f8), $99.99.
  [jpg](../../../.shots/assets/metahuman-outfits/paid-2awesomework-casual-unisex-pack.jpg)
- Paradoox [10 Streetwear Pack Vol.2](https://www.fab.com/listings/5edddae6-02ca-4d54-9834-9d16ba226abe), $49.99,
  5.0★ (3). [jpg](../../../.shots/assets/metahuman-outfits/paid-paradoox-streetwear-vol2.jpg)
- Nice Pictures sells many well-rated single garments at $25–50 each (for example a puffer, and a cardigan vest).

## 4. Tailoring our own (Epic docs, UE 5.6–5.8)

Sources:

- [Tailoring Your Own Wardrobe Items](https://dev.epicgames.com/documentation/metahuman/tailoring-your-own-wardrobe-items)
- [Getting Started with Parametric Clothing](https://dev.epicgames.com/documentation/unreal-engine/getting-started-with-parametric-clothing)
- [Parametric Asset Setup](https://dev.epicgames.com/documentation/unreal-engine/parametric-asset-setup)
- [Creating Your MetaHuman](https://dev.epicgames.com/documentation/unreal-engine/creating-your-metahuman-in-unreal-engine)
- [Building an Outfit Asset](https://dev.epicgames.com/documentation/unreal-engine/building-an-outfit-asset-in-unreal-engine)
- [Testing and Setup in MHC](https://dev.epicgames.com/documentation/unreal-engine/testing-and-setup-in-metahuman-creator)

**Inputs**

- **Garment mesh** (FBX or USD), made in any DCC. **Blender is fine**, because Epic's tutorial "does not cover asset
  creation in your DCC of choice".
  - **Path A:** render mesh only, as FBX. This is the path for us.
  - **Path B:** USD with a sim mesh, exported from Marvelous Designer or CLO (paid tools).
  - **Path C:** a hand-made sim mesh.
- **Skinning is not needed.** "You do not have to skin your parametric clothing. All you need is the model". A
  `TransferSkinWeights` node copies the weights from the body. Custom skinning is overwritten on resize.
- **Source bodies:** one or more MetaHuman bodies exported as a "Combined Skel Mesh" FBX. Epic recommends several
  source sizes ("we encourage you to create multiple outfits for multiple source bodies"), and the system picks the
  closest one per character. The free **Construction Presets, Set of 4** already contains the four FBX bodies.
- **Plugins:** MetaHuman Creator, Chaos Cloth Asset and Chaos Cloth Asset Editor (all present in 5.8.3).

**Steps in UE**

1. Import the FBX as a static mesh.
2. Create a Cloth Asset (a Dataflow graph): `StaticMeshImport` → `TransferSkinWeights` (closest point on surface to
   the body) → `ClothAssetTerminal`.
3. Add LODs 1–3 with `Remesh` nodes at 50 / 30 / 10 % ("MetaHuman expects four body LODs"), or make them by hand.
4. Create an **Outfit Asset** (template "Resizable Outfit"). Add one `Sized Outfit Source` entry per source body.
5. Evaluate the graph (can take minutes).
6. Drag the outfit into MetaHuman Creator's Outfit Clothing section. This creates `WI_<name>`.
7. In `WI_<name>`, add Runtime Material Parameters for the colours, and a **Body Hidden Face Map**: a black and white
   mask on the body UVs that removes body faces under the clothing. That removal also cuts crowd triangles.
8. Package with MetaHuman Manager only if we want a `.mhpkg`. Using the item in our own project does not need it.

**Scripting (checked in the UE 5.8.3 install; untested)**

- **Blender side:** fully scriptable with `bpy`, including shrinkwrap or cloth-sim fitting to the 4 preset bodies.
- **Assigning wardrobe items to characters:** already scripted in `evren_metahumans.py`
  (`try_add_item_from_wardrobe_item`).
  - It currently hard-codes `/MetaHumanCharacter/Optional/Clothing` and selects one outfit.
  - Fab and our own items live under `/Game/Outfits/<Name>/WI_*`.
  - Several items per character (top + bottom + shoes) need a multi-selection.
- **Graph building:** `UDataflowEditorBlueprintLibrary` (`AddDataflowNode`, `ConnectDataflowNodes`,
  `SetDataflowNodeProperty`, `AddDataflowFromClipboardContent`) is BlueprintCallable, so it should be reachable from
  Python.
- **Asset factory:** `UChaosOutfitAssetFactory` exists.
- **Not verified:**
  - triggering the graph evaluation from Python;
  - creating the `WI_` item without dragging it into MetaHuman Creator.
- **Plan:** build the first garment by hand, then duplicate its assets and swap the meshes by script.

**Effort for about 6 base garments** (*est.*; plain quality, fine at crowd distance, weaker at 1–3 m):

| Garment | Why | Est. effort (1 size / 4 sizes) |
|---|---|---|
| *Başörtüsü* (headscarf) | No free option. MPFB2 ships a **CC0 hijab** (see [humans.md](humans.md)) that can be refitted to the MetaHuman head as the base mesh. | 0.5 / 1 day |
| Long coat (*pardesü* / trench) | The biggest silhouette gap for autumn and winter | 1 / 1.5 days |
| Apron (barista; fishmonger in a rubber colour) | Simple planar mesh; tint for each role | 0.5 / 0.5 day |
| Cardigan / knit vest (*yelek*) | Older men and women; open front over Epic's T-shirts | 1 / 1.5 days |
| Straight trousers / chinos | Office and older looks (Epic has only jeans, cargo and yoga pants) | 0.5 / 1 day |
| Midi skirt | Women's everyday look | 0.5 / 1 day |
| One-off setup | Import the preset bodies, hand-build the first Dataflow/Outfit graph, write the script for the rest | 1 day |

Totals: **about 5 days at one source size, or about 7–8 days at four sizes.** Textures come from the approved CC0 fabric
sets (Poly Haven, ambientCG), and a flat cap or rubber boots can be added at about 0.5 day each. There are no
third-party licence limits. The garment sources are fitted to Epic's body presets, so keep them in `private-assets/`
too. The dressed exports stay private anyway, because they contain the MetaHuman body.

## Recommendation

1. **Approve first: the 20 Epic garment listings in §1 plus Construction Presets Set of 4** (free, Fab Standard).
   - Combined as top × bottom × shoes (16 × 8 × 9) with recolours, they give far more than enough distinct
     silhouettes for 200 people at crowd distance.
   - Every item comes from the same author with the same LOD scheme and fitting behaviour, which means the fewest
     surprises in the glTF export.
   - Techwear is a single stylised outfit; use it on at most a few people.
   - Optional: the Crowd Sample (UE 5.8) as a reference for Collections and crowd LODs.
2. **Second (optional, free): Arcline Casual Jacket and Wizark Casual Wear Male/Female.** Test one garment from each
   seller first.
3. **Tailor our own 6 basics** (§4) for the *başörtüsü*, *pardesü*, apron, cardigan/vest, trousers and skirt. Together
   with Epic's set this covers the Kadıköy brief without paid assets. Leather, denim and bomber jackets, puffers and
   dresses stay open; they would come from a later tailoring round or a rule exception for a §3 pack.
4. **Do not approve:** City Sample Crowds (UE-only), and the free listings marked "Reject" or "poor fit".
5. **On approval**, add a Fab row to `private-assets.md` (licence: Fab Standard, Professional tier at $0; builds only;
   no-extraction measures for the web build) and log each acquired listing.

## User actions (after approval)

- [ ] 1. In UE 5.8.3 (project under `private-assets/unreal/EvrenHumans`), open **Window → Fab**, sign in with your
      **Epic account**, and for each approved listing choose the **Professional** tier ($0) and click
      **Add to Project**. The alternative is to download the `.mhpkg` on fab.com and drag it into
      `Content/Outfits/<Name>/`. Acquiring counts as a Fab transaction, so an agent cannot do it for you.
- [ ] 2. For Construction Presets Set of 4, also download the **additional-files zip** (all four bodies plus FBX) into
      `private-assets/fab/metahuman-construction-presets/`.
- [ ] 3. Tell the agent which listings were added. The agent then extends `evren_metahumans.py` for multi-item
      outfits and runs a fit check across the body presets.
