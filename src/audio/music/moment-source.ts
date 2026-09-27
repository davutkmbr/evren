/**
 * Moment music sources (pure, no Web Audio): moment music is never heard "directly". A moment with a place plays its
 * piece from a source in the world (a horn gramophone on a yalı balcony, a coffeehouse heard from the street, a
 * Karagöz tent, a deck radio on a ferry); a moment in open sky or sea hears it as a distant memory. This module is the
 * testable core: the tuning tables, the distance / wind / night mapping (`sourceMix`) and the per-voice state
 * (`SourceTracker`: opening on the moment's start, closing after it, the world-to-memory cross-fade). The Web Audio
 * graph (./source-graph.ts) only applies the numbers; the headless check (tools/headless/music-source-check.ts) runs
 * the same functions.
 *
 *   world kinds  positional: level and cutoff fall with distance (the highs first, then the level), the reach grows at
 *                night over calm water, speed and the wind mask the music (hover, perch or stand close to hear it)
 *   memory       not attenuated: a long airy reverb, band-limited, a slow wow and flutter; panned toward the moment's
 *                subject (`from`) or centred and diffuse
 *
 * Tuning numbers are collected in SOURCE_TUNING, WORLD_CHAINS and MEMORY_CHAIN (see .docs/audio/music-system.md,
 * Moment music sources).
 */
import type { FlightMode } from '../../core/contracts';
import { clamp, clamp01, smoothstep } from '../dsp/math';
import type { ListenerPose, Vec3 } from '../spatial';

export const MUSIC_SOURCE_KINDS = ['gramophone', 'venue', 'live', 'ferry', 'memory'] as const;
export type MusicSourceKind = (typeof MUSIC_SOURCE_KINDS)[number];
export type WorldSourceKind = Exclude<MusicSourceKind, 'memory'>;

export function isWorldKind(kind: MusicSourceKind): kind is WorldSourceKind {
  return kind !== 'memory';
}

/** Effect chain and distance behaviour of one world source kind. */
export interface WorldChainTuning {
  /** Day reach (m): the lead-in starts inside it; silent at it. Scaled by the night carry and the record's reachScale. */
  reach: number;
  /** Full level inside this distance (m). */
  ref: number;
  /** Default height of the source above the ground (m) when the record gives none. */
  height: number;
  /** Band limits of the chain (Hz) and the low-pass resonance. */
  hpHz: number;
  lpHz: number;
  lpQ: number;
  /** Mid resonance (peaking filter). */
  peakHz: number;
  peakDb: number;
  peakQ: number;
  /** Saturation amount 0..1 (0 = clean). */
  drive: number;
  /** Room reverb send and which room it goes into ('street': short room + facade reflections, 'tent': warm small room). */
  room: number;
  roomIr: 'street' | 'tent';
  /** Image width 0..1 (a short opposite-side copy). */
  width: number;
  /** Send into the city's open-air reverb at `ref` (grows with distance). */
  openAir: number;
  /** Level trim (linear). */
  level: number;
}

export const WORLD_CHAINS: Readonly<Record<WorldSourceKind, WorldChainTuning>> = {
  // A horn gramophone on a balcony or at a window: narrow, a little metallic, a touch of saturation.
  gramophone: { reach: 420, ref: 12, height: 6, hpHz: 300, lpHz: 4000, lpQ: 0.9, peakHz: 1300, peakDb: 4, peakQ: 1.4, drive: 0.35, room: 0.1, roomIr: 'street', width: 0.1, openAir: 0.22, level: 1 },
  // A coffeehouse or tavern heard from the street: muffled by walls and windows, a short room, the facades answer.
  venue: { reach: 380, ref: 18, height: 3, hpHz: 110, lpHz: 1500, lpQ: 0.6, peakHz: 450, peakDb: 2.5, peakQ: 0.9, drive: 0, room: 0.55, roomIr: 'street', width: 0.35, openAir: 0.25, level: 1.15 },
  // A Karagöz tent or a fasıl band: closer and warmer, a light room, a wider image.
  live: { reach: 480, ref: 20, height: 2, hpHz: 70, lpHz: 9000, lpQ: 0.6, peakHz: 260, peakDb: 1.5, peakQ: 0.8, drive: 0, room: 0.3, roomIr: 'tent', width: 0.7, openAir: 0.2, level: 1 },
  // A deck radio on a moving ferry: a small speaker, boxy and bright, on an open deck.
  ferry: { reach: 400, ref: 10, height: 8, hpHz: 480, lpHz: 3300, lpQ: 1, peakHz: 1900, peakDb: 5, peakQ: 2.2, drive: 0.55, room: 0.05, roomIr: 'street', width: 0.1, openAir: 0.3, level: 0.95 },
};

