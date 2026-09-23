/** Layers of the ground texture arrays (shared by the ground shader, the masonry material and worker-side UV setup). */
import type { TextureSet } from '../shared/textures';

export const GROUND_LAYERS = ['asphalt', 'cobble', 'sidewalk', 'granite', 'yard', 'stone', 'concrete'] as const satisfies readonly TextureSet[];

export const GROUND_LAYER_INDEX = Object.fromEntries(GROUND_LAYERS.map((s, i) => [s, i])) as Record<(typeof GROUND_LAYERS)[number], number>;
