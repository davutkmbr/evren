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
import { district } from '../district';
import { Spacing } from '../../../../src/world/osm/streets/sink';
import type { XYZ } from '../format';
import { headingYaw } from '../instances';
import { LOD0, type Vec3 } from '../mesh';
import type { AreaContext, CompileStep, PlaceOptions } from '../registry';
import { inTile, rng, streetContext, type StreetContext } from './common';
import { sagLine, tube } from './shapes';
import { VEHICLE_HALF_LENGTH } from './vehicles';

export interface Placement {
  prop: string;
  variant?: string;
  pos: XYZ;
  yaw: number;
  scale?: number | XYZ;
  ref: string;
  seed?: number;
  lights?: PlaceOptions['lights'];
  /** Lean (radians about the prop's own X axis) of a knocked bollard. */
  tilt?: number;
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

export interface ClearCamera {
  x: number;
  y: number;
  z: number;
  fx: number;
  fz: number;
  /** Raised above the street (more than 3 m): no near-field wedge on the ground. */
  high: boolean;
}

/**
 * Cameras whose foreground stays clear of people and vehicles: the district profile's reference cameras (Kadıköy:
 * tools/world-compiler/s1/cameras.json), with the render-time pose overrides of scripts/blender/camera-overrides.json
 * where the look lane moved a camera.
 */
export function camerasForClearance(): ClearCamera[] {
  const rel = district().cameras;
  const file = rel ? resolve(ROOT, rel) : '';
  if (!rel || !existsSync(file)) {
    return [];
  }
  const doc = JSON.parse(readFileSync(file, 'utf8')) as { cameras?: { id: string; position: number[]; target: number[]; heightAboveGround?: number }[] };
  const ovFile = resolve(ROOT, 'scripts/blender/camera-overrides.json');
  const ov = existsSync(ovFile) ? ((JSON.parse(readFileSync(ovFile, 'utf8')) as { cameras?: Record<string, { position: number[]; target: number[] }> }).cameras ?? {}) : {};
  const out: ClearCamera[] = [];
  for (const c of doc.cameras ?? []) {
    for (const pose of [c, ov[c.id]].filter((q): q is { position: number[]; target: number[] } => !!q)) {
      const fx = pose.target[0] - pose.position[0];
      const fz = pose.target[2] - pose.position[2];
      const l = Math.hypot(fx, fz) || 1;
      out.push({ x: pose.position[0], y: pose.position[1], z: pose.position[2], fx: fx / l, fz: fz / l, high: (c.heightAboveGround ?? 1.6) > 3 });
    }
  }
  return out;
}
/** Compass heading (deg) of a direction (dx, dz). */
/** The c05 camera of the district's reference cameras (Kadıköy: s1/cameras.json; position and heading), or null. */
function c05Camera(): { x: number; z: number; heading: number } | null {
  const rel = district().cameras;
  const file = rel ? resolve(ROOT, rel) : '';
  if (!rel || !existsSync(file)) {
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
  const vehicleCams = camerasForClearance();
  const clearOfCameras = (x: number, z: number, r: number): boolean =>
    vehicleCams.every((c) => {
      const dx = x - c.x;
      const dz = z - c.z;
      if (Math.hypot(dx, dz, c.y - y(x, z)) < 3 + r) {
        return false;
      }
      const along = dx * c.fx + dz * c.fz;
      const side = Math.abs(-dx * c.fz + dz * c.fx);
      return c.high || !(along > -r && along < 9 + r && side < 1 + r + 0.3 * along);
    });
  /** On or within 1 m of a zebra. */
  const nearZebra = (x: number, z: number): boolean =>
    sc.crossings.some((c) => {
      const len = Math.hypot(c.bx - c.ax, c.bz - c.az) || 1;
      const ux = (c.bx - c.ax) / len;
      const uz = (c.bz - c.az) / len;
      const along = (x - c.ax) * ux + (z - c.az) * uz;
      const across = Math.abs(-(x - c.ax) * uz + (z - c.az) * ux);
      return along > -1 && along < len + 1 && across < c.width / 2 + 1;
    });

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
      for (; g < len; g += sc.inSquare(ax + tx * g + nx * 2.4, az + tz * g + nz * 2.4) ? 6.5 : 14) {
        const f = g;
        const x = ax + tx * f + nx * 2.4;
        const z = az + tz * f + nz * 2.4;
        if (open(x, z, 2.5) && s.distance(x, z) > 3 && (sc.inSquare(x, z) || sc.spineDist(x, z) < 60)) {
          // The square's quay row (c02 photo): blue steel benches facing the water.
          if (put({ prop: 'st_bench', variant: sc.inSquare(x, z) ? 'metal' : 'back', pos: at(x, z), yaw: yawZ(-nx, -nz), ref: `quay/bench${benchK}` }, 2.2)) {
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
    // Photo-fitted masts first: the 12 m floodlight mast at the square's north-east corner (c04 photo, left of the
    // frame: bearing 64° and about 43 m from the camera) and the post-top mast left of the c02 camera (bearing 263°,
    // about 10 m); then the 26 m grid, kept out of the middle of the c04 frame (critique: "the mast stands centre").
    const fitted: [number, number, string, string, number][] = [
      [250.4, 5886.4, 'lamp_mast_double', 'led', 1.25],
      [179.7, 5938.8, 'lamp_mast_low', 'led', 1],
    ];
    fitted.forEach(([x, z, prop, variant, scale], k) => {
      if (onStreetTile(x, z) && !fp.inside(x, z) && put({ prop, variant, pos: at(x, z), yaw: 0.35, scale, ref: `square/photoMast${k}` }, 2)) {
        lampAt.push([x, z]);
      }
    });
    const c04 = { x: 212, z: 5905, heading: 89 };
    let k = 0;
    for (let z = minZ + 12; z < maxZ; z += 26) {
      for (let x = minX + 12; x < maxX; x += 26) {
        if (!sc.inSquare(x, z) || !open(x, z, 5) || s.distance(x, z) < 5 || a.land(x, z) < 4 || lampNear(x, z, 16)) {
          continue;
        }
        const bearing = ((Math.atan2(x - c04.x, -(z - c04.z)) * 180) / Math.PI + 360) % 360;
        if (Math.abs(((bearing - c04.heading + 540) % 360) - 180) < 26 && Math.hypot(x - c04.x, z - c04.z) < 60) {
          continue;
        }
        if (put({ prop: 'lamp_mast_double', variant: 'led', pos: at(x, z), yaw: 0.35, ref: `square/mast${k}` }, 3)) {
          lampAt.push([x, z]);
          k++;
        }
      }
    }

    /* Bench rows (c01, c02 photos: blue steel benches on concrete drum feet): one in front of the 1926 pier's east
       loggia facing it, every 4.5 m, a bin at every other bench. */
    const face: [number, number, number, number] = [155.2, 5916.2, 159.5, 5924.8];
    const fl = Math.hypot(face[2] - face[0], face[3] - face[1]);
    const ftx = (face[2] - face[0]) / fl;
    const ftz = (face[3] - face[1]) / fl;
    const fnx = ftz;
    const fnz = -ftx;
    let rowK = 0;
    for (let along = -1; along < 24; along += 4.5) {
      const x = face[0] + ftx * along + fnx * 6.5;
      const z = face[1] + ftz * along + fnz * 6.5;
      if (!sc.inSquare(x, z) || !open(x, z, 1.5)) {
        continue;
      }
      if (put({ prop: 'st_bench', variant: 'metal', pos: at(x, z), yaw: yawZ(-fnx, -fnz), ref: `square/pierRow${rowK}` }, 1.6)) {
        seats.push({ x, y: y(x, z), z, yaw: yawZ(-fnx, -fnz) });
        const bx = x + ftx * 1.5;
        const bz = z + ftz * 1.5;
        if (rowK++ % 2 === 1 && open(bx, bz, 1)) {
          put({ prop: 'st_bin', variant: 'ibb', pos: at(bx, bz), yaw: 0, ref: `square/pierRowBin${rowK}` }, 0.7);
        }
      }
    }
    // A short line of posts left of the c02 camera (photo: five black posts about 12 m away, bearing 277-286°).
    for (let q = 0; q < 5; q++) {
      const x = 177.4 + q * 0.42;
      const z = 5937.6 - q * 1.15;
      if (open(x, z, 0.3)) {
        put({ prop: 'st_bollard', variant: 'post', pos: at(x, z), yaw: yawZ(0.94, 0.34), ref: `square/c02posts${q}` }, 0.5);
      }
    }
    // Ball-top bollards along the square's Rıhtım kerb (s1-strip.md §3), 0.45 m in from the kerb, every 1.8 m,
    // leaving the dropped kerbs and the bus stop free.
    const sqRing = sc.square;
    const edge = [...Array(sqRing.length / 2).keys()];
    let bk = 0;
    for (const i of edge) {
      const ax = sqRing[i * 2];
      const az = sqRing[i * 2 + 1];
      const bx = sqRing[((i + 1) % edge.length) * 2];
      const bz = sqRing[((i + 1) % edge.length) * 2 + 1];
      const len = Math.hypot(bx - ax, bz - az);
      for (let f = 0; f < len; f += 1.8) {
        const px = ax + ((bx - ax) * f) / len;
        const pz = az + ((bz - az) * f) / len;
        if (s.distance(px, pz) > 4 || s.distance(px, pz) < -3) {
          continue;
        }
        // Walk to the kerb along the distance gradient, then back 0.45 m onto the paving.
        let x = px;
        let z = pz;
        for (let it = 0; it < 30 && Math.abs(s.distance(x, z) - 0.45) > 0.03; it++) {
          const h = 0.3;
          let gx = s.distance(x + h, z) - s.distance(x - h, z);
          let gz = s.distance(x, z + h) - s.distance(x, z - h);
          const l = Math.hypot(gx, gz) || 1;
          gx /= l;
          gz /= l;
          const d = s.distance(x, z) - 0.45;
          x -= gx * Math.max(-0.5, Math.min(0.5, d));
          z -= gz * Math.max(-0.5, Math.min(0.5, d));
        }
        if (!s.kerbed(x, z) || sc.dropped.some((d) => Math.hypot(d.x - x, d.z - z) < d.half + 1.5) || (sc.spine.length > 1 && Math.hypot(sc.spine[0] - x, sc.spine[1] - z) < 6)) {
          continue;
        }
        if (open(x, z, 0.4) && put({ prop: 'st_bollard', variant: 'ball', pos: at(x, z), yaw: 0, ref: `square/kerbBollard${bk}` }, 1.2)) {
          bk++;
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
  }

  /* T3 catenary along the (corrected) tram track on the street tiles: a pole every ~28 m on the nearer pavement
     (0.5 m behind the kerb, else 3.2 m off the track), a cantilever over the track at 6.2 m, a dropper and the
     contact wire at 5.8 m, staggered ±0.2 m (c05 photo: wires over the stop and across the sky). */
  for (const tr of sc.tram) {
    const P = tr.pts;
    let along = 0;
    let next = 0;
    let prev: Vec3 | null = null;
    let stagger = 1;
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
        if (!onStreetTile(cx, cz) || s.distance(cx, cz) > 0) {
          prev = null;
          continue;
        }
        // Nearer pavement: step out on both sides until off the carriageway.
        let pole: [number, number] | null = null;
        let best = Infinity;
        for (const side of [-1, 1]) {
          for (let o = 1.2; o < 7; o += 0.2) {
            const ox = cx - tz * o * side;
            const oz = cz + tx * o * side;
            if (s.distance(ox, oz) > 0.45) {
              if (o < best && open(ox, oz, 0.3)) {
                best = o;
                pole = [ox, oz];
              }
              break;
            }
          }
        }
        if (!pole || !clearOfCameras(pole[0], pole[1], 0.2)) {
          prev = null;
          continue;
        }
        const [ox, oz] = pole;
        const base = y(ox, oz);
        const rail = y(cx, cz);
        stagger = -stagger;
        const wx = cx - tz * 0.2 * stagger;
        const wz = cz + tx * 0.2 * stagger;
        const wire: Vec3 = [wx, rail + 5.8, wz];
        occupied.add(ox, oz);
        cables.push({ pts: [[ox, base, oz], [ox, base + 6.9, oz]], r: 0.1, tile: tileOf(ox, oz) });
        cables.push({ pts: [[ox, base + 6.9, oz], [ox, base + 7.05, oz]], r: 0.06, tile: tileOf(ox, oz) });
        cables.push({ pts: [[ox, base + 6.3, oz], [wx, rail + 6.3, wz]], r: 0.03, tile: tileOf(ox, oz) });
        cables.push({ pts: [[ox, base + 6.75, oz], [wx + (ox - wx) * 0.15, rail + 6.3, wz + (oz - wz) * 0.15]], r: 0.015, tile: tileOf(ox, oz) });
        cables.push({ pts: [[wx, rail + 6.3, wz], wire], r: 0.012, tile: tileOf(wx, wz) });
        if (prev && Math.hypot(prev[0] - wx, prev[2] - wz) < 40) {
          cables.push({ pts: sagLine(prev, wire, 0.08, 10), r: 0.0125, tile: tileOf((prev[0] + wx) / 2, (prev[2] + wz) / 2) });
          count('catenary');
        }
        prev = wire;
      }
      along += len;
    }
  }

  /* Signalised crossings (kind traffic_signals, or within 25 m of an OSM signal node on a carriageway): at each end a
     pole with a vehicle head facing the traffic that approaches in the lane beside that kerb (right-hand traffic) and a
     pedestrian head facing across (c05 photo: heads on both sides of the zebra). */
  const signalNodes = a.data.points.filter((p) => p.kind === 'highway=traffic_signals');
  sc.crossings.forEach((c, k) => {
    const mx = (c.ax + c.bx) / 2;
    const mz = (c.az + c.bz) / 2;
    if (!onStreetTile(mx, mz) || (c.kind !== 'traffic_signals' && !signalNodes.some((p) => Math.hypot(p.x - mx, p.z - mz) < 25))) {
      return;
    }
    for (const [ex, ez, ox, oz] of [
      [c.ax, c.az, c.bx, c.bz],
      [c.bx, c.bz, c.ax, c.az],
    ]) {
      let nx = ex - ox;
      let nz = ez - oz;
      const l = Math.hypot(nx, nz) || 1;
      nx /= l;
      nz /= l;
      // Travel direction of the lane beside this kerb (kerb on the right): d = (n.z, -n.x). The pole stands upstream
      // of the zebra; the prop's +Z (vehicle head) faces -d, its +X points at the kerb, the pedestrian head faces -X.
      const dx = nz;
      const dz = -nx;
      const up = c.width / 2 + 0.7;
      for (const o of [0.55, 0.9, 1.4]) {
        const x = ex + nx * o - dx * up;
        const z = ez + nz * o - dz * up;
        if (s.distance(x, z) > 0.3 && open(x, z, 0.3) && occupied.claim(x, z, 0.8)) {
          items.push({ prop: 'st_signal', variant: 'combo', pos: at(x, z), yaw: yawZ(-dx, -dz), ref: `crossing${k}/signal${ex === c.ax ? 'a' : 'b'}` });
          count('st_signal:combo');
          break;
        }
      }
    }
  });

  /* A few vehicles on Rıhtım Cd (c05 and the spine crossings, s1-strip.md §5): taxis, cars, a dolmuş and a delivery
     van, stopped in the lanes before the zebras (red for them) or further along, never within 3 m of a camera or in
     its near field, never on a zebra or a tram stop's kerb lane. */
  const lanePaths = a.lanes.paths.filter((p) => p.kind === 'lane');
  const cars: { x: number; z: number; hl: number }[] = [];
  const kinds = ['taxi', 'car_white', 'taxi', 'car_grey', 'van', 'taxi', 'dolmus', 'car_blue', 'taxi', 'car_white'];
  let vk = 0;
  const spots: [number, number][] = [];
  if (c05) {
    spots.push([c05.x, c05.z]);
  }
  for (const c of sc.crossings) {
    if (c.kind === 'traffic_signals' && sc.spineDist((c.ax + c.bx) / 2, (c.az + c.bz) / 2) < 12) {
      spots.push([(c.ax + c.bx) / 2, (c.az + c.bz) / 2]);
    }
  }
  // First pass: slots inside the c05 frame (the photo has vans and motorbikes on the road ahead), then the rest.
  const inC05 = (x: number, z: number): boolean => {
    if (!c05) {
      return false;
    }
    const d = Math.hypot(x - c05.x, z - c05.z);
    const bearing = ((Math.atan2(x - c05.x, -(z - c05.z)) * 180) / Math.PI + 360) % 360;
    return d > 10 && d < 70 && Math.abs(((bearing - c05.heading + 540) % 360) - 180) < 27;
  };
  for (const pass of [0, 1]) for (const path of lanePaths) {
    const P = path.points;
    let along = 0;
    let slot = (pass === 0 ? 1 : 4) + hash(path.id * 0.37) * (pass === 0 ? 3 : 10);
    for (let k = 3; k < P.length; k += 3) {
      const ax = P[k - 3];
      const az = P[k - 1];
      const bx = P[k];
      const bz = P[k + 2];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 1e-3) {
        continue;
      }
      const tx = (bx - ax) / len;
      const tz = (bz - az) / len;
      while (slot < along + len) {
        const f = slot - along;
        const x = ax + tx * f;
        const z = az + tz * f;
        const kind = kinds[vk % kinds.length];
        const hl = VEHICLE_HALF_LENGTH[kind];
        slot += pass === 0 ? 1.5 : hl * 2 + 1.4 + hash(slot * 1.7 + path.id) * 9;
        if (pass === 0 && (!inC05(x, z) || cars.filter((q) => inC05(q.x, q.z)).length >= 3)) {
          continue;
        }
        if (!onStreetTile(x, z) || !spots.some(([px, pz]) => Math.hypot(px - x, pz - z) < 60) || s.distance(x, z) > -1.1 || s.pedestrianStreet(x, z)) {
          continue;
        }
        const fx = x + tx * (hl + 0.3);
        const fz = z + tz * (hl + 0.3);
        const bx2 = x - tx * (hl + 0.3);
        const bz2 = z - tz * (hl + 0.3);
        if (nearZebra(fx, fz) || nearZebra(x, z) || nearZebra(bx2, bz2) || sc.tramDist(x, z) < 1.2 || s.distance(fx, fz) > -0.9 || s.distance(bx2, bz2) > -0.9) {
          continue;
        }
        if (!clearOfCameras(x, z, hl) || cars.some((q) => Math.hypot(q.x - x, q.z - z) < q.hl + hl + 1)) {
          continue;
        }
        // Keep a vehicle out of 30 % of the slots (gaps in the traffic).
        if (pass === 1 && hash(x * 0.71 + z * 0.37) < 0.3) {
          continue;
        }
        cars.push({ x, z, hl });
        items.push({ prop: 'st_vehicle', variant: kind, pos: at(x, z), yaw: yawZ(tx, tz), ref: `traffic/${path.id}/${Math.round(slot)}` });
        count(`st_vehicle:${kind}`);
        vk++;
      }
      along += len;
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

  /* The Aya Efimia junction plaza (c07 photo) in front of gate A: a bench against the wall left of the gate, a potted
     shrub and a red umbrella beside it, a lantern column, a trough planter and a topiary pot further out, and a row of
     granite cube bollards along the plaza's north edge. Positions are (left along the wall, out from it) in metres
     from the gate, seen from the plaza. */
  const wall = a.data.lines.find((l) => l.id === 179197257);
  if (wall && onStreetTile(414.5, 6026.7)) {
    const G = { x: 414.5, z: 6026.7 };
    let best: [number, number, number, number] | null = null;
    let bd = Infinity;
    let cx = 0;
    let cz = 0;
    const n = wall.pts.length / 2;
    for (let k = 0; k < n; k++) {
      cx += wall.pts[k * 2] / n;
      cz += wall.pts[k * 2 + 1] / n;
    }
    for (let k = 2; k < wall.pts.length; k += 2) {
      const ax = wall.pts[k - 2];
      const az = wall.pts[k - 1];
      const bx = wall.pts[k];
      const bz = wall.pts[k + 1];
      const dx = bx - ax;
      const dz = bz - az;
      const l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((G.x - ax) * dx + (G.z - az) * dz) / l2));
      const d = Math.hypot(ax + dx * t - G.x, az + dz * t - G.z);
      if (d < bd) {
        bd = d;
        const l = Math.sqrt(l2);
        best = [dx / l, dz / l, ax + dx * t, az + dz * t];
      }
    }
    if (best) {
      const [tx, tz, gx, gz] = best;
      let nx = -tz;
      let nz = tx;
      if (nx * (gx - cx) + nz * (gz - cz) < 0) {
        nx = -nx;
        nz = -nz;
      }
      // Seen from the plaza (facing -n), left is (-n.z, n.x).
      const lx = -nz;
      const lz = nx;
      const P = (left: number, out: number): [number, number] => [gx + lx * left + nx * (0.25 + out), gz + lz * left + nz * (0.25 + out)];
      const kit: [number, number, string, string | undefined, number, number][] = [
        [3.4, 0.45, 'st_bench', 'back', yawZ(nx, nz), 1.2],
        [1.7, 0.4, 'st_planter', 'round', 0, 0.6],
        [1.3, 2.2, 'st_umbrella', 'red', 0, 0.4],
        // The photo's lantern and planters stand further left, where the compiled plaza already meets a building
        // 6 m north of the gate: kept inside the open plaza.
        [3.2, 7, 'st_twin_lantern', 'warm', yawZ(tx, tz), 1],
        [1.2, 9, 'st_planter', 'box', yawZ(tx, tz), 1],
        [3.6, 4.6, 'st_planter', 'round', 0, 0.8],
      ];
      kit.forEach(([left, out, prop, variant, yaw, keep], q) => {
        const [x, z] = P(left, out);
        if (open(x, z, 0.3) && put({ prop, ...(variant ? { variant } : {}), pos: at(x, z), yaw, ref: `plaza/gateA/${prop}${q}` }, keep) && prop === 'st_bench') {
          seats.push({ x: x + nx * 0.05, y: y(x, z), z: z + nz * 0.05, yaw });
        }
      });
      for (let q = 0; q < 4; q++) {
        const [x, z] = P(-0.5 - q * 1.3, 11 + q * 0.2);
        if (open(x, z, 0.3)) {
          put({ prop: 'st_bollard', variant: 'cube', pos: at(x, z), yaw: yawZ(tx, tz), ref: `plaza/gateA/cube${q}` }, 0.6);
        }
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
  /* Wear by instance: a third of the ball-top bollards rusty, about one in twenty knocked askew (6-9°), and the
     crossing post nearest the c05 view leaning (soul catalogue 35: "bent or leaning bollards"). */
  for (const p of items) {
    if (p.prop !== 'st_bollard') {
      continue;
    }
    const h = hash(p.pos[0] * 3.1 + p.pos[2] * 1.7);
    if (p.variant === 'ball' && h < 0.33) {
      p.variant = 'ball_rusty';
    }
    if ((p.variant === 'ball' || p.variant === 'ball_rusty' || p.variant === 'post') && hash(p.pos[0] * 5.3 + p.pos[2] * 0.3) < 0.05) {
      p.tilt = 0.1 + 0.06 * h;
      p.yaw += h * 6.28;
    }
  }
  if (c05) {
    const h = (c05.heading * Math.PI) / 180;
    const fx = c05.x + Math.sin(h) * 12;
    const fz = c05.z - Math.cos(h) * 12;
    let lean: Placement | null = null;
    for (const p of items) {
      if (p.prop === 'st_bollard' && p.variant === 'thin' && Math.hypot(p.pos[0] - fx, p.pos[2] - fz) < 12 && (!lean || Math.hypot(p.pos[0] - fx, p.pos[2] - fz) < Math.hypot(lean.pos[0] - fx, lean.pos[2] - fz))) {
        lean = p;
      }
    }
    if (lean) {
      lean.tilt = 0.14;
      stats.leaningPost = 1;
    }
  }
  stats.tilted = items.filter((p) => p.tilt).length;
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
      const rec = t.place(p.prop, p.pos, p.yaw, { ...(p.variant ? { variant: p.variant } : {}), ...(p.scale !== undefined ? { scale: p.scale } : {}), ref: p.ref, ...(p.seed !== undefined ? { seed: p.seed } : {}), ...(p.lights !== undefined ? { lights: p.lights } : {}) });
      if (p.tilt) {
        // yaw · tilt about the prop's own X axis: [cy·sx, cx·sy, -sy·sx, cy·cx].
        const sy = Math.sin(p.yaw / 2);
        const cy = Math.cos(p.yaw / 2);
        const sx = Math.sin(p.tilt / 2);
        const cx = Math.cos(p.tilt / 2);
        const r5 = (v: number): number => Math.round(v * 1e5) / 1e5;
        rec.rotation = [r5(cy * sx), r5(cx * sy), r5(-sy * sx), r5(cy * cx)];
      }
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
