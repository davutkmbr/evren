/**
 * Soul lane of the world compiler (format 1): the small street-level details a local would miss on the S1 strip
 * (.docs/street/kadikoy-soul.md, section "S1 revision"), registered in ../registry.ts with one line per list:
 * materials (materials.ts), procedural props (animals.ts: placeholder cats, dogs, gulls and pigeons; objects.ts:
 * bowls, cat houses, spill-over, waste corner, carts, bikes, scooters, anglers' kit) and the soul step (step.ts),
 * which runs last on the full-detail tiles and writes the `animals`, `vendorSlots` and `ambience` records.
 */
import type { PropDef } from '../props';
import { ANIMAL_PROPS } from './animals';
import { OBJECT_PROPS } from './objects';

export { SOUL_MATERIALS } from './materials';
export { soulStep } from './step';

export const SOUL_PROPS: PropDef[] = [...ANIMAL_PROPS, ...OBJECT_PROPS];
