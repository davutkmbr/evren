import type { CameraMode } from '../core/contracts';
import { clamp, clamp01, finiteOr, lerp, smoothstep } from './dsp/math';
import { createNoiseBank, type NoiseBank } from './dsp/noise';
import { SmoothParam } from './dsp/param';
import { mulberry32 } from './dsp/rng';
import { createMasterBus, type MasterBus } from './master-bus';
import { playIgnition } from './sfx/fire';
import { playFlap } from './sfx/flap';
import { playLand, playSplash, playStep } from './sfx/impacts';
import { playRoar } from './sfx/roar';
import { playDiscover, playUiClick } from './sfx/ui';
import { placement, type Placement, type SfxEnv, type VoiceStats } from './sfx/voice';
import { placeSource, type ListenerPose, type PlaceOptions, type Vec3 } from './spatial';
import { AmbienceVoice, emptyProbe, type AmbienceProbe } from './voices/ambience';
import { CreatureVoice } from './voices/creature';
import { FireVoice } from './voices/fire';
import { WindVoice, defaultWindParams, speedLevel, type WindParams } from './voices/wind';

export type SoundName = 'roar' | 'flap' | 'splash' | 'fire-start' | 'land' | 'ui-click' | 'discover';

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
  /** Standing, walking or swimming (breathing audible, footsteps). */
  grounded: boolean;
  /** 0..1 exertion (rig pose `breath`). */
  exertion: number;
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
      grounded: false,
      exertion: 0.2,
    },
    ambientWind: 4,
    probe: emptyProbe(),
  };
}

/**
 * Per-sound mix trims (linear), balanced against the POV cruise wind with the offline analysis in sandbox/audio.ts
 * (pre-dynamics loudness). The absolute level into the master dynamics is set by master-bus INPUT_TRIM_DB.
 */
export const MIX = {
  flap: 1.35,
  roar: 0.5,
  splash: 1.5,
  land: 1.55,
  ignition: 0.9,
  fire: 0.72,
  click: 0.9,
  discover: 0.95,
  breath: 0.5,
  step: 1.0,
  wind: 1.0,
  ambience: 1.0,
} as const;

/** Minimum retrigger interval per sound (s): merges duplicate triggers (event + direct call). */
const COOLDOWN: Record<SoundName, number> = {
  roar: 1.1,
  flap: 0.14,
  splash: 0.3,
  'fire-start': 0.35,
  land: 0.45,
  'ui-click': 0.035,
  discover: 1.5,
};

const DRAGON_BODY: PlaceOptions = { refDistance: 26, reverb: 0.12, size: 18, delayAbove: 120 };
/**
 * Airflow exposure of the listener. The chase camera travels with the dragon and is mixed as "in the wind" too
 * (it is the state players spend most time in); the rider's POV adds its own buffeting, hiss and cloth on top.
 */
const EXPOSURE_THIRD = 1.2;
const EXPOSURE_POV = 1;
const EXPOSURE_FREE = 0.45;
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
/** Riding (POV) flap gain is (1 + boost): the membranes are 2-8 m from the rider and the beat comes through the saddle. */
const FLAP_RIDER_BOOST = 0.75;
/** Chase-camera flap gain (+1.5 dB): keeps the beat as clear over the (EXPOSURE_THIRD) airstream as in POV. */
const FLAP_CHASE_GAIN = 1.19;
/** Wind-bed dip per full-strength flap (dB), plus extra when riding. Validated by the flap-cruise-* offline cases. */
const FLAP_DUCK_DB = 3;
const FLAP_DUCK_RIDER_DB = 2.5;
const DRAGON_MOUTH: PlaceOptions = { refDistance: 30, reverb: 0.2, size: 8, backCutoffFactor: 0.28, delayAbove: 120 };
const WORLD_POINT: PlaceOptions = { refDistance: 30, reverb: 0.18, size: 12, delayAbove: 80 };

