/**
 * Street lighting: lamp placement by street class, the coloured light pool raster for the ground shader and the
 * lamp head sprites that keep the lit street network readable from the air.
 *
 * - Main asphalt roads: LED / sodium masts at the kerb on both sides (staggered), double masts in medians.
 * - Kerbed residential streets: shorter masts on alternating sides.
 * - Kerbless cobbled / paved lanes (Galata, Cihangir): wall bracket lanterns on the facades.
 * - Pedestrian streets (İstiklal, Kemankeş): cast-iron lantern posts along both edges.
 * - Squares, quays and park paths: lantern posts; OSM highway=street_lamp nodes first.
 */
import type { OsmData } from '../data';
import { FloatBuf } from '../shared/buffers';
import type { FootprintIndex } from '../shared/footprints';
import { hash } from '../shared/geometry';
import { osmStandGround } from '../shared/stand';
import { POLE_KERB, standFault } from '../../placement/stand';
import { Ground, Surf, type Path, type Street } from '../shared/street-field';
import { BARE_FRONTAGE, Zone, type StreetSurface } from '../shared/street-surface';
import { LAMP_HEADS, Light, LIGHT_RGB, POOL_RGB, type PropKind } from './kinds';
import type { PadTest } from './pads';
import { type PropSink, Spacing, walkLine, yawTowards } from './sink';

/** Light pool raster texel size (m). */
const POOL_PX = 2;
/** Pool bytes store light / POOL_SCALE (overlapping pools add up past 1). */
export const POOL_SCALE = 2;

export interface LightPool {
  /** RGBA8 pool light colour x intensity, row-major from (minX, minZ). */
  data: Uint8Array;
  w: number;
  h: number;
  minX: number;
  minZ: number;
  px: number;
}

export interface LampResult {
  pool: LightPool;
  /** Head sprites: x, y, z, r, g, b (linear light colour), radius (m). */
  sprites: Float32Array;
  lamps: number;
}

