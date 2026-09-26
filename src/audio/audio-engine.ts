import type { AudioOneShot, BondAudioCue, CameraMode, MomentAudioCue } from '../core/contracts';
import { clamp, clamp01, finiteOr, lerp, smoothstep } from './dsp/math';
import { createNoiseBank, type NoiseBank } from './dsp/noise';
import { SmoothParam } from './dsp/param';
import { mulberry32, randRange } from './dsp/rng';
import { createMasterBus, type MasterBus } from './master-bus';
import { playIgnition } from './sfx/fire';
import { playFlap } from './sfx/flap';
import { playBubbles } from './sfx/bubbles';
import { playPaddle, playSnort } from './sfx/swim';
import { playLand, playSplash, playSpray, playStep } from './sfx/impacts';
import { playRoar } from './sfx/roar';
import { playChainCue, playDiscover, playUiClick } from './sfx/ui';
import { playChirp, playGrumble, playHuff, playPurr, playPurrDeep, playShortRoar, playSnap, playSneeze, playTrill, playYawn } from './sfx/bond';
import { playBurstRush, playWhoosh, playWingSnap } from './sfx/maneuver';
import { playThunder } from './sfx/weather';
import { playGull } from './sfx/ambient';
import { playBirdFlap } from './sfx/bird-flap';
import { playStorkClatter, playStorkPass, playStorkWingbeat } from './sfx/storks';
import { placement, type Placement, type SfxEnv, type VoiceStats } from './sfx/voice';
import type { SampleBank } from './samples';
import { placeSource, type ListenerPose, type PlaceOptions, type Vec3 } from './spatial';
import { AmbienceVoice, emptyProbe, type AmbienceProbe } from './voices/ambience';
import { CreatureVoice } from './voices/creature';
import { SkidVoice } from './voices/skid';
import { FireVoice } from './voices/fire';
import { RainVoice } from './voices/rain';
import { UnderwaterVoice } from './voices/underwater';
import { SeaVoice } from './voices/sea';
import { SwimVoice } from './voices/swim';
import { WindVoice, defaultWindParams, speedLevel, type WindParams } from './voices/wind';
import { MomentBedVoice } from './voices/moment';

export type SoundName = AudioOneShot;

export interface DragonAudioState {
  present: boolean;
  position: Vec3;
  /** Body forward (unit). */
  forward: Vec3;
  /** Mouth position (fire / roar source). */
  mouth: Vec3;
  airspeed: number;
  aoa: number;
  sideslip: number;
  /** + = turning right (rad/s). */
  turnRate: number;
  /** + = rolling right (rad/s). */
  rollRate: number;
  /** 0..1 */
  diving: number;
  /** 0..1 */
  stall: number;
  firing: boolean;
  wingspan: number;
  /** 0..1 skimming low over water. */
  skim: number;
  /** 0..1 perceived-speed surge (race speeds and chain bursts in their context; wind.ts). */
  surge: number;
  /**
   * The sea reacting to low flight (lowFlight service, phase 21 stage 2): 0..1 downwash on the water, skim wake and
   * fire steam, the water point under the dragon and the steam point.
   */
  downwash: number;
  wake: number;
  steam: number;
  seaPoint: Vec3;
  steamPoint: Vec3;
  /** Standing, walking or swimming (breathing audible, footsteps). */
  grounded: boolean;
  /** 0..1 exertion (rig pose `breath`). */
  exertion: number;
  /** 0..1 braking skid of a run-out (rig pose `skid`). */
  skid: number;
  /** Ground speed (m/s). */
  groundSpeed: number;
  /** 0..1 floating posture while swimming (rig pose `swim`): the water bed around the body, strokes and snorts. */
  swimming: number;
}

/** Everything the audio engine needs for one frame. Filled in place by the system glue (no allocations). */
export interface AudioFrame {
  /** Real frame delta (s); audio keeps running while the simulation is paused. */
  dt: number;
  paused: boolean;
  cameraMode: CameraMode;
  listener: ListenerPose;
  /** Listener (camera) speed m/s, used as airflow in free/cinematic cameras. */
  listenerSpeed: number;
  dragon: DragonAudioState;
  /** Ambient wind speed m/s. */
  ambientWind: number;
  /** Rain intensity 0..1 (weather service). */
  rain: number;
  /** Storm (lightning) intensity 0..1 (weather service): loads the recorded thunder before the first strike. */
  storm: number;
  /** 0..1 the listener (camera) is under water (underwater service, smoothed), and its depth below the surface (m). */
  underwater: number;
  underwaterDepth: number;
  probe: AmbienceProbe;
}

const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });

export function createAudioFrame(): AudioFrame {
  return {
    dt: 0,
    paused: false,
    cameraMode: 'third',
    listener: { position: v3(), forward: v3(0, 0, -1), right: v3(1, 0, 0) },
    listenerSpeed: 0,
    dragon: {
      present: false,
      position: v3(),
      forward: v3(0, 0, -1),
      mouth: v3(0, 0, -8),
      airspeed: 0,
      aoa: 0,
      sideslip: 0,
      turnRate: 0,
      rollRate: 0,
      diving: 0,
      stall: 0,
      firing: false,
      wingspan: 18,
      skim: 0,
      surge: 0,
      downwash: 0,
      wake: 0,
      steam: 0,
      seaPoint: v3(),
      steamPoint: v3(),
      grounded: false,
      exertion: 0.2,
      skid: 0,
      groundSpeed: 0,
      swimming: 0,
    },
    ambientWind: 4,
    rain: 0,
    storm: 0,
    underwater: 0,
    underwaterDepth: 0,
    probe: emptyProbe(),
  };
}

