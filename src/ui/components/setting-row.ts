import '../styles/components.css';
import { el } from '../dom';
import { interactive } from './interaction';
import { keyCombo } from './keycap';

let uid = 0;
const nextId = (prefix: string): string => `ui-${prefix}-${++uid}`;

export interface SettingRowOptions {
  /** Keyboard shortcut shown as small caps next to the title ("N", "[ / ]"). */
  keys?: string;
  /** Indents the row under the one above (a dependent option). */
  sub?: boolean;
}

/**
 * One setting: title, optional description, the control on the right. The control is labelled by the title for
 * assistive tech.
 */
export function settingRow(title: string, description: string | undefined, control: HTMLElement, opts: SettingRowOptions = {}): HTMLElement {
  const id = nextId('set');
  const keys = opts.keys ? keyCombo(opts.keys, 'quiet', { size: 's' }) : null;
  keys?.setAttribute('aria-label', `Kısayol: ${opts.keys}`);
  const text = el('div', 'ui-setting-text', [
    el('span', 'ui-setting-title-line', [el('span', 'ui-setting-title', title, { id }), keys]),
    description ? el('span', 'ui-setting-desc', description) : null,
  ]);
  control.setAttribute('aria-labelledby', id);
  return el('div', opts.sub ? 'ui-setting-row ui-setting-row-sub' : 'ui-setting-row', [text, el('div', 'ui-setting-control', [control])]);
}

/** A titled group of setting rows in one panel, with an optional one-paragraph lede under the title. */
export function settingSection(title: string, rows: HTMLElement[], lede?: string): HTMLElement {
  return el('section', 'ui-setting-section', [
    el('h3', 'ui-setting-heading', title),
    lede ? el('p', 'ui-setting-lede', lede) : null,
    el('div', 'ui-setting-rows', rows),
  ]);
}

/**
 * A collapsed group of rows under a "show more" button (advanced options). The rows stay in the DOM, hidden, so their
 * controls keep their live values.
 */
export function settingDisclosure(label: string, rows: HTMLElement[]): HTMLElement {
  const id = nextId('more');
  const body = el('div', 'ui-setting-more-body', rows, { id });
  body.hidden = true;
  const button = interactive(
    el('button', 'ui-setting-more', [el('span', undefined, label), el('i', 'ui-setting-more-chev')], {
      type: 'button',
      'aria-expanded': 'false',
      'aria-controls': id,
    }),
    'surface',
  );
  button.addEventListener('click', () => {
    body.hidden = !body.hidden;
    button.setAttribute('aria-expanded', String(!body.hidden));
  });
  return el('div', 'ui-setting-more-wrap', [button, body]);
}

/**
 * Enables or greys out rows whose option depends on another switch; `reason` (optional) is shown as the greyed rows'
 * tooltip ("Önce Anlar'ı aç").
 */
export function setRowsEnabled(rows: readonly HTMLElement[], enabled: boolean, reason?: string): void {
  for (const row of rows) {
    row.classList.toggle('is-disabled', !enabled);
    if (!enabled && reason) {
      row.title = reason;
    } else {
      row.removeAttribute('title');
    }
    row.querySelectorAll('button, input').forEach((c) => ((c as HTMLButtonElement | HTMLInputElement).disabled = !enabled));
  }
}
