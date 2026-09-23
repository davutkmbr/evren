/**
 * Hemi-octahedral mappings (y-up directions <-> [0,1]^2 frame grid) and z-up hemispherical normal packing.
 * Frame (i, j) of an N x N impostor atlas is the view from direction hemiOctDecode(vec2(i, j) / (N - 1)).
 * The CPU mirror lives in impostor-bake.ts (frameDirection).
 */
export const OCTAHEDRAL_GLSL = /* glsl */ `
vec2 hemiOctEncode(vec3 d) {
  d.y = max(d.y, 0.0);
  vec2 p = d.xz / (abs(d.x) + d.y + abs(d.z));
  return vec2(p.x + p.y, p.x - p.y) * 0.5 + 0.5;
}
vec3 hemiOctDecode(vec2 uv) {
  vec2 f = uv * 2.0 - 1.0;
  vec2 p = vec2(f.x + f.y, f.x - f.y) * 0.5;
  return normalize(vec3(p.x, 1.0 - abs(p.x) - abs(p.y), p.y));
}
/* View-space normal (z toward the viewer) packed into two channels. */
vec2 packViewNormal(vec3 n) {
  n.z = max(n.z, 0.0);
  vec2 p = n.xy / (abs(n.x) + abs(n.y) + n.z);
  return vec2(p.x + p.y, p.x - p.y) * 0.5 + 0.5;
}
vec3 unpackViewNormal(vec2 e) {
  vec2 f = e * 2.0 - 1.0;
  vec2 p = vec2(f.x + f.y, f.x - f.y) * 0.5;
  return normalize(vec3(p, max(1.0 - abs(p.x) - abs(p.y), 0.0)));
}
/* Orthonormal frame of the bake camera looking along -dir (three.js lookAt with world up). */
void impostorBasis(vec3 dir, out vec3 right, out vec3 up) {
  vec3 ref = abs(dir.y) > 0.999 ? vec3(0.0, 0.0, -1.0) : vec3(0.0, 1.0, 0.0);
  right = normalize(cross(ref, dir));
  up = cross(dir, right);
}
`;
