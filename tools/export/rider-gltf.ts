/**
 * Exports the rider for other runtimes (the Unreal game): the character the web game seats on the dragon (the akıncı
 * from tools/humans/) as a skinned binary glTF, the saddle and bridle (the tack, skinned to the dragon's skeleton) as a
 * second glTF, the character's textures as PNGs, and what a runtime needs to seat, dress and pose it as JSON
 * (materials, the seat on the dragon, the reins).
 *
 * Runs inside the dragon sandbox page (it needs the loaded character and the rig that seats it), driven by
 * scripts/snap.mjs with `result` (the Unreal repository's tools/creatures/rider.mjs does this):
 *   { "url": "/sandbox/dragon.html?pose=glide&env=0&ground=0",
 *     "eval": "import('/tools/export/rider-gltf.ts?run=' + Date.now()).then((m) => m.exportRider())", "result": "<file>.json" }
 * (the dev server does not watch tools/: the query makes it read the current file). The result holds base64 files:
 * { files: { "rider.glb": ..., "saddle.glb": ..., "<texture>.png": ..., "rider.json": ... }, meta }.
 *
 * - Rider: the neutral riding pose (every rider cue at rest, the springs settled, retargeted onto the character as in
 *   the game) is baked into the mesh and becomes its bind pose, so a runtime's reference pose is what the web shows in
 *   the saddle; the rider frame is glTF's (feet at the origin, facing +Z). The look is the default one (helmet, armour,
 *   the akıncı palette); morph targets (face units) are left out; bones lose the "mixamorig" prefix. No clips: the
 *   on-foot clips stay in the web game, the riding motion is procedural.
 * - Saddle: the tack the rig builds for the character rider (blanket, saddle, girth straps, stirrups, bridle, the reins
 *   up to where they leave the neck) in the dragon's bind pose, one primitive per part material. Its skin is the
 *   dragon's skeleton, so a runtime drives it with the dragon's pose.
 * - Reins: their free spans (neck to fist, the bight between the fists) are simulated in the web game; the JSON gives
 *   the anchors and lengths for the runtime's own rope.
 * - Poses: the joints of the settled character for a few moments' rider cues, the reference a port of the riding motion
 *   is tested against.
 * Garment materials are procedural in the web game (scanned CC0 cloth, triplanar, tinted by the palette): the JSON gives
 * each one's palette colour times the scan's average shading, its roughness and metalness; the baked ambient occlusion
 * stays in the vertex colour (COLOR_0.r).
 */
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { DragonPose } from '../../src/core/contracts';
import type { DragonRigImpl } from '../../src/dragon/model/rig';
import { LOOKS, SEAT_HIPS, SETS, type HumanRider } from '../../src/dragon/model/rider/human';
import { LANDMARKS, RIDER, fistFrame } from '../../src/dragon/model/anatomy';
import { POMMEL_GRIP } from '../../src/dragon/model/animation/rider-pose';
import { RIDER_MAT } from '../../src/dragon/model/geometry/materials-ids';
import { BodySurface } from '../../src/dragon/model/geometry/body';
import { MeshBuilder } from '../../src/dragon/model/geometry/buffers';
import { buildTack } from '../../src/dragon/model/geometry/tack';
import { BIGHT, SLACK, THICK, WIDTH } from '../../src/dragon/model/rider/reins';

type Vec = [number, number, number];

/** Every rider cue at rest (the flight and bond cues included), so the settled pose is the neutral seat. */
const NEUTRAL: Partial<DragonPose> = {
  flapAmplitude: 0,
  riderLeanPitch: 0,
  riderLeanRoll: 0,
  riderReinLeft: 0,
  riderReinRight: 0,
  riderTuck: 0,
  riderPoint: 0,
  riderCheer: 0,
  riderPet: 0,
  riderStand: 0,
  riderLaugh: 0,
  riderShow: 0,
  riderShowYaw: 0,
  riderShowPitch: 0,
  riderPat: 0,
  gazeRider: 0,
};

/** Attributes the rider and saddle files keep (morph targets, tangents and the web's custom data are dropped). */
const KEEP = new Set(['position', 'normal', 'uv', 'color', 'skinIndex', 'skinWeight']);

