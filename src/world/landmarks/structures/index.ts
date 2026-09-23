/**
 * Structures module: Bosphorus and Golden Horn bridges, towers (Galata, Kız Kulesi, Çamlıca, Beyazıt) and the
 * skyscraper clusters. Builds every geo landmark whose builder is 'structures'.
 */
import type { System } from '../../../core/contracts';
import { StructureSystem, type StructureSystemOptions } from './system/structure-system';

export function createStructureSystem(options?: StructureSystemOptions): System {
  return new StructureSystem(options);
}

export { StructureSystem };
export type { StructureSystemOptions };
