/**
 * Materials of the street lane (format 1), registered through registry.ts. Textures are the approved sets
 * (tools/assets/approved.json) and the public Poly Haven sets; tints are sRGB multipliers of the base colour.
 *
 * Surfaces (s1-strip.md §3): patched asphalt on the main roads (Road013B) and plain asphalt elsewhere (asphalt_02),
 * interlocking concrete pavers on raised sidewalks and squares, grey slabs (≈ 0.48 m) in Yasa Cd and the market
 * lanes, küp taş where OSM tags sett / cobblestone, granite kerb stones, concrete gutters, yellow tactile strips at
 * dropped kerbs, granite coping and stone quay walls on the Rıhtım.
 */
import { type MaterialDef, materialVariant, type WeatherDef } from '../materials';

/**
 * Ground weathering (format 1.1, street/wear.ts sets the channels): grime in the paving joints and dirt texture
 * (dirt: contact grime at walls, gutters, desire lines), darker and glossier damp (w: puddle rims, gutters).
 */
export const GROUND_WEATHER: WeatherDef = {
  dirt: { material: 'wx_grime', tint: 0xb0a595, blend: 'multiply', strength: 0.8, roughness: 0.95 },
  damp: { blend: 'multiply', darken: 0.55, roughness: 0.22 },
};
/** Kerb and coping stones: as the ground, plus chipped arrises (edge: the lighter fresh break of the granite). */
export const KERB_WEATHER: WeatherDef = {
  ...GROUND_WEATHER,
  edge: { tint: 0xe2dfd8, blend: 'mix', strength: 0.8, roughness: 0.85, curvature: 0.75 },
};
/** Lawns: bare, compacted soil (dirt) in worn patches, along the edges and on the short cuts. */
export const LAWN_WEATHER: WeatherDef = {
  dirt: { material: 'wx_soil', blend: 'mix', strength: 1, roughness: 1 },
};

/**
 * Worn street furniture (format 1.1, the `@worn` variants the kit props use with their wear painter, kit-props.ts):
 * grime in the base and the joints (dirt), rust runs below caps, collars and bolts (streak), paint chipped to rust or
 * primer on the convex edges (edge), splash at the foot (damp). Flat layers (no textures) except the grime.
 */
const RUSTY_PAINT: WeatherDef = {
  dirt: { material: 'wx_grime', tint: 0xa39a8e, blend: 'multiply', strength: 0.85, roughness: 0.9 },
  streak: { tint: 0x6b3b1d, blend: 'mix', strength: 0.8, roughness: 0.85 },
  // Chips show dark rusty steel, not bright rust: thin posts are all "edge" to a bevel-based convexity estimate.
  edge: { tint: 0x5a4131, blend: 'mix', strength: 0.65, roughness: 0.9, curvature: 0.9 },
  damp: { blend: 'multiply', darken: 0.72, roughness: 0.55 },
};
/** Blue İBB paint chips to grey galvanised steel, rust only in the runs. */
const CHIPPED_BLUE: WeatherDef = { ...RUSTY_PAINT, edge: { tint: 0x9c9d98, blend: 'mix', strength: 0.9, roughness: 0.6, curvature: 0.8 } };
/** Galvanised poles: grime and splash at the foot, rust bleed under fittings, dull scuffs. */
const GALVANISED: WeatherDef = { ...RUSTY_PAINT, edge: { tint: 0xb2b3ae, blend: 'mix', strength: 0.6, roughness: 0.7, curvature: 0.8 } };
/** Bench slats: scuffed to bare, lighter wood on the edges; grime. */
const WORN_WOOD: WeatherDef = {
  dirt: { material: 'wx_grime', tint: 0xa0968a, blend: 'multiply', strength: 0.8, roughness: 0.95 },
  edge: { tint: 0xb99d7c, blend: 'mix', strength: 0.85, roughness: 0.9, curvature: 0.8 },
  damp: { blend: 'multiply', darken: 0.75, roughness: 0.6 },
};
/** Cast concrete feet and planters: grime and damp splash at the foot. */
const DIRTY_CONCRETE: WeatherDef = {
  dirt: { material: 'wx_grime', tint: 0x8f8579, blend: 'multiply', strength: 0.9, roughness: 0.95 },
  edge: { tint: 0xd6d2c8, blend: 'mix', strength: 0.5, roughness: 0.9, curvature: 0.8 },
  damp: { blend: 'multiply', darken: 0.65, roughness: 0.6 },
};

