/**
 * Life sandbox: real geo + sky + terrain + water (+ optional clouds / city + landmarks) + life, scripted camera.
 *   /sandbox/life.html?view=bogaz&t=18.5            camera at a debug view preset (debug.ts)
 *   &lat=41.04&lon=29.02&alt=40&hdg=30&pitch=-8     explicit camera
 *   &follow=vapur&dist=120&az=140&h=35             chase the n-th (&vi=0) vessel of a kind (azimuth from its bow)
 *   &pier=kadikoy&dist=200&az=0&h=60                look at a pier berth
 *   &orbit=1                                        OrbitControls
 *   &city=1 &clouds=1                               include city + landmarks / clouds
 *   &dragon=1                                       fake dragon flying a circle through the camera view (gull scatter)
 *   &warp=600                                       advance the simulation by N seconds before the shot
 * Console: window.__life, window.setCam(lat, lon, alt, hdg, pitch)
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { startSandbox } from '../src/core/sandbox';
import { UpdateOrder, type DragonState, type EngineContext, type System } from '../src/core/contracts';
import { VIEW_PRESETS } from '../src/core/debug';
import { latLonToLocal } from '../src/core/geo-coords';
import { createRenderPipeline } from '../src/render/post';
import { createSkySystem } from '../src/render/sky';
import { createCloudSystem } from '../src/render/clouds';
import { createGeoSystem } from '../src/world/geo';
import { createTerrainSystem } from '../src/world/terrain';
import { createWaterSystem } from '../src/world/water';
import { createCitySystem } from '../src/world/city';
import { createMosqueSystem } from '../src/world/landmarks/mosques';
import { createStructureSystem } from '../src/world/landmarks/structures';
import { createHeritageSystem } from '../src/world/landmarks/heritage';
import { createLifeSystem } from '../src/world/life';
import type { LifeDebug } from '../src/world/life/life-system';

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
  return { x, y: num('alt', preset?.y ?? 60), z, hdg: num('hdg', preset?.headingDeg ?? 30), pitch: num('pitch', preset?.pitchDeg ?? -6) };
}

function placeCamera(camera: THREE.PerspectiveCamera, c: CamSpec): void {
  camera.position.set(c.x, c.y, c.z);
  camera.rotation.set(THREE.MathUtils.degToRad(c.pitch), -THREE.MathUtils.degToRad(c.hdg), 0, 'YXZ');
  camera.updateMatrixWorld();
}

const life = (): LifeDebug | undefined => (window as unknown as { __life?: LifeDebug }).__life;

function createCameraRig(): System {
  let controls: OrbitControls | null = null;
  let spec = initialCamera();
  const follow = params.get('follow');
  const pier = params.get('pier');
  const target = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  let warped = false;
  let pathsShown = false;
  return {
    name: 'sandbox-camera',
    order: UpdateOrder.Effects + 50,
    init(ctx) {
      const camera = ctx.camera;
      camera.fov = num('fov', 55);
      camera.near = 0.2;
      camera.far = 60000;
      camera.updateProjectionMatrix();
      placeCamera(camera, spec);
      if (flag('orbit', false)) {
        controls = new OrbitControls(camera, ctx.canvas);
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        controls.target.copy(camera.position).addScaledVector(fwd, num('pd', 300));
        controls.target.y = 0;
        controls.update();
      }
      (window as unknown as Record<string, unknown>).setCam = (lat: number, lon: number, alt: number, hdg: number, pitch: number) => {
        const p = latLonToLocal(lat, lon);
        spec = { x: p.x, y: alt, z: p.z, hdg, pitch };
        placeCamera(camera, spec);
      };
    },
    update(dt, ctx) {
      const l = life();
      const sys = l?.system;
      if (sys && flag('paths', false) && !pathsShown && sys.fleet) {
        pathsShown = true;
        const mat = (c: number): THREE.LineBasicMaterial => new THREE.LineBasicMaterial({ color: c, depthTest: false, transparent: true });
        const line = (xs: ArrayLike<number>, zs: ArrayLike<number>, c: number): void => {
          const pts: THREE.Vector3[] = [];
          for (let i = 0; i < xs.length; i++) pts.push(new THREE.Vector3(xs[i], 3, zs[i]));
          const obj = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat(c));
          obj.renderOrder = 999;
          ctx.scene.add(obj);
        };
        for (const plan of sys.fleet.services) {
          const c = plan.line.model === 'seabus' ? 0x00ffff : plan.line.model === 'ferry' ? 0xff9900 : 0xffff00;
          for (const leg of plan.legs) {
            line(leg.route.xs, leg.route.zs, c);
            if (leg.undock) line(leg.undock.xs, leg.undock.zs, 0xffffff);
          }
        }
        if (sys.lanes) {
          line(sys.lanes.south.xs, sys.lanes.south.zs, 0xff3030);
          line(sys.lanes.north.xs, sys.lanes.north.zs, 0x30ff30);
        }
        const tl = sys.fleet.tourLoop;
        if (tl) line(tl.xs, tl.zs, 0xff00ff);
        if (sys.berths) {
          for (const list of sys.berths.values()) {
            for (const b of list) line([b.shore.x, b.face.x], [b.shore.z, b.face.z], 0xffffff);
          }
        }
      }
      if (sys && !warped && params.has('warp')) {
        warped = true;
        const steps = Math.ceil(num('warp', 0) / 0.5);
        for (let i = 0; i < steps; i++) sys.update(0.5, ctx);
      }
      if (controls) {
        controls.update();
        return;
      }
      const camera = ctx.camera;
      if (params.has('bird') && sys?.flocks) {
        const bp = new THREE.Vector3();
        const bv = new THREE.Vector3();
        if (sys.flocks.debugBird(num('bird', 0), bp, bv)) {
          const d = bv.lengthSq() > 0.01 ? bv.clone().normalize() : new THREE.Vector3(0, 0, -1);
          const az = THREE.MathUtils.degToRad(num('az', 150));
          const off = d.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), az).multiplyScalar(num('dist', 5));
          camera.position.copy(bp).add(off);
          camera.position.y += num('h', 1.5);
          camera.lookAt(bp);
          camera.updateMatrixWorld();
          return;
        }
      }
      if (follow && sys?.fleet) {
        const list = sys.fleet.vessels.filter((v) => v.model.kind === follow || v.model.key === follow);
        const v = list[Math.min(num('vi', 0), list.length - 1)];
        if (v) {
          const az = THREE.MathUtils.degToRad(num('az', 140));
          const dist = num('dist', v.model.length * 1.6 + 30);
          const yaw = v.state.yaw + az;
          target.set(v.state.x, num('ty', v.model.airDraft * 0.3), v.state.z);
          camera.position.set(target.x - Math.sin(yaw) * dist, num('h', dist * 0.3), target.z - Math.cos(yaw) * dist);
          camera.lookAt(target);
          camera.updateMatrixWorld();
          return;
        }
      }
      if (pier && sys?.berths) {
        const b = sys.berths.get(pier)?.[num('bi', 0)];
        if (b) {
          const az = THREE.MathUtils.degToRad(num('az', 0));
          const dist = num('dist', 220);
          tmp.set(b.n.x, 0, b.n.z).applyAxisAngle(new THREE.Vector3(0, 1, 0), az);
          target.set(b.face.x, num('ty', 5), b.face.z);
          camera.position.set(target.x + tmp.x * dist, num('h', 60), target.z + tmp.z * dist);
          camera.lookAt(target);
          camera.updateMatrixWorld();
          return;
        }
      }
      placeCamera(camera, spec);
      void dt;
    },
  };
}

/** Fake dragon service: circles in front of the camera start so gull scattering can be tested. */
function createFakeDragon(): System {
  const object = new THREE.Object3D();
  const state = {
    object,
    position: object.position,
    quaternion: object.quaternion,
    velocity: new THREE.Vector3(),
    angularVelocity: new THREE.Vector3(),
    mode: 'flying',
    airspeed: 20,
    altitude: 30,
    agl: 30,
    headingDeg: 0,
    gForce: 1,
    stamina: 1,
    flapEffort: 0.5,
    firing: false,
    touchingWater: false,
  } as unknown as DragonState;
  let t = 0;
  const c = new THREE.Vector3();
  return {
    name: 'fake-dragon',
    order: UpdateOrder.Physics,
    init(ctx: EngineContext) {
      const s = initialCamera();
      const yaw = -THREE.MathUtils.degToRad(s.hdg);
      c.set(s.x - Math.sin(yaw) * 250, num('dy', 25), s.z - Math.cos(yaw) * 250);
      ctx.services.provide('dragon', state);
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(3, 12, 8), new THREE.MeshStandardMaterial({ color: 0x5a2020 }));
      object.add(mesh);
      ctx.scene.add(object);
    },
    update(dt) {
      t += dt;
      const r = num('dr', 120);
      const prev = object.position.clone();
      object.position.set(c.x + Math.cos(t * 0.15) * r, c.y, c.z + Math.sin(t * 0.15) * r);
      if (dt > 0) state.velocity.subVectors(object.position, prev).divideScalar(dt);
    },
  };
}

const systems: System[] = [createGeoSystem(), createSkySystem(), createTerrainSystem(), createWaterSystem()];
if (flag('city', false)) {
  systems.push(createCitySystem(), createMosqueSystem(), createStructureSystem(), createHeritageSystem());
}
if (flag('clouds', false)) {
  systems.push(createCloudSystem());
}
if (flag('dragon', false)) {
  systems.push(createFakeDragon());
}
systems.push(createLifeSystem(), createCameraRig());

// Other modules' mid-edit compile errors are broadcast to every Vite client; keep the overlay out of shots.
new MutationObserver(() => document.querySelector('vite-error-overlay')?.remove()).observe(document.documentElement, { childList: true, subtree: true });

void startSandbox({
  pipeline: params.get('pipe') === 'direct' ? undefined : createRenderPipeline,
  systems,
});
