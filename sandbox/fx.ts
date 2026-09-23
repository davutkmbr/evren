/**
 * fx sandbox. URL params:
 *   effect = fire | splash | skim | dust | trails | speed | all   (default fire)
 *   t      = time of day (hours)          world = mock | real     rig = real | proxy
 *   cam    = chase | side | front | pov | wide | low | orbit       yaw / dist = camera orbit angle (deg) / scale
 *   speed  = dragon speed m/s            alt = altitude m           pitch = nose pitch deg
 *   target = water | building | ground (what the hovering dragon breathes fire at)
 *   pause  = pause the simulation after N seconds (deterministic screenshots)
 *   burst  = 1 toggles fire on/off      strength = splash/dust strength      g = load factor for trails
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { startSandbox } from '../src/core/sandbox';
import type {
  CameraMode,
  CameraRigState,
  DragonPose,
  DragonRig,
  DragonState,
  EngineContext,
  EnvironmentState,
  GeoQuery,
  System,
} from '../src/core/contracts';
import { LandUse, UpdateOrder } from '../src/core/contracts';
import { globalUniforms } from '../src/core/uniforms';
import { SHARED_GLSL } from '../src/render/shaders';
import { createRenderPipeline } from '../src/render/post';
import { createDragonModelSystem } from '../src/dragon/model';
import { createGeoSystem } from '../src/world/geo';
import { createSkySystem } from '../src/render/sky';
import { createTerrainSystem } from '../src/world/terrain';
import { createWaterSystem } from '../src/world/water';
import { createFxSystem } from '../src/fx';

const params = new URLSearchParams(location.search);
const num = (k: string, d: number): number => (params.has(k) ? Number(params.get(k)) : d);
const effect = params.get('effect') ?? 'fire';
const worldKind = params.get('world') ?? 'mock';
const rigKind = params.get('rig') ?? 'proxy';
const timeOfDay = num('t', 17.8);
const target = params.get('target') ?? 'water';
const pauseAt = num('pause', -1);
const strength = num('strength', 1);

const defaults: Record<string, { speed: number; alt: number; pitch: number; cam: string }> = {
  fire: { speed: 0, alt: 26, pitch: -8, cam: 'side' },
  splash: { speed: 0, alt: 45, pitch: 0, cam: 'low' },
  skim: { speed: 34, alt: 1.1, pitch: 0, cam: 'chase' },
  dust: { speed: 0, alt: 9, pitch: 0, cam: 'wide' },
  trails: { speed: 72, alt: 160, pitch: 0, cam: 'chase' },
  speed: { speed: 78, alt: 60, pitch: 0, cam: 'pov' },
  all: { speed: 38, alt: 60, pitch: -4, cam: 'chase' },
};
const def = defaults[effect] ?? defaults.fire;
const speed = num('speed', def.speed);
const altitude = num('alt', def.alt);
const pitchDeg = num('pitch', def.pitch);
const camKind = params.get('cam') ?? def.cam;
const camYaw = THREE.MathUtils.degToRad(num('yaw', 0));
const camDist = num('dist', 1);

/* ------------------------------------------------------------------ */
/* Mock environment (sun from time of day, sky dome, lights, uniforms)  */
/* ------------------------------------------------------------------ */

function sunDirection(hours: number, out: THREE.Vector3): THREE.Vector3 {
  const lat = THREE.MathUtils.degToRad(41.03);
  const H = THREE.MathUtils.degToRad((hours - 13.07) * 15);
  const e = -Math.sin(H);
  const n = -Math.sin(lat) * Math.cos(H);
  const u = Math.cos(lat) * Math.cos(H);
  return out.set(e, u, -n).normalize();
}

