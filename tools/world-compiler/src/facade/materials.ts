/**
 * Materials of the façade kit and the shopfronts (format 1, registered in registry.ts MATERIAL_SETS).
 *
 * Paint colours are not baked into textures: every façade material carries COLOR_0 (linear RGBA, glTF multiplies it
 * into the base colour), so one material per surface type serves every building of a tile (one draw call per
 * material and tile). Painted surfaces (`fac_render*`, frames, railings, panels, signs) therefore use only the normal
 * and ORM maps of their approved set (`maps.baseColor: false`) and take their colour from COLOR_0; surfaces whose
 * colour is the texture (damaged plaster, marble, roof tiles, kepenk slats) keep the base colour map and use COLOR_0
 * for tint and wear. Glass takes its transparency from COLOR_0 alpha (BLEND).
 *
 * Sources: approved Poly Haven / ambientCG sets only (tools/assets/approved.json, public/textures/LICENSES.md).
 */
import { type MaterialDef, WALL_WEATHER, type WeatherDef, withVariants } from '../materials';

/*
 * Weathering (format 1.1, README "Format 1.1 — weathering"): façade surfaces carry `_WEATHER` per vertex (dirt in
 * reveals, corners and under slabs; rain streaks under slabs and cornices; edge wear on convex corners and arrises;
 * damp at the wall base) and blend the layers below. Wall layers start from the shared WALL_WEATHER preset (tuned by
 * the look lane), so its tuning reaches every façade; the variants only scale it.
 */
const W = WALL_WEATHER;
const scaled = (w: WeatherDef, k: Partial<Record<keyof WeatherDef, number>>): WeatherDef =>
  Object.fromEntries(Object.entries(w).map(([name, layer]) => [name, { ...layer, strength: (layer?.strength ?? 1) * (k[name as keyof WeatherDef] ?? 1) }])) as WeatherDef;
/** Walls with a painted or plastered face: grime, streaks, chipped paint on convex edges, damp. */
const RENDER_WEATHER: WeatherDef = W;
/** Heavily weathered render: stronger soot and run-off. */
const RENDER_WEATHERED: WeatherDef = scaled(W, { dirt: 1.2, streak: 1.25, edge: 1.2, damp: 1.1 });
/** Surfaces that do not chip into plaster (stone, tiles, marble, concrete): grime, streaks and damp only. */
const HARD_WEATHER: WeatherDef = { dirt: W.dirt, streak: W.streak, damp: W.damp };
/** Rust on steel (railings, brackets, gas pipes), driven by the dirt channel: a flat layer, no texture. */
const RUST_WEATHER: WeatherDef = { dirt: { tint: 0x6a3a22, blend: 'mix', strength: 1, roughness: 0.85 }, damp: { blend: 'multiply', darken: 0.7, roughness: 0.4 } };
/** Fabric and signs outdoors: grime at the low edges and run-off streaks. */
const SOFT_WEATHER: WeatherDef = { dirt: { ...W.dirt, strength: 1 }, streak: W.streak };
/** Window frames: grime on the bottom rails; painted timber also wears to bare wood on its arrises. */
const FRAME_WEATHER: WeatherDef = { dirt: W.dirt };
export const TIMBER_WEATHER: WeatherDef = { dirt: W.dirt, edge: { tint: 0x8c6c4a, blend: 'mix', strength: 1, roughness: 0.8, curvature: 0.75 } };

/** Emissive colour of lit shop sign faces and neon letters (sRGB). */
export const SIGN_GLOW = { white: 0xfff6e8, red: 0xff3a2a, green: 0x39ff6a, yellow: 0xffd23a, blue: 0x4aa8ff } as const;
export type SignGlow = keyof typeof SIGN_GLOW;

