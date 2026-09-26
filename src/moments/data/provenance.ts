import type { TextProvenance } from '../types';

/** Author label for text written for this game (MIT, like the rest of the repository). */
export const OUR_AUTHOR = 'Evren contributors';

/** Provenance entry for our own writing, optionally based on a (public-domain) source. */
export function original(covers: string, basis?: string, pending?: string): TextProvenance {
  return { covers, kind: 'original', licence: 'MIT', author: OUR_AUTHOR, basis, pending };
}

export const EVLIYA = 'Evliya Çelebi, Seyahatname, vol. 1 (17th century), public domain';