function createMockSky(): System {
  const sun = new THREE.DirectionalLight(0xffffff, 3);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x3a3a3a, 1);
  const sunDir = new THREE.Vector3();
  const moonDir = new THREE.Vector3();
  const env: EnvironmentState = {
    sunDirection: new THREE.Vector3(),
    moonDirection: new THREE.Vector3(),
    sunColor: new THREE.Color(),
    ambientColor: new THREE.Color(),
    nightFactor: 0,
    light: sun,
    wind: new THREE.Vector3(3, 0, 1.5),
    setTimeOfDay: (h: number) => apply(h),
  };
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(40000, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize((modelMatrix * vec4(position,1.0)).xyz - cameraPosition); vec4 p = projectionMatrix * viewMatrix * vec4(cameraPosition + vDir * 30000.0, 1.0); gl_Position = p; }',
      fragmentShader: `${SHARED_GLSL}
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  vec3 c = skyRadiance(d);
  float sd = dot(d, uSunDir);
  c += uSunColor * smoothstep(0.99985, 0.99995, sd) * 40.0;
  c += uSunColor * pow(max(sd, 0.0), 300.0) * 0.6;
  c = mix(c, uFogColor * (1.0 - 0.6 * uNight), exp(-max(d.y, 0.0) * 18.0) * 0.6);
  gl_FragColor = vec4(c, 1.0);
}`,
    }),
  );
  dome.frustumCulled = false;
  dome.renderOrder = -10;

  function apply(hours: number): void {
    sunDirection(hours, sunDir);
    moonDir.copy(sunDir).negate();
    moonDir.y = Math.abs(moonDir.y) * 0.8 + 0.2;
    moonDir.normalize();
    const el = sunDir.y;
    const day = THREE.MathUtils.smoothstep(el, -0.08, 0.1);
    const air = 1 / (Math.max(el, 0) + 0.06);
    const tint = new THREE.Color(Math.exp(-0.012 * air), Math.exp(-0.035 * air), Math.exp(-0.09 * air));
    const sunColor = tint.multiplyScalar(4.4 * day);
    const ambient = new THREE.Color(0.32, 0.4, 0.55).multiplyScalar(0.15 + 0.85 * day).lerp(new THREE.Color(0.016, 0.02, 0.034), 1 - day);
    const night = 1 - day;
    (globalUniforms.uSunDir.value as THREE.Vector3).copy(sunDir);
    (globalUniforms.uMoonDir.value as THREE.Vector3).copy(moonDir);
    (globalUniforms.uSunColor.value as THREE.Color).copy(sunColor);
    (globalUniforms.uAmbient.value as THREE.Color).copy(ambient);
    globalUniforms.uNight.value = night;
    globalUniforms.uTimeOfDay.value = hours;
    const fog = new THREE.Color(0.6, 0.66, 0.75).lerp(new THREE.Color(0.95, 0.62, 0.42), THREE.MathUtils.smoothstep(0.35 - el, 0.1, 0.35) * day);
    fog.multiplyScalar(0.2 + 0.8 * day).lerp(new THREE.Color(0.012, 0.016, 0.026), night);
    (globalUniforms.uFogColor.value as THREE.Color).copy(fog);
    globalUniforms.uFogDensity.value = 0.00009;
    (env.sunDirection as THREE.Vector3).copy(sunDir);
    (env.moonDirection as THREE.Vector3).copy(moonDir);
    (env.sunColor as THREE.Color).copy(sunColor);
    (env.ambientColor as THREE.Color).copy(ambient);
    (env as { nightFactor: number }).nightFactor = night;
    if (day > 0.02) {
      sun.color.copy(sunColor).multiplyScalar(1 / Math.max(sunColor.r, sunColor.g, sunColor.b, 1e-3));
      sun.intensity = Math.max(sunColor.r, sunColor.g, sunColor.b);
    } else {
      sun.color.setRGB(0.55, 0.62, 0.8);
      sun.intensity = 0.06;
    }
    hemi.color.copy(ambient).multiplyScalar(1 / Math.max(ambient.b, 1e-3));
    hemi.groundColor.copy(hemi.color).multiplyScalar(0.3);
    hemi.intensity = ambient.b * 1.4;
  }

  return {
    name: 'mock-sky',
    order: UpdateOrder.Environment,
    init(ctx) {
      apply(timeOfDay);
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 3000 });
      sun.shadow.bias = -0.0004;
      ctx.scene.add(sun, sun.target, hemi, dome);
      ctx.services.provide('env', env);
    },
    update(_dt, ctx) {
      const dragon = ctx.services.tryGet('dragon');
      const focus = dragon ? dragon.position : ctx.camera.position;
      sun.target.position.copy(focus);
      const dir = (env.nightFactor > 0.98 ? moonDir : sunDir);
      sun.position.copy(focus).addScaledVector(dir, 1000);
      dome.position.copy(ctx.camera.position);
    },
  };
}

