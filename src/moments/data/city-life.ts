/**
 * City life and nature (phase 19 backlog items 2 and 4). Player-facing text is Turkish and our own writing.
 */
import type { LatLon, Moment } from '../types';
import { original } from './provenance';
import { MUSIC_KAGITHANE } from './music-sources';

/**
 * Rough corridor over the Bosphorus from Sarayburnu to the Black Sea mouth, both shores included (shared with the shore
 * poem). moments-runtime-check verifies that it covers the strait's water in world coordinates.
 */
export const BOSPHORUS_CORRIDOR: readonly LatLon[] = [
  { lat: 41.0, lon: 28.97 },
  { lat: 41.0, lon: 29.05 },
  { lat: 41.075, lon: 29.085 },
  { lat: 41.21, lon: 29.16 },
  { lat: 41.24, lon: 29.17 },
  { lat: 41.24, lon: 29.07 },
  { lat: 41.21, lon: 29.05 },
  { lat: 41.07, lon: 29.0 },
];

export const storks: Moment = {
  id: 'storks-bosphorus-migration',
  title: "Boğaz'da Leylek Göçü",
  category: 'city-life',
  status: 'ready',
  backlog: 2,
  trigger: {
    place: { label: 'Bosphorus corridor', area: BOSPHORUS_CORRIDOR },
    surface: 'air',
    altitude: [{ ref: 'asl', min: 150, max: 1500 }],
    dateRange: { from: { month: 8, day: 15 }, to: { month: 10, day: 15 } },
    timeOfDay: { from: 9, to: 17 },
    weather: ['clear', 'haze'],
    repeat: { kind: 'repeatable', cooldownSec: 1800 },
  },
  content: {
    // Kâğıthane Semaisi, Victor 69173 (1916): the airy flute and violin introduction.
    musicId: 'kagithane-semaisi-1916',
    // Procedural (src/moments/content.ts): the instanced flock of src/moments/storks, its wing poses and the
    // synthesised stork sounds (src/audio/sfx/storks.ts) over a soft wind bed.
    actorId: 'moments/white-stork-flock',
    animationIds: ['moments/stork-soar-circle', 'moments/stork-glide'],
    soundId: 'moments/stork-bill-clatter',
    subtitles: [
      { at: 0, duration: 4.5, text: "Leylekler! Her sonbahar Avrupa'dan Afrika'ya göçerken Boğaz'ın üstünden geçerler." },
      { at: 5, duration: 4.5, text: 'Denizin üstünde sıcak hava yükselmez; bu yüzden denizi en dar yerinden aşarlar.' },
      { at: 10, duration: 4.5, text: 'Kanat çırpmadan, daire çizerek yükseliyorlar. Katıl onlara: sıcak hava bedava.' },
      { at: 20, duration: 4.5, text: 'Tepeye varanlar süzülerek güneye, bir sonraki termiğe doğru yola koyuluyor.' },
    ],
    camera: { kind: 'orbit', note: 'Flock circling in a thermal column; the dragon may join the spiral.' },
    card: {
      title: "Boğaz'dan Göç",
      text:
        "Her sonbahar yüz binlerce leylek ve yırtıcı kuş, Avrupa'dan Afrika'ya göç ederken Boğaz'ın üzerinden geçer. " +
        'Uzun deniz geçişlerinden kaçınır; karanın üstünde yükselen sıcak hava akımlarında kanat çırpmadan süzülerek ilerler.',
    },
    waypoints: [
      // The ?moment= shortcut starts here (420 m ASL), heading up the strait for the narrows; the kettle appears ahead.
      { id: 'start', lat: 41.078, lon: 29.052, note: 'Mid-strait off Kandilli, facing the heated hills of both shores at the narrows', expect: 'water' },
      { id: 'narrows', lat: 41.084, lon: 29.0615, note: 'The Rumelihisarı – Anadoluhisarı narrows, where flocks cross', expect: 'water' },
    ],
  },
  provenance: [original('subtitles', 'White stork and raptor migration over the Bosphorus (natural history)'), original('card', 'White stork and raptor migration over the Bosphorus (natural history)')],
  needs: [],
  sources: [MUSIC_KAGITHANE],
  notes:
    'White storks peak from mid-August to mid-September, raptors continue into October; the range 15 Aug – 15 Oct covers both. ' +
    'Runtime: src/moments/storks spawns a kettle 320–800 m ahead of the dragon on the best real thermal of the lift field ' +
    '(phase 05) in view, so the dragon can join the spiral; the kettle empties into a glide stream to the south and fades far away.',
};

