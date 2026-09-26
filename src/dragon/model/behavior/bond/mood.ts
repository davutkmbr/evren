import type { DragonMood } from '../../../../core/contracts';
import { approach, BOND, clamp, MOODS, smoothstep, type BondInputs } from './types';

/** Drives behind the moods, each 0..1. */
export interface MoodDrives {
  fatigue: number;
  affection: number;
  curiosity: number;
  excitement: number;
  playfulness: number;
  /** A hard landing (phase 04): set at the impact, gone within seconds. */
  embarrassment: number;
}

const AIRBORNE = new Set(['flying', 'gliding', 'hovering', 'diving', 'stalling', 'landing', 'takeoff']);

/**
 * The dragon's mood: five drives relax toward targets set by the situation (flight time, stamina, the hour, petting,
 * discoveries, flow) and take impulses from events; each has its own time constant, so every impulse decays. The
 * mood is the drive with the highest score, with hysteresis: a challenger must beat the current score by
 * BOND.mood.margin for BOND.mood.dwell s, and a mood holds at least BOND.mood.minHold s (a strong excitement
 * switches sooner). Content is the resting state.
 */
export class MoodModel {
  readonly drives: MoodDrives = { fatigue: 0.1, affection: 0.35, curiosity: 0.3, excitement: 0.05, playfulness: 0.25, embarrassment: 0 };
  mood: DragonMood = 'content';
  private held = 0;
  private challenger: DragonMood | null = null;
  private challengeTime = 0;
  /** Seconds of continuous flight (reset by resting on the ground, a perch or the water). */
  flightTime = 0;
  private restTime = 0;
  /** Transitions so far (checks). */
  switches = 0;

  /** Adds an impulse to a drive (clamped). */
  kick(drive: keyof MoodDrives, amount: number): void {
    this.drives[drive] = clamp(this.drives[drive] + amount, 0, 1);
  }

  /**
   * A hard landing: embarrassed at once (no hysteresis), for at least BOND.mood.embarrassHold s; the drive decays
   * with BOND.mood.embarrassDecay and the usual selection takes the mood back afterwards.
   */
  embarrass(): void {
    this.drives.embarrassment = 1;
    if (this.mood !== 'embarrassed') {
      this.mood = 'embarrassed';
      this.switches++;
    }
    this.held = 0;
    this.challenger = null;
    this.challengeTime = 0;
  }

  score(m: DragonMood): number {
    const d = this.drives;
    switch (m) {
      case 'embarrassed':
        return d.embarrassment;
      case 'tired':
        return d.fatigue;
      case 'excited':
        return d.excitement;
      case 'curious':
        return d.curiosity * (1 - 0.5 * d.fatigue);
      case 'playful':
        return d.playfulness * (1 - 0.7 * d.fatigue);
      default:
        return 0.3 + 0.35 * d.affection - 0.15 * d.fatigue;
    }
  }

  get level(): number {
    return clamp(this.score(this.mood), 0, 1);
  }

