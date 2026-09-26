/**
 * Literary moments (phase 19 backlog item 16): ten texts chosen from .docs/moments/candidates.md for variety of place,
 * mood, genre and time, and for a low rights risk. Every one is subtitle-only (no model, animation or sound of its
 * own): the moment music picks a piece by category and `musicMood`, and no coastal ambience lift is asked for.
 *
 * Text rules (playability gate, src/moments/runtime.ts):
 * - Traditional texts (a türkü, Karagöz formulas), our own retelling and our own translations of public-domain
 *   originals play now. Our writing is MIT with the original named in `provenance`.
 * - A quoted public-domain Turkish text plays only when at least two independent sources gave the same wording.
 *   Otherwise the record stays a draft with `pending` provenance and 'text-approval' in `needs`, and does not play.
 * - Quotations are verbatim, as in the source named in `basis`; `…` marks a cut. They are never "fixed".
 *
 * Places were checked on the real geography (moments-check: waypoints on water or land, near their landmarks, inside
 * the map; moments-runtime-check section 8: each one fires in its situation and not outside it).
 */
import type { Moment, SubtitleLine } from '../types';
import { original } from './provenance';
import {
  ATI_ALAN_SOURCES,
  DE_AMICIS_SOURCES,
  HASIM_SOURCES,
  KARAGOZ_SOURCES,
  KATIBIM_SOURCES,
  KUYRUKLU_SOURCES,
  NEDIM_SOURCES,
  PROKOPIOS_SOURCES,
  SINAN_KITABE_SOURCES,
  YAGMUR_SOURCES,
} from './sources';

/** Backlog item of the literary moments in .docs/planning/19-moments.md. */
const BACKLOG = 16;

/** Date of the text checks recorded in the provenance entries. */
const CHECKED = 'checked 2026-09-26';

type Line = string | { text: string; speaker?: string; hold?: number };

/**
 * Unhurried timeline: each line stays 4 s (longer lines up to 16 characters per second, older Turkish reads slower
 * with `hold`), then half a second of silence.
 */
function timeline(lines: readonly Line[], base = 4): SubtitleLine[] {
  let at = 0;
  return lines.map((l) => {
    const { text, speaker, hold } = typeof l === 'string' ? { text: l, speaker: undefined, hold: undefined } : l;
    const duration = Math.max(hold ?? base, Math.ceil((text.length / 16) * 2) / 2);
    const line: SubtitleLine = speaker ? { at, duration, text, speaker } : { at, duration, text };
    at += duration + 0.5;
    return line;
  });
}

/* ------------------------------------------------------------------ */
/* 1. Nedim, "Bu şehr-i Sıtanbûl" (awe, morning panorama)              */
/* ------------------------------------------------------------------ */

export const nedim: Moment = {
  id: 'nedim-bu-sehr-i-sitanbul',
  title: 'Bu Şehr-i Sıtanbûl',
  category: 'poem',
  status: 'ready',
  backlog: BACKLOG,
  trigger: {
    place: { label: 'High over Sarayburnu (the Seraglio point)', center: { lat: 41.0165, lon: 28.986 }, radius: 900 },
    surface: 'air',
    altitude: [{ ref: 'asl', min: 250, max: 600 }],
    timeOfDay: { from: 7, to: 11 },
    weather: ['clear', 'haze'],
    repeat: { kind: 'once-per-session' },
  },
  content: {
    musicMood: ['solemn', 'history'],
    // Two couplets; divan Turkish reads slowly, so each line holds 5 s.
    subtitles: timeline(
      [
        'Bu şehr-i Sıtanbûl ki bî-misl ü bahâdır',
        'Bir sengine yek-pâre Acem mülkü fedadır',
        'Bir gevher-i yek-pâre iki bahr arasında',
        'Hurşîd-i cihan-tâb ile tartılsa sezadır',
      ].map((text) => ({ text, hold: 5 })),
    ),
    card: {
      title: 'Bu Şehr-i Sıtanbûl',
      text:
        "Nedim (1681?–1730), Lâle Devri'nin şairi: \"Eşsiz, paha biçilmez bu İstanbul'un tek taşına bütün Acem " +
        'ülkesi feda olsun; iki deniz arasında tek parça bir mücevher, dünyayı aydınlatan güneşle tartılsa yeridir."',
    },
    waypoints: [
      // ?moment= starts here at 320 m, heading for the point.
      { id: 'start', lat: 41.0105, lon: 28.995, note: 'Over the Bosphorus mouth south-east of the point', expect: 'water' },
      { id: 'point', lat: 41.0165, lon: 28.986, note: 'Sarayburnu, below the Topkapı palace', expect: 'land' },
    ],
  },
  provenance: [
    {
      covers: 'subtitles',
      kind: 'public-domain',
      licence: 'public domain',
      author: 'Nedim (1681?–1730)',
      basis:
        'Nedim, "Kaside der vasf-ı İstanbul", the first two couplets, verbatim as on liseedebiyat.com ("Nedim\'den ' +
        `seçmeler"). ${CHECKED}: Vikikaynak ("Kaside Der Vasf-ı İstanbul", raw page) and yedinota.com give the same ` +
        'words in a plainer transliteration ("sitanbul", "behâdır", "yekpare"); no word differs.',
    },
    original('card', 'Our Turkish gloss of the two couplets'),
  ],
  needs: [],
  sources: NEDIM_SOURCES,
  notes:
    'The rest of the kaside praises the Grand Vizier İbrahim Paşa and is not used. Long vowels (â, î, û) vary between ' +
    'editions; the lines keep one source as it is.',
};

