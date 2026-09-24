/**
 * Street sandbox: walks the compiled street tiles (tools/world-compiler, format 0 or 1) at eye level.
 *   /sandbox/street.html                              free walk from the first route's start (WASD, Shift, mouse)
 *   ?route=rihtim-carsi | altiyol-sureyya             scripted walk along the walk graph (see src/street/routes.ts)
 *   &speed=1.4                                        walking speed (m/s)
 *   &autostart=0                                      stay at the start until __street.play()
 *   &at=x,z,hdg[,pitch]                               free walk from a local-metre position (compass degrees)
 *   &t=day | dusk | night                             time of day (format 1: manifest lights and emissive materials)
 *   &q=low | medium | high                            preview quality (src/street/quality.ts; default medium)
 *   &area=kadikoy &radius=300 &shadows=0 &hud=0 &fov=60 &dpr=1 &fps=N (0 = uncapped; automated browsers default 24)
 *   &points=N &spots=N                                light pool size (default: the quality's)
 * Keys: WASD / arrows walk, Shift runs, mouse looks; Q cycles the quality, T cycles day / dusk / night.
 * Format 1 tiles switch LODs by the index's distance bands and bring prop instances and light lists. Props are drawn
 * as a few BatchedMeshes with per-instance LODs and distance culling (src/street/props.ts); the lit manifest lights
 * nearest the view drive a small pool of point and spot lights at dusk and night, the others glow
 * (src/street/lighting.ts); the sun's shadow map covers a tight box ahead of the camera and is only re-rendered when
 * the box moves or tiles change. Preview quality: WebGL2, standard materials.
 * Console / tooling: __street (routes, state, play, pause, setProgress, time, lights, record, report...),
 * __evren (ready, pending, stats).
 * Run `npm run compile:world -- --area kadikoy` first: tiles are served from public/world/<area>/.
 */
import * as THREE from 'three';
import { fetchJson, SUPPORTED_FORMATS, type StreetIndex, type WalkGraphData } from '../src/street/format';
import { applyEmissive, LightGlows, LightPool, parseTimeOfDay, PRESETS, type TimeOfDay } from '../src/street/lighting';
import { nextQuality, parseQuality, type Quality, QUALITY_PRESETS, type QualityPreset } from '../src/street/quality';
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
let timeOfDay: TimeOfDay = parseTimeOfDay(params.get('t'));
let quality: Quality = parseQuality(params.get('q'));
let qp: QualityPreset = QUALITY_PRESETS[quality];
const SHADOWS_ALLOWED = flag('shadows', true);
const SKY = new THREE.Color(PRESETS[timeOfDay].sky);
const SUN_AZIMUTH_DEG = num('sunaz', PRESETS[timeOfDay].sunAzimuthDeg);
const SUN_ELEVATION_DEG = num('sunel', PRESETS[timeOfDay].sunElevationDeg);
let shadowHalf = qp.shadowHalf;
let shadowMapSize = qp.shadowMap;

/* --------------------------------------------------------------------------------------------------------------- */
/* Renderer, scene, daylight                                                                                         */
/* --------------------------------------------------------------------------------------------------------------- */

const container = document.getElementById('app')!;
const renderer = new THREE.WebGLRenderer({ antialias: flag('aa', qp.antialias), powerPreference: 'high-performance', stencil: false });
const BASE_PIXEL_RATIO = Math.min(window.devicePixelRatio || 1, num('dpr', 2));
renderer.setPixelRatio(BASE_PIXEL_RATIO * qp.renderScale);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.shadowMap.enabled = SHADOWS_ALLOWED && qp.shadowMap > 0;
renderer.shadowMap.type = THREE.PCFShadowMap;
/** The scene is static: the shadow map is re-rendered only when its box moves or content changes (updateShadow). */
renderer.shadowMap.autoUpdate = false;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = SKY;
let radius = num('radius', qp.radius);
scene.fog = new THREE.Fog(SKY, 140, radius + 20);

const camera = new THREE.PerspectiveCamera(num('fov', 60), 1, 0.1, 1200);

