/**
 * Landmark id -> builder. Unknown ids fall back to a generic builder for their kind so new geo landmarks still
 * get a plausible structure.
 */
import type { StructureBuild } from '../build/context';
import type { SiteDef } from '../types';
import { BOGAZICI, FSM, YSS } from './bridges/bosphorus-specs';
import { buildAtaturkBridge, buildGalataBridge, buildHalicBridge } from './bridges/golden-horn';
import { buildHalicMetroBridge } from './bridges/metro-bridge';
import { buildSuspensionBridge } from './bridges/suspension';
import { buildSkyscraperCluster } from './skyscrapers/cluster';
import { buildBeyazitTower } from './towers/beyazit-tower';
import { buildCamlicaTower } from './towers/camlica-tower';
import { buildGalataTower } from './towers/galata-tower';
import { buildKizKulesi } from './towers/kiz-kulesi';

export type Builder = (b: StructureBuild) => void;

const BUILDERS: Record<string, Builder> = {
  'bogazici-koprusu': (b) => buildSuspensionBridge(b, BOGAZICI),
  'fsm-koprusu': (b) => buildSuspensionBridge(b, FSM),
  'yss-koprusu': (b) => buildSuspensionBridge(b, YSS),
  'galata-koprusu': buildGalataBridge,
  'ataturk-koprusu': buildAtaturkBridge,
  'halic-metro-koprusu': buildHalicMetroBridge,
  'halic-koprusu': buildHalicBridge,
  'galata-kulesi': buildGalataTower,
  'kiz-kulesi': buildKizKulesi,
  'camlica-kulesi': buildCamlicaTower,
  'beyazit-kulesi': buildBeyazitTower,
  'levent-kuleleri': buildSkyscraperCluster,
  'maslak-kuleleri': buildSkyscraperCluster,
  'atasehir-kuleleri': buildSkyscraperCluster,
  'zincirlikuyu-kuleleri': buildSkyscraperCluster,
};

function fallback(def: SiteDef): Builder {
  if (def.kind === 'skyscraper') {
    return buildSkyscraperCluster;
  }
  return () => {
    console.warn(`[structures] no builder for ${def.id} (${def.kind})`);
  };
}

export function builderFor(def: SiteDef): Builder {
  return BUILDERS[def.id] ?? fallback(def);
}
