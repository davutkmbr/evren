/**
 * Water sandbox: real geo + sky (+ optional clouds/city/landmarks) + terrain + water, fixed or orbit camera.
 *   /sandbox/water.html?view=bogaz&t=18.5          camera at a debug view preset (debug.ts), alt/hdg/pitch override
 *   &lat=41.04&lon=29.02&alt=40&hdg=30&pitch=-8    explicit camera
 *   &orbit=1                                       OrbitControls around a point `pd` m ahead
 *   &props=0                                       hide the reflection test props (towers with lit windows, a hovering proxy)
 *   &clouds=1 &city=1 &water=0                     include the clouds / city + landmark systems, drop the water
 *   &q=low|medium|high|ultra &wind=poyraz|lodos    quality preset / forced wind regime
 * Console: window.setCam(lat, lon, alt, hdg, pitch)
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { startSandbox } from '../src/core/sandbox';
import { UpdateOrder, type EngineContext, type System } from '../src/core/contracts';
import { VIEW_PRESETS } from '../src/core/debug';
import { latLonToLocal } from '../src/core/geo-coords';
import { createRenderPipeline } from '../src/render/post';
import { createSkySystem } from '../src/render/sky';
import { createCloudSystem } from '../src/render/clouds';
import { createGeoSystem } from '../src/world/geo';
import { createTerrainSystem } from '../src/world/terrain';
import { createWaterSystem } from '../src/world/water';
import { createCitySystem } from '../src/world/city';
import { createOsmSystem } from '../src/world/osm';
import { createMosqueSystem } from '../src/world/landmarks/mosques';
import { createStructureSystem } from '../src/world/landmarks/structures';
import { createHeritageSystem } from '../src/world/landmarks/heritage';

const params = new URLSearchParams(window.location.search);
const num = (k: string, d: number): number => (params.has(k) && params.get(k) !== '' ? Number(params.get(k)) : d);
const flag = (k: string, d: boolean): boolean => (params.has(k) ? params.get(k) === '1' || params.get(k) === 'true' : d);

interface CamSpec {
  x: number;
  y: number;
  z: number;
  hdg: number;
  pitch: number;
}

function initialCamera(): CamSpec {
  const preset = VIEW_PRESETS[params.get('view') ?? ''] ?? null;
  let x = preset?.x ?? 0;
  let z = preset?.z ?? 0;
  if (params.has('lat') && params.has('lon')) {
    const p = latLonToLocal(num('lat', 41.04), num('lon', 29.02));
    x = p.x;
    z = p.z;
  }
  return {
    x,
    y: num('alt', preset?.y ?? 60),
    z,
    hdg: num('hdg', preset?.headingDeg ?? 30),
    pitch: num('pitch', preset?.pitchDeg ?? -6),
  };
}

function placeCamera(camera: THREE.PerspectiveCamera, c: CamSpec): void {
  camera.position.set(c.x, c.y, c.z);
  const yaw = -THREE.MathUtils.degToRad(c.hdg);
  camera.rotation.set(THREE.MathUtils.degToRad(c.pitch), yaw, 0, 'YXZ');
  camera.updateMatrixWorld();
}

function windowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, 128, 256);
  let seed = 7;
  const rnd = (): number => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let y = 4; y < 256; y += 10) {
    for (let x = 4; x < 128; x += 9) {
      if (rnd() < 0.45) {
        const warm = rnd();
        g.fillStyle = warm < 0.7 ? `rgb(255,${190 + Math.round(rnd() * 40)},${110 + Math.round(rnd() * 50)})` : 'rgb(200,225,255)';
        g.fillRect(x, y, 5, 6);
      }
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Reflection test props: towers standing in the water with lit windows, lamp posts, a hovering dragon-sized proxy. */
function createProps(): System {
  const group = new THREE.Group();
  let windows: THREE.MeshStandardMaterial[] = [];
  return {
    name: 'water-props',
    order: UpdateOrder.World,
    init(ctx: EngineContext) {
      const c = initialCamera();
      const dist = num('pd', 420);
      const yaw = -THREE.MathUtils.degToRad(c.hdg);
      const fwd = new THREE.Vector3(Math.sin(-yaw) * 1, 0, -Math.cos(yaw));
      fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw));
      const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
      const tex = windowTexture();
      const facade = new THREE.MeshStandardMaterial({ color: 0x8a8378, roughness: 0.8, metalness: 0.0 });
      facade.emissiveMap = tex;
      facade.emissive = new THREE.Color(1, 1, 1);
      facade.emissiveIntensity = 0;
      windows = [facade];
      const base = new THREE.Vector3(c.x, 0, c.z).addScaledVector(fwd, dist);
      for (let i = 0; i < 7; i++) {
        const h = 35 + ((i * 37) % 50);
        const w = 18 + ((i * 13) % 10);
        const geo = new THREE.BoxGeometry(w, h, w);
        const uv = geo.attributes.uv as THREE.BufferAttribute;
        for (let k = 0; k < uv.count; k++) {
          uv.setXY(k, uv.getX(k) * (w / 14), uv.getY(k) * (h / 26));
        }
        const m = new THREE.Mesh(geo, facade);
        m.position.copy(base).addScaledVector(right, (i - 3) * 55).addScaledVector(fwd, (i % 2) * 40);
        m.position.y = h / 2 - 4;
        m.castShadow = true;
        m.receiveShadow = true;
        group.add(m);
      }
      const lampMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: new THREE.Color(1.0, 0.72, 0.4), emissiveIntensity: 0 });
      windows.push(lampMat);
      const lampGeo = new THREE.SphereGeometry(0.8, 12, 8);
      for (let i = 0; i < 24; i++) {
        const lamp = new THREE.Mesh(lampGeo, lampMat);
        lamp.position.copy(base).addScaledVector(fwd, -60).addScaledVector(right, (i - 12) * 22);
        lamp.position.y = 7;
        group.add(lamp);
      }
      const proxyMat = new THREE.MeshStandardMaterial({ color: 0x3a3430, roughness: 0.6 });
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(1.4, 9, 8, 20).rotateX(Math.PI / 2), proxyMat);
      const wing = new THREE.Mesh(new THREE.BoxGeometry(22, 0.15, 5), proxyMat);
      wing.position.y = 0.6;
      const proxy = new THREE.Group();
      proxy.add(body, wing);
      proxy.position.set(c.x, 0, c.z).addScaledVector(fwd, num('proxyd', 60));
      proxy.position.y = num('proxyy', 9);
      proxy.rotation.y = yaw;
      proxy.traverse((o) => {
        o.castShadow = true;
      });
      group.add(proxy);
      ctx.scene.add(group);
    },
    update(_dt, ctx) {
      const night = ctx.services.tryGet('env')?.nightFactor ?? 0;
      windows[0].emissiveIntensity = night * 6;
      windows[1].emissiveIntensity = night * 25;
    },
  };
}

