/**
 * The dolphins of the Bosphorus in the scene (phase 13 natural phenomena, phase 21 sea): the engine side of the pods.
 * Owned and updated by the life system; the spawn rules, the pod simulation and the instance fill are pure modules
 * (./spawn.ts, ./pod-sim.ts, ./dolphin-instances.ts) the headless check runs as they are.
 *
 * - Pods of 3–8 show now and then within view of the camera (more in the morning and on calm seas, none in a storm),
 *   on open water away from the shore, the lanes, the ferry routes and the vessels (./director.ts).
 * - Splashes and breaths use the existing systems: fx one-shot splashes (`worldSplash`), the water's foam and wave
 *   particle rings (small wake rings), and the audio's dolphin cues (recordings pending approval; the leap splash falls
 *   back to the generic water splash).
 * - The dragon glances at surfacing dolphins ('dragon-attention' kind 'dolphin'); flying low beside a pod makes it ride
 *   along, a plunge or a big splash nearby scatters it (./pod-sim.ts).
 * - The first dolphins seen up close show a quiet toast, "Yunuslar!", once per player (localStorage).
 * - Zero cost when idle: no pod alive = no meshes in the scene and one timer decrement per frame.
 *
 * Debug: `?dolphins=near` keeps a pod near the dragon (a new one a few seconds after the last left), `?dolphins=often`
 * multiplies the spawn rate by 12, `?dolphins=off` switches them off; `window.__dolphins` (dev) has `near()`,
 * `pods`, `stats`.
 */
import * as THREE from 'three';
import type { EngineContext, GeoQuery } from '../../../core/contracts';
import { RenderLayers } from '../../../core/contracts';
import { WATER_SOURCE } from '../../water/particles/config';
import type { Fleet } from '../vessels/fleet';
import type { StraitLanes } from '../vessels/routes';
import { DOLPHIN_ACCOMPANY, DOLPHIN_NOTICE, DOLPHIN_SOUND, DOLPHIN_SPAWN } from './config';
import { DolphinDirector, type DirectorFrame } from './director';
import { fillDolphinInstances, type DolphinInstanceStats, type DolphinInstanceTarget } from './dolphin-instances';
import { createDolphinMaterial } from './dolphin-material';
import { buildDolphinMesh, type DolphinMesh } from './dolphin-model';
import { LaneField, type LinePoints } from './lanes';
import { EVENT, type DolphinDragon, type DolphinEnv, type DolphinPod } from './pod-sim';
import type { SpawnWorld } from './spawn';

/** Instances per LOD (two pods of eight). */
const CAPACITY = DOLPHIN_SPAWN.maxPods * DOLPHIN_SPAWN.podMax;
const SEEN_KEY = 'evren.nature.dolphins.seen.v1';
/** "Dolphins!" — the discovery toast (player-facing, Turkish). */
export const DOLPHIN_TOAST = 'Yunuslar!';

function toGeometry(m: DolphinMesh): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.position, 3));
  g.setAttribute('aBody', new THREE.BufferAttribute(m.body, 3));
  g.setIndex(new THREE.BufferAttribute(m.index, 1));
  g.computeVertexNormals();
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 0.7);
  return g;
}

interface Lod {
  mesh: THREE.InstancedMesh;
  pose: THREE.InstancedBufferAttribute;
  target: DolphinInstanceTarget;
}

interface PodState {
  noticeIn: number;
  whistleIn: number;
}

