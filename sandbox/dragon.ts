/**
 * Dragon model sandbox.
 *   ?pose=flap|glide|dive|hover|walk|fire|idle|bank|tuck|half   &phase=0..6.28   &freeze=1
 *   ?view=side|left|front|top|three-quarter|head|headside|jaw|rider|saddle|saddlezoom|pov|back|chase|under|wing|
 *         shoulder|shouldertop|legs|tail|hero|riderfront|hands|face|mouth|pethand|gazeleft|gazeright|standside
 *         (&look=deg pitches the pov camera)
 *   Rider cues: window.__riderDebug.force({ riderStand: 1, gazeRider: 1, gazeSide: -1, urgePhase: 0.5, ... }) / .clear()
 *   ?sun=azimuthDeg,elevationDeg   ?env=0   ?ground=0   ?fp=1 (first person hide)   ?sky=1&t=hours (real sky + post)
 *   ?alt=m (flight altitude of the rig origin, default 9)
 */
import * as THREE from 'three';
import { startSandbox } from '../src/core/sandbox';
import type { DragonPose, DragonRig, DragonState, System } from '../src/core/contracts';
import { UpdateOrder } from '../src/core/contracts';
import { createDragonModelSystem } from '../src/dragon/model';
import { STANDING_ROOT_HEIGHT } from '../src/dragon/model/constants';
import { SWIM, SWIM_POSE, SWIM_SEA } from '../src/dragon/flight/params';
import { createSkySystem } from '../src/render/sky';
import { createRenderPipeline } from '../src/render/post';
import { SHARED_GLSL } from '../src/render/shaders';
import { registerGlobalUniform } from '../src/core/uniforms';

/** Binds a neutral texture to every shared sampler uniform whose owner system is not part of this sandbox. */
function bindMissingSharedSamplers(): void {
  const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  white.needsUpdate = true;
  for (const m of SHARED_GLSL.matchAll(/uniform\s+sampler2D\s+(\w+)\s*;/g)) {
    registerGlobalUniform(m[1], { value: white });
  }
}

const params = new URLSearchParams(window.location.search);
const poseName = params.get('pose') ?? 'glide';
const viewName = params.get('view') ?? 'three-quarter';
const fixedPhase = params.has('phase') ? Number(params.get('phase')) : undefined;
const useSky = params.get('sky') === '1';

type PoseFn = (t: number) => Partial<DragonPose>;

const POSES: Record<string, PoseFn> = {
  flap: (t) => ({ flapPhase: t * 4.2, flapAmplitude: 1, wingSpread: 1, wingSweep: 0, legsTuck: 1, breath: 0.2 }),
  glide: () => ({ flapAmplitude: 0, wingSpread: 1, wingSweep: 0.05, legsTuck: 1, breath: 0.3 }),
  dive: () => ({ flapAmplitude: 0, wingSpread: 0.55, wingSweep: 1, legsTuck: 1, neckPitch: -0.08, tailPitch: 0.05 }),
  hover: (t) => ({ flapPhase: t * 5.2, flapAmplitude: 1, wingSpread: 1, wingSweep: -0.5, legsTuck: 0.25, tailPitch: -0.25, neckPitch: 0.15, riderLeanPitch: -0.1 }),
  walk: (t) => ({ flapAmplitude: 0, wingSpread: 0, legsTuck: 0, walkPhase: t * 3.2, walkAmount: 1, breath: 0.6 }),
  fire: (t) => ({ flapAmplitude: 0, wingSpread: 1, wingSweep: -0.15, jawOpen: 0.95, neckPitch: -0.12, neckYaw: 0.1 * Math.sin(t), legsTuck: 1 }),
  idle: () => ({ flapAmplitude: 0, wingSpread: 0, legsTuck: 0, walkAmount: 0, breath: 1, neckPitch: 0.1 }),
  tuck: () => ({ flapAmplitude: 0, wingSpread: 0, wingSweep: 0, legsTuck: 1 }),
  half: () => ({ flapAmplitude: 0, wingSpread: 0.5, wingSweep: 0, legsTuck: 1 }),
  // Swimming at the surface: ?stroke= strength (0.22 idle, 0.7 paddle, 1 fast), ?freq= stroke cycle (Hz).
  swim: (t) => {
    // ?surf=1: riding a wave (SWIM_SEA.surf*: the stroke eased off, neck forward, tail up, jaw a little open).
    const surf = Number(params.get('surf') ?? 0);
    const stroke = Number(params.get('stroke') ?? 0.7) * (1 - SWIM_SEA.surfEase * surf);
    const freq = Number(params.get('freq') ?? SWIM_POSE.freqIdle + SWIM_POSE.freqPerSpeed * SWIM.paddleSpeed * Math.min(1, stroke / SWIM_POSE.strokePaddle));
    return {
      swim: 1,
      swimStroke: stroke,
      swimPhase: (t * Math.PI * 2 * freq) % (Math.PI * 2),
      flapAmplitude: 0,
      wingSpread: 0,
      legsTuck: 0,
      neckPitch: SWIM_POSE.neckRaise + SWIM_POSE.neckStroke * stroke + SWIM_SEA.surfNeck * surf,
      neckYaw: Number(params.get('yaw') ?? 0),
      tailPitch: SWIM_POSE.tailPitch + SWIM_SEA.surfTail * surf,
      jawOpen: SWIM_SEA.surfJaw * surf,
      breath: 0.5,
    };
  },
  bank: () => ({ flapAmplitude: 0, wingSpread: 1, wingTwist: 0.8, legsTuck: 1, neckYaw: 0.25, tailYaw: -0.3, riderLeanRoll: 0.3 }),
};

