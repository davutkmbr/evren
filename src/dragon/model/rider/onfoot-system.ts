/**
 * The rider off the dragon (phase 24): Z leaves the saddle (a leap off in flight, a hop down on the ground) and, back
 * beside the landed dragon, climbs on again. On foot the player's keys drive the rider: WASD relative to the camera,
 * Shift runs, Ctrl / X crouches, Space jumps, and held in the air Space spreads Hezarfen's wind wings to glide. While the
 * rider is off, the dragon gets no input (DragonState.riderless): flying, it comes down and lands; on the ground it waits.
 */
import * as THREE from 'three';
import type { DragonState, EngineContext, System } from '../../../core/contracts';
import { UpdateOrder } from '../../../core/contracts';
import type { DragonRigImpl } from '../rig';
import type { LocomotionController, LocomotionInput } from './locomotion/controller';

/** Leap off the saddle (m/s, dragon frame: +x right, +y up, -z forward), added to the dragon's velocity in flight. */
const LEAP_FLYING = new THREE.Vector3(3.2, 4.0, 0);
/** Hop down beside a dragon on the ground. */
const HOP_GROUNDED = new THREE.Vector3(4.2, 3.0, 0.3);
/** Mounting: within this horizontal distance of the dragon's saddle (m), on the ground, the dragon landed. */
const MOUNT_REACH = 5.5;
const HINT_ID = 'rider-mount';

const _v = new THREE.Vector3();
const _p = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _column = { floor: 0, ceiling: Infinity };
const _contact = { normal: new THREE.Vector3(), depth: 0, surface: '' };