export const GROUND_MATERIALS: MaterialDef[] = [
  // Soil of the lawn wear layer and the tree pits (forest_ground_05, CC0).
  { id: 'wx_soil', color: 0xffffff, textures: { asset: 'forest_ground_05' }, tiling: [2, 2], surface: 'other', castShadow: false },
  { id: 'st_road_main', color: 0xf4f4f4, textures: { asset: 'Road013B' }, tiling: [5, 5], surface: 'ground', weather: GROUND_WEATHER },
  { id: 'st_road', color: 0xe8e8e8, textures: { asset: 'asphalt_02' }, surface: 'ground', weather: GROUND_WEATHER },
  { id: 'st_slabs', color: 0xd6dde4, textures: { asset: 'granite_tile_04' }, tiling: [2.4, 2.4], surface: 'ground', weather: GROUND_WEATHER },
  { id: 'st_kup', color: 0xe6e6e6, textures: { asset: 'patterned_cobblestone' }, surface: 'ground', weather: GROUND_WEATHER },
  { id: 'st_sidewalk', color: 0xf2f2f2, textures: { asset: 'patterned_concrete_pavers' }, surface: 'ground', weather: GROUND_WEATHER },
  // Grey interlocking pavers of the square (c02): the set's relief, joints (AO) and roughness with a flat grey, so the
  // set's warm albedo and its colour repeat do not show; COLOR_0 carries the wear and a 13-30 m macro variation.
  // Darker than round 1 (the photos' pavers are mid grey, round 1 read "near-white").
  { id: 'st_pavers', color: 0x8b8d8c, textures: { asset: 'patterned_concrete_pavers' }, maps: { baseColor: false }, tiling: [2.2, 2.2], normalScale: 0.9, surface: 'ground', weather: GROUND_WEATHER },
  { id: 'st_kerb', color: 0xe6e8ea, textures: { asset: 'granite_tile_04' }, tiling: [4, 2], surface: 'ground', weather: KERB_WEATHER },
  { id: 'st_gutter', color: 0xb9bdc0, textures: { public: 'concrete' }, tiling: [2.7, 2.7], surface: 'ground', weather: GROUND_WEATHER },
  { id: 'st_tactile', color: 0xf0b21a, textures: { asset: 'Tiles133B' }, tiling: [3.6, 3.6], roughness: 0.85, surface: 'ground' },
  { id: 'st_coping', color: 0xdcdad4, textures: { asset: 'granite_tile_04' }, tiling: [5, 2.5], surface: 'ground', weather: KERB_WEATHER },
  { id: 'st_quay_wall', color: 0xc8c4bb, textures: { public: 'stone' }, tiling: [2.5, 2.5], surface: 'wall' },
  { id: 'st_rail', color: 0xb0aea8, metallic: 0.9, roughness: 0.3, surface: 'metal', castShadow: false },
  { id: 'st_groove', color: 0x1b1a19, roughness: 0.9, surface: 'ground', castShadow: false },
  { id: 'st_paint', color: 0xf4f4f0, textures: { asset: 'RoadLines004' }, alphaMode: 'MASK', alphaCutoff: 0.45, surface: 'ground', castShadow: false },
  { id: 'st_paint_lines', color: 0xf4f4f0, textures: { asset: 'RoadLines010' }, alphaMode: 'MASK', alphaCutoff: 0.45, surface: 'ground', castShadow: false },
  { id: 'st_manhole', color: 0xffffff, textures: { asset: 'ManholeCover003' }, alphaMode: 'MASK', alphaCutoff: 0.5, surface: 'ground', castShadow: false },
  /* Lawns: short, part-dry city grass (Grass004, CC0) toned towards the late-September photos, COLOR_0 mottling and
     edge AO, and bare soil (LAWN_WEATHER) in worn patches, along the edges and on the short cuts (ground.ts). */
  { id: 'st_grass', color: 0xc9c7b0, textures: { asset: 'Grass004' }, tiling: [1.4, 1.4], roughness: 1, surface: 'ground', weather: LAWN_WEATHER },
  { id: 'st_iron', color: 0x34322f, metallic: 0.7, roughness: 0.55, surface: 'metal', castShadow: false },
  /* Square guide line (white pavers), and wet films: puddles in paving hollows, wet paving at drains and fish stalls. */
  { id: 'st_guide', color: 0xe9e8e2, textures: { asset: 'Tiles133B' }, tiling: [0.6, 0.6], roughness: 0.7, surface: 'ground', castShadow: false },
  { id: 'st_wet', color: 0x1e2022, roughness: 0.04, alphaMode: 'BLEND', surface: 'ground', castShadow: false },
  /* Wear (street/wear.ts): the square's concrete apron and its repairs, newer asphalt patches, tree-pit soil. */
  { id: 'st_apron', color: 0xbcbbb6, textures: { public: 'concrete' }, tiling: [3.2, 3.2], normalScale: 0.6, surface: 'ground', weather: GROUND_WEATHER },
  { id: 'st_apron_patch', color: 0x96958f, textures: { public: 'concrete' }, tiling: [2.1, 2.1], normalScale: 0.8, surface: 'ground', weather: GROUND_WEATHER },
  { id: 'st_road_patch', color: 0x9c9c9a, textures: { asset: 'asphalt_02' }, tiling: [2.2, 2.2], surface: 'ground', weather: GROUND_WEATHER },
  { id: 'st_pit_soil', color: 0xb0a898, textures: { asset: 'forest_ground_05' }, tiling: [1.6, 1.6], roughness: 1, surface: 'ground' },
  /* Stains and damage (procedural decal geometry, colour and alpha in COLOR_0): oil and drips, grime halos, chewing
     gum, missing pavers, cracks, tar-sealed cracks and bitumen seals along the rails. */
  { id: 'st_oil', color: 0xffffff, roughness: 0.32, alphaMode: 'BLEND', surface: 'ground', castShadow: false },
  { id: 'st_grime', color: 0xffffff, roughness: 0.95, alphaMode: 'BLEND', surface: 'ground', castShadow: false },
  { id: 'st_gum', color: 0xffffff, roughness: 0.6, alphaMode: 'BLEND', surface: 'ground', castShadow: false },
  { id: 'st_gap', color: 0x3a2f25, roughness: 1, surface: 'ground', castShadow: false },
  { id: 'st_crack', color: 0xffffff, roughness: 0.95, surface: 'ground', castShadow: false },
  { id: 'st_seal', color: 0xffffff, roughness: 0.3, surface: 'ground', castShadow: false },
];

