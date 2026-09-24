/**
 * Materials of the hero buildings (registered in registry.ts through HERO_MATERIALS). Every texture comes from an
 * approved set: public/textures (Poly Haven) or tools/assets/approved.json. Painted render uses the plaster set's
 * relief and roughness with a flat colour (maps.baseColor false), because the set's albedo is too dark for the white
 * and ochre renders of the photos.
 *
 * Format 1.1 (S1 round 2, realism): the tints are the dusty, desaturated colours sampled from the reference photos
 * (c01, c03, c04, c09), and every material the heroes weather has an `@weathered` variant with weather layers
 * (hero/weather.ts drives them per vertex): renders and trims take the shared WALL_WEATHER preset; stone gets black
 * rain streaks and lighter chipped arrises; tile roofs lichen and soot patches; lead a pale patina; iron rust; painted
 * joinery peeling paint on its edges; glazed tiles grime. `@patch` variants are the slightly different renders of
 * repair patches. `hero_leak` / `hero_leak_band` are the streak and base-band decals (Leaking003 / Leaking008).
 */
import { type MaterialDef, WALL_WEATHER, type WeatherDef, withVariants } from '../materials';

const render = (id: string, color: number): MaterialDef => ({ id, color, textures: { public: 'plaster' }, maps: { baseColor: false }, tiling: [2.2, 2.2], normalScale: 0.8, surface: 'wall' });

/** Cut stone and stone plinths: soot-black rain streaks, lighter chipped arrises, dark damp. */
const STONE_WX: WeatherDef = {
  dirt: { material: 'wx_grime', tint: 0x7d766c, blend: 'multiply', strength: 0.95, roughness: 0.95 },
  streak: { material: 'wx_streak', tint: 0x35302b, tiling: [1.4, 2.6], mirror: true, strength: 1.5, roughness: 0.9 },
  edge: { tint: 0xeee8dc, blend: 'mix', strength: 0.5, curvature: 0.85, roughness: 0.85 },
  damp: { blend: 'multiply', darken: 0.6, roughness: 0.5 },
};
/** Marseille tiles: lichen and soot patches, darker where water runs. */
const ROOF_WX: WeatherDef = {
  dirt: { material: 'wx_grime', tint: 0x68644f, blend: 'multiply', strength: 1, roughness: 0.95 },
  streak: { material: 'wx_streak', tint: 0x3d3a30, tiling: [1.5, 2.5], mirror: true, strength: 1, roughness: 0.9 },
};
/** Painted standing-seam and canopy metal: dust and dirty run-off. */
const METAL_ROOF_WX: WeatherDef = {
  dirt: { material: 'wx_grime', tint: 0x8f8c86, blend: 'multiply', strength: 0.9, roughness: 0.8 },
  streak: { material: 'wx_streak', tint: 0x5a5047, tiling: [1.2, 2.2], mirror: true, strength: 1.2, roughness: 0.8 },
};
/** Lead: a pale carbonate patina in patches and dark run-off. */
const LEAD_WX: WeatherDef = {
  dirt: { material: 'wx_grime', tint: 0xb9bcb6, blend: 'mix', strength: 0.55, roughness: 0.8 },
  streak: { material: 'wx_streak', tint: 0x3f423f, tiling: [1.2, 2.4], mirror: true, strength: 1.2, roughness: 0.7 },
};
/** Wrought and cast iron: rust in patches and on edges. */
const IRON_WX: WeatherDef = {
  dirt: { material: 'green_metal_rust', tint: 0x7a5a48, blend: 'mix', strength: 0.75, roughness: 0.85 },
  edge: { material: 'green_metal_rust', tint: 0x9a6a4a, blend: 'mix', strength: 1, curvature: 0.6, roughness: 0.9 },
};
/** Painted joinery: grime and paint peeling off the edges. */
const WOOD_WX: WeatherDef = {
  dirt: { material: 'wx_grime', tint: 0x8a8278, blend: 'multiply', strength: 0.8, roughness: 0.9 },
  edge: { material: 'wood_peeling_paint_weathered', blend: 'mix', strength: 1, curvature: 0.7 },
};
/** Glazed tiles: grime in the joints and a dull film, dark run-off. */
const TILE_WX: WeatherDef = {
  dirt: { material: 'wx_grime', tint: 0x958e84, blend: 'multiply', strength: 0.85, roughness: 0.7 },
  streak: { material: 'wx_streak', tint: 0x4a433c, tiling: [1.2, 2.2], mirror: true, strength: 1.2, roughness: 0.6 },
};
/** Pavement and quay concrete: grime, algae run-off and damp. */
const GROUND_WX: WeatherDef = {
  dirt: { material: 'wx_grime', tint: 0x86807a, blend: 'multiply', strength: 0.9, roughness: 0.95 },
  streak: { material: 'wx_streak', tint: 0x3c4032, tiling: [1.4, 2.4], mirror: true, strength: 1.4, roughness: 0.8 },
  damp: { blend: 'multiply', darken: 0.55, roughness: 0.4 },
};

