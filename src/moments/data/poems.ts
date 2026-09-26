/**
 * Poems (phase 19 backlog item 14).
 *
 * Orhan Veli Kanık, "İstanbul'u Dinliyorum". The poet died on 14 November 1950, so under Turkish law (FSEK art. 27,
 * life + 70 years) his works entered the public domain in Turkey on 1 January 2021. The poem's text is NOT in this
 * repository yet: the wording could not be checked against a reliable edition, and its status in the United States
 * (where the repository is hosted) needs the user's decision — see `pending` below and .docs/moments/README.md.
 * The subtitle lines are placeholders (`[[...]]`), which the headless check accepts only in draft records.
 */
import type { Moment } from '../types';
import { BOSPHORUS_CORRIDOR } from './city-life';
import { original } from './provenance';

/** Placeholder subtitle text; replaced by the poem's lines after approval. */
function verse(n: number): string {
  return `[[dize ${n} — metin onay bekliyor]]`;
}

export const istanbuluDinliyorum: Moment = {
  id: 'orhan-veli-istanbulu-dinliyorum',
  title: "İstanbul'u Dinliyorum",
  status: 'draft',
  backlog: 14,
  trigger: {
    place: { label: 'Bosphorus shores (low glide along the coast)', area: BOSPHORUS_CORRIDOR },
    surface: 'air',
    altitude: [{ ref: 'agl', max: 40 }],
    flightModes: ['gliding'],
    shoreDistance: { min: -150, max: 30 },
    weather: ['clear', 'haze', 'fog'],
    repeat: { kind: 'once-per-session' },
  },
  content: {
    soundId: 'moments/shore-ambience-soft',
    subtitles: [
      { at: 0, duration: 4, text: verse(1) },
      { at: 4.5, duration: 4, text: verse(2) },
      { at: 9, duration: 4, text: verse(3) },
      { at: 13.5, duration: 4, text: verse(4) },
      { at: 18, duration: 4, text: verse(5) },
      { at: 22.5, duration: 4, text: verse(6) },
    ],
    card: {
      title: "İstanbul'u Dinliyorum",
      text: "Orhan Veli Kanık'ın (1914–1950) en sevilen şiirlerinden biri. Gözler kapalı, şehir sesleriyle dinlenir.",
    },
  },
  provenance: [
    {
      covers: 'subtitles',
      kind: 'public-domain',
      licence: 'public domain (Turkey, since 1 January 2021)',
      author: 'Orhan Veli Kanık (1914–1950)',
      basis: "Orhan Veli Kanık, \"İstanbul'u Dinliyorum\"",
      pending:
        'Text not yet added: verify the wording against a reliable edition, and decide on the US status (a 1940s Turkish ' +
        'work still protected in Turkey on 1 Jan 1996 may have a restored US term until 95 years after publication).',
    },
    original('card'),
  ],
  needs: ['sound', 'text-approval'],
  notes: 'No character: just subtitles over a soft shore ambience while gliding low. Lines should fade with the glide, not force pacing.',
};

export const POEMS: readonly Moment[] = [istanbuluDinliyorum];
