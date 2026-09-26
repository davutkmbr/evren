/**
 * Life on and above the water: ferries, sea buses, strait traffic, anchored ships and small craft with Kelvin wakes and
 * navigation lights, pier buildings, seagull and pigeon flocks, dolphin pods in the Bosphorus, and car light streams on
 * the major roads.
 */
import type { System } from '../../core/contracts';
import { LifeSystem } from './life-system';

export function createLifeSystem(): System {
  return new LifeSystem();
}
