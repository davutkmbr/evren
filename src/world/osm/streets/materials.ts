/**
 * Street materials. The ground material reads the street raster (shared/protocol.ts StreetRaster: distance fields
 * + ids) and picks a surface per region from texture arrays (asphalt, sett, pavers, granite slabs, concrete):
 * carriageway by OSM surface, granite kerb stones on top of the geometric kerb step (and on its vertical face),
 * sidewalks running to the facades, footpaths, and the ground cover of OSM areas (squares, parking, platforms,
 * grass, construction, quays). At night it adds the lamp light pools (warm sodium / white LED) and a faint glow of
 * the lit street network. Also: lane / crossing paint, grooved tram rails, masonry (steps, platforms, quay walls)
 * and the street furniture material with emissive lamp glass and traffic signals. CC0 textures (public/textures).
 */
import * as THREE from 'three';
import type { WorldBounds } from '../../../core/contracts';
import { patchMaterial } from '../../../core/uniforms';
import { MASK_RANGE, SIDEWALK_MAX, type StreetRaster } from '../shared/protocol';
import { BUILDING_RANGE, FLAG_KERBED, FLAG_PEDESTRIAN, Ground, PATH_RANGE, Surf, SURF_MASK } from '../shared/street-field';
import { BARE_FRONTAGE, BARE_WIDEN, FRONTAGE } from '../shared/street-surface';
import { loadPbrArrays, maxAnisotropy, REPEAT_M } from '../shared/textures';
import { POOL_SCALE, type LightPool } from './lamps';
import { Light, LIGHT_RGB } from './kinds';
import { GROUND_LAYERS } from './layers';
const ARRAY_SIZE = 1024;

/** Material ids of the ground shader (gMat). */
const M = {
  Asphalt: Surf.Asphalt,
  Sett: Surf.Cobble,
  Granite: Surf.Granite,
  Pavers: Surf.Pavers,
  Concrete: Surf.Concrete,
  Sidewalk: 5,
  Kerb: 6,
  Lot: 7,
  Plaza: 8,
  Parking: 9,
  Platform: 10,
  Grass: 11,
  Pitch: 12,
  Construction: 13,
  Quay: 14,
  Worship: 15,
} as const;

const GROUND_TO_MAT: Record<number, number> = {
  [Ground.Lot]: M.Lot,
  [Ground.Plaza]: M.Plaza,
  [Ground.Parking]: M.Parking,
  [Ground.Platform]: M.Platform,
  [Ground.Grass]: M.Grass,
  [Ground.Pitch]: M.Pitch,
  [Ground.Construction]: M.Construction,
  [Ground.Quay]: M.Quay,
  [Ground.Worship]: M.Worship,
};

const glslFloat = (v: number): string => (Number.isInteger(v) ? `${v}.0` : `${v}`);
const rgb = (c: readonly number[]): string => `vec3(${c.map(glslFloat).join(', ')})`;

/** Street lighting at night from the lamp pool raster (ground, masonry): pools plus their blurred fill. */
const POOL_GLSL = /* glsl */ `
uniform sampler2D uStreetPool;
uniform vec4 uPoolXf;
vec3 streetLight(vec2 p, float paved) {
  vec2 puv = (p - uPoolXf.xy) * uPoolXf.zw;
  // Pools under the lamps, plus the blurred pool field (mip ~16 m) as the fill light between them: lit streets
  // read as continuous warm / white lines from the air, lots behind the facades only catch the spill.
  vec3 pool = texture(uStreetPool, puv).rgb * ${glslFloat(POOL_SCALE)};
  vec3 fill = textureLod(uStreetPool, puv, 3.0).rgb * ${glslFloat(POOL_SCALE)};
  vec3 light = pool * 2.6 + fill * (0.3 + 1.4 * paved);
  // Soft shoulder: bright pools keep their hue instead of clipping to white.
  return light / (1.0 + 0.3 * dot(light, vec3(0.3333)));
}
`;

