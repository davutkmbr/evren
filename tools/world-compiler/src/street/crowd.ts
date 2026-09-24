/**
 * Placeholder pedestrians (format 1): neutral procedural people (kit-props.ts st_person: palettes x standing /
 * walking / sitting poses, static meshes) as prop instances, to be replaced by the MetaHuman crowd. Densities follow
 * s1-strip.md §4 by zone; the placement follows how people use the strip (S1 round 2, critique "a uniform random
 * scatter with no flows, groups, queues or seated clusters"):
 * - the arrival square: flows along the desire lines (wear.ts: pier gates → crossing → Yasa Cd, the bus stop), people
 *   walking alone, in pairs side by side or in threes and fours; waiting clusters at the pier gates, the bus stop and
 *   the crossing kerb; standing conversation groups (2-4 facing each other); people sitting on the quay edge with
 *   their legs over the water; a sparse scatter elsewhere;
 * - tram stops: a waiting group on the stop's pavement facing the track;
 * - lanes, pavements and crossings (walk graph): walkers in both directions, a third in groups of 2-4; the fish /
 *   produce end densest (0.45 / m² near P11), Yasa Cd 0.15 / m², Rıhtım Cd 0.06 / m²;
 * - per tile, browsers 0.6-1.0 m in front of stalls and shop windows, and 65 % of the café chairs and benches near the
 *   strip taken; people sitting on the rims of the junction planters.
 * Nobody spawns inside a building or a hero's outline (0.8 m margin), within 0.35 m of a wall, within 3 m of any
 * camera of tools/world-compiler/s1/cameras.json (and the look lane's pose overrides) or in the 11 m foreground
 * wedge of an eye-level camera. Heights vary with the instance scale (0.92-1.08 of 1.75 m); `seed` lets runtimes vary
 * them further. Instance refs start with "crowd/" so a runtime can swap them for animated agents.
 */
import { pointInRing, segDist } from '../../../../src/world/osm/shared/geometry';
import { Spacing } from '../../../../src/world/osm/streets/sink';
import type { XYZ } from '../format';
import type { HeroShared } from '../hero';
import { headingYaw } from '../instances';
import { interiorDoorViews } from '../interiors';
import type { AreaContext, CompileStep, TileContext } from '../registry';
import { inTile, rng, streetContext } from './common';
import { camerasForClearance, streetPlan, type Placement } from './furniture';
import { PERSON_PALETTES } from './kit-props';
import { wearPlan } from './wear';

/** Share of seats taken (café chairs, benches near the strip). */
const SEATED_SHARE = 0.65;
const FISH_REACH = 60;

export interface CrowdPlan {
  people: Placement[];
  stats: Record<string, number>;
}

type Pose = 'walking' | 'standing' | 'sitting';

interface CrowdState {
  plan: CrowdPlan;
  taken: Spacing;
  blocked: (x: number, z: number) => boolean;
  add: (pose: Pose, x: number, y: number, z: number, yaw: number) => void;
  r: () => number;
}

