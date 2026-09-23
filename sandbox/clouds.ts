/**
 * Clouds sandbox. URL params:
 *   view=ground|low|inside|above|sunset|horizon|night|side   (named camera setups; side = 2.4 km from a big cumulus)
 *   pos=x,y,z  hdg=deg  pitch=deg                       (custom camera; overrides view)
 *   t=hours    fly=m/s (camera moves forward)  rot=deg/s (camera yaws)  cov=-0.3..0.3 (coverage bias)
 *   proxy=1 (dragon-sized object ahead)   tune=lobe,big,baseAmbient,floret (shape multipliers, default 1,1,1,1)
 *   sky=real   (use the real sky system instead of the sandbox sun)   q=low|medium|high|ultra   clouddebug=...
 */
import * as THREE from 'three';
import type { EnvironmentState, System } from '../src/core/contracts';
import { UpdateOrder } from '../src/core/contracts';
import { startSandbox } from '../src/core/sandbox';
import { globalUniforms, patchMaterial } from '../src/core/uniforms';
import { createGeoSystem } from '../src/world/geo';
import { createRenderPipeline } from '../src/render/post';
import { createSkySystem } from '../src/render/sky';
import { createCloudSystemWithHandle } from '../src/render/clouds';
import { sunTransmittance } from '../src/render/clouds/lighting';
import { SHARED_GLSL } from '../src/render/shaders';

const DEG = Math.PI / 180;
const params = new URLSearchParams(window.location.search);
const num = (k: string, d: number): number => (params.has(k) ? Number(params.get(k)) : d);

interface ViewSetup {
  pos: [number, number, number];
  hdg: number;
  pitch: number;
  t?: number;
}

const VIEWS: Record<string, ViewSetup> = {
  ground: { pos: [0, 25, 0], hdg: 20, pitch: 32 },
  low: { pos: [0, 800, 0], hdg: 60, pitch: 3 },
  inside: { pos: [0, 2000, 0], hdg: 40, pitch: 0 },
  above: { pos: [0, 3800, 0], hdg: 45, pitch: -12 },
  sunset: { pos: [0, 800, 0], hdg: 262, pitch: 4, t: 19 },
  horizon: { pos: [0, 300, 0], hdg: 100, pitch: 2 },
  night: { pos: [0, 500, 0], hdg: 30, pitch: 10, t: 21.5 },
  side: { pos: [0, 1900, 0], hdg: 0, pitch: 6 },
};

const view = VIEWS[params.get('view') ?? 'low'] ?? VIEWS.low;
const hours = num('t', view.t ?? 16);
const useRealSky = params.get('sky') === 'real';

/** Solar position for Istanbul on 23 September (local time UTC+3). */
function sunDirectionAt(localHours: number, out: THREE.Vector3): THREE.Vector3 {
  const lat = 41.045 * DEG;
  const decl = -0.25 * DEG;
  const solarTime = localHours - 3 + 29.02 / 15 + 7.6 / 60;
  const h = (solarTime - 12) * 15 * DEG;
  const east = -Math.cos(decl) * Math.sin(h);
  const north = Math.sin(decl) * Math.cos(lat) - Math.cos(decl) * Math.cos(h) * Math.sin(lat);
  const up = Math.sin(decl) * Math.sin(lat) + Math.cos(decl) * Math.cos(h) * Math.cos(lat);
  return out.set(east, up, -north).normalize();
}

