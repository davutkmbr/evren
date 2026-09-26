import { SHARED_GLSL } from '../../../render/shaders';
import { WATER_COMMON_GLSL } from './water-common.glsl';

export const WATER_VERTEX_GLSL = /* glsl */ `
#include <common>
#include <shadowmap_pars_vertex>
${SHARED_GLSL}
${WATER_COMMON_GLSL}

varying vec3 vWorld;
varying vec4 vLagr;   // xy = undisplaced xz relative to uOrigin, z = wave height, w = vertex spacing

void main() {
  vec2 local = position.xz;
  float spacing = position.y;
  vec2 xo = uGridCenter + local;
  vec2 world = uOrigin + xo;
  vec2 uv = geoUV(world);
  float coast = textureLod(uGeoCoast, uv, 0.0).r;
  vec4 region = textureLod(uRegionTex, uv, 0.0);
  vec4 flow = textureLod(uFlowTex, uv, 0.0);
  vec4 groups = waveGroupWeights(region, flow, coast);

  vec3 disp = gerstnerDisplacement(xo, groups, spacing);
  // Under land the sheet sinks below the shore so waves never poke through low banks.
  float land = smoothstep(0.0, 25.0, coast);
  disp *= 1.0 - land;
  disp.y -= land * 1.5;
  // Wave particles (hull wakes, the dragon, splashes) at the displaced point, where the grid can carry them.
  if (uWaveParams.x > 0.5) {
    float carry = 1.0 - smoothstep(uWaveRect.w * 1.5, uWaveRect.w * 4.0, spacing);
    if (carry > 0.0) disp.y += waveParticlesAt(xo + disp.xz).r * (1.0 - land) * carry;
  }

  vec3 localPos = vec3(local.x + disp.x, disp.y, local.y + disp.z);
  vec4 mvPosition = modelViewMatrix * vec4(localPos, 1.0);
  gl_Position = projectionMatrix * mvPosition;

  vWorld = vec3(world.x + disp.x, disp.y, world.y + disp.z);
  vLagr = vec4(xo, disp.y, spacing);

  #if defined( USE_SHADOWMAP ) && NUM_SUN_LIGHT_SHADOWS > 0
    vSunShadowWorldPosition = vec4(vWorld, -mvPosition.z);
    vSunShadowWorldNormal = vec3(0.0, 1.0, 0.0);
  #endif
}
`;
