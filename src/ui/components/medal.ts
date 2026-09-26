import { el, svg } from '../dom';
import type { Medal } from './medal-ladder';

/** Medal colour class (ui-medal-gold / -silver / -bronze, or ui-medal-none). */
function medalClass(medal: Medal | null | undefined): string {
  return `ui-medal-${medal ?? 'none'}`;
}

export interface MedalMark {
  readonly root: HTMLElement;
  set(medal: Medal | null | undefined): void;
}

/** A small dot in a medal's colour; an outlined ring when no medal is held. Size 's' (9 px) or 'm' (10 px). */
export function medalDot(medal: Medal | null | undefined, size: 's' | 'm' = 'm'): MedalMark {
  const cls = (m: Medal | null | undefined): string => `ui-medal-dot ui-medal-dot-${size} ${medalClass(m)}`;
  const root = el('i', cls(medal), undefined, { 'aria-hidden': 'true' });
  return {
    root,
    set: (m) => {
      root.className = cls(m);
    },
  };
}

const STAR =
  '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z"/></svg>';

/** The big medal disc of a result screen: a 64 px disc in the medal's colour with a star; muted when none. */
export function medalDisc(medal: Medal | null | undefined): MedalMark {
  const cls = (m: Medal | null | undefined): string => `ui-medal-disc ${medalClass(m)}`;
  const root = el('span', cls(medal), [svg(STAR)], { 'aria-hidden': 'true' });
  return {
    root,
    set: (m) => {
      root.className = cls(m);
    },
  };
}
