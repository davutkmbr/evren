/**
 * The vessels the web game draws, as export sources: the life fleet's designs (src/world/life/vessels/catalog.ts) in
 * their liveries and the waterfront's moored boats (src/world/osm/details/waterfront/boats.ts) in their colour sets,
 * plus what other runtimes need around the meshes: paints, liveries flagged for trademarks, physics and handling data,
 * idle motion, and an estimate of the propulsion (the web models have no propellers).
 */
import type * as THREE from 'three';
import { RECIPES } from '../../../src/world/life/vessels/catalog';
import { HULL_PAINTS, SERVICE_HANDLING } from '../../../src/world/life/vessels/fleet-data';
import { GENERIC_LIVERY } from '../../../src/world/life/vessels/models/ferries';
import type { LiveryId, NavLightDef, VesselKind } from '../../../src/world/life/vessels/model-types';
import { buildHullBody, HULL_DESIGNS } from '../../../src/world/life/vessels/physics/hull-data';
import { FISH_BREAD_COLOURS, fishBreadBoat, kayik, KAYIK_COLOURS } from '../../../src/world/osm/details/waterfront/boats';

/** 'life': MeshBuilder layout (color, aSurf, aDetail, userData.parts); 'prop': waterfront props (color, aGlow). */
export type Layout = 'life' | 'prop';

export interface BuiltGeometry {
  geometry: THREE.BufferGeometry;
  layout: Layout;
}

export interface VariantSource {
  /** 'generic' / 'web' (liveries) or a colour set (moored boats). */
  id: string;
  /** File key: the design id for the default variant, `<design>--<variant>` for the others. */
  key: string;
  isDefault: boolean;
  releaseSafe: boolean;
  /** What in this variant is, or evokes, a real operator's marks or livery. */
  trademarks: string[];
  /** Instance hull paints (sRGB) for the painted surfaces; empty when every colour is baked. */
  paints: readonly number[];
  /** Geometry per LOD, or null when the variant only repaints the default variant's meshes. */
  build: ((lod: 0 | 1) => BuiltGeometry) | null;
}

export type PropulsionType = 'propeller' | 'azimuth' | 'waterjet' | 'outboard';

export interface Propulsion {
  type: PropulsionType;
  /** Units side by side (1 on the centreline, 2 at ±spread x half-beam). */
  count: 1 | 2;
  spread: number;
  /** Diameter as a share of the draft. */
  diameter: number;
  /** Double-enders drive from both ends. */
  bothEnds?: boolean;
}

export interface DesignSource {
  id: string;
  family: 'fleet' | 'waterfront';
  kind: string;
  title: string;
  length: number;
  beam: number;
  draft: number;
  /** Web: big ships reflect in the water and cast shadows further. */
  big: boolean;
  /** Camera distance (m) where the web switches to lod1; null = single LOD. */
  lodDistance: number | null;
  lights: NavLightDef[];
  airDraft: number;
  /** The web builds these boats bow to +Z: the export turns them half a turn to the fleet's bow to -Z. */
  turn: boolean;
  catamaran: boolean;
  doubleEnded: boolean;
  planing: boolean;
  propulsion: Propulsion | null;
  variants: VariantSource[];
  motion: Record<string, unknown>;
  physics?: Record<string, unknown>;
  handling?: Record<string, unknown>;
}

const TITLES: Record<string, string> = {
  vapur: 'City ferry (vapur) after the classic Istanbul steamers, 72 m',
  ferry: 'Double-ended city ferry after the 2015 Küçüksu class, 41.7 m',
  seabus: 'Fast catamaran sea bus (deniz otobüsü), 38.5 m',
  tour: 'Bosphorus excursion boat, 30 m',
  tug: 'Harbour tug, 26 m',
  pilot: 'Pilot boat, 16 m',
  motorboat: 'Motorboat / water taxi, 8.5 m',
  'tanker-a': 'Product tanker, 183 m',
  'tanker-b': 'Product tanker, 228 m',
  'tanker-c': 'Coastal tanker, 118 m',
  'container-a': 'Feeder container ship, 172 m',
  'container-b': 'Container ship, 222 m',
  'bulk-a': 'Bulk carrier, 180 m',
  'bulk-b': 'Bulk carrier, 146 m',
  fishing: 'Bosphorus fishing boat (balıkçı teknesi), 9.5 m',
  seiner: 'Purse seiner (gırgır), 28 m',
  yacht: 'Motor yacht, 24 m',
  sailboat: 'Sailing yacht under engine, 13 m',
  'balik-ekmek': 'Balık-ekmek boat moored at the Eminönü quay, 14 m',
  kayik: 'Kayık, a small open fishing boat with a wheelhouse, 7.5 m',
};

