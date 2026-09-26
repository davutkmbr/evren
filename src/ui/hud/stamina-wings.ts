import { el, svg, toggleClass, TransformSlot } from '../dom';

/** Below this the bars turn warm and pulse. */
const LOW = 0.25;
/** Full and not draining for this long → the row fades out (s). */
const HIDE_AFTER_S = 3;

const EMBLEM = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20c-1-3-1-6 0-9 1 3 1 6 0 9zM12 11C9 6 5 5 2 6c3 1 5 3 6 6M12 11c3-5 7-6 10-5-3 1-5 3-6 6"/></svg>`;

/**
 * Stamina as two wing-shaped bars mirrored from a small dragon-wing emblem. The bars empty from their outer tips
 * inward. Contextual: the row fades out a few seconds after stamina is full and steady, and back in as soon as it drains.
 */
export class StaminaWings {
  readonly root: HTMLElement;
  private readonly left: TransformSlot;
  private readonly right: TransformSlot;
  private last = -1;
  private steadyFor = 0;
  private shown = true;
  private label = '';

  constructor() {
    const leftFill = el('i', 'stw-fill');
    const rightFill = el('i', 'stw-fill');
    this.left = new TransformSlot(leftFill);
    this.right = new TransformSlot(rightFill);
    const emblem = el('span', 'stw-emblem');
    emblem.append(svg(EMBLEM));
    this.root = el('div', 'hud-stamina', [el('div', 'stw-bar is-left', [leftFill]), emblem, el('div', 'stw-bar is-right', [rightFill])], {
      role: 'meter',
      'aria-valuemin': 0,
      'aria-valuemax': 100,
    });
  }

  /** Every frame (transforms only; classes and the label change rarely). */
  update(stamina: number, realDt: number): void {
    const value = Math.min(1, Math.max(0, stamina));
    const draining = this.last >= 0 && value < this.last - 1e-5;
    if (draining || value < 0.995) {
      this.steadyFor = 0;
    } else {
      this.steadyFor += realDt;
    }
    this.last = value;
    const scale = `scaleX(${value.toFixed(3)})`;
    this.left.set(scale);
    this.right.set(scale);
    toggleClass(this.root, 'is-low', value < LOW);
    const shown = this.steadyFor < HIDE_AFTER_S;
    if (shown !== this.shown) {
      this.shown = shown;
      toggleClass(this.root, 'is-idle', !shown);
    }
    const label = `Güç %${Math.round(value * 100)}`;
    if (label !== this.label) {
      this.label = label;
      this.root.setAttribute('aria-label', label);
      this.root.setAttribute('aria-valuenow', String(Math.round(value * 100)));
    }
  }
}
