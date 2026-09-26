/**
 * DOM side of the ferry escort (./presenter.ts decides when): the line under the compass and the arrival card. Plain
 * shadowed text, no boxes (.docs/design/README.md). Both live inside the game HUD (.ejd-hud), so they hide with it
 * (menus, map, photo mode, U, ?nohud). The offer and the drift note are items of the shared hint line (rendered by the
 * UI's HintLineView).
 */
import { el } from '../../ui/dom';
import { fadeBinding, ZONE_CLASS } from '../../ui/zones';
import { Text, Transform, toggle } from '../hud/dom';
import type { EscortCardInfo, EscortLineState, EscortRender } from './presenter';
import { ESCORT_TEXT } from './text';
import './escort.css';

/** Travel of the closeness dot (px): at the start beside the ferry, at the end at the escort radius. */
const METER_PX = 44;

export class EscortView implements EscortRender {
  private readonly lineText = new Text(el('span', 'escort-line-text'));
  private readonly lineDetail = new Text(el('span', 'escort-line-detail ejd-num'));
  private readonly dot = el('i', 'escort-meter-dot');
  private readonly dotPos = new Transform(this.dot);
  private readonly meter = el('span', 'escort-meter', [this.dot]);
  readonly line = el('div', `${ZONE_CLASS.topLine} escort-line`, [el('span', 'escort-line-row', [this.lineText.node, this.lineDetail.node, this.meter])], {
    role: 'status',
  });
  readonly lineBinding = fadeBinding(this.line);

  private readonly cardBadge = el('span', 'dcard-badge', ESCORT_TEXT.card.badge);
  private readonly cardMeta = el('span', 'dcard-meta', ESCORT_TEXT.card.meta);
  private readonly cardDuration = el('span', 'dcard-dist ejd-num');
  private readonly cardTitle = el('h3', 'dcard-title');
  private readonly cardInfo = el('p', 'dcard-info');
  private readonly cardRoutes = el('p', 'escort-card-routes ejd-num');
  private readonly cardTimer = el('i', 'dcard-timer');
  readonly cardNode = el(
    'aside',
    `${ZONE_CLASS.corner} hud-dcard escort-card`,
    [el('div', 'dcard-top', [this.cardBadge, this.cardMeta, this.cardDuration]), this.cardTitle, this.cardInfo, this.cardRoutes, this.cardTimer],
    { 'aria-live': 'polite' },
  );
  private readonly cardBinding = fadeBinding(this.cardNode);

  constructor(container: HTMLElement) {
    this.line.setAttribute('lang', 'tr');
    this.cardNode.setAttribute('lang', 'tr');
    container.append(this.line, this.cardNode);
  }

  setLine(s: EscortLineState): void {
    this.lineText.set(s.text);
    this.lineDetail.set(s.detail);
    toggle(this.lineDetail.node, 'is-empty', !s.detail);
    const k = Math.min(1, Math.max(0, s.closeness));
    this.dotPos.set(`translateX(${Math.round(k * METER_PX)}px)`);
    toggle(this.meter, 'is-away', s.away);
  }

  card(info: EscortCardInfo): { onShow: () => void; onHide: () => void } {
    return {
      onShow: () => {
        this.cardBadge.hidden = !info.first;
        this.cardDuration.textContent = info.duration;
        this.cardTitle.textContent = info.route;
        this.cardInfo.textContent = info.warm;
        this.cardRoutes.textContent = info.routes;
        this.cardTimer.classList.remove('is-running');
        void this.cardTimer.offsetWidth;
        this.cardTimer.classList.add('is-running');
        this.cardBinding.onShow();
      },
      onHide: this.cardBinding.onHide,
    };
  }

  dispose(): void {
    this.line.remove();
    this.cardNode.remove();
  }
}
