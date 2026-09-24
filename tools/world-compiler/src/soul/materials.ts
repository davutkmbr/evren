/**
 * Materials of the soul lane (format 1, registered in registry.ts MATERIAL_SETS): the placeholder animals, the cat
 * bowls and houses, pavement spill-over, carts, bikes, anglers' kit, and the paper layer (stickers, posters, notices,
 * street-name signs) and ground residue that the soul step emits as tile geometry.
 *
 * Procedural props carry no vertex colours, so every prop colour is its own material. The paper layer and the ground
 * residue are tile geometry with COLOR_0 (one material each, the colour per sticker / poster / butt), so they cost one
 * primitive per material and tile. Palettes are dusty and sun-faded (the S1 critique: no clean pastels).
 *
 * Textures: approved sets only (tools/assets/approved.json, public/textures). Kibble and seeds borrow the relief of
 * the cobblestone set at a few centimetres per repeat; wooden cat houses use the peeling-paint wood set.
 */
import type { MaterialDef } from '../materials';

type Surface = MaterialDef['surface'];

const flat = (id: string, color: number, roughness = 0.7, metallic = 0, surface: Surface = 'other', castShadow = true): MaterialDef => ({ id, color, roughness, metallic, surface, castShadow });

/** Coats of the placeholder cats: main colour, belly / bib colour (sRGB). */
export const CAT_COATS = {
  tabby: [0x6e604e, 0xa89780],
  greytabby: [0x6a6964, 0x9c9a94],
  black: [0x1c1a19, 0x2a2725],
  tuxedo: [0x1d1b1a, 0xe2ddd3],
  ginger: [0xa9652f, 0xd8b088],
  calico: [0xe0dbd0, 0xe0dbd0],
  white: [0xe3ded4, 0xd6cfc2],
} as const;
export type CatCoat = keyof typeof CAT_COATS;

export const DOG_COATS = {
  tan: [0x98805f, 0x2a231d],
  blond: [0xbcae92, 0x6e5a46],
} as const;
export type DogCoat = keyof typeof DOG_COATS;

