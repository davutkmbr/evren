import { el, toggleClass, TransformSlot } from '../dom';

/** After the chain breaks the count stays this long (s) with "koptu", then fades out. */
const HOLD_S = 1.4;
/** How long a link's accent lasts (s). */
const ACCENT_S = 0.45;

/**
 * The chain counter (phase 20 chain bursts): the number of links in the current chain as a small "×3" at the right end of
 * the flow line, in the stamina wings' gold, with a thin bar under it that drains through the chain window after a
 * move ends cleanly ("start a different move now"). Text only, no box. Each new link brightens it briefly (a single
 * accent, no bounce); when the chain breaks it dims with "koptu" and fades out. The label is for assistive technology.
 */
export class ChainCounter {
  readonly root: HTMLElement;
  private readonly value: HTMLElement;
  private readonly note: HTMLElement;
  private readonly bar: TransformSlot;
  private readonly barRoot: HTMLElement;
  private shownCount = 0;
  private last = 0;
  private holdFor = 0;
  private accentFor = 0;
  private shown = false;
  private barShown = false;

  constructor() {
    this.value = el('span', 'hud-chain-val ejd-num', '');
    this.note = el('span', 'hud-chain-note', 'koptu');
    const fill = el('i', 'hud-chain-win-fill');
    this.bar = new TransformSlot(fill);
    this.barRoot = el('span', 'hud-chain-win is-idle', [fill]);
    this.root = el('div', 'hud-chain is-idle', [this.value, this.note, this.barRoot], { role: 'status', 'aria-live': 'off' });
  }

  /** `window`: 0..1 of the chain window left, -1 when none runs. */
  update(chain: number, window: number, realDt: number): void {
    const n = Math.max(0, Math.floor(chain));
    if (n > this.last) {
      this.accentFor = ACCENT_S;
    }
    const broke = n === 0 && this.last > 0;
    this.last = n;
    if (n > 0) {
      this.holdFor = HOLD_S;
      if (n !== this.shownCount) {
        this.shownCount = n;
        this.value.textContent = `×${n}`;
        this.root.setAttribute('aria-label', `Zincir ${n}`);
      }
    } else {
      this.holdFor = broke ? HOLD_S : Math.max(0, this.holdFor - realDt);
    }
    this.accentFor = Math.max(0, this.accentFor - realDt);
    const shown = n > 0 || this.holdFor > 0 || window >= 0;
    if (shown !== this.shown) {
      this.shown = shown;
      toggleClass(this.root, 'is-idle', !shown);
    }
    if (n === 0 && this.shownCount === 0 && window >= 0) {
      // A first clean move: the window runs before there is a count.
      this.value.textContent = '';
    }
    toggleClass(this.root, 'is-lit', this.accentFor > 0);
    toggleClass(this.root, 'is-broken', n === 0 && this.holdFor > 0 && this.shownCount > 0);
    if (n === 0 && this.holdFor <= 0) {
      this.shownCount = 0;
    }
    const barOn = window >= 0;
    if (barOn) {
      this.bar.set(`scaleX(${window.toFixed(3)})`);
    }
    if (barOn !== this.barShown) {
      this.barShown = barOn;
      toggleClass(this.barRoot, 'is-idle', !barOn);
    }
  }
}