/** Minimal sun/sky for isolated testing: analytic sun, fallback skyRadiance dome, env service. */
function createSandboxSky(): System {
  const sunDir = new THREE.Vector3();
  const sunColor = new THREE.Color();
  const ambient = new THREE.Color();
  const light = new THREE.DirectionalLight(0xffffff, 1);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x2a2622, 1);
  const trans = [1, 1, 1];
  const env: { -readonly [K in keyof EnvironmentState]: EnvironmentState[K] } = {
    sunDirection: sunDir,
    moonDirection: new THREE.Vector3(),
    sunColor,
    ambientColor: ambient,
    nightFactor: 0,
    light,
    wind: new THREE.Vector3(4, 0, 2),
    setTimeOfDay(h: number) {
      currentHours = h;
    },
  };
  let currentHours = hours;
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(1000, 48, 24),
    new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
      fragmentShader: /* glsl */ `
${SHARED_GLSL}
varying vec3 vDir;
void main() {
  vec3 dir = normalize(vDir);
  vec3 c = skyRadiance(dir);
  float sd = dot(dir, uSunDir);
  c += uSunColor * 900.0 * smoothstep(0.99996, 0.99999, sd);
  gl_FragColor = vec4(c, 1.0);
}`,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
    }),
  );
  dome.renderOrder = -1e6;
  dome.frustumCulled = false;

  return {
    name: 'sandbox-sky',
    order: UpdateOrder.Environment,
    init(ctx) {
      ctx.scene.add(dome, light, light.target, hemi);
      ctx.services.provide('env', env);
    },
    update(_dt, ctx) {
      sunDirectionAt(currentHours, sunDir);
      const elev = Math.asin(sunDir.y);
      sunTransmittance(Math.max(elev + 0.45 * DEG, -0.2 * DEG), 0, trans);
      const up = THREE.MathUtils.smoothstep(elev, -1.5 * DEG, 1 * DEG);
      sunColor.setRGB(trans[0], trans[1], trans[2]).multiplyScalar(5.4 * up);
      const night = 1 - THREE.MathUtils.smoothstep(sunDir.y, -0.2, 0.04);
      env.nightFactor = night;
      const day = THREE.MathUtils.clamp(sunDir.y * 2.5 + 0.25, 0, 1);
      ambient.setRGB(0.3, 0.37, 0.5).multiplyScalar(day).lerp(new THREE.Color(0.004, 0.006, 0.012), night);
      env.moonDirection.set(-sunDir.x, 0.55, -sunDir.z).normalize();
      (globalUniforms.uSunDir.value as THREE.Vector3).copy(sunDir);
      (globalUniforms.uSunColor.value as THREE.Color).copy(sunColor);
      (globalUniforms.uAmbient.value as THREE.Color).copy(ambient);
      (globalUniforms.uMoonDir.value as THREE.Vector3).copy(env.moonDirection);
      globalUniforms.uNight.value = night;
      globalUniforms.uTimeOfDay.value = currentHours;
      light.color.copy(sunColor);
      light.intensity = 1;
      light.position.copy(ctx.camera.position).addScaledVector(sunDir, 1000);
      light.target.position.copy(ctx.camera.position);
      hemi.color.copy(ambient).multiplyScalar(2.2);
      hemi.groundColor.copy(ambient).multiplyScalar(0.5);
      dome.position.copy(ctx.camera.position);
    },
  };
}

/** Ground albedo breakup; with the sandbox sky also the cloud shadow (the real sky's key-light patch applies it). */
function cloudShadowPatch(material: THREE.MeshStandardMaterial, key: string): void {
  patchMaterial(material, useRealSky ? `${key}-realsky` : key, (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
  diffuseColor.rgb *= 0.7 + 0.6 * fbm2(vFogWorldPos.xz * 0.0021, 5);`,
    );
    if (!useRealSky) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
  reflectedLight.directDiffuse *= cloudShadow(vFogWorldPos);
  reflectedLight.directSpecular *= cloudShadow(vFogWorldPos);`,
      );
    }
  });
}

