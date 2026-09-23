/**
 * Camera module: third-person chase, rider POV, automatic cinematic director and a free photo camera.
 * Provides the 'cameraRig' service (see CameraSystem).
 */
import type { System } from '../core/contracts';
import { CameraSystem } from './camera-system';

export { CameraSystem } from './camera-system';

export function createCameraSystem(): System {
  return new CameraSystem();
}
