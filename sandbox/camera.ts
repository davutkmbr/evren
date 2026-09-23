/**
 * Camera sandbox: real world modules (when they load) + a scripted dragon flight + the camera system.
 *
 *   ?man=tour|level|turn|sturn|roll|dive|climb|fast|hover|grounded   scripted manoeuvre (default tour)
 *   ?cam=third|pov|cinematic|free   ?view=<preset> start point   ?alt=<m above ground>   ?v=<m/s> speed override
 *   ?obstacle=behind|wall   test tower/wall between the dragon and the chase camera
 *   ?world=full   also load city, vegetation and landmark modules      ?rig=stub   use a stub dragon
 *   ?landmarks=1   stand-in Galata/Kız Kulesi/Süleymaniye landmarks when geo has none (landmark shots)
 *   ?iso=1   camera only: flat sea, stub rig, no other modules (immune to other modules' hot reloads)
 *   ?hud=0   hide the diagnostics overlay        ?t=<hours> time of day     ?freeze=1 pause simulation
 *
 * window.__camtest: mode(m), shot(kind), orbit(dx, dy, release?), wheel(n), key(code, ms), maneuver(name), info()
 */
import * as THREE from 'three';
import { startSandbox } from '../src/core/sandbox';
import { registerGlobalUniform } from '../src/core/uniforms';
import type { CameraMode, DragonPose, DragonRig, DragonState, EngineContext, FlightMode, GeoQuery, LandmarkDef, System } from '../src/core/contracts';
import { UpdateOrder } from '../src/core/contracts';
import { VIEW_PRESETS } from '../src/core/debug';
import { headingToYaw, latLonToLocal } from '../src/core/geo-coords';
import { CameraSystem } from '../src/camera';
import type { ShotKind } from '../src/camera/shots/shot';

const params = new URLSearchParams(window.location.search);
const DEG = Math.PI / 180;
const G = 9.81;

/* ------------------------------------------------------------------ */
/* Scripted manoeuvres                                                 */
/* ------------------------------------------------------------------ */

interface ManeuverTarget {
  speed: number;
  bankDeg: number;
  pitchDeg: number;
  flapAmp: number;
  flapHz: number;
  mode: FlightMode;
  wingSweep?: number;
  wingSpread?: number;
}

type Maneuver = (t: number) => ManeuverTarget;

const cruise = (speed = 42): ManeuverTarget => ({ speed, bankDeg: 0, pitchDeg: 0, flapAmp: 0.35, flapHz: 0.85, mode: 'flying' });

const MANEUVERS: Record<string, Maneuver> = {
  level: () => cruise(),
  turn: () => ({ ...cruise(), bankDeg: 38 }),
  sturn: (t) => ({ ...cruise(), bankDeg: 45 * Math.sin((t * 2 * Math.PI) / 9) }),
  roll: (t) => ({ ...cruise(48), bankDeg: 70 * Math.sign(Math.sin(t * 0.7) + 1e-6) }),
  dive: (t) => ({ speed: Math.min(118, 45 + 12 * t), bankDeg: 0, pitchDeg: -32, flapAmp: 0, flapHz: 0.8, mode: 'diving', wingSweep: 1, wingSpread: 0.55 }),
  climb: () => ({ speed: 34, bankDeg: 0, pitchDeg: 22, flapAmp: 1, flapHz: 1.25, mode: 'flying' }),
  fast: () => ({ ...cruise(95), flapAmp: 0.1, mode: 'gliding', wingSweep: 0.6 }),
  hover: () => ({ speed: 1.5, bankDeg: 0, pitchDeg: 0, flapAmp: 1.1, flapHz: 1.45, mode: 'hovering', wingSweep: -0.5 }),
  grounded: () => ({ speed: 0, bankDeg: 0, pitchDeg: 0, flapAmp: 0, flapHz: 0, mode: 'grounded', wingSpread: 0 }),
};