/**
 * Per-sound mix trims (linear), balanced against the POV cruise wind with the offline analysis in sandbox/audio.ts
 * (pre-dynamics loudness). The absolute level into the master dynamics is set by master-bus INPUT_TRIM_DB.
 */
/** Splashes below this strength are light touches and play as a soft spray (playSpray). */
const SPRAY_MAX = 0.5;
/** Shortest gap between two sprays (s): a skim's spray events come several per second. */
const SPRAY_SPACING = 0.22;

export const MIX = {
  flap: 1.1,
  roar: 0.5,
  splash: 1.5,
  /** Light water touches (playSpray). */
  spray: 0.55,
  land: 1.55,
  ignition: 0.9,
  fire: 0.72,
  click: 0.9,
  discover: 0.95,
  breath: 0.5,
  step: 1.0,
  skid: 0.9,
  /** Airflow bed: players found it too loud and harsh at 1.0 (Sep 2026); the hiss and whistle were cut too. */
  wind: 0.55,
  ambience: 1.0,
  thunder: 0.85,
  wingSnap: 1.3,
  whoosh: 0.9,
  /** Chain bursts (phase 20): the forward rush of a burst and the chain-link tone (quiet: it plays often in a race). */
  burst: 0.75,
  chain: 0.32,
  purr: 1.1,
  /** Nostril bubbles under water: quiet, they repeat every half second. */
  bubbles: 0.45,
  /** Low flight over the sea: downwash buffeting, gust thumps and skim tearing (one channel), fire steam hiss. */
  sea: 1.0,
  steam: 0.8,
  /**
   * Swimming (phase 21 stage 5 v2, first-pass levels for the offline `swim` case): the water bed around the body, each
   * wing stroke's swoosh and trickle, the occasional snort.
   */
  swimBed: 0.9,
  paddle: 0.85,
  snort: 0.6,
  /**
   * Moments (src/moments): the storks' bill clatter, a nearby stork's wing beat and the air rush of one passing close,
   * and the soft open-air wind bed of the moment (its own level is MOMENT_BED_LEVEL).
   */
  storkClatter: 0.7,
  storkWing: 0.75,
  storkPass: 0.6,
  momentBed: 1.0,
} as const;

/** Under water: the airflow bed and the ambience (city, waves, rain from the air) keep only this much level. */
const UNDERWATER_WIND_KEEP = 0.03;
const UNDERWATER_AMBIENCE_KEEP = 0.3;
/** From above the water, the bubbles popping at the surface are this much quieter. */
const BUBBLES_ABOVE = 0.35;

/** Minimum retrigger interval per sound (s): merges duplicate triggers (event + direct call). */
const COOLDOWN: Record<SoundName, number> = {
  roar: 1.1,
  flap: 0.14,
  splash: 0.3,
  'fire-start': 0.35,
  land: 0.45,
  'ui-click': 0.035,
  discover: 1.5,
  thunder: 0.4,
  'wing-snap': 0.5,
  whoosh: 0.35,
  purr: 1.2,
};

/** Two chain links closer than this (s) make one sound. */
const CHAIN_COOLDOWN = 0.25;

const DRAGON_BODY: PlaceOptions = { refDistance: 26, reverb: 0.12, size: 18, delayAbove: 120 };
/**
 * Airflow exposure of the listener. The chase camera travels with the dragon and is mixed as "in the wind" too
 * (it is the state players spend most time in); the rider's POV adds its own buffeting, hiss and cloth on top.
 */
const EXPOSURE_THIRD = 1.2;
const EXPOSURE_POV = 1;
const EXPOSURE_FREE = 0.45;
/**
 * Level of the whole wind voice in POV (dB): the rider's airstream adds buffeting, hiss and cloth, and without this
 * trim the cruise bed measured 2.8 LU louder than the chase camera (wind-cruise-pov vs wind-cruise-third).
 */
const POV_WIND_TRIM_DB = -2.75;
/**
 * Flying low and fast, the airstream masks the city and the sea: the ambience bus is lifted by up to this much
 * (dB) and the wind's presence band, where waves, gulls and traffic live, is carved by up to WIND_CARVE_DB.
 */
const AMBIENCE_LIFT_DB = 5;
const WIND_CARVE_DB = -3;
const WIND_CARVE_HZ = 2200;
/** Event strengths below this knee scale linearly to silence; above it the floor keeps cruise beats clear. */
const FLAP_KNEE = 0.25;
/**
 * Flap event strength -> synthesis strength. Cruise beats arrive at 0.35-0.6: a floor keeps every beat a clear
 * "whoomp" while strong beats still grow. Below the knee (folding / near-surface strokes) the sound fades linearly
 * with the stroke, like the wings do. Values above 1 (explicit play('flap', vol)) pass through, capped at 1.5.
 */
function flapLevel(strength: number): number {
  if (strength > 1) {
    return Math.min(strength, 1.5);
  }
  const floored = (x: number): number => 0.45 + 0.55 * x;
  return strength >= FLAP_KNEE ? floored(strength) : (clamp01(strength) / FLAP_KNEE) * floored(FLAP_KNEE);
}
/**
 * Riding (POV) flap gain is (1 + boost): the beat comes through the saddle. The membranes are only 2-8 m from the
 * rider, so distance already makes it louder; the boost keeps POV cruise (flaps over the wind) within ~1 LU of the
 * chase camera (flap-cruise-pov vs flap-cruise-third).
 */
