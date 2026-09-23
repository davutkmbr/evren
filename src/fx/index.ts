import type { System } from '../core/contracts';
import { FxSystem } from './fx-system';

/** Particles & effects system; provides the 'fx' service (FxService). */
export function createFxSystem(): System {
  return new FxSystem();
}
