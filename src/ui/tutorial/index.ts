/**
 * Contextual move hints (tutorial): the catalogue (hints-data.ts), the pure engine (engine.ts), the persisted progress
 * (store.ts) and the game-state sense (sense.ts). The UI system owns one TutorialHints: it forwards the flight's move
 * events and advances it every running frame.
 */
import type { EngineContext, GameEvents } from '../../core/contracts';
import type { ControlGroup } from '../../core/input';
import type { EventBus } from '../../core/events';
import type { HudDirector } from '../zones/director';
import { TutorialEngine } from './engine';
import { TUTORIAL_HINTS } from './hints-data';
import { emptyFrame, senseTutorial } from './sense';
import { TutorialStore } from './store';

export { TUTORIAL_HINT_ID, TutorialEngine, type TutorialStatus } from './engine';
export { TUTORIAL_HINTS, TUTORIAL_PACING, type TutorialFrame, type TutorialHintDef } from './hints-data';
export { TutorialStore } from './store';

export class TutorialHints {
  readonly engine: TutorialEngine;
  private readonly frame = emptyFrame();
  private active = false;

  constructor(private readonly zones: HudDirector, store: TutorialStore = new TutorialStore()) {
    this.engine = new TutorialEngine(zones, store);
  }

  /** The flight's move events: starts (captions), clean ends and chain links. */
  connect(events: EventBus<GameEvents>): () => void {
    const offs = [
      events.on('maneuver', ({ id, clean }) => {
        if (id !== 'hint') {
          this.engine.note(clean === undefined ? { kind: 'start', id } : { kind: 'start', id, clean });
        }
      }),
      events.on('maneuver-end', ({ id, clean }) => this.engine.note({ kind: 'end', id, clean })),
      events.on('chain-link', ({ link }) => this.engine.note({ kind: 'link', link })),
    ];
    return () => offs.forEach((off) => off());
  }

  /** Every started frame; `active` = flying with the HUD on screen (no menu, map, photo mode or hidden HUD). */
  update(ctx: EngineContext, active: boolean): void {
    if (!active) {
      if (this.active) {
        this.engine.suspend();
      }
      this.active = false;
      return;
    }
    this.active = true;
    this.engine.update(ctx.time.dt, senseTutorial(ctx, this.zones, this.frame));
  }

  /** Pause menu → Kontroller: is the move of this row not yet tried? (false for rows without a catalogue move) */
  untried(group: ControlGroup, keys: string): boolean {
    const def = TUTORIAL_HINTS.find((h) => h.control?.group === group && h.control.keys === keys);
    return !!def && this.engine.status(def.id) === 'new';
  }
}