const hemi = new THREE.HemisphereLight(0xdce8ff, 0x8a7d66, 1.9);
const sun = new THREE.DirectionalLight(0xfff0dc, 2.4);
const sunDir = new THREE.Vector3();
function setSunDirection(azimuthDeg: number, elevationDeg: number): void {
  const az = THREE.MathUtils.degToRad(azimuthDeg);
  const el = THREE.MathUtils.degToRad(elevationDeg);
  sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
}
setSunDirection(SUN_AZIMUTH_DEG, SUN_ELEVATION_DEG);
sun.castShadow = renderer.shadowMap.enabled;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.04;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 700;
function configureShadow(): void {
  sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);
  sun.shadow.camera.left = -shadowHalf;
  sun.shadow.camera.right = shadowHalf;
  sun.shadow.camera.top = shadowHalf;
  sun.shadow.camera.bottom = -shadowHalf;
  sun.shadow.camera.updateProjectionMatrix();
}
configureShadow();
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
function updateLightBasis(): void {
  const back = sunDir.clone().negate();
  lightRight.crossVectors(new THREE.Vector3(0, 1, 0), back).normalize();
  lightUp.crossVectors(back, lightRight).normalize();
}
updateLightBasis();

/** Manifest lights (format 1) drive a small pool of point and spot lights, the rest glow; emissive materials follow the time of day. */
const lightPool = new LightPool(num('points', qp.pointLights), num('spots', qp.spotLights));
const glows = new LightGlows();
scene.add(lightPool.group, glows.points);
let emissiveCount = -1;

function applyTimeOfDay(t: TimeOfDay): void {
  timeOfDay = t;
  const p = PRESETS[t];
  SKY.setHex(p.sky);
  scene.background = SKY;
  (scene.fog as THREE.Fog).color.copy(SKY);
  (scene.fog as THREE.Fog).near = p.fogNear;
  hemi.color.setHex(p.hemiSky);
  hemi.groundColor.setHex(p.hemiGround);
  hemi.intensity = p.hemiIntensity;
  sun.color.setHex(p.sunColor);
  sun.intensity = p.sunIntensity;
  setSunDirection(params.has('sunaz') ? num('sunaz', p.sunAzimuthDeg) : p.sunAzimuthDeg, params.has('sunel') ? num('sunel', p.sunElevationDeg) : p.sunElevationDeg);
  updateLightBasis();
  emissiveCount = -1;
  shadowDirty = true;
}

/** Applies a quality preset live (antialiasing is fixed at start: reload with ?q= to change it). */
function applyQuality(q: Quality): void {
  quality = q;
  qp = QUALITY_PRESETS[q];
  renderer.setPixelRatio(BASE_PIXEL_RATIO * qp.renderScale);
  resize();
  const shadowsOn = SHADOWS_ALLOWED && qp.shadowMap > 0;
  renderer.shadowMap.enabled = shadowsOn;
  sun.castShadow = shadowsOn;
  if (shadowMapSize !== qp.shadowMap || shadowHalf !== qp.shadowHalf) {
    shadowMapSize = qp.shadowMap;
    shadowHalf = qp.shadowHalf;
    sun.shadow.map?.dispose();
    sun.shadow.map = null;
    configureShadow();
  }
  radius = params.has('radius') ? num('radius', qp.radius) : qp.radius;
  (scene.fog as THREE.Fog).far = radius + 20;
  streamer?.setRadius(radius);
  streamer?.props?.setDistances(propDistances());
  streamer?.props?.setShadows(shadowsOn);
  lightPool.resize(params.has('points') ? num('points', qp.pointLights) : qp.pointLights, params.has('spots') ? num('spots', qp.spotLights) : qp.spotLights);
  shadowDirty = true;
}

function propDistances(): { distanceScale: number; personDistance: number; smallPropDistance: number; lodBias: number } {
  return { distanceScale: qp.propDistanceScale, personDistance: qp.personDistance, smallPropDistance: qp.smallPropDistance, lodBias: qp.lodBias };
}
const focus = new THREE.Vector3();
const shadowAt = new THREE.Vector3(NaN, NaN, NaN);
const viewDir = new THREE.Vector3();
let shadowDirty = true;
let shadowVersion = '';
let shadowUpdates = 0;

/**
 * The shadow box sits half a box ahead of the camera. The map is re-rendered only when that point moved a fifth of
 * the box, when tiles or props came or went, or when the sun changed; otherwise the previous map is reused.
 */
