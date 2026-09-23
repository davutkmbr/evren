import type { System } from '../../../core/contracts';
import { HeritageSystem } from './system';

export { HeritageSystem } from './system';

/**
 * Palaces, fortresses, walls and historic buildings (geo.landmarks with builder === 'heritage'):
 * Topkapı, Dolmabahçe, Çırağan, Beylerbeyi, Rumeli / Anadolu Hisarı, Yedikule, the Theodosian land walls,
 * Haydarpaşa, Sirkeci, Selimiye, Kuleli, Bozdoğan Kemeri and the Hippodrome monuments.
 */
export function createHeritageSystem(): System {
  return new HeritageSystem();
}
