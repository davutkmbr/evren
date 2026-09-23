import type { GeoQuery } from '../core/contracts';
import { LandUse } from '../core/contracts';
import { clamp01, finiteOr, smoothstep } from './dsp/math';
import type { AmbienceProbe } from './voices/ambience';

const RING = 8;
const INTERVAL = 0.25;

/**
 * Samples the geography around the listener a few times per second (~20 O(1) geo queries per sample) and
 * condenses it into an AmbienceProbe. The ring rotates each sample so coarse sampling averages out.
 */
export class GeoProbe {
  private timer = INTERVAL;
  private spin = 0;

  update(geo: GeoQuery | undefined, x: number, y: number, z: number, dt: number, out: AmbienceProbe): void {
    this.timer += finiteOr(dt, 0);
    // A non-finite listener must not be sampled: the previous probe stays valid until the pose recovers.
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      return;
    }
    if (!geo || this.timer < INTERVAL) {
      if (!geo) {
        out.altitude = y;
        out.agl = y;
      }
      return;
    }
    this.timer = 0;
    this.spin = (this.spin + 0.61803) % 1;

    const surface = Math.max(finiteOr(geo.heightAt(x, z), 0), 0);
    const agl = Math.max(0, y - surface);
    out.agl = agl;
    out.altitude = y;

    const r = Math.min(900, Math.max(120, agl * 0.7));
    let urban = finiteOr(geo.densityAt(x, z), 0);
    let foliage = isFoliage(geo.landUseAt(x, z)) ? 1 : 0;
    let water = geo.isWater(x, z) ? 1 : 0;
    let farWater = water;
    for (let i = 0; i < RING; i++) {
      const a = ((i + this.spin) / RING) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const px = x + c * r;
      const pz = z + s * r;
      urban += finiteOr(geo.densityAt(px, pz), 0);
      if (isFoliage(geo.landUseAt(px, pz))) {
        foliage++;
      }
      if (geo.isWater(px, pz)) {
        water++;
      }
      if (geo.isWater(x + c * 1500, z + s * 1500)) {
        farWater++;
      }
    }
    const n = RING + 1;
    out.urban = clamp01((urban / n) * 1.25);
    out.foliage = foliage / n;
    out.water = water / n;

    const coastDist = Math.abs(finiteOr(geo.coastDistance(x, z), 1e4));
    out.coast = Math.exp(-Math.max(0, coastDist - 30) / 260);
    out.strait = (farWater / n) * (1 - smoothstep(2500, 5000, coastDist));
  }
}

function isFoliage(use: LandUse): boolean {
  return use === LandUse.Forest || use === LandUse.Park || use === LandUse.Cemetery;
}
