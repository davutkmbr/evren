/**
 * UI sandbox: the real UI + geo systems with mocked dragon / camera / env / audio services.
 *   /sandbox/ui.html?autostart=1                 fly a circle over Galata (bright sky background)
 *   &night=1 &t=21.5                             dark background + night clock
 *   &lm=galata-kulesi                            hover 650 m from a landmark, facing it (discovery card)
 *   &open=pause|settings|teleport|controls|map|help|photo
 *   &stall=1                                     loading screen that never finishes (stalls at "city")
 *   (no autostart)                               finish loading and keep the start prompt
 */
import * as THREE from 'three';
import { startSandbox } from '../src/core/sandbox';
import { UpdateOrder } from '../src/core/contracts';
import type { AudioService, CameraMode, CameraRigState, DragonState, EngineContext, EnvironmentState, FlightMode, System } from '../src/core/contracts';
import { latLonToLocal } from '../src/core/geo-coords';
import { createGeoSystem } from '../src/world/geo';
import { createUiSystem } from '../src/ui';

const params = new URLSearchParams(location.search);
const night = params.get('night') === '1';
const hours = params.has('t') ? Number(params.get('t')) : night ? 21.5 : 17.5;

function fakeSystem(name: string, stall = false): System {
  return {
    name,
    order: UpdateOrder.World,
    init: () => new Promise<void>((resolve) => {
      if (!stall) {
        window.setTimeout(resolve, 120);
      }
    }),
  };
}

function mockServices(): System {
  const object = new THREE.Object3D();
  const center = latLonToLocal(41.0256, 28.9742);
  const velocity = new THREE.Vector3();
  const dragon: DragonState = {
    object,
    position: object.position,
    quaternion: object.quaternion,
    velocity,
    angularVelocity: new THREE.Vector3(),
    mode: 'gliding',
    airspeed: 34,
    altitude: 180,
    agl: 140,
    headingDeg: 0,
    gForce: 1,
    stamina: 0.82,
    flapEffort: 0,
    firing: false,
    touchingWater: false,
  };
  let cameraMode: CameraMode = 'third';
  let ctxRef: EngineContext | null = null;
  const cameraRig: CameraRigState = {
    get mode() {
      return cameraMode;
    },
    set mode(m: CameraMode) {
      cameraMode = m;
    },
    setMode(m: CameraMode) {
      cameraMode = m;
      ctxRef?.events.emit('camera-mode', { mode: m });
    },
    shake() {},
    fovDeg: 60,
  };
  const elevation = night ? -22 : hours > 16 ? 12 : 45;
  const sunDirection = new THREE.Vector3(0, Math.sin((elevation * Math.PI) / 180), -Math.cos((elevation * Math.PI) / 180)).normalize();
  let tod = hours;
  const env: EnvironmentState = {
    sunDirection,
    moonDirection: new THREE.Vector3(0, 1, 0),
    sunColor: new THREE.Color(1, 1, 1),
    ambientColor: new THREE.Color(0.3, 0.3, 0.3),
    nightFactor: night ? 1 : 0,
    light: new THREE.DirectionalLight(),
    wind: new THREE.Vector3(),
    setTimeOfDay(h: number) {
      tod = h;
    },
  };
  const audio: AudioService = {
    play: (name) => console.info(`[audio] ${name}`),
    unlocked: true,
    setMasterVolume: () => undefined,
  };
  const modes: FlightMode[] = ['gliding', 'flying', 'diving', 'stalling', 'hovering'];
  const landmarkId = params.get('lm');
  let angle = 0;
  return {
    name: 'mock-services',
    order: UpdateOrder.Physics,
    init(ctx) {
      ctxRef = ctx;
      ctx.time.timeOfDay = hours;
      ctx.services.provide('dragon', dragon);
      ctx.services.provide('cameraRig', cameraRig);
      ctx.services.provide('env', env);
      ctx.services.provide('audio', audio);
      ctx.scene.background = new THREE.Color(night ? 0x0b1020 : 0x9cbfe3);
      ctx.events.on('teleport', (e) => {
        object.position.set(e.x, e.y, e.z);
        dragon.headingDeg = e.headingDeg;
      });
      if (landmarkId) {
        void ctx.services.when('geo').then((geo) => {
          const lm = geo.landmark(landmarkId);
          if (lm) {
            object.position.set(lm.x - 460, lm.y + 160, lm.z + 460);
            dragon.headingDeg = 45;
          }
        });
      }
    },
    update(dt, ctx) {
      ctx.time.timeOfDay = tod;
      if (!landmarkId) {
        angle += dt * 0.05;
        const r = 900;
        object.position.set(center.x + Math.cos(angle) * r, 180 + Math.sin(angle * 3) * 20, center.z + Math.sin(angle) * r);
        const heading = ((Math.atan2(-Math.sin(angle), -Math.cos(angle)) * 180) / Math.PI + 360) % 360;
        dragon.headingDeg = (heading + 90) % 360;
        velocity.set(0, Math.cos(angle * 3) * 3 * 0.15 * 20, 0);
      }
      dragon.altitude = object.position.y;
      dragon.agl = object.position.y - 40;
      dragon.stamina = 0.55 + 0.4 * Math.sin(ctx.time.elapsed * 0.3);
      dragon.airspeed = 30 + 8 * Math.sin(ctx.time.elapsed * 0.4);
      if (params.get('modes') === '1') {
        dragon.mode = modes[Math.floor(ctx.time.elapsed / 3) % modes.length];
      }
      const yaw = (-dragon.headingDeg * Math.PI) / 180;
      const back = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(30);
      ctx.camera.position.copy(object.position).add(back).add(new THREE.Vector3(0, 8, 0));
      ctx.camera.rotation.set(-0.12, yaw, 0, 'YXZ');
    },
  };
}

const stall = params.get('stall') === '1';
const systems: System[] = [createUiSystem()];
if (stall) {
  for (const name of ['geo', 'sky', 'terrain', 'water']) {
    systems.push(fakeSystem(name));
  }
  systems.push(fakeSystem('city', true));
  for (const name of ['vegetation', 'mosques', 'structures', 'heritage', 'clouds']) {
    systems.push(fakeSystem(name));
  }
} else {
  systems.push(createGeoSystem(), mockServices());
}

void startSandbox({ systems }).then(() => {
  const open = params.get('open');
  const hook = (window as unknown as { __evrenUi?: { open(what: string): void } }).__evrenUi;
  if (open && hook) {
    window.setTimeout(() => hook.open(open), 300);
  }
});
