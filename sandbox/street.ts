/**
 * Street sandbox: walks the compiled greybox street tiles (tools/world-compiler, format 0) at eye level.
 *   /sandbox/street.html                              free walk from the first route's start (WASD, Shift, mouse)
 *   ?route=rihtim-carsi | altiyol-sureyya             scripted walk along the walk graph (see src/street/routes.ts)
 *   &speed=1.4                                        walking speed (m/s)
 *   &autostart=0                                      stay at the start until __street.play()
 *   &at=x,z,hdg[,pitch]                               free walk from a local-metre position (compass degrees)
 *   &area=kadikoy &radius=300 &shadows=0 &hud=0 &fov=60 &dpr=1 &fps=N (0 = uncapped; automated browsers default 24)
 * Console / tooling: __street (routes, state, play, pause, setProgress, record, report...), __evren (ready, pending, stats).
 * Run `npm run compile:world -- --area kadikoy` first: tiles are served from public/world/<area>/.
 */
import * as THREE from 'three';
import { fetchJson, SUPPORTED_FORMAT, type StreetIndex, type WalkGraphData } from '../src/street/format';
import { TileStreamer } from '../src/street/tile-streamer';
import { WalkGraph, type WalkPath, type PathSample } from '../src/street/walk-graph';
import { STREET_ROUTES, type StreetRoute } from '../src/street/routes';
import { FirstPersonController } from '../src/street/first-person';
import { FrameRecorder, FrameTimeWindow } from '../src/street/frame-stats';

const params = new URLSearchParams(window.location.search);
const num = (k: string, d: number): number => (params.has(k) && params.get(k) !== '' ? Number(params.get(k)) : d);
const flag = (k: string, d: boolean): boolean => (params.has(k) ? params.get(k) === '1' || params.get(k) === 'true' : d);

const AREA = params.get('area') ?? 'kadikoy';
const BASE_URL = `${import.meta.env.BASE_URL}world/${AREA}/`;
const SPEED = num('speed', 1.4);
/** The gaze follows the chord from LOOK_BEHIND_M behind to LOOK_AHEAD_M ahead, which irons out lane jogs. */
const LOOK_AHEAD_M = 12;
const LOOK_BEHIND_M = 3;
const EYE_PITCH = -0.05;
const SKY = new THREE.Color(0x9ec3e6);
const SUN_AZIMUTH_DEG = num('sunaz', 230);
const SUN_ELEVATION_DEG = num('sunel', 42);
const SHADOW_HALF = 70;
const SHADOW_MAP = 2048;

/* --------------------------------------------------------------------------------------------------------------- */
/* Renderer, scene, daylight                                                                                         */
/* --------------------------------------------------------------------------------------------------------------- */

const container = document.getElementById('app')!;
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', stencil: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, num('dpr', 2)));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.shadowMap.enabled = flag('shadows', true);
renderer.shadowMap.type = THREE.PCFShadowMap;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = SKY;
scene.fog = new THREE.Fog(SKY, 140, num('radius', 300) + 20);

const camera = new THREE.PerspectiveCamera(num('fov', 60), 1, 0.1, 1200);

const hemi = new THREE.HemisphereLight(0xdce8ff, 0x8a7d66, 1.9);
const sun = new THREE.DirectionalLight(0xfff0dc, 2.4);
const sunDir = new THREE.Vector3(
  Math.sin(THREE.MathUtils.degToRad(SUN_AZIMUTH_DEG)) * Math.cos(THREE.MathUtils.degToRad(SUN_ELEVATION_DEG)),
  Math.sin(THREE.MathUtils.degToRad(SUN_ELEVATION_DEG)),
  -Math.cos(THREE.MathUtils.degToRad(SUN_AZIMUTH_DEG)) * Math.cos(THREE.MathUtils.degToRad(SUN_ELEVATION_DEG)),
).normalize();
sun.castShadow = renderer.shadowMap.enabled;
sun.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
sun.shadow.camera.left = -SHADOW_HALF;
sun.shadow.camera.right = SHADOW_HALF;
sun.shadow.camera.top = SHADOW_HALF;
sun.shadow.camera.bottom = -SHADOW_HALF;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 700;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.04;
sun.shadow.camera.updateProjectionMatrix();
scene.add(hemi, sun, sun.target);

