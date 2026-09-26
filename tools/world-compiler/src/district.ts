/**
 * District profiles: everything district-flavoured the compiler needs, chosen by the area id
 * (tools/world-compiler/districts/<area>.ts, `generic` for areas without their own profile). The data-driven core
 * (OSM geometry, façade kit, shopfronts from POIs, kerbs and sidewalks, weathering, props, lamps from the lighting
 * rules) runs for every area; a profile only tunes it and switches the hand-authored steps on or off.
 *
 * One compile run compiles one area, so the active profile is process state: cli.ts calls `useDistrict` before
 * anything else and every module reads `district()`. Tools that never call `useDistrict` get the generic profile.
 */
import type { OsmBuilding } from '../../../src/world/osm/data';
import { DISTRICTS, GENERIC, PROFILES } from '../districts';
import { readLandingSpot } from '../lib/areas.mjs';
import type { BalconyMode, SpecRow, Typology } from './facade/plan';
import type { Bounds2 } from './format';
import type { MaterialDef } from './materials';
import type { Trade } from './shopfront/names';

export type Weighted<T> = readonly (readonly [T, number])[];

/** Hand-authored steps (registry.ts `CompileStep.handAuthored`); they run only where the profile switches them on. */
export type HandAuthored = 'heroes' | 'soul' | 'precinct' | 'interiors';

export interface DistrictProfile {
  id: string;
  label: string;
  /**
   * Default full-detail rect when `--strip` is not given (strip.ts). `rect` wins; else `cameras` (a camera spec with
   * a `strip` rect), `spec` (a markdown file naming a rect) and `route` (the bbox of a src/street/routes.ts route +
   * 30 m) are tried in this order. null: every tile greybox.
   */
  strip: { rect?: Bounds2; cameras?: string; spec?: string; route?: string } | null;
  /**
   * Hand-fitted reference cameras (repo-relative, e.g. tools/world-compiler/s1/cameras.json): the street lane reads
   * the spine, the arrival square, the off-spine kit tiles and the clear foregrounds from it. null: none.
   */
  cameras: string | null;
  handAuthored: Readonly<Record<HandAuthored, boolean>>;
  buildings: {
    /** Storeys of untagged buildings in greybox blocks (buildings.ts). */
    defaultLevels: number;
    /** Typology weights of an untagged, non-kiosk building (facade/plan.ts; `u` is not used for picking). */
    typology(area: number, kind: string): Weighted<Typology>;
    /** Storey range (incl. the ground floor) of untagged buildings per typology. */
    storeys: Readonly<Record<'T1' | 'T2' | 'T3', readonly [number, number]>>;
    /** Per-building rows fitted to reference photos (OSM id -> typology, storeys, paint...). */
    spec: Readonly<Record<number, SpecRow>>;
    /** Buildings a hand-made hero replaces: the façade kit leaves them alone. */
    heroIds: ReadonlySet<number>;
    heroHeights: Readonly<Record<number, number>>;
    /** Buildings shown as simple massing (manifest `landmark`), besides the generic rule (isLandmark). */
    landmarkIds: ReadonlySet<number>;
    /** Buildings whose shops are shuttered. */
    shuttered: ReadonlySet<number>;
    /** Added to every building's wear (0..1). */
    wearBias: number;
  };
  facade: {
    /** Paint (sRGB, weight) per typology; `trim` = cornice / surround colours. */
    paint: { T1: Weighted<number>; T2: Weighted<number>; T3: Weighted<number>; trim: readonly number[] };
    /** Balcony layout of T1 blocks. */
    t1Balcony: Weighted<BalconyMode>;
    /** Share of T2 blocks with a centre balcony. */
    t2Balcony: number;
    /** Multiplier on the share of windows with an AC unit. */
    acScale: number;
    /** Colours of the two-colour flags on balconies and in windows (sRGB). */
    flag: readonly [number, number];
    /** The busy market end of a district (fish / produce stalls, more awnings), or none. */
    market(x: number, z: number): boolean;
  };
  shops: {
    /** First words of the fictional shop names (family names, nature words, place words of the district). */
    firstWords: readonly string[];
    /** Trades of ground-floor shops without a mapped POI, in and outside the market. */
    filler: readonly Trade[];
    marketFiller: readonly Trade[];
    /** Trades for POI kinds tradeOf does not know. */
    fallback: readonly Trade[];
    /** POI kind (e.g. 'shop=spices') -> trade, before tradeOf's own mapping. */
    tradeOverrides: Readonly<Record<string, Trade>>;
  };
  street: {
    /** Placeholder crowd density (people / m²) where no reference spine drives it: pedestrian streets, pavements, squares. */
    crowd: { pedestrian: number; sidewalk: number; square: number };
    /** Iron railings along OSM barrier=fence lines (streetBarriers step). Default off. */
    barriers?: boolean;
  };
  /** District versions of registered materials (same id, registered over the lanes' definitions), e.g. local paving. */
  materials?: readonly MaterialDef[];
}

