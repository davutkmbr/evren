/**
 * Sources behind the moments ("Kaynak"), one list per record. Format and approval rules: src/moments/sources.ts and
 * the MomentSource type (src/moments/types.ts). Only URLs that were verified to exist go here; an embed is used only
 * after the owner approves the item (`approved: true`), until then the item is an external link.
 */
import type { MomentSource } from '../types';

/** Orhan Veli Kanık, "İstanbul'u Dinliyorum" (public domain in Turkey since 2021). */
export const ISTANBULU_DINLIYORUM_SOURCES: readonly MomentSource[] = [
  {
    kind: 'text',
    title: 'Şiirin tam metni',
    url: "https://tr.wikisource.org/wiki/%C4%B0stanbul'u_Dinliyorum",
    attribution: 'Orhan Veli Kanık · Vikikaynak',
    licence: 'kamu malı',
    approved: false,
    note: 'Turkish Wikisource page of the poem; existence verified through a web search index on 2026-09-26 (the page itself was not reachable from the build container). Link only until the owner approves it.',
  },
  {
    kind: 'link',
    title: 'Orhan Veli’nin Vikikaynak’taki şiirleri',
    url: 'https://tr.wikisource.org/wiki/Orhan_Veli',
    attribution: 'Vikikaynak',
    approved: false,
    note: 'Author page on Turkish Wikisource; verified the same way as the poem page.',
  },
  // TODO(video): a reading or song of the poem from the rights holder's official YouTube channel, e.g.
  // { kind: 'video', title: '…', url: 'https://www.youtube.com/watch?v=<id>', embed: { kind: 'youtube', videoId: '<id>' },
  //   attribution: '<official channel>', licence: 'YouTube standart lisansı', approved: false }
  // Waiting for the owner to pick the upload; no URL is added before it is verified.
  // TODO(image): a portrait of Orhan Veli or a scan of the first print (Karşı, 1949) from a Wikimedia Commons file page
  // with a clear licence, e.g. { kind: 'image', url: 'https://commons.wikimedia.org/wiki/File:<name>', embed: { kind:
  // 'image', src: 'https://upload.wikimedia.org/…', width, height }, attribution, licence, approved: false }.
];

/*
 * Literary moments (backlog 16, .docs/moments/candidates.md, data/literature.ts). Every URL below was opened from the
 * build container on 2026-09-26 (curl or a fetch tool). All are links only until the owner approves them.
 */

const CHECKED = 'Opened from the build container on 2026-09-26.';

/** Nedim, "Kaside der vasf-ı İstanbul" (public domain). */
export const NEDIM_SOURCES: readonly MomentSource[] = [
  {
    kind: 'text',
    title: 'Kasidenin tam metni',
    url: 'https://tr.wikisource.org/wiki/Kaside_Der_Vasf-%C4%B1_%C4%B0stanbul',
    attribution: 'Nedim · Vikikaynak',
    licence: 'kamu malı',
    approved: false,
    note: `${CHECKED} Plain transliteration ("sitanbul", "behâdır"); the same words as the game's lines.`,
  },
  {
    kind: 'text',
    title: 'Kasideden seçmeler',
    url: 'https://www.liseedebiyat.com/metn-ncelemes/2229-kasde-nedmden-secmeler.html',
    attribution: 'Nedim · liseedebiyat.com',
    licence: 'kamu malı (metin)',
    approved: false,
    note: `${CHECKED} The game quotes this page's transliteration verbatim.`,
  },
  { kind: 'link', title: 'Nedim’in Vikikaynak’taki şiirleri', url: 'https://tr.wikisource.org/wiki/Nedim', attribution: 'Vikikaynak', approved: false, note: CHECKED },
];

/** Sâî Mustafa Çelebi, Mimar Sinan's tomb inscription (public domain; wording pending). */
export const SINAN_KITABE_SOURCES: readonly MomentSource[] = [
  {
    kind: 'text',
    title: 'Kitabenin okunuşu',
    url: 'https://hayatgezincedahaguzel.blogspot.com/2014/01/mimar-sinan-turbesi.html',
    attribution: 'Blog aktarımı (Emre Gül’ün Dünya Bülteni yazısından)',
    licence: 'kamu malı (kitabe)',
    approved: false,
    note: `${CHECKED} Full 15-line reading, copied from an article by Emre Gül (Dünya Bülteni); not a critical edition.`,
  },
  {
    kind: 'link',
    title: 'Sinan (TDV İslâm Ansiklopedisi)',
    url: 'https://islamansiklopedisi.org.tr/sinan',
    attribution: 'Selçuk Mülâyim · TDV İslâm Ansiklopedisi',
    approved: false,
    note: `${CHECKED} Quotes the last line as "Geçti bu demde cihandan pîr-i mi‘mârân Sinân".`,
  },
  {
    kind: 'link',
    title: 'Mimar Sinan (Wikipedia)',
    url: 'https://en.wikipedia.org/wiki/Mimar_Sinan',
    attribution: 'Wikipedia',
    approved: false,
    note: `${CHECKED} The tomb north of the Süleymaniye and the epitaph by Mustafa Sai.`,
  },
];

