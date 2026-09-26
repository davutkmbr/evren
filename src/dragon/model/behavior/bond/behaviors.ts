import type { BondAudioCue, DragonMood } from '../../../../core/contracts';
import { bell, BOND, BondRng, clamp, envelope, smoothstep, type BondInputs, type BondPuff } from './types';

/** Additive pose of one behaviour frame (rad unless noted). */
export interface BehaviorFrame {
  neckYaw: number;
  neckPitch: number;
  neckShake: number;
  headRoll: number;
  jaw: number;
  bodyRoll: number;
  tailYaw: number;
  tailPitch: number;
  tailCurl: number;
  wingWeight: number;
  wingSpread: number;
  wingRaise: number;
  beatWeight: number;
  beatPhase: number;
  eyeLid: number;
  plates: number;
  laugh: number;
}

export function createFrame(): BehaviorFrame {
  return {
    neckYaw: 0,
    neckPitch: 0,
    neckShake: 0,
    headRoll: 0,
    jaw: 0,
    bodyRoll: 0,
    tailYaw: 0,
    tailPitch: 0,
    tailCurl: 0,
    wingWeight: 0,
    wingSpread: 1,
    wingRaise: 0,
    beatWeight: 0,
    beatPhase: 0,
    eyeLid: 0,
    plates: 0,
    laugh: 0,
  };
}

export function resetFrame(f: BehaviorFrame): void {
  f.neckYaw = f.neckPitch = f.neckShake = f.headRoll = f.jaw = f.bodyRoll = 0;
  f.tailYaw = f.tailPitch = f.tailCurl = 0;
  f.wingWeight = f.wingRaise = f.beatWeight = f.beatPhase = 0;
  f.wingSpread = 1;
  f.eyeLid = f.plates = f.laugh = 0;
}

/** What a behaviour may look at when choosing and playing. */
export interface BehaviorContext {
  inp: BondInputs;
  mood: DragonMood;
  fatigue: number;
  /** Calm flight (gliding or cruising, not critical), resting (standing still, perched, floating), swimming. */
  calmAir: boolean;
  resting: boolean;
  grounded: boolean;
  swimming: boolean;
  /** Closest bird in reach for a snap (body-relative yaw / pitch, m), or null. */
  bird: { yaw: number; pitch: number; distance: number } | null;
}

/** A one-shot inside a behaviour at its normalised time `at`. */
export interface BehaviorCue {
  at: number;
  sound?: BondAudioCue;
  volume?: number;
  puff?: BondPuff['kind'];
  strength?: number;
}

export interface BehaviorDef {
  id: string;
  variants: readonly string[];
  /** Started by an event (landing, leaving the water) rather than drawn by chance. */
  triggered?: boolean;
  cooldown: number;
  /** 0 = not possible now; otherwise the draw weight. */
  weight(c: BehaviorContext): number;
  duration(variant: string, rng: BondRng): number;
  /** Fills `f` at normalised time t (0..1); `sec` = seconds since start, `side` = ±1 chosen at start. */
  sample(variant: string, t: number, sec: number, side: number, c: BehaviorContext, f: BehaviorFrame): void;
  cues(variant: string): readonly BehaviorCue[];
}

const MOOD_W = (c: BehaviorContext, w: Partial<Record<DragonMood, number>>, base = 0): number => w[c.mood] ?? base;
const TAU = Math.PI * 2;