const FLAP_RIDER_BOOST = 0.15;
/** Chase-camera flap gain (+1.5 dB): keeps the beat as clear over the (EXPOSURE_THIRD) airstream as in POV. */
const FLAP_CHASE_GAIN = 1.19;
/** Wind-bed dip per full-strength flap (dB), plus extra when riding. Validated by the flap-cruise-* offline cases. */
const FLAP_DUCK_DB = 3;
const FLAP_DUCK_RIDER_DB = 2.5;
const DRAGON_MOUTH: PlaceOptions = { refDistance: 30, reverb: 0.2, size: 8, backCutoffFactor: 0.28, delayAbove: 120 };
const WORLD_POINT: PlaceOptions = { refDistance: 30, reverb: 0.18, size: 12, delayAbove: 80 };
/** A calling gull and a gull's wing beats (src/moments): small point sources. */
const GULL_POINT: PlaceOptions = { refDistance: 16, reverb: 0.14, size: 2, delayAbove: 80 };
const GULL_WING_POINT: PlaceOptions = { refDistance: 5, reverb: 0.08, size: 1.5, delayAbove: 80 };
/** The water under the dragon (downwash patch, wake) and the steam cloud: broad sources on the surface. */
const SEA_SURFACE: PlaceOptions = { refDistance: 28, reverb: 0.15, size: 24, delayAbove: 120 };
const STEAM_POINT: PlaceOptions = { refDistance: 26, reverb: 0.2, size: 8, delayAbove: 120 };
/** The water around the swimming body (a broad source) and one wing's paddle (beside the shoulder). */
const SWIM_BODY: PlaceOptions = { refDistance: 26, reverb: 0.12, size: 16, delayAbove: 120 };
const PADDLE_POINT: PlaceOptions = { refDistance: 26, reverb: 0.15, size: 6, delayAbove: 120 };
/** A stork (2 m wingspan) as a sound source: small, heard only up close. */
const STORK_POINT: PlaceOptions = { refDistance: 8, reverb: 0.12, size: 2, delayAbove: 80 };
/** Shortest gap (s) between two moment cues of the same kind. */
/**
 * Bond sounds (phase 06): level per cue and the shortest gap between two of the same kind (s). They sit at the head
 * (DRAGON_MOUTH) except the purrs, which come from the chest (DRAGON_BODY).
 */
const BOND_MIX: Record<BondAudioCue, number> = {
  'purr-deep': 1.15,
  chirp: 0.55,
  trill: 0.5,
  grumble: 0.75,
  yawn: 0.6,
  sneeze: 0.7,
  snap: 0.75,
  huff: 0.55,
  'roar-short': 0.5,
};
const BOND_SPACING: Record<BondAudioCue, number> = {
  'purr-deep': 1.4,
  chirp: 0.25,
  trill: 0.4,
  grumble: 0.8,
  yawn: 1.5,
  sneeze: 0.25,
  snap: 0.12,
  huff: 0.3,
  'roar-short': 1,
};
const MOMENT_CUE_SPACING: Record<MomentAudioCue, number> = { 'stork-clatter': 2.5, 'stork-wingbeat': 0.18, 'stork-pass': 0.5, 'gull-call': 0.9, 'gull-wingbeat': 0.5 };
/** A paddle sits this far out from the body's centre line (m), beside the shoulder. */
const PADDLE_OFFSET = 4;
/** Seconds between two snorts while swimming (random within). */
const SNORT_EVERY: readonly [number, number] = [7, 16];

export interface AudioEngineOptions {
  destination?: AudioNode;
  seed?: number;
  /** Pre-generated noise bank (from the worker); generated synchronously when omitted. */
  noise?: NoiseBank;
  /** Pre-generated reverb impulse response at the context's sample rate. */
  impulse?: AudioBuffer;
  /** Recorded sounds; every voice synthesizes when omitted. */
  samples?: SampleBank | null;
}

/**
 * Procedural audio engine. Works on any BaseAudioContext so the exact same graph can be rendered offline
 * (OfflineAudioContext) for level analysis.
 */
export class AudioEngine {
  readonly bus: MasterBus;
  readonly noise: NoiseBank;
  readonly stats: VoiceStats = { active: 0, started: 0 };
  readonly wind: WindVoice;
  readonly fire: FireVoice;
  readonly ambience: AmbienceVoice;
  readonly creature: CreatureVoice;
  readonly skid: SkidVoice;
  readonly rain: RainVoice;
  readonly underwater: UnderwaterVoice;
  readonly sea: SeaVoice;
  readonly swim: SwimVoice;
  readonly momentBed: MomentBedVoice;
  readonly samples: SampleBank | null;

