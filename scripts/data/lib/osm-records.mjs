/**
 * OpenStreetMap record code shared by scripts/data/fetch-osm.mjs (every layer's data) and the building merge
 * (scripts/data/footprints-merge.ts), so both see the same building rings, road widths and tags: projection, ring
 * cleaning (Douglas-Peucker, orientation), multipolygon assembly and the building record of the schema in
 * src/world/osm/data.ts.
 *
 * Data © OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright).
 */

/** The local projection of src/core/geo-coords.ts (latLonToLocal) around `origin` ({ lat, lon }): (lat, lon) -> [x, z] m. */
export function projector(origin) {
  const DEG = Math.PI / 180;
  const M_LAT = 111_132.954 - 559.822 * Math.cos(2 * origin.lat * DEG) + 1.175 * Math.cos(4 * origin.lat * DEG);
  const M_LON = DEG * 6_378_137 * Math.cos(origin.lat * DEG);
  return (lat, lon) => [(lon - origin.lon) * M_LON, -(lat - origin.lat) * M_LAT];
}

/** Default carriageway / path widths (m) per highway class when `width` is not tagged. */
export const HIGHWAY_WIDTH = {
  motorway: 16,
  trunk: 14,
  primary: 12,
  secondary: 10,
  tertiary: 8,
  unclassified: 6,
  residential: 5.5,
  living_street: 4.5,
  pedestrian: 6,
  motorway_link: 7,
  trunk_link: 7,
  primary_link: 7,
  secondary_link: 7,
  tertiary_link: 6,
  service: 4,
  busway: 7,
  road: 6,
  track: 3,
  footway: 2,
  path: 1.5,
  steps: 2.5,
  cycleway: 2,
  bridleway: 2,
};
export const FOOT_HIGHWAYS = new Set(['footway', 'path', 'steps', 'cycleway', 'bridleway']);
export const SKIP_HIGHWAYS = new Set(['proposed', 'construction', 'abandoned', 'razed', 'disused', 'corridor', 'elevator', 'platform', 'bus_stop', 'raceway', 'escape', 'services', 'rest_area']);
export const RAIL_KINDS = new Set(['tram', 'light_rail', 'funicular', 'subway', 'rail', 'narrow_gauge', 'monorail']);

export function num(v) {
  if (v == null) {
    return undefined;
  }
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}

/** Metres from values like "12", "12 m", "12.5m", "40'" (feet). */
export function metres(v) {
  if (v == null) {
    return undefined;
  }
  const s = String(v).trim();
  const n = num(s);
  if (n === undefined) {
    return undefined;
  }
  return /'|ft/.test(s) ? n * 0.3048 : n;
}

export function perpDist(p, a, b) {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz;
  if (l2 < 1e-9) {
    return Math.hypot(p[0] - a[0], p[1] - a[1]);
  }
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
}

/** Douglas-Peucker keep flags on an open polyline of [x, z] points; `lock[i]` vertices are always kept. */
export function simplifyKeep(pts, tol, lock) {
  const keep = new Uint8Array(pts.length);
  if (pts.length < 3) {
    return keep.fill(1);
  }
  keep[0] = keep[pts.length - 1] = 1;
  const anchors = [0];
  for (let i = 1; i < pts.length - 1; i++) {
    if (lock?.[i]) {
      keep[i] = 1;
      anchors.push(i);
    }
  }
  anchors.push(pts.length - 1);
  const stack = [];
  for (let a = 1; a < anchors.length; a++) {
    stack.push([anchors[a - 1], anchors[a]]);
  }
  while (stack.length) {
    const [i0, i1] = stack.pop();
    let best = -1;
    let bestD = tol;
    for (let i = i0 + 1; i < i1; i++) {
      const d = perpDist(pts[i], pts[i0], pts[i1]);
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([i0, best], [best, i1]);
    }
  }
  return keep;
}

export function simplify(pts, tol) {
  const keep = simplifyKeep(pts, tol, null);
  return pts.filter((_, i) => keep[i]);
}

export function signedArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export function pointInRing(ring, x, z) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function centroid(ring) {
  let x = 0;
  let z = 0;
  for (const p of ring) {
    x += p[0];
    z += p[1];
  }
  return [x / ring.length, z / ring.length];
}

/** Closed point list -> simplified ring without the duplicate, positive area when `outer`, negative for holes. */
export function cleanRing(pts, outer, tol, minArea) {
  if (pts.length < 4) {
    return null;
  }
  let ring = simplify(pts, tol);
  if (ring.length > 1 && Math.hypot(ring[0][0] - ring.at(-1)[0], ring[0][1] - ring.at(-1)[1]) < 0.05) {
    ring = ring.slice(0, -1);
  }
  if (ring.length < 3) {
    return null;
  }
  const area = signedArea(ring);
  if (Math.abs(area) < minArea) {
    return null;
  }
  return area < 0 === outer ? ring.reverse() : ring;
}

export const isClosed = (geom) => geom.length > 3 && geom[0].lat === geom.at(-1).lat && geom[0].lon === geom.at(-1).lon;
/** [x, z] points of an Overpass geometry list through `project`. */
export const projectAll = (geom, project) => geom.map((g) => project(g.lat, g.lon));

