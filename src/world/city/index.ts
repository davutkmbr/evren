/** Procedural Istanbul city fabric (buildings, street lights, building colliders). */
import type { System } from '../../core/contracts';
import { CitySystem } from './city-system';

export function createCitySystem(): System {
  return new CitySystem();
}
