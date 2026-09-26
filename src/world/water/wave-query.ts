/**
 * CPU evaluation of the rendered sea surface (phase 21 strand 1: one sea for physics and pictures).
 *
 * Mirrors the water vertex shader exactly: the same Gerstner wave table (read from the SeaState uniforms, so the
 * amplitudes, crest sharpening and origin-relative phases are the very numbers the GPU gets), the same per-location
 * wave group weights (region, fetch exposure and coast distance, sampled with the GPU's cell-centred bilinear
 * filtering from the same baked grids) and the same sinking of the sheet under land. Differences, all deliberate:
 *
 * - Full detail: the shader fades waves under-sampled by the camera-distance vertex spacing; physics always sees the
 *   whole wave set (the surface the near, fully resolved mesh shows).
 * - Detail bands are left out. They only perturb the shading normals (the mesh is never displaced by them) and are
 *   centimetres high (rms ~9 cm for the longest band at U10 = 7 m/s), far below what moves an 18 m dragon; adding
 *   them would make the physics surface disagree with the rendered silhouette.
 * - Gerstner waves move water horizontally as well, so the height AT a world point is found by solving
 *   x0 + D(x0) = x for the undisplaced (Lagrangian) point x0 with a few Newton steps on the analytic 2x2 Jacobian.
 *
 * Doubles throughout; phases stay relative to the shading origin exactly like on the GPU. The last solved point is
 * cached, so heightAt + normalAt + velocityAt at one position cost one solve.
 */
import type * as THREE from 'three';
import type { WaterSeaState, WaterService } from '../../core/contracts';
import { WORLD_HALF_SIZE } from '../../core/geo-coords';
import type { RegionBakeResult } from './bake/region-bake';
import { fromHalf } from './bake/half';
import { MAX_WAVES } from './config';
import type { SeaState } from './sea-state';

const GRAVITY = 9.81;
const MAX_NEWTON = 6;
/** Newton stops once the horizontal residual is below this (m). */
const NEWTON_TOLERANCE = 1e-5;
/** Coast distance used without geography (open water). */
const OPEN_WATER_COAST = -5000;

function smoothstep(e0: number, e1: number, x: number): number {
  let t = (x - e0) / (e1 - e0);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Baked region / flow grids decoded for CPU sampling (same data as uRegionTex / uFlowTex). */
export interface WaterRegionMaps {
  size: number;
  /** RGBA region weights 0..1 (Black Sea, Bosphorus, Marmara, Golden Horn). */
  region: Float32Array;
  /** RGBA: current x, z (m/s), fetch exposure in a poyraz, in a lodos. */
  flow: Float32Array;
}

export function decodeRegionMaps(bake: RegionBakeResult): WaterRegionMaps {
  const n = bake.size * bake.size * 4;
  const region = new Float32Array(n);
  const flow = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    region[i] = bake.region[i] / 255;
    flow[i] = fromHalf(bake.flow[i]);
  }
  return { size: bake.size, region, flow };
}

/**
 * Bilinear RGBA sample with the GPU's conventions for a texture spanning the world square: texel centres at
 * (i + 0.5) * cell, clamp to edge.
 */
function sample4(data: Float32Array, n: number, x: number, z: number, out: Float64Array): void {
  const scale = n / (2 * WORLD_HALF_SIZE);
  let fx = (x + WORLD_HALF_SIZE) * scale - 0.5;
  let fz = (z + WORLD_HALF_SIZE) * scale - 0.5;
  fx = fx < 0 ? 0 : fx > n - 1 ? n - 1 : fx;
  fz = fz < 0 ? 0 : fz > n - 1 ? n - 1 : fz;
  let ix = Math.floor(fx);
  let iz = Math.floor(fz);
  if (ix > n - 2) ix = n - 2;
  if (iz > n - 2) iz = n - 2;
  const tx = fx - ix;
  const tz = fz - iz;
  const i00 = (iz * n + ix) * 4;
  const i10 = i00 + 4;
  const i01 = i00 + n * 4;
  const i11 = i01 + 4;
  const w00 = (1 - tx) * (1 - tz);
  const w10 = tx * (1 - tz);
  const w01 = (1 - tx) * tz;
  const w11 = tx * tz;
  for (let c = 0; c < 4; c++) {
    out[c] = data[i00 + c] * w00 + data[i10 + c] * w10 + data[i01 + c] * w01 + data[i11 + c] * w11;
  }
}

/**
 * The wave field at the latest sea-state update. `sync` copies the wave table from the SeaState uniforms; the
 * queries then evaluate the displaced surface anywhere in the world.
 */
export class WaveQuery implements WaterService {
  readonly seaState: WaterSeaState = { windSpeed: 0, significantWaveHeight: 0, lodos: 0, regime: 'poyraz' };
  /** Bumped by every sync / data change (invalidates the solve cache). */
  version = 0;
  /** Simulation time of the snapshot (s). */
  time = 0;
  originX = 0;
  originZ = 0;