/** The memory treatment: a large airy reverb, band-limited, soft highs, a slow wow and flutter. */
export const MEMORY_CHAIN = {
  hpHz: 170,
  lpHz: 5200,
  /** High shelf that softens the top. */
  shelfHz: 2800,
  shelfDb: -5,
  /** Hall (long airy IR) send and the dry level with a direction (`from`) or centred and diffuse. */
  hallFrom: 0.7,
  hallDiffuse: 1,
  dryFrom: 0.8,
  dryDiffuse: 0.45,
  /** Wow (slow pitch wobble) and flutter: modulation of a short delay (ms of depth). ~±6 cents of wow. */
  wowHz: 0.55,
  wowMs: 1.1,
  flutterHz: 6.3,
  flutterMs: 0.035,
  /** Pan toward `from` (0..1 of the lateral component). */
  panFrom: 0.6,
  level: 0.9,
} as const;

export const SOURCE_TUNING = {
  /** Reach × (1 + nightCarry · night · calm · water). */
  nightCarry: 0.6,
  /** Air absorption: cutoff from nearCutoffHz (at the source) to farCutoffHz (at the reach), log-lerped by u^cutoffCurve. */
  nearCutoffHz: 16000,
  farCutoffHz: 850,
  cutoffCurve: 0.6,
  /** Level: (ref / d)^rolloff, faded from fadeStart·reach to 0 at the reach (the highs go first, then the level). */
  rolloff: 0.5,
  fadeStart: 0.45,
  /** Wind mask: 0 below windMinSpeed, 1 at windMaxSpeed (m/s airspeed); hovering at most hoverMask; diving full. */
  windMinSpeed: 6,
  windMaxSpeed: 45,
  hoverMask: 0.12,
  /** At full mask: cutoff × windCutoff and the level windDuckDb (world); memory gentler. */
  windCutoff: 0.22,
  windDuckDb: -10,
  memoryWindCutoff: 0.6,
  memoryWindDuckDb: -4,
  /** Perched or standing within standRadius (m): the clearest sound. */
  standRadius: 60,
  standBoostDb: 2,
  standCutoff: 1.25,
  /** Opening when the moment's subtitles begin: +openGainDb, cutoff × openCutoff, room × (1 - openDry). */
  openGainDb: 3,
  openCutoff: 1.6,
  openDry: 0.35,
  openSec: 2,
  closeSec: 3,
  /** World ↔ memory mid-moment: memory beyond memoryAt · reach, back to the world inside worldAt · reach. */
  memoryAt: 0.9,
  worldAt: 0.6,
  memoryFadeSec: 4,
  /** A lead-in / world voice stops (fades) beyond releaseAt · reach. */
  releaseAt: 1.08,
  /** The largest reach any record can have (m): the moments system looks for lead-in candidates within it. */
  maxReach: 1600,
} as const;

/** What the moments system tells the music about one source (resolved every frame; positions in world meters). */
export interface MomentSourceSpec {
  momentId: string;
  kind: MusicSourceKind;
  /** World kinds: where the music plays (m). Null for memory. */
  position: Vec3 | null;
  /** Memory: the moment's subject the memory comes from, or null (centred, diffuse). */
  from: Vec3 | null;
  /** The source stands over or by the water (a ferry, a shore coffeehouse): the night carry applies from the land too. */
  overWater: boolean;
  /** Record's reach multiplier (default 1). */
  reachScale: number;
  /** Moving anchor the source follows (a ferry id). */
  anchorId?: number;
  /** For choosing the piece of a lead-in (as MomentMusicRequest). */
  musicId: string | null;
  category: string | null;
  mood: readonly string[];
}

/** The world around the listener that shapes a source (read once per frame by the controller). */
export interface SourceEnv {
  night: number;
  /** Ambient wind speed (m/s). */
  windSpeed: number;
  rain: number;
  storm: number;
  /** The listener is over water. */
  overWater: boolean;
  airspeed: number;
  mode: FlightMode | 'none';
  perched: boolean;
}