/** Designs whose web livery follows a real operator; the export's default is the generic livery. */
const REAL_LIVERIES: Record<string, { trademarks: string[]; geometry: boolean; genericPaints?: readonly number[] }> = {
  vapur: {
    geometry: true,
    trademarks: [
      'Şehir Hatları funnel emblem: red crossed anchors under a crescent and star (after the Denizcilik Bankası insignia)',
      'Şehir Hatları livery: white hull and houses with the ochre stripe, ochre masts and ochre funnel bands',
    ],
  },
  ferry: {
    geometry: true,
    trademarks: ['Şehir Hatları livery (ŞH-Küçüksu class): white with the ochre stripe, ochre mast and exhaust stacks'],
  },
  seabus: {
    geometry: true,
    trademarks: ['İDO sea bus livery: navy demihulls, navy band and red stripe on white'],
    genericPaints: [GENERIC_LIVERY.band],
  },
  tour: {
    geometry: false,
    trademarks: ['Turyol blue and Dentur red stripe paints (colours only; no names or logos in the model)'],
    genericPaints: HULL_PAINTS.tour.filter((c) => c !== 0x1f4f9a && c !== 0xb3261e),
  },
};

/** The web models carry no propellers: units, spread and size estimated per kind (sockets marked `estimated`). */
const PROPULSION: Partial<Record<string, Propulsion>> = {
  vapur: { type: 'propeller', count: 2, spread: 0.3, diameter: 0.6 },
  ferry: { type: 'azimuth', count: 1, spread: 0, diameter: 0.65, bothEnds: true },
  seabus: { type: 'waterjet', count: 2, spread: 0.74, diameter: 0.45 },
  tour: { type: 'propeller', count: 1, spread: 0, diameter: 0.55 },
  tug: { type: 'azimuth', count: 2, spread: 0.45, diameter: 0.6 },
  pilot: { type: 'propeller', count: 2, spread: 0.4, diameter: 0.5 },
  motorboat: { type: 'outboard', count: 2, spread: 0.32, diameter: 0.6 },
  tanker: { type: 'propeller', count: 1, spread: 0, diameter: 0.62 },
  container: { type: 'propeller', count: 1, spread: 0, diameter: 0.65 },
  bulk: { type: 'propeller', count: 1, spread: 0, diameter: 0.62 },
  fishing: { type: 'propeller', count: 1, spread: 0, diameter: 0.5 },
  seiner: { type: 'propeller', count: 1, spread: 0, diameter: 0.55 },
  yacht: { type: 'propeller', count: 2, spread: 0.4, diameter: 0.45 },
  sailboat: { type: 'propeller', count: 1, spread: 0, diameter: 0.45 },
  kayik: { type: 'propeller', count: 1, spread: 0, diameter: 0.5 },
};

const PLANING = new Set(['seabus', 'motorboat', 'pilot', 'yacht']);

const round = (v: number, k = 1000): number => Math.round(v * k) / k;

function physicsOf(kind: VesselKind, length: number, beam: number, draft: number): Record<string, unknown> {
  const body = buildHullBody({ kind, length, beam, draft });
  return {
    design: body.design,
    massTonnes: round(body.mass / 1000, 10),
    volume: round(body.volume, 10),
    freeboard: round(body.freeboard),
    kb: round(body.kb),
    kg: round(body.kg),
    gm: round(body.gm),
    thrustMaxKn: round(body.thrustMax / 1000, 10),
    periods: { heave: round(body.periods.heave, 100), roll: round(body.periods.roll, 100), pitch: round(body.periods.pitch, 100) },
  };
}