  private readonly sfx: SfxEnv;
  private readonly ui: SfxEnv;
  private readonly amb: SfxEnv;
  /** One-shots in the water with an under-water listener (not muffled). */
  private readonly water: SfxEnv;
  private underwaterLevel = 0;
  private lastBubbles = -1e9;
  private lastSpray = -1e9;
  private frame: AudioFrame = createAudioFrame();
  private readonly windParams: WindParams = defaultWindParams();
  private lastChainAt = -1e9;
  private readonly lastPlayed: Record<SoundName, number> = {
    roar: -1e9,
    flap: -1e9,
    splash: -1e9,
    'fire-start': -1e9,
    land: -1e9,
    'ui-click': -1e9,
    discover: -1e9,
    thunder: -1e9,
    'wing-snap': -1e9,
    whoosh: -1e9,
    purr: -1e9,
  };
  private readonly windBusGain: SmoothParam;
  private readonly ambienceBusGain: SmoothParam;
  private readonly windCarve: BiquadFilterNode;
  private readonly windCarveGain: SmoothParam;
  /** Sidechain-style dip of the wind bed on each wing beat (automated per flap, never per frame). */
  private readonly windDuck: GainNode;
  private readonly place: Placement = placement();
  private readonly firePlace: Placement = placement();
  private readonly breathPlace: Placement = placement();
  private readonly skidPlace: Placement = placement();
  private readonly seaPlace: Placement = placement();
  private readonly steamPlace: Placement = placement();
  private readonly swimPlace: Placement = placement();
  private readonly paddlePos: Vec3 = { x: 0, y: 0, z: 0 };
  private lastPaddle = -1e9;
  private momentBedLevel = 0;
  private readonly lastBond: Partial<Record<BondAudioCue, number>> = {};
  private readonly lastCue: Record<MomentAudioCue, number> = { 'stork-clatter': -1e9, 'stork-wingbeat': -1e9, 'stork-pass': -1e9, 'gull-call': -1e9, 'gull-wingbeat': -1e9 };
  private nextSnort = 0;
  private readonly mouthOpts: PlaceOptions = { ...DRAGON_MOUTH };
  private readonly flapOpts: PlaceOptions = { ...DRAGON_BODY };
  private pov = 0;
  private reverbLevel = 1;
  private maxVoices = 56;
  private roarUntil = 0;
  private paused = false;

  constructor(
    readonly ctx: BaseAudioContext,
    opts: AudioEngineOptions = {},
  ) {
    const rng = mulberry32(opts.seed ?? ((Math.random() * 1e9) | 0));
    this.noise = opts.noise ?? createNoiseBank(ctx);
    this.samples = opts.samples ?? null;
    this.bus = createMasterBus(ctx, opts.destination, opts.impulse);
    const env = { ctx, noise: this.noise, samples: this.samples, rng, reverb: this.bus.reverbSend, stats: this.stats };
    this.sfx = { ...env, out: this.bus.sfx };
    this.ui = { ...env, out: this.bus.ui };
    this.amb = { ...env, out: this.bus.ambience };
    this.water = { ...env, out: this.bus.underwater };
    this.windDuck = ctx.createGain();
    this.windCarve = ctx.createBiquadFilter();
    this.windCarve.type = 'peaking';
    this.windCarve.frequency.value = WIND_CARVE_HZ;
    this.windCarve.Q.value = 0.9;
    this.windDuck.connect(this.windCarve).connect(this.bus.wind);
    this.windCarveGain = new SmoothParam(this.windCarve.gain, 0, 0.6, 0.015, 0.05);
    this.wind = new WindVoice(ctx, this.noise, this.windDuck, rng, this.samples);
    this.fire = new FireVoice(ctx, this.noise, rng, this.bus.sfx, this.bus.reverbSend, this.stats);
    this.ambience = new AmbienceVoice(ctx, this.noise, this.amb, this.bus.ambience, (rng() * 1e6) | 0);
    this.creature = new CreatureVoice(ctx, this.noise, this.bus.sfx, (rng() * 1e6) | 0);
    this.skid = new SkidVoice(ctx, this.noise, this.bus.sfx, (rng() * 1e6) | 0);
    this.rain = new RainVoice(ctx, this.noise, this.bus.ambience, rng, this.samples);
    this.underwater = new UnderwaterVoice(ctx, this.noise, this.bus.underwater, rng);
    this.sea = new SeaVoice(ctx, this.noise, this.bus.sfx, rng);
    this.swim = new SwimVoice(ctx, this.noise, this.bus.sfx, rng);
    this.momentBed = new MomentBedVoice(ctx, this.noise, this.bus.ambience, rng);
    this.windBusGain = new SmoothParam(this.bus.wind.gain, MIX.wind, 0.15);
    this.ambienceBusGain = new SmoothParam(this.bus.ambience.gain, MIX.ambience, 0.6);
  }

  get now(): number {
    return this.ctx.currentTime + 0.005;
  }

  get latestFrame(): Readonly<AudioFrame> {
    return this.frame;
  }

