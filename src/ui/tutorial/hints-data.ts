/**
 * Contextual move hints (the tutorial catalogue): one entry per move or feature the player can discover. Pure data and
 * predicates, no DOM; the engine (engine.ts) evaluates the triggers a few times per second and shows at most one hint
 * at a time on the shared hint line. Player-facing text is Turkish, key first ("[Space ×2] Güç vuruşu").
 *
 * Not in the catalogue on purpose: "[L] Kon" near a perch (the perch prompt, src/ui/perch-view.ts) and "[I] Kaynağa
 * bak" (the moments' own prompt, src/moments/source-prompt.ts), the hover controls (shown on entering a hover) and the
 * start-of-game keys.
 */
import type { ControlGroup } from '../../core/input';
import type { FlightMode } from '../../core/contracts';

/** What lies under the dragon (tutorial sense, sense.ts). */
export type TutorialGround = 'water' | 'flat' | 'rough' | 'structure' | 'unknown';

/** The flight state the triggers read, sampled a few times per second. */
export interface TutorialFrame {
  /** Flight mode; null without a dragon (free camera, sandboxes). */
  mode: FlightMode | null;
  /** Airspeed (m/s). */
  speed: number;
  /** Height above the surface below (m). */
  agl: number;
  /** Flight path angle (deg, negative = descending). */
  pathDeg: number;
  /** Bank (deg, signed; beyond ±90 the dragon is inverted). */
  bankDeg: number;
  stamina: number;
  /** Flow 0..1 (phase 20 stage D). */
  flow: number;
  ground: TutorialGround;
  /** Sea depth below (m, 0 over land). */
  waterDepth: number;
  /** Distance to the coastline (m, Infinity when unknown). */
  coastDistance: number;
  /* Gates (the engine shows nothing while any is on). */
  /** A race is prepared, running or its result open. */
  racing: boolean;
  /** A perch prompt, approach, perched viewing or the leap off it. */
  perchBusy: boolean;
  /** Another message holds the hint line, the title or the corner (moments, captions, cards...). */
  lineBusy: boolean;
  /** The start-of-game key hints are still requested. */
  startHints: boolean;
}

/** A game event the engine records: a move started or ended, a chain link, a mode change. */
export type TutorialEvent =
  | { kind: 'start'; id: string; clean?: boolean }
  | { kind: 'end'; id: string; clean: boolean }
  | { kind: 'link'; link: number }
  | { kind: 'mode'; mode: FlightMode | null; from: FlightMode | null };

/** What the engine remembers for the triggers and the learn rules. */
export interface TutorialMemory {
  /** Seconds in the current flight mode. */
  readonly modeTime: number;
  /** Seconds since a move with this id last started (Infinity: not this session). */
  since(id: string): number;
  /** Was the dragon in `mode` now or within the last `seconds`? */
  wasMode(mode: FlightMode, seconds: number): boolean;
}

/** An event's meaning for a hint: the move was performed cleanly (never shown again), or only tried. */
export type LearnResult = 'learned' | 'tried' | null;

export interface TutorialHintDef {
  id: string;
  /** Key caps in keyCombo syntax ('Space ×2', 'A / D ×2'); '' for a hint without a key (an automatic move). */
  keys: string;
  /** The verb after the key, or the whole sentence of a keyless hint (sentence case, Turkish). */
  text: string;
  /** Plain description of the trigger (docs, the check's report). */
  when: string;
  /** Trigger over the current state. */
  trigger(f: TutorialFrame, m: TutorialMemory): boolean;
  /** Seconds the trigger must hold before the hint may show (default 1). */
  hold?: number;
  /** How an event counts for this hint. */
  learn(e: TutorialEvent, m: TutorialMemory): LearnResult;
  /** Most shows in total (persisted; default 3). Once tried, at most one more show. */
  maxShows?: number;
  /** Seconds of play before the same hint may show again (default 240). */
  cooldown?: number;
  /** Stays its full time even when the trigger stops (default: released 1.5 s after the trigger turns false). */
  sticky?: boolean;
  /** Only after these hints were shown or learned (a progression: the basics first). */
  after?: readonly string[];
  /** The pause menu's Kontroller row this move belongs to (marked while not yet tried). */
  control?: { group: ControlGroup; keys: string };
}

/* ---------------- helpers ---------------- */

const FLYING = new Set<FlightMode | null>(['flying', 'gliding']);
const AIRBORNE = new Set<FlightMode | null>(['flying', 'gliding', 'diving']);
const flying = (f: TutorialFrame): boolean => FLYING.has(f.mode);
const airborne = (f: TutorialFrame): boolean => AIRBORNE.has(f.mode);
const abs = Math.abs;

/** The move is learned when it starts (moves without an end report: the run-out, a roll, the automatic skim). */
function onStart(id: string): TutorialHintDef['learn'] {
  return (e) => (e.kind === 'start' && e.id === id && e.clean !== false ? 'learned' : e.kind === 'start' && e.id === id ? 'tried' : null);
}