/* ------------------------------------------------------------------ */
/* 5. Sâî, Sinan's tomb inscription (elegiac, dusk) — pending          */
/* ------------------------------------------------------------------ */

export const sinanKitabe: Moment = {
  id: 'sinan-turbe-kitabesi',
  title: "Pîr-i Mi'mârân Sinan",
  category: 'poem',
  status: 'draft',
  backlog: BACKLOG,
  trigger: {
    place: { label: "Mimar Sinan's tomb at the north corner of the Süleymaniye", center: { lat: 41.01723, lon: 28.96394 }, radius: 200 },
    surface: 'any',
    // ASL band first: the ?moment= start pose uses it (119 m, clear of the hill and the minarets).
    altitude: [
      { ref: 'asl', max: 170 },
      { ref: 'agl', max: 90 },
    ],
    timeOfDay: { from: 16.5, to: 20.5 },
    weather: ['clear', 'haze'],
    repeat: { kind: 'once-per-session' },
  },
  content: {
    musicMood: ['solemn', 'tender', 'history'],
    subtitles: timeline(
      [
        'Ey iden bir iki gün dünyâ sarayında mekân',
        'Cây-i asâyiş değildir âdeme milk-i cihân',
        'Hân Süleymân’a olub mi’mâr bu merd-i güzîn',
        'Yapdı bir câmi’ verir Firdevs-i âlâdan nişân',
        '… Geçdi bu demde cihândan pîr-i mi’mârân-ı Sinân',
      ].map((text) => ({ text, hold: 5 })),
    ),
    card: {
      title: "Pîr-i Mi'mârân Sinan",
      text:
        "Kitabeyi Sinan'ın yakın dostu şair Sâî Mustafa Çelebi yazdı. Son mısra ebced hesabıyla 996'yı (1588) verir: " +
        '"Mimarların piri Sinan bu dünyadan göçtü." Türbeyi Sinan kendisi tasarladı, Süleymaniye\'nin hemen yanında.',
    },
    waypoints: [
      { id: 'start', lat: 41.0215, lon: 28.966, note: 'Golden Horn off Unkapanı, facing the Süleymaniye hill', expect: 'water' },
      { id: 'turbe', lat: 41.01723, lon: 28.96394, note: "Mimar Sinan's tomb (OSM way 308598205), Mimar Sinan Caddesi / Fetva Yokuşu", expect: 'land', nearLandmark: 'suleymaniye' },
    ],
  },
  provenance: [
    {
      covers: 'subtitles',
      kind: 'public-domain',
      licence: 'public domain',
      author: 'Sâî Mustafa Çelebi (ö. 1595)',
      basis:
        "Mimar Sinan's tomb inscription (996/1588), lines 1–4 and 14 of 15, as transcribed by Emre Gül (Dünya Bülteni), " +
        `copied on hayatgezincedahaguzel.blogspot.com and other sites. ${CHECKED}: every online full text found ` +
        'goes back to that one transcription, so lines 1–4 have a single source. The TDV İslâm Ansiklopedisi ("Sinan", ' +
        'Selçuk Mülâyim) quotes only the last line, and differently: "Geçti bu demde cihandan pîr-i mi‘mârân Sinân".',
      pending:
        'Read lines 1–4 and the date line against the stone or a critical reading (e.g. the Karadeniz Sosyal Bilimler ' +
        'Dergisi article "Mimar Sinan Türbesi Üzerine Bir Değerlendirme", or Sâî, Tezkiretü\'l-Bünyân, Koç 2004). Open: ' +
        '"Geçdi" or "Göçdü"; "mi’mârân-ı Sinân" (Dünya Bülteni) or "mi‘mârân Sinân" (TDV, fits the metre); "olub", ' +
        '"Yapdı" spellings.',
    },
    original('card', 'TDV İslâm Ansiklopedisi, "Sinan"; Wikipedia, "Mimar Sinan" (tomb of his own design)'),
  ],
  needs: ['text-approval'],
  sources: SINAN_KITABE_SOURCES,
  notes:
    'Only the opening four lines and the date line are used; the inscription ends with a request for a Fâtiha, left out ' +
    'on purpose. Surface any: perched on the tomb wall, the medrese roofs or hovering over the corner at dusk.',
};

