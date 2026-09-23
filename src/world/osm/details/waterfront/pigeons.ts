/**
 * Ground pigeons on the squares (the famous flocks in front of Yeni Cami): they strut and peck around their flock
 * centre and every so often the whole flock bursts up, wheels once and lands again. Everything is animated in the
 * vertex shader from per-bird seeds (no CPU cost). The life module's pigeons circling the mosques stay airborne;
 * these are the ones on the ground.
 */
import * as THREE from 'three';
import { RenderLayers } from '../../../../core/contracts';
import { patchMaterial } from '../../../../core/uniforms';
import { PIGEON_STRIDE } from '../protocol';

function birdGeometry(): THREE.InstancedBufferGeometry {
  const parts: { g: THREE.BufferGeometry; wing: number; col: number }[] = [
    { g: new THREE.SphereGeometry(0.09, 6, 4).scale(0.75, 0.7, 1.35).translate(0, 0.14, 0), wing: 0, col: 0x80838c },
    { g: new THREE.SphereGeometry(0.045, 5, 4).translate(0, 0.24, 0.12), wing: 0, col: 0x5c6470 },
    { g: new THREE.ConeGeometry(0.012, 0.035, 4).rotateX(Math.PI / 2).translate(0, 0.235, 0.17), wing: 0, col: 0x3a3230 },
    { g: new THREE.BoxGeometry(0.07, 0.015, 0.12).translate(0, 0.14, -0.16), wing: 0, col: 0x4d525a },
    { g: new THREE.BoxGeometry(0.02, 0.07, 0.02).translate(0.03, 0.035, 0), wing: 0, col: 0xa0504a },
    { g: new THREE.BoxGeometry(0.02, 0.07, 0.02).translate(-0.03, 0.035, 0), wing: 0, col: 0xa0504a },
    { g: new THREE.BoxGeometry(0.24, 0.01, 0.13).translate(0.14, 0.16, -0.01), wing: 1, col: 0x6b6f78 },
    { g: new THREE.BoxGeometry(0.24, 0.01, 0.13).translate(-0.14, 0.16, -0.01), wing: -1, col: 0x6b6f78 },
  ];
  const pos: number[] = [];
  const nrm: number[] = [];
  const col: number[] = [];
  const wing: number[] = [];
  const c = new THREE.Color();
  for (const p of parts) {
    const g = p.g.index ? p.g.toNonIndexed() : p.g;
    g.computeVertexNormals();
    const a = g.getAttribute('position');
    const n = g.getAttribute('normal');
    c.set(p.col);
    for (let i = 0; i < a.count; i++) {
      pos.push(a.getX(i), a.getY(i), a.getZ(i));
      nrm.push(n.getX(i), n.getY(i), n.getZ(i));
      col.push(c.r, c.g, c.b);
      wing.push(p.wing);
    }
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('aWing', new THREE.Float32BufferAttribute(wing, 1));
  return geo;
}

const PIGEON_VERTEX = /* glsl */ `
attribute float aWing;
attribute vec4 iFlock;
attribute vec4 iBird;
uniform float uTime;
vec3 pgRotY(vec3 d, float a) {
  float c = cos(a), s = sin(a);
  return vec3(d.x * c + d.z * s, d.y, -d.x * s + d.z * c);
}
`;

/** iFlock: centre x, y, z, radius. iBird: seed, flock phase, shade, unused. */
const PIGEON_MAIN = /* glsl */ `
vec3 pgPos = position;
vec3 pgNrm = normal;
{
  float s = iBird.x;
  float t = uTime + s * 17.0;
  float cycle = 38.0 + 14.0 * fract(iBird.y * 7.1);
  float tau = mod(uTime + iBird.y * 100.0, cycle);
  float fly = tau < 7.0 ? sin(3.14159 * tau / 7.0) : 0.0;
  float flyF = smoothstep(0.0, 0.25, fly);
  // Ground wander: slow drift on a small circle plus jitter, pecking head bob.
  float a = s * 6.2831 + t * 0.07 * (fract(s * 13.0) - 0.5);
  float r = iFlock.w * sqrt(fract(s * 7.31)) * (0.75 + 0.25 * sin(t * 0.21 + s * 9.0));
  vec3 ground = iFlock.xyz + vec3(cos(a) * r, 0.0, sin(a) * r);
  float yawG = a + 1.5708 * sign(fract(s * 13.0) - 0.5) + 0.6 * sin(t * 0.9);
  // Flight: one wheel around the flock centre.
  float fa = s * 6.2831 + tau * 0.9;
  float fr = iFlock.w + 3.0 + 2.0 * fract(s * 3.7);
  vec3 air = iFlock.xyz + vec3(cos(fa) * fr, 2.0 + 7.0 * fly + 1.5 * fract(s * 5.1), sin(fa) * fr);
  float yawA = fa + 3.14159;
  vec3 base = mix(ground, air, flyF);
  float yaw = mix(yawG, yawA, flyF);
  float peck = (1.0 - flyF) * step(0.6, fract(t * 0.35 + s)) * 0.6 * abs(sin(t * 9.0));
  if (pgPos.z > 0.08 && aWing == 0.0) {
    pgPos = vec3(pgPos.x, 0.18 + (pgPos.y - 0.18) * cos(peck) - (pgPos.z - 0.06) * sin(peck), 0.06 + (pgPos.y - 0.18) * sin(peck) + (pgPos.z - 0.06) * cos(peck));
  }
  if (aWing != 0.0) {
    float flap = flyF * sin(uTime * 22.0 + s * 30.0) * 1.1 + (1.0 - flyF) * -0.15;
    float ang = flap * aWing;
    vec3 d = pgPos - vec3(0.0, 0.16, 0.0);
    pgPos = vec3(0.0, 0.16, 0.0) + vec3(d.x * cos(ang) - d.y * sin(ang), d.x * sin(ang) + d.y * cos(ang), d.z);
    if (flyF < 0.05) pgPos.x = sign(pgPos.x) * min(abs(pgPos.x), 0.07);
  }
  pgPos = base + pgRotY(pgPos, 1.5708 - yaw);
  pgNrm = pgRotY(pgNrm, 1.5708 - yaw);
}
`;

export function createPigeons(flocks: Float32Array): { mesh: THREE.Mesh; dispose(): void } | null {
  const nf = flocks.length / PIGEON_STRIDE;
  let total = 0;
  for (let f = 0; f < nf; f++) {
    total += flocks[f * PIGEON_STRIDE + 4];
  }
  if (!total) {
    return null;
  }
  const geo = birdGeometry();
  const iFlock = new Float32Array(total * 4);
  const iBird = new Float32Array(total * 4);
  let b = 0;
  for (let f = 0; f < nf; f++) {
    const o = f * PIGEON_STRIDE;
    const phase = Math.random();
    for (let k = 0; k < flocks[o + 4]; k++, b++) {
      iFlock.set([flocks[o], flocks[o + 1] + 0.02, flocks[o + 2], flocks[o + 3]], b * 4);
      iBird.set([Math.random(), phase, Math.random(), 0], b * 4);
    }
  }
  geo.setAttribute('iFlock', new THREE.InstancedBufferAttribute(iFlock, 4));
  geo.setAttribute('iBird', new THREE.InstancedBufferAttribute(iBird, 4));
  geo.instanceCount = total;
  const mat = new THREE.MeshStandardMaterial({ name: 'osm-pigeon', vertexColors: true, roughness: 0.7 });
  patchMaterial(mat, 'osm-pigeon-v1', (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${PIGEON_VERTEX}`)
      .replace('#include <beginnormal_vertex>', `${PIGEON_MAIN}\nvec3 objectNormal = pgNrm;\n#ifdef USE_TANGENT\nvec3 objectTangent = vec3(tangent.xyz);\n#endif`)
      .replace('#include <begin_vertex>', 'vec3 transformed = pgPos;');
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'osm-pigeons';
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  mesh.layers.set(RenderLayers.NoReflection);
  return {
    mesh,
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}