  update(frame: AudioFrame): void {
    this.frame = frame;
    const now = this.now;
    const dt = clamp(finiteOr(frame.dt, 0), 0, 0.1);
    this.pov += ((frame.cameraMode === 'pov' ? 1 : 0) - this.pov) * (1 - Math.exp(-dt * 5));
    // The rider's ears keep their buffeting, hiss and cloth, trimmed to the chase camera's loudness (no jump on C).
    const windLevel = Math.pow(10, (POV_WIND_TRIM_DB * this.pov) / 20);
    this.wind.setLevel(windLevel, now);

    const d = frame.dragon;
    const p = this.windParams;
    const riding = d.present && (frame.cameraMode === 'third' || frame.cameraMode === 'pov');
    if (riding) {
      p.airspeed = d.airspeed;
      p.aoa = d.aoa;
      p.sideslip = d.sideslip;
      p.turnRate = d.turnRate;
      p.rollRate = d.rollRate;
      p.diving = d.diving;
      p.stall = d.stall;
      p.skim = d.skim;
      p.surge = d.surge;
      p.exposure = lerp(EXPOSURE_THIRD, EXPOSURE_POV, this.pov);
    } else {
      p.airspeed = frame.listenerSpeed;
      p.aoa = 0;
      p.sideslip = 0;
      p.turnRate = 0;
      p.rollRate = 0;
      p.diving = 0;
      p.stall = 0;
      p.skim = 0;
      p.surge = 0;
      p.exposure = EXPOSURE_FREE;
    }
    p.pov = this.pov;
    p.ambientWind = frame.ambientWind;
    this.wind.update(p, now);

    if (d.present && d.firing && !this.fire.active) {
      this.fire.start(now, 1);
      this.play('fire-start');
    } else if ((!d.present || !d.firing) && this.fire.active) {
      this.fire.stop(now);
    }
    this.mouthOpts.facing = d.forward;
    if (this.fire.active) {
      const fp = placeSource(frame.listener, d.mouth, this.mouthOpts, this.firePlace);
      this.fire.place(fp.gain * MIX.fire * (1 + 0.25 * fp.closeness), fp.pan, fp.cutoff, fp.reverb, now);
    }

    const bp = placeSource(frame.listener, d.mouth, this.mouthOpts, this.breathPlace);
    this.creature.update(d.present && d.grounded && !this.fire.active && now > this.roarUntil, clamp01(d.exertion), bp.gain * MIX.breath, bp.pan, bp.cutoff, now);
    const sp = placeSource(frame.listener, d.position, WORLD_POINT, this.skidPlace);
    this.skid.update(d.present && d.grounded && !this.paused ? d.skid : 0, d.groundSpeed, sp.gain * MIX.skid, sp.pan, sp.cutoff, now);

    // The sea under a low-flying dragon (both channels silent and stopped while nothing is low over water).
    const seaOn = d.present && !this.paused;
    placeSource(frame.listener, d.seaPoint, SEA_SURFACE, this.seaPlace);
    placeSource(frame.listener, d.steamPoint, STEAM_POINT, this.steamPlace);
    this.sea.update(
      { downwash: seaOn ? finiteOr(d.downwash, 0) : 0, wake: seaOn ? finiteOr(d.wake, 0) : 0, speed: d.groundSpeed, steam: seaOn ? finiteOr(d.steam, 0) : 0 },
      this.seaPlace,
      this.steamPlace,
      MIX.sea,
      MIX.steam,
      now,
    );

    // Swimming: the water bed around the body, and now and then a snort (not while roaring or breathing fire).
    const swimming = d.present && !this.paused ? clamp01(finiteOr(d.swimming, 0)) : 0;
    placeSource(frame.listener, d.position, SWIM_BODY, this.swimPlace);
    this.swim.update({ swim: swimming, speed: d.groundSpeed }, this.swimPlace, MIX.swimBed, now);
    if (swimming < 0.5) {
      this.nextSnort = now + randRange(this.sfx.rng, 2.5, SNORT_EVERY[0]);
    } else if (now >= this.nextSnort) {
      this.nextSnort = now + randRange(this.sfx.rng, SNORT_EVERY[0], SNORT_EVERY[1]);
      if (!this.fire.active && now > this.roarUntil && this.stats.active <= this.maxVoices) {
        const pl = placeSource(frame.listener, d.mouth, this.mouthOpts, this.place);
        pl.gain *= MIX.snort;
        pl.closeness = this.bodyCloseness();
        playSnort(this.sfx, now, 0.7 + 0.5 * clamp01(d.exertion), pl);
      }
    }

    const roarDuck = now < this.roarUntil ? 1 : 0;
    const fireDuck = this.fire.active ? 1 : 0;
    const uw = clamp01(finiteOr(frame.underwater, 0));
    if (Math.abs(uw - this.underwaterLevel) > 0.01 || (uw === 0 && this.underwaterLevel !== 0) || (uw === 1 && this.underwaterLevel !== 1)) {
      this.underwaterLevel = uw;
      this.bus.setUnderwater(uw, now);
    }
    this.underwater.update(this.paused ? 0 : uw, finiteOr(frame.underwaterDepth, 0), frame.listenerSpeed, now);
    const windKeep = 1 - (1 - UNDERWATER_WIND_KEEP) * uw;
    this.windBusGain.set(MIX.wind * (1 - 0.4 * roarDuck) * (1 - 0.25 * fireDuck) * windKeep, now);

    this.ambience.update(frame.probe, dt, now, !this.paused, frame.listener.position.x, frame.listener.position.z);
    this.momentBed.update(this.paused ? 0 : this.momentBedLevel * MIX.momentBed * (1 - uw), now);
    if (frame.rain > 1e-3) {
      this.samples?.request('rain');
    }
    if (frame.storm > 1e-3) {
      this.samples?.request('storm');
    }
    if (frame.probe.coast > 0.02 || frame.probe.water > 0.02) {
      this.samples?.request('coast');
    }
    // Rain on the sea (phase 21 stage 6): the hiss of drops on open water while the listener is low over it.
    const rainSea = clamp01(finiteOr(frame.probe.water, 0)) * (1 - smoothstep(15, 140, finiteOr(frame.probe.agl, 1e3))) * (1 - uw);
    this.rain.update(this.paused ? 0 : frame.rain, this.pov, p.airspeed, now, rainSea);
    const masking = clamp01(1.6 * speedLevel(p.airspeed)) * (1 - smoothstep(150, 450, finiteOr(frame.probe.agl, 1e3)));
    this.ambienceBusGain.set(MIX.ambience * Math.pow(10, (AMBIENCE_LIFT_DB * masking * (1 - uw)) / 20) * (1 - (1 - UNDERWATER_AMBIENCE_KEEP) * uw), now);
    this.windCarveGain.set(WIND_CARVE_DB * masking, now);

    const reverbLevel = 1 - 0.55 * smoothstep(250, 1800, frame.probe.agl);
    if (Math.abs(reverbLevel - this.reverbLevel) > 0.02) {
      this.reverbLevel = reverbLevel;
      this.bus.setReverbLevel(reverbLevel, now);
    }
  }