const round = (x: number, d = 6): number => Math.round(x * 10 ** d) / 10 ** d;
const vec = (v: THREE.Vector3, d = 6): Vec => [round(v.x, d), round(v.y, d), round(v.z, d)];
const rgb = (c: THREE.Color): Vec => [round(c.r, 5), round(c.g, 5), round(c.b, 5)];

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function textFile(text: string): string {
  return toBase64(new TextEncoder().encode(text));
}

/** A loaded image (glTF textures keep the file's orientation) as a base64 PNG. */
async function imagePng(image: CanvasImageSource & { width: number; height: number }): Promise<{ png: string; width: number; height: number }> {
  const canvas = new OffscreenCanvas(image.width, image.height);
  canvas.getContext('2d')!.drawImage(image, 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return { png: toBase64(new Uint8Array(await blob.arrayBuffer())), width: image.width, height: image.height };
}

async function loadPixels(url: string, size: number): Promise<Uint8ClampedArray> {
  const bitmap = await createImageBitmap(await (await fetch(url)).blob());
  const canvas = new OffscreenCanvas(size, size);
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(bitmap, 0, 0, size, size);
  bitmap.close();
  return g.getImageData(0, 0, size, size).data;
}

const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/**
 * Average shading of a scanned cloth set as the garment shader applies it (human.ts garmentMaterial): the albedo's
 * luminance relative to 0.35 (clamped), its AO and ring mask darkening, and the roughness map's scale.
 */
async function scanAverages(base: string, ao: boolean, opacity: boolean): Promise<{ color: number; roughness: number }> {
  const size = 256;
  const root = `${import.meta.env.BASE_URL}textures/rider/${base}`;
  const alb = await loadPixels(`${root}_diff.jpg`, size);
  const rough = await loadPixels(`${root}_rough.jpg`, size);
  const occ = ao ? await loadPixels(`${root}_ao.jpg`, size) : undefined;
  const opa = opacity ? await loadPixels(`${root}_opacity.jpg`, size) : undefined;
  let color = 0;
  let r = 0;
  const n = size * size;
  for (let i = 0; i < n; i++) {
    const k = i * 4;
    const lum = 0.299 * srgbToLinear(alb[k] / 255) + 0.587 * srgbToLinear(alb[k + 1] / 255) + 0.114 * srgbToLinear(alb[k + 2] / 255);
    const a = occ ? occ[k] / 255 : 1;
    const o = opa ? opa[k] / 255 : 1;
    color += THREE.MathUtils.clamp(lum / 0.35, 0.35, 1.8) * (0.55 + 0.45 * a) * (0.4 + 0.6 * o);
    const g = (rough[k + 1] / 255) * 1.1 + 0.05;
    r += 1 + (g - 1) * o;
  }
  return { color: color / n, roughness: r / n };
}

/** Linear-blend skinning matrix of a vertex (world space, from the bones' current world matrices). */
function skinMatrix(mesh: THREE.SkinnedMesh, i: number, out: THREE.Matrix4): THREE.Matrix4 {
  const idx = mesh.geometry.getAttribute('skinIndex');
  const w = mesh.geometry.getAttribute('skinWeight');
  const bones = mesh.skeleton.bones;
  const inverses = mesh.skeleton.boneInverses;
  const e = out.elements;
  e.fill(0);
  const m = new THREE.Matrix4();
  for (let k = 0; k < 4; k++) {
    const weight = w.getComponent(i, k);
    if (weight === 0) continue;
    const j = idx.getComponent(i, k);
    m.multiplyMatrices(bones[j].matrixWorld, inverses[j]);
    for (let c = 0; c < 16; c++) e[c] += m.elements[c] * weight;
  }
  return out;
}

/**
 * Bakes the current pose into a skinned mesh (positions and normals in its own space, which is the rider frame like the
 * source's). Returns the largest distance between the baked vertices and three.js' own skinning of the source mesh, the
 * character still seated on the dragon (a check; both local spaces are the rider frame).
 */
function bakePose(mesh: THREE.SkinnedMesh, source: THREE.SkinnedMesh): number {
  const g = mesh.geometry.clone();
  g.morphAttributes = {};
  for (const name of Object.keys(g.attributes)) if (!KEEP.has(name)) g.deleteAttribute(name);
  mesh.geometry = g;
  mesh.morphTargetInfluences = undefined;
  mesh.morphTargetDictionary = undefined;
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const nor = g.getAttribute('normal') as THREE.BufferAttribute | undefined;
  mesh.updateMatrixWorld(true);
  const toLocal = mesh.matrixWorld.clone().invert();
  const M = new THREE.Matrix4();
  const N = new THREE.Matrix3();
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const check = new THREE.Vector3();
  const sourcePos = source.geometry.getAttribute('position');
  let err = 0;
  for (let i = 0; i < pos.count; i++) {
    skinMatrix(mesh, i, M).multiply(mesh.bindMatrix).premultiply(toLocal);
    p.fromBufferAttribute(pos, i).applyMatrix4(M);
    pos.setXYZ(i, p.x, p.y, p.z);
    if (nor) {
      N.setFromMatrix4(M);
      n.fromBufferAttribute(nor, i).applyMatrix3(N).normalize();
      nor.setXYZ(i, n.x, n.y, n.z);
    }
    if (i % 97 === 0) {
      source.applyBoneTransform(i, check.fromBufferAttribute(sourcePos, i));
      err = Math.max(err, check.distanceTo(p));
    }
  }
  pos.needsUpdate = true;
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return err;
}

/** Largest distance between a baked mesh's vertices and its skinning in the current pose (the rebind check). */
function rebindError(mesh: THREE.SkinnedMesh): number {
  const pos = mesh.geometry.getAttribute('position');
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  let err = 0;
  for (let i = 0; i < pos.count; i += 97) {
    a.fromBufferAttribute(pos, i);
    mesh.applyBoneTransform(i, b.copy(a));
    err = Math.max(err, a.distanceTo(b));
  }
  return err;
}

/** Export slot of a character material: human_<part> for the MakeHuman parts, rider_<id> for the garments. */
function slotName(material: THREE.Material): string {
  const name = material.name;
  if (name.startsWith('rider_')) return name;
  const part = name.replace(/^Human\./, '');
  const known: Record<string, string> = { body: 'human_skin', lips: 'human_lips', ears: 'human_ears', 'high-poly': 'human_eyes', teeth_base: 'human_teeth', tongue01: 'human_tongue', eyebrow008: 'human_brows', eyelashes01: 'human_lashes' };
  return known[part] ?? `human_${part.replace(/[^A-Za-z0-9]+/g, '_')}`;
}

async function exportGlb(input: THREE.Object3D): Promise<string> {
  const glb = (await new GLTFExporter().parseAsync(input, { binary: true, onlyVisible: true })) as ArrayBuffer;
  return toBase64(new Uint8Array(glb));
}

interface MaterialOut {
  kind: 'textured' | 'garment' | 'tack';
  color: Vec;
  roughness: number;
  metalness: number;
  texture?: string;
  alpha?: 'opaque' | 'mask';
  twoSided?: boolean;
  /** Baked ambient occlusion in COLOR_0.r: diffuse *= mix(aoMin, 1, ao). */
  aoMin?: number;
  sheen?: number;
  sheenRoughness?: number;
  scan?: string;
}

/** The character: neutral seat, baked and rebound; its textures and material parameters. */
async function exportCharacter(rig: DragonRigImpl, h: HumanRider, files: Record<string, string>) {
  rig.setFirstPerson(false);
  rig.setPose(NEUTRAL);
  rig.applyPose(0, undefined);
  // Parts the game moves on top of the seat each frame (eye saccades, the dress in the wind) back to their rest.
  for (const c of h.wind.chains) c.bones.forEach((b, i) => b.quaternion.copy(c.rest[i]));
  const ride = h.clips.get('ride');
  for (const eye of ['LeftEye', 'RightEye']) {
    const bone = h.bones.get(eye);
    const track = bone && ride?.tracks.find((t) => t.name === `${bone.name}.quaternion`);
    if (bone && track) bone.quaternion.fromArray(track.values, 0);
  }
  h.root.updateMatrixWorld(true);

  const clone = cloneSkinned(h.root);
  clone.position.set(0, 0, 0);
  clone.quaternion.identity();
  clone.scale.set(1, 1, 1);
  clone.updateMatrixWorld(true);
  const sources = new Map<THREE.SkinnedMesh, THREE.SkinnedMesh>();
  const srcMeshes: THREE.SkinnedMesh[] = [];
  h.root.traverse((o) => (o as THREE.SkinnedMesh).isSkinnedMesh && srcMeshes.push(o as THREE.SkinnedMesh));
  const dstMeshes: THREE.SkinnedMesh[] = [];
  clone.traverse((o) => (o as THREE.SkinnedMesh).isSkinnedMesh && dstMeshes.push(o as THREE.SkinnedMesh));
  dstMeshes.forEach((m, i) => sources.set(m, srcMeshes[i]));
  // Skeleton.clone() shares the inverse bind matrices with the source: the rebind below must not touch the game's own.
  for (const m of dstMeshes) m.skeleton.boneInverses = m.skeleton.boneInverses.map((b) => b.clone());

  // Visible parts only (the look: hair under the helmet is hidden), each with a plain named material. Everything that
  // reads the seated character runs before the first await (the sandbox keeps animating it between frames).
  let bakeError = 0;
  let rebind = 0;
  const visible = (o: THREE.Object3D): boolean => {
    for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
    return true;
  };
  const parts: [string, THREE.MeshStandardMaterial][] = [];
  // One material per slot, shared by its parts (the file then names each slot once).
  const slots = new Map<string, THREE.MeshStandardMaterial>();
  let vertices = 0;
  let triangles = 0;
  for (const mesh of dstMeshes) {
    const src = sources.get(mesh)!;
    if (!visible(src)) {
      mesh.visible = false;
      continue;
    }
    bakeError = Math.max(bakeError, bakePose(mesh, src));
    const mat = src.material as THREE.MeshStandardMaterial;
    const slot = slotName(mat);
    if (!slots.has(slot)) slots.set(slot, new THREE.MeshStandardMaterial({ name: slot }));
    mesh.material = slots.get(slot)!;
    parts.push([slot, mat]);
    vertices += mesh.geometry.getAttribute('position').count;
    triangles += (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count) / 3;
  }
  const bones: string[] = [];
  clone.traverse((o) => {
    if ((o as THREE.Bone).isBone) {
      o.name = o.name.replace(/^mixamorig:?/, '');
      bones.push(o.name);
    }
  });
  for (const mesh of dstMeshes) {
    if (!mesh.visible) continue;
    mesh.bind(mesh.skeleton);
    rebind = Math.max(rebind, rebindError(mesh));
  }

  const materials: Record<string, MaterialOut> = {};
  const textures: Record<string, { file: string; width: number; height: number; colorSpace: string }> = {};
  const byImage = new Map<unknown, string>();
  const garments = new Map<string, THREE.MeshPhysicalMaterial>();
  for (const [id, list] of h.garments ?? []) garments.set(id, list[0]);
  const scans = new Map<string, { color: number; roughness: number }>();
  for (const [slot, mat] of parts) {
    if (materials[slot]) continue;
    if (slot.startsWith('rider_')) {
      const id = slot.slice('rider_'.length);
      const look = LOOKS[id] ?? {};
      const set = look.set ? SETS[look.set] : undefined;
      let scan = { color: 1, roughness: 1 };
      if (set) {
        scan = scans.get(set.base) ?? (await scanAverages(set.base, set.ao, !!set.opacity));
        scans.set(set.base, scan);
      }
      const g = garments.get(id) ?? mat;
      materials[slot] = {
        kind: 'garment',
        color: rgb(g.color.clone().multiplyScalar(scan.color)),
        roughness: round(THREE.MathUtils.clamp((look.rough ?? 1) * scan.roughness, 0.05, 1), 4),
        metalness: look.metal ?? 0,
        aoMin: 0.25,
        sheen: look.sheen ?? 0,
        sheenRoughness: look.sheenRough ?? 0.5,
        scan: set?.base,
        twoSided: true,
      };
    } else {
      const map = mat.map;
      let texture: string | undefined;
      if (map?.image) {
        texture = byImage.get(map.image);
        if (!texture) {
          texture = `${slot.replace(/^human_/, 'T_')}`;
          byImage.set(map.image, texture);
          const img = await imagePng(map.image as ImageBitmap);
          files[`${texture}.png`] = img.png;
          textures[texture] = { file: `${texture}.png`, width: img.width, height: img.height, colorSpace: 'srgb' };
        }
      }
      const card = /brows|lashes|hair/.test(slot);
      materials[slot] = {
        kind: 'textured',
        color: rgb(mat.color),
        roughness: round(mat.roughness, 4),
        metalness: round(mat.metalness, 4),
        texture,
        alpha: card ? 'mask' : 'opaque',
        twoSided: card,
      };
    }
  }
  // Hidden parts stay out of the file (onlyVisible).
  files['rider.glb'] = await exportGlb(clone);

  const hips = clone.getObjectByName('Hips')!.getWorldPosition(new THREE.Vector3());
  const box = new THREE.Box3();
  for (const mesh of dstMeshes) if (mesh.visible) box.expandByObject(mesh);
  return {
    file: 'rider.glb',
    look: rig.riderLook,
    bones,
    hips: vec(hips),
    bounds: { min: vec(box.min, 4), max: vec(box.max, 4) },
    vertices,
    triangles,
    materials,
    textures,
    checks: { bakeErrorM: round(bakeError, 7), rebindErrorM: round(rebind, 7) },
  };
}

/** Tack parts by material, as the rider shader shades them (rider-material.ts), averaged over its noise. */
const TACK: Record<string, { color: Vec; roughness: number; metalness: number }> = {
  tack_leather: { color: [0.084, 0.047, 0.026], roughness: 0.66, metalness: 0 },
  tack_darkLeather: { color: [0.032, 0.021, 0.015], roughness: 0.66, metalness: 0 },
  tack_iron: { color: [0.38, 0.37, 0.39], roughness: 0.38, metalness: 0.9 },
  tack_blanket: { color: [0.029, 0.027, 0.025], roughness: 0.9, metalness: 0 },
  tack_blanketTrim: { color: [0.204, 0.086, 0.029], roughness: 0.9, metalness: 0 },
};

/** Blanket border (rider-material.ts): the woven bands along its edges, from the shell's uv (m around / along). */
function blanketBorder(u: number, v: number): number {
  const band = (x: number): number => 1 - THREE.MathUtils.smoothstep(x, 0.06, 0.1);
  return Math.max(band(Math.min(u, 1.54 - u)), band(Math.min(v, 1.22 - v)));
}

/** The tack in the dragon's bind pose, one primitive per material. */
async function exportTack(rig: DragonRigImpl, h: HumanRider, files: Record<string, string>) {
  const tack = rig.root.getObjectByName('dragon-rider') as THREE.SkinnedMesh;
  const src = tack.geometry;
  const data = src.getAttribute('aData') as THREE.BufferAttribute;
  const uv = src.getAttribute('uv') as THREE.BufferAttribute;
  const index = src.index!;
  const byMat = new Map<string, number[]>();
  const idOf = (mat: number): string => {
    switch (mat) {
      case RIDER_MAT.darkLeather:
        return 'tack_darkLeather';
      case RIDER_MAT.metal:
      case RIDER_MAT.brass:
        return 'tack_iron';
      case RIDER_MAT.fur:
        return 'tack_blanket';
      default:
        return 'tack_leather';
    }
  };
  for (let t = 0; t < index.count; t += 3) {
    const a = index.getX(t);
    const b = index.getX(t + 1);
    const c = index.getX(t + 2);
    // The shader's material id is flat: WebGL takes it from the triangle's last vertex.
    let id = idOf(Math.round(data.getX(c)));
    if (id === 'tack_blanket') {
      const border = (blanketBorder(uv.getX(a), uv.getY(a)) + blanketBorder(uv.getX(b), uv.getY(b)) + blanketBorder(uv.getX(c), uv.getY(c))) / 3;
      if (border > 0.5) id = 'tack_blanketTrim';
    }
    const list = byMat.get(id) ?? [];
    list.push(a, b, c);
    byMat.set(id, list);
  }
  const g = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'skinIndex', 'skinWeight']) g.setAttribute(name, src.getAttribute(name));
  const indices: number[] = [];
  const mats: THREE.Material[] = [];
  const materials: Record<string, MaterialOut> = {};
  for (const [id, list] of byMat) {
    g.addGroup(indices.length, list.length, mats.length);
    for (const i of list) indices.push(i);
    mats.push(new THREE.MeshStandardMaterial({ name: id }));
    materials[id] = { kind: 'tack', ...TACK[id], twoSided: true };
  }
  g.setIndex(indices);

  // Only the tack and the skeleton: the dragon, the character and the simulated rein straps are hidden meanwhile, and
  // the skeleton is put in its bind pose (the file's node transforms then match its inverse bind matrices).
  const hidden: THREE.Object3D[] = [];
  rig.root.traverse((o) => {
    if (o !== tack && ((o as THREE.Mesh).isMesh || o === h.root) && o.visible) {
      hidden.push(o);
      o.visible = false;
    }
  });
  const bones = tack.skeleton.bones;
  const saved = bones.map((b) => [b.position.clone(), b.quaternion.clone(), b.scale.clone()] as const);
  const geometry = tack.geometry;
  const material = tack.material;
  tack.geometry = g;
  tack.material = mats;
  tack.skeleton.pose();
  rig.root.updateMatrixWorld(true);
  try {
    files['saddle.glb'] = await exportGlb(rig.root);
  } finally {
    tack.geometry = geometry;
    tack.material = material;
    bones.forEach((b, i) => {
      b.position.copy(saved[i][0]);
      b.quaternion.copy(saved[i][1]);
      b.scale.copy(saved[i][2]);
    });
    for (const o of hidden) o.visible = true;
    rig.root.updateMatrixWorld(true);
  }
  return { file: 'saddle.glb', creature: 'evren', bones: bones.length, triangles: indices.length / 3, materials };
}

