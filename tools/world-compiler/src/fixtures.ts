/**
 * Default street lamp fixtures (format 1): every lamp record of the manifest (lamps.ts: OSM nodes first, then the
 * flight slice's street lighting rules) becomes a prop instance with the lights of its template. Kerb masts are
 * procedural stand-ins (props.ts); post lanterns and wall brackets use the approved Poly Haven lamps. A lane that
 * places its own lamp fixtures replaces this entry in registry.ts.
 */
import type { LampRec } from './format';
import { headingYaw } from './instances';
import { LAMP_KELVIN } from './lights';
import type { CompileStep } from './registry';

/** Prop of each lamp kind, and the height of the wall bracket's plate above the ground. */
const LAMP_PROPS: Record<string, { prop: string; variantByLight: boolean; lift?: number }> = {
  arm: { prop: 'lamp_mast', variantByLight: true },
  armLow: { prop: 'lamp_mast_low', variantByLight: true },
  double: { prop: 'lamp_mast_double', variantByLight: true },
  lantern: { prop: 'street_lamp_01', variantByLight: false },
  wall: { prop: 'street_lamp_02', variantByLight: false, lift: 3.9 },
};

export const lampFixturesStep: CompileStep = {
  id: 'lampFixtures',
  tile(t) {
    t.manifest.lamps.forEach((l: LampRec, k) => {
      const spec = LAMP_PROPS[l.kind];
      if (!spec) {
        return;
      }
      const pos: [number, number, number] = [l.position[0], l.position[1] + (spec.lift ?? 0), l.position[2]];
      t.place(spec.prop, pos, headingYaw(l.heading, '+Z'), {
        ...(spec.variantByLight ? { variant: l.light } : {}),
        ref: `${t.id}/lamp${k}`,
        lights: { kelvin: LAMP_KELVIN[l.light] },
      });
    });
  },
};