function planCrowd(a: AreaContext): CrowdState {
  const sc = streetContext(a);
  const plan = streetPlan(a);
  const s = a.foundation.surface;
  const fp = a.foundation.footprints;
  const w = a.walk.file;
  const tileOf = (x: number, z: number): string => `${Math.floor(x / 100)}_${Math.floor(z / 100)}`;
  const streetTileId = (id: string): boolean => a.manifests.has(id) && (a.detailOf(id) === 'full' || sc.kitTiles.has(id));
  const spine = sc.spine;
  const P11: [number, number] = spine.length >= 2 ? [spine[spine.length - 2], spine[spine.length - 1]] : [0, 0];
  const P8: [number, number] = spine.length >= 18 ? [spine[16], spine[17]] : P11;
  // Hero outlines (gated loggias, arcades) are closed to spawns, with a margin.
  const heroes = a.shared.get('heroes') as HeroShared | undefined;
  const heroRings = a.solids.filter((q) => heroes?.solids.has(q.rec.id)).map((q) => q.ring);
  for (const b of a.data.buildings) {
    if (heroes?.outlines.has(b.id)) {
      heroRings.push(b.ring);
    }
  }
  const nearHero = (x: number, z: number): boolean =>
    heroRings.some((ring) => {
      if (pointInRing(ring, x, z)) {
        return true;
      }
      const m = ring.length / 2;
      for (let i = 0, j = m - 1; i < m; j = i++) {
        if (segDist(x, z, ring[j * 2], ring[j * 2 + 1], ring[i * 2], ring[i * 2 + 1]) < 0.8) {
          return true;
        }
      }
      return false;
    });
  // Reference cameras keep a clear foreground: nobody within 3 m (3D) of a camera, nor in an 11 m wedge ahead of an
  // eye-level one (cameras.json with the look lane's overrides, and the interior street views).
  const cams = [...camerasForClearance(), ...interiorDoorViews(a).map((v) => ({ ...v, y: sc.groundY(v.x, v.z) + 1.6, high: false }))];
  const inCameraView = (x: number, z: number): boolean =>
    cams.some((c) => {
      const dx = x - c.x;
      const dz = z - c.z;
      if (Math.hypot(dx, dz, c.y - (sc.groundY(x, z) + 1.2)) < 3.2) {
        return true;
      }
      if (c.high) {
        return false;
      }
      const along = dx * c.fx + dz * c.fz;
      const side = Math.abs(-dx * c.fz + dz * c.fx);
      // The near field: nobody inside the view within 6.5 m (a figure there fills half the frame), then an 11 m wedge.
      return (Math.hypot(dx, dz) < 6.5 && along > 0 && side < along * 0.85 + 0.6) || (along > -0.5 && along < 11 && side < 1.0 + 0.33 * along);
    });
  const blocked = (x: number, z: number): boolean => inCameraView(x, z) || fp.inside(x, z) || s.buildingDistance(x, z) < 0.35 || a.land(x, z) < 0.5 || (s.distance(x, z) < 0 && !s.pedestrianStreet(x, z)) || nearHero(x, z);
  /** People per m² wanted at (x, z); 0 outside the strip. */
  const density = (x: number, z: number): number => {
    const toFish = Math.hypot(x - P11[0], z - P11[1]);
    if (toFish < 24) {
      return 0.45;
    }
    if (toFish < FISH_REACH && s.pedestrianStreet(x, z)) {
      return toFish < 40 ? 0.32 : 0.2;
    }
    if (sc.inSquare(x, z)) {
      return 0.045;
    }
    const d = sc.spineDist(x, z);
    if (d > 9) {
      return 0;
    }
    const onYasa = Math.hypot(x - P8[0], z - P8[1]) < 150 && d < 6 && s.pedestrianStreet(x, z);
    return onYasa ? 0.15 : 0.06;
  };
  const r = rng(4711);
  const taken = new Spacing(4);
  const people: Placement[] = [];
  const stats: Record<string, number> = { walking: 0, standing: 0, sitting: 0, browsing: 0, square: 0 };
  const palettes = PERSON_PALETTES.length;
  const add = (pose: Pose, x: number, y: number, z: number, yaw: number): void => {
    const k = Math.floor(r() * (pose === 'sitting' ? 6 : palettes));
    people.push({ prop: 'st_person', variant: `${pose}${k}`, pos: [x, y, z], yaw, scale: pose === 'sitting' ? 0.96 + r() * 0.08 : 0.92 + r() * 0.16, ref: `crowd/${people.length}`, seed: Math.floor(r() * 1e6) });
    stats[pose]++;
  };
  /** Group size of walkers: 45 % alone, 33 % pairs, 15 % threes, 7 % fours. */
  const groupSize = (): number => {
    const q = r();
    return q < 0.45 ? 1 : q < 0.78 ? 2 : q < 0.93 ? 3 : 4;
  };
  /**
   * Walkers heading `h` degrees at (x, z): one, or a group side by side (pairs, threes in a shallow V, fours two by
   * two), keeping step with small heading jitter.
   */
  const walkGroup = (x: number, z: number, h: number, n: number): number => {
    const rad = (h * Math.PI) / 180;
    // Right of the heading is (cos h, sin h) in (x, z); forward is (sin h, -cos h).
    const rx = Math.cos(rad);
    const rz = Math.sin(rad);
    const fx = Math.sin(rad);
    const fz = -Math.cos(rad);
    const slots: [number, number][] = n === 1 ? [[0, 0]] : n === 2 ? [[-0.32, 0], [0.32, 0]] : n === 3 ? [[-0.62, -0.25], [0, 0.1], [0.62, -0.25]] : [[-0.32, 0.45], [0.32, 0.45], [-0.32, -0.45], [0.32, -0.45]];
    let placed = 0;
    for (const [side, ahead] of slots) {
      const px = x + rx * side + fx * ahead + (r() - 0.5) * 0.08;
      const pz = z + rz * side + fz * ahead + (r() - 0.5) * 0.08;
      if (blocked(px, pz) || !plan.occupied.free(px, pz, 0.5) || !taken.claim(px, pz, 0.46)) {
        continue;
      }
      add('walking', px, sc.groundY(px, pz), pz, headingYaw(h + (r() - 0.5) * 7, '+Z'));
      placed++;
    }
    return placed;
  };
  /** Standers talking: 2-4 in a small circle facing its centre. */
  const talkGroup = (x: number, z: number, n: number): number => {
    let placed = 0;
    const a0 = r() * Math.PI * 2;
    const rad = n === 2 ? 0.42 : 0.55;
    for (let k = 0; k < n; k++) {
      const a2 = a0 + (k / n) * Math.PI * 2 + (r() - 0.5) * 0.4;
      const px = x + Math.cos(a2) * rad;
      const pz = z + Math.sin(a2) * rad;
      if (blocked(px, pz) || !plan.occupied.free(px, pz, 0.5) || !taken.claim(px, pz, 0.45)) {
        continue;
      }
      const h = ((Math.atan2(x - px, -(z - pz)) * 180) / Math.PI + 360 + (r() - 0.5) * 25) % 360;
      add('standing', px, sc.groundY(px, pz), pz, headingYaw(h, '+Z'));
      placed++;
    }
    return placed;
  };
  /** A walker or group, or a stander at (x, z), heading `h` degrees. */
  const person = (x: number, z: number, h: number, walkShare: number): void => {
    if (r() < walkShare) {
      walkGroup(x, z, h, groupSize());
    } else if (!blocked(x, z) && taken.claim(x, z, 0.5)) {
      add('standing', x, sc.groundY(x, z), z, headingYaw(r() * 360, '+Z'));
    }
  };
  /** Waiting cluster: n people within `spread` m of (x, z), facing (faceX, faceZ) with some scatter. */
  const waitCluster = (x: number, z: number, faceX: number, faceZ: number, n: number, spread: number, zone: string): void => {
    const face = (Math.atan2(faceX, -faceZ) * 180) / Math.PI;
    let placed = 0;
    for (let k = 0; k < n * 6 && placed < n; k++) {
      const u = (r() + r() - 1) * spread;
      const v = (r() + r() - 1) * spread * 0.6;
      // u across the facing direction, v along it.
      const px = x + -faceZ * u + faceX * v;
      const pz = z + faceX * u + faceZ * v;
      if (blocked(px, pz) || !plan.occupied.free(px, pz, 0.5) || !taken.claim(px, pz, 0.62)) {
        continue;
      }
      add('standing', px, sc.groundY(px, pz), pz, headingYaw(face + (r() - 0.5) * 50, '+Z'));
      placed++;
    }
    stats[zone] = (stats[zone] ?? 0) + placed;
  };
  // Lanes, pavements and crossings: along the walk graph.
  for (let e = 0; e < w.edges.length; e += 2) {
    const i = w.edges[e];
    const j = w.edges[e + 1];
    const ax = w.vertices[i * 3];
    const az = w.vertices[i * 3 + 2];
    const bx = w.vertices[j * 3];
    const bz = w.vertices[j * 3 + 2];
    const mx = (ax + bx) / 2;
    const mz = (az + bz) / 2;
    if (!streetTileId(tileOf(mx, mz)) || sc.inSquare(mx, mz)) {
      continue;
    }
    const len = Math.hypot(bx - ax, bz - az);
    const hw = Math.max(0.6, (w.halfWidth[i] + w.halfWidth[j]) / 2);
    // Walkers come in groups (1.84 people on average), standers alone: about 1.5 people per placement.
    const want = (density(mx, mz) * len * Math.max(1.2, hw * 2)) / 1.5;
    if (want <= 0) {
      continue;
    }
    let cnt = Math.floor(want);
    if (r() < want - cnt) {
      cnt++;
    }
    const tx = (bx - ax) / (len || 1);
    const tz = (bz - az) / (len || 1);
    const market = Math.hypot(mx - P11[0], mz - P11[1]) < FISH_REACH;
    for (let q = 0; q < cnt; q++) {
      for (let attempt = 0; attempt < 8; attempt++) {
        const f = r() * len;
        const o = (r() * 2 - 1) * hw * 0.92;
        const x = ax + tx * f - tz * o;
        const z = az + tz * f + tx * o;
        if (blocked(x, z) || !plan.occupied.free(x, z, 0.55) || !taken.free(x, z, market ? 0.62 : 0.75)) {
          continue;
        }
        const dir = r() < 0.5 ? 1 : -1;
        const h = ((Math.atan2(tx * dir, -tz * dir) * 180) / Math.PI + 360) % 360;
        person(x, z, h + (r() - 0.5) * 16, market ? 0.55 : 0.68);
        break;
      }
    }
  }
  // The arrival square: flows along the desire lines, waiting clusters, talking groups, sitters on the quay edge and a
  // sparse scatter (about 0.04 / m² in all, 20+ in view at c02 / c04).
  const sq = sc.square;
  const wear = wearPlan(a);
  if (sq.length >= 6) {
    for (const d of wear.desire) {
      const P = d.pts;
      for (let k = 2; k < P.length; k += 2) {
        const ax = P[k - 2];
        const az = P[k - 1];
        const len = Math.hypot(P[k] - ax, P[k + 1] - az);
        const tx = (P[k] - ax) / len;
        const tz = (P[k + 1] - az) / len;
        // Groups every ~3.5 m of line at weight 1.
        const groups = Math.round((len / 3.5) * d.weight);
        for (let q = 0; q < groups; q++) {
          const f = r() * len;
          const o = (r() + r() + r() - 1.5) * 2.4;
          const x = ax + tx * f - tz * o;
          const z = az + tz * f + tx * o;
          // The ends are the gates, where the waiting clusters stand and the lines converge.
          const ends = Math.min(Math.hypot(x - P[0], z - P[1]), Math.hypot(x - P[P.length - 2], z - P[P.length - 1]));
          if (!pointInRing(sq, x, z) || ends < 7) {
            continue;
          }
          // Towards the crossing / bus stop more often than back (arrivals from the ferries).
          const dir = r() < 0.6 ? 1 : -1;
          const h = ((Math.atan2(tx * dir, -tz * dir) * 180) / Math.PI + 360 + (r() - 0.5) * 12) % 360;
          stats.square += walkGroup(x, z, h, groupSize());
        }
      }
    }
    for (const g of wear.gates) {
      // The 1926 pier's gate is the centre of the c01 telephoto: a few people only, as in the photo.
      const n = g.id === 'busStop' ? 11 : g.id === 'crossing' ? 9 : g.id === 'pier1926' ? 5 : 14;
      // Stand back from the gate (bus stop: at the kerb) and face it.
      const back = g.id === 'busStop' ? 1.8 : g.id === 'crossing' ? 1.2 : g.id === 'pier1926' ? 2.5 : 4.5;
      waitCluster(g.x - g.faceX * back, g.z - g.faceZ * back, g.faceX, g.faceZ, n, g.id === 'crossing' ? 2.2 : 3.2, `wait:${g.id}`);
    }
    // Talking groups and a sparse scatter over the open square.
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (let k = 0; k < sq.length; k += 2) {
      minX = Math.min(minX, sq[k]);
      maxX = Math.max(maxX, sq[k]);
      minZ = Math.min(minZ, sq[k + 1]);
      maxZ = Math.max(maxZ, sq[k + 1]);
    }
    for (let k = 0; k < 30; k++) {
      const x = minX + r() * (maxX - minX);
      const z = minZ + r() * (maxZ - minZ);
      if (pointInRing(sq, x, z)) {
        stats.square += talkGroup(x, z, 2 + Math.floor(r() * 3));
      }
    }
    for (let k = 0; k < 110; k++) {
      const x = minX + r() * (maxX - minX);
      const z = minZ + r() * (maxZ - minZ);
      if (!pointInRing(sq, x, z) || blocked(x, z) || !plan.occupied.free(x, z, 0.55) || !taken.free(x, z, 0.8)) {
        continue;
      }
      const tg = wear.gates[Math.floor(r() * wear.gates.length)] ?? { x: 236, z: 5944 };
      const h = ((Math.atan2(tg.x - x, -(tg.z - z)) * 180) / Math.PI + 360 + (r() - 0.5) * 40) % 360;
      person(x, z, h, 0.6);
      stats.square++;
    }
    // Sitting on the quay edge, legs over the water, facing the sea (alone or in pairs).
    let sitters = 0;
    for (const l of a.data.lines) {
      if (l.kind !== 'natural=coastline') {
        continue;
      }
      for (let k = 2; k < l.pts.length && sitters < 14; k += 2) {
        const ax = l.pts[k - 2];
        const az = l.pts[k - 1];
        const len = Math.hypot(l.pts[k] - ax, l.pts[k + 1] - az);
        if (len < 1) {
          continue;
        }
        const tx = (l.pts[k] - ax) / len;
        const tz = (l.pts[k + 1] - az) / len;
        let nx = tz;
        let nz = -tx;
        const mx = ax + tx * len * 0.5;
        const mz = az + tz * len * 0.5;
        if (a.land(mx + nx * 1.5, mz + nz * 1.5) < a.land(mx - nx * 1.5, mz - nz * 1.5)) {
          nx = -nx;
          nz = -nz;
        }
        for (let f = 2 + r() * 6; f < len - 1 && sitters < 14; f += 4 + r() * 9) {
          const ex = ax + tx * f;
          const ez = az + tz * f;
          const x = ex + nx * 0.18;
          const z = ez + nz * 0.18;
          const inland = [ex + nx * 1.2, ez + nz * 1.2] as const;
          // Between the quay posts (0.7 m in, every 3 m) and clear of the bench row.
          if (!pointInRing(sq, inland[0], inland[1]) || inCameraView(x, z) || !plan.occupied.free(x, z, 0.5) || !plan.occupied.free(inland[0], inland[1], 0.6) || !taken.claim(x, z, 0.55)) {
            continue;
          }
          const yaw = headingYaw((Math.atan2(-nx, nz) * 180) / Math.PI, '+Z');
          const seat = sc.groundY(inland[0], inland[1]);
          add('sitting', x, seat - 0.45, z, yaw);
          sitters++;
          if (r() < 0.45) {
            const px = x + tx * 0.62;
            const pz = z + tz * 0.62;
            if (!inCameraView(px, pz) && taken.claim(px, pz, 0.5)) {
              add('sitting', px, seat - 0.45, pz, yaw);
              sitters++;
            }
          }
        }
      }
    }
    stats.quaySitters = sitters;
  }
  // Tram stops: a waiting group on the stop's pavement, 1-2.5 m behind the kerb, facing the (corrected) track.
  for (const p of a.data.points) {
    if (p.kind !== 'railway=tram_stop' || !streetTileId(tileOf(p.x, p.z))) {
      continue;
    }
    let best: [number, number, number, number] | null = null;
    for (const tr of sc.tram) {
      for (let k = 2; k < tr.pts.length; k += 2) {
        const ax = tr.pts[k - 2];
        const az = tr.pts[k - 1];
        const bx = tr.pts[k];
        const bz = tr.pts[k + 1];
        const d = segDist(p.x, p.z, ax, az, bx, bz);
        if (d < 8 && (!best || d < Math.hypot(best[0] - p.x, best[1] - p.z))) {
          const len = Math.hypot(bx - ax, bz - az) || 1;
          best = [(ax + bx) / 2, (az + bz) / 2, (bx - ax) / len, (bz - az) / len];
        }
      }
    }
    if (!best) {
      continue;
    }
    const [cx, cz, tx, tz] = best;
    // The pavement side: the normal whose side is off the carriageway.
    let nx = -tz;
    let nz = tx;
    if (s.distance(cx + nx * 3, cz + nz * 3) < s.distance(cx - nx * 3, cz - nz * 3)) {
      nx = -nx;
      nz = -nz;
    }
    let off = 1.5;
    for (let o = 1; o < 6; o += 0.1) {
      if (s.distance(cx + nx * o, cz + nz * o) > 0.9) {
        off = o;
        break;
      }
    }
    for (const along of [-9, -5, 4, 8, 12]) {
      waitCluster(cx + tx * along + nx * (off + 0.6), cz + tz * along + nz * (off + 0.6), -nx, -nz, 2 + Math.floor(r() * 2), 1.4, 'wait:tram');
    }
  }
  // Seated people on café chairs and benches near the strip.
  const seats = plan.seats.filter((q) => sc.spineDist(q.x, q.z) < 30 || sc.inSquare(q.x, q.z) || Math.hypot(q.x - P11[0], q.z - P11[1]) < FISH_REACH);
  for (const q of seats) {
    if (r() < SEATED_SHARE) {
      add('sitting', q.x, q.y, q.z, q.yaw);
      taken.add(q.x, q.z);
    }
  }
  return { plan: { people, stats }, taken, blocked, add, r };
}

