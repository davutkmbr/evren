/**
 * Adaptive music rules (pure, data-driven): game state → target stem mix, music duck and set preferences.
 *
 * Three steps, each smoothed so the mix never flickers:
 *   1. CONDITIONS (MUSIC_CONDITIONS): named booleans from the game snapshot with enter / exit thresholds (hysteresis)
 *      and minimum on / off hold times ("fast" turns on above 44 m/s and off only below 38 m/s, after 1.5 s / 3 s).
 *   2. RULES (MUSIC_RULES): `state` rules are tried top to bottom and the first whose conditions all hold sets the
 *      base mix, the play policy and the set preferences (a new state must hold for STATE_DWELL_S unless the rule is
 *      `immediate`); every matching `modifier` rule then adds to / scales the mix, adds a duck and set preferences.
 *   3. SMOOTHING: each stem glides to its target with a one-pole filter (rise RISE_TAU_S, fall FALL_TAU_S), the duck
 *      with its own time constants.
 *
 * With adaptive music off every stem is at full level and only the moment / menu ducks remain.
 * Tuning: `.docs/audio/music-system.md` (Rules).
 */
import type { FlightMode } from '../../core/contracts';
import { STEM_ROLES, type StemRole } from './manifest';

export type StemMix = Record<StemRole, number>;

/** One frame of game state, as the music sees it (filled by the controller, or by the headless check). */
export interface MusicInput {
  /** Flight mode, 'none' without a dragon (start screen, sandboxes). */
  mode: FlightMode | 'none';
  /** m/s */
  airspeed: number;
  /** Height above the surface below (m). */
  agl: number;
  /** Vertical speed (m/s, + up). */
  climbRate: number;
  /** 0..1 */
  flapEffort: number;
  /** 0..1 flow ("akış"). */
  flow: number;
  overWater: boolean;
  /** Sitting on a perch (the viewing mode). */
  perched: boolean;
  /** 0 day .. 1 night. */
  night: number;
  /** 0..1 smoothed weather values. */
  storm: number;
  rain: number;
  fog: number;
  /** 0..1 listener under water. */
  underwater: number;
  race: 'none' | 'countdown' | 'running' | 'result';
  /** A moment (poem subtitles, storks...) is playing. */
  moment: boolean;
  /** Set id of the playing moment's own music bed (MomentContent.musicId) when that set exists, else null. */
  momentMusic: string | null;
  /** A menu, the map or the start screen covers the game. */
  menu: boolean;
  /** Photo mode is on (it also pauses the game, so `menu` is set too; kept apart for the sprinkle hold reason). */
  photo: boolean;
  /** Local time of day, hours [0, 24) (sprinkle `dawn` / `dusk` tags). */
  hour: number;
  /** 0..1 the flow chain burst's push (a boost: no new sprinkle phrase). */
  burst: number;
}

export function idleInput(): MusicInput {
  return {
    mode: 'none',
    airspeed: 0,
    agl: 0,
    climbRate: 0,
    flapEffort: 0,
    flow: 0,
    overWater: false,
    perched: false,
    night: 0,
    storm: 0,
    rain: 0,
    fog: 0,
    underwater: 0,
    race: 'none',
    moment: false,
    momentMusic: null,
    menu: false,
    photo: false,
    hour: 12,
    burst: 0,
  };
}

/* ------------------------------------------------------------------ */
/* Conditions                                                           */
/* ------------------------------------------------------------------ */

export type ConditionId =
  | 'underwater'
  | 'moment'
  | 'momentMusic'
  | 'race'
  | 'raceCountdown'
  | 'menu'
  | 'perched'
  | 'grounded'
  | 'swimming'
  | 'fast'
  | 'diving'
  | 'highFlow'
  | 'lowOverWater'
  | 'thermal'
  | 'night'
  | 'storm'
  | 'fog';

export interface ConditionDef {
  id: ConditionId;
  /** The measured value. */
  value: (s: MusicInput) => number;
  /** Turns on at `on` and off at `off` (on > off; for `below` conditions on < off: on when value <= on). */
  on: number;
  off: number;
  below?: boolean;
  /** Seconds the value must stay past the threshold before the condition turns on / off. */
  minOn?: number;
  minOff?: number;
}

