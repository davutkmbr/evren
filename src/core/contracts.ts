/**
 * Cross-module contracts. Every module talks to the others ONLY through these types
 * (via `ctx.services`, `ctx.events`, `globalUniforms` and the shared GLSL chunks).
 *
 * World conventions
 * - Units: meters, seconds, kilograms, radians (degrees only where named `...Deg`).
 * - Three.js is Y-up. +X = east, -Z = north, +Z = south. Sea level is y = 0.
 * - Local frame origin = WORLD_ORIGIN (see geo-coords.ts). Use latLonToLocal() for real coordinates.
 * - Object-local forward is -Z, up is +Y, right is +X (same as THREE.Camera).
 * - Headings: `headingDeg` 0 = north, 90 = east (clockwise, compass style).
 */
import type * as THREE from 'three';
import type { Input } from './input';
import type { QualityManager } from './quality';
import type { EventBus } from './events';
import type { ServiceRegistry } from './services';

/* ------------------------------------------------------------------ */
/* Engine & systems                                                    */
/* ------------------------------------------------------------------ */

export interface TimeState {
  /** Seconds since start (simulation time, stops while paused). */
  elapsed: number;
  /** Clamped frame delta in seconds (0 while paused). */
  dt: number;
  /** Real (unpaused, unscaled) frame delta in seconds. */
  realDt: number;
  frame: number;
  /** Local Istanbul time of day in hours [0, 24). Owned by the sky system, others read. */
  timeOfDay: number;
  /** Game-minutes advanced per real second; 0 freezes the sun. */
  dayTimeScale: number;
  /** Day of year 1..365 (used for sun declination). */
  dayOfYear: number;
  paused: boolean;
  /**
   * Shortest frame interval reachable whatever the load (ms): the display refresh interval (smallest rAF interval
   * seen), or the ?fps cap rounded up to whole refresh intervals. Frame pacing below this is not a slowdown.
   */
  paceFloorMs: number;
}

export interface EngineContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  /** The single render camera. Only the camera system moves it. */
  camera: THREE.PerspectiveCamera;
  canvas: HTMLCanvasElement;
  /** DOM overlay root for HUD/menus (pointer-events: none by default; enable per element). */
  uiRoot: HTMLElement;
  input: Input;
  quality: QualityManager;
  time: TimeState;
  events: EventBus<GameEvents>;
  services: ServiceRegistry;
  pipeline: RenderPipeline;
  /** Parsed URL/debug flags. */
  debug: DebugFlags;
  /** True inside sandbox pages (module test harnesses). */
  sandbox: boolean;
}

/**
 * Object layers. The main camera sees Default + NoReflection; the water's planar reflection camera sees
 * Default + ReflectionOnly. Put small/numerous detail (trees, particles, street props, tiny boats) on NoReflection via
 * `object.layers.set(RenderLayers.NoReflection)`. ReflectionOnly holds cheap stand-ins drawn only into the mirror
 * image (far building proxies), ShadowOnly holds stand-ins seen only by the shadow cameras. Shadow cameras must enable
 * all layers (sky does this).
 */
export const RenderLayers = {
  Default: 0,
  NoReflection: 1,
  ReflectionOnly: 2,
  ShadowOnly: 5,
} as const;

/** Update ordering buckets. Lower runs first. */
export const UpdateOrder = {
  Input: 0,
  Physics: 100,
  Animation: 200,
  Camera: 300,
  Environment: 400,
  World: 500,
  Effects: 600,
  Audio: 700,
  UI: 800,
} as const;

export interface System {
  readonly name: string;
  /** Update ordering (see UpdateOrder). */
  readonly order: number;
  /** Called once, in registration order. May be async (e.g. waiting for workers). */
  init?(ctx: EngineContext): void | Promise<void>;
  /** Called every frame with the clamped simulation dt (0 when paused). */
  update?(dt: number, ctx: EngineContext): void;
  /** Called right before rendering, after the camera has its final transform for the frame. */
  preRender?(ctx: EngineContext): void;
  /** Number of outstanding async jobs (streaming/generation). Screenshot tooling waits for 0. */
  pending?(): number;
  onResize?(width: number, height: number, ctx: EngineContext): void;
  dispose?(): void;
}

export type SystemFactory = () => System;

/* ------------------------------------------------------------------ */
/* Render pipeline (owned by render/post)                              */
/* ------------------------------------------------------------------ */

export interface HdrPassInputs {
  /** Linear HDR scene color. */
  color: THREE.Texture;
  /** Scene depth. REVERSED-Z, float: 1 = near plane, 0 = far/sky. Use linearDepth() from SHARED_GLSL. */
  depth: THREE.DepthTexture;
}

/**
 * A full-screen pass operating in linear HDR before tone mapping (clouds, volumetrics...).
 * It must write the COMPLETE image into `output` (copy + composite); inputs and output are distinct targets.
 */
export interface HdrPass {
  readonly name: string;
  /** Lower runs first. Reserved ranges: clouds 100, transparent effects 150–199. */
  readonly order: number;
  enabled: boolean;
  render(renderer: THREE.WebGLRenderer, inputs: HdrPassInputs, output: THREE.WebGLRenderTarget, ctx: EngineContext): void;
  setSize?(width: number, height: number): void;
}

export interface RenderPipeline {
  render(ctx: EngineContext): void;
  addHdrPass(pass: HdrPass): void;
  removeHdrPass(pass: HdrPass): void;
  setSize(width: number, height: number, pixelRatio: number): void;
  /** Current internal render scale (dynamic resolution), 1 = native. */
  readonly renderScale: number;
  /** Dynamic resolution debug state (window.__evren.stats().dynres), when the pipeline has one. */
  readonly renderScaleStats?: object;
  /** Exposure multiplier currently applied (auto exposure). */
  readonly exposure: number;
  /** Screen-space radial speed effect strength 0..1 (set by camera/flight). */
  speedEffect: number;
  dispose(): void;
}

export type PipelineFactory = (ctx: EngineContext) => RenderPipeline;

/* ------------------------------------------------------------------ */
/* Geography (owned by world/geo) — service key: 'geo'                 */
/* ------------------------------------------------------------------ */

export enum LandUse {
  Water = 0,
  Beach = 1,
  Urban = 2,
  HistoricUrban = 3,
  Highrise = 4,
  Industrial = 5,
  Park = 6,
  Forest = 7,
  Farmland = 8,
  Airport = 9,
  Cemetery = 10,
  Landmark = 11,
  Road = 12,
  Suburban = 13,
}

export type DistrictStyle = 'historic' | 'dense' | 'modern' | 'highrise' | 'villa' | 'yali' | 'industrial' | 'suburban';

export interface District {
  id: string;
  /** Turkish display name, e.g. "Beyoğlu". */
  name: string;
  side: 'europe' | 'asia' | 'island';
  x: number;
  z: number;
  style: DistrictStyle;
  /** Building density 0..1. */
  density: number;
  /** Typical number of floors. */
  floorsMean: number;
  floorsMax: number;
}