function updateShadow(): void {
  if (!renderer.shadowMap.enabled) {
    if (shadowDirty) {
      shadowDirty = false;
      placeSun(camera.position.x, walker.groundY, camera.position.z);
    }
    return;
  }
  camera.getWorldDirection(viewDir);
  viewDir.y = 0;
  if (viewDir.lengthSq() < 1e-6) {
    viewDir.set(0, 0, -1);
  }
  viewDir.normalize();
  const x = camera.position.x + viewDir.x * shadowHalf * 0.5;
  const z = camera.position.z + viewDir.z * shadowHalf * 0.5;
  const version = `${streamer?.version ?? 0}/${streamer?.props?.version ?? 0}`;
  if (!shadowDirty && version === shadowVersion && Math.hypot(x - shadowAt.x, z - shadowAt.z) < shadowHalf * 0.2) {
    return;
  }
  shadowDirty = false;
  shadowVersion = version;
  shadowAt.set(x, walker.groundY, z);
  placeSun(x, walker.groundY, z);
  renderer.shadowMap.needsUpdate = true;
  shadowUpdates++;
}

function placeSun(x: number, y: number, z: number): void {
  const texel = (shadowHalf * 2) / shadowMapSize;
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
/** `?eye=<m>`: camera height above the ground (default 1.7 m); raise it for oblique inspection views. */
walker.eyeHeight = num('eye', walker.eyeHeight);
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
let lightTimer = 0;
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
  camera.updateMatrixWorld();
  streamer?.update(camera.position.x, camera.position.z);
  updateShadow();
  if (streamer) {
    lightPool.update(streamer.liveLights(), camera, PRESETS[timeOfDay], frameMs);
  }
  lightTimer -= frameMs;
  if (streamer && lightTimer <= 0) {
    lightTimer = 250;
    glows.update(streamer.liveLights(), PRESETS[timeOfDay]);
    const em = streamer.emissiveMaterials();
    if (em.size !== emissiveCount) {
      emissiveCount = em.size;
      applyEmissive(em, PRESETS[timeOfDay]);
    }
  }

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
  const pr = st?.props;
  const lodLine =
    st && streamer && streamer.format >= 1
      ? `lod    tiles ${Object.entries(st.lodLive).map(([k, v]) => `LOD${k} ${v}`).join('  ')}   props ${pr ? `${pr.visible}/${pr.placed} drawn (${pr.levels.map((n, k) => `L${k} ${n}`).join(' ')})  ${pr.batches} batches${pr.waiting ? `  ${pr.waiting} waiting for their prop` : ''}` : '-'}`
      : null;
  const lightLine =
    st && streamer && streamer.format >= 1
      ? `lights ${lightPool.group.visible ? `${lightPool.assigned}/${lightPool.capacity} real (${lightPool.candidates} in view)  ${glows.count} glows` : 'off (day)'}   shadow ${renderer.shadowMap.enabled ? `${shadowMapSize}px ±${shadowHalf} m, ${shadowUpdates} renders` : 'off'}${st.retrying ? `   ${st.retrying} retrying` : ''}`
      : null;
  hudEl.textContent = [
    `Kadıköy street layer · format ${streamer?.format ?? '?'} · ${timeOfDay} · quality ${quality} (Q)  scale ${qp.renderScale}  radius ${radius} m`,
    where,
    `pos    x ${walker.x.toFixed(1)}  z ${walker.z.toFixed(1)}  ground ${walker.groundY.toFixed(2)} m  eye ${walker.eyeHeight} m  hdg ${head.toFixed(0)}°`,
    `frame  median ${f.medianMs.toFixed(1)} ms  p99 ${f.p99Ms.toFixed(1)} ms  max ${f.maxMs.toFixed(1)} ms  (${f.medianMs > 0 ? (1000 / f.medianMs).toFixed(0) : '-'} fps, last 3 s)`,
    `cpu    ${lastCpuMs.toFixed(2)} ms   draw ${lastDrawCalls} calls  ${(lastTriangles / 1000).toFixed(0)}k tris`,
    st
      ? `tiles  ${st.tilesLive} live  ${st.tilesLoading} loading  ${st.tilesQueued} queued  ${(st.trianglesLive / 1e6).toFixed(2)} M tris  ${(st.bytesLive / 1048576).toFixed(1)} MB  load ${st.loadMsMedian} ms med`
      : 'tiles  loading index...',
    ...(lodLine ? [lodLine] : []),
    ...(lightLine ? [lightLine] : []),
  ].join('\n');
}

