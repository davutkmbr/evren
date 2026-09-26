import { el } from '../dom';
import { keyCap } from './keycap';

export interface TextFieldOptions {
  /** Key that focuses the field, shown as a quiet key cap before the label. */
  key?: string;
  placeholder?: string;
  maxLength?: number;
  /** Size 'm' (38 px, side panels) or 'l' (44 px, dialogs). */
  size?: 'm' | 'l';
}

export interface TextField {
  readonly root: HTMLLabelElement;
  readonly input: HTMLInputElement;
  /** A line under the field (hint or error); an empty text hides it. */
  setMessage(text: string, tone?: 'quiet' | 'warn'): void;
}

/** A labelled single-line text input (a name, a share code), without spellcheck or autocomplete. */
export function textField(label: string, opts: TextFieldOptions = {}): TextField {
  const input = el('input', 'ui-field-input', undefined, {
    type: 'text',
    spellcheck: 'false',
    autocomplete: 'off',
    placeholder: opts.placeholder,
    'aria-label': label,
  });
  if (opts.maxLength) {
    input.maxLength = opts.maxLength;
  }
  const message = el('span', 'ui-field-msg');
  message.hidden = true;
  const head = el('span', 'ui-field-label', [opts.key ? keyCap(opts.key, 'quiet') : null, label]);
  const root = el('label', `ui-field ui-field-${opts.size ?? 'm'}`, [head, input, message]);
  return {
    root,
    input,
    setMessage: (text, tone = 'quiet') => {
      message.textContent = text;
      message.hidden = !text;
      message.classList.toggle('is-warn', tone === 'warn');
    },
  };
}