/** Where each rein leaves the neck (rest), the bone that carries it there, and the free spans' lengths. */
function exportReins(rig: DragonRigImpl) {
  const skel = rig.skel;
  const parts = buildTack(new MeshBuilder(), new BodySurface(skel), skel, { dynamicReins: true });
  const sides: Record<string, unknown> = {};
  for (const side of ['R', 'L'] as const) {
    const r = parts.reins![side];
    let best = 0;
    for (let i = 1; i < r.skin.bones.length; i++) if (r.skin.weights[i] > r.skin.weights[best]) best = i;
    const bone = skel.bones[r.skin.bones[best]];
    const head = skel.restHeads[r.skin.bones[best]];
    sides[side] = {
      anchor: vec(r.anchor),
      bone: bone.name,
      offset: vec(r.anchor.clone().sub(head)),
      skin: r.skin.bones.map((b, i) => ({ bone: skel.bones[b].name, weight: round(r.skin.weights[i], 4) })),
      fistEntry: vec(r.fist[0]),
      fistExit: vec(r.fist[r.fist.length - 1]),
      length: round(r.anchor.distanceTo(r.fist[0]) * (1 + SLACK), 4),
    };
  }
  const strap = rig.root.getObjectByName('rein-R') as THREE.Mesh | undefined;
  const m = strap?.material as THREE.MeshStandardMaterial | undefined;
  return {
    sides,
    bight: BIGHT,
    slack: SLACK,
    strap: { width: WIDTH, thickness: THICK, color: m ? rgb(m.color) : [0.028, 0.017, 0.011], roughness: m ? m.roughness : 0.72 },
  };
}

