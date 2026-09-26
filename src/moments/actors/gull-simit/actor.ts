/**
 * Game side of the "gull and simit on a ferry" moment: follows the ferry the moment started at (the 'life' service),
 * drives the pure GullFlock (./flock.ts), draws the gulls (the ambient bird shader, one instanced mesh) and the simit
 * pieces (a second instanced mesh), and places the gull calls and close wing beats at the birds.
 *
 * Built when the moment starts and disposed when it is over, so it costs nothing otherwise. It takes over the ferry's
 * ambient gulls (no bird pops in) and hands them back at the end; extra gulls fly in from out of view and leave again.
 */
import * as THREE from 'three';
import type { EngineContext, VesselPose } from '../../../core/contracts';
import { RenderLayers } from '../../../core/contracts';
import { createBirdMaterial } from '../../../world/life/birds/bird-material';
import type { MomentActor } from '../types';
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

export function createGullSimitActor(ctx: EngineContext, anchorId: number | undefined): MomentActor | null {
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
    if (!audio?.playAt) {
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
      audio.playAt('gull', soundP, ev.kind === 'catch' ? 0.9 : 0.75);
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
        audio.playAt('bird-flap', soundP, Math.min(1, flock.flapAmp[best]));
      }
    }
  }

  return {
    update(dt: number, momentPlaying: boolean): void {
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
      if (playing && !momentPlaying) {
        playing = false;
      }
      if (!playing && !flock.released) {
        const near = dragon ? Math.hypot(dragonP.x - ferry.x, dragonP.z - ferry.z) < GULL_ACTOR_TUNING.lingerRadius : false;
        if (!alive || !near || pose.speed < 1 || clock > GULL_ACTOR_TUNING.maxDuration) {
          flock.release(camP);
        }
      }
      flock.update(dt, ferry, dragon ? dragonP : null, camP, water());
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