const TOUR: Array<[string, number]> = [
  ['level', 5],
  ['turn', 8],
  ['sturn', 9],
  ['dive', 5],
  ['climb', 5],
  ['fast', 5],
  ['turn', 6],
  ['hover', 5],
];

function tourManeuver(t: number): { name: string; local: number } {
  const total = TOUR.reduce((a, [, d]) => a + d, 0);
  let x = t % total;
  for (const [name, d] of TOUR) {
    if (x < d) {
      return { name, local: x };
    }
    x -= d;
  }
  return { name: 'level', local: 0 };
}

class ScriptedFlight implements System {
  readonly name = 'scripted-flight';
  readonly order = UpdateOrder.Physics;
  readonly object = new THREE.Group();
  readonly state: DragonState;
  maneuver = params.get('man') ?? 'tour';
  private readonly speedOverride = params.has('v') ? Number(params.get('v')) : undefined;
  private readonly startAgl = params.has('alt') ? Number(params.get('alt')) : undefined;
  private time = 0;
  private headingDeg = 0;
  private pitch = 0;
  private bank = 0;
  private speed = 42;
  private flapPhase = 0;
  private flapAmp = 0.35;
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ');
  activeName = '';

  constructor() {
    const object = this.object;
    this.state = {
      object,
      position: object.position,
      quaternion: object.quaternion,
      velocity: new THREE.Vector3(),
      angularVelocity: new THREE.Vector3(),
      mode: 'flying',
      airspeed: 42,
      altitude: 0,
      agl: 100,
      headingDeg: 0,
      gForce: 1,
      stamina: 1,
      flapEffort: 0,
      firing: false,
      touchingWater: false,
    };
  }

  init(ctx: EngineContext): void {
    ctx.scene.add(this.object);
    void ctx.services.when('rig').then((rig) => this.object.add(rig.root));
    ctx.events.on('teleport', (v) => this.place(v.x, v.y, v.z, v.headingDeg, v.pitchDeg));
    const preset = VIEW_PRESETS[ctx.debug.view ?? 'bogaz'] ?? VIEW_PRESETS.bogaz;
    let y = preset.y;
    if (this.startAgl !== undefined) {
      y = ctx.services.get('collision').surfaceHeight(preset.x, preset.z) + this.startAgl;
    }
    this.place(preset.x, y, preset.z, preset.headingDeg, 0);
    ctx.services.provide('dragon', this.state);
    this.update(0.001, ctx);
  }

  place(x: number, y: number, z: number, headingDeg: number, pitchDeg: number): void {
    this.object.position.set(x, y, z);
    this.headingDeg = headingDeg;
    this.pitch = pitchDeg * DEG;
    this.applyOrientation();
  }

  private target(): ManeuverTarget {
    if (this.maneuver === 'tour') {
      const { name, local } = tourManeuver(this.time);
      this.activeName = `tour:${name}`;
      return (MANEUVERS[name] ?? MANEUVERS.level)(local);
    }
    this.activeName = this.maneuver;
    return (MANEUVERS[this.maneuver] ?? MANEUVERS.level)(this.time);
  }

