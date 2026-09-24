/**
 * Materials of the street lane (format 1), registered through registry.ts. Textures are the approved sets
 * (tools/assets/approved.json) and the public Poly Haven sets; tints are sRGB multipliers of the base colour.
 *
 * Surfaces (s1-strip.md §3): patched asphalt on the main roads (Road013B) and plain asphalt elsewhere (asphalt_02),
 * interlocking concrete pavers on raised sidewalks and squares, grey slabs (≈ 0.48 m) in Yasa Cd and the market
 * lanes, küp taş where OSM tags sett / cobblestone, granite kerb stones, concrete gutters, yellow tactile strips at
 * dropped kerbs, granite coping and stone quay walls on the Rıhtım.
 */
import type { MaterialDef } from '../materials';

export const GROUND_MATERIALS: MaterialDef[] = [
  { id: 'st_road_main', color: 0xf4f4f4, textures: { asset: 'Road013B' }, tiling: [5, 5], surface: 'ground' },
  { id: 'st_road', color: 0xe8e8e8, textures: { asset: 'asphalt_02' }, surface: 'ground' },
  { id: 'st_slabs', color: 0xd6dde4, textures: { asset: 'granite_tile_04' }, tiling: [2.4, 2.4], surface: 'ground' },
  { id: 'st_kup', color: 0xe6e6e6, textures: { asset: 'patterned_cobblestone' }, surface: 'ground' },
  { id: 'st_sidewalk', color: 0xf2f2f2, textures: { asset: 'patterned_concrete_pavers' }, surface: 'ground' },
  { id: 'st_pavers', color: 0xcfd4d8, textures: { asset: 'patterned_concrete_pavers' }, tiling: [2.2, 2.2], surface: 'ground' },
  { id: 'st_kerb', color: 0xe6e8ea, textures: { asset: 'granite_tile_04' }, tiling: [4, 2], surface: 'ground' },
  { id: 'st_gutter', color: 0xb9bdc0, textures: { public: 'concrete' }, tiling: [2.7, 2.7], surface: 'ground' },
  { id: 'st_tactile', color: 0xf0b21a, textures: { asset: 'Tiles133B' }, tiling: [3.6, 3.6], roughness: 0.85, surface: 'ground' },
  { id: 'st_coping', color: 0xdcdad4, textures: { asset: 'granite_tile_04' }, tiling: [5, 2.5], surface: 'ground' },
  { id: 'st_quay_wall', color: 0xc8c4bb, textures: { public: 'stone' }, tiling: [2.5, 2.5], surface: 'wall' },
  { id: 'st_rail', color: 0xb0aea8, metallic: 0.9, roughness: 0.3, surface: 'metal', castShadow: false },
  { id: 'st_groove', color: 0x1b1a19, roughness: 0.9, surface: 'ground', castShadow: false },
  { id: 'st_paint', color: 0xf4f4f0, textures: { asset: 'RoadLines004' }, alphaMode: 'MASK', alphaCutoff: 0.45, surface: 'ground', castShadow: false },
  { id: 'st_paint_lines', color: 0xf4f4f0, textures: { asset: 'RoadLines010' }, alphaMode: 'MASK', alphaCutoff: 0.45, surface: 'ground', castShadow: false },
  { id: 'st_manhole', color: 0xffffff, textures: { asset: 'ManholeCover003' }, alphaMode: 'MASK', alphaCutoff: 0.5, surface: 'ground', castShadow: false },
  { id: 'st_iron', color: 0x34322f, metallic: 0.7, roughness: 0.55, surface: 'metal', castShadow: false },
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
  { id: 'st_bark', color: 0x6d5f52, textures: { public: 'stone' }, tiling: [1.2, 1.2], surface: 'plant', castShadow: true },
  { id: 'st_leaves', color: 0x48662e, roughness: 0.9, surface: 'plant', castShadow: true },
  { id: 'st_leaves_dark', color: 0x36522a, roughness: 0.9, surface: 'plant', castShadow: true },
  { id: 'st_soil', color: 0x3b2f25, roughness: 1, surface: 'ground', castShadow: false },
  { id: 'st_cable', color: 0x151515, roughness: 0.7, surface: 'other', castShadow: false },
  { id: 'st_lamp_glass_warm', color: 0xf6efe0, roughness: 0.2, surface: 'glass', emissive: { color: 0xffc78a, nits: 12000, night: true, source: 'lamp' } },
  { id: 'st_chalk', color: 0xe8e6de, roughness: 1, surface: 'other', castShadow: false },
  { id: 'st_wall_yellow', color: 0xf0c865, textures: { public: 'plaster_painted' }, tiling: [2, 2], surface: 'wall', castShadow: true },
  { id: 'st_wall_band', color: 0xc9953f, textures: { public: 'plaster_painted' }, tiling: [2, 2], surface: 'wall', castShadow: true },
  { id: 'st_wall_cap', color: 0xd9d2c4, textures: { public: 'stone' }, tiling: [1.5, 1.5], surface: 'wall', castShadow: true },
  { id: 'st_kufeki', color: 0xe2d6bb, textures: { public: 'stone' }, tiling: [1.8, 1.8], surface: 'wall', castShadow: true },
  { id: 'st_marble', color: 0xf2f0ea, textures: { asset: 'Marble019' }, tiling: [1.2, 1.2], surface: 'other', castShadow: true },
  { id: 'st_inscription', color: 0x243a30, roughness: 0.4, surface: 'other', castShadow: false },
  { id: 'st_gilt', color: 0xc8a052, metallic: 0.8, roughness: 0.35, surface: 'metal', castShadow: false },
  { id: 'st_gate_wood', color: 0xc9a066, textures: { asset: 'PaintedWood009C' }, tiling: [1.2, 2.4], surface: 'wood', castShadow: true },
  { id: 'st_gate_grey', color: 0xb7bcc0, textures: { asset: 'PaintedWood009C' }, tiling: [1.2, 2.4], surface: 'wood', castShadow: true },
  { id: 'st_fanlight', color: 0x3b4650, roughness: 0.15, metallic: 0.2, surface: 'glass', castShadow: false, emissive: { color: 0xffd7a0, nits: 60, night: true, source: 'window' } },
  { id: 'st_roof_tile', color: 0xc9d0d0, textures: { public: 'roof_tiles' }, tiling: [2.5, 2.5], surface: 'roof', castShadow: true },
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

export const STREET_MATERIALS: MaterialDef[] = [...GROUND_MATERIALS, ...KIT_MATERIALS, ...PERSON_MATERIALS];