  private ready(name: SoundName, now: number): boolean {
    if (now - this.lastPlayed[name] < COOLDOWN[name]) {
      return false;
    }
    this.lastPlayed[name] = now;
    return true;
  }

  /** 1 when the listener rides the dragon (POV), fading out by ~20 m: body-conducted bass for its voice. */
  private bodyCloseness(): number {
    const f = this.frame;
    if (!f.dragon.present) {
      return 0;
    }
    const a = f.listener.position;
    const b = f.dragon.position;
    const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    return 1 - smoothstep(4, 20, d);
  }

  private dragonSource(): Vec3 {
    const f = this.frame;
    return f.dragon.present ? f.dragon.position : f.listener.position;
  }

  /**
   * A chain link landed (phase 20 chain bursts): a short forward rush when it pushes (`dv` m/s) and a soft struck tone
   * whose pitch climbs with the chain (`link`), both scaled by `context` (full in a race, subtle in free flight).
   */
  chainLink(link: number, dv: number, context: number): void {
    const now = this.now;
    if (now - this.lastChainAt < CHAIN_COOLDOWN || context <= 0) {
      return;
    }
    this.lastChainAt = now;
    const f = this.frame;
    const k = clamp(context, 0, 1);
    if (dv > 0.5) {
      const pl = placeSource(f.listener, this.dragonSource(), DRAGON_BODY, this.place);
      pl.gain *= MIX.burst * k;
      playBurstRush(this.sfx, now, clamp(dv / 12, 0.3, 1.2), pl);
    }
    playChainCue(this.ui, now, MIX.chain * (0.55 + 0.45 * k), link);
  }

  play(name: SoundName, volume = 1): void {
    const now = this.now;
    if (!this.ready(name, now)) {
      return;
    }
    const f = this.frame;
    const vol = clamp(volume, 0, 2);
    switch (name) {
      case 'roar': {
        const pl = placeSource(f.listener, f.dragon.present ? f.dragon.mouth : f.listener.position, { ...DRAGON_MOUTH, facing: f.dragon.forward }, this.place);
        pl.gain *= MIX.roar * vol;
        pl.closeness = this.bodyCloseness();
        const dur = playRoar(this.sfx, now, 1, pl);
        this.roarUntil = now + dur;
        break;
      }
      case 'flap':
        this.flapNow(vol, now);
        break;
      case 'splash':
        this.splashNow(this.dragonSource(), vol, now);
        break;
      case 'land':
        this.landNow(this.dragonSource(), vol, now);
        break;
      case 'fire-start': {
        const pl = placeSource(f.listener, f.dragon.present ? f.dragon.mouth : f.listener.position, { ...DRAGON_MOUTH, facing: f.dragon.forward }, this.place);
        pl.gain *= MIX.ignition * vol;
        pl.closeness = this.bodyCloseness();
        playIgnition(this.sfx, now, 1, pl);
        break;
      }
      case 'ui-click':
        playUiClick(this.ui, now, MIX.click * vol);
        break;
      case 'discover':
        playDiscover(this.ui, now, MIX.discover * vol);
        break;
      case 'thunder': {
        this.samples?.request('storm');
        // A world sound without a position: the storm is all around; volume encodes distance.
        const pl = placement({ gain: MIX.thunder * Math.min(vol, 1), pan: (this.sfx.rng() - 0.5) * 1.2, reverb: 0.45, width: 1, cutoff: 2500 + 14000 * Math.min(vol, 1) });
        playThunder(this.sfx, now, Math.min(vol, 1), pl);
        break;
      }
      case 'wing-snap': {
        const pl = placeSource(f.listener, this.dragonSource(), DRAGON_BODY, this.place);
        pl.gain *= MIX.wingSnap * vol;
        pl.closeness = this.bodyCloseness();
        playWingSnap(this.sfx, now, 1, pl);
        break;
      }
      case 'whoosh': {
        const pl = placeSource(f.listener, this.dragonSource(), DRAGON_BODY, this.place);
        pl.gain *= MIX.whoosh * vol;
        playWhoosh(this.sfx, now, 1, pl);
        break;
      }
      case 'purr': {
        const pl = placeSource(f.listener, this.dragonSource(), DRAGON_BODY, this.place);
        pl.gain *= MIX.purr * Math.min(vol, 1);
        pl.closeness = this.bodyCloseness();
        // The volume also deepens the purr (affection, phase 06).
        playPurr(this.sfx, now, vol, pl);
        break;
      }
    }
  }