/**
 * Reference poses for a runtime's own port of the riding motion: the rider cues of a few moments (turns, a climb, a
 * dive, the flap pump, the landing brace, fire, a cheer), each settled (dt = 0) on the live character, and the joints
 * where the web game puts them, in the chest bone's frame (the seat frame, metres). `time` is the animator clock the
 * cheer's fist bob used.
 */
const CASES: { name: string; pose: Partial<DragonPose> }[] = [
  { name: 'neutral', pose: {} },
  { name: 'bankRight', pose: { riderLeanRoll: 0.3, riderReinRight: 0.8, riderReinLeft: -0.1 } },
  { name: 'bankLeft', pose: { riderLeanRoll: -0.3, riderReinLeft: 0.8, riderReinRight: -0.1 } },
  { name: 'climb', pose: { riderLeanPitch: 0.3, riderReinLeft: 0.55, riderReinRight: 0.55 } },
  { name: 'dive', pose: { riderLeanPitch: -0.4, riderTuck: 1, riderReinLeft: -1, riderReinRight: -1 } },
  { name: 'flapPump', pose: { riderReinLeft: -0.35, riderReinRight: -0.35 } },
  { name: 'brace', pose: { riderLeanPitch: 0.2, riderTuck: 1, riderReinLeft: 1, riderReinRight: 1 } },
  { name: 'point', pose: { riderPoint: 1 } },
  { name: 'cheer', pose: { riderCheer: 1 } },
];
const CASE_JOINTS = [
  'Hips',
  'Spine1',
  'Spine2',
  'Head',
  'LeftArm',
  'LeftForeArm',
  'LeftHand',
  'LeftHandMiddle1',
  'RightArm',
  'RightForeArm',
  'RightHand',
  'RightHandMiddle1',
  'LeftLeg',
  'LeftFoot',
  'RightLeg',
  'RightFoot',
];

