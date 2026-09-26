/**
 * Legends and historic events (phase 19 backlog items 3, 5, 7, 8, 9). Player-facing text is Turkish and our own
 * writing; historic claims that rest on a single source say so in the game ("rivayete göre", "Evliya'ya göre").
 */
import type { Moment } from '../types';
import { EVLIYA, original } from './provenance';

export const hezarfen: Moment = {
  id: 'hezarfen-galata-uskudar',
  title: 'Hezarfen Ahmed Çelebi',
  category: 'legend',
  status: 'draft',
  backlog: 3,
  trigger: {
    place: { label: 'Around the Galata Tower', center: { lat: 41.02563, lon: 28.97421 }, radius: 300 },
    surface: 'air',
    altitude: [{ ref: 'asl', min: 30, max: 300 }],
    timeOfDay: { from: 8, to: 19 },
    weather: ['clear', 'haze'],
    repeat: { kind: 'once-per-session' },
  },
  content: {
    actorId: 'moments/hezarfen-ghost-glider',
    animationIds: ['moments/hezarfen-leap', 'moments/hezarfen-glide', 'moments/hezarfen-wave'],
    soundId: 'moments/hezarfen-wing-cloth',
    subtitles: [
      { at: 0, duration: 4.5, text: 'Rivayete göre IV. Murad devrinde biri bu kuleden kanat takıp atladı.' },
      { at: 5, duration: 4, text: "Adı Hezarfen Ahmed Çelebi. Hikâyeyi Evliya Çelebi anlatıyor." },
      { at: 9.5, duration: 4, text: "Boğaz'ı süzülerek geçmiş, Üsküdar'da Doğancılar'a konmuş." },
      { at: 14, duration: 3.5, text: 'İşte yine atlıyor. Bakalım bir ejderha ona yetişebilir mi?' },
    ],
    camera: { kind: 'follow', waypoint: 'start', note: 'Frame the glider leaving the tower gallery, then let the player chase.' },
    card: {
      title: 'Hezarfen Ahmed Çelebi',
      text:
        "Evliya Çelebi'ye göre 17. yüzyılda kartal kanatlarıyla Galata Kulesi'nden Üsküdar'a süzüldü. " +
        "Padişah bir kese altın verdi, sonra \"korkulacak adam\" deyip onu Cezayir'e gönderdi. Başka kaynak yok; hikâye yine de uçuyor.",
    },
    waypoints: [
      { id: 'start', lat: 41.02563, lon: 28.97421, note: 'Galata Tower gallery', expect: 'land', nearLandmark: 'galata-kulesi' },
      { id: 'landing', lat: 41.0213, lon: 29.0152, note: 'Doğancılar, Üsküdar (the square named by Evliya)', expect: 'land' },
    ],
  },
  provenance: [original('subtitles', EVLIYA), original('card', EVLIYA)],
  needs: ['model', 'animation', 'sound'],
  notes:
    'Only source is Evliya Çelebi; no contemporary record. The year is not given by Evliya (often quoted as 1630–1632), so the ' +
    'game names only the reign of Murad IV. Race gameplay (backlog 3) is future work.',
};

export const lagari: Moment = {
  id: 'lagari-sarayburnu-rocket',
  title: 'Lagari Hasan Çelebi',
  category: 'legend',
  status: 'draft',
  backlog: 7,
  trigger: {
    place: { label: 'Sarayburnu point', center: { lat: 41.0165, lon: 28.986 }, radius: 450 },
    surface: 'air',
    altitude: [{ ref: 'asl', min: 20, max: 350 }],
    weather: ['clear', 'haze'],
    repeat: { kind: 'once-per-session' },
  },
  content: {
    actorId: 'moments/lagari-rocket',
    animationIds: ['moments/lagari-launch', 'moments/lagari-wings-open', 'moments/lagari-splash'],
    soundId: 'moments/lagari-fuse-whoosh',
    subtitles: [
      { at: 0, duration: 4, text: '1633, Sarayburnu. Kaya Sultan doğmuş, sarayda şenlik var.' },
      { at: 4.5, duration: 4.5, text: 'Evliya Çelebi anlatıyor: Lagari Hasan Çelebi barutlu bir fişeğe binmiş.' },
      { at: 9.5, duration: 3.5, text: 'Fitil yandı. Hasan Çelebi göğe, bütün saray da ona baktı.' },
      { at: 13.5, duration: 4, text: 'Yakala onu! Denize inmeden önce... ya da en azından el salla.' },
    ],
    camera: { kind: 'follow', waypoint: 'launch', note: 'Frame the rocket trail rising over the point, then the wings opening.' },
    card: {
      title: 'Lagari Hasan Çelebi',
      text:
        "Evliya Çelebi'ye göre 1633'te barutlu bir fişekle Sarayburnu'ndan yükseldi, kanatlarıyla süzülüp denize indi " +
        've yüzerek kıyıya çıktı. IV. Murad onu bir kese altın ve sipahilikle ödüllendirdi.',
    },
    waypoints: [
      { id: 'launch', lat: 41.0165, lon: 28.986, note: 'Tip of Sarayburnu below the palace', expect: 'land' },
      { id: 'landing', lat: 41.018, lon: 28.992, note: 'In the sea off the point, where he splashes down and swims ashore', expect: 'water' },
    ],
  },
  provenance: [original('subtitles', EVLIYA), original('card', EVLIYA)],
  needs: ['model', 'animation', 'sound'],
  notes:
    "Evliya's account only. He gives the occasion (birth of Murad IV's daughter Kaya Sultan), about 50 okka of gunpowder paste, " +
    'the splash-down near the palace shore and the reward (a purse of gold and a sipahi post). The weight is left out of the ' +
    'subtitles on purpose; the chase gameplay is future work.',
};