/** The catalogue (phase 06): every behaviour has several variants; the scheduler never repeats one back to back. */
export const BEHAVIORS: readonly BehaviorDef[] = [
  {
    id: 'look-around',
    variants: ['scan', 'tilt', 'peek'],
    cooldown: 70,
    weight: (c) => (c.calmAir || c.resting ? MOOD_W(c, { curious: 3, content: 1, playful: 1, excited: 0.5, tired: 0.4 }) : 0),
    duration: (_v, r) => r.range(3.2, 4.2),
    sample(v, t, _s, side, _c, f) {
      const e = envelope(t, 0.18, 0.2);
      if (v === 'scan') {
        f.neckYaw = 0.75 * Math.sin(TAU * t) * side * e;
        f.neckPitch = 0.08 * e;
      } else if (v === 'tilt') {
        f.headRoll = 0.38 * side * e;
        f.neckYaw = 0.5 * side * e;
        f.neckPitch = 0.12 * e;
      } else {
        f.neckPitch = -0.42 * e;
        f.neckYaw = 0.3 * Math.sin(Math.PI * 1.5 * t) * side * e;
        f.headRoll = 0.12 * side * e;
      }
    },
    cues: (v) => (v === 'tilt' ? [{ at: 0.3, sound: 'trill', volume: 0.45 }] : []),
  },
  {
    id: 'gull-snap',
    variants: ['snap', 'double', 'reach'],
    cooldown: 60,
    weight: (c) => (c.bird && c.bird.distance < 45 && Math.abs(c.bird.yaw) < 1.1 && (c.calmAir || c.swimming || c.resting) ? MOOD_W(c, { playful: 3, curious: 2, excited: 2, content: 1, tired: 0.3 }) : 0),
    duration: (v) => (v === 'snap' ? 1.3 : v === 'double' ? 2 : 2.2),
    sample(v, t, _s, side, c, f) {
      // Overshoot the bird's direction a little: the neck springs soften a dart.
      const yaw = clamp(1.3 * (c.bird ? c.bird.yaw : 0.4 * side), -1.2, 1.2);
      const pitch = clamp(1.2 * (c.bird ? c.bird.pitch : 0.1), -0.45, 0.45);
      if (v === 'reach') {
        const reach = envelope(t, 0.35, 0.3);
        f.neckYaw = yaw * reach;
        f.neckPitch = pitch * reach + 0.1 * reach;
        f.jaw = 0.35 * bell(t, 0.5, 0.25);
        f.neckShake = 0.12 * Math.sin(TAU * 4 * t) * bell(t, 0.85, 0.12);
        return;
      }
      const darts = v === 'double' ? [0.3, 0.58] : [0.4];
      let d = 0;
      let jaw = 0;
      for (const at of darts) {
        d = Math.max(d, bell(t, at, 0.2));
        jaw = Math.max(jaw, 0.7 * bell(t, at - 0.04, 0.08));
      }
      const hold = envelope(t, 0.15, 0.3);
      f.neckYaw = yaw * Math.max(d, 0.5 * hold);
      f.neckPitch = pitch * Math.max(d, 0.5 * hold) + 0.08 * d;
      f.jaw = jaw;
      if (v === 'double') {
        // Missed twice: a head shake ("pah") and the rider laughs.
        f.neckShake = 0.2 * Math.sin(TAU * 5 * t) * bell(t, 0.83, 0.12);
        f.laugh = bell(t, 0.82, 0.18);
      }
    },
    cues: (v) =>
      v === 'double'
        ? [
            { at: 0.3, sound: 'snap', volume: 0.8 },
            { at: 0.58, sound: 'snap', volume: 0.9 },
            { at: 0.82, sound: 'huff', volume: 0.5 },
          ]
        : v === 'snap'
          ? [{ at: 0.4, sound: 'snap', volume: 0.9 }]
          : [{ at: 0.82, sound: 'huff', volume: 0.45 }],
  },
  {
    id: 'yawn',
    variants: ['plain', 'flame', 'long'],
    cooldown: 150,
    weight: (c) => (c.calmAir || c.resting || c.swimming ? MOOD_W(c, { tired: 4, content: 1, curious: 0.3, playful: 0.3 }) * (0.4 + c.fatigue) : 0),
    duration: (v) => (v === 'plain' ? 2.6 : v === 'flame' ? 3 : 3.6),
    sample(v, t, _s, side, _c, f) {
      const open = envelope((t - 0.12) / 0.62, 0.35, 0.3);
      f.neckPitch = 0.28 * bell(t, 0.45, 0.4);
      f.jaw = 0.95 * open;
      f.eyeLid = 0.85 * open;
      f.headRoll = 0.1 * side * open;
      if (v === 'long') {
        f.neckShake = 0.18 * Math.sin(TAU * 4 * t) * bell(t, 0.88, 0.1);
      }
    },
    cues: (v) => {
      const cues: BehaviorCue[] = [{ at: 0.14, sound: 'yawn', volume: v === 'long' ? 0.9 : 0.75 }];
      if (v === 'flame') {
        cues.push({ at: 0.6, puff: 'flame', strength: 0.6 });
      }
      return cues;
    },
  },
  {
    id: 'sneeze',
    variants: ['smoke', 'double', 'snort'],
    cooldown: 120,
    weight: (c) => (c.calmAir || c.resting || c.swimming ? 0.5 + 1.5 * c.inp.rain + (c.inp.airTempC < 5 ? 1 : 0) : 0),
    duration: (v) => (v === 'smoke' ? 1.4 : v === 'double' ? 2.1 : 1),
    sample(v, t, _s, _side, _c, f) {
      const at = v === 'double' ? [0.36, 0.72] : [0.46];
      if (v === 'snort') {
        f.neckPitch = 0.12 * bell(t, 0.35, 0.25) - 0.08 * bell(t, 0.6, 0.15);
        f.neckShake = 0.1 * Math.sin(TAU * 3 * t) * bell(t, 0.6, 0.25);
        return;
      }
      for (const s of at) {
        f.neckPitch += 0.16 * bell(t, s - 0.14, 0.14) - 0.34 * bell(t, s + 0.03, 0.08);
        f.jaw = Math.max(f.jaw, 0.35 * bell(t, s + 0.02, 0.06));
        f.eyeLid = Math.max(f.eyeLid, bell(t, s, 0.1));
      }
      f.laugh = bell(t, 0.85, 0.15);
    },
    cues: (v) =>
      v === 'double'
        ? [
            { at: 0.37, sound: 'sneeze', volume: 0.6 },
            { at: 0.73, sound: 'sneeze', volume: 0.9 },
            { at: 0.74, puff: 'smoke', strength: 0.7 },
          ]
        : v === 'smoke'
          ? [
              { at: 0.47, sound: 'sneeze', volume: 0.9 },
              { at: 0.48, puff: 'smoke', strength: 0.8 },
            ]
          : [
              { at: 0.55, sound: 'huff', volume: 0.7 },
              { at: 0.56, puff: 'steam', strength: 0.6 },
            ],
  },
  {
    id: 'happy-roll',
    variants: ['rock', 'shimmy', 'wiggle'],
    cooldown: 110,
    weight: (c) => {
      const air = c.calmAir && c.inp.agl > 60 && c.inp.airspeed < 40;
      const ok = air || c.swimming || c.grounded;
      return ok ? MOOD_W(c, { playful: 3, excited: 3, content: 0.4 }) : 0;
    },
    duration: (v) => (v === 'rock' ? 2.2 : v === 'shimmy' ? 1.6 : 2),
    sample(v, t, _s, side, c, f) {
      const e = envelope(t, 0.15, 0.25);
      if (v === 'rock') {
        // Standing, the rock stays small (the feet are planted).
        f.bodyRoll = (c.grounded ? 0.08 : 0.3) * Math.sin(TAU * 1.5 * t) * side * e;
        f.tailYaw = -0.3 * Math.sin(TAU * 1.5 * t - 0.8) * side * e;
        f.headRoll = -0.15 * Math.sin(TAU * 1.5 * t) * side * e;
        f.laugh = bell(t, 0.6, 0.35);
      } else if (v === 'shimmy') {
        f.bodyRoll = 0.12 * Math.sin(TAU * 6 * t) * e;
        f.tailYaw = 0.35 * Math.sin(TAU * 3 * t) * e;
        f.plates = e;
      } else {
        f.headRoll = 0.25 * Math.sin(TAU * 2 * t) * e;
        f.neckYaw = 0.22 * Math.sin(TAU * t) * side * e;
        f.tailYaw = 0.3 * Math.sin(TAU * 2 * t + 1) * e;
        f.laugh = bell(t, 0.5, 0.3) * 0.7;
      }
    },
    cues: (v) => (v === 'shimmy' ? [] : [{ at: 0.2, sound: 'chirp', volume: 0.7 }]),
  },
  {
    id: 'wing-stretch',
    variants: ['full', 'high', 'shiver'],
    triggered: true,
    cooldown: 90,
    weight: (c) => (c.grounded && c.inp.groundSpeed < 1.2 ? 1 : 0),
    duration: () => 3.2,
    sample(v, t, _s, _side, _c, f) {
      const e = envelope(t, 0.3, 0.3);
      // The wings go up first (held at the top of an upstroke: a raised V over the back), then open; they close
      // before they come down, so no wingtip sweeps through the ground.
      f.beatWeight = envelope(t, 0.22, 0.22);
      f.beatPhase = 0;
      f.wingWeight = smoothstep(0.25, 0.47, t) * (1 - smoothstep(0.68, 0.9, t));
      f.wingSpread = v === 'high' ? 0.7 : 0.9;
      f.wingRaise = (v === 'high' ? 1 : 0.55) * e;
      if (v === 'shiver') {
        f.wingSpread += 0.06 * Math.sin(TAU * 7 * t) * bell(t, 0.55, 0.25);
      }
      f.neckPitch = 0.22 * e;
      f.jaw = 0.3 * bell(t, 0.5, 0.25);
      f.eyeLid = 0.5 * e;
      f.tailPitch = -0.15 * e;
    },
    cues: () => [{ at: 0.35, sound: 'grumble', volume: 0.45 }],
  },
  {
    id: 'shake-off',
    variants: ['head', 'full', 'tail'],
    triggered: true,
    cooldown: 40,
    weight: (c) => (c.grounded || c.calmAir || c.swimming ? 1 : 0),
    duration: (v) => (v === 'full' ? 1.8 : 1.4),
    sample(v, t, _s, _side, c, f) {
      const e = envelope(t, 0.12, 0.25);
      f.neckShake = 0.34 * Math.sin(TAU * 4.5 * t * (v === 'full' ? 1.8 : 1.4)) * e;
      f.eyeLid = 0.6 * e;
      if (v === 'full') {
        f.bodyRoll = 0.2 * Math.sin(TAU * 4 * t * 1.8) * e;
        if (!c.calmAir) {
          // Standing or floating the wings shake half open too; in the air they keep flying.
          f.wingWeight = 0.5 * e;
          f.wingSpread = 0.25;
        }
      } else if (v === 'tail') {
        f.tailYaw = 0.5 * Math.sin(TAU * 3 * t * 1.4) * e;
        f.neckShake *= 0.6;
      }
    },
    cues: (v) => [
      { at: 0.2, puff: 'droplets', strength: v === 'full' ? 1 : 0.6 },
      { at: 0.45, puff: 'droplets', strength: v === 'full' ? 0.8 : 0.4 },
    ],
  },
  {
    id: 'head-shake',
    variants: ['quick', 'slow'],
    cooldown: 140,
    weight: (c) => (c.calmAir || c.resting ? 0.3 + MOOD_W(c, { content: 0.3, tired: 0.3 }) : 0),
    duration: (v) => (v === 'quick' ? 0.9 : 1.5),
    sample(v, t, _s, _side, _c, f) {
      const e = envelope(t, 0.15, 0.3);
      f.neckShake = (v === 'quick' ? 0.26 * Math.sin(TAU * 4 * t) : 0.2 * Math.sin(TAU * 2.4 * t)) * e;
      f.eyeLid = 0.4 * e;
    },
    cues: (v) => (v === 'slow' ? [{ at: 0.5, sound: 'huff', volume: 0.35 }] : []),
  },
  {
    id: 'rest',
    variants: ['doze', 'chin'],
    cooldown: 120,
    weight: (c) => (c.resting && !c.swimming ? MOOD_W(c, { tired: 4, content: 0.6 }) : 0),
    duration: (_v, r) => r.range(5, 7),
    sample(v, t, _s, side, _c, f) {
      const e = envelope(t, 0.2, 0.2);
      f.neckPitch = (v === 'chin' ? -0.6 : -0.42) * e;
      f.headRoll = (v === 'chin' ? 0.12 : 0.05) * side * e;
      // Drowsy lids with one peek half way.
      f.eyeLid = e * (1 - 0.65 * bell(t, 0.6, 0.08));
      f.tailCurl = 0.6 * e;
    },
    cues: () => [],
  },
  {
    id: 'groom',
    variants: ['left', 'right'],
    cooldown: 100,
    weight: (c) => (c.resting && !c.swimming ? MOOD_W(c, { content: 2, playful: 1, curious: 0.5, tired: 0.5 }) : 0),
    duration: () => 3,
    sample(v, t, _s, _side, _c, f) {
      const e = envelope(t, 0.25, 0.25);
      const side = v === 'left' ? 1 : -1;
      f.neckYaw = 1.1 * side * e;
      f.neckPitch = -0.22 * e;
      f.headRoll = 0.2 * side * e;
      f.jaw = 0.22 * (0.5 + 0.5 * Math.sin(TAU * 5 * t)) * smoothstep(0.3, 0.4, t) * (1 - smoothstep(0.7, 0.8, t));
      f.eyeLid = 0.3 * e;
    },
    cues: () => [],
  },
];