const grounded = poseName === 'walk' || poseName === 'idle';
const rootHeight = grounded ? STANDING_ROOT_HEIGHT : Number(params.get('alt') ?? 9);

interface ViewDef {
  pos: [number, number, number];
  target: [number, number, number];
}
const VIEWS: Record<string, ViewDef> = {
  side: { pos: [26, 1.5, 0.5], target: [0, 0.3, 0.5] },
  left: { pos: [-26, 1.5, 0.5], target: [0, 0.3, 0.5] },
  front: { pos: [0, 2.5, -27], target: [0, 0.4, 0] },
  top: { pos: [0, 32, 0.6], target: [0, 0, 0.6] },
  'three-quarter': { pos: [17, 8, -17], target: [0, 0.2, 0] },
  head: { pos: [2.6, 2.05, -10.2], target: [0, 1.2, -7.4] },
  headside: { pos: [4.2, 1.45, -7.4], target: [0, 1.2, -7.4] },
  rider: { pos: [2.6, 2.5, -0.9], target: [0, 1.55, -2.6] },
  back: { pos: [0, 5.5, 21], target: [0, 1, -2] },
  chase: { pos: [0, 6.5, 30], target: [0, 1.5, -8] },
  under: { pos: [3, -11, 3], target: [0, 0, 0] },
  wing: { pos: [9, 4, 5], target: [6, 1, 0] },
  legs: { pos: [5, -1, 4.5], target: [0, -1, 2.3] },
  tail: { pos: [4, 2.5, 12], target: [0, 0.3, 7] },
  pov: { pos: [0, 0, 0], target: [0, 0, -1] },
  shoulder: { pos: [3.2, -2.2, -2.6], target: [1.6, 0.6, -0.8] },
  saddle: { pos: [1.6, 1.9, -1.4], target: [0.3, 1.0, -2.6] },
  saddlezoom: { pos: [0.95, 1.25, -2.0], target: [0.45, 0.95, -2.45] },
  jaw: { pos: [2.2, 0.55, -6.4], target: [0.3, 0.65, -6.9] },
  hero: { pos: [-9, 3.5, -14], target: [0, 0.8, -2] },
  shouldertop: { pos: [3.0, 3.4, 1.5], target: [1.4, 0.8, -0.8] },
  riderfront: { pos: [1.1, 2.2, -4.5], target: [0, 1.72, -2.72] },
  hands: { pos: [0.55, 1.85, -3.75], target: [0.05, 1.5, -3.1] },
  face: { pos: [0.35, 2.0, -3.45], target: [0, 1.92, -2.75] },
  goggles: { pos: [0.1, 1.97, -3.02], target: [0, 1.94, -2.8] },
  mouth: { pos: [1.3, 0.1, -9.0], target: [0, 0.8, -7.5] },
  // Rider cues (window.__riderDebug.force({...})).
  pethand: { pos: [0.85, 1.75, -2.95], target: [0.15, 1.1, -3.3] },
  gazeleft: { pos: [0.55, 2.45, -1.7], target: [-1.6, 1.7, -4.3] },
  gazeright: { pos: [-0.55, 2.45, -1.7], target: [1.6, 1.7, -4.3] },
  standside: { pos: [2.4, 2.4, -2.2], target: [0, 1.75, -2.6] },
};
const view = VIEWS[viewName] ?? VIEWS['three-quarter'];

const dragonObject = new THREE.Group();
dragonObject.position.set(0, rootHeight, 0);

const velocity = new THREE.Vector3(0, 0, grounded ? 0 : -38);
const fakeState: DragonState = {
  object: dragonObject,
  position: dragonObject.position,
  quaternion: dragonObject.quaternion,
  velocity,
  angularVelocity: new THREE.Vector3(),
  mode: grounded ? 'grounded' : 'flying',
  airspeed: grounded ? 0 : 38,
  altitude: rootHeight,
  agl: rootHeight,
  headingDeg: 0,
  gForce: 1,
  stamina: 1,
  flapEffort: 0,
  firing: poseName === 'fire',
  touchingWater: false,
};