const flag = (b: boolean): number => (b ? 1 : 0);
const airborne = (s: MusicInput): boolean => s.mode !== 'none' && s.mode !== 'grounded' && s.mode !== 'swimming' && s.mode !== 'underwater';

export const MUSIC_CONDITIONS: readonly ConditionDef[] = [
  { id: 'underwater', value: (s) => Math.max(s.underwater, flag(s.mode === 'underwater')), on: 0.6, off: 0.3 },
  { id: 'moment', value: (s) => flag(s.moment), on: 0.5, off: 0.5 },
  { id: 'momentMusic', value: (s) => flag(s.moment && s.momentMusic !== null), on: 0.5, off: 0.5 },
  { id: 'race', value: (s) => flag(s.race !== 'none'), on: 0.5, off: 0.5 },
  { id: 'raceCountdown', value: (s) => flag(s.race === 'countdown'), on: 0.5, off: 0.5 },
  { id: 'menu', value: (s) => flag(s.menu), on: 0.5, off: 0.5 },
  { id: 'perched', value: (s) => flag(s.perched), on: 0.5, off: 0.5, minOff: 1.5 },
  // A touch-and-go does not count as grounded; standing up again takes a moment to sink in.
  { id: 'grounded', value: (s) => flag(s.mode === 'grounded'), on: 0.5, off: 0.5, minOn: 1.5, minOff: 2.5 },
  { id: 'swimming', value: (s) => flag(s.mode === 'swimming'), on: 0.5, off: 0.5, minOn: 1, minOff: 2 },
  // Cruise is ~32 m/s (dragon/flight/params.ts): "fast" is a clear sprint or a shallow dive.
  { id: 'fast', value: (s) => (airborne(s) ? s.airspeed : 0), on: 44, off: 38, minOn: 1.5, minOff: 3 },
  { id: 'diving', value: (s) => flag(s.mode === 'diving') + flag(airborne(s) && s.climbRate < -18), on: 0.5, off: 0.5, minOn: 0.6, minOff: 2.5 },
  { id: 'highFlow', value: (s) => s.flow, on: 0.6, off: 0.45, minOn: 1, minOff: 3 },
  // Low over the water: the shore is close, the colour instrument (oud / kanun / ney) comes in.
  { id: 'lowOverWater', value: (s) => (s.overWater && airborne(s) ? s.agl : Infinity), on: 35, off: 60, below: true, minOn: 1.5, minOff: 3 },
  // Climbing without flapping: soaring in a thermal (or ridge lift).
  { id: 'thermal', value: (s) => (airborne(s) && s.flapEffort < 0.35 ? s.climbRate : 0), on: 2.5, off: 1, minOn: 2, minOff: 3 },
  { id: 'night', value: (s) => s.night, on: 0.6, off: 0.4 },
  { id: 'storm', value: (s) => Math.max(s.storm, 0.7 * s.rain), on: 0.45, off: 0.25, minOff: 5 },
  { id: 'fog', value: (s) => s.fog, on: 0.5, off: 0.3, minOff: 5 },
];

interface CondState {
  active: boolean;
  pendingSince: number | null;
  since: number;
}

/** Hysteresis + minimum hold for every condition (fake-clock friendly: `now` in seconds). */
export class ConditionTracker {
  private readonly states = new Map<ConditionId, CondState>();
  readonly active = new Set<ConditionId>();

  constructor(readonly defs: readonly ConditionDef[] = MUSIC_CONDITIONS) {
    for (const d of defs) {
      this.states.set(d.id, { active: false, pendingSince: null, since: 0 });
    }
  }

  update(now: number, input: MusicInput): ReadonlySet<ConditionId> {
    for (const d of this.defs) {
      const st = this.states.get(d.id)!;
      const v = d.value(input);
      let want: boolean;
      if (!Number.isFinite(v)) {
        want = d.below ? v < 0 : v > 0;
      } else if (d.below) {
        want = st.active ? v < d.off : v <= d.on;
      } else {
        want = st.active ? v > d.off : v >= d.on;
      }
      if (want === st.active) {
        st.pendingSince = null;
        continue;
      }
      st.pendingSince ??= now;
      const hold = want ? (d.minOn ?? 0) : (d.minOff ?? 0);
      if (now - st.pendingSince >= hold - 1e-9) {
        st.active = want;
        st.pendingSince = null;
        st.since = now;
        if (want) {
          this.active.add(d.id);
        } else {
          this.active.delete(d.id);
        }
      }
    }
    return this.active;
  }