export interface BehaviorLogEntry {
  id: string;
  variant: string;
  start: number;
  /** Mode and flags when it started (checks). */
  mode: string;
  racing: boolean;
  critical: boolean;
}

interface Running {
  def: BehaviorDef;
  variant: string;
  sec: number;
  duration: number;
  side: number;
  cue: number;
  fade: number;
  aborting: boolean;
}

/** The last RECENT_COUNT behaviours are drawn with their weight times RECENT_PENALTY. */
const RECENT_COUNT = 4;
const RECENT_PENALTY = 0.3;
const GAP_MOOD: Record<DragonMood, number> = { content: 1, curious: 0.75, playful: 0.75, tired: 1.1, excited: 0.8 };

/**
 * Chooses and plays the self-driven behaviours: rare (a global gap of BOND.behavior.gap s scaled by mood, per-
 * behaviour cooldowns), only when the safety gate allows it, and faded out within BOND.behavior.abortFade s when it
 * stops allowing it. A triggered behaviour (wing stretch after landing from a long flight, shaking off water) waits
 * for its window. Variants never repeat back to back, and the same behaviour never plays twice in a row.
 */
export class BehaviorScheduler {
  readonly frame = createFrame();
  readonly log: BehaviorLogEntry[] = [];
  private running: Running | null = null;
  private time = 0;
  private nextAt: number;
  private lastEnd = -99;
  private lastId = '';
  private readonly lastVariant = new Map<string, string>();
  private readonly recent: string[] = [];
  private forced: { def: BehaviorDef; variant: string } | null = null;
  private readonly cooldownUntil = new Map<string, number>();
  private readonly pending = new Map<string, number>();
  private readonly firedCues: { sound?: BondAudioCue; volume?: number; puff?: BondPuff['kind']; strength?: number }[] = [];

