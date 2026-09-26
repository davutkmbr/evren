/**
 * WebGPU spike (.docs/research/webgpu-spike.md): the Galata OSM buildings rendered with three's WebGPURenderer and
 * TSL node materials, at the game's Galata view.
 *
 *   /sandbox/webgpu.html                    WebGPURenderer, WebGPU backend (falls back to WebGL2 when unavailable)
 *   ?backend=webgl                          WebGPURenderer forced onto its WebGL2 backend (forceWebGL)
 *   ?backend=classic                        control: the same scene with the game's WebGLRenderer and GLSL materials
 *   &post=0  &csm=0 (single shadow map)  &shadows=0  &props=0  &ground=0  &fog=0  &t=16  &fps=0 (uncapped)
 *   &stress=N (render N times per animation frame)  &lat=&lon=&alt=&hdg=&pitch= (debug camera)  &env= &exp=
 *
 * Standalone page (startSandbox's Engine owns a WebGLRenderer). Exposes window.__evren { ready, pending(), stats(),
 * frame } so scripts/snap.mjs can wait for it and read its numbers.
 */
import * as THREE from 'three/webgpu';
import { pass, mrt, output, emissive, uniform, float } from 'three/tsl';
import { bloom } from 'three/examples/jsm/tsl/display/BloomNode.js';
import { SkyMesh } from 'three/examples/jsm/objects/SkyMesh.js';
import { CSMShadowNode } from 'three/examples/jsm/csm/CSMShadowNode.js';
import type { EngineContext, GeoQuery } from '../src/core/contracts';
import { ServiceRegistry } from '../src/core/services';
import { latLonToLocal } from '../src/core/geo-coords';
import { createGeoSystem } from '../src/world/geo';
import { OSM_DATA_URL, osmAreaRect, osmExclusionRect } from '../src/world/osm/area';
import { loadOsmData } from '../src/world/osm/data';
import { buildWorkerBase } from '../src/world/osm/shared/foundation';
import { runWorker } from '../src/world/osm/shared/worker';
import { countTriangles } from '../src/world/osm/shared/three';
import { LodTiledMesh } from '../src/world/osm/shared/lod-tiles';
import { InstanceLod, type InstanceLodOptions } from '../src/world/osm/shared/instance-lod';
import { loadPbrArrays, loadTexture, REPEAT_M, type TextureSet } from '../src/world/osm/shared/textures';
import { poiTriples } from '../src/world/osm/buildings/index';
import { landmarkClaims } from '../src/world/landmarks/claims';
import type { BuildingsRequest, BuildingsResult } from '../src/world/osm/buildings/protocol';
import { FACADE_LAYERS } from '../src/world/osm/buildings/materials';
import { antennaGeometry, chimneyGeometry, dishGeometry, minaretGeometry, solarGeometry, tankGeometry } from '../src/world/osm/buildings/props';
import type { PropKind } from '../src/world/osm/buildings/roofs';
import { U, atmosphereFogNode } from './webgpu/atmosphere';
import { createFacadeNodeMaterial } from './webgpu/facade';
import { createRoofNodeMaterial } from './webgpu/roof';

const params = new URLSearchParams(location.search);
const backendParam = params.get('backend') ?? 'webgpu';
const classic = backendParam === 'classic';
const flag = (k: string, d: boolean): boolean => (params.has(k) ? params.get(k) === '1' || params.get(k) === 'true' : d);
const timeOfDay = Number(params.get('t') ?? 16);
const usePost = flag('post', true);
const useCsm = flag('csm', true);
const useShadows = flag('shadows', true);
const useProps = flag('props', true);
const useGround = flag('ground', true);
const useFog = flag('fog', true);
const stress = Math.max(1, Number(params.get('stress') ?? 1));