/* ------------------------------------------------------------------ */
/* Mock world: sea, a sandy/urban shore block, a building, mock geo      */
/* ------------------------------------------------------------------ */

const SHORE = { minX: 90, maxX: 600, minZ: -400, maxZ: 400, height: 2 };
const BUILDING = { x: 0, z: -58, hx: 14, hz: 10, h: 34 };

function createMockGeo(): GeoQuery {
  const onShore = (x: number, z: number): boolean => x > SHORE.minX && x < SHORE.maxX && z > SHORE.minZ && z < SHORE.maxZ;
  const geo = {
    bounds: { minX: -24000, maxX: 24000, minZ: -24000, maxZ: 24000 },
    heightAt: (x: number, z: number) => (onShore(x, z) ? SHORE.height : target === 'ground' ? 1.5 : -12),
    normalAt: (_x: number, _z: number, out: THREE.Vector3) => out.set(0, 1, 0),
    isWater: (x: number, z: number) => !onShore(x, z) && target !== 'ground',
    coastDistance: (x: number) => x - SHORE.minX,
    landUseAt: (x: number, z: number) => (onShore(x, z) ? (x < 200 ? LandUse.Beach : LandUse.Urban) : target === 'ground' ? LandUse.Farmland : LandUse.Water),
    densityAt: () => 0,
    districtAt: () => null,
    buildableAt: () => false,
    landmarks: [],
    landmark: () => undefined,
    roads: [],
    smallMosqueSites: [],
    coastlines: [],
    districts: [],
  };
  return geo as unknown as GeoQuery;
}

function createMockWorld(): System {
  return {
    name: 'mock-world',
    order: UpdateOrder.World,
    init(ctx) {
      ctx.services.provide('geo', createMockGeo());
      const pmrem = new THREE.PMREMGenerator(ctx.renderer);
      const skyScene = new THREE.Scene();
      const skyMesh = ctx.scene.children.find((o) => (o as THREE.Mesh).isMesh && ((o as THREE.Mesh).geometry as THREE.BufferGeometry).type === 'SphereGeometry');
      if (skyMesh) {
        skyScene.add(skyMesh.clone());
        ctx.scene.environment = pmrem.fromScene(skyScene, 0, 1, 50000).texture;
        ctx.scene.environmentIntensity = 0.6;
      }
      const water = new THREE.Mesh(
        new THREE.PlaneGeometry(60000, 60000).rotateX(-Math.PI / 2),
        new THREE.MeshPhysicalMaterial({ color: new THREE.Color(0.012, 0.04, 0.05), roughness: 0.07, metalness: 0, ior: 1.33 }),
      );
      water.receiveShadow = true;
      ctx.scene.add(water);
      const col = ctx.services.get('collision');
      if (target !== 'ground') {
        const shore = new THREE.Mesh(
          new THREE.BoxGeometry(SHORE.maxX - SHORE.minX, SHORE.height + 20, SHORE.maxZ - SHORE.minZ),
          new THREE.MeshStandardMaterial({ color: new THREE.Color(0.52, 0.45, 0.34), roughness: 0.95 }),
        );
        shore.position.set((SHORE.minX + SHORE.maxX) / 2, SHORE.height - 10, 0);
        shore.receiveShadow = true;
        ctx.scene.add(shore);
      } else {
        const field = new THREE.Mesh(
          new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2),
          new THREE.MeshStandardMaterial({ color: new THREE.Color(0.26, 0.22, 0.14), roughness: 0.95 }),
        );
        field.position.y = 1.5;
        field.receiveShadow = true;
        ctx.scene.add(field);
      }
      if (target === 'building') {
        const b = new THREE.Mesh(
          new THREE.BoxGeometry(BUILDING.hx * 2, BUILDING.h, BUILDING.hz * 2),
          new THREE.MeshStandardMaterial({ color: new THREE.Color(0.55, 0.5, 0.44), roughness: 0.85 }),
        );
        b.position.set(BUILDING.x, BUILDING.h / 2 - 2, BUILDING.z);
        b.castShadow = true;
        b.receiveShadow = true;
        ctx.scene.add(b);
        col.add({ kind: 'box', center: b.position.clone(), halfSize: new THREE.Vector3(BUILDING.hx, BUILDING.h / 2, BUILDING.hz), yaw: 0 });
      }
    },
  };
}