function createCameraRig(): System {
  let controls: OrbitControls | null = null;
  let spec = initialCamera();
  return {
    name: 'sandbox-camera',
    order: UpdateOrder.Camera,
    init(ctx) {
      const camera = ctx.camera;
      camera.fov = num('fov', 60);
      camera.near = 0.1;
      camera.far = 60000;
      camera.updateProjectionMatrix();
      placeCamera(camera, spec);
      if (flag('orbit', false)) {
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        controls = new OrbitControls(camera, ctx.canvas);
        controls.target.copy(camera.position).addScaledVector(fwd, num('pd', 300));
        controls.target.y = 0;
        controls.update();
      }
      (window as unknown as Record<string, unknown>).setCam = (lat: number, lon: number, alt: number, hdg: number, pitch: number) => {
        const p = latLonToLocal(lat, lon);
        spec = { x: p.x, y: alt, z: p.z, hdg, pitch };
        placeCamera(camera, spec);
      };
      (window as unknown as Record<string, unknown>).setCamLocal = (x: number, y: number, z: number, hdg: number, pitch: number) => {
        spec = { x, y, z, hdg, pitch };
        placeCamera(camera, spec);
      };
    },
    update(_dt, ctx) {
      if (controls) {
        controls.update();
      } else {
        placeCamera(ctx.camera, spec);
      }
    },
  };
}

const systems: System[] = [createGeoSystem(), createSkySystem(), createTerrainSystem()];
if (flag('water', true)) {
  systems.push(createWaterSystem());
}
if (flag('city', false)) {
  systems.push(createCitySystem(), createOsmSystem(), createMosqueSystem(), createStructureSystem(), createHeritageSystem());
}
if (flag('clouds', false)) {
  systems.push(createCloudSystem());
}
if (flag('props', true)) {
  systems.push(createProps());
}
systems.push(createCameraRig());

// Other modules' mid-edit compile errors are broadcast to every Vite client; keep the overlay out of water shots.
new MutationObserver(() => document.querySelector('vite-error-overlay')?.remove()).observe(document.documentElement, { childList: true, subtree: true });

void startSandbox({
  pipeline: params.get('pipe') === 'direct' ? undefined : createRenderPipeline,
  systems,
});
