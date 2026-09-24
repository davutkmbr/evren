/**
 * City sandbox: real geo + sky + terrain + water + city, fixed or orbit camera.
 *   /sandbox/city.html?view=galata&t=17.5          camera at a debug view preset (debug.ts)
 *   &lat=41.03&lon=28.98&alt=120&hdg=60&pitch=-10   explicit camera (alt in metres above sea level)
 *   &agl=40                                          altitude above the terrain instead of above sea level
 *   &orbit=1                                         OrbitControls around a point `pd` m ahead
 *   &water=0 &clouds=1 &q=low|medium|high|ultra      scene / quality options
 *   &fly=1                                           camera flies forward at &speed m/s (streaming test)
 * Console: __cam.set({x, y, z, hdg, pitch}), __city.stats()
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
  const preset = VIEW_PRESETS[params.get('view') ?? 'galata'] ?? VIEW_PRESETS.galata;
  let x = preset.x;
  let z = preset.z;
  if (params.has('lat') && params.has('lon')) {
    const p = latLonToLocal(num('lat', 41.03), num('lon', 28.98));
    x = p.x;
    z = p.z;
  }
  return {
    x: num('x', x),
    y: num('alt', preset.y),
    z: num('z', z),
    hdg: num('hdg', preset.headingDeg),
    pitch: num('pitch', preset.pitchDeg),
  };
}

function placeCamera(camera: THREE.PerspectiveCamera, c: CamSpec): void {
  camera.position.set(c.x, c.y, c.z);
  camera.rotation.set(THREE.MathUtils.degToRad(c.pitch), -THREE.MathUtils.degToRad(c.hdg), 0, 'YXZ');
  camera.updateMatrixWorld();
}

function createCameraRig(): System {
  const spec = initialCamera();
  let controls: OrbitControls | null = null;
  const forward = new THREE.Vector3();
  return {
    name: 'sandbox-camera',
    order: UpdateOrder.Camera,
    init(ctx: EngineContext) {
      const cam = ctx.camera;
      cam.fov = num('fov', 60);
      cam.near = 0.5;
      cam.far = 60000;
      cam.updateProjectionMatrix();
      if (params.has('agl')) {
        const geo = ctx.services.get('geo');
        spec.y = Math.max(geo.heightAt(spec.x, spec.z), 0) + num('agl', 40);
      }
      placeCamera(cam, spec);
      if (flag('orbit', false)) {
        controls = new OrbitControls(cam, ctx.canvas);
        cam.getWorldDirection(forward);
        controls.target.copy(cam.position).addScaledVector(forward, num('pd', 400));
        controls.enableDamping = true;
        controls.update();
      }
      (window as unknown as { __cam: unknown }).__cam = {
        set: (c: Partial<CamSpec>) => {
          Object.assign(spec, c);
          placeCamera(cam, spec);
          controls?.target.copy(cam.position).addScaledVector(cam.getWorldDirection(forward), num('pd', 400));
        },
        spec,
      };
    },
    update(dt: number, ctx: EngineContext) {
      if (controls) {
        controls.update();
        return;
      }
      if (flag('fly', false)) {
        const speed = num('speed', 60);
        const step = (dt > 0 ? dt : ctx.time.realDt) * speed;
        const yaw = -THREE.MathUtils.degToRad(spec.hdg);
        spec.x += -Math.sin(yaw) * step;
        spec.z += -Math.cos(yaw) * step;
      }
      placeCamera(ctx.camera, spec);
    },
  };
}

const systems: System[] = [createGeoSystem(), createSkySystem(), createTerrainSystem()];
if (flag('water', true)) {
  systems.push(createWaterSystem());
}
// The OSM slice is part of the one map: the city leaves its area to it.
systems.push(createCitySystem(), createOsmSystem());
if (flag('clouds', false)) {
  systems.push(createCloudSystem());
}
systems.push(createCameraRig());

void startSandbox({ pipeline: createRenderPipeline, systems });
