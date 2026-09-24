import { SHARED_GLSL } from '../../../render/shaders';

/**
 * Wake ribbons. Each trail is a ring buffer of bow positions (texture row: N samples + 2 parameter texels).
 * Sample texel: (x, z, s = distance travelled at record, t = time at record); parameter texels: (L, B, head, count) and
 * (planing, -, -, -). The ribbon follows the (possibly curved) track and is wide enough for the Kelvin wedge, so the
 * pattern is evaluated per pixel in ship coordinates (x = distance behind the bow along the track, y = lateral offset):
 *   - Kelvin waves from the bow: exact constant-phase curves x = a cos p (1 + sin^2 p), y = a cos^2 p sin p with
 *     a = n * lambda0, lambda0 = 2 pi V^2 / g. Transverse and divergent branches meet at the 19.47 deg cusp line; the
 *     wedge narrows at high Froude numbers (Rabaud & Moisy 2013). Crests are shaded light, troughs dark, anti-aliased.
 *   - breaking bow wave hugging the hull and feeding foam into the first divergent crests,
 *   - quarter-wave foam at the stern shoulders,
 *   - churned propeller wash that streaks, breaks up and spreads, then a long smooth slick,
 *   - planing hulls: wider spray along the hull, foam along the (narrow) cusp lines, wider wash.
 * Foam noise is sampled in world space (it stays put while the vessel moves on) and decays with distance and age.
 */
