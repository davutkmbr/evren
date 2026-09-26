/**
 * Shared pieces of the headless scene budget (tools/headless/scene-budget.ts): the probe cameras, view / mirror
 * frusta, the shadow cascade split estimate and the report shapes every module probe fills.
 */
import * as THREE from 'three';
import type { GeoQuery } from '../../../src/core/contracts';
import { latLonToLocal } from '../../../src/core/geo-coords';
import { QUALITY_PRESETS, type QualitySettings } from '../../../src/core/quality';
import { CascadedSunShadow } from '../../../src/render/sky/cascaded-shadow';

export interface ProbeView {
  id: string;
  label: string;
  x: number;
  y: number;
  z: number;
  headingDeg: number;
  pitchDeg: number;
}

function view(id: string, label: string, lat: number, lon: number, y: number, headingDeg: number, pitchDeg: number): ProbeView {
  const p = latLonToLocal(lat, lon);
  return { id, label, x: p.x, y, z: p.z, headingDeg, pitchDeg };
}

/** The four probe cameras of the budget (Karaköy, mid Bosphorus, Kadıköy, high overview). */
export const PROBE_VIEWS: ProbeView[] = [
  view('karakoy', 'Karaköy (150 m, looking SE over the Bosphorus mouth)', 41.0228, 28.9765, 150, 130, -6),
  view('bosphorus', 'Bosphorus mid, Bebek (120 m, looking N)', 41.0745, 29.0465, 120, 20, -3),
  view('kadikoy', 'Kadıköy (140 m, looking NW to the historic peninsula)', 40.9905, 29.0255, 140, 300, -5),
  view('overview', 'High overview (2600 m, the yuksek preset)', 41.0205, 28.9905, 2600, 45, -8),
];

/** The render camera of the game (core/engine.ts): 60° vertical fov, 0.1 .. 60 km; 1600x900. */
export function probeCamera(v: ProbeView): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 60000);
  cam.position.set(v.x, v.y, v.z);
  cam.rotation.order = 'YXZ';
  cam.rotation.set(THREE.MathUtils.degToRad(v.pitchDeg), -THREE.MathUtils.degToRad(v.headingDeg), 0);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  return cam;
}

const _m = new THREE.Matrix4();
const _mirror = new THREE.Matrix4().makeScale(1, -1, 1);

/** Frustum of the main camera and of its planar water mirror (reflection about y = 0, as the terrain does it). */
export function frusta(cam: THREE.PerspectiveCamera): { main: THREE.Frustum; mirror: THREE.Frustum } {
  _m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  const main = new THREE.Frustum().setFromProjectionMatrix(_m);
  _m.multiply(_mirror);
  const mirror = new THREE.Frustum().setFromProjectionMatrix(_m);
  return { main, mirror };
}

export function qualityHigh(): QualitySettings {
  return { ...QUALITY_PRESETS.high };
}

/**
 * Cascade split distances (m, view distance) of the key-light shadow for a camera altitude, exactly as the sky
 * system sets them (shadowDistance stretched with altitude in x1.25 steps, CascadedSunShadow.setDistance).
 */
export function cascadeSplits(q: QualitySettings, cameraY: number): number[] {
  const shadow = new CascadedSunShadow();
  shadow.setActiveCascades(q.preset === 'low' ? 2 : q.preset === 'medium' ? 3 : 4);
  const base = q.shadowDistance;
  const want = Math.max(base, Math.min(Math.max(cameraY, 1) * 1.8, base * 2));
  const distance = base * Math.pow(1.25, Math.ceil(Math.log(want / base) / Math.log(1.25) - 1e-6));
  shadow.setDistance(distance);
  const splits = (shadow as unknown as { splits: number[] }).splits;
  const n = shadow.activeCascades;
  return [0, ...splits.slice(1, n + 1)];
}

/**
 * Estimated number of cascades a caster is drawn into: cascades whose view-distance slice overlaps the caster's
 * distance range [d - r, d + r] (the receiver-aware culling of CascadeFrustum keeps roughly this), and only when its
 * sphere, grown by a typical shadow length, touches the view frustum. Like CascadeFrustum, a caster wholly below the
 * lowest receiver of a slice (its lowest corner; 0 when the mirrored reflection view may sample it) is skipped there
 * (sun above the horizon). An estimate, not the exact light-space test.
 */
