#!/usr/bin/env node
/**
 * Fits the deck frame of every structure bridge that crosses the OSM slice to the OSM data, so the drawn deck lines up
 * with the streets it joins: the bridge carriageways (bridge=yes ways named like the landmark, or the bridge tracks of a
 * rail-only bridge) give the deck ends (the ways' extreme stations along their principal axis), and the centre line runs
 * through the midpoints between the outermost carriageways at both ends, so kerbs and lanes meet the streets at both
 * joints. Main piers keep their stations on the new axis. Prints the anchors (lat, lon) to paste into
 * src/world/geo/data/landmarks.ts and the lateral / angular error of the current ones.
 *
 *   node scripts/data/fit-bridge-anchors.mjs [public/data/osm/slice.json]
 */
import { readFileSync } from 'node:fs';

const D = Math.PI / 180;
const O = { lat: 41.045, lon: 29.02 };
const MLAT = 111132.954 - 559.822 * Math.cos(2 * O.lat * D) + 1.175 * Math.cos(4 * O.lat * D);
const MLON = D * 6378137 * Math.cos(O.lat * D);
const toLocal = (lat, lon) => [(lon - O.lon) * MLON, -(lat - O.lat) * MLAT];
const toLatLon = (x, z) => [O.lat - z / MLAT, O.lon + x / MLON];

const src = readFileSync(new URL('../../src/world/geo/data/landmarks.ts', import.meta.url), 'utf8');
const data = JSON.parse(readFileSync(process.argv[2] ?? 'public/data/osm/slice.json', 'utf8'));

const re = /id: '([^']+)', name: '([^']+)', kind: 'bridge'[\s\S]*?anchors: \[([^\]]+)\]/g;
for (const m of src.matchAll(re)) {
  const [, id, name] = m;
  const v = m[3].split(',').map(Number);
  const a = [0, 1, 2, 3].map((i) => toLocal(v[i * 2], v[i * 2 + 1]));
  // Carriageways named like the bridge; a rail-only bridge (metro) uses the bridge tracks along its current axis.
  const near = (w) => {
    const ux = a[3][0] - a[2][0], uz = a[3][1] - a[2][1], l = Math.hypot(ux, uz);
    for (let k = 0; k < w.pts.length; k += 2) {
      if (Math.abs(-(w.pts[k] - a[2][0]) * (uz / l) + (w.pts[k + 1] - a[2][1]) * (ux / l)) > 30) return false;
    }
    return true;
  };
  let railOnly = false;
  let ways = data.roads.filter((r) => r.bridge && r.name === name && r.width >= 5);
  if (!ways.length) {
    ways = data.rails.filter((r) => r.bridge && !r.service && r.pts.length >= 4 && near(r));
    railOnly = true;
  }
  if (!ways.length) {
    continue;
  }
  const pts = ways.flatMap((w) => Array.from({ length: w.pts.length / 2 }, (_, k) => [w.pts[k * 2], w.pts[k * 2 + 1]]));
  // Principal axis of the carriageway vertices.
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cz = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  let sxx = 0, sxz = 0, szz = 0;
  for (const [x, z] of pts) {
    sxx += (x - cx) ** 2;
    sxz += (x - cx) * (z - cz);
    szz += (z - cz) ** 2;
  }
  const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  let ax = Math.cos(ang), az = Math.sin(ang);
  if ((a[1][0] - a[0][0]) * ax + (a[1][1] - a[0][1]) * az < 0) {
    ax = -ax;
    az = -az;
  }
  let S = (p) => (p[0] - cx) * ax + (p[1] - cz) * az;
  let Lat = (p) => -(p[0] - cx) * az + (p[1] - cz) * ax;
  // Lateral of a way at station s (linear along its polyline, clamped to its ends).
  const latAt = (w, s) => {
    let best = null;
    for (let k = 2; k < w.pts.length; k += 2) {
      const a = [w.pts[k - 2], w.pts[k - 1]];
      const b = [w.pts[k], w.pts[k + 1]];
      const sa = S(a), sb = S(b);
      const t = sa === sb ? 0 : Math.min(1, Math.max(0, (s - sa) / (sb - sa)));
      const d = Math.abs(sa + (sb - sa) * t - s);
      const l = Lat(a) + (Lat(b) - Lat(a)) * t;
      if (!best || d < best.d) best = { d, l };
    }
    return best.l;
  };
  // Centre line through the midpoints between the outermost carriageways at both deck ends: the OSM ways of a bridge
  // are rarely exactly parallel, and a least-squares centre left the kerbs and tracks up to 2 m off at the joints.
  let ss = pts.map(S);
  let s0 = Math.min(...ss), s1 = Math.max(...ss);
  const midAt = (s) => {
    const l = ways.map((w) => latAt(w, s));
    return (Math.min(...l) + Math.max(...l)) / 2;
  };
  const m0 = midAt(s0), m1 = midAt(s1);
  const p0 = [cx + ax * s0 - az * m0, cz + az * s0 + ax * m0];
  const p1 = [cx + ax * s1 - az * m1, cz + az * s1 + ax * m1];
  const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
  const ox0 = (p0[0] + p1[0]) / 2, oz0 = (p0[1] + p1[1]) / 2;
  const cx0 = cx, cz0 = cz;
  void cx0;
  void cz0;
  ax = (p1[0] - p0[0]) / len;
  az = (p1[1] - p0[1]) / len;
  S = (p) => (p[0] - ox0) * ax + (p[1] - oz0) * az;
  Lat = (p) => -(p[0] - ox0) * az + (p[1] - oz0) * ax;
  ss = pts.map(S);
  s0 = Math.min(...ss);
  s1 = Math.max(...ss);
  const mid = 0;
  const at = (s) => [ox0 + ax * s - az * mid, oz0 + az * s + ax * mid];
  const piers = [S(a[0]), S(a[1])];
  // Rail bridges run on as viaducts past the landmark's deck: keep their deck ends, fit only the axis.
  const ends = railOnly ? [S(a[2]), S(a[3])] : S(a[2]) < S(a[3]) ? [s0, s1] : [s1, s0];
  const out = [at(piers[0]), at(piers[1]), at(ends[0]), at(ends[1])].map(([x, z]) => toLatLon(x, z).map((q) => q.toFixed(6)).join(', '));
  const oldAng = Math.atan2(a[3][1] - a[2][1], a[3][0] - a[2][0]);
  const dAng = (Math.abs(((oldAng - ang + Math.PI * 2.5) % Math.PI) - Math.PI / 2) / D).toFixed(2);
  console.log(`${id}: lateral offset of the current deck centre ${(Lat(a[2]) - mid).toFixed(1)} / ${(Lat(a[3]) - mid).toFixed(1)} m, axis ${dAng} deg, ends ${(S(a[2]) - ends[0]).toFixed(1)} / ${(S(a[3]) - ends[1]).toFixed(1)} m`);
  console.log(`    anchors: [${out.join(', ')}],`);
}
