/**
 * Rider character sandbox: the rider alone (bind pose, no dragon) for sculpt, material and look work.
 *   ?view=full|face|side|back|hands|top|profile   ?look=<url-encoded JSON RiderAppearance fields>   ?random=<seed>
 *   ?detail=high|low   ?debug=weights|mat
 * window.__rider.set({...}) rebuilds with changed appearance fields.
 */
import * as THREE from 'three';
import { startSandbox } from '../src/core/sandbox';
import type { System } from '../src/core/contracts';
import { UpdateOrder } from '../src/core/contracts';
import { DEFAULT_APPEARANCE, randomAppearance, sanitizeAppearance, type RiderAppearance } from '../src/dragon/model/rider/appearance';
import { buildRiderLayout, createRiderSkeleton } from '../src/dragon/model/rider/skeleton';
import { buildRiderParts, buildRiderSculpt, sculptGeometry, type RiderDetail } from '../src/dragon/model/rider/build';
import { mergeRiderGeometry } from '../src/dragon/model/rider/parts';
import { applyRiderColours, createRiderMaterial, createRiderOutlineMaterial } from '../src/dragon/model/rider/material';
import { SHARED_GLSL } from '../src/render/shaders';
import { registerGlobalUniform } from '../src/core/uniforms';
import { meshSculpt } from '../src/dragon/model/rider/sdf/mesher';

const params = new URLSearchParams(window.location.search);
const viewName = params.get('view') ?? 'full';
const detail = (params.get('detail') ?? 'high') as RiderDetail;

function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

let look: RiderAppearance = DEFAULT_APPEARANCE;
if (params.has('random')) {
  look = randomAppearance(seeded(Number(params.get('random'))));
}
if (params.has('look')) {
  look = sanitizeAppearance({ ...look, ...JSON.parse(params.get('look')!) });
}

const holder = new THREE.Group();
const guides = new THREE.Group();
let mesh: THREE.SkinnedMesh | undefined;

const MAT_COLOURS: Record<number, number> = { 0: 0xc99a7c, 1: 0x2a1c14, 2: 0xeeeeee, 3: 0x8c2a1c, 4: 0x303038, 5: 0xc08a30, 6: 0xd8d0bc, 7: 0x6a4028, 8: 0x33241a, 9: 0x777a80, 10: 0xb08a40, 11: 0x9a8a78, 12: 0x111111, 13: 0x8c2a1c, 14: 0x5a5046, 15: 0xe8c8b8, 16: 0x301010 };

function build(a: RiderAppearance): void {
  const t0 = performance.now();
  const layout = buildRiderLayout(a);
  const skel = createRiderSkeleton(layout, new THREE.Vector3());
  const job = buildRiderSculpt(a, layout, skel.id, skel.bones.length, detail);
  const only = params.get('regions');
  const regions = only ? job.regions.filter((_, i) => only.split(',').includes(String(i))) : job.regions;
  const m = meshSculpt(job.sculpt, job.boneCount, regions, job.hidden);
  const dbg = params.get('debug');
  let geo: THREE.BufferGeometry;
  let mat: THREE.Material;
  let outlineMat: THREE.Material | undefined;
  if (dbg) {
    geo = sculptGeometry(m);
    const colors = new Float32Array(m.stats.vertices * 3);
    const c = new THREE.Color();
    for (let i = 0; i < m.stats.vertices; i++) {
      if (dbg === 'weights') {
        c.setHSL((m.skinIndex[i * 4] * 0.618) % 1, 0.7, 0.5);
      } else if (dbg === 'ao') {
        c.setScalar(-m.data[i * 4 + 3]);
      } else {
        c.set(MAT_COLOURS[m.data[i * 4]] ?? 0xff00ff);
      }
      colors.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });
  } else {
    geo = mergeRiderGeometry(m, buildRiderParts(a, layout, skel.id));
    const rm = createRiderMaterial(new THREE.Vector3());
    applyRiderColours(rm.uniforms, a);
    mat = rm.material;
    if (params.get('outline') !== '0') {
      outlineMat = createRiderOutlineMaterial(rm.uniforms);
    }
  }
  if (mesh) {
    holder.remove(mesh);
    mesh.geometry.dispose();
  }
  mesh = new THREE.SkinnedMesh(geo, mat);
  mesh.castShadow = mesh.receiveShadow = true;
  holder.clear();
  holder.add(skel.root);
  mesh.bind(skel.skeleton, new THREE.Matrix4());
  mesh.frustumCulled = false;
  holder.add(mesh);
  if (outlineMat) {
    const ol = new THREE.SkinnedMesh(geo, outlineMat);
    ol.bind(skel.skeleton, new THREE.Matrix4());
    ol.frustumCulled = false;
    holder.add(ol);
  }
  // Bind pose: hips near the origin, facing the camera side.
  holder.position.set(0, 0, 0).sub(layout.j.Hips).add(new THREE.Vector3(0, 1.0, 0));
  if (params.get('guides') === '1') {
    const hf = layout.head;
    const hs = layout.props.headScale;
    const mat = new THREE.LineBasicMaterial({ color: 0xffd040, depthTest: false });
    const lines: [number, string][] = [[0.185, 'crown'], [0.072, 'eyes'], [0.03, 'nose'], [0.012, 'mouth'], [-0.042, 'chin']];
    for (const [y] of lines) {
      const a = hf.p(-0.2, y * hs, 0.2).sub(layout.j.Hips).add(new THREE.Vector3(0, 1.0, 0));
      const b = hf.p(0.2, y * hs, 0.2).sub(layout.j.Hips).add(new THREE.Vector3(0, 1.0, 0));
      const c2 = hf.p(0.25, y * hs, -0.2).sub(layout.j.Hips).add(new THREE.Vector3(0, 1.0, 0));
      const d = hf.p(0.25, y * hs, 0.25).sub(layout.j.Hips).add(new THREE.Vector3(0, 1.0, 0));
      const g1 = new THREE.BufferGeometry().setFromPoints([a, b]);
      const g2 = new THREE.BufferGeometry().setFromPoints([c2, d]);
      const l1 = new THREE.Line(g1, mat);
      const l2 = new THREE.Line(g2, mat);
      l1.renderOrder = l2.renderOrder = 10;
      guides.add(l1, l2);
    }
    // Body: head heights from the seat.
    for (let k = 0; k <= 8; k++) {
      const y = 1.0 - 0.1 + k * 0.232 * hs * 0.5;
      guides.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.8, y, 0.4), new THREE.Vector3(0.8, y, 0.4), new THREE.Vector3(0.8, y, -1.2)]), new THREE.LineBasicMaterial({ color: 0x40d0ff, depthTest: false, transparent: true, opacity: 0.4 })));
    }
  }
  console.info(`[rider] ${m.stats.vertices} verts, ${m.stats.triangles} tris, ${m.stats.bricks} bricks, mesh ${m.stats.ms.toFixed(0)} ms, total ${(performance.now() - t0).toFixed(0)} ms`);
  (window as unknown as { __riderStats: unknown }).__riderStats = { ...m.stats, total: performance.now() - t0 };
}

