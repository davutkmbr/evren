/**
 * Skyscraper catalogue per cluster anchor (anchor order and heights come from geo's landmark data).
 * Iconic towers get hand-made specs; the rest get deterministic variations of common Istanbul office / residential
 * typologies.
 */
import { CrownColor, Facade, LedGroup } from '../../build/surfaces';
import type { TowerSpec } from './tower';

export interface PlacedTower {
  spec: TowerSpec;
  /** Offset from the anchor (m, world x/z). */
  dx?: number;
  dz?: number;
}

const TINT = {
  blueGreen: 0x6f9aa6,
  silver: 0x9fabb1,
  dark: 0x505c64,
  clear: 0x92a6ab,
  green: 0x6f9c8d,
  bronze: 0x8b7358,
  blue: 0x5f86a8,
};

type Catalog = Record<number, PlacedTower[]>;

/** Levent: İstanbul Sapphire, İş Kuleleri, Sabancı Center, Kanyon, Metrocity. */
const LEVENT: Catalog = {
  0: [
    {
      // İstanbul Sapphire (2011): 238 m roof, 261 m with the mast, slender lens plan and a sloping glass crown
      spec: {
        height: 261,
        plan: { kind: 'lens', w: 64, d: 27, tip: 0.2 },
        rotation: 72,
        facade: Facade.SilverFins,
        tint: TINT.silver,
        floor: 4.2,
        bay: 1.5,
        crown: { kind: 'slant', low: 0.88 },
        spire: 23,
        crownLight: { color: CrownColor.CoolWhite, intensity: 1.6, depth: 30 },
        podium: { w: 90, d: 60, h: 14 },
      },
    },
  ],
  1: [
    {
      // İş Bankası Tower 1 (2000): 181 m, rounded triangular plan, tapering metal crown and mast
      spec: {
        height: 181,
        plan: { kind: 'triangle', side: 56, r: 7 },
        rotation: 15,
        facade: Facade.DarkGrid,
        tint: TINT.blueGreen,
        floor: 3.9,
        bay: 1.35,
        crown: { kind: 'pyramid', height: 14 },
        spire: 12,
        crownLight: { color: CrownColor.Blue, intensity: 1.2, depth: 10 },
        podium: { w: 70, d: 55, h: 10 },
      },
    },
    { dx: 70, dz: 40, spec: { height: 103, plan: { kind: 'triangle', side: 40, r: 5 }, rotation: 45, facade: Facade.DarkGrid, tint: TINT.blueGreen, floor: 3.9, crown: { kind: 'flat' } } },
    { dx: -55, dz: 62, spec: { height: 103, plan: { kind: 'triangle', side: 40, r: 5 }, rotation: -10, facade: Facade.DarkGrid, tint: TINT.blueGreen, floor: 3.9, crown: { kind: 'flat' } } },
  ],
  4: [
    {
      // Sabancı Center twin towers (1993): 158 m and 145 m, chamfered square plans, stepped crowns
      spec: {
        height: 158,
        plan: { kind: 'rect', w: 36, d: 36, chamfer: 7 },
        rotation: 25,
        facade: Facade.BlueBand,
        tint: TINT.blue,
        floor: 3.8,
        bay: 1.6,
        crown: { kind: 'stepped', steps: 3, stepHeight: 5, inset: 0.12 },
        spire: 8,
        podium: { w: 110, d: 60, h: 12 },
      },
    },
    { dx: 52, dz: -30, spec: { height: 145, plan: { kind: 'rect', w: 34, d: 34, chamfer: 7 }, rotation: 25, facade: Facade.BlueBand, tint: TINT.blue, floor: 3.8, bay: 1.6, crown: { kind: 'stepped', steps: 3, stepHeight: 5, inset: 0.12 }, spire: 6 } },
  ],
  5: [
    // Metrocity residences
    { spec: { height: 130, plan: { kind: 'rounded', w: 42, d: 24, r: 8 }, rotation: 20, facade: Facade.Residential, tint: TINT.clear, floor: 3.3, bay: 1.8, crown: { kind: 'flat' }, podium: { w: 120, d: 70, h: 16 } } },
    { dx: -40, dz: 45, spec: { height: 115, plan: { kind: 'rounded', w: 40, d: 24, r: 8 }, rotation: 20, facade: Facade.Residential, tint: TINT.clear, floor: 3.3, bay: 1.8, crown: { kind: 'flat' } } },
  ],
  6: [
    // Kanyon office tower (2006, 118 m)
    { spec: { height: 118, plan: { kind: 'rect', w: 48, d: 20, chamfer: 3 }, rotation: 110, facade: Facade.SilverFins, tint: TINT.silver, floor: 4, crown: { kind: 'flat' }, podium: { w: 140, d: 60, h: 18 } } },
  ],
};