/* ------------------------------------------------------------------ */
/* 7. Kâtibim (playful, Üsküdar in the rain)                           */
/* ------------------------------------------------------------------ */

export const katibim: Moment = {
  id: 'katibim-uskudar-yagmur',
  title: 'Kâtibim',
  category: 'poem',
  status: 'ready',
  backlog: BACKLOG,
  trigger: {
    place: { label: 'Üsküdar shore and square', center: { lat: 41.0265, lon: 29.0155 }, radius: 450 },
    surface: 'air',
    altitude: [{ ref: 'agl', max: 80 }],
    weather: ['rain'],
    repeat: { kind: 'once-per-session' },
  },
  content: {
    musicMood: ['joyful', 'tender'],
    subtitles: timeline([
      'Üsküdar’a gider iken aldı da bir yağmur,',
      'Kâtibimin setresi uzun eteği çamur.',
      'Kâtip uykudan uyanmış gözleri mahmur.',
      'Kâtip benim ben kâtibin el ne karışır,',
      'Kâtibime kolalı da gömlek ne güzel yaraşır.',
    ]),
    card: {
      title: 'Kâtibim',
      text:
        "İstanbul'un en bilinen türküsü: sözü de ezgisi de anonim, makamı Nihâvend. Yağmur yine Üsküdar yolunda " +
        'yakaladı; bu kez ıslanan bir ejderha.',
    },
    waypoints: [
      { id: 'start', lat: 41.0275, lon: 29.01, note: 'Off the Üsküdar ferry piers, facing the square', expect: 'water' },
      { id: 'square', lat: 41.0262, lon: 29.0152, note: 'Üsküdar square by the Mihrimah Sultan (İskele) mosque', expect: 'land', nearLandmark: 'mihrimah-uskudar' },
    ],
  },
  provenance: [
    {
      covers: 'subtitles',
      kind: 'public-domain',
      licence: 'anonymous traditional song (no author)',
      author: 'Anonim (İstanbul türküsü)',
      basis:
        `"Kâtibim" (Üsküdar'a gider iken), first stanza and refrain, verbatim from Vikikaynak ("Üsküdar’a Gider İken"). ` +
        `${CHECKED}: the TSM repertoire listing (tsm.fisek.com.tr, Nihâvend, anonim) and search excerpts of other song ` +
        'pages give the same words; some add a comma after "uzun".',
    },
    original('card', 'Kâtibim: anonymous, Nihâvend (TSM repertoire)'),
  ],
  needs: [],
  sources: KATIBIM_SOURCES,
  notes: 'Words only; no recording or melody is used (the moment music is our own). Rain only, not storm.',
};

/* ------------------------------------------------------------------ */
/* 8. Atı alan Üsküdar'ı geçti (humour, diving across the strait)      */
/* ------------------------------------------------------------------ */

