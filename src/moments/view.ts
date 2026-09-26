/**
 * DOM side of the moments: the subtitle line (lowerCenter zone) and the closing card (corner zone, the discovery card's
 * look). Both are plain shadowed text over the scene, no box (.docs/design/README.md), and both go through the HUD zone
 * director, so race lines and maneuver captions keep their priority.
 */
import type { HudZonesService } from '../core/contracts';
import { el } from '../ui/dom';
import { fadeBinding, HUD_PRIORITY, ZONE_CLASS } from '../ui/zones';
import type { Moment, MomentCategory, SubtitleLine } from './types';
import './moments.css';

const LINE_ID = 'moment.line';
const CARD_ID = 'moment.card';
/** Seconds the closing card stays (matches the discovery card's timer rule, 9 s). */
const CARD_DURATION_S = 9;
/** A card that cannot show within this many seconds is dropped. */
const CARD_MAX_WAIT_S = 6;

const CATEGORY_LABEL: Record<MomentCategory, string> = {
  legend: 'Efsane',
  'city-life': 'Şehir hayatı',
  poem: 'Şiir',
};

export class MomentView {
  private readonly speaker = el('span', 'moment-speaker');
  private readonly text = el('span', 'moment-text');
  readonly line = el('div', `${ZONE_CLASS.lowerCenter} hud-moment`, [el('p', 'moment-line', [this.speaker, this.text])], {
    role: 'status',
    'aria-live': 'polite',
  });
  private readonly lineBinding = fadeBinding(this.line);
  /** "[I] Kaynağa bak" under the subtitle line while a moment with sources plays (./source-prompt.ts). */
  private readonly sourceHint = el('p', 'moment-source');
  private sourceHintKey = '';

  private readonly cardMeta = el('span', 'dcard-meta');
  private readonly cardTitle = el('h3', 'dcard-title');
  private readonly cardInfo = el('p', 'dcard-info');
  private readonly cardTimer = el('i', 'dcard-timer');
  readonly card = el(
    'aside',
    `${ZONE_CLASS.corner} hud-dcard hud-moment-card`,
    [el('div', 'dcard-top', [el('span', 'dcard-badge', 'Yeni an'), this.cardMeta]), this.cardTitle, this.cardInfo, this.cardTimer],
    { 'aria-live': 'polite' },
  );
  private readonly cardBinding = fadeBinding(this.card);

  constructor(
    private readonly zones: HudZonesService,
    container: HTMLElement,
  ) {
    container.append(this.line, this.card);
    this.sourceHint.hidden = true;
    this.line.append(this.sourceHint);
  }

  /** Shows `nodes` (a key and its verb) under the subtitle line; null hides it. `key` identifies the content. */
  setSourceHint(key: string | null, nodes: () => Array<Node | string>): void {
    if ((key ?? '') === this.sourceHintKey) {
      return;
    }
    this.sourceHintKey = key ?? '';
    this.sourceHint.hidden = !key;
    this.sourceHint.replaceChildren(...(key ? nodes() : []));
  }

  showLine(line: SubtitleLine): void {
    this.line.classList.remove('is-slow');
    this.zones.request({
      id: LINE_ID,
      zone: 'lowerCenter',
      priority: HUD_PRIORITY.momentLine,
      deferIn: ['race'],
      onShow: () => {
        this.speaker.textContent = line.speaker ?? '';
        this.speaker.hidden = !line.speaker;
        this.text.textContent = line.text;
        this.lineBinding.onShow();
      },
      onHide: this.lineBinding.onHide,
    });
  }

  /** `fade`: the moment was cut short, the line leaves slowly. */
  hideLine(fade: boolean): void {
    this.line.classList.toggle('is-slow', fade);
    this.zones.release(LINE_ID);
  }

  showCard(moment: Moment): void {
    const card = moment.content.card;
    if (!card) {
      return;
    }
    this.zones.request({
      id: CARD_ID,
      zone: 'corner',
      priority: HUD_PRIORITY.discovery,
      duration: CARD_DURATION_S,
      maxWait: CARD_MAX_WAIT_S,
      deferIn: ['race'],
      onShow: () => {
        this.cardMeta.textContent = CATEGORY_LABEL[moment.category];
        this.cardTitle.textContent = card.title;
        this.cardInfo.textContent = card.text;
        this.cardTimer.classList.remove('is-running');
        void this.cardTimer.offsetWidth;
        this.cardTimer.classList.add('is-running');
        this.cardBinding.onShow();
      },
      onHide: this.cardBinding.onHide,
    });
  }

  dispose(): void {
    this.zones.release(LINE_ID);
    this.zones.release(CARD_ID);
    this.line.remove();
    this.card.remove();
  }
}
