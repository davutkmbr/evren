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
    waypoints: [
      // The ?moment= shortcut starts here, heading for 'glide'; the headless checks fly this stretch.
      { id: 'start', lat: 41.042, lon: 29.013, note: 'Off the European shore between Beşiktaş and Ortaköy, ~60 m out', expect: 'water' },
      { id: 'glide', lat: 41.056, lon: 29.0375, note: 'Off Kuruçeşme, the line of a low glide north along the shore', expect: 'water' },
      { id: 'bebek', lat: 41.076, lon: 29.0455, note: 'Bebek bay, the end of the stretch', expect: 'water' },
    ],
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
  notes:
    'No character: just subtitles over a soft shore ambience while gliding low. Lines should fade with the glide, not force pacing. ' +
    "Plays while still 'draft': its only need is the sound, which is optional for a subtitle-only moment (the runtime lifts " +
    'the existing coastal ambience instead; see src/moments/runtime.ts, momentPlayability).',
};

export const POEMS: readonly Moment[] = [istanbuluDinliyorum];