/** Sea surface under the quays (the compiler skips water-only tiles). */
const sea = new THREE.Mesh(
  new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ name: 'sea', color: 0x3d6178, roughness: 0.85, metalness: 0 }),
);
sea.receiveShadow = true;
sea.position.set(450, 0, 6100);
scene.add(sea);

/** Keeps the shadow frustum centred on the camera, snapped to shadow texels so edges do not crawl while walking. */
const lightRight = new THREE.Vector3();
const lightUp = new THREE.Vector3();
{
  const back = sunDir.clone().negate();
  lightRight.crossVectors(new THREE.Vector3(0, 1, 0), back).normalize();
  lightUp.crossVectors(back, lightRight).normalize();
}
const focus = new THREE.Vector3();
function placeSun(x: number, y: number, z: number): void {
  const texel = (SHADOW_HALF * 2) / SHADOW_MAP;
  focus.set(x, y, z);
  const r = Math.round(focus.dot(lightRight) / texel) * texel - focus.dot(lightRight);
  const u = Math.round(focus.dot(lightUp) / texel) * texel - focus.dot(lightUp);
  focus.addScaledVector(lightRight, r).addScaledVector(lightUp, u);
  sun.target.position.copy(focus);
  sun.position.copy(focus).addScaledVector(sunDir, 300);
  sun.target.updateMatrixWorld();
  sun.updateMatrixWorld();
}

