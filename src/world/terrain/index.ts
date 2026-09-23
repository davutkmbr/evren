/**
 * Terrain: CDLOD quadtree over the 48 km world plus a ±96 km horizon ring, heights sampled on the GPU from the geo
 * height texture, land-use driven procedural ground (city carpet, forests, fields, shores, roads, night lights).
 */
import type { System } from '../../core/contracts';
import { TerrainSystem } from './terrain-system';

export function createTerrainSystem(): System {
  return new TerrainSystem();
}
