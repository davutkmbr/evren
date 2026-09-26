import * as THREE from 'three';
import type { DragonPose } from '../../core/contracts';
import { VIEW_PRESETS } from '../../core/debug';
import { headingToYaw, yawToHeading } from '../../core/geo-coords';
import { DEG, PHYSICS_DT } from './params';
import type { FlightSim } from './sim';
import type { AssistOverrides, PilotCommand, PilotEdge, SimEvent, SimOptions } from './types';
import { wingtipClearance } from './wingtip';
import { clearOverrides, clearPilotEdges, createEdgeRecord, createPilotCommand, PILOT_EDGES } from './types';

export interface FlightSnapshot {
  time: number;
  mode: string;
  /** Running trick: 'none' | 'roll' | 'loop' | 'drop' | 'catch'. */
  trick: string;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  airspeed: number;
  groundSpeed: number;
  agl: number;
  footClearance: number;
  alphaDeg: number;
  betaDeg: number;
  bankDeg: number;
  pitchDeg: number;
  gammaDeg: number;
  headingDeg: number;
  loadFactor: number;
  stamina: number;
  effort: number;
  amplitude: number;
  frequency: number;
  spread: number;
  sweep: number;
  brake: number;
  legsOut: number;
  hover: number;
  attachment: number;
  lift: number;
  drag: number;
  flapForce: number;
  updraft: number;
  touchingWater: boolean;
  firing: boolean;
  tired: boolean;
  /** Lowest wingtip clearance at the bottom of the downstroke (flat-surface estimate). */
  tipClearance: number;
}

export function snapshot(sim: FlightSim): FlightSnapshot {
  const b = sim.body;
  const r = (v: number, d = 100): number => Math.round(v * d) / d;
  return {
    time: r(sim.time),
    mode: sim.mode,
    trick: sim.maneuvers.kind,
    x: r(b.position.x),
    y: r(b.position.y),
    z: r(b.position.z),
    vx: r(b.velocity.x),
    vy: r(b.velocity.y),
    vz: r(b.velocity.z),
    airspeed: r(sim.airspeed),
    groundSpeed: r(Math.hypot(b.velocity.x, b.velocity.z)),
    agl: r(sim.agl),
    footClearance: r(sim.footClearance),
    alphaDeg: r(sim.alpha / DEG),
    betaDeg: r(sim.beta / DEG),
    bankDeg: r(sim.bank / DEG),
    pitchDeg: r(sim.pitch / DEG),
    gammaDeg: r(sim.gamma / DEG),
    headingDeg: r(yawToHeading(sim.axes.yaw())),
    loadFactor: r(sim.loadFactor),
    stamina: r(sim.stamina, 1000),
    effort: r(sim.beat.effort),
    amplitude: r(sim.beat.amplitude),
    frequency: r(sim.beat.frequency),
    spread: r(sim.spread),
    sweep: r(sim.sweep),
    brake: r(sim.brake),
    legsOut: r(sim.legsOut),
    hover: r(sim.hoverBlend),
    attachment: r(sim.attachment),
    lift: Math.round(sim.lift),
    drag: Math.round(sim.drag),
    flapForce: Math.round(sim.flapForce),
    updraft: r(sim.wind.updraft),
    touchingWater: sim.touchingWater,
    firing: sim.firing,
    tired: sim.tired,
    tipClearance: r(wingtipClearance(sim.agl, sim.beat.amplitude, sim.sweep, sim.wing.span, sim.pitch, sim.bank)),
  };
}

/** Pilot input injected by tests (replaces keyboard/gamepad while `command` is set). */
export interface TestControl {
  command: PilotCommand | null;
  readonly overrides: AssistOverrides;
  /** One-frame presses (edges), e.g. 'rollRight' = a D double tap, 'drop' = a Shift double tap, 'power' = a Space double tap, 'slipLeft' = a Q double tap. */
  pressed: Record<PilotEdge, boolean>;
}

export function createTestControl(): TestControl {
  return {
    command: null,
    overrides: { bankTarget: null, pathTarget: null, airspeedTarget: null },
    pressed: createEdgeRecord(),
  };
}

type EdgeField = (typeof PILOT_EDGES)[PilotEdge];

export interface TestInput extends Partial<Omit<PilotCommand, EdgeField>> {
  bankDeg?: number | null;
  pathDeg?: number | null;
  airspeed?: number | null;
}

type SimulateScript = (t: number, sim: FlightSim, cmd: PilotCommand, overrides: AssistOverrides) => void;

