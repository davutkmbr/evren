/**
 * Placeholder pedestrians (format 1): neutral procedural people (kit-props.ts st_person: palettes x standing /
 * walking / sitting poses, static meshes) as prop instances, to be replaced by the MetaHuman crowd. Placed on the
 * walk graph along the S1 spine and the arrival square (tools/world-compiler/s1/cameras.json), denser towards the
 * fish market (s1-strip.md §4: 0.1-0.2 / m² on Yasa Cd, 0.4-0.6 / m² at the fish end, 20+ in view on the square),
 * plus people on café chairs and benches. Heights vary with the instance scale (0.92-1.08 of 1.75 m); `seed` lets
 * runtimes vary them further. Instance refs start with "crowd/" so a runtime can swap them for animated agents.
 */
import { Spacing } from '../../../../src/world/osm/streets/sink';
import { headingYaw } from '../instances';
import type { AreaContext, CompileStep } from '../registry';
import { inTile, rng, streetContext } from './common';
import { streetPlan, type Placement } from './furniture';
import { PERSON_PALETTES } from './kit-props';

/** Target crowd (people) on the strip; seats come on top. */
const TARGET = 210;
const SEATED = 26;

export interface CrowdPlan {
  people: Placement[];
  stats: Record<string, number>;
}

export function planCrowd(a: AreaContext): CrowdPlan {
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
  /** People per m² wanted at (x, z); 0 outside the strip. */
  const density = (x: number, z: number): number => {
    const inSq = sc.inSquare(x, z);
    const d = sc.spineDist(x, z);
    if (!inSq && d > 9) {
      return 0;
    }
    const toFish = Math.hypot(x - P11[0], z - P11[1]);
    if (toFish < 22) {
      return 0.45;
    }
    const onYasa = Math.hypot(x - P8[0], z - P8[1]) < 150 && d < 6 && s.pedestrianStreet(x, z);
    if (onYasa) {
      return 0.14;
    }
    return inSq ? 0.035 : 0.05;
  };
  // Candidate edges with their wanted counts.
  const edges: { a: number; b: number; len: number; want: number }[] = [];
  let total = 0;
  for (let e = 0; e < w.edges.length; e += 2) {
    const i = w.edges[e];
    const j = w.edges[e + 1];
    const ax = w.vertices[i * 3];
    const az = w.vertices[i * 3 + 2];
    const bx = w.vertices[j * 3];
    const bz = w.vertices[j * 3 + 2];
    const mx = (ax + bx) / 2;
    const mz = (az + bz) / 2;
    if (!streetTileId(tileOf(mx, mz))) {
      continue;
    }
    const len = Math.hypot(bx - ax, bz - az);
    const width = Math.max(1.2, w.halfWidth[i] + w.halfWidth[j]);
    const want = density(mx, mz) * len * width;
    if (want > 0) {
      edges.push({ a: i, b: j, len, want });
      total += want;
    }
  }
  const scale = total > 0 ? TARGET / total : 0;
  const r = rng(4711);
  const taken = new Spacing(4);
  const people: Placement[] = [];
  const stats: Record<string, number> = { walking: 0, standing: 0, sitting: 0 };
  const palettes = PERSON_PALETTES.length;
  const add = (pose: 'walking' | 'standing' | 'sitting', x: number, y: number, z: number, yaw: number): void => {
    const k = Math.floor(r() * (pose === 'sitting' ? 6 : palettes));
    people.push({ prop: 'st_person', variant: `${pose}${k}`, pos: [x, y, z], yaw, scale: pose === 'sitting' ? 0.96 + r() * 0.08 : 0.92 + r() * 0.16, ref: `crowd/${people.length}`, seed: Math.floor(r() * 1e6) });
    stats[pose]++;
  };
  for (const e of edges) {
    const n = e.want * scale;
    let cnt = Math.floor(n);
    if (r() < n - cnt) {
      cnt++;
    }
    const ax = w.vertices[e.a * 3];
    const az = w.vertices[e.a * 3 + 2];
    const bx = w.vertices[e.b * 3];
    const bz = w.vertices[e.b * 3 + 2];
    const tx = (bx - ax) / (e.len || 1);
    const tz = (bz - az) / (e.len || 1);
    const hw = Math.max(0.6, (w.halfWidth[e.a] + w.halfWidth[e.b]) / 2);
    for (let q = 0; q < cnt; q++) {
      for (let attempt = 0; attempt < 6; attempt++) {
        const f = r() * e.len;
        const o = (r() * 2 - 1) * hw * 0.9;
        const x = ax + tx * f - tz * o;
        const z = az + tz * f + tx * o;
        if (fp.inside(x, z) || s.buildingDistance(x, z) < 0.35 || a.land(x, z) < 0.5 || (s.distance(x, z) < 0 && !s.pedestrianStreet(x, z)) || !plan.occupied.free(x, z, 0.55) || !taken.claim(x, z, 0.75)) {
          continue;
        }
        const walking = r() < 0.68;
        const dir = r() < 0.5 ? 1 : -1;
        const h = ((Math.atan2(tx * dir, -tz * dir) * 180) / Math.PI + 360) % 360;
        add(walking ? 'walking' : 'standing', x, sc.groundY(x, z), z, headingYaw(walking ? h : r() * 360, '+Z'));
        break;
      }
    }
  }
  // Seated people on café chairs and benches near the strip.
  const seats = plan.seats.filter((q) => sc.spineDist(q.x, q.z) < 25 || sc.inSquare(q.x, q.z));
  let seated = 0;
  for (const q of seats) {
    if (seated >= SEATED) {
      break;
    }
    if (r() < 0.55) {
      add('sitting', q.x, q.y, q.z, q.yaw);
      seated++;
    }
  }
  stats.total = people.length;
  return { people, stats };
}

export function crowdPlan(a: AreaContext): CrowdPlan {
  let p = a.shared.get('streetCrowd') as CrowdPlan | undefined;
  if (!p) {
    p = planCrowd(a);
    a.shared.set('streetCrowd', p);
  }
  return p;
}

export const streetCrowdStep: CompileStep = {
  id: 'streetCrowd',
  prepare(a) {
    crowdPlan(a);
  },
  tile(t) {
    const others = t.instances.list.filter((i) => i.asset.startsWith('fac_stall')).map((i) => i.position);
    let n = 0;
    for (const p of crowdPlan(t.area).people) {
      if (inTile(t, p.pos[0], p.pos[2]) && !others.some((q) => Math.hypot(q[0] - p.pos[0], q[2] - p.pos[2]) < 1.2)) {
        t.place(p.prop, p.pos, p.yaw, { variant: p.variant, scale: p.scale, ref: p.ref, seed: p.seed });
        n++;
      }
    }
    if (n) {
      t.record('streetCrowd', { people: n });
    }
  },
  finish(a) {
    console.error(`[street] crowd ${JSON.stringify(crowdPlan(a).stats)}`);
  },
};