/** Output of the pure mapping: what the graph applies. */
export interface SourceMix {
  kind: MusicSourceKind;
  /** Effective reach (m) and the distance (m) listener → source (NaN for memory). */
  reach: number;
  distance: number;
  /** World branch: level (linear, before the memory cross-fade), low-pass (Hz), sends, pan, width. */
  level: number;
  cutoff: number;
  room: number;
  openAir: number;
  pan: number;
  width: number;
  /** Memory branch. */
  memLevel: number;
  memCutoff: number;
  memDry: number;
  memHall: number;
  memPan: number;
  /** 0 world .. 1 memory (the graph cross-fades with equal power). */
  memory: number;
  /** 0..1 opening. */
  open: number;
  windMask: number;
  /** 0..1, for the debug line: how clearly the music reaches the player. */
  clarity: number;
  /** Overall audible level (for ducking the world music while a lead-in plays). */
  audible: number;
}

export function emptySourceMix(): SourceMix {
  return { kind: 'memory', reach: 0, distance: Number.NaN, level: 0, cutoff: 20000, room: 0, openAir: 0, pan: 0, width: 0, memLevel: 0, memCutoff: 5000, memDry: 0, memHall: 0, memPan: 0, memory: 1, open: 0, windMask: 0, clarity: 0, audible: 0 };
}

const db = (v: number): number => Math.pow(10, v / 20);
const fin = (v: number, fallback: number): number => (Number.isFinite(v) ? v : fallback);

/** Calm air for the night carry: little wind, no rain or storm (0..1). */
export function calmness(env: Pick<SourceEnv, 'windSpeed' | 'rain' | 'storm'>): number {
  return clamp01((1 - smoothstep(3, 9, fin(env.windSpeed, 4))) * (1 - 0.7 * clamp01(fin(env.rain, 0))) * (1 - clamp01(fin(env.storm, 0))));
}

/** Reach (m) of a world source now: the kind's reach × the record's scale × the night carry over calm water. */
export function sourceReach(kind: WorldSourceKind, reachScale: number, env: Pick<SourceEnv, 'night' | 'windSpeed' | 'rain' | 'storm' | 'overWater'>, sourceOverWater = false): number {
  const water = env.overWater || sourceOverWater ? 1 : 0;
  const carry = 1 + SOURCE_TUNING.nightCarry * clamp01(fin(env.night, 0)) * calmness(env) * water;
  return WORLD_CHAINS[kind].reach * clamp(fin(reachScale, 1), 0.25, 2) * carry;
}

/** Wind masking 0..1 from the dragon's speed and mode: perched, grounded or swimming hear everything. */
export function windMask(airspeed: number, mode: FlightMode | 'none', perched: boolean): number {
  if (perched || mode === 'grounded' || mode === 'swimming' || mode === 'underwater' || mode === 'none') {
    return 0;
  }
  const t = SOURCE_TUNING;
  const m = smoothstep(t.windMinSpeed, t.windMaxSpeed, fin(airspeed, 0));
  if (mode === 'hovering') {
    return Math.min(t.hoverMask, m);
  }
  if (mode === 'diving') {
    return Math.max(0.9, m);
  }
  return m;
}

/** Air absorption of a world source: cutoff (Hz) at normalised distance u = d / reach (pure). */
export function distanceCutoff(u: number): number {
  const t = SOURCE_TUNING;
  const k = Math.pow(clamp01(fin(u, 1)), t.cutoffCurve);
  return Math.exp(Math.log(t.nearCutoffHz) + (Math.log(t.farCutoffHz) - Math.log(t.nearCutoffHz)) * k);
}

/** Distance level of a world source (linear, before trims): (ref / d)^rolloff faded out toward the reach (pure). */
export function distanceLevel(d: number, ref: number, reach: number): number {
  const t = SOURCE_TUNING;
  if (!Number.isFinite(d) || reach <= 0) {
    return 0;
  }
  const u = d / reach;
  return Math.pow(Math.min(1, ref / Math.max(d, 1)), t.rolloff) * (1 - smoothstep(t.fadeStart, 1, u));
}

export interface SourceListen {
  /** Listener → source distance (m); NaN / Infinity = silent. */
  distance: number;
  /** Lateral component of the direction to the source (-1 left .. 1 right). */
  side: number;
  /** Dragon → source horizontal distance (m) for the perch / stand clarity (defaults to `distance`). */
  standDistance?: number;
  /** Memory: lateral component toward `from`, or null (centred, diffuse). */
  fromSide: number | null;
  open: number;
  memory: number;
  reachScale: number;
  sourceOverWater: boolean;
}

/**
 * The testable core: how a source of `kind` sounds for this listener (writes into `out`). World kinds fall off with
 * distance; memory keeps its level. Both are masked by speed and wind (memory more gently); opening and perching
 * make the world source clearer. NaN-safe: bad inputs give silence or the defaults, never a non-finite number.
 */