  reset(): void {
    for (const st of this.states.values()) {
      st.active = false;
      st.pendingSince = null;
    }
    this.active.clear();
  }
}

/* ------------------------------------------------------------------ */
/* Rules                                                                */
/* ------------------------------------------------------------------ */

/**
 * How a state treats the play / silence cycle:
 *   normal — music comes and goes (a set for a few minutes, then silence);
 *   always — music now (breaks a silence, keeps the set going while the state holds): perch viewing;
 *   race   — like always, and a race-tagged set is switched to on the next bar; stingers on "Başla!" and the finish;
 *   moment — the moment's own set (MomentContent.musicId) is switched to on the next bar;
 *   hold   — nothing starts or changes; what plays keeps playing (under water, a moment without its own music).
 */
export type MusicPolicy = 'normal' | 'always' | 'race' | 'moment' | 'hold';

/** Condition ids, or `!id` for "not". */
export type RuleWhen = readonly (ConditionId | `!${ConditionId}`)[];

export interface MusicRule {
  id: string;
  kind: 'state' | 'modifier';
  when: RuleWhen;
  /** state: the base mix (stems not listed are 0). */
  mix?: Partial<StemMix>;
  /** modifier: added to the mix, then `scale` multiplies. */
  add?: Partial<StemMix>;
  scale?: Partial<StemMix>;
  /** 0..1 music duck (several combine as 1 - Π(1 - duck)). */
  duck?: number;
  /** Set tags to prefer / avoid (scored by the director). */
  prefer?: readonly string[];
  avoid?: readonly string[];
  /** state: play policy (default normal). */
  policy?: MusicPolicy;
  /** state: switches at once instead of waiting STATE_DWELL_S. */
  immediate?: boolean;
  /** state: which modifiers apply ('all' default; 'duck' = only their ducks, e.g. under water). */
  modifiers?: 'all' | 'duck';
}

/** Full mix: every stem up (non-adaptive mode and a moment's own set). */
export const FULL_MIX: StemMix = { base: 1, strings: 1, motion: 1, colour: 1, air: 1 };

/**
 * The rules table. States first (first match wins), then modifiers (all that match apply, in order).
 * Levels are linear gains 0..1 on top of each stem's own trim.
 */
export const MUSIC_RULES: readonly MusicRule[] = [
  // --- states ---
  { id: 'underwater', kind: 'state', when: ['underwater'], mix: { base: 0.85 }, policy: 'hold', immediate: true, modifiers: 'duck' },
  { id: 'moment-own-music', kind: 'state', when: ['momentMusic'], mix: FULL_MIX, duck: 0.1, policy: 'moment', immediate: true, modifiers: 'duck' },
  { id: 'moment', kind: 'state', when: ['moment'], mix: { base: 0.8, air: 0.7 }, duck: 0.8, policy: 'hold', immediate: true, modifiers: 'duck' },
  { id: 'race-countdown', kind: 'state', when: ['raceCountdown'], mix: { base: 0.6, air: 0.5 }, duck: 0.3, prefer: ['race'], policy: 'race', immediate: true, modifiers: 'duck' },
  { id: 'race', kind: 'state', when: ['race'], mix: { base: 0.9, strings: 0.8, motion: 1, air: 0.3, colour: 0.3 }, prefer: ['race', 'flight'], policy: 'race', immediate: true, modifiers: 'duck' },
  { id: 'perched', kind: 'state', when: ['perched'], mix: { base: 0.85, air: 0.8, strings: 0.3, colour: 0.25 }, prefer: ['calm', 'perch'], avoid: ['race'], policy: 'always' },
  { id: 'grounded', kind: 'state', when: ['grounded'], mix: { base: 0.75, air: 0.65 }, prefer: ['calm'], avoid: ['race'] },
  { id: 'swimming', kind: 'state', when: ['swimming'], mix: { base: 0.75, air: 0.5, colour: 0.45 }, prefer: ['water', 'calm'], avoid: ['race'] },
  { id: 'cruising', kind: 'state', when: [], mix: { base: 0.9, strings: 0.8, air: 0.3 }, prefer: ['flight'], avoid: ['race'] },
  // --- modifiers ---
  { id: 'fast', kind: 'modifier', when: ['fast'], add: { motion: 0.75 } },
  { id: 'dive', kind: 'modifier', when: ['diving'], add: { motion: 0.9, strings: 0.1 }, duck: 0.1 },
  { id: 'high-flow', kind: 'modifier', when: ['highFlow'], add: { motion: 0.6, strings: 0.1 } },
  { id: 'low-over-water', kind: 'modifier', when: ['lowOverWater'], add: { colour: 0.9 }, prefer: ['water'] },
  { id: 'thermal', kind: 'modifier', when: ['thermal'], add: { air: 0.7, strings: 0.15 } },
  { id: 'night', kind: 'modifier', when: ['night'], scale: { strings: 0.55, motion: 0.7 }, add: { air: 0.1 }, prefer: ['night'], avoid: ['day'] },
  { id: 'day', kind: 'modifier', when: ['!night'], prefer: ['day'], avoid: ['night'] },
  { id: 'storm', kind: 'modifier', when: ['storm'], scale: { base: 0.8, strings: 0.5, motion: 0.6, colour: 0.4 }, prefer: ['storm'] },
  { id: 'fog', kind: 'modifier', when: ['fog'], add: { air: 0.35 }, scale: { motion: 0.7 }, prefer: ['fog'] },
  { id: 'menu', kind: 'modifier', when: ['menu'], duck: 0.35 },
];

