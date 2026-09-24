/**
 * Fictional Turkish shop names for the sign bands. Every business shown in the game is fictional (OSM names are data
 * only): a name is a first word of the district profile (a family name, a nature word or a place word of the district,
 * ../district.ts `shops.firstWords`) plus the trade word of the shop's POI kind, e.g. "YAKAMOZ BALIKÇILIK", "ÇINAR
 * FIRINI", "TAHTAKALE BAHARAT". Generated names that share a distinctive word with an OSM business name nearby are
 * rejected, so no sign repeats a real shop's name. Filler trades (shops without a POI) come from the profile too.
 */
import { district } from '../district';
import { h01, pick } from '../facade/frame';

/** Shop trades: sign words, the trade shown on projecting signs, and the display kind. */
export type Trade = 'fish' | 'produce' | 'deli' | 'restaurant' | 'fastfood' | 'cafe' | 'sweets' | 'bakery' | 'clothes' | 'optician' | 'phone' | 'pharmacy' | 'jewellery' | 'shoes' | 'books' | 'hardware' | 'market' | 'barber' | 'butcher' | 'nuts' | 'spice' | 'coffee' | 'textiles' | 'housewares';

const WORDS: Record<Trade, { suffix: string[]; short: string }> = {
  fish: { suffix: ['BALIKÇILIK', 'BALIK', 'BALIK EVİ', 'SU ÜRÜNLERİ'], short: 'BALIK' },
  produce: { suffix: ['MANAV', 'MEYVE SEBZE', 'MANAVI'], short: 'MANAV' },
  deli: { suffix: ['ŞARKÜTERİ', 'TURŞUCUSU', 'MEZE EVİ', 'PEYNİRCİSİ'], short: 'ŞARKÜTERİ' },
  restaurant: { suffix: ['LOKANTASI', 'EV YEMEKLERİ', 'RESTORAN', 'MEYHANESİ'], short: 'LOKANTA' },
  fastfood: { suffix: ['DÖNER', 'BÜFE', 'KOKOREÇ', 'TOST EVİ', 'LAHMACUN', 'KÖFTECİSİ'], short: 'DÖNER' },
  cafe: { suffix: ['KAFE', 'KAHVE EVİ', 'ÇAY EVİ', 'KAHVECİSİ'], short: 'KAFE' },
  sweets: { suffix: ['ŞEKERCİSİ', 'LOKUM', 'TATLICISI', 'BAKLAVA'], short: 'TATLI' },
  bakery: { suffix: ['FIRINI', 'PASTANESİ', 'SİMİT', 'BÖREKÇİSİ'], short: 'FIRIN' },
  clothes: { suffix: ['GİYİM', 'BUTİK', 'TEKSTİL', 'MODA'], short: 'GİYİM' },
  optician: { suffix: ['OPTİK', 'GÖZLÜK'], short: 'OPTİK' },
  phone: { suffix: ['İLETİŞİM', 'TELEFON', 'GSM'], short: 'TELEFON' },
  pharmacy: { suffix: ['ECZANESİ'], short: 'ECZANE' },
  jewellery: { suffix: ['KUYUMCULUK', 'KUYUMCU'], short: 'KUYUMCU' },
  shoes: { suffix: ['AYAKKABI', 'KUNDURA'], short: 'AYAKKABI' },
  books: { suffix: ['KİTABEVİ', 'SAHAF', 'KIRTASİYE'], short: 'KİTAP' },
  hardware: { suffix: ['HIRDAVAT', 'NALBUR', 'ZÜCCACİYE'], short: 'HIRDAVAT' },
  market: { suffix: ['MARKET', 'BAKKAL', 'TEKEL', 'GIDA'], short: 'MARKET' },
  barber: { suffix: ['KUAFÖR', 'BERBER'], short: 'KUAFÖR' },
  butcher: { suffix: ['KASAP', 'ET MANGAL'], short: 'KASAP' },
  nuts: { suffix: ['KURUYEMİŞ', 'BAHARAT', 'AKTAR'], short: 'KURUYEMİŞ' },
  spice: { suffix: ['BAHARAT', 'BAHARATÇISI', 'AKTARİYE', 'AKTAR'], short: 'BAHARAT' },
  coffee: { suffix: ['KAHVECİSİ', 'KAHVE', 'KAHVE TOPTAN'], short: 'KAHVE' },
  textiles: { suffix: ['MANİFATURA', 'KUMAŞ', 'TEKSTİL', 'PERDE', 'TUHAFİYE'], short: 'KUMAŞ' },
  housewares: { suffix: ['ZÜCCACİYE', 'EV GEREÇLERİ', 'MUTFAK', 'PLASTİK'], short: 'ZÜCCACİYE' },
};

