/**
 * Street furniture of the street tiles (format 1), planned once for the whole area (prepare) and emitted per tile
 * (the tile that holds each item). Rules (s1-strip.md §3 "Surfaces, furniture, cables", reference photos):
 * - steel posts along the quay edge, ball-top bollards across the mouths of pedestrian lanes, thin posts beside every
 *   dropped kerb;
 * - benches along the quay facing the water, with a bin at every other one;
 * - tram / bus stops: sign pole at the kerb, bench and bin;
 * - traffic signal poles at the OSM signal nodes (one per approach) and pedestrian signals at signalised crossings;
 * - café fronts (cafés, restaurants, fast food, ice cream, bars): table sets along the façade, a parasol where the lane
 *   is wide, an A-frame board at the door (the chalk menu is a separate prop on the board);
 * - utility cabinets on kerbed sidewalks, planters and a twin-lantern column at pedestrian junction plazas, OSM trees;
 * - span wires across the pedestrian lanes every ~12 m between the façades (5.8-6.5 m up) carrying pendant lamps.
 * Positions stand on the street ground (common.ts groundY). Everything keeps clear of façades, the carriageway and
 * other furniture (Spacing).
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hash } from '../../../../src/world/osm/shared/geometry';
import { ROOT } from '../../lib/areas.mjs';
import { Spacing } from '../../../../src/world/osm/streets/sink';
import type { XYZ } from '../format';
import { headingYaw } from '../instances';
import { LOD0, type Vec3 } from '../mesh';
import type { AreaContext, CompileStep, PlaceOptions } from '../registry';
import { inTile, rng, streetContext, type StreetContext } from './common';
import { sagLine, tube } from './shapes';

export interface Placement {
  prop: string;
  variant?: string;
  pos: XYZ;
  yaw: number;
  scale?: number | XYZ;
  ref: string;
  seed?: number;
  lights?: PlaceOptions['lights'];
}

export interface Cable {
  pts: Vec3[];
  r: number;
  /** Tile that owns the cable (its midpoint). */
  tile: string;
}