/* --------------------------------------------------------------------------------------------------------------- */
/* Boot                                                                                                              */
/* --------------------------------------------------------------------------------------------------------------- */

async function boot(): Promise<void> {
  let index: StreetIndex;
  let walkData: WalkGraphData;
  // A recompile deletes and rewrites the area folder: keep retrying until index and walk graph read back whole.
  for (let attempt = 1; ; attempt++) {
    try {
      index = await fetchJson<StreetIndex>(`${BASE_URL}index.json`);
      if (!SUPPORTED_FORMATS.includes(index.format)) {
        loadError = `format ${index.format} is not supported (expected ${SUPPORTED_FORMATS.join(' or ')})`;
        console.error(`[street] ${loadError}`);
        drawHud();
        return;
      }
      walkData = await fetchJson<WalkGraphData>(`${BASE_URL}${index.walkGraph.file}`);
      loadError = null;
      break;
    } catch (err) {
      loadError = `no compiled tiles at ${BASE_URL} yet (${String((err as Error).message ?? err).slice(0, 80)}); retrying (attempt ${attempt}). Run: npm run compile:world -- --area ${AREA}`;
      if (attempt === 1 || attempt % 10 === 0) {
        console.warn(`[street] ${loadError}`);
      }
      drawHud();
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  graph = new WalkGraph(walkData);
  console.info(
    `[street] ${index.area}: ${index.tiles.length} tiles, walk graph ${graph.count} vertices, ${graph.rawComponents} fragments, ${graph.stitchedEdges} gap edges, main component ${graph.mainSize}`,
  );
  streamer = new TileStreamer({
    baseUrl: BASE_URL,
    index,
    radius,
    propDistances: propDistances(),
    shadows: SHADOWS_ALLOWED,
    anisotropy: Math.min(8, renderer.capabilities.getMaxAnisotropy()),
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
  /** Switches the time of day ('day' | 'dusk' | 'night'). */
  time: (t: TimeOfDay) => {
    applyTimeOfDay(parseTimeOfDay(t));
    lightTimer = 0;
  },
  /** Switches the preview quality ('low' | 'medium' | 'high'); antialiasing stays as started. */
  quality: (q?: Quality) => {
    if (q) {
      applyQuality(parseQuality(q));
    }
    return { quality, ...qp, radius, shadowUpdates };
  },
  /** Light pool and manifest light counts. */
  lights: () => ({ time: timeOfDay, assigned: lightPool.assigned, capacity: lightPool.capacity, candidates: lightPool.candidates, glows: glows.count, live: streamer?.liveLights().length ?? 0, emissiveMaterials: streamer?.emissiveMaterials().size ?? 0 }),
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
      format: streamer?.format ?? -1,
      time: timeOfDay,
      lodLive: st?.lodLive ?? {},
      instancesLive: st?.instancesLive ?? 0,
      lightsAssigned: lightPool.assigned,
      lightsLive: st?.lightsLive ?? 0,
      quality,
      renderScale: qp.renderScale,
      propsVisible: st?.props?.visible ?? 0,
      propsPlaced: st?.props?.placed ?? 0,
      propBatches: st?.props?.batches ?? 0,
      shadowUpdates,
      retrying: st?.retrying ?? 0,
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
/** Q cycles the quality, T the time of day (movement keys belong to the walker). */
window.addEventListener('keydown', (e) => {
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) {
    return;
  }
  if (e.code === 'KeyQ') {
    applyQuality(nextQuality(quality));
    drawHud();
  } else if (e.code === 'KeyT') {
    applyTimeOfDay(timeOfDay === 'day' ? 'dusk' : timeOfDay === 'dusk' ? 'night' : 'day');
    lightTimer = 0;
    drawHud();
  }
});

applyTimeOfDay(timeOfDay);
void boot();