/** Module that builds a landmark. 'districts' = hero spots of detailed districts (src/world/landmarks/districts/<district>/). */
export type LandmarkBuilder = 'mosques' | 'structures' | 'heritage' | 'districts';

export type LandmarkKind =
  | 'mosque'
  | 'bridge'
  | 'tower'
  | 'palace'
  | 'fortress'
  | 'walls'
  | 'station'
  | 'skyscraper'
  | 'monument'
  | 'barracks'
  | 'other';

export type LandmarkFootprint = 'pad' | 'cluster' | 'line' | 'polygon' | 'slope' | 'none';

export interface Vec2Like {
  x: number;
  z: number;
}

export interface LandmarkDef {
  /** Stable id (see brief for the canonical list). */
  id: string;
  /** Turkish name shown in UI, e.g. "Ayasofya-i Kebir Camii". */
  name: string;
  kind: LandmarkKind;
  builder: LandmarkBuilder;
  lat: number;
  lon: number;
  /** Local position (meters). */
  x: number;
  z: number;
  /** Ground elevation at the site (m). Geo flattens a pad of `radius` here. */
  y: number;
  /** Orientation of the main axis, compass degrees (0 = north). Mosques: qibla direction (~151°). */
  headingDeg: number;
  /** Footprint radius (m) reserved from procedural city. */
  radius: number;
  /** Approximate real height (m) of the tallest element. */
  height: number;
  /** Extra key points in local meters (bridge tower bases, wall polyline, cluster tower spots...). */
  anchors?: Vec2Like[];
  /** How the site claims its ground (geo/types.ts LandmarkData.footprint); default 'pad'. */
  footprint?: LandmarkFootprint;
  /** Corridor half width ('line') or per-anchor pad radius ('cluster'), m. */
  footprintWidth?: number;
  /** Full width (m) of the modelled body of a 'line' landmark (aqueduct piers); OSM buildings touching it are dropped. */
  bodyWidth?: number;
  /**
   * Full extent radius (m) of extended landmarks (bridges, walls, aqueduct, tower clusters).
   * `radius` is only the small pad reserved from the procedural city.
   */
  extent?: number;
  /** One or two sentence Turkish info text for the discovery UI. */
  info: string;
  /** Year built (for UI), negative for BCE. */
  year?: number;
}

export type RoadKind = 'highway' | 'avenue' | 'street' | 'bridge' | 'coastal';

export interface RoadDef {
  id: string;
  name?: string;
  kind: RoadKind;
  /** Carriageway width in meters. */
  width: number;
  points: Vec2Like[];
}

export interface GridData<T extends Float32Array | Uint8Array> {
  data: T;
  width: number;
  height: number;
  /** Meters per cell. */
  cellSize: number;
  /** World x/z of cell (0,0) center. Row-major: index = row * width + col, row grows toward +Z (south). */
  originX: number;
  originZ: number;
}

export interface WorldBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface GeoQuery {
  readonly bounds: WorldBounds;
  /** Terrain elevation in meters; negative values are sea floor. Bilinear, O(1). */
  heightAt(x: number, z: number): number;
  normalAt(x: number, z: number, out: THREE.Vector3): THREE.Vector3;
  isWater(x: number, z: number): boolean;
  /** Signed distance to the coastline in meters: positive on land, negative over water. */
  coastDistance(x: number, z: number): number;
  landUseAt(x: number, z: number): LandUse;
  /** Urban building density 0..1 (0 in water/forest/park/landmark pads). */
  densityAt(x: number, z: number): number;
  districtAt(x: number, z: number): District | null;
  /** True where procedural buildings may be placed. */
  buildableAt(x: number, z: number): boolean;
  readonly landmarks: readonly LandmarkDef[];
  landmark(id: string): LandmarkDef | undefined;
  readonly roads: readonly RoadDef[];
  /**
   * Deterministic sites for procedural neighborhood mosques (built by the mosques module).
   * Geo reserves each pad (buildableAt() = false within `radius`). `size`: 0 small masjid .. 1 large mosque.
   */
  readonly smallMosqueSites: readonly { x: number; z: number; y: number; radius: number; size: number; headingDeg: number }[];
  /** Closed land polygons (outer rings, counter-clockwise when viewed from above). */
  readonly coastlines: readonly Vec2Like[][];
  readonly districts: readonly District[];
  readonly heightGrid: GridData<Float32Array>;
  readonly landUseGrid: GridData<Uint8Array>;
  /** Float heights (R32F, LinearFilter). Same layout as heightGrid. Created lazily, shared. */
  getHeightTexture(): THREE.DataTexture;
  /** LandUse ids (R8, NearestFilter, value = LandUse). Same layout as landUseGrid. */
  getLandUseTexture(): THREE.DataTexture;
  /** Signed coast distance texture (R16F/R32F, meters, LinearFilter). */
  getCoastDistanceTexture(): THREE.DataTexture;
  /** Name of the water body at x,z ("İstanbul Boğazı", "Haliç", "Marmara Denizi", "Karadeniz"…), or null on land. */
  waterNameAt?(x: number, z: number): string | null;
}

/* ------------------------------------------------------------------ */
/* Dragon (model: dragon/model → 'rig', physics: dragon/flight → 'dragon') */
/* ------------------------------------------------------------------ */

export type FlightMode = 'flying' | 'gliding' | 'diving' | 'hovering' | 'stalling' | 'landing' | 'grounded' | 'takeoff' | 'swimming' | 'underwater';

/**
 * Hard landing phases (phase 04, dragon/flight/hard-landing.ts): `tumble` (rolling / skidding along the ground),
 * `rise` (getting up) and `shake` (standing, shaking its head). The mode stays 'grounded' throughout.
 */
export type HardLandingPhase = 'tumble' | 'rise' | 'shake';