function captureCases(rig: DragonRigImpl, h: HumanRider) {
  const chest = rig.skel.bone('chest');
  const time = (rig as unknown as { animator: { time: number } }).animator.time;
  const p = new THREE.Vector3();
  const cases = CASES.map((c) => {
    rig.setPose({ ...NEUTRAL, ...c.pose });
    rig.applyPose(0, undefined);
    rig.root.updateMatrixWorld(true);
    const joints: Record<string, Vec> = {};
    for (const j of CASE_JOINTS) {
      const bone = h.bones.get(j);
      if (bone) joints[j] = vec(chest.worldToLocal(bone.getWorldPosition(p)), 5);
    }
    return { name: c.name, pose: c.pose, joints };
  });
  rig.setPose(NEUTRAL);
  rig.applyPose(0, undefined);
  return { time: round(time, 6), cases };
}

/** The seat on the dragon in the chest bone's rest frame (the dragon rig's axes, metres; rest rotations are identity). */
function exportSeat() {
  const chest = LANDMARKS.chest;
  const rel = (p: THREE.Vector3): Vec => vec(p.clone().sub(chest));
  const fist = fistFrame('R');
  return {
    bone: 'chest',
    boneRest: vec(chest),
    hips: rel(SEAT_HIPS),
    grip: { wrist: rel(fist.wrist), forward: vec(fist.fwd), up: vec(fist.up), medial: vec(fist.medial), channel: rel(fist.channel) },
    pommel: rel(POMMEL_GRIP),
    stirrup: rel(RIDER.ankle),
    eye: rel(RIDER.eye),
    facing: 'the rider faces the dragon rig -Z: its root turns half a turn about +Y',
  };
}