/** Café tables and seats (for the crowd), doors that got a café front. */
export interface Seat {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface StreetPlan {
  items: Placement[];
  cables: Cable[];
  seats: Seat[];
  /** Pendant lamp positions (lamp records near them are replaced). */
  pendants: [number, number][];
  occupied: Spacing;
  stats: Record<string, number>;
}

const FOOD = new Set(['amenity=cafe', 'amenity=restaurant', 'amenity=fast_food', 'amenity=ice_cream', 'amenity=bar', 'amenity=pub']);
const SHOPFRONT_BOARD = /^(shop=(bakery|confectionery|greengrocer|seafood|deli|butcher|pastry|coffee|tea))/;

const tileOf = (x: number, z: number): string => `${Math.floor(x / 100)}_${Math.floor(z / 100)}`;
/** Compass heading (deg) of a direction (dx, dz). */
/** The c05 camera of tools/world-compiler/s1/cameras.json (position and heading), or null. */
function c05Camera(): { x: number; z: number; heading: number } | null {
  const file = resolve(ROOT, 'tools/world-compiler/s1/cameras.json');
  if (!existsSync(file)) {
    return null;
  }
  const doc = JSON.parse(readFileSync(file, 'utf8')) as { cameras?: { id: string; position: number[]; target: number[] }[] };
  const c = (doc.cameras ?? []).find((q) => q.id.startsWith('c05'));
  if (!c) {
    return null;
  }
  const heading = ((Math.atan2(c.target[0] - c.position[0], -(c.target[2] - c.position[2])) * 180) / Math.PI + 360) % 360;
  return { x: c.position[0], z: c.position[2], heading };
}

const compass = (dx: number, dz: number): number => ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;
/** Yaw that turns the prop's +Z along (dx, dz). */
const yawZ = (dx: number, dz: number): number => headingYaw(compass(dx, dz), '+Z');

export function planStreet(a: AreaContext, sc: StreetContext): StreetPlan {
  const s = a.foundation.surface;
  const fp = a.foundation.footprints;
  const streetTileId = (id: string): boolean => a.manifests.has(id) && (a.detailOf(id) === 'full' || sc.kitTiles.has(id));
  const onStreetTile = (x: number, z: number): boolean => streetTileId(tileOf(x, z));
  const occupied = new Spacing(10);
  const items: Placement[] = [];
  const cables: Cable[] = [];
  const seats: Seat[] = [];
  const pendants: [number, number][] = [];
  const stats: Record<string, number> = {};
  const count = (k: string): void => {
    stats[k] = (stats[k] ?? 0) + 1;
  };
  const y = (x: number, z: number): number => sc.groundY(x, z);
  /** Free, walkable spot off the carriageway (or on a pedestrian lane), clear of façades by `wall` metres. */
  const open = (x: number, z: number, wall = 0.3, carriage = false): boolean =>
    onStreetTile(x, z) && !fp.inside(x, z) && s.buildingDistance(x, z) >= wall && a.land(x, z) > 0.3 && (carriage || s.distance(x, z) > 0.3 || s.pedestrianStreet(x, z));
  const put = (p: Placement, keep: number): boolean => {
    if (keep > 0 && !occupied.claim(p.pos[0], p.pos[2], keep)) {
      return false;
    }
    items.push(p);
    count(`${p.prop}${p.variant ? `:${p.variant}` : ''}`);
    return true;
  };
  const at = (x: number, z: number): XYZ => [x, y(x, z), z];

  /* Trees (OSM), first: everything else keeps clear of their trunks. */
  for (const m of a.manifests.values()) {
    if (!streetTileId(m.id)) {
      continue;
    }
    m.trees.forEach((t, k) => {
      const h = t.height ?? 7.5;
      put({ prop: 'st_tree', variant: h > 11 ? 'plane' : 'street', pos: at(t.position[0], t.position[2]), yaw: hash(k + t.position[0]) * 6.28, scale: h > 11 ? h / 15 : h / 7.5, ref: `${m.id}/tree${k}` }, 1.2);
    });
  }

  /* Quay edge: steel posts every 3 m, 0.7 m inland; benches every ~14 m, 2.4 m inland, facing the water. */
  let benchK = 0;
  for (const l of a.data.lines) {
    if (l.kind !== 'natural=coastline') {
      continue;
    }
    let carry = 0;
    let benchCarry = 7;
    for (let k = 2; k < l.pts.length; k += 2) {
      const ax = l.pts[k - 2];
      const az = l.pts[k - 1];
      const len = Math.hypot(l.pts[k] - ax, l.pts[k + 1] - az);
      if (len < 1e-3) {
        continue;
      }
      const tx = (l.pts[k] - ax) / len;
      const tz = (l.pts[k + 1] - az) / len;
      // Land normal: whichever side the land field rises on.
      let nx = tz;
      let nz = -tx;
      const mx = ax + tx * len * 0.5;
      const mz = az + tz * len * 0.5;
      if (a.land(mx + nx * 1.5, mz + nz * 1.5) < a.land(mx - nx * 1.5, mz - nz * 1.5)) {
        nx = -nx;
        nz = -nz;
      }
      let f = carry;
      for (; f < len; f += 3) {
        const x = ax + tx * f + nx * 0.7;
        const z = az + tz * f + nz * 0.7;
        if (open(x, z, 1.5) && s.distance(x, z) > 2 && a.land(x, z) > 0.4) {
          put({ prop: 'st_bollard', variant: 'post', pos: at(x, z), yaw: yawZ(nx, nz), ref: `quay/post${items.length}` }, 1.2);
        }
      }
      carry = f - len;
      let g = benchCarry;
      for (; g < len; g += 14) {
        const f = g;
        const x = ax + tx * f + nx * 2.4;
        const z = az + tz * f + nz * 2.4;
        if (open(x, z, 2.5) && s.distance(x, z) > 3 && (sc.inSquare(x, z) || sc.spineDist(x, z) < 60)) {
          if (put({ prop: 'st_bench', variant: 'back', pos: at(x, z), yaw: yawZ(-nx, -nz), ref: `quay/bench${benchK}` }, 2.2)) {
            seats.push({ x: x - nx * 0.05, y: y(x, z), z: z - nz * 0.05, yaw: yawZ(-nx, -nz) });
            if (benchK++ % 2 === 0) {
              const bx = x + tx * 1.45;
              const bz = z + tz * 1.45;
              if (open(bx, bz, 1)) {
                put({ prop: 'st_bin', variant: 'ibb', pos: at(bx, bz), yaw: 0, ref: `quay/bin${benchK}` }, 0.8);
              }
            }
          }
        }
      }
      benchCarry = g - len;
    }
  }

  /* Lamps the flight slice's street rules do not give: tall LED masts over the arrival square (s1-strip.md §3: about
     4000 K) and a kerb mast at every marked crossing with no street lamp within 14 m. */
  const lampAt: [number, number][] = [];
  for (const m of a.manifests.values()) {
    for (const l of m.lamps) {
      lampAt.push([l.position[0], l.position[2]]);
    }
  }
  const lampNear = (x: number, z: number, r: number): boolean => lampAt.some(([lx, lz]) => Math.hypot(lx - x, lz - z) < r);
  if (sc.square.length >= 6) {
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (let k = 0; k < sc.square.length; k += 2) {
      minX = Math.min(minX, sc.square[k]);
      maxX = Math.max(maxX, sc.square[k]);
      minZ = Math.min(minZ, sc.square[k + 1]);
      maxZ = Math.max(maxZ, sc.square[k + 1]);
    }
    let k = 0;
    for (let z = minZ + 12; z < maxZ; z += 26) {
      for (let x = minX + 12; x < maxX; x += 26) {
        if (!sc.inSquare(x, z) || !open(x, z, 5) || s.distance(x, z) < 5 || a.land(x, z) < 4 || lampNear(x, z, 16)) {
          continue;
        }
        if (put({ prop: 'lamp_mast_double', variant: 'led', pos: at(x, z), yaw: 0.35, ref: `square/mast${k}` }, 3)) {
          lampAt.push([x, z]);
          k++;
        }
      }
    }
  }
  sc.crossings.forEach((c, k) => {
    const mx = (c.ax + c.bx) / 2;
    const mz = (c.az + c.bz) / 2;
    if (lampNear(mx, mz, 14)) {
      return;
    }
    let nx = c.ax - c.bx;
    let nz = c.az - c.bz;
    const l = Math.hypot(nx, nz) || 1;
    nx /= l;
    nz /= l;
    for (const along of [c.width / 2 + 1.4, -(c.width / 2 + 1.4)]) {
      const x = c.ax + nx * 0.6 + c.tx * along;
      const z = c.az + nz * 0.6 + c.tz * along;
      if (open(x, z, 0.8) && put({ prop: 'lamp_mast', variant: 'led', pos: at(x, z), yaw: yawZ(-nx, -nz), ref: `crossing${k}/mast` }, 2)) {
        lampAt.push([x, z]);
        break;
      }
    }
  });

  /* Arrival square: benches on a loose 17 m grid where the square is open, a bin at every other bench. */
  if (sc.square.length >= 6) {
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (let k = 0; k < sc.square.length; k += 2) {
      minX = Math.min(minX, sc.square[k]);
      maxX = Math.max(maxX, sc.square[k]);
      minZ = Math.min(minZ, sc.square[k + 1]);
      maxZ = Math.max(maxZ, sc.square[k + 1]);
    }
    let k = 0;
    for (let z = minZ + 8; z < maxZ; z += 17) {
      for (let x = minX + 8; x < maxX; x += 17) {
        const jx = x + (hash(x * 0.3 + z) - 0.5) * 6;
        const jz = z + (hash(z * 0.7 + x) - 0.5) * 6;
        if (!sc.inSquare(jx, jz) || !open(jx, jz, 4) || s.distance(jx, jz) < 4 || a.land(jx, jz) < 3) {
          continue;
        }
        const ang = hash(jx + jz) * Math.PI * 2;
        if (put({ prop: 'st_bench', variant: hash(jx) < 0.7 ? 'back' : 'flat', pos: at(jx, jz), yaw: ang, ref: `square/bench${k}` }, 3)) {
          seats.push({ x: jx, y: y(jx, jz), z: jz, yaw: ang });
          if (k++ % 2 === 0) {
            const bx = jx + Math.cos(ang) * 1.5;
            const bz = jz - Math.sin(ang) * 1.5;
            if (open(bx, bz, 1)) {
              put({ prop: 'st_bin', variant: 'ibb', pos: at(bx, bz), yaw: 0, ref: `square/bin${k}` }, 0.8);
            }
          }
        }
      }
    }
  }

  /* Mouths of pedestrian lanes that meet a carriageway: ball-top bollards 1.5 m apart (the flight slice's rule). */
  const mouths = new Spacing(12);
  for (const st of sc.streets) {
    if (!st.pedestrian || st.hw < 1.8) {
      continue;
    }
    const n = st.pts.length / 2;
    for (const end of [0, n - 1]) {
      const x0 = st.pts[end * 2];
      const z0 = st.pts[end * 2 + 1];
      const nb = end === 0 ? 1 : n - 2;
      let tx = st.pts[nb * 2] - x0;
      let tz = st.pts[nb * 2 + 1] - z0;
      const l = Math.hypot(tx, tz);
      if (l < 4 || !onStreetTile(x0, z0)) {
        continue;
      }
      tx /= l;
      tz /= l;
      const ox = x0 - tx * 1.5;
      const oz = z0 - tz * 1.5;
      if (!(s.distance(ox, oz) < 0 && !s.pedestrianStreet(ox, oz))) {
        continue;
      }
      const mx = x0 + tx * 2.5;
      const mz = z0 + tz * 2.5;
      if (!mouths.claim(mx, mz, 10)) {
        continue;
      }
      const half = Math.min(st.hw - 0.4, 6);
      const cnt = Math.max(2, Math.round((half * 2) / 1.5) + 1);
      for (let i = 0; i < cnt; i++) {
        const o = -half + (i * half * 2) / (cnt - 1);
        const bx = mx - tz * o;
        const bz = mz + tx * o;
        if (open(bx, bz, 0.6, true)) {
          put({ prop: 'st_bollard', variant: 'ball', pos: at(bx, bz), yaw: 0, ref: `mouth/${st.road}/${end}/${i}` }, 0.6);
        }
      }
    }
  }

  /* Dropped kerbs: a thin post on each side, 0.45 m behind the kerb; pedestrian signals at signalised crossings. */
  const signalised = new Set(sc.crossings.filter((c) => c.kind === 'traffic_signals').flatMap((c) => [`${c.ax.toFixed(1)},${c.az.toFixed(1)}`, `${c.bx.toFixed(1)},${c.bz.toFixed(1)}`]));
  sc.dropped.forEach((d, k) => {
    for (const side of [-1, 1]) {
      const x = d.x + d.tx * side * (d.half + 0.55) + d.nx * 0.45;
      const z = d.z + d.tz * side * (d.half + 0.55) + d.nz * 0.45;
      if (open(x, z, 0.5)) {
        put({ prop: 'st_bollard', variant: 'thin', pos: at(x, z), yaw: 0, ref: `kerb${k}/post${side}` }, 0.5);
      }
    }
    if (signalised.has(`${d.x.toFixed(1)},${d.z.toFixed(1)}`)) {
      const x = d.x + d.tx * (d.half + 1.2) + d.nx * 0.5;
      const z = d.z + d.tz * (d.half + 1.2) + d.nz * 0.5;
      if (open(x, z, 0.5)) {
        put({ prop: 'st_signal', variant: 'pedestrian', pos: at(x, z), yaw: yawZ(-d.nx, -d.nz), ref: `kerb${k}/signal` }, 0.8);
      }
    }
  });

  /* Traffic signals: a pole at the right kerb of every approach (as the flight slice's furniture.ts). */
  for (const p of a.data.points) {
    if (p.kind !== 'highway=traffic_signals' || !p.roads || !onStreetTile(p.x, p.z)) {
      continue;
    }
    for (const ri of p.roads) {
      const road = a.data.roads[ri];
      const st = sc.streets.find((q) => q.road === ri);
      if (!road || !st || st.pedestrian || p.ref === undefined) {
        continue;
      }
      const refs = road.refs ?? [];
      let v = -1;
      for (let k = 0; k < refs.length; k += 2) {
        if (refs[k + 1] === p.ref) {
          v = refs[k];
        }
      }
      if (v < 0) {
        continue;
      }
      const approaches: number[] = [];
      if (v > 0 && p.direction !== 'backward') {
        approaches.push(v - 1);
      }
      if (!road.oneway && v < road.pts.length / 2 - 1 && p.direction !== 'forward') {
        approaches.push(v + 1);
      }
      for (const u of approaches) {
        const ax = road.pts[u * 2];
        const az = road.pts[u * 2 + 1];
        const l = Math.hypot(p.x - ax, p.z - az);
        if (l < 2) {
          continue;
        }
        const tx = (p.x - ax) / l;
        const tz = (p.z - az) / l;
        const back = Math.min(3, l * 0.4);
        // Right kerb: search outwards from the centre line for the pavement.
        for (let o = st.hw * 0.5; o < st.hw + 6; o += 0.25) {
          const px = p.x - tx * back - tz * o;
          const pz = p.z - tz * back + tx * o;
          if (s.distance(px, pz) > 0.45) {
            if (open(px, pz, 0.5)) {
              put({ prop: 'st_signal', variant: 'traffic', pos: at(px, pz), yaw: yawZ(-tx, -tz), ref: `signal/${p.ref}/${u}` }, 3);
            }
            break;
          }
        }
      }
    }
  }

  /* The c05 foreground (spec §5: İskele Cami T3 stop), placed as measured on the c05 photo relative to its camera:
     the tram stop pole with the oval sign 2.6 m ahead, the bench on concrete feet, the blue bin, street trees
     behind, and the T3 catenary (poles with cantilevers, a contact wire at 5.8 m) along the track nearby. */
  const c05 = c05Camera();
  if (c05 && onStreetTile(c05.x, c05.z)) {
    const h = (c05.heading * Math.PI) / 180;
    const fx = Math.sin(h);
    const fz = -Math.cos(h);
    const rx = Math.cos(h);
    const rz = Math.sin(h);
    const rel = (ahead: number, left: number): [number, number] => [c05.x + fx * ahead - rx * left, c05.z + fz * ahead - rz * left];
    const [px, pz] = rel(2.6, 0.45);
    put({ prop: 'st_stop_pole', variant: 'tram', pos: at(px, pz), yaw: headingYaw(c05.heading + 90, '+X'), ref: 'stop/c05/pole' }, 0);
    const [bx, bz] = rel(3.4, 2.1);
    if (put({ prop: 'st_bench', variant: 'flat', pos: at(bx, bz), yaw: yawZ(rx + fx * 0.3, rz + fz * 0.3), ref: 'stop/c05/bench' }, 0)) {
      seats.push({ x: bx, y: y(bx, bz), z: bz, yaw: yawZ(rx + fx * 0.3, rz + fz * 0.3) });
    }
    const [ix, iz] = rel(2.2, 1.05);
    put({ prop: 'st_bin', variant: 'ibb', pos: at(ix, iz), yaw: 0, ref: 'stop/c05/bin' }, 0);
    for (const [ah, lf, sc2] of [
      [7.5, 4.8, 1.25],
      [15, 6.5, 1.1],
      [24, 6.0, 1.2],
    ] as const) {
      const [tx, tz] = rel(ah, lf);
      if (open(tx, tz, 0.5)) {
        put({ prop: 'st_tree', variant: 'street', pos: at(tx, tz), yaw: hash(tx) * 6.28, scale: sc2, ref: `c05/tree${ah}` }, 0);
      }
    }
    // Catenary along the T3 track within 90 m of the camera: poles every 28 m, 3.2 m off the track, a cantilever
    // over it and the contact wire at 5.8 m (25 mm, drawn as a cable).
    for (const tr of a.data.rails) {
      if (!/tram/.test(tr.kind)) {
        continue;
      }
      const P = tr.pts;
      let along = 0;
      let next = 0;
      let prev: Vec3 | null = null;
      for (let k = 2; k < P.length; k += 2) {
        const ax = P[k - 2];
        const az = P[k - 1];
        const len = Math.hypot(P[k] - ax, P[k + 1] - az);
        if (len < 1e-3) {
          continue;
        }
        const tx = (P[k] - ax) / len;
        const tz = (P[k + 1] - az) / len;
        while (next < along + len) {
          const f = next - along;
          const cx = ax + tx * f;
          const cz = az + tz * f;
          next += 28;
          if (Math.hypot(cx - c05.x, cz - c05.z) > 90 || !onStreetTile(cx, cz)) {
            prev = null;
            continue;
          }
          const ox = cx - tz * 3.2;
          const oz = cz + tx * 3.2;
          const base = y(ox, oz);
          const wire: Vec3 = [cx, y(cx, cz) + 5.8, cz];
          cables.push({ pts: [[ox, base, oz], [ox, base + 6.6, oz]], r: 0.09, tile: tileOf(ox, oz) });
          cables.push({ pts: [[ox, base + 6.2, oz], [cx, base + 6.2, cz]], r: 0.03, tile: tileOf(ox, oz) });
          cables.push({ pts: [[cx, base + 6.2, cz], wire], r: 0.012, tile: tileOf(cx, cz) });
          if (prev) {
            cables.push({ pts: sagLine(prev, wire, 0.08, 8), r: 0.0125, tile: tileOf((prev[0] + cx) / 2, (prev[2] + cz) / 2) });
            count('catenary');
          }
          prev = wire;
        }
        along += len;
      }
    }
  }

  /* Tram and bus stops: pole at the kerb, bench and bin behind it. */
  for (const p of a.data.points) {
    const tram = p.kind === 'railway=tram_stop';
    if ((!tram && p.kind !== 'highway=bus_stop') || !onStreetTile(p.x, p.z) || (c05 && Math.hypot(p.x - c05.x, p.z - c05.z) < 12)) {
      continue;
    }
    // Pavement spot 0.6-1.2 m behind the nearest kerb.
    let best: [number, number] | null = null;
    let bestD = Infinity;
    for (let r = 0; r <= 8; r += 0.5) {
      for (let q = 0; q < 16; q++) {
        const ang = (q / 16) * Math.PI * 2;
        const x = p.x + Math.cos(ang) * r;
        const z = p.z + Math.sin(ang) * r;
        const d = s.distance(x, z);
        if (d > 0.6 && d < 1.2 && s.kerbed(x, z) && open(x, z, 1) && r < bestD) {
          bestD = r;
          best = [x, z];
        }
      }
      if (best) {
        break;
      }
    }
    if (!best) {
      continue;
    }
    const [x, z] = best;
    const g = sc.near(x, z, 30, (q) => !q.pedestrian);
    if (!g) {
      continue;
    }
    // Towards the road: from the kerb point back to the centre line.
    let rx = g.px - x;
    let rz = g.pz - z;
    const rl = Math.hypot(rx, rz) || 1;
    rx /= rl;
    rz /= rl;
    put({ prop: 'st_stop_pole', variant: tram ? 'tram' : 'bus', pos: at(x, z), yaw: headingYaw(compass(rx, rz), '+X'), ref: `stop/${p.name ?? p.kind}` }, 1);
    const bx = x + g.tx * 2.6 - rx * 0.9;
    const bz = z + g.tz * 2.6 - rz * 0.9;
    if (open(bx, bz, 0.6) && put({ prop: 'st_bench', variant: 'back', pos: at(bx, bz), yaw: yawZ(rx, rz), ref: `stop/${p.name ?? p.kind}/bench` }, 1.6)) {
      seats.push({ x: bx, y: y(bx, bz), z: bz, yaw: yawZ(rx, rz) });
    }
    const ix = x + g.tx * 1.2 - rx * 0.3;
    const iz = z + g.tz * 1.2 - rz * 0.3;
    if (open(ix, iz, 0.5)) {
      put({ prop: 'st_bin', variant: 'ibb', pos: at(ix, iz), yaw: 0, ref: `stop/${p.name ?? p.kind}/bin` }, 0.7);
    }
  }

  /* Café fronts, A-frames and shop boards. */
  const r = rng(90217);
  let cafes = 0;
  for (const m of a.manifests.values()) {
    if (!streetTileId(m.id)) {
      continue;
    }
    const doors = new Map(m.doors.map((d) => [d.id, d]));
    const done = new Set<string>();
    for (const p of m.pois) {
      const d = p.door ? doors.get(p.door) : undefined;
      if (!d || done.has(d.id)) {
        continue;
      }
      const food = FOOD.has(p.kind);
      const board = food || SHOPFRONT_BOARD.test(p.kind) || hash(p.position[0] * 3.3 + p.position[2]) < 0.2;
      if (!food && !board) {
        continue;
      }
      done.add(d.id);
      const [nx, , nz] = d.normal;
      const tx = -nz;
      const tz = nx;
      const dx = d.position[0];
      const dz = d.position[2];
      const side = hash(dx * 1.7 + dz) < 0.5 ? -1 : 1;
      let sets = 0;
      if (food) {
        for (const off of [1.9, 3.7]) {
          const o = off * side;
          const x = dx + tx * o + nx * 0.62;
          const z = dz + tz * o + nz * 0.62;
          // Keep 1.8 m of the lane free in front of the set.
          const fx = x + nx * 2.2;
          const fz = z + nz * 2.2;
          const wide = s.pedestrianStreet(x, z) || s.distance(x, z) > 2.5;
          if (!wide || !open(x, z, 0.35) || !open(fx, fz, 0.3) || !occupied.free(x, z, 1.3)) {
            break;
          }
          const yaw = yawZ(tx, tz);
          put({ prop: 'outdoor_table_chair_set_01', pos: at(x, z), yaw, ref: `${d.id}/cafe${sets}` }, 1.3);
          // Chairs of the set sit at about +-0.56 m along its Z (facing the table).
          for (const cz of [0.56, -0.56]) {
            seats.push({ x: x + tx * cz, y: y(x, z), z: z + tz * cz, yaw: yawZ(-tx * Math.sign(cz), -tz * Math.sign(cz)) });
          }
          if (r() < 0.45) {
            const cx = x + nx * 0.75 + tx * 0.2;
            const cz = z + nz * 0.75 + tz * 0.2;
            if (open(cx, cz, 0.3)) {
              put({ prop: 'plastic_monobloc_chair_01', pos: at(cx, cz), yaw: yawZ(-nx, -nz), ref: `${d.id}/chair${sets}` }, 0.45);
            }
          }
          sets++;
        }
        if (sets) {
          cafes++;
          stats.cafeFronts = cafes;
          const ux = dx + tx * side * 2.8 + nx * 1.9;
          const uz = dz + tz * side * 2.8 + nz * 1.9;
          if (sets >= 2 && open(ux, uz, 1.2) && open(ux + nx * 1.6, uz + nz * 1.6, 0.5)) {
            put({ prop: 'st_umbrella', variant: hash(dx) < 0.5 ? 'cream' : 'red', pos: at(ux, uz), yaw: 0, ref: `${d.id}/parasol` }, 0.5);
          }
        }
      }
      // A-frame on the other side of the door, facing along the lane.
      const bx = dx - tx * side * 1.35 + nx * 0.85;
      const bz = dz - tz * side * 1.35 + nz * 0.85;
      if (open(bx, bz, 0.4) && open(bx + nx * 1.6, bz + nz * 1.6, 0.3)) {
        const yaw = yawZ(tx, tz);
        if (put({ prop: 'standing_chalkboard_01', pos: at(bx, bz), yaw, ref: `${d.id}/board` }, 0.9)) {
          put({ prop: 'st_chalk_menu', variant: `menu${Math.floor(hash(bx * 0.37 + bz) * 6)}`, pos: at(bx, bz), yaw, ref: `${d.id}/menu` }, 0);
        }
      }
    }
  }

  /* Utility cabinets against façades on kerbed sidewalks (about one per 70 m, hashed). */
  for (const st of sc.streets) {
    if (!st.kerbed || st.pedestrian) {
      continue;
    }
    let next = 20 + hash(st.road * 0.53) * 50;
    let along = 0;
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
        const side = hash(next + st.road) < 0.5 ? -1 : 1;
        for (let o = st.hw + 1; o < st.hw + 7; o += 0.2) {
          const x = ax + tx * f - tz * o * side;
          const z = az + tz * f + tx * o * side;
          const bd = s.buildingDistance(x, z);
          if (bd < 0.5) {
            if (bd > 0.3 && s.distance(x, z) > 1.8 && open(x, z, 0.3)) {
              put({ prop: 'st_cabinet', variant: hash(next) < 0.3 ? 'double' : 'single', pos: at(x, z), yaw: yawZ(tz * side, -tx * side), ref: `cabinet/${st.road}/${Math.round(next)}` }, 1.2);
            }
            break;
          }
        }
        next += 55 + hash(next * 1.3 + st.road) * 40;
      }
      along += len;
    }
  }

  /* Pedestrian junction plazas: a twin-lantern column and two planters. */
  const refStreets = new Map<number, { x: number; z: number; n: number }>();
  for (const st of sc.streets) {
    if (!st.pedestrian) {
      continue;
    }
    const refs = a.data.roads[st.road].refs ?? [];
    for (let k = 0; k < refs.length; k += 2) {
      const e = refStreets.get(refs[k + 1]) ?? { x: st.pts[refs[k] * 2], z: st.pts[refs[k] * 2 + 1], n: 0 };
      e.n++;
      refStreets.set(refs[k + 1], e);
    }
  }
  for (const [ref, j] of refStreets) {
    if (j.n < 3 || !onStreetTile(j.x, j.z) || sc.spineDist(j.x, j.z) > 40) {
      continue;
    }
    // Open spots around the node, the most open first.
    const cands: [number, number, number][] = [];
    for (let q = 0; q < 12; q++) {
      const ang = (q / 12) * Math.PI * 2;
      for (const rad of [2.2, 3.4]) {
        const x = j.x + Math.cos(ang) * rad;
        const z = j.z + Math.sin(ang) * rad;
        if (open(x, z, 1.6)) {
          cands.push([x, z, s.buildingDistance(x, z)]);
        }
      }
    }
    cands.sort((p, q) => q[2] - p[2]);
    let lantern = false;
    let planters = 0;
    for (const [x, z] of cands) {
      if (!lantern) {
        lantern = put({ prop: 'st_twin_lantern', variant: 'warm', pos: at(x, z), yaw: hash(ref) * 3, ref: `plaza/${ref}/lantern` }, 3);
        continue;
      }
      if (planters < 2 && put({ prop: 'st_planter', variant: planters ? 'round' : 'box', pos: at(x, z), yaw: hash(x) * 3, ref: `plaza/${ref}/planter${planters}` }, 2.5)) {
        planters++;
      }
    }
  }

  /* Span wires with pendant lamps across the pedestrian lanes. */
  const facadeHit = (x: number, z: number, dx: number, dz: number, max: number): number | null => {
    for (let d = 0; d <= max; d += 0.2) {
      const px = x + dx * d;
      const pz = z + dz * d;
      if (s.buildingDistance(px, pz) < 0.12 || fp.inside(px, pz)) {
        return d;
      }
    }
    return null;
  };
  const spans = new Spacing(12);
  for (const st of sc.streets) {
    if (!st.pedestrian) {
      continue;
    }
    let along = 0;
    let next = 4 + hash(st.road * 0.71) * 8;
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
        const cx = ax + tx * f;
        const cz = az + tz * f;
        next += 11 + hash(next + st.road) * 3;
        if (!onStreetTile(cx, cz) || fp.inside(cx, cz)) {
          continue;
        }
        const l1 = facadeHit(cx, cz, -tz, tx, 9);
        const l2 = facadeHit(cx, cz, tz, -tx, 9);
        if (l1 === null || l2 === null || l1 + l2 > 14 || l1 + l2 < 3 || !spans.claim(cx, cz, 9)) {
          continue;
        }
        const h = 5.8 + hash(next * 0.3) * 0.7;
        const A: Vec3 = [cx - tz * (l1 - 0.05), y(cx, cz) + h, cz + tx * (l1 - 0.05)];
        const B: Vec3 = [cx + tz * (l2 - 0.05), y(cx, cz) + h + (hash(next) - 0.5) * 0.4, cz - tx * (l2 - 0.05)];
        const sag = 0.18 + 0.02 * (l1 + l2);
        const pts = sagLine(A, B, sag, 16);
        const mid = pts[8];
        cables.push({ pts, r: 0.0125, tile: tileOf(mid[0], mid[2]) });
        count('spanWires');
        // Pendant hangs from the middle of the wire; its suspension point is 0.9 m above the prop's origin.
        put({ prop: 'st_pendant', variant: 'warm', pos: [mid[0], mid[1] - 0.9, mid[2]], yaw: yawZ(tx, tz), ref: `span/${st.road}/${Math.round(next)}` }, 0);
        pendants.push([mid[0], mid[2]]);
      }
      along += len;
    }
  }
  return { items, cables, seats, pendants, occupied, stats };
}