/** "Kâtibim" (anonymous İstanbul türkü). */
export const KATIBIM_SOURCES: readonly MomentSource[] = [
  {
    kind: 'text',
    title: 'Türkünün sözleri',
    url: 'https://tr.wikisource.org/wiki/%C3%9Csk%C3%BCdar%E2%80%99a_Gider_%C4%B0ken',
    attribution: 'Anonim · Vikikaynak',
    licence: 'anonim eser',
    approved: false,
    note: `${CHECKED} The game quotes the first stanza and the refrain verbatim.`,
  },
  {
    kind: 'link',
    title: 'Kâtibim (TSM repertuvarı: Nihâvend, anonim)',
    url: 'https://tsm.fisek.com.tr/tsm.php?makam=nihavend&n=24',
    attribution: 'tsm.fisek.com.tr',
    approved: false,
    note: `${CHECKED} Makam and usul listing.`,
  },
  { kind: 'link', title: 'Kâtibim (Wikipedia)', url: 'https://en.wikipedia.org/wiki/K%C3%A2tibim', attribution: 'Wikipedia', approved: false, note: CHECKED },
];

/** "Atı alan Üsküdar'ı geçti" (proverb; our retelling). */
export const ATI_ALAN_SOURCES: readonly MomentSource[] = [
  { kind: 'link', title: 'Köroğlu (Vikipedi)', url: 'https://tr.wikipedia.org/wiki/K%C3%B6ro%C4%9Flu', attribution: 'Vikipedi', approved: false, note: CHECKED },
];

/** Karagöz shadow theatre (traditional formulas, our dialogue). */
export const KARAGOZ_SOURCES: readonly MomentSource[] = [
  {
    kind: 'text',
    title: 'Karagöz (Türk Maarif Ansiklopedisi)',
    url: 'https://turkmaarifansiklopedisi.org.tr/karagoz',
    attribution: 'Türk Maarif Ansiklopedisi',
    approved: false,
    note: `${CHECKED} Parts of a play; the "Hay Hak", "Yıktın perdeyi eyledin viran…" and "sürç-i lisan" formulas.`,
  },
  {
    kind: 'link',
    title: 'Karagöz (UNESCO Somut Olmayan Kültürel Miras)',
    url: 'https://ich.unesco.org/en/RL/karagoz-00180',
    attribution: 'UNESCO',
    approved: false,
    note: `${CHECKED} Inscribed on the Representative List in 2009.`,
  },
  { kind: 'link', title: 'Karagöz ve Hacivat (Vikipedi)', url: 'https://tr.wikipedia.org/wiki/Karag%C3%B6z_ve_Hacivat', attribution: 'Vikipedi', approved: false, note: CHECKED },
];

/** Tevfik Fikret, "Yağmur" (public domain). */
export const YAGMUR_SOURCES: readonly MomentSource[] = [
  {
    kind: 'text',
    title: 'Şiirin tam metni',
    url: 'https://turk-siiri.com/tevfik-fikret/yagmur-3/',
    attribution: 'Tevfik Fikret · turk-siiri.com',
    licence: 'kamu malı',
    approved: false,
    note: `${CHECKED} The game quotes this page verbatim; milliyet.com.tr gives the same words and punctuation.`,
  },
  {
    kind: 'text',
    title: 'Şiirin tam metni (Milliyet)',
    url: 'https://www.milliyet.com.tr/siirler/yagmur-siiri-tevfik-fikret-6520804',
    attribution: 'Tevfik Fikret · Milliyet',
    licence: 'kamu malı',
    approved: false,
    note: CHECKED,
  },
  { kind: 'link', title: 'Aşiyan Müzesi (Vikipedi)', url: 'https://tr.wikipedia.org/wiki/A%C5%9Fiyan_M%C3%BCzesi', attribution: 'Vikipedi', approved: false, note: CHECKED },
  { kind: 'link', title: 'Tevfik Fikret’in Vikikaynak sayfası', url: 'https://tr.wikisource.org/wiki/Tevfik_Fikret', attribution: 'Vikikaynak', approved: false, note: CHECKED },
];

