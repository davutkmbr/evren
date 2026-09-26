/**
 * Ways through a landmark's body (rule: landmarks stand over the ground, OSM keeps the ground).
 *
 * OSM maps the roads and paths that pass under a monument's arches as tunnel=building_passage (the Valens aqueduct:
 * Atatürk Bulvarı, Saraçhane Kavşağı, İtfaiye Caddesi and the footways through its arches), and the data keeps them
 * as `tunnel`, which the street, traffic and walk layers skip as underground. Under a modelled line landmark the
 * landmark model is the "building": such a piece is a ground way, drawn with its kerbs, lanes and cars. Real tunnels
 * (layer < 0) and pieces reaching beyond the landmark's body stay tunnels.
 */
import { onLineBody, type LandmarkClaims } from '../../landmarks/claim-shapes';
import type { OsmData } from '../data';

/** Slack (m) beyond the landmark body within which a passage's end points may lie. */
const END_SLACK = 1.5;

/** Clears `tunnel` on passage pieces under line landmark bodies; returns how many ways were opened. */
export function openLandmarkPassages(data: OsmData, claims: LandmarkClaims): number {
  if (!claims.lines.length) {
    return 0;
  }
  let opened = 0;
  for (const r of [...data.roads, ...data.rails]) {
    if (!r.tunnel || (r.layer ?? 0) < 0) {
      continue;
    }
    let all = true;
    for (let i = 0; i + 1 < r.pts.length && all; i += 2) {
      all = onLineBody(claims.lines, r.pts[i], r.pts[i + 1], END_SLACK);
    }
    if (all) {
      delete r.tunnel;
      opened++;
    }
  }
  return opened;
}
