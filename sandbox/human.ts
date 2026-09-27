/**
 * Human character test bench: the character built by tools/humans/ on flat ground.
 *   ?url=<glb> (default /.scratch/rider.glb)
 *   ?clip=<name> plays one clip in a loop (&rate=1), &t=<s> holds it at that time
 *   ?terrain=1 (rolling ground)   ?view=side|front|back|q|close|feet|top   ?sky=1&t=hours (real sky + post)   ?wind=m/s (air past the body, from the front)
 *   Without ?clip: the locomotion controller (keyboard: WASD relative to the camera, Shift run, C crouch, Space jump;
 *   G held in the air: glide; drag to orbit, wheel to zoom), or a scripted input
 *   ?script=walk|run|runstop|jump|runjump|crouch|circle|turn|glide (glide: with ?alt=m; anything else stands, and
 *   idles) with
 *   &at=<s> to hold the simulation at that time (deterministic screenshots of transitions).
 *   ?look=<JSON RiderLook fields>  ?palette=akinci|sipahi|deli|yeniceri
 * window.__human = { model, controller, look(fields) }.
 */
import * as THREE from 'three';
import { startSandbox } from '../src/core/sandbox';
import type { System } from '../src/core/contracts';
import { UpdateOrder } from '../src/core/contracts';
import { createSkySystem } from '../src/render/sky';
import { createRenderPipeline } from '../src/render/post';
import { SHARED_GLSL } from '../src/render/shaders';
import { registerGlobalUniform } from '../src/core/uniforms';
import { loadHumanModel, type HumanRider } from '../src/dragon/model/rider/human';
import { LocomotionController, type LocomotionInput } from '../src/dragon/model/rider/locomotion/controller';
import { DEFAULT_LOOK, PALETTES, applyLook, type RiderLook } from '../src/dragon/model/rider/look';

const params = new URLSearchParams(window.location.search);
const url = params.get('url') ?? '/.scratch/rider.glb';
const clipName = params.get('clip');
const fixedT = params.has('t') && clipName ? Number(params.get('t')) : undefined;
const rate = Number(params.get('rate') ?? 1);
const useSky = params.get('sky') === '1';
const windSpeed = Number(params.get('wind') ?? 0);
const script = params.get('script');
const holdAt = params.has('at') ? Number(params.get('at')) : undefined;
const play = !clipName;
/** ?terrain=1: rolling ground (feet on uneven ground). */
const terrain = params.get('terrain') === '1';
const groundAt = (x: number, z: number): number => (terrain ? 0.22 * Math.sin(x * 0.9) * Math.cos(z * 0.7) + 0.12 * Math.sin(z * 1.7 + x * 0.3) : 0);

function bindMissingSharedSamplers(): void {
  const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  white.needsUpdate = true;
  for (const m of SHARED_GLSL.matchAll(/uniform\s+sampler2D\s+(\w+)\s*;/g)) {
    registerGlobalUniform(m[1], { value: white });
  }
}

interface ViewDef {
  pos: [number, number, number];
  target: [number, number, number];
}
// The character faces +Z.
const VIEWS: Record<string, ViewDef> = {
  side: { pos: [4.2, 1.0, 0], target: [0, 0.9, 0] },
  front: { pos: [0, 1.1, 4.2], target: [0, 0.9, 0] },
  back: { pos: [0, 1.3, -4.2], target: [0, 0.9, 0] },
  q: { pos: [2.2, 1.55, 2.6], target: [0, 1.0, 0] },
  close: { pos: [0.35, 1.72, 0.85], target: [0, 1.66, 0] },
  feet: { pos: [1.6, 0.35, 0.6], target: [0, 0.15, 0] },
  top: { pos: [0.01, 5, 0], target: [0, 0, 0] },
};
const view = VIEWS[params.get('view') ?? 'q'] ?? VIEWS.q;

function makeEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const scene = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `varying vec3 vDir;
void main(){
  vec3 d = normalize(vDir);
  vec3 c = d.y > 0.0 ? mix(vec3(0.62, 0.7, 0.8), vec3(0.12, 0.26, 0.6), pow(d.y, 0.55)) : mix(vec3(0.43, 0.49, 0.56), vec3(0.16, 0.14, 0.12), pow(-d.y, 0.4));
  gl_FragColor = vec4(c * 1.4, 1.0);
}`,
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), mat));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(scene, 0.02);
  pmrem.dispose();
  return rt.texture;
}