function setupSun(scene: THREE.Scene): void {
  const sunParam = params.get('sun');
  scene.traverse((o) => {
    const light = o as THREE.DirectionalLight;
    if (light.isDirectionalLight) {
      if (sunParam) {
        const [az, el] = sunParam.split(',').map((x) => THREE.MathUtils.degToRad(Number(x)));
        light.position.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).multiplyScalar(400);
        light.position.y += rootHeight;
        light.target.position.set(0, rootHeight, 0);
        light.target.updateMatrixWorld();
      }
      light.shadow.bias = -0.0004;
      light.shadow.normalBias = 0.02;
      light.shadow.camera.far = 1200;
      light.shadow.camera.updateProjectionMatrix();
    }
  });
}

function makeEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const scene = new THREE.Scene();
  const geo = new THREE.SphereGeometry(10, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {},
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `varying vec3 vDir;
void main(){
  vec3 d = normalize(vDir);
  vec3 zen = vec3(0.12, 0.26, 0.6);
  vec3 hor = vec3(0.62, 0.7, 0.8);
  vec3 gnd = vec3(0.16, 0.14, 0.12);
  vec3 c = d.y > 0.0 ? mix(hor, zen, pow(d.y, 0.55)) : mix(hor * 0.7, gnd, pow(-d.y, 0.4));
  gl_FragColor = vec4(c * 1.4, 1.0);
}`,
  });
  scene.add(new THREE.Mesh(geo, mat));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(scene, 0.02);
  pmrem.dispose();
  return rt.texture;
}

let rig: DragonRig | undefined;
let elapsed = 0;

const driver: System = {
  name: 'dragon-sandbox-driver',
  order: UpdateOrder.Physics,
  init(ctx) {
    bindMissingSharedSamplers();
    ctx.scene.add(dragonObject);
    ctx.services.provide('dragon', fakeState);
    if (!useSky) {
      setupSun(ctx.scene);
      if (params.get('env') !== '0') {
        ctx.scene.environment = makeEnvironment(ctx.renderer);
      }
      ctx.scene.environmentIntensity = 0.6;
    }
    if (params.get('ground') !== '0') {
      const ground = new THREE.Mesh(
        new THREE.CircleGeometry(400, 64).rotateX(-Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: 0x6f6a5f, roughness: 0.95 }),
      );
      ground.receiveShadow = true;
      ctx.scene.add(ground);
    }
    if (poseName === 'swim') {
      // The waterline: the floating body sits SWIM.floatDepth under the surface.
      const water = new THREE.Mesh(
        new THREE.CircleGeometry(400, 64).rotateX(-Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: 0x2d5a6e, roughness: 0.15, transparent: true, opacity: 0.72 }),
      );
      water.position.y = rootHeight + SWIM.floatDepth;
      ctx.scene.add(water);
    }
    void ctx.services.when('rig').then((r) => {
      rig = r;
      dragonObject.add(r.root);
      r.setFirstPerson(params.get('fp') === '1' || viewName === 'pov');
      (window as unknown as { __dragon: unknown }).__dragon = { rig: r, object: dragonObject, state: fakeState };
    });
    const cam = ctx.camera;
    cam.fov = viewName === 'pov' ? 70 : 38;
    cam.near = 0.05;
    cam.updateProjectionMatrix();
  },
  update(dt) {
    elapsed += dt;
    const t = fixedPhase !== undefined ? fixedPhase / 4.2 : elapsed;
    const fn = POSES[poseName] ?? POSES.glide;
    const pose = fn(t);
    if (fixedPhase !== undefined && pose.flapPhase !== undefined) {
      pose.flapPhase = fixedPhase;
    }
    if (fixedPhase !== undefined && pose.swimPhase !== undefined) {
      pose.swimPhase = fixedPhase;
    }
    rig?.setPose(pose);
    fakeState.flapEffort = pose.flapAmplitude ?? 0;
  },
};

const povCamera: System = {
  name: 'dragon-sandbox-pov',
  order: UpdateOrder.Camera,
  update(_dt, ctx) {
    if (viewName === 'pov' && rig) {
      rig.riderHead.updateWorldMatrix(true, false);
      rig.riderHead.getWorldPosition(ctx.camera.position);
      rig.riderHead.getWorldQuaternion(ctx.camera.quaternion);
      const look = Number(params.get('look') ?? 0);
      ctx.camera.rotateX(THREE.MathUtils.degToRad(look));
    }
  },
};

const systems: System[] = [];
if (useSky) {
  systems.push(createSkySystem());
}
systems.push(createDragonModelSystem(), driver, povCamera);

void startSandbox({
  systems,
  pipeline: useSky ? createRenderPipeline : undefined,
  orbit: viewName !== 'pov',
  basicLighting: !useSky,
  cameraPosition: new THREE.Vector3(view.pos[0], view.pos[1] + rootHeight, view.pos[2]),
  orbitTarget: new THREE.Vector3(view.target[0], view.target[1] + rootHeight, view.target[2]),
});
