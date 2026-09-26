/**
 * Tutorial hint engine (pure TS, no DOM): decides when one of the catalogue's move hints (hints-data.ts) appears on the
 * shared hint line. Deterministic: time only advances in update(dt), so tools/headless/tutorial-check.ts drives it with
 * scripted frames and the real zone director.
 *
 * Rules (.docs/planning/20-movement.md, "Discoverability"):
 * - Triggers are evaluated TUTORIAL_PACING.evalHz times per second; a trigger must hold for its `hold` seconds.
 * - At most one hint at a time (one zone item id), the lowest priority on the hint line (HUD_PRIORITY.tutorialHint);
 *   a hint that cannot show within `maxWait` is dropped, one displaced by any other message is gone.
 * - Global pacing: nothing in the first `firstAfter` seconds of play or while the start hints are requested, the line
 *   free for `quiet` seconds, one new hint per `gap` seconds, `sessionMax` per session.
 * - Never during a race, a perch prompt / approach / viewing, a landing approach, or without a dragon; the UI does
 *   not advance the engine (and drops its hint) while a menu, the map, photo mode or a hidden HUD is up.
 * - Per hint: `maxShows` in total (persisted), a `cooldown` between shows; once the move was tried at most two shows
 *   and a doubled cooldown; learned (performed cleanly) = never again; performing the move while its hint shows
 *   removes the hint.
 */
import type { FlightMode, HudZonesService } from '../../core/contracts';
import { HUD_PRIORITY } from '../zones/director';
import { TUTORIAL_HINTS, TUTORIAL_PACING, type TutorialEvent, type TutorialFrame, type TutorialHintDef, type TutorialMemory } from './hints-data';
import type { TutorialStore } from './store';

/** Zone item id of the tutorial hint (one id: never two hints at once). */
export const TUTORIAL_HINT_ID = 'hint.tutorial';

export type TutorialPacing = { -readonly [K in keyof typeof TUTORIAL_PACING]: number };

export type TutorialStatus = 'learned' | 'tried' | 'new';

type Zones = Pick<HudZonesService, 'request' | 'release'>;

interface Showing {
  def: TutorialHintDef;
  shown: boolean;
  /** Seconds since the request. */
  age: number;
  /** Seconds the (non-sticky) trigger has not held while shown. */
  lost: number;
}

export class TutorialEngine implements TutorialMemory {
  /** Seconds of play the engine has seen. */
  playTime = 0;
  modeTime = 0;
  private mode: FlightMode | null = null;
  private evalAcc = 0;
  private quietTime = 0;
  private lastHintAt = -Infinity;
  private sessionShows = 0;
  private current: Showing | null = null;
  private readonly hold = new Map<string, number>();
  private readonly lastShownAt = new Map<string, number>();
  private readonly starts = new Map<string, number>();
  private readonly modeSeen = new Map<FlightMode, number>();
  private readonly pacing: TutorialPacing;

  constructor(
    private readonly zones: Zones,
    private readonly store: TutorialStore,
    private readonly catalogue: readonly TutorialHintDef[] = TUTORIAL_HINTS,
    pacing: Partial<TutorialPacing> = {},
  ) {
    this.pacing = { ...TUTORIAL_PACING, ...pacing };
  }

  get enabled(): boolean {
    return this.store.progress.enabled;
  }

  setEnabled(on: boolean): void {
    this.store.progress.enabled = on;
    this.store.save();
    if (!on) {
      this.drop();
    }
  }

  /** Id of the hint requested or on screen, '' when none. */
  get showing(): string {
    return this.current?.def.id ?? '';
  }

  /** Is the current hint actually on screen (not only requested)? */
  get onScreen(): boolean {
    return !!this.current?.shown;
  }

  status(id: string): TutorialStatus {
    const p = this.store.progress;
    return p.learned.has(id) ? 'learned' : p.tried.has(id) ? 'tried' : 'new';
  }

  shownCount(id: string): number {
    return this.store.progress.shown[id] ?? 0;
  }

  /** "İpuçlarını sıfırla": persisted progress and this session's pacing start over. */
  reset(): void {
    this.drop();
    this.store.reset();
    this.hold.clear();
    this.lastShownAt.clear();
    this.lastHintAt = -Infinity;
    this.sessionShows = 0;
  }

  /* ---------------- TutorialMemory ---------------- */

  since(id: string): number {
    const t = this.starts.get(id);
    return t === undefined ? Infinity : this.playTime - t;
  }

  wasMode(mode: FlightMode, seconds: number): boolean {
    if (this.mode === mode) {
      return true;
    }
    const t = this.modeSeen.get(mode);
    return t !== undefined && this.playTime - t <= seconds;
  }

  /* ---------------- events ---------------- */