/** Street furniture, cables, the Aya Efimia precinct wall and fountain. */
export const KIT_MATERIALS: MaterialDef[] = [
  { id: 'st_black_metal', color: 0x1e1f21, metallic: 0.6, roughness: 0.45, surface: 'metal', castShadow: true },
  { id: 'st_grey_metal', color: 0x8d9194, metallic: 0.7, roughness: 0.42, surface: 'metal', castShadow: true },
  { id: 'st_blue_metal', color: 0x2e6db3, metallic: 0.35, roughness: 0.45, surface: 'metal', castShadow: true },
  { id: 'st_bin_liner', color: 0x1a1a1c, roughness: 0.6, surface: 'other', castShadow: true },
  { id: 'st_bench_wood', color: 0x9a6a44, textures: { asset: 'wood_peeling_paint_weathered' }, tiling: [0.9, 0.9], surface: 'wood', castShadow: true },
  { id: 'st_concrete', color: 0xd2d0ca, textures: { public: 'concrete' }, tiling: [1.5, 1.5], surface: 'other', castShadow: true },
  { id: 'st_cabinet', color: 0xb8bbb4, textures: { asset: 'painted_metal_shutter' }, tiling: [1.2, 1.2], surface: 'metal', castShadow: true },
  { id: 'st_sign_navy', color: 0x1d2a4a, roughness: 0.5, surface: 'other', castShadow: true },
  { id: 'st_sign_white', color: 0xeeeeea, roughness: 0.5, surface: 'other', castShadow: false },
  { id: 'st_sign_red', color: 0xc02020, roughness: 0.5, surface: 'other', castShadow: false },
  { id: 'st_sign_blue', color: 0x1f5fb0, roughness: 0.5, surface: 'other', castShadow: false },
  { id: 'st_signal_lens_red', color: 0x5a0d0a, roughness: 0.2, surface: 'glass', emissive: { color: 0xff3020, nits: 900, night: false, source: 'other' } },
  { id: 'st_signal_lens_green', color: 0x0a3a24, roughness: 0.2, surface: 'glass', emissive: { color: 0x30ff90, nits: 900, night: false, source: 'other' } },
  { id: 'st_signal_lens_off', color: 0x16181a, roughness: 0.15, metallic: 0.2, surface: 'glass' },
  // Plane bark (bark_platanus, CC0) under the three patch tints of the exfoliating bark; twigs darker.
  { id: 'st_bark', color: 0xc9c6bc, textures: { asset: 'bark_platanus' }, tiling: [1.2, 1.2], surface: 'plant', castShadow: true },
  { id: 'st_bark_olive', color: 0xb3ad86, textures: { asset: 'bark_platanus' }, tiling: [1.2, 1.2], surface: 'plant', castShadow: true },
  { id: 'st_bark_cream', color: 0xf0e7cc, textures: { asset: 'bark_platanus' }, tiling: [1.2, 1.2], normalScale: 0.6, surface: 'plant', castShadow: true },
  { id: 'st_bark_twig', color: 0x8a8070, textures: { asset: 'bark_platanus' }, tiling: [0.6, 0.6], surface: 'plant', castShadow: true },
  // Leaf cards: one leaf of the LeafSet010 atlas per card (alpha cut-out), toned per card by COLOR_0.
  { id: 'st_leaf_card', color: 0x9fb07e, textures: { asset: 'LeafSet010' }, tiling: [1, 1], alphaMode: 'MASK', alphaCutoff: 0.45, doubleSided: true, roughness: 0.65, surface: 'plant', castShadow: true },
  { id: 'st_leaf_a', color: 0x4d6a2a, roughness: 0.7, doubleSided: true, surface: 'plant', castShadow: true },
  { id: 'st_leaf_b', color: 0x3a5524, roughness: 0.75, doubleSided: true, surface: 'plant', castShadow: true },
  { id: 'st_leaf_c', color: 0x6a7d31, roughness: 0.7, doubleSided: true, surface: 'plant', castShadow: true },
  { id: 'st_leaves', color: 0x48662e, roughness: 0.9, surface: 'plant', castShadow: true },
  { id: 'st_leaves_dark', color: 0x36522a, roughness: 0.9, surface: 'plant', castShadow: true },
  { id: 'st_soil', color: 0x3b2f25, roughness: 1, surface: 'ground', castShadow: false },
  { id: 'st_cable', color: 0x151515, roughness: 0.7, surface: 'other', castShadow: false },
  { id: 'st_lamp_glass_warm', color: 0xf6efe0, roughness: 0.2, surface: 'glass', emissive: { color: 0xffc78a, nits: 12000, night: true, source: 'lamp' } },
  { id: 'st_chalk', color: 0xe8e6de, roughness: 1, surface: 'other', castShadow: false },
  { id: 'st_wall_yellow', color: 0xf0c865, textures: { public: 'plaster_painted' }, tiling: [2, 2], surface: 'wall', castShadow: true },
  { id: 'st_wall_band', color: 0xc9953f, textures: { public: 'plaster_painted' }, tiling: [2, 2], surface: 'wall', castShadow: true },
  { id: 'st_wall_cap', color: 0xd9d2c4, textures: { public: 'stone' }, tiling: [1.5, 1.5], surface: 'wall', castShadow: true },
  // Küfeki limestone ashlar: smooth, light grey, jointed blocks (granite tile relief, flat colour, low bump).
  { id: 'st_kufeki', color: 0xc8bfae, textures: { asset: 'granite_tile_04' }, maps: { baseColor: false }, tiling: [1.6, 1.6], normalScale: 0.35, surface: 'wall', castShadow: true },
  { id: 'st_kufeki_dark', color: 0x6c675e, textures: { asset: 'granite_tile_04' }, maps: { baseColor: false }, tiling: [1.6, 1.6], normalScale: 0.35, surface: 'wall', castShadow: true },
  { id: 'st_gate_steel', color: 0x8e979d, roughness: 0.45, metallic: 0.35, surface: 'metal', castShadow: true },
  { id: 'st_gate_steel_dark', color: 0x5d656a, roughness: 0.5, metallic: 0.35, surface: 'metal', castShadow: true },
  { id: 'st_marble', color: 0xf2f0ea, textures: { asset: 'Marble019' }, tiling: [1.2, 1.2], surface: 'other', castShadow: true },
  { id: 'st_inscription', color: 0x121414, roughness: 0.35, surface: 'other', castShadow: false },
  { id: 'st_gilt', color: 0xc8a052, metallic: 0.8, roughness: 0.35, surface: 'metal', castShadow: false },
  { id: 'st_gate_wood', color: 0xc9a066, textures: { asset: 'PaintedWood009C' }, tiling: [1.2, 2.4], surface: 'wood', castShadow: true },
  { id: 'st_gate_grey', color: 0xb7bcc0, textures: { asset: 'PaintedWood009C' }, tiling: [1.2, 2.4], surface: 'wood', castShadow: true },
  { id: 'st_fanlight', color: 0x3b4650, roughness: 0.15, metallic: 0.2, surface: 'glass', castShadow: false, emissive: { color: 0xffd7a0, nits: 60, night: true, source: 'window' } },
  { id: 'st_roof_tile', color: 0xc9d0d0, textures: { public: 'roof_tiles' }, tiling: [2.5, 2.5], surface: 'roof', castShadow: true },
  // Blue-painted steel slats of the square's benches (c01, c02 photos).
  { id: 'st_bench_steel', color: 0x3c5876, metallic: 0.35, roughness: 0.55, surface: 'metal', castShadow: true },
];

