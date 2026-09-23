/**
 * Sky / atmosphere / lighting test bench.
 * URL params: t (hours), doy, alt (camera altitude m), az/el (camera look direction, deg; az=sun|moon),
 *   dist (orbit distance), fov, pipe=direct (engine direct pipeline instead of post), q (quality), wind, haze,
 *   look=sun|moon (exact direction), cam=x,y,z&target=x,y,z (explicit camera), scene=0 (sky only).
 * Scripts: window.skyDebug.lab.measure([[azFromSunDeg, elDeg], ...], mode) reads back skyRadiance() (mode 0) or the
 * 30 km aerial-perspective in-scatter (mode 1); window.__skyDebug.overrides {boost, moonSky, pollution} isolate sources.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { startSandbox } from '../src/core/sandbox';
import { RenderLayers, UpdateOrder, type EngineContext, type System } from '../src/core/contracts';
import { createRenderPipeline } from '../src/render/post';
import { createSkySystem } from '../src/render/sky';
import { SHARED_GLSL } from '../src/render/shaders';

const params = new URLSearchParams(window.location.search);
const num = (k: string, d: number): number => (params.has(k) ? Number(params.get(k)) : d);

function grey(v: number, roughness: number, metalness = 0): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ roughness, metalness });
  m.color.setRGB(v, v, v, THREE.LinearSRGBColorSpace);
  return m;
}

function addMesh(scene: THREE.Scene, geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

function buildTestScene(scene: THREE.Scene): void {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(60000, 60000, 1, 1).rotateX(-Math.PI / 2), grey(0.16, 0.95));
  ground.receiveShadow = true;
  scene.add(ground);
  const pad = new THREE.Mesh(new THREE.PlaneGeometry(90, 90).rotateX(-Math.PI / 2), grey(0.3, 0.8));
  pad.position.y = 0.02;
  pad.receiveShadow = true;
  scene.add(pad);

  const sphere = new THREE.SphereGeometry(3, 64, 32);
  addMesh(scene, sphere, grey(0.18, 0.55), 0, 3, 0);
  addMesh(scene, sphere, grey(0.95, 0.02, 1), 8, 3, 0);
  addMesh(scene, sphere, grey(0.75, 0.3), -8, 3, 0);
  addMesh(scene, new THREE.BoxGeometry(4, 8, 4), grey(0.35, 0.7), 0, 4, -10);
  addMesh(scene, new THREE.BoxGeometry(6, 120, 6), grey(0.45, 0.8), 45, 60, -70);
  for (let i = 0; i < 6; i++) {
    addMesh(scene, new THREE.BoxGeometry(0.5, 0.5, 0.5), grey(0.5, 0.6), -4 + i * 1.6, 0.25, 8);
  }
  // Dragon-sized proxy: body + thin wings hovering, for self shadowing and ground shadow tests.
  const proxy = new THREE.Group();
  proxy.position.set(-16, 9, 6);
  proxy.rotation.y = 0.6;
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(1.1, 7, 8, 24).rotateX(Math.PI / 2), grey(0.12, 0.45));
  const wingGeo = new THREE.BoxGeometry(8, 0.08, 3.5);
  const wingL = new THREE.Mesh(wingGeo, grey(0.2, 0.6));
  wingL.position.set(-4.6, 0.6, -0.5);
  wingL.rotation.z = 0.18;
  const wingR = wingL.clone();
  wingR.position.x = 4.6;
  wingR.rotation.z = -0.18;
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.7, 4, 16).rotateX(Math.PI / 2.8), grey(0.12, 0.45));
  neck.position.set(0, 1.4, -5);
  for (const m of [body, wingL, wingR, neck]) {
    m.castShadow = true;
    m.receiveShadow = true;
    proxy.add(m);
  }
  scene.add(proxy);
  // NoReflection layer object must still cast shadows.
  const tree = addMesh(scene, new THREE.ConeGeometry(2.2, 7, 16), grey(0.1, 0.9), 14, 3.5, 10);
  tree.layers.set(RenderLayers.NoReflection);
  // Distant "buildings" for aerial perspective: 1, 3, 6, 12, 20 km.
  const bld = new THREE.BoxGeometry(60, 90, 60);
  const bldMat = grey(0.4, 0.8);
  for (const d of [1000, 3000, 6000, 12000, 20000]) {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + d * 0.0001;
      const m = addMesh(scene, bld, bldMat, Math.sin(a) * d, 45, -Math.cos(a) * d);
      m.castShadow = d < 3000;
    }
  }
}

function lookDirection(ctx: EngineContext): THREE.Vector3 | null {
  const env = ctx.services.tryGet('env');
  const look = params.get('look');
  if (env && (look === 'sun' || look === 'moon')) {
    return (look === 'sun' ? env.sunDirection : env.moonDirection).clone();
  }
  const azParam = params.get('az');
  const el = THREE.MathUtils.degToRad(num('el', 8));
  let az: number;
  if (azParam === 'sun' && env) {
    az = Math.atan2(env.sunDirection.x, -env.sunDirection.z);
  } else if (azParam === 'moon' && env) {
    az = Math.atan2(env.moonDirection.x, -env.moonDirection.z);
  } else if (azParam !== null) {
    az = THREE.MathUtils.degToRad(Number(azParam));
  } else {
    return null;
  }
  return new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az));
}

function cameraRig(): System {
  let controls: OrbitControls | null = null;
  return {
    name: 'sky-sandbox-camera',
    order: UpdateOrder.Camera,
    init(ctx) {
      const cam = ctx.camera;
      cam.fov = num('fov', 60);
      cam.near = 0.1;
      cam.far = 60000;
      cam.updateProjectionMatrix();
      const alt = num('alt', 6);
      const dist = num('dist', 34);
      const dir = lookDirection(ctx);
      const vec = (k: string): THREE.Vector3 | null => {
        const v = params.get(k)?.split(',').map(Number);
        return v && v.length === 3 && v.every(Number.isFinite) ? new THREE.Vector3(v[0], v[1], v[2]) : null;
      };
      const camPos = vec('cam');
      const camTarget = vec('target');
      if (camPos && camTarget) {
        cam.position.copy(camPos);
        cam.lookAt(camTarget);
        controls = new OrbitControls(cam, ctx.canvas);
        controls.target.copy(camTarget);
      } else if (dir) {
        cam.position.set(-dir.x * dist, alt, -dir.z * dist + 0.001);
        const target = cam.position.clone().addScaledVector(dir, 100);
        cam.lookAt(target);
        controls = new OrbitControls(cam, ctx.canvas);
        controls.target.copy(cam.position).addScaledVector(dir, 1);
      } else {
        cam.position.set(-24, alt, 30);
        controls = new OrbitControls(cam, ctx.canvas);
        controls.target.set(0, Math.min(alt, 4), 0);
      }
      controls.enableDamping = true;
      controls.update();
    },
    update() {
      controls?.update();
    },
  };
}

/**
 * Measurement lab (used by scripts driving the sandbox): evaluates the shared skyRadiance() (mode 0) or the aerial
 * perspective in-scattering over 30 km (mode 1) for directions given relative to the sun azimuth
 * ([azimuth offset deg, elevation deg]) and reads the result back synchronously.
 */