/** Ground with a 0.5 m checker, so sliding feet show. */
function makeGround(): THREE.Mesh {
  const size = 256;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const c = ((x >> 5) + (y >> 5)) & 1 ? 118 : 100;
      const n = (Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1;
      const v = c + Math.abs(n) * 8;
      const i = (y * size + x) * 4;
      data[i] = v;
      data[i + 1] = v * 0.97;
      data[i + 2] = v * 0.88;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(200, 200);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  const geo = new THREE.PlaneGeometry(200, 200, terrain ? 800 : 1, terrain ? 800 : 1).rotateX(-Math.PI / 2);
  if (terrain) {
    const p = geo.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      p.setY(i, groundAt(p.getX(i), p.getZ(i)));
    }
    geo.computeVertexNormals();
  }
  const g = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
  g.receiveShadow = true;
  return g;
}

let model: HumanRider | undefined;
let loading = 1;
let controller: LocomotionController | undefined;
let simTime = 0;
const keys = new Set<string>();
let jumpQueued = false;
window.addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'Space') {
    jumpQueued = true;
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));

/** Scripted inputs over time (s). */
function scripted(t: number, input: LocomotionInput): void {
  const fwd = (k: number): void => {
    input.move.set(0, k);
  };
  switch (script) {
    case 'walk':
      fwd(1);
      break;
    case 'run':
      fwd(1);
      input.run = true;
      break;
    case 'runstop':
      if (t < 2.2) {
        fwd(1);
        input.run = true;
      }
      break;
    case 'jump':
      input.jump = t >= 0.8 && t < 0.8 + 1 / 60;
      break;
    case 'runjump':
      fwd(1);
      input.run = true;
      input.jump = t >= 2.0 && t < 2.0 + 1 / 60;
      break;
    case 'crouch':
      input.crouch = t > 0.5;
      if (t > 1.5 && t < 4) {
        fwd(1);
      }
      break;
    case 'turn':
      // Standing, turns to face left, then right.
      input.faceYaw = t < 1 ? 0 : t < 3 ? Math.PI / 2 : -Math.PI / 2;
      break;
    case 'glide': {
      // Starts high (?alt=): falls a moment, spreads the wings, dives, flaps twice, banks left, lands.
      input.glide = t > 0.4;
      const dive = t > 1.6 && t < 2.6 ? 1 : 0;
      const flap = (t > 3.0 && t < 3.0 + 1 / 60) || (t > 3.9 && t < 3.9 + 1 / 60);
      input.flight = { pitch: dive, roll: t > 4.6 && t < 7 ? -1 : 0, flap, fold: false };
      break;
    }
    case 'circle': {
      const a = t * 0.9;
      input.move.set(Math.sin(a), Math.cos(a));
      input.run = true;
      break;
    }
    default:
      break;
  }
}

const cam = { yaw: THREE.MathUtils.degToRad(Number(params.get('camyaw') ?? 144)), pitch: Number(params.get('campitch') ?? 0.28), dist: Number(params.get('camdist') ?? 5.5), target: new THREE.Vector3() };
let dragging = false;
window.addEventListener('pointerdown', () => (dragging = true));
window.addEventListener('pointerup', () => (dragging = false));
window.addEventListener('pointermove', (e) => {
  if (dragging) {
    cam.yaw -= e.movementX * 0.005;
    cam.pitch = THREE.MathUtils.clamp(cam.pitch + e.movementY * 0.004, -0.2, 1.3);
  }
});
window.addEventListener('wheel', (e) => (cam.dist = THREE.MathUtils.clamp(cam.dist * (1 + e.deltaY * 0.001), 1.5, 30)));
const holder = new THREE.Group();
const airflow = new THREE.Vector3(0, 0, -1);

