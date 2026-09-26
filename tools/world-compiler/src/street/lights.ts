/**
 * Street lamps and shopfront light of the street tiles (format 1), replacing the core lamp fixtures (../fixtures.ts);
 * the other tiles get the core step's lamps under the same placement rules (placeLamps):
 * - lamp records of the manifest (lamps.ts: the flight slice's lighting rules) become instances as in the core step:
 *   kerb masts (sodium 2000 K / LED 4000 K / warm 3000 K), wall brackets (street_lamp_02) and post lanterns
 *   (street_lamp_01) — except post lanterns within PENDANT_REACH of a span-wire pendant (furniture.ts), which lights
 *   the pedestrian lanes as in the photos (warm pendants every 11-14 m at 5-6 m, s1-strip.md §3 night light);
 * - every storefront door with a POI gets its interior spill: a spot inside the shop window aimed out and down
 *   (cafés and restaurants 3000 K, shops 4500 K, pharmacies 6000 K), on at night; half of them also a sign light
 *   above the door (warm 2400 K or cool 6500 K). Doors that a façade or shopfront step already lit (its window /
 *   interior lights) are skipped, so this is the fallback for the other storefronts.
 */
import { hash } from '../../../../src/world/osm/shared/geometry';
import type { LampRec, XYZ } from '../format';
import { headingYaw, rotateYaw } from '../instances';
import { LAMP_KELVIN } from '../lights';
import type { CompileStep, TileContext } from '../registry';
import { streetContext, streetTile } from './common';
import { streetPlan } from './furniture';
import { placementRules, propRule } from './placement';

const PENDANT_REACH = 7;

const LAMP_PROPS: Record<string, { prop: string; variantByLight: boolean; lift?: number }> = {
  arm: { prop: 'lamp_mast', variantByLight: true },
  armLow: { prop: 'lamp_mast_low', variantByLight: true },
  double: { prop: 'lamp_mast_double', variantByLight: true },
  lantern: { prop: 'street_lamp_01', variantByLight: false },
  wall: { prop: 'street_lamp_02', variantByLight: false, lift: 3.9 },
};

const FOOD = /^amenity=(cafe|restaurant|fast_food|ice_cream|bar|pub)$/;

/**
 * Places the tile's lamp records under the placement rule of their prop (every tile, so a lite tile's kerb mast
 * clears the kerb like a full tile's). `street`: a street tile, where post lanterns near a span-wire pendant give way
 * to it and lanterns carry their own spot + point lights; elsewhere every lamp keeps its template light (as the core
 * lampFixturesStep).
 */
function placeLamps(t: TileContext, street: boolean): { lamps: number; replaced: number } {
  const pendants = street ? streetPlan(t.area).pendants : [];
  const rules = placementRules(t.area);
  let lamps = 0;
  let replaced = 0;
  t.manifest.lamps.forEach((l: LampRec, k) => {
    const spec = LAMP_PROPS[l.kind];
    if (!spec) {
      return;
    }
    if (l.kind === 'lantern' && pendants.some(([x, z]) => Math.hypot(x - l.position[0], z - l.position[2]) < PENDANT_REACH)) {
      replaced++;
      return;
    }
    // Placement rule of the lamp's prop (placement.ts: masts and post lanterns behind the kerb, off façades and door
    // approaches); wall brackets are exempt.
    const rule = propRule(spec.prop);
    let pos: XYZ = [l.position[0], l.position[1] + (spec.lift ?? 0), l.position[2]];
    if (rule) {
      const spot = rules.settle(pos[0], pos[2], rule.spec, rule.reach);
      if (!spot) {
        rules.log.note(rule.rule, 'dropped');
        return;
      }
      const moved = spot[0] !== pos[0] || spot[1] !== pos[2];
      rules.log.note(rule.rule, moved ? 'moved' : 'kept');
      if (moved) {
        pos = [spot[0], streetContext(t.area).groundY(spot[0], spot[1]) + (spec.lift ?? 0), spot[1]];
      }
    }
    const yaw = headingYaw(l.heading, '+Z');
    const lantern = street && (spec.prop === 'street_lamp_01' || spec.prop === 'street_lamp_02');
    t.place(spec.prop, pos, yaw, {
      ...(spec.variantByLight ? { variant: l.light } : {}),
      ref: `${t.id}/lamp${k}`,
      lights: lantern ? false : { kelvin: LAMP_KELVIN[l.light] },
    });
    if (lantern) {
      lanternLights(t, spec.prop, pos, yaw, `${t.id}/lamp${k}`, LAMP_KELVIN[l.light]);
    }
    lamps++;
  });
  return { lamps, replaced };
}

