/**
 * Game side of the "gull and simit on a ferry" moment: follows the ferry the moment started at (the 'life' service),
 * drives the pure GullFlock (./flock.ts), draws the gulls (the ambient bird shader, one instanced mesh) and the simit
 * pieces (a second instanced mesh), and places the gull calls and close wing beats at the birds.
 *
 * Built when the moment starts (or the ferry escort begins, src/activities/escort) and disposed when it is over, so it
 * costs nothing otherwise. It takes over the ferry's ambient gulls (no bird pops in) and hands them back at the end;
 * extra gulls fly in from out of view and leave again. One scene per ferry, shared through FerryGullHold.
 */
import * as THREE from 'three';
import type { EngineContext, VesselPose } from '../../core/contracts';
import { RenderLayers } from '../../core/contracts';
import { createBirdMaterial } from '../../world/life/birds/bird-material';
import type { MomentActor } from '../actors';
import type { MomentEndReason } from '../runtime';
import type { Moment } from '../types';
import { GullFlock, GullState, PieceState, type FerryFrame, type FlockEvent, type Point3 } from './flock';
import { buildGullGeometry, buildSimitPieceGeometry } from './geometry';

export const GULL_ACTOR_TUNING = {
  /** After the lines end, the scene lingers while the dragon stays this close to the ferry (m)... */
  lingerRadius: 350,
  /** ...up to this many seconds after the start. */
  maxDuration: 150,
  /** Gull calls closer together than this are skipped (s). */
  callSpacing: 0.9,
  /** Wing beats are heard from gulls flapping within this distance of the camera (m), at most this often (s). */
  flapRadius: 24,
  flapSpacing: 0.55,
};

/** Gulls in the moment's flock for the quality's bird budget (≤ 40). */
export function gullCountFor(birdCount: number): number {
  return Math.max(18, Math.min(36, Math.round(16 + birdCount * 0.04)));
}

function frameOf(p: VesselPose, out: FerryFrame): FerryFrame {
  out.x = p.x;
  out.z = p.z;
  out.yaw = p.yaw;
  out.heave = p.heave;
  out.speed = p.speed;
  out.length = p.length;
  out.beam = p.beam;
  out.draft = p.draft;
  out.airDraft = p.airDraft;
  return out;
}

/** One running scene: follows its ferry until it has wound down (`done`). */
interface GullScene {
  update(dt: number, momentPlaying: boolean, hurry: boolean): void;
  readonly done: boolean;
  dispose(): void;
}

/** One ferry's gull scene, shared by everyone who wants those gulls (the moment and the ferry escort). */
interface SharedScene {
  scene: GullScene;
  holds: Set<FerryGullHold>;
  /** Frame the scene was last stepped in (several holders update it; it steps once per frame). */
  frame: number;
}

const SHARED = new Map<number, SharedScene>();

/**
 * A claim on the gull flock of one ferry (its anchor id). The first claim builds the scene (taking over the ferry's
 * ambient gulls), later claims on the same ferry share it, so the ferry escort (src/activities/escort) and the
 * gull-and-simit moment never borrow the same ambient flock twice. The scene plays while any holder `playing`; once
 * none does it winds down by itself (at once when every holder asks to `hurry`). Call update() every running frame
 * while `active`, and release() when done (the last release disposes the scene).
 */
export class FerryGullHold {
  /** The holder wants the gulls around the ferry. */
  playing = true;
  /** Once no holder plays: wind down at once instead of lingering near the dragon. */
  hurry = false;
  private entry: SharedScene | null = null;

  constructor(
    private readonly ctx: EngineContext,
    readonly anchorId: number,
  ) {
    this.acquire();
  }

  /** The scene exists (building it fails without the 'life' service or when the ferry is gone). */
  get active(): boolean {
    return this.entry !== null;
  }

  private acquire(): void {
    let e = SHARED.get(this.anchorId);
    if (!e) {
      const scene = createGullScene(this.ctx, this.anchorId);
      if (!scene) {
        return;
      }
      e = { scene, holds: new Set(), frame: -1 };
      SHARED.set(this.anchorId, e);
    }
    e.holds.add(this);
    this.entry = e;
  }

  update(dt: number): void {
    if (!this.entry && this.playing) {
      // The flock this holder joined was already winding down and has left: a fresh one flies in.
      this.acquire();
    }
    const e = this.entry;
    if (!e || e.frame === this.ctx.time.frame) {
      return;
    }
    e.frame = this.ctx.time.frame;
    let playing = false;
    let hurry = true;
    for (const h of e.holds) {
      playing ||= h.playing;
      hurry &&= h.hurry;
    }
    e.scene.update(dt, playing, !playing && hurry);
    if (e.scene.done) {
      e.scene.dispose();
      SHARED.delete(this.anchorId);
      for (const h of e.holds) {
        h.entry = null;
      }
    }
  }

  release(): void {
    const e = this.entry;
    if (!e) {
      return;
    }
    this.entry = null;
    e.holds.delete(this);
    if (e.holds.size === 0) {
      e.scene.dispose();
      SHARED.delete(this.anchorId);
    }
  }
}

