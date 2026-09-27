/**
 * "Aya Yorgi'nin Meydan Okuması" in the scene (actor 'moments/aya-yorgi-knight-statue'): the knight statue stands on
 * the record's 'statue' waypoint in front of the monastery on Yücetepe, turned toward the dragon, and plays its three
 * animations over the lines (./pose.ts) with an armour creak at each. The head keeps following the dragon.
 *
 * Lifetime: the statue stays after the lines end until the camera is far away (it is a statue: it does not fade out
 * in view); switching the category off removes it at once. Nothing is in the scene while it is not alive.
 */
import * as THREE from 'three';
import type { EngineContext } from '../../core/contracts';
import { latLonToLocal } from '../../core/geo-coords';
import type { MomentActor } from '../actors';
import type { MomentEndReason } from '../runtime';
import type { Moment } from '../types';
import { buildKnightStatue, PLINTH_H, FIGURE_SCALE, type KnightStatue } from './statue-model';
import { CREAKS, knightPose, REST_POSE, type KnightPose } from './pose';

/** The camera this far from the statue (m) after the lines removes it. */
export const STATUE_DROP_DISTANCE = 1500;
/** Head turn toward the dragon, at most this far either side (rad), and its follow rate (1/s). */
const HEAD_MAX_YAW = 0.8;
const HEAD_RATE = 2.5;

export class AyaYorgiStatueActor implements MomentActor {
  private statue: KnightStatue | null = null;
  private t = 0;
  private playing = false;
  private nextCreak = 0;
  private headYaw = 0;
  private readonly pose: KnightPose = { ...REST_POSE };
  private readonly cam = new THREE.Vector3();
  private readonly cue = { x: 0, y: 0, z: 0 };

  get active(): boolean {
    return this.statue?.root.parent != null;
  }

  start(moment: Moment, ctx: EngineContext): void {
    const geo = ctx.services.tryGet('geo');
    const wp = moment.content.waypoints?.find((w) => w.id === 'statue');
    if (!geo || !wp) {
      return;
    }
    this.statue ??= buildKnightStatue();
    const root = this.statue.root;
    const p = latLonToLocal(wp.lat, wp.lon);
    root.position.set(p.x, geo.heightAt(p.x, p.z), p.z);
    // Face the dragon (the statue's front is +Z); from right above, face north.
    const d = ctx.services.tryGet('dragon')?.position;
    const dx = d ? d.x - p.x : 0;
    const dz = d ? d.z - p.z : -1;
    root.rotation.y = Math.hypot(dx, dz) > 2 ? Math.atan2(dx, dz) : Math.PI;
    ctx.scene.add(root);
    this.t = 0;
    this.nextCreak = 0;
    this.headYaw = 0;
    this.playing = true;
    this.apply();
  }

  end(reason: MomentEndReason): void {
    this.playing = false;
    if (reason === 'disabled') {
      this.remove();
    }
  }

  update(dt: number, ctx: EngineContext): void {
    const statue = this.statue;
    if (!statue || !this.active || !(dt > 0)) {
      return;
    }
    this.t += dt;
    knightPose(this.t, this.pose);
    const root = statue.root;
    const d = ctx.services.tryGet('dragon')?.position;
    if (d && Number.isFinite(d.x + d.z)) {
      let want = Math.atan2(d.x - root.position.x, d.z - root.position.z) - root.rotation.y;
      want = Math.atan2(Math.sin(want), Math.cos(want));
      want = Math.max(-HEAD_MAX_YAW, Math.min(HEAD_MAX_YAW, want));
      this.headYaw += (want - this.headYaw) * Math.min(1, dt * HEAD_RATE);
    }
    this.apply();
    this.creaks(ctx);
    ctx.camera.getWorldPosition(this.cam);
    if (!this.playing && Math.hypot(this.cam.x - root.position.x, this.cam.z - root.position.z) > STATUE_DROP_DISTANCE) {
      this.remove();
    }
  }

  private apply(): void {
    const s = this.statue!;
    const p = this.pose;
    s.spearArm.rotation.x = p.spear;
    s.shieldArm.rotation.z = p.shieldOut;
    s.shoulders.position.y = 1.47 + p.shrug;
    s.head.rotation.set(0, this.headYaw, p.headTilt, 'YXZ');
  }

  private creaks(ctx: EngineContext): void {
    if (this.nextCreak >= CREAKS.length || this.t < CREAKS[this.nextCreak]) {
      return;
    }
    const late = this.t - CREAKS[this.nextCreak];
    this.nextCreak++;
    if (late > 0.5) {
      return;
    }
    const root = this.statue!.root;
    this.cue.x = root.position.x;
    this.cue.y = root.position.y + PLINTH_H + FIGURE_SCALE * 1.45;
    this.cue.z = root.position.z;
    ctx.services.tryGet('audio')?.momentCue?.('knight-creak', this.cue, 0.9 + 0.2 * Math.random());
  }

  private remove(): void {
    this.statue?.root.removeFromParent();
    this.playing = false;
  }

  dispose(): void {
    this.remove();
    this.statue?.dispose();
    this.statue = null;
  }
}
