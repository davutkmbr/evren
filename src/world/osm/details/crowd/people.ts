/**
 * Procedural low-poly people for the crowd (crowd/crowd.ts): one rigid-part body whose parts carry a bone id, a
 * material slot and an optional style id, animated entirely in the vertex shader (walk cycle, standing idle, angler
 * and sitting poses) from per-instance motion attributes; per-instance clothing, skin and hair colours.
 *
 * Instance attributes (InstancedInterleavedBuffer, PERSON_STRIDE floats):
 *   iP  x0, y0, z0, t0      feet position at time t0 (engine elapsed seconds)
 *   iV  vx, vy, vz, phase0  velocity (m/s) and walk phase at t0
 *   iY  yaw, prevYaw, pose, height scale   (yaw blends from prevYaw over TURN_TIME after t0)
 * plus a Uint8 colour buffer (PERSON_COLOR_STRIDE bytes): top rgb + skin, bottom rgb + hair, accent rgb + style bits.
 */
import * as THREE from 'three';
import { RenderLayers } from '../../../../core/contracts';
import { patchMaterial } from '../../../../core/uniforms';

export const PERSON_STRIDE = 12;
export const PERSON_COLOR_STRIDE = 12;

/** Style bits (iC3.a). */
export const Style = { ShortHair: 1, LongHair: 2, Headscarf: 4, Coat: 8, Backpack: 16, Handbag: 32, LongSleeves: 64, Sneakers: 128 } as const;

/** Bones. */
const B = { Torso: 0, Head: 1, ThighL: 2, ShinL: 3, ThighR: 4, ShinR: 5, ArmL: 6, ForeL: 7, ArmR: 8, ForeR: 9 } as const;
/** Material slots. */
const M = { Top: 0, Bottom: 1, Skin: 2, Hair: 3, Shoes: 4, Accent: 5, Sleeve: 6, Coat: 7 } as const;
/** Style parts (drawn only when the instance has the matching bit). */
const S = { Always: 0, ShortHair: 1, LongHair: 2, Headscarf: 3, Coat: 4, Backpack: 5, Handbag: 6, Hair: 7 } as const;

interface Part {
  g: THREE.BufferGeometry;
  bone: number;
  mat: number;
  style: number;
}

