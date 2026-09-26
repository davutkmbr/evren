/**
 * District profiles by area id (src/world/osm/area.ts OSM_AREAS). Add a district: write `<area>.ts` exporting a
 * DistrictProfile (start from generic.ts) and list it here. Areas without an entry use GENERIC.
 *
 * Landing spots (landing-spots.json) name a base profile from PROFILES; district.ts `useDistrict` derives the spot's
 * profile from it (id, label, the spot's square as the full-detail strip, its place words in the shop names).
 */
import type { DistrictProfile } from '../src/district';
import { BOSPHORUS } from './bosphorus';
import { EMINONU } from './eminonu';
import { GENERIC } from './generic';
import { HISTORIC } from './historic';
import { KADIKOY } from './kadikoy';

export { GENERIC };

export const DISTRICTS: Readonly<Record<string, DistrictProfile>> = {
  kadikoy: KADIKOY,
  eminonu: EMINONU,
};

/** Base profiles a landing spot may name (`profile`). Kadıköy's hand-authored steps never leave its own area. */
export const PROFILES: Readonly<Record<string, DistrictProfile>> = {
  generic: GENERIC,
  historic: HISTORIC,
  bosphorus: BOSPHORUS,
  eminonu: EMINONU,
};