  constructor(private readonly rng: BondRng) {
    this.nextAt = BOND.behavior.warmup + rng.range(0, 20);
  }

  get current(): string | null {
    return this.running ? `${this.running.def.id}:${this.running.variant}` : null;
  }

  /** Weight of the running behaviour's pose (0 when none). */
  get weight(): number {
    return this.running ? this.running.fade : 0;
  }

  /** Cues crossed this frame (read after update). */
  get cues(): readonly { sound?: BondAudioCue; volume?: number; puff?: BondPuff['kind']; strength?: number }[] {
    return this.firedCues;
  }

  /**
   * Debug / pose sheets: queues a behaviour (and variant) to start at the next allowed frame, ignoring the gap, the
   * cooldown and its own conditions. Returns false for an unknown id or variant.
   */
  force(id: string, variant?: string): boolean {
    const def = BEHAVIORS.find((b) => b.id === id);
    if (!def || (variant !== undefined && !def.variants.includes(variant))) {
      return false;
    }
    this.forced = { def, variant: variant ?? def.variants[0] };
    return true;
  }

  /** Opens a window for a triggered behaviour (it starts once allowed, within `window` s). */
  trigger(id: string, window: number): void {
    this.pending.set(id, this.time + window);
  }

  /** `allowed` = the safety gate allows behaviours and nothing else (petting, a gaze, an answer) holds the head. */
  update(c: BehaviorContext, allowed: boolean): void {
    const dt = c.inp.dt;
    this.time += dt;
    this.firedCues.length = 0;
    resetFrame(this.frame);
    for (const [id, until] of this.pending) {
      if (this.time > until) {
        this.pending.delete(id);
      }
    }
    const r = this.running;
    if (r) {
      if (!allowed) {
        r.aborting = true;
      }
      r.sec += dt;
      if (r.aborting) {
        r.fade = Math.max(0, r.fade - dt / BOND.behavior.abortFade);
      }
      const t = Math.min(1, r.sec / r.duration);
      if (!r.aborting) {
        const cues = r.def.cues(r.variant);
        while (r.cue < cues.length && cues[r.cue].at <= t) {
          this.firedCues.push(cues[r.cue]);
          r.cue++;
        }
      }
      r.def.sample(r.variant, t, r.sec, r.side, c, this.frame);
      scaleFrame(this.frame, r.fade);
      if (t >= 1 || r.fade <= 0) {
        this.running = null;
        this.lastEnd = this.time;
        this.nextAt = this.time + this.rng.range(BOND.behavior.gap[0], BOND.behavior.gap[1]) * GAP_MOOD[c.mood];
      }
      return;
    }
    if (!allowed) {
      return;
    }
    if (this.forced) {
      const { def, variant } = this.forced;
      this.forced = null;
      this.start(def, c, variant);
      return;
    }
    // Triggered behaviours first (their own short gap), then a chance draw once the global gap has passed.
    for (const [id] of this.pending) {
      const def = BEHAVIORS.find((b) => b.id === id);
      if (def && this.time - this.lastEnd >= BOND.behavior.triggerGap && def.weight(c) > 0 && this.time >= (this.cooldownUntil.get(id) ?? -1)) {
        this.pending.delete(id);
        this.start(def, c);
        return;
      }
    }
    if (this.time < this.nextAt) {
      return;
    }
    let total = 0;
    const weights: number[] = [];
    for (const def of BEHAVIORS) {
      const blocked = def.triggered || def.id === this.lastId || this.time < (this.cooldownUntil.get(def.id) ?? -1);
      // Variety: behaviours seen among the last few are drawn less often.
      const recent = this.recent.includes(def.id) ? RECENT_PENALTY : 1;
      const w = blocked ? 0 : Math.max(0, def.weight(c)) * recent;
      weights.push(w);
      total += w;
    }
    if (total <= 0) {
      // Nothing fits right now: look again in a few seconds.
      this.nextAt = this.time + 4;
      return;
    }
    let pick = this.rng.next() * total;
    for (let i = 0; i < BEHAVIORS.length; i++) {
      pick -= weights[i];
      if (pick <= 0 && weights[i] > 0) {
        this.start(BEHAVIORS[i], c);
        return;
      }
    }
  }