  /** A bond sound of the dragon (phase 06): at the head, or the chest for the deep purr. `volume` 0..1.5. */
  bondCue(cue: BondAudioCue, volume = 1): void {
    const now = this.now;
    if (this.paused || this.stats.active > this.maxVoices || now - (this.lastBond[cue] ?? -1e9) < BOND_SPACING[cue]) {
      return;
    }
    this.lastBond[cue] = now;
    const f = this.frame;
    const vol = clamp(finiteOr(volume, 1), 0, 1.5);
    const chest = cue === 'purr-deep';
    const pl = chest
      ? placeSource(f.listener, this.dragonSource(), DRAGON_BODY, this.place)
      : placeSource(f.listener, f.dragon.present ? f.dragon.mouth : f.listener.position, { ...DRAGON_MOUTH, facing: f.dragon.forward }, this.place);
    pl.gain *= BOND_MIX[cue] * Math.min(vol, 1);
    pl.closeness = this.bodyCloseness();
    const synth = {
      'purr-deep': playPurrDeep,
      chirp: playChirp,
      trill: playTrill,
      grumble: playGrumble,
      yawn: playYawn,
      sneeze: playSneeze,
      snap: playSnap,
      huff: playHuff,
      'roar-short': playShortRoar,
    }[cue];
    synth(this.sfx, now, vol, pl);
  }

  /** Soft open-air wind bed of a playing moment, 0..1 (smoothed by the voice). */
  setMomentBed(amount: number): void {
    this.momentBedLevel = clamp01(finiteOr(amount, 0));
  }

  /**
   * A positional cue of a moment's creatures at `position` (world): bill clatter, a wing beat, a close pass. `volume`
   * 0..1.5 on top of the distance; `panFrom` (pass only) is where the rush starts in the stereo field.
   */
  momentCue(cue: MomentAudioCue, position: Vec3, volume = 1, panFrom = 0): void {
    const now = this.now;
    if (this.paused || this.stats.active > this.maxVoices || now - this.lastCue[cue] < MOMENT_CUE_SPACING[cue]) {
      return;
    }
    if (!Number.isFinite(position.x + position.y + position.z)) {
      return;
    }
    this.lastCue[cue] = now;
    const pl = placeSource(this.frame.listener, position, cue === 'gull-call' ? GULL_POINT : cue === 'gull-wingbeat' ? GULL_WING_POINT : STORK_POINT, this.place);
    const vol = clamp(finiteOr(volume, 1), 0, 1.5);
    switch (cue) {
      case 'stork-clatter':
        pl.gain *= MIX.storkClatter;
        playStorkClatter(this.sfx, now, vol, pl);
        break;
      case 'stork-wingbeat':
        pl.gain *= MIX.storkWing;
        playStorkWingbeat(this.sfx, now, vol, pl);
        break;
      case 'stork-pass':
        pl.gain *= MIX.storkPass;
        playStorkPass(this.sfx, now, vol, pl, panFrom);
        break;
      case 'gull-call':
        // On the ambience bus with the other gulls, so it follows the coastal mix; silent until the recordings load.
        this.samples?.request('coast');
        pl.gain *= Math.min(1, vol);
        playGull(this.amb, now, pl);
        break;
      case 'gull-wingbeat':
        playBirdFlap(this.amb, now, Math.min(1, vol), pl);
        break;
    }
  }

  /** Wing beat with strength 0..1 (from 'flap' events). */
  flap(strength: number): void {
    const now = this.now;
    if (Number.isFinite(strength) && this.ready('flap', now)) {
      this.flapNow(strength, now);
    }
  }

  splashAt(position: Vec3, strength: number): void {
    const now = this.now;
    // Light touches (skim spray, wingtip and tail kisses, swimming strokes) are frequent: a soft spray, spaced and
    // thinned out, never the full splash (a fast series of those sounded like slaps on concrete).
    if (strength < SPRAY_MAX) {
      if (now - this.lastSpray < SPRAY_SPACING || this.stats.active > this.maxVoices) {
        return;
      }
      this.lastSpray = now;
      const pl = placeSource(this.frame.listener, position, WORLD_POINT, this.place);
      pl.gain *= MIX.spray;
      playSpray(this.sfx, now, strength, pl);
    } else if (this.ready('splash', now)) {
      this.splashNow(position, strength, now);
    }
  }

  /**
   * One wing stroke of the swimming dragon (from the rig's swim phase): the membrane's soft swoosh through the water and
   * the trickle as the wing lifts out. `strength` 0..1 (stroke strength), `side` -1 left / 1 right wing, `power` the
   * power stroke's length (s). Never the splash.
   */
  swimStroke(strength: number, side: number, power: number): void {
    const now = this.now;
    const f = this.frame;
    const s = clamp(finiteOr(strength, 0), 0, 1.2);
    if (!f.dragon.present || s < 0.05 || now - this.lastPaddle < 0.12 || this.stats.active > this.maxVoices) {
      return;
    }
    this.lastPaddle = now;
    const d = f.dragon;
    // Beside the shoulder on that side (right of the heading is (-forward.z, forward.x)).
    const fl = Math.hypot(d.forward.x, d.forward.z) || 1;
    const sd = side < 0 ? -1 : 1;
    this.paddlePos.x = d.position.x + (-d.forward.z / fl) * PADDLE_OFFSET * sd + (d.forward.x / fl) * 1.5;
    this.paddlePos.y = d.position.y + 0.6;
    this.paddlePos.z = d.position.z + (d.forward.x / fl) * PADDLE_OFFSET * sd + (d.forward.z / fl) * 1.5;
    const pl = placeSource(f.listener, this.paddlePos, PADDLE_POINT, this.place);
    pl.gain *= MIX.paddle;
    pl.closeness = Math.max(pl.closeness, this.bodyCloseness() * 0.6);
    playPaddle(this.sfx, now, s, pl, finiteOr(power, 0.6));
  }