/** Ahmet Haşim, "Bir Günün Sonunda Arzu" (public domain; wording pending). */
export const HASIM_SOURCES: readonly MomentSource[] = [
  {
    kind: 'text',
    title: 'Şiirin metni ve ilk yayımlanmış hâli',
    url: 'https://epigraf.fisek.com.tr/?num=210',
    attribution: 'Ahmet Haşim · Epigraf',
    licence: 'kamu malı',
    approved: false,
    note: `${CHECKED} Gives a common text and the first print (Dergâh, 15 Nisan 1337/1921); the game uses the first print.`,
  },
  {
    kind: 'text',
    title: 'Şiirin metni (Antoloji.com)',
    url: 'https://www.antoloji.com/bir-gunun-sonunda-arzu-siiri/',
    attribution: 'Ahmet Haşim · antoloji.com',
    licence: 'kamu malı',
    approved: false,
    note: CHECKED,
  },
  { kind: 'link', title: 'Ahmet Haşim’in Vikikaynak sayfası', url: 'https://tr.wikisource.org/wiki/Ahmet_Ha%C5%9Fim', attribution: 'Vikikaynak', approved: false, note: CHECKED },
];

/** Hüseyin Rahmi Gürpınar, "Kuyruklu Yıldız Altında Bir İzdivaç" (public domain). */
export const KUYRUKLU_SOURCES: readonly MomentSource[] = [
  {
    kind: 'text',
    title: 'Romanın tam metni (TDK yayını)',
    url: 'https://tdk.gov.tr/huseyin-rahmi-gurpinar-kuyruklu-yildiz/',
    attribution: 'Hüseyin Rahmi Gürpınar · Türk Dil Kurumu',
    licence: 'kamu malı (metin)',
    approved: false,
    note: `${CHECKED} The page embeds the TDK edition as a PDF (wp-content/uploads/2019/12/Kuyruklu-Yıldız-WEB-1.pdf); the lines are from chapter 1, pp. 41–42.`,
  },
  {
    kind: 'link',
    title: 'Hüseyin Rahmi Gürpınar Müzesi (Vikipedi)',
    url: 'https://tr.wikipedia.org/wiki/H%C3%BCseyin_Rahmi_G%C3%BCrp%C4%B1nar_M%C3%BCzesi',
    attribution: 'Vikipedi',
    approved: false,
    note: CHECKED,
  },
];

/** Procopius, "Buildings" I.1 (our translation). */
export const PROKOPIOS_SOURCES: readonly MomentSource[] = [
  {
    kind: 'text',
    title: 'Prokopios, Yapılar I.1 (İngilizce çeviri, Dewing)',
    url: 'https://penelope.uchicago.edu/Thayer/E/Roman/Texts/Procopius/Buildings/1A*.html',
    attribution: 'Procopius, çev. H. B. Dewing (Loeb, 1940) · LacusCurtius',
    licence: 'kamu malı (sayfanın belirttiği üzere)',
    approved: false,
    note: `${CHECKED} §§ 27, 29, 30 and 46 are the basis of the Turkish lines; the page states the text is in the public domain.`,
  },
];

/** Edmondo De Amicis, "Costantinopoli" (our translation). */
export const DE_AMICIS_SOURCES: readonly MomentSource[] = [
  {
    kind: 'text',
    title: 'Costantinopoli: L’arrivo (İtalyanca)',
    url: 'https://www.experiences.it/archives/59730',
    attribution: 'Edmondo De Amicis · experiences.it',
    licence: 'kamu malı',
    approved: false,
    note: `${CHECKED} Italian chapter; the fog, Scutari and "Ecco Costantinopoli!" sentences were read there.`,
  },
  {
    kind: 'text',
    title: 'Constantinople, 1. cilt (İngilizce, Gutenberg)',
    url: 'https://www.gutenberg.org/ebooks/51728',
    attribution: 'Edmondo De Amicis, çev. Maria Hornor Lansdale · Project Gutenberg',
    licence: 'kamu malı',
    approved: false,
    note: `${CHECKED} English translation, a crib only.`,
  },
  {
    kind: 'link',
    title: 'Costantinopoli (Vikipedi, İtalyanca)',
    url: 'https://it.wikipedia.org/wiki/Costantinopoli_(libro_di_viaggio)',
    attribution: 'Wikipedia',
    approved: false,
    note: CHECKED,
  },
];
