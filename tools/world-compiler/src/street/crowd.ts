/**
 * Placeholder pedestrians (format 1): neutral procedural people (kit-props.ts st_person: palettes x standing /
 * walking / sitting poses, static meshes) as prop instances, to be replaced by the MetaHuman crowd. Densities follow
 * s1-strip.md §4 by zone, with no global cap:
 * - the fish / produce end (within FISH_REACH of P11 on pedestrian lanes, including Güneşlibahçe Sk and Yağlıkçı
 *   İsmail Sk in tiles 3_61 / 4_61): 0.45 / m² near the junction, 0.2–0.32 / m² further down the market lanes;
 * - Yasa Cd (the spine lane): 0.15 / m²;
 * - the arrival square: 0.045 / m² over its whole polygon (≈ 380 people, 20+ in view at c02 / c04), walkers heading
 *   for the piers, the crossing and the bus stop;
 * - Rıhtım Cd pavements and crossings near the spine: 0.06 / m².
 * Walkers go along the walk graph (both directions, a third of them in pairs), standers face anywhere. Per tile,
 * people also browse 0.6–1.0 m in front of stalls and shop windows (facing them), and sit on 65 % of the café
 * chairs and benches near the strip. Nobody spawns inside a building, inside or within 0.8 m of a hero's outline
 * (the pier loggias are gated), within 0.35 m of a wall or in the clear foreground of an eye-level reference camera. Heights vary with the instance scale (0.92-1.08 of
 * 1.75 m); `seed` lets runtimes vary them further. Instance refs start with "crowd/" so a runtime can swap them for
 * animated agents.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pointInRing, segDist } from '../../../../src/world/osm/shared/geometry';
import { ROOT } from '../../lib/areas.mjs';
import { Spacing } from '../../../../src/world/osm/streets/sink';
import type { XYZ } from '../format';
import type { HeroShared } from '../hero';
import { headingYaw } from '../instances';
import { interiorDoorViews } from '../interiors';
import type { AreaContext, CompileStep, TileContext } from '../registry';
import { inTile, rng, streetContext } from './common';
import { streetPlan, type Placement } from './furniture';
import { PERSON_PALETTES } from './kit-props';

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
  // Eye-level reference cameras keep a clear foreground: no spawn within 2.8 m or in a 10 m wedge ahead of them.
  const cams = [...eyeCameras(), ...interiorDoorViews(a)];
  const inCameraView = (x: number, z: number): boolean =>
    cams.some((c) => {
      const dx = x - c.x;
      const dz = z - c.z;
      if (Math.hypot(dx, dz) < 2.8) {
        return true;
      }
      const along = dx * c.fx + dz * c.fz;
      const side = Math.abs(-dx * c.fz + dz * c.fx);
      return along > 0 && along < 10 && side < 0.8 + 0.35 * along;
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
  /** A walker (sometimes with a companion beside them) or a stander at (x, z), heading `h` degrees. */
  const person = (x: number, z: number, h: number, walkShare: number): void => {
    const walking = r() < walkShare;
    add(walking ? 'walking' : 'standing', x, sc.groundY(x, z), z, headingYaw(walking ? h : r() * 360, '+Z'));
    if (walking && r() < 0.33) {
      const rad = (h * Math.PI) / 180;
      const side = r() < 0.5 ? 1 : -1;
      // Right of the heading is (cos h, sin h) in (x, z).
      const cx = x + Math.cos(rad) * 0.62 * side;
      const cz = z + Math.sin(rad) * 0.62 * side;
      if (!blocked(cx, cz) && taken.claim(cx, cz, 0.5)) {
        add('walking', cx, sc.groundY(cx, cz), cz, headingYaw(h + (r() - 0.5) * 8, '+Z'));
      }
    }
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
    const want = density(mx, mz) * len * Math.max(1.2, hw * 2);
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
        if (blocked(x, z) || !plan.occupied.free(x, z, 0.55) || !taken.claim(x, z, market ? 0.62 : 0.75)) {
          continue;
        }
        const dir = r() < 0.5 ? 1 : -1;
        const h = ((Math.atan2(tx * dir, -tz * dir) * 180) / Math.PI + 360) % 360;
        person(x, z, h + (r() - 0.5) * 16, market ? 0.55 : 0.68);
        break;
      }
    }
  }
  // The arrival square: uniform over its polygon, walkers heading for the piers, the crossing and the bus stop.
  const sq = sc.square;
  if (sq.length >= 6) {
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
    const cell = Math.sqrt(1 / 0.045);
    const targets: [number, number][] = [
      [200, 5930],
      [232, 5880],
      [spine[4] ?? 284, spine[5] ?? 5940],
      [spine[0] ?? 236, spine[1] ?? 5944],
    ];
    for (let x = minX + cell / 2; x < maxX; x += cell) {
      for (let z = minZ + cell / 2; z < maxZ; z += cell) {
        for (let attempt = 0; attempt < 3; attempt++) {
          const px = x + (r() - 0.5) * cell;
          const pz = z + (r() - 0.5) * cell;
          if (!pointInRing(sq, px, pz) || blocked(px, pz) || !plan.occupied.free(px, pz, 0.55) || !taken.claim(px, pz, 0.8)) {
            continue;
          }
          const tg = targets[Math.floor(r() * targets.length)];
          const h = ((Math.atan2(tg[0] - px, -(tg[1] - pz)) * 180) / Math.PI + 360 + (r() - 0.5) * 30) % 360;
          person(px, pz, h, 0.7);
          stats.square++;
          break;
        }
      }
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

/** Eye-level cameras of tools/world-compiler/s1/cameras.json (position and horizontal forward), none when absent. */
function eyeCameras(): { x: number; z: number; fx: number; fz: number }[] {
  const file = resolve(ROOT, 'tools/world-compiler/s1/cameras.json');
  if (!existsSync(file)) {
    return [];
  }
  const doc = JSON.parse(readFileSync(file, 'utf8')) as { cameras?: { position: number[]; target: number[]; heightAboveGround?: number }[] };
  return (doc.cameras ?? [])
    .filter((c) => (c.heightAboveGround ?? 1.6) < 3)
    .map((c) => {
      const fx = c.target[0] - c.position[0];
      const fz = c.target[2] - c.position[2];
      const l = Math.hypot(fx, fz) || 1;
      return { x: c.position[0], z: c.position[2], fx: fx / l, fz: fz / l };
    });
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