export const atiAlan: Moment = {
  id: 'ati-alan-uskudari-gecti',
  title: "Atı Alan Üsküdar'ı Geçti",
  category: 'legend',
  status: 'ready',
  backlog: BACKLOG,
  trigger: {
    // The harbour mouth between Sarayburnu, Karaköy and Üsküdar / Salacak (all water on the real geography).
    place: {
      label: 'Bosphorus mouth between Sarayburnu and Üsküdar',
      area: [
        { lat: 41.012, lon: 28.99 },
        { lat: 41.022, lon: 28.984 },
        { lat: 41.03, lon: 28.994 },
        { lat: 41.03, lon: 29.008 },
        { lat: 41.018, lon: 29.006 },
        { lat: 41.01, lon: 29.0 },
      ],
    },
    surface: 'air',
    altitude: [{ ref: 'agl', max: 250 }],
    // Fallback for "a fast crossing" (no speed condition in the format): a dive over the strait.
    flightModes: ['diving'],
    timeOfDay: { from: 6, to: 21 },
    weather: ['clear', 'haze', 'fog', 'rain'],
    repeat: { kind: 'once-per-session' },
  },
  content: {
    musicMood: ['joyful', 'sea'],
    subtitles: timeline([
      "Köroğlu'nun atı Kırat kaybolmuş, derler.",
      "Köroğlu dağ bayır aramış, sonunda İstanbul'da bir at pazarında bulmuş.",
      '"Şu ata bir bineyim hele" demiş satıcıya. Satıcı "buyur" demiş.',
      'Kırat sahibini tanımış, şaha kalkmış, dörtnala uzaklaşmış.',
      'Kalabalıktan biri seslenmiş: "Atı alan Üsküdar\'ı geçti!"',
    ]),
    card: {
      title: "Atı Alan Üsküdar'ı Geçti",
      text:
        'Deyim, iş işten geçti, artık çok geç demektir. Hikâye halk arasında Köroğlu ile Kırat\'a bağlanır; başka ' +
        'rivayetleri de anlatılır. Hangisi doğru olursa olsun, sen de geçtin.',
    },
    waypoints: [
      { id: 'start', lat: 41.016, lon: 28.992, note: 'Over the strait off Sarayburnu, 175 m up, heading for Üsküdar', expect: 'water' },
      { id: 'uskudar', lat: 41.0255, lon: 29.007, note: 'Off the Üsküdar shore, the far side of the crossing', expect: 'water' },
    ],
  },
  provenance: [
    original('subtitles', 'Traditional proverb "Atı alan Üsküdar\'ı geçti" and the folk tale tying it to Köroğlu and Kırat (anonymous, traditional)'),
    original('card', 'Meaning as in TDK, Atasözleri ve Deyimler Sözlüğü'),
  ],
  needs: [],
  sources: ATI_ALAN_SOURCES,
  notes:
    'Our retelling (MIT). The tale has many versions; the Battal Gazi variant involves Kız Kulesi and an abduction and ' +
    'is not told. A timed crossing would fit better once the runtime has a speed or two-waypoint condition.',
};

/* ------------------------------------------------------------------ */
/* 9. Karagöz ile Hacivat (humour, Şehzadebaşı at night)               */
/* ------------------------------------------------------------------ */

export const karagoz: Moment = {
  id: 'karagoz-sehzadebasi',
  title: 'Perde: Karagöz ile Hacivat',
  category: 'poem',
  status: 'ready',
  backlog: BACKLOG,
  trigger: {
    place: { label: 'Şehzadebaşı (the old Direklerarası)', center: { lat: 41.0132, lon: 28.9585 }, radius: 250 },
    surface: 'air',
    altitude: [
      { ref: 'asl', max: 150 },
      { ref: 'agl', max: 60 },
    ],
    timeOfDay: { from: 20, to: 0 },
    weather: ['clear', 'haze', 'fog'],
    repeat: { kind: 'once-per-session' },
  },
  content: {
    musicMood: ['joyful', 'history'],
    subtitles: timeline([
      { speaker: 'Hacivat', text: 'Off… Hay Hak! … Yâr bana bir eğlence!' },
      { speaker: 'Karagöz', text: 'Hacivat, bak! Perdeye kocaman bir gölge düştü!' },
      { speaker: 'Hacivat', text: 'Aman Karagözüm, ejderha dedikleri bu olmalı. Edebinle selam ver.' },
      { speaker: 'Karagöz', text: 'Verdim! Kanadıyla perdeyi yelpazeledi, mum söndü!' },
      { speaker: 'Hacivat', text: 'Yıktın perdeyi, eyledin vîrân; varayım sahibine haber vereyim hemân!' },
      { speaker: 'Karagöz', text: 'Her ne kadar sürç-i lisân ettikse affola!' },
    ]),
    card: {
      title: 'Karagöz ile Hacivat',
      text:
        "Karagöz gölge oyunu yüzyıllarca İstanbul kahvehanelerinde, en çok da Ramazan gecelerinde Şehzadebaşı'nda " +
        "oynandı. 2009'dan beri UNESCO'nun Somut Olmayan Kültürel Miras listesinde.",
    },
    waypoints: [
      { id: 'start', lat: 41.0165, lon: 28.9555, note: 'By the Bozdoğan aqueduct, 105 m ASL, heading for Şehzadebaşı', expect: 'land' },
      { id: 'perde', lat: 41.0128, lon: 28.9581, note: 'Şehzadebaşı Caddesi in front of the Şehzade mosque', expect: 'land', nearLandmark: 'sehzade' },
    ],
  },
  provenance: [
    original('subtitles', 'Karagöz shadow theatre: lines 1, 5 and 6 are the traditional opening and closing formulas; lines 2–4 are ours'),
    {
      covers: 'subtitles:1',
      kind: 'public-domain',
      licence: 'traditional (no author)',
      author: 'Karagöz geleneği',
      basis: `Hacivat's opening exclamation and the end of the perde gazeli; ${CHECKED} on liseedebiyat.com ("Karagöz oyununun bölümleri") and Türk Maarif Ansiklopedisi ("Karagöz"), cut with …`,
    },
    {
      covers: 'subtitles:5',
      kind: 'public-domain',
      licence: 'traditional (no author)',
      author: 'Karagöz geleneği',
      basis: `Hacivat's closing formula; ${CHECKED} on liseedebiyat.com and Türk Maarif Ansiklopedisi (same words; liseedebiyat's spelling).`,
    },
    {
      covers: 'subtitles:6',
      kind: 'public-domain',
      licence: 'traditional (no author)',
      author: 'Karagöz geleneği',
      basis: `Karagöz's closing apology; ${CHECKED} on liseedebiyat.com ("…ettik ise af ola") and Türk Maarif Ansiklopedisi ("…ettikse affola!", used here).`,
    },
    original('card', 'Türk Maarif Ansiklopedisi, "Karagöz"; UNESCO Representative List (2009)'),
  ],
  needs: [],
  sources: KARAGOZ_SOURCES,
  notes:
    'Not tied to Ramadan (a lunar calendar is not in the format); a night window stands in. Which of the two says the ' +
    'last formula varies between plays; Karagöz says it here, as in most summaries.',
};

