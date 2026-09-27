/**
 * The player's tab going to the background and back, online (phase 26). The browser stops the frame loop of a hidden
 * tab, so the game can neither simulate nor send: on hiding, the last snapshot goes out at once flagged `away` and the
 * other players continue the dragon on the loiter circle (./loiter.ts); on return, the local dragon is placed where
 * that circle has taken it (a `resume` teleport), so what everyone saw stays true. On the ground, perched or in the
 * water the dragon simply waited, and nothing moves on return.
 */
import type { GameEvents } from '../core/contracts';
import { headingDeg, loiter, loiters } from './loiter';
import { createSnapshot, decodeSnapshot, encodeSnapshot, type DragonSnapshot } from './snapshot';

export interface PresenceHooks {
  /** Whether the player is on a server now. */
  online(): boolean;
  /** The local dragon's snapshot at time `now` (ms), or null when there is no dragon. */
  capture(now: number): DragonSnapshot | null;
  send(data: ArrayBuffer): void;
  /** Places the local dragon (the engine's 'teleport' event). */
  place(e: GameEvents['teleport']): void;
  /** Called after a resume placement (the sender forgets its last position, so no jump is flagged). */
  resumed(): void;
}

export class Presence {
  /** The away snapshot as the others decoded it (same quantisation, so the same circle), while it loiters. */
  private away: DragonSnapshot | null = null;
  private hidden = false;
  private readonly onVisibility = (): void => (document.hidden ? this.hide() : this.show());

  /**
   * While the tab is hidden nothing else is sent, even where the browser still runs frames: the away snapshot stays the
   * last word, so the circle everyone draws and the place the dragon resumes from agree.
   */
  get isAway(): boolean {
    return this.hidden;
  }

  constructor(private readonly hooks: PresenceHooks) {
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  private hide(): void {
    this.hidden = true;
    if (!this.hooks.online()) {
      return;
    }
    const s = this.hooks.capture(performance.now());
    if (!s) {
      return;
    }
    s.away = true;
    s.teleport = false;
    const bytes = encodeSnapshot(s);
    const sent = decodeSnapshot(bytes);
    this.away = loiters(sent) ? sent : null;
    this.hooks.send(bytes);
  }

  private show(): void {
    this.hidden = false;
    const a = this.away;
    this.away = null;
    if (!a || !this.hooks.online()) {
      return;
    }
    const at = loiter(a, (performance.now() - a.t) / 1000, createSnapshot());
    const [x, y, z] = at.position;
    this.hooks.place({ x, y, z, headingDeg: headingDeg(at), pitchDeg: 0, speed: Math.hypot(...at.velocity), resume: true });
    this.hooks.resumed();
  }

  dispose(): void {
    document.removeEventListener('visibilitychange', this.onVisibility);
  }
}
