import { el } from '../dom';

export type PillTone = 'gold' | 'quiet';

export interface Pill {
  readonly root: HTMLElement;
  set(text: string, tone?: PillTone): void;
}

/** A short status tag ("Yeni rekor"): gold fill for good news, a quiet outline otherwise. */
export function pill(text: string, tone: PillTone = 'gold'): Pill {
  const root = el('span', `ui-pill ui-pill-${tone}`, text);
  return {
    root,
    set: (t, tn = tone) => {
      root.textContent = t;
      root.className = `ui-pill ui-pill-${tn}`;
    },
  };
}
