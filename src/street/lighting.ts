import * as THREE from 'three';
import type { LightRec } from './format';

export type TimeOfDay = 'day' | 'dusk' | 'night';

export interface LightingPreset {
  sky: number;
  fogNear: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  sunColor: number;
  sunIntensity: number;
  sunAzimuthDeg: number;
  sunElevationDeg: number;
  /**
   * Scale from physical light units (candela, nits) to the sandbox's daylight units (sun ≈ 2.4). The street lights
   * and the emissive materials are on when > 0.
   */
  lightScale: number;
  /** Night-only lights (street lamps, signs, windows) are on. */
  nightLights: boolean;
}

/**
 * Preview lighting (WebGL2, standard materials, no custom shaders). The daylight units are the S0 sandbox's; at dusk
 * and night the manifest lights (candela) and emissive materials (nits) are scaled by `lightScale` (a stand-in for
 * the eye's night adaptation: at night a ~15 lx street under a lantern reads like 1.8 units, about 3/4 of the day sun).
 */
export const PRESETS: Record<TimeOfDay, LightingPreset> = {
  day: { sky: 0x9ec3e6, fogNear: 140, hemiSky: 0xdce8ff, hemiGround: 0x8a7d66, hemiIntensity: 1.9, sunColor: 0xfff0dc, sunIntensity: 2.4, sunAzimuthDeg: 230, sunElevationDeg: 42, lightScale: 0.04, nightLights: false },
  dusk: { sky: 0x8c93b8, fogNear: 110, hemiSky: 0xa4acd6, hemiGround: 0x4a4038, hemiIntensity: 0.95, sunColor: 0xffa468, sunIntensity: 0.7, sunAzimuthDeg: 250, sunElevationDeg: 6, lightScale: 0.08, nightLights: true },
  night: { sky: 0x0b1120, fogNear: 80, hemiSky: 0x33456e, hemiGround: 0x161616, hemiIntensity: 0.14, sunColor: 0xa9bcff, sunIntensity: 0.05, sunAzimuthDeg: 140, sunElevationDeg: 35, lightScale: 0.12, nightLights: true },
};

export function parseTimeOfDay(v: string | null): TimeOfDay {
  return v === 'dusk' || v === 'night' ? v : 'day';
}

/** Whether a manifest light or an emissive material is on under a preset. */
export const isLit = (night: boolean, p: LightingPreset): boolean => !night || p.nightLights;

/**
 * A fixed set of three.js point and spot lights (constant counts, so programs never recompile), given to the lit
 * manifest lights nearest the camera. Area lights are drawn as point lights.
 */
export class LightPool {
  readonly group = new THREE.Group();
  private readonly points: THREE.PointLight[] = [];
  private readonly spots: THREE.SpotLight[] = [];
  private lastX = NaN;
  private lastZ = NaN;
  private lastCount = -1;
  private lastScale = -1;
  assigned = 0;
  candidates = 0;

  constructor(points = 24, spots = 24) {
    this.group.name = 'street-lights';
    for (let i = 0; i < points; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 10, 2);
      l.castShadow = false;
      this.points.push(l);
      this.group.add(l);
    }
    for (let i = 0; i < spots; i++) {
      const l = new THREE.SpotLight(0xffffff, 0, 10, Math.PI / 3, 0.4, 2);
      l.castShadow = false;
      this.spots.push(l);
      this.group.add(l, l.target);
    }
  }

  /** Re-assigns the pool when the camera moved more than 4 m, the light list changed or the preset changed. */
  update(lights: readonly LightRec[], x: number, z: number, preset: LightingPreset): void {
    if (Math.hypot(x - this.lastX, z - this.lastZ) < 4 && lights.length === this.lastCount && preset.lightScale * (preset.nightLights ? 1 : -1) === this.lastScale) {
      return;
    }
    this.lastX = x;
    this.lastZ = z;
    this.lastCount = lights.length;
    this.lastScale = preset.lightScale * (preset.nightLights ? 1 : -1);
    const lit = lights.filter((l) => isLit(l.night, preset)).map((l) => ({ l, d: Math.hypot(l.position[0] - x, l.position[2] - z) - l.range * 0.25 }));
    lit.sort((a, b) => a.d - b.d);
    this.candidates = lit.length;
    let pi = 0;
    let si = 0;
    for (const { l } of lit) {
      if (l.type === 'spot' && si < this.spots.length) {
        const s = this.spots[si++];
        s.color.setRGB(l.color[0], l.color[1], l.color[2], THREE.LinearSRGBColorSpace);
        s.intensity = l.intensity * preset.lightScale;
        s.distance = l.range;
        s.angle = THREE.MathUtils.degToRad(l.cone?.outer ?? 60);
        s.penumbra = l.cone ? 1 - l.cone.inner / l.cone.outer : 0.3;
        s.position.set(l.position[0], l.position[1], l.position[2]);
        const d = l.direction ?? [0, -1, 0];
        s.target.position.set(l.position[0] + d[0], l.position[1] + d[1], l.position[2] + d[2]);
        s.target.updateMatrixWorld();
      } else if (l.type !== 'spot' && pi < this.points.length) {
        const p = this.points[pi++];
        p.color.setRGB(l.color[0], l.color[1], l.color[2], THREE.LinearSRGBColorSpace);
        p.intensity = l.intensity * preset.lightScale;
        p.distance = l.range;
        p.position.set(l.position[0], l.position[1], l.position[2]);
      }
      if (pi >= this.points.length && si >= this.spots.length) {
        break;
      }
    }
    this.assigned = pi + si;
    for (let k = pi; k < this.points.length; k++) {
      this.points[k].intensity = 0;
    }
    for (let k = si; k < this.spots.length; k++) {
      this.spots[k].intensity = 0;
    }
  }
}

/** Sets emissive intensities from the materials' `emissive` extras (nits) under a preset. */
export function applyEmissive(materials: Iterable<THREE.Material>, preset: LightingPreset): void {
  for (const m of materials) {
    const e = m.userData.emissive as { nits: number; night: boolean } | undefined;
    const std = m as THREE.MeshStandardMaterial;
    if (!e || !std.isMeshStandardMaterial) {
      continue;
    }
    std.emissiveIntensity = isLit(e.night, preset) ? e.nits * preset.lightScale * (preset.nightLights ? 1 : 0.02) : 0;
  }
}
