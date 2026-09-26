/**
 * Node runtime for the pose strip: the real dragon rig (DragonRigImpl) built without a browser, a flat test ground,
 * the real FlightSim, and a frame loop that wires sim → PoseDriver → rig.setPose → rig.applyPose exactly like the
 * flight system (src/dragon/flight/index.ts) does every render frame, recording the skinning state of each frame.
 */
import * as THREE from 'three';
import { CollisionWorld } from '../../../src/core/collision';
import type { DragonState, GeoQuery } from '../../../src/core/contracts';
import { yawToHeading } from '../../../src/core/geo-coords';
import { clamp } from '../../../src/core/math/noise';
import { BodyState } from '../../../src/dragon/flight/body';
import { DEFAULT_RIG_HEIGHT, DEFAULT_RIG_LENGTH, DEG, MAX_SUBSTEPS, PHYSICS_DT } from '../../../src/dragon/flight/params';
import { PoseDriver } from '../../../src/dragon/flight/pose';
import { FlightSim } from '../../../src/dragon/flight/sim';
import type { PilotCommand, PilotEdge } from '../../../src/dragon/flight/types';
import { clearPilotEdges, copyPilotCommand, createEdgeRecord, createPilotCommand, latchPilotEdges, PILOT_EDGES } from '../../../src/dragon/flight/types';
import type { DragonRigImpl } from '../../../src/dragon/model/rig';

/* ------------------------------------------------------------------ */
/* Browser shims                                                        */
/* ------------------------------------------------------------------ */

/**
 * The rig bakes its textures on the GPU (TextureBaker) and draws the wing veins into a 2D canvas. Silhouettes need
 * geometry only, so a renderer whose calls do nothing and a canvas without a 2D context (vein-tree.ts returns the
 * blank canvas then) are enough; the geometry, skeleton and animator are the game's own.
 */
function installShims(): void {
  const g = globalThis as unknown as { document?: unknown };
  if (!g.document) {
    g.document = { createElement: () => ({ width: 0, height: 0, getContext: () => null }) };
  }
}

const nullRenderer = {
  getRenderTarget: () => null,
  setRenderTarget: () => undefined,
  render: () => undefined,
  autoClear: true,
  toneMapping: 0,
  xr: { enabled: false },
};

export async function buildRig(): Promise<DragonRigImpl> {
  installShims();
  const { DragonRigImpl } = await import('../../../src/dragon/model/rig');
  return new DragonRigImpl({ renderer: nullRenderer as unknown as THREE.WebGLRenderer, textureSize: 16 });
}

/* ------------------------------------------------------------------ */
/* Flat test ground                                                     */
/* ------------------------------------------------------------------ */

/** Height of the test ground at (x, z) (m). */
export type Terrain = (x: number, z: number) => number;

/**
 * Open land at `height` m everywhere (no water, no buildings, no thermals worth mentioning), or shaped by `terrain`
 * (an edge to drop from, a cliff to run towards).
 */
export function flatGeo(height: number, terrain?: Terrain): GeoQuery {
  const geo = {
    bounds: { minX: -20000, maxX: 20000, minZ: -20000, maxZ: 20000 },
    heightAt: terrain ?? (() => height),
    normalAt: (_x: number, _z: number, out: THREE.Vector3) => out.set(0, 1, 0),
    isWater: () => false,
    coastDistance: () => 5000,
    landUseAt: () => 0,
    densityAt: () => 0,
    districtAt: () => null,
    buildableAt: () => false,
    landmarks: [],
    landmark: () => undefined,
    roads: [],
    smallMosqueSites: [],
    coastlines: [],
    districts: [],
  };
  return geo as unknown as GeoQuery;
}

/** Open sea everywhere: a flat seabed at `seabed` m (negative), the surface at y = 0 (no water service: flat calm). */
export function seaGeo(seabed: number): GeoQuery {
  const geo = flatGeo(seabed) as unknown as Record<string, unknown>;
  geo.isWater = () => true;
  geo.coastDistance = () => -5000;
  return geo as unknown as GeoQuery;
}

/* ------------------------------------------------------------------ */
/* Frame loop                                                           */
/* ------------------------------------------------------------------ */

/** Per-frame displacement inputs of the rig's vertex shaders (animator outputs). */
export interface ShaderInputs {
  breath: number;
  billowLeft: number;
  billowRight: number;
  foldSlack: number;
  airspeed: number;
  airflow: [number, number, number];
}

export interface FrameRecord {
  /** Seconds since the scenario started. */
  time: number;
  /** bone.matrixWorld × boneInverse for every bone (16 floats each): world-space skinning matrices. */
  bones: Float32Array;
  shader: ShaderInputs;
  /** Interpolated render transform of the dragon (centre of mass). */
  position: [number, number, number];
  quaternion: [number, number, number, number];
  velocity: [number, number, number];
  mode: string;
  trick: string;
  airspeed: number;
  groundSpeed: number;
  surfaceY: number;
  agl: number;
  footClearance: number;
  /** Sea scenarios: the water surface and the seabed (the ground line is drawn at the seabed). */
  waterY?: number;
  seabedY?: number;
  pitchDeg: number;
  bankDeg: number;
  headingDeg: number;
  yaw: number;
  pose: Record<string, number>;
}