function bodyParts(lod: 0 | 1): Part[] {
  const out: Part[] = [];
  const seg = lod === 0 ? 7 : 4;
  const add = (g: THREE.BufferGeometry, bone: number, mat: number, style: number = S.Always): void => {
    out.push({ g, bone, mat, style });
  };
  const limb = (r0: number, r1: number, y0: number, y1: number, x: number, z = 0): THREE.BufferGeometry =>
    new THREE.CylinderGeometry(r1, r0, y1 - y0, seg, 1, lod === 1).translate(x, (y0 + y1) / 2, z);
  const boxAt = (w: number, h: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
  for (const s of [1, -1]) {
    const x = 0.09 * s;
    add(limb(0.085, 0.07, 0.49, 0.93, x), s > 0 ? B.ThighL : B.ThighR, M.Bottom);
    add(limb(0.065, 0.05, 0.08, 0.5, x), s > 0 ? B.ShinL : B.ShinR, M.Bottom);
    add(boxAt(0.1, 0.08, 0.25, x, 0.04, 0.06), s > 0 ? B.ShinL : B.ShinR, M.Shoes);
    const ax = 0.205 * s;
    add(limb(0.05, 0.045, 1.12, 1.41, ax), s > 0 ? B.ArmL : B.ArmR, M.Top);
    add(limb(0.042, 0.036, 0.88, 1.13, ax * 1.02), s > 0 ? B.ForeL : B.ForeR, M.Sleeve);
    add(boxAt(0.06, 0.1, 0.035, ax * 1.03, 0.83, 0.01), s > 0 ? B.ForeL : B.ForeR, M.Skin);
  }
  // Pelvis and torso (elliptic section), neck, head.
  add(new THREE.CylinderGeometry(0.17, 0.165, 0.16, seg + 1, 1, lod === 1).scale(1, 1, 0.62).translate(0, 0.93, 0), B.Torso, M.Bottom);
  add(new THREE.CylinderGeometry(0.2, 0.165, 0.46, seg + 1, 1, lod === 1).scale(1, 1, 0.58).translate(0, 1.2, 0), B.Torso, M.Top);
  if (lod === 0) {
    add(new THREE.CylinderGeometry(0.11, 0.2, 0.05, seg + 1).scale(1, 1, 0.58).translate(0, 1.455, 0), B.Torso, M.Top);
    add(limb(0.05, 0.045, 1.43, 1.53, 0), B.Head, M.Skin);
    add(new THREE.SphereGeometry(0.1, 8, 6).scale(0.88, 1.12, 1).translate(0, 1.625, 0.005), B.Head, M.Skin);
    add(new THREE.SphereGeometry(0.108, 8, 4, 0, Math.PI * 2, 0, Math.PI * 0.52).scale(0.9, 1.08, 1.02).translate(0, 1.64, -0.005), B.Head, M.Hair, S.Hair);
    add(boxAt(0.19, 0.24, 0.05, 0, 1.5, -0.085), B.Head, M.Hair, S.LongHair);
    add(new THREE.SphereGeometry(0.118, 8, 6, Math.PI * 0.72, Math.PI * 1.56, 0, Math.PI * 0.78).scale(0.9, 1.1, 1.02).translate(0, 1.63, -0.005), B.Head, M.Accent, S.Headscarf);
    add(new THREE.CylinderGeometry(0.12, 0.21, 0.16, seg + 1, 1, true).scale(1, 1, 0.75).translate(0, 1.45, -0.01), B.Torso, M.Accent, S.Headscarf);
    add(new THREE.CylinderGeometry(0.2, 0.27, 0.62, seg + 1, 1, true).scale(1, 1, 0.72).translate(0, 0.72, 0), B.Torso, M.Coat, S.Coat);
    add(boxAt(0.28, 0.36, 0.13, 0, 1.2, -0.17), B.Torso, M.Accent, S.Backpack);
    add(boxAt(0.07, 0.2, 0.24, -0.25, 0.97, 0.02), B.Torso, M.Accent, S.Handbag);
  } else {
    add(boxAt(0.17, 0.24, 0.2, 0, 1.6, 0), B.Head, M.Skin);
    add(boxAt(0.18, 0.08, 0.21, 0, 1.73, -0.01), B.Head, M.Hair, S.Hair);
    add(boxAt(0.2, 0.3, 0.22, 0, 1.62, -0.01), B.Head, M.Accent, S.Headscarf);
    add(new THREE.CylinderGeometry(0.2, 0.27, 0.62, 4, 1, true).scale(1, 1, 0.72).translate(0, 0.72, 0), B.Torso, M.Coat, S.Coat);
  }
  return out;
}

/**
 * Merged body geometry with aBone / aMat / aStyle. LOD 0 is faceted (non-indexed, flat normals); LOD 1, the far
 * version, keeps the parts' index and smooth normals and leaves out hands and shoes (~190 vertices).
 */
export function personGeometry(lod: 0 | 1): THREE.InstancedBufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const bone: number[] = [];
  const mat: number[] = [];
  const style: number[] = [];
  const index: number[] = [];
  for (const p of bodyParts(lod)) {
    if (lod === 1 && (p.mat === M.Shoes || (p.mat === M.Skin && p.bone !== B.Head))) {
      continue;
    }
    let g = p.g;
    if (lod === 0) {
      g = g.index ? g.toNonIndexed() : g;
      g.computeVertexNormals();
    }
    const a = g.getAttribute('position');
    const n = g.getAttribute('normal');
    const base = pos.length / 3;
    for (let i = 0; i < a.count; i++) {
      pos.push(a.getX(i), a.getY(i), a.getZ(i));
      nrm.push(n.getX(i), n.getY(i), n.getZ(i));
      bone.push(p.bone);
      mat.push(p.mat);
      style.push(p.style);
    }
    if (lod === 1 && g.index) {
      for (let i = 0; i < g.index.count; i++) {
        index.push(base + g.index.getX(i));
      }
    }
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('aBone', new THREE.Float32BufferAttribute(bone, 1));
  geo.setAttribute('aMat', new THREE.Float32BufferAttribute(mat, 1));
  geo.setAttribute('aStyle', new THREE.Float32BufferAttribute(style, 1));
  if (index.length) {
    geo.setIndex(index);
  }
  return geo;
}

const PERSON_VERTEX_PARS = /* glsl */ `
attribute float aBone;
attribute float aMat;
attribute float aStyle;
attribute vec4 iP;
attribute vec4 iV;
attribute vec4 iY;
attribute vec4 iC1;
attribute vec4 iC2;
attribute vec4 iC3;
uniform float uTime;
uniform vec3 uPedRange;
varying vec3 vPedColor;

vec3 pedRotX(vec3 p, vec3 o, float a) {
  vec3 d = p - o;
  float c = cos(a), s = sin(a);
  return o + vec3(d.x, d.y * c - d.z * s, d.y * s + d.z * c);
}
vec3 pedRotXn(vec3 n, float a) {
  float c = cos(a), s = sin(a);
  return vec3(n.x, n.y * c - n.z * s, n.y * s + n.z * c);
}
vec3 pedRotY(vec3 d, float a) {
  float c = cos(a), s = sin(a);
  return vec3(d.x * c + d.z * s, d.y, -d.x * s + d.z * c);
}
float pedBit(float bits, float b) {
  return mod(floor(bits / b), 2.0);
}
vec3 pedLin(vec3 c) {
  return pow(c, vec3(2.2));
}
`;

/**
 * Computes pedPos / pedNrm (world space) for the current vertex. Poses: 0 walk, 1 stand, 2 angler, 3 sit.
 * Rotations use "forward positive" angles: a leg at +a swings its foot forward (+Z).
 */
const PERSON_VERTEX_MAIN = /* glsl */ `
vec3 pedPos = position;
vec3 pedNrm = normal;
{
  float tr = uTime - iP.w;
  vec3 base = iP.xyz + iV.xyz * tr;
  float pose = iY.z;
  float hs = iY.w;
  float speed = length(iV.xz);
  float seed = fract(iP.w * 0.137 + iV.w * 0.071);
  float dist = distance(base, cameraPosition);
  float lod = uPedRange.z;
  bool show = lod < 0.5 ? dist < uPedRange.x : (dist >= uPedRange.x && dist < uPedRange.y);
  float bits = floor(iC3.a * 255.0 + 0.5);
  if (aStyle > 0.5) {
    bool on = aStyle < 1.5 ? pedBit(bits, 1.0) > 0.5
      : aStyle < 2.5 ? pedBit(bits, 2.0) > 0.5
      : aStyle < 3.5 ? pedBit(bits, 4.0) > 0.5
      : aStyle < 4.5 ? pedBit(bits, 8.0) > 0.5
      : aStyle < 5.5 ? pedBit(bits, 16.0) > 0.5
      : aStyle < 6.5 ? pedBit(bits, 32.0) > 0.5
      : (pedBit(bits, 1.0) + pedBit(bits, 2.0)) > 0.5 && pedBit(bits, 4.0) < 0.5;
    show = show && on;
  }
  if (!show) {
    pedPos = vec3(0.0, -1e5, 0.0);
  } else {
    float phase = iV.w + tr * speed * 3.14159 / (0.74 * hs);
    float thighL = 0.0, thighR = 0.0, kneeL = 0.04, kneeR = 0.04;
    float armL = 0.04, armR = 0.04, foreL = 0.18, foreR = 0.18;
    float drop = 0.0, lean = 0.0, headYaw = 0.0, sway = 0.0;
    float idle = uTime * 0.6 + seed * 40.0;
    if (pose < 0.5 && speed > 0.05) {
      float s = sin(phase);
      thighL = 0.42 * s;
      thighR = -thighL;
      kneeL = 0.08 + 0.95 * pow(max(0.0, cos(phase + 0.35)), 2.0);
      kneeR = 0.08 + 0.95 * pow(max(0.0, cos(phase + 3.14159 + 0.35)), 2.0);
      armL = -0.32 * s;
      armR = 0.32 * s;
      foreL = 0.3 + 0.25 * max(0.0, -s);
      foreR = 0.3 + 0.25 * max(0.0, s);
      drop = 0.84 * (1.0 - cos(0.42 * abs(s))) - 0.012 * cos(2.0 * phase);
      lean = 0.05;
      headYaw = 0.12 * sin(idle * 0.37);
    } else if (pose < 1.5) {
      armL = 0.05 + 0.03 * sin(idle);
      armR = 0.05 - 0.03 * sin(idle * 1.1);
      sway = 0.02 * sin(idle * 0.8);
      headYaw = 0.45 * sin(idle * 0.23) * sin(idle * 0.11);
      kneeL = 0.04 + 0.06 * max(0.0, sin(idle * 0.5));
    } else if (pose < 2.5) {
      armL = 0.95;
      armR = 1.0;
      foreL = 0.55;
      foreR = 0.65;
      lean = 0.08;
      sway = 0.015 * sin(idle * 0.5);
      headYaw = 0.25 * sin(idle * 0.17);
    } else {
      thighL = 1.5;
      thighR = 1.45;
      kneeL = 1.5;
      kneeR = 1.4;
      armL = 0.45;
      armR = 0.4;
      foreL = 0.9;
      foreR = 0.95;
      drop = 0.45;
      lean = -0.06;
      headYaw = 0.35 * sin(idle * 0.2);
    }
    const vec3 HIP = vec3(0.09, 0.93, 0.0);
    const vec3 KNEE = vec3(0.09, 0.49, 0.0);
    const vec3 SHO = vec3(0.205, 1.41, 0.0);
    const vec3 ELB = vec3(0.21, 1.125, 0.0);
    int b = int(aBone + 0.5);
    float side = 1.0;
    if (b == 2 || b == 3 || b == 6 || b == 7) side = 1.0; else side = -1.0;
    vec3 hip = vec3(HIP.x * side, HIP.yz);
    vec3 knee = vec3(KNEE.x * side, KNEE.yz);
    vec3 sho = vec3(SHO.x * side, SHO.yz);
    vec3 elb = vec3(ELB.x * side, ELB.yz);
    if (b == 3 || b == 5) {
      float k = b == 3 ? kneeL : kneeR;
      float t = b == 3 ? thighL : thighR;
      pedPos = pedRotX(pedPos, knee, k);
      pedNrm = pedRotXn(pedNrm, k);
      pedPos = pedRotX(pedPos, hip, -t);
      pedNrm = pedRotXn(pedNrm, -t);
    } else if (b == 2 || b == 4) {
      float t = b == 2 ? thighL : thighR;
      pedPos = pedRotX(pedPos, hip, -t);
      pedNrm = pedRotXn(pedNrm, -t);
    } else if (b == 7 || b == 9) {
      float f = b == 7 ? foreL : foreR;
      float a = b == 7 ? armL : armR;
      pedPos = pedRotX(pedPos, elb, -f);
      pedNrm = pedRotXn(pedNrm, -f);
      pedPos = pedRotX(pedPos, sho, -a);
      pedNrm = pedRotXn(pedNrm, -a);
    } else if (b == 6 || b == 8) {
      float a = b == 6 ? armL : armR;
      pedPos = pedRotX(pedPos, sho, -a);
      pedNrm = pedRotXn(pedNrm, -a);
    } else if (b == 1) {
      vec3 d = pedRotY(pedPos - vec3(0.0, 1.5, 0.0), headYaw);
      pedPos = vec3(0.0, 1.5, 0.0) + d;
      pedNrm = pedRotY(pedNrm, headYaw);
    }
    // Upper body lean (forward = +Z) about the hips, then the pose drop and a slight side sway.
    if (b == 0 || b == 1 || b >= 6) {
      pedPos = pedRotX(pedPos, vec3(0.0, 0.93, 0.0), -lean);
      pedNrm = pedRotXn(pedNrm, -lean);
    }
    pedPos.y -= drop;
    pedPos.x += sway * pedPos.y;
    float blend = clamp(tr / 0.35, 0.0, 1.0);
    float dy = mod(iY.x - iY.y + 3.14159, 6.28318) - 3.14159;
    float yaw = iY.y + dy * blend;
    pedPos = base + pedRotY(pedPos * hs, yaw);
    pedNrm = pedRotY(pedNrm, yaw);

    vec3 skinA = vec3(0.89, 0.75, 0.63);
    vec3 skinB = vec3(0.55, 0.36, 0.24);
    vec3 skin = pedLin(mix(skinA, skinB, iC1.a));
    vec3 hairA = vec3(0.07, 0.055, 0.045);
    vec3 hairB = vec3(0.42, 0.33, 0.24);
    vec3 hair = pedLin(iC2.a > 0.92 ? vec3(0.55, 0.54, 0.52) : mix(hairA, hairB, iC2.a * iC2.a));
    vec3 shoes = pedBit(bits, 128.0) > 0.5 ? vec3(0.8) : vec3(0.025);
    float m = aMat;
    vPedColor = m < 0.5 ? pedLin(iC1.rgb)
      : m < 1.5 ? pedLin(iC2.rgb)
      : m < 2.5 ? skin
      : m < 3.5 ? hair
      : m < 4.5 ? shoes
      : m < 5.5 ? pedLin(iC3.rgb)
      : m < 6.5 ? (pedBit(bits, 64.0) > 0.5 ? pedLin(iC1.rgb) : skin)
      : pedLin(mix(iC3.rgb, iC2.rgb, 0.35));
  }
}
`;

/**
 * Standard material patched with the crowd animation. `range` = (near LOD end, far LOD end, lod): the near material
 * draws people closer than x, the far one between x and y.
 */
export function createPeopleMaterial(lod: 0 | 1, near: number, far: number): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ name: `osm-people-${lod}`, roughness: 0.82, metalness: 0 });
  const range = { value: new THREE.Vector3(near, far, lod) };
  m.userData.range = range.value;
  patchMaterial(m, `osm-people-v1-${lod}`, (shader) => {
    shader.uniforms.uPedRange = range;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${PERSON_VERTEX_PARS}`)
      .replace('#include <beginnormal_vertex>', `${PERSON_VERTEX_MAIN}\nvec3 objectNormal = pedNrm;\n#ifdef USE_TANGENT\nvec3 objectTangent = vec3(tangent.xyz);\n#endif`)
      .replace('#include <begin_vertex>', 'vec3 transformed = pedPos;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPedColor;')
      .replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb *= vPedColor;');
  });
  return m;
}

/** A crowd draw call: `geometry` shares its instance buffers with the other LOD. */
export function createPeopleMesh(geometry: THREE.InstancedBufferGeometry, material: THREE.Material, name: string): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.layers.set(RenderLayers.NoReflection);
  return mesh;
}