  private start(def: BehaviorDef, c: BehaviorContext, forcedVariant?: string): void {
    const last = this.lastVariant.get(def.id);
    const options = def.variants.filter((v) => v !== last);
    const variant = forcedVariant ?? this.rng.pick(options.length > 0 ? options : def.variants);
    this.lastVariant.set(def.id, variant);
    this.lastId = def.id;
    this.recent.push(def.id);
    if (this.recent.length > RECENT_COUNT) {
      this.recent.shift();
    }
    this.cooldownUntil.set(def.id, this.time + def.cooldown);
    const side = c.bird ? (c.bird.yaw >= 0 ? 1 : -1) : this.rng.next() < 0.5 ? 1 : -1;
    this.running = { def, variant, sec: 0, duration: def.duration(variant, this.rng), side, cue: 0, fade: 1, aborting: false };
    this.log.push({ id: def.id, variant, start: this.time, mode: c.inp.mode, racing: c.inp.racing, critical: false });
  }
}

function scaleFrame(f: BehaviorFrame, k: number): void {
  if (k >= 1) {
    return;
  }
  f.neckYaw *= k;
  f.neckPitch *= k;
  f.neckShake *= k;
  f.headRoll *= k;
  f.jaw *= k;
  f.bodyRoll *= k;
  f.tailYaw *= k;
  f.tailPitch *= k;
  f.tailCurl *= k;
  f.wingWeight *= k;
  f.wingRaise *= k;
  f.beatWeight *= k;
  f.eyeLid *= k;
  f.plates *= k;
  f.laugh *= k;
}
