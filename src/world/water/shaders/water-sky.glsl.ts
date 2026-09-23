/**
 * Sky-side optics of the water surface: exact dielectric Fresnel, blurred sky lookups and reflected clouds.
 *
 * The volumetric clouds are a post pass, so neither scene.environment nor the planar mirror contains them. Their
 * reflection is reconstructed from the clouds' sun-transmittance map (uCloudShadowMap, see cloudshadow.glsl.ts): the
 * reflected ray is intersected with the cloud base, the column that sun ray crosses is looked up (inverse of the bake
 * mapping) and turned into coverage; outside the map the mean coverage of the whole map is used. Cloud radiance is a
 * two-term estimate (key light scattered by bases / sunlit flanks + sky irradiance), faded by aerial perspective.
 */
export const WATER_SKY_GLSL = /* glsl */ `
#define CLOUD_REFL_BASE 1600.0
#define CLOUD_REFL_MID 2050.0

float fresnelDielectric(float cosi, float eta) {
  float c = clamp(abs(cosi), 0.0, 1.0);
  float g2 = eta * eta - 1.0 + c * c;
  if (g2 < 0.0) return 1.0;
  float g = sqrt(g2);
  float a = (g - c) / (g + c);
  float b = (c * (g + c) - 1.0) / (c * (g - c) + 1.0);
  return 0.5 * a * a * (1.0 + b * b);
}

vec3 cloudReflection(vec3 sky, vec3 P, vec3 R, float alpha) {
  float strength = uCloudShadowXform.w * smoothstep(0.0, 0.06, uSunDir.y);
  if (strength <= 0.0 || R.y < 0.004) return sky;
  float t = (CLOUD_REFL_BASE - P.y) / R.y;
  vec2 hit = P.xz + R.xz * t;
  float sy = max(uSunDir.y, 0.05);
  vec2 p = hit - uSunDir.xz * ((CLOUD_REFL_MID - CLOUD_SHADOW_REF_H) / sy);
  vec2 uv = (p - uCloudShadowXform.xy) * uCloudShadowXform.z + 0.5;
  float texels = float(textureSize(uCloudShadowMap, 0).x);
  // Footprint of the (rough) reflection cone on the cloud base, in shadow-map texels; grazing rays smear along R.
  float cone = t * (2.2 * alpha + 0.004) / max(sqrt(R.y), 0.2);
  float lod = log2(max(cone * uCloudShadowXform.z * texels, 1.0));
  float T = textureLod(uCloudShadowMap, uv, lod).r;
  float Tmean = textureLod(uCloudShadowMap, vec2(0.5), 12.0).r;
  vec2 edge = clamp(min(uv, 1.0 - uv) * 9.0, 0.0, 1.0);
  T = mix(Tmean, T, edge.x * edge.y);
  float cover = smoothstep(0.02, 0.75, (1.0 - T) / 0.85);

  vec3 Ek = keyLightAt(vec3(hit.x, CLOUD_REFL_MID, hit.y));
  vec2 rh = normalize(R.xz + vec2(1e-5, 0.0));
  vec2 sh = normalize(uSunDir.xz + vec2(1e-5, 0.0));
  float away = 0.5 - 0.5 * dot(rh, sh);
  float flank = 1.0 - smoothstep(0.03, 0.4, R.y);
  float direct = mix(0.1, mix(0.22, 0.75, away), flank) + 0.35 * pow(max(dot(R, uSunDir), 0.0), 12.0);
  vec3 cloud = (0.85 / PI) * (Ek * direct + uAmbient * 1.15);
  float haze = exp(-t * (1.0 / 32000.0));
  return mix(sky, cloud, cover * strength * haze);
}

vec3 skyReflection(vec3 P, vec3 r, float spread) {
  vec3 dir = normalize(vec3(r.x, max(r.y, 0.004), r.z));
  vec3 c = skyRadiance(dir);
  if (spread > 0.015) {
    vec3 up = normalize(vec3(dir.x, dir.y + spread, dir.z));
    vec3 dn = normalize(vec3(dir.x, max(dir.y - spread * 0.5, 0.004), dir.z));
    c = (c * 2.0 + skyRadiance(up) + skyRadiance(dn)) * 0.25;
  }
  return cloudReflection(c, P, dir, spread * 0.7);
}
`;
