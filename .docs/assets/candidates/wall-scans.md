# Wall scan candidates (decided)

## Decision (2026-09-26)

The user approved the four recommended CC0 sets, and only these (not the alternatives): ambientCG **Bricks102**
(limestone facing), Poly Haven **castle_brick_broken_06** (brick bands, repairs, buttresses), ambientCG **Rocks025**
(rubble core) and ambientCG **LeafSet029** (alpha-tested ivy leaves). Integration:

- Records: [`tools/assets/approved.json`](../../../tools/assets/approved.json) (resolution 2k); fetched with
  `node scripts/data/fetch-assets.mjs --id=Bricks102,castle_brick_broken_06,Rocks025,LeafSet029` into `assets-src/`.
- Runtime copies (1k albedo / normal / roughness, leaf colour + opacity) in `public/textures/wall_*` by
  `scripts/data/prep-wall-textures.mjs`, recorded in [`public/textures/LICENSES.md`](../../../public/textures/LICENSES.md).
- Used only by the city-wall kit material (`src/world/landmarks/walls/render/material.ts`) and its sandbox page; the
  kit is not placed in the game yet.

---

Status before the decision: shortlist only. Nothing downloaded beyond the sources' own preview thumbnails
(`.shots/assets/wall-scans/`, sheets `sheet-polyhaven.jpg`, `sheet-ambientcg.jpg`, `sheet-leaves.jpg`,
`sheet-sketchfab.jpg`), nothing in `public/` or `assets-src/`, nothing referenced in code. Checked 2026-09-26 through
the Poly Haven, ambientCG and Sketchfab APIs.

## Need

The city-wall kit (`src/world/landmarks/walls/kit`, reference `.docs/research/sea-walls-reference.md`) currently
uses the installed sandstone-blocks and red-brick sets plus procedural layout. Next to photos of the Marmara and Golden
Horn walls it lacks: squared limestone courses (0.3–0.4 m) with deep, pale, crushed-brick mortar joints; old,
dull brick bedded in very thick mortar; a rubble-and-mortar core for the lost-facing patches; and a real ivy / fig
leaf for the vegetation cards.

## Texture sets (CC0)

| id | Source | Author | Real size | Use | Match |
| --- | --- | --- | --- | --- | --- |
| **`Bricks102`** (recommended) | [ambientCG Bricks 102](https://ambientcg.com/view?id=Bricks102) | Lennart Demes (ambientCG) | tbc (~2 m) | stone courses of the curtain and towers | roughly squared buff limestone in thick pale mortar, uneven courses: the closest to the Theodosian / Propontis facing |
| **`castle_brick_broken_06`** (recommended) | [Poly Haven](https://polyhaven.com/a/castle_brick_broken_06) | Rob Tuytel | 2.5 × 2.5 m, 2k diffuse ~2.6 MB | brick bands, brick repair patches, buttresses, voussoirs | old red-brown brick, broken arrises, thick recessed mortar |
| **`Rocks025`** (recommended) | [ambientCG Rocks 025](https://ambientcg.com/view?id=Rocks025) | Lennart Demes (ambientCG) | tbc | exposed rubble core in lost-facing patches, broken tops | irregular pale stones in lime mortar |
| `Bricks098` | [ambientCG Bricks 098](https://ambientcg.com/view?id=Bricks098) | Lennart Demes (ambientCG) | tbc | alternative stone facing (rougher, later repairs) | uneven beige-grey rubble courses |
| `Bricks094` | [ambientCG Bricks 094](https://ambientcg.com/view?id=Bricks094) | Lennart Demes (ambientCG) | tbc | alternative brick | old red brick, wide mortar, dirty |
| `old_stone_wall` | [Poly Haven](https://polyhaven.com/a/old_stone_wall) | Charlotte Baglioni | 2 × 2 m | alternative rubble / Ottoman repairs | coursed rubble, grey-brown |
| `mixed_brick_wall` | [Poly Haven](https://polyhaven.com/a/mixed_brick_wall) | Dimitrios Savva | 1.7 × 1.7 m | spolia / mixed repair patches | bricks of mixed colours incl. pale stone |
| `medieval_blocks_02` | [Poly Haven](https://polyhaven.com/a/medieval_blocks_02) | Rob Tuytel | 1.5 × 1.5 m | alternative core | rough knobbly rubble, too orange as is |

## Leaves (CC0)

| id | Source | Author | Use |
| --- | --- | --- | --- |
| **`LeafSet029`** (recommended) | [ambientCG Leaf Set 029](https://ambientcg.com/view?id=LeafSet029) | Lennart Demes (ambientCG) | alpha-tested ivy leaf atlas (colour, opacity, normal, translucency) for the ivy and fig cards |
| `LeafSet017` | [ambientCG Leaf Set 017](https://ambientcg.com/view?id=LeafSet017) | Lennart Demes (ambientCG) | alternative, paler ivy |

## Photogrammetry scans

Searched Sketchfab (downloadable, any CC licence) for "theodosian walls", "walls of constantinople", "istanbul city
walls", "byzantine wall", "yedikule", "sea walls istanbul", "golden gate istanbul", "constantinople wall tower",
"istanbul surlari". **No usable scan of the Theodosian or sea walls was found.**

| Model | Licence | Notes |
| --- | --- | --- |
| [Walls of Constantinople](https://sketchfab.com/3d-models/46cbb6f135b54e54a3e53dead726804f) (tijmen_h) | CC BY | low-poly block model (4k faces), no scan — useless as a detail source |
| [The Ancient City of Histria](https://sketchfab.com/3d-models/6d02bb7ae1194c7eaba876e1a8379204) (Global Digital Heritage) | CC BY | aerial site scan (Roman / early Byzantine walls, Romania); texel density far too low for wall detail |
| [Fortress Ustra](https://sketchfab.com/3d-models/062bce23df194aa1b62f5ccb2423e852), [Elenska Basilica](https://sketchfab.com/3d-models/c71b15ec85c34a6f921092b12631a007) (juanbrualla) | CC BY | medieval Bulgarian site scans, aerial scale, not opus mixtum close-ups |
| Byzantine City Walls / Large Town Walls / Wall Damage Transition (hellenicshieldbearer) | CC BY-NC-SA | non-commercial: excluded |

## Recommendation

Approve `Bricks102`, `castle_brick_broken_06`, `Rocks025` and `LeafSet029` (all CC0). They would replace the
sandstone-blocks / red-brick grain in the wall material and the procedural leaf cut-out (the kit's layout, bands and
weathering stay procedural). No photogrammetry is worth taking; real-wall detail keeps coming from the photos in
`.docs/research/sea-walls-reference.md`.