/** Every exported design, fleet first (catalog order), then the moored waterfront boats. */
export function collectDesigns(): DesignSource[] {
  const out: DesignSource[] = [];
  for (const r of RECIPES) {
    const near = r.build({ lod: 0 });
    const real = REAL_LIVERIES[r.key];
    const build = (livery: LiveryId) => (lod: 0 | 1): BuiltGeometry => ({ geometry: r.build({ lod, livery }).geometry, layout: 'life' });
    const variants: VariantSource[] = [
      { id: 'generic', key: r.key, isDefault: true, releaseSafe: true, trademarks: [], paints: real?.genericPaints ?? HULL_PAINTS[r.kind], build: build('generic') },
    ];
    if (real) {
      variants.push({ id: 'web', key: `${r.key}--web`, isDefault: false, releaseSafe: false, trademarks: real.trademarks, paints: HULL_PAINTS[r.kind], build: real.geometry ? build('web') : null });
    }
    const design = HULL_DESIGNS[r.kind];
    const handling = SERVICE_HANDLING[r.key];
    out.push({
      id: r.key,
      family: 'fleet',
      kind: r.kind,
      title: TITLES[r.key] ?? r.key,
      length: r.length,
      beam: r.beam,
      draft: r.draft,
      big: r.big,
      lodDistance: r.lodDistance,
      lights: near.lights,
      airDraft: near.airDraft,
      turn: false,
      catamaran: !!design.catamaran,
      doubleEnded: !!design.doubleEnded,
      planing: PLANING.has(r.kind),
      propulsion: PROPULSION[r.kind] ?? null,
      variants,
      motion: {
        source: 'the floating rigid body (physics): heave, roll and pitch on the waves, heel in turns, squat and planing trim',
        radar: 'the web draws the scanners still; real marine radars turn at about 24 rpm (2.5 rad/s) about +Y',
        flags: 'the web draws the cloth still (two panels); TEXCOORD_3.x = 0 at the staff .. 1 at the fly for a wind flutter',
      },
      physics: physicsOf(r.kind, r.length, r.beam, r.draft),
      ...(handling ? { handling } : {}),
    });
  }

  // Moored boats: rocking about their keel (props/material.ts ROCK_VERTEX), colours baked per set.
  const rock = {
    source: 'idle rocking about the boat origin (the web vertex shader), phase random per boat in [0, 2π)',
    formula: 'angle or offset = Σ amplitude × sin(omega × t + phaseScale × phase)',
    roll: [{ amplitude: 0.045, omega: 0.83, phaseScale: 1 }, { amplitude: 0.02, omega: 1.91, phaseScale: 2.3 }],
    pitch: [{ amplitude: 0.018, omega: 0.61, phaseScale: 1.7 }],
    heave: [{ amplitude: 0.12, omega: 0.97, phaseScale: 0.7 }],
    units: 'rad (roll, pitch), m (heave), rad/s (omega)',
  };
  const moored = (id: string, length: number, beam: number, draft: number, names: readonly string[], builders: readonly (() => THREE.BufferGeometry)[]): DesignSource => {
    if (names.length !== builders.length) throw new Error(`${id}: ${builders.length} colour sets, ${names.length} names`);
    return {
      id,
      family: 'waterfront',
      kind: id,
      title: TITLES[id],
      length,
      beam,
      draft,
      big: false,
      lodDistance: null,
      lights: [],
      airDraft: 0,
      turn: true,
      catamaran: false,
      doubleEnded: false,
      planing: false,
      propulsion: PROPULSION[id] ?? null,
      variants: builders.map((b, i) => ({
        id: names[i],
        key: i === 0 ? id : `${id}--${names[i]}`,
        isDefault: i === 0,
        releaseSafe: true,
        trademarks: [],
        paints: [],
        build: () => ({ geometry: b(), layout: 'prop' as const }),
      })),
      motion: rock,
    };
  };
  out.push(
    moored('balik-ekmek', 14, 4.6, 0.9, ['navy', 'red', 'green'], FISH_BREAD_COLOURS.map(([h, t, c]) => () => fishBreadBoat(h, t, c))),
    moored('kayik', 7.5, 2.4, 0.5, ['white-blue', 'teal', 'white-green', 'yellow'], KAYIK_COLOURS.map(([h, s]) => () => kayik(h, s))),
  );
  return out;
}