/* ------------------------------------------------------------------ */
/* Proxy rig (used when the dragon model is unavailable)                */
/* ------------------------------------------------------------------ */

class ProxyRig implements DragonRig {
  root = new THREE.Group();
  riderHead = new THREE.Object3D();
  mouth = new THREE.Object3D();
  wingTipLeft = new THREE.Object3D();
  wingTipRight = new THREE.Object3D();
  dimensions = { length: 18, wingspan: 24, height: 4 };
  private pose = {} as DragonPose;
  private wings: THREE.Object3D[] = [];

  constructor() {
    const skin = new THREE.MeshStandardMaterial({ color: 0x2c3326, roughness: 0.55 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(1.3, 8, 8, 16).rotateX(Math.PI / 2), skin);
    const neck = new THREE.Mesh(new THREE.CapsuleGeometry(0.55, 4, 6, 12).rotateX(Math.PI / 2 - 0.35), skin);
    neck.position.set(0, 1.0, -6.4);
    const head = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.9, 2.4), skin);
    head.position.set(0, 1.9, -8.8);
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.8, 9, 10).rotateX(-Math.PI / 2), skin);
    tail.position.set(0, 0, 8.5);
    const wingGeo = new THREE.PlaneGeometry(11, 5).translate(5.5, 0, 0).rotateX(-Math.PI / 2);
    const membrane = new THREE.MeshStandardMaterial({ color: 0x4a2f22, roughness: 0.7, side: THREE.DoubleSide });
    for (const side of [-1, 1]) {
      const w = new THREE.Mesh(wingGeo, membrane);
      w.scale.x = side;
      w.position.set(side * 1.1, 0.8, -1);
      const tip = side < 0 ? this.wingTipLeft : this.wingTipRight;
      tip.position.set(11, 0, 1);
      w.add(tip);
      w.castShadow = true;
      this.wings.push(w);
      this.root.add(w);
    }
    for (const m of [body, neck, head, tail]) {
      m.castShadow = true;
      this.root.add(m);
    }
    this.riderHead.position.set(0, 2.9, -2.6);
    this.mouth.position.set(0, 1.75, -10.1);
    this.root.add(this.riderHead, this.mouth);
  }

  setPose(p: Partial<DragonPose>): void {
    Object.assign(this.pose, p);
    const a = Math.sin(this.pose.flapPhase ?? 0) * (this.pose.flapAmplitude ?? 0) * 0.8;
    this.wings[0].rotation.z = -a;
    this.wings[1].rotation.z = a;
  }

  getPose(): Readonly<DragonPose> {
    return this.pose;
  }

  setFirstPerson(): void {}
}

/* ------------------------------------------------------------------ */
/* Mock flight: scripted dragon motion + effect scheduling               */
/* ------------------------------------------------------------------ */