/* ------------------------------------------------------------------ */
/* 10. Tevfik Fikret, "Yağmur" (melancholy, Aşiyan in the rain)       */
/* ------------------------------------------------------------------ */

export const yagmur: Moment = {
  id: 'fikret-yagmur-asiyan',
  title: 'Yağmur',
  category: 'poem',
  status: 'ready',
  backlog: BACKLOG,
  trigger: {
    place: { label: "Aşiyan, Tevfik Fikret's house above Rumelihisarı", center: { lat: 41.08266, lon: 29.05345 }, radius: 300 },
    surface: 'any',
    altitude: [
      { ref: 'asl', max: 140 },
      { ref: 'agl', max: 80 },
    ],
    weather: ['rain'],
    repeat: { kind: 'once-per-session' },
  },
  content: {
    musicMood: ['nostalgic', 'tender'],
    subtitles: timeline([
      'Küçük, muttarid, muhteriz darbeler',
      'Kafeslerde, camlarda pür ihtizaz',
      'Olur dembedem nevha-ger, nağme-saz',
      'Kafeslerde, camlarda pür ihtizaz',
      'Küçük, muttarid, muhteriz darbeler.',
      'Sokaklarda seylabeler ağlaşır',
      'Ufuk yaklaşır, yaklaşır, yaklaşır',
    ]),
    card: {
      title: 'Yağmur',
      text:
        "Tevfik Fikret (1867–1915) bu şiirde yağmurun sesini kelimelerle çalar: küçük, düzenli, çekingen damlalar. " +
        "Boğaz'a bakan Aşiyan onun eviydi; bugün müze.",
    },
    waypoints: [
      { id: 'start', lat: 41.0815, lon: 29.0575, note: 'Over the Bosphorus below Aşiyan, facing the hill', expect: 'water' },
      { id: 'asiyan', lat: 41.08266, lon: 29.05345, note: 'Aşiyan Müzesi (OSM way 746788646)', expect: 'land' },
    ],
  },
  provenance: [
    {
      covers: 'subtitles',
      kind: 'public-domain',
      licence: 'public domain',
      author: 'Tevfik Fikret (1867–1915)',
      basis:
        'Tevfik Fikret, "Yağmur" (Rübab-ı Şikeste, 1900), the first seven lines, verbatim from turk-siiri.com. ' +
        `${CHECKED}: milliyet.com.tr gives the same words and punctuation; edebiyatöğretmeni.net and antoloji.com the ` +
        'same words ("nagme-saz", a few semicolons).',
    },
    original('card'),
  ],
  needs: [],
  sources: YAGMUR_SOURCES,
  notes: 'Rain only: the poem is about small, steady drops, not a storm. Hovering or perching near the house works too.',
};

/* ------------------------------------------------------------------ */
/* 12. Ahmet Haşim, "Bir Günün Sonunda Arzu" (melancholy) — pending    */
/* ------------------------------------------------------------------ */

