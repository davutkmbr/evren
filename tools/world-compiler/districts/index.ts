/**
 * District profiles by area id (src/world/osm/area.ts OSM_AREAS). Add a district: write `<area>.ts` exporting a
 * DistrictProfile (start from generic.ts) and list it here. Areas without an entry use GENERIC.
 */
import type { DistrictProfile } from '../src/district';
import { EMINONU } from './eminonu';
import { GENERIC } from './generic';
import { KADIKOY } from './kadikoy';

export { GENERIC };

export const DISTRICTS: Readonly<Record<string, DistrictProfile>> = {
  kadikoy: KADIKOY,
  eminonu: EMINONU,
};