/**
 * The scene actor of 'moments/ferry-gull-flock' (./actors.ts): builds the scene at the ferry the moment started at
 * (or joins the one the ferry escort already has there), lets it linger after the lines while the dragon stays near,
 * and removes it once it has wound down.
 */
export class GullSimitActor implements MomentActor {
  private hold: FerryGullHold | null = null;

  get active(): boolean {
    return this.hold?.active ?? false;
  }

  start(_moment: Moment, ctx: EngineContext, _forced: boolean, anchorId?: number): void {
    this.hold?.release();
    this.hold = anchorId === undefined ? null : new FerryGullHold(ctx, anchorId);
  }

  end(reason: MomentEndReason): void {
    if (!this.hold) {
      return;
    }
    this.hold.playing = false;
    // A race or the settings end it: wind down at once instead of lingering.
    this.hold.hurry = reason === 'race' || reason === 'disabled';
  }

  update(dt: number): void {
    const hold = this.hold;
    if (!hold) {
      return;
    }
    hold.update(dt);
    if (!hold.active) {
      hold.release();
      this.hold = null;
    }
  }

  dispose(): void {
    this.hold?.release();
    this.hold = null;
  }
}

function createGullScene(ctx: EngineContext, anchorId: number | undefined): GullScene | null {
  const life = ctx.services.tryGet('life');
  if (!life || anchorId === undefined) {
    return null;
  }
  const pose: VesselPose = { id: -1, kind: '', x: 0, z: 0, yaw: 0, heave: 0, speed: 0, underway: false, length: 1, beam: 1, draft: 0, airDraft: 1 };
  if (!life.vessel(anchorId, pose)) {
    return null;
  }
  const ferry = frameOf(pose, { x: 0, z: 0, yaw: 0, heave: 0, speed: 0, length: 1, beam: 1, draft: 0, airDraft: 1 });
  const flock = new GullFlock((anchorId * 7919 + Math.floor(ctx.time.elapsed * 13)) >>> 0 || 1);
  const handed = new Float32Array(6 * flock.capacity);
  const cam = new THREE.Vector3().setFromMatrixPosition(ctx.camera.matrixWorld);
  const camP: Point3 = { x: cam.x, y: cam.y, z: cam.z };
  const nHanded = life.borrowGulls?.(anchorId, handed) ?? 0;
  flock.start(ferry, pose.kind, gullCountFor(ctx.quality.settings.birdCount), handed, nHanded, camP);

  // Meshes.
  const group = new THREE.Group();
  group.name = 'moment-ferry-gulls';
  const gullGeo = buildGullGeometry();
  const flapGpu = new Float32Array(flock.capacity * 4);
  const flapAttr = new THREE.InstancedBufferAttribute(flapGpu, 4);
  flapAttr.setUsage(THREE.DynamicDrawUsage);
  gullGeo.setAttribute('aFlap', flapAttr);
  const gullMat = createBirdMaterial();
  const gulls = new THREE.InstancedMesh(gullGeo, gullMat, flock.capacity);
  gulls.name = 'moment-gulls';
  gulls.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  gulls.frustumCulled = false;
  gulls.count = 0;
  gulls.layers.set(RenderLayers.NoReflection);
  const simitGeo = buildSimitPieceGeometry();
  const simitMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0, side: THREE.DoubleSide });
  simitMat.name = 'moment-simit';
  const pieces = new THREE.InstancedMesh(simitGeo, simitMat, flock.qState.length);
  pieces.name = 'moment-simit';
  pieces.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  pieces.frustumCulled = false;
  pieces.count = 0;
  pieces.layers.set(RenderLayers.NoReflection);
  group.add(gulls, pieces);
  ctx.scene.add(group);

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler(0, 0, 0, 'YXZ');
  const p = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  const events: FlockEvent[] = [];
  const dragonP: Point3 = { x: 0, y: 0, z: 0 };
  const soundP: Point3 = { x: 0, y: 0, z: 0 };
  let lastCall = -Infinity;
  let lastFlap = -Infinity;
  let clock = 0;
  /** Seconds to the next 'dragon-attention' hint (phase 06: the dragon glances at the gulls). */
  let attentionIn = 1;
  let playing = true;
  let finished = false;
  let disposed = false;

  let surface: ((x: number, z: number) => number) | undefined;
  const water = (): ((x: number, z: number) => number) | undefined => {
    if (!surface) {
      const w = ctx.services.tryGet('water');
      surface = w ? (x, z) => w.heightAt(x, z) : undefined;
    }
    return surface;
  };

  function handBack(): void {
    const n = flock.takeCore(handed);
    life?.returnGulls?.(anchorId!, handed, n);
  }

  function draw(): void {
    let n = 0;
    for (let i = 0; i < flock.count; i++) {
      if (flock.state[i] === GullState.Gone) continue;
      e.set(flock.pitch[i], flock.yaw[i], flock.bank[i], 'YXZ');
      q.setFromEuler(e);
      p.set(flock.px[i], flock.py[i], flock.pz[i]);
      m.compose(p, q, one);
      m.toArray(gulls.instanceMatrix.array, n * 16);
      flapGpu[n * 4] = flock.flapPhase[i];
      flapGpu[n * 4 + 1] = flock.flapFreq[i];
      flapGpu[n * 4 + 2] = flock.flapAmp[i];
      flapGpu[n * 4 + 3] = 0;
      n++;
    }
    gulls.count = n;
    gulls.instanceMatrix.clearUpdateRanges();
    gulls.instanceMatrix.addUpdateRange(0, n * 16);
    gulls.instanceMatrix.needsUpdate = true;
    flapAttr.clearUpdateRanges();
    flapAttr.addUpdateRange(0, n * 4);
    flapAttr.needsUpdate = true;
    let k = 0;
    for (let j = 0; j < flock.qState.length; j++) {
      const s = flock.qState[j];
      if (s === PieceState.Free) continue;
      const spin = flock.qSpin[j];
      e.set(s === PieceState.Water ? 0 : spin, spin * 0.7, s === PieceState.Water ? 0 : spin * 0.4, 'YXZ');
      q.setFromEuler(e);
      p.set(flock.qx[j], flock.qy[j] + (s === PieceState.Water ? 0.02 : 0), flock.qz[j]);
      m.compose(p, q, one);
      m.toArray(pieces.instanceMatrix.array, k * 16);
      k++;
    }
    pieces.count = k;
    pieces.instanceMatrix.clearUpdateRanges();
    pieces.instanceMatrix.addUpdateRange(0, k * 16);
    pieces.instanceMatrix.needsUpdate = true;
  }

  function sounds(): void {
    const audio = ctx.services.tryGet('audio');
    flock.drainEvents(events);
    if (!audio?.momentCue) {
      return;
    }
    for (const ev of events) {
      if (ev.kind === 'toss') continue;
      if (ev.kind === 'catch' && Math.random() < 0.5) continue;
      if (clock - lastCall < GULL_ACTOR_TUNING.callSpacing) continue;
      lastCall = clock;
      soundP.x = flock.px[ev.index];
      soundP.y = flock.py[ev.index];
      soundP.z = flock.pz[ev.index];
      audio.momentCue('gull-call', soundP, ev.kind === 'catch' ? 0.9 : 0.75);
    }
    if (clock - lastFlap >= GULL_ACTOR_TUNING.flapSpacing) {
      let best = -1;
      let bestD = GULL_ACTOR_TUNING.flapRadius;
      for (let i = 0; i < flock.count; i++) {
        if (flock.state[i] === GullState.Gone || flock.flapAmp[i] < 0.4) continue;
        const d = Math.hypot(flock.px[i] - cam.x, flock.py[i] - cam.y, flock.pz[i] - cam.z);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      if (best >= 0) {
        lastFlap = clock;
        soundP.x = flock.px[best];
        soundP.y = flock.py[best];
        soundP.z = flock.pz[best];
        audio.momentCue('gull-wingbeat', soundP, Math.min(1, flock.flapAmp[best]));
      }
    }
  }

  return {
    update(dt: number, momentPlaying: boolean, hurry: boolean): void {
      if (disposed || finished || !(dt > 0)) {
        return;
      }
      clock += dt;
      cam.setFromMatrixPosition(ctx.camera.matrixWorld);
      camP.x = cam.x;
      camP.y = cam.y;
      camP.z = cam.z;
      const alive = life!.vessel(anchorId!, pose);
      if (alive) {
        frameOf(pose, ferry);
      }
      const dragon = ctx.services.tryGet('dragon');
      if (dragon) {
        dragonP.x = dragon.position.x;
        dragonP.y = dragon.position.y;
        dragonP.z = dragon.position.z;
      }
      if (!flock.released) {
        // Shared scenes: another holder (the ferry escort) may keep the flock playing after the moment's lines.
        playing = momentPlaying;
      }
      if (!playing && !flock.released) {
        const near = dragon ? Math.hypot(dragonP.x - ferry.x, dragonP.z - ferry.z) < GULL_ACTOR_TUNING.lingerRadius : false;
        if (hurry || !alive || !near || pose.speed < 1 || clock > GULL_ACTOR_TUNING.maxDuration) {
          flock.release(camP);
        }
      }
      flock.update(dt, ferry, dragon ? dragonP : null, camP, water());
      attentionIn -= dt;
      if (attentionIn <= 0 && flock.count > 0) {
        attentionIn = 2;
        const k = Math.floor(clock * 7) % flock.count;
        ctx.events.emit('dragon-attention', { x: flock.px[k], y: flock.py[k], z: flock.pz[k], kind: 'bird', strength: 0.8 });
      }
      draw();
      sounds();
      if (flock.done) {
        handBack();
        finished = true;
      }
    },
    get done(): boolean {
      return finished;
    },
    dispose(): void {
      if (disposed) {
        return;
      }
      if (!finished) {
        handBack();
      }
      disposed = true;
      group.removeFromParent();
      gullGeo.dispose();
      gullMat.dispose();
      simitGeo.dispose();
      simitMat.dispose();
    },
  };
}