/** Maslak / Huzur: Skyland twins, Spine Tower. */
const MASLAK: Catalog = {
  0: [
    {
      // Skyland İstanbul (2017): twin 284 m towers with open lit crowns
      spec: {
        height: 284,
        plan: { kind: 'rounded', w: 42, d: 42, r: 9 },
        rotation: 30,
        taper: 0.94,
        facade: Facade.BlueBand,
        tint: TINT.blueGreen,
        floor: 3.9,
        bay: 1.5,
        crown: { kind: 'fins', height: 28, spacing: 3.2, depth: 1.4, light: 'led', ledGroup: LedGroup.Skyland },
        podium: { w: 150, d: 90, h: 20 },
      },
    },
  ],
  1: [
    {
      spec: {
        height: 284,
        plan: { kind: 'rounded', w: 42, d: 42, r: 9 },
        rotation: 30,
        taper: 0.94,
        facade: Facade.BlueBand,
        tint: TINT.blueGreen,
        floor: 3.9,
        bay: 1.5,
        crown: { kind: 'fins', height: 28, spacing: 3.2, depth: 1.4, light: 'led', ledGroup: LedGroup.Skyland },
      },
    },
  ],
  2: [
    {
      // Spine Tower (2014): 202 m slab with a sloping top
      spec: {
        height: 202,
        plan: { kind: 'rect', w: 50, d: 24, chamfer: 4 },
        rotation: 60,
        facade: Facade.DarkGrid,
        tint: TINT.dark,
        floor: 4.0,
        bay: 1.5,
        crown: { kind: 'slant', low: 0.9 },
        crownLight: { color: CrownColor.WarmWhite, intensity: 1.2, depth: 18 },
        podium: { w: 80, d: 50, h: 12 },
      },
    },
  ],
};

/** Ataşehir: İstanbul Finans Merkezi (TCMB), Metropol İstanbul, Varyap Meridian... */
const ATASEHIR: Catalog = {
  0: [
    {
      // Central Bank HQ tower in the Istanbul Finance Centre (352 m), finned crown
      spec: {
        height: 352,
        plan: { kind: 'rect', w: 52, d: 52, chamfer: 12 },
        rotation: 15,
        taper: 0.82,
        facade: Facade.SilverFins,
        tint: TINT.silver,
        floor: 4.2,
        bay: 1.5,
        crown: { kind: 'fins', height: 40, spacing: 3.5, depth: 1.6, light: 'glow' },
        spire: 12,
        podium: { w: 120, d: 100, h: 18 },
      },
    },
  ],
  1: [
    {
      // Metropol İstanbul (2019): 301 m, rounded plan with a vertical-fin crown
      spec: {
        height: 301,
        plan: { kind: 'rounded', w: 58, d: 34, r: 14 },
        rotation: 40,
        taper: 0.9,
        facade: Facade.BlueBand,
        tint: TINT.blue,
        floor: 3.9,
        bay: 1.5,
        crown: { kind: 'fins', height: 30, spacing: 3, depth: 1.2, light: 'led', ledGroup: LedGroup.Metropol },
        podium: { w: 170, d: 110, h: 24 },
      },
    },
    { dx: 80, dz: 60, spec: { height: 180, plan: { kind: 'rounded', w: 44, d: 28, r: 10 }, rotation: 40, facade: Facade.Residential, tint: TINT.clear, floor: 3.4, crown: { kind: 'flat' } } },
  ],
  3: [
    // Varyap Meridian Grand Tower
    { spec: { height: 225, plan: { kind: 'ellipse', w: 50, d: 30 }, rotation: -20, facade: Facade.Residential, tint: TINT.green, floor: 3.4, bay: 1.7, crown: { kind: 'flat' }, crownLight: { color: CrownColor.CoolWhite, intensity: 0.8, depth: 8 } } },
  ],
};