const GROUND_FRAGMENT_PARS = /* glsl */ `
${POOL_GLSL}
uniform sampler2D uStreetMask;
uniform sampler2D uStreetIds;
uniform highp sampler2DArray uGroundAlb;
uniform highp sampler2DArray uGroundNrm;
uniform vec4 uMaskXf;
uniform vec2 uMaskSize;
uniform vec4 uFade;
uniform float uRep[${GROUND_LAYERS.length}];
uniform float uGroundMap[16];
varying vec3 vGW;
varying vec3 vGN;

float gDecode(float v, float range) {
  float e = v * 2.0 - 1.0;
  float a = abs(e);
  return sign(e) * (a <= 0.5 ? a * 0.5 : 0.25 + (a - 0.5) * 1.5) * range;
}

struct GMat { float layer; float rep; float sat; vec3 tint; float rough; float nrm; float rot; };

GMat gMat(int id) {
  // layer, repeat scale (x layer repeat), saturation, tint, roughness multiplier, normal strength, uv rotation
  if (id == ${M.Asphalt}) return GMat(0.0, 1.0, 0.25, vec3(0.9, 0.9, 0.93), 1.0, 1.0, 0.0);
  if (id == ${M.Sett}) return GMat(1.0, 0.8, 0.12, vec3(0.62, 0.6, 0.58), 1.0, 1.6, 0.0);
  if (id == ${M.Granite}) return GMat(3.0, 0.8, 0.35, vec3(1.12, 1.08, 1.04), 0.85, 0.8, 0.0);
  if (id == ${M.Pavers}) return GMat(2.0, 0.75, 0.1, vec3(1.0, 0.99, 0.97), 1.0, 1.2, 1.5708);
  if (id == ${M.Concrete}) return GMat(6.0, 1.0, 0.2, vec3(0.95, 0.95, 0.93), 1.0, 0.8, 0.0);
  if (id == ${M.Sidewalk}) return GMat(2.0, 0.6, 0.3, vec3(1.04, 1.01, 0.97), 1.0, 1.2, 0.0);
  if (id == ${M.Kerb}) return GMat(3.0, 0.35, 0.1, vec3(1.35, 1.35, 1.32), 0.8, 0.5, 0.0);
  if (id == ${M.Lot}) return GMat(4.0, 1.0, 0.4, vec3(0.8, 0.78, 0.74), 1.0, 1.0, 0.0);
  if (id == ${M.Plaza}) return GMat(3.0, 1.0, 0.25, vec3(1.25, 1.22, 1.17), 0.85, 0.7, 0.0);
  if (id == ${M.Parking}) return GMat(0.0, 1.0, 0.25, vec3(1.05, 1.05, 1.07), 1.0, 1.0, 0.0);
  if (id == ${M.Platform}) return GMat(2.0, 0.5, 0.0, vec3(1.25, 1.25, 1.22), 1.0, 1.0, 1.5708);
  if (id == ${M.Grass}) return GMat(4.0, 1.0, 1.0, vec3(1.0), 1.0, 1.5, 0.0);
  if (id == ${M.Pitch}) return GMat(4.0, 0.6, 1.0, vec3(1.0), 1.0, 0.6, 0.0);
  if (id == ${M.Construction}) return GMat(4.0, 1.3, 1.0, vec3(1.0), 1.0, 1.8, 0.0);
  if (id == ${M.Quay}) return GMat(5.0, 1.2, 0.15, vec3(0.95, 0.95, 0.95), 0.9, 1.0, 1.5708);
  if (id == ${M.Worship}) return GMat(3.0, 0.9, 0.2, vec3(1.35, 1.33, 1.3), 0.7, 0.6, 0.0);
  return GMat(0.0, 1.0, 0.25, vec3(0.62, 0.62, 0.64), 1.0, 1.0, 0.0);
}

void gSample(int id, float w, vec2 p, vec2 gx, vec2 gy, float rot, inout vec3 alb, inout float rough, inout vec3 tn) {
  if (w < 0.002) return;
  GMat m = gMat(id);
  int li = int(m.layer + 0.5);
  float rep = uRep[li] * m.rep;
  float c = cos(m.rot + rot);
  float s = sin(m.rot + rot);
  mat2 R = mat2(c, s, -s, c);
  vec2 uv = R * vec2(p.x, -p.y) / rep;
  vec2 dx = R * vec2(gx.x, -gx.y) / rep;
  vec2 dy = R * vec2(gy.x, -gy.y) / rep;
  vec4 a = textureGrad(uGroundAlb, vec3(uv, m.layer), dx, dy);
  vec3 n = textureGrad(uGroundNrm, vec3(uv, m.layer), dx, dy).xyz * 2.0 - 1.0;
  n.xy = transpose(R) * n.xy;
  vec3 col = a.rgb;
  if (id == ${M.Grass} || id == ${M.Pitch}) {
    float v = a.g * 1.6;
    float patchy = vnoise2(p * 0.23) * 0.6 + vnoise2(p * 1.7) * 0.4;
    vec3 green = mix(vec3(0.15, 0.22, 0.07), vec3(0.3, 0.33, 0.12), patchy);
    col = id == ${M.Pitch} ? vec3(0.09, 0.2, 0.08) * (0.85 + 0.3 * v) : mix(green, vec3(0.3, 0.26, 0.18), smoothstep(0.62, 0.8, patchy)) * (0.75 + 0.5 * v);
  } else if (id == ${M.Construction}) {
    float patchy = vnoise2(p * 0.31);
    col = mix(vec3(0.34, 0.27, 0.19), vec3(0.45, 0.4, 0.33), patchy) * (0.7 + 0.6 * a.g);
  } else {
    col = mix(vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), col, m.sat) * m.tint;
  }
  alb += col * w;
  rough += a.a * m.rough * w;
  n.xy *= m.nrm;
  tn += n * w;
}

int gIdAt(ivec2 t, int ch) {
  return int(texelFetch(uStreetIds, clamp(t, ivec2(0), ivec2(uMaskSize) - 1), 0)[ch] * 255.0 + 0.5);
}
`;