export interface DragonState {
  /** Root transform driven by physics. The rig root is parented under it. Origin = center of mass. */
  readonly object: THREE.Object3D;
  readonly position: THREE.Vector3;
  readonly quaternion: THREE.Quaternion;
  /** World velocity m/s. */
  readonly velocity: THREE.Vector3;
  /** Body-frame angular velocity rad/s (x = pitch rate, y = yaw rate, z = roll rate). */
  readonly angularVelocity: THREE.Vector3;
  mode: FlightMode;
  /** True airspeed m/s. */
  airspeed: number;
  /** Altitude above sea level (m). */
  altitude: number;
  /** Height above the surface below (terrain/buildings/water) (m). */
  agl: number;
  /** Heading compass degrees. */
  headingDeg: number;
  /** Load factor in g. */
  gForce: number;
  /** 0..1 */
  stamina: number;
  /** 0..1 current flap effort. */
  flapEffort: number;
  firing: boolean;
  /** Set true for one frame when touching water surface at speed (splash). */
  touchingWater: boolean;
  /** Remaining roar cooldown as a fraction 0..1 (0 = ready). */
  roarCooldown?: number;
  /** Adds a world velocity change (m/s) to the physics body (speed rings, future powers). */
  addVelocity?(dx: number, dy: number, dz: number): void;
  /** Flow ("akış", phase 20 stage D) 0..1: harmony of the recent motions, paid back as capped speed. */
  flow?: number;
  /**
   * A race gate or speed ring was passed; `tightness` 0..1 = how snug the pass was (flow's use of the world). While a
   * chain is alive a speed ring (and a gate taken tight) is a chain link of its own.
   */
  notePass?(tightness: number, kind?: 'gate' | 'ring'): void;
  /** Chain links in the current chain (flow's chain bursts; 0: no chain). */
  chain?: number;
  /** 0..1: the running chain burst's push right now (smooth envelope, 0 without a burst). */
  burst?: number;
  /** 0..1: the chain window left after a clean move end (a different move started now links); -1 when none runs. */
  chainWindow?: number;
  /** Everyday race moves that would link if started now (maneuver ids: 'dart', 'power', 'roll', 'slip'). */
  chainNext?: readonly string[];
  /** A race is running (speed effects at full strength, full-size chain bursts). */
  racing?: boolean;
  /** The activity system marks a race as running (true) or over (false). */
  setRacing?(on: boolean): void;
  /** Roars when allowed (not cooling down, not breathing fire); returns true when it roared. */
  requestRoar?(): boolean;
  /** Breathes fire for `seconds` as if the fire key were held (hotbar slot). */
  fireBurst?(seconds: number): void;
  /** Perching on viewpoints (phase 03, dragon/flight/perch.ts); absent in sandboxes without perches. */
  readonly perch?: DragonPerchState;
  /**
   * The running hard landing's phase (phase 04), null when none runs. It is no landing of the player's: a race does
   * not count it as standing on the ground (it only costs its time).
   */
  hardLanding?: HardLandingPhase | null;
}

/**
 * Perch phases: `free` (normal flight), `approach` (the guided approach flying to the perch, abortable), `perched`
 * (sitting on the perch: the viewing mode), `leaving` (the drop take-off off the perch until clear of it).
 */
export type PerchPhase = 'free' | 'approach' | 'perched' | 'leaving';

/** Why a perch landing was refused (the UI words it). */
export type PerchRefusal = 'blocked' | 'unavailable';

export interface DragonPerchState {
  readonly phase: PerchPhase;
  /** Seconds since the phase started (simulation time). */
  readonly phaseTime: number;
  /** Perch being approached, sat on or just left; null while free. */
  readonly point: PerchPoint | null;
  /** Perch in reach for a landing right now (the "[L] Kon" prompt), null when none or not free. */
  readonly offer: PerchPoint | null;
  /** Counts refused L presses (the UI shows a polite refusal when it changes) and the reason of the last one. */
  readonly refusals: number;
  readonly lastRefusal: PerchRefusal | null;
  /** Counts aborted approaches (player input during the approach). */
  readonly aborts: number;
  /** Sits the dragon directly on a perch in the viewing mode (map / menu teleport). False when unknown. */
  perchAt(id: string): boolean;
  /** Leaves the perch with the drop take-off (same as Space / L while perched). False when not perched. */
  leave(): boolean;
}

export interface DragonPose {
  /** Continuous wing-beat phase in radians (0 = top of upstroke). */
  flapPhase: number;
  /** 0..1 amplitude of the flap cycle. */
  flapAmplitude: number;
  /** 0 = wings folded against body, 1 = fully spread. */
  wingSpread: number;
  /** -1 = swept forward (flare/brake), 0 = neutral, 1 = swept back (dive). */
  wingSweep: number;
  /** Asymmetric wing twist for roll control, -1..1 (positive rolls right). */
  wingTwist: number;
  /** Head/neck look offsets (radians) relative to body. */
  neckYaw: number;
  neckPitch: number;
  /** 0..1 */
  jawOpen: number;
  tailYaw: number;
  tailPitch: number;
  /** 0 = legs down (standing/landing), 1 = tucked for flight. */
  legsTuck: number;
  /** Ground locomotion phase (radians) and weight 0..1. */
  walkPhase: number;
  walkAmount: number;
  /** 0..1 breathing/idle intensity. */
  breath: number;
  /** Rider lean offsets (radians): forward/back and sideways. */
  riderLeanPitch: number;
  riderLeanRoll: number;

  /*
   * Ground contact and gait (optional; written by dragon/flight/pose.ts). Without them the rig stands on a plane
   * STANDING_ROOT_HEIGHT below its origin and walks with its default gait.
   */
  /**
   * World height (m) of the ground under the dragon and the ground normal's world x / z. The rig turns them into a
   * plane in its own frame with the rendered transform (NaN / missing: the default standing plane).
   */
  groundY?: number;
  groundNx?: number;
  groundNz?: number;
  /** Gait blend: 0 walk, 1 trot, 2 gallop. */
  gait?: number;
  /** Distance covered per gait cycle (m): the rig plants each foot for a sweep that matches it (no foot skate). */
  stride?: number;
  /** 0..1 the wing wrists are fore feet (0: the wings are wings, e.g. the first strides of a run-out). */
  foreGround?: number;
  /** 0..1 hands and fingers raised high and back while the wrists stand (the crouch before a leap). */
  wingRaise?: number;
  /** 0..1 push-off: heels up, toes pushing. */
  heelLift?: number;
  /** Legs clear of the ground: -1 trailing back (after the push), +1 reaching forward (touchdown). */
  legReach?: number;
  /** 0..1 braking skid: hind feet braced forward, claws dug in. */
  skid?: number;
  /**
   * 0..1 landing flare (optional): wings reaching forward and cupped with a steeper stroke, the neck in an S so the head
   * stays level while the body rears up, the claws open for the touchdown.
   */
  landFlare?: number;
  /**
   * Swimming at the surface (optional, 0 = not swimming): 0..1 weight of the floating posture (neck raised, wings folded
   * tight along the back, hind legs kicking under the body, no ground plane), the stroke phase (rad) of the body / tail
   * undulation and the leg kicks, and the stroke strength 0..1.
   */
  swim?: number;
  swimPhase?: number;
  swimStroke?: number;

  /*
   * Rider cues and dragon attention (optional, 0 = neutral). Every command the player gives shows on the rider.
   * Written by flight (dragon/flight/pose.ts): riderReinLeft/Right, riderTuck, riderPoint, riderCheer.
   * Written by the rider behaviour (dragon/model): riderPet, riderStand, gazeRider.
   */
  /** Rein hand: -1 = pushed forward (giving rein, dive), 0 = neutral grip, 1 = pulled back to the chest (climb, brake). */
  riderReinLeft?: number;
  riderReinRight?: number;
  /** 0..1 crouch flat against the neck, hands on the pommel (dives, rolls, loops, free fall). */
  riderTuck?: number;
  /** 0..1 right arm points ahead (fire command). */
  riderPoint?: number;
  /** 0..1 right fist raised (roar, cheering after a trick). */
  riderCheer?: number;
  /** 0..1 right hand leaves the reins and strokes the dragon's neck. */
  riderPet?: number;
  /** 0..1 rider stands up on the saddle (0 = seated). */
  riderStand?: number;
  /** 0..1 the dragon turns its head back to look at the rider (blends over neckYaw/neckPitch). */
  gazeRider?: number;

