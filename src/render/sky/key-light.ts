import * as THREE from 'three';
import { SunLight } from 'three/examples/jsm/lights/SunLight.js';
import type { QualitySettings } from '../../core/quality';
import { CascadedSunShadow } from './cascaded-shadow';
import { KEY_LIGHT_HEIGHTS } from './params';
import { lightTransmittance } from './transmittance-cpu';

const REFERENCE_INDEX = KEY_LIGHT_HEIGHTS.length - 1;
const DIRECTION_EPSILON = Math.cos(THREE.MathUtils.degToRad(0.03));

/**
 * The single shadow-casting key light (sun by day, moon by night): an r186 SunLight with a 2-4 cascade shadow
 * (quality dependent).
 * Its colour is the irradiance at the 4000 m reference level; `ratios` (T(h)/T(ref)) let every lit material apply the
 * extra atmospheric extinction of lower altitudes (see shader-patches.ts / keyLightAt()).
 */
export class KeyLight {
  readonly light: SunLight;
  readonly shadow: CascadedSunShadow;
  /** Direction toward the light that shading/shadows currently use (quantised to limit shadow crawl). */
  readonly direction = new THREE.Vector3(0, 1, 0);
  /** Irradiance at the reference altitude (linear RGB, already multiplied by intensity). */
  readonly referenceColor = new THREE.Vector3();
  readonly ratios: THREE.Vector3[] = KEY_LIGHT_HEIGHTS.map(() => new THREE.Vector3(1, 1, 1));
  /** Transmittance table per height (absolute, not normalised). */
  private readonly table: THREE.Vector3[] = KEY_LIGHT_HEIGHTS.map(() => new THREE.Vector3());
  private readonly lastTableDir = new THREE.Vector3(0, -2, 0);
  private lastHaze = -1;
  private lastAerosol = -1;
  private tileSize = 0;

  constructor() {
    this.shadow = new CascadedSunShadow();
    this.light = new SunLight(0xffffff, 1);
    this.light.name = 'key-light';
    this.light.shadow.dispose();
    this.light.shadow = this.shadow;
    this.light.castShadow = true;
    this.shadow.camera.near = 1;
    this.shadow.bias = 0.000004;
    this.shadow.radius = 1.4;
    this.light.position.set(0, 1, 0);
  }

  applyQuality(settings: QualitySettings): void {
    this.shadow.setActiveCascades(settings.preset === 'low' ? 2 : settings.preset === 'medium' ? 3 : 4);
    const tile = THREE.MathUtils.clamp(Math.round(settings.shadowMapSize / 2), 512, 2048);
    if (tile !== this.tileSize) {
      this.tileSize = tile;
      this.shadow.mapSize.set(tile, tile);
      if (this.shadow.map) {
        this.shadow.map.dispose();
        this.shadow.map = null;
      }
    }
  }

  /**
   * Updates direction (quantised) and the altitude transmittance table.
   * `illuminance` is the top-of-atmosphere irradiance of the light (sun or moon), `mu` uses the unquantised direction.
   */
  update(targetDirection: THREE.Vector3, illuminance: THREE.Vector3, haze: number, aerosol: number): void {
    if (this.direction.dot(targetDirection) < DIRECTION_EPSILON) {
      this.direction.copy(targetDirection);
      this.light.position.copy(targetDirection);
    }
    const tableStale =
      this.lastTableDir.dot(targetDirection) < 0.9999999 || Math.abs(haze - this.lastHaze) > 1e-3 || Math.abs(aerosol - this.lastAerosol) > 1e-3;
    if (tableStale) {
      this.lastTableDir.copy(targetDirection);
      this.lastHaze = haze;
      this.lastAerosol = aerosol;
      for (let i = 0; i < KEY_LIGHT_HEIGHTS.length; i++) {
        lightTransmittance(KEY_LIGHT_HEIGHTS[i], targetDirection.y, haze, aerosol, this.table[i]);
      }
    }
    const ref = this.table[REFERENCE_INDEX];
    this.referenceColor.set(illuminance.x * ref.x, illuminance.y * ref.y, illuminance.z * ref.z);
    for (let i = 0; i < KEY_LIGHT_HEIGHTS.length; i++) {
      const t = this.table[i];
      this.ratios[i].set(ref.x > 1e-9 ? t.x / ref.x : 0, ref.y > 1e-9 ? t.y / ref.y : 0, ref.z > 1e-9 ? t.z / ref.z : 0);
    }
    const peak = Math.max(this.referenceColor.x, this.referenceColor.y, this.referenceColor.z);
    if (peak > 1e-6) {
      this.light.color.setRGB(this.referenceColor.x / peak, this.referenceColor.y / peak, this.referenceColor.z / peak, THREE.LinearSRGBColorSpace);
      this.light.intensity = peak;
    } else {
      this.light.intensity = 0;
    }
  }

  /** Irradiance reaching sea level (for uSunColor / EnvironmentState.sunColor). */
  groundColor(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.referenceColor).multiply(this.ratios[0]);
  }

  get intensity(): number {
    return this.light.intensity;
  }

  dispose(): void {
    this.light.dispose();
  }
}
