/**
 * WebGPU spike: global uniforms and the aerial perspective of src/render/shaders/atmosphere.glsl.ts as TSL nodes.
 *
 * The game patches three's fog ShaderChunks so every built-in material calls applyAtmosphere(). The WebGPU
 * equivalent is `scene.fogNode`: NodeMaterial.setupFog() hands every material's output to it (built-in materials are
 * converted to node materials by the renderer, so they get it too). The per-channel transmittance terms are an exact
 * port; the in-scattered radiance is an analytic horizon/sun-glow model instead of the sky-view LUT (the LUT itself is
 * rendered by the GLSL sky system, which is not ported in the spike).
 */
import * as THREE from 'three/webgpu';
import { Fn, cameraPosition, exp, float, max, mix, output, positionWorld, pow, uniform, vec3, vec4, dot, clamp, abs, sqrt, select, normalize } from 'three/tsl';
import { ATMOSPHERE } from '../../src/render/sky/params';
import type { N } from './tsl-common';

export const U = {
  time: uniform(0),
  timeOfDay: uniform(16),
  night: uniform(0),
  sunDir: uniform(new THREE.Vector3(-0.718, 0.523, 0.459).normalize()),
  keyLightDir: uniform(new THREE.Vector3(-0.718, 0.523, 0.459).normalize()),
  /** Horizon in-scatter colour (linear, pre-exposure). */
  horizon: uniform(new THREE.Color(0.55, 0.62, 0.74)),
  /** Sun glow colour added around the sun direction. */
  sunGlow: uniform(new THREE.Color(1.0, 0.85, 0.6)),
  /** Glass reflection colour (facade fGlassEnv uses uFogColor). */
  fogColor: uniform(new THREE.Color(0.62, 0.68, 0.78)),
  /** x camera altitude, y enabled, z haze scale, w mie scale (as uAtmoState). */
  atmoState: uniform(new THREE.Vector4(160, 1, 1, 1)),
};

const hazeExt = [0, 1, 2].map((i) => ATMOSPHERE.hazeScatteringPerKm[i] + ATMOSPHERE.hazeAbsorptionPerKm[i]);
const chapman = (h: number): number => Math.sqrt((Math.PI * ATMOSPHERE.groundRadiusKm) / (2 * h));
const BETA_R = vec3(...ATMOSPHERE.rayleighScatteringPerKm.map((v) => v * 1e-3));
const EXT_M = float(ATMOSPHERE.mieExtinctionPerKm * 1e-3);
const EXT_H = vec3(...hazeExt.map((v) => v * 1e-3));
const SCALE_H = vec3(ATMOSPHERE.rayleighScaleHeightKm * 1000, ATMOSPHERE.mieScaleHeightKm * 1000, ATMOSPHERE.hazeScaleHeightKm * 1000);
const CHAPMAN_C = vec3(chapman(ATMOSPHERE.rayleighScaleHeightKm), chapman(ATMOSPHERE.mieScaleHeightKm), chapman(ATMOSPHERE.hazeScaleHeightKm));
const RG_M = ATMOSPHERE.groundRadiusKm * 1000;

const opticalDepth = (column: N): N => BETA_R.mul(column.x).add(EXT_M.mul(U.atmoState.w).mul(column.y)).add(EXT_H.mul(U.atmoState.z).mul(column.z));

const atmoColumn = Fn(([h0, dy, dist]: N[]) => {
  const a: N = max(dy.mul(dist).div(SCALE_H), h0.negate().div(SCALE_H).sub(0.5));
  // The GLSL version mixes with a bvec3 (lessThan); TSL has no vector select, so it is done per component.
  const f1 = (ai: N): N => {
    const near = abs(ai).lessThan(1e-4);
    const safe = select(near, float(1e-4), ai);
    return select(near, float(1).sub(ai.mul(0.5)), float(1).sub(exp(safe.negate())).div(safe));
  };
  const fa = vec3(f1(a.x), f1(a.y), f1(a.z));
  return exp(h0.negate().div(SCALE_H)).mul(dist).mul(fa);
}).setLayout({
  name: 'atmoColumn',
  type: 'vec3',
  inputs: [
    { name: 'h0', type: 'float' },
    { name: 'dy', type: 'float' },
    { name: 'dist', type: 'float' },
  ],
}) as N;

const atmoFullRayDepth = Fn(([h0, dy]: N[]) => {
  const base = exp(h0.negate().div(SCALE_H));
  const invC = vec3(1).div(CHAPMAN_C);
  const dip = sqrt(max(h0, 1).mul(2).div(RG_M));
  const up = SCALE_H.mul(base).div(max(dy, 0).mul(vec3(1).sub(invC)).add(invC));
  const down = SCALE_H.mul(vec3(1).sub(base)).div(max(vec3(dy.negate()), invC));
  return opticalDepth(select(dy.greaterThanEqual(dip.negate()), up, down));
}) as N;

/** Analytic stand-in for atmoSkyViewSample(dir).rgb: horizon colour, darker/bluer upwards, sun glow. */
export const skyInscatter = Fn(([dir]: N[]) => {
  const up = clamp(dir.y, 0, 1);
  const zenith = vec3(0.16, 0.3, 0.62);
  const base = mix(vec3(U.horizon as N), zenith, pow(up, 0.6));
  const glow = pow(max(dot(dir, U.sunDir), 0), 6).mul(0.55).add(pow(max(dot(dir, U.sunDir), 0), 40).mul(0.6));
  return base.add(vec3(U.sunGlow as N).mul(glow)).mul(float(1).sub(U.night.mul(0.95)));
}) as N;

export const applyAtmosphere = Fn(([color, worldPos]: N[]) => {
  const ro = vec3(cameraPosition.x, max(cameraPosition.y, 0), cameraPosition.z);
  const d = worldPos.sub(ro);
  const dist = max(d.length(), 1e-3);
  const dir = d.div(dist);
  const T = exp(opticalDepth(atmoColumn(ro.y, dir.y, dist)).negate());
  const Tfull = exp(atmoFullRayDepth(ro.y, dir.y).negate());
  // The LUT holds the in-scatter of the whole ray: the sky above the horizon, only the air light down to the ground
  // below it. The analytic colour is the horizon sky everywhere, so below the horizon the plain (1 - T) weight is used.
  const dip = sqrt(max(ro.y, 1).mul(2).div(RG_M));
  const wSky = clamp(vec3(1).sub(T).div(max(vec3(1).sub(Tfull), vec3(1e-5))), 0, 1);
  const w = select(dir.y.lessThan(dip.negate()), vec3(1).sub(T), wSky);
  return color.mul(T).add(skyInscatter(dir).mul(w));
}) as N;

/** scene.fogNode: the equivalent of the game's fog_fragment ShaderChunk replacement. */
export function atmosphereFogNode(): N {
  return Fn(() => vec4(applyAtmosphere(output.rgb, positionWorld), output.a))();
}

export { normalize };