function resize(): void {
  const w = Math.max(1, container.clientWidth);
  const h = Math.max(1, container.clientHeight);
  renderer.setSize(w, h, false);
  renderer.domElement.style.width = `${w}px`;
  renderer.domElement.style.height = `${h}px`;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(container);
resize();

/* --------------------------------------------------------------------------------------------------------------- */
/* HUD                                                                                                               */
/* --------------------------------------------------------------------------------------------------------------- */

const hudEl = document.createElement('div');
hudEl.className = 'street-hud';
hudEl.style.display = flag('hud', true) ? '' : 'none';
container.appendChild(hudEl);
const attribEl = document.createElement('div');
attribEl.className = 'street-attrib';
attribEl.textContent = 'Harita verisi © OpenStreetMap katkıcıları (ODbL)';
container.appendChild(attribEl);

/* --------------------------------------------------------------------------------------------------------------- */
/* State                                                                                                             */
/* --------------------------------------------------------------------------------------------------------------- */

type Mode = 'route' | 'free';

const walker = new FirstPersonController(renderer.domElement);
walker.walkSpeed = SPEED;
const frameWindow = new FrameTimeWindow(3000);
const recorder = new FrameRecorder();
let streamer: TileStreamer | null = null;
let graph: WalkGraph | null = null;
let route: StreetRoute | null = null;
let path: WalkPath | null = null;
let mode: Mode = 'free';
/** User input after this moment (performance.now) hands the walk over to the player. */
let routeSince = Infinity;
let walked = 0;
let playRequested = flag('autostart', true);
let walking = false;
let frames = 0;
let renderedSinceReady = -1;
let loadError: string | null = null;
let minFrameMs = 0;
let lastFrameAt = performance.now();
let lastDrawCalls = 0;
let lastTriangles = 0;
let lastCpuMs = 0;
let hudTimer = 0;
const sample: PathSample = { x: 0, y: 0, z: 0, dirX: 0, dirZ: -1 };
const ahead: PathSample = { x: 0, y: 0, z: 0, dirX: 0, dirZ: -1 };
const behind: PathSample = { x: 0, y: 0, z: 0, dirX: 0, dirZ: -1 };

function setFpsCap(fps: number): void {
  minFrameMs = fps > 0 ? 1000 / fps - 1 : 0;
}
{
  const fpsParam = params.get('fps');
  const automated = navigator.webdriver === true;
  const cap = fpsParam !== null ? Number(fpsParam) : automated ? 24 : 0;
  setFpsCap(cap);
  if (automated && cap > 0) {
    console.info(`[street] automated browser: frame rate capped at ${cap} fps (add ?fps=0 to measure performance)`);
  }
}

function headingOf(dx: number, dz: number): number {
  return Math.atan2(dx, -dz);
}

function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

function groundAt(x: number, z: number, maxY: number): number | null {
  return streamer ? streamer.groundHeight(x, z, maxY) : null;
}

/** Gaze heading at distance `s` along the route (compass radians), or null where the path does not move. */
function routeHeading(s: number): number | null {
  if (!path) {
    return null;
  }
  path.sample(s - LOOK_BEHIND_M, behind);
  path.sample(s + LOOK_AHEAD_M, ahead);
  const dx = ahead.x - behind.x;
  const dz = ahead.z - behind.z;
  return Math.hypot(dx, dz) > 0.05 ? headingOf(dx, dz) : null;
}

/** Puts the walker at distance `s` along the route, facing along it. */
function placeOnRoute(s: number): void {
  if (!path) {
    return;
  }
  walked = Math.min(Math.max(s, 0), path.length);
  path.sample(walked, sample);
  walker.x = sample.x;
  walker.z = sample.z;
  walker.snapGround(groundAt(sample.x, sample.z, sample.y + 0.6) ?? sample.y);
  walker.heading = routeHeading(walked) ?? headingOf(sample.dirX, sample.dirZ);
  walker.pitch = EYE_PITCH;
  walker.apply(camera);
}

function updateRoute(dt: number): void {
  if (!path) {
    return;
  }
  if (walking) {
    walked = Math.min(walked + SPEED * dt, path.length);
  }
  path.sample(walked, sample);
  walker.x = sample.x;
  walker.z = sample.z;
  walker.followGround(dt, groundAt, sample.y);
  const target = routeHeading(walked);
  if (target !== null) {
    const k = 1 - Math.exp(-dt / 0.45);
    walker.heading = wrapAngle(walker.heading + wrapAngle(target - walker.heading) * k);
  }
  walker.pitch += (EYE_PITCH - walker.pitch) * (1 - Math.exp(-dt / 0.6));
}

/* --------------------------------------------------------------------------------------------------------------- */
/* Frame loop                                                                                                        */
/* --------------------------------------------------------------------------------------------------------------- */

function frame(now: number): void {
  if (minFrameMs > 0 && now - lastFrameAt < minFrameMs) {
    return;
  }
  const frameMs = now - lastFrameAt;
  lastFrameAt = now;
  const dt = Math.min(frameMs / 1000, 0.1);
  const t0 = performance.now();

  if (mode === 'route' && walker.lastInputAt > routeSince) {
    mode = 'free';
    walking = false;
  }
  if (mode === 'route') {
    if (playRequested && !walking && streamer && streamer.pending() === 0) {
      walking = true;
    }
    updateRoute(dt);
  } else {
    walker.update(dt, groundAt);
  }
  walker.apply(camera);
  streamer?.update(camera.position.x, camera.position.z);
  placeSun(camera.position.x, walker.groundY, camera.position.z);

  renderer.render(scene, camera);
  lastDrawCalls = renderer.info.render.calls;
  lastTriangles = renderer.info.render.triangles;
  lastCpuMs = performance.now() - t0;
  frames++;
  if (renderedSinceReady >= 0) {
    renderedSinceReady++;
  }
  if (frames > 1) {
    frameWindow.push(now, frameMs);
    const st = streamer?.stats();
    recorder.push({
      t: now,
      frameMs,
      cpuMs: lastCpuMs,
      drawCalls: lastDrawCalls,
      triangles: lastTriangles,
      tilesLive: st?.tilesLive ?? 0,
      added: st?.addedLastUpdate ?? 0,
      s: mode === 'route' ? walked : -1,
    });
  }
  hudTimer -= frameMs;
  if (hudTimer <= 0) {
    hudTimer = 250;
    drawHud();
  }
}

function drawHud(): void {
  if (hudEl.style.display === 'none') {
    return;
  }
  if (loadError) {
    hudEl.textContent = `street sandbox: ${loadError}`;
    return;
  }
  const f = frameWindow.summary();
  const st = streamer?.stats();
  const head = ((THREE.MathUtils.radToDeg(walker.heading) % 360) + 360) % 360;
  const where =
    mode === 'route' && path && route
      ? `route  ${route.label}  ${walked.toFixed(0)} / ${path.length.toFixed(0)} m  @ ${SPEED} m/s${walking ? '' : playRequested ? '  (waiting for tiles)' : '  (paused)'}`
      : 'free   WASD / arrows, Shift = run, mouse = look (click to lock)';
  hudEl.textContent = [
    `Kadıköy street layer · greybox format 0`,
    where,
    `pos    x ${walker.x.toFixed(1)}  z ${walker.z.toFixed(1)}  ground ${walker.groundY.toFixed(2)} m  eye ${walker.eyeHeight} m  hdg ${head.toFixed(0)}°`,
    `frame  median ${f.medianMs.toFixed(1)} ms  p99 ${f.p99Ms.toFixed(1)} ms  max ${f.maxMs.toFixed(1)} ms  (${f.medianMs > 0 ? (1000 / f.medianMs).toFixed(0) : '-'} fps, last 3 s)`,
    `cpu    ${lastCpuMs.toFixed(2)} ms   draw ${lastDrawCalls} calls  ${(lastTriangles / 1000).toFixed(0)}k tris`,
    st
      ? `tiles  ${st.tilesLive} live  ${st.tilesLoading} loading  ${st.tilesQueued} queued  ${(st.trianglesLive / 1e6).toFixed(2)} M tris  ${(st.bytesLive / 1048576).toFixed(1)} MB  load ${st.loadMsMedian} ms med`
      : 'tiles  loading index...',
  ].join('\n');
}

/* --------------------------------------------------------------------------------------------------------------- */
/* Boot                                                                                                              */
/* --------------------------------------------------------------------------------------------------------------- */

async function boot(): Promise<void> {
  let index: StreetIndex;
  let walkData: WalkGraphData;
  try {
    index = await fetchJson<StreetIndex>(`${BASE_URL}index.json`);
    if (index.format !== SUPPORTED_FORMAT) {
      throw new Error(`format ${index.format} is not supported (expected ${SUPPORTED_FORMAT})`);
    }
    walkData = await fetchJson<WalkGraphData>(`${BASE_URL}${index.walkGraph.file}`);
  } catch (err) {
    loadError = `no compiled tiles at ${BASE_URL} (${String((err as Error).message ?? err)}). Run: npm run compile:world -- --area ${AREA}`;
    console.error(`[street] ${loadError}`);
    drawHud();
    return;
  }
  graph = new WalkGraph(walkData);
  console.info(
    `[street] ${index.area}: ${index.tiles.length} tiles, walk graph ${graph.count} vertices, ${graph.rawComponents} fragments, ${graph.stitchedEdges} gap edges, main component ${graph.mainSize}`,
  );
  streamer = new TileStreamer({
    baseUrl: BASE_URL,
    index,
    radius: num('radius', 300),
    shadows: renderer.shadowMap.enabled,
    compile: (o) => renderer.compileAsync(o, camera, scene),
  });
  scene.add(streamer.root);

  const routeId = params.get('route');
  const at = params.get('at');
  if (routeId && !STREET_ROUTES[routeId]) {
    console.error(`[street] unknown route "${routeId}" (known: ${Object.keys(STREET_ROUTES).join(', ')})`);
  }
  route = STREET_ROUTES[routeId ?? ''] ?? STREET_ROUTES['rihtim-carsi'];
  path = graph.route(route.waypoints);
  if (routeId && STREET_ROUTES[routeId] && !at) {
    mode = 'route';
    routeSince = performance.now();
    placeOnRoute(0);
  } else if (at) {
    const [x, z, hdg, pitch] = at.split(',').map(Number);
    mode = 'free';
    walker.x = x;
    walker.z = z;
    walker.heading = THREE.MathUtils.degToRad(hdg || 0);
    walker.pitch = THREE.MathUtils.degToRad(pitch || 0);
    walker.snapGround(graph.vertices[graph.nearestAny(x, z) * 3 + 1]);
  } else {
    mode = 'free';
    placeOnRoute(0);
  }
  renderedSinceReady = 0;
}

/** First ground contact after tiles arrive (the walker starts at the walk-graph height). */
function settleGround(): void {
  const g = groundAt(walker.x, walker.z, Infinity);
  if (g !== null) {
    walker.snapGround(g);
  }
}

/* --------------------------------------------------------------------------------------------------------------- */
/* Tooling APIs                                                                                                      */
/* --------------------------------------------------------------------------------------------------------------- */

const streetApi = {
  THREE,
  scene,
  camera,
  renderer,
  routes: () => Object.keys(STREET_ROUTES),
  route: () =>
    route && path
      ? { id: route.id, label: route.label, lengthM: +path.length.toFixed(1), offGraphM: +path.offGraph.toFixed(1), marks: path.marks.map((m) => ({ ...m, s: +m.s.toFixed(1) })) }
      : null,
  graph: () => (graph ? { vertices: graph.count, fragments: graph.rawComponents, gapEdges: graph.stitchedEdges, mainComponent: graph.mainSize } : null),
  state: () => ({
    mode,
    walkedM: +walked.toFixed(2),
    lengthM: path ? +path.length.toFixed(1) : 0,
    done: !!path && walked >= path.length - 1e-6,
    walking,
    x: +walker.x.toFixed(2),
    z: +walker.z.toFixed(2),
    groundY: +walker.groundY.toFixed(3),
    eyeY: +(walker.groundY + walker.eyeHeight).toFixed(3),
    headingDeg: +((((THREE.MathUtils.radToDeg(walker.heading) % 360) + 360) % 360).toFixed(1)),
  }),
  play: () => {
    if (path) {
      mode = 'route';
      routeSince = performance.now();
      playRequested = true;
    }
  },
  pause: () => {
    playRequested = false;
    walking = false;
  },
  /** Jumps to a fraction [0, 1] of the route (paused), facing along it. */
  setProgress: (f: number) => {
    if (!path) {
      return;
    }
    mode = 'route';
    routeSince = performance.now();
    playRequested = false;
    walking = false;
    placeOnRoute(f * path.length);
  },
  /** Free walk at a position (compass degrees). */
  teleport: (x: number, z: number, headingDeg = 0, pitchDeg = 0) => {
    mode = 'free';
    walking = false;
    walker.x = x;
    walker.z = z;
    walker.heading = THREE.MathUtils.degToRad(headingDeg);
    walker.pitch = THREE.MathUtils.degToRad(pitchDeg);
    if (graph) {
      walker.snapGround(graph.vertices[graph.nearestAny(x, z) * 3 + 1]);
    }
    settleGround();
  },
  settleGround,
  setFpsCap,
  hud: (on: boolean) => {
    hudEl.style.display = on ? '' : 'none';
  },
  streamer: () => streamer?.stats() ?? null,
  frameWindow: () => frameWindow.summary(),
  record: {
    start: () => recorder.start(),
    stop: () => recorder.stop(),
    report: () => recorder.report(50),
  },
};
(window as unknown as { __street: typeof streetApi }).__street = streetApi;

const evrenApi = {
  THREE,
  get ready() {
    return renderedSinceReady >= 3;
  },
  /** Rendered frame counter (snap.mjs measures frame times from it). */
  get frame() {
    return frames;
  },
  pending: () => (loadError ? 0 : streamer ? streamer.pending() : 1),
  stats: () => {
    const f = frameWindow.summary();
    const st = streamer?.stats();
    const info = renderer.info;
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    return {
      fps: f.medianMs > 0 ? Math.round(10000 / f.medianMs) / 10 : 0,
      frameMs: Math.round(f.medianMs * 100) / 100,
      cpuMs: Math.round(lastCpuMs * 100) / 100,
      drawCalls: lastDrawCalls,
      triangles: lastTriangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs?.length ?? 0,
      pending: streamer ? streamer.pending() : 1,
      heapMB: mem ? Math.round(mem.usedJSHeapSize / 1048576) : 0,
      mode,
      walkedM: Math.round(walked * 10) / 10,
      tilesLive: st?.tilesLive ?? 0,
      tilesLoading: st?.tilesLoading ?? 0,
      trianglesLive: st?.trianglesLive ?? 0,
      bytesLiveMB: st ? Math.round((st.bytesLive / 1048576) * 10) / 10 : 0,
      tileLoadMsMedian: st?.loadMsMedian ?? 0,
    };
  },
};
(window as unknown as { __evren: typeof evrenApi }).__evren = evrenApi;

let groundSettled = false;
renderer.setAnimationLoop((now) => {
  frame(now);
  if (!groundSettled && streamer && groundAt(walker.x, walker.z, Infinity) !== null) {
    settleGround();
    groundSettled = true;
  }
});
void boot();
