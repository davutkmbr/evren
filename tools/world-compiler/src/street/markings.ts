/**
 * Street markings and ironwork of the street tiles (format 1), draped on the street ground (common.ts groundY) a few
 * millimetres up, as alpha-tested (MASK) decal geometry, so they neither sort nor z-fight:
 * - zebra crossings at the marked crossings (common.ts), bars of RoadLines004 parallel to the traffic;
 * - lane and edge lines on the main roads (RoadLines010 dashed / solid columns), kept out of junctions and zebras;
 * - manhole covers (ManholeCover003, foundry mark removed: conditions.json) on carriageways and pedestrian lanes;
 * - gully grates in the gutters of kerbed streets;
 * - yellow tactile pads on every dropped kerb, following the kerb line;
 * - grooved rails of the T3 tram embedded in the street;
 * - on the arrival square a white guide line of pavers (bus stop to the piers and the crossing) and manholes;
 * - wet films (BLEND, COLOR_0 alpha falling to 0 at the rim): puddles in the square, wet paving in front of fish
 *   stalls and round gully grates.
 * A marking belongs to the tile that holds its centre (strips: each quad by its midpoint). Every marking is clipped by
 * the placement rules (placement.ts): paint only on paintable carriageway, tactile only on pavement.
 */
import { BoxGrid, segDist } from '../../../../src/world/osm/shared/geometry';
import type { Street } from '../../../../src/world/osm/shared/street-field';
import { LOD0, LOD1, type Vec2, type Vec3 } from '../mesh';
import type { MaterialName } from '../materials';
import type { CompileStep, TileContext } from '../registry';
import { GUTTER_WIDTH, hash, inTile, KERB_WIDTH, streetContext, streetTile, type StreetContext } from './common';
import { placementRules } from './placement';
import { wearPlan } from './wear';

