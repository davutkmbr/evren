/**
 * Materials of the hero buildings (registered in registry.ts through HERO_MATERIALS). Every texture comes from an
 * approved set: public/textures (Poly Haven) or tools/assets/approved.json. Painted render uses the plaster set's
 * relief and roughness with a flat colour (maps.baseColor false), because the set's albedo is too dark for the white
 * and ochre renders of the photos.
 */
import type { MaterialDef } from '../materials';

const render = (id: string, color: number): MaterialDef => ({ id, color, textures: { public: 'plaster' }, maps: { baseColor: false }, tiling: [2.2, 2.2], normalScale: 0.8, surface: 'wall' });

export const HERO_MATERIALS: MaterialDef[] = [
  /* 1926 pier: white render, mouldings, stone plinth, Marseille tile roof, Kütahya tile panels. */
  render('hero_render', 0xe6e1d7),
  render('hero_render_trim', 0xefebe3),
  render('hero_render_soffit', 0xd9d3c8),
  { id: 'hero_plinth', color: 0xd4cdc2, textures: { asset: 'floor_tiles_02' }, tiling: [2.4, 2.4], surface: 'wall' },
  { id: 'hero_roof_tile', color: 0xcfa89c, textures: { public: 'roof_tiles' }, tiling: [2.2, 2.2], surface: 'roof' },
  { id: 'hero_tile_panel', color: 0xffffff, textures: { asset: 'Tiles133B' }, tiling: [2, 2], roughness: 0.35, surface: 'wall', castShadow: false },
  { id: 'hero_frame', color: 0x3a2a20, textures: { asset: 'PaintedWood009C' }, tiling: [1, 1], surface: 'wood' },
  { id: 'hero_frame_white', color: 0xf0ede6, textures: { asset: 'PaintedWood009C' }, tiling: [1, 1], surface: 'wood' },
  { id: 'hero_door', color: 0x5a3a26, textures: { asset: 'PaintedWood009C' }, tiling: [1.2, 2.4], surface: 'wood' },
  { id: 'hero_glass', color: 0x1c2328, roughness: 0.06, metallic: 0.1, surface: 'glass', castShadow: false },
  { id: 'hero_glass_lit', color: 0x232a30, roughness: 0.06, metallic: 0.1, surface: 'glass', castShadow: false, emissive: { color: 0xffc98f, nits: 90, night: true, source: 'window' } },
  { id: 'hero_iron', color: 0x1d1f21, metallic: 0.75, roughness: 0.45, surface: 'metal' },
  { id: 'hero_lead', color: 0x8d9499, metallic: 0.45, roughness: 0.55, surface: 'roof' },
  { id: 'hero_floor', color: 0xe4ded4, textures: { asset: 'floor_tiles_02' }, tiling: [1.6, 1.6], surface: 'ground' },
  { id: 'hero_marble', color: 0xf4f2ee, textures: { asset: 'Marble019' }, tiling: [2, 2], surface: 'other' },

  /* New pier (1982, re-clad 2005–08): cream precast panels, standing-seam metal roof. */
  render('hero_panel_cream', 0xe0bea4),
  render('hero_panel_trim', 0xeedccb),
  { id: 'hero_metal_roof', color: 0x8e959b, textures: { asset: 'painted_metal_shutter' }, tiling: [1.2, 1.2], metallic: 0.5, surface: 'roof' },

  /* İskele Camii: cut stone and lead. */
  { id: 'hero_stone', color: 0xe8dcc8, textures: { asset: 'floor_tiles_02' }, tiling: [2.6, 2.6], surface: 'wall' },
  { id: 'hero_stone_trim', color: 0xf0e6d6, textures: { asset: 'floor_tiles_02' }, tiling: [1.3, 1.3], surface: 'wall' },

  /* Aya Efimia: yellow render, red tile roof, stone bell tower. */
  render('hero_render_yellow', 0xe2bf6c),
  render('hero_render_yellow_trim', 0xefe2c2),
];
