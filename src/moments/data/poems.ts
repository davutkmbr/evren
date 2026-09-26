/**
 * Poems (phase 19 backlog item 14).
 *
 * Orhan Veli Kanık, "İstanbul'u Dinliyorum". The poet died on 14 November 1950, so under Turkish law (FSEK art.
 * 27, life + 70 years) his works entered the public domain in Turkey on 1 January 2021. Only the first stanza is used
 * (user decision 2026-09-26): a short quotation keeps the moment light and limits exposure to a possible restored US
 * term, since the repository is hosted in the United States.
 */
import type { Moment } from '../types';
import { BOSPHORUS_CORRIDOR } from './city-life';
import { original } from './provenance';

/** The first stanza, one subtitle per line. */
const FIRST_STANZA = [
  "İstanbul'u dinliyorum, gözlerim kapalı;",
  'Önce hafiften bir rüzgâr esiyor;',
  'Yavaş yavaş sallanıyor',
  'Yapraklar, ağaçlarda;',
  'Uzaklarda, çok uzaklarda,',
  'Sucuların hiç durmayan çıngırakları;',
  "İstanbul'u dinliyorum, gözlerim kapalı.",
];

export const istanbuluDinliyorum: Moment = {
  id: 'orhan-veli-istanbulu-dinliyorum',
  title: "İstanbul'u Dinliyorum",
  category: 'poem',
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
    // unhurried: 4 s per line, half a second of silence between lines
    subtitles: FIRST_STANZA.map((text, i) => ({ at: i * 4.5, duration: 4, text })),
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
      basis: "Orhan Veli Kanık, \"İstanbul'u Dinliyorum\", first stanza only",
    },
    original('card'),
  ],
  needs: ['sound'],
  notes: 'No character: just subtitles over a soft shore ambience while gliding low. Lines should fade with the glide, not force pacing.',
};

export const POEMS: readonly Moment[] = [istanbuluDinliyorum];