export interface FlightHost {
  teleport(x: number, y: number, z: number, headingDeg: number, pitchDeg: number, speed: number): void;
  /** Snap render interpolation to the current physics state. */
  snap(): void;
  /** Last pose sent to the rig. */
  pose(): Readonly<DragonPose>;
  /** Re-broadcast the current transform as a 'teleport' event (camera snaps) without resetting the flight state. */
  snapCamera(): void;
}

function applyTestInput(control: TestControl, input: TestInput | null): void {
  if (!input) {
    control.command = null;
    clearOverrides(control.overrides);
    return;
  }
  const c = control.command ?? createPilotCommand();
  c.pitch = input.pitch ?? 0;
  c.roll = input.roll ?? 0;
  c.yaw = input.yaw ?? 0;
  c.flap = input.flap ?? false;
  c.dive = input.dive ?? false;
  c.brake = input.brake ?? false;
  c.fire = input.fire ?? false;
  control.command = c;
  control.overrides.bankTarget = input.bankDeg == null ? null : input.bankDeg * DEG;
  control.overrides.pathTarget = input.pathDeg == null ? null : input.pathDeg * DEG;
  control.overrides.airspeedTarget = input.airspeed ?? null;
}

/**
 * window.__flightTest: inject inputs in real time, read telemetry, or fast-forward the fixed-step
 * simulation synchronously (deterministic measurements, independent of the render frame rate).
 */