export const WAKE_VERTEX = /* glsl */ `
${SHARED_GLSL}
uniform highp sampler2D uTrail;
uniform float uLifeTime;
attribute vec3 aTrail;
varying float vD;
varying float vLat;
varying float vAge;
varying float vSpeed;
varying vec4 vShip;
varying vec2 vDir;
varying vec3 vWorld;

vec4 trailSample(int row, int head, int i, int n) {
  int j = (head - i + n * 4) % n;
  return texelFetch(uTrail, ivec2(j, row), 0);
}

void main() {
  int n = textureSize(uTrail, 0).x - 2;
  int row = int(aTrail.x + 0.5);
  int i = int(aTrail.y + 0.5);
  float side = aTrail.z;
  vec4 prm = texelFetch(uTrail, ivec2(n, row), 0);
  vec4 prm2 = texelFetch(uTrail, ivec2(n + 1, row), 0);
  int head = int(prm.z + 0.5);
  int count = int(prm.w + 0.5);
  if (count < 2) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  // Rows past the recorded samples collapse onto the last one (zero-area quads). Moving only those vertices off
  // screen would stretch the last quad into a sliver reaching across the view.
  i = min(i, count - 1);
  vec4 p = trailSample(row, head, i, n);
  vec4 h0 = trailSample(row, head, 0, n);
  vec4 h1 = trailSample(row, head, 1, n);
  vec4 pa = trailSample(row, head, max(i - 1, 0), n);
  vec4 pb = trailSample(row, head, min(i + 1, count - 1), n);
  vec2 dir = pa.xy - pb.xy;
  float dl = length(dir);
  dir = dl > 1e-3 ? dir / dl : vec2(0.0, -1.0);
  vec2 right = vec2(-dir.y, dir.x);
  float L = prm.x;
  float B = prm.y;
  float planing = prm2.x;
  float d = max(h0.z - p.z, 0.0);
  // Current speed (head segment) sets the wavelength of the whole pattern; the local speed its strength.
  float dth = abs(h0.w - h1.w);
  float vHead = dth > 1e-3 ? abs(h0.z - h1.z) / dth : 0.0;
  float dt = abs(pa.w - pb.w);
  vSpeed = dt > 1e-3 ? abs(pa.z - pb.z) / dt : vHead;
  float fr = vHead / sqrt(9.81 * max(L, 1.0));
  float tanA = tan(radians(min(19.47, 9.8 / max(fr, 0.05))));
  float lam = clamp(6.2831853 * vHead * vHead / 9.81, 0.8, L * 1.3 + 2.0);
  // Wedge + the Airy band beyond the cusp line (kept in step with the fragment shader).
  float halfW = B * 0.5 + 1.5 + min(d * tanA + (lam * 0.3 + 1.0) * 2.2 * tanA / 0.353553 + d * 0.01, L * 3.0 + 120.0);
  // Inside a bend the ribbon may not reach past the turning centre, or it folds over itself.
  if (i > 0 && i < count - 1) {
    vec2 dNew = pa.xy - p.xy;
    vec2 dOld = p.xy - pb.xy;
    float ln = length(dNew);
    float lo = length(dOld);
    if (ln > 1e-3 && lo > 1e-3) {
      dNew /= ln;
      dOld /= lo;
      float turn = acos(clamp(dot(dNew, dOld), -1.0, 1.0));
      float inside = sign(dot(dNew, vec2(-dOld.y, dOld.x)));
      if (turn > 1e-3 && side * inside > 0.0) halfW = min(halfW, max(0.8 * 0.5 * (ln + lo) / turn, B));
    }
  }
  vD = d;
  vLat = side * halfW;
  vAge = uLifeTime - p.w;
  vShip = vec4(L, B, planing, vHead);
  vDir = dir;
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
varying float vAge;
varying float vSpeed;
varying vec4 vShip;
varying vec2 vDir;
varying vec3 vWorld;

/*
 * Kelvin constant-phase curves through (x, y): with r = y / x and t = tan(p), r = t / (1 + 2 t^2), so
 * t = (1 -+ sqrt(1 - 8 r^2)) / (4 r) and a = x (1 + t^2)^1.5 / (1 + 2 t^2). Returns (a_transverse, a_divergent) in
 * metres (crest n lies at a = n * lambda0); beyond the cusp both collapse onto the cusp value.
 */
vec2 kelvinA(float x, float y) {
  float r = clamp(y / max(x, 1e-3), 1e-3, 0.353553);
  float disc = sqrt(max(1.0 - 8.0 * r * r, 0.0));
  float tT = 2.0 * r / (1.0 + disc);
  float tD = (1.0 + disc) / (4.0 * r);
  float t2 = tT * tT;
  float d2 = tD * tD;
  return vec2(x * pow(1.0 + t2, 1.5) / (1.0 + 2.0 * t2), x * pow(1.0 + d2, 1.5) / (1.0 + 2.0 * d2));
}

/* Signed crest profile of a wave with phase ph (crests at integers): +1 on crests, negative in troughs, faded when aliased. */
float crestProfile(float ph, float sharp) {
  float w = fwidth(ph);
  float c = cos(6.2831853 * ph);
  float s = c > 0.0 ? pow(c, sharp) : -pow(-c, sharp * 0.6) * 0.6;
  return s * (1.0 - smoothstep(0.16, 0.42, w));
}

void wkLayer(inout vec4 acc, vec3 col, float a) {
  a = clamp(a, 0.0, 1.0);
  acc.rgb = acc.rgb * (1.0 - a) + col * a;
  acc.a = acc.a + a * (1.0 - acc.a);
}

void main() {
  float L = vShip.x;
  float B = vShip.y;
  float planing = vShip.z;
  float vH = vShip.w;
  float d = vD;
  float lat = abs(vLat);
  // The hull itself (bow at d = 0, stern at d = L), narrowing towards the stem.
  float hb = B * 0.5 * pow(clamp(d / (0.24 * L), 0.0, 1.0), 0.6);
  if (d < L * 0.96 && lat < hb - 0.2) discard;
  float v = vSpeed;
  float life = 60.0 + L * 1.5;
  float strength = smoothstep(0.4, 2.0, v) * exp(-vAge / life);
  if (strength < 0.004) discard;
  float fr = vH / sqrt(9.81 * max(L, 1.0));
  vec2 wp = vWorld.xz;
  vec2 dir = vDir / max(length(vDir), 1e-4);
  vec2 perp = vec2(-dir.y, dir.x);
  // World-space foam noise: streaky along the track, fine breakup across.
  vec2 aq = vec2(dot(wp, dir) * 0.07, dot(wp, perp) * 0.45);
  float nA = fbm2(aq + vec2(uTime * 0.012, 0.0), 3);
  float nB = fbm2(wp * 0.36 + nA * 1.6 + vec2(0.0, uTime * 0.018), 3);

  // ---- Kelvin waves (bow source, x measured from just ahead of the stem) ----
  // The hull cannot make waves much longer than itself: fast craft show hull-length crests in a narrowed wedge.
  float lam = clamp(6.2831853 * vH * vH / 9.81, 0.8, L * 1.3 + 2.0);
  float tanA = tan(radians(min(19.47, 9.8 / max(fr, 0.05))));
  float squeeze = 0.353553 / tanA;
  float x = d + 0.08 * L;
  float y = max(lat - hb * 0.35, 0.0) * squeeze;
  vec2 ka = kelvinA(x, y) / lam;
  float q = y / (0.353553 * x);
  // Wave height grows with speed and Froude number: slow, long ships leave only faint lines.
  float waveVis = smoothstep(1.2, 4.0, vH) * (0.3 + 0.7 * smoothstep(0.1, 0.35, fr)) * strength;
  float far = exp(-d / (L * 3.0 + 160.0));
  // Beyond the cusp the waves die out within an Airy band a few wavelengths wide.
  float outside = exp(-pow(max(y - 0.353553 * x, 0.0) / (lam * 0.3 + 1.0), 2.0));
  float nearCusp = exp(-pow((q - 0.97) / 0.09, 2.0));
  float wD = (0.35 + 0.65 * smoothstep(0.25, 0.95, q) + 0.8 * nearCusp) * outside * (0.55 + 0.45 * smoothstep(0.15, 0.45, fr));
  float wT = (1.0 - smoothstep(0.8, 1.02, q)) * (1.0 - smoothstep(0.3, 0.75, fr)) * 0.75 * exp(-d / (L * 2.5 + 140.0));
  float div = crestProfile(ka.y, 3.0);
  float tra = crestProfile(ka.x, 3.0);
  float waves = (div * wD + tra * wT) * far * waveVis * (0.85 + 0.3 * nA);
  // Near the ship the first divergent crests break into foam lines (more at speed, much more when planing).
  float breakLen = L * (0.3 + 1.6 * smoothstep(0.3, 1.0, fr)) + 6.0;
  // (Thin crest lines, not whole crests: pow sharpens the foam onto the crest tops.)
  float armFoamC = pow(max(div, 0.0), 1.0 + planing * 3.0) * smoothstep(0.45, 0.95, q) * outside * exp(-d / breakLen) * smoothstep(3.0, 6.5, vH) * (0.7 + planing * 0.35);
  float armFoam = smoothstep(0.55 - armFoamC * 0.5, 0.9 - armFoamC * 0.5, nB + armFoamC * 0.35) * min(armFoamC * 1.6, 1.0);

  // ---- Bow wave and hull-side foam ----
  float bow = 0.0;
  if (d < L * 1.1) {
    float off = lat - hb;
    float w = 0.3 + vH * 0.12 + B * 0.035 + planing * 0.45;
    float band = smoothstep(-0.3, 0.05, off) * (1.0 - smoothstep(w * 0.25, w, off));
    // Planing hulls throw spray sheets off the chines along the aft half instead of a bow roll.
    float along = exp(-d / (0.08 * L + 1.5)) * (1.4 - planing * 0.9) + 0.25 * smoothstep(0.35 * L, 0.9 * L, d) + 0.12 + planing * 0.3 * smoothstep(0.3 * L, 0.8 * L, d) * (1.0 - smoothstep(0.95 * L, 1.1 * L, d));
    float c = band * clamp(along, 0.0, 1.0) * smoothstep(1.2, 4.5, vH);
    bow = smoothstep(1.0 - c, 1.0 - c + 0.35, nB + 0.15 - planing * 0.12) * c;
  }
  // Quarter-wave foam where the stern wave breaks at the shoulders.
  float quarter = 0.0;
  {
    float qd = (d - L * 0.92) / (L * 0.18 + 3.0);
    float qc = exp(-qd * qd) * exp(-pow((lat - hb - 0.6 - max(d - L, 0.0) * 0.12) / (0.8 + B * 0.1), 2.0)) * smoothstep(2.5, 6.0, vH) * 0.8 * (1.0 - planing * 0.75);
    quarter = smoothstep(1.0 - qc, 1.0 - qc + 0.35, nB) * qc;
  }

  // ---- Propeller wash and slick ----
  float ds = d - L;
  float dsp = max(ds, 0.0);
  float spread = min(B * (0.36 + planing * 0.12) + dsp * (0.045 + planing * 0.03) + sqrt(dsp) * 0.25, B * 0.4 + d * tanA * 0.55);
  float lw = lat / spread;
  float cw = exp(-lw * lw * 1.6);
  float onset = smoothstep(-B * 0.3, B * 0.5, ds);
  float drive = smoothstep(0.8, 4.0, v);
  float fresh = exp(-dsp / (L * 1.1 + 45.0));
  float cover = cw * onset * drive * (0.95 * fresh + 0.12 * exp(-dsp / (L * 3.5 + 160.0)));
  float churn = nA * 0.55 + nB * 0.6;
  float wash = smoothstep(1.02 - cover, 1.02 - cover + 0.28, churn) * min(cover * 2.5, 1.0);
  float bubbles = cw * onset * drive * exp(-dsp / (L * 2.4 + 110.0));
  float slick = exp(-lw * lw * 0.9) * onset * exp(-dsp / (L * 9.0 + 420.0)) * smoothstep(0.8, 3.0, v);

  // ---- Compose (bottom to top) ----
  vec3 E = keyLightAt(vWorld) * cloudShadow(vWorld) * max(uKeyLightDir.y, 0.0) + uAmbient;
  vec3 foamC = vec3(0.86, 0.9, 0.91) * (1.0 / PI) * E;
  vec3 bubbleC = vec3(0.32, 0.62, 0.6) * (1.0 / PI) * E;
  vec3 slickC = vec3(0.3, 0.46, 0.5) * (1.0 / PI) * E;
  vec3 crestC = vec3(0.55, 0.66, 0.7) * (1.0 / PI) * E;
  vec3 troughC = vec3(0.004, 0.012, 0.02);
  // Seen at a grazing angle the crest lines shrink to a sheen; from above they read clearly.
  vec3 toCam = normalize(cameraPosition - vWorld);
  float lineK = mix(0.35, 1.0, smoothstep(0.05, 0.5, toCam.y));
  vec4 acc = vec4(0.0);
  wkLayer(acc, slickC, slick * 0.13 * (0.75 + 0.25 * nA) * strength);
  wkLayer(acc, crestC, max(waves, 0.0) * 0.16 * lineK);
  wkLayer(acc, troughC, max(-waves, 0.0) * 0.12 * lineK);
  wkLayer(acc, bubbleC, bubbles * 0.42 * (0.6 + 0.4 * nB) * strength);
  float foam = clamp(wash + bow + quarter + armFoam, 0.0, 1.0) * strength;
  wkLayer(acc, foamC, foam * 0.95);
  if (acc.a < 0.003) discard;
  gl_FragColor = vec4(applyAtmosphere(acc.rgb / acc.a, vWorld), acc.a);
}
`;