  /**
   * Nostril bubbles of the dragon under water (replaces the stage 3 surface splash cue): quiet, varied bloops; heard
   * in full with the listener under water, faint pops at the surface from above.
   */
  bubblesAt(position: Vec3, strength: number): void {
    const now = this.now;
    if (now - this.lastBubbles < 0.12 || this.stats.active > this.maxVoices) {
      return;
    }
    this.lastBubbles = now;
    const under = this.underwaterLevel > 0.5;
    const pl = placeSource(this.frame.listener, position, WORLD_POINT, this.place);
    pl.gain *= MIX.bubbles * (under ? 1 : BUBBLES_ABOVE);
    if (under) {
      // Sound travels ~4.3x faster in water and the ear cannot place it well: no air delay or absorption, narrow pan.
      pl.delay = 0;
      pl.cutoff = 20000;
      pl.pan *= 0.5;
    }
    playBubbles(under ? this.water : this.sfx, now, 0.6 + 0.8 * clamp01(strength * 10), pl, under);
  }

  /** Ground impact at `speed` m/s. */
  landAt(position: Vec3, speed: number): void {
    const now = this.now;
    if (this.ready('land', now)) {
      this.landNow(position, clamp01(speed / 18) * 1.2 + 0.15, now);
    }
  }

  private flapNow(strength: number, now: number): void {
    if (this.stats.active > this.maxVoices) {
      return;
    }
    const f = this.frame;
    const s = flapLevel(strength);
    if (s < 0.02) {
      return;
    }
    const close = this.bodyCloseness();
    this.flapOpts.size = f.dragon.wingspan;
    const pl = placeSource(f.listener, this.dragonSource(), this.flapOpts, this.place);
    // Riding between the wings the membranes are 2-8 m away and the beat is felt through the saddle.
    pl.gain *= MIX.flap * lerp(FLAP_CHASE_GAIN, 1 + FLAP_RIDER_BOOST, close);
    pl.closeness = Math.max(pl.closeness, close);
    pl.width = Math.max(pl.width, 0.35 + 0.65 * this.pov);
    playFlap(this.sfx, now, s, pl);
    this.duckWind(now + pl.delay, clamp01(s) * (FLAP_DUCK_DB + FLAP_DUCK_RIDER_DB * close));
    // Over the water the beat's gust slaps the surface a moment later (the air takes ~0.1 s to get down there).
    if (this.sea.downwash > 0.05) {
      this.sea.gust(clamp01(strength) * this.sea.downwash, now + this.seaPlace.delay + 0.08);
    }
  }

  /** Dips the wind bed by `db` for ~250 ms: the beat's own air push momentarily masks the airstream noise. */
  private duckWind(when: number, db: number): void {
    const g = this.windDuck.gain;
    const t = Math.max(when, this.ctx.currentTime);
    // Only later events are cancelled: the dip already in progress continues smoothly into the new one.
    g.cancelScheduledValues(t);
    g.setTargetAtTime(Math.pow(10, -db / 20), t, 0.03);
    g.setTargetAtTime(1, t + 0.18, 0.12);
  }

  /** Footfall (from the rig's gait phase). `side` -1 left, 1 right. */
  step(strength: number, side: number): void {
    const f = this.frame;
    if (!f.dragon.present || this.stats.active > this.maxVoices) {
      return;
    }
    const pl = placeSource(f.listener, f.dragon.position, WORLD_POINT, this.place);
    pl.gain *= MIX.step;
    pl.pan = clamp(pl.pan + side * 0.25 * (0.3 + 0.7 * this.pov), -1, 1);
    playStep(this.sfx, this.now, strength, pl);
  }

  private splashNow(position: Vec3, strength: number, now: number): void {
    const pl = placeSource(this.frame.listener, position, WORLD_POINT, this.place);
    pl.gain *= MIX.splash;
    playSplash(this.sfx, now, strength, pl);
  }

  private landNow(position: Vec3, strength: number, now: number): void {
    const pl = placeSource(this.frame.listener, position, WORLD_POINT, this.place);
    pl.gain *= MIX.land;
    playLand(this.sfx, now, strength, pl);
  }

  /** 'low' quality: no convolution reverb and a smaller one-shot voice budget. */
  setQuality(preset: string): void {
    const low = preset === 'low';
    this.bus.setReverbEnabled(!low);
    this.ambience.maxVoices = low ? 20 : 40;
    this.maxVoices = low ? 28 : 56;
  }

  setVolume(volume: number): void {
    this.bus.setVolume(volume, this.ctx.currentTime);
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.bus.setDuck(paused ? 1 : 0, this.ctx.currentTime);
  }

  dispose(): void {
    this.wind.dispose();
    this.fire.dispose();
    this.ambience.dispose();
    this.creature.dispose();
    this.skid.dispose();
    this.rain.dispose(this.ctx.currentTime);
    this.underwater.dispose(this.ctx.currentTime);
    this.sea.dispose(this.ctx.currentTime);
    this.swim.dispose(this.ctx.currentTime);
    this.momentBed.dispose(this.ctx.currentTime);
    this.windDuck.disconnect();
    this.windCarve.disconnect();
    this.bus.dispose();
  }
}