/** Installs window.__flightTest; returns a function that removes it again. */
export function installFlightTestHook(sim: FlightSim, control: TestControl, host: FlightHost): () => void {
  const api = {
    sim,
    input: (input: TestInput | null): void => applyTestInput(control, input),
    press: (name: PilotEdge): void => {
      control.pressed[name] = true;
    },
    state: (): FlightSnapshot => snapshot(sim),
    /** The running trick (roll / loop / drop / catch), its progress and the cheer envelope. */
    maneuver: () => ({ ...sim.maneuvers.describe(), cheer: sim.maneuvers.cheer }),
    pose: (): DragonPose => ({ ...host.pose() }),
    snapCamera: (): void => host.snapCamera(),
    options: (o?: Partial<SimOptions>): SimOptions => {
      if (o) {
        Object.assign(sim.options, o);
      }
      return { ...sim.options };
    },
    teleport: (x: number, y: number, z: number, headingDeg = 0, pitchDeg = 0, speed = 40): FlightSnapshot => {
      host.teleport(x, y, z, headingDeg, pitchDeg, speed);
      return snapshot(sim);
    },
    view: (name: string, speed = 40): FlightSnapshot | null => {
      const v = VIEW_PRESETS[name];
      if (!v) {
        return null;
      }
      host.teleport(v.x, v.y, v.z, v.headingDeg, v.pitchDeg, speed);
      return snapshot(sim);
    },
    ground: (): FlightSnapshot => {
      sim.placeOnGround();
      host.snap();
      return snapshot(sim);
    },
    /** Lands chain link number `link` now (flow's chain bursts: push, camera kick, sounds, HUD counter). */
    chainLink: (link = 3): void => sim.flow.debugLink(sim, link),
    setStamina: (value: number): void => {
      sim.stamina = Math.max(0, Math.min(1, value));
      sim.tired = false;
    },
    /** Surface probe: terrain/surface heights and water flag at x,z. */
    probe: (x: number, z: number): { terrain: number; surface: number; water: boolean } | null => {
      const col = sim.world.collision;
      if (!col) {
        return null;
      }
      const terrain = col.terrainHeight(x, z);
      const surface = col.surfaceHeight(x, z);
      return { terrain, surface, water: terrain < -0.4 && surface < 0.05 };
    },
    /** Spiral search for flat open land (no structures) or open water near x,z. */
    findSpot: (kind: 'land' | 'water', x: number, z: number, radius = 3000, clearRadius = 60): { x: number; y: number; z: number } | null => {
      const col = sim.world.collision;
      const geo = sim.world.geo;
      if (!col) {
        return null;
      }
      const n = new THREE.Vector3();
      for (let r = 0; r <= radius; r += 40) {
        const steps = Math.max(1, Math.round((2 * Math.PI * r) / 40));
        for (let i = 0; i < steps; i++) {
          const a = (i / steps) * Math.PI * 2;
          const px = x + Math.cos(a) * r;
          const pz = z + Math.sin(a) * r;
          const terrain = col.terrainHeight(px, pz);
          const surface = col.surfaceHeight(px, pz);
          if (kind === 'water') {
            let open = terrain < -8 && surface < 0.05;
            for (let k = 0; k < 8 && open; k++) {
              const b = (k / 8) * Math.PI * 2;
              open = col.terrainHeight(px + Math.cos(b) * 350, pz + Math.sin(b) * 350) < -3;
            }
            if (open) {
              return { x: px, y: 0, z: pz };
            }
            continue;
          }
          if (terrain < 2 || surface - terrain > 0.3) {
            continue;
          }
          if (geo) {
            geo.normalAt(px, pz, n);
            if (n.y < 0.985) {
              continue;
            }
          }
          // Probe the whole disc (rings every ~25 m, ~25 m apart along each ring): a building between two sparse
          // rings would otherwise sit right next to a "clear" landing spot.
          let clear = true;
          const rings = Math.max(2, Math.ceil(clearRadius / 25));
          for (let ring = 1; ring <= rings && clear; ring++) {
            const rr = (ring / rings) * clearRadius;
            const count = Math.max(8, Math.ceil((2 * Math.PI * rr) / 25));
            for (let k = 0; k < count && clear; k++) {
              const b = (k / count) * Math.PI * 2;
              const qx = px + Math.cos(b) * rr;
              const qz = pz + Math.sin(b) * rr;
              const th = col.terrainHeight(qx, qz);
              clear = col.surfaceHeight(qx, qz) - th < 0.3 && th > 0.5 && Math.abs(th - terrain) < clearRadius * 0.12;
            }
          }
          if (clear) {
            return { x: px, y: surface, z: pz };
          }
        }
      }
      return null;
    },
    /**
     * Fast-forward `seconds` of simulation synchronously. `script(t, sim, cmd, overrides)` may set the command
     * each step (it starts from the injected test command, or neutral); `until(sim)` stops early.
     * Returns periodic snapshots and event counts.
     */
    simulate: (
      seconds: number,
      script?: SimulateScript | null,
      sampleEvery = 0.5,
      until?: (sim: FlightSim) => boolean,
    ): { samples: FlightSnapshot[]; events: Record<SimEvent['type'], number>; final: FlightSnapshot } => {
      const steps = Math.round(seconds / PHYSICS_DT);
      const cmd = createPilotCommand();
      const before = { ...sim.eventCounts };
      const samples: FlightSnapshot[] = [];
      const every = Math.max(1, Math.round(sampleEvery / PHYSICS_DT));
      const savedOverrides = { ...sim.overrides };
      sim.queueEvents = false;
      try {
        for (let i = 0; i < steps; i++) {
          const base = control.command;
          cmd.pitch = base?.pitch ?? 0;
          cmd.roll = base?.roll ?? 0;
          cmd.yaw = base?.yaw ?? 0;
          cmd.flap = base?.flap ?? false;
          cmd.dive = base?.dive ?? false;
          cmd.brake = base?.brake ?? false;
          cmd.fire = base?.fire ?? false;
          clearPilotEdges(cmd);
          sim.overrides.bankTarget = control.overrides.bankTarget;
          sim.overrides.pathTarget = control.overrides.pathTarget;
          sim.overrides.airspeedTarget = control.overrides.airspeedTarget;
          script?.(i * PHYSICS_DT, sim, cmd, sim.overrides);
          sim.step(PHYSICS_DT, cmd);
          if (i % every === 0) {
            samples.push(snapshot(sim));
          }
          if (until?.(sim)) {
            break;
          }
        }
      } finally {
        sim.queueEvents = true;
        Object.assign(sim.overrides, savedOverrides);
        host.snap();
      }
      const events = { ...sim.eventCounts };
      for (const k of Object.keys(events) as Array<SimEvent['type']>) {
        events[k] -= before[k];
      }
      return { samples, events, final: snapshot(sim) };
    },
    /** Fixed wind (m/s at 100 m, world x/z) instead of the environment's; null restores the environment wind. */
    wind: (x: number | null, z = 0): void => {
      sim.wind.override = x === null ? null : new THREE.Vector3(x, 0, z);
    },
    /** Lowest wingtip clearance (m) at the bottom of the downstroke for the current state (flat-surface estimate). */
    wingtipClearance: (): number => wingtipClearance(sim.agl, sim.beat.amplitude, sim.sweep, sim.wing.span, sim.pitch, sim.bank),
    /** Assist state of the low-speed protection. */
    envelope: (): { minSpeed: number; stallSpeed: number; gammaMaxDeg: number; bankMaxDeg: number } => ({
      minSpeed: sim.controller.minSpeed,
      stallSpeed: sim.controller.stallSpeed,
      gammaMaxDeg: sim.controller.gammaMax / DEG,
      bankMaxDeg: sim.controller.bankMax / DEG,
    }),
    headingToYaw,
  };
  const holder = window as unknown as { __flightTest?: typeof api };
  holder.__flightTest = api;
  return () => {
    if (holder.__flightTest === api) {
      delete holder.__flightTest;
    }
    sim.wind.override = null;
  };
}