/** Lift (m) of paint and ironwork above the ground. */
const PAINT_LIFT = 0.008;
const IRON_LIFT = 0.012;
/** RoadLines004: the paint covers u 0.277-0.736 of the texture. */
const LINE004_U: [number, number] = [0.277, 0.736];
/** RoadLines010 columns (u) of the dashed and solid lines; one texture repeat along v spans LINE010_REPEAT metres. */
const LINE010_DASHED = 0.25;
const LINE010_SOLID = 0.974;
const LINE010_REPEAT = 36;
/** Half the standard gauge plus the rail head (m): a manhole keeps clear of the rails from here. */
const TRAM_GAUGE_HALF = 0.75;

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
function drapedRect(t: TileContext, s: Strip, y: (x: number, z: number) => number, ax: number, az: number, bx: number, bz: number, hw: number, u: [number, number], v: [number, number], lift: number, step = 1, keep?: (x: number, z: number) => boolean): { kept: number; dropped: number } {
  const out = { kept: 0, dropped: 0 };
  const len = Math.hypot(bx - ax, bz - az);
  if (len < 1e-3) {
    return out;
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
    if (keep) {
      const corners = [p(f0, -1), p(f0, 1), p(f1, 1), p(f1, -1)];
      if (!keep(cx, cz) || corners.some((q) => !keep(q[0], q[2]))) {
        out.dropped++;
        continue;
      }
      out.kept++;
    }
    const vv = (f: number): number => v[0] + (v[1] - v[0]) * f;
    quad(s, [p(f0, -1), p(f0, 1), p(f1, 1), p(f1, -1)], [
      [u[0], vv(f0)],
      [u[1], vv(f0)],
      [u[1], vv(f1)],
      [u[0], vv(f1)],
    ]);
  }
  return out;
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
  const rules = placementRules(a);
  const log = rules.log;
  const paint = newStrip();
  const lines = newStrip();
  const manhole = newStrip();
  const iron = newStrip();
  const slots = newStrip();
  const tactile = newStrip();
  const rails = newStrip();
  const grooves = newStrip();
  const gullies: [number, number][] = [];
  const nearCrossing = (x: number, z: number, r: number): boolean => sc.crossings.some((c) => segDist(x, z, c.ax, c.az, c.bx, c.bz) < r + c.width / 2);

  /* Zebras: bars 0.5 m wide (along the crossing) and `width` long (along the traffic), 1 m apart, 0.4 m off the kerbs.
     Rule paint.zebraBar: each bar is clipped (from its middle outwards) to where both of its long edges lie on
     paintable carriageway; a bar left shorter than 1 m is dropped. */
  for (const c of sc.crossings) {
    const len = Math.hypot(c.bx - c.ax, c.bz - c.az);
    const cx = (c.bx - c.ax) / len;
    const cz = (c.bz - c.az) / len;
    const bars = Math.max(2, Math.floor((len - 0.8 + 0.5) / 1.0));
    const start = (len - (bars - 1) * 1.0) / 2;
    const quadW = 0.5 / (LINE004_U[1] - LINE004_U[0]);
    const half = c.width / 2;
    let own = false;
    for (let i = 0; i < bars; i++) {
      const f = start + i;
      const mx = c.ax + cx * f;
      const mz = c.az + cz * f;
      const mine = inTile(t, mx, mz);
      const onRoad = (g: number): boolean => [-0.25, 0.25].every((o) => rules.paintable(mx + c.tx * g + cx * o, mz + c.tz * g + cz * o, 0.05, false));
      let lo = 0;
      let hi = 0;
      if (onRoad(0)) {
        while (hi + 0.1 <= half + 1e-6 && onRoad(hi + 0.1)) {
          hi += 0.1;
        }
        while (lo - 0.1 >= -half - 1e-6 && onRoad(lo - 0.1)) {
          lo -= 0.1;
        }
      }
      if (hi - lo < 1) {
        if (mine) {
          log.note('paint.zebraBar', 'dropped');
        }
        continue;
      }
      if (mine) {
        log.note('paint.zebraBar', hi - lo < c.width - 0.15 ? 'shortened' : 'kept');
      }
      own ||= mine;
      const vOff = hash(i * 3.1 + c.ax) * 0.6;
      drapedRect(t, paint, a.heights.carriage, mx + c.tx * lo, mz + c.tz * lo, mx + c.tx * hi, mz + c.tz * hi, quadW / 2, [0, 1], [vOff + (lo + half) / 5, vOff + (hi + half) / 5], PAINT_LIFT, 2);
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
    const offsets: { o: number; dashed: boolean; edge: number }[] = [];
    if (st.kerbed) {
      offsets.push({ o: -(st.hw - GUTTER_WIDTH - 0.25), dashed: false, edge: -1 }, { o: st.hw - GUTTER_WIDTH - 0.25, dashed: false, edge: 1 });
    }
    if (st.oneway) {
      const lw = (st.hw * 2) / lanes;
      for (let l = 1; l < lanes; l++) {
        offsets.push({ o: -st.hw + l * lw, dashed: true, edge: 0 });
      }
    } else {
      offsets.push({ o: 0, dashed: st.hw < 5.5, edge: 0 });
    }
    for (const { o: nominal, dashed, edge } of offsets) {
      const rule = edge ? 'paint.edgeLine' : 'paint.laneLine';
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
        // Rule paint.edgeLine: an edge line follows the real kerb (the raster's carriageway edge along the normal), a
        // gutter plus 0.3 m inside it (0.35 m inside a kerbless edge), not the tagged half width.
        const offsetAt = (f: number): number | null => {
          if (!edge) {
            return nominal;
          }
          const px = ax + tx * f;
          const pz = az + tz * f;
          const e = rules.edgeAlong(px, pz, rx * edge, rz * edge, st.hw + 4);
          if (e === null) {
            // No edge: the carriageway runs on into another one (a divided road's other half, a merge). The tagged
            // offset stays; the stripe checks below still keep it on this carriageway.
            return nominal;
          }
          // Kerbed as the ground builds the gutter: a raised kerb stone at a point in the gutter band.
          const ex = px + rx * edge * (e - 0.15);
          const ez = pz + rz * edge * (e - 0.15);
          return edge * (e - (rules.kerbStone(ex, ez) ? GUTTER_WIDTH + 0.3 : 0.35));
        };
        for (let i = 0; i < m; i++) {
          const f0 = (i / m) * len;
          const f1 = ((i + 1) / m) * len;
          const mx0 = ax + tx * (f0 + f1) * 0.5 + rx * nominal;
          const mz0 = az + tz * (f0 + f1) * 0.5 + rz * nominal;
          if (!inTile(t, mx0, mz0) || !junc.outside(mx0, mz0) || nearCrossing(mx0, mz0, 1.5)) {
            continue;
          }
          const o0 = offsetAt(f0);
          const o1 = offsetAt(f1);
          if (o0 === null || o1 === null || (edge && (o0 * edge < 0.5 || o1 * edge < 0.5)) || Math.abs(o0 - o1) > 0.6) {
            log.note(rule, 'dropped');
            continue;
          }
          const x0 = ax + tx * f0 + rx * o0;
          const z0 = az + tz * f0 + rz * o0;
          const x1 = ax + tx * f1 + rx * o1;
          const z1 = az + tz * f1 + rz * o1;
          const mx = (x0 + x1) / 2;
          const mz = (z0 + z1) / 2;
          // Rule paint.laneLine / paint.edgeLine: every corner of the 0.3 m stripe on paintable carriageway (off kerbs,
          // gutters, pedestrian paving, parking and tram tracks), on a carriageway that runs the stripe's way.
          const corners: [number, number][] = [
            [x0 - rx * 0.15, z0 - rz * 0.15],
            [x0 + rx * 0.15, z0 + rz * 0.15],
            [x1 - rx * 0.15, z1 - rz * 0.15],
            [x1 + rx * 0.15, z1 + rz * 0.15],
          ];
          if (!junc.outside(mx, mz) || nearCrossing(mx, mz, 1.5)) {
            continue;
          }
          if (corners.some(([qx, qz]) => !rules.paintable(qx, qz, 0.05, true)) || !rules.axisAgrees(mx, mz, Math.atan2(tz, tx))) {
            log.note(rule, 'dropped');
            continue;
          }
          log.note(rule, Math.abs(o0 - nominal) > 0.1 || Math.abs(o1 - nominal) > 0.1 ? 'moved' : 'kept');
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
        // Rule manhole: never on (or within 0.7 m of) a tram rail.
        const clearOfRails = sc.tramDist(x, z) >= TRAM_GAUGE_HALF + 0.7;
        if (inTile(t, x, z) && s.distance(x, z) < -0.6 && junc.outside(x, z) && !nearCrossing(x, z, 1.2)) {
          log.note('manhole', clearOfRails ? 'kept' : 'dropped');
        }
        if (clearOfRails && inTile(t, x, z) && s.distance(x, z) < -0.6 && junc.outside(x, z) && !nearCrossing(x, z, 1.2)) {
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
          gullies.push([x, z]);
        }
        nextGully += 18 + hash(nextGully + st.road) * 14;
      }
      along += len;
    }
  }

  /* Tactile (blister) pads on the dropped kerbs: 0.6 m deep, just behind the kerb stone. Rule tactile.pad: the pad
     follows the real kerb line (found along the crossing from every station, 0.25 m apart) instead of a straight
     strip at the crossing's end, and a station is kept only where the whole depth lies on pavement (behind the kerb
     stone, not in a building or a door's approach, 0.2 m off façades); the pad is shortened to its kept stations and
     dropped when fewer than three remain. */
  for (const d of sc.dropped) {
    if (!inTile(t, d.x, d.z)) {
      continue;
    }
    const half = d.half - 0.25;
    const n = Math.max(2, Math.round((2 * half) / 0.25) + 1);
    const inner = KERB_WIDTH + 0.05;
    const depth = 0.6;
    const stations: ({ ix: number; iz: number; ox: number; oz: number; s: number } | null)[] = [];
    for (let k = 0; k < n; k++) {
      const sAlong = -half + (2 * half * k) / (n - 1);
      // From 1.5 m out in the road, find the kerb line along the crossing's outward direction.
      const bx = d.x + d.tx * sAlong - d.nx * 1.5;
      const bz = d.z + d.tz * sAlong - d.nz * 1.5;
      const e = rules.edgeAlong(bx, bz, d.nx, d.nz, 4);
      if (e === null) {
        stations.push(null);
        continue;
      }
      const kx = bx + d.nx * e;
      const kz = bz + d.nz * e;
      const [gx, gz] = rules.outward(kx, kz);
      // Pad axis: the kerb normal, kept within 35° of the crossing so a corner radius does not swing it round.
      let nx = gx;
      let nz = gz;
      if (nx * d.nx + nz * d.nz < 0.82) {
        nx = d.nx;
        nz = d.nz;
      }
      const ix = kx + nx * inner;
      const iz = kz + nz * inner;
      const ox = kx + nx * (inner + depth);
      const oz = kz + nz * (inner + depth);
      const ok = [0, 0.5, 1].every((f) => {
        const px = ix + (ox - ix) * f;
        const pz = iz + (oz - iz) * f;
        return rules.surface(px, pz) === 'pavement' && s.distance(px, pz) >= KERB_WIDTH && s.buildingDistance(px, pz) >= 0.2 && !rules.doorBlocked(px, pz);
      });
      stations.push(ok ? { ix, iz, ox, oz, s: sAlong + half } : null);
    }
    const kept = stations.filter((q) => q).length;
    if (kept < 3) {
      log.note('tactile.pad', 'dropped');
      continue;
    }
    log.note('tactile.pad', kept < n ? 'shortened' : 'kept');
    for (let k = 1; k < n; k++) {
      const p = stations[k - 1];
      const q = stations[k];
      if (!p || !q) {
        continue;
      }
      const lift = 0.01;
      quad(tactile, [
        [p.ix, y(p.ix, p.iz) + lift, p.iz],
        [p.ox, y(p.ox, p.oz) + lift, p.oz],
        [q.ox, y(q.ox, q.oz) + lift, q.oz],
        [q.ix, y(q.ix, q.iz) + lift, q.iz],
      ], [
        [0, p.s / 3.6],
        [depth / 3.6, p.s / 3.6],
        [depth / 3.6, q.s / 3.6],
        [0, q.s / 3.6],
      ]);
    }
    stats.tactile++;
  }

  /* Embedded tram rails: steel heads with the flangeway groove on their inner side. */
  // The corrected tracks (common.ts: on the carriageway where OSM draws them on the pavement).
  for (const tr of sc.tram) {
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
        // Rule rail.track: rails lie at carriageway level: on the carriageway (the corrected tracks are moved there
        // when OSM draws them within 5 m of it) or in the flush track bed where they leave it (common.ts trackBed).
        // A segment whose rails still stand on raised ground is flagged.
        const raised = [-1, 1].some((side) => {
          const px = (ax + bx) / 2 + rx * side * (g + 0.035);
          const pz = (az + bz) / 2 + rz * side * (g + 0.035);
          return y(px, pz) - a.heights.carriage(px, pz) > 0.05;
        });
        log.note('rail.track', raised ? 'flagged' : 'kept');
      }
    }
  }

  /* The arrival square: a white guide line of pavers from the bus stop to the piers and the crossing, manholes. */
  const guide = newStrip();
  const sp = sc.spine;
  if (sc.square.length >= 6 && sp.length >= 6) {
    const P0: [number, number] = [sp[0], sp[1]];
    const legs: [number, number, number, number][] = [
      [P0[0], P0[1], 206, 5931],
      [P0[0], P0[1], sp[4], sp[5]],
      [P0[0] - 8, P0[1] - 1.5, 236, 5893],
    ];
    // Rule tactile.guide: guide pavers only on pavement or pedestrian paving (never on the road or the kerb).
    const walkable = (x: number, z: number): boolean => {
      const surf = rules.surface(x, z);
      return surf === 'pavement' || surf === 'pedestrianLane';
    };
    for (const [ax, az, bx, bz] of legs) {
      const len = Math.hypot(bx - ax, bz - az);
      const r = drapedRect(t, guide, y, ax, az, bx, bz, 0.15, [0, 0.5], [0, len / 0.6], PAINT_LIFT - 0.004, 0.6, walkable);
      log.note('tactile.guide', 'kept', r.kept);
      log.note('tactile.guide', 'dropped', r.dropped);
    }
    for (let k = 0; k < 9; k++) {
      const x = 185 + hash(k * 3.7) * 110;
      const z = 5885 + hash(k * 5.3 + 1) * 60;
      if (!inTile(t, x, z) || !sc.inSquare(x, z) || s.buildingDistance(x, z) < 1.5) {
        continue;
      }
      const r = 0.4;
      const ang = hash(k * 9.1) * Math.PI * 2;
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
  }

  /* Wet films: puddles in the square's hollows, wet paving in front of fish stalls and round gully grates. */
  const wet = { pos: [] as number[], idx: [] as number[], col: [] as [number, number, number, number][] };
  const puddle = (x: number, z: number, rx: number, rz: number, ang: number, alpha: number, seed: number): void => {
    const n = 18;
    const base = wet.pos.length / 3;
    wet.pos.push(x, y(x, z) + 0.006, z);
    wet.col.push([1, 1, 1, alpha]);
    for (let k = 0; k < n; k++) {
      const a2 = (k / n) * Math.PI * 2;
      const wob = 0.75 + 0.25 * hash(seed + k * 1.3) + 0.15 * Math.sin(a2 * 3 + seed);
      const lx = Math.cos(a2) * rx * wob;
      const lz = Math.sin(a2) * rz * wob;
      const px = x + lx * Math.cos(ang) - lz * Math.sin(ang);
      const pz = z + lx * Math.sin(ang) + lz * Math.cos(ang);
      wet.pos.push(px, y(px, pz) + 0.006, pz);
      wet.col.push([1, 1, 1, 0]);
    }
    for (let k = 0; k < n; k++) {
      wet.idx.push(base, base + 1 + ((k + 1) % n), base + 1 + k);
    }
  };
  // The square: water standing in the wear plan's hollows (the ground dips under the film).
  for (const h of wearPlan(a).hollows) {
    if (h.wet > 0 && inTile(t, h.x, h.z)) {
      puddle(h.x, h.z, h.rx, h.rz, h.ang, h.wet, h.x * 0.37 + h.z);
    }
  }
  for (const i of t.instances.list) {
    if (i.asset !== 'fac_stall_fish') {
      continue;
    }
    const yaw = 2 * Math.atan2(i.rotation[1], i.rotation[3]);
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const cx = i.position[0] + fx * 2.0;
    const cz = i.position[2] + fz * 2.0;
    if (inTile(t, cx, cz)) {
      puddle(cx, cz, 1.7, 1.1, Math.atan2(fz, fx) + Math.PI / 2, 0.7, cx * 0.37);
    }
  }
  gullies.forEach(([gx, gz], k) => {
    if (hash(gx * 0.7 + gz) < 0.55) {
      puddle(gx, gz, 0.9, 0.5, hash(k + gx) * 3, 0.55, gx);
    }
  });
  if (wet.idx.length) {
    const nrm = new Array<number>(wet.pos.length).fill(0).map((_, k) => (k % 3 === 1 ? 1 : 0));
    t.mesh.addMesh('st_wet', { positions: wet.pos, indices: wet.idx, normals: nrm, color: wet.col, lod: LOD0 });
  }

  flush(t, 'st_guide', guide, LOD0);
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
