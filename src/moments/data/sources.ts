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
