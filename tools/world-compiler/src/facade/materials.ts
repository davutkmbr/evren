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
import type { MaterialDef } from '../materials';

/** Emissive colour of lit shop sign faces and neon letters (sRGB). */
export const SIGN_GLOW = { white: 0xfff6e8, red: 0xff3a2a, green: 0x39ff6a, yellow: 0xffd23a, blue: 0x4aa8ff } as const;
export type SignGlow = keyof typeof SIGN_GLOW;

export const FACADE_MATERIALS: MaterialDef[] = [
  /* Walls. */
  { id: 'fac_render', color: 0xffffff, textures: { public: 'plaster_painted' }, maps: { baseColor: false }, tiling: [2, 2], surface: 'wall' },
  { id: 'fac_render_rough', color: 0xffffff, textures: { public: 'plaster' }, maps: { baseColor: false }, tiling: [1.4, 1.4], normalScale: 1.4, surface: 'wall' },
  { id: 'fac_peeling', color: 0xffffff, textures: { asset: 'peeling_painted_wall' }, maps: { baseColor: false }, surface: 'wall' },
  { id: 'fac_damaged', color: 0xffffff, textures: { asset: 'damaged_plaster' }, surface: 'wall' },
  { id: 'fac_stone', color: 0xffffff, textures: { public: 'stone' }, tiling: [2, 2], surface: 'wall' },
  { id: 'fac_concrete', color: 0xffffff, textures: { public: 'concrete' }, tiling: [2.7, 2.7], surface: 'wall' },
  { id: 'fac_panel', color: 0xffffff, textures: { public: 'concrete' }, maps: { baseColor: false }, tiling: [2.7, 2.7], roughness: 0.55, metallic: 0.25, normalScale: 0.3, surface: 'wall' },
  { id: 'fac_tiles', color: 0xffffff, textures: { asset: 'long_white_tiles' }, surface: 'wall' },
  { id: 'fac_marble', color: 0xffffff, textures: { asset: 'Marble019' }, tiling: [1.2, 1.2], surface: 'other', castShadow: true },
  { id: 'fac_terrazzo', color: 0xffffff, textures: { asset: 'Terrazzo005' }, tiling: [1.5, 1.5], surface: 'ground' },
  /* Roofs. */
  { id: 'fac_roof_flat', color: 0xffffff, textures: { public: 'concrete' }, maps: { baseColor: false }, tiling: [2.7, 2.7], surface: 'roof' },
  { id: 'fac_roof_tiles', color: 0xffffff, textures: { public: 'roof_tiles' }, tiling: [2.5, 2.5], surface: 'roof' },
  /* Frames, shutters, metal. */
  { id: 'fac_pvc', color: 0xffffff, roughness: 0.42, surface: 'other', castShadow: true },
  { id: 'fac_timber', color: 0xffffff, textures: { asset: 'wood_peeling_paint_weathered' }, maps: { baseColor: false }, tiling: [0.76, 0.76], surface: 'wood', castShadow: true },
  { id: 'fac_shutter_wood', color: 0xffffff, textures: { asset: 'wood_peeling_paint_weathered' }, tiling: [0.76, 0.76], surface: 'wood', castShadow: true },
  { id: 'fac_roller', color: 0xffffff, textures: { asset: 'painted_metal_shutter' }, tiling: [1.2, 1.2], roughness: 0.6, surface: 'metal', castShadow: true },
  { id: 'fac_kepenk', color: 0xffffff, textures: { asset: 'painted_metal_shutter' }, tiling: [1.6, 1.6], metallic: 0.5, surface: 'metal', castShadow: true },
  { id: 'fac_kepenk_worn', color: 0xffffff, textures: { asset: 'worn_shutter' }, tiling: [1.37, 1.37], surface: 'metal', castShadow: true },
  { id: 'fac_metal', color: 0xffffff, roughness: 0.5, metallic: 0.55, surface: 'metal', castShadow: true },
  { id: 'fac_alu', color: 0xffffff, roughness: 0.32, metallic: 0.85, surface: 'metal', castShadow: true },
  /* Glass and what is behind it. */
  { id: 'fac_glass', color: 0xffffff, roughness: 0.05, metallic: 0, alphaMode: 'BLEND', surface: 'glass', castShadow: false },
  { id: 'fac_room', color: 0xffffff, roughness: 0.95, surface: 'other', castShadow: false },
  { id: 'fac_room_lit', color: 0xffffff, roughness: 0.95, emissive: { color: 0xffcf96, nits: 40, night: true, source: 'window' }, surface: 'other', castShadow: false },
  { id: 'fac_curtain', color: 0xffffff, roughness: 0.95, doubleSided: true, surface: 'fabric', castShadow: false },
  { id: 'fac_shop_lit', color: 0xffffff, roughness: 0.8, emissive: { color: 0xfff1de, nits: 25, night: true, source: 'interior' }, surface: 'other', castShadow: false },
  /* Shopfront dressing. */
  { id: 'fac_awning', color: 0xffffff, roughness: 0.9, doubleSided: true, surface: 'fabric', castShadow: true },
  { id: 'fac_sign', color: 0xffffff, roughness: 0.45, surface: 'other', castShadow: true },
  { id: 'fac_letters', color: 0xffffff, roughness: 0.35, surface: 'other', castShadow: false },
  ...(Object.keys(SIGN_GLOW) as SignGlow[]).map(
    (k): MaterialDef => ({ id: `fac_glow_${k}`, color: 0xffffff, roughness: 0.4, emissive: { color: SIGN_GLOW[k], nits: k === 'white' ? 200 : 380, night: true, source: 'sign' }, surface: 'other', castShadow: false }),
  ),
  { id: 'fac_bulb', color: 0xfff2d8, roughness: 0.3, emissive: { color: 0xffc98a, nits: 6000, night: true, source: 'lamp' }, surface: 'glass', castShadow: false },
  /* Wear decals (ambientCG, opacity from the set): streaks under sills and cornices, bands at plinths. */
  { id: 'fac_leak', color: 0xffffff, textures: { asset: 'Leaking003' }, maps: { normal: false }, alphaMode: 'BLEND', roughness: 0.9, surface: 'other', castShadow: false },
  { id: 'fac_leak_band', color: 0xffffff, textures: { asset: 'Leaking008' }, maps: { normal: false }, alphaMode: 'BLEND', roughness: 0.9, surface: 'other', castShadow: false },
];