export const kizKulesi: Moment = {
  id: 'kiz-kulesi-legend',
  title: 'Kız Kulesi Efsanesi',
  category: 'legend',
  status: 'draft',
  backlog: 9,
  trigger: {
    place: { label: "Kız Kulesi islet, off Salacak", center: { lat: 41.02111, lon: 29.0041 }, radius: 220 },
    surface: 'any',
    altitude: [{ ref: 'agl', max: 60 }],
    timeOfDay: { from: 20, to: 5 },
    weather: ['clear', 'haze', 'fog'],
    repeat: { kind: 'once-per-session' },
  },
  content: {
    actorId: 'moments/kiz-kulesi-snake',
    animationIds: ['moments/snake-idle', 'moments/snake-peek', 'moments/snake-hide'],
    soundId: 'moments/kiz-kulesi-night-sea',
    subtitles: [
      { at: 0, duration: 4.5, text: 'Derler ki bir kral, kızının yılan sokmasıyla öleceğini duymuş.' },
      { at: 5, duration: 4, text: 'Kızı korumak için denizin ortasına bu kuleyi yaptırmış.' },
      { at: 9.5, duration: 4.5, text: 'On sekizinci doğum gününde bir sepet üzüm gelmiş. İçinde bir de yılan.' },
      { at: 14.5, duration: 3.5, speaker: 'Yılan', text: 'Sss... Bu sefer sadece üzüm için geldim. Söz.' },
      { at: 18.5, duration: 4, text: 'Efsanenin başka türleri de anlatılır; kule hepsini sabırla dinler.' },
    ],
    camera: { kind: 'look-at', waypoint: 'tower', note: 'Tower lit at night; the snake peeks from a basket on the quay.' },
    card: {
      title: 'Kız Kulesi Efsanesi',
      text:
        'En bilinen rivayete göre kızını kehanetten korumak isteyen bir kral bu kuleyi yaptırdı; ama yılan bir meyve ' +
        "sepetinde kuleye ulaştı. Kulenin bugünkü yapısı 18. yüzyıldandır, adacığın geçmişi ise çok daha eskiye uzanır.",
    },
    waypoints: [{ id: 'tower', lat: 41.02111, lon: 29.0041, note: 'Kız Kulesi', nearLandmark: 'kiz-kulesi' }],
  },
  provenance: [original('subtitles', 'Istanbul folk legend of Kız Kulesi (anonymous, traditional), public domain'), original('card', 'Istanbul folk legend of Kız Kulesi (anonymous, traditional), public domain')],
  needs: ['model', 'animation', 'sound'],
  notes: 'Folk legend with many variants (grapes or a fruit basket; sometimes the princess survives). The snake is a small, friendly character.',
};

