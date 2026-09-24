/**
 * Façade plans: typology, storeys, heights, colours and per-building variation of every building the façade kit
 * builds (full-detail tiles, format 1). Deterministic: every choice comes from the OSM data, the district profile
 * (../district.ts: typology mix, storey ranges, paint, balconies, per-building spec rows) and a hash of the OSM id.
 *
 * Typologies (.docs/street/s1-strip.md, section 3):
 * - T1: 1950–70s balconied apartment (G + 4–5, floor-to-floor 3.0 m, çıkma, balconies, PVC windows, roller boxes);
 * - T2: late-Ottoman / early-Republic masonry (2–4 storeys of 3.6–4.2 m, tall windows, cornice, hipped roof on some);
 * - T3: 1980s+ infill or refit (ribbon glazing, composite panels, glass balustrades, two-storey glazed base);
 * - T5: kiosk (one storey).
 * Heights: the profile's per-building storeys (Kadıköy: S1 spec section 2) win, then OSM height / levels, then parts
 * inherit their outline's tags (Simple 3D Buildings: the outline carries building:levels, its parts do not), then a
 * hash over the profile's storey range.
 */
import * as THREE from 'three';
import type { OsmBuilding } from '../../../../src/world/osm/data';
import { pointInRing, ringArea } from '../../../../src/world/osm/shared/geometry';
import type { Solid } from '../buildings';
import type { RGBA } from '../mesh';
import { district } from '../district';
import { h01, lin, mix, pick, pickWeighted, scale } from './frame';

export type Typology = 'T1' | 'T2' | 'T3' | 'T5';
export type Railing = 'solid' | 'flatbar' | 'squarebar' | 'pipe' | 'glazed' | 'glass' | 'iron';
export type BalconyMode = 'none' | 'all' | 'alternate' | 'centre' | 'ends';

export interface FacadePlan {
  id: string;
  osmId: number;
  typ: Typology;
  /** Storeys including the ground floor. */
  storeys: number;
  /** Ground floor height and upper floor-to-floor height (m). */
  G: number;
  F: number;
  /** Street level of the floor grid (y). */
  base: number;
  /** Top of the last storey's slab = flat roof level / eave line (y). */
  roofY: number;
  roof: 'flat' | 'hipped';
  /** Parapet above the roof slab (flat roofs). */
  parapet: number;
  /** Roof pitch (tan) of hipped roofs. */
  pitch: number;
  wall: RGBA;
  trim: RGBA;
  /** Çıkma / balcony-front colour (a second paint on some T1 blocks). */
  accent: RGBA;
  frame: 'pvc' | 'timber';
  frameColor: RGBA;
  cikma: 'none' | 'full' | 'middle' | 'bay';
  cikmaDepth: number;
  balcony: BalconyMode;
  railing: Railing;
  railColor: RGBA;
  shutters: 'roller' | 'wood' | 'none';
  /** Share of T1 windows with a triple (living-room) opening. */
  triple: number;
  /** T3: storeys of shop glazing at the base (1 or 2). */
  glazedBase: number;
  /** 0 (clean) .. 1 (heavily worn). */
  wear: number;
  seed: number;
  /** Where the storeys came from. */
  source: 'spec' | 'osm-height' | 'osm-levels' | 'parent-levels' | 'hash';
}

/** A per-building row fitted to reference photos (district profiles, `buildings.spec`). */
export interface SpecRow {
  typ: Typology;
  storeys: [number, number];
  roof?: 'hipped';
  /** Fixed paint (sRGB) from a photo. */
  wall?: number;
  frame?: number;
  cikma?: FacadePlan['cikma'];
  railing?: Railing;
  glazedBase?: number;
  /** Fixed ground floor and floor-to-floor heights (m). */
  G?: number;
  F?: number;
}

/** Storey metrics per typology: ground floor, upper floor-to-floor ranges (m) and parapet. */
const METRICS: Record<Typology, { G: [number, number]; F: [number, number]; parapet: number }> = {
  T1: { G: [4.0, 4.4], F: [2.95, 3.1], parapet: 0.9 },
  T2: { G: [4.0, 4.4], F: [3.6, 3.95], parapet: 0.7 },
  T3: { G: [4.3, 4.6], F: [3.05, 3.3], parapet: 1.0 },
  T5: { G: [3.1, 3.4], F: [3, 3], parapet: 0.25 },
};