  /** A game event: a move started or ended, a chain link (mode changes are noted by update()). */
  note(e: TutorialEvent): void {
    if (e.kind === 'start') {
      this.starts.set(e.id, this.playTime);
    }
    const p = this.store.progress;
    let dirty = false;
    for (const def of this.catalogue) {
      const result = def.learn(e, this);
      if (!result) {
        continue;
      }
      if (result === 'learned' && !p.learned.has(def.id)) {
        p.learned.add(def.id);
        dirty = true;
      }
      if (!p.tried.has(def.id)) {
        p.tried.add(def.id);
        dirty = true;
      }
      // The player just did it: the hint has done its job.
      if (this.current?.def === def) {
        this.drop();
      }
    }
    if (dirty) {
      this.store.save();
    }
  }

  /* ---------------- per frame ---------------- */

  /** Advances `dt` seconds of play (0 while paused) with the current state. */
  update(dt: number, f: TutorialFrame): void {
    if (!this.enabled) {
      this.drop();
      return;
    }
    this.playTime += dt;
    if (f.mode !== this.mode) {
      const from = this.mode;
      this.mode = f.mode;
      this.modeTime = 0;
      this.note({ kind: 'mode', mode: f.mode, from });
    } else {
      this.modeTime += dt;
    }
    if (f.mode) {
      this.modeSeen.set(f.mode, this.playTime);
    }
    this.quietTime = f.lineBusy ? 0 : this.quietTime + dt;
    const blocked = this.blocked(f);
    const cur = this.current;
    if (cur) {
      cur.age += dt;
      if (blocked || (!cur.shown && cur.age > this.pacing.maxWait + 0.1)) {
        this.drop();
      }
    }

    this.evalAcc += dt;
    const step = 1 / this.pacing.evalHz;
    if (this.evalAcc + 1e-9 < step) {
      return;
    }
    const elapsed = this.evalAcc;
    this.evalAcc = 0;
    for (const def of this.catalogue) {
      const held = def.trigger(f, this) ? (this.hold.get(def.id) ?? 0) + elapsed : 0;
      this.hold.set(def.id, held);
    }
    const now = this.current;
    if (now?.shown && !now.def.sticky) {
      now.lost = (this.hold.get(now.def.id) ?? 0) > 0 ? 0 : now.lost + elapsed;
      if (now.lost >= this.pacing.lostGrace) {
        this.drop();
      }
    }
    if (!this.current && !blocked) {
      this.choose(f);
    }
  }

  /** Suspends the engine's hint (menus, photo mode, hidden HUD): the hint leaves; the pacing keeps its state. */
  suspend(): void {
    this.drop();
  }

  private blocked(f: TutorialFrame): boolean {
    return f.mode === null || f.racing || f.perchBusy || f.mode === 'landing';
  }

  private maxShows(def: TutorialHintDef): number {
    const max = def.maxShows ?? this.pacing.maxShows;
    return this.store.progress.tried.has(def.id) ? Math.min(max, 2) : max;
  }

  private eligible(def: TutorialHintDef): boolean {
    const p = this.store.progress;
    if (p.learned.has(def.id) || (p.shown[def.id] ?? 0) >= this.maxShows(def)) {
      return false;
    }
    const cooldown = (def.cooldown ?? this.pacing.cooldown) * (p.tried.has(def.id) ? 2 : 1);
    const last = this.lastShownAt.get(def.id);
    if (last !== undefined && this.playTime - last < cooldown) {
      return false;
    }
    return !def.after || def.after.every((a) => (p.shown[a] ?? 0) > 0 || p.learned.has(a));
  }

  private choose(f: TutorialFrame): void {
    const pc = this.pacing;
    if (this.playTime < pc.firstAfter || f.startHints || this.quietTime < pc.quiet || this.playTime - this.lastHintAt < pc.gap || this.sessionShows >= pc.sessionMax) {
      return;
    }
    for (const def of this.catalogue) {
      // Held now (> 0: the trigger is true this evaluation) and long enough.
      const held = this.hold.get(def.id) ?? 0;
      if (held > 0 && held + 1e-9 >= (def.hold ?? pc.hold) && this.eligible(def)) {
        this.show(def);
        return;
      }
    }
  }

  private show(def: TutorialHintDef): void {
    const showing: Showing = { def, shown: false, age: 0, lost: 0 };
    this.current = showing;
    this.zones.request({
      id: TUTORIAL_HINT_ID,
      zone: 'lowerCenter',
      priority: HUD_PRIORITY.tutorialHint,
      duration: this.pacing.duration,
      maxWait: this.pacing.maxWait,
      deferIn: ['race'],
      ...(def.keys ? { hints: [[def.keys, def.text] as const] } : { caption: def.text }),
      onShow: () => {
        if (showing.shown || this.current !== showing) {
          return;
        }
        showing.shown = true;
        const p = this.store.progress;
        p.shown[def.id] = (p.shown[def.id] ?? 0) + 1;
        this.store.save();
        this.lastShownAt.set(def.id, this.playTime);
        this.lastHintAt = this.playTime;
        this.sessionShows++;
      },
      onHide: () => {
        // Ended, or displaced by another message: a tutorial hint does not come back later.
        if (this.current === showing) {
          this.current = null;
        }
        this.zones.release(TUTORIAL_HINT_ID);
      },
    });
  }

  private drop(): void {
    if (this.current) {
      this.current = null;
      this.zones.release(TUTORIAL_HINT_ID);
    }
  }
}
