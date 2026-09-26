/**
 * Structures sandbox (bridges, towers, skyscrapers) with the real geo, sky, terrain and water.
 *   /sandbox/structures.html?id=bogazici-koprusu&az=200&el=12&dist=1400&t=17.5
 *   ?id=a,b          build only these landmarks (default: all structures)
 *   &az &el &dist    orbit camera around the structure (degrees, metres); &tx &ty &tz override the target (&tyr: height
 *                    above the landmark base),
 *                    &anchor=<i> targets the landmark's i-th anchor (bridge towers, cluster towers)
 *   &view=<preset>   camera at a VIEW_PRESET;  &x &y &z &h &p explicit camera (heading/pitch degrees)
 *   &fov=60 &clouds=1 &water=real|flat|0 &terrain=0 &q=<quality preset>
 * window.__cam.set({...}) moves the camera; window.__structures.stats() returns module stats.
 */
import * as THREE from 'three';
import { startSandbox } from '../src/core/sandbox';
import { UpdateOrder, type EngineContext, type LandmarkDef, type System } from '../src/core/contracts';
import { VIEW_PRESETS } from '../src/core/debug';
import { headingToYaw } from '../src/core/geo-coords';
import { createRenderPipeline } from '../src/render/post';
import { createGeoSystem } from '../src/world/geo';
import { createSkySystem } from '../src/render/sky';
import { createCloudSystem } from '../src/render/clouds';
import { createTerrainSystem } from '../src/world/terrain';
import { createWaterSystem } from '../src/world/water';
import { StructureSystem } from '../src/world/landmarks/structures';

const params = new URLSearchParams(window.location.search);
const num = (k: string, d: number): number => (params.has(k) && params.get(k) !== '' ? Number(params.get(k)) : d);
const ids = params.get('id')?.split(',').filter(Boolean);

interface Pose {
  x: number;
  y: number;
  z: number;
  h: number;
  p: number;
  /** Orbit mode. */
  orbit: boolean;
  az: number;
  el: number;
  dist: number;
  tx: number;
  ty: number;
  tz: number;
}

function createSandboxCamera(): System {
  const preset = VIEW_PRESETS[params.get('view') ?? 'koprusu'] ?? VIEW_PRESETS.koprusu;
  const pose: Pose = {
    x: num('x', preset.x),
    y: num('y', preset.y),
    z: num('z', preset.z),
    h: num('h', preset.headingDeg),
    p: num('p', preset.pitchDeg),
    orbit: !!ids && !params.has('view') && !params.has('x'),
    az: num('az', 210),
    el: num('el', 14),
    dist: num('dist', 900),
    tx: 0,
    ty: 0,
    tz: 0,
  };
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  let targetReady = false;
  const apply = (ctx: EngineContext): void => {
    const cam = ctx.camera;
    cam.fov = num('fov', 55);
    cam.near = 0.5;
    cam.far = 60000;
    cam.updateProjectionMatrix();
    if (pose.orbit && targetReady) {
      const az = THREE.MathUtils.degToRad(pose.az);
      const el = THREE.MathUtils.degToRad(pose.el);
      // az: compass bearing FROM the target TO the camera
      cam.position.set(pose.tx + Math.sin(az) * Math.cos(el) * pose.dist, pose.ty + Math.sin(el) * pose.dist, pose.tz - Math.cos(az) * Math.cos(el) * pose.dist);
      cam.lookAt(pose.tx, pose.ty, pose.tz);
      return;
    }
    cam.position.set(pose.x, pose.y, pose.z);
    euler.set(THREE.MathUtils.degToRad(pose.p), headingToYaw(pose.h), 0, 'YXZ');
    cam.quaternion.setFromEuler(euler);
  };
  return {
    name: 'sandbox-camera',
    order: UpdateOrder.Camera,
    init(ctx) {
      apply(ctx);
      void ctx.services.when('geo').then((geo) => {
        const def: LandmarkDef | undefined = ids ? geo.landmark(ids[0]) : undefined;
        if (def) {
          const anchor = params.has('anchor') ? def.anchors?.[num('anchor', 0)] : undefined;
          pose.tx = num('tx', anchor?.x ?? def.x);
          pose.tz = num('tz', anchor?.z ?? def.z);
          pose.ty = num('ty', def.y + num('tyr', def.height * 0.35));
        }
        targetReady = true;
      });
      (window as unknown as Record<string, unknown>).__cam = {
        set: (p: Partial<Pose>) => {
          Object.assign(pose, p);
          apply(ctx);
        },
        pose,
      };
    },
    update(_dt, ctx) {
      apply(ctx);
    },
  };
}

function createFlatWater(): System {
  return {
    name: 'flat-water',
    order: UpdateOrder.World,
    init(ctx) {
      const m = new THREE.MeshStandardMaterial({ color: 0x0c2230, roughness: 0.08, metalness: 0 });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(200000, 200000).rotateX(-Math.PI / 2), m);
      mesh.receiveShadow = true;
      ctx.scene.add(mesh);
    },
  };
}

const structures = new StructureSystem({ only: ids });
(window as unknown as Record<string, unknown>).__structures = structures;

const systems: System[] = [createGeoSystem(), createSkySystem()];
if (params.get('terrain') !== '0') {
  systems.push(createTerrainSystem());
}
const water = params.get('water') ?? 'real';
if (water === 'real') {
  systems.push(createWaterSystem());
} else if (water === 'flat') {
  systems.push(createFlatWater());
}
if (params.get('clouds') === '1') {
  systems.push(createCloudSystem());
}
systems.push(structures, createSandboxCamera());

void startSandbox({ pipeline: createRenderPipeline, systems });