/** Tried when it starts, learned when it ends clean (phase 20 stage B / C moves and the plunge report their end). */
function onCleanEnd(id: string): TutorialHintDef['learn'] {
  return (e) => {
    if ((e.kind === 'start' || e.kind === 'end') && e.id === id) {
      return e.kind === 'end' && e.clean ? 'learned' : 'tried';
    }
    return null;
  };
}

/* ---------------- the catalogue ---------------- */

/**
 * Order = precedence when several triggers hold at once: the rare, fleeting situations first (under water, a run-out,
 * a steep dive over the sea), the everyday cruise hints last.
 */
export const TUTORIAL_HINTS: readonly TutorialHintDef[] = [
  {
    id: 'breach',
    keys: 'Space',
    text: 'Sudan fırla',
    when: 'under water for a second',
    trigger: (f, m) => f.mode === 'underwater' && m.modeTime >= 1,
    hold: 0,
    cooldown: 90,
    learn: onStart('breach'),
  },
  {
    id: 'water-takeoff',
    keys: 'Space / L',
    text: 'Sudan havalan',
    when: 'swimming for 4 s',
    trigger: (f, m) => f.mode === 'swimming' && m.modeTime >= 4,
    hold: 0,
    cooldown: 120,
    learn: (e, m) => (e.kind === 'start' && e.id === 'takeoff' && m.wasMode('swimming', 3) ? 'learned' : null),
  },
  {
    id: 'touchgo',
    keys: 'Space',
    text: 'Dokun-kalk',
    when: 'running out a fast landing, still faster than 10 m/s',
    trigger: (f, m) => f.mode === 'grounded' && m.since('runout') < 5 && f.speed >= 10,
    hold: 0.3,
    cooldown: 90,
    learn: onStart('touchgo'),
    control: { group: 'ground', keys: 'Space' },
  },
  {
    id: 'plunge',
    keys: 'Shift',
    text: 'Dal: suya gir',
    when: 'descending steeper than 20° toward deep open water (≥ 12 m deep, coast ≥ 40 m), 30–300 m up',
    trigger: (f) =>
      airborne(f) && f.ground === 'water' && f.waterDepth >= 12 && f.coastDistance >= 40 && f.pathDeg < -20 && f.agl >= 30 && f.agl <= 300 && f.speed >= 18,
    hold: 0.4,
    cooldown: 120,
    learn: onCleanEnd('plunge'),
  },
  {
    id: 'splits',
    keys: 'A / D ×2',
    text: 'Split-S',
    when: 'a dive steeper than 32° with ≥ 190 m below, ≥ 24 m/s',
    trigger: (f) => airborne(f) && f.pathDeg < -32 && f.agl >= 190 && f.speed >= 24 && abs(f.bankDeg) < 60,
    hold: 0.5,
    cooldown: 120,
    learn: onCleanEnd('splits'),
    control: { group: 'tricks', keys: 'Dik dalışta A / D ×2' },
  },
  {
    id: 'wingover',
    keys: 'S ×2',
    text: 'Kanat üstü dönüş',
    when: 'banked more than 48° at ≥ 26 m/s, ≥ 45 m up, path within ±30°',
    trigger: (f) => flying(f) && abs(f.bankDeg) >= 48 && abs(f.bankDeg) <= 100 && f.speed >= 26 && f.agl >= 45 && abs(f.pathDeg) < 30,
    hold: 0.5,
    cooldown: 120,
    learn: onCleanEnd('wingover'),
    control: { group: 'tricks', keys: 'A / D basılı + S ×2' },
  },
  {
    id: 'immelmann',
    keys: 'A / D',
    text: 'Looping tepesinde: Immelmann',
    when: '2–10 s after a loop, upright again, ≥ 40 m up',
    trigger: (f, m) => flying(f) && m.since('loop') >= 2 && m.since('loop') <= 10 && abs(f.bankDeg) < 30 && f.agl >= 40,
    hold: 0.5,
    learn: onCleanEnd('immelmann'),
    control: { group: 'tricks', keys: 'Looping tepesinde A / D' },
  },
  {
    id: 'runout',
    keys: 'L',
    text: 'Koşarak in',
    when: 'fast (14–34 m/s) and low (3–30 m) over flat open land, path within ±15°',
    trigger: (f) => flying(f) && f.ground === 'flat' && f.agl >= 3 && f.agl <= 30 && f.speed >= 14 && f.speed <= 34 && abs(f.pathDeg) < 15,
    learn: onStart('runout'),
    control: { group: 'flight', keys: 'L' },
  },
  {
    id: 'skim',
    keys: '',
    text: 'Suya yakın uç: sıyırma',
    when: 'fast (≥ 20 m/s) and level 6–35 m over the water, wings level',
    trigger: (f) => flying(f) && f.ground === 'water' && f.agl >= 6 && f.agl <= 35 && f.speed >= 20 && abs(f.bankDeg) < 15 && abs(f.pathDeg) < 10,
    hold: 1.5,
    learn: onStart('skim'),
    control: { group: 'tricks', keys: 'W' },
  },
  {
    id: 'dart',
    keys: 'Shift ×2',
    text: 'Ok gibi süzül',
    when: 'level flight faster than 30 m/s, ≥ 20 m up',
    trigger: (f) => flying(f) && f.speed > 30 && abs(f.pathDeg) < 12 && abs(f.bankDeg) < 25 && f.agl >= 20,
    learn: onCleanEnd('dart'),
    control: { group: 'tricks', keys: 'Shift ×2' },
  },
  {
    id: 'power',
    keys: 'Space ×2',
    text: 'Güç vuruşu',
    when: 'slow (12–22 m/s) level flight, ≥ 15 m up, stamina ≥ 45 %, for 2 s',
    trigger: (f) => flying(f) && f.speed >= 12 && f.speed <= 22 && abs(f.pathDeg) < 15 && f.agl >= 15 && f.stamina >= 0.45,
    hold: 2,
    learn: onCleanEnd('power'),
    control: { group: 'tricks', keys: 'Space ×2' },
  },
  {
    id: 'flow',
    keys: '',
    text: 'Hareketleri zincirle: akış',
    when: 'flow first rises (≥ 0.12)',
    trigger: (f) => f.flow >= 0.12 && f.mode !== null,
    hold: 0,
    maxShows: 1,
    sticky: true,
    learn: (e) => (e.kind === 'link' && e.link >= 2 ? 'learned' : null),
  },
  {
    id: 'dive',
    keys: 'Shift',
    text: 'Kanatları kapat: dal',
    when: 'cruising ≥ 150 m up, path within ±15°, for 4 s',
    trigger: (f) => flying(f) && f.agl >= 150 && abs(f.pathDeg) < 15,
    hold: 4,
    learn: (e) => ((e.kind === 'start' && e.id === 'freefall') || (e.kind === 'mode' && e.mode === 'diving') ? 'learned' : null),
    control: { group: 'tricks', keys: 'Shift' },
  },
  {
    id: 'roll',
    keys: 'A / D ×2',
    text: 'Takla at',
    when: 'calm level flight ≥ 60 m up at ≥ 20 m/s for 5 s, after the power stroke hint',
    trigger: (f) => flying(f) && f.agl >= 60 && f.speed >= 20 && abs(f.bankDeg) < 15 && abs(f.pathDeg) < 15,
    hold: 5,
    after: ['power'],
    learn: onStart('roll'),
    control: { group: 'tricks', keys: 'A / D ×2' },
  },
  {
    id: 'loop',
    keys: 'S ×2',
    text: 'Looping',
    when: 'calm level flight ≥ 80 m up at ≥ 24 m/s for 5 s, after the roll hint',
    trigger: (f) => flying(f) && f.agl >= 80 && f.speed >= 24 && abs(f.bankDeg) < 15 && abs(f.pathDeg) < 15,
    hold: 5,
    after: ['roll'],
    learn: onStart('loop'),
    control: { group: 'tricks', keys: 'S ×2' },
  },
  {
    id: 'slip',
    keys: 'Q / E ×2',
    text: 'Kayış',
    when: 'steady level flight at 18–34 m/s, ≥ 15 m up, for 5 s, after the dart hint',
    trigger: (f) => flying(f) && f.speed >= 18 && f.speed <= 34 && abs(f.bankDeg) < 12 && abs(f.pathDeg) < 10 && f.agl >= 15,
    hold: 5,
    after: ['dart'],
    learn: onCleanEnd('slip'),
    control: { group: 'tricks', keys: 'Q / E ×2' },
  },
  {
    id: 'land',
    keys: 'L',
    text: 'Yere in',
    when: 'slow (< 17 m/s) and low (< 40 m) over flat open land for 3 s',
    trigger: (f) => flying(f) && f.ground === 'flat' && f.agl < 40 && f.speed < 17,
    hold: 3,
    learn: onStart('land'),
  },
];

/** Pacing of the whole tutorial (seconds of play: paused time, menus and photo mode do not count). */
export const TUTORIAL_PACING = {
  /** Trigger evaluations per second. */
  evalHz: 4,
  /** No hint before this much play, and never while the start-of-game hints are up. */
  firstAfter: 45,
  /** At most one new hint per this many seconds. */
  gap: 60,
  /** The hint line (and the title and corner zones) must have been free this long. */
  quiet: 3,
  /** Seconds on screen. */
  duration: 6,
  /** Dropped if the line is not free within this (the trigger's moment has passed). */
  maxWait: 1,
  /** A non-sticky hint leaves this long after its trigger stopped holding. */
  lostGrace: 1.5,
  /** Most hints in one session. */
  sessionMax: 12,
  /** Defaults per hint. */
  maxShows: 3,
  cooldown: 240,
  hold: 1,
} as const;
