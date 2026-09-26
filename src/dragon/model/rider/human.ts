/**
 * The rider built by the Blender pipeline (tools/humans/build_rider.py): a skinned glTF bound in the neutral standing
 * pose, Mixamo-named skeleton, facing +Z with the feet at the origin (glTF / MakeHuman convention), with pose clips
 * ("stand", "ride"). On the dragon it plays "ride", is turned to face the dragon's -Z and its hips placed on the seat,
 * under the dragon's chest bone so it rides with the body. The same skin takes any Mixamo clip (glide, land, walk, run).
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { patchMaterial } from '../../../core/uniforms';

/** Where the hips joint sits on the saddle (rig space). */
export const SEAT_HIPS = new THREE.Vector3(0, 1.2, -2.52);

export interface HumanRider {
  root: THREE.Object3D;
  meshes: THREE.SkinnedMesh[];
  bones: Map<string, THREE.Bone>;
  mixer: THREE.AnimationMixer;
  clips: Map<string, THREE.AnimationClip>;
}

export async function loadHumanRider(url: string, anchor: THREE.Object3D, anchorRest: THREE.Vector3): Promise<HumanRider> {
  const gltf = await new GLTFLoader().loadAsync(url);
  const root = gltf.scene;
  root.name = 'rider-human';
  const meshes: THREE.SkinnedMesh[] = [];
  const bones = new Map<string, THREE.Bone>();
  root.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (m.isSkinnedMesh) {
      meshes.push(m);
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats as THREE.MeshStandardMaterial[]) {
        // Cards (hair, brows, lashes) are alpha-tested; skin is matte.
        if (mat.map && (mat.transparent || mat.alphaTest > 0 || /hair|brow|lash/i.test(mat.name + m.name))) {
          mat.transparent = false;
          mat.alphaTest = 0.5;
          mat.side = THREE.DoubleSide;
          mat.depthWrite = true;
        }
      }
    }
    const b = o as THREE.Bone;
    if (b.isBone) {
      bones.set(b.name.replace(/^mixamorig:?/, ''), b);
    }
  });
  const mixer = new THREE.AnimationMixer(root);
  const clips = new Map(gltf.animations.map((c) => [c.name, c]));
  const ride = clips.get('ride');
  if (ride) {
    mixer.clipAction(ride).play();
    mixer.update(0);
  }
  const hips = bones.get('Hips');
  root.updateMatrixWorld(true);
  const hipsPos = hips ? hips.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(0, 1.1, 0);
  // Face -Z (turn half a turn about Y), hips onto the seat, expressed relative to the anchor bone's rest.
  root.rotation.set(0, Math.PI, 0);
  const turned = hipsPos.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
  root.position.copy(SEAT_HIPS).sub(turned).sub(anchorRest);
  anchor.add(root);
  const rider = { root, meshes, bones, mixer, clips };
  applyGarmentMaterials(rider);
  return rider;
}

/** Scanned CC0 texture sets (public/textures/rider/, see LICENSES.md) and their real size (m). */
interface ClothSet {
  base: string;
  size: number;
  ao: boolean;
}
const SETS: Record<string, ClothSet> = {
  velvet: { base: 'velour_velvet', size: 0.28, ao: true },
  linen: { base: 'rough_linen', size: 0.27, ao: true },
  leather: { base: 'brown_leather', size: 0.4, ao: true },
  satin: { base: 'crepe_satin', size: 0.27, ao: true },
  mail: { base: 'chainmail002', size: 0.12, ao: false },
  steel: { base: 'metal038', size: 0.35, ao: false },
};

/** Which set and look each exported material id gets. */
const LOOKS: Record<string, { set?: string; sheen?: number; sheenRough?: number; rough?: number; metal?: number; tint?: number }> = {
  primary: { set: 'velvet', sheen: 1, sheenRough: 0.35 },
  secondary: { set: 'linen', sheen: 0.4, sheenRough: 0.6 },
  linen: { set: 'linen', sheen: 0.4, sheenRough: 0.6 },
  accent: { set: 'satin', sheen: 0.6, sheenRough: 0.25, rough: 0.45 },
  leather: { set: 'leather' },
  darkLeather: { set: 'leather', tint: 0.4 },
  mail: { set: 'mail', metal: 1 },
  // Worn steel (hammered, scratched, smudged) and the same scan tinted for the gilt fittings.
  iron: { set: 'steel', metal: 1, rough: 1 },
  metal: { set: 'steel', metal: 1, rough: 0.8 },
  fur: { sheen: 1, sheenRough: 0.8, rough: 0.95 },
  feather: { set: 'linen', sheen: 0.8, sheenRough: 0.5, rough: 0.9 },
};