/** Zincirlikuyu / Esentepe / Mecidiyeköy: Torun Center, Trump Towers, Zorlu. */
const ZINCIRLIKUYU: Catalog = {
  1: [
    // Torun Center tower (161 m)
    { spec: { height: 160, plan: { kind: 'lens', w: 48, d: 26, tip: 0.1 }, rotation: 80, facade: Facade.SilverFins, tint: TINT.silver, floor: 4, crown: { kind: 'slant', low: 0.93 }, crownLight: { color: CrownColor.CoolWhite, intensity: 1, depth: 12 } } },
  ],
  2: [
    // Trump Towers İstanbul (2012): office 155 m + residence 145 m, dark glass, angled tops
    { spec: { height: 155, plan: { kind: 'rect', w: 40, d: 30, chamfer: 2 }, rotation: 35, facade: Facade.DarkGrid, tint: TINT.dark, floor: 4, crown: { kind: 'slant', low: 0.9 }, crownLight: { color: CrownColor.WarmWhite, intensity: 1.1, depth: 10 }, podium: { w: 120, d: 80, h: 20 } } },
    { dx: 55, dz: -35, spec: { height: 145, plan: { kind: 'rect', w: 36, d: 28, chamfer: 2 }, rotation: 35, facade: Facade.DarkGrid, tint: TINT.dark, floor: 3.6, crown: { kind: 'slant', low: 0.9 }, crownLight: { color: CrownColor.WarmWhite, intensity: 1.1, depth: 10 } } },
  ],
  6: [
    // Zorlu Center residences
    { spec: { height: 110, plan: { kind: 'rect', w: 40, d: 22, chamfer: 1 }, rotation: 50, facade: Facade.Residential, tint: TINT.bronze, floor: 3.4, crown: { kind: 'flat' }, podium: { w: 160, d: 110, h: 18 } } },
    { dx: 60, dz: 30, spec: { height: 95, plan: { kind: 'rect', w: 38, d: 22, chamfer: 1 }, rotation: 50, facade: Facade.Residential, tint: TINT.bronze, floor: 3.4, crown: { kind: 'flat' } } },
    { dx: -20, dz: 70, spec: { height: 100, plan: { kind: 'rect', w: 38, d: 22, chamfer: 1 }, rotation: -40, facade: Facade.Residential, tint: TINT.bronze, floor: 3.4, crown: { kind: 'flat' } } },
  ],
};

const CATALOGS: Record<string, Catalog> = {
  'levent-kuleleri': LEVENT,
  'maslak-kuleleri': MASLAK,
  'atasehir-kuleleri': ATASEHIR,
  'zincirlikuyu-kuleleri': ZINCIRLIKUYU,
};

/** Deterministic generic tower for an anchor without a catalogue entry. */
export function genericTower(height: number, r: () => number): TowerSpec {
  const pick = <T>(list: readonly T[]): T => list[Math.floor(r() * list.length) % list.length];
  const residential = height < 140 && r() < 0.5;
  const w = 30 + r() * 22;
  const d = w * (0.55 + r() * 0.4);
  const plans = [
    { kind: 'rect' as const, w, d, chamfer: r() < 0.5 ? 0 : 4 },
    { kind: 'rounded' as const, w, d, r: 5 + r() * 6 },
    { kind: 'rect' as const, w: w * 0.9, d: w * 0.9, chamfer: 6 },
  ];
  const facade = residential ? Facade.Residential : pick([Facade.BlueBand, Facade.SilverFins, Facade.DarkGrid, Facade.GreenBand, Facade.Bronze]);
  const tint = residential ? pick([TINT.clear, TINT.green, TINT.bronze]) : pick([TINT.blueGreen, TINT.silver, TINT.dark, TINT.green, TINT.blue, TINT.bronze]);
  const crowns: TowerSpec['crown'][] = [{ kind: 'flat' }, { kind: 'flat' }, { kind: 'stepped', steps: 2, stepHeight: 6, inset: 0.1 }, { kind: 'slant', low: 0.92 }];
  return {
    height,
    plan: pick(plans),
    rotation: r() * 180,
    taper: r() < 0.25 ? 0.9 : 1,
    facade,
    tint,
    floor: residential ? 3.3 : 3.9,
    bay: residential ? 1.8 : 1.5,
    crown: pick(crowns),
    crownLight: !residential && r() < 0.4 ? { color: pick([CrownColor.WarmWhite, CrownColor.CoolWhite, CrownColor.Blue]), intensity: 0.9, depth: 8 } : undefined,
    podium: r() < 0.5 ? { w: w * 2, d: d * 1.8, h: 8 + r() * 8 } : undefined,
  };
}

export function catalogFor(id: string): Catalog {
  return CATALOGS[id] ?? {};
}