function createSkyLab(ctx: EngineContext): Record<string, unknown> {
  const count = 32;
  const dirs = Array.from({ length: count }, () => new THREE.Vector3(0, 1, 0));
  const target = new THREE.WebGLRenderTarget(count, 1, { type: THREE.FloatType, depthBuffer: false });
  const material = new THREE.ShaderMaterial({
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `${SHARED_GLSL}
uniform vec3 uDirs[${count}];
uniform int uMode;
void main() {
  int i = int(gl_FragCoord.x);
  vec3 d = normalize(uDirs[i]);
  vec3 c = uMode == 1 ? applyAtmosphere(vec3(0.0), uCamPos + d * 30000.0) : skyRadiance(d);
  gl_FragColor = vec4(c, 1.0);
}`,
    uniforms: { uDirs: { value: dirs }, uMode: { value: 0 } },
    depthTest: false,
    depthWrite: false,
    fog: false,
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const quad = new THREE.Mesh(geometry, material);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const buffer = new Float32Array(count * 4);
  const round = (x: number): number => Math.round(x * 1e7) / 1e7;
  return {
    measure(rel: Array<[number, number]>, mode = 0): number[][] {
      const env = ctx.services.get('env');
      const sunAz = Math.atan2(env.sunDirection.x, -env.sunDirection.z);
      rel.forEach(([azDeg, elDeg], i) => {
        const az = sunAz + THREE.MathUtils.degToRad(azDeg);
        const el = THREE.MathUtils.degToRad(elDeg);
        dirs[i].set(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az));
      });
      material.uniforms.uMode.value = mode;
      const r = ctx.renderer;
      const prev = r.getRenderTarget();
      r.setRenderTarget(target);
      r.render(scene, camera);
      r.readRenderTargetPixels(target, 0, 0, count, 1, buffer);
      r.setRenderTarget(prev);
      return rel.map((_, i) => [round(buffer[i * 4]), round(buffer[i * 4 + 1]), round(buffer[i * 4 + 2])]);
    },
  };
}

void startSandbox({
  pipeline: params.get('pipe') === 'direct' ? undefined : createRenderPipeline,
  systems: [createSkySystem(), cameraRig()],
}).then((engine) => {
  if (params.get('scene') !== '0') {
    buildTestScene(engine.ctx.scene);
  }
  (window as unknown as { skyDebug: unknown }).skyDebug = { engine, THREE, lab: createSkyLab(engine.ctx) };
});
