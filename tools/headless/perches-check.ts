/**
 * Headless viewpoint check (phase 03): resolves every perch against the real GeoQuery, builds the landmark each
 * perch sits on with its real builder (structures / mosques) and verifies the grip point against the built geometry.
 *
 *   npx tsx tools/headless/perches-check.ts
 *
 * Checks per perch:
 * - the placement rules (src/world/perches/rules.ts): on a structure, at least 20 m above the ground, over the
 *   neighbour envelope within 40 m, the view along the heading open (the service drops a perch that fails them);
 * - structures: y within 1.5 m of the built mesh top at the grip point (downward ray over the most detailed LOD);
 *   the collider top there is printed and flagged when the dragon would sit inside a collider;
 * - the built structure itself does not rise over the grip within the neighbour radius outside the grip area.
 * Exits with code 1 on any failure.
 */
import * as THREE from 'three';
import type { GeoQuery, LandmarkDef, PerchPoint } from '../../src/core/contracts';
import { buildLandmarkModel } from '../../src/world/landmarks/mosques/gen/build';
import { placementFromHeading, placementMatrix } from '../../src/world/landmarks/mosques/system/placement';
import { StructureBuild } from '../../src/world/landmarks/structures/build/context';
import { builderFor } from '../../src/world/landmarks/structures/builders/registry';
import { prepareSite } from '../../src/world/landmarks/structures/system/site-planner';
import type { ColliderData } from '../../src/world/landmarks/structures/types';
import { PERCH_DATA } from '../../src/world/perches/data';
import { resolvePerch } from '../../src/world/perches/resolve';
import { neighbourEnvelope, PERCH_RULES, validatePerch, viewBlocker } from '../../src/world/perches/rules';
import { buildPerchService } from '../../src/world/perches/service';
import { buildHeadlessGeo } from './geo';

const TOP_TOLERANCE = 1.5;

/** World-space triangle soup plus colliders of one built landmark. */
interface Built {
  tris: Float32Array[];
  colliders: ColliderData[];
  source: string;
}

function trianglesOf(position: Float32Array, index: Uint32Array, m?: THREE.Matrix4): Float32Array {
  const out = new Float32Array(index.length * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < index.length; i++) {
    const k = index[i] * 3;
    v.set(position[k], position[k + 1], position[k + 2]);
    if (m) {
      v.applyMatrix4(m);
    }
    out[i * 3] = v.x;
    out[i * 3 + 1] = v.y;
    out[i * 3 + 2] = v.z;
  }
  return out;
}

function buildStructure(def: LandmarkDef, geo: GeoQuery): Built {
  const b = new StructureBuild(prepareSite(def, geo));
  builderFor(b.def)(b);
  const r = b.result(0);
  const tris = r.parts.map((p) => trianglesOf(p.lods[0].position, p.lods[0].index));
  return { tris, colliders: r.colliders, source: 'structures builder' };
}

function buildMosque(def: LandmarkDef): Built | null {
  const model = buildLandmarkModel(def.id, [0], { height: def.height, radius: def.radius });
  const g = model?.lods[0];
  if (!model || !g) {
    return null;
  }
  const p = placementFromHeading(def.x, def.y, def.z, def.headingDeg);
  const m = placementMatrix(p, new THREE.Matrix4());
  const c = Math.cos(p.yaw);
  const s = Math.sin(p.yaw);
  const w = (lx: number, ly: number, lz: number): [number, number, number] => [p.x + lx * c + lz * s, p.y + ly, p.z - lx * s + lz * c];
  const colliders: ColliderData[] = model.colliders.map((k) =>
    k.kind === 'box'
      ? { kind: 'box', center: w(k.cx, k.cy, k.cz), halfSize: [k.hx, k.hy, k.hz], yaw: p.yaw + k.yaw }
      : k.kind === 'cylinder'
        ? { kind: 'cylinder', base: w(k.x, k.y, k.z), radius: k.r, height: k.h }
        : { kind: 'sphere', center: w(k.x, k.y, k.z), radius: k.r },
  );
  return { tris: [trianglesOf(g.position, g.index, m)], colliders, source: 'mosque generator' };
}