const MAIN = new Set(['trunk', 'primary', 'secondary', 'tertiary', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link']);

export function buildLamps(streets: readonly Street[], paths: readonly Path[], data: Pick<OsmData, 'points'>, surface: StreetSurface, footprints: FootprintIndex, sink: PropSink, padded: PadTest): LampResult {
  const { raster } = surface;
  // Shared stand rule (placement/stand.ts): on the OSM ground, on land, a metre from the shore.
  const land = osmStandGround(surface);
  const onLand = (x: number, z: number): boolean => standFault(land, x, z, { building: false }) === null;
  const spacing = new Spacing(16);
  const sprites = new FloatBuf(4096);
  const pw = Math.ceil((raster.w * raster.px) / POOL_PX);
  const ph = Math.ceil((raster.h * raster.px) / POOL_PX);
  const pool = new Float32Array(pw * ph * 3);
  let lamps = 0;

  const splat = (x: number, z: number, radius: number, gain: number, rgb: [number, number, number]): void => {
    const i0 = Math.max(0, Math.floor((x - radius - raster.minX) / POOL_PX));
    const i1 = Math.min(pw - 1, Math.ceil((x + radius - raster.minX) / POOL_PX));
    const j0 = Math.max(0, Math.floor((z - radius - raster.minZ) / POOL_PX));
    const j1 = Math.min(ph - 1, Math.ceil((z + radius - raster.minZ) / POOL_PX));
    for (let j = j0; j <= j1; j++) {
      const pz = raster.minZ + (j + 0.5) * POOL_PX;
      for (let i = i0; i <= i1; i++) {
        const px = raster.minX + (i + 0.5) * POOL_PX;
        // Broad street-light footprint: bright core, long soft shoulder (uniformity between masts), zero at radius.
        const r2 = ((px - x) ** 2 + (pz - z) ** 2) / (radius * radius);
        if (r2 < 1) {
          const o = (j * pw + i) * 3;
          const v = (gain * (1 - r2) * (1 - r2)) / (1 + 4 * r2);
          pool[o] += v * rgb[0];
          pool[o + 1] += v * rgb[1];
          pool[o + 2] += v * rgb[2];
        }
      }
    }
  };

  /** Places lamp `kind` at (x, z) facing (dx, dz) unless another lamp is closer than `min`. */
  const place = (kind: PropKind, x: number, z: number, dx: number, dz: number, light: Light, min: number): boolean => {
    const y = surface.heightAt(x, z) - 0.03;
    if (!onLand(x, z) || !sink.fits(kind, x, z, y) || !spacing.claim(x, z, min)) {
      return false;
    }
    const yaw = yawTowards(dx, dz);
    const s = 0.95 + 0.1 * hash(x * 0.71 + z * 0.13);
    sink.add(kind, x, y, z, yaw, 1, kind === 'lampWall' ? 1 : s, light);
    const spec = LAMP_HEADS[kind]!;
    const rgb = LIGHT_RGB[light];
    const c = Math.cos(yaw);
    const sn = Math.sin(yaw);
    for (const [hx, hy, hz] of spec.heads) {
      // Rotation about +Y: local (hx, hz) -> world (hx c + hz s, -hx s + hz c).
      const wx = x + hx * c + hz * sn;
      const wz = z - hx * sn + hz * c;
      const hy2 = y + hy * (kind === 'lampWall' ? 1 : s);
      sprites.push(wx, hy2, wz, rgb[0], rgb[1], rgb[2], kind === 'lampLantern' || kind === 'lampWall' ? 0.32 : 0.45);
      splat(wx, wz, spec.pool * (kind === 'lampWall' ? 1 : s), spec.gain, POOL_RGB[light]);
    }
    lamps++;
    return true;
  };

  const blocked = (x: number, z: number): boolean => footprints.inside(x, z) || !onLand(x, z) || padded(x, z);

  // 1. OSM street lamps.
  for (const p of data.points) {
    if (p.kind !== 'highway=street_lamp' || blocked(p.x, p.z)) {
      continue;
    }
    const kind: PropKind = p.mount === 'wall_mounted' || p.support === 'wall_mounted' ? 'lampWall' : p.mount === 'bent_mast' || p.mount === 'cast_steel_mast' ? 'lampArmLow' : 'lampLantern';
    place(kind, p.x, p.z, 1, 0, kind === 'lampLantern' ? Light.Warm : Light.Led, 6);
  }

  /** Facade distance on side `s` of a street point (offset along (nx, nz) from the centre line), or -1. */
  const facade = (x: number, z: number, nx: number, nz: number, from: number, to: number): number => {
    for (let o = from; o <= to; o += 0.25) {
      if (footprints.inside(x + nx * o, z + nz * o)) {
        return o;
      }
    }
    return -1;
  };

  /**
   * Mast at the kerb on side (nx, nz) of the street point (x, z); where the sidewalk has no room (building line at the
   * kerb, narrow Beyoğlu sidewalks) the lamp moves onto the facade as a wall bracket, so the street stays lit. The
   * base keeps POLE_KERB m behind the kerb line (the compiler's rule prop.pole): where the kerb line bends away from
   * the street's centre line (corners, bays) the mast steps out from 0.45 m past the half width by up to 0.6 m.
   */
  const kerbLamp = (s: Street, kind: PropKind, x: number, z: number, nx: number, nz: number, light: Light, min: number, flipped = false): void => {
    let o = s.hw + 0.45;
    while (o < s.hw + 1.05 && surface.distance(x + nx * o, z + nz * o) < POLE_KERB) {
      o += 0.15;
    }
    const px = x + nx * o;
    const pz = z + nz * o;
    if (!blocked(px, pz) && surface.distance(px, pz) >= POLE_KERB && surface.buildingDistance(px, pz) > 0.7) {
      place(kind, px, pz, -nx, -nz, light, min);
      return;
    }
    // Coastal road with the sea on this side: the mast moves to the kerb on the land side.
    const fault = standFault(land, px, pz, { building: false });
    if (!flipped && (fault === 'water' || fault === 'shore')) {
      kerbLamp(s, kind, x, z, -nx, -nz, light, min, true);
      return;
    }
    const w = facade(x, z, nx, nz, Math.max(0.5, s.hw - 0.3), s.hw + 6);
    if (w > 0) {
      place('lampWall', x + nx * (w - 0.05), z + nz * (w - 0.05), -nx, -nz, light, min * 0.8);
    }
  };

  // 2. Streets.
  for (const s of streets) {
    const rh = hash(s.road * 0.731 + 0.17);
    const main = MAIN.has(s.kind) && s.kerbed;
    if (main) {
      const light = rh < 0.45 ? Light.Led : Light.Sodium;
      const twoSided = !s.oneway && s.hw > 3.2;
      let side = rh < 0.5 ? 1 : -1;
      walkLine(s.pts, twoSided ? 17 : 27, 6 + rh * 10, (x, z, tx, tz) => {
        const rx = -tz;
        const rz = tx;
        const sd = s.oneway ? 1 : side;
        side = -side;
        kerbLamp(s, 'lampArm', x, z, rx * sd, rz * sd, light, 12);
        if (s.oneway) {
          // Median on the left: double mast in its middle when another carriageway follows within 10 m.
          for (let q = s.hw + 1; q < s.hw + 11; q += 0.5) {
            const qx = x - rx * q;
            const qz = z - rz * q;
            if (surface.distance(qx, qz) < 0) {
              const m = (s.hw + q) / 2;
              if (q - s.hw > 1 && !blocked(x - rx * m, z - rz * m)) {
                place('lampDouble', x - rx * m, z - rz * m, rx, rz, light, 14);
              }
              break;
            }
          }
        }
      });
    } else if (s.kerbed) {
      const light = rh < 0.55 ? Light.Sodium : Light.Led;
      let side = rh < 0.5 ? 1 : -1;
      walkLine(s.pts, 26, 5 + rh * 14, (x, z, tx, tz) => {
        const nx = -tz * side;
        const nz = tx * side;
        side = -side;
        kerbLamp(s, 'lampArmLow', x, z, nx, nz, light, 11);
      });
    } else if (s.pedestrian && s.hw >= 2.6) {
      // Lantern posts along both edges of pedestrian streets.
      let side = 1;
      walkLine(s.pts, s.surf === Surf.Granite ? 12 : 11, 4 + rh * 8, (x, z, tx, tz) => {
        const nx = -tz * side;
        const nz = tx * side;
        side = -side;
        const o = Math.max(0.8, s.hw - 1.0);
        const px = x + nx * o;
        const pz = z + nz * o;
        if (!blocked(px, pz)) {
          place('lampLantern', px, pz, -nx, -nz, Light.Warm, 10);
        }
      });
    } else {
      // Kerbless lanes: wall brackets on the facades, lantern posts where no facade is near.
      const light = rh < 0.6 ? Light.Warm : Light.Sodium;
      let side = rh < 0.5 ? 1 : -1;
      walkLine(s.pts, 22, 4 + rh * 12, (x, z, tx, tz) => {
        const nx = -tz * side;
        const nz = tx * side;
        side = -side;
        const w = facade(x, z, nx, nz, Math.max(0.5, s.hw - 0.5), s.hw + BARE_FRONTAGE + 1);
        if (w > 0) {
          const px = x + nx * (w - 0.05);
          const pz = z + nz * (w - 0.05);
          place('lampWall', px, pz, -nx, -nz, light, 9);
        } else {
          const px = x + nx * (s.hw + 0.3);
          const pz = z + nz * (s.hw + 0.3);
          if (!blocked(px, pz) && surface.distance(px, pz) > -0.2) {
            place('lampLantern', px, pz, -nx, -nz, light, 9);
          }
        }
      });
    }
  }

  // 3. Footpaths away from streets (parks, quays, stairs).
  for (const p of paths) {
    if (p.kind === 'steps') {
      continue;
    }
    walkLine(p.pts, 24, 6 + hash(p.road) * 10, (x, z, tx, tz) => {
      const px = x - tz * (p.hw + 0.35);
      const pz = z + tx * (p.hw + 0.35);
      if (!blocked(px, pz) && surface.distance(px, pz) > 1.5) {
        place('lampLantern', px, pz, tz, -tx, Light.Warm, 12);
      }
    });
  }

  // 4. Squares and quays: lanterns on a jittered 20 m grid.
  const r = raster;
  const g = 20;
  for (let z = r.minZ + g / 2; z < r.minZ + r.h * r.px; z += g) {
    for (let x = r.minX + g / 2; x < r.minX + r.w * r.px; x += g) {
      const jx = x + (hash(x * 0.37 + z * 0.19) - 0.5) * 8;
      const jz = z + (hash(x * 0.11 - z * 0.53) - 0.5) * 8;
      const ground = surface.groundAt(jx, jz);
      if ((ground !== Ground.Plaza && ground !== Ground.Quay && ground !== Ground.Worship) || blocked(jx, jz)) {
        continue;
      }
      const zone = surface.zone(jx, jz);
      if ((zone === Zone.Pedestrian || zone === Zone.Lot) && surface.buildingDistance(jx, jz) > 1.5) {
        place('lampLantern', jx, jz, 1, 0, hash(jx + jz) < 0.7 ? Light.Warm : Light.Led, 14);
      }
    }
  }

  const bytes = new Uint8Array(pw * ph * 4);
  for (let i = 0; i < pw * ph; i++) {
    bytes[i * 4] = Math.round(Math.min(1, pool[i * 3] / POOL_SCALE) * 255);
    bytes[i * 4 + 1] = Math.round(Math.min(1, pool[i * 3 + 1] / POOL_SCALE) * 255);
    bytes[i * 4 + 2] = Math.round(Math.min(1, pool[i * 3 + 2] / POOL_SCALE) * 255);
    bytes[i * 4 + 3] = 255;
  }
  return { pool: { data: bytes, w: pw, h: ph, minX: raster.minX, minZ: raster.minZ, px: POOL_PX }, sprites: sprites.take(), lamps };
}