/** What a scenario script may do each render frame. */
export interface FrameInput {
  /** Held command, reset to neutral before every frame. */
  cmd: PilotCommand;
  /** One-frame presses, delivered like window.__flightTest.press (latched into the next physics substep). */
  press(edge: PilotEdge): void;
  /** Assist overrides (like __flightTest.input({ bankDeg, pathDeg, airspeed })); reset to null every frame. */
  bankDeg: number | null;
  pathDeg: number | null;
  airspeed: number | null;
}

export type FrameScript = (t: number, sim: FlightSim, input: FrameInput) => void;

export interface RunOptions {
  seconds: number;
  renderFps: number;
  script: FrameScript;
}

/** Owns the sim, the pose driver and the rig; mirrors createFlightSystem's update() without the engine. */
export class PoseRuntime {
  readonly sim = new FlightSim();
  readonly poseDriver = new PoseDriver();
  readonly object = new THREE.Group();
  private readonly previous = new BodyState();
  private readonly state: DragonState;
  private readonly boneInverses: THREE.Matrix4[];
  private readonly tmp = new THREE.Matrix4();

  /**
   * `terrain` shapes the ground (default: flat at groundY). `wind` is the mean wind (m/s at 100 m, world x / z);
   * the default is still air without gusts or thermals, so nothing but the controls moves the dragon.
   */
  constructor(
    readonly rig: DragonRigImpl,
    readonly groundY: number,
    /** Open sea with the seabed at groundY (negative) instead of flat land. */
    readonly sea = false,
    terrain?: Terrain,
    wind: readonly [number, number] | null = null,
  ) {
    const collision = new CollisionWorld();
    const geo = sea ? seaGeo(groundY) : flatGeo(groundY, terrain);
    collision.setGeo(geo);
    this.sim.world.collision = collision;
    this.sim.world.geo = geo;
    this.sim.world.env = undefined;
    this.sim.queueEvents = false;
    if (wind) {
      this.sim.wind.override = new THREE.Vector3(wind[0], 0, wind[1]);
    } else {
      // Without an environment the wind model falls back to a 4.5 m/s default wind (plus gusts): still air here.
      this.sim.wind.override = new THREE.Vector3(0, 0, 0);
      this.sim.options.turbulence = false;
      this.sim.options.thermals = false;
    }
    // configureRig() of the flight system.
    const dims = rig.dimensions;
    const length = dims.length > 1 ? dims.length : DEFAULT_RIG_LENGTH;
    const height = dims.height > 0.5 ? dims.height : DEFAULT_RIG_HEIGHT;
    const stand = typeof dims.standHeight === 'number' && dims.standHeight > 0.3 ? dims.standHeight : 0.5 * height;
    this.sim.configureRig(length, clamp(stand, 1.2, 6));
    this.object.add(rig.root);
    rig.setPose(this.poseDriver.pose);
    const object = this.object;
    const sim = this.sim;
    this.state = {
      object,
      position: object.position,
      quaternion: object.quaternion,
      velocity: new THREE.Vector3(),
      angularVelocity: new THREE.Vector3(),
      mode: 'flying',
      airspeed: 0,
      altitude: 0,
      agl: 0,
      headingDeg: 0,
      gForce: 1,
      stamina: 1,
      flapEffort: 0,
      firing: false,
      touchingWater: false,
      roarCooldown: 0,
      addVelocity: (dx, dy, dz) => {
        sim.body.velocity.x += dx;
        sim.body.velocity.y += dy;
        sim.body.velocity.z += dz;
      },
      requestRoar: () => false,
      fireBurst: () => undefined,
    };
    this.boneInverses = rig.skel.skeleton.boneInverses;
  }

  /** Level flight at (x, y, z), heading in compass degrees (the flight system's teleport). */
  teleport(x: number, y: number, z: number, headingDeg: number, speed: number, pitchDeg = 0): void {
    this.sim.teleport(x, y, z, -headingDeg * DEG, pitchDeg * DEG, speed);
    this.snap();
  }

  /** Standing on the ground at (x, z) (window.__flightTest.ground()). */
  stand(x: number, z: number, headingDeg: number): void {
    this.teleport(x, this.groundY + this.sim.standHeight + 0.5, z, headingDeg, 0);
    this.sim.placeOnGround();
    this.snap();
  }

  private snap(): void {
    this.previous.copy(this.sim.body);
    this.object.position.copy(this.sim.body.position);
    this.object.quaternion.copy(this.sim.body.quaternion);
    this.object.updateMatrixWorld(true);
  }

