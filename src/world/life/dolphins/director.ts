/**
 * Runs the dolphin pods without the engine (the headless check drives it directly): rolls for a new pod every couple
 * of seconds from the spawn rate, places it within view, updates the living pods and removes the ones that left. While
 * no pod is alive, a frame costs one timer decrement (and a roll every DOLPHIN_SPAWN.checkEvery seconds).
 */
import { createRng } from '../../../core/math/noise';
import { DOLPHIN_POD, DOLPHIN_SPAWN } from './config';
import { DolphinPod, type DolphinDragon, type DolphinEnv } from './pod-sim';
import { findSpawnSite, seaWeight, spawnRate, type SpawnConditions, type SpawnSite, type SpawnWorld } from './spawn';

export interface DirectorFrame {
  dt: number;
  /** The camera and its horizontal view direction (unit). */
  camX: number;
  camY: number;
  camZ: number;
  fwdX: number;
  fwdZ: number;
  /** Camera height above the sea (m). */
  camAltitude: number;
  conditions: SpawnConditions;
  dragon: DolphinDragon | null;
}

export class DolphinDirector {
  readonly pods: DolphinPod[] = [];
  /** Multiplies the spawn rate (debug `?dolphins=often`); 0 stops new pods. */
  rateScale = 1;
  readonly stats = { rolls: 0, spawns: 0, noSite: 0, podUpdates: 0 };
  private readonly rng: () => number;
  private timer: number;
  private sinceSpawn = Infinity;

  constructor(
    seed: number,
    readonly world: SpawnWorld,
    readonly env: DolphinEnv,
  ) {
    this.rng = createRng(seed >>> 0);
    this.timer = DOLPHIN_SPAWN.checkEvery;
  }

  get active(): boolean {
    return this.pods.length > 0;
  }

  update(f: DirectorFrame): void {
    const dt = f.dt;
    if (!(dt > 0)) return;
    this.sinceSpawn += dt;
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer += DOLPHIN_SPAWN.checkEvery;
      if (this.timer <= 0) this.timer = DOLPHIN_SPAWN.checkEvery;
      this.roll(f);
    }
    if (this.pods.length === 0) return;
    // No dolphins in a storm or a rough sea: the pods dive and leave.
    const calmEnough = seaWeight(f.conditions) > 0;
    for (let i = this.pods.length - 1; i >= 0; i--) {
      const pod = this.pods[i];
      if (!calmEnough) pod.leaveNow();
      pod.update(dt, this.env, f.dragon);
      this.stats.podUpdates++;
      if (pod.done || Math.hypot(pod.cx - f.camX, pod.cz - f.camZ) > DOLPHIN_POD.dropDistance) {
        this.pods.splice(i, 1);
      }
    }
  }

  /** One spawn roll (called every DOLPHIN_SPAWN.checkEvery s). */
  private roll(f: DirectorFrame): void {
    this.stats.rolls++;
    const S = DOLPHIN_SPAWN;
    // The random number is drawn on every roll, so a run is reproducible whatever the conditions were.
    const u = this.rng();
    if (this.rateScale <= 0 || this.pods.length >= S.maxPods || this.sinceSpawn < S.minGap / Math.max(1, this.rateScale) || f.camAltitude > S.maxAltitude) {
      return;
    }
    const p = 1 - Math.exp(-spawnRate(f.conditions) * this.rateScale * S.checkEvery);
    if (u >= p) return;
    const site = findSpawnSite(this.world, f.camX, f.camZ, f.fwdX, f.fwdZ, this.rng);
    if (!site) {
      this.stats.noSite++;
      return;
    }
    this.spawn(site);
  }

  /** Adds a pod at `site` (size random within the pod range unless given). */
  spawn(site: SpawnSite, count?: number): DolphinPod {
    const S = DOLPHIN_SPAWN;
    const n = count ?? S.podMin + Math.floor(this.rng() * (S.podMax - S.podMin + 1));
    const seed = (this.rng() * 0x7fffffff) | 0;
    const pod = new DolphinPod({ count: n, x: site.x, z: site.z, hx: site.hx, hz: site.hz, rng: createRng(seed) });
    this.pods.push(pod);
    this.sinceSpawn = 0;
    this.stats.spawns++;
    return pod;
  }

  /**
   * Debug (`?dolphins=near`): a pod 70–200 m ahead of the camera on open water, ignoring the time, the weather and the
   * traffic rules (the shore and depth rules still apply). Returns null when no water is near.
   */
  spawnNear(camX: number, camZ: number, fwdX: number, fwdZ: number): DolphinPod | null {
    const w = this.world;
    const relaxed: SpawnWorld = {
      isWater: (x, z) => w.isWater(x, z),
      coastDistance: (x, z) => w.coastDistance(x, z),
      heightAt: (x, z) => w.heightAt(x, z),
      waterName: (x, z) => w.waterName?.(x, z) ?? null,
      laneDistance: () => Infinity,
      vesselDistance: () => Infinity,
      course: (x, z, out) => {
        w.course(x, z, out);
        return 0;
      },
    };
    for (const band of [
      { near: 70, far: 200, halfAngle: 0.7 },
      { near: 60, far: 400, halfAngle: Math.PI },
    ]) {
      const site = findSpawnSite(relaxed, camX, camZ, fwdX, fwdZ, this.rng, band);
      if (site) return this.spawn(site);
    }
    return null;
  }

  clear(): void {
    this.pods.length = 0;
  }
}
