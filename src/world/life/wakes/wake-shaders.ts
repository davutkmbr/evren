import { SHARED_GLSL } from '../../../render/shaders';

/**
 * Wake ribbons. Each trail is a ring buffer of bow positions (texture row: N samples + 1 parameter texel).
 * Sample texel: (x, z, s = distance travelled at record, t = time at record); parameter texel: (L, B, head, count).
 * The ribbon half-width grows with the distance behind the bow along the Kelvin wedge (19.47°), so wakes follow
 * curved tracks. The fragment shader draws the Kelvin pattern procedurally in (distance behind bow, lateral offset).
 */
export const WAKE_VERTEX = /* glsl */ `
${SHARED_GLSL}
uniform highp sampler2D uTrail;
uniform float uLifeTime;
attribute vec3 aTrail;
varying float vD;
varying float vLat;
varying float vHalf;
varying float vAge;
varying float vSpeed;
varying vec2 vShip;
varying vec3 vWorld;

vec4 trailSample(int row, int head, int i, int n) {
  int j = (head - i + n * 4) % n;
  return texelFetch(uTrail, ivec2(j, row), 0);
}

void main() {
  int n = textureSize(uTrail, 0).x - 1;
  int row = int(aTrail.x + 0.5);
  int i = int(aTrail.y + 0.5);
  float side = aTrail.z;
  vec4 prm = texelFetch(uTrail, ivec2(n, row), 0);
  int head = int(prm.z + 0.5);
  int count = int(prm.w + 0.5);
  if (i >= count || count < 2) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec4 p = trailSample(row, head, i, n);
  vec4 h = trailSample(row, head, 0, n);
  vec4 pa = trailSample(row, head, max(i - 1, 0), n);
  vec4 pb = trailSample(row, head, min(i + 1, count - 1), n);
  vec2 dir = pa.xy - pb.xy;
  float dl = length(dir);
  dir = dl > 1e-3 ? dir / dl : vec2(0.0, -1.0);
  vec2 right = vec2(-dir.y, dir.x);
  float L = prm.x;
  float B = prm.y;
  float d = max(h.z - p.z, 0.0);
  float halfW = B * 0.5 + min(d * 0.3535, L * 2.5 + 80.0);
  // Local speed from neighbouring samples.
  float dt = abs(pa.w - pb.w);
  vSpeed = dt > 1e-3 ? abs(pa.z - pb.z) / dt : 0.0;
  vD = d;
  vLat = side * halfW;
  vHalf = halfW;
  vAge = uLifeTime - p.w;
  vShip = vec2(L, B);
  vec3 wp = vec3(p.x + right.x * side * halfW, 0.1, p.y + right.y * side * halfW);
  vWorld = wp;
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  // Pull slightly towards the camera so the decal clears the wave crests.
  float dist = length(mv.xyz);
  mv.xyz *= max(dist - (0.5 + dist * 0.002), 0.05) / max(dist, 1e-3);
  gl_Position = projectionMatrix * mv;
}
`;