export const FACADE_MATERIALS: MaterialDef[] = [
  /* Walls. A wall segment picks the clean base, `@weathered` or `@damaged` (peeling paint) variant. */
  ...withVariants(
    { id: 'fac_render', color: 0xffffff, textures: { public: 'plaster_painted' }, maps: { baseColor: false }, tiling: [2, 2], surface: 'wall', weather: RENDER_WEATHER },
    {
      weathered: { weather: RENDER_WEATHERED, normalScale: 1.25 },
      damaged: { textures: { asset: 'peeling_painted_wall' }, maps: { baseColor: false }, tiling: [2, 2], normalScale: 1.1, weather: scaled(W, { dirt: 1.2, streak: 1.3, edge: 1.6, damp: 1.2 }) },
    },
  ),
  ...withVariants(
    { id: 'fac_render_rough', color: 0xffffff, textures: { public: 'plaster' }, maps: { baseColor: false }, tiling: [1.4, 1.4], normalScale: 1.4, surface: 'wall', weather: RENDER_WEATHER },
    { weathered: { weather: RENDER_WEATHERED } },
  ),
  { id: 'fac_peeling', color: 0xffffff, textures: { asset: 'peeling_painted_wall' }, maps: { baseColor: false }, surface: 'wall', weather: RENDER_WEATHERED },
  { id: 'fac_damaged', color: 0xffffff, textures: { asset: 'damaged_plaster' }, surface: 'wall', weather: HARD_WEATHER },
  { id: 'fac_stone', color: 0xffffff, textures: { public: 'stone' }, tiling: [2, 2], surface: 'wall', weather: HARD_WEATHER },
  { id: 'fac_concrete', color: 0xffffff, textures: { public: 'concrete' }, tiling: [2.7, 2.7], surface: 'wall', weather: HARD_WEATHER },
  { id: 'fac_panel', color: 0xffffff, textures: { public: 'concrete' }, maps: { baseColor: false }, tiling: [2.7, 2.7], roughness: 0.55, metallic: 0.25, normalScale: 0.3, surface: 'wall', weather: HARD_WEATHER },
  { id: 'fac_tiles', color: 0xffffff, textures: { asset: 'long_white_tiles' }, surface: 'wall', weather: HARD_WEATHER },
  { id: 'fac_marble', color: 0xffffff, textures: { asset: 'Marble019' }, tiling: [1.2, 1.2], surface: 'other', castShadow: true, weather: HARD_WEATHER },
  { id: 'fac_terrazzo', color: 0xffffff, textures: { asset: 'Terrazzo005' }, tiling: [1.5, 1.5], surface: 'ground' },
  /* Roofs. */
  { id: 'fac_roof_flat', color: 0xffffff, textures: { public: 'concrete' }, maps: { baseColor: false }, tiling: [2.7, 2.7], surface: 'roof' },
  { id: 'fac_roof_tiles', color: 0xffffff, textures: { public: 'roof_tiles' }, tiling: [2.5, 2.5], surface: 'roof' },
  /* Frames, shutters, metal. */
  { id: 'fac_pvc', color: 0xffffff, roughness: 0.42, surface: 'other', castShadow: true, weather: FRAME_WEATHER },
  { id: 'fac_timber', color: 0xffffff, textures: { asset: 'wood_peeling_paint_weathered' }, maps: { baseColor: false }, tiling: [0.76, 0.76], surface: 'wood', castShadow: true, weather: TIMBER_WEATHER },
  { id: 'fac_shutter_wood', color: 0xffffff, textures: { asset: 'wood_peeling_paint_weathered' }, tiling: [0.76, 0.76], surface: 'wood', castShadow: true, weather: TIMBER_WEATHER },
  { id: 'fac_roller', color: 0xffffff, textures: { asset: 'painted_metal_shutter' }, tiling: [1.2, 1.2], roughness: 0.6, surface: 'metal', castShadow: true, weather: SOFT_WEATHER },
  // Slats come from the texture (mipmapped, no slat geometry); a softer relief keeps them from shimmering at distance.
  { id: 'fac_kepenk', color: 0xffffff, textures: { asset: 'painted_metal_shutter' }, tiling: [1.6, 1.6], metallic: 0.5, normalScale: 0.6, surface: 'metal', castShadow: true, weather: HARD_WEATHER },
  { id: 'fac_kepenk_worn', color: 0xffffff, textures: { asset: 'worn_shutter' }, tiling: [1.37, 1.37], surface: 'metal', castShadow: true, weather: HARD_WEATHER },
  { id: 'fac_metal', color: 0xffffff, roughness: 0.5, metallic: 0.55, surface: 'metal', castShadow: true, weather: RUST_WEATHER },
  { id: 'fac_alu', color: 0xffffff, roughness: 0.32, metallic: 0.85, surface: 'metal', castShadow: true },
  /* Glass and what is behind it. */
  { id: 'fac_glass', color: 0xffffff, roughness: 0.05, metallic: 0, alphaMode: 'BLEND', surface: 'glass', castShadow: false },
  { id: 'fac_room', color: 0xffffff, roughness: 0.95, surface: 'other', castShadow: false },
  { id: 'fac_room_lit', color: 0xffffff, roughness: 0.95, emissive: { color: 0xffcf96, nits: 40, night: true, source: 'window' }, surface: 'other', castShadow: false },
  { id: 'fac_curtain', color: 0xffffff, roughness: 0.95, doubleSided: true, surface: 'fabric', castShadow: false },
  { id: 'fac_shop_lit', color: 0xffffff, roughness: 0.8, emissive: { color: 0xfff1de, nits: 25, night: true, source: 'interior' }, surface: 'other', castShadow: false },
  { id: 'fac_ceiling_light', color: 0xffffff, roughness: 0.4, emissive: { color: 0xfff6ec, nits: 1500, night: false, source: 'interior' }, surface: 'other', castShadow: false },
  /* Shopfront dressing. */
  { id: 'fac_awning', color: 0xffffff, roughness: 0.9, doubleSided: true, surface: 'fabric', castShadow: true, weather: SOFT_WEATHER },
  // Sign bodies and unlit sign faces are painted sheet metal (dents and pitting from the rusty-metal normal map).
  { id: 'fac_sign', color: 0xffffff, textures: { asset: 'green_metal_rust' }, maps: { baseColor: false, orm: false }, tiling: [1.2, 1.2], normalScale: 0.35, roughness: 0.5, surface: 'other', castShadow: true, weather: SOFT_WEATHER },
  { id: 'fac_letters', color: 0xffffff, roughness: 0.35, surface: 'other', castShadow: false },
  // Lit sign faces: backlit acrylic, glossy by day.
  ...(Object.keys(SIGN_GLOW) as SignGlow[]).map(
    (k): MaterialDef => ({ id: `fac_glow_${k}`, color: 0xffffff, roughness: 0.14, emissive: { color: SIGN_GLOW[k], nits: k === 'white' ? 200 : 380, night: true, source: 'sign' }, surface: 'other', castShadow: false }),
  ),
  // Vinyl banners (KİRALIK / SATILIK, upper-floor trades): satin, double-sided.
  { id: 'fac_vinyl', color: 0xffffff, roughness: 0.55, doubleSided: true, surface: 'fabric', castShadow: true, weather: SOFT_WEATHER },
  // Paper posters, notes and stickers: matte.
  { id: 'fac_paper', color: 0xffffff, roughness: 0.88, surface: 'other', castShadow: false },
  // Spray paint (tags and throw-ups) and hairline cracks.
  { id: 'fac_spray', color: 0xffffff, roughness: 0.7, surface: 'other', castShadow: false },
  { id: 'fac_crack', color: 0xffffff, roughness: 0.95, surface: 'other', castShadow: false },
  // Balcony life: laundry (cloth), cat-safety nets (dark mesh read as a translucent sheet), herbs.
  { id: 'fac_cloth', color: 0xffffff, roughness: 0.92, doubleSided: true, surface: 'fabric', castShadow: true },
  { id: 'fac_net', color: 0xffffff, roughness: 0.8, alphaMode: 'BLEND', doubleSided: true, surface: 'fabric', castShadow: false },
  { id: 'fac_plant', color: 0xffffff, roughness: 0.75, doubleSided: true, surface: 'plant', castShadow: true },
  { id: 'fac_bulb', color: 0xfff2d8, roughness: 0.3, emissive: { color: 0xffc98a, nits: 6000, night: true, source: 'lamp' }, surface: 'glass', castShadow: false },
  /* Wear decals (ambientCG, opacity from the set): streaks under sills and cornices, bands at plinths. */
  { id: 'fac_leak', color: 0xffffff, textures: { asset: 'Leaking003' }, maps: { normal: false }, alphaMode: 'BLEND', roughness: 0.9, surface: 'other', castShadow: false },
  { id: 'fac_leak_band', color: 0xffffff, textures: { asset: 'Leaking008' }, maps: { normal: false }, alphaMode: 'BLEND', roughness: 0.9, surface: 'other', castShadow: false },
];