export const gullSimit: Moment = {
  id: 'ferry-gull-simit',
  title: 'Martı ve Simit',
  category: 'city-life',
  status: 'ready',
  backlog: 4,
  trigger: {
    // 'ferry': the vapurs and city ferries in service (underway on their line), supplied by src/moments/anchors.ts.
    place: { label: 'Near a ferry in service (moving anchor)', anchor: 'ferry', radius: 250 },
    surface: 'any',
    altitude: [{ ref: 'agl', max: 60 }],
    // Low and slow near the boat: flying, gliding, hovering or perched on it; not diving, swimming or under water.
    flightModes: ['flying', 'gliding', 'hovering', 'stalling', 'landing', 'takeoff', 'grounded'],
    timeOfDay: { from: 7, to: 20 },
    weather: ['clear', 'haze', 'fog'],
    repeat: { kind: 'repeatable', cooldownSec: 600 },
  },
  content: {
    // A deck radio on the ferry the moment started at (the 'ferry' anchor); it moves with the ship.
    musicSource: { kind: 'ferry', anchor: 'ferry', height: 8 },
    // Procedural (src/moments/gull-simit): the ferry's gull flock and the tossed simit pieces; no passengers.
    actorId: 'moments/ferry-gull-flock',
    soundId: 'moments/gull-call',
    subtitles: [
      { at: 0, duration: 4, text: 'Vapurun arkasında biri simidini bölüp martılara atıyor.' },
      { at: 4.5, duration: 4, text: 'Martılar rüzgârda asılı duruyor, parçayı havada kapıyorlar.' },
      { at: 9, duration: 3, speaker: 'Martı', text: 'Yanında çay da var mı?' },
    ],
    camera: { kind: 'look-at', note: 'Stern of the ferry: gulls hanging in the slipstream, simit pieces tossed from the rail.' },
    card: {
      title: 'Martı ve Simit',
      text:
        'İstanbul vapurlarının değişmeyen sahnesi: arkadan simit atan yolcular, dümen suyunda asılı duran martılar. ' +
        'Parçayı çoğu zaman havada kaparlar; kaçanı da denizden toplarlar.',
    },
  },
  provenance: [original('subtitles'), original('card')],
  needs: [],
  notes:
    "Anchored to the ferries in service ('ferry' anchor: vapur and double-ender kinds underway). The flock takes over " +
    "the ferry's ambient gulls and hands them back afterwards. The dragon may snatch a simit too (future gameplay).",
};

export const anglers: Moment = {
  id: 'galata-bridge-anglers',
  title: 'Galata Köprüsü Oltacıları',
  category: 'city-life',
  status: 'draft',
  backlog: 4,
  trigger: {
    place: { label: 'Galata Bridge upper deck', center: { lat: 41.0198, lon: 28.9733 }, radius: 220 },
    surface: 'air',
    altitude: [{ ref: 'agl', max: 25 }],
    timeOfDay: { from: 6, to: 22 },
    weather: ['clear', 'haze', 'fog', 'rain'],
    repeat: { kind: 'repeatable', cooldownSec: 240 },
  },
  content: {
    actorId: 'moments/galata-anglers',
    animationIds: ['moments/angler-hold-hat', 'moments/angler-shake-fist', 'moments/angler-recast'],
    soundId: 'moments/anglers-reel-and-shout',
    subtitles: [
      { at: 0, duration: 3.5, text: 'Galata Köprüsü\'nde oltacılar şapkalarına sarıldı.' },
      { at: 4, duration: 3.5, speaker: 'Oltacı', text: 'Yavaş be evladım, istavritler kaçıyor!' },
      { at: 8, duration: 3.5, speaker: 'Oltacı', text: 'Önce bir balık tut, sonra hava atarsın.' },
    ],
    camera: { kind: 'look-at', waypoint: 'deck', note: 'Row of anglers along the railing, rods bending, hats held down by the downwash.' },
    card: {
      title: 'Galata Köprüsü Oltacıları',
      text: "Köprünün korkuluğu boyunca sabahtan akşama olta sallayanlar İstanbul'un en sabırlı insanlarıdır. En çok istavrit çıkar.",
    },
    waypoints: [{ id: 'deck', lat: 41.0198, lon: 28.9733, note: 'Middle of the upper deck', nearLandmark: 'galata-koprusu' }],
  },
  provenance: [original('subtitles'), original('card')],
  needs: ['model', 'animation', 'sound'],
  notes: 'The low flyover should also ruffle clothes and hats (street crowd system); this record only covers the lines.',
};

export const CITY_LIFE: readonly Moment[] = [storks, gullSimit, anglers];