  update(dt: number, ctx: EngineContext): void {
    if (dt <= 0) {
      return;
    }
    this.time += dt;
    const m = this.target();
    const speedTarget = this.speedOverride ?? m.speed;
    const a = (rate: number) => 1 - Math.exp(-rate * dt);
    this.bank += (m.bankDeg * DEG - this.bank) * a(2.2);
    this.pitch += (m.pitchDeg * DEG - this.pitch) * a(1.6);
    this.speed += (speedTarget - this.speed) * a(m.mode === 'diving' ? 4 : 1.0);
    this.flapAmp += (m.flapAmp - this.flapAmp) * a(3);
    const headingRate = this.speed > 4 ? (G * Math.tan(this.bank)) / this.speed : 0;
    this.headingDeg += (headingRate / DEG) * dt;

    const yaw = headingToYaw(this.headingDeg);
    const cp = Math.cos(this.pitch);
    const v = this.state.velocity.set(-Math.sin(yaw) * cp, Math.sin(this.pitch), -Math.cos(yaw) * cp).multiplyScalar(this.speed);
    const pos = this.object.position;
    pos.addScaledVector(v, dt);
    const col = ctx.services.get('collision');
    const surface = col.surfaceHeight(pos.x, pos.z);
    if (m.mode === 'grounded') {
      pos.y = col.groundHeight(pos.x, pos.z) + 3.2;
      v.y = 0;
    } else if (pos.y < surface + 4) {
      pos.y = surface + 4;
      if (this.pitch < 0) {
        this.pitch *= 0.9;
      }
      v.y = Math.max(v.y, 0);
    }
    this.applyOrientation();

    const s = this.state;
    s.mode = m.mode;
    s.airspeed = this.speed;
    s.altitude = pos.y;
    s.agl = pos.y - surface;
    s.headingDeg = ((this.headingDeg % 360) + 360) % 360;
    s.gForce = 1 / Math.max(0.2, Math.cos(this.bank));
    s.flapEffort = this.flapAmp;
    s.angularVelocity.set(0, -headingRate, 0);

    this.flapPhase += dt * 2 * Math.PI * m.flapHz;
    const pose: Partial<DragonPose> = {
      flapPhase: this.flapPhase,
      flapAmplitude: this.flapAmp,
      wingSpread: m.wingSpread ?? 1,
      wingSweep: m.wingSweep ?? 0,
      wingTwist: Math.max(-1, Math.min(1, this.bank / (50 * DEG))) * 0.4,
      legsTuck: m.mode === 'grounded' || m.mode === 'hovering' ? 0.2 : 1,
    };
    ctx.services.tryGet('rig')?.setPose(pose);
  }

  private applyOrientation(): void {
    const aoa = this.speed > 10 ? 3 * DEG : 8 * DEG;
    this.euler.set(this.pitch + aoa, headingToYaw(this.headingDeg), -this.bank, 'YXZ');
    this.object.quaternion.setFromEuler(this.euler);
  }
}

/* ------------------------------------------------------------------ */
/* Stub rig (only when ?rig=stub or the real model fails to load)      */
/* ------------------------------------------------------------------ */

class StubRig implements DragonRig {
  readonly root = new THREE.Group();
  readonly riderHead = new THREE.Object3D();
  readonly mouth = new THREE.Object3D();
  readonly wingTipLeft = new THREE.Object3D();
  readonly wingTipRight = new THREE.Object3D();
  readonly dimensions = { length: 18, wingspan: 24, height: 4 };
  private pose: DragonPose = {
    flapPhase: 0, flapAmplitude: 0, wingSpread: 1, wingSweep: 0, wingTwist: 0, neckYaw: 0, neckPitch: 0, jawOpen: 0,
    tailYaw: 0, tailPitch: 0, legsTuck: 1, walkPhase: 0, walkAmount: 0, breath: 0, riderLeanPitch: 0, riderLeanRoll: 0,
  };
  private readonly wingL: THREE.Object3D;
  private readonly wingR: THREE.Object3D;
  private readonly riderMesh: THREE.Mesh;

