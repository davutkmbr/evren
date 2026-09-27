# Model licences

Every external model in the game, with its licence and source (CLAUDE.md: external assets).

<!-- GENERATED:street-assets (tools/world-compiler/src/street/licences.ts) -->

## Street layer props

Approved models placed as props in the compiled street output (`public/world/<area>/props/`), generated from the compiled `index.json` credits. Their LOD glbs (`<id>.lod1.glb`, `<id>.lod2.glb`) are decimated copies made by the compiler (meshoptimizer). Procedural props (`st_*`, `fac_*`, lamp masts, mannequins) are Seventeen Skies' own work under the repository licence.

| Asset | Source | Author | Licence | Conditions (how met) | Used by |
| --- | --- | --- | --- | --- | --- |
| `modern_ceiling_lamp_01` | [Modern Ceiling Lamp 01](https://polyhaven.com/a/modern_ceiling_lamp_01) (polyhaven) | James Ray Cock | CC0-1.0 | – | prop:modern_ceiling_lamp_01 |
| `outdoor_table_chair_set_01` | [Outdoor Table Chair Set 01](https://polyhaven.com/a/outdoor_table_chair_set_01) (polyhaven) | James Ray Cock | CC0-1.0 | – | prop:outdoor_table_chair_set_01 |
| `pigeon_gamico` | [Animated Pigeon - Rigged & Optimized](https://sketchfab.com/3d-models/animated-pigeon-rigged-optimized-6cdb9b2f5f784d8f9abc92e4c132f116) (sketchfab) | GAMICO | CC-BY-4.0; attribution: This work is based on "Animated Pigeon - Rigged & Optimized" (https://sketchfab.com/3d-models/animated-pigeon-rigged-optimized-6cdb9b2f5f784d8f9abc92e4c132f116) by GAMICO (https://sketchfab.com/gamico) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/) | Keep the credit in public/models/LICENSES.md — see assets-src conditions / the compiler | baked |
| `plastic_monobloc_chair_01` | [Plastic Monobloc Chair 01](https://polyhaven.com/a/plastic_monobloc_chair_01) (polyhaven) | Kuutti Siitonen | CC0-1.0 | – | prop:plastic_monobloc_chair_01 |
| `potted_plant_04` | [Potted Plant 04](https://polyhaven.com/a/potted_plant_04) (polyhaven) | James Ray Cock | CC0-1.0 | – | prop:potted_plant_04 |
| `standing_chalkboard_01` | [Standing Chalkboard 01](https://polyhaven.com/a/standing_chalkboard_01) (polyhaven) | ParzivalCG | CC0-1.0 | – | prop:standing_chalkboard_01 |
| `street_lamp_01` | [Street Lamp 01](https://polyhaven.com/a/street_lamp_01) (polyhaven) | Josh Dean | CC0-1.0 | – | prop:street_lamp_01 |
| `street_lamp_02` | [Street Lamp 02](https://polyhaven.com/a/street_lamp_02) (polyhaven) | Josh Dean | CC0-1.0 | – | prop:street_lamp_02 |

<!-- /GENERATED:street-assets -->

## Rider character

`rider/akinci.glb` is built by `tools/humans/build_rider.py` (Blender 4.5 + MPFB 2 as tools) from the approved CC0
MakeHuman assets (CLAUDE.md, `.docs/assets/candidates/rider-humans.md`); the outfit, wings, skeleton additions and
clips are Seventeen Skies' own procedural work. The garment surface textures it references at runtime are listed in
`public/textures/LICENSES.md` (Rider garment textures).

| Part | Source | Author | Licence |
| --- | --- | --- | --- |
| Base mesh, body and face targets, Mixamo-named game rig | [MakeHuman system assets](https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html) | MakeHuman team | CC0-1.0 |
| Eyes (high-poly, brown), eyebrow008, eyelashes01, teeth, tongue01 and their textures | MakeHuman system assets | MakeHuman team | CC0-1.0 |
| Skin `middleage_caucasian_male` (texture `middleage_lightskinned_male_diffuse`) | MakeHuman system assets / [skins pack 01](https://static.makehumancommunity.org/assets/assetpacks/skins01.html) | MakeHuman community | CC0-1.0 |
| Face units (ARKit-style expression targets, kept as morph targets) | [face units 01](https://static.makehumancommunity.org/assets/assetpacks/faceunits01.html) | MakeHuman team | CC0-1.0 |
