/**
 * Mosque sandbox: landmark mosques / neighbourhood prototypes in isolation, real sky + post pipeline, orbit camera.
 *   ?id=sultanahmet            one landmark at the origin (any geo landmark id with builder 'mosques')
 *   ?id=small                  the neighbourhood prototypes in a grid (site i -> prototype i)
 *   ?id=all                    every landmark spec in a grid
 *   &t=17.5                    time of day (h), &lod=0|1|2 forced LOD, &heading=151 building qibla heading
 *   &az=200&el=18&dist=180     camera azimuth (deg, compass, from the target), elevation (deg), distance (m)
 *   &ty=20                     orbit target height, &tx/&tz target offset
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { startSandbox } from '../src/core/sandbox';
import { LandUse, UpdateOrder, type District, type GeoQuery, type LandmarkDef, type System } from '../src/core/contracts';
import type { LodLevel } from '../src/world/landmarks/mosques/gen/types';
import { LANDMARK_SPECS } from '../src/world/landmarks/mosques/gen/specs';
import { createRenderPipeline } from '../src/render/post';
import { createSkySystem } from '../src/render/sky';
import { createMosqueSystem } from '../src/world/landmarks/mosques';
import type { Collider, CollisionWorld } from '../src/core/collision';

const params = new URLSearchParams(window.location.search);
const num = (k: string, d: number): number => (params.has(k) ? Number(params.get(k)) : d);
const id = params.get('id') ?? 'sultanahmet';
const heading = num('heading', 180);

function landmark(key: string, x: number, z: number): LandmarkDef {
  return { id: key, name: key, kind: 'mosque', builder: 'mosques', lat: 0, lon: 0, x, y: 0, z, headingDeg: heading, radius: 80, height: 60, info: '' };
}

function layout(): { landmarks: LandmarkDef[]; sites: GeoQuery['smallMosqueSites']; extent: number } {
  if (id === 'small') {
    const sites = Array.from({ length: 12 }, (_, i) => ({ x: ((i % 4) - 1.5) * 70, z: (Math.floor(i / 4) - 1) * 80, y: 0, radius: 30, size: 0.5, headingDeg: heading }));
    return { landmarks: [], sites, extent: 180 };
  }
  if (id === 'all') {
    const keys = Object.keys(LANDMARK_SPECS);
    const cols = 5;
    const step = 240;
    return {
      landmarks: keys.map((k, i) => landmark(k, ((i % cols) - (cols - 1) / 2) * step, (Math.floor(i / cols) - 2) * step)),
      sites: [],
      extent: 700,
    };
  }
  return { landmarks: [landmark(id, 0, 0)], sites: [], extent: 90 };
}

function stubGeo(landmarks: LandmarkDef[], sites: GeoQuery['smallMosqueSites']): GeoQuery {
  const grid = <T extends Float32Array | Uint8Array>(data: T) => ({ data, width: 1, height: 1, cellSize: 48000, originX: 0, originZ: 0 });
  const tex = (): THREE.DataTexture => new THREE.DataTexture(new Float32Array(4), 1, 1, THREE.RGBAFormat, THREE.FloatType);
  return {
    bounds: { minX: -24000, maxX: 24000, minZ: -24000, maxZ: 24000 },
    heightAt: () => 0,
    normalAt: (_x: number, _z: number, out: THREE.Vector3) => out.set(0, 1, 0),
    isWater: () => false,
    coastDistance: () => 5000,
    landUseAt: () => LandUse.Urban,
    densityAt: () => 0,
    districtAt: (): District | null => null,
    buildableAt: () => false,
    landmarks,
    landmark: (key: string) => landmarks.find((l) => l.id === key),
    roads: [],
    smallMosqueSites: sites,
    coastlines: [],
    districts: [],
    heightGrid: grid(new Float32Array(1)),
    landUseGrid: grid(new Uint8Array(1)),
    getHeightTexture: tex,
    getLandUseTexture: tex,
    getCoastDistanceTexture: tex,
  };
}

function groundSystem(extent: number): System {
  return {
    name: 'mosque-sandbox-ground',
    order: UpdateOrder.World,
    init(ctx) {
      const earth = new THREE.MeshStandardMaterial({ roughness: 0.95 });
      earth.color.setRGB(0.2, 0.19, 0.16, THREE.LinearSRGBColorSpace);
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000).rotateX(-Math.PI / 2), earth);
      ground.receiveShadow = true;
      ctx.scene.add(ground);
      const paveMat = new THREE.MeshStandardMaterial({ roughness: 0.85 });
      paveMat.color.setRGB(0.32, 0.3, 0.27, THREE.LinearSRGBColorSpace);
      const pave = new THREE.Mesh(new THREE.PlaneGeometry(extent * 2.6, extent * 2.6).rotateX(-Math.PI / 2), paveMat);
      pave.position.y = 0.05;
      pave.receiveShadow = true;
      ctx.scene.add(pave);
    },
  };
}

function cameraRig(extent: number): System {
  let controls: OrbitControls | null = null;
  return {
    name: 'mosque-sandbox-camera',
    order: UpdateOrder.Camera,
    init(ctx) {
      const cam = ctx.camera;
      cam.fov = num('fov', 55);
      cam.near = 0.5;
      cam.far = 60000;
      cam.updateProjectionMatrix();
      const az = THREE.MathUtils.degToRad(num('az', 200));
      const el = THREE.MathUtils.degToRad(num('el', 16));
      const dist = num('dist', extent * 2.4);
      const target = new THREE.Vector3(num('tx', 0), num('ty', 18), num('tz', 0));
      cam.position.set(target.x + Math.sin(az) * Math.cos(el) * dist, target.y + Math.sin(el) * dist, target.z - Math.cos(az) * Math.cos(el) * dist);
      cam.lookAt(target);
      controls = new OrbitControls(cam, ctx.canvas);
      controls.target.copy(target);
      controls.enableDamping = true;
      controls.update();
    },
    update() {
      controls?.update();
    },
  };
}

const { landmarks, sites, extent } = layout();
const lodParam = params.get('lod');
const mosques = createMosqueSystem({ cycleVariants: id === 'small', forceLod: lodParam !== null ? (Number(lodParam) as LodLevel) : undefined });

const geoProvider: System = {
  name: 'mosque-sandbox-geo',
  order: UpdateOrder.World,
  init(ctx) {
    ctx.services.provide('geo', stubGeo(landmarks, sites));
  },
};

/** ?colliders=1: wireframe overlay of every registered collider (checks the local -> world collider transforms). */
function showColliders(scene: THREE.Scene, world: CollisionWorld): void {
  const entries = (world as unknown as { entries: Map<number, { collider: Collider }> }).entries;
  const mat = new THREE.MeshBasicMaterial({ color: 0xff3355, wireframe: true, fog: false });
  for (const { collider: c } of entries.values()) {
    let mesh: THREE.Mesh;
    if (c.kind === 'box') {
      mesh = new THREE.Mesh(new THREE.BoxGeometry(c.halfSize.x * 2, c.halfSize.y * 2, c.halfSize.z * 2), mat);
      mesh.position.copy(c.center);
      mesh.rotation.y = c.yaw;
    } else if (c.kind === 'cylinder') {
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(c.radius, c.radius, c.height, 12, 1, true), mat);
      mesh.position.set(c.base.x, c.base.y + c.height / 2, c.base.z);
    } else {
      mesh = new THREE.Mesh(new THREE.SphereGeometry(c.radius, 16, 8), mat);
      mesh.position.copy(c.center);
    }
    scene.add(mesh);
  }
}

void startSandbox({
  pipeline: createRenderPipeline,
  systems: [geoProvider, createSkySystem(), groundSystem(extent), cameraRig(extent), mosques],
}).then((engine) => {
  (window as unknown as { __mosques: unknown }).__mosques = { engine, mosques, THREE };
  if (params.get('colliders') === '1') {
    const poll = (): void => {
      if ((mosques.pending?.() ?? 0) > 0) {
        setTimeout(poll, 200);
        return;
      }
      showColliders(engine.ctx.scene, engine.ctx.services.get('collision'));
    };
    poll();
  }
});
