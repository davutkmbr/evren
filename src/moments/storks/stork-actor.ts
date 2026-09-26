/**
 * The stork migration moment in the scene ("Boğaz'da Leylek Göçü", actor 'moments/white-stork-flock'): spawns a kettle
 * of white storks ahead of the dragon on a real thermal (./site.ts), runs the flock simulation (./flock-sim.ts), draws
 * it with two instanced meshes (near / far LOD, one draw each) and places the flock's sparse sounds.
 *
 * Lifetime: the flock lives on after the moment's lines end: the kettle empties into the glide stream, which drifts
 * off to the south; birds beyond ~2.3–2.9 km from the camera shrink away, and the actor removes itself when nothing is
 * left to see (or after LIFE.maxSeconds). A race or switching the category off fades it out quickly. Nothing runs and
 * nothing is in the scene while no flock is alive.
 *
 * Sound (storks are silent in flight almost all the time, so the flock stays sparse): a soft open-air wind bed while
 * the flock is near, faint wing beats from flapping storks within ~45 m, an air rush when one passes within ~14 m, and
 * now and then a short bill clatter from a stork within ~220 m.
 */
import * as THREE from 'three';
import type { EngineContext, GeoQuery } from '../../core/contracts';
import { RenderLayers } from '../../core/contracts';
import type { MomentActor } from '../actors';
import type { Moment } from '../types';
import { StorkFlockSim, type DragonProbe } from './flock-sim';
import { fillStorkInstances, type StorkInstanceStats, type StorkInstanceTarget } from './stork-instances';
import { createStorkMaterial } from './stork-material';
import { buildStorkMesh, type StorkMesh } from './stork-model';
import { chooseKettleSite, liftConditions, STORK_SITE } from './site';
import { createLiftSample, sampleLift } from '../../dragon/flight/lift';

/** Flock size per quality preset (the simulation + buffers cost ~0.15–0.2 ms per frame at 400 in Node). */
export const STORK_COUNT: Record<string, number> = { low: 120, medium: 220, high: 400, ultra: 400 };

export const LIFE = {
  /** Hard cap on a flock's life (s). */
  maxSeconds: 420,
  /** Global fade-out (s) at the end of life, after a race starts or when the category is switched off. */
  fadeSeconds: 8,
  quickFadeSeconds: 3,
  /** Seconds with nothing visible before the actor removes itself. */
  emptySeconds: 2,
  /** The camera this far from the kettle (m, e.g. a teleport) removes the flock at once. */
  dropDistance: 7000,
  /** Seconds between re-centring the column on the lift field's thermal core. */
  centreEvery: 2,
} as const;

const SOUND = {
  wingRange: 45,
  passRange: 14,
  passMinSpeed: 6,
  clatterRange: 220,
  clatterEvery: [18, 45] as const,
  bedRange: 900,
};

let sharedGeometry: { near: THREE.BufferGeometry; far: THREE.BufferGeometry } | null = null;

function toGeometry(m: StorkMesh): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(m.normal, 3));
  g.setAttribute('aWing', new THREE.BufferAttribute(m.wing, 4));
  g.setAttribute('aFinger', new THREE.BufferAttribute(m.finger, 4));
  g.setIndex(new THREE.BufferAttribute(m.index, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.2);
  return g;
}

interface Lod {
  mesh: THREE.InstancedMesh;
  pose: THREE.InstancedBufferAttribute;
  target: StorkInstanceTarget;
}

export class StorkFlockActor implements MomentActor {
  private sim: StorkFlockSim | null = null;
  private near: Lod | null = null;
  private far: Lod | null = null;
  private material: THREE.MeshStandardMaterial | null = null;
  private age = 0;
  private fade = 1;
  private fadeRate = 0;
  private playing = false;
  private empty = 0;
  private centreTimer = 0;
  private clatterIn = 20;
  private bed = 0;
  private readonly dragon: DragonProbe = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
  private readonly stats: StorkInstanceStats = { near: 0, far: 0, hidden: 0, nearest: Infinity };
  private readonly lift = createLiftSample();
  private readonly cam = new THREE.Vector3();
  private readonly camRight = new THREE.Vector3();
  private readonly cue = { x: 0, y: 0, z: 0 };
  private readonly wind = new THREE.Vector3();
  private readonly defaultSun = new THREE.Vector3(-0.45, 0.72, 0.53).normalize();
  private rng = Math.random;
  /** Debug / checks: where the kettle was put and whether it sits on a real thermal. */
  lastSite: ReturnType<typeof chooseKettleSite> | null = null;