/** Lamp-head offsets (prop space) of the approved lanterns: post lantern and wall bracket. */
const LANTERN_HEAD: Record<string, XYZ> = { street_lamp_01: [0, 3.3, 0], street_lamp_02: [0, 0.72, 0.61] };

/**
 * Lights of a lantern (s1-strip.md §3 night light, critique of the S1 renders): a 3,800 lm downward spot with a
 * 120° cone that makes the pool of light on the paving, and a 600 lm point for the glowing glass and the spill up
 * the façades (4,400 lm in all, a 35-45 W LED lantern). Used for the post and wall lanterns instead of their
 * template's single point.
 */
export function lanternLights(t: TileContext, prop: string, pos: XYZ, yaw: number, ref: string, kelvin: number): void {
  const o = rotateYaw(LANTERN_HEAD[prop] ?? [0, 3.3, 0], yaw);
  const head: XYZ = [pos[0] + o[0], pos[1] + o[1], pos[2] + o[2]];
  t.lights.add({ type: 'spot', position: [head[0], head[1] - 0.12, head[2]], direction: [0, -1, 0], kelvin, lumens: 3800, cone: { inner: 30, outer: 60 }, night: true, source: 'lamp', ref });
  t.lights.add({ type: 'point', position: head, kelvin, lumens: 600, night: true, source: 'lamp', ref });
}

function shopLights(t: TileContext): { windows: number; signs: number } {
  // Doors a façade / shopfront step already lit (window or interior lights by door id, shop interiors by POI id).
  const refs = t.lights.list.filter((l) => l.source === 'window' || l.source === 'sign' || l.source === 'interior').map((l) => l.ref ?? '');
  const lit = (d: { id: string; pois: string[] }): boolean => refs.some((r) => r.startsWith(`${d.id}/`) || d.pois.some((p) => r === `${t.id}/shop:${p}`));
  const pois = new Map(t.manifest.pois.map((p) => [p.id, p]));
  let windows = 0;
  let signs = 0;
  for (const d of t.manifest.doors) {
    if (!d.pois.length || lit(d)) {
      continue;
    }
    const kind = pois.get(d.pois[0])?.kind ?? '';
    const [nx, , nz] = d.normal;
    const [x, y, z] = d.position;
    const kelvin = FOOD.test(kind) ? 3000 : kind === 'amenity=pharmacy' ? 6000 : 4500;
    const dl = Math.hypot(nx, 0.75, nz);
    t.lights.add({
      type: 'spot',
      position: [x - nx * 0.5, y + 2.6, z - nz * 0.5],
      direction: [nx / dl, -0.75 / dl, nz / dl],
      kelvin,
      lumens: FOOD.test(kind) ? 1600 : 2000,
      cone: { inner: 35, outer: 75 },
      night: true,
      source: 'window',
      ref: `${d.id}/window`,
    });
    windows++;
    if (hash(x * 0.71 + z * 1.3) < 0.5) {
      t.lights.add({
        type: 'point',
        position: [x + nx * 0.4, y + 3.3, z + nz * 0.4],
        kelvin: hash(x + z) < 0.6 ? 2400 : 6500,
        lumens: 500,
        night: true,
        source: 'sign',
        ref: `${d.id}/sign`,
      });
      signs++;
    }
  }
  return { windows, signs };
}

export const streetLightsStep: CompileStep = {
  id: 'streetLights',
  tile(t) {
    if (!streetTile(t)) {
      placeLamps(t, false);
      return;
    }
    const l = placeLamps(t, true);
    const s = shopLights(t);
    t.record('streetLights', { ...l, ...s });
  },
};
