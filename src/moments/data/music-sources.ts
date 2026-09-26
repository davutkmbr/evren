/**
 * The historic 78 rpm recordings under the moments, as source-sheet items ("Kaynağa bak" → Kaynaklar): performer,
 * label, catalogue number, year and the archive page, in Turkish. The owner approved these recordings on 2026-09-26
 * (.docs/assets/candidates/moment-music.md#decision-2026-09-26); provenance of every file: .docs/assets/archive-78rpm.md.
 * The pieces themselves are in public/audio/music/manifest.json, or, for the US-risky ones ("Türkiye'de kamu malı"),
 * in the private manifest that only builds carry (.docs/assets/private-assets.md).
 *
 * Items are links (kind 'audio' has no embed): the sheet shows the credit line and opens the archive page.
 */
import type { MomentSource } from '../types';

function recording(title: string, credit: string, url: string, licence: string, note: string): MomentSource {
  return { kind: 'audio', title: `Müzik: ${title}`, url, attribution: credit, licence, approved: true, note };
}

const PD = 'kamu malı';
const PD_TR = 'Türkiye’de kamu malı';

export const MUSIC_KAGITHANE: MomentSource = recording(
  'Kâğıthane Semaisi (taş plak, 1916)',
  'Karekin Proodian, Kemani Minas ve topluluğu · Victor 69173 · New York, 1916 · Library of Congress, National Jukebox',
  'https://www.loc.gov/item/jukebox-20789/',
  PD,
  'Piece kagithane-semaisi-1916: the instrumental introduction (0:07.5-1:03.5 of the side).',
);

export const MUSIC_FELEK_BANA: MomentSource = recording(
  'Felek Bana (taş plak, 1916)',
  'Karekin Proodian, Kemani Minas ve topluluğu · Victor 69175 · New York, 1916 · Library of Congress, National Jukebox',
  'https://www.loc.gov/item/jukebox-20790/',
  PD,
  'Piece felek-bana-1916 (0:01-1:56.5), heard from a gramophone on Şehzadebaşı Caddesi.',
);

export const MUSIC_ISFAHAN_GAZEL: MomentSource = recording(
  'Dil verme gönül, Isfahan gazeli (taş plak, y. 1912)',
  'Hâfız Osman el-Mevsılî (ses), Tanburi Cemil Bey (tanbur) · İstanbul taş plağı, y. 1912 · Wikimedia Commons',
  'https://commons.wikimedia.org/wiki/File:%D9%85%D9%84%D8%A7_%D8%B9%D8%AB%D9%85%D8%A7%D9%86_%D8%A7%D9%84%D9%85%D9%88%D8%B5%D9%84%D9%8A_-_%D8%BA%D8%B2%D9%84_%D8%A7%D8%B5%D9%81%D9%87%D8%A7%D9%86_Isfahan_Gazel_-_Uthman_al-Mosuli.ogg',
  PD,
  'Piece isfahan-gazeli-cemil-bey.',
);

export const MUSIC_NAFPLIOTIS: MomentSource = recording(
  'Aya Yorgi apolitikiyonu (taş plak, 1913–1918)',
  'Iakovos Nafpliotis, Patrikhane baş psaltisi · Orfeon · İstanbul, 1913–1918 · analogion.com',
  'https://analogion.com/site/html/Nafpliotis.html',
  PD,
  'Piece aya-yorgi-apolitikiyonu-nafpliotis; no later ison drone found in this transfer (.docs/assets/archive-78rpm.md).',
);

export const MUSIC_RESADIYE: MomentSource = recording(
  'Reşadiye Marşı (taş plak, 1910)',
  'Odeon Orkestrası, beste Italo Selvelli · Odeon 54745 · 1910 · Wikimedia Commons',
  'https://commons.wikimedia.org/wiki/File:Marche_de_sa_Majest%C3%A9_Imp%C3%A9riale_Le_Sultan_Mohammed_V._par_Italo_Selvelli.ogg',
  PD,
  'Piece resadiye-marsi-1910: the new Sultan’s march of the comet year.',
);

export const MUSIC_KATIBIM_SAFIYE_AYLA: MomentSource = recording(
  'Kâtibim — Safiye Ayla (taş plak, 1949)',
  'Safiye Ayla; keman, kanun, ud ve klarnet · taş plak, 1949 · Internet Archive',
  'https://archive.org/details/KatibimuskudaraGiderIken-SafiyeAyla',
  PD_TR,
  'Private piece katibim-safiye-ayla-1949 (US-risky: only in builds made with private-assets/).',
);

export const MUSIC_HUSEYNI_TAKSIM: MomentSource = recording(
  'Hüseyni Taksim — Hafız Kemal Bey (taş plak, y. 1927–1928)',
  'Hafız Kemal Bey (kemençe) · Pathé, matris N 11016 · İstanbul, y. 1927–1928 · gallica.bnf.fr / BnF, Archives de la Parole',
  'https://gallica.bnf.fr/ark:/12148/bpt6k1310275k',
  PD_TR,
  'Private piece huseyni-taksim-hafiz-kemal (US-risky: only in builds made with private-assets/).',
);

export const MUSIC_HUZZAM_TAKSIM: MomentSource = recording(
  'Hüzzam Taksim — Reşad Bey (taş plak, y. 1927–1928)',
  'Reşad Bey (keman) · Pathé, matris N 11136 · İstanbul, y. 1927–1928 · gallica.bnf.fr / BnF, Archives de la Parole',
  'https://gallica.bnf.fr/ark:/12148/bpt6k13102426',
  PD_TR,
  'Private piece huzzam-taksim-resad-bey (US-risky: only in builds made with private-assets/).',
);