const byId = (id: string): MaterialDef => KIT_MATERIALS.find((d) => d.id === id)!;

/** `@worn` variants of the furniture materials (registered after their bases). */
export const WORN_MATERIALS: MaterialDef[] = [
  materialVariant(byId('st_black_metal'), 'worn', { roughness: 0.6, weather: RUSTY_PAINT }),
  materialVariant(byId('st_blue_metal'), 'worn', { roughness: 0.62, metallic: 0.25, weather: CHIPPED_BLUE }),
  materialVariant(byId('st_grey_metal'), 'worn', { roughness: 0.55, weather: GALVANISED }),
  materialVariant(byId('st_bench_wood'), 'worn', { weather: WORN_WOOD }),
  materialVariant(byId('st_bench_steel'), 'worn', { weather: CHIPPED_BLUE }),
  materialVariant(byId('st_concrete'), 'worn', { weather: DIRTY_CONCRETE }),
];

/** Placeholder people: neutral cloth, skin and hair tones (flat colours, no textures). */
export const PERSON_TOPS = [0x2b2f36, 0x6b1f24, 0x2f4a6e, 0xb8b2a6, 0x3f5a3c, 0x8a6a3a, 0x1c1c1e, 0x7a7f86, 0xa24a2a, 0xd8d4c8];
export const PERSON_BOTTOMS = [0x23262c, 0x34455e, 0x4a4036, 0x1b1b1d, 0x6a6660];
export const PERSON_SKIN = [0xe0b394, 0xc68f6a, 0x9c6a4c];

export const PERSON_MATERIALS: MaterialDef[] = [
  ...PERSON_TOPS.map((c, k): MaterialDef => ({ id: `st_person_top${k}`, color: c, roughness: 0.85, surface: 'fabric', castShadow: true })),
  ...PERSON_BOTTOMS.map((c, k): MaterialDef => ({ id: `st_person_bottom${k}`, color: c, roughness: 0.85, surface: 'fabric', castShadow: true })),
  ...PERSON_SKIN.map((c, k): MaterialDef => ({ id: `st_person_skin${k}`, color: c, roughness: 0.6, surface: 'other', castShadow: true })),
  { id: 'st_person_hair', color: 0x2a2119, roughness: 0.7, surface: 'other', castShadow: true },
  { id: 'st_person_shoe', color: 0x18181a, roughness: 0.6, surface: 'other', castShadow: true },
];

export const STREET_MATERIALS: MaterialDef[] = [...GROUND_MATERIALS, ...KIT_MATERIALS, ...WORN_MATERIALS, ...PERSON_MATERIALS];