const GROUND_MAIN = /* glsl */ `
vec3 gN = normalize(vGN);
float gRough = 0.9;
vec3 gEmis = vec3(0.0);
{
  vec2 p = vGW.xz;
  vec2 gx = dFdx(p);
  vec2 gy = dFdy(p);
  vec2 muv = (p - uMaskXf.xy) * uMaskXf.zw;
  vec4 m = texture2D(uStreetMask, muv);
  float d = gDecode(m.r, ${glslFloat(MASK_RANGE)});
  float bd = m.g * ${glslFloat(BUILDING_RANGE)};
  float sw = m.b * ${glslFloat(SIDEWALK_MAX)};
  float pd = gDecode(m.a, ${glslFloat(PATH_RANGE)});
  // Ids (nearest texel, jittered so that surface borders follow the stones rather than the texel grid).
  vec2 jit = (vec2(vnoise2(p * 2.1), vnoise2(p * 2.1 + 17.3)) - 0.5) * 0.9;
  ivec2 t = ivec2(floor((p + jit - uMaskXf.xy) * uMaskXf.zw * uMaskSize));
  int flags = gIdAt(t, 0);
  int groundId = gIdAt(t, 1);
  int pathSurf = gIdAt(t, 2);
  int surf = flags & ${SURF_MASK};
  // Street frame of the winning street: paving courses, patches and wheel tracks follow the street, not the world.
  float sAng = float(gIdAt(t, 3)) / 256.0 * PI;
  vec2 sDir = vec2(cos(sAng), sin(sAng));
  vec2 sp = vec2(dot(p, sDir), dot(p, vec2(-sDir.y, sDir.x)));
  bool kerbed = (flags & ${FLAG_KERBED}) != 0;
  bool ped = (flags & ${FLAG_PEDESTRIAN}) != 0;

  float fwd = max(abs(dFdx(d)) + abs(dFdy(d)), 0.015);
  float fwb = max(abs(dFdx(d + bd)) + abs(dFdy(d + bd)), 0.05);
  float fwp = max(abs(dFdx(pd)) + abs(dFdy(pd)), 0.02);
  bool face = vGN.y < 0.5;

  // Regions: carriageway, kerb stone, sidewalk, footpath, ground cover.
  float edge = kerbed ? 0.0 : ${glslFloat(BARE_WIDEN)};
  float wRoad = 1.0 - smoothstep(edge - fwd, edge + fwd, d);
  if (!kerbed && d < ${glslFloat(MASK_RANGE - 0.5)}) {
    // Kerbless streets are paved wall to wall.
    wRoad = max(wRoad, 1.0 - smoothstep(${glslFloat(BARE_FRONTAGE)} - fwb, ${glslFloat(BARE_FRONTAGE)} + fwb, d + bd));
  }
  float kerbW = 0.26;
  float wKerb = kerbed ? (1.0 - wRoad) * (1.0 - smoothstep(kerbW - fwd, kerbW + fwd, d)) : 0.0;
  float walk = 0.0;
  if (kerbed && sw > 0.1) {
    walk = max(1.0 - smoothstep(sw - fwd, sw + fwd, d), 1.0 - smoothstep(sw + ${glslFloat(FRONTAGE)} - fwb, sw + ${glslFloat(FRONTAGE)} + fwb, d + bd));
  }
  float rest = max(0.0, 1.0 - wRoad - wKerb);
  float wWalk = rest * walk;
  rest = max(0.0, rest - wWalk);
  float wPath = rest * (1.0 - smoothstep(-fwp, fwp, pd));
  float wGround = max(0.0, rest - wPath);
  if (face) {
    wRoad = 0.0;
    wWalk = 0.0;
    wPath = 0.0;
    wGround = 0.0;
    wKerb = 1.0;
  }

  int roadMat = surf;
  int groundMat = int(uGroundMap[clamp(groundId, 0, 15)] + 0.5);

  vec3 alb = vec3(0.0);
  float rough = 0.0;
  vec3 tn = vec3(0.0);
  gSample(roadMat, wRoad, p, gx, gy, sAng, alb, rough, tn);
  if (face) {
    // Kerb face: project the stone on the face itself (along the kerb, up), with its own joints every 0.9 m.
    vec2 fp = vec2(dot(vGW.xz, normalize(vec2(vGN.z, -vGN.x))), vGW.y * 1.6);
    gSample(${M.Kerb}, 1.0, fp, dFdx(fp), dFdy(fp), 0.0, alb, rough, tn);
    alb *= 1.0 - 0.3 * (1.0 - smoothstep(0.0, 0.03, abs(fract(fp.x / 0.9) - 0.5) - 0.465));
  } else {
    gSample(${M.Kerb}, wKerb, p, gx, gy, 0.0, alb, rough, tn);
  }
  gSample(${M.Sidewalk}, wWalk, p, gx, gy, sAng, alb, rough, tn);
  gSample(pathSurf == ${Surf.Pavers} ? ${M.Sidewalk} : pathSurf, wPath, p, gx, gy, 0.0, alb, rough, tn);
  gSample(groundMat, wGround, p, gx, gy, 0.0, alb, rough, tn);

  // Large-scale wear: patches on asphalt, dirt towards the facades, lighter kerb joints.
  float big = vnoise2(p * 0.06);
  alb *= 0.9 + 0.2 * big;
  if (roadMat == ${M.Asphalt}) {
    // Utility trench patches: street-aligned rectangles (7 x 2.6 m cells), a few percent of them re-surfaced.
    vec2 cellP = sp / vec2(7.0, 2.6) + (vnoise2(p * 0.4) - 0.5) * 0.08;
    vec2 cell = floor(cellP);
    float hc = hash12(cell + sAng * 17.0);
    float inPatch = step(0.86, hc) * wRoad;
    alb *= mix(1.0, mix(0.72, 1.14, hash12(cell * 1.7 + 3.1)), inPatch);
    rough *= mix(1.0, 0.92, inPatch);
    // Wheel tracks (darker, smoother) and the oil strip in the lane centre, counted from the nearest kerb.
    float e = mod(max(0.0, -d), 3.3);
    float track = (smoothstep(0.6, 0.75, e) - smoothstep(1.0, 1.15, e)) + (smoothstep(2.35, 2.5, e) - smoothstep(2.75, 2.9, e));
    float oil = (smoothstep(1.5, 1.62, e) - smoothstep(1.78, 1.9, e)) * vnoise2(vec2(sp.x * 0.35, sp.y));
    float wear = wRoad * smoothstep(-1.2, -2.0, d) * (0.6 + 0.4 * vnoise2(vec2(sp.x * 0.05, sp.y * 0.5)));
    alb *= 1.0 - wear * (0.035 * track + 0.07 * oil);
    rough *= 1.0 - 0.06 * wear * track;
    // Gutter: dark dirty strip along kerbs.
    alb *= 1.0 - 0.35 * wRoad * (kerbed ? 1.0 - smoothstep(-0.45, -0.05, d) : 0.0);
  }
  if (kerbed && !face && wKerb > 0.01) {
    // Joints across the kerb stones every ~0.9 m (tangent = perpendicular to the world gradient of d).
    float det = gx.x * gy.y - gx.y * gy.x;
    vec2 grad = abs(det) > 1e-10 ? vec2(gy.y * dFdx(d) - gx.y * dFdy(d), -gy.x * dFdx(d) + gx.x * dFdy(d)) / det : vec2(1.0, 0.0);
    vec2 tang = normalize(vec2(-grad.y, grad.x) + 1e-6);
    float along = dot(p, tang);
    alb *= 1.0 - 0.3 * wKerb * (1.0 - smoothstep(0.0, 0.03, abs(fract(along / 0.9) - 0.5) - 0.465));
  }
  alb *= mix(1.0, 0.82, (wWalk + wGround) * (1.0 - smoothstep(0.0, 1.2, bd)));

  vec3 N = normalize(vGN);
  vec3 T = normalize(abs(N.y) > 0.5 ? vec3(1.0, 0.0, 0.0) - N * N.x : cross(vec3(0.0, 1.0, 0.0), N));
  vec3 B = cross(N, T);
  gN = normalize(T * tn.x + B * tn.y + N * max(tn.z, 0.2));
  if (face) {
    // Kerb face: slightly darker, AO towards the gutter.
    alb *= 0.78;
  }
  gRough = clamp(rough, 0.25, 1.0);
  diffuseColor.rgb = alb;

  if (uNight > 0.02) {
    gEmis = alb * streetLight(p, min(1.0, wRoad + wWalk + wKerb + wPath)) * smoothstep(0.06, 0.5, uNight);
  }

  float fadeEdge = min(min(p.x - uFade.x, uFade.z - p.x), min(p.y - uFade.y, uFade.w - p.y));
  if (fadeEdge < 34.0 * vnoise2(p * 0.035)) discard;
}
`;