let active: DistrictProfile | null = null;

/**
 * Selects the profile of `areaId` for this process and returns it: the area's own profile, else the landing spot's
 * (spotProfile), else the generic one.
 */
export function useDistrict(areaId: string): DistrictProfile {
  active = DISTRICTS[areaId] ?? spotProfile(areaId) ?? { ...GENERIC, id: areaId };
  return active;
}

/**
 * Profile of a landing spot without an area of its own (districts/landing-spots.json): its base profile with the
 * spot's id and name, the spot's whole square as the full-detail strip and its place words first in the shop names.
 */
function spotProfile(areaId: string): DistrictProfile | null {
  const spot = readLandingSpot(areaId);
  if (!spot || spot.area) {
    return null;
  }
  const base = PROFILES[spot.profile];
  if (!base) {
    throw new Error(`landing spot '${spot.id}': unknown profile '${spot.profile}' (known: ${Object.keys(PROFILES).join(', ')})`);
  }
  return {
    ...base,
    id: spot.id,
    label: spot.name,
    strip: { rect: spot.rect },
    cameras: null,
    handAuthored: { heroes: false, soul: false, precinct: false, interiors: false },
    buildings: { ...base.buildings, spec: {}, heroIds: new Set(), heroHeights: {}, landmarkIds: new Set(), shuttered: new Set() },
    shops: { ...base.shops, firstWords: [...spot.placeWords, ...GENERIC.shops.firstWords] },
  };
}

/** The active district profile (generic until useDistrict is called). */
export function district(): DistrictProfile {
  return active ?? GENERIC;
}

const WORSHIP_KINDS = new Set(['mosque', 'church', 'chapel', 'synagogue', 'temple', 'cathedral', 'religious', 'shrine', 'monastery']);
const LANDMARK_HISTORIC = new Set(['tomb', 'monument', 'memorial', 'fountain', 'mosque', 'church', 'castle', 'city_gate', 'tower', 'mausoleum']);
const LANDMARK_AMENITY = new Set(['place_of_worship', 'public_bath', 'monastery']);

/**
 * Landmark class of a building, or null: places of worship (mosques, churches, synagogues, masjids, medreses mapped as
 * mosques), historic tombs, fountains and monuments, hamams, and the profile's own list (e.g. a covered bazaar).
 * Landmarks get simple stone massing instead of an apartment façade or shopfronts, and the manifest flags them so a
 * runtime that draws its own landmark models can hide them.
 */
let landmarkBlocks = true;

/**
 * `--landmarks none`: landmark buildings get no geometry at all (a runtime that draws its own landmark models, e.g. the
 * flight game's mosques and the Galata slice's buildings, shows through); their manifest records stay for colliders.
 */
export function setLandmarkBlocks(on: boolean): void {
  landmarkBlocks = on;
}

export function landmarkBlocksEnabled(): boolean {
  return landmarkBlocks;
}

export function landmarkOf(b: Pick<OsmBuilding, 'id' | 'kind'> & { amenity?: string; historic?: string }): string | null {
  if (district().buildings.landmarkIds.has(b.id)) {
    return b.amenity === 'marketplace' ? 'market' : 'landmark';
  }
  if (WORSHIP_KINDS.has(b.kind) || b.amenity === 'place_of_worship') {
    return 'worship';
  }
  if (b.historic && LANDMARK_HISTORIC.has(b.historic)) {
    return b.historic;
  }
  if (b.amenity && LANDMARK_AMENITY.has(b.amenity)) {
    return b.amenity;
  }
  return null;
}