  constructor() {
    const skin = new THREE.MeshStandardMaterial({ color: 0x3d4536, roughness: 0.55, metalness: 0.05 });
    const membrane = new THREE.MeshStandardMaterial({ color: 0x4a3226, roughness: 0.7, side: THREE.DoubleSide });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(1.4, 9, 6, 16), skin);
    body.rotation.x = Math.PI / 2;
    const neck = new THREE.Mesh(new THREE.CapsuleGeometry(0.6, 4, 4, 12), skin);
    neck.position.set(0, 1.2, -7);
    neck.rotation.x = Math.PI / 2 - 0.4;
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.9, 9, 12), skin);
    tail.position.set(0, 0, 9);
    tail.rotation.x = Math.PI / 2;
    const wingShape = new THREE.Shape();
    wingShape.moveTo(0, -1.5);
    wingShape.lineTo(11, 0.5);
    wingShape.lineTo(9, 3.5);
    wingShape.lineTo(0, 2.5);
    const wingGeo = new THREE.ShapeGeometry(wingShape).rotateX(-Math.PI / 2);
    this.wingR = new THREE.Mesh(wingGeo, membrane);
    this.wingL = new THREE.Mesh(wingGeo, membrane);
    this.wingL.scale.x = -1;
    this.wingR.position.set(1, 0.9, -1);
    this.wingL.position.set(-1, 0.9, -1);
    this.riderMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.9, 4, 10), new THREE.MeshStandardMaterial({ color: 0x5b4636, roughness: 0.8 }));
    this.riderMesh.position.set(0, 2.1, -3.4);
    for (const m of [body, neck, tail, this.wingL, this.wingR, this.riderMesh] as THREE.Mesh[]) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
    this.root.add(body, neck, tail, this.wingL, this.wingR, this.riderMesh);
    this.wingTipRight.position.set(11, 0, 0);
    this.wingTipLeft.position.set(11, 0, 0);
    this.wingR.add(this.wingTipRight);
    this.wingL.add(this.wingTipLeft);
    this.riderHead.position.set(0, 2.75, -3.4);
    this.mouth.position.set(0, 2.2, -10);
    this.root.add(this.riderHead, this.mouth);
  }

  setPose(p: Partial<DragonPose>): void {
    Object.assign(this.pose, p);
    const a = Math.cos(this.pose.flapPhase) * this.pose.flapAmplitude * 0.75;
    this.wingR.rotation.z = a;
    this.wingL.rotation.z = -a;
    this.root.position.y = Math.sin(this.pose.flapPhase) * this.pose.flapAmplitude * 0.12;
  }

  getPose(): Readonly<DragonPose> {
    return this.pose;
  }

  setFirstPerson(enabled: boolean): void {
    this.riderMesh.visible = !enabled;
  }
}

function stubRigSystem(): System {
  const rig = new StubRig();
  return { name: 'dragon-model', order: UpdateOrder.Animation, init: (ctx) => ctx.services.provide('rig', rig) };
}

/* ------------------------------------------------------------------ */
/* Obstacles for collision tests                                       */
/* ------------------------------------------------------------------ */

function obstacleSystem(kind: string, flight: ScriptedFlight): System {
  let placed = false;
  let age = 0;
  return {
    name: 'camera-obstacles',
    order: UpdateOrder.World,
    // Placed after the dragon has settled into its manoeuvre (with ?man=hover it then stays next to the obstacle).
    update(dt, ctx) {
      age += dt;
      if (placed || age < 2.5) {
        return;
      }
      placed = true;
      const col = ctx.services.get('collision');
      const p = flight.object.position;
      const yaw = headingToYaw(flight.state.headingDeg);
      const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
      const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      const mat = new THREE.MeshStandardMaterial({ color: 0x8a847a, roughness: 0.85 });
      const addBox = (center: THREE.Vector3, half: THREE.Vector3): void => {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(half.x * 2, half.y * 2, half.z * 2), mat);
        mesh.position.copy(center);
        mesh.rotation.y = yaw;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        ctx.scene.add(mesh);
        col.add({ kind: 'box', center: center.clone(), halfSize: half.clone(), yaw }, 'test-obstacle');
      };
      const ground = col.groundHeight(p.x, p.z);
      if (kind === 'behind') {
        const h = p.y - ground + 60;
        addBox(p.clone().addScaledVector(fwd, -16).setY(ground + h / 2), new THREE.Vector3(10, h / 2, 3));
      } else if (kind === 'wall') {
        const h = p.y - ground + 40;
        addBox(p.clone().addScaledVector(right, -14).addScaledVector(fwd, -10).setY(ground + h / 2), new THREE.Vector3(3, h / 2, 60));
      }
    },
  };
}

