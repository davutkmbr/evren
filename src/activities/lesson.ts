/**
 * Guided chain practice ("Zincir antrenmanı", phase 20, owner feedback: combos were hard to read). A built-in course over
 * open water south of Kadıköy (LESSON_COURSE in courses.ts) runs as a race (gates, speed rings, full-strength chain
 * bursts), but instead of a clock it walks through LESSON_STEPS: each step shows one instruction and its keys on the
 * shared hint line and moves on only when the player has done it (a move, the first link, a longer chain, a speed ring
 * during a chain, a skim). No times, no medals, no records.
 *
 * Pure logic (no DOM, no three.js): the activity system feeds it the flight's move and chain events and the chain
 * length every frame; tools/headless/races-check.ts drives it with scripted events.
 */

/** What a step asks for. */
export type LessonGoal =
  /** Start this move (maneuver id). */
  | { kind: 'move'; id: string }
  /** Land a chain link (any source). */
  | { kind: 'link' }
  /** Reach a chain of at least this many links. */
  | { kind: 'chain'; links: number }
  /** A link from a speed ring (taken while the chain is open). */
  | { kind: 'ring' };

export interface LessonStep {
  /** The instruction (Turkish, player-facing), shown as the hint line's caption. */
  text: string;
  /** Keys and verbs shown after it (the CONTROL_HELP key syntax). */
  hints: readonly (readonly [keys: string, label: string])[];
  goal: LessonGoal;
  /** Short praise when it is done (the title zone callout). */
  done: string;
}

/** The chain lesson: from one move to a four-link chain, the window, variety, a speed ring and the skim. */
export const LESSON_STEPS: readonly LessonStep[] = [
  {
    text: 'Hızlanınca ok gibi atıl',
    hints: [['Shift ×2', 'Ok gibi']],
    goal: { kind: 'move', id: 'dart' },
    done: 'Hareket bitti, çubuk doldu',
  },
  {
    text: 'Sayacın altındaki çubuk boşalmadan farklı bir hareket yap',
    hints: [['Space ×2', 'Güç vuruşu']],
    goal: { kind: 'link' },
    done: 'İlk halka: hız patlaması',
  },
  {
    text: 'Zinciri sürdür: üçüncü, farklı bir hareket',
    hints: [['A / D ×2', 'Takla']],
    goal: { kind: 'chain', links: 2 },
    done: '2 halka',
  },
  {
    text: 'Aynı hareket saymaz. Farklı hareketlerle 3 halka kur',
    hints: [
      ['Shift ×2', 'Ok gibi'],
      ['Space ×2', 'Güç vuruşu'],
      ['A / D ×2', 'Takla'],
    ],
    goal: { kind: 'chain', links: 3 },
    done: '3 halka: en büyük patlama',
  },
  {
    text: 'Zincir açıkken turkuaz hız halkasından geç',
    hints: [['Shift ×2', 'Ok gibi']],
    goal: { kind: 'ring' },
    done: 'Hız halkası da halka sayıldı',
  },
  {
    text: 'Suya alçal ve yüzeyi sıyırarak uç',
    hints: [['W', 'Alçal']],
    goal: { kind: 'move', id: 'skim' },
    done: 'Sıyırma da bir hareket',
  },
  {
    text: 'Serbest: 4 halkalık zincir kur',
    hints: [
      ['Shift ×2', 'Ok gibi'],
      ['Space ×2', 'Güç vuruşu'],
      ['A / D ×2', 'Takla'],
      ['Q / E ×2', 'Kayış'],
    ],
    goal: { kind: 'chain', links: 4 },
    done: 'Antrenman tamam',
  },
];

/** Caption of the hint line once every step is done. */
export const LESSON_FINISHED_TEXT = 'Antrenman tamam: yarışlarda zincir kur';

/** Step counter in front of the instruction ("2/7"). */
export function lessonStepLabel(index: number, total: number): string {
  return `${index + 1}/${total}`;
}

export class LessonRunner {
  index = 0;

  constructor(readonly steps: readonly LessonStep[] = LESSON_STEPS) {}

  get done(): boolean {
    return this.index >= this.steps.length;
  }

  get step(): LessonStep | null {
    return this.steps[this.index] ?? null;
  }

  /** A move started (maneuver id); returns the step it completed, or null. */
  move(id: string): LessonStep | null {
    const s = this.step;
    return s && s.goal.kind === 'move' && s.goal.id === id ? this.advance() : null;
  }

  /** A chain link landed (its number in the chain and its source); returns the step it completed, or null. */
  link(link: number, source: 'motion' | 'ring' | 'gate'): LessonStep | null {
    const s = this.step;
    if (!s) {
      return null;
    }
    const g = s.goal;
    if (g.kind === 'link' || (g.kind === 'ring' && source === 'ring') || (g.kind === 'chain' && link >= g.links)) {
      return this.advance();
    }
    return null;
  }

  private advance(): LessonStep {
    const s = this.steps[this.index];
    this.index++;
    return s;
  }
}
