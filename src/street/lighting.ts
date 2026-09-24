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


/** Metres a light's source adds to its distance when the pool picks lights: street lamps first, interiors last. */
const SOURCE_PENALTY_M: Record<string, number> = { lamp: 0, other: 4, sign: 10, window: 14, interior: 18 };

interface Slot<L extends THREE.PointLight | THREE.SpotLight> {
  light: L;
  rec: LightRec | null;
  target: number;
}

/**
 * A small set of three.js point and spot lights (the quality preset's counts), given to the lit manifest lights that
 * matter most to the view: near the camera, in front of it, street lamps before signs and interiors. Every forward
 * light costs a full BRDF evaluation per fragment, so the pool is off by day and stays small at night; the other
 * lights only glow (LightGlows, emissive materials). Slots keep their light while it stays picked and fade in and
 * out, so lights do not pop while walking. Area lights are drawn as point lights.
 */
export class LightPool {
  readonly group = new THREE.Group();
  private points: Slot<THREE.PointLight>[] = [];
  private spots: Slot<THREE.SpotLight>[] = [];
  private lastX = NaN;
  private lastZ = NaN;
  private lastHeading = NaN;
  private lastList: readonly LightRec[] | null = null;
  private lastScale = NaN;
  private readonly frustum = new THREE.Frustum();
  private readonly matrix = new THREE.Matrix4();
  private readonly sphere = new THREE.Sphere();
  private readonly dir = new THREE.Vector3();
  assigned = 0;
  candidates = 0;

  constructor(points = 4, spots = 4) {
    this.group.name = 'street-lights';
    this.resize(points, spots);
  }

  get capacity(): number {
    return this.points.length + this.spots.length;
  }

  /** Changes the pool size (programs recompile once for the new light counts). */
  resize(points: number, spots: number): void {
    while (this.points.length > points) {
      const s = this.points.pop()!;
      this.group.remove(s.light);
      s.light.dispose();
    }
    while (this.points.length < points) {
      const l = new THREE.PointLight(0xffffff, 0, 10, 2);
      l.castShadow = false;
      this.group.add(l);
      this.points.push({ light: l, rec: null, target: 0 });
    }
    while (this.spots.length > spots) {
      const s = this.spots.pop()!;
      this.group.remove(s.light, s.light.target);
      s.light.dispose();
    }
    while (this.spots.length < spots) {
      const l = new THREE.SpotLight(0xffffff, 0, 10, Math.PI / 3, 0.4, 2);
      l.castShadow = false;
      this.group.add(l, l.target);
      this.spots.push({ light: l, rec: null, target: 0 });
    }
    this.lastList = null;
  }

  /** Call every frame. Re-picks the lights when the camera moved 2 m or turned 8°, the list or the preset changed. */
  update(lights: readonly LightRec[], camera: THREE.PerspectiveCamera, preset: LightingPreset, dtMs: number): void {
    const on = preset.nightLights && this.capacity > 0;
    this.group.visible = on;
    if (!on) {
      this.assigned = 0;
      this.candidates = 0;
      this.lastList = null;
      return;
    }
    const x = camera.position.x;
    const z = camera.position.z;
    camera.getWorldDirection(this.dir);
    const heading = Math.atan2(this.dir.x, -this.dir.z);
    const turned = Math.abs(Math.atan2(Math.sin(heading - this.lastHeading), Math.cos(heading - this.lastHeading)));
    if (lights !== this.lastList || preset.lightScale !== this.lastScale || Math.hypot(x - this.lastX, z - this.lastZ) > 2 || !(turned < 0.14)) {
      this.lastList = lights;
      this.lastScale = preset.lightScale;
      this.lastX = x;
      this.lastZ = z;
      this.lastHeading = heading;
      this.select(lights, camera, preset);
    }
    const k = 1 - Math.exp(-dtMs / 180);
    for (const s of this.points) {
      s.light.intensity += (s.target - s.light.intensity) * k;
    }
    for (const s of this.spots) {
      s.light.intensity += (s.target - s.light.intensity) * k;
    }
  }