export const SOUL_MATERIALS: MaterialDef[] = [
  /* Placeholder animals (fur and feathers are matt). */
  ...Object.entries(CAT_COATS).flatMap(([k, [main, bib]]): MaterialDef[] => [flat(`soul_cat_${k}`, main, 0.92, 0, 'fabric'), flat(`soul_cat_${k}_bib`, bib, 0.92, 0, 'fabric')]),
  flat('soul_cat_patch_orange', 0xb06a33, 0.92, 0, 'fabric'),
  flat('soul_cat_patch_black', 0x231f1d, 0.92, 0, 'fabric'),
  flat('soul_cat_nose', 0x8a5a55, 0.6),
  flat('soul_eye', 0x1a1812, 0.15),
  ...Object.entries(DOG_COATS).flatMap(([k, [main, mask]]): MaterialDef[] => [flat(`soul_dog_${k}`, main, 0.92, 0, 'fabric'), flat(`soul_dog_${k}_mask`, mask, 0.92, 0, 'fabric')]),
  flat('soul_ear_tag', 0xd9b21e, 0.5),
  flat('soul_gull_white', 0xe9e8e3, 0.85, 0, 'fabric'),
  flat('soul_gull_grey', 0x9aa1a7, 0.85, 0, 'fabric'),
  flat('soul_gull_juvenile', 0x8a7d6c, 0.9, 0, 'fabric'),
  flat('soul_gull_black', 0x1b1b1c, 0.8, 0, 'fabric'),
  flat('soul_gull_yellow', 0xd8b53a, 0.5),
  flat('soul_gull_red', 0xb0302a, 0.5),
  flat('soul_pigeon_grey', 0x6f737b, 0.85, 0, 'fabric'),
  flat('soul_pigeon_wing', 0x5e626a, 0.85, 0, 'fabric'),
  flat('soul_pigeon_neck', 0x46514f, 0.55, 0, 'fabric'),
  flat('soul_pigeon_dark', 0x4d4f55, 0.85, 0, 'fabric'),
  flat('soul_pigeon_pale', 0xa9a59d, 0.85, 0, 'fabric'),
  flat('soul_pigeon_brown', 0x6e5646, 0.85, 0, 'fabric'),
  flat('soul_pigeon_leg', 0x8c4a44, 0.6),
  /* The model pigeon: COLOR_0 carries its texture, the material colour is the morph's tint. */
  flat('soul_pigeon_model_grey', 0xffffff, 0.75, 0, 'fabric'),
  flat('soul_pigeon_model_dark', 0x8c8c92, 0.75, 0, 'fabric'),
  flat('soul_pigeon_model_brown', 0xd2ae8e, 0.75, 0, 'fabric'),
  /* Bowls, food and water. */
  { id: 'soul_kibble', color: 0x6a4a2c, textures: { asset: 'patterned_cobblestone' }, maps: { baseColor: false }, tiling: [0.05, 0.05], normalScale: 1.8, roughness: 0.85, surface: 'other', castShadow: true },
  { id: 'soul_water', color: 0x1f272c, roughness: 0.04, surface: 'other', castShadow: false },
  { id: 'soul_bottle', color: 0xc9d8dc, roughness: 0.15, alphaMode: 'BLEND', surface: 'glass', castShadow: false, doubleSided: true },
  flat('soul_tub_white', 0xe6e3da, 0.45),
  flat('soul_tub_rim', 0x2f6aa5, 0.45),
  flat('soul_ceramic', 0xe8e4da, 0.25),
  flat('soul_ceramic_rim', 0x3d5d8a, 0.25),
  flat('soul_steel', 0xb9bcbd, 0.28, 0.85, 'metal'),
  flat('soul_foil', 0xc8c9c6, 0.35, 0.8, 'metal'),
  flat('soul_cardboard', 0x9d7b55, 0.95, 0, 'other'),
  flat('soul_cardboard_dark', 0x7d6045, 0.95, 0, 'other'),
  /* Cat houses. */
  { id: 'soul_house_wood', color: 0xb49774, textures: { asset: 'wood_peeling_paint_weathered' }, tiling: [0.8, 0.8], surface: 'wood', castShadow: true },
  { id: 'soul_house_paint_blue', color: 0x6f8fa8, textures: { asset: 'wood_peeling_paint_weathered' }, maps: { baseColor: false }, tiling: [0.8, 0.8], surface: 'wood', castShadow: true },
  flat('soul_house_roof', 0x5a4a3f, 0.8, 0, 'wood'),
  flat('soul_paint_yellow', 0xd6b04a, 0.7),
  flat('soul_paint_red', 0xb1473a, 0.7),
  flat('soul_paint_green', 0x6c9a4e, 0.7),
  flat('soul_hole', 0x0d0c0b, 0.95, 0, 'other', false),
  flat('soul_eps', 0xebebe6, 0.9),
  flat('soul_tape', 0xa98a52, 0.4),
  flat('soul_binbag', 0x17181a, 0.35),
  { id: 'soul_flap', color: 0xdfe4e6, roughness: 0.2, alphaMode: 'BLEND', surface: 'glass', castShadow: false, doubleSided: true },
  flat('soul_blanket', 0x7b5261, 0.95, 0, 'fabric'),
  /* Spill-over. */
  { id: 'soul_carboy', color: 0x6fa0c8, roughness: 0.12, alphaMode: 'BLEND', surface: 'glass', castShadow: true },
  flat('soul_carboy_cap', 0x2d58a0, 0.45),
  flat('soul_cyl_blue', 0x3a5f8c, 0.45, 0.3, 'metal'),
  flat('soul_cyl_grey', 0x8b9094, 0.45, 0.3, 'metal'),
  flat('soul_cyl_orange', 0xc2692b, 0.45, 0.3, 'metal'),
  flat('soul_cage', 0x4b4e50, 0.55, 0.7, 'metal'),
  flat('soul_chrome', 0xc4c7c9, 0.2, 0.95, 'metal'),
  flat('soul_cloth_a', 0x3b4c63, 0.9, 0, 'fabric'),
  flat('soul_cloth_b', 0x8c3b37, 0.9, 0, 'fabric'),
  flat('soul_cloth_c', 0xc8bfae, 0.9, 0, 'fabric'),
  flat('soul_cloth_d', 0x4f5b3e, 0.9, 0, 'fabric'),
  flat('soul_cloth_e', 0x2a2a2d, 0.9, 0, 'fabric'),
  flat('soul_form', 0xd9cdb8, 0.7, 0, 'other'),
  { id: 'soul_jute', color: 0xa38a62, textures: { public: 'plaster' }, maps: { baseColor: false }, tiling: [0.35, 0.35], normalScale: 1.5, roughness: 0.95, surface: 'fabric', castShadow: true },
  { id: 'soul_beans', color: 0xc9b99a, textures: { asset: 'patterned_cobblestone' }, maps: { baseColor: false }, tiling: [0.06, 0.06], normalScale: 1.6, roughness: 0.8, surface: 'other', castShadow: true },
  { id: 'soul_lentils', color: 0xa04a2a, textures: { asset: 'patterned_cobblestone' }, maps: { baseColor: false }, tiling: [0.04, 0.04], normalScale: 1.4, roughness: 0.8, surface: 'other', castShadow: true },
  { id: 'soul_nuts', color: 0x8a6a45, textures: { asset: 'patterned_cobblestone' }, maps: { baseColor: false }, tiling: [0.08, 0.08], normalScale: 1.8, roughness: 0.75, surface: 'other', castShadow: true },
  { id: 'soul_spice', color: 0xa8321f, textures: { public: 'plaster' }, maps: { baseColor: false }, tiling: [0.2, 0.2], normalScale: 0.8, roughness: 0.95, surface: 'other', castShadow: true },
  flat('soul_crate_green', 0x3f6b45, 0.6),
  flat('soul_crate_red', 0x9b3a2e, 0.6),
  flat('soul_crate_wood', 0xa08462, 0.9, 0, 'wood'),
  flat('soul_pallet', 0x8a7458, 0.9, 0, 'wood'),
  flat('soul_produce_a', 0xa8321f, 0.45),
  flat('soul_produce_b', 0xc59a2a, 0.5),
  flat('soul_produce_c', 0x557a2c, 0.6),
  flat('soul_stool_red', 0xa3342b, 0.5),
  flat('soul_stool_blue', 0x2e5585, 0.5),
  flat('soul_tray', 0xb8b3a6, 0.3, 0.85, 'metal'),
  { id: 'soul_tea', color: 0x8a3b12, roughness: 0.08, alphaMode: 'BLEND', surface: 'glass', castShadow: false },
  /* Waste and utilities. */
  { id: 'soul_galv', color: 0x9da2a3, textures: { asset: 'green_metal_rust' }, maps: { baseColor: false }, tiling: [1.2, 1.2], roughness: 0.55, metallic: 0.7, surface: 'metal', castShadow: true },
  flat('soul_bin_green', 0x2f4a36, 0.55),
  flat('soul_bin_lid', 0x263c2c, 0.5),
  flat('soul_glass_bin', 0x3c6b4a, 0.45),
  flat('soul_rubber', 0x1a1a1a, 0.85),
  flat('soul_battery_box', 0x5b8a3a, 0.5),
  flat('soul_hose', 0x2f6b3a, 0.45),
  /* Carts. */
  { id: 'soul_cart_glass', color: 0xe6eef0, roughness: 0.05, alphaMode: 'BLEND', surface: 'glass', castShadow: false, doubleSided: true },
  flat('soul_cart_blue', 0x2b5d8c, 0.45, 0.2),
  flat('soul_cart_white', 0xe4e2dc, 0.45),
  flat('soul_cart_steel', 0xa9adb0, 0.3, 0.85, 'metal'),
  flat('soul_simit', 0xa8662d, 0.7),
  flat('soul_corn', 0xd9a936, 0.6),
  flat('soul_corn_husk', 0xb9ad7a, 0.8),
  { id: 'soul_coals', color: 0x2a1a14, roughness: 0.9, surface: 'other', castShadow: false, emissive: { color: 0xff6a20, nits: 150, night: false, source: 'other' } },
  flat('soul_umbrella', 0xd8d2c2, 0.9, 0, 'fabric'),
  flat('soul_platform', 0x8d7458, 0.85, 0, 'wood'),
  /* Motorbikes and e-scooters (fictional liveries, no logos). */
  flat('soul_bike_body_red', 0x9a2a26, 0.35, 0.3),
  flat('soul_bike_body_grey', 0x6e7275, 0.35, 0.3),
  flat('soul_bike_body_black', 0x1d1e20, 0.35, 0.3),
  flat('soul_bike_body_white', 0xdad8d2, 0.35, 0.3),
  flat('soul_box_orange', 0xd0712a, 0.5),
  flat('soul_box_teal', 0x2a8a86, 0.5),
  flat('soul_box_purple', 0x5a3a78, 0.5),
  flat('soul_box_yellow', 0xd6b43a, 0.5),
  flat('soul_seat', 0x151516, 0.6),
  flat('soul_metal_dark', 0x2b2c2e, 0.45, 0.7, 'metal'),
  { id: 'soul_headlight', color: 0xdfe3e4, roughness: 0.1, surface: 'glass', castShadow: false },
  flat('soul_scooter_lime', 0x8fb33a, 0.45),
  flat('soul_scooter_teal', 0x2f8f8a, 0.45),
  flat('soul_scooter_magenta', 0xa33a6e, 0.45),
  flat('soul_scooter_orange', 0xd27a2a, 0.45),
  /* Anglers' kit. */
  flat('soul_rod', 0x2a2724, 0.4),
  flat('soul_bucket_white', 0xdedad0, 0.5),
  flat('soul_bucket_blue', 0x315d91, 0.5),
  flat('soul_bait_box', 0x3e6a8a, 0.5),
  flat('soul_stool_canvas', 0x3c4a3a, 0.9, 0, 'fabric'),
  flat('soul_fish', 0x9aa6ad, 0.3, 0.4),
  /* Paper layer and ground residue (tile geometry, COLOR_0 per item). */
  { id: 'soul_sticker', color: 0xffffff, roughness: 0.45, surface: 'other', castShadow: false },
  { id: 'soul_paper', color: 0xffffff, roughness: 0.9, surface: 'other', castShadow: false, doubleSided: false },
  { id: 'soul_sign', color: 0xffffff, roughness: 0.4, surface: 'other', castShadow: true },
  { id: 'soul_litter', color: 0xffffff, roughness: 0.8, surface: 'other', castShadow: false },
  { id: 'soul_wet', color: 0x2a2c2d, roughness: 0.05, alphaMode: 'BLEND', surface: 'ground', castShadow: false },
  { id: 'soul_stain', color: 0xffffff, textures: { asset: 'Leaking008' }, maps: { normal: false }, alphaMode: 'BLEND', roughness: 0.9, surface: 'other', castShadow: false },
];