export const hasim: Moment = {
  id: 'hasim-bir-gunun-sonunda-arzu',
  title: 'Bir Günün Sonunda Arzu',
  category: 'poem',
  status: 'draft',
  backlog: BACKLOG,
  trigger: {
    // Göksu fallback: Küçükçekmece Lake lies at the west edge of the map (28.72–28.77° E; the flight turns the dragon
    // back beyond 28.752° E) and is not water in the game's geography. The Göksu stream is too narrow to be water too,
    // so the place is the Bosphorus in front of its mouth, under Anadolu Hisarı.
    place: { label: 'Bosphorus water off the Göksu mouth (Anadolu Hisarı)', center: { lat: 41.0815, lon: 29.0635 }, radius: 600 },
    surface: 'air',
    altitude: [{ ref: 'agl', max: 35 }],
    flightModes: ['gliding'],
    shoreDistance: { min: -300, max: 30 },
    timeOfDay: { from: 17, to: 20.5 },
    weather: ['clear', 'haze'],
    repeat: { kind: 'once-per-session' },
  },
  content: {
    musicMood: ['nostalgic', 'tender', 'mystic'],
    subtitles: timeline([
      'Altın kulelerden yine kuşlar',
      'Tekrarını ömrün eder ilân.',
      'Kuşlar mıdır onlar ki bu akşam',
      'Alemlerimizden sefer eyler?',
      'Akşam yine akşam, yine akşam,',
      'Bir sırma kemerdir suya baksam',
      'Üstümde semâ bir kavs-ı mutalsam!',
      'Akşam, yine akşam, yine akşam,',
      'Göllerde bu dem bir kamış olsam!',
    ]),
    card: {
      title: 'Bir Günün Sonunda Arzu',
      text:
        "Ahmet Haşim (1884–1933) bu şiiri 1921'de Dergâh dergisinde yayımladı. Akşamın suya düşen sırma kemeri ve " +
        'bir kamış olmak isteyen bir şair.',
    },
    waypoints: [
      { id: 'start', lat: 41.076, lon: 29.061, note: 'Over the Bosphorus off Kandilli, heading for the Göksu mouth', expect: 'water' },
      { id: 'goksu', lat: 41.0815, lon: 29.064, note: 'In front of the Göksu mouth, below Anadolu Hisarı', expect: 'water' },
    ],
  },
  provenance: [
    {
      covers: 'subtitles',
      kind: 'public-domain',
      licence: 'public domain',
      author: 'Ahmet Haşim (1884–1933)',
      basis:
        'Ahmet Haşim, "Bir Günün Sonunda Arzu", stanzas 2–3 as first printed in Dergâh 1/1 (15 Nisan 1337/1921), p. 7, ' +
        `in the transcription on epigraf.fisek.com.tr (num=210). ${CHECKED}: the sources disagree. Epigraf's main text ` +
        '(later version) has "i\'lân", "her akşam", "sefer eyler?.." and no "Üstümde semâ…" line; antoloji.com has the ' +
        'line ("Üstümde sema kavs-i mutalsam!") and "her akşam".',
      pending:
        'Choose the version and read it against İnci Enginün, "Ahmet Haşim – Bütün Şiirleri" (Dergâh Yay.) or the ' +
        '1921 printing: whether line 7 "Üstümde semâ bir kavs-ı mutalsam!" belongs to the last stanza; line 2 ' +
        '"ilân." or "i\'lân,"; line 3 "bu akşam" or "her akşam"; line 4 "eyler?" or "eyler?.."; line 5 comma after ' +
        '"Akşam". The first stanza ("Yorgun gözümün halkalarında…") is skipped for length.',
    },
    original('card', 'Epigraf note on the first printing (Dergâh, 1921)'),
  ],
  needs: ['text-approval'],
  sources: HASIM_SOURCES,
  notes: 'The lake of the poem ("göllerde") is fitted to the Bosphorus at sunset; the card does not claim a place.',
};

/* ------------------------------------------------------------------ */
/* 16. Hüseyin Rahmi, "Kuyruklu Yıldız…" (humour, Heybeliada at night) */
/* ------------------------------------------------------------------ */