const VIEWS: Record<string, { pos: [number, number, number]; target: [number, number, number] }> = {
  full: { pos: [1.4, 1.7, -2.4], target: [0, 1.25, -0.2] },
  side: { pos: [2.6, 1.35, -0.3], target: [0, 1.25, -0.3] },
  back: { pos: [-0.9, 1.8, 2.2], target: [0, 1.3, -0.1] },
  face: { pos: [0.18, 1.78, -0.95], target: [0, 1.74, -0.3] },
  profile: { pos: [0.95, 1.76, -0.3], target: [0, 1.74, -0.3] },
  portrait: { pos: [0.75, 1.75, -1.55], target: [0, 1.52, -0.3] },
  face34: { pos: [0.5, 1.8, -0.85], target: [0, 1.73, -0.3] },
  hands: { pos: [0.5, 1.6, -1.25], target: [0, 1.36, -0.55] },
  top: { pos: [0.3, 3.2, -0.3], target: [0, 1.2, -0.3] },
  // Near-orthographic turnaround (long lens): whole body and head, front and side.
  ofront: { pos: [0, 1.3, -30], target: [0, 1.3, -0.3] },
  oside: { pos: [30, 1.3, -0.3], target: [0, 1.3, -0.3] },
  ohead: { pos: [0, 1.72, -30], target: [0, 1.72, -0.3] },
  ohside: { pos: [30, 1.72, -0.1], target: [0, 1.72, -0.1] },
};
const view = VIEWS[viewName] ?? VIEWS.full;

function bindMissingSharedSamplers(): void {
  const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  white.needsUpdate = true;
  for (const m of SHARED_GLSL.matchAll(/uniform\s+sampler2D\s+(\w+)\s*;/g)) {
    registerGlobalUniform(m[1], { value: white });
  }
}

function makeEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const scene = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `varying vec3 vDir;
void main(){
  vec3 d = normalize(vDir);
  vec3 c = d.y > 0.0 ? mix(vec3(0.62, 0.7, 0.8), vec3(0.12, 0.26, 0.6), pow(d.y, 0.55)) : mix(vec3(0.43, 0.49, 0.56), vec3(0.16, 0.14, 0.12), pow(-d.y, 0.4));
  gl_FragColor = vec4(c * 1.4, 1.0);
}`,
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), mat));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(scene, 0.02);
  pmrem.dispose();
  return rt.texture;
}

const driver: System = {
  name: 'rider-sandbox',
  order: UpdateOrder.Physics,
  init(ctx) {
    bindMissingSharedSamplers();
    ctx.scene.environment = makeEnvironment(ctx.renderer);
    ctx.scene.environmentIntensity = 1.0;
    ctx.scene.add(holder, guides);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(40, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x6f6a5f, roughness: 0.95 }));
    ground.receiveShadow = true;
    ctx.scene.add(ground);
    ctx.scene.traverse((o) => {
      const l = o as THREE.DirectionalLight;
      if (l.isDirectionalLight) {
        l.position.set(-3, 6, -5).multiplyScalar(40);
        l.shadow.camera.left = l.shadow.camera.bottom = -3;
        l.shadow.camera.right = l.shadow.camera.top = 3;
        l.shadow.bias = -0.0003;
        l.shadow.normalBias = 0.01;
        l.shadow.camera.updateProjectionMatrix();
      }
    });
    ctx.camera.fov = viewName.startsWith('o') ? (viewName.startsWith("oh") ? 0.62 : 3.3) : 30;
    ctx.camera.far = 100;
    ctx.camera.near = 0.02;
    ctx.camera.updateProjectionMatrix();
    build(look);
    (window as unknown as { __rider: unknown }).__rider = {
      set: (patch: Partial<RiderAppearance>) => {
        look = sanitizeAppearance({ ...look, ...patch });
        build(look);
      },
      get: () => look,
    };
  },
};

void startSandbox({
  systems: [driver],
  orbit: true,
  basicLighting: true,
  cameraPosition: new THREE.Vector3(...view.pos),
  orbitTarget: new THREE.Vector3(...view.target),
});