export function sourceMix(kind: MusicSourceKind, l: SourceListen, env: SourceEnv, out: SourceMix = emptySourceMix()): SourceMix {
  const t = SOURCE_TUNING;
  const mask = windMask(env.airspeed, env.mode, env.perched);
  const open = clamp01(fin(l.open, 0));
  out.kind = kind;
  out.windMask = mask;
  out.open = open;
  // Memory branch (also used by a world source that crossed into memory).
  const m = MEMORY_CHAIN;
  const fromSide = l.fromSide === null || !Number.isFinite(l.fromSide) ? null : clamp(l.fromSide, -1, 1);
  out.memLevel = m.level * db(t.memoryWindDuckDb * mask);
  out.memCutoff = m.lpHz * Math.pow(t.memoryWindCutoff, mask);
  out.memPan = fromSide === null ? 0 : fromSide * m.panFrom;
  out.memDry = fromSide === null ? m.dryDiffuse : m.dryFrom;
  out.memHall = fromSide === null ? m.hallDiffuse : m.hallFrom;
  if (!isWorldKind(kind)) {
    out.reach = 0;
    out.distance = Number.NaN;
    out.level = 0;
    out.cutoff = 20000;
    out.room = 0;
    out.openAir = 0;
    out.pan = 0;
    out.width = 0;
    out.memory = 1;
    out.clarity = clamp01(1 - 0.5 * mask);
    out.audible = out.memLevel;
    return out;
  }
  const c = WORLD_CHAINS[kind];
  const reach = sourceReach(kind, l.reachScale, env, l.sourceOverWater);
  const d = Number.isFinite(l.distance) && l.distance >= 0 ? l.distance : Infinity;
  const u = d / reach;
  const standD = Number.isFinite(l.standDistance ?? d) ? (l.standDistance ?? d) : Infinity;
  const standing = env.perched || env.mode === 'grounded' ? 1 - smoothstep(t.standRadius * 0.67, t.standRadius * 1.33, standD) : 0;
  const cutoff = distanceCutoff(u) * Math.pow(t.windCutoff, mask) * (1 + (t.openCutoff - 1) * open) * (1 + (t.standCutoff - 1) * standing);
  const distLevel = distanceLevel(d, c.ref, reach);
  out.reach = reach;
  out.distance = Number.isFinite(d) ? d : Number.NaN;
  out.level = distLevel * c.level * db(t.windDuckDb * mask + t.openGainDb * open + t.standBoostDb * standing);
  out.cutoff = clamp(cutoff, 200, 20000);
  out.room = c.room * (1 - t.openDry * open);
  // The city answers a distant source more than a near one (as placeSource's reverb send).
  const g = Math.pow(Math.min(1, c.ref / Math.max(Number.isFinite(d) ? d : reach, 1)), 1);
  out.openAir = clamp(c.openAir * Math.pow(1 / Math.max(g, 1e-3), 0.35), 0, 1.2);
  const near = 1 - smoothstep(5, 30, Number.isFinite(d) ? d : 1e9);
  out.pan = clamp(fin(l.side, 0) * 0.85 * (1 - near * 0.6), -1, 1);
  out.width = c.width;
  out.memory = clamp01(fin(l.memory, 0));
  out.clarity = clamp01((1 - mask) * (1 - smoothstep(0.08, 1, u)) + 0.25 * standing + 0.15 * open);
  out.audible = out.level * Math.cos((out.memory * Math.PI) / 2) + out.memLevel * Math.sin((out.memory * Math.PI) / 2);
  return out;
}

/** Lateral component (-1..1) of the direction listener → `p`, or 0 when degenerate. */
export function lateral(listener: ListenerPose, p: Vec3): number {
  const dx = p.x - listener.position.x;
  const dy = p.y - listener.position.y;
  const dz = p.z - listener.position.z;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (!(d > 1e-3)) {
    return 0;
  }
  const r = listener.right;
  return clamp(fin((dx * r.x + dy * r.y + dz * r.z) / d, 0), -1, 1);
}

function dist3(a: Vec3, b: Vec3): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

export interface SourceFrame {
  dt: number;
  /** The source of the voice that plays (null: none). */
  spec: MomentSourceSpec | null;
  /** The voice belongs to the moment that plays now (its subtitles run): the source opens. */
  momentActive: boolean;
  listener: ListenerPose;
  /** Dragon position (for the stand distance); null → the listener. */
  dragon: Vec3 | null;
  env: SourceEnv;
}

