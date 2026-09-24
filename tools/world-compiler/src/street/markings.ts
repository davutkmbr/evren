/**
 * Street markings and ironwork of the street tiles (format 1), draped on the street ground (common.ts groundY) a few
 * millimetres up, as alpha-tested (MASK) decal geometry, so they neither sort nor z-fight:
 * - zebra crossings at the marked crossings (common.ts), bars of RoadLines004 parallel to the traffic;
 * - lane and edge lines on the main roads (RoadLines010 dashed / solid columns), kept out of junctions and zebras;
 * - manhole covers (ManholeCover003, foundry mark removed: conditions.json) on carriageways and pedestrian lanes;
 * - gully grates in the gutters of kerbed streets;
 * - yellow tactile strips on every dropped kerb;
 * - grooved rails of the T3 tram embedded in the street.
 * A marking belongs to the tile that holds its centre (strips: each quad by its midpoint).
 */
import { BoxGrid, segDist } from '../../../../src/world/osm/shared/geometry';
import { streetTramTracks, type Street } from '../../../../src/world/osm/shared/street-field';
import { LOD0, LOD1, type Vec2, type Vec3 } from '../mesh';
import type { MaterialName } from '../materials';
import type { CompileStep, TileContext } from '../registry';
import { GUTTER_WIDTH, hash, inTile, KERB_WIDTH, streetContext, streetTile, type StreetContext } from './common';

/** Lift (m) of paint and ironwork above the ground. */
const PAINT_LIFT = 0.008;
const IRON_LIFT = 0.012;
/** RoadLines004: the paint covers u 0.277-0.736 of the texture. */
const LINE004_U: [number, number] = [0.277, 0.736];
/** RoadLines010 columns (u) of the dashed and solid lines; one texture repeat along v spans LINE010_REPEAT metres. */
const LINE010_DASHED = 0.25;
const LINE010_SOLID = 0.974;
const LINE010_REPEAT = 36;

interface Strip {
  pos: number[];
  uv: number[];
  idx: number[];
}

const newStrip = (): Strip => ({ pos: [], uv: [], idx: [] });