  update(inp: BondInputs): void {
    const dt = inp.dt;
    const c = BOND.mood;
    const d = this.drives;
    const airborne = AIRBORNE.has(inp.mode);
    const resting = inp.perched || inp.mode === 'grounded' || (inp.mode === 'swimming' && inp.groundSpeed < 1.5);
    if (airborne) {
      this.flightTime += dt;
      this.restTime = 0;
    } else if (resting) {
      this.restTime += dt;
      // A short hop does not reset the day's flight; a real rest does.
      if (this.restTime > 20) {
        this.flightTime = Math.max(0, this.flightTime - dt * 4);
      }
    }

    // Fatigue: long flight, low stamina, hard effort, the small hours; rest brings it down.
    const hourSleepy = smoothstep(21.5, 24, inp.hours) + (1 - smoothstep(4, 6.5, inp.hours)) + 0.35 * (smoothstep(13, 14, inp.hours) - smoothstep(15, 16, inp.hours));
    const flightTired = smoothstep(2 * 60, c.fatigueFullMinutes * 60, this.flightTime);
    const lowStamina = (1 - inp.stamina) * (1 - inp.stamina);
    const fatigueTarget = resting
      ? 0.08 + 0.3 * hourSleepy
      : clamp(0.1 + 0.62 * flightTired + 0.55 * lowStamina + 0.25 * inp.flapEffort * inp.flapEffort + 0.3 * hourSleepy, 0, 1);
    d.fatigue = approach(d.fatigue, fatigueTarget, 1 / (fatigueTarget > d.fatigue ? c.fatigueRise : resting ? c.fatigueRest : c.fatigueRise), dt);

    // Affection: petting fills it, it fades slowly.
    const petting = inp.petActive ? inp.petting : 0;
    d.affection = petting > 0.3 ? approach(d.affection, 1, 1 / c.affectionUp, dt * petting) : approach(d.affection, 0.3, 1 / c.affectionDecay, dt);

    // Curiosity: a calm daytime baseline, impulses from discoveries and sights (see BondCore), fades.
    // (kept well under content's score, so curiosity always settles back once the sights are gone)
    const curiousBase = 0.14 + 0.08 * (1 - inp.nightFactor) + (inp.mode === 'gliding' && inp.agl < 250 ? 0.05 : 0);
    d.curiosity = approach(d.curiosity, curiousBase, 1 / c.curiosityDecay, dt);

    // Excitement: flow and speed hold it up, impulses from tricks and discoveries, it fades fast.
    const speedThrill = airborne ? smoothstep(42, 70, inp.airspeed) * 0.55 : 0;
    const excitementTarget = Math.max(inp.flow * 0.95, speedThrill, 0.04);
    d.excitement = approach(d.excitement, excitementTarget, 1 / (excitementTarget > d.excitement ? c.excitementUp : c.excitementDecay), dt);

    // Playfulness: rested, fond and a little excited; mornings and evenings; over water.
    const dayPart = smoothstep(6.5, 8, inp.hours) * (1 - smoothstep(10.5, 12, inp.hours)) + smoothstep(16.5, 18, inp.hours) * (1 - smoothstep(20, 21.5, inp.hours));
    const playTarget = clamp((0.25 + 0.45 * d.affection + 0.3 * d.excitement + 0.18 * dayPart) * (1 - d.fatigue), 0, 1);
    d.playfulness = approach(d.playfulness, playTarget, 1 / (playTarget > d.playfulness ? c.playRise : c.playDecay), dt);

    // Embarrassment: only a hard landing sets it; it fades within seconds.
    d.embarrassment = approach(d.embarrassment, 0, 1 / c.embarrassDecay, dt);

    this.select(dt);
  }

  private select(dt: number): void {
    const c = BOND.mood;
    this.held += dt;
    let best: DragonMood = this.mood;
    let bestScore = this.score(this.mood);
    for (const m of MOODS) {
      const s = this.score(m);
      if (s > bestScore + c.margin) {
        best = m;
        bestScore = s;
      }
    }
    if (best === this.mood) {
      this.challenger = null;
      this.challengeTime = 0;
      return;
    }
    if (best !== this.challenger) {
      this.challenger = best;
      this.challengeTime = 0;
    }
    this.challengeTime += dt;
    const strongExcitement = best === 'excited' && bestScore > 0.75;
    const dwell = best === 'excited' ? c.dwellExcited : c.dwell;
    const minHold = this.mood === 'embarrassed' ? c.embarrassHold : c.minHold;
    if (this.challengeTime >= dwell && (this.held >= minHold || strongExcitement)) {
      this.mood = best;
      this.held = 0;
      this.challenger = null;
      this.challengeTime = 0;
      this.switches++;
    }
  }
}

/** One quiet Turkish line per mood for the pause menu (player-facing). */
export const MOOD_LINES: Record<DragonMood, string> = {
  content: 'Evren keyifli.',
  curious: 'Evren meraklı, etrafı kolluyor.',
  playful: 'Evren oyun havasında.',
  tired: 'Evren yorgun, dinlenmek istiyor.',
  excited: 'Evren heyecanlı.',
  embarrassed: 'Evren sert inişten biraz mahcup, silkinip toparlanıyor.',
};