  /*
   * Bond (phase 06, optional, 0 = neutral). Written by the bond behaviour (dragon/model/behavior/bond) on top of the
   * flight pose: eyes, the neck plates and the small self-driven behaviours (head shake, happy rock, tail curl), plus
   * the rider cues that go with them.
   */
  /** 0 = eyes open, 1 = lids closed (blinks, half-closed while petted, dozing). */
  eyeLid?: number;
  /** 0 = narrow slit (bright light), 1 = wide round pupil (dark, excited). */
  pupil?: number;
  /** 0..1 the small plates along the top of the neck stand up (petted, excited). */
  neckPlates?: number;
  /** Head roll (rad, + = tilts the crown to the dragon's left): a curious or affectionate tilt. */
  headRoll?: number;
  /** Fast head / upper-neck yaw (rad) applied past the neck springs: head shakes, a sneeze's jerk. */
  neckShake?: number;
  /** Visual body roll of the rig (rad, + = left side down): a happy rock or a shake-off; never the flight body. */
  bodyRoll?: number;
  /** 0..1 extra slow curl of the tail tip (contentment). */
  tailCurl?: number;
  /** 0..1 rider laughs (shoulders bob, head back a little). */
  riderLaugh?: number;
  /** 0..1 rider's right arm points at what the dragon looks at; direction in body-relative yaw / pitch (rad). */
  riderShow?: number;
  riderShowYaw?: number;
  riderShowPitch?: number;
  /** 0..1 rider pats the dragon's neck (the V "encourage" interaction): quick taps with the flat hand. */
  riderPat?: number;
}

export interface DragonRig {
  /** Add under DragonState.object (flight does the parenting). */
  readonly root: THREE.Object3D;
  /** Rider eye point for the POV camera; its -Z looks forward over the dragon's head. */
  readonly riderHead: THREE.Object3D;
  /** Fire emitter at the mouth; -Z points out of the mouth. */
  readonly mouth: THREE.Object3D;
  readonly wingTipLeft: THREE.Object3D;
  readonly wingTipRight: THREE.Object3D;
  /** Approximate dimensions (m). */
  readonly dimensions: {
    length: number;
    wingspan: number;
    height: number;
    /** Height of the body's centre of mass above the ground when standing (m). */
    standHeight?: number;
  };
  setPose(pose: Partial<DragonPose>): void;
  getPose(): Readonly<DragonPose>;
  /** Hide parts that would clip into the POV camera (rider head/hood) and show POV-only details (hands on reins). */
  setFirstPerson(enabled: boolean): void;
}

/* ------------------------------------------------------------------ */
/* Camera (owned by camera) — service key: 'cameraRig'                  */
/* ------------------------------------------------------------------ */

export type CameraMode = 'third' | 'pov' | 'cinematic' | 'free';

export interface CameraRigState {
  mode: CameraMode;
  setMode(mode: CameraMode): void;
  /** Adds screen shake (meters of offset amplitude, decays). */
  shake(amount: number): void;
  readonly fovDeg: number;
  /** Caption of the current cinematic shot (cinematic mode only). */
  readonly shotLabel?: string;
  /**
   * The viewing camera while perched (phase 03; C cycles it): the cinematic mode's slow orbit or still framing, the
   * rider's eyes, or another camera.
   */
  readonly perchCamera?: 'orbit' | 'fixed' | 'rider' | 'other';
  /**
   * Switch to the free camera and place it exactly (hard cut). Used by photo mode and screenshot tooling.
   * Angles in degrees: heading 0 = north (clockwise), pitch + up.
   */
  placeFree?(x: number, y: number, z: number, headingDeg: number, pitchDeg: number, fovDeg?: number): void;
}

/* ------------------------------------------------------------------ */
/* Environment (owned by render/sky) — service key: 'env'               */
/* ------------------------------------------------------------------ */

export interface EnvironmentState {
  /** Unit vector pointing TOWARD the sun (world). */
  readonly sunDirection: THREE.Vector3;
  readonly moonDirection: THREE.Vector3;
  /** Linear sun radiance color * intensity reaching the ground (already attenuated by atmosphere). */
  readonly sunColor: THREE.Color;
  /** Linear average sky irradiance color for ambient. */
  readonly ambientColor: THREE.Color;
  /** 0 = full day, 1 = full night. */
  readonly nightFactor: number;
  /**
   * The shadow-casting key light (sun or moon). Implemented with the r186 cascaded
   * `SunLight` addon (three/examples/jsm/lights/SunLight.js) or a DirectionalLight.
   */
  readonly light: THREE.Light;
  /** World wind vector m/s at 100 m. */
  readonly wind: THREE.Vector3;
  /** Relative humidity 0..1 near the ground (condensation, haze). */
  readonly humidity?: number;
  setTimeOfDay(hours: number): void;
}

/* ------------------------------------------------------------------ */
/* Other services                                                      */
/* ------------------------------------------------------------------ */

export interface FxService {
  /** One-shot water splash at a world point. */
  splash(position: THREE.Vector3, strength: number): void;
  /** One-shot dust/debris burst (landing on ground). */
  dust(position: THREE.Vector3, strength: number): void;
}

export type AudioOneShot =
  | 'roar'
  | 'flap'
  | 'splash'
  | 'fire-start'
  | 'land'
  | 'ui-click'
  | 'discover'
  /** Weather (render/weather): thunder clap; volume 0..1 also encodes distance (quieter = farther, duller). */
  | 'thunder'
  /** Maneuvers (dragon/flight): wings snapping open out of a fall, a roll/loop air whoosh. */
  | 'wing-snap'
  | 'whoosh'
  /** Bond (dragon/model): one purr phrase (~2 s) while being petted. */
  | 'purr';

/**
 * Bond sounds of the dragon (phase 06, synthesised): a purr phrase with depth (petting), a content chirp, a curious
 * rising trill, a tired grumble, a yawn, a sneeze, a jaw snap at a gull, a nasal huff and a short happy roar.
 */
export type BondAudioCue = 'purr-deep' | 'chirp' | 'trill' | 'grumble' | 'yawn' | 'sneeze' | 'snap' | 'huff' | 'roar-short';