function loadSeen(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

function saveSeen(): void {
  try {
    window.localStorage.setItem(SEEN_KEY, '1');
  } catch {
    /* storage unavailable: the toast may show again next session */
  }
}

export class Dolphins {
  readonly director: DolphinDirector;
  private lanes: LaneField;
  private readonly lanesSource: StraitLanes;
  private fleet: Fleet | null = null;
  private near: Lod | null = null;
  private far: Lod | null = null;
  private material: THREE.MeshStandardMaterial | null = null;
  private inScene = false;
  private readonly podState = new Map<DolphinPod, PodState>();
  private readonly stats: DolphinInstanceStats = { near: 0, far: 0, hidden: 0, nearest: Infinity };
  private readonly frame: DirectorFrame;
  private readonly probe: DolphinDragon = { x: 0, y: 0, z: 0, vx: 0, vz: 0, low: false, underwater: false };
  private readonly v3 = new THREE.Vector3();
  private readonly cue = { x: 0, y: 0, z: 0 };
  private readonly unsubscribe: Array<() => void> = [];
  private seen = loadSeen();
  private mode: 'normal' | 'near' | 'often' | 'off' = 'normal';
  private nearWait = 0;
  private rng = Math.random;

  constructor(
    private readonly root: THREE.Object3D,
    private readonly geo: GeoQuery,
    lanes: StraitLanes,
    private readonly ctx: EngineContext,
  ) {
    this.lanesSource = lanes;
    this.lanes = new LaneField([lanes.north, lanes.south], { xs: lanes.centre.map((p) => p.x), zs: lanes.centre.map((p) => p.z) });
    const world: SpawnWorld = {
      isWater: (x, z) => geo.isWater(x, z),
      coastDistance: (x, z) => geo.coastDistance(x, z),
      heightAt: (x, z) => geo.heightAt(x, z),
      waterName: (x, z) => geo.waterNameAt?.(x, z) ?? null,
      laneDistance: (x, z) => this.lanes.distance(x, z, 600),
      course: (x, z, out) => this.lanes.course(x, z, out),
      vesselDistance: (x, z) => this.vesselDistance(x, z),
    };
    const env: DolphinEnv = {
      surface: (x, z) => {
        const w = this.ctx.services.tryGet('water');
        return w ? w.heightAt(x, z) : 0;
      },
      coast: (x, z) => geo.coastDistance(x, z),
      course: (x, z, out) => this.lanes.course(x, z, out),
    };
    this.director = new DolphinDirector((Math.random() * 0x7fffffff) | 0, world, env);
    this.frame = {
      dt: 0,
      camX: 0,
      camY: 0,
      camZ: 0,
      fwdX: 0,
      fwdZ: 1,
      camAltitude: 0,
      conditions: { hours: 12, waveHeight: 0, windSpeed: 0, rain: 0, storm: 0, fog: 0 },
      dragon: null,
    };
    const flag = ctx.debug.params.get('dolphins');
    if (flag === 'near' || flag === 'often' || flag === 'off') this.mode = flag;
    this.director.rateScale = this.mode === 'off' ? 0 : this.mode === 'often' ? 12 : 1;
    this.unsubscribe.push(
      // A plunge, a breach or a hard water landing near a pod scatters it.
      ctx.events.on('splash', ({ position, strength }) => {
        if (!this.director.active) return;
        for (const pod of this.director.pods) pod.startle(position.x, position.z, strength);
      }),
    );
    if (import.meta.env?.DEV || ctx.sandbox || this.mode !== 'normal') {
      const handle = {
        near: () => this.spawnNear(),
        get pods() {
          return handle.director.pods;
        },
        director: this.director,
        stats: this.stats,
      };
      (window as unknown as { __dolphins?: typeof handle }).__dolphins = handle;
    }
  }

  /** The fleet was (re)built: its ferry routes join the lane field, its vessels the distance test. */
  setFleet(fleet: Fleet | null): void {
    this.fleet = fleet;
    const lines: LinePoints[] = [this.lanesSource.north, this.lanesSource.south];
    for (const service of fleet?.services ?? []) {
      for (const leg of service.legs) {
        lines.push(leg.route);
      }
    }
    const c = this.lanesSource.centre;
    this.lanes = new LaneField(lines, { xs: c.map((p) => p.x), zs: c.map((p) => p.z) });
  }

  private vesselDistance(x: number, z: number): number {
    let best = Infinity;
    for (const v of this.fleet?.vessels ?? []) {
      const d = Math.hypot(v.x - x, v.z - z) - v.model.length * 0.5;
      if (d < best) best = d;
    }
    return best;
  }

  /** Debug: a pod right ahead of the dragon (or the camera). */
  spawnNear(): DolphinPod | null {
    const f = this.frame;
    const dragon = this.ctx.services.tryGet('dragon');
    const x = dragon ? dragon.position.x : f.camX;
    const z = dragon ? dragon.position.z : f.camZ;
    let fx = f.fwdX;
    let fz = f.fwdZ;
    if (dragon) {
      const h = (dragon.headingDeg * Math.PI) / 180;
      fx = Math.sin(h);
      fz = -Math.cos(h);
    }
    const pod = this.director.spawnNear(x, z, fx, fz);
    if (pod) console.info(`[dolphins] debug pod of ${pod.count} at ${Math.round(pod.cx)}, ${Math.round(pod.cz)}`);
    else console.info('[dolphins] no open water near the dragon for a debug pod');
    return pod;
  }

  update(dt: number, camPos: THREE.Vector3): void {
    if (!(dt > 0)) return;
    const ctx = this.ctx;
    const f = this.frame;
    f.dt = dt;
    f.camX = camPos.x;
    f.camY = camPos.y;
    f.camZ = camPos.z;
    f.camAltitude = camPos.y;
    const e = ctx.camera.matrixWorld.elements;
    const hl = Math.hypot(e[8], e[10]);
    if (hl > 1e-3) {
      f.fwdX = -e[8] / hl;
      f.fwdZ = -e[10] / hl;
    }
    const water = ctx.services.tryGet('water');
    const weather = ctx.services.tryGet('weather');
    const c = f.conditions;
    c.hours = ctx.time.timeOfDay;
    c.waveHeight = water ? water.seaState.significantWaveHeight : 0;
    c.windSpeed = water ? water.seaState.windSpeed : 0;
    c.rain = weather ? weather.current.rain : 0;
    c.storm = weather ? weather.current.storm : 0;
    c.fog = weather ? weather.current.fog : 0;
    f.dragon = this.readDragon();

    if (this.mode === 'near' && !this.director.active) {
      this.nearWait -= dt;
      if (this.nearWait <= 0 && ctx.services.has('dragon')) {
        this.nearWait = 5;
        this.spawnNear();
      }
    }
    this.director.update(f);
    if (!this.director.active) {
      if (this.inScene) this.hide();
      return;
    }
    this.react(dt, camPos);
    this.draw(camPos);
  }

  private readDragon(): DolphinDragon | null {
    const d = this.ctx.services.tryGet('dragon');
    if (!d || !Number.isFinite(d.position.x)) return null;
    const p = this.probe;
    p.x = d.position.x;
    p.y = d.position.y;
    p.z = d.position.z;
    p.vx = d.velocity.x;
    p.vz = d.velocity.z;
    p.underwater = d.mode === 'underwater';
    const low = this.ctx.services.tryGet('lowFlight');
    const lowOver = low ? low.active && low.height < DOLPHIN_ACCOMPANY.maxHeight : d.agl < DOLPHIN_ACCOMPANY.maxHeight && this.geo.isWater(p.x, p.z);
    p.low = d.mode === 'swimming' || (d.mode !== 'grounded' && d.mode !== 'underwater' && lowOver);
    return p;
  }

  /** Splashes, rings, sounds, the dragon's glances and the discovery toast from this frame's pod events. */
  private react(dt: number, camPos: THREE.Vector3): void {
    const ctx = this.ctx;
    const fx = ctx.services.tryGet('fx');
    const water = ctx.services.tryGet('water');
    const audio = ctx.services.tryGet('audio');
    const dragon = this.frame.dragon;
    for (const [pod] of this.podState) {
      if (!this.director.pods.includes(pod)) this.podState.delete(pod);
    }
    for (const pod of this.director.pods) {
      let st = this.podState.get(pod);
      if (!st) {
        st = { noticeIn: 0, whistleIn: 2 + 4 * this.rng() };
        this.podState.set(pod, st);
      }
      st.noticeIn -= dt;
      for (let k = 0; k < pod.eventCount; k++) {
        const kind = pod.eventKind[k];
        const x = pod.eventX[k];
        const y = pod.eventY[k];
        const z = pod.eventZ[k];
        const s = pod.eventStrength[k];
        const d = Math.hypot(x - camPos.x, y - camPos.y, z - camPos.z);
        this.v3.set(x, y, z);
        this.cue.x = x;
        this.cue.y = y;
        this.cue.z = z;
        if (kind === EVENT.splash) {
          if (d < 1200) {
            fx?.worldSplash?.(this.v3, s);
            water?.foam?.splash(x, z, s * 0.6);
            water?.dynamic?.ring(WATER_SOURCE.splash, x, z, Math.min(0.2, 0.09 * s), 1.6 + 1.2 * s);
          }
          if (s >= 0.4 && d < DOLPHIN_SOUND.splashRange) audio?.dolphinCue?.('splash', this.cue, s);
        } else {
          // A breath or a leap's exit: a puff of spray and a small ring where the back breaks the surface.
          if (d < 900) {
            fx?.worldSplash?.(this.v3, kind === EVENT.leap ? 0.3 : 0.1);
            water?.dynamic?.ring(WATER_SOURCE.splash, x, z, kind === EVENT.leap ? 0.06 : 0.025, 1.4);
          }
          if (d < DOLPHIN_SOUND.breathRange) audio?.dolphinCue?.('breath', this.cue, 1 - (0.6 * d) / DOLPHIN_SOUND.breathRange);
          if (dragon && st.noticeIn <= 0 && Math.hypot(x - dragon.x, z - dragon.z) < DOLPHIN_NOTICE.gazeRange) {
            st.noticeIn = DOLPHIN_NOTICE.every;
            ctx.events.emit('dragon-attention', { x, y: y + 0.5, z, kind: 'dolphin', strength: kind === EVENT.leap ? 0.95 : 0.7 });
          }
          if (!this.seen && d < DOLPHIN_NOTICE.discoverRange && !ctx.services.tryGet('dragon')?.racing) {
            this.seen = true;
            saveSeen();
            ctx.events.emit('toast', { text: DOLPHIN_TOAST });
          }
        }
      }
      // Whistles now and then while the pod is near (faint above the water).
      st.whistleIn -= dt;
      if (st.whistleIn <= 0) {
        const [a, b] = pod.mode === 'accompany' ? DOLPHIN_SOUND.whistleEveryAccompany : DOLPHIN_SOUND.whistleEvery;
        st.whistleIn = a + (b - a) * this.rng();
        const i = Math.floor(this.rng() * pod.count);
        const d = Math.hypot(pod.px[i] - camPos.x, pod.py[i] - camPos.y, pod.pz[i] - camPos.z);
        if (d < DOLPHIN_SOUND.whistleRange && pod.mode !== 'leave') {
          this.cue.x = pod.px[i];
          this.cue.y = pod.py[i];
          this.cue.z = pod.pz[i];
          audio?.dolphinCue?.('whistle', this.cue, 0.7 + 0.3 * this.rng());
        }
      }
    }
  }

  private ensureMeshes(): void {
    if (this.near) return;
    this.material ??= createDolphinMaterial();
    const make = (m: DolphinMesh, name: string): Lod => {
      const g = toGeometry(m);
      const poses = new Float32Array(CAPACITY * 4);
      const pose = new THREE.InstancedBufferAttribute(poses, 4);
      pose.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('aPose', pose);
      const mesh = new THREE.InstancedMesh(g, this.material!, CAPACITY);
      mesh.name = name;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.layers.set(RenderLayers.NoReflection);
      return { mesh, pose, target: { matrices: mesh.instanceMatrix.array as Float32Array, poses, capacity: CAPACITY, count: 0 } };
    };
    this.near = make(buildDolphinMesh('near'), 'life-dolphins-near');
    this.far = make(buildDolphinMesh('far'), 'life-dolphins-far');
  }

  private draw(camPos: THREE.Vector3): void {
    this.ensureMeshes();
    const near = this.near!;
    const far = this.far!;
    if (!this.inScene) {
      this.root.add(near.mesh, far.mesh);
      this.inScene = true;
    }
    const under = this.ctx.services.tryGet('underwater')?.under ?? false;
    fillDolphinInstances(this.director.pods, camPos.x, camPos.y, camPos.z, under, near.target, far.target, this.stats);
    for (const lod of [near, far]) {
      const n = lod.target.count;
      lod.mesh.count = n;
      lod.mesh.visible = n > 0;
      lod.mesh.instanceMatrix.clearUpdateRanges();
      lod.mesh.instanceMatrix.addUpdateRange(0, n * 16);
      lod.mesh.instanceMatrix.needsUpdate = n > 0;
      lod.pose.clearUpdateRanges();
      lod.pose.addUpdateRange(0, n * 4);
      lod.pose.needsUpdate = n > 0;
    }
  }

  private hide(): void {
    this.near?.mesh.removeFromParent();
    this.far?.mesh.removeFromParent();
    this.inScene = false;
    this.podState.clear();
  }

  /** Whether any mesh is in the scene (checks: zero cost when idle). */
  get drawing(): boolean {
    return this.inScene;
  }

  dispose(): void {
    for (const u of this.unsubscribe) u();
    this.unsubscribe.length = 0;
    this.hide();
    for (const lod of [this.near, this.far]) {
      if (lod) {
        lod.mesh.geometry.dispose();
        lod.mesh.dispose();
      }
    }
    this.near = null;
    this.far = null;
    this.material?.dispose();
    this.material = null;
    this.director.clear();
    const w = window as unknown as { __dolphins?: { director: DolphinDirector } };
    if (w.__dolphins?.director === this.director) delete w.__dolphins;
  }
}