const wx = (def: MaterialDef, weather: WeatherDef, patch?: number): MaterialDef[] => withVariants(def, { weathered: { weather }, ...(patch !== undefined ? { patch: { color: patch, normalScale: 0.45, castShadow: false } } : {}) });

export const HERO_MATERIALS: MaterialDef[] = [
  /* 1926 pier: white render, mouldings, stone plinth, Marseille tile roof, Kütahya tile panels. */
  ...wx(render('hero_render', 0xe3dfd6), WALL_WEATHER, 0xefece6),
  ...wx(render('hero_render_trim', 0xece8e0), WALL_WEATHER),
  ...wx(render('hero_render_soffit', 0xd6d0c5), WALL_WEATHER),
  ...wx({ id: 'hero_plinth', color: 0xd0c9be, textures: { asset: 'floor_tiles_02' }, tiling: [2.4, 2.4], surface: 'wall' }, STONE_WX),
  ...wx({ id: 'hero_roof_tile', color: 0xbc958a, textures: { public: 'roof_tiles' }, tiling: [2.2, 2.2], surface: 'roof' }, ROOF_WX),
  ...wx({ id: 'hero_tile_panel', color: 0xffffff, textures: { asset: 'Tiles133B' }, tiling: [2, 2], roughness: 0.35, surface: 'wall', castShadow: false }, TILE_WX),
  ...wx({ id: 'hero_frame', color: 0x3a2a20, textures: { asset: 'PaintedWood009C' }, tiling: [1, 1], surface: 'wood' }, WOOD_WX),
  ...wx({ id: 'hero_frame_white', color: 0xebe7df, textures: { asset: 'PaintedWood009C' }, tiling: [1, 1], surface: 'wood' }, WOOD_WX),
  ...wx({ id: 'hero_door', color: 0x5a3a26, textures: { asset: 'PaintedWood009C' }, tiling: [1.2, 2.4], surface: 'wood' }, WOOD_WX),
  { id: 'hero_glass', color: 0x1c2328, roughness: 0.06, metallic: 0.1, surface: 'glass', castShadow: false },
  { id: 'hero_glass_lit', color: 0x232a30, roughness: 0.06, metallic: 0.1, surface: 'glass', castShadow: false, emissive: { color: 0xffc98f, nits: 90, night: true, source: 'window' } },
  ...wx({ id: 'hero_iron', color: 0x1d1f21, metallic: 0.75, roughness: 0.45, surface: 'metal' }, IRON_WX),
  ...wx({ id: 'hero_lead', color: 0x8d9499, metallic: 0.45, roughness: 0.55, surface: 'roof' }, LEAD_WX),
  ...wx({ id: 'hero_floor', color: 0xe0dad0, textures: { asset: 'floor_tiles_02' }, tiling: [1.6, 1.6], surface: 'ground' }, GROUND_WX),
  { id: 'hero_marble', color: 0xf4f2ee, textures: { asset: 'Marble019' }, tiling: [2, 2], surface: 'other' },

  /* New pier (1982, re-clad 2005–08): cream precast panels, standing-seam metal roof. */
  ...wx(render('hero_panel_cream', 0xdcbca6), WALL_WEATHER, 0xe4c9b8),
  ...wx(render('hero_panel_trim', 0xe9dcd0), WALL_WEATHER),
  ...wx({ id: 'hero_metal_roof', color: 0xb6bcc0, textures: { asset: 'painted_metal_shutter' }, maps: { baseColor: false }, tiling: [1.2, 1.2], metallic: 0.45, roughness: 0.5, surface: 'roof' }, METAL_ROOF_WX),
  ...wx({ id: 'hero_quay', color: 0x7d7a73, textures: { public: 'concrete' }, tiling: [2.7, 2.7], surface: 'wall' }, GROUND_WX),
  { id: 'hero_quay_wet', color: 0x2f3a2a, roughness: 0.3, surface: 'wall', castShadow: false },
  { id: 'hero_tyre', color: 0x1a1a19, roughness: 0.88, surface: 'other' },
  { id: 'hero_bollard', color: 0xc8961f, roughness: 0.55, surface: 'metal' },
  { id: 'hero_lifering', color: 0xd9531e, roughness: 0.5, surface: 'other' },

  /* Haldun Taner (1927 market hall): dusty salmon-grey render, lighter trim, dark green joinery, timber canopy soffit. */
  ...wx(render('hero_ht_render', 0xc9b5a9), WALL_WEATHER, 0xd2c3b8),
  ...wx(render('hero_ht_trim', 0xd6c9bd), WALL_WEATHER),
  ...wx({ id: 'hero_ht_green', color: 0x2c4538, textures: { asset: 'PaintedWood009C' }, tiling: [1, 1], surface: 'wood' }, WOOD_WX),
  ...wx({ id: 'hero_ht_door', color: 0x35503f, textures: { asset: 'PaintedWood009C' }, tiling: [1.2, 2.4], surface: 'wood' }, WOOD_WX),
  ...wx({ id: 'hero_ht_soffit', color: 0x5a4636, textures: { asset: 'wood_peeling_paint_weathered' }, tiling: [1.5, 1.5], surface: 'wood' }, WOOD_WX),

  /* City Lines ferry (hero/ferry.ts). */
  { id: 'hero_ferry_white', color: 0xf0efe9, roughness: 0.45, surface: 'metal' },
  { id: 'hero_ferry_black', color: 0x1b1c1e, roughness: 0.5, surface: 'metal' },
  { id: 'hero_ferry_red', color: 0x6e2420, roughness: 0.6, surface: 'metal' },
  { id: 'hero_ferry_yellow', color: 0xe3ab1c, roughness: 0.45, surface: 'metal' },
  { id: 'hero_ferry_deck', color: 0x8c8a84, roughness: 0.7, surface: 'metal' },

  /* Far field (hero/farfield.ts): hazy massing, lit window bands at night, landmark stone and lead. */
  { id: 'hero_far_wall', color: 0xcfcbc2, roughness: 0.9, surface: 'wall', castShadow: false },
  { id: 'hero_far_wall2', color: 0xbdb7ad, roughness: 0.9, surface: 'wall', castShadow: false },
  { id: 'hero_far_wall3', color: 0xd9cdb8, roughness: 0.9, surface: 'wall', castShadow: false },
  { id: 'hero_far_roof', color: 0x9a7466, roughness: 0.9, surface: 'roof', castShadow: false },
  { id: 'hero_far_window', color: 0x6c7176, roughness: 0.4, surface: 'glass', castShadow: false },
  { id: 'hero_far_window_lit', color: 0x6c7176, roughness: 0.4, surface: 'glass', castShadow: false, emissive: { color: 0xffcf96, nits: 35, night: true, source: 'window' } },
  { id: 'hero_far_stone', color: 0xd3cbbb, roughness: 0.85, surface: 'wall', castShadow: false },
  { id: 'hero_far_pink', color: 0xcfa08c, roughness: 0.85, surface: 'wall', castShadow: false },
  { id: 'hero_far_lead', color: 0x8d949a, roughness: 0.6, metallic: 0.3, surface: 'roof', castShadow: false },
  { id: 'hero_far_slate', color: 0x5e6268, roughness: 0.7, surface: 'roof', castShadow: false },
  { id: 'hero_far_quay', color: 0x9a9892, roughness: 0.9, surface: 'ground', castShadow: false },

  /* İskele Camii: cut stone and lead; shop shutters of the annexes. */
  ...wx({ id: 'hero_stone', color: 0xe2d6c2, textures: { asset: 'floor_tiles_02' }, tiling: [2.6, 2.6], surface: 'wall' }, STONE_WX),
  ...wx({ id: 'hero_stone_trim', color: 0xebe1d1, textures: { asset: 'floor_tiles_02' }, tiling: [1.3, 1.3], surface: 'wall' }, STONE_WX),
  ...wx({ id: 'hero_shutter', color: 0xc9ccce, textures: { asset: 'worn_shutter' }, tiling: [1.37, 1.37], surface: 'metal' }, METAL_ROOF_WX),
  { id: 'hero_sign_green', color: 0x2e5a45, roughness: 0.5, surface: 'other' },
  { id: 'hero_sign_red', color: 0x8c2a24, roughness: 0.5, surface: 'other' },
  { id: 'hero_sign_cream', color: 0xe6dcc6, roughness: 0.5, surface: 'other' },

  /* Aya Efimia: yellow render, red tile roof, stone bell tower. */
  ...wx(render('hero_render_yellow', 0xdcc38a), WALL_WEATHER, 0xe3cf9e),
  ...wx(render('hero_render_yellow_trim', 0xe8dcc0), WALL_WEATHER),

  /* Sürmeli Ali Paşa fountain (hero/fountain.ts): grey küfeki limestone with black crusts, dark ablaq stones, marble. */
  ...wx({ id: 'hero_kufeki', color: 0xd4d1ca, textures: { public: 'stone' }, tiling: [3.2, 3.2], normalScale: 0.7, surface: 'wall' }, STONE_WX),
  ...wx({ id: 'hero_kufeki_dark', color: 0x77736c, textures: { public: 'stone' }, tiling: [3.2, 3.2], normalScale: 0.7, surface: 'wall' }, STONE_WX),
  ...wx({ id: 'hero_fountain_marble', color: 0xcdcac3, textures: { asset: 'Marble019' }, tiling: [1.5, 1.5], roughness: 0.6, surface: 'other' }, STONE_WX),
  { id: 'hero_inscription', color: 0x23262a, roughness: 0.55, surface: 'other' },
  { id: 'hero_gilt', color: 0xb99650, metallic: 0.8, roughness: 0.45, surface: 'metal' },

  /* Decals: rain streaks under sills and ledges, grime bands rising from the ground. */
  { id: 'hero_leak', color: 0xffffff, textures: { asset: 'Leaking003' }, maps: { normal: false }, alphaMode: 'BLEND', roughness: 0.9, surface: 'other', castShadow: false },
  { id: 'hero_leak_band', color: 0xffffff, textures: { asset: 'Leaking008' }, maps: { normal: false }, alphaMode: 'BLEND', roughness: 0.9, surface: 'other', castShadow: false },
];