export interface AudioService {
  /** Plays a synthesized one-shot. */
  play(name: AudioOneShot, volume?: number): void;
  readonly unlocked: boolean;
  setMasterVolume(v: number): void;
  /** Current master volume 0..1. */
  readonly masterVolume?: number;
  /** Unlocks the AudioContext; call from a user gesture (start screen). */
  unlock?(): void;
  /**
   * Gently lifts the coastal ambience (surf up, city down) by `amount` 0..1 while a calm moment plays (src/moments);
   * 0 restores the normal mix. The ambience's own smoothing makes the change a slow swell.
   */
  setAmbienceLift?(amount: number): void;
  /** A positional cue of a moment's procedural creatures (src/moments), e.g. a stork's bill clatter nearby. */
  momentCue?(cue: MomentAudioCue, position: { x: number; y: number; z: number }, volume?: number, panFrom?: number): void;
  /** Soft open-air wind bed while a moment plays high over the city, 0..1 (swells in and out slowly). */
  setMomentBed?(amount: number): void;
  /** Adaptive music (src/audio/music): its own volume 0..1 (persisted, like the master volume). */
  setMusicVolume?(v: number): void;
  readonly musicVolume?: number;
  /** "Uyarlanabilir müzik": on = the stems follow the flight; off = the plain full mix (persisted). */
  setAdaptiveMusic?(on: boolean): void;
  readonly adaptiveMusic?: boolean;
  /**
   * A moment started / ended (src/moments): the music ducks strongly while it plays, or swaps to the moment's own
   * music set when `musicId` (MomentContent.musicId) names one in the music manifest; restored afterwards.
   */
  setMomentMusic?(active: boolean, musicId?: string): void;
  /** A bond sound of the dragon at its head (phase 06); `volume` 0..1.5 also sets its intensity. */
  bondCue?(cue: BondAudioCue, volume?: number): void;
}

/**
 * Positional sound cues of moment creatures: the storks' (synthesised, src/audio/sfx/storks.ts) and the ferry gulls'
 * ('gull-call' one recorded CC0 gull call, 'gull-wingbeat' a few soft synthesised wing beats; src/moments/gull-simit).
 */
export type MomentAudioCue = 'stork-clatter' | 'stork-wingbeat' | 'stork-pass' | 'gull-call' | 'gull-wingbeat';

/**
 * Elevated road surfaces built by landmark modules (bridge decks, approach viaducts).
 * Provided by world/landmarks/structures as 'roadSurface'; traffic and landing use it.
 */
export interface RoadSurfaceService {
  /** Deck surface height (m) at x,z if a deck covers that point, otherwise null (use terrain). */
  deckHeightAt(x: number, z: number): number | null;
  /** Deck centre lines with per-point heights, for vehicles to follow (world meters). */
  readonly decks: readonly { id: string; points: { x: number; y: number; z: number }[]; width: number }[];
}

/**
 * The drawn street ground of the OSM slice (carriageways, raised kerbs and sidewalks, tram platforms, quays), exactly
 * as the ground mesh is built. Provided by world/osm as 'streetGround' once its street raster is ready; structures
 * use it to land bridge decks on the street they join.
 */
export interface StreetGroundService {
  /** Whether (x, z) lies on the OSM ground. */
  covers(x: number, z: number): boolean;
  /** Height (m) of the drawn ground at (x, z) (bridge decks excluded). */
  heightAt(x: number, z: number): number;
  /**
   * Tram track centrelines and painted lane lines of the drawn ground crossing the segment a-b, as distances (m) from
   * a along it; a line stopping up to `reach` m short of the segment is extended along its last segment. Decks landing
   * on the street continue these lines.
   */
  linesAcross?(ax: number, az: number, bx: number, bz: number, reach: number): { t: number; kind: 'track' | 'lane' }[];
}

/* ------------------------------------------------------------------ */
/* Weather (owned by render/weather) — service key: 'weather'           */
/* ------------------------------------------------------------------ */

export type WeatherPreset = 'clear' | 'haze' | 'fog' | 'rain' | 'storm';

/** Player-facing weather and look settings, each 0..1 (0 = off). */
export interface WeatherSettings {
  /** Ground fog and thick haze. */
  fog: number;
  /** Rain intensity (streaks, darker overcast sky, rain sound). */
  rain: number;
  /** Thunderstorm activity (lightning flashes, thunder). */
  storm: number;
  /** Distance softening of far buildings and terrain (aerial blur). */
  farBlur: number;
}

export interface WeatherService {
  /** Target settings (what the player chose); `current` eases toward them. */
  readonly settings: Readonly<WeatherSettings>;
  /** Smoothed values in use this frame. */
  readonly current: Readonly<WeatherSettings>;
  readonly preset: WeatherPreset | 'custom';
  /** Lightning flash brightness this frame (0..1, fast decay). */
  readonly flash: number;
  setPreset(preset: WeatherPreset): void;
  set(settings: Partial<WeatherSettings>): void;
  /** Cycles clear → haze → fog → rain → storm. */
  cycle(): WeatherPreset;
}

/* ------------------------------------------------------------------ */
/* Viewpoints (phase 03) — service key: 'perches'                        */
/* ------------------------------------------------------------------ */

export type PerchSurface = 'tower' | 'dome' | 'hill' | 'roof' | 'rock';

/** A spot where the dragon can land and watch the city. */
export interface PerchPoint {
  /** Stable id, e.g. "galata-kulesi". */
  id: string;
  /** Turkish name shown in UI. */
  name: string;
  /** Grip point in local meters: where the claws hold (top surface of the structure or the ground on hills). */
  x: number;
  y: number;
  z: number;
  /** Compass heading the dragon faces while perched (toward the view). */
  headingDeg: number;
  surface: PerchSurface;
  /** Radius (m) of the area the claws may grip around the point. */
  gripRadius: number;
  /** One or two sentence Turkish info text for the viewing screen. */
  info: string;
  /** Landmark this perch sits on, if any (LandmarkDef.id). */
  landmarkId?: string;
}

export interface PerchService {
  readonly points: readonly PerchPoint[];
  get(id: string): PerchPoint | undefined;
  /** Closest perch within `maxDistance` m (horizontal), or null. */
  nearest(x: number, z: number, maxDistance?: number): { point: PerchPoint; distance: number } | null;
}

/* ------------------------------------------------------------------ */
/* Hotbar: abilities and items (owned by ui) — service key: 'hotbar'    */
/* ------------------------------------------------------------------ */

/** Icon ids the HUD can draw for hotbar slots (add new ones together with their drawing in src/ui/hud). */
export type HotbarIcon = 'fire' | 'roar' | 'potion' | 'feather' | 'lantern' | 'gift' | 'unknown';

/**
 * One slot of the bottom-centre hotbar. Abilities (fire, roar, later special powers) and items (inventory) register
 * here; the HUD draws them and, when the slot's number key (1..size) is pressed, calls `activate`.
 */
export interface HotbarSlot {
  /** Stable id, e.g. "fire", "roar", "item:simit". */
  id: string;
  kind: 'ability' | 'item';
  /** Turkish name shown under the hotbar while selected/used. */
  label: string;
  icon: HotbarIcon;
  /** Extra shortcut shown next to the name (e.g. "F" for fire, which also works from its own key). */
  hotkey?: string;
  /** Items: stack size (hidden when undefined). */
  count?: number;
  /** Remaining cooldown as a fraction 0..1 (0 = ready). The owner updates it. */
  cooldown?: number;
  /** In use right now (held fire, a running power). */
  active?: boolean;
  /** False greys the slot out (not usable right now, e.g. no stamina). Default true. */
  enabled?: boolean;
  /** Called when the player presses the slot's number key (or clicks it while the pointer is free). */
  activate?(): void;
}