  private count = 0;
  private readonly dirX = new Float64Array(MAX_WAVES);
  private readonly dirZ = new Float64Array(MAX_WAVES);
  private readonly k = new Float64Array(MAX_WAVES);
  private readonly omega = new Float64Array(MAX_WAVES);
  private readonly amp = new Float64Array(MAX_WAVES);
  private readonly steep = new Float64Array(MAX_WAVES);
  private readonly phase = new Float64Array(MAX_WAVES);
  private readonly group = new Uint8Array(MAX_WAVES);
  private lodos = 0;
  private coast: ((x: number, z: number) => number) | null = null;
  private maps: WaterRegionMaps | null = null;

  /* Scratch + solve cache. */
  private readonly regionS = new Float64Array(4);
  private readonly flowS = new Float64Array(4);
  private readonly groupW = new Float64Array(3);
  private keep = 1;
  private sink = 0;
  private cacheVersion = -1;
  private cacheX = NaN;
  private cacheZ = NaN;
  /** Undisplaced point of the last solve (world m). */
  lagrangeX = 0;
  lagrangeZ = 0;
  private dispX = 0;
  private dispY = 0;
  private dispZ = 0;
  private jxx = 1;
  private jxz = 0;
  private jzz = 1;
  private slopeX = 0;
  private slopeZ = 0;
  private velX = 0;
  private velY = 0;
  private velZ = 0;
  /** Newton iterations of the last solve (diagnostics). */
  lastIterations = 0;

  /** Signed coast distance source (m, negative over water), the same grid as the shader's uGeoCoast. */
  setCoast(fn: ((x: number, z: number) => number) | null): void {
    this.coast = fn;
    this.version++;
  }

  /** Baked region + flow grids (null = the shader's placeholders: Bosphorus everywhere, no current). */
  setRegions(maps: WaterRegionMaps | null): void {
    this.maps = maps;
    this.version++;
  }

  get regions(): WaterRegionMaps | null {
    return this.maps;
  }

  /** Copy the wave table the shader will use this frame. `originX/Z` is the shading origin (uOrigin). */
  sync(sea: SeaState, originX: number, originZ: number, time: number): void {
    const dirs = sea.uniforms.uWaveDir.value;
    const amps = sea.uniforms.uWaveAmp.value;
    let n = 0;
    let sumA2 = 0;
    for (let i = 0; i < MAX_WAVES; i++) {
      const a = amps[i];
      if (a.x <= 0) {
        continue;
      }
      const d = dirs[i];
      this.dirX[n] = d.x;
      this.dirZ[n] = d.y;
      this.k[n] = d.z;
      this.omega[n] = Math.sqrt(GRAVITY * d.z);
      this.amp[n] = a.x;
      this.steep[n] = a.y;
      this.phase[n] = a.z;
      this.group[n] = a.w < 0.5 ? 0 : a.w < 1.5 ? 1 : 2;
      sumA2 += a.x * a.x;
      n++;
    }
    this.count = n;
    this.originX = originX;
    this.originZ = originZ;
    this.time = time;
    this.lodos = sea.uniforms.uSeaRegime.value.x;
    const s = this.seaState;
    s.windSpeed = sea.u10;
    s.lodos = sea.lodos;
    s.regime = sea.lodos > 0.5 ? 'lodos' : 'poyraz';
    s.significantWaveHeight = 4 * Math.sqrt(sumA2 / 2);
    this.version++;
  }

  /** Wave group weights at an undisplaced point (waveGroupWeights + the land sink of the vertex shader). */
  private groupsAt(x: number, z: number): void {
    const region = this.regionS;
    const flow = this.flowS;
    if (this.maps) {
      sample4(this.maps.region, this.maps.size, x, z, region);
      sample4(this.maps.flow, this.maps.size, x, z, flow);
    } else {
      region[0] = 0;
      region[1] = 1;
      region[2] = 0;
      region[3] = 0;
      flow[0] = 0;
      flow[1] = 0;
      flow[2] = 0.6;
      flow[3] = 0.6;
    }
    const coast = this.coast ? this.coast(x, z) : OPEN_WATER_COAST;
    const r = region[0];
    const g = region[1];
    const b = region[2];
    const a = region[3];
    const offshore = -coast;
    const lake = clamp01((1 - (r + g + b + a) - 0.006) * 1.006);
    const fetch = clamp01(flow[2] + (flow[3] - flow[2]) * this.lodos);
    const shore = smoothstep(0, 45, offshore);
    const w = this.groupW;
    w[0] = (r + g + b + a * 0.22) * (0.3 + 0.7 * shore) * (0.3 + 0.7 * smoothstep(0.03, 0.4, fetch)) + lake * 0.12 * shore;
    w[1] = (r + b + g * 0.25) * smoothstep(0.35, 0.8, fetch) * (0.15 + 0.85 * shore);
    w[2] = (r + b * 0.25 + g * 0.04) * smoothstep(60, 1800, offshore) * smoothstep(0.45, 0.85, flow[2]);
    const land = smoothstep(0, 25, coast);
    this.keep = 1 - land;
    this.sink = land * 1.5;
  }