export function streetPlan(a: AreaContext): StreetPlan {
  let p = a.shared.get('streetPlan') as StreetPlan | undefined;
  if (!p) {
    p = planStreet(a, streetContext(a));
    a.shared.set('streetPlan', p);
  }
  return p;
}

export const streetFurnitureStep: CompileStep = {
  id: 'streetFurniture',
  prepare(a) {
    streetPlan(a);
  },
  tile(t) {
    const plan = streetPlan(t.area);
    // Market stalls of the shopfront step (placed earlier in this tile) keep their space.
    const stalls = t.instances.list.filter((i) => i.asset.startsWith('fac_stall')).map((i) => i.position);
    let n = 0;
    for (const p of plan.items) {
      if (!inTile(t, p.pos[0], p.pos[2]) || stalls.some((q) => Math.hypot(q[0] - p.pos[0], q[2] - p.pos[2]) < 1.8)) {
        continue;
      }
      t.place(p.prop, p.pos, p.yaw, { ...(p.variant ? { variant: p.variant } : {}), ...(p.scale !== undefined ? { scale: p.scale } : {}), ref: p.ref, ...(p.seed !== undefined ? { seed: p.seed } : {}), ...(p.lights !== undefined ? { lights: p.lights } : {}) });
      n++;
    }
    let wires = 0;
    t.mesh.withLod(LOD0, () => {
      for (const c of plan.cables) {
        if (c.tile === t.id) {
          tube(t.mesh, 'st_cable', c.pts, c.r, 4);
          wires++;
        }
      }
    });
    if (n || wires) {
      t.record('streetFurniture', { items: n, spanWires: wires });
    }
  },
  finish(a) {
    const plan = streetPlan(a);
    console.error(`[street] furniture ${JSON.stringify(plan.stats)}`);
  },
};
