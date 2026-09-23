import * as THREE from 'three';
import { LANDMARKS, fingerJoints, FINGERS } from '../anatomy';
import { WING_UV } from '../geometry/wings';
import type { TextureBaker } from './texture-baker';
import { drawVeinCanvas, type PlaneBone } from './vein-tree';

/**
 * Wing membrane maps baked in wing-plane space (right wing rest pose; the left wing mirrors x).
 * data texture: R = vein density, G = thickness (bones, edges), B = wrinkle height, A = mottling.
 * The vessel tree is grown on the CPU and rasterised into a canvas; the GPU pass adds the continuous fields.
 */
const DATA = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform vec4 uSeg[12];
uniform int uSegCount;
uniform vec2 uScale;
uniform vec2 uOrigin;
uniform sampler2D tVeins;

float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vn(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h12(i), h12(i + vec2(1, 0)), u.x), mix(h12(i + vec2(0, 1)), h12(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * vn(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }

void main() {
  vec2 p = uOrigin + vUv * uScale; // meters in the wing plane (x span, y = z chord)
  // Smooth-min distance to the bones (continuous across the zones between bones).
  float k = 0.0;
  float dBone = 1e3;
  for (int i = 0; i < 12; i++) {
    if (i >= uSegCount) break;
    vec2 a = uSeg[i].xy;
    vec2 b = uSeg[i].zw;
    vec2 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    float d = length(pa - ba * h);
    dBone = min(dBone, d);
    k += exp(-d * 9.0);
  }
  float Y = -log(max(k, 1e-6)) / 9.0;
  vec2 warp = vec2(fbm(p * 1.1), fbm(p * 1.1 + 5.2)) - 0.5;
  float veins = texture2D(tVeins, vUv).r;
  // Fine creases: slack skin folds parallel to the bones (level sets of the smooth distance), broken up by noise.
  float creaseMask = smoothstep(0.35, 0.8, fbm(p * 1.7 + 7.0)) * (1.0 - smoothstep(0.6, 1.8, Y));
  float crease = (0.5 + 0.5 * sin((Y + warp.y * 0.35) * 48.0)) * creaseMask;
  float skinGrain = fbm(p * vec2(9.0, 5.0) + warp * 3.0);
  float boneNear = exp(-dBone * 5.0);
  float wrinkle = crease * 0.1 + skinGrain * 0.45 + boneNear * 0.12 * fbm(p * 14.0);
  float thickness = clamp(boneNear * 0.9 + 0.1 * fbm(p * 1.3), 0.0, 1.0);
  float mottle = fbm(p * 1.6 + 3.3);
  gl_FragColor = vec4(veins, thickness, clamp(wrinkle, 0.0, 1.0), mottle);
}
`;

const NORMAL = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tData;
uniform vec2 uTexel;
uniform float uStrength;
float height(vec2 uv) {
  vec4 d = texture2D(tData, uv);
  return d.b + d.r * 0.45;
}
void main() {
  float l = height(vUv - vec2(uTexel.x, 0.0));
  float r = height(vUv + vec2(uTexel.x, 0.0));
  float d = height(vUv - vec2(0.0, uTexel.y));
  float u = height(vUv + vec2(0.0, uTexel.y));
  vec3 n = normalize(vec3((l - r) * uStrength, (d - u) * uStrength, 1.0));
  gl_FragColor = vec4(n * 0.5 + 0.5, 1.0);
}
`;

export interface MembraneTextures {
  data: THREE.Texture;
  normal: THREE.Texture;
  targets: THREE.WebGLRenderTarget[];
}

function toPlane(p: THREE.Vector3): THREE.Vector2 {
  return new THREE.Vector2(Math.abs(p.x), p.z);
}

function planeBones(): PlaneBone[] {
  const bones: PlaneBone[] = [];
  const push = (a: THREE.Vector3, b: THREE.Vector3, group: number, startClear: number): void => {
    const pa = toPlane(a);
    const pb = toPlane(b);
    bones.push({ ax: pa.x, ay: pa.y, bx: pb.x, by: pb.y, group, startClear });
  };
  push(LANDMARKS.shoulder, LANDMARKS.elbow, 0, 0.25);
  push(LANDMARKS.elbow, LANDMARKS.wrist, 0, 0.0);
  fingerJoints('R').forEach((j, f) => {
    push(j[0], j[1], 1 + f, 0.45);
    push(j[1], j[2], 1 + f, 0.0);
  });
  push(LANDMARKS.shoulder, new THREE.Vector3(0.9, 0, 1.9), 1 + FINGERS.length, 0.3);
  return bones;
}

export function bakeMembraneTextures(baker: TextureBaker, width: number, anisotropy: number): MembraneTextures {
  const height = width / 2;
  const bones = planeBones();
  const segs = bones.map((b) => new THREE.Vector4(b.ax, b.ay, b.bx, b.by));
  const segCount = segs.length;
  while (segs.length < 12) {
    segs.push(new THREE.Vector4(-100, -100, -100, -100));
  }
  const veinCanvas = drawVeinCanvas({
    width,
    height,
    originX: WING_UV.x0,
    originY: WING_UV.z0,
    sizeX: WING_UV.width,
    sizeY: WING_UV.depth,
    bones,
    seed: 90210,
  });
  const veinTex = new THREE.CanvasTexture(veinCanvas);
  veinTex.flipY = false;
  veinTex.colorSpace = THREE.NoColorSpace;
  veinTex.generateMipmaps = false;
  veinTex.minFilter = THREE.LinearFilter;
  veinTex.magFilter = THREE.LinearFilter;
  const data = baker.createTarget({ width, height, mipmaps: true, wrap: THREE.ClampToEdgeWrapping, anisotropy });
  baker.bake(data, DATA, {
    uSeg: { value: segs },
    uSegCount: { value: segCount },
    uScale: { value: new THREE.Vector2(WING_UV.width, WING_UV.depth) },
    uOrigin: { value: new THREE.Vector2(WING_UV.x0, WING_UV.z0) },
    tVeins: { value: veinTex },
  });
  veinTex.dispose();
  const normal = baker.createTarget({ width, height, mipmaps: true, wrap: THREE.ClampToEdgeWrapping, anisotropy });
  baker.bake(normal, NORMAL, { tData: { value: data.texture }, uTexel: { value: new THREE.Vector2(1 / width, 1 / height) }, uStrength: { value: 1.6 * (width / 2048) } });
  return { data: data.texture, normal: normal.texture, targets: [data, normal] };
}
