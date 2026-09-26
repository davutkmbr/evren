/**
 * Flight system: fixed-step 6-DOF dragon flight physics, assisted controls, ground/water locomotion and the
 * animation driver. Provides the "dragon" service (DragonState) and drives the rig pose every frame.
 */
import * as THREE from 'three';
import type { DragonRig, DragonState, EngineContext, System } from '../../core/contracts';
import { UpdateOrder } from '../../core/contracts';
import { VIEW_PRESETS } from '../../core/debug';
import { headingToYaw, yawToHeading } from '../../core/geo-coords';
import { clamp } from '../../core/math/noise';
import { BodyState } from './body';
import { DEFAULT_RIG_HEIGHT, DEFAULT_RIG_LENGTH, DEG, MAX_SUBSTEPS, PHYSICS_DT } from './params';
import { Autopilot, hasPilotInput, readPilotInput } from './pilot';
import { PoseDriver, type LookTarget } from './pose';
import { FlightSim } from './sim';
import { createTestControl, installFlightTestHook } from './test-hook';
import type { PilotCommand, SimEvent } from './types';
import { clearOverrides, clearPilotEdges, copyPilotCommand, createPilotCommand, latchPilotEdges, PILOT_EDGES } from './types';

const DEFAULT_SPAWN_SPEED = 40;
/** Seconds between roars. */
const ROAR_COOLDOWN = 2.6;

