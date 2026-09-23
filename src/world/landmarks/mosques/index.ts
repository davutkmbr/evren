/**
 * Ottoman mosques: the hand-configured landmark mosques from geo.landmarks (builder === 'mosques') and procedural
 * neighbourhood mosques on every geo.smallMosqueSites entry. Geometry is generated in workers, landmarks stream a
 * detailed LOD0 mesh near the camera; everything else is a single multi-draw BatchedMesh.
 */
import type { System } from '../../../core/contracts';
import { MosqueSystem, type MosqueSystemOptions } from './system/mosque-system';

export type { MosqueSystemOptions } from './system/mosque-system';

export function createMosqueSystem(options?: MosqueSystemOptions): System {
  return new MosqueSystem(options);
}