  /** Runs the scenario at the render frame rate and returns one record per render frame. */
  run(opts: RunOptions): FrameRecord[] {
    const { sim, poseDriver, rig, object, state } = this;
    const frameCmd = createPilotCommand();
    const stepCmd = createPilotCommand();
    const latch = createPilotCommand();
    const pressed: Record<PilotEdge, boolean> = createEdgeRecord();
    const input: FrameInput = {
      cmd: frameCmd,
      press: (edge) => {
        pressed[edge] = true;
      },
      bankDeg: null,
      pathDeg: null,
      airspeed: null,
    };
    const dt = 1 / opts.renderFps;
    const frames = Math.round(opts.seconds * opts.renderFps);
    const records: FrameRecord[] = [];
    let accumulator = 0;
    let elapsed = 0;
    records.push(this.record(0));
    for (let f = 1; f <= frames; f++) {
      const t = elapsed;
      // gatherCommand(): the test command (edges cleared), then the pressed edges for this frame.
      frameCmd.pitch = 0;
      frameCmd.roll = 0;
      frameCmd.yaw = 0;
      frameCmd.flap = false;
      frameCmd.dive = false;
      frameCmd.brake = false;
      frameCmd.fire = false;
      clearPilotEdges(frameCmd);
      input.bankDeg = null;
      input.pathDeg = null;
      input.airspeed = null;
      opts.script(t, sim, input);
      sim.overrides.bankTarget = input.bankDeg === null ? null : input.bankDeg * DEG;
      sim.overrides.pathTarget = input.pathDeg === null ? null : input.pathDeg * DEG;
      sim.overrides.airspeedTarget = input.airspeed;
      for (const [name, key] of Object.entries(PILOT_EDGES) as Array<[PilotEdge, (typeof PILOT_EDGES)[PilotEdge]]>) {
        frameCmd[key] ||= pressed[name];
        pressed[name] = false;
      }
      latchPilotEdges(frameCmd, latch);
      if (latch.roarPressed) {
        latch.roarPressed = false;
        poseDriver.roar();
      }
      accumulator += dt;
      let steps = 0;
      while (accumulator >= PHYSICS_DT && steps < MAX_SUBSTEPS) {
        copyPilotCommand(frameCmd, stepCmd);
        clearPilotEdges(stepCmd);
        latchPilotEdges(latch, stepCmd);
        stepCmd.roarPressed = false;
        clearPilotEdges(latch);
        this.previous.copy(sim.body);
        sim.step(PHYSICS_DT, stepCmd);
        accumulator -= PHYSICS_DT;
        steps++;
      }
      if (steps === MAX_SUBSTEPS) {
        accumulator = Math.min(accumulator, PHYSICS_DT);
      }
      const alpha = accumulator / PHYSICS_DT;
      object.position.lerpVectors(this.previous.position, sim.body.position, alpha);
      object.quaternion.slerpQuaternions(this.previous.quaternion, sim.body.quaternion, alpha);
      elapsed += dt;
      // writeTelemetry() (the fields the rig reads).
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
      // Flight system: pose; model system (runs after it in the same frame): animator.
      rig.setPose(poseDriver.update(sim, dt, elapsed, null, frameCmd));
      rig.applyPose(dt, state, null, null);
      object.updateMatrixWorld(true);
      records.push(this.record(elapsed));
    }
    return records;
  }

  private record(time: number): FrameRecord {
    const { sim, object } = this;
    const bonesList = this.rig.skel.bones;
    const bones = new Float32Array(bonesList.length * 16);
    for (let i = 0; i < bonesList.length; i++) {
      this.tmp.multiplyMatrices(bonesList[i].matrixWorld, this.boneInverses[i]);
      bones.set(this.tmp.elements, i * 16);
    }
    const o = (this.rig as unknown as { animator: { outputs: { breath: number; billowLeft: number; billowRight: number; foldSlack: number; airspeed: number; airflow: THREE.Vector3 } } }).animator.outputs;
    const v = sim.body.velocity;
    const euler = new THREE.Euler().setFromQuaternion(object.quaternion, 'YXZ');
    const r = (x: number, d = 1000): number => Math.round(x * d) / d;
    const pose: Record<string, number> = {};
    for (const [k, val] of Object.entries(this.rig.getPose())) {
      pose[k] = r(val);
    }
    return {
      time: r(time, 10000),
      bones,
      shader: { breath: o.breath, billowLeft: o.billowLeft, billowRight: o.billowRight, foldSlack: o.foldSlack, airspeed: o.airspeed, airflow: [o.airflow.x, o.airflow.y, o.airflow.z] },
      position: [r(object.position.x), r(object.position.y), r(object.position.z)],
      quaternion: [object.quaternion.x, object.quaternion.y, object.quaternion.z, object.quaternion.w],
      velocity: [r(v.x), r(v.y), r(v.z)],
      mode: sim.mode,
      trick: sim.maneuvers.kind,
      airspeed: r(sim.airspeed, 100),
      groundSpeed: r(Math.hypot(v.x, v.z), 100),
      surfaceY: r(sim.surfaceY),
      agl: r(sim.agl, 100),
      footClearance: r(sim.footClearance, 100),
      ...(this.sea ? { waterY: 0, seabedY: this.groundY } : {}),
      pitchDeg: r(sim.pitch / DEG, 10),
      bankDeg: r(sim.bank / DEG, 10),
      headingDeg: r(yawToHeading(sim.axes.yaw()), 10),
      yaw: euler.y,
      pose,
    };
  }
}