const PROPS_GLOW = /* glsl */ `
// aGlow: 0 none; 1 lamp glass (colour from the instance's aLight: 1 sodium, 2 LED, 3 / 0 warm white);
// 2 backlit panel; 3..5 traffic signal red / amber / green (always on, cycling per junction).
if (vGlow > 0.5) {
  float lightsOn = smoothstep(0.06, 0.5, uNight);
  if (vGlow < 1.5) {
    vec3 lampCol = vLight < 0.5 ? ${rgb(LIGHT_RGB[Light.Warm])} : vLight < 1.5 ? ${rgb(LIGHT_RGB[Light.Sodium])} : vLight < 2.5 ? ${rgb(LIGHT_RGB[Light.Led])} : ${rgb(LIGHT_RGB[Light.Warm])};
    totalEmissiveRadiance += lampCol * 18.0 * lightsOn;
    diffuseColor.rgb = mix(diffuseColor.rgb, lampCol, lightsOn);
  } else if (vGlow < 2.5) {
    totalEmissiveRadiance += vec3(0.95, 0.95, 1.0) * 3.5 * lightsOn;
  } else {
    float phase = fract(uTime / 40.0 + vSignal);
    float state = phase < 0.45 ? 5.0 : phase < 0.52 ? 4.0 : 3.0;
    float on = 1.0 - step(0.5, abs(vGlow - state));
    vec3 col = vGlow < 3.5 ? vec3(1.0, 0.08, 0.04) : vGlow < 4.5 ? vec3(1.0, 0.55, 0.05) : vec3(0.1, 1.0, 0.45);
    totalEmissiveRadiance += col * on * mix(4.0, 14.0, lightsOn);
    diffuseColor.rgb = mix(diffuseColor.rgb, col * 0.25, on);
  }
}
`;