export type HotbarSlotState = Partial<Pick<HotbarSlot, 'label' | 'count' | 'cooldown' | 'active' | 'enabled'>>;

export interface HotbarService {
  /** Number of slots (number keys 1..size). */
  readonly size: number;
  readonly slots: readonly (HotbarSlot | null)[];
  /** Puts a slot at `index` (0-based), or clears it with null. */
  set(index: number, slot: HotbarSlot | null): void;
  /** First free index, or -1. */
  firstFree(): number;
  /** Updates the live state of the slot with `id` (cheap; call every frame if needed). */
  update(id: string, state: HotbarSlotState): void;
  /** Removes the slot with `id` wherever it is. */
  remove(id: string): void;
}

/** Summary of the ambient sea state (open water), owned by the water module. */
export interface WaterSeaState {
  /** Smoothed 10 m wind speed the waves are built from (m/s). */
  windSpeed: number;
  /** Significant wave height of the open Marmara / Black Sea, all wave groups at full weight (m). */
  significantWaveHeight: number;
  /** Regime blend: 0 = poyraz sea (NE wind), 1 = lodos sea (SW wind). */
  lodos: number;
  regime: 'poyraz' | 'lodos';
}

/**
 * The sea surface for physics, provided by the water module as `water`: the same Gerstner wave set, phases and
 * regime the water shader displaces the rendered surface with, plus the Bosphorus surface current. All queries are
 * allocation-free (results go into `out`) and describe the water at the world position (x, z) at the time of the
 * latest sea-state update (at most one frame old). Over land the values are meaningless; check the terrain first.
 * The shading-only detail bands (a few cm) are not part of the height.
 */
export interface WaterService {
  /**
   * Water surface height (m) at world (x, z), solved at the displaced surface point (Gerstner waves move water
   * horizontally too): the ambient waves plus the dynamic part (wave particles from hulls, the dragon and splashes,
   * phase 21 stage 7a), so every caller floats on the same water, wakes included.
   */
  heightAt(x: number, z: number): number;
  /** Unit surface normal at (x, z). */
  normalAt(x: number, z: number, out: THREE.Vector3): THREE.Vector3;
  /** Velocity of the surface water at (x, z) (m/s): wave orbital velocity plus the surface current. */
  velocityAt(x: number, z: number, out: THREE.Vector3): THREE.Vector3;
  /** Horizontal surface current at (x, z) (m/s, y = 0): the Bosphorus flow, zero in still water. */
  currentAt(x: number, z: number, out: THREE.Vector3): THREE.Vector3;
  readonly seaState: Readonly<WaterSeaState>;
  /**
   * Local significant wave height of the ambient waves at (x, z) (m; the spectrum with the local fetch weights, no
   * wave particles). Phase 21 stage 6: the swimming dragon's rocking and its water take-off read it. Optional: simple
   * stand-ins (flat water) leave it out, which reads as calm.
   */
  significantHeightAt?(x: number, z: number): number;
  /**
   * Wave particles (phase 21 stage 7a): the interactive part of the sea (hull wakes, the dragon, splashes), already
   * included in heightAt / normalAt / velocityAt. Optional: simple stand-ins (flat water in checks) leave it out.
   */
  readonly dynamic?: WaterDynamics;
  /**
   * Foam and spray (phase 21 stage 7c): hull foam sources, splashes, and the spray sources fx turns into particles.
   * Optional: simple stand-ins leave it out.
   */
  readonly foam?: WaterFoam;
}

/** One spray source of the frame (phase 21 stage 7c), read by fx from `water.foam.sprays`. */
export interface WaterSpraySource {
  /** Spindrift torn off a breaking crest by the wind, a bow throwing spray in chop, a propeller's rooster tail. */
  kind: 'spindrift' | 'bow' | 'prop';
  /** Where the spray leaves the water (m). */
  x: number;
  y: number;
  z: number;
  /** Velocity of the source (the hull's, or the wind at the crest for spindrift; m/s). */
  vx: number;
  vy: number;
  vz: number;
  /** Horizontal unit direction the spray is thrown toward (outward from the bow, astern, downwind). */
  dirX: number;
  dirZ: number;
  /** 0..1 strength (particle rate and speed) and a size scale (m: the crest length, the beam). */
  strength: number;
  size: number;
}

/**
 * Foam of the sea (phase 21 stage 7c), owned by the water module and reached through `water.foam`: an advected foam
 * field around the camera fed by breaking crests (from the wind-wave spectrum), breaking wake crests, surf, hulls, the
 * dragon and splashes; plus the frame's spray sources.
 */
export interface WaterFoam {
  /**
   * A moving hull (call every frame while it moves): centre, unit forward axis of the hull, speed through the water
   * (m/s), waterline length, beam and draft (m), thrust as a share of the maximum (0..1), planing (0..1) and the bow's
   * vertical speed (m/s, heave + pitch; slamming throws bow spray).
   */
  hull(source: number, x: number, z: number, forwardX: number, forwardZ: number, speed: number, length: number, beam: number, draft: number, thrust: number, planing: number, bowHeave: number): void;
  /** A splash at (x, z) (fx strength units: ~0.05 a stroke, ~1 a skim contact, ~3 a plunge). */
  splash(x: number, z: number, strength: number): void;
  /** Spray sources of this frame (the first `sprayCount`). */
  readonly sprays: readonly WaterSpraySource[];
  readonly sprayCount: number;
  /** The foam field's square window: centre and half side (m); halfExtent 0 while the field is off ("low"). */
  readonly window: { readonly x: number; readonly z: number; readonly halfExtent: number };
  /** Whitecap coverage of the open sea at the current wind (0..1, Monahan). */
  readonly coverage: number;
}

/** The dynamic part of the water at one point (wave particles only). */
export interface WaterDynamicSample {
  /** Height (m) and its horizontal gradient. */
  height: number;
  slopeX: number;
  slopeZ: number;
  /** Orbital velocity of the surface water (m/s). */
  vx: number;
  vy: number;
  vz: number;
}

/**
 * Wave particles of the sea (phase 21 stage 7a), owned by the water module and reached through `water.dynamic`.
 * Sources emit wave fronts that travel with the deep-water group speed, spread, subdivide and fade; moving hulls get
 * a bow and stern wave whose Kelvin pattern emerges from the dispersion relation. Source ids: vessels use their
 * non-negative vessel id; negative ids are reserved (WATER_SOURCE in the water module).
 */