export function matches(when: RuleWhen, active: ReadonlySet<ConditionId>): boolean {
  for (const w of when) {
    if (w.startsWith('!') ? active.has(w.slice(1) as ConditionId) : !active.has(w as ConditionId)) {
      return false;
    }
  }
  return true;
}

export interface RuleResult {
  state: MusicRule;
  modifiers: MusicRule[];
  mix: StemMix;
  duck: number;
  prefer: string[];
  avoid: string[];
  policy: MusicPolicy;
}

const zeroMix = (): StemMix => ({ base: 0, strings: 0, motion: 0, colour: 0, air: 0 });
const clamp01 = (v: number): number => (v > 1 ? 1 : v > 0 ? v : 0);

/** First matching state rule (the last state rule should match always). */
export function matchState(rules: readonly MusicRule[], active: ReadonlySet<ConditionId>): MusicRule {
  const states = rules.filter((r) => r.kind === 'state');
  return states.find((r) => matches(r.when, active)) ?? states[states.length - 1];
}

/** The mix, duck and preferences of `state` plus every matching modifier (pure). */
export function applyRules(rules: readonly MusicRule[], state: MusicRule, active: ReadonlySet<ConditionId>, adaptive = true): RuleResult {
  const mix = zeroMix();
  let keep = 1;
  const prefer: string[] = [];
  const avoid: string[] = [];
  const modifiers: MusicRule[] = [];
  const base = adaptive ? state.mix : FULL_MIX;
  for (const r of STEM_ROLES) {
    mix[r] = base?.[r] ?? 0;
  }
  if (state.duck) {
    keep *= 1 - state.duck;
  }
  if (adaptive) {
    prefer.push(...(state.prefer ?? []));
    avoid.push(...(state.avoid ?? []));
  }
  for (const m of rules) {
    if (m.kind !== 'modifier' || !matches(m.when, active)) {
      continue;
    }
    const duckOnly = !adaptive || state.modifiers === 'duck';
    if (duckOnly && !m.duck) {
      continue;
    }
    modifiers.push(m);
    if (m.duck) {
      keep *= 1 - m.duck;
    }
    if (duckOnly) {
      continue;
    }
    for (const r of STEM_ROLES) {
      mix[r] = (mix[r] + (m.add?.[r] ?? 0)) * (m.scale?.[r] ?? 1);
    }
    prefer.push(...(m.prefer ?? []));
    avoid.push(...(m.avoid ?? []));
  }
  for (const r of STEM_ROLES) {
    mix[r] = clamp01(mix[r]);
  }
  return { state, modifiers, mix, duck: 1 - keep, prefer, avoid, policy: adaptive ? (state.policy ?? 'normal') : nonAdaptivePolicy(state) };
}

