/**
 * Researched dimensions of the three Bosphorus bridges.
 * - 15 Temmuz Şehitler (1973, Freeman Fox): 1560 m total, 1074 m main span, side spans 231 / 255 m (not suspended),
 *   165 m steel box towers, 33.4 m x 3 m aerodynamic box deck, 64 m clearance, inclined (zig-zag) hangers.
 * - Fatih Sultan Mehmet (1988): 1510 m total, 1090 m main span, 39.4 m deck, towers 105 m above the road,
 *   vertical double hangers, 64 m clearance, 8 lanes.
 * - Yavuz Sultan Selim (2016, Virlogeux / Greisch): hybrid suspension + cable-stayed, 1408 m main span, side spans
 *   378 m, A-shaped concrete towers 322 m (Europe) / 318 m (Asia), 58.4 m x 5.5 m deck with 2x4 lanes and a double
 *   track railway, 176 stays, 17 vertical hangers at 24 m each side of midspan (central 816 m).
 */
import { LedGroup } from '../../build/surfaces';
import { Color, Pal } from '../palette';
import type { DeckSection } from './deck';
import type { SuspensionSpec } from './suspension';

function laneCentres(inner: number, lanes: number, width = 3.65): number[] {
  return Array.from({ length: lanes }, (_, k) => inner + width * (k + 0.5));
}

function traffic(inner: number, lanes: number, spacing: number, speed: number): DeckSection['traffic'] {
  const xs = laneCentres(inner, lanes);
  return {
    lanes: [...xs.map((x) => ({ x, dir: 1 as const })), ...xs.map((x) => ({ x: -x, dir: -1 as const }))],
    spacing,
    speed,
  };
}

const BOGAZICI_SECTION: DeckSection = {
  girder: [
    [-16.75, 0],
    [-16.75, -0.5],
    [-15.7, -1.15],
    [-10.2, -3.0],
    [10.2, -3.0],
    [15.7, -1.15],
    [16.75, -0.5],
    [16.75, 0],
  ],
  girderLow: [
    [-16.75, 0],
    [-15.7, -1.15],
    [-10.2, -3.0],
    [10.2, -3.0],
    [15.7, -1.15],
    [16.75, 0],
  ],
  girderMat: Pal.deckSoffit,
  strips: [
    { x0: -13.9, x1: 13.9, kind: 'road', lanes: 3, medianHalf: 0.6 },
    { x0: 13.9, x1: 14.3, kind: 'plain' },
    { x0: -14.3, x1: -13.9, kind: 'plain' },
    { x0: 14.3, x1: 16.75, kind: 'walk', raise: 0.2 },
    { x0: -16.75, x1: -14.3, kind: 'walk', raise: 0.2 },
  ],
  barriers: [
    { x: 0, kind: 'jersey' },
    { x: 14.1, kind: 'jersey' },
    { x: -14.1, kind: 'jersey' },
  ],
  railings: [
    { x: 16.6, height: 1.2, raise: 0.2 },
    { x: -16.6, height: 1.2, raise: 0.2 },
  ],
  lamps: { lines: [{ x: 14.1, arm: -1 }, { x: -14.1, arm: 1 }], spacing: 36, phase: 0, height: 10.5, arm: 1.6, kelvin: 3300, intensity: 40, pool: 0.9 },
  traffic: traffic(1.2, 3, 42, 17),
  depth: 3.0,
  halfWidth: 16.75,
};

export const BOGAZICI: SuspensionSpec = {
  mainSpan: 1074,
  sideSpans: [231, 255],
  clearance: 64,
  crestRadius: 26000,
  section: BOGAZICI_SECTION,
  tower: {
    kind: 'portal',
    height: { ref: 'base', values: [165, 165] },
    xTop: 18.9,
    xBase: 19.6,
    daBase: 7.2,
    daTop: 5.0,
    dtBase: 5.2,
    dtTop: 3.6,
    portals: [0.47, 1],
    surface: Pal.bridgeSteel,
  },
  cable: { x: 16.95, radius: 0.29, lowAboveRoad: 2.6, color: Color.cable },
  hangers: { type: 'inclined', spacing: 18, radius: 0.035, pair: false, color: Color.hanger },
  anchorage: { along: 42, across: 46, height: 20 },
  pierSpacing: 58,
  pierSurface: Pal.concreteLight,
  led: { group: LedGroup.Bogazici, cable: 5.5, hanger: 2.2, tower: 1.1, deck: 1.6 },
  maxGrade: 0.045,
};