  private select(lights: readonly LightRec[], camera: THREE.PerspectiveCamera, preset: LightingPreset): void {
    camera.updateMatrixWorld();
    this.matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.matrix);
    const cx = camera.position.x;
    const cy = camera.position.y;
    const cz = camera.position.z;
    const picked: { l: LightRec; score: number }[] = [];
    for (const l of lights) {
      if (!isLit(l.night, preset)) {
        continue;
      }
      const d = Math.hypot(l.position[0] - cx, l.position[1] - cy, l.position[2] - cz);
      if (d > l.range + 60) {
        continue;
      }
      if (d > l.range) {
        this.sphere.center.set(l.position[0], l.position[1], l.position[2]);
        this.sphere.radius = l.range * 0.8;
        if (!this.frustum.intersectsSphere(this.sphere)) {
          continue;
        }
      }
      picked.push({ l, score: d - l.range * 0.25 + (SOURCE_PENALTY_M[l.source] ?? 8) });
    }
    picked.sort((a, b) => a.score - b.score);
    this.candidates = picked.length;
    const wantPoints: LightRec[] = [];
    const wantSpots: LightRec[] = [];
    for (const { l } of picked) {
      if (l.type === 'spot') {
        if (wantSpots.length < this.spots.length) {
          wantSpots.push(l);
        }
      } else if (wantPoints.length < this.points.length) {
        wantPoints.push(l);
      }
      if (wantPoints.length >= this.points.length && wantSpots.length >= this.spots.length) {
        break;
      }
    }
    this.assigned = LightPool.assign(this.points, wantPoints, preset) + LightPool.assign(this.spots, wantSpots, preset);
  }

  /** Keeps slots whose light is still wanted, gives free slots to the new ones; returns the slots in use. */
  private static assign<L extends THREE.PointLight | THREE.SpotLight>(slots: Slot<L>[], want: LightRec[], preset: LightingPreset): number {
    const wanted = new Set(want);
    const free: Slot<L>[] = [];
    for (const s of slots) {
      if (s.rec && wanted.has(s.rec)) {
        wanted.delete(s.rec);
        s.target = s.rec.intensity * preset.lightScale;
      } else {
        s.rec = null;
        s.target = 0;
        free.push(s);
      }
    }
    for (const rec of wanted) {
      const s = free.shift();
      if (!s) {
        break;
      }
      const l = s.light;
      l.color.setRGB(rec.color[0], rec.color[1], rec.color[2], THREE.LinearSRGBColorSpace);
      l.distance = rec.range;
      l.position.set(rec.position[0], rec.position[1], rec.position[2]);
      l.intensity = 0;
      if ((l as THREE.SpotLight).isSpotLight) {
        const spot = l as THREE.SpotLight;
        spot.angle = THREE.MathUtils.degToRad(rec.cone?.outer ?? 60);
        spot.penumbra = rec.cone ? 1 - rec.cone.inner / rec.cone.outer : 0.3;
        const d = rec.direction ?? [0, -1, 0];
        spot.target.position.set(rec.position[0] + d[0], rec.position[1] + d[1], rec.position[2] + d[2]);
        spot.target.updateMatrixWorld();
      }
      s.rec = rec;
      s.target = rec.intensity * preset.lightScale;
    }
    return slots.filter((s) => s.rec).length;
  }
}

function glowTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.18, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.12)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

/**
 * Halos at every lit street light source (lamps, signs, windows; not interiors) at dusk and night: one additive
 * point sprite each, all in one draw call. They stand in for the lights that get no slot in the LightPool.
 */
export class LightGlows {
  readonly points: THREE.Points;
  private readonly geometry = new THREE.BufferGeometry();
  private capacity = 0;
  private lastList: readonly LightRec[] | null = null;
  private lastScale = NaN;
  count = 0;

  constructor() {
    const material = new THREE.PointsMaterial({
      name: 'light-glows',
      size: 1.3,
      map: glowTexture(),
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
      fog: true,
    });
    this.points = new THREE.Points(this.geometry, material);
    this.points.name = 'light-glows';
    this.points.frustumCulled = false;
    this.points.matrixAutoUpdate = false;
    this.points.visible = false;
    this.grow(256);
  }

  private grow(capacity: number): void {
    this.capacity = capacity;
    this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(capacity * 3), 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(capacity * 3), 3));
  }

  update(lights: readonly LightRec[], preset: LightingPreset): void {
    if (lights === this.lastList && preset.lightScale === this.lastScale && this.points.visible === preset.nightLights) {
      return;
    }
    this.lastList = lights;
    this.lastScale = preset.lightScale;
    this.points.visible = preset.nightLights;
    if (!preset.nightLights) {
      return;
    }
    const lit = lights.filter((l) => l.source !== 'interior' && isLit(l.night, preset));
    if (lit.length > this.capacity) {
      this.grow(lit.length * 2);
    }
    const pos = this.geometry.attributes.position as THREE.BufferAttribute;
    const col = this.geometry.attributes.color as THREE.BufferAttribute;
    const gain = preset.lightScale / 0.12;
    lit.forEach((l, i) => {
      pos.setXYZ(i, l.position[0], l.position[1], l.position[2]);
      const s = gain * Math.min(1.3, Math.max(0.3, Math.sqrt(l.lumens / 3000)));
      col.setXYZ(i, l.color[0] * s, l.color[1] * s, l.color[2] * s);
    });
    pos.needsUpdate = true;
    col.needsUpdate = true;
    this.geometry.setDrawRange(0, lit.length);
    this.count = lit.length;
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