function createMockFlight(): System {
  const object = new THREE.Group();
  const state: DragonState = {
    object,
    position: object.position,
    quaternion: object.quaternion,
    velocity: new THREE.Vector3(),
    angularVelocity: new THREE.Vector3(),
    mode: speed < 12 ? 'hovering' : 'flying',
    airspeed: speed,
    altitude: altitude,
    agl: altitude,
    headingDeg: 0,
    gForce: 1,
    stamina: 1,
    flapEffort: speed < 12 ? 0.8 : 0.3,
    firing: false,
    touchingWater: false,
  };
  let rig: DragonRig | null = null;
  let t = 0;
  let nextOneShot = 0.6;
  let flapPhase = 0;
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const radius = 170;
  const startX = effect === 'dust' ? 160 : 0;
  const fxPoint = new THREE.Vector3();

  function attachRig(r: DragonRig): void {
    if (rig) {
      return;
    }
    rig = r;
    object.add(r.root);
  }

  return {
    name: 'mock-flight',
    order: UpdateOrder.Physics,
    init(ctx) {
      ctx.scene.add(object);
      object.position.set(startX, altitude, 0);
      ctx.services.provide('dragon', state);
      if (rigKind === 'proxy') {
        const proxy = new ProxyRig();
        attachRig(proxy);
        ctx.services.provide('rig', proxy);
      } else {
        void ctx.services.when('rig').then(attachRig);
        setTimeout(() => {
          if (!rig) {
            console.warn('[fx sandbox] dragon model unavailable, using proxy rig');
            const proxy = new ProxyRig();
            attachRig(proxy);
            ctx.services.provide('rig', proxy);
          }
        }, 2500);
      }
    },
    update(dt, ctx) {
      t += dt;
      const circle = effect === 'trails' || effect === 'all';
      let yaw = 0;
      let bank = 0;
      let g = num('g', 1);
      if (circle && speed > 0) {
        const w = speed / radius;
        const ang = t * w;
        object.position.set(startX + radius - radius * Math.cos(ang), altitude, -radius * Math.sin(ang));
        yaw = -ang;
        const lateral = (speed * speed) / radius / 9.81;
        g = params.has('g') ? g : Math.sqrt(1 + lateral * lateral);
        bank = -Math.atan(lateral);
        state.velocity.set(radius * w * -Math.sin(ang) * -1, 0, -radius * w * Math.cos(ang));
      } else {
        object.position.set(startX, altitude + (speed < 5 ? Math.sin(t * 1.3) * 0.25 : 0), -speed * t);
        state.velocity.set(0, 0, -speed);
      }
      euler.set(THREE.MathUtils.degToRad(pitchDeg), yaw, bank);
      object.quaternion.setFromEuler(euler);
      state.airspeed = speed;
      state.gForce = g;
      state.altitude = object.position.y;
      const ground = effect === 'dust' ? SHORE.height : target === 'ground' ? 1.5 : 0;
      state.agl = object.position.y - ground;
      state.touchingWater = effect === 'skim';
      state.mode = speed < 12 ? 'hovering' : 'flying';

      if (effect === 'fire' || effect === 'all') {
        const burst = params.get('burst') === '1';
        state.firing = t > 0.25 && (!burst || t % 4 < 2.6);
      }
      if (effect === 'speed') {
        const rigState = ctx.services.tryGet('cameraRig');
        if (rigState && rigState.mode !== 'pov' && camKind === 'pov') {
          rigState.setMode('pov');
        }
      }
      const fx = ctx.services.tryGet('fx');
      if (fx && t >= nextOneShot) {
        if (effect === 'splash') {
          nextOneShot = t + 2.6;
          fxPoint.set(0, 0, -30);
          fx.splash(fxPoint, strength);
        } else if (effect === 'dust') {
          nextOneShot = t + 3.2;
          fxPoint.set(startX, SHORE.height, 0);
          fx.dust(fxPoint, strength);
        }
      }
      const flapRate = speed < 12 ? 3.4 : 2.2;
      const prevPhase = flapPhase;
      flapPhase += dt * flapRate * Math.PI * 2 * 0.5;
      if (Math.floor(prevPhase / (Math.PI * 2)) !== Math.floor(flapPhase / (Math.PI * 2))) {
        ctx.events.emit('flap', { strength: speed < 12 ? 0.8 : 0.3 });
      }
      rig?.setPose({ flapPhase, flapAmplitude: speed < 12 ? 0.9 : 0.35, wingSpread: 1, jawOpen: state.firing ? 1 : 0, legsTuck: speed < 12 ? 0.3 : 1 });
      if (pauseAt > 0 && t >= pauseAt && !ctx.time.paused) {
        ctx.events.emit('pause', { paused: true });
      }
    },
  };
}

/* ------------------------------------------------------------------ */
/* Sandbox camera                                                       */
/* ------------------------------------------------------------------ */

