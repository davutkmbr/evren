# Texture licences

All textures in this folder are **CC0 1.0 (public domain)** from [Poly Haven](https://polyhaven.com/license),
downloaded as JPG (albedo = Diffuse, normal = OpenGL normal `nor_gl`, rough = Roughness) by
`scripts/data/fetch-textures.mjs`.

| Folder | Source | Resolution | Repeat size | Licence |
| --- | --- | --- | --- | --- |
| `plaster/` | [plastered_wall](https://polyhaven.com/a/plastered_wall) | 2k | 2 m | CC0 1.0 |
| `plaster_painted/` | [painted_plaster_wall](https://polyhaven.com/a/painted_plaster_wall) | 1k | 2 m | CC0 1.0 |
| `stone/` | [white_sandstone_blocks_02](https://polyhaven.com/a/white_sandstone_blocks_02) | 1k | 2 m | CC0 1.0 |
| `concrete/` | [concrete_wall_008](https://polyhaven.com/a/concrete_wall_008) | 1k | 2.7 m | CC0 1.0 |
| `brick/` | [red_brick_03](https://polyhaven.com/a/red_brick_03) | 1k | 1 m | CC0 1.0 |
| `roof_tiles/` | [clay_roof_tiles_02](https://polyhaven.com/a/clay_roof_tiles_02) | 1k | 2.5 m | CC0 1.0 |
| `asphalt/` | [asphalt_01](https://polyhaven.com/a/asphalt_01) | 1k | 2.08 m | CC0 1.0 |
| `cobble/` | [cobblestone_floor_04](https://polyhaven.com/a/cobblestone_floor_04) | 1k | 1.5 m | CC0 1.0 |
| `sidewalk/` | [pavement_03](https://polyhaven.com/a/pavement_03) | 1k | 2 m | CC0 1.0 |
| `granite/` | [large_grey_tiles](https://polyhaven.com/a/large_grey_tiles) | 1k | 3 m | CC0 1.0 |
| `yard/` | [concrete_floor_worn_001](https://polyhaven.com/a/concrete_floor_worn_001) | 1k | 3 m | CC0 1.0 |

<!-- GENERATED:street-assets (tools/world-compiler/src/street/licences.ts) -->

## Street layer textures and decals

Texture sets and decals in the compiled street output (`public/world/<area>/textures/`), generated from the compiled `index.json` credits. Raw files are cached in `assets-src/` (`tools/assets/approved.json`); the compiler re-encodes them (`tools/world-compiler/src/textures.ts`).

| Asset | Kind | Source | Author | Licence | Conditions (how met) | Used by |
| --- | --- | --- | --- | --- | --- | --- |
| `asphalt_02` | texture | [Asphalt 02](https://polyhaven.com/a/asphalt_02) (polyhaven) | Rob Tuytel | CC0-1.0 | – | material:road, material:st_road |
| `damaged_plaster` | texture | [Damaged Plaster](https://polyhaven.com/a/damaged_plaster) (polyhaven) | Amal Kumar | CC0-1.0 | – | material:fac_damaged |
| `floor_tiles_02` | texture | [Floor Tiles 02](https://polyhaven.com/a/floor_tiles_02) (polyhaven) | Rob Tuytel | CC0-1.0 | – | material:hero_floor, material:hero_plinth, material:hero_stone, material:hero_stone_trim |
| `granite_tile_04` | texture | [Granite Tile 04](https://polyhaven.com/a/granite_tile_04) (polyhaven) | Amal Kumar | CC0-1.0 | – | material:kerb, material:st_coping, material:st_kerb, material:st_slabs |
| `Leaking003` | decal | [Leaking 003](https://ambientcg.com/view?id=Leaking003) (ambientcg) | Lennart Demes (ambientCG) | CC0-1.0 | – | material:fac_leak |
| `Leaking008` | decal | [Leaking 008](https://ambientcg.com/view?id=Leaking008) (ambientcg) | Lennart Demes (ambientCG) | CC0-1.0 | – | material:fac_leak_band |
| `long_white_tiles` | texture | [Long White Tiles](https://polyhaven.com/a/long_white_tiles) (polyhaven) | Jenelle van Heerden, Sergej Majboroda | CC0-1.0 | – | material:fac_tiles |
| `ManholeCover003` | decal | [Manhole Cover 003](https://ambientcg.com/a/ManholeCover003) (ambientcg) | ambientCG (no individual author credited) | CC0-1.0 | Before shipping, check the rim in the full-size colour and height maps for a foundry name and remove it if present — recorded in assets-src/decal/ManholeCover003/conditions.json | material:st_manhole |
| `Marble019` | texture | [Marble 019](https://ambientcg.com/view?id=Marble019) (ambientcg) | Lennart Demes (ambientCG) | CC0-1.0 | – | material:Marble019, material:fac_marble, material:st_marble |
| `painted_metal_shutter` | texture | [Painted Metal Shutter](https://polyhaven.com/a/painted_metal_shutter) (polyhaven) | Dario Barresi, Rico Cilliers, Charlotte Baglioni | CC0-1.0 | – | material:doorInferred, material:fac_kepenk, material:fac_roller, material:hero_metal_roof |
| `PaintedWood009C` | texture | [Painted Wood 009 C](https://ambientcg.com/view?id=PaintedWood009C) (ambientcg) | Lennart Demes (ambientCG) | CC0-1.0 | – | material:door, material:hero_door, material:hero_frame, material:hero_frame_white, material:int_counter, material:int_wood_dark, material:st_gate_grey, material:st_gate_wood |
| `patterned_cobblestone` | texture | [Patterned Cobblestone](https://polyhaven.com/a/patterned_cobblestone) (polyhaven) | Rob Tuytel | CC0-1.0 | – | material:pedestrian, material:st_kup |
| `patterned_concrete_pavers` | texture | [Patterned Concrete Pavers](https://polyhaven.com/a/patterned_concrete_pavers) (polyhaven) | Amal Kumar | CC0-1.0 | – | material:sidewalk, material:st_pavers, material:st_sidewalk |
| `peeling_painted_wall` | texture | [Peeling Painted Wall](https://polyhaven.com/a/peeling_painted_wall) (polyhaven) | Dimitrios Savva | CC0-1.0 | – | material:fac_peeling |
| `ph_brick` | texture | [red_brick_03](https://polyhaven.com/a/red_brick_03) (polyhaven) | Poly Haven | CC0-1.0 | – | material:int_brick |
| `ph_concrete` | texture | [concrete_wall_008](https://polyhaven.com/a/concrete_wall_008) (polyhaven) | Poly Haven | CC0-1.0 | – | material:fac_concrete, material:fac_panel, material:fac_roof_flat, material:quay, material:roof, material:st_gutter |
| `ph_plaster` | texture | [plastered_wall](https://polyhaven.com/a/plastered_wall) (polyhaven) | Poly Haven | CC0-1.0 | – | material:fac_render_rough, material:hero_panel_cream, material:hero_panel_trim, material:hero_render, material:hero_render_soffit, material:hero_render_trim, material:hero_render_yellow, material:hero_render_yellow_trim, material:int_ceiling, material:int_wall |
| `ph_plaster_painted` | texture | [painted_plaster_wall](https://polyhaven.com/a/painted_plaster_wall) (polyhaven) | Poly Haven | CC0-1.0 | – | material:fac_render, material:st_wall_band, material:st_wall_yellow, material:wall |
| `ph_roof_tiles` | texture | [clay_roof_tiles_02](https://polyhaven.com/a/clay_roof_tiles_02) (polyhaven) | Poly Haven | CC0-1.0 | – | material:fac_roof_tiles, material:hero_roof_tile |
| `ph_stone` | texture | [white_sandstone_blocks_02](https://polyhaven.com/a/white_sandstone_blocks_02) (polyhaven) | Poly Haven | CC0-1.0 | – | material:fac_stone, material:st_kufeki, material:st_quay_wall, material:st_wall_cap |
| `ph_yard` | texture | [concrete_floor_worn_001](https://polyhaven.com/a/concrete_floor_worn_001) (polyhaven) | Poly Haven | CC0-1.0 | – | material:lot |
| `Road013B` | texture | [Road 013 B](https://ambientcg.com/view?id=Road013B) (ambientcg) | Lennart Demes (ambientCG) | CC0-1.0 | – | material:st_road_main |
| `RoadLines004` | decal | [Road Lines 004](https://ambientcg.com/view?id=RoadLines004) (ambientcg) | Lennart Demes (ambientCG) | CC0-1.0 | – | material:st_paint |
| `RoadLines010` | decal | [Road Lines 010](https://ambientcg.com/view?id=RoadLines010) (ambientcg) | Lennart Demes (ambientCG) | CC0-1.0 | – | material:st_paint_lines |
| `Terrazzo005` | texture | [Terrazzo 005](https://ambientcg.com/view?id=Terrazzo005) (ambientcg) | Lennart Demes (ambientCG) | CC0-1.0 | – | material:fac_terrazzo, material:int_floor |
| `Tiles133B` | texture | [Tiles 133 B](https://ambientcg.com/view?id=Tiles133B) (ambientcg) | Lennart Demes (ambientCG) | CC0-1.0 | – | material:hero_tile_panel, material:st_tactile |
| `wood_peeling_paint_weathered` | texture | [Wood Peeling Paint Weathered](https://polyhaven.com/a/wood_peeling_paint_weathered) (polyhaven) | Rob Tuytel, Dimitrios Savva | CC0-1.0 | – | material:fac_shutter_wood, material:fac_timber |
| `worn_shutter` | texture | [Worn Shutter](https://polyhaven.com/a/worn_shutter) (polyhaven) | Dimitrios Savva | CC0-1.0 | – | material:fac_kepenk_worn |

<!-- /GENERATED:street-assets -->