export const kuyruklu: Moment = {
  id: 'huseyin-rahmi-kuyrukluyildiz',
  title: 'Kuyrukluyıldız',
  category: 'poem',
  status: 'ready',
  backlog: BACKLOG,
  trigger: {
    place: { label: 'High over Heybeliada', center: { lat: 40.8785, lon: 29.095 }, radius: 1300 },
    surface: 'air',
    altitude: [{ ref: 'asl', min: 150, max: 900 }],
    timeOfDay: { from: 22, to: 4 },
    weather: ['clear'],
    repeat: { kind: 'once-per-session' },
  },
  content: {
    musicMood: ['joyful', 'mystic'],
    subtitles: timeline([
      '1910 baharı. Halley kuyrukluyıldızı geliyor, mahalleyi kıyamet telaşı sardı.',
      { speaker: 'Mebrure', text: 'Bedriye Hanım Teyze… Kuyruklu bize ne vakit çarpacakmış?' },
      { speaker: 'Bedriye Hanım', text: 'Önümüzdeki Mayıs’ın bilmem kaçında… Sabaha karşı çarpacakmış diyorlar.' },
      { speaker: 'Emine Hanım', text: 'Çarpacağını böyle günüyle saatiyle nasıl biliyorlar?' },
      { speaker: 'Emine Hanım', text: 'Kuyruklu filan günde, filan saatte çarpacağım diye bu dünyaya telgraf mı göndermiş?' },
      'Telgraf gelmedi. Kuyruklu geçip gitti, dünya da yerinde duruyor.',
    ]),
    card: {
      title: 'Kuyruklu Yıldız Altında Bir İzdivaç',
      text:
        "Hüseyin Rahmi Gürpınar (1864–1944) bu romanı 1910'da, Halley'in yarattığı kıyamet telaşı sırasında yazdı. " +
        "Heybeliada'daki evi bugün müze. Kuyruklu 2061'de yine gelecek.",
    },
    waypoints: [
      { id: 'start', lat: 40.8905, lon: 29.096, note: 'Over the Marmara north of Heybeliada, 300 m up', expect: 'water' },
      { id: 'heybeli', lat: 40.8765, lon: 29.1009, note: 'Hüseyin Rahmi Gürpınar monument (OSM node 12229653001), Heybeliada', expect: 'land' },
    ],
  },
  provenance: [
    {
      covers: 'subtitles',
      kind: 'public-domain',
      licence: 'public domain',
      author: 'Hüseyin Rahmi Gürpınar (1864–1944)',
      basis:
        'Kuyruklu Yıldız Altında Bir İzdivaç (Sabah, 1910; book 1912), ch. 1: lines 2–5 verbatim from the TDK edition ' +
        `(2019, pp. 41–42). ${CHECKED} against the Remzi Kitabevi edition (preview PDF, pp. 11–12): the same words; ` +
        'Remzi punctuates a little differently ("teyze", "mayısın", "filan günde filan saatte", "göndermiş?…").',
    },
    original('subtitles:1', 'Setting line (Halley, spring 1910)'),
    original('subtitles:6', 'Closing line'),
    original('card', 'TDK edition, introduction (serialised in Sabah, 12 Nisan – 26 Mayıs 1326/1910); Halley returns in 2061'),
  ],
  needs: [],
  sources: KUYRUKLU_SOURCES,
  notes: 'The novel is set in an İstanbul neighbourhood, not on the island; the island is where the author lived and is remembered.',
};

/* ------------------------------------------------------------------ */
/* 20. Procopius, the dome (awe, our translation)                      */
/* ------------------------------------------------------------------ */

export const prokopios: Moment = {
  id: 'prokopios-gokten-asili-kubbe',
  title: 'Gökten Asılı Kubbe',
  category: 'poem',
  status: 'ready',
  backlog: BACKLOG,
  trigger: {
    place: { label: 'Around the Hagia Sophia dome', center: { lat: 41.0085, lon: 28.98 }, radius: 300 },
    surface: 'air',
    altitude: [{ ref: 'asl', min: 150, max: 450 }],
    flightModes: ['gliding', 'flying'],
    timeOfDay: { from: 10, to: 16 },
    weather: ['clear', 'haze'],
    repeat: { kind: 'once-per-session' },
  },
  content: {
    musicMood: ['solemn', 'mystic', 'history'],
    subtitles: timeline([
      'Görenleri hayran bırakan, kulaktan duyanlara ise büsbütün inanılmaz gelen bir güzellik.',
      'Göğe erişecek kadar yükselir, kentin geri kalanına yukarıdan bakar.',
      'Güneş ışığıyla, mermerden yansıyan ışınlarla dolup taşar.',
      'Denebilir ki içini dışarıdan güneş aydınlatmaz; ışık onun içinde doğar.',
      'Sağlam bir duvara oturmuyor da, altın kubbesiyle gökten asılı duruyor sanki.',
    ]),
    card: {
      title: 'Gökten Asılı Kubbe',
      text:
        "Bizanslı tarihçi Prokopios bu satırları 550'lerde, yapı yeni bittiğinde yazdı. İlk kubbe 558'de çöktü ve " +
        'daha yüksek kuruldu; bugün gördüğün, o ikinci kubbenin onarılarak gelen hâlidir.',
    },
    waypoints: [
      { id: 'start', lat: 41.015, lon: 28.99, note: 'Over the strait off Sarayburnu, 210 m up, heading for the dome', expect: 'water' },
      { id: 'dome', lat: 41.0085, lon: 28.98, note: 'Hagia Sophia', expect: 'land', nearLandmark: 'ayasofya' },
    ],
  },
  provenance: [
    original(
      'subtitles',
      'Procopius, De aedificiis (Buildings) I.1.27, 29, 30 and 46 (Greek, c. 550s, public domain); our Turkish translation ' +
        `made with H. B. Dewing's English (Loeb 1940; public domain per LacusCurtius), ${CHECKED} on LacusCurtius. Not yet ` +
        'compared with the Greek (Haury–Wirth); a Turkish proofread is welcome.',
    ),
    original('card', 'The first dome collapsed in 558 and was rebuilt higher (Hagia Sophia building history)'),
  ],
  needs: [],
  sources: PROKOPIOS_SOURCES,
  notes: 'The building is called "yapı" on purpose, neither church nor mosque (its status is a public debate); the card stays architectural.',
};