  /** Displacement, Jacobian, slopes and orbital velocity of the undisplaced point (x0, z0). */
  private evaluate(x0: number, z0: number): void {
    this.groupsAt(x0, z0);
    const xo = x0 - this.originX;
    const zo = z0 - this.originZ;
    const gw = this.groupW;
    let dx = 0;
    let dy = 0;
    let dz = 0;
    let jxx = 0;
    let jxz = 0;
    let jzz = 0;
    let sx = 0;
    let sz = 0;
    let vx = 0;
    let vy = 0;
    let vz = 0;
    for (let i = 0; i < this.count; i++) {
      const g = gw[this.group[i]];
      if (g <= 0) {
        continue;
      }
      const Dx = this.dirX[i];
      const Dz = this.dirZ[i];
      const k = this.k[i];
      const ph = k * (Dx * xo + Dz * zo) + this.phase[i];
      const s = Math.sin(ph);
      const c = Math.cos(ph);
      const q = this.steep[i] * g;
      const A = this.amp[i] * g;
      const H = q / k;
      const w = this.omega[i];
      dx += Dx * H * c;
      dz += Dz * H * c;
      dy += A * s;
      const qs = q * s;
      jxx += Dx * Dx * qs;
      jxz += Dx * Dz * qs;
      jzz += Dz * Dz * qs;
      const kac = k * A * c;
      sx += Dx * kac;
      sz += Dz * kac;
      // Phases run as -omega * t: d/dt cos(ph) = omega sin(ph), d/dt sin(ph) = -omega cos(ph).
      const hs = H * w * s;
      vx += Dx * hs;
      vz += Dz * hs;
      vy -= A * w * c;
    }
    const keep = this.keep;
    this.dispX = dx * keep;
    this.dispZ = dz * keep;
    this.dispY = dy * keep - this.sink;
    this.jxx = 1 - jxx * keep;
    this.jxz = -jxz * keep;
    this.jzz = 1 - jzz * keep;
    this.slopeX = sx * keep;
    this.slopeZ = sz * keep;
    this.velX = vx * keep;
    this.velY = vy * keep;
    this.velZ = vz * keep;
  }

  /** Find the undisplaced point whose displaced position is (x, z) and evaluate it (cached). */
  private solve(x: number, z: number): void {
    if (x === this.cacheX && z === this.cacheZ && this.cacheVersion === this.version) {
      return;
    }
    let x0 = x;
    let z0 = z;
    let it = 0;
    for (; it < MAX_NEWTON; it++) {
      this.evaluate(x0, z0);
      const fx = x0 + this.dispX - x;
      const fz = z0 + this.dispZ - z;
      if (Math.abs(fx) < NEWTON_TOLERANCE && Math.abs(fz) < NEWTON_TOLERANCE) {
        break;
      }
      // J = [[jxx, jxz], [jxz, jzz]] (symmetric), always positive definite while sum(Q) < 1.
      const det = this.jxx * this.jzz - this.jxz * this.jxz;
      const inv = det > 0.05 ? 1 / det : 20;
      x0 -= (this.jzz * fx - this.jxz * fz) * inv;
      z0 -= (this.jxx * fz - this.jxz * fx) * inv;
    }
    if (it === MAX_NEWTON) {
      this.evaluate(x0, z0);
    }
    this.lastIterations = it;
    this.lagrangeX = x0;
    this.lagrangeZ = z0;
    this.cacheX = x;
    this.cacheZ = z;
    this.cacheVersion = this.version;
  }

  heightAt(x: number, z: number): number {
    this.solve(x, z);
    return this.dispY;
  }

  normalAt(x: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    this.solve(x, z);
    // Same as the fragment shader: n = normalize(cross(dP/dz0, dP/dx0)).
    const ax = this.jxx;
    const ay = this.slopeX;
    const az = this.jxz;
    const bx = this.jxz;
    const by = this.slopeZ;
    const bz = this.jzz;
    const nx = by * az - bz * ay;
    const ny = bz * ax - bx * az;
    const nz = bx * ay - by * ax;
    const len = Math.hypot(nx, ny, nz) || 1;
    return out.set(nx / len, ny / len, nz / len);
  }

  /** Orbital velocity of the surface water at (x, z) (m/s), without the current. */
  orbitalVelocityAt(x: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    this.solve(x, z);
    return out.set(this.velX, this.velY, this.velZ);
  }

  velocityAt(x: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    this.solve(x, z);
    const vx = this.velX;
    const vy = this.velY;
    const vz = this.velZ;
    this.currentAt(x, z, out);
    return out.set(out.x + vx, vy, out.z + vz);
  }

  currentAt(x: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    if (!this.maps) {
      return out.set(0, 0, 0);
    }
    sample4(this.maps.flow, this.maps.size, x, z, this.flowS);
    return out.set(this.flowS[0], 0, this.flowS[1]);
  }
}
