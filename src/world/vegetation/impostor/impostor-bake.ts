import * as THREE from 'three';
import { SPECIES_COUNT, SPECIES_SHAPES, FIRST_LEAF_LAYER } from '../species';
import { createArrayTarget, finishMipmaps, LayerRenderer } from '../textures/bake-textures';
import { OCTAHEDRAL_GLSL } from './octahedral.glsl';

/**
 * Hemi-octahedral impostors: every species' LOD0 mesh is rendered orthographically from N x N directions over
 * the upper hemisphere into one layer of an array atlas (albedo + packed view-space normal / AO / translucency).
 */
export interface ImpostorAtlas {
  readonly target: THREE.WebGLArrayRenderTarget;
  readonly albedo: THREE.Texture;
  readonly normal: THREE.Texture;
  readonly frames: number;
  dispose(): void;
}

const BAKE_VERTEX = /* glsl */ `
in vec3 aTex;
in vec4 aCard;
in vec3 aCorner;
out vec3 vTex;
out vec3 vObjPos;
out vec3 vObjNormal;
out float vAO;
out float vLeaf;
void main() {
  vec3 p = position;
  if (aCard.w > 0.0) {
    vec3 center = position + aCard.xyz;
    vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    p = mix(p, center + camRight * aCorner.x + camUp * aCorner.y, aCard.w);
  }
  vObjPos = p;
  vObjNormal = normal;
  vTex = aTex;
  vAO = aCorner.z;
  vLeaf = aTex.z >= ${FIRST_LEAF_LAYER.toFixed(1)} ? 1.0 : 0.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const BAKE_FRAGMENT = /* glsl */ `
precision highp float;
precision highp sampler2DArray;
in vec3 vTex;
in vec3 vObjPos;
in vec3 vObjNormal;
in float vAO;
in float vLeaf;
layout(location = 0) out vec4 outAlbedo;
layout(location = 1) out vec4 outNormal;
uniform sampler2DArray uAlbedo;
uniform sampler2DArray uNormal;
uniform float uTranslucency;
uniform float uNormalStrength;
${OCTAHEDRAL_GLSL}
void main() {
  vec4 a = texture(uAlbedo, vTex);
  if (a.a < 0.5) discard;
  vec4 nm = texture(uNormal, vTex);
  vec3 N = normalize(vObjNormal);
  if (vLeaf < 0.5 && !gl_FrontFacing) N = -N;
  vec3 q0 = dFdx(vObjPos);
  vec3 q1 = dFdy(vObjPos);
  vec2 st0 = dFdx(vTex.xy);
  vec2 st1 = dFdy(vTex.xy);
  vec3 q1perp = cross(q1, N);
  vec3 q0perp = cross(N, q0);
  vec3 T = q1perp * st0.x + q0perp * st1.x;
  vec3 B = q1perp * st0.y + q0perp * st1.y;
  float det = max(dot(T, T), dot(B, B));
  float s = det == 0.0 ? 0.0 : inversesqrt(det);
  vec3 m = vec3(nm.rg * 2.0 - 1.0, 0.0);
  m.xy *= mix(1.0, uNormalStrength, vLeaf);
  m.z = sqrt(max(1.0 - dot(m.xy, m.xy), 0.0));
  vec3 n = normalize(mat3(T * s, B * s, N) * m);
  vec3 nView = normalize((viewMatrix * vec4(n, 0.0)).xyz);
  float ao = vAO * mix(1.0, nm.b, 0.8);
  outAlbedo = vec4(a.rgb, 1.0);
  outNormal = vec4(packViewNormal(nView), ao, vLeaf * nm.a * uTranslucency);
}
`;

const CLEAR_VERTEX = /* glsl */ `
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
const CLEAR_FRAGMENT = /* glsl */ `
precision highp float;
layout(location = 0) out vec4 outAlbedo;
layout(location = 1) out vec4 outNormal;
uniform vec3 uColor;
void main() {
  outAlbedo = vec4(uColor, 0.0);
  outNormal = vec4(0.5, 0.5, 0.8, 0.0);
}
`;