export interface WaterDynamics {
  /** Live particles. */
  readonly count: number;
  /**
   * Particles of this source are skipped by every query (heightAt included) while set; -1 = none. A hull sets its own
   * id while sampling its buoyancy (it does not ride its own bow wave) and resets it afterwards.
   */
  exclude: number;
  /** The particle field alone at (x, z) (allocation-free, result in `out`). */
  sample(x: number, z: number, out: WaterDynamicSample): WaterDynamicSample;
  /**
   * A moving hull (call every frame while it moves): position of its centre, unit heading of its motion through the
   * water, speed through the water (m/s) and its waterline length, beam and draft (m). Emission cadence, level of
   * detail and the pool budget are handled inside.
   */
  hull(source: number, x: number, z: number, headingX: number, headingZ: number, speed: number, length: number, beam: number, draft: number): void;
  /** A circular wave train (splash, plunge, stroke): amplitude (m) of the first ring and its wavelength (m). */
  ring(source: number, x: number, z: number, amplitude: number, wavelength: number): void;
}

/**
 * The camera below the water (phase 21 stage 4), provided by the water module as `underwater`: whether the camera is
 * under the local wave surface (the CPU wave height at the camera, the surface the shader draws), with hysteresis.
 * The post pipeline, the water surface and audio read it; everything is off while `lensActive` is false.
 */
export interface UnderwaterView {
  /** Camera below the surface (hysteresis: switches a few cm past the surface, never flickers on the waterline). */
  readonly under: boolean;
  /** Camera depth below the local surface (m): > 0 under, < 0 above. */
  readonly depth: number;
  /** 0..1 smoothed `under` for mixes. */
  readonly amount: number;
  /** Local surface at the camera: height (m) and unit normal (the lens waterline is this plane). */
  readonly surfaceY: number;
  readonly surfaceNormal: THREE.Vector3;
  /** 0..1 droplets on the lens after a breach (fades out in about a second). */
  readonly droplets: number;
  /** Under water, or close enough above it that the waterline can cross the lens. */
  readonly lensActive: boolean;
}

/**
 * The sea reacting to the dragon flying low over it (phase 21 stage 2), provided by the water module as `lowFlight`.
 * Computed once per frame after flight and camera (UpdateOrder.World) from DragonState, the rig anchors and the water
 * service; fx (sprays, vortex curls, steam) and audio (downwash, skim tearing, steam hiss) read it, the water surface
 * draws its disturbance texture. Every value is 0 and `active` is false while the dragon is not low over water.
 */
export interface LowFlightView {
  /** Some low-flight effect is running (false: consumers skip all of their low-flight work). */
  readonly active: boolean;
  /** Height of the body's centre above the local wave surface (m); Infinity when not over water. */
  readonly height: number;
  /** 0..1 wing downwash on the water (hovering or flying slowly within ~1.5 wingspans). */
  readonly downwash: number;
  /** 0..1 gust of the latest downstroke hitting the water, decaying over ~0.4 s. */
  readonly downwashPulse: number;
  /** 0..1 spray whipped up at the edge of the downwash ring (a strong hover close to the water). */
  readonly edgeSpray: number;
  /** 0..1 skim wake: fast and very low or touching the water. */
  readonly wake: number;
  /** 0..1 wingtip vortex curls on the water (low and fast). Per tip: `tipVortex`. */
  readonly vortex: number;
  readonly tipVortex: readonly [number, number];
  /** 0..1 fire breath boiling the sea at `steamPoint`. */
  readonly steam: number;
  readonly steamPoint: THREE.Vector3;
  /** The water surface under the body (x, wave height, z). */
  readonly surfacePoint: THREE.Vector3;
  /** Horizontal unit direction of travel. */
  readonly heading: THREE.Vector3;
  /** Horizontal speed (m/s). */
  readonly speed: number;
  /** Wingtips (left, right) and tail tip: height above the local water (m) and the water point under them. */
  readonly tipHeight: readonly [number, number];
  readonly tipPoint: readonly [THREE.Vector3, THREE.Vector3];
  readonly tailHeight: number;
  readonly tailPoint: THREE.Vector3;
}

/**
 * HUD screen zones (src/ui/zones): every transient HUD message asks for a zone with a priority and a duration; the
 * director shows the highest priority per zone, defers the others (dropping them once they waited too long) and fades
 * between them. Provided by the UI as `hudZones`. The `center` band is reserved for the aim / ring area and the
 * `bottom` cluster is static, so neither can be requested.
 */
export type HudZoneId = 'top' | 'title' | 'lowerCenter' | 'corner' | 'toast';

export interface HudZoneRequest {
  /** Stable key: requesting the same id again updates the item in place (and restarts its duration). */
  id: string;
  zone: HudZoneId;
  /** Higher wins (HUD_PRIORITY in src/ui/zones). Ties go to the newer request. */
  priority: number;
  /** Seconds on screen once shown (counted only while shown). Default: until released. */
  duration?: number;
  /** Seconds it may wait unshown (queued, displaced or deferred) before it is dropped. Default: forever. */
  maxWait?: number;
  /** Contexts that defer this item while active (e.g. 'race'). */
  deferIn?: readonly string[];
  /** lowerCenter only: key hints for the shared hint line, [keys, label] in keyCombo syntax. */
  hints?: readonly (readonly [keys: string, label: string])[];
  /** lowerCenter only: a caption at the start of the hint line. */
  caption?: string;
  /** lowerCenter only: these hints may ride along on a higher-priority hint line that is showing. */
  joinable?: boolean;
  /** Called when the item appears / disappears (owner-rendered nodes fade in and out here); onShow runs again when a
   * shown item is requested anew (content update in place). */
  onShow?: () => void;
  onHide?: () => void;
}

export interface HudZonesService {
  request(request: HudZoneRequest): void;
  release(id: string): void;
  /** Turns a context on or off ('race' while a race is prepared, run or its result is open). */
  setContext(name: string, on: boolean): void;
  isShown(id: string): boolean;
  /** Is the context on (e.g. 'race')? */
  hasContext?(name: string): boolean;
}

/**
 * Pose of one vessel of the living world (world/life), for systems that anchor to moving boats (src/moments: gulls
 * behind a ferry). Model space: -Z is the bow, +Z the stern; `yaw` is Object3D.rotation.y.
 */
export interface VesselPose {
  id: number;
  /** Design kind ('vapur', 'ferry', 'seabus', 'tour', ...). */
  kind: string;
  x: number;
  z: number;
  yaw: number;
  /** Height of the design waterline (m). */
  heave: number;
  /** Speed through the water (m/s), negative while going astern. */
  speed: number;
  /** Underway on its route (not anchored, moored or alongside a pier). */
  underway: boolean;
  length: number;
  beam: number;
  draft: number;
  /** Highest point above the waterline (m). */
  airDraft: number;
}

/**
 * The living world's vessels and flocks for other systems. Provided by world/life as 'life' once its fleet exists.
 */
