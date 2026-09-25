/**
 * Street lane of the world compiler (format 1): ground and street dressing of the S1 strip and the street kit tiles
 * (.docs/street/s1-strip.md). Registered in ../registry.ts: the ground step replaces the core ground (format 0 and
 * greybox tiles keep it), the lights step replaces the core lamp fixtures (other tiles keep them), and markings,
 * furniture, the Aya Efimia precinct and the placeholder crowd run on the street tiles.
 */
import type { MaterialDef } from '../materials';
import type { PropDef } from '../props';
import type { CompileStep } from '../registry';
import { streetBarriersStep } from './barriers';
import { CHALK_PROPS } from './chalk';
import { streetCrowdStep } from './crowd';
import { streetFurnitureStep } from './furniture';
import { streetGroundStep } from './ground';
import { KIT_PROPS } from './kit-props';
import { streetLightsStep } from './lights';
import { streetMarkingsStep } from './markings';
import { STREET_MATERIALS as MATERIALS } from './materials';
import { precinctStep } from './precinct';
import { VEHICLE_MATERIALS, VEHICLE_PROPS } from './vehicles';
import { streetWearStep } from './wear';

export { streetGroundStep };

export const STREET_MATERIALS: MaterialDef[] = [...MATERIALS, ...VEHICLE_MATERIALS];
export const STREET_PROPS: PropDef[] = [...KIT_PROPS, ...CHALK_PROPS, ...VEHICLE_PROPS];
/** Run after the ground and buildings steps (registry.ts), in this order. */
export const STREET_STEPS: CompileStep[] = [streetMarkingsStep, streetWearStep, streetFurnitureStep, streetBarriersStep, streetLightsStep, precinctStep, streetCrowdStep];
