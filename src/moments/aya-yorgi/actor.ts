/**
 * "Aya Yorgi'nin Meydan Okuması" in the scene (actor 'moments/aya-yorgi-knight-statue'): the knight statue is a
 * resident prop: it stands on the record's 'statue' waypoint in front of the monastery on Yücetepe whenever the camera
 * is within RESIDENT_SHOW (so it never pops up in front of the player when the moment starts), facing north down the
 * walking track. When the moment starts the figure turns toward the dragon and plays its three animations over the
 * lines (./pose.ts), with an armour creak at each; afterwards it keeps its drooping spear for the session. The head
 * follows the dragon while it is near.
 *
 * The plinth sits on the lowest ground under its footprint with a buried foundation (plinthBase), so it never hangs in
 * the air on the slope. Switching the moment's category (or moments) off removes the statue.
 */
import * as THREE from 'three';
import type { EngineContext } from '../../core/contracts';
import { latLonToLocal } from '../../core/geo-coords';
import type { MomentActor } from '../actors';
import type { MomentEndReason } from '../runtime';
import type { Moment } from '../types';
import { buildKnightStatue, plinthBase, PLINTH_H, FIGURE_SCALE, type KnightStatue } from './statue-model';
import { CREAKS, knightPose, REST_POSE, type KnightPose } from './pose';

/** The statue is in the scene while the camera is within RESIDENT_SHOW (m), and leaves beyond RESIDENT_HIDE. */
export const RESIDENT_SHOW = 2500;
export const RESIDENT_HIDE = 2800;
/** The head follows the dragon within this range (m), at most this far either side (rad), at this rate (1/s). */
const HEAD_RANGE = 400;
const HEAD_MAX_YAW = 0.8;
const HEAD_RATE = 2.5;
/** The figure turns toward the dragon at the start of the moment at this rate (1/s). */
const TURN_RATE = 1.6;
/** Resting facing: north, down the walking track (the statue's front is +Z). */
const REST_YAW = Math.PI;

export class AyaYorgiStatueActor implements MomentActor {
  private statue: KnightStatue | null = null;
  /** Seconds since the performance started (negative before it: the rest pose). */
  private t = -1;
  private performed = false;
  private playing = false;
  private nextCreak = 0;
  private headYaw = 0;
  private figureYaw = 0;
  private turnTo: number | null = null;
  private site: { x: number; z: number } | null = null;
  private readonly pose: KnightPose = { ...REST_POSE };
  private readonly cam = new THREE.Vector3();
  private readonly cue = { x: 0, y: 0, z: 0 };

  get active(): boolean {
    return this.statue?.root.parent != null;
  }

  /** Every frame while the moment is playable: show the statue near the camera, hide it far away or when disallowed. */
  resident(moment: Moment, ctx: EngineContext, allowed: boolean): void {
    if (!allowed) {
      if (!this.playing) {
        this.remove();
      }
      return;
    }
    const site = this.siteOf(moment);
    if (!site) {
      return;
    }
    ctx.camera.getWorldPosition(this.cam);
    const d = Math.hypot(this.cam.x - site.x, this.cam.z - site.z);
    if (!this.active && d < RESIDENT_SHOW) {
      this.place(moment, ctx);
    } else if (this.active && !this.playing && d > RESIDENT_HIDE) {
      this.remove();
    }
  }

  start(moment: Moment, ctx: EngineContext): void {
    if (!this.active) {
      this.place(moment, ctx);
    }
    if (!this.active) {
      return;
    }
    this.t = 0;
    this.nextCreak = 0;
    this.playing = true;
    this.performed = true;
    // The figure turns toward the dragon as it raises the spear (the first creak).
    const root = this.statue!.root;
    const d = ctx.services.tryGet('dragon')?.position;
    if (d && Math.hypot(d.x - root.position.x, d.z - root.position.z) > 2) {
      this.turnTo = wrap(Math.atan2(d.x - root.position.x, d.z - root.position.z) - root.rotation.y);
    }
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
    if (this.performed) {
      this.t += dt;
    }
    knightPose(this.t, this.pose);
    const root = statue.root;
    if (this.turnTo !== null) {
      this.figureYaw += wrap(this.turnTo - this.figureYaw) * Math.min(1, dt * TURN_RATE);
      if (Math.abs(wrap(this.turnTo - this.figureYaw)) < 0.01) {
        this.figureYaw = this.turnTo;
        this.turnTo = null;
      }
    }
    const d = ctx.services.tryGet('dragon')?.position;
    let want = 0;
    if (d && Number.isFinite(d.x + d.z) && Math.hypot(d.x - root.position.x, d.z - root.position.z) < HEAD_RANGE) {
      want = wrap(Math.atan2(d.x - root.position.x, d.z - root.position.z) - root.rotation.y - this.figureYaw);
      want = Math.max(-HEAD_MAX_YAW, Math.min(HEAD_MAX_YAW, want));
    }
    this.headYaw += (want - this.headYaw) * Math.min(1, dt * HEAD_RATE);
    this.apply();
    this.creaks(ctx);
  }

  private siteOf(moment: Moment): { x: number; z: number } | null {
    if (!this.site) {
      const wp = moment.content.waypoints?.find((w) => w.id === 'statue');
      this.site = wp ? latLonToLocal(wp.lat, wp.lon) : null;
    }
    return this.site;
  }

  private place(moment: Moment, ctx: EngineContext): void {
    const geo = ctx.services.tryGet('geo');
    const site = this.siteOf(moment);
    if (!geo || !site) {
      return;
    }
    this.statue ??= buildKnightStatue();
    const root = this.statue.root;
    root.position.set(site.x, plinthBase((x, z) => geo.heightAt(x, z), site.x, site.z).y, site.z);
    root.rotation.y = REST_YAW;
    this.headYaw = 0;
    if (!this.performed) {
      this.figureYaw = 0;
      this.turnTo = null;
    }
    ctx.scene.add(root);
    knightPose(this.t, this.pose);
    this.apply();
  }

  private apply(): void {
    const s = this.statue!;
    const p = this.pose;
    s.figure.rotation.y = this.figureYaw;
    s.spearArm.rotation.x = p.spear;
    s.shieldArm.rotation.z = p.shieldOut;
    s.shoulders.position.y = 1.47 + p.shrug;
    s.head.rotation.set(0, this.headYaw, p.headTilt, 'YXZ');
  }

  private creaks(ctx: EngineContext): void {
    if (!this.playing || this.nextCreak >= CREAKS.length || this.t < CREAKS[this.nextCreak]) {
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

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
