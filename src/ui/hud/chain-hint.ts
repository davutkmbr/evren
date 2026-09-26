import { HUD_PRIORITY, type HudDirector } from '../zones';

const ID = 'chain.next';

/** Key and Turkish verb of each move the next-move hint may suggest (the CONTROL_HELP key syntax). */
const MOVE_HINTS: Readonly<Record<string, readonly [keys: string, label: string]>> = {
  dart: ['Shift ×2', 'Ok gibi'],
  power: ['Space ×2', 'Güç vuruşu'],
  roll: ['A / D ×2', 'Takla'],
  slip: ['Q / E ×2', 'Kayış'],
};

/** At most this many suggestions. */
const MAX = 2;

/**
 * The next-move hint (phase 20 chain bursts): during a race, while the chain is open, the moves that would link now as
 * key hints on the shared hint line ("[Shift ×2] Ok gibi · [Space ×2] Güç vuruşu"). A joinable, low-priority item: it
 * rides along on the race's own hint line and yields to every caption.
 */
export class ChainHint {
  private key = '';

  constructor(private readonly zones: HudDirector) {}

  update(racing: boolean, next: readonly string[]): void {
    const kinds = racing ? next.filter((k) => MOVE_HINTS[k]).slice(0, MAX) : [];
    const key = kinds.join(',');
    if (key === this.key) {
      return;
    }
    this.key = key;
    if (!kinds.length) {
      this.zones.release(ID);
      return;
    }
    this.zones.request({
      id: ID,
      zone: 'lowerCenter',
      priority: HUD_PRIORITY.flightHint,
      maxWait: 1,
      hints: kinds.map((k) => MOVE_HINTS[k]),
      joinable: true,
      // The guided chain practice shows its own keys.
      deferIn: ['lesson'],
    });
  }

  dispose(): void {
    this.zones.release(ID);
  }
}
