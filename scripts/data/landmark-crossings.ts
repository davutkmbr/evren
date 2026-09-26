/**
 * Ways that pass through line landmarks (the aqueduct's arches, the Hippodrome's spina): for every landmark with a
 * 'line' footprint, the OSM roads and rails of the flight-scale regions (and the Galata slice) that cross its anchor
 * polyline, as stations along the line. The heritage builders keep piers off these spans so every road that OSM runs
 * under a monument passes through an opening (src/world/landmarks/heritage/data/crossings.json).
 *
 *   npx tsx scripts/data/landmark-crossings.ts
 *
 * Record per crossing: [station s (m from the first anchor), half span along the line (m), way width (m), kind].
 * The half span is the way's half width plus a clearance, divided by the sine of the crossing angle.
 * Data © OpenStreetMap contributors, ODbL 1.0.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { latLonToLocal } from '../../src/core/geo-coords';
import { LANDMARKS } from '../../src/world/geo/data/landmarks';

const ROOT = resolve(import.meta.dirname, '../..');
const OUT = resolve(ROOT, 'src/world/landmarks/heritage/data/crossings.json');
/** Clearance (m) between a way's edge and a pier. */
const CLEARANCE = 1.2;
/** Crossings closer than this angle to the line (degrees) are ignored (ways running along it). */
const MIN_ANGLE = 20;

interface Way {
  id: number;
  pts: number[];
  kind: string;
  width?: number;
  gauge?: number;
  bridge?: true;
  tunnel?: true;
  layer?: number;
}

interface RegionData {
  roads: Way[];
  rails: Way[];
}

const manifest = JSON.parse(readFileSync(resolve(ROOT, 'src/world/osm/regions.json'), 'utf8')) as { regions: { file: string; area: { minX: number; maxX: number; minZ: number; maxZ: number } }[] };
const files = [...manifest.regions.map((r) => ({ file: resolve(ROOT, 'public', r.file), area: r.area })), { file: resolve(ROOT, 'public/data/osm/slice.json'), area: null }];

function cross(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): number | null {
  const rx = bx - ax;
  const rz = bz - az;
  const sx = dx - cx;
  const sz = dz - cz;
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-9) {
    return null;
  }
  const t = ((cx - ax) * sz - (cz - az) * sx) / den;
  const u = ((cx - ax) * rz - (cz - az) * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
}

const out: Record<string, [number, number, number, string][]> = {};
for (const l of LANDMARKS) {
  if (l.footprint !== 'line' || !l.anchors || l.kind === 'walls') {
    continue;
  }
  const line: [number, number][] = [];
  for (let i = 0; i + 1 < l.anchors.length; i += 2) {
    const p = latLonToLocal(l.anchors[i], l.anchors[i + 1]);
    line.push([p.x, p.z]);
  }
  const minX = Math.min(...line.map((p) => p[0])) - 50;
  const maxX = Math.max(...line.map((p) => p[0])) + 50;
  const minZ = Math.min(...line.map((p) => p[1])) - 50;
  const maxZ = Math.max(...line.map((p) => p[1])) + 50;
  const found = new Map<number, [number, number, number, string]>();
  for (const f of files) {
    if (f.area && (f.area.maxX < minX || f.area.minX > maxX || f.area.maxZ < minZ || f.area.minZ > maxZ)) {
      continue;
    }
    if (!existsSync(f.file)) {
      continue;
    }
    const data = JSON.parse(readFileSync(f.file, 'utf8')) as RegionData;
    const ways = [...data.roads.map((w) => ({ w, width: w.width ?? 4 })), ...data.rails.map((w) => ({ w, width: (w.gauge ?? 1.435) + 1.6 }))];
    for (const { w, width } of ways) {
      // Real tunnels run under the ground, bridges over the landmark; passages (tunnel at layer >= 0) go through it.
      if (w.bridge || (w.layer ?? 0) < 0) {
        continue;
      }
      let s0 = 0;
      for (let i = 0; i + 1 < line.length; i++) {
        const [ax, az] = line[i];
        const [bx, bz] = line[i + 1];
        const len = Math.hypot(bx - ax, bz - az);
        for (let k = 0; k + 3 < w.pts.length; k += 2) {
          const t = cross(ax, az, bx, bz, w.pts[k], w.pts[k + 1], w.pts[k + 2], w.pts[k + 3]);
          if (t === null) {
            continue;
          }
          const wx = w.pts[k + 2] - w.pts[k];
          const wz = w.pts[k + 3] - w.pts[k + 1];
          const sin = Math.abs(((bx - ax) * wz - (bz - az) * wx) / (len * Math.hypot(wx, wz)));
          if (sin < Math.sin((MIN_ANGLE * Math.PI) / 180)) {
            continue;
          }
          const s = s0 + t * len;
          found.set(w.id * 1000 + Math.round(s), [Math.round(s * 10) / 10, Math.round(((width / 2 + CLEARANCE) / sin) * 10) / 10, width, w.kind]);
        }
        s0 += len;
      }
    }
  }
  out[l.id] = [...found.values()].sort((a, b) => a[0] - b[0]);
  console.log(`${l.id}: ${out[l.id].length} crossings`, out[l.id].map((c) => `${c[3]}@${c[0]}±${c[1]}`).join(' '));
}
writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
console.log(`wrote ${OUT}`);
