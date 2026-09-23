/**
 * Cloud shadowing (OWNED BY render/clouds).
 *
 *   float cloudShadow(vec3 worldPos)   // 1 = fully lit, 0 = fully shadowed by clouds
 *
 * The clouds system bakes the sun transmittance through the cloud layer into uCloudShadowMap, indexed by the
 * point where the sun ray crosses the reference plane y = CLOUD_SHADOW_REF_H. Uniforms (registered globally):
 *   uCloudShadowMap   : R = transmittance through the whole layer
 *   uCloudShadowXform : xy = map centre (m), z = 1 / extent (m), w = strength (0 disables: night / clouds off)
 * One texture fetch (explicit LOD 1, valid in vertex shaders too); soft by construction (low-frequency density,
 * mip-filtered ~140 m footprint, 15 % floor for the diffuse light a sunlit cumulus transmits).
 */
import { CLOUD_CONSTANTS } from '../clouds/config';

const REF = CLOUD_CONSTANTS.layerBottom - 150;
const TOP = CLOUD_CONSTANTS.layerTop + 60;

export const CLOUD_SHADOW_REF_HEIGHT = REF;

export const CLOUD_SHADOW_GLSL = /* glsl */ `
#define CLOUD_SHADOW_REF_H ${REF.toFixed(1)}
#define CLOUD_SHADOW_TOP_H ${TOP.toFixed(1)}
uniform sampler2D uCloudShadowMap;
uniform vec4 uCloudShadowXform;

float cloudShadow(vec3 worldPos) {
  if (uCloudShadowXform.w <= 0.0 || uSunDir.y <= 0.0 || worldPos.y >= CLOUD_SHADOW_TOP_H) return 1.0;
  float sy = max(uSunDir.y, 0.05);
  vec2 p = worldPos.xz + uSunDir.xz * ((CLOUD_SHADOW_REF_H - worldPos.y) / sy);
  vec2 uv = (p - uCloudShadowXform.xy) * uCloudShadowXform.z + 0.5;
  float s = textureLod(uCloudShadowMap, uv, 1.0).r;
  vec2 edge = clamp(min(uv, 1.0 - uv) * 14.0, 0.0, 1.0);
  s = mix(1.0, s, edge.x * edge.y);
  float above = clamp((CLOUD_SHADOW_TOP_H - worldPos.y) / (CLOUD_SHADOW_TOP_H - CLOUD_SHADOW_REF_H), 0.0, 1.0);
  s = pow(max(s, 1e-4), above);
  return mix(1.0, s, uCloudShadowXform.w * smoothstep(0.0, 0.07, uSunDir.y));
}
`;