export const WAKE_FRAGMENT = /* glsl */ `
${SHARED_GLSL}
varying float vD;
varying float vLat;
varying float vHalf;
varying float vAge;
varying float vSpeed;
varying vec2 vShip;
varying vec3 vWorld;

void main() {
  float L = vShip.x;
  float B = vShip.y;
  float d = vD;
  float lat = abs(vLat);
  float u = lat / max(vHalf, 1e-3);
  float hullMask = 1.0 - (1.0 - smoothstep(L * 0.9, L * 1.02, d)) * (1.0 - smoothstep(B * 0.4, B * 0.5, lat));
  if (hullMask <= 0.0) discard;
  float v = vSpeed;
  float strength = smoothstep(0.4, 2.5, v) * exp(-vAge / (90.0 + L * 1.2));
  if (strength < 0.003) discard;
  float lambda = max(6.2832 * v * v / 9.81, 2.0);
  vec2 wp = vWorld.xz;

  float n1 = fbm2(wp * 0.075 + vec2(uTime * 0.02, 0.0), 3);
  float n2 = fbm2(wp * 0.45 + n1 * 2.0, 3);
  float nf = n1 * 0.55 + n2 * 0.45;

  // Propeller wash: churned white water behind the stern breaking up into streaks, then a long pale slick.
  float ds = d - L * 0.95;
  float wash = 0.0;
  float slick = 0.0;
  float churn = 0.0;
  if (ds > -L * 0.05) {
    float dsp = max(ds, 0.0);
    float ww = B * 0.38 + dsp * 0.045;
    float cw = exp(-pow(lat / ww, 2.0) * 1.8);
    float coverage = cw * (0.5 * exp(-dsp / (L * 0.9 + 20.0)) + 0.22 * exp(-dsp / (L * 4.0 + 150.0))) * smoothstep(1.0, 6.0, v);
    float breakup = nf + 0.25 * (n2 - 0.5);
    wash = smoothstep(1.0 - coverage - 0.12, 1.0 - coverage + 0.12, breakup + 0.2) * (0.5 + 0.5 * n2);
    wash *= smoothstep(-L * 0.04, L * 0.06, ds);
    churn = cw * exp(-dsp / (L * 2.2 + 60.0));
    slick = cw * exp(-dsp / (L * 14.0 + 450.0));
  }

  // Bow wave hugging the hull shoulders.
  float bow = 0.0;
  if (d < L * 1.05) {
    float bw = 0.5 + v * 0.3;
    float off = lat - B * 0.5;
    float band = smoothstep(-0.3, 0.15, off) * (1.0 - smoothstep(0.0, bw, off));
    float along = exp(-d / (L * 0.18)) + 0.35 * smoothstep(L * 0.65, L * 1.0, d);
    bow = smoothstep(1.0 - band * clamp(along, 0.0, 1.0), 1.1 - band * clamp(along, 0.0, 1.0), n2 + 0.1);
  }

  // Kelvin wedge: breaking divergent crests near the bow, then feathered crest lines along the cusp lines.
  float armNear = exp(-pow((u - 0.9) / 0.09, 2.0));
  float phaseD = (-0.816 * d + 0.578 * lat) / (lambda * 0.667);
  float crestD = 0.5 + 0.5 * sin(6.2832 * phaseD);
  float nearCov = armNear * exp(-d / (L * 0.45 + 8.0)) * smoothstep(1.5, 5.0, v) * 0.75;
  float kelvinFoam = smoothstep(1.0 - nearCov, 1.25 - nearCov, n2 + 0.2 * crestD) * nearCov;
  float armFar = exp(-pow((u - 0.88) / 0.07, 2.0));
  float lines = pow(crestD, 14.0) * armFar * exp(-d / (L * 5.0 + 250.0)) * smoothstep(2.0, 5.0, v) * smoothstep(0.3, 0.6, n1);
  float phaseT = (d - lat * lat / max(2.0 * d, 1.0)) / lambda;
  float trans = pow(0.5 + 0.5 * sin(6.2832 * phaseT), 10.0) * smoothstep(0.8, 0.3, u) * exp(-d / (L * 5.0 + 200.0)) * smoothstep(3.0, 7.0, v);

  float foam = clamp(wash + bow * 0.9 + kelvinFoam * 0.9, 0.0, 1.0);
  float glint = clamp(lines * 0.22 + trans * 0.08 + slick * 0.1 + churn * 0.35, 0.0, 1.0);
  float alpha = clamp(foam + glint, 0.0, 1.0) * strength * hullMask;
  if (alpha < 0.002) discard;
  vec3 E = keyLightAt(vWorld) * cloudShadow(vWorld) * max(uKeyLightDir.y, 0.0) + uAmbient;
  vec3 foamC = vec3(0.8, 0.84, 0.85) * (1.0 / PI) * E;
  vec3 slickC = mix(vec3(0.3, 0.5, 0.55), vec3(0.42, 0.72, 0.72), clamp(churn * 1.5, 0.0, 1.0)) * (1.0 / PI) * E;
  vec3 col = mix(slickC, foamC, clamp(foam / max(foam + glint, 1e-3), 0.0, 1.0));
  gl_FragColor = vec4(applyAtmosphere(col, vWorld), alpha);
}
`;