  get active(): boolean {
    return this.sim !== null;
  }

  start(_moment: Moment, ctx: EngineContext): void {
    const dragon = ctx.services.tryGet('dragon');
    const geo = ctx.services.tryGet('geo');
    if (!dragon || !geo) {
      return;
    }
    if (this.sim) {
      this.remove();
    }
    const env = ctx.services.tryGet('env');
    const weather = ctx.services.tryGet('weather')?.preset;
    if (env) {
      this.wind.copy(env.wind);
    } else {
      this.wind.set(3, 0, 1.5);
    }
    const cond = liftConditions(env?.sunDirection ?? this.defaultSun, this.wind, ctx.time.elapsed, weather === 'haze' ? 0.8 : 1);
    const p = dragon.position;
    const site = chooseKettleSite(geo, cond, p.x, p.z, dragon.altitude, dragon.headingDeg, this.rng());
    this.lastSite = site;
    const count = STORK_COUNT[ctx.quality.settings.preset] ?? 220;
    const sim = new StorkFlockSim({
      count,
      seed: (Math.random() * 1e9) | 0,
      x: site.x,
      z: site.z,
      baseY: site.baseY,
      topY: site.topY,
      courseX: site.courseX,
      courseZ: site.courseZ,
      turn: this.rng() < 0.5 ? -1 : 1,
    });
    sim.windX = this.wind.x;
    sim.windZ = this.wind.z;
    sim.updraft = Math.max(site.thermal, STORK_SITE.minUpdraft);
    sim.ground = (x, z) => geo.heightAt(x, z);
    this.sim = sim;
    this.ensureMeshes(ctx, count);
    this.age = 0;
    this.fade = 1;
    this.fadeRate = 0;
    this.empty = 0;
    this.centreTimer = LIFE.centreEvery;
    this.clatterIn = 8 + 10 * this.rng();
    this.playing = true;
    if (import.meta.env?.DEV) {
      console.info(
        `[moments] storks: ${count} birds, kettle ${site.distance} m ahead (${site.offsetDeg >= 0 ? '+' : ''}${site.offsetDeg}°), ` +
          `${Math.round(site.baseY)}–${Math.round(site.topY)} m, thermal ${site.thermal.toFixed(1)} m/s${site.real ? '' : ' (own column)'}`,
      );
    }
  }

  end(reason: 'complete' | 'race' | 'disabled'): void {
    this.playing = false;
    if (reason === 'race' || reason === 'disabled') {
      this.fadeRate = 1 / LIFE.quickFadeSeconds;
    }
  }

  private ensureMeshes(ctx: EngineContext, count: number): void {
    sharedGeometry ??= { near: toGeometry(buildStorkMesh('near')), far: toGeometry(buildStorkMesh('far')) };
    this.material ??= createStorkMaterial();
    if (!this.near || this.near.target.capacity < count) {
      this.disposeMeshes();
      const make = (geometry: THREE.BufferGeometry, name: string): Lod => {
        const g = geometry.clone();
        const poses = new Float32Array(count * 4);
        const pose = new THREE.InstancedBufferAttribute(poses, 4);
        pose.setUsage(THREE.DynamicDrawUsage);
        g.setAttribute('aPose', pose);
        const mesh = new THREE.InstancedMesh(g, this.material!, count);
        mesh.name = name;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.frustumCulled = false;
        mesh.count = 0;
        mesh.layers.set(RenderLayers.NoReflection);
        const target: StorkInstanceTarget = { matrices: mesh.instanceMatrix.array as Float32Array, poses, capacity: count, count: 0 };
        return { mesh, pose, target };
      };
      this.near = make(sharedGeometry.near, 'moment-storks-near');
      this.far = make(sharedGeometry.far, 'moment-storks-far');
    }
    ctx.scene.add(this.near.mesh, this.far!.mesh);
  }

