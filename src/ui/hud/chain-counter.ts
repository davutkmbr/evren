import { el, toggleClass } from '../dom';

/** After the chain breaks the count stays this long (s), then fades out. */
const HOLD_S = 1.2;
/** How long a link's accent lasts (s). */
const ACCENT_S = 0.45;

/**
 * The chain counter (phase 20 chain bursts): the number of clean links in the current chain as a small "×3" at the right
 * end of the flow line, in the stamina wings' gold. Text only, no box. Each new link brightens it briefly (a single
 * accent, no bounce); it appears with the first link and fades out shortly after the chain breaks. The label is for
 * assistive technology.
 */
export class ChainCounter {
  readonly root: HTMLElement;
  private readonly value: HTMLElement;
  private shownCount = 0;
  private last = 0;
  private holdFor = 0;
  private accentFor = 0;
  private shown = false;

  constructor() {
    this.value = el('span', 'hud-chain-val ejd-num', '');
    this.root = el('div', 'hud-chain is-idle', [this.value], { role: 'status', 'aria-live': 'off' });
  }

  update(chain: number, realDt: number): void {
    const n = Math.max(0, Math.floor(chain));
    if (n > this.last) {
      this.accentFor = ACCENT_S;
    }
    this.last = n;
    if (n > 0) {
      this.holdFor = HOLD_S;
      if (n !== this.shownCount) {
        this.shownCount = n;
        this.value.textContent = `×${n}`;
        this.root.setAttribute('aria-label', `Zincir ${n}`);
      }
    } else {
      this.holdFor = Math.max(0, this.holdFor - realDt);
    }
    this.accentFor = Math.max(0, this.accentFor - realDt);
    const shown = n > 0 || this.holdFor > 0;
    if (shown !== this.shown) {
      this.shown = shown;
      toggleClass(this.root, 'is-idle', !shown);
    }
    toggleClass(this.root, 'is-lit', this.accentFor > 0);
    toggleClass(this.root, 'is-broken', n === 0);
  }
}