/**
 * Per-voice source state (pure): smooths the opening (2 s up when the subtitles begin, 3 s down after the moment) and
 * the world ↔ memory cross-fade (a moment whose player flies beyond memoryAt · reach keeps its music as a memory; back
 * inside worldAt · reach it returns to the world). A new spec (another moment) resets the state.
 */
export class SourceTracker {
  open = 0;
  memory = 0;
  /** The world source crossed into memory (mid-moment, far from the source). */
  crossed = false;
  private key: string | null = null;
  readonly mix: SourceMix = emptySourceMix();

  reset(): void {
    this.key = null;
    this.open = 0;
    this.memory = 0;
    this.crossed = false;
  }

  /** The key of the source being tracked (`momentId`), or null. */
  get tracking(): string | null {
    return this.key;
  }

  /** True while the music follows its world source (not a memory). */
  get world(): boolean {
    return this.key !== null && this.mix.kind !== 'memory' && !this.crossed;
  }

  update(f: SourceFrame): SourceMix | null {
    const spec = f.spec;
    if (!spec) {
      this.reset();
      return null;
    }
    const t = SOURCE_TUNING;
    const dt = Math.max(0, Math.min(0.5, fin(f.dt, 0)));
    const world = isWorldKind(spec.kind) && spec.position !== null && Number.isFinite(spec.position.x + spec.position.y + spec.position.z);
    const fresh = this.key !== spec.momentId;
    if (fresh) {
      this.key = spec.momentId;
      this.open = 0;
      this.crossed = false;
    }
    const lp = f.listener.position;
    const listenerOk = Number.isFinite(lp.x + lp.y + lp.z);
    const distance = world && listenerOk ? dist3(lp, spec.position!) : Number.NaN;
    let standDistance = distance;
    if (world && f.dragon && Number.isFinite(f.dragon.x + f.dragon.z)) {
      standDistance = Math.hypot(f.dragon.x - spec.position!.x, f.dragon.z - spec.position!.z);
    }
    if (world) {
      const reach = sourceReach(spec.kind as WorldSourceKind, spec.reachScale, f.env, spec.overWater);
      const u = Number.isFinite(distance) ? distance / reach : Infinity;
      if (f.momentActive) {
        if (u > t.memoryAt) {
          this.crossed = true;
        } else if (u < t.worldAt) {
          this.crossed = false;
        }
      }
    }
    const memTarget = !world || this.crossed ? 1 : 0;
    // A new voice starts where it belongs (a moment that begins far from its source is a memory from the start).
    this.memory = fresh ? memTarget : step(this.memory, memTarget, dt / t.memoryFadeSec);
    const openTarget = f.momentActive && world && !this.crossed ? 1 : 0;
    this.open = step(this.open, openTarget, dt / (openTarget > this.open ? t.openSec : t.closeSec));
    const fromSide = spec.from && listenerOk ? lateral(f.listener, spec.from) : null;
    return sourceMix(
      world ? spec.kind : 'memory',
      {
        distance,
        side: world && listenerOk ? lateral(f.listener, spec.position!) : 0,
        standDistance,
        fromSide,
        open: this.open,
        memory: this.memory,
        reachScale: spec.reachScale,
        sourceOverWater: spec.overWater,
      },
      f.env,
      this.mix,
    );
  }

  /** Is the tracked world source within its release distance (the lead-in / world voice keeps playing)? */
  inReach(f: Pick<SourceFrame, 'listener' | 'env'>, spec: MomentSourceSpec | null): boolean {
    if (!spec || !isWorldKind(spec.kind) || !spec.position) {
      return false;
    }
    const d = dist3(f.listener.position, spec.position);
    return Number.isFinite(d) && d <= sourceReach(spec.kind, spec.reachScale, f.env, spec.overWater) * SOURCE_TUNING.releaseAt;
  }
}

function step(v: number, target: number, maxStep: number): number {
  const s = Math.max(0, fin(maxStep, 0));
  return v < target ? Math.min(target, v + s) : Math.max(target, v - s);
}

/** Is a lead-in candidate within its reach (it may start)? */
export function withinReach(listener: Vec3, spec: MomentSourceSpec, env: Pick<SourceEnv, 'night' | 'windSpeed' | 'rain' | 'storm' | 'overWater'>): boolean {
  if (!isWorldKind(spec.kind) || !spec.position) {
    return false;
  }
  const d = dist3(listener, spec.position);
  return Number.isFinite(d) && d <= sourceReach(spec.kind, spec.reachScale, env, spec.overWater);
}