  update(dt: number, ctx: EngineContext): void {
    const sim = this.sim;
    if (!sim || !(dt > 0)) {
      return;
    }
    this.age += dt;
    const env = ctx.services.tryGet('env');
    const geo = ctx.services.tryGet('geo');
    if (env) {
      sim.windX = env.wind.x;
      sim.windZ = env.wind.z;
    }
    // Thermal centring: storks keep re-centring on the core; the column follows the lift field's gradient.
    this.centreTimer -= dt;
    if (geo && this.centreTimer <= 0 && sim.kettleCount > 0) {
      this.centreTimer = LIFE.centreEvery;
      this.recentre(sim, geo, env?.sunDirection ?? this.defaultSun, ctx.time.elapsed);
      // The dragon glances at the kettle now and then (phase 06 attention; it filters by range and cooldown).
      ctx.events.emit('dragon-attention', { x: sim.coreX, y: (sim.baseY + sim.topY) / 2, z: sim.coreZ, kind: 'stork', strength: 0.8 });
    }
    const dragon = ctx.services.tryGet('dragon');
    let probe: DragonProbe | null = null;
    if (dragon && dragon.mode !== 'grounded' && Number.isFinite(dragon.position.x)) {
      probe = this.dragon;
      probe.x = dragon.position.x;
      probe.y = dragon.position.y;
      probe.z = dragon.position.z;
      probe.vx = dragon.velocity.x;
      probe.vy = dragon.velocity.y;
      probe.vz = dragon.velocity.z;
    }
    sim.update(dt, probe);

    // Life and fading.
    if (this.age > LIFE.maxSeconds && this.fadeRate === 0) {
      this.fadeRate = 1 / LIFE.fadeSeconds;
    }
    this.fade = Math.max(0, this.fade - this.fadeRate * dt);
    ctx.camera.getWorldPosition(this.cam);
    const near = this.near!;
    const far = this.far!;
    fillStorkInstances(sim, this.cam.x, this.cam.y, this.cam.z, this.fade, near.target, far.target, this.stats);
    for (const lod of [near, far]) {
      const n = lod.target.count;
      lod.mesh.count = n;
      lod.mesh.instanceMatrix.clearUpdateRanges();
      lod.mesh.instanceMatrix.addUpdateRange(0, n * 16);
      lod.mesh.instanceMatrix.needsUpdate = n > 0;
      lod.pose.clearUpdateRanges();
      lod.pose.addUpdateRange(0, n * 4);
      lod.pose.needsUpdate = n > 0;
    }
    this.sound(ctx, sim, dt);
    const visible = this.stats.near + this.stats.far;
    this.empty = visible === 0 ? this.empty + dt : 0;
    const coreDist = Math.hypot(sim.coreX - this.cam.x, sim.coreZ - this.cam.z);
    if (this.fade <= 0 || (this.empty > LIFE.emptySeconds && !this.playing) || coreDist > LIFE.dropDistance) {
      this.remove(ctx);
    }
  }

  private recentre(sim: StorkFlockSim, g: GeoQuery, sun: THREE.Vector3, time: number): void {
    const cond = liftConditions(sun, this.wind.set(sim.windX, 0, sim.windZ), time);
    const midY = (sim.baseY + sim.topY) / 2;
    const at = (x: number, z: number): number => {
      const ground = Math.max(0, g.heightAt(x, z));
      if (g.isWater(x, z)) {
        return -1;
      }
      sampleLift(g, x, z, midY - ground, cond, this.lift);
      return this.lift.thermal;
    };
    const c = at(sim.coreX, sim.coreZ);
    const R = 120;
    const ex = at(sim.coreX + R, sim.coreZ) - at(sim.coreX - R, sim.coreZ);
    const ez = at(sim.coreX, sim.coreZ + R) - at(sim.coreX, sim.coreZ - R);
    const gl = Math.hypot(ex, ez);
    if (gl > 0.05) {
      // At most ~1 m/s of extra drift toward the stronger lift.
      const step = Math.min(LIFE.centreEvery, gl * 8);
      sim.nudgeCore((ex / gl) * step, (ez / gl) * step);
    }
    sim.updraft = Math.max(c, STORK_SITE.minUpdraft);
  }