export interface AudioEngineOptions {
  destination?: AudioNode;
  seed?: number;
  /** Pre-generated noise bank (from the worker); generated synchronously when omitted. */
  noise?: NoiseBank;
  /** Pre-generated reverb impulse response at the context's sample rate. */
  impulse?: AudioBuffer;
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

  private readonly sfx: SfxEnv;
  private readonly ui: SfxEnv;
  private readonly amb: SfxEnv;
  private frame: AudioFrame = createAudioFrame();
  private readonly windParams: WindParams = defaultWindParams();
  private readonly lastPlayed: Record<SoundName, number> = {
    roar: -1e9,
    flap: -1e9,
    splash: -1e9,
    'fire-start': -1e9,
    land: -1e9,
    'ui-click': -1e9,
    discover: -1e9,
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
  private readonly mouthOpts: PlaceOptions = { ...DRAGON_MOUTH };
  private readonly flapOpts: PlaceOptions = { ...DRAGON_BODY };
  private pov = 0;
  private reverbLevel = 1;
  private maxVoices = 56;
  private roarUntil = 0;
  private paused = false;
  private started = false;

  constructor(
    readonly ctx: BaseAudioContext,
    opts: AudioEngineOptions = {},
  ) {
    const rng = mulberry32(opts.seed ?? ((Math.random() * 1e9) | 0));
    this.noise = opts.noise ?? createNoiseBank(ctx);
    this.bus = createMasterBus(ctx, opts.destination, opts.impulse);
    this.sfx = { ctx, noise: this.noise, rng, out: this.bus.sfx, reverb: this.bus.reverbSend, stats: this.stats };
    this.ui = { ctx, noise: this.noise, rng, out: this.bus.ui, reverb: this.bus.reverbSend, stats: this.stats };
    this.amb = { ctx, noise: this.noise, rng, out: this.bus.ambience, reverb: this.bus.reverbSend, stats: this.stats };
    this.windDuck = ctx.createGain();
    this.windCarve = ctx.createBiquadFilter();
    this.windCarve.type = 'peaking';
    this.windCarve.frequency.value = WIND_CARVE_HZ;
    this.windCarve.Q.value = 0.9;
    this.windDuck.connect(this.windCarve).connect(this.bus.wind);
    this.windCarveGain = new SmoothParam(this.windCarve.gain, 0, 0.6, 0.015, 0.05);
    this.wind = new WindVoice(ctx, this.noise, this.windDuck, rng);
    this.fire = new FireVoice(ctx, this.noise, rng, this.bus.sfx, this.bus.reverbSend, this.stats);
    this.ambience = new AmbienceVoice(ctx, this.noise, this.amb, this.bus.ambience, (rng() * 1e6) | 0);
    this.creature = new CreatureVoice(ctx, this.noise, this.bus.sfx, (rng() * 1e6) | 0);
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
    if (!this.started) {
      this.started = true;
      this.wind.setLevel(1, now);
    }
    this.pov += ((frame.cameraMode === 'pov' ? 1 : 0) - this.pov) * (1 - Math.exp(-dt * 5));

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

    const roarDuck = now < this.roarUntil ? 1 : 0;
    const fireDuck = this.fire.active ? 1 : 0;
    this.windBusGain.set(MIX.wind * (1 - 0.4 * roarDuck) * (1 - 0.25 * fireDuck), now);

    this.ambience.update(frame.probe, dt, now, !this.paused);
    const masking = clamp01(1.6 * speedLevel(p.airspeed)) * (1 - smoothstep(150, 450, finiteOr(frame.probe.agl, 1e3)));
    this.ambienceBusGain.set(MIX.ambience * Math.pow(10, (AMBIENCE_LIFT_DB * masking) / 20), now);
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
    // Wading steps are small and frequent; only big splashes need the long merge window.
    if (strength < 0.5 && now - this.lastPlayed.splash > 0.12) {
      this.lastPlayed.splash = now;
      this.splashNow(position, strength, now);
    } else if (this.ready('splash', now)) {
      this.splashNow(position, strength, now);
    }
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
    this.windDuck.disconnect();
    this.windCarve.disconnect();
    this.bus.dispose();
  }
}
