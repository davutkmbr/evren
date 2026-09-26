import * as THREE from 'three';
import type { Collider } from '../../../../core/collision';
import { LandUse, type GeoQuery } from '../../../../core/contracts';
import { headingToYaw } from '../../../../core/geo-coords';
import type { LocalCollider } from '../gen/types';

export interface Placement {
  x: number;
  y: number;
  z: number;
  /** Rotation around +Y (Object3D.rotation.y). */
  yaw: number;
  scale: number;
}

const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export function placementFromHeading(x: number, y: number, z: number, headingDeg: number, scale = 1): Placement {
  return { x, y, z, yaw: headingToYaw(headingDeg), scale };
}

export function placementMatrix(p: Placement, out: THREE.Matrix4): THREE.Matrix4 {
  _q.setFromAxisAngle(UP, p.yaw);
  _p.set(p.x, p.y, p.z);
  _s.setScalar(p.scale);
  return out.compose(_p, _q, _s);
}

/** Model-space point -> world (x, z) for a placement. */
function toWorld(p: Placement, lx: number, ly: number, lz: number, out: THREE.Vector3): THREE.Vector3 {
  const c = Math.cos(p.yaw);
  const s = Math.sin(p.yaw);
  const k = p.scale;
  return out.set(p.x + (lx * c + lz * s) * k, p.y + ly * k, p.z + (-lx * s + lz * c) * k);
}

export function worldColliders(local: readonly LocalCollider[], p: Placement, filter?: (c: LocalCollider) => boolean): Collider[] {
  const out: Collider[] = [];
  const k = p.scale;
  for (const c of local) {
    if (filter && !filter(c)) {
      continue;
    }
    if (c.kind === 'box') {
      out.push({ kind: 'box', center: toWorld(p, c.cx, c.cy, c.cz, new THREE.Vector3()), halfSize: new THREE.Vector3(c.hx * k, c.hy * k, c.hz * k), yaw: p.yaw + c.yaw });
    } else if (c.kind === 'cylinder') {
      out.push({ kind: 'cylinder', base: toWorld(p, c.x, c.y, c.z, new THREE.Vector3()), radius: c.r * k, height: c.h * k });
    } else if (c.kind === 'prism') {
      const ring = new Float32Array(c.ring.length);
      const v = new THREE.Vector3();
      for (let i = 0; i < c.ring.length; i += 2) {
        toWorld(p, c.ring[i], 0, c.ring[i + 1], v);
        ring[i] = v.x;
        ring[i + 1] = v.z;
      }
      out.push({ kind: 'prism', rings: [ring], bottom: p.y + c.bottom * k, top: p.y + c.top * k });
    } else {
      out.push({ kind: 'sphere', center: toWorld(p, c.x, c.y, c.z, new THREE.Vector3()), radius: c.r * k });
    }
  }
  return out;
}

function hash3(a: number, b: number, c: number): number {
  let h = Math.imul(Math.round(a * 10) | 0, 0x27d4eb2d) ^ Math.imul(Math.round(b * 10) | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** The pad itself is LandUse.Landmark, so the quarter is judged from the district style and a ring around the pad. */
function isHistoric(geo: GeoQuery, site: { x: number; z: number; radius: number }): boolean {
  if (geo.districtAt(site.x, site.z)?.style === 'historic') {
    return true;
  }
  let votes = 0;
  const r = site.radius + 30;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    if (geo.landUseAt(site.x + Math.cos(a) * r, site.z + Math.sin(a) * r) === LandUse.HistoricUrban) {
      votes++;
    }
  }
  return votes >= 3;
}

export interface SiteChoice {
  variant: number;
  scale: number;
}

/**
 * Picks a neighbourhood prototype for a site: the larger prototypes that fit the reserved pad are preferred (weighted
 * by the site's size), hipped-roof mescits are more common in the historic quarters.
 */
export function chooseVariant(site: { x: number; z: number; radius: number; size: number }, footprints: readonly number[], pitched: readonly boolean[], geo: GeoQuery | null): SiteChoice {
  const historic = geo ? isHistoric(geo, site) : false;
  const r0 = hash3(site.x, site.z, 1);
  const r1 = hash3(site.x, site.z, 2);
  const r2 = hash3(site.x, site.z, 3);
  const fits: number[] = [];
  for (let i = 0; i < footprints.length; i++) {
    if (footprints[i] * 0.9 <= site.radius + 1.5) {
      fits.push(i);
    }
  }
  if (fits.length === 0) {
    let best = 0;
    for (let i = 1; i < footprints.length; i++) {
      if (footprints[i] < footprints[best]) {
        best = i;
      }
    }
    fits.push(best);
  }
  const wantPitched = r0 < (historic ? 0.3 : 0.08);
  let pool = fits.filter((i) => pitched[i] === wantPitched);
  if (pool.length === 0) {
    pool = fits;
  }
  pool.sort((a, b) => footprints[a] - footprints[b]);
  const bias = Math.min(1, Math.max(0, 0.35 + site.size * 0.8));
  const pick = Math.min(pool.length - 1, Math.floor(Math.pow(r1, 1 - bias * 0.7) * pool.length));
  const variant = pool[pick];
  const fitScale = Math.min(1.12, Math.max(0.86, (site.radius + 1.5) / footprints[variant]));
  const scale = Math.min(fitScale, 0.94 + r2 * 0.12);
  return { variant, scale };
}
