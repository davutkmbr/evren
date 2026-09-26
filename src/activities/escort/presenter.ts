/**
 * What the ferry escort puts on screen, through the HUD zone director (src/ui/zones; pure TS, no DOM, so the headless
 * check drives it with the real director). The DOM side (./view.ts) renders the owner-drawn items.
 *
 * - "[Z] Vapura eşlik et": the shared hint line (lowerCenter, HUD_PRIORITY.escortPrompt, joinable) while a ferry is on
 *   offer.
 * - "Sıradaki iskele: Kadıköy · 1,4 km" and a small closeness line: the top zone's line under the compass
 *   (HUD_PRIORITY.escortLine, above the compass landmark label) while escorting.
 * - "Vapurdan uzaklaşıyorsun · [Z] Eşliği bırak": the hint line (HUD_PRIORITY.escortNote) while drifting away.
 * - The arrival card: the corner zone, the discovery card's look and priority, 9 s.
 * Every item is deferred while a race holds the screen (context 'race').
 */
import type { HudZonesService } from '../../core/contracts';
import { HUD_PRIORITY } from '../../ui/zones/director';
import { ESCORT_TUNING, type EscortTracker } from './escort';
import { ESCORT_KEY, ESCORT_TEXT } from './text';

export const ESCORT_IDS = {
  prompt: 'escort.prompt',
  line: 'escort.line',
  note: 'escort.note',
  card: 'escort.card',
} as const;

/** Seconds the arrival card stays (the discovery card's 9 s) and may wait for the corner. */
export const ESCORT_CARD_S = 9;
const CARD_MAX_WAIT_S = 6;
const RACE: readonly string[] = ['race'];

export interface EscortLineState {
  /** "Sıradaki iskele: Kadıköy" or "Vapur iskelede · Sıradaki iskele: Üsküdar". */
  text: string;
  /** "1,4 km" to the next pier ('' while alongside). */
  detail: string;
  /** 0 at the ferry, 1 at the edge of the escort radius (may exceed 1 while away). */
  closeness: number;
  away: boolean;
}

export interface EscortCardInfo {
  /** "Eminönü → Kadıköy". */
  route: string;
  /** "6 dk 52 sn". */
  duration: string;
  warm: string;
  /** "Eşlik edilen hatlar 3/24". */
  routes: string;
  /** First escort of this leg ("Yeni hat"). */
  first: boolean;
}

/** DOM side (./view.ts); null in headless runs. */
export interface EscortRender {
  readonly lineBinding: { onShow: () => void; onHide: () => void };
  setLine(state: EscortLineState): void;
  /** Fills the card and returns its fade binding. */
  card(info: EscortCardInfo): { onShow: () => void; onHide: () => void };
}

export class EscortPresenter {
  private promptOn = false;
  private lineOn = false;
  private noteOn = false;
  /** Last line state (tests, the debug hook). */
  readonly line: EscortLineState = { text: '', detail: '', closeness: 0, away: false };
  /** Last card requested. */
  lastCard: EscortCardInfo | null = null;

  constructor(
    private readonly zones: HudZonesService,
    private readonly render: EscortRender | null = null,
  ) {}

  /** Brings the offer, the escort line and the drift note in line with the tracker (every running frame). */
  sync(t: EscortTracker): void {
    this.setPrompt(!t.active && t.offer >= 0);
    this.setNote(t.drifting);
    if (!t.active || !t.leg) {
      this.setLine(false);
      return;
    }
    const l = this.line;
    const next = ESCORT_TEXT.nextPier(t.leg.toName);
    l.text = t.phase === 'docked' ? `${ESCORT_TEXT.docked} · ${next}` : next;
    l.detail = t.phase === 'docked' ? '' : ESCORT_TEXT.pierDistance(t.pierDistance);
    l.closeness = t.distance / ESCORT_TUNING.keepRadius;
    l.away = t.away > 0;
    this.setLine(true);
    this.render?.setLine(l);
  }

  /** The ferry came alongside: the closing card in the corner. */
  arrived(info: EscortCardInfo): void {
    this.lastCard = info;
    const binding = this.render?.card(info);
    this.zones.request({
      id: ESCORT_IDS.card,
      zone: 'corner',
      priority: HUD_PRIORITY.discovery,
      duration: ESCORT_CARD_S,
      maxWait: CARD_MAX_WAIT_S,
      deferIn: RACE,
      onShow: binding?.onShow,
      onHide: binding?.onHide,
    });
  }

  /** Releases everything (dispose). */
  clear(): void {
    this.setPrompt(false);
    this.setNote(false);
    this.setLine(false);
    this.zones.release(ESCORT_IDS.card);
  }

  private setPrompt(on: boolean): void {
    if (on === this.promptOn) {
      return;
    }
    this.promptOn = on;
    if (on) {
      this.zones.request({
        id: ESCORT_IDS.prompt,
        zone: 'lowerCenter',
        priority: HUD_PRIORITY.escortPrompt,
        hints: [[ESCORT_KEY, ESCORT_TEXT.prompt]],
        joinable: true,
        deferIn: RACE,
      });
    } else {
      this.zones.release(ESCORT_IDS.prompt);
    }
  }

  private setNote(on: boolean): void {
    if (on === this.noteOn) {
      return;
    }
    this.noteOn = on;
    if (on) {
      this.zones.request({
        id: ESCORT_IDS.note,
        zone: 'lowerCenter',
        priority: HUD_PRIORITY.escortNote,
        caption: ESCORT_TEXT.away,
        hints: [[ESCORT_KEY, ESCORT_TEXT.stop]],
        deferIn: RACE,
      });
    } else {
      this.zones.release(ESCORT_IDS.note);
    }
  }

  private setLine(on: boolean): void {
    if (on === this.lineOn) {
      return;
    }
    this.lineOn = on;
    if (on) {
      this.zones.request({
        id: ESCORT_IDS.line,
        zone: 'top',
        priority: HUD_PRIORITY.escortLine,
        deferIn: RACE,
        onShow: this.render?.lineBinding.onShow,
        onHide: this.render?.lineBinding.onHide,
      });
    } else {
      this.zones.release(ESCORT_IDS.line);
    }
  }
}