export function createOnFootSystem(): System {
  let rig: DragonRigImpl | undefined;
  let hintShown = false;
  const input: LocomotionInput = { move: new THREE.Vector2(), run: false, crouch: false, jump: false, glide: false };

  /** Ground under a point: the floor of the column below it (terrain, roofs, bridges; the sea at 0). */
  function groundFn(ctx: EngineContext): (x: number, z: number) => number {
    return (x, z) => {
      const col = ctx.services.tryGet('collision');
      if (!col) {
        return 0;
      }
      const y = rig?.human?.root.position.y ?? 0;
      col.columnAt(x, z, y + 0.8, _column);
      return Number.isFinite(_column.floor) ? _column.floor : col.groundHeight(x, z);
    };
  }

  function leave(ctx: EngineContext, dragon: DragonState): void {
    if (!rig?.human) {
      return;
    }
    const grounded = dragon.mode === 'grounded' || dragon.mode === 'swimming';
    const leap = (grounded ? HOP_GROUNDED : LEAP_FLYING).clone().applyQuaternion(dragon.quaternion);
    if (!grounded) {
      leap.add(dragon.velocity);
    }
    const loco = rig.leaveSaddle(ctx.scene, leap, groundFn(ctx));
    if (!loco) {
      return;
    }
    dragon.riderless = true;
    ctx.events.emit('maneuver', { id: 'dismount', label: grounded ? 'Ejderhadan indin' : 'Eyerden atladın' });
    if (!grounded) {
      ctx.events.emit('toast', { text: 'Havada [Space]: rüzgâr kanatlarını aç, süzül' });
    }
  }

  function tryMount(ctx: EngineContext, dragon: DragonState, loco: LocomotionController): void {
    if (!rig?.human) {
      return;
    }
    const near = distanceToSaddle(dragon) < MOUNT_REACH;
    const landed = dragon.mode === 'grounded';
    const standing = loco.state === 'ground' || loco.state === 'stop';
    if (!near || !landed || !standing) {
      ctx.events.emit('toast', { text: !landed ? 'Ejderha henüz inmedi' : 'Binmek için ejderhanın yanına git', kind: 'info' });
      return;
    }
    if (rig.mountRider(1.1)) {
      dragon.riderless = false;
      ctx.events.emit('maneuver', { id: 'mount', label: 'Ejderhaya bindin' });
    }
  }

  function distanceToSaddle(dragon: DragonState): number {
    if (!rig?.human) {
      return Infinity;
    }
    rig.human.root.getWorldPosition(_p);
    dragon.object.getWorldPosition(_v);
    return Math.hypot(_p.x - _v.x, _p.z - _v.z);
  }

  return {
    name: 'rider-on-foot',
    order: UpdateOrder.Animation + 10,

    update(dt, ctx) {
      rig ??= ctx.services.tryGet('rig') as unknown as DragonRigImpl | undefined;
      const dragon = ctx.services.tryGet('dragon');
      if (!rig || !dragon || !rig.human) {
        return;
      }
      const inp = ctx.input;
      const loco = rig.onFoot;
      if (inp.enabled && inp.wasPressed('dismount')) {
        if (!loco) {
          leave(ctx, dragon);
        } else {
          tryMount(ctx, dragon, loco);
        }
      }
      const walker = rig.onFoot;
      if (!walker) {
        if (hintShown) {
          ctx.services.tryGet('hudZones')?.release(HINT_ID);
          hintShown = false;
        }
        return;
      }
      if (dt <= 0) {
        return;
      }
      // Move: W / S along the camera's heading, A / D across it (W is +pitch: undo the flight inversion setting).
      const f = inp.enabled ? inp.axis('pitch') * (inp.settings.invertPitch ? -1 : 1) : 0;
      const r = inp.enabled ? inp.axis('roll') : 0;
      ctx.camera.getWorldDirection(_fwd);
      _fwd.y = 0;
      if (_fwd.lengthSq() < 1e-6) {
        _fwd.set(Math.sin(walker.yaw), 0, Math.cos(walker.yaw));
      }
      _fwd.normalize();
      // Right of the view = forward × up.
      const rx = -_fwd.z;
      const rz = _fwd.x;
      input.move.set(_fwd.x * f + rx * r, _fwd.z * f + rz * r);
      if (input.move.lengthSq() > 1) {
        input.move.normalize();
      }
      input.run = inp.enabled && inp.isHeld('dive');
      input.crouch = inp.enabled && inp.isHeld('brake');
      input.jump = inp.enabled && inp.wasPressed('flap');
      // In the air a press of Space opens the wings (the jump's own press does not: it is spent on the take-off).
      input.glide = inp.enabled && inp.wasPressed('flap') && (walker.state === 'air' || walker.state === 'glide');
      // Gliding: W / S pitch, A / D bank, Space flaps, Ctrl / X folds the wings.
      input.flight = { pitch: f, roll: r, flap: input.jump, fold: input.crouch };
      walker.update(dt, input);
      // Walls: the body (a sphere at the waist) is pushed out of buildings sideways, and runs no further into them.
      const col = ctx.services.tryGet('collision');
      if (col) {
        const root = rig.human.root;
        _p.set(root.position.x, root.position.y + 1.0, root.position.z);
        const hit = col.resolveSphere(_p, 0.35, _contact, false);
        if (hit && hit.depth > 0 && Math.abs(hit.normal.y) < 0.7) {
          root.position.x += hit.normal.x * hit.depth;
          root.position.z += hit.normal.z * hit.depth;
          const into = walker.velocity.x * hit.normal.x + walker.velocity.y * hit.normal.z;
          if (into < 0) {
            walker.velocity.x -= into * hit.normal.x;
            walker.velocity.y -= into * hit.normal.z;
          }
        }
      }
      // Face, wind in the clothes (the air past the body: its own motion).
      const h = rig.human;
      h.root.updateMatrixWorld(true);
      const effort = THREE.MathUtils.smoothstep(walker.speed, 3.5, 5.2) * 0.55 + (walker.state === 'takeoff' || walker.state === 'land' ? 0.8 : 0) + (walker.state === 'glide' ? 0.45 : 0);
      h.face.update(dt, { effort });
      h.wind.captureRest();
      _v.set(-walker.velocity.x, -walker.vy, -walker.velocity.y);
      const sp = _v.length();
      h.wind.update(dt, sp, sp > 1e-3 ? _v.normalize() : _v.set(0, 0, 1));
      // Beside the landed dragon: the key to climb on.
      const canMount = dragon.mode === 'grounded' && (walker.state === 'ground' || walker.state === 'stop') && distanceToSaddle(dragon) < MOUNT_REACH;
      const zones = ctx.services.tryGet('hudZones');
      if (zones && canMount !== hintShown) {
        if (canMount) {
          zones.request({ id: HINT_ID, zone: 'lowerCenter', priority: 45, hints: [['Z', 'Ejderhaya bin']] });
        } else {
          zones.release(HINT_ID);
        }
        hintShown = canMount;
      }
    },
  };
}