/* ------------------------------------------------------------------ */
/* Test landmarks (?landmarks=1) when geo does not provide any yet     */
/* ------------------------------------------------------------------ */

interface TestLandmark {
  id: string;
  name: string;
  lat: number;
  lon: number;
  height: number;
  radius: number;
  kind: LandmarkDef['kind'];
}

/** Real coordinates/heights (Galata Tower 62.6 m + cap, Maiden's Tower ~27 m, Süleymaniye minarets 76 m). */
const TEST_LANDMARKS: TestLandmark[] = [
  { id: 'galata', name: 'Galata Kulesi', lat: 41.02564, lon: 28.97414, height: 67, radius: 12, kind: 'tower' },
  { id: 'kizkulesi', name: 'Kız Kulesi', lat: 41.02111, lon: 29.00417, height: 27, radius: 14, kind: 'tower' },
  { id: 'suleymaniye', name: 'Süleymaniye Camii', lat: 41.01611, lon: 28.96389, height: 76, radius: 70, kind: 'mosque' },
];

function testLandmarkSystem(): System {
  return {
    name: 'camera-test-landmarks',
    order: UpdateOrder.World,
    init(ctx) {
      const geo = ctx.services.tryGet('geo');
      if (!geo || geo.landmarks.length > 0) {
        return;
      }
      const col = ctx.services.get('collision');
      const stone = new THREE.MeshStandardMaterial({ color: 0xb9ad98, roughness: 0.8 });
      const roof = new THREE.MeshStandardMaterial({ color: 0x4d5a63, roughness: 0.5, metalness: 0.2 });
      const defs: LandmarkDef[] = TEST_LANDMARKS.map((l) => {
        const p = latLonToLocal(l.lat, l.lon);
        const y = Math.max(0, geo.heightAt(p.x, p.z));
        const group = new THREE.Group();
        group.position.set(p.x, y, p.z);
        if (l.kind === 'mosque') {
          const base = new THREE.Mesh(new THREE.BoxGeometry(58, 22, 58), stone);
          base.position.y = 11;
          const dome = new THREE.Mesh(new THREE.SphereGeometry(18, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), roof);
          dome.position.y = 30;
          dome.scale.y = 1.3;
          group.add(base, dome);
          for (const [dx, dz] of [[-34, -34], [34, -34], [-34, 34], [34, 34]]) {
            const minaret = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2, l.height, 12), stone);
            minaret.position.set(dx, l.height / 2, dz);
            group.add(minaret);
          }
          col.add({ kind: 'box', center: new THREE.Vector3(p.x, y + 20, p.z), halfSize: new THREE.Vector3(30, 20, 30), yaw: 0 }, 'landmark');
        } else {
          const shaft = new THREE.Mesh(new THREE.CylinderGeometry(l.radius * 0.7, l.radius * 0.75, l.height * 0.8, 24), stone);
          shaft.position.y = l.height * 0.4;
          const cap = new THREE.Mesh(new THREE.ConeGeometry(l.radius * 0.75, l.height * 0.2, 24), roof);
          cap.position.y = l.height * 0.9;
          group.add(shaft, cap);
          col.add({ kind: 'cylinder', base: new THREE.Vector3(p.x, y, p.z), radius: l.radius * 0.75, height: l.height }, 'landmark');
        }
        group.traverse((o) => {
          o.castShadow = true;
          o.receiveShadow = true;
        });
        ctx.scene.add(group);
        return {
          id: l.id, name: l.name, kind: l.kind, builder: 'structures', lat: l.lat, lon: l.lon, x: p.x, z: p.z, y,
          headingDeg: 0, radius: l.radius, height: l.height, info: '',
        };
      });
      const wrapped = Object.create(geo) as GeoQuery;
      Object.defineProperty(wrapped, 'landmarks', { value: defs });
      ctx.services.provide('geo', wrapped);
    },
  };
}