export function createFlightSystem(): System {
  const sim = new FlightSim();
  const object = new THREE.Group();
  object.name = 'dragon';
  const state: DragonState = {
    object,
    position: object.position,
    quaternion: object.quaternion,
    velocity: new THREE.Vector3(),
    angularVelocity: new THREE.Vector3(),
    mode: 'flying',
    airspeed: DEFAULT_SPAWN_SPEED,
    altitude: 0,
    agl: 0,
    headingDeg: 0,
    gForce: 1,
    stamina: 1,
    flapEffort: 0,
    firing: false,
    touchingWater: false,
    roarCooldown: 0,
    addVelocity(dx, dy, dz) {
      sim.body.velocity.x += dx;
      sim.body.velocity.y += dy;
      sim.body.velocity.z += dz;
    },
    requestRoar() {
      return ctxRef ? roar(ctxRef) : false;
    },
    fireBurst(seconds) {
      fireBurstLeft = Math.max(fireBurstLeft, seconds);
    },
  };

  const previous = new BodyState();
  const poseDriver = new PoseDriver();
  const autopilot = new Autopilot();
  const testControl = createTestControl();
  const frameCmd = createPilotCommand();
  const stepCmd = createPilotCommand();
  /** Edges seen by render frames, held until a physics substep consumes them. */
  const latch = createPilotCommand();
  const look: LookTarget = { yaw: 0, pitch: 0, weight: 0 };
  const camForward = new THREE.Vector3();
  const invQ = new THREE.Quaternion();
  let accumulator = 0;
  let rig: DragonRig | undefined;
  let ctxRef: EngineContext | null = null;
  let wasFiring = false;
  let roarCooldown = 0;
  /** Seconds of fire requested from outside (hotbar), OR-ed into the fire key. */
  let fireBurstLeft = 0;
  let splashThisFrame = false;
  /** Any substep of this frame had the belly/feet in the water while flying (continuous skim). */
  let touchedWater = false;
  let ignoreTeleport = false;
  let removeTestHook: (() => void) | null = null;
  const unsubscribe: Array<() => void> = [];

  function teleport(x: number, y: number, z: number, headingDeg: number, pitchDeg: number, speed: number): void {
    sim.teleport(x, y, z, headingToYaw(headingDeg), pitchDeg * DEG, speed);
    autopilot.reset();
    accumulator = 0;
    snapInterpolation();
  }

  function snapInterpolation(): void {
    previous.copy(sim.body);
    object.position.copy(sim.body.position);
    object.quaternion.copy(sim.body.quaternion);
    object.updateMatrixWorld();
  }

  function configureRig(r: DragonRig): void {
    const dims = r.dimensions;
    const length = dims.length > 1 ? dims.length : DEFAULT_RIG_LENGTH;
    const height = dims.height > 0.5 ? dims.height : DEFAULT_RIG_HEIGHT;
    const stand = typeof dims.standHeight === 'number' && dims.standHeight > 0.3 ? dims.standHeight : 0.5 * height;
    sim.configureRig(length, clamp(stand, 1.2, 6));
  }

  /** Roars when allowed (cooldown, not while breathing fire). Shared by the R key and DragonState.requestRoar. */
  function roar(ctx: EngineContext): boolean {
    if (roarCooldown > 0 || sim.firing || ctx.time.paused) {
      return false;
    }
    roarCooldown = ROAR_COOLDOWN;
    poseDriver.roar();
    ctx.services.tryGet('audio')?.play('roar');
    ctx.services.tryGet('cameraRig')?.shake(0.12);
    return true;
  }

  function gatherCommand(ctx: EngineContext): PilotCommand {
    if (testControl.command) {
      copyPilotCommand(testControl.command, frameCmd);
      clearPilotEdges(frameCmd);
      sim.overrides.bankTarget = testControl.overrides.bankTarget;
      sim.overrides.pathTarget = testControl.overrides.pathTarget;
      sim.overrides.airspeedTarget = testControl.overrides.airspeedTarget;
    } else {
      readPilotInput(ctx.input, frameCmd);
      clearOverrides(sim.overrides);
      if (ctx.debug.autopilot && !hasPilotInput(frameCmd)) {
        autopilot.apply(sim, frameCmd, sim.overrides);
      } else if (ctx.debug.autopilot) {
        autopilot.reset();
      }
    }
    if (fireBurstLeft > 0) {
      frameCmd.fire = true;
    }
    for (const [name, key] of Object.entries(PILOT_EDGES) as Array<[keyof typeof PILOT_EDGES, (typeof PILOT_EDGES)[keyof typeof PILOT_EDGES]]>) {
      frameCmd[key] ||= testControl.pressed[name];
      testControl.pressed[name] = false;
    }
    return frameCmd;
  }

  function dispatchEvents(ctx: EngineContext): void {
    const events = sim.events;
    if (events.length === 0) {
      return;
    }
    const fx = ctx.services.tryGet('fx');
    const cam = ctx.services.tryGet('cameraRig');
    const audio = ctx.services.tryGet('audio');
    for (let i = 0; i < events.length; i++) {
      const e: SimEvent = events[i];
      switch (e.type) {
        case 'flap':
          ctx.events.emit('flap', { strength: e.strength });
          break;
        case 'impact':
          ctx.events.emit('ground-impact', { position: e.point, speed: e.speed });
          cam?.shake(clamp(e.speed / 18, 0.05, 1.2));
          if (e.surface !== 'water') {
            fx?.dust(e.point, clamp(e.speed / 15, 0.2, 1.5));
          }
          break;
        case 'splash':
          splashThisFrame = true;
          fx?.splash(e.point, e.strength);
          ctx.events.emit('splash', { position: e.point, strength: e.strength });
          break;
        case 'dust':
          fx?.dust(e.point, e.strength);
          break;
        case 'landed':
          if (!e.water) {
            ctx.events.emit('ground-impact', { position: e.point, speed: e.speed });
            fx?.dust(e.point, clamp(0.35 + e.speed * 0.15, 0.3, 1.2));
            cam?.shake(clamp(e.speed * 0.05, 0.04, 0.5));
          } else {
            cam?.shake(clamp(e.speed * 0.04, 0.05, 0.6));
          }
          break;
        case 'maneuver':
          ctx.events.emit('maneuver', { id: e.id, label: e.label });
          break;
        case 'sound':
          audio?.play(e.name, e.volume);
          break;
        case 'shake':
          cam?.shake(e.amount);
          break;
        default:
          break;
      }
    }
    events.length = 0;
  }

  function updateLook(ctx: EngineContext): LookTarget | null {
    const cam = ctx.services.tryGet('cameraRig');
    if (!cam || cam.mode !== 'pov') {
      look.weight = Math.max(0, look.weight - 0.05);
      return look.weight > 0 ? look : null;
    }
    camForward.set(0, 0, -1).applyQuaternion(ctx.camera.quaternion);
    invQ.copy(sim.body.quaternion).invert();
    camForward.applyQuaternion(invQ);
    look.yaw = Math.atan2(-camForward.x, -camForward.z);
    look.pitch = Math.asin(clamp(camForward.y, -1, 1));
    look.weight = sim.firing ? 1 : 0.7;
    return look;
  }

  function writeTelemetry(): void {
    state.mode = sim.mode;
    state.velocity.copy(sim.body.velocity);
    state.angularVelocity.copy(sim.body.angularVelocity);
    state.airspeed = sim.airspeed;
    state.altitude = object.position.y;
    state.agl = Math.max(0, sim.agl - sim.standHeight);
    state.headingDeg = yawToHeading(sim.axes.yaw());
    state.stamina = sim.stamina;
    state.flapEffort = sim.beat.effort;
    state.firing = sim.firing;
    state.roarCooldown = roarCooldown / ROAR_COOLDOWN;
    state.touchingWater = splashThisFrame || (touchedWater && sim.airspeed > 4);
  }

  return {
    name: 'flight',
    order: UpdateOrder.Physics,

    init(ctx) {
      ctxRef = ctx;
      ctx.scene.add(object);
      sim.world.collision = ctx.services.get('collision');
      sim.world.geo = ctx.services.tryGet('geo');
      sim.world.env = ctx.services.tryGet('env');
      void ctx.services.when('geo').then((geo) => {
        sim.world.geo = geo;
      });
      void ctx.services.when('env').then((env) => {
        sim.world.env = env;
      });
      // The wave surface of the sea (flat y = 0 until the water module provides it, or when there is none).
      sim.world.water = ctx.services.tryGet('water');
      void ctx.services.when('rig').then((r) => {
        rig = r;
        configureRig(r);
        object.add(r.root);
        r.setPose(poseDriver.pose);
      });
      unsubscribe.push(
        ctx.events.on('teleport', (e) => {
          if (!ignoreTeleport) {
            teleport(e.x, e.y, e.z, e.headingDeg, e.pitchDeg, e.speed ?? DEFAULT_SPAWN_SPEED);
          }
        }),
      );
      const preset = VIEW_PRESETS[ctx.debug.view ?? 'spawn'] ?? VIEW_PRESETS.spawn;
      teleport(preset.x, preset.y, preset.z, preset.headingDeg, preset.pitchDeg, DEFAULT_SPAWN_SPEED);
      writeTelemetry();
      ctx.services.provide('dragon', state);
      // Test/diagnostics hook: dev server, sandboxes and ?flighttest=1 only.
      if (!import.meta.env.DEV && !ctx.sandbox && !ctx.debug.params.has('flighttest')) {
        return;
      }
      removeTestHook = installFlightTestHook(sim, testControl, {
        teleport,
        snap: snapInterpolation,
        pose: () => poseDriver.pose,
        snapCamera: () => {
          const p = sim.body.position;
          ignoreTeleport = true;
          ctx.events.emit('teleport', { x: p.x, y: p.y, z: p.z, headingDeg: yawToHeading(sim.axes.yaw()), pitchDeg: sim.pitch / DEG, speed: sim.airspeed });
          ignoreTeleport = false;
        },
      });
    },

    update(dt, ctx) {
      splashThisFrame = false;
      touchedWater = false;
      if (!sim.world.env) {
        sim.world.env = ctx.services.tryGet('env');
      }
      // Picks up the water service once provided (and drops it when withdrawn).
      sim.world.water = ctx.services.tryGet('water');
      if (dt > 0) {
        const cmd = gatherCommand(ctx);
        latchPilotEdges(cmd, latch);

        roarCooldown = Math.max(0, roarCooldown - dt);
        fireBurstLeft = Math.max(0, fireBurstLeft - dt);
        if (latch.roarPressed) {
          latch.roarPressed = false;
          roar(ctx);
        }

        accumulator += dt;
        let steps = 0;
        while (accumulator >= PHYSICS_DT && steps < MAX_SUBSTEPS) {
          copyPilotCommand(cmd, stepCmd);
          clearPilotEdges(stepCmd);
          latchPilotEdges(latch, stepCmd);
          stepCmd.roarPressed = false;
          clearPilotEdges(latch);
          previous.copy(sim.body);
          sim.step(PHYSICS_DT, stepCmd);
          touchedWater ||= sim.touchingWater && sim.airborne;
          accumulator -= PHYSICS_DT;
          steps++;
        }
        if (steps === MAX_SUBSTEPS) {
          accumulator = Math.min(accumulator, PHYSICS_DT);
        }
        const alpha = accumulator / PHYSICS_DT;
        object.position.lerpVectors(previous.position, sim.body.position, alpha);
        object.quaternion.slerpQuaternions(previous.quaternion, sim.body.quaternion, alpha);

        dispatchEvents(ctx);
        if (sim.firing !== wasFiring) {
          wasFiring = sim.firing;
          ctx.events.emit(sim.firing ? 'fire-start' : 'fire-stop', {});
        }
      }
      writeTelemetry();
      state.gForce += (sim.loadFactor - state.gForce) * (dt > 0 ? 1 - Math.exp(-dt / 0.12) : 0);
      if (rig) {
        rig.setPose(poseDriver.update(sim, dt, ctx.time.elapsed, updateLook(ctx), dt > 0 ? frameCmd : null));
      }
    },

    pending() {
      return 0;
    },

    dispose() {
      unsubscribe.forEach((u) => u());
      removeTestHook?.();
      removeTestHook = null;
      testControl.command = null;
      object.removeFromParent();
      if (ctxRef && sim.firing) {
        ctxRef.events.emit('fire-stop', {});
      }
    },
  };
}