/** Game camera at ?view=galata (third-person rig behind the dragon, read from the running game at t=16). */
const GAME_CAMERA = {
  position: [-4853.922837243542, 166.43029169235183, 2954.712014747699] as const,
  quaternion: [-0.03877394244332869, -0.5441155062610705, -0.025183969010273782, 0.8377354385117952] as const,
  fov: 60.93140912384171,
  near: 0.25,
  far: 60000,
};
/** Key light of the game's sky system at t=16 (city sandbox): direction towards the sun, colour, intensity. */
const SUN = { dir: new THREE.Vector3(-0.7183227550690419, 0.5225408500985899, 0.459307608829055).normalize(), color: new THREE.Color(1, 0.9346, 0.8353), intensity: 5.4355 };
const EXPOSURE = Number(new URLSearchParams(location.search).get('exp') ?? 0.766);

const PROP_GEOMETRY: Record<PropKind, () => THREE.BufferGeometry> = {
  chimney: chimneyGeometry,
  tank: tankGeometry,
  solar: solarGeometry,
  dish: dishGeometry,
  antenna: antennaGeometry,
  minaret: minaretGeometry,
};
const PROP_LOD: Record<PropKind, InstanceLodOptions> = {
  tank: { radius: 650, shadowRadius: 220 },
  solar: { radius: 800, shadowRadius: 260 },
  chimney: { radius: 550, shadowRadius: 200 },
  dish: { radius: 450, shadowRadius: 0 },
  antenna: { radius: 420, shadowRadius: 0 },
  minaret: { radius: Infinity, shadowRadius: Infinity },
};
/** Copied from materials.ts (not exported there). */
const LAYER_REPEAT: Partial<Record<TextureSet, number>> = { stone: 3.4 };
const LAYER_NORMAL: Partial<Record<TextureSet, number>> = { plaster: 0.7, plaster_painted: 0.8, stone: 0.45, concrete: 0.6, brick: 0.9 };