/* ------------------------------------------------------------------ */
/* HUD + automation hooks                                              */
/* ------------------------------------------------------------------ */

function hudSystem(camera: CameraSystem, flight: ScriptedFlight): System {
  let el: HTMLDivElement | null = null;
  let acc = 0;
  return {
    name: 'camera-hud',
    order: UpdateOrder.UI,
    init(ctx) {
      if (params.get('hud') === '0') {
        return;
      }
      el = document.createElement('div');
      el.style.cssText =
        'position:absolute;left:12px;top:10px;font:12px/1.45 ui-monospace,Menlo,monospace;color:#e8eef5;' +
        'background:rgba(8,12,18,0.55);padding:6px 9px;border-radius:6px;white-space:pre;pointer-events:none';
      ctx.uiRoot.appendChild(el);
    },
    update(_dt, ctx) {
      acc += ctx.time.realDt;
      if (!el || acc < 0.2) {
        return;
      }
      acc = 0;
      const d = camera.debugInfo;
      const s = flight.state;
      el.textContent =
        `cam ${d.mode}${d.blending ? ' (blend)' : ''}${d.shot ? ` · ${d.shot} “${d.shotLabel}”` : ''}\n` +
        `fov ${d.fov.toFixed(1)}°  near ${d.near.toFixed(2)}  dist ${d.distanceToDragon.toFixed(1)} m  speedFx ${d.speedEffect.toFixed(2)}\n` +
        `man ${flight.activeName}  v ${s.airspeed.toFixed(1)} m/s  agl ${s.agl.toFixed(0)} m  hdg ${s.headingDeg.toFixed(0)}°`;
    },
  };
}

function installTestApi(ctx: EngineContext, camera: CameraSystem, flight: ScriptedFlight): void {
  const canvas = ctx.canvas;
  const api = {
    camera,
    flight,
    mode: (m: CameraMode) => ctx.services.get('cameraRig').setMode(m),
    shot: (kind: ShotKind) => camera.debugForceShot(kind),
    zoom: (distance: number) => camera.debugSetZoom(distance),
    info: () => camera.debugInfo,
    maneuver: (name: string) => {
      flight.maneuver = name;
    },
    /** Simulates an RMB drag of (dx, dy) pixels spread over a few events. */
    orbit: (dx: number, dy: number, release = true) => {
      canvas.dispatchEvent(new MouseEvent('mousedown', { button: 2, bubbles: true }));
      const steps = 6;
      for (let i = 0; i < steps; i++) {
        window.dispatchEvent(new MouseEvent('mousemove', { movementX: dx / steps, movementY: dy / steps, bubbles: true }));
      }
      if (release) {
        setTimeout(() => window.dispatchEvent(new MouseEvent('mouseup', { button: 2, bubbles: true })), 50);
      }
    },
    wheel: (notches: number) => {
      for (let i = 0; i < Math.abs(notches); i++) {
        canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: Math.sign(notches) * 100, bubbles: true }));
      }
    },
    key: (code: string, ms = 120) => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
      setTimeout(() => window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true })), ms);
    },
  };
  (window as unknown as { __camtest: typeof api }).__camtest = api;
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

async function optional<T>(label: string, load: () => Promise<T>): Promise<T | null> {
  try {
    return await load();
  } catch (err) {
    console.warn(`[camera sandbox] ${label} unavailable, continuing without it`, err);
    return null;
  }
}