function createSandboxWorld(): System {
  const group = new THREE.Group();
  const groundMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.2, 0.19, 0.15), roughness: 0.95 });
  cloudShadowPatch(groundMat, 'clouds-sandbox-ground');
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(140_000, 140_000, 1, 1), groundMat);
  ground.rotation.x = -Math.PI / 2;
  group.add(ground);

  const hillMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.14, 0.17, 0.1), roughness: 1 });
  cloudShadowPatch(hillMat, 'clouds-sandbox-hill');
  const hill = new THREE.Mesh(new THREE.ConeGeometry(4200, 460, 64, 1), hillMat);
  hill.position.set(9000, 230, -11_000);
  group.add(hill);

  const boxMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.55, 0.52, 0.48), roughness: 0.8 });
  cloudShadowPatch(boxMat, 'clouds-sandbox-box');
  const count = 1800;
  const boxes = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), boxMat, count);
  const m = new THREE.Matrix4();
  let seed = 7;
  const rnd = (): number => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < count; i++) {
    const r = 200 + Math.sqrt(rnd()) * 3500;
    const a = rnd() * Math.PI * 2;
    const tower = rnd() < 0.03;
    const h = tower ? 120 + rnd() * 140 : 8 + rnd() * rnd() * 45;
    const w = tower ? 30 + rnd() * 20 : 12 + rnd() * 20;
    m.compose(
      new THREE.Vector3(Math.cos(a) * r, h / 2, Math.sin(a) * r - 1500),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 3),
      new THREE.Vector3(w, h, w * (0.6 + rnd() * 0.8)),
    );
    boxes.setMatrixAt(i, m);
  }
  group.add(boxes);

  // Dragon stand-in: a body capsule plus thin swept wing plates (thin silhouettes for the upsampler).
  const proxyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.08, 0.1, 0.07), roughness: 0.6 });
  const proxy = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(1.1, 5, 6, 16), proxyMat);
  body.rotation.x = Math.PI / 2;
  proxy.add(body);
  for (const side of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(7, 0.12, 2.2), proxyMat);
    wing.position.set(side * 4.2, 0.3, 0.4);
    wing.rotation.set(0, side * 0.25, side * 0.12);
    proxy.add(wing);
    const spar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 7.5, 6), proxyMat);
    spar.rotation.z = Math.PI / 2;
    spar.position.set(side * 4.4, 0.6, -0.9);
    proxy.add(spar);
  }
  proxy.visible = params.get('proxy') === '1';
  const tmp = new THREE.Vector3();

  const setup = params.has('pos')
    ? {
        pos: params.get('pos')!.split(',').map(Number) as [number, number, number],
        hdg: num('hdg', view.hdg),
        pitch: num('pitch', view.pitch),
      }
    : { ...view, hdg: num('hdg', view.hdg), pitch: num('pitch', view.pitch) };
  const fly = num('fly', 0);
  const rot = num('rot', 0) * DEG;

  return {
    name: 'sandbox-world',
    order: UpdateOrder.Camera,
    init(ctx) {
      ctx.scene.add(group);
      ctx.scene.add(proxy);
      const cam = ctx.camera;
      cam.far = 60_000;
      cam.near = 0.1;
      cam.fov = 60;
      cam.updateProjectionMatrix();
      cam.position.set(setup.pos[0], setup.pos[1], setup.pos[2]);
      cam.rotation.set(setup.pitch * DEG, -setup.hdg * DEG, 0, 'YXZ');
    },
    update(dt, ctx) {
      const cam = ctx.camera;
      if (fly !== 0) {
        cam.getWorldDirection(tmp);
        cam.position.addScaledVector(tmp, fly * dt);
      }
      if (rot !== 0) {
        cam.rotation.y -= rot * dt;
      }
      cam.updateMatrixWorld();
      if (proxy.visible) {
        cam.getWorldDirection(tmp);
        proxy.position.copy(cam.position).addScaledVector(tmp, 13).y -= 2.2;
        proxy.rotation.set(0, cam.rotation.y, 0, 'YXZ');
      }
    },
  };
}

const { system: clouds, handle } = createCloudSystemWithHandle();
if (params.has('cov')) {
  handle.setCoverage(num('cov', 0));
}
if (params.has('tune')) {
  const [lobe, big, base, floret] = params.get('tune')!.split(',').map(Number);
  handle.uniforms.uCloudTune.value.set(lobe ?? 1, big ?? 1, base ?? 1, floret ?? 1);
}
(window as unknown as { __clouds: typeof handle }).__clouds = handle;

const systems: System[] = [createGeoSystem()];
systems.push(useRealSky ? createSkySystem() : createSandboxSky());
systems.push(createSandboxWorld(), clouds);

void startSandbox({ pipeline: createRenderPipeline, systems }).then((engine) => {
  const ctx = engine.ctx;
  if (useRealSky) {
    ctx.services.tryGet('env')?.setTimeOfDay(hours);
  }
  if (params.get('view') === 'inside' && !params.has('pos')) {
    const c = handle.findCloud(0, 0, 9000);
    if (c) {
      ctx.camera.position.set(c.x, num('alt', 2000), c.z);
    }
  }
  if (params.get('view') === 'side' && !params.has('pos')) {
    // Stand off a big cumulus, the sun roughly to one side.
    const c = handle.findCloud(0, -6000, 7000);
    if (c) {
      const hdg = num('hdg', 0) * DEG;
      const dist = num('dist', 2400);
      ctx.camera.position.set(c.x - Math.sin(hdg) * dist, num('alt', 1900), c.z + Math.cos(hdg) * dist);
    }
  }
});