function createSandboxCamera(): System {
  const rigState: CameraRigState = {
    mode: camKind === 'pov' ? 'pov' : 'third',
    fovDeg: 60,
    setMode(m: CameraMode) {
      rigState.mode = m;
    },
    shake() {},
  };
  const offset = new THREE.Vector3();
  const look = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const right = new THREE.Vector3();
  let controls: OrbitControls | null = null;

  return {
    name: 'fx-sandbox-camera',
    order: UpdateOrder.Camera,
    init(ctx: EngineContext) {
      ctx.services.provide('cameraRig', rigState);
      ctx.camera.fov = 60;
      ctx.camera.near = 0.1;
      ctx.camera.updateProjectionMatrix();
      if (camKind === 'orbit') {
        controls = new OrbitControls(ctx.camera, ctx.canvas);
        controls.target.set(0, altitude, -15);
        ctx.camera.position.set(45, altitude + 10, 20);
        controls.update();
      }
    },
    update(_dt, ctx) {
      const dragon = ctx.services.tryGet('dragon');
      const cam = ctx.camera;
      if (!dragon) {
        return;
      }
      if (controls) {
        controls.update();
        return;
      }
      const p = dragon.position;
      fwd.set(0, 0, -1).applyQuaternion(dragon.quaternion);
      fwd.y = 0;
      fwd.normalize();
      right.set(-fwd.z, 0, fwd.x);
      if (rigState.mode === 'pov' || camKind === 'pov') {
        const rig = ctx.services.tryGet('rig');
        if (rig) {
          rig.riderHead.getWorldPosition(cam.position);
          rig.riderHead.getWorldQuaternion(cam.quaternion);
          cam.rotateX(THREE.MathUtils.degToRad(num('lookPitch', -6)));
        }
        return;
      }
      const d = camDist;
      switch (camKind) {
        case 'side':
          offset.copy(right).multiplyScalar(40 * d).addScaledVector(fwd, -14 * d);
          offset.y = 5 * d;
          look.copy(p).addScaledVector(fwd, 17);
          look.y = p.y - 2;
          break;
        case 'front':
          offset.copy(fwd).multiplyScalar(58 * d).addScaledVector(right, 14 * d);
          offset.y = 8 * d;
          look.copy(p).addScaledVector(fwd, 12);
          break;
        case 'wide':
          offset.copy(right).multiplyScalar(62 * d).addScaledVector(fwd, 30 * d);
          offset.y = 16 * d;
          look.copy(p);
          look.y = Math.max(p.y - 4, 2);
          break;
        case 'low':
          cam.position.set(26 * d, 5 * d, -16 * d).applyAxisAngle(THREE.Object3D.DEFAULT_UP, camYaw);
          cam.position.z -= 30;
          cam.lookAt(0, 3, -30);
          return;
        case 'top':
          cam.position.set(16 * d, 30 * d, 4 * d).applyAxisAngle(THREE.Object3D.DEFAULT_UP, camYaw);
          cam.position.z -= 30;
          cam.lookAt(0, 0, -30);
          return;
        default:
          offset.copy(fwd).multiplyScalar(-27 * d);
          offset.y = 6.5 * d;
          look.copy(p).addScaledVector(fwd, 14);
          look.y = p.y + 1;
          break;
      }
      offset.applyAxisAngle(THREE.Object3D.DEFAULT_UP, camYaw);
      cam.position.copy(p).add(offset);
      cam.lookAt(look);
    },
  };
}

/* ------------------------------------------------------------------ */

const systems: System[] = [];
if (worldKind === 'real') {
  systems.push(createGeoSystem(), createSkySystem(), createTerrainSystem(), createWaterSystem());
} else {
  systems.push(createMockSky(), createMockWorld());
}
if (rigKind !== 'proxy') {
  systems.push(createDragonModelSystem());
}
systems.push(createMockFlight(), createSandboxCamera(), createFxSystem());

void startSandbox({
  pipeline: createRenderPipeline,
  systems,
  cameraPosition: new THREE.Vector3(40, 30, 40),
}).then((engine) => {
  if (worldKind === 'real') {
    engine.ctx.services.tryGet('env')?.setTimeOfDay(timeOfDay);
  }
  (window as unknown as { __fxSandbox: unknown }).__fxSandbox = { engine };
});