  private sound(ctx: EngineContext, sim: StorkFlockSim, dt: number): void {
    const audio = ctx.services.tryGet('audio');
    const nearest = this.stats.nearest;
    const bedTarget = (this.playing || nearest < SOUND.bedRange ? 1 : 0) * this.fade;
    this.bed += (bedTarget - this.bed) * Math.min(1, dt * 0.5);
    audio?.setMomentBed?.(this.bed);
    if (!audio?.momentCue || nearest > SOUND.clatterRange) {
      this.clatterIn -= dt;
      return;
    }
    const cam = this.cam;
    const e = ctx.camera.matrixWorld.elements;
    this.camRight.set(e[0], e[1], e[2]).normalize();
    let passI = -1;
    let passD = SOUND.passRange;
    let clatterI = -1;
    let clatterD = SOUND.clatterRange;
    for (let i = 0; i < sim.count; i++) {
      const dx = sim.px[i] - cam.x;
      const dy = sim.py[i] - cam.y;
      const dz = sim.pz[i] - cam.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < clatterD) {
        clatterD = d;
        clatterI = i;
      }
      if (sim.downbeat[i] && d < SOUND.wingRange) {
        this.cue.x = sim.px[i];
        this.cue.y = sim.py[i];
        this.cue.z = sim.pz[i];
        audio.momentCue('stork-wingbeat', this.cue, 0.6 + 0.6 * sim.amp[i]);
      }
      if (d < passD) {
        const rvx = sim.vx[i] - this.dragon.vx;
        const rvy = sim.vy[i] - this.dragon.vy;
        const rvz = sim.vz[i] - this.dragon.vz;
        if (rvx * rvx + rvy * rvy + rvz * rvz > SOUND.passMinSpeed * SOUND.passMinSpeed) {
          passD = d;
          passI = i;
        }
      }
    }
    if (passI >= 0) {
      this.cue.x = sim.px[passI];
      this.cue.y = sim.py[passI];
      this.cue.z = sim.pz[passI];
      const side = (sim.px[passI] - cam.x) * this.camRight.x + (sim.py[passI] - cam.y) * this.camRight.y + (sim.pz[passI] - cam.z) * this.camRight.z;
      audio.momentCue('stork-pass', this.cue, 1 - passD / SOUND.passRange + 0.3, side > 0 ? -0.5 : 0.5);
    }
    this.clatterIn -= dt;
    if (this.clatterIn <= 0) {
      const [a, b] = SOUND.clatterEvery;
      this.clatterIn = a + (b - a) * this.rng();
      if (clatterI >= 0) {
        this.cue.x = sim.px[clatterI];
        this.cue.y = sim.py[clatterI];
        this.cue.z = sim.pz[clatterI];
        audio.momentCue('stork-clatter', this.cue, 0.8 + 0.4 * this.rng());
      }
    }
  }

  private remove(ctx?: EngineContext): void {
    this.sim = null;
    this.playing = false;
    if (this.near) this.near.mesh.removeFromParent();
    if (this.far) this.far.mesh.removeFromParent();
    this.bed = 0;
    ctx?.services.tryGet('audio')?.setMomentBed?.(0);
  }

  private disposeMeshes(): void {
    for (const lod of [this.near, this.far]) {
      if (lod) {
        lod.mesh.removeFromParent();
        lod.mesh.geometry.dispose();
        lod.mesh.dispose();
      }
    }
    this.near = null;
    this.far = null;
  }

  dispose(): void {
    this.remove();
    this.disposeMeshes();
    this.material?.dispose();
    this.material = null;
  }
}