function crowdState(a: AreaContext): CrowdState {
  let p = a.shared.get('streetCrowd') as CrowdState | undefined;
  if (!p) {
    p = planCrowd(a);
    a.shared.set('streetCrowd', p);
  }
  return p;
}

/** The crowd placed so far (the planned people plus the browsers of the tiles emitted). */
export function crowdPlan(a: AreaContext): CrowdPlan {
  return crowdState(a).plan;
}

/** Browsing people in front of this tile's stalls and shop windows (they need the façade step's placements). */
function browsers(t: TileContext, st: CrowdState): XYZ[] {
  const sc = streetContext(t.area);
  const out: XYZ[] = [];
  const stand = (x: number, z: number, faceX: number, faceZ: number): void => {
    if (!inTile(t, x, z) || st.blocked(x, z) || !st.taken.claim(x, z, 0.6)) {
      return;
    }
    const h = ((Math.atan2(faceX, -faceZ) * 180) / Math.PI + 360) % 360;
    st.add('standing', x, sc.groundY(x, z), z, headingYaw(h + (st.r() - 0.5) * 30, '+Z'));
    st.plan.stats.browsing++;
    st.plan.stats.standing--;
    out.push([x, 0, z]);
  };
  for (const i of t.instances.list) {
    if (!i.asset.startsWith('fac_stall')) {
      continue;
    }
    // Prop front (+Z) in world: the instance rotation is a yaw quaternion.
    const [, qy, , qw] = i.rotation;
    const yaw = 2 * Math.atan2(qy, qw);
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const n = st.r() < 0.35 ? 2 : st.r() < 0.8 ? 1 : 0;
    for (let k = 0; k < n; k++) {
      const side = (st.r() - 0.5) * 1.8;
      const d = 1.55 + 0.6 + 0.4 * st.r();
      stand(i.position[0] + fx * d + fz * side, i.position[2] + fz * d - fx * side, -fx, -fz);
    }
  }
  // Window shoppers beside shop doors on the strip.
  for (const d of t.manifest.doors) {
    if (sc.spineDist(d.position[0], d.position[2]) > 14 || st.r() > 0.3) {
      continue;
    }
    const [nx, , nz] = d.normal;
    const side = (st.r() < 0.5 ? -1 : 1) * (0.9 + 0.6 * st.r());
    const dist = 0.7 + 0.35 * st.r();
    stand(d.position[0] + nx * dist - nz * side, d.position[2] + nz * dist + nx * side, -nx, -nz);
  }
  return out;
}

export const streetCrowdStep: CompileStep = {
  id: 'streetCrowd',
  prepare(a) {
    crowdState(a);
  },
  tile(t) {
    const st = crowdState(t.area);
    const before = st.plan.people.length;
    browsers(t, st);
    const stalls = t.instances.list.filter((i) => i.asset.startsWith('fac_stall')).map((i) => i.position);
    let n = 0;
    st.plan.people.forEach((p, k) => {
      if (!inTile(t, p.pos[0], p.pos[2])) {
        return;
      }
      // Planned walkers and standers do not stand in a stall (browsers were placed clear of them).
      if (k < before && !p.variant?.startsWith('sitting') && stalls.some((q) => Math.hypot(q[0] - p.pos[0], q[2] - p.pos[2]) < 1.4)) {
        return;
      }
      t.place(p.prop, p.pos, p.yaw, { variant: p.variant, scale: p.scale, ref: p.ref, seed: p.seed });
      n++;
    });
    if (n) {
      t.record('streetCrowd', { people: n });
    }
  },
  finish(a) {
    console.error(`[street] crowd ${JSON.stringify(crowdPlan(a).stats)} total ${crowdPlan(a).people.length}`);
  },
};