export interface LifeService {
  /** Poses of the vessels of these kinds, written into `out` (entries reused, length set). */
  vessels(kinds: readonly string[], out: VesselPose[]): VesselPose[];
  /** Current pose of vessel `id` into `out`, or null when it no longer exists (fleet rebuilt). */
  vessel(id: number, out: VesselPose): VesselPose | null;
  /**
   * Hands over the ambient gulls trailing vessel `id` (their positions and velocities, flat x,y,z,vx,vy,vz) and keeps
   * that flock dormant until `returnGulls`. Returns the number of birds written.
   */
  borrowGulls?(id: number, out: Float32Array): number;
  /** Gives the vessel's ambient flock back, continuing from `count` bird states (flat as in borrowGulls). */
  returnGulls?(id: number, states: Float32Array, count: number): void;
  /**
   * Closest ambient bird (gull or pigeon) to (x, y, z) within `maxDistance` m: its position into `out`, the distance
   * as the result, or -1 when none (the dragon's attention, phase 06).
   */
  nearestBird?(x: number, y: number, z: number, maxDistance: number, out: THREE.Vector3): number;
}

/* ------------------------------------------------------------------ */
/* Bond with the dragon (phase 06) — service key: 'bond'                */
/* ------------------------------------------------------------------ */

/** The dragon's mood (no meter on screen; it shows in pose and sound, and as one quiet line in the pause menu). */
/** `embarrassed`: briefly, after a hard landing (phase 04). */
export type DragonMood = 'content' | 'curious' | 'playful' | 'tired' | 'excited' | 'embarrassed';

/** Read-only state of the bond behaviour, provided by dragon/model as 'bond'. */
export interface DragonBondState {
  readonly mood: DragonMood;
  /** 0..1 how strongly the mood holds. */
  readonly moodLevel: number;
  /** One quiet Turkish line about the mood (pause menu). */
  readonly moodLine: string;
  /** 0..1 visible breath steam from the nostrils (cold or humid air); fx scales it by `exhale`. */
  readonly nostrilSteam: number;
  /** 0..1 the exhale of the current breath (steam leaves the nostrils on it). */
  readonly exhale: number;
  /** Id of the self-driven behaviour playing now ("yawn:flame"), or null. */
  readonly behavior: string | null;
}

/** Typed service map. Use ctx.services.get('geo') etc. */
export interface Services {
  geo: GeoQuery;
  collision: import('./collision').CollisionWorld;
  env: EnvironmentState;
  rig: DragonRig;
  dragon: DragonState;
  cameraRig: CameraRigState;
  fx: FxService;
  audio: AudioService;
  roadSurface: RoadSurfaceService;
  streetGround: StreetGroundService;
  weather: WeatherService;
  perches: PerchService;
  hotbar: HotbarService;
  water: WaterService;
  underwater: UnderwaterView;
  lowFlight: LowFlightView;
  hudZones: HudZonesService;
  life: LifeService;
  bond: DragonBondState;
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

export interface GameEvents {
  'camera-mode': { mode: CameraMode };
  'landmark-discovered': { id: string };
  'landmark-near': { id: string; distance: number };
  'fire-start': Record<string, never>;
  'fire-stop': Record<string, never>;
  splash: { position: THREE.Vector3; strength: number };
  'ground-impact': { position: THREE.Vector3; speed: number };
  'flap': { strength: number };
  'pause': { paused: boolean };
  'quality-changed': { preset: string };
  'time-of-day': { hours: number };
  'loading-progress': { label: string; progress: number };
  'loading-done': Record<string, never>;
  'toast': { text: string; kind?: 'info' | 'warn' };
  /**
   * Perching (phase 03): the dragon sat down on a viewpoint (`first` = never perched there before, the discovery) or
   * left it. Emitted by the UI's perch viewing layer, which owns the visited set.
   */
  perch: { id: string; state: 'perched' | 'left'; first: boolean };
  /**
   * A maneuver or rider action started (flight emits: roll, loop, freefall, catch, takeoff, land...; the rider
   * behaviour emits: pet, stand, sit). `label` is the Turkish caption the HUD shows briefly; `clean` only where the
   * start already tells (the breach).
   */
  maneuver: { id: string; label: string; clean?: boolean };
  /**
   * A move that reports its end finished (phase 20 stage B / C moves, the plunge): `clean` = no contact, no stall, not
   * cut short and the move's trade kept. Not a caption; the tutorial hints (src/ui/tutorial) read it as "learned".
   */
  'maneuver-end': { id: string; clean: boolean };
  /**
   * A chain link landed (flow's chain bursts, phase 20): its number in the chain, the speed push it gives (m/s, 0 when
   * the push was trimmed away) and why (a motion, a speed ring or a tight gate taken during the chain).
   */
  'chain-link': { link: number; dv: number; source: 'motion' | 'ring' | 'gate' };
  /**
   * A "Kusursuz" moment of the flow system (phase 20): which harmony term peaked (on the beat, energy kept, a seamless
   * handover, the world used). The caption comes separately as a `maneuver` event with id 'flow'.
   */
  'flow-moment': { kind: 'rhythm' | 'energy' | 'handover' | 'world' };
  /**
   * A puff from the dragon's nostrils or mouth (phase 06 bond behaviours): smoke on a sneeze, a small flame at the end
   * of a yawn, a steam huff, water drops flung off by a shake. Purely visual; fx spawns it at the mouth anchor (the
   * drops around the head and neck).
   */
  'dragon-puff': { kind: 'smoke' | 'flame' | 'steam' | 'droplets'; strength: number };
  /**
   * Something worth a look for the dragon (phase 06 attention): a ferry horn, a flock, a stork kettle. World point;
   * `strength` 0..1 ranks it. Any system may emit it; the bond behaviour turns the head there when it is safe.
   */
  'dragon-attention': { x: number; y: number; z: number; kind: 'horn' | 'bird' | 'stork' | 'ferry' | 'sound'; strength: number };
  /** The player asked for a moment's sources ("[I] Kaynağa bak", src/moments): the UI opens the source sheet. */
  'moment-source': { id: string };
  /** Move the dragon (flight listens; camera snaps). Angles in degrees. */
  teleport: { x: number; y: number; z: number; headingDeg: number; pitchDeg: number; speed?: number };
  /**
   * Activity progress (src/activities: ring races…). Emitted on start, every checkpoint, finish and abort.
   * Times in seconds; `label` is the Turkish caption for the HUD.
   */
  activity: {
    activityId: string;
    state: 'started' | 'checkpoint' | 'finished' | 'aborted';
    checkpoint: number;
    total: number;
    elapsed: number;
    best?: number;
    label: string;
  };
}

/* ------------------------------------------------------------------ */
/* Debug                                                               */
/* ------------------------------------------------------------------ */

export interface DebugFlags {
  /** View preset name from ?view= */
  view?: string;
  /** Time of day from ?t= */
  time?: number;
  /** Camera mode from ?cam= */
  cam?: CameraMode;
  /** Quality preset from ?q= */
  quality?: string;
  /** ?freeze=1 pauses simulation (for screenshots); rendering continues. */
  freeze: boolean;
  /** ?autopilot=1 keeps the dragon in gentle level flight without input. */
  autopilot: boolean;
  /** ?stats=1 shows perf overlay */
  stats: boolean;
  /** ?nohud=1 hides the HUD */
  nohud: boolean;
  /** Raw params. */
  params: URLSearchParams;
}
