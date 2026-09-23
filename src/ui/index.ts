/**
 * User interface (Turkish): loading and start screens, flight HUD, landmark discovery, minimap and full map,
 * pause/settings menu, help, toasts, photo mode and the ?stats=1 overlay. Registered first so it can show loading.
 */
import type { System } from '../core/contracts';
import { UiSystem } from './ui-system';

export { UiSystem } from './ui-system';

export function createUiSystem(): System {
  return new UiSystem();
}