const bench: System = {
  name: 'human-bench',
  order: UpdateOrder.Physics,
  init(ctx) {
    bindMissingSharedSamplers();
    ctx.scene.add(holder, makeGround());
    if (!useSky) {
      ctx.scene.environment = makeEnvironment(ctx.renderer);
      ctx.scene.environmentIntensity = 0.6;
      ctx.scene.traverse((o) => {
        const l = o as THREE.DirectionalLight;
        if (l.isDirectionalLight) {
          l.shadow.bias = -0.0004;
          l.shadow.normalBias = 0.02;
          l.shadow.camera.left = l.shadow.camera.bottom = -6;
          l.shadow.camera.right = l.shadow.camera.top = 6;
          l.shadow.camera.updateProjectionMatrix();
        }
      });
    }
    void loadHumanModel(url).then((m) => {
      model = m;
      holder.add(m.root);
      if (clipName) {
        const clip = m.clips.get(clipName);
        if (!clip) {
          console.error(`[human] no clip ${clipName}; have ${[...m.clips.keys()].join(', ')}`);
        } else {
          const action = m.mixer.clipAction(clip);
          action.play();
          if (fixedT !== undefined) {
            action.paused = true;
            action.time = fixedT;
          }
        }
      }
      if (play) {
        controller = new LocomotionController(m, holder, groundAt);
        controller.layers = params.get('layers') !== '0';
        if (params.has('alt')) {
          holder.position.y = Number(params.get('alt'));
          controller.state = 'air';
        }
      }
      m.mixer.update(0);
      m.wind.captureRest();
      // ?look=<JSON RiderLook fields>, ?palette=akinci|sipahi|deli|yeniceri
      const look: RiderLook = { ...DEFAULT_LOOK, ...(params.has('look') ? (JSON.parse(params.get('look')!) as Partial<RiderLook>) : {}) };
      if (params.has('palette')) {
        look.palette = PALETTES[params.get('palette')!] ?? look.palette;
      }
      applyLook(m, look);
      (window as unknown as { __human: unknown }).__human = { model: m, controller, look: (l: Partial<RiderLook>) => applyLook(m, { ...look, ...l }) };
      loading = 0;
    });
  },
  pending: () => loading,
  update(dt, ctx) {
    if (!model) {
      return;
    }
    if (controller) {
      // Fixed steps; held at ?at= (the pose freezes there).
      const steps = holdAt !== undefined ? Math.max(0, Math.min(400, Math.ceil((holdAt - simTime) / (1 / 60)))) : 1;
      for (let i = 0; i < steps; i++) {
        const h = holdAt !== undefined ? Math.min(1 / 60, holdAt - simTime) : dt;
        if (h <= 0) {
          break;
        }
        const input: LocomotionInput = { move: new THREE.Vector2(), run: false, crouch: false, jump: false };
        if (script) {
          scripted(simTime, input);
        } else {
          // WASD relative to the camera's heading.
          const f = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
          const r = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
          const fx = -Math.sin(cam.yaw);
          const fz = -Math.cos(cam.yaw);
          input.move.set(fx * f - fz * r, fz * f + fx * r);
          input.run = keys.has('ShiftLeft') || keys.has('ShiftRight');
          input.crouch = keys.has('KeyC');
          input.jump = jumpQueued;
          input.glide = keys.has('KeyG') || (jumpQueued && controller.state === 'air');
          input.flight = { pitch: f, roll: r, flap: input.jump, fold: input.crouch };
          jumpQueued = false;
        }
        controller.update(h, input);
        simTime += h;
      }
      holder.updateMatrixWorld(true);
      cam.target.lerp(new THREE.Vector3(holder.position.x, holder.position.y + 1.1, holder.position.z), holdAt !== undefined ? 1 : 1 - Math.exp(-8 * dt));
      const c = ctx.camera;
      c.position.set(Math.sin(cam.yaw) * Math.cos(cam.pitch), Math.sin(cam.pitch), Math.cos(cam.yaw) * Math.cos(cam.pitch)).multiplyScalar(cam.dist).add(cam.target);
      c.lookAt(cam.target);
    } else {
      model.mixer.update(fixedT !== undefined ? 0 : dt * rate);
      model.wings.set(clipName === 'glide' ? 1 : 0);
    }
    model.root.updateMatrixWorld(true);
    if (controller) {
      // Effort when sprinting, taking off and landing hard; the eyes on the way ahead.
      const sp = controller.speed;
      const st = controller.state;
      const effort = THREE.MathUtils.smoothstep(sp, 3.5, 5.2) * 0.55 + (st === 'takeoff' || st === 'land' ? 0.8 : 0);
      const ahead = new THREE.Vector3(Math.sin(controller.yaw) * 6, 1.4, Math.cos(controller.yaw) * 6).add(holder.position);
      model.face.update(dt, { effort, shout: st === 'takeoff' ? 0.3 : 0 }, ahead);
    } else {
      model.face.update(dt, { [params.get('expr') ?? 'none']: Number(params.get('exprw') ?? 1) });
    }
    model.wind.captureRest();
    // Air past the body: the wind plus its own motion.
    const v = controller ? new THREE.Vector3(-controller.velocity.x, -(controller.vy ?? 0), -controller.velocity.y) : new THREE.Vector3();
    v.add(airflow.clone().multiplyScalar(windSpeed));
    const sp = v.length();
    model.wind.update(dt, sp, sp > 1e-3 ? v.normalize() : airflow);
  },
};

const systems: System[] = [];
if (useSky) {
  systems.push(createSkySystem());
}
systems.push(bench);

void startSandbox({
  systems,
  pipeline: useSky ? createRenderPipeline : undefined,
  orbit: !play,
  basicLighting: !useSky,
  cameraPosition: new THREE.Vector3(...view.pos),
  orbitTarget: new THREE.Vector3(...view.target),
});