/** Highest mesh surface hit by a vertical ray at (x, z), or -Infinity. */
function rayTop(tris: readonly Float32Array[], x: number, z: number): number {
  let best = -Infinity;
  for (const t of tris) {
    for (let i = 0; i < t.length; i += 9) {
      const ax = t[i];
      const az = t[i + 2];
      const bx = t[i + 3];
      const bz = t[i + 5];
      const cx = t[i + 6];
      const cz = t[i + 8];
      if ((x < ax && x < bx && x < cx) || (x > ax && x > bx && x > cx) || (z < az && z < bz && z < cz) || (z > az && z > bz && z > cz)) {
        continue;
      }
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(d) < 1e-9) {
        continue;
      }
      const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
      const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
      const l3 = 1 - l1 - l2;
      if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) {
        continue;
      }
      const y = l1 * t[i + 1] + l2 * t[i + 4] + l3 * t[i + 7];
      if (y > best) {
        best = y;
      }
    }
  }
  return best;
}

/** Mesh top around the grip point: the centre plus a ring of 8 samples (the claws span a small area). */
function meshTop(tris: readonly Float32Array[], p: PerchPoint): number {
  const r = Math.min(1, p.gripRadius * 0.4);
  let top = rayTop(tris, p.x, p.z);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    top = Math.max(top, rayTop(tris, p.x + Math.cos(a) * r, p.z + Math.sin(a) * r));
  }
  return top;
}

/** Top of the highest collider containing (x, z), or -Infinity. Box yaw follows Object3D.rotation.y. */
function colliderTop(colliders: readonly ColliderData[], x: number, z: number): number {
  let best = -Infinity;
  for (const c of colliders) {
    if (c.kind === 'box') {
      const dx = x - c.center[0];
      const dz = z - c.center[2];
      const cs = Math.cos(c.yaw);
      const sn = Math.sin(c.yaw);
      const lx = dx * cs - dz * sn;
      const lz = dx * sn + dz * cs;
      if (Math.abs(lx) <= c.halfSize[0] && Math.abs(lz) <= c.halfSize[2]) {
        best = Math.max(best, c.center[1] + c.halfSize[1]);
      }
    } else if (c.kind === 'cylinder') {
      if (Math.hypot(x - c.base[0], z - c.base[2]) <= c.radius) {
        best = Math.max(best, c.base[1] + c.height);
      }
    } else {
      const d = Math.hypot(x - c.center[0], z - c.center[2]);
      if (d <= c.radius) {
        best = Math.max(best, c.center[1] + Math.sqrt(c.radius * c.radius - d * d));
      }
    }
  }
  return best;
}

/**
 * Highest point of the built structure in front of the dragon (within ±frontAngle of the heading), on rings from
 * just outside the grip area to ownRadius. Behind the dragon the structure may rise (a gallery against its tower).
 */
function ownRise(tris: readonly Float32Array[], p: PerchPoint): { height: number; at: number } {
  let best = { height: -Infinity, at: 0 };
  const heading = (p.headingDeg * Math.PI) / 180;
  const front = (PERCH_RULES.frontAngle * Math.PI) / 180;
  for (let r = p.gripRadius + 4; r <= PERCH_RULES.ownRadius; r += 3) {
    for (let k = 0; k < 32; k++) {
      // Compass bearing of the sample (x = sin, -z = cos), skipped outside the front cone.
      const b = heading + (k / 32 - 0.5) * 2 * Math.PI;
      if (Math.abs(Math.atan2(Math.sin(b - heading), Math.cos(b - heading))) > front) {
        continue;
      }
      const a = Math.atan2(-Math.cos(b), Math.sin(b));
      const t = rayTop(tris, p.x + Math.cos(a) * r, p.z + Math.sin(a) * r);
      if (t > best.height) {
        best = { height: t, at: r };
      }
    }
  }
  return best;
}

const f1 = (v: number): string => (Number.isFinite(v) ? v.toFixed(1) : '-');

