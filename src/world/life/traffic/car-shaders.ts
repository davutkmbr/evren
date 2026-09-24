import { ROAD_SAMPLE_TEXELS, ROAD_STEP, ROAD_TEX_WIDTH } from './road-network';

/** Car kinematics shared by the light points and the car meshes (everything is a function of time on the GPU). */
export const CAR_FRAME_GLSL = /* glsl */ `
uniform highp sampler2D uRoads;
uniform float uCarTime;
uniform float uTraffic;
attribute vec4 aRoad;
attribute vec4 aLane;
attribute vec4 aStyle;

/* Road sample texel k: 0 = centreline point (xyz) and hide weight (w, 1 inside the OSM slice);
   1 = lateral surface profile relative to the centre: left / right at aRoad.w m (xy) and at half of it (zw). */
vec4 roadSample(float i, int k) {
  int ii = int(i + 0.5) * ${ROAD_SAMPLE_TEXELS} + k;
  return texelFetch(uRoads, ivec2(ii % ${ROAD_TEX_WIDTH}, ii / ${ROAD_TEX_WIDTH}), 0);
}

/* Position on the lane centre, unit travel direction (3D) and visibility (road-end fade x traffic volume). */
float carFrame(out vec3 pos, out vec3 fwd) {
  float L = aRoad.z;
  float s = mod(aLane.w + aLane.y * aLane.z * uCarTime, L);
  float f = s / ${ROAD_STEP.toFixed(1)};
  float i0 = floor(f);
  float fr = f - i0;
  float i1 = min(i0 + 1.0, aRoad.y - 1.0);
  vec4 s0 = roadSample(aRoad.x + i0, 0);
  vec4 s1 = roadSample(aRoad.x + i1, 0);
  vec4 side = mix(roadSample(aRoad.x + i0, 1), roadSample(aRoad.x + i1, 1), fr);
  vec3 p0 = s0.xyz;
  vec3 p1 = s1.xyz;
  vec3 c = mix(p0, p1, fr);
  vec3 t = p1 - p0;
  float tl = length(t);
  t = tl > 1e-3 ? t / tl : vec3(0.0, 0.0, -1.0);
  vec3 right = normalize(vec3(-t.z, 0.0, t.x) + 1e-6);
  float lat = aLane.x * aLane.y;
  pos = c + right * lat;
  // Follow the surface across the road: piecewise linear through the centre, half and outer profile samples.
  float u = clamp(abs(lat) / max(aRoad.w, 0.5), 0.0, 1.0) * 2.0;
  vec2 prof = lat < 0.0 ? side.zx : side.wy;
  pos.y += u < 1.0 ? prof.x * u : mix(prof.x, prof.y, u - 1.0);
  fwd = t * aLane.y;
  float edge = min(s, L - s);
  return smoothstep(3.0, 30.0, edge) * step(aStyle.z, uTraffic) * (1.0 - mix(s0.w, s1.w, fr));
}
`;

/** Light-stream vertex shader body (SHARED_GLSL and CAR_FRAME_GLSL are prepended by the caller). */
export const CAR_LIGHT_VERTEX = /* glsl */ `
attribute float aEnd;
varying vec3 vCol;
void main() {
  vec3 pos;
  vec3 fwd;
  float vis = carFrame(pos, fwd);
  float big = step(1.5, aStyle.y);
  float len = mix(4.3, 11.0, big);
  vec3 p = pos + fwd * aEnd * len * 0.5 + vec3(0.0, mix(0.72, 1.1, big), 0.0);
  vec3 toCam = cameraPosition - p;
  float dist = max(length(toCam), 1.0);
  toCam /= dist;
  // Keep far lights above coarse terrain LODs.
  p.y += dist * 0.0012;
  float facing = dot(toCam, fwd * aEnd);
  float lightsOn = smoothstep(0.06, 0.4, uNight);
  bool head = aEnd > 0.0;
  float lobe = head ? pow(clamp(facing * 0.5 + 0.5, 0.0, 1.0), 4.0) + 0.04 : pow(clamp(facing * 0.5 + 0.5, 0.0, 1.0), 2.0) + 0.05;
  vec3 col = head ? vec3(1.0, 0.86, 0.66) * 18.0 : vec3(1.0, 0.035, 0.012) * 9.0;
  float radius = head ? 0.55 : 0.4;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  float pxScale = projectionMatrix[1][1] * uResolution.y * 0.5;
  float px = radius * pxScale / max(-mv.z, 1.0);
  float size = max(px, 1.35);
  float energy = pow(px / size, 1.4);
  float intensity = lightsOn * vis * lobe * mix(0.5, 1.0, energy);
  vCol = col * intensity * atmoTransmittance(p);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = size * 2.3;
  if (intensity < 0.002) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
  }
}
`;

