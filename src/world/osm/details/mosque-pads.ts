import type { GeoQuery } from '../../../core/contracts';
import { isModelled } from '../../landmarks/claims';

/** Landmark mosques (grown by 10 m like the reserved pads) and neighbourhood mosque sites: x, z, radius triples. */
export function mosquePads(geo: GeoQuery): number[] {
  const out: number[] = [];
  for (const l of geo.landmarks) {
    if (l.kind === 'mosque' && isModelled(l)) {
      out.push(l.x, l.z, l.radius + 10);
    }
  }
  for (const m of geo.smallMosqueSites) {
    out.push(m.x, m.z, m.radius);
  }
  return out;
}