/** Non-adaptive mode keeps only what must not change: silence under water / during moments and the moment's set. */
function nonAdaptivePolicy(state: MusicRule): MusicPolicy {
  return state.policy === 'hold' || state.policy === 'moment' ? state.policy : 'normal';
}

/* ------------------------------------------------------------------ */
/* Engine: conditions + state dwell + smoothing                         */
/* ------------------------------------------------------------------ */

/** A new (non-immediate) state must hold this long before the mix follows it. */
export const STATE_DWELL_S = 1.5;
/** One-pole time constants of the stem levels (s): rising, falling. */
export const RISE_TAU_S = 2.2;
export const FALL_TAU_S = 3.5;
/** Duck time constants (s): ducking in, releasing. */
export const DUCK_IN_TAU_S = 0.5;
export const DUCK_OUT_TAU_S = 1.6;

export interface MusicTarget {
  /** Id of the active state rule. */
  state: string;
  /** Ids of the matching modifiers. */
  modifiers: string[];
  policy: MusicPolicy;
  prefer: string[];
  avoid: string[];
  /** Unsmoothed target mix and duck of the rules. */
  targetMix: StemMix;
  targetDuck: number;
  /** Smoothed levels (what the player applies). */
  mix: StemMix;
  duck: number;
  /** When the active state rule began (s). */
  stateSince: number;
  /** Set id requested by a moment (policy 'moment'). */
  momentSet: string | null;
  /** Active conditions (debug). */
  conditions: ConditionId[];
}

export class MusicRulesEngine {
  readonly tracker: ConditionTracker;
  adaptive = true;
  private state: MusicRule | null = null;
  private candidate: MusicRule | null = null;
  private candidateSince = 0;
  private stateSince = 0;
  private last = Number.NaN;
  private readonly mix = zeroMix();
  private duck = 0;
  private primed = false;

  constructor(
    readonly rules: readonly MusicRule[] = MUSIC_RULES,
    conditions: readonly ConditionDef[] = MUSIC_CONDITIONS,
  ) {
    this.tracker = new ConditionTracker(conditions);
  }

  update(now: number, input: MusicInput): MusicTarget {
    const dt = Number.isFinite(this.last) ? Math.max(0, now - this.last) : 0;
    this.last = now;
    const active = this.tracker.update(now, input);
    const want = matchState(this.rules, active);
    if (!this.state) {
      this.state = want;
      this.stateSince = now;
    } else if (want !== this.state) {
      if (want !== this.candidate) {
        this.candidate = want;
        this.candidateSince = now;
      }
      if (want.immediate || this.state.immediate || now - this.candidateSince >= STATE_DWELL_S - 1e-9) {
        this.state = want;
        this.stateSince = now;
        this.candidate = null;
      }
    } else {
      this.candidate = null;
    }
    const r = applyRules(this.rules, this.state, active, this.adaptive);
    if (!this.primed) {
      // The first frame starts at the target (a set starting from silence fades in on its own deck).
      Object.assign(this.mix, r.mix);
      this.duck = r.duck;
      this.primed = true;
    } else if (dt > 0) {
      for (const k of STEM_ROLES) {
        const tau = r.mix[k] > this.mix[k] ? RISE_TAU_S : FALL_TAU_S;
        this.mix[k] += (r.mix[k] - this.mix[k]) * (1 - Math.exp(-dt / tau));
      }
      const tau = r.duck > this.duck ? DUCK_IN_TAU_S : DUCK_OUT_TAU_S;
      this.duck += (r.duck - this.duck) * (1 - Math.exp(-dt / tau));
    }
    return {
      state: this.state.id,
      modifiers: r.modifiers.map((m) => m.id),
      policy: r.policy,
      prefer: r.prefer,
      avoid: r.avoid,
      targetMix: r.mix,
      targetDuck: r.duck,
      mix: { ...this.mix },
      duck: this.duck,
      stateSince: this.stateSince,
      momentSet: r.policy === 'moment' ? input.momentMusic : null,
      conditions: [...active],
    };
  }

  reset(): void {
    this.tracker.reset();
    this.state = null;
    this.candidate = null;
    this.primed = false;
    this.last = Number.NaN;
  }
}