const textureLoader = new THREE.TextureLoader();
const textureCache = new Map<string, THREE.Texture>();
function tex(file: string, srgb: boolean): THREE.Texture {
  let t = textureCache.get(file);
  if (!t) {
    t = textureLoader.load(`${import.meta.env.BASE_URL}textures/rider/${file}`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 8;
    textureCache.set(file, t);
  }
  return t;
}

const TRIPLANAR_PARS = /* glsl */ `
varying vec3 vGdPos;
varying vec3 vGdNrm;
varying vec3 vGdRx;
varying vec3 vGdRy;
varying vec3 vGdRz;
uniform sampler2D tGdAlb;
uniform sampler2D tGdNor;
uniform sampler2D tGdRough;
uniform sampler2D tGdAO;
uniform float uGdScale;
uniform float uGdHasSet;
uniform float uGdHasAO;
uniform float uGdTintScale;
vec3 gdWeights() {
  vec3 w = pow(abs(normalize(vGdNrm)), vec3(4.0));
  return w / (w.x + w.y + w.z);
}
vec4 gdSample(sampler2D t) {
  vec3 w = gdWeights();
  vec3 p = vGdPos * uGdScale;
  return texture2D(t, p.zy) * w.x + texture2D(t, p.xz) * w.y + texture2D(t, p.xy) * w.z;
}
// Triplanar normal map (UDN blend) in object space, returned as a perturbation of the object normal.
vec3 gdNormalDelta() {
  vec3 n = normalize(vGdNrm);
  vec3 w = gdWeights();
  vec3 p = vGdPos * uGdScale;
  vec3 tx = texture2D(tGdNor, p.zy).xyz * 2.0 - 1.0;
  vec3 ty = texture2D(tGdNor, p.xz).xyz * 2.0 - 1.0;
  vec3 tz = texture2D(tGdNor, p.xy).xyz * 2.0 - 1.0;
  vec3 nx = vec3(0.0, tx.y, tx.x) * sign(n.x);
  vec3 ny = vec3(ty.x, 0.0, ty.y) * sign(n.y);
  vec3 nz = vec3(tz.x, tz.y, 0.0) * sign(n.z);
  return nx * w.x + ny * w.y + nz * w.z;
}
`;

/** Game material for a garment part exported as rider_<id>: scanned cloth / leather / mail with sheen. */
function garmentMaterial(src: THREE.MeshStandardMaterial, ao: boolean): THREE.Material {
  const id = src.name.replace(/^rider_/, '');
  const look = LOOKS[id] ?? {};
  const set = look.set ? SETS[look.set] : undefined;
  const m = new THREE.MeshPhysicalMaterial({
    color: src.color.clone().multiplyScalar(look.tint ?? 1),
    roughness: look.rough ?? 1,
    metalness: look.metal ?? 0,
    sheen: look.sheen ?? 0,
    sheenRoughness: look.sheenRough ?? 0.5,
    sheenColor: src.color.clone().lerp(new THREE.Color(1, 1, 1), 0.35),
    side: THREE.DoubleSide,
    alphaTest: id === 'mail' ? 0.4 : 0,
    vertexColors: ao,
  });
  m.name = src.name;
  const uniforms = {
    tGdAlb: { value: set ? tex(`${set.base}_diff.jpg`, true) : null },
    tGdNor: { value: set ? tex(`${set.base}_nor.jpg`, false) : null },
    tGdRough: { value: set ? tex(`${set.base}_rough.jpg`, false) : null },
    tGdAO: { value: set && set.ao ? tex(`${set.base}_ao.jpg`, false) : null },
    uGdScale: { value: set ? 1 / set.size : 1 },
    uGdHasSet: { value: set ? 1 : 0 },
    uGdHasAO: { value: set && set.ao ? 1 : 0 },
    uGdTintScale: { value: 1 },
  };
  patchMaterial(m, `rider-garment-${set ? set.base : 'plain'}${ao ? '-ao' : ''}`, (shader) => {
    Object.assign(shader.uniforms, uniforms);
    // Baked ambient occlusion (vertex colour 'ao'): folds, the gaps under the sash and the vest, the inside of the collar.
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      '#if defined( USE_COLOR )\n  float gdBakedAO = vColor.r;\n  diffuseColor.rgb *= mix(0.25, 1.0, gdBakedAO);\n#endif',
    );
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGdPos;\nvarying vec3 vGdNrm;\nvarying vec3 vGdRx;\nvarying vec3 vGdRy;\nvarying vec3 vGdRz;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGdPos = position;\nvGdNrm = objectNormal;\nvGdRx = normalMatrix[0];\nvGdRy = normalMatrix[1];\nvGdRz = normalMatrix[2];');
    if (!set) {
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${TRIPLANAR_PARS}`);
      return;
    }
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${TRIPLANAR_PARS}`)
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
// The scan's own colour becomes relative light/dark detail (luminance about 1), tinted by the palette colour.
vec3 gdAlb = gdSample(tGdAlb).rgb;
float gdLum = dot(gdAlb, vec3(0.299, 0.587, 0.114));
diffuseColor.rgb *= clamp(gdLum / 0.35, 0.35, 1.8);
float gdAO = uGdHasAO > 0.5 ? gdSample(tGdAO).r : 1.0;
diffuseColor.rgb *= mix(0.55, 1.0, gdAO);`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor *= gdSample(tGdRough).g * 1.1 + 0.05;')
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
normal = normalize(normal + mat3(vGdRx, vGdRy, vGdRz) * gdNormalDelta() * 0.9);`,
      )
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>\nreflectedLight.indirectDiffuse *= mix(0.5, 1.0, gdAO);');
  });
  return m;
}

/** Swaps the file's flat garment materials for the detailed game ones (by name). */
export function applyGarmentMaterials(rider: HumanRider): void {
  const cache = new Map<string, THREE.Material>();
  for (const mesh of rider.meshes) {
    const src = mesh.material as THREE.MeshStandardMaterial;
    if (!src || Array.isArray(src) || !src.name.startsWith('rider_')) {
      continue;
    }
    const ao = mesh.geometry.hasAttribute('color');
    const key = `${src.name}|${ao}`;
    let m = cache.get(key);
    if (!m) {
      m = garmentMaterial(src, ao);
      cache.set(key, m);
    }
    mesh.material = m;
  }
}