/** Adds a quad (corners counter-clockwise from above) with UVs to a strip. */
function quad(s: Strip, p: Vec3[], uv: Vec2[]): void {
  const base = s.pos.length / 3;
  for (let k = 0; k < 4; k++) {
    s.pos.push(p[k][0], p[k][1], p[k][2]);
    s.uv.push(uv[k][0], uv[k][1]);
  }
  // Wind so the normal points up.
  const ux = p[1][0] - p[0][0];
  const uz = p[1][2] - p[0][2];
  const vx = p[2][0] - p[0][0];
  const vz = p[2][2] - p[0][2];
  if (uz * vx - ux * vz > 0) {
    s.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  } else {
    s.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
}

function flush(t: TileContext, m: MaterialName, s: Strip, lod: number): void {
  if (!s.idx.length) {
    return;
  }
  const n = s.pos.length / 3;
  const normals = new Array<number>(n * 3).fill(0);
  for (let i = 0; i < n; i++) {
    normals[i * 3 + 1] = 1;
  }
  t.mesh.addMesh(m, { positions: s.pos, indices: s.idx, uv: s.uv, normals, lod });
}

/**
 * Rectangle on the ground from centre line a -> b with half width hw, subdivided every `step` metres along it; UVs:
 * u across (u0 left .. u1 right), v along (v0 at a .. v1 at b). Quads outside the tile are skipped.
 */
function drapedRect(t: TileContext, s: Strip, y: (x: number, z: number) => number, ax: number, az: number, bx: number, bz: number, hw: number, u: [number, number], v: [number, number], lift: number, step = 1): void {
  const len = Math.hypot(bx - ax, bz - az);
  if (len < 1e-3) {
    return;
  }
  const tx = (bx - ax) / len;
  const tz = (bz - az) / len;
  const rx = -tz;
  const rz = tx;
  const m = Math.max(1, Math.ceil(len / step));
  for (let i = 0; i < m; i++) {
    const f0 = i / m;
    const f1 = (i + 1) / m;
    const cx = ax + (bx - ax) * (f0 + f1) * 0.5;
    const cz = az + (bz - az) * (f0 + f1) * 0.5;
    if (!inTile(t, cx, cz)) {
      continue;
    }
    const p = (f: number, side: number): Vec3 => {
      const x = ax + (bx - ax) * f + rx * hw * side;
      const z = az + (bz - az) * f + rz * hw * side;
      return [x, y(x, z) + lift, z];
    };
    const vv = (f: number): number => v[0] + (v[1] - v[0]) * f;
    quad(s, [p(f0, -1), p(f0, 1), p(f1, 1), p(f1, -1)], [
      [u[0], vv(f0)],
      [u[1], vv(f0)],
      [u[1], vv(f1)],
      [u[0], vv(f1)],
    ]);
  }
}

interface Junctions {
  outside(x: number, z: number): boolean;
}

/** Junction discs (a ref shared by 2+ carriageways): no lane paint inside them (as the flight slice's decals.ts). */
function junctions(streets: readonly Street[], roads: readonly { refs?: number[] }[]): Junctions {
  const refHw = new Map<number, number>();
  const refCount = new Map<number, number>();
  for (const s of streets) {
    const refs = roads[s.road].refs;
    if (!refs) {
      continue;
    }
    for (let k = 0; k < refs.length; k += 2) {
      refCount.set(refs[k + 1], (refCount.get(refs[k + 1]) ?? 0) + 1);
      refHw.set(refs[k + 1], Math.max(refHw.get(refs[k + 1]) ?? 0, s.hw));
    }
  }
  const grid = new BoxGrid(20);
  const pts: number[] = [];
  for (const s of streets) {
    const refs = roads[s.road].refs;
    if (!refs) {
      continue;
    }
    for (let k = 0; k < refs.length; k += 2) {
      if ((refCount.get(refs[k + 1]) ?? 0) < 2) {
        continue;
      }
      const x = s.pts[refs[k] * 2];
      const z = s.pts[refs[k] * 2 + 1];
      const r = (refHw.get(refs[k + 1]) ?? 3) + 2.5;
      const id = pts.push(x, z, r) / 3 - 1;
      grid.add(id, x - r, z - r, x + r, z + r);
    }
  }
  return {
    outside: (x, z) => {
      for (const id of grid.at(x, z)) {
        if ((pts[id * 3] - x) ** 2 + (pts[id * 3 + 1] - z) ** 2 < pts[id * 3 + 2] ** 2) {
          return false;
        }
      }
      return true;
    },
  };
}

const MAIN = /^(trunk|primary|secondary|tertiary)/;

export interface MarkingStats {
  zebras: number;
  lineM: number;
  manholes: number;
  gullies: number;
  tactile: number;
  railM: number;
}

export function buildMarkings(t: TileContext, sc: StreetContext): MarkingStats {
  const a = t.area;
  const s = a.foundation.surface;
  const y = sc.groundY;
  const stats: MarkingStats = { zebras: 0, lineM: 0, manholes: 0, gullies: 0, tactile: 0, railM: 0 };
  const paint = newStrip();
  const lines = newStrip();
  const manhole = newStrip();
  const iron = newStrip();
  const slots = newStrip();
  const tactile = newStrip();
  const rails = newStrip();
  const grooves = newStrip();
  const nearCrossing = (x: number, z: number, r: number): boolean => sc.crossings.some((c) => segDist(x, z, c.ax, c.az, c.bx, c.bz) < r + c.width / 2);

  /* Zebras: bars 0.5 m wide (along the crossing) and `width` long (along the traffic), 1 m apart, 0.4 m off the kerbs. */
  for (const c of sc.crossings) {
    const len = Math.hypot(c.bx - c.ax, c.bz - c.az);
    const cx = (c.bx - c.ax) / len;
    const cz = (c.bz - c.az) / len;
    const bars = Math.max(2, Math.floor((len - 0.8 + 0.5) / 1.0));
    const start = (len - (bars - 1) * 1.0) / 2;
    const quadW = 0.5 / (LINE004_U[1] - LINE004_U[0]);
    let own = false;
    for (let i = 0; i < bars; i++) {
      const f = start + i;
      const mx = c.ax + cx * f;
      const mz = c.az + cz * f;
      own ||= inTile(t, mx, mz);
      const vOff = hash(i * 3.1 + c.ax) * 0.6;
      drapedRect(t, paint, a.heights.carriage, mx - c.tx * c.width * 0.5, mz - c.tz * c.width * 0.5, mx + c.tx * c.width * 0.5, mz + c.tz * c.width * 0.5, quadW / 2, [0, 1], [vOff, vOff + c.width / 5], PAINT_LIFT, 2);
    }
    if (own) {
      stats.zebras++;
    }
  }

  /* Lane and edge lines on main roads. */
  const junc = junctions(sc.streets, a.data.roads);
  for (const st of sc.streets) {
    if (!MAIN.test(st.kind) || st.pedestrian || st.hw < 2.5) {
      continue;
    }
    const lanes = st.lanes || Math.max(st.oneway ? 1 : 2, Math.round((st.hw * 2) / 3.3));
    const offsets: { o: number; dashed: boolean }[] = [];
    if (st.kerbed) {
      offsets.push({ o: -(st.hw - GUTTER_WIDTH - 0.25), dashed: false }, { o: st.hw - GUTTER_WIDTH - 0.25, dashed: false });
    }
    if (st.oneway) {
      const lw = (st.hw * 2) / lanes;
      for (let l = 1; l < lanes; l++) {
        offsets.push({ o: -st.hw + l * lw, dashed: true });
      }
    } else {
      offsets.push({ o: 0, dashed: st.hw < 5.5 });
    }
    for (const { o, dashed } of offsets) {
      let along = 0;
      for (let k = 2; k < st.pts.length; k += 2) {
        const ax = st.pts[k - 2];
        const az = st.pts[k - 1];
        const bx = st.pts[k];
        const bz = st.pts[k + 1];
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 1e-3) {
          continue;
        }
        const tx = (bx - ax) / len;
        const tz = (bz - az) / len;
        const rx = -tz;
        const rz = tx;
        const m = Math.ceil(len / 1.5);
        for (let i = 0; i < m; i++) {
          const f0 = (i / m) * len;
          const f1 = ((i + 1) / m) * len;
          const x0 = ax + tx * f0 + rx * o;
          const z0 = az + tz * f0 + rz * o;
          const x1 = ax + tx * f1 + rx * o;
          const z1 = az + tz * f1 + rz * o;
          const mx = (x0 + x1) / 2;
          const mz = (z0 + z1) / 2;
          if (!inTile(t, mx, mz) || !junc.outside(mx, mz) || nearCrossing(mx, mz, 1.5) || s.distance(mx, mz) > -0.2) {
            continue;
          }
          const col = dashed ? LINE010_DASHED : LINE010_SOLID;
          drapedRect(t, lines, a.heights.carriage, x0, z0, x1, z1, 0.15, [col - 0.012, col + 0.012], [(along + f0) / LINE010_REPEAT, (along + f1) / LINE010_REPEAT], PAINT_LIFT, 2);
          stats.lineM += f1 - f0;
        }
        along += len;
      }
    }
  }

  /* Manholes and gully grates along streets (every 22-50 m / 18-32 m, hashed per street). */
  for (const st of sc.streets) {
    if (st.hw < 1.8) {
      continue;
    }
    let along = 0;
    let next = 6 + hash(st.road * 0.37) * 18;
    let nextGully = 4 + hash(st.road * 0.91) * 10;
    for (let k = 2; k < st.pts.length; k += 2) {
      const ax = st.pts[k - 2];
      const az = st.pts[k - 1];
      const len = Math.hypot(st.pts[k] - ax, st.pts[k + 1] - az);
      if (len < 1e-3) {
        continue;
      }
      const tx = (st.pts[k] - ax) / len;
      const tz = (st.pts[k + 1] - az) / len;
      while (next < along + len) {
        const f = next - along;
        const o = (hash(next * 1.37 + st.road) - 0.5) * st.hw * 0.9;
        const x = ax + tx * f - tz * o;
        const z = az + tz * f + tx * o;
        if (inTile(t, x, z) && s.distance(x, z) < -0.6 && junc.outside(x, z) && !nearCrossing(x, z, 1.2)) {
          const r = 0.4;
          const ang = hash(next * 7.7) * Math.PI * 2;
          const ca = Math.cos(ang) * r;
          const sa = Math.sin(ang) * r;
          const corner = (u: number, v: number): Vec3 => {
            const px = x + u * ca - v * sa;
            const pz = z + u * sa + v * ca;
            return [px, y(px, pz) + PAINT_LIFT + 0.002, pz];
          };
          quad(manhole, [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)], [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
          ]);
          stats.manholes++;
        }
        next += 22 + hash(next + st.road * 3.1) * 28;
      }
      while (st.kerbed && !st.pedestrian && nextGully < along + len) {
        const f = nextGully - along;
        const side = hash(nextGully * 0.7 + st.road) < 0.5 ? -1 : 1;
        // Find the kerb line along the normal (the raster width may differ from the tagged one).
        const nx = -tz * side;
        const nz = tx * side;
        let o = 0;
        for (let d = 0; d < st.hw + 4; d += 0.1) {
          if (s.distance(ax + tx * f + nx * d, az + tz * f + nz * d) >= 0) {
            o = d - GUTTER_WIDTH / 2;
            break;
          }
        }
        const x = ax + tx * f + nx * o;
        const z = az + tz * f + nz * o;
        if (o > 1 && inTile(t, x, z) && s.distance(x, z) < -0.05 && s.distance(x, z) > -GUTTER_WIDTH && !nearCrossing(x, z, 1) && junc.outside(x, z)) {
          const hl = 0.45;
          const hw = 0.16;
          drapedRect(t, iron, y, x - tx * hl, z - tz * hl, x + tx * hl, z + tz * hl, hw, [0, 0.32], [0, 0.9], IRON_LIFT - 0.004, 1);
          for (let b = 0; b < 6; b++) {
            const g = -hl + 0.1 + b * ((2 * hl - 0.2) / 5);
            drapedRect(t, slots, y, x + tx * g - nx * (hw - 0.04), z + tz * g - nz * (hw - 0.04), x + tx * g + nx * (hw - 0.04), z + tz * g + nz * (hw - 0.04), 0.03, [0, 0.06], [0, 0.24], IRON_LIFT, 1);
          }
          stats.gullies++;
        }
        nextGully += 18 + hash(nextGully + st.road) * 14;
      }
      along += len;
    }
  }

  /* Tactile strips on the dropped kerbs: 0.6 m deep, just behind the kerb stone. */
  for (const d of sc.dropped) {
    if (!inTile(t, d.x, d.z)) {
      continue;
    }
    const half = d.half - 0.25;
    const x0 = d.x + d.nx * (KERB_WIDTH + 0.45);
    const z0 = d.z + d.nz * (KERB_WIDTH + 0.45);
    drapedRect(t, tactile, y, x0 - d.tx * half, z0 - d.tz * half, x0 + d.tx * half, z0 + d.tz * half, 0.3, [0, 0.6 / 3.6], [0, (2 * half) / 3.6], 0.01, 0.25);
    stats.tactile++;
  }

  /* Embedded tram rails: steel heads with the flangeway groove on their inner side. */
  for (const tr of streetTramTracks(a.data)) {
    const g = tr.gauge / 2;
    for (let k = 2; k < tr.pts.length; k += 2) {
      const ax = tr.pts[k - 2];
      const az = tr.pts[k - 1];
      const bx = tr.pts[k];
      const bz = tr.pts[k + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 1e-3) {
        continue;
      }
      const rx = -(bz - az) / len;
      const rz = (bx - ax) / len;
      for (const side of [-1, 1]) {
        const oh = side * (g + 0.035);
        const og = side * (g - 0.02);
        drapedRect(t, rails, y, ax + rx * oh, az + rz * oh, bx + rx * oh, bz + rz * oh, 0.035, [0, 0.07], [0, len], 0.006, 1);
        drapedRect(t, grooves, y, ax + rx * og, az + rz * og, bx + rx * og, bz + rz * og, 0.02, [0, 0.04], [0, len], 0.005, 1);
      }
      if (inTile(t, (ax + bx) / 2, (az + bz) / 2)) {
        stats.railM += len;
      }
    }
  }

  flush(t, 'st_paint', paint, LOD0 | LOD1);
  flush(t, 'st_paint_lines', lines, LOD0 | LOD1);
  flush(t, 'st_manhole', manhole, LOD0);
  flush(t, 'st_iron', iron, LOD0);
  flush(t, 'st_groove', slots, LOD0);
  flush(t, 'st_tactile', tactile, LOD0);
  flush(t, 'st_rail', rails, LOD0 | LOD1);
  flush(t, 'st_groove', grooves, LOD0);
  return stats;
}

export const streetMarkingsStep: CompileStep = {
  id: 'streetMarkings',
  tile(t) {
    if (!streetTile(t)) {
      return;
    }
    const st = buildMarkings(t, streetContext(t.area));
    t.record('streetMarkings', { ...st, lineM: Math.round(st.lineM), railM: Math.round(st.railM) });
  },
};