/** Flat sea world used by ?iso=1 (no other modules loaded, so their edits never reload the page). */
function flatGeoSystem(): System {
  const geo = {
    bounds: { minX: -24000, maxX: 24000, minZ: -24000, maxZ: 24000 },
    landmarks: [] as LandmarkDef[],
    heightAt: (): number => -20,
    normalAt: (_x: number, _z: number, out: THREE.Vector3): THREE.Vector3 => out.set(0, 1, 0),
    isWater: (): boolean => true,
    coastDistance: (): number => -1000,
  };
  return {
    name: 'geo',
    order: UpdateOrder.World,
    init(ctx) {
      // Samplers normally registered by the sky/cloud modules; without them draws fail on unbound samplers.
      const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
      white.needsUpdate = true;
      registerGlobalUniform('uCloudShadowMap', { value: white });
      const h = THREE.DataUtils.toHalfFloat;
      const lut = new THREE.DataTexture(new Uint16Array([h(0.4), h(0.5), h(0.62), h(1)]), 1, 1, THREE.RGBAFormat, THREE.HalfFloatType);
      lut.needsUpdate = true;
      registerGlobalUniform('uSkyViewLUT', { value: lut });
      ctx.services.provide('geo', geo as unknown as GeoQuery);
      const sea = new THREE.Mesh(
        new THREE.PlaneGeometry(40000, 40000).rotateX(-Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: 0x2b4452, roughness: 0.35, metalness: 0.1 }),
      );
      sea.receiveShadow = true;
      ctx.scene.add(sea, new THREE.GridHelper(20000, 400, 0x5a6d78, 0x3d4d57));
    },
  };
}

async function boot(): Promise<void> {
  const systems: System[] = [];
  const iso = params.get('iso') === '1';
  const load = <T>(label: string, loader: () => Promise<T>): Promise<T | null> => (iso ? Promise.resolve(null) : optional(label, loader));
  const post = await load('post', () => import('../src/render/post'));
  const geo = await load('geo', () => import('../src/world/geo'));
  const sky = await load('sky', () => import('../src/render/sky'));
  const terrain = await load('terrain', () => import('../src/world/terrain'));
  const water = await load('water', () => import('../src/world/water'));
  systems.push(geo ? geo.createGeoSystem() : flatGeoSystem());
  if (sky) systems.push(sky.createSkySystem());
  if (terrain) systems.push(terrain.createTerrainSystem());
  if (water) systems.push(water.createWaterSystem());
  if (params.get('world') === 'full' && !iso) {
    const city = await optional('city', () => import('../src/world/city'));
    const veg = await optional('vegetation', () => import('../src/world/vegetation'));
    const mosques = await optional('mosques', () => import('../src/world/landmarks/mosques'));
    const structures = await optional('structures', () => import('../src/world/landmarks/structures'));
    const heritage = await optional('heritage', () => import('../src/world/landmarks/heritage'));
    const clouds = await optional('clouds', () => import('../src/render/clouds'));
    if (city) systems.push(city.createCitySystem());
    if (veg) systems.push(veg.createVegetationSystem());
    if (mosques) systems.push(mosques.createMosqueSystem());
    if (structures) systems.push(structures.createStructureSystem());
    if (heritage) systems.push(heritage.createHeritageSystem());
    if (clouds) systems.push(clouds.createCloudSystem());
  }
  if (params.get('landmarks') === '1') {
    systems.push(testLandmarkSystem());
  }
  const model = params.get('rig') === 'stub' ? null : await load('dragon model', () => import('../src/dragon/model'));
  systems.push(model ? model.createDragonModelSystem() : stubRigSystem());
  const flight = new ScriptedFlight();
  systems.push(flight);
  const obstacle = params.get('obstacle');
  if (obstacle) {
    systems.push(obstacleSystem(obstacle, flight));
  }
  const camera = new CameraSystem();
  systems.push(camera, hudSystem(camera, flight));

  const engine = await startSandbox({
    pipeline: post?.createRenderPipeline,
    systems,
    basicLighting: !sky,
  });
  installTestApi(engine.ctx, camera, flight);
}

void boot();