function main(): void {
  const t0 = performance.now();
  const geo = buildHeadlessGeo();
  console.log(`geo built in ${Math.round(performance.now() - t0)} ms`);
  const failures: string[] = [];
  const points: PerchPoint[] = [];
  for (const d of PERCH_DATA) {
    try {
      points.push(resolvePerch(geo, d));
    } catch (e) {
      failures.push(`${d.id}: not resolved (${String(e)})`);
    }
  }
  const service = buildPerchService(geo);
  const ids = new Set<string>();
  const built = new Map<string, Built | null>();

  for (const p of points) {
    const fail = (msg: string): void => {
      failures.push(`${p.id}: ${msg}`);
    };
    if (ids.has(p.id)) {
      fail('duplicate id');
    }
    ids.add(p.id);
    if (!p.name || !p.info || p.gripRadius <= 0 || !(p.headingDeg >= 0 && p.headingDeg < 360)) {
      fail('incomplete data (name, info, gripRadius or headingDeg)');
    }
    const terrain = geo.heightAt(p.x, p.z);
    const lines: string[] = [];
    lines.push(`${p.id} [${p.surface}] "${p.name}"`);
    lines.push(`  pos x=${f1(p.x)} y=${f1(p.y)} z=${f1(p.z)}  heading=${p.headingDeg}  grip r=${p.gripRadius}  terrain=${f1(terrain)}  above terrain=${f1(p.y - terrain)}`);
    for (const v of validatePerch(geo, p)) {
      fail(`rule: ${v}`);
    }
    const env = neighbourEnvelope(geo, p.x, p.z, p.landmarkId);
    lines.push(`  above ground ${f1(p.y - Math.max(terrain, 0))} m (min ${PERCH_RULES.minAboveGround})  neighbour envelope ${f1(env.height)} (${env.what}) -> clears by ${f1(p.y - env.height)} m`);
    if (!p.landmarkId) {
      fail('not on a structure (no landmarkId)');
    }

    const def = p.landmarkId ? geo.landmark(p.landmarkId) : undefined;
    if (p.landmarkId && !def) {
      fail(`landmark ${p.landmarkId} missing`);
    }
    if (def) {
      lines.push(`  landmark ${def.id} (${def.builder}): y=${f1(def.y)} height=${def.height}  top est=${f1(def.y + def.height)}`);
    }

    if (def) {
      if (!built.has(def.id)) {
        const b = def.builder === 'structures' ? buildStructure(def, geo) : def.builder === 'mosques' ? buildMosque(def) : null;
        built.set(def.id, b);
      }
      const b = built.get(def.id);
      if (b) {
        const top = meshTop(b.tris, p);
        const ctop = colliderTop(b.colliders, p.x, p.z);
        lines.push(`  built (${b.source}): mesh top=${f1(top)} (y ${p.y - top >= 0 ? '+' : ''}${f1(p.y - top)})  collider top=${f1(ctop)} (y ${p.y - ctop >= 0 ? '+' : ''}${f1(p.y - ctop)})`);
        if (!Number.isFinite(top)) {
          fail('no built geometry under the grip point');
        } else if (Math.abs(p.y - top) > TOP_TOLERANCE) {
          fail(`grip ${f1(p.y - top)} m off the built top`);
        }
        const rise = ownRise(b.tris, p);
        lines.push(`  own structure in front within ${PERCH_RULES.ownRadius} m: top ${f1(rise.height)} at ${rise.at} m (grip ${p.y - rise.height >= 0 ? '+' : ''}${f1(p.y - rise.height)})`);
        if (rise.height > p.y + PERCH_RULES.neighbourMargin) {
          fail(`own structure rises ${f1(rise.height - p.y)} m over the grip ${rise.at} m away`);
        }
        if (Number.isFinite(ctop) && ctop - p.y > 0.5) {
          lines.push(`  WARN collider top is ${f1(ctop - p.y)} m above the grip (the dragon would sit inside the collider)`);
        }
      } else {
        lines.push(`  built: no geometry (the ${def.builder} module has no builder for ${def.id}); y follows the landmark data`);
        if (p.y - terrain < 5 || p.y - terrain > def.height + 5) {
          fail(`unbuilt structure grip ${f1(p.y - terrain)} m above terrain, expected 5..${def.height + 5}`);
        }
      }
    }

    const v = viewBlocker(geo, p);
    const R = PERCH_RULES;
    lines.push(
      `  view cone ±${R.viewSpread}° around ${p.headingDeg}°, ${R.viewFrom}-${R.viewTo} m: ${v ? `BLOCKED by ${v.what} ${f1(v.height)} m at ${v.at} m (${v.bearing}°)` : 'open'}`,
    );
    console.log(lines.join('\n'));
  }

  // service API sanity
  const first = service.points[0];
  if (first) {
    if (service.get(first.id) !== first) {
      failures.push('service.get does not return the point');
    }
    const n = service.nearest(first.x + 10, first.z, 400);
    if (!n || n.point !== first || Math.abs(n.distance - 10) > 1e-6) {
      failures.push('service.nearest wrong');
    }
    if (service.nearest(-1e6, -1e6, 400) !== null) {
      failures.push('service.nearest ignores maxDistance');
    }
  }

  console.log(`\n${points.length} perches (${service.points.length} pass the rules), ${failures.length} failure(s) (${Math.round(performance.now() - t0)} ms)`);
  for (const f of failures) {
    console.log(`FAIL ${f}`);
  }
  process.exit(failures.length > 0 ? 1 : 0);
}

main();