export const ayaYorgi: Moment = {
  id: 'aya-yorgi-challenge',
  title: "Aya Yorgi'nin Meydan Okuması",
  category: 'legend',
  status: 'draft',
  backlog: 5,
  trigger: {
    place: { label: 'Aya Yorgi monastery on Yücetepe, Büyükada', center: { lat: 40.8468, lon: 29.1196 }, radius: 160 },
    surface: 'ground',
    timeOfDay: { from: 7, to: 20 },
    repeat: { kind: 'once-per-session' },
  },
  content: {
    actorId: 'moments/aya-yorgi-knight-statue',
    animationIds: ['moments/knight-raise-spear', 'moments/knight-lower-spear', 'moments/knight-shrug'],
    soundId: 'moments/knight-armour-creak',
    subtitles: [
      { at: 0, duration: 4, speaker: 'Şövalye', text: "Dur orada, ejderha! Burası Aya Yorgi'nin tepesi." },
      { at: 4.5, duration: 3.5, speaker: 'Şövalye', text: 'Senin soyunla eskiden küçük bir meselemiz vardı.' },
      { at: 8.5, duration: 4.5, speaker: 'Şövalye', text: 'Gerçi mızrağım biraz paslandı... Bugünlük berabere diyelim mi?' },
      { at: 13.5, duration: 4, text: 'Yücetepe\'deki manastır, ejderhayı yenen Aziz Yorgi\'ye adanmıştır.' },
    ],
    camera: { kind: 'look-at', waypoint: 'statue', note: 'Low angle on the knight statue with the monastery behind; the dragon in the foreground.' },
    card: {
      title: 'Aya Yorgi, Büyükada',
      text:
        "Büyükada'nın Yücetepe'sindeki manastır, ejderha öldüren aziz olarak anılan Aziz Yorgi'ye adanmıştır. " +
        'Her yıl 23 Nisan\'da binlerce ziyaretçi tepeye tırmanır.',
    },
    waypoints: [{ id: 'statue', lat: 40.8468, lon: 29.1196, note: 'Hilltop in front of the monastery (the statue is our invention)', expect: 'land' }],
  },
  provenance: [
    original('subtitles', 'Legend of Saint George and the dragon (traditional), public domain'),
    original('card', 'Aya Yorgi monastery on Yücetepe, Büyükada; feast day 23 April', 'Confirm the monastery point on the hill in game (no landmark record yet).'),
  ],
  needs: ['model', 'animation', 'sound'],
  notes:
    'The knight statue is an original prop, not a real statue at the site. Keep the tone gentle: the saint is venerated by many ' +
    'visitors of all faiths; the joke is on the dragon and the rusty spear, never on belief.',
};

export const shipsOverLand: Moment = {
  id: 'ships-over-land-1453',
  title: 'Karadan Yürüyen Gemiler',
  category: 'legend',
  status: 'draft',
  backlog: 8,
  trigger: {
    place: {
      label: 'Beyoğlu hills above Kasımpaşa',
      area: [
        { lat: 41.0395, lon: 28.9635 },
        { lat: 41.0415, lon: 28.9850 },
        { lat: 41.0310, lon: 28.9860 },
        { lat: 41.0290, lon: 28.9640 },
      ],
    },
    surface: 'air',
    altitude: [{ ref: 'agl', max: 250 }],
    timeOfDay: { from: 22, to: 4 },
    weather: ['clear', 'haze', 'fog'],
    repeat: { kind: 'once-per-session' },
  },
  content: {
    actorId: 'moments/ghost-galley',
    animationIds: ['moments/galley-slide', 'moments/galley-oars-fade'],
    soundId: 'moments/ships-wood-creak',
    subtitles: [
      { at: 0, duration: 4.5, text: "Nisan 1453. Haliç'in ağzı kalın bir zincirle kapalı." },
      { at: 5, duration: 4.5, text: 'Bir gece gemiler yağlanmış kızaklar üstünde bu tepelerden indirildi.' },
      { at: 10, duration: 4, text: "Sabah Bizans, Haliç'te Osmanlı gemilerini gördü. Zincir yerindeydi." },
    ],
    camera: { kind: 'follow', waypoint: 'ridge', note: 'Brief: three or four translucent galleys slide downhill and fade into the water.' },
    card: {
      title: 'Karadan Yürüyen Gemiler',
      text:
        "Kuşatmanın ortasında, 22 Nisan 1453'e kadar süren bir gecede Fatih Sultan Mehmed'in donanmasından yetmiş kadar gemi " +
        "Galata'nın arkasındaki tepelerden Kasımpaşa'ya, oradan Haliç'e indirildi. Gemi sayısı ve güzergâh kaynağa göre değişir.",
    },
    waypoints: [
      { id: 'ridge', lat: 41.0355, lon: 28.979, note: 'Beyoğlu ridge (roughly today\'s Tepebaşı–Tarlabaşı line)', expect: 'land' },
      { id: 'shore', lat: 41.0335, lon: 28.966, note: 'Kasımpaşa shore', expect: 'land' },
      { id: 'water', lat: 41.03, lon: 28.9625, note: 'Golden Horn, where the galleys are launched', expect: 'water' },
    ],
  },
  provenance: [
    original('subtitles', 'Siege of Constantinople, 1453: Kritoboulos, Doukas, Barbaro, Tursun Bey (historic event)'),
    original('card', 'Siege of Constantinople, 1453: Kritoboulos, Doukas, Barbaro, Tursun Bey (historic event)'),
  ],
  needs: ['model', 'animation', 'sound'],
  notes:
    'Sources give 67–80 ships and differ on the route (from Tophane or from Dolmabahçe/Beşiktaş, over the hills to Kasımpaşa). ' +
    'The game says "yetmiş kadar" and names the route loosely. The ships were seen in the Golden Horn on the morning of 22 April 1453.',
};

export const LEGENDS: readonly Moment[] = [hezarfen, lagari, kizKulesi, ayaYorgi, shipsOverLand];