function layerLuminance(t: THREE.DataArrayTexture): number[] {
  const img = t.image as unknown as { data: Uint8Array; width: number; height: number; depth: number };
  const layer = img.width * img.height * 4;
  const out: number[] = [];
  const lin = (c: number): number => Math.pow(c / 255, 2.2);
  for (let l = 0; l < img.depth; l++) {
    let sum = 0;
    let n = 0;
    for (let k = l * layer; k < (l + 1) * layer; k += 4 * 97) {
      sum += 0.2126 * lin(img.data[k]) + 0.7152 * lin(img.data[k + 1]) + 0.0722 * lin(img.data[k + 2]);
      n++;
    }
    out.push(Math.max(0.05, sum / Math.max(1, n)));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Timing log (also printed to the console for snap.mjs --logs).
const T0 = performance.now();
const timings: Record<string, number> = {};
const mark = (k: string, since = T0): number => (timings[k] = Math.round(performance.now() - since));

type AnyRenderer = THREE.WebGPURenderer | import('three').WebGLRenderer;

interface SpikeState {
  renderer: AnyRenderer;
  backend: string;
  ready: boolean;
  jobs: number;
  frame: number;
  drawCalls: number;
  triangles: number;
  gpuMs: number;
  programs: number;
  sceneTriangles: number;
  error: string | null;
  /** Median CPU time of one renderFrame() call (JS submit cost). */
  cpuMedianMs: () => number;
}

const state: SpikeState = { renderer: null as unknown as AnyRenderer, backend: 'pending', ready: false, jobs: 1, frame: 0, drawCalls: 0, triangles: 0, gpuMs: -1, programs: 0, sceneTriangles: 0, error: null, cpuMedianMs: () => -1 };

(window as unknown as { __evren: unknown }).__evren = {
  get ready() {
    return state.ready;
  },
  get frame() {
    return state.frame;
  },
  pending: () => state.jobs,
  stats: () => ({
    backend: state.backend,
    drawCalls: state.drawCalls,
    triangles: state.triangles,
    sceneTriangles: state.sceneTriangles,
    gpuMs: state.gpuMs,
    cpuRenderMs: state.cpuMedianMs(),
    programs: state.programs,
    timings,
    error: state.error,
    options: { post: usePost, csm: useCsm, shadows: useShadows, props: useProps, ground: useGround },
  }),
  state,
};

function setStatus(text: string): void {
  let el = document.getElementById('spike-status');
  if (!el) {
    el = document.createElement('div');
    el.id = 'spike-status';
    el.style.cssText = 'position:fixed;left:12px;top:10px;font:12px/1.4 ui-monospace,monospace;color:#fff;background:rgba(0,0,0,.45);padding:6px 9px;border-radius:6px;z-index:5;pointer-events:none;white-space:pre';
    document.body.appendChild(el);
  }
  el.textContent = text;
}

// ---------------------------------------------------------------------------------------------------------------

/** Low-res terrain + sea around the camera so the buildings sit on something (not part of the port). */
function groundMesh(geo: GeoQuery, material: THREE.Material): THREE.Mesh {
  const N = 480;
  const size = 14000;
  const cx = GAME_CAMERA.position[0] + 3500;
  const cz = GAME_CAMERA.position[2] - 2500;
  const pos = new Float32Array((N + 1) * (N + 1) * 3);
  const col = new Float32Array((N + 1) * (N + 1) * 3);
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const x = cx - size / 2 + (i / N) * size;
      const z = cz - size / 2 + (j / N) * size;
      const k = (j * (N + 1) + i) * 3;
      const coast = geo.coastDistance(x, z);
      const h = geo.heightAt(x, z);
      const water = coast < 0;
      pos[k] = x;
      pos[k + 1] = water ? -0.4 : Math.max(h, 0.2) - 0.35;
      pos[k + 2] = z;
      const c = water ? [0.02, 0.035, 0.045] : [0.07, 0.068, 0.064];
      col.set(c, k);
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const a = j * (N + 1) + i;
      idx.push(a, a + N + 1, a + 1, a + 1, a + N + 1, a + N + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, material);
  mesh.receiveShadow = true;
  mesh.name = 'spike-ground';
  return mesh;
}

async function createRenderer(canvas: HTMLCanvasElement): Promise<AnyRenderer> {
  if (classic) {
    const { WebGLRenderer } = await import('three');
    const { installGlobalShaderHooks } = await import('../src/core/uniforms');
    installGlobalShaderHooks();
    const r = new WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', reversedDepthBuffer: true });
    r.shadowMap.enabled = useShadows;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.info.autoReset = false;
    state.backend = 'classic-webgl2';
    return r;
  }
  const r = new THREE.WebGPURenderer({ canvas, antialias: false, powerPreference: 'high-performance', forceWebGL: backendParam === 'webgl', reversedDepthBuffer: true, trackTimestamp: true });
  const t = performance.now();
  await r.init();
  mark('rendererInitMs', t);
  const isWebGPU = (r.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend === true;
  state.backend = isWebGPU ? 'webgpu' : 'webgl2-fallback';
  r.shadowMap.enabled = useShadows;
  r.shadowMap.type = THREE.PCFShadowMap;
  console.info(`[webgpu-spike] backend: ${state.backend} (requested ${backendParam})`);
  return r;
}

async function main(): Promise<void> {
  const container = document.getElementById('app')!;
  document.body.style.margin = '0';
  document.body.style.background = '#000';
  document.body.style.overflow = 'hidden';
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:block;width:100vw;height:100vh';
  container.appendChild(canvas);
  setStatus(`backend: ${backendParam} (initialising)`);

  const renderer = await createRenderer(canvas);
  state.renderer = renderer;
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setPixelRatio(1);
  renderer.setSize(w, h, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = EXPOSURE;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(GAME_CAMERA.fov, w / h, GAME_CAMERA.near, GAME_CAMERA.far);
  camera.position.fromArray(GAME_CAMERA.position);
  camera.quaternion.fromArray(GAME_CAMERA.quaternion);
  if (params.has('lat') && params.has('lon')) {
    // Debug close-ups: &lat=&lon=&alt=&hdg=&pitch= (compass heading, degrees).
    const p = latLonToLocal(Number(params.get('lat')), Number(params.get('lon')));
    camera.position.set(p.x, Number(params.get('alt') ?? 60), p.z);
    camera.rotation.set(THREE.MathUtils.degToRad(Number(params.get('pitch') ?? -8)), -THREE.MathUtils.degToRad(Number(params.get('hdg') ?? 0)), 0, 'YXZ');
  }
  camera.updateMatrixWorld();

  // ---- Sun, shadows, sky, environment.
  const sun = new THREE.DirectionalLight(SUN.color, SUN.intensity);
  sun.castShadow = useShadows;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = 0.4;
  const sc = sun.shadow.camera as THREE.OrthographicCamera;
  sc.near = 1;
  sc.far = 6000;
  if (!useCsm || classic) {
    const s = 900;
    sc.left = -s;
    sc.right = s;
    sc.top = s;
    sc.bottom = -s;
  }
  scene.add(sun, sun.target);
  let csm: CSMShadowNode | null = null;
  if (useShadows && useCsm && !classic) {
    csm = new CSMShadowNode(sun, { cascades: 4, maxFar: 2000, mode: 'practical', lightMargin: 600 });
    csm.fade = true;
    sun.shadow.shadowNode = csm;
  }
  const placeSun = (): void => {
    // Single map: centred ahead of the camera; CSM positions its cascade lights itself from the light direction.
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    const focus = camera.position.clone().addScaledVector(fwd, 700).setY(0);
    sun.target.position.copy(focus);
    sun.position.copy(focus).addScaledVector(SUN.dir, 3000);
    sun.target.updateMatrixWorld();
    sun.updateMatrixWorld();
  };
  placeSun();

  U.timeOfDay.value = timeOfDay;
  // Crude night switch for checking the facade's lit windows (&t=21): the spike has no sun/moon model.
  const night = timeOfDay >= 19.5 || timeOfDay < 5.5 ? 1 : 0;
  U.night.value = night;
  if (night) {
    sun.intensity = 0.04;
    sun.color.setRGB(0.6, 0.7, 1);
    U.horizon.value.setRGB(0.012, 0.016, 0.03);
    U.sunGlow.value.setRGB(0, 0, 0);
  }
  U.sunDir.value.copy(SUN.dir);
  U.keyLightDir.value.copy(SUN.dir);
  U.atmoState.value.x = camera.position.y;

  if (!classic) {
    const sky = new SkyMesh();
    sky.scale.setScalar(45000);
    sky.turbidity.value = 3.2;
    sky.rayleigh.value = 1.4;
    sky.mieCoefficient.value = 0.004;
    sky.mieDirectionalG.value = 0.8;
    sky.sunPosition.value.copy(SUN.dir);
    if (night) {
      sky.sunPosition.value.set(SUN.dir.x, -0.3, SUN.dir.z).normalize();
      renderer.toneMappingExposure = EXPOSURE * 6;
    }
    sky.frustumCulled = false;
    // SkyMesh puts its vertices on the far plane with z = w, which is the NEAR plane under reversedDepthBuffer: drawn
    // last it covers the whole frame. Drawing it first (it writes no depth) works around it.
    sky.renderOrder = -1000;
    scene.add(sky);
    // Environment: PMREM of the sky (the game uses a PMREM of its LUT sky).
    const envScene = new THREE.Scene();
    const envSky = new SkyMesh();
    envSky.scale.setScalar(1000);
    envSky.turbidity.value = 3.2;
    envSky.rayleigh.value = 1.4;
    envSky.sunPosition.value.copy(night ? sky.sunPosition.value : SUN.dir);
    envScene.add(envSky);
    const t = performance.now();
    const pmrem = new THREE.PMREMGenerator(renderer as THREE.WebGPURenderer);
    const rt = await (pmrem as unknown as { fromSceneAsync?: (s: THREE.Scene) => Promise<THREE.RenderTarget> }).fromSceneAsync?.(envScene) ?? pmrem.fromScene(envScene);
    scene.environment = rt.texture;
    scene.environmentIntensity = Number(params.get('env') ?? (night ? 0.004 : 0.12));
    mark('pmremMs', t);
    if (useFog) {
      scene.fogNode = atmosphereFogNode();
    }
  } else {
    const { globalUniforms } = await import('../src/core/uniforms');
    (globalUniforms.uSunDir.value as THREE.Vector3).copy(SUN.dir);
    globalUniforms.uTimeOfDay.value = timeOfDay;
    globalUniforms.uFogDensity.value = 0.00009;
    scene.fog = new THREE.FogExp2(0xffffff, 0.0001);
    scene.background = new THREE.Color(0.45, 0.58, 0.78);
    scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x6b5a45, 1.1));
  }

  // ---- World data (reused game pipeline: geo worker, OSM foundation worker, buildings worker).
  const services = new ServiceRegistry();
  const geoSystem = createGeoSystem();
  let t = performance.now();
  await geoSystem.init?.({ services } as unknown as EngineContext);
  const geo = services.get('geo');
  mark('geoMs', t);
  t = performance.now();
  const data = await loadOsmData(OSM_DATA_URL);
  const { base } = await buildWorkerBase(geo, data, osmExclusionRect(), osmAreaRect()).promise;
  mark('foundationMs', t);
  t = performance.now();
  const worker = new Worker(new URL('../src/world/osm/buildings/buildings.worker.ts', import.meta.url), { type: 'module', name: 'osm-buildings' });
  const request: BuildingsRequest = { base, buildings: data.buildings, pois: poiTriples(data.points), claims: landmarkClaims(geo), infill: { roads: data.roads, areas: data.areas, rails: data.rails } };
  const job = runWorker<BuildingsRequest, BuildingsResult>(worker, request);

  // Textures in parallel with the worker.
  const texT = performance.now();
  const [alb, nrm] = await loadPbrArrays(FACADE_LAYERS, 1024, 8);
  const loader = new THREE.TextureLoader();
  const [roofAlb, roofNrm, roofRough] = await Promise.all([loadTexture(loader, 'roof_tiles', 'albedo', 8), loadTexture(loader, 'roof_tiles', 'normal', 8), loadTexture(loader, 'roof_tiles', 'rough', 8)]);
  mark('texturesMs', texT);
  const res = await job.promise;
  mark('buildingsWorkerMs', t);

  const group = new THREE.Group();
  group.name = 'osm-buildings';
  scene.add(group);
  let facadeMat: THREE.Material;
  let roofMat: THREE.Material;
  let propMat: THREE.Material;
  let groundMat: THREE.Material;
  t = performance.now();
  if (classic) {
    const { createBuildingMaterials } = await import('../src/world/osm/buildings/materials');
    const mats = createBuildingMaterials(renderer as unknown as import('three').WebGLRenderer, []);
    await mats.ready;
    facadeMat = mats.facade;
    roofMat = mats.roof;
    propMat = mats.prop;
    groundMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
  } else {
    const layerNorm = layerLuminance(alb).map((l, i) => (FACADE_LAYERS[i] === 'brick' ? 1 : 0.62 / l));
    facadeMat = createFacadeNodeMaterial({
      albedo: alb,
      normal: nrm,
      layerNorm,
      layerRep: FACADE_LAYERS.map((s) => LAYER_REPEAT[s] ?? REPEAT_M[s]),
      layerNrm: FACADE_LAYERS.map((s) => LAYER_NORMAL[s] ?? 1),
    });
    roofMat = createRoofNodeMaterial({ albedo: roofAlb, normal: roofNrm, rough: roofRough });
    propMat = new THREE.MeshStandardNodeMaterial({ name: 'osm-prop-node', vertexColors: true, roughness: 0.65, metalness: 0.05 });
    groundMat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.95 });
  }
  mark('materialsMs', t);

  t = performance.now();
  // Full detail everywhere (the game's far shell LOD is off in the spike).
  for (const [name, arrays, leaves, mat] of [
    ['osm-facade', res.facade, res.facadeTiles, facadeMat],
    ['osm-roof', res.roof, res.roofTiles, roofMat],
  ] as const) {
    const shell = new LodTiledMesh(group, name, arrays, leaves, mat, { distance: 450, castShadow: true });
    shell.setEnabled(false);
    shell.update(camera.position, 'high');
  }
  const props: InstanceLod[] = [];
  if (useProps) {
    for (const k of Object.keys(PROP_GEOMETRY) as PropKind[]) {
      const records = res.props[k];
      if (records?.length) {
        props.push(new InstanceLod(group, `osm-${k}`, records, PROP_GEOMETRY[k](), propMat, PROP_LOD[k]));
      }
    }
    for (const p of props) {
      p.update(camera.position, 'high');
    }
  }
  if (useGround) {
    scene.add(groundMesh(geo, groundMat));
  }
  // The spike camera sees every layer (instance-lod puts props on RenderLayers.NoReflection).
  camera.layers.enableAll();
  mark('uploadMs', t);
  state.sceneTriangles = countTriangles(group);
  Object.assign(state, { scene, camera, group });

  // ---- Post: scene pass (+ emissive MRT) -> bloom -> AgX (renderer output transform).
  let renderPipeline: THREE.RenderPipeline | null = null;
  if (!classic && usePost) {
    renderPipeline = new THREE.RenderPipeline(renderer as THREE.WebGPURenderer);
    const scenePass = pass(scene, camera);
    scenePass.setMRT(mrt({ output, emissive }));
    const color = scenePass.getTextureNode('output');
    const emis = scenePass.getTextureNode('emissive');
    // Game bloom is a luminance-weighted mip chain; here a thresholded bloom of the whole frame plus the emissive.
    const b = bloom(color.add(emis.mul(uniform(0.5))), 0.06, 0.3, 2.0);
    renderPipeline.outputNode = color.add(b).mul(float(1));
  }

  // ---- Compile, then the loop.
  t = performance.now();
  if (classic) {
    (renderer as import('three').WebGLRenderer).compile(scene, camera);
  } else {
    await (renderer as THREE.WebGPURenderer).compileAsync(scene, camera);
  }
  mark('compileMs', t);
  state.jobs = 0;

  const fpsParam = params.get('fps');
  const automated = navigator.webdriver === true;
  const fpsCap = fpsParam !== null ? Number(fpsParam) : automated ? 24 : 0;
  const minFrameMs = fpsCap > 0 ? 1000 / fpsCap - 1 : 0;
  let last = 0;
  let firstFrameT = -1;
  const gpuSamples: number[] = [];
  const cpuSamples: number[] = [];
  state.cpuMedianMs = (): number => {
    const c = cpuSamples.slice().sort((a, b) => a - b);
    return c.length ? Math.round(c[c.length >> 1] * 100) / 100 : -1;
  };
  /**
   * `advance`: start a new node frame first. The animation loop does it once per callback; pass(), bloom() and other
   * FRAME-updated nodes render only once per node frame, so repeated renders (stress, bench) must advance it.
   */
  const renderFrame = (advance = false): void => {
    if (advance && !classic) {
      (renderer as unknown as { _nodes: { nodeFrame: { update(): void } } })._nodes.nodeFrame.update();
    }
    U.time.value = performance.now() / 1000;
    placeSun();
    if (classic) {
      const r = renderer as import('three').WebGLRenderer;
      r.info.reset();
      r.render(scene, camera);
      state.drawCalls = r.info.render.calls;
      state.triangles = r.info.render.triangles;
      state.programs = r.info.programs?.length ?? 0;
    } else {
      const r = renderer as THREE.WebGPURenderer;
      if (renderPipeline) {
        renderPipeline.render();
      } else {
        r.render(scene, camera);
      }
      state.drawCalls = r.info.render.drawCalls;
      state.triangles = r.info.render.triangles;
      state.programs = (r.info as unknown as { memory?: { programs?: number } }).memory?.programs ?? 0;
      if (state.frame % 10 === 0) {
        void r
          .resolveTimestampsAsync(THREE.TimestampQuery.RENDER)
          .then((ms) => {
            if (typeof ms === 'number' && ms > 0) {
              gpuSamples.push(ms);
              if (gpuSamples.length > 60) gpuSamples.shift();
              const s = gpuSamples.slice().sort((a, b) => a - b);
              state.gpuMs = Math.round(s[Math.floor(s.length / 2)] * 100) / 100;
            }
          })
          .catch(() => undefined);
      }
    }
  };
  renderer.setAnimationLoop((now: number) => {
    if (minFrameMs > 0 && now - last < minFrameMs) {
      return;
    }
    last = now;
    // &stress=N renders the frame N times per animation frame: frame time / N measures past the 60 Hz vsync cap.
    const c0 = performance.now();
    for (let i = 0; i < stress; i++) {
      renderFrame(i > 0);
    }
    cpuSamples.push((performance.now() - c0) / stress);
    if (cpuSamples.length > 240) cpuSamples.shift();
    state.frame++;
    if (firstFrameT < 0) {
      firstFrameT = mark('firstFrameMs');
    }
    if (state.frame === 3) {
      state.ready = true;
      mark('readyMs');
      console.info(`[webgpu-spike] ready ${JSON.stringify({ backend: state.backend, timings, sceneTriangles: state.sceneTriangles, stats: res.stats.facadeTris })}`);
    }
    if (state.frame % 12 === 0) {
      setStatus(`${state.backend}  draws ${state.drawCalls}  tris ${(state.triangles / 1e6).toFixed(2)} M  gpu ${state.gpuMs} ms`);
    }
  });
  // Throughput past the vsync cap: batches of k frames rendered back to back, then a wait until the GPU has finished
  // them (WebGPU: onSubmittedWorkDone; WebGL: a fence). GPU timestamp queries are not usable for this on Apple GPUs
  // (tile-based: both EXT_disjoint_timer_query and WebGPU timestamp-query report 2-8x the real frame time here).
  const gpuSync = async (): Promise<void> => {
    if (state.backend === 'webgpu') {
      await (renderer as unknown as { backend: { device: GPUDevice } }).backend.device.queue.onSubmittedWorkDone();
      return;
    }
    const gl = (classic ? (renderer as import('three').WebGLRenderer).getContext() : (renderer as unknown as { backend: { gl: WebGL2RenderingContext } }).backend.gl) as WebGL2RenderingContext;
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)!;
    gl.flush();
    while (gl.getSyncParameter(sync, gl.SYNC_STATUS) !== gl.SIGNALED) {
      await new Promise((r) => setTimeout(r, 0));
    }
    gl.deleteSync(sync);
  };
  (window as unknown as { __evren: Record<string, unknown> }).__evren.bench = async (batches = 8, k = 20): Promise<unknown> => {
    renderer.setAnimationLoop(null);
    await gpuSync();
    const per: number[] = [];
    for (let b = 0; b < batches; b++) {
      const a = performance.now();
      for (let i = 0; i < k; i++) {
        renderFrame(true);
        state.frame++;
      }
      await gpuSync();
      per.push((performance.now() - a) / k);
    }
    per.sort((x, y) => x - y);
    const r = (x: number): number => Math.round(x * 100) / 100;
    const result = { frames: batches * k, medianMs: r(per[per.length >> 1]), minMs: r(per[0]), maxMs: r(per[per.length - 1]) };
    console.info(`[webgpu-spike] bench ${JSON.stringify(result)}`);
    return result;
  };
  window.addEventListener('resize', () => {
    const ww = window.innerWidth;
    const hh = window.innerHeight;
    renderer.setSize(ww, hh, false);
    camera.aspect = ww / hh;
    camera.updateProjectionMatrix();
    csm?.updateFrustums();
  });
}

main().catch((e: unknown) => {
  state.error = String((e as Error)?.stack ?? e);
  state.jobs = 0;
  state.ready = true;
  console.error('[webgpu-spike] failed', e);
  setStatus(`failed: ${String(e)}`);
});