export interface StreetMaterials {
  ground: THREE.MeshStandardMaterial;
  paint: THREE.MeshStandardMaterial;
  rails: THREE.MeshStandardMaterial;
  /** Instanced street furniture: vertex colours, `aGlow` (see PROPS_GLOW). */
  props: THREE.MeshStandardMaterial;
  /** Steps, platforms, quay walls: UVs in metres (`aUvM`) into the ground texture arrays (`aLayer`), vertex colours. */
  masonry: THREE.MeshStandardMaterial;
  /** Masonry draped on the ground (tram track beds), pulled in front of it. */
  inlay: THREE.MeshStandardMaterial;
  /** Thin overhead wires. */
  wire: THREE.MeshBasicMaterial;
  /** Street raster and light pool textures plus the rect whose edge the ground fades out at. */
  setStreetMask(raster: StreetRaster, pool: LightPool, fade: WorldBounds): void;
  ready: Promise<void>;
  dispose(): void;
}

export function createStreetMaterials(renderer: THREE.WebGLRenderer): StreetMaterials {
  const aniso = maxAnisotropy(renderer);
  const textures: THREE.Texture[] = [];
  const groundMap = new Array(16).fill(M.Lot);
  for (const [g, m] of Object.entries(GROUND_TO_MAT)) {
    groundMap[Number(g)] = m;
  }
  const arrays = {
    uGroundAlb: { value: null as THREE.Texture | null },
    uGroundNrm: { value: null as THREE.Texture | null },
    uRep: { value: GROUND_LAYERS.map((s) => REPEAT_M[s]) },
  };
  const pools = {
    uStreetPool: { value: null as THREE.Texture | null },
    uPoolXf: { value: new THREE.Vector4() },
  };
  const groundUniforms = {
    ...arrays,
    ...pools,
    uStreetMask: { value: null as THREE.Texture | null },
    uStreetIds: { value: null as THREE.Texture | null },
    uMaskXf: { value: new THREE.Vector4() },
    uMaskSize: { value: new THREE.Vector2(1, 1) },
    uFade: { value: new THREE.Vector4() },
    uGroundMap: { value: groundMap },
  };
  const ground = new THREE.MeshStandardMaterial({ name: 'ground', roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  patchMaterial(ground, 'osm-ground-v4', (shader) => {
    Object.assign(shader.uniforms, groundUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGW;\nvarying vec3 vGN;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvGW = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvGN = normalize(mat3(modelMatrix) * objectNormal);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <fog_pars_fragment>', `#include <fog_pars_fragment>\n${GROUND_FRAGMENT_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${GROUND_MAIN}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = gRough;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n  normal = normalize((viewMatrix * vec4(gN, 0.0)).xyz);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += gEmis;');
  });

  const paint = new THREE.MeshStandardMaterial({ name: 'paint', vertexColors: true, roughness: 0.62, metalness: 0, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 });
  const rails = new THREE.MeshStandardMaterial({ name: 'rails', vertexColors: true, roughness: 0.42, metalness: 0.8, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 });

  const props = new THREE.MeshStandardMaterial({ name: 'street-props', vertexColors: true, roughness: 0.5, metalness: 0.35 });
  patchMaterial(props, 'osm-street-props-v3', (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aGlow;\nattribute float aLight;\nvarying float vGlow;\nvarying float vLight;\nvarying float vSignal;')
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nvGlow = aGlow;\nvLight = aLight;\n#ifdef USE_INSTANCING\nvSignal = fract(floor(instanceMatrix[3].x / 40.0) * 0.137 + floor(instanceMatrix[3].z / 40.0) * 0.071);\n#else\nvSignal = 0.0;\n#endif',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGlow;\nvarying float vLight;\nvarying float vSignal;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${PROPS_GLOW}`);
  });

  const patchMasonry = (m: THREE.MeshStandardMaterial, key: string): void => {
    patchMaterial(m, key, (shader) => {
      Object.assign(shader.uniforms, arrays, pools);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 aUvM;\nattribute float aLayer;\nvarying vec2 vUvM;\nvarying float vLayer;\nvarying vec3 vMW;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvUvM = aUvM;\nvLayer = aLayer;\nvMW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>\nuniform highp sampler2DArray uGroundAlb;\nuniform highp sampler2DArray uGroundNrm;\nuniform float uRep[${GROUND_LAYERS.length}];\nvarying vec2 vUvM;\nvarying float vLayer;\nvarying vec3 vMW;\n${POOL_GLSL}`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
  int mLi = int(vLayer + 0.5);
  vec2 mUv = vUvM / uRep[mLi];
  vec4 mA = texture(uGroundAlb, vec3(mUv, vLayer));
  diffuseColor.rgb *= mix(vec3(dot(mA.rgb, vec3(0.2126, 0.7152, 0.0722))), mA.rgb, 0.3) * 1.6;
  float mRough = mA.a;`,
        )
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = clamp(mRough, 0.4, 1.0);')
        .replace(
          '#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\n  if (uNight > 0.02) totalEmissiveRadiance += diffuseColor.rgb * streetLight(vMW.xz, 1.0) * smoothstep(0.06, 0.5, uNight);',
        );
    });
  };
  const masonry = new THREE.MeshStandardMaterial({ name: 'masonry', vertexColors: true, roughness: 0.9, metalness: 0 });
  patchMasonry(masonry, 'osm-masonry-v2');
  const inlay = new THREE.MeshStandardMaterial({ name: 'inlay', vertexColors: true, roughness: 0.9, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  patchMasonry(inlay, 'osm-inlay-v1');
  const wire = new THREE.MeshBasicMaterial({ name: 'wire', color: 0x16181a });

  const ready = loadPbrArrays(GROUND_LAYERS, ARRAY_SIZE, aniso).then(([a, n]) => {
    arrays.uGroundAlb.value = a;
    arrays.uGroundNrm.value = n;
    textures.push(a, n);
  });

  return {
    ground,
    paint,
    rails,
    props,
    masonry,
    inlay,
    wire,
    setStreetMask(raster, pool, fade) {
      const mask = new THREE.DataTexture(raster.rgba, raster.w, raster.h, THREE.RGBAFormat, THREE.UnsignedByteType);
      mask.minFilter = THREE.LinearMipmapLinearFilter;
      mask.magFilter = THREE.LinearFilter;
      mask.generateMipmaps = true;
      mask.needsUpdate = true;
      const ids = new THREE.DataTexture(raster.ids, raster.w, raster.h, THREE.RGBAFormat, THREE.UnsignedByteType);
      ids.minFilter = THREE.NearestFilter;
      ids.magFilter = THREE.NearestFilter;
      ids.generateMipmaps = false;
      ids.needsUpdate = true;
      const light = new THREE.DataTexture(pool.data, pool.w, pool.h, THREE.RGBAFormat, THREE.UnsignedByteType);
      light.minFilter = THREE.LinearMipmapLinearFilter;
      light.magFilter = THREE.LinearFilter;
      light.generateMipmaps = true;
      light.needsUpdate = true;
      groundUniforms.uStreetMask.value = mask;
      groundUniforms.uStreetIds.value = ids;
      pools.uStreetPool.value = light;
      groundUniforms.uMaskXf.value.set(raster.minX, raster.minZ, 1 / (raster.w * raster.px), 1 / (raster.h * raster.px));
      groundUniforms.uMaskSize.value.set(raster.w, raster.h);
      pools.uPoolXf.value.set(pool.minX, pool.minZ, 1 / (pool.w * pool.px), 1 / (pool.h * pool.px));
      groundUniforms.uFade.value.set(fade.minX, fade.minZ, fade.maxX, fade.maxZ);
      textures.push(mask, ids, light);
    },
    ready,
    dispose() {
      for (const t of textures) {
        t.dispose();
      }
      for (const m of [ground, paint, rails, props, masonry, inlay, wire]) {
        m.dispose();
      }
    },
  };
}