/* ------------------------------------------------------------------ */
/* 21. De Amicis, arrival in the fog (awe, our translation)            */
/* ------------------------------------------------------------------ */

export const deAmicis: Moment = {
  id: 'de-amicis-sis-kalkinca',
  title: 'Sis Kalkınca',
  category: 'poem',
  status: 'ready',
  backlog: BACKLOG,
  trigger: {
    place: { label: 'Sea of Marmara approach south of Sarayburnu', center: { lat: 41.0005, lon: 28.985 }, radius: 1600 },
    surface: 'air',
    altitude: [{ ref: 'agl', max: 90 }],
    shoreDistance: { max: -40 },
    timeOfDay: { from: 5, to: 11 },
    weather: ['clear', 'haze', 'fog'],
    // A foggy morning (src/render/weather/sea-fog.ts: about 30 % of game days) or fog weather.
    seaFog: { min: 0.2 },
    repeat: { kind: 'once-per-session' },
  },
  content: {
    musicMood: ['solemn', 'sea', 'history'],
    subtitles: timeline([
      'Sis vardı. Koyu bir sis ufku her yandan örtüyordu.',
      '… Perde hızla yırtılıyordu.',
      'Altın Şehir Üsküdar, büyük tepelerine göz alabildiğine yayılmıştı;',
      'sabahın ışıklı buğusuna bürünmüş, gülümseyen,',
      'sihirli bir değneğin dokunuşuyla az önce doğmuş bir şehir kadar taze.',
      '… Bir dakika, bir dakika daha; Sarayburnu geçiliyor…',
      'İşte Konstantinopolis! Uçsuz bucaksız, görkemli, yüce Konstantinopolis!',
    ]),
    card: {
      title: 'Sis Kalkınca',
      text:
        "İtalyan yazar Edmondo De Amicis İstanbul'a 1874'te, sisli bir sabah vapurla geldi. Sis kalkınca gördükleri, " +
        "'Costantinopoli'nin (1877) ünlü açılışı oldu.",
    },
    waypoints: [
      { id: 'start', lat: 40.99, lon: 28.985, note: 'Over the Marmara 1.3 km off the peninsula, 63 m up, heading north', expect: 'water' },
      { id: 'point', lat: 41.0165, lon: 28.992, note: 'Off the tip of Sarayburnu, where the city opens up', expect: 'water' },
    ],
  },
  provenance: [
    original(
      'subtitles',
      'Edmondo De Amicis, Costantinopoli (1877), chapter "L\'arrivo" (Italian, public domain); our Turkish translation of ' +
        `the sentences "C'era la nebbia. Una nebbia fitta copriva l'orizzonte da tutte le parti", "Il velo si squarciava ` +
        `rapidamente", "Scutari, la Città d'oro, … velata dai vapori luminosi del mattino, ridente, fresca come una città ` +
        `sorta allora al tocco d'una verga fatata", "Un minuto – un altro minuto – si passa la punta del Serraglio" and "Ecco ` +
        `Costantinopoli! Costantinopoli sterminata, superba, sublime!", ${CHECKED} on experiences.it and on the ` +
        'diarioistanbul blog; cuts marked with …. A Turkish proofread is welcome.',
    ),
    original('card', 'De Amicis travelled to İstanbul in 1874; Costantinopoli appeared in 1877'),
  ],
  needs: [],
  sources: DE_AMICIS_SOURCES,
  notes:
    'Pairs with the foggy mornings: the sea fog forms before dawn and lifts from 08:30 to 11:30, so the lines can play ' +
    'as the layer thins. A runtime touch for later: thin the fog while the lines play.',
};

/** Every literary moment, in candidate order. */
export const LITERATURE: readonly Moment[] = [nedim, sinanKitabe, katibim, atiAlan, karagoz, yagmur, hasim, kuyruklu, prokopios, deAmicis];
