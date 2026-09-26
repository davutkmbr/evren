/**
 * Teleporting to a perch, shared by the pause menu's Işınlan ("Oraya kon ve izle") and the full map: the dragon is
 * teleported just behind and above the grip point facing the perch's view, then sat down on the perch in the viewing
 * mode (DragonPerchState.perchAt). Without the perch flight hook the landing is up to the player (L), which the toast
 * tells them.
 */
import type { PerchPoint } from '../core/contracts';
import type { ViewPreset } from '../core/debug';
import { perchView } from './menu/places';

/** Toast shown after a perch teleport. */
export const PERCH_TOAST = 'Konmak için [L]';

/** ~30 m behind and above the grip point, facing the perch's view. */
export function perchTeleportView(perch: PerchPoint): ViewPreset {
  return perchView(perch, 30, 30, -12);
}
