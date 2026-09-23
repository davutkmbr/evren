import type { System } from '../../core/contracts';
import { VegetationSystem } from './system';

export { VegetationSystem } from './system';

/** Trees & vegetation (service-free; see system.ts). */
export function createVegetationSystem(): System {
  return new VegetationSystem();
}