export async function exportRider(): Promise<{ files: Record<string, string>; meta: Record<string, unknown> }> {
  const dragon = (window as unknown as { __dragon?: { rig: DragonRigImpl } }).__dragon;
  if (!dragon) throw new Error('rider export: open the dragon sandbox (window.__dragon)');
  const rig = dragon.rig;
  const h = rig.human ?? (rig.humanLoading ? await rig.humanLoading : undefined);
  if (!h) throw new Error('rider export: the character rider is not loaded (?rider=old|new?)');
  const files: Record<string, string> = {};
  const cases = captureCases(rig, h);
  const character = await exportCharacter(rig, h, files);
  const saddle = await exportTack(rig, h, files);
  const meta = {
    format: 1,
    frame:
      'glTF / three.js: +Y up, metres. rider.glb: the character in its rider frame (feet at the origin, facing +Z), bound in the neutral riding pose. ' +
      'saddle.glb and the seat: the dragon rig frame (+X right, +Y up, +Z back; the dragon faces -Z), on the dragon skeleton in its bind pose.',
    rider: character,
    saddle,
    seat: exportSeat(),
    reins: exportReins(rig),
    poses: cases,
    licence: 'rider: MakeHuman CC0 base (public/models/LICENSES.md) with Seventeen Skies outfit; saddle: Seventeen Skies (procedural)',
  };
  files['rider.json'] = textFile(JSON.stringify(meta, null, 1));
  return { files, meta };
}