/** Joins member ways of a multipolygon into closed rings, separately for outer and inner roles. */
export function joinRings(members, project) {
  const join = (segs) => {
    const rings = [];
    const same = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.01;
    while (segs.length) {
      let ring = segs.shift();
      let grown = true;
      while (!same(ring[0], ring.at(-1)) && grown) {
        grown = false;
        for (let i = 0; i < segs.length; i++) {
          const s = segs[i];
          if (same(ring.at(-1), s[0])) {
            ring = ring.concat(s.slice(1));
          } else if (same(ring.at(-1), s.at(-1))) {
            ring = ring.concat(s.slice(0, -1).reverse());
          } else {
            continue;
          }
          segs.splice(i, 1);
          grown = true;
          break;
        }
      }
      if (same(ring[0], ring.at(-1))) {
        rings.push(ring);
      }
    }
    return rings;
  };
  const ways = (members ?? []).filter((m) => m.type === 'way' && m.geometry?.length > 1 && m.geometry.every((g) => g));
  return {
    outer: join(ways.filter((m) => m.role !== 'inner').map((m) => projectAll(m.geometry, project))),
    inner: join(ways.filter((m) => m.role === 'inner').map((m) => projectAll(m.geometry, project))),
  };
}

/** Polygons ({ outer, holes }) of a closed way or a multipolygon relation, simplified and oriented. */
export function polygonsOf(el, tol, minArea, project) {
  if (el.type === 'way') {
    if (!el.geometry || !isClosed(el.geometry)) {
      return [];
    }
    const outer = cleanRing(projectAll(el.geometry, project), true, tol, minArea);
    return outer ? [{ outer, holes: [] }] : [];
  }
  if (el.type !== 'relation' || el.tags?.type !== 'multipolygon') {
    return [];
  }
  const { outer, inner } = joinRings(el.members, project);
  const polys = outer
    .map((r) => cleanRing(r, true, tol, minArea))
    .filter(Boolean)
    .map((o) => ({ outer: o, holes: [] }));
  for (const raw of inner) {
    const hole = cleanRing(raw, false, tol, 1);
    if (!hole) {
      continue;
    }
    const [hx, hz] = centroid(hole);
    polys.find((p) => pointInRing(p.outer, hx, hz))?.holes.push(hole);
  }
  return polys;
}

export const round = (v) => Math.round(v * 10) / 10;
export const flat = (pts) => pts.flatMap((p) => [round(p[0]), round(p[1])]);
/** Way ids positive, relation ids negative. */
export const osmId = (el) => (el.type === 'relation' ? -el.id : el.id);

/** Copies the listed tags onto `rec` under new names when present (trimmed; lower-cased when `lower`). */
export function copyTags(rec, t, map, lower = false) {
  for (const [key, name] of Object.entries(map)) {
    const v = t[key];
    if (v != null && v !== '') {
      rec[name] = lower ? String(v).trim().toLowerCase() : String(v).trim();
    }
  }
}

export function buildingRecord(el, poly, part) {
  const t = el.tags ?? {};
  const rec = { id: osmId(el), ring: flat(poly.outer), kind: (part ? t['building:part'] : t.building) || 'yes' };
  if (poly.holes.length) {
    rec.holes = poly.holes.map(flat);
  }
  if (part) {
    rec.part = true;
  }
  const height = metres(t.height);
  const minHeight = metres(t.min_height);
  const levels = num(t['building:levels']);
  const minLevel = num(t['building:min_level']);
  const roofLevels = num(t['roof:levels']);
  const roofHeight = metres(t['roof:height']);
  if (height && height > 1 && height < 300) {
    rec.height = round(height);
  }
  if (minHeight && minHeight > 0 && minHeight < 300) {
    rec.minHeight = round(minHeight);
  }
  if (levels && levels > 0 && levels < 80) {
    rec.levels = Math.round(levels);
  }
  if (minLevel && minLevel > 0 && minLevel < 80) {
    rec.minLevel = Math.round(minLevel);
  }
  if (roofLevels !== undefined && roofLevels >= 0 && roofLevels < 10) {
    rec.roofLevels = Math.round(roofLevels);
  }
  if (roofHeight && roofHeight > 0 && roofHeight < 60) {
    rec.roofHeight = round(roofHeight);
  }
  const direction = num(t['roof:direction']);
  if (direction !== undefined) {
    rec.roofDirection = direction;
  }
  copyTags(rec, t, { 'roof:shape': 'roofShape', 'roof:colour': 'roofColour', 'roof:material': 'roofMaterial', 'roof:orientation': 'roofOrientation', 'building:colour': 'colour', 'building:material': 'material' }, true);
  copyTags(rec, t, { amenity: 'amenity', historic: 'historic', shop: 'shop', tourism: 'tourism', religion: 'religion', 'building:architecture': 'architecture', 'building:use': 'use', start_date: 'startDate' }, true);
  copyTags(rec, t, { name: 'name' });
  return rec;
}


/**
 * Carriageway / path width (m) of a highway way's tags: the width tag when plausible, else estimated from the class and
 * the lane count. `tagged` tells which.
 */
export function highwayWidth(t) {
  const lanes = num(t.lanes);
  const tagged = metres(t.width) ?? metres(t['width:carriageway']);
  const base = HIGHWAY_WIDTH[t.highway] ?? 6;
  const hasTag = tagged !== undefined && tagged > 0.8 && tagged < 40;
  const width = hasTag ? tagged : lanes && !FOOT_HIGHWAYS.has(t.highway) ? Math.max(base * 0.7, Math.min(base * 1.4, lanes * 3.3 + 1.5)) : base;
  return { width, tagged: hasTag, lanes };
}
