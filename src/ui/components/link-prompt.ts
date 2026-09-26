import { el } from '../dom';
import { bindKeyPress, interactive } from './interaction';
import { keyCap } from './keycap';

export interface LinkPrompt {
  readonly root: HTMLAnchorElement;
  /** Opens the link as a click would (a new tab, no opener), e.g. when the screen handles the key itself. */
  open(): void;
}

/**
 * The prompt for leaving the game to an external page: key first, then the verb, then the destination's domain so the
 * player knows where it goes ("[1] Tarayıcıda aç  tr.wikisource.org"). A real link (`target="_blank"`,
 * `rel="noopener noreferrer"`), so it also works with the middle button and the context menu; it looks and behaves
 * like `prompt` (cap family). The screen maps its key to `open()`.
 */
export function linkPrompt(label: string, key: string, href: string, domain: string): LinkPrompt {
  const root = interactive(
    el(
      'a',
      key ? 'ui-prompt ui-prompt-secondary ui-prompt-link' : 'ui-prompt ui-prompt-secondary ui-prompt-link ui-prompt-keyless',
      [key ? keyCap(key, 'ink') : null, el('span', 'ui-prompt-label', label), domain ? el('span', 'ui-prompt-domain', domain) : null],
      { href, target: '_blank', rel: 'noopener noreferrer', referrerpolicy: 'no-referrer' },
    ),
    'cap',
  );
  bindKeyPress(root, key);
  root.addEventListener('click', (e) => e.stopPropagation());
  return {
    root,
    open: () => root.click(),
  };
}