/** Direction (tree local, toward the viewer) of frame (i, j); mirrors hemiOctDecode in GLSL. */
export function frameDirection(i: number, j: number, n: number, out: THREE.Vector3): THREE.Vector3 {
  const fx = (i / (n - 1)) * 2 - 1;
  const fy = (j / (n - 1)) * 2 - 1;
  const px = (fx + fy) * 0.5;
  const pz = (fx - fy) * 0.5;
  return out.set(px, 1 - Math.abs(px) - Math.abs(pz), pz).normalize();
}

export interface ImpostorSource {
  geometry: THREE.BufferGeometry;
  centerY: number;
  /** Frame half size (m). */
  radius: number;
  /** Bounding sphere radius (m): places the bake camera and its depth range. */
  sphere: number;
}

/** Foliage mean colours used for the transparent background (keeps mip edges from darkening). */
const BACKGROUND: [number, number, number][] = [
  [0.07, 0.1, 0.05],
  [0.04, 0.07, 0.03],
  [0.03, 0.05, 0.025],
  [0.08, 0.13, 0.04],
  [0.06, 0.1, 0.035],
  [0.08, 0.11, 0.045],
];

export function bakeImpostors(
  renderer: THREE.WebGLRenderer,
  sources: ImpostorSource[],
  textures: { albedo: THREE.Texture; normal: THREE.Texture },
  frames: number,
  frameSize: number,
  anisotropy: number,
): ImpostorAtlas {
  const size = frames * frameSize;
  const target = createArrayTarget(size, SPECIES_COUNT, anisotropy, THREE.ClampToEdgeWrapping, true);
  const lr = new LayerRenderer(renderer);
  const bakeMat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: BAKE_VERTEX,
    fragmentShader: BAKE_FRAGMENT,
    uniforms: {
      uAlbedo: { value: textures.albedo },
      uNormal: { value: textures.normal },
      uTranslucency: { value: 1 },
      uNormalStrength: { value: 1 },
    },
    side: THREE.DoubleSide,
  });
  const clearMat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: CLEAR_VERTEX,
    fragmentShader: CLEAR_FRAGMENT,
    uniforms: { uColor: { value: new THREE.Vector3() } },
    depthTest: false,
    depthWrite: false,
  });
  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const clearMesh = new THREE.Mesh(tri, clearMat);
  clearMesh.frustumCulled = false;
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  const dir = new THREE.Vector3();
  const center = new THREE.Vector3();

  for (let s = 0; s < sources.length; s++) {
    const src = sources[s];
    target.viewport.set(0, 0, size, size);
    target.scissor.set(0, 0, size, size);
    target.scissorTest = false;
    clearMat.uniforms.uColor.value.set(...BACKGROUND[s]);
    lr.draw(target, s, clearMesh);
    renderer.clearDepth();
    const look = SPECIES_SHAPES[s].leafLook;
    bakeMat.uniforms.uTranslucency.value = look[1];
    bakeMat.uniforms.uNormalStrength.value = look[3];
    const mesh = new THREE.Mesh(src.geometry, bakeMat);
    mesh.frustumCulled = false;
    const R = src.radius;
    center.set(0, src.centerY, 0);
    for (let j = 0; j < frames; j++) {
      for (let i = 0; i < frames; i++) {
        frameDirection(i, j, frames, dir);
        cam.left = -R;
        cam.right = R;
        cam.top = R;
        cam.bottom = -R;
        cam.near = 0.1;
        cam.far = src.sphere * 4;
        cam.up.set(0, 1, 0);
        if (Math.abs(dir.y) > 0.999) {
          cam.up.set(0, 0, -1);
        }
        cam.position.copy(center).addScaledVector(dir, src.sphere * 2);
        cam.lookAt(center);
        cam.updateProjectionMatrix();
        cam.updateMatrixWorld();
        target.viewport.set(i * frameSize, j * frameSize, frameSize, frameSize);
        target.scissor.copy(target.viewport);
        target.scissorTest = true;
        lr.draw(target, s, mesh, cam);
      }
    }
  }
  target.viewport.set(0, 0, size, size);
  target.scissor.set(0, 0, size, size);
  target.scissorTest = false;
  finishMipmaps(renderer, target, lr);
  lr.restore();
  bakeMat.dispose();
  clearMat.dispose();
  tri.dispose();
  return { target, albedo: target.textures[0], normal: target.textures[1], frames, dispose: () => target.dispose() };
}
