/**
 * The "[I] Kaynağa bak" prompt of the moments (phase 19, sources): while a moment with sources plays the prompt rides
 * quietly under its subtitle line (the subtitle owns the hint line then); for SOURCE_PROMPT_AFTER_S after it ends it
 * is a low-priority, joinable item of the shared hint line (HUD_PRIORITY.momentSource, deferred by a race). Pressing
 * the key asks the UI to open the source sheet (`moment-source` event). Every moment that starts is recorded as seen
 * (pause menu → Anlar).
 */
import type { EngineContext, HudZonesService } from '../core/contracts';
import { keyText } from '../ui/components/key-text';
import { HUD_PRIORITY } from '../ui/zones';
import { markMomentSeen } from './seen';
import { SourcePromptWindow, type SourcePromptState } from './sources';
import type { Moment } from './types';
import type { MomentView } from './view';

/** Key cap of the source key (input button 'source', KeyI). */
export const SOURCE_KEY = 'I';
export const SOURCE_VERB = 'Kaynağa bak';
const HINT_ID = 'moment.source';

export class SourcePromptController {
  readonly window = new SourcePromptWindow();
  private lastPlaying: Moment | null = null;
  private hintFor: Moment | null = null;

  /** Call once per running frame, after the runner updated. */
  update(dt: number, ctx: EngineContext, playing: Moment | null, racing: boolean, view: MomentView | null): SourcePromptState {
    if (playing && playing !== this.lastPlaying) {
      markMomentSeen(playing.id);
    }
    this.lastPlaying = playing;
    const state = this.window.update(dt, playing, racing);
    view?.setSourceHint(state?.phase === 'playing' ? state.moment.id : null, () => keyText(`[${SOURCE_KEY}] ${SOURCE_VERB}`, 'quiet'));
    const zones = ctx.services.tryGet('hudZones');
    if (zones) {
      this.syncHint(zones, state);
    }
    if (state && ctx.input.wasPressed('source')) {
      ctx.events.emit('moment-source', { id: state.moment.id });
    }
    return state;
  }

  private syncHint(zones: HudZonesService, state: SourcePromptState): void {
    const want = state?.phase === 'after' ? state.moment : null;
    if (want === this.hintFor) {
      return;
    }
    this.hintFor = want;
    if (!want || state?.phase !== 'after') {
      zones.release(HINT_ID);
      return;
    }
    zones.request({
      id: HINT_ID,
      zone: 'lowerCenter',
      priority: HUD_PRIORITY.momentSource,
      duration: state.remaining,
      maxWait: state.remaining,
      deferIn: ['race'],
      caption: want.title,
      hints: [[SOURCE_KEY, SOURCE_VERB]],
      joinable: true,
    });
  }

  dispose(ctx: EngineContext | null): void {
    ctx?.services.tryGet('hudZones')?.release(HINT_ID);
  }
}
