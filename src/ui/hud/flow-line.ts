import { el, toggleClass, TransformSlot } from '../dom';

/** Below this the line counts as empty (fades out). */
const EMPTY = 0.01;
/** Empty for this long → fade out (s). */
const HIDE_AFTER_S = 0.6;

/**
 * Flow ("akış", phase 20 stage D) as a thin line under the stamina wings, in their visual family: it grows from the
 * centre outward to both sides as flow builds and shrinks as it fades. Contextual: shown only while there is flow.
 * No number; the Turkish label is for assistive technology.
 */
export class FlowLine {
  readonly root: HTMLElement;
  private readonly fill: TransformSlot;
  private emptyFor = HIDE_AFTER_S;
  private shown = false;
  private label = '';

  constructor() {
    const fill = el('i', 'flw-fill');
    this.fill = new TransformSlot(fill);
    this.root = el('div', 'hud-flow is-idle', [fill], { role: 'meter', 'aria-valuemin': 0, 'aria-valuemax': 100 });
  }

  /** Every frame (a transform; the class and the label change rarely). */
  update(flow: number, realDt: number): void {
    const value = Math.min(1, Math.max(0, flow));
    this.emptyFor = value < EMPTY ? this.emptyFor + realDt : 0;
    this.fill.set(`scaleX(${value.toFixed(3)})`);
    const shown = this.emptyFor < HIDE_AFTER_S;
    if (shown !== this.shown) {
      this.shown = shown;
      toggleClass(this.root, 'is-idle', !shown);
    }
    toggleClass(this.root, 'is-full', value > 0.97);
    const label = `Akış %${Math.round(value * 100)}`;
    if (label !== this.label) {
      this.label = label;
      this.root.setAttribute('aria-label', label);
      this.root.setAttribute('aria-valuenow', String(Math.round(value * 100)));
    }
  }
}