export const CAR_LIGHT_FRAGMENT = /* glsl */ `
varying vec3 vCol;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(p, p);
  if (r2 > 1.0) discard;
  gl_FragColor = vec4(vCol * (exp(-r2 * 10.0) + exp(-r2 * 3.0) * 0.15), 1.0);
}
`;

/** Vertex patch for the instanced car meshes (MeshStandardMaterial). Geometry is a unit car, forward -Z. */
export const CAR_MESH_VERTEX_PARS = /* glsl */ `
${CAR_FRAME_GLSL}
attribute float aPart;
varying float vPart;
varying vec3 vCarLocal;
varying float vCarStyle;
varying float vCarType;
vec3 carR;
vec3 carU;
vec3 carF;
vec3 carPos;
float carVis;
vec3 carScale;
`;

export const CAR_MESH_NORMAL = /* glsl */ `
  carVis = carFrame(carPos, carF);
  carR = normalize(vec3(-carF.z, 0.0, carF.x) + 1e-6);
  carU = cross(carR, carF);
  float carType = aStyle.y;
  carScale = carType > 2.5 ? vec3(2.5, 3.4, 9.5) : carType > 1.5 ? vec3(2.55, 3.1, 12.0) : vec3(1.8, 1.45, 4.4);
  vec3 objectNormal = normalize(carR * normal.x + carU * normal.y - carF * normal.z);
  #ifdef USE_TANGENT
    vec3 objectTangent = vec3( tangent.xyz );
  #endif
`;

export const CAR_MESH_BEGIN = /* glsl */ `
  vec3 lp = position;
  if (aStyle.y > 1.5 && aPart > 0.5 && aPart < 1.5) {
    // Buses and trucks: the cabin becomes the full-length box.
    lp.x = sign(lp.x) * 0.5;
    lp.z = lp.z < 0.0 ? -0.5 : 0.5;
  }
  vPart = aPart;
  vCarLocal = lp;
  vCarStyle = aStyle.x;
  vCarType = aStyle.y;
  lp *= carScale;
  vec3 transformed = carPos + carR * lp.x + carU * lp.y - carF * lp.z;
  if (carVis < 0.5) transformed = vec3(0.0, -1.0e5, 0.0);
`;

export const CAR_MESH_FRAGMENT_PARS = /* glsl */ `
varying float vPart;
varying vec3 vCarLocal;
varying float vCarStyle;
varying float vCarType;
vec3 carPaint(float s, float type) {
  if (type > 0.5 && type < 1.5) return vec3(0.82, 0.55, 0.04);
  if (type > 1.5 && type < 2.5) return s < 0.6 ? vec3(0.05, 0.14, 0.42) : vec3(0.5, 0.04, 0.04);
  if (s < 0.26) return vec3(0.78);
  if (s < 0.5) return vec3(0.42, 0.43, 0.45);
  if (s < 0.62) return vec3(0.02);
  if (s < 0.7) return vec3(0.12, 0.13, 0.14);
  if (s < 0.77) return vec3(0.45, 0.03, 0.03);
  if (s < 0.84) return vec3(0.03, 0.08, 0.25);
  if (s < 0.9) return vec3(0.25, 0.25, 0.22);
  return vec3(0.35, 0.22, 0.12);
}
`;

export const CAR_MESH_COLOR = /* glsl */ `
  {
    vec3 paint = carPaint(vCarStyle, vCarType);
    float glass = 0.0;
    if (vPart > 0.5 && vPart < 1.5) {
      // Cabin: glazing band (cars) / window row (buses).
      glass = vCarType > 1.5 ? step(0.55, vCarLocal.y) * step(vCarLocal.y, 0.9) : step(vCarLocal.y, 0.93);
    }
    if (vPart > 1.5) paint = vec3(0.02);
    diffuseColor.rgb = mix(paint, vec3(0.02, 0.025, 0.03), glass);
  }
`;