/** POI kind (shop=*, amenity=*, craft=*) to trade. */
export function tradeOf(kind: string | undefined, u: number): Trade {
  const own = kind ? district().shops.tradeOverrides[kind] : undefined;
  if (own) {
    return own;
  }
  const v = kind?.split('=')[1] ?? '';
  switch (v) {
    case 'seafood':
    case 'fish':
    case 'fishmonger':
      return 'fish';
    case 'greengrocer':
    case 'farm':
    case 'frozen_food':
      return 'produce';
    case 'deli':
    case 'cheese':
    case 'dairy':
    case 'spices':
      return 'deli';
    case 'nuts':
    case 'herbalist':
    case 'coffee':
    case 'tea':
      return 'nuts';
    case 'restaurant':
    case 'pub':
    case 'bar':
      return 'restaurant';
    case 'fast_food':
    case 'food_court':
      return 'fastfood';
    case 'cafe':
    case 'ice_cream':
    case 'internet_cafe':
    case 'hookah_lounge':
      return 'cafe';
    case 'confectionery':
    case 'chocolate':
    case 'pastry':
      return 'sweets';
    case 'bakery':
      return 'bakery';
    case 'clothes':
    case 'fashion':
    case 'boutique':
    case 'fabric':
    case 'bag':
    case 'tailor':
      return 'clothes';
    case 'optician':
      return 'optician';
    case 'mobile_phone':
    case 'electronics':
    case 'computer':
      return 'phone';
    case 'pharmacy':
    case 'chemist':
    case 'cosmetics':
    case 'perfumery':
      return v === 'pharmacy' ? 'pharmacy' : 'clothes';
    case 'jewelry':
    case 'watches':
      return 'jewellery';
    case 'shoes':
      return 'shoes';
    case 'books':
    case 'stationery':
      return 'books';
    case 'hardware':
    case 'houseware':
    case 'doityourself':
      return 'hardware';
    case 'hairdresser':
    case 'beauty':
      return 'barber';
    case 'butcher':
      return 'butcher';
    case 'supermarket':
    case 'convenience':
    case 'kiosk':
    case 'alcohol':
    case 'beverages':
      return 'market';
    default:
      return pick<Trade>(district().shops.fallback, u);
  }
}

/** Filler trades for ground floors without a mapped POI (district profile), in or outside its market end. */
export function fillerTrade(u: number, market: boolean): Trade {
  const sh = district().shops;
  return pick(market ? sh.marketFiller : sh.filler, u);
}

export interface ShopName {
  /** Sign band text. */
  name: string;
  /** Short word for projecting signs and awning valances. */
  short: string;
}

/** A fictional name for a shop of `trade`, avoiding the words in `avoid` (OSM names nearby, upper-cased). */
export function shopName(trade: Trade, seed: number, avoid: ReadonlySet<string>): ShopName {
  const w = WORDS[trade];
  for (let k = 0; k < 12; k++) {
    const first = pick(district().shops.firstWords, h01(seed, 11 + k));
    if (avoid.has(first)) {
      continue;
    }
    const suffix = pick(w.suffix, h01(seed, 31 + k));
    const name = `${first} ${suffix}`;
    if (name.length <= 22) {
      return { name, short: w.short };
    }
  }
  return { name: w.short, short: w.short };
}

/** Upper-cased words (3+ letters) of OSM business names, for shopName's avoid list. */
export function osmWords(names: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const n of names) {
    for (const word of n.toLocaleUpperCase('tr').split(/[^A-ZÇĞİÖŞÜ0-9]+/)) {
      if (word.length >= 3) {
        out.add(word);
      }
    }
  }
  return out;
}
