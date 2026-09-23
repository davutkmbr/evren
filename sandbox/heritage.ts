/**
 * Heritage sandbox: real geo, sky, terrain and water with only the heritage module (orbit camera).
 *   /sandbox/heritage.html?id=beylerbeyi-sarayi&t=17.5        isolate one landmark, orbit around it
 *   &az=200&el=25&dist=300                                    orbit azimuth (compass deg, camera -> target), elevation, distance
 *   &lat=..&lon=..&ty=..                                      orbit target by lat/lon (+ height above ground)
 *   &fov=50 &clouds=1 &water=0 &q=high|ultra|low &lod=0|1      options
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { startSandbox } from '../src/core/sandbox';
import { UpdateOrder, type EngineContext, type System } from '../src/core/contracts';
import { latLonToLocal } from '../src/core/geo-coords';
import { createRenderPipeline } from '../src/render/post';
import { createGeoSystem } from '../src/world/geo';
import { createSkySystem } from '../src/render/sky';
import { createCloudSystem } from '../src/render/clouds';
import { createTerrainSystem } from '../src/world/terrain';
import { createWaterSystem } from '../src/world/water';
import { createHeritageSystem } from '../src/world/landmarks/heritage';

const params = new URLSearchParams(window.location.search);
const num = (k: string, d: number): number => (params.has(k) ? Number(params.get(k)) : d);

function createOrbitCamera(): System {
  let controls: OrbitControls | null = null;
  return {
    name: 'sandbox-orbit',
    order: UpdateOrder.Camera,
    async init(ctx: EngineContext) {
      const geo = await ctx.services.when('geo');
      const id = params.get('id') ?? 'topkapi-sarayi';
      const l = geo.landmark(id);
      let tx = l?.x ?? 0;
      let tz = l?.z ?? 0;
      if (params.has('lat') && params.has('lon')) {
        const p = latLonToLocal(num('lat', 41), num('lon', 29));
        tx = p.x;
        tz = p.z;
      }
      const ty = Math.max(0, geo.heightAt(tx, tz)) + num('ty', (l?.height ?? 20) * 0.35);
      const az = THREE.MathUtils.degToRad(num('az', 200));
      const el = THREE.MathUtils.degToRad(num('el', 22));
      const dist = num('dist', Math.max(180, (l?.radius ?? 100) * 2.4));
      const cam = ctx.camera;
      // Camera sits opposite to the viewing direction: az is the compass heading of the view (camera -> target).
      cam.position.set(tx - Math.sin(az) * Math.cos(el) * dist, ty + Math.sin(el) * dist, tz + Math.cos(az) * Math.cos(el) * dist);
      cam.fov = num('fov', 50);
      cam.near = 0.5;
      cam.far = 60000;
      cam.updateProjectionMatrix();
      controls = new OrbitControls(cam, ctx.canvas);
      controls.target.set(tx, ty, tz);
      controls.enableDamping = true;
      controls.update();
      (window as unknown as Record<string, unknown>).__orbit = controls;
    },
    update() {
      controls?.update();
    },
  };
}

const systems: System[] = [createGeoSystem(), createSkySystem(), createTerrainSystem()];
if (params.get('water') !== '0') {
  systems.push(createWaterSystem());
}
if (params.get('clouds') === '1') {
  systems.push(createCloudSystem());
}
const heritage = createHeritageSystem();
systems.push(heritage, createOrbitCamera());
(window as unknown as Record<string, unknown>).__heritage = heritage;

void startSandbox({ pipeline: createRenderPipeline, systems });