const FSM_SECTION: DeckSection = {
  girder: [
    [-19.7, 0],
    [-19.7, -0.5],
    [-18.6, -1.15],
    [-12.5, -3.0],
    [12.5, -3.0],
    [18.6, -1.15],
    [19.7, -0.5],
    [19.7, 0],
  ],
  girderLow: [
    [-19.7, 0],
    [-18.6, -1.15],
    [-12.5, -3.0],
    [12.5, -3.0],
    [18.6, -1.15],
    [19.7, 0],
  ],
  girderMat: Pal.deckSoffit,
  strips: [
    { x0: -17.2, x1: 17.2, kind: 'road', lanes: 4, medianHalf: 0.8 },
    { x0: 17.2, x1: 17.9, kind: 'plain' },
    { x0: -17.9, x1: -17.2, kind: 'plain' },
    { x0: 17.9, x1: 19.7, kind: 'walk', raise: 0.15 },
    { x0: -19.7, x1: -17.9, kind: 'walk', raise: 0.15 },
  ],
  barriers: [
    { x: 0, kind: 'jersey' },
    { x: 17.5, kind: 'parapet' },
    { x: -17.5, kind: 'parapet' },
  ],
  railings: [
    { x: 19.6, height: 1.1, raise: 0.15 },
    { x: -19.6, height: 1.1, raise: 0.15 },
  ],
  lamps: { lines: [{ x: 0, arm: 1 }, { x: 0, arm: -1 }], spacing: 40, phase: 20, height: 11, arm: 2.2, kelvin: 3600, intensity: 42, pool: 0.75 },
  traffic: traffic(1.4, 4, 38, 18),
  depth: 3.0,
  halfWidth: 19.7,
};

export const FSM: SuspensionSpec = {
  mainSpan: 1090,
  sideSpans: [210, 210],
  clearance: 64,
  crestRadius: 30000,
  section: FSM_SECTION,
  tower: {
    kind: 'portal',
    height: { ref: 'deck', values: [105, 105] },
    xTop: 21.9,
    xBase: 22.6,
    daBase: 6.4,
    daTop: 4.6,
    dtBase: 4.8,
    dtTop: 3.4,
    portals: [1],
    surface: Pal.bridgeSteel,
  },
  cable: { x: 19.9, radius: 0.4, lowAboveRoad: 2.8, color: Color.cable },
  hangers: { type: 'vertical', spacing: 18.5, radius: 0.04, pair: true, color: Color.hanger },
  anchorage: { along: 45, across: 52, height: 22 },
  pierSpacing: 52,
  pierSurface: Pal.concreteLight,
  led: { group: LedGroup.Fsm, cable: 4.5, hanger: 1.8, tower: 1.0, deck: 1.2 },
  maxGrade: 0.045,
};

const YSS_SECTION: DeckSection = {
  girder: [
    [-29.2, 0],
    [-29.2, -0.6],
    [-27.4, -2.3],
    [-20.5, -5.5],
    [20.5, -5.5],
    [27.4, -2.3],
    [29.2, -0.6],
    [29.2, 0],
  ],
  girderLow: [
    [-29.2, 0],
    [-27.4, -2.3],
    [-20.5, -5.5],
    [20.5, -5.5],
    [27.4, -2.3],
    [29.2, 0],
  ],
  girderMat: Pal.deckSoffit,
  strips: [
    { x0: -6.4, x1: 6.4, kind: 'rail' },
    { x0: 6.4, x1: 7.0, kind: 'plain' },
    { x0: -7.0, x1: -6.4, kind: 'plain' },
    { x0: 7.0, x1: 25.0, kind: 'road', lanes: 4, medianHalf: 6.9 },
    { x0: -25.0, x1: -7.0, kind: 'road', lanes: 4, medianHalf: 6.9 },
    { x0: 25.0, x1: 25.6, kind: 'plain' },
    { x0: -25.6, x1: -25.0, kind: 'plain' },
    { x0: 25.6, x1: 29.2, kind: 'walk', raise: 0.2 },
    { x0: -29.2, x1: -25.6, kind: 'walk', raise: 0.2 },
  ],
  barriers: [
    { x: 6.7, kind: 'jersey' },
    { x: -6.7, kind: 'jersey' },
    { x: 25.3, kind: 'jersey' },
    { x: -25.3, kind: 'jersey' },
  ],
  railings: [
    { x: 29.1, height: 1.2, raise: 0.2 },
    { x: -29.1, height: 1.2, raise: 0.2 },
  ],
  lamps: { lines: [{ x: 6.7, arm: 1 }, { x: -6.7, arm: -1 }], spacing: 40, phase: 0, height: 12, arm: 2.5, kelvin: 4000, intensity: 44, pool: 0.7 },
  traffic: traffic(7.5, 4, 55, 20),
  depth: 5.5,
  halfWidth: 29.2,
};

export const YSS: SuspensionSpec = {
  mainSpan: 1408,
  sideSpans: [378, 378],
  clearance: 64,
  crestRadius: 40000,
  section: YSS_SECTION,
  tower: {
    kind: 'A',
    height: { ref: 'sea', values: [322, 318] },
    mergeFraction: 0.87,
    xBase: 44,
    xMerge: 6.2,
    daBase: 15,
    daTop: 9.5,
    dtBase: 12,
    dtTop: 7,
    surface: Pal.concreteLight,
  },
  cable: { x: 28.4, radius: 0.5, lowAboveRoad: 3.2, color: Color.cable },
  hangers: { type: 'vertical', spacing: 24, radius: 0.055, pair: false, zone: 408, color: Color.hanger },
  stays: { perFan: 22, mainFrom: 52, mainTo: 548, sideFrom: 40, sideTo: 352, towerFrom: 0.6, towerTo: 0.985, radius: 0.1 },
  anchorage: { along: 55, across: 70, height: 26 },
  pierSpacing: 76,
  pierSurface: Pal.concreteLight,
  led: { group: LedGroup.Yss, cable: 3.0, hanger: 1.2, tower: 0.7, deck: 1.0 },
  maxGrade: 0.04,
};