export function cascadesFor(splits: number[], viewFrustum: THREE.Frustum, cam: THREE.PerspectiveCamera, center: THREE.Vector3, radius: number, shadowReach = 150, top = center.y + radius): number {
  const d = cam.position.distanceTo(center);
  const far = splits[splits.length - 1];
  if (d - radius > far) {
    return 0;
  }
  _sphere.center.copy(center);
  _sphere.radius = radius + shadowReach;
  if (!viewFrustum.intersectsSphere(_sphere)) {
    return 0;
  }
  let n = 0;
  for (let i = 0; i + 1 < splits.length; i++) {
    if (d + radius >= splits[i] && d - radius <= splits[i + 1] && top >= sliceMinY(cam, Math.max(splits[i], cam.near), splits[i + 1])) {
      n++;
    }
  }
  return n;
}

const _corner = new THREE.Vector3();

/** Lowest world height of the view-frustum slice [near, far] (as CascadedSunShadow computes minReceiverY). */
export function sliceMinY(cam: THREE.PerspectiveCamera, near: number, far: number): number {
  const tanV = Math.tan(THREE.MathUtils.degToRad(cam.fov) * 0.5) / cam.zoom;
  const tanH = tanV * cam.aspect;
  let minY = Infinity;
  for (let k = 0; k < 8; k++) {
    const z = k < 4 ? near : far;
    _corner.set((k & 1 ? 1 : -1) * tanH * z, (k & 2 ? 1 : -1) * tanV * z, -z).applyMatrix4(cam.matrixWorld);
    minY = Math.min(minY, _corner.y);
  }
  if (far * 1.25 >= cam.position.y) {
    minY = Math.min(minY, 0);
  }
  return minY;
}

const _sphere = new THREE.Sphere();

/** Per-pass cost of one module at one camera. */
export interface PassCost {
  /** Triangles submitted (after the module's own culling / LOD, frustum culled where the renderer would). */
  tris: number;
  /** Draw calls (a BatchedMesh multi-draw or one instanced draw counts as one). */
  draws: number;
}

export interface ModuleViewReport {
  main: PassCost;
  /** All shadow cascades together. */
  shadow: PassCost;
  /** Planar water reflection (high preset). */
  reflection: PassCost;
  /** CPU time (ms) of the module's per-frame work at this camera, steady state (median of repeated runs). */
  cpuMs: number;
  /** Free-form counters (instances, chunks, LOD mix...). */
  detail: Record<string, number | string>;
}

export interface ModuleReport {
  module: string;
  /** Distinct shader programs the module compiles (materials x variants), estimated. */
  materials: number;
  /** GPU texture / render-target memory (MB) owned by the module, estimated from the allocation sizes. */
  textureMB: number;
  /** Retained GPU geometry (MB) after streaming settled, where known. */
  geometryMB?: number;
  views: Record<string, ModuleViewReport>;
  notes: string[];
}

export function emptyView(): ModuleViewReport {
  return { main: { tris: 0, draws: 0 }, shadow: { tris: 0, draws: 0 }, reflection: { tris: 0, draws: 0 }, cpuMs: 0, detail: {} };
}

/** Median wall time (ms) of `runs` calls of fn. */
export function timeMedian(fn: () => void, runs = 15): number {
  const t: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    fn();
    t.push(performance.now() - t0);
  }
  t.sort((a, b) => a - b);
  return t[Math.floor(t.length / 2)];
}

export interface ProbeContext {
  geo: GeoQuery;
  quality: QualitySettings;
  views: ProbeView[];
}

/** Bytes of a 2D texture with a full mip chain (4/3) or without. */
export function texBytes(w: number, h: number, bytesPerTexel: number, layers = 1, mips = false): number {
  return w * h * bytesPerTexel * layers * (mips ? 4 / 3 : 1);
}

export const MB = 1024 * 1024;