function ringCentroid(r: readonly number[]): [number, number] {
  let x = 0;
  let z = 0;
  const n = r.length / 2;
  for (let i = 0; i < n; i++) {
    x += r[i * 2];
    z += r[i * 2 + 1];
  }
  return [x / n, z / n];
}

/** Outline (building with parts) that contains a part, for tag inheritance. */
export function parentOf(part: Solid, buildings: readonly OsmBuilding[]): OsmBuilding | null {
  const [cx, cz] = ringCentroid(part.ring);
  let best: OsmBuilding | null = null;
  let bestArea = Infinity;
  for (const b of buildings) {
    if (!b.hasParts || b.id === part.rec.osmId) {
      continue;
    }
    if (Math.abs(b.ring[0] - cx) > 200 || Math.abs(b.ring[1] - cz) > 200) {
      continue;
    }
    if (pointInRing(b.ring, cx, cz)) {
      const a = Math.abs(ringArea(b.ring));
      if (a < bestArea) {
        best = b;
        bestArea = a;
      }
    }
  }
  return best;
}

/** Plans one building. `osm` is its own record; `parent` the outline it is a part of (if any). */
export function planFacade(s: Solid, osm: OsmBuilding | undefined, parent: OsmBuilding | null, streetBase: number): FacadePlan {
  const seed = (Math.abs(s.rec.osmId) % 1_000_003) * 0.618 + 0.37;
  const H = (k: number): number => h01(seed, k);
  const area = Math.abs(ringArea(s.ring));
  const dp = district();
  const spec = dp.buildings.spec[s.rec.osmId];
  let typ: Typology;
  if (spec) {
    typ = spec.typ;
  } else if (area < 25 || ['kiosk', 'shed', 'hut', 'booth', 'container'].includes(s.rec.kind)) {
    typ = 'T5';
  } else {
    typ = pickWeighted<Typology>(dp.buildings.typology(area, s.rec.kind), H(1));
  }
  const met = METRICS[typ];
  const G = spec?.G ?? met.G[0] + (met.G[1] - met.G[0]) * H(2);
  const F = spec?.F ?? met.F[0] + (met.F[1] - met.F[0]) * H(3);
  let storeys: number;
  let source: FacadePlan['source'];
  const levels = osm?.levels ?? (s.rec.heightSource === 'default' ? parent?.levels : undefined);
  const height = osm?.height ?? (s.rec.heightSource === 'default' ? parent?.height : undefined);
  if (spec) {
    storeys = spec.storeys[0] + Math.floor(H(4) * (spec.storeys[1] - spec.storeys[0] + 1));
    source = 'spec';
  } else if (height) {
    storeys = Math.max(1, Math.round((height - G) / F) + 1);
    source = 'osm-height';
  } else if (levels) {
    storeys = levels + (osm?.roofLevels ?? 0);
    source = osm?.levels ? 'osm-levels' : 'parent-levels';
  } else {
    const [lo, hi] = typ === 'T5' ? [1, 1] : dp.buildings.storeys[typ];
    storeys = lo + Math.floor(H(4) * (hi - lo + 1));
    if (typ !== 'T5' && area < 45) {
      storeys = Math.max(2, storeys - 2);
    }
    source = 'hash';
  }
  if (typ === 'T5') {
    storeys = 1;
  }
  const roof: FacadePlan['roof'] = spec?.roof ?? (typ === 'T2' && osm?.roofShape !== 'flat' && H(5) < 0.25 && area < 260 ? 'hipped' : osm?.roofShape === 'hipped' ? 'hipped' : 'flat');
  const roofY = streetBase + G + (storeys - 1) * F;

  const pal = dp.facade.paint;
  const paint = spec?.wall ?? osmPaint(osm?.colour) ?? (typ === 'T2' ? pickWeighted(pal.T2, H(6)) : typ === 'T3' ? pickWeighted(pal.T3, H(6)) : pickWeighted(pal.T1, H(6)));
  const wear = Math.min(1, Math.max(0, (typ === 'T2' ? 0.7 : typ === 'T3' ? 0.25 : 0.5) + dp.buildings.wearBias + (H(7) - 0.5) * 0.6));
  const wall = scale(lin(paint), 0.92 + 0.1 * H(8) - wear * 0.08);
  const trim = typ === 'T3' ? lin(0xdcdbd6) : scale(mix(lin(pick(pal.trim, H(9))), wall, 0.25 * H(10)), 1 - wear * 0.06);
  const accent = typ === 'T1' && H(11) < 0.4 ? scale(lin(pickWeighted(pal.T1, H(12))), 0.9) : H(11) < 0.7 ? scale(wall, 0.9) : wall;
  const timber = typ === 'T2' ? H(13) < 0.55 : H(13) < 0.2;
  const frameColor = spec?.frame !== undefined ? lin(spec.frame) : timber ? lin(pick([0x5b4131, 0x66503d, 0x44503f, 0x4d4034], H(14))) : lin(0xe6e5df, 0.95 - 0.1 * H(14));

  let cikma: FacadePlan['cikma'] = 'none';
  if (spec?.cikma) {
    cikma = spec.cikma;
  } else if (typ === 'T1' && storeys >= 4) {
    cikma = H(15) < 0.35 ? 'full' : H(15) < 0.62 ? 'middle' : 'none';
  } else if (typ === 'T2' && storeys >= 3 && H(15) < 0.3) {
    cikma = 'bay';
  } else if (typ === 'T3' && storeys >= 4 && H(15) < 0.4) {
    cikma = 'full';
  }
  let balcony: BalconyMode = 'none';
  if (typ === 'T1' && storeys >= 3) {
    balcony = pickWeighted<BalconyMode>(dp.facade.t1Balcony, H(16));
  } else if (typ === 'T2' && storeys >= 3) {
    balcony = spec?.railing === 'iron' || H(16) < dp.facade.t2Balcony ? 'centre' : 'none';
  } else if (typ === 'T3' && storeys >= 3) {
    balcony = H(16) < 0.6 ? 'all' : 'alternate';
  }
  const railing: Railing =
    spec?.railing ??
    (typ === 'T2'
      ? 'iron'
      : typ === 'T3'
        ? H(17) < 0.6
          ? 'glass'
          : 'pipe'
        : pickWeighted<Railing>(
            [
              ['solid', 0.4],
              ['flatbar', 0.2],
              ['squarebar', 0.15],
              ['pipe', 0.1],
              ['glazed', 0.15],
            ],
            H(17),
          ));
  const railColor = railing === 'pipe' ? lin(0xa9acac) : railing === 'iron' ? lin(0x2e2f2d) : lin(pick([0x323432, 0x3f4a45, 0xd6d3cb, 0x55402f, 0x34404e], H(18)));
  return {
    id: s.rec.id,
    osmId: s.rec.osmId,
    typ,
    storeys,
    G,
    F,
    base: streetBase,
    roofY,
    roof,
    parapet: roof === 'hipped' ? 0 : met.parapet,
    pitch: Math.tan(((24 + 8 * H(19)) * Math.PI) / 180),
    wall,
    trim,
    accent,
    frame: timber ? 'timber' : 'pvc',
    frameColor,
    cikma,
    cikmaDepth: cikma === 'bay' ? 0.7 : 0.9 + 0.3 * H(20),
    balcony,
    railing,
    railColor,
    shutters: typ === 'T2' ? (H(21) < 0.55 ? 'wood' : 'none') : typ === 'T1' ? (H(21) < 0.75 ? 'roller' : 'none') : 'none',
    triple: typ === 'T1' ? 0.25 + 0.3 * H(22) : 0,
    glazedBase: spec?.glazedBase ?? (typ === 'T3' && H(23) < 0.4 ? 2 : 1),
    wear,
    seed,
    source,
  };
}

/** sRGB hex of an OSM building:colour (CSS name or #hex), or undefined when unreadable. */
function osmPaint(v: string | undefined): number | undefined {
  if (!v) {
    return undefined;
  }
  const c = new THREE.Color();
  try {
    c.setStyle(v.replace(/_/g, ''), THREE.SRGBColorSpace);
  } catch {
    return undefined;
  }
  return Number.isFinite(c.r) ? c.getHex(THREE.SRGBColorSpace) : undefined;
}

/** Wall top (topY) of a plan: parapet top for flat roofs, the ridge for hipped ones (conservative box). */
export function planTop(p: FacadePlan, ridgeRise: number): number {
  return p.roof === 'hipped' ? p.roofY + ridgeRise : p.roofY + p.parapet;
}
