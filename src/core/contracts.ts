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

export type FlightMode = 'flying' | 'gliding' | 'diving' | 'hovering' | 'stalling' | 'landing' | 'grounded' | 'takeoff' | 'swimming';

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
   * Rider cues and dragon attention (optional, 0 = neutral). Every command the player gives shows on the rider.
   * Written by flight (dragon/flight/pose.ts): riderReinLeft/Right, riderTuck, riderUrge, riderPoint, riderCheer.
   * Written by the rider behaviour (dragon/model): riderPet, riderStand, gazeRider.
   */
  /** Rein hand: -1 = pushed forward (giving rein, dive), 0 = neutral grip, 1 = pulled back to the chest (climb, brake). */
  riderReinLeft?: number;
  riderReinRight?: number;
  /** 0..1 crouch flat against the neck, hands on the pommel (dives, rolls, loops, free fall). */
  riderTuck?: number;
  /** 0..1 envelope of the "dehh" urge: rein snaps and heel kicks (the animator runs the snap cycle itself). */
  riderUrge?: number;
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
  /** Maneuvers (dragon/flight): wings snapping open out of a fall, a roll/loop air whoosh, the rider's rein snap. */
  | 'wing-snap'
  | 'whoosh'
  | 'rein-snap'
  /** Bond (dragon/model): one purr phrase (~2 s) while being petted. */
  | 'purr';

export interface AudioService {
  /** Plays a synthesized one-shot. */
  play(name: AudioOneShot, volume?: number): void;
  readonly unlocked: boolean;
  setMasterVolume(v: number): void;
  /** Current master volume 0..1. */
  readonly masterVolume?: number;
  /** Unlocks the AudioContext; call from a user gesture (start screen). */
  unlock?(): void;
}

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
  weather: WeatherService;
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
   * A maneuver or rider action started (flight emits: roll, loop, freefall, catch, urge, takeoff, land...; the rider
   * behaviour emits: pet, stand, sit). `label` is the Turkish caption the HUD shows briefly.
   */
  maneuver: { id: string; label: string };
  /** Move the dragon (flight listens; camera snaps). Angles in degrees. */
  teleport: { x: number; y: number; z: number; headingDeg: number; pitchDeg: number; speed?: number };
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
